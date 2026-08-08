use serde::{Deserialize, Deserializer};

const DEVICE_IDENTITY_SCHEMA_VERSION: u16 = 1;
const TRANSCRIPT_DOMAIN: &[u8] = b"GOODDEALER-DEVICE-IDENTITY-V1\0";
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, PartialEq, Eq)]
pub enum DeviceIdentityValidationError {
    InvalidJson,
    UnsupportedVersion,
    InvalidKeyVersion,
    EmptyField,
    InvalidEncoding,
    InvalidTimestamp,
    UnexpectedCredentialType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TranscriptEncodingError;

#[derive(Debug, Clone, Copy)]
pub struct DeviceBindingTranscript<'a> {
    pub schema_version: u16,
    pub algorithm: &'a str,
    pub purpose: &'a str,
    pub challenge_id: &'a str,
    pub account_id: &'a str,
    pub device_id: &'a str,
    pub nonce: &'a str,
    pub proposed_key_id: &'a str,
    pub proposed_public_key_fingerprint: &'a str,
    pub expected_key_version: u64,
    pub expires_at: &'a str,
    pub reauth_proof_id: &'a str,
}

/// Builds the deterministic, domain-separated, length-delimited preimage that an audited crypto
/// provider signs. This function does not implement Ed25519.
///
/// # Errors
///
/// Returns [`TranscriptEncodingError`] if any field is larger than the `u32` length prefix.
pub fn encode_device_binding_transcript(
    transcript: &DeviceBindingTranscript<'_>,
) -> Result<Vec<u8>, TranscriptEncodingError> {
    let mut encoded = Vec::with_capacity(256);
    encoded.extend_from_slice(TRANSCRIPT_DOMAIN);
    let schema_version = transcript.schema_version.to_string();
    let expected_key_version = transcript.expected_key_version.to_string();
    for field in [
        &schema_version,
        transcript.algorithm,
        transcript.purpose,
        transcript.challenge_id,
        transcript.account_id,
        transcript.device_id,
        transcript.nonce,
        transcript.proposed_key_id,
        transcript.proposed_public_key_fingerprint,
        &expected_key_version,
        transcript.expires_at,
        transcript.reauth_proof_id,
    ] {
        let length = u32::try_from(field.len()).map_err(|_| TranscriptEncodingError)?;
        encoded.extend_from_slice(&length.to_be_bytes());
        encoded.extend_from_slice(field.as_bytes());
    }
    Ok(encoded)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceBindingChallenge {
    schema_version: u16,
    purpose: ChallengePurpose,
    challenge_id: String,
    account_id: String,
    device_id: String,
    nonce: String,
    #[serde(rename = "algorithm")]
    _algorithm: Algorithm,
    proposed_key_id: String,
    proposed_public_key_fingerprint: String,
    expected_key_version: u64,
    expires_at: String,
    reauth_proof_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum ChallengePurpose {
    Binding,
    Rotation,
}

#[derive(Deserialize)]
enum Algorithm {
    Ed25519,
}

/// Validates the strict Rust mirror of a public device binding challenge.
///
/// # Errors
///
/// Rejects malformed JSON, unknown fields, unsupported versions, empty semantic fields, and a
/// binding/rotation key-version mismatch.
pub fn validate_device_binding_challenge_json(
    source: &str,
) -> Result<(), DeviceIdentityValidationError> {
    let challenge: DeviceBindingChallenge =
        serde_json::from_str(source).map_err(|_| DeviceIdentityValidationError::InvalidJson)?;
    if challenge.schema_version != DEVICE_IDENTITY_SCHEMA_VERSION {
        return Err(DeviceIdentityValidationError::UnsupportedVersion);
    }
    if challenge.expected_key_version > MAX_JAVASCRIPT_SAFE_INTEGER
        || matches!(challenge.purpose, ChallengePurpose::Binding)
            && challenge.expected_key_version != 0
        || matches!(challenge.purpose, ChallengePurpose::Rotation)
            && challenge.expected_key_version == 0
    {
        return Err(DeviceIdentityValidationError::InvalidKeyVersion);
    }
    if [
        &challenge.challenge_id,
        &challenge.account_id,
        &challenge.device_id,
        &challenge.proposed_key_id,
        &challenge.reauth_proof_id,
    ]
    .into_iter()
    .any(|field| !is_identifier(field))
        || !is_canonical_utc_timestamp(&challenge.expires_at)
    {
        return Err(DeviceIdentityValidationError::EmptyField);
    }
    if !is_base64_url(&challenge.nonce)
        || !is_base64_url(&challenge.proposed_public_key_fingerprint)
    {
        return Err(DeviceIdentityValidationError::InvalidEncoding);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(tag = "typ")]
enum SignedCredentialEnvelope {
    #[serde(rename = "gd.active-device-lease.v1")]
    ActiveDeviceLease(ActiveDeviceLeaseEnvelope),
    #[serde(rename = "gd.offline-device-lease.v1")]
    OfflineDeviceLease(OfflineDeviceLeaseEnvelope),
    #[serde(rename = "gd.entitlement.v1")]
    Entitlement(EntitlementEnvelope),
    #[serde(rename = "gd.bootstrap-capability.v1")]
    BootstrapCapability(BootstrapCapabilityEnvelope),
}

macro_rules! credential_envelope {
    ($name:ident, $audience:ty, $payload:ty) => {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct $name {
            schema_version: u16,
            iss: Issuer,
            aud: $audience,
            kid: String,
            account_id: String,
            device_id: String,
            account_security_epoch: u64,
            jti: String,
            issued_at: String,
            expires_at: String,
            payload: $payload,
            signature: String,
        }
    };
}

credential_envelope!(
    ActiveDeviceLeaseEnvelope,
    ActiveDeviceLeaseAudience,
    ActiveDeviceLeasePayload
);
credential_envelope!(
    OfflineDeviceLeaseEnvelope,
    OfflineDeviceLeaseAudience,
    OfflineDeviceLeasePayload
);
credential_envelope!(EntitlementEnvelope, EntitlementAudience, EntitlementPayload);
credential_envelope!(
    BootstrapCapabilityEnvelope,
    BootstrapAudience,
    BootstrapPayload
);

#[derive(Deserialize)]
enum Issuer {
    #[serde(rename = "https://accounts.gooddealer.com")]
    Accounts,
}

#[derive(Deserialize)]
enum ActiveDeviceLeaseAudience {
    #[serde(rename = "gooddealer-desktop/active-device-lease")]
    Desktop,
}

#[derive(Deserialize)]
enum OfflineDeviceLeaseAudience {
    #[serde(rename = "gooddealer-desktop/offline-device-lease")]
    Desktop,
}

#[derive(Deserialize)]
enum EntitlementAudience {
    #[serde(rename = "gooddealer-desktop/entitlement")]
    Desktop,
}

#[derive(Deserialize)]
enum BootstrapAudience {
    #[serde(rename = "gooddealer-desktop/bootstrap")]
    Desktop,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveDeviceLeasePayload {
    lease_epoch: u64,
    renew_after: String,
    online_expires_at: String,
    offline_execute_until: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OfflineDeviceLeasePayload {
    credential_epoch: u64,
    renew_after: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum EntitlementKind {
    Subscription,
    Lifetime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntitlementPayload {
    license_id: String,
    entitlement_revision: u64,
    payment_watermark: String,
    plan: String,
    entitlement_kind: EntitlementKind,
    #[serde(deserialize_with = "deserialize_required_nullable_string")]
    commercial_expires_at: Option<String>,
    offline_grace_until: String,
    device_limit: u8,
    active_device_limit: u8,
    standby_cloud_read: bool,
    feature_entitlements: Vec<String>,
    all_major_versions: bool,
}

fn deserialize_required_nullable_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BootstrapPayload {
    device_switch_request_id: String,
}

/// Validates type/audience isolation and the strict Rust mirror of signed credential envelopes.
/// Cryptographic signature verification belongs to the audited crypto provider and is not claimed
/// by this wire-level function.
///
/// # Errors
///
/// Rejects malformed JSON, cross-type audiences, unknown fields, unsupported versions, and empty
/// common fields.
fn validate_signed_credential_envelope_json(
    source: &str,
    expected: ExpectedCredentialType,
) -> Result<(), DeviceIdentityValidationError> {
    let envelope: SignedCredentialEnvelope =
        serde_json::from_str(source).map_err(|_| DeviceIdentityValidationError::InvalidJson)?;
    match envelope {
        SignedCredentialEnvelope::ActiveDeviceLease(envelope)
            if expected == ExpectedCredentialType::ActiveDeviceLease =>
        {
            validate_active_device_lease_envelope(&envelope)
        }
        SignedCredentialEnvelope::OfflineDeviceLease(envelope)
            if expected == ExpectedCredentialType::OfflineDeviceLease =>
        {
            validate_offline_device_lease_envelope(&envelope)
        }
        SignedCredentialEnvelope::Entitlement(envelope)
            if expected == ExpectedCredentialType::Entitlement =>
        {
            validate_entitlement_envelope(&envelope)
        }
        SignedCredentialEnvelope::BootstrapCapability(envelope)
            if expected == ExpectedCredentialType::BootstrapCapability =>
        {
            validate_bootstrap_capability_envelope(&envelope)
        }
        _ => Err(DeviceIdentityValidationError::UnexpectedCredentialType),
    }
}

fn validate_active_device_lease_envelope(
    envelope: &ActiveDeviceLeaseEnvelope,
) -> Result<(), DeviceIdentityValidationError> {
    validate_common(
        envelope.schema_version,
        [
            &envelope.kid,
            &envelope.account_id,
            &envelope.device_id,
            &envelope.jti,
        ],
        &envelope.issued_at,
        &envelope.expires_at,
        &envelope.signature,
    )?;
    if envelope.account_security_epoch == 0
        || envelope.account_security_epoch > MAX_JAVASCRIPT_SAFE_INTEGER
        || envelope.payload.lease_epoch == 0
        || envelope.payload.lease_epoch > MAX_JAVASCRIPT_SAFE_INTEGER
        || !is_canonical_utc_timestamp(&envelope.payload.renew_after)
        || !is_canonical_utc_timestamp(&envelope.payload.online_expires_at)
        || !is_canonical_utc_timestamp(&envelope.payload.offline_execute_until)
        || envelope.payload.renew_after <= envelope.issued_at
        || envelope.payload.online_expires_at <= envelope.payload.renew_after
        || envelope.payload.offline_execute_until < envelope.payload.online_expires_at
        || envelope.payload.offline_execute_until != envelope.expires_at
        || canonical_utc_seconds(&envelope.payload.offline_execute_until)
            .zip(canonical_utc_seconds(&envelope.issued_at))
            .is_none_or(|(offline, issued)| offline - issued > 86_400)
    {
        return Err(DeviceIdentityValidationError::EmptyField);
    }
    let _ = (&envelope.iss, &envelope.aud);
    Ok(())
}

fn validate_offline_device_lease_envelope(
    envelope: &OfflineDeviceLeaseEnvelope,
) -> Result<(), DeviceIdentityValidationError> {
    validate_common(
        envelope.schema_version,
        [
            &envelope.kid,
            &envelope.account_id,
            &envelope.device_id,
            &envelope.jti,
        ],
        &envelope.issued_at,
        &envelope.expires_at,
        &envelope.signature,
    )?;
    if envelope.account_security_epoch == 0
        || envelope.account_security_epoch > MAX_JAVASCRIPT_SAFE_INTEGER
        || envelope.payload.credential_epoch == 0
        || envelope.payload.credential_epoch > MAX_JAVASCRIPT_SAFE_INTEGER
        || !is_canonical_utc_timestamp(&envelope.payload.renew_after)
        || envelope.payload.renew_after <= envelope.issued_at
        || envelope.expires_at <= envelope.payload.renew_after
    {
        return Err(DeviceIdentityValidationError::EmptyField);
    }
    let _ = (&envelope.iss, &envelope.aud);
    Ok(())
}

fn validate_entitlement_envelope(
    envelope: &EntitlementEnvelope,
) -> Result<(), DeviceIdentityValidationError> {
    validate_common(
        envelope.schema_version,
        [
            &envelope.kid,
            &envelope.account_id,
            &envelope.device_id,
            &envelope.jti,
        ],
        &envelope.issued_at,
        &envelope.expires_at,
        &envelope.signature,
    )?;
    let payload = &envelope.payload;
    let valid_kind = match payload.entitlement_kind {
        EntitlementKind::Lifetime => {
            payload.commercial_expires_at.is_none() && payload.all_major_versions
        }
        EntitlementKind::Subscription => {
            payload
                .commercial_expires_at
                .as_deref()
                .is_some_and(|value| !value.is_empty())
                && !payload.all_major_versions
        }
    };
    if envelope.account_security_epoch == 0
        || envelope.account_security_epoch > MAX_JAVASCRIPT_SAFE_INTEGER
        || payload.entitlement_revision == 0
        || payload.entitlement_revision > MAX_JAVASCRIPT_SAFE_INTEGER
        || !is_identifier(&payload.payment_watermark)
        || !is_identifier(&payload.license_id)
        || !is_identifier(&payload.plan)
        || !is_canonical_utc_timestamp(&payload.offline_grace_until)
        || payload.offline_grace_until < envelope.expires_at
        || payload.device_limit != 2
        || payload.active_device_limit != 1
        || !payload.standby_cloud_read
        || payload.feature_entitlements.len() > 128
        || payload
            .feature_entitlements
            .iter()
            .any(|feature| !is_identifier(feature))
        || !valid_kind
    {
        return Err(DeviceIdentityValidationError::EmptyField);
    }
    if let Some(commercial_expires_at) = payload.commercial_expires_at.as_deref()
        && (!is_canonical_utc_timestamp(commercial_expires_at)
            || payload.offline_grace_until.as_str() < commercial_expires_at)
    {
        return Err(DeviceIdentityValidationError::InvalidTimestamp);
    }
    let _ = (&envelope.iss, &envelope.aud);
    Ok(())
}

fn validate_bootstrap_capability_envelope(
    envelope: &BootstrapCapabilityEnvelope,
) -> Result<(), DeviceIdentityValidationError> {
    validate_common(
        envelope.schema_version,
        [
            &envelope.kid,
            &envelope.account_id,
            &envelope.device_id,
            &envelope.jti,
        ],
        &envelope.issued_at,
        &envelope.expires_at,
        &envelope.signature,
    )?;
    if envelope.account_security_epoch == 0
        || envelope.account_security_epoch > MAX_JAVASCRIPT_SAFE_INTEGER
        || !is_identifier(&envelope.payload.device_switch_request_id)
    {
        return Err(DeviceIdentityValidationError::EmptyField);
    }
    let _ = (&envelope.iss, &envelope.aud);
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExpectedCredentialType {
    ActiveDeviceLease,
    OfflineDeviceLease,
    Entitlement,
    BootstrapCapability,
}

/// Validates only an `ActiveDeviceLease` envelope for an `ActiveDeviceLease` consumption point.
/// Cryptographic verification remains the responsibility of the audited crypto provider.
///
/// # Errors
///
/// Rejects any other valid credential type as well as malformed or incompatible envelopes.
pub fn validate_active_device_lease_json(
    source: &str,
) -> Result<(), DeviceIdentityValidationError> {
    validate_signed_credential_envelope_json(source, ExpectedCredentialType::ActiveDeviceLease)
}

/// Validates only an `OfflineDeviceLease` envelope.
///
/// # Errors
///
/// Rejects any other valid credential type as well as malformed or incompatible envelopes.
pub fn validate_offline_device_lease_json(
    source: &str,
) -> Result<(), DeviceIdentityValidationError> {
    validate_signed_credential_envelope_json(source, ExpectedCredentialType::OfflineDeviceLease)
}

/// Validates only an Entitlement envelope.
///
/// # Errors
///
/// Rejects any other valid credential type as well as malformed or incompatible envelopes.
pub fn validate_entitlement_json(source: &str) -> Result<(), DeviceIdentityValidationError> {
    validate_signed_credential_envelope_json(source, ExpectedCredentialType::Entitlement)
}

/// Validates only a `BootstrapCapability` envelope.
///
/// # Errors
///
/// Rejects any other valid credential type as well as malformed or incompatible envelopes.
pub fn validate_bootstrap_capability_json(
    source: &str,
) -> Result<(), DeviceIdentityValidationError> {
    validate_signed_credential_envelope_json(source, ExpectedCredentialType::BootstrapCapability)
}

fn validate_common(
    schema_version: u16,
    identifiers: [&str; 4],
    issued_at: &str,
    expires_at: &str,
    signature: &str,
) -> Result<(), DeviceIdentityValidationError> {
    if schema_version != DEVICE_IDENTITY_SCHEMA_VERSION {
        return Err(DeviceIdentityValidationError::UnsupportedVersion);
    }
    if identifiers.into_iter().any(|field| !is_identifier(field)) {
        return Err(DeviceIdentityValidationError::EmptyField);
    }
    if !is_canonical_utc_timestamp(issued_at)
        || !is_canonical_utc_timestamp(expires_at)
        || issued_at >= expires_at
    {
        return Err(DeviceIdentityValidationError::InvalidTimestamp);
    }
    if !is_base64_url(signature) {
        return Err(DeviceIdentityValidationError::InvalidEncoding);
    }
    Ok(())
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160 && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn is_base64_url(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn is_canonical_utc_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return false;
    }
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    if digits
        .into_iter()
        .any(|index| !bytes[index].is_ascii_digit())
    {
        return false;
    }
    let number = |start: usize, length: usize| -> u32 {
        bytes[start..start + length]
            .iter()
            .fold(0, |value, byte| value * 10 + u32::from(*byte - b'0'))
    };
    let year = number(0, 4);
    let month = number(5, 2);
    let day = number(8, 2);
    let hour = number(11, 2);
    let minute = number(14, 2);
    let second = number(17, 2);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days_in_month).contains(&day) && hour <= 23 && minute <= 59 && second <= 59
}

fn canonical_utc_seconds(value: &str) -> Option<i64> {
    if !is_canonical_utc_timestamp(value) {
        return None;
    }
    let bytes = value.as_bytes();
    let number = |start: usize, length: usize| -> i64 {
        bytes[start..start + length]
            .iter()
            .fold(0, |result, byte| result * 10 + i64::from(*byte - b'0'))
    };
    let year = number(0, 4);
    let month = number(5, 2);
    let day = number(8, 2);
    let hour = number(11, 2);
    let minute = number(14, 2);
    let second = number(17, 2);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_offsets = [0_i64, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let days_before_year = 365 * year + (year + 3) / 4 - (year + 99) / 100 + (year + 399) / 400;
    let leap_day = i64::from(leap && month > 2);
    let month_index = usize::try_from(month - 1).ok()?;
    let days = days_before_year + *month_offsets.get(month_index)? + leap_day + day - 1;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

#[cfg(test)]
mod tests {
    use super::{
        DeviceBindingTranscript, encode_device_binding_transcript,
        validate_active_device_lease_json, validate_device_binding_challenge_json,
        validate_entitlement_json, validate_offline_device_lease_json,
    };

    const VALID_CHALLENGE: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/binding-challenge.json"
    );
    const VALID_CREDENTIAL: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/active-device-lease.json"
    );
    const VALID_OFFLINE_DEVICE_LEASE: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/offline-device-lease.json"
    );
    const VALID_ENTITLEMENT: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/entitlement.json"
    );
    const VALID_GRACE_ENTITLEMENT: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/entitlement-grace.json"
    );
    const INVALID_LIFETIME_ENTITLEMENT: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/invalid/entitlement-lifetime-expiry.json"
    );
    const INVALID_MISSING_COMMERCIAL_EXPIRY: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/invalid/entitlement-missing-commercial-expiry.json"
    );
    const INVALID_ENTITLEMENT_TIME: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/invalid/entitlement-invalid-time.json"
    );
    const INVALID_ENTITLEMENT_EXPIRY_AFTER_GRACE: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/invalid/entitlement-expiry-after-grace.json"
    );
    const INVALID_ACTIVE_LEASE_WINDOW: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/invalid/active-lease-offline-window-too-long.json"
    );
    const INVALID_OFFLINE_LEASE_RENEWAL: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/invalid/offline-lease-renewal-after-access.json"
    );
    const INVALID_CHALLENGES: [&str; 3] = [
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/challenge-unknown-field.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/challenge-version-rollback.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/challenge-unsafe-key-version.json"
        ),
    ];
    const INVALID_CREDENTIALS: [&str; 6] = [
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-cross-audience.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-unknown-field.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-unknown-version.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-unsafe-lease-epoch.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-invalid-time-order.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-snake-case-wire.json"
        ),
    ];

    #[test]
    fn mirrors_device_identity_golden_corpus() {
        assert!(validate_device_binding_challenge_json(VALID_CHALLENGE).is_ok());
        assert!(validate_active_device_lease_json(VALID_CREDENTIAL).is_ok());
        assert!(validate_offline_device_lease_json(VALID_OFFLINE_DEVICE_LEASE).is_ok());
        assert!(validate_offline_device_lease_json(INVALID_OFFLINE_LEASE_RENEWAL).is_err());
        assert!(validate_active_device_lease_json(VALID_ENTITLEMENT).is_err());
        assert!(validate_entitlement_json(VALID_ENTITLEMENT).is_ok());
        assert!(validate_entitlement_json(VALID_GRACE_ENTITLEMENT).is_ok());
        assert!(validate_entitlement_json(INVALID_LIFETIME_ENTITLEMENT).is_err());
        assert!(validate_entitlement_json(INVALID_MISSING_COMMERCIAL_EXPIRY).is_err());
        assert!(validate_entitlement_json(INVALID_ENTITLEMENT_TIME).is_err());
        assert!(validate_entitlement_json(INVALID_ENTITLEMENT_EXPIRY_AFTER_GRACE).is_err());
        assert!(validate_active_device_lease_json(INVALID_ACTIVE_LEASE_WINDOW).is_err());
        assert!(
            INVALID_CHALLENGES
                .into_iter()
                .all(|vector| validate_device_binding_challenge_json(vector).is_err())
        );
        assert!(
            INVALID_CREDENTIALS
                .into_iter()
                .all(|vector| validate_active_device_lease_json(vector).is_err())
        );
    }

    #[test]
    fn transcript_is_length_delimited_and_domain_separated() {
        let original = DeviceBindingTranscript {
            schema_version: 1,
            algorithm: "Ed25519",
            purpose: "binding",
            challenge_id: "challenge-01",
            account_id: "account-01",
            device_id: "device-01",
            nonce: "nonce-01",
            proposed_key_id: "key-01",
            proposed_public_key_fingerprint: "fingerprint-01",
            expected_key_version: 0,
            expires_at: "2026-08-01T10:05:00Z",
            reauth_proof_id: "reauth-01",
        };
        let changed = DeviceBindingTranscript {
            nonce: "nonce-02",
            ..original
        };
        let original = encode_device_binding_transcript(&original).expect("bounded transcript");
        let changed = encode_device_binding_transcript(&changed).expect("bounded transcript");
        assert!(original.starts_with(b"GOODDEALER-DEVICE-IDENTITY-V1\0"));
        assert_ne!(original, changed);
    }
}
