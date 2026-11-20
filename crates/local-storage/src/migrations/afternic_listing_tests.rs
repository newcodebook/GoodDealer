//! Forward-only custody and Listing ownership proofs, including read/cache behavior.
use super::*;
use crate::active_workspace::portfolio::{ActivePortfolioReader, verify_active_manifest};
use crate::active_workspace::sales::{ActiveSalesReader, SalesCache};
use crate::active_workspace::settings::ActiveSettingsReader;

const TIME: &str = "2026-11-18T00:00:00Z";
const LATER: &str = "2026-11-18T00:01:00Z";

fn before_migration() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; CREATE TABLE gooddealer_active_migrations (id INTEGER PRIMARY KEY,owner TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;").unwrap();
    for migration in ACTIVE_MIGRATIONS
        .iter()
        .take_while(|m| m.id != AFTERNIC_LISTING_MIGRATION_ID)
    {
        apply_migration(&mut c, migration).unwrap();
    }
    c.execute("INSERT INTO active_workspace_metadata (singleton,storage_domain,workspace_id,workspace_schema_version,applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,created_at,updated_at) VALUES(1,'active_workspace','ws',1,0,1,2,?1,?1)",[TIME]).unwrap();
    for domain in ["example.com", "other.com"] {
        c.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES('ws',?1,'active',?2,?2,1)",params![domain,TIME]).unwrap();
    }
    c
}

fn database() -> Connection {
    let mut c = before_migration();
    run_active_migrations(&mut c).unwrap();
    c
}

fn add_connection(c: &Connection, id: &str, provider: &str, incarnation: Option<&str>) {
    c.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,connection_incarnation_id) VALUES('ws',?1,?2,?1,?3,'[\"marketplace\"]',?4)",params![id,provider,TIME,incarnation]).unwrap();
}

fn prepare(c: &Connection, connection: &str, generation: i64) -> rusqlite::Result<usize> {
    c.execute("INSERT INTO afternic_connection_publications (workspace_id,connection_id,credential_generation,connection_incarnation_id,credential_public_proof,authority_snapshot_digest,publication_state,created_at,updated_at) VALUES('ws',?1,?2,?1,?3,?3,'prepared',?4,?4)",params![connection,generation,"a".repeat(64),TIME])
}

fn activate(c: &Connection, id: &str) {
    prepare(c, id, 1).unwrap();
    c.execute("UPDATE afternic_connection_publications SET publication_state='active' WHERE connection_id=?1",[id]).unwrap();
    c.execute("UPDATE local_provider_connections SET credential_use_state='active',validation_status='valid' WHERE connection_id=?1",[id]).unwrap();
}

fn bind(c: &Connection, connection: &str, digest: char) {
    c.execute("INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,created_at,updated_at) VALUES('ws','example.com',?1,'afternic','listing',?2,?2,'example.com',1,1,'unverified',?3,?3)",params![connection,digest.to_string().repeat(64),TIME]).unwrap();
}

fn start_run(c: &Connection, id: &str, connection: &str) {
    c.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES('ws',?1,?2,'marketplace',?3,'running')",params![id,connection,TIME]).unwrap();
    c.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES('ws',?1,'example.com',0,'requested',?2)",params![id,TIME]).unwrap();
}

fn insert_observation(
    c: &Connection,
    id: &str,
    connection: Option<&str>,
    digest: Option<&str>,
    generation: Option<i64>,
    status: &str,
) -> rusqlite::Result<usize> {
    c.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,asking_price_currency,asking_price_amount,observed_at,provider_version_token,observation_availability,evidence_status,binding_connection_id,binding_resource_digest,binding_generation) VALUES('ws',?1,?1,'example.com','afternic',?5,'USD','100',?6,'v1','available','confirmed',?2,?3,?4)",params![id,connection,digest,generation,status,TIME])
}

fn finish_run(c: &Connection, id: &str) {
    c.execute("UPDATE provider_observation_targets SET status='succeeded',completed_at=?2 WHERE observation_run_id=?1",params![id,TIME]).unwrap();
    c.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?2 WHERE observation_run_id=?1",params![id,TIME]).unwrap();
}

