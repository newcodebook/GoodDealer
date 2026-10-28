//! Host-owned Desktop synchronization and Provider database-stage runtime.
//!
//! This module deliberately keeps the authority snapshot and delivery owner opaque.  The
//! caller receives an admission handle, not the workspace/device identity, clock, lease, or
//! generation used to perform the operation.  `DesktopLocalHost` can embed this runtime and
//! expose the methods as its native boundary without widening the IPC contract.

use std::fmt::{self, Write as _};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::active_workspace::business::SyncProjectionEffect;
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
}

impl fmt::Display for DesktopSyncError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Blocked => "SYNC_BLOCKED",
            Self::StaleAuthority => "SYNC_STALE_AUTHORITY",
            Self::StorageRejected => "SYNC_STORAGE_REJECTED",
            Self::InvalidInput => "SYNC_INPUT_REJECTED",
            Self::AcknowledgementMismatch => "SYNC_ACKNOWLEDGEMENT_MISMATCH",
        })
    }
}

impl std::error::Error for DesktopSyncError {}

/// Terminal disposition selected by the trusted sync coordinator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopSyncRejectDisposition {
    Rejected,
    Conflicted,
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
    runtime_nonce: [u8; 16],
    run_sequence: u64,
    workspace_id: String,
    device_id: String,
    lease_epoch: u64,
    pub(crate) trusted_time_floor: i64,
    pub(crate) execute_before: i64,
    authority_snapshot_digest: String,
    pub(crate) authority_epoch: u64,
}

/// Opaque Native-only admission. It cannot be cloned, serialized, deserialized, constructed, or
/// inspected by a dependent crate; callers may only return it to `DesktopLocalHost` methods.
pub struct DesktopNativeCloudAdmission {
    pub(crate) inner: DesktopSyncRunAdmission,
}

impl DesktopNativeCloudAdmission {
    pub(crate) fn workspace_id(&self) -> &str {
        &self.inner.workspace_id
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

    fn verify(
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
    next_run_sequence: AtomicU64,
}

impl fmt::Debug for DesktopSyncRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopSyncRuntime([REDACTED])")
    }
}

impl DesktopSyncRuntime {
    pub(crate) fn admit_cloudflare_activation(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
    ) -> Result<(), DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
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
        let connection_digest = domain_digest(
            b"gooddealer/cloudflare-connection/v1\0",
            &[
                admission.workspace_id.as_bytes(),
                seed.connection_incarnation_id.as_bytes(),
            ],
        );
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
        let credential = database
            .cloudflare_connection_observation_admission(connection_hint)
            .map_err(map_database_error)?;
        let seed = database
            .cloudflare_provision_seed(connection_hint)
            .map_err(map_database_error)?;
        if seed.expected_base.kind != CloudflareCredentialEnvelopeKind::Active
            || seed.expected_base.generation != Some(credential.generation)
            || seed.expected_base.scope_digest.as_deref() != Some(&credential.scope_digest)
            || seed.expected_base.zone_digest.as_deref() != Some(&credential.zone_digest)
            || seed.expected_base.public_proof.as_deref() != Some(&credential.public_proof)
        {
            return Err(DesktopSyncError::StorageRejected);
        }
        Ok(PreparedCloudflareObservationData {
            connection_id: connection_hint.to_owned(),
            entity_id: entity_hint.to_owned(),
            connection_digest: domain_digest(
                b"gooddealer/cloudflare-connection/v1\0",
                &[
                    admission.workspace_id.as_bytes(),
                    seed.connection_incarnation_id.as_bytes(),
                ],
            ),
            connection_incarnation_id: seed.connection_incarnation_id,
            generation: credential.generation,
            scope_digest: credential.scope_digest,
            zone_digest: credential.zone_digest,
            public_proof: credential.public_proof,
        })
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

