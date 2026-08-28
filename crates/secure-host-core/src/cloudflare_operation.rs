use std::{
    collections::HashSet,
    fmt,
    net::{Ipv4Addr, Ipv6Addr},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    backup_operation::SecureHost,
    cloudflare_provider::{CloudflareEndpoint, RawRecord, RecordsEnvelope, ZoneEnvelope},
    cloudflare_transport::map_status,
};

const MAX_INTENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_AGGREGATE_BYTES: usize = 8 * 1024 * 1024;
const MAX_RECORDS: usize = 1024;
const MAX_REQUESTS: usize = 13;
const MAX_PAGES_PER_RECORD_TYPE: u16 = 9;
const MAX_JSON_DEPTH: usize = 64;
const MAX_JSON_NODES: usize = 16_384;
const CONNECTORS_PROTOCOL_VERSION: u8 = 1;

/// Constant, non-diagnostic failure for invalid caller intent.
#[derive(PartialEq, Eq)]
pub struct CloudflareContractError;

impl fmt::Debug for CloudflareContractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareContractError::Validation")
    }
}

impl fmt::Display for CloudflareContractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("invalid cloudflare observation data")
    }
}

impl std::error::Error for CloudflareContractError {}

/// Validated, non-secret selection of a Host-owned Cloudflare connection and Zone.
///
/// ```compile_fail
/// use gooddealer_secure_host_core::CloudflareZoneReadIntent;
/// let _intent = CloudflareZoneReadIntent {
///     connection_id: "connection".to_owned(),
///     zone_id: "0123456789abcdef0123456789abcdef".to_owned(),
/// };
/// ```
///
/// ```compile_fail
/// use gooddealer_secure_host_core::CloudflareZoneReadIntent;
/// let intent = CloudflareZoneReadIntent::parse_json(
///     br#"{"connectionId":"connection","zoneId":"0123456789abcdef0123456789abcdef"}"#,
/// ).unwrap();
/// intent.write_dns_record();
/// ```
pub struct CloudflareZoneReadIntent {
    connection_id: String,
    zone_id: String,
}

impl CloudflareZoneReadIntent {
    /// Parses exact JSON containing only `connectionId` and `zoneId`.
    ///
    /// # Errors
    ///
    /// Returns a constant [`CloudflareContractError`] for malformed, unknown, secret-bearing, or
    /// out-of-bounds input.
    pub fn parse_json(input: &[u8]) -> Result<Self, CloudflareContractError> {
        if input.len() > MAX_INTENT_BYTES {
            return Err(CloudflareContractError);
        }
        let raw: RawIntent = serde_json::from_slice(input).map_err(|_| CloudflareContractError)?;
        if raw.connection_id.is_empty()
            || raw.connection_id.len() > 256
            || raw.connection_id.chars().any(is_control_or_format)
            || !is_lower_hex_id(&raw.zone_id)
        {
            return Err(CloudflareContractError);
        }
        Ok(Self {
            connection_id: raw.connection_id,
            zone_id: raw.zone_id,
        })
    }

    #[must_use]
    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }

    #[must_use]
    pub fn zone_id(&self) -> &str {
        &self.zone_id
    }
}

impl fmt::Debug for CloudflareZoneReadIntent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareZoneReadIntent([REDACTED])")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawIntent {
    connection_id: String,
    zone_id: String,
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CloudflareZoneStatus {
    Active,
    Pending,
}

impl fmt::Debug for CloudflareZoneStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Active => "Active",
            Self::Pending => "Pending",
        })
    }
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CloudflareRecordType {
    A,
    AAAA,
    CNAME,
    TXT,
}

impl CloudflareRecordType {
    pub(super) const ALL: [Self; 4] = [Self::A, Self::AAAA, Self::CNAME, Self::TXT];

    pub(super) const fn as_str(self) -> &'static str {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareZoneMetadata {
    zone_id: String,
    zone_name: String,
    status: CloudflareZoneStatus,
}

impl CloudflareZoneMetadata {
    #[must_use]
    pub fn zone_id(&self) -> &str {
        &self.zone_id
    }
    #[must_use]
    pub fn zone_name(&self) -> &str {
        &self.zone_name
    }
    #[must_use]
    pub const fn status(&self) -> CloudflareZoneStatus {
        self.status
    }
}

impl fmt::Debug for CloudflareZoneMetadata {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareZoneMetadata([REDACTED])")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareDnsRecord {
    record_id: String,
    fqdn: String,
    #[serde(rename = "type")]
    record_type: CloudflareRecordType,
    content: String,
    ttl: u32,
    proxied: bool,
    provider_version_token: String,
}

impl CloudflareDnsRecord {
    #[must_use]
    pub fn record_id(&self) -> &str {
        &self.record_id
    }
    #[must_use]
    pub fn fqdn(&self) -> &str {
        &self.fqdn
    }
    #[must_use]
    pub const fn record_type(&self) -> CloudflareRecordType {
        self.record_type
    }
    #[must_use]
    pub fn content(&self) -> &str {
        &self.content
    }
    #[must_use]
    pub const fn ttl(&self) -> u32 {
        self.ttl
    }
    #[must_use]
    pub const fn proxied(&self) -> bool {
        self.proxied
    }
    #[must_use]
    pub fn provider_version_token(&self) -> &str {
        &self.provider_version_token
    }
}

impl fmt::Debug for CloudflareDnsRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareDnsRecord([REDACTED])")
    }
}