fn observe(c: &Connection, id: &str, connection: &str, digest: char, status: &str) {
    start_run(c, id, connection);
    insert_observation(
        c,
        id,
        Some(connection),
        Some(&digest.to_string().repeat(64)),
        Some(1),
        status,
    )
    .unwrap();
    finish_run(c, id);
}

#[test]
fn forward_migration_preserves_legacy_evidence_and_applied_sql() {
    let mut c = before_migration();
    add_connection(&c, "legacy", "afternic", None);
    start_run(&c, "legacy-run", "legacy");
    c.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,evidence_status) VALUES('ws','legacy-run','legacy-run','example.com','afternic','active',?1,'v1','available','confirmed')",[TIME]).unwrap();
    finish_run(&c, "legacy-run");
    let ledger = read_applied(&c).unwrap();
    run_active_migrations(&mut c).unwrap();
    assert_eq!(&read_applied(&c).unwrap()[..ledger.len()], ledger);
    assert!(c.query_row("SELECT binding_connection_id IS NULL AND binding_resource_digest IS NULL AND binding_generation IS NULL AND confirmed=1 FROM marketplace_listing_observations",[],|row|row.get::<_,bool>(0)).unwrap());
    let cache = SalesCache::default();
    let sales = ActiveSalesReader::new(&c, &cache)
        .read("ws", 0, 20)
        .unwrap();
    assert_eq!(sales.active_listing_count, 1);
    assert_eq!(sales.window.rows[0].marketplaces, ["afternic"]);
    verify_active_manifest(&c).unwrap();
    run_active_migrations(&mut c).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
}

