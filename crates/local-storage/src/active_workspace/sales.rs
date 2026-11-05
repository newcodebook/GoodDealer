//! Read-only sales projection: one row per asset with a listing that is not `unlisted`, merging
//! the latest confirmed observation from each marketplace.
//!
//! Only observed listing facts leave the Host: the markets, the merged status and the asking price.
//! Observation, run and Provider version identifiers stay local. Offers, deals, view counts and
//! sales totals are not observed by any qualified capability, so the projection carries none.
//!
//! The merge happens here so that a page of domains and the workspace-wide metrics use one rule:
//! each read scans the confirmed listings once in domain order, validates every row (a bad row on
//! another page still fails the read closed), merges each domain, counts it toward the metrics and
//! keeps only the requested page.

use std::collections::BTreeSet;

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness};

use super::portfolio::{read_freshness, validate_workspace};

/// ADR-0027's launch platforms. A listing from any other marketplace fails the read.
const MARKETPLACES: [&str; 8] = [
    "afternic",
    "atom",
    "cloudflare",
    "dynadot",
    "godaddy",
    "namecheap",
    "porkbun",
    "spaceship",
];

/// The latest listing per (asset, marketplace) among observations the Host finished confirming:
/// the run completed and this asset's target in it succeeded. A newer observation from a run that
/// is still running or failed never hides an older confirmed listing.
fn latest_listings() -> String {
    format!(
        "WITH latest AS (
       SELECT m.entity_id, m.marketplace_kind, m.listing_status, m.asking_price_currency,
              m.asking_price_amount, m.observed_at, m.observation_availability, m.evidence_status,
              row_number() OVER (
                PARTITION BY m.entity_id, m.marketplace_kind
                ORDER BY m.observed_at DESC, m.listing_observation_id DESC
              ) AS position
       FROM marketplace_listing_observations m
       JOIN domain_assets a
         ON a.workspace_id = m.workspace_id AND a.entity_id = m.entity_id AND a.deleted_at IS NULL
       WHERE m.workspace_id = ?1 AND {confirmed}
     )
     SELECT entity_id, marketplace_kind, listing_status, asking_price_currency, asking_price_amount,
            observation_availability, evidence_status
     FROM latest WHERE position = 1 AND listing_status <> 'unlisted'
     ORDER BY entity_id COLLATE BINARY, marketplace_kind COLLATE BINARY",
        confirmed = super::observation_runs::confirmed("m")
    )
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SalesReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    /// Listed domains in the workspace, not marketplace rows.
    pub total_rows: u32,
    /// Domains whose merged status is `active`.
    pub active_listing_count: u32,
    /// The exact sum of active asking prices; `None` when there is none, prices span currencies,
    /// an active domain has no single price, or the sum leaves the money contract.
    pub listed_value: Option<SalesMoney>,
    pub window: SalesWindow,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SalesWindow {
    pub start_index: u32,
    pub size: u16,
    pub rows: Vec<SalesListingRow>,
}

/// One listed domain merged across its markets.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SalesListingRow {
    pub entity_id: String,
    /// Marketplace kinds in code-point order, each once.
    pub marketplaces: Vec<String>,
    /// A listing status, `unknown` when a market's state is unconfirmed, or `conflict` when two
    /// markets report different definite states; never one chosen on the person's behalf.
    pub listing_status: String,
    /// The price every market agrees on; `None` when it is unobserved or the markets differ.
    pub asking_price: Option<SalesMoney>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SalesMoney {
    pub currency: String,
    pub amount: String,
}

type RawListing = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
);

/// One market's validated listing, as the merge sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct MarketListing {
    kind: String,
    /// The listing status, or `unknown` when the evidence is unavailable or unconfirmed.
    status: String,
    price: Option<SalesMoney>,
}

pub(crate) struct ActiveSalesReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActiveSalesReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
    ) -> Result<SalesReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        if start_index > 1_000_000 || !(1..=200).contains(&size) {
            return Err(PortfolioReadError::WindowRejected);
        }
        let mut statement = transaction
            .prepare(&latest_listings())
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        let raw = statement
            .query_map(params![requested_workspace_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            })
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let page = usize::try_from(start_index).map_err(|_| PortfolioReadError::WindowRejected)?
            ..usize::try_from(start_index).map_err(|_| PortfolioReadError::WindowRejected)?
                + usize::from(size);
        let mut desk = SalesDesk::new(page);
        let mut domain: Option<(String, Vec<MarketListing>)> = None;
        for raw in raw {
            let raw: RawListing = raw.map_err(|_| PortfolioReadError::ProjectionRejected)?;
            let (entity_id, market) = project_listing(raw)?;
            match &mut domain {
                Some((current, markets)) if *current == entity_id => markets.push(market),
                _ => {
                    if let Some((entity_id, markets)) = domain.take() {
                        desk.add(merge(entity_id, &markets));
                    }
                    domain = Some((entity_id, vec![market]));
                }
            }
        }
        if let Some((entity_id, markets)) = domain {
            desk.add(merge(entity_id, &markets));
        }
        let freshness = read_freshness(&transaction)?;
        drop(statement);
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let to_u32 =
            |value: usize| u32::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected);
        Ok(SalesReadSnapshot {
            schema_version: 1,
            kind: "sales".to_owned(),
            read_generation: 0,
            freshness,
            total_rows: to_u32(desk.domains)?,
            active_listing_count: to_u32(desk.active)?,
            listed_value: desk.listed_value(),
            window: SalesWindow {
                start_index,
                size,
                rows: desk.rows,
            },
        })
    }
}

