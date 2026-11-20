//! Closed Desktop Local Host boundary.
//!
//! The public surface contains only the aggregate plus request/response values that are safe at
//! the native adapter boundary. Database handles, keys, paths, raw storage projections, sync run
//! admissions, and rebootstrap mechanics are intentionally not nameable by dependent crates.
//!
//! ```compile_fail
//! use gooddealer_local_storage::BusinessDatabase;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::LocalDatabaseKey;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::clone_encrypted_database;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::DesktopSyncRunAdmission;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::RebootstrapReplayPage;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::{DomainAssetProjectionRow, PortfolioReadSnapshot};
//! ```
//!
//! Test-only native compositions cannot be selected or injected by a dependent crate.
//!
//! ```compile_fail
//! use gooddealer_local_storage::RebootstrapCapability;
//! let _ = RebootstrapCapability::TestCreateOnly;
//! ```
//! ```compile_fail
//! let _ = gooddealer_local_storage::desktop_custody::RebootstrapCapability::TestCreateOnly;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::DesktopLocalHost;
//! let _ = DesktopLocalHost::development;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::DevelopmentNativeBackup;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::TestRebootstrapKeyStore;
//! let _ = TestRebootstrapKeyStore::default();
//! ```
//! ```compile_fail
//! let _ = gooddealer_local_storage::desktop_custody::DesktopProductionCustody::load_or_create_for_rebootstrap_test;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::DesktopLocalHost;
//! let _ = DesktopLocalHost::development_with_rebootstrap_custody;
//! ```
//!
//! A/B slot handles and custody evidence remain owned by the closed local-host boundary.
//!
//! ```compile_fail
//! use gooddealer_local_storage::RebootstrapSlot;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::PreparedEvidence;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::CandidateReservedEvidence;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::VerifiedCustodyEvidence;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::CandidateFinalEvidence;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::VerifiedCandidate;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::PublishedRebootstrap;
//! ```
//!
//! Dependents cannot manufacture evidence through the private test constructors.
//!
//! ```compile_fail
//! let _ = gooddealer_local_storage::PreparedEvidence::for_test_for;
//! ```
//! ```compile_fail
//! let _ = gooddealer_local_storage::CandidateReservedEvidence::for_test_for;
//! ```
//! ```compile_fail
//! let _ = gooddealer_local_storage::VerifiedCustodyEvidence::for_test_for;
//! ```
//!
//! Reservation capabilities, gates, and runtime injection points are likewise private.
//!
//! ```compile_fail
//! use gooddealer_local_storage::CandidateReservation;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::RebootstrapReservation;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::DesktopProductionCustody;
//! let _ = DesktopProductionCustody::require_rebootstrap_reservation_capability;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::DesktopProductionCustody;
//! let _ = DesktopProductionCustody::reserve_rebootstrap;
//! ```
//! ```compile_fail
//! use gooddealer_local_storage::RebootstrapRuntime;
//! ```

#[cfg(windows)]
mod windows_custody;
#[cfg(all(test, not(windows)))]
#[path = "windows_custody/format.rs"]
mod windows_custody_format_tests;
#[cfg(all(test, not(windows)))]
#[path = "desktop_custody_windows/database_format.rs"]
mod windows_database_format_tests;
#[cfg(windows)]
mod windows_private_files;
#[cfg(all(test, not(windows)))]
#[path = "windows_private_files/protected_acl.rs"]
mod windows_protected_acl_tests;
#[cfg(all(test, not(windows)))]
#[path = "windows_private_files/sidecar_acl.rs"]
mod windows_sidecar_acl_tests;

mod active_workspace;
mod application_root;
mod desktop_business_runtime;
// Each OS keeps its native file/key admission private; both open the same business owner.
#[cfg(unix)]
mod desktop_custody;
#[cfg(windows)]
#[path = "desktop_custody_windows.rs"]
mod desktop_custody;
mod desktop_device_switch;
mod desktop_native_cloud;
// Production custody only: under `cfg(test)` custody uses in-memory stores instead.
mod desktop_sync_runtime;
#[cfg(all(target_os = "linux", not(test)))]
mod secret_service_custody;

mod migrations;
#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
mod rebootstrap_runtime;

