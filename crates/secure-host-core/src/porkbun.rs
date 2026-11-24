//! Official Porkbun API v3 account inventory. API keys and response bodies stay in Native.
//!
//! Facts: `docs/PROVIDER_API_REVIEW.md`, Porkbun `OpenAPI` v3.112 read on 2026-11-24. Only the
//! read-only `/domain/listAll` endpoint is constructed here; money endpoints are never reachable.

use std::{fmt, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, Request, StatusCode, header};
use zeroize::Zeroizing;

#[path = "porkbun/credentials.rs"]
mod credentials;
pub use credentials::{
    PorkbunCapture, PorkbunCredentialPlan, load_porkbun_credential_guarded,
    publish_porkbun_credential_guarded, purge_porkbun_credential_guarded,
};

#[path = "porkbun/registrar_wire.rs"]
mod registrar_wire;

const ORIGIN: &str = "https://api.porkbun.com";
const LIST_PATH: &str = "/api/json/v3/domain/listAll";
/// The documented page size: a page shorter than this is the last one.
const PAGE_SIZE: usize = 1000;
const MAX_DOMAINS: usize = 10_000;
/// A capped account fills `MAX_DOMAINS / PAGE_SIZE` pages and must then end on an empty page.
const MAX_PAGES: usize = MAX_DOMAINS / PAGE_SIZE + 1;
const MAX_BODY: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PorkbunError {
    AuthorityStale,
    InputRejected,
    CaptureCancelled,
    CustodyUnavailable,
    CustodyMismatch,
    CustodyOutcomeUnknown,
    AuthenticationRequired,
    RateLimited,
    Unavailable,
    ProtocolRejected,
}

impl fmt::Display for PorkbunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityStale => "porkbun_authority_stale",
            Self::InputRejected => "porkbun_input_rejected",
            Self::CaptureCancelled => "porkbun_capture_cancelled",
            Self::CustodyUnavailable => "porkbun_custody_unavailable",
            Self::CustodyMismatch => "porkbun_custody_mismatch",
            Self::CustodyOutcomeUnknown => "porkbun_custody_outcome_unknown",
            Self::AuthenticationRequired => "porkbun_authentication_required",
            Self::RateLimited => "porkbun_rate_limited",
            Self::Unavailable => "porkbun_unavailable",
            Self::ProtocolRejected => "porkbun_protocol_rejected",
        })
    }
}
impl std::error::Error for PorkbunError {}

pub type PorkbunGuard<'a> = dyn FnMut() -> Result<(), PorkbunError> + Send + 'a;

pub struct PorkbunCredential {
    key: Zeroizing<String>,
    secret: Zeroizing<String>,
}

impl fmt::Debug for PorkbunCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PorkbunCredential([REDACTED])")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct PorkbunRegistration {
    pub domain: String,
    pub registered_on: String,
    pub expires_on: String,
    pub auto_renew: bool,
    pub transfer_locked: bool,
    /// Whether the account owner opted this domain in to API access. Inventory still lists it.
    pub api_access: bool,
}

pub struct PorkbunRegistrarClient {
    client: Client,
}

