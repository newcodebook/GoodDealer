//! Host-owned Desktop synchronization and Provider database-stage runtime.
//!
//! This module deliberately keeps the authority snapshot and delivery owner opaque.  The
//! caller receives an admission handle, not the workspace/device identity, clock, lease, or
//! generation used to perform the operation.  `DesktopLocalHost` can embed this runtime and
//! expose the methods as its native boundary without widening the IPC contract.

use std::collections::VecDeque;
use std::fmt::{self, Write as _};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::active_workspace::business::{
    CloudMutationReceipt, CloudflareRetirementSeed, DrainMutationProgress, DrainProofSchemaVersion,
    HandoffDrainProofClaims, SyncProjectionEffect, SyncRejectionKind,
};
use crate::active_workspace::business::{
    CloudflareRegistrarInventoryCommit, CloudflareRegistrarScanHead, CloudflareRegistrarScanScope,
};
use crate::active_workspace::capability_qualification::{
    CLOUDFLARE_DNS_OBSERVE, CLOUDFLARE_REGISTRAR_OBSERVE,
};
use crate::{
    BusinessDatabase, BusinessDatabaseError, ClaimedCloudflareDnsProjection, ClaimedSyncMutation,
    CloudflareCredentialEnvelopeKind, CloudflareCredentialOperationKind,
    CloudflareCredentialPreparation, CloudflareCredentialPreparationDisposition,
    CloudflareCredentialRecoveryObservation, CloudflareCredentialResolution,
    CloudflareCredentialStagedObservation, CloudflareCredentialWitness,
    CloudflareDnsObservationWrite, CloudflareDnsProjectionAcknowledgement,
    NativeCheckpointDescriptor, PendingCloudflareDnsProjection, SyncMutationAcknowledgement,
    SyncPullRequestV2,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SYNC_LEASE_SECONDS: i64 = 60;
const PROJECTION_LEASE_SECONDS: i64 = 60;

/// Closed failures suitable for mapping at the native command boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopSyncError {
    Blocked,
    StaleAuthority,
    StorageRejected,
    InvalidInput,
    AcknowledgementMismatch,
    /// The capability has not passed ADR-0027 qualification, so the Host refuses to run it.
    CapabilityUnqualified,
    /// The activated Zone's name cannot become a domain asset: the create path rejects it, or
    /// the domain was deleted and keeps its tombstone. Nothing was written.
    ZoneUnimportable,
}

impl fmt::Display for DesktopSyncError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Blocked => "SYNC_BLOCKED",
            Self::StaleAuthority => "SYNC_STALE_AUTHORITY",
            Self::StorageRejected => "SYNC_STORAGE_REJECTED",
            Self::InvalidInput => "SYNC_INPUT_REJECTED",
            Self::AcknowledgementMismatch => "SYNC_ACKNOWLEDGEMENT_MISMATCH",
            Self::CapabilityUnqualified => "SYNC_CAPABILITY_UNQUALIFIED",
            Self::ZoneUnimportable => "SYNC_ZONE_UNIMPORTABLE",
        })
    }
}

impl std::error::Error for DesktopSyncError {}

/// Terminal disposition selected by the trusted sync coordinator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopSyncRejectDisposition {
    Rejected,
    Conflicted,
    MutationConflicted,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DesktopSyncRejectBatch<'a> {
    pub(crate) delivery_owner: &'a str,
    pub(crate) mutations: &'a [ClaimedSyncMutation],
    pub(crate) disposition: DesktopSyncRejectDisposition,
}

pub(crate) struct CloudflareProjectionClaimSchedule {
    pub(crate) claimed: Option<ClaimedCloudflareDnsProjection>,
    pub(crate) retry_after: Option<Duration>,
}

pub(crate) struct SyncPushClaimSchedule {
    pub(crate) claimed: Vec<ClaimedSyncMutation>,
    pub(crate) retry_after: Option<Duration>,
}

pub(crate) struct PreparedCloudflareProvisionData {
    pub(crate) preparation: CloudflareCredentialPreparation,
    pub(crate) expected_base: CloudflareCredentialWitness,
    pub(crate) connection_digest: String,
}

pub(crate) struct PreparedCloudflareObservationData {
    pub(crate) connection_id: String,
    pub(crate) entity_id: String,
    pub(crate) connection_incarnation_id: String,
    pub(crate) connection_digest: String,
    pub(crate) generation: u64,
    pub(crate) scope_digest: String,
    pub(crate) zone_digest: String,
    pub(crate) public_proof: String,
}

#[derive(PartialEq, Eq)]
pub(crate) struct PreparedCloudflareRegistrarData {
    pub(crate) connection_id: String,
    pub(crate) connection_incarnation_id: String,
    pub(crate) connection_digest: String,
    pub(crate) generation: u64,
    pub(crate) scope_digest: String,
    pub(crate) zone_digest: String,
    pub(crate) public_proof: String,
    pub(crate) prior: Option<CloudflareRegistrarScanHead>,
    pub(crate) request_id: Option<String>,
}

impl PreparedCloudflareRegistrarData {
    fn scan_scope<'a>(
        &'a self,
        admission: &'a DesktopSyncRunAdmission,
    ) -> Result<CloudflareRegistrarScanScope<'a>, DesktopSyncError> {
        let credential_generation =
            i64::try_from(self.generation).map_err(|_| DesktopSyncError::StorageRejected)?;
        let lease_epoch =
            i64::try_from(admission.lease_epoch()).map_err(|_| DesktopSyncError::StaleAuthority)?;
        Ok(CloudflareRegistrarScanScope {
            connection_id: &self.connection_id,
            connection_incarnation_id: &self.connection_incarnation_id,
            credential_generation,
            device_id: admission.device_id(),
            lease_epoch,
        })
    }
}

pub(crate) struct PreparedCloudflareRecoveryData {
    pub(crate) connection_incarnation_id: String,
    pub(crate) intent_id: String,
    pub(crate) connection_digest: String,
    pub(crate) expected_base: CloudflareCredentialWitness,
    pub(crate) target: CloudflareCredentialWitness,
}

/// Opaque proof that one Host-owned sync run was admitted.
///
/// The fields are intentionally private and this type does not implement `Serialize`; a
/// Renderer can only return the handle to the Host that created it.
pub(crate) struct DesktopSyncRunAdmission {
    role: NativeCloudRole,
    /// `None` is a verified Standby authority without any admitted database runtime.
    runtime_nonce: Option<[u8; 16]>,
    run_sequence: Option<u64>,
    workspace_id: String,
    device_id: String,
    lease_epoch: u64,
    pub(crate) trusted_time_floor: i64,
    pub(crate) execute_before: i64,
    authority_snapshot_digest: String,
    pub(crate) authority_epoch: u64,
    provider_capabilities: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeCloudRole {
    InitialReplica,
    Active,
    Standby,
}

/// Opaque Native-only admission. Dependent crates may inspect its role and return it to
/// `DesktopLocalHost`, but cannot clone, serialize, deserialize or construct its authority.
pub struct DesktopNativeCloudAdmission {
    pub(crate) inner: DesktopSyncRunAdmission,
}

impl DesktopNativeCloudAdmission {
    /// Whether this admission carries Active execution authority. Read authority never grants
    /// Provider, Outbox or business mutation access.
    #[must_use]
    pub const fn is_active(&self) -> bool {
        matches!(self.inner.role, NativeCloudRole::Active)
    }

    /// A verified Active server credential whose local replica still needs its exact receipt.
    /// It grants no business, sync or Provider authority.
    #[must_use]
    pub fn is_installing_target(&self) -> bool {
        self.inner.role == NativeCloudRole::InitialReplica
    }

