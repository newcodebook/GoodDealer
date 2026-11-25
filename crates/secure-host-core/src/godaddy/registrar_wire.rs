use std::collections::BTreeSet;

use serde::Deserialize;
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use url::{Host, Url};
use zeroize::Zeroizing;

use super::{
    DOMAINS_PATH, GoDaddyError, GoDaddyRegistration, GoDaddyRegistrationStanding, MAX_DOMAINS,
    ORIGIN, PAGE_SIZE,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DomainCollection {
    items: Vec<DomainWire>,
    links: Vec<LinkWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DomainWire {
    domain: String,
    idn_domain: Option<String>,
    status: DomainStatus,
    expires_at: String,
    created_at: String,
    renew_by: Option<String>,
    updated_at: Option<String>,
    auto_renew: bool,
    privacy: bool,
    transfer_lock: Option<bool>,
    name_servers: Option<Vec<String>>,
    links: Option<Vec<LinkWire>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum DomainStatus {
    Active,
    Expired,
    Cancelled,
    CancelledRedeemable,
    PendingTransfer,
    TransferredOut,
    Locked,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LinkWire {
    pub(super) rel: String,
    pub(super) href: String,
    title: Option<String>,
    target_media_type: Option<String>,
    target_schema: Option<serde_json::Value>,
    pub(super) method: Option<String>,
    submission_media_type: Option<String>,
    submission_schema: Option<serde_json::Value>,
}

impl LinkWire {
    pub(super) fn validate(&self) -> Result<(), GoDaddyError> {
        if !bounded_text(&self.rel, 128)
            || !bounded_text(&self.href, 8192)
            || self
                .title
                .as_deref()
                .is_some_and(|value| !bounded_text(value, 1024))
            || self
                .target_media_type
                .as_deref()
                .is_some_and(|value| !bounded_text(value, 128))
            || self
                .method
                .as_deref()
                .is_some_and(|value| !bounded_text(value, 16))
            || self
                .submission_media_type
                .as_deref()
                .is_some_and(|value| !bounded_text(value, 128))
            || self.target_schema.is_some()
            || self.submission_schema.is_some()
        {
            return Err(GoDaddyError::ProtocolRejected);
        }
        Ok(())
    }

    fn next_cursor(&self) -> Result<Zeroizing<String>, GoDaddyError> {
        let invalid = GoDaddyError::ProtocolRejected;
        if self.method.as_deref().is_some_and(|method| method != "GET") {
            return Err(invalid);
        }
        // Never follow a provider URL directly. Only a validated opaque token may change the
        // next request, so neither Host credentials nor account scope can move with a link.
        let href = if self.href.starts_with('/') && !self.href.starts_with("//") {
            format!("{ORIGIN}{}", self.href)
        } else {
            self.href.clone()
        };
        let url = Url::parse(&href).map_err(|_| invalid)?;
        if url.origin().ascii_serialization() != ORIGIN
            || url.path() != DOMAINS_PATH
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid);
        }
        let mut cursor = None;
        let mut page_size = false;
        let mut direction = false;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "pageToken"
                    if cursor.is_none()
                        && (1..=4096).contains(&value.len())
                        && value.bytes().all(|byte| byte.is_ascii_graphic()) =>
                {
                    cursor = Some(Zeroizing::new(value.into_owned()));
                }
                "pageSize" if !page_size && value.parse::<usize>() == Ok(PAGE_SIZE) => {
                    page_size = true;
                }
                "pageTokenDirection" if !direction && value == "forward" => {
                    direction = true;
                }
                _ => return Err(invalid),
            }
        }
        cursor.ok_or(invalid)
    }
}

#[derive(Default)]
pub(super) struct InventoryScan {
    domains: BTreeSet<String>,
    cursor_digests: BTreeSet<[u8; 32]>,
    registrations: Vec<GoDaddyRegistration>,
}

