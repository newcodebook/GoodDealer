//! Private GoodDealer-owned Cloudflare provider protocol.
//!
//! This module is the source of truth for the closed Zone/DNS endpoint set and Provider wire
//! definitions. It grants no generic HTTP, credential, environment, or raw error authority.

use std::{
    collections::HashSet,
    fmt,
    future::Future,
    net::{Ipv4Addr, Ipv6Addr},
    pin::Pin,
    time::Duration,
};

use futures_util::StreamExt;
use reqwest::{Client, StatusCode, header};
use serde::Deserialize;
use serde_json::Value;
use zeroize::Zeroizing;

use crate::{
    cloudflare_capture::CloudflareCandidate, cloudflare_keychain::CloudflareCredentialState,
};

const API_PREFIX: &str = "/client/v4";
const ORIGIN: &str = "https://api.cloudflare.com";
const MAX_RESPONSE_BYTES: usize = 16 * 1024;
const MAX_RECORDS: usize = 1024;
const MAX_PAGES_PER_TYPE: u16 = 9;
const MAX_REQUESTS: usize = 37;
const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 8192;

/// Closed v1 endpoint set for Zone details and DNS record listing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CloudflareEndpoint {
    ZoneDetails,
    ListDnsRecords {
        record_type: CloudflareRecordType,
        page: u16,
    },
}

impl CloudflareEndpoint {
    pub(super) fn path_and_query(self, zone_id: &str) -> String {
        match self {
            Self::ZoneDetails => format!("{API_PREFIX}/zones/{zone_id}"),
            Self::ListDnsRecords { record_type, page } => format!(
                "{API_PREFIX}/zones/{zone_id}/dns_records?type={}&page={page}&per_page=100&order=name&direction=asc",
                record_type.as_str()
            ),
        }
    }
}

/// A request emitted by the closed Cloudflare Provider client.
///
/// The method and endpoint are not caller supplied. The token is present only in the private
/// Authorization header and never in this type's formatting implementations.
pub(crate) struct CloudflareProviderRequest {
    origin: &'static str,
    method: CloudflareProviderMethod,
    path: String,
    query: String,
    accept: &'static str,
    authorization: Zeroizing<String>,
}

