use super::super::DesktopExecutionEvidenceStream::{DeviceAudit, ExecutionFact};
use super::*;
use crate::LocalDatabaseKey;
use base64::Engine as _;
use sha2::Digest as _;
const AT: &str = "2026-11-19T00:00:00Z";
const LATER: &str = "2026-11-19T00:01:00Z";
fn listing(domain: &str) -> DesktopAfternicListingObservation {
    DesktopAfternicListingObservation {
        domain: domain.into(),
        status: "ACTIVE".into(),
        buynow_price: Some(100_000_000),
        floor_price: None,
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
    let seed = db.afternic_connection_seed(&seed.connection_id).unwrap();
    (tmp, db, seed)
}
fn preview(
    db: &mut BusinessDatabase,
    seed: &AfternicConnectionSeed,
    domains: &[&str],
) -> DesktopAfternicDelistPlan {
    db.preview_afternic_delist(
        seed,
        &domains.iter().map(ToString::to_string).collect::<Vec<_>>(),
        AT,
        || Ok(()),
    )
    .unwrap()
}
fn approve(db: &mut BusinessDatabase, p: &DesktopAfternicDelistPlan) {
    db.approve_afternic_delist(&p.plan_ref, &p.plan_hash, AT, || Ok(()))
        .unwrap();
}
fn next(db: &mut BusinessDatabase, at: &str) -> AfternicDelistWorkSeed {
    db.next_afternic_delist_work(at, true, || Ok(()))
        .unwrap()
        .unwrap()
}
fn claim(db: &mut BusinessDatabase, mut work: AfternicDelistWorkSeed) -> AfternicDelistWorkSeed {
    let current = work.frozen.listing.clone();
    assert!(
        db.claim_afternic_delist(&work, Some(&current), AT, || Ok(()))
            .unwrap()
    );
    work.kind = DesktopAfternicDelistWorkKind::Reconcile;
    work
}
fn count(db: &BusinessDatabase, table: &str) -> i64 {
    db.store
        .raw_connection()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn afternic_delist_superseded_inventory_requires_a_new_preview_before_approval() {
    let (_tmp, mut db, seed) = fixture();
    let plan = preview(&mut db, &seed, &["example.test"]);
    db.import_afternic_inventory(&seed, &[], "device-local", 1, AT, || Ok(()))
        .unwrap();
    assert!(matches!(
        db.approve_afternic_delist(&plan.plan_ref, &plan.plan_hash, AT, || Ok(())),
        Err(BusinessDatabaseError::MutationStale)
    ));
    assert!(matches!(
        db.preview_afternic_delist(&seed, &["example.test".into()], AT, || Ok(())),
        Err(BusinessDatabaseError::MutationStale)
    ));
    assert_eq!(count(&db, "operation_attempts"), 0);
    assert_eq!(count(&db, "domain_asset_provider_bindings"), 2);
    db.import_afternic_inventory(
        &seed,
        &[listing("example.test")],
        "device-local",
        1,
        AT,
        || Ok(()),
    )
    .unwrap();
    // A refreshed inventory containing the same approved fact does not change the scope.
    approve(&mut db, &plan);
    assert_eq!(count(&db, "operation_attempts"), 1);
}

#[test]
fn afternic_delist_wire_rejects_unknown_and_missing_required_nullable() {
    assert!(
        serde_json::from_value::<DesktopAfternicDelistStatusRequest>(
            serde_json::json!({"schemaVersion":1})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<DesktopAfternicDelistStatusRequest>(
            serde_json::json!({"schemaVersion":1,"planRef":null,"cookie":"x"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<DesktopAfternicDelistStatusRequest>(
            serde_json::json!({"schemaVersion":1,"planRef":null})
        )
        .is_ok()
    );
    assert!(
        serde_json::from_value::<DesktopAfternicDelistPreviewRequest>(
            serde_json::json!({"schemaVersion":1,"connectionId":"x","domains":[],"action":"create"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<DesktopAfternicDelistApproveRequest>(
            serde_json::json!({"schemaVersion":1,"planRef":"x","planHash":"x","domains":[]})
        )
        .is_err()
    );
    assert!(
        serde_json::from_str::<DesktopAfternicDelistApproveRequest>(
            r#"{"schemaVersion":1,"schemaVersion":1,"planRef":"x","planHash":"x"}"#
        )
        .is_err()
    );
}
#[test]
fn afternic_delist_preview_freezes_latest_scan_and_rejects_duplicate_or_missing_targets() {
    let (_tmp, mut db, seed) = fixture();
    for names in [
        vec![],
        vec!["example.test".into(), "example.test".into()],
        vec!["missing.test".into()],
    ] {
        assert!(
            db.preview_afternic_delist(&seed, &names, AT, || Ok(()))
                .is_err()
        );
    }
    let plan = preview(&mut db, &seed, &["other.test", "example.test"]);
    assert_eq!(plan.items[0].domain, "example.test");
    assert_eq!(plan.items[0].observed_at, AT);
    assert_eq!(plan.state, "awaiting_approval");
    db.import_afternic_inventory(
        &seed,
        &[listing("other.test")],
        "device-local",
        1,
        LATER,
        || Ok(()),
    )
    .unwrap();
    assert!(
        db.preview_afternic_delist(&seed, &["example.test".into()], LATER, || Ok(()))
            .is_err()
    );
    assert!(
        db.approve_afternic_delist(
            &plan.plan_ref,
            &plan.plan_hash,
            "2026-11-19T00:15:00Z",
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(
        db.afternic_delist_plan(&plan.plan_ref, "2026-11-19T00:15:00Z")
            .unwrap()
            .state,
        "expired"
    );
}
#[test]
fn afternic_delist_approval_is_once_and_rejects_concurrent_plans_and_hash_changes() {
    let (_tmp, mut db, seed) = fixture();
    let first = preview(&mut db, &seed, &["example.test"]);
    let second = preview(&mut db, &seed, &["example.test"]);
    assert!(
        db.approve_afternic_delist(&first.plan_ref, &"b".repeat(64), AT, || Ok(()))
            .is_err()
    );
    approve(&mut db, &first);
    approve(&mut db, &first);
    assert_eq!(count(&db, "operations"), 1);
    assert_eq!(count(&db, "operation_attempts"), 1);
    assert!(
        db.approve_afternic_delist(&second.plan_ref, &second.plan_hash, AT, || Ok(()))
            .is_err()
    );
    assert!(
        db.store
            .raw_connection()
            .execute(
                "UPDATE operation_plans SET phase='approved' WHERE plan_id=?1",
                [&first.plan_ref]
            )
            .is_err()
    );
    assert!(
        db.store
            .raw_connection()
            .execute(
                "UPDATE operation_plan_items SET new_value_json='{}' WHERE plan_id=?1",
                [&first.plan_ref]
            )
            .is_err()
    );
    assert!(db.store.raw_connection().execute("INSERT INTO operations SELECT workspace_id,'duplicate',plan_id,'duplicate',phase,requested_at,started_at,completed_at,local_commit_sequence FROM operations",[]).is_err());
}
#[test]
fn afternic_delist_claim_is_atomic_and_preflight_conflict_never_runs() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test", "other.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    assert!(
        db.claim_afternic_delist(&work, Some(&work.frozen.listing), AT, || Err(
            BusinessDatabaseError::MutationStale
        ))
        .is_err()
    );
    assert_eq!(
        next(&mut db, AT).kind,
        DesktopAfternicDelistWorkKind::Preflight
    );
    let duplicate = work.clone();
    let running = claim(&mut db, work);
    assert!(
        db.claim_afternic_delist(&duplicate, Some(&duplicate.frozen.listing), AT, || Ok(()))
            .is_err()
    );
    db.reconcile_afternic_delist(&running, None, AT, || Ok(()))
        .unwrap();
    let other = next(&mut db, AT);
    let mut changed = other.frozen.listing.clone();
    changed.hidden = Some(true);
    assert!(
        !db.claim_afternic_delist(&other, Some(&changed), AT, || Ok(()))
            .unwrap()
    );
    let result = db.afternic_delist_plan(&p.plan_ref, AT).unwrap();
    assert_eq!(result.state, "partially_failed");
    assert_eq!(result.items[0].state, "succeeded");
    assert_eq!(result.items[1].state, "conflict");
    assert_eq!(
        result.items[1].reason.as_deref(),
        Some("precondition_changed")
    );
}
#[test]
fn afternic_delist_running_reopens_as_reconcile_and_unknown_read_backoff_never_requeues() {
    let (tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let _claim = claim(&mut db, work);
    drop(db);
    let mut db = BusinessDatabase::open(
        &tmp.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    let recovered = next(&mut db, AT);
    assert_eq!(recovered.kind, DesktopAfternicDelistWorkKind::Reconcile);
    assert!(
        db.claim_afternic_delist(&recovered, None, AT, || Ok(()))
            .is_err()
    );
    db.defer_afternic_delist_read(&recovered, None, AT, || Ok(()))
        .unwrap();
    assert!(
        db.next_afternic_delist_work("2026-11-19T00:00:29Z", true, || Ok(()))
            .unwrap()
            .is_none()
    );
    let work = next(&mut db, "2026-11-19T00:00:30Z");
    db.reconcile_afternic_delist(
        &work,
        Some(&work.frozen.listing),
        "2026-11-19T00:00:30Z",
        || Ok(()),
    )
    .unwrap();
    assert!(
        db.next_afternic_delist_work(LATER, true, || Ok(()))
            .unwrap()
            .is_none()
    );
    let work = next(&mut db, "2026-11-19T00:01:30Z");
    db.reconcile_afternic_delist(&work, None, "2026-11-19T00:01:30Z", || Ok(()))
        .unwrap();
    assert_eq!(
        db.afternic_delist_plan(&p.plan_ref, LATER).unwrap().state,
        "completed"
    );
    let c = db.store.raw_connection();
    assert_eq!(
        c.query_row("SELECT status FROM operation_attempts", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "outcome_unknown"
    );
    assert_eq!(count(&db, "operation_attempts"), 1);
    assert_eq!(count(&db, "afternic_delist_reconciliations"), 3);
    assert!(
        c.execute(
            "UPDATE operation_attempts SET status='queued',started_at=NULL,completed_at=NULL",
            []
        )
        .is_err()
    );
    assert!(
        c.execute("DELETE FROM afternic_delist_reconciliations", [])
            .is_err()
    );
    assert_eq!(
        c.query_row(
            "SELECT effective_status FROM afternic_delist_effective_attempts",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "succeeded"
    );
    let batch = db.read_batch_operations(0, 20).unwrap();
    assert_eq!(batch.window.rows[0].results.as_ref().unwrap().succeeded, 1);
}
#[test]
fn afternic_delist_absence_and_detach_are_atomic_fresh_and_superseded_by_new_incarnation() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    assert!(
        db.claim_afternic_delist(&work, None, AT, || Err(
            BusinessDatabaseError::MutationStale
        ))
        .is_err()
    );
    assert_eq!(count(&db, "afternic_delist_reconciliations"), 0);
    assert!(
        !db.claim_afternic_delist(&work, None, AT, || Ok(()))
            .unwrap()
    );
    let fact:(String,bool)=db.store.raw_connection().query_row("SELECT listing_status,binding_fresh FROM marketplace_listing_observations_read_facts WHERE entity_id='example.test' AND connection_rank=1",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(fact, ("unlisted".into(), true));
    db.import_afternic_inventory(
        &seed,
        &[listing("example.test")],
        "device-local",
        1,
        AT,
        || Ok(()),
    )
    .unwrap();
    let fact:(String,bool)=db.store.raw_connection().query_row("SELECT listing_status,binding_fresh FROM marketplace_listing_observations_read_facts WHERE entity_id='example.test' AND connection_rank=1",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(fact, ("active".into(), true));
    assert!(!db.store.raw_connection().query_row("SELECT binding_fresh FROM marketplace_listing_observations_read_facts WHERE entity_id='example.test' AND listing_status='unlisted'",[],|r|r.get::<_,bool>(0)).unwrap());
}
#[test]
fn afternic_delist_unknown_cannot_be_bypassed_by_detach_and_new_binding() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let running = claim(&mut db, work);
    db.defer_afternic_delist_read(&running, None, AT, || Ok(()))
        .unwrap();
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
    assert!(
        db.next_afternic_delist_work(LATER, true, || Ok(()))
            .unwrap()
            .is_none()
    );
    assert_eq!(
        db.afternic_delist_plan(&p.plan_ref, LATER).unwrap().state,
        "partially_failed"
    );
    assert!(
        db.preview_afternic_delist(&seed, &["example.test".into()], LATER, || Ok(()))
            .is_err()
    );
    assert_eq!(count(&db, "operation_attempts"), 1);
}
#[test]
fn afternic_delist_final_fence_and_revocation_preserve_unresolved_attempt() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let running = claim(&mut db, work);
    assert!(
        db.reconcile_afternic_delist(&running, None, AT, || Err(
            BusinessDatabaseError::MutationStale
        ))
        .is_err()
    );
    assert_eq!(count(&db, "afternic_delist_reconciliations"), 0);
    db.revoke_afternic_connection(&seed, AT, || Ok(())).unwrap();
    assert!(
        db.reconcile_afternic_delist(&running, None, AT, || Ok(()))
            .is_err()
    );
    assert!(
        db.next_afternic_delist_work(AT, true, || Ok(()))
            .unwrap()
            .is_none()
    );
    assert_eq!(
        db.afternic_delist_plan(&p.plan_ref, AT).unwrap().items[0]
            .reason
            .as_deref(),
        Some("connection_changed")
    );
    assert_eq!(
        db.store
            .raw_connection()
            .query_row("SELECT status FROM operation_attempts", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "outcome_unknown"
    );
}

#[test]
fn afternic_delist_approval_rejects_mutated_execution_columns_and_forged_source() {
    for mutation in [
        "entity_id='other.test'",
        "capability='cloudflare:dns:observe'",
        "new_value_json='{\"action\":\"create\"}'",
        "execution_mode='manual'",
        "inclusion_status='excluded'",
        "risk_level='high'",
        "ordinal=7",
        "precondition_json=json_set(precondition_json,'$.scanId','11111111-1111-4111-8111-111111111111')",
    ] {
        let (_tmp, mut db, seed) = fixture();
        let p = preview(&mut db, &seed, &["example.test"]);
        db.store
            .fixture_connection()
            .execute(
                &format!("UPDATE operation_plan_items SET {mutation} WHERE plan_id=?1"),
                [&p.plan_ref],
            )
            .unwrap();
        assert!(
            db.approve_afternic_delist(&p.plan_ref, &p.plan_hash, AT, || Ok(()))
                .is_err(),
            "{mutation}"
        );
        assert_eq!(count(&db, "operations"), 0);
    }
}

#[test]
fn afternic_delist_foreign_workspace_and_wrong_observation_cannot_settle_a_claim() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    assert!(
        db.claim_afternic_delist(&work, Some(&listing("other.test")), AT, || Ok(()))
            .is_err()
    );
    let running = claim(&mut db, work);
    let other_dir = crate::test_tempdir::tempdir().unwrap();
    let mut other = BusinessDatabase::open(
        &other_dir.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x78; 32]),
        "workspace-other",
    )
    .unwrap();
    assert!(other.recheck_afternic_delist_work(&running).is_err());
    assert!(
        other
            .reconcile_afternic_delist(&running, None, AT, || Ok(()))
            .is_err()
    );
    assert!(
        db.reconcile_afternic_delist(&running, Some(&listing("other.test")), AT, || Ok(()))
            .is_err()
    );
    assert_eq!(count(&db, "afternic_delist_reconciliations"), 0);
}

#[test]
fn afternic_delist_batch_counts_distinguish_resolved_and_unresolved_unknown_attempts() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test", "other.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let first = claim(&mut db, work);
    db.defer_afternic_delist_read(&first, None, AT, || Ok(()))
        .unwrap();
    let work = next(&mut db, AT);
    let second = claim(&mut db, work);
    db.defer_afternic_delist_read(&second, None, AT, || Ok(()))
        .unwrap();
    let work = next(&mut db, LATER);
    db.reconcile_afternic_delist(&work, None, LATER, || Ok(()))
        .unwrap();
    assert_eq!(
        db.store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM operation_attempts WHERE status='outcome_unknown'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    let view = db.read_batch_operations(0, 20).unwrap();
    let results = view.window.rows[0].results.as_ref().unwrap();
    assert_eq!(results.succeeded, 1);
    assert_eq!(results.outcome_unknown, 1);
    assert_eq!(
        view.window.rows[0].operation_phase.as_deref(),
        Some("running")
    );
}

#[test]
fn afternic_delist_honors_long_server_read_backoff_without_early_retry() {
    for (seconds, expected, before) in [
        (172_800, "2026-11-21T00:00:00Z", "2026-11-20T23:59:59Z"),
        (u32::MAX, "2162-12-26T06:28:15Z", "2162-12-26T06:28:14Z"),
    ] {
        let (_tmp, mut db, seed) = fixture();
        let p = preview(&mut db, &seed, &["example.test"]);
        approve(&mut db, &p);
        let work = next(&mut db, AT);
        let running = claim(&mut db, work);
        db.defer_afternic_delist_read(&running, Some(seconds), AT, || Ok(()))
            .unwrap();
        let view = db.afternic_delist_plan(&p.plan_ref, AT).unwrap();
        assert_eq!(view.items[0].retry_at.as_deref(), Some(expected));
        assert!(
            db.next_afternic_delist_work(before, true, || Ok(()))
                .unwrap()
                .is_none()
        );
        let due = next(&mut db, expected);
        assert_eq!(due.kind, DesktopAfternicDelistWorkKind::Reconcile);
        assert_eq!(count(&db, "operation_attempts"), 1);
    }
}

#[test]
fn afternic_delist_handoff_refuses_every_persisted_attempt_state_after_reopen() {
    for phase in [
        "queued",
        "running",
        "outcome_unknown",
        "succeeded",
        "failed_final",
    ] {
        let (tmp, mut db, seed) = fixture();
        assert!(!db.has_unexported_provider_handoff_facts().unwrap());
        let p = preview(&mut db, &seed, &["example.test"]);
        approve(&mut db, &p);
        if phase != "queued" {
            let work = next(&mut db, AT);
            if phase == "failed_final" {
                let mut changed = work.frozen.listing.clone();
                changed.hidden = Some(true);
                assert!(
                    !db.claim_afternic_delist(&work, Some(&changed), AT, || Ok(()))
                        .unwrap()
                );
            } else {
                let work = claim(&mut db, work);
                if phase == "outcome_unknown" {
                    db.defer_afternic_delist_read(&work, None, AT, || Ok(()))
                        .unwrap();
                } else if phase == "succeeded" {
                    db.reconcile_afternic_delist(&work, None, AT, || Ok(()))
                        .unwrap();
                }
            }
        }
        assert_eq!(
            db.store
                .raw_connection()
                .query_row("SELECT status FROM operation_attempts", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            phase
        );
        assert!(db.has_unexported_provider_handoff_facts().unwrap());
        drop(db);
        let db = BusinessDatabase::open(
            &tmp.path().join("workspace.db"),
            &LocalDatabaseKey::from_bytes([0x77; 32]),
            "workspace-local",
        )
        .unwrap();
        assert!(
            db.has_unexported_provider_handoff_facts().unwrap(),
            "{phase}"
        );
    }
}
#[test]
fn afternic_delist_handoff_barrier_closes_transaction_and_sql_dispatch() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    db.begin_device_handoff_barrier("switch", 1, AT, || Ok(()))
        .unwrap();
    assert!(
        db.preview_afternic_delist(&seed, &["other.test".into()], AT, || Ok(()))
            .is_err()
    );
    assert_eq!(count(&db, "operation_plans"), 1);
    assert!(
        db.approve_afternic_delist(&p.plan_ref, &p.plan_hash, AT, || Ok(()))
            .is_err()
    );
    assert_eq!(count(&db, "operation_attempts"), 0);
    db.clear_device_handoff_barrier("switch", || Ok(()))
        .unwrap();
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    db.begin_device_handoff_barrier("switch", 1, AT, || Ok(()))
        .unwrap();
    assert!(db.recheck_afternic_delist_work(&work).is_err());
    assert!(
        db.claim_afternic_delist(&work, Some(&work.frozen.listing), AT, || Ok(()))
            .is_err()
    );
    let error = db
        .store
        .fixture_connection()
        .execute(
            "UPDATE operation_attempts SET status='running',started_at=?1",
            [AT],
        )
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("device handoff closes Afternic dispatch")
    );
    assert!(
        db.next_afternic_delist_work(AT, true, || Ok(()))
            .unwrap()
            .is_none()
    );
    db.clear_device_handoff_barrier("switch", || Ok(()))
        .unwrap();
    assert!(db.recheck_afternic_delist_work(&work).is_err());
    let fresh = next(&mut db, AT);
    let running = claim(&mut db, fresh);
    db.begin_device_handoff_barrier("switch", 1, AT, || Ok(()))
        .unwrap();
    assert!(db.require_afternic_delist_write_open().is_err());
    assert!(db.recheck_afternic_delist_work(&running).is_err());
    assert!(
        db.reconcile_afternic_delist(&running, None, AT, || Ok(()))
            .is_err()
    );
    assert!(db.has_unexported_provider_handoff_facts().unwrap());
}

#[test]
fn afternic_delist_signed_approval_and_claim_rollback_together_on_signer_failure() {
    for fail_at in 0..3 {
        let (_tmp, mut db, seed) = fixture();
        let p = preview(&mut db, &seed, &["example.test", "other.test"]);
        let (context, mut real) = execution_evidence::test_context("workspace-local", AT);
        let mut calls = 0;
        let mut failing = |purpose, bytes: &[u8]| {
            let current = calls;
            calls += 1;
            if current == fail_at {
                Err(BusinessDatabaseError::MutationStale)
            } else {
                real(purpose, bytes)
            }
        };
        assert!(
            db.approve_afternic_delist_with_evidence(
                &p.plan_ref,
                &p.plan_hash,
                AT,
                &context,
                &mut failing,
                || Ok(())
            )
            .is_err()
        );
        for table in [
            "operations",
            "operation_attempts",
            "afternic_listing_approvals",
            "afternic_listing_item_authorizations",
            "workspace_device_audit_outbox",
            "execution_evidence_stream_heads",
        ] {
            assert_eq!(count(&db, table), 0, "{table}");
        }
        assert_eq!(
            db.afternic_delist_plan(&p.plan_ref, AT).unwrap().state,
            "awaiting_approval"
        );
        approve(&mut db, &p);
        let mut refuse = |_, _: &[u8]| Err(BusinessDatabaseError::MutationStale);
        assert!(
            db.approve_afternic_delist_with_evidence(
                &p.plan_ref,
                &p.plan_hash,
                AT,
                &context,
                &mut refuse,
                || Ok(())
            )
            .is_ok()
        );
        assert_eq!(count(&db, "workspace_device_audit_outbox"), 1);
        let work = next(&mut db, AT);
        assert!(
            db.claim_afternic_delist_with_evidence(
                &work,
                Some(&work.frozen.listing),
                AT,
                &context,
                &mut refuse,
                || Ok(())
            )
            .is_err()
        );
        assert_eq!(count(&db, "workspace_device_audit_outbox"), 1);
        assert_eq!(count(&db, "device_execution_fact_outbox"), 0);
        let _claimed = claim(&mut db, work);
        assert_eq!(count(&db, "workspace_device_audit_outbox"), 2);
        assert_eq!(count(&db, "device_execution_fact_outbox"), 1);
    }
}

#[test]
fn afternic_delist_claim_evidence_rejects_foreign_epoch_key_origin_and_bad_signatures() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    for field in ["device", "lease", "credential", "key", "origin"] {
        let (mut context, mut signer) = execution_evidence::test_context("workspace-local", AT);
        match field {
            "device" => context.source_device_id = "foreign".into(),
            "lease" => context.active_lease_epoch += 1,
            "credential" => context.credential_epoch += 1,
            "key" => context.signing_key_version += 1,
            _ => {
                context.source_installation_digest = base64::Engine::encode(
                    &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                    [9; 32],
                );
            }
        }
        assert!(
            db.claim_afternic_delist_with_evidence(
                &work,
                Some(&work.frozen.listing),
                AT,
                &context,
                &mut signer,
                || Ok(())
            )
            .is_err(),
            "{field}"
        );
    }
    let (context, _) = execution_evidence::test_context("workspace-local", AT);
    let mut forged = |_, _: &[u8]| Ok([0; 64]);
    assert!(
        db.claim_afternic_delist_with_evidence(
            &work,
            Some(&work.frozen.listing),
            AT,
            &context,
            &mut forged,
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(count(&db, "device_execution_fact_outbox"), 0);
    assert_eq!(count(&db, "workspace_device_audit_outbox"), 1);
    let claimed = claim(&mut db, work);
    db.require_afternic_delist_signed_claim(&claimed, &context)
        .unwrap();
    let wire: String = db
        .store
        .raw_connection()
        .query_row(
            "SELECT envelope_json FROM device_execution_fact_outbox",
            [],
            |r| r.get(0),
        )
        .unwrap();
    for forbidden in [
        "example.test",
        &seed.connection_id,
        "credentialGeneration",
        "cookie",
        "accountName",
    ] {
        assert!(!wire.contains(forbidden));
    }
    let event: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(event["eventType"], "afternic_delist_dispatch_claimed");
    assert_eq!(event["evidenceLevel"], "durable_local_claim");
    assert_eq!(event["requestStartBoundary"], event["occurredAt"]);
    for table in [
        "afternic_listing_approvals",
        "afternic_listing_item_authorizations",
        "workspace_device_audit_outbox",
        "device_execution_fact_outbox",
    ] {
        assert!(
            db.store
                .fixture_connection()
                .execute(&format!("DELETE FROM {table}"), [])
                .is_err()
        );
    }
}

#[test]
fn afternic_delist_preview_expiry_uses_authenticated_time_even_when_business_clock_stalls() {
    let (_tmp, mut db, seed) = fixture();
    let p = db
        .preview_afternic_delist_with_time(&seed, &["example.test".into()], AT, AT, || Ok(()))
        .unwrap();
    let (context, mut signer) =
        execution_evidence::test_context("workspace-local", "2026-11-19T00:15:00Z");
    assert!(
        db.approve_afternic_delist_with_evidence(
            &p.plan_ref,
            &p.plan_hash,
            AT,
            &context,
            &mut signer,
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(count(&db, "operations"), 0);
    assert_eq!(count(&db, "workspace_device_audit_outbox"), 0);
}

#[test]
fn afternic_delist_result_audit_failure_rolls_back_business_absence_and_retries_exact_fact() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let running = claim(&mut db, work);
    let (context, mut signer) = execution_evidence::test_context("workspace-local", LATER);
    let mut refuse = |_, _: &[u8]| Err(BusinessDatabaseError::MutationStale);
    assert!(
        db.reconcile_afternic_delist_with_evidence(
            &running,
            None,
            LATER,
            &context,
            &mut refuse,
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(count(&db, "workspace_device_audit_outbox"), 2);
    assert_eq!(count(&db, "afternic_delist_reconciliations"), 0);
    assert_eq!(count(&db, "operation_results"), 0);
    assert!(
        db.reconcile_afternic_delist_with_evidence(
            &running,
            None,
            LATER,
            &context,
            &mut signer,
            || Err(BusinessDatabaseError::MutationStale)
        )
        .is_err()
    );
    assert_eq!(count(&db, "workspace_device_audit_outbox"), 2);
    db.reconcile_afternic_delist_with_evidence(
        &running,
        None,
        LATER,
        &context,
        &mut signer,
        || Ok(()),
    )
    .unwrap();
    let event:String=db.store.raw_connection().query_row("SELECT a.envelope_json FROM afternic_delist_reconciliations r JOIN workspace_device_audit_outbox a ON a.workspace_id=r.workspace_id AND a.audit_event_id=r.audit_event_id",[],|r|r.get(0)).unwrap();
    let event: serde_json::Value = serde_json::from_str(&event).unwrap();
    assert_eq!(event["eventType"], "runtime_security_lifecycle");
    assert_eq!(event["authorizationSource"], "runtime_security_context");
    assert_eq!(event["occurredAt"], LATER);
    assert_eq!(event["payloadRedacted"]["outcome"], "absent");
    let (id, digest): (String, String) = db
        .store
        .raw_connection()
        .query_row(
            "SELECT execution_fact_id,envelope_digest FROM device_execution_fact_outbox",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(event["payloadRedacted"]["originalExecutionFactId"], id);
    assert_eq!(
        event["payloadRedacted"]["originalExecutionFactDigest"],
        digest
    );
    assert_eq!(count(&db, "device_execution_fact_outbox"), 1);
}
#[test]
fn afternic_delist_preflight_absence_is_signed_refusal_without_fabricated_execution() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    assert!(
        !db.claim_afternic_delist(&work, None, AT, || Ok(()))
            .unwrap()
    );
    assert_eq!(count(&db, "device_execution_fact_outbox"), 0);
    let wire: String = db
        .store
        .raw_connection()
        .query_row(
            "SELECT envelope_json FROM workspace_device_audit_outbox WHERE audit_sequence=2",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let event: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(event["payloadRedacted"]["stage"], "preflight_refused");
    assert_eq!(event["payloadRedacted"]["reason"], "already_absent");
    assert_eq!(
        db.afternic_delist_plan(&p.plan_ref, AT).unwrap().state,
        "completed"
    );
}
#[test]
fn afternic_delist_freeze_survives_reopen_and_cancel_requires_fresh_read() {
    let (tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let running = claim(&mut db, work);
    db.begin_device_handoff_barrier("freeze", 1, LATER, || Ok(()))
        .unwrap();
    let unresolved_count: i64 = db
        .store
        .raw_connection()
        .query_row(
            "SELECT frozen_unresolved_count FROM device_handoff_barriers",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(unresolved_count, 1);
    assert!(
        db.reconcile_afternic_delist(&running, None, LATER, || Ok(()))
            .is_err()
    );
    assert!(
        db.clear_device_handoff_barrier_for_source("freeze", "other-device", 1, || Ok(()))
            .is_err()
    );
    assert!(
        db.clear_device_handoff_barrier_for_source("freeze", "device-test", 2, || Ok(()))
            .is_err()
    );
    drop(db);
    let mut db = BusinessDatabase::open(
        &tmp.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    assert!(
        db.next_afternic_delist_work(LATER, true, || Ok(()))
            .unwrap()
            .is_none()
    );
    db.clear_device_handoff_barrier("freeze", || Ok(()))
        .unwrap();
    assert!(
        db.reconcile_afternic_delist(&running, None, LATER, || Ok(()))
            .is_err()
    );
    let fresh = next(&mut db, LATER);
    assert_eq!(fresh.kind, DesktopAfternicDelistWorkKind::Reconcile);
    db.reconcile_afternic_delist(&fresh, None, LATER, || Ok(()))
        .unwrap();
    assert_eq!(count(&db, "device_execution_fact_outbox"), 1);
}
#[test]
fn afternic_delist_new_epoch_get_references_old_fact_without_reopening_old_producer() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let old = claim(&mut db, work);
    db.begin_device_handoff_barrier("freeze", 1, LATER, || Ok(()))
        .unwrap();
    db.clear_left_over_device_handoff_barrier(2, || Ok(()))
        .unwrap();
    let (mut context, mut signer) = execution_evidence::test_context("workspace-local", LATER);
    context.active_lease_epoch = 2;
    assert!(
        db.reconcile_afternic_delist_with_evidence(
            &old,
            None,
            LATER,
            &context,
            &mut signer,
            || Ok(())
        )
        .is_err()
    );
    let fresh = db
        .next_afternic_delist_work_with_evidence(LATER, false, &context, &mut signer, || Ok(()))
        .unwrap()
        .unwrap();
    db.reconcile_afternic_delist_with_evidence(&fresh, None, LATER, &context, &mut signer, || {
        Ok(())
    })
    .unwrap();
    let (epoch,state):(i64,String)=db.store.raw_connection().query_row("SELECT active_lease_epoch,producer_state FROM execution_evidence_stream_heads WHERE stream='execution_fact' AND active_lease_epoch=1",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!((epoch, state), (1, "frozen".into()));
    let n:i64=db.store.raw_connection().query_row("SELECT count(*) FROM workspace_device_audit_outbox WHERE active_lease_epoch=2 AND json_extract(envelope_json,'$.payloadRedacted.stage')='reconciled'",[],|r|r.get(0)).unwrap();
    assert_eq!(n, 1);
}

fn accepted_upload(upload: &super::super::EvidenceUploadSeed) -> Vec<u8> {
    let body: serde_json::Value = serde_json::from_slice(&upload.request).unwrap();
    let (stream, event, id, sequence) = match upload.stream {
        super::super::DesktopExecutionEvidenceStream::DeviceAudit => (
            "device_audit",
            &body["event"],
            "auditEventId",
            "auditSequence",
        ),
        super::super::DesktopExecutionEvidenceStream::ExecutionFact => (
            "execution_fact",
            &body["fact"],
            "executionFactId",
            "executionFactSequence",
        ),
    };
    let domain = if stream == "device_audit" {
        "GOODDEALER-DEVICE-AUDIT-EVENT-V1"
    } else {
        "GOODDEALER-EXECUTION-FACT-V1"
    };
    let mut claims = event.clone();
    let signature = claims
        .as_object_mut()
        .unwrap()
        .remove("deviceSignature")
        .unwrap();
    let signature = signature.as_str().unwrap();
    let mut envelope = execution_evidence::evidence_transcript(domain, &claims).unwrap();
    envelope.extend(u32::try_from(signature.len()).unwrap().to_be_bytes());
    envelope.extend(signature.as_bytes());
    let digest =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(&envelope));
    serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"outcome":"accepted","receipt":{"schemaVersion":1,"stream":stream,"workspaceId":event["workspaceId"],"sourceDeviceId":event["sourceDeviceId"],"activeLeaseEpoch":event["activeLeaseEpoch"],"sequence":event[sequence],"eventId":event[id],"envelopeDigest":digest,"outcome":"accepted","classification":"current","receivedAt":LATER}})).unwrap()
}
#[test]
fn afternic_delist_delivery_orders_actual_dependencies_and_retries_exact_bytes_after_reopen() {
    let (tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let running = claim(&mut db, work);
    db.reconcile_afternic_delist(&running, None, LATER, || Ok(()))
        .unwrap();
    let (context, _) = execution_evidence::test_context("workspace-local", LATER);
    let original = db
        .next_execution_evidence_upload(&context)
        .unwrap()
        .unwrap();
    let exact = original.request.clone();
    drop(db);
    let mut db = BusinessDatabase::open(
        &tmp.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(
        db.next_execution_evidence_upload(&context)
            .unwrap()
            .unwrap()
            .request,
        exact
    );
    let mut stages = Vec::new();
    while let Some(upload) = db.next_execution_evidence_upload(&context).unwrap() {
        let value: serde_json::Value = serde_json::from_slice(&upload.request).unwrap();
        let event = if upload.stream == super::super::DesktopExecutionEvidenceStream::DeviceAudit {
            &value["event"]
        } else {
            &value["fact"]
        };
        stages.push((
            upload.stream,
            event["payloadRedacted"]["stage"]
                .as_str()
                .unwrap()
                .to_owned(),
        ));
        let response = accepted_upload(&upload);
        assert_eq!(
            db.record_execution_evidence_response(&context, &upload, &response, || Ok(()))
                .unwrap(),
            super::super::DesktopExecutionEvidenceDeliveryOutcome::Accepted
        );
        db.record_execution_evidence_response(&context, &upload, &response, || Ok(()))
            .unwrap();
    }
    assert_eq!(
        stages,
        vec![
            (DeviceAudit, "approved".into()),
            (DeviceAudit, "dispatch_claimed".into()),
            (ExecutionFact, "dispatch_claimed".into()),
            (DeviceAudit, "reconciled".into())
        ]
    );
    assert_eq!(count(&db, "execution_evidence_receipts"), 4);
}
#[test]
fn afternic_delist_delivery_rejects_foreign_receipts_and_final_fence_and_persists_quarantine() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let (context, _) = execution_evidence::test_context("workspace-local", LATER);
    let upload = db
        .next_execution_evidence_upload(&context)
        .unwrap()
        .unwrap();
    let valid = accepted_upload(&upload);
    for field in [
        "workspaceId",
        "sourceDeviceId",
        "eventId",
        "envelopeDigest",
        "activeLeaseEpoch",
        "sequence",
        "surprise",
    ] {
        let mut value: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        value["receipt"][field] = serde_json::json!("wrong");
        assert!(
            db.record_execution_evidence_response(
                &context,
                &upload,
                &serde_json::to_vec(&value).unwrap(),
                || Ok(())
            )
            .is_err(),
            "{field}"
        );
    }
    assert!(
        db.record_execution_evidence_response(&context, &upload, &valid, || Err(
            BusinessDatabaseError::MutationStale
        ))
        .is_err()
    );
    assert_eq!(count(&db, "execution_evidence_receipts"), 0);
    let pending = br#"{"schemaVersion":1,"outcome":"pending","code":"ORIGINAL_FACT_MISSING"}"#;
    assert_eq!(
        db.record_execution_evidence_response(&context, &upload, pending, || Ok(()))
            .unwrap(),
        super::super::DesktopExecutionEvidenceDeliveryOutcome::Pending
    );
    assert_eq!(count(&db, "execution_evidence_receipts"), 0);
    let mut value: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    value["outcome"] = serde_json::json!("quarantined");
    value["receipt"]["outcome"] = serde_json::json!("quarantined");
    value["receipt"]
        .as_object_mut()
        .unwrap()
        .remove("classification");
    value["receipt"]["reason"] = serde_json::json!("authorization");
    assert_eq!(
        db.record_execution_evidence_response(
            &context,
            &upload,
            &serde_json::to_vec(&value).unwrap(),
            || Ok(())
        )
        .unwrap(),
        super::super::DesktopExecutionEvidenceDeliveryOutcome::Quarantined
    );
    assert!(db.next_execution_evidence_upload(&context).is_err());
    assert!(
        db.record_execution_evidence_response(&context, &upload, &valid, || Ok(()))
            .is_err()
    );
}
#[test]
fn afternic_delist_delivery_freeze_allows_receipts_but_cancel_invalidates_old_upload_handle() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let (context, _) = execution_evidence::test_context("workspace-local", LATER);
    let upload = db
        .next_execution_evidence_upload(&context)
        .unwrap()
        .unwrap();
    let response = accepted_upload(&upload);
    db.begin_device_handoff_barrier("switch", 1, LATER, || Ok(()))
        .unwrap();
    let frozen = db
        .next_execution_evidence_upload(&context)
        .unwrap()
        .unwrap();
    assert_eq!(frozen.request, upload.request);
    db.clear_device_handoff_barrier("switch", || Ok(()))
        .unwrap();
    assert!(
        db.record_execution_evidence_response(&context, &upload, &response, || Ok(()))
            .is_err()
    );
    let fresh = db
        .next_execution_evidence_upload(&context)
        .unwrap()
        .unwrap();
    db.begin_device_handoff_barrier("switch", 1, LATER, || Ok(()))
        .unwrap();
    db.record_execution_evidence_response(&context, &fresh, &response, || Ok(()))
        .unwrap();
    assert_eq!(count(&db, "execution_evidence_receipts"), 1);
    let (mut imported, _) = execution_evidence::test_context("workspace-local", LATER);
    imported.source_installation_digest =
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, [9; 32]);
    assert!(
        db.next_execution_evidence_upload(&imported)
            .unwrap()
            .is_none()
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one real source lifecycle verifies pending tails, exact receipts, rollback and permanent sealing together"
)]
fn afternic_delist_real_stream_tails_require_exact_receipts_and_success_seals_atomically() {
    let (_tmp, mut db, seed) = fixture();
    let p = preview(&mut db, &seed, &["example.test"]);
    approve(&mut db, &p);
    let work = next(&mut db, AT);
    let _running = claim(&mut db, work);
    let (context, _) = execution_evidence::test_context("workspace-local", LATER);
    assert!(
        db.execution_evidence_drain_claims("device-test", 1)
            .unwrap()
            .is_none()
    );
    db.begin_device_handoff_barrier("switch", 1, LATER, || Ok(()))
        .unwrap();
    assert!(
        db.execution_evidence_drain_claims("device-test", 1)
            .unwrap()
            .is_none()
    );
    while let Some(upload) = db.next_execution_evidence_upload(&context).unwrap() {
        db.record_execution_evidence_response(&context, &upload, &accepted_upload(&upload), || {
            Ok(())
        })
        .unwrap();
    }
    assert!(!db.has_unexported_provider_handoff_facts().unwrap());
    let [fact, audit] = db
        .execution_evidence_drain_claims("device-test", 1)
        .unwrap()
        .unwrap();
    assert_eq!(fact.last_assigned_sequence, 1);
    assert_eq!(audit.last_assigned_sequence, 2);
    assert_eq!(fact.contiguous_received_through, 1);
    assert_eq!(audit.contiguous_received_through, 2);
    assert_ne!(
        fact.rolling_digest,
        super::super::drain_claims::DrainStreamClaim::empty().rolling_digest
    );
    assert!(
        db.execution_evidence_drain_claims("foreign-device", 1)
            .unwrap()
            .is_none()
    );
    let attempt = super::super::NormalHandoffAttempt {
        request_id: "switch".into(),
        source_device_id: "device-test".into(),
        target_device_id: "target-device".into(),
        source_lease_epoch: 1,
        proof_id: "proof-id".into(),
        proof_digest: "A".repeat(43),
        issued_at: LATER.into(),
        expires_at: "2026-11-19T00:06:00Z".into(),
    };
    db.record_normal_handoff_attempt(&attempt, || Ok(()))
        .unwrap();
    let receipt = super::super::NormalHandoffReceipt {
        source_lease_epoch: 1,
        proof_id: attempt.proof_id.clone(),
        proof_digest: attempt.proof_digest.clone(),
        released_at: "2026-11-19T00:02:00Z".into(),
    };
    assert!(
        db.record_normal_handoff_receipt(
            "switch",
            "device-test",
            "target-device",
            &receipt,
            || Err(BusinessDatabaseError::MutationStale)
        )
        .is_err()
    );
    let count: i64 = db
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM execution_evidence_stream_heads WHERE producer_state='frozen'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
    db.record_normal_handoff_receipt(
        "switch",
        "device-test",
        "target-device",
        &receipt,
        || Ok(()),
    )
    .unwrap();
    assert!(
        db.clear_device_handoff_barrier("switch", || Ok(()))
            .is_err()
    );
    let count: i64 = db
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM execution_evidence_stream_heads WHERE producer_state='sealed'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
    assert!(
        db.store
            .fixture_connection()
            .execute(
                "UPDATE execution_evidence_stream_heads SET producer_state='open'",
                []
            )
            .is_err()
    );
}

#[test]
fn afternic_delist_legacy_barrier_can_cancel_without_inventing_source_history() {
    let (_tmp, mut db, _seed) = fixture();
    db.store.fixture_connection().execute("INSERT INTO device_handoff_barriers(workspace_id,device_switch_request_id,began_at,active_lease_epoch) VALUES('workspace-local','legacy',?1,1)",[AT]).unwrap();
    db.clear_device_handoff_barrier_for_source("legacy", "device-test", 1, || Ok(()))
        .unwrap();
    assert!(db.device_handoff_barrier().unwrap().is_none());
    assert_eq!(count(&db, "execution_evidence_stream_heads"), 0);
}
