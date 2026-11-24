use std::collections::BTreeSet;

use serde::Deserialize;
use url::Url;

use super::registrar_wire::{LinkWire, bounded_text, valid_hostname};
use super::{
    DNS_PAGE_SIZE, GoDaddyDnsRecord, GoDaddyDnsRecordType, GoDaddyError, MAX_DNS_RECORDS, ORIGIN,
    dns_records_path,
};

/// `DNSRecords` in Domains v3.1.0. `totalRequired=true` is always sent, so totals are present
/// exactly when the zone has at least one record.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DnsRecordsPage {
    items: Vec<RecordWire>,
    total_items: Option<u64>,
    total_pages: Option<u64>,
    links: Vec<LinkWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordWire {
    record_id: Option<String>,
    name: String,
    #[serde(rename = "type")]
    record_type: RecordTypeWire,
    data: String,
    ttl: u32,
    priority: Option<u16>,
    service: Option<String>,
    port: Option<u16>,
    weight: Option<u16>,
    protocol: Option<String>,
    flag: Option<u8>,
    tag: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[allow(clippy::upper_case_acronyms)]
enum RecordTypeWire {
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

pub(super) struct ZoneScan {
    zone: String,
    page: u64,
    totals: Option<(u64, u64)>,
    record_ids: BTreeSet<String>,
    record_tuples: BTreeSet<String>,
    records: Vec<GoDaddyDnsRecord>,
}

impl ZoneScan {
    pub(super) const fn new(zone: String) -> Self {
        Self {
            zone,
            page: 1,
            totals: None,
            record_ids: BTreeSet::new(),
            record_tuples: BTreeSet::new(),
            records: Vec::new(),
        }
    }

    /// Accepts the current one-based page and reports whether the documented `next` link asks
    /// for the following page. The link is checked, never followed: the next request is rebuilt
    /// from the fixed origin, zone and page number.
    pub(super) fn accept(&mut self, body: &[u8]) -> Result<bool, GoDaddyError> {
        let invalid = GoDaddyError::ProtocolRejected;
        let page: DnsRecordsPage = serde_json::from_slice(body).map_err(|_| invalid)?;
        if page.items.len() > DNS_PAGE_SIZE || page.links.len() > 16 {
            return Err(invalid);
        }
        self.accept_totals(page.items.is_empty(), page.total_items, page.total_pages)?;
        let more = self.accept_links(&page.links)?;
        for row in page.items {
            let record = row.project(&self.zone)?;
            if record
                .record_id
                .as_ref()
                .is_some_and(|id| !self.record_ids.insert(id.clone()))
                || !self.record_tuples.insert(record.tuple())
            {
                return Err(invalid);
            }
            self.records.push(record);
        }
        let (total_items, total_pages) = self.totals.unwrap_or((0, 1));
        let seen = self.records.len() as u64;
        // GoodDealer choice, not a documented rule: `pageSize` is only a maximum, but with page
        // offsets a short non-final page would skip records, so it is refused. The final page
        // must close both documented totals.
        if (more && (seen != self.page * DNS_PAGE_SIZE as u64 || self.page >= total_pages))
            || (!more && (seen != total_items || self.page != total_pages))
        {
            return Err(invalid);
        }
        self.page += 1;
        Ok(more)
    }

    pub(super) fn into_records(self) -> Vec<GoDaddyDnsRecord> {
        self.records
    }

    fn accept_totals(
        &mut self,
        empty: bool,
        items: Option<u64>,
        pages: Option<u64>,
    ) -> Result<(), GoDaddyError> {
        let invalid = GoDaddyError::ProtocolRejected;
        match (empty, items, pages) {
            // Only the first page of an empty zone may omit totals.
            (true, None, None) if self.page == 1 => Ok(()),
            (false, Some(items), Some(pages)) => {
                if items == 0
                    || items > MAX_DNS_RECORDS as u64
                    || pages != items.div_ceil(DNS_PAGE_SIZE as u64)
                    || self.totals.is_some_and(|totals| totals != (items, pages))
                {
                    return Err(invalid);
                }
                self.totals = Some((items, pages));
                Ok(())
            }
            _ => Err(invalid),
        }
    }

    fn accept_links(&self, links: &[LinkWire]) -> Result<bool, GoDaddyError> {
        let invalid = GoDaddyError::ProtocolRejected;
        let mut rels = BTreeSet::new();
        for link in links {
            link.validate()?;
            if !matches!(
                link.rel.as_str(),
                "self" | "next" | "prev" | "first" | "last"
            ) || !rels.insert(link.rel.as_str())
            {
                return Err(invalid);
            }
            if link.rel == "next" {
                self.validate_next(link)?;
            }
        }
        Ok(rels.contains("next"))
    }

    fn validate_next(&self, link: &LinkWire) -> Result<(), GoDaddyError> {
        let invalid = GoDaddyError::ProtocolRejected;
        if link.method.as_deref().is_some_and(|method| method != "GET") {
            return Err(invalid);
        }
        let href = if link.href.starts_with('/') && !link.href.starts_with("//") {
            format!("{ORIGIN}{}", link.href)
        } else {
            link.href.clone()
        };
        let url = Url::parse(&href).map_err(|_| invalid)?;
        if url.origin().ascii_serialization() != ORIGIN
            || url.path() != dns_records_path(&self.zone)?
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid);
        }
        let (mut page, mut size, mut total) = (false, false, false);
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "page" if !page && value.parse::<u64>() == Ok(self.page + 1) => page = true,
                "pageSize" if !size && value.parse::<usize>() == Ok(DNS_PAGE_SIZE) => size = true,
                "totalRequired" if !total && value == "true" => total = true,
                _ => return Err(invalid),
            }
        }
        if page { Ok(()) } else { Err(invalid) }
    }
}