struct AvailableObservation {
    zone: CloudflareZoneMetadata,
    records: Vec<CloudflareDnsRecord>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareUnavailableObservationCode {
    Authentication,
    Permission,
    RateLimited,
    TemporarilyUnavailable,
    InvalidObservation,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum CloudflareObservationResult {
    Available {
        zone: CloudflareZoneMetadata,
        records: Vec<CloudflareDnsRecord>,
    },
    Unavailable {
        #[serde(rename = "zoneId")]
        zone_id: String,
        code: CloudflareUnavailableObservationCode,
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: Option<u32>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareObservationSubmitRequest {
    schema_version: u8,
    provider_kind: &'static str,
    observation_capability: &'static str,
    observation_id: String,
    connection_id: String,
    observed_at: String,
    result: CloudflareObservationResult,
}

impl CloudflareObservationSubmitRequest {
    #[must_use]
    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }
    #[must_use]
    pub fn observation_id(&self) -> &str {
        &self.observation_id
    }
    #[must_use]
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
    #[must_use]
    pub const fn result(&self) -> &CloudflareObservationResult {
        &self.result
    }

    #[cfg(test)]
    fn zone(&self) -> &CloudflareZoneMetadata {
        match &self.result {
            CloudflareObservationResult::Available { zone, .. } => zone,
            CloudflareObservationResult::Unavailable { .. } => panic!("expected available result"),
        }
    }

    #[cfg(test)]
    fn records(&self) -> &[CloudflareDnsRecord] {
        match &self.result {
            CloudflareObservationResult::Available { records, .. } => records,
            CloudflareObservationResult::Unavailable { .. } => &[],
        }
    }

    #[cfg(test)]
    fn unavailable(&self) -> Option<(CloudflareUnavailableObservationCode, Option<u32>)> {
        match &self.result {
            CloudflareObservationResult::Available { .. } => None,
            CloudflareObservationResult::Unavailable {
                code,
                retry_after_seconds,
                ..
            } => Some((*code, *retry_after_seconds)),
        }
    }
}

impl fmt::Debug for CloudflareObservationSubmitRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareObservationSubmitRequest([REDACTED])")
    }
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudflareObservationErrorCode {
    Denied,
    Authentication,
    Permission,
    RateLimited,
    TemporarilyUnavailable,
    InvalidResponse,
    ResponseTooLarge,
}

impl fmt::Debug for CloudflareObservationErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.label())
    }
}

impl CloudflareObservationErrorCode {
    const fn label(self) -> &'static str {
        match self {
            Self::Denied => "denied",
            Self::Authentication => "authentication",
            Self::Permission => "permission",
            Self::RateLimited => "rate_limited",
            Self::TemporarilyUnavailable => "temporarily_unavailable",
            Self::InvalidResponse => "invalid_response",
            Self::ResponseTooLarge => "response_too_large",
        }
    }
}

#[derive(Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareObservationError {
    code: CloudflareObservationErrorCode,
    retry_after_seconds: Option<u32>,
}

impl CloudflareObservationError {
    pub(super) const fn new(
        code: CloudflareObservationErrorCode,
        retry_after_seconds: Option<u32>,
    ) -> Self {
        Self {
            code,
            retry_after_seconds,
        }
    }
    #[must_use]
    pub const fn code(&self) -> CloudflareObservationErrorCode {
        self.code
    }
    #[must_use]
    pub const fn retry_after_seconds(&self) -> Option<u32> {
        self.retry_after_seconds
    }
}

impl fmt::Debug for CloudflareObservationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareObservationError([REDACTED])")
    }
}

impl fmt::Display for CloudflareObservationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("cloudflare observation failed")
    }
}

impl std::error::Error for CloudflareObservationError {}

impl SecureHost {
    #[cfg(test)]
    fn apply_cloudflare_mutation_for_test(&mut self) {
        if let Some(mutation) = self.cloudflare_mutation.take() {
            self.cloudflare_credential.mutate_for_test(mutation);
        }
    }

    /// Reads one exactly bound Zone and its A/AAAA/CNAME/TXT records.
    ///
    /// # Errors
    ///
    /// Returns only a closed, redacted [`CloudflareObservationError`] for local policy denial or
    /// failure to create the envelope. Provider and transport outcomes become one of the five
    /// Protocol unavailable codes; malformed and oversized responses both become
    /// `invalid_observation`. No partial available observation is published.
    pub async fn observe_cloudflare_zone(
        &mut self,
        intent: CloudflareZoneReadIntent,
    ) -> Result<CloudflareObservationSubmitRequest, CloudflareObservationError> {
        let connection_id = intent.connection_id().to_owned();
        let zone_id = intent.zone_id().to_owned();
        let outcome = tokio::time::timeout(
            Duration::from_mins(1),
            self.observe_cloudflare_zone_inner(&intent),
        )
        .await;
        let result = match outcome {
            Ok(Ok(available)) => CloudflareObservationResult::Available {
                zone: available.zone,
                records: available.records,
            },
            Ok(Err(error)) if error.code() == CloudflareObservationErrorCode::Denied => {
                return Err(error);
            }
            Ok(Err(error)) => CloudflareObservationResult::Unavailable {
                zone_id,
                code: public_error_code(error.code()),
                retry_after_seconds: error.retry_after_seconds(),
            },
            Err(_) => CloudflareObservationResult::Unavailable {
                zone_id,
                code: CloudflareUnavailableObservationCode::TemporarilyUnavailable,
                retry_after_seconds: None,
            },
        };
        Ok(CloudflareObservationSubmitRequest {
            schema_version: CONNECTORS_PROTOCOL_VERSION,
            provider_kind: "cloudflare",
            observation_capability: "dns",
            observation_id: new_observation_id()?,
            connection_id,
            observed_at: current_timestamp()?,
            result,
        })
    }

    async fn observe_cloudflare_zone_inner(
        &mut self,
        intent: &CloudflareZoneReadIntent,
    ) -> Result<AvailableObservation, CloudflareObservationError> {
        let fence = self
            .cloudflare_credential
            .current_fence(intent)
            .ok_or_else(denied)?;
        let mut aggregate_bytes = 0usize;
        let mut request_count = 0usize;

        let zone_body = self
            .cloudflare_request(
                intent,
                &fence,
                CloudflareEndpoint::ZoneDetails,
                &mut aggregate_bytes,
                &mut request_count,
            )
            .await?;
        let zone_envelope: ZoneEnvelope = parse_bounded_json(&zone_body)?;
        if !zone_envelope.success
            || !zone_envelope.errors.is_empty()
            || !zone_envelope.messages.is_empty()
            || zone_envelope.result.id != intent.zone_id()
        {
            return Err(invalid_response());
        }
        let zone_name = normalize_fqdn(&zone_envelope.result.name).ok_or_else(invalid_response)?;
        let status = match zone_envelope.result.status.as_str() {
            "active" => CloudflareZoneStatus::Active,
            "pending" => CloudflareZoneStatus::Pending,
            _ => return Err(invalid_response()),
        };
        let zone = CloudflareZoneMetadata {
            zone_id: zone_envelope.result.id,
            zone_name,
            status,
        };

        let mut records = Vec::new();
        let mut identities = HashSet::new();
        for record_type in CloudflareRecordType::ALL {
            let mut page = 1u16;
            let mut expected_total = None;
            loop {
                let body = self
                    .cloudflare_request(
                        intent,
                        &fence,
                        CloudflareEndpoint::ListDnsRecords { record_type, page },
                        &mut aggregate_bytes,
                        &mut request_count,
                    )
                    .await?;
                let envelope: RecordsEnvelope = parse_bounded_json(&body)?;
                validate_page(&envelope, page, expected_total)?;
                expected_total = Some(envelope.result_info.total_count);
                for raw in envelope.result {
                    if records.len() >= MAX_RECORDS {
                        return Err(invalid_response());
                    }
                    let record = validate_record(raw, record_type, zone.zone_name())?;
                    let identity = (
                        record.fqdn.clone(),
                        record.record_type,
                        record.record_id.clone(),
                    );
                    if !identities.insert(identity) {
                        return Err(invalid_response());
                    }
                    records.push(record);
                }
                if page == envelope.result_info.total_pages {
                    break;
                }
                page = page.checked_add(1).ok_or_else(invalid_response)?;
            }
        }
        if !self.cloudflare_credential.fence_matches(intent, &fence) {
            return Err(denied());
        }
        records.sort_by(|left, right| {
            (
                left.fqdn.as_bytes(),
                left.record_type,
                left.record_id.as_bytes(),
            )
                .cmp(&(
                    right.fqdn.as_bytes(),
                    right.record_type,
                    right.record_id.as_bytes(),
                ))
        });
        Ok(AvailableObservation { zone, records })
    }

