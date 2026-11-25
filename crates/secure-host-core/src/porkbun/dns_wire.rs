use std::collections::BTreeSet;

use serde::Deserialize;
use url::Host;

use super::{PorkbunDnsRecord, PorkbunDnsRecordType, PorkbunDnsZone, PorkbunError};

/// Local evidence bound for one zone observation; Porkbun's own zone cap is 2,500 records.
pub(super) const MAX_DNS_RECORDS: usize = 1024;

/// `DnsRecordsResponse` (v3.112) plus a `warnings` array. The schema has no `warnings`; the API
/// description promises one on every `/dns/*` response for a domain moved to Cloudflare and adds
/// it to writes for domains delegated elsewhere, so it is accepted here only as a bounded hint.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordsWire {
    status: String,
    cloudflare: Option<CloudflareProxy>,
    records: Vec<RecordWire>,
    warnings: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum CloudflareProxy {
    Enabled,
    Disabled,
}

/// The schema marks no record field required. `GoodDealer` requires every value-bearing field and
/// refuses a record without them: a fail-closed choice, not a documented rule.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordWire {
    id: String,
    name: String,
    #[serde(rename = "type")]
    record_type: String,
    content: String,
    ttl: String,
    prio: Option<String>,
    /// User-authored and never served in DNS, so it is checked for shape and dropped here.
    notes: Option<String>,
}

/// Projects one complete zone read. There is no documented pagination: the response is the zone.
pub(super) fn accept(zone: &str, body: &[u8]) -> Result<PorkbunDnsZone, PorkbunError> {
    let invalid = PorkbunError::ProtocolRejected;
    let page: RecordsWire = serde_json::from_slice(body).map_err(|_| invalid)?;
    if page.status != "SUCCESS"
        || page.records.len() > MAX_DNS_RECORDS
        || page.warnings.as_ref().is_some_and(|warnings| {
            warnings.is_empty()
                || warnings.len() > 16
                || warnings.iter().any(|value| !bounded_text(value, 2048))
        })
    {
        return Err(invalid);
    }
    // The proxy flag only says whether Porkbun's Cloudflare proxy fronts the domain; it is
    // validated as the documented enum and not carried further.
    let _ = page.cloudflare;
    let mut ids = BTreeSet::new();
    let mut tuples = BTreeSet::new();
    let mut records = Vec::with_capacity(page.records.len());
    for row in page.records {
        let record = row.project(zone)?;
        if !ids.insert(record.record_id.clone())
            || !tuples.insert((
                record.record_type.as_str(),
                record.owner_name_ascii.clone(),
                record.content.clone(),
                record.priority,
            ))
        {
            return Err(invalid);
        }
        records.push(record);
    }
    Ok(PorkbunDnsZone::Records {
        records,
        // `GoodDealer` inference: any warning means this zone may not be what resolves. Only that
        // bit crosses the Native boundary; the text never does.
        answered_elsewhere: page.warnings.is_some(),
    })
}

/// Maps one response: 400 carries a documented error body; every other status goes through the
/// shared status classes before records are parsed. `observe()` also checks non-400 statuses
/// before reading the body, so an error page stays a status error.
pub(super) fn classify(
    status: reqwest::StatusCode,
    zone: &str,
    body: &[u8],
) -> Result<PorkbunDnsZone, PorkbunError> {
    if status == reqwest::StatusCode::BAD_REQUEST {
        return rejection(body);
    }
    super::status_class(status)?;
    accept(zone, body)
}

