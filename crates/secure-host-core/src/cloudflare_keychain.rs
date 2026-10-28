//! Purpose-isolated Cloudflare credential envelope and generation CAS.

use std::fmt::{self, Write as _};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::cloudflare_capture::CloudflareCandidate;

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.gooddealer.desktop.cloudflare.dns.v1";
#[cfg(target_os = "macos")]
const LOCK_DIRECTORY_PREFIX: &str = "app.gooddealer.desktop.cloudflare-dns-keychain-cas-v1";
#[cfg(any(target_os = "macos", test))]
const MAX_ENVELOPE_BYTES: usize = 2_048;
#[cfg(target_os = "macos")]
const WHEN_UNLOCKED_THIS_DEVICE_ONLY_PROTECTION_DOMAIN: &str = "aku";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudflareKeychainError {
    AuthorityStale,
    Unavailable,
    Malformed,
    BindingMismatch,
    StaleGeneration,
    StateUnknown,
}

/// Host authority/deadline callback used to fence cross-process credential publication.
pub type CloudflareKeychainGuard<'a> = dyn FnMut() -> Result<(), CloudflareKeychainError> + 'a;
impl fmt::Display for CloudflareKeychainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::AuthorityStale => "authority_stale",
            Self::Unavailable => "keychain_unavailable",
            Self::Malformed => "credential_invalid",
            Self::BindingMismatch => "credential_binding_mismatch",
            Self::StaleGeneration => "stale_generation",
            Self::StateUnknown => "credential_state_unknown",
        })
    }
}
impl std::error::Error for CloudflareKeychainError {}

pub(crate) struct CloudflareCredentialEnvelope {
    schema_version: u8,
    provider_kind: String,
    capability: String,
    connection_incarnation: String,
    connection_digest: String,
    scope_digest: String,
    zone_digest: String,
    public_proof: String,
    zone_id: String,
    generation: u64,
    state: CloudflareCredentialState,
    token: Option<Zeroizing<String>>,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeWireRef<'a> {
    schema_version: u8,
    provider_kind: &'a str,
    capability: &'a str,
    connection_incarnation: &'a str,
    connection_digest: &'a str,
    scope_digest: &'a str,
    zone_digest: &'a str,
    public_proof: &'a str,
    zone_id: &'a str,
    generation: u64,
    state: CloudflareCredentialState,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<&'a str>,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvelopeWire {
    schema_version: u8,
    provider_kind: String,
    capability: String,
    connection_incarnation: String,
    connection_digest: String,
    scope_digest: String,
    zone_digest: String,
    public_proof: String,
    zone_id: String,
    generation: u64,
    state: CloudflareCredentialState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareCredentialState {
    Active,
    Tombstone,
}

/// Non-secret state returned when a valid credential exists at another generation.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareCredentialProofState {
    Active,
    Tombstone,
}

/// Closed, non-secret Keychain inspection result used by the durable recovery matrix.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareCredentialProofInspection {
    ExactActive {
        generation: u64,
        public_proof: String,
    },
    ExactTombstone {
        generation: u64,
    },
    OtherValidGeneration {
        generation: u64,
        state: CloudflareCredentialProofState,
        public_proof: Option<String>,
    },
}

/// Closed public state used by a borrowed Host provision plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudflareCredentialPublicKind {
    Absent,
    Active,
    Tombstone,
}

/// Read-only Host-owned plan forwarded by the private native orchestrator.
pub trait CloudflareCredentialProvisionPlan {
    fn connection_incarnation(&self) -> &str;
    fn connection_digest(&self) -> &str;
    fn expected_base_kind(&self) -> CloudflareCredentialPublicKind;
    fn expected_base_generation(&self) -> Option<u64>;
    fn expected_base_scope_digest(&self) -> Option<&str>;
    fn expected_base_zone_digest(&self) -> Option<&str>;
    fn expected_base_public_proof(&self) -> Option<&str>;
    fn target_generation(&self) -> u64;
    fn target_scope_digest(&self) -> &str;
    fn target_zone_digest(&self) -> &str;
    fn target_public_proof(&self) -> &str;
}

/// Read-only public tuple used only to classify an unresolved durable credential write.
pub trait CloudflareCredentialRecoveryPlan {
    fn connection_incarnation(&self) -> &str;
    fn connection_digest(&self) -> &str;
    fn expected_base_kind(&self) -> CloudflareCredentialPublicKind;
    fn expected_base_generation(&self) -> Option<u64>;
    fn expected_base_scope_digest(&self) -> Option<&str>;
    fn expected_base_zone_digest(&self) -> Option<&str>;
    fn expected_base_public_proof(&self) -> Option<&str>;
    fn target_kind(&self) -> CloudflareCredentialPublicKind;
    fn target_generation(&self) -> u64;
    fn target_scope_digest(&self) -> &str;
    fn target_zone_digest(&self) -> &str;
    fn target_public_proof(&self) -> &str;
}

/// Marker for an opaque Host handle whose durable prewrite deny phase has committed.
pub trait CloudflarePrewriteInspection {}

/// Closed Keychain custody result forwarded to the Host while the Keychain lock is held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudflareCustodyComparison {
    ExactTarget,
    ExactBase,
    OtherCanonical,
    MissingOther,
    Malformed,
    Unavailable,
}

/// Closed, non-secret reason for denying a prewrite inspection without an OS write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudflarePrewriteFailure {
    BaseMismatch,
    MissingOther,
    Malformed,
    Unreadable,
}