    async fn cloudflare_request(
        &mut self,
        intent: &CloudflareZoneReadIntent,
        fence: &crate::cloudflare_credential::CloudflareCredentialFence,
        request: CloudflareEndpoint,
        aggregate_bytes: &mut usize,
        request_count: &mut usize,
    ) -> Result<Vec<u8>, CloudflareObservationError> {
        if *request_count >= MAX_REQUESTS {
            return Err(response_too_large());
        }
        if !self.cloudflare_credential.fence_matches(intent, fence) {
            return Err(denied());
        }
        *request_count += 1;
        let response = self
            .cloudflare_transport
            .send(
                request,
                intent.zone_id(),
                self.cloudflare_credential.token(),
            )
            .await?;
        #[cfg(test)]
        self.apply_cloudflare_mutation_for_test();
        if !self.cloudflare_credential.fence_matches(intent, fence) {
            return Err(denied());
        }
        let body = map_status(response)?;
        *aggregate_bytes = aggregate_bytes
            .checked_add(body.len())
            .ok_or_else(response_too_large)?;
        if *aggregate_bytes > MAX_AGGREGATE_BYTES {
            return Err(response_too_large());
        }
        if !self.cloudflare_credential.fence_matches(intent, fence) {
            return Err(denied());
        }
        Ok(body)
    }
}

fn validate_page(
    envelope: &RecordsEnvelope,
    page: u16,
    expected_total: Option<usize>,
) -> Result<(), CloudflareObservationError> {
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
        || info.total_pages > MAX_PAGES_PER_RECORD_TYPE
        || page > info.total_pages
        || expected_total.is_some_and(|total| total != info.total_count)
        || (page < info.total_pages && info.count != 100)
        || (page == info.total_pages
            && info.total_count != (usize::from(page - 1) * 100 + info.count))
    {
        return Err(invalid_response());
    }
    Ok(())
}

fn validate_record(
    raw: RawRecord,
    expected_type: CloudflareRecordType,
    expected_zone_name: &str,
) -> Result<CloudflareDnsRecord, CloudflareObservationError> {
    if !is_lower_hex_id(&raw.id)
        || raw.record_type != expected_type.as_str()
        || raw.ttl == 0
        || raw.ttl > 2_147_483_647
        || raw.content.len() > 4096
    {
        return Err(invalid_response());
    }
    let provider_version_token =
        canonicalize_timestamp(&raw.modified_on).ok_or_else(invalid_response)?;
    let fqdn = normalize_fqdn(&raw.name).ok_or_else(invalid_response)?;
    if fqdn != expected_zone_name
        && !fqdn
            .strip_suffix(expected_zone_name)
            .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1)
    {
        return Err(invalid_response());
    }
    let content = match expected_type {
        CloudflareRecordType::A => raw
            .content
            .parse::<Ipv4Addr>()
            .ok()
            .filter(|value| value.to_string() == raw.content)
            .map(|_| raw.content),
        CloudflareRecordType::AAAA => raw
            .content
            .parse::<Ipv6Addr>()
            .ok()
            .filter(|value| value.to_string() == raw.content)
            .map(|_| raw.content),
        CloudflareRecordType::CNAME => normalize_fqdn(&raw.content),
        CloudflareRecordType::TXT => {
            (!raw.content.chars().any(is_control_or_format)).then_some(raw.content)
        }
    }
    .ok_or_else(invalid_response)?;
    if expected_type == CloudflareRecordType::TXT && raw.proxied {
        return Err(invalid_response());
    }
    Ok(CloudflareDnsRecord {
        record_id: raw.id,
        fqdn,
        record_type: expected_type,
        content,
        ttl: raw.ttl,
        proxied: raw.proxied,
        provider_version_token,
    })
}

fn parse_bounded_json<T: for<'de> Deserialize<'de>>(
    body: &[u8],
) -> Result<T, CloudflareObservationError> {
    let value: serde_json::Value = serde_json::from_slice(body).map_err(|_| invalid_response())?;
    let mut stack = vec![(&value, 1usize)];
    let mut nodes = 0usize;
    while let Some((node, depth)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH {
            return Err(response_too_large());
        }
        match node {
            serde_json::Value::Array(values) => {
                stack.extend(values.iter().map(|value| (value, depth + 1)));
            }
            serde_json::Value::Object(values) => {
                stack.extend(values.values().map(|value| (value, depth + 1)));
            }
            _ => {}
        }
    }
    serde_json::from_value(value).map_err(|_| invalid_response())
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
        || value.bytes().any(|byte| byte.is_ascii_uppercase())
    {
        return None;
    }
    let valid = value.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    });
    valid.then(|| value.to_owned())
}

