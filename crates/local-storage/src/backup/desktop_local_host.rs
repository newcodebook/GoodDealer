//! Closed Desktop backup aggregate.
//!
//! This is the only public backup boundary. All values capable of naming a database binding,
//! selecting a native file, asserting authority, or carrying backup plaintext remain private to
//! this crate. Production backup stays unavailable until the native handle journal, independent
//! rollback anchor, and signed-authority verifier are composed here.

use std::fmt;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use sha2::{Digest, Sha256};

use super::super::desktop_custody::DesktopProductionCustody;
#[cfg(test)]
use super::super::desktop_custody::{
    TestRebootstrapCrashBoundary, TestRebootstrapKeyStore, TestRebootstrapQuarantineCustody,
    TestRebootstrapRecoveryCustody, TestRebootstrapStoreHostileCase,
    rebootstrap_inspection_snapshot_for_test, reset_rebootstrap_inspection_for_test,
};
use super::authority::{
    BackupAuthorityReplacementFloor, BackupAuthorityVerifier, TrustedBackupBinding,
    VerifiedBackupAuthority,
};
use super::container::{BackupContainerError, BackupContainerHost, ExportRequest};
use super::continuity::{BarrierReason, ContinuityManager, VerifiedLocalContinuation};
#[cfg(test)]
use super::continuity::{ContinuityBinding, ContinuityReceiptV1, ReceiptState, StartupContinuity};
use super::source::IsolatedBackupCandidate;
use crate::BusinessDatabase;
use crate::desktop_business_runtime::DesktopBusinessRuntime;
use crate::desktop_business_runtime::{
    BusinessMutationContext, DesktopAssetLibraryReadRequest, DesktopConflictCenterView,
    DesktopConflictResolveRequest, DesktopDomainAssetDeleteRequest, DesktopDomainAssetEditRequest,
    DesktopDomainAssetProviderBindingReceipt, DesktopDomainAssetProviderBindingRequest,
    DesktopDomainDetailReadRequest,
};
use crate::desktop_sync_runtime::{
    DesktopSyncCommitGuard, DesktopSyncError, DesktopSyncRejectBatch, DesktopSyncRejectDisposition,
    DesktopSyncRunAdmission, DesktopSyncRuntime,
};
#[cfg(test)]
use crate::rebootstrap_runtime::{
    RebootstrapCheckpoint, RebootstrapPlan, RebootstrapRuntime, RebootstrapSlot,
    RecoveryDisposition, StartupRebootstrapAction,
};
use crate::{BusinessDatabaseError, DesktopApplicationRoot};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopLocalHostError {
    ApplicationRootRejected,
    StorageRejected,
    AuthorityRejected,
    CloudProtocolRejected,
    Unavailable,
}

impl fmt::Display for DesktopLocalHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ApplicationRootRejected => "DESKTOP_APPLICATION_ROOT_REJECTED",
            Self::StorageRejected => "DESKTOP_LOCAL_HOST_STORAGE_REJECTED",
            Self::AuthorityRejected => "DESKTOP_LOCAL_HOST_AUTHORITY_REJECTED",
            Self::CloudProtocolRejected => "DESKTOP_CLOUD_PROTOCOL_REJECTED",
            Self::Unavailable => "DESKTOP_LOCAL_HOST_UNAVAILABLE",
        })
    }
}

impl std::error::Error for DesktopLocalHostError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopHostAuthorizationStatus {
    ActivationRequired,
    RetryableLocked,
    SecurityLocked,
    Authorized,
    Continuation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopLocalBusinessState {
    ActivationRequired,
    SecurityLocked,
    RetryableLocked,
    CommercialReadOnly,
    Active,
}

/// Durable boundaries at which the private rebootstrap fixture may model process death.
///
/// This is deliberately test-only: production cannot select a protocol phase or enable the
/// rebootstrap capability. Returning at one of these boundaries drops every in-memory linear
/// capability, exactly as a process crash would.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RebootstrapCrashBoundary {
    ReservationCreated,
    Prepared,
    CandidateCreated,
    CandidateReserved,
    CandidateMutated,
    Verified,
    CancelCandidateFileUnlinked,
    CancelCandidateSlotDeleted,
    CancelAliasRepaired,
    CancelOldSlotDeleted,
    PublishIntentPreExchange,
    ExchangeBeforeDirectoryFsync,
    AliasRepairBeforePublished,
    PublishIntentPostExchange,
    Published,
    ReopenProofFailure,
    ReopenedBeforeConfirmation,
    ReopenedVerified,
    OldFileUnlinked,
    OldSlotDeleted,
    RetiredOldJournalAppendFailure,
    RetiredOld,
    Completed,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RebootstrapRestartDisposition {
    CleanValidated,
    CancelledUnpublished,
    ResumedPublished,
    TerminalValidated,
    Quarantined,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLocalBusinessStatus {
    schema_version: u8,
    state: DesktopLocalBusinessState,
    capabilities: Vec<&'static str>,
    read_generation: u64,
}

const MAX_REQUEST_WIRE_BYTES: usize = 4_096;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const OPAQUE_IDENTIFIER_MIN_BYTES: usize = 16;
const OPAQUE_IDENTIFIER_MAX_BYTES: usize = 128;
const REQUIRED_CONFIRMATION: &str = "RESTORE LOCAL BACKUP";

/// Closed backup failures suitable for an IPC boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum DesktopBackupError {
    #[serde(rename = "BACKUP_ARTIFACT_REJECTED")]
    ArtifactRejected,
    #[serde(rename = "BACKUP_KEY_UNAVAILABLE")]
    KeyUnavailable,
    #[serde(rename = "BACKUP_CREDENTIALS_NOT_ALLOWED")]
    CredentialsNotAllowed,
    #[serde(rename = "BACKUP_AUTHORITY_REJECTED")]
    AuthorityRejected,
    #[serde(rename = "BACKUP_OPERATION_REJECTED")]
    OperationRejected,
    #[serde(rename = "BACKUP_CONFLICT_REJECTED")]
    ConflictRejected,
    #[serde(rename = "BACKUP_STORAGE_REJECTED")]
    StorageRejected,
}

impl DesktopBackupError {
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::ArtifactRejected => "BACKUP_ARTIFACT_REJECTED",
            Self::KeyUnavailable => "BACKUP_KEY_UNAVAILABLE",
            Self::CredentialsNotAllowed => "BACKUP_CREDENTIALS_NOT_ALLOWED",
            Self::AuthorityRejected => "BACKUP_AUTHORITY_REJECTED",
            Self::OperationRejected => "BACKUP_OPERATION_REJECTED",
            Self::ConflictRejected => "BACKUP_CONFLICT_REJECTED",
            Self::StorageRejected => "BACKUP_STORAGE_REJECTED",
        }
    }
}

impl fmt::Display for DesktopBackupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for DesktopBackupError {}

/// Redacted result of a completed export publication.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBackupExportStatus {
    schema_version: u8,
    kind: &'static str,
    state: &'static str,
}

impl DesktopBackupExportStatus {
    const fn completed() -> Self {
        Self {
            schema_version: 1,
            kind: "local_backup_export_status",
            state: "completed",
        }
    }
}

/// Non-secret metadata returned only after complete artifact authentication.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopVerifiedBackupArtifact {
    state: &'static str,
    artifact_id: String,
    created_at: String,
    backup_schema_version: u64,
    compatibility: &'static str,
    #[serde(rename = "restoreAdmission")]
    restore_admission: RestoreAdmission,
}

impl fmt::Display for DesktopVerifiedBackupArtifact {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopVerifiedBackupArtifact([REDACTED])")
    }
}

/// Renderer-safe snapshot of the complete backup/restore workflow.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBackupRestoreStatus {
    schema_version: u8,
    kind: &'static str,
    authority: &'static str,
    export_admission: ActionAdmission,
    artifact_selection_admission: ActionAdmission,
    selected_artifact: SelectedArtifactView,
    error: Option<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[allow(
    dead_code,
    reason = "available admissions remain unreachable until qualified native adapters are composed"
)]
enum ActionAdmission {
    Unavailable,
    Available {
        #[serde(rename = "operationId")]
        operation_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[allow(
    dead_code,
    reason = "artifact states remain unreachable until qualified native adapters are composed"
)]
enum SelectedArtifactView {
    None,
    Inspecting,
    Rejected {
        error: &'static str,
    },
    Verified {
        #[serde(rename = "artifactId")]
        artifact_id: String,
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "backupSchemaVersion")]
        backup_schema_version: u64,
        compatibility: &'static str,
        #[serde(rename = "restoreAdmission")]
        restore_admission: RestoreAdmission,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[allow(
    dead_code,
    reason = "restore admission remains unreachable until qualified native adapters are composed"
)]
enum RestoreAdmission {
    Unavailable,
    Available {
        #[serde(rename = "operationId")]
        operation_id: String,
        #[serde(rename = "dialogId")]
        dialog_id: String,
        #[serde(rename = "expectedCurrentRevision")]
        expected_current_revision: u64,
        #[serde(rename = "candidateSetVersion")]
        candidate_set_version: u64,
    },
}

impl DesktopBackupRestoreStatus {
    const fn unavailable(error: Option<&'static str>) -> Self {
        Self {
            schema_version: 1,
            kind: "local_backup_restore_status",
            authority: "unavailable",
            export_admission: ActionAdmission::Unavailable,
            artifact_selection_admission: ActionAdmission::Unavailable,
            selected_artifact: SelectedArtifactView::None,
            error,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupExportRequest {
    schema_version: u8,
    operation_id: String,
    include_platform_credentials: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupArtifactSelectRequest {
    schema_version: u8,
    operation_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupRestoreRequest {
    schema_version: u8,
    operation_id: String,
    dialog_id: String,
    artifact_id: String,
    expected_current_revision: u64,
    candidate_set_version: u64,
    confirmation: String,
}

#[derive(Default)]
struct BackupOperationState {
    export_operation_id: Option<String>,
    export_consumed: bool,
    selection_operation_id: Option<String>,
    selection_consumed: bool,
    selected_handle: Option<AdmittedBackupHandle>,
    selected_artifact: Option<DesktopVerifiedBackupArtifact>,
    selected_authority_generation: Option<u64>,
    selected_authority_digest: Option<[u8; 32]>,
    generation: u64,
}

#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "read only by the private development native composition"
    )
)]
struct AdmittedBackupHandle {
    token: String,
    identity: NativeFileIdentity,
    size: u64,
    digest: [u8; 32],
    #[cfg(test)]
    file: std::fs::File,
}

impl fmt::Debug for AdmittedBackupHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AdmittedBackupHandle([OPAQUE])")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct NativeFileIdentity {
    len: u64,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    uid: u32,
    #[cfg(unix)]
    mode: u32,
    #[cfg(unix)]
    nlink: u64,
}

enum NativeBackupComposition {
    Unavailable,
    #[cfg(test)]
    Development(DevelopmentNativeBackup),
}

impl NativeBackupComposition {
    const fn is_qualified(&self) -> bool {
        match self {
            Self::Unavailable => false,
            #[cfg(test)]
            Self::Development(_) => true,
        }
    }

    fn stage_publication(
        &mut self,
        operation_id: &str,
        artifact: &[u8],
    ) -> Result<StagedPublication, DesktopBackupError> {
        match self {
            Self::Unavailable => {
                let _ = (operation_id, artifact);
                Err(DesktopBackupError::StorageRejected)
            }
            #[cfg(test)]
            Self::Development(native) => native.stage_publication(operation_id, artifact),
        }
    }

    fn mark_available(&mut self, staged: &StagedPublication) -> Result<(), DesktopBackupError> {
        match self {
            Self::Unavailable => {
                let _ = staged;
                Err(DesktopBackupError::StorageRejected)
            }
            #[cfg(test)]
            Self::Development(native) => native.mark_available(staged),
        }
    }

    fn select(&self) -> Result<AdmittedBackupHandle, DesktopBackupError> {
        match self {
            Self::Unavailable => Err(DesktopBackupError::StorageRejected),
            #[cfg(test)]
            Self::Development(native) => native.select(),
        }
    }

    fn read(&self, handle: &AdmittedBackupHandle) -> Result<Vec<u8>, DesktopBackupError> {
        match self {
            Self::Unavailable => {
                let _ = handle;
                Err(DesktopBackupError::StorageRejected)
            }
            #[cfg(test)]
            Self::Development(native) => native.read(handle),
        }
    }

    fn quarantine(&mut self, staged: &StagedPublication) {
        match self {
            Self::Unavailable => {
                let _ = staged;
            }
            #[cfg(test)]
            Self::Development(native) => native.quarantine(staged),
        }
    }
}

#[cfg_attr(
    not(test),
    allow(dead_code, reason = "read only by the private development journal")
)]
struct StagedPublication {
    token: String,
}

#[cfg(test)]
struct DevelopmentNativeBackup {
    root: std::path::PathBuf,
    available: Vec<String>,
}

#[cfg(test)]
impl DevelopmentNativeBackup {
    fn new(root: std::path::PathBuf) -> Result<Self, DesktopBackupError> {
        std::fs::create_dir_all(&root).map_err(|_| DesktopBackupError::StorageRejected)?;
        let mut native = Self {
            root,
            available: Vec::new(),
        };
        native.recover()?;
        Ok(native)
    }

    fn stage_publication(
        &mut self,
        operation_id: &str,
        artifact: &[u8],
    ) -> Result<StagedPublication, DesktopBackupError> {
        use std::fs::OpenOptions;
        use std::io::Write as _;
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt as _;

        if artifact.len() > super::container::ARTIFACT_BYTE_LIMIT {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let temporary_name = format!(".{operation_id}.writing");
        let available_name = format!("{operation_id}.gdbk");
        let temporary_path = self.root.join(&temporary_name);
        let available_path = self.root.join(&available_name);
        self.persist_journal(operation_id, "reserved")?;
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        let mut file = options
            .open(&temporary_path)
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        self.persist_journal(operation_id, "writing")?;
        let result = (|| {
            file.write_all(artifact)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            file.sync_all()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            self.persist_journal(operation_id, "fsynced")?;
            // Creating the final link is atomic and fails if the destination already exists.
            // Removing the staging name immediately restores the admitted link count to one.
            std::fs::hard_link(&temporary_path, &available_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            std::fs::remove_file(&temporary_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            std::fs::File::open(&self.root)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            self.persist_journal(operation_id, "renamed")?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = std::fs::remove_file(&temporary_path);
            let _ = std::fs::remove_file(&available_path);
            let _ = self.persist_journal(operation_id, "quarantined");
            return Err(error);
        }
        Ok(StagedPublication {
            token: operation_id.to_owned(),
        })
    }

    fn mark_available(&mut self, staged: &StagedPublication) -> Result<(), DesktopBackupError> {
        self.persist_journal(&staged.token, "catalog_available")?;
        self.available.push(format!("{}.gdbk", staged.token));
        Ok(())
    }

    fn select(&self) -> Result<AdmittedBackupHandle, DesktopBackupError> {
        self.select_with_hooks(|_| {}, |_, _| {})
    }

    #[cfg(test)]
    fn select_with_hooks<Before, After>(
        &self,
        before_open: Before,
        after_open: After,
    ) -> Result<AdmittedBackupHandle, DesktopBackupError>
    where
        Before: FnOnce(&std::path::Path),
        After: FnOnce(&std::fs::File, &std::path::Path),
    {
        let token = self
            .available
            .last()
            .ok_or(DesktopBackupError::StorageRejected)?
            .clone();
        let path = self.root.join(&token);
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&metadata)?;
        let size = metadata.len();
        if size > super::container::ARTIFACT_BYTE_LIMIT as u64 {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        before_open(&path);
        let file = open_native_read(&path)?;
        // Path admission and the opened handle must describe the same inode.  This closes the
        // stat/open replacement window; the handle, not a later path lookup, is authoritative.
        let opened_metadata = file
            .metadata()
            .map_err(|_| DesktopBackupError::ArtifactRejected)?;
        after_open(&file, &path);
        validate_native_metadata(&opened_metadata)?;
        if native_file_identity(&opened_metadata) != native_file_identity(&metadata)
            || opened_metadata.len() != size
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let bytes = read_native_file(&file, size)?;
        if bytes.len() as u64 != size {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        Ok(AdmittedBackupHandle {
            token,
            identity: native_file_identity(&opened_metadata),
            size,
            digest: Sha256::digest(&bytes).into(),
            file,
        })
    }

    fn read(&self, handle: &AdmittedBackupHandle) -> Result<Vec<u8>, DesktopBackupError> {
        let path = self.root.join(&handle.token);
        let before =
            std::fs::symlink_metadata(&path).map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&before)?;
        if native_file_identity(&before) != handle.identity
            || before.len() != handle.size
            || before.len() > super::container::ARTIFACT_BYTE_LIMIT as u64
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let retained_before = handle
            .file
            .metadata()
            .map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&retained_before)?;
        if native_file_identity(&retained_before) != handle.identity
            || retained_before.len() != handle.size
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let bytes = read_native_file(&handle.file, handle.size)?;
        let retained_after = handle
            .file
            .metadata()
            .map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&retained_after)?;
        if native_file_identity(&retained_after) != handle.identity
            || retained_after.len() != handle.size
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        let after =
            std::fs::symlink_metadata(&path).map_err(|_| DesktopBackupError::ArtifactRejected)?;
        validate_native_metadata(&after)?;
        if native_file_identity(&after) != handle.identity
            || after.len() != handle.size
            || bytes.len() as u64 != handle.size
            || <[u8; 32]>::from(Sha256::digest(&bytes)) != handle.digest
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
        Ok(bytes)
    }

    fn quarantine(&mut self, staged: &StagedPublication) {
        let available_name = format!("{}.gdbk", staged.token);
        self.available.retain(|value| value != &available_name);
        let _ = std::fs::remove_file(self.root.join(available_name));
        let _ = std::fs::remove_file(self.root.join(format!(".{}.writing", staged.token)));
        let _ = self.persist_journal(&staged.token, "quarantined");
    }

    fn persist_journal(&self, token: &str, state: &str) -> Result<(), DesktopBackupError> {
        use std::io::Write as _;

        if !valid_opaque_identifier(token)
            || !matches!(
                state,
                "reserved"
                    | "writing"
                    | "fsynced"
                    | "renamed"
                    | "catalog_available"
                    | "quarantined"
            )
        {
            return Err(DesktopBackupError::StorageRejected);
        }
        // Replace through a private, create-new staging file.  `rename` replaces a malicious
        // symlink itself rather than following it, while the no-follow open protects the staging
        // handle.  The directory fsync below makes the replacement durable.
        let path = self.root.join(format!("{token}.journal"));
        let temporary_path = self.root.join(format!(".{token}.journal.tmp"));
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options
                .mode(0o600)
                .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        }
        let result = (|| {
            let mut file = options
                .open(&temporary_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            file.write_all(state.as_bytes())
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            file.sync_all()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let metadata = file
                .metadata()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&metadata).map_err(|_| DesktopBackupError::StorageRejected)?;
            if metadata.len() != state.len() as u64 {
                return Err(DesktopBackupError::StorageRejected);
            }
            let staged_path_metadata = std::fs::symlink_metadata(&temporary_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&staged_path_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&staged_path_metadata) != native_file_identity(&metadata) {
                return Err(DesktopBackupError::StorageRejected);
            }
            std::fs::rename(&temporary_path, &path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let published_path_metadata = std::fs::symlink_metadata(&path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&published_path_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&published_path_metadata) != native_file_identity(&metadata) {
                return Err(DesktopBackupError::StorageRejected);
            }
            std::fs::File::open(&self.root)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| DesktopBackupError::StorageRejected)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary_path);
        }
        result
    }

    fn recover(&mut self) -> Result<(), DesktopBackupError> {
        for entry in
            std::fs::read_dir(&self.root).map_err(|_| DesktopBackupError::StorageRejected)?
        {
            let entry = entry.map_err(|_| DesktopBackupError::StorageRejected)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if let Some(token) = name
                .strip_prefix('.')
                .and_then(|value| value.strip_suffix(".journal.tmp"))
            {
                if valid_opaque_identifier(token) {
                    // An interrupted atomic replacement leaves only this private staging name.
                    // It contains no trusted state and is safe to unlink without following it.
                    let _ = std::fs::remove_file(entry.path());
                }
                continue;
            }
            let Some(token) = name.strip_suffix(".journal") else {
                continue;
            };
            if !valid_opaque_identifier(token) {
                continue;
            }
            let journal_path = entry.path();
            let journal_metadata = std::fs::symlink_metadata(&journal_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&journal_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if journal_metadata.len() > 64 {
                return Err(DesktopBackupError::StorageRejected);
            }
            let journal_file =
                open_native_read(&journal_path).map_err(|_| DesktopBackupError::StorageRejected)?;
            let opened_metadata = journal_file
                .metadata()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&opened_metadata)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&opened_metadata) != native_file_identity(&journal_metadata)
                || opened_metadata.len() != journal_metadata.len()
            {
                return Err(DesktopBackupError::StorageRejected);
            }
            let state_bytes = read_bounded_journal(&journal_file, journal_metadata.len())
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let retained_after = journal_file
                .metadata()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&retained_after)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let path_after = std::fs::symlink_metadata(&journal_path)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            validate_native_metadata(&path_after)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            if native_file_identity(&retained_after) != native_file_identity(&opened_metadata)
                || native_file_identity(&path_after) != native_file_identity(&opened_metadata)
            {
                return Err(DesktopBackupError::StorageRejected);
            }
            let state = std::str::from_utf8(&state_bytes)
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            let available_name = format!("{token}.gdbk");
            if state == "catalog_available" {
                let metadata = std::fs::symlink_metadata(self.root.join(&available_name))
                    .map_err(|_| DesktopBackupError::StorageRejected)?;
                validate_native_metadata(&metadata)?;
                self.available.push(available_name);
            } else {
                let _ = std::fs::remove_file(self.root.join(&available_name));
                let _ = std::fs::remove_file(self.root.join(format!(".{token}.writing")));
                self.persist_journal(token, "quarantined")?;
            }
        }
        self.available.sort();
        Ok(())
    }
}

#[cfg(test)]
fn open_native_read(path: &std::path::Path) -> Result<std::fs::File, DesktopBackupError> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    options
        .open(path)
        .map_err(|_| DesktopBackupError::ArtifactRejected)
}

#[cfg(test)]
fn read_native_file(
    file: &std::fs::File,
    expected_size: u64,
) -> Result<Vec<u8>, DesktopBackupError> {
    use std::io::{Read as _, Seek as _, SeekFrom};

    if expected_size > super::container::ARTIFACT_BYTE_LIMIT as u64 {
        return Err(DesktopBackupError::ArtifactRejected);
    }
    let length =
        usize::try_from(expected_size).map_err(|_| DesktopBackupError::ArtifactRejected)?;
    let mut reader = file
        .try_clone()
        .map_err(|_| DesktopBackupError::ArtifactRejected)?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| DesktopBackupError::ArtifactRejected)?;
    let mut bytes = Vec::with_capacity(length);
    reader
        .take(expected_size.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopBackupError::ArtifactRejected)?;
    if bytes.len() != length {
        return Err(DesktopBackupError::ArtifactRejected);
    }
    Ok(bytes)
}

#[cfg(test)]
fn read_bounded_journal(
    file: &std::fs::File,
    expected_size: u64,
) -> Result<Vec<u8>, DesktopBackupError> {
    const JOURNAL_BYTE_LIMIT: u64 = 64;
    if expected_size > JOURNAL_BYTE_LIMIT {
        return Err(DesktopBackupError::StorageRejected);
    }
    read_native_file(file, expected_size)
}

#[cfg(test)]
fn validate_native_metadata(metadata: &std::fs::Metadata) -> Result<(), DesktopBackupError> {
    if !metadata.file_type().is_file() {
        return Err(DesktopBackupError::ArtifactRejected);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        if metadata.nlink() != 1
            || metadata.mode() & 0o7777 != 0o600
            || metadata.uid() != rustix::process::geteuid().as_raw()
        {
            return Err(DesktopBackupError::ArtifactRejected);
        }
    }
    Ok(())
}

#[cfg(test)]
fn native_file_identity(metadata: &std::fs::Metadata) -> NativeFileIdentity {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        NativeFileIdentity {
            len: metadata.len(),
            device: metadata.dev(),
            inode: metadata.ino(),
            uid: metadata.uid(),
            mode: metadata.mode() & 0o777,
            nlink: metadata.nlink(),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        NativeFileIdentity {
            len: metadata.len(),
        }
    }
}

struct BackupAuthorityPublicationState {
    native: NativeBackupComposition,
    authority: Option<PrivateBackupAuthority>,
    container: Option<BackupContainerHost>,
    applied_authority_epoch: u64,
    restriction: RuntimeRestriction,
    continuity: Option<ContinuityManager>,
    verified_continuation: Option<VerifiedLocalContinuation>,
}

/// Single mutex owner for the authoritative business database and its sync coordinator. Keeping
/// both in one state prevents a writer/sync lock inversion while authority transitions fence the
/// state atomically.
struct DesktopRuntimeState {
    business: DesktopBusinessRuntime,
    sync: Option<DesktopSyncRuntime>,
}

#[derive(Clone, Copy)]
struct DesktopStatusSnapshot {
    authorization: DesktopHostAuthorizationStatus,
    business: DesktopLocalBusinessState,
    read_generation: u64,
}

impl DesktopStatusSnapshot {
    const fn security_locked(read_generation: u64) -> Self {
        Self {
            authorization: DesktopHostAuthorizationStatus::SecurityLocked,
            business: DesktopLocalBusinessState::SecurityLocked,
            read_generation,
        }
    }
}

impl Default for BackupAuthorityPublicationState {
    fn default() -> Self {
        Self {
            native: NativeBackupComposition::Unavailable,
            authority: None,
            container: None,
            applied_authority_epoch: 0,
            restriction: RuntimeRestriction::ActivationRequired,
            continuity: None,
            verified_continuation: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeRestriction {
    ActivationRequired,
    Active,
    CommercialReadOnly,
    RetryableLocked,
    SecurityLocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(
    dead_code,
    reason = "authority activation is added only with the qualified signed-wire verifier"
)]
enum BackupAuthorityKind {
    Active,
    VerifiedLocalContinuation,
    Unavailable,
}

impl BackupAuthorityKind {
    const fn wire(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::VerifiedLocalContinuation => "verified_local_continuation",
            Self::Unavailable => "unavailable",
        }
    }

    const fn can_export_or_inspect(self) -> bool {
        matches!(self, Self::Active | Self::VerifiedLocalContinuation)
    }
}

struct PrivateBackupAuthority {
    kind: BackupAuthorityKind,
    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "used when production signed authority is composed"
        )
    )]
    account_id: String,
    workspace_id: String,
    device_id: String,
    lease_epoch: u64,
    account_security_epoch: u64,
    entitlement_revision: u64,
    entitlement_projection_digest: String,
    commercial_expires_at: String,
    capability: String,
    generation: u64,
    trusted_time_floor: i64,
    execute_before: i64,
    digest: [u8; 32],
}

impl fmt::Debug for PrivateBackupAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PrivateBackupAuthority([REDACTED])")
    }
}

impl PrivateBackupAuthority {
    fn from_verified(authority: &VerifiedBackupAuthority, generation: u64) -> Self {
        let snapshot_digest = authority.snapshot_digest_hex();
        let mut digest = [0_u8; 32];
        for (index, chunk) in snapshot_digest.as_bytes().chunks_exact(2).enumerate() {
            digest[index] = (hex_nibble(chunk[0]) << 4) | hex_nibble(chunk[1]);
        }
        Self {
            kind: BackupAuthorityKind::Active,
            account_id: authority.account_id().to_owned(),
            workspace_id: authority.workspace_id().to_owned(),
            device_id: authority.device_id().to_owned(),
            lease_epoch: authority.lease_epoch(),
            account_security_epoch: authority.account_security_epoch(),
            entitlement_revision: authority.entitlement_revision(),
            entitlement_projection_digest: authority.entitlement_projection_digest().to_owned(),
            commercial_expires_at: authority.commercial_expires_at().to_owned(),
            capability: authority.capability().to_owned(),
            generation,
            trusted_time_floor: authority.trusted_time_floor(),
            execute_before: authority.execute_before(),
            digest,
        }
    }

    fn can_replace_with(&self, replacement: &VerifiedBackupAuthority) -> bool {
        replacement.can_replace_floor(&BackupAuthorityReplacementFloor {
            workspace_id: &self.workspace_id,
            account_id: &self.account_id,
            device_id: &self.device_id,
            account_security_epoch: self.account_security_epoch,
            lease_epoch: self.lease_epoch,
            entitlement_revision: self.entitlement_revision,
            entitlement_projection_digest: &self.entitlement_projection_digest,
            commercial_expires_at: &self.commercial_expires_at,
            capability: &self.capability,
        })
    }