/// Folds merged domains, in order, into the page and the workspace-wide metrics.
struct SalesDesk {
    page: std::ops::Range<usize>,
    rows: Vec<SalesListingRow>,
    domains: usize,
    active: usize,
    /// The running sum of active prices in units of 10^-8; `Err` once no single total exists.
    value: Result<Option<(String, i128)>, ()>,
}

impl SalesDesk {
    const fn new(page: std::ops::Range<usize>) -> Self {
        Self {
            page,
            rows: Vec::new(),
            domains: 0,
            active: 0,
            value: Ok(None),
        }
    }

    fn add(&mut self, row: SalesListingRow) {
        if row.listing_status == "active" {
            self.active += 1;
            self.value = match (
                std::mem::replace(&mut self.value, Err(())),
                &row.asking_price,
            ) {
                (Ok(None), Some(price)) => Ok(Some((price.currency.clone(), units(&price.amount)))),
                (Ok(Some((currency, sum))), Some(price)) if currency == price.currency => {
                    Ok(Some((currency, sum + units(&price.amount))))
                }
                // An active domain without one price, or a second currency, leaves no total that
                // would not silently under-report.
                _ => Err(()),
            };
        }
        if self.page.contains(&self.domains) {
            self.rows.push(row);
        }
        self.domains += 1;
    }

    fn listed_value(&self) -> Option<SalesMoney> {
        let Ok(Some((currency, sum))) = &self.value else {
            return None;
        };
        let whole = sum / UNITS;
        let fraction = format!("{:08}", sum % UNITS);
        let fraction = fraction.trim_end_matches('0');
        // The money contract allows at most 16 whole digits; a larger total is not reported.
        let whole = whole.to_string();
        (whole.len() <= 16).then(|| SalesMoney {
            currency: currency.clone(),
            amount: if fraction.is_empty() {
                whole
            } else {
                format!("{whole}.{fraction}")
            },
        })
    }
}

const UNITS: i128 = 100_000_000;

/// An amount `money` already accepted (at most 16 whole and 8 fraction digits) in units of 10^-8,
/// so equal prices compare equal however many trailing zeros they carry.
fn units(amount: &str) -> i128 {
    let (whole, fraction) = amount.split_once('.').unwrap_or((amount, ""));
    let digits = |text: &str| {
        text.bytes()
            .fold(0_i128, |value, byte| value * 10 + i128::from(byte - b'0'))
    };
    digits(whole) * UNITS + digits(&format!("{fraction:0<8}"))
}

/// The domain's listing across markets, never chosen on the person's behalf: two different definite
/// states are a conflict, a state another market has not confirmed stays unknown, and differing
/// prices have no single value.
fn merge(entity_id: String, markets: &[MarketListing]) -> SalesListingRow {
    let definite: BTreeSet<&str> = markets
        .iter()
        .map(|market| market.status.as_str())
        .filter(|status| *status != "unknown")
        .collect();
    let listing_status = match definite.iter().copied().collect::<Vec<_>>().as_slice() {
        [only] if markets.iter().all(|market| market.status != "unknown") => (*only).to_owned(),
        [_, _, ..] => "conflict".to_owned(),
        _ => "unknown".to_owned(),
    };
    let first = markets.first().and_then(|market| market.price.as_ref());
    let same = |price: Option<&SalesMoney>| match (first, price) {
        (None, None) => true,
        (Some(left), Some(right)) => {
            left.currency == right.currency && units(&left.amount) == units(&right.amount)
        }
        _ => false,
    };
    let asking_price = markets
        .iter()
        .all(|market| same(market.price.as_ref()))
        .then(|| first.cloned())
        .flatten();
    SalesListingRow {
        entity_id,
        marketplaces: markets.iter().map(|market| market.kind.clone()).collect(),
        listing_status,
        asking_price,
    }
}