    pub(crate) fn prepare_cloudflare_provision(
        &self,
        database: &mut BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
        connection_hint: &str,
        observation: &crate::desktop_native_cloud::DesktopCloudflareCheckedObservation,
        commit_guard: DesktopSyncCommitGuard<'_>,
    ) -> Result<PreparedCloudflareProvisionData, DesktopSyncError> {
        self.recheck_sync_run(database, admission)?;
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
        let connection_digest = domain_digest(
            b"gooddealer/cloudflare-connection/v1\0",
            &[
                admission.workspace_id.as_bytes(),
                seed.connection_incarnation_id.as_bytes(),
            ],
        );
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
    ) -> Result<Self, DesktopSyncError> {
        if !valid_identifier(&workspace_id)
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
            next_run_sequence: AtomicU64::new(0),
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
            runtime_nonce: self.runtime_nonce,
            run_sequence,
            workspace_id: self.workspace_id.clone(),
            device_id: self.device_id.clone(),
            lease_epoch: self.lease_epoch,
            trusted_time_floor: self.trusted_time_floor,
            execute_before: self.execute_before,
            authority_snapshot_digest: self.authority_snapshot_digest.clone(),
            authority_epoch: self.authority_epoch,
        })
    }

    pub(crate) fn recheck_sync_run(
        &self,
        database: &BusinessDatabase,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<(), DesktopSyncError> {
        let now = trusted_now()?;
        if admission.runtime_nonce != self.runtime_nonce
            || database.workspace_id() != self.workspace_id
            || admission.workspace_id != self.workspace_id
            || admission.device_id != self.device_id
            || admission.lease_epoch != self.lease_epoch
            || admission.trusted_time_floor != self.trusted_time_floor
            || admission.execute_before != self.execute_before
            || admission.authority_snapshot_digest != self.authority_snapshot_digest
            || admission.authority_epoch != self.authority_epoch
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
                &owner(admission),
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
                matches!(
                    rejection.disposition,
                    DesktopSyncRejectDisposition::Conflicted
                ),
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
            .claim_cloudflare_dns_projections_guarded(&owner(admission), &now, &expires, 1, || {
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

pub(crate) fn delivery_owner(admission: &DesktopSyncRunAdmission) -> String {
    owner(admission)
}

fn owner(admission: &DesktopSyncRunAdmission) -> String {
    let nonce =
        admission.runtime_nonce[..8]
            .iter()
            .fold(String::with_capacity(16), |mut output, byte| {
                use std::fmt::Write as _;
                write!(&mut output, "{byte:02x}").expect("writing to a String cannot fail");
                output
            });
    format!("desktop-sync-{nonce}-{}", admission.run_sequence)
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
    if admission.runtime_nonce != runtime.runtime_nonce
        || admission.workspace_id != runtime.workspace_id
        || admission.device_id != runtime.device_id
        || admission.lease_epoch != runtime.lease_epoch
        || admission.trusted_time_floor != runtime.trusted_time_floor
        || admission.execute_before != runtime.execute_before
        || admission.authority_snapshot_digest != runtime.authority_snapshot_digest
        || admission.authority_epoch != runtime.authority_epoch
        || now < admission.trusted_time_floor
        || now >= admission.execute_before
    {
        return Err(DesktopSyncError::StaleAuthority);
    }
    Ok(())
}

fn trusted_now() -> Result<i64, DesktopSyncError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DesktopSyncError::Blocked)
        .and_then(|duration| {
            i64::try_from(duration.as_secs()).map_err(|_| DesktopSyncError::Blocked)
        })
}

fn timestamp(seconds: i64) -> Result<String, DesktopSyncError> {
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

fn random_uuid_v4() -> Result<String, DesktopSyncError> {
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
        | BusinessDatabaseError::SecretInSyncPayload
        | BusinessDatabaseError::SequenceExhausted
        | BusinessDatabaseError::ProviderBindingUnavailable => DesktopSyncError::InvalidInput,
        BusinessDatabaseError::StorageRejected => DesktopSyncError::StorageRejected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc, Barrier,
        atomic::{AtomicBool, Ordering as AtomicOrdering},
    };

    use crate::{DomainAssetWrite, LocalDatabaseKey};

    const AUTHORITY_DIGEST: &str =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn database(workspace_id: &str) -> (tempfile::TempDir, BusinessDatabase) {
        let directory = tempfile::tempdir().expect("temporary database directory");
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
        assert_eq!(pull.schema_version, 2);
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
