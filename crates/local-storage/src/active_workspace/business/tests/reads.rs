use super::*;

#[test]
fn database_enforces_workspace_and_append_only_history_invariants() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    assert!(
        connection
            .execute(
                "INSERT INTO local_backup_catalog
             (workspace_id, backup_id, backup_class, workspace_schema_version,
              through_local_commit_sequence, through_server_revision, manifest_digest,
              crypto_profile, storage_locator_digest, status, created_at)
             VALUES ('rogue-workspace', 'backup-1', 'local_full', 1, 0, 0,
                     ?1, 'sqlcipher-v1', ?2, 'creating', ?3)",
                params!["A".repeat(43), "1".repeat(64), TIMESTAMP],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE active_workspace_metadata SET workspace_id = 'rebound-workspace'
             WHERE singleton = 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "DELETE FROM active_workspace_metadata WHERE singleton = 1",
                []
            )
            .is_err()
    );

    connection
        .execute(
            "INSERT INTO business_history_events
             (workspace_id, event_sequence, event_id, aggregate_kind, aggregate_id,
              event_kind, actor_kind, event_payload_json, event_payload_sha256, occurred_at,
              local_commit_sequence)
             VALUES ('workspace-local', 1, 'event-1', 'domain_asset', 'history.test',
                     'created', 'system', '{}', ?1, ?2, 1)",
            params!["0".repeat(64), TIMESTAMP],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "UPDATE business_history_events SET event_kind = 'tampered'
             WHERE workspace_id = 'workspace-local' AND event_sequence = 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "DELETE FROM business_history_events
             WHERE workspace_id = 'workspace-local' AND event_sequence = 1",
                [],
            )
            .is_err()
    );
}

/// The `confirmed` flag the sales merge filters on follows its run and target, and no write can
/// set it to anything else, so dropping the per-row joins cannot change what the desk shows.
#[test]
fn listing_confirmation_follows_its_run_and_target_and_refuses_direct_writes() {
    let mut database = sales_database(&[]);
    let connection = database.store.fixture_connection();
    // Every row's flag equals the run-and-target predicate the sales merge used to join on.
    let drift = |connection: &rusqlite::Connection| -> i64 {
        connection
            .query_row(
                "SELECT count(*) FROM marketplace_listing_observations m
                 WHERE m.confirmed IS NOT (
                   EXISTS (SELECT 1 FROM provider_observation_targets t
                     WHERE t.workspace_id = m.workspace_id
                       AND t.observation_run_id = m.observation_run_id
                       AND t.entity_id = m.entity_id AND t.status = 'succeeded')
                   AND EXISTS (SELECT 1 FROM provider_observation_runs r
                     WHERE r.workspace_id = m.workspace_id
                       AND r.observation_run_id = m.observation_run_id
                       AND r.status IN ('succeeded', 'partial')))",
                [],
                |row| row.get(0),
            )
            .unwrap()
    };
    let generation = |connection: &rusqlite::Connection| -> i64 {
        connection
            .query_row(
                "SELECT generation FROM sales_listing_generation",
                [],
                |row| row.get(0),
            )
            .unwrap()
    };
    let confirmed = |connection: &rusqlite::Connection, run: &str| -> i64 {
        connection
            .query_row(
                "SELECT confirmed FROM marketplace_listing_observations
                 WHERE workspace_id = 'workspace-local' AND observation_run_id = ?1",
                [run],
                |row| row.get(0),
            )
            .unwrap()
    };
    for (run, outcome) in [("run-done", "succeeded"), ("run-partial", "partial")] {
        connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'market-1','marketplace',?2,'running')", rusqlite::params![run, TIMESTAMP]).unwrap();
        // A partial run also has a target that came back missing.
        let targets: &[(i64, &str)] = if outcome == "partial" {
            &[(0, "alpha.test"), (1, "bravo.test")]
        } else {
            &[(0, "alpha.test")]
        };
        for (ordinal, entity) in targets {
            connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,?2,?3,'requested',?4)", rusqlite::params![run, entity, ordinal, TIMESTAMP]).unwrap();
        }
        // A listing written inside a running run cannot claim confirmation.
        assert!(connection.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,evidence_status,confirmed) VALUES ('workspace-local',?1,?2,'alpha.test','atom','active',?3,'version','available','confirmed',1)", rusqlite::params![format!("forged-{run}"), run, TIMESTAMP]).is_err());
        connection.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local',?1,?2,'alpha.test','atom','active',?3,'version','available','confirmed')", rusqlite::params![format!("listing-{run}"), run, TIMESTAMP]).unwrap();
        assert_eq!(confirmed(connection, run), 0);
        connection.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2 AND entity_id='alpha.test'", rusqlite::params![TIMESTAMP, run]).unwrap();
        // The target succeeded but its run has not completed.
        assert_eq!(confirmed(connection, run), 0);
        assert!(connection.execute("UPDATE marketplace_listing_observations SET confirmed = 1 WHERE observation_run_id = ?1", [run]).is_err());
        if outcome == "partial" {
            connection.execute("UPDATE provider_observation_targets SET status='missing', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2 AND entity_id='bravo.test'", rusqlite::params![TIMESTAMP, run]).unwrap();
        }
        assert_eq!(drift(connection), 0);
        let before = generation(connection);
        connection.execute("UPDATE provider_observation_runs SET status=?1, completed_at=?2 WHERE workspace_id='workspace-local' AND observation_run_id=?3", rusqlite::params![outcome, TIMESTAMP, run]).unwrap();
        assert_eq!(confirmed(connection, run), 1, "{outcome}");
        assert_eq!(drift(connection), 0);
        // The completion advances the desk once, not once per recomputed listing.
        assert_eq!(generation(connection), before + 1);
        assert!(connection.execute("UPDATE marketplace_listing_observations SET confirmed = 0 WHERE observation_run_id = ?1", [run]).is_err());
        // The flag is the only column the triggers may rewrite; the evidence stays append-only.
        assert!(connection.execute("UPDATE marketplace_listing_observations SET listing_status = 'sold' WHERE observation_run_id = ?1", [run]).is_err());
    }
    let _ = connection;
    let rows = database.read_sales(0, 10).unwrap().window.rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].entity_id, "alpha.test");
}

#[test]
fn sales_never_lets_an_unfinished_run_hide_a_confirmed_listing() {
    let mut database = sales_database(&[(
        "alpha.test",
        "atom",
        "active",
        Some("USD"),
        Some("1000"),
        "2026-08-01T00:00:00Z",
    )]);
    // Newer observations of the same listing from runs that have not completed: one still
    // requesting its target, one whose target succeeded inside a run that is still running.
    // (A failed target cannot carry evidence; the schema rejects that outcome.)
    for (run, target_succeeded) in [("run-pending", false), ("run-open", true)] {
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'market-1','marketplace',?2,'running')", rusqlite::params![run, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,'alpha.test',0,'requested',?2)", rusqlite::params![run, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local',?1,?2,'alpha.test','atom','sold','2026-09-01T00:00:00Z','version','available','confirmed')", rusqlite::params![format!("listing-{run}"), run]).unwrap();
        if target_succeeded {
            connection.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2", rusqlite::params![TIMESTAMP, run]).unwrap();
        }
    }
    let rows = database.read_sales(0, 10).unwrap().window.rows;
    let [listing] = rows.as_slice() else {
        panic!("expected one listing");
    };
    assert_eq!(listing.listing_status, "active");
    assert_eq!(
        listing
            .asking_price
            .as_ref()
            .map(|price| price.amount.as_str()),
        Some("1000")
    );
    // The asset library's listing count follows the same rule: the unconfirmed sale does not
    // end the confirmed listing.
    assert_eq!(
        database.read_asset_library(0, 1, "").unwrap().listing_count,
        1
    );

    // Once a run completes with this asset's target succeeded, its newer observation wins.
    complete_observation_run(
        database.store.fixture_connection(),
        "run-pending",
        "alpha.test",
    );
    let rows = database.read_sales(0, 10).unwrap().window.rows;
    assert_eq!(rows[0].listing_status, "sold");
    assert_eq!(database.read_sales(0, 10).unwrap().total_rows, 1);
    assert_eq!(
        database.read_asset_library(0, 1, "").unwrap().listing_count,
        0
    );
}

