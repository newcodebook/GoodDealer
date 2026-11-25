//! Official Porkbun API v3 account inventory. API keys and response bodies stay in Native.
//!
//! Facts: `docs/PROVIDER_API_REVIEW.md`, Porkbun `OpenAPI` v3.112 read on 2026-11-24. Only the
//! read-only `/domain/listAll`, `/domain/getNs` and `/dns/retrieve` endpoints are constructed here;
//! write and money endpoints are never reachable.

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

#[path = "porkbun/dns_wire.rs"]
mod dns_wire;

#[path = "porkbun/delegation_wire.rs"]
mod delegation_wire;

const ORIGIN: &str = "https://api.porkbun.com";
const LIST_PATH: &str = "/api/json/v3/domain/listAll";
const DNS_RETRIEVE_PATH: &str = "/api/json/v3/dns/retrieve";
const GET_NS_PATH: &str = "/api/json/v3/domain/getNs";
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

/// The record types the official `/dns/create` request enumerates (v3.112). The retrieve schema
/// names no enum, so any other type fails the read closed until a qualified zone shows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(clippy::upper_case_acronyms)]
pub enum PorkbunDnsRecordType {
    A,
    AAAA,
    MX,
    CNAME,
    ALIAS,
    TXT,
    NS,
    SRV,
    TLSA,
    CAA,
    SSHFP,
    HTTPS,
    SVCB,
    DS,
    SMIMEA,
    OPENPGPKEY,
}

impl PorkbunDnsRecordType {
    const ALL: [Self; 16] = [
        Self::A,
        Self::AAAA,
        Self::MX,
        Self::CNAME,
        Self::ALIAS,
        Self::TXT,
        Self::NS,
        Self::SRV,
        Self::TLSA,
        Self::CAA,
        Self::SSHFP,
        Self::HTTPS,
        Self::SVCB,
        Self::DS,
        Self::SMIMEA,
        Self::OPENPGPKEY,
    ];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::AAAA => "AAAA",
            Self::MX => "MX",
            Self::CNAME => "CNAME",
            Self::ALIAS => "ALIAS",
            Self::TXT => "TXT",
            Self::NS => "NS",
            Self::SRV => "SRV",
            Self::TLSA => "TLSA",
            Self::CAA => "CAA",
            Self::SSHFP => "SSHFP",
            Self::HTTPS => "HTTPS",
            Self::SVCB => "SVCB",
            Self::DS => "DS",
            Self::SMIMEA => "SMIMEA",
            Self::OPENPGPKEY => "OPENPGPKEY",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// One validated record. Values can hold verification tokens, so Debug is redacted.
#[derive(Clone, PartialEq, Eq)]
pub struct PorkbunDnsRecord {
    pub record_id: String,
    /// The documented fully-qualified `name`, lowercased and checked to sit inside the zone.
    pub owner_name_ascii: String,
    pub record_type: PorkbunDnsRecordType,
    pub content: String,
    pub ttl_seconds: u32,
    /// Documented for MX and SRV; other types may carry the create default `0` or none.
    pub priority: Option<u16>,
}

impl fmt::Debug for PorkbunDnsRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PorkbunDnsRecord([REDACTED])")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum PorkbunDnsZone {
    /// Every editable record. Porkbun excludes SOA and its default NS records from this read.
    Records {
        records: Vec<PorkbunDnsRecord>,
        /// `GoodDealer` inference from a `warnings` entry (documented for Cloudflare-moved domains):
        /// this stored zone may not be what resolves. `false` does not prove Porkbun answers, so
        /// a separate delegation check must precede any DNS health use.
        answered_elsewhere: bool,
    },
    /// `API_ACCESS_DISABLED`: only the account holder can opt the domain in.
    ApiAccessDisabled,
    /// `INVALID_DOMAIN` ("invalid or not in your account") / `DOMAIN_NOT_FOUND`. A key for the
    /// wrong account (or the sandbox) also lands here, so it never downgrades asset evidence.
    NotInAccount,
    /// `DOMAIN_NOT_ACTIVE`: pending or expired, not manageable right now.
    DomainNotActive,
}