impl fmt::Debug for CloudflareProviderRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareProviderRequest")
            .field("origin", &self.origin)
            .field("method", &self.method)
            .field("path", &self.path)
            .field("query", &self.query)
            .field("accept", &self.accept)
            .field("authorization", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CloudflareProviderMethod {
    Get,
}

impl CloudflareProviderRequest {
    #[cfg(test)]
    #[must_use]
    pub(crate) const fn origin(&self) -> &'static str {
        self.origin
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) const fn method(&self) -> CloudflareProviderMethod {
        self.method
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn path(&self) -> &str {
        &self.path
    }

    /// Returns the bearer value for the transport implementation. Callers must not persist or
    /// format this value; the production transport consumes it immediately.
    pub(crate) fn authorization(&self) -> &str {
        &self.authorization
    }
}

pub(crate) struct CloudflareProviderResponse {
    pub(crate) status: u16,
    pub(crate) content_type: Option<String>,
    pub(crate) body: Vec<u8>,
}

pub(crate) trait CloudflareProviderTransport: Send {
    fn execute<'a>(
        &'a mut self,
        request: CloudflareProviderRequest,
        guard: &'a mut CloudflareProviderGuard<'a>,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<CloudflareProviderResponse, CloudflareProviderError>>
                + Send
                + 'a,
        >,
    >;
}

/// Closed, GET-only Cloudflare Zone/DNS client. It has no write or caller-selected URL surface.
///
/// Provider transport and wire types are deliberately not part of the crate's public API:
///
/// ```compile_fail
/// use gooddealer_secure_host_core::{
///     CloudflareProviderMethod, CloudflareProviderRequest, CloudflareProviderResponse,
///     CloudflareProviderTransport,
/// };
/// ```
pub struct CloudflareProviderClient {
    transport: Box<dyn CloudflareProviderTransport>,
}

/// Host authority/deadline check injected by the owning runtime.
///
/// The callback is deliberately synchronous and non-secret: it is evaluated immediately before
/// and after every provider await, so a revoked or expired Host cannot publish a late result.
pub type CloudflareProviderGuard<'a> =
    dyn FnMut() -> Result<(), CloudflareProviderError> + Send + 'a;

/// Borrowed Host-owned identity for one stored-credential observation.
pub trait CloudflareCredentialObservationPlan {
    fn connection_incarnation(&self) -> &str;
    fn connection_digest(&self) -> &str;
    fn generation(&self) -> u64;
    fn scope_digest(&self) -> &str;
    fn zone_digest(&self) -> &str;
    fn public_proof(&self) -> &str;
}

impl CloudflareProviderClient {
    #[must_use]
    pub fn production() -> Self {
        Self {
            transport: Box::new(CloudflareProductionTransport::new()),
        }
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_transport(transport: impl CloudflareProviderTransport + 'static) -> Self {
        Self {
            transport: Box::new(transport),
        }
    }

    /// Reads the selected Zone and all supported DNS records.
    ///
    /// # Errors
    ///
    /// Returns a closed classification when input, transport, status, size, pagination, JSON, or
    /// Provider field validation fails. Provider bodies and credentials are never attached.
    async fn observe(
        &mut self,
        zone_id: &str,
        token: &str,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<CloudflareProviderObservation, CloudflareProviderError> {
        guard()?;
        if !is_lower_hex_id(zone_id) || token.is_empty() || token.len() > 4096 {
            return Err(CloudflareProviderError::InvalidInput);
        }
        guard()?;
        let zone = self.request_zone(zone_id, token, guard).await?;
        guard()?;
        let mut records = Vec::new();
        let mut identities = HashSet::new();
        let mut requests = 1usize;
        for record_type in CloudflareRecordType::ALL {
            let mut page = 1u16;
            let mut expected_total = None;
            loop {
                if requests >= MAX_REQUESTS {
                    return Err(CloudflareProviderError::ResponseLimit);
                }
                guard()?;
                let envelope = self
                    .request_records(zone_id, token, record_type, page, guard)
                    .await?;
                guard()?;
                requests += 1;
                validate_page(&envelope, page, expected_total)?;
                expected_total = Some(envelope.result_info.total_count);
                for raw in envelope.result {
                    if records.len() >= MAX_RECORDS {
                        return Err(CloudflareProviderError::ResponseLimit);
                    }
                    let record = validate_record(raw, record_type, &zone.name)?;
                    if !identities.insert((record.id.clone(), record.record_type)) {
                        return Err(CloudflareProviderError::InvalidResponse);
                    }
                    records.push(record);
                }
                if page == envelope.result_info.total_pages {
                    break;
                }
                page = page
                    .checked_add(1)
                    .ok_or(CloudflareProviderError::ResponseLimit)?;
            }
        }
        records.sort_by(|a, b| {
            (a.name.as_bytes(), a.record_type, a.id.as_bytes()).cmp(&(
                b.name.as_bytes(),
                b.record_type,
                b.id.as_bytes(),
            ))
        });
        Ok(CloudflareProviderObservation { zone, records })
    }

    /// Observes a candidate while checking the Host authority/deadline around every await.
    ///
    /// # Errors
    ///
    /// Returns a closed classification when Host authority, transport, pagination, or Provider
    /// validation fails. Provider bodies and credentials are never attached.
    pub async fn observe_candidate_guarded(
        &mut self,
        candidate: &CloudflareCandidate,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<CloudflareProviderObservation, CloudflareProviderError> {
        self.observe(candidate.zone_id(), candidate.token(), guard)
            .await
    }

    /// Loads and observes a credential with an injected Host authority/deadline guard.
    ///
    /// # Errors
    ///
    /// Returns a closed classification when Host authority, credential custody, transport,
    /// pagination, or Provider validation fails.
    pub async fn observe_stored_credential_guarded<Plan>(
        &mut self,
        plan: &Plan,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<CloudflareProviderObservation, CloudflareProviderError>
    where
        Plan: CloudflareCredentialObservationPlan + ?Sized,
    {
        guard()?;
        let credential = crate::cloudflare_keychain::load(plan.connection_digest())
            .map_err(|_| CloudflareProviderError::InvalidInput)?
            .ok_or(CloudflareProviderError::InvalidInput)?;
        if credential.state() != CloudflareCredentialState::Active
            || credential.connection_incarnation() != plan.connection_incarnation()
            || credential.connection_digest() != plan.connection_digest()
            || credential.generation() != plan.generation()
            || credential.scope_digest() != plan.scope_digest()
            || credential.zone_digest() != plan.zone_digest()
            || credential.public_proof() != plan.public_proof()
        {
            return Err(CloudflareProviderError::InvalidInput);
        }
        let zone_id = credential.zone_id();
        let token = credential
            .token()
            .ok_or(CloudflareProviderError::InvalidInput)?;
        guard()?;
        self.observe(zone_id, token, guard).await
    }

    async fn request_zone(
        &mut self,
        zone_id: &str,
        token: &str,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<CloudflareProviderZone, CloudflareProviderError> {
        guard()?;
        let body = self
            .request(CloudflareEndpoint::ZoneDetails, zone_id, token, guard)
            .await?;
        guard()?;
        let envelope: ZoneEnvelope = parse_bounded_json(&body)?;
        if !envelope.success
            || !envelope.errors.is_empty()
            || !envelope.messages.is_empty()
            || envelope.result.id != zone_id
        {
            return Err(CloudflareProviderError::InvalidResponse);
        }
        if envelope.result.name.is_empty()
            || envelope.result.name.len() > 253
            || envelope.result.name.ends_with('.')
            || envelope.result.name.bytes().any(|b| b.is_ascii_uppercase())
        {
            return Err(CloudflareProviderError::InvalidResponse);
        }
        let status = match envelope.result.status.as_str() {
            "active" => CloudflareProviderZoneStatus::Active,
            "pending" => CloudflareProviderZoneStatus::Pending,
            _ => return Err(CloudflareProviderError::InvalidResponse),
        };
        let mut authoritative_nameservers = envelope.result.name_servers.unwrap_or_default();
        if authoritative_nameservers.len() > 32
            || authoritative_nameservers
                .iter()
                .any(|value| normalize_fqdn(value).as_deref() != Some(value.as_str()))
        {
            return Err(CloudflareProviderError::InvalidResponse);
        }
        authoritative_nameservers.sort();
        authoritative_nameservers.dedup();
        Ok(CloudflareProviderZone {
            id: envelope.result.id,
            name: envelope.result.name,
            status,
            authoritative_nameservers,
        })
    }

    async fn request_records(
        &mut self,
        zone_id: &str,
        token: &str,
        record_type: CloudflareRecordType,
        page: u16,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<RecordsEnvelope, CloudflareProviderError> {
        guard()?;
        let body = self
            .request(
                CloudflareEndpoint::ListDnsRecords { record_type, page },
                zone_id,
                token,
                guard,
            )
            .await?;
        guard()?;
        parse_bounded_json(&body)
    }

    async fn request(
        &mut self,
        endpoint: CloudflareEndpoint,
        zone_id: &str,
        token: &str,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<Vec<u8>, CloudflareProviderError> {
        guard()?;
        let path_and_query = endpoint.path_and_query(zone_id);
        let (path, query) = path_and_query
            .split_once('?')
            .map_or((path_and_query.as_str(), ""), |(p, q)| (p, q));
        let response = self
            .transport
            .execute(
                CloudflareProviderRequest {
                    origin: ORIGIN,
                    method: CloudflareProviderMethod::Get,
                    path: path.to_owned(),
                    query: query.to_owned(),
                    accept: "application/json",
                    authorization: Zeroizing::new(format!("Bearer {token}")),
                },
                guard,
            )
            .await?;
        guard()?;
        if response.body.len() > MAX_RESPONSE_BYTES {
            return Err(CloudflareProviderError::ResponseLimit);
        }
        match StatusCode::from_u16(response.status) {
            Ok(StatusCode::OK)
                if response
                    .content_type
                    .as_deref()
                    .is_some_and(is_json_content_type) =>
            {
                Ok(response.body)
            }
            Ok(StatusCode::OK) => Err(CloudflareProviderError::Deterministic),
            Ok(
                StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_EARLY | StatusCode::TOO_MANY_REQUESTS,
            ) => Err(CloudflareProviderError::Retryable),
            Ok(status) if status.is_server_error() => Err(CloudflareProviderError::Retryable),
            Ok(_) => Err(CloudflareProviderError::Deterministic),
            Err(_) => Err(CloudflareProviderError::InvalidResponse),
        }
    }
}

/// DNS record kinds supported by the fixed Provider reader.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CloudflareRecordType {
    A,
    AAAA,
    CNAME,
    TXT,
}

impl CloudflareRecordType {
    const ALL: [Self; 4] = [Self::A, Self::AAAA, Self::CNAME, Self::TXT];

    const fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::AAAA => "AAAA",
            Self::CNAME => "CNAME",
            Self::TXT => "TXT",
        }
    }
}

impl fmt::Debug for CloudflareRecordType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudflareProviderZoneStatus {
    Active,
    Pending,
}

#[derive(Clone, PartialEq, Eq)]
pub struct CloudflareProviderZone {
    pub id: String,
    pub name: String,
    pub status: CloudflareProviderZoneStatus,
    pub authoritative_nameservers: Vec<String>,
}

impl fmt::Debug for CloudflareProviderZone {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareProviderZone([REDACTED])")
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct CloudflareProviderRecord {
    pub id: String,
    pub name: String,
    pub record_type: CloudflareRecordType,
    pub content: String,
    pub ttl: u32,
    pub proxied: bool,
    pub modified_on: String,
}

impl fmt::Debug for CloudflareProviderRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareProviderRecord([REDACTED])")
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct CloudflareProviderObservation {
    pub zone: CloudflareProviderZone,
    pub records: Vec<CloudflareProviderRecord>,
}

impl fmt::Debug for CloudflareProviderObservation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareProviderObservation([REDACTED])")
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CloudflareProviderError {
    AuthorityStale,
    InvalidInput,
    InvalidResponse,
    ResponseLimit,
    Retryable,
    Deterministic,
    Transport,
}

impl fmt::Debug for CloudflareProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityStale => "AuthorityStale",
            Self::InvalidInput => "InvalidInput",
            Self::InvalidResponse => "InvalidResponse",
            Self::ResponseLimit => "ResponseLimit",
            Self::Retryable => "Retryable",
            Self::Deterministic => "Deterministic",
            Self::Transport => "Transport",
        })
    }
}
impl fmt::Display for CloudflareProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("cloudflare provider request failed")
    }
}
impl std::error::Error for CloudflareProviderError {}

