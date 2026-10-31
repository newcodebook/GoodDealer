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

mod active_workspace;
mod application_root;
mod desktop_business_runtime;
// The custody implementation relies on descriptor-relative POSIX primitives (`openat`,
// `renameat`, and `O_NOFOLLOW`) that do not exist on Windows. Keep that security boundary
// explicitly fail-closed there instead of compiling a weaker path-based approximation.
#[cfg(unix)]
mod desktop_custody;
#[cfg(windows)]
#[path = "desktop_custody_windows.rs"]
mod desktop_custody;
mod desktop_native_cloud;
// Production custody only: under `cfg(test)` custody uses in-memory stores instead.
#[cfg(all(target_os = "linux", not(test)))]
mod secret_service_custody;
mod desktop_sync_runtime;

mod migrations;
#[cfg_attr(not(unix), cfg(any()))]
#[cfg(test)]
mod rebootstrap_runtime;

mod portfolio_projection;
mod sqlcipher_key_sql;
mod sqlcipher_process_policy;

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
    SyncConflictCandidate, SyncMutationAcknowledgement, SyncPullRequestV2, SyncResolutionReceipt,
    serialize_sync_push_request,
};
#[cfg(test)]
pub(crate) use active_workspace::business::{
    RebootstrapJournalLink, RebootstrapReplayPage, RebootstrapSlotId, validate_rebootstrap_asset,
    validate_rebootstrap_timestamp, verify_rebootstrap_checkpoint_digest,
    verify_rebootstrap_page_digest, verify_rebootstrap_plan_digest,
};
#[cfg(test)]
pub(crate) use portfolio_projection::DomainAssetProjectionRow;
pub use portfolio_projection::{
    AssetLibraryReadSnapshot, AssetLibraryRow, AssetLibraryWindow, DomainDetailAsset,
    DomainDetailReadSnapshot, Money, PortfolioReadFreshness,
};

pub use application_root::{DesktopApplicationRoot, DesktopApplicationRootError};

mod backup;

pub use backup::{
    DesktopBackupError, DesktopBackupExportStatus, DesktopBackupRestoreStatus,
    DesktopHostAuthorizationStatus, DesktopLocalHost, DesktopLocalHostError,
    DesktopVerifiedBackupArtifact,
};
pub use backup::{DesktopLocalBusinessState, DesktopLocalBusinessStatus};
pub use desktop_business_runtime::{
    DesktopAssetLibraryReadRequest, DesktopCloudflareConnectionRead,
    DesktopCloudflareObservationRead, DesktopCloudflareObservationReadRequest,
    DesktopCloudflareObservationRecord, DesktopConflict, DesktopConflictCenterView,
    DesktopConflictFreshness, DesktopConflictResolutionReceipt, DesktopConflictResolveRequest,
    DesktopDomainAssetDeleteRequest, DesktopDomainAssetEditRequest,
    DesktopDomainAssetProviderBindingReceipt, DesktopDomainAssetProviderBindingRequest,
    DesktopDomainAssetWrite, DesktopDomainDetailReadRequest, DesktopSyncSnapshotView,
    DesktopSyncTransportState,
};
pub(crate) use desktop_native_cloud::DesktopCloudflareKeychainPlanData;
pub use desktop_native_cloud::{
    DesktopCheckpointExchange, DesktopCloudflareActivationAdmission,
    DesktopCloudflareCheckedObservation, DesktopCloudflareCustodyComparison,
    DesktopCloudflareEnvelopeKind, DesktopCloudflareKeychainPlan, DesktopCloudflarePrewriteFailure,
    DesktopCloudflareProjectionClaim, DesktopCloudflareProjectionDisposition,
    DesktopCloudflareProjectionWork, DesktopCloudflareRecoveryHandle,
    DesktopCloudflareRecoveryPlan, DesktopCloudflareRecoveryScan, DesktopCloudflareResolution,
    DesktopSyncCheckpointDisposition, DesktopSyncPullDisposition, DesktopSyncPullExchange,
    DesktopSyncPushClaim, DesktopSyncPushDisposition, DesktopSyncPushWork,
    InspectingCloudflareProvision, MarkedCloudflareProvision, PreparedCloudflareObservation,
    PreparedCloudflareProvision,
};
pub use desktop_sync_runtime::DesktopNativeCloudAdmission;

#[cfg(test)]
mod sqlcipher_fixture;
