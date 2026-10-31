//! Native device identity and purpose-isolated Ed25519 custody.

use std::fmt::{Debug, Display, Formatter};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{Ed25519KeyPair, KeyPair as _};
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "macos", target_os = "linux", test))]
use sha2::{Digest as _, Sha256};
use zeroize::{Zeroize as _, Zeroizing};

const KEYCHAIN_SERVICE: &str = "com.gooddealer.desktop.device-identity";
const KEYCHAIN_ACCOUNT: &str = "device-identity-v1";
#[cfg(any(target_os = "macos", target_os = "linux"))]
const BINDING_KEYCHAIN_SERVICE: &str = "com.gooddealer.desktop.local-host-binding";
#[cfg(any(target_os = "macos", target_os = "linux"))]
const BINDING_KEYCHAIN_ACCOUNT: &str = "local-host-binding-v1";
#[cfg(any(target_os = "macos", target_os = "linux", test))]
const BINDING_SCHEMA_VERSION: u8 = 1;
#[cfg(any(target_os = "macos", target_os = "linux", test))]
const BINDING_DIGEST_DOMAIN: &[u8] = b"GOODDEALER/INSTALLATION-BINDING-V1\0";
#[cfg(any(target_os = "macos", target_os = "linux", test))]
const MAX_BINDING_BYTES: usize = 512;
#[cfg(target_os = "macos")]
const WHEN_UNLOCKED_THIS_DEVICE_ONLY_PROTECTION_DOMAIN: &str = "aku";
const MAX_STORED_IDENTITY_BYTES: usize = 1_024;
pub const DESKTOP_DEVICE_PROOF_DOMAIN: &str = "GOODDEALER-DESKTOP-OAUTH-DEVICE-PROOF-V1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopDeviceIdentityError {
    RandomUnavailable,
    CredentialStoreUnavailable,
    InvalidCredential,
    SigningRejected,
}

impl Display for DesktopDeviceIdentityError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::RandomUnavailable => "DESKTOP_DEVICE_IDENTITY_RANDOM_UNAVAILABLE",
            Self::CredentialStoreUnavailable => "DESKTOP_DEVICE_IDENTITY_STORE_UNAVAILABLE",
            Self::InvalidCredential => "DESKTOP_DEVICE_IDENTITY_CREDENTIAL_REJECTED",
            Self::SigningRejected => "DESKTOP_DEVICE_IDENTITY_SIGNING_REJECTED",
        })
    }
}

impl std::error::Error for DesktopDeviceIdentityError {}

pub struct DesktopDeviceIdentity {
    device_id: String,
    key_id: String,
    public_key: [u8; 32],
    seed: Zeroizing<[u8; 32]>,
}

impl DesktopDeviceIdentity {
    fn from_material(
        device_id: String,
        key_id: String,
        seed: [u8; 32],
    ) -> Result<Self, DesktopDeviceIdentityError> {
        if !valid_identifier(&device_id) || !valid_identifier(&key_id) {
            return Err(DesktopDeviceIdentityError::InvalidCredential);
        }
        let pair = Ed25519KeyPair::from_seed_unchecked(&seed)
            .map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?;
        let public_key: [u8; 32] = pair
            .public_key()
            .as_ref()
            .try_into()
            .map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?;
        Ok(Self {
            device_id,
            key_id,
            public_key,
            seed: Zeroizing::new(seed),
        })
    }

    #[cfg(test)]
    pub(crate) fn from_test_material(device_id: &str, key_id: &str, seed: [u8; 32]) -> Self {
        Self::from_material(device_id.to_owned(), key_id.to_owned(), seed).unwrap()
    }

    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    #[must_use]
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    #[must_use]
    pub fn public_key_base64url(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.public_key)
    }

    /// Signs the exact device-login transcript; arbitrary signing is intentionally not exposed.
    ///
    /// # Errors
    ///
    /// Fails closed if the OS-stored seed can no longer construct an Ed25519 key.
    pub fn sign_login_proof(
        &self,
        input: &DesktopDeviceProofTranscript<'_>,
    ) -> Result<String, DesktopDeviceIdentityError> {
        if input.device_id != self.device_id || input.key_id != self.key_id {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        let pair = Ed25519KeyPair::from_seed_unchecked(&*self.seed)
            .map_err(|_| DesktopDeviceIdentityError::SigningRejected)?;
        Ok(URL_SAFE_NO_PAD.encode(pair.sign(&input.encode()).as_ref()))
    }
}

