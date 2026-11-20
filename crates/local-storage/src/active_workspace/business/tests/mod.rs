use crate::test_tempdir::tempdir;

use super::*;

const TIMESTAMP: &str = "2026-08-28T00:00:00Z";
/// The local day that `TIMESTAMP` falls in, for history reads.
const HISTORY_DAY: (&str, &str) = ("2026-08-28T00:00:00Z", "2026-08-29T00:00:00Z");

/// A test database that removes its directory when dropped, after the database closes (fields
/// drop in order), so test runs do not leave encrypted databases behind.
pub(super) struct TestDatabase {
    database: BusinessDatabase,
    _directory: tempfile::TempDir,
}

impl TestDatabase {
    pub(super) fn open(key: [u8; 32]) -> Self {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("workspace.db"),
            &LocalDatabaseKey::from_bytes(key),
            "workspace-local",
        )
        .unwrap();
        Self {
            database,
            _directory: directory,
        }
    }
}

impl std::ops::Deref for TestDatabase {
    type Target = BusinessDatabase;
    fn deref(&self) -> &BusinessDatabase {
        &self.database
    }
}

impl std::ops::DerefMut for TestDatabase {
    fn deref_mut(&mut self) -> &mut BusinessDatabase {
        &mut self.database
    }
}

fn database() -> TestDatabase {
    TestDatabase::open([0x31; 32])
}

/// `(entity, marketplace, status, currency, amount, observed_at)`.
type ListingSeed<'a> = (
    &'a str,
    &'a str,
    &'a str,
    Option<&'a str>,
    Option<&'a str>,
    &'a str,
);

/// Completes a fixture run whose only target is `entity`, with that target succeeded.
fn complete_observation_run(connection: &rusqlite::Connection, run: &str, entity: &str) {
    connection.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2 AND entity_id=?3", rusqlite::params![TIMESTAMP, run, entity]).unwrap();
    connection.execute("UPDATE provider_observation_runs SET status='succeeded', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2", rusqlite::params![TIMESTAMP, run]).unwrap();
}

/// Seeds assets, one marketplace connection and run, and the given listing observations
/// `(entity, marketplace, status, currency, amount, observed_at)`.
fn sales_database(listings: &[ListingSeed<'_>]) -> TestDatabase {
    let mut database = database();
    let connection = database.store.fixture_connection();
    for entity in ["alpha.test", "bravo.test", "charlie.test"] {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',?2,?2,1)", rusqlite::params![entity, TIMESTAMP]).unwrap();
    }
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','market-1','cloudflare','Market',?1,'[\"marketplace\"]')", [TIMESTAMP]).unwrap();
    // The schema admits one observation per (run, asset), each from a running marketplace run
    // with a requested target, so every listing gets its own run.
    for (index, (entity, kind, status, currency, amount, observed_at)) in
        listings.iter().enumerate()
    {
        let run = format!("run-secret-{index}");
        connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'market-1','marketplace',?2,'running')", rusqlite::params![run, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,?2,0,'requested',?3)", rusqlite::params![run, entity, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,asking_price_currency,asking_price_amount,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local',?1,?2,?3,?4,?5,?6,?7,?8,'version-secret','available','confirmed')", rusqlite::params![format!("listing-secret-{index}"), run, entity, kind, status, currency, amount, observed_at]).unwrap();
        complete_observation_run(connection, &run, entity);
    }
    let _ = connection;
    database
}

/// Seeds `assets` active assets the way a large workspace looks: every asset has a target price
/// and a confirmed registrar observation, every other one expires within 60 days, every third is
/// listed on the first `markets` launch platforms, and one in a hundred has a pending field.
fn scale_database(assets: u32, markets: usize) -> TestDatabase {
    let mut database = database();
    let connection = database.store.fixture_connection();
    let transaction = connection.transaction().unwrap();
    transaction.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','scale-1','cloudflare','Scale',?1,'[\"registrar\",\"marketplace\"]')", [TIMESTAMP]).unwrap();
    let markets: Vec<(String, &str)> = super::super::launch_platforms::LAUNCH_PLATFORMS[..markets]
        .iter()
        .map(|kind| (format!("scale-{kind}"), *kind))
        .collect();
    for (run, capability) in std::iter::once(("scale-registrar", "registrar"))
        .chain(markets.iter().map(|(run, _)| (run.as_str(), "marketplace")))
    {
        transaction.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'scale-1',?2,?3,'running')", rusqlite::params![run, capability, TIMESTAMP]).unwrap();
    }
    {
        let mut asset = transaction.prepare("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,expires_on,auto_renew,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',date('now',?2),?3,?4,?4,1)").unwrap();
        let mut desired = transaction.prepare("INSERT INTO domain_asset_desired_state (workspace_id,entity_id,target_price_currency,target_price_amount,desired_sale_status,local_commit_sequence,updated_at) VALUES ('workspace-local',?1,'USD',?2,'hold',1,?3)").unwrap();
        let mut target = transaction.prepare("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,?2,?3,'requested',?4)").unwrap();
        let mut registrar = transaction.prepare("INSERT INTO registrar_observations (workspace_id,observation_id,observation_run_id,entity_id,registrar_name,observation_availability,evidence_status,observed_at,provider_version_token) VALUES ('workspace-local',?1,'scale-registrar',?2,'Porkbun','available','confirmed',?3,'v')").unwrap();
        let mut listing = transaction.prepare("INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,entity_id,marketplace_kind,listing_status,asking_price_currency,asking_price_amount,observed_at,provider_version_token,observation_availability,evidence_status) VALUES ('workspace-local',?1,?2,?3,?4,'active','USD','1000',?5,'v','available','confirmed')").unwrap();
        let mut pending = transaction.prepare("INSERT INTO domain_asset_field_versions (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at) VALUES ('workspace-local',?1,'note',0,1,'pending',?2)").unwrap();
        for index in 0..assets {
            let entity = format!("d{index:07}.test");
            let expires = if index % 2 == 0 {
                "+30 days"
            } else {
                "+400 days"
            };
            asset
                .execute(rusqlite::params![
                    entity,
                    expires,
                    i64::from(index % 3 == 0),
                    TIMESTAMP
                ])
                .unwrap();
            desired
                .execute(rusqlite::params![
                    entity,
                    format!("{}", 100 + index % 900),
                    TIMESTAMP
                ])
                .unwrap();
            target
                .execute(rusqlite::params![
                    "scale-registrar",
                    entity,
                    index,
                    TIMESTAMP
                ])
                .unwrap();
            registrar
                .execute(rusqlite::params![format!("r{index}"), entity, TIMESTAMP])
                .unwrap();
            if index % 3 == 0 {
                for (run, kind) in &markets {
                    target
                        .execute(rusqlite::params![run, entity, index, TIMESTAMP])
                        .unwrap();
                    listing
                        .execute(rusqlite::params![
                            format!("{kind}-{index}"),
                            run,
                            entity,
                            kind,
                            TIMESTAMP
                        ])
                        .unwrap();
                }
            }
            if index % 100 == 0 {
                pending
                    .execute(rusqlite::params![entity, TIMESTAMP])
                    .unwrap();
            }
        }
    }
    transaction.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE workspace_id='workspace-local'", [TIMESTAMP]).unwrap();
    transaction.execute("UPDATE provider_observation_runs SET status='succeeded', completed_at=?1 WHERE workspace_id='workspace-local'", [TIMESTAMP]).unwrap();
    transaction.commit().unwrap();
    database
}