impl RecordWire {
    fn project(self, zone: &str) -> Result<GoDaddyDnsRecord, GoDaddyError> {
        let invalid = GoDaddyError::ProtocolRejected;
        let record_type = match self.record_type {
            RecordTypeWire::A => GoDaddyDnsRecordType::A,
            RecordTypeWire::AAAA => GoDaddyDnsRecordType::AAAA,
            RecordTypeWire::CNAME => GoDaddyDnsRecordType::CNAME,
            RecordTypeWire::MX => GoDaddyDnsRecordType::MX,
            RecordTypeWire::TXT => GoDaddyDnsRecordType::TXT,
            RecordTypeWire::NS => GoDaddyDnsRecordType::NS,
            RecordTypeWire::SRV => GoDaddyDnsRecordType::SRV,
            RecordTypeWire::SOA => GoDaddyDnsRecordType::SOA,
            RecordTypeWire::CAA => GoDaddyDnsRecordType::CAA,
        };
        let name = self.name.to_ascii_lowercase();
        let owner_name_ascii = if name == "@" {
            zone.to_owned()
        } else if relative_name(&name) {
            format!("{name}.{zone}")
        } else {
            return Err(invalid);
        };
        if owner_name_ascii.len() > 253
            // `maxLength` 512 counts characters; control characters are a GoodDealer refusal.
            || self.data.chars().count() > 512
            || !bounded_text(&self.data, 512 * 4)
            || !(600..=86_400).contains(&self.ttl)
            || self
                .record_id
                .as_deref()
                .is_some_and(|id| id.len() > 256 || !id.bytes().all(|b| b.is_ascii_graphic()))
            || !self.type_fields_match(record_type)
        {
            return Err(invalid);
        }
        Ok(GoDaddyDnsRecord {
            record_id: self.record_id,
            owner_name_ascii,
            record_type,
            data: self.data,
            ttl_seconds: self.ttl,
            priority: self.priority,
            weight: self.weight,
            port: self.port,
            service: self.service,
            protocol: self.protocol,
            flag: self.flag,
            tag: self.tag,
        })
    }

