//! Read-only batch operation list: one row per operation plan, newest first, with its plan and
//! execution phases, planned item counts and, once an operation exists, the latest attempt outcome
//! per item.
//!
//! Plan, item, operation, attempt, connection and Provider request identifiers stay in the Host.
//! Platforms are reported only as their ADR-0027 launch kind.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness, validate_timestamp};

use super::portfolio::{read_freshness, validate_workspace};

/// ADR-0027 launch platforms; a plan item bound to any other Provider kind fails the read.
const PROVIDER_KINDS: [&str; 8] = [
    "afternic",
    "atom",
    "cloudflare",
    "dynadot",
    "godaddy",
    "namecheap",
    "porkbun",
    "spaceship",
];

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchOperationsReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    pub total_rows: u32,
    pub window: BatchOperationsWindow,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchOperationsWindow {
    pub start_index: u32,
    pub size: u16,
    pub rows: Vec<BatchOperationRow>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchOperationRow {
    pub title: String,
    pub operation_kind: String,
    pub plan_phase: String,
    pub operation_phase: Option<String>,
    pub risk_level: String,
    pub item_count: u32,
    /// Distinct assets the plan targets; one asset can carry several items.
    pub target_count: u32,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub provider_kinds: Vec<String>,
    pub planned: BatchPlannedCounts,
    pub results: Option<BatchResultCounts>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchPlannedCounts {
    pub automatic: u32,
    pub manual: u32,
    pub unsupported: u32,
    pub conflict: u32,
    pub excluded: u32,
    pub high_risk: u32,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchResultCounts {
    pub queued: u32,
    pub running: u32,
    pub succeeded: u32,
    pub waiting_remote: u32,
    pub manual_action_required: u32,
    pub failed_retryable: u32,
    pub outcome_unknown: u32,
    pub failed_final: u32,
    pub cancelled: u32,
    pub rolled_back: u32,
}

type RawPlan = (String, String, String, String, String, i64, String);

pub(crate) struct ActiveBatchOperationsReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActiveBatchOperationsReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
    ) -> Result<BatchOperationsReadSnapshot, PortfolioReadError> {
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
                "SELECT count(*) FROM operation_plans WHERE workspace_id = ?1",
                [requested_workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let plans = {
            let mut statement = transaction
                .prepare(
                    "SELECT plan_id, title, operation_kind, phase, risk_level, item_count, created_at
                     FROM operation_plans WHERE workspace_id = ?1
                     ORDER BY created_at DESC, plan_id DESC LIMIT ?2 OFFSET ?3",
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
                .collect::<Result<Vec<RawPlan>, _>>()
                .map_err(|_| PortfolioReadError::ProjectionRejected)?
        };
        let rows = plans
            .into_iter()
            .map(|plan| project_plan(&transaction, requested_workspace_id, plan))
            .collect::<Result<Vec<_>, _>>()?;
        let freshness = read_freshness(&transaction)?;
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(BatchOperationsReadSnapshot {
            schema_version: 1,
            kind: "batch_operations".to_owned(),
            read_generation: 0,
            freshness,
            total_rows: u32::try_from(total_rows)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            window: BatchOperationsWindow {
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

fn count(value: i64) -> Result<u32, PortfolioReadError> {
    u32::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected)
}

fn project_plan(
    connection: &Connection,
    workspace_id: &str,
    raw: RawPlan,
) -> Result<BatchOperationRow, PortfolioReadError> {
    let (plan_id, title, operation_kind, plan_phase, risk_level, item_count, created_at) = raw;
    // The title is Host-authored but reaches the Renderer as display text.
    if title.chars().any(char::is_control) {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let kind_ok = (1..=64).contains(&operation_kind.len())
        && operation_kind.starts_with(|first: char| first.is_ascii_lowercase())
        && operation_kind
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
    if !kind_ok {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let planned = planned_counts(connection, workspace_id, &plan_id)?;
    let provider_kinds = plan_provider_kinds(connection, workspace_id, &plan_id)?;
    let target_count: i64 = connection
        .query_row(
            "SELECT count(DISTINCT entity_id) FROM operation_plan_items
             WHERE workspace_id = ?1 AND plan_id = ?2",
            params![workspace_id, plan_id],
            |row| row.get(0),
        )
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    // The schema does not make a plan's operation unique, so a second one fails the read instead of
    // letting one silently stand for both.
    let operations: i64 = connection
        .query_row(
            "SELECT count(*) FROM operations WHERE workspace_id = ?1 AND plan_id = ?2",
            params![workspace_id, plan_id],
            |row| row.get(0),
        )
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    if operations > 1 {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let operation: Option<(String, String, Option<String>)> = connection
        .query_row(
            "SELECT operation_id, phase, completed_at FROM operations
             WHERE workspace_id = ?1 AND plan_id = ?2",
            params![workspace_id, plan_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    let (operation_phase, completed_at, results) = match operation {
        None => (None, None, None),
        Some((operation_id, phase, completed_at)) => (
            Some(closed(
                phase,
                &[
                    "queued",
                    "running",
                    "completed",
                    "partially_failed",
                    "cancelled",
                    "rolled_back",
                ],
            )?),
            validate_timestamp(completed_at)?,
            Some(latest_attempts(connection, workspace_id, &operation_id)?),
        ),
    };
    Ok(BatchOperationRow {
        title,
        operation_kind,
        plan_phase: closed(
            plan_phase,
            &[
                "planned",
                "awaiting_approval",
                "approved",
                "cancelled",
                "expired",
                "executing",
                "completed",
            ],
        )?,
        operation_phase,
        risk_level: closed(risk_level, &["standard", "high"])?,
        item_count: count(item_count)?,
        target_count: count(target_count)?,
        created_at: validate_timestamp(Some(created_at))?
            .ok_or(PortfolioReadError::ProjectionRejected)?,
        completed_at,
        provider_kinds,
        planned,
        results,
    })
}

/// Buckets plan items by inclusion first, then execution mode; high risk counts included items only.
fn planned_counts(
    connection: &Connection,
    workspace_id: &str,
    plan_id: &str,
) -> Result<BatchPlannedCounts, PortfolioReadError> {
    let mut planned = BatchPlannedCounts::default();
    let mut statement = connection
        .prepare(
            "SELECT execution_mode, inclusion_status, risk_level, count(*)
             FROM operation_plan_items WHERE workspace_id = ?1 AND plan_id = ?2
             GROUP BY execution_mode, inclusion_status, risk_level",
        )
        .map_err(|_| PortfolioReadError::SchemaRejected)?;
    let groups = statement
        .query_map(params![workspace_id, plan_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    for group in groups {
        let (mode, inclusion, risk, total) =
            group.map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let total = count(total)?;
        let bucket = match (inclusion.as_str(), mode.as_str()) {
            ("excluded", _) => &mut planned.excluded,
            ("conflict", _) => &mut planned.conflict,
            ("included", "automatic") => &mut planned.automatic,
            ("included", "manual") => &mut planned.manual,
            ("included", "unsupported") => &mut planned.unsupported,
            _ => return Err(PortfolioReadError::ProjectionRejected),
        };
        *bucket += total;
        if risk == "high" && inclusion == "included" {
            planned.high_risk += total;
        }
    }
    Ok(planned)
}

fn plan_provider_kinds(
    connection: &Connection,
    workspace_id: &str,
    plan_id: &str,
) -> Result<Vec<String>, PortfolioReadError> {
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT c.provider_kind FROM operation_plan_items i
             JOIN local_provider_connections c
               ON c.workspace_id = i.workspace_id AND c.connection_id = i.connection_id
             WHERE i.workspace_id = ?1 AND i.plan_id = ?2
             ORDER BY c.provider_kind COLLATE BINARY",
        )
        .map_err(|_| PortfolioReadError::SchemaRejected)?;
    statement
        .query_map(params![workspace_id, plan_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|_| PortfolioReadError::ProjectionRejected)?
        .map(|kind| {
            closed(
                kind.map_err(|_| PortfolioReadError::ProjectionRejected)?,
                &PROVIDER_KINDS,
            )
        })
        .collect::<Result<Vec<_>, _>>()
}

/// Counts each item's latest attempt status; items without an attempt are not counted.
fn latest_attempts(
    connection: &Connection,
    workspace_id: &str,
    operation_id: &str,
) -> Result<BatchResultCounts, PortfolioReadError> {
    let mut results = BatchResultCounts::default();
    let mut statement = connection
        .prepare(
            "SELECT status, count(*) FROM operation_attempts a
             WHERE workspace_id = ?1 AND operation_id = ?2
               AND attempt_number = (SELECT max(attempt_number) FROM operation_attempts b
                 WHERE b.workspace_id = a.workspace_id AND b.operation_id = a.operation_id
                   AND b.item_id = a.item_id)
             GROUP BY status",
        )
        .map_err(|_| PortfolioReadError::SchemaRejected)?;
    let groups = statement
        .query_map(params![workspace_id, operation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    for group in groups {
        let (status, total) = group.map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let bucket = match status.as_str() {
            "queued" => &mut results.queued,
            "running" => &mut results.running,
            "succeeded" => &mut results.succeeded,
            "waiting_remote" => &mut results.waiting_remote,
            "manual_action_required" => &mut results.manual_action_required,
            "failed_retryable" => &mut results.failed_retryable,
            "outcome_unknown" => &mut results.outcome_unknown,
            "failed_final" => &mut results.failed_final,
            "cancelled" => &mut results.cancelled,
            "rolled_back" => &mut results.rolled_back,
            _ => return Err(PortfolioReadError::ProjectionRejected),
        };
        *bucket = count(total)?;
    }
    Ok(results)
}