    fn is_current_at(&self, now: i64) -> bool {
        self.generation != 0 && now >= self.trusted_time_floor && now < self.execute_before
    }

    #[cfg(test)]
    fn binding(&self) -> super::container::BindingDigests {
        let account = digest_component(b"account", self.account_id.as_bytes());
        let device = digest_component(b"device", self.device_id.as_bytes());
        let workspace = digest_component(b"workspace", self.workspace_id.as_bytes());
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/GDBK-BINDING-V1\0");
        digest.update(account);
        digest.update(device);
        digest.update(workspace);
        super::container::BindingDigests::new(account, device, workspace, digest.finalize().into())
    }
}

/// Synchronous owner of the Desktop database writer and the complete private backup pipeline.
///
/// The production constructor deliberately starts closed. Native file handles, independent
/// rollback-anchor persistence, and signed backup authority must all be installed inside this
/// crate before any operation can become available.
pub struct DesktopLocalHost {
    #[allow(
        dead_code,
        reason = "keeps the validated native root owned by the aggregate"
    )]
    application_root: Option<DesktopApplicationRoot>,
    #[allow(
        dead_code,
        reason = "production custody is retained for future qualified native composition"
    )]
    production_custody: Option<Mutex<DesktopProductionCustody>>,
    authority_verifier: Option<BackupAuthorityVerifier>,
    /// Published before any authority transition waits for the operation lock.
    transition_requested_epoch: AtomicU64,
    /// Lock order begins here for every backup selection or operation.
    operation_selection: Mutex<BackupOperationState>,
    /// Authority and publication are fenced while the operation lock is held.
    authority_publication: Mutex<BackupAuthorityPublicationState>,
    /// The aggregate, not Desktop composition, owns the database and sync coordinator together.
    runtime_state: Mutex<Option<DesktopRuntimeState>>,
    /// Private crash-recovery state machine. It never owns a database, path, key, or writer.
    #[cfg(test)]
    rebootstrap_runtime: Option<RebootstrapRuntime>,
    #[cfg(test)]
    rebootstrap_quarantine_custody: Option<TestRebootstrapQuarantineCustody>,
    #[cfg(test)]
    rebootstrap_test_executor_enabled: bool,
    #[cfg(test)]
    development_installation_binding: Option<[u8; 32]>,
    #[cfg(test)]
    business_commit_transition_epoch: AtomicU64,
    #[cfg(test)]
    restore_precommit_transition_epoch: AtomicU64,
    #[cfg(test)]
    restore_postcommit_transition_epoch: AtomicU64,
}

impl fmt::Debug for DesktopLocalHost {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopLocalHost([REDACTED])")
    }
}

impl Default for DesktopLocalHost {
    fn default() -> Self {
        Self::production_unavailable()
    }
}

fn recovery_observation(
    plan: &crate::DesktopCloudflareKeychainPlanData,
    comparison: crate::DesktopCloudflareCustodyComparison,
) -> crate::CloudflareCredentialRecoveryObservation {
    match comparison {
        crate::DesktopCloudflareCustodyComparison::ExactTarget => {
            crate::CloudflareCredentialRecoveryObservation::Canonical(plan.target.clone())
        }
        crate::DesktopCloudflareCustodyComparison::ExactBase => {
            if plan.expected_base.kind == crate::CloudflareCredentialEnvelopeKind::Absent {
                crate::CloudflareCredentialRecoveryObservation::Missing
            } else {
                crate::CloudflareCredentialRecoveryObservation::Canonical(
                    plan.expected_base.clone(),
                )
            }
        }
        crate::DesktopCloudflareCustodyComparison::MissingOther => {
            crate::CloudflareCredentialRecoveryObservation::Missing
        }
        crate::DesktopCloudflareCustodyComparison::OtherCanonical
        | crate::DesktopCloudflareCustodyComparison::Malformed => {
            crate::CloudflareCredentialRecoveryObservation::Malformed
        }
        crate::DesktopCloudflareCustodyComparison::Unavailable => {
            crate::CloudflareCredentialRecoveryObservation::Unreadable
        }
    }
}

const fn desktop_cloudflare_resolution(
    resolution: crate::CloudflareCredentialResolution,
) -> crate::DesktopCloudflareResolution {
    match resolution {
        crate::CloudflareCredentialResolution::Confirmed => {
            crate::DesktopCloudflareResolution::Confirmed
        }
        crate::CloudflareCredentialResolution::TargetNotObservedBurned => {
            crate::DesktopCloudflareResolution::TargetNotObservedBurned
        }
        crate::CloudflareCredentialResolution::TargetPresentAuthorityStaleBurned => {
            crate::DesktopCloudflareResolution::TargetPresentAuthorityStaleBurned
        }
        crate::CloudflareCredentialResolution::RecoveryRequired => {
            crate::DesktopCloudflareResolution::RecoveryRequired
        }
    }
}

impl DesktopLocalHost {
    /// Admits Cloudflare activation before native secret capture or Provider I/O.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, a non-Cloudflare/non-DNS relation, or any live denied credential
    /// transition for the connection.
    pub fn begin_cloudflare_activation(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
        connection_hint: &str,
    ) -> Result<crate::DesktopCloudflareActivationAdmission, DesktopLocalHostError> {
        self.with_sync_runtime(Some(&admission.inner), |sync, database, admitted| {
            sync.admit_cloudflare_activation(
                database,
                admitted.ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                connection_hint,
            )
        })?;
        Ok(crate::DesktopCloudflareActivationAdmission {
            admission,
            connection_hint: connection_hint.to_owned(),
        })
    }

