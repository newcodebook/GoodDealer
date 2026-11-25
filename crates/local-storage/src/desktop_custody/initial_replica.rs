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
const MAX_HEAD: usize = 65_536;
const VERSION: u8 = 2;
const FILE_AAD_VERSION: u8 = 1;
const MAX_HISTORY: usize = 8;
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
        retain_current: bool,
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
    terminal_history: Vec<StateFile>,
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
    pub(crate) history: Vec<InitialReplicaHistory>,
}
pub(crate) struct InitialReplicaHistory {
    pub(crate) scope: InitialReplicaScope,
    pub(crate) bytes: Zeroizing<Vec<u8>>,
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
                PendingFile::Reserved {
                    file,
                    destination,
                    retain_current,
                } => {
                    validate_file(file)?;
                    validate_transition(self.phase, *destination)?;
                    if file.revision
                        != self
                            .current
                            .as_ref()
                            .map_or(1, |current| current.revision + 1)
                        || if *retain_current {
                            self.phase != InitialReplicaPhase::Installing
                                || *destination != InitialReplicaPhase::Installing
                                || self.terminal_history.len() >= MAX_HISTORY
                                || self.current.as_ref().is_none_or(|current| {
                                    !same_owner(&current.scope, &file.scope)
                                        || current.scope.workflow == file.scope.workflow
                                })
                        } else {
                            self.current
                                .as_ref()
                                .is_some_and(|current| current.scope != file.scope)
                        }
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
        self.validate_file_references()
    }
    fn validate_file_references(&self) -> Result<(), Error> {
        if self.terminal_history.len() > MAX_HISTORY {
            return Err(rejected());
        }
        let mut names = std::collections::HashSet::new();
        let mut identities = std::collections::HashSet::new();
        let mut revisions = std::collections::HashSet::new();
        let mut workflows = std::collections::HashSet::new();
        let current = self.current.as_ref();
        let mut previous_revision = 0;
        for old in &self.terminal_history {
            validate_file(old)?;
            if current.is_none_or(|selected| {
                !same_owner(&old.scope, &selected.scope)
                    || old.scope.workflow == selected.scope.workflow
                    || old.revision >= selected.revision
            }) || old.revision <= previous_revision
                || !workflows.insert(&old.scope.workflow)
            {
                return Err(rejected());
            }
            previous_revision = old.revision;
        }
        for file in self
            .terminal_history
            .iter()
            .chain(self.current.iter())
            .chain(self.retired.iter())
            .chain(self.pending.iter().filter_map(|pending| match pending {
                PendingFile::Reserved { file, .. } => Some(file),
                _ => None,
            }))
        {
            if !names.insert(&file.name)
                || !identities.insert(file.identity)
                || !revisions.insert(file.revision)
            {
                return Err(rejected());
            }
        }
        if let Some(PendingFile::Allocating { name } | PendingFile::Discarding { name, .. }) =
            &self.pending
            && names.contains(name)
        {
            return Err(rejected());
        }
        Ok(())
    }
}
fn same_owner(left: &InitialReplicaScope, right: &InitialReplicaScope) -> bool {
    left.installation == right.installation
        && left.account == right.account
        && left.workspace == right.workspace
        && left.device == right.device
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
            history: head
                .terminal_history
                .iter()
                .map(|file| {
                    Ok(InitialReplicaHistory {
                        scope: file.scope.clone(),
                        bytes: self.read_initial_file(&head, file)?,
                    })
                })
                .collect::<Result<_, Error>>()?,
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
        self.store_initial_state(expected_revision, scope, bytes, phase, false)
    }
    pub(crate) fn restart_initial_replica_state(
        &self,
        expected_revision: u64,
        scope: &InitialReplicaScope,
        bytes: &[u8],
    ) -> Result<u64, Error> {
        self.store_initial_state(
            expected_revision,
            scope,
            bytes,
            InitialReplicaPhase::Installing,
            true,
        )
    }
    pub(crate) fn initial_replica_has_history_capacity(&self) -> Result<bool, Error> {
        let _lock = JOURNAL_LOCK.lock().map_err(|_| failed())?;
        Ok(self.initial_head()?.terminal_history.len() < MAX_HISTORY)
    }
    pub(crate) fn initial_replica_database_unwritten(&self) -> Result<bool, Error> {
        let head = self.initial_head()?;
        Ok(head.database == self.initial_database_identity()?
            && self.initial_database_is_empty()?
            && self.initial_database_has_no_sidecars()?)
    }
    fn store_initial_state(
        &self,
        expected_revision: u64,
        scope: &InitialReplicaScope,
        bytes: &[u8],
        phase: InitialReplicaPhase,
        retain_current: bool,
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
            || head.current.as_ref().is_some_and(|file| {
                if retain_current {
                    !same_owner(&file.scope, scope) || file.scope.workflow == scope.workflow
                } else {
                    &file.scope != scope
                }
            })
            || retain_current
                && (head.phase != InitialReplicaPhase::Installing
                    || head.current.is_none()
                    || head.terminal_history.len() >= MAX_HISTORY
                    || head
                        .terminal_history
                        .iter()
                        .any(|old| old.scope.workflow == scope.workflow)
                    || !self.initial_replica_database_unwritten()?)
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
            retain_current,
        });
        self.write_initial_head(&head)?;
        file.write_all(&ciphertext)
            .and_then(|()| file.sync_all())
            .map_err(|_| failed())?;
        self.verify_initial_named_file(&selected.name, &file, identity)?;
        self.sync_initial_directory()?;
        self.read_initial_file(&head, &selected)?;
        select_initial_file(&mut head, selected, phase, retain_current)?;
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
            decode_head(value)?
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
                terminal_history: Vec::new(),
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
                retain_current,
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
                    select_initial_file(head, selected, destination, retain_current)?;
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
fn select_initial_file(
    head: &mut Head,
    selected: StateFile,
    phase: InitialReplicaPhase,
    retain: bool,
) -> Result<(), Error> {
    if retain {
        let old = head.current.take().ok_or_else(rejected)?;
        head.terminal_history.push(old);
    } else {
        head.retired = head.current.take();
    }
    head.current = Some(selected);
    head.pending = None;
    head.phase = phase;
    Ok(())
}
fn decode_head(mut value: serde_json::Value) -> Result<Head, Error> {
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        == Some(1)
    {
        let object = value.as_object_mut().ok_or_else(rejected)?;
        if object.contains_key("terminalHistory") {
            return Err(rejected());
        }
        object.insert("terminalHistory".into(), serde_json::json!([]));
        object.insert("schemaVersion".into(), serde_json::json!(VERSION));
        if let Some(pending) = object
            .get_mut("pending")
            .and_then(serde_json::Value::as_object_mut)
        {
            if pending.contains_key("retain_current") {
                return Err(rejected());
            }
            if pending.get("phase").and_then(serde_json::Value::as_str) == Some("reserved") {
                pending.insert("retain_current".into(), serde_json::json!(false));
            }
        }
    }
    serde_json::from_value(value).map_err(|_| rejected())
}
fn initial_aad(database: [u64; 2], file: &StateFile) -> Result<Zeroizing<Vec<u8>>, Error> {
    serialize(&(
        "GOODDEALER/INITIAL-REPLICA-JOURNAL-AAD-V1",
        FILE_AAD_VERSION,
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
            retain_current: false,
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
                    retain_current: false,
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
    #[test]
    fn terminal_history_and_successor_publish_together_across_reserved_crash_prefixes() {
        for prefix in ["complete", "partial", "missing", "old-corrupt"] {
            let directory = crate::test_tempdir::tempdir().unwrap();
            let path = directory.path().join("GoodDealer");
            let store = TestRebootstrapKeyStore::default();
            let owner = custody(&path, &store);
            owner
                .store_initial_replica_state(
                    0,
                    &scope(),
                    b"original-terminal",
                    InitialReplicaPhase::Installing,
                )
                .unwrap();
            let old = owner.initial_head().unwrap().current.unwrap();
            let mut next_scope = scope();
            next_scope.workflow = "next-workflow".into();
            owner
                .restart_initial_replica_state(1, &next_scope, b"new-confirmation")
                .unwrap();
            let mut head = owner.initial_head().unwrap();
            let next = head.current.take().unwrap();
            head.current = head.terminal_history.pop();
            head.pending = Some(PendingFile::Reserved {
                file: next.clone(),
                destination: InitialReplicaPhase::Installing,
                retain_current: true,
            });
            owner.write_initial_head(&head).unwrap();
            let next_path = path.join("active-workspace").join(&next.name);
            match prefix {
                "partial" => std::fs::write(&next_path, b"partial").unwrap(),
                "missing" => std::fs::remove_file(&next_path).unwrap(),
                "old-corrupt" => {
                    std::fs::write(path.join("active-workspace").join(&old.name), b"corrupt")
                        .unwrap();
                }
                _ => {}
            }
            drop(owner);
            let owner = custody(&path, &store);
            match prefix {
                "complete" => {
                    let state = owner.initial_replica_state().unwrap();
                    assert_eq!(state.scope.unwrap().workflow, "next-workflow");
                    assert_eq!(state.history.len(), 1);
                    assert_eq!(state.history[0].bytes.as_slice(), b"original-terminal");
                    assert_eq!(state.bytes.unwrap().as_slice(), b"new-confirmation");
                    assert!(path.join("active-workspace").join(&old.name).exists());
                }
                "partial" => {
                    let state = owner.initial_replica_state().unwrap();
                    assert_eq!(state.scope.unwrap().workflow, "workflow");
                    assert!(state.history.is_empty());
                    assert_eq!(state.bytes.unwrap().as_slice(), b"original-terminal");
                    assert!(!next_path.exists());
                }
                _ => assert!(owner.initial_replica_state().is_err()),
            }
        }
    }
    #[test]
    fn historical_file_missing_modified_replaced_and_reference_aliases_fail_closed() {
        for corrupt in ["missing", "modified", "replaced", "scope", "alias"] {
            let directory = crate::test_tempdir::tempdir().unwrap();
            let path = directory.path().join("GoodDealer");
            let store = TestRebootstrapKeyStore::default();
            let owner = custody(&path, &store);
            owner
                .store_initial_replica_state(
                    0,
                    &scope(),
                    b"terminal",
                    InitialReplicaPhase::Installing,
                )
                .unwrap();
            let mut next = scope();
            next.workflow = "next".into();
            owner
                .restart_initial_replica_state(1, &next, b"new")
                .unwrap();
            let mut head = owner.initial_head().unwrap();
            let old_path = path
                .join("active-workspace")
                .join(&head.terminal_history[0].name);
            match corrupt {
                "missing" => std::fs::remove_file(old_path).unwrap(),
                "modified" => std::fs::write(old_path, b"changed").unwrap(),
                "replaced" => {
                    let bytes = std::fs::read(&old_path).unwrap();
                    std::fs::rename(&old_path, old_path.with_extension("retained-for-test"))
                        .unwrap();
                    std::fs::write(old_path, bytes).unwrap();
                }
                "scope" => {
                    head.terminal_history[0].scope.account = "foreign".into();
                    *store.initial_replica_head.lock().unwrap() =
                        Some(serialize(&head).unwrap().to_vec());
                }
                _ => {
                    head.terminal_history[0] = head.current.clone().unwrap();
                    *store.initial_replica_head.lock().unwrap() =
                        Some(serialize(&head).unwrap().to_vec());
                }
            }
            assert!(owner.initial_replica_state().is_err(), "{corrupt}");
        }
    }
    #[test]
    fn v1_head_upgrades_explicitly_without_reencrypting_its_selected_file() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = custody(&path, &store);
        owner
            .store_initial_replica_state(
                0,
                &scope(),
                b"v1-payload",
                InitialReplicaPhase::Installing,
            )
            .unwrap();
        let head = owner.initial_head().unwrap();
        let selected = head.current.as_ref().unwrap();
        let original_file =
            std::fs::read(path.join("active-workspace").join(&selected.name)).unwrap();
        let mut legacy = serde_json::to_value(&head).unwrap();
        legacy["schemaVersion"] = serde_json::json!(1);
        legacy.as_object_mut().unwrap().remove("terminalHistory");
        *store.initial_replica_head.lock().unwrap() = Some(serde_json::to_vec(&legacy).unwrap());
        assert_eq!(
            owner
                .initial_replica_state()
                .unwrap()
                .bytes
                .unwrap()
                .as_slice(),
            b"v1-payload"
        );
        assert_eq!(
            std::fs::read(path.join("active-workspace").join(&selected.name)).unwrap(),
            original_file
        );
        owner
            .store_initial_replica_state(
                1,
                &scope(),
                b"v2-payload",
                InitialReplicaPhase::Installing,
            )
            .unwrap();
        let persisted: serde_json::Value =
            serde_json::from_slice(store.initial_replica_head.lock().unwrap().as_ref().unwrap())
                .unwrap();
        assert_eq!(persisted["schemaVersion"], 2);
        let mut missing = persisted;
        missing.as_object_mut().unwrap().remove("terminalHistory");
        assert!(decode_head(missing).is_err());
        legacy["terminalHistory"] = serde_json::json!([]);
        assert!(decode_head(legacy).is_err());
    }
    #[test]
    fn maximum_escaped_identifiers_fit_complete_history_pending_and_retired_head() {
        let make = |number: u64| StateFile {
            name: format!("initial-replica-{number:032x}.sealed"),
            identity: [u64::MAX, u64::MAX - number],
            revision: 9_007_199_254_740_980 + number,
            size: MAX_STATE as u64 + 16,
            digest: [255; 32],
            nonce: [255; 24],
            scope: InitialReplicaScope {
                installation: [255; 32],
                account: "\\".repeat(160),
                workspace: "\\".repeat(160),
                device: "\\".repeat(160),
                workflow: format!("{}{:02}", "\\".repeat(158), number),
            },
        };
        let mut current = make(10);
        current.scope.workflow = format!("{}10", "\\".repeat(158));
        let mut retired = make(9);
        retired.scope = current.scope.clone();
        let mut pending = make(11);
        pending.scope = current.scope.clone();
        let head = Head {
            schema_version: VERSION,
            database: [u64::MAX; 2],
            phase: InitialReplicaPhase::Installing,
            current: Some(current),
            retired: Some(retired),
            pending: Some(PendingFile::Reserved {
                file: pending,
                destination: InitialReplicaPhase::Installing,
                retain_current: false,
            }),
            terminal_history: (1..=8).map(make).collect(),
        };
        head.validate().unwrap();
        let size = serialize(&head).unwrap().len();
        assert_eq!(size, 21_101);
        assert!(size < MAX_HEAD, "worst supported head is {size} bytes");
        assert!(
            size < 32_768,
            "keep at least half the head budget available; actual {size}"
        );
    }
}
