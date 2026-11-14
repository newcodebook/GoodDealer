//! Read-only sales projection: one row per asset with a listing that is not `unlisted`, merging
//! the latest confirmed observation from each marketplace.
//!
//! Only observed listing facts leave the Host: the markets, the merged status and the asking price.
//! Observation, run and Provider version identifiers stay local. Offers, deals, view counts and
//! sales totals are not observed by any qualified capability, so the projection carries none.
//!
//! The merge happens here so that a page of domains and the workspace-wide metrics use one rule: a
//! read scans the confirmed listings once in domain order, validates every row (a bad row on
//! another page still fails the read closed), merges each domain and counts it toward the metrics.
//! That scan is linear in listings, so the merged desk is kept for the listing generation it was
//! read at and later pages, and reads after writes that touch no listing, are sliced from it.

use std::cell::RefCell;
use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness};

use super::launch_platforms::LAUNCH_PLATFORMS;
use super::portfolio::{read_freshness, validate_workspace};

/// Every confirmed listing observation: the run completed and this asset's target in it succeeded,
/// which the trigger-maintained `confirmed` column records on the row itself (see
/// `sales_listing_confirmation.sql`). Rows come newest first within each (asset, marketplace)
/// group, in the order of the `marketplace_listing_observations_latest` index, so the walk in
/// `for_each_latest` keeps the first row of a group without a sort. A newer observation from a run
/// that is still running or failed never hides an older confirmed listing, because it is not a row
/// here at all.
///
/// No joins: at 100k assets on 8 markets a per-row lookup of the run and target cost most of the
/// merge. Deleted assets are dropped by `for_each_latest` from a set read once, not joined per row.
const CONFIRMED_LISTINGS: &str = "SELECT m.entity_id, m.marketplace_kind, m.listing_status,
        m.asking_price_currency, m.asking_price_amount, m.observation_availability,
        m.evidence_status
     FROM marketplace_listing_observations m
     WHERE m.workspace_id = ?1 AND m.confirmed = 1
     ORDER BY m.entity_id, m.marketplace_kind, m.observed_at DESC, m.listing_observation_id DESC";

/// Deleted assets keep their observations until purged; only an archived asset can be deleted, so
/// the lifecycle index finds them without a table scan.
const DELETED_ASSETS: &str = "SELECT entity_id FROM domain_assets
     WHERE workspace_id = ?1 AND lifecycle_status = 'archived' AND deleted_at IS NOT NULL";