    /// The schema documents priority for MX/SRV, service/protocol/port/weight for SRV and
    /// flag/tag for CAA. `GoodDealer` requires the value-bearing ones for their type and refuses
    /// them on any other type: a fail-closed reading, not a documented platform rule.
    fn type_fields_match(&self, record_type: GoDaddyDnsRecordType) -> bool {
        let srv_label = |value: &Option<String>| {
            value.as_deref().is_none_or(|label| {
                label.len() <= 63
                    && label.strip_prefix('_').is_some_and(|rest| {
                        !rest.is_empty()
                            && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    })
            })
        };
        let srv_only = self.service.is_none()
            && self.protocol.is_none()
            && self.port.is_none()
            && self.weight.is_none();
        let caa_only = self.flag.is_none() && self.tag.is_none();
        match record_type {
            GoDaddyDnsRecordType::MX => self.priority.is_some() && srv_only && caa_only,
            GoDaddyDnsRecordType::SRV => {
                self.priority.is_some()
                    && self.weight.is_some()
                    && self.port.is_some()
                    && srv_label(&self.service)
                    && srv_label(&self.protocol)
                    && caa_only
            }
            GoDaddyDnsRecordType::CAA => {
                self.flag.is_some()
                    && self.tag.as_deref().is_some_and(|tag| {
                        (1..=15).contains(&tag.len())
                            && tag.bytes().all(|b| b.is_ascii_alphanumeric())
                    })
                    && self.priority.is_none()
                    && srv_only
            }
            _ => self.priority.is_none() && srv_only && caa_only,
        }
    }
}

impl GoDaddyDnsRecord {
    /// The full record identity. RFC 2181 forbids identical records in one `RRset`, so a repeat
    /// means the provider listed the same record twice.
    fn tuple(&self) -> String {
        format!(
            "{}\0{}\0{}\0{:?}\0{:?}\0{:?}\0{:?}\0{:?}\0{:?}\0{:?}",
            self.record_type.as_str(),
            self.owner_name_ascii,
            self.data,
            self.priority,
            self.weight,
            self.port,
            self.service,
            self.protocol,
            self.flag,
            self.tag,
        )
    }
}

/// A host name relative to the zone apex: lowercase LDH labels, `_` for service labels, and a
/// leading `*` wildcard label.
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