impl InventoryScan {
    pub(super) fn accept(
        &mut self,
        body: &[u8],
    ) -> Result<Option<Zeroizing<String>>, GoDaddyError> {
        use sha2::{Digest, Sha256};
        let invalid = GoDaddyError::ProtocolRejected;
        let page: DomainCollection = serde_json::from_slice(body).map_err(|_| invalid)?;
        if page.items.len() > PAGE_SIZE
            || page.items.len() > MAX_DOMAINS - self.registrations.len()
            || page.links.len() > 16
        {
            return Err(invalid);
        }
        let mut cursor = None;
        for link in page.links {
            link.validate()?;
            if link.rel == "next" {
                if page.items.is_empty() || cursor.is_some() {
                    return Err(invalid);
                }
                let next = link.next_cursor()?;
                if !self
                    .cursor_digests
                    .insert(Sha256::digest(next.as_bytes()).into())
                {
                    return Err(invalid);
                }
                cursor = Some(next);
            }
        }

        for row in page.items {
            let row = row.project()?;
            if !self.domains.insert(row.domain.clone()) {
                return Err(invalid);
            }
            self.registrations.push(row);
        }
        Ok(cursor)
    }

    pub(super) fn into_registrations(self) -> Vec<GoDaddyRegistration> {
        self.registrations
    }
}

impl DomainWire {
    fn project(self) -> Result<GoDaddyRegistration, GoDaddyError> {
        let invalid = GoDaddyError::ProtocolRejected;
        let domain = self.domain.to_ascii_lowercase();
        if !valid_hostname(&domain)
            || self.idn_domain.as_deref().is_some_and(|value| {
                !bounded_text(value, 1024)
                    || !matches!(Host::parse(value), Ok(Host::Domain(ascii)) if ascii == domain)
            })
            || self.name_servers.as_ref().is_some_and(|servers| {
                !(2..=13).contains(&servers.len())
                    || servers.iter().any(|server| {
                        let name = server.strip_suffix('.').unwrap_or(server);
                        server.len() > 253 || !valid_hostname(&name.to_ascii_lowercase())
                    })
            })
            || self
                .renew_by
                .as_deref()
                .is_some_and(|value| date(value).is_none())
            || self
                .updated_at
                .as_deref()
                .is_some_and(|value| date(value).is_none())
            || self.links.as_ref().is_some_and(|links| {
                links.len() > 16 || links.iter().any(|link| link.validate().is_err())
            })
        {
            return Err(invalid);
        }
        let registered_on = date(&self.created_at).ok_or(invalid)?;
        let expires_on = date(&self.expires_at).ok_or(invalid)?;
        if registered_on > expires_on {
            return Err(invalid);
        }
        // Privacy, nameservers and link metadata are deliberately dropped at the Native boundary.
        let _ = self.privacy;
        Ok(GoDaddyRegistration {
            domain,
            registered_on,
            expires_on,
            auto_renew: self.auto_renew,
            transfer_locked: self.transfer_lock,
            standing: match self.status {
                DomainStatus::Active => GoDaddyRegistrationStanding::Active,
                DomainStatus::PendingTransfer => GoDaddyRegistrationStanding::PendingTransfer,
                DomainStatus::Expired
                | DomainStatus::Cancelled
                | DomainStatus::CancelledRedeemable
                | DomainStatus::TransferredOut
                | DomainStatus::Locked => GoDaddyRegistrationStanding::Inactive,
            },
        })
    }
}

pub(super) fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