/// Calls `visit` with the latest confirmed listing of every (asset, marketplace) whose state is not
/// `unlisted`, in domain then marketplace order. Older rows of a group are skipped unread, as the
/// window function this replaces never selected them.
fn for_each_latest(
    connection: &Connection,
    workspace_id: &str,
    mut visit: impl FnMut(rusqlite::Result<RawListing>) -> Result<(), PortfolioReadError>,
) -> Result<(), PortfolioReadError> {
    let deleted = connection
        .prepare(DELETED_ASSETS)
        .map_err(|_| PortfolioReadError::SchemaRejected)?
        .query_map(params![workspace_id], |row| row.get::<_, String>(0))
        .map_err(|_| PortfolioReadError::ProjectionRejected)?
        .collect::<rusqlite::Result<HashSet<String>>>()
        .map_err(|_| PortfolioReadError::StorageRejected)?;
    let mut statement = connection
        .prepare(CONFIRMED_LISTINGS)
        .map_err(|_| PortfolioReadError::SchemaRejected)?;
    let mut rows = statement
        .query(params![workspace_id])
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    let mut group: Option<(String, String)> = None;
    while let Some(row) = rows
        .next()
        .map_err(|_| PortfolioReadError::StorageRejected)?
    {
        let key = row
            .get::<_, String>(0)
            .and_then(|entity_id| Ok((entity_id, row.get::<_, String>(1)?)));
        let (entity_id, kind) = match key {
            Ok(key) => key,
            // A key of the wrong type belongs to no group; the visit rejects it.
            Err(error) => {
                visit(Err(error))?;
                continue;
            }
        };
        if group
            .as_ref()
            .is_some_and(|(entity, market)| *entity == entity_id && *market == kind)
        {
            continue;
        }
        group = Some((entity_id.clone(), kind.clone()));
        if deleted.contains(&entity_id) {
            continue;
        }
        let listing = (|| {
            Ok((
                entity_id,
                kind,
                row.get::<_, String>(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })();
        if !matches!(&listing, Ok((_, _, status, ..)) if status == "unlisted") {
            visit(listing)?;
        }
    }
    Ok(())
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

/// A listing state as the desk keeps it: one byte instead of a string per domain.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum ListingStatus {
    Draft,
    Active,
    Reserved,
    Sold,
    Suspended,
    /// A market whose state is unconfirmed, or a domain with such a market.
    Unknown,
    /// Two markets report different definite states; never a stored state.
    Conflict,
}

impl ListingStatus {
    /// The stored states a listing observation may carry; anything else fails the read.
    fn stored(value: &str) -> Option<Self> {
        Some(match value {
            "draft" => Self::Draft,
            "active" => Self::Active,
            "reserved" => Self::Reserved,
            "sold" => Self::Sold,
            "suspended" => Self::Suspended,
            "unknown" => Self::Unknown,
            _ => return None,
        })
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Active => "active",
            Self::Reserved => "reserved",
            Self::Sold => "sold",
            Self::Suspended => "suspended",
            Self::Unknown => "unknown",
            Self::Conflict => "conflict",
        }
    }
}

/// A validated asking price: the currency code and the amount exactly as observed.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Price {
    currency: [u8; 3],
    amount: Box<str>,
}

impl Price {
    fn money(&self) -> SalesMoney {
        SalesMoney {
            // `money` admitted only three ASCII capitals.
            currency: self.currency.iter().copied().map(char::from).collect(),
            amount: self.amount.to_string(),
        }
    }
}

/// One market's validated listing, as the merge sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct MarketListing {
    /// The market's position in `LAUNCH_PLATFORMS`.
    market: u8,
    /// The listing status, or `Unknown` when the evidence is unavailable or unconfirmed.
    status: ListingStatus,
    price: Option<Price>,
}

/// One merged domain as the desk keeps it. The desk holds every listed domain for as long as its
/// generation lasts, so a row stays small: markets are a bit set over the eight launch platforms
/// and the state is one byte, making a row roughly a hundred bytes however many markets list it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct DeskRow {
    entity_id: Box<str>,
    /// Bit `i` set when `LAUNCH_PLATFORMS[i]` lists the domain.
    markets: u8,
    status: ListingStatus,
    price: Option<Price>,
}

impl DeskRow {
    fn row(&self) -> SalesListingRow {
        SalesListingRow {
            entity_id: self.entity_id.to_string(),
            // `LAUNCH_PLATFORMS` is in code-point order, so the bits read out in that order.
            marketplaces: LAUNCH_PLATFORMS
                .iter()
                .enumerate()
                .filter(|(index, _)| self.markets & (1 << index) != 0)
                .map(|(_, kind)| (*kind).to_owned())
                .collect(),
            listing_status: self.status.as_str().to_owned(),
            asking_price: self.price.as_ref().map(Price::money),
        }
    }
}

/// The merged desk of one workspace at one data generation.
///
/// The generation pairs `sales_listing_generation`, which every committed change to a row the merge
/// reads advances (its migration lists them), with `PRAGMA data_version`, which changes whenever
/// another connection commits. Neither moves while nothing the merge reads is written here, so
/// equal generations read equal listings, and a write elsewhere (a note, a DNS record, a target
/// price) keeps the desk. Only DDL, `VACUUM` or a backup-API write into the open database could
/// change listings without moving either, so anything that rewrites the open database that way must
/// reopen the connection, which drops the cache.
#[derive(Default)]
pub(crate) struct SalesCache(RefCell<Option<(String, DataGeneration, Arc<MergedDesk>)>>);

