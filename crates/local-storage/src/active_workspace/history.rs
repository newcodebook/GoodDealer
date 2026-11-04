//! Read-only operation history: the local revision ledger of committed asset mutations, newest
//! first, with each edit's changed fields and their previous values.
//!
//! Edits record a full snapshot of their synced fields, so a field's previous value is the same
//! field in the asset's preceding local revision; with no preceding revision it is unknown, never
//! empty. Remote changes pulled between two local revisions are not revisions of this ledger, so a
//! diff compares local revisions only. Mutation, device, lease and payload digest identifiers stay
//! in the Host.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness, validate_timestamp};

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

type RawRevision = (String, i64, String, String, String, String, Option<i64>);

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
    ) -> Result<HistoryReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        if start_index > 1_000_000 || !(1..=200).contains(&size) {
            return Err(PortfolioReadError::WindowRejected);
        }
        let (total_rows, pending_rows): (i64, i64) = transaction
            .query_row(
                "SELECT count(*), coalesce(sum(state IN ('pending', 'sending')), 0)
                 FROM sync_outbox WHERE workspace_id = ?1",
                [requested_workspace_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let revisions = {
            let mut statement = transaction
                .prepare(
                    "SELECT mutation_id, local_commit_sequence, entity_id, operation_kind,
                            created_at, state, server_revision
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
            window: HistoryWindow {
                start_index,
                size,
                rows,
            },
        })
    }
}

fn unsigned(value: i64) -> Result<u64, PortfolioReadError> {
    u64::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected)
}

/// Parses a recorded field value and rejects any shape the field cannot hold.
fn field_value(field_path: &str, json: &str) -> Result<Value, PortfolioReadError> {
    let value: Value =
        serde_json::from_str(json).map_err(|_| PortfolioReadError::ProjectionRejected)?;
    let valid = match field_path {
        "note" | "portfolioId" => value.is_null() || value.is_string(),
        "tags" => value
            .as_array()
            .is_some_and(|tags| tags.iter().all(Value::is_string)),
        "targetPrice" => {
            value.is_null()
                || value.as_object().is_some_and(|money| {
                    money.len() == 2
                        && money.get("currency").is_some_and(Value::is_string)
                        && money.get("amount").is_some_and(Value::is_string)
                })
        }
        _ => false,
    };
    if valid {
        Ok(value)
    } else {
        Err(PortfolioReadError::ProjectionRejected)
    }
}

fn project_revision(
    connection: &Connection,
    workspace_id: &str,
    raw: RawRevision,
) -> Result<HistoryRow, PortfolioReadError> {
    let (mutation_id, local_revision, entity_id, operation, committed_at, state, server_revision) =
        raw;
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
    let sequence = local_revision;
    let local_revision = unsigned(local_revision)?;
    let fields = {
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
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
    };
    let mut changes = Vec::with_capacity(fields.len());
    for (field_path, json) in fields {
        let value = field_value(&field_path, &json)?;
        // The same field in this asset's closest earlier mutation that recorded it.
        let previous: Option<String> = connection
            .query_row(
                "SELECT f.field_value_json FROM sync_outbox o
                 JOIN sync_outbox_fields f
                   ON f.workspace_id = o.workspace_id AND f.mutation_id = o.mutation_id
                 WHERE o.workspace_id = ?1 AND o.entity_id = ?2 AND f.field_path = ?3
                   AND (o.local_commit_sequence < ?4
                        OR (o.local_commit_sequence = ?4 AND o.mutation_id < ?5))
                 ORDER BY o.local_commit_sequence DESC, o.mutation_id DESC LIMIT 1",
                params![workspace_id, entity_id, field_path, sequence, mutation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let previous_value = previous
            .map(|json| field_value(&field_path, &json))
            .transpose()?;
        if previous_value.as_ref() != Some(&value) {
            changes.push(HistoryFieldChange {
                field_path,
                value,
                previous_value,
            });
        }
    }
    Ok(HistoryRow {
        local_revision,
        entity_id,
        operation: operation.to_owned(),
        committed_at: validate_timestamp(Some(committed_at))?
            .ok_or(PortfolioReadError::ProjectionRejected)?,
        state,
        server_revision: server_revision.map(unsigned).transpose()?,
        changes,
    })
}
