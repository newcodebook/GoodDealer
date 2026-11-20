//! Official Atom Seller API. The query credentials and raw response stay in Native.
//! Evidence: Atom Marketplace `OpenAPI` 1.0.0 `GET /domains` and its live anonymous response.

use std::{fmt, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, Request, StatusCode, header};
use zeroize::Zeroizing;

#[path = "atom/credentials.rs"]
mod credentials;
#[path = "atom/portfolio_wire.rs"]
mod portfolio_wire;
pub use credentials::{
    AtomCapture, AtomCredentialPlan, load_atom_credential_guarded, publish_atom_credential_guarded,
    purge_atom_credential_guarded,
};

const DOMAINS: &str = "https://www.atom.com/api/marketplace/domains";
const PAGE_SIZE: usize = 100;
const MAX_LISTINGS: usize = 10_000;
const MAX_PAGES: usize = MAX_LISTINGS / PAGE_SIZE + 1;
const MAX_BODY: usize = 512 * 1024;
const MISSING_CREDENTIALS: &[u8] = br#"{"message":"API Token and UserId are required"}"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AtomError {
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

impl fmt::Display for AtomError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityStale => "atom_authority_stale",
            Self::InputRejected => "atom_input_rejected",
            Self::CaptureCancelled => "atom_capture_cancelled",
            Self::CustodyUnavailable => "atom_custody_unavailable",
            Self::CustodyMismatch => "atom_custody_mismatch",
            Self::CustodyOutcomeUnknown => "atom_custody_outcome_unknown",
            Self::AuthenticationRequired => "atom_authentication_required",
            Self::Forbidden => "atom_forbidden",
            Self::RateLimited => "atom_rate_limited",
            Self::Unavailable => "atom_unavailable",
            Self::ProtocolRejected => "atom_protocol_rejected",
        })
    }
}
impl std::error::Error for AtomError {}

pub type AtomGuard<'a> = dyn FnMut() -> Result<(), AtomError> + Send + 'a;

pub struct AtomCredential {
    user_id: Zeroizing<String>,
    token: Zeroizing<String>,
}

impl fmt::Debug for AtomCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AtomCredential([REDACTED])")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct AtomListing {
    pub domain: String,
    pub resource_digest: [u8; 32],
    pub state: AtomListingState,
}

/// Seller labels do not establish verified ownership or whether a domain is currently purchasable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AtomListingState {
    SellerApproved,
    TransferComplete,
    Unclassified,
}

pub struct AtomPortfolioClient {
    client: Client,
}