/// The first sales read of a listing generation, which merges every listing.
const SALES_MERGE: &str = "sales page 1 (merge)";
/// A settings read before any sales read of the generation, which scans every listing.
const SETTINGS_SCAN: &str = "settings (listing scan)";

/// The slowest timing.
fn slowest(timings: &[(&'static str, std::time::Duration)]) -> std::time::Duration {
    timings
        .iter()
        .map(|(_, elapsed)| *elapsed)
        .max()
        .unwrap_or_default()
}

/// Statements recorded by `trace_read_statements`; `trace_v2` takes a plain function pointer.
static TRACED_STATEMENTS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[expect(
    clippy::needless_pass_by_value,
    reason = "`trace_v2` takes a `fn(TraceEvent)` callback"
)]
fn trace_read_statements(event: rusqlite::trace::TraceEvent<'_>) {
    if let rusqlite::trace::TraceEvent::Stmt(_, sql) = event {
        TRACED_STATEMENTS.lock().unwrap().push(sql.to_owned());
    }
}

/// Times every paged Host read over `scale_database(assets, markets)`.
fn scale_reads(assets: u32, markets: usize) -> Vec<(&'static str, std::time::Duration)> {
    let mut database = scale_database(assets, markets);
    let expiring = assets.div_ceil(2);
    let listed = assets.div_ceil(3);
    let mut timings = Vec::new();
    let mut time = |label: &'static str, read: &mut dyn FnMut()| {
        let started = std::time::Instant::now();
        read();
        let elapsed = started.elapsed();
        println!("{label}: {elapsed:?}");
        timings.push((label, elapsed));
    };
    time("asset library page 1", &mut || {
        let snapshot = database.read_asset_library(0, 50, "").unwrap();
        assert_eq!(snapshot.total_rows, assets);
        assert_eq!(snapshot.expiring_within60_days, expiring);
        assert_eq!(snapshot.listing_count, listed);
    });
    time("asset library last page", &mut || {
        database.read_asset_library(assets - 50, 50, "").unwrap();
    });
    time("asset library search", &mut || {
        assert_eq!(
            database
                .read_asset_library(0, 50, "d00012")
                .unwrap()
                .total_rows,
            100
        );
    });
    time("domain detail", &mut || {
        database
            .read_domain_detail(&format!("d{:07}.test", assets / 2))
            .unwrap();
    });
    time("renewals page 1", &mut || {
        assert_eq!(database.read_renewals(0, 50).unwrap().total_rows, expiring);
    });
    time("renewals last page", &mut || {
        database.read_renewals(expiring - 50, 50).unwrap();
    });
    time("dns health page 1", &mut || {
        assert_eq!(
            database.read_dns_health(0, 50, "").unwrap().asset_count,
            assets
        );
    });
    time(SETTINGS_SCAN, &mut || {
        let integrity = database.read_settings().unwrap().storage_integrity;
        assert_eq!(integrity.rejected_listings, 0);
    });
    time(SALES_MERGE, &mut || {
        let snapshot = database.read_sales(0, 50).unwrap();
        assert_eq!(snapshot.total_rows, listed);
        assert_eq!(snapshot.window.rows[0].marketplaces.len(), markets);
    });
    // The heap the cached desk requests from the allocator: a lower bound that leaves out
    // allocator overhead and the merge's transient peak. A resident-set delta reads zero here
    // because the merge reuses heap the seeding freed.
    println!(
        "sales desk held: {} KiB",
        database.store.sales_desk_bytes().unwrap() / 1024
    );
    time("sales last page (same data)", &mut || {
        database.read_sales(listed - 50, 50).unwrap();
    });
    time("settings (sales desk merged)", &mut || {
        database.read_settings().unwrap();
    });
    // A write the merge does not read keeps the desk, so neither read merges or scans again.
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE domain_assets SET updated_at = '2026-10-01T00:00:00Z'
             WHERE workspace_id = 'workspace-local' AND entity_id = 'd0000001.test'",
            [],
        )
        .unwrap();
    time("settings after an unrelated write", &mut || {
        database.read_settings().unwrap();
    });
    time("sales page 1 after an unrelated write", &mut || {
        assert_eq!(database.read_sales(0, 50).unwrap().total_rows, listed);
    });
    timings
}

