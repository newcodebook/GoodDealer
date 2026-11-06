//! Read-only renewals projection: assets still to renew whose recorded expiry falls within the next 60
//! days, soonest first, with the latest confirmed registrar observation's registrar name.
//!
//! The window and the `asOfDate` come from one [`HostDay`] per read, the same kind of day the
//! portfolio's expiring count and row flags use, so the desk lists exactly the assets that count
//! promises. No registrar renewal,
//! quote or pricing capability is qualified, so the projection carries no price, term or plan.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness};

use super::portfolio::{read_freshness, validate_workspace};

/// An asset of `alias` the workspace still has to renew whose recorded expiry falls in `[today,
/// today + 61 days)` in UTC. Sold, dropped and archived assets are no longer the workspace's to
/// renew, so they never count as expiring; the schema admits only those three and `active` and
/// `expired`, so naming the two kept states selects the same rows while letting SQLite seek
/// `domain_assets_by_status_expiry` by status and expiry range instead of scanning the workspace.
/// The column references carry the alias so a join cannot bind them to another table's columns. The
/// portfolio's expiring count and row flags use this same predicate.
pub(super) fn expiring_asset(alias: &str, today: &HostDay) -> String {
    let today = today.as_str();
    format!(
        "{alias}.lifecycle_status IN ('active', 'expired')
       AND {alias}.expires_on >= '{today}' AND {alias}.expires_on < date('{today}', '+61 days')"
    )
}

/// The Host's UTC day, read once per read transaction. SQLite evaluates `date('now')` once per
/// statement, so a read whose statements each asked for it could straddle midnight and count,
/// flag and list against different days. The value comes only from SQLite's own `date('now')` and
/// is checked to be a canonical `YYYY-MM-DD` date, which is what makes it safe to place in SQL text.
/// It is the only source of "today" for Host reads: a read that filters by date takes one.
pub(super) struct HostDay(String);

impl HostDay {
    pub(super) fn read(connection: &Connection) -> Result<Self, PortfolioReadError> {
        let day: String = connection
            .query_row("SELECT date('now')", [], |row| row.get(0))
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        if !crate::portfolio_projection::valid_date(&day) {
            return Err(PortfolioReadError::StorageRejected);
        }
        Ok(Self(day))
    }

    pub(super) fn as_str(&self) -> &str {
        &self.0
    }
}

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
    /// Whole-window counts, so a desk that shows one page still reports coverage for every asset.
    /// Assets with no recorded setting are `total_rows` minus both counts.
    pub auto_renew_enabled_count: u32,
    pub auto_renew_disabled_count: u32,
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
        let today = HostDay::read(&transaction)?;
        let expiring = expiring_asset("domain_assets", &today);
        let (total_rows, enabled, disabled, malformed): (i64, i64, i64, i64) =
            transaction
                .query_row(
                    &format!(
                        "SELECT count(*),
                           coalesce(sum(auto_renew = 1), 0), coalesce(sum(auto_renew = 0), 0),
                           coalesce(sum(auto_renew NOT IN (0, 1) OR expires_on IS NOT date(expires_on)), 0)
                         {ASSETS} AND {expiring}"
                    ),
                    [requested_workspace_id],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                        ))
                    },
                )
                .map_err(|_| PortfolioReadError::StorageRejected)?;
        // The schema admits only 0, 1 or NULL; should that ever loosen, a value that is neither on,
        // off nor unrecorded fails the read, as it does per row, instead of being counted as
        // unrecorded on pages the Renderer never sees. The storage-integrity triggers reject a
        // malformed `expires_on` only on new writes, and the window compares it as text, so an older
        // malformed date that sorts into the window would be counted too; `date()` returns a value
        // unchanged only for a valid `YYYY-MM-DD` date.
        if malformed != 0 {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        let count =
            |value: i64| u32::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected);
        let latest_name = registrar_name("domain_assets");
        // Every expiring asset's registrar name is validated, not only the page's: a bad name on a
        // page nobody reads would otherwise stay counted while no read ever rejects it. Names repeat,
        // so only distinct ones reach Rust. Every available observation's name is checked first; the
        // names the desk shows are a subset of those, so the per-asset latest-confirmed scan runs only
        // when some invalid name exists, to decide whether an expiring asset actually shows it.
        let all_valid = registrar_names_valid(
            &transaction,
            "SELECT DISTINCT registrar_name FROM registrar_observations
             WHERE workspace_id = ?1 AND observation_availability = 'available'",
            requested_workspace_id,
        )?;
        if !all_valid
            && !registrar_names_valid(
                &transaction,
                &format!("SELECT DISTINCT {latest_name} {ASSETS} AND {expiring}"),
                requested_workspace_id,
            )?
        {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        let mut statement = transaction
            .prepare(&format!(
                // The page is cut first, so the registrar lookup runs for its rows only rather than
                // for every row the offset skips.
                "SELECT page.entity_id, page.expires_on, page.auto_renew, {page_registrar_name}
                 FROM (SELECT workspace_id, entity_id, expires_on, auto_renew
                       {ASSETS} AND {expiring}
                       ORDER BY expires_on COLLATE BINARY, entity_id COLLATE BINARY
                       LIMIT ?2 OFFSET ?3) page
                 ORDER BY page.expires_on COLLATE BINARY, page.entity_id COLLATE BINARY",
                page_registrar_name = registrar_name("page")
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
            as_of_date: today.0,
            total_rows: count(total_rows)?,
            auto_renew_enabled_count: count(enabled)?,
            auto_renew_disabled_count: count(disabled)?,
            window: RenewalsWindow {
                start_index,
                size,
                rows,
            },
        })
    }
}

