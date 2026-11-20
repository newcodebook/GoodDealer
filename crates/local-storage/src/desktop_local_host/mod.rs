//! Sole owner of the Desktop database, authorization publication and transaction fences.
//!
//! Capability modules implement authorization, business, Provider coordination, synchronization
//! and recovery against this same state. They never own a second writer or choose another lock
//! order. Backup cryptography and plaintext remain inside this private module tree.

pub(crate) mod afternic;
mod afternic_controlled_acceptance;
pub(crate) mod afternic_delist;
pub(crate) mod aliyun_registrar;
pub(crate) mod atom_marketplace;
mod authority;
mod authorization;
mod backup_workflow;
mod business;
pub(crate) mod cloudflare_registrar_account;
mod container;
pub(crate) mod continuity;
pub(crate) mod execution_context;
pub(crate) mod execution_evidence_delivery;
pub(crate) mod forced_takeover;
pub(crate) mod godaddy_registrar;
mod native_backup;
mod normal_handoff;
mod portable_backup;
mod provider;
mod recovery;
mod restore;
#[allow(
    dead_code,
    reason = "backup projection accessors await production native composition"
)]
mod source;
pub(crate) mod spaceship_registrar;
#[cfg(all(test, unix))]
mod standby_tests;
mod sync;
pub(crate) mod target_bootstrap;
pub(crate) mod target_installation;
#[cfg(test)]
mod test_support;
#[cfg(all(test, unix))]
mod tests;

#[cfg(all(test, unix))]
use native_backup::DevelopmentNativeBackup;
use native_backup::{AdmittedBackupHandle, NativeBackupComposition};

use std::fmt;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::BusinessDatabase;
use crate::desktop_business_runtime::DesktopBusinessRuntime;
use crate::desktop_business_runtime::{
    BusinessMutationContext, DesktopAssetLibraryReadRequest, DesktopConflictCenterView,
    DesktopConflictResolveRequest, DesktopDomainAssetCreateRequest,
    DesktopDomainAssetDeleteRequest, DesktopDomainAssetEditRequest,
    DesktopDomainAssetProviderBindingReceipt, DesktopDomainAssetProviderBindingRequest,
    DesktopDomainDetailReadRequest,
};
use crate::desktop_custody::DesktopProductionCustody;
#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
use crate::desktop_custody::{
    TestRebootstrapCrashBoundary, TestRebootstrapKeyStore, TestRebootstrapQuarantineCustody,
    TestRebootstrapRecoveryCustody, TestRebootstrapStoreHostileCase,
    rebootstrap_inspection_snapshot_for_test, reset_rebootstrap_inspection_for_test,
};
use crate::desktop_local_host::authority::{
    TrustedWorkspaceBinding, VerifiedWorkspaceAuthority, WorkspaceAuthorityReplacementFloor,
    WorkspaceAuthorityVerifier,
};
use crate::desktop_local_host::container::{
    BackupContainerError, BackupContainerHost, ExportRequest,
};
use crate::desktop_local_host::continuity::{
    BarrierReason, ContinuityManager, VerifiedLocalContinuation,
};
#[cfg(test)]
use crate::desktop_local_host::continuity::{
    ContinuityBinding, ContinuityReceiptV1, ReceiptState, StartupContinuity,
};
use crate::desktop_local_host::source::IsolatedBackupCandidate;
use crate::desktop_sync_runtime::{
    DesktopSyncCommitGuard, DesktopSyncError, DesktopSyncRejectBatch, DesktopSyncRejectDisposition,
    DesktopSyncRunAdmission, DesktopSyncRuntime,
};
#[cfg_attr(not(unix), cfg(any()))]
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
    /// The workspace already holds the domain being added; nothing was written.
    AssetExists,
    /// The domain was deleted and keeps its tombstone, so it cannot be added or changed again
    /// because the re-add preconditions are not met; nothing was written.
    AssetDeleted,
    /// The deleted entity has unfinished synchronization work or a contested deletion barrier.
    AssetReAddBlocked,
    /// A re-add is already waiting for Cloud to confirm or reject it.
    AssetReAddPending,
    /// The capability has not passed ADR-0027 qualification; nothing was attempted.
    CapabilityUnqualified,
    /// The activated Cloudflare Zone's name cannot become a domain asset (the create path
    /// rejects it, or the domain was deleted); nothing was written or prepared.
    ZoneUnimportable,
}

