use std::fmt;

use serde::Deserialize;

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

    fn as_bytes(&self) -> &[u8] {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretRef(String);

impl SecretRef {
    #[must_use]
    pub fn new(value: String) -> Self {
        Self(value)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub struct SecretEntry<'a> {
    pub label: &'a str,
    pub material: &'a SecretMaterial,
}

pub trait SecretStore {
    type Error;

    /// Atomically stores every entry or stores none of them.
    ///
    /// # Errors
    ///
    /// Returns the platform store error without falling back to a weaker persistence path.
    fn store_batch(
        &mut self,
        namespace: &str,
        entries: &[SecretEntry<'_>],
    ) -> Result<Vec<SecretRef>, Self::Error>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthSessionStatus {
    pub authenticated: bool,
    pub expires_in_seconds: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SecretExtractionError<StoreError> {
    InvalidResponse,
    Store(StoreError),
    UnexpectedStoreResult,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthTokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    #[serde(rename = "token_type")]
    _token_type: TokenType,
}

#[derive(Deserialize)]
enum TokenType {
    #[serde(rename = "Bearer")]
    Bearer,
}

/// Extracts a Host-owned auth response and atomically stores both tokens before constructing the
/// public, redacted status.
///
/// # Errors
///
/// Returns [`SecretExtractionError`] when the response is malformed or contains unknown fields,
/// when the atomic store fails, or when the store does not return exactly two opaque references.
pub fn extract_and_store_auth_session<S: SecretStore>(
    response: SecretResponseBody,
    store: &mut S,
) -> Result<AuthSessionStatus, SecretExtractionError<S::Error>> {
    let parsed: AuthTokenResponse = serde_json::from_slice(response.as_bytes())
        .map_err(|_| SecretExtractionError::InvalidResponse)?;
    drop(response);
    let access_token = SecretMaterial::new(parsed.access_token.into_bytes());
    let refresh_token = SecretMaterial::new(parsed.refresh_token.into_bytes());
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
    let mut references = store
        .store_batch("gooddealer-account", &entries)
        .map_err(SecretExtractionError::Store)?;
    if references.len() != 2 {
        return Err(SecretExtractionError::UnexpectedStoreResult);
    }
    references.clear();

    Ok(AuthSessionStatus {
        authenticated: true,
        expires_in_seconds: parsed.expires_in,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        SecretEntry, SecretExtractionError, SecretMaterial, SecretRef, SecretResponseBody,
        SecretStore, extract_and_store_auth_session,
    };

    const CANARY: &str = "GOODDEALER_CANARY_SECRET_41f5";

    #[derive(Default)]
    struct FakeStore {
        batches: Vec<Vec<Vec<u8>>>,
    }

    impl SecretStore for FakeStore {
        type Error = ();

        fn store_batch(
            &mut self,
            _namespace: &str,
            entries: &[SecretEntry<'_>],
        ) -> Result<Vec<SecretRef>, Self::Error> {
            self.batches.push(
                entries
                    .iter()
                    .map(|entry| entry.material.expose_secret().to_vec())
                    .collect(),
            );
            Ok(vec![
                SecretRef::new("opaque-access".to_owned()),
                SecretRef::new("opaque-refresh".to_owned()),
            ])
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
            &mut store,
        )
        .expect("typed response should be stored");

        assert_eq!(store.batches.len(), 1);
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
                &mut store,
            ),
            Err(SecretExtractionError::InvalidResponse)
        );
        assert!(store.batches.is_empty());
    }
}