impl PorkbunRegistrarClient {
    /// Builds the fixed direct HTTPS client for account-owned inventory.
    ///
    /// # Errors
    /// Returns a closed error if the TLS client cannot be initialized.
    pub fn production() -> Result<Self, PorkbunError> {
        Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("GoodDealer/0.0.0 (Porkbun Registrar client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| PorkbunError::Unavailable)
    }

    /// Reads every offset page of the key owner's domain list, sorted by domain name.
    ///
    /// # Errors
    /// Rejects stale authority, authentication errors, rate limits, malformed or inconsistent
    /// pages, duplicate domains, and scans that do not reach a terminal page.
    pub async fn scan(
        &self,
        credential: &PorkbunCredential,
        guard: &mut PorkbunGuard<'_>,
    ) -> Result<Vec<PorkbunRegistration>, PorkbunError> {
        let mut inventory = registrar_wire::InventoryScan::default();
        for page in 0..MAX_PAGES {
            guard()?;
            let response = self
                .client
                .execute(self.request(credential, page * PAGE_SIZE)?)
                .await;
            guard()?;
            let body = read_page(response.map_err(|_| PorkbunError::Unavailable)?, guard).await?;
            let more = inventory.accept(&body)?;
            guard()?;
            if !more {
                return Ok(inventory.into_registrations());
            }
        }
        Err(PorkbunError::ProtocolRejected)
    }

    fn request(
        &self,
        credential: &PorkbunCredential,
        start: usize,
    ) -> Result<Request, PorkbunError> {
        let mut url = reqwest::Url::parse(ORIGIN).map_err(|_| PorkbunError::Unavailable)?;
        url.set_path(LIST_PATH);
        // Credentials travel only in sensitive headers, so the body never holds a secret.
        // A fixed domain sort keeps offset pages stable; the default expiry sort can reorder
        // ties between requests.
        let body = serde_json::to_vec(&serde_json::json!({
            "start": start,
            "sortName": "domain",
            "sortDirection": "asc",
        }))
        .map_err(|_| PorkbunError::InputRejected)?;
        let mut key = header::HeaderValue::from_str(credential.key.as_str())
            .map_err(|_| PorkbunError::InputRejected)?;
        key.set_sensitive(true);
        let mut secret = header::HeaderValue::from_str(credential.secret.as_str())
            .map_err(|_| PorkbunError::InputRejected)?;
        secret.set_sensitive(true);
        self.client
            .post(url)
            .header("x-api-key", key)
            .header("x-secret-api-key", secret)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .body(body)
            .build()
            .map_err(|_| PorkbunError::InputRejected)
    }
}

/// `listAll` documents 400 as an authentication error. The API-wide table documents 403 for
/// additional authentication, including a key's IP allowlist (`IP_NOT_ALLOWED`); both need the
/// account owner rather than a retry. Undocumented statuses, redirects included, fail closed.
fn status_class(status: StatusCode) -> Result<(), PorkbunError> {
    match status {
        StatusCode::OK => Ok(()),
        StatusCode::BAD_REQUEST | StatusCode::FORBIDDEN => {
            Err(PorkbunError::AuthenticationRequired)
        }
        StatusCode::TOO_MANY_REQUESTS => Err(PorkbunError::RateLimited),
        status if status.is_server_error() => Err(PorkbunError::Unavailable),
        _ => Err(PorkbunError::ProtocolRejected),
    }
}

async fn read_page(
    response: reqwest::Response,
    guard: &mut PorkbunGuard<'_>,
) -> Result<Zeroizing<Vec<u8>>, PorkbunError> {
    let invalid = PorkbunError::ProtocolRejected;
    status_class(response.status())?;
    let mut types = response.headers().get_all(header::CONTENT_TYPE).iter();
    let content_type = types
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(invalid)?;
    let mut parts = content_type.split(';').map(str::trim);
    if !parts
        .next()
        .is_some_and(|value| value.eq_ignore_ascii_case("application/json"))
        || parts
            .next()
            .is_some_and(|value| !value.eq_ignore_ascii_case("charset=utf-8"))
        || parts.next().is_some()
        || types.next().is_some()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_BODY as u64)
    {
        return Err(invalid);
    }
    let mut body = Zeroizing::new(Vec::new());
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        guard()?;
        let chunk = chunk.map_err(|_| PorkbunError::Unavailable)?;
        if chunk.len() > MAX_BODY - body.len() {
            return Err(invalid);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_fixed_list_post_carries_sensitive_key_headers() {
        let credential = PorkbunCredential {
            key: Zeroizing::new("pk1_synthetic".into()),
            secret: Zeroizing::new("sk1_synthetic".into()),
        };
        let request = PorkbunRegistrarClient::production()
            .unwrap()
            .request(&credential, 2000)
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.url().as_str(), format!("{ORIGIN}{LIST_PATH}"));
        let body: serde_json::Value =
            serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"start":2000,"sortName":"domain","sortDirection":"asc"})
        );
        for (name, value) in [
            ("x-api-key", "pk1_synthetic"),
            ("x-secret-api-key", "sk1_synthetic"),
        ] {
            assert_eq!(request.headers()[name], value);
            assert!(request.headers()[name].is_sensitive());
        }
        let printed = format!("{credential:?} {request:?}");
        assert!(!printed.contains("pk1_synthetic") && !printed.contains("sk1_synthetic"));
    }

    #[test]
    fn status_codes_map_to_closed_classes() {
        for (status, expected) in [
            (200, Ok(())),
            (400, Err(PorkbunError::AuthenticationRequired)),
            (403, Err(PorkbunError::AuthenticationRequired)),
            (429, Err(PorkbunError::RateLimited)),
            (503, Err(PorkbunError::Unavailable)),
            (401, Err(PorkbunError::ProtocolRejected)),
            (302, Err(PorkbunError::ProtocolRejected)),
            (404, Err(PorkbunError::ProtocolRejected)),
        ] {
            assert_eq!(
                status_class(StatusCode::from_u16(status).unwrap()),
                expected
            );
        }
    }

    #[test]
    fn header_unsafe_keys_are_refused_before_any_request() {
        let credential = PorkbunCredential {
            key: Zeroizing::new("pk1\nInjected: yes".into()),
            secret: Zeroizing::new("sk1_synthetic".into()),
        };
        assert_eq!(
            PorkbunRegistrarClient::production()
                .unwrap()
                .request(&credential, 0)
                .unwrap_err(),
            PorkbunError::InputRejected
        );
    }
}
