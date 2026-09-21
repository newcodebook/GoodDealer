//! Purpose-specific Native Cloud exchanges owned by the Desktop Local Host.

use std::{fmt, time::Duration};

use serde::de::{DeserializeOwned, Deserializer, Error as _, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::desktop_sync_runtime::DesktopSyncRejectDisposition;
use crate::portfolio_projection::{Money, valid_amount, valid_currency, validate_domain_asset_id};
use crate::{
    ClaimedCloudflareDnsProjection, ClaimedSyncMutation, CloudflareCredentialEnvelopeKind,
    CloudflareCredentialPreparation, CloudflareCredentialWitness,
    CloudflareDnsProjectionAcknowledgement, CloudflareDnsRecordWrite, DesktopLocalHost,
    DesktopLocalHostError, DesktopNativeCloudAdmission, NativeCheckpointDescriptor,
    SyncMutationAcknowledgement, serialize_sync_push_request,
};

const MAX_SYNC_PULL_REQUEST_BYTES: usize = 2 * 1024;
const MAX_PROJECTION_REQUEST_BYTES: usize = 64 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug)]
pub struct DesktopCloudflareCheckedObservation {
    pub entity_id: String,
    pub zone_binding_digest: String,
    pub zone_name_ascii: String,
    pub authoritative_nameservers: Vec<String>,
    pub dnssec_status: String,
    pub availability: String,
    pub zone_status: String,
    pub records: Vec<CloudflareDnsRecordWrite>,
    pub provider_version_token: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopCloudflareEnvelopeKind {
    Absent,
    Active,
    Tombstone,
}

#[derive(Clone)]
pub(crate) struct DesktopCloudflareKeychainPlanData {
    pub(crate) connection_incarnation_id: String,
    pub(crate) connection_digest: String,
    pub(crate) expected_base: CloudflareCredentialWitness,
    pub(crate) target: CloudflareCredentialWitness,
}

pub struct DesktopCloudflareKeychainPlan<'a> {
    data: &'a DesktopCloudflareKeychainPlanData,
}

pub struct DesktopCloudflareRecoveryPlan<'a> {
    data: &'a DesktopCloudflareKeychainPlanData,
}

impl DesktopCloudflareRecoveryPlan<'_> {
    #[must_use]
    pub fn connection_incarnation_id(&self) -> &str {
        &self.data.connection_incarnation_id
    }

    #[must_use]
    pub fn connection_digest(&self) -> &str {
        &self.data.connection_digest
    }

    #[must_use]
    pub fn expected_base_kind(&self) -> DesktopCloudflareEnvelopeKind {
        envelope_kind(self.data.expected_base.kind)
    }

    #[must_use]
    pub fn expected_base_generation(&self) -> Option<u64> {
        self.data.expected_base.generation
    }

    #[must_use]
    pub fn expected_base_scope_digest(&self) -> Option<&str> {
        self.data.expected_base.scope_digest.as_deref()
    }

    #[must_use]
    pub fn expected_base_zone_digest(&self) -> Option<&str> {
        self.data.expected_base.zone_digest.as_deref()
    }

    #[must_use]
    pub fn expected_base_public_proof(&self) -> Option<&str> {
        self.data.expected_base.public_proof.as_deref()
    }

    #[must_use]
    pub fn target_kind(&self) -> DesktopCloudflareEnvelopeKind {
        envelope_kind(self.data.target.kind)
    }

    #[must_use]
    pub fn target_generation(&self) -> u64 {
        self.data.target.generation.unwrap_or(0)
    }

    #[must_use]
    pub fn target_scope_digest(&self) -> &str {
        self.data.target.scope_digest.as_deref().unwrap_or_default()
    }

    #[must_use]
    pub fn target_zone_digest(&self) -> &str {
        self.data.target.zone_digest.as_deref().unwrap_or_default()
    }

    #[must_use]
    pub fn target_public_proof(&self) -> &str {
        self.data.target.public_proof.as_deref().unwrap_or_default()
    }
}

pub struct DesktopCloudflareRecoveryScan {
    pub(crate) admission: DesktopNativeCloudAdmission,
    pub(crate) cursor: Option<(String, String)>,
    pub(crate) scan_nonce: [u8; 16],
}

/// Opaque Host admission for Cloudflare credential activation before any secret capture or
/// Provider request occurs.
pub struct DesktopCloudflareActivationAdmission {
    pub(crate) admission: DesktopNativeCloudAdmission,
    pub(crate) connection_hint: String,
}

impl fmt::Debug for DesktopCloudflareActivationAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopCloudflareActivationAdmission([REDACTED])")
    }
}

impl fmt::Debug for DesktopCloudflareRecoveryScan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopCloudflareRecoveryScan([REDACTED])")
    }
}

pub struct DesktopCloudflareRecoveryHandle {
    pub(crate) scan_nonce: [u8; 16],
    pub(crate) connection_incarnation_id: String,
    pub(crate) intent_id: String,
    pub(crate) plan: DesktopCloudflareKeychainPlanData,
}

impl DesktopCloudflareRecoveryHandle {
    pub fn with_keychain_plan<T>(
        self,
        use_plan: impl FnOnce(DesktopCloudflareRecoveryPlan<'_>, Self) -> T,
    ) -> T {
        let data = self.plan.clone();
        let plan = DesktopCloudflareRecoveryPlan { data: &data };
        use_plan(plan, self)
    }
}

impl fmt::Debug for DesktopCloudflareRecoveryHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopCloudflareRecoveryHandle([REDACTED])")
    }
}

impl DesktopCloudflareKeychainPlan<'_> {
    #[must_use]
    pub fn connection_incarnation_id(&self) -> &str {
        &self.data.connection_incarnation_id
    }

    #[must_use]
    pub fn connection_digest(&self) -> &str {
        &self.data.connection_digest
    }

    #[must_use]
    pub fn expected_base_kind(&self) -> DesktopCloudflareEnvelopeKind {
        envelope_kind(self.data.expected_base.kind)
    }

    #[must_use]
    pub fn expected_base_generation(&self) -> Option<u64> {
        self.data.expected_base.generation
    }

    #[must_use]
    pub fn expected_base_scope_digest(&self) -> Option<&str> {
        self.data.expected_base.scope_digest.as_deref()
    }

    #[must_use]
    pub fn expected_base_zone_digest(&self) -> Option<&str> {
        self.data.expected_base.zone_digest.as_deref()
    }

    #[must_use]
    pub fn expected_base_public_proof(&self) -> Option<&str> {
        self.data.expected_base.public_proof.as_deref()
    }

    #[must_use]
    pub fn target_kind(&self) -> DesktopCloudflareEnvelopeKind {
        envelope_kind(self.data.target.kind)
    }

    #[must_use]
    pub fn target_generation(&self) -> u64 {
        self.data.target.generation.unwrap_or(0)
    }

    #[must_use]
    pub fn target_scope_digest(&self) -> &str {
        self.data.target.scope_digest.as_deref().unwrap_or_default()
    }

    #[must_use]
    pub fn target_zone_digest(&self) -> &str {
        self.data.target.zone_digest.as_deref().unwrap_or_default()
    }

    #[must_use]
    pub fn target_public_proof(&self) -> &str {
        self.data.target.public_proof.as_deref().unwrap_or_default()
    }
}

pub struct PreparedCloudflareProvision {
    pub(crate) admission: DesktopNativeCloudAdmission,
    pub(crate) preparation: CloudflareCredentialPreparation,
    pub(crate) plan: DesktopCloudflareKeychainPlanData,
}

impl fmt::Debug for PreparedCloudflareProvision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PreparedCloudflareProvision([REDACTED])")
    }
}

/// Opaque proof that Host durably entered prewrite inspection and denied credential use.
pub struct InspectingCloudflareProvision {
    pub(crate) admission: DesktopNativeCloudAdmission,
    pub(crate) preparation: CloudflareCredentialPreparation,
    pub(crate) plan: DesktopCloudflareKeychainPlanData,
}

impl fmt::Debug for InspectingCloudflareProvision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("InspectingCloudflareProvision([REDACTED])")
    }
}