/// Seeds one connection, two assets, an older approved plan with an operation and attempts,
/// and a newer unapproved plan titled `newer_title`.
#[allow(clippy::too_many_lines)]
fn batch_database(newer_title: &str) -> TestDatabase {
    let mut database = database();
    let connection = database.store.fixture_connection();
    for entity in ["alpha.test", "bravo.test"] {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',?2,?2,1)", rusqlite::params![entity, TIMESTAMP]).unwrap();
    }
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at) VALUES ('workspace-local','connection-secret','cloudflare','DNS',?1)", [TIMESTAMP]).unwrap();
    let plan = "INSERT INTO operation_plans (workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,created_at,local_commit_sequence) VALUES ('workspace-local',?1,?2,?3,?4,'planned',?5,?6,?7,1)";
    let item = "INSERT INTO operation_plan_items (workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,capability,precondition_json,risk_level,execution_mode,inclusion_status) VALUES ('workspace-local',?1,?2,?3,?4,'connection-secret','dns_write','{}',?5,?6,?7)";
    connection
        .execute(
            plan,
            rusqlite::params![
                "plan-secret-a",
                "dns_change",
                "0".repeat(64),
                "Nameserver change",
                "high",
                3,
                "2026-01-01T00:00:00Z"
            ],
        )
        .unwrap();
    for (ordinal, (entity, risk, mode, inclusion)) in [
        ("alpha.test", "high", "automatic", "included"),
        ("bravo.test", "standard", "manual", "included"),
        ("bravo.test", "standard", "automatic", "excluded"),
    ]
    .into_iter()
    .enumerate()
    {
        connection
            .execute(
                item,
                rusqlite::params![
                    "plan-secret-a",
                    format!("item-secret-{ordinal}"),
                    i64::try_from(ordinal).unwrap(),
                    entity,
                    risk,
                    mode,
                    inclusion
                ],
            )
            .unwrap();
    }
    connection.execute("UPDATE operation_plans SET phase = 'approved', approved_at = ?1 WHERE plan_id = 'plan-secret-a'", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO operations (workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,started_at,local_commit_sequence) VALUES ('workspace-local','operation-secret','plan-secret-a','key-secret','running',?1,?1,1)", [TIMESTAMP]).unwrap();
    let attempt = "INSERT INTO operation_attempts (workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest,started_at,completed_at,provider_request_id) VALUES ('workspace-local','operation-secret','plan-secret-a',?1,?2,?3,?4,?5,?6,'provider-request-secret')";
    connection
        .execute(
            attempt,
            rusqlite::params![
                "item-secret-0",
                1,
                "failed_retryable",
                "1".repeat(64),
                TIMESTAMP,
                Some(TIMESTAMP)
            ],
        )
        .unwrap();
    // A retry needs the prior attempt's recorded retryable result.
    connection.execute("INSERT INTO operation_results (workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,outcome,result_json,observed_at) VALUES ('workspace-local','operation-secret','plan-secret-a','item-secret-0',1,1,'failed_retryable','{}',?1)", [TIMESTAMP]).unwrap();
    connection
        .execute(
            attempt,
            rusqlite::params![
                "item-secret-0",
                2,
                "succeeded",
                "2".repeat(64),
                TIMESTAMP,
                Some(TIMESTAMP)
            ],
        )
        .unwrap();
    connection
        .execute(
            attempt,
            rusqlite::params![
                "item-secret-1",
                1,
                "manual_action_required",
                "3".repeat(64),
                TIMESTAMP,
                None::<&str>
            ],
        )
        .unwrap();
    connection
        .execute(
            plan,
            rusqlite::params![
                "plan-secret-b",
                "price_change",
                "4".repeat(64),
                newer_title,
                "standard",
                1,
                "2026-02-01T00:00:00Z"
            ],
        )
        .unwrap();
    connection
        .execute(
            item,
            rusqlite::params![
                "plan-secret-b",
                "item-secret-b",
                0,
                "alpha.test",
                "standard",
                "unsupported",
                "conflict"
            ],
        )
        .unwrap();
    let _ = connection;
    database
}

