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

#[path = "godaddy/dns_wire.rs"]
mod dns_wire;

const ORIGIN: &str = "https://api.godaddy.com";
const DOMAINS_PATH: &str = "/v3/domains/domain-names";
const PAGE_SIZE: usize = 100;
const MAX_DOMAINS: usize = 10_000;
const MAX_PAGES: usize = 1024;
const MAX_BODY: usize = 2 * 1024 * 1024;
const DNS_ZONES_PATH: &str = "/v3/domains/zones";
/// The documented `pageSize` maximum for `listDNSRecords`.
const DNS_PAGE_SIZE: usize = 100;
/// Matches the local evidence bound for one zone observation.
const MAX_DNS_RECORDS: usize = 1024;
const MAX_DNS_PAGES: u64 = MAX_DNS_RECORDS.div_ceil(DNS_PAGE_SIZE) as u64;

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

/// The record types documented by Domains v3.1.0 `DNS Record Type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(clippy::upper_case_acronyms)]
pub enum GoDaddyDnsRecordType {
    A,
    AAAA,
    CNAME,
    MX,
    TXT,
    NS,
    SRV,
    SOA,
    CAA,
}

impl GoDaddyDnsRecordType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::AAAA => "AAAA",
            Self::CNAME => "CNAME",
            Self::MX => "MX",
            Self::TXT => "TXT",
            Self::NS => "NS",
            Self::SRV => "SRV",
            Self::SOA => "SOA",
            Self::CAA => "CAA",
        }
    }
}

/// One validated zone record. Values can hold verification tokens, so Debug is redacted.
#[derive(Clone, PartialEq, Eq)]
pub struct GoDaddyDnsRecord {
    pub record_id: Option<String>,
    /// The provider's apex-relative `name` resolved against the zone (`@` is the apex).
    /// For SRV, whether `service`/`protocol` are already part of `name` is unverified; the
    /// evidence writer must not store SRV owners until a qualified account settles it.
    pub owner_name_ascii: String,
    pub record_type: GoDaddyDnsRecordType,
    pub data: String,
    pub ttl_seconds: u32,
    pub priority: Option<u16>,
    pub weight: Option<u16>,
    pub port: Option<u16>,
    pub service: Option<String>,
    pub protocol: Option<String>,
    pub flag: Option<u8>,
    pub tag: Option<String>,
}

impl fmt::Debug for GoDaddyDnsRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("GoDaddyDnsRecord([REDACTED])")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum GoDaddyDnsZone {
    Records(Vec<GoDaddyDnsRecord>),
    /// The documented generic 404 for the zone. Whether that means "DNS hosted elsewhere" is
    /// not stated, so callers record it as unavailable evidence rather than an empty zone.
    NotFound,
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
        self.client
            .get(url)
            .header(header::AUTHORIZATION, authorization(credential)?)
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .build()
            .map_err(|_| GoDaddyError::InputRejected)
    }
}

pub struct GoDaddyDnsClient {
    client: Client,
}

impl GoDaddyDnsClient {
    /// Builds the fixed direct HTTPS client for read-only zone records.
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
            .user_agent("GoodDealer/0.0.0 (GoDaddy DNS client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| GoDaddyError::Unavailable)
    }

    /// Reads every page of one zone's records with `listDNSRecords`.
    ///
    /// # Errors
    /// Rejects a non-canonical zone, stale authority, authentication or permission errors,
    /// malformed records, inconsistent totals or links, zones above the local evidence bound,
    /// and a 404 after the first page.
    pub async fn observe(
        &self,
        credential: &GoDaddyCredential,
        zone: &str,
        guard: &mut GoDaddyGuard<'_>,
    ) -> Result<GoDaddyDnsZone, GoDaddyError> {
        let zone = dns_wire::canonical_zone(zone).ok_or(GoDaddyError::InputRejected)?;
        let mut scan = dns_wire::ZoneScan::new(zone.clone());
        for page in 1..=MAX_DNS_PAGES {
            guard()?;
            let response = self
                .client
                .execute(self.request(credential, &zone, page)?)
                .await;
            guard()?;
            let response = response.map_err(|_| GoDaddyError::Unavailable)?;
            if response.status() == StatusCode::NOT_FOUND {
                return if page == 1 {
                    Ok(GoDaddyDnsZone::NotFound)
                } else {
                    Err(GoDaddyError::ProtocolRejected)
                };
            }
            let body = read_page(response, guard).await?;
            let more = scan.accept(&body)?;
            guard()?;
            if !more {
                return Ok(GoDaddyDnsZone::Records(scan.into_records()));
            }
        }
        Err(GoDaddyError::ProtocolRejected)
    }

    fn request(
        &self,
        credential: &GoDaddyCredential,
        zone: &str,
        page: u64,
    ) -> Result<Request, GoDaddyError> {
        let mut url = reqwest::Url::parse(ORIGIN).map_err(|_| GoDaddyError::Unavailable)?;
        url.set_path(&dns_records_path(zone)?);
        url.query_pairs_mut()
            .append_pair("page", &page.to_string())
            .append_pair("pageSize", &DNS_PAGE_SIZE.to_string())
            .append_pair("totalRequired", "true");
        self.client
            .get(url)
            .header(header::AUTHORIZATION, authorization(credential)?)
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .build()
            .map_err(|_| GoDaddyError::InputRejected)
    }
}

/// `{DNS_ZONES_PATH}/{zone}/dns-records` for a zone that is already a canonical A-label host.
fn dns_records_path(zone: &str) -> Result<String, GoDaddyError> {
    dns_wire::canonical_zone(zone)
        .filter(|canonical| canonical == zone)
        .map(|zone| format!("{DNS_ZONES_PATH}/{zone}/dns-records"))
        .ok_or(GoDaddyError::InputRejected)
}

fn authorization(credential: &GoDaddyCredential) -> Result<header::HeaderValue, GoDaddyError> {
    let access = Zeroizing::new(format!("Bearer {}", credential.0.as_str()));
    let mut authorization =
        header::HeaderValue::from_str(&access).map_err(|_| GoDaddyError::InputRejected)?;
    authorization.set_sensitive(true);
    Ok(authorization)
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

    #[test]
    fn only_the_fixed_zone_records_get_carries_the_pat() {
        let token = GoDaddyCredential(Zeroizing::new("synthetic-PAT".into()));
        let client = GoDaddyDnsClient::production().unwrap();
        let request = client.request(&token, "example.com", 3).unwrap();
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().as_str(),
            "https://api.godaddy.com/v3/domains/zones/example.com/dns-records?page=3&pageSize=100&totalRequired=true"
        );
        let authorization = &request.headers()[header::AUTHORIZATION];
        assert_eq!(authorization, "Bearer synthetic-PAT");
        assert!(authorization.is_sensitive());
        assert!(!format!("{token:?} {request:?}").contains("synthetic-PAT"));
        for zone in [
            "Example.com",
            "example.com/../../domain-names",
            "localhost",
            "",
        ] {
            assert_eq!(
                client.request(&token, zone, 1).unwrap_err(),
                GoDaddyError::InputRejected,
                "{zone}"
            );
        }
        assert_eq!(MAX_DNS_PAGES, 11);
    }
}