    pub(crate) fn workspace_id(&self) -> &str {
        &self.inner.workspace_id
    }
}

impl DesktopSyncRunAdmission {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn standby_authority(
        workspace_id: String,
        device_id: String,
        lease_epoch_floor: u64,
        trusted_time_floor: i64,
        execute_before: i64,
        authority_snapshot_digest: String,
        authority_epoch: u64,
    ) -> Self {
        Self {
            role: NativeCloudRole::Standby,
            runtime_nonce: None,
            run_sequence: None,
            workspace_id,
            device_id,
            lease_epoch: lease_epoch_floor,
            trusted_time_floor,
            execute_before,
            authority_snapshot_digest,
            authority_epoch,
            provider_capabilities: Vec::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn initial_replica_authority(
        workspace_id: String,
        device_id: String,
        lease_epoch: u64,
        trusted_time_floor: i64,
        execute_before: i64,
        authority_snapshot_digest: String,
        authority_epoch: u64,
    ) -> Self {
        let mut value = Self::standby_authority(
            workspace_id,
            device_id,
            lease_epoch,
            trusted_time_floor,
            execute_before,
            authority_snapshot_digest,
            authority_epoch,
        );
        value.role = NativeCloudRole::InitialReplica;
        value
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn matches_initial_replica_authority(
        &self,
        workspace_id: &str,
        device_id: &str,
        lease_epoch: u64,
        trusted_time_floor: i64,
        execute_before: i64,
        digest: &str,
        epoch: u64,
    ) -> bool {
        self.role == NativeCloudRole::InitialReplica
            && self.runtime_nonce.is_none()
            && self.run_sequence.is_none()
            && self.provider_capabilities.is_empty()
            && self.workspace_id == workspace_id
            && self.device_id == device_id
            && self.lease_epoch == lease_epoch
            && self.trusted_time_floor == trusted_time_floor
            && self.execute_before == execute_before
            && self.authority_snapshot_digest == digest
            && self.authority_epoch == epoch
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn matches_standby_authority(
        &self,
        workspace_id: &str,
        device_id: &str,
        lease_epoch_floor: u64,
        trusted_time_floor: i64,
        execute_before: i64,
        authority_snapshot_digest: &str,
        authority_epoch: u64,
    ) -> bool {
        self.role == NativeCloudRole::Standby
            && self.runtime_nonce.is_none()
            && self.run_sequence.is_none()
            && self.workspace_id == workspace_id
            && self.device_id == device_id
            && self.lease_epoch == lease_epoch_floor
            && self.trusted_time_floor == trusted_time_floor
            && self.execute_before == execute_before
            && self.authority_snapshot_digest == authority_snapshot_digest
            && self.authority_epoch == authority_epoch
            && self.provider_capabilities.is_empty()
    }

    pub(crate) fn lease_epoch(&self) -> u64 {
        self.lease_epoch
    }

    pub(crate) fn authority_snapshot_digest(&self) -> &str {
        &self.authority_snapshot_digest
    }

    /// The device this run acts for; derived from its verified Lease, never from a caller.
    pub(crate) fn device_id(&self) -> &str {
        &self.device_id
    }
}

impl fmt::Debug for DesktopNativeCloudAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopNativeCloudAdmission([REDACTED])")
    }
}

/// Short name for the same opaque run admission.
impl fmt::Debug for DesktopSyncRunAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopSyncRunAdmission([REDACTED])")
    }
}

/// One-shot Host-owned authority check consumed at the transaction commit boundary.
///
/// The callback and captured epoch remain inside the Desktop Local Host crate and cannot be
/// serialized or returned through IPC. Durable operations consume the guard exactly once; after
/// `SQLite` COMMIT succeeds there is deliberately no fallible authority recheck that could turn a
/// committed receipt into an error.
pub(crate) struct DesktopSyncCommitGuard<'a> {
    check: Box<dyn FnOnce() -> Result<(), DesktopSyncError> + 'a>,
}

impl<'a> DesktopSyncCommitGuard<'a> {
    pub(crate) fn new(check: impl FnOnce() -> Result<(), DesktopSyncError> + 'a) -> Self {
        Self {
            check: Box::new(check),
        }
    }

    pub(crate) fn verify(
        self,
        runtime: &DesktopSyncRuntime,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<(), BusinessDatabaseError> {
        recheck_snapshot(runtime, admission)
            .and_then(|()| (self.check)())
            .map_err(|_| BusinessDatabaseError::MutationStale)
    }
}

/// Host-owned sync/provider runtime.  The constructor is crate-private so only trusted native
/// composition can choose the database binding and authority identity.
pub(crate) struct DesktopSyncRuntime {
    runtime_nonce: [u8; 16],
    workspace_id: String,
    device_id: String,
    lease_epoch: u64,
    trusted_time_floor: i64,
    execute_before: i64,
    authority_snapshot_digest: String,
    authority_epoch: u64,
    provider_capabilities: Vec<String>,
    next_run_sequence: AtomicU64,
    retirement_open_retries: Mutex<Option<VecDeque<CloudflareRetirementSeed>>>,
}

impl fmt::Debug for DesktopSyncRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopSyncRuntime([REDACTED])")
    }
}

impl DesktopSyncRuntime {
    /// Checks exact current Native authority; qualification is a separate release requirement.
    /// A continuation or Standby admission can never derive external Provider permission.
    pub(crate) fn require_provider_capability(
        &self,
        admission: &DesktopSyncRunAdmission,
        capability: &str,
    ) -> Result<(), DesktopSyncError> {
        recheck_snapshot(self, admission)?;
        if !self
            .provider_capabilities
            .iter()
            .any(|value| value == capability)
        {
            return Err(DesktopSyncError::Blocked);
        }
        Ok(())
    }

    pub(crate) fn read_cloudflare_retirement_candidates(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<Vec<crate::DesktopCloudflareRetirementCandidate>, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .cloudflare_retirement_candidates()
            .map_err(map_database_error)
    }

    pub(crate) fn claim_cloudflare_retirement_retry(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<Option<(CloudflareRetirementSeed, String)>, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        self.initialize_cloudflare_retirement_retries(database)?;
        let mut retries = self
            .retirement_open_retries
            .lock()
            .map_err(|_| DesktopSyncError::StorageRejected)?;
        Ok(retries.as_mut().and_then(VecDeque::pop_front).map(|seed| {
            let digest = cloudflare_connection_digest(
                &admission.workspace_id,
                &seed.connection_incarnation_id,
            );
            (seed, digest)
        }))
    }

    fn initialize_cloudflare_retirement_retries(
        &self,
        database: &BusinessDatabase,
    ) -> Result<(), DesktopSyncError> {
        let mut retries = self
            .retirement_open_retries
            .lock()
            .map_err(|_| DesktopSyncError::StorageRejected)?;
        if retries.is_none() {
            // Snapshot only requests present on this writable opening. Later wakes must not
            // become a background retry loop, nor pick up a newly confirmed request.
            let seeds = database
                .cloudflare_retirement_candidates()
                .map_err(map_database_error)?
                .into_iter()
                .filter(|candidate| {
                    candidate.action == crate::DesktopCloudflareMaintenanceAction::RetryRetirement
                })
                .map(|candidate| database.cloudflare_retirement_seed(&candidate.connection_ref))
                .collect::<Result<VecDeque<_>, _>>()
                .map_err(map_database_error)?;
            *retries = Some(seeds);
        }
        Ok(())
    }

    pub(crate) fn request_cloudflare_retirement(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(CloudflareRetirementSeed, String), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        // Freeze the opening's retry set before introducing this new request, even if no
        // recovery wake has successfully obtained writable admission yet.
        self.initialize_cloudflare_retirement_retries(database)?;
        let seed = database
            .request_cloudflare_retirement_guarded(
                connection_hint,
                &timestamp(trusted_now()?)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)?;
        let digest =
            cloudflare_connection_digest(&admission.workspace_id, &seed.connection_incarnation_id);
        Ok((seed, digest))
    }