/// The zone path segment must be a canonical A-label host; IDNs arrive already in punycode.
pub(super) fn canonical_zone(value: &str) -> Option<String> {
    let zone = value.to_ascii_lowercase();
    valid_hostname(&zone).then_some(zone)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn record(name: &str, kind: &str, data: &str) -> Value {
        json!({"name": name, "type": kind, "data": data, "ttl": 3600})
    }

    fn next(page: u64) -> Value {
        json!({"rel":"next","href":format!(
            "/v3/domains/zones/example.com/dns-records?page={page}&pageSize=100&totalRequired=true"
        )})
    }

    fn body(items: &[Value], totals: Option<(u64, u64)>, links: &[Value]) -> Vec<u8> {
        let mut page = json!({"items": items, "links": links});
        if let Some((items, pages)) = totals {
            page["totalItems"] = json!(items);
            page["totalPages"] = json!(pages);
        }
        serde_json::to_vec(&page).unwrap()
    }

    #[test]
    fn reads_every_page_and_projects_owner_names() {
        let mut scan = ZoneScan::new("example.com".into());
        let full: Vec<Value> = (0..DNS_PAGE_SIZE)
            .map(|n| record(&format!("h{n}"), "A", "192.0.2.1"))
            .collect();
        let self_link = json!({"rel":"self","href":"https://api.godaddy.com/v3/domains/zones/example.com/dns-records?page=1"});
        assert!(
            scan.accept(&body(&full, Some((102, 2)), &[self_link, next(2)]))
                .unwrap()
        );
        let mut mx = record("@", "MX", "mail.example.com");
        mx["priority"] = json!(10);
        mx["recordId"] = json!("rec_a1b2c3d4");
        let mut caa = record("*.Shop", "CAA", "letsencrypt.org");
        caa["flag"] = json!(0);
        caa["tag"] = json!("issue");
        assert!(!scan.accept(&body(&[mx, caa], Some((102, 2)), &[])).unwrap());
        let rows = scan.into_records();
        assert_eq!(rows.len(), 102);
        assert_eq!(rows[100].owner_name_ascii, "example.com");
        assert_eq!(rows[100].priority, Some(10));
        assert_eq!(rows[100].record_id.as_deref(), Some("rec_a1b2c3d4"));
        assert_eq!(rows[101].owner_name_ascii, "*.shop.example.com");
        assert_eq!(rows[101].record_type, GoDaddyDnsRecordType::CAA);
        assert!(!format!("{:?}", rows[0]).contains("192.0.2.1"));
        let mut empty = ZoneScan::new("example.com".into());
        assert!(!empty.accept(br#"{"items":[],"links":[]}"#).unwrap());
        assert_eq!(empty.into_records(), Vec::new());
    }

    #[test]
    fn accepts_the_official_link_shape_and_the_local_record_bound() {
        let absolute = |page: u64| {
            format!(
                "https://api.godaddy.com/v3/domains/zones/example.com/dns-records?page={page}&pageSize=100&totalRequired=true"
            )
        };
        let mut scan = ZoneScan::new("example.com".into());
        for page in 1..=10_u64 {
            let rows: Vec<Value> = (0..DNS_PAGE_SIZE)
                .map(|n| record(&format!("p{page}n{n}"), "TXT", "v"))
                .collect();
            let links = [
                json!({"rel":"self","href":absolute(page),"method":"GET"}),
                json!({"rel":"first","href":absolute(1)}),
                json!({"rel":"last","href":absolute(11)}),
                json!({"rel":"next","href":absolute(page + 1),"method":"GET"}),
            ];
            assert!(scan.accept(&body(&rows, Some((1024, 11)), &links)).unwrap());
        }
        let tail: Vec<Value> = (0..24)
            .map(|n| record(&format!("t{n}"), "A", "192.0.2.1"))
            .collect();
        let prev = json!({"rel":"prev","href":absolute(10)});
        assert!(
            !scan
                .accept(&body(&tail, Some((1024, 11)), &[prev]))
                .unwrap()
        );
        assert_eq!(scan.into_records().len(), MAX_DNS_RECORDS);
        let one = [record("@", "A", "192.0.2.1")];
        assert!(
            ZoneScan::new("example.com".into())
                .accept(&body(&one, Some((1025, 11)), &[]))
                .is_err()
        );
        let mut long = record("@", "TXT", &"é".repeat(512));
        assert!(
            ZoneScan::new("example.com".into())
                .accept(&body(std::slice::from_ref(&long), Some((1, 1)), &[]))
                .is_ok()
        );
        long["data"] = json!("é".repeat(513));
        assert!(
            ZoneScan::new("example.com".into())
                .accept(&body(&[long], Some((1, 1)), &[]))
                .is_err()
        );
    }

    #[test]
    fn rejects_unsafe_or_inconsistent_pagination() {
        let one = [record("@", "A", "192.0.2.1")];
        let full: Vec<Value> = (0..DNS_PAGE_SIZE)
            .map(|n| record(&format!("h{n}"), "TXT", "v"))
            .collect();
        for href in [
            "https://elsewhere.net/v3/domains/zones/example.com/dns-records?page=2",
            "/v3/domains/zones/other.com/dns-records?page=2",
            "/v3/domains/zones/example.com/dns-records?page=3",
            "/v3/domains/zones/example.com/dns-records?page=2&type=A",
            "/v3/domains/zones/example.com/dns-records?page=2&pageSize=25",
            "/v3/domains/zones/example.com/dns-records?pageSize=100",
            "/v3/domains/zones/example.com/dns-records?page=2#x",
            "https://api.godaddy.com:8443/v3/domains/zones/example.com/dns-records?page=2",
        ] {
            let link = json!({"rel":"next","href":href});
            assert!(
                ZoneScan::new("example.com".into())
                    .accept(&body(&full, Some((101, 2)), &[link]))
                    .is_err(),
                "{href}"
            );
        }
        for page in [
            body(&one, None, &[]),
            body(&one, Some((2, 1)), &[]),
            body(&one, Some((1, 2)), &[]),
            body(&one, Some((1, 1)), &[next(2)]),
            body(&full, Some((2000, 20)), &[next(2)]),
            body(&full, Some((100, 1)), &[next(2)]),
            body(&[], Some((1, 1)), &[]),
            body(&one, Some((1, 1)), &[json!({"rel":"alternate","href":"/"})]),
            br#"{"items":[],"links":[],"zoneId":"private"}"#.to_vec(),
        ] {
            assert!(ZoneScan::new("example.com".into()).accept(&page).is_err());
        }
        let mut post = next(2);
        post["method"] = json!("POST");
        assert!(
            ZoneScan::new("example.com".into())
                .accept(&body(&full, Some((101, 2)), &[post]))
                .is_err()
        );
        let mut scan = ZoneScan::new("example.com".into());
        scan.accept(&body(&full, Some((101, 2)), &[next(2)]))
            .unwrap();
        assert!(scan.accept(&body(&one, Some((102, 2)), &[])).is_err());
        let mut scan = ZoneScan::new("example.com".into());
        scan.accept(&body(&full, Some((101, 2)), &[next(2)]))
            .unwrap();
        assert!(scan.accept(&body(&[], None, &[])).is_err());
    }

    #[test]
    fn rejects_malformed_records_and_duplicates() {
        let mut cases = Vec::new();
        for (field, value) in [
            ("ttl", json!(300)),
            ("ttl", json!(86_401)),
            ("type", json!("PTR")),
            ("name", json!("bad name")),
            ("name", json!("www.")),
            ("name", json!("a.*")),
            ("data", json!("")),
            ("data", json!("line\nbreak")),
            ("priority", json!(10)),
            ("flag", json!(0)),
            ("recordId", json!("has space")),
            ("comment", json!("private")),
        ] {
            let mut row = record("www", "A", "192.0.2.1");
            row[field] = value;
            cases.push(row);
        }
        cases.push(record("@", "MX", "mail.example.com"));
        let mut srv = record("@", "SRV", "sip.example.com");
        srv["priority"] = json!(1);
        srv["port"] = json!(5060);
        cases.push(srv.clone());
        srv["weight"] = json!(5);
        srv["service"] = json!("sip");
        cases.push(srv);
        let mut caa = record("@", "CAA", "ca.example");
        caa["flag"] = json!(0);
        caa["tag"] = json!("is sue");
        cases.push(caa);
        for row in cases {
            assert!(
                ZoneScan::new("example.com".into())
                    .accept(&body(std::slice::from_ref(&row), Some((1, 1)), &[]))
                    .is_err(),
                "{row}"
            );
        }
        let a = record("www", "A", "192.0.2.1");
        assert!(
            ZoneScan::new("example.com".into())
                .accept(&body(&[a.clone(), a], Some((2, 1)), &[]))
                .is_err()
        );
        let mut first = record("a", "A", "192.0.2.1");
        first["recordId"] = json!("same");
        let mut second = record("b", "A", "192.0.2.2");
        second["recordId"] = json!("same");
        assert!(
            ZoneScan::new("example.com".into())
                .accept(&body(&[first, second], Some((2, 1)), &[]))
                .is_err()
        );
    }
}
