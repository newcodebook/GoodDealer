//! The forward migration preserves all original ledgers and introduces only Afternic-owned facts.
use super::*;
#[test]
fn afternic_delist_forward_migration_preserves_inventory_schema_and_is_idempotent() {
    let mut c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE gooddealer_active_migrations(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;").unwrap();
    for migration in ACTIVE_MIGRATIONS
        .iter()
        .take_while(|m| m.id != AFTERNIC_DELIST_MIGRATION_ID)
    {
        apply_migration(&mut c, migration).unwrap();
    }
    let before = read_applied(&c).unwrap();
    run_active_migrations(&mut c).unwrap();
    assert_eq!(&read_applied(&c).unwrap()[..before.len()], before);
    run_active_migrations(&mut c).unwrap();
    crate::active_workspace::portfolio::verify_active_manifest(&c).unwrap();
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM gooddealer_active_migrations WHERE id=?1",
            [AFTERNIC_DELIST_MIGRATION_ID],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    assert_eq!(
        c.query_row(
            "SELECT schema_epoch FROM cloudflare_credential_schema_guard",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "P0_07_CREDENTIAL_SCHEMA_V5"
    );
}
#[test]
fn afternic_delist_receipt_cannot_exist_without_the_exact_approved_attempt() {
    let mut c = Connection::open_in_memory().unwrap();
    run_active_migrations(&mut c).unwrap();
    assert!(c.execute("INSERT INTO afternic_delist_reconciliations(workspace_id,operation_id,plan_id,item_id,attempt_number,sequence,request_digest,stage,outcome,reason,observed_at,next_read_at) VALUES('ws','op','plan','item',1,1,?1,'reconcile','read_failed','read_failed','2026-11-19T00:00:00Z','2026-11-19T00:00:30Z')",["a".repeat(64)]).is_err());
}
