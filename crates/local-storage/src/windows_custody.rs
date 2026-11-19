//! Private Local-machine Windows vault commits for bounded Native secret records.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::sync::Mutex;

use chacha20poly1305::aead::{Aead as _, Payload};
use chacha20poly1305::{KeyInit as _, XChaCha20Poly1305, XNonce};
use keyring_core::api::CredentialStoreApi as _;
use sha2::{Digest as _, Sha256};
use zeroize::Zeroizing;

use crate::windows_private_files::{PinnedDirectory, file_identity};
#[path = "windows_custody/format.rs"]
pub(crate) mod format;
use format::{CommitReference, MAX_RECORD, SlotState};
impl From<format::FormatRejected> for CustodyRejected {
    fn from(_: format::FormatRejected) -> Self {
        Self
    }
}

const PURPOSE_DOMAIN: &[u8] = b"GOODDEALER/WINDOWS-CUSTODY-PURPOSE-V1\0";
static MUTATION: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug)]
pub(crate) struct CustodyRejected;
type Result<T> = std::result::Result<T, CustodyRejected>;

struct Slot {
    root: PinnedDirectory,
    entry: keyring_core::Entry,
    purpose: [u8; 32],
    target: String,
    _lock: File,
}

pub(crate) fn load(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    let _guard = MUTATION.lock().map_err(|_| CustodyRejected)?;
    let slot = Slot::open(service, account)?;
    let SlotState::Committed(reference) = slot.state()? else {
        return Ok(None);
    };
    let plain = slot.read(&reference)?;
    if reference.deleted {
        return Ok(None);
    }
    Ok(Some(plain.to_vec()))
}
// Retirement needs existence metadata without loading a permanently refused Provider secret.
pub(crate) fn exists(service: &str, account: &str) -> Result<bool> {
    let _guard = MUTATION.lock().map_err(|_| CustodyRejected)?;
    let slot = Slot::open(service, account)?;
    Ok(matches!(slot.state()?,SlotState::Committed(reference) if !reference.deleted))
}
pub(crate) fn store(service: &str, account: &str, bytes: &[u8]) -> Result<()> {
    replace(service, account, bytes, false)
}
pub(crate) fn delete(service: &str, account: &str) -> Result<()> {
    // A durable tombstone preserves first-use evidence. Missing a vault reference must never
    // silently reinitialize an established identity or authorization floor.
    replace(service, account, &[], true)
}
fn replace(service: &str, account: &str, bytes: &[u8], deleted: bool) -> Result<()> {
    if bytes.len() > MAX_RECORD || (!deleted && bytes.is_empty()) {
        return Err(CustodyRejected);
    }
    let _guard = MUTATION.lock().map_err(|_| CustodyRejected)?;
    let slot = Slot::open(service, account)?;
    let initialization = match slot.state()? {
        SlotState::Fresh => {
            let mut nonce = [0; 32];
            getrandom::fill(&mut nonce).map_err(|_| CustodyRejected)?;
            // An authenticated OS pending value proves this purpose has never published a secret.
            // It is written before touching the marker, so a crash can resume only initialization.
            slot.write_vault(&slot.pending(nonce), true)?;
            slot.finish_initialization(nonce)?;
            nonce
        }
        SlotState::Pending(nonce) => {
            slot.finish_initialization(nonce)?;
            nonce
        }
        SlotState::Committed(reference) => {
            // Explicit owner-authorized deletion may destroy a damaged ciphertext. It still
            // requires the exact valid OS reference and marker, and never restores its contents.
            if !deleted {
                slot.read(&reference)?;
            }
            reference.initialization
        }
    };
    let mut id = [0; 16];
    let mut key = Zeroizing::new([0; 32]);
    let mut nonce = [0; 24];
    getrandom::fill(&mut id).map_err(|_| CustodyRejected)?;
    getrandom::fill(&mut *key).map_err(|_| CustodyRejected)?;
    getrandom::fill(&mut nonce).map_err(|_| CustodyRejected)?;
    let mut file = slot
        .root
        .file(&artifact_name(&id), true, true)
        .map_err(|_| CustodyRejected)?;
    let mut reference = CommitReference {
        purpose: slot.purpose,
        initialization,
        root: slot.root.identity(),
        file: file_identity(&file).map_err(|_| CustodyRejected)?,
        id,
        length: u32::try_from(bytes.len() + 16).map_err(|_| CustodyRejected)?,
        digest: [0; 32],
        key,
        nonce,
        deleted,
    };
    let cipher = XChaCha20Poly1305::new((&*reference.key).into());
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: bytes,
                aad: &reference.aad(),
            },
        )
        .map_err(|_| CustodyRejected)?;
    reference.digest = Sha256::digest(&ciphertext).into();
    file.write_all(&ciphertext)
        .and_then(|()| file.flush())
        .and_then(|()| file.sync_all())
        .map_err(|_| CustodyRejected)?;
    if slot.read(&reference)?.as_slice() != bytes {
        return Err(CustodyRejected);
    }
    slot.root.verify().map_err(|_| CustodyRejected)?;
    slot.write_vault(&reference.encode(), false)?;
    slot.read(&reference)?;
    Ok(())
}
impl Slot {
    fn open(service: &str, account: &str) -> Result<Self> {
        if !service.starts_with("com.gooddealer.desktop.")
            || service.len() > 128
            || account.is_empty()
            || account.len() > 256
            || !service.is_ascii()
            || !account.is_ascii()
            || service.bytes().any(|b| b.is_ascii_control())
            || account.bytes().any(|b| b.is_ascii_control())
        {
            return Err(CustodyRejected);
        }
        let mut digest = Sha256::new();
        digest.update(PURPOSE_DOMAIN);
        digest.update(
            u32::try_from(service.len())
                .map_err(|_| CustodyRejected)?
                .to_be_bytes(),
        );
        digest.update(service.as_bytes());
        digest.update(
            u32::try_from(account.len())
                .map_err(|_| CustodyRejected)?
                .to_be_bytes(),
        );
        digest.update(account.as_bytes());
        let purpose: [u8; 32] = digest.finalize().into();
        let target = format!("com.gooddealer.desktop.native-custody-v1.{}", hex(&purpose));
        let store = windows_native_keyring_store::Store::new().map_err(|_| CustodyRejected)?;
        // Explicit target means the store writes an empty username. No globally replaceable store.
        let modifiers = HashMap::from([("persistence", "Local"), ("target", target.as_str())]);
        let entry = store
            .build(service, account, Some(&modifiers))
            .map_err(|_| CustodyRejected)?;
        let root = PinnedDirectory::native_custody().map_err(|_| CustodyRejected)?;
        let lock_name = "custody.lock";
        let lock = match root.file(lock_name, false, true) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match root.file(lock_name, true, true) {
                    Ok(file) => file,
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => root
                        .file(lock_name, false, true)
                        .map_err(|_| CustodyRejected)?,
                    Err(_) => return Err(CustodyRejected),
                }
            }
            Err(_) => return Err(CustodyRejected),
        };
        lock.lock().map_err(|_| CustodyRejected)?;
        root.verify().map_err(|_| CustodyRejected)?;
        Ok(Self {
            root,
            entry,
            purpose,
            target,
            _lock: lock,
        })
    }
    fn marker(&self) -> String {
        format!("{}.established", hex(&self.purpose))
    }
    fn attributes(&self, allow_missing: bool) -> Result<bool> {
        let attributes = match self.entry.get_attributes() {
            Ok(attributes) => attributes,
            Err(keyring_core::Error::NoEntry) if allow_missing => return Ok(false),
            Err(_) => return Err(CustodyRejected),
        };
        if attributes.get("persistence").map(String::as_str) != Some("Local")
            || attributes.get("target_name") != Some(&self.target)
            || attributes.get("username").map(String::as_str) != Some("")
        {
            return Err(CustodyRejected);
        }
        Ok(true)
    }
    fn marker_bytes(&self) -> Result<Option<Vec<u8>>> {
        match self.root.file(&self.marker(), false, false) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(65)
                    .read_to_end(&mut bytes)
                    .map_err(|_| CustodyRejected)?;
                Ok(Some(bytes))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(CustodyRejected),
        }
    }
    fn pending(&self, initialization: [u8; 32]) -> Vec<u8> {
        format::encode_pending(self.purpose, self.root.identity(), initialization)
    }
    fn marker_value(&self, initialization: [u8; 32]) -> Vec<u8> {
        format::marker_value(self.purpose, initialization)
    }
    fn state(&self) -> Result<SlotState> {
        let marker = self.marker_bytes()?;
        let bytes = if self.attributes(true)? {
            let bytes = Zeroizing::new(self.entry.get_secret().map_err(|_| CustodyRejected)?);
            self.attributes(false)?;
            Some(bytes)
        } else {
            None
        };
        format::classify_slot(
            self.purpose,
            self.root.identity(),
            marker.as_deref(),
            bytes.as_ref().map(|v| v.as_slice()),
        )
        .map_err(Into::into)
    }
    fn finish_initialization(&self, nonce: [u8; 32]) -> Result<()> {
        // Only a current, exact OS pending sentinel reaches here. Partial marker bytes may be
        // completed when they are a prefix of that sentinel's commitment; no authority is restored.
        let expected = self.marker_value(nonce);
        let existing = self.marker_bytes()?;
        if existing
            .as_ref()
            .is_some_and(|value| !expected.starts_with(value))
        {
            return Err(CustodyRejected);
        }
        let mut marker = self
            .root
            .file(&self.marker(), existing.is_none(), true)
            .map_err(|_| CustodyRejected)?;
        marker
            .seek(SeekFrom::Start(0))
            .and_then(|_| marker.write_all(&expected))
            .and_then(|()| marker.sync_all())
            .map_err(|_| CustodyRejected)?;
        if self.marker_bytes()?.as_deref() != Some(expected.as_slice()) {
            return Err(CustodyRejected);
        }
        Ok(())
    }
    fn write_vault(&self, bytes: &[u8], allow_missing: bool) -> Result<()> {
        self.root.verify().map_err(|_| CustodyRejected)?;
        self.attributes(allow_missing)?;
        self.entry.set_secret(bytes).map_err(|_| CustodyRejected)?;
        self.attributes(false)?;
        let readback = Zeroizing::new(self.entry.get_secret().map_err(|_| CustodyRejected)?);
        self.attributes(false)?;
        if readback.as_slice() != bytes {
            return Err(CustodyRejected);
        }
        Ok(())
    }
    fn read(&self, reference: &CommitReference) -> Result<Zeroizing<Vec<u8>>> {
        self.root.verify().map_err(|_| CustodyRejected)?;
        if reference.purpose != self.purpose || reference.root != self.root.identity() {
            return Err(CustodyRejected);
        }
        let mut file = self
            .root
            .file(&artifact_name(&reference.id), false, false)
            .map_err(|_| CustodyRejected)?;
        if file_identity(&file).map_err(|_| CustodyRejected)? != reference.file
            || file.metadata().map_err(|_| CustodyRejected)?.len() != u64::from(reference.length)
        {
            return Err(CustodyRejected);
        }
        let mut bytes = Vec::new();
        std::io::Read::by_ref(&mut file)
            .take(u64::from(reference.length) + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| CustodyRejected)?;
        if bytes.len() != reference.length as usize
            || <[u8; 32]>::from(Sha256::digest(&bytes)) != reference.digest
        {
            return Err(CustodyRejected);
        }
        let cipher = XChaCha20Poly1305::new((&*reference.key).into());
        let plain = Zeroizing::new(
            cipher
                .decrypt(
                    &XNonce::from(reference.nonce),
                    Payload {
                        msg: &bytes,
                        aad: &reference.aad(),
                    },
                )
                .map_err(|_| CustodyRejected)?,
        );
        if plain.len() > MAX_RECORD || reference.deleted != plain.is_empty() {
            return Err(CustodyRejected);
        }
        // Re-open via the still-pinned parent and require exact handle identity and closed ACL again.
        let final_file = self
            .root
            .file(&artifact_name(&reference.id), false, false)
            .map_err(|_| CustodyRejected)?;
        if file_identity(&final_file).map_err(|_| CustodyRejected)? != reference.file {
            return Err(CustodyRejected);
        }
        self.root.verify().map_err(|_| CustodyRejected)?;
        Ok(plain)
    }
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(
        String::with_capacity(bytes.len() * 2),
        |mut output, byte| {
            let _ = write!(output, "{byte:02x}");
            output
        },
    )
}
fn artifact_name(id: &[u8; 16]) -> String {
    format!("{}.sealed", hex(id))
}
