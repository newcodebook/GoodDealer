use super::{AliyunError, AliyunRegistration, MAX_REGISTRATIONS, PAGE_SIZE};
use serde::{Deserialize, Deserializer};
use std::collections::BTreeSet;
use time::OffsetDateTime;
use zeroize::Zeroizing;

#[derive(Default)]
pub(super) struct InventoryScan {
    pages_read: usize,
    snapshot: Option<PageShape>,
    requests: BTreeSet<String>,
    names: BTreeSet<String>,
    registrations: Vec<AliyunRegistration>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct PageShape {
    total: usize,
    page_size: usize,
    page_count: usize,
    first_page_echo: usize,
}

impl InventoryScan {
    pub(super) const fn next_page(&self) -> usize {
        self.pages_read + 1
    }

    pub(super) fn accept(&mut self, body: &[u8]) -> Result<bool, AliyunError> {
        let invalid = AliyunError::ProtocolRejected;
        // The official request example starts at one. The response example echoes zero on
        // the first page. Pin the returned convention for the entire scan.
        let page: ScanPageWire = serde_json::from_slice(body).map_err(|_| invalid)?;
        let first_page_echo = self
            .snapshot
            .map_or(page.current_page_num, |s| s.first_page_echo);
        let shape = PageShape {
            total: page.total_item_num,
            page_size: page.page_size,
            page_count: page.total_page_num,
            first_page_echo,
        };
        if first_page_echo > 1
            || shape.total > MAX_REGISTRATIONS
            || !(1..=PAGE_SIZE).contains(&shape.page_size)
            || self.snapshot.is_some_and(|initial| initial != shape)
            || page.current_page_num != self.pages_read + first_page_echo
        {
            return Err(invalid);
        }
        let calculated = shape.total.div_ceil(shape.page_size);
        let exact_count =
            calculated == shape.page_count || (shape.total == 0 && shape.page_count == 1);
        let ordinal = self.next_page();
        let more = ordinal < shape.page_count;
        let received = self.registrations.len();
        if !exact_count
            || ordinal > shape.page_count.max(1)
            || page.pre_page != (ordinal > 1)
            || page.next_page != more
            || received > shape.total
            || page.data.domain.len() != (shape.total - received).min(shape.page_size)
            || !uuid_shaped(&page.request_id)
            || !self.requests.insert(page.request_id.to_ascii_lowercase())
        {
            return Err(invalid);
        }
        self.snapshot = Some(shape);
        self.pages_read += 1;
        for domain in page.data.domain {
            let fact = domain.project()?;
            if !self.names.insert(fact.domain.clone()) {
                return Err(invalid);
            }
            self.registrations.push(fact);
        }
        Ok(!more)
    }

