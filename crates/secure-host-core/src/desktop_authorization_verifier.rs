//! Purpose-specific Ed25519 verification for Cloud-issued Desktop authorization credentials.

use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::Deserialize;

const ED25519_PUBLIC_KEY_BYTES: usize = 32;
const ED25519_SIGNATURE_BYTES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DesktopAuthorizationCredentialPurpose {
    // Stable key purpose; v4 grants use their new transcript domain with this same trust root.
    GrantV3,
    ActiveDeviceLeaseV1,
    StandbyGrantV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorizationVerificationKeyError {
    IdentifierRejected,
    KeyRejected,
    DuplicateKey,
    RegistryRejected,
}

/// Parses the build-pinned, purpose-separated public-key allowlist used by Desktop.
///
/// # Errors
///
/// Rejects unknown fields, malformed keys, duplicates, oversized registries, and a registry that
/// omits the Active Grant, Lease, or Standby Grant purpose.
pub fn parse_desktop_authorization_verifier_registry(
    value: &str,
) -> Result<DesktopAuthorizationVerifier, AuthorizationVerificationKeyError> {
    if value.is_empty() || value.len() > 16_384 {
        return Err(AuthorizationVerificationKeyError::RegistryRejected);
    }
    let registry: VerificationRegistryWire = serde_json::from_str(value)
        .map_err(|_| AuthorizationVerificationKeyError::RegistryRejected)?;
    if registry.schema_version != 1 || registry.keys.is_empty() || registry.keys.len() > 24 {
        return Err(AuthorizationVerificationKeyError::RegistryRejected);
    }
    let mut has_grant = false;
    let mut has_lease = false;
    let mut has_standby = false;
    let mut keys = Vec::with_capacity(registry.keys.len());
    for wire in registry.keys {
        let purpose = match wire.purpose {
            VerificationPurposeWire::GrantV3 => {
                has_grant = true;
                DesktopAuthorizationCredentialPurpose::GrantV3
            }
            VerificationPurposeWire::ActiveDeviceLeaseV1 => {
                has_lease = true;
                DesktopAuthorizationCredentialPurpose::ActiveDeviceLeaseV1
            }
            VerificationPurposeWire::StandbyGrantV1 => {
                has_standby = true;
                DesktopAuthorizationCredentialPurpose::StandbyGrantV1
            }
        };
        let public_key = URL_SAFE_NO_PAD
            .decode(wire.public_key.as_bytes())
            .map_err(|_| AuthorizationVerificationKeyError::RegistryRejected)?;
        if URL_SAFE_NO_PAD.encode(&public_key) != wire.public_key {
            return Err(AuthorizationVerificationKeyError::RegistryRejected);
        }
        keys.push(DesktopAuthorizationVerificationKey::new(
            purpose,
            &wire.key_id,
            &public_key,
        )?);
    }
    if !has_grant || !has_lease || !has_standby {
        return Err(AuthorizationVerificationKeyError::RegistryRejected);
    }
    DesktopAuthorizationVerifier::new(keys)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerificationRegistryWire {
    schema_version: u8,
    keys: Vec<VerificationKeyWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerificationKeyWire {
    purpose: VerificationPurposeWire,
    key_id: String,
    public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum VerificationPurposeWire {
    GrantV3,
    ActiveDeviceLeaseV1,
    StandbyGrantV1,
}

impl Display for AuthorizationVerificationKeyError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DESKTOP_AUTHORIZATION_VERIFICATION_KEY_REJECTED")
    }
}

impl std::error::Error for AuthorizationVerificationKeyError {}

/// Public verification material delivered by a separately authenticated trust-root update.
pub struct DesktopAuthorizationVerificationKey {
    purpose: DesktopAuthorizationCredentialPurpose,
    key_id: String,
    public_key: [u8; ED25519_PUBLIC_KEY_BYTES],
}

impl DesktopAuthorizationVerificationKey {
    /// Constructs one exact Ed25519 key. Revoked keys must not be supplied to the registry.
    ///
    /// # Errors
    ///
    /// Rejects malformed identifiers or non-Ed25519 key lengths.
    pub fn new(
        purpose: DesktopAuthorizationCredentialPurpose,
        key_id: &str,
        public_key: &[u8],
    ) -> Result<Self, AuthorizationVerificationKeyError> {
        if !valid_identifier(key_id) {
            return Err(AuthorizationVerificationKeyError::IdentifierRejected);
        }
        let public_key = public_key
            .try_into()
            .map_err(|_| AuthorizationVerificationKeyError::KeyRejected)?;
        Ok(Self {
            purpose,
            key_id: key_id.to_owned(),
            public_key,
        })
    }
}

/// Immutable verifier registry. Unknown, malformed, or revoked-by-omission keys fail closed.
#[derive(Default)]
pub struct DesktopAuthorizationVerifier {
    keys: BTreeMap<(DesktopAuthorizationCredentialPurpose, String), [u8; ED25519_PUBLIC_KEY_BYTES]>,
}

impl DesktopAuthorizationVerifier {
    /// Builds one immutable registry for the Active Grant, its nested Lease, and the Standby Grant.
    ///
    /// # Errors
    ///
    /// Rejects duplicate key IDs or public material across purposes rather than weakening the
    /// purpose-specific trust roots.
    pub fn new(
        keys: impl IntoIterator<Item = DesktopAuthorizationVerificationKey>,
    ) -> Result<Self, AuthorizationVerificationKeyError> {
        let mut registry = BTreeMap::new();
        for key in keys {
            if registry.keys().any(|(_, key_id)| key_id == &key.key_id)
                || registry
                    .values()
                    .any(|public_key| public_key == &key.public_key)
            {
                return Err(AuthorizationVerificationKeyError::DuplicateKey);
            }
            if registry
                .insert((key.purpose, key.key_id), key.public_key)
                .is_some()
            {
                return Err(AuthorizationVerificationKeyError::DuplicateKey);
            }
        }
        Ok(Self { keys: registry })
    }

    #[must_use]
    pub fn verify(
        &self,
        purpose: DesktopAuthorizationCredentialPurpose,
        key_id: &str,
        transcript: &[u8],
        signature: &str,
    ) -> bool {
        let Some(public_key) = self.keys.get(&(purpose, key_id.to_owned())) else {
            return false;
        };
        let Ok(signature) = URL_SAFE_NO_PAD.decode(signature) else {
            return false;
        };
        if signature.len() != ED25519_SIGNATURE_BYTES {
            return false;
        }
        UnparsedPublicKey::new(&ED25519, public_key)
            .verify(transcript, &signature)
            .is_ok()
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

#[cfg(test)]
mod tests {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ring::signature::{Ed25519KeyPair, KeyPair as _};

    use super::*;

    #[test]
    fn verifies_only_registered_ed25519_keys_and_exact_transcripts() {
        let pair = Ed25519KeyPair::from_seed_unchecked(&[0x41; 32]).unwrap();
        let key = DesktopAuthorizationVerificationKey::new(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "authorization-key-1",
            pair.public_key().as_ref(),
        )
        .unwrap();
        let verifier = DesktopAuthorizationVerifier::new([key]).unwrap();
        let transcript = b"purpose-separated-transcript";
        let signature = URL_SAFE_NO_PAD.encode(pair.sign(transcript).as_ref());

        assert!(verifier.verify(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "authorization-key-1",
            transcript,
            &signature
        ));
        assert!(!verifier.verify(
            DesktopAuthorizationCredentialPurpose::ActiveDeviceLeaseV1,
            "authorization-key-1",
            transcript,
            &signature
        ));
        assert!(!verifier.verify(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "unknown-key",
            transcript,
            &signature
        ));
        assert!(!verifier.verify(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "authorization-key-1",
            b"other",
            &signature
        ));
        assert!(!verifier.verify(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "authorization-key-1",
            transcript,
            "not+a-base64url-signature"
        ));
    }

    #[test]
    fn standby_signatures_cannot_be_used_for_active_grants_or_leases() {
        let pair = Ed25519KeyPair::from_seed_unchecked(&[0x46; 32]).unwrap();
        let key = DesktopAuthorizationVerificationKey::new(
            DesktopAuthorizationCredentialPurpose::StandbyGrantV1,
            "standby-key",
            pair.public_key().as_ref(),
        )
        .unwrap();
        let verifier = DesktopAuthorizationVerifier::new([key]).unwrap();
        let transcript = b"GOODDEALER-DESKTOP-STANDBY-GRANT-V1";
        let signature = URL_SAFE_NO_PAD.encode(pair.sign(transcript).as_ref());
        assert!(verifier.verify(
            DesktopAuthorizationCredentialPurpose::StandbyGrantV1,
            "standby-key",
            transcript,
            &signature
        ));
        for purpose in [
            DesktopAuthorizationCredentialPurpose::GrantV3,
            DesktopAuthorizationCredentialPurpose::ActiveDeviceLeaseV1,
        ] {
            assert!(!verifier.verify(purpose, "standby-key", transcript, &signature));
        }
        let wrong = b"GOODDEALER-DESKTOP-AUTHORIZATION-GRANT-V3";
        assert!(!verifier.verify(
            DesktopAuthorizationCredentialPurpose::StandbyGrantV1,
            "standby-key",
            wrong,
            &signature
        ));
    }

    #[test]
    fn rejects_malformed_and_duplicate_key_material() {
        assert_eq!(
            DesktopAuthorizationVerificationKey::new(
                DesktopAuthorizationCredentialPurpose::GrantV3,
                "",
                &[0; 32],
            )
            .err()
            .unwrap(),
            AuthorizationVerificationKeyError::IdentifierRejected
        );
        assert_eq!(
            DesktopAuthorizationVerificationKey::new(
                DesktopAuthorizationCredentialPurpose::GrantV3,
                "key-1",
                &[0; 31],
            )
            .err()
            .unwrap(),
            AuthorizationVerificationKeyError::KeyRejected
        );
        let first = DesktopAuthorizationVerificationKey::new(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "key-1",
            &[1; 32],
        )
        .unwrap();
        let duplicate = DesktopAuthorizationVerificationKey::new(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "key-1",
            &[2; 32],
        )
        .unwrap();
        assert_eq!(
            DesktopAuthorizationVerifier::new([first, duplicate])
                .err()
                .unwrap(),
            AuthorizationVerificationKeyError::DuplicateKey
        );
        let grant = DesktopAuthorizationVerificationKey::new(
            DesktopAuthorizationCredentialPurpose::GrantV3,
            "grant-key",
            &[3; 32],
        )
        .unwrap();
        let lease_with_shared_material = DesktopAuthorizationVerificationKey::new(
            DesktopAuthorizationCredentialPurpose::ActiveDeviceLeaseV1,
            "lease-key",
            &[3; 32],
        )
        .unwrap();
        assert_eq!(
            DesktopAuthorizationVerifier::new([grant, lease_with_shared_material])
                .err()
                .unwrap(),
            AuthorizationVerificationKeyError::DuplicateKey
        );
    }

    #[test]
    fn registry_requires_all_three_purposes_and_rejects_unknown_fields() {
        let grant_pair = Ed25519KeyPair::from_seed_unchecked(&[0x41; 32]).unwrap();
        let next_grant_pair = Ed25519KeyPair::from_seed_unchecked(&[0x42; 32]).unwrap();
        let lease_pair = Ed25519KeyPair::from_seed_unchecked(&[0x43; 32]).unwrap();
        let next_lease_pair = Ed25519KeyPair::from_seed_unchecked(&[0x44; 32]).unwrap();
        let standby_pair = Ed25519KeyPair::from_seed_unchecked(&[0x45; 32]).unwrap();
        let grant_public_key = URL_SAFE_NO_PAD.encode(grant_pair.public_key().as_ref());
        let next_grant_public_key = URL_SAFE_NO_PAD.encode(next_grant_pair.public_key().as_ref());
        let lease_public_key = URL_SAFE_NO_PAD.encode(lease_pair.public_key().as_ref());
        let next_lease_public_key = URL_SAFE_NO_PAD.encode(next_lease_pair.public_key().as_ref());
        let standby_public_key = URL_SAFE_NO_PAD.encode(standby_pair.public_key().as_ref());
        let valid = format!(
            r#"{{"schemaVersion":1,"keys":[{{"purpose":"grant_v3","keyId":"grant-key-1","publicKey":"{grant_public_key}"}},{{"purpose":"grant_v3","keyId":"grant-key-2","publicKey":"{next_grant_public_key}"}},{{"purpose":"active_device_lease_v1","keyId":"lease-key-1","publicKey":"{lease_public_key}"}},{{"purpose":"active_device_lease_v1","keyId":"lease-key-2","publicKey":"{next_lease_public_key}"}},{{"purpose":"standby_grant_v1","keyId":"standby-key-1","publicKey":"{standby_public_key}"}}]}}"#,
        );
        assert!(parse_desktop_authorization_verifier_registry(&valid).is_ok());
        for missing in ["grant_v3", "active_device_lease_v1", "standby_grant_v1"] {
            let mut wire: serde_json::Value = serde_json::from_str(&valid).unwrap();
            wire["keys"]
                .as_array_mut()
                .unwrap()
                .retain(|key| key["purpose"] != missing);
            assert_eq!(
                parse_desktop_authorization_verifier_registry(&wire.to_string()).err(),
                Some(AuthorizationVerificationKeyError::RegistryRejected),
                "{missing}"
            );
        }

        assert_eq!(
            parse_desktop_authorization_verifier_registry(
                &valid.replace("}]}", "}],\"extra\":true}")
            )
            .err()
            .unwrap(),
            AuthorizationVerificationKeyError::RegistryRejected
        );
        assert_eq!(
            parse_desktop_authorization_verifier_registry(&format!(
                r#"{{"schemaVersion":1,"keys":[{{"purpose":"grant_v3","keyId":"grant-key-1","publicKey":"{grant_public_key}"}}]}}"#,
            ))
            .err()
            .unwrap(),
            AuthorizationVerificationKeyError::RegistryRejected
        );
    }
}
