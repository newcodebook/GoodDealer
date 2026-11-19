use super::*;
use crate::LocalDatabaseKey;
const AT: &str = "2026-11-19T00:00:00Z";
const LATER: &str = "2026-11-19T00:01:00Z";
fn listing(domain: &str) -> DesktopAfternicListingObservation {
    DesktopAfternicListingObservation {
        domain: domain.into(),
        status: "ACTIVE".into(),
        buynow_price: Some(100_000_000),
        floor_price: Some(0),
        minbid_price: Some(20_000_000),
        hidden: Some(false),
        created_at: AT.into(),
        updated_at: AT.into(),
    }
}
fn fixture() -> (tempfile::TempDir, BusinessDatabase, AfternicConnectionSeed) {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let mut db = BusinessDatabase::open(
        &tmp.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    let seed = db
        .prepare_afternic_connection("Afternic", &"a".repeat(64), AT, || Ok(()))
        .unwrap();
    db.import_afternic_inventory(
        &seed,
        &[listing("example.test"), listing("other.test")],
        "device-local",
        1,
        AT,
        || Ok(()),
    )
    .unwrap();
    db.create_domain_asset_guarded(
        "manual-create",
        "device-local",
        1,
        AT,
        &super::super::DomainAssetWrite {
            entity_id: "create.test".into(),
            note: None,
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        },
        true,
        |_| Ok(()),
        |(), _| Ok(()),
    )
    .unwrap();
    let seed = db.afternic_connection_seed(&seed.connection_id).unwrap();
    (tmp, db, seed)
}
fn request(
    seed: &AfternicConnectionSeed,
    action: &str,
    domain: &str,
) -> DesktopAfternicListingWritePreviewRequest {
    serde_json::from_value(if action == "create" {serde_json::json!({"schemaVersion":1,"connectionId":seed.connection_id,"action":action,"items":[{"domain":domain,"values":{"buynowPriceMicroUsd":0,"floorPriceMicroUsd":0,"minbidPriceMicroUsd":20_000_000,"hidden":false}}]})} else {serde_json::json!({"schemaVersion":1,"connectionId":seed.connection_id,"action":action,"items":[{"domain":domain,"patch":{"buynowPriceMicroUsd":0,"hidden":false}}]})}).unwrap()
}
fn preview(
    db: &mut BusinessDatabase,
    seed: &AfternicConnectionSeed,
    action: &str,
    domain: &str,
) -> DesktopAfternicListingWritePlan {
    db.preview_afternic_listing_write_with_time(
        seed,
        &request(seed, action, domain),
        AT,
        AT,
        || Ok(()),
    )
    .unwrap()
}
fn approve(db: &mut BusinessDatabase, p: &DesktopAfternicListingWritePlan) {
    let (e, mut signer) = execution_evidence::test_context(&db.workspace_id, AT);
    db.approve_afternic_listing_write_with_evidence(
        &p.plan_ref,
        &p.plan_hash,
        AT,
        &e,
        &mut signer,
        || Ok(()),
    )
    .unwrap();
}
fn next(db: &mut BusinessDatabase, at: &str) -> Option<AfternicListingWriteWorkSeed> {
    let (e, mut signer) = execution_evidence::test_context(&db.workspace_id, at);
    db.next_afternic_listing_write_work_with_evidence(at, true, &e, &mut signer, || Ok(()))
        .unwrap()
}
fn claim(
    db: &mut BusinessDatabase,
    w: &AfternicListingWriteWorkSeed,
    o: Option<&DesktopAfternicListingObservation>,
) -> Result<bool> {
    let (e, mut signer) = execution_evidence::test_context(&db.workspace_id, AT);
    db.claim_afternic_listing_write_with_evidence(w, o, AT, &e, &mut signer, || Ok(()))
}
fn reconcile(
    db: &mut BusinessDatabase,
    w: &AfternicListingWriteWorkSeed,
    o: Option<&DesktopAfternicListingObservation>,
    at: &str,
) -> Result<()> {
    let (e, mut signer) = execution_evidence::test_context(&db.workspace_id, at);
    db.reconcile_afternic_listing_write_with_evidence(w, o, at, &e, &mut signer, || Ok(()))
}
fn count(db: &BusinessDatabase, table: &str) -> i64 {
    db.store
        .raw_connection()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
#[test]
fn listing_write_patch_rejects_null_duplicates_unknown_and_invalid_money() {
    for wire in [
        r#"{"hidden":null}"#,
        r#"{"hidden":false,"hidden":true}"#,
        r#"{"cookie":"x"}"#,
        r#"{"buynowPriceMicroUsd":1.5}"#,
    ] {
        assert!(
            serde_json::from_str::<DesktopAfternicListingWritePatch>(wire).is_err(),
            "{wire}"
        );
    }
    for wire in [
        "{}",
        r#"{"minbidPriceMicroUsd":0}"#,
        r#"{"floorPriceMicroUsd":1}"#,
        r#"{"buynowPriceMicroUsd":50000000000000}"#,
    ] {
        assert!(
            serde_json::from_str::<DesktopAfternicListingWritePatch>(wire)
                .unwrap()
                .validate()
                .is_err()
        );
    }
    let p: DesktopAfternicListingWritePatch =
        serde_json::from_str(r#"{"buynowPriceMicroUsd":0,"hidden":false}"#).unwrap();
    p.validate().unwrap();
    assert_eq!(
        encode(&p).unwrap(),
        r#"{"buynowPriceMicroUsd":0,"hidden":false}"#
    );
    assert!(
        serde_json::from_str::<DesktopAfternicListingWriteStatusRequest>(r#"{"schemaVersion":1}"#)
            .is_err()
    );
}
#[test]
fn listing_write_create_persists_once_and_pending_ownership_never_finishes_parent() {
    let (tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "create", "create.test");
    assert!(p.items[0].before.is_none());
    approve(&mut db, &p);
    approve(&mut db, &p);
    assert_eq!(count(&db, "operations"), 1);
    let w = next(&mut db, AT).unwrap();
    assert_eq!(w.kind, DesktopAfternicListingWriteWorkKind::Preflight);
    assert!(claim(&mut db, &w, None).unwrap());
    assert!(claim(&mut db, &w, None).is_err());
    drop(db);
    let mut db = BusinessDatabase::open(
        &tmp.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    let w = next(&mut db, AT).unwrap();
    assert_eq!(w.kind, DesktopAfternicListingWriteWorkKind::Reconcile);
    let mut o = listing("create.test");
    o.buynow_price = Some(0);
    o.status = "OWNERSHIP_UNVERIFIED".into();
    reconcile(&mut db, &w, Some(&o), AT).unwrap();
    let plan = db.afternic_listing_write_plan(&p.plan_ref, AT).unwrap();
    assert_eq!(plan.state, "executing");
    assert_eq!(plan.items[0].state, "pending_verification");
    assert!(plan.items[0].fields_matched);
    assert!(next(&mut db, AT).is_none());
    let w = next(&mut db, LATER).unwrap();
    assert_eq!(w.kind, DesktopAfternicListingWriteWorkKind::Reconcile);
    o.status = "ACTIVE".into();
    reconcile(&mut db, &w, Some(&o), LATER).unwrap();
    let plan = db.afternic_listing_write_plan(&p.plan_ref, LATER).unwrap();
    assert_eq!(plan.state, "completed");
    assert_eq!(plan.items[0].state, "applied");
    assert_eq!(count(&db, "device_execution_fact_outbox"), 1);
    assert_eq!(count(&db, "afternic_listing_write_reconciliations"), 2);
    assert_eq!(count(&db, "afternic_listing_item_authorizations"), 1);
    let status = db
        .afternic_listing_write_status(Some(&p.plan_ref), LATER)
        .unwrap();
    assert_eq!(status.plans[0].applied, 1);
    let batch = db.read_batch_operations(0, 20).unwrap();
    assert_eq!(batch.window.rows[0].title, "Afternic listing creation");
    assert_eq!(batch.window.rows[0].results.as_ref().unwrap().succeeded, 1);
    assert_eq!(
        batch.window.rows[0]
            .results
            .as_ref()
            .unwrap()
            .outcome_unknown,
        0
    );
}
#[test]
fn listing_write_update_freezes_selected_fields_and_refuses_drift() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "update", "example.test");
    assert_eq!(p.items[0].changes.floor_price_micro_usd, None);
    approve(&mut db, &p);
    let w = next(&mut db, AT).unwrap();
    let mut o = listing("example.test");
    o.floor_price = Some(1_000_000);
    assert!(!claim(&mut db, &w, Some(&o)).unwrap());
    assert_eq!(count(&db, "device_execution_fact_outbox"), 0);
    let p = db.afternic_listing_write_plan(&p.plan_ref, AT).unwrap();
    assert_eq!(p.items[0].reason.as_deref(), Some("precondition_changed"));
    assert_eq!(p.state, "partially_failed");
}
#[test]
fn listing_write_update_unknown_absence_and_unchanged_never_reissue_patch() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "update", "example.test");
    approve(&mut db, &p);
    let w = next(&mut db, AT).unwrap();
    assert!(claim(&mut db, &w, Some(&listing("example.test"))).unwrap());
    let w = next(&mut db, AT).unwrap();
    reconcile(&mut db, &w, None, AT).unwrap();
    assert!(next(&mut db, AT).is_none());
    let w = next(&mut db, LATER).unwrap();
    assert_eq!(w.kind, DesktopAfternicListingWriteWorkKind::Reconcile);
    reconcile(&mut db, &w, Some(&listing("example.test")), LATER).unwrap();
    assert_eq!(count(&db, "device_execution_fact_outbox"), 1);
    assert_eq!(
        db.afternic_listing_write_plan(&p.plan_ref, LATER)
            .unwrap()
            .state,
        "executing"
    );
}
#[test]
fn listing_write_preflight_create_existing_update_absent_are_terminal_without_dispatch() {
    for action in ["create", "update"] {
        let (_tmp, mut db, seed) = fixture();
        let domain = if action == "create" {
            "create.test"
        } else {
            "example.test"
        };
        let p = preview(&mut db, &seed, action, domain);
        approve(&mut db, &p);
        let w = next(&mut db, AT).unwrap();
        let current = listing(domain);
        assert!(
            !claim(
                &mut db,
                &w,
                if action == "create" {
                    Some(&current)
                } else {
                    None
                }
            )
            .unwrap()
        );
        assert_eq!(count(&db, "device_execution_fact_outbox"), 0);
        assert_eq!(
            db.afternic_listing_write_plan(&p.plan_ref, AT)
                .unwrap()
                .items[0]
                .reason
                .as_deref(),
            Some(if action == "create" {
                "already_present"
            } else {
                "listing_absent"
            })
        );
    }
}
#[test]
fn listing_write_pending_statuses_and_blocked_results_remain_truthful() {
    for (status, expected) in [
        ("PENDING", "pending_provider"),
        ("ON_HOLD", "pending_provider"),
        ("INACTIVE", "pending_provider"),
        ("UNKNOWN", "pending_provider"),
        ("OWNERSHIP_REVIEW", "pending_verification"),
        ("SOLD", "conflict"),
        ("VERIFIED_OWNER_CONFLICT", "conflict"),
    ] {
        let (_tmp, mut db, seed) = fixture();
        let p = preview(&mut db, &seed, "update", "example.test");
        approve(&mut db, &p);
        let w = next(&mut db, AT).unwrap();
        assert!(claim(&mut db, &w, Some(&listing("example.test"))).unwrap());
        let w = next(&mut db, AT).unwrap();
        let mut o = listing("example.test");
        o.buynow_price = Some(0);
        o.status = status.into();
        reconcile(&mut db, &w, Some(&o), AT).unwrap();
        let item = &db
            .afternic_listing_write_plan(&p.plan_ref, AT)
            .unwrap()
            .items[0];
        assert_eq!(item.state, expected);
        assert!(item.fields_matched);
        assert_eq!(item.latest.as_ref().unwrap().provider_status, status);
    }
}
#[test]
fn listing_write_conflicts_with_unresolved_remove_in_both_directions() {
    for remove_first in [true, false] {
        let (_tmp, mut db, seed) = fixture();
        if remove_first {
            let p = db
                .preview_afternic_delist(&seed, &["example.test".into()], AT, || Ok(()))
                .unwrap();
            db.approve_afternic_delist(&p.plan_ref, &p.plan_hash, AT, || Ok(()))
                .unwrap();
            assert!(
                db.preview_afternic_listing_write_with_time(
                    &seed,
                    &request(&seed, "update", "example.test"),
                    AT,
                    AT,
                    || Ok(())
                )
                .is_err()
            );
        } else {
            let p = preview(&mut db, &seed, "update", "example.test");
            approve(&mut db, &p);
            assert!(
                db.preview_afternic_delist(&seed, &["example.test".into()], AT, || Ok(()))
                    .is_err()
            );
        }
    }
}
#[test]
fn listing_write_final_fence_rolls_back_fact_and_dispatch() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "create", "create.test");
    approve(&mut db, &p);
    let w = next(&mut db, AT).unwrap();
    let (e, mut signer) = execution_evidence::test_context(&db.workspace_id, AT);
    assert!(
        db.claim_afternic_listing_write_with_evidence(&w, None, AT, &e, &mut signer, || Err(
            BusinessDatabaseError::MutationStale
        ))
        .is_err()
    );
    assert_eq!(count(&db, "device_execution_fact_outbox"), 0);
    assert!(claim(&mut db, &w, None).unwrap());
}