    pub(super) fn into_registrations(mut self) -> Vec<AliyunRegistration> {
        self.registrations
            .sort_unstable_by(|a, b| a.domain.cmp(&b.domain));
        self.registrations
    }
}

fn uuid_shaped(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
struct ScanPageWire {
    pre_page: bool,
    current_page_num: usize,
    request_id: String,
    page_size: usize,
    total_page_num: usize,
    data: Domains,
    total_item_num: usize,
    next_page: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
struct Domains {
    domain: Vec<RegistrationWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
struct RegistrationWire {
    domain_name: String,
    registration_date_long: i64,
    expiration_date_long: i64,
    domain_status: CatalogCode,
    expiration_date_status: CatalogCode,
    auto_renew_enabled: Option<bool>,
    // Documented Native fields excluded from the projection. The wire still checks their types
    // and rejects unknown keys, including within tag and DNS wrappers.
    #[serde(rename = "DomainAuditStatus")]
    _domain_audit_status: Option<AuditStatus>,
    #[serde(rename = "DomainGroupId")]
    _domain_group_id: Option<CatalogCode>,
    #[serde(rename = "Remark")]
    _remark: Option<NativeText>,
    #[serde(rename = "DomainGroupName")]
    _domain_group_name: Option<NativeText>,
    #[serde(rename = "RegistrationDate")]
    _registration_date: Option<NativeText>,
    #[serde(rename = "InstanceId")]
    _instance_id: Option<NativeText>,
    #[serde(rename = "ExpirationDate")]
    _expiration_date: Option<NativeText>,
    #[serde(rename = "RegistrantType")]
    _registrant_type: Option<CatalogCode>,
    #[serde(rename = "ExpirationCurrDateDiff")]
    _expiration_curr_date_diff: Option<i32>,
    #[serde(rename = "Premium")]
    _premium: Option<bool>,
    #[serde(rename = "ProductId")]
    _product_id: Option<NativeText>,
    #[serde(rename = "DomainType")]
    _domain_type: Option<NativeText>,
    #[serde(rename = "ResourceGroupId")]
    _resource_group_id: Option<NativeText>,
    #[serde(rename = "Tag")]
    _tag: Option<Tags>,
    #[serde(rename = "Ccompany")]
    _ccompany: Option<NativeText>,
    #[serde(rename = "ChgholderStatus")]
    _chgholder_status: Option<CatalogCode>,
    #[serde(rename = "Registrar")]
    _registrar: Option<NativeText>,
    #[serde(rename = "DnsList")]
    _dns_list: Option<DnsList>,
}

impl RegistrationWire {
    fn project(self) -> Result<AliyunRegistration, AliyunError> {
        let invalid = AliyunError::ProtocolRejected;
        let domain = canonical_domain(&self.domain_name).ok_or(invalid)?;
        let registered = date(self.registration_date_long).ok_or(invalid)?;
        let expires = date(self.expiration_date_long).ok_or(invalid)?;
        let active = match (
            self.domain_status.value(),
            self.expiration_date_status.value(),
        ) {
            (Some(1 | 3), Some(1)) => true,
            (Some(1..=3), Some(2)) => false,
            _ => return Err(invalid),
        };
        if expires < registered {
            return Err(invalid);
        }
        Ok(AliyunRegistration {
            domain,
            registered_on: registered.date().to_string(),
            expires_on: expires.date().to_string(),
            auto_renew: self.auto_renew_enabled,
            active,
        })
    }
}

fn date(milliseconds: i64) -> Option<OffsetDateTime> {
    let date =
        OffsetDateTime::from_unix_timestamp_nanos(i128::from(milliseconds) * 1_000_000).ok()?;
    (1..=9999).contains(&date.year()).then_some(date)
}

fn canonical_domain(value: &str) -> Option<String> {
    if value.len() > 1024
        || value.contains(['%', '/', '\\', '@', '?', '#', ':'])
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return None;
    }
    let url::Host::Domain(name) = url::Host::parse(value).ok()? else {
        return None;
    };
    if name.len() > 253
        || !name.contains('.')
        || !name.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return None;
    }
    Some(name)
}

// The SDK declares string codes and the official sample includes JSON numbers.
#[derive(Deserialize)]
#[serde(untagged)]
enum CatalogCode {
    Number(u64),
    Text(NativeText),
}

impl CatalogCode {
    fn value(&self) -> Option<u64> {
        match self {
            Self::Number(code) => Some(*code),
            Self::Text(code) if code.0.len() == 1 && code.0.as_bytes()[0].is_ascii_digit() => {
                Some(u64::from(code.0.as_bytes()[0] - b'0'))
            }
            Self::Text(_) => None,
        }
    }
}

struct NativeText(Zeroizing<String>);

impl<'de> Deserialize<'de> for NativeText {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Zeroizing::new(String::deserialize(deserializer)?);
        if value.len() > 4096 || value.contains('\0') {
            return Err(serde::de::Error::custom("invalid Alibaba Cloud text field"));
        }
        Ok(Self(value))
    }
}

#[derive(Deserialize)]
enum AuditStatus {
    #[serde(rename = "FAILED")]
    Failed,
    #[serde(rename = "SUCCEED")]
    Succeed,
    #[serde(rename = "NONAUDIT")]
    NonAudit,
    #[serde(rename = "AUDITING")]
    Auditing,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Tags {
    #[serde(rename = "Tag")]
    _entries: Vec<Tag>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Tag {
    #[serde(rename = "Key")]
    _key: NativeText,
    #[serde(rename = "Value")]
    _value: NativeText,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DnsList {
    #[serde(rename = "DnsList")]
    _entries: Vec<NativeText>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn entry(name: &str) -> Value {
        json!({
            "DomainName": name,
            "RegistrationDateLong": 1_704_067_200_000_i64,
            "ExpirationDateLong": 1_830_297_600_000_i64,
            "DomainStatus": "3",
            "ExpirationDateStatus": 1,
            "AutoRenewEnabled": false,
            "Registrar": "Alibaba Cloud",
            "Tag": {"Tag": [{"Key": "private-note", "Value": "Native only"}]},
            "DnsList": {"DnsList": ["example-dns.test"]},
            "Ccompany": "Native only",
        })
    }

    fn page(index: usize, zero_based: bool, entries: &Value) -> Value {
        json!({
            "PrePage": index > 1,
            "CurrentPageNum": if zero_based { index - 1 } else { index },
            "RequestId": format!("00000000-0000-0000-0000-{index:012x}"),
            "PageSize": 1, "TotalPageNum": 2, "TotalItemNum": 2,
            "NextPage": index == 1,
            "Data": {"Domain": entries},
        })
    }

    fn accept(scan: &mut InventoryScan, payload: &Value) -> Result<bool, AliyunError> {
        scan.accept(&serde_json::to_vec(payload).unwrap())
    }

    #[test]
    fn complete_pages_validate_both_documented_echo_shapes_and_project_only_registrations() {
        for zero_based in [false, true] {
            let mut scan = InventoryScan::default();
            let first = page(1, zero_based, &json!([entry("BÜCHER.Test")]));
            assert_eq!(accept(&mut scan, &first), Ok(false));
            let mut expired = entry("other.test");
            expired["ExpirationDateStatus"] = json!("2");
            expired.as_object_mut().unwrap().remove("AutoRenewEnabled");
            assert_eq!(
                accept(&mut scan, &page(2, zero_based, &json!([expired]))),
                Ok(true)
            );
            let facts = scan.into_registrations();
            assert_eq!(facts[0].domain, "other.test");
            assert!(!facts[0].active);
            assert_eq!(facts[0].auto_renew, None);
            assert_eq!(facts[1].domain, "xn--bcher-kva.test");
            assert!(facts[1].active);
            assert_eq!(facts[1].auto_renew, Some(false));
            assert_eq!(facts[1].registered_on, "2024-01-01");
        }
    }

    #[test]
    fn inconsistent_page_or_duplicate_domain_never_completes() {
        let first = page(1, false, &json!([entry("example.test")]));
        let next = page(2, false, &json!([entry("other.test")]));
        for (field, invalid) in [
            ("TotalItemNum", json!(3)),
            ("CurrentPageNum", json!(1)),
            ("PrePage", json!(false)),
            ("RequestId", first["RequestId"].clone()),
            ("NextPage", json!(true)),
            ("Data", json!({"Domain": [entry("EXAMPLE.test")]})),
            ("Data", json!({"Domain": []})),
            ("Data", json!({"Domain": [entry("https://other.test")]})),
        ] {
            let mut scan = InventoryScan::default();
            assert_eq!(accept(&mut scan, &first), Ok(false));
            let mut bad = next.clone();
            bad[field] = invalid;
            assert_eq!(
                accept(&mut scan, &bad),
                Err(AliyunError::ProtocolRejected),
                "{field}"
            );
        }
    }

    #[test]
    fn unknown_nested_keys_duplicate_wire_keys_and_invalid_status_fail_closed() {
        let mut domain = entry("example.test");
        domain["Tag"]["Tag"][0]["AccountId"] = json!("unknown");
        assert_eq!(
            accept(
                &mut InventoryScan::default(),
                &page(1, false, &json!([domain]))
            ),
            Err(AliyunError::ProtocolRejected)
        );
        let raw = page(1, false, &json!([entry("example.test")])).to_string();
        let raw = raw.replacen("\"PrePage\":false", "\"PrePage\":true,\"PrePage\":false", 1);
        assert_eq!(
            InventoryScan::default().accept(raw.as_bytes()),
            Err(AliyunError::ProtocolRejected)
        );
        let mut domain = entry("example.test");
        domain["DomainStatus"] = json!(4);
        assert_eq!(
            accept(
                &mut InventoryScan::default(),
                &page(1, false, &json!([domain]))
            ),
            Err(AliyunError::ProtocolRejected)
        );
    }
}
