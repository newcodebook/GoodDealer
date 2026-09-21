//! Native-only Desktop OAuth material and OS-protected refresh credential custody.

use std::fmt::{Debug, Display, Formatter};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use zeroize::{Zeroize as _, Zeroizing};

use crate::desktop_device_identity::{DesktopDeviceIdentity, DesktopDeviceProofTranscript};

const CLIENT_ID: &str = "gooddealer-desktop";
const REDIRECT_URI: &str = "gooddealer://oauth/callback";
const AUTHORIZE_PATH: &str = "/v1/desktop-oauth/authorize";
const KEYCHAIN_SERVICE: &str = "com.gooddealer.desktop.oauth-refresh";
const KEYCHAIN_ACCOUNT: &str = "desktop-refresh-v1";
const MAX_REFRESH_TOKEN_BYTES: usize = 1_024;
const CHALLENGE_CALLBACK_KEYS: [&str; 7] = [
    "account_id",
    "challenge_id",
    "device_id",
    "expires_at",
    "key_id",
    "nonce_digest",
    "state",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopOAuthError {
    InvalidConfiguration,
    InvalidCallback,
    InvalidCredential,
    RandomUnavailable,
    CredentialStoreUnavailable,
}

impl Display for DesktopOAuthError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "DESKTOP_OAUTH_CONFIGURATION_REJECTED",
            Self::InvalidCallback => "DESKTOP_OAUTH_CALLBACK_REJECTED",
            Self::InvalidCredential => "DESKTOP_OAUTH_CREDENTIAL_REJECTED",
            Self::RandomUnavailable => "DESKTOP_OAUTH_RANDOM_UNAVAILABLE",
            Self::CredentialStoreUnavailable => "DESKTOP_OAUTH_CREDENTIAL_STORE_UNAVAILABLE",
        })
    }
}

impl std::error::Error for DesktopOAuthError {}

/// One pending system-browser authorization. Verifier and state are native-memory-only.
pub struct DesktopOAuthAttempt {
    verifier: Zeroizing<String>,
    state: Zeroizing<String>,
    code_challenge: String,
    authorization_url: Url,
    challenge_responded: bool,
}

impl DesktopOAuthAttempt {
    /// Creates an S256 PKCE request for an already-bound native device.
    ///
    /// # Errors
    ///
    /// Rejects non-HTTPS Cloud origins, malformed device identity, or unavailable randomness.
    pub fn begin(
        cloud_origin: &str,
        identity: &DesktopDeviceIdentity,
    ) -> Result<Self, DesktopOAuthError> {
        let mut verifier_bytes = Zeroizing::new([0_u8; 64]);
        let mut state_bytes = Zeroizing::new([0_u8; 32]);
        getrandom::fill(&mut *verifier_bytes).map_err(|_| DesktopOAuthError::RandomUnavailable)?;
        getrandom::fill(&mut *state_bytes).map_err(|_| DesktopOAuthError::RandomUnavailable)?;
        Self::from_material(
            cloud_origin,
            identity.device_id(),
            identity.key_id(),
            &identity.public_key_base64url(),
            URL_SAFE_NO_PAD.encode(*verifier_bytes),
            URL_SAFE_NO_PAD.encode(*state_bytes),
        )
    }

    fn from_material(
        cloud_origin: &str,
        device_id: &str,
        key_id: &str,
        public_key: &str,
        verifier: String,
        state: String,
    ) -> Result<Self, DesktopOAuthError> {
        if !valid_identifier(device_id)
            || !valid_identifier(key_id)
            || !valid_base64url(public_key, 43)
            || !valid_verifier(&verifier)
            || !valid_state(&state)
        {
            return Err(DesktopOAuthError::InvalidConfiguration);
        }
        let mut origin =
            Url::parse(cloud_origin).map_err(|_| DesktopOAuthError::InvalidConfiguration)?;
        if origin.scheme() != "https"
            || origin.host_str().is_none()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.query().is_some()
            || origin.fragment().is_some()
            || origin.path() != "/"
        {
            return Err(DesktopOAuthError::InvalidConfiguration);
        }
        origin.set_path(AUTHORIZE_PATH);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        origin
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", CLIENT_ID)
            .append_pair("redirect_uri", REDIRECT_URI)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("device_id", device_id)
            .append_pair("key_id", key_id)
            .append_pair("public_key", public_key)
            .append_pair("state", &state);
        Ok(Self {
            verifier: Zeroizing::new(verifier),
            state: Zeroizing::new(state),
            code_challenge: challenge,
            authorization_url: origin,
            challenge_responded: false,
        })
    }