impl SalesCache {
    /// Whether the cache holds the workspace's desk merged at `generation`.
    pub(super) fn holds(&self, workspace_id: &str, generation: DataGeneration) -> bool {
        self.0
            .borrow()
            .as_ref()
            .is_some_and(|(workspace, cached, _)| {
                workspace == workspace_id && *cached == generation
            })
    }
}

impl SalesCache {
    /// The heap the cached desk requests from the allocator: a lower bound without allocator
    /// overhead.
    #[cfg(test)]
    pub(super) fn desk_bytes(&self) -> Option<usize> {
        self.0.borrow().as_ref().map(|(_, _, desk)| {
            desk.rows.capacity() * std::mem::size_of::<DeskRow>()
                + desk
                    .rows
                    .iter()
                    .map(|row| {
                        row.entity_id.len()
                            + row.price.as_ref().map_or(0, |price| price.amount.len())
                    })
                    .sum::<usize>()
        })
    }
}

pub(super) type DataGeneration = (i64, i64);

pub(super) fn data_generation(
    connection: &Connection,
) -> Result<DataGeneration, PortfolioReadError> {
    let data_version = connection
        .pragma_query_value(None, "data_version", |row| row.get(0))
        .map_err(|_| PortfolioReadError::StorageRejected)?;
    let listings = connection
        .query_row(
            "SELECT generation FROM sales_listing_generation WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| PortfolioReadError::StorageRejected)?;
    Ok((data_version, listings))
}

/// Every listed domain of the workspace, merged and in domain order, with the desk's metrics.
struct MergedDesk {
    rows: Vec<DeskRow>,
    active: usize,
    listed_value: Option<SalesMoney>,
}

pub(crate) struct ActiveSalesReader<'a> {
    connection: &'a Connection,
    cache: &'a SalesCache,
}

impl<'a> ActiveSalesReader<'a> {
    pub(crate) const fn new(connection: &'a Connection, cache: &'a SalesCache) -> Self {
        Self { connection, cache }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
    ) -> Result<SalesReadSnapshot, PortfolioReadError> {
        match self.read_once(requested_workspace_id, start_index, size, true)? {
            Some(snapshot) => Ok(snapshot),
            // A commit landed while a cached desk was served, so it may predate this read's
            // snapshot; merge again without the cache.
            None => self
                .read_once(requested_workspace_id, start_index, size, false)?
                .ok_or(PortfolioReadError::StorageRejected),
        }
    }

    /// One read; `None` when `use_cache` served a desk whose generation moved during the read.
    fn read_once(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
        use_cache: bool,
    ) -> Result<Option<SalesReadSnapshot>, PortfolioReadError> {
        // The generation is read before the snapshot begins and again after it ends: only when the
        // two agree did no commit land in between, so the snapshot's data is that generation's.
        let before = data_generation(self.connection)?;
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        if start_index > 1_000_000 || !(1..=200).contains(&size) {
            return Err(PortfolioReadError::WindowRejected);
        }
        let cached = if use_cache {
            self.cache
                .0
                .borrow()
                .as_ref()
                .filter(|(workspace, generation, _)| {
                    workspace == requested_workspace_id && *generation == before
                })
                .map(|(_, _, desk)| Arc::clone(desk))
        } else {
            None
        };
        let hit = cached.is_some();
        let desk = match cached {
            Some(desk) => desk,
            None => Arc::new(merge_desk(&transaction, requested_workspace_id)?),
        };
        let freshness = read_freshness(&transaction)?;
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        if data_generation(self.connection)? == before {
            *self.cache.0.borrow_mut() =
                Some((requested_workspace_id.to_owned(), before, Arc::clone(&desk)));
        } else if hit {
            *self.cache.0.borrow_mut() = None;
            return Ok(None);
        }
        let to_u32 =
            |value: usize| u32::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected);
        let start = usize::try_from(start_index).map_err(|_| PortfolioReadError::WindowRejected)?;
        let rows = desk
            .rows
            .iter()
            .skip(start)
            .take(usize::from(size))
            .map(DeskRow::row)
            .collect();
        Ok(Some(SalesReadSnapshot {
            schema_version: 1,
            kind: "sales".to_owned(),
            read_generation: 0,
            freshness,
            total_rows: to_u32(desk.rows.len())?,
            active_listing_count: to_u32(desk.active)?,
            listed_value: desk.listed_value.clone(),
            window: SalesWindow {
                start_index,
                size,
                rows,
            },
        }))
    }
}