/// Seeds assets `(entity, lifecycle, expiry offset in days, auto_renew)` relative to SQLite's
/// `date('now')`, and registrar observations `(entity, registrar, availability, observed_at)`.
/// Drops the storage-integrity triggers, so a test can stand in for rows written before that
/// migration and prove the reads still fail closed on them.
fn allow_legacy_rows(connection: &rusqlite::Connection) {
    connection
        .execute_batch(
            "DROP TRIGGER domain_asset_provider_bindings_platform_matches_connection;
             DROP TRIGGER local_provider_connections_bound_platform_immutable;
             DROP TRIGGER domain_assets_expires_on_insert_is_date;
             DROP TRIGGER domain_assets_expires_on_update_is_date;",
        )
        .unwrap();
}

fn renewals_database(
    assets: &[(&str, &str, Option<i64>, Option<i64>)],
    observations: &[(&str, &str, &str, &str, &str)],
) -> TestDatabase {
    let mut database = database();
    let connection = database.store.fixture_connection();
    for (entity, lifecycle, offset, auto_renew) in assets {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,expires_on,auto_renew,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,?2,CASE WHEN ?3 IS NULL THEN NULL ELSE date('now', ?3 || ' days') END,?4,?5,?5,1)", rusqlite::params![entity, lifecycle, offset.map(|days| format!("{days:+}")), auto_renew, TIMESTAMP]).unwrap();
    }
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','registrar-1','cloudflare','Registrar',?1,'[\"registrar\"]')", [TIMESTAMP]).unwrap();
    // Each observation's run ends as `outcome`: "succeeded" or "partial" confirm it, while
    // "running" leaves the run in flight with its target only requested.
    for (index, (entity, registrar, availability, observed_at, outcome)) in
        observations.iter().enumerate()
    {
        let run = format!("run-secret-{index}");
        connection.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES ('workspace-local',?1,'registrar-1','registrar',?2,'running')", rusqlite::params![run, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,?2,0,'requested',?3)", rusqlite::params![run, entity, TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO registrar_observations (workspace_id,observation_id,observation_run_id,entity_id,registrar_name,observation_availability,evidence_status,observed_at,provider_version_token) VALUES ('workspace-local',?1,?2,?3,?4,?5,'confirmed',?6,'version-secret')", rusqlite::params![format!("registrar-secret-{index}"), run, entity, registrar, availability, observed_at]).unwrap();
        match *outcome {
            "succeeded" => complete_observation_run(connection, &run, entity),
            "partial" => {
                // A partial run needs a second target the Provider did not report.
                connection.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES ('workspace-local',?1,'undated.test',1,'requested',?2)", rusqlite::params![run, TIMESTAMP]).unwrap();
                connection.execute("UPDATE provider_observation_targets SET status='missing', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2 AND ordinal=1", rusqlite::params![TIMESTAMP, run]).unwrap();
                connection.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2 AND ordinal=0", rusqlite::params![TIMESTAMP, run]).unwrap();
                connection.execute("UPDATE provider_observation_runs SET status='partial', completed_at=?1 WHERE workspace_id='workspace-local' AND observation_run_id=?2", rusqlite::params![TIMESTAMP, run]).unwrap();
            }
            "running" => {}
            other => panic!("unknown run outcome {other}"),
        }
    }
    let _ = connection;
    database
}

fn history_write(note: &str, tags: &[&str]) -> DomainAssetWrite {
    DomainAssetWrite {
        entity_id: "ledger.test".to_owned(),
        note: Some(note.to_owned()),
        portfolio_id: None,
        tags: tags.iter().map(|&tag| tag.to_owned()).collect(),
        target_price: None,
    }
}