fn predecessor_snapshot(source: &rusqlite::Connection) -> rusqlite::Connection {
    let old = crate::migrations::test_pre_listing_write_connection();
    let triggers: Vec<(String, String)> = old
        .prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let tables:Vec<String>=old.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='gooddealer_active_migrations'").unwrap().query_map([],|r|r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    // Load a real signed remove snapshot into the exact predecessor schema. Disabling triggers
    // here is fixture loading only; all production migrations run with their ordinary guards.
    old.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    for (name, _) in &triggers {
        old.execute_batch(&format!("DROP TRIGGER {name}")).unwrap();
    }
    for table in tables {
        let columns: Vec<String> = old
            .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let current = match table.as_str() {
            "afternic_delist_approvals" => "afternic_listing_approvals",
            "afternic_delist_item_authorizations" => "afternic_listing_item_authorizations",
            _ => &table,
        };
        let quoted = columns
            .iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(",");
        let mut query = source
            .prepare(&format!("SELECT {quoted} FROM {current}"))
            .unwrap();
        let rows = query
            .query_map([], |r| {
                (0..columns.len())
                    .map(|i| r.get::<_, rusqlite::types::Value>(i))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        old.execute(&format!("DELETE FROM {table}"), []).unwrap();
        let placeholders = vec!["?"; columns.len()].join(",");
        for row in rows {
            old.execute(
                &format!("INSERT INTO {table}({quoted}) VALUES({placeholders})"),
                rusqlite::params_from_iter(row),
            )
            .unwrap();
        }
    }
    for (_, sql) in triggers {
        old.execute_batch(&sql).unwrap();
    }
    old.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    old
}
#[test]
fn listing_write_migration_preserves_legacy_signed_bytes_and_foreign_keys() {
    let (_tmp, mut db, seed) = fixture();
    let plan = db
        .preview_afternic_delist(&seed, &["example.test".into()], AT, || Ok(()))
        .unwrap();
    db.approve_afternic_delist(&plan.plan_ref, &plan.plan_hash, AT, || Ok(()))
        .unwrap();
    let work = db
        .next_afternic_delist_work(AT, true, || Ok(()))
        .unwrap()
        .unwrap();
    db.claim_afternic_delist(&work, Some(&listing("example.test")), AT, || Ok(()))
        .unwrap();
    let source = db.store.raw_connection();
    let mut old = predecessor_snapshot(source);
    let bytes:Vec<(String,Vec<u8>,String)>=old.prepare("SELECT envelope_json,canonical_envelope,envelope_digest FROM device_execution_fact_outbox").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    let approval: String = old
        .query_row(
            "SELECT envelope_json FROM afternic_delist_item_authorizations",
            [],
            |r| r.get(0),
        )
        .unwrap();
    crate::migrations::run_active_migrations(&mut old).unwrap();
    crate::migrations::run_active_migrations(&mut old).unwrap();
    crate::active_workspace::portfolio::verify_active_manifest(&old).unwrap();
    let after:Vec<(String,Vec<u8>,String)>=old.prepare("SELECT envelope_json,canonical_envelope,envelope_digest FROM device_execution_fact_outbox").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(bytes, after);
    assert_eq!(
        approval,
        old.query_row(
            "SELECT envelope_json FROM afternic_listing_item_authorizations",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap()
    );
    assert_eq!(
        old.query_row("SELECT action FROM afternic_listing_approvals", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "remove"
    );
    assert_eq!(
        old.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    assert_eq!(old.query_row("SELECT count(*) FROM pragma_foreign_key_list('device_execution_fact_outbox') WHERE \"table\"='afternic_listing_item_authorizations'",[],|r|r.get::<_,i64>(0)).unwrap(),2);
}
#[test]
fn listing_write_result_commit_fence_rolls_back_binding_audit_and_outcome_together() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "create", "create.test");
    approve(&mut db, &p);
    let w = next(&mut db, AT).unwrap();
    assert!(claim(&mut db, &w, None).unwrap());
    let w = next(&mut db, AT).unwrap();
    let mut o = listing("create.test");
    o.buynow_price = Some(0);
    let bindings = count(&db, "domain_asset_provider_bindings");
    let audits = count(&db, "workspace_device_audit_outbox");
    let (e, mut signer) = execution_evidence::test_context(&db.workspace_id, AT);
    assert!(
        db.reconcile_afternic_listing_write_with_evidence(
            &w,
            Some(&o),
            AT,
            &e,
            &mut signer,
            || Err(BusinessDatabaseError::MutationStale)
        )
        .is_err()
    );
    assert_eq!(count(&db, "domain_asset_provider_bindings"), bindings);
    assert_eq!(count(&db, "workspace_device_audit_outbox"), audits);
    assert_eq!(count(&db, "afternic_listing_write_reconciliations"), 0);
    reconcile(&mut db, &w, Some(&o), AT).unwrap();
    assert_eq!(
        db.afternic_listing_write_plan(&p.plan_ref, AT)
            .unwrap()
            .state,
        "completed"
    );
}
#[test]
fn listing_write_changed_resource_identity_never_overwrites_binding() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "update", "example.test");
    approve(&mut db, &p);
    let w = next(&mut db, AT).unwrap();
    assert!(claim(&mut db, &w, Some(&listing("example.test"))).unwrap());
    let w = next(&mut db, AT).unwrap();
    let mut o = listing("example.test");
    o.created_at = LATER.into();
    o.buynow_price = Some(0);
    let count_before = count(&db, "marketplace_listing_observations");
    reconcile(&mut db, &w, Some(&o), LATER).unwrap();
    assert_eq!(count(&db, "marketplace_listing_observations"), count_before);
    assert_eq!(
        db.afternic_listing_write_plan(&p.plan_ref, LATER)
            .unwrap()
            .items[0]
            .reason
            .as_deref(),
        Some("precondition_changed")
    );
}

#[test]
fn listing_write_unknown_cannot_be_bypassed_by_new_binding_or_delist() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "update", "example.test");
    approve(&mut db, &p);
    let w = next(&mut db, AT).unwrap();
    assert!(claim(&mut db, &w, Some(&listing("example.test"))).unwrap());
    let w = next(&mut db, AT).unwrap();
    reconcile(&mut db, &w, None, AT).unwrap();
    db.store.fixture_connection().execute("UPDATE domain_asset_provider_bindings SET validation_status='detached' WHERE entity_id='example.test'",[]).unwrap();
    db.import_afternic_inventory(
        &seed,
        &[listing("example.test")],
        "device-local",
        1,
        LATER,
        || Ok(()),
    )
    .unwrap();
    assert!(next(&mut db, LATER).is_none());
    assert!(
        db.preview_afternic_listing_write_with_time(
            &seed,
            &request(&seed, "update", "example.test"),
            LATER,
            LATER,
            || Ok(())
        )
        .is_err()
    );
    assert!(
        db.preview_afternic_delist(&seed, &["example.test".into()], LATER, || Ok(()))
            .is_err()
    );
    assert_eq!(count(&db, "operation_attempts"), 1);
}
#[test]
fn listing_write_new_request_rejects_duplicate_targets_missing_fields_and_expiry() {
    let (_tmp, mut db, seed) = fixture();
    let mut wire = serde_json::json!({"schemaVersion":1,"connectionId":seed.connection_id,"action":"create","items":[{"domain":"create.test","values":{"buynowPriceMicroUsd":0,"floorPriceMicroUsd":0,"minbidPriceMicroUsd":20_000_000}}]});
    assert!(
        serde_json::from_value::<DesktopAfternicListingWritePreviewRequest>(wire.clone()).is_err()
    );
    wire["items"][0]["values"]["hidden"] = serde_json::json!(false);
    let duplicate = wire["items"][0].clone();
    wire["items"].as_array_mut().unwrap().push(duplicate);
    let request = serde_json::from_value(wire).unwrap();
    assert!(
        db.preview_afternic_listing_write_with_time(&seed, &request, AT, AT, || Ok(()))
            .is_err()
    );
    let p = preview(&mut db, &seed, "create", "create.test");
    let (e, mut signer) =
        execution_evidence::test_context(&db.workspace_id, "2026-11-19T00:15:00Z");
    assert!(
        db.approve_afternic_listing_write_with_evidence(
            &p.plan_ref,
            &p.plan_hash,
            AT,
            &e,
            &mut signer,
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(count(&db, "operations"), 0);
}

#[test]
fn listing_write_real_signed_streams_upload_and_drain_include_pending_provider() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, "update", "example.test");
    approve(&mut db, &p);
    let w = next(&mut db, AT).unwrap();
    assert!(claim(&mut db, &w, Some(&listing("example.test"))).unwrap());
    let w = next(&mut db, AT).unwrap();
    let mut o = listing("example.test");
    o.buynow_price = Some(0);
    o.status = "OWNERSHIP_REVIEW".into();
    reconcile(&mut db, &w, Some(&o), AT).unwrap();
    assert!(db.has_unexported_provider_handoff_facts().unwrap());
    db.begin_device_handoff_barrier("switch", 1, LATER, || Ok(()))
        .unwrap();
    assert_eq!(
        db.device_handoff_frozen_unresolved_count("device-test", 1)
            .unwrap(),
        1
    );
    let (context, _) = execution_evidence::test_context(&db.workspace_id, LATER);
    let mut uploaded = 0;
    while let Some(upload) = db.next_execution_evidence_upload(&context).unwrap() {
        db.record_execution_evidence_response(
            &context,
            &upload,
            &upload.test_accepted_response(LATER),
            || Ok(()),
        )
        .unwrap();
        uploaded += 1;
    }
    assert_eq!(uploaded, 4);
    assert!(!db.has_unexported_provider_handoff_facts().unwrap());
    let [fact, audit] = db
        .execution_evidence_drain_claims("device-test", 1)
        .unwrap()
        .unwrap();
    assert_eq!(fact.last_assigned_sequence, 1);
    assert_eq!(audit.last_assigned_sequence, 3);
}
