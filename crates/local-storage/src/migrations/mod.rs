use rusqlite::{Connection, TransactionBehavior, params};
use sha2::{Digest, Sha256};

use crate::active_workspace::schema::{
    ACTIVE_SCHEMA_MIGRATION_ID, ACTIVE_SCHEMA_MIGRATION_OWNER, ACTIVE_SCHEMA_MIGRATION_SQL,
    CLOUDFLARE_RETIREMENT_MIGRATION_ID, CLOUDFLARE_RETIREMENT_MIGRATION_OWNER,
    CLOUDFLARE_RETIREMENT_MIGRATION_SQL, CLOUDFLARE_REVOKE_RETRY_MIGRATION_ID,
    CLOUDFLARE_REVOKE_RETRY_MIGRATION_OWNER, CLOUDFLARE_REVOKE_RETRY_MIGRATION_SQL,
    CLOUDFLARE_V1_MIGRATION_ID, CLOUDFLARE_V1_MIGRATION_OWNER, CLOUDFLARE_V1_MIGRATION_SQL,
    CLOUDFLARE_V2_MIGRATION_ID, CLOUDFLARE_V2_MIGRATION_OWNER, CLOUDFLARE_V2_MIGRATION_SQL,
    DOMAIN_PROVIDER_BINDING_MIGRATION_ID, DOMAIN_PROVIDER_BINDING_MIGRATION_OWNER,
    DOMAIN_PROVIDER_BINDING_MIGRATION_SQL, OUTBOX_INTEGRITY_MIGRATION_ID,
    OUTBOX_INTEGRITY_MIGRATION_OWNER, OUTBOX_INTEGRITY_MIGRATION_SQL,
    OUTBOX_LOCAL_CREATIONS_MIGRATION_ID, OUTBOX_LOCAL_CREATIONS_MIGRATION_OWNER,
    OUTBOX_LOCAL_CREATIONS_MIGRATION_SQL, SALES_LISTING_CONFIRMATION_MIGRATION_ID,
    SALES_LISTING_CONFIRMATION_MIGRATION_OWNER, SALES_LISTING_CONFIRMATION_MIGRATION_SQL,
    SALES_LISTING_GENERATION_MIGRATION_ID, SALES_LISTING_GENERATION_MIGRATION_OWNER,
    SALES_LISTING_GENERATION_MIGRATION_SQL, STORAGE_INTEGRITY_MIGRATION_ID,
    STORAGE_INTEGRITY_MIGRATION_OWNER, STORAGE_INTEGRITY_MIGRATION_SQL, SYNC_V2_MIGRATION_ID,
    SYNC_V2_MIGRATION_OWNER, SYNC_V2_MIGRATION_SQL, SYNC_V3_MIGRATION_ID, SYNC_V3_MIGRATION_OWNER,
    SYNC_V3_MIGRATION_SQL, SYNC_V4_MIGRATION_ID, SYNC_V4_MIGRATION_OWNER, SYNC_V4_MIGRATION_SQL,
    SYNC_V5_MIGRATION_ID, SYNC_V5_MIGRATION_OWNER, SYNC_V5_MIGRATION_SQL,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MigrationError {
    RebuildRequiredP007CredentialSchema,
    Rejected,
}

#[derive(Clone, Copy)]
struct ActiveMigration {
    id: i64,
    owner: &'static str,
    sql: &'static str,
}

const ACTIVE_MIGRATIONS: &[ActiveMigration] = &[
    ActiveMigration {
        id: ACTIVE_SCHEMA_MIGRATION_ID,
        owner: ACTIVE_SCHEMA_MIGRATION_OWNER,
        sql: ACTIVE_SCHEMA_MIGRATION_SQL,
    },
    ActiveMigration {
        id: SYNC_V2_MIGRATION_ID,
        owner: SYNC_V2_MIGRATION_OWNER,
        sql: SYNC_V2_MIGRATION_SQL,
    },
    ActiveMigration {
        id: SYNC_V3_MIGRATION_ID,
        owner: SYNC_V3_MIGRATION_OWNER,
        sql: SYNC_V3_MIGRATION_SQL,
    },
    ActiveMigration {
        id: SYNC_V4_MIGRATION_ID,
        owner: SYNC_V4_MIGRATION_OWNER,
        sql: SYNC_V4_MIGRATION_SQL,
    },
    ActiveMigration {
        id: CLOUDFLARE_V1_MIGRATION_ID,
        owner: CLOUDFLARE_V1_MIGRATION_OWNER,
        sql: CLOUDFLARE_V1_MIGRATION_SQL,
    },
    ActiveMigration {
        id: CLOUDFLARE_V2_MIGRATION_ID,
        owner: CLOUDFLARE_V2_MIGRATION_OWNER,
        sql: CLOUDFLARE_V2_MIGRATION_SQL,
    },
    ActiveMigration {
        id: SYNC_V5_MIGRATION_ID,
        owner: SYNC_V5_MIGRATION_OWNER,
        sql: SYNC_V5_MIGRATION_SQL,
    },
    ActiveMigration {
        id: DOMAIN_PROVIDER_BINDING_MIGRATION_ID,
        owner: DOMAIN_PROVIDER_BINDING_MIGRATION_OWNER,
        sql: DOMAIN_PROVIDER_BINDING_MIGRATION_SQL,
    },
    ActiveMigration {
        id: STORAGE_INTEGRITY_MIGRATION_ID,
        owner: STORAGE_INTEGRITY_MIGRATION_OWNER,
        sql: STORAGE_INTEGRITY_MIGRATION_SQL,
    },
    ActiveMigration {
        id: OUTBOX_INTEGRITY_MIGRATION_ID,
        owner: OUTBOX_INTEGRITY_MIGRATION_OWNER,
        sql: OUTBOX_INTEGRITY_MIGRATION_SQL,
    },
    ActiveMigration {
        id: OUTBOX_LOCAL_CREATIONS_MIGRATION_ID,
        owner: OUTBOX_LOCAL_CREATIONS_MIGRATION_OWNER,
        sql: OUTBOX_LOCAL_CREATIONS_MIGRATION_SQL,
    },
    ActiveMigration {
        id: SALES_LISTING_GENERATION_MIGRATION_ID,
        owner: SALES_LISTING_GENERATION_MIGRATION_OWNER,
        sql: SALES_LISTING_GENERATION_MIGRATION_SQL,
    },
    ActiveMigration {
        id: CLOUDFLARE_REVOKE_RETRY_MIGRATION_ID,
        owner: CLOUDFLARE_REVOKE_RETRY_MIGRATION_OWNER,
        sql: CLOUDFLARE_REVOKE_RETRY_MIGRATION_SQL,
    },
    ActiveMigration {
        id: CLOUDFLARE_RETIREMENT_MIGRATION_ID,
        owner: CLOUDFLARE_RETIREMENT_MIGRATION_OWNER,
        sql: CLOUDFLARE_RETIREMENT_MIGRATION_SQL,
    },
    ActiveMigration {
        id: SALES_LISTING_CONFIRMATION_MIGRATION_ID,
        owner: SALES_LISTING_CONFIRMATION_MIGRATION_OWNER,
        sql: SALES_LISTING_CONFIRMATION_MIGRATION_SQL,
    },
];

pub(crate) fn run_active_migrations(connection: &mut Connection) -> Result<(), MigrationError> {
    validate_catalog(ACTIVE_MIGRATIONS)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS gooddealer_active_migrations (
               id INTEGER PRIMARY KEY,
               owner TEXT NOT NULL,
               checksum TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) STRICT;",
        )
        .map_err(|_| MigrationError::Rejected)?;

    let applied = read_applied(connection)?;
    if applied.len() > ACTIVE_MIGRATIONS.len() {
        return Err(MigrationError::Rejected);
    }
    for (index, row) in applied.iter().enumerate() {
        let expected = &ACTIVE_MIGRATIONS[index];
        if row.0 != expected.id || row.1 != expected.owner || row.2 != checksum(expected.sql) {
            if row.0 == CLOUDFLARE_V1_MIGRATION_ID || expected.id == CLOUDFLARE_V1_MIGRATION_ID {
                return Err(MigrationError::RebuildRequiredP007CredentialSchema);
            }
            return Err(MigrationError::Rejected);
        }
    }
    for migration in &ACTIVE_MIGRATIONS[applied.len()..] {
        if migration.id == SYNC_V3_MIGRATION_ID {
            validate_sync_v3_legacy_rows(connection)?;
        } else if migration.id == SYNC_V4_MIGRATION_ID {
            validate_sync_v4_legacy_rows(connection)?;
        } else if migration.id == CLOUDFLARE_REVOKE_RETRY_MIGRATION_ID {
            // A forward migration must not launder an unrecognized custody schema guard.
            let valid = connection
                .query_row(
                    "SELECT schema_epoch='P0_07_CREDENTIAL_SCHEMA_V2' AND schema_fingerprint=
                 '0ada504c017543d9cc26b9e0832e7fdcf0ac29b329c8d1895c08cf1f517fe1ec'
                 FROM cloudflare_credential_schema_guard WHERE singleton=1",
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap_or(false);
            if !valid {
                return Err(MigrationError::RebuildRequiredP007CredentialSchema);
            }
        } else if migration.id == CLOUDFLARE_RETIREMENT_MIGRATION_ID {
            let valid = connection
                .query_row(
                    "SELECT schema_epoch='P0_07_CREDENTIAL_SCHEMA_V3' AND schema_fingerprint=
                 '3e267e4d530572b5cb4114d164068b1b619e1dec90752f5c52111bdbc2ac63b0'
                 FROM cloudflare_credential_schema_guard WHERE singleton=1",
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap_or(false);
            if !valid {
                return Err(MigrationError::RebuildRequiredP007CredentialSchema);
            }
        }
        apply_migration(connection, migration)?;
    }
    Ok(())
}

fn validate_sync_v4_legacy_rows(connection: &Connection) -> Result<(), MigrationError> {
    let _ = connection
        .query_row("SELECT count(*) FROM sync_rebootstrap_journal", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|_| MigrationError::Rejected)?;
    Ok(())
}

fn validate_sync_v3_legacy_rows(connection: &Connection) -> Result<(), MigrationError> {
    let ambiguous_conflicts: i64 = connection
        .query_row("SELECT count(*) FROM sync_conflicts", [], |row| row.get(0))
        .map_err(|_| MigrationError::Rejected)?;
    let ambiguous_remote_tombstones: i64 = connection
        .query_row(
            "SELECT count(*) FROM sync_tombstones WHERE deleted_server_revision IS NOT NULL OR state != 'pending'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| MigrationError::Rejected)?;
    if ambiguous_conflicts != 0 || ambiguous_remote_tombstones != 0 {
        return Err(MigrationError::Rejected);
    }
    Ok(())
}

fn validate_catalog(migrations: &[ActiveMigration]) -> Result<(), MigrationError> {
    if migrations.is_empty()
        || migrations
            .iter()
            .any(|migration| migration.owner.is_empty() || migration.sql.is_empty())
        || migrations.windows(2).any(|pair| pair[0].id >= pair[1].id)
    {
        return Err(MigrationError::Rejected);
    }
    Ok(())
}

fn apply_migration(
    connection: &mut Connection,
    migration: &ActiveMigration,
) -> Result<(), MigrationError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MigrationError::Rejected)?;
    transaction
        .execute_batch(migration.sql)
        .map_err(|_| MigrationError::Rejected)?;
    transaction
        .execute(
            "INSERT INTO gooddealer_active_migrations(id, owner, checksum) VALUES (?1, ?2, ?3)",
            params![migration.id, migration.owner, checksum(migration.sql)],
        )
        .map_err(|_| MigrationError::Rejected)?;
    transaction.commit().map_err(|_| MigrationError::Rejected)
}

fn read_applied(connection: &Connection) -> Result<Vec<(i64, String, String)>, MigrationError> {
    let mut statement = connection
        .prepare("SELECT id, owner, checksum FROM gooddealer_active_migrations ORDER BY id")
        .map_err(|_| MigrationError::Rejected)?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|_| MigrationError::Rejected)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| MigrationError::Rejected)
}

