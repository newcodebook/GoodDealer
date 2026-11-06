//! Read-only operation history: the local revision ledger of committed asset mutations, newest
//! first, with each edit's changed fields and their previous values.
//!
//! Edits record a full snapshot of their synced fields, so a field's previous value is the same
//! field in the asset's preceding local revision — but only when that revision provably was the
//! asset's state: it was neither conflicted nor rejected, and no server revision was applied between
//! the two commits. Otherwise a pulled remote change may sit in between, so every field is reported
//! with its previous value unknown, never guessed. Mutation, device, lease and payload digest
//! identifiers stay in the Host.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

use crate::portfolio_projection::{
    DomainAssetProjectionRow, Money, PortfolioReadError, PortfolioReadFreshness,
    validate_projection, validate_timestamp,
};

use super::portfolio::{read_freshness, validate_workspace};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    pub total_rows: u32,
    /// Revisions not yet acknowledged by the cloud (pending or sending).
    pub pending_rows: u32,
    /// Revisions committed within the requested day, counted over the whole ledger.
    pub changes_today: u32,
    pub window: HistoryWindow,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryWindow {
    pub start_index: u32,
    pub size: u16,
    pub rows: Vec<HistoryRow>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub local_revision: u64,
    pub entity_id: String,
    pub operation: String,
    pub committed_at: String,
    pub state: String,
    pub server_revision: Option<u64>,
    pub changes: Vec<HistoryFieldChange>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFieldChange {
    pub field_path: String,
    pub value: Value,
    /// Omitted when no earlier revision of this asset records the field, so an unknown value never
    /// reads as a recorded `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_value: Option<Value>,
}

type RawRevision = (
    String,
    i64,
    String,
    String,
    String,
    String,
    Option<i64>,
    i64,
);

pub(crate) struct ActiveHistoryReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActiveHistoryReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
        today: (&str, &str),
    ) -> Result<HistoryReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        if start_index > 1_000_000 || !(1..=200).contains(&size) || !valid_day(today) {
            return Err(PortfolioReadError::WindowRejected);
        }
        // Commit times are written as canonical UTC seconds, so they compare as text with the
        // canonical bounds; the day is counted in the same pass as the totals. The outbox integrity
        // triggers enforce that form only on new writes, so an older malformed row anywhere in the
        // ledger fails the read rather than being silently miscounted on a page nobody reads.
        let (total_rows, pending_rows, changes_today, malformed): (i64, i64, i64, i64) =
            transaction
                .query_row(
                    "SELECT count(*), coalesce(sum(state IN ('pending', 'sending')), 0),
                        coalesce(sum(created_at >= ?2 AND created_at < ?3), 0),
                        coalesce(sum(created_at IS NOT strftime('%Y-%m-%dT%H:%M:%SZ', created_at)
                                     OR substr(created_at, 12, 2) > '23'), 0)
                 FROM sync_outbox WHERE workspace_id = ?1",
                    params![requested_workspace_id, today.0, today.1],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(|_| PortfolioReadError::StorageRejected)?;
        if malformed != 0 {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        let revisions = {
            let mut statement = transaction
                .prepare(
                    "SELECT mutation_id, local_commit_sequence, entity_id, operation_kind,
                            created_at, state, server_revision, base_server_revision
                     FROM sync_outbox WHERE workspace_id = ?1
                     ORDER BY local_commit_sequence DESC, mutation_id DESC LIMIT ?2 OFFSET ?3",
                )
                .map_err(|_| PortfolioReadError::SchemaRejected)?;
            statement
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
                .collect::<Result<Vec<RawRevision>, _>>()
                .map_err(|_| PortfolioReadError::ProjectionRejected)?
        };
        let rows = revisions
            .into_iter()
            .map(|revision| project_revision(&transaction, requested_workspace_id, revision))
            .collect::<Result<Vec<_>, _>>()?;
        let freshness = read_freshness(&transaction)?;
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(HistoryReadSnapshot {
            schema_version: 1,
            kind: "history".to_owned(),
            read_generation: 0,
            freshness,
            total_rows: u32::try_from(total_rows)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            pending_rows: u32::try_from(pending_rows)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            changes_today: u32::try_from(changes_today)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            window: HistoryWindow {
                start_index,
                size,
                rows,
            },
        })
    }
}

/// The Renderer's local day as canonical UTC instants, start before end. A day is 23 to 25 hours
/// around a daylight saving change; a longer span would count more than one day.
fn valid_day((from, until): (&str, &str)) -> bool {
    let canonical = |value: &str| matches!(validate_timestamp(Some(value.to_owned())), Ok(Some(_)));
    canonical(from)
        && canonical(until)
        && from < until
        && seconds(until) - seconds(from) <= 25 * 3_600
}

/// Seconds since the epoch of a canonical UTC timestamp (already validated).
fn seconds(value: &str) -> i64 {
    let number = |start: usize, end: usize| value[start..end].parse::<i64>().unwrap_or(0);
    let (year, month, day) = (number(0, 4), number(5, 7), number(8, 10));
    // Days from the civil date (Howard Hinnant's algorithm), as `format_timestamp_seconds` inverts.
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    days * 86_400 + number(11, 13) * 3_600 + number(14, 16) * 60 + number(17, 19)
}

fn unsigned(value: i64) -> Result<u64, PortfolioReadError> {
    u64::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected)
}

