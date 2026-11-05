//! Read-only manual task inbox: plan items whose latest attempt requires the person to act in a
//! platform's own console, grouped into one task per operation, connection and capability, oldest
//! waiting first.
//!
//! A retry of the same item returns to the same task, so tasks never duplicate. Plan, item,
//! operation, attempt, connection, Provider account and request identifiers stay in the Host;
//! platforms are reported only as their ADR-0027 launch kind and connection label.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::portfolio_projection::{
    PortfolioReadError, PortfolioReadFreshness, valid_connection_label, validate_domain_asset_id,
    validate_timestamp,
};

use super::launch_platforms::LAUNCH_PLATFORMS;
use super::portfolio::{read_freshness, validate_workspace};

/// The inbox names at most this many affected domains per task and counts the rest, so a task
/// carries only that sample; `domain_count` is exact. The desktop pins it to
/// `manualTaskDomainSampleLimit` in `@gooddealer/client-core`, whose read contract rejects any
/// other sample size.
const DOMAIN_LIMIT: u32 = 3;

/// Latest attempt per item that waits on the person, grouped into tasks. An item waits from when
/// that attempt was first observed to need the person (its earliest `manual_action_required`
/// result), not from when the attempt started, which may be long before the platform asked; an
/// attempt whose result is not recorded yet waits from its start. A result timestamp before the
/// start (a platform clock behind the device's) is clamped to the start, so no wait begins before
/// its attempt. A waiting attempt always has a start, so the scalar `max` never sees NULL.
const TASKS: &str = "
    WITH latest AS (
      SELECT a.operation_id, a.plan_id, a.item_id, a.attempt_number,
             max(coalesce((SELECT min(r.observed_at) FROM operation_results r
               WHERE r.workspace_id = a.workspace_id AND r.operation_id = a.operation_id
                 AND r.item_id = a.item_id AND r.attempt_number = a.attempt_number
                 AND r.outcome = 'manual_action_required'), a.started_at), a.started_at)
               AS waiting_since
      FROM operation_attempts a
      WHERE a.workspace_id = ?1 AND a.status = 'manual_action_required'
        AND a.attempt_number = (SELECT max(b.attempt_number) FROM operation_attempts b
          WHERE b.workspace_id = a.workspace_id AND b.operation_id = a.operation_id
            AND b.item_id = a.item_id)
    )
    SELECT l.operation_id, i.connection_id, i.capability, p.title, p.operation_kind,
           max(i.risk_level = 'high'), count(*), min(l.waiting_since)
    FROM latest l
    JOIN operation_plan_items i
      ON i.workspace_id = ?1 AND i.plan_id = l.plan_id AND i.item_id = l.item_id
    JOIN operation_plans p ON p.workspace_id = ?1 AND p.plan_id = l.plan_id
    GROUP BY l.operation_id, i.connection_id, i.capability";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManualTasksReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    pub total_rows: u32,
    pub window: ManualTasksWindow,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManualTasksWindow {
    pub start_index: u32,
    pub size: u16,
    pub rows: Vec<ManualTaskRow>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManualTaskRow {
    pub title: String,
    pub operation_kind: String,
    pub capability: String,
    /// `None` when the items are bound to no Provider connection.
    pub provider_kind: Option<String>,
    pub connection_label: Option<String>,
    pub high_risk: bool,
    pub item_count: u32,
    /// When the earliest of these attempts was observed to need the person, or started when no
    /// result is recorded yet; the order of the inbox.
    pub waiting_since: String,
    /// The latest recorded result of these waiting attempts, if any was observed.
    pub last_observed_at: Option<String>,
    pub domain_count: u32,
    /// The first affected domains in byte order, at most `DOMAIN_LIMIT`.
    pub domains: Vec<String>,
}

type RawTask = (
    String,
    Option<String>,
    String,
    String,
    String,
    i64,
    i64,
    Option<String>,
);

pub(crate) struct ActiveManualTasksReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActiveManualTasksReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
    ) -> Result<ManualTasksReadSnapshot, PortfolioReadError> {
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
                &format!("SELECT count(*) FROM ({TASKS})"),
                [requested_workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let tasks = {
            let mut statement = transaction
                .prepare(&format!(
                    "{TASKS} ORDER BY min(l.waiting_since), l.operation_id, i.connection_id,
                     i.capability LIMIT ?2 OFFSET ?3"
                ))
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
                .collect::<Result<Vec<RawTask>, _>>()
                .map_err(|_| PortfolioReadError::ProjectionRejected)?
        };
        let rows = tasks
            .into_iter()
            .map(|task| project_task(&transaction, requested_workspace_id, task))
            .collect::<Result<Vec<_>, _>>()?;
        let freshness = read_freshness(&transaction)?;
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(ManualTasksReadSnapshot {
            schema_version: 1,
            kind: "manual_tasks".to_owned(),
            read_generation: 0,
            freshness,
            total_rows: count(total_rows)?,
            window: ManualTasksWindow {
                start_index,
                size,
                rows,
            },
        })
    }
}