    /// Rechecks the purpose-specific activation admission across a native await boundary.
    ///
    /// # Errors
    ///
    /// Rejects authority, relation, capability, or credential-state drift.
    pub fn recheck_cloudflare_activation(
        &self,
        activation: &crate::DesktopCloudflareActivationAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&activation.admission.inner),
            |sync, database, admitted| {
                sync.admit_cloudflare_activation(
                    database,
                    admitted
                        .ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                    &activation.connection_hint,
                )
            },
        )
    }

    /// Starts one authority-bound, one-at-a-time post-marker credential recovery scan.
    ///
    /// # Errors
    ///
    /// Rejects stale authority or unavailable randomness before any recovery item is exposed.
    pub fn begin_cloudflare_recovery_scan(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
    ) -> Result<crate::DesktopCloudflareRecoveryScan, DesktopLocalHostError> {
        self.recheck_native_cloud(&admission)?;
        let mut scan_nonce = [0_u8; 16];
        getrandom::fill(&mut scan_nonce).map_err(|_| DesktopLocalHostError::StorageRejected)?;
        Ok(crate::DesktopCloudflareRecoveryScan {
            admission,
            cursor: None,
            scan_nonce,
        })
    }

    /// Yields at most one live post-marker credential intent and advances the private cursor.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, persistence drift, or malformed durable recovery state.
    pub fn next_cloudflare_recovery(
        &self,
        scan: &mut crate::DesktopCloudflareRecoveryScan,
    ) -> Result<Option<crate::DesktopCloudflareRecoveryHandle>, DesktopLocalHostError> {
        let after = scan
            .cursor
            .as_ref()
            .map(|(incarnation, intent)| (incarnation.as_str(), intent.as_str()));
        let recovered =
            self.with_sync_runtime(Some(&scan.admission.inner), |sync, database, admitted| {
                sync.next_cloudflare_recovery(
                    database,
                    admitted
                        .ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                    after,
                )
            })?;
        let Some(recovered) = recovered else {
            return Ok(None);
        };
        scan.cursor = Some((
            recovered.connection_incarnation_id.clone(),
            recovered.intent_id.clone(),
        ));
        Ok(Some(crate::DesktopCloudflareRecoveryHandle {
            scan_nonce: scan.scan_nonce,
            connection_incarnation_id: recovered.connection_incarnation_id.clone(),
            intent_id: recovered.intent_id,
            plan: crate::DesktopCloudflareKeychainPlanData {
                connection_incarnation_id: recovered.connection_incarnation_id,
                connection_digest: recovered.connection_digest,
                expected_base: recovered.expected_base,
                target: recovered.target,
            },
        }))
    }

    /// Resolves one yielded post-marker intent while Secure Host retains its Keychain lock.
    ///
    /// # Errors
    ///
    /// Rejects a substituted scan/handle, stale authority, or failed durable resolution.
    pub fn resolve_cloudflare_recovery(
        &self,
        scan: &crate::DesktopCloudflareRecoveryScan,
        handle: crate::DesktopCloudflareRecoveryHandle,
        comparison: crate::DesktopCloudflareCustodyComparison,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        let crate::DesktopCloudflareRecoveryHandle {
            scan_nonce,
            connection_incarnation_id,
            intent_id,
            plan,
        } = handle;
        let cursor_matches = scan.cursor.as_ref().is_some_and(|(incarnation, intent)| {
            incarnation == &connection_incarnation_id && intent == &intent_id
        });
        if scan_nonce != scan.scan_nonce || !cursor_matches {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let observation = recovery_observation(&plan, comparison);
        let resolution = self.resolve_cloudflare_credential_operation(
            &scan.admission,
            &connection_incarnation_id,
            &intent_id,
            &observation,
        )?;
        Ok(desktop_cloudflare_resolution(resolution))
    }

    /// Derives and durably prepares one Cloudflare provision from Host-owned state.
    ///
    /// # Errors
    ///
    /// Rejects an invalid lookup hint, observation, authority, generation, or storage state.
    pub fn prepare_cloudflare_provision(
        &self,
        activation: crate::DesktopCloudflareActivationAdmission,
        observation: &crate::DesktopCloudflareCheckedObservation,
    ) -> Result<crate::PreparedCloudflareProvision, DesktopLocalHostError> {
        let crate::DesktopCloudflareActivationAdmission {
            admission,
            connection_hint,
        } = activation;
        let prepared =
            self.with_sync_write(&admission.inner, |sync, database, admitted, guard| {
                sync.prepare_cloudflare_provision(
                    database,
                    admitted,
                    &connection_hint,
                    observation,
                    guard,
                )
            })?;
        let target = crate::CloudflareCredentialWitness {
            kind: crate::CloudflareCredentialEnvelopeKind::Active,
            generation: Some(prepared.preparation.target_generation),
            scope_digest: Some(prepared.preparation.scope_digest.clone()),
            zone_digest: Some(prepared.preparation.zone_digest.clone()),
            public_proof: Some(prepared.preparation.target_public_proof.clone()),
        };
        Ok(crate::PreparedCloudflareProvision {
            admission,
            plan: crate::DesktopCloudflareKeychainPlanData {
                connection_incarnation_id: prepared.preparation.connection_incarnation_id.clone(),
                connection_digest: prepared.connection_digest,
                expected_base: prepared.expected_base,
                target,
            },
            preparation: prepared.preparation,
        })
    }

    /// Durably enters prewrite inspection after the final cancellation/authority fence.
    ///
    /// # Errors
    ///
    /// Rejects a stale handle, authority, or persisted intent before Keychain is entered.
    pub fn begin_cloudflare_provision_prewrite_inspection(
        &self,
        prepared: crate::PreparedCloudflareProvision,
    ) -> Result<crate::InspectingCloudflareProvision, DesktopLocalHostError> {
        self.begin_cloudflare_prewrite_inspection(
            &prepared.admission,
            &prepared.preparation.connection_incarnation_id,
            &prepared.preparation.intent_id,
        )?;
        Ok(crate::InspectingCloudflareProvision {
            admission: prepared.admission,
            preparation: prepared.preparation,
            plan: prepared.plan,
        })
    }

    /// Records the Host-owned exact base after Secure Host proved it under the Keychain lock.
    ///
    /// # Errors
    ///
    /// Rejects a stale handle, authority, persisted intent, or root/publication drift.
    pub fn mark_cloudflare_provision_write_started(
        &self,
        inspecting: crate::InspectingCloudflareProvision,
    ) -> Result<crate::MarkedCloudflareProvision, DesktopLocalHostError> {
        self.mark_cloudflare_keychain_write_started(
            &inspecting.admission,
            &inspecting.preparation.connection_incarnation_id,
            &inspecting.preparation.intent_id,
        )?;
        Ok(crate::MarkedCloudflareProvision {
            admission: inspecting.admission,
            preparation: inspecting.preparation,
            plan: inspecting.plan,
        })
    }

    /// Converts a prewrite custody contradiction into terminal, sticky remediation.
    ///
    /// # Errors
    ///
    /// Rejects a stale admission, non-prewrite intent, invalid transition, or failed storage commit.
    pub fn remediate_cloudflare_provision_prewrite(
        &self,
        inspecting: crate::InspectingCloudflareProvision,
        reason: crate::DesktopCloudflarePrewriteFailure,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        let crate::InspectingCloudflareProvision {
            admission,
            preparation,
            plan: _,
        } = inspecting;
        let reason = match reason {
            crate::DesktopCloudflarePrewriteFailure::BaseMismatch => {
                crate::CloudflarePrewriteFailureReason::BaseMismatch
            }
            crate::DesktopCloudflarePrewriteFailure::MissingOther => {
                crate::CloudflarePrewriteFailureReason::MissingOther
            }
            crate::DesktopCloudflarePrewriteFailure::Malformed => {
                crate::CloudflarePrewriteFailureReason::Malformed
            }
            crate::DesktopCloudflarePrewriteFailure::Unreadable => {
                crate::CloudflarePrewriteFailureReason::Unreadable
            }
        };
        self.cancel_cloudflare_prewrite_for_remediation(
            &admission,
            &preparation.connection_incarnation_id,
            &preparation.intent_id,
            reason,
        )?;
        Ok(crate::DesktopCloudflareResolution::PrewriteRemediated)
    }

    /// Resolves an active stored credential into an opaque Provider-observation handle.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, an unknown entity/connection hint, or inconsistent publication.
    pub fn prepare_cloudflare_observation(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
        connection_hint: &str,
        entity_hint: &str,
    ) -> Result<crate::PreparedCloudflareObservation, DesktopLocalHostError> {
        crate::portfolio_projection::validate_domain_asset_id(entity_hint)
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let prepared =
            self.with_sync_runtime(Some(&admission.inner), |sync, database, admitted| {
                sync.prepare_cloudflare_observation(
                    database,
                    admitted
                        .ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                    connection_hint,
                    entity_hint,
                )
            })?;
        Ok(crate::PreparedCloudflareObservation {
            admission,
            connection_id: connection_hint.to_owned(),
            entity_id: entity_hint.to_owned(),
            connection_incarnation_id: prepared.connection_incarnation_id,
            connection_digest: prepared.connection_digest,
            generation: prepared.generation,
            scope_digest: prepared.scope_digest,
            zone_digest: prepared.zone_digest,
            public_proof: prepared.public_proof,
        })
    }

    /// Rechecks a stored-credential observation before each Secure Host await.
    ///
    /// # Errors
    ///
    /// Rejects an expired or superseded Host admission.
    pub fn recheck_cloudflare_observation(
        &self,
        prepared: &crate::PreparedCloudflareObservation,
    ) -> Result<(), DesktopLocalHostError> {
        self.recheck_native_cloud(&prepared.admission)
    }

    /// Commits checked Provider facts under the exact credential identity in the opaque handle.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, entity/zone substitution, malformed evidence, or storage failure.
    pub fn commit_checked_cloudflare_observation(
        &self,
        prepared: crate::PreparedCloudflareObservation,
        observation: &crate::DesktopCloudflareCheckedObservation,
    ) -> Result<crate::PendingCloudflareDnsProjection, DesktopLocalHostError> {
        let credential = crate::desktop_sync_runtime::PreparedCloudflareObservationData {
            connection_id: prepared.connection_id,
            entity_id: prepared.entity_id,
            connection_incarnation_id: prepared.connection_incarnation_id,
            connection_digest: prepared.connection_digest,
            generation: prepared.generation,
            scope_digest: prepared.scope_digest,
            zone_digest: prepared.zone_digest,
            public_proof: prepared.public_proof,
        };
        self.with_sync_write(
            &prepared.admission.inner,
            |sync, database, admission, guard| {
                sync.commit_checked_cloudflare_observation(
                    database,
                    admission,
                    &credential,
                    observation,
                    guard,
                )
            },
        )
    }

    /// Resolves a marked operation from a closed Secure Host custody comparison.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, invalid persisted state, or storage failure.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "consuming the opaque marked handle prevents replay after resolution"
    )]
    pub fn resolve_cloudflare_provision(
        &self,
        marked: crate::MarkedCloudflareProvision,
        comparison: crate::DesktopCloudflareCustodyComparison,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        let observation = recovery_observation(&marked.plan, comparison);
        let resolution = self.resolve_cloudflare_credential_operation(
            &marked.admission,
            &marked.preparation.connection_incarnation_id,
            &marked.preparation.intent_id,
            &observation,
        )?;
        Ok(desktop_cloudflare_resolution(resolution))
    }

    /// Constructs the production fail-closed boundary.
    ///
    /// No path, key, binding selector, native handle, plaintext, or authority assertion is
    /// accepted from the caller.
    #[must_use]
    pub fn production_unavailable() -> Self {
        Self {
            application_root: None,
            production_custody: None,
            authority_verifier: None,
            transition_requested_epoch: AtomicU64::new(0),
            operation_selection: Mutex::new(BackupOperationState::default()),
            authority_publication: Mutex::new(BackupAuthorityPublicationState::default()),
            runtime_state: Mutex::new(None),
            #[cfg(test)]
            rebootstrap_runtime: None,
            #[cfg(test)]
            rebootstrap_quarantine_custody: None,
            #[cfg(test)]
            rebootstrap_test_executor_enabled: false,
            #[cfg(test)]
            development_installation_binding: None,
            #[cfg(test)]
            business_commit_transition_epoch: AtomicU64::new(0),
            #[cfg(test)]
            restore_precommit_transition_epoch: AtomicU64::new(0),
            #[cfg(test)]
            restore_postcommit_transition_epoch: AtomicU64::new(0),
        }
    }

    /// Constructs the single native Desktop local-host aggregate from a validated app root.
    ///
    /// Keychain/device custody and production native backup qualification are intentionally
    /// fail-closed in this build; the root is nevertheless retained by the aggregate so no
    /// caller can substitute a database path later.
    ///
    /// # Errors
    ///
    /// Returns [`DesktopLocalHostError::ApplicationRootRejected`] when the app root fails native
    /// validation, or [`DesktopLocalHostError::StorageRejected`] when custody cannot be opened.
    pub fn production(root: DesktopApplicationRoot) -> Result<Self, DesktopLocalHostError> {
        let custody =
            DesktopProductionCustody::load_or_create(&root).map_err(|error| match error {
                crate::desktop_custody::DesktopCustodyError::Rejected => {
                    DesktopLocalHostError::ApplicationRootRejected
                }
                crate::desktop_custody::DesktopCustodyError::Unavailable
                | crate::desktop_custody::DesktopCustodyError::RandomUnavailable
                | crate::desktop_custody::DesktopCustodyError::StorageRejected => {
                    DesktopLocalHostError::StorageRejected
                }
            })?;
        // `load_or_create` owns the single pre-effect rebootstrap-residue gate. Do not observe
        // that state again after custody may have opened or created ordinary database/key state.
        let mut host = Self::production_unavailable();
        host.authority_verifier = BackupAuthorityVerifier::production().ok();
        host.application_root = Some(root);
        host.production_custody = Some(Mutex::new(custody));
        Ok(host)
    }

    /// Returns a closed authorization state without exposing identity, epochs, or deadlines.
    #[must_use]
    pub fn authorization_status(&self) -> DesktopHostAuthorizationStatus {
        self.status_snapshot().authorization
    }

    /// Accepts only the complete server-signed Grant+Lease wire. Verification remains private;
    /// until production trust-root and custody composition is available this method denies.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, availability, or storage error when the signed wire, current
    /// authority floor, native custody, or durable workspace cannot be verified and published.
    #[expect(
        clippy::too_many_lines,
        reason = "the activation transition intentionally keeps its complete lock and failure fence visible"
    )]
    pub fn activate_authorization_grant(
        &self,
        signed_wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        if signed_wire.is_empty() || signed_wire.len() > super::authority::MAX_SIGNED_WIRE_BYTES {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let requested = self
            .transition_requested_epoch
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value
                    .checked_add(1)
                    .filter(|next| *next <= MAX_SAFE_INTEGER)
            })
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?
            .checked_add(1)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let custody = if let Some(custody) = self.production_custody.as_ref() {
            Some(custody.lock().map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::StorageRejected,
                )
            })?)
        } else {
            #[cfg(not(test))]
            {
                return Err(self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::Unavailable,
                ));
            }
            #[cfg(test)]
            {
                None
            }
        };
        let verifier = self.authority_verifier.as_ref().ok_or_else(|| {
            self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::Unavailable,
            )
        })?;
        let device_id = if let Some(custody) = custody.as_ref() {
            custody.load_device_id().map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::AuthorityRejected,
                )
            })?
        } else {
            #[cfg(test)]
            {
                authority
                    .authority
                    .as_ref()
                    .map(|current| current.device_id.clone())
                    .ok_or_else(|| {
                        self.abort_transition(
                            &mut authority,
                            &mut runtime,
                            &mut operation,
                            requested,
                            DesktopLocalHostError::Unavailable,
                        )
                    })?
            }
            #[cfg(not(test))]
            unreachable!("production custody absence returns above")
        };
        let Ok(now) = current_unix_seconds() else {
            return Err(self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            ));
        };
        let binding = TrustedBackupBinding {
            account_id: authority
                .authority
                .as_ref()
                .map(|value| value.account_id.as_str()),
            device_id: &device_id,
            minimum_account_security_epoch: authority
                .authority
                .as_ref()
                .map_or(0, |value| value.account_security_epoch),
            minimum_lease_epoch: authority
                .authority
                .as_ref()
                .map_or(0, |value| value.lease_epoch),
        };
        let Ok(verified_authority) =
            VerifiedBackupAuthority::verify(signed_wire, &binding, now, verifier)
        else {
            return Err(self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            ));
        };
        if authority
            .authority
            .as_ref()
            .is_some_and(|current| !current.can_replace_with(&verified_authority))
        {
            return Err(self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            ));
        }
        let custody = custody.as_ref().ok_or_else(|| {
            self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::Unavailable,
            )
        })?;
        let mut database = custody
            .open_workspace(verified_authority.workspace_id())
            .map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::StorageRejected,
                )
            })?;
        let replacement = PrivateBackupAuthority::from_verified(&verified_authority, requested);
        let sync_runtime = DesktopSyncRuntime::new(
            verified_authority.workspace_id().to_owned(),
            verified_authority.device_id().to_owned(),
            verified_authority.lease_epoch(),
            verified_authority.trusted_time_floor(),
            verified_authority.execute_before(),
            verified_authority.snapshot_digest_hex(),
            requested,
        )
        .map_err(|_| {
            self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            )
        })?;
        database
            .recover_cloudflare_credential_orphans_guarded(&format_timestamp(now), || Ok(()))
            .map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::StorageRejected,
                )
            })?;
        *runtime = Some(DesktopRuntimeState {
            business: DesktopBusinessRuntime::new(database),
            sync: Some(sync_runtime),
        });
        authority.authority = Some(replacement);
        authority.applied_authority_epoch = requested;
        authority.restriction = RuntimeRestriction::Active;
        clear_operation_state(&mut operation);
        Ok(())
    }

    /// Permanently closes the current runtime under a durable security barrier.
    ///
    /// # Errors
    ///
    /// Returns a closed storage or authority error when the transition cannot be fenced.
    pub fn enter_security_lock(&self) -> Result<(), DesktopLocalHostError> {
        self.publish_restriction(RuntimeRestriction::SecurityLocked)
    }

    /// Temporarily closes the current runtime under a durable retryable barrier.
    ///
    /// # Errors
    ///
    /// Returns a closed storage or authority error when the transition cannot be fenced.
    pub fn enter_retryable_lock(&self) -> Result<(), DesktopLocalHostError> {
        self.publish_restriction(RuntimeRestriction::RetryableLocked)
    }

    /// Restricts a current verified continuation to local commercial read-only access.
    ///
    /// # Errors
    ///
    /// Returns a closed storage or authority error when current continuation evidence is absent
    /// or the transition cannot be fenced.
    pub fn enter_commercial_read_only(&self) -> Result<(), DesktopLocalHostError> {
        self.publish_restriction(RuntimeRestriction::CommercialReadOnly)
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the restriction transition keeps its durable barrier and lock fence together"
    )]
    fn publish_restriction(
        &self,
        restriction: RuntimeRestriction,
    ) -> Result<(), DesktopLocalHostError> {
        let requested = self
            .transition_requested_epoch
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value
                    .checked_add(1)
                    .filter(|next| *next <= MAX_SAFE_INTEGER)
            })
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?
            .checked_add(1)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        match restriction {
            RuntimeRestriction::CommercialReadOnly => {
                let now = current_unix_seconds().map_err(|_| {
                    self.abort_transition(
                        &mut authority,
                        &mut runtime,
                        &mut operation,
                        requested,
                        DesktopLocalHostError::AuthorityRejected,
                    )
                })?;
                let continuation_is_current = matches!(
                    (
                        authority.continuity.as_ref(),
                        authority.verified_continuation.as_ref(),
                    ),
                    (Some(_), Some(continuation)) if continuation.is_current_at(now)
                );
                let active_authority_is_current =
                    authority.authority.as_ref().is_some_and(|current| {
                        current.kind == BackupAuthorityKind::Active && current.is_current_at(now)
                    });
                if !continuation_is_current || !active_authority_is_current || runtime.is_none() {
                    return Err(self.abort_transition(
                        &mut authority,
                        &mut runtime,
                        &mut operation,
                        requested,
                        DesktopLocalHostError::AuthorityRejected,
                    ));
                }
                authority
                    .authority
                    .as_mut()
                    .expect("authority presence was checked above")
                    .kind = BackupAuthorityKind::VerifiedLocalContinuation;
            }
            RuntimeRestriction::RetryableLocked | RuntimeRestriction::SecurityLocked => {
                let barrier_persisted = match (
                    authority.continuity.as_ref(),
                    authority.verified_continuation.as_ref(),
                ) {
                    (Some(manager), Some(continuation)) => {
                        let reason = if restriction == RuntimeRestriction::RetryableLocked {
                            BarrierReason::Retryable
                        } else {
                            BarrierReason::Security
                        };
                        manager.barrier_continuation(continuation, reason).is_ok()
                    }
                    (None, None) => true,
                    _ => false,
                };
                if !barrier_persisted {
                    authority.authority = None;
                    authority.verified_continuation = None;
                    authority.applied_authority_epoch = requested;
                    authority.restriction = RuntimeRestriction::SecurityLocked;
                    *runtime = None;
                    clear_operation_state(&mut operation);
                    return Err(DesktopLocalHostError::StorageRejected);
                }
                authority.authority = None;
                authority.verified_continuation = None;
                *runtime = None;
            }
            RuntimeRestriction::ActivationRequired | RuntimeRestriction::Active => {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
        }
        authority.applied_authority_epoch = requested;
        authority.restriction = restriction;
        operation.selected_handle = None;
        operation.selected_artifact = None;
        operation.selected_authority_generation = None;
        operation.selected_authority_digest = None;
        operation.export_operation_id = None;
        operation.selection_operation_id = None;
        operation.export_consumed = true;
        operation.selection_consumed = true;
        Ok(())
    }

    #[expect(
        clippy::unused_self,
        reason = "keeping this as a Host method makes the transition failure boundary explicit at call sites"
    )]
    fn abort_transition(
        &self,
        authority: &mut BackupAuthorityPublicationState,
        runtime: &mut std::sync::MutexGuard<'_, Option<DesktopRuntimeState>>,
        operation: &mut BackupOperationState,
        requested: u64,
        original_error: DesktopLocalHostError,
    ) -> DesktopLocalHostError {
        // A previously committed continuation is durable authority evidence.  Persist its
        // Security barrier before clearing runtime state so a restart cannot revive it.  The
        // unqualified production composition is exactly `(None, None)` and remains independent
        // of continuity availability; any half-composed pair is an integrity failure.
        let barrier_persisted = match (
            authority.continuity.as_ref(),
            authority.verified_continuation.as_ref(),
        ) {
            (Some(manager), Some(continuation)) => manager
                .barrier_continuation(continuation, BarrierReason::Security)
                .is_ok(),
            (None, None) => true,
            _ => false,
        };
        authority.authority = None;
        authority.verified_continuation = None;
        authority.restriction = RuntimeRestriction::SecurityLocked;
        authority.applied_authority_epoch = requested;
        **runtime = None;
        clear_operation_state(operation);
        if barrier_persisted {
            original_error
        } else {
            DesktopLocalHostError::StorageRejected
        }
    }

    #[must_use]
    pub fn business_status(&self) -> DesktopLocalBusinessStatus {
        let snapshot = self.status_snapshot();
        match snapshot.business {
            DesktopLocalBusinessState::ActivationRequired
            | DesktopLocalBusinessState::SecurityLocked
            | DesktopLocalBusinessState::RetryableLocked => {
                closed_business_status(snapshot.business, snapshot.read_generation)
            }
            DesktopLocalBusinessState::CommercialReadOnly => DesktopLocalBusinessStatus {
                schema_version: 2,
                state: DesktopLocalBusinessState::CommercialReadOnly,
                capabilities: vec!["local:read"],
                read_generation: snapshot.read_generation,
            },
            DesktopLocalBusinessState::Active => DesktopLocalBusinessStatus {
                schema_version: 2,
                state: DesktopLocalBusinessState::Active,
                capabilities: vec!["local:read", "workspace:mutate"],
                read_generation: snapshot.read_generation,
            },
        }
    }

    fn status_snapshot(&self) -> DesktopStatusSnapshot {
        // Status is itself an authorization boundary. Use the same aggregate lock prefix as
        // operations so a renderer can never observe a restriction independently of a pending
        // transition, its authority deadline, or the writer it purports to authorize.
        let Ok(_operation) = self.operation_selection.lock() else {
            return DesktopStatusSnapshot::security_locked(0);
        };
        let Ok(authority) = self.authority_publication.lock() else {
            return DesktopStatusSnapshot::security_locked(0);
        };
        let Ok(runtime) = self.runtime_state.lock() else {
            return DesktopStatusSnapshot::security_locked(0);
        };
        let read_generation = runtime
            .as_ref()
            .map_or(0, |value| value.business.read_generation());
        let requested_epoch = self.transition_requested_epoch.load(Ordering::Acquire);
        if requested_epoch != authority.applied_authority_epoch {
            return DesktopStatusSnapshot::security_locked(read_generation);
        }
        let Ok(now) = current_unix_seconds() else {
            return DesktopStatusSnapshot::security_locked(read_generation);
        };

        match authority.restriction {
            RuntimeRestriction::ActivationRequired => DesktopStatusSnapshot {
                authorization: DesktopHostAuthorizationStatus::ActivationRequired,
                business: DesktopLocalBusinessState::ActivationRequired,
                read_generation,
            },
            RuntimeRestriction::RetryableLocked => DesktopStatusSnapshot {
                authorization: DesktopHostAuthorizationStatus::RetryableLocked,
                business: DesktopLocalBusinessState::RetryableLocked,
                read_generation,
            },
            RuntimeRestriction::SecurityLocked => {
                DesktopStatusSnapshot::security_locked(read_generation)
            }
            RuntimeRestriction::Active => {
                let valid = runtime.is_some()
                    && authority.authority.as_ref().is_some_and(|current| {
                        current.kind == BackupAuthorityKind::Active && current.is_current_at(now)
                    });
                if valid {
                    DesktopStatusSnapshot {
                        authorization: DesktopHostAuthorizationStatus::Authorized,
                        business: DesktopLocalBusinessState::Active,
                        read_generation,
                    }
                } else {
                    DesktopStatusSnapshot::security_locked(read_generation)
                }
            }
            RuntimeRestriction::CommercialReadOnly => {
                let valid = runtime.is_some()
                    && authority.continuity.is_some()
                    && authority
                        .verified_continuation
                        .as_ref()
                        .is_some_and(|continuation| continuation.is_current_at(now))
                    && authority.authority.as_ref().is_some_and(|current| {
                        current.kind == BackupAuthorityKind::VerifiedLocalContinuation
                            && current.is_current_at(now)
                    });
                if valid {
                    DesktopStatusSnapshot {
                        authorization: DesktopHostAuthorizationStatus::Continuation,
                        business: DesktopLocalBusinessState::CommercialReadOnly,
                        read_generation,
                    }
                } else {
                    DesktopStatusSnapshot::security_locked(read_generation)
                }
            }
        }
    }

    /// Reads one bounded asset-library window under the current Host authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_asset_library(
        &self,
        request: DesktopAssetLibraryReadRequest,
    ) -> Result<crate::AssetLibraryReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot =
                runtime.read_asset_library(request.start_index, request.size, &request.query)?;
            if restriction == RuntimeRestriction::CommercialReadOnly {
                snapshot.freshness.can_edit = false;
                snapshot.freshness.read_only_reason = Some("commercial".to_owned());
            }
            Ok(snapshot)
        })
    }

    /// Reads one domain detail under the current Host authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_domain_detail(
        &self,
        request: DesktopDomainDetailReadRequest,
    ) -> Result<crate::DomainDetailReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_domain_detail(&request.entity_id)?;
            if restriction == RuntimeRestriction::CommercialReadOnly {
                snapshot.freshness.can_edit = false;
                snapshot.freshness.read_only_reason = Some("commercial".to_owned());
            }
            Ok(snapshot)
        })
    }

    /// Reads the sole bounded, non-secret Cloudflare connection marker under Host authority.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not admitted.
    pub fn read_cloudflare_connection(
        &self,
    ) -> Result<crate::DesktopCloudflareConnectionRead, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, _| {
            runtime.read_cloudflare_connection()
        })
    }

    /// Reads the latest committed local Cloudflare DNS evidence under Host authority.
    ///
    /// # Errors
    ///
    /// Returns a closed protocol, authority, or storage error for invalid or unavailable reads.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_cloudflare_observation(
        &self,
        request: crate::DesktopCloudflareObservationReadRequest,
    ) -> Result<crate::DesktopCloudflareObservationRead, DesktopLocalHostError> {
        if request.schema_version != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        self.with_authorized_business(false, |runtime, _, _, _| {
            runtime.read_cloudflare_observation(&request.entity_id)
        })
    }

    /// Binds one existing asset to the latest Host-verified Cloudflare Zone observation.
    ///
    /// The Renderer supplies only the asset and an expected local generation. Connection and
    /// Provider resource identity are recovered from Host-local observation evidence.
    pub fn bind_domain_asset_provider(
        &self,
        request: DesktopDomainAssetProviderBindingRequest,
    ) -> Result<DesktopDomainAssetProviderBindingReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.bind_domain_asset_provider_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Applies one domain-asset mutation under the current Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when mutation admission, validation, or the
    /// final durable commit fence fails.
    pub fn edit_domain_asset(
        &self,
        request: DesktopDomainAssetEditRequest,
    ) -> Result<crate::DomainAssetMutationReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.edit_domain_asset_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Deletes one domain asset under the current Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when mutation admission, validation, or the
    /// final durable commit fence fails.
    pub fn delete_domain_asset(
        &self,
        request: DesktopDomainAssetDeleteRequest,
    ) -> Result<crate::DomainAssetMutationReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.delete_domain_asset_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Reads the local conflict center under the current Host authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    pub fn read_conflict_center(&self) -> Result<DesktopConflictCenterView, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut view = runtime.read_conflict_center()?;
            if restriction == RuntimeRestriction::CommercialReadOnly {
                view.freshness.source = "local_continuation";
                for conflict in &mut view.conflicts {
                    conflict.resolution_admission = serde_json::json!({"state":"unavailable"});
                }
            }
            Ok(view)
        })
    }

    /// Reads the durable sync snapshot under the same authority gate as business reads.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not admitted.
    pub fn read_sync_snapshot(
        &self,
    ) -> Result<crate::DesktopSyncSnapshotView, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let source = if restriction == RuntimeRestriction::CommercialReadOnly {
                "local_continuation"
            } else {
                "active_local"
            };
            let blocked_reason =
                (restriction == RuntimeRestriction::CommercialReadOnly).then_some("authorization");
            runtime.read_sync_snapshot(source, blocked_reason)
        })
    }

    /// Resolves one conflict under the current Host installation and commit fences.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when the installation binding, resolution
    /// request, or final durable commit fence cannot be verified.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn resolve_conflict(
        &self,
        request: DesktopConflictResolveRequest,
    ) -> Result<crate::DesktopConflictResolutionReceipt, DesktopLocalHostError> {
        let production_installation_binding = self
            .production_custody
            .as_ref()
            .map(|custody| {
                custody
                    .lock()
                    .map_err(|_| crate::desktop_custody::DesktopCustodyError::StorageRejected)?
                    .installation_binding_digest()
            })
            .transpose()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        #[cfg(test)]
        let installation_binding =
            production_installation_binding.or(self.development_installation_binding);
        #[cfg(not(test))]
        let installation_binding = production_installation_binding;
        let installation_binding =
            installation_binding.ok_or(DesktopLocalHostError::StorageRejected)?;
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            let resolution_id = request.resolution_id(
                &installation_binding,
                &authority.account_id,
                &authority.workspace_id,
                &authority.device_id,
            );
            let receipt =
                runtime.resolve_conflict_guarded(&request, &resolution_id, &context, || {
                    self.require_business_commit_fence(captured_epoch, authority)
                })?;
            Ok(runtime.resolution_view(&receipt))
        })
    }

    fn with_authorized_business<T>(
        &self,
        mutable: bool,
        operation: impl FnOnce(
            &mut DesktopBusinessRuntime,
            &PrivateBackupAuthority,
            u64,
            RuntimeRestriction,
        ) -> Result<T, BusinessDatabaseError>,
    ) -> Result<T, DesktopLocalHostError> {
        // All durable business operations join the aggregate lock order before observing
        // authority. A transition publishes its epoch first, then waits on this same prefix.
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let current = authority
            .authority
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let captured_epoch = authority.applied_authority_epoch;
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        let restriction_authorizes = match authority.restriction {
            RuntimeRestriction::Active => current.kind == BackupAuthorityKind::Active,
            RuntimeRestriction::CommercialReadOnly => {
                !mutable
                    && current.kind == BackupAuthorityKind::VerifiedLocalContinuation
                    && matches!(
                        (
                            authority.continuity.as_ref(),
                            authority.verified_continuation.as_ref(),
                        ),
                        (Some(_), Some(continuation)) if continuation.is_current_at(now)
                    )
            }
            RuntimeRestriction::ActivationRequired
            | RuntimeRestriction::RetryableLocked
            | RuntimeRestriction::SecurityLocked => false,
        };
        if !restriction_authorizes
            || mutable && authority.restriction != RuntimeRestriction::Active
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !current.is_current_at(now)
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let business = &mut runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?
            .business;
        let result = operation(business, current, captured_epoch, authority.restriction)
            .map_err(map_host_database_error)?;
        if !mutable && self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        Ok(result)
    }

    fn require_business_commit_fence(
        &self,
        captured_epoch: u64,
        authority: &PrivateBackupAuthority,
    ) -> Result<(), BusinessDatabaseError> {
        #[cfg(test)]
        {
            let requested = self
                .business_commit_transition_epoch
                .swap(0, Ordering::AcqRel);
            if requested != 0 {
                self.transition_requested_epoch
                    .store(requested, Ordering::Release);
            }
        }
        let now = current_unix_seconds().map_err(|_| BusinessDatabaseError::MutationStale)?;
        if self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !authority.is_current_at(now)
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }

    pub(crate) fn begin_sync_run(&self) -> Result<DesktopSyncRunAdmission, DesktopLocalHostError> {
        self.with_sync_runtime(None, |sync, database, _| sync.begin_sync_run(database))
    }

    /// Begins one opaque Native Cloud run under the currently accepted Host authority.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error when the Host cannot admit a current run.
    pub fn begin_native_cloud_run(
        &self,
    ) -> Result<crate::DesktopNativeCloudAdmission, DesktopLocalHostError> {
        self.begin_sync_run()
            .map(|inner| crate::DesktopNativeCloudAdmission { inner })
    }

    /// Lock-free prompt cancellation check. Exact identity and final commit authorization remain
    /// owned by `recheck_native_cloud` and the one-shot Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns an authority error when the admitted run is expired or no longer current.
    pub fn fast_recheck_native_cloud(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        if self.transition_requested_epoch.load(Ordering::Acquire)
            != admission.inner.authority_epoch
            || now < admission.inner.trusted_time_floor
            || now >= admission.inner.execute_before
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        Ok(())
    }

    /// Performs the full exact Host check after an async or blocking boundary.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error when the admitted run is no longer current.
    pub fn recheck_native_cloud(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.recheck_sync_run(&admission.inner)
    }

    /// Rechecks the exact opaque run after a network await without exposing authority fields.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when the run is no longer current.
    pub(crate) fn recheck_sync_run(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.recheck_sync_run(database, admission.expect("admission checked"))
        })
    }

    pub(crate) fn sync_claim(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<crate::desktop_sync_runtime::SyncPushClaimSchedule, DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.sync_claim(database, admission, guard)
        })
    }

    pub(crate) fn sync_acknowledge(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        acknowledgements: &[crate::SyncMutationAcknowledgement],
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_acknowledge(
                business.database_for_backup_mut(),
                admission,
                delivery_owner,
                acknowledgements,
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn sync_defer_retryable_with_deadline(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        mutations: &[crate::ClaimedSyncMutation],
    ) -> Result<std::time::Duration, DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.sync_defer_retryable_with_deadline(
                database,
                admission,
                delivery_owner,
                mutations,
                guard,
            )
        })
    }

    pub(crate) fn sync_reject(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        mutations: &[crate::ClaimedSyncMutation],
        disposition: DesktopSyncRejectDisposition,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_reject(
                business.database_for_backup_mut(),
                admission,
                DesktopSyncRejectBatch {
                    delivery_owner,
                    mutations,
                    disposition,
                },
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn sync_pull_request(
        &self,
        admission: &DesktopSyncRunAdmission,
        page_limit: u16,
    ) -> Result<crate::SyncPullRequestV2, DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.sync_pull_request(database, admission.expect("admission checked"), page_limit)
        })
    }

    pub(crate) fn sync_apply_page(
        &self,
        admission: &DesktopSyncRunAdmission,
        page_json: &str,
        confirmation_token: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_apply_page(
                business.database_for_backup_mut(),
                admission,
                page_json,
                confirmation_token,
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn sync_mark_rebootstrap_required(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_mark_rebootstrap_required(
                business.database_for_backup_mut(),
                admission,
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn checkpoint_due(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<bool, DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.checkpoint_due(database, admission.expect("admission checked"))
        })
    }

    pub(crate) fn complete_checkpoint(
        &self,
        admission: &DesktopSyncRunAdmission,
        descriptor: Option<&crate::NativeCheckpointDescriptor>,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.complete_checkpoint(database, admission, descriptor, guard)
        })
    }

    /// Applies one bounded Cloud rebootstrap plan inside the sole Local Host writer boundary.
    /// Neither the staged path nor either `SQLCipher` key is nameable by the caller.
    #[cfg(not(test))]
    #[expect(
        dead_code,
        reason = "the production sync coordinator will call this fail-closed Host seam"
    )]
    #[expect(
        clippy::unused_self,
        reason = "the method shape fixes rebootstrap at the Host authority boundary"
    )]
    pub(crate) fn apply_rebootstrap_plan(
        &self,
        _checkpoint_wire: &[u8],
        _plan_wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        // Production has no qualified create-only native rebootstrap capability. Deny at the
        // aggregate boundary before parsing untrusted wire or acquiring any runtime/custody lock.
        Err(DesktopLocalHostError::Unavailable)
    }

    #[cfg(test)]
    pub(crate) fn apply_rebootstrap_plan(
        &self,
        checkpoint_wire: &[u8],
        plan_wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        if !self.rebootstrap_test_executor_enabled {
            return Err(DesktopLocalHostError::Unavailable);
        }
        self.apply_rebootstrap_plan_inner(
            checkpoint_wire,
            plan_wire,
            RebootstrapCrashBoundary::Completed,
        )
    }

    #[cfg(test)]
    fn apply_rebootstrap_plan_until_for_test(
        &self,
        checkpoint_wire: &[u8],
        plan_wire: &[u8],
        stop_after: RebootstrapCrashBoundary,
    ) -> Result<(), DesktopLocalHostError> {
        self.apply_rebootstrap_plan_inner(checkpoint_wire, plan_wire, stop_after)
    }

    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the test executor keeps the complete crash-boundary protocol visible in one linear harness"
    )]
    fn apply_rebootstrap_plan_inner(
        &self,
        checkpoint_wire: &[u8],
        plan_wire: &[u8],
        stop_after: RebootstrapCrashBoundary,
    ) -> Result<(), DesktopLocalHostError> {
        let checkpoint = RebootstrapCheckpoint::parse(checkpoint_wire)
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        let plan = RebootstrapPlan::parse(&checkpoint, plan_wire)
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let current = authority
            .authority
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let captured_epoch = authority.applied_authority_epoch;
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        if authority.restriction != RuntimeRestriction::Active
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !current.is_current_at(now)
            || current.workspace_id != plan.workspace_id()
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut runtime = runtime;
        let custody = self
            .production_custody
            .as_ref()
            .ok_or(DesktopLocalHostError::Unavailable)?
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;

        // This gate is intentionally before runtime admission/allocation, journal creation,
        // slot access, candidate creation, alias repair, or database mutation. The current
        // production composition has no qualified create-only Keychain primitive and therefore
        // returns Unavailable here while ordinary local business operation remains unaffected.
        custody
            .require_rebootstrap_reservation_capability()
            .map_err(|error| match error {
                crate::desktop_custody::DesktopCustodyError::Unavailable => {
                    DesktopLocalHostError::Unavailable
                }
                crate::desktop_custody::DesktopCustodyError::Rejected
                | crate::desktop_custody::DesktopCustodyError::RandomUnavailable
                | crate::desktop_custody::DesktopCustodyError::StorageRejected => {
                    DesktopLocalHostError::StorageRejected
                }
            })?;
        {
            let rebootstrap = self
                .rebootstrap_runtime
                .as_ref()
                .ok_or(DesktopLocalHostError::Unavailable)?;
            let state = runtime
                .as_mut()
                .ok_or(DesktopLocalHostError::AuthorityRejected)?;

            let binding_digest = rebootstrap_binding_digest(current);
            let authority_digest = hex_digest(&current.digest);
            let floor_digest = rebootstrap_floor_digest(current);
            rebootstrap
                .apply_verified_authority(binding_digest, authority_digest, floor_digest)
                .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
            let admission = rebootstrap
                .begin()
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let reservation = rebootstrap
                .allocate(admission, plan)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let (candidate_reservation, prepared_evidence) = custody
                .reserve_rebootstrap(&reservation, state.business.database_for_backup_mut())
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::ReservationCreated {
                return Ok(());
            }
            let prepared = rebootstrap
                .prepare(reservation, &prepared_evidence)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::Prepared {
                return Ok(());
            }
            let (snapshot, checkpoint_revision, replay_pages) =
                prepared.plan().installation_input();
            let (candidate, candidate_reserved_evidence) = custody
                .materialize_candidate(
                    candidate_reservation,
                    state.business.database_for_backup_mut(),
                )
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::CandidateCreated {
                return Ok(());
            }
            let Ok(reserved) =
                rebootstrap.confirm_candidate_reserved(prepared, &candidate_reserved_evidence)
            else {
                let _ = custody.discard_rebootstrap_candidate_handle(candidate);
                return Err(DesktopLocalHostError::StorageRejected);
            };
            if stop_after == RebootstrapCrashBoundary::CandidateReserved {
                return Ok(());
            }
            let mut proof_out = None;
            let mut journal_link_out = None;
            let device_id = current.device_id.clone();
            let install = custody.with_rebootstrap_candidate(
                &candidate,
                current.workspace_id.as_str(),
                |database| {
                    database
                        .install_rebootstrap_plan_guarded(
                            &snapshot,
                            checkpoint_revision,
                            &device_id,
                            &replay_pages,
                            |proof| {
                                let link = rebootstrap
                                    .candidate_journal_link(&reserved, proof)
                                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                                proof_out = Some(proof.clone());
                                journal_link_out = Some(link.clone());
                                Ok(link)
                            },
                            || self.require_business_commit_fence(captured_epoch, current),
                        )
                        .map(|_| ())
                },
            );
            let Ok(((), candidate_final)) = install else {
                if custody
                    .discard_rebootstrap_candidate_handle(candidate)
                    .is_ok()
                {
                    let _ = rebootstrap.cancel_candidate_reserved(reserved);
                }
                return Err(DesktopLocalHostError::StorageRejected);
            };
            let proof = proof_out.ok_or(DesktopLocalHostError::StorageRejected)?;
            let journal_link = journal_link_out.ok_or(DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::CandidateMutated {
                return Ok(());
            }

            // Publication owns the only writer. Remove the old runtime before custody closes and
            // evidences the old database; no SQLite connection survives PublishIntent/EXCHANGE.
            let old_state = runtime
                .take()
                .ok_or(DesktopLocalHostError::AuthorityRejected)?;
            let DesktopRuntimeState { business, sync } = old_state;
            drop(sync);
            let old_database = business.into_database();
            let verified_candidate = custody
                .verify_candidate(
                    candidate,
                    candidate_final,
                    old_database,
                    &proof,
                    &journal_link,
                )
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let verified = rebootstrap
                .verify_candidate(reserved, &proof, verified_candidate.evidence())
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::Verified {
                return Ok(());
            }
            let publish = rebootstrap
                .publish_intent(verified)
                .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
            if stop_after == RebootstrapCrashBoundary::PublishIntentPreExchange {
                return Ok(());
            }
            if matches!(
                stop_after,
                RebootstrapCrashBoundary::ExchangeBeforeDirectoryFsync
                    | RebootstrapCrashBoundary::AliasRepairBeforePublished
            ) {
                let custody_boundary = match stop_after {
                    RebootstrapCrashBoundary::ExchangeBeforeDirectoryFsync => {
                        TestRebootstrapCrashBoundary::AfterExchangeBeforeDirectoryFsync
                    }
                    RebootstrapCrashBoundary::AliasRepairBeforePublished => {
                        TestRebootstrapCrashBoundary::AfterAliasRepairBeforePublished
                    }
                    _ => unreachable!("matched crash boundary"),
                };
                return match custody.publish_with_crash_for_test(
                    verified_candidate,
                    &publish,
                    custody_boundary,
                ) {
                    Err(_) => Ok(()),
                    Ok(_) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            let publication = custody
                .publish(verified_candidate, &publish)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::PublishIntentPostExchange {
                return Ok(());
            }
            let publish = rebootstrap
                .confirm_published(publish)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::Published {
                return Ok(());
            }
            if stop_after == RebootstrapCrashBoundary::ReopenProofFailure {
                let before = custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                let result = custody.reopen_published_with_crash_for_test(
                    &publication,
                    current.workspace_id.as_str(),
                    publish.journal_link(),
                    TestRebootstrapCrashBoundary::ReopenProofFailure,
                );
                let after = custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                assert_eq!(before, after);
                return match result {
                    Err(_) => Ok(()),
                    Ok(()) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            custody
                .verify_published_read_only(
                    &publication,
                    current.workspace_id.as_str(),
                    publish.journal_link(),
                )
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::ReopenedBeforeConfirmation {
                return Ok(());
            }
            let retire = rebootstrap
                .confirm_reopened(publish)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::ReopenedVerified {
                return Ok(());
            }
            if matches!(
                stop_after,
                RebootstrapCrashBoundary::OldFileUnlinked
                    | RebootstrapCrashBoundary::OldSlotDeleted
            ) {
                let custody_boundary = match stop_after {
                    RebootstrapCrashBoundary::OldFileUnlinked => {
                        TestRebootstrapCrashBoundary::AfterOldFileUnlinkAndDirectoryFsync
                    }
                    RebootstrapCrashBoundary::OldSlotDeleted => {
                        TestRebootstrapCrashBoundary::AfterOldSlotDeleteAndAbsentReadback
                    }
                    _ => unreachable!("matched retirement boundary"),
                };
                return match custody
                    .retire_rebootstrap_old_with_crash_for_test(publication, custody_boundary)
                {
                    Err(_) => Ok(()),
                    Ok(()) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            custody
                .retire_rebootstrap_old(publication)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::RetiredOldJournalAppendFailure {
                return match rebootstrap.confirm_retired_with_crash_for_test(retire) {
                    Err(_) => Ok(()),
                    Ok(_) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            rebootstrap
                .confirm_retired(retire)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::RetiredOld {
                return Ok(());
            }
            let database = custody
                .open_workspace(current.workspace_id.as_str())
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let sync = DesktopSyncRuntime::new(
                current.workspace_id.clone(),
                current.device_id.clone(),
                current.lease_epoch,
                current.trusted_time_floor,
                current.execute_before,
                hex_digest(&current.digest),
                current.generation,
            )
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            *runtime = Some(DesktopRuntimeState {
                business: DesktopBusinessRuntime::new(database),
                sync: Some(sync),
            });
            Ok(())
        }
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "projection inspection remains a test oracle; production claims through the sealed Native exchange"
        )
    )]
    pub(crate) fn pending_cloudflare_projections(
        &self,
        admission: &DesktopSyncRunAdmission,
        limit: usize,
    ) -> Result<Vec<crate::PendingCloudflareDnsProjection>, DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.pending_cloudflare_projections(
                database,
                admission.expect("admission checked"),
                limit,
            )
        })
    }

    pub(crate) fn claim_cloudflare_projection(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<crate::desktop_sync_runtime::CloudflareProjectionClaimSchedule, DesktopLocalHostError>
    {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.claim_cloudflare_projection(database, admission, guard)
        })
    }

    pub(crate) fn acknowledge_cloudflare_projection(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        acknowledgement: &crate::CloudflareDnsProjectionAcknowledgement,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.acknowledge_cloudflare_projection(
                database,
                admission,
                delivery_owner,
                acknowledgement,
                guard,
            )
        })
    }

    pub(crate) fn defer_cloudflare_projection(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        projection: &crate::ClaimedCloudflareDnsProjection,
    ) -> Result<std::time::Duration, DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.defer_cloudflare_projection(database, admission, delivery_owner, projection, guard)
        })
    }

    /// Records the exact credential base before the caller begins the OS Keychain mutation.
    ///
    /// # Errors
    ///
    /// Returns a validation, stale-authority, or storage error when the marker cannot commit.
    pub(crate) fn begin_cloudflare_prewrite_inspection(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.begin_cloudflare_prewrite_inspection(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                guard,
            )
        })
    }

    pub(crate) fn mark_cloudflare_keychain_write_started(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.mark_cloudflare_keychain_write_started(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                guard,
            )
        })
    }

    pub(crate) fn cancel_cloudflare_prewrite_for_remediation(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        reason: crate::CloudflarePrewriteFailureReason,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.cancel_cloudflare_prewrite_for_remediation(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                reason,
                guard,
            )
        })
    }

    /// Cancels never-entered preparations and remediates prewrite orphans under fresh authority.
    ///
    /// # Errors
    ///
    /// Rejects stale authority or an atomic storage transition failure.
    pub fn recover_cloudflare_credential_orphans(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
    ) -> Result<usize, DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.recover_cloudflare_credential_orphans(database, admission, guard)
        })
    }

    /// Resolves a prepared credential transition from the post-write Keychain observation.
    ///
    /// # Errors
    ///
    /// Returns a validation, stale-authority, or storage error when resolution cannot commit.
    pub(crate) fn resolve_cloudflare_credential_operation(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        observation: &crate::CloudflareCredentialRecoveryObservation,
    ) -> Result<crate::CloudflareCredentialResolution, DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.resolve_cloudflare_credential_operation(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                observation,
                guard,
            )
        })
    }
    fn with_sync_runtime<T>(
        &self,
        admission: Option<&DesktopSyncRunAdmission>,
        operation: impl FnOnce(
            &DesktopSyncRuntime,
            &mut BusinessDatabase,
            Option<&DesktopSyncRunAdmission>,
        ) -> Result<T, DesktopSyncError>,
    ) -> Result<T, DesktopLocalHostError> {
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        if authority.restriction != RuntimeRestriction::Active
            || self.transition_requested_epoch.load(Ordering::Acquire)
                != authority.applied_authority_epoch
            || authority.authority.as_ref().is_none_or(|current| {
                current_unix_seconds().map_or(true, |now| !current.is_current_at(now))
            })
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let DesktopRuntimeState { business, sync } = runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let sync = sync
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let database = business.database_for_backup_mut();
        let result = operation(sync, database, admission).map_err(map_sync_error)?;
        if self.transition_requested_epoch.load(Ordering::Acquire)
            != authority.applied_authority_epoch
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        Ok(result)
    }

    /// Runs one durable sync/provider stage under the Host lock order
    /// authority -> runtime/writer -> `SQLite`. The one-shot guard captures the exact published
    /// authority and epoch and is consumed as the transaction's final pre-COMMIT action.
    fn with_sync_write<T>(
        &self,
        admission: &DesktopSyncRunAdmission,
        operation: impl FnOnce(
            &DesktopSyncRuntime,
            &mut BusinessDatabase,
            &DesktopSyncRunAdmission,
            DesktopSyncCommitGuard<'_>,
        ) -> Result<T, DesktopSyncError>,
    ) -> Result<T, DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            operation(sync, business.database_for_backup_mut(), admission, guard)
        })
    }

    fn with_sync_business_write<T>(
        &self,
        admission: &DesktopSyncRunAdmission,
        operation: impl FnOnce(
            &DesktopSyncRuntime,
            &mut DesktopBusinessRuntime,
            &DesktopSyncRunAdmission,
            DesktopSyncCommitGuard<'_>,
        ) -> Result<T, DesktopSyncError>,
    ) -> Result<T, DesktopLocalHostError> {
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let current = authority
            .authority
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let captured_epoch = authority.applied_authority_epoch;
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        if authority.restriction != RuntimeRestriction::Active
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !current.is_current_at(now)
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let DesktopRuntimeState { business, sync } = runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let sync = sync
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let guard = DesktopSyncCommitGuard::new(|| {
            self.require_business_commit_fence(captured_epoch, current)
                .map_err(|_| DesktopSyncError::StaleAuthority)
        });
        operation(sync, business, admission, guard).map_err(map_sync_error)
    }

    fn require_current_authority(
        &self,
        state: &BackupAuthorityPublicationState,
        restore: bool,
    ) -> Result<u64, DesktopBackupError> {
        if !state.native.is_qualified() {
            return Err(DesktopBackupError::StorageRejected);
        }
        let authority = state
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        if restore {
            if authority.kind != BackupAuthorityKind::Active {
                return Err(DesktopBackupError::AuthorityRejected);
            }
        } else if !authority.kind.can_export_or_inspect() {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let captured_epoch = state.applied_authority_epoch;
        self.require_captured_epoch(state, captured_epoch, restore)?;
        Ok(captured_epoch)
    }

    fn require_captured_epoch(
        &self,
        state: &BackupAuthorityPublicationState,
        captured_epoch: u64,
        restore: bool,
    ) -> Result<(), DesktopBackupError> {
        let authority = state
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        let now = current_unix_seconds()?;
        if captured_epoch == 0
            || state.applied_authority_epoch != captured_epoch
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !authority.is_current_at(now)
            || restore && authority.kind != BackupAuthorityKind::Active
        {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        Ok(())
    }

    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the development fixture composes one complete and reviewable authority state"
    )]
    pub(crate) fn development(
        database: BusinessDatabase,
        native_root: std::path::PathBuf,
        account_id: &str,
        workspace_id: &str,
        device_id: &str,
    ) -> Result<Self, DesktopBackupError> {
        let generation: u64 = 1;
        let now = current_unix_seconds()?;
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/BACKUP-AUTHORITY-TEST-V1\0");
        for value in [account_id, workspace_id, device_id] {
            digest.update(value.len().to_be_bytes());
            digest.update(value.as_bytes());
        }
        digest.update(generation.to_be_bytes());
        let authority = PrivateBackupAuthority {
            kind: BackupAuthorityKind::Active,
            account_id: account_id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            device_id: device_id.to_owned(),
            lease_epoch: 1,
            account_security_epoch: 1,
            entitlement_revision: 1,
            entitlement_projection_digest: "11".repeat(32),
            commercial_expires_at: "9999-12-31T23:59:59Z".to_owned(),
            capability: "cloudflare:dns:observe".to_owned(),
            generation,
            trusted_time_floor: now,
            execute_before: i64::MAX,
            digest: digest.finalize().into(),
        };
        let installation_digest = digest_component(
            b"GOODDEALER/DEVELOPMENT-INSTALLATION-V1\0",
            &[account_id.as_bytes(), device_id.as_bytes()].concat(),
        );
        let account_digest =
            digest_component(b"GOODDEALER/BACKUP-ACCOUNT-V1\0", account_id.as_bytes());
        let workspace_digest =
            digest_component(b"GOODDEALER/BACKUP-WORKSPACE-V1\0", workspace_id.as_bytes());
        let device_digest =
            digest_component(b"GOODDEALER/BACKUP-DEVICE-V1\0", device_id.as_bytes());
        // The qualified development fixture models a stable SQLCipher lineage. Production does
        // not use this derivation and remains closed until real lineage plus a qualified monotonic
        // anchor are composed from custody.
        let database_lineage_digest = digest_component(
            b"GOODDEALER/DEVELOPMENT-DATABASE-LINEAGE-V1\0",
            workspace_id.as_bytes(),
        );
        let continuity_binding = ContinuityBinding {
            installation_digest,
            account_digest,
            workspace_digest,
            device_digest,
            minimum_account_security_epoch: authority.account_security_epoch,
            minimum_lease_epoch: authority.lease_epoch,
            minimum_entitlement_revision: authority.entitlement_revision,
            database_lineage_digest,
            database_publication_generation: 1,
        };
        let continuity_receipt = ContinuityReceiptV1 {
            sequence: generation,
            state: ReceiptState::Continuation,
            installation_digest,
            account_digest,
            workspace_digest,
            device_digest,
            account_security_epoch: authority.account_security_epoch,
            lease_epoch: authority.lease_epoch,
            entitlement_revision: authority.entitlement_revision,
            entitlement_projection_digest: [0x11; 32],
            commercial_expires_at: i64::MAX,
            trusted_time_floor: now,
            execute_before: i64::MAX,
            authority_generation: generation,
            database_lineage_digest,
            database_publication_generation: 1,
        };
        let continuity = ContinuityManager::development_for_test();
        let pending = continuity
            .begin_verified_replacement(continuity_receipt, &continuity_binding, now)
            .map_err(|_| DesktopBackupError::AuthorityRejected)?;
        let _committed = continuity
            .commit_receipt(pending)
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let startup = continuity
            .load_startup(&continuity_binding, now, true, true)
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        if startup.decision != StartupContinuity::VerifiedLocalContinuation {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let verified_continuation = startup
            .continuation
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        let container = BackupContainerHost::ephemeral_for_test(authority.binding())
            .map_err(map_container_error)?;
        let sync = DesktopSyncRuntime::new(
            authority.workspace_id.clone(),
            authority.device_id.clone(),
            authority.lease_epoch,
            authority.trusted_time_floor,
            authority.execute_before,
            hex_digest(&authority.digest),
            generation,
        )
        .map_err(|_| DesktopBackupError::AuthorityRejected)?;
        Ok(Self {
            application_root: None,
            production_custody: None,
            authority_verifier: None,
            transition_requested_epoch: AtomicU64::new(generation),
            operation_selection: Mutex::new(BackupOperationState::default()),
            authority_publication: Mutex::new(BackupAuthorityPublicationState {
                native: NativeBackupComposition::Development(DevelopmentNativeBackup::new(
                    native_root,
                )?),
                authority: Some(authority),
                container: Some(container),
                applied_authority_epoch: generation,
                restriction: RuntimeRestriction::Active,
                continuity: Some(continuity),
                verified_continuation: Some(verified_continuation),
            }),
            runtime_state: Mutex::new(Some(DesktopRuntimeState {
                business: DesktopBusinessRuntime::new(database),
                sync: Some(sync),
            })),
            rebootstrap_runtime: None,
            rebootstrap_quarantine_custody: None,
            rebootstrap_test_executor_enabled: false,
            development_installation_binding: Some(installation_digest),
            business_commit_transition_epoch: AtomicU64::new(0),
            restore_precommit_transition_epoch: AtomicU64::new(0),
            restore_postcommit_transition_epoch: AtomicU64::new(0),
        })
    }

    #[cfg(test)]
    fn development_with_rebootstrap_custody(
        root: &DesktopApplicationRoot,
        native_root: std::path::PathBuf,
        account_id: &str,
        workspace_id: &str,
        device_id: &str,
        enable_test_create_only_backend: bool,
    ) -> Result<Self, DesktopBackupError> {
        Self::development_with_rebootstrap_custody_and_store(
            root,
            native_root,
            account_id,
            workspace_id,
            device_id,
            enable_test_create_only_backend,
            TestRebootstrapKeyStore::default(),
        )
    }

    #[cfg(test)]
    fn development_with_rebootstrap_custody_and_store(
        root: &DesktopApplicationRoot,
        native_root: std::path::PathBuf,
        account_id: &str,
        workspace_id: &str,
        device_id: &str,
        enable_test_create_only_backend: bool,
        test_store: TestRebootstrapKeyStore,
    ) -> Result<Self, DesktopBackupError> {
        let custody = if enable_test_create_only_backend {
            DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
                root, test_store,
            )
        } else {
            DesktopProductionCustody::load_or_create(root)
        }
        .map_err(|_| DesktopBackupError::StorageRejected)?;
        let database = custody
            .open_workspace(workspace_id)
            .map_err(map_database_error)?;
        let journal = custody
            .rebootstrap_journal_store()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let mut host =
            Self::development(database, native_root, account_id, workspace_id, device_id)?;
        host.production_custody = Some(Mutex::new(custody));
        host.rebootstrap_runtime = Some(if enable_test_create_only_backend {
            RebootstrapRuntime::for_test_recovery(journal)
        } else {
            RebootstrapRuntime::new(journal)
        });
        host.rebootstrap_test_executor_enabled = enable_test_create_only_backend;
        Ok(host)
    }

    #[cfg(test)]
    fn restart_host_without_authority_for_test(
        root: DesktopApplicationRoot,
        custody: Option<DesktopProductionCustody>,
        rebootstrap: RebootstrapRuntime,
        quarantine_custody: Option<TestRebootstrapQuarantineCustody>,
    ) -> Self {
        let mut host = Self::production_unavailable();
        host.application_root = Some(root);
        host.production_custody = custody.map(Mutex::new);
        host.rebootstrap_runtime = Some(rebootstrap);
        host.rebootstrap_test_executor_enabled = true;
        if quarantine_custody.is_some() {
            host.authority_publication
                .get_mut()
                .expect("new Host authority mutex is not poisoned")
                .restriction = RuntimeRestriction::SecurityLocked;
        }
        host.rebootstrap_quarantine_custody = quarantine_custody;
        host
    }

    #[cfg(test)]
    fn restart_rebootstrap_for_test(
        root: DesktopApplicationRoot,
        store: TestRebootstrapKeyStore,
        workspace_id: &str,
    ) -> Result<(Self, RebootstrapRestartDisposition), DesktopLocalHostError> {
        Self::restart_rebootstrap_until_for_test(root, store, workspace_id, None)
    }

    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the restart harness keeps every journal disposition in one exhaustive protocol match"
    )]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the restart harness models transfer of the process-owned test Keychain store"
    )]
    fn restart_rebootstrap_until_for_test(
        root: DesktopApplicationRoot,
        store: TestRebootstrapKeyStore,
        workspace_id: &str,
        crash_boundary: Option<TestRebootstrapCrashBoundary>,
    ) -> Result<(Self, RebootstrapRestartDisposition), DesktopLocalHostError> {
        let bootstrap = TestRebootstrapRecoveryCustody::open(&root, store.clone())
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let before_classification = bootstrap
            .state_digest()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let quarantine_custody = bootstrap
            .quarantine_custody()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let journal = bootstrap
            .journal_store()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let rebootstrap = RebootstrapRuntime::for_test_recovery(journal);
        let action = rebootstrap
            .startup_action()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;

        match action {
            StartupRebootstrapAction::Discard(action) => {
                let Ok(classified) = bootstrap.classify_discard(&action, workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let custody = match crash_boundary {
                    Some(boundary) => classified.discard_with_crash_for_test(boundary),
                    None => classified.discard(),
                }
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                rebootstrap
                    .confirm_discarded(action)
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        Some(custody),
                        rebootstrap,
                        None,
                    ),
                    RebootstrapRestartDisposition::CancelledUnpublished,
                ))
            }
            StartupRebootstrapAction::Recover(action) => {
                let Ok(classified) = bootstrap.classify_recovery(&action, workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let disposition = classified.disposition();
                let action = rebootstrap
                    .resolve_recovery(action, disposition)
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                match disposition {
                    RecoveryDisposition::CancelUnpublishedCandidate => {
                        let custody = match crash_boundary {
                            Some(boundary) => {
                                classified.cancel_unpublished_with_crash_for_test(boundary)
                            }
                            None => classified.cancel_unpublished(),
                        }
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        rebootstrap
                            .confirm_recovery_cancelled(action)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        Ok((
                            Self::restart_host_without_authority_for_test(
                                root,
                                Some(custody),
                                rebootstrap,
                                None,
                            ),
                            RebootstrapRestartDisposition::CancelledUnpublished,
                        ))
                    }
                    RecoveryDisposition::ResumeCandidate => {
                        if classified.is_retirement_prefix() {
                            let custody = classified
                                .resume_retirement_prefix()
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            let retire = rebootstrap
                                .confirm_recovery_reopened(action)
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            rebootstrap
                                .confirm_retired(retire)
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            custody
                                .opaque_rebootstrap_state_digest_for_test()
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            return Ok((
                                Self::restart_host_without_authority_for_test(
                                    root,
                                    Some(custody),
                                    rebootstrap,
                                    None,
                                ),
                                RebootstrapRestartDisposition::ResumedPublished,
                            ));
                        }
                        let verified = classified
                            .verify_post_exchange()
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        assert_eq!(
                            before_classification,
                            verified
                                .state_digest()
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?
                        );
                        let (custody, publication) = verified
                            .admit()
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        let retire = rebootstrap
                            .confirm_recovery_reopened(action)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        custody
                            .retire_rebootstrap_old(publication)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        rebootstrap
                            .confirm_retired(retire)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        custody
                            .opaque_rebootstrap_state_digest_for_test()
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        Ok((
                            Self::restart_host_without_authority_for_test(
                                root,
                                Some(custody),
                                rebootstrap,
                                None,
                            ),
                            RebootstrapRestartDisposition::ResumedPublished,
                        ))
                    }
                }
            }
            StartupRebootstrapAction::Terminal(action) => {
                let Ok(classified) = bootstrap.classify_terminal(&action, workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let custody = classified
                    .admit()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        Some(custody),
                        rebootstrap,
                        None,
                    ),
                    RebootstrapRestartDisposition::TerminalValidated,
                ))
            }
            StartupRebootstrapAction::None => {
                let Ok(classified) = bootstrap.classify_clean(workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let custody = classified
                    .admit()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        Some(custody),
                        rebootstrap,
                        None,
                    ),
                    RebootstrapRestartDisposition::CleanValidated,
                ))
            }
            StartupRebootstrapAction::Quarantined => {
                let after_rejection = quarantine_custody
                    .state_digest(&store)
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                assert_eq!(before_classification, after_rejection);
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        None,
                        rebootstrap,
                        Some(quarantine_custody),
                    ),
                    RebootstrapRestartDisposition::Quarantined,
                ))
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn publish_transition_at_next_business_commit_for_test(
        &self,
    ) -> Result<u64, DesktopLocalHostError> {
        let requested = self
            .transition_requested_epoch
            .load(Ordering::Acquire)
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        self.business_commit_transition_epoch
            .store(requested, Ordering::Release);
        Ok(requested)
    }

    #[cfg(test)]
    fn publish_transition_at_restore_precommit_for_test(
        &self,
    ) -> Result<u64, DesktopLocalHostError> {
        self.schedule_restore_transition_for_test(&self.restore_precommit_transition_epoch)
    }

    #[cfg(test)]
    fn publish_transition_after_restore_commit_for_test(
        &self,
    ) -> Result<u64, DesktopLocalHostError> {
        self.schedule_restore_transition_for_test(&self.restore_postcommit_transition_epoch)
    }

    #[cfg(test)]
    fn schedule_restore_transition_for_test(
        &self,
        hook: &AtomicU64,
    ) -> Result<u64, DesktopLocalHostError> {
        let requested = self
            .transition_requested_epoch
            .load(Ordering::Acquire)
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        hook.store(requested, Ordering::Release);
        Ok(requested)
    }

    #[cfg(test)]
    fn publish_scheduled_restore_transition_for_test(&self, hook: &AtomicU64) {
        let requested = hook.swap(0, Ordering::AcqRel);
        if requested != 0 {
            self.transition_requested_epoch
                .store(requested, Ordering::Release);
        }
    }

    #[cfg(test)]
    fn renew_business_authority_for_test(
        &self,
        lease_epoch: u64,
    ) -> Result<(), DesktopLocalHostError> {
        let requested = self
            .transition_requested_epoch
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value
                    .checked_add(1)
                    .filter(|next| *next <= MAX_SAFE_INTEGER)
            })
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?
            .checked_add(1)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let current = authority
            .authority
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        if lease_epoch <= current.lease_epoch || lease_epoch > MAX_SAFE_INTEGER {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        current.lease_epoch = lease_epoch;
        current.generation = requested;
        current.trusted_time_floor = now;
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/BACKUP-AUTHORITY-TEST-RENEWAL-V1\0");
        for value in [
            current.account_id.as_bytes(),
            current.workspace_id.as_bytes(),
            current.device_id.as_bytes(),
        ] {
            digest.update(value.len().to_be_bytes());
            digest.update(value);
        }
        digest.update(lease_epoch.to_be_bytes());
        digest.update(requested.to_be_bytes());
        current.digest = digest.finalize().into();
        let sync = DesktopSyncRuntime::new(
            current.workspace_id.clone(),
            current.device_id.clone(),
            current.lease_epoch,
            current.trusted_time_floor,
            current.execute_before,
            hex_digest(&current.digest),
            requested,
        )
        .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?
            .sync = Some(sync);
        authority.applied_authority_epoch = requested;
        authority.restriction = RuntimeRestriction::Active;
        Ok(())
    }

    #[cfg(test)]
    fn request_security_lock_for_test(&self) -> Result<(), DesktopBackupError> {
        self.enter_security_lock().map_err(|error| match error {
            DesktopLocalHostError::AuthorityRejected => DesktopBackupError::AuthorityRejected,
            DesktopLocalHostError::StorageRejected
            | DesktopLocalHostError::ApplicationRootRejected
            | DesktopLocalHostError::CloudProtocolRejected
            | DesktopLocalHostError::Unavailable => DesktopBackupError::StorageRejected,
        })
    }

    #[cfg(test)]
    fn continuity_startup_for_test(&self) -> Result<StartupContinuity, DesktopBackupError> {
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let Some(manager) = authority.continuity.as_ref() else {
            return Err(DesktopBackupError::StorageRejected);
        };
        let Some(continuation) = authority.verified_continuation.as_ref() else {
            return Err(DesktopBackupError::AuthorityRejected);
        };
        let now = current_unix_seconds()?;
        manager
            .load_startup(&continuation.binding(), now, true, true)
            .map(|load| load.decision)
            .map_err(|_| DesktopBackupError::StorageRejected)
    }

    /// Returns only the redacted current workflow status.
    #[must_use]
    pub fn backup_status(&self) -> DesktopBackupRestoreStatus {
        let Ok(mut operation) = self.operation_selection.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Ok(authority) = self.authority_publication.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Some(current_authority) = authority.authority.as_ref() else {
            operation.export_operation_id = None;
            operation.selection_operation_id = None;
            operation.export_consumed = true;
            operation.selection_consumed = true;
            return DesktopBackupRestoreStatus::unavailable(None);
        };
        if !authority.native.is_qualified()
            || !current_authority.kind.can_export_or_inspect()
            || self.transition_requested_epoch.load(Ordering::Acquire)
                != authority.applied_authority_epoch
            || !current_authority.is_current_at(current_unix_seconds().unwrap_or(i64::MAX))
        {
            operation.export_operation_id = None;
            operation.selection_operation_id = None;
            operation.export_consumed = true;
            operation.selection_consumed = true;
            return DesktopBackupRestoreStatus::unavailable(None);
        }
        let Ok(export_operation_id) = random_identifier("export") else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Ok(selection_operation_id) = random_identifier("select") else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        operation.export_operation_id = Some(export_operation_id.clone());
        operation.selection_operation_id = Some(selection_operation_id.clone());
        operation.export_consumed = false;
        operation.selection_consumed = false;
        DesktopBackupRestoreStatus {
            schema_version: 1,
            kind: "local_backup_restore_status",
            authority: current_authority.kind.wire(),
            export_admission: ActionAdmission::Available {
                operation_id: export_operation_id,
            },
            artifact_selection_admission: ActionAdmission::Available {
                operation_id: selection_operation_id,
            },
            selected_artifact: operation.selected_artifact.as_ref().map_or(
                SelectedArtifactView::None,
                |artifact| SelectedArtifactView::Verified {
                    artifact_id: artifact.artifact_id.clone(),
                    created_at: artifact.created_at.clone(),
                    backup_schema_version: artifact.backup_schema_version,
                    compatibility: artifact.compatibility,
                    restore_admission: artifact.restore_admission.clone(),
                },
            ),
            error: None,
        }
    }

    /// Validates an untrusted export intent and performs the closed aggregate operation.
    ///
    /// # Errors
    ///
    /// Returns a coarse rejection without parser, authority, path, or key diagnostics.
    pub fn export_backup(
        &self,
        untrusted_request_wire: &[u8],
    ) -> Result<DesktopBackupExportStatus, DesktopBackupError> {
        let request: BackupExportRequest = parse_request(untrusted_request_wire)?;
        validate_schema_and_operation(request.schema_version, &request.operation_id)?;
        if request.include_platform_credentials {
            return Err(DesktopBackupError::CredentialsNotAllowed);
        }
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let mut authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        if operation.export_consumed
            || operation.export_operation_id.as_deref() != Some(request.operation_id.as_str())
        {
            return Err(DesktopBackupError::OperationRejected);
        }
        operation.export_consumed = true;
        let captured_epoch = self.require_current_authority(&authority, false)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let projection = runtime
            .as_mut()
            .ok_or(DesktopBackupError::AuthorityRejected)?
            .business
            .database_for_backup_mut()
            .backup_source()
            .snapshot()
            .map_err(map_database_error)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let current_authority = authority
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        if projection.workspace_id() != current_authority.workspace_id {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let frames = projection.data_frames();
        let data_plaintext_bytes = frames.iter().try_fold(0_u64, |total, frame| {
            total.checked_add(u64::try_from(frame.len()).ok()?)
        });
        let data_plaintext_bytes =
            data_plaintext_bytes.ok_or(DesktopBackupError::ArtifactRejected)?;
        let container = authority
            .container
            .as_ref()
            .ok_or(DesktopBackupError::KeyUnavailable)?;
        let created_at_epoch_seconds = u64::try_from(current_unix_seconds()?)
            .map_err(|_| DesktopBackupError::AuthorityRejected)?;
        let manifest = container.manifest(
            *projection.source_proof_digest(),
            1,
            created_at_epoch_seconds,
            u32::from(super::source::ALLOWLIST_VERSION),
            u32::try_from(frames.len()).map_err(|_| DesktopBackupError::ArtifactRejected)?,
            data_plaintext_bytes,
            current_authority.digest,
        );
        let sealed = container
            .export_at_epoch(
                ExportRequest::new(1, manifest, &frames),
                &self.transition_requested_epoch,
                captured_epoch,
            )
            .map_err(map_container_error)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let staged = authority
            .native
            .stage_publication(&request.operation_id, sealed.bytes())?;
        if let Err(error) = self.require_captured_epoch(&authority, captured_epoch, false) {
            authority.native.quarantine(&staged);
            return Err(error);
        }
        // Catalog visibility is the operation's linearization point. A transition publishes its
        // pending epoch before waiting for this authority guard; an intent observed above aborts,
        // while an intent published after the check is ordered after this guarded commit.
        authority.native.mark_available(&staged)?;
        Ok(DesktopBackupExportStatus::completed())
    }

    /// Selects and fully authenticates a native artifact without exposing its handle or bytes.
    ///
    /// # Errors
    ///
    /// Returns a coarse rejection without parser, authority, path, or key diagnostics.
    #[allow(
        clippy::too_many_lines,
        reason = "selection admission, authentication, and retained CAS state stay contiguous"
    )]
    pub fn inspect_backup(
        &self,
        untrusted_request_wire: &[u8],
    ) -> Result<DesktopVerifiedBackupArtifact, DesktopBackupError> {
        let request: BackupArtifactSelectRequest = parse_request(untrusted_request_wire)?;
        validate_schema_and_operation(request.schema_version, &request.operation_id)?;
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        if operation.selection_consumed
            || operation.selection_operation_id.as_deref() != Some(request.operation_id.as_str())
        {
            return Err(DesktopBackupError::OperationRejected);
        }
        operation.selection_consumed = true;
        operation.selected_handle = None;
        operation.selected_artifact = None;
        let captured_epoch = self.require_current_authority(&authority, false)?;
        let handle = authority.native.select()?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let artifact_bytes = authority.native.read(&handle)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let candidate_set_version = operation
            .generation
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(DesktopBackupError::StorageRejected)?;
        let container = authority
            .container
            .as_ref()
            .ok_or(DesktopBackupError::KeyUnavailable)?;
        let (verified, ()) = container
            .import_at_epoch(
                &artifact_bytes,
                &self.transition_requested_epoch,
                captured_epoch,
                |backup_id, source_proof, frames| {
                    let artifact_id = opaque_artifact_id(backup_id);
                    let candidate = IsolatedBackupCandidate::from_authenticated_frames(
                        &artifact_id,
                        candidate_set_version,
                        source_proof,
                        frames,
                    )
                    .map_err(|_| ())?;
                    drop(candidate);
                    Ok(())
                },
            )
            .map_err(map_container_error)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let current_revision = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?
            .business
            .recovery_proof()
            .map_err(map_database_error)?
            .local_commit_sequence;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let artifact_id = opaque_artifact_id(verified.backup_id());
        let compatibility = if verified.workspace_schema_version() == 1
            && verified.allowlist_version()
                == u32::from(super::source::BackupProjection::allowlist_version())
        {
            "compatible"
        } else {
            "unsupported_schema"
        };
        let restore_admission = if authority
            .authority
            .as_ref()
            .is_some_and(|current| current.kind == BackupAuthorityKind::Active)
            && compatibility == "compatible"
        {
            RestoreAdmission::Available {
                operation_id: random_identifier("restore")?,
                dialog_id: random_identifier("dialog")?,
                expected_current_revision: current_revision,
                candidate_set_version,
            }
        } else {
            RestoreAdmission::Unavailable
        };
        let artifact = DesktopVerifiedBackupArtifact {
            state: "verified",
            artifact_id,
            created_at: format_timestamp(
                i64::try_from(verified.created_at_epoch_seconds())
                    .map_err(|_| DesktopBackupError::ArtifactRejected)?,
            ),
            backup_schema_version: verified.workspace_schema_version(),
            compatibility,
            restore_admission,
        };
        operation.selected_handle = Some(handle);
        operation.selected_artifact = Some(artifact.clone());
        operation.selected_authority_generation = authority
            .authority
            .as_ref()
            .map(|current| current.generation);
        operation.selected_authority_digest =
            authority.authority.as_ref().map(|current| current.digest);
        operation.generation = candidate_set_version;
        Ok(artifact)
    }

    /// Reauthenticates the exact admitted artifact and applies it under the owned DB writer.
    ///
    /// # Errors
    ///
    /// Returns a coarse rejection without parser, authority, path, or key diagnostics.
    #[allow(
        clippy::too_many_lines,
        reason = "reread, reauthentication, current-DB transaction, and final fence stay contiguous"
    )]
    pub fn restore_backup(
        &self,
        untrusted_request_wire: &[u8],
    ) -> Result<DesktopBackupRestoreStatus, DesktopBackupError> {
        let request: BackupRestoreRequest = parse_request(untrusted_request_wire)?;
        validate_restore_request(&request)?;
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let selected = operation
            .selected_artifact
            .take()
            .ok_or(DesktopBackupError::OperationRejected)?;
        let restore_admission = match selected.restore_admission {
            RestoreAdmission::Available {
                operation_id,
                dialog_id,
                expected_current_revision,
                candidate_set_version,
            } => (
                operation_id,
                dialog_id,
                expected_current_revision,
                candidate_set_version,
            ),
            RestoreAdmission::Unavailable => return Err(DesktopBackupError::AuthorityRejected),
        };
        if request.operation_id != restore_admission.0
            || request.dialog_id != restore_admission.1
            || request.artifact_id != selected.artifact_id
            || request.expected_current_revision != restore_admission.2
            || request.candidate_set_version != restore_admission.3
        {
            return Err(DesktopBackupError::OperationRejected);
        }
        let captured_epoch = self.require_current_authority(&authority, true)?;
        let handle = operation
            .selected_handle
            .take()
            .ok_or(DesktopBackupError::OperationRejected)?;
        let artifact_bytes = authority.native.read(&handle)?;
        self.require_captured_epoch(&authority, captured_epoch, true)?;
        let current_authority = authority
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        if operation.selected_authority_generation != Some(current_authority.generation)
            || operation.selected_authority_digest != Some(current_authority.digest)
        {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let authority_digest = hex_digest(&current_authority.digest);
        let restore_authority = super::restore::RestoreAuthoritySnapshot {
            authority_snapshot_digest: authority_digest.clone(),
            source_device_id: current_authority.device_id.clone(),
            active_lease_epoch: current_authority.lease_epoch,
            committed_at: format_timestamp(current_unix_seconds()?),
        };
        let restore_request = super::restore::RestoreRequest {
            operation_id: &request.operation_id,
            expected_current_revision: request.expected_current_revision,
            expected_candidate_set_version: request.candidate_set_version,
            expected_authority_snapshot_digest: &authority_digest,
        };
        let execute_before = current_authority.execute_before;
        let trusted_time_floor = current_authority.trusted_time_floor;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let database = runtime
            .as_mut()
            .ok_or(DesktopBackupError::AuthorityRejected)?
            .business
            .database_for_backup_mut();
        let container = authority
            .container
            .as_ref()
            .ok_or(DesktopBackupError::KeyUnavailable)?;
        let (_, restore_result) = container
            .import_at_epoch(
                &artifact_bytes,
                &self.transition_requested_epoch,
                captured_epoch,
                |backup_id, source_proof, frames| {
                    if opaque_artifact_id(backup_id) != request.artifact_id {
                        return Err(());
                    }
                    let candidate = IsolatedBackupCandidate::from_authenticated_frames(
                        &request.artifact_id,
                        request.candidate_set_version,
                        source_proof,
                        frames,
                    )
                    .map_err(|_| ())?;
                    let mut authority_guard = ();
                    let result = database.restore_backup_candidate_guarded(
                        &candidate,
                        &restore_request,
                        &mut authority_guard,
                        &restore_authority,
                        |(), _| {
                            #[cfg(test)]
                            self.publish_scheduled_restore_transition_for_test(
                                &self.restore_precommit_transition_epoch,
                            );
                            let now = current_unix_seconds()
                                .map_err(|_| BusinessDatabaseError::MutationStale)?;
                            if self.transition_requested_epoch.load(Ordering::Acquire)
                                != captured_epoch
                                || now < trusted_time_floor
                                || now >= execute_before
                            {
                                Err(BusinessDatabaseError::MutationStale)
                            } else {
                                Ok(())
                            }
                        },
                    );
                    #[cfg(test)]
                    if result.is_ok() {
                        // The database callback has crossed SQLite COMMIT. Publishing a later
                        // transition intent here must not rewrite that durable outcome as failure.
                        self.publish_scheduled_restore_transition_for_test(
                            &self.restore_postcommit_transition_epoch,
                        );
                    }
                    drop(candidate);
                    Ok(result)
                },
            )
            .map_err(map_container_error)?;
        restore_result.map_err(map_database_error)?;
        operation.selected_handle = None;
        operation.selected_artifact = None;
        operation.selected_authority_generation = None;
        operation.selected_authority_digest = None;
        Ok(DesktopBackupRestoreStatus {
            schema_version: 1,
            kind: "local_backup_restore_status",
            authority: "active",
            export_admission: ActionAdmission::Unavailable,
            artifact_selection_admission: ActionAdmission::Unavailable,
            selected_artifact: SelectedArtifactView::None,
            error: None,
        })
    }

    /// Cancels private selection state and returns the resulting redacted status.
    #[must_use]
    pub fn cancel_backup(&self) -> DesktopBackupRestoreStatus {
        let Ok(mut operation) = self.operation_selection.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Ok(authority) = self.authority_publication.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        operation.selected_handle = None;
        operation.selected_artifact = None;
        operation.selected_authority_generation = None;
        operation.selected_authority_digest = None;
        operation.export_operation_id = None;
        operation.selection_operation_id = None;
        operation.export_consumed = true;
        operation.selection_consumed = true;
        operation.generation = operation.generation.saturating_add(1);
        drop(authority);
        drop(operation);
        self.backup_status()
    }
}

