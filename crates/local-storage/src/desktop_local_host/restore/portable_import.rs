//! The portable import preview classifies authenticated assets against the current workspace.
//! Approved additions and missing-field edits are rederived inside the restore transaction.

use rusqlite::{Transaction, params};
use serde::Serialize;

use super::{IsolatedBackupCandidate, SensitiveAsset, SensitiveCurrentAssets, bounded_revision};
use crate::active_workspace::business::BusinessDatabaseError;
use crate::desktop_local_host::source::zeroize_asset;
use crate::portfolio_projection::DomainAssetProjectionRow;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(in crate::desktop_local_host) enum PortableImportDisposition {
    Add,
    FillMissingFields,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<DomainAssetProjectionRow>,
    #[serde(skip)]
    pub asset_version: Option<u64>,
}

impl Drop for PortableImportRow {
    fn drop(&mut self) {
        if let Some(fields) = &mut self.fill {
            zeroize_asset(fields);
        }
    }
}

impl PortableImportRow {
    pub(super) fn applies(&self) -> bool {
        matches!(
            self.disposition,
            PortableImportDisposition::Add | PortableImportDisposition::FillMissingFields
        )
    }

    pub(super) fn merge(&self, existing: &SensitiveAsset) -> Option<DomainAssetProjectionRow> {
        let fill = self.fill.as_ref()?;
        Some(DomainAssetProjectionRow {
            entity_id: existing.entity_id.clone(),
            note: existing.note.clone().or_else(|| fill.note.clone()),
            portfolio_id: existing
                .portfolio_id
                .clone()
                .or_else(|| fill.portfolio_id.clone()),
            tags: if existing.tags.is_empty() {
                fill.tags.clone()
            } else {
                existing.tags.clone()
            },
            target_price: existing
                .target_price
                .clone()
                .or_else(|| fill.target_price.clone()),
        })
    }
}

pub(super) fn compare(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    candidate: &IsolatedBackupCandidate,
    current: &SensitiveCurrentAssets,
    fill_missing_fields: bool,
) -> Result<Vec<PortableImportRow>, BusinessDatabaseError> {
    let mut constraints = transaction
        .prepare(
            "SELECT (EXISTS(SELECT 1 FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2)
                  OR EXISTS(SELECT 1 FROM domain_assets
                     WHERE workspace_id=?1 AND entity_id=?2 AND (deleted_at IS NOT NULL OR lifecycle_status='archived'))
                  OR EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds
                     WHERE workspace_id=?1 AND entity_id=?2)),
                    (?3 IS NULL OR EXISTS(SELECT 1 FROM portfolios
                     WHERE workspace_id=?1 AND portfolio_id=?3 AND deleted_at IS NULL)),
                    (SELECT entity_generation FROM domain_assets
                      WHERE workspace_id=?1 AND entity_id=?2 AND deleted_at IS NULL),
                    (SELECT local_commit_sequence FROM domain_assets
                      WHERE workspace_id=?1 AND entity_id=?2 AND deleted_at IS NULL)",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;

    candidate
        .body
        .assets
        .iter()
        .enumerate()
        .map(|(index, asset)| {
            let (has_history, has_portfolio, generation, version): (
                bool,
                bool,
                Option<i64>,
                Option<i64>,
            ) = constraints
                .query_row(
                    params![workspace_id, asset.entity_id, asset.portfolio_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let generation = generation.map(bounded_revision).transpose()?;
            let version = version.map(bounded_revision).transpose()?;
            let existing = current.get(&asset.entity_id);
            let candidate_generation = candidate.body.asset_generation(index);
            let fill = existing
                .filter(|_| {
                    fill_missing_fields && !has_history && generation == Some(candidate_generation)
                })
                .and_then(|existing| missing_fields(existing, asset, has_portfolio));
            let disposition = match existing {
                _ if has_history => PortableImportDisposition::BlockedByAssetHistory,
                Some(_) if fill.is_some() => PortableImportDisposition::FillMissingFields,
                Some(existing) if existing == asset => PortableImportDisposition::Unchanged,
                Some(_) => PortableImportDisposition::PreserveExisting,
                None if candidate_generation != 1 => {
                    PortableImportDisposition::BlockedByAssetHistory
                }
                None if !has_portfolio => PortableImportDisposition::MissingPortfolio,
                None => PortableImportDisposition::Add,
            };
            Ok(PortableImportRow {
                entity_id: asset.entity_id.clone(),
                disposition,
                asset_version: if fill.is_some() { version } else { None },
                fill,
            })
        })
        .collect()
}

fn missing_fields(
    existing: &SensitiveAsset,
    backup: &SensitiveAsset,
    has_portfolio: bool,
) -> Option<DomainAssetProjectionRow> {
    let fill = DomainAssetProjectionRow {
        entity_id: backup.entity_id.clone(),
        note: existing
            .note
            .is_none()
            .then(|| backup.note.clone())
            .flatten(),
        portfolio_id: (existing.portfolio_id.is_none() && has_portfolio)
            .then(|| backup.portfolio_id.clone())
            .flatten(),
        tags: if existing.tags.is_empty() {
            backup.tags.clone()
        } else {
            Vec::new()
        },
        target_price: existing
            .target_price
            .is_none()
            .then(|| backup.target_price.clone())
            .flatten(),
    };
    (fill.note.is_some()
        || fill.portfolio_id.is_some()
        || !fill.tags.is_empty()
        || fill.target_price.is_some())
    .then_some(fill)
}