fn count(value: i64) -> Result<u32, PortfolioReadError> {
    u32::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected)
}

/// Host-authored tokens reach the Renderer, so they must be closed lowercase identifiers.
fn token(value: String) -> Result<String, PortfolioReadError> {
    let valid = (1..=64).contains(&value.len())
        && value.starts_with(|first: char| first.is_ascii_lowercase())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
    if valid {
        Ok(value)
    } else {
        Err(PortfolioReadError::ProjectionRejected)
    }
}

fn display_text(value: String, limit: usize) -> Result<String, PortfolioReadError> {
    if value.is_empty() || value.chars().count() > limit || value.chars().any(char::is_control) {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    Ok(value)
}

fn project_task(
    connection: &Connection,
    workspace_id: &str,
    raw: RawTask,
) -> Result<ManualTaskRow, PortfolioReadError> {
    let (
        operation_id,
        connection_id,
        capability,
        title,
        operation_kind,
        high_risk,
        item_count,
        waiting_since,
    ) = raw;
    let (provider_kind, connection_label) = match &connection_id {
        None => (None, None),
        Some(id) => {
            let (kind, label): (String, String) = connection
                .query_row(
                    "SELECT provider_kind, display_label FROM local_provider_connections
                     WHERE workspace_id = ?1 AND connection_id = ?2",
                    params![workspace_id, id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| PortfolioReadError::ProjectionRejected)?;
            if !LAUNCH_PLATFORMS.contains(&kind.as_str()) {
                return Err(PortfolioReadError::ProjectionRejected);
            }
            if !valid_connection_label(&label) {
                return Err(PortfolioReadError::ProjectionRejected);
            }
            (Some(kind), Some(label))
        }
    };
    // `IS` matches a NULL connection, so a task without one still selects only its own items.
    let item_filter = "FROM operation_attempts a
         JOIN operation_plan_items i
           ON i.workspace_id = a.workspace_id AND i.plan_id = a.plan_id AND i.item_id = a.item_id
         WHERE a.workspace_id = ?1 AND a.operation_id = ?2 AND i.connection_id IS ?3
           AND i.capability = ?4 AND a.status = 'manual_action_required'
           AND a.attempt_number = (SELECT max(b.attempt_number) FROM operation_attempts b
             WHERE b.workspace_id = a.workspace_id AND b.operation_id = a.operation_id
               AND b.item_id = a.item_id)";
    let task = params![workspace_id, operation_id, connection_id, capability];
    let (domain_count, last_observed_at): (i64, Option<String>) = connection
        .query_row(
            &format!(
                "SELECT count(DISTINCT i.entity_id),
                        (SELECT max(r.observed_at) FROM operation_results r
                         WHERE r.workspace_id = ?1 AND r.operation_id = ?2
                           AND EXISTS (SELECT 1 {item_filter}
                             AND a.item_id = r.item_id AND a.attempt_number = r.attempt_number))
                 {item_filter}"
            ),
            task,
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| PortfolioReadError::ProjectionRejected)?;
    let domains = {
        let mut statement = connection
            .prepare(&format!(
                "SELECT DISTINCT i.entity_id {item_filter} AND i.entity_id IS NOT NULL
                 ORDER BY i.entity_id COLLATE BINARY LIMIT {DOMAIN_LIMIT}"
            ))
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        statement
            .query_map(task, |row| row.get::<_, String>(0))
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
    };
    for domain in &domains {
        validate_domain_asset_id(domain)?;
    }
    Ok(ManualTaskRow {
        title: display_text(title, 500)?,
        operation_kind: token(operation_kind)?,
        capability: token(capability)?,
        provider_kind,
        connection_label,
        high_risk: high_risk != 0,
        item_count: count(item_count)?,
        waiting_since: validate_timestamp(waiting_since)?
            .ok_or(PortfolioReadError::ProjectionRejected)?,
        last_observed_at: validate_timestamp(last_observed_at)?,
        domain_count: count(domain_count)?,
        domains,
    })
}