mod portfolio_projection;
mod sqlcipher_key_sql;
mod sqlcipher_process_policy;

pub use active_workspace::batch_operations::{
    BatchOperationRow, BatchOperationsReadSnapshot, BatchOperationsWindow, BatchPlannedCounts,
    BatchResultCounts,
};
pub use active_workspace::business::CloudflareDnsRecordWrite;
pub use active_workspace::business::DomainAssetMutationReceipt;
pub(crate) use active_workspace::business::{
    BusinessDatabase, BusinessDatabaseError, ClaimedCloudflareDnsProjection, ClaimedSyncMutation,
    CloudflareCredentialEnvelopeKind, CloudflareCredentialOperationKind,
    CloudflareCredentialPreparation, CloudflareCredentialPreparationDisposition,
    CloudflareCredentialRecoveryObservation, CloudflareCredentialResolution,
    CloudflareCredentialStagedObservation, CloudflareCredentialWitness,
    CloudflareDnsObservationWrite, CloudflareDnsProjectionAcknowledgement,
    CloudflarePrewriteFailureReason, DatabaseRecoveryProof, DomainAssetWrite, DurableSyncSnapshot,
    LocalDatabaseKey, NativeCheckpointDescriptor, PendingCloudflareDnsProjection,
    SYNC_MUTATION_WIRE_SCHEMA_VERSION, SyncConflictCandidate, SyncMutationAcknowledgement,
    SyncPullRequestV2, SyncResolutionReceipt, serialize_sync_push_request,
};
pub use active_workspace::business::{
    DesktopAfternicConnectionSummary, DesktopAfternicConnectionsRead,
    DesktopAfternicInventoryReceipt, DesktopAfternicListingObservation, DesktopAfternicScanSummary,
    DesktopAliyunConnectionState, DesktopAliyunConnectionSummary, DesktopAtomConnectionState,
    DesktopAtomConnectionSummary, DesktopAtomInventoryReceipt, DesktopAtomListingFact,
    DesktopAtomListingState, DesktopCloudflareRegistrarAccountState,
    DesktopCloudflareRegistrarAccountSummary, DesktopCloudflareRegistrarScanReceipt,
    DesktopCloudflareRegistrationFact, DesktopCloudflareRegistrationStanding,
    DesktopGoDaddyConnectionState, DesktopGoDaddyConnectionSummary, DesktopRegistrarScanReceipt,
    DesktopRegistrationFact, DesktopRegistrationStanding, DesktopSellerHubConnectionSummary,
    DesktopSellerHubListingFact, DesktopSellerHubListingState, DesktopSellerHubScanReceipt,
    DesktopSpaceshipConnectionState, DesktopSpaceshipConnectionSummary,
};
#[cfg(all(test, unix))]
pub(crate) use active_workspace::business::{
    RebootstrapJournalLink, RebootstrapReplayPage, RebootstrapSlotId, RebootstrapTombstone,
    validate_rebootstrap_asset, validate_rebootstrap_timestamp,
    verify_rebootstrap_checkpoint_digest, verify_rebootstrap_page_digest,
    verify_rebootstrap_plan_digest,
};
pub use active_workspace::dns_health::{
    DnsHealthReadSnapshot, DnsHealthRow, DnsHealthWindow, DnsRecordCounts, DnsZoneBinding,
    DnsZoneObservationSummary,
};
pub use active_workspace::history::{
    HistoryFieldChange, HistoryReadSnapshot, HistoryRow, HistoryWindow,
};
pub use active_workspace::manual_tasks::{
    ManualTaskRow, ManualTasksReadSnapshot, ManualTasksWindow,
};
pub use active_workspace::renewals::{RenewalRow, RenewalsReadSnapshot, RenewalsWindow};
pub use active_workspace::sales::{SalesListingRow, SalesMoney, SalesReadSnapshot, SalesWindow};
pub use active_workspace::settings::{
    SettingsConnection, SettingsConnectionRole, SettingsReadSnapshot,
};
pub use active_workspace::storage_repair::StorageRepairKind;
pub use desktop_local_host::afternic::DesktopAfternicConnection;
pub use desktop_local_host::aliyun_registrar::{
    DesktopAliyunConnection, DesktopAliyunRegistrarStatus,
};
pub use desktop_local_host::atom_marketplace::{
    DesktopAtomConnection, DesktopAtomMarketplaceStatus,
};
pub use desktop_local_host::cloudflare_registrar_account::{
    DesktopCloudflareRegistrarAccount, DesktopCloudflareRegistrarAccountStatus,
};
pub use desktop_local_host::godaddy_registrar::{
    DesktopGoDaddyConnection, DesktopGoDaddyRegistrarStatus,
};
pub use desktop_local_host::spaceship_registrar::{
    DesktopSpaceshipConnection, DesktopSpaceshipRegistrarStatus,
};
pub use desktop_local_host::spaceship_sellerhub::{
    DesktopSellerHubConnection, DesktopSellerHubStatus,
};
#[cfg(all(test, unix))]
pub(crate) use portfolio_projection::DomainAssetProjectionRow;
pub use portfolio_projection::{
    AssetLibraryReadSnapshot, AssetLibraryRow, AssetLibraryWindow, DomainDetailAsset,
    DomainDetailReadSnapshot, Money, PortfolioReadFreshness,
};

