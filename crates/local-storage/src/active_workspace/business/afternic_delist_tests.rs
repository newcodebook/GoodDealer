use super::*;
use crate::LocalDatabaseKey;
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
    let running = claim(&mut db, work);
    db.begin_device_handoff_barrier("switch", 1, AT, || Ok(()))
        .unwrap();
    assert!(db.require_afternic_delist_write_open().is_err());
    assert!(db.recheck_afternic_delist_work(&running).is_ok());
    db.reconcile_afternic_delist(&running, None, AT, || Ok(()))
        .unwrap();
    assert!(db.has_unexported_provider_handoff_facts().unwrap());
}