#[test]
#[allow(clippy::too_many_lines)]
fn sales_reports_latest_listing_observations_without_identifiers() {
    let database = sales_database(&[
        (
            "alpha.test",
            "atom",
            "active",
            Some("USD"),
            Some("1000"),
            "2026-08-01T00:00:00Z",
        ),
        (
            "alpha.test",
            "atom",
            "sold",
            Some("USD"),
            Some("950.50"),
            "2026-08-02T00:00:00Z",
        ),
        (
            "alpha.test",
            "afternic",
            "draft",
            None,
            None,
            "2026-08-01T00:00:00Z",
        ),
        (
            "bravo.test",
            "atom",
            "unlisted",
            None,
            None,
            "2026-08-01T00:00:00Z",
        ),
    ]);
    let snapshot = database.read_sales(0, 10).unwrap();
    assert_eq!(snapshot.kind, "sales");
    // The newest observation per (asset, marketplace) wins, unlisted assets are omitted, and a
    // domain's markets merge into one row: a draft on one market and a sale on another are a
    // conflict, and a price only one market reports is not the domain's price.
    assert_eq!(snapshot.total_rows, 1);
    let [row] = snapshot.window.rows.as_slice() else {
        panic!("expected one domain");
    };
    assert_eq!(
        (
            row.entity_id.as_str(),
            row.marketplaces.as_slice(),
            row.listing_status.as_str(),
            row.asking_price.as_ref()
        ),
        (
            "alpha.test",
            ["afternic".to_owned(), "atom".to_owned()].as_slice(),
            "conflict",
            None
        )
    );
    assert_eq!(
        (
            snapshot.active_listing_count,
            snapshot.listed_value.as_ref()
        ),
        (0, None)
    );
    let wire = serde_json::to_string(&snapshot).unwrap();
    for secret in ["listing-secret", "run-secret", "version-secret", "market-1"] {
        assert!(!wire.contains(secret), "{secret} leaked into sales");
    }
    assert!(database.read_sales(1, 10).unwrap().window.rows.is_empty());
    for (start, size) in [(0, 0), (0, 201), (1_000_001, 1)] {
        assert!(matches!(
            database.read_sales(start, size),
            Err(BusinessDatabaseError::WindowRejected)
        ));
    }

    // Equal observation times fall back to the observation id, so the result is deterministic.
    let mut tied = sales_database(&[
        ("charlie.test", "atom", "draft", None, None, TIMESTAMP),
        ("charlie.test", "atom", "active", None, None, TIMESTAMP),
    ]);
    let rows = tied.read_sales(0, 10).unwrap().window.rows;
    assert_eq!(
        rows.iter()
            .map(|row| row.listing_status.as_str())
            .collect::<Vec<_>>(),
        ["active"]
    );
    // Listings of a deleted asset never reach the projection.
    tied.store
        .fixture_connection()
        .execute(
            "UPDATE domain_assets SET lifecycle_status = 'archived', deleted_at = ?1 WHERE entity_id = 'charlie.test'",
            [TIMESTAMP],
        )
        .unwrap();
    assert_eq!(tied.read_sales(0, 10).unwrap().total_rows, 0);

    // Marketplaces outside the launch registry and malformed prices fail the whole read.
    for listing in [
        (
            "charlie.test",
            "unsupported-platform",
            "active",
            Some("USD"),
            Some("10"),
            TIMESTAMP,
        ),
        (
            "charlie.test",
            "atom",
            "active",
            Some("USD"),
            Some("010"),
            TIMESTAMP,
        ),
        (
            "charlie.test",
            "atom",
            "active",
            Some("usd"),
            Some("10"),
            TIMESTAMP,
        ),
        (
            "charlie.test",
            "atom",
            "active",
            Some("USD"),
            Some("1e3"),
            TIMESTAMP,
        ),
    ] {
        assert!(
            matches!(
                sales_database(&[listing]).read_sales(0, 10),
                Err(BusinessDatabaseError::ProjectionRejected)
            ),
            "{listing:?} must fail closed"
        );
    }
}

#[test]
fn sales_rereads_after_a_listing_write_on_this_or_another_connection() {
    // Observations are append-only, so each change is a newer confirmed observation.
    fn observe(connection: &rusqlite::Connection, run: &str, status: &str, observed_at: &str) {
        connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'market-1','marketplace',?2,'running')", rusqlite::params![run, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,'alpha.test',0,'requested',?2)", rusqlite::params![run, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,asking_price_currency,asking_price_amount,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local',?1,?1,'alpha.test','atom',?2,'USD','10',?3,'v','available','confirmed')", rusqlite::params![run, status, observed_at]).unwrap();
        complete_observation_run(connection, run, "alpha.test");
    }
    let directory = tempdir().unwrap();
    let path = directory.path().join("workspace.db");
    let mut database = BusinessDatabase::open(
        &path,
        &LocalDatabaseKey::from_bytes([0x31; 32]),
        "workspace-local",
    )
    .unwrap();
    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','alpha.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','market-1','atom','Market',?1,'[\"marketplace\"]')", [TIMESTAMP]).unwrap();
    observe(connection, "run-1", "draft", "2026-01-01T00:00:00Z");
    let status = |database: &BusinessDatabase| {
        let snapshot = database.read_sales(0, 10).unwrap();
        (
            snapshot.window.rows[0].listing_status.clone(),
            snapshot.active_listing_count,
        )
    };
    // A repeated read of unchanged data is served from the merged desk and is identical.
    assert_eq!(
        database.read_sales(0, 10).unwrap(),
        database.read_sales(0, 10).unwrap()
    );
    assert_eq!(status(&database), ("draft".to_owned(), 0));

    // A write through the Host's own connection is read on the next read.
    observe(
        database.store.fixture_connection(),
        "run-2",
        "active",
        "2026-02-01T00:00:00Z",
    );
    assert_eq!(status(&database), ("active".to_owned(), 1));

    // So is a commit from another connection to the same database.
    let other = crate::active_workspace::open_keyed(&path, &[0x31; 32]).unwrap();
    observe(&other, "run-3", "reserved", "2026-03-01T00:00:00Z");
    drop(other);
    assert_eq!(status(&database), ("reserved".to_owned(), 0));
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one fixture walks paging, metrics and every no-total case"
)]
fn sales_pages_domains_and_reports_workspace_wide_metrics() {
    let database = sales_database(&[
        (
            "alpha.test",
            "atom",
            "active",
            Some("USD"),
            Some("1000"),
            TIMESTAMP,
        ),
        (
            "alpha.test",
            "afternic",
            "active",
            Some("USD"),
            Some("1000.00"),
            TIMESTAMP,
        ),
        (
            "bravo.test",
            "atom",
            "active",
            Some("USD"),
            Some("250.5"),
            TIMESTAMP,
        ),
        (
            "charlie.test",
            "atom",
            "draft",
            Some("USD"),
            Some("99"),
            TIMESTAMP,
        ),
    ]);
    // One page holds one domain; the totals still describe every listed domain, and prices
    // that differ only in trailing zeros agree.
    let snapshot = database.read_sales(1, 1).unwrap();
    assert_eq!(snapshot.total_rows, 3);
    assert_eq!(snapshot.active_listing_count, 2);
    assert_eq!(
        snapshot.listed_value,
        Some(crate::SalesMoney {
            currency: "USD".into(),
            amount: "1250.5".into()
        })
    );
    let [row] = snapshot.window.rows.as_slice() else {
        panic!("expected one domain on the page");
    };
    assert_eq!(row.entity_id, "bravo.test");
    // The agreed price is reported as the first market (in code-point order) wrote it.
    let first = database.read_sales(0, 1).unwrap().window.rows;
    assert_eq!(
        (
            first[0].marketplaces.as_slice(),
            first[0]
                .asking_price
                .as_ref()
                .map(|price| price.amount.as_str())
        ),
        (
            ["afternic".to_owned(), "atom".to_owned()].as_slice(),
            Some("1000.00")
        )
    );
    assert!(database.read_sales(3, 1).unwrap().window.rows.is_empty());

    // No total is reported rather than one that silently leaves a listing out: prices in two
    // currencies, an active domain whose markets disagree on price, or one without a price.
    for listings in [
        [
            (
                "alpha.test",
                "atom",
                "active",
                Some("USD"),
                Some("10"),
                TIMESTAMP,
            ),
            (
                "bravo.test",
                "atom",
                "active",
                Some("EUR"),
                Some("10"),
                TIMESTAMP,
            ),
        ],
        [
            (
                "alpha.test",
                "atom",
                "active",
                Some("USD"),
                Some("10"),
                TIMESTAMP,
            ),
            (
                "alpha.test",
                "afternic",
                "active",
                Some("USD"),
                Some("11"),
                TIMESTAMP,
            ),
        ],
        [
            (
                "alpha.test",
                "atom",
                "active",
                Some("USD"),
                Some("10"),
                TIMESTAMP,
            ),
            ("bravo.test", "atom", "active", None, None, TIMESTAMP),
        ],
    ] {
        let snapshot = sales_database(&listings).read_sales(0, 10).unwrap();
        assert!(snapshot.active_listing_count > 0);
        assert_eq!(snapshot.listed_value, None, "{listings:?}");
    }
}

/// The `DATABASE_SCHEMA.md` 100k-asset benchmark for every paged Host read. Ignored by default
/// because seeding takes a while; run with
/// `cargo test -p gooddealer-local-storage --lib -- --ignored scale_reads --nocapture`.
#[test]
#[ignore = "100k-asset benchmark; run alone on an idle machine with --test-threads=1"]
fn scale_reads_at_100k_assets() {
    // The `DATABASE_SCHEMA.md` per-read budget at 100k assets.
    let worst = slowest(&scale_reads(100_000, 2));
    assert!(worst <= std::time::Duration::from_secs(1), "{worst:?}");
}

#[test]
#[ignore = "10k-asset benchmark; run alone on an idle machine with --test-threads=1"]
fn scale_reads_at_10k_assets() {
    // The `DATABASE_SCHEMA.md` per-read budget at 10k assets.
    let worst = slowest(&scale_reads(10_000, 2));
    assert!(worst <= std::time::Duration::from_millis(150), "{worst:?}");
}

#[test]
#[ignore = "1M-asset benchmark; seeding takes minutes, run explicitly"]
/// Records timings only: whole-workspace counts grow linearly, so 1M assets is not yet budgeted.
fn scale_reads_at_1m_assets() {
    scale_reads(1_000_000, 2);
}

/// The sales worst case: every listed domain on all 8 launch platforms. The first sales read
/// after a write to the merge's inputs merges every confirmed listing and a settings read before
/// it scans the same listings; both are held to the budget like every other read.
#[test]
#[ignore = "100k-asset, 8-market benchmark; run explicitly"]
fn scale_reads_at_100k_assets_on_8_markets() {
    let worst = slowest(&scale_reads(100_000, 8));
    assert!(worst <= std::time::Duration::from_secs(1), "{worst:?}");
}