/// One domain's registry delegation (`getNs`), or the documented reason it cannot be read.
#[derive(Debug, PartialEq, Eq)]
pub enum PorkbunDelegation {
    /// The registry's nameserver set, lowercased and sorted; empty when none is listed.
    Nameservers(Vec<String>),
    /// `API_ACCESS_DISABLED`: only the account holder can opt the domain in.
    ApiAccessDisabled,
    /// `INVALID_DOMAIN` / `DOMAIN_NOT_FOUND`; never a basis for downgrading asset evidence.
    NotInAccount,
    /// `DOMAIN_NOT_ACTIVE`: pending or expired, not manageable right now.
    DomainNotActive,
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

    /// Reads the nameservers the registry lists for one domain with the documented
    /// `GET /domain/getNs/{domain}`, which needs only the key's `read` permission.
    ///
    /// # Errors
    /// Rejects a non-canonical domain, stale authority, authentication or permission errors and
    /// malformed, duplicate or oversized nameserver sets.
    pub async fn observe_nameservers(
        &self,
        credential: &PorkbunCredential,
        domain: &str,
        guard: &mut PorkbunGuard<'_>,
    ) -> Result<PorkbunDelegation, PorkbunError> {
        let request = self.nameserver_request(credential, domain)?;
        guard()?;
        let response = self.client.execute(request).await;
        guard()?;
        let response = response.map_err(|_| PorkbunError::Unavailable)?;
        let status = response.status();
        // As for the DNS read, non-400 failures are classified before any body is read.
        if status != StatusCode::BAD_REQUEST {
            status_class(status)?;
        }
        let observed = delegation_wire::classify(status, &read_body(response, guard).await?);
        guard()?;
        observed
    }

