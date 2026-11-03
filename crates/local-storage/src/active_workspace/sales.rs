//! Read-only sales projection: the latest committed marketplace listing observation for each
//! (asset, marketplace) pair whose listing is not `unlisted`.
//!
//! Only observed listing facts leave the Host: status, asking price, observation time and evidence.
//! Observation, run and Provider version identifiers stay local. Offers, deals, view counts and
//! sales totals are not observed by any qualified capability, so the projection carries none.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness, validate_timestamp};

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

const LATEST_LISTINGS: &str = "WITH latest AS (
       SELECT m.entity_id, m.marketplace_kind, m.listing_status, m.asking_price_currency,
              m.asking_price_amount, m.observed_at, m.observation_availability, m.evidence_status,
              row_number() OVER (
                PARTITION BY m.entity_id, m.marketplace_kind
                ORDER BY m.observed_at DESC, m.listing_observation_id DESC
              ) AS position
       FROM marketplace_listing_observations m
       JOIN domain_assets a
         ON a.workspace_id = m.workspace_id AND a.entity_id = m.entity_id AND a.deleted_at IS NULL
       WHERE m.workspace_id = ?1
     )
     SELECT entity_id, marketplace_kind, listing_status, asking_price_currency, asking_price_amount,
            observed_at, observation_availability, evidence_status
     FROM latest WHERE position = 1 AND listing_status <> 'unlisted'";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SalesReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    pub total_rows: u32,
    pub window: SalesWindow,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SalesWindow {
    pub start_index: u32,
    pub size: u16,
    pub rows: Vec<SalesListingRow>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SalesListingRow {
    pub entity_id: String,
    pub marketplace_kind: String,
    pub listing_status: String,
    pub asking_price: Option<SalesMoney>,
    pub observed_at: String,
    pub availability: String,
    pub evidence_status: String,
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
    String,
);

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
        let total_rows: i64 = transaction
            .query_row(
                &format!("SELECT count(*) FROM ({LATEST_LISTINGS})"),
                [requested_workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let mut statement = transaction
            .prepare(&format!(
                "{LATEST_LISTINGS}
                 ORDER BY entity_id COLLATE BINARY, marketplace_kind COLLATE BINARY
                 LIMIT ?2 OFFSET ?3"
            ))
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        let raw = statement
            .query_map(params![requested_workspace_id, size, start_index], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            })
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<Vec<RawListing>, _>>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let rows = raw
            .into_iter()
            .map(project_listing)
            .collect::<Result<Vec<_>, _>>()?;
        let freshness = read_freshness(&transaction)?;
        drop(statement);
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(SalesReadSnapshot {
            schema_version: 1,
            kind: "sales".to_owned(),
            read_generation: 0,
            freshness,
            total_rows: u32::try_from(total_rows)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            window: SalesWindow {
                start_index,
                size,
                rows,
            },
        })
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

fn project_listing(raw: RawListing) -> Result<SalesListingRow, PortfolioReadError> {
    let (entity_id, kind, status, currency, amount, observed_at, availability, evidence) = raw;
    Ok(SalesListingRow {
        entity_id,
        marketplace_kind: closed(kind, &MARKETPLACES)?,
        listing_status: closed(
            status,
            &[
                "draft",
                "active",
                "reserved",
                "sold",
                "suspended",
                "unknown",
            ],
        )?,
        asking_price: money(currency, amount)?,
        observed_at: validate_timestamp(Some(observed_at))?
            .ok_or(PortfolioReadError::ProjectionRejected)?,
        availability: closed(availability, &["available", "unavailable"])?,
        evidence_status: closed(evidence, &["confirmed", "stale", "conflicted", "unknown"])?,
    })
}