    #[must_use]
    pub fn authorization_url(&self) -> &Url {
        &self.authorization_url
    }

    /// Verifies and advances the exact custom-scheme callback state machine.
    ///
    /// # Errors
    ///
    /// Rejects scheme/host/path substitution, duplicate or unknown query fields, and state mismatch.
    pub fn advance(
        self,
        callback: &Url,
        identity: &DesktopDeviceIdentity,
    ) -> Result<DesktopOAuthContinuation, DesktopOAuthError> {
        if callback.scheme() != "gooddealer"
            || callback.host_str() != Some("oauth")
            || callback.path() != "/callback"
            || callback.port().is_some()
            || !callback.username().is_empty()
            || callback.password().is_some()
            || callback.fragment().is_some()
        {
            return Err(DesktopOAuthError::InvalidCallback);
        }
        let pairs = exact_callback_pairs(callback)?;
        let state = pairs
            .get("state")
            .ok_or(DesktopOAuthError::InvalidCallback)?;
        if state.as_bytes() != self.state.as_bytes() {
            return Err(DesktopOAuthError::InvalidCallback);
        }
        if pairs.len() == 2 {
            let code = pairs
                .get("code")
                .ok_or(DesktopOAuthError::InvalidCallback)?;
            if !self.challenge_responded || !valid_authorization_code(code) {
                return Err(DesktopOAuthError::InvalidCallback);
            }
            return Ok(DesktopOAuthContinuation::Exchange(
                DesktopAuthorizationCodeExchange {
                    authorization_code: Zeroizing::new(code.clone()),
                    code_verifier: self.verifier,
                },
            ));
        }
        if self.challenge_responded
            || pairs.len() != CHALLENGE_CALLBACK_KEYS.len()
            || !CHALLENGE_CALLBACK_KEYS
                .iter()
                .all(|key| pairs.contains_key(*key))
        {
            return Err(DesktopOAuthError::InvalidCallback);
        }
        let account_id = required_identifier(&pairs, "account_id")?;
        let challenge_id = required_identifier(&pairs, "challenge_id")?;
        let device_id = required_identifier(&pairs, "device_id")?;
        let key_id = required_identifier(&pairs, "key_id")?;
        let nonce_digest = pairs
            .get("nonce_digest")
            .filter(|value| valid_base64url(value, 43))
            .ok_or(DesktopOAuthError::InvalidCallback)?;
        let expires_at = pairs
            .get("expires_at")
            .filter(|value| valid_canonical_second(value))
            .ok_or(DesktopOAuthError::InvalidCallback)?;
        if device_id != identity.device_id() || key_id != identity.key_id() {
            return Err(DesktopOAuthError::InvalidCallback);
        }
        let signature = identity
            .sign_login_proof(&DesktopDeviceProofTranscript {
                account_id,
                device_id,
                key_id,
                challenge_id,
                code_challenge: &self.code_challenge,
                client_id: CLIENT_ID,
                redirect_uri: REDIRECT_URI,
                nonce_digest,
                expires_at,
            })
            .map_err(|_| DesktopOAuthError::InvalidCredential)?;
        let mut authorization_url = self.authorization_url.clone();
        authorization_url
            .query_pairs_mut()
            .append_pair("challenge_id", challenge_id)
            .append_pair("device_signature", &signature);
        let mut attempt = self;
        attempt.challenge_responded = true;
        Ok(DesktopOAuthContinuation::Authorize {
            attempt: Box::new(attempt),
            authorization_url,
        })
    }
}

pub enum DesktopOAuthContinuation {
    Authorize {
        attempt: Box<DesktopOAuthAttempt>,
        authorization_url: Url,
    },
    Exchange(DesktopAuthorizationCodeExchange),
}

fn exact_callback_pairs(
    callback: &Url,
) -> Result<std::collections::BTreeMap<String, String>, DesktopOAuthError> {
    let mut pairs = std::collections::BTreeMap::new();
    for (key, value) in callback.query_pairs() {
        if pairs.insert(key.into_owned(), value.into_owned()).is_some() {
            return Err(DesktopOAuthError::InvalidCallback);
        }
    }
    Ok(pairs)
}