fn binding_database() -> TestDatabase {
    let mut database = database();
    database
        .upsert_domain_asset(
            "binding-seed",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "example.com".to_owned(),
                note: None,
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    database.seed_verified_cloudflare_binding_for_test("example.com");
    database
}

fn create_for_drain(database: &mut BusinessDatabase, name: &str) {
    let write = DomainAssetWrite {
        entity_id: format!("{name}.test"),
        note: None,
        portfolio_id: None,
        tags: vec!["drain".to_owned()],
        target_price: None,
    };
    database
        .create_domain_asset_guarded(
            &format!("create-{name}"),
            "device-1",
            7,
            TIMESTAMP,
            &write,
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
}

fn acknowledgements_for(
    claimed: &[ClaimedSyncMutation],
    first_revision: u64,
) -> Vec<SyncMutationAcknowledgement> {
    claimed
        .iter()
        .zip(first_revision..)
        .map(|(mutation, server_revision)| SyncMutationAcknowledgement {
            mutation_id: mutation.mutation_id.clone(),
            source_device_id: mutation.source_device_id.clone(),
            active_lease_epoch: mutation.active_lease_epoch,
            device_mutation_sequence: mutation.device_mutation_sequence,
            delivery_attempt_fence: mutation.delivery_attempt_fence,
            wire_mutation_digest: mutation.wire_mutation_digest.clone(),
            server_revision,
        })
        .collect()
}

fn test_sync_page(revision: u64, note: &str) -> String {
    let mut page = serde_json::json!({
        "schemaVersion": 3,
        "workspaceId": "workspace-local",
        "fromServerRevisionExclusive": revision - 1,
        "throughServerRevisionInclusive": revision,
        "mutations": [{
            "schemaVersion": 3,
            "mutationId": format!("remote-{revision}"),
            "workspaceId": "workspace-local",
            "workspaceSchemaVersion": 1,
            "entityType": "domain_asset",
            "entityId": "remote.test",
            "entityGeneration": 1,
            "operationKind": "upsert",
            "baseServerRevision": revision - 1,
            "changedFields": [{"fieldPath": "note", "value": note}],
            "sourceDeviceId": "cloud-device",
            "activeLeaseEpoch": 1,
            "deviceMutationSequence": revision,
            "serverRevision": revision,
        }],
        "returnedThroughServerRevision": revision,
        "nextCursor": null,
        "pageDigest": "A".repeat(43),
    });
    let digest = canonical_page_digest(&page).unwrap();
    page["pageDigest"] = serde_json::Value::String(digest);
    page.to_string()
}

fn seed_rebootstrap_floor_guard_evidence(database: &mut BusinessDatabase) {
    database
        .upsert_domain_asset(
            "local-pending-before-floor-guard",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("retain local".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let mut page = serde_json::json!({
        "schemaVersion":3,"workspaceId":"workspace-local","fromServerRevisionExclusive":0,
        "throughServerRevisionInclusive":1,"mutations":[{"schemaVersion":3,
        "mutationId":"remote-delete-floor-guard","workspaceId":"workspace-local",
        "workspaceSchemaVersion":1,"entityType":"domain_asset","entityId":"remote.test","entityGeneration":1,
        "operationKind":"delete","deletedAt":"2026-08-28T00:00:00Z",
        "baseServerRevision":0,"changedFields":[],"sourceDeviceId":"cloud-device",
        "activeLeaseEpoch":1,"deviceMutationSequence":1,"serverRevision":1}],
        "returnedThroughServerRevision":1,"nextCursor":null,"pageDigest":"A".repeat(43)
    });
    page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());
    database
        .apply_sync_page_v2("reader-local", &page.to_string(), "confirm-floor-guard")
        .unwrap();
}

#[derive(Debug, PartialEq, Eq)]
struct RebootstrapFloorGuardOracle {
    proof: DatabaseRecoveryProof,
    evidence_counts: (i64, i64, i64, i64, i64),
    #[expect(
        clippy::type_complexity,
        reason = "the test oracle preserves the exact durable reader-state row shape"
    )]
    reader_state: Vec<(String, i64, Option<i64>, Option<i64>, i64, i64, i64, String)>,
}

fn rebootstrap_floor_guard_oracle(database: &BusinessDatabase) -> RebootstrapFloorGuardOracle {
    let evidence_counts = database
        .store
        .raw_connection()
        .query_row(
            "SELECT
               (SELECT count(*) FROM sync_outbox WHERE workspace_id='workspace-local'),
               (SELECT count(*) FROM sync_conflicts WHERE workspace_id='workspace-local'),
               (SELECT count(*) FROM sync_tombstones WHERE workspace_id='workspace-local'),
               (SELECT count(*) FROM sync_inbox WHERE workspace_id='workspace-local'),
               (SELECT count(*) FROM sync_rebootstrap_journal WHERE workspace_id='workspace-local')",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap();
    let mut statement = database
        .store
        .raw_connection()
        .prepare(
            "SELECT device_id,read_through_server_revision,pinned_target_server_revision,
                    checkpoint_through_server_revision,anti_rollback_server_revision_floor,
                    anti_rollback_schema_version_floor,row_version,status
             FROM sync_reader_state WHERE workspace_id='workspace-local' ORDER BY device_id",
        )
        .unwrap();
    let reader_state = statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    RebootstrapFloorGuardOracle {
        proof: database.recovery_proof().unwrap(),
        evidence_counts,
        reader_state,
    }
}

#[derive(Debug, PartialEq, Eq)]
struct RebootstrapCorruptionOracle {
    row_digest: String,
    journal_count: i64,
    temp_checkpoint_table_count: i64,
    total_changes: u64,
    is_autocommit: bool,
    database_bytes: Vec<u8>,
    sidecar_bytes: [Option<Vec<u8>>; 3],
}

fn rebootstrap_corruption_oracle(database: &BusinessDatabase) -> RebootstrapCorruptionOracle {
    let connection = database.store.raw_connection();
    let database_path: String = connection
        .query_row(
            "SELECT file FROM pragma_database_list WHERE name='main'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let database_path = std::path::PathBuf::from(database_path);
    let read_sidecar = |suffix: &str| {
        let mut path = database_path.as_os_str().to_os_string();
        path.push(suffix);
        match std::fs::read(path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => panic!("failed to snapshot SQLite sidecar: {error}"),
        }
    };
    RebootstrapCorruptionOracle {
        row_digest: complete_database_digest(connection).unwrap(),
        journal_count: connection
            .query_row("SELECT count(*) FROM sync_rebootstrap_journal", [], |row| {
                row.get(0)
            })
            .unwrap(),
        temp_checkpoint_table_count: connection
            .query_row(
                "SELECT count(*) FROM sqlite_temp_schema
                 WHERE type='table' AND name='temp_checkpoint_entities'",
                [],
                |row| row.get(0),
            )
            .unwrap(),
        total_changes: connection.total_changes(),
        is_autocommit: connection.is_autocommit(),
        database_bytes: std::fs::read(&database_path).unwrap(),
        sidecar_bytes: [
            read_sidecar("-wal"),
            read_sidecar("-shm"),
            read_sidecar("-journal"),
        ],
    }
}

fn relax_strict_table_for_corruption(connection: &Connection, table_name: &str) {
    let schema_version: i64 = connection
        .pragma_query_value(None, "schema_version", |row| row.get(0))
        .unwrap();
    let table_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?1",
            [table_name],
            |row| row.get(0),
        )
        .unwrap();
    let relaxed_table_sql = table_sql
        .strip_suffix(" STRICT")
        .expect("fixture table remains STRICT");
    connection
        .execute_batch("PRAGMA writable_schema=ON;")
        .unwrap();
    connection
        .execute(
            "UPDATE sqlite_schema SET sql=?1 WHERE type='table' AND name=?2",
            params![relaxed_table_sql, table_name],
        )
        .unwrap();
    connection
        .execute_batch("PRAGMA writable_schema=OFF;")
        .unwrap();
    connection
        .pragma_update(None, "schema_version", schema_version + 1)
        .unwrap();
}

/// A signed page of the given mutations, numbered from `from + 1`.
fn generation_page(from: u64, mutations: Vec<serde_json::Value>) -> String {
    let through = from + mutations.len() as u64;
    let mutations = mutations
        .into_iter()
        .enumerate()
        .map(|(index, mut mutation)| {
            mutation["serverRevision"] = serde_json::json!(from + index as u64 + 1);
            mutation
        })
        .collect::<Vec<_>>();
    let mut page = serde_json::json!({
        "schemaVersion": 3, "workspaceId": "workspace-local",
        "fromServerRevisionExclusive": from, "throughServerRevisionInclusive": through,
        "mutations": mutations, "returnedThroughServerRevision": through,
        "nextCursor": null, "pageDigest": "A".repeat(43),
    });
    page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());
    page.to_string()
}

fn generation_mutation(
    mutation_id: &str,
    entity_id: &str,
    generation: u64,
    base: u64,
    changed_fields: &serde_json::Value,
) -> serde_json::Value {
    let delete = changed_fields.as_array().is_some_and(Vec::is_empty);
    let mut mutation = serde_json::json!({
        "schemaVersion": 3, "mutationId": mutation_id, "workspaceId": "workspace-local",
        "workspaceSchemaVersion": 1, "entityType": "domain_asset", "entityId": entity_id,
        "entityGeneration": generation, "operationKind": if delete { "delete" } else { "upsert" },
        "baseServerRevision": base, "changedFields": changed_fields,
        "sourceDeviceId": "other-device", "activeLeaseEpoch": 1,
        "deviceMutationSequence": 1, "serverRevision": 0,
    });
    if delete {
        mutation["deletedAt"] = serde_json::json!("2026-08-28T00:00:00Z");
    }
    mutation
}

fn re_add_mutation(generation: u64, deleted_revision: u64, base: u64) -> serde_json::Value {
    let mut mutation = generation_mutation(
        "other-re-add",
        "remote.test",
        generation,
        base,
        &serde_json::json!([{"fieldPath": "note", "value": "second life"}]),
    );
    mutation["reAddsDeletedRevision"] = serde_json::json!(deleted_revision);
    mutation
}

/// `remote.test` created with a note and a tag at revision 1 and deleted at revision 2, both by
/// another device, so its local tombstone is replicated and settled.
fn database_with_replicated_tombstone() -> TestDatabase {
    let mut database = database();
    let page = generation_page(
        0,
        vec![
            generation_mutation(
                "other-create",
                "remote.test",
                1,
                0,
                &serde_json::json!([
                    {"fieldPath": "note", "value": "first life"},
                    {"fieldPath": "tags", "value": ["old"]},
                ]),
            ),
            generation_mutation("other-delete", "remote.test", 1, 1, &serde_json::json!([])),
        ],
    );
    database
        .apply_sync_page_v2("reader-local", &page, "confirm-1")
        .unwrap();
    database
}

fn re_add_footprint(database: &TestDatabase) -> (i64, i64, i64, i64, i64) {
    database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT count(*) FROM sync_inbox),
                    (SELECT count(*) FROM sync_tombstones),
                    (SELECT count(*) FROM sync_domain_asset_re_adds),
                    (SELECT max(entity_generation) FROM domain_assets),
                    (SELECT applied_through_server_revision FROM active_workspace_metadata)",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap()
}

