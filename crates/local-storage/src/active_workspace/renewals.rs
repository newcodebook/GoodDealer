//! Read-only renewals projection: assets still to renew whose recorded expiry falls within the next 60
//! days, soonest first, with the latest available registrar observation's registrar name.
//!
//! The window and the `asOfDate` come from the same SQLite `date('now')` the portfolio's expiring
//! count uses, so the desk lists exactly the assets that count promises. No registrar renewal,
//! quote or pricing capability is qualified, so the projection carries no price, term or plan.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness};

use super::portfolio::{read_freshness, validate_workspace};

/// An asset the workspace still has to renew whose recorded expiry falls in `[today, today + 61
/// days)` in UTC. Sold, dropped and archived assets are no longer the workspace's to renew, so
/// they never count as expiring. The portfolio's expiring count uses this same predicate.
pub(super) const EXPIRING_ASSET: &str = "lifecycle_status NOT IN ('archived', 'sold', 'dropped')
       AND expires_on >= date('now') AND expires_on < date('now', '+61 days')";

const ASSETS: &str = "FROM domain_assets WHERE workspace_id = ?1 AND deleted_at IS NULL";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenewalsReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    pub as_of_date: String,
    pub total_rows: u32,
    pub window: RenewalsWindow,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenewalsWindow {
    pub start_index: u32,
    pub size: u16,
    pub rows: Vec<RenewalRow>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenewalRow {
    pub entity_id: String,
    pub expires_on: String,
    pub auto_renew: Option<bool>,
    pub registrar_name: Option<String>,
}

pub(crate) struct ActiveRenewalsReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActiveRenewalsReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
    ) -> Result<RenewalsReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        if start_index > 1_000_000 || !(1..=200).contains(&size) {
            return Err(PortfolioReadError::WindowRejected);
        }
        let (as_of_date, total_rows): (String, i64) = transaction
            .query_row(
                &format!("SELECT date('now'), count(*) {ASSETS} AND {EXPIRING_ASSET}"),
                [requested_workspace_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let mut statement = transaction
            .prepare(&format!(
                "SELECT entity_id, expires_on, auto_renew,
                   (SELECT registrar_name FROM registrar_observations r
                    WHERE r.workspace_id = domain_assets.workspace_id
                      AND r.entity_id = domain_assets.entity_id
                      AND r.observation_availability = 'available'
                    ORDER BY r.observed_at DESC, r.observation_id DESC LIMIT 1)
                 {ASSETS} AND {EXPIRING_ASSET}
                 ORDER BY expires_on COLLATE BINARY, entity_id COLLATE BINARY
                 LIMIT ?2 OFFSET ?3"
            ))
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        let rows = statement
            .query_map(params![requested_workspace_id, size, start_index], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .map(|row| {
                let (entity_id, expires_on, auto_renew, registrar_name) =
                    row.map_err(|_| PortfolioReadError::ProjectionRejected)?;
                project_row(entity_id, expires_on, auto_renew, registrar_name)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let freshness = read_freshness(&transaction)?;
        drop(statement);
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(RenewalsReadSnapshot {
            schema_version: 1,
            kind: "renewals".to_owned(),
            read_generation: 0,
            freshness,
            as_of_date,
            total_rows: u32::try_from(total_rows)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            window: RenewalsWindow {
                start_index,
                size,
                rows,
            },
        })
    }
}

fn project_row(
    entity_id: String,
    expires_on: String,
    auto_renew: Option<i64>,
    registrar_name: Option<String>,
) -> Result<RenewalRow, PortfolioReadError> {
    // Provider-observed text reaches the Renderer, so it is bounded and free of control characters.
    if registrar_name.as_ref().is_some_and(|name| {
        name.is_empty() || name.chars().count() > 128 || name.chars().any(char::is_control)
    }) {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    Ok(RenewalRow {
        entity_id,
        expires_on,
        auto_renew: match auto_renew {
            None => None,
            Some(0) => Some(false),
            Some(1) => Some(true),
            Some(_) => return Err(PortfolioReadError::ProjectionRejected),
        },
        registrar_name,
    })
}