fn required_identifier<'a>(
    pairs: &'a std::collections::BTreeMap<String, String>,
    key: &str,
) -> Result<&'a str, DesktopOAuthError> {
    pairs
        .get(key)
        .filter(|value| valid_identifier(value))
        .map(String::as_str)
        .ok_or(DesktopOAuthError::InvalidCallback)
}

impl Debug for DesktopOAuthAttempt {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopOAuthAttempt([REDACTED])")
    }
}

pub struct DesktopAuthorizationCodeExchange {
    authorization_code: Zeroizing<String>,
    code_verifier: Zeroizing<String>,
}

impl DesktopAuthorizationCodeExchange {
    /// Makes raw exchange material available only for the duration of a native transport call.
    pub fn expose<Result>(&self, operation: impl FnOnce(&str, &str) -> Result) -> Result {
        operation(&self.authorization_code, &self.code_verifier)
    }
}

impl Debug for DesktopAuthorizationCodeExchange {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopAuthorizationCodeExchange([REDACTED])")
    }
}

pub struct DesktopRefreshToken(Zeroizing<String>);

pub struct DesktopRefreshRequestId(Zeroizing<String>);

pub struct DesktopAccessToken(Zeroizing<String>);

impl DesktopAccessToken {
    /// Admits only the fixed opaque access-token format returned by `GoodDealer` Cloud.
    ///
    /// # Errors
    ///
    /// Rejects oversized or malformed values before native request composition.
    pub fn new(value: String) -> Result<Self, DesktopOAuthError> {
        if !valid_bearer_token(&value, "gd_at1") {
            return Err(DesktopOAuthError::InvalidCredential);
        }
        Ok(Self(Zeroizing::new(value)))
    }

    pub fn expose<Result>(&self, operation: impl FnOnce(&str) -> Result) -> Result {
        operation(&self.0)
    }
}

impl Debug for DesktopAccessToken {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopAccessToken([REDACTED])")
    }
}

impl DesktopRefreshToken {
    /// Admits only the fixed opaque refresh-token format returned by `GoodDealer` Cloud.
    ///
    /// # Errors
    ///
    /// Rejects oversized or malformed values before they reach the OS credential store.
    pub fn new(value: String) -> Result<Self, DesktopOAuthError> {
        if !valid_bearer_token(&value, "gd_rt1") {
            return Err(DesktopOAuthError::InvalidCredential);
        }
        Ok(Self(Zeroizing::new(value)))
    }

    pub fn expose<Result>(&self, operation: impl FnOnce(&str) -> Result) -> Result {
        operation(&self.0)
    }
}

impl DesktopRefreshRequestId {
    /// Creates one unpredictable idempotency identity for a logical refresh rotation.
    ///
    /// # Errors
    ///
    /// Fails when the operating-system random source is unavailable.
    pub fn generate() -> Result<Self, DesktopOAuthError> {
        let mut random = Zeroizing::new([0_u8; 18]);
        getrandom::fill(&mut *random).map_err(|_| DesktopOAuthError::RandomUnavailable)?;
        Ok(Self(Zeroizing::new(format!(
            "refresh-{}",
            URL_SAFE_NO_PAD.encode(*random)
        ))))
    }

    fn new(value: String) -> Result<Self, DesktopOAuthError> {
        if !valid_refresh_request_id(&value) {
            return Err(DesktopOAuthError::InvalidCredential);
        }
        Ok(Self(Zeroizing::new(value)))
    }

    pub fn expose<Result>(&self, operation: impl FnOnce(&str) -> Result) -> Result {
        operation(&self.0)
    }
}

impl Debug for DesktopRefreshRequestId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopRefreshRequestId([REDACTED])")
    }
}

impl Debug for DesktopRefreshToken {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopRefreshToken([REDACTED])")
    }
}

/// Loads a refresh token from the purpose-isolated native credential item.
///
/// # Errors
///
/// Fails closed when the credential store is unavailable or stored data is malformed.
pub fn load_desktop_refresh_token() -> Result<Option<DesktopRefreshToken>, DesktopOAuthError> {
    let Some(mut stored) = load_refresh_record()? else {
        return Ok(None);
    };
    let value = std::mem::take(&mut stored.refresh_token);
    DesktopRefreshToken::new(value).map(Some)
}

/// Stores only a validated refresh token in the OS credential store.
///
/// # Errors
///
/// Fails closed when the credential store cannot confirm the write.
pub fn store_desktop_refresh_token(token: &DesktopRefreshToken) -> Result<(), DesktopOAuthError> {
    token.expose(|value| store_refresh_record(value, None))
}

