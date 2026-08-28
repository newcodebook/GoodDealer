use rusqlite::{Connection, TransactionBehavior, params};
use sha2::{Digest, Sha256};

use crate::active_workspace::schema::{
    ACTIVE_SCHEMA_MIGRATION_ID, ACTIVE_SCHEMA_MIGRATION_OWNER, ACTIVE_SCHEMA_MIGRATION_SQL,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MigrationError;

#[derive(Clone, Copy)]
struct ActiveMigration {
    id: i64,
    owner: &'static str,
    sql: &'static str,
}

const ACTIVE_MIGRATIONS: &[ActiveMigration] = &[ActiveMigration {
    id: ACTIVE_SCHEMA_MIGRATION_ID,
    owner: ACTIVE_SCHEMA_MIGRATION_OWNER,
    sql: ACTIVE_SCHEMA_MIGRATION_SQL,
}];

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
        .map_err(|_| MigrationError)?;

    let applied = read_applied(connection)?;
    if applied.len() > ACTIVE_MIGRATIONS.len() {
        return Err(MigrationError);
    }
    for (index, row) in applied.iter().enumerate() {
        let expected = &ACTIVE_MIGRATIONS[index];
        if row.0 != expected.id || row.1 != expected.owner || row.2 != checksum(expected.sql) {
            return Err(MigrationError);
        }
    }
    for migration in &ACTIVE_MIGRATIONS[applied.len()..] {
        apply_migration(connection, migration)?;
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
        return Err(MigrationError);
    }
    Ok(())
}

fn apply_migration(
    connection: &mut Connection,
    migration: &ActiveMigration,
) -> Result<(), MigrationError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MigrationError)?;
    transaction
        .execute_batch(migration.sql)
        .map_err(|_| MigrationError)?;
    transaction
        .execute(
            "INSERT INTO gooddealer_active_migrations(id, owner, checksum) VALUES (?1, ?2, ?3)",
            params![migration.id, migration.owner, checksum(migration.sql)],
        )
        .map_err(|_| MigrationError)?;
    transaction.commit().map_err(|_| MigrationError)
}

fn read_applied(connection: &Connection) -> Result<Vec<(i64, String, String)>, MigrationError> {
    let mut statement = connection
        .prepare("SELECT id, owner, checksum FROM gooddealer_active_migrations ORDER BY id")
        .map_err(|_| MigrationError)?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|_| MigrationError)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| MigrationError)
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
    fn complete_business_schema_matches_the_fail_closed_manifest() {
        assert_eq!(super::ACTIVE_MIGRATIONS.len(), 1);
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
        assert_eq!(table_count, 30);
        assert!(business_index_count >= 22);
    }
}