impl InspectingCloudflareProvision {
    pub fn with_keychain_plan<T>(
        self,
        use_plan: impl FnOnce(DesktopCloudflareKeychainPlan<'_>, Self) -> T,
    ) -> T {
        let data = self.plan.clone();
        let plan = DesktopCloudflareKeychainPlan { data: &data };
        use_plan(plan, self)
    }
}

pub struct MarkedCloudflareProvision {
    pub(crate) admission: DesktopNativeCloudAdmission,
    pub(crate) preparation: CloudflareCredentialPreparation,
    pub(crate) plan: DesktopCloudflareKeychainPlanData,
}

/// Opaque Host-owned admission for one stored-credential Provider observation.
pub struct PreparedCloudflareObservation {
    pub(crate) admission: DesktopNativeCloudAdmission,
    pub(crate) connection_id: String,
    pub(crate) entity_id: String,
    pub(crate) connection_incarnation_id: String,
    pub(crate) connection_digest: String,
    pub(crate) generation: u64,
    pub(crate) scope_digest: String,
    pub(crate) zone_digest: String,
    pub(crate) public_proof: String,
}

impl fmt::Debug for PreparedCloudflareObservation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PreparedCloudflareObservation([REDACTED])")
    }
}

impl PreparedCloudflareObservation {
    #[must_use]
    pub fn connection_incarnation_id(&self) -> &str {
        &self.connection_incarnation_id
    }

    #[must_use]
    pub fn connection_digest(&self) -> &str {
        &self.connection_digest
    }

    #[must_use]
    pub const fn generation(&self) -> u64 {
        self.generation
    }

    #[must_use]
    pub fn scope_digest(&self) -> &str {
        &self.scope_digest
    }

    #[must_use]
    pub fn zone_digest(&self) -> &str {
        &self.zone_digest
    }

    #[must_use]
    pub fn public_proof(&self) -> &str {
        &self.public_proof
    }
}

impl fmt::Debug for MarkedCloudflareProvision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("MarkedCloudflareProvision([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopCloudflareCustodyComparison {
    ExactTarget,
    ExactBase,
    OtherCanonical,
    MissingOther,
    Malformed,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopCloudflareResolution {
    Confirmed,
    PrewriteRemediated,
    TargetNotObservedBurned,
    TargetPresentAuthorityStaleBurned,
    RecoveryRequired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopCloudflarePrewriteFailure {
    BaseMismatch,
    MissingOther,
    Malformed,
    Unreadable,
}

const fn envelope_kind(kind: CloudflareCredentialEnvelopeKind) -> DesktopCloudflareEnvelopeKind {
    match kind {
        CloudflareCredentialEnvelopeKind::Absent => DesktopCloudflareEnvelopeKind::Absent,
        CloudflareCredentialEnvelopeKind::Active => DesktopCloudflareEnvelopeKind::Active,
        CloudflareCredentialEnvelopeKind::Tombstone => DesktopCloudflareEnvelopeKind::Tombstone,
    }
}

pub struct DesktopSyncPushClaim {
    claimed: Vec<ClaimedSyncMutation>,
    delivery_owner: String,
    request_body: Vec<u8>,
    retry_after: Duration,
}

impl DesktopSyncPushClaim {
    #[must_use]
    pub fn request_body(&self) -> &[u8] {
        &self.request_body
    }

    #[must_use]
    pub const fn retry_after(&self) -> Duration {
        self.retry_after
    }
}

impl fmt::Debug for DesktopSyncPushClaim {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopSyncPushClaim([REDACTED])")
    }
}

pub struct DesktopSyncPullExchange {
    request_body: Vec<u8>,
    expected_workspace_id: String,
    expected_after_revision: u64,
}

impl DesktopSyncPullExchange {
    #[must_use]
    pub fn request_body(&self) -> &[u8] {
        &self.request_body
    }
}

impl fmt::Debug for DesktopSyncPullExchange {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopSyncPullExchange([REDACTED])")
    }
}

pub struct DesktopCheckpointExchange {
    request_body: Vec<u8>,
}

impl DesktopCheckpointExchange {
    #[must_use]
    pub fn request_body(&self) -> &[u8] {
        &self.request_body
    }
}

impl fmt::Debug for DesktopCheckpointExchange {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopCheckpointExchange([REDACTED])")
    }
}

pub struct DesktopCloudflareProjectionClaim {
    claimed: ClaimedCloudflareDnsProjection,
    delivery_owner: String,
    request_body: Vec<u8>,
    retry_after: Duration,
}

impl DesktopCloudflareProjectionClaim {
    #[must_use]
    pub fn request_body(&self) -> &[u8] {
        &self.request_body
    }

    #[must_use]
    pub const fn retry_after(&self) -> Duration {
        self.retry_after
    }
}

pub enum DesktopCloudflareProjectionWork {
    Ready(DesktopCloudflareProjectionClaim),
    Deferred(Duration),
    Empty,
}

pub enum DesktopSyncPushWork {
    Ready(DesktopSyncPushClaim),
    NotDue(Duration),
    Empty,
}

impl fmt::Debug for DesktopSyncPushWork {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ready(_) => formatter.write_str("DesktopSyncPushWork::Ready"),
            Self::NotDue(duration) => formatter
                .debug_tuple("DesktopSyncPushWork::NotDue")
                .field(duration)
                .finish(),
            Self::Empty => formatter.write_str("DesktopSyncPushWork::Empty"),
        }
    }
}

impl fmt::Debug for DesktopCloudflareProjectionWork {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ready(_) => formatter.write_str("DesktopCloudflareProjectionWork::Ready"),
            Self::Deferred(duration) => formatter
                .debug_tuple("DesktopCloudflareProjectionWork::Deferred")
                .field(duration)
                .finish(),
            Self::Empty => formatter.write_str("DesktopCloudflareProjectionWork::Empty"),
        }
    }
}