fn current_unix_seconds() -> Result<i64, DesktopBackupError> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DesktopBackupError::AuthorityRejected)?
        .as_secs();
    i64::try_from(seconds).map_err(|_| DesktopBackupError::AuthorityRejected)
}

fn hex_nibble(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'a'..=b'f' => value - b'a' + 10,
        _ => 0,
    }
}

fn clear_operation_state(operation: &mut BackupOperationState) {
    operation.selected_handle = None;
    operation.selected_artifact = None;
    operation.selected_authority_generation = None;
    operation.selected_authority_digest = None;
    operation.export_operation_id = None;
    operation.selection_operation_id = None;
    operation.export_consumed = true;
    operation.selection_consumed = true;
}

#[cfg(test)]
fn digest_component(label: &[u8], value: &[u8]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/GDBK-BINDING-COMPONENT-V1\0");
    digest.update(label.len().to_be_bytes());
    digest.update(label);
    digest.update(value.len().to_be_bytes());
    digest.update(value);
    digest.finalize().into()
}

fn opaque_artifact_id(backup_id: &[u8; 16]) -> String {
    let mut output = String::with_capacity(9 + (backup_id.len() * 2));
    output.push_str("artifact-");
    for byte in backup_id {
        use std::fmt::Write;
        write!(&mut output, "{byte:02x}").expect("writing to a String cannot fail");
    }
    output
}

