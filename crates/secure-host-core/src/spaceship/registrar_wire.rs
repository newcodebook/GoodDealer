use super::{
    MAX_REGISTRATIONS, PAGE_SIZE, SpaceshipError, SpaceshipRegistration,
    SpaceshipRegistrationStanding,
};
use serde::{Deserialize, Deserializer};
use std::collections::BTreeSet;
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use zeroize::Zeroizing;

#[derive(Default)]
pub(super) struct InventoryScan {
    total: Option<usize>,
    names: BTreeSet<String>,
    registrations: Vec<SpaceshipRegistration>,
}

impl InventoryScan {
    pub(super) fn offset(&self) -> usize {
        self.registrations.len()
    }

    pub(super) fn accept(&mut self, body: &[u8]) -> Result<bool, SpaceshipError> {
        let invalid = SpaceshipError::ProtocolRejected;
        // Decode directly from the original bytes so duplicate JSON keys cannot overwrite fields.
        let page: Page = serde_json::from_slice(body).map_err(|_| invalid)?;
        let offset = self.offset();
        if page.total > MAX_REGISTRATIONS
            || self.total.is_some_and(|total| total != page.total)
            || offset > page.total
            || page.items.len() != (page.total - offset).min(PAGE_SIZE)
        {
            return Err(invalid);
        }
        self.total = Some(page.total);
        for item in page.items {
            let registration = item.project()?;
            if !self.names.insert(registration.domain.clone()) {
                return Err(invalid);
            }
            self.registrations.push(registration);
        }
        Ok(self.offset() == page.total)
    }

    pub(super) fn into_registrations(mut self) -> Vec<SpaceshipRegistration> {
        self.registrations
            .sort_unstable_by(|a, b| a.domain.cmp(&b.domain));
        self.registrations
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    total: usize,
    items: Vec<Domain>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Domain {
    name: String,
    unicode_name: String,
    #[serde(rename = "isPremium")]
    _is_premium: bool,
    auto_renew: bool,
    registration_date: String,
    expiration_date: String,
    lifecycle_status: Lifecycle,
    #[serde(
        rename = "verificationStatus",
        deserialize_with = "Deserialize::deserialize"
    )]
    _verification_status: Option<Verification>,
    epp_statuses: Vec<EppStatus>,
    suspensions: Vec<Suspension>,
    #[serde(rename = "privacyProtection")]
    _privacy_protection: PrivacyProtection,
    nameservers: Nameservers,
    contacts: Contacts,
}

impl Domain {
    fn project(self) -> Result<SpaceshipRegistration, SpaceshipError> {
        let invalid = SpaceshipError::ProtocolRejected;
        if !valid_hostname(&self.name)
            || !(4..=255).contains(&self.unicode_name.chars().count())
            || self.unicode_name.contains('%')
            || !matches!(url::Host::parse(&self.unicode_name), Ok(url::Host::Domain(name)) if name == self.name)
            || !(2..=12).contains(&self.nameservers.hosts.len())
            || self
                .nameservers
                .hosts
                .iter()
                .any(|host| !valid_hostname(host))
            || self.suspensions.len() > 2
            || (self.suspensions.len() == 2
                && self
                    .suspensions
                    .iter()
                    .filter(|entry| entry.reason_code == SuspensionReason::RaaVerification)
                    .count()
                    != 1)
            || self.epp_statuses.iter().collect::<BTreeSet<_>>().len() != self.epp_statuses.len()
            || self
                .contacts
                .attributes
                .as_ref()
                .is_some_and(|ids| ids.len() > 5)
        {
            return Err(invalid);
        }
        let registered = parse_date(&self.registration_date).ok_or(invalid)?;
        let expires = parse_date(&self.expiration_date).ok_or(invalid)?;
        if expires < registered {
            return Err(invalid);
        }
        let standing = match self.lifecycle_status {
            Lifecycle::Creating => SpaceshipRegistrationStanding::Pending,
            Lifecycle::Registered if self.suspensions.is_empty() => {
                SpaceshipRegistrationStanding::Active
            }
            Lifecycle::Registered
            | Lifecycle::Grace1
            | Lifecycle::Grace2
            | Lifecycle::Redemption => SpaceshipRegistrationStanding::Inactive,
        };
        Ok(SpaceshipRegistration {
            domain: self.name,
            registered_on: registered.date().to_string(),
            expires_on: expires.date().to_string(),
            auto_renew: self.auto_renew,
            transfer_locked: self.epp_statuses.contains(&EppStatus::TransferProhibited),
            standing,
        })
    }
}