fn closed(value: String, allowed: &[&str]) -> Result<String, PortfolioReadError> {
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(PortfolioReadError::ProjectionRejected)
    }
}
/// Accepts the same decimal shape as the client commerce money contract; anything else fails.
fn money(
    currency: Option<String>,
    amount: Option<String>,
) -> Result<Option<SalesMoney>, PortfolioReadError> {
    match (currency, amount) {
        (None, None) => Ok(None),
        (Some(currency), Some(amount)) => {
            let currency_ok =
                currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_uppercase());
            let (whole, fraction) = amount
                .split_once('.')
                .map_or((amount.as_str(), None), |(whole, fraction)| {
                    (whole, Some(fraction))
                });
            let whole_ok = !whole.is_empty()
                && whole.len() <= 16
                && whole.bytes().all(|byte| byte.is_ascii_digit())
                && (whole == "0" || !whole.starts_with('0'));
            let fraction_ok = fraction.is_none_or(|fraction| {
                (1..=8).contains(&fraction.len())
                    && fraction.bytes().all(|byte| byte.is_ascii_digit())
            });
            if currency_ok && whole_ok && fraction_ok {
                Ok(Some(SalesMoney { currency, amount }))
            } else {
                Err(PortfolioReadError::ProjectionRejected)
            }
        }
        _ => Err(PortfolioReadError::ProjectionRejected),
    }
}

fn project_listing(raw: RawListing) -> Result<(String, MarketListing), PortfolioReadError> {
    let (entity_id, kind, status, currency, amount, availability, evidence) = raw;
    let status = closed(
        status,
        &[
            "draft",
            "active",
            "reserved",
            "sold",
            "suspended",
            "unknown",
        ],
    )?;
    let availability = closed(availability, &["available", "unavailable"])?;
    let evidence = closed(evidence, &["confirmed", "stale", "conflicted", "unknown"])?;
    Ok((
        entity_id,
        MarketListing {
            kind: closed(kind, &MARKETPLACES)?,
            // Unconfirmed or unavailable evidence never presents as a definite listing state.
            status: if availability == "available" && evidence == "confirmed" {
                status
            } else {
                "unknown".to_owned()
            },
            price: money(currency, amount)?,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::{MarketListing, SalesDesk, SalesMoney, merge};

    fn market(kind: &str, status: &str, price: Option<(&str, &str)>) -> MarketListing {
        MarketListing {
            kind: kind.to_owned(),
            status: status.to_owned(),
            price: price.map(|(currency, amount)| SalesMoney {
                currency: currency.to_owned(),
                amount: amount.to_owned(),
            }),
        }
    }

    #[test]
    fn merge_never_chooses_a_state_or_price_for_the_person() {
        let status = |markets: &[MarketListing]| merge("a.test".to_owned(), markets).listing_status;
        assert_eq!(status(&[market("atom", "active", None)]), "active");
        assert_eq!(
            status(&[
                market("afternic", "active", None),
                market("atom", "active", None)
            ]),
            "active"
        );
        // A market that has not confirmed its state keeps the domain unknown.
        assert_eq!(
            status(&[
                market("afternic", "active", None),
                market("atom", "unknown", None)
            ]),
            "unknown"
        );
        assert_eq!(status(&[market("atom", "unknown", None)]), "unknown");
        // Two definite states conflict, even beside an unknown one.
        assert_eq!(
            status(&[
                market("afternic", "active", None),
                market("atom", "sold", None),
                market("godaddy", "unknown", None)
            ]),
            "conflict"
        );
        let price = |markets: &[MarketListing]| merge("a.test".to_owned(), markets).asking_price;
        assert_eq!(
            price(&[
                market("afternic", "active", Some(("USD", "10.50"))),
                market("atom", "active", Some(("USD", "10.5")))
            ]),
            Some(SalesMoney {
                currency: "USD".to_owned(),
                amount: "10.50".to_owned()
            })
        );
        for other in [Some(("EUR", "10.5")), Some(("USD", "10.51")), None] {
            assert_eq!(
                price(&[
                    market("afternic", "active", Some(("USD", "10.5"))),
                    market("atom", "active", other)
                ]),
                None
            );
        }
    }

    #[test]
    fn listed_value_is_exact_and_stays_within_the_money_contract() {
        let mut desk = SalesDesk::new(0..0);
        for amount in ["0.00000001", "0.1", "0.2"] {
            desk.add(merge(
                "a.test".to_owned(),
                &[market("atom", "active", Some(("USD", amount)))],
            ));
        }
        assert_eq!(desk.listed_value().unwrap().amount, "0.30000001");
        assert!(desk.rows.is_empty());

        let mut large = SalesDesk::new(0..0);
        for _ in 0..2 {
            large.add(merge(
                "a.test".to_owned(),
                &[market("atom", "active", Some(("USD", "9999999999999999")))],
            ));
        }
        assert_eq!(large.active, 2);
        assert_eq!(large.listed_value(), None);
    }
}