impl CloudflareProviderError {
    #[must_use]
    pub const fn is_retryable(self) -> bool {
        matches!(self, Self::Retryable | Self::Transport)
    }
}

struct CloudflareProductionTransport {
    client: Option<Client>,
}
impl CloudflareProductionTransport {
    fn new() -> Self {
        Self {
            client: Client::builder()
                .https_only(true)
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(15))
                .build()
                .ok(),
        }
    }
}

fn validate_page(
    envelope: &RecordsEnvelope,
    page: u16,
    expected_total: Option<usize>,
) -> Result<(), CloudflareProviderError> {
    let info = &envelope.result_info;
    if !envelope.success
        || !envelope.errors.is_empty()
        || !envelope.messages.is_empty()
        || info.page != page
        || info.per_page != 100
        || info.count != envelope.result.len()
        || info.count > 100
        || info.total_count > MAX_RECORDS
        || info.total_pages == 0
        || info.total_pages > MAX_PAGES_PER_TYPE
        || page > info.total_pages
        || expected_total.is_some_and(|total| total != info.total_count)
        || (page < info.total_pages && info.count != 100)
        || (page == info.total_pages
            && info.total_count != (usize::from(page - 1) * 100 + info.count))
    {
        return Err(CloudflareProviderError::InvalidResponse);
    }
    Ok(())
}

