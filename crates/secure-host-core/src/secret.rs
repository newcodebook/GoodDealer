use std::fmt;

#[cfg(test)]
use serde::Deserialize;

#[cfg(test)]
const MAX_HEADER_SECRET_BYTES: usize = 8 * 1024;
#[cfg(test)]
const MAX_TOKEN_LIFETIME_SECONDS: u64 = 365 * 24 * 60 * 60;

pub struct SecretMaterial(Vec<u8>);

impl SecretMaterial {
    #[must_use]
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    #[must_use]
    pub fn expose_secret(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for SecretMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretMaterial([REDACTED])")
    }
}

impl Drop for SecretMaterial {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

pub struct SecretResponseBody(Vec<u8>);

impl SecretResponseBody {
    #[must_use]
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    #[cfg(test)]
    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for SecretResponseBody {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretResponseBody([REDACTED])")
    }
}

impl Drop for SecretResponseBody {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

pub struct SecretEntry<'a> {
    pub label: &'a str,
    pub material: &'a SecretMaterial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountSessionSecretScope<'a> {
    pub account_id: &'a str,
    pub device_id: &'a str,
    pub session_generation: u64,
    pub source_endpoint_id: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderConnectionSecretScope<'a> {
    pub device_id: &'a str,
    pub provider_connection_id: &'a str,
    pub provider: &'a str,
    pub credential_profile_id: &'a str,
    pub credential_profile_version: u32,
    pub source_endpoint_id: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretWriteScope<'a> {
    AccountSession(AccountSessionSecretScope<'a>),
    ProviderConnection(ProviderConnectionSecretScope<'a>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SecretStoreReceipt(());

impl SecretStoreReceipt {
    /// Constructs a receipt only after the entire batch has been durably committed.
    #[must_use]
    pub const fn committed() -> Self {
        Self(())
    }
}

pub trait SecretStore {
    type Error;

    /// Atomically stores every entry or stores none of them. `Ok` may be returned only after the
    /// entire batch is durably committed; `Err` means no entry was committed.
    ///
    /// # Errors
    ///
    /// Returns the platform store error without falling back to a weaker persistence path.
    fn store_batch(
        &mut self,
        scope: SecretWriteScope<'_>,
        entries: &[SecretEntry<'_>],
    ) -> Result<SecretStoreReceipt, Self::Error>;
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthSessionStatus {
    pub authenticated: bool,
    pub expires_in_seconds: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SecretExtractionError<StoreError> {
    InvalidResponse,
    Store(StoreError),
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthTokenResponse {
    access_token: SecretText,
    refresh_token: SecretText,
    expires_in: u64,
    #[serde(rename = "token_type")]
    _token_type: TokenType,
}

#[cfg(test)]
#[derive(Deserialize)]
enum TokenType {
    #[serde(rename = "Bearer")]
    Bearer,
}

#[cfg(test)]
#[derive(Deserialize)]
struct SecretText(String);

#[cfg(test)]
impl SecretText {
    fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    fn into_material(mut self) -> SecretMaterial {
        SecretMaterial::new(std::mem::take(&mut self.0).into_bytes())
    }
}

#[cfg(test)]
impl fmt::Debug for SecretText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretText([REDACTED])")
    }
}

#[cfg(test)]
impl Drop for SecretText {
    fn drop(&mut self) {
        let mut bytes = std::mem::take(&mut self.0).into_bytes();
        bytes.fill(0);
    }
}

#[cfg(test)]
fn validate_header_secret(secret: &SecretText) -> bool {
    let bytes = secret.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_HEADER_SECRET_BYTES
        && bytes.iter().all(|byte| matches!(byte, 0x21..=0x7e))
}

#[cfg(test)]
const fn valid_token_lifetime(expires_in_seconds: u64) -> bool {
    expires_in_seconds > 0 && expires_in_seconds <= MAX_TOKEN_LIFETIME_SECONDS
}

/// Test-only legacy fixture for Host-owned auth response parsing. It intentionally does not model
/// the production split between a durable refresh-token store and an in-memory access-token
/// session store, so it cannot be used as production session evidence.
///
/// # Errors
///
/// Returns [`SecretExtractionError`] when the response is malformed or contains unknown fields,
/// or when the atomic store fails.
#[cfg(test)]
pub fn extract_and_store_auth_session<S: SecretStore>(
    response: SecretResponseBody,
    scope: AccountSessionSecretScope<'_>,
    store: &mut S,
) -> Result<AuthSessionStatus, SecretExtractionError<S::Error>> {
    let parsed: AuthTokenResponse = serde_json::from_slice(response.as_bytes())
        .map_err(|_| SecretExtractionError::InvalidResponse)?;
    drop(response);
    if !validate_header_secret(&parsed.access_token)
        || !validate_header_secret(&parsed.refresh_token)
        || !valid_token_lifetime(parsed.expires_in)
    {
        return Err(SecretExtractionError::InvalidResponse);
    }
    let access_token = parsed.access_token.into_material();
    let refresh_token = parsed.refresh_token.into_material();
    let entries = [
        SecretEntry {
            label: "access-token",
            material: &access_token,
        },
        SecretEntry {
            label: "refresh-token",
            material: &refresh_token,
        },
    ];
    let _receipt = store
        .store_batch(SecretWriteScope::AccountSession(scope), &entries)
        .map_err(SecretExtractionError::Store)?;

    Ok(AuthSessionStatus {
        authenticated: true,
        expires_in_seconds: parsed.expires_in,
    })
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderCredentialStatus {
    pub credential_healthy: bool,
    pub expires_in_seconds: u64,
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderApiTokenResponse {
    api_token: SecretText,
    expires_in: u64,
    #[serde(rename = "token_type")]
    _token_type: TokenType,
}

#[cfg(test)]
pub(crate) fn extract_and_store_provider_api_token<S: SecretStore>(
    response: SecretResponseBody,
    scope: ProviderConnectionSecretScope<'_>,
    store: &mut S,
) -> Result<ProviderCredentialStatus, SecretExtractionError<S::Error>> {
    let parsed: ProviderApiTokenResponse = serde_json::from_slice(response.as_bytes())
        .map_err(|_| SecretExtractionError::InvalidResponse)?;
    drop(response);
    if !validate_header_secret(&parsed.api_token) || !valid_token_lifetime(parsed.expires_in) {
        return Err(SecretExtractionError::InvalidResponse);
    }
    let api_token = parsed.api_token.into_material();
    let entries = [SecretEntry {
        label: "api-token",
        material: &api_token,
    }];
    let _receipt = store
        .store_batch(SecretWriteScope::ProviderConnection(scope), &entries)
        .map_err(SecretExtractionError::Store)?;

    Ok(ProviderCredentialStatus {
        credential_healthy: true,
        expires_in_seconds: parsed.expires_in,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        AccountSessionSecretScope, SecretEntry, SecretExtractionError, SecretMaterial,
        SecretResponseBody, SecretStore, SecretStoreReceipt, SecretWriteScope,
        extract_and_store_auth_session,
    };

    const CANARY: &str = "GOODDEALER_CANARY_SECRET_41f5";

    #[derive(Default)]
    struct FakeStore {
        batches: Vec<Vec<Vec<u8>>>,
        scopes: Vec<String>,
    }

    impl SecretStore for FakeStore {
        type Error = ();

        fn store_batch(
            &mut self,
            scope: SecretWriteScope<'_>,
            entries: &[SecretEntry<'_>],
        ) -> Result<SecretStoreReceipt, Self::Error> {
            self.scopes.push(format!("{scope:?}"));
            self.batches.push(
                entries
                    .iter()
                    .map(|entry| entry.material.expose_secret().to_vec())
                    .collect(),
            );
            Ok(SecretStoreReceipt::committed())
        }
    }

    const fn account_scope() -> AccountSessionSecretScope<'static> {
        AccountSessionSecretScope {
            account_id: "account-a",
            device_id: "device-a",
            session_generation: 7,
            source_endpoint_id: "gooddealer.account.session.exchange",
        }
    }

    #[test]
    fn debug_output_is_always_redacted() {
        let secret = SecretMaterial::new(CANARY.as_bytes().to_vec());
        let rendered = format!("{secret:?}");
        assert!(!rendered.contains(CANARY));
        assert!(rendered.contains("REDACTED"));
    }

    #[test]
    fn typed_extractor_stores_tokens_and_returns_only_redacted_status() {
        let response = format!(
            r#"{{"access_token":"{CANARY}","refresh_token":"refresh-secret","expires_in":900,"token_type":"Bearer"}}"#
        );
        let mut store = FakeStore::default();
        let status = extract_and_store_auth_session(
            SecretResponseBody::new(response.into_bytes()),
            account_scope(),
            &mut store,
        )
        .expect("typed response should be stored");

        assert_eq!(store.batches.len(), 1);
        assert!(store.scopes[0].contains("account-a"));
        assert!(store.scopes[0].contains("device-a"));
        assert!(status.authenticated);
        assert!(!format!("{status:?}").contains(CANARY));
    }

    #[test]
    fn typed_extractor_rejects_unknown_fields_before_store() {
        let response = format!(
            r#"{{"access_token":"{CANARY}","refresh_token":"refresh-secret","expires_in":900,"token_type":"Bearer","unexpected":"secret"}}"#
        );
        let mut store = FakeStore::default();
        assert_eq!(
            extract_and_store_auth_session(
                SecretResponseBody::new(response.into_bytes()),
                account_scope(),
                &mut store,
            ),
            Err(SecretExtractionError::InvalidResponse)
        );
        assert!(store.batches.is_empty());
    }

    #[test]
    fn typed_extractor_rejects_unsafe_tokens_before_store() {
        let unsafe_response =
            br#"{"access_token":"line\nbreak","refresh_token":"refresh","expires_in":900,"token_type":"Bearer"}"#;
        let mut store = FakeStore::default();
        assert_eq!(
            extract_and_store_auth_session(
                SecretResponseBody::new(unsafe_response.to_vec()),
                account_scope(),
                &mut store,
            ),
            Err(SecretExtractionError::InvalidResponse)
        );
        assert!(store.batches.is_empty());
    }
}
