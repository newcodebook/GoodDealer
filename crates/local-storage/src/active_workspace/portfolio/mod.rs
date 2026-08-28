use rusqlite::Connection;

use crate::portfolio_projection::{
    DomainAssetProjectionRow, Money, PortfolioReadError, PortfolioReadSnapshot,
    validate_identifier, validate_projection, validate_revision, validate_timestamp,
};

#[cfg(test)]
use crate::active_workspace::schema::ACTIVE_TABLE_MANIFEST;

pub(crate) struct ActivePortfolioReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActivePortfolioReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

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
    if tables
        != manifest
            .iter()
            .map(|entry| entry.0.to_owned())
            .collect::<Vec<_>>()
    {
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