fn valid_hostname(host: &str) -> bool {
    (4..=253).contains(&host.len())
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        && matches!(url::Host::parse(host), Ok(url::Host::Domain(domain)) if domain == host)
}

fn parse_date(value: &str) -> Option<OffsetDateTime> {
    if value.len() > 27 {
        return None;
    }
    let date = OffsetDateTime::parse(value, &Rfc3339)
        .ok()?
        .checked_to_offset(UtcOffset::UTC)?;
    (1..=9999).contains(&date.year()).then_some(date)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Lifecycle {
    Creating,
    Registered,
    Grace1,
    Grace2,
    Redemption,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Verification {
    #[serde(rename = "verification")]
    Pending,
    Success,
    Failed,
}

#[derive(Deserialize, PartialEq, Eq, PartialOrd, Ord)]
enum EppStatus {
    #[serde(rename = "clientDeleteProhibited")]
    DeleteProhibited,
    #[serde(rename = "clientHold")]
    Hold,
    #[serde(rename = "clientRenewProhibited")]
    RenewProhibited,
    #[serde(rename = "clientTransferProhibited")]
    TransferProhibited,
    #[serde(rename = "clientUpdateProhibited")]
    UpdateProhibited,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Suspension {
    #[serde(rename = "reasonCode")]
    reason_code: SuspensionReason,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SuspensionReason {
    RaaVerification,
    Abuse,
    PromoAbuse,
    Fraud,
    PendingAccountVerification,
    UnauthorizedAccess,
    TosViolation,
    TransferDispute,
    RestrictedSecurity,
    LockCourt,
    SuspendCourt,
    UdrpUrs,
    RestrictedLegal,
    PaymentPending,
    UnpaidService,
    RestrictedWhois,
    LockedWhois,
    ComplianceCase,
    SuspendRegistry,
    FefAbuse,
    DdosSuspend,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PrivacyProtection {
    #[serde(rename = "contactForm")]
    _contact_form: bool,
    #[serde(rename = "level")]
    _level: PrivacyLevel,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum PrivacyLevel {
    Public,
    High,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nameservers {
    #[serde(rename = "provider")]
    _provider: NameserverProvider,
    hosts: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum NameserverProvider {
    Basic,
    Custom,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Contacts {
    #[serde(rename = "registrant", deserialize_with = "contact_id")]
    _registrant: (),
    #[serde(rename = "admin", default, deserialize_with = "contact_id")]
    _admin: (),
    #[serde(rename = "tech", default, deserialize_with = "contact_id")]
    _tech: (),
    #[serde(rename = "billing", default, deserialize_with = "contact_id")]
    _billing: (),
    #[serde(default, deserialize_with = "contact_ids")]
    attributes: Option<Vec<()>>,
}

fn contact_ids<'de, D: Deserializer<'de>>(decoder: D) -> Result<Option<Vec<()>>, D::Error> {
    #[derive(Deserialize)]
    struct Contact(#[serde(deserialize_with = "contact_id")] ());
    Vec::<Contact>::deserialize(decoder).map(|ids| Some(ids.into_iter().map(|id| id.0).collect()))
}

fn contact_id<'de, D: Deserializer<'de>>(decoder: D) -> Result<(), D::Error> {
    let id = Zeroizing::new(String::deserialize(decoder)?);
    if (27..=32).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err(serde::de::Error::custom("invalid contact reference"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn domain(name: &str) -> Value {
        json!({
            "name": name, "unicodeName": name, "isPremium": false, "autoRenew": true,
            "registrationDate": "2024-02-29T00:00:00.000Z",
            "expirationDate": "2027-04-01T02:00:00+03:00",
            "lifecycleStatus": "registered", "verificationStatus": null,
            "eppStatuses": ["clientTransferProhibited"], "suspensions": [],
            "privacyProtection": {"contactForm": true, "level": "high"},
            "nameservers": {"provider":"basic", "hosts":["ns1.example.test","ns2.example.test"]},
            "contacts": {"registrant": "Contact12345678901234567890"}
        })
    }

    fn page(total: usize, items: &[Value]) -> Vec<u8> {
        serde_json::to_vec(&json!({"total":total,"items":items})).unwrap()
    }

    #[test]
    fn projects_only_registration_facts_for_a_full_scan() {
        let mut scan = InventoryScan::default();
        let mut idn = domain("xn--bcher-kva.test");
        idn["unicodeName"] = json!("bücher.test");
        idn["suspensions"] = json!([{"reasonCode":"raaVerification"}]);
        assert!(scan.accept(&page(2, &[idn, domain("alpha.test")])).unwrap());
        let rows = scan.into_registrations();
        assert_eq!(rows[0].domain, "alpha.test");
        assert_eq!(rows[0].registered_on, "2024-02-29");
        assert_eq!(rows[0].expires_on, "2027-03-31");
        assert!(rows[0].auto_renew && rows[0].transfer_locked);
        assert_eq!(rows[0].standing, SpaceshipRegistrationStanding::Active);
        assert_eq!(rows[1].standing, SpaceshipRegistrationStanding::Inactive);
    }

    #[test]
    fn requires_exact_page_accounting_and_canonical_uniqueness() {
        let first_page = || -> Vec<Value> {
            (0..PAGE_SIZE)
                .map(|i| domain(&format!("d{i:03}.test")))
                .collect()
        };
        let first = page(PAGE_SIZE + 1, &first_page());
        for tail in [
            page(PAGE_SIZE + 2, &[domain("new.test"), domain("other.test")]),
            page(PAGE_SIZE + 1, &[]),
            page(PAGE_SIZE + 1, &[domain("d099.test")]),
        ] {
            let mut scan = InventoryScan::default();
            assert!(!scan.accept(&first).unwrap());
            assert_eq!(scan.offset(), PAGE_SIZE);
            assert_eq!(scan.accept(&tail), Err(SpaceshipError::ProtocolRejected));
        }
        let mut scan = InventoryScan::default();
        assert!(!scan.accept(&first).unwrap());
        assert!(
            scan.accept(&page(PAGE_SIZE + 1, &[domain("other.test")]))
                .unwrap()
        );
        assert_eq!(scan.into_registrations().len(), PAGE_SIZE + 1);
        assert!(InventoryScan::default().accept(&page(0, &[])).unwrap());
        assert_eq!(
            InventoryScan::default().accept(&page(MAX_REGISTRATIONS + 1, &first_page())),
            Err(SpaceshipError::ProtocolRejected)
        );
    }

    #[test]
    fn rejects_unknown_and_malformed_wire_even_when_unused_by_the_projection() {
        for (field, invalid) in [
            ("unicodeName", json!("another.test")),
            ("verificationStatus", json!("unknown")),
            ("registrationDate", json!("2023-02-29T00:00:00.000Z")),
            ("expirationDate", json!("2023-04-01T00:00:00.000Z")),
            ("eppStatuses", json!(["transferProhibited"])),
            ("contacts", json!({"registrant":"not-a-contact-id"})),
            (
                "contacts",
                json!({"registrant":"Contact12345678901234567890","admin":null}),
            ),
            ("undocumentedField", json!(true)),
        ] {
            let mut invalid_domain = domain("alpha.test");
            invalid_domain[field] = invalid;
            assert_eq!(
                InventoryScan::default().accept(&page(1, &[invalid_domain])),
                Err(SpaceshipError::ProtocolRejected),
                "{field}"
            );
        }
        assert_eq!(
            InventoryScan::default().accept(br#"{"total":1,"total":0,"items":[]}"#),
            Err(SpaceshipError::ProtocolRejected)
        );
    }
}