impl fmt::Display for DesktopLocalHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ApplicationRootRejected => "DESKTOP_APPLICATION_ROOT_REJECTED",
            Self::StorageRejected => "DESKTOP_LOCAL_HOST_STORAGE_REJECTED",
            Self::AuthorityRejected => "DESKTOP_LOCAL_HOST_AUTHORITY_REJECTED",
            Self::CloudProtocolRejected => "DESKTOP_CLOUD_PROTOCOL_REJECTED",
            Self::Unavailable => "DESKTOP_LOCAL_HOST_UNAVAILABLE",
            Self::AssetExists => "DESKTOP_LOCAL_ASSET_EXISTS",
            Self::AssetDeleted => "DESKTOP_LOCAL_ASSET_DELETED",
            Self::AssetReAddBlocked => "DESKTOP_LOCAL_ASSET_RE_ADD_BLOCKED",
            Self::AssetReAddPending => "DESKTOP_LOCAL_ASSET_RE_ADD_PENDING",
            Self::CapabilityUnqualified => "DESKTOP_CAPABILITY_UNQUALIFIED",
            Self::ZoneUnimportable => "DESKTOP_CLOUDFLARE_ZONE_UNIMPORTABLE",
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
    Standby,
    Continuation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopLocalBusinessState {
    ActivationRequired,
    SecurityLocked,
    RetryableLocked,
    CommercialReadOnly,
    StandbyReadOnly,
    StandbyAwaitingReplica,
    TargetInstallationPending,
    Active,
}

/// Durable boundaries at which the private rebootstrap fixture may model process death.
///
/// This is deliberately test-only: production cannot select a protocol phase or enable the
/// rebootstrap capability. Returning at one of these boundaries drops every in-memory linear
/// capability, exactly as a process crash would.
#[cfg_attr(not(unix), cfg(any()))]
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

#[cfg_attr(not(unix), cfg(any()))]
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

/// Advances the connection generation when created and again when dropped, so a create or
/// restore that returns early or fails part-way still leaves it advanced past both edges.
struct ConnectionGenerationAdvance<'a>(&'a AtomicU64);

impl<'a> ConnectionGenerationAdvance<'a> {
    fn new(generation: &'a AtomicU64) -> Self {
        generation.fetch_add(1, Ordering::AcqRel);
        Self(generation)
    }
}

impl Drop for ConnectionGenerationAdvance<'_> {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::AcqRel);
    }
}

/// An opaque authority identity, compared only for equality. Its fields stay private and its
/// `Debug` output names none of them.
#[derive(Clone, PartialEq, Eq)]
pub struct DesktopAuthorityIdentity {
    account_id: String,
    workspace_id: String,
    device_id: String,
    lease_epoch: u64,
    account_security_epoch: u64,
}

impl std::fmt::Debug for DesktopAuthorityIdentity {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopAuthorityIdentity(..)")
    }
}

/// The device and lease that currently hold execution authority, for display only.
///
/// It carries no signed envelope, key or capability: only the identifiers Cloud already bound
/// into the verified Active authority. The Host reports it only while that authority is current,
/// so a Standby, locked or continuation workspace never shows a lease it does not hold.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDeviceLease {
    schema_version: u8,
    device_id: String,
    lease_epoch: u64,
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