fn re_add_write(note: &str) -> DomainAssetWrite {
    DomainAssetWrite {
        entity_id: "remote.test".to_owned(),
        note: Some(note.to_owned()),
        portfolio_id: None,
        tags: vec!["fresh".to_owned()],
        target_price: None,
    }
}

/// Claims every deliverable Outbox row and acknowledges them at consecutive revisions.
fn acknowledge_claimed(database: &mut TestDatabase, first_revision: u64) -> Vec<String> {
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-ack",
            "2026-08-28T01:00:00Z",
            "2026-08-28T01:01:00Z",
            256,
        )
        .unwrap();
    let acknowledgements = claimed
        .iter()
        .zip(first_revision..)
        .map(|(claim, server_revision)| SyncMutationAcknowledgement {
            mutation_id: claim.mutation_id.clone(),
            source_device_id: claim.source_device_id.clone(),
            active_lease_epoch: claim.active_lease_epoch,
            device_mutation_sequence: claim.device_mutation_sequence,
            delivery_attempt_fence: claim.delivery_attempt_fence,
            wire_mutation_digest: claim.wire_mutation_digest.clone(),
            server_revision,
        })
        .collect::<Vec<_>>();
    database
        .acknowledge_sync_batch_v2_guarded(
            "owner-ack",
            &acknowledgements,
            "2026-08-28T01:00:30Z",
            |_| Ok(()),
        )
        .unwrap();
    claimed
        .into_iter()
        .map(|claim| claim.wire_mutation_json)
        .collect()
}