fn validate_record(
    raw: RawRecord,
    expected_type: CloudflareRecordType,
    zone_name: &str,
) -> Result<CloudflareProviderRecord, CloudflareProviderError> {
    if !is_lower_hex_id(&raw.id)
        || raw.record_type != expected_type.as_str()
        || raw.ttl == 0
        || raw.ttl > 2_147_483_647
        || raw.content.len() > 4096
        || raw.name.is_empty()
        || raw.name.len() > 253
        || raw.name.ends_with('.')
        || raw.name.bytes().any(|b| b.is_ascii_uppercase())
    {
        return Err(CloudflareProviderError::InvalidResponse);
    }
    if raw.name != zone_name
        && !raw
            .name
            .strip_suffix(zone_name)
            .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1)
    {
        return Err(CloudflareProviderError::InvalidResponse);
    }
    let content = match expected_type {
        CloudflareRecordType::A => raw
            .content
            .parse::<Ipv4Addr>()
            .ok()
            .filter(|v| v.to_string() == raw.content)
            .map(|_| raw.content.clone()),
        CloudflareRecordType::AAAA => raw
            .content
            .parse::<Ipv6Addr>()
            .ok()
            .filter(|v| v.to_string() == raw.content)
            .map(|_| raw.content.clone()),
        CloudflareRecordType::CNAME => normalize_fqdn(&raw.content),
        CloudflareRecordType::TXT => {
            (!raw.content.chars().any(is_control_or_format)).then(|| raw.content.clone())
        }
    };
    if content.is_none() || (expected_type == CloudflareRecordType::TXT && raw.proxied) {
        return Err(CloudflareProviderError::InvalidResponse);
    }
    let modified_on =
        canonicalize_timestamp(&raw.modified_on).ok_or(CloudflareProviderError::InvalidResponse)?;
    Ok(CloudflareProviderRecord {
        id: raw.id,
        name: raw.name,
        record_type: expected_type,
        content: content.unwrap_or_default(),
        ttl: raw.ttl,
        proxied: raw.proxied,
        modified_on,
    })
}