fn hex_digest(digest: &[u8; 32]) -> String {
    let mut output = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write;
        write!(&mut output, "{byte:02x}").expect("writing to a String cannot fail");
    }
    output
}

#[cfg(test)]
fn rebootstrap_binding_digest(authority: &PrivateBackupAuthority) -> String {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-BINDING-V1\0");
    for component in [
        authority.account_id.as_bytes(),
        authority.workspace_id.as_bytes(),
        authority.device_id.as_bytes(),
    ] {
        digest.update(component.len().to_be_bytes());
        digest.update(component);
    }
    hex_digest(&digest.finalize().into())
}

#[cfg(test)]
fn rebootstrap_floor_digest(authority: &PrivateBackupAuthority) -> String {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/REBOOTSTRAP-FLOORS-V1\0");
    digest.update(authority.account_security_epoch.to_be_bytes());
    digest.update(authority.lease_epoch.to_be_bytes());
    digest.update(authority.entitlement_revision.to_be_bytes());
    digest.update(authority.trusted_time_floor.to_be_bytes());
    digest.update(authority.execute_before.to_be_bytes());
    hex_digest(&digest.finalize().into())
}

fn format_timestamp(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(month <= 2);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn map_container_error(error: BackupContainerError) -> DesktopBackupError {
    match error {
        BackupContainerError::ArtifactRejected => DesktopBackupError::ArtifactRejected,
        BackupContainerError::KeyUnavailable => DesktopBackupError::KeyUnavailable,
        BackupContainerError::AuthorityRejected => DesktopBackupError::AuthorityRejected,
    }
}

fn map_database_error(error: BusinessDatabaseError) -> DesktopBackupError {
    match error {
        BusinessDatabaseError::MutationStale => DesktopBackupError::AuthorityRejected,
        BusinessDatabaseError::MutationConflict => DesktopBackupError::ConflictRejected,
        BusinessDatabaseError::InvalidInput | BusinessDatabaseError::RevisionRejected => {
            DesktopBackupError::OperationRejected
        }
        _ => DesktopBackupError::StorageRejected,
    }
}

fn map_host_database_error(error: BusinessDatabaseError) -> DesktopLocalHostError {
    match error {
        BusinessDatabaseError::WorkspaceRejected | BusinessDatabaseError::MutationStale => {
            DesktopLocalHostError::AuthorityRejected
        }
        _ => DesktopLocalHostError::StorageRejected,
    }
}

fn map_sync_error(error: DesktopSyncError) -> DesktopLocalHostError {
    match error {
        DesktopSyncError::StaleAuthority
        | DesktopSyncError::Blocked
        | DesktopSyncError::InvalidInput
        | DesktopSyncError::AcknowledgementMismatch => DesktopLocalHostError::AuthorityRejected,
        DesktopSyncError::StorageRejected => DesktopLocalHostError::StorageRejected,
    }
}

fn closed_business_status(
    state: DesktopLocalBusinessState,
    read_generation: u64,
) -> DesktopLocalBusinessStatus {
    DesktopLocalBusinessStatus {
        schema_version: 2,
        state,
        capabilities: Vec::new(),
        read_generation,
    }
}

fn parse_request<T: DeserializeOwned>(wire: &[u8]) -> Result<T, DesktopBackupError> {
    if wire.is_empty() || wire.len() > MAX_REQUEST_WIRE_BYTES {
        return Err(DesktopBackupError::OperationRejected);
    }
    let mut deserializer = serde_json::Deserializer::from_slice(wire);
    let request =
        T::deserialize(&mut deserializer).map_err(|_| DesktopBackupError::OperationRejected)?;
    deserializer
        .end()
        .map_err(|_| DesktopBackupError::OperationRejected)?;
    Ok(request)
}

fn validate_schema_and_operation(
    schema_version: u8,
    operation_id: &str,
) -> Result<(), DesktopBackupError> {
    if schema_version != 1 || !valid_opaque_identifier(operation_id) {
        return Err(DesktopBackupError::OperationRejected);
    }
    Ok(())
}

fn random_identifier(prefix: &str) -> Result<String, DesktopBackupError> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| DesktopBackupError::StorageRejected)?;
    let mut output = String::with_capacity(prefix.len() + 1 + (random.len() * 2));
    output.push_str(prefix);
    output.push('-');
    for byte in random {
        use std::fmt::Write;
        write!(&mut output, "{byte:02x}").map_err(|_| DesktopBackupError::StorageRejected)?;
    }
    Ok(output)
}

fn validate_restore_request(request: &BackupRestoreRequest) -> Result<(), DesktopBackupError> {
    validate_schema_and_operation(request.schema_version, &request.operation_id)?;
    if !valid_opaque_identifier(&request.dialog_id)
        || !valid_opaque_identifier(&request.artifact_id)
        || request.expected_current_revision > MAX_SAFE_INTEGER
        || request.candidate_set_version == 0
        || request.candidate_set_version > MAX_SAFE_INTEGER
        || request.confirmation != REQUIRED_CONFIRMATION
    {
        return Err(DesktopBackupError::OperationRejected);
    }
    Ok(())
}