fn local_re_add_state(database: &TestDatabase) -> (i64, Option<String>, i64, i64, i64) {
    database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT entity_generation FROM domain_assets WHERE entity_id='remote.test'),
                    (SELECT deleted_at FROM domain_assets WHERE entity_id='remote.test'),
                    (SELECT count(*) FROM sync_tombstones),
                    (SELECT count(*) FROM sync_domain_asset_provisional_re_adds),
                    (SELECT count(*) FROM sync_domain_asset_re_adds WHERE origin='local')",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap()
}

fn own_asset_version(database: &TestDatabase) -> u64 {
    database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .asset_version
}

fn own_create(database: &mut TestDatabase) {
    database
        .create_domain_asset_guarded(
            "create-local",
            "device-local",
            1,
            TIMESTAMP,
            &re_add_write("first"),
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
}

fn own_delete(database: &mut TestDatabase, mutation_id: &str) {
    let version = own_asset_version(database);
    database
        .delete_domain_asset(
            mutation_id,
            version,
            "device-local",
            1,
            "2026-08-28T00:05:00Z",
            "remote.test",
            true,
        )
        .unwrap();
}

fn own_re_add(database: &mut TestDatabase) {
    database
        .re_add_domain_asset(
            "re-add-local",
            "device-local",
            1,
            "2026-08-28T00:06:00Z",
            &re_add_write("again"),
        )
        .unwrap();
}

/// Pulls the given wire mutations, as Cloud returns them, from revision `from + 1`.
fn pull_echoes(
    database: &mut TestDatabase,
    from: u64,
    wires: &[String],
    token: &str,
) -> Result<(), BusinessDatabaseError> {
    let mutations = wires
        .iter()
        .map(|wire| {
            // Cloud returns the claimed wire with the workspace and revision it assigned.
            let mut mutation: serde_json::Value = serde_json::from_str(wire).unwrap();
            mutation["workspaceId"] = serde_json::json!("workspace-local");
            mutation
        })
        .collect();
    database.apply_sync_page_v2("reader-local", &generation_page(from, mutations), token)
}

/// (generation, deleted, tombstones, applied revision, inbox rows not `applied`)
fn echo_state(database: &TestDatabase) -> (i64, bool, i64, i64, i64) {
    database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT entity_generation FROM domain_assets WHERE entity_id='remote.test'),
                    (SELECT deleted_at IS NOT NULL FROM domain_assets
                     WHERE entity_id='remote.test'),
                    (SELECT count(*) FROM sync_tombstones),
                    (SELECT applied_through_server_revision FROM active_workspace_metadata),
                    (SELECT count(*) FROM sync_inbox WHERE state!='applied')",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap()
}

fn own_edit(database: &mut TestDatabase, mutation_id: &str, note: &str) {
    let version = own_asset_version(database);
    database
        .edit_domain_asset(
            mutation_id,
            version,
            "device-local",
            1,
            "2026-08-28T00:04:00Z",
            &re_add_write(note),
            true,
        )
        .unwrap();
}

/// (open conflict rows, conflicted Inbox rows, pending field versions, local note)
fn own_edit_echo_state(database: &TestDatabase) -> (i64, i64, i64, Option<String>) {
    let counts: (i64, i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT count(*) FROM sync_conflicts),
                    (SELECT count(*) FROM sync_inbox WHERE state='conflicted'),
                    (SELECT count(*) FROM domain_asset_field_versions
                     WHERE sync_state='pending')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let note = database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .note;
    (counts.0, counts.1, counts.2, note)
}