impl CloudflareCredentialEnvelope {
    fn active_from_candidate(
        connection_incarnation: &str,
        connection_digest: &str,
        scope_digest: &str,
        zone_digest: &str,
        public_proof: &str,
        generation: u64,
        candidate: CloudflareCandidate,
    ) -> Result<Self, CloudflareKeychainError> {
        let (zone_id, token) = candidate.into_parts();
        let envelope = Self {
            schema_version: 3,
            provider_kind: "cloudflare".to_owned(),
            capability: "dns".to_owned(),
            connection_incarnation: connection_incarnation.to_owned(),
            connection_digest: connection_digest.to_owned(),
            scope_digest: scope_digest.to_owned(),
            zone_digest: zone_digest.to_owned(),
            public_proof: public_proof.to_owned(),
            zone_id,
            generation,
            state: CloudflareCredentialState::Active,
            token: Some(token),
        };
        envelope.validate()?;
        Ok(envelope)
    }
    /// Builds a validated monotonic revocation marker.
    ///
    /// # Errors
    ///
    /// Returns [`CloudflareKeychainError::Malformed`] for an invalid identity,
    /// generation, or Zone.
    #[allow(dead_code, reason = "used by the Host revocation path")]
    pub(crate) fn tombstone(
        connection_incarnation: &str,
        connection_digest: &str,
        scope_digest: &str,
        zone_digest: &str,
        public_proof: &str,
        zone_id: &str,
        generation: u64,
    ) -> Result<Self, CloudflareKeychainError> {
        let envelope = Self {
            schema_version: 3,
            provider_kind: "cloudflare".to_owned(),
            capability: "dns".to_owned(),
            connection_incarnation: connection_incarnation.to_owned(),
            connection_digest: connection_digest.to_owned(),
            scope_digest: scope_digest.to_owned(),
            zone_digest: zone_digest.to_owned(),
            public_proof: public_proof.to_owned(),
            zone_id: zone_id.to_owned(),
            generation,
            state: CloudflareCredentialState::Tombstone,
            token: None,
        };
        envelope.validate()?;
        Ok(envelope)
    }
    #[must_use]
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    #[must_use]
    pub(crate) fn connection_digest(&self) -> &str {
        &self.connection_digest
    }
    #[must_use]
    pub(crate) fn connection_incarnation(&self) -> &str {
        &self.connection_incarnation
    }
    #[must_use]
    pub(crate) fn scope_digest(&self) -> &str {
        &self.scope_digest
    }
    #[must_use]
    pub(crate) fn zone_digest(&self) -> &str {
        &self.zone_digest
    }
    #[must_use]
    pub(crate) fn public_proof(&self) -> &str {
        &self.public_proof
    }
    #[must_use]
    pub(crate) fn state(&self) -> CloudflareCredentialState {
        self.state
    }
    pub(crate) fn token(&self) -> Option<&str> {
        self.token.as_deref().map(String::as_str)
    }
    pub(crate) fn zone_id(&self) -> &str {
        &self.zone_id
    }
    #[cfg(any(target_os = "macos", test))]
    fn encode(&self) -> Result<Zeroizing<Vec<u8>>, CloudflareKeychainError> {
        self.validate()?;
        let wire = EnvelopeWireRef {
            schema_version: self.schema_version,
            provider_kind: &self.provider_kind,
            capability: &self.capability,
            connection_incarnation: &self.connection_incarnation,
            connection_digest: &self.connection_digest,
            scope_digest: &self.scope_digest,
            zone_digest: &self.zone_digest,
            public_proof: &self.public_proof,
            zone_id: &self.zone_id,
            generation: self.generation,
            state: self.state,
            token: self.token.as_deref().map(String::as_str),
        };
        let bytes = Zeroizing::new(
            serde_json::to_vec(&wire).map_err(|_| CloudflareKeychainError::Malformed)?,
        );
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return Err(CloudflareKeychainError::Malformed);
        }
        Ok(bytes)
    }
    #[cfg(any(target_os = "macos", test))]
    fn decode(bytes: &[u8]) -> Result<Self, CloudflareKeychainError> {
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return Err(CloudflareKeychainError::Malformed);
        }
        let wire: EnvelopeWire =
            serde_json::from_slice(bytes).map_err(|_| CloudflareKeychainError::Malformed)?;
        let value = Self {
            schema_version: wire.schema_version,
            provider_kind: wire.provider_kind,
            capability: wire.capability,
            connection_incarnation: wire.connection_incarnation,
            connection_digest: wire.connection_digest,
            scope_digest: wire.scope_digest,
            zone_digest: wire.zone_digest,
            public_proof: wire.public_proof,
            zone_id: wire.zone_id,
            generation: wire.generation,
            state: wire.state,
            token: wire.token.map(Zeroizing::new),
        };
        value.validate()?;
        Ok(value)
    }
    fn validate(&self) -> Result<(), CloudflareKeychainError> {
        if self.schema_version != 3
            || self.provider_kind != "cloudflare"
            || self.capability != "dns"
            || !is_local_identifier(&self.connection_incarnation)
            || !is_connection_digest(&self.connection_digest)
            || !is_sha256_digest(&self.scope_digest)
            || !is_sha256_digest(&self.zone_digest)
            || !is_sha256_digest(&self.public_proof)
            || !is_zone_id(&self.zone_id)
            || cloudflare_zone_binding_digest(&self.zone_id) != self.zone_digest
            || self.generation == 0
            || (self.state == CloudflareCredentialState::Active
                && self.token.as_deref().is_none_or(|token| {
                    token.is_empty()
                        || token.len() > 512
                        || token.bytes().any(|b| !b.is_ascii_graphic())
                }))
            || (self.state == CloudflareCredentialState::Tombstone && self.token.is_some())
        {
            return Err(CloudflareKeychainError::Malformed);
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[allow(dead_code, reason = "called by Desktop Host composition")]
/// Loads one purpose-isolated credential after acquiring its process lock.
///
/// # Errors
///
/// Fails closed when the identity is malformed or OS custody cannot be read.
pub(crate) fn load(
    connection_digest: &str,
) -> Result<Option<CloudflareCredentialEnvelope>, CloudflareKeychainError> {
    if !is_connection_digest(connection_digest) {
        return Err(CloudflareKeychainError::Malformed);
    }
    let _lock = KeychainLock::acquire(connection_digest)?;
    load_unlocked(connection_digest)
}

#[cfg(target_os = "macos")]
fn load_unlocked(
    connection_digest: &str,
) -> Result<Option<CloudflareCredentialEnvelope>, CloudflareKeychainError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::generic_password(keychain_options(
        connection_digest,
        false,
    )) {
        Ok(bytes) => {
            let bytes = Zeroizing::new(bytes);
            admit_loaded_envelope(&bytes, verify_keychain_attributes(connection_digest)).map(Some)
        }
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(CloudflareKeychainError::Unavailable),
    }
}

#[cfg(target_os = "macos")]
fn admit_loaded_envelope(
    bytes: &[u8],
    attribute_verification: Result<(), CloudflareKeychainError>,
) -> Result<CloudflareCredentialEnvelope, CloudflareKeychainError> {
    attribute_verification?;
    CloudflareCredentialEnvelope::decode(bytes)
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code, reason = "called only by macOS production composition")]
/// Reports that strict Cloudflare credential custody is unavailable.
///
/// # Errors
///
/// Always returns [`CloudflareKeychainError::Unavailable`].
pub(crate) fn load(
    _connection_digest: &str,
) -> Result<Option<CloudflareCredentialEnvelope>, CloudflareKeychainError> {
    Err(CloudflareKeychainError::Unavailable)
}

#[cfg(test)]
fn guarded_credential_write(
    guard: &mut CloudflareKeychainGuard<'_>,
    write: impl FnOnce() -> Result<(), CloudflareKeychainError>,
) -> Result<(), CloudflareKeychainError> {
    guard()?;
    write()
}

/// Publishes one Host-prepared active credential under exact-base, explicit-target CAS.
///
/// The fast guard is consulted only before the durable marker. After `mark_once` succeeds, the
/// Keychain write, strict read-back, and `resolve_once` callback drain synchronously while the
/// same per-connection Keychain lock remains held.
///
/// # Errors
///
/// Rejects malformed plans, candidate/target drift, a non-exact base, pre-marker stale
/// authority, unavailable custody, or a failed Host marker/resolution callback.
#[allow(
    clippy::needless_pass_by_value,
    reason = "the single transient candidate is moved into Secure Host custody"
)]
pub fn publish_cloudflare_candidate_guarded<Plan, Inspecting, Marked, Resolved>(
    plan: &Plan,
    candidate: CloudflareCandidate,
    inspecting: Inspecting,
    mark_once: impl FnOnce(Inspecting) -> Result<Marked, CloudflareKeychainError>,
    remediate_once: impl FnOnce(
        Inspecting,
        CloudflarePrewriteFailure,
    ) -> Result<Resolved, CloudflareKeychainError>,
    resolve_once: impl FnOnce(
        Marked,
        CloudflareCustodyComparison,
    ) -> Result<Resolved, CloudflareKeychainError>,
) -> Result<Resolved, CloudflareKeychainError>
where
    Plan: CloudflareCredentialProvisionPlan + ?Sized,
    Inspecting: CloudflarePrewriteInspection,
{
    validate_provision_plan(plan)?;
    if candidate.zone_binding_digest() != plan.target_zone_digest() {
        return Err(CloudflareKeychainError::BindingMismatch);
    }
    let envelope = CloudflareCredentialEnvelope::active_from_candidate(
        plan.connection_incarnation(),
        plan.connection_digest(),
        plan.target_scope_digest(),
        plan.target_zone_digest(),
        plan.target_public_proof(),
        plan.target_generation(),
        candidate,
    )?;
    publish_active_envelope_guarded(
        plan,
        &envelope,
        inspecting,
        mark_once,
        remediate_once,
        resolve_once,
    )
}

/// Strictly inspects one unresolved post-marker credential while retaining its Keychain lock
/// through the Host resolution callback. This operation never writes or deletes Keychain data.
///
/// # Errors
///
/// Rejects a malformed plan, unavailable process lock, or failed Host resolution callback.
pub fn inspect_cloudflare_recovery_guarded<Plan, Handle, Resolved>(
    plan: &Plan,
    handle: Handle,
    resolve_once: impl FnOnce(
        Handle,
        CloudflareCustodyComparison,
    ) -> Result<Resolved, CloudflareKeychainError>,
) -> Result<Resolved, CloudflareKeychainError>
where
    Plan: CloudflareCredentialRecoveryPlan + ?Sized,
{
    validate_recovery_plan(plan)?;
    inspect_cloudflare_recovery_platform(plan, handle, resolve_once)
}

