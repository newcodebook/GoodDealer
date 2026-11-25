//! Forward migration and identity invariants for multi-market, multi-account Listing bindings.
use super::*;

const TIME: &str = "2026-11-18T00:00:00Z";

fn before_listing_migration() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
        .pragma_update(None, "foreign_keys", true)
        .unwrap();
    connection.execute_batch("CREATE TABLE gooddealer_active_migrations (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;").unwrap();
    for migration in ACTIVE_MIGRATIONS
        .iter()
        .take_while(|migration| migration.id != LISTING_PROVIDER_BINDING_MIGRATION_ID)
    {
        apply_migration(&mut connection, migration).unwrap();
    }
    connection.execute("INSERT INTO active_workspace_metadata (singleton,storage_domain,workspace_id,workspace_schema_version,applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence,created_at,updated_at) VALUES (1,'active_workspace','ws',1,0,1,2,?1,?1)", [TIME]).unwrap();
    for domain in ["example.com", "other.com"] {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('ws',?1,'active',?2,?2,1)",params![domain,TIME]).unwrap();
    }
    for (id, platform) in [
        ("cf-1", "cloudflare"),
        ("cf-2", "cloudflare"),
        ("af-1", "afternic"),
        ("af-2", "afternic"),
        ("sedo-1", "sedo"),
    ] {
        connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at) VALUES ('ws',?1,?2,?1,?3)",params![id,platform,TIME]).unwrap();
    }
    bind(
        &connection,
        "ws",
        "example.com",
        "cf-1",
        "cloudflare",
        "zone",
        'a',
    )
    .unwrap();
    connection
}

fn bind(
    c: &Connection,
    workspace: &str,
    domain: &str,
    account: &str,
    platform: &str,
    kind: &str,
    digest: char,
) -> rusqlite::Result<usize> {
    c.execute("INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6,?2,1,1,'unverified',?7,?7)",params![workspace,domain,account,platform,kind,digest.to_string().repeat(64),TIME])
}

fn bindings(c: &Connection) -> Vec<Vec<rusqlite::types::Value>> {
    let mut query = c.prepare("SELECT * FROM domain_asset_provider_bindings ORDER BY workspace_id,entity_id,resource_kind,connection_id,resource_binding_digest").unwrap();
    let columns = query.column_count();
    query
        .query_map([], |row| {
            (0..columns)
                .map(|i| row.get(i))
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

#[test]
fn forward_migration_preserves_bindings_checksums_and_singleton_constraints() {
    let mut c = before_listing_migration();
    let original = bindings(&c);
    let ledger = read_applied(&c).unwrap();
    run_active_migrations(&mut c).unwrap();
    assert_eq!(bindings(&c), original);
    assert_eq!(&read_applied(&c).unwrap()[..ledger.len()], &ledger);
    assert!(bind(&c, "ws", "example.com", "cf-2", "cloudflare", "zone", 'b').is_err());
    bind(
        &c,
        "ws",
        "example.com",
        "cf-1",
        "cloudflare",
        "registration",
        'b',
    )
    .unwrap();
    assert!(
        bind(
            &c,
            "ws",
            "example.com",
            "cf-2",
            "cloudflare",
            "registration",
            'c'
        )
        .is_err()
    );
    let migrated = bindings(&c);
    run_active_migrations(&mut c).unwrap();
    assert_eq!(bindings(&c), migrated);
    crate::active_workspace::portfolio::verify_active_manifest(&c).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
}

#[test]
fn listing_identity_is_scoped_to_market_account_and_immutable_incarnation() {
    let mut c = before_listing_migration();
    run_active_migrations(&mut c).unwrap();
    for (account, platform) in [
        ("af-1", "afternic"),
        ("af-2", "afternic"),
        ("sedo-1", "sedo"),
    ] {
        bind(&c, "ws", "example.com", account, platform, "listing", 'c').unwrap();
    }
    let before = bindings(&c);
    for (ws, domain, account, platform, digest) in [
        ("ws", "example.com", "af-1", "afternic", 'c'), // exact duplicate
        ("ws", "example.com", "af-1", "afternic", 'd'), // second live incarnation
        ("ws", "other.com", "af-1", "afternic", 'c'),   // remote identity belongs to one domain
        ("ws", "example.com", "missing", "afternic", 'd'),
        ("other-ws", "example.com", "af-1", "afternic", 'd'),
        ("ws", "example.com", "af-1", "sedo", 'd'),
    ] {
        assert!(bind(&c, ws, domain, account, platform, "listing", digest).is_err());
    }
    assert!(c.execute("UPDATE domain_asset_provider_bindings SET resource_binding_digest=?1 WHERE resource_kind='listing'",["d".repeat(64)]).is_err());
    assert!(
        c.execute(
            "UPDATE local_provider_connections SET provider_kind='sedo' WHERE connection_id='af-1'",
            []
        )
        .is_err()
    );
    assert!(
        c.execute(
            "DELETE FROM domain_asset_provider_bindings WHERE resource_kind='listing'",
            []
        )
        .is_err()
    );
    assert_eq!(bindings(&c), before);
    c.execute("UPDATE domain_asset_provider_bindings SET validation_status='detached' WHERE connection_id='af-1'",[]).unwrap();
    bind(&c, "ws", "example.com", "af-1", "afternic", "listing", 'd').unwrap();
    // Detached evidence survives replacement, and cannot revive alongside the new live binding.
    assert!(c.execute("UPDATE domain_asset_provider_bindings SET validation_status='unverified' WHERE connection_id='af-1' AND resource_binding_digest=?1",["c".repeat(64)]).is_err());
}

#[test]
fn failed_binding_rebuild_rolls_back_rows_schema_and_migration_receipt() {
    let mut c = before_listing_migration();
    // Force failure after copying and replacing the table, when the new unique index is installed.
    c.execute_batch(
        "CREATE INDEX domain_asset_provider_bindings_live_listing ON domain_assets(entity_id)",
    )
    .unwrap();
    let original = bindings(&c);
    let ledger = read_applied(&c).unwrap();
    let schema = |c: &Connection| {
        c.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name")
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let original_schema = schema(&c);
    assert_eq!(run_active_migrations(&mut c), Err(MigrationError::Rejected));
    assert_eq!(bindings(&c), original);
    assert_eq!(read_applied(&c).unwrap(), ledger);
    assert_eq!(schema(&c), original_schema);
    c.execute_batch("DROP INDEX domain_asset_provider_bindings_live_listing")
        .unwrap();
    run_active_migrations(&mut c).unwrap();
    assert_eq!(bindings(&c), original);
}