fn is_control_or_format(character: char) -> bool {
    character.is_control()
        || matches!(character as u32,
        0x00AD | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2 |
        0x180E | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F |
        0xFEFF | 0xFFF9..=0xFFFB | 0x110BD | 0x110CD | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3 |
        0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
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

#[cfg(test)]
fn is_canonical_timestamp(value: &str) -> bool {
    canonicalize_timestamp(value).as_deref() == Some(value)
}

#[cfg(test)]
fn is_canonical_observed_at(value: &str) -> bool {
    value.len() == 20
        && canonicalize_timestamp(value).as_deref() == Some(&value.replace('Z', ".000Z"))
}

fn current_timestamp() -> Result<String, CloudflareObservationError> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| temporary())?;
    let seconds = elapsed.as_secs();
    let days = i64::try_from(seconds / 86_400).map_err(|_| temporary())?;
    let day_seconds = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        day_seconds / 3600,
        (day_seconds % 3600) / 60,
        day_seconds % 60
    ))
}

fn new_observation_id() -> Result<String, CloudflareObservationError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| temporary())?;
    let mut id = String::with_capacity(32);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut id, "{byte:02x}").map_err(|_| temporary())?;
    }
    Ok(id)
}

const fn public_error_code(
    code: CloudflareObservationErrorCode,
) -> CloudflareUnavailableObservationCode {
    match code {
        CloudflareObservationErrorCode::Authentication => {
            CloudflareUnavailableObservationCode::Authentication
        }
        CloudflareObservationErrorCode::Permission => {
            CloudflareUnavailableObservationCode::Permission
        }
        CloudflareObservationErrorCode::RateLimited => {
            CloudflareUnavailableObservationCode::RateLimited
        }
        CloudflareObservationErrorCode::TemporarilyUnavailable
        | CloudflareObservationErrorCode::Denied => {
            CloudflareUnavailableObservationCode::TemporarilyUnavailable
        }
        CloudflareObservationErrorCode::InvalidResponse
        | CloudflareObservationErrorCode::ResponseTooLarge => {
            CloudflareUnavailableObservationCode::InvalidObservation
        }
    }
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn denied() -> CloudflareObservationError {
    CloudflareObservationError::new(CloudflareObservationErrorCode::Denied, None)
}
fn invalid_response() -> CloudflareObservationError {
    CloudflareObservationError::new(CloudflareObservationErrorCode::InvalidResponse, None)
}
fn response_too_large() -> CloudflareObservationError {
    CloudflareObservationError::new(CloudflareObservationErrorCode::ResponseTooLarge, None)
}
fn temporary() -> CloudflareObservationError {
    CloudflareObservationError::new(CloudflareObservationErrorCode::TemporarilyUnavailable, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        cloudflare_credential::{CloudflareCredentialMutation, CloudflareCredentialState},
        cloudflare_transport::{CloudflareTransport, ScriptedResponse},
        sealed_host_state::SealedHostState,
    };
    use serde_json::json;

    const CONNECTION_ID: &str = "connection-cloudflare-1";
    const ZONE_ID: &str = "0123456789abcdef0123456789abcdef";
    const TOKEN_MARKER: &str = "cf-test-token-DO-NOT-LEAK";

    fn intent() -> CloudflareZoneReadIntent {
        CloudflareZoneReadIntent::parse_json(
            format!(r#"{{"connectionId":"{CONNECTION_ID}","zoneId":"{ZONE_ID}"}}"#).as_bytes(),
        )
        .expect("fixed test intent is valid")
    }

    fn raw_record(
        name: &str,
        record_type: &str,
        content: &str,
        ttl: u32,
        proxied: bool,
        modified_on: &str,
    ) -> RawRecord {
        serde_json::from_value(json!({
            "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "name": name,
            "type": record_type,
            "content": content,
            "ttl": ttl,
            "proxied": proxied,
            "modified_on": modified_on,
            "created_on": "2026-08-25T12:34:56Z",
            "meta": {},
            "proxiable": true
        }))
        .expect("test provider record matches the private wire type")
    }

    fn zone_response() -> ScriptedResponse {
        ScriptedResponse::json(200, zone_body())
    }

    fn zone_body() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "success": true,
            "errors": [],
            "messages": [],
            "result": {
                "id": ZONE_ID,
                "name": "example.com",
                "status": "active",
                "name_servers": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
                "type": "full"
            }
        }))
        .expect("fixture serializes")
    }

    fn record_response(record_type: &str, id: &str, name: &str, content: &str) -> ScriptedResponse {
        ScriptedResponse::json(
            200,
            serde_json::to_vec(&json!({
                "success": true,
                "errors": [],
                "messages": [],
                "result": [{
                    "id": id, "name": name,
                    "type": record_type, "content": content, "ttl": 300, "proxied": false,
                    "modified_on": "2026-08-26T12:34:56Z", "created_on": "2026-08-25T12:34:56Z",
                    "meta": {}, "proxiable": true
                }],
                "result_info": { "page": 1, "per_page": 100, "count": 1, "total_count": 1, "total_pages": 1 }
            }))
            .expect("fixture serializes"),
        )
    }

    fn record_page_body(
        record_type: CloudflareRecordType,
        page: u16,
        total_count: usize,
        start: usize,
        count: usize,
    ) -> Vec<u8> {
        let records: Vec<_> = (start..start + count)
            .map(|index| {
                let content = match record_type {
                    CloudflareRecordType::A => "192.0.2.1",
                    CloudflareRecordType::AAAA => "2001:db8::1",
                    CloudflareRecordType::CNAME => "target.example.com",
                    CloudflareRecordType::TXT => "x",
                };
                json!({
                    "id": format!("{:032x}", index + 1),
                    "name": format!("r{index}.example.com"),
                    "type": record_type.as_str(),
                    "content": content,
                    "ttl": 300,
                    "proxied": false,
                    "modified_on": "2026-08-26T12:34:56.123456Z",
                    "created_on": "2026-08-25T12:34:56Z",
                    "meta": {},
                    "proxiable": true
                })
            })
            .collect();
        let total_pages = if total_count == 0 {
            1
        } else {
            u16::try_from(total_count.div_ceil(100)).expect("test page count fits")
        };
        serde_json::to_vec(&json!({
            "success": true,
            "errors": [],
            "messages": [],
            "result": records,
            "result_info": {
                "page": page,
                "per_page": 100,
                "count": count,
                "total_count": total_count,
                "total_pages": total_pages
            }
        }))
        .expect("fixture serializes")
    }

    fn record_page_response(
        record_type: CloudflareRecordType,
        page: u16,
        total_count: usize,
        start: usize,
        count: usize,
    ) -> ScriptedResponse {
        ScriptedResponse::json(
            200,
            record_page_body(record_type, page, total_count, start, count),
        )
    }

    fn count_boundary_script(cname_count: usize) -> Vec<ScriptedResponse> {
        let mut script = vec![zone_response()];
        for page in 1..=9 {
            script.push(record_page_response(
                CloudflareRecordType::A,
                page,
                900,
                usize::from(page - 1) * 100,
                100,
            ));
        }
        script.push(record_page_response(
            CloudflareRecordType::AAAA,
            1,
            100,
            900,
            100,
        ));
        script.push(record_page_response(
            CloudflareRecordType::CNAME,
            1,
            cname_count,
            1000,
            cname_count,
        ));
        script.push(record_page_response(CloudflareRecordType::TXT, 1, 0, 0, 0));
        script
    }

    fn paginated_request_boundary_script(a_pages: u16) -> Vec<ScriptedResponse> {
        let total = usize::from(a_pages - 1) * 100 + 1;
        let mut script = vec![zone_response()];
        for page in 1..=a_pages {
            let count = if page == a_pages { 1 } else { 100 };
            script.push(record_page_response(
                CloudflareRecordType::A,
                page,
                total,
                usize::from(page - 1) * 100,
                count,
            ));
        }
        script.push(record_page_response(
            CloudflareRecordType::AAAA,
            1,
            101,
            900,
            100,
        ));
        script.push(record_page_response(
            CloudflareRecordType::AAAA,
            2,
            101,
            1000,
            1,
        ));
        script.push(record_page_response(
            CloudflareRecordType::CNAME,
            1,
            0,
            0,
            0,
        ));
        script.push(record_page_response(CloudflareRecordType::TXT, 1, 0, 0, 0));
        script
    }

    fn page_boundary_script(a_pages: u16) -> Vec<ScriptedResponse> {
        let total = usize::from(a_pages) * 100;
        let mut script = vec![zone_response()];
        for page in 1..=a_pages {
            script.push(record_page_response(
                CloudflareRecordType::A,
                page,
                total,
                usize::from(page - 1) * 100,
                100,
            ));
        }
        for record_type in [
            CloudflareRecordType::AAAA,
            CloudflareRecordType::CNAME,
            CloudflareRecordType::TXT,
        ] {
            script.push(record_page_response(record_type, 1, 0, 0, 0));
        }
        script
    }

    fn aggregate_boundary_script(total_bytes: usize) -> Vec<ScriptedResponse> {
        let mut bodies = vec![
            zone_body(),
            record_page_body(CloudflareRecordType::A, 1, 0, 0, 0),
            record_page_body(CloudflareRecordType::AAAA, 1, 0, 0, 0),
            record_page_body(CloudflareRecordType::CNAME, 1, 0, 0, 0),
        ];
        for page in 1..=9 {
            bodies.push(record_page_body(
                CloudflareRecordType::TXT,
                page,
                900,
                usize::from(page - 1) * 100,
                100,
            ));
        }
        let current: usize = bodies.iter().map(Vec::len).sum();
        assert!(current <= total_bytes, "fixture must fit target aggregate");
        let mut remaining = total_bytes - current;
        for body in bodies.iter_mut().rev() {
            let available = crate::cloudflare_transport::MAX_RESPONSE_BYTES - body.len();
            let padding = available.min(remaining);
            body.resize(body.len() + padding, b' ');
            remaining -= padding;
        }
        assert_eq!(
            remaining, 0,
            "fixture responses must have enough padding capacity"
        );
        assert_eq!(bodies.iter().map(Vec::len).sum::<usize>(), total_bytes);
        bodies
            .into_iter()
            .map(|body| ScriptedResponse::json(200, body))
            .collect()
    }

    fn active_host(script: Vec<ScriptedResponse>) -> SecureHost {
        SecureHost {
            state: SealedHostState::concrete_denying(),
            cloudflare_credential: CloudflareCredentialState::active_for_test(
                CONNECTION_ID,
                ZONE_ID,
                TOKEN_MARKER,
            ),
            cloudflare_transport: CloudflareTransport::scripted(script),
            cloudflare_mutation: None,
        }
    }

    fn successful_script() -> Vec<ScriptedResponse> {
        vec![
            zone_response(),
            record_response(
                "A",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "a.example.com",
                "192.0.2.1",
            ),
            record_response(
                "AAAA",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "v6.example.com",
                "2001:db8::1",
            ),
            record_response(
                "CNAME",
                "cccccccccccccccccccccccccccccccc",
                "alias.example.com",
                "a.example.com",
            ),
            record_response(
                "TXT",
                "dddddddddddddddddddddddddddddddd",
                "txt.example.com",
                "verification",
            ),
        ]
    }

    #[test]
    fn intent_parser_accepts_only_exact_nonsecret_selection() {
        assert_eq!(intent().connection_id(), CONNECTION_ID);
        assert_eq!(intent().zone_id(), ZONE_ID);
        for invalid in [
            r#"{"connectionId":"x","zoneId":"ABCDEF0123456789abcdef0123456789"}"#,
            r#"{"connectionId":"x","zoneId":"0123456789abcdef0123456789abcdef","token":"secret"}"#,
            r#"{"connectionId":"x\u200b","zoneId":"0123456789abcdef0123456789abcdef"}"#,
            r#"{"connectionId":"x","zoneId":"0123456789abcdef0123456789abcdef","method":"GET"}"#,
        ] {
            let error = CloudflareZoneReadIntent::parse_json(invalid.as_bytes())
                .expect_err("authority or malformed intent must fail closed");
            assert_eq!(error.to_string(), "invalid cloudflare observation data");
            assert!(!format!("{error:?}").contains("secret"));
        }
    }

    #[tokio::test]
    async fn observes_sanitized_records_in_canonical_order_with_fixed_attempts() {
        let mut host = active_host(successful_script());
        let observation = host
            .observe_cloudflare_zone(intent())
            .await
            .expect("valid script");
        assert_eq!(observation.connection_id(), CONNECTION_ID);
        assert_eq!(observation.zone().zone_id(), ZONE_ID);
        assert_eq!(observation.zone().zone_name(), "example.com");
        assert_eq!(observation.records().len(), 4);
        assert_eq!(observation.records()[0].fqdn(), "a.example.com");
        assert!(is_canonical_observed_at(observation.observed_at()));
        assert!(
            observation
                .records()
                .iter()
                .all(|record| is_canonical_timestamp(record.provider_version_token()))
        );
        assert_eq!(
            observation.records()[0].provider_version_token(),
            "2026-08-26T12:34:56.000Z"
        );
        assert_eq!(
            host.cloudflare_transport.attempts(),
            &[
                CloudflareEndpoint::ZoneDetails,
                CloudflareEndpoint::ListDnsRecords {
                    record_type: CloudflareRecordType::A,
                    page: 1
                },
                CloudflareEndpoint::ListDnsRecords {
                    record_type: CloudflareRecordType::AAAA,
                    page: 1
                },
                CloudflareEndpoint::ListDnsRecords {
                    record_type: CloudflareRecordType::CNAME,
                    page: 1
                },
                CloudflareEndpoint::ListDnsRecords {
                    record_type: CloudflareRecordType::TXT,
                    page: 1
                },
            ]
        );
        let serialized = serde_json::to_string(&observation).expect("safe projection serializes");
        let wire: serde_json::Value = serde_json::from_str(&serialized).expect("wire JSON");
        assert!(protocol_submit_vector_is_valid(&wire));
        assert_eq!(wire["schemaVersion"], CONNECTORS_PROTOCOL_VERSION);
        assert_eq!(wire["providerKind"], "cloudflare");
        assert_eq!(wire["observationCapability"], "dns");
        assert_eq!(wire["result"]["status"], "available");
        for forbidden in [
            TOKEN_MARKER,
            "Authorization",
            "api.cloudflare.com",
            "Bearer",
        ] {
            assert!(!serialized.contains(forbidden));
            assert!(!format!("{observation:?}").contains(forbidden));
        }
    }

    #[tokio::test]
    async fn every_credential_fence_change_after_await_denies_without_publication() {
        for mutation in [
            CloudflareCredentialMutation::Remove,
            CloudflareCredentialMutation::Connection,
            CloudflareCredentialMutation::Zone,
            CloudflareCredentialMutation::Purpose,
            CloudflareCredentialMutation::Permission,
            CloudflareCredentialMutation::Generation,
            CloudflareCredentialMutation::Token,
        ] {
            let mut host = active_host(successful_script());
            host.cloudflare_mutation = Some(mutation);
            let error = host
                .observe_cloudflare_zone(intent())
                .await
                .expect_err("stale fence denies");
            assert_eq!(error.code(), CloudflareObservationErrorCode::Denied);
            assert_eq!(host.cloudflare_transport.attempts().len(), 1);
        }
    }

    #[tokio::test]
    async fn connection_and_zone_substitution_deny_before_any_request() {
        for json in [
            format!(r#"{{"connectionId":"other","zoneId":"{ZONE_ID}"}}"#),
            r#"{"connectionId":"connection-cloudflare-1","zoneId":"1123456789abcdef0123456789abcdef"}"#.to_owned(),
        ] {
            let selection = CloudflareZoneReadIntent::parse_json(json.as_bytes()).expect("valid other intent");
            let mut host = active_host(successful_script());
            let error = host.observe_cloudflare_zone(selection).await.expect_err("wrong binding denies");
            assert_eq!(error.code(), CloudflareObservationErrorCode::Denied);
            assert!(host.cloudflare_transport.attempts().is_empty());
        }
    }

    #[tokio::test]
    async fn status_and_retry_after_mapping_is_closed_and_redacted() {
        for (response, code, retry) in [
            (
                ScriptedResponse::json(401, b"provider secret".to_vec()),
                CloudflareUnavailableObservationCode::Authentication,
                None,
            ),
            (
                ScriptedResponse::json(403, b"provider secret".to_vec()),
                CloudflareUnavailableObservationCode::Permission,
                None,
            ),
            (
                ScriptedResponse::rate_limited("17"),
                CloudflareUnavailableObservationCode::RateLimited,
                Some(17),
            ),
            (
                ScriptedResponse::rate_limited("17.5"),
                CloudflareUnavailableObservationCode::RateLimited,
                None,
            ),
            (
                ScriptedResponse::json(429, b"provider secret".to_vec()),
                CloudflareUnavailableObservationCode::RateLimited,
                None,
            ),
            (
                ScriptedResponse::json(500, b"provider secret".to_vec()),
                CloudflareUnavailableObservationCode::TemporarilyUnavailable,
                None,
            ),
            (
                ScriptedResponse::json(201, b"provider secret".to_vec()),
                CloudflareUnavailableObservationCode::InvalidObservation,
                None,
            ),
        ] {
            let mut host = active_host(vec![response]);
            let observation = host
                .observe_cloudflare_zone(intent())
                .await
                .expect("provider failures become redacted unavailable observations");
            assert_eq!(observation.unavailable(), Some((code, retry)));
            let wire = serde_json::to_value(&observation).expect("unavailable wire serializes");
            assert!(protocol_submit_vector_is_valid(&wire));
            assert!(!wire.to_string().contains("invalid_response"));
            assert!(!wire.to_string().contains("response_too_large"));
            assert!(!format!("{observation:?}").contains("provider secret"));
        }
    }

    #[tokio::test]
    async fn unknown_oversize_mismatch_and_partial_page_fail_closed() {
        let unknown = ScriptedResponse::json(
            200,
            format!(
                r#"{{"success":true,"result":{{"id":"{ZONE_ID}","name":"example.com","status":"active","token":"{TOKEN_MARKER}"}}}}"#
            ),
        );
        let mismatched = ScriptedResponse::json(
            200,
            r#"{"success":true,"result":{"id":"ffffffffffffffffffffffffffffffff","name":"example.com","status":"active"}}"#,
        );
        let provider_diagnostic = ScriptedResponse::json(
            200,
            format!(
                r#"{{"success":true,"errors":[{{"code":1000,"message":"{TOKEN_MARKER}"}}],"messages":[],"result":{{"id":"{ZONE_ID}","name":"example.com","status":"active"}}}}"#
            ),
        );
        let oversize = ScriptedResponse::json(
            200,
            vec![b'x'; crate::cloudflare_transport::MAX_RESPONSE_BYTES + 1],
        );
        for response in [unknown, mismatched, provider_diagnostic, oversize] {
            let mut host = active_host(vec![response]);
            let observation = host
                .observe_cloudflare_zone(intent())
                .await
                .expect("bad provider response becomes invalid_observation");
            assert_eq!(
                observation.unavailable(),
                Some((
                    CloudflareUnavailableObservationCode::InvalidObservation,
                    None
                ))
            );
        }

        let mut host = active_host(vec![
            zone_response(),
            ScriptedResponse::failure(CloudflareObservationError::new(
                CloudflareObservationErrorCode::TemporarilyUnavailable,
                None,
            )),
        ]);
        let observation = host
            .observe_cloudflare_zone(intent())
            .await
            .expect("page failure publishes only a closed unavailable observation");
        assert_eq!(
            observation.unavailable(),
            Some((
                CloudflareUnavailableObservationCode::TemporarilyUnavailable,
                None
            ))
        );
    }

    #[test]
    fn malformed_provider_record_controls_are_rejected() {
        let base = raw_record(
            "a.example.com",
            "A",
            "192.0.2.1",
            300,
            false,
            "2026-08-26T12:34:56Z",
        );
        assert!(validate_record(base, CloudflareRecordType::A, "example.com").is_ok());
        let invalid = raw_record(
            "a.example.com",
            "TXT",
            "secret\nline",
            0,
            true,
            "not-a-time",
        );
        assert_eq!(
            validate_record(invalid, CloudflareRecordType::TXT, "example.com")
                .expect_err("invalid fields fail")
                .code(),
            CloudflareObservationErrorCode::InvalidResponse
        );
        let outside_zone = raw_record(
            "attacker.example.net",
            "A",
            "192.0.2.1",
            300,
            false,
            "2026-08-26T12:34:56Z",
        );
        assert!(validate_record(outside_zone, CloudflareRecordType::A, "example.com").is_err());
    }

    #[test]
    fn string_timestamp_pagination_depth_and_node_bounds_fail_closed() {
        assert_eq!(
            canonicalize_timestamp("2026-08-26T12:34:56Z").as_deref(),
            Some("2026-08-26T12:34:56.000Z")
        );
        assert_eq!(
            canonicalize_timestamp("2026-08-26T12:34:56.1Z").as_deref(),
            Some("2026-08-26T12:34:56.100Z")
        );
        assert_eq!(
            canonicalize_timestamp("2026-08-26T12:34:56.123456Z").as_deref(),
            Some("2026-08-26T12:34:56.123Z")
        );
        assert!(canonicalize_timestamp("2026-08-26T12:34:56.123+00:00").is_none());
        let valid_txt = raw_record(
            "txt.example.com",
            "TXT",
            &"x".repeat(4096),
            2_147_483_647,
            false,
            "2024-02-29T23:59:59.123Z",
        );
        assert!(validate_record(valid_txt, CloudflareRecordType::TXT, "example.com").is_ok());
        let too_long = raw_record(
            "txt.example.com",
            "TXT",
            &"x".repeat(4097),
            300,
            false,
            "2023-02-29T23:59:59Z",
        );
        assert!(validate_record(too_long, CloudflareRecordType::TXT, "example.com").is_err());

        let inconsistent = RecordsEnvelope {
            success: true,
            result: Vec::new(),
            result_info: crate::cloudflare_provider::ResultInfo {
                page: 1,
                per_page: 100,
                count: 0,
                total_count: 1,
                total_pages: 2,
            },
            errors: Vec::new(),
            messages: Vec::new(),
        };
        assert!(validate_page(&inconsistent, 1, None).is_err());

        let deeply_nested = format!(
            "{}0{}",
            "[".repeat(MAX_JSON_DEPTH + 1),
            "]".repeat(MAX_JSON_DEPTH + 1)
        );
        assert_eq!(
            parse_bounded_json::<serde_json::Value>(deeply_nested.as_bytes())
                .expect_err("depth limit must fail")
                .code(),
            CloudflareObservationErrorCode::ResponseTooLarge
        );
        let many_nodes = serde_json::to_vec(&vec![0_u8; MAX_JSON_NODES + 1]).expect("fixture");
        assert_eq!(
            parse_bounded_json::<serde_json::Value>(&many_nodes)
                .expect_err("node limit must fail")
                .code(),
            CloudflareObservationErrorCode::ResponseTooLarge
        );
    }

    #[tokio::test]
    async fn sealed_backup_state_cannot_satisfy_cloudflare_credential_admission() {
        let mut host = SecureHost {
            state: SealedHostState::active_for_test("backup-id", "manifest-digest"),
            cloudflare_credential: CloudflareCredentialState::denying(),
            cloudflare_transport: CloudflareTransport::scripted(successful_script()),
            cloudflare_mutation: None,
        };
        let error = host
            .observe_cloudflare_zone(intent())
            .await
            .expect_err("backup authority is not Cloudflare authority");
        assert_eq!(error.code(), CloudflareObservationErrorCode::Denied);
        assert!(host.cloudflare_transport.attempts().is_empty());
    }

    #[tokio::test]
    async fn aggregate_bytes_accept_exact_limit_and_reject_limit_plus_one_without_observation() {
        let mut at_limit = active_host(aggregate_boundary_script(MAX_AGGREGATE_BYTES));
        let observation = at_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("exact aggregate limit must be admitted");
        assert_eq!(observation.records().len(), 900);
        assert_eq!(at_limit.cloudflare_transport.attempts().len(), MAX_REQUESTS);

        let mut over_limit = active_host(aggregate_boundary_script(MAX_AGGREGATE_BYTES + 1));
        let observation = over_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("aggregate overflow becomes invalid_observation");
        assert_eq!(
            observation.unavailable(),
            Some((
                CloudflareUnavailableObservationCode::InvalidObservation,
                None
            ))
        );
        assert_eq!(
            over_limit.cloudflare_transport.attempts().len(),
            MAX_REQUESTS
        );
    }

    #[tokio::test]
    async fn request_count_accepts_limit_and_rejects_limit_plus_one() {
        let mut at_limit = active_host(paginated_request_boundary_script(8));
        let observation = at_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("twelve DNS pages plus Zone equals 13 requests");
        assert_eq!(observation.records().len(), 802);
        assert_eq!(at_limit.cloudflare_transport.attempts().len(), MAX_REQUESTS);

        let mut over_limit = active_host(paginated_request_boundary_script(9));
        let observation = over_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("request overflow becomes invalid_observation");
        assert_eq!(
            observation.unavailable(),
            Some((
                CloudflareUnavailableObservationCode::InvalidObservation,
                None
            ))
        );
        assert_eq!(
            over_limit.cloudflare_transport.attempts().len(),
            MAX_REQUESTS
        );
    }

    #[tokio::test]
    async fn page_count_accepts_nine_and_rejects_ten_without_observation() {
        let mut at_limit = active_host(page_boundary_script(MAX_PAGES_PER_RECORD_TYPE));
        let observation = at_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("nine pages for one record type must be admitted");
        assert_eq!(observation.records().len(), 900);
        assert_eq!(at_limit.cloudflare_transport.attempts().len(), MAX_REQUESTS);

        let mut over_limit = active_host(page_boundary_script(MAX_PAGES_PER_RECORD_TYPE + 1));
        let observation = over_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("page overflow becomes invalid_observation");
        assert_eq!(
            observation.unavailable(),
            Some((
                CloudflareUnavailableObservationCode::InvalidObservation,
                None
            ))
        );
        assert_eq!(over_limit.cloudflare_transport.attempts().len(), 2);
    }

    #[tokio::test]
    async fn global_record_count_accepts_1024_and_rejects_1025_without_observation() {
        let mut at_limit = active_host(count_boundary_script(24));
        let observation = at_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("exact global record limit must be admitted");
        assert_eq!(observation.records().len(), MAX_RECORDS);
        assert_eq!(at_limit.cloudflare_transport.attempts().len(), MAX_REQUESTS);

        let mut over_limit = active_host(count_boundary_script(25));
        let observation = over_limit
            .observe_cloudflare_zone(intent())
            .await
            .expect("record overflow becomes invalid_observation");
        assert_eq!(
            observation.unavailable(),
            Some((
                CloudflareUnavailableObservationCode::InvalidObservation,
                None
            ))
        );
        assert_eq!(
            over_limit.cloudflare_transport.attempts().len(),
            MAX_REQUESTS - 1
        );
    }

    #[test]
    fn consumes_protocol_owned_cloudflare_wire_corpus() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/protocol/test-vectors/cloudflare-observation/wire-corpus.json"
        ))
        .expect("Protocol corpus is JSON");
        for value in corpus["validSubmitRequests"]
            .as_array()
            .expect("valid vectors")
        {
            assert!(
                protocol_submit_vector_is_valid(value),
                "valid Protocol vector rejected"
            );
        }
        for value in corpus["invalidSubmitRequests"]
            .as_array()
            .expect("invalid vectors")
        {
            assert!(
                !protocol_submit_vector_is_valid(value),
                "invalid Protocol vector accepted"
            );
        }
    }

    // Keeping this test-only mirror in one function makes every Protocol field visible in a
    // single parity audit; production Rust never uses it as schema authority.
    #[allow(clippy::too_many_lines)]
    fn protocol_submit_vector_is_valid(value: &serde_json::Value) -> bool {
        let Some(root) = value.as_object() else {
            return false;
        };
        if !has_exact_keys(
            root,
            &[
                "schemaVersion",
                "providerKind",
                "observationCapability",
                "observationId",
                "connectionId",
                "observedAt",
                "result",
            ],
        ) || root["schemaVersion"] != CONNECTORS_PROTOCOL_VERSION
            || root["providerKind"] != "cloudflare"
            || root["observationCapability"] != "dns"
            || !root["observationId"].as_str().is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 160
                    && id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
            })
            || !root["connectionId"]
                .as_str()
                .is_some_and(|id| !id.is_empty() && id.len() <= 256)
            || !root["observedAt"]
                .as_str()
                .is_some_and(is_canonical_observed_at)
        {
            return false;
        }
        let Some(result) = root["result"].as_object() else {
            return false;
        };
        match result.get("status").and_then(serde_json::Value::as_str) {
            Some("available") => {
                if !has_exact_keys(result, &["status", "zone", "records"]) {
                    return false;
                }
                let Some(zone) = result["zone"].as_object() else {
                    return false;
                };
                let Some(zone_name) = zone.get("zoneName").and_then(serde_json::Value::as_str)
                else {
                    return false;
                };
                if !has_exact_keys(zone, &["zoneId", "zoneName", "status"])
                    || !zone["zoneId"].as_str().is_some_and(is_lower_hex_id)
                    || normalize_fqdn(zone_name).as_deref() != Some(zone_name)
                    || !matches!(zone["status"].as_str(), Some("active" | "pending"))
                {
                    return false;
                }
                let Some(records) = result["records"].as_array() else {
                    return false;
                };
                if records.len() > MAX_RECORDS {
                    return false;
                }
                records.iter().all(|record| {
                    let Some(record) = record.as_object() else {
                        return false;
                    };
                    has_exact_keys(
                        record,
                        &[
                            "recordId",
                            "fqdn",
                            "type",
                            "content",
                            "ttl",
                            "proxied",
                            "providerVersionToken",
                        ],
                    ) && record["recordId"]
                        .as_str()
                        .is_some_and(|id| !id.is_empty() && id.len() <= 256)
                        && record["fqdn"].as_str().is_some_and(|name| {
                            name == zone_name
                                || name
                                    .strip_suffix(zone_name)
                                    .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1)
                        })
                        && matches!(
                            record["type"].as_str(),
                            Some("A" | "AAAA" | "CNAME" | "TXT")
                        )
                        && record["ttl"]
                            .as_u64()
                            .is_some_and(|ttl| (1..=2_147_483_647).contains(&ttl))
                        && record["proxied"].is_boolean()
                        && record["providerVersionToken"]
                            .as_str()
                            .is_some_and(is_canonical_timestamp)
                })
            }
            Some("unavailable") => {
                has_exact_keys(result, &["status", "zoneId", "code", "retryAfterSeconds"])
                    && result["zoneId"].as_str().is_some_and(is_lower_hex_id)
                    && matches!(
                        result["code"].as_str(),
                        Some(
                            "authentication"
                                | "permission"
                                | "rate_limited"
                                | "temporarily_unavailable"
                                | "invalid_observation"
                        )
                    )
                    && match result["retryAfterSeconds"].as_u64() {
                        Some(delay) => result["code"] == "rate_limited" && delay <= 86_400,
                        None => result["retryAfterSeconds"].is_null(),
                    }
            }
            _ => false,
        }
    }

    fn has_exact_keys(
        value: &serde_json::Map<String, serde_json::Value>,
        expected: &[&str],
    ) -> bool {
        value.len() == expected.len() && expected.iter().all(|key| value.contains_key(*key))
    }
}