/// Scans, validates and merges every confirmed listing of the workspace.
///
/// It fails on every listing `rejected_listings` counts, never skipping one: the settings read
/// relies on that, taking a desk cached at a generation as proof that none is rejected. A merge
/// that tolerated a bad row would have to stop the settings read from using the cache.
fn merge_desk(
    transaction: &Connection,
    requested_workspace_id: &str,
) -> Result<MergedDesk, PortfolioReadError> {
    let mut desk = SalesDesk::new();
    let mut domain: Option<(String, Vec<MarketListing>)> = None;
    for_each_latest(transaction, requested_workspace_id, |raw| {
        let raw = raw.map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let (entity_id, market) = project_listing(raw)?;
        match &mut domain {
            Some((current, markets)) if *current == entity_id => markets.push(market),
            _ => {
                if let Some((entity_id, markets)) = domain.take() {
                    desk.add(merge(entity_id.into_boxed_str(), &markets));
                }
                domain = Some((entity_id, vec![market]));
            }
        }
        Ok(())
    })?;
    if let Some((entity_id, markets)) = domain {
        desk.add(merge(entity_id.into_boxed_str(), &markets));
    }
    desk.rows.shrink_to_fit();
    Ok(MergedDesk {
        listed_value: desk.listed_value(),
        rows: desk.rows,
        active: desk.active,
    })
}

/// How many of the listings the desk merges fail validation. Any one fails the sales read closed;
/// settings diagnostics report the count so the cause is visible.
pub(super) fn rejected_listings(
    connection: &Connection,
    workspace_id: &str,
) -> Result<u32, PortfolioReadError> {
    let mut rejected = 0_u32;
    for_each_latest(connection, workspace_id, |raw| {
        if super::unreadable_row(raw, project_listing)? {
            rejected = rejected.saturating_add(1);
        }
        Ok(())
    })?;
    Ok(rejected)
}

/// Folds merged domains, in order, into the desk and its workspace-wide metrics.
struct SalesDesk {
    rows: Vec<DeskRow>,
    active: usize,
    /// The running sum of active prices in units of 10^-8; `Err` once no single total exists.
    value: Result<Option<([u8; 3], i128)>, ()>,
}

impl SalesDesk {
    const fn new() -> Self {
        Self {
            rows: Vec::new(),
            active: 0,
            value: Ok(None),
        }
    }