/// Whether every non-null name `query` (bound to the workspace as `?1`) returns is a valid registrar
/// name.
fn registrar_names_valid(
    connection: &Connection,
    query: &str,
    workspace_id: &str,
) -> Result<bool, PortfolioReadError> {
    let mut statement = connection
        .prepare(query)
        .map_err(|_| PortfolioReadError::SchemaRejected)?;
    for name in statement
        .query_map([workspace_id], |row| row.get::<_, Option<String>>(0))
        .map_err(|_| PortfolioReadError::ProjectionRejected)?
    {
        let name = name.map_err(|_| PortfolioReadError::ProjectionRejected)?;
        if name
            .as_deref()
            .is_some_and(|name| !crate::portfolio_projection::valid_registrar_name(name))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// The latest confirmed, available registrar observation's registrar name for each `alias` row.
fn registrar_name(alias: &str) -> String {
    format!(
        "(SELECT registrar_name FROM registrar_observations r
          WHERE r.workspace_id = {alias}.workspace_id
            AND r.entity_id = {alias}.entity_id
            AND r.observation_availability = 'available' AND {confirmed}
          ORDER BY r.observed_at DESC, r.observation_id DESC LIMIT 1)",
        confirmed = super::observation_runs::confirmed("r")
    )
}

fn project_row(
    entity_id: String,
    expires_on: String,
    auto_renew: Option<i64>,
    registrar_name: Option<String>,
) -> Result<RenewalRow, PortfolioReadError> {
    // Provider-observed text reaches the Renderer, so it is bounded and free of control characters.
    if registrar_name
        .as_deref()
        .is_some_and(|name| !crate::portfolio_projection::valid_registrar_name(name))
    {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The rows of `(entity, status, expires_on)` the predicate selects for a fixed day.
    fn expiring_on(day: &str, rows: &[(&str, &str, &str)]) -> Vec<String> {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE a (entity_id TEXT, lifecycle_status TEXT, expires_on TEXT)",
            )
            .unwrap();
        for row in rows {
            connection
                .execute(
                    "INSERT INTO a VALUES (?1, ?2, ?3)",
                    params![row.0, row.1, row.2],
                )
                .unwrap();
        }
        let predicate = expiring_asset("a", &HostDay(day.to_owned()));
        let mut statement = connection
            .prepare(&format!(
                "SELECT entity_id FROM a WHERE {predicate} ORDER BY entity_id"
            ))
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn the_window_follows_the_given_day_not_the_clock() {
        // 2026-12-15 + 61 days is 2027-02-14, so the window crosses a year end and is half-open.
        let rows = [
            ("before", "active", "2026-12-14"),
            ("first", "active", "2026-12-15"),
            ("last", "expired", "2027-02-13"),
            ("after", "active", "2027-02-14"),
            ("sold", "sold", "2026-12-20"),
            ("dropped", "dropped", "2026-12-20"),
            ("archived", "archived", "2026-12-20"),
        ];
        assert_eq!(expiring_on("2026-12-15", &rows), ["first", "last"]);
        // A day far from the test machine's clock still decides alone.
        assert_eq!(expiring_on("2027-02-13", &rows), ["after", "last"]);
    }

    #[test]
    fn host_day_is_sqlites_canonical_utc_date() {
        let connection = Connection::open_in_memory().unwrap();
        let day = HostDay::read(&connection).unwrap();
        let now: String = connection
            .query_row("SELECT date('now')", [], |row| row.get(0))
            .unwrap();
        // Equal unless the two reads straddle midnight, in which case the second is the next day.
        assert!(day.as_str() == now || day.as_str() < now.as_str());
        assert!(crate::portfolio_projection::valid_date(day.as_str()));
    }
}