/// Removes the refresh credential during logout, reuse detection, or security lock.
///
/// # Errors
///
/// Fails closed when removal cannot be confirmed.
pub fn clear_desktop_refresh_token() -> Result<(), DesktopOAuthError> {
    clear_native_refresh()
}

/// Loads the request identity paired with the currently presented refresh token.
///
/// # Errors
///
/// Fails closed when the credential store is unavailable or the exact record is malformed.
pub fn load_desktop_refresh_request_id()
-> Result<Option<DesktopRefreshRequestId>, DesktopOAuthError> {
    let Some(mut stored) = load_refresh_record()? else {
        return Ok(None);
    };
    let Some(value) = stored.request_id.take() else {
        return Ok(None);
    };
    DesktopRefreshRequestId::new(value).map(Some)
}

/// Atomically pairs one logical rotation identity with the current refresh token.
///
/// # Errors
///
/// Fails closed when no valid refresh token exists or the credential write cannot be confirmed.
pub fn store_desktop_refresh_request_id(
    request_id: &DesktopRefreshRequestId,
) -> Result<(), DesktopOAuthError> {
    let mut stored = load_refresh_record()?.ok_or(DesktopOAuthError::InvalidCredential)?;
    request_id.expose(|value| store_refresh_record(&stored.refresh_token, Some(value)))?;
    stored.refresh_token.zeroize();
    Ok(())
}

/// Clears a completed request identity without removing the current refresh token.
///
/// # Errors
///
/// Fails closed when the credential record is malformed or the write cannot be confirmed.
pub fn clear_desktop_refresh_request_id() -> Result<(), DesktopOAuthError> {
    let Some(mut stored) = load_refresh_record()? else {
        return Ok(());
    };
    let result = store_refresh_record(&stored.refresh_token, None);
    stored.refresh_token.zeroize();
    result
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredRefreshCredential {
    schema_version: u8,
    refresh_token: String,
    request_id: Option<String>,
}

impl Drop for StoredRefreshCredential {
    fn drop(&mut self) {
        self.refresh_token.zeroize();
        if let Some(request_id) = self.request_id.as_mut() {
            request_id.zeroize();
        }
    }
}

fn load_refresh_record() -> Result<Option<StoredRefreshCredential>, DesktopOAuthError> {
    let Some(stored) = load_native_refresh()? else {
        return Ok(None);
    };
    decode_refresh_record(&stored).map(Some)
}

fn decode_refresh_record(stored: &[u8]) -> Result<StoredRefreshCredential, DesktopOAuthError> {
    if stored.is_empty() || stored.len() > MAX_REFRESH_TOKEN_BYTES + 256 {
        return Err(DesktopOAuthError::InvalidCredential);
    }
    let record: StoredRefreshCredential =
        serde_json::from_slice(stored).map_err(|_| DesktopOAuthError::InvalidCredential)?;
    if record.schema_version != 1
        || !valid_bearer_token(&record.refresh_token, "gd_rt1")
        || record
            .request_id
            .as_ref()
            .is_some_and(|value| !valid_refresh_request_id(value))
    {
        return Err(DesktopOAuthError::InvalidCredential);
    }
    Ok(record)
}

fn store_refresh_record(
    refresh_token: &str,
    request_id: Option<&str>,
) -> Result<(), DesktopOAuthError> {
    if !valid_bearer_token(refresh_token, "gd_rt1")
        || request_id.is_some_and(|value| !valid_refresh_request_id(value))
    {
        return Err(DesktopOAuthError::InvalidCredential);
    }
    let mut record = StoredRefreshCredential {
        schema_version: 1,
        refresh_token: refresh_token.to_owned(),
        request_id: request_id.map(str::to_owned),
    };
    let mut encoded = Zeroizing::new(
        serde_json::to_vec(&record).map_err(|_| DesktopOAuthError::InvalidCredential)?,
    );
    record.refresh_token.zeroize();
    if let Some(request_id) = record.request_id.as_mut() {
        request_id.zeroize();
    }
    let result = store_native_refresh_bytes(&encoded);
    encoded.zeroize();
    result
}

#[cfg(target_os = "macos")]
fn load_native_refresh() -> Result<Option<Vec<u8>>, DesktopOAuthError> {
    load_native_item(KEYCHAIN_ACCOUNT)
}

#[cfg(target_os = "macos")]
fn load_native_item(account: &str) -> Result<Option<Vec<u8>>, DesktopOAuthError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, account) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(DesktopOAuthError::CredentialStoreUnavailable),
    }
}