/// Serializes authority transitions with operations; the generation fences all capabilities.
/// The selected handles and artifact fields belong only to the backup workflow.
#[derive(Default)]
struct HostOperationState {
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

/// Artifact custody is a consumer of workspace authority, never its source. Both remain under
/// the same publication mutex so a transition fences an artifact publication atomically.
struct BackupArtifactState {
    native: NativeBackupComposition,
    container: Option<BackupContainerHost>,
}

struct WorkspaceAuthorityState {
    authority: Option<PrivateWorkspaceAuthority>,
    backup: BackupArtifactState,
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

impl Default for WorkspaceAuthorityState {
    fn default() -> Self {
        Self {
            authority: None,
            backup: BackupArtifactState {
                native: NativeBackupComposition::Unavailable,
                container: None,
            },
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
    Standby,
    CommercialReadOnly,
    RetryableLocked,
    SecurityLocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(
    dead_code,
    reason = "authority activation is added only with the qualified signed-wire verifier"
)]
enum WorkspaceAuthorityKind {
    Active,
    Standby,
    VerifiedLocalContinuation,
    Unavailable,
}

impl WorkspaceAuthorityKind {
    const fn wire(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Standby => "standby",
            Self::VerifiedLocalContinuation => "verified_local_continuation",
            Self::Unavailable => "unavailable",
        }
    }

    const fn can_export_or_inspect(self) -> bool {
        matches!(self, Self::Active | Self::VerifiedLocalContinuation)
    }
}

struct PrivateWorkspaceAuthority {
    kind: WorkspaceAuthorityKind,
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
    capabilities: Vec<String>,
    generation: u64,
    trusted_time_floor: i64,
    execute_before: i64,
    digest: [u8; 32],
}

impl fmt::Debug for PrivateWorkspaceAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PrivateWorkspaceAuthority([REDACTED])")
    }
}

impl PrivateWorkspaceAuthority {
    fn from_standby(
        authority: &authority::VerifiedStandbyAuthority,
        generation: u64,
        now: i64,
    ) -> Self {
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/HOST-STANDBY-AUTHORITY-V1\0");
        for value in [
            &authority.account_id,
            &authority.workspace_id,
            &authority.device_id,
        ] {
            digest.update(value.len().to_be_bytes());
            digest.update(value.as_bytes());
        }
        digest.update(authority.account_security_epoch.to_be_bytes());
        digest.update(authority.lease_epoch_floor.to_be_bytes());
        digest.update(authority.issued_at.to_be_bytes());
        digest.update(authority.expires_at.to_be_bytes());
        Self {
            kind: WorkspaceAuthorityKind::Standby,
            account_id: authority.account_id.clone(),
            workspace_id: authority.workspace_id.clone(),
            device_id: authority.device_id.clone(),
            lease_epoch: authority.lease_epoch_floor,
            account_security_epoch: authority.account_security_epoch,
            entitlement_revision: 0,
            entitlement_projection_digest: String::new(),
            commercial_expires_at: String::new(),
            capabilities: Vec::new(),
            generation,
            trusted_time_floor: now,
            execute_before: authority.expires_at,
            digest: digest.finalize().into(),
        }
    }
    fn from_verified(authority: &VerifiedWorkspaceAuthority, generation: u64) -> Self {
        let snapshot_digest = authority.snapshot_digest_hex();
        let mut digest = [0_u8; 32];
        for (index, chunk) in snapshot_digest
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
        {
            digest[index] = (hex_nibble(chunk[0]) << 4) | hex_nibble(chunk[1]);
        }
        Self {
            kind: WorkspaceAuthorityKind::Active,
            account_id: authority.account_id().to_owned(),
            workspace_id: authority.workspace_id().to_owned(),
            device_id: authority.device_id().to_owned(),
            lease_epoch: authority.lease_epoch(),
            account_security_epoch: authority.account_security_epoch(),
            entitlement_revision: authority.entitlement_revision(),
            entitlement_projection_digest: authority.entitlement_projection_digest().to_owned(),
            commercial_expires_at: authority.commercial_expires_at().to_owned(),
            capabilities: authority.capabilities().to_owned(),
            generation,
            trusted_time_floor: authority.trusted_time_floor(),
            execute_before: authority.execute_before(),
            digest,
        }
    }

    fn can_replace_with(&self, replacement: &VerifiedWorkspaceAuthority) -> bool {
        replacement.can_replace_floor(&WorkspaceAuthorityReplacementFloor {
            workspace_id: &self.workspace_id,
            account_id: &self.account_id,
            device_id: &self.device_id,
            account_security_epoch: self.account_security_epoch,
            lease_epoch: self.lease_epoch,
            entitlement_revision: self.entitlement_revision,
            entitlement_projection_digest: &self.entitlement_projection_digest,
            commercial_expires_at: &self.commercial_expires_at,
            capabilities: &self.capabilities,
        })
    }

    fn is_current_at(&self, now: i64) -> bool {
        self.generation != 0 && now >= self.trusted_time_floor && now < self.execute_before
    }

