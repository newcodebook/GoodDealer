use std::collections::BTreeSet;

use serde::Deserialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use url::Host;

use super::{MAX_DOMAINS, PAGE_SIZE, PorkbunError, PorkbunRegistration};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListPage {
    status: String,
    count: Option<u64>,
    domains: Vec<DomainWire>,
}

/// Labels are user-authored text and are never requested, so an unexpected `labels` field
/// fails closed with every other unknown field.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DomainWire {
    domain: String,
    status: String,
    tld: Option<String>,
    create_date: String,
    added_date: Option<String>,
    expire_date: String,
    security_lock: u8,
    whois_privacy: Option<u8>,
    auto_renew: u8,
    api_access: u8,
    not_local: Option<u8>,
}

#[derive(Default)]
pub(super) struct InventoryScan {
    domains: BTreeSet<String>,
    registrations: Vec<PorkbunRegistration>,
}

impl InventoryScan {
    /// Accepts one offset page and reports whether another page must be read. Only a page
    /// shorter than the documented 1000-domain chunk is terminal; a full page is followed by
    /// the next offset, which may legitimately be empty.
    pub(super) fn accept(&mut self, body: &[u8]) -> Result<bool, PorkbunError> {
        let invalid = PorkbunError::ProtocolRejected;
        let page: ListPage = serde_json::from_slice(body).map_err(|_| invalid)?;
        if page.status != "SUCCESS"
            || page.domains.len() > PAGE_SIZE
            || page.domains.len() > MAX_DOMAINS - self.registrations.len()
            || page
                .count
                .is_some_and(|count| usize::try_from(count) != Ok(page.domains.len()))
        {
            return Err(invalid);
        }
        let more = page.domains.len() == PAGE_SIZE;
        for row in page.domains {
            let row = row.project()?;
            if !self.domains.insert(row.domain.clone()) {
                return Err(invalid);
            }
            self.registrations.push(row);
        }
        // At the cap a full page still needs the terminal empty page; any further domain then
        // fails the capacity check above instead of being silently dropped.
        Ok(more)
    }

    pub(super) fn into_registrations(self) -> Vec<PorkbunRegistration> {
        self.registrations
    }
}

impl DomainWire {
    fn project(self) -> Result<PorkbunRegistration, PorkbunError> {
        let invalid = PorkbunError::ProtocolRejected;
        let domain = self.domain.to_ascii_lowercase();
        let flag = |value: u8| match value {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(invalid),
        };
        // Only `ACTIVE` is documented. Other registration states are refused until a qualified
        // account shows their exact vocabulary, rather than guessing what they mean.
        if !valid_hostname(&domain)
            || self.status != "ACTIVE"
            || self
                .tld
                .as_deref()
                .is_some_and(|tld| !domain.ends_with(&format!(".{}", tld.to_ascii_lowercase())))
            || self
                .added_date
                .as_deref()
                .is_some_and(|value| date(value).is_none())
            || self.whois_privacy.is_some_and(|value| value > 1)
            || self.not_local.is_some_and(|value| value > 1)
        {
            return Err(invalid);
        }
        let registered_on = date(&self.create_date).ok_or(invalid)?;
        let expires_on = date(&self.expire_date).ok_or(invalid)?;
        if registered_on > expires_on {
            return Err(invalid);
        }
        Ok(PorkbunRegistration {
            domain,
            registered_on,
            expires_on,
            auto_renew: flag(self.auto_renew)?,
            transfer_locked: flag(self.security_lock)?,
            api_access: flag(self.api_access)?,
        })
    }
}

fn valid_hostname(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        && matches!(Host::parse(value), Ok(Host::Domain(ascii)) if ascii == value)
}