#[test]
fn migration_rejects_unknown_guard_and_rolls_back_partial_ddl() {
    let mut c = before_migration();
    let ledger = read_applied(&c).unwrap();
    c.execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE cloudflare_credential_schema_guard SET schema_fingerprint='unknown'; PRAGMA ignore_check_constraints=OFF;").unwrap();
    assert_eq!(
        run_active_migrations(&mut c),
        Err(MigrationError::RebuildRequiredP007CredentialSchema)
    );
    assert_eq!(read_applied(&c).unwrap(), ledger);
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name='afternic_connection_publications'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    let mut c = before_migration();
    let ledger = read_applied(&c).unwrap();
    c.execute_batch(
        "CREATE INDEX afternic_connection_publications_live ON domain_assets(entity_id)",
    )
    .unwrap();
    assert_eq!(run_active_migrations(&mut c), Err(MigrationError::Rejected));
    assert_eq!(read_applied(&c).unwrap(), ledger);
    assert_eq!(
        c.query_row(
            "SELECT schema_epoch FROM cloudflare_credential_schema_guard",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "P0_07_CREDENTIAL_SCHEMA_V4"
    );
    c.execute_batch("DROP INDEX afternic_connection_publications_live")
        .unwrap();
    run_active_migrations(&mut c).unwrap();
}

#[test]
fn publication_is_provider_scoped_monotonic_and_keeps_purge_evidence() {
    let c = database();
    add_connection(&c, "af-1", "afternic", Some("af-1"));
    add_connection(&c, "cf-1", "cloudflare", Some("cf-1"));
    assert!(prepare(&c, "cf-1", 1).is_err());
    assert!(prepare(&c, "af-1", 2).is_err());
    assert!(
        c.execute(
            "UPDATE local_provider_connections SET credential_use_state='active'",
            []
        )
        .is_err()
    );
    prepare(&c, "af-1", 1).unwrap();
    assert!(prepare(&c, "af-1", 2).is_err());
    for sql in [
        "UPDATE afternic_connection_publications SET credential_public_proof=printf('%064d',0)",
        "UPDATE afternic_connection_publications SET authority_snapshot_digest=printf('%064d',0)",
        "UPDATE afternic_connection_publications SET workspace_id='other'",
        "UPDATE afternic_connection_publications SET purged_at='2026-11-18T00:01:00Z'",
        "UPDATE local_provider_connections SET provider_kind='sedo' WHERE connection_id='af-1'",
        "UPDATE local_provider_connections SET connection_incarnation_id='replacement' WHERE connection_id='af-1'",
        "DELETE FROM afternic_connection_publications",
    ] {
        assert!(c.execute(sql, []).is_err(), "{sql}");
    }
    c.execute(
        "UPDATE afternic_connection_publications SET publication_state='active'",
        [],
    )
    .unwrap();
    c.execute("UPDATE local_provider_connections SET credential_use_state='active' WHERE connection_id='af-1'",[]).unwrap();
    assert!(c.execute("UPDATE local_provider_connections SET active_credential_generation=1 WHERE connection_id='af-1'",[]).is_err());
    // Cloudflare still refuses both malformed publication and retirement without its custody root.
    assert!(c.execute("UPDATE local_provider_connections SET credential_use_state='active' WHERE connection_id='cf-1'",[]).is_err());
    assert!(c.execute("UPDATE local_provider_connections SET credential_use_state='retired' WHERE connection_id='cf-1'",[]).is_err());
    c.execute(
        "UPDATE afternic_connection_publications SET publication_state='remediation_required'",
        [],
    )
    .unwrap();
    assert_eq!(c.query_row("SELECT credential_use_state FROM local_provider_connections WHERE connection_id='af-1'",[],|r|r.get::<_,String>(0)).unwrap(),"remediation_required");
    assert!(
        c.execute(
            "UPDATE afternic_connection_publications SET publication_state='active'",
            []
        )
        .is_err()
    );
    c.execute("UPDATE afternic_connection_publications SET publication_state='revoked',updated_at=?1,purged_at=?1",[LATER]).unwrap();
    assert!(
        c.execute(
            "UPDATE afternic_connection_publications SET purged_at=NULL",
            []
        )
        .is_err()
    );
    assert!(
        c.execute(
            "UPDATE afternic_connection_publications SET publication_state='prepared'",
            []
        )
        .is_err()
    );
    prepare(&c, "af-1", 2).unwrap();
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM afternic_connection_publications",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
}

#[test]
fn observation_requires_exact_live_binding_and_detachment_never_revives() {
    let c = database();
    for id in ["af-1", "af-2"] {
        add_connection(&c, id, "afternic", Some(id));
        activate(&c, id);
        bind(&c, id, 'b');
    }
    start_run(&c, "run", "af-1");
    let digest = "b".repeat(64);
    for (connection, digest, generation) in [
        (None, None, None),
        (Some("af-1"), None, Some(1)),
        (Some("af-2"), Some(digest.as_str()), Some(1)),
        (Some("af-1"), Some(digest.as_str()), Some(2)),
        (Some("missing"), Some(digest.as_str()), Some(1)),
    ] {
        assert!(insert_observation(&c, "run", connection, digest, generation, "active").is_err());
    }
    insert_observation(&c, "run", Some("af-1"), Some(&digest), Some(1), "active").unwrap();
    assert!(
        c.execute(
            "UPDATE marketplace_listing_observations SET binding_generation=2",
            []
        )
        .is_err()
    );
    assert!(
        c.execute(
            "UPDATE marketplace_listing_observations SET binding_connection_id='af-2'",
            []
        )
        .is_err()
    );
    c.execute(
        "UPDATE domain_asset_provider_bindings SET binding_generation=2 WHERE connection_id='af-1'",
        [],
    )
    .unwrap();
    assert!(c.execute("UPDATE domain_asset_provider_bindings SET binding_generation=1 WHERE connection_id='af-1'",[]).is_err());
    c.execute("UPDATE domain_asset_provider_bindings SET validation_status='detached' WHERE connection_id='af-1'",[]).unwrap();
    // No replacement is needed for the detached identity to remain terminal.
    assert!(c.execute("UPDATE domain_asset_provider_bindings SET validation_status='unverified' WHERE connection_id='af-1'",[]).is_err());
    start_run(&c, "run-2", "af-1");
    assert!(
        insert_observation(&c, "run-2", Some("af-1"), Some(&digest), Some(2), "active").is_err()
    );
}

#[test]
fn sales_merge_keeps_each_connection_and_invalidates_on_binding_or_custody_change() {
    let c = database();
    for id in ["af-1", "af-2"] {
        add_connection(&c, id, "afternic", Some(id));
        activate(&c, id);
        bind(&c, id, 'b');
    }
    observe(&c, "run-1", "af-1", 'b', "active");
    observe(&c, "run-2", "af-2", 'b', "unlisted");
    let cache = SalesCache::default();
    let read = || {
        ActiveSalesReader::new(&c, &cache)
            .read("ws", 0, 20)
            .unwrap()
    };
    assert_eq!(read().active_listing_count, 1);
    assert_eq!(read().listed_value.unwrap().amount, "100");
    assert_eq!(
        ActivePortfolioReader::new(&c)
            .read_asset_library("ws", 0, 20, "")
            .unwrap()
            .listing_count,
        1
    );
    observe(&c, "run-3", "af-2", 'b', "sold");
    assert_eq!(read().window.rows[0].listing_status, "conflict");
    c.execute("UPDATE domain_asset_provider_bindings SET validation_status='detached' WHERE connection_id='af-2'",[]).unwrap();
    assert_eq!(read().window.rows[0].listing_status, "unknown");
    bind(&c, "af-2", 'c');
    // New binding evidence wins even if its timestamp sorts before retained old evidence.
    observe(&c, "run-0", "af-2", 'c', "active");
    assert_eq!(read().active_listing_count, 1);
    c.execute("UPDATE afternic_connection_publications SET publication_state='revoked' WHERE connection_id='af-1'",[]).unwrap();
    assert_eq!(read().window.rows[0].listing_status, "unknown");
    assert_eq!(read().total_rows, 1);
    assert_eq!(
        ActiveSettingsReader::new(&c, &cache)
            .read("ws")
            .unwrap()
            .storage_integrity
            .rejected_listings,
        0
    );
}

#[test]
fn details_keep_ownership_status_and_reject_invalid_money_or_mutation() {
    let c = database();
    add_connection(&c, "af-1", "afternic", Some("af-1"));
    activate(&c, "af-1");
    bind(&c, "af-1", 'b');
    start_run(&c, "run", "af-1");
    insert_observation(
        &c,
        "run",
        Some("af-1"),
        Some(&"b".repeat(64)),
        Some(1),
        "unknown",
    )
    .unwrap();
    let insert = |status: &str, bin: i64, minbid: i64| {
        c.execute("INSERT INTO afternic_listing_details (workspace_id,listing_observation_id,provider_status,buynow_price,minbid_price,provider_created_at,provider_updated_at) VALUES('ws','run',?1,?2,?3,?4,?4)",params![status,bin,minbid,TIME])
    };
    for (status, bin, minbid) in [
        ("BOGUS", 100_000_000, 20_000_000),
        ("ACTIVE", 100_000_001, 20_000_000),
        ("ACTIVE", 49_999_999_000_001, 20_000_000),
        ("ACTIVE", 100_000_000, 19_000_000),
    ] {
        assert!(insert(status, bin, minbid).is_err());
    }
    insert("OWNERSHIP_REVIEW", 100_000_000, 20_000_000).unwrap();
    assert!(
        c.execute(
            "UPDATE afternic_listing_details SET provider_status='ACTIVE'",
            []
        )
        .is_err()
    );
    assert!(
        c.execute("DELETE FROM afternic_listing_details", [])
            .is_err()
    );
    finish_run(&c, "run");
    let cache = SalesCache::default();
    assert_eq!(
        ActiveSalesReader::new(&c, &cache)
            .read("ws", 0, 20)
            .unwrap()
            .window
            .rows[0]
            .listing_status,
        "unknown"
    );
}

#[test]
fn empty_scan_is_durable_without_fake_targets_and_rejects_invalid_completion() {
    let c = database();
    add_connection(&c, "af-1", "afternic", Some("af-1"));
    activate(&c, "af-1");
    let insert = |id: &str, generation: i64, skipped: &str| {
        c.execute("INSERT INTO afternic_inventory_scans (workspace_id,scan_id,connection_id,credential_generation,observed_count,imported_count,skipped_deleted_json,completed_at,freshness_anchor_run_id) VALUES ('ws',?1,'af-1',?2,0,0,?3,?4,'')",params![id,generation,skipped,TIME])
    };
    for skipped in [
        "{}",
        "[1]",
        "[null]",
        "[\"UPPER.com\"]",
        "[\"a..com\"]",
        "[\"a.com\",\"a.com\"]",
    ] {
        assert!(insert("bad", 1, skipped).is_err(), "{skipped}");
    }
    assert!(insert("bad", 2, "[]").is_err());
    insert("empty", 1, "[]").unwrap();
    insert("deleted", 1, "[\"example.com\"]").unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM provider_observation_runs", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
    assert!(
        c.execute("UPDATE afternic_inventory_scans SET imported_count=1", [])
            .is_err()
    );
    assert!(
        c.execute("DELETE FROM afternic_inventory_scans", [])
            .is_err()
    );
    c.execute(
        "UPDATE afternic_connection_publications SET publication_state='revoked'",
        [],
    )
    .unwrap();
    assert!(insert("revoked", 1, "[]").is_err());
}

#[test]
fn persisted_preparation_survives_reopen_and_serializes_competing_publication() {
    let c = database();
    add_connection(&c, "af-1", "afternic", Some("af-1"));
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("publication.db");
    c.execute("VACUUM INTO ?1", [path.to_str().unwrap()])
        .unwrap();
    let mut first = Connection::open(&path).unwrap();
    let second = Connection::open(&path).unwrap();
    first
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;")
        .unwrap();
    second
        .execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=0;",
        )
        .unwrap();
    let tx = first
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    prepare(&tx, "af-1", 1).unwrap();
    assert!(prepare(&second, "af-1", 1).is_err());
    tx.commit().unwrap();
    drop(first);
    assert_eq!(
        second
            .query_row(
                "SELECT publication_state FROM afternic_connection_publications",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "prepared"
    );
    assert_eq!(second.query_row("SELECT credential_use_state FROM local_provider_connections WHERE connection_id='af-1'",[],|r|r.get::<_,String>(0)).unwrap(),"inactive");
    assert!(prepare(&second, "af-1", 1).is_err());
    second.execute_batch("BEGIN IMMEDIATE; UPDATE afternic_connection_publications SET publication_state='active'; UPDATE local_provider_connections SET credential_use_state='active' WHERE connection_id='af-1'; ROLLBACK;").unwrap();
    assert_eq!(
        second
            .query_row(
                "SELECT publication_state FROM afternic_connection_publications",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "prepared"
    );
}

#[test]
fn settings_reports_broken_binding_without_serving_a_cached_sales_desk() {
    let c = database();
    add_connection(&c, "af-1", "afternic", Some("af-1"));
    activate(&c, "af-1");
    bind(&c, "af-1", 'b');
    observe(&c, "run", "af-1", 'b', "active");
    let cache = SalesCache::default();
    assert_eq!(
        ActiveSalesReader::new(&c, &cache)
            .read("ws", 0, 20)
            .unwrap()
            .active_listing_count,
        1
    );
    // Simulate a damaged historical row; reads diagnose it even when the normal write guard is gone.
    c.execute_batch("DROP TRIGGER marketplace_listing_binding_immutable; UPDATE marketplace_listing_observations SET binding_connection_id='missing';").unwrap();
    assert!(
        ActiveSalesReader::new(&c, &cache)
            .read("ws", 0, 20)
            .is_err()
    );
    assert_eq!(
        ActiveSettingsReader::new(&c, &cache)
            .read("ws")
            .unwrap()
            .storage_integrity
            .rejected_listings,
        1
    );
}

#[test]
fn stale_absence_is_unknown_after_disconnect_or_binding_generation_change() {
    let c = database();
    add_connection(&c, "af-1", "afternic", Some("af-1"));
    activate(&c, "af-1");
    bind(&c, "af-1", 'b');
    observe(&c, "run", "af-1", 'b', "unlisted");
    let cache = SalesCache::default();
    let read = || {
        ActiveSalesReader::new(&c, &cache)
            .read("ws", 0, 20)
            .unwrap()
    };
    assert_eq!(read().total_rows, 0);
    c.execute("UPDATE local_provider_connections SET validation_status='unreachable' WHERE connection_id='af-1'", []).unwrap();
    assert_eq!(read().window.rows[0].listing_status, "unknown");
    c.execute("UPDATE local_provider_connections SET validation_status='valid' WHERE connection_id='af-1'", []).unwrap();
    assert_eq!(read().total_rows, 0);
    c.execute(
        "UPDATE domain_asset_provider_bindings SET binding_generation=2 WHERE connection_id='af-1'",
        [],
    )
    .unwrap();
    assert_eq!(read().window.rows[0].listing_status, "unknown");
    assert_eq!(read().active_listing_count, 0);
    assert_eq!(
        ActiveSettingsReader::new(&c, &cache)
            .read("ws")
            .unwrap()
            .storage_integrity
            .rejected_listings,
        0
    );
}