pub use application_root::{DesktopApplicationRoot, DesktopApplicationRootError};

mod desktop_local_host;

pub use desktop_business_runtime::{
    DesktopAssetLibraryReadRequest, DesktopBatchOperationsReadRequest,
    DesktopCloudflareConnectionCreateRequest, DesktopCloudflareConnectionCreated,
    DesktopCloudflareConnectionRead, DesktopCloudflareObservationRead,
    DesktopCloudflareObservationReadRequest, DesktopCloudflareObservationRecord, DesktopConflict,
    DesktopConflictCenterView, DesktopConflictFreshness, DesktopConflictResolutionReceipt,
    DesktopConflictResolveRequest, DesktopDnsHealthReadRequest, DesktopDomainAssetCreateRequest,
    DesktopDomainAssetDeleteRequest, DesktopDomainAssetEditRequest,
    DesktopDomainAssetProviderBindingReceipt, DesktopDomainAssetProviderBindingRequest,
    DesktopDomainAssetWrite, DesktopDomainDetailReadRequest, DesktopHistoryReadRequest,
    DesktopManualTasksReadRequest, DesktopRenewalsReadRequest, DesktopSalesReadRequest,
    DesktopStorageRepairReceipt, DesktopStorageRepairRequest, DesktopSyncSnapshotView,
    DesktopSyncTransportState,
};
pub use desktop_device_switch::{
    DesktopDeviceSwitchOutcome, DesktopDeviceSwitchRejection, DesktopDeviceSwitchRequestExchange,
    DesktopDeviceSwitchRequestResolution, DesktopDeviceSwitchRequestResolutionOutcome,
    DesktopDeviceSwitchStart, DesktopDeviceSwitchStatus, DesktopDrainProgress,
    DesktopDrainProofDraft, DesktopDrainReceiptQuery,
};
pub use desktop_local_host::{
    DesktopAuthorityIdentity, DesktopDeviceLease, DesktopLocalBusinessState,
    DesktopLocalBusinessStatus,
};
pub use desktop_local_host::{
    DesktopBackupError, DesktopBackupExportStatus, DesktopBackupRestoreStatus,
    DesktopHostAuthorizationStatus, DesktopLocalHost, DesktopLocalHostError,
    DesktopVerifiedBackupArtifact,
};
pub(crate) use desktop_native_cloud::DesktopCloudflareKeychainPlanData;
pub use desktop_native_cloud::{
    DesktopCheckpointExchange, DesktopCloudflareActivationAdmission,
    DesktopCloudflareCheckedObservation, DesktopCloudflareCustodyComparison,
    DesktopCloudflareEnvelopeKind, DesktopCloudflareKeychainPlan,
    DesktopCloudflareMaintenanceAction, DesktopCloudflarePrewriteFailure,
    DesktopCloudflareProjectionClaim, DesktopCloudflareProjectionDisposition,
    DesktopCloudflareProjectionWork, DesktopCloudflarePurgeOutcome,
    DesktopCloudflareRecoveryHandle, DesktopCloudflareRecoveryPlan, DesktopCloudflareRecoveryScan,
    DesktopCloudflareResolution, DesktopCloudflareRetirement, DesktopCloudflareRetirementCandidate,
    DesktopCloudflareRetirementPlan, DesktopSyncCheckpointDisposition, DesktopSyncPullDisposition,
    DesktopSyncPullExchange, DesktopSyncPushClaim, DesktopSyncPushDisposition, DesktopSyncPushWork,
    InspectingCloudflareProvision, InspectingCloudflareRevocation, MarkedCloudflareProvision,
    MarkedCloudflareRevocation, PreparedCloudflareObservation, PreparedCloudflareProvision,
    PreparedCloudflareRegistrarInventory, PreparedCloudflareRevocation,
};
pub use desktop_sync_runtime::DesktopNativeCloudAdmission;