fn checksum(sql: &str) -> String {
    Sha256::digest(sql.as_bytes())
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write;
            write!(output, "{byte:02x}").expect("writing into a String cannot fail");
            output
        })
}

#[cfg(test)]
mod tests {
    use rusqlite::{Connection, OptionalExtension};

    use super::{ActiveMigration, apply_migration, run_active_migrations, validate_catalog};
    use crate::active_workspace::portfolio::verify_active_manifest;

    #[test]
    fn global_catalog_rejects_duplicate_and_out_of_order_contributions() {
        let first = ActiveMigration {
            id: 2,
            owner: "first",
            sql: "SELECT 1;",
        };
        let duplicate = ActiveMigration {
            id: 2,
            owner: "duplicate",
            sql: "SELECT 2;",
        };
        let earlier = ActiveMigration {
            id: 1,
            owner: "earlier",
            sql: "SELECT 3;",
        };
        assert!(validate_catalog(&[first, duplicate]).is_err());
        assert!(validate_catalog(&[first, earlier]).is_err());
    }

    #[test]
    fn interrupted_capability_migration_rolls_back_ddl_and_ledger() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gooddealer_active_migrations (
               id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) STRICT;",
            )
            .unwrap();
        let failing = ActiveMigration {
            id: 9,
            owner: "active-workspace/portfolio-test",
            sql: "CREATE TABLE interrupted_probe(value TEXT) STRICT; SELECT missing FROM interrupted_probe;",
        };
        assert!(apply_migration(&mut connection, &failing).is_err());
        let table: Option<String> = connection
            .query_row(
                "SELECT name FROM sqlite_schema WHERE name = 'interrupted_probe'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        let ledger_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM gooddealer_active_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(table.is_none());
        assert_eq!(ledger_count, 0);
    }

    #[test]
    fn empty_prefix_migrates_and_current_prefix_reopens_idempotently() {
        let mut connection = Connection::open_in_memory().unwrap();
        run_active_migrations(&mut connection).unwrap();
        run_active_migrations(&mut connection).unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM gooddealer_active_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count,
            i64::try_from(super::ACTIVE_MIGRATIONS.len()).expect("bounded migration catalog")
        );
    }

    #[test]
    fn old_cloudflare_credential_epoch_requires_explicit_rebuild_without_mutation() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gooddealer_active_migrations (
                   id INTEGER PRIMARY KEY,
                   owner TEXT NOT NULL,
                   checksum TEXT NOT NULL,
                   applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ) STRICT;",
            )
            .unwrap();
        for migration in &super::ACTIVE_MIGRATIONS[..4] {
            connection
                .execute(
                    "INSERT INTO gooddealer_active_migrations(id,owner,checksum)
                     VALUES (?1,?2,?3)",
                    rusqlite::params![
                        migration.id,
                        migration.owner,
                        super::checksum(migration.sql)
                    ],
                )
                .unwrap();
        }
        connection
            .execute(
                "INSERT INTO gooddealer_active_migrations(id,owner,checksum)
                 VALUES (?1,?2,'old-credential-schema')",
                rusqlite::params![
                    crate::active_workspace::schema::CLOUDFLARE_V1_MIGRATION_ID,
                    crate::active_workspace::schema::CLOUDFLARE_V1_MIGRATION_OWNER,
                ],
            )
            .unwrap();

        assert_eq!(
            run_active_migrations(&mut connection),
            Err(super::MigrationError::RebuildRequiredP007CredentialSchema)
        );
        let rows: i64 = connection
            .query_row(
                "SELECT count(*) FROM gooddealer_active_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 5);
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the manifest test intentionally enumerates the complete schema in one proof"
    )]
    fn complete_business_schema_matches_the_fail_closed_manifest() {
        assert_eq!(super::ACTIVE_MIGRATIONS.len(), 15);
        assert!(!super::ACTIVE_MIGRATIONS[0].sql.contains("ALTER TABLE"));
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        run_active_migrations(&mut connection).unwrap();
        verify_active_manifest(&connection).unwrap();

        let table_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let business_index_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema
                 WHERE type = 'index' AND sql IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 46);
        assert!(business_index_count >= 24);

        connection
            .execute(
                "INSERT INTO active_workspace_metadata
                 (singleton,storage_domain,workspace_id,workspace_schema_version,
                  applied_through_server_revision,local_commit_sequence,
                  next_device_mutation_sequence,created_at,updated_at)
                 VALUES (1,'active_workspace','workspace-local',1,0,1,2,
                         '2026-09-29T00:00:00Z','2026-09-29T00:00:00Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO local_provider_connections
                 (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at)
                 VALUES ('workspace-local','connection-1','cloudflare','Primary','2026-09-29T00:00:00Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
                 VALUES ('workspace-local','example.com','active','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z',1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO domain_asset_provider_bindings
                 (workspace_id,entity_id,connection_id,provider_kind,resource_kind,
                  resource_binding_digest,observation_digest,resource_label,binding_generation,
                  local_commit_sequence,validation_status,created_at,updated_at)
                 VALUES ('workspace-local','example.com','connection-1','cloudflare','zone',
                  ?1,?2,'example.com',1,1,'unverified',
                  '2026-09-29T00:00:00Z','2026-09-29T00:00:00Z')",
                rusqlite::params!["a".repeat(64), "b".repeat(64)],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "UPDATE domain_asset_provider_bindings
                 SET connection_id='connection-2' WHERE workspace_id='workspace-local'
                   AND entity_id='example.com' AND resource_kind='zone'",
                    [],
                )
                .is_err()
        );
        assert!(connection
            .execute(
                "DELETE FROM domain_asset_provider_bindings
                 WHERE workspace_id='workspace-local' AND entity_id='example.com' AND resource_kind='zone'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE domain_asset_provider_bindings SET validation_status='verified'
                 WHERE workspace_id='workspace-local' AND entity_id='example.com' AND resource_kind='zone'",
                [],
            )
            .is_err());

        let cloudflare_credential_triggers = connection
            .prepare(
                "SELECT name FROM sqlite_schema
                  WHERE type='trigger' AND name LIKE 'cloudflare_credential_%'
                  ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            cloudflare_credential_triggers,
            crate::active_workspace::schema::CLOUDFLARE_CREDENTIAL_TRIGGER_MANIFEST
        );
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the migration proof seeds, migrates and compares one exact pre-migration snapshot"
    )]
    fn credential_retry_migration_preserves_attempts_and_refuses_unknown_prior_guard() {
        for corrupt_guard in [false, true] {
            let mut connection = Connection::open_in_memory().unwrap();
            connection
                .pragma_update(None, "foreign_keys", true)
                .unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE gooddealer_active_migrations (
                id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;",
                )
                .unwrap();
            let target = super::ACTIVE_MIGRATIONS
                .iter()
                .position(|migration| migration.id == super::CLOUDFLARE_REVOKE_RETRY_MIGRATION_ID)
                .unwrap();
            for migration in &super::ACTIVE_MIGRATIONS[..target] {
                apply_migration(&mut connection, migration).unwrap();
            }
            connection.execute_batch(
                "INSERT INTO active_workspace_metadata
                 (singleton,storage_domain,workspace_id,workspace_schema_version,
                  applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
                  created_at,updated_at)
                 VALUES (1,'active_workspace','workspace-local',1,0,0,1,
                         '2026-11-13T00:00:00Z','2026-11-13T00:00:00Z');
                 INSERT INTO local_provider_connections
                 (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,
                  capabilities_json,connection_incarnation_id,credential_use_state)
                 VALUES ('workspace-local','connection','cloudflare','Cloudflare','2026-11-13T00:00:00Z',
                         '[\"dns\"]','incarnation','inactive');
                 INSERT INTO cloudflare_credential_roots
                 (workspace_id,connection_incarnation_id,logical_connection_id,updated_at)
                 VALUES ('workspace-local','incarnation','connection','2026-11-13T00:00:00Z');
                 INSERT INTO cloudflare_credential_intents
                 (workspace_id,connection_incarnation_id,intent_id,operation_kind,
                  expected_head_generation,target_generation,target_envelope_kind,
                  scope_digest,zone_digest,target_public_proof,prepared_authority_snapshot_digest,
                  phase,terminal_reason,created_at,updated_at)
                 VALUES ('workspace-local','incarnation','cancelled-attempt','revoke',0,1,'tombstone',
                         printf('%064d',1),printf('%064d',2),printf('%064d',3),printf('%064d',4),
                         'cancelled','cancelled_before_inspection','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z');"
            ).unwrap();
            let snapshot = |connection: &Connection| {
                let mut statement = connection
                    .prepare("SELECT * FROM cloudflare_credential_intents")
                    .unwrap();
                let columns = statement.column_count();
                statement
                    .query_map([], |row| {
                        (0..columns)
                            .map(|index| row.get::<_, rusqlite::types::Value>(index))
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            };
            let before = snapshot(&connection);
            if corrupt_guard {
                connection
                    .execute("DELETE FROM cloudflare_credential_schema_guard", [])
                    .unwrap();
                assert_eq!(
                    run_active_migrations(&mut connection),
                    Err(super::MigrationError::RebuildRequiredP007CredentialSchema)
                );
            } else {
                run_active_migrations(&mut connection).unwrap();
                run_active_migrations(&mut connection).unwrap();
                assert!(
                    connection
                        .execute(
                            "UPDATE cloudflare_credential_intents SET intent_id='rewritten'",
                            []
                        )
                        .is_err()
                );
                assert!(connection.execute(
                    "UPDATE cloudflare_credential_intents SET phase='prepared',terminal_reason=NULL", []).is_err());
                let violations: i64 = connection
                    .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(violations, 0);
            }
            assert_eq!(snapshot(&connection), before);
            let applied: i64 = connection
                .query_row(
                    "SELECT count(*) FROM gooddealer_active_migrations",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                usize::try_from(applied).unwrap(),
                if corrupt_guard {
                    target
                } else {
                    super::ACTIVE_MIGRATIONS.len()
                }
            );
        }
    }

    #[test]
    fn cloudflare_retirement_migration_preserves_v3_rows_and_rejects_an_unknown_guard() {
        for corrupt_guard in [false, true] {
            let mut connection = Connection::open_in_memory().unwrap();
            connection
                .pragma_update(None, "foreign_keys", true)
                .unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE gooddealer_active_migrations (
                id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;",
                )
                .unwrap();
            let target = super::ACTIVE_MIGRATIONS
                .iter()
                .position(|migration| migration.id == super::CLOUDFLARE_RETIREMENT_MIGRATION_ID)
                .unwrap();
            for migration in &super::ACTIVE_MIGRATIONS[..target] {
                apply_migration(&mut connection, migration).unwrap();
            }
            connection.execute_batch(
                "INSERT INTO active_workspace_metadata
                 (singleton,storage_domain,workspace_id,workspace_schema_version,
                  applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
                  created_at,updated_at)
                 VALUES (1,'active_workspace','workspace-local',1,0,0,1,
                         '2026-11-13T00:00:00Z','2026-11-13T00:00:00Z');
                 INSERT INTO local_provider_connections
                 (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,
                  capabilities_json,connection_incarnation_id,credential_use_state)
                 VALUES ('workspace-local','connection','cloudflare','Cloudflare','2026-11-13T00:00:00Z',
                         '[\"dns\"]','incarnation','remediation_required');
                 INSERT INTO cloudflare_credential_roots
                 (workspace_id,connection_incarnation_id,logical_connection_id,updated_at)
                 VALUES ('workspace-local','incarnation','connection','2026-11-13T00:00:00Z');
                 INSERT INTO cloudflare_credential_intents
                 (workspace_id,connection_incarnation_id,intent_id,operation_kind,
                  expected_head_generation,target_generation,target_envelope_kind,
                  scope_digest,zone_digest,target_public_proof,prepared_authority_snapshot_digest,
                  phase,marker_base_recorded,marker_base_envelope_kind,created_at,updated_at)
                 VALUES ('workspace-local','incarnation','unresolved','revoke',0,1,'tombstone',
                         printf('%064d',1),printf('%064d',2),printf('%064d',3),printf('%064d',4),
                         'recovery_required',1,'absent','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z');"
            ).unwrap();
            let snapshot = |connection: &Connection| {
                let mut statement = connection
                    .prepare("SELECT * FROM cloudflare_credential_intents")
                    .unwrap();
                let columns = statement.column_count();
                statement
                    .query_map([], |row| {
                        (0..columns)
                            .map(|column| row.get::<_, rusqlite::types::Value>(column))
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            };
            let before = snapshot(&connection);
            if corrupt_guard {
                connection
                    .execute("DELETE FROM cloudflare_credential_schema_guard", [])
                    .unwrap();
                assert_eq!(
                    run_active_migrations(&mut connection),
                    Err(super::MigrationError::RebuildRequiredP007CredentialSchema)
                );
                let columns:i64=connection.query_row("SELECT count(*) FROM pragma_table_info('cloudflare_credential_roots') WHERE name='retirement_requested_at'",[],|row|row.get(0)).unwrap();
                assert_eq!(columns, 0);
            } else {
                run_active_migrations(&mut connection).unwrap();
                run_active_migrations(&mut connection).unwrap();
                let state: String = connection
                    .query_row(
                        "SELECT credential_use_state FROM local_provider_connections",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(state, "remediation_required");
                // Rebuilt CHECKs require the marker and the exact retirement reason together.
                assert!(connection.execute("UPDATE cloudflare_credential_intents SET phase='abandoned_for_retirement'",[]).is_err());
                assert!(connection.execute("UPDATE cloudflare_credential_roots SET retirement_requested_at='2026-11-13T00:00:00Z'",[]).is_err());
                assert_eq!(snapshot(&connection), before);
                connection.execute("UPDATE cloudflare_credential_intents SET phase='abandoned_for_retirement',terminal_reason='retired'",[]).unwrap();
                connection.execute("UPDATE cloudflare_credential_roots SET retirement_requested_at='2026-11-13T00:00:00Z'",[]).unwrap();
                assert!(connection.execute("UPDATE cloudflare_credential_intents SET phase='consumed',terminal_reason=NULL",[]).is_err());
                let violations: i64 = connection
                    .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(violations, 0);
            }
            if corrupt_guard {
                assert_eq!(snapshot(&connection), before);
            }
        }
    }

    #[test]
    fn sync_v2_append_migration_preserves_prefix_rows_and_checksum() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gooddealer_active_migrations (
               id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) STRICT;",
            )
            .unwrap();
        apply_migration(&mut connection, &super::ACTIVE_MIGRATIONS[0]).unwrap();
        connection
            .execute(
                "INSERT INTO active_workspace_metadata
             (singleton,storage_domain,workspace_id,workspace_schema_version,
              applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
              created_at,updated_at)
             VALUES (1,'active_workspace','workspace-local',1,0,0,1,?1,?1)",
                ["2026-09-14T00:00:00Z"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO sync_outbox
             (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at)
             VALUES ('workspace-local','legacy-pending','domain_asset','legacy.test','{}',?1)",
                ["2026-09-14T00:00:00Z"],
            )
            .unwrap();
        let prefix_checksum: String = connection
            .query_row(
                "SELECT checksum FROM gooddealer_active_migrations WHERE id=?1",
                [super::ACTIVE_MIGRATIONS[0].id],
                |row| row.get(0),
            )
            .unwrap();

        run_active_migrations(&mut connection).unwrap();

        let row: (String, Option<String>, Option<i64>) = connection
            .query_row(
                "SELECT state, wire_mutation_digest, delivery_attempt_fence
             FROM sync_outbox WHERE mutation_id='legacy-pending'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, ("pending".to_owned(), None, None));
        let reopened_prefix_checksum: String = connection
            .query_row(
                "SELECT checksum FROM gooddealer_active_migrations WHERE id=?1",
                [super::ACTIVE_MIGRATIONS[0].id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(reopened_prefix_checksum, prefix_checksum);
        run_active_migrations(&mut connection).unwrap();
    }

    /// Existing listings get the confirmation their run and target already imply.
    #[test]
    fn sales_listing_confirmation_migration_backfills_from_runs_and_targets() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gooddealer_active_migrations (
               id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) STRICT;",
            )
            .unwrap();
        let target = super::ACTIVE_MIGRATIONS
            .iter()
            .position(|migration| migration.id == super::SALES_LISTING_CONFIRMATION_MIGRATION_ID)
            .unwrap();
        for migration in &super::ACTIVE_MIGRATIONS[..target] {
            apply_migration(&mut connection, migration).unwrap();
        }
        let at = "2026-11-13T00:00:00Z";
        connection
            .execute(
                "INSERT INTO active_workspace_metadata
             (singleton,storage_domain,workspace_id,workspace_schema_version,
              applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
              created_at,updated_at) VALUES (1,'active_workspace','workspace-local',1,0,1,2,?1,?1)",
                [at],
            )
            .unwrap();
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','alpha.test','active',?1,?1,1)", [at]).unwrap();
        connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','market-1','cloudflare','Market',?1,'[\"marketplace\"]')", [at]).unwrap();
        for (run, complete) in [("run-done", true), ("run-open", false)] {
            connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'market-1','marketplace',?2,'running')", rusqlite::params![run, at]).unwrap();
            connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,'alpha.test',0,'requested',?2)", rusqlite::params![run, at]).unwrap();
            connection.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local',?1,?1,'alpha.test','atom','active',?2,'version','available','confirmed')", rusqlite::params![run, at]).unwrap();
            connection.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE observation_run_id=?2", rusqlite::params![at, run]).unwrap();
            if complete {
                connection.execute("UPDATE provider_observation_runs SET status='succeeded', completed_at=?1 WHERE observation_run_id=?2", rusqlite::params![at, run]).unwrap();
            }
        }
        run_active_migrations(&mut connection).unwrap();
        let flags: Vec<(String, i64)> = connection
            .prepare("SELECT observation_run_id, confirmed FROM marketplace_listing_observations ORDER BY 1")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            flags,
            [("run-done".to_owned(), 1), ("run-open".to_owned(), 0)]
        );
    }

    #[test]
    fn sync_v4_append_migration_preserves_rows_and_prior_checksums() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gooddealer_active_migrations (
               id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) STRICT;",
            )
            .unwrap();
        for migration in &super::ACTIVE_MIGRATIONS[..3] {
            apply_migration(&mut connection, migration).unwrap();
        }
        connection
            .execute(
                "INSERT INTO active_workspace_metadata
             (singleton,storage_domain,workspace_id,workspace_schema_version,
              applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
              created_at,updated_at) VALUES (1,'active_workspace','workspace-local',1,0,1,2,?1,?1)",
                ["2026-09-15T00:00:00Z"],
            )
            .unwrap();
        connection.execute(
            "INSERT INTO domain_assets(workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
             VALUES ('workspace-local','survives.test','active',?1,?1,1)",
            ["2026-09-15T00:00:00Z"],
        ).unwrap();
        connection.execute(
            "INSERT INTO domain_asset_field_versions(workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at)
             VALUES ('workspace-local','survives.test','note',0,1,'pending',?1)",
            ["2026-09-15T00:00:00Z"],
        ).unwrap();
        let prior = super::read_applied(&connection).unwrap();
        run_active_migrations(&mut connection).unwrap();
        assert_eq!(
            &super::read_applied(&connection).unwrap()[..3],
            prior.as_slice()
        );
        let row: (String, String, String) = connection
            .query_row(
                "SELECT a.entity_id,f.sync_state,p.root_provenance FROM domain_assets a
             JOIN domain_asset_field_versions f USING(workspace_id,entity_id)
             JOIN sync_asset_provenance p USING(workspace_id,entity_id)
             WHERE a.entity_id='survives.test'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            (
                "survives.test".to_owned(),
                "pending".to_owned(),
                "local_only".to_owned()
            )
        );
    }

    #[test]
    fn sync_v4_legacy_journal_migrates_without_removing_evidence() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gooddealer_active_migrations (
               id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) STRICT;",
            )
            .unwrap();
        for migration in &super::ACTIVE_MIGRATIONS[..3] {
            apply_migration(&mut connection, migration).unwrap();
        }
        connection
            .execute(
                "INSERT INTO active_workspace_metadata
             (singleton,storage_domain,workspace_id,workspace_schema_version,
              applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
              created_at,updated_at) VALUES (1,'active_workspace','workspace-local',1,0,0,1,?1,?1)",
                ["2026-09-15T00:00:00Z"],
            )
            .unwrap();
        connection.execute(
            "INSERT INTO sync_rebootstrap_journal
             (workspace_id,publication_sequence,old_slot_id,new_slot_id,old_key_digest,new_key_digest,
              authority_generation,server_revision_floor,schema_version_floor,manifest_digest,state,
              created_at,updated_at) VALUES ('workspace-local',1,'old','new',?1,?1,1,0,2,?1,'verified',?2,?2)",
            ["a".repeat(64), "2026-09-15T00:00:00Z".to_owned()],
        ).unwrap();
        run_active_migrations(&mut connection).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM sync_rebootstrap_journal", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(sync_rebootstrap_journal)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(columns.contains(&"journal_id".to_owned()));
        assert!(
            !columns
                .iter()
                .any(|name| name.contains("key") || name.contains("path"))
        );
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the append-migration test keeps before/after invariants in one transaction proof"
    )]
    fn provider_binding_append_migration_preserves_existing_business_rows() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gooddealer_active_migrations (
                   id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL,
                   applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ) STRICT;",
            )
            .unwrap();
        let target_index = super::ACTIVE_MIGRATIONS
            .iter()
            .position(|migration| {
                migration.id
                    == crate::active_workspace::schema::DOMAIN_PROVIDER_BINDING_MIGRATION_ID
            })
            .expect("binding migration registered");
        for migration in &super::ACTIVE_MIGRATIONS[..target_index] {
            apply_migration(&mut connection, migration).unwrap();
        }
        connection
            .execute(
                "INSERT INTO active_workspace_metadata
                 (singleton,storage_domain,workspace_id,workspace_schema_version,
                  applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
                  created_at,updated_at)
                 VALUES (1,'active_workspace','workspace-local',1,17,23,29,?1,?1)",
                ["2026-09-15T00:00:00Z"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
                 VALUES ('workspace-local','binding-survives.test','active',?1,?1,23)",
                ["2026-09-15T00:00:00Z"],
            )
            .unwrap();
        let snapshot = |connection: &Connection| {
            ["domain_assets", "active_workspace_metadata"].map(|table| {
                let mut statement = connection
                    .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                    .unwrap();
                let columns = statement.column_count();
                statement
                    .query_map([], |row| {
                        (0..columns)
                            .map(|index| row.get::<_, rusqlite::types::Value>(index))
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            })
        };
        let before = snapshot(&connection);
        let prior = super::read_applied(&connection).unwrap();
        run_active_migrations(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT entity_id FROM domain_assets WHERE entity_id='binding-survives.test'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "binding-survives.test"
        );
        assert_eq!(
            &super::read_applied(&connection).unwrap()[..target_index],
            prior.as_slice()
        );
        assert_eq!(snapshot(&connection), before);
        let applied = super::read_applied(&connection).unwrap();
        assert_eq!(
            applied
                .iter()
                .filter(|row| row.0
                    == crate::active_workspace::schema::DOMAIN_PROVIDER_BINDING_MIGRATION_ID)
                .count(),
            1
        );
        run_active_migrations(&mut connection).unwrap();
        assert_eq!(super::read_applied(&connection).unwrap(), applied);
        assert_eq!(snapshot(&connection), before);
        verify_active_manifest(&connection).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        assert_eq!(connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='domain_asset_provider_bindings'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(), 1);
    }

    #[test]
    fn outbox_created_at_must_be_a_canonical_utc_instant() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        run_active_migrations(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO active_workspace_metadata
             (singleton,storage_domain,workspace_id,workspace_schema_version,
              applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,
              created_at,updated_at)
             VALUES (1,'active_workspace','workspace-local',1,0,0,1,?1,?1)",
                ["2026-09-14T00:00:00Z"],
            )
            .unwrap();
        let insert = |mutation_id: &str, created_at: &str| {
            connection.execute(
                "INSERT INTO sync_outbox
                 (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at)
                 VALUES ('workspace-local',?1,'domain_asset','canonical.test','{}',?2)",
                [mutation_id, created_at],
            )
        };
        // Each value gets the same verdict from the trigger and from `validate_timestamp`, the rule
        // the Host's reads apply, so the two cannot drift apart unnoticed.
        let read_rule = |value: &str| {
            crate::portfolio_projection::validate_timestamp(Some(value.to_owned())).is_ok()
        };
        for (index, accepted) in ["2026-11-06T00:00:00Z", "2028-02-29T23:59:59Z"]
            .into_iter()
            .enumerate()
        {
            assert!(read_rule(accepted), "{accepted:?}");
            insert(&format!("accepted-{index}"), accepted).unwrap();
        }
        for (index, rejected) in [
            "2026-11-06T00:00:00.000Z",
            "2026-11-06T08:00:00+08:00",
            "2026-11-06 00:00:00",
            "2026-11-06T00:00:00",
            "2026-11-06",
            "2027-02-29T00:00:00Z",
            "2026-11-06T24:00:00Z",
            "2026-11-06T00:60:00Z",
            "2026-11-06T00:00:60Z",
            "2026-11-06t00:00:00z",
            "2026-11-06T00:00Z",
            "2026-11-06T00:00:00Z ",
            "",
            "not a time",
        ]
        .into_iter()
        .enumerate()
        {
            assert!(!read_rule(rejected), "{rejected:?}");
            assert!(
                insert(&format!("rejected-{index}"), rejected).is_err(),
                "{rejected:?} must be rejected"
            );
        }
        // An update cannot slip a non-canonical value past the insert rule either.
        assert!(
            connection
                .execute(
                    "UPDATE sync_outbox SET created_at = '2026-11-06T00:00:00.5Z'
                     WHERE mutation_id = 'accepted-0'",
                    [],
                )
                .is_err()
        );
    }
}
