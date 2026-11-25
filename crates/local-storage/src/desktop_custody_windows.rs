//! Windows Native custody for the existing `SQLCipher` business database owner.

#[path = "desktop_custody/authorization_floor.rs"]
mod authorization_floor;
#[path = "desktop_custody/forced_takeover_control.rs"]
mod forced_takeover_control;
#[path = "desktop_custody/initial_replica.rs"]
mod initial_replica;
#[path = "desktop_custody/target_bootstrap_control.rs"]
mod target_bootstrap_control;
pub(crate) use authorization_floor::{
    CommercialAuthorizationFloor, DeviceEvidenceFloor, ExecutionAnchorRecord,
    WorkspaceAuthorizationFloor, WorkspaceAuthorizationRecord,
};
pub(crate) use initial_replica::{InitialReplicaPhase, InitialReplicaScope, InitialReplicaState};

use crate::windows_custody::format::FileIdentity;
use crate::windows_private_files::{PinnedDirectory, file_identity};
use crate::{BusinessDatabase, BusinessDatabaseError, DesktopApplicationRoot, LocalDatabaseKey};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::sync::Mutex;
use zeroize::{Zeroize as _, Zeroizing};

const DATABASE_SERVICE: &str = "com.gooddealer.desktop.local-database";
const DATABASE_ACCOUNT: &str = "active-workspace-sqlcipher-v1";
const BINDING_SERVICE: &str = "com.gooddealer.desktop.local-host-binding";
const BINDING_ACCOUNT: &str = "local-host-binding-v1";
const AUTHORITY_SERVICE: &str = "com.gooddealer.desktop.workspace-authority-floor";
const AUTHORITY_ACCOUNT: &str = "verified-authority-floor-v1";
const HANDOFF_SERVICE: &str = "com.gooddealer.desktop.normal-handoff";
const HANDOFF_ACCOUNT: &str = "pending-signed-submission-v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopCustodyError {
    Unavailable,
    Rejected,
    RandomUnavailable,
    StorageRejected,
}