/// Parses a recorded field value and holds it to the same rules as an asset write, so the read
/// rejects any value an edit could not have recorded.
fn field_value(entity_id: &str, field_path: &str, json: &str) -> Result<Value, PortfolioReadError> {
    let rejected = |_| PortfolioReadError::ProjectionRejected;
    let mut row = DomainAssetProjectionRow {
        entity_id: entity_id.to_owned(),
        note: None,
        portfolio_id: None,
        tags: Vec::new(),
        target_price: None,
    };
    match field_path {
        "note" => row.note = serde_json::from_str::<Option<String>>(json).map_err(rejected)?,
        "portfolioId" => {
            row.portfolio_id = serde_json::from_str::<Option<String>>(json).map_err(rejected)?;
        }
        "tags" => row.tags = serde_json::from_str::<Vec<String>>(json).map_err(rejected)?,
        "targetPrice" => {
            row.target_price = serde_json::from_str::<Option<Money>>(json).map_err(rejected)?;
        }
        _ => return Err(PortfolioReadError::ProjectionRejected),
    }
    validate_projection(&[row])?;
    serde_json::from_str(json).map_err(rejected)
}

/// The fields of the asset's preceding local revision when it provably was the asset's state
/// just before this one; `None` when a remote change may lie in between or nothing precedes it.
fn preceding_fields(
    connection: &Connection,
    workspace_id: &str,
    entity_id: &str,
    sequence: i64,
    mutation_id: &str,
    base_server_revision: i64,
) -> Result<Option<Vec<(String, String)>>, PortfolioReadError> {
    let preceding: Option<(String, String, String, i64, Option<i64>)> = connection
        .query_row(
            "SELECT mutation_id, operation_kind, state, base_server_revision, server_revision
             FROM sync_outbox
             WHERE workspace_id = ?1 AND entity_id = ?2
               AND (local_commit_sequence < ?3
                    OR (local_commit_sequence = ?3 AND mutation_id < ?4))
             ORDER BY local_commit_sequence DESC, mutation_id DESC LIMIT 1",
            params![workspace_id, entity_id, sequence, mutation_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    let Some((preceding_id, operation, state, preceding_base, acknowledged_at)) = preceding else {
        return Ok(None);
    };
    // Every commit records the workspace's applied server revision as its base. An unchanged base
    // means no remote revision was applied in between; a base equal to the preceding revision's
    // own acknowledgement means only that acknowledgement was.
    let unbroken =
        base_server_revision == preceding_base || acknowledged_at == Some(base_server_revision);
    if operation != "upsert" || matches!(state.as_str(), "conflicted" | "rejected") || !unbroken {
        return Ok(None);
    }
    revision_fields(connection, workspace_id, &preceding_id).map(Some)
}

fn revision_fields(
    connection: &Connection,
    workspace_id: &str,
    mutation_id: &str,
) -> Result<Vec<(String, String)>, PortfolioReadError> {
    let mut statement = connection
        .prepare(
            "SELECT field_path, field_value_json FROM sync_outbox_fields
             WHERE workspace_id = ?1 AND mutation_id = ?2 ORDER BY ordinal",
        )
        .map_err(|_| PortfolioReadError::SchemaRejected)?;
    statement
        .query_map(params![workspace_id, mutation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| PortfolioReadError::ProjectionRejected)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| PortfolioReadError::ProjectionRejected)
}

fn project_revision(
    connection: &Connection,
    workspace_id: &str,
    raw: RawRevision,
) -> Result<HistoryRow, PortfolioReadError> {
    let (
        mutation_id,
        sequence,
        entity_id,
        operation,
        committed_at,
        state,
        server_revision,
        base_server_revision,
    ) = raw;
    let operation = match operation.as_str() {
        "upsert" => "edit",
        "delete" => "delete",
        _ => return Err(PortfolioReadError::ProjectionRejected),
    };
    if ![
        "pending",
        "sending",
        "acknowledged",
        "conflicted",
        "rejected",
    ]
    .contains(&state.as_str())
    {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let fields = revision_fields(connection, workspace_id, &mutation_id)?;
    let preceding = if fields.is_empty() {
        None
    } else {
        preceding_fields(
            connection,
            workspace_id,
            &entity_id,
            sequence,
            &mutation_id,
            base_server_revision,
        )?
    };
    let mut changes = Vec::with_capacity(fields.len());
    for (field_path, json) in fields {
        let value = field_value(&entity_id, &field_path, &json)?;
        let previous_value = match &preceding {
            None => None,
            // A known preceding snapshot records every field, so a missing one is corrupt.
            Some(snapshot) => {
                let (_, previous) = snapshot
                    .iter()
                    .find(|(path, _)| *path == field_path)
                    .ok_or(PortfolioReadError::ProjectionRejected)?;
                Some(field_value(&entity_id, &field_path, previous)?)
            }
        };
        // Only a provably unchanged field is left out; an unknown previous value is always kept.
        if previous_value.as_ref() != Some(&value) {
            changes.push(HistoryFieldChange {
                field_path,
                value,
                previous_value,
            });
        }
    }
    Ok(HistoryRow {
        local_revision: unsigned(sequence)?,
        entity_id,
        operation: operation.to_owned(),
        committed_at: validate_timestamp(Some(committed_at))?
            .ok_or(PortfolioReadError::ProjectionRejected)?,
        state,
        server_revision: server_revision.map(unsigned).transpose()?,
        changes,
    })
}