#[cfg(target_os = "macos")]
fn store_native_refresh_bytes(value: &[u8]) -> Result<(), DesktopOAuthError> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, value)
        .map_err(|_| DesktopOAuthError::CredentialStoreUnavailable)
}

#[cfg(target_os = "macos")]
fn clear_native_refresh() -> Result<(), DesktopOAuthError> {
    const ITEM_NOT_FOUND: i32 = -25_300;
    match security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
    {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
        Err(_) => Err(DesktopOAuthError::CredentialStoreUnavailable),
    }
}

#[cfg(not(target_os = "macos"))]
fn load_native_refresh() -> Result<Option<Vec<u8>>, DesktopOAuthError> {
    let _ = (KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    Err(DesktopOAuthError::CredentialStoreUnavailable)
}

#[cfg(not(target_os = "macos"))]
fn store_native_refresh_bytes(_value: &[u8]) -> Result<(), DesktopOAuthError> {
    Err(DesktopOAuthError::CredentialStoreUnavailable)
}

#[cfg(not(target_os = "macos"))]
fn clear_native_refresh() -> Result<(), DesktopOAuthError> {
    Err(DesktopOAuthError::CredentialStoreUnavailable)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn valid_verifier(value: &str) -> bool {
    (43..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
}

fn valid_state(value: &str) -> bool {
    (32..=128).contains(&value.len()) && valid_verifier(value)
}

fn valid_base64url(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_canonical_second(value: &str) -> bool {
    value.len() == 20
        && value.ends_with('Z')
        && value.bytes().enumerate().all(|(index, byte)| match index {
            4 | 7 => byte == b'-',
            10 => byte == b'T',
            13 | 16 => byte == b':',
            19 => byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
}

fn valid_authorization_code(value: &str) -> bool {
    valid_bearer_token(value, "gd_ac1")
}

fn valid_bearer_token(value: &str, prefix: &str) -> bool {
    if value.len() > MAX_REFRESH_TOKEN_BYTES {
        return false;
    }
    let mut segments = value.split('.');
    let valid = segments.next() == Some(prefix)
        && segments.next().is_some_and(|account| {
            !account.is_empty()
                && account.len() <= 216
                && account
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        && segments.next().is_some_and(|secret| {
            secret.len() == 43
                && secret
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        });
    valid && segments.next().is_none()
}

fn valid_refresh_request_id(value: &str) -> bool {
    value.len() == 32
        && value.starts_with("refresh-")
        && value[8..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> DesktopDeviceIdentity {
        DesktopDeviceIdentity::from_test_material("device-a", "device-key-a", [0x41; 32])
    }

    fn attempt() -> DesktopOAuthAttempt {
        let identity = identity();
        DesktopOAuthAttempt::from_material(
            "https://cloud.gooddealer.test/",
            "device-a",
            "device-key-a",
            &identity.public_key_base64url(),
            "V".repeat(64),
            "S".repeat(43),
        )
        .unwrap()
    }

    #[test]
    fn builds_fixed_pkce_authorization_and_accepts_only_the_matching_callback() {
        let attempt = attempt();
        let pairs: std::collections::BTreeMap<_, _> = attempt
            .authorization_url()
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        assert_eq!(attempt.authorization_url().scheme(), "https");
        assert_eq!(attempt.authorization_url().path(), AUTHORIZE_PATH);
        assert_eq!(pairs.get("client_id").map(String::as_str), Some(CLIENT_ID));
        assert_eq!(
            pairs.get("redirect_uri").map(String::as_str),
            Some(REDIRECT_URI)
        );
        assert_eq!(
            pairs.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(pairs.get("state"), Some(&"S".repeat(43)));

        let identity = identity();
        let challenge_callback = Url::parse(&format!(
            "gooddealer://oauth/callback?account_id=account-a&challenge_id=login-challenge-a&device_id=device-a&expires_at=2026-09-01T00%3A02%3A00Z&key_id=device-key-a&nonce_digest={}&state={}",
            "N".repeat(43),
            "S".repeat(43)
        ))
        .unwrap();
        let continuation = attempt.advance(&challenge_callback, &identity).unwrap();
        let DesktopOAuthContinuation::Authorize {
            attempt,
            authorization_url,
        } = continuation
        else {
            panic!("challenge must continue browser authorization");
        };
        let proof_pairs: std::collections::BTreeMap<_, _> = authorization_url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        assert_eq!(
            proof_pairs.get("challenge_id").map(String::as_str),
            Some("login-challenge-a")
        );
        assert_eq!(
            proof_pairs.get("device_signature").map(String::len),
            Some(86)
        );

        let code = format!("gd_ac1.YWNjb3VudC1h.{}", "A".repeat(43));
        let callback = Url::parse(&format!(
            "gooddealer://oauth/callback?code={code}&state={}",
            "S".repeat(43)
        ))
        .unwrap();
        let DesktopOAuthContinuation::Exchange(exchange) =
            (*attempt).advance(&callback, &identity).unwrap()
        else {
            panic!("code must continue to token exchange");
        };
        exchange.expose(|observed_code, observed_verifier| {
            assert_eq!(observed_code, code);
            assert_eq!(observed_verifier, "V".repeat(64));
        });
        assert_eq!(
            format!("{exchange:?}"),
            "DesktopAuthorizationCodeExchange([REDACTED])"
        );
    }

    #[test]
    fn rejects_origin_callback_state_and_query_substitution() {
        assert_eq!(
            DesktopOAuthAttempt::from_material(
                "http://cloud.gooddealer.test/",
                "device-a",
                "device-key-a",
                &identity().public_key_base64url(),
                "V".repeat(64),
                "S".repeat(43),
            )
            .err()
            .unwrap(),
            DesktopOAuthError::InvalidConfiguration
        );
        let code = format!("gd_ac1.YWNjb3VudC1h.{}", "A".repeat(43));
        for callback in [
            format!(
                "gooddealer://attacker/callback?code={code}&state={}",
                "S".repeat(43)
            ),
            format!(
                "gooddealer://oauth/callback?code={code}&state={}",
                "X".repeat(43)
            ),
            format!(
                "gooddealer://oauth/callback?code={code}&state={}&extra=x",
                "S".repeat(43)
            ),
            format!(
                "gooddealer://oauth/callback?code={code}&code={code}&state={}",
                "S".repeat(43)
            ),
        ] {
            assert_eq!(
                attempt()
                    .advance(&Url::parse(&callback).unwrap(), &identity())
                    .err()
                    .unwrap(),
                DesktopOAuthError::InvalidCallback
            );
        }
    }

    #[test]
    fn refresh_credentials_are_exactly_validated_and_redacted() {
        let valid =
            DesktopRefreshToken::new(format!("gd_rt1.YWNjb3VudC1h.{}", "R".repeat(43))).unwrap();
        assert_eq!(format!("{valid:?}"), "DesktopRefreshToken([REDACTED])");
        let access =
            DesktopAccessToken::new(format!("gd_at1.YWNjb3VudC1h.{}", "A".repeat(43))).unwrap();
        assert_eq!(format!("{access:?}"), "DesktopAccessToken([REDACTED])");
        for invalid in [
            "raw-secret".to_owned(),
            format!("gd_at1.YWNjb3VudC1h.{}", "R".repeat(43)),
            format!("gd_rt1.YWNjb3VudC1h.{}", "R".repeat(42)),
        ] {
            assert_eq!(
                DesktopRefreshToken::new(invalid).err().unwrap(),
                DesktopOAuthError::InvalidCredential
            );
        }
    }

    #[test]
    fn refresh_request_identity_is_recovered_with_the_presented_token() {
        let token = format!("gd_rt1.YWNjb3VudC1h.{}", "R".repeat(43));
        let request_id = "refresh-AAAAAAAAAAAAAAAAAAAAAAAA";
        let encoded = serde_json::to_vec(&StoredRefreshCredential {
            schema_version: 1,
            refresh_token: token.clone(),
            request_id: Some(request_id.to_owned()),
        })
        .unwrap();
        let recovered = decode_refresh_record(&encoded).unwrap();
        assert_eq!(recovered.refresh_token, token);
        assert_eq!(recovered.request_id.as_deref(), Some(request_id));

        let completed = serde_json::to_vec(&StoredRefreshCredential {
            schema_version: 1,
            refresh_token: format!("gd_rt1.YWNjb3VudC1h.{}", "N".repeat(43)),
            request_id: None,
        })
        .unwrap();
        assert!(
            decode_refresh_record(&completed)
                .unwrap()
                .request_id
                .is_none()
        );
    }
}