/// Porkbun dates are UTC `YYYY-MM-DD HH:MM:SS`; only that exact shape is accepted.
fn date(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 19 || bytes[10] != b' ' || !value.is_ascii() {
        return None;
    }
    let rfc3339 = format!("{}T{}Z", &value[..10], &value[11..]);
    let utc = OffsetDateTime::parse(&rfc3339, &Rfc3339).ok()?;
    (1..=9999)
        .contains(&utc.year())
        .then(|| utc.date().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn item(domain: &str) -> Value {
        json!({
            "domain": domain, "status": "ACTIVE", "tld": "com",
            "createDate": "2021-01-15 10:00:00", "addedDate": "2026-10-16 07:06:17",
            "expireDate": "2027-01-15 10:00:00", "securityLock": 1, "whoisPrivacy": 1,
            "autoRenew": 0, "apiAccess": 1, "notLocal": 0
        })
    }

    fn page(items: &[Value]) -> Vec<u8> {
        serde_json::to_vec(&json!({"status":"SUCCESS","count":items.len(),"domains":items}))
            .unwrap()
    }

    #[test]
    fn projects_documented_fields_and_stops_only_on_a_short_page() {
        let mut scan = InventoryScan::default();
        let full: Vec<Value> = (0..PAGE_SIZE).map(|n| item(&format!("d{n}.com"))).collect();
        assert!(scan.accept(&page(&full)).unwrap());
        let mut last: Value = serde_json::from_slice(&page(&[item("Example.COM")])).unwrap();
        last.as_object_mut().unwrap().remove("count");
        assert!(!scan.accept(&serde_json::to_vec(&last).unwrap()).unwrap());
        let rows = scan.into_registrations();
        assert_eq!(rows.len(), PAGE_SIZE + 1);
        let row = &rows[PAGE_SIZE];
        assert_eq!(row.domain, "example.com");
        assert_eq!(
            (row.registered_on.as_str(), row.expires_on.as_str()),
            ("2021-01-15", "2027-01-15")
        );
        assert!(row.transfer_locked && !row.auto_renew && row.api_access);
        let mut empty = InventoryScan::default();
        assert!(
            !empty
                .accept(br#"{"status":"SUCCESS","domains":[]}"#)
                .unwrap()
        );
    }

    #[test]
    fn rejects_errors_inconsistent_counts_and_unknown_shapes() {
        for body in [
            json!({"status":"ERROR","message":"Invalid API key."}),
            json!({"status":"SUCCESS"}),
            json!({"status":"SUCCESS","count":2,"domains":[item("a.com")]}),
            json!({"status":"SUCCESS","domains":[],"account":"private"}),
        ] {
            assert!(
                InventoryScan::default()
                    .accept(&serde_json::to_vec(&body).unwrap())
                    .is_err()
            );
        }
        for (field, value) in [
            ("status", json!("EXPIRED")),
            ("tld", json!("net")),
            ("createDate", json!("2021-01-15T10:00:00Z")),
            ("expireDate", json!("2027-02-31 00:00:00")),
            ("addedDate", json!("yesterday")),
            ("securityLock", json!(2)),
            ("autoRenew", json!("1")),
            (
                "labels",
                json!([{"id":"1","title":"private","color":"red"}]),
            ),
            ("domain", json!("not a domain")),
        ] {
            let mut row = item("a.com");
            row[field] = value;
            assert!(
                InventoryScan::default().accept(&page(&[row])).is_err(),
                "{field} must be rejected"
            );
        }
        let mut inverted = item("a.com");
        inverted["createDate"] = json!("2028-01-01 00:00:00");
        assert!(InventoryScan::default().accept(&page(&[inverted])).is_err());
    }

    #[test]
    fn rejects_duplicates_within_and_across_pages() {
        assert!(
            InventoryScan::default()
                .accept(&page(&[item("a.com"), item("A.com")]))
                .is_err()
        );
        let mut scan = InventoryScan::default();
        let full: Vec<Value> = (0..PAGE_SIZE).map(|n| item(&format!("d{n}.com"))).collect();
        scan.accept(&page(&full)).unwrap();
        assert!(scan.accept(&page(&[item("d7.com")])).is_err());
    }

    #[test]
    fn a_capped_account_must_end_with_an_empty_page() {
        let fill = |scan: &mut InventoryScan| {
            for chunk in 0..MAX_DOMAINS / PAGE_SIZE {
                let rows: Vec<Value> = (0..PAGE_SIZE)
                    .map(|n| item(&format!("d{chunk}x{n}.com")))
                    .collect();
                assert!(scan.accept(&page(&rows)).unwrap());
            }
        };
        let mut exact = InventoryScan::default();
        fill(&mut exact);
        assert!(!exact.accept(&page(&[])).unwrap());
        assert_eq!(exact.into_registrations().len(), MAX_DOMAINS);
        let mut over = InventoryScan::default();
        fill(&mut over);
        assert!(over.accept(&page(&[item("extra.com")])).is_err());
    }

    /// Renewal windows count UTC days, so the stored expiry is the UTC date of the documented UTC
    /// timestamp, even one second before midnight.
    #[test]
    fn expiry_is_the_utc_date_of_the_documented_utc_timestamp() {
        assert_eq!(date("2027-01-15 23:59:59").as_deref(), Some("2027-01-15"));
        assert_eq!(date("2027-01-16 00:00:00").as_deref(), Some("2027-01-16"));
        for bad in [
            "2027-01-15T23:59:59Z",
            "2027-01-15 23:59:59+08:00",
            "2027-01-15",
        ] {
            assert_eq!(date(bad), None, "{bad}");
        }
    }
}