fn parse_bounded_json<T: for<'de> Deserialize<'de>>(
    body: &[u8],
) -> Result<T, CloudflareProviderError> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| CloudflareProviderError::InvalidResponse)?;
    let mut stack = vec![(&value, 1usize)];
    let mut nodes = 0usize;
    while let Some((node, depth)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH {
            return Err(CloudflareProviderError::ResponseLimit);
        }
        match node {
            Value::Array(values) => stack.extend(values.iter().map(|v| (v, depth + 1))),
            Value::Object(values) => stack.extend(values.values().map(|v| (v, depth + 1))),
            _ => {}
        }
    }
    serde_json::from_value(value).map_err(|_| CloudflareProviderError::InvalidResponse)
}

fn is_lower_hex_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn normalize_fqdn(value: &str) -> Option<String> {
    if value.is_empty()
        || value.len() > 253
        || value.ends_with('.')
        || !value.contains('.')
        || value.bytes().any(|byte| byte.is_ascii_uppercase())
    {
        return None;
    }
    value
        .split('.')
        .all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        .then(|| value.to_owned())
}

fn is_control_or_format(character: char) -> bool {
    character.is_control()
        || matches!(character as u32, 0x00AD | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2 | 0x180E | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F | 0xFEFF | 0xFFF9..=0xFFFB | 0x110BD | 0x110CD | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}

fn is_json_content_type(value: &str) -> bool {
    let mut parts = value.split(';').map(str::trim);
    if !parts
        .next()
        .is_some_and(|media_type| media_type.eq_ignore_ascii_case("application/json"))
    {
        return false;
    }
    match (parts.next(), parts.next()) {
        (None, None) => true,
        (Some(parameter), None) => parameter.eq_ignore_ascii_case("charset=utf-8"),
        _ => false,
    }
}

fn canonicalize_timestamp(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes.last() != Some(&b'Z') {
        return None;
    }
    let shape = bytes.get(4) == Some(&b'-')
        && bytes.get(7) == Some(&b'-')
        && bytes.get(10) == Some(&b'T')
        && bytes.get(13) == Some(&b':')
        && bytes.get(16) == Some(&b':')
        && bytes[..4]
            .iter()
            .chain(&bytes[5..7])
            .chain(&bytes[8..10])
            .chain(&bytes[11..13])
            .chain(&bytes[14..16])
            .chain(&bytes[17..19])
            .all(u8::is_ascii_digit)
        && (bytes.len() == 20
            || (bytes[19] == b'.'
                && (1..=9).contains(&(bytes.len() - 21))
                && bytes[20..bytes.len() - 1].iter().all(u8::is_ascii_digit)
                && bytes.len() > 21));
    if !shape {
        return None;
    }
    let parse = |range: std::ops::Range<usize>| {
        std::str::from_utf8(&bytes[range]).ok()?.parse::<u32>().ok()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        parse(0..4),
        parse(5..7),
        parse(8..10),
        parse(11..13),
        parse(14..16),
        parse(17..19),
    ) else {
        return None;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=max_day).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let milliseconds = if bytes.len() == 20 {
        "000".to_owned()
    } else {
        let fraction = &value[20..value.len() - 1];
        format!("{fraction:0<3}").chars().take(3).collect()
    };
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milliseconds}Z"
    ))
}
impl CloudflareProviderTransport for CloudflareProductionTransport {
    fn execute<'a>(
        &'a mut self,
        request: CloudflareProviderRequest,
        guard: &'a mut CloudflareProviderGuard<'a>,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<CloudflareProviderResponse, CloudflareProviderError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            guard()?;
            let client = self
                .client
                .as_ref()
                .ok_or(CloudflareProviderError::Transport)?;
            let url = if request.query.is_empty() {
                format!("{}{}", request.origin, request.path)
            } else {
                format!("{}{}?{}", request.origin, request.path, request.query)
            };
            let mut auth = header::HeaderValue::from_str(request.authorization())
                .map_err(|_| CloudflareProviderError::Transport)?;
            auth.set_sensitive(true);
            let response = client
                .get(url)
                .header(header::AUTHORIZATION, auth)
                .header(header::ACCEPT, request.accept)
                .send()
                .await
                .map_err(|_| CloudflareProviderError::Transport)?;
            guard()?;
            let status = response.status().as_u16();
            let content_type = response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let mut body = Vec::new();
            let mut stream = response.bytes_stream();
            loop {
                guard()?;
                let next = stream.next().await;
                guard()?;
                let Some(chunk) = next else {
                    break;
                };
                let chunk = chunk.map_err(|_| CloudflareProviderError::Transport)?;
                if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                    return Err(CloudflareProviderError::ResponseLimit);
                }
                body.extend_from_slice(&chunk);
            }
            Ok(CloudflareProviderResponse {
                status,
                content_type,
                body,
            })
        })
    }
}

