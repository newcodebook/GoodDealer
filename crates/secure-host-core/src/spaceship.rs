//! Spaceship's official Registrar and `SellerHub` APIs. Credentials, contact identities
//! and raw Provider responses are private to this Native service.

use futures_util::StreamExt;
use reqwest::{Client, Request, StatusCode, header};
use std::{fmt, time::Duration};
use zeroize::Zeroizing;

#[path = "spaceship/credentials.rs"]
mod credentials;
#[path = "spaceship/registrar_wire.rs"]
mod registrar_wire;
#[path = "spaceship/sellerhub_wire.rs"]
mod sellerhub_wire;
pub use credentials::{
    SpaceshipCapture, SpaceshipCredentialPlan, load_spaceship_credential_guarded,
    publish_spaceship_credential_guarded, purge_spaceship_credential_guarded,
};
use registrar_wire::{InventoryScan, valid_hostname};
use sellerhub_wire::SellerHubScan;
pub use sellerhub_wire::{SpaceshipSellerHubListing, SpaceshipSellerHubStatus};

const DOMAINS: &str = "https://spaceship.dev/api/v1/domains";
const SELLERHUB_DOMAINS: &str = "https://spaceship.dev/api/v1/sellerhub/domains";
const PAGE_SIZE: usize = 100;
const MAX_REGISTRATIONS: usize = 10_000;
const MAX_REGISTRAR_BODY: usize = 512 * 1024;
const MAX_SELLERHUB_LISTING_BODY: usize = 96 * 1024;
// SellerHub permits 5,000-character descriptions on every row. Size the wire
// limit for a full page even when those characters are escaped in JSON.
const MAX_SELLERHUB_BODY: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpaceshipError {
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

impl fmt::Display for SpaceshipError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityStale => "spaceship_authority_stale",
            Self::InputRejected => "spaceship_input_rejected",
            Self::CaptureCancelled => "spaceship_capture_cancelled",
            Self::CustodyUnavailable => "spaceship_custody_unavailable",
            Self::CustodyMismatch => "spaceship_custody_mismatch",
            Self::CustodyOutcomeUnknown => "spaceship_custody_outcome_unknown",
            Self::AuthenticationRequired => "spaceship_authentication_required",
            Self::Forbidden => "spaceship_forbidden",
            Self::RateLimited => "spaceship_rate_limited",
            Self::Unavailable => "spaceship_unavailable",
            Self::ProtocolRejected => "spaceship_protocol_rejected",
        })
    }
}

impl std::error::Error for SpaceshipError {}

pub type SpaceshipGuard<'a> = dyn FnMut() -> Result<(), SpaceshipError> + Send + 'a;

pub struct SpaceshipCredential {
    key: Zeroizing<String>,
    secret: Zeroizing<String>,
}

impl fmt::Debug for SpaceshipCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SpaceshipCredential([REDACTED])")
    }
}