/// Pins the query plans of every paged Host read: no statement may scan a base table, with or
/// without an index. Whole-workspace counts still visit every workspace row, but through an index
/// seek on the workspace; this test catches a predicate or join that silently falls back to a
/// scan.
#[test]
#[ignore = "plans need a seeded workspace; run with the scale benchmarks"]
fn paged_reads_never_scan_a_base_table() {
    let database = scale_database(10_000, 8);
    let connection = database.store.raw_connection();
    connection.execute_batch("ANALYZE").unwrap();
    TRACED_STATEMENTS.lock().unwrap().clear();
    connection.trace_v2(
        rusqlite::trace::TraceEventCodes::SQLITE_TRACE_STMT,
        Some(trace_read_statements),
    );
    database.read_asset_library(5_000, 50, "").unwrap();
    database.read_asset_library(0, 50, "d00012").unwrap();
    database.read_domain_detail("d0005000.test").unwrap();
    database.read_renewals(2_000, 50).unwrap();
    database.read_dns_health(5_000, 50, "d0001").unwrap();
    database.read_sales(1_000, 50).unwrap();
    connection.trace_v2(rusqlite::trace::TraceEventCodes::empty(), None);
    let tables: std::collections::BTreeSet<String> = connection
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let statements: std::collections::BTreeSet<String> = TRACED_STATEMENTS
        .lock()
        .unwrap()
        .drain(..)
        .filter(|sql| {
            let head = sql.trim_start().to_ascii_uppercase();
            head.starts_with("SELECT") || head.starts_with("WITH")
        })
        .collect();
    assert!(statements.len() > 10, "{statements:?}");
    let mut scans = Vec::new();
    for sql in &statements {
        let mut plan = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap();
        let nulls = vec![rusqlite::types::Null; plan.parameter_count()];
        for detail in plan
            .query_map(rusqlite::params_from_iter(nulls), |row| {
                row.get::<_, String>(3)
            })
            .unwrap()
            .map(Result::unwrap)
        {
            let scanned = detail
                .strip_prefix("SCAN ")
                .map(|rest| rest.split_whitespace().next().unwrap_or(""));
            // A covering-index scan still visits every row, so any base-table scan counts.
            if scanned.is_some_and(|table| tables.contains(table)) {
                scans.push(format!("{detail}\n  in {sql}"));
            }
        }
    }
    assert!(scans.is_empty(), "{}", scans.join("\n"));
}

