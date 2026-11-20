use super::run_active_migrations;
use rusqlite::{Connection, params};

const AT: &str = "2026-11-20T00:00:00Z";

fn database_with_prepared_connections() -> Connection {
    let mut database = Connection::open_in_memory().unwrap();
    database.pragma_update(None, "foreign_keys", true).unwrap();
    run_active_migrations(&mut database).unwrap();
    database.execute(
        "INSERT INTO active_workspace_metadata (singleton,storage_domain,workspace_id,workspace_schema_version,
         applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,created_at,updated_at)
         VALUES (1,'active_workspace','workspace-local',1,0,1,2,?1,?1)",
        [AT],
    ).unwrap();
    for (id, role) in [
        ("marketplace", r#"["marketplace"]"#),
        ("registrar", r#"["registrar"]"#),
    ] {
        database.execute(
            "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,
             active_credential_changed_at,lifecycle_status,capabilities_json,created_at,validation_status,
             connection_incarnation_id,credential_use_state)
             VALUES ('workspace-local',?1,'spaceship',?1,?2,'invalid',?3,?2,'unknown',?4,'inactive')",
            params![id, AT, role, format!("incarnation-{id}")],
        ).unwrap();
    }
    database
}

#[test]
fn marketplace_publication_uses_the_exact_slot_and_consumes_only_its_request() {
    let database = database_with_prepared_connections();
    let publish = "UPDATE local_provider_connections
        SET lifecycle_status='active',validation_status='valid',credential_use_state='active'
        WHERE workspace_id='workspace-local' AND connection_id=?1";
    assert!(database.execute(publish, ["marketplace"]).is_err());
    assert!(database.execute(publish, ["registrar"]).is_err());
    let prepare_marketplace = "INSERT INTO spaceship_sellerhub_connections
         (workspace_id,connection_id,incarnation_id,credential_proof,state,created_at)
         VALUES ('workspace-local',?1,?2,?3,'prepared',?4)";
    let proof = "a".repeat(64);
    assert!(
        database
            .execute(
                prepare_marketplace,
                params!["registrar", "incarnation-registrar", proof, AT]
            )
            .is_err()
    );
    database
        .execute(
            prepare_marketplace,
            params!["marketplace", "incarnation-marketplace", proof, AT],
        )
        .unwrap();
    assert!(
        database
            .execute(
                "UPDATE local_provider_connections SET capabilities_json='[\"registrar\"]'
         WHERE workspace_id='workspace-local' AND connection_id='marketplace'",
                [],
            )
            .is_err()
    );
    let queue = "INSERT INTO spaceship_sellerhub_pending_scans
        (workspace_id,connection_id,incarnation_id,device_id,lease_epoch,request_id)
        VALUES ('workspace-local','marketplace',?1,'device-a',1,?2)";
    assert!(
        database
            .execute(queue, ["incarnation-registrar", "old-scan"])
            .is_err()
    );
    database
        .execute(queue, ["incarnation-marketplace", "scan-1"])
        .unwrap();
    database
        .execute(
            "UPDATE spaceship_sellerhub_connections SET state='active'
         WHERE workspace_id='workspace-local' AND connection_id='marketplace'",
            [],
        )
        .unwrap();
    database.execute(publish, ["marketplace"]).unwrap();
    assert!(database.execute(publish, ["registrar"]).is_err());
    let save_empty_scan = "INSERT INTO spaceship_sellerhub_scans
        (workspace_id,scan_id,connection_id,observed_count,imported_count,skipped_count,completed_at)
        VALUES ('workspace-local',?1,'marketplace',0,0,0,?2)";
    let generation = || {
        database
            .query_row(
                "SELECT generation FROM sales_listing_generation WHERE singleton=1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
    };
    assert!(database.execute(save_empty_scan, ["old-scan", AT]).is_err());
    let before = generation();
    database.execute(save_empty_scan, ["scan-1", AT]).unwrap();
    assert_eq!(generation(), before + 1);
    assert!(
        database
            .execute(queue, ["incarnation-marketplace", "scan-1"])
            .is_err()
    );
    database
        .execute(queue, ["incarnation-marketplace", "scan-2"])
        .unwrap();
    database
        .execute(
            "UPDATE spaceship_sellerhub_connections SET state='revoked'
         WHERE workspace_id='workspace-local' AND connection_id='marketplace'",
            [],
        )
        .unwrap();
    assert!(database.execute(save_empty_scan, ["scan-2", AT]).is_err());
    assert!(database.execute(publish, ["marketplace"]).is_err());
}