    pub(crate) fn resume_cloudflare_retirement(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
    ) -> Result<(CloudflareRetirementSeed, String), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let seed = database
            .cloudflare_retirement_seed(connection_hint)
            .map_err(map_database_error)?;
        let digest =
            cloudflare_connection_digest(&admission.workspace_id, &seed.connection_incarnation_id);
        Ok((seed, digest))
    }

    pub(crate) fn resolve_cloudflare_retirement(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        seed: &CloudflareRetirementSeed,
        verified_absent: bool,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<bool, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .resolve_cloudflare_retirement_guarded(
                seed,
                verified_absent,
                &timestamp(trusted_now()?)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }

    pub(crate) fn admit_cloudflare_activation(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        self.require_provider_capability(admission, CLOUDFLARE_DNS_OBSERVE)?;
        require_qualified(CLOUDFLARE_DNS_OBSERVE)?;
        database
            .cloudflare_provision_seed(connection_hint)
            .map(|_| ())
            .map_err(map_database_error)
    }

    pub(crate) fn next_cloudflare_recovery(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        after: Option<(&str, &str)>,
    ) -> Result<Option<PreparedCloudflareRecoveryData>, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let Some(seed) = database
            .next_cloudflare_credential_recovery(after)
            .map_err(map_database_error)?
        else {
            return Ok(None);
        };
        let connection_digest =
            cloudflare_connection_digest(&admission.workspace_id, &seed.connection_incarnation_id);
        Ok(Some(PreparedCloudflareRecoveryData {
            connection_incarnation_id: seed.connection_incarnation_id,
            intent_id: seed.intent_id,
            connection_digest,
            expected_base: seed.expected_base,
            target: seed.target,
        }))
    }

    pub(crate) fn prepare_cloudflare_observation(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
        entity_hint: &str,
    ) -> Result<PreparedCloudflareObservationData, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        self.require_provider_capability(admission, CLOUDFLARE_DNS_OBSERVE)?;
        require_qualified(CLOUDFLARE_DNS_OBSERVE)?;
        let (incarnation, credential) = cloudflare_stored_credential(database, connection_hint)?;
        Ok(PreparedCloudflareObservationData {
            connection_id: connection_hint.to_owned(),
            entity_id: entity_hint.to_owned(),
            connection_digest: cloudflare_connection_digest(&admission.workspace_id, &incarnation),
            connection_incarnation_id: incarnation,
            generation: credential.generation,
            scope_digest: credential.scope_digest,
            zone_digest: credential.zone_digest,
            public_proof: credential.public_proof,
        })
    }

    pub(crate) fn prepare_cloudflare_registrar_inventory(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_id: &str,
    ) -> Result<PreparedCloudflareRegistrarData, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        self.require_provider_capability(admission, CLOUDFLARE_REGISTRAR_OBSERVE)?;
        require_qualified(CLOUDFLARE_REGISTRAR_OBSERVE)?;
        let (incarnation, credential) = cloudflare_stored_credential(database, connection_id)?;
        let prior = database
            .cloudflare_registrar_scan_head(&incarnation, credential.generation)
            .map_err(map_database_error)?;
        let mut prepared = PreparedCloudflareRegistrarData {
            connection_id: connection_id.to_owned(),
            connection_digest: cloudflare_connection_digest(&admission.workspace_id, &incarnation),
            connection_incarnation_id: incarnation,
            generation: credential.generation,
            scope_digest: credential.scope_digest,
            zone_digest: credential.zone_digest,
            public_proof: credential.public_proof,
            prior,
            request_id: None,
        };
        prepared.request_id = database
            .cloudflare_registrar_pending_request(&prepared.scan_scope(admission)?)
            .map_err(map_database_error)?;
        Ok(prepared)
    }

    pub(crate) fn queue_cloudflare_registrar_inventory(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_id: &str,
        guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        require_provider_dispatch(database)?;
        let prepared =
            self.prepare_cloudflare_registrar_inventory(database, admission, connection_id)?;
        database
            .queue_cloudflare_registrar_scan(&prepared.scan_scope(admission)?, || {
                guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    pub(crate) fn recheck_cloudflare_registrar_inventory(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        prepared: &PreparedCloudflareRegistrarData,
    ) -> Result<(), DesktopSyncError> {
        require_provider_dispatch(database)?;
        let current = self.prepare_cloudflare_registrar_inventory(
            database,
            admission,
            &prepared.connection_id,
        )?;
        if current.request_id.is_none() || current != *prepared {
            return Err(DesktopSyncError::StaleAuthority);
        }
        Ok(())
    }

    pub(crate) fn commit_cloudflare_registrar_inventory(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        prepared: &PreparedCloudflareRegistrarData,
        account_scope_digest: &str,
        registrations: &[crate::DesktopCloudflareRegistrationFact],
        guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<crate::DesktopCloudflareRegistrarScanReceipt, DesktopSyncError> {
        self.recheck_cloudflare_registrar_inventory(database, admission, prepared)?;
        database
            .import_cloudflare_registrar_inventory(
                &CloudflareRegistrarInventoryCommit {
                    request_id: prepared
                        .request_id
                        .as_deref()
                        .ok_or(DesktopSyncError::StaleAuthority)?,
                    connection_id: &prepared.connection_id,
                    connection_incarnation_id: &prepared.connection_incarnation_id,
                    credential_generation: prepared.generation,
                    prior: prepared.prior.as_ref(),
                    account_scope_digest,
                    registrations,
                    device_id: &admission.device_id,
                    lease_epoch: admission.lease_epoch,
                    at: &timestamp(trusted_now()?)?,
                },
                || guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }

    pub(crate) fn commit_checked_cloudflare_observation(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        credential: &PreparedCloudflareObservationData,
        observation: &crate::desktop_native_cloud::DesktopCloudflareCheckedObservation,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<PendingCloudflareDnsProjection, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        self.require_provider_capability(admission, CLOUDFLARE_DNS_OBSERVE)?;
        let current = self.prepare_cloudflare_observation(
            database,
            admission,
            &credential.connection_id,
            &credential.entity_id,
        )?;
        if current.connection_incarnation_id != credential.connection_incarnation_id
            || current.connection_digest != credential.connection_digest
            || current.generation != credential.generation
            || current.scope_digest != credential.scope_digest
            || current.zone_digest != credential.zone_digest
            || current.public_proof != credential.public_proof
            || observation.entity_id != credential.entity_id
            || observation.zone_binding_digest != credential.zone_digest
        {
            return Err(DesktopSyncError::InvalidInput);
        }
        let write = CloudflareDnsObservationWrite {
            observation_id: random_uuid_v4()?,
            observation_run_id: random_uuid_v4()?,
            entity_id: credential.entity_id.clone(),
            connection_id: credential.connection_id.clone(),
            lease_epoch: admission.lease_epoch,
            observed_at: timestamp(trusted_now()?)?,
            zone_name_ascii: observation.zone_name_ascii.clone(),
            authoritative_nameservers: observation.authoritative_nameservers.clone(),
            dnssec_status: observation.dnssec_status.clone(),
            availability: observation.availability.clone(),
            zone_status: observation.zone_status.clone(),
            records: observation.records.clone(),
            provider_version_token: observation.provider_version_token.clone(),
            credential_generation: credential.generation,
            credential_scope_digest: credential.scope_digest.clone(),
            credential_zone_digest: credential.zone_digest.clone(),
            credential_public_proof: credential.public_proof.clone(),
        };
        database
            .commit_cloudflare_dns_observation_guarded(&write, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    /// Imports the activated Zone as a domain asset under this activation's own admission, through
    /// the same Host create path as `local_domain_asset_create`
    /// (`DesktopBusinessRuntime::create_domain_asset_guarded`), so deduplication, the deletion
    /// tombstone rule and the sync Outbox apply unchanged. The admission recheck and the commit
    /// guard bind the write to the workspace, device, lease and authority the Provider was observed
    /// under: a change of authority during the Provider call writes nothing. A domain the
    /// workspace already holds is left as it is.
    ///
    /// The read generation is the runtime's own: this create is decided by the Host, not by a
    /// Renderer view, and it only adds a bare asset keyed by name, so no update can be lost.
    pub(crate) fn import_cloudflare_zone_asset(
        &self,
        business: &mut crate::desktop_business_runtime::DesktopBusinessRuntime,
        admission: &DesktopSyncRunAdmission,
        entity_id: &str,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(business.database_for_backup_mut(), admission)?;
        self.require_provider_capability(admission, CLOUDFLARE_DNS_OBSERVE)?;
        require_qualified(CLOUDFLARE_DNS_OBSERVE)?;
        let context = crate::desktop_business_runtime::BusinessMutationContext::new(
            admission.device_id.clone(),
            admission.lease_epoch,
            timestamp(trusted_now()?)?,
        )
        .map_err(map_database_error)?;
        let request = crate::DesktopDomainAssetCreateRequest {
            mutation_id: random_uuid_v4()?,
            expected_read_generation: business.read_generation(),
            asset: crate::DesktopDomainAssetWrite::bare(entity_id),
        };
        match business
            .create_domain_asset_guarded(request, &context, || commit_guard.verify(self, admission))
        {
            Ok(_) | Err(BusinessDatabaseError::AssetExists) => Ok(()),
            // Every other input of this create is Host generated (a fresh mutation id, the
            // admission's device, a trusted timestamp, the runtime's own read generation), so an
            // invalid input can only be the Zone name itself.
            Err(
                BusinessDatabaseError::InvalidInput
                | BusinessDatabaseError::AssetDeleted
                | BusinessDatabaseError::AssetReAddPending
                | BusinessDatabaseError::AssetReAddBlocked,
            ) => Err(DesktopSyncError::ZoneUnimportable),
            Err(error) => Err(map_database_error(error)),
        }
    }

    pub(crate) fn prepare_cloudflare_provision(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
        observation: &crate::desktop_native_cloud::DesktopCloudflareCheckedObservation,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<PreparedCloudflareProvisionData, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        self.require_provider_capability(admission, CLOUDFLARE_DNS_OBSERVE)?;
        require_qualified(CLOUDFLARE_DNS_OBSERVE)?;
        let seed = database
            .cloudflare_provision_seed(connection_hint)
            .map_err(map_database_error)?;
        let target_generation = seed
            .expected_head_generation
            .checked_add(1)
            .filter(|generation| *generation <= MAX_SAFE_INTEGER)
            .ok_or(DesktopSyncError::StorageRejected)?;
        let prepared_at = timestamp(trusted_now()?)?;
        let intent_id = random_uuid_v4()?;
        let mut staged = CloudflareCredentialStagedObservation {
            staged_batch_id: random_uuid_v4()?,
            observation_digest: String::new(),
            observation_id: random_uuid_v4()?,
            observation_run_id: random_uuid_v4()?,
            entity_id: observation.entity_id.clone(),
            lease_epoch: admission.lease_epoch,
            observed_at: prepared_at.clone(),
            zone_name_ascii: observation.zone_name_ascii.clone(),
            authoritative_nameservers: observation.authoritative_nameservers.clone(),
            dnssec_status: observation.dnssec_status.clone(),
            availability: observation.availability.clone(),
            zone_status: observation.zone_status.clone(),
            records: observation.records.clone(),
            provider_version_token: observation.provider_version_token.clone(),
        };
        staged.observation_digest =
            crate::active_workspace::business::staged_observation_digest(&staged)
                .map_err(map_database_error)?;
        let scope_digest = domain_digest(
            b"gooddealer/cloudflare-credential-scope/v1\0",
            &[
                admission.workspace_id.as_bytes(),
                admission.device_id.as_bytes(),
                seed.connection_incarnation_id.as_bytes(),
                observation.zone_binding_digest.as_bytes(),
            ],
        );
        let connection_digest =
            cloudflare_connection_digest(&admission.workspace_id, &seed.connection_incarnation_id);
        let preparation = CloudflareCredentialPreparation {
            logical_connection_id: seed.logical_connection_id,
            connection_incarnation_id: seed.connection_incarnation_id,
            display_label: seed.display_label,
            intent_id,
            operation_kind: CloudflareCredentialOperationKind::Provision,
            expected_head_generation: seed.expected_head_generation,
            target_generation,
            scope_digest,
            zone_digest: observation.zone_binding_digest.clone(),
            target_public_proof: random_hex_32()?,
            prepared_authority_snapshot_digest: admission.authority_snapshot_digest.clone(),
            staged_observation: Some(staged),
            prepared_at,
        };
        let disposition = database
            .prepare_cloudflare_credential_operation_guarded(&preparation, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)?;
        if disposition != CloudflareCredentialPreparationDisposition::Prepared {
            return Err(DesktopSyncError::StorageRejected);
        }
        Ok(PreparedCloudflareProvisionData {
            preparation,
            expected_base: seed.expected_base,
            connection_digest,
        })
    }

    /// Durably prepares the revocation of the connection's Active credential and denies its use
    /// in the same transaction, so the Host stops using it before custody is touched.
    ///
    /// Returns `None` when the connection holds no credential: there is nothing to revoke.
    pub(crate) fn prepare_cloudflare_revocation(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<Option<PreparedCloudflareProvisionData>, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let seed = database
            .cloudflare_revocation_seed(connection_hint)
            .map_err(map_database_error)?;
        let (scope_digest, zone_digest) = match &seed.expected_base {
            base if base.kind == CloudflareCredentialEnvelopeKind::Absent => return Ok(None),
            CloudflareCredentialWitness {
                kind: CloudflareCredentialEnvelopeKind::Active,
                scope_digest: Some(scope),
                zone_digest: Some(zone),
                ..
            } => (scope.clone(), zone.clone()),
            _ => return Err(DesktopSyncError::StorageRejected),
        };
        let target_generation = seed
            .expected_head_generation
            .checked_add(1)
            .filter(|generation| *generation <= MAX_SAFE_INTEGER)
            .ok_or(DesktopSyncError::StorageRejected)?;
        let connection_digest =
            cloudflare_connection_digest(&admission.workspace_id, &seed.connection_incarnation_id);
        let preparation = CloudflareCredentialPreparation {
            logical_connection_id: seed.logical_connection_id,
            connection_incarnation_id: seed.connection_incarnation_id,
            display_label: seed.display_label,
            intent_id: random_uuid_v4()?,
            operation_kind: CloudflareCredentialOperationKind::Revoke,
            expected_head_generation: seed.expected_head_generation,
            target_generation,
            scope_digest,
            zone_digest,
            target_public_proof: random_hex_32()?,
            prepared_authority_snapshot_digest: admission.authority_snapshot_digest.clone(),
            staged_observation: None,
            prepared_at: timestamp(trusted_now()?)?,
        };
        let disposition = database
            .prepare_cloudflare_credential_operation_guarded(&preparation, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)?;
        if disposition != CloudflareCredentialPreparationDisposition::Prepared {
            return Ok(None);
        }
        Ok(Some(PreparedCloudflareProvisionData {
            preparation,
            expected_base: seed.expected_base,
            connection_digest,
        }))
    }

    /// Creates a runtime from Host-owned authority material.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        workspace_id: String,
        device_id: String,
        lease_epoch: u64,
        trusted_time_floor: i64,
        execute_before: i64,
        authority_snapshot_digest: String,
        authority_epoch: u64,
        provider_capabilities: Vec<String>,
    ) -> Result<Self, DesktopSyncError> {
        if !valid_provider_capabilities(&provider_capabilities)
            || !valid_identifier(&workspace_id)
            || !valid_identifier(&device_id)
            || !(1..=MAX_SAFE_INTEGER).contains(&lease_epoch)
            || execute_before <= trusted_time_floor
            || authority_snapshot_digest.len() != 64
            || !authority_snapshot_digest
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(DesktopSyncError::InvalidInput);
        }
        let mut runtime_nonce = [0_u8; 16];
        getrandom::fill(&mut runtime_nonce).map_err(|_| DesktopSyncError::StorageRejected)?;
        Ok(Self {
            runtime_nonce,
            workspace_id,
            device_id,
            lease_epoch,
            trusted_time_floor,
            execute_before,
            authority_snapshot_digest,
            authority_epoch,
            provider_capabilities,
            next_run_sequence: AtomicU64::new(0),
            retirement_open_retries: Mutex::new(None),
        })
    }

    /// Starts one Host-owned run and returns only its opaque admission.
    pub(crate) fn begin_sync_run(
        &self,
        database: &BusinessDatabase,
    ) -> Result<DesktopSyncRunAdmission, DesktopSyncError> {
        let now = trusted_now()?;
        if database.workspace_id() != self.workspace_id {
            return Err(DesktopSyncError::StaleAuthority);
        }
        if now < self.trusted_time_floor || now >= self.execute_before {
            return Err(DesktopSyncError::Blocked);
        }
        let run_sequence = self
            .next_run_sequence
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value
                    .checked_add(1)
                    .filter(|next| *next <= MAX_SAFE_INTEGER)
            })
            .map_err(|_| DesktopSyncError::StorageRejected)?
            .checked_add(1)
            .ok_or(DesktopSyncError::StorageRejected)?;
        Ok(DesktopSyncRunAdmission {
            role: NativeCloudRole::Active,
            runtime_nonce: Some(self.runtime_nonce),
            run_sequence: Some(run_sequence),
            workspace_id: self.workspace_id.clone(),
            device_id: self.device_id.clone(),
            lease_epoch: self.lease_epoch,
            trusted_time_floor: self.trusted_time_floor,
            execute_before: self.execute_before,
            authority_snapshot_digest: self.authority_snapshot_digest.clone(),
            authority_epoch: self.authority_epoch,
            provider_capabilities: self.provider_capabilities.clone(),
        })
    }

    pub(crate) fn recheck_sync_run(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<(), DesktopSyncError> {
        let now = trusted_now()?;
        if admission.role != NativeCloudRole::Active
            || admission.runtime_nonce != Some(self.runtime_nonce)
            || database.workspace_id() != self.workspace_id
            || admission.workspace_id != self.workspace_id
            || admission.device_id != self.device_id
            || admission.lease_epoch != self.lease_epoch
            || admission.trusted_time_floor != self.trusted_time_floor
            || admission.execute_before != self.execute_before
            || admission.authority_snapshot_digest != self.authority_snapshot_digest
            || admission.authority_epoch != self.authority_epoch
            || admission.provider_capabilities != self.provider_capabilities
            || now < admission.trusted_time_floor
            || now >= admission.execute_before
        {
            return Err(DesktopSyncError::StaleAuthority);
        }
        Ok(())
    }

    pub(crate) fn sync_claim(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<SyncPushClaimSchedule, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now = trusted_now()?;
        let retry_not_before = database
            .next_sync_push_attempt_unix_seconds(now)
            .map_err(map_database_error)?;
        if let Some(deadline) = retry_not_before
            && deadline > now
        {
            return Ok(SyncPushClaimSchedule {
                claimed: Vec::new(),
                retry_after: Some(Duration::from_secs(
                    u64::try_from(deadline - now).map_err(|_| DesktopSyncError::StorageRejected)?,
                )),
            });
        }
        if retry_not_before.is_none() {
            return Ok(SyncPushClaimSchedule {
                claimed: Vec::new(),
                retry_after: None,
            });
        }
        let expires = checked_timestamp(now, SYNC_LEASE_SECONDS)?;
        let claimed = database
            .claim_sync_mutations_v2_guarded(
                &owner(admission)?,
                &timestamp(now)?,
                &expires,
                256,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)?;
        Ok(SyncPushClaimSchedule {
            retry_after: (!claimed.is_empty()).then_some(Duration::from_secs(
                u64::try_from(SYNC_LEASE_SECONDS).map_err(|_| DesktopSyncError::StorageRejected)?,
            )),
            claimed,
        })
    }

    pub(crate) fn sync_acknowledge(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        acknowledgements: &[SyncMutationAcknowledgement],
        has_read_generation_capacity: bool,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<SyncProjectionEffect, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now = timestamp(trusted_now()?)?;
        database
            .acknowledge_sync_batch_v2_guarded(delivery_owner, acknowledgements, &now, |effect| {
                if effect == SyncProjectionEffect::VisibleStateChanged
                    && !has_read_generation_capacity
                {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    /// ADR-0032 S2d: closes local mutation admission for one switch under this run's Lease epoch.
    pub(crate) fn drain_begin_barrier(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        device_switch_request_id: &str,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now = timestamp(trusted_now()?)?;
        database
            .begin_device_handoff_barrier_for_source(
                device_switch_request_id,
                &admission.device_id,
                admission.lease_epoch,
                &now,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }

    pub(crate) fn drain_frozen_unresolved_count(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<u64, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .device_handoff_frozen_unresolved_count(&admission.device_id, admission.lease_epoch)
            .map_err(map_database_error)
    }

    /// ADR-0032 S2d: this run's device-and-epoch view of the drain, read under a rechecked run.
    pub(crate) fn drain_progress(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<DrainMutationProgress, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let Some(pending) = database
            .execution_evidence_pending_count()
            .map_err(map_database_error)?
        else {
            return Ok(DrainMutationProgress::Blocked);
        };
        if pending > 0 {
            return Ok(DrainMutationProgress::Waiting {
                unconfirmed: pending,
            });
        }
        let mutation = database
            .read_drain_mutation_progress(&admission.device_id)
            .map_err(map_database_error)?;
        if !matches!(mutation, DrainMutationProgress::Ready(_)) {
            return Ok(mutation);
        }
        if database
            .execution_evidence_drain_claims(&admission.device_id, admission.lease_epoch)
            .map_err(map_database_error)?
            .is_none()
        {
            return Ok(DrainMutationProgress::Blocked);
        }
        Ok(mutation)
    }

    /// ADR-0032 S2c: the version-2 rows that still need Cloud's receipt.
    pub(crate) fn drain_receipt_mutation_ids(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<Vec<String>, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        Ok(database
            .drain_receipt_candidates(&admission.device_id)
            .map_err(map_database_error)?
            .into_iter()
            .map(|candidate| candidate.mutation_id)
            .collect())
    }

    /// ADR-0032 S2c: records Cloud's receipts, all or nothing, under a rechecked run.
    pub(crate) fn drain_record_receipts(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        receipts: &[CloudMutationReceipt],
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now = timestamp(trusted_now()?)?;
        database
            .record_cloud_wire_versions(&admission.device_id, receipts, &now, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    /// ADR-0032 S2d: the unsigned handoff proof for `device_switch_request_id`. It exists only while
    /// this switch's barrier holds writes closed under this run's Lease epoch and the mutation
    /// stream is fully confirmed and there are no local Provider facts requiring the other streams.
    /// The key version comes from the current independently verified execution context.
    pub(crate) fn drain_prepare_proof(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        device_switch_request_id: &str,
        signing_key_id: &str,
        signing_key_version: u64,
    ) -> Result<HandoffDrainProofClaims, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        // This independent check also covers callers that bypass the progress projection.
        if database
            .has_unexported_provider_handoff_facts()
            .map_err(map_database_error)?
        {
            return Err(DesktopSyncError::Blocked);
        }
        let barrier = database
            .device_handoff_barrier()
            .map_err(map_database_error)?
            .ok_or(DesktopSyncError::Blocked)?;
        if barrier.device_switch_request_id != device_switch_request_id
            || barrier.active_lease_epoch != Some(admission.lease_epoch)
        {
            return Err(DesktopSyncError::Blocked);
        }
        let DrainMutationProgress::Ready(mutation) = database
            .read_drain_mutation_progress(&admission.device_id)
            .map_err(map_database_error)?
        else {
            return Err(DesktopSyncError::Blocked);
        };
        let [execution, audit] = database
            .execution_evidence_drain_claims(&admission.device_id, admission.lease_epoch)
            .map_err(map_database_error)?
            .ok_or(DesktopSyncError::Blocked)?;
        let now = trusted_now()?;
        Ok(HandoffDrainProofClaims {
            schema_version: DrainProofSchemaVersion::V2,
            proof_id: random_uuid_v4()?,
            workspace_id: admission.workspace_id.clone(),
            source_device_id: admission.device_id.clone(),
            active_lease_epoch: admission.lease_epoch,
            device_switch_request_id: device_switch_request_id.to_owned(),
            streams: [mutation, execution, audit],
            // Cloud refuses a proof issued after its own clock and admits a window of at most 600
            // seconds. Issuing 30 seconds back keeps a Desktop clock slightly ahead of Cloud from
            // failing the first submission; the window stays five minutes.
            issued_at: checked_timestamp(now, -30)?,
            expires_at: checked_timestamp(now, 270)?,
            signing_key_id: signing_key_id.to_owned(),
            signing_key_version,
        })
    }

    /// ADR-0032 S2d: reopens local writes after cancellation/failure before source release.
    pub(crate) fn drain_clear_barrier(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        device_switch_request_id: &str,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .clear_device_handoff_barrier_for_source(
                device_switch_request_id,
                &admission.device_id,
                admission.lease_epoch,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }

    /// ADR-0032 S2d3: the switch whose barrier holds writes closed under this run's Lease epoch, so
    /// a restarted Desktop resumes its own drain. A barrier from another epoch is not this run's.
    pub(crate) fn drain_current_barrier(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<Option<String>, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        Ok(database
            .device_handoff_barrier()
            .map_err(map_database_error)?
            .filter(|barrier| barrier.active_lease_epoch == Some(admission.lease_epoch))
            .map(|barrier| barrier.device_switch_request_id))
    }

    /// ADR-0032 S2d: clears a barrier left by a switch whose Lease this device no longer holds.
    pub(crate) fn drain_clear_left_over_barrier(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<bool, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .clear_left_over_device_handoff_barrier(admission.lease_epoch, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    pub(crate) fn sync_defer_retryable_with_deadline(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        mutations: &[ClaimedSyncMutation],
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<Duration, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now_seconds = trusted_now()?;
        let deadline = database
            .defer_retryable_sync_batch_v2_guarded_with_deadline(
                delivery_owner,
                mutations,
                &timestamp(now_seconds)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)?;
        let seconds = deadline
            .checked_sub(now_seconds)
            .and_then(|seconds| u64::try_from(seconds).ok())
            .filter(|seconds| *seconds > 0)
            .ok_or(DesktopSyncError::StorageRejected)?;
        Ok(Duration::from_secs(seconds))
    }

    pub(crate) fn sync_reject(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        rejection: DesktopSyncRejectBatch<'_>,
        has_read_generation_capacity: bool,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<SyncProjectionEffect, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .reject_sync_batch_v2_guarded(
                rejection.delivery_owner,
                rejection.mutations,
                match rejection.disposition {
                    DesktopSyncRejectDisposition::Rejected => SyncRejectionKind::Deterministic,
                    DesktopSyncRejectDisposition::Conflicted => {
                        SyncRejectionKind::IdempotencyConflict
                    }
                    DesktopSyncRejectDisposition::MutationConflicted => {
                        SyncRejectionKind::MutationConflict
                    }
                },
                |effect| {
                    if effect == SyncProjectionEffect::VisibleStateChanged
                        && !has_read_generation_capacity
                    {
                        return Err(BusinessDatabaseError::SequenceExhausted);
                    }
                    commit_guard.verify(self, admission)
                },
            )
            .map_err(map_database_error)
    }

    pub(crate) fn sync_pull_request(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        page_limit: u16,
    ) -> Result<SyncPullRequestV2, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .read_sync_pull_request_v2(&self.device_id, page_limit)
            .map_err(map_database_error)
    }

    pub(crate) fn sync_apply_page(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        page_json: &str,
        confirmation_token: &str,
        has_read_generation_capacity: bool,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<SyncProjectionEffect, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let device_id = self.device_id.clone();
        database
            .apply_sync_page_v2_guarded(&device_id, page_json, confirmation_token, |effect| {
                if effect == SyncProjectionEffect::VisibleStateChanged
                    && !has_read_generation_capacity
                {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    pub(crate) fn sync_mark_rebootstrap_required(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        has_read_generation_capacity: bool,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<SyncProjectionEffect, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .mark_sync_rebootstrap_required_v2_guarded(&self.device_id, |effect| {
                if effect == SyncProjectionEffect::VisibleStateChanged
                    && !has_read_generation_capacity
                {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    pub(crate) fn checkpoint_due(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<bool, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database.native_checkpoint_due().map_err(map_database_error)
    }

    pub(crate) fn complete_checkpoint(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        descriptor: Option<&NativeCheckpointDescriptor>,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .complete_native_checkpoint_guarded(descriptor, &timestamp(trusted_now()?)?, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    pub(crate) fn pending_cloudflare_projections(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        limit: usize,
    ) -> Result<Vec<PendingCloudflareDnsProjection>, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .pending_cloudflare_dns_projections(limit)
            .map_err(map_database_error)
    }

    pub(crate) fn claim_cloudflare_projection(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<CloudflareProjectionClaimSchedule, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now_seconds = trusted_now()?;
        let now = timestamp(now_seconds)?;
        let expires = checked_timestamp(now_seconds, PROJECTION_LEASE_SECONDS)?;
        let claimed = database
            .claim_cloudflare_dns_projections_guarded(&owner(admission)?, &now, &expires, 1, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)?
            .pop();
        let retry_not_before = if claimed.is_some() {
            Some(
                now_seconds
                    .checked_add(PROJECTION_LEASE_SECONDS)
                    .ok_or(DesktopSyncError::StorageRejected)?,
            )
        } else {
            database
                .next_cloudflare_projection_attempt_unix_seconds(now_seconds)
                .map_err(map_database_error)?
        };
        let retry_after = retry_not_before
            .map(|deadline| {
                deadline
                    .checked_sub(now_seconds)
                    .and_then(|seconds| u64::try_from(seconds).ok())
                    .filter(|seconds| *seconds > 0)
                    .map(Duration::from_secs)
                    .ok_or(DesktopSyncError::StorageRejected)
            })
            .transpose()?;
        Ok(CloudflareProjectionClaimSchedule {
            claimed,
            retry_after,
        })
    }

    pub(crate) fn acknowledge_cloudflare_projection(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        acknowledgement: &CloudflareDnsProjectionAcknowledgement,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now = timestamp(trusted_now()?)?;
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                delivery_owner,
                acknowledgement,
                &now,
                || commit_guard.verify(self, admission),
            )
            .map_err(|error| match error {
                BusinessDatabaseError::InvalidInput | BusinessDatabaseError::MutationConflict => {
                    DesktopSyncError::AcknowledgementMismatch
                }
                other => map_database_error(other),
            })
    }

    pub(crate) fn defer_cloudflare_projection(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        projection: &ClaimedCloudflareDnsProjection,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<Duration, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        let now_seconds = trusted_now()?;
        let deadline = database
            .defer_cloudflare_dns_projection_guarded(
                delivery_owner,
                projection,
                &timestamp(now_seconds)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)?;
        let seconds = deadline
            .checked_sub(now_seconds)
            .and_then(|seconds| u64::try_from(seconds).ok())
            .filter(|seconds| *seconds > 0)
            .ok_or(DesktopSyncError::StorageRejected)?;
        Ok(Duration::from_secs(seconds))
    }

    pub(crate) fn begin_cloudflare_prewrite_inspection(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .begin_cloudflare_prewrite_inspection_guarded(
                connection_incarnation_id,
                intent_id,
                &admission.authority_snapshot_digest,
                &timestamp(trusted_now()?)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }

    pub(crate) fn mark_cloudflare_keychain_write_started(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .mark_cloudflare_keychain_write_started_guarded(
                connection_incarnation_id,
                intent_id,
                &admission.authority_snapshot_digest,
                &timestamp(trusted_now()?)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }

    pub(crate) fn cancel_cloudflare_prewrite_for_remediation(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        reason: crate::CloudflarePrewriteFailureReason,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .cancel_cloudflare_prewrite_for_remediation_guarded(
                connection_incarnation_id,
                intent_id,
                reason,
                &timestamp(trusted_now()?)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }

    pub(crate) fn recover_cloudflare_credential_orphans(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<usize, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .recover_cloudflare_credential_orphans_guarded(&timestamp(trusted_now()?)?, || {
                commit_guard.verify(self, admission)
            })
            .map_err(map_database_error)
    }

    pub(crate) fn resolve_cloudflare_credential_operation(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        observation: &CloudflareCredentialRecoveryObservation,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<CloudflareCredentialResolution, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
        database
            .resolve_cloudflare_credential_operation_guarded(
                connection_incarnation_id,
                intent_id,
                observation,
                &admission.authority_snapshot_digest,
                &timestamp(trusted_now()?)?,
                || commit_guard.verify(self, admission),
            )
            .map_err(map_database_error)
    }
}

/// Refuses a capability the Host's ADR-0027 register has not qualified. Checked at every
/// admission that would reach the Provider, so no caller can reach an unqualified capability.
fn require_qualified(capability: &str) -> Result<(), DesktopSyncError> {
    if crate::active_workspace::capability_qualification::capability_qualified(capability) {
        Ok(())
    } else {
        Err(DesktopSyncError::CapabilityUnqualified)
    }
}

/// The Keychain account digest of one connection incarnation; every credential path must agree.
fn cloudflare_connection_digest(workspace_id: &str, connection_incarnation_id: &str) -> String {
    domain_digest(
        b"gooddealer/cloudflare-connection/v1\0",
        &[
            workspace_id.as_bytes(),
            connection_incarnation_id.as_bytes(),
        ],
    )
}

pub(crate) fn delivery_owner(
    admission: &DesktopSyncRunAdmission,
) -> Result<String, DesktopSyncError> {
    owner(admission)
}

fn owner(admission: &DesktopSyncRunAdmission) -> Result<String, DesktopSyncError> {
    if admission.role != NativeCloudRole::Active {
        return Err(DesktopSyncError::StaleAuthority);
    }
    let runtime_nonce = admission
        .runtime_nonce
        .ok_or(DesktopSyncError::StaleAuthority)?;
    let run_sequence = admission
        .run_sequence
        .ok_or(DesktopSyncError::StaleAuthority)?;
    let nonce = runtime_nonce[..8]
        .iter()
        .fold(String::with_capacity(16), |mut output, byte| {
            use std::fmt::Write as _;
            write!(&mut output, "{byte:02x}").expect("writing to a String cannot fail");
            output
        });
    Ok(format!("desktop-sync-{nonce}-{run_sequence}"))
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn recheck_snapshot(
    runtime: &DesktopSyncRuntime,
    admission: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    let now = trusted_now()?;
    if admission.role != NativeCloudRole::Active
        || admission.runtime_nonce != Some(runtime.runtime_nonce)
        || admission.workspace_id != runtime.workspace_id
        || admission.device_id != runtime.device_id
        || admission.lease_epoch != runtime.lease_epoch
        || admission.trusted_time_floor != runtime.trusted_time_floor
        || admission.execute_before != runtime.execute_before
        || admission.authority_snapshot_digest != runtime.authority_snapshot_digest
        || admission.authority_epoch != runtime.authority_epoch
        || admission.provider_capabilities != runtime.provider_capabilities
        || now < admission.trusted_time_floor
        || now >= admission.execute_before
    {
        return Err(DesktopSyncError::StaleAuthority);
    }
    Ok(())
}

pub(crate) fn trusted_now() -> Result<i64, DesktopSyncError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DesktopSyncError::Blocked)
        .and_then(|duration| {
            i64::try_from(duration.as_secs()).map_err(|_| DesktopSyncError::Blocked)
        })
}

pub(crate) fn timestamp(seconds: i64) -> Result<String, DesktopSyncError> {
    if seconds < 0 {
        return Err(DesktopSyncError::Blocked);
    }
    let days = seconds / 86_400;
    let day_seconds = seconds % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(month <= 2);
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        day_seconds / 3_600,
        (day_seconds / 60) % 60,
        day_seconds % 60
    ))
}

fn checked_timestamp(now: i64, seconds: i64) -> Result<String, DesktopSyncError> {
    timestamp(now.checked_add(seconds).ok_or(DesktopSyncError::Blocked)?)
}

pub(crate) fn random_uuid_v4() -> Result<String, DesktopSyncError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| DesktopSyncError::StorageRejected)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    ))
}

fn random_hex_32() -> Result<String, DesktopSyncError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| DesktopSyncError::StorageRejected)?;
    Ok(encode_hex(bytes))
}

fn domain_digest(domain: &[u8], fields: &[&[u8]]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain);
    for field in fields {
        digest.update((field.len() as u64).to_be_bytes());
        digest.update(field);
    }
    encode_hex(digest.finalize())
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    let bytes = bytes.as_ref();
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

fn cloudflare_stored_credential(
    database: &BusinessDatabase,
    connection_id: &str,
) -> Result<
    (
        String,
        crate::active_workspace::business::CloudflareConnectionObservationAdmission,
    ),
    DesktopSyncError,
> {
    let credential = database
        .cloudflare_connection_observation_admission(connection_id)
        .map_err(map_database_error)?;
    let seed = database
        .cloudflare_provision_seed(connection_id)
        .map_err(map_database_error)?;
    if seed.expected_base.kind != CloudflareCredentialEnvelopeKind::Active
        || seed.expected_base.generation != Some(credential.generation)
        || seed.expected_base.scope_digest.as_deref() != Some(&credential.scope_digest)
        || seed.expected_base.zone_digest.as_deref() != Some(&credential.zone_digest)
        || seed.expected_base.public_proof.as_deref() != Some(&credential.public_proof)
    {
        return Err(DesktopSyncError::StorageRejected);
    }
    Ok((seed.connection_incarnation_id, credential))
}

pub(crate) fn require_provider_dispatch(
    database: &BusinessDatabase,
) -> Result<(), DesktopSyncError> {
    if database
        .device_handoff_barrier()
        .map_err(map_database_error)?
        .is_some()
    {
        return Err(DesktopSyncError::Blocked);
    }
    Ok(())
}

fn map_database_error(error: BusinessDatabaseError) -> DesktopSyncError {
    match error {
        BusinessDatabaseError::MutationConflict => DesktopSyncError::AcknowledgementMismatch,
        BusinessDatabaseError::MutationStale => DesktopSyncError::StaleAuthority,
        BusinessDatabaseError::InvalidInput
        | BusinessDatabaseError::WorkspaceRejected
        | BusinessDatabaseError::SchemaRejected
        | BusinessDatabaseError::CredentialSchemaRebuildRequired
        | BusinessDatabaseError::ProjectionRejected
        | BusinessDatabaseError::RevisionRejected
        | BusinessDatabaseError::QueryRejected
        | BusinessDatabaseError::WindowRejected
        | BusinessDatabaseError::AssetNotFound
        | BusinessDatabaseError::AssetDeleted
        | BusinessDatabaseError::AssetExists
        | BusinessDatabaseError::AssetReAddPending
        | BusinessDatabaseError::AssetReAddBlocked
        | BusinessDatabaseError::SecretInSyncPayload
        | BusinessDatabaseError::SequenceExhausted
        | BusinessDatabaseError::ProviderBindingUnavailable => DesktopSyncError::InvalidInput,
        BusinessDatabaseError::StorageRejected => DesktopSyncError::StorageRejected,
    }
}

/// The signed commercial contract is a canonical closed set, including a valid empty set.
pub(crate) fn valid_provider_capabilities(values: &[String]) -> bool {
    const CAPABILITIES: &[&str] = &[
        "afternic:marketplace:observe",
        "afternic:marketplace:write",
        "aliyun:registrar:observe",
        crate::active_workspace::capability_qualification::ATOM_MARKETPLACE_OBSERVE,
        crate::active_workspace::capability_qualification::ATOM_MARKETPLACE_WRITE,
        "cloudflare:dns:observe",
        "cloudflare:registrar:observe",
        "godaddy:registrar:observe",
        crate::active_workspace::capability_qualification::PORKBUN_DNS_OBSERVE,
        crate::active_workspace::capability_qualification::PORKBUN_REGISTRAR_OBSERVE,
        crate::active_workspace::capability_qualification::SEDO_MARKETPLACE_OBSERVE,
        crate::active_workspace::capability_qualification::SPACESHIP_MARKETPLACE_OBSERVE,
        crate::active_workspace::capability_qualification::SPACESHIP_MARKETPLACE_WRITE,
        "spaceship:registrar:observe",
    ];
    values.len() <= CAPABILITIES.len()
        && values
            .iter()
            .all(|value| CAPABILITIES.contains(&value.as_str()))
        && values.windows(2).all(|pair| pair[0] < pair[1])
        && [
            ("afternic:marketplace:write", "afternic:marketplace:observe"),
            (
                crate::active_workspace::capability_qualification::ATOM_MARKETPLACE_WRITE,
                crate::active_workspace::capability_qualification::ATOM_MARKETPLACE_OBSERVE,
            ),
            (
                crate::active_workspace::capability_qualification::SPACESHIP_MARKETPLACE_WRITE,
                crate::active_workspace::capability_qualification::SPACESHIP_MARKETPLACE_OBSERVE,
            ),
        ]
        .into_iter()
        .all(|(write, observe)| {
            !values.iter().any(|value| value == write)
                || values.iter().any(|value| value == observe)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::capability_qualification::{
        SPACESHIP_MARKETPLACE_OBSERVE, SPACESHIP_REGISTRAR_OBSERVE,
    };
    use std::sync::{
        Arc, Barrier,
        atomic::{AtomicBool, Ordering as AtomicOrdering},
    };

    use crate::{DomainAssetWrite, LocalDatabaseKey};

    const AUTHORITY_DIGEST: &str =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn database(workspace_id: &str) -> (tempfile::TempDir, BusinessDatabase) {
        let directory = crate::test_tempdir::tempdir().expect("temporary database directory");
        let key = LocalDatabaseKey::from_bytes([0x73; 32]);
        let database =
            BusinessDatabase::open(&directory.path().join("business.db"), &key, workspace_id)
                .expect("open test database");
        (directory, database)
    }

    fn runtime() -> DesktopSyncRuntime {
        DesktopSyncRuntime::new(
            "workspace-local".to_owned(),
            "device-local".to_owned(),
            7,
            0,
            i64::MAX,
            AUTHORITY_DIGEST.to_owned(),
            1,
            vec![CLOUDFLARE_DNS_OBSERVE.to_owned()],
        )
        .expect("construct runtime")
    }

    fn allow_commit() -> DesktopSyncCommitGuard<'static> {
        DesktopSyncCommitGuard::new(|| Ok(()))
    }

    fn seed_sync_mutation(database: &mut BusinessDatabase) {
        let initial = DomainAssetWrite {
            entity_id: "commit-fence.test".to_owned(),
            note: None,
            portfolio_id: None,
            tags: vec!["initial".to_owned()],
            target_price: None,
        };
        database
            .upsert_domain_asset("seed-commit-fence", "2026-09-16T00:00:00Z", &initial)
            .expect("seed asset");
        database
            .acknowledge_sync_mutation("seed-commit-fence", 1, "2026-09-16T00:00:01Z")
            .expect("acknowledge seed");
        let version = database
            .read_domain_detail("commit-fence.test")
            .expect("read seeded asset")
            .asset
            .asset_version;
        database
            .edit_domain_asset(
                "guarded-sync-mutation",
                version,
                "device-local",
                7,
                "2026-09-16T00:01:00Z",
                &DomainAssetWrite {
                    note: Some("guarded".to_owned()),
                    ..initial
                },
                true,
            )
            .expect("create v2 mutation");
    }

    #[test]
    fn admission_is_redacted_and_bound_to_one_runtime_and_database() {
        let (_directory, local_database) = database("workspace-local");
        let local_runtime = runtime();
        let admission = local_runtime
            .begin_sync_run(&local_database)
            .expect("admit run");
        assert_eq!(
            format!("{admission:?}"),
            "DesktopSyncRunAdmission([REDACTED])"
        );
        local_runtime
            .recheck_sync_run(&local_database, &admission)
            .expect("same runtime accepts admission");

        let replacement = runtime();
        assert_eq!(
            replacement.recheck_sync_run(&local_database, &admission),
            Err(DesktopSyncError::StaleAuthority)
        );
        let (_other_directory, other_database) = database("workspace-other");
        assert_eq!(
            local_runtime.recheck_sync_run(&other_database, &admission),
            Err(DesktopSyncError::StaleAuthority)
        );
    }

    #[test]
    fn sync_and_projection_stages_derive_host_owned_run_values() {
        let (_directory, mut database) = database("workspace-local");
        let runtime = runtime();
        let admission = runtime.begin_sync_run(&database).expect("admit run");

        assert!(
            runtime
                .sync_claim(&mut database, &admission, allow_commit())
                .unwrap()
                .claimed
                .is_empty()
        );
        let pull = runtime
            .sync_pull_request(&database, &admission, 64)
            .expect("derive pull request");
        assert_eq!(pull.schema_version, 3);
        assert_eq!(pull.after_server_revision, 0);
        assert_eq!(pull.page_limit, 64);
        assert!(
            runtime
                .claim_cloudflare_projection(&mut database, &admission, allow_commit())
                .unwrap()
                .claimed
                .is_none()
        );
    }

    #[test]
    fn revoke_at_final_sync_claim_fence_rolls_back_every_durable_write() {
        let (_directory, mut database) = database("workspace-local");
        seed_sync_mutation(&mut database);
        let runtime = runtime();
        let admission = runtime.begin_sync_run(&database).expect("admit run");
        let entered = Arc::new(Barrier::new(2));
        let released = Arc::new(Barrier::new(2));
        let revoked = Arc::new(AtomicBool::new(false));

        std::thread::scope(|scope| {
            let entered_for_transition = Arc::clone(&entered);
            let released_for_transition = Arc::clone(&released);
            let revoked_for_transition = Arc::clone(&revoked);
            scope.spawn(move || {
                entered_for_transition.wait();
                revoked_for_transition.store(true, AtomicOrdering::Release);
                released_for_transition.wait();
            });

            let entered_for_guard = Arc::clone(&entered);
            let released_for_guard = Arc::clone(&released);
            let revoked_for_guard = Arc::clone(&revoked);
            let result = runtime.sync_claim(
                &mut database,
                &admission,
                DesktopSyncCommitGuard::new(move || {
                    entered_for_guard.wait();
                    released_for_guard.wait();
                    if revoked_for_guard.load(AtomicOrdering::Acquire) {
                        Err(DesktopSyncError::StaleAuthority)
                    } else {
                        Ok(())
                    }
                }),
            );
            assert!(matches!(result, Err(DesktopSyncError::StaleAuthority)));
        });

        let durable = database
            .test_sync_delivery_state("guarded-sync-mutation")
            .expect("read durable claim state");
        assert_eq!(durable, ("pending".to_owned(), 0, None, None));
    }

    #[test]
    fn successful_commit_is_not_downgraded_by_post_commit_revocation() {
        let (_directory, mut database) = database("workspace-local");
        seed_sync_mutation(&mut database);
        let runtime = runtime();
        let admission = runtime.begin_sync_run(&database).expect("admit run");
        let revoked = AtomicBool::new(false);

        let claimed = runtime
            .sync_claim(
                &mut database,
                &admission,
                DesktopSyncCommitGuard::new(|| {
                    revoked.store(true, AtomicOrdering::Release);
                    Ok(())
                }),
            )
            .expect("the committed claim remains successful");

        assert!(revoked.load(AtomicOrdering::Acquire));
        assert_eq!(claimed.claimed.len(), 1);
        let durable = database
            .test_sync_delivery_state("guarded-sync-mutation")
            .expect("read committed claim");
        assert_eq!(durable.0, "sending");
    }

    #[test]
    fn provider_permissions_are_exact_current_and_never_inferred_from_active_or_standby() {
        let (_directory, database) = database("workspace-local");
        let mut runtime = runtime();
        let admitted = runtime.begin_sync_run(&database).unwrap();
        assert!(
            runtime
                .require_provider_capability(&admitted, CLOUDFLARE_DNS_OBSERVE)
                .is_ok()
        );
        assert_eq!(
            runtime.require_provider_capability(&admitted, "afternic:marketplace:observe"),
            Err(DesktopSyncError::Blocked)
        );
        assert_eq!(
            runtime.require_provider_capability(&admitted, SPACESHIP_REGISTRAR_OBSERVE),
            Err(DesktopSyncError::Blocked)
        );
        runtime.provider_capabilities.clear();
        assert_eq!(
            runtime.require_provider_capability(&admitted, CLOUDFLARE_DNS_OBSERVE),
            Err(DesktopSyncError::StaleAuthority)
        );
        assert!(
            DesktopSyncCommitGuard::new(|| Ok(()))
                .verify(&runtime, &admitted)
                .is_err()
        );
        let local_only = runtime.begin_sync_run(&database).unwrap();
        assert!(runtime.recheck_sync_run(&database, &local_only).is_ok());
        assert_eq!(
            runtime.require_provider_capability(&local_only, CLOUDFLARE_DNS_OBSERVE),
            Err(DesktopSyncError::Blocked)
        );
        let _qualified =
            crate::active_workspace::capability_qualification::test_qualification::qualify(
                CLOUDFLARE_DNS_OBSERVE,
            );
        assert_eq!(
            runtime.admit_cloudflare_activation(&database, &local_only, "any"),
            Err(DesktopSyncError::Blocked)
        );
        let standby = DesktopSyncRunAdmission::standby_authority(
            "workspace-local".into(),
            "device-local".into(),
            7,
            0,
            i64::MAX,
            AUTHORITY_DIGEST.into(),
            1,
        );
        assert_eq!(
            runtime.require_provider_capability(&standby, CLOUDFLARE_DNS_OBSERVE),
            Err(DesktopSyncError::StaleAuthority)
        );
    }

    #[test]
    fn spaceship_listing_access_requires_its_own_signed_capability() {
        let (_directory, database) = database("workspace-local");
        let mut runtime = runtime();
        runtime.provider_capabilities = vec![SPACESHIP_REGISTRAR_OBSERVE.to_owned()];
        let registrar = runtime.begin_sync_run(&database).unwrap();
        assert!(
            runtime
                .require_provider_capability(&registrar, SPACESHIP_REGISTRAR_OBSERVE)
                .is_ok()
        );
        assert_eq!(
            runtime.require_provider_capability(&registrar, SPACESHIP_MARKETPLACE_OBSERVE),
            Err(DesktopSyncError::Blocked)
        );

        runtime.provider_capabilities = vec![SPACESHIP_MARKETPLACE_OBSERVE.to_owned()];
        let marketplace = runtime.begin_sync_run(&database).unwrap();
        assert_eq!(
            runtime.require_provider_capability(&registrar, SPACESHIP_REGISTRAR_OBSERVE),
            Err(DesktopSyncError::StaleAuthority)
        );
        assert!(
            runtime
                .require_provider_capability(&marketplace, SPACESHIP_MARKETPLACE_OBSERVE)
                .is_ok()
        );
        for capability in [SPACESHIP_REGISTRAR_OBSERVE, "spaceship:marketplace:write"] {
            assert_eq!(
                runtime.require_provider_capability(&marketplace, capability),
                Err(DesktopSyncError::Blocked)
            );
        }
    }

    #[test]
    fn constructor_rejects_noncanonical_or_expired_authority() {
        assert_eq!(
            DesktopSyncRuntime::new(
                "workspace-local".to_owned(),
                "device-local".to_owned(),
                7,
                1,
                1,
                AUTHORITY_DIGEST.to_ascii_uppercase(),
                1,
                vec![CLOUDFLARE_DNS_OBSERVE.to_owned()],
            )
            .unwrap_err(),
            DesktopSyncError::InvalidInput
        );

        let (_directory, database) = database("workspace-local");
        let expired = DesktopSyncRuntime::new(
            "workspace-local".to_owned(),
            "device-local".to_owned(),
            7,
            0,
            1,
            AUTHORITY_DIGEST.to_owned(),
            1,
            vec![CLOUDFLARE_DNS_OBSERVE.to_owned()],
        )
        .unwrap();
        assert_eq!(
            expired.begin_sync_run(&database).unwrap_err(),
            DesktopSyncError::Blocked
        );
    }

    #[test]
    fn timestamp_is_rfc3339_utc_and_lease_is_checked() {
        assert_eq!(timestamp(0).unwrap(), "1970-01-01T00:00:00Z");
        assert_eq!(
            checked_timestamp(i64::MAX, 1),
            Err(DesktopSyncError::Blocked)
        );
    }
}