pub(super) fn valid_hostname(value: &str) -> bool {
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

fn date(value: &str) -> Option<String> {
    if value.len() > 64 {
        return None;
    }
    let utc = OffsetDateTime::parse(value, &Rfc3339)
        .ok()?
        .checked_to_offset(UtcOffset::UTC)?;
    (1..=9999)
        .contains(&utc.year())
        .then(|| utc.date().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const ITEM: &str = r#"{"domain":"Example.com","status":"ACTIVE","expiresAt":"2027-06-12T10:02:10Z","createdAt":"2026-06-12T00:30:00+02:00","autoRenew":true,"privacy":false,"transferLock":true,"nameServers":["ns01.domaincontrol.com","ns02.domaincontrol.com."]}"#;

    fn page(item: &Value, links: &Value) -> Vec<u8> {
        serde_json::to_vec(&json!({"items":[item],"links":links})).unwrap()
    }

    #[test]
    fn follows_only_the_documented_token_and_projects_public_registration_facts() {
        let mut scan = InventoryScan::default();
        let mut item: Value = serde_json::from_str(ITEM).unwrap();
        let links = json!([{"rel":"next","href":"/v3/domains/domain-names?pageSize=100&pageToken=token%2B%2F"}]);
        let next = scan.accept(&page(&item, &links)).unwrap().unwrap();
        assert_eq!(next.as_str(), "token+/");
        item["domain"] = json!("elsewhere.net");
        item["status"] = json!("PENDING_TRANSFER");
        item.as_object_mut().unwrap().remove("transferLock");
        assert!(scan.accept(&page(&item, &json!([]))).unwrap().is_none());
        let rows = scan.into_registrations();
        assert_eq!(rows[0].domain, "example.com");
        assert_eq!(rows[0].registered_on, "2026-06-11");
        assert_eq!(rows[0].transfer_locked, Some(true));
        assert_eq!(rows[1].transfer_locked, None);
        assert_eq!(
            rows[1].standing,
            GoDaddyRegistrationStanding::PendingTransfer
        );
        assert!(
            InventoryScan::default()
                .accept(br#"{"items":[],"links":[]}"#)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn rejects_scope_changes_and_malformed_pages() {
        let item: Value = serde_json::from_str(ITEM).unwrap();
        for href in [
            "https://elsewhere.net/v3/domains/domain-names?pageToken=token",
            "//api.godaddy.com/v3/domains/domain-names?pageToken=token",
            "https://account@api.godaddy.com/v3/domains/domain-names?pageToken=token",
            "/v1/domains?pageToken=token",
            "/v3/domains/domain-names?pageToken=token#fragment",
            "/v3/domains/domain-names?pageToken=token&statuses=ACTIVE",
            "/v3/domains/domain-names?pageToken=token&pageToken=second",
            "/v3/domains/domain-names?pageToken=token&pageSize=200",
            "/v3/domains/domain-names?pageTokenDirection=backward&pageToken=token",
        ] {
            assert!(matches!(
                InventoryScan::default().accept(&page(&item, &json!([{"rel":"next","href":href}]))),
                Err(GoDaddyError::ProtocolRejected),
            ));
        }
        for body in [
            br#"{"items":[],"links":[{"rel":"next","href":"/v3/domains/domain-names?pageToken=token"}]}"#.as_slice(),
            br#"{"items":[]}"#.as_slice(),
            br#"{"items":[],"links":[],"accountId":"private"}"#.as_slice(),
        ] {
            assert!(InventoryScan::default().accept(body).is_err());
        }
        let mut unknown = item.clone();
        unknown["status"] = json!("UNKNOWN");
        assert!(
            InventoryScan::default()
                .accept(&page(&unknown, &json!([])))
                .is_err()
        );
        let mut invalid_date = item;
        invalid_date["expiresAt"] = json!("2026-02-31T00:00:00Z");
        assert!(
            InventoryScan::default()
                .accept(&page(&invalid_date, &json!([])))
                .is_err()
        );
    }

    #[test]
    fn rejects_repeated_cursors_and_canonical_domain_duplicates() {
        let item: Value = serde_json::from_str(ITEM).unwrap();
        let links = json!([{"rel":"next","href":"/v3/domains/domain-names?pageToken=first"}]);
        let first = page(&item, &links);
        let mut scan = InventoryScan::default();
        scan.accept(&first).unwrap();
        let mut second = item.clone();
        second["domain"] = json!("second.net");
        assert!(scan.accept(&page(&second, &links)).is_err());
        let mut scan = InventoryScan::default();
        scan.accept(&first).unwrap();
        assert!(scan.accept(&page(&item, &json!([]))).is_err());
    }

    /// Renewal windows count UTC days: an offset expiry is stored as its UTC date, not the date
    /// written in the registrar's local offset.
    #[test]
    fn expiry_is_the_utc_date_of_an_offset_timestamp() {
        assert_eq!(
            date("2027-06-12T01:00:00+05:00").as_deref(),
            Some("2027-06-11")
        );
        assert_eq!(
            date("2027-06-11T23:30:00-02:00").as_deref(),
            Some("2027-06-12")
        );
        assert_eq!(date("2027-06-11T23:59:59Z").as_deref(), Some("2027-06-11"));
    }
}
