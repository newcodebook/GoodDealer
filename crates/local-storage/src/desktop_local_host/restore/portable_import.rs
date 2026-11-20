//! The portable import preview classifies authenticated assets against the current workspace.
//! Its approved additions are rederived inside the existing restore transaction before writing.

use rusqlite::{Transaction, params};
use serde::Serialize;

use super::{IsolatedBackupCandidate, SensitiveCurrentAssets};
use crate::active_workspace::business::BusinessDatabaseError;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(in crate::desktop_local_host) enum PortableImportDisposition {
    Add,
    Unchanged,
    PreserveExisting,
    BlockedByAssetHistory,
    MissingPortfolio,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::desktop_local_host) struct PortableImportRow {
    pub entity_id: String,
    pub disposition: PortableImportDisposition,
}

pub(super) fn compare(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    candidate: &IsolatedBackupCandidate,
    current: &SensitiveCurrentAssets,
) -> Result<Vec<PortableImportRow>, BusinessDatabaseError> {
    let mut constraints = transaction
        .prepare(
            "SELECT (EXISTS(SELECT 1 FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2)
                  OR EXISTS(SELECT 1 FROM domain_assets
                     WHERE workspace_id=?1 AND entity_id=?2 AND deleted_at IS NOT NULL)
                  OR EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds
                     WHERE workspace_id=?1 AND entity_id=?2)),
                    (?3 IS NULL OR EXISTS(SELECT 1 FROM portfolios
                     WHERE workspace_id=?1 AND portfolio_id=?3 AND deleted_at IS NULL))",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;

    candidate
        .body
        .assets
        .iter()
        .enumerate()
        .map(|(index, asset)| {
            let (has_history, has_portfolio): (bool, bool) = constraints
                .query_row(
                    params![workspace_id, asset.entity_id, asset.portfolio_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let disposition = match current.get(&asset.entity_id) {
                _ if has_history => PortableImportDisposition::BlockedByAssetHistory,
                Some(existing) if existing == asset => PortableImportDisposition::Unchanged,
                Some(_) => PortableImportDisposition::PreserveExisting,
                None if candidate.body.asset_generation(index) != 1 => {
                    PortableImportDisposition::BlockedByAssetHistory
                }
                None if !has_portfolio => PortableImportDisposition::MissingPortfolio,
                None => PortableImportDisposition::Add,
            };
            Ok(PortableImportRow {
                entity_id: asset.entity_id.clone(),
                disposition,
            })
        })
        .collect()
}
