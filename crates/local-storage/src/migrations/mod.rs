use rusqlite::{Connection, TransactionBehavior, params};
use sha2::{Digest, Sha256};

use crate::active_workspace::schema::{
    ACTIVE_SCHEMA_MIGRATION_ID, ACTIVE_SCHEMA_MIGRATION_OWNER, ACTIVE_SCHEMA_MIGRATION_SQL,
    CLOUDFLARE_V1_MIGRATION_ID, CLOUDFLARE_V1_MIGRATION_OWNER, CLOUDFLARE_V1_MIGRATION_SQL,
    CLOUDFLARE_V2_MIGRATION_ID, CLOUDFLARE_V2_MIGRATION_OWNER, CLOUDFLARE_V2_MIGRATION_SQL,
    DOMAIN_PROVIDER_BINDING_MIGRATION_ID, DOMAIN_PROVIDER_BINDING_MIGRATION_OWNER,
    DOMAIN_PROVIDER_BINDING_MIGRATION_SQL, SYNC_V2_MIGRATION_ID, SYNC_V2_MIGRATION_OWNER,
    SYNC_V2_MIGRATION_SQL, SYNC_V3_MIGRATION_ID, SYNC_V3_MIGRATION_OWNER, SYNC_V3_MIGRATION_SQL,
    SYNC_V4_MIGRATION_ID, SYNC_V4_MIGRATION_OWNER, SYNC_V4_MIGRATION_SQL, SYNC_V5_MIGRATION_ID,
    SYNC_V5_MIGRATION_OWNER, SYNC_V5_MIGRATION_SQL,
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
    fn complete_business_schema_matches_the_fail_closed_manifest() {
        assert_eq!(super::ACTIVE_MIGRATIONS.len(), 8);
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
        assert_eq!(table_count, 44);
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
        assert!(connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='domain_asset_provider_bindings'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap() == 1);
    }
}
