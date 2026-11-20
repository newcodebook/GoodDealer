//! Spaceship's official Domain Management API. Credentials, contact identities and raw
//! Provider responses are private to this Native service.

use futures_util::StreamExt;
use reqwest::{Client, Request, StatusCode, header};
use std::{fmt, time::Duration};
use zeroize::Zeroizing;

#[path = "spaceship/credentials.rs"]
mod credentials;
#[path = "spaceship/registrar_wire.rs"]
mod registrar_wire;
pub use credentials::{
    SpaceshipCapture, SpaceshipCredentialPlan, load_spaceship_credential_guarded,
    publish_spaceship_credential_guarded, purge_spaceship_credential_guarded,
};
use registrar_wire::InventoryScan;

const DOMAINS: &str = "https://spaceship.dev/api/v1/domains";
const PAGE_SIZE: usize = 100;
const MAX_REGISTRATIONS: usize = 10_000;
const MAX_BODY: usize = 512 * 1024;

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

pub struct SpaceshipRegistrarClient {
    client: Client,
}

impl SpaceshipRegistrarClient {
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
            .user_agent("GoodDealer/0.0.0 (Spaceship Registrar client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| SpaceshipError::Unavailable)
    }

    /// Returns an entire account scan. The official offset API offers no snapshot ID;
    /// reject changes that are observable through page counts, total or duplicate names.
    ///
    /// # Errors
    /// Refuses stale authority, access failures, incomplete scans and invalid responses.
    pub async fn scan(
        &self,
        credential: &SpaceshipCredential,
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<Vec<SpaceshipRegistration>, SpaceshipError> {
        let mut inventory = InventoryScan::default();
        loop {
            guard()?;
            let request = self.request(credential, inventory.offset())?;
            let response = self.client.execute(request).await;
            guard()?;
            let response = response.map_err(|_| SpaceshipError::Unavailable)?;
            let body = read_page(response, guard).await?;
            let complete = inventory.accept(&body)?;
            guard()?;
            if complete {
                return Ok(inventory.into_registrations());
            }
        }
    }

    fn request(
        &self,
        credential: &SpaceshipCredential,
        offset: usize,
    ) -> Result<Request, SpaceshipError> {
        self.client
            .get(format!(
                "{DOMAINS}?take={PAGE_SIZE}&skip={offset}&orderBy=name"
            ))
            .header("x-api-key", secret_header(&credential.key)?)
            .header("x-api-secret", secret_header(&credential.secret)?)
            .header(header::ACCEPT, "application/json")
            .build()
            .map_err(|_| SpaceshipError::Unavailable)
    }
}

fn secret_header(value: &str) -> Result<header::HeaderValue, SpaceshipError> {
    let mut header =
        header::HeaderValue::from_str(value).map_err(|_| SpaceshipError::AuthenticationRequired)?;
    header.set_sensitive(true);
    Ok(header)
}

async fn read_page(
    response: reqwest::Response,
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
            .is_some_and(|size| size > MAX_BODY as u64)
    {
        return Err(invalid);
    }
    let mut stream = response.bytes_stream();
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = stream.next().await {
        guard()?;
        let chunk = chunk.map_err(|_| SpaceshipError::Unavailable)?;
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
    fn domain_request_has_fixed_destination_and_sensitive_auth_headers() {
        let client = SpaceshipRegistrarClient::production().unwrap();
        let credential = SpaceshipCredential {
            key: Zeroizing::new("synthetic-key".to_owned()),
            secret: Zeroizing::new("synthetic-secret".to_owned()),
        };
        let request = client.request(&credential, 100).unwrap();
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
}