/// Maps a documented HTTP 400 body (a `GoodDealer` mapping of the global code table). Domain states
/// the account holder controls become outcomes, request-shape errors are `GoodDealer` defects, and
/// any other or missing code fails closed as needing the account holder.
pub(super) fn rejection(body: &[u8]) -> Result<PorkbunDnsZone, PorkbunError> {
    #[derive(Deserialize)]
    struct ErrorWire {
        status: String,
        code: Option<String>,
    }
    let error: ErrorWire =
        serde_json::from_slice(body).map_err(|_| PorkbunError::ProtocolRejected)?;
    if error.status != "ERROR" {
        return Err(PorkbunError::ProtocolRejected);
    }
    match error.code.as_deref() {
        Some("API_ACCESS_DISABLED") => Ok(PorkbunDnsZone::ApiAccessDisabled),
        Some("INVALID_DOMAIN" | "DOMAIN_NOT_FOUND") => Ok(PorkbunDnsZone::NotInAccount),
        Some("DOMAIN_NOT_ACTIVE") => Ok(PorkbunDnsZone::DomainNotActive),
        Some(
            "INVALID_PROTOCOL"
            | "METHOD_NOT_ALLOWED"
            | "INVALID_OR_EMPTY_JSON"
            | "MISSING_PARAMETER"
            | "INVALID_INPUT",
        ) => Err(PorkbunError::ProtocolRejected),
        _ => Err(PorkbunError::AuthenticationRequired),
    }
}

impl RecordWire {
    fn project(self, zone: &str) -> Result<PorkbunDnsRecord, PorkbunError> {
        let invalid = PorkbunError::ProtocolRejected;
        let record_type = PorkbunDnsRecordType::parse(&self.record_type).ok_or(invalid)?;
        let owner_name_ascii = self.name.to_ascii_lowercase();
        let relative = owner_name_ascii
            .strip_suffix(zone)
            .and_then(|prefix| {
                if prefix.is_empty() {
                    Some("")
                } else {
                    // `.example.com` would leave an empty label; only a non-empty prefix counts.
                    prefix.strip_suffix('.').filter(|label| !label.is_empty())
                }
            })
            .ok_or(invalid)?;
        let priority = match self.prio.as_deref() {
            None => None,
            Some(value) => Some(
                decimal(value)
                    .and_then(|n| u16::try_from(n).ok())
                    .ok_or(invalid)?,
            ),
        };
        let ttl_seconds = decimal(&self.ttl)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|ttl| (1..=2_147_483_647).contains(ttl))
            .ok_or(invalid)?;
        if !(relative.is_empty() || relative_name(relative))
            || owner_name_ascii.len() > 253
            || !(1..=20).contains(&self.id.len())
            || !self.id.bytes().all(|byte| byte.is_ascii_digit())
            || self.content.is_empty()
            || !bounded_text(&self.content, 4096)
            || self
                .notes
                .as_deref()
                .is_some_and(|notes| notes.len() > 4096)
        {
            return Err(invalid);
        }
        Ok(PorkbunDnsRecord {
            record_id: self.id,
            owner_name_ascii,
            record_type,
            content: self.content,
            ttl_seconds,
            priority,
        })
    }
}

/// `ttl`, `prio` and `id` are documented as strings; only plain decimal digits are accepted.
fn decimal(value: &str) -> Option<u64> {
    if value.is_empty() || value.len() > 10 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if value.len() > 1 && value.starts_with('0') {
        return None;
    }
    value.parse().ok()
}

fn relative_name(value: &str) -> bool {
    value.split('.').enumerate().all(|(index, label)| {
        (index == 0 && label == "*")
            || ((1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || byte == b'-'
                        || byte == b'_'
                }))
    })
}

fn bounded_text(value: &str, max: usize) -> bool {
    value.len() <= max && !value.chars().any(char::is_control)
}

