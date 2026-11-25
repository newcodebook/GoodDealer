//! Database opening, cloning and durable proofs.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    ActiveWorkspaceConnection, ActiveWorkspaceKey, BusinessDatabase, BusinessDatabaseError,
    Connection, DatabaseRecoveryProof, Digest, DurableSyncSnapshot, LocalDatabaseKey,
    OptionalExtension, Path, Sha256, map_portfolio_read_error, validate_identifier,
    validate_timestamp,
};

impl BusinessDatabase {
    pub(crate) fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    pub(crate) fn backup_connection_mut(&mut self) -> &mut Connection {
        self.store.fixture_connection()
    }

    #[cfg(all(test, unix))]
    pub(crate) fn clone_encrypted_to_file(
        &mut self,
        destination: &std::fs::File,
        destination_key: &LocalDatabaseKey,
    ) -> Result<(), BusinessDatabaseError> {
        self.store
            .clone_encrypted_to_file(destination, destination_key.custody_bytes())
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Opens the encrypted business database for one authorized workspace.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace identity is invalid or mismatched, or storage cannot be opened.
    pub fn open(
        path: &Path,
        key: &LocalDatabaseKey,
        workspace_id: &str,
    ) -> Result<Self, BusinessDatabaseError> {
        validate_identifier(workspace_id).map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        let active_key = ActiveWorkspaceKey(key.0);
        let mut store = ActiveWorkspaceConnection::create(path, &active_key)
            .map_err(map_portfolio_read_error)?;
        let existing: Option<String> = store
            .raw_connection()
            .query_row(
                "SELECT workspace_id FROM active_workspace_metadata WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        match existing {
            Some(existing) if existing != workspace_id => {
                return Err(BusinessDatabaseError::WorkspaceRejected);
            }
            Some(_) => {}
            None => {
                store
                    .fixture_connection()
                    .execute(
                        "INSERT INTO active_workspace_metadata
                         (singleton, storage_domain, workspace_id, workspace_schema_version, applied_through_server_revision,
                          last_replication_activity_at, last_successful_provider_observation_at)
                         VALUES (1, 'active_workspace', ?1, 1, 0, NULL, NULL)",
                        [workspace_id],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
        }
        Ok(Self {
            workspace_id: workspace_id.to_owned(),
            store,
        })
    }

    #[cfg(all(test, unix))]
    pub(crate) fn open_existing_derived(
        path: &Path,
        key: &LocalDatabaseKey,
    ) -> Result<Self, BusinessDatabaseError> {
        let active_key = ActiveWorkspaceKey(key.0);
        let store = ActiveWorkspaceConnection::create(path, &active_key)
            .map_err(map_portfolio_read_error)?;
        let workspace_id: String = store
            .raw_connection()
            .query_row(
                "SELECT workspace_id FROM active_workspace_metadata WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        validate_identifier(&workspace_id).map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        Ok(Self {
            workspace_id,
            store,
        })
    }

    /// # Errors
    ///
    /// Returns a storage error when metadata cannot be read.
    pub fn current_server_revision(&self) -> Result<u64, BusinessDatabaseError> {
        let revision = self
            .store
            .raw_connection()
            .query_row(
                "SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        u64::try_from(revision).map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn durable_sync_snapshot(
        &self,
    ) -> Result<DurableSyncSnapshot, BusinessDatabaseError> {
        let (pending, open, rejected, recovery, applied, last_activity):
            (i64, i64, i64, i64, i64, Option<String>) = self
            .store
            .raw_connection()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM sync_outbox WHERE workspace_id=m.workspace_id AND state IN ('pending','sending')),
                   (SELECT count(*) FROM sync_conflicts WHERE workspace_id=m.workspace_id AND status='open'),
                   (SELECT count(*) FROM sync_outbox WHERE workspace_id=m.workspace_id AND state='rejected'),
                   EXISTS(SELECT 1 FROM sync_reader_state WHERE workspace_id=m.workspace_id AND status='rebootstrap_required'),
                   m.applied_through_server_revision,m.last_replication_activity_at
                 FROM active_workspace_metadata m WHERE m.singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let last_replication_activity_at = match last_activity {
            Some(value) => Some(
                validate_timestamp(Some(value))
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?
                    .ok_or(BusinessDatabaseError::StorageRejected)?,
            ),
            None => None,
        };
        Ok(DurableSyncSnapshot {
            pending_mutation_count: u64::try_from(pending)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            open_conflict_count: u64::try_from(open)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            rejected_mutation_count: u64::try_from(rejected)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            recovery_required: recovery == 1,
            applied_through_server_revision: u64::try_from(applied)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            last_replication_activity_at,
        })
    }

    /// Produces a deterministic proof over durable application state.
    ///
    /// The publication journal is deliberately excluded: it contains the digest of the manifest
    /// that embeds this proof, and including it would create a circular digest dependency. The
    /// private `cfg(test)` recovery protocol validates that journal independently when exercising
    /// publication recovery; production backup proofs remain journal-independent.
    ///
    /// # Errors
    ///
    /// Returns a storage error when any schema or row cannot be read.
    pub fn recovery_proof(&self) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
        let (workspace_id, applied, local, next): (String, i64, i64, i64) = self
            .store
            .raw_connection()
            .query_row(
                "SELECT workspace_id,applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence FROM active_workspace_metadata WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(DatabaseRecoveryProof {
            workspace_id,
            row_digest: complete_database_digest(self.store.raw_connection())?,
            applied_server_revision: u64::try_from(applied)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            local_commit_sequence: u64::try_from(local)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            next_device_mutation_sequence: u64::try_from(next)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        })
    }
}