fn journal_link(proof: &DatabaseRecoveryProof, sequence: u64) -> RebootstrapJournalLink {
    RebootstrapJournalLink {
        journal_id: format!("journal-{sequence}"),
        slot_id: if sequence.is_multiple_of(2) {
            RebootstrapSlotId::B
        } else {
            RebootstrapSlotId::A
        },
        publication_sequence: sequence,
        manifest_digest: proof.row_digest.clone(),
        authority_digest: "a".repeat(64),
        floor_digest: "b".repeat(64),
        binding_digest: "c".repeat(64),
    }
}

#[cfg(unix)]
fn prepared_read_only_recovery_candidate() -> (
    tempfile::TempDir,
    std::path::PathBuf,
    LocalDatabaseKey,
    DatabaseRecoveryProof,
    RebootstrapJournalLink,
) {
    let directory = tempdir().unwrap();
    let path = directory.path().join("candidate.db");
    let key = LocalDatabaseKey::from_bytes([0x6c; 32]);
    let (proof, link) = {
        let mut database = BusinessDatabase::open(&path, &key, "workspace-recovery").unwrap();
        let result = database
            .install_rebootstrap_checkpoint(
                &[DomainAssetWrite {
                    entity_id: "recovered.test".to_owned(),
                    note: Some("durable".to_owned()),
                    portfolio_id: None,
                    tags: vec!["recovery".to_owned()],
                    target_price: None,
                }],
                7,
                "device-recovery",
                |proof| Ok(journal_link(proof, 1)),
            )
            .unwrap();
        database.prepare_rebootstrap_publication().unwrap();
        assert_eq!(database.recovery_proof().unwrap(), result.0);
        result
    };
    (directory, path, key, proof, link)
}

#[cfg(unix)]
fn recovery_candidate_file_state(path: &Path) -> ([u8; 32], u64, std::time::SystemTime, [bool; 3]) {
    let bytes = std::fs::read(path).unwrap();
    let metadata = std::fs::metadata(path).unwrap();
    let file_name = path.file_name().unwrap().to_string_lossy();
    let parent = path.parent().unwrap();
    (
        Sha256::digest(bytes).into(),
        metadata.len(),
        metadata.modified().unwrap(),
        [
            parent.join(format!("{file_name}-wal")).exists(),
            parent.join(format!("{file_name}-shm")).exists(),
            parent.join(format!("{file_name}-journal")).exists(),
        ],
    )
}

fn install_generations(
    database: &mut TestDatabase,
    assets: &[RebootstrapAsset],
    tombstones: &[RebootstrapTombstone],
    checkpoint_revision: u64,
) -> Result<(), BusinessDatabaseError> {
    // Each installation publishes its own journal entry.
    let publication: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) + 1 FROM sync_rebootstrap_journal",
            [],
            |row| row.get(0),
        )
        .unwrap();
    database
        .install_rebootstrap_plan_with_generations_guarded(
            assets,
            tombstones,
            checkpoint_revision,
            "reader-local",
            &[],
            |proof| Ok(journal_link(proof, u64::try_from(publication).unwrap())),
            || Ok(()),
        )
        .map(|_| ())
}

fn remote_tombstone(generation: u64, deleted_server_revision: u64) -> RebootstrapTombstone {
    RebootstrapTombstone {
        entity_id: "remote.test".to_owned(),
        entity_generation: generation,
        deleted_server_revision,
        deleted_at: "2026-11-14T00:00:00Z".to_owned(),
    }
}

/// Everything an installation could write for `remote.test`, plus the recovery proof.
type RemoteFootprint = (
    DatabaseRecoveryProof,
    (i64, Option<String>, i64, i64, i64),
    i64,
);

fn remote_footprint(database: &TestDatabase) -> RemoteFootprint {
    let outbox: i64 = database
        .store
        .raw_connection()
        .query_row("SELECT count(*) FROM sync_outbox", [], |row| row.get(0))
        .unwrap();
    (
        database.recovery_proof().unwrap(),
        local_re_add_state(database),
        outbox,
    )
}

fn advances(database: &TestDatabase) -> Vec<(i64, i64, i64)> {
    let connection = database.store.raw_connection();
    let mut statement = connection
        .prepare(
            "SELECT from_generation, to_generation, checkpoint_server_revision
             FROM sync_domain_asset_checkpoint_advances ORDER BY from_generation",
        )
        .unwrap();
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// The generation, deletion and tombstone (generation, revision) of `remote.test`.
fn remote_generation(database: &TestDatabase) -> (i64, bool, Option<(i64, i64)>) {
    let connection = database.store.raw_connection();
    let (generation, deleted): (i64, Option<String>) = connection
        .query_row(
            "SELECT entity_generation, deleted_at FROM domain_assets WHERE entity_id='remote.test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let tombstone = connection
        .query_row(
            "SELECT entity_generation, deleted_server_revision FROM sync_tombstones
             WHERE entity_id='remote.test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .unwrap();
    (generation, deleted.is_some(), tombstone)
}

mod asset_lifecycle;
mod checkpoint;
mod providers;
mod reads;
mod sellerhub;
mod sync;
mod transactions;