    #[cfg(test)]
    fn binding(&self) -> crate::desktop_local_host::container::BindingDigests {
        let account = digest_component(b"account", self.account_id.as_bytes());
        let device = digest_component(b"device", self.device_id.as_bytes());
        let workspace = digest_component(b"workspace", self.workspace_id.as_bytes());
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/GDBK-BINDING-V1\0");
        digest.update(account);
        digest.update(device);
        digest.update(workspace);
        crate::desktop_local_host::container::BindingDigests::new(
            account,
            device,
            workspace,
            digest.finalize().into(),
        )
    }
}

/// Synchronous owner of workspace authority, the database writer and private capability state.
///
/// The production constructor deliberately starts closed. Native file handles, independent
/// rollback-anchor persistence and artifact composition gate backup operations independently
/// from the signed workspace authority used by business and Provider capabilities.
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
    authority_verifier: Option<WorkspaceAuthorityVerifier>,
    execution_context_native:
        Option<std::sync::Arc<dyn execution_context::DesktopExecutionContextNativePort>>,
    execution_context_state: Mutex<execution_context::ExecutionContextState>,
    installation_context_gate: std::sync::atomic::AtomicBool,
    target_installation_stage: Mutex<Option<target_installation::PreparedInstallationPublication>>,
    forced_takeover_runtime: Mutex<forced_takeover::Runtime>,
    /// Published before any authority transition waits for the operation lock.
    transition_requested_epoch: AtomicU64,
    /// Advances on both sides of every Cloudflare connection create and backup restore, the only
    /// production writers that can replace the connection rows; see
    /// [`Self::provider_connection_generation`].
    provider_connection_generation: AtomicU64,
    /// Lock order begins here for every backup selection or operation.
    operation_selection: Mutex<HostOperationState>,
    portable_backup_selection: Mutex<portable_backup::Selection>,
    /// Authority and publication are fenced while the operation lock is held.
    authority_publication: Mutex<WorkspaceAuthorityState>,
    /// The aggregate, not Desktop composition, owns the database and sync coordinator together.
    runtime_state: Mutex<Option<DesktopRuntimeState>>,
    /// Private crash-recovery state machine. It never owns a database, path, key, or writer.
    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    rebootstrap_runtime: Option<RebootstrapRuntime>,
    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    rebootstrap_quarantine_custody: Option<TestRebootstrapQuarantineCustody>,
    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    rebootstrap_test_executor_enabled: bool,
    #[cfg(test)]
    development_installation_binding: Option<[u8; 32]>,
    #[cfg(test)]
    business_commit_transition_epoch: AtomicU64,
    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    restore_precommit_transition_epoch: AtomicU64,
    #[cfg_attr(not(unix), cfg(any()))]
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

impl DesktopLocalHost {
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
            execution_context_native: None,
            execution_context_state: Mutex::new(execution_context::ExecutionContextState::default()),
            installation_context_gate: std::sync::atomic::AtomicBool::new(false),
            target_installation_stage: Mutex::new(None),
            forced_takeover_runtime: Mutex::default(),
            transition_requested_epoch: AtomicU64::new(0),
            provider_connection_generation: AtomicU64::new(0),
            operation_selection: Mutex::new(HostOperationState::default()),
            portable_backup_selection: Mutex::default(),
            authority_publication: Mutex::new(WorkspaceAuthorityState::default()),
            runtime_state: Mutex::new(None),
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            rebootstrap_runtime: None,
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            rebootstrap_quarantine_custody: None,
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            rebootstrap_test_executor_enabled: false,
            #[cfg(test)]
            development_installation_binding: None,
            #[cfg(test)]
            business_commit_transition_epoch: AtomicU64::new(0),
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            restore_precommit_transition_epoch: AtomicU64::new(0),
            #[cfg_attr(not(unix), cfg(any()))]
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
        host.authority_verifier = WorkspaceAuthorityVerifier::production().ok();
        host.application_root = Some(root);
        host.production_custody = Some(Mutex::new(custody));
        Ok(host)
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

fn clear_operation_state(operation: &mut HostOperationState) {
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

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
fn rebootstrap_binding_digest(authority: &PrivateWorkspaceAuthority) -> String {
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

#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
fn rebootstrap_floor_digest(authority: &PrivateWorkspaceAuthority) -> String {
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
        // A provisional re-add (ADR-0029 decision 4) is current work the restore would overwrite,
        // the same class of refusal as an open conflict: restore after it syncs.
        BusinessDatabaseError::MutationConflict | BusinessDatabaseError::AssetReAddPending => {
            DesktopBackupError::ConflictRejected
        }
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
        // A duplicate and a deletion are the rejections the person can understand (the domain is
        // held, or it was deleted and keeps its tombstone), so each keeps its own code.
        BusinessDatabaseError::AssetExists => DesktopLocalHostError::AssetExists,
        BusinessDatabaseError::AssetDeleted => DesktopLocalHostError::AssetDeleted,
        BusinessDatabaseError::AssetReAddBlocked => DesktopLocalHostError::AssetReAddBlocked,
        BusinessDatabaseError::AssetReAddPending => DesktopLocalHostError::AssetReAddPending,
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
        DesktopSyncError::CapabilityUnqualified => DesktopLocalHostError::CapabilityUnqualified,
        DesktopSyncError::ZoneUnimportable => DesktopLocalHostError::ZoneUnimportable,
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

pub(crate) mod afternic_listing_plan;
pub(crate) mod afternic_listing_write;
