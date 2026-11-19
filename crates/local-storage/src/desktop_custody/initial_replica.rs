//! Native-only first-replica marker and encrypted installation state. Never a business backup.
//! OS custody selects an exact file; unselected files cannot publish a replica or authority.
#[path = "initial_replica/platform.rs"]
mod platform;
use super::{DesktopCustodyError as Error, DesktopProductionCustody};
use chacha20poly1305::{KeyInit as _, Tag, XChaCha20Poly1305, aead::AeadInOut as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use zeroize::Zeroizing;
const MAX_STATE: usize = 32 * 1_048_576;
const MAX_HEAD: usize = 16_384;
const VERSION: u8 = 1;
static JOURNAL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InitialReplicaPhase {
    Fresh,
    OrdinaryOpening,
    Installing,
    Installed,
    Initialized,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InitialReplicaScope {
    pub(crate) installation: [u8; 32],
    pub(crate) account: String,
    pub(crate) workspace: String,
    pub(crate) device: String,
    pub(crate) workflow: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StateFile {
    name: String,
    identity: [u64; 2],
    revision: u64,
    size: u64,
    digest: [u8; 32],
    nonce: [u8; 24],
    scope: InitialReplicaScope,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case", deny_unknown_fields)]
#[expect(
    clippy::large_enum_variant,
    reason = "one bounded custody head keeps its exact reserved file identity inline"
)]
enum PendingFile {
    Allocating {
        name: String,
    },
    Reserved {
        file: StateFile,
        destination: InitialReplicaPhase,
    },
    Discarding {
        name: String,
        identity: [u64; 2],
    },
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Head {
    schema_version: u8,
    database: [u64; 2],
    phase: InitialReplicaPhase,
    #[serde(deserialize_with = "required_option")]
    current: Option<StateFile>,
    #[serde(deserialize_with = "required_option")]
    pending: Option<PendingFile>,
    #[serde(deserialize_with = "required_option")]
    retired: Option<StateFile>,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
pub(crate) struct InitialReplicaState {
    pub(crate) revision: u64,
    pub(crate) phase: InitialReplicaPhase,
    pub(crate) scope: Option<InitialReplicaScope>,
    pub(crate) bytes: Option<Zeroizing<Vec<u8>>>,
}
fn rejected() -> Error {
    Error::Rejected
}
fn failed() -> Error {
    Error::StorageRejected
}
fn serialize<T: Serialize>(value: &T) -> Result<Zeroizing<Vec<u8>>, Error> {
    let mut bytes = Zeroizing::new(Vec::new());
    serde_json::to_writer(&mut *bytes, value).map_err(|_| failed())?;
    Ok(bytes)
}
impl Head {
    fn validate(&self) -> Result<(), Error> {
        if self.schema_version != VERSION || self.database.contains(&0) {
            return Err(rejected());
        }
        for file in self.current.iter().chain(self.retired.iter()) {
            validate_file(file)?;
        }
        if let Some(pending) = &self.pending {
            match pending {
                PendingFile::Allocating { name } | PendingFile::Discarding { name, .. } => {
                    validate_name(name)?;
                }
                PendingFile::Reserved { file, destination } => {
                    validate_file(file)?;
                    validate_transition(self.phase, *destination)?;
                    if file.revision
                        != self
                            .current
                            .as_ref()
                            .map_or(1, |current| current.revision + 1)
                        || self
                            .current
                            .as_ref()
                            .is_some_and(|current| current.scope != file.scope)
                    {
                        return Err(rejected());
                    }
                }
            }
        }
        if self.current.is_some()
            && matches!(
                self.phase,
                InitialReplicaPhase::Fresh | InitialReplicaPhase::OrdinaryOpening
            )
        {
            return Err(rejected());
        }
        if matches!(
            self.phase,
            InitialReplicaPhase::Installing | InitialReplicaPhase::Installed
        ) && self.current.is_none()
        {
            return Err(rejected());
        }
        if self.retired.as_ref().is_some_and(|old| {
            self.current.as_ref().is_none_or(|current| {
                old.name == current.name
                    || old.identity == current.identity
                    || old.scope != current.scope
                    || old.revision + 1 != current.revision
            })
        }) {
            return Err(rejected());
        }
        Ok(())
    }
}
fn validate_transition(from: InitialReplicaPhase, to: InitialReplicaPhase) -> Result<(), Error> {
    use InitialReplicaPhase::{Fresh, Initialized, Installed, Installing};
    if matches!(
        (from, to),
        (Fresh, Installing)
            | (Installing, Installing | Installed)
            | (Installed, Installed | Initialized)
            | (Initialized, Initialized)
    ) {
        Ok(())
    } else {
        Err(rejected())
    }
}
fn validate_name(name: &str) -> Result<(), Error> {
    let suffix = name
        .strip_prefix("initial-replica-")
        .and_then(|s| s.strip_suffix(".sealed"))
        .ok_or_else(rejected)?;
    if suffix.len() != 32
        || !suffix
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(rejected());
    }
    Ok(())
}
fn validate_file(file: &StateFile) -> Result<(), Error> {
    validate_name(&file.name)?;
    if file.identity.contains(&0)
        || file.revision == 0
        || file.revision > 9_007_199_254_740_991
        || file.size < 16
        || file.size > MAX_STATE as u64 + 16
    {
        return Err(rejected());
    }
    for id in [
        &file.scope.account,
        &file.scope.workspace,
        &file.scope.device,
        &file.scope.workflow,
    ] {
        crate::desktop_native_cloud::validate_identifier(id, 160).map_err(|_| rejected())?;
    }
    if file.scope.installation == [0; 32] {
        return Err(rejected());
    }
    Ok(())
}
impl DesktopProductionCustody {
    pub(crate) fn initial_replica_state(&self) -> Result<InitialReplicaState, Error> {
        let _lock = JOURNAL_LOCK.lock().map_err(|_| failed())?;
        let mut head = self.initial_head()?;
        self.recover_initial_pending(&mut head)?;
        self.clean_initial_retired(&mut head)?;
        let bytes = head
            .current
            .as_ref()
            .map(|file| self.read_initial_file(&head, file))
            .transpose()?;
        Ok(InitialReplicaState {
            revision: head.current.as_ref().map_or(0, |file| file.revision),
            phase: head.phase,
            scope: head.current.as_ref().map(|file| file.scope.clone()),
            bytes,
        })
    }
    /// Persists an exact prepared/received operation before it can be sent or published.
    pub(crate) fn store_initial_replica_state(
        &self,
        expected_revision: u64,
        scope: &InitialReplicaScope,
        bytes: &[u8],
        phase: InitialReplicaPhase,
    ) -> Result<u64, Error> {
        if bytes.is_empty() || bytes.len() > MAX_STATE {
            return Err(rejected());
        }
        let _lock = JOURNAL_LOCK.lock().map_err(|_| failed())?;
        let mut head = self.initial_head()?;
        self.recover_initial_pending(&mut head)?;
        self.clean_initial_retired(&mut head)?;
        let revision = head.current.as_ref().map_or(0, |file| file.revision);
        if revision != expected_revision
            || head
                .current
                .as_ref()
                .is_some_and(|file| &file.scope != scope)
            || head.phase == InitialReplicaPhase::OrdinaryOpening
            || (head.phase == InitialReplicaPhase::Initialized && head.current.is_none())
        {
            return Err(rejected());
        }
        validate_transition(head.phase, phase)?;
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| Error::RandomUnavailable)?;
        let name = format!("initial-replica-{}.sealed", hex(&random));
        head.pending = Some(PendingFile::Allocating { name: name.clone() });
        self.write_initial_head(&head)?;
        let mut file = self.initial_state_file(&name, true)?;
        let identity = self.initial_file_identity(&file)?;
        file.sync_all().map_err(|_| failed())?;
        self.sync_initial_directory()?;
        let mut nonce = [0; 24];
        getrandom::fill(&mut nonce).map_err(|_| Error::RandomUnavailable)?;
        let mut selected = StateFile {
            name,
            identity,
            revision: revision.checked_add(1).ok_or_else(rejected)?,
            size: bytes.len() as u64 + 16,
            digest: [0; 32],
            nonce,
            scope: scope.clone(),
        };
        let aad = initial_aad(head.database, &selected)?;
        let key = self.initial_state_key(&head.database)?;
        let cipher = XChaCha20Poly1305::new((&*key).into());
        let mut ciphertext = Zeroizing::new(Vec::with_capacity(bytes.len() + 16));
        ciphertext.extend_from_slice(bytes);
        let tag = cipher
            .encrypt_inout_detached((&nonce).into(), &aad, ciphertext.as_mut_slice().into())
            .map_err(|_| rejected())?;
        ciphertext.extend_from_slice(&tag);
        selected.digest = Sha256::digest(&*ciphertext).into();
        head.pending = Some(PendingFile::Reserved {
            file: selected.clone(),
            destination: phase,
        });
        self.write_initial_head(&head)?;
        file.write_all(&ciphertext)
            .and_then(|()| file.sync_all())
            .map_err(|_| failed())?;
        self.verify_initial_named_file(&selected.name, &file, identity)?;
        self.sync_initial_directory()?;
        self.read_initial_file(&head, &selected)?;
        head.retired = head.current.take();
        head.current = Some(selected);
        head.pending = None;
        head.phase = phase;
        self.write_initial_head(&head)?;
        self.clean_initial_retired(&mut head)?;
        Ok(revision + 1)
    }
    pub(crate) fn initialize_replica_marker(&self) -> Result<(), Error> {
        let _lock = JOURNAL_LOCK.lock().map_err(|_| failed())?;
        self.initial_head().map(|_| ())
    }
    pub(crate) fn initial_replica_begin_ordinary_open(&self) -> Result<(), Error> {
        let _lock = JOURNAL_LOCK.lock().map_err(|_| failed())?;
        let mut head = self.initial_head()?;
        self.recover_initial_pending(&mut head)?;
        if matches!(
            head.phase,
            InitialReplicaPhase::Installing | InitialReplicaPhase::Installed
        ) {
            return Err(rejected());
        }
        if head.phase == InitialReplicaPhase::Fresh {
            head.phase = InitialReplicaPhase::OrdinaryOpening;
            self.write_initial_head(&head)?;
        }
        Ok(())
    }
    pub(crate) fn initial_replica_finish_ordinary_open(&self) -> Result<(), Error> {
        let _lock = JOURNAL_LOCK.lock().map_err(|_| failed())?;
        let mut head = self.initial_head()?;
        if head.phase == InitialReplicaPhase::OrdinaryOpening {
            head.phase = InitialReplicaPhase::Initialized;
            self.write_initial_head(&head)?;
        }
        Ok(())
    }
    fn initial_head(&self) -> Result<Head, Error> {
        let raw = self.load_initial_head_bytes()?;
        let marker = self.initial_head_established()?;
        let head = if let Some(bytes) = raw {
            if bytes.len() > MAX_HEAD {
                return Err(rejected());
            }
            let value = crate::desktop_native_cloud::strict_json::<serde_json::Value>(&bytes)
                .map_err(|_| rejected())?;
            serde_json::from_value::<Head>(value).map_err(|_| rejected())?
        } else {
            if marker {
                return Err(rejected());
            }
            let database = self.initial_database_identity()?;
            let empty = self.initial_database_is_empty()?;
            if empty && self.load_authorization_floor()?.is_some() {
                return Err(rejected());
            }
            let head = Head {
                schema_version: VERSION,
                database,
                phase: if empty {
                    InitialReplicaPhase::Fresh
                } else {
                    InitialReplicaPhase::Initialized
                },
                current: None,
                pending: None,
                retired: None,
            };
            self.write_initial_head(&head)?;
            head
        };
        head.validate()?;
        if head.phase != InitialReplicaPhase::Initialized
            && head.database != self.initial_database_identity()?
        {
            return Err(rejected());
        }
        if head.phase == InitialReplicaPhase::Initialized && self.initial_database_is_empty()? {
            return Err(rejected());
        }
        if !marker {
            self.mark_initial_head_established()?;
        }
        Ok(head)
    }
    fn write_initial_head(&self, head: &Head) -> Result<(), Error> {
        head.validate()?;
        let bytes = serialize(head)?;
        if bytes.len() > MAX_HEAD {
            return Err(rejected());
        }
        self.store_initial_head_bytes(&bytes)?;
        if self.load_initial_head_bytes()?.as_deref() != Some(bytes.as_slice()) {
            return Err(failed());
        }
        self.mark_initial_head_established()
    }
    fn read_initial_file(
        &self,
        head: &Head,
        selected: &StateFile,
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        validate_file(selected)?;
        let mut file = self.initial_state_file(&selected.name, false)?;
        self.verify_initial_named_file(&selected.name, &file, selected.identity)?;
        if file.metadata().map_err(|_| failed())?.len() != selected.size {
            return Err(rejected());
        }
        let mut bytes = Zeroizing::new(Vec::with_capacity(
            usize::try_from(selected.size).map_err(|_| rejected())?,
        ));
        std::io::Read::by_ref(&mut file)
            .take(selected.size + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| failed())?;
        if bytes.len() as u64 != selected.size
            || <[u8; 32]>::from(Sha256::digest(&*bytes)) != selected.digest
        {
            return Err(rejected());
        }
        file.seek(SeekFrom::Start(0)).map_err(|_| failed())?;
        let mut repeated = Zeroizing::new(Vec::with_capacity(bytes.len()));
        file.take(selected.size + 1)
            .read_to_end(&mut repeated)
            .map_err(|_| failed())?;
        if *repeated != *bytes {
            return Err(rejected());
        }
        let file = self.initial_state_file(&selected.name, false)?;
        self.verify_initial_named_file(&selected.name, &file, selected.identity)?;
        let payload_len = bytes.len() - 16;
        let tag = Tag::try_from(&bytes[payload_len..]).map_err(|_| rejected())?;
        bytes.truncate(payload_len);
        let key = self.initial_state_key(&head.database)?;
        XChaCha20Poly1305::new((&*key).into())
            .decrypt_inout_detached(
                (&selected.nonce).into(),
                &initial_aad(head.database, selected)?,
                bytes.as_mut_slice().into(),
                &tag,
            )
            .map_err(|_| rejected())?;
        Ok(bytes)
    }
    fn recover_initial_pending(&self, head: &mut Head) -> Result<(), Error> {
        let Some(pending) = head.pending.clone() else {
            return Ok(());
        };
        match pending {
            PendingFile::Allocating { name } => {
                if let Some(file) = self.initial_state_file_optional(&name)? {
                    if file.metadata().map_err(|_| failed())?.len() != 0 {
                        return Err(rejected());
                    }
                    head.pending = Some(PendingFile::Discarding {
                        name: name.clone(),
                        identity: self.initial_file_identity(&file)?,
                    });
                    self.write_initial_head(head)?;
                    drop(file);
                    self.recover_initial_pending(head)?;
                } else {
                    head.pending = None;
                    self.write_initial_head(head)?;
                }
            }
            PendingFile::Reserved {
                file: selected,
                destination,
            } => {
                let file = self.initial_state_file(&selected.name, false)?;
                self.verify_initial_named_file(&selected.name, &file, selected.identity)?;
                let size = file.metadata().map_err(|_| failed())?.len();
                if size > selected.size {
                    return Err(rejected());
                }
                if size == selected.size {
                    // A complete write may have survived only in the previous process's page
                    // cache. Make the exact pinned file durable before selecting it in OS custody.
                    file.sync_all().map_err(|_| failed())?;
                    self.verify_initial_named_file(&selected.name, &file, selected.identity)?;
                    self.sync_initial_directory()?;
                    self.read_initial_file(head, &selected)?;
                    head.retired = head.current.take();
                    head.current = Some(selected);
                    head.pending = None;
                    head.phase = destination;
                    self.write_initial_head(head)?;
                } else {
                    drop(file);
                    head.pending = Some(PendingFile::Discarding {
                        name: selected.name,
                        identity: selected.identity,
                    });
                    self.write_initial_head(head)?;
                    self.recover_initial_pending(head)?;
                }
            }
            PendingFile::Discarding { name, identity } => {
                self.remove_initial_file_exact(&name, identity)?;
                head.pending = None;
                self.write_initial_head(head)?;
            }
        }
        Ok(())
    }
    fn clean_initial_retired(&self, head: &mut Head) -> Result<(), Error> {
        if let Some(retired) = &head.retired {
            self.remove_initial_file_exact(&retired.name, retired.identity)?;
            head.retired = None;
            self.write_initial_head(head)?;
        }
        Ok(())
    }
}
fn initial_aad(database: [u64; 2], file: &StateFile) -> Result<Zeroizing<Vec<u8>>, Error> {
    serialize(&(
        "GOODDEALER/INITIAL-REPLICA-JOURNAL-AAD-V1",
        VERSION,
        database,
        &file.name,
        file.identity,
        file.revision,
        file.size,
        &file.scope,
    ))
}
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::{DesktopApplicationRoot, desktop_custody::TestRebootstrapKeyStore};
    fn custody(
        path: &std::path::Path,
        store: &TestRebootstrapKeyStore,
    ) -> DesktopProductionCustody {
        let root = DesktopApplicationRoot::validate(path).unwrap();
        DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
            &root,
            store.clone(),
        )
        .unwrap()
    }
    fn scope() -> InitialReplicaScope {
        InitialReplicaScope {
            installation: [7; 32],
            account: "account".into(),
            workspace: "workspace".into(),
            device: "device".into(),
            workflow: "workflow".into(),
        }
    }
    #[test]
    fn encrypted_journal_survives_restart_and_hides_partial_replica() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = custody(&path, &store);
        assert_eq!(
            owner.initial_replica_state().unwrap().phase,
            InitialReplicaPhase::Fresh
        );
        assert_eq!(
            owner
                .store_initial_replica_state(
                    0,
                    &scope(),
                    b"secret-capability",
                    InitialReplicaPhase::Installing
                )
                .unwrap(),
            1
        );
        let head = owner.initial_head().unwrap();
        let selected = head.current.unwrap();
        let sealed = std::fs::read(path.join("active-workspace").join(selected.name)).unwrap();
        assert!(
            !sealed
                .windows(17)
                .any(|window| window == b"secret-capability")
        );
        assert!(
            owner
                .open_existing_workspace("workspace")
                .unwrap()
                .is_none()
        );
        assert!(owner.open_workspace("workspace").is_err());
        drop(owner);
        let owner = custody(&path, &store);
        let state = owner.initial_replica_state().unwrap();
        assert_eq!(state.revision, 1);
        assert_eq!(state.bytes.unwrap().as_slice(), b"secret-capability");
        assert!(
            owner
                .store_initial_replica_state(0, &scope(), b"stale", InitialReplicaPhase::Installing)
                .is_err()
        );
        let mut foreign = scope();
        foreign.workflow = "other".into();
        assert!(
            owner
                .store_initial_replica_state(
                    1,
                    &foreign,
                    b"foreign",
                    InitialReplicaPhase::Installing
                )
                .is_err()
        );
        owner
            .store_initial_replica_state(1, &scope(), b"installed", InitialReplicaPhase::Installed)
            .unwrap();
        assert!(owner.open_workspace("workspace").is_err());
        drop(owner.open_initial_replica_database("workspace").unwrap());
        owner
            .store_initial_replica_state(
                2,
                &scope(),
                b"activated",
                InitialReplicaPhase::Initialized,
            )
            .unwrap();
        assert!(owner.open_workspace("workspace").is_ok());
    }
    #[test]
    fn ordinary_initialized_file_never_becomes_a_first_install() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = custody(&path, &store);
        drop(owner.open_workspace("workspace").unwrap());
        assert_eq!(
            owner.initial_replica_state().unwrap().phase,
            InitialReplicaPhase::Initialized
        );
        assert!(
            owner
                .store_initial_replica_state(0, &scope(), b"claim", InitialReplicaPhase::Installing)
                .is_err()
        );
        owner
            .active_database
            .lock()
            .unwrap()
            .file
            .set_len(0)
            .unwrap();
        drop(owner);
        let root = DesktopApplicationRoot::validate(&path).unwrap();
        assert!(
            DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(&root, store)
                .is_err()
        );
    }
    #[test]
    fn established_marker_rejects_missing_head() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = custody(&path, &store);
        *store.initial_replica_head.lock().unwrap() = None;
        assert!(owner.initial_replica_state().is_err());
    }
    #[test]
    fn selected_missing_truncated_modified_and_old_file_are_rejected() {
        for kind in ["missing", "truncated", "modified", "old"] {
            let directory = crate::test_tempdir::tempdir().unwrap();
            let path = directory.path().join("GoodDealer");
            let store = TestRebootstrapKeyStore::default();
            let owner = custody(&path, &store);
            owner
                .store_initial_replica_state(0, &scope(), b"one", InitialReplicaPhase::Installing)
                .unwrap();
            let old = owner.initial_head().unwrap().current.unwrap();
            let old_bytes = std::fs::read(path.join("active-workspace").join(&old.name)).unwrap();
            owner
                .store_initial_replica_state(1, &scope(), b"two", InitialReplicaPhase::Installing)
                .unwrap();
            let current = owner.initial_head().unwrap().current.unwrap();
            let file = path.join("active-workspace").join(current.name);
            match kind {
                "missing" => std::fs::remove_file(file).unwrap(),
                "truncated" => std::fs::write(file, b"x").unwrap(),
                "modified" => {
                    std::fs::write(file, vec![0; usize::try_from(current.size).unwrap()]).unwrap();
                }
                _ => std::fs::write(file, old_bytes).unwrap(),
            }
            assert!(owner.initial_replica_state().is_err());
        }
    }
    #[test]
    fn reserved_complete_write_before_sync_recovers_exact_destination_after_reopen() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = custody(&path, &store);
        owner
            .store_initial_replica_state(0, &scope(), b"installed", InitialReplicaPhase::Installing)
            .unwrap();
        let mut head = owner.initial_head().unwrap();
        let selected = head.current.take().unwrap();
        let ciphertext = std::fs::read(path.join("active-workspace").join(&selected.name)).unwrap();
        let mut file = owner.initial_state_file(&selected.name, false).unwrap();
        file.set_len(0).unwrap();
        head.phase = InitialReplicaPhase::Fresh;
        head.pending = Some(PendingFile::Reserved {
            file: selected,
            destination: InitialReplicaPhase::Installing,
        });
        owner.write_initial_head(&head).unwrap();
        // Model process loss after the entire payload write and before its sync_all.
        file.write_all(&ciphertext).unwrap();
        drop(file);
        drop(owner);
        let owner = custody(&path, &store);
        let state = owner.initial_replica_state().unwrap();
        assert_eq!(state.phase, InitialReplicaPhase::Installing);
        assert_eq!(state.bytes.unwrap().as_slice(), b"installed");
    }
    #[test]
    fn allocation_and_partial_write_crash_prefixes_are_bounded_and_do_not_grant_authority() {
        for prefix in [
            "allocated-missing",
            "allocated-empty",
            "allocated-nonempty",
            "reserved-partial",
            "reserved-missing",
            "discarded-missing",
        ] {
            let directory = crate::test_tempdir::tempdir().unwrap();
            let path = directory.path().join("GoodDealer");
            let store = TestRebootstrapKeyStore::default();
            let owner = custody(&path, &store);
            let name = "initial-replica-0123456789abcdef0123456789abcdef.sealed";
            let mut head = owner.initial_head().unwrap();
            head.pending = Some(PendingFile::Allocating { name: name.into() });
            owner.write_initial_head(&head).unwrap();
            let mut identity = [1, 1];
            if matches!(
                prefix,
                "allocated-empty" | "allocated-nonempty" | "reserved-partial"
            ) {
                let mut file = owner.initial_state_file(name, true).unwrap();
                identity = owner.initial_file_identity(&file).unwrap();
                if prefix != "allocated-empty" {
                    file.write_all(b"partial").unwrap();
                }
                file.sync_all().unwrap();
                owner.sync_initial_directory().unwrap();
            }
            if prefix.starts_with("reserved") {
                head.pending = Some(PendingFile::Reserved {
                    file: StateFile {
                        name: name.into(),
                        identity,
                        revision: 1,
                        size: 128,
                        digest: [1; 32],
                        nonce: [2; 24],
                        scope: scope(),
                    },
                    destination: InitialReplicaPhase::Installing,
                });
                owner.write_initial_head(&head).unwrap();
            } else if prefix == "discarded-missing" {
                head.pending = Some(PendingFile::Discarding {
                    name: name.into(),
                    identity,
                });
                owner.write_initial_head(&head).unwrap();
            }
            drop(owner);
            let owner = custody(&path, &store);
            if matches!(prefix, "allocated-nonempty" | "reserved-missing") {
                assert!(owner.initial_replica_state().is_err(), "{prefix}");
            } else {
                let state = owner.initial_replica_state().unwrap();
                assert_eq!(state.phase, InitialReplicaPhase::Fresh, "{prefix}");
                assert!(state.bytes.is_none());
                assert!(owner.initial_state_file_optional(name).unwrap().is_none());
                assert!(
                    owner
                        .open_existing_workspace("workspace")
                        .unwrap()
                        .is_none()
                );
            }
        }
    }
    #[test]
    fn legacy_standby_floor_cannot_turn_a_truncated_file_into_fresh_custody() {
        use crate::desktop_custody::WorkspaceAuthorizationFloor;
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = custody(&path, &store);
        owner
            .store_authorization_floor(&WorkspaceAuthorizationFloor {
                schema_version: 3,
                installation_binding: owner.installation_binding_digest().unwrap(),
                account_id: "account".into(),
                workspace_id: "workspace".into(),
                device_id: owner.load_device_id().unwrap(),
                account_security_epoch: 1,
                issued_at: 1,
                maximum_lease_epoch: 0,
                last_active_lease_epoch: None,
                standby_lease_epoch_floor: Some(0),
                commercial: None,
            })
            .unwrap();
        *store.initial_replica_head.lock().unwrap() = None;
        *store.initial_replica_marker.lock().unwrap() = None;
        assert!(owner.initial_replica_state().is_err());
    }
}