#[cfg(test)]
mod sqlcipher_fixture;
#[cfg(test)]
mod test_tempdir;

pub use active_workspace::business::{
    DesktopAfternicDelistApproveRequest, DesktopAfternicDelistPlan,
    DesktopAfternicDelistPreviewItem, DesktopAfternicDelistPreviewRequest,
    DesktopAfternicDelistStatus, DesktopAfternicDelistStatusRequest, DesktopAfternicDelistSummary,
    DesktopAfternicDelistWorkKind,
};
pub use desktop_local_host::afternic_delist::{
    DesktopAfternicDelistClaim, DesktopAfternicDelistWork,
};

pub use desktop_local_host::execution_context::{
    DesktopContinuousClockKind, DesktopContinuousClockReading, DesktopExecutionContextError,
    DesktopExecutionContextNativePort, DesktopExecutionContextRequest,
    DesktopExecutionSigningIdentity, DesktopStagedExecutionContext,
};

pub use active_workspace::business::{
    DesktopExecutionEvidenceDeliveryOutcome, DesktopExecutionEvidenceStream,
};
pub use desktop_local_host::execution_evidence_delivery::DesktopExecutionEvidenceUpload;

pub use desktop_local_host::target_installation::{
    DesktopTargetInstallationExchange, DesktopTargetInstallationExchangeKind,
    DesktopTargetInstallationNewWorkflow, DesktopTargetInstallationPhase,
    DesktopTargetInstallationStage, DesktopTargetInstallationView, DesktopTargetInstallationWork,
};

pub use desktop_local_host::target_bootstrap::{
    DesktopTargetBootstrapCancelExchange, DesktopTargetBootstrapStatusExchange,
    DesktopTargetBootstrapStatusOutcome, DesktopTargetBootstrapTerminalStatus,
    DesktopTargetBootstrapView,
};

pub use desktop_local_host::forced_takeover::{
    DesktopForcedTakeoverExchange, DesktopForcedTakeoverExchangeKind, DesktopForcedTakeoverPreview,
    DesktopForcedTakeoverPreviewReason, DesktopForcedTakeoverStoppedReason,
    DesktopForcedTakeoverView, DesktopForcedTakeoverWork,
};

pub use active_workspace::business::{
    DesktopAfternicListingWriteAction, DesktopAfternicListingWriteApproveRequest,
    DesktopAfternicListingWriteCreateItem, DesktopAfternicListingWriteItem,
    DesktopAfternicListingWriteObserved, DesktopAfternicListingWritePatch,
    DesktopAfternicListingWritePlan, DesktopAfternicListingWritePreviewRequest,
    DesktopAfternicListingWriteStatus, DesktopAfternicListingWriteStatusRequest,
    DesktopAfternicListingWriteSummary, DesktopAfternicListingWriteUpdateItem,
    DesktopAfternicListingWriteValues, DesktopAfternicListingWriteWorkKind,
};
pub use desktop_local_host::afternic_listing_write::{
    DesktopAfternicListingWriteClaim, DesktopAfternicListingWriteWork,
};

pub use active_workspace::business::DesktopAfternicControlledAcceptance;

pub use active_workspace::business::{
    DesktopAfternicListingPlan, DesktopAfternicListingPlanAction,
    DesktopAfternicListingPlanApproveRequest, DesktopAfternicListingPlanPreviewRequest,
    DesktopAfternicListingPlanStatus, DesktopAfternicListingPlanStatusRequest,
};
pub use desktop_local_host::afternic_listing_plan::{
    DesktopAfternicListingPlanClaim, DesktopAfternicListingPlanWork,
};
