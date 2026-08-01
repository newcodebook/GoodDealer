use serde::Deserialize;

const DEVICE_IDENTITY_SCHEMA_VERSION: u16 = 1;
const TRANSCRIPT_DOMAIN: &[u8] = b"GOODDEALER-DEVICE-IDENTITY-V1\0";

#[derive(Debug, PartialEq, Eq)]
pub enum DeviceIdentityValidationError {
    InvalidJson,
    UnsupportedVersion,
    InvalidKeyVersion,
    EmptyField,
    InvalidEncoding,
    UnexpectedCredentialType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TranscriptEncodingError;

#[derive(Debug, Clone, Copy)]
pub struct DeviceBindingTranscript<'a> {
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
    let expected_key_version = transcript.expected_key_version.to_string();
    for field in [
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
    if matches!(challenge.purpose, ChallengePurpose::Binding) && challenge.expected_key_version != 0
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
        || challenge.expires_at.is_empty()
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
    offline_execute_until: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OfflineDeviceLeasePayload {
    credential_epoch: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EntitlementPayload {
    plan: String,
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
            if envelope.payload.lease_epoch == 0
                || envelope.payload.offline_execute_until.is_empty()
            {
                return Err(DeviceIdentityValidationError::EmptyField);
            }
            let _ = (envelope.iss, envelope.aud);
            Ok(())
        }
        SignedCredentialEnvelope::OfflineDeviceLease(envelope)
            if expected == ExpectedCredentialType::OfflineDeviceLease =>
        {
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
            if envelope.payload.credential_epoch == 0 {
                return Err(DeviceIdentityValidationError::EmptyField);
            }
            let _ = (envelope.iss, envelope.aud);
            Ok(())
        }
        SignedCredentialEnvelope::Entitlement(envelope)
            if expected == ExpectedCredentialType::Entitlement =>
        {
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
            if !is_identifier(&envelope.payload.plan) {
                return Err(DeviceIdentityValidationError::EmptyField);
            }
            let _ = (envelope.iss, envelope.aud);
            Ok(())
        }
        SignedCredentialEnvelope::BootstrapCapability(envelope)
            if expected == ExpectedCredentialType::BootstrapCapability =>
        {
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
            if !is_identifier(&envelope.payload.device_switch_request_id) {
                return Err(DeviceIdentityValidationError::EmptyField);
            }
            let _ = (envelope.iss, envelope.aud);
            Ok(())
        }
        _ => Err(DeviceIdentityValidationError::UnexpectedCredentialType),
    }
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
    if identifiers.into_iter().any(|field| !is_identifier(field))
        || issued_at.is_empty()
        || expires_at.is_empty()
    {
        return Err(DeviceIdentityValidationError::EmptyField);
    }
    if !is_base64_url(signature) {
        return Err(DeviceIdentityValidationError::InvalidEncoding);
    }
    Ok(())
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160
}

fn is_base64_url(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::{
        DeviceBindingTranscript, encode_device_binding_transcript,
        validate_active_device_lease_json, validate_device_binding_challenge_json,
    };

    const VALID_CHALLENGE: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/binding-challenge.json"
    );
    const VALID_CREDENTIAL: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/active-device-lease.json"
    );
    const VALID_ENTITLEMENT: &str = include_str!(
        "../../../packages/protocol/test-vectors/device-identity/valid/entitlement.json"
    );
    const INVALID_CHALLENGES: [&str; 2] = [
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/challenge-unknown-field.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/challenge-version-rollback.json"
        ),
    ];
    const INVALID_CREDENTIALS: [&str; 3] = [
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-cross-audience.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-unknown-field.json"
        ),
        include_str!(
            "../../../packages/protocol/test-vectors/device-identity/invalid/credential-unknown-version.json"
        ),
    ];

    #[test]
    fn mirrors_device_identity_golden_corpus() {
        assert!(validate_device_binding_challenge_json(VALID_CHALLENGE).is_ok());
        assert!(validate_active_device_lease_json(VALID_CREDENTIAL).is_ok());
        assert!(validate_active_device_lease_json(VALID_ENTITLEMENT).is_err());
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