impl fmt::Debug for DesktopCloudflareProjectionClaim {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopCloudflareProjectionClaim([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopSyncPushDisposition {
    Completed,
    Retryable,
    IsolationRequired,
    DeterministicRejected,
    AuthorizationBlocked,
    SecurityBlocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopSyncPullDisposition {
    Completed,
    Retryable,
    RebootstrapRequired,
    AuthorizationBlocked,
    SecurityBlocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopSyncCheckpointDisposition {
    Completed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopCloudflareProjectionDisposition {
    Completed,
}

impl DesktopLocalHost {
    /// Claims one bounded Push batch under the supplied opaque Native admission.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, validation, or storage error. An empty durable queue returns
    /// `None`.
    pub fn claim_native_sync_push(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopSyncPushWork, DesktopLocalHostError> {
        let schedule = self.sync_claim(&admission.inner)?;
        if schedule.claimed.is_empty() {
            return Ok(schedule
                .retry_after
                .map_or(DesktopSyncPushWork::Empty, DesktopSyncPushWork::NotDue));
        }
        let retry_after = schedule
            .retry_after
            .ok_or(DesktopLocalHostError::StorageRejected)?;
        Self::native_sync_push_claim(
            schedule.claimed,
            crate::desktop_sync_runtime::delivery_owner(&admission.inner),
            retry_after,
        )
        .map(DesktopSyncPushWork::Ready)
    }

    fn native_sync_push_claim(
        claimed: Vec<ClaimedSyncMutation>,
        delivery_owner: String,
        retry_after: Duration,
    ) -> Result<DesktopSyncPushClaim, DesktopLocalHostError> {
        let wire_mutations = claimed
            .iter()
            .map(|mutation| mutation.wire_mutation_json.clone())
            .collect::<Vec<_>>();
        let request_body = serialize_sync_push_request(&wire_mutations)
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        Ok(DesktopSyncPushClaim {
            claimed,
            delivery_owner,
            request_body,
            retry_after,
        })
    }

    /// Splits one deterministically rejected multi-item claim into canonical contiguous halves.
    /// The right half is returned second so the coordinator can process the left half first.
    ///
    /// # Errors
    ///
    /// Returns a protocol error for singleton claims or storage errors when a split cannot be
    /// reconstructed into bounded canonical request wire.
    pub fn split_native_sync_push(
        &self,
        claim: DesktopSyncPushClaim,
    ) -> Result<(DesktopSyncPushClaim, DesktopSyncPushClaim), DesktopLocalHostError> {
        if claim.claimed.len() < 2 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let split = claim.claimed.len() / 2;
        let mut claimed = claim.claimed;
        let right = claimed.split_off(split);
        let left = claimed;
        Ok((
            Self::native_sync_push_claim(left, claim.delivery_owner.clone(), claim.retry_after)?,
            Self::native_sync_push_claim(right, claim.delivery_owner, claim.retry_after)?,
        ))
    }

    /// Durably defers every unresolved fragment from one original Push claim and returns the
    /// exact earliest Host-owned deadline.
    ///
    /// # Errors
    ///
    /// Returns an authority, ownership, or storage error when any fragment no longer matches its
    /// retained owner/fence.
    pub fn defer_native_sync_push(
        &self,
        admission: &DesktopNativeCloudAdmission,
        claims: Vec<DesktopSyncPushClaim>,
    ) -> Result<Duration, DesktopLocalHostError> {
        let mut claims = claims.into_iter();
        let first = claims
            .next()
            .ok_or(DesktopLocalHostError::CloudProtocolRejected)?;
        let delivery_owner = first.delivery_owner;
        let mut mutations = first.claimed;
        for claim in claims {
            if claim.delivery_owner != delivery_owner {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            mutations.extend(claim.claimed);
        }
        self.sync_defer_retryable_with_deadline(&admission.inner, &delivery_owner, &mutations)
    }

    /// Applies a strict Push response against the exact claimed batch.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, protocol-correlation, or storage error. Malformed response wire
    /// never changes the durable claim.
    pub fn complete_native_sync_push(
        &self,
        admission: &DesktopNativeCloudAdmission,
        claim: &DesktopSyncPushClaim,
        response_wire: &[u8],
    ) -> Result<DesktopSyncPushDisposition, DesktopLocalHostError> {
        let response: SyncPushResponseWire = strict_json(response_wire)?;
        match response {
            SyncPushResponseWire::Accepted(response) => {
                validate_push_response(&response, &claim.claimed)?;
                let acknowledgements = response
                    .acknowledgements
                    .into_iter()
                    .zip(&claim.claimed)
                    .map(|(acknowledgement, claimed)| SyncMutationAcknowledgement {
                        mutation_id: acknowledgement.mutation_id,
                        source_device_id: claimed.source_device_id.clone(),
                        active_lease_epoch: claimed.active_lease_epoch,
                        device_mutation_sequence: acknowledgement.device_mutation_sequence,
                        delivery_attempt_fence: claimed.delivery_attempt_fence,
                        wire_mutation_digest: claimed.wire_mutation_digest.clone(),
                        server_revision: acknowledgement.server_revision,
                    })
                    .collect::<Vec<_>>();
                self.sync_acknowledge(&admission.inner, &claim.delivery_owner, &acknowledgements)?;
                Ok(DesktopSyncPushDisposition::Completed)
            }
            SyncPushResponseWire::Rejected(response) => {
                validate_push_rejection(&response)?;
                match response.code.as_str() {
                    "SYNC_STORAGE_REJECTED" => Ok(DesktopSyncPushDisposition::Retryable),
                    "SYNC_INPUT_REJECTED" | "SYNC_SCHEMA_UNSUPPORTED" => {
                        if claim.claimed.len() > 1 {
                            return Ok(DesktopSyncPushDisposition::IsolationRequired);
                        }
                        self.sync_reject(
                            &admission.inner,
                            &claim.delivery_owner,
                            &claim.claimed,
                            DesktopSyncRejectDisposition::Rejected,
                        )?;
                        Ok(DesktopSyncPushDisposition::DeterministicRejected)
                    }
                    "SYNC_IDEMPOTENCY_CONFLICT" => {
                        if claim.claimed.len() > 1 {
                            return Ok(DesktopSyncPushDisposition::IsolationRequired);
                        }
                        self.sync_reject(
                            &admission.inner,
                            &claim.delivery_owner,
                            &claim.claimed,
                            DesktopSyncRejectDisposition::Conflicted,
                        )?;
                        Ok(DesktopSyncPushDisposition::DeterministicRejected)
                    }
                    "SYNC_AUTHORIZATION_REJECTED" | "SYNC_TENANT_UNRESOLVED" => {
                        Ok(DesktopSyncPushDisposition::AuthorizationBlocked)
                    }
                    _ => Ok(DesktopSyncPushDisposition::SecurityBlocked),
                }
            }
        }
    }

    /// Builds the exact Pull request from Host-owned durable cursor state.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error.
    pub fn prepare_native_sync_pull(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopSyncPullExchange, DesktopLocalHostError> {
        let request = self.sync_pull_request(&admission.inner, 256)?;
        let expected_after_revision = request.after_server_revision;
        let request_body =
            serde_json::to_vec(&request).map_err(|_| DesktopLocalHostError::StorageRejected)?;
        if request_body.is_empty() || request_body.len() > MAX_SYNC_PULL_REQUEST_BYTES {
            return Err(DesktopLocalHostError::StorageRejected);
        }
        Ok(DesktopSyncPullExchange {
            request_body,
            expected_workspace_id: admission.workspace_id().to_owned(),
            expected_after_revision,
        })
    }

    /// Applies one strict Pull response or records the fail-closed rebootstrap requirement.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, protocol-correlation, or storage error.
    pub fn complete_native_sync_pull(
        &self,
        admission: &DesktopNativeCloudAdmission,
        exchange: &DesktopSyncPullExchange,
        response_wire: &[u8],
    ) -> Result<DesktopSyncPullDisposition, DesktopLocalHostError> {
        let response: SyncPullResponseWire = strict_json(response_wire)?;
        match response {
            SyncPullResponseWire::Accepted(response) => {
                validate_pull_response(&response, exchange)?;
                let page_json = serde_json::to_string(&response.page)
                    .map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?;
                self.sync_apply_page(&admission.inner, &page_json, &response.confirm_token)?;
                Ok(DesktopSyncPullDisposition::Completed)
            }
            SyncPullResponseWire::Rejected(response) => {
                validate_pull_rejection(&response, &exchange.expected_workspace_id)?;
                match response.code.as_str() {
                    "SYNC_REBOOTSTRAP_REQUIRED" => {
                        if let Some(checkpoint) = response.checkpoint {
                            let descriptor = checkpoint.into_descriptor()?;
                            self.complete_checkpoint(&admission.inner, Some(&descriptor))?;
                        }
                        self.sync_mark_rebootstrap_required(&admission.inner)?;
                        Ok(DesktopSyncPullDisposition::RebootstrapRequired)
                    }
                    "SYNC_STORAGE_REJECTED" | "SYNC_CURSOR_CONFLICT" => {
                        Ok(DesktopSyncPullDisposition::Retryable)
                    }
                    "SYNC_AUTHORIZATION_REJECTED" | "SYNC_TENANT_UNRESOLVED" => {
                        Ok(DesktopSyncPullDisposition::AuthorizationBlocked)
                    }
                    "SYNC_SCHEMA_UNSUPPORTED" | "SYNC_INPUT_REJECTED" => {
                        Ok(DesktopSyncPullDisposition::SecurityBlocked)
                    }
                    _ => Err(DesktopLocalHostError::CloudProtocolRejected),
                }
            }
        }
    }

    /// Reads the Host-owned durable checkpoint-due flag.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error.
    pub fn native_checkpoint_due(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<bool, DesktopLocalHostError> {
        self.checkpoint_due(&admission.inner)
    }

    /// Creates the fixed checkpoint request after the Host reports it due.
    #[must_use]
    pub fn prepare_native_checkpoint() -> DesktopCheckpointExchange {
        DesktopCheckpointExchange {
            request_body: br#"{"schemaVersion":2}"#.to_vec(),
        }
    }

    /// Strictly parses and commits a checkpoint response.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, protocol-correlation, or storage error.
    pub fn complete_native_checkpoint(
        &self,
        admission: &DesktopNativeCloudAdmission,
        _exchange: &DesktopCheckpointExchange,
        response_wire: &[u8],
    ) -> Result<DesktopSyncCheckpointDisposition, DesktopLocalHostError> {
        let response: CheckpointResponseWire = strict_json(response_wire)?;
        if response.schema_version != 2 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let descriptor = response
            .checkpoint
            .map(CheckpointWire::into_descriptor)
            .transpose()?;
        if descriptor
            .as_ref()
            .is_some_and(|value| value.workspace_id != admission.workspace_id())
        {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        self.complete_checkpoint(&admission.inner, descriptor.as_ref())?;
        Ok(DesktopSyncCheckpointDisposition::Completed)
    }

    /// Claims one count-only Cloudflare projection for fixed-origin publication.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error. An empty durable queue returns `None`.
    pub fn claim_native_cloudflare_projection(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopCloudflareProjectionWork, DesktopLocalHostError> {
        let schedule = self.claim_cloudflare_projection(&admission.inner)?;
        let Some(claimed) = schedule.claimed else {
            return Ok(schedule.retry_after.map_or(
                DesktopCloudflareProjectionWork::Empty,
                DesktopCloudflareProjectionWork::Deferred,
            ));
        };
        let retry_after = schedule
            .retry_after
            .ok_or(DesktopLocalHostError::StorageRejected)?;
        let request_body = claimed.projection.projection_json.as_bytes().to_vec();
        if request_body.is_empty() || request_body.len() > MAX_PROJECTION_REQUEST_BYTES {
            return Err(DesktopLocalHostError::StorageRejected);
        }
        Ok(DesktopCloudflareProjectionWork::Ready(
            DesktopCloudflareProjectionClaim {
                claimed,
                delivery_owner: crate::desktop_sync_runtime::delivery_owner(&admission.inner),
                request_body,
                retry_after,
            },
        ))
    }

    /// Applies a strict projection ACK against the exact durable delivery fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, protocol-correlation, or storage error.
    pub fn complete_native_cloudflare_projection(
        &self,
        admission: &DesktopNativeCloudAdmission,
        claim: &DesktopCloudflareProjectionClaim,
        response_wire: &[u8],
    ) -> Result<DesktopCloudflareProjectionDisposition, DesktopLocalHostError> {
        let response: ProjectionResponseWire = strict_json(response_wire)?;
        if response.schema_version != 1
            || !response.accepted
            || response.observation_id != claim.claimed.projection.observation_id
            || response.lease_epoch != claim.claimed.projection.lease_epoch
            || response.source_sequence != claim.claimed.projection.source_sequence
            || response.canonical_request_digest
                != claim.claimed.projection.canonical_request_digest
            || response.observation_sequence == 0
            || response.observation_sequence > MAX_SAFE_INTEGER
            || !matches!(response.disposition.as_str(), "current" | "stale")
        {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        self.acknowledge_cloudflare_projection(
            &admission.inner,
            &claim.delivery_owner,
            &CloudflareDnsProjectionAcknowledgement {
                observation_id: response.observation_id,
                lease_epoch: response.lease_epoch,
                source_sequence: response.source_sequence,
                delivery_attempt_fence: claim.claimed.delivery_attempt_fence,
                canonical_request_digest: response.canonical_request_digest,
                observation_sequence: response.observation_sequence,
                disposition: response.disposition,
            },
        )?;
        Ok(DesktopCloudflareProjectionDisposition::Completed)
    }

    /// Durably defers one exact projection claim after an explicit retryable HTTP response.
    ///
    /// # Errors
    ///
    /// Returns an authority, ownership, or storage error when the durable lease CAS fails.
    pub fn defer_native_cloudflare_projection(
        &self,
        admission: &DesktopNativeCloudAdmission,
        claim: &DesktopCloudflareProjectionClaim,
    ) -> Result<Duration, DesktopLocalHostError> {
        self.defer_cloudflare_projection(&admission.inner, &claim.delivery_owner, &claim.claimed)
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SyncPushResponseWire {
    Accepted(SyncPushAcceptedWire),
    Rejected(SyncRejectedWire),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncPushAcceptedWire {
    schema_version: u8,
    accepted: bool,
    acknowledgements: Vec<SyncAcknowledgementWire>,
    head_server_revision: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncAcknowledgementWire {
    mutation_id: String,
    device_mutation_sequence: u64,
    server_revision: u64,
    duplicate: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncRejectedWire {
    schema_version: u8,
    accepted: bool,
    code: String,
    correlation_id: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SyncPullResponseWire {
    Accepted(SyncPullAcceptedWire),
    Rejected(SyncPullRejectedWire),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncPullAcceptedWire {
    schema_version: u8,
    accepted: bool,
    page: SyncPageWire,
    confirmed_through: u64,
    pending_delivery: PendingDeliveryWire,
    confirm_token: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncPageWire {
    schema_version: u8,
    workspace_id: String,
    from_server_revision_exclusive: u64,
    through_server_revision_inclusive: u64,
    mutations: Vec<SyncMutationWire>,
    returned_through_server_revision: u64,
    #[serde(deserialize_with = "deserialize_nullable")]
    next_cursor: Option<String>,
    page_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncMutationWire {
    schema_version: u8,
    mutation_id: String,
    workspace_id: String,
    workspace_schema_version: u64,
    entity_type: String,
    entity_id: String,
    operation_kind: String,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted_at: Option<String>,
    base_server_revision: u64,
    changed_fields: Vec<SyncChangedFieldWire>,
    source_device_id: String,
    active_lease_epoch: u64,
    device_mutation_sequence: u64,
    server_revision: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncChangedFieldWire {
    field_path: String,
    value: Value,
}

fn deserialize_optional_non_null<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    String::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingDeliveryWire {
    generation: u64,
    from_server_revision_exclusive: u64,
    through_server_revision_inclusive: u64,
    target_server_revision: u64,
    page_digest: String,
    #[serde(deserialize_with = "deserialize_nullable")]
    next_cursor_digest: Option<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    predecessor_confirmation_digest: Option<String>,
    expires_at: String,
}

fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncPullRejectedWire {
    schema_version: u8,
    accepted: bool,
    code: String,
    #[serde(deserialize_with = "deserialize_nullable")]
    checkpoint: Option<CheckpointWire>,
    correlation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckpointResponseWire {
    schema_version: u8,
    #[serde(deserialize_with = "deserialize_nullable")]
    checkpoint: Option<CheckpointWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckpointWire {
    schema_version: u64,
    checkpoint_id: String,
    workspace_id: String,
    workspace_schema_version: u64,
    through_server_revision: u64,
    checkpoint_digest: String,
}

impl CheckpointWire {
    fn validate(&self) -> Result<(), DesktopLocalHostError> {
        validate_identifier(&self.checkpoint_id, 160)?;
        validate_identifier(&self.workspace_id, 160)?;
        validate_digest43(&self.checkpoint_digest)?;
        if self.schema_version != 2
            || self.workspace_schema_version == 0
            || self.workspace_schema_version > MAX_SAFE_INTEGER
            || self.through_server_revision > MAX_SAFE_INTEGER
        {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        Ok(())
    }

    fn into_descriptor(self) -> Result<NativeCheckpointDescriptor, DesktopLocalHostError> {
        self.validate()?;
        Ok(NativeCheckpointDescriptor {
            schema_version: self.schema_version,
            checkpoint_id: self.checkpoint_id,
            workspace_id: self.workspace_id,
            workspace_schema_version: self.workspace_schema_version,
            through_server_revision: self.through_server_revision,
            checkpoint_digest: self.checkpoint_digest,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectionResponseWire {
    schema_version: u8,
    accepted: bool,
    observation_id: String,
    lease_epoch: u64,
    source_sequence: u64,
    canonical_request_digest: String,
    observation_sequence: u64,
    disposition: String,
}

fn validate_push_response(
    response: &SyncPushAcceptedWire,
    claimed: &[ClaimedSyncMutation],
) -> Result<(), DesktopLocalHostError> {
    if response.schema_version != 2
        || !response.accepted
        || response.acknowledgements.len() != claimed.len()
        || response.acknowledgements.len() > 256
        || response.head_server_revision > MAX_SAFE_INTEGER
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    let mut prior_revision = 0;
    for (acknowledgement, expected) in response.acknowledgements.iter().zip(claimed) {
        if acknowledgement.mutation_id != expected.mutation_id
            || acknowledgement.device_mutation_sequence != expected.device_mutation_sequence
            || acknowledgement.server_revision == 0
            || acknowledgement.server_revision > response.head_server_revision
            || acknowledgement.server_revision <= prior_revision
        {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let _ = acknowledgement.duplicate;
        prior_revision = acknowledgement.server_revision;
    }
    Ok(())
}

fn validate_push_rejection(response: &SyncRejectedWire) -> Result<(), DesktopLocalHostError> {
    if response.schema_version != 2
        || response.accepted
        || !matches!(
            response.code.as_str(),
            "SYNC_SCHEMA_UNSUPPORTED"
                | "SYNC_INPUT_REJECTED"
                | "SYNC_AUTHORIZATION_REJECTED"
                | "SYNC_TENANT_UNRESOLVED"
                | "SYNC_IDEMPOTENCY_CONFLICT"
                | "SYNC_STORAGE_REJECTED"
        )
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    validate_identifier(&response.correlation_id, 160)
}

fn validate_pull_rejection(
    response: &SyncPullRejectedWire,
    expected_workspace_id: &str,
) -> Result<(), DesktopLocalHostError> {
    if response.schema_version != 2
        || response.accepted
        || !matches!(
            response.code.as_str(),
            "SYNC_SCHEMA_UNSUPPORTED"
                | "SYNC_INPUT_REJECTED"
                | "SYNC_AUTHORIZATION_REJECTED"
                | "SYNC_TENANT_UNRESOLVED"
                | "SYNC_CURSOR_CONFLICT"
                | "SYNC_REBOOTSTRAP_REQUIRED"
                | "SYNC_STORAGE_REJECTED"
        )
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    validate_identifier(&response.correlation_id, 160)?;
    if let Some(checkpoint) = response.checkpoint.as_ref() {
        checkpoint.validate()?;
        if checkpoint.workspace_id != expected_workspace_id {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
    }
    Ok(())
}

fn validate_pull_response(
    response: &SyncPullAcceptedWire,
    exchange: &DesktopSyncPullExchange,
) -> Result<(), DesktopLocalHostError> {
    let page = &response.page;
    let delivery = &response.pending_delivery;
    if response.schema_version != 2
        || !response.accepted
        || response.confirmed_through != exchange.expected_after_revision
        || response.confirmed_through > MAX_SAFE_INTEGER
        || page.schema_version != 2
        || page.workspace_id != exchange.expected_workspace_id
        || page.from_server_revision_exclusive != exchange.expected_after_revision
        || page.from_server_revision_exclusive > MAX_SAFE_INTEGER
        || page.from_server_revision_exclusive > page.through_server_revision_inclusive
        || page.through_server_revision_inclusive > MAX_SAFE_INTEGER
        || page.returned_through_server_revision < page.from_server_revision_exclusive
        || page.returned_through_server_revision > page.through_server_revision_inclusive
        || page.returned_through_server_revision > MAX_SAFE_INTEGER
        || page.mutations.len() > 256
        || delivery.generation == 0
        || delivery.generation > MAX_SAFE_INTEGER
        || delivery.from_server_revision_exclusive != exchange.expected_after_revision
        || delivery.through_server_revision_inclusive != page.returned_through_server_revision
        || delivery.target_server_revision < delivery.through_server_revision_inclusive
        || delivery.target_server_revision > MAX_SAFE_INTEGER
        || delivery.page_digest != page.page_digest
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    validate_identifier(&page.workspace_id, 160)?;
    validate_digest43(&page.page_digest)?;
    validate_cursor(&response.confirm_token)?;
    validate_timestamp(&delivery.expires_at)?;
    if let Some(digest) = &delivery.predecessor_confirmation_digest {
        validate_digest43(digest)?;
    }
    match (&page.next_cursor, &delivery.next_cursor_digest) {
        (None, None) => {}
        (Some(cursor), Some(digest)) => {
            validate_cursor(cursor)?;
            validate_digest43(digest)?;
            if token_digest(cursor) != *digest {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
        }
        _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
    }
    let mut expected_revision = page
        .from_server_revision_exclusive
        .checked_add(1)
        .ok_or(DesktopLocalHostError::CloudProtocolRejected)?;
    for mutation in &page.mutations {
        validate_sync_mutation(mutation, &page.workspace_id, expected_revision)?;
        expected_revision = expected_revision
            .checked_add(1)
            .ok_or(DesktopLocalHostError::CloudProtocolRejected)?;
    }
    let expected_returned = page
        .mutations
        .last()
        .map_or(page.from_server_revision_exclusive, |mutation| {
            mutation.server_revision
        });
    if page.returned_through_server_revision != expected_returned
        || page.next_cursor.is_none()
            && page.returned_through_server_revision != page.through_server_revision_inclusive
        || page.next_cursor.is_some()
            && page.returned_through_server_revision >= page.through_server_revision_inclusive
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    Ok(())
}

fn validate_sync_mutation(
    mutation: &SyncMutationWire,
    workspace_id: &str,
    expected_revision: u64,
) -> Result<(), DesktopLocalHostError> {
    if mutation.schema_version != 2
        || mutation.workspace_id != workspace_id
        || mutation.workspace_schema_version == 0
        || mutation.workspace_schema_version > MAX_SAFE_INTEGER
        || mutation.entity_type != "domain_asset"
        || mutation.operation_kind != "upsert" && mutation.operation_kind != "delete"
        || mutation.base_server_revision > MAX_SAFE_INTEGER
        || mutation.active_lease_epoch == 0
        || mutation.active_lease_epoch > MAX_SAFE_INTEGER
        || mutation.device_mutation_sequence == 0
        || mutation.device_mutation_sequence > MAX_SAFE_INTEGER
        || mutation.server_revision != expected_revision
        || mutation.server_revision == 0
        || mutation.server_revision > MAX_SAFE_INTEGER
        || mutation.base_server_revision >= mutation.server_revision
        || mutation.changed_fields.len() > 4
        || mutation.operation_kind == "delete"
            && (mutation.deleted_at.is_none() || !mutation.changed_fields.is_empty())
        || mutation.operation_kind == "upsert"
            && (mutation.deleted_at.is_some() || mutation.changed_fields.is_empty())
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    validate_identifier(&mutation.mutation_id, 160)?;
    validate_identifier(&mutation.workspace_id, 160)?;
    validate_identifier(&mutation.source_device_id, 160)?;
    validate_domain_asset_id(&mutation.entity_id)
        .map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?;
    if let Some(deleted_at) = mutation.deleted_at.as_deref() {
        validate_timestamp(deleted_at)?;
    }
    let mut previous = None;
    for field in &mutation.changed_fields {
        if previous.is_some_and(|prior: &str| prior >= field.field_path.as_str()) {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        validate_sync_changed_field(field)?;
        previous = Some(field.field_path.as_str());
    }
    Ok(())
}

fn validate_sync_changed_field(field: &SyncChangedFieldWire) -> Result<(), DesktopLocalHostError> {
    let valid = match field.field_path.as_str() {
        "note" => field.value.is_null() || field.value.as_str().is_some_and(valid_note),
        "portfolioId" => {
            field.value.is_null()
                || field
                    .value
                    .as_str()
                    .is_some_and(|value| validate_identifier(value, 160).is_ok())
        }
        "tags" => field.value.as_array().is_some_and(|values| {
            values.len() <= 128
                && values
                    .iter()
                    .try_fold(None, |previous: Option<&str>, value| {
                        let value = value.as_str()?;
                        if !valid_tag(value)
                            || previous.is_some_and(|prior| prior.as_bytes() >= value.as_bytes())
                        {
                            return None;
                        }
                        Some(Some(value))
                    })
                    .is_some()
        }),
        "targetPrice" => {
            field.value.is_null()
                || serde_json::from_value::<Money>(field.value.clone()).is_ok_and(|money| {
                    valid_currency(&money.currency) && valid_amount(&money.amount)
                })
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(DesktopLocalHostError::CloudProtocolRejected)
    }
}

fn valid_note(value: &str) -> bool {
    value.encode_utf16().count() <= 10_000
        && !value.chars().any(|character| {
            matches!(character as u32, 0x0000..=0x0008 | 0x000b | 0x000c | 0x000e..=0x001f | 0x007f..=0x009f)
                || is_format_character(character)
        })
}

fn valid_tag(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 64
        && value.trim() == value
        && !value
            .chars()
            .any(|character| character.is_control() || is_format_character(character))
}

fn is_format_character(character: char) -> bool {
    matches!(
        character as u32,
        0x00ad
            | 0x0600..=0x0605
            | 0x061c
            | 0x06dd
            | 0x070f
            | 0x0890..=0x0891
            | 0x08e2
            | 0x180e
            | 0x200b..=0x200f
            | 0x202a..=0x202e
            | 0x2060..=0x2064
            | 0x2066..=0x206f
            | 0xfeff
            | 0xfff9..=0xfffb
            | 0x110bd
            | 0x110cd
            | 0x13430..=0x13440
            | 0x1bca0..=0x1bca3
            | 0x1d173..=0x1d17a
            | 0xe0001
            | 0xe0020..=0xe007f
    )
}

fn strict_json<T: DeserializeOwned>(wire: &[u8]) -> Result<T, DesktopLocalHostError> {
    if wire.is_empty() || std::str::from_utf8(wire).is_err() {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    let mut deserializer = serde_json::Deserializer::from_slice(wire);
    let value = NoDuplicateValue::deserialize(&mut deserializer)
        .map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?
        .0;
    deserializer
        .end()
        .map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?;
    serde_json::from_value(value).map_err(|_| DesktopLocalHostError::CloudProtocolRejected)
}

struct NoDuplicateValue(Value);

impl<'de> Deserialize<'de> for NoDuplicateValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(NoDuplicateVisitor)
    }
}

struct NoDuplicateVisitor;

impl<'de> Visitor<'de> for NoDuplicateVisitor {
    type Value = NoDuplicateValue;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value without duplicate object keys")
    }

    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
        Ok(NoDuplicateValue(Value::Bool(value)))
    }

    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
        Ok(NoDuplicateValue(Value::Number(value.into())))
    }

    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
        Ok(NoDuplicateValue(Value::Number(value.into())))
    }

    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .map(NoDuplicateValue)
            .ok_or_else(|| E::custom("invalid number"))
    }

    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
        Ok(NoDuplicateValue(Value::String(value.to_owned())))
    }

    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
        Ok(NoDuplicateValue(Value::String(value)))
    }

    fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(NoDuplicateValue(Value::Null))
    }

    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(NoDuplicateValue(Value::Null))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element::<NoDuplicateValue>()? {
            values.push(value.0);
        }
        Ok(NoDuplicateValue(Value::Array(values)))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut values = Map::new();
        while let Some((key, value)) = map.next_entry::<String, NoDuplicateValue>()? {
            if values.insert(key, value.0).is_some() {
                return Err(A::Error::custom("duplicate object key"));
            }
        }
        Ok(NoDuplicateValue(Value::Object(values)))
    }
}

fn validate_identifier(value: &str, maximum: usize) -> Result<(), DesktopLocalHostError> {
    if value.is_empty()
        || value.len() > maximum
        || value.bytes().any(|byte| !(0x21..=0x7e).contains(&byte))
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    Ok(())
}

fn validate_cursor(value: &str) -> Result<(), DesktopLocalHostError> {
    if value.is_empty()
        || value.len() > 512
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    Ok(())
}

fn validate_digest43(value: &str) -> Result<(), DesktopLocalHostError> {
    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<(), DesktopLocalHostError> {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || !bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7) && *byte == b'-'
                || index == 10 && *byte == b'T'
                || matches!(index, 13 | 16) && *byte == b':'
                || index == 19 && *byte == b'Z'
                || !matches!(index, 4 | 7 | 10 | 13 | 16 | 19) && byte.is_ascii_digit()
        })
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    let number =
        |start: usize, end: usize| -> u32 { value[start..end].parse::<u32>().unwrap_or(u32::MAX) };
    let year = number(0, 4);
    let month = number(5, 7);
    let day = number(8, 10);
    let hour = number(11, 13);
    let minute = number(14, 16);
    let second = number(17, 19);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if day == 0 || day > maximum_day || hour > 23 || minute > 59 || second > 59 {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    Ok(())
}

fn token_digest(value: &str) -> String {
    use base64::Engine as _;

    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::canonical_page_digest;
    use crate::{
        BusinessDatabase, DesktopDomainDetailReadRequest, DomainAssetWrite, LocalDatabaseKey,
    };

    const WORKSPACE_ID: &str = "workspace-local";

    fn host(database: BusinessDatabase, directory: &tempfile::TempDir) -> DesktopLocalHost {
        DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            WORKSPACE_ID,
            "device-local",
        )
        .expect("construct development Host")
    }

    fn empty_host() -> (tempfile::TempDir, DesktopLocalHost) {
        let directory = tempfile::tempdir().expect("temporary Host directory");
        let database = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &LocalDatabaseKey::from_bytes([0x6a; 32]),
            WORKSPACE_ID,
        )
        .expect("open test database");
        let local_host = host(database, &directory);
        (directory, local_host)
    }

    fn business_generation(host: &DesktopLocalHost) -> u64 {
        serde_json::to_value(host.business_status())
            .expect("serialize business status")["readGeneration"]
            .as_u64()
            .expect("read generation")
    }

    fn push_host() -> (tempfile::TempDir, DesktopLocalHost) {
        push_host_with_mutations(1)
    }

    fn push_host_with_mutations(count: u8) -> (tempfile::TempDir, DesktopLocalHost) {
        let directory = tempfile::tempdir().expect("temporary Host directory");
        let mut database = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &LocalDatabaseKey::from_bytes([0x6b; 32]),
            WORKSPACE_ID,
        )
        .expect("open test database");
        let initial = DomainAssetWrite {
            entity_id: "adapter.test".to_owned(),
            note: None,
            portfolio_id: None,
            tags: vec!["initial".to_owned()],
            target_price: None,
        };
        database
            .upsert_domain_asset("seed-adapter", "2026-09-16T00:00:00Z", &initial)
            .expect("seed asset");
        database
            .acknowledge_sync_mutation("seed-adapter", 1, "2026-09-16T00:00:01Z")
            .expect("acknowledge seed");
        for index in 0..count {
            let version = database
                .read_domain_detail("adapter.test")
                .expect("read seed")
                .asset
                .asset_version;
            database
                .edit_domain_asset(
                    &format!("adapter-mutation-{index}"),
                    version,
                    "device-local",
                    1,
                    &format!("2026-09-16T00:01:{index:02}Z"),
                    &DomainAssetWrite {
                        note: Some(format!("changed-{index}")),
                        ..initial.clone()
                    },
                    true,
                )
                .expect("create pending v2 mutation");
        }
        let local_host = host(database, &directory);
        (directory, local_host)
    }

    fn accepted_push_wire(claim: &DesktopSyncPushClaim) -> Vec<u8> {
        let request: Value = serde_json::from_slice(claim.request_body()).expect("push request");
        let mutation = &request["mutations"][0];
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 2,
            "accepted": true,
            "acknowledgements": [{
                "mutationId": mutation["mutationId"],
                "deviceMutationSequence": mutation["deviceMutationSequence"],
                "serverRevision": 2,
                "duplicate": false,
            }],
            "headServerRevision": 2,
        }))
        .expect("encode push response")
    }

    fn ready_push(work: DesktopSyncPushWork) -> DesktopSyncPushClaim {
        match work {
            DesktopSyncPushWork::Ready(claim) => claim,
            DesktopSyncPushWork::NotDue(_) | DesktopSyncPushWork::Empty => {
                panic!("expected ready Push work")
            }
        }
    }

    #[test]
    fn push_completion_is_exact_and_protocol_failure_preserves_the_claim() {
        let (_directory, local_host) = push_host();
        assert_eq!(business_generation(&local_host), 0);
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let claim = ready_push(
            local_host
                .claim_native_sync_push(&admission)
                .expect("claim mutation"),
        );
        let malformed = br#"{"schemaVersion":2,"accepted":true,"acknowledgements":[{"mutationId":"substituted","deviceMutationSequence":2,"serverRevision":2,"duplicate":false}],"headServerRevision":2}"#;
        assert_eq!(
            local_host.complete_native_sync_push(&admission, &claim, malformed),
            Err(DesktopLocalHostError::CloudProtocolRejected)
        );
        assert_eq!(business_generation(&local_host), 0);
        assert_eq!(
            local_host.complete_native_sync_push(&admission, &claim, &accepted_push_wire(&claim)),
            Ok(DesktopSyncPushDisposition::Completed)
        );
        assert_eq!(business_generation(&local_host), 1);
        assert_eq!(
            local_host.complete_native_sync_push(&admission, &claim, &accepted_push_wire(&claim)),
            Ok(DesktopSyncPushDisposition::Completed)
        );
        assert_eq!(business_generation(&local_host), 1);
        assert!(matches!(
            local_host
                .claim_native_sync_push(&admission)
                .expect("inspect drained queue"),
            DesktopSyncPushWork::Empty
        ));
    }

    #[test]
    fn push_retryable_rejection_durably_defers_the_exact_claim() {
        let (_directory, local_host) = push_host();
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let claim = ready_push(
            local_host
                .claim_native_sync_push(&admission)
                .expect("claim mutation"),
        );
        assert_eq!(
            local_host.complete_native_sync_push(
                &admission,
                &claim,
                br#"{"schemaVersion":2,"accepted":false,"code":"SYNC_STORAGE_REJECTED","correlationId":"correlation-1"}"#,
            ),
            Ok(DesktopSyncPushDisposition::Retryable)
        );
        assert_eq!(business_generation(&local_host), 0);
        let fresh = local_host
            .begin_native_cloud_run()
            .expect("fresh defer admission");
        let retry_after = local_host
            .defer_native_sync_push(&fresh, vec![claim])
            .expect("defer exact claim");
        assert!(!retry_after.is_zero());
        assert!(matches!(
            local_host
                .claim_native_sync_push(&fresh)
                .expect("retry is not immediately due"),
            DesktopSyncPushWork::NotDue(_)
        ));
    }

    #[test]
    fn deterministic_push_rejection_advances_the_visible_generation_once() {
        let (_directory, local_host) = push_host();
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let claim = ready_push(
            local_host
                .claim_native_sync_push(&admission)
                .expect("claim mutation"),
        );
        let response = br#"{"schemaVersion":2,"accepted":false,"code":"SYNC_INPUT_REJECTED","correlationId":"deterministic-1"}"#;

        assert_eq!(
            local_host.complete_native_sync_push(&admission, &claim, response),
            Ok(DesktopSyncPushDisposition::DeterministicRejected)
        );
        assert_eq!(business_generation(&local_host), 1);
    }

    #[test]
    fn child_retryable_defers_every_unresolved_fragment_in_one_exact_cas() {
        let (_directory, local_host) = push_host_with_mutations(4);
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let original = ready_push(
            local_host
                .claim_native_sync_push(&admission)
                .expect("claim batch"),
        );
        let (left, right) = local_host
            .split_native_sync_push(original)
            .expect("split rejected parent");
        assert_eq!(
            local_host.complete_native_sync_push(
                &admission,
                &left,
                br#"{"schemaVersion":2,"accepted":false,"code":"SYNC_STORAGE_REJECTED","correlationId":"child-retry"}"#,
            ),
            Ok(DesktopSyncPushDisposition::Retryable)
        );
        let fresh = local_host
            .begin_native_cloud_run()
            .expect("fresh defer admission");
        let retry_after = local_host
            .defer_native_sync_push(&fresh, vec![left, right])
            .expect("atomically defer current child and queued sibling");
        assert!(!retry_after.is_zero());
        assert!(matches!(
            local_host
                .claim_native_sync_push(&fresh)
                .expect("head remains durably deferred"),
            DesktopSyncPushWork::NotDue(_)
        ));
    }

    #[test]
    fn stale_defer_admission_leaves_every_unresolved_fragment_leased() {
        let (_directory, local_host) = push_host_with_mutations(4);
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let original = ready_push(
            local_host
                .claim_native_sync_push(&admission)
                .expect("claim batch"),
        );
        let (left, right) = local_host
            .split_native_sync_push(original)
            .expect("split claimed batch");
        local_host
            .publish_transition_at_next_business_commit_for_test()
            .expect("schedule stale-authority transition");
        assert_eq!(
            local_host.defer_native_sync_push(&admission, vec![left, right]),
            Err(DesktopLocalHostError::AuthorityRejected)
        );
    }

    fn pull_response(page: &Value) -> Vec<u8> {
        let page_digest = page["pageDigest"].clone();
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 2,
            "accepted": true,
            "page": page,
            "confirmedThrough": 0,
            "pendingDelivery": {
                "generation": 1,
                "fromServerRevisionExclusive": 0,
                "throughServerRevisionInclusive": 1,
                "targetServerRevision": 1,
                "pageDigest": page_digest,
                "nextCursorDigest": null,
                "predecessorConfirmationDigest": null,
                "expiresAt": "2026-09-16T00:01:00Z"
            },
            "confirmToken": "confirm_1"
        }))
        .expect("encode pull response")
    }

    #[test]
    fn pull_completion_correlates_delivery_and_applies_the_exact_page() {
        let (_directory, local_host) = empty_host();
        assert_eq!(business_generation(&local_host), 0);
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let exchange = local_host
            .prepare_native_sync_pull(&admission)
            .expect("prepare pull");
        let mut page = serde_json::json!({
            "schemaVersion": 2,
            "workspaceId": WORKSPACE_ID,
            "fromServerRevisionExclusive": 0,
            "throughServerRevisionInclusive": 1,
            "mutations": [{
                "schemaVersion": 2,
                "mutationId": "remote-1",
                "workspaceId": WORKSPACE_ID,
                "workspaceSchemaVersion": 1,
                "entityType": "domain_asset",
                "entityId": "remote.test",
                "operationKind": "upsert",
                "baseServerRevision": 0,
                "changedFields": [{"fieldPath": "note", "value": "remote"}],
                "sourceDeviceId": "cloud-device",
                "activeLeaseEpoch": 1,
                "deviceMutationSequence": 1,
                "serverRevision": 1
            }],
            "returnedThroughServerRevision": 1,
            "nextCursor": null,
            "pageDigest": "A".repeat(43)
        });
        page["pageDigest"] = Value::String(canonical_page_digest(&page).expect("page digest"));
        assert_eq!(
            local_host.complete_native_sync_pull(&admission, &exchange, &pull_response(&page)),
            Ok(DesktopSyncPullDisposition::Completed)
        );
        assert_eq!(business_generation(&local_host), 1);
        assert_eq!(
            local_host.complete_native_sync_pull(&admission, &exchange, &pull_response(&page)),
            Ok(DesktopSyncPullDisposition::Completed)
        );
        assert_eq!(business_generation(&local_host), 1);
        let request: DesktopDomainDetailReadRequest =
            serde_json::from_value(serde_json::json!({"entityId": "remote.test"}))
                .expect("detail request");
        assert_eq!(
            local_host
                .read_domain_detail(request)
                .expect("read applied page")
                .asset
                .note
                .as_deref(),
            Some("remote")
        );
    }

    #[test]
    fn first_empty_pull_advances_visible_generation_but_exact_replay_does_not() {
        let (_directory, local_host) = empty_host();
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let exchange = local_host
            .prepare_native_sync_pull(&admission)
            .expect("prepare pull");
        let mut page = serde_json::json!({
            "schemaVersion": 2,
            "workspaceId": WORKSPACE_ID,
            "fromServerRevisionExclusive": 0,
            "throughServerRevisionInclusive": 0,
            "mutations": [],
            "returnedThroughServerRevision": 0,
            "nextCursor": null,
            "pageDigest": "A".repeat(43)
        });
        page["pageDigest"] =
            Value::String(canonical_page_digest(&page).expect("empty page digest"));
        let page_digest = page["pageDigest"].clone();
        let response = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 2,
            "accepted": true,
            "page": page,
            "confirmedThrough": 0,
            "pendingDelivery": {
                "generation": 1,
                "fromServerRevisionExclusive": 0,
                "throughServerRevisionInclusive": 0,
                "targetServerRevision": 0,
                "pageDigest": page_digest,
                "nextCursorDigest": null,
                "predecessorConfirmationDigest": null,
                "expiresAt": "2026-09-16T00:01:00Z"
            },
            "confirmToken": "confirm-empty"
        }))
        .expect("encode empty pull response");

        assert_eq!(business_generation(&local_host), 0);
        assert_eq!(
            local_host.complete_native_sync_pull(&admission, &exchange, &response),
            Ok(DesktopSyncPullDisposition::Completed)
        );
        assert_eq!(business_generation(&local_host), 1);
        assert_eq!(
            local_host.complete_native_sync_pull(&admission, &exchange, &response),
            Ok(DesktopSyncPullDisposition::Completed)
        );
        assert_eq!(business_generation(&local_host), 1);
    }

    #[test]
    fn checkpoint_and_rebootstrap_responses_preserve_durable_due_semantics() {
        let (_directory, local_host) = empty_host();
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        assert_eq!(local_host.native_checkpoint_due(&admission), Ok(true));
        let exchange = DesktopLocalHost::prepare_native_checkpoint();
        let checkpoint = serde_json::json!({
            "schemaVersion": 2,
            "checkpointId": "checkpoint-1",
            "workspaceId": WORKSPACE_ID,
            "workspaceSchemaVersion": 1,
            "throughServerRevision": 0,
            "checkpointDigest": "A".repeat(43)
        });
        let response = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 2,
            "checkpoint": checkpoint
        }))
        .expect("checkpoint response");
        assert_eq!(
            local_host.complete_native_checkpoint(&admission, &exchange, &response),
            Ok(DesktopSyncCheckpointDisposition::Completed)
        );
        assert_eq!(business_generation(&local_host), 0);
        assert_eq!(local_host.native_checkpoint_due(&admission), Ok(false));

        let (_other_directory, other_host) = empty_host();
        let other_admission = other_host
            .begin_native_cloud_run()
            .expect("admit other run");
        let pull = other_host
            .prepare_native_sync_pull(&other_admission)
            .expect("prepare pull");
        let response = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 2,
            "accepted": false,
            "code": "SYNC_REBOOTSTRAP_REQUIRED",
            "checkpoint": checkpoint,
            "correlationId": "correlation-2"
        }))
        .expect("rebootstrap response");
        assert_eq!(
            other_host.complete_native_sync_pull(&other_admission, &pull, &response),
            Ok(DesktopSyncPullDisposition::RebootstrapRequired)
        );
        assert_eq!(business_generation(&other_host), 1);
        assert_eq!(
            other_host.complete_native_sync_pull(&other_admission, &pull, &response),
            Ok(DesktopSyncPullDisposition::RebootstrapRequired)
        );
        assert_eq!(business_generation(&other_host), 1);
        assert_eq!(other_host.native_checkpoint_due(&other_admission), Ok(true));
    }

    #[test]
    fn projection_acknowledgement_is_exactly_correlated() {
        let directory = tempfile::tempdir().expect("temporary Host directory");
        let mut database = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &LocalDatabaseKey::from_bytes([0x6c; 32]),
            WORKSPACE_ID,
        )
        .expect("open test database");
        database
            .seed_cloudflare_projection_for_test()
            .expect("seed projection");
        let local_host = host(database, &directory);
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let DesktopCloudflareProjectionWork::Ready(claim) = local_host
            .claim_native_cloudflare_projection(&admission)
            .expect("claim projection")
        else {
            panic!("expected pending projection");
        };
        let retry_admission = local_host.begin_native_cloud_run().expect("admit retry");
        let DesktopCloudflareProjectionWork::Deferred(retry_after) = local_host
            .claim_native_cloudflare_projection(&retry_admission)
            .expect("read durable lease deadline")
        else {
            panic!("expected durable projection deferral");
        };
        assert!(!retry_after.is_zero());
        let request: Value =
            serde_json::from_slice(claim.request_body()).expect("projection request");
        let response = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1,
            "accepted": true,
            "observationId": request["observationId"],
            "leaseEpoch": request["leaseEpoch"],
            "sourceSequence": request["sourceSequence"],
            "canonicalRequestDigest": claim.claimed.projection.canonical_request_digest,
            "observationSequence": 1,
            "disposition": "current"
        }))
        .expect("projection response");
        assert_eq!(
            local_host.complete_native_cloudflare_projection(&admission, &claim, &response),
            Ok(DesktopCloudflareProjectionDisposition::Completed)
        );
        assert!(
            local_host
                .pending_cloudflare_projections(&admission.inner, 10)
                .expect("inspect projections")
                .is_empty()
        );
    }

    #[test]
    fn final_host_commit_fence_rolls_back_response_effects() {
        let (_directory, local_host) = push_host();
        let admission = local_host.begin_native_cloud_run().expect("admit run");
        let claim = ready_push(
            local_host
                .claim_native_sync_push(&admission)
                .expect("claim mutation"),
        );
        local_host
            .publish_transition_at_next_business_commit_for_test()
            .expect("schedule transition");
        assert_eq!(
            local_host.complete_native_sync_push(&admission, &claim, &accepted_push_wire(&claim)),
            Err(DesktopLocalHostError::AuthorityRejected)
        );
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Corpus {
        correlation: CorpusCorrelation,
        valid: Vec<CorpusCase>,
        invalid: Vec<CorpusCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CorpusCorrelation {
        workspace_id: String,
        push: Vec<CorpusMutation>,
        pull_after_server_revision: u64,
        projection: CorpusProjection,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CorpusMutation {
        mutation_id: String,
        device_mutation_sequence: u64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CorpusProjection {
        observation_id: String,
        lease_epoch: u64,
        source_sequence: u64,
        canonical_request_digest: String,
    }

    #[derive(Deserialize)]
    struct CorpusCase {
        name: String,
        kind: String,
        wire: String,
    }

    fn corpus_accepts_push(test_case: &CorpusCase, correlation: &CorpusCorrelation) -> bool {
        let Ok(response) = strict_json::<SyncPushResponseWire>(test_case.wire.as_bytes()) else {
            return false;
        };
        match response {
            SyncPushResponseWire::Accepted(response) => {
                let claimed = correlation
                    .push
                    .iter()
                    .map(|mutation| ClaimedSyncMutation {
                        mutation_id: mutation.mutation_id.clone(),
                        source_device_id: "device-a".to_owned(),
                        active_lease_epoch: 1,
                        device_mutation_sequence: mutation.device_mutation_sequence,
                        delivery_attempt_fence: 1,
                        wire_mutation_digest: "a".repeat(64),
                        wire_mutation_json: "{}".to_owned(),
                    })
                    .collect::<Vec<_>>();
                validate_push_response(&response, &claimed).is_ok()
            }
            SyncPushResponseWire::Rejected(response) => validate_push_rejection(&response).is_ok(),
        }
    }

    fn corpus_accepts_pull(test_case: &CorpusCase, correlation: &CorpusCorrelation) -> bool {
        let Ok(response) = strict_json::<SyncPullResponseWire>(test_case.wire.as_bytes()) else {
            return false;
        };
        let exchange = DesktopSyncPullExchange {
            request_body: Vec::new(),
            expected_workspace_id: correlation.workspace_id.clone(),
            expected_after_revision: correlation.pull_after_server_revision,
        };
        match response {
            SyncPullResponseWire::Accepted(response) => {
                validate_pull_response(&response, &exchange).is_ok()
            }
            SyncPullResponseWire::Rejected(response) => {
                validate_pull_rejection(&response, &correlation.workspace_id).is_ok()
            }
        }
    }

    fn corpus_accepts(test_case: &CorpusCase, correlation: &CorpusCorrelation) -> bool {
        match test_case.kind.as_str() {
            "push-response" => corpus_accepts_push(test_case, correlation),
            "pull-response" => corpus_accepts_pull(test_case, correlation),
            "checkpoint-response" => {
                strict_json::<CheckpointResponseWire>(test_case.wire.as_bytes())
                    .ok()
                    .is_some_and(|response| {
                        response.schema_version == 2
                            && response.checkpoint.as_ref().is_none_or(|checkpoint| {
                                checkpoint.validate().is_ok()
                                    && checkpoint.workspace_id == correlation.workspace_id
                            })
                    })
            }
            "projection-response" => {
                let Ok(response) = strict_json::<ProjectionResponseWire>(test_case.wire.as_bytes())
                else {
                    return false;
                };
                response.schema_version == 1
                    && response.accepted
                    && response.observation_id == correlation.projection.observation_id
                    && response.lease_epoch == correlation.projection.lease_epoch
                    && response.source_sequence == correlation.projection.source_sequence
                    && response.canonical_request_digest
                        == correlation.projection.canonical_request_digest
                    && response.observation_sequence > 0
                    && response.observation_sequence <= MAX_SAFE_INTEGER
                    && matches!(response.disposition.as_str(), "current" | "stale")
            }
            _ => false,
        }
    }

    #[test]
    fn host_parser_matches_the_checked_in_native_cloud_corpus() {
        let corpus: Corpus = serde_json::from_str(include_str!(
            "../../../packages/protocol/test-vectors/native-cloud/wire-corpus.json"
        ))
        .expect("parse corpus");
        for test_case in &corpus.valid {
            assert!(
                corpus_accepts(test_case, &corpus.correlation),
                "valid case rejected: {}",
                test_case.name
            );
        }
        for test_case in &corpus.invalid {
            assert!(
                !corpus_accepts(test_case, &corpus.correlation),
                "invalid case accepted: {}",
                test_case.name
            );
        }
    }
}