pub(super) fn complete_database_digest(
    connection: &rusqlite::Connection,
) -> Result<String, BusinessDatabaseError> {
    use rusqlite::types::ValueRef;

    let mut names = connection
        .prepare(
            "SELECT name FROM sqlite_schema
                  WHERE type='table' AND name NOT LIKE 'sqlite_%'
                    AND name != 'sync_rebootstrap_journal'
                  ORDER BY name",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    names.sort();
    let mut digest = Sha256::new();
    for name in names {
        append_digest_part(&mut digest, name.as_bytes());
        let quoted = name.replace('"', "\"\"");
        let mut statement = connection
            .prepare(&format!("SELECT * FROM \"{quoted}\""))
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let column_count = statement.column_count();
        let mut rows = statement
            .query_map([], |row| {
                let mut encoded = Vec::new();
                for index in 0..column_count {
                    match row.get_ref(index)? {
                        ValueRef::Null => encoded.extend_from_slice(&[0]),
                        ValueRef::Integer(value) => {
                            encoded.extend_from_slice(&[1]);
                            encoded.extend_from_slice(&value.to_be_bytes());
                        }
                        ValueRef::Real(value) => {
                            encoded.extend_from_slice(&[2]);
                            encoded.extend_from_slice(&value.to_bits().to_be_bytes());
                        }
                        ValueRef::Text(value) => {
                            encoded.extend_from_slice(&[3]);
                            append_bytes(&mut encoded, value);
                        }
                        ValueRef::Blob(value) => {
                            encoded.extend_from_slice(&[4]);
                            append_bytes(&mut encoded, value);
                        }
                    }
                }
                Ok(encoded)
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        rows.sort();
        for row in rows {
            append_digest_part(&mut digest, &row);
        }
    }
    Ok(digest
        .finalize()
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write as _;
            write!(output, "{byte:02x}").expect("String writes cannot fail");
            output
        }))
}

#[cfg(test)]
pub(super) fn recovery_proof_from_connection(
    transaction: &rusqlite::Connection,
) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
    let (workspace_id, applied, local, next): (String, i64, i64, i64) = transaction
        .query_row(
            "SELECT workspace_id,applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence FROM active_workspace_metadata WHERE singleton=1",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(DatabaseRecoveryProof {
        workspace_id,
        row_digest: complete_database_digest(transaction)?,
        applied_server_revision: u64::try_from(applied)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        local_commit_sequence: u64::try_from(local)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        next_device_mutation_sequence: u64::try_from(next)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
    })
}

pub(super) fn append_digest_part(digest: &mut Sha256, bytes: &[u8]) {
    digest.update(u64::try_from(bytes.len()).unwrap_or(u64::MAX).to_be_bytes());
    digest.update(bytes);
}

fn append_bytes(output: &mut Vec<u8>, bytes: &[u8]) {
    output.extend_from_slice(&u64::try_from(bytes.len()).unwrap_or(u64::MAX).to_be_bytes());
    output.extend_from_slice(bytes);
}