impl Debug for DesktopDeviceIdentity {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DesktopDeviceIdentity")
            .field("device_id", &self.device_id)
            .field("key_id", &self.key_id)
            .field("private_key", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

pub struct DesktopDeviceProofTranscript<'a> {
    pub account_id: &'a str,
    pub device_id: &'a str,
    pub key_id: &'a str,
    pub challenge_id: &'a str,
    pub code_challenge: &'a str,
    pub client_id: &'a str,
    pub redirect_uri: &'a str,
    pub nonce_digest: &'a str,
    pub expires_at: &'a str,
}

impl DesktopDeviceProofTranscript<'_> {
    fn encode(&self) -> Vec<u8> {
        [
            DESKTOP_DEVICE_PROOF_DOMAIN,
            self.account_id,
            self.device_id,
            self.key_id,
            self.challenge_id,
            self.code_challenge,
            self.client_id,
            self.redirect_uri,
            self.nonce_digest,
            self.expires_at,
        ]
        .join("\n")
        .into_bytes()
    }
}

/// Loads the stable native identity or creates and confirms one purpose-isolated Keychain item.
///
/// # Errors
///
/// Fails closed for malformed stored data, unavailable randomness, or an unconfirmed write.
pub fn load_or_create_desktop_device_identity()
-> Result<DesktopDeviceIdentity, DesktopDeviceIdentityError> {
    if let Some(stored) = load_native_identity()? {
        let identity = decode_identity(&Zeroizing::new(stored))?;
        ensure_device_binding(&identity)?;
        return Ok(identity);
    }
    let mut seed = Zeroizing::new([0_u8; 32]);
    let mut device_random = [0_u8; 18];
    let mut key_random = [0_u8; 18];
    getrandom::fill(&mut *seed).map_err(|_| DesktopDeviceIdentityError::RandomUnavailable)?;
    getrandom::fill(&mut device_random)
        .map_err(|_| DesktopDeviceIdentityError::RandomUnavailable)?;
    getrandom::fill(&mut key_random).map_err(|_| DesktopDeviceIdentityError::RandomUnavailable)?;
    let mut record = StoredDeviceIdentity {
        schema_version: 1,
        device_id: format!("device-{}", URL_SAFE_NO_PAD.encode(device_random)),
        key_id: format!("device-key-{}", URL_SAFE_NO_PAD.encode(key_random)),
        seed: URL_SAFE_NO_PAD.encode(*seed),
    };
    let encoded = serde_json::to_vec(&record);
    record.seed.zeroize();
    let encoded =
        Zeroizing::new(encoded.map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?);
    store_native_identity(&encoded)?;
    let identity = decode_identity(&encoded)?;
    ensure_device_binding(&identity)?;
    Ok(identity)
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredDeviceBinding {
    schema_version: u8,
    device_id: String,
    installation_binding_digest: String,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn ensure_device_binding(
    identity: &DesktopDeviceIdentity,
) -> Result<(), DesktopDeviceIdentityError> {
    let existing = load_device_binding()?;
    if let Some(value) = existing {
        validate_device_binding(&value, identity)?;
    } else {
        let bytes = encode_device_binding(identity)?;
        store_device_binding(&bytes)?;
    }
    verify_device_binding_attributes()
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn installation_binding_digest(identity: &DesktopDeviceIdentity) -> String {
    let mut digest = Sha256::new();
    digest.update(BINDING_DIGEST_DOMAIN);
    digest.update(identity.public_key);
    URL_SAFE_NO_PAD.encode(digest.finalize())
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn encode_device_binding(
    identity: &DesktopDeviceIdentity,
) -> Result<Vec<u8>, DesktopDeviceIdentityError> {
    let record = StoredDeviceBinding {
        schema_version: BINDING_SCHEMA_VERSION,
        device_id: identity.device_id.clone(),
        installation_binding_digest: installation_binding_digest(identity),
    };
    let bytes =
        serde_json::to_vec(&record).map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?;
    if bytes.is_empty() || bytes.len() > MAX_BINDING_BYTES {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    Ok(bytes)
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn validate_device_binding(
    value: &[u8],
    identity: &DesktopDeviceIdentity,
) -> Result<(), DesktopDeviceIdentityError> {
    if value.is_empty() || value.len() > MAX_BINDING_BYTES {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    let record: StoredDeviceBinding =
        serde_json::from_slice(value).map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?;
    if record.schema_version != BINDING_SCHEMA_VERSION
        || record.device_id != identity.device_id
        || record.installation_binding_digest != installation_binding_digest(identity)
    {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
#[expect(
    clippy::unnecessary_wraps,
    reason = "the cross-platform identity API preserves one fail-closed Result contract"
)]
fn ensure_device_binding(
    _identity: &DesktopDeviceIdentity,
) -> Result<(), DesktopDeviceIdentityError> {
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredDeviceIdentity {
    schema_version: u8,
    device_id: String,
    key_id: String,
    seed: String,
}

fn decode_identity(value: &[u8]) -> Result<DesktopDeviceIdentity, DesktopDeviceIdentityError> {
    if value.is_empty() || value.len() > MAX_STORED_IDENTITY_BYTES {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    let mut record: StoredDeviceIdentity =
        serde_json::from_slice(value).map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?;
    if record.schema_version != 1 {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(record.seed.as_bytes())
        .map_err(|_| DesktopDeviceIdentityError::InvalidCredential);
    let canonical_seed = decoded
        .as_ref()
        .is_ok_and(|decoded| URL_SAFE_NO_PAD.encode(decoded) == record.seed);
    record.seed.zeroize();
    let decoded =
        Zeroizing::new(decoded.map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?);
    if !canonical_seed {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    let seed: [u8; 32] = decoded
        .as_slice()
        .try_into()
        .map_err(|_| DesktopDeviceIdentityError::InvalidCredential)?;
    DesktopDeviceIdentity::from_material(record.device_id, record.key_id, seed)
}

#[cfg(target_os = "macos")]
fn load_native_identity() -> Result<Option<Vec<u8>>, DesktopDeviceIdentityError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(DesktopDeviceIdentityError::CredentialStoreUnavailable),
    }
}

#[cfg(target_os = "macos")]
fn store_native_identity(value: &[u8]) -> Result<(), DesktopDeviceIdentityError> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, value)
        .map_err(|_| DesktopDeviceIdentityError::CredentialStoreUnavailable)
}

#[cfg(target_os = "linux")]
fn secret_service_error(
    error: crate::secret_service_custody::SecretServiceError,
) -> DesktopDeviceIdentityError {
    match error {
        crate::secret_service_custody::SecretServiceError::Unavailable => {
            DesktopDeviceIdentityError::CredentialStoreUnavailable
        }
        crate::secret_service_custody::SecretServiceError::Rejected => {
            DesktopDeviceIdentityError::InvalidCredential
        }
    }
}

#[cfg(target_os = "linux")]
fn load_native_identity() -> Result<Option<Vec<u8>>, DesktopDeviceIdentityError> {
    crate::secret_service_custody::load(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map(|value| value.map(|secret| secret.to_vec()))
        .map_err(secret_service_error)
}

#[cfg(target_os = "linux")]
fn store_native_identity(value: &[u8]) -> Result<(), DesktopDeviceIdentityError> {
    crate::secret_service_custody::store(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, value)
        .map_err(secret_service_error)
}

#[cfg(target_os = "linux")]
fn load_device_binding() -> Result<Option<Vec<u8>>, DesktopDeviceIdentityError> {
    crate::secret_service_custody::load(BINDING_KEYCHAIN_SERVICE, BINDING_KEYCHAIN_ACCOUNT)
        .map(|value| value.map(|secret| secret.to_vec()))
        .map_err(secret_service_error)
}

#[cfg(target_os = "linux")]
fn store_device_binding(value: &[u8]) -> Result<(), DesktopDeviceIdentityError> {
    // The adapter reads back and compares the stored bytes before reporting success.
    crate::secret_service_custody::store(BINDING_KEYCHAIN_SERVICE, BINDING_KEYCHAIN_ACCOUNT, value)
        .map_err(secret_service_error)
}

#[cfg(target_os = "linux")]
fn verify_device_binding_attributes() -> Result<(), DesktopDeviceIdentityError> {
    // Secret Service has no protection-class attributes to inspect; the adapter re-checks the
    // identity attributes on every read, so confirm exactly one admissible item now exists.
    load_device_binding()?
        .map(|_| ())
        .ok_or(DesktopDeviceIdentityError::InvalidCredential)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn load_native_identity() -> Result<Option<Vec<u8>>, DesktopDeviceIdentityError> {
    let _ = (KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    Err(DesktopDeviceIdentityError::CredentialStoreUnavailable)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn store_native_identity(_value: &[u8]) -> Result<(), DesktopDeviceIdentityError> {
    Err(DesktopDeviceIdentityError::CredentialStoreUnavailable)
}

#[cfg(target_os = "macos")]
fn binding_keychain_options(
    include_access_control: bool,
) -> security_framework::passwords::PasswordOptions {
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{AccessControlOptions, PasswordOptions};

    let mut options =
        PasswordOptions::new_generic_password(BINDING_KEYCHAIN_SERVICE, BINDING_KEYCHAIN_ACCOUNT);
    // The data-protection keychain binds the item to the signed application's designated
    // requirement. Do not request a shared access group: the repository declares no such
    // entitlement, and inventing one would make production writes fail closed on every launch.
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
fn load_device_binding() -> Result<Option<Vec<u8>>, DesktopDeviceIdentityError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::generic_password(binding_keychain_options(false)) {
        Ok(value) => {
            verify_device_binding_attributes()?;
            Ok(Some(value))
        }
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(DesktopDeviceIdentityError::CredentialStoreUnavailable),
    }
}

#[cfg(target_os = "macos")]
fn store_device_binding(value: &[u8]) -> Result<(), DesktopDeviceIdentityError> {
    security_framework::passwords::set_generic_password_options(
        value,
        binding_keychain_options(true),
    )
    .map_err(|_| DesktopDeviceIdentityError::CredentialStoreUnavailable)?;
    verify_device_binding_attributes()?;
    let confirmed =
        security_framework::passwords::generic_password(binding_keychain_options(false))
            .map_err(|_| DesktopDeviceIdentityError::CredentialStoreUnavailable)?;
    if confirmed != value {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn verify_device_binding_attributes() -> Result<(), DesktopDeviceIdentityError> {
    use security_framework::item::{CloudSync, ItemClass, ItemSearchOptions, SearchResult};
    const ITEM_NOT_FOUND: i32 = -25_300;
    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(BINDING_KEYCHAIN_SERVICE)
        .account(BINDING_KEYCHAIN_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncNo)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    let results = query
        .search()
        .map_err(|_| DesktopDeviceIdentityError::CredentialStoreUnavailable)?;
    let Some(result @ SearchResult::Dict(_)) = results.first() else {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    };
    let values = result
        .simplify_dict()
        .ok_or(DesktopDeviceIdentityError::InvalidCredential)?;
    let valid_group = values.get("agrp").is_some_and(|value| {
        value == "app.gooddealer.desktop"
            || value
                .strip_suffix("app.gooddealer.desktop")
                .is_some_and(|prefix| {
                    let team = prefix.strip_suffix('.').unwrap_or_default();
                    team.len() == 10
                        && team
                            .bytes()
                            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
                })
    });
    if values
        .get("svce")
        .is_none_or(|value| value != BINDING_KEYCHAIN_SERVICE)
        || values
            .get("acct")
            .is_none_or(|value| value != BINDING_KEYCHAIN_ACCOUNT)
        || values
            .get("pdmn")
            .is_none_or(|value| value != WHEN_UNLOCKED_THIS_DEVICE_ONLY_PROTECTION_DOMAIN)
        || !values.contains_key("accc")
        || !valid_group
    {
        return Err(DesktopDeviceIdentityError::InvalidCredential);
    }
    let mut synchronized = ItemSearchOptions::new();
    synchronized
        .class(ItemClass::generic_password())
        .service(BINDING_KEYCHAIN_SERVICE)
        .account(BINDING_KEYCHAIN_ACCOUNT)
        .cloud_sync(CloudSync::MatchSyncYes)
        .ignore_legacy_keychains()
        .load_attributes(true)
        .limit(1);
    match synchronized.search() {
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
        Ok(results) if results.is_empty() => Ok(()),
        Ok(_) => Err(DesktopDeviceIdentityError::InvalidCredential),
        Err(_) => Err(DesktopDeviceIdentityError::CredentialStoreUnavailable),
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{ED25519, UnparsedPublicKey};

    #[test]
    fn signs_only_the_fixed_device_and_purpose_transcript() {
        let identity = DesktopDeviceIdentity::from_material(
            "device-a".to_owned(),
            "device-key-a".to_owned(),
            [0x41; 32],
        )
        .unwrap();
        let transcript = DesktopDeviceProofTranscript {
            account_id: "account-a",
            device_id: "device-a",
            key_id: "device-key-a",
            challenge_id: "login-challenge-a",
            code_challenge: "C",
            client_id: "gooddealer-desktop",
            redirect_uri: "gooddealer://oauth/callback",
            nonce_digest: "N",
            expires_at: "2026-09-01T00:02:00Z",
        };
        let signature = URL_SAFE_NO_PAD
            .decode(identity.sign_login_proof(&transcript).unwrap())
            .unwrap();
        let public_key = URL_SAFE_NO_PAD
            .decode(identity.public_key_base64url())
            .unwrap();
        UnparsedPublicKey::new(&ED25519, public_key)
            .verify(&transcript.encode(), &signature)
            .unwrap();
        let substitution = DesktopDeviceProofTranscript {
            device_id: "device-b",
            ..transcript
        };
        assert_eq!(
            identity.sign_login_proof(&substitution).unwrap_err(),
            DesktopDeviceIdentityError::SigningRejected
        );
        assert!(format!("{identity:?}").contains("[REDACTED]"));
    }

    #[test]
    fn local_host_binding_is_public_key_derived_strict_and_contains_no_seed() {
        let identity = DesktopDeviceIdentity::from_material(
            "device-binding-a".to_owned(),
            "device-key-binding-a".to_owned(),
            [0x51; 32],
        )
        .unwrap();
        let encoded = encode_device_binding(&identity).unwrap();
        let record: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(record["schemaVersion"], 1);
        assert_eq!(record["deviceId"], "device-binding-a");
        assert_eq!(
            record["installationBindingDigest"],
            installation_binding_digest(&identity)
        );
        assert!(record.get("seed").is_none());
        assert!(record.get("keyId").is_none());
        validate_device_binding(&encoded, &identity).unwrap();

        let replacement = DesktopDeviceIdentity::from_material(
            "device-binding-a".to_owned(),
            "device-key-binding-a".to_owned(),
            [0x52; 32],
        )
        .unwrap();
        assert_eq!(
            validate_device_binding(&encoded, &replacement),
            Err(DesktopDeviceIdentityError::InvalidCredential)
        );
        let unknown = br#"{"schemaVersion":1,"deviceId":"device-binding-a","installationBindingDigest":"x","seed":"forbidden"}"#;
        assert_eq!(
            validate_device_binding(unknown, &identity),
            Err(DesktopDeviceIdentityError::InvalidCredential)
        );
        assert_eq!(
            validate_device_binding(&vec![b'x'; MAX_BINDING_BYTES + 1], &identity),
            Err(DesktopDeviceIdentityError::InvalidCredential)
        );
    }
}