/// Strict `GoodDealer` projection of Cloudflare's success envelope.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ZoneEnvelope {
    pub(crate) success: bool,
    pub(crate) result: RawZone,
    #[serde(default)]
    pub(crate) errors: Vec<Value>,
    #[serde(default)]
    pub(crate) messages: Vec<Value>,
}

/// Zone fields used by v1 plus named Provider fields returned in the same object.
/// Non-domain fields are bounded by the caller and discarded without crossing the Host boundary.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RawZone {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) status: String,
    #[serde(default, rename = "account")]
    _account: Option<Value>,
    #[serde(default, rename = "activated_on")]
    _activated_on: Option<Value>,
    #[serde(default, rename = "betas")]
    _betas: Option<Value>,
    #[serde(default, rename = "cname_suffix")]
    _cname_suffix: Option<Value>,
    #[serde(default, rename = "created_on")]
    _created_on: Option<Value>,
    #[serde(default, rename = "deactivation_reason")]
    _deactivation_reason: Option<Value>,
    #[serde(default, rename = "development_mode")]
    _development_mode: Option<Value>,
    #[serde(default, rename = "host")]
    _host: Option<Value>,
    #[serde(default, rename = "meta")]
    _meta: Option<Value>,
    #[serde(default, rename = "modified_on")]
    _modified_on: Option<Value>,
    #[serde(default)]
    name_servers: Option<Vec<String>>,
    #[serde(default, rename = "original_dnshost")]
    _original_dnshost: Option<Value>,
    #[serde(default, rename = "original_name_servers")]
    _original_name_servers: Option<Value>,
    #[serde(default, rename = "original_registrar")]
    _original_registrar: Option<Value>,
    #[serde(default, rename = "owner")]
    _owner: Option<Value>,
    #[serde(default, rename = "paused")]
    _paused: Option<Value>,
    #[serde(default, rename = "permissions")]
    _permissions: Option<Value>,
    #[serde(default, rename = "plan")]
    _plan: Option<Value>,
    #[serde(default, rename = "plan_pending")]
    _plan_pending: Option<Value>,
    #[serde(default, rename = "tenant")]
    _tenant: Option<Value>,
    #[serde(default, rename = "tenant_unit")]
    _tenant_unit: Option<Value>,
    #[serde(default, rename = "type")]
    _zone_type: Option<Value>,
    #[serde(default, rename = "vanity_name_servers")]
    _vanity_name_servers: Option<Value>,
    #[serde(default, rename = "verification_key")]
    _verification_key: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecordsEnvelope {
    pub(crate) success: bool,
    pub(crate) result: Vec<RawRecord>,
    pub(crate) result_info: ResultInfo,
    #[serde(default)]
    pub(crate) errors: Vec<Value>,
    #[serde(default)]
    pub(crate) messages: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ResultInfo {
    pub(crate) page: u16,
    pub(crate) per_page: u16,
    pub(crate) count: usize,
    pub(crate) total_count: usize,
    pub(crate) total_pages: u16,
}

/// DNS record payloads do not carry a trusted Zone binding. `GoodDealer` binds each record to the
/// selected Zone through the fixed endpoint context and an apex-or-subdomain FQDN check.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RawRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) record_type: String,
    pub(crate) content: String,
    pub(crate) ttl: u32,
    pub(crate) proxied: bool,
    pub(crate) modified_on: String,
    #[serde(default, rename = "comment")]
    _comment: Option<Value>,
    #[serde(default, rename = "comment_modified_on")]
    _comment_modified_on: Option<Value>,
    #[serde(default, rename = "created_on")]
    _created_on: Option<Value>,
    #[serde(default, rename = "meta")]
    _meta: Option<Value>,
    #[serde(default, rename = "priority")]
    _priority: Option<Value>,
    #[serde(default, rename = "proxiable")]
    _proxiable: Option<Value>,
    #[serde(default, rename = "settings")]
    _settings: Option<Value>,
    #[serde(default, rename = "tags")]
    _tags: Option<Value>,
    #[serde(default, rename = "tags_modified_on")]
    _tags_modified_on: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::runtime::Builder;

    fn runtime() -> tokio::runtime::Runtime {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
    }

    #[test]
    fn endpoint_specs_match_cloudflare_v4_paths() {
        let zone_id = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            CloudflareEndpoint::ZoneDetails.path_and_query(zone_id),
            format!("/client/v4/zones/{zone_id}")
        );
        assert_eq!(
            CloudflareEndpoint::ListDnsRecords {
                record_type: CloudflareRecordType::TXT,
                page: 7,
            }
            .path_and_query(zone_id),
            format!(
                "/client/v4/zones/{zone_id}/dns_records?type=TXT&page=7&per_page=100&order=name&direction=asc"
            )
        );
    }

    struct ScriptTransport {
        responses: Vec<CloudflareProviderResponse>,
        requests: Arc<Mutex<Vec<CloudflareProviderRequest>>>,
    }

    impl CloudflareProviderTransport for ScriptTransport {
        fn execute<'a>(
            &'a mut self,
            request: CloudflareProviderRequest,
            _guard: &'a mut CloudflareProviderGuard<'a>,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<CloudflareProviderResponse, CloudflareProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            self.requests.lock().expect("lock").push(request);
            let response = self.responses.remove(0);
            Box::pin(async move { Ok(response) })
        }
    }

    fn zone_body() -> Vec<u8> {
        br#"{"success":true,"result":{"id":"0123456789abcdef0123456789abcdef","name":"example.com","status":"active"},"errors":[],"messages":[]}"#.to_vec()
    }

    fn records_body(record_type: &str, page: u16) -> Vec<u8> {
        format!(r#"{{"success":true,"result":[{{"id":"0123456789abcdef0123456789abcde{page}","name":"example.com","type":"{record_type}","content":"{}","ttl":120,"proxied":false,"modified_on":"2026-01-01T00:00:00Z"}}],"result_info":{{"page":{page},"per_page":100,"count":1,"total_count":1,"total_pages":1}},"errors":[],"messages":[]}}"#, match record_type { "A" => "192.0.2.1", "AAAA" => "2001:db8::1", "CNAME" => "target.example.com", _ => "txt" }).into_bytes()
    }

    fn records_page_body(record_type: &str, page: u16, total_pages: u16, count: usize) -> Vec<u8> {
        let content = match record_type {
            "A" => "192.0.2.1",
            "AAAA" => "2001:db8::1",
            "CNAME" => "target.example.com",
            _ => "txt",
        };
        let records = (0..count)
            .map(|index| {
                format!(
                    r#"{{"id":"{page:027x}{index:05x}","name":"example.com","type":"{record_type}","content":"{content}","ttl":120,"proxied":false,"modified_on":"2026-01-01T00:00:00Z"}}"#
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{"success":true,"result":[{records}],"result_info":{{"page":{page},"per_page":100,"count":{count},"total_count":{},"total_pages":{total_pages}}},"errors":[],"messages":[]}}"#,
            usize::from(total_pages.saturating_sub(1)) * 100 + count
        )
        .into_bytes()
    }

    #[test]
    fn client_is_closed_get_only_and_returns_complete_observation() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let responses = vec![
            CloudflareProviderResponse {
                status: 200,
                content_type: Some("application/json".to_owned()),
                body: zone_body(),
            },
            CloudflareProviderResponse {
                status: 200,
                content_type: Some("application/json; charset=utf-8".to_owned()),
                body: records_body("A", 1),
            },
            CloudflareProviderResponse {
                status: 200,
                content_type: Some("application/json".to_owned()),
                body: records_body("AAAA", 1),
            },
            CloudflareProviderResponse {
                status: 200,
                content_type: Some("application/json".to_owned()),
                body: records_body("CNAME", 1),
            },
            CloudflareProviderResponse {
                status: 200,
                content_type: Some("application/json".to_owned()),
                body: records_body("TXT", 1),
            },
        ];
        let transport = ScriptTransport {
            responses,
            requests: Arc::clone(&requests),
        };
        let mut client = CloudflareProviderClient::with_transport(transport);
        let mut guard = || Ok(());
        let observation = runtime()
            .block_on(client.observe(
                "0123456789abcdef0123456789abcdef",
                "super-secret-token",
                &mut guard,
            ))
            .expect("observation");
        assert_eq!(observation.records.len(), 4);
        let diagnostics = format!("{observation:?}");
        assert_eq!(diagnostics, "CloudflareProviderObservation([REDACTED])");
        assert!(!diagnostics.contains("example.com"));
        assert!(!diagnostics.contains("192.0.2.1"));
        let captured = requests.lock().expect("lock");
        assert_eq!(captured.len(), 5);
        assert!(
            captured
                .iter()
                .all(|request| request.method() == CloudflareProviderMethod::Get)
        );
        assert!(captured.iter().all(|request| request.origin() == ORIGIN));
        assert_eq!(
            captured[0].path(),
            "/client/v4/zones/0123456789abcdef0123456789abcdef"
        );
        assert!(format!("{:#?}", captured[0]).contains("REDACTED"));
        assert!(!format!("{:#?}", captured[0]).contains("super-secret-token"));
    }

    #[test]
    fn status_and_size_failures_are_closed_and_classified() {
        for status in [408, 425, 429, 500, 503] {
            let transport = ScriptTransport {
                responses: vec![CloudflareProviderResponse {
                    status,
                    content_type: None,
                    body: Vec::new(),
                }],
                requests: Arc::new(Mutex::new(Vec::new())),
            };
            let mut client = CloudflareProviderClient::with_transport(transport);
            let mut guard = || Ok(());
            let error = runtime()
                .block_on(client.observe("0123456789abcdef0123456789abcdef", "token", &mut guard))
                .expect_err("status should fail");
            assert_eq!(error, CloudflareProviderError::Retryable);
        }
        let transport = ScriptTransport {
            responses: vec![CloudflareProviderResponse {
                status: 200,
                content_type: Some("application/json".to_owned()),
                body: vec![0; MAX_RESPONSE_BYTES + 1],
            }],
            requests: Arc::new(Mutex::new(Vec::new())),
        };
        let mut client = CloudflareProviderClient::with_transport(transport);
        let mut guard = || Ok(());
        let error = runtime()
            .block_on(client.observe("0123456789abcdef0123456789abcdef", "token", &mut guard))
            .expect_err("oversized response should fail");
        assert_eq!(error, CloudflareProviderError::ResponseLimit);

        for content_type in [
            None,
            Some("text/json"),
            Some("application/json; charset=utf-16"),
            Some("application/json; charset=utf-8; q=1"),
        ] {
            let transport = ScriptTransport {
                responses: vec![CloudflareProviderResponse {
                    status: 200,
                    content_type: content_type.map(str::to_owned),
                    body: zone_body(),
                }],
                requests: Arc::new(Mutex::new(Vec::new())),
            };
            let mut client = CloudflareProviderClient::with_transport(transport);
            let mut guard = || Ok(());
            let error = runtime()
                .block_on(client.observe("0123456789abcdef0123456789abcdef", "token", &mut guard))
                .expect_err("wrong or missing content type should fail");
            assert_eq!(error, CloudflareProviderError::Deterministic);
        }
    }

    #[test]
    fn authority_guard_after_provider_await_stops_pagination_immediately() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let transport = ScriptTransport {
            responses: vec![
                CloudflareProviderResponse {
                    status: 200,
                    content_type: Some("application/json".to_owned()),
                    body: zone_body(),
                },
                CloudflareProviderResponse {
                    status: 200,
                    content_type: Some("application/json".to_owned()),
                    body: records_page_body("A", 1, 2, 100),
                },
            ],
            requests: Arc::clone(&requests),
        };
        let mut guard = || {
            if requests.lock().unwrap().len() >= 2 {
                Err(CloudflareProviderError::AuthorityStale)
            } else {
                Ok(())
            }
        };
        let mut client = CloudflareProviderClient::with_transport(transport);
        let error = runtime()
            .block_on(client.observe("0123456789abcdef0123456789abcdef", "token", &mut guard))
            .expect_err("stale authority after the record await must stop observation");
        assert_eq!(error, CloudflareProviderError::AuthorityStale);
        assert_eq!(requests.lock().unwrap().len(), 2);
    }
}