#[test]
fn manual_tasks_group_waiting_items_without_identifiers() {
    let empty = database();
    assert_eq!(empty.read_manual_tasks(0, 10).unwrap().total_rows, 0);
    let database = batch_database("Price change");
    let snapshot = database.read_manual_tasks(0, 10).unwrap();
    assert_eq!(snapshot.kind, "manual_tasks");
    assert_eq!(snapshot.total_rows, 1);
    // Only the item whose latest attempt waits on the person forms a task.
    assert_eq!(
        snapshot.window.rows,
        [crate::ManualTaskRow {
            title: "Nameserver change".to_owned(),
            operation_kind: "dns_change".to_owned(),
            capability: "dns_write".to_owned(),
            provider_kind: Some("cloudflare".to_owned()),
            connection_label: Some("DNS".to_owned()),
            high_risk: false,
            item_count: 1,
            waiting_since: TIMESTAMP.to_owned(),
            last_observed_at: None,
            domain_count: 1,
            domains: vec!["bravo.test".to_owned()],
        }]
    );
    let wire = serde_json::to_string(&snapshot).unwrap();
    for secret in [
        "plan-secret",
        "item-secret",
        "operation-secret",
        "connection-secret",
        "provider-request-secret",
        "key-secret",
    ] {
        assert!(!wire.contains(secret), "{secret} leaked into manual tasks");
    }
    assert!(
        database
            .read_manual_tasks(1, 10)
            .unwrap()
            .window
            .rows
            .is_empty()
    );
    for (start, size) in [(0, 0), (0, 201), (1_000_001, 10)] {
        assert!(matches!(
            database.read_manual_tasks(start, size),
            Err(BusinessDatabaseError::WindowRejected)
        ));
    }
    let mut grouped = batch_database("Price change");
    let connection = grouped.store.fixture_connection();
    connection.execute("INSERT INTO operation_attempts (workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest,started_at) VALUES ('workspace-local','operation-secret','plan-secret-a','item-secret-2',1,'manual_action_required',?1,'2026-08-28T01:00:00Z')", ["5".repeat(64)]).unwrap();
    connection.execute("INSERT INTO operation_results (workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,outcome,result_json,observed_at) VALUES ('workspace-local','operation-secret','plan-secret-a','item-secret-2',1,1,'manual_action_required','{}','2026-08-28T02:00:00Z')", []).unwrap();
    let rows = grouped.read_manual_tasks(0, 10).unwrap().window.rows;
    assert_eq!(rows.len(), 1, "one platform step stays one task");
    assert_eq!(
        (
            rows[0].item_count,
            rows[0].domain_count,
            rows[0].last_observed_at.as_deref()
        ),
        (2, 1, Some("2026-08-28T02:00:00Z"))
    );
    // Without a recorded result an item waits from its start; once observed, from that.
    assert_eq!(rows[0].waiting_since, TIMESTAMP);
    grouped.store.fixture_connection().execute("INSERT INTO operation_results (workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,outcome,result_json,observed_at) VALUES ('workspace-local','operation-secret','plan-secret-a','item-secret-1',1,1,'manual_action_required','{}','2026-08-28T03:00:00Z')", []).unwrap();
    let rows = grouped.read_manual_tasks(0, 10).unwrap().window.rows;
    // Both items are now observed: the task waits from the earlier observation (02:00), not
    // from either attempt's start (00:00 and 01:00).
    assert_eq!(rows[0].waiting_since, "2026-08-28T02:00:00Z");
    let mut foreign = batch_database("Price change");
    foreign
        .store
        .fixture_connection()
        .execute(
            "UPDATE local_provider_connections SET provider_kind = 'unsupported-platform'",
            [],
        )
        .unwrap();
    assert!(matches!(
        foreign.read_manual_tasks(0, 10),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    let mut control = batch_database("Price change");
    control
        .store
        .fixture_connection()
        .execute(
            "UPDATE local_provider_connections SET display_label = 'Bad\nlabel'",
            [],
        )
        .unwrap();
    assert!(matches!(
        control.read_manual_tasks(0, 10),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
}

#[test]
fn manual_tasks_carry_only_the_inbox_domain_sample_with_an_exact_count() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    let entities = ["e.test", "c.test", "a.test", "d.test", "b.test"];
    for entity in entities {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',?2,?2,1)", rusqlite::params![entity, TIMESTAMP]).unwrap();
    }
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at) VALUES ('workspace-local','connection-1','cloudflare','DNS',?1)", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO operation_plans (workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,created_at,local_commit_sequence) VALUES ('workspace-local','plan-1','dns_change',?1,'Nameserver change','planned','standard',5,?2,1)", rusqlite::params!["0".repeat(64), TIMESTAMP]).unwrap();
    for (ordinal, entity) in entities.into_iter().enumerate() {
        connection.execute("INSERT INTO operation_plan_items (workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,capability,precondition_json,risk_level,execution_mode,inclusion_status) VALUES ('workspace-local','plan-1',?1,?2,?3,'connection-1','dns_write','{}','standard','manual','included')", rusqlite::params![format!("item-{ordinal}"), i64::try_from(ordinal).unwrap(), entity]).unwrap();
    }
    connection.execute("UPDATE operation_plans SET phase = 'approved', approved_at = ?1 WHERE plan_id = 'plan-1'", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO operations (workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,started_at,local_commit_sequence) VALUES ('workspace-local','operation-1','plan-1','key-1','running',?1,?1,1)", [TIMESTAMP]).unwrap();
    for ordinal in 0..5 {
        connection.execute("INSERT INTO operation_attempts (workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest,started_at) VALUES ('workspace-local','operation-1','plan-1',?1,1,'manual_action_required',?2,?3)", rusqlite::params![format!("item-{ordinal}"), ordinal.to_string().repeat(64), TIMESTAMP]).unwrap();
    }
    // A platform clock behind the device's: the result predates its attempt's start.
    connection.execute("INSERT INTO operation_results (workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,outcome,result_json,observed_at) VALUES ('workspace-local','operation-1','plan-1','item-0',1,1,'manual_action_required','{}','2026-08-27T00:00:00Z')", []).unwrap();
    let rows = database.read_manual_tasks(0, 10).unwrap().window.rows;
    assert_eq!(rows.len(), 1);
    // The first three domains in byte order, with every affected domain still counted.
    assert_eq!(rows[0].domains, ["a.test", "b.test", "c.test"]);
    assert_eq!((rows[0].item_count, rows[0].domain_count), (5, 5));
    // No wait begins before its attempt started.
    assert_eq!(rows[0].waiting_since, TIMESTAMP);
}

#[test]
fn batch_operations_list_plans_newest_first_with_counts_and_no_identifiers() {
    let mut empty = database();
    assert_eq!(empty.read_batch_operations(0, 10).unwrap().total_rows, 0);
    let _ = empty.store.fixture_connection();

    let database = batch_database("Price change");
    let snapshot = database.read_batch_operations(0, 10).unwrap();
    assert_eq!(snapshot.kind, "batch_operations");
    assert_eq!(snapshot.total_rows, 2);
    let [newer, older] = snapshot.window.rows.as_slice() else {
        panic!("expected two plans");
    };
    assert_eq!(
        (
            newer.title.as_str(),
            newer.plan_phase.as_str(),
            newer.operation_phase.as_deref()
        ),
        ("Price change", "planned", None)
    );
    assert_eq!(newer.planned.conflict, 1);
    assert!(newer.results.is_none());
    assert_eq!(
        (
            older.operation_kind.as_str(),
            older.plan_phase.as_str(),
            older.operation_phase.as_deref()
        ),
        ("dns_change", "approved", Some("running"))
    );
    assert_eq!(older.provider_kinds, ["cloudflare"]);
    assert_eq!((older.item_count, older.target_count), (3, 2));
    assert_eq!(older.completed_at, None);
    assert_eq!(
        (
            older.planned.automatic,
            older.planned.manual,
            older.planned.excluded,
            older.planned.high_risk
        ),
        (1, 1, 1, 1)
    );
    let results = older.results.as_ref().unwrap();
    assert_eq!(
        (
            results.succeeded,
            results.failed_retryable,
            results.manual_action_required
        ),
        (1, 0, 1)
    );
    let wire = serde_json::to_string(&snapshot).unwrap();
    for secret in [
        "plan-secret",
        "item-secret",
        "operation-secret",
        "key-secret",
        "connection-secret",
        "provider-request-secret",
    ] {
        assert!(
            !wire.contains(secret),
            "{secret} leaked into batch operations"
        );
    }
    assert_eq!(
        database
            .read_batch_operations(1, 10)
            .unwrap()
            .window
            .rows
            .len(),
        1
    );
    for (start, size) in [(0, 0), (0, 201), (1_000_001, 10)] {
        assert!(matches!(
            database.read_batch_operations(start, size),
            Err(BusinessDatabaseError::WindowRejected)
        ));
    }
    assert!(matches!(
        batch_database("Bad\ntitle").read_batch_operations(0, 10),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    let mut doubled = batch_database("Price change");
    doubled.store.fixture_connection().execute("INSERT INTO operations (workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence) VALUES ('workspace-local','operation-second','plan-secret-a','key-second','queued',?1,1)", [TIMESTAMP]).unwrap();
    assert!(matches!(
        doubled.read_batch_operations(0, 10),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one fixture covers the window, the library count and the registrar name matrix"
)]
fn renewals_list_the_sixty_day_window_soonest_first_without_identifiers() {
    let database = renewals_database(
        &[
            ("soon.test", "active", Some(5), Some(1)),
            ("also-soon.test", "expired", Some(5), Some(0)),
            ("edge.test", "active", Some(60), None),
            ("beyond.test", "active", Some(61), Some(1)),
            ("lapsed.test", "active", Some(-1), Some(1)),
            ("today.test", "active", Some(0), None),
            ("sold.test", "sold", Some(0), Some(1)),
            ("dropped.test", "dropped", Some(2), Some(0)),
            ("archived.test", "archived", Some(3), Some(1)),
            ("undated.test", "active", None, Some(1)),
        ],
        &[
            (
                "soon.test",
                "Old Registrar",
                "available",
                "2026-01-01T00:00:00Z",
                "succeeded",
            ),
            (
                "soon.test",
                "Spaceship",
                "available",
                "2026-02-01T00:00:00Z",
                "partial",
            ),
            (
                "soon.test",
                "Hidden",
                "unavailable",
                "2026-03-01T00:00:00Z",
                "succeeded",
            ),
            // A newer observation from a run still in flight never hides the confirmed one.
            (
                "soon.test",
                "Unconfirmed",
                "available",
                "2026-04-01T00:00:00Z",
                "running",
            ),
            (
                "also-soon.test",
                "Unconfirmed",
                "available",
                "2026-04-01T00:00:00Z",
                "running",
            ),
        ],
    );
    let snapshot = database.read_renewals(0, 10).unwrap();
    assert_eq!(snapshot.kind, "renewals");
    let today: String = database
        .store
        .raw_connection()
        .query_row("SELECT date('now')", [], |row| row.get(0))
        .unwrap();
    assert_eq!(snapshot.as_of_date, today);
    assert_eq!(snapshot.total_rows, 4);
    assert_eq!(
        (
            snapshot.auto_renew_enabled_count,
            snapshot.auto_renew_disabled_count
        ),
        (1, 1)
    );
    // The counts cover every expiring asset, not just the requested page.
    let page = database.read_renewals(3, 1).unwrap();
    assert_eq!(page.window.rows.len(), 1);
    assert_eq!(
        (
            page.total_rows,
            page.auto_renew_enabled_count,
            page.auto_renew_disabled_count
        ),
        (4, 1, 1)
    );
    // The asset library promises exactly the assets the renewals desk lists: sold, dropped and
    // archived assets are no longer the workspace's to renew, and a search that matches only
    // some of them does not change the count the desk will list.
    for query in ["", "soon", "nothing-matches"] {
        assert_eq!(
            database
                .read_asset_library(0, 1, query)
                .unwrap()
                .expiring_within60_days,
            snapshot.total_rows,
            "{query:?}"
        );
    }
    assert_eq!(
        database
            .read_asset_library(0, 1, "soon")
            .unwrap()
            .total_rows,
        1
    );
    let rows: Vec<_> = snapshot
        .window
        .rows
        .iter()
        .map(|row| {
            (
                row.entity_id.as_str(),
                row.auto_renew,
                row.registrar_name.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("today.test", None, None),
            ("also-soon.test", Some(false), None),
            ("soon.test", Some(true), Some("Spaceship")),
            ("edge.test", None, None),
        ]
    );
    // Each library row and its detail flag exactly the assets the desk lists, by the same
    // predicate: sold, dropped, archived, lapsed, undated and too-distant assets stay unflagged.
    let library = database.read_asset_library(0, 20, "").unwrap();
    let mut flagged: Vec<_> = library
        .window
        .rows
        .iter()
        .filter(|row| row.expiring)
        .map(|row| row.domain.as_str())
        .collect();
    flagged.sort_unstable();
    let mut listed: Vec<_> = rows.iter().map(|row| row.0).collect();
    listed.sort_unstable();
    assert_eq!(flagged, listed);
    // The count and the flags come from the same read and the same day.
    assert_eq!(
        usize::try_from(library.expiring_within60_days).unwrap(),
        flagged.len()
    );
    for row in &library.window.rows {
        assert_eq!(
            database
                .read_domain_detail(&row.domain)
                .unwrap()
                .asset
                .expiring,
            row.expiring,
            "{}",
            row.domain
        );
    }
    // The asset library and domain detail report the same confirmed registrar.
    let registrar = |entity: &str| {
        library
            .window
            .rows
            .iter()
            .find(|row| row.domain == entity)
            .and_then(|row| row.registrar.clone())
    };
    assert_eq!(registrar("soon.test").as_deref(), Some("Spaceship"));
    assert_eq!(registrar("also-soon.test"), None);
    assert_eq!(
        database
            .read_domain_detail("soon.test")
            .unwrap()
            .asset
            .registrar
            .as_deref(),
        Some("Spaceship")
    );
    let wire = serde_json::to_string(&snapshot).unwrap();
    for secret in [
        "run-secret",
        "registrar-secret",
        "version-secret",
        "registrar-1",
    ] {
        assert!(!wire.contains(secret), "{secret} leaked into renewals");
    }
    assert_eq!(database.read_renewals(3, 10).unwrap().window.rows.len(), 1);
    for (start, size) in [(0, 0), (0, 201), (1_000_001, 10)] {
        assert!(matches!(
            database.read_renewals(start, size),
            Err(BusinessDatabaseError::WindowRejected)
        ));
    }
    // The same matrix as the Renderer's `registrarNameSchema` test: 128 characters, counted as
    // code points, fit; control, bidirectional and invisible formatting characters do not.
    let longest = "\u{1d538}".repeat(128);
    let accepted = renewals_database(
        &[("soon.test", "active", Some(5), None)],
        &[("soon.test", &longest, "available", TIMESTAMP, "succeeded")],
    )
    .read_renewals(0, 10)
    .unwrap();
    assert_eq!(
        accepted.window.rows[0].registrar_name.as_deref(),
        Some(longest.as_str())
    );
    // A format character outside the safe-text set is accepted here, unlike in connection
    // labels, as in the Renderer's matrix.
    let arabic_sign = renewals_database(
        &[("soon.test", "active", Some(5), None)],
        &[(
            "soon.test",
            "Arabic\u{600}Sign",
            "available",
            TIMESTAMP,
            "succeeded",
        )],
    )
    .read_renewals(0, 10)
    .unwrap();
    assert_eq!(
        arabic_sign.window.rows[0].registrar_name.as_deref(),
        Some("Arabic\u{600}Sign")
    );
    for name in [
        "Bad\nRegistrar",
        &"x".repeat(129),
        "",
        "Zero\u{200b}Width",
        "Bidi\u{202e}Name",
        "Soft\u{ad}Hyphen",
        "\u{feff}Bom",
    ] {
        assert!(
            matches!(
                renewals_database(
                    &[("soon.test", "active", Some(5), None)],
                    &[("soon.test", name, "available", TIMESTAMP, "succeeded")],
                )
                .read_renewals(0, 10),
                Err(BusinessDatabaseError::ProjectionRejected)
            ),
            "{name:?} must fail closed"
        );
    }
    // A bad name on a page the desk does not read still fails the read: the desk's counts
    // include that asset.
    let off_page = renewals_database(
        &[
            ("soon.test", "active", Some(5), None),
            ("later.test", "active", Some(10), None),
        ],
        &[
            (
                "soon.test",
                "Registrar",
                "available",
                TIMESTAMP,
                "succeeded",
            ),
            (
                "later.test",
                "Bad\nRegistrar",
                "available",
                TIMESTAMP,
                "succeeded",
            ),
        ],
    );
    assert!(matches!(
        off_page.read_renewals(0, 1),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    // A bad name the desk never shows, on an asset outside the window or behind a newer
    // confirmed name, does not fail it.
    let unseen = renewals_database(
        &[
            ("soon.test", "active", Some(5), None),
            ("beyond.test", "active", Some(61), None),
        ],
        &[
            (
                "soon.test",
                "Bad\nOld",
                "available",
                "2026-01-01T00:00:00Z",
                "succeeded",
            ),
            (
                "soon.test",
                "Registrar",
                "available",
                "2026-02-01T00:00:00Z",
                "succeeded",
            ),
            (
                "beyond.test",
                "Bad\nRegistrar",
                "available",
                TIMESTAMP,
                "succeeded",
            ),
        ],
    )
    .read_renewals(0, 10)
    .unwrap();
    assert_eq!(
        unseen.window.rows[0].registrar_name.as_deref(),
        Some("Registrar")
    );
    // A malformed expiry that sorts into the window as text fails every page, not only its own.
    for suffix in ["x", "T00:00:00Z"] {
        let mut malformed = renewals_database(
            &[
                ("soon.test", "active", Some(5), None),
                ("later.test", "active", Some(10), None),
            ],
            &[],
        );
        let connection = malformed.store.fixture_connection();
        allow_legacy_rows(connection);
        connection
            .execute(
                "UPDATE domain_assets SET expires_on = expires_on || ?1 WHERE entity_id = 'later.test'",
                [suffix],
            )
            .unwrap();
        assert!(
            matches!(
                malformed.read_renewals(0, 1),
                Err(BusinessDatabaseError::ProjectionRejected)
            ),
            "{suffix:?}"
        );
    }
}

#[test]
fn history_fails_closed_on_a_legacy_outbox_time_anywhere_in_the_ledger() {
    let database = database();
    let connection = database.store.raw_connection();
    let insert = |mutation_id: &str, created_at: &str| {
        connection.execute(
            "INSERT INTO sync_outbox
             (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at)
             VALUES ('workspace-local',?1,'domain_asset','ledger.test','{}',?2)",
            [mutation_id, created_at],
        )
    };
    // New writes cannot store a non-canonical time at all.
    assert!(insert("new-offset", "2026-08-28T08:00:00+08:00").is_err());
    insert("canonical", "2026-08-28T12:00:00Z").unwrap();
    assert_eq!(
        database
            .read_history(0, 1, HISTORY_DAY)
            .unwrap()
            .changes_today,
        1
    );
    // A row written before the trigger existed is still refused by the read, even when it is
    // not on the requested page, rather than being counted against the wrong day.
    connection
        .execute_batch("DROP TRIGGER sync_outbox_created_at_insert_is_canonical;")
        .unwrap();
    for legacy in ["2026-08-28 12:00:00", "2026-08-28T24:00:00Z"] {
        insert("legacy", legacy).unwrap();
        assert!(
            matches!(
                database.read_history(0, 1, HISTORY_DAY),
                Err(BusinessDatabaseError::ProjectionRejected)
            ),
            "{legacy:?}"
        );
        connection
            .execute("DELETE FROM sync_outbox WHERE mutation_id = 'legacy'", [])
            .unwrap();
    }
    assert!(database.read_history(0, 1, HISTORY_DAY).is_ok());
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the ledger's ordering, diff and window assertions stay together"
)]
fn history_lists_local_revisions_newest_first_with_diffs_and_no_identifiers() {
    let mut database = database();
    assert_eq!(
        database
            .read_history(0, 10, HISTORY_DAY)
            .unwrap()
            .total_rows,
        0
    );
    database
        .upsert_domain_asset("seed", TIMESTAMP, &history_write("seed", &[]))
        .unwrap();
    let version = |database: &BusinessDatabase| -> u64 {
        database
            .store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM domain_assets WHERE entity_id = 'ledger.test'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
            .try_into()
            .unwrap()
    };
    let committed = [
        ("mutation-secret-1", history_write("first", &[])),
        ("mutation-secret-2", history_write("second", &["sale"])),
    ];
    for (mutation_id, write) in &committed {
        let expected = version(&database);
        database
            .edit_domain_asset(
                mutation_id,
                expected,
                "device-secret",
                7,
                TIMESTAMP,
                write,
                true,
            )
            .unwrap();
    }
    let expected = version(&database);
    database
        .delete_domain_asset(
            "mutation-secret-3",
            expected,
            "device-secret",
            7,
            TIMESTAMP,
            "ledger.test",
            true,
        )
        .unwrap();
    let snapshot = database.read_history(0, 10, HISTORY_DAY).unwrap();
    assert_eq!(snapshot.kind, "history");
    assert_eq!((snapshot.total_rows, snapshot.pending_rows), (4, 4));
    let rows = &snapshot.window.rows;
    assert_eq!(
        rows.iter()
            .map(|row| (row.operation.as_str(), row.state.as_str()))
            .collect::<Vec<_>>(),
        [
            ("delete", "pending"),
            ("edit", "pending"),
            ("edit", "pending"),
            ("edit", "pending")
        ]
    );
    assert!(rows[0].local_revision > rows[1].local_revision);
    assert!(rows[0].changes.is_empty());
    // The second edit reports only what moved since the first, with both sides.
    assert_eq!(
        rows[1].changes,
        [
            crate::HistoryFieldChange {
                field_path: "note".to_owned(),
                value: serde_json::json!("second"),
                previous_value: Some(serde_json::json!("first")),
            },
            crate::HistoryFieldChange {
                field_path: "tags".to_owned(),
                value: serde_json::json!(["sale"]),
                previous_value: Some(serde_json::json!([])),
            },
        ]
    );
    assert_eq!(
        rows[2].changes,
        [crate::HistoryFieldChange {
            field_path: "note".to_owned(),
            value: serde_json::json!("first"),
            previous_value: Some(serde_json::json!("seed")),
        }]
    );
    // The first local revision has no recorded predecessor, so nothing claims an old value.
    assert_eq!(rows[3].changes.len(), 4);
    assert!(
        rows[3]
            .changes
            .iter()
            .all(|change| change.previous_value.is_none())
    );
    let wire = serde_json::to_string(&snapshot).unwrap();
    assert_eq!(wire.matches("previousValue").count(), 3);
    for secret in ["mutation-secret", "device-secret", "mutationId", "deviceId"] {
        assert!(!wire.contains(secret), "{secret} leaked into history");
    }
    assert_eq!(
        database
            .read_history(3, 10, HISTORY_DAY)
            .unwrap()
            .window
            .rows
            .len(),
        1
    );
    for (start, size) in [(0, 0), (0, 201), (1_000_001, 10)] {
        assert!(matches!(
            database.read_history(start, size, HISTORY_DAY),
            Err(BusinessDatabaseError::WindowRejected)
        ));
    }
    // Today's changes count the whole ledger, not the window: one row read, four counted.
    let today = |day| database.read_history(0, 1, day).unwrap().changes_today;
    assert_eq!(today(HISTORY_DAY), 4);
    // The day ends before its end instant, so a day ending at the commits counts none.
    assert_eq!(today(("2026-08-27T00:00:00Z", "2026-08-28T00:00:00Z")), 0);
    // A daylight saving day is 23 or 25 hours.
    assert_eq!(today(("2026-08-27T23:00:00Z", "2026-08-29T00:00:00Z")), 4);
    // Day lengths hold across month, year and leap-day boundaries.
    for day in [
        ("2026-02-28T00:00:00Z", "2026-03-01T00:00:00Z"),
        ("2026-12-31T00:00:00Z", "2027-01-01T00:00:00Z"),
        ("2028-02-29T00:00:00Z", "2028-03-01T00:00:00Z"),
    ] {
        assert_eq!(today(day), 0, "{day:?} is one day");
    }
    for day in [
        ("2026-08-28T00:00:00Z", "2026-08-28T00:00:00Z"),
        ("2026-08-29T00:00:00Z", "2026-08-28T00:00:00Z"),
        ("2026-08-27T22:59:59Z", "2026-08-29T00:00:00Z"),
        ("2028-02-28T00:00:00Z", "2028-03-01T00:00:00Z"),
        ("2026-12-31T00:00:00Z", "2027-01-02T00:00:00Z"),
        ("2026-08-28T00:00:00.000Z", "2026-08-29T00:00:00Z"),
        ("2026-08-28T00:00:00+08:00", "2026-08-29T00:00:00Z"),
        ("2026-08-28", "2026-08-29T00:00:00Z"),
    ] {
        assert!(
            matches!(
                database.read_history(0, 10, day),
                Err(BusinessDatabaseError::WindowRejected)
            ),
            "{day:?} should be rejected"
        );
    }
}

#[test]
fn history_names_a_creation_only_when_the_create_path_marked_it() {
    let mut database = database();
    // An asset written without the create path (as a pull or the legacy seed writes it) has
    // a first local upsert too; that one must stay an edit.
    database
        .upsert_domain_asset("seed", TIMESTAMP, &history_write("seed", &[]))
        .unwrap();
    let created = DomainAssetWrite {
        entity_id: "added.test".to_owned(),
        ..history_write("added", &["new"])
    };
    database
        .create_domain_asset_guarded(
            "create-1",
            "device-1",
            7,
            TIMESTAMP,
            &created,
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
    let version: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT local_commit_sequence FROM domain_assets WHERE entity_id = 'added.test'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    database
        .edit_domain_asset(
            "edit-1",
            u64::try_from(version).unwrap(),
            "device-1",
            7,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "added.test".to_owned(),
                ..history_write("edited", &["new"])
            },
            true,
        )
        .unwrap();
    let snapshot = database.read_history(0, 10, HISTORY_DAY).unwrap();
    let rows = snapshot
        .window
        .rows
        .iter()
        .map(|row| (row.entity_id.as_str(), row.operation.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(
        rows,
        [
            ("added.test", "edit"),
            ("added.test", "create"),
            ("ledger.test", "edit")
        ]
    );
    // A creation has nothing before it, so none of its fields claims a previous value.
    let creation = &snapshot.window.rows[1];
    assert!(!creation.changes.is_empty());
    assert!(
        creation
            .changes
            .iter()
            .all(|change| change.previous_value.is_none())
    );

    // The marker can name only an asset's first upsert and never changes.
    let connection = database.store.raw_connection();
    for refused in ["edit-1", "seed-missing"] {
        assert!(
            connection
                .execute(
                    "INSERT INTO sync_outbox_local_creations (workspace_id, mutation_id) VALUES ('workspace-local', ?1)",
                    [refused],
                )
                .is_err(),
            "{refused}"
        );
    }
    assert!(
        connection
            .execute(
                "UPDATE sync_outbox_local_creations SET mutation_id = 'edit-1'",
                [],
            )
            .is_err()
    );
    let markers: i64 = connection
        .query_row(
            "SELECT count(*) FROM sync_outbox_local_creations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(markers, 1);
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "each count is seeded, read, repaired and read again as one ADR-0019 scenario"
)]
fn settings_counts_stored_rows_the_other_reads_reject_without_failing() {
    let mut database = sales_database(&[
        (
            "alpha.test",
            "atom",
            "active",
            Some("USD"),
            Some("10"),
            TIMESTAMP,
        ),
        (
            "bravo.test",
            "atom",
            "active",
            Some("usd"),
            Some("10"),
            TIMESTAMP,
        ),
    ]);
    let integrity = |database: &BusinessDatabase| {
        let integrity = database.read_settings().unwrap().storage_integrity;
        [
            integrity.malformed_expiries,
            integrity.invalid_registrar_observations,
            integrity.rejected_dns_rows,
            integrity.rejected_listings,
            integrity.malformed_outbox_rows,
        ]
    };
    // The one listing sales rejects is counted, and the settings read itself still succeeds.
    assert_eq!(integrity(&database), [0, 0, 0, 1, 0]);
    assert!(matches!(
        database.read_sales(0, 10),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));

    let connection = database.store.fixture_connection();
    allow_legacy_rows(connection);
    connection
        .execute_batch("DROP TRIGGER sync_outbox_created_at_insert_is_canonical;")
        .unwrap();
    // An impossible calendar date, and a deleted asset's, which no read shows.
    connection
        .execute(
            "UPDATE domain_assets SET expires_on = '2026-02-30' WHERE entity_id = 'charlie.test'",
            [],
        )
        .unwrap();
    connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,expires_on,created_at,updated_at,deleted_at,local_commit_sequence) VALUES ('workspace-local','gone.test','archived','soon',?1,?1,?1,1)", [TIMESTAMP]).unwrap();
    // Two available observations share an invalid name; an unavailable one is never shown.
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','registrar-1','porkbun','Registrar',?1,'[\"registrar\"]')", [TIMESTAMP]).unwrap();
    for (index, (entity, name, availability)) in [
        ("alpha.test", "Bad\u{7}Name", "available"),
        ("bravo.test", "Bad\u{7}Name", "available"),
        ("charlie.test", "Bad\u{7}Name", "unavailable"),
        ("charlie.test", "Porkbun", "available"),
    ]
    .into_iter()
    .enumerate()
    {
        let run = format!("registrar-run-{index}");
        connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'registrar-1','registrar',?2,'running')", rusqlite::params![run, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,?2,0,'requested',?3)", rusqlite::params![run, entity, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO registrar_observations (workspace_id,observation_id,observation_run_id,entity_id,registrar_name,observation_availability,evidence_status,observed_at,provider_version_token) VALUES ('workspace-local',?1,?2,?3,?4,?5,'confirmed',?6,'version')", rusqlite::params![format!("registrar-{index}"), run, entity, name, availability, TIMESTAMP]).unwrap();
    }
    // A Zone binding naming a platform other than its connection's.
    connection.execute("INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,created_at,updated_at) VALUES ('workspace-local','alpha.test','registrar-1','spaceship','zone',?1,?2,'alpha.test',1,2,'unverified',?3,?3)", rusqlite::params!["d".repeat(64), "e".repeat(64), TIMESTAMP]).unwrap();
    for (mutation, created_at) in [
        ("legacy-1", "2026-08-28 12:00:00"),
        ("legacy-2", "2026-08-28T24:00:00Z"),
        ("canonical", "2026-08-28T12:00:00Z"),
    ] {
        connection.execute("INSERT INTO sync_outbox (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at) VALUES ('workspace-local',?1,'domain_asset','alpha.test','{}',?2)", [mutation, created_at]).unwrap();
    }
    // The two invalid names come from completed runs, so the library and detail show them.
    connection
        .execute_batch(
            "UPDATE provider_observation_targets SET status = 'succeeded',
               completed_at = requested_at
             WHERE observation_run_id IN ('registrar-run-0', 'registrar-run-1');
             UPDATE provider_observation_runs SET status = 'succeeded',
               completed_at = started_at
             WHERE observation_run_id IN ('registrar-run-0', 'registrar-run-1');",
        )
        .unwrap();
    let _ = connection;

    assert_eq!(integrity(&database), [1, 2, 1, 1, 2]);
    assert!(matches!(
        database.read_domain_detail("alpha.test"),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    // Each count names a read that fails closed on those rows.
    assert!(matches!(
        database.read_dns_health(0, 10, ""),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    assert!(matches!(
        database.read_history(0, 10, HISTORY_DAY),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));

    // ADR-0019: a repair the Host fence refuses writes nothing.
    assert_eq!(
        database.repair_stored_rows_guarded(
            crate::StorageRepairKind::MalformedExpiries,
            TIMESTAMP,
            || Err(BusinessDatabaseError::WorkspaceRejected),
        ),
        Err(BusinessDatabaseError::WorkspaceRejected)
    );
    assert_eq!(integrity(&database), [1, 2, 1, 1, 2]);
    // Each repair clears exactly its count, writes one receipt per row, and is then a no-op.
    for (kind, rows) in [
        (crate::StorageRepairKind::MalformedExpiries, 1),
        (crate::StorageRepairKind::InvalidRegistrarObservations, 2),
        (crate::StorageRepairKind::RejectedDnsRows, 1),
        (crate::StorageRepairKind::RejectedListings, 1),
    ] {
        assert_eq!(
            database.repair_stored_rows_guarded(kind, TIMESTAMP, || Ok(())),
            Ok(rows)
        );
        assert_eq!(
            database.repair_stored_rows_guarded(kind, TIMESTAMP, || Ok(())),
            Ok(0)
        );
    }
    assert_eq!(integrity(&database), [0, 0, 0, 0, 2]);
    let receipts: Vec<(String, String)> = database
        .store
        .raw_connection()
        .prepare("SELECT repair_kind, row_key FROM storage_repair_receipts ORDER BY 1, 2")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        receipts,
        [
            ("asset_expiry", "charlie.test"),
            ("dns_binding", "alpha.test"),
            ("listing_observation", "listing-secret-1"),
            ("registrar_observation", "registrar-0"),
            ("registrar_observation", "registrar-1"),
        ]
        .map(|(kind, key)| (kind.to_owned(), key.to_owned()))
    );
    // Only the local expiry is rewritten; the deleted asset's is not touched.
    let expiries: Vec<Option<String>> = database
        .store
        .raw_connection()
        .prepare("SELECT expires_on FROM domain_assets WHERE entity_id IN ('charlie.test','gone.test') ORDER BY entity_id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(expiries, [None, Some("soon".to_owned())]);
    // The reads that failed closed now read: the quarantined binding as no binding, the
    // quarantined listing as no listing on that marketplace, the quarantined names as none.
    let dns = database.read_dns_health(0, 10, "").unwrap();
    assert!(dns.window.rows.iter().all(|row| row.zone_binding.is_none()));
    let sales = database.read_sales(0, 10).unwrap();
    assert_eq!(sales.total_rows, 1);
    database.read_renewals(0, 10).unwrap();
    // A quarantined latest registrar observation shows no name in the library and detail too.
    let library = database.read_asset_library(0, 10, "").unwrap();
    assert!(
        library
            .window
            .rows
            .iter()
            .filter(|row| row.domain != "charlie.test")
            .all(|row| row.registrar.is_none())
    );
    assert_eq!(
        database
            .read_domain_detail("alpha.test")
            .unwrap()
            .asset
            .registrar,
        None
    );
    // Outbox commit times are only marked: history then shows those rows with no time, and
    // the stored times are unchanged.
    assert!(matches!(
        database.read_history(0, 10, HISTORY_DAY),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    assert_eq!(
        database.repair_stored_rows_guarded(
            crate::StorageRepairKind::MalformedOutboxRows,
            TIMESTAMP,
            || Ok(()),
        ),
        Ok(2)
    );
    assert_eq!(
        database.repair_stored_rows_guarded(
            crate::StorageRepairKind::MalformedOutboxRows,
            TIMESTAMP,
            || Ok(()),
        ),
        Ok(0)
    );
    assert_eq!(integrity(&database), [0, 0, 0, 0, 0]);
    let history = database.read_history(0, 10, HISTORY_DAY).unwrap();
    let times: Vec<(String, Option<String>)> = history
        .window
        .rows
        .iter()
        .filter(|row| row.entity_id == "alpha.test")
        .map(|row| (row.operation.clone(), row.committed_at.clone()))
        .collect();
    assert_eq!(times.iter().filter(|(_, time)| time.is_none()).count(), 2);
    // `2026-08-28T24:00:00Z` sorts inside the day as text, but a marked row has no usable time,
    // so today's count holds only rows the page shows with a time on that day.
    let shown_today = history
        .window
        .rows
        .iter()
        .filter(|row| {
            row.committed_at
                .as_deref()
                .is_some_and(|at| at.starts_with("2026-08-28T"))
        })
        .count();
    assert_eq!(usize::try_from(history.changes_today), Ok(shown_today));
    assert!(
        times
            .iter()
            .any(|(_, time)| time.as_deref() == Some("2026-08-28T12:00:00Z"))
    );
    let stored: Vec<String> = database
        .store
        .raw_connection()
        .prepare("SELECT created_at FROM sync_outbox WHERE mutation_id LIKE 'legacy-%' ORDER BY mutation_id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(stored, ["2026-08-28 12:00:00", "2026-08-28T24:00:00Z"]);
    // A mark names only a malformed time, and is immutable.
    let connection = database.store.raw_connection();
    assert!(
        connection
            .execute(
                "INSERT INTO sync_outbox_commit_time_marks VALUES
             ('workspace-local','canonical',?1,?2)",
                rusqlite::params!["a".repeat(64), TIMESTAMP],
            )
            .is_err()
    );
    assert!(
        connection
            .execute("DELETE FROM sync_outbox_commit_time_marks", [])
            .is_err()
    );
    // Receipts are immutable and name only existing rows.
    let connection = database.store.raw_connection();
    assert!(
        connection
            .execute("DELETE FROM storage_repair_receipts", [])
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE storage_repair_receipts SET repaired_at = repaired_at",
                []
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "INSERT INTO storage_repair_receipts VALUES
             ('workspace-local','listing_observation','no-such-listing',?1,?2)",
                rusqlite::params!["a".repeat(64), TIMESTAMP],
            )
            .is_err()
    );
}

#[test]
fn a_quarantined_latest_listing_is_not_replaced_by_an_older_one() {
    // ADR-0019: a quarantined observation reads as no usable observation. The older, valid
    // listing on the same marketplace would show a state the platform has since left.
    let mut database = sales_database(&[
        (
            "alpha.test",
            "atom",
            "active",
            Some("USD"),
            Some("10"),
            "2026-08-27T00:00:00Z",
        ),
        (
            "alpha.test",
            "atom",
            "active",
            Some("usd"),
            Some("10"),
            "2026-08-28T00:00:00Z",
        ),
    ]);
    assert!(matches!(
        database.read_sales(0, 10),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    let generation: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT generation FROM sales_listing_generation",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        database.repair_stored_rows_guarded(
            crate::StorageRepairKind::RejectedListings,
            TIMESTAMP,
            || Ok(()),
        ),
        Ok(1)
    );
    // The cached desk is keyed on this generation, so the repair invalidates it.
    let after: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT generation FROM sales_listing_generation",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(after > generation);
    assert_eq!(database.read_sales(0, 10).unwrap().total_rows, 0);
    // The library counts listed domains from the same latest observation.
    assert_eq!(
        database
            .read_asset_library(0, 10, "")
            .unwrap()
            .listing_count,
        0
    );
}

#[test]
fn settings_reports_connection_roles_as_unqualified_without_identifiers() {
    let mut database = database();
    assert!(database.read_settings().unwrap().connections.is_empty());
    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status,last_validated_at) VALUES ('workspace-local','cf-settings','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid',?1)", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let _ = connection;

    let snapshot = database.read_settings().unwrap();
    assert_eq!(snapshot.kind, "settings");
    let [cloudflare] = snapshot.connections.as_slice() else {
        panic!("expected one connection");
    };
    assert_eq!(
        (
            cloudflare.provider_kind.as_str(),
            cloudflare.connection_label.as_str(),
            cloudflare.validation_status.as_str(),
            cloudflare.credential_use_state.as_str(),
        ),
        ("cloudflare", "Cloudflare", "valid", "active")
    );
    // A valid credential does not make a capability executable before qualification.
    let [dns] = cloudflare.roles.as_slice() else {
        panic!("expected one role");
    };
    assert_eq!(
        (
            dns.role.as_str(),
            dns.availability.as_str(),
            dns.unavailable_reason.as_str()
        ),
        ("dns", "unavailable", "qualification_pending")
    );
    let wire = serde_json::to_string(&snapshot).unwrap();
    for secret in ["cf-settings", &"a".repeat(64), &"b".repeat(64)] {
        assert!(!wire.contains(secret), "{secret} leaked into settings");
    }

    // Unknown roles, duplicate roles and control characters fail the whole read.
    for (column, value) in [
        ("capabilities_json", "'[\"payments\"]'"),
        ("capabilities_json", "'[\"dns\",\"dns\"]'"),
        ("display_label", "'Cloud'||char(7)||'flare'"),
    ] {
        let connection = database.store.fixture_connection();
        connection
            .execute(
                &format!("UPDATE local_provider_connections SET {column}={value}"),
                [],
            )
            .unwrap();
        let _ = connection;
        assert!(
            matches!(
                database.read_settings(),
                Err(BusinessDatabaseError::ProjectionRejected)
            ),
            "{column}={value} must fail closed"
        );
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE local_provider_connections SET capabilities_json='[\"dns\"]', display_label='Cloudflare'",
                [],
            )
            .unwrap();
    }
    assert_eq!(database.read_settings().unwrap().connections.len(), 1);

    // All four ADR-0027 roles are listed, each unavailable until qualified.
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE local_provider_connections SET capabilities_json='[\"registrar\",\"dns\",\"marketplace\",\"acquisition\"]'",
            [],
        )
        .unwrap();
    let roles: Vec<(String, String, String)> = database.read_settings().unwrap().connections[0]
        .roles
        .iter()
        .map(|role| {
            (
                role.role.clone(),
                role.availability.clone(),
                role.unavailable_reason.clone(),
            )
        })
        .collect();
    assert_eq!(
        roles,
        ["registrar", "dns", "marketplace", "acquisition"].map(|role| (
            role.to_owned(),
            "unavailable".to_owned(),
            "qualification_pending".to_owned()
        ))
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one fixture exercises exclusion, the row bound and Provider kinds in sequence"
)]
fn settings_excludes_deleted_connections_and_fails_closed_on_overflow_or_unknown_providers() {
    const CONNECTION: &str = "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,lifecycle_status,deleted_at) VALUES ('workspace-local',?1,?2,?3,?4,'[\"dns\"]',?5,?6)";
    let mut database = database();
    {
        let connection = database.store.fixture_connection();
        connection
            .execute(
                CONNECTION,
                rusqlite::params![
                    "live",
                    "cloudflare",
                    "Live",
                    TIMESTAMP,
                    "active",
                    None::<String>
                ],
            )
            .unwrap();
        // Deleted connections never reach the Renderer, by lifecycle or by tombstone.
        connection
            .execute(
                CONNECTION,
                rusqlite::params![
                    "gone",
                    "cloudflare",
                    "Gone",
                    TIMESTAMP,
                    "deleted",
                    None::<String>
                ],
            )
            .unwrap();
        connection
            .execute(
                CONNECTION,
                rusqlite::params![
                    "tombstone",
                    "cloudflare",
                    "Tombstone",
                    TIMESTAMP,
                    "revoked",
                    Some(TIMESTAMP)
                ],
            )
            .unwrap();
    }
    let labels = database
        .read_settings()
        .unwrap()
        .connections
        .into_iter()
        .map(|connection| connection.connection_label)
        .collect::<Vec<_>>();
    assert_eq!(labels, ["Live"]);

    // 64 connections are the read's bound; the 65th fails the read instead of being truncated.
    {
        let connection = database.store.fixture_connection();
        for index in 1..64 {
            connection
                .execute(
                    CONNECTION,
                    rusqlite::params![
                        format!("bulk-{index:02}"),
                        "cloudflare",
                        format!("Bulk {index:02}"),
                        TIMESTAMP,
                        "active",
                        None::<String>
                    ],
                )
                .unwrap();
        }
    }
    assert_eq!(database.read_settings().unwrap().connections.len(), 64);
    database
        .store
        .fixture_connection()
        .execute(
            CONNECTION,
            rusqlite::params![
                "bulk-64",
                "cloudflare",
                "Bulk 64",
                TIMESTAMP,
                "active",
                None::<String>
            ],
        )
        .unwrap();
    assert!(matches!(
        database.read_settings(),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));

    // Every ADR-0027 platform is listed, each role still unavailable; a kind outside ADR-0027
    // fails the read instead of being hidden.
    let mut listed = self::database();
    for kind in [
        "afternic",
        "atom",
        "cloudflare",
        "dynadot",
        "godaddy",
        "namecheap",
        "porkbun",
        "spaceship",
    ] {
        listed
            .store
            .fixture_connection()
            .execute(
                CONNECTION,
                rusqlite::params![kind, kind, kind, TIMESTAMP, "active", None::<String>],
            )
            .unwrap();
    }
    let kinds = listed.read_settings().unwrap().connections;
    assert_eq!(kinds.len(), 8);
    assert!(kinds.iter().all(|connection| {
        connection.roles.iter().all(|role| {
            role.availability == "unavailable" && role.unavailable_reason == "qualification_pending"
        })
    }));
    listed
        .store
        .fixture_connection()
        .execute(
            CONNECTION,
            rusqlite::params![
                "other",
                "example",
                "Other",
                TIMESTAMP,
                "active",
                None::<String>
            ],
        )
        .unwrap();
    assert!(matches!(
        listed.read_settings(),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
}

#[test]
fn bounded_asset_library_and_detail_read_the_bound_workspace() {
    let mut database = database();
    for (index, domain) in ["alpha.test", "beta.test"].into_iter().enumerate() {
        database
            .upsert_domain_asset(
                &format!("read-mutation-{index}"),
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: domain.to_owned(),
                    note: Some("<script>text only</script>".to_owned()),
                    portfolio_id: None,
                    tags: vec!["safe-tag".to_owned()],
                    target_price: Some(Money {
                        currency: "USD".to_owned(),
                        amount: "10.5".to_owned(),
                    }),
                },
            )
            .unwrap();
    }
    let list = database.read_asset_library(0, 1, " ALP").unwrap();
    assert_eq!(list.total_rows, 1);
    assert_eq!(list.window.rows[0].domain, "alpha.test");
    assert_eq!(
        list.total_value,
        Some(Money {
            currency: "USD".to_owned(),
            amount: "10.5".to_owned()
        })
    );
    let detail = database.read_domain_detail("alpha.test").unwrap();
    assert_eq!(
        detail.asset.note.as_deref(),
        Some("<script>text only</script>")
    );
    assert_eq!(
        database.read_domain_detail("missing.test"),
        Err(BusinessDatabaseError::AssetNotFound)
    );
    assert_eq!(
        database.read_asset_library(0, 0, ""),
        Err(BusinessDatabaseError::WindowRejected)
    );
    assert_eq!(
        database.read_asset_library(0, 1, "bad\u{202e}"),
        Err(BusinessDatabaseError::QueryRejected)
    );
    // A recorded expiry that is not a real calendar date fails the asset library from any page
    // or search, since the expiring count would include it, and fails that asset's detail.
    allow_legacy_rows(database.store.fixture_connection());
    for (expires_on, valid) in [
        ("2028-02-29", true),
        ("2026-02-30", false),
        ("2027-02-29", false),
        ("2026-1-10", false),
        ("2026-11-10x", false),
        ("2026-11-10T00:00:00Z", false),
    ] {
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE domain_assets SET expires_on = ?1 WHERE entity_id = 'beta.test'",
                [expires_on],
            )
            .unwrap();
        assert_eq!(
            database.read_asset_library(0, 1, "alpha").is_ok(),
            valid,
            "{expires_on}"
        );
        assert_eq!(
            database.read_domain_detail("beta.test").is_ok(),
            valid,
            "{expires_on}"
        );
    }
}

#[test]
fn asset_library_window_uses_the_workspace_entity_index_without_a_sort() {
    let database = database();
    let mut statement = database
        .store
        .raw_connection()
        .prepare(
            "EXPLAIN QUERY PLAN
         SELECT a.entity_id FROM domain_assets a
         WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL
           AND (?2 = '' OR (a.entity_id >= ?2 AND a.entity_id < ?3))
         ORDER BY a.entity_id COLLATE BINARY LIMIT ?4 OFFSET ?5",
        )
        .unwrap();
    let plan = statement
        .query_map(
            params![database.workspace_id, "alp", "alp{", 25, 0],
            |row| row.get::<_, String>(3),
        )
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(
        plan.iter()
            .any(|step| step.contains("sqlite_autoindex_domain_assets_1"))
    );
    assert!(
        !plan
            .iter()
            .any(|step| step.contains("USE TEMP B-TREE FOR ORDER BY"))
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one fixture walks every merge input and non-input in write order"
)]
fn sales_listing_generation_moves_with_every_merge_input_and_nothing_else() {
    let mut database = sales_database(&[(
        "alpha.test",
        "atom",
        "active",
        Some("USD"),
        Some("10"),
        TIMESTAMP,
    )]);
    let connection = database.store.fixture_connection();
    let generation = |connection: &rusqlite::Connection| -> i64 {
        connection
            .query_row(
                "SELECT generation FROM sales_listing_generation WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .unwrap()
    };
    let moves = |connection: &rusqlite::Connection, sql: &str| {
        let before = generation(connection);
        connection
            .execute(&sql.replace("{T}", TIMESTAMP), [])
            .unwrap();
        generation(connection) > before
    };
    for (sql, expected) in [
        // Writes the merge does not read.
        (
            "UPDATE domain_assets SET updated_at = '2026-10-01T00:00:00Z' WHERE entity_id = 'bravo.test'",
            false,
        ),
        (
            "UPDATE domain_assets SET lifecycle_status = 'archived' WHERE entity_id = 'bravo.test'",
            false,
        ),
        (
            "UPDATE local_provider_connections SET display_label = 'Renamed', capabilities_json = '[\"marketplace\",\"registrar\"]'",
            false,
        ),
        // A registrar run and its targets can never confirm a listing.
        (
            "INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local','run-registrar','market-1','registrar','{T}','running')",
            false,
        ),
        (
            "INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local','run-registrar','alpha.test',0,'requested','{T}')",
            false,
        ),
        (
            "UPDATE provider_observation_targets SET status = 'missing', completed_at = '{T}' WHERE observation_run_id = 'run-registrar'",
            false,
        ),
        // A new asset cannot have a listing yet.
        (
            "INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','delta.test','active','{T}','{T}',1)",
            false,
        ),
        // Every input of the merge.
        (
            "INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local','run-new','market-1','marketplace','{T}','running')",
            true,
        ),
        (
            "INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local','run-new','bravo.test',0,'requested','{T}')",
            true,
        ),
        (
            "INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local','listing-new','run-new','bravo.test','atom','sold','{T}','v','available','confirmed')",
            true,
        ),
        (
            "UPDATE provider_observation_targets SET status = 'succeeded', completed_at = '{T}' WHERE observation_run_id = 'run-new'",
            true,
        ),
        (
            "UPDATE provider_observation_runs SET status = 'succeeded', completed_at = '{T}' WHERE observation_run_id = 'run-new'",
            true,
        ),
        (
            "UPDATE domain_assets SET deleted_at = '{T}' WHERE entity_id = 'bravo.test'",
            true,
        ),
        (
            "INSERT INTO sync_tombstones (workspace_id, entity_kind, entity_id, deleted_local_commit_sequence, deleted_server_revision, deleted_at, purge_after, state, barrier_state, order_server_revision, order_source_device_id, order_mutation_id) VALUES ('workspace-local', 'domain_asset', 'delta.test', 1, 1, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z', 'purge_eligible', 'purge_eligible', 1, 'test-source', 'test-delete')",
            false,
        ),
        (
            "DELETE FROM domain_assets WHERE entity_id = 'delta.test'",
            true,
        ),
    ] {
        assert_eq!(moves(connection, sql), expected, "{sql}");
    }
    // The counter only ever advances by the triggers' single step and is never removed.
    assert!(
        connection
            .execute("UPDATE sales_listing_generation SET generation = 0", [])
            .is_err()
    );
    assert!(
        connection
            .execute("DELETE FROM sales_listing_generation", [])
            .is_err()
    );
    // A write that rolls back takes its step back with it.
    let before = generation(connection);
    let transaction = connection.unchecked_transaction().unwrap();
    transaction
        .execute(
            "UPDATE domain_assets SET lifecycle_status = 'archived', deleted_at = ?1
             WHERE entity_id = 'charlie.test'",
            [TIMESTAMP],
        )
        .unwrap();
    assert!(generation(&transaction) > before);
    drop(transaction);
    assert_eq!(generation(connection), before);
    // Deleting a listed asset cascades to its listings and moves the counter.
    connection.execute("INSERT INTO sync_tombstones (workspace_id, entity_kind, entity_id, deleted_local_commit_sequence, deleted_server_revision, deleted_at, purge_after, state, barrier_state, order_server_revision, order_source_device_id, order_mutation_id) VALUES ('workspace-local', 'domain_asset', 'alpha.test', 1, 1, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z', 'purge_eligible', 'purge_eligible', 1, 'test-source', 'test-delete-alpha')", []).unwrap();
    assert!(moves(
        connection,
        "DELETE FROM domain_assets WHERE entity_id = 'alpha.test'"
    ));
    let _ = connection;
    assert_eq!(database.read_sales(0, 10).unwrap().total_rows, 0);
}

#[test]
fn settings_skips_the_listing_scan_only_while_a_sales_desk_vouches_for_this_generation() {
    let mut database = sales_database(&[(
        "alpha.test",
        "atom",
        "active",
        Some("USD"),
        Some("10"),
        TIMESTAMP,
    )]);
    let listing_scans = |database: &BusinessDatabase| {
        let connection = database.store.raw_connection();
        TRACED_STATEMENTS.lock().unwrap().clear();
        connection.trace_v2(
            rusqlite::trace::TraceEventCodes::SQLITE_TRACE_STMT,
            Some(trace_read_statements),
        );
        let rejected = database
            .read_settings()
            .unwrap()
            .storage_integrity
            .rejected_listings;
        connection.trace_v2(rusqlite::trace::TraceEventCodes::empty(), None);
        let scans = TRACED_STATEMENTS
            .lock()
            .unwrap()
            .drain(..)
            .filter(|sql| sql.contains("marketplace_listing_observations"))
            .count();
        (rejected, scans)
    };
    // Without a merged desk the listings are scanned.
    assert_eq!(listing_scans(&database), (0, 1));
    // A desk merged at this generation vouches for them.
    database.read_sales(0, 10).unwrap();
    assert_eq!(listing_scans(&database), (0, 0));
    // A write the merge does not read keeps the desk and what it vouches for.
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE domain_assets SET updated_at = '2026-10-01T00:00:00Z'
             WHERE workspace_id = 'workspace-local' AND entity_id = 'charlie.test'",
            [],
        )
        .unwrap();
    assert_eq!(listing_scans(&database), (0, 0));
    // A listing write moves the generation, so a listing written since is counted, not
    // vouched for.
    {
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local','run-late','market-1','marketplace',?1,'running')", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local','run-late','bravo.test',0,'requested',?1)", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,asking_price_currency,asking_price_amount,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local','listing-late','run-late','bravo.test','atom','active','usd','10',?1,'version','available','confirmed')", [TIMESTAMP]).unwrap();
        complete_observation_run(connection, "run-late", "bravo.test");
    }
    assert_eq!(listing_scans(&database), (1, 1));
}