#[cfg(target_os = "macos")]
fn inspect_cloudflare_recovery_platform<Plan, Handle, Resolved>(
    plan: &Plan,
    handle: Handle,
    resolve_once: impl FnOnce(
        Handle,
        CloudflareCustodyComparison,
    ) -> Result<Resolved, CloudflareKeychainError>,
) -> Result<Resolved, CloudflareKeychainError>
where
    Plan: CloudflareCredentialRecoveryPlan + ?Sized,
{
    let _lock = KeychainLock::acquire(plan.connection_digest())?;
    let comparison = classify_recovery_custody(plan, load_unlocked(plan.connection_digest()));
    resolve_once(handle, comparison)
}

#[cfg(not(target_os = "macos"))]
fn inspect_cloudflare_recovery_platform<Plan, Handle, Resolved>(
    _plan: &Plan,
    handle: Handle,
    resolve_once: impl FnOnce(
        Handle,
        CloudflareCustodyComparison,
    ) -> Result<Resolved, CloudflareKeychainError>,
) -> Result<Resolved, CloudflareKeychainError>
where
    Plan: CloudflareCredentialRecoveryPlan + ?Sized,
{
    resolve_once(handle, CloudflareCustodyComparison::Unavailable)
}

fn validate_recovery_plan(
    plan: &(impl CloudflareCredentialRecoveryPlan + ?Sized),
) -> Result<(), CloudflareKeychainError> {
    if !is_local_identifier(plan.connection_incarnation())
        || !is_connection_digest(plan.connection_digest())
        || plan.target_generation() == 0
        || !is_sha256_digest(plan.target_scope_digest())
        || !is_sha256_digest(plan.target_zone_digest())
        || !is_sha256_digest(plan.target_public_proof())
        || plan.target_kind() == CloudflareCredentialPublicKind::Absent
    {
        return Err(CloudflareKeychainError::Malformed);
    }
    match plan.expected_base_kind() {
        CloudflareCredentialPublicKind::Absent => {
            if plan.expected_base_generation().is_some()
                || plan.expected_base_scope_digest().is_some()
                || plan.expected_base_zone_digest().is_some()
                || plan.expected_base_public_proof().is_some()
            {
                return Err(CloudflareKeychainError::Malformed);
            }
        }
        CloudflareCredentialPublicKind::Active | CloudflareCredentialPublicKind::Tombstone => {
            let Some(base_generation) = plan.expected_base_generation() else {
                return Err(CloudflareKeychainError::Malformed);
            };
            if base_generation == 0
                || plan.target_generation() <= base_generation
                || plan
                    .expected_base_scope_digest()
                    .is_none_or(|value| !is_sha256_digest(value))
                || plan
                    .expected_base_zone_digest()
                    .is_none_or(|value| !is_sha256_digest(value))
                || plan
                    .expected_base_public_proof()
                    .is_none_or(|value| !is_sha256_digest(value))
            {
                return Err(CloudflareKeychainError::Malformed);
            }
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn classify_recovery_custody(
    plan: &(impl CloudflareCredentialRecoveryPlan + ?Sized),
    current: Result<Option<CloudflareCredentialEnvelope>, CloudflareKeychainError>,
) -> CloudflareCustodyComparison {
    match current {
        Ok(Some(envelope)) if recovery_tuple_matches_target(plan, &envelope) => {
            CloudflareCustodyComparison::ExactTarget
        }
        Ok(Some(envelope)) if recovery_tuple_matches_base(plan, &envelope) => {
            CloudflareCustodyComparison::ExactBase
        }
        Ok(Some(_)) => CloudflareCustodyComparison::OtherCanonical,
        Ok(None) if plan.expected_base_kind() == CloudflareCredentialPublicKind::Absent => {
            CloudflareCustodyComparison::ExactBase
        }
        Ok(None) => CloudflareCustodyComparison::MissingOther,
        Err(CloudflareKeychainError::Malformed | CloudflareKeychainError::BindingMismatch) => {
            CloudflareCustodyComparison::Malformed
        }
        Err(_) => CloudflareCustodyComparison::Unavailable,
    }
}

#[cfg(any(target_os = "macos", test))]
fn recovery_tuple_matches_target(
    plan: &(impl CloudflareCredentialRecoveryPlan + ?Sized),
    envelope: &CloudflareCredentialEnvelope,
) -> bool {
    envelope.connection_incarnation() == plan.connection_incarnation()
        && envelope.connection_digest() == plan.connection_digest()
        && envelope.generation() == plan.target_generation()
        && envelope.scope_digest() == plan.target_scope_digest()
        && envelope.zone_digest() == plan.target_zone_digest()
        && envelope.public_proof() == plan.target_public_proof()
        && credential_public_kind(envelope.state()) == plan.target_kind()
}

#[cfg(any(target_os = "macos", test))]
fn recovery_tuple_matches_base(
    plan: &(impl CloudflareCredentialRecoveryPlan + ?Sized),
    envelope: &CloudflareCredentialEnvelope,
) -> bool {
    envelope.connection_incarnation() == plan.connection_incarnation()
        && envelope.connection_digest() == plan.connection_digest()
        && Some(envelope.generation()) == plan.expected_base_generation()
        && Some(envelope.scope_digest()) == plan.expected_base_scope_digest()
        && Some(envelope.zone_digest()) == plan.expected_base_zone_digest()
        && Some(envelope.public_proof()) == plan.expected_base_public_proof()
        && credential_public_kind(envelope.state()) == plan.expected_base_kind()
}

#[cfg(any(target_os = "macos", test))]
const fn credential_public_kind(
    state: CloudflareCredentialState,
) -> CloudflareCredentialPublicKind {
    match state {
        CloudflareCredentialState::Active => CloudflareCredentialPublicKind::Active,
        CloudflareCredentialState::Tombstone => CloudflareCredentialPublicKind::Tombstone,
    }
}

#[cfg(target_os = "macos")]
fn publish_active_envelope_guarded<Plan, Inspecting, Marked, Resolved>(
    plan: &Plan,
    envelope: &CloudflareCredentialEnvelope,
    inspecting: Inspecting,
    mark_once: impl FnOnce(Inspecting) -> Result<Marked, CloudflareKeychainError>,
    remediate_once: impl FnOnce(
        Inspecting,
        CloudflarePrewriteFailure,
    ) -> Result<Resolved, CloudflareKeychainError>,
    resolve_once: impl FnOnce(
        Marked,
        CloudflareCustodyComparison,
    ) -> Result<Resolved, CloudflareKeychainError>,
) -> Result<Resolved, CloudflareKeychainError>
where
    Plan: CloudflareCredentialProvisionPlan + ?Sized,
    Inspecting: CloudflarePrewriteInspection,
{
    let _lock = KeychainLock::acquire(plan.connection_digest())?;
    let current = match load_unlocked(plan.connection_digest()) {
        Ok(current) => current,
        Err(CloudflareKeychainError::Malformed | CloudflareKeychainError::BindingMismatch) => {
            return remediate_once(inspecting, CloudflarePrewriteFailure::Malformed);
        }
        Err(_) => return remediate_once(inspecting, CloudflarePrewriteFailure::Unreadable),
    };
    publish_after_base(
        plan,
        envelope,
        InspectedBase {
            current: current.as_ref(),
            handle: inspecting,
        },
        mark_once,
        remediate_once,
        || {
            let bytes = envelope.encode()?;
            Ok(
                match security_framework::passwords::set_generic_password_options(
                    &bytes,
                    keychain_options(plan.connection_digest(), true),
                ) {
                    Ok(()) => classify_current_custody(
                        plan,
                        load_unlocked(plan.connection_digest()),
                        envelope,
                    ),
                    Err(_) => CloudflareCustodyComparison::Unavailable,
                },
            )
        },
        resolve_once,
    )
}

#[cfg(not(target_os = "macos"))]
fn publish_active_envelope_guarded<Plan, Inspecting, Marked, Resolved>(
    _plan: &Plan,
    _envelope: &CloudflareCredentialEnvelope,
    _inspecting: Inspecting,
    _mark_once: impl FnOnce(Inspecting) -> Result<Marked, CloudflareKeychainError>,
    _remediate_once: impl FnOnce(
        Inspecting,
        CloudflarePrewriteFailure,
    ) -> Result<Resolved, CloudflareKeychainError>,
    _resolve_once: impl FnOnce(
        Marked,
        CloudflareCustodyComparison,
    ) -> Result<Resolved, CloudflareKeychainError>,
) -> Result<Resolved, CloudflareKeychainError>
where
    Plan: CloudflareCredentialProvisionPlan + ?Sized,
    Inspecting: CloudflarePrewriteInspection,
{
    Err(CloudflareKeychainError::Unavailable)
}

fn validate_provision_plan(
    plan: &(impl CloudflareCredentialProvisionPlan + ?Sized),
) -> Result<(), CloudflareKeychainError> {
    let target_generation = plan.target_generation();
    if !is_local_identifier(plan.connection_incarnation())
        || !is_connection_digest(plan.connection_digest())
        || target_generation == 0
        || !is_sha256_digest(plan.target_scope_digest())
        || !is_sha256_digest(plan.target_zone_digest())
        || !is_sha256_digest(plan.target_public_proof())
    {
        return Err(CloudflareKeychainError::Malformed);
    }
    match plan.expected_base_kind() {
        CloudflareCredentialPublicKind::Absent => {
            if plan.expected_base_generation().is_some()
                || plan.expected_base_scope_digest().is_some()
                || plan.expected_base_zone_digest().is_some()
                || plan.expected_base_public_proof().is_some()
            {
                return Err(CloudflareKeychainError::Malformed);
            }
        }
        CloudflareCredentialPublicKind::Active | CloudflareCredentialPublicKind::Tombstone => {
            let Some(base_generation) = plan.expected_base_generation() else {
                return Err(CloudflareKeychainError::Malformed);
            };
            if base_generation == 0
                || target_generation <= base_generation
                || plan
                    .expected_base_scope_digest()
                    .is_none_or(|value| !is_sha256_digest(value))
                || plan
                    .expected_base_zone_digest()
                    .is_none_or(|value| !is_sha256_digest(value))
                || plan
                    .expected_base_public_proof()
                    .is_none_or(|value| !is_sha256_digest(value))
            {
                return Err(CloudflareKeychainError::Malformed);
            }
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn matches_expected_base(
    plan: &(impl CloudflareCredentialProvisionPlan + ?Sized),
    current: Option<&CloudflareCredentialEnvelope>,
) -> bool {
    match (plan.expected_base_kind(), current) {
        (CloudflareCredentialPublicKind::Absent, None) => true,
        (CloudflareCredentialPublicKind::Active, Some(envelope)) => {
            envelope.state() == CloudflareCredentialState::Active
                && matches_expected_tuple(plan, envelope)
        }
        (CloudflareCredentialPublicKind::Tombstone, Some(envelope)) => {
            envelope.state() == CloudflareCredentialState::Tombstone
                && matches_expected_tuple(plan, envelope)
        }
        _ => false,
    }
}

#[cfg(any(target_os = "macos", test))]
struct InspectedBase<'a, Inspecting> {
    current: Option<&'a CloudflareCredentialEnvelope>,
    handle: Inspecting,
}

#[cfg(any(target_os = "macos", test))]
fn publish_after_base<Plan, Inspecting, Marked, Resolved>(
    plan: &Plan,
    target: &CloudflareCredentialEnvelope,
    inspected: InspectedBase<'_, Inspecting>,
    mark_once: impl FnOnce(Inspecting) -> Result<Marked, CloudflareKeychainError>,
    remediate_once: impl FnOnce(
        Inspecting,
        CloudflarePrewriteFailure,
    ) -> Result<Resolved, CloudflareKeychainError>,
    write_and_read_back: impl FnOnce() -> Result<CloudflareCustodyComparison, CloudflareKeychainError>,
    resolve_once: impl FnOnce(
        Marked,
        CloudflareCustodyComparison,
    ) -> Result<Resolved, CloudflareKeychainError>,
) -> Result<Resolved, CloudflareKeychainError>
where
    Plan: CloudflareCredentialProvisionPlan + ?Sized,
{
    let InspectedBase {
        current,
        handle: inspecting,
    } = inspected;
    if !matches_expected_base(plan, current) {
        let reason = if current.is_none()
            && plan.expected_base_kind() != CloudflareCredentialPublicKind::Absent
        {
            CloudflarePrewriteFailure::MissingOther
        } else {
            CloudflarePrewriteFailure::BaseMismatch
        };
        return remediate_once(inspecting, reason);
    }
    if target.connection_incarnation() != plan.connection_incarnation()
        || target.connection_digest() != plan.connection_digest()
        || target.generation() != plan.target_generation()
        || target.scope_digest() != plan.target_scope_digest()
        || target.zone_digest() != plan.target_zone_digest()
        || target.public_proof() != plan.target_public_proof()
        || target.state() != CloudflareCredentialState::Active
    {
        return Err(CloudflareKeychainError::Malformed);
    }
    let marked = mark_once(inspecting)?;
    let comparison = write_and_read_back()?;
    resolve_once(marked, comparison)
}

#[cfg(any(target_os = "macos", test))]
fn matches_expected_tuple(
    plan: &(impl CloudflareCredentialProvisionPlan + ?Sized),
    envelope: &CloudflareCredentialEnvelope,
) -> bool {
    envelope.connection_incarnation() == plan.connection_incarnation()
        && envelope.connection_digest() == plan.connection_digest()
        && Some(envelope.generation()) == plan.expected_base_generation()
        && Some(envelope.scope_digest()) == plan.expected_base_scope_digest()
        && Some(envelope.zone_digest()) == plan.expected_base_zone_digest()
        && Some(envelope.public_proof()) == plan.expected_base_public_proof()
}

#[cfg(any(test, target_os = "macos"))]
fn matches_exact_envelope(
    actual: &CloudflareCredentialEnvelope,
    expected: &CloudflareCredentialEnvelope,
) -> bool {
    actual.encode().ok() == expected.encode().ok()
}

#[cfg(target_os = "macos")]
fn classify_current_custody(
    plan: &(impl CloudflareCredentialProvisionPlan + ?Sized),
    current: Result<Option<CloudflareCredentialEnvelope>, CloudflareKeychainError>,
    target: &CloudflareCredentialEnvelope,
) -> CloudflareCustodyComparison {
    match current {
        Ok(Some(envelope)) if matches_exact_envelope(&envelope, target) => {
            CloudflareCustodyComparison::ExactTarget
        }
        Ok(Some(envelope)) if matches_expected_base(plan, Some(&envelope)) => {
            CloudflareCustodyComparison::ExactBase
        }
        Ok(Some(_)) => CloudflareCustodyComparison::OtherCanonical,
        Ok(None) if plan.expected_base_kind() == CloudflareCredentialPublicKind::Absent => {
            CloudflareCustodyComparison::ExactBase
        }
        Ok(None) => CloudflareCustodyComparison::MissingOther,
        Err(CloudflareKeychainError::Malformed | CloudflareKeychainError::BindingMismatch) => {
            CloudflareCustodyComparison::Malformed
        }
        Err(_) => CloudflareCustodyComparison::Unavailable,
    }
}

fn is_zone_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn is_connection_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_sha256_digest(value: &str) -> bool {
    is_connection_digest(value)
}

fn is_local_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

pub(crate) fn cloudflare_zone_binding_digest(zone_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"gooddealer/cloudflare-zone-binding/v1\0");
    digest.update(zone_id.as_bytes());
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

#[cfg(test)]
fn classify_envelope(
    envelope: &CloudflareCredentialEnvelope,
    expected_connection_incarnation: &str,
    expected_connection_digest: &str,
    expected_generation: u64,
    expected_scope_digest: &str,
    expected_zone_digest: &str,
    expected_public_proof: &str,
) -> Result<CloudflareCredentialProofInspection, CloudflareKeychainError> {
    if envelope.connection_incarnation() != expected_connection_incarnation
        || envelope.connection_digest() != expected_connection_digest
        || envelope.scope_digest() != expected_scope_digest
        || envelope.zone_digest() != expected_zone_digest
        || envelope.public_proof() != expected_public_proof
    {
        return Err(CloudflareKeychainError::BindingMismatch);
    }
    let public_proof = (envelope.state() == CloudflareCredentialState::Active)
        .then(|| envelope.public_proof().to_owned());
    if envelope.generation() == expected_generation {
        return Ok(match envelope.state() {
            CloudflareCredentialState::Active => CloudflareCredentialProofInspection::ExactActive {
                generation: envelope.generation(),
                public_proof: public_proof.expect("active credential has a proof"),
            },
            CloudflareCredentialState::Tombstone => {
                CloudflareCredentialProofInspection::ExactTombstone {
                    generation: envelope.generation(),
                }
            }
        });
    }
    Ok(CloudflareCredentialProofInspection::OtherValidGeneration {
        generation: envelope.generation(),
        state: match envelope.state() {
            CloudflareCredentialState::Active => CloudflareCredentialProofState::Active,
            CloudflareCredentialState::Tombstone => CloudflareCredentialProofState::Tombstone,
        },
        public_proof,
    })
}

#[cfg(test)]
fn validate_generation_transition(
    current: Option<&CloudflareCredentialEnvelope>,
    expected_generation: u64,
    next: &CloudflareCredentialEnvelope,
) -> Result<(), CloudflareKeychainError> {
    let current_generation = current.map_or(0, CloudflareCredentialEnvelope::generation);
    let next_generation = expected_generation
        .checked_add(1)
        .ok_or(CloudflareKeychainError::StaleGeneration)?;
    if current_generation != expected_generation || next.generation() != next_generation {
        return Err(CloudflareKeychainError::StaleGeneration);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn keychain_options(
    connection_digest: &str,
    include_access_control: bool,
) -> security_framework::passwords::PasswordOptions {
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{AccessControlOptions, PasswordOptions};

    let mut options = PasswordOptions::new_generic_password(SERVICE, connection_digest);
    // The data-protection keychain binds access to the signed application's
    // designated requirement. No shared access group is requested.
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    if include_access_control {
        options.set_access_control(
            SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
                AccessControlOptions::empty().bits(),
            )
            .expect("fixed keychain access control flags are valid"),
        );
    }
    options
}

#[cfg(target_os = "macos")]
fn verify_keychain_attributes(connection_digest: &str) -> Result<(), CloudflareKeychainError> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions, SearchResult};
    const ITEM_NOT_FOUND: i32 = -25_300;

    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(SERVICE)
        .account(connection_digest)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    let results = query
        .search()
        .map_err(|_| CloudflareKeychainError::Unavailable)?;
    let Some(result @ SearchResult::Dict(_)) = results.first() else {
        return Err(CloudflareKeychainError::StateUnknown);
    };
    let Some(values) = result.simplify_dict() else {
        return Err(CloudflareKeychainError::StateUnknown);
    };

    // These attributes are returned by SecItemCopyMatching without exposing
    // the secret. `accc` is intentionally checked for presence: the Security
    // Framework represents SecAccessControl as an opaque object, while the
    // protected-keychain option above makes the designated application the
    // only admissible caller. If either contract is not observable, fail
    // closed rather than treating an unverified item as ours.
    if !valid_keychain_attribute_values(&values, connection_digest) {
        return Err(CloudflareKeychainError::StateUnknown);
    }

    // `simplify_dict` deliberately does not interpret CFBoolean, so prove
    // non-synchronizability by showing the protected synchronized store has no
    // item with this purpose identity.
    let mut synchronized = ItemSearchOptions::new();
    synchronized
        .class(ItemClass::generic_password())
        .service(SERVICE)
        .account(connection_digest)
        .cloud_sync(CloudSync::MatchSyncYes)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    match synchronized.search() {
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
        Ok(results) if synchronized_attribute_search_is_empty(results.len()) => Ok(()),
        Ok(_) => Err(CloudflareKeychainError::StateUnknown),
        Err(_) => Err(CloudflareKeychainError::Unavailable),
    }
}

#[cfg(target_os = "macos")]
const fn synchronized_attribute_search_is_empty(match_count: usize) -> bool {
    match_count == 0
}

#[cfg(target_os = "macos")]
fn valid_keychain_attribute_values(
    values: &std::collections::HashMap<String, String>,
    connection_digest: &str,
) -> bool {
    values.get("svce").is_some_and(|value| value == SERVICE)
        && values
            .get("acct")
            .is_some_and(|value| value == connection_digest)
        // Security.framework returns the short protection-domain value `aku`
        // for kSecAttrAccessibleWhenUnlockedThisDeviceOnly. `ak` is the
        // non-device-only variant and `akpu` is the distinct passcode-set
        // policy; accepting either would make read-back disagree with the
        // exact policy used by `keychain_options`.
        && values.get("pdmn").is_some_and(|value| {
            value == WHEN_UNLOCKED_THIS_DEVICE_ONLY_PROTECTION_DOMAIN
        })
        && values.contains_key("accc")
        && values
            .get("agrp")
            .is_some_and(|value| valid_designated_application_group(value))
}

#[cfg(target_os = "macos")]
fn valid_designated_application_group(value: &str) -> bool {
    const BUNDLE_ID: &str = "app.gooddealer.desktop";
    value == BUNDLE_ID
        || value.strip_suffix(BUNDLE_ID).is_some_and(|prefix| {
            let team = prefix.strip_suffix('.').unwrap_or_default();
            team.len() == 10
                && team
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        })
}

#[cfg(target_os = "macos")]
struct KeychainLock {
    _process_guard: std::sync::MutexGuard<'static, ()>,
    file: std::fs::File,
}

#[cfg(target_os = "macos")]
impl KeychainLock {
    fn acquire(connection_digest: &str) -> Result<Self, CloudflareKeychainError> {
        let directory = production_lock_directory();
        Self::acquire_at(&directory, connection_digest)
    }

    fn acquire_at(
        directory: &std::path::Path,
        connection_digest: &str,
    ) -> Result<Self, CloudflareKeychainError> {
        let mut no_guard = || Ok(());
        Self::acquire_at_guarded(directory, connection_digest, &mut no_guard)
    }

    fn acquire_at_guarded(
        directory: &std::path::Path,
        connection_digest: &str,
        guard: &mut CloudflareKeychainGuard<'_>,
    ) -> Result<Self, CloudflareKeychainError> {
        use fs2::FileExt;
        use std::fs::{self, DirBuilder, OpenOptions};
        use std::io::ErrorKind;
        use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
        use std::path::PathBuf;
        use std::sync::{Mutex, OnceLock};

        static PROCESS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let process_mutex = PROCESS_LOCK.get_or_init(|| Mutex::new(()));
        let process_guard = loop {
            guard()?;
            match process_mutex.try_lock() {
                Ok(guard) => break guard,
                Err(std::sync::TryLockError::Poisoned(_)) => {
                    return Err(CloudflareKeychainError::Unavailable);
                }
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            }
        };

        if !directory.is_absolute() {
            return Err(CloudflareKeychainError::Unavailable);
        }
        match DirBuilder::new().mode(0o700).create(directory) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(_) => return Err(CloudflareKeychainError::Unavailable),
        }
        let directory_metadata =
            fs::symlink_metadata(directory).map_err(|_| CloudflareKeychainError::Unavailable)?;
        if !directory_metadata.file_type().is_dir()
            || directory_metadata.file_type().is_symlink()
            || directory_metadata.uid() != rustix::process::geteuid().as_raw()
            || directory_metadata.mode() & 0o777 != 0o700
        {
            return Err(CloudflareKeychainError::Unavailable);
        }

        let mut path = PathBuf::from(directory);
        path.push(format!("{SERVICE}.{connection_digest}.lock"));
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(&path)
            .map_err(|_| CloudflareKeychainError::Unavailable)?;
        let file_metadata = file
            .metadata()
            .map_err(|_| CloudflareKeychainError::Unavailable)?;
        if !file_metadata.file_type().is_file()
            || file_metadata.nlink() != 1
            || file_metadata.uid() != directory_metadata.uid()
            || file_metadata.mode() & 0o777 != 0o600
        {
            return Err(CloudflareKeychainError::Unavailable);
        }
        loop {
            guard()?;
            match file.try_lock_exclusive() {
                Ok(()) => break,
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(_) => return Err(CloudflareKeychainError::Unavailable),
            }
        }
        let path_metadata =
            fs::symlink_metadata(path).map_err(|_| CloudflareKeychainError::Unavailable)?;
        if path_metadata.file_type().is_symlink()
            || path_metadata.dev() != file_metadata.dev()
            || path_metadata.ino() != file_metadata.ino()
        {
            return Err(CloudflareKeychainError::Unavailable);
        }
        Ok(Self {
            _process_guard: process_guard,
            file,
        })
    }
}

#[cfg(target_os = "macos")]
fn production_lock_directory() -> std::path::PathBuf {
    let effective_user = rustix::process::geteuid().as_raw();
    std::path::PathBuf::from(format!(
        "/private/tmp/{LOCK_DIRECTORY_PREFIX}-{effective_user}"
    ))
}

#[cfg(target_os = "macos")]
impl Drop for KeychainLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    const INCARNATION: &str = "cloudflare-incarnation-1";
    const SCOPE: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const PROOF: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    struct Plan {
        base_kind: CloudflareCredentialPublicKind,
        base_generation: Option<u64>,
        base_scope: Option<String>,
        base_zone: Option<String>,
        base_proof: Option<String>,
        target_generation: u64,
        target_zone: String,
    }

    impl CloudflareCredentialProvisionPlan for Plan {
        fn connection_incarnation(&self) -> &str {
            INCARNATION
        }
        fn connection_digest(&self) -> &'static str {
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
        fn expected_base_kind(&self) -> CloudflareCredentialPublicKind {
            self.base_kind
        }
        fn expected_base_generation(&self) -> Option<u64> {
            self.base_generation
        }
        fn expected_base_scope_digest(&self) -> Option<&str> {
            self.base_scope.as_deref()
        }
        fn expected_base_zone_digest(&self) -> Option<&str> {
            self.base_zone.as_deref()
        }
        fn expected_base_public_proof(&self) -> Option<&str> {
            self.base_proof.as_deref()
        }
        fn target_generation(&self) -> u64 {
            self.target_generation
        }
        fn target_scope_digest(&self) -> &str {
            SCOPE
        }
        fn target_zone_digest(&self) -> &str {
            &self.target_zone
        }
        fn target_public_proof(&self) -> &str {
            PROOF
        }
    }

    struct RecoveryPlan {
        base_kind: CloudflareCredentialPublicKind,
        base_generation: Option<u64>,
        base_scope: Option<String>,
        base_zone: Option<String>,
        base_proof: Option<String>,
        target_kind: CloudflareCredentialPublicKind,
        target_generation: u64,
        target_scope: String,
        target_zone: String,
        target_proof: String,
    }

    impl CloudflareCredentialRecoveryPlan for RecoveryPlan {
        fn connection_incarnation(&self) -> &str {
            INCARNATION
        }

        fn connection_digest(&self) -> &'static str {
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }

        fn expected_base_kind(&self) -> CloudflareCredentialPublicKind {
            self.base_kind
        }

        fn expected_base_generation(&self) -> Option<u64> {
            self.base_generation
        }

        fn expected_base_scope_digest(&self) -> Option<&str> {
            self.base_scope.as_deref()
        }

        fn expected_base_zone_digest(&self) -> Option<&str> {
            self.base_zone.as_deref()
        }

        fn expected_base_public_proof(&self) -> Option<&str> {
            self.base_proof.as_deref()
        }

        fn target_kind(&self) -> CloudflareCredentialPublicKind {
            self.target_kind
        }

        fn target_generation(&self) -> u64 {
            self.target_generation
        }

        fn target_scope_digest(&self) -> &str {
            &self.target_scope
        }

        fn target_zone_digest(&self) -> &str {
            &self.target_zone
        }

        fn target_public_proof(&self) -> &str {
            &self.target_proof
        }
    }

    fn active(connection: &str, zone: &str, generation: u64) -> CloudflareCredentialEnvelope {
        let envelope = CloudflareCredentialEnvelope {
            schema_version: 3,
            provider_kind: "cloudflare".to_owned(),
            capability: "dns".to_owned(),
            connection_incarnation: INCARNATION.to_owned(),
            connection_digest: connection.to_owned(),
            scope_digest: SCOPE.to_owned(),
            zone_digest: cloudflare_zone_binding_digest(zone),
            public_proof: PROOF.to_owned(),
            zone_id: zone.to_owned(),
            generation,
            state: CloudflareCredentialState::Active,
            token: Some(Zeroizing::new("token".to_owned())),
        };
        envelope.validate().unwrap();
        envelope
    }

    fn tombstone(connection: &str, zone: &str, generation: u64) -> CloudflareCredentialEnvelope {
        CloudflareCredentialEnvelope::tombstone(
            INCARNATION,
            connection,
            SCOPE,
            &cloudflare_zone_binding_digest(zone),
            PROOF,
            zone,
            generation,
        )
        .unwrap()
    }

    #[test]
    fn recovery_classifies_only_exact_target_and_base_tuples() {
        let connection = "a".repeat(64);
        let base_zone = "0123456789abcdef0123456789abcdef";
        let target_zone = "fedcba9876543210fedcba9876543210";
        let base = active(&connection, base_zone, 1);
        let target = active(&connection, target_zone, 2);
        let mut plan = RecoveryPlan {
            base_kind: CloudflareCredentialPublicKind::Active,
            base_generation: Some(base.generation()),
            base_scope: Some(base.scope_digest().to_owned()),
            base_zone: Some(base.zone_digest().to_owned()),
            base_proof: Some(base.public_proof().to_owned()),
            target_kind: CloudflareCredentialPublicKind::Active,
            target_generation: target.generation(),
            target_scope: target.scope_digest().to_owned(),
            target_zone: target.zone_digest().to_owned(),
            target_proof: target.public_proof().to_owned(),
        };

        assert_eq!(
            classify_recovery_custody(&plan, Ok(Some(target))),
            CloudflareCustodyComparison::ExactTarget
        );
        assert_eq!(
            classify_recovery_custody(&plan, Ok(Some(base))),
            CloudflareCustodyComparison::ExactBase
        );
        assert_eq!(
            classify_recovery_custody(&plan, Ok(Some(active(&connection, target_zone, 3)))),
            CloudflareCustodyComparison::OtherCanonical
        );
        assert_eq!(
            classify_recovery_custody(&plan, Ok(None)),
            CloudflareCustodyComparison::MissingOther
        );
        assert_eq!(
            classify_recovery_custody(&plan, Err(CloudflareKeychainError::Malformed)),
            CloudflareCustodyComparison::Malformed
        );
        assert_eq!(
            classify_recovery_custody(&plan, Err(CloudflareKeychainError::Unavailable)),
            CloudflareCustodyComparison::Unavailable
        );
        plan.base_generation = Some(0);
        assert_eq!(
            validate_recovery_plan(&plan),
            Err(CloudflareKeychainError::Malformed)
        );
        plan.base_generation = Some(2);
        assert_eq!(
            validate_recovery_plan(&plan),
            Err(CloudflareKeychainError::Malformed)
        );
    }

    #[test]
    fn envelope_rejects_malformed_tombstones_and_round_trips() {
        let active = active(&"a".repeat(64), "0123456789abcdef0123456789abcdef", 1);
        assert_eq!(
            CloudflareCredentialEnvelope::decode(&active.encode().unwrap())
                .unwrap()
                .token(),
            Some("token")
        );
        let tombstone = tombstone(&"a".repeat(64), "0123456789abcdef0123456789abcdef", 2);
        assert!(
            tombstone
                .encode()
                .unwrap()
                .windows(b"token".len())
                .all(|window| window != b"token")
        );
        let mut malformed: serde_json::Value =
            serde_json::from_slice(&active.encode().unwrap()).unwrap();
        malformed["token"] = serde_json::Value::Null;
        assert!(
            CloudflareCredentialEnvelope::decode(&serde_json::to_vec(&malformed).unwrap()).is_err()
        );
    }

    #[test]
    fn envelope_v3_mutation_of_every_public_tuple_field_is_never_exact() {
        let connection = "a".repeat(64);
        let zone = "0123456789abcdef0123456789abcdef";
        let expected = active(&connection, zone, 7);
        let original: serde_json::Value =
            serde_json::from_slice(&expected.encode().unwrap()).unwrap();
        let mutations = [
            ("schemaVersion", serde_json::json!(2)),
            ("providerKind", serde_json::json!("other")),
            ("capability", serde_json::json!("other")),
            ("state", serde_json::json!("tombstone")),
            (
                "connectionIncarnation",
                serde_json::json!("other-incarnation"),
            ),
            ("connectionDigest", serde_json::json!("d".repeat(64))),
            ("generation", serde_json::json!(8)),
            ("scopeDigest", serde_json::json!("d".repeat(64))),
            ("zoneDigest", serde_json::json!("d".repeat(64))),
            ("publicProof", serde_json::json!("d".repeat(64))),
        ];
        for (field, replacement) in mutations {
            let mut mutated = original.clone();
            mutated[field] = replacement;
            if let Ok(decoded) =
                CloudflareCredentialEnvelope::decode(&serde_json::to_vec(&mutated).unwrap())
            {
                assert!(
                    !matches_exact_envelope(&decoded, &expected),
                    "field {field}"
                );
            }
        }
    }

    #[test]
    fn explicit_target_allows_burned_gap_only_for_the_exact_full_base() {
        let zone = "0123456789abcdef0123456789abcdef";
        let zone_digest = cloudflare_zone_binding_digest(zone);
        let plan = Plan {
            base_kind: CloudflareCredentialPublicKind::Active,
            base_generation: Some(2),
            base_scope: Some(SCOPE.to_owned()),
            base_zone: Some(zone_digest.clone()),
            base_proof: Some(PROOF.to_owned()),
            target_generation: 5,
            target_zone: zone_digest,
        };
        assert_eq!(validate_provision_plan(&plan), Ok(()));
        let base = active(plan.connection_digest(), zone, 2);
        assert!(matches_expected_base(&plan, Some(&base)));

        let mut proof_drift = active(plan.connection_digest(), zone, 2);
        proof_drift.public_proof = "d".repeat(64);
        assert!(!matches_expected_base(&plan, Some(&proof_drift)));

        let invalid_target = Plan {
            target_generation: 2,
            ..plan
        };
        assert_eq!(
            validate_provision_plan(&invalid_target),
            Err(CloudflareKeychainError::Malformed)
        );
    }

    #[test]
    fn base_mismatch_invokes_only_remediation() {
        use std::cell::RefCell;

        let zone = "0123456789abcdef0123456789abcdef";
        let zone_digest = cloudflare_zone_binding_digest(zone);
        let plan = Plan {
            base_kind: CloudflareCredentialPublicKind::Active,
            base_generation: Some(2),
            base_scope: Some(SCOPE.to_owned()),
            base_zone: Some(zone_digest.clone()),
            base_proof: Some(PROOF.to_owned()),
            target_generation: 5,
            target_zone: zone_digest,
        };
        let target = active(plan.connection_digest(), zone, 5);
        let mismatch_events = RefCell::new(Vec::new());
        let mut drift = active(plan.connection_digest(), zone, 2);
        drift.public_proof = "d".repeat(64);
        assert_eq!(
            publish_after_base(
                &plan,
                &target,
                InspectedBase {
                    current: Some(&drift),
                    handle: (),
                },
                |()| {
                    mismatch_events.borrow_mut().push("marker");
                    Ok(())
                },
                |(), reason| {
                    mismatch_events.borrow_mut().push("remediate");
                    assert_eq!(reason, CloudflarePrewriteFailure::BaseMismatch);
                    Err(CloudflareKeychainError::BindingMismatch)
                },
                || {
                    mismatch_events.borrow_mut().push("write");
                    Ok(CloudflareCustodyComparison::ExactTarget)
                },
                |(), _| {
                    mismatch_events.borrow_mut().push("resolve");
                    Ok(())
                },
            ),
            Err(CloudflareKeychainError::BindingMismatch)
        );
        assert_eq!(*mismatch_events.borrow(), ["remediate"]);
    }

    #[test]
    fn callback_sequence_fences_marker_write_and_post_marker_resolution() {
        use std::cell::RefCell;

        let zone = "0123456789abcdef0123456789abcdef";
        let zone_digest = cloudflare_zone_binding_digest(zone);
        let plan = Plan {
            base_kind: CloudflareCredentialPublicKind::Active,
            base_generation: Some(2),
            base_scope: Some(SCOPE.to_owned()),
            base_zone: Some(zone_digest.clone()),
            base_proof: Some(PROOF.to_owned()),
            target_generation: 5,
            target_zone: zone_digest,
        };
        let base = active(plan.connection_digest(), zone, 2);
        let target = active(plan.connection_digest(), zone, 5);

        let marker_events = RefCell::new(Vec::new());
        assert_eq!(
            publish_after_base(
                &plan,
                &target,
                InspectedBase {
                    current: Some(&base),
                    handle: (),
                },
                |()| {
                    marker_events.borrow_mut().push("marker");
                    Err::<(), _>(CloudflareKeychainError::AuthorityStale)
                },
                |(), _| unreachable!("exact base cannot invoke remediation"),
                || {
                    marker_events.borrow_mut().push("write");
                    Ok(CloudflareCustodyComparison::ExactTarget)
                },
                |(), _| {
                    marker_events.borrow_mut().push("resolve");
                    Ok(())
                },
            ),
            Err(CloudflareKeychainError::AuthorityStale)
        );
        assert_eq!(*marker_events.borrow(), ["marker"]);

        let drain_events = RefCell::new(Vec::new());
        let result = publish_after_base(
            &plan,
            &target,
            InspectedBase {
                current: Some(&base),
                handle: "prepared",
            },
            |prepared| {
                drain_events.borrow_mut().push("marker");
                Ok(prepared)
            },
            |_, _| unreachable!("exact base cannot invoke remediation"),
            || {
                drain_events.borrow_mut().push("write-read-back");
                Ok(CloudflareCustodyComparison::Unavailable)
            },
            |marked, comparison| {
                drain_events.borrow_mut().push("resolve");
                Ok((marked, comparison))
            },
        )
        .unwrap();
        assert_eq!(
            result,
            ("prepared", CloudflareCustodyComparison::Unavailable)
        );
        assert_eq!(
            *drain_events.borrow(),
            ["marker", "write-read-back", "resolve"]
        );
    }

    #[test]
    fn missing_custody_is_exact_only_for_an_expected_absent_base() {
        let zone = "0123456789abcdef0123456789abcdef";
        let zone_digest = cloudflare_zone_binding_digest(zone);
        let absent_plan = Plan {
            base_kind: CloudflareCredentialPublicKind::Absent,
            base_generation: None,
            base_scope: None,
            base_zone: None,
            base_proof: None,
            target_generation: 1,
            target_zone: zone_digest.clone(),
        };
        let genesis_target = active(absent_plan.connection_digest(), zone, 1);
        let result = publish_after_base(
            &absent_plan,
            &genesis_target,
            InspectedBase {
                current: None,
                handle: (),
            },
            |()| Ok(()),
            |(), _| panic!("expected absence must not remediate"),
            || Ok(CloudflareCustodyComparison::ExactTarget),
            |(), comparison| Ok(comparison),
        )
        .unwrap();
        assert_eq!(result, CloudflareCustodyComparison::ExactTarget);

        let canonical_plan = Plan {
            base_kind: CloudflareCredentialPublicKind::Active,
            base_generation: Some(1),
            base_scope: Some(SCOPE.to_owned()),
            base_zone: Some(zone_digest.clone()),
            base_proof: Some(PROOF.to_owned()),
            target_generation: 2,
            target_zone: zone_digest,
        };
        let next_target = active(canonical_plan.connection_digest(), zone, 2);
        let result = publish_after_base(
            &canonical_plan,
            &next_target,
            InspectedBase {
                current: None,
                handle: (),
            },
            |()| panic!("missing canonical base must not mark"),
            |(), reason| Ok(reason),
            || panic!("missing canonical base must not write"),
            |(), _| panic!("missing canonical base must not resolve"),
        )
        .unwrap();
        assert_eq!(result, CloudflarePrewriteFailure::MissingOther);
    }

    #[test]
    fn generation_cas_rejects_rollback_and_tombstone_replacement() {
        let digest = "a".repeat(64);
        let zone = "0123456789abcdef0123456789abcdef";
        let current_tombstone = tombstone(&digest, zone, 8);
        let rollback = tombstone(&digest, zone, 7);
        assert_eq!(
            validate_generation_transition(Some(&current_tombstone), 7, &rollback),
            Err(CloudflareKeychainError::StaleGeneration)
        );
        let same_generation = tombstone(&digest, zone, 8);
        assert_eq!(
            validate_generation_transition(Some(&current_tombstone), 8, &same_generation),
            Err(CloudflareKeychainError::StaleGeneration)
        );
    }

    #[test]
    fn loaded_credential_is_not_admitted_after_attribute_drift() {
        let active = active(&"a".repeat(64), "0123456789abcdef0123456789abcdef", 1);
        let bytes = active.encode().unwrap();
        assert!(matches!(
            admit_loaded_envelope(&bytes, Err(CloudflareKeychainError::StateUnknown)),
            Err(CloudflareKeychainError::StateUnknown)
        ));
    }

    #[test]
    fn proof_inspection_distinguishes_exact_other_tombstone_and_binding_drift() {
        let connection = "a".repeat(64);
        let zone = "0123456789abcdef0123456789abcdef";
        let zone_digest = cloudflare_zone_binding_digest(zone);
        let active = active(&connection, zone, 8);
        assert!(matches!(
            classify_envelope(&active, INCARNATION, &connection, 8, SCOPE, &zone_digest, PROOF)
                .unwrap(),
            CloudflareCredentialProofInspection::ExactActive { generation: 8, public_proof }
                if public_proof == PROOF
        ));
        assert!(matches!(
            classify_envelope(
                &active,
                INCARNATION,
                &connection,
                9,
                SCOPE,
                &zone_digest,
                PROOF
            )
            .unwrap(),
            CloudflareCredentialProofInspection::OtherValidGeneration {
                generation: 8,
                state: CloudflareCredentialProofState::Active,
                public_proof: Some(_),
            }
        ));
        let tombstone = tombstone(&connection, zone, 9);
        assert_eq!(
            classify_envelope(
                &tombstone,
                INCARNATION,
                &connection,
                9,
                SCOPE,
                &zone_digest,
                PROOF,
            )
            .unwrap(),
            CloudflareCredentialProofInspection::ExactTombstone { generation: 9 }
        );
        assert_eq!(
            classify_envelope(
                &active,
                "other-incarnation",
                &connection,
                8,
                SCOPE,
                &zone_digest,
                PROOF,
            ),
            Err(CloudflareKeychainError::BindingMismatch)
        );
        assert_eq!(
            classify_envelope(
                &active,
                INCARNATION,
                &connection,
                8,
                SCOPE,
                &"d".repeat(64),
                PROOF,
            ),
            Err(CloudflareKeychainError::BindingMismatch)
        );
    }

    #[test]
    fn stale_authority_guard_prevents_credential_write_callback() {
        let wrote = AtomicBool::new(false);
        let mut guard = || Err(CloudflareKeychainError::AuthorityStale);
        let result = guarded_credential_write(&mut guard, || {
            wrote.store(true, Ordering::SeqCst);
            Ok(())
        });
        assert_eq!(result, Err(CloudflareKeychainError::AuthorityStale));
        assert!(!wrote.load(Ordering::SeqCst));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_lock_child_process() {
        let Ok(root) = std::env::var("GOODDEALER_KEYCHAIN_LOCK_TEST_ROOT") else {
            return;
        };
        let role = std::env::var("GOODDEALER_KEYCHAIN_LOCK_TEST_ROLE").unwrap();
        let digest = std::env::var("GOODDEALER_KEYCHAIN_LOCK_TEST_DIGEST").unwrap();
        let root = std::path::PathBuf::from(root);
        let lock = KeychainLock::acquire(&digest).unwrap();
        std::fs::write(root.join(format!("{role}.acquired")), b"acquired").unwrap();
        let release = root.join(format!("{role}.release"));
        for _ in 0..500 {
            if release.exists() {
                drop(lock);
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("parent did not release child lock");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn kernel_lock_serializes_competing_processes_and_recovers_after_exit() {
        use std::process::{Child, Command};

        fn spawn_child(
            root: &std::path::Path,
            temp_override: &std::path::Path,
            role: &str,
            digest: &str,
        ) -> Child {
            Command::new(std::env::current_exe().unwrap())
                .arg("--exact")
                .arg("cloudflare_keychain::tests::keychain_lock_child_process")
                .arg("--nocapture")
                .env("GOODDEALER_KEYCHAIN_LOCK_TEST_ROOT", root)
                .env("GOODDEALER_KEYCHAIN_LOCK_TEST_ROLE", role)
                .env("GOODDEALER_KEYCHAIN_LOCK_TEST_DIGEST", digest)
                .env("TMPDIR", temp_override)
                .spawn()
                .unwrap()
        }

        fn wait_for(path: &std::path::Path) {
            for _ in 0..300 {
                if path.exists() {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            panic!("timed out waiting for lock test marker");
        }

        let directory = tempfile::tempdir().unwrap();
        let marker_directory = directory.path().join("markers");
        let first_temp = directory.path().join("first-tmp");
        let second_temp = directory.path().join("second-tmp");
        std::fs::create_dir_all(&marker_directory).unwrap();
        std::fs::create_dir_all(&first_temp).unwrap();
        std::fs::create_dir_all(&second_temp).unwrap();
        let digest = format!("{:064x}", std::process::id());
        let first_acquired = marker_directory.join("first.acquired");
        let second_acquired = marker_directory.join("second.acquired");
        let mut first = spawn_child(&marker_directory, &first_temp, "first", &digest);
        wait_for(&first_acquired);
        let mut second = spawn_child(&marker_directory, &second_temp, "second", &digest);
        std::thread::sleep(std::time::Duration::from_millis(150));
        assert!(!second_acquired.exists());

        first.kill().unwrap();
        assert!(!first.wait().unwrap().success());
        wait_for(&second_acquired);
        std::fs::write(marker_directory.join("second.release"), b"release").unwrap();
        assert!(second.wait().unwrap().success());

        let lock_path = production_lock_directory().join(format!("{SERVICE}.{digest}.lock"));
        std::fs::remove_file(lock_path).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_attribute_readback_accepts_only_when_unlocked_this_device_only() {
        let digest = "a".repeat(64);
        let mut values = std::collections::HashMap::from([
            ("svce".to_owned(), SERVICE.to_owned()),
            ("acct".to_owned(), digest.clone()),
            (
                "pdmn".to_owned(),
                WHEN_UNLOCKED_THIS_DEVICE_ONLY_PROTECTION_DOMAIN.to_owned(),
            ),
            ("accc".to_owned(), "opaque".to_owned()),
            (
                "agrp".to_owned(),
                "A1B2C3D4E5.app.gooddealer.desktop".to_owned(),
            ),
        ]);
        assert!(valid_keychain_attribute_values(&values, &digest));

        for rejected_protection_domain in ["ak", "akpu"] {
            values.insert("pdmn".to_owned(), rejected_protection_domain.to_owned());
            assert!(
                !valid_keychain_attribute_values(&values, &digest),
                "accepted mismatched protection domain {rejected_protection_domain}"
            );
        }
        values.insert(
            "pdmn".to_owned(),
            WHEN_UNLOCKED_THIS_DEVICE_ONLY_PROTECTION_DOMAIN.to_owned(),
        );

        values.remove("accc");
        assert!(!valid_keychain_attribute_values(&values, &digest));
        values.insert("accc".to_owned(), "opaque".to_owned());
        values.insert("agrp".to_owned(), "shared.other.app".to_owned());
        assert!(!valid_keychain_attribute_values(&values, &digest));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_attribute_readback_rejects_synchronized_matches() {
        assert!(synchronized_attribute_search_is_empty(0));
        assert!(!synchronized_attribute_search_is_empty(1));
        assert!(!synchronized_attribute_search_is_empty(2));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lock_rejects_wide_directory_permissions_and_symlink_substitution() {
        use std::os::unix::fs::{PermissionsExt, symlink};

        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            KeychainLock::acquire_at(directory.path(), &"a".repeat(64)),
            Err(CloudflareKeychainError::Unavailable)
        ));

        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let target = directory.path().join("target");
        std::fs::write(&target, b"").unwrap();
        let lock_path = directory
            .path()
            .join(format!("{SERVICE}.{}.lock", "a".repeat(64)));
        symlink(target, lock_path).unwrap();
        assert!(matches!(
            KeychainLock::acquire_at(directory.path(), &"a".repeat(64)),
            Err(CloudflareKeychainError::Unavailable)
        ));
    }
}