impl AtomPortfolioClient {
    /// Builds a client for the fixed official seller endpoint.
    ///
    /// # Errors
    /// Returns a closed error when the TLS client cannot be initialized.
    pub fn production() -> Result<Self, AtomError> {
        Client::builder()
            .https_only(true)
            .http1_only()
            .connection_verbose(false)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("GoodDealer/0.0.0 (Atom Seller client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| AtomError::Unavailable)
    }

    /// Reads a bounded account portfolio without exposing raw seller data.
    ///
    /// # Errors
    /// Rejects stale authority, failed authentication, a nonterminal scan or invalid data.
    pub async fn scan(
        &self,
        credential: &AtomCredential,
        guard: &mut AtomGuard<'_>,
    ) -> Result<Vec<AtomListing>, AtomError> {
        let mut scan = portfolio_wire::PortfolioScan::default();
        for page in 1..=MAX_PAGES {
            guard()?;
            // Never log or forward a reqwest Request, Response or Error here. Even their
            // Debug representations can contain the credentials used by this official API.
            let response = self.client.execute(self.request(credential, page)?).await;
            guard()?;
            let response = response.map_err(|_| AtomError::Unavailable)?;
            let (json, body) = read_page(response, guard).await?;
            let complete = scan.accept(require_inventory_json(json, &body)?)?;
            guard()?;
            if complete {
                return Ok(scan.into_listings());
            }
        }
        Err(AtomError::ProtocolRejected)
    }

    fn request(&self, credential: &AtomCredential, page: usize) -> Result<Request, AtomError> {
        let mut url = reqwest::Url::parse(DOMAINS).map_err(|_| AtomError::Unavailable)?;
        url.query_pairs_mut()
            .append_pair("api_token", &credential.token)
            .append_pair("user_id", &credential.user_id)
            .append_pair("page", &page.to_string())
            .append_pair("limit", &PAGE_SIZE.to_string());
        self.client
            .get(url)
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .build()
            .map_err(|_| AtomError::InputRejected)
    }
}

fn require_inventory_json(json: bool, body: &[u8]) -> Result<&[u8], AtomError> {
    if body == MISSING_CREDENTIALS {
        return Err(AtomError::AuthenticationRequired);
    }
    if !json {
        return Err(AtomError::ProtocolRejected);
    }
    Ok(body)
}

async fn read_page(
    response: reqwest::Response,
    guard: &mut AtomGuard<'_>,
) -> Result<(bool, Zeroizing<Vec<u8>>), AtomError> {
    let invalid = AtomError::ProtocolRejected;
    match response.status() {
        StatusCode::OK => {}
        StatusCode::UNAUTHORIZED => return Err(AtomError::AuthenticationRequired),
        StatusCode::FORBIDDEN => return Err(AtomError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => return Err(AtomError::RateLimited),
        status if status.is_server_error() => return Err(AtomError::Unavailable),
        _ => return Err(invalid),
    }
    let mut types = response.headers().get_all(header::CONTENT_TYPE).iter();
    let content_type = types
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(invalid)?;
    let mut parts = content_type.split(';').map(str::trim);
    let media_type = parts.next().ok_or(invalid)?;
    let json = media_type.eq_ignore_ascii_case("application/json");
    if (!json && !media_type.eq_ignore_ascii_case("text/html"))
        || parts
            .next()
            .is_some_and(|value| !value.eq_ignore_ascii_case("charset=utf-8"))
        || parts.next().is_some()
        || types.next().is_some()
    {
        return Err(invalid);
    }
    // Atom's live anonymous response is HTTP 200 with text/html. Only the observed
    // closed authentication failure is recognized for that type, never a portfolio.
    let limit = if json {
        MAX_BODY
    } else {
        MISSING_CREDENTIALS.len()
    };
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err(invalid);
    }
    let mut body = Zeroizing::new(Vec::new());
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        guard()?;
        let chunk = chunk.map_err(|_| AtomError::Unavailable)?;
        if chunk.len() > limit - body.len() {
            return Err(invalid);
        }
        body.extend_from_slice(&chunk);
    }
    Ok((json, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_percent_encoded_and_endpoint_has_no_caller_selected_segments() {
        let credential = AtomCredential {
            user_id: Zeroizing::new("123".into()),
            token: Zeroizing::new("synthetic&user_id=99+%#".into()),
        };
        let request = AtomPortfolioClient::production()
            .unwrap()
            .request(&credential, 2)
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(request.url().host_str(), Some("www.atom.com"));
        assert_eq!(request.url().path(), "/api/marketplace/domains");
        assert_eq!(
            request.url().query_pairs().collect::<Vec<_>>(),
            [
                ("api_token".into(), credential.token.as_str().into()),
                ("user_id".into(), "123".into()),
                ("page".into(), "2".into()),
                ("limit".into(), "100".into()),
            ]
        );
        assert_eq!(request.headers()[header::CACHE_CONTROL], "no-store");
        assert!(!format!("{credential:?}").contains("synthetic"));
    }

    #[test]
    fn observed_html_auth_failure_cannot_pass_as_empty_inventory() {
        assert_eq!(
            require_inventory_json(false, MISSING_CREDENTIALS),
            Err(AtomError::AuthenticationRequired)
        );
        assert_eq!(
            require_inventory_json(false, b"[]"),
            Err(AtomError::ProtocolRejected)
        );
        assert_eq!(require_inventory_json(true, b"[]"), Ok(b"[]".as_slice()));
    }
}