fn valid_opaque_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    (OPAQUE_IDENTIFIER_MIN_BYTES..=OPAQUE_IDENTIFIER_MAX_BYTES).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use crate::active_workspace::business::{
        TestActiveRebootstrapJournalLinkSnapshot, TestRebootstrapJournalLinkHostileCase,
    };
    use crate::{DomainAssetWrite, LocalDatabaseKey};
    use base64::Engine as _;
    #[cfg(unix)]
    use std::io::Write as _;
    use tempfile::{TempDir, tempdir};

    const OPERATION_ID: &str = "operation-opaque-0001";

    fn rebootstrap_fixture_digest(domain: &[u8], value: &serde_json::Value) -> String {
        let mut encoded = Vec::new();
        rebootstrap_fixture_frame(&mut encoded, b'd', domain);
        rebootstrap_fixture_frame(
            &mut encoded,
            b'v',
            &rebootstrap_fixture_canonical_wire(value),
        );
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(encoded))
    }

    fn rebootstrap_fixture_canonical_wire(value: &serde_json::Value) -> Vec<u8> {
        let mut output = Vec::new();
        match value {
            serde_json::Value::Null => output.extend_from_slice(b"z0:"),
            serde_json::Value::Bool(value) => {
                output.extend_from_slice(if *value { b"b1:1" } else { b"b1:0" });
            }
            serde_json::Value::Number(value) => rebootstrap_fixture_frame(
                &mut output,
                b'n',
                value
                    .as_i64()
                    .expect("fixture numbers are signed integers")
                    .to_string()
                    .as_bytes(),
            ),
            serde_json::Value::String(value) => {
                rebootstrap_fixture_frame(&mut output, b's', value.as_bytes());
            }
            serde_json::Value::Array(values) => {
                let mut entries = Vec::new();
                for value in values {
                    rebootstrap_fixture_frame(
                        &mut entries,
                        b'e',
                        &rebootstrap_fixture_canonical_wire(value),
                    );
                }
                rebootstrap_fixture_frame(&mut output, b'a', &entries);
            }
            serde_json::Value::Object(values) => {
                let mut keys = values.keys().collect::<Vec<_>>();
                keys.sort_unstable();
                let mut entries = Vec::new();
                for key in keys {
                    let mut entry = Vec::new();
                    rebootstrap_fixture_frame(&mut entry, b'k', key.as_bytes());
                    rebootstrap_fixture_frame(
                        &mut entry,
                        b'v',
                        &rebootstrap_fixture_canonical_wire(&values[key]),
                    );
                    rebootstrap_fixture_frame(&mut entries, b'e', &entry);
                }
                rebootstrap_fixture_frame(&mut output, b'o', &entries);
            }
        }
        output
    }

    fn rebootstrap_fixture_frame(output: &mut Vec<u8>, tag: u8, payload: &[u8]) {
        output.push(tag);
        output.extend_from_slice(payload.len().to_string().as_bytes());
        output.push(b':');
        output.extend_from_slice(payload);
    }

    fn nonempty_rebootstrap_fixture(workspace_id: &str) -> (Vec<u8>, Vec<u8>) {
        let snapshot = serde_json::json!([{
            "entityId": "candidate-remote.example",
            "note": "candidate-only",
            "portfolioId": null,
            "tags": ["candidate"],
            "targetPrice": null,
        }]);
        let partition_digest =
            rebootstrap_fixture_digest(b"GOODDEALER-WORKSPACE-DOMAIN-ASSET-V1", &snapshot);
        let checkpoint_digest = rebootstrap_fixture_digest(
            b"GOODDEALER-WORKSPACE-ENTITY-DIGESTS-V2",
            &serde_json::json!([{
                "entityType": "domain_asset",
                "partitionId": "p0000",
                "digest": partition_digest,
            }]),
        );
        let checkpoint = serde_json::json!({
            "schemaVersion": 2,
            "checkpointId": "checkpoint-nonempty-fixture",
            "workspaceId": workspace_id,
            "workspaceSchemaVersion": 1,
            "throughServerRevision": 1,
            "checkpointDigest": checkpoint_digest,
        });
        let mut plan = serde_json::json!({
            "schemaVersion": 2,
            "checkpoint": checkpoint,
            "snapshot": snapshot,
            "requiredMutationRange": {
                "fromServerRevisionExclusive": 1,
                "throughServerRevisionInclusive": 1,
            },
            "mutations": [],
            "pinnedHeadRevision": 1,
        });
        let pinned_digest =
            rebootstrap_fixture_digest(b"GOODDEALER-WORKSPACE-REBOOTSTRAP-PLAN-V2", &plan);
        plan.as_object_mut()
            .expect("fixture plan is an object")
            .insert(
                "pinnedHeadDigest".to_owned(),
                serde_json::Value::String(pinned_digest),
            );
        (
            serde_json::to_vec(&plan["checkpoint"]).expect("fixture checkpoint serializes"),
            serde_json::to_vec(&plan).expect("fixture plan serializes"),
        )
    }

    #[cfg(unix)]
    fn seed_rebootstrap_crash(
        boundary: RebootstrapCrashBoundary,
    ) -> (TempDir, DesktopApplicationRoot, TestRebootstrapKeyStore) {
        let directory = tempdir().unwrap();
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let host = DesktopLocalHost::development_with_rebootstrap_custody_and_store(
            &root,
            application_path.join("native-backup-crash-driver"),
            "account-local",
            "workspace-local",
            "device-local",
            true,
            store.clone(),
        )
        .unwrap_or_else(|error| {
            panic!("failed to construct crash fixture for {boundary:?}: {error:?}")
        });
        host.runtime_state
            .lock()
            .unwrap()
            .as_mut()
            .expect("fixture starts with a business runtime")
            .business
            .database_for_backup_mut()
            .upsert_domain_asset(
                "seed-old-local-0001",
                "2026-09-16T00:00:00Z",
                &DomainAssetWrite {
                    entity_id: "old-local.example".to_owned(),
                    note: Some("old-only".to_owned()),
                    portfolio_id: None,
                    tags: vec!["old".to_owned()],
                    target_price: None,
                },
            )
            .unwrap_or_else(|error| panic!("failed to seed old row for {boundary:?}: {error:?}"));
        let seeded = host
            .read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
            .unwrap();
        assert_eq!(seeded.total_rows, 1);
        assert_eq!(seeded.window.rows[0].domain, "old-local.example");
        let (checkpoint, plan) = nonempty_rebootstrap_fixture("workspace-local");

        assert_eq!(
            host.apply_rebootstrap_plan_until_for_test(&checkpoint, &plan, boundary),
            Ok(()),
            "failed to reach {boundary:?}"
        );
        drop(host);
        (directory, root, store)
    }

    #[cfg(unix)]
    fn seed_cancel_restart_crash_from(
        source: RebootstrapCrashBoundary,
        boundary: RebootstrapCrashBoundary,
    ) -> (TempDir, DesktopApplicationRoot, TestRebootstrapKeyStore) {
        let custody_boundary = match boundary {
            RebootstrapCrashBoundary::CancelCandidateFileUnlinked => {
                TestRebootstrapCrashBoundary::AfterCancelCandidateFileUnlinkAndDirectoryFsync
            }
            RebootstrapCrashBoundary::CancelCandidateSlotDeleted => {
                TestRebootstrapCrashBoundary::AfterCancelCandidateSlotDeleteAndAbsentReadback
            }
            RebootstrapCrashBoundary::CancelAliasRepaired => {
                TestRebootstrapCrashBoundary::AfterCancelAliasRepairAndReadback
            }
            RebootstrapCrashBoundary::CancelOldSlotDeleted => {
                TestRebootstrapCrashBoundary::AfterCancelOldSlotDeleteAndAbsentReadback
            }
            _ => panic!("{boundary:?} is not a cancel-restart crash boundary"),
        };
        let (directory, root, store) = seed_rebootstrap_crash(source);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        assert_eq!(
            DesktopLocalHost::restart_rebootstrap_until_for_test(
                root,
                store.clone(),
                "workspace-local",
                Some(custody_boundary),
            )
            .unwrap_err(),
            DesktopLocalHostError::StorageRejected,
            "failed to stop at cancel crash boundary {boundary:?}"
        );
        let restarted_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        (directory, restarted_root, store)
    }

    fn is_cancel_restart_crash(boundary: RebootstrapCrashBoundary) -> bool {
        matches!(
            boundary,
            RebootstrapCrashBoundary::CancelCandidateFileUnlinked
                | RebootstrapCrashBoundary::CancelCandidateSlotDeleted
                | RebootstrapCrashBoundary::CancelAliasRepaired
                | RebootstrapCrashBoundary::CancelOldSlotDeleted
        )
    }

    fn activate_recovered_host(
        host: &mut DesktopLocalHost,
        name: &str,
        boundary: RebootstrapCrashBoundary,
    ) {
        let (verifier, signed_wire) = super::super::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
        let device_id = host
            .production_custody
            .as_ref()
            .expect("coherent restart retains custody")
            .lock()
            .unwrap()
            .load_device_id()
            .unwrap();
        assert_eq!(device_id, "device-local", "device mismatch for {name}");
        VerifiedBackupAuthority::verify(
            &signed_wire,
            &TrustedBackupBinding {
                account_id: None,
                device_id: &device_id,
                minimum_account_security_epoch: 0,
                minimum_lease_epoch: 0,
            },
            current_unix_seconds().unwrap(),
            &verifier,
        )
        .unwrap_or_else(|error| {
            panic!("fresh Grant verification failed for {name}/{boundary:?}: {error:?}")
        });
        host.authority_verifier = Some(verifier);
        host.activate_authorization_grant(&signed_wire)
            .unwrap_or_else(|error| {
                panic!("fresh Grant failed for {name}/{boundary:?}: {error:?}")
            });
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::Active
        );
    }

    fn activate_recovered_host_and_assert_business(
        host: &mut DesktopLocalHost,
        disposition: RebootstrapRestartDisposition,
        name: &str,
        boundary: RebootstrapCrashBoundary,
    ) {
        activate_recovered_host(host, name, boundary);
        let snapshot = host
            .read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
            .unwrap();
        let expected_count = if disposition == RebootstrapRestartDisposition::CancelledUnpublished {
            1
        } else {
            2
        };
        assert_eq!(
            snapshot.total_rows, expected_count,
            "wrong row count for {name}"
        );
        let domains = snapshot
            .window
            .rows
            .iter()
            .map(|row| row.domain.as_str())
            .collect::<Vec<_>>();
        assert!(domains.contains(&"old-local.example"));
        assert_eq!(
            domains.contains(&"candidate-remote.example"),
            disposition != RebootstrapRestartDisposition::CancelledUnpublished,
            "wrong selected database for {name}/{boundary:?}: {domains:?}"
        );
        let detail_request = |entity_id: &str| {
            serde_json::from_value::<DesktopDomainDetailReadRequest>(serde_json::json!({
                "entityId": entity_id,
            }))
            .unwrap()
        };
        let old_detail = host
            .read_domain_detail(detail_request("old-local.example"))
            .unwrap();
        assert_eq!(old_detail.asset.note.as_deref(), Some("old-only"));
        if disposition == RebootstrapRestartDisposition::CancelledUnpublished {
            assert!(
                host.read_domain_detail(detail_request("candidate-remote.example"))
                    .is_err()
            );
        } else {
            let candidate_detail = host
                .read_domain_detail(detail_request("candidate-remote.example"))
                .unwrap();
            assert_eq!(
                candidate_detail.asset.note.as_deref(),
                Some("candidate-only")
            );
        }
        let mut runtime = host.runtime_state.lock().unwrap();
        let database = runtime
            .as_mut()
            .expect("fresh Grant installs the business runtime")
            .business
            .database_for_backup_mut();
        let portfolio = database.read_portfolio().unwrap();
        assert_eq!(
            portfolio.applied_through_server_revision,
            u64::from(disposition != RebootstrapRestartDisposition::CancelledUnpublished)
        );
        let pending = database.test_pending_sync_rows(10).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].mutation_id, "seed-old-local-0001");
        assert_eq!(pending[0].entity_id, "old-local.example");
        assert!(pending[0].mutation_payload_json.contains("old-only"));
        assert!(!pending[0].mutation_payload_json.contains("candidate-only"));
        let proof = database.recovery_proof().unwrap();
        assert_eq!(proof.workspace_id, "workspace-local");
        assert_eq!(
            proof.applied_server_revision,
            portfolio.applied_through_server_revision
        );
        assert_eq!(proof.local_commit_sequence, 1);
        assert_eq!(proof.next_device_mutation_sequence, 2);
        drop(runtime);
        assert!(host.begin_sync_run().is_ok());
    }

    fn mutate_recovered_asset(
        host: &DesktopLocalHost,
        entity_id: &str,
        mutation_id: &str,
        note: &str,
        tags: &[&str],
    ) {
        let detail = host
            .read_domain_detail(
                serde_json::from_value(serde_json::json!({"entityId": entity_id})).unwrap(),
            )
            .unwrap_or_else(|error| panic!("failed to read {entity_id} before edit: {error:?}"));
        let read_generation = host.business_status().read_generation;
        host.edit_domain_asset(
            serde_json::from_value(serde_json::json!({
                "mutationId": mutation_id,
                "expectedReadGeneration": read_generation,
                "expectedAssetVersion": detail.asset.asset_version,
                "asset": {
                    "entityId": entity_id,
                    "note": note,
                    "portfolioId": null,
                    "tags": tags,
                    "targetPrice": null
                }
            }))
            .unwrap(),
        )
        .unwrap_or_else(|error| panic!("failed to edit {entity_id}: {error:?}"));
    }

    fn recovered_business_proof(host: &DesktopLocalHost) -> crate::DatabaseRecoveryProof {
        host.runtime_state
            .lock()
            .unwrap()
            .as_ref()
            .expect("active recovered Host retains a business runtime")
            .business
            .database_for_backup()
            .recovery_proof()
            .unwrap()
    }

    #[cfg(unix)]
    fn active_publication_link_snapshot(
        host: &DesktopLocalHost,
    ) -> TestActiveRebootstrapJournalLinkSnapshot {
        host.runtime_state
            .lock()
            .unwrap()
            .as_ref()
            .expect("active recovered Host retains a business runtime")
            .business
            .database_for_backup()
            .active_rebootstrap_journal_link_snapshot_for_test()
            .unwrap()
    }

    #[cfg(unix)]
    fn apply_publication_link_hostile_case(
        host: &DesktopLocalHost,
        hostile_case: TestRebootstrapJournalLinkHostileCase,
    ) {
        host.runtime_state
            .lock()
            .unwrap()
            .as_mut()
            .expect("active recovered Host retains a business runtime")
            .business
            .database_for_backup_mut()
            .apply_rebootstrap_journal_link_hostile_case_for_test(hostile_case)
            .unwrap();
    }

    fn encrypted_database_state_digest(database_path: &std::path::Path) -> [u8; 32] {
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/TEST/ENCRYPTED-DATABASE-STATE-V1\0");
        for suffix in ["", "-wal", "-journal"] {
            let path = if suffix.is_empty() {
                database_path.to_path_buf()
            } else {
                std::path::PathBuf::from(format!("{}{suffix}", database_path.display()))
            };
            match std::fs::read(path) {
                Ok(bytes) => {
                    digest.update([1]);
                    digest.update((bytes.len() as u64).to_be_bytes());
                    digest.update(Sha256::digest(bytes));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => digest.update([0]),
                Err(error) => panic!("failed to read encrypted database state: {error}"),
            }
        }
        digest.finalize().into()
    }

    fn assert_recovered_note(host: &DesktopLocalHost, entity_id: &str, expected_note: &str) {
        let detail = host
            .read_domain_detail(
                serde_json::from_value(serde_json::json!({"entityId": entity_id})).unwrap(),
            )
            .unwrap();
        assert_eq!(detail.asset.note.as_deref(), Some(expected_note));
    }

    fn activate_recovered_host_and_assert_empty_business(host: &mut DesktopLocalHost, name: &str) {
        let (verifier, signed_wire) = super::super::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
        let device_id = host
            .production_custody
            .as_ref()
            .expect("clean restart retains custody")
            .lock()
            .unwrap()
            .load_device_id()
            .unwrap();
        VerifiedBackupAuthority::verify(
            &signed_wire,
            &TrustedBackupBinding {
                account_id: None,
                device_id: &device_id,
                minimum_account_security_epoch: 0,
                minimum_lease_epoch: 0,
            },
            current_unix_seconds().unwrap(),
            &verifier,
        )
        .unwrap();
        host.authority_verifier = Some(verifier);
        host.activate_authorization_grant(&signed_wire)
            .unwrap_or_else(|error| panic!("fresh Grant failed for {name}: {error:?}"));
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::Active
        );
        let snapshot = host
            .read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
            .unwrap();
        assert_eq!(snapshot.total_rows, 0);
        assert!(snapshot.window.rows.is_empty());
        assert!(host.begin_sync_run().is_ok());
    }

    #[test]
    fn production_status_is_closed_and_renderer_safe() {
        let host = DesktopLocalHost::production_unavailable();
        let business = serde_json::to_value(host.business_status()).unwrap();
        assert_eq!(business["schemaVersion"], 2);
        assert_eq!(business["state"], "activation_required");
        assert_eq!(business["capabilities"], serde_json::json!([]));
        let value = serde_json::to_value(host.backup_status()).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["kind"], "local_backup_restore_status");
        assert_eq!(value["authority"], "unavailable");
        assert_eq!(value["exportAdmission"]["state"], "unavailable");
        assert_eq!(value["artifactSelectionAdmission"]["state"], "unavailable");
        assert_eq!(value["selectedArtifact"]["state"], "none");
        assert!(value["error"].is_null());
    }

    #[cfg(unix)]
    #[test]
    fn production_constructor_rejects_fixed_file_residue_before_database_or_key_access() {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        for name in [
            "rebootstrap.journal",
            "rebootstrap-a.db",
            "rebootstrap-a.db-wal",
            "rebootstrap-a.db-shm",
            "rebootstrap-a.db-journal",
            "rebootstrap-b.db",
            "rebootstrap-b.db-wal",
            "rebootstrap-b.db-shm",
            "rebootstrap-b.db-journal",
        ] {
            let directory = tempdir().unwrap();
            let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
            let root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let workspace = application_path.join("active-workspace");
            std::fs::create_dir(&workspace).unwrap();
            std::fs::set_permissions(&workspace, std::fs::Permissions::from_mode(0o700)).unwrap();

            let residue = workspace.join(name);
            let expected = format!("fixed-residue:{name}").into_bytes();
            std::fs::write(&residue, &expected).unwrap();
            std::fs::set_permissions(&residue, std::fs::Permissions::from_mode(0o600)).unwrap();

            let residue_inode = std::fs::symlink_metadata(&residue).unwrap().ino();
            let mut entries_before = std::fs::read_dir(&workspace)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect::<Vec<_>>();
            entries_before.sort();

            reset_rebootstrap_inspection_for_test();
            assert_eq!(
                DesktopLocalHost::production(root).unwrap_err(),
                DesktopLocalHostError::ApplicationRootRejected,
                "production admitted {name}"
            );

            let inspection = rebootstrap_inspection_snapshot_for_test();
            assert_eq!(inspection.slot_inspections(), 0, "slot access for {name}");
            assert_eq!(inspection.alias_inspections(), 0, "alias access for {name}");
            assert_eq!(
                inspection.database_inspections(),
                0,
                "database access for {name}"
            );

            assert_eq!(std::fs::read(&residue).unwrap(), expected);
            assert_eq!(
                std::fs::symlink_metadata(&residue).unwrap().ino(),
                residue_inode
            );
            assert!(!workspace.join("business.db").exists());

            let mut entries_after = std::fs::read_dir(&workspace)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect::<Vec<_>>();
            entries_after.sort();
            assert_eq!(entries_after, entries_before);
        }
    }

    #[test]
    fn status_closes_while_an_authority_transition_is_pending() {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x4f; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        assert_eq!(
            host.authorization_status(),
            DesktopHostAuthorizationStatus::Authorized
        );

        host.transition_requested_epoch.store(2, Ordering::Release);

        assert_eq!(
            host.authorization_status(),
            DesktopHostAuthorizationStatus::SecurityLocked
        );
        let business = serde_json::to_value(host.business_status()).unwrap();
        assert_eq!(business["state"], "security_locked");
        assert_eq!(business["capabilities"], serde_json::json!([]));
    }

    #[test]
    fn status_closes_when_the_published_authority_is_expired() {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x50; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        host.authority_publication
            .lock()
            .unwrap()
            .authority
            .as_mut()
            .unwrap()
            .execute_before = 0;

        assert_eq!(
            host.authorization_status(),
            DesktopHostAuthorizationStatus::SecurityLocked
        );
        let business = serde_json::to_value(host.business_status()).unwrap();
        assert_eq!(business["state"], "security_locked");
        assert_eq!(business["capabilities"], serde_json::json!([]));
    }

    #[cfg(unix)]
    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the production gate test keeps the no-side-effect and private-fixture contrast in one scenario"
    )]
    fn production_rebootstrap_is_unavailable_without_side_effects_and_private_fake_completes() {
        let directory = tempdir().unwrap();
        let fixture_root = directory.path().canonicalize().unwrap();
        let application_path = fixture_root.join("GoodDealer-production");
        let root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let production_mode = DesktopLocalHost::development_with_rebootstrap_custody(
            &root,
            application_path.join("native-backup-production-mode"),
            "account-local",
            "workspace-local",
            "device-local",
            false,
        )
        .unwrap();
        let database_path = root.business_database_path();
        let before_database = std::fs::read(&database_path).unwrap();
        let before_generation = production_mode.business_status().read_generation;
        let before_rebootstrap_state = production_mode
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .rebootstrap_state_digest_for_test()
            .unwrap();
        let (checkpoint, plan) =
            crate::rebootstrap_runtime::valid_rebootstrap_fixture("workspace-local");

        assert_eq!(
            production_mode.apply_rebootstrap_plan(&checkpoint, &plan),
            Err(DesktopLocalHostError::Unavailable)
        );
        let oversized_checkpoint = vec![b'x'; 4_097];
        for (name, hostile_checkpoint, hostile_plan) in [
            ("malformed-checkpoint", b"{".as_slice(), plan.as_slice()),
            ("malformed-plan", checkpoint.as_slice(), b"{".as_slice()),
            (
                "oversized-checkpoint",
                oversized_checkpoint.as_slice(),
                plan.as_slice(),
            ),
        ] {
            assert_eq!(
                production_mode.apply_rebootstrap_plan(hostile_checkpoint, hostile_plan),
                Err(DesktopLocalHostError::Unavailable),
                "production denial parsed or admitted {name}"
            );
        }
        assert_eq!(std::fs::read(&database_path).unwrap(), before_database);
        assert_eq!(
            production_mode
                .production_custody
                .as_ref()
                .unwrap()
                .lock()
                .unwrap()
                .rebootstrap_state_digest_for_test()
                .unwrap(),
            before_rebootstrap_state
        );
        assert_eq!(
            production_mode.business_status().state,
            DesktopLocalBusinessState::Active
        );
        assert_eq!(
            production_mode.business_status().read_generation,
            before_generation
        );
        assert_eq!(
            production_mode
                .rebootstrap_runtime
                .as_ref()
                .unwrap()
                .startup_status()
                .unwrap(),
            crate::rebootstrap_runtime::RebootstrapStatus::Unavailable
        );
        for name in [
            "rebootstrap.journal",
            "rebootstrap-a.db",
            "rebootstrap-b.db",
        ] {
            assert_eq!(
                std::fs::symlink_metadata(application_path.join("active-workspace").join(name))
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::NotFound
            );
        }
        // The unavailable capability is scoped to rebootstrap: ordinary reads remain admitted.
        production_mode
            .read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
            .unwrap();
        drop(production_mode);

        // The test key store models native custody and is intentionally process-local. Exercise
        // the create-only fake against an independent installation so it cannot inherit the
        // production fixture's database without its corresponding custody records.
        let private_application_path = fixture_root.join("GoodDealer-private-fake");
        let private_root = DesktopApplicationRoot::validate(&private_application_path).unwrap();
        let private_fake = DesktopLocalHost::development_with_rebootstrap_custody(
            &private_root,
            private_application_path.join("native-backup-private-fake"),
            "account-local",
            "workspace-local",
            "device-local",
            true,
        )
        .unwrap();
        let private_result = private_fake.apply_rebootstrap_plan(&checkpoint, &plan);
        assert_eq!(
            private_result,
            Ok(()),
            "journal after failure: {:?}",
            std::fs::read_to_string(private_root.rebootstrap_journal_path())
        );
        assert_eq!(
            private_fake
                .rebootstrap_runtime
                .as_ref()
                .unwrap()
                .startup_status()
                .unwrap(),
            crate::rebootstrap_runtime::RebootstrapStatus::Published
        );
        assert_eq!(
            private_fake.business_status().state,
            DesktopLocalBusinessState::Active
        );
        for name in ["rebootstrap-a.db", "rebootstrap-b.db"] {
            assert_eq!(
                std::fs::symlink_metadata(
                    private_application_path.join("active-workspace").join(name)
                )
                .unwrap_err()
                .kind(),
                std::io::ErrorKind::NotFound
            );
        }
    }

    #[cfg(unix)]
    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the restart matrix keeps all crash boundaries and their common invariant checks together"
    )]
    fn rebootstrap_v3_restart_matrix_cancels_pre_exchange_resumes_post_exchange_and_restores_no_authority()
     {
        let rows = [
            (
                "reservation-created",
                RebootstrapCrashBoundary::ReservationCreated,
                RebootstrapRestartDisposition::Quarantined,
            ),
            (
                "prepared",
                RebootstrapCrashBoundary::Prepared,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "candidate-created",
                RebootstrapCrashBoundary::CandidateCreated,
                RebootstrapRestartDisposition::Quarantined,
            ),
            (
                "candidate-reserved",
                RebootstrapCrashBoundary::CandidateReserved,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "candidate-mutated",
                RebootstrapCrashBoundary::CandidateMutated,
                RebootstrapRestartDisposition::Quarantined,
            ),
            (
                "verified",
                RebootstrapCrashBoundary::Verified,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "cancel-candidate-file-unlinked",
                RebootstrapCrashBoundary::CancelCandidateFileUnlinked,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "cancel-candidate-slot-deleted",
                RebootstrapCrashBoundary::CancelCandidateSlotDeleted,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "cancel-alias-repaired",
                RebootstrapCrashBoundary::CancelAliasRepaired,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "cancel-old-slot-deleted",
                RebootstrapCrashBoundary::CancelOldSlotDeleted,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "publish-intent-pre-exchange",
                RebootstrapCrashBoundary::PublishIntentPreExchange,
                RebootstrapRestartDisposition::CancelledUnpublished,
            ),
            (
                "exchange-before-directory-fsync",
                RebootstrapCrashBoundary::ExchangeBeforeDirectoryFsync,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "alias-repair-before-published",
                RebootstrapCrashBoundary::AliasRepairBeforePublished,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "publish-intent-post-exchange",
                RebootstrapCrashBoundary::PublishIntentPostExchange,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "published",
                RebootstrapCrashBoundary::Published,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "reopen-proof-failure",
                RebootstrapCrashBoundary::ReopenProofFailure,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "reopened-before-confirmation",
                RebootstrapCrashBoundary::ReopenedBeforeConfirmation,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "reopened-verified",
                RebootstrapCrashBoundary::ReopenedVerified,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "old-file-unlinked",
                RebootstrapCrashBoundary::OldFileUnlinked,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "old-slot-deleted",
                RebootstrapCrashBoundary::OldSlotDeleted,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "retired-old-journal-append-failure",
                RebootstrapCrashBoundary::RetiredOldJournalAppendFailure,
                RebootstrapRestartDisposition::ResumedPublished,
            ),
            (
                "retired-old",
                RebootstrapCrashBoundary::RetiredOld,
                RebootstrapRestartDisposition::TerminalValidated,
            ),
        ];
        for (name, boundary, expected) in rows {
            let (directory, root, store) = if is_cancel_restart_crash(boundary) {
                seed_cancel_restart_crash_from(
                    RebootstrapCrashBoundary::CandidateReserved,
                    boundary,
                )
            } else {
                seed_rebootstrap_crash(boundary)
            };
            let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
            let (mut host, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| panic!("restart failed for {name}/{boundary:?}: {error:?}"));

            assert_eq!(
                disposition, expected,
                "unexpected decision for {name}/{boundary:?}"
            );
            let expected_state = if expected == RebootstrapRestartDisposition::Quarantined {
                DesktopLocalBusinessState::SecurityLocked
            } else {
                DesktopLocalBusinessState::ActivationRequired
            };
            assert_eq!(host.business_status().state, expected_state);
            assert!(host.runtime_state.lock().unwrap().is_none());
            assert!(host.begin_sync_run().is_err());
            assert!(
                host.read_asset_library(DesktopAssetLibraryReadRequest {
                    start_index: 0,
                    size: 10,
                    query: String::new(),
                })
                .is_err()
            );

            if disposition != RebootstrapRestartDisposition::Quarantined {
                activate_recovered_host_and_assert_business(&mut host, disposition, name, boundary);
            }

            drop(host);
            if matches!(
                boundary,
                RebootstrapCrashBoundary::Prepared
                    | RebootstrapCrashBoundary::CancelCandidateFileUnlinked
                    | RebootstrapCrashBoundary::CancelCandidateSlotDeleted
                    | RebootstrapCrashBoundary::CancelAliasRepaired
                    | RebootstrapCrashBoundary::CancelOldSlotDeleted
                    | RebootstrapCrashBoundary::OldFileUnlinked
                    | RebootstrapCrashBoundary::OldSlotDeleted
                    | RebootstrapCrashBoundary::RetiredOldJournalAppendFailure
                    | RebootstrapCrashBoundary::RetiredOld
            ) {
                let journal_path = application_path
                    .join("active-workspace")
                    .join("rebootstrap.journal");
                let journal_before_second = std::fs::read(&journal_path).unwrap();
                let second_root = DesktopApplicationRoot::validate(&application_path).unwrap();
                let (mut second, second_disposition) =
                    DesktopLocalHost::restart_rebootstrap_for_test(
                        second_root,
                        store.clone(),
                        "workspace-local",
                    )
                    .unwrap_or_else(|error| {
                        panic!("second restart failed for {name}/{boundary:?}: {error:?}")
                    });
                assert_eq!(
                    second_disposition,
                    RebootstrapRestartDisposition::TerminalValidated,
                    "second restart disposition for {name}/{boundary:?}"
                );
                assert_eq!(
                    second.business_status().state,
                    DesktopLocalBusinessState::ActivationRequired
                );
                assert!(second.runtime_state.lock().unwrap().is_none());
                assert_eq!(std::fs::read(&journal_path).unwrap(), journal_before_second);
                let selected = if boundary == RebootstrapCrashBoundary::Prepared
                    || is_cancel_restart_crash(boundary)
                {
                    RebootstrapRestartDisposition::CancelledUnpublished
                } else {
                    RebootstrapRestartDisposition::ResumedPublished
                };
                activate_recovered_host_and_assert_business(&mut second, selected, name, boundary);
                drop(second);
            }
            drop(directory);
        }
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_prefix_cross_product_resumes_once_and_then_validates_terminal_state() {
        let prepared_boundaries = [
            RebootstrapCrashBoundary::CancelCandidateSlotDeleted,
            RebootstrapCrashBoundary::CancelAliasRepaired,
            RebootstrapCrashBoundary::CancelOldSlotDeleted,
        ];
        let candidate_boundaries = [
            RebootstrapCrashBoundary::CancelCandidateFileUnlinked,
            RebootstrapCrashBoundary::CancelCandidateSlotDeleted,
            RebootstrapCrashBoundary::CancelAliasRepaired,
            RebootstrapCrashBoundary::CancelOldSlotDeleted,
        ];
        for source in [
            RebootstrapCrashBoundary::Prepared,
            RebootstrapCrashBoundary::CandidateReserved,
            RebootstrapCrashBoundary::Verified,
            RebootstrapCrashBoundary::PublishIntentPreExchange,
        ] {
            let boundaries = if source == RebootstrapCrashBoundary::Prepared {
                prepared_boundaries.as_slice()
            } else {
                candidate_boundaries.as_slice()
            };
            for &boundary in boundaries {
                let (directory, root, store) = seed_cancel_restart_crash_from(source, boundary);
                let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
                let journal_path = root.rebootstrap_journal_path();
                let (mut first, first_disposition) =
                    DesktopLocalHost::restart_rebootstrap_for_test(
                        root,
                        store.clone(),
                        "workspace-local",
                    )
                    .unwrap_or_else(|error| {
                        panic!("cancel prefix {source:?}/{boundary:?} failed: {error:?}")
                    });
                assert_eq!(
                    first_disposition,
                    RebootstrapRestartDisposition::CancelledUnpublished,
                    "cancel prefix {source:?}/{boundary:?}"
                );
                activate_recovered_host_and_assert_business(
                    &mut first,
                    first_disposition,
                    "cancel-prefix-first",
                    boundary,
                );
                drop(first);

                let journal_after_cancel = std::fs::read(&journal_path).unwrap();
                let second_root = DesktopApplicationRoot::validate(&application_path).unwrap();
                let (mut second, second_disposition) =
                    DesktopLocalHost::restart_rebootstrap_for_test(
                        second_root,
                        store.clone(),
                        "workspace-local",
                    )
                    .unwrap_or_else(|error| {
                        panic!("cancel terminal {source:?}/{boundary:?} failed: {error:?}")
                    });
                assert_eq!(
                    second_disposition,
                    RebootstrapRestartDisposition::TerminalValidated,
                    "cancel terminal {source:?}/{boundary:?}"
                );
                assert_eq!(std::fs::read(&journal_path).unwrap(), journal_after_cancel);
                activate_recovered_host_and_assert_business(
                    &mut second,
                    RebootstrapRestartDisposition::CancelledUnpublished,
                    "cancel-prefix-terminal",
                    boundary,
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn terminal_restart_accepts_current_business_proof_after_repeated_authorized_mutations() {
        let rows = [
            (
                "cancelled",
                RebootstrapCrashBoundary::Prepared,
                RebootstrapRestartDisposition::CancelledUnpublished,
                "old-local.example",
                ["old"],
            ),
            (
                "retired-old",
                RebootstrapCrashBoundary::RetiredOld,
                RebootstrapRestartDisposition::TerminalValidated,
                "candidate-remote.example",
                ["candidate"],
            ),
        ];
        for (name, boundary, expected, entity_id, tags) in rows {
            let (directory, root, store) = seed_rebootstrap_crash(boundary);
            let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
            let database_path = root.business_database_path();
            let journal_path = root.rebootstrap_journal_path();
            let (mut host, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| panic!("{name} recovery failed: {error:?}"));
            assert_eq!(disposition, expected, "{name} recovery disposition");
            activate_recovered_host(&mut host, name, boundary);
            let initial_link = active_publication_link_snapshot(&host);
            if expected == RebootstrapRestartDisposition::CancelledUnpublished {
                assert!(!initial_link.is_present(), "initial Cancelled has no link");
                assert_eq!(initial_link.active_row_count(), 0);
            } else {
                assert!(initial_link.is_present(), "RetiredOld has an active link");
                assert_eq!(initial_link.active_row_count(), 1);
            }

            let ciphertext_before = encrypted_database_state_digest(&database_path);
            let proof_before = recovered_business_proof(&host);
            mutate_recovered_asset(
                &host,
                entity_id,
                &format!("{name}-mutation-1"),
                &format!("{name}-note-1"),
                &tags,
            );
            mutate_recovered_asset(
                &host,
                entity_id,
                &format!("{name}-mutation-2"),
                &format!("{name}-note-2"),
                &tags,
            );
            let proof_after = recovered_business_proof(&host);
            let ciphertext_after = encrypted_database_state_digest(&database_path);
            assert_ne!(ciphertext_after, ciphertext_before, "{name} ciphertext");
            assert_ne!(
                proof_after.row_digest, proof_before.row_digest,
                "{name} proof"
            );
            assert_eq!(
                proof_after.local_commit_sequence,
                proof_before.local_commit_sequence + 2,
                "{name} commit sequence"
            );
            assert_eq!(
                proof_after.next_device_mutation_sequence,
                proof_before.next_device_mutation_sequence + 2,
                "{name} mutation sequence"
            );
            assert_recovered_note(&host, entity_id, &format!("{name}-note-2"));
            drop(host);

            let journal_after_mutations = std::fs::read(&journal_path).unwrap();
            for restart_index in 1..=2 {
                let restart_root = DesktopApplicationRoot::validate(&application_path).unwrap();
                let (mut restarted, restart_disposition) =
                    DesktopLocalHost::restart_rebootstrap_for_test(
                        restart_root,
                        store.clone(),
                        "workspace-local",
                    )
                    .unwrap_or_else(|error| {
                        panic!("{name} terminal restart {restart_index} failed: {error:?}")
                    });
                assert_eq!(
                    restart_disposition,
                    RebootstrapRestartDisposition::TerminalValidated,
                    "{name} terminal restart {restart_index}"
                );
                assert_eq!(
                    std::fs::read(&journal_path).unwrap(),
                    journal_after_mutations,
                    "{name} terminal restart {restart_index} rewrote the journal"
                );
                activate_recovered_host(&mut restarted, name, boundary);
                assert_recovered_note(&restarted, entity_id, &format!("{name}-note-2"));
                assert_eq!(recovered_business_proof(&restarted), proof_after);
                drop(restarted);
            }
        }
    }

    #[cfg(unix)]
    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the journal-link test keeps inheritance and replacement in one causal scenario"
    )]
    fn terminal_chain_preserves_link_across_cancel_and_replaces_it_on_next_publication() {
        let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let journal_path = root.rebootstrap_journal_path();

        let (mut first_terminal, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::TerminalValidated
        );
        activate_recovered_host(
            &mut first_terminal,
            "retired-op1",
            RebootstrapCrashBoundary::RetiredOld,
        );
        let op1_link = active_publication_link_snapshot(&first_terminal);
        assert!(op1_link.is_present());
        assert_eq!(op1_link.active_row_count(), 1);
        let op1_link_digest = op1_link.digest().unwrap().to_owned();

        let (checkpoint, plan) = nonempty_rebootstrap_fixture("workspace-local");
        assert_eq!(
            first_terminal.apply_rebootstrap_plan_until_for_test(
                &checkpoint,
                &plan,
                RebootstrapCrashBoundary::Prepared,
            ),
            Ok(())
        );
        drop(first_terminal);

        let cancelled_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let (mut cancelled, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
            cancelled_root,
            store.clone(),
            "workspace-local",
        )
        .unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::CancelledUnpublished
        );
        activate_recovered_host(
            &mut cancelled,
            "cancelled-op2",
            RebootstrapCrashBoundary::Prepared,
        );
        let cancelled_link = active_publication_link_snapshot(&cancelled);
        assert_eq!(cancelled_link.active_row_count(), 1);
        assert_eq!(cancelled_link.digest(), Some(op1_link_digest.as_str()));
        assert_recovered_note(&cancelled, "candidate-remote.example", "candidate-only");
        drop(cancelled);

        let journal_after_cancel = std::fs::read(&journal_path).unwrap();
        let inherited_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let (mut inherited, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
            inherited_root,
            store.clone(),
            "workspace-local",
        )
        .unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::TerminalValidated
        );
        assert_eq!(std::fs::read(&journal_path).unwrap(), journal_after_cancel);
        activate_recovered_host(
            &mut inherited,
            "inherited-op1-link",
            RebootstrapCrashBoundary::Prepared,
        );
        let inherited_link = active_publication_link_snapshot(&inherited);
        assert_eq!(inherited_link.active_row_count(), 1);
        assert_eq!(inherited_link.digest(), Some(op1_link_digest.as_str()));

        assert_eq!(
            inherited.apply_rebootstrap_plan_until_for_test(
                &checkpoint,
                &plan,
                RebootstrapCrashBoundary::RetiredOld,
            ),
            Ok(())
        );
        drop(inherited);

        let journal_after_replacement = std::fs::read(&journal_path).unwrap();
        assert_ne!(journal_after_replacement, journal_after_cancel);
        let replacement_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let (mut replacement, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
            replacement_root,
            store,
            "workspace-local",
        )
        .unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::TerminalValidated
        );
        assert_eq!(
            std::fs::read(&journal_path).unwrap(),
            journal_after_replacement
        );
        activate_recovered_host(
            &mut replacement,
            "retired-op3-replacement",
            RebootstrapCrashBoundary::RetiredOld,
        );
        let op3_link = active_publication_link_snapshot(&replacement);
        assert_eq!(op3_link.active_row_count(), 1);
        assert!(op3_link.is_present());
        assert_ne!(op3_link.digest(), Some(op1_link_digest.as_str()));
        assert_recovered_note(&replacement, "candidate-remote.example", "candidate-only");
    }

    #[cfg(unix)]
    #[test]
    fn hostile_terminal_publication_links_quarantine_without_repair_or_journal_write() {
        for hostile_case in [
            TestRebootstrapJournalLinkHostileCase::RemoveActive,
            TestRebootstrapJournalLinkHostileCase::DuplicateActive,
            TestRebootstrapJournalLinkHostileCase::MutateBindingDigest,
            TestRebootstrapJournalLinkHostileCase::MarkNonVerified,
        ] {
            let (directory, root, store) =
                seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
            let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
            let journal_path = root.rebootstrap_journal_path();
            let (mut host, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                root,
                store.clone(),
                "workspace-local",
            )
            .unwrap();
            assert_eq!(
                disposition,
                RebootstrapRestartDisposition::TerminalValidated
            );
            activate_recovered_host(
                &mut host,
                "hostile-terminal-link",
                RebootstrapCrashBoundary::RetiredOld,
            );
            let link_before = active_publication_link_snapshot(&host);
            assert!(link_before.is_present());
            assert_eq!(link_before.active_row_count(), 1);
            apply_publication_link_hostile_case(&host, hostile_case);
            drop(host);

            let journal_before_restart = std::fs::read(&journal_path).unwrap();
            let probe_root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let custody = TestRebootstrapRecoveryCustody::open(&probe_root, store.clone()).unwrap();
            let state_before_restart = custody.state_digest().unwrap();
            drop(custody);
            let restart_root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let (quarantined, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                restart_root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("hostile terminal link {hostile_case:?} escaped quarantine: {error:?}")
            });
            assert_eq!(
                disposition,
                RebootstrapRestartDisposition::Quarantined,
                "hostile terminal link {hostile_case:?}"
            );
            assert_eq!(
                quarantined.business_status().state,
                DesktopLocalBusinessState::SecurityLocked
            );
            assert!(quarantined.runtime_state.lock().unwrap().is_none());
            assert_eq!(
                quarantined
                    .rebootstrap_quarantine_custody
                    .as_ref()
                    .unwrap()
                    .state_digest(&store)
                    .unwrap(),
                state_before_restart,
                "hostile terminal link {hostile_case:?} was repaired"
            );
            assert_eq!(
                std::fs::read(&journal_path).unwrap(),
                journal_before_restart,
                "hostile terminal link {hostile_case:?} rewrote the journal"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn cancelled_terminal_requires_the_exact_inherited_publication_link() {
        let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let journal_path = root.rebootstrap_journal_path();
        let (mut op1, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::TerminalValidated
        );
        activate_recovered_host(
            &mut op1,
            "inherited-link-op1",
            RebootstrapCrashBoundary::RetiredOld,
        );
        let (checkpoint, plan) = nonempty_rebootstrap_fixture("workspace-local");
        assert_eq!(
            op1.apply_rebootstrap_plan_until_for_test(
                &checkpoint,
                &plan,
                RebootstrapCrashBoundary::Prepared,
            ),
            Ok(())
        );
        drop(op1);

        let cancelled_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let (mut cancelled, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
            cancelled_root,
            store.clone(),
            "workspace-local",
        )
        .unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::CancelledUnpublished
        );
        activate_recovered_host(
            &mut cancelled,
            "inherited-link-op2-cancelled",
            RebootstrapCrashBoundary::Prepared,
        );
        let inherited = active_publication_link_snapshot(&cancelled);
        assert!(inherited.is_present());
        assert_eq!(inherited.active_row_count(), 1);
        apply_publication_link_hostile_case(
            &cancelled,
            TestRebootstrapJournalLinkHostileCase::RemoveActive,
        );
        drop(cancelled);

        let journal_before_restart = std::fs::read(&journal_path).unwrap();
        let probe_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let custody = TestRebootstrapRecoveryCustody::open(&probe_root, store.clone()).unwrap();
        let state_before_restart = custody.state_digest().unwrap();
        drop(custody);
        let restart_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let (quarantined, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
            restart_root,
            store.clone(),
            "workspace-local",
        )
        .unwrap();
        assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
        assert_eq!(
            quarantined.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert_eq!(
            quarantined
                .rebootstrap_quarantine_custody
                .as_ref()
                .unwrap()
                .state_digest(&store)
                .unwrap(),
            state_before_restart
        );
        assert_eq!(
            std::fs::read(&journal_path).unwrap(),
            journal_before_restart
        );
    }

    #[cfg(unix)]
    #[test]
    fn candidate_file_with_missing_candidate_slot_quarantines_in_every_cancellation_phase() {
        for source in [
            RebootstrapCrashBoundary::CandidateReserved,
            RebootstrapCrashBoundary::Verified,
            RebootstrapCrashBoundary::PublishIntentPreExchange,
        ] {
            let (_directory, root, store) = seed_rebootstrap_crash(source);
            store
                .apply_hostile_case_for_test(TestRebootstrapStoreHostileCase::RemoveSlot(
                    RebootstrapSlot::B,
                ))
                .unwrap();
            let journal_path = root.rebootstrap_journal_path();
            let journal_before = std::fs::read(&journal_path).unwrap();
            let probe = TestRebootstrapRecoveryCustody::open(&root, store.clone()).unwrap();
            let state_before = probe.state_digest().unwrap();
            drop(probe);

            let (host, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("file-present/slot-missing {source:?} did not fail closed: {error:?}")
            });
            assert_eq!(
                disposition,
                RebootstrapRestartDisposition::Quarantined,
                "file-present/slot-missing {source:?} was admitted"
            );
            assert_eq!(
                host.rebootstrap_quarantine_custody
                    .as_ref()
                    .unwrap()
                    .state_digest(&store)
                    .unwrap(),
                state_before
            );
            assert_eq!(std::fs::read(&journal_path).unwrap(), journal_before);
        }
    }

    #[cfg(unix)]
    #[test]
    fn clean_restart_is_validated_but_requires_fresh_authority() {
        let directory = tempdir().unwrap();
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let host = DesktopLocalHost::development_with_rebootstrap_custody_and_store(
            &root,
            application_path.join("native-backup-clean-restart"),
            "account-local",
            "workspace-local",
            "device-local",
            true,
            store.clone(),
        )
        .unwrap();
        drop(host);

        let root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let (mut restarted, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local").unwrap();
        assert_eq!(disposition, RebootstrapRestartDisposition::CleanValidated);
        assert_eq!(
            restarted.business_status().state,
            DesktopLocalBusinessState::ActivationRequired
        );
        assert!(restarted.runtime_state.lock().unwrap().is_none());
        activate_recovered_host_and_assert_empty_business(&mut restarted, "clean-restart");
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "subprocess helper invoked only by the quarantine process-lock test"]
    fn rebootstrap_quarantine_lock_child_process() {
        let application_path = std::env::var_os("GOODDEALER_REBOOTSTRAP_LOCK_TEST_ROOT")
            .map(std::path::PathBuf::from)
            .expect("child application root is present");
        let expected = std::env::var("GOODDEALER_REBOOTSTRAP_LOCK_TEST_EXPECT")
            .expect("child expected outcome is present");
        let root = DesktopApplicationRoot::validate(&application_path)
            .expect("child application root is valid");

        reset_rebootstrap_inspection_for_test();
        let opened =
            TestRebootstrapRecoveryCustody::open(&root, TestRebootstrapKeyStore::default());
        let inspection = rebootstrap_inspection_snapshot_for_test();

        assert_eq!(inspection.lock_attempts(), 1);
        assert_eq!(inspection.journal_inspections(), 0);
        assert_eq!(inspection.slot_inspections(), 0);
        assert_eq!(inspection.alias_inspections(), 0);
        assert_eq!(inspection.database_inspections(), 0);
        match expected.as_str() {
            "blocked" => {
                assert!(matches!(
                    opened,
                    Err(crate::desktop_custody::DesktopCustodyError::Unavailable)
                ));
                assert_eq!(inspection.lock_acquired(), 0);
            }
            "acquired" => {
                assert!(opened.is_ok());
                assert_eq!(inspection.lock_acquired(), 1);
            }
            _ => panic!("unknown child expected outcome: {expected}"),
        }
        println!(
            "GOODDEALER_REBOOTSTRAP_LOCK_CHILD expected={expected} attempts={} acquired={} journal={} slot={} alias={} database={}",
            inspection.lock_attempts(),
            inspection.lock_acquired(),
            inspection.journal_inspections(),
            inspection.slot_inspections(),
            inspection.alias_inspections(),
            inspection.database_inspections(),
        );
    }

    #[cfg(unix)]
    #[test]
    fn terminal_restart_rejects_truncated_phase_history_without_repair() {
        let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let journal_path = root.rebootstrap_journal_path();
        let history = std::fs::read(&journal_path).unwrap();
        let mut terminal_only = history
            .split(|byte| *byte == b'\n')
            .rfind(|record| !record.is_empty())
            .expect("terminal history contains a final record")
            .to_vec();
        terminal_only.push(b'\n');
        assert_ne!(
            terminal_only, history,
            "fixture must contain a phase history"
        );
        std::fs::write(&journal_path, &terminal_only).unwrap();

        let probe = TestRebootstrapRecoveryCustody::open(&root, store.clone()).unwrap();
        let state_before_restart = probe.state_digest().unwrap();
        drop(probe);

        let (quarantined, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap();
        assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
        let status = quarantined.business_status();
        assert_eq!(status.state, DesktopLocalBusinessState::SecurityLocked);
        assert!(status.capabilities.is_empty());
        assert!(quarantined.runtime_state.lock().unwrap().is_none());
        assert_eq!(
            quarantined
                .rebootstrap_quarantine_custody
                .as_ref()
                .expect("quarantined Host retains lock-only custody")
                .state_digest(&store)
                .unwrap(),
            state_before_restart
        );
        assert_eq!(std::fs::read(&journal_path).unwrap(), terminal_only);

        let output = std::process::Command::new(
            std::env::current_exe().expect("current test executable is available"),
        )
        .arg("--exact")
        .arg("backup::desktop_local_host::tests::rebootstrap_quarantine_lock_child_process")
        .arg("--ignored")
        .arg("--nocapture")
        .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_ROOT", &application_path)
        .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_EXPECT", "blocked")
        .output()
        .expect("lock contender child process starts");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "lock contender child failed: stdout={stdout}; stderr={stderr}"
        );
        assert!(stdout.contains(
            "GOODDEALER_REBOOTSTRAP_LOCK_CHILD expected=blocked attempts=1 acquired=0 journal=0 slot=0 alias=0 database=0"
        ));
        assert_eq!(
            quarantined
                .rebootstrap_quarantine_custody
                .as_ref()
                .expect("quarantined Host retains lock-only custody")
                .state_digest(&store)
                .unwrap(),
            state_before_restart
        );
        assert_eq!(std::fs::read(&journal_path).unwrap(), terminal_only);
    }

    #[cfg(unix)]
    #[test]
    fn quarantined_restart_retains_exclusive_process_lock_and_rejects_fresh_grant() {
        fn run_lock_child(application_path: &std::path::Path, expected: &str) -> String {
            let output = std::process::Command::new(
                std::env::current_exe().expect("current test executable is available"),
            )
            .arg("--exact")
            .arg("backup::desktop_local_host::tests::rebootstrap_quarantine_lock_child_process")
            .arg("--ignored")
            .arg("--nocapture")
            .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_ROOT", application_path)
            .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_EXPECT", expected)
            .output()
            .expect("lock contender child process starts");
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(
                output.status.success(),
                "lock contender child failed for {expected}: stdout={stdout}; stderr={stderr}"
            );
            let marker = format!("GOODDEALER_REBOOTSTRAP_LOCK_CHILD expected={expected}");
            assert!(
                stdout.contains(&marker),
                "child completion marker missing for {expected}: {stdout}"
            );
            stdout.into_owned()
        }

        let (directory, root, store) =
            seed_rebootstrap_crash(RebootstrapCrashBoundary::ReservationCreated);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let journal_path = root.rebootstrap_journal_path();
        let (mut quarantined, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap();
        assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
        let before = quarantined
            .rebootstrap_quarantine_custody
            .as_ref()
            .unwrap()
            .state_digest(&store)
            .unwrap();
        let journal_before = std::fs::read(&journal_path).ok();

        let blocked = run_lock_child(&application_path, "blocked");
        assert!(blocked.contains("attempts=1 acquired=0 journal=0 slot=0 alias=0 database=0"));
        assert_eq!(
            quarantined
                .rebootstrap_quarantine_custody
                .as_ref()
                .unwrap()
                .state_digest(&store)
                .unwrap(),
            before
        );
        assert_eq!(std::fs::read(&journal_path).ok(), journal_before);

        let (verifier, signed_wire) = super::super::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
        quarantined.authority_verifier = Some(verifier);
        assert!(
            quarantined
                .activate_authorization_grant(&signed_wire)
                .is_err()
        );
        assert_eq!(
            quarantined.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert!(quarantined.business_status().capabilities.is_empty());
        assert!(quarantined.runtime_state.lock().unwrap().is_none());
        assert!(quarantined.begin_sync_run().is_err());
        assert!(
            quarantined
                .read_asset_library(DesktopAssetLibraryReadRequest {
                    start_index: 0,
                    size: 10,
                    query: String::new(),
                })
                .is_err()
        );
        drop(quarantined);

        let acquired = run_lock_child(&application_path, "acquired");
        assert!(acquired.contains("attempts=1 acquired=1 journal=0 slot=0 alias=0 database=0"));
        assert_eq!(std::fs::read(&journal_path).ok(), journal_before);
    }

    #[cfg(unix)]
    #[test]
    fn hostile_quarantine_concurrently_rejects_grant_read_sync_and_mutation_without_writing() {
        let (directory, root, store) =
            seed_rebootstrap_crash(RebootstrapCrashBoundary::ReservationCreated);
        let journal_path = root.rebootstrap_journal_path();
        let (mut host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap();
        assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
        let state_before = host
            .rebootstrap_quarantine_custody
            .as_ref()
            .unwrap()
            .state_digest(&store)
            .unwrap();
        let journal_before = std::fs::read(&journal_path).ok();
        let (verifier, signed_wire) = super::super::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
        host.authority_verifier = Some(verifier);
        let host = std::sync::Arc::new(host);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(5));

        let grant_host = std::sync::Arc::clone(&host);
        let grant_barrier = std::sync::Arc::clone(&barrier);
        let grant = std::thread::spawn(move || {
            grant_barrier.wait();
            grant_host.activate_authorization_grant(&signed_wire)
        });
        let read_host = std::sync::Arc::clone(&host);
        let read_barrier = std::sync::Arc::clone(&barrier);
        let read = std::thread::spawn(move || {
            read_barrier.wait();
            read_host.read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
        });
        let sync_host = std::sync::Arc::clone(&host);
        let sync_barrier = std::sync::Arc::clone(&barrier);
        let sync = std::thread::spawn(move || {
            sync_barrier.wait();
            sync_host.begin_sync_run()
        });
        let mutation_host = std::sync::Arc::clone(&host);
        let mutation_barrier = std::sync::Arc::clone(&barrier);
        let mutation = std::thread::spawn(move || {
            mutation_barrier.wait();
            mutation_host.edit_domain_asset(edit_request(
                "quarantine-concurrent-mutation",
                0,
                1,
                "must-not-write",
            ))
        });
        barrier.wait();

        assert!(matches!(
            grant.join().unwrap(),
            Err(DesktopLocalHostError::AuthorityRejected | DesktopLocalHostError::Unavailable)
        ));
        assert!(matches!(
            read.join().unwrap(),
            Err(DesktopLocalHostError::AuthorityRejected)
        ));
        assert!(matches!(
            sync.join().unwrap(),
            Err(DesktopLocalHostError::AuthorityRejected)
        ));
        assert!(matches!(
            mutation.join().unwrap(),
            Err(DesktopLocalHostError::AuthorityRejected)
        ));
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert!(host.runtime_state.lock().unwrap().is_none());
        assert_eq!(
            host.rebootstrap_quarantine_custody
                .as_ref()
                .unwrap()
                .state_digest(&store)
                .unwrap(),
            state_before
        );
        assert_eq!(std::fs::read(&journal_path).ok(), journal_before);
        drop(directory);
    }

    #[cfg(unix)]
    #[test]
    fn fresh_grant_read_and_sync_admission_linearize_after_recovery() {
        let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let journal_path = application_path
            .join("active-workspace")
            .join("rebootstrap.journal");
        let (mut host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local").unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::CancelledUnpublished
        );
        let journal_before = std::fs::read(&journal_path).unwrap();
        let (verifier, signed_wire) = super::super::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
        let device_id = host
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .load_device_id()
            .unwrap();
        VerifiedBackupAuthority::verify(
            &signed_wire,
            &TrustedBackupBinding {
                account_id: None,
                device_id: &device_id,
                minimum_account_security_epoch: 0,
                minimum_lease_epoch: 0,
            },
            current_unix_seconds().unwrap(),
            &verifier,
        )
        .unwrap();
        host.authority_verifier = Some(verifier);
        let host = std::sync::Arc::new(host);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));

        let grant_host = std::sync::Arc::clone(&host);
        let grant_barrier = std::sync::Arc::clone(&barrier);
        let grant = std::thread::spawn(move || {
            grant_barrier.wait();
            grant_host.activate_authorization_grant(&signed_wire)
        });
        let read_host = std::sync::Arc::clone(&host);
        let read_barrier = std::sync::Arc::clone(&barrier);
        let read = std::thread::spawn(move || {
            read_barrier.wait();
            read_host.read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
        });
        let sync_host = std::sync::Arc::clone(&host);
        let sync_barrier = std::sync::Arc::clone(&barrier);
        let sync = std::thread::spawn(move || {
            sync_barrier.wait();
            sync_host.begin_sync_run()
        });
        barrier.wait();

        assert_eq!(grant.join().unwrap(), Ok(()));
        match read.join().unwrap() {
            Ok(snapshot) => {
                assert_eq!(snapshot.total_rows, 1);
                assert_eq!(snapshot.window.rows[0].domain, "old-local.example");
            }
            Err(error) => assert_eq!(error, DesktopLocalHostError::AuthorityRejected),
        }
        match sync.join().unwrap() {
            Ok(_) => {}
            Err(error) => assert_eq!(error, DesktopLocalHostError::AuthorityRejected),
        }
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::Active
        );
        assert!(host.begin_sync_run().is_ok());
        assert_eq!(std::fs::read(&journal_path).unwrap(), journal_before);
    }

    #[cfg(unix)]
    #[test]
    fn hostile_slot_states_quarantine_without_repair() {
        let cases = [
            TestRebootstrapStoreHostileCase::RemoveSlot(RebootstrapSlot::B),
            TestRebootstrapStoreHostileCase::MalformSlot(RebootstrapSlot::A),
            TestRebootstrapStoreHostileCase::MalformSlot(RebootstrapSlot::B),
            TestRebootstrapStoreHostileCase::ReplaceSlotKey(RebootstrapSlot::A),
            TestRebootstrapStoreHostileCase::ReplaceSlotKey(RebootstrapSlot::B),
            TestRebootstrapStoreHostileCase::ReplaceSlotOrigin(RebootstrapSlot::A),
            TestRebootstrapStoreHostileCase::ReplaceSlotOrigin(RebootstrapSlot::B),
            TestRebootstrapStoreHostileCase::SwapSlots,
        ];
        for hostile in cases {
            let (_directory, root, store) =
                seed_rebootstrap_crash(RebootstrapCrashBoundary::CandidateReserved);
            store.apply_hostile_case_for_test(hostile).unwrap();
            let (host, disposition) =
                DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local")
                    .unwrap_or_else(|error| {
                        panic!("hostile {hostile:?} failed closed incorrectly: {error:?}")
                    });
            assert_eq!(
                disposition,
                RebootstrapRestartDisposition::Quarantined,
                "hostile {hostile:?} was admitted"
            );
            assert_eq!(
                host.business_status().state,
                DesktopLocalBusinessState::SecurityLocked
            );
            assert!(host.runtime_state.lock().unwrap().is_none());
        }
    }

    #[cfg(unix)]
    #[test]
    fn corrupted_alias_cache_is_repaired_only_after_authenticated_slot_recovery() {
        let hostile_aliases = [
            TestRebootstrapStoreHostileCase::RemoveActiveAlias,
            TestRebootstrapStoreHostileCase::MalformActiveAliasShort,
            TestRebootstrapStoreHostileCase::MalformActiveAliasLong,
            TestRebootstrapStoreHostileCase::RandomActiveAlias,
            TestRebootstrapStoreHostileCase::ReplaceActiveAliasKey,
        ];
        for boundary in [
            RebootstrapCrashBoundary::CandidateReserved,
            RebootstrapCrashBoundary::Published,
        ] {
            let expected = if boundary == RebootstrapCrashBoundary::CandidateReserved {
                RebootstrapRestartDisposition::CancelledUnpublished
            } else {
                RebootstrapRestartDisposition::ResumedPublished
            };
            for hostile in hostile_aliases {
                let (directory, root, store) = seed_rebootstrap_crash(boundary);
                let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
                store.apply_hostile_case_for_test(hostile).unwrap();
                let (mut host, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                    root,
                    store.clone(),
                    "workspace-local",
                )
                .unwrap_or_else(|error| {
                    panic!("alias cache {hostile:?}/{boundary:?} was not recoverable: {error:?}")
                });
                assert_eq!(
                    disposition, expected,
                    "alias cache {hostile:?}/{boundary:?}"
                );
                activate_recovered_host_and_assert_business(
                    &mut host,
                    expected,
                    "alias-cache-repair",
                    boundary,
                );
                drop(host);

                // A second process start must load the repaired alias from custody rather than
                // relying on the first recovery's in-memory slot key.
                let second_root = DesktopApplicationRoot::validate(&application_path).unwrap();
                let (mut second, second_disposition) =
                    DesktopLocalHost::restart_rebootstrap_for_test(
                        second_root,
                        store.clone(),
                        "workspace-local",
                    )
                    .unwrap_or_else(|error| {
                        panic!(
                            "repaired alias {hostile:?}/{boundary:?} did not read back: {error:?}"
                        )
                    });
                assert_eq!(
                    second_disposition,
                    RebootstrapRestartDisposition::TerminalValidated,
                    "repaired alias {hostile:?}/{boundary:?}"
                );
                activate_recovered_host_and_assert_business(
                    &mut second,
                    expected,
                    "alias-cache-readback",
                    boundary,
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn sole_credential_cancel_prefix_requires_exact_alias_and_quarantines_without_writing() {
        for hostile in [
            TestRebootstrapStoreHostileCase::RemoveActiveAlias,
            TestRebootstrapStoreHostileCase::MalformActiveAliasShort,
            TestRebootstrapStoreHostileCase::MalformActiveAliasLong,
            TestRebootstrapStoreHostileCase::RandomActiveAlias,
            TestRebootstrapStoreHostileCase::ReplaceActiveAliasKey,
        ] {
            let (_directory, root, store) = seed_cancel_restart_crash_from(
                RebootstrapCrashBoundary::CandidateReserved,
                RebootstrapCrashBoundary::CancelOldSlotDeleted,
            );
            store.apply_hostile_case_for_test(hostile).unwrap();
            let journal_path = root.rebootstrap_journal_path();
            let journal_before = std::fs::read(&journal_path).unwrap();
            let probe = TestRebootstrapRecoveryCustody::open(&root, store.clone()).unwrap();
            let state_before = probe.state_digest().unwrap();
            drop(probe);

            let (host, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("sole-credential alias {hostile:?} did not fail closed: {error:?}")
            });
            assert_eq!(
                disposition,
                RebootstrapRestartDisposition::Quarantined,
                "sole-credential alias {hostile:?} was admitted"
            );
            assert_eq!(
                host.business_status().state,
                DesktopLocalBusinessState::SecurityLocked
            );
            assert!(host.runtime_state.lock().unwrap().is_none());
            assert_eq!(
                host.rebootstrap_quarantine_custody
                    .as_ref()
                    .unwrap()
                    .state_digest(&store)
                    .unwrap(),
                state_before,
                "sole-credential alias {hostile:?} was mutated during rejection"
            );
            assert_eq!(
                std::fs::read(&journal_path).unwrap(),
                journal_before,
                "sole-credential alias {hostile:?} appended a journal record"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn hostile_journal_wires_and_file_topologies_fail_closed_without_repair() {
        for (name, wire) in [
            ("malformed", b"{".as_slice()),
            ("legacy-v2", br#"{"schemaVersion":2}"#.as_slice()),
            ("unknown-v4", br#"{"schemaVersion":4}"#.as_slice()),
            (
                "unknown-field",
                br#"{"schemaVersion":3,"unexpected":true}"#.as_slice(),
            ),
        ] {
            let (_directory, root, store) =
                seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
            std::fs::write(root.rebootstrap_journal_path(), wire).unwrap();
            let (host, disposition) =
                DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local")
                    .unwrap_or_else(|error| {
                        panic!("journal {name} did not fail closed: {error:?}")
                    });
            assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
            assert_eq!(
                host.business_status().state,
                DesktopLocalBusinessState::SecurityLocked
            );
        }

        for topology in ["sidecar", "hardlink", "mode", "wrong-inode", "symlink"] {
            let (directory, root, store) =
                seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
            let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
            let workspace = application_path.join("active-workspace");
            let database = workspace.join("business.db");
            match topology {
                "sidecar" => std::fs::write(workspace.join("business.db-wal"), b"foreign").unwrap(),
                "hardlink" => {
                    std::fs::hard_link(&database, workspace.join("business-hardlink.db")).unwrap();
                }
                "mode" => {
                    use std::os::unix::fs::PermissionsExt as _;
                    std::fs::set_permissions(&database, std::fs::Permissions::from_mode(0o644))
                        .unwrap();
                }
                "wrong-inode" => {
                    let replacement = workspace.join("replacement.db");
                    std::fs::copy(&database, &replacement).unwrap();
                    std::fs::rename(&database, workspace.join("original.db")).unwrap();
                    std::fs::rename(replacement, &database).unwrap();
                }
                "symlink" => {
                    use std::os::unix::fs::symlink;
                    std::fs::rename(&database, workspace.join("original.db")).unwrap();
                    symlink("original.db", &database).unwrap();
                }
                _ => unreachable!(),
            }
            let result =
                DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local");
            match result {
                Ok((host, disposition)) => {
                    assert_eq!(
                        disposition,
                        RebootstrapRestartDisposition::Quarantined,
                        "topology {topology} was admitted"
                    );
                    assert_eq!(
                        host.business_status().state,
                        DesktopLocalBusinessState::SecurityLocked
                    );
                }
                Err(DesktopLocalHostError::StorageRejected) => {}
                Err(error) => panic!("topology {topology} returned wrong error: {error:?}"),
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn wrong_workspace_and_missing_journal_with_residue_are_quarantined() {
        for boundary in [
            RebootstrapCrashBoundary::Prepared,
            RebootstrapCrashBoundary::Published,
            RebootstrapCrashBoundary::RetiredOld,
        ] {
            let (_directory, root, store) = seed_rebootstrap_crash(boundary);
            let (host, disposition) =
                DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-foreign")
                    .unwrap();
            assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
            assert_eq!(
                host.business_status().state,
                DesktopLocalBusinessState::SecurityLocked
            );
        }

        let (_directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
        std::fs::remove_file(root.rebootstrap_journal_path()).unwrap();
        let (host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local").unwrap();
        assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
    }

    #[test]
    fn qualified_development_continuity_restarts_export_inspect_only() {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x51; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        assert_eq!(
            host.continuity_startup_for_test().unwrap(),
            StartupContinuity::VerifiedLocalContinuation
        );

        host.enter_commercial_read_only().unwrap();
        assert_eq!(
            host.authorization_status(),
            DesktopHostAuthorizationStatus::Continuation
        );
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::CommercialReadOnly
        );
        let status = serde_json::to_value(host.backup_status()).unwrap();
        assert_eq!(status["authority"], "verified_local_continuation");
        assert_eq!(status["exportAdmission"]["state"], "available");
        assert_eq!(status["artifactSelectionAdmission"]["state"], "available");
        let sync = serde_json::to_value(host.read_sync_snapshot().unwrap()).unwrap();
        assert_eq!(sync["source"], "local_continuation");
        assert_eq!(sync["transport"], "blocked");
        assert_eq!(sync["blockedReason"], "authorization");
        assert_eq!(sync["activity"], "idle");
        let conflicts = serde_json::to_value(host.read_conflict_center().unwrap()).unwrap();
        assert_eq!(conflicts["freshness"]["source"], "local_continuation");
        let publication = host.authority_publication.lock().unwrap();
        assert!(host.require_current_authority(&publication, false).is_ok());
        assert_eq!(
            host.require_current_authority(&publication, true),
            Err(DesktopBackupError::AuthorityRejected)
        );
    }

    #[test]
    fn unqualified_continuity_never_misreports_commercial_backup_authority() {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x52; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        {
            let mut publication = host.authority_publication.lock().unwrap();
            publication.continuity = None;
            publication.verified_continuation = None;
        }
        assert_eq!(
            host.enter_commercial_read_only(),
            Err(DesktopLocalHostError::AuthorityRejected)
        );
        assert_eq!(
            host.authorization_status(),
            DesktopHostAuthorizationStatus::SecurityLocked
        );
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert!(matches!(
            host.read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            }),
            Err(DesktopLocalHostError::AuthorityRejected)
        ));
        let status = serde_json::to_value(host.backup_status()).unwrap();
        assert_eq!(status["authority"], "unavailable");
        assert_eq!(status["exportAdmission"]["state"], "unavailable");
        assert_eq!(status["artifactSelectionAdmission"]["state"], "unavailable");
    }

    #[test]
    fn qualified_host_startup_locks_on_receipt_tamper() {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x53; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        {
            let publication = host.authority_publication.lock().unwrap();
            publication
                .continuity
                .as_ref()
                .unwrap()
                .tamper_committed_receipt_for_test()
                .unwrap();
        }
        assert_eq!(
            host.continuity_startup_for_test().unwrap(),
            StartupContinuity::SecurityLocked
        );
    }

    #[test]
    fn qualified_host_persists_retryable_barrier_before_clearing_runtime() {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x54; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        let binding = host
            .authority_publication
            .lock()
            .unwrap()
            .verified_continuation
            .as_ref()
            .unwrap()
            .binding();
        host.enter_retryable_lock().unwrap();
        let publication = host.authority_publication.lock().unwrap();
        let startup = publication
            .continuity
            .as_ref()
            .unwrap()
            .load_startup(&binding, current_unix_seconds().unwrap(), true, true)
            .unwrap();
        assert_eq!(startup.decision, StartupContinuity::RetryableLocked);
        assert!(startup.continuation.is_none());
        assert!(host.runtime_state.lock().unwrap().is_none());
    }

    #[test]
    fn half_composed_continuity_fails_closed_for_restriction_transitions() {
        let retryable_directory = tempdir().unwrap();
        let retryable_database = BusinessDatabase::open(
            &retryable_directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x55; 32]),
            "workspace-local",
        )
        .unwrap();
        let retryable_host = DesktopLocalHost::development(
            retryable_database,
            retryable_directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        retryable_host
            .authority_publication
            .lock()
            .unwrap()
            .verified_continuation = None;

        assert_eq!(
            retryable_host.enter_commercial_read_only(),
            Err(DesktopLocalHostError::StorageRejected)
        );
        let retryable_authority = retryable_host.authority_publication.lock().unwrap();
        assert_eq!(
            retryable_authority.restriction,
            RuntimeRestriction::SecurityLocked
        );
        assert!(retryable_authority.authority.is_none());
        assert!(retryable_authority.verified_continuation.is_none());
        drop(retryable_authority);
        assert!(retryable_host.runtime_state.lock().unwrap().is_none());
        assert_eq!(
            retryable_host.authorization_status(),
            DesktopHostAuthorizationStatus::SecurityLocked
        );
        assert!(matches!(
            retryable_host.read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            }),
            Err(DesktopLocalHostError::AuthorityRejected)
        ));

        let commercial_directory = tempdir().unwrap();
        let commercial_database = BusinessDatabase::open(
            &commercial_directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([0x56; 32]),
            "workspace-local",
        )
        .unwrap();
        let commercial_host = DesktopLocalHost::development(
            commercial_database,
            commercial_directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        commercial_host
            .authority_publication
            .lock()
            .unwrap()
            .continuity = None;

        assert_eq!(
            commercial_host.enter_commercial_read_only(),
            Err(DesktopLocalHostError::StorageRejected)
        );
        let commercial_authority = commercial_host.authority_publication.lock().unwrap();
        assert_eq!(
            commercial_authority.restriction,
            RuntimeRestriction::SecurityLocked
        );
        assert!(commercial_authority.authority.is_none());
        assert!(commercial_authority.verified_continuation.is_none());
        drop(commercial_authority);
        assert!(commercial_host.runtime_state.lock().unwrap().is_none());
        assert_eq!(
            commercial_host.authorization_status(),
            DesktopHostAuthorizationStatus::SecurityLocked
        );
        assert!(matches!(
            commercial_host.read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            }),
            Err(DesktopLocalHostError::AuthorityRejected)
        ));
    }

    #[test]
    fn request_wire_is_bounded_exact_and_single_value() {
        let host = DesktopLocalHost::production_unavailable();
        for wire in [
            br"{}".as_slice(),
            br#"{"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false,"extra":true}"#,
            br#"{"schemaVersion":1,"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false}"#,
            br#"{"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false} {}"#,
        ] {
            assert_eq!(
                host.export_backup(wire),
                Err(DesktopBackupError::OperationRejected)
            );
        }
        assert_eq!(
            host.export_backup(&vec![b' '; MAX_REQUEST_WIRE_BYTES + 1]),
            Err(DesktopBackupError::OperationRejected)
        );
        let mut exact_maximum = br#"{"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false}"#.to_vec();
        exact_maximum.resize(MAX_REQUEST_WIRE_BYTES, b' ');
        assert!(parse_request::<BackupExportRequest>(&exact_maximum).is_ok());
    }

    #[test]
    fn credential_request_is_rejected_before_native_availability() {
        let host = DesktopLocalHost::production_unavailable();
        let wire = format!(
            r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}","includePlatformCredentials":true}}"#
        );
        assert_eq!(
            host.export_backup(wire.as_bytes()),
            Err(DesktopBackupError::CredentialsNotAllowed)
        );
    }

    #[test]
    fn valid_requests_without_host_issued_admission_fail_closed() {
        let host = DesktopLocalHost::production_unavailable();
        let export = format!(
            r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}","includePlatformCredentials":false}}"#
        );
        let inspect = format!(r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}"}}"#);
        let restore = format!(
            r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}","dialogId":"dialog-opaque-00001","artifactId":"artifact-opaque-001","expectedCurrentRevision":0,"candidateSetVersion":1,"confirmation":"RESTORE LOCAL BACKUP"}}"#
        );
        assert_eq!(
            host.export_backup(export.as_bytes()),
            Err(DesktopBackupError::OperationRejected)
        );
        assert_eq!(
            host.inspect_backup(inspect.as_bytes()),
            Err(DesktopBackupError::OperationRejected)
        );
        assert_eq!(
            host.restore_backup(restore.as_bytes()),
            Err(DesktopBackupError::OperationRejected)
        );
    }

    #[test]
    fn debug_output_is_redacted() {
        let host = DesktopLocalHost::production_unavailable();
        assert_eq!(format!("{host:?}"), "DesktopLocalHost([REDACTED])");
    }

    fn asset(note: &str) -> DomainAssetWrite {
        DomainAssetWrite {
            entity_id: "backup.example".to_owned(),
            note: Some(note.to_owned()),
            portfolio_id: None,
            tags: vec!["backup".to_owned()],
            target_price: None,
        }
    }

    fn development_business_host() -> (tempfile::TempDir, DesktopLocalHost) {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x5a; 32]);
        let mut database = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &key,
            "workspace-local",
        )
        .unwrap();
        database
            .upsert_domain_asset("seed-business", "2026-09-15T08:00:00Z", &asset("before"))
            .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        (directory, host)
    }

    fn development_conflict_host() -> (tempfile::TempDir, DesktopLocalHost) {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x5b; 32]);
        let mut database = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &key,
            "workspace-local",
        )
        .unwrap();
        database
            .upsert_domain_asset("seed-conflict", "2026-09-15T08:00:00Z", &asset("local"))
            .unwrap();
        let page = serde_json::json!({
            "schemaVersion": 2,
            "workspaceId": "workspace-local",
            "fromServerRevisionExclusive": 0,
            "throughServerRevisionInclusive": 1,
            "mutations": [{
                "schemaVersion": 2,
                "mutationId": "remote-conflict",
                "workspaceId": "workspace-local",
                "workspaceSchemaVersion": 1,
                "entityType": "domain_asset",
                "entityId": "backup.example",
                "operationKind": "upsert",
                "baseServerRevision": 0,
                "changedFields": [{"fieldPath": "note", "value": "remote"}],
                "sourceDeviceId": "remote-device",
                "activeLeaseEpoch": 1,
                "deviceMutationSequence": 1,
                "serverRevision": 1
            }],
            "returnedThroughServerRevision": 1,
            "nextCursor": null,
            "pageDigest": "2S2lq2o99v0N6qj0CMA43KAKicm4ydvqX-ZtAM11ogg"
        });
        database
            .apply_sync_page_v2("reader-local", &page.to_string(), "confirm-conflict")
            .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        (directory, host)
    }

    fn domain_detail_request() -> DesktopDomainDetailReadRequest {
        serde_json::from_value(serde_json::json!({"entityId": "backup.example"})).unwrap()
    }

    fn edit_request(
        mutation_id: &str,
        read_generation: u64,
        asset_version: u64,
        note: &str,
    ) -> DesktopDomainAssetEditRequest {
        serde_json::from_value(serde_json::json!({
            "mutationId": mutation_id,
            "expectedReadGeneration": read_generation,
            "expectedAssetVersion": asset_version,
            "asset": {
                "entityId": "backup.example",
                "note": note,
                "portfolioId": null,
                "tags": ["backup"],
                "targetPrice": null
            }
        }))
        .unwrap()
    }

    fn delete_request(
        mutation_id: &str,
        read_generation: u64,
        asset_version: u64,
    ) -> DesktopDomainAssetDeleteRequest {
        serde_json::from_value(serde_json::json!({
            "mutationId": mutation_id,
            "expectedReadGeneration": read_generation,
            "expectedAssetVersion": asset_version,
            "entityId": "backup.example"
        }))
        .unwrap()
    }

    fn conflict_request(view: &DesktopConflictCenterView) -> DesktopConflictResolveRequest {
        let conflict = view.conflicts.first().expect("conflict");
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "expectedReadGeneration": view.read_generation,
            "candidateSetVersion": view.candidate_set_version,
            "candidateId": conflict.candidate_id,
            "expectedRevision": conflict.comparison_server_revision,
            "expectedCandidateVersion": conflict.resolution_admission["expectedCandidateVersion"],
            "expectedCurrentValueHash": conflict.current_value_hash,
            "choice": "keep_local"
        }))
        .unwrap()
    }

    fn pending_mutation_count(host: &DesktopLocalHost) -> usize {
        host.runtime_state
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .business
            .database_for_backup()
            .test_pending_sync_rows(1_000)
            .unwrap()
            .len()
    }

    fn request_id(status: &serde_json::Value, field: &str) -> String {
        status[field]["operationId"]
            .as_str()
            .expect("available operation id")
            .to_owned()
    }

    fn development_restore_host(key_byte: u8) -> (tempfile::TempDir, DesktopLocalHost) {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([key_byte; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("mutation-old", "2026-09-15T08:00:00Z", &asset("old"))
            .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        (directory, host)
    }

    fn prepare_restore_request(host: &DesktopLocalHost) -> Vec<u8> {
        let status = serde_json::to_value(host.backup_status()).unwrap();
        let export_operation_id = request_id(&status, "exportAdmission");
        let selection_operation_id = request_id(&status, "artifactSelectionAdmission");
        host.export_backup(
            format!(r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#)
                .as_bytes(),
        )
        .unwrap();
        host.runtime_state
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .business
            .database_for_backup_mut()
            .upsert_domain_asset("mutation-new", "2026-09-15T08:01:00Z", &asset("new"))
            .unwrap();
        let verified = serde_json::to_value(
            host.inspect_backup(
                format!(r#"{{"schemaVersion":1,"operationId":"{selection_operation_id}"}}"#)
                    .as_bytes(),
            )
            .unwrap(),
        )
        .unwrap();
        let admission = &verified["restoreAdmission"];
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1,
            "operationId": admission["operationId"],
            "dialogId": admission["dialogId"],
            "artifactId": verified["artifactId"],
            "expectedCurrentRevision": admission["expectedCurrentRevision"],
            "candidateSetVersion": admission["candidateSetVersion"],
            "confirmation": REQUIRED_CONFIRMATION,
        }))
        .unwrap()
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RestoreDatabaseSnapshot {
        local_commit_sequence: u64,
        note: Option<String>,
        restore_outbox_rows: i64,
        restore_history_rows: i64,
    }

    fn restore_database_snapshot(host: &DesktopLocalHost) -> RestoreDatabaseSnapshot {
        let mut runtime = host.runtime_state.lock().unwrap();
        let database = runtime.as_mut().unwrap().business.database_for_backup_mut();
        let local_commit_sequence = database.recovery_proof().unwrap().local_commit_sequence;
        let note = database
            .read_domain_detail("backup.example")
            .unwrap()
            .asset
            .note;
        let (restore_outbox_rows, restore_history_rows) = database
            .backup_connection_mut()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM sync_outbox WHERE mutation_id LIKE 'restore-%'),
                   (SELECT count(*) FROM business_history_events
                     WHERE event_kind LIKE 'backup_restore_%')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        RestoreDatabaseSnapshot {
            local_commit_sequence,
            note,
            restore_outbox_rows,
            restore_history_rows,
        }
    }

    #[test]
    fn business_edit_transition_at_final_fence_rolls_back_every_write() {
        let (_directory, host) = development_business_host();
        let before = host.read_domain_detail(domain_detail_request()).unwrap();
        let before_pending = pending_mutation_count(&host);
        let before_generation = host.business_status().read_generation;
        host.publish_transition_at_next_business_commit_for_test()
            .unwrap();

        assert_eq!(
            host.edit_domain_asset(edit_request(
                "fenced-edit",
                before_generation,
                before.asset.asset_version,
                "must-rollback",
            )),
            Err(DesktopLocalHostError::AuthorityRejected)
        );

        let runtime = host.runtime_state.lock().unwrap();
        let business = &runtime.as_ref().unwrap().business;
        assert_eq!(
            business
                .read_domain_detail("backup.example")
                .unwrap()
                .asset
                .note
                .as_deref(),
            Some("before")
        );
        assert_eq!(business.read_generation(), before_generation);
        assert_eq!(
            business
                .database_for_backup()
                .test_pending_sync_rows(1_000)
                .unwrap()
                .len(),
            before_pending
        );
    }

    #[test]
    fn business_delete_transition_at_final_fence_rolls_back_every_write() {
        let (_directory, host) = development_business_host();
        let before = host.read_domain_detail(domain_detail_request()).unwrap();
        let before_pending = pending_mutation_count(&host);
        let before_generation = host.business_status().read_generation;
        host.publish_transition_at_next_business_commit_for_test()
            .unwrap();

        assert_eq!(
            host.delete_domain_asset(delete_request(
                "fenced-delete",
                before_generation,
                before.asset.asset_version,
            )),
            Err(DesktopLocalHostError::AuthorityRejected)
        );

        let runtime = host.runtime_state.lock().unwrap();
        let business = &runtime.as_ref().unwrap().business;
        let after = business.read_domain_detail("backup.example").unwrap();
        assert_eq!(after.asset.note.as_deref(), Some("before"));
        assert_eq!(business.read_generation(), before_generation);
        assert_eq!(
            business
                .database_for_backup()
                .test_pending_sync_rows(1_000)
                .unwrap()
                .len(),
            before_pending
        );
    }

    #[test]
    fn business_resolve_transition_at_final_fence_rolls_back_every_write() {
        let (_directory, host) = development_conflict_host();
        let view = host.read_conflict_center().unwrap();
        let request = conflict_request(&view);
        let before_pending = pending_mutation_count(&host);
        let before_generation = host.business_status().read_generation;
        host.publish_transition_at_next_business_commit_for_test()
            .unwrap();

        assert_eq!(
            host.resolve_conflict(request),
            Err(DesktopLocalHostError::AuthorityRejected)
        );

        let runtime = host.runtime_state.lock().unwrap();
        let business = &runtime.as_ref().unwrap().business;
        let after = business.read_conflict_center().unwrap();
        assert_eq!(after.conflicts.len(), 1);
        assert_eq!(after.conflicts[0].status, "pending");
        assert_eq!(business.read_generation(), before_generation);
        assert_eq!(
            business
                .database_for_backup()
                .test_pending_sync_rows(1_000)
                .unwrap()
                .len(),
            before_pending
        );
    }

    #[test]
    fn conflict_retry_after_lease_renewal_replays_without_duplicate_and_new_work_uses_new_lease() {
        let (_directory, host) = development_conflict_host();
        let view = host.read_conflict_center().unwrap();
        let request_wire = serde_json::json!({
            "schemaVersion": 1,
            "expectedReadGeneration": view.read_generation,
            "candidateSetVersion": view.candidate_set_version,
            "candidateId": view.conflicts[0].candidate_id,
            "expectedRevision": view.conflicts[0].comparison_server_revision,
            "expectedCandidateVersion": view.conflicts[0].resolution_admission["expectedCandidateVersion"],
            "expectedCurrentValueHash": view.conflicts[0].current_value_hash,
            "choice": "keep_local"
        });
        let before_pending = pending_mutation_count(&host);
        let first = host
            .resolve_conflict(serde_json::from_value(request_wire.clone()).unwrap())
            .unwrap();
        assert!(first.enqueued_for_sync);
        assert_eq!(first.read_generation, 1);
        assert_eq!(pending_mutation_count(&host), before_pending + 1);
        assert_eq!(host.business_status().read_generation, 1);

        host.renew_business_authority_for_test(2).unwrap();
        let replay = host
            .resolve_conflict(serde_json::from_value(request_wire.clone()).unwrap())
            .unwrap();
        assert_eq!(replay, first);
        assert_eq!(pending_mutation_count(&host), before_pending + 1);
        assert_eq!(host.business_status().read_generation, 1);

        let detail = host.read_domain_detail(domain_detail_request()).unwrap();
        let committed = host
            .edit_domain_asset(edit_request(
                "after-lease-renewal",
                1,
                detail.asset.asset_version,
                "lease-two",
            ))
            .unwrap();
        assert_eq!(committed.active_lease_epoch, 2);
        assert_eq!(pending_mutation_count(&host), before_pending + 2);
        assert_eq!(host.business_status().read_generation, 2);
        assert_eq!(
            host.resolve_conflict(serde_json::from_value(request_wire).unwrap()),
            Err(DesktopLocalHostError::AuthorityRejected)
        );
    }

    #[test]
    fn restore_transition_at_final_commit_fence_rolls_back_and_consumes_candidate() {
        let (_directory, host) = development_restore_host(0x71);
        let restore_wire = prepare_restore_request(&host);
        let before = restore_database_snapshot(&host);
        let zeroized_before = super::super::source::asset_drop_probe_counts().0;
        host.publish_transition_at_restore_precommit_for_test()
            .unwrap();

        assert_eq!(
            host.restore_backup(&restore_wire),
            Err(DesktopBackupError::AuthorityRejected)
        );
        assert_eq!(restore_database_snapshot(&host), before);
        assert!(super::super::source::asset_drop_probe_counts().0 > zeroized_before);
        assert_eq!(super::super::source::asset_drop_probe_counts().1, 0);
        {
            let operation = host.operation_selection.lock().unwrap();
            assert!(operation.selected_artifact.is_none());
            assert!(operation.selected_handle.is_none());
        }
        assert_eq!(
            host.restore_backup(&restore_wire),
            Err(DesktopBackupError::OperationRejected)
        );

        // The pending intent can subsequently be applied as a real closed transition.
        host.request_security_lock_for_test().unwrap();
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
    }

    #[test]
    fn restore_transition_after_sqlite_commit_preserves_success_then_applies_lock() {
        let (_directory, host) = development_restore_host(0x72);
        let restore_wire = prepare_restore_request(&host);
        let before = restore_database_snapshot(&host);
        host.publish_transition_after_restore_commit_for_test()
            .unwrap();

        let completed = host.restore_backup(&restore_wire).unwrap();
        assert_eq!(completed.authority, "active");
        assert!(matches!(
            completed.selected_artifact,
            SelectedArtifactView::None
        ));
        let after = restore_database_snapshot(&host);
        assert_eq!(after.note.as_deref(), Some("old"));
        assert!(after.local_commit_sequence > before.local_commit_sequence);
        assert!(after.restore_outbox_rows > before.restore_outbox_rows);
        assert!(after.restore_history_rows > before.restore_history_rows);

        // COMMIT is the terminal outcome even though a later intent is already visible. The
        // transition can now acquire the aggregate locks and remove the active runtime.
        assert_ne!(
            host.transition_requested_epoch.load(Ordering::Acquire),
            host.authority_publication
                .lock()
                .unwrap()
                .applied_authority_epoch
        );
        host.request_security_lock_for_test().unwrap();
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert!(host.runtime_state.lock().unwrap().is_none());
    }

    #[test]
    fn private_development_e2e_projects_seals_rereads_and_restores_current_database() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x7a; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("mutation-old", "2026-09-15T08:00:00Z", &asset("old"))
            .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();

        let status = serde_json::to_value(host.backup_status()).unwrap();
        let export_operation_id = request_id(&status, "exportAdmission");
        let selection_operation_id = request_id(&status, "artifactSelectionAdmission");
        let export_wire = format!(
            r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#
        );
        host.export_backup(export_wire.as_bytes()).unwrap();
        assert_eq!(
            std::fs::read_to_string(
                directory
                    .path()
                    .join("native-backup")
                    .join(format!("{export_operation_id}.journal"))
            )
            .unwrap(),
            "catalog_available"
        );

        host.runtime_state
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .business
            .database_for_backup_mut()
            .upsert_domain_asset("mutation-new", "2026-09-15T08:01:00Z", &asset("new"))
            .unwrap();
        let zeroized_before = super::super::source::asset_drop_probe_counts().0;
        let inspect_wire =
            format!(r#"{{"schemaVersion":1,"operationId":"{selection_operation_id}"}}"#);
        let verified =
            serde_json::to_value(host.inspect_backup(inspect_wire.as_bytes()).unwrap()).unwrap();
        assert!(super::super::source::asset_drop_probe_counts().0 > zeroized_before);
        assert_eq!(verified["state"], "verified");
        assert_eq!(verified["compatibility"], "compatible");
        let admission = &verified["restoreAdmission"];
        let restore_wire = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1,
            "operationId": admission["operationId"],
            "dialogId": admission["dialogId"],
            "artifactId": verified["artifactId"],
            "expectedCurrentRevision": admission["expectedCurrentRevision"],
            "candidateSetVersion": admission["candidateSetVersion"],
            "confirmation": REQUIRED_CONFIRMATION,
        }))
        .unwrap();
        let restored = host.restore_backup(&restore_wire).unwrap();
        assert_eq!(
            serde_json::to_value(restored).unwrap()["selectedArtifact"]["state"],
            "none"
        );
        let detail = host
            .runtime_state
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .business
            .read_domain_detail("backup.example")
            .unwrap();
        assert_eq!(detail.asset.note.as_deref(), Some("old"));
        assert_eq!(super::super::source::asset_drop_probe_counts().1, 0);
    }

    #[test]
    fn pending_authority_epoch_invalidates_an_admitted_operation_before_crypto() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x7b; 32]);
        let database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        let status = serde_json::to_value(host.backup_status()).unwrap();
        let export_operation_id = request_id(&status, "exportAdmission");
        host.transition_requested_epoch.store(2, Ordering::Release);
        let wire = format!(
            r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#
        );
        assert_eq!(
            host.export_backup(wire.as_bytes()),
            Err(DesktopBackupError::AuthorityRejected)
        );
    }

    #[test]
    fn restore_rereads_exact_handle_and_rejects_same_size_cas_change() {
        use std::io::{Seek as _, SeekFrom, Write as _};

        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x7d; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("mutation-old", "2026-09-15T08:00:00Z", &asset("old"))
            .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        let status = serde_json::to_value(host.backup_status()).unwrap();
        let export_operation_id = request_id(&status, "exportAdmission");
        let selection_operation_id = request_id(&status, "artifactSelectionAdmission");
        host.export_backup(
            format!(r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#)
                .as_bytes(),
        )
        .unwrap();
        let verified = serde_json::to_value(
            host.inspect_backup(
                format!(r#"{{"schemaVersion":1,"operationId":"{selection_operation_id}"}}"#)
                    .as_bytes(),
            )
            .unwrap(),
        )
        .unwrap();
        let admission = &verified["restoreAdmission"];
        let restore_wire = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1,
            "operationId": admission["operationId"],
            "dialogId": admission["dialogId"],
            "artifactId": verified["artifactId"],
            "expectedCurrentRevision": admission["expectedCurrentRevision"],
            "candidateSetVersion": admission["candidateSetVersion"],
            "confirmation": REQUIRED_CONFIRMATION,
        }))
        .unwrap();
        let path = directory
            .path()
            .join("native-backup")
            .join(format!("{export_operation_id}.gdbk"));
        let mut file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        file.write_all(b"X").unwrap();
        file.sync_all().unwrap();

        assert_eq!(
            host.restore_backup(&restore_wire),
            Err(DesktopBackupError::ArtifactRejected)
        );
        assert!(
            host.operation_selection
                .lock()
                .unwrap()
                .selected_handle
                .is_none()
        );
    }

    #[test]
    fn restriction_transition_clears_selection_and_admission() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x7c; 32]);
        let database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(host.backup_status()).unwrap()["authority"],
            "active"
        );
        host.request_security_lock_for_test().unwrap();
        assert_eq!(
            serde_json::to_value(host.backup_status()).unwrap()["authority"],
            "unavailable"
        );
    }

    #[test]
    fn activation_failure_fails_closed_and_clears_runtime_state() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x7d; 32]);
        let database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        let before = host.transition_requested_epoch.load(Ordering::Acquire);
        assert_eq!(
            host.activate_authorization_grant(b"malformed-grant"),
            Err(DesktopLocalHostError::Unavailable)
        );
        let after = host.transition_requested_epoch.load(Ordering::Acquire);
        let authority = host.authority_publication.lock().unwrap();
        assert_eq!(authority.restriction, RuntimeRestriction::SecurityLocked);
        assert!(authority.authority.is_none());
        assert_eq!(authority.applied_authority_epoch, after);
        assert!(after > before);
        assert!(host.runtime_state.lock().unwrap().is_none());
    }

    #[test]
    fn valid_signed_incompatible_replacement_fails_closed_and_clears_all_runtime_state() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x5d; 32]);
        let database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        let mut host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        let (verifier, signed_wire) = super::super::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "9998-12-31T23:59:59Z",
        );
        host.authority_verifier = Some(verifier);
        let continuation_binding = host
            .authority_publication
            .lock()
            .unwrap()
            .verified_continuation
            .as_ref()
            .unwrap()
            .binding();
        let _ = host.backup_status();
        let before = host.transition_requested_epoch.load(Ordering::Acquire);

        assert_eq!(
            host.activate_authorization_grant(&signed_wire),
            Err(DesktopLocalHostError::AuthorityRejected)
        );

        let after = host.transition_requested_epoch.load(Ordering::Acquire);
        let authority = host.authority_publication.lock().unwrap();
        assert_eq!(authority.restriction, RuntimeRestriction::SecurityLocked);
        assert!(authority.authority.is_none());
        assert!(authority.verified_continuation.is_none());
        assert_eq!(authority.applied_authority_epoch, after);
        assert!(after > before);
        let startup = authority
            .continuity
            .as_ref()
            .unwrap()
            .load_startup(
                &continuation_binding,
                current_unix_seconds().unwrap(),
                true,
                true,
            )
            .unwrap();
        assert_eq!(startup.decision, StartupContinuity::SecurityLocked);
        assert!(startup.continuation.is_none());
        drop(authority);
        assert!(host.runtime_state.lock().unwrap().is_none());
        let operation = host.operation_selection.lock().unwrap();
        assert!(operation.selected_handle.is_none());
        assert!(operation.selected_artifact.is_none());
        assert!(operation.export_operation_id.is_none());
        assert!(operation.selection_operation_id.is_none());
        assert!(operation.export_consumed);
        assert!(operation.selection_consumed);
    }

    #[test]
    fn authority_transition_and_sync_recheck_complete_without_lock_inversion() {
        use std::sync::{Arc, Barrier, mpsc};
        use std::time::Duration;

        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x6d; 32]);
        let database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        let admission = host.begin_sync_run().unwrap();
        let start = Arc::new(Barrier::new(3));
        let (sender, receiver) = mpsc::channel();

        std::thread::scope(|scope| {
            let sync_start = Arc::clone(&start);
            let sync_sender = sender.clone();
            let sync_host = &host;
            let sync_admission = &admission;
            scope.spawn(move || {
                sync_start.wait();
                sync_sender
                    .send(("sync", sync_host.recheck_sync_run(sync_admission)))
                    .unwrap();
            });
            let transition_start = Arc::clone(&start);
            let transition_sender = sender.clone();
            let transition_host = &host;
            scope.spawn(move || {
                transition_start.wait();
                transition_sender
                    .send((
                        "transition",
                        transition_host
                            .request_security_lock_for_test()
                            .map_err(|_| DesktopLocalHostError::AuthorityRejected),
                    ))
                    .unwrap();
            });
            start.wait();

            let first = receiver
                .recv_timeout(Duration::from_secs(5))
                .expect("first concurrent operation must complete");
            let second = receiver
                .recv_timeout(Duration::from_secs(5))
                .expect("second concurrent operation must complete");
            let results = [first, second];
            assert!(
                results
                    .iter()
                    .any(|(kind, result)| { *kind == "transition" && result == &Ok(()) })
            );
            assert!(results.iter().any(|(kind, result)| {
                *kind == "sync"
                    && matches!(
                        result,
                        Ok(()) | Err(DesktopLocalHostError::AuthorityRejected)
                    )
            }));
        });
        assert_eq!(
            host.authorization_status(),
            DesktopHostAuthorizationStatus::SecurityLocked
        );
    }

    #[cfg(unix)]
    #[test]
    fn native_select_rejects_inode_swap_between_stat_and_open() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let root = directory.path().join("native");
        let native = DevelopmentNativeBackup::new(root.clone()).unwrap();
        let token = OPERATION_ID;
        let path = root.join(format!("{token}.gdbk"));
        let replacement = root.join("replacement.gdbk");
        std::fs::write(&path, b"original").unwrap();
        // Same byte length makes the inode identity check, rather than a size mismatch, the
        // mechanism that rejects the swap.
        std::fs::write(&replacement, b"intruder").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::set_permissions(&replacement, std::fs::Permissions::from_mode(0o600)).unwrap();
        let mut native = native;
        native.available.push(format!("{token}.gdbk"));
        let result = native.select_with_hooks(
            |path| {
                std::fs::rename(path, path.with_extension("gdbk.original")).unwrap();
                std::fs::rename(&replacement, path).unwrap();
            },
            |file, path| {
                let original = path.with_extension("gdbk.original");
                std::fs::rename(path, &replacement).unwrap();
                std::fs::rename(original, path).unwrap();
                // Keep the opened replacement alive until the identity comparison runs.
                assert!(file.metadata().is_ok());
            },
        );
        assert!(matches!(result, Err(DesktopBackupError::ArtifactRejected)));
    }

    #[cfg(unix)]
    #[test]
    fn recovery_rejects_symlinked_journal() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let root = directory.path().join("native");
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("outside");
        std::fs::write(&target, b"catalog_available").unwrap();
        let journal = root.join(format!("{OPERATION_ID}.journal"));
        std::os::unix::fs::symlink(&target, &journal).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(
            DevelopmentNativeBackup::new(root),
            Err(DesktopBackupError::StorageRejected)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn recovery_rejects_oversized_journal() {
        use std::os::unix::fs::OpenOptionsExt;

        let directory = tempdir().unwrap();
        let root = directory.path().join("native");
        std::fs::create_dir_all(&root).unwrap();
        let journal = root.join(format!("{OPERATION_ID}.journal"));
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&journal)
            .unwrap();
        file.write_all(&[b'x'; 65]).unwrap();
        file.sync_all().unwrap();
        assert!(matches!(
            DevelopmentNativeBackup::new(root),
            Err(DesktopBackupError::StorageRejected)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn native_reread_rejects_retained_handle_link_count_change() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let root = directory.path().join("native");
        let mut native = DevelopmentNativeBackup::new(root.clone()).unwrap();
        let path = root.join(format!("{OPERATION_ID}.gdbk"));
        std::fs::write(&path, b"artifact").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        native.available.push(format!("{OPERATION_ID}.gdbk"));
        let handle = native.select().unwrap();
        std::fs::hard_link(&path, root.join("attacker-link")).unwrap();
        assert!(matches!(
            native.read(&handle),
            Err(DesktopBackupError::ArtifactRejected)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn journal_replacement_does_not_follow_existing_symlink() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let root = directory.path().join("native");
        let native = DevelopmentNativeBackup::new(root.clone()).unwrap();
        let outside = root.join("outside");
        std::fs::write(&outside, b"do-not-overwrite").unwrap();
        std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o600)).unwrap();
        let journal = root.join(format!("{OPERATION_ID}.journal"));
        std::os::unix::fs::symlink(&outside, &journal).unwrap();
        native.persist_journal(OPERATION_ID, "reserved").unwrap();
        assert_eq!(std::fs::read(&outside).unwrap(), b"do-not-overwrite");
        let metadata = std::fs::symlink_metadata(&journal).unwrap();
        assert!(metadata.file_type().is_file());
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::read(&journal).unwrap(), b"reserved");
    }

    #[cfg(unix)]
    #[test]
    fn recovery_quarantines_every_incomplete_publication_phase() {
        use std::os::unix::fs::OpenOptionsExt;

        for phase in ["reserved", "writing", "fsynced", "renamed", "quarantined"] {
            let directory = tempdir().unwrap();
            let root = directory.path().join("native");
            std::fs::create_dir_all(&root).unwrap();
            let journal = root.join(format!("{OPERATION_ID}.journal"));
            let mut journal_file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&journal)
                .unwrap();
            journal_file.write_all(phase.as_bytes()).unwrap();
            journal_file.sync_all().unwrap();
            let available = root.join(format!("{OPERATION_ID}.gdbk"));
            let writing = root.join(format!(".{OPERATION_ID}.writing"));
            let mut available_file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&available)
                .unwrap();
            available_file.write_all(b"partial").unwrap();
            let mut writing_file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&writing)
                .unwrap();
            writing_file.write_all(b"partial").unwrap();

            let native = DevelopmentNativeBackup::new(root.clone()).unwrap();
            assert!(native.available.is_empty(), "phase {phase}");
            assert!(!available.exists(), "phase {phase}");
            assert!(!writing.exists(), "phase {phase}");
            assert_eq!(
                std::fs::read(&journal).unwrap(),
                b"quarantined",
                "phase {phase}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn recovery_restores_only_catalog_available_publication() {
        use std::os::unix::fs::OpenOptionsExt;

        let directory = tempdir().unwrap();
        let root = directory.path().join("native");
        std::fs::create_dir_all(&root).unwrap();
        let journal = root.join(format!("{OPERATION_ID}.journal"));
        let artifact = root.join(format!("{OPERATION_ID}.gdbk"));
        for (path, bytes) in [
            (&journal, b"catalog_available".as_slice()),
            (&artifact, b"artifact".as_slice()),
        ] {
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(path)
                .unwrap();
            file.write_all(bytes).unwrap();
            file.sync_all().unwrap();
        }
        let native = DevelopmentNativeBackup::new(root).unwrap();
        assert_eq!(native.available, vec![format!("{OPERATION_ID}.gdbk")]);
    }
}
