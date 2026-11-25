use super::{ACTIVE_MIGRATIONS, apply_migration, run_active_migrations};
use rusqlite::{Connection, params};

const AT: &str = "2026-11-24T00:00:00Z";
const PORKBUN_DNS_MIGRATION_ID: i64 = 202_611_240_002;

fn insert_connection(database: &Connection, id: &str, role: &str) -> rusqlite::Result<usize> {
    database.execute(
        "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,
         active_credential_changed_at,lifecycle_status,capabilities_json,created_at,validation_status,
         connection_incarnation_id,credential_use_state)
         VALUES ('workspace-local',?1,'porkbun',?1,?2,'invalid',?3,?2,'unknown',?1,'inactive')",
        params![id, AT, role],
    )?;
    database.execute(
        "INSERT INTO porkbun_registrar_connections
         (workspace_id,connection_id,incarnation_id,credential_proof,state,scan_pending,created_at)
         VALUES ('workspace-local',?1,?1,?2,'prepared',1,?3)",
        params![id, "a".repeat(64), AT],
    )
}

fn capabilities(database: &Connection, id: &str) -> String {
    database
        .query_row(
            "SELECT json(capabilities_json) FROM local_provider_connections WHERE connection_id=?1",
            [id],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn existing_porkbun_slots_gain_the_dns_role_and_stay_frozen() {
    let mut database = Connection::open_in_memory().unwrap();
    database
        .execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE gooddealer_active_migrations(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,
               checksum TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;",
        )
        .unwrap();
    for migration in ACTIVE_MIGRATIONS
        .iter()
        .take_while(|migration| migration.id != PORKBUN_DNS_MIGRATION_ID)
    {
        apply_migration(&mut database, migration).unwrap();
    }
    database
        .execute(
            "INSERT INTO active_workspace_metadata (singleton,storage_domain,workspace_id,
             workspace_schema_version,applied_through_server_revision,local_commit_sequence,
             next_device_mutation_sequence,created_at,updated_at)
             VALUES (1,'active_workspace','workspace-local',1,0,1,2,?1,?1)",
            [AT],
        )
        .unwrap();
    insert_connection(&database, "legacy", r#"["registrar"]"#).unwrap();
    // A Porkbun row without a slot is not a Porkbun registrar connection and is left alone.
    database
        .execute(
            "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,
             active_credential_changed_at,capabilities_json,connection_incarnation_id,credential_use_state)
             VALUES ('workspace-local','unslotted','porkbun','Unslotted',?1,'[\"registrar\"]','unslotted','inactive')",
            [AT],
        )
        .unwrap();

    run_active_migrations(&mut database).unwrap();
    run_active_migrations(&mut database).unwrap();

    assert_eq!(capabilities(&database, "legacy"), r#"["dns","registrar"]"#);
    assert_eq!(capabilities(&database, "unslotted"), r#"["registrar"]"#);
    for role in [r#"["registrar"]"#, r#"["dns"]"#, r#"["registrar","dns"]"#] {
        assert!(
            database
                .execute(
                    "UPDATE local_provider_connections SET capabilities_json=?1 WHERE connection_id='legacy'",
                    [role],
                )
                .is_err(),
            "{role}"
        );
    }
    assert!(insert_connection(&database, "old-shape", r#"["registrar"]"#).is_err());
    insert_connection(&database, "new-shape", r#"["dns","registrar"]"#).unwrap();
}

#[test]
fn a_dns_read_receipt_needs_a_completed_run_and_an_active_slot() {
    let mut database = Connection::open_in_memory().unwrap();
    database.pragma_update(None, "foreign_keys", true).unwrap();
    run_active_migrations(&mut database).unwrap();
    database
        .execute(
            "INSERT INTO active_workspace_metadata (singleton,storage_domain,workspace_id,
             workspace_schema_version,applied_through_server_revision,local_commit_sequence,
             next_device_mutation_sequence,created_at,updated_at)
             VALUES (1,'active_workspace','workspace-local',1,0,1,2,?1,?1)",
            [AT],
        )
        .unwrap();
    insert_connection(&database, "slot", r#"["dns","registrar"]"#).unwrap();
    let receipt = |count: i64, elsewhere: i64| {
        database.execute(
            "INSERT INTO porkbun_dns_reads (workspace_id,observation_run_id,connection_id,entity_id,
             record_count,answered_elsewhere,completed_at)
             VALUES ('workspace-local','run','slot','example.test',?1,?2,?3)",
            params![count, elsewhere, AT],
        )
    };
    // No run, no active slot: refused.
    assert!(receipt(0, 0).is_err());
}