pub(crate) struct DesktopProductionCustody {
    _process_lock: File,
    root: PinnedDirectory,
    active: PinnedDirectory,
    database: File,
    identity: FileIdentity,
    key: LocalDatabaseKey,
    records: Mutex<()>,
    workspace_open: Mutex<()>,
}
impl DesktopProductionCustody {
    pub(crate) fn load_or_create(
        root: &DesktopApplicationRoot,
    ) -> Result<Self, DesktopCustodyError> {
        root.verify_identity()
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let root_path = root.runtime_lock_path();
        let root = PinnedDirectory::open(root_path.parent().ok_or(DesktopCustodyError::Rejected)?)
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let process_lock = open_or_create(&root, ".desktop-local-host.lock")?;
        process_lock
            .try_lock()
            .map_err(|_| DesktopCustodyError::Unavailable)?;
        let active = PinnedDirectory::open(&root.path().join("active-workspace"))
            .map_err(|_| DesktopCustodyError::Rejected)?;
        // Existing A/B recovery state needs its owning recovery admission; normal startup must
        // not accidentally reinterpret it as a fresh active workspace.
        for name in [
            "rebootstrap-a.db",
            "rebootstrap-b.db",
            "rebootstrap.journal",
        ] {
            if existing(&active, name)?.is_some() {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        for account in ["slot-a-sqlcipher-v1", "slot-b-sqlcipher-v1"] {
            if crate::windows_custody::exists("com.gooddealer.desktop.rebootstrap", account)
                .map_err(|_| DesktopCustodyError::Rejected)?
            {
                return Err(DesktopCustodyError::Rejected);
            }
        }
        let (database, key) = establish_database(&active)?;
        let identity = file_identity(&database).map_err(|_| DesktopCustodyError::Rejected)?;
        let custody = Self {
            _process_lock: process_lock,
            root,
            active,
            database,
            identity,
            key,
            records: Mutex::new(()),
            workspace_open: Mutex::new(()),
        };
        custody.verify()?;
        custody.initialize_replica_marker()?;
        Ok(custody)
    }
    fn verify(&self) -> Result<(), DesktopCustodyError> {
        self.root
            .verify()
            .and_then(|()| self.active.verify_business_sidecars())
            .map_err(|_| DesktopCustodyError::Rejected)?;
        let file = self
            .active
            .file("business.db", false, true)
            .map_err(|_| DesktopCustodyError::Rejected)?;
        if file_identity(&file).map_err(|_| DesktopCustodyError::Rejected)? != self.identity
            || file_identity(&self.database).map_err(|_| DesktopCustodyError::Rejected)?
                != self.identity
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(())
    }
    pub(crate) fn open_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<BusinessDatabase, BusinessDatabaseError> {
        self.initial_replica_begin_ordinary_open()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let database = self.open_initial_replica_database(workspace_id)?;
        self.initial_replica_finish_ordinary_open()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(database)
    }
    pub(crate) fn open_initial_replica_database(
        &self,
        workspace_id: &str,
    ) -> Result<BusinessDatabase, BusinessDatabaseError> {
        let _guard = self
            .workspace_open
            .lock()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        self.verify()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let database = BusinessDatabase::open(
            &self.active.path().join("business.db"),
            &self.key,
            workspace_id,
        )?;
        self.verify()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        self.mark_database_initialized()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(database)
    }
    fn mark_database_initialized(&self) -> Result<(), DesktopCustodyError> {
        let bytes = Zeroizing::new(
            load(DATABASE_SERVICE, DATABASE_ACCOUNT)?.ok_or(DesktopCustodyError::Rejected)?,
        );
        let mut record =
            DatabaseKeyRecord::decode(&bytes).map_err(|_| DesktopCustodyError::Rejected)?;
        if record.schema_version != 1
            || record.root_volume != self.active.identity().volume
            || record.root_index != self.active.identity().index
            || record.file_volume != Some(self.identity.volume)
            || record.file_index != Some(self.identity.index)
            || !self.key.matches_custody_bytes(
                &*record
                    .key_bytes()
                    .map_err(|_| DesktopCustodyError::Rejected)?,
            )
        {
            return Err(DesktopCustodyError::Rejected);
        }
        if !record.database_initialized {
            record.database_initialized = true;
            record.persist()?;
        }
        Ok(())
    }
    pub(crate) fn open_existing_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<BusinessDatabase>, BusinessDatabaseError> {
        let phase = self
            .initial_replica_state()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .phase;
        if matches!(
            phase,
            InitialReplicaPhase::Fresh
                | InitialReplicaPhase::Installing
                | InitialReplicaPhase::Installed
        ) {
            return Ok(None);
        }
        self.open_workspace(workspace_id).map(Some)
    }
    fn binding(&self) -> Result<DeviceBinding, DesktopCustodyError> {
        self.verify()?;
        let bytes = Zeroizing::new(
            load(BINDING_SERVICE, BINDING_ACCOUNT)?.ok_or(DesktopCustodyError::Unavailable)?,
        );
        if bytes.len() > 512 {
            return Err(DesktopCustodyError::Rejected);
        }
        let binding: DeviceBinding =
            serde_json::from_slice(&bytes).map_err(|_| DesktopCustodyError::Rejected)?;
        if binding.schema_version != 1 || !identifier(&binding.device_id) {
            return Err(DesktopCustodyError::Rejected);
        }
        binding.digest()?;
        Ok(binding)
    }
    pub(crate) fn load_device_id(&self) -> Result<String, DesktopCustodyError> {
        Ok(self.binding()?.device_id)
    }
    pub(crate) fn installation_binding_digest(&self) -> Result<[u8; 32], DesktopCustodyError> {
        self.binding()?.digest()
    }
    pub(crate) fn load_authorization_floor(
        &self,
    ) -> Result<Option<WorkspaceAuthorizationFloor>, DesktopCustodyError> {
        Ok(self.load_authorization_record()?.map(|record| record.floor))
    }
    pub(crate) fn store_authorization_floor(
        &self,
        floor: &WorkspaceAuthorizationFloor,
    ) -> Result<(), DesktopCustodyError> {
        let old = self.load_authorization_record()?;
        self.store_authorization_record(&WorkspaceAuthorizationRecord {
            schema_version: 4,
            floor: floor.clone(),
            device_evidence_floor: old.and_then(|value| value.device_evidence_floor),
            execution_anchor: None,
        })
    }
    pub(crate) fn load_authorization_record(
        &self,
    ) -> Result<Option<WorkspaceAuthorizationRecord>, DesktopCustodyError> {
        let _guard = self
            .records
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        self.authorization_record()
    }
    fn authorization_record(
        &self,
    ) -> Result<Option<WorkspaceAuthorizationRecord>, DesktopCustodyError> {
        // Windows custody atomically commits one reference and preserves its own first-use
        // marker. A missing established reference fails in load; a pending first write may
        // retry. A second authorization marker would introduce a permanent crash window.
        let Some(bytes) = load(AUTHORITY_SERVICE, AUTHORITY_ACCOUNT)? else {
            return Ok(None);
        };
        let bytes = Zeroizing::new(bytes);
        if bytes.is_empty() || bytes.len() > 65_536 {
            return Err(DesktopCustodyError::Rejected);
        }
        let record = authorization_floor::decode_persisted_record(&bytes)?;
        record.validate()?;
        if record.floor.installation_binding != self.installation_binding_digest()?
            || record.floor.device_id != self.load_device_id()?
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(Some(record))
    }
    pub(crate) fn store_authorization_record(
        &self,
        record: &WorkspaceAuthorizationRecord,
    ) -> Result<(), DesktopCustodyError> {
        let _guard = self
            .records
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        record.validate()?;
        if record.floor.installation_binding != self.installation_binding_digest()?
            || record.floor.device_id != self.load_device_id()?
        {
            return Err(DesktopCustodyError::Rejected);
        }
        let bytes =
            Zeroizing::new(serde_json::to_vec(record).map_err(|_| DesktopCustodyError::Rejected)?);
        if bytes.len() > 65_536 {
            return Err(DesktopCustodyError::Rejected);
        }
        self.authorization_record()?;
        store(AUTHORITY_SERVICE, AUTHORITY_ACCOUNT, &bytes)?;
        if self.authorization_record()?.as_ref() != Some(record) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }
    fn handoff(&self) -> Result<Option<Handoff>, DesktopCustodyError> {
        let Some(bytes) = load(HANDOFF_SERVICE, HANDOFF_ACCOUNT)? else {
            return Ok(None);
        };
        let bytes = Zeroizing::new(bytes);
        if bytes.len() > 90_000 {
            return Err(DesktopCustodyError::Rejected);
        }
        let record: Handoff =
            serde_json::from_slice(&bytes).map_err(|_| DesktopCustodyError::Rejected)?;
        if record.schema_version != 1
            || record.installation_binding != self.installation_binding_digest()?
            || record.device_id != self.load_device_id()?
            || !identifier(&record.request_id)
        {
            return Err(DesktopCustodyError::Rejected);
        }
        record.bytes()?;
        Ok(Some(record))
    }
    pub(crate) fn store_handoff_submission(
        &self,
        request_id: &str,
        submission: &[u8],
    ) -> Result<(), DesktopCustodyError> {
        if !identifier(request_id) || submission.is_empty() || submission.len() > 65_536 {
            return Err(DesktopCustodyError::Rejected);
        }
        let _guard = self
            .records
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if let Some(old) = self.handoff()?
            && old.request_id == request_id
        {
            return if old.bytes()?.as_slice() == submission {
                Ok(())
            } else {
                Err(DesktopCustodyError::Rejected)
            };
        }
        let record = Handoff {
            schema_version: 1,
            installation_binding: self.installation_binding_digest()?,
            device_id: self.load_device_id()?,
            request_id: request_id.to_owned(),
            submission: URL_SAFE_NO_PAD.encode(submission),
        };
        let bytes =
            Zeroizing::new(serde_json::to_vec(&record).map_err(|_| DesktopCustodyError::Rejected)?);
        if bytes.len() > 90_000 {
            return Err(DesktopCustodyError::Rejected);
        }
        store(HANDOFF_SERVICE, HANDOFF_ACCOUNT, &bytes)?;
        if self.handoff()?.is_none_or(|stored| {
            stored.request_id != request_id || stored.submission != record.submission
        }) {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }
    pub(crate) fn load_handoff_submission(
        &self,
        request_id: &str,
    ) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
        if !identifier(request_id) {
            return Err(DesktopCustodyError::Rejected);
        }
        let _guard = self
            .records
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let Some(record) = self.handoff()? else {
            return Ok(None);
        };
        if record.request_id != request_id {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(Some(record.bytes()?.to_vec()))
    }
    pub(crate) fn clear_handoff_submission(
        &self,
        request_id: &str,
    ) -> Result<(), DesktopCustodyError> {
        if !identifier(request_id) {
            return Err(DesktopCustodyError::Rejected);
        }
        let _guard = self
            .records
            .lock()
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if let Some(record) = self.handoff()?
            && record.request_id != request_id
        {
            return Err(DesktopCustodyError::Rejected);
        }
        crate::windows_custody::delete(HANDOFF_SERVICE, HANDOFF_ACCOUNT)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        if self.handoff()?.is_some() {
            return Err(DesktopCustodyError::StorageRejected);
        }
        Ok(())
    }
    #[allow(dead_code)]
    pub(crate) fn require_rebootstrap_reservation_capability(
        &self,
    ) -> Result<(), DesktopCustodyError> {
        // Recovery reservation has not yet been ported. An opened SQLCipher database does not
        // grant permission to replace it or bypass the existing publication transaction.
        self.verify()?;
        Err(DesktopCustodyError::Unavailable)
    }
}
#[path = "desktop_custody_windows/database_format.rs"]
mod database_format;
use database_format::{BoundFileAction, DatabaseKeyRecord};
impl DatabaseKeyRecord {
    fn key(&self) -> Result<LocalDatabaseKey, DesktopCustodyError> {
        Ok(LocalDatabaseKey::from_bytes(
            *self
                .key_bytes()
                .map_err(|_| DesktopCustodyError::Rejected)?,
        ))
    }
    fn persist(&self) -> Result<(), DesktopCustodyError> {
        let bytes =
            Zeroizing::new(serde_json::to_vec(self).map_err(|_| DesktopCustodyError::Rejected)?);
        store(DATABASE_SERVICE, DATABASE_ACCOUNT, &bytes)
    }
}

fn establish_database(
    active: &PinnedDirectory,
) -> Result<(File, LocalDatabaseKey), DesktopCustodyError> {
    let mut file = existing(active, "business.db")?;
    let mut record = match load(DATABASE_SERVICE, DATABASE_ACCOUNT)?.map(Zeroizing::new) {
        Some(bytes) => {
            DatabaseKeyRecord::decode(&bytes).map_err(|_| DesktopCustodyError::Rejected)?
        }
        None if file.is_none() => {
            let mut key = Zeroizing::new([0; 32]);
            let mut initialization = [0; 32];
            getrandom::fill(&mut *key)
                .and_then(|()| getrandom::fill(&mut initialization))
                .map_err(|_| DesktopCustodyError::RandomUnavailable)?;
            let record = DatabaseKeyRecord {
                schema_version: 1,
                root_volume: active.identity().volume,
                root_index: active.identity().index,
                initialization,
                key: URL_SAFE_NO_PAD.encode(*key),
                file_volume: None,
                file_index: None,
                database_initialized: false,
            };
            // This trusted pending record contains no initialized business database. It exists
            // before creation, so only this exact nonce may resume a partial initialization file.
            record.persist()?;
            record
        }
        None => return Err(DesktopCustodyError::Rejected),
    };
    record
        .validate(active.identity().volume, active.identity().index)
        .map_err(|_| DesktopCustodyError::Rejected)?;
    let key = record.key()?;
    let marker = record.marker();
    if record.file_index.is_none() {
        let file = match file.as_mut() {
            Some(file) => file,
            None => file.insert(
                active
                    .file("business.db", true, true)
                    .map_err(|_| DesktopCustodyError::StorageRejected)?,
            ),
        };
        let mut existing_marker = Vec::new();
        std::io::Read::by_ref(file)
            .take(marker.len() as u64 + 1)
            .read_to_end(&mut existing_marker)
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        record
            .admit_unbound_marker(&existing_marker)
            .map_err(|_| DesktopCustodyError::Rejected)?;
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.write_all(&marker))
            .and_then(|()| file.sync_all())
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
        let identity = file_identity(file).map_err(|_| DesktopCustodyError::Rejected)?;
        record.file_volume = Some(identity.volume);
        record.file_index = Some(identity.index);
        record.persist()?;
    }
    let mut file = file.ok_or(DesktopCustodyError::Rejected)?;
    let identity = file_identity(&file).map_err(|_| DesktopCustodyError::Rejected)?;
    let length = file
        .metadata()
        .map_err(|_| DesktopCustodyError::StorageRejected)?
        .len();
    file.seek(SeekFrom::Start(0))
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    let mut prefix = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(marker.len() as u64 + 1)
        .read_to_end(&mut prefix)
        .map_err(|_| DesktopCustodyError::StorageRejected)?;
    if record
        .bound_action(identity.volume, identity.index, length, &prefix)
        .map_err(|_| DesktopCustodyError::Rejected)?
        == BoundFileAction::TruncateMarker
    {
        file.set_len(0)
            .and_then(|()| file.sync_all())
            .map_err(|_| DesktopCustodyError::StorageRejected)?;
    }
    active.verify().map_err(|_| DesktopCustodyError::Rejected)?;
    Ok((file, key))
}

fn identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160 && value.bytes().all(|b| (0x21..=0x7e).contains(&b))
}
fn load(service: &str, account: &str) -> Result<Option<Vec<u8>>, DesktopCustodyError> {
    crate::windows_custody::load(service, account).map_err(|_| DesktopCustodyError::StorageRejected)
}
fn store(service: &str, account: &str, bytes: &[u8]) -> Result<(), DesktopCustodyError> {
    crate::windows_custody::store(service, account, bytes)
        .map_err(|_| DesktopCustodyError::StorageRejected)
}
fn existing(root: &PinnedDirectory, name: &str) -> Result<Option<File>, DesktopCustodyError> {
    match root.file(name, false, true) {
        Ok(file) => Ok(Some(file)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(DesktopCustodyError::Rejected),
    }
}
fn open_or_create(root: &PinnedDirectory, name: &str) -> Result<File, DesktopCustodyError> {
    if let Some(file) = existing(root, name)? {
        return Ok(file);
    }
    root.file(name, true, true)
        .map_err(|_| DesktopCustodyError::StorageRejected)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceBinding {
    schema_version: u8,
    device_id: String,
    installation_binding_digest: String,
}
impl DeviceBinding {
    fn digest(&self) -> Result<[u8; 32], DesktopCustodyError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(&self.installation_binding_digest)
            .map_err(|_| DesktopCustodyError::Rejected)?;
        if URL_SAFE_NO_PAD.encode(&bytes) != self.installation_binding_digest {
            return Err(DesktopCustodyError::Rejected);
        }
        bytes.try_into().map_err(|_| DesktopCustodyError::Rejected)
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Handoff {
    schema_version: u8,
    installation_binding: [u8; 32],
    device_id: String,
    request_id: String,
    submission: String,
}
impl Handoff {
    fn bytes(&self) -> Result<Zeroizing<Vec<u8>>, DesktopCustodyError> {
        let bytes = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(&self.submission)
                .map_err(|_| DesktopCustodyError::Rejected)?,
        );
        if bytes.is_empty()
            || bytes.len() > 65_536
            || URL_SAFE_NO_PAD.encode(&bytes) != self.submission
        {
            return Err(DesktopCustodyError::Rejected);
        }
        Ok(bytes)
    }
}
impl Drop for Handoff {
    fn drop(&mut self) {
        self.submission.zeroize();
    }
}

#[cfg(not(test))]
pub(crate) struct DesktopContinuityReceiptStore;
#[expect(
    clippy::unused_self,
    reason = "the fixed cross-target receipt-store port requires a receiver; the process custody owner holds lifetime admission"
)]
#[cfg(not(test))]
impl DesktopContinuityReceiptStore {
    pub(crate) fn load(&self, slot: u8) -> Result<Option<Zeroizing<Vec<u8>>>, DesktopCustodyError> {
        let account = receipt_account(slot)?;
        load("com.gooddealer.desktop.continuity-receipt", account)?
            .map(|bytes| {
                if bytes.is_empty() || bytes.len() > 4096 {
                    return Err(DesktopCustodyError::Rejected);
                }
                Ok(Zeroizing::new(bytes))
            })
            .transpose()
    }
    pub(crate) fn store(&self, slot: u8, sealed: &[u8]) -> Result<(), DesktopCustodyError> {
        if sealed.is_empty() || sealed.len() > 4096 {
            return Err(DesktopCustodyError::Rejected);
        }
        store(
            "com.gooddealer.desktop.continuity-receipt",
            receipt_account(slot)?,
            sealed,
        )
    }
    pub(crate) fn any_receipt(&self) -> Result<bool, DesktopCustodyError> {
        Ok(self.load(0)?.is_some() || self.load(1)?.is_some())
    }
}
#[cfg(not(test))]
fn receipt_account(slot: u8) -> Result<&'static str, DesktopCustodyError> {
    match slot {
        0 => Ok("receipt-a-v1"),
        1 => Ok("receipt-b-v1"),
        _ => Err(DesktopCustodyError::Rejected),
    }
}