    fn nameserver_request(
        &self,
        credential: &PorkbunCredential,
        domain: &str,
    ) -> Result<Request, PorkbunError> {
        let domain = dns_wire::canonical_zone(domain)
            .filter(|canonical| canonical == domain)
            .ok_or(PorkbunError::InputRejected)?;
        let mut url = reqwest::Url::parse(ORIGIN).map_err(|_| PorkbunError::Unavailable)?;
        url.set_path(&format!("{GET_NS_PATH}/{domain}"));
        let (key, secret) = credential_headers(credential)?;
        self.client
            .get(url)
            .header("x-api-key", key)
            .header("x-secret-api-key", secret)
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .build()
            .map_err(|_| PorkbunError::InputRejected)
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
        let (key, secret) = credential_headers(credential)?;
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

pub struct PorkbunDnsClient {
    client: Client,
}

impl PorkbunDnsClient {
    /// Builds the fixed direct HTTPS client for read-only zone records.
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
            .user_agent("GoodDealer/0.0.0 (Porkbun DNS client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| PorkbunError::Unavailable)
    }

    /// Reads one zone's editable records with the documented `GET /dns/retrieve/{domain}`, which
    /// needs only the key's `read` permission.
    ///
    /// # Errors
    /// Rejects a non-canonical zone, stale authority, authentication or permission errors,
    /// malformed or duplicate records, and zones above the local evidence bound.
    pub async fn observe(
        &self,
        credential: &PorkbunCredential,
        zone: &str,
        guard: &mut PorkbunGuard<'_>,
    ) -> Result<PorkbunDnsZone, PorkbunError> {
        let zone = dns_wire::canonical_zone(zone).ok_or(PorkbunError::InputRejected)?;
        guard()?;
        let response = self.client.execute(self.request(credential, &zone)?).await;
        guard()?;
        let response = response.map_err(|_| PorkbunError::Unavailable)?;
        let status = response.status();
        // Non-400 failures are classified before the body is read, so an HTML error page stays
        // a status error rather than a parse failure.
        if status != StatusCode::BAD_REQUEST {
            status_class(status)?;
        }
        let observed = dns_wire::classify(status, &zone, &read_body(response, guard).await?);
        guard()?;
        observed
    }

    fn request(&self, credential: &PorkbunCredential, zone: &str) -> Result<Request, PorkbunError> {
        let zone = dns_wire::canonical_zone(zone)
            .filter(|canonical| canonical == zone)
            .ok_or(PorkbunError::InputRejected)?;
        let mut url = reqwest::Url::parse(ORIGIN).map_err(|_| PorkbunError::Unavailable)?;
        url.set_path(&format!("{DNS_RETRIEVE_PATH}/{zone}"));
        let (key, secret) = credential_headers(credential)?;
        // GET with header credentials: the documented read form, with no body to carry secrets.
        self.client
            .get(url)
            .header("x-api-key", key)
            .header("x-secret-api-key", secret)
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .build()
            .map_err(|_| PorkbunError::InputRejected)
    }
}

fn credential_headers(
    credential: &PorkbunCredential,
) -> Result<(header::HeaderValue, header::HeaderValue), PorkbunError> {
    let mut key = header::HeaderValue::from_str(credential.key.as_str())
        .map_err(|_| PorkbunError::InputRejected)?;
    key.set_sensitive(true);
    let mut secret = header::HeaderValue::from_str(credential.secret.as_str())
        .map_err(|_| PorkbunError::InputRejected)?;
    secret.set_sensitive(true);
    Ok((key, secret))
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
    status_class(response.status())?;
    read_body(response, guard).await
}

/// Reads one bounded JSON body; the caller has already classified the status.
async fn read_body(
    response: reqwest::Response,
    guard: &mut PorkbunGuard<'_>,
) -> Result<Zeroizing<Vec<u8>>, PorkbunError> {
    let invalid = PorkbunError::ProtocolRejected;
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
    fn only_the_fixed_zone_get_carries_sensitive_key_headers() {
        let credential = PorkbunCredential {
            key: Zeroizing::new("pk1_synthetic".into()),
            secret: Zeroizing::new("sk1_synthetic".into()),
        };
        let client = PorkbunDnsClient::production().unwrap();
        let request = client.request(&credential, "example.com").unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().as_str(),
            "https://api.porkbun.com/api/json/v3/dns/retrieve/example.com"
        );
        assert!(request.body().is_none());
        assert!(request.headers()["x-api-key"].is_sensitive());
        assert!(request.headers()["x-secret-api-key"].is_sensitive());
        assert!(!format!("{request:?}").contains("sk1_synthetic"));
        for zone in ["Example.com", "example.com/../domain/listAll", "localhost"] {
            assert_eq!(
                client.request(&credential, zone).unwrap_err(),
                PorkbunError::InputRejected
            );
        }
    }

    #[test]
    fn only_the_fixed_nameserver_get_carries_sensitive_key_headers() {
        let credential = PorkbunCredential {
            key: Zeroizing::new("pk1_synthetic".into()),
            secret: Zeroizing::new("sk1_synthetic".into()),
        };
        let client = PorkbunRegistrarClient::production().unwrap();
        let request = client
            .nameserver_request(&credential, "example.com")
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().as_str(),
            "https://api.porkbun.com/api/json/v3/domain/getNs/example.com"
        );
        assert!(request.body().is_none());
        assert!(request.headers()["x-api-key"].is_sensitive());
        assert!(request.headers()["x-secret-api-key"].is_sensitive());
        assert!(!format!("{request:?}").contains("sk1_synthetic"));
        for domain in ["Example.com", "example.com/../updateNs/x", "localhost"] {
            assert_eq!(
                client.nameserver_request(&credential, domain).unwrap_err(),
                PorkbunError::InputRejected
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
