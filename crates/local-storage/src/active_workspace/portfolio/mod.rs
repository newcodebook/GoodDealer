use rusqlite::Connection;
use rusqlite::{OptionalExtension, params};

#[cfg(test)]
use crate::portfolio_projection::PortfolioReadSnapshot;
use crate::portfolio_projection::{
    AssetLibraryReadSnapshot, AssetLibraryRow, AssetLibraryWindow, DomainDetailAsset,
    DomainDetailReadSnapshot, Money, PortfolioReadError, PortfolioReadFreshness,
    validate_identifier, validate_revision, validate_timestamp,
};
#[cfg(test)]
use crate::portfolio_projection::{DomainAssetProjectionRow, validate_projection};

#[cfg(test)]
use crate::active_workspace::schema::ACTIVE_TABLE_MANIFEST;

pub(crate) struct ActivePortfolioReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActivePortfolioReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    #[cfg(test)]
    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
    ) -> Result<PortfolioReadSnapshot, PortfolioReadError> {
        validate_identifier(requested_workspace_id)
            .map_err(|_| PortfolioReadError::WorkspaceRejected)?;
        let metadata = self.connection.query_row(
            "SELECT storage_domain, workspace_id, workspace_schema_version, applied_through_server_revision, last_replication_activity_at, last_successful_provider_observation_at FROM active_workspace_metadata WHERE singleton = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, Option<String>>(5)?)),
        ).map_err(|_| PortfolioReadError::StorageRejected)?;
        let singleton_count: i64 = self
            .connection
            .query_row(
                "SELECT count(*) FROM active_workspace_metadata",
                [],
                |row| row.get(0),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        if singleton_count != 1
            || metadata.0 != "active_workspace"
            || metadata.1 != requested_workspace_id
            || metadata.2 != 1
        {
            return Err(PortfolioReadError::WorkspaceRejected);
        }
        let applied_through_server_revision = validate_revision(metadata.3)?;
        let rogue_workspace_rows: i64 = self
            .connection
            .query_row(
                "SELECT count(*) FROM portfolio_domain_assets WHERE workspace_id <> ?1",
                [requested_workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        if rogue_workspace_rows != 0 {
            return Err(PortfolioReadError::WorkspaceRejected);
        }
        let mut statement = self.connection.prepare(
            "SELECT workspace_id, entity_id, note, portfolio_id, tags_json, target_price_currency, target_price_amount, note_server_revision, portfolio_id_server_revision, tags_server_revision, target_price_server_revision
             FROM portfolio_domain_assets WHERE workspace_id = ?1 ORDER BY entity_id COLLATE BINARY",
        ).map_err(|_| PortfolioReadError::SchemaRejected)?;
        let values = statement
            .query_map([requested_workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let mut domains = Vec::new();
        for value in values {
            let value = value.map_err(|_| PortfolioReadError::ProjectionRejected)?;
            if value.0 != requested_workspace_id {
                return Err(PortfolioReadError::WorkspaceRejected);
            }
            for revision in [value.7, value.8, value.9, value.10] {
                if validate_revision(revision)? > applied_through_server_revision {
                    return Err(PortfolioReadError::RevisionRejected);
                }
            }
            let tags = serde_json::from_str(&value.4)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?;
            let target_price = match (value.5, value.6) {
                (None, None) => None,
                (Some(currency), Some(amount)) => Some(Money { currency, amount }),
                _ => return Err(PortfolioReadError::ProjectionRejected),
            };
            domains.push(DomainAssetProjectionRow {
                entity_id: value.1,
                note: value.2,
                portfolio_id: value.3,
                tags,
                target_price,
            });
        }
        validate_projection(&domains)?;
        Ok(PortfolioReadSnapshot {
            workspace_id: metadata.1,
            domains,
            applied_through_server_revision,
            last_replication_activity_at: validate_timestamp(metadata.4)?,
            last_successful_provider_observation_at: validate_timestamp(metadata.5)?,
        })
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the bounded projection query remains contiguous for workspace and ordering review"
    )]
    pub(crate) fn read_asset_library(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
        query: &str,
    ) -> Result<AssetLibraryReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        if start_index > 1_000_000 || !(1..=200).contains(&size) {
            return Err(PortfolioReadError::WindowRejected);
        }
        let query = canonical_query(query)?;
        let upper = format!("{query}{{");
        let filter = "workspace_id = ?1 AND deleted_at IS NULL AND (?2 = '' OR (entity_id >= ?2 AND entity_id < ?3))";
        let aliased_filter = "a.workspace_id = ?1 AND a.deleted_at IS NULL AND (?2 = '' OR (a.entity_id >= ?2 AND a.entity_id < ?3))";
        let total_rows: i64 = transaction
            .query_row(
                &format!("SELECT count(*) FROM domain_assets WHERE {filter}"),
                params![requested_workspace_id, query, upper],
                |row| row.get(0),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let aggregates: (i64, i64, i64) = transaction.query_row(
            &format!("SELECT
                sum(CASE WHEN lifecycle_status <> 'archived' AND expires_on >= date('now') AND expires_on < date('now', '+61 days') THEN 1 ELSE 0 END),
                sum(CASE WHEN EXISTS (SELECT 1 FROM sync_conflicts c WHERE c.workspace_id = domain_assets.workspace_id AND c.entity_kind = 'domain_asset' AND c.entity_id = domain_assets.entity_id AND c.status = 'open') THEN 1 ELSE 0 END),
                sum(CASE WHEN EXISTS (
                  SELECT 1 FROM marketplace_listing_observations m
                  WHERE m.workspace_id = domain_assets.workspace_id AND m.entity_id = domain_assets.entity_id
                    AND m.observation_availability = 'available'
                    AND m.listing_status IN ('active', 'reserved')
                    AND NOT EXISTS (SELECT 1 FROM marketplace_listing_observations newer
                      WHERE newer.workspace_id = m.workspace_id AND newer.entity_id = m.entity_id
                        AND newer.marketplace_kind = m.marketplace_kind
                        AND (newer.observed_at > m.observed_at OR (newer.observed_at = m.observed_at AND newer.listing_observation_id > m.listing_observation_id)))
                ) THEN 1 ELSE 0 END)
              FROM domain_assets WHERE {filter}"),
            params![requested_workspace_id, query, upper],
            |row| Ok((row.get::<_, Option<i64>>(0)?.unwrap_or(0), row.get::<_, Option<i64>>(1)?.unwrap_or(0), row.get::<_, Option<i64>>(2)?.unwrap_or(0))),
        ).map_err(|_| PortfolioReadError::StorageRejected)?;
        let mut value_statement = transaction.prepare(&format!(
            "SELECT d.target_price_currency, d.target_price_amount FROM domain_asset_desired_state d
             JOIN domain_assets a ON a.workspace_id = d.workspace_id AND a.entity_id = d.entity_id
             WHERE {aliased_filter} AND d.target_price_currency IS NOT NULL ORDER BY a.entity_id COLLATE BINARY"
        )).map_err(|_| PortfolioReadError::SchemaRejected)?;
        let values = value_statement
            .query_map(params![requested_workspace_id, query, upper], |row| {
                Ok(Money {
                    currency: row.get(0)?,
                    amount: row.get(1)?,
                })
            })
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let total_value = sum_money(&values)?;
        let mut statement = transaction.prepare(&format!(
            "SELECT a.entity_id,
               (SELECT json_group_array(tag) FROM (SELECT tag FROM domain_asset_tags t WHERE t.workspace_id = a.workspace_id AND t.entity_id = a.entity_id ORDER BY tag COLLATE BINARY)),
               (SELECT registrar_name FROM registrar_observations r WHERE r.workspace_id = a.workspace_id AND r.entity_id = a.entity_id AND r.observation_availability = 'available' ORDER BY r.observed_at DESC, r.observation_id DESC LIMIT 1),
               a.lifecycle_status,
               CASE
                 WHEN EXISTS (SELECT 1 FROM sync_conflicts c WHERE c.workspace_id=a.workspace_id AND c.entity_kind='domain_asset' AND c.entity_id=a.entity_id AND c.status='open') THEN 'conflicted'
                 WHEN EXISTS (SELECT 1 FROM domain_asset_field_versions f WHERE f.workspace_id=a.workspace_id AND f.entity_id=a.entity_id AND f.sync_state='pending') THEN 'pending'
                 WHEN EXISTS (SELECT 1 FROM domain_asset_field_versions f WHERE f.workspace_id=a.workspace_id AND f.entity_id=a.entity_id AND f.sync_state='local_only') THEN 'local_only'
                 ELSE 'clean' END,
               d.target_price_currency, d.target_price_amount, a.expires_on, a.local_commit_sequence
             FROM domain_assets a LEFT JOIN domain_asset_desired_state d ON d.workspace_id=a.workspace_id AND d.entity_id=a.entity_id
             WHERE {aliased_filter} ORDER BY a.entity_id COLLATE BINARY LIMIT ?4 OFFSET ?5"
        )).map_err(|_| PortfolioReadError::SchemaRejected)?;
        let rows = statement
            .query_map(
                params![requested_workspace_id, query, upper, size, start_index],
                map_asset_row,
            )
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        validate_asset_rows(&rows)?;
        let metadata = read_freshness(&transaction)?;
        let snapshot = AssetLibraryReadSnapshot {
            schema_version: 3,
            kind: "asset_library".to_owned(),
            read_generation: 0,
            freshness: metadata,
            total_rows: u32::try_from(total_rows)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            total_value,
            expiring_within60_days: u32::try_from(aggregates.0)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            conflict_count: u32::try_from(aggregates.1)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            listing_count: u32::try_from(aggregates.2)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?,
            window: AssetLibraryWindow {
                start_index,
                size,
                rows,
            },
        };
        drop(statement);
        drop(value_statement);
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(snapshot)
    }

    pub(crate) fn read_domain_detail(
        &self,
        requested_workspace_id: &str,
        entity_id: &str,
    ) -> Result<DomainDetailReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        crate::portfolio_projection::validate_domain_asset_id(entity_id)?;
        let sql = "SELECT a.entity_id,
          (SELECT json_group_array(tag) FROM (SELECT tag FROM domain_asset_tags t WHERE t.workspace_id=a.workspace_id AND t.entity_id=a.entity_id ORDER BY tag COLLATE BINARY)),
          (SELECT registrar_name FROM registrar_observations r WHERE r.workspace_id=a.workspace_id AND r.entity_id=a.entity_id AND r.observation_availability='available' ORDER BY r.observed_at DESC, r.observation_id DESC LIMIT 1),
          a.lifecycle_status,
          CASE WHEN EXISTS (SELECT 1 FROM sync_conflicts c WHERE c.workspace_id=a.workspace_id AND c.entity_kind='domain_asset' AND c.entity_id=a.entity_id AND c.status='open') THEN 'conflicted'
               WHEN EXISTS (SELECT 1 FROM domain_asset_field_versions f WHERE f.workspace_id=a.workspace_id AND f.entity_id=a.entity_id AND f.sync_state='pending') THEN 'pending'
               WHEN EXISTS (SELECT 1 FROM domain_asset_field_versions f WHERE f.workspace_id=a.workspace_id AND f.entity_id=a.entity_id AND f.sync_state='local_only') THEN 'local_only' ELSE 'clean' END,
          d.target_price_currency, d.target_price_amount, a.expires_on, a.local_commit_sequence,
          a.acquired_on, a.acquisition_cost_currency, a.acquisition_cost_amount, a.auto_renew, a.registrar_lock, d.note, d.portfolio_id
          FROM domain_assets a LEFT JOIN domain_asset_desired_state d ON d.workspace_id=a.workspace_id AND d.entity_id=a.entity_id
          WHERE a.workspace_id=?1 AND a.entity_id=?2 AND a.deleted_at IS NULL";
        let detail = transaction
            .query_row(sql, params![requested_workspace_id, entity_id], |row| {
                let base = map_asset_row(row)?;
                let acquisition_cost = optional_money(row.get(10)?, row.get(11)?)?;
                Ok(DomainDetailAsset {
                    id: base.id,
                    domain: base.domain,
                    tags: base.tags,
                    registrar: base.registrar,
                    lifecycle_status: base.lifecycle_status,
                    sync_status: base.sync_status,
                    target_price: base.target_price,
                    expires_on: base.expires_on,
                    acquired_on: row.get(9)?,
                    acquisition_cost,
                    auto_renew: row.get::<_, Option<i64>>(12)?.map(|v| v != 0),
                    registrar_lock: row.get::<_, Option<i64>>(13)?.map(|v| v != 0),
                    note: row.get(14)?,
                    asset_version: base.asset_version,
                    portfolio_id: row.get(15)?,
                })
            })
            .optional()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .ok_or(PortfolioReadError::AssetNotFound)?;
        validate_detail(&detail)?;
        let mut conflicts = transaction.prepare("SELECT field_path FROM sync_conflicts WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2 AND status='open' ORDER BY field_path COLLATE BINARY")
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        let conflict_fields = conflicts
            .query_map(params![requested_workspace_id, entity_id], |row| row.get(0))
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let state = if !conflict_fields.is_empty() {
            "conflict"
        } else if detail.lifecycle_status == "sold" {
            "sold"
        } else {
            "normal"
        };
        let snapshot = DomainDetailReadSnapshot {
            schema_version: 3,
            kind: "domain_detail".to_owned(),
            read_generation: 0,
            freshness: read_freshness(&transaction)?,
            state: state.to_owned(),
            asset: detail,
            conflict_fields,
        };
        drop(conflicts);
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(snapshot)
    }
}

fn canonical_query(value: &str) -> Result<String, PortfolioReadError> {
    if value.len() > 64 || !value.is_ascii() {
        return Err(PortfolioReadError::QueryRejected);
    }
    let value = value.trim_matches(' ').to_ascii_lowercase();
    if value.bytes().any(|byte| {
        !byte.is_ascii_lowercase() && !byte.is_ascii_digit() && byte != b'.' && byte != b'-'
    }) {
        return Err(PortfolioReadError::QueryRejected);
    }
    Ok(value)
}

fn validate_workspace(
    connection: &Connection,
    workspace_id: &str,
) -> Result<(), PortfolioReadError> {
    validate_identifier(workspace_id).map_err(|_| PortfolioReadError::WorkspaceRejected)?;
    let actual: Option<(String, String, i64)> = connection.query_row("SELECT storage_domain, workspace_id, workspace_schema_version FROM active_workspace_metadata WHERE singleton=1", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional().map_err(|_| PortfolioReadError::StorageRejected)?;
    if actual.as_ref() != Some(&("active_workspace".to_owned(), workspace_id.to_owned(), 1)) {
        return Err(PortfolioReadError::WorkspaceRejected);
    }
    Ok(())
}

fn read_freshness(connection: &Connection) -> Result<PortfolioReadFreshness, PortfolioReadError> {
    connection.query_row("SELECT applied_through_server_revision, last_replication_activity_at, last_successful_provider_observation_at FROM active_workspace_metadata WHERE singleton=1", [], |row| {
        Ok(PortfolioReadFreshness { source: "active_local".to_owned(), read_only_reason: None,
            server_revision: validate_revision(row.get(0)?).map_err(|_| rusqlite::Error::InvalidQuery)?,
            last_replication_activity_at: row.get(1)?, last_successful_provider_observation_at: row.get(2)?, can_edit: true })
    }).map_err(|_| PortfolioReadError::ProjectionRejected).and_then(|mut value| { value.last_replication_activity_at = validate_timestamp(value.last_replication_activity_at)?; value.last_successful_provider_observation_at = validate_timestamp(value.last_successful_provider_observation_at)?; Ok(value) })
}

fn optional_money(
    currency: Option<String>,
    amount: Option<String>,
) -> rusqlite::Result<Option<Money>> {
    match (currency, amount) {
        (None, None) => Ok(None),
        (Some(currency), Some(amount)) => Ok(Some(Money { currency, amount })),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn map_asset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetLibraryRow> {
    Ok(AssetLibraryRow {
        id: row.get(0)?,
        domain: row.get(0)?,
        tags: serde_json::from_str(&row.get::<_, String>(1)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        registrar: row.get(2)?,
        lifecycle_status: row.get(3)?,
        sync_status: row.get(4)?,
        target_price: optional_money(row.get(5)?, row.get(6)?)?,
        expires_on: row.get(7)?,
        asset_version: u64::try_from(row.get::<_, i64>(8)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
    })
}

fn validate_asset_rows(rows: &[AssetLibraryRow]) -> Result<(), PortfolioReadError> {
    let mut previous: Option<&str> = None;
    for row in rows {
        crate::portfolio_projection::validate_domain_asset_id(&row.domain)?;
        if row.id != row.domain || previous.is_some_and(|v| v.as_bytes() >= row.id.as_bytes()) {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        previous = Some(&row.id);
        if !matches!(
            row.lifecycle_status.as_str(),
            "active" | "expired" | "sold" | "dropped" | "archived"
        ) || !matches!(
            row.sync_status.as_str(),
            "clean" | "pending" | "conflicted" | "local_only"
        ) {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        validate_texts(&row.tags, row.registrar.as_deref())?;
        if let Some(money) = &row.target_price
            && (!crate::portfolio_projection::valid_currency(&money.currency)
                || !crate::portfolio_projection::valid_amount(&money.amount))
        {
            return Err(PortfolioReadError::ProjectionRejected);
        }
    }
    Ok(())
}

fn validate_detail(detail: &DomainDetailAsset) -> Result<(), PortfolioReadError> {
    validate_asset_rows(&[AssetLibraryRow {
        id: detail.id.clone(),
        domain: detail.domain.clone(),
        tags: detail.tags.clone(),
        registrar: detail.registrar.clone(),
        lifecycle_status: detail.lifecycle_status.clone(),
        sync_status: detail.sync_status.clone(),
        target_price: detail.target_price.clone(),
        expires_on: detail.expires_on.clone(),
        asset_version: detail.asset_version,
    }])?;
    if detail.note.as_ref().is_some_and(|v| {
        v.chars().count() > 10_000
            || v.chars()
                .any(crate::portfolio_projection::is_forbidden_text_character)
    }) {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    Ok(())
}

fn validate_texts(tags: &[String], registrar: Option<&str>) -> Result<(), PortfolioReadError> {
    if tags.len() > 128 {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let mut previous: Option<&str> = None;
    for tag in tags {
        if tag.is_empty()
            || tag.chars().count() > 64
            || tag.trim() != tag
            || tag
                .chars()
                .any(crate::portfolio_projection::is_forbidden_text_character)
            || previous.is_some_and(|v| v.as_bytes() >= tag.as_bytes())
        {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        previous = Some(tag);
    }
    if registrar.is_some_and(|v| {
        v.is_empty()
            || v.chars().count() > 128
            || v.chars()
                .any(crate::portfolio_projection::is_forbidden_text_character)
    }) {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    Ok(())
}

fn sum_money(values: &[Money]) -> Result<Option<Money>, PortfolioReadError> {
    let Some(first) = values.first() else {
        return Ok(None);
    };
    if values.iter().any(|v| {
        v.currency != first.currency || !crate::portfolio_projection::valid_amount(&v.amount)
    }) {
        return Ok(None);
    }
    let mut units: u128 = 0;
    let scale = 8u32;
    for value in values {
        let mut parts = value.amount.split('.');
        let whole = parts
            .next()
            .unwrap_or("0")
            .parse::<u128>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let fractional = parts.next().unwrap_or("");
        let frac = format!("{fractional:0<8}")
            .parse::<u128>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        units = units
            .checked_add(
                whole
                    .checked_mul(10u128.pow(scale))
                    .and_then(|v| v.checked_add(frac))
                    .ok_or(PortfolioReadError::ProjectionRejected)?,
            )
            .ok_or(PortfolioReadError::ProjectionRejected)?;
    }
    let whole = units / 10u128.pow(scale);
    let fraction = units % 10u128.pow(scale);
    let amount = if fraction == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{fraction:08}")
            .trim_end_matches('0')
            .to_owned()
    };
    if !crate::portfolio_projection::valid_amount(&amount) {
        return Ok(None);
    }
    Ok(Some(Money {
        currency: first.currency.clone(),
        amount,
    }))
}

#[cfg(test)]
pub(crate) fn verify_active_manifest(connection: &Connection) -> Result<(), PortfolioReadError> {
    verify_manifest(connection, ACTIVE_TABLE_MANIFEST)
}

#[cfg(test)]
pub(crate) fn verify_manifest(
    connection: &Connection,
    manifest: &[(&str, &[&str])],
) -> Result<(), PortfolioReadError> {
    let mut statement = connection.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map_err(|_| PortfolioReadError::SchemaRejected)?;
    let tables = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| PortfolioReadError::SchemaRejected)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| PortfolioReadError::SchemaRejected)?;
    let mut expected_tables = manifest
        .iter()
        .map(|entry| entry.0.to_owned())
        .collect::<Vec<_>>();
    expected_tables.sort();
    if tables != expected_tables {
        return Err(PortfolioReadError::SchemaRejected);
    }
    for (table, expected_columns) in manifest {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info('{table}')"))
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|_| PortfolioReadError::SchemaRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        if columns
            != expected_columns
                .iter()
                .map(|column| (*column).to_owned())
                .collect::<Vec<_>>()
        {
            return Err(PortfolioReadError::SchemaRejected);
        }
    }
    Ok(())
}