    fn add(&mut self, row: DeskRow) {
        if row.status == ListingStatus::Active {
            self.active += 1;
            self.value = match (std::mem::replace(&mut self.value, Err(())), &row.price) {
                (Ok(None), Some(price)) => Ok(Some((price.currency, units(&price.amount)))),
                (Ok(Some((currency, sum))), Some(price)) if currency == price.currency => {
                    Ok(Some((currency, sum + units(&price.amount))))
                }
                // An active domain without one price, or a second currency, leaves no total that
                // would not silently under-report.
                _ => Err(()),
            };
        }
        self.rows.push(row);
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
            currency: currency.iter().copied().map(char::from).collect(),
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
fn merge(entity_id: Box<str>, markets: &[MarketListing]) -> DeskRow {
    let definite: BTreeSet<ListingStatus> = markets
        .iter()
        .map(|market| market.status)
        .filter(|status| *status != ListingStatus::Unknown)
        .collect();
    let status = match definite.iter().copied().collect::<Vec<_>>().as_slice() {
        [only]
            if markets
                .iter()
                .all(|market| market.status != ListingStatus::Unknown) =>
        {
            *only
        }
        [_, _, ..] => ListingStatus::Conflict,
        _ => ListingStatus::Unknown,
    };
    let first = markets.first().and_then(|market| market.price.as_ref());
    let same = |price: Option<&Price>| match (first, price) {
        (None, None) => true,
        (Some(left), Some(right)) => {
            left.currency == right.currency && units(&left.amount) == units(&right.amount)
        }
        _ => false,
    };
    let price = markets
        .iter()
        .all(|market| same(market.price.as_ref()))
        .then(|| first.cloned())
        .flatten();
    DeskRow {
        entity_id,
        markets: markets
            .iter()
            .fold(0, |markets, market| markets | (1 << market.market)),
        status,
        price,
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
) -> Result<Option<Price>, PortfolioReadError> {
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
            match (currency_ok && whole_ok && fraction_ok, currency.as_bytes()) {
                (true, &[a, b, c]) => Ok(Some(Price {
                    currency: [a, b, c],
                    amount: amount.into_boxed_str(),
                })),
                _ => Err(PortfolioReadError::ProjectionRejected),
            }
        }
        _ => Err(PortfolioReadError::ProjectionRejected),
    }
}

fn project_listing(raw: RawListing) -> Result<(String, MarketListing), PortfolioReadError> {
    let (entity_id, kind, status, currency, amount, availability, evidence) = raw;
    let status = ListingStatus::stored(&status).ok_or(PortfolioReadError::ProjectionRejected)?;
    let availability = closed(availability, &["available", "unavailable"])?;
    let evidence = closed(evidence, &["confirmed", "stale", "conflicted", "unknown"])?;
    let market = LAUNCH_PLATFORMS
        .iter()
        .position(|platform| *platform == kind)
        .and_then(|index| u8::try_from(index).ok())
        .ok_or(PortfolioReadError::ProjectionRejected)?;
    Ok((
        entity_id,
        MarketListing {
            market,
            // Unconfirmed or unavailable evidence never presents as a definite listing state.
            status: if availability == "available" && evidence == "confirmed" {
                status
            } else {
                ListingStatus::Unknown
            },
            price: money(currency, amount)?,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::{ListingStatus, MarketListing, SalesDesk, SalesMoney, merge, money};
    use crate::active_workspace::launch_platforms::LAUNCH_PLATFORMS;

    fn market(kind: &str, status: &str, price: Option<(&str, &str)>) -> MarketListing {
        MarketListing {
            market: u8::try_from(LAUNCH_PLATFORMS.iter().position(|p| *p == kind).unwrap())
                .unwrap(),
            status: ListingStatus::stored(status).unwrap(),
            price: money(
                price.map(|(currency, _)| currency.to_owned()),
                price.map(|(_, amount)| amount.to_owned()),
            )
            .unwrap(),
        }
    }

    #[test]
    fn merge_never_chooses_a_state_or_price_for_the_person() {
        let status =
            |markets: &[MarketListing]| merge("a.test".into(), markets).row().listing_status;
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
        let price = |markets: &[MarketListing]| merge("a.test".into(), markets).row().asking_price;
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
        let mut desk = SalesDesk::new();
        for amount in ["0.00000001", "0.1", "0.2"] {
            desk.add(merge(
                "a.test".into(),
                &[market("atom", "active", Some(("USD", amount)))],
            ));
        }
        assert_eq!(desk.listed_value().unwrap().amount, "0.30000001");
        assert_eq!(desk.rows.len(), 3);

        let mut large = SalesDesk::new();
        for _ in 0..2 {
            large.add(merge(
                "a.test".into(),
                &[market("atom", "active", Some(("USD", "9999999999999999")))],
            ));
        }
        assert_eq!(large.active, 2);
        assert_eq!(large.listed_value(), None);
    }
}
