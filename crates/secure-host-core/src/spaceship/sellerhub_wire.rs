use super::{PAGE_SIZE, SpaceshipError, valid_hostname};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

const MAX_LISTINGS: usize = 10_000;
const MAX_APPROVED_CENTS: u64 = 9_007_199_254_740_991;

/// Account-scoped listing facts. `SellerHub` addresses the resource by domain and
/// returns no separate immutable Listing ID in this collection.
pub struct SpaceshipSellerHubListing {
    pub domain: String,
    pub status: SpaceshipSellerHubStatus,
    pub bin_price_usd: Option<String>,
    pub min_price_usd: Option<String>,
    pub bin_price_enabled: Option<bool>,
    pub min_price_enabled: Option<bool>,
}

impl SpaceshipSellerHubListing {
    /// Projects an on-sale, explicitly enabled BIN into the exact minor-unit range
    /// the approved plan can carry across its Native and Renderer boundaries.
    #[must_use]
    pub fn active_bin_cents(&self) -> Option<u64> {
        if self.status != SpaceshipSellerHubStatus::OnSale || self.bin_price_enabled != Some(true) {
            return None;
        }
        approved_cents(self.bin_price_usd.as_deref()?)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SpaceshipSellerHubStatus {
    Failed,
    Verifying,
    OnSale,
    OnSaleStopped,
    SaleProcessing,
    PrivateSale,
    LeaseActive,
    Sold,
}

#[derive(Default)]
pub(super) struct SellerHubScan {
    total: Option<usize>,
    listings: BTreeMap<String, SpaceshipSellerHubListing>,
}

impl SellerHubScan {
    pub(super) fn offset(&self) -> usize {
        self.listings.len()
    }

    pub(super) fn accept(&mut self, body: &[u8]) -> Result<bool, SpaceshipError> {
        let invalid = SpaceshipError::ProtocolRejected;
        let page: Page = serde_json::from_slice(body).map_err(|_| invalid)?;
        let offset = self.offset();
        if page.total > MAX_LISTINGS
            || self.total.is_some_and(|total| total != page.total)
            || offset > page.total
            || page.items.len() != (page.total - offset).min(PAGE_SIZE)
        {
            return Err(invalid);
        }
        self.total = Some(page.total);
        for item in page.items {
            let listing = item.project()?;
            if self
                .listings
                .insert(listing.domain.clone(), listing)
                .is_some()
            {
                return Err(invalid);
            }
        }
        Ok(self.offset() == page.total)
    }

    pub(super) fn into_listings(self) -> Vec<SpaceshipSellerHubListing> {
        self.listings.into_values().collect()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    total: usize,
    items: Vec<Listing>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Listing {
    name: String,
    unicode_name: String,
    status: SpaceshipSellerHubStatus,
    #[serde(default, deserialize_with = "optional_field")]
    display_name: Option<String>,
    #[serde(default, deserialize_with = "optional_field")]
    description: Option<String>,
    #[serde(default, deserialize_with = "optional_field")]
    bin_price: Option<Price>,
    #[serde(default, deserialize_with = "optional_field")]
    min_price: Option<Price>,
    #[serde(default, deserialize_with = "optional_field")]
    bin_price_enabled: Option<bool>,
    #[serde(default, deserialize_with = "optional_field")]
    min_price_enabled: Option<bool>,
}

pub(super) fn parse_exact_listing(
    body: &[u8],
    requested: &str,
) -> Result<SpaceshipSellerHubListing, SpaceshipError> {
    let invalid = SpaceshipError::ProtocolRejected;
    let row: Listing = serde_json::from_slice(body).map_err(|_| invalid)?;
    if row.name != requested {
        return Err(invalid);
    }
    row.project()
}

impl Listing {
    fn project(self) -> Result<SpaceshipSellerHubListing, SpaceshipError> {
        if !valid_hostname(&self.name)
            || !same_domain(&self.unicode_name, &self.name)
            || self
                .display_name
                .as_ref()
                .is_some_and(|name| !same_domain(name, &self.name))
            || self
                .description
                .as_ref()
                .is_some_and(|value| value.chars().count() > 5_000)
        {
            return Err(SpaceshipError::ProtocolRejected);
        }
        Ok(SpaceshipSellerHubListing {
            domain: self.name,
            status: self.status,
            bin_price_usd: self.bin_price.map(Price::into_amount).transpose()?,
            min_price_usd: self.min_price.map(Price::into_amount).transpose()?,
            bin_price_enabled: self.bin_price_enabled,
            min_price_enabled: self.min_price_enabled,
        })
    }
}

fn same_domain(value: &str, name: &str) -> bool {
    (4..=255).contains(&value.chars().count())
        && !value.contains('%')
        && matches!(url::Host::parse(value), Ok(url::Host::Domain(host)) if host == name)
}

fn amount_parts(amount: &str) -> Option<(&str, &str)> {
    let (whole, fraction) = match amount.split_once('.') {
        Some((whole, fraction)) if (1..=2).contains(&fraction.len()) && digits(fraction) => {
            (whole, fraction)
        }
        Some(_) => return None,
        None => (amount, ""),
    };
    (amount.len() <= 20 && digits(whole)).then_some((whole, fraction))
}

fn approved_cents(amount: &str) -> Option<u64> {
    let (whole, fraction) = amount_parts(amount)?;
    let fraction = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<u64>().ok()?.checked_mul(10)?,
        _ => fraction.parse::<u64>().ok()?,
    };
    let cents = whole
        .parse::<u64>()
        .ok()?
        .checked_mul(100)?
        .checked_add(fraction)?;
    (1..=MAX_APPROVED_CENTS).contains(&cents).then_some(cents)
}

pub(super) fn encode_bin_price_update(cents: u64) -> Result<Vec<u8>, SpaceshipError> {
    #[derive(Serialize)]
    struct PriceUpdate {
        amount: String,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct BinUpdate {
        bin_price: PriceUpdate,
    }
    if !(1..=MAX_APPROVED_CENTS).contains(&cents) {
        return Err(SpaceshipError::InputRejected);
    }
    // The account currency is already USD. Omitting other settings keeps this write
    // confined to the approved BIN amount.
    serde_json::to_vec(&BinUpdate {
        bin_price: PriceUpdate {
            amount: format!("{}.{:02}", cents / 100, cents % 100),
        },
    })
    .map_err(|_| SpaceshipError::InputRejected)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Price {
    amount: String,
    #[serde(rename = "currency")]
    _currency: Currency,
}

impl Price {
    fn into_amount(self) -> Result<String, SpaceshipError> {
        amount_parts(&self.amount).ok_or(SpaceshipError::ProtocolRejected)?;
        Ok(self.amount)
    }
}

fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(Deserialize)]
enum Currency {
    #[serde(rename = "USD")]
    Usd,
}

fn optional_field<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn listing(name: &str, status: &str) -> serde_json::Value {
        json!({"name": name, "unicodeName": name, "status": status})
    }

    #[test]
    fn exact_listing_requires_the_requested_account_domain() {
        let row = listing("example.com", "verifying").to_string();
        let fact = parse_exact_listing(row.as_bytes(), "example.com").unwrap();
        assert_eq!(fact.status, SpaceshipSellerHubStatus::Verifying);
        for body in [
            row,
            r#"{"detail":"Not found"}"#.to_owned(),
            r#"{"name":"other.test","unicodeName":"other.test","status":"onSale"}"#.to_owned(),
        ] {
            assert!(matches!(
                parse_exact_listing(body.as_bytes(), "requested.test"),
                Err(SpaceshipError::ProtocolRejected)
            ));
        }
    }

    #[test]
    fn bin_amount_is_exact_and_requires_a_sellable_enabled_listing() {
        for (amount, cents) in [
            ("1.01", Some(101)),
            ("00012.7", Some(1270)),
            ("90071992547409.91", Some(MAX_APPROVED_CENTS)),
            ("90071992547409.92", None),
            ("12345678901234567890", None),
            ("0.00", None),
            ("1.001", None),
            ("1.", None),
            ("1e2", None),
        ] {
            assert_eq!(approved_cents(amount), cents);
        }
        let mut fact = parse_exact_listing(
            br#"{"name":"example.com","unicodeName":"example.com","status":"onSale","binPriceEnabled":true,"binPrice":{"amount":"30.1","currency":"USD"}}"#,
            "example.com",
        ).unwrap();
        assert_eq!(fact.active_bin_cents(), Some(3010));
        fact.status = SpaceshipSellerHubStatus::SaleProcessing;
        assert_eq!(fact.active_bin_cents(), None);
        fact.status = SpaceshipSellerHubStatus::OnSale;
        fact.bin_price_enabled = None;
        assert_eq!(fact.active_bin_cents(), None);
    }

    #[test]
    fn accepts_documented_states_and_exact_usd_values_without_projecting_raw_fields() {
        let page = r#"{"total":1,"items":[{"name":"xn--bcher-kva.example","unicodeName":"bücher.example","displayName":"Bücher.example","description":"Seller text","status":"privateSale","binPrice":{"amount":"123.45","currency":"USD"},"binPriceEnabled":false}]}"#;
        let mut scan = SellerHubScan::default();
        assert_eq!(scan.accept(page.as_bytes()), Ok(true));
        let listings = scan.into_listings();
        assert_eq!(listings[0].domain, "xn--bcher-kva.example");
        assert_eq!(listings[0].status, SpaceshipSellerHubStatus::PrivateSale);
        assert_eq!(listings[0].bin_price_usd.as_deref(), Some("123.45"));
        assert_eq!(listings[0].bin_price_enabled, Some(false));
        assert_eq!(listings[0].min_price_enabled, None);
    }

    #[test]
    fn rejects_unknown_fields_states_wrong_domain_and_invalid_money() {
        let invalid = Err(SpaceshipError::ProtocolRejected);
        for wire in [
            r#"{"total":1,"items":[{"name":"a.test","unicodeName":"a.test","status":"future"}]}"#,
            r#"{"total":1,"items":[{"name":"a.test","unicodeName":"b.test","status":"onSale"}]}"#,
            r#"{"total":1,"items":[{"name":"a.test","unicodeName":"a.test","status":"onSale","name":"b.test"}]}"#,
            r#"{"total":1,"items":[{"name":"a.test","unicodeName":"a.test","status":"onSale","id":1}]}"#,
            r#"{"total":1,"items":[{"name":"a.test","unicodeName":"a.test","status":"onSale","binPriceEnabled":null}]}"#,
            r#"{"total":1,"items":[{"name":"a.test","unicodeName":"a.test","status":"onSale","binPrice":{"amount":"19.999","currency":"USD"}}]}"#,
            r#"{"total":1,"items":[{"name":"a.test","unicodeName":"a.test","status":"onSale","minPrice":{"amount":"15","currency":"EUR"}}]}"#,
        ] {
            assert_eq!(SellerHubScan::default().accept(wire.as_bytes()), invalid);
        }
    }

    #[test]
    fn requires_complete_pages_with_unchanged_total_and_distinct_domains() {
        let first_page = json!({"total": PAGE_SIZE + 1, "items": (0..PAGE_SIZE)
            .map(|i| listing(&format!("domain-{i}.example"), "verifying")).collect::<Vec<_>>()});
        for last_page in [
            json!({"total": PAGE_SIZE, "items": []}),
            json!({"total": PAGE_SIZE + 1, "items": []}),
            json!({"total": PAGE_SIZE + 1, "items": [listing("domain-0.example", "sold")]}),
        ] {
            let mut scan = SellerHubScan::default();
            assert_eq!(scan.accept(first_page.to_string().as_bytes()), Ok(false));
            assert_eq!(scan.offset(), PAGE_SIZE);
            assert_eq!(
                scan.accept(last_page.to_string().as_bytes()),
                Err(SpaceshipError::ProtocolRejected)
            );
        }
        let mut scan = SellerHubScan::default();
        let last_page =
            json!({"total": PAGE_SIZE + 1, "items": [listing("domain-z.example", "sold")]});
        assert_eq!(scan.accept(first_page.to_string().as_bytes()), Ok(false));
        assert_eq!(scan.accept(last_page.to_string().as_bytes()), Ok(true));
        assert_eq!(scan.into_listings().len(), PAGE_SIZE + 1);
    }
}