/// The allowlisted registration facts. Spaceship supplies no public account identifier in
/// this API; the calling Host must bind the scan to the exact admitted credential slot.
pub struct SpaceshipRegistration {
    pub domain: String,
    pub registered_on: String,
    pub expires_on: String,
    pub auto_renew: bool,
    pub transfer_locked: bool,
    pub standing: SpaceshipRegistrationStanding,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpaceshipRegistrationStanding {
    Active,
    Pending,
    Inactive,
}

pub struct SpaceshipClient {
    client: Client,
}

impl SpaceshipClient {
    /// Constructs a direct, fixed-origin HTTPS client.
    ///
    /// # Errors
    /// Returns `Unavailable` if Native TLS initialization fails.
    pub fn production() -> Result<Self, SpaceshipError> {
        Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("GoodDealer/0.0.0 (Spaceship client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| SpaceshipError::Unavailable)
    }

    /// Returns an entire account scan. The official offset API offers no snapshot ID;
    /// reject changes that are observable through page counts, total or duplicate names.
    ///
    /// # Errors
    /// Refuses stale authority, access failures, incomplete scans and invalid responses.
    pub async fn scan_registrations(
        &self,
        credential: &SpaceshipCredential,
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<Vec<SpaceshipRegistration>, SpaceshipError> {
        let mut inventory = InventoryScan::default();
        loop {
            guard()?;
            let request = self.registrar_request(credential, inventory.offset())?;
            let body = self.fetch_page(request, MAX_REGISTRAR_BODY, guard).await?;
            let complete = inventory.accept(&body)?;
            guard()?;
            if complete {
                return Ok(inventory.into_registrations());
            }
        }
    }

    /// Reads the unfiltered `SellerHub` listing collection with `sellerhub:read`.
    ///
    /// # Errors
    /// Refuses stale authority, access failures, incomplete scans and invalid responses.
    pub async fn scan_sellerhub_listings(
        &self,
        credential: &SpaceshipCredential,
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<Vec<SpaceshipSellerHubListing>, SpaceshipError> {
        let mut inventory = SellerHubScan::default();
        loop {
            guard()?;
            let request = self.sellerhub_request(credential, inventory.offset())?;
            let body = self.fetch_page(request, MAX_SELLERHUB_BODY, guard).await?;
            let complete = inventory.accept(&body)?;
            guard()?;
            if complete {
                return Ok(inventory.into_listings());
            }
        }
    }

    /// Reads a single canonical domain from the authenticated `SellerHub` account.
    ///
    /// # Errors
    /// Refuses stale authority, mismatched identity or an unconfirmed result. The
    /// documented generic HTTP 404 does not establish account-scoped absence.
    pub async fn observe_sellerhub_listing(
        &self,
        credential: &SpaceshipCredential,
        domain: &str,
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<SpaceshipSellerHubListing, SpaceshipError> {
        guard()?;
        let request = self.sellerhub_listing_request(credential, domain)?;
        let body = self
            .fetch_page(request, MAX_SELLERHUB_LISTING_BODY, guard)
            .await?;
        let listing = sellerhub_wire::parse_exact_listing(&body, domain)?;
        guard()?;
        Ok(listing)
    }

    /// Sends the amount specified by an already claimed BIN change exactly once.
    ///
    /// # Errors
    /// Refuses invalid input, stale authority, or an unconfirmed response. Success
    /// acknowledges the request only. An independent exact GET must establish the
    /// final state before the Host completes the attempt.
    pub async fn send_sellerhub_bin_price(
        &self,
        credential: &SpaceshipCredential,
        domain: &str,
        cents: u64,
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<(), SpaceshipError> {
        guard()?;
        let request = self.sellerhub_bin_request(credential, domain, cents)?;
        guard()?;
        let body = self
            .fetch_page(request, MAX_SELLERHUB_LISTING_BODY, guard)
            .await?;
        sellerhub_wire::parse_exact_listing(&body, domain)?;
        guard()?;
        Ok(())
    }

    fn registrar_request(
        &self,
        credential: &SpaceshipCredential,
        offset: usize,
    ) -> Result<Request, SpaceshipError> {
        self.get(
            credential,
            format!("{DOMAINS}?take={PAGE_SIZE}&skip={offset}&orderBy=name"),
        )
    }

    fn sellerhub_request(
        &self,
        credential: &SpaceshipCredential,
        offset: usize,
    ) -> Result<Request, SpaceshipError> {
        self.get(
            credential,
            format!("{SELLERHUB_DOMAINS}?take={PAGE_SIZE}&skip={offset}"),
        )
    }

    fn sellerhub_listing_request(
        &self,
        credential: &SpaceshipCredential,
        domain: &str,
    ) -> Result<Request, SpaceshipError> {
        let mut request = self.get(credential, sellerhub_listing_url(domain)?)?;
        request.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-cache"),
        );
        Ok(request)
    }

    fn sellerhub_bin_request(
        &self,
        credential: &SpaceshipCredential,
        domain: &str,
        cents: u64,
    ) -> Result<Request, SpaceshipError> {
        let url = sellerhub_listing_url(domain)?;
        let body = sellerhub_wire::encode_bin_price_update(cents)?;
        Self::keyed_request(
            credential,
            self.client
                .patch(url)
                .header(header::CONTENT_TYPE, "application/json")
                .body(body),
        )
    }

    fn get(
        &self,
        credential: &SpaceshipCredential,
        url: String,
    ) -> Result<Request, SpaceshipError> {
        Self::keyed_request(credential, self.client.get(url))
    }

    fn keyed_request(
        credential: &SpaceshipCredential,
        builder: reqwest::RequestBuilder,
    ) -> Result<Request, SpaceshipError> {
        builder
            .header("x-api-key", secret_header(&credential.key)?)
            .header("x-api-secret", secret_header(&credential.secret)?)
            .header(header::ACCEPT, "application/json")
            .build()
            .map_err(|_| SpaceshipError::Unavailable)
    }

    async fn fetch_page(
        &self,
        request: Request,
        max_body: usize,
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<Zeroizing<Vec<u8>>, SpaceshipError> {
        let response = self.client.execute(request).await;
        guard()?;
        let response = response.map_err(|_| SpaceshipError::Unavailable)?;
        read_page(response, max_body, guard).await
    }
}

fn sellerhub_listing_url(domain: &str) -> Result<String, SpaceshipError> {
    if !valid_hostname(domain) {
        return Err(SpaceshipError::InputRejected);
    }
    Ok(format!("{SELLERHUB_DOMAINS}/{domain}"))
}

fn secret_header(value: &str) -> Result<header::HeaderValue, SpaceshipError> {
    let mut header =
        header::HeaderValue::from_str(value).map_err(|_| SpaceshipError::AuthenticationRequired)?;
    header.set_sensitive(true);
    Ok(header)
}

async fn read_page(
    response: reqwest::Response,
    max_body: usize,
    guard: &mut SpaceshipGuard<'_>,
) -> Result<Zeroizing<Vec<u8>>, SpaceshipError> {
    let invalid = SpaceshipError::ProtocolRejected;
    match response.status() {
        StatusCode::OK => {}
        StatusCode::UNAUTHORIZED => return Err(SpaceshipError::AuthenticationRequired),
        StatusCode::FORBIDDEN => return Err(SpaceshipError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => return Err(SpaceshipError::RateLimited),
        status if status.is_server_error() => return Err(SpaceshipError::Unavailable),
        _ => return Err(invalid),
    }
    let mut content_types = response.headers().get_all(header::CONTENT_TYPE).iter();
    let content_type = content_types
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(invalid)?;
    let mut parts = content_type.split(';').map(str::trim);
    if !parts
        .next()
        .is_some_and(|v| v.eq_ignore_ascii_case("application/json"))
        || parts
            .next()
            .is_some_and(|v| !v.eq_ignore_ascii_case("charset=utf-8"))
        || parts.next().is_some()
        || content_types.next().is_some()
        || response
            .content_length()
            .is_some_and(|size| size > max_body as u64)
    {
        return Err(invalid);
    }
    let mut stream = response.bytes_stream();
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = stream.next().await {
        guard()?;
        let chunk = chunk.map_err(|_| SpaceshipError::Unavailable)?;
        if chunk.len() > max_body - body.len() {
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
    fn domain_request_has_fixed_destination_and_sensitive_auth_headers() {
        let client = SpaceshipClient::production().unwrap();
        let credential = SpaceshipCredential {
            key: Zeroizing::new("synthetic-key".to_owned()),
            secret: Zeroizing::new("synthetic-secret".to_owned()),
        };
        let request = client.registrar_request(&credential, 100).unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().as_str(),
            format!("{DOMAINS}?take=100&skip=100&orderBy=name")
        );
        assert_eq!(request.headers()["x-api-key"], "synthetic-key");
        assert_eq!(request.headers()["x-api-secret"], "synthetic-secret");
        assert!(request.headers()["x-api-key"].is_sensitive());
        assert!(request.headers()["x-api-secret"].is_sensitive());
        assert!(!format!("{request:?} {credential:?}").contains("synthetic"));
    }

    #[test]
    fn sellerhub_requests_use_the_fixed_unfiltered_collection() {
        let client = SpaceshipClient::production().unwrap();
        let credential = SpaceshipCredential {
            key: Zeroizing::new("synthetic-key".to_owned()),
            secret: Zeroizing::new("synthetic-secret".to_owned()),
        };
        let request = client.sellerhub_request(&credential, 200).unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().as_str(),
            "https://spaceship.dev/api/v1/sellerhub/domains?take=100&skip=200"
        );
        assert!(request.headers()["x-api-key"].is_sensitive());
        assert!(request.headers()["x-api-secret"].is_sensitive());
        assert!(!format!("{request:?} {credential:?}").contains("synthetic"));
    }

    #[test]
    fn sellerhub_exact_listing_path_rejects_noncanonical_domains() {
        let client = SpaceshipClient::production().unwrap();
        let credential = SpaceshipCredential {
            key: Zeroizing::new("synthetic-key".to_owned()),
            secret: Zeroizing::new("synthetic-secret".to_owned()),
        };
        let request = client
            .sellerhub_listing_request(&credential, "xn--bcher-kva.example")
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().as_str(),
            "https://spaceship.dev/api/v1/sellerhub/domains/xn--bcher-kva.example"
        );
        assert_eq!(request.headers()[header::CACHE_CONTROL], "no-cache");
        assert!(request.headers()["x-api-secret"].is_sensitive());
        for input in [
            "EXAMPLE.com",
            "example.com.",
            "example.com?skip=0",
            "example.com/another",
            "127.0.0.1",
        ] {
            assert_eq!(
                client
                    .sellerhub_listing_request(&credential, input)
                    .unwrap_err(),
                SpaceshipError::InputRejected
            );
        }
    }

    #[test]
    fn sellerhub_bin_patch_serializes_only_the_nonfunds_amount() {
        let client = SpaceshipClient::production().unwrap();
        let credential = SpaceshipCredential {
            key: Zeroizing::new("synthetic-key".to_owned()),
            secret: Zeroizing::new("synthetic-secret".to_owned()),
        };
        let request = client
            .sellerhub_bin_request(&credential, "example.com", 20_305)
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::PATCH);
        assert_eq!(
            request.url().as_str(),
            "https://spaceship.dev/api/v1/sellerhub/domains/example.com"
        );
        assert!(request.headers()["x-api-secret"].is_sensitive());
        assert_eq!(
            request.body().and_then(reqwest::Body::as_bytes),
            Some(br#"{"binPrice":{"amount":"203.05"}}"#.as_slice())
        );
        for cents in [0, 9_007_199_254_740_992, u64::MAX] {
            assert_eq!(
                client
                    .sellerhub_bin_request(&credential, "example.com", cents)
                    .unwrap_err(),
                SpaceshipError::InputRejected,
            );
        }
    }
}