/// The zone path segment must be a canonical A-label host.
pub(super) fn canonical_zone(value: &str) -> Option<String> {
    let zone = value.to_ascii_lowercase();
    (zone.len() <= 253
        && zone.contains('.')
        && zone.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        && matches!(Host::parse(&zone), Ok(Host::Domain(ascii)) if ascii == zone))
    .then_some(zone)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn record(id: &str, name: &str, kind: &str, content: &str) -> Value {
        json!({"id": id, "name": name, "type": kind, "content": content, "ttl": "600", "prio": null, "notes": null})
    }

    fn body(records: &[Value]) -> Vec<u8> {
        serde_json::to_vec(&json!({"status":"SUCCESS","cloudflare":"disabled","records":records}))
            .unwrap()
    }

    #[test]
    fn projects_the_documented_string_fields_and_drops_notes() {
        let mut mx = record("2", "example.com", "MX", "mail.example.com");
        mx["prio"] = json!("10");
        mx["notes"] = json!("private note");
        let rows = [
            record("1", "WWW.example.com", "A", "192.0.2.1"),
            mx,
            record("3", "_dmarc.example.com", "TXT", "v=DMARC1; p=none"),
        ];
        let PorkbunDnsZone::Records {
            records,
            answered_elsewhere,
        } = accept("example.com", &body(&rows)).unwrap()
        else {
            panic!("records expected");
        };
        assert!(!answered_elsewhere);
        assert_eq!(records[0].owner_name_ascii, "www.example.com");
        assert_eq!(records[1].priority, Some(10));
        assert_eq!(records[1].record_type, PorkbunDnsRecordType::MX);
        assert_eq!(records[2].ttl_seconds, 600);
        let printed = format!("{records:?}");
        assert!(!printed.contains("private note") && !printed.contains("192.0.2.1"));
        let mut warned: Value = serde_json::from_slice(&body(&[])).unwrap();
        warned["warnings"] = json!(["ns1.elsewhere.example answers for this domain"]);
        assert_eq!(
            accept("example.com", &serde_json::to_vec(&warned).unwrap()).unwrap(),
            PorkbunDnsZone::Records {
                records: Vec::new(),
                answered_elsewhere: true
            }
        );
    }

    #[test]
    fn rejects_malformed_records_duplicates_and_oversized_zones() {
        for (field, value) in [
            ("ttl", json!(600)),
            ("ttl", json!("0600")),
            ("ttl", json!("")),
            ("prio", json!("70000")),
            ("prio", json!(10)),
            ("type", json!("PTR")),
            ("name", json!("www.other.com")),
            ("name", json!("wwwexample.com")),
            ("name", json!("bad name.example.com")),
            ("id", json!("abc")),
            ("content", json!("")),
            ("content", json!("a\nb")),
            ("extra", json!(true)),
        ] {
            let mut row = record("1", "www.example.com", "A", "192.0.2.1");
            row[field] = value;
            assert!(accept("example.com", &body(&[row])).is_err(), "{field}");
        }
        let mut missing = record("1", "www.example.com", "A", "192.0.2.1");
        missing.as_object_mut().unwrap().remove("ttl");
        assert!(accept("example.com", &body(&[missing])).is_err());
        let a = record("1", "www.example.com", "A", "192.0.2.1");
        assert!(accept("example.com", &body(&[a.clone(), a.clone()])).is_err());
        let same = record("2", "www.example.com", "A", "192.0.2.1");
        assert!(accept("example.com", &body(&[a, same])).is_err());
        let many: Vec<Value> = (0..=MAX_DNS_RECORDS)
            .map(|n| {
                record(
                    &(n + 1).to_string(),
                    &format!("h{n}.example.com"),
                    "A",
                    "192.0.2.1",
                )
            })
            .collect();
        assert!(accept("example.com", &body(&many)).is_err());
        for page in [
            json!({"status":"ERROR","records":[]}),
            json!({"status":"SUCCESS"}),
            json!({"status":"SUCCESS","records":[],"cloudflare":"maybe"}),
            json!({"status":"SUCCESS","records":[],"warnings":[]}),
            json!({"status":"SUCCESS","records":[],"account":"private"}),
        ] {
            assert!(accept("example.com", &serde_json::to_vec(&page).unwrap()).is_err());
        }
    }

    #[test]
    fn accepts_apex_wildcard_zero_priority_and_the_exact_bound() {
        let mut apex = record("1", "example.com", "TXT", "v=spf1 -all");
        apex["prio"] = json!("0");
        let wildcard = record("2", "*.example.com", "A", "192.0.2.1");
        let PorkbunDnsZone::Records { records, .. } =
            accept("example.com", &body(&[apex, wildcard])).unwrap()
        else {
            panic!("records expected");
        };
        assert_eq!(records[0].priority, Some(0));
        assert_eq!(records[1].owner_name_ascii, "*.example.com");
        let full: Vec<Value> = (0..MAX_DNS_RECORDS)
            .map(|n| {
                record(
                    &(n + 1).to_string(),
                    &format!("h{n}.example.com"),
                    "A",
                    "192.0.2.1",
                )
            })
            .collect();
        assert!(accept("example.com", &body(&full)).is_ok());
        for name in ["www.*.example.com", "www.example.com.", "", ".example.com"] {
            let row = record("1", name, "A", "192.0.2.1");
            assert!(accept("example.com", &body(&[row])).is_err(), "{name}");
        }
    }

    #[test]
    fn classifies_status_and_body_together() {
        use reqwest::StatusCode;
        let ok = body(&[record("1", "www.example.com", "A", "192.0.2.1")]);
        assert!(matches!(
            classify(StatusCode::OK, "example.com", &ok),
            Ok(PorkbunDnsZone::Records { .. })
        ));
        let disabled = br#"{"status":"ERROR","message":"m","code":"API_ACCESS_DISABLED"}"#;
        assert_eq!(
            classify(StatusCode::BAD_REQUEST, "example.com", disabled),
            Ok(PorkbunDnsZone::ApiAccessDisabled)
        );
        for (status, expected) in [
            (StatusCode::FORBIDDEN, PorkbunError::AuthenticationRequired),
            (StatusCode::TOO_MANY_REQUESTS, PorkbunError::RateLimited),
            (StatusCode::INTERNAL_SERVER_ERROR, PorkbunError::Unavailable),
            (StatusCode::NOT_FOUND, PorkbunError::ProtocolRejected),
        ] {
            assert_eq!(classify(status, "example.com", &ok), Err(expected));
        }
    }

    #[test]
    fn maps_documented_rejections_without_keeping_their_text() {
        let error = |code: &str| {
            serde_json::to_vec(
                &json!({"status":"ERROR","message":"text","code":code,"account":"someone"}),
            )
            .unwrap()
        };
        assert_eq!(
            rejection(&error("API_ACCESS_DISABLED")),
            Ok(PorkbunDnsZone::ApiAccessDisabled)
        );
        assert_eq!(
            rejection(&error("INVALID_DOMAIN")),
            Ok(PorkbunDnsZone::NotInAccount)
        );
        assert_eq!(
            rejection(&error("DOMAIN_NOT_FOUND")),
            Ok(PorkbunDnsZone::NotInAccount)
        );
        assert_eq!(
            rejection(&error("DOMAIN_NOT_ACTIVE")),
            Ok(PorkbunDnsZone::DomainNotActive)
        );
        assert_eq!(
            rejection(&error("MISSING_PARAMETER")),
            Err(PorkbunError::ProtocolRejected)
        );
        assert_eq!(
            rejection(br#"{"status":"ERROR","message":"no code"}"#),
            Err(PorkbunError::AuthenticationRequired)
        );
        assert_eq!(
            rejection(&error("INVALID_INPUT")),
            Err(PorkbunError::ProtocolRejected)
        );
        assert_eq!(
            rejection(&error("INVALID_USER")),
            Err(PorkbunError::AuthenticationRequired)
        );
        assert_eq!(
            rejection(br#"{"status":"SUCCESS"}"#),
            Err(PorkbunError::ProtocolRejected)
        );
        assert_eq!(rejection(b"<html>"), Err(PorkbunError::ProtocolRejected));
        assert_eq!(
            canonical_zone("Example.COM").as_deref(),
            Some("example.com")
        );
        for zone in ["localhost", "example.com/../x", "", "exa mple.com"] {
            assert!(canonical_zone(zone).is_none(), "{zone}");
        }
    }
}
