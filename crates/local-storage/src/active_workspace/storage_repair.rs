//! ADR-0031: repairs of stored rows that reads reject. Each repair reselects its rows with the
//! predicate the affected read and the settings report use, so it touches exactly what the user saw
//! counted, and writes one immutable receipt per row. Nothing replicated and no Outbox history is
//! rewritten: Provider observations and Zone bindings are only quarantined, and the one rewrite is
//! an asset's local expiry, which no replica holds.

use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

use crate::portfolio_projection::PortfolioReadError;

/// What a repair covers, one per settings integrity count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageRepairKind {
    /// `malformedExpiries`: the expiry becomes unknown until a registrar observation writes it.
    MalformedExpiries,
    /// `invalidRegistrarObservations`: the observations are quarantined.
    InvalidRegistrarObservations,
    /// `rejectedDnsRows`: the failing binding or observation of each row is quarantined.
    RejectedDnsRows,
    /// `rejectedListings`: the failing latest listing observations are quarantined.
    RejectedListings,
    /// `malformedOutboxRows`: each malformed commit time is marked, never rewritten; history shows
    /// the row with no time.
    MalformedOutboxRows,
}

/// Repairs every row of `kind` in the workspace and returns how many receipts it wrote. The caller
/// holds an immediate write transaction; with nothing left to repair it writes nothing.
pub(crate) fn repair(
    transaction: &Connection,
    workspace_id: &str,
    kind: StorageRepairKind,
    repaired_at: &str,
) -> Result<u32, PortfolioReadError> {
    let mut receipts: Vec<(&'static str, String, String)> = Vec::new();
    match kind {
        StorageRepairKind::MalformedExpiries => {
            let mut statement = transaction
                .prepare(&format!(
                    "SELECT a.entity_id, a.expires_on FROM domain_assets a
                     WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL AND {}
                     ORDER BY a.entity_id",
                    super::renewals::malformed_expiry("a")
                ))
                .map_err(|_| PortfolioReadError::SchemaRejected)?;
            let rows = statement
                .query_map([workspace_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, rusqlite::types::Value>(1)?,
                    ))
                })
                .map_err(|_| PortfolioReadError::ProjectionRejected)?;
            for row in rows {
                let (entity_id, expires_on) =
                    row.map_err(|_| PortfolioReadError::StorageRejected)?;
                receipts.push(("asset_expiry", entity_id, format!("{expires_on:?}")));
            }
        }
        StorageRepairKind::InvalidRegistrarObservations => {
            for (observation_id, shown) in
                super::renewals::invalid_registrar_observation_ids(transaction, workspace_id)?
            {
                receipts.push(("registrar_observation", observation_id, shown));
            }
        }
        StorageRepairKind::RejectedDnsRows => {
            for row in super::dns_health::rejected_parts(transaction, workspace_id)? {
                if let Some(shown) = row.binding {
                    receipts.push(("dns_binding", row.entity_id, shown));
                }
                if let Some((observation_id, shown)) = row.observation {
                    receipts.push(("dns_zone_observation", observation_id, shown));
                }
            }
        }
        StorageRepairKind::MalformedOutboxRows => {
            return mark_outbox_commit_times(transaction, workspace_id, repaired_at);
        }
        StorageRepairKind::RejectedListings => {
            for (observation_id, shown) in
                super::sales::rejected_listing_ids(transaction, workspace_id)?
            {
                receipts.push(("listing_observation", observation_id, shown));
            }
        }
    }
    for (repair_kind, row_key, shown) in &receipts {
        let digest = hex(&Sha256::digest(shown.as_bytes()));
        transaction
            .execute(
                "INSERT INTO storage_repair_receipts
                 (workspace_id, repair_kind, row_key, prior_value_sha256, repaired_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![workspace_id, repair_kind, row_key, digest, repaired_at],
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        if *repair_kind == "asset_expiry" {
            transaction
                .execute(
                    "UPDATE domain_assets SET expires_on = NULL
                     WHERE workspace_id = ?1 AND entity_id = ?2",
                    params![workspace_id, row_key],
                )
                .map_err(|_| PortfolioReadError::StorageRejected)?;
        }
    }
    u32::try_from(receipts.len()).map_err(|_| PortfolioReadError::ProjectionRejected)
}

/// Marks every unmarked malformed Outbox commit time the history read rejects. The Outbox is this
/// device's change ledger, and an acknowledged row is synced history, so only a mark is written.
fn mark_outbox_commit_times(
    transaction: &Connection,
    workspace_id: &str,
    marked_at: &str,
) -> Result<u32, PortfolioReadError> {
    let malformed: Vec<(String, rusqlite::types::Value)> = {
        let mut statement = transaction
            .prepare(&format!(
                "SELECT mutation_id, created_at FROM sync_outbox
                 WHERE workspace_id = ?1 AND {} ORDER BY mutation_id",
                super::history::unmarked_malformed_created_at()
            ))
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        statement
            .query_map([workspace_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<_, _>>()
            .map_err(|_| PortfolioReadError::StorageRejected)?
    };
    for (mutation_id, created_at) in &malformed {
        let digest = hex(&Sha256::digest(format!("{created_at:?}").as_bytes()));
        transaction
            .execute(
                "INSERT INTO sync_outbox_commit_time_marks
                 (workspace_id, mutation_id, prior_value_sha256, marked_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![workspace_id, mutation_id, digest, marked_at],
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
    }
    u32::try_from(malformed.len()).map_err(|_| PortfolioReadError::ProjectionRejected)
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(64), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}
