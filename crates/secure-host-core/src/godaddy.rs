//! Official `GoDaddy` Domains v3 account inventory. PATs and response bodies stay in Native.

use std::{fmt, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, Request, StatusCode, header};
use zeroize::Zeroizing;

#[path = "godaddy/credentials.rs"]
mod credentials;
pub use credentials::{
    GoDaddyCapture, GoDaddyCredentialPlan, load_godaddy_credential_guarded,
    publish_godaddy_credential_guarded, purge_godaddy_credential_guarded,
};

pub(crate) use credentials::MAX_GODADDY_PAT_BYTES;

#[path = "godaddy/registrar_wire.rs"]
mod registrar_wire;

const ORIGIN: &str = "https://api.godaddy.com";
const DOMAINS_PATH: &str = "/v3/domains/domain-names";
const PAGE_SIZE: usize = 100;
const MAX_DOMAINS: usize = 10_000;
const MAX_PAGES: usize = 1024;
const MAX_BODY: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GoDaddyError {
    AuthorityStale,
    InputRejected,
    CaptureCancelled,
    CustodyUnavailable,
    CustodyMismatch,
    CustodyOutcomeUnknown,
    AuthenticationRequired,
    Forbidden,
    RateLimited,
    Unavailable,
    ProtocolRejected,
}

impl fmt::Display for GoDaddyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityStale => "godaddy_authority_stale",
            Self::InputRejected => "godaddy_input_rejected",
            Self::CaptureCancelled => "godaddy_capture_cancelled",
            Self::CustodyUnavailable => "godaddy_custody_unavailable",
            Self::CustodyMismatch => "godaddy_custody_mismatch",
            Self::CustodyOutcomeUnknown => "godaddy_custody_outcome_unknown",
            Self::AuthenticationRequired => "godaddy_authentication_required",
            Self::Forbidden => "godaddy_forbidden",
            Self::RateLimited => "godaddy_rate_limited",
            Self::Unavailable => "godaddy_unavailable",
            Self::ProtocolRejected => "godaddy_protocol_rejected",
        })
    }
}
impl std::error::Error for GoDaddyError {}

pub type GoDaddyGuard<'a> = dyn FnMut() -> Result<(), GoDaddyError> + Send + 'a;

pub struct GoDaddyCredential(Zeroizing<String>);

impl fmt::Debug for GoDaddyCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("GoDaddyCredential([REDACTED])")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct GoDaddyRegistration {
    pub domain: String,
    pub registered_on: String,
    pub expires_on: String,
    pub auto_renew: bool,
    pub transfer_locked: Option<bool>,
    pub standing: GoDaddyRegistrationStanding,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GoDaddyRegistrationStanding {
    Active,
    PendingTransfer,
    Inactive,
}

pub struct GoDaddyRegistrarClient {
    client: Client,
}

impl GoDaddyRegistrarClient {
    /// Builds the fixed direct HTTPS client for account-owned inventory.
    ///
    /// # Errors
    /// Returns a closed error if the TLS client cannot be initialized.
    pub fn production() -> Result<Self, GoDaddyError> {
        Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("GoodDealer/0.0.0 (GoDaddy Registrar client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| GoDaddyError::Unavailable)
    }

    /// Reads all cursor pages of the PAT owner's domain inventory.
    ///
    /// # Errors
    /// Rejects stale authority, authentication or permission errors, unsafe continuation links,
    /// malformed responses, duplicate domains, and scans that do not reach a terminal page.
    pub async fn scan(
        &self,
        credential: &GoDaddyCredential,
        guard: &mut GoDaddyGuard<'_>,
    ) -> Result<Vec<GoDaddyRegistration>, GoDaddyError> {
        let mut inventory = registrar_wire::InventoryScan::default();
        let mut cursor: Option<Zeroizing<String>> = None;
        for _ in 0..MAX_PAGES {
            guard()?;
            let response = self
                .client
                .execute(self.request(credential, cursor.as_ref().map(|token| token.as_str()))?)
                .await;
            guard()?;
            let body = read_page(response.map_err(|_| GoDaddyError::Unavailable)?, guard).await?;
            cursor = inventory.accept(&body)?;
            guard()?;
            if cursor.is_none() {
                return Ok(inventory.into_registrations());
            }
        }
        Err(GoDaddyError::ProtocolRejected)
    }

    fn request(
        &self,
        credential: &GoDaddyCredential,
        cursor: Option<&str>,
    ) -> Result<Request, GoDaddyError> {
        let mut url = reqwest::Url::parse(ORIGIN).map_err(|_| GoDaddyError::Unavailable)?;
        url.set_path(DOMAINS_PATH);
        url.query_pairs_mut()
            .append_pair("pageSize", &PAGE_SIZE.to_string());
        if let Some(cursor) = cursor {
            url.query_pairs_mut().append_pair("pageToken", cursor);
        }
        let access = Zeroizing::new(format!("Bearer {}", credential.0.as_str()));
        let mut authorization =
            header::HeaderValue::from_str(&access).map_err(|_| GoDaddyError::InputRejected)?;
        authorization.set_sensitive(true);
        self.client
            .get(url)
            .header(header::AUTHORIZATION, authorization)
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .build()
            .map_err(|_| GoDaddyError::InputRejected)
    }
}

async fn read_page(
    response: reqwest::Response,
    guard: &mut GoDaddyGuard<'_>,
) -> Result<Zeroizing<Vec<u8>>, GoDaddyError> {
    let invalid = GoDaddyError::ProtocolRejected;
    match response.status() {
        StatusCode::OK => {}
        StatusCode::UNAUTHORIZED => return Err(GoDaddyError::AuthenticationRequired),
        StatusCode::FORBIDDEN => return Err(GoDaddyError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => return Err(GoDaddyError::RateLimited),
        status if status.is_server_error() => return Err(GoDaddyError::Unavailable),
        _ => return Err(invalid),
    }
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
        let chunk = chunk.map_err(|_| GoDaddyError::Unavailable)?;
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
    fn only_the_fixed_account_get_can_carry_a_sensitive_pat() {
        let token = GoDaddyCredential(Zeroizing::new("synthetic-PAT".into()));
        let request = GoDaddyRegistrarClient::production()
            .unwrap()
            .request(&token, Some("cursor+/?&="))
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(request.url().origin().ascii_serialization(), ORIGIN);
        assert_eq!(request.url().path(), DOMAINS_PATH);
        assert_eq!(
            request.url().query_pairs().collect::<Vec<_>>(),
            [
                ("pageSize".into(), "100".into()),
                ("pageToken".into(), "cursor+/?&=".into())
            ],
        );
        let authorization = &request.headers()[header::AUTHORIZATION];
        assert_eq!(authorization, "Bearer synthetic-PAT");
        assert!(authorization.is_sensitive());
        assert!(!request.headers().contains_key("x-shopper-id"));
        assert!(!format!("{token:?} {request:?}").contains("synthetic-PAT"));
    }
}
