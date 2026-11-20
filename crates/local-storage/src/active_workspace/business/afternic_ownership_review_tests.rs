use super::*;
use crate::LocalDatabaseKey;
const AT: &str = "2026-11-19T00:00:00Z";
const DOMAIN: &str = "review.test";
struct Fixture {
    dir: tempfile::TempDir,
    db: BusinessDatabase,
    plan: String,
    item: String,
    frozen: serde_json::Value,
}
fn fixture() -> Fixture {
    let dir = crate::test_tempdir::tempdir().unwrap();
    let mut db = BusinessDatabase::open(
        &dir.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    let seed = db
        .prepare_afternic_connection("Review", &"a".repeat(64), AT, || Ok(()))
        .unwrap();
    let listing = DesktopAfternicListingObservation {
        domain: DOMAIN.into(),
        status: "OWNERSHIP_REVIEW".into(),
        buynow_price: Some(100_000_000),
        floor_price: Some(0),
        minbid_price: Some(20_000_000),
        hidden: Some(false),
        created_at: AT.into(),
        updated_at: AT.into(),
    };
    db.import_afternic_inventory(&seed, &[listing], "device-local", 1, AT, || Ok(()))
        .unwrap();
    let seed = db.afternic_connection_seed(&seed.connection_id).unwrap();
    let request=serde_json::from_value(serde_json::json!({"schemaVersion":1,"connectionId":seed.connection_id,"action":"update","items":[{"domain":DOMAIN,"patch":{"hidden":false}}]})).unwrap();
    let p = db
        .preview_afternic_listing_write_with_time(&seed, &request, AT, AT, || Ok(()))
        .unwrap();
    let c = db.store.raw_connection();
    let (item, wire): (String, String) = c
        .query_row(
            "SELECT item_id,precondition_json FROM operation_plan_items WHERE plan_id=?1",
            [&p.plan_ref],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let mut frozen: serde_json::Value = serde_json::from_str(&wire).unwrap();
    frozen["schemaVersion"] = 2.into();
    frozen["action"] = "reactivate_ownership_review".into();
    frozen["credentialPublicProof"] = seed.credential_public_proof.into();
    frozen["parentItemId"] = serde_json::Value::Null;
    frozen["parentRequestDigest"] = serde_json::Value::Null;
    frozen["triggerStatus"] = "OWNERSHIP_REVIEW".into();
    frozen["maxDispatches"] = 1.into();
    frozen["minimumIntervalSeconds"] = 86400.into();
    c.execute(
        "UPDATE operation_plan_items SET precondition_json=?1,new_value_json=?2 WHERE plan_id=?3",
        params![
            frozen.to_string(),
            serde_json::json!({"action":"reactivate_ownership_review"}).to_string(),
            p.plan_ref
        ],
    )
    .unwrap();
    Fixture {
        dir,
        db,
        plan: p.plan_ref,
        item,
        frozen,
    }
}
fn insert_scope(f: &Fixture) -> rusqlite::Result<usize> {
    f.db.store.raw_connection().execute("INSERT INTO afternic_ownership_review_items(workspace_id,plan_id,item_id,domain,connection_id,connection_incarnation_id,credential_generation,credential_public_proof,entity_generation,parent_item_id,parent_request_digest,binding_digest,binding_generation) SELECT workspace_id,plan_id,item_id,entity_id,connection_id,json_extract(precondition_json,'$.connectionIncarnationId'),json_extract(precondition_json,'$.credentialGeneration'),json_extract(precondition_json,'$.credentialPublicProof'),json_extract(precondition_json,'$.entityGeneration'),json_extract(precondition_json,'$.parentItemId'),json_extract(precondition_json,'$.parentRequestDigest'),json_extract(precondition_json,'$.bindingDigest'),json_extract(precondition_json,'$.bindingGeneration') FROM operation_plan_items WHERE workspace_id=?1 AND plan_id=?2 AND item_id=?3",params![f.db.workspace_id,f.plan,f.item])
}
fn count(f: &Fixture, table: &str) -> i64 {
    f.db.store
        .raw_connection()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
#[test]
fn ownership_review_frozen_scope_is_retained_in_actual_sqlcipher_and_cannot_change() {
    let f = fixture();
    insert_scope(&f).unwrap();
    assert!(
        f.db.store
            .raw_connection()
            .execute(
                "UPDATE afternic_ownership_review_items SET domain='other.test'",
                []
            )
            .is_err()
    );
    assert!(
        f.db.store
            .raw_connection()
            .execute("DELETE FROM afternic_ownership_review_items", [])
            .is_err()
    );
    assert!(insert_scope(&f).is_err());
    let path = f.dir.path().join("workspace.db");
    let plan = f.plan.clone();
    drop(f.db);
    let db = BusinessDatabase::open(
        &path,
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    let saved: String = db
        .store
        .raw_connection()
        .query_row(
            "SELECT domain FROM afternic_ownership_review_items WHERE plan_id=?1",
            [plan],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(saved, DOMAIN);
    assert!(
        !std::fs::read(path)
            .unwrap()
            .windows(DOMAIN.len())
            .any(|bytes| bytes == DOMAIN.as_bytes())
    );
}
#[test]
fn ownership_review_scope_rejects_wrong_action_missing_nullable_and_credential_drift() {
    let f = fixture();
    let c = f.db.store.raw_connection();
    for field in [
        "schemaVersion",
        "action",
        "domain",
        "connectionId",
        "connectionIncarnationId",
        "credentialGeneration",
        "credentialPublicProof",
        "entityGeneration",
        "parentItemId",
        "parentRequestDigest",
        "bindingDigest",
        "bindingGeneration",
        "triggerStatus",
        "maxDispatches",
        "minimumIntervalSeconds",
    ] {
        c.execute_batch("SAVEPOINT invalid_scope").unwrap();
        let mut changed = f.frozen.clone();
        changed.as_object_mut().unwrap().remove(field);
        c.execute(
            "UPDATE operation_plan_items SET precondition_json=?1 WHERE item_id=?2",
            params![changed.to_string(), f.item],
        )
        .unwrap();
        assert!(insert_scope(&f).is_err(), "missing {field}");
        c.execute_batch("ROLLBACK TO invalid_scope; RELEASE invalid_scope")
            .unwrap();
    }
    for (field, value) in [
        ("action", serde_json::json!("update")),
        ("triggerStatus", serde_json::json!("OWNERSHIP_UNVERIFIED")),
        ("maxDispatches", serde_json::json!(2)),
        ("minimumIntervalSeconds", serde_json::json!(86399)),
        ("credentialGeneration", serde_json::json!(2)),
        ("credentialPublicProof", serde_json::json!("b".repeat(64))),
        ("connectionIncarnationId", serde_json::json!("foreign")),
        ("entityGeneration", serde_json::json!(999)),
    ] {
        c.execute_batch("SAVEPOINT invalid_scope").unwrap();
        let mut changed = f.frozen.clone();
        changed[field] = value;
        c.execute(
            "UPDATE operation_plan_items SET precondition_json=?1 WHERE item_id=?2",
            params![changed.to_string(), f.item],
        )
        .unwrap();
        assert!(insert_scope(&f).is_err(), "wrong {field}");
        c.execute_batch("ROLLBACK TO invalid_scope; RELEASE invalid_scope")
            .unwrap();
    }
    assert_eq!(count(&f, "afternic_ownership_review_items"), 0);
}
#[test]
fn ownership_review_scope_rejects_self_parent_and_cross_domain_parent() {
    let f = fixture();
    let c = f.db.store.raw_connection();
    let mut frozen = f.frozen.clone();
    frozen["parentItemId"] = f.item.clone().into();
    frozen["parentRequestDigest"] = "a".repeat(64).into();
    c.execute(
        "UPDATE operation_plan_items SET precondition_json=?1 WHERE item_id=?2",
        params![frozen.to_string(), f.item],
    )
    .unwrap();
    assert!(insert_scope(&f).is_err());
    frozen["parentItemId"] = "11111111-1111-4111-8111-111111111111".into();
    c.execute(
        "UPDATE operation_plan_items SET precondition_json=?1 WHERE item_id=?2",
        params![frozen.to_string(), f.item],
    )
    .unwrap();
    assert!(insert_scope(&f).is_err());
}
#[test]
fn ownership_review_scope_failure_rolls_back_with_owning_transaction() {
    let f = fixture();
    let c = f.db.store.raw_connection();
    c.execute_batch("BEGIN IMMEDIATE").unwrap();
    insert_scope(&f).unwrap();
    assert_eq!(count(&f, "afternic_ownership_review_items"), 1);
    c.execute_batch("ROLLBACK").unwrap();
    assert_eq!(count(&f, "afternic_ownership_review_items"), 0);
}
#[test]
fn ownership_review_unsigned_claim_and_result_cannot_enter_the_original_writer() {
    let f = fixture();
    insert_scope(&f).unwrap();
    let c = f.db.store.raw_connection();
    assert!(c.execute("INSERT INTO afternic_ownership_review_claims(workspace_id,operation_id,plan_id,item_id,attempt_number,attempt_id,domain,connection_id,resource_binding_digest,binding_generation,resource_binding_evidence_digest,preflight_observation_evidence_digest,listing_observation_id,preflight_observation_digest,preflight_observed_at,claimed_at,retry_not_before,execution_fact_id,audit_event_id) SELECT workspace_id,'unsigned-operation',plan_id,item_id,1,'unsigned-attempt',domain,connection_id,binding_digest,binding_generation,?1,?1,'unsigned-observation',binding_digest,?2,?2,'2026-11-20T00:00:00Z','unsigned-fact','unsigned-audit' FROM afternic_ownership_review_items",params!["a".repeat(43),AT]).is_err());
    assert!(c.execute("INSERT INTO afternic_ownership_review_reconciliations(workspace_id,operation_id,plan_id,item_id,attempt_number,sequence,outcome,reason,observed_at,next_read_at,listing_observation_id,audit_event_id) VALUES(?1,'unsigned-operation',?2,?3,1,1,'read_failed','read_failed',?4,'2026-11-19T00:01:00Z',NULL,'unsigned-audit')",params![f.db.workspace_id,f.plan,f.item,AT]).is_err());
    assert_eq!(count(&f, "afternic_ownership_review_claims"), 0);
    assert_eq!(count(&f, "afternic_ownership_review_reconciliations"), 0);
    assert_eq!(count(&f, "device_execution_fact_outbox"), 0);
}

fn approve_review(f: &Fixture) -> String {
    use execution_evidence::{
        ListingPlanAction, ListingPlanApprovalTarget, record_listing_plan_approval,
    };
    insert_scope(f).unwrap();
    let c = f.db.store.raw_connection();
    let operation = afternic::random_id().unwrap();
    let request = "a".repeat(64);
    c.execute_batch("BEGIN IMMEDIATE").unwrap();
    c.execute(
        "UPDATE operation_plans SET phase='approved',approved_at=?1 WHERE plan_id=?2",
        params![AT, f.plan],
    )
    .unwrap();
    c.execute("INSERT INTO operations(workspace_id,operation_id,plan_id,idempotency_key,phase,requested_at,local_commit_sequence) VALUES(?1,?2,?3,?3,'queued',?4,1)",params![f.db.workspace_id,operation,f.plan,AT]).unwrap();
    c.execute("INSERT INTO operation_attempts(workspace_id,operation_id,plan_id,item_id,attempt_number,status,request_digest) VALUES(?1,?2,?3,?4,1,'queued',?5)",params![f.db.workspace_id,operation,f.plan,f.item,request]).unwrap();
    let hash: String = c
        .query_row(
            "SELECT plan_hash FROM operation_plans WHERE plan_id=?1",
            [&f.plan],
            |r| r.get(0),
        )
        .unwrap();
    let (e, mut signer) = execution_evidence::test_context(&f.db.workspace_id, AT);
    record_listing_plan_approval(
        c,
        &e,
        &f.plan,
        &operation,
        &hash,
        &[ListingPlanApprovalTarget {
            item_id: f.item.clone(),
            action: ListingPlanAction::ReactivateOwnershipReview,
            request_digest: request,
            parent_item_id: None,
            parent_request_digest: None,
        }],
        &mut signer,
    )
    .unwrap();
    c.execute(
        "UPDATE operation_plans SET phase='executing' WHERE plan_id=?1",
        [&f.plan],
    )
    .unwrap();
    c.execute(
        "UPDATE operations SET phase='running',started_at=?1 WHERE operation_id=?2",
        params![AT, operation],
    )
    .unwrap();
    c.execute_batch("COMMIT").unwrap();
    operation
}
fn claim_review(
    f: &Fixture,
    operation: &str,
    at: &str,
    commit: bool,
) -> Result<(), BusinessDatabaseError> {
    use execution_evidence::{OwnershipClaimDigests, record_listing_plan_claim};
    let c = f.db.store.raw_connection();
    c.execute_batch("BEGIN IMMEDIATE").unwrap();
    let result = (|| {
        let (binding,observation):(String,String)=c.query_row("SELECT binding_digest,json_extract(precondition_json,'$.observationDigest') FROM afternic_ownership_review_items r JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) WHERE r.plan_id=?1",[&f.plan],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        let (e, mut signer) = execution_evidence::test_context(&f.db.workspace_id, at);
        record_listing_plan_claim(
            c,
            &e,
            operation,
            &f.item,
            &"a".repeat(64),
            Some(&OwnershipClaimDigests {
                resource_binding: binding.clone(),
                preflight_observation: observation.clone(),
            }),
            &mut signer,
        )?;
        c.execute("INSERT INTO afternic_ownership_review_claims(workspace_id,operation_id,plan_id,item_id,attempt_number,attempt_id,domain,connection_id,resource_binding_digest,binding_generation,resource_binding_evidence_digest,preflight_observation_evidence_digest,listing_observation_id,preflight_observation_digest,preflight_observed_at,claimed_at,retry_not_before,execution_fact_id,audit_event_id) SELECT r.workspace_id,f.operation_id,r.plan_id,r.item_id,1,f.attempt_id,r.domain,r.connection_id,r.binding_digest,r.binding_generation,?3,?4,json_extract(i.precondition_json,'$.observationId'),?5,json_extract(i.precondition_json,'$.observedAt'),?6,strftime('%Y-%m-%dT%H:%M:%SZ',?6,'+86400 seconds'),f.execution_fact_id,f.audit_event_id FROM afternic_ownership_review_items r JOIN operation_plan_items i USING(workspace_id,plan_id,item_id) JOIN device_execution_fact_outbox f ON f.workspace_id=r.workspace_id AND f.item_id=r.item_id AND f.operation_id=?1 WHERE r.plan_id=?2",params![operation,f.plan,execution_evidence::hex_to_digest(&binding)?,execution_evidence::hex_to_digest(&observation)?,observation,at]).map_err(|_|BusinessDatabaseError::MutationStale)?;
        c.execute(
            "UPDATE operation_attempts SET status='running',started_at=?1 WHERE operation_id=?2",
            params![at, operation],
        )
        .map_err(|_| BusinessDatabaseError::MutationStale)?;
        if !commit {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    })();
    c.execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
        .unwrap();
    result
}
#[test]
fn ownership_review_purpose_signed_claim_commits_once_and_final_fence_rolls_back() {
    let f = fixture();
    let operation = approve_review(&f);
    let audit_count = count(&f, "workspace_device_audit_outbox");
    assert!(claim_review(&f, &operation, AT, false).is_err());
    assert_eq!(count(&f, "workspace_device_audit_outbox"), audit_count);
    assert_eq!(count(&f, "device_execution_fact_outbox"), 0);
    assert_eq!(count(&f, "afternic_ownership_review_claims"), 0);
    claim_review(&f, &operation, AT, true).unwrap();
    assert!(claim_review(&f, &operation, AT, true).is_err());
    assert_eq!(count(&f, "device_execution_fact_outbox"), 1);
    assert_eq!(count(&f, "afternic_ownership_review_claims"), 1);
    for sql in [
        "DELETE FROM afternic_ownership_review_claims",
        "UPDATE afternic_ownership_review_claims SET retry_not_before='2026-11-19T00:00:01Z'",
        "UPDATE operation_attempts SET status='queued' WHERE status='running'",
    ] {
        assert!(f.db.store.raw_connection().execute_batch(sql).is_err());
    }
}
#[test]
fn ownership_review_signed_claim_refuses_stale_observation_and_revocation() {
    let f = fixture();
    let operation = approve_review(&f);
    assert!(claim_review(&f, &operation, "2026-11-19T00:00:31Z", true).is_err());
    f.db.store
        .raw_connection()
        .execute(
            "UPDATE afternic_connection_publications SET publication_state='revoked'",
            [],
        )
        .unwrap();
    assert!(claim_review(&f, &operation, AT, true).is_err());
    assert_eq!(count(&f, "device_execution_fact_outbox"), 0);
}

fn reconcile_review(
    f: &Fixture,
    operation: &str,
    outcome: &str,
    at: &str,
    observation: Option<&str>,
) {
    let c = f.db.store.raw_connection();
    c.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (e, mut signer) = execution_evidence::test_context(&f.db.workspace_id, at);
    let fence = execution_evidence::read_fence(c, &e).unwrap();
    let reason = match outcome {
        "confirmed" => None,
        "read_failed" => Some("read_failed"),
        _ => Some("postcondition_pending"),
    };
    let audit = execution_evidence::record_listing_plan_observation(
        c,
        &e,
        &fence,
        operation,
        &f.item,
        outcome,
        reason,
        false,
        &mut signer,
    )
    .unwrap()
    .unwrap();
    c.execute("INSERT INTO afternic_ownership_review_reconciliations(workspace_id,operation_id,plan_id,item_id,attempt_number,sequence,outcome,reason,observed_at,next_read_at,listing_observation_id,audit_event_id) VALUES(?1,?2,?3,?4,1,(SELECT count(*)+1 FROM afternic_ownership_review_reconciliations WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?4),?5,?6,?7,CASE WHEN ?5='confirmed' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%SZ',?7,'+30 seconds') END,?8,?9)",params![f.db.workspace_id,operation,f.plan,f.item,outcome,reason,at,observation,audit]).unwrap();
    c.execute_batch("COMMIT").unwrap();
}
#[test]
fn ownership_review_claim_cooldown_survives_new_connection_and_unknown_after_twenty_four_hours() {
    let mut f = fixture();
    let operation = approve_review(&f);
    claim_review(&f, &operation, AT, true).unwrap();
    reconcile_review(&f, &operation, "read_failed", "2026-11-19T00:01:00Z", None);
    let (later, _) = execution_evidence::test_context(&f.db.workspace_id, "2026-11-20T01:00:00Z");
    assert_eq!(
        f.db.afternic_ownership_review_blocker(&later, DOMAIN)
            .unwrap(),
        Some("prior_outcome_unknown")
    );
    f.db.prepare_afternic_connection("Another", &"a".repeat(64), AT, || Ok(()))
        .unwrap();
    assert_eq!(
        f.db.afternic_ownership_review_blocker(&later, DOMAIN)
            .unwrap(),
        Some("prior_outcome_unknown")
    );
    let mut foreign = later.clone();
    foreign.workspace_id = "foreign-workspace".into();
    assert!(
        f.db.afternic_ownership_review_blocker(&foreign, DOMAIN)
            .is_err()
    );
    assert_eq!(
        f.db.afternic_ownership_review_blocker(&later, "another.test")
            .unwrap(),
        None
    );
    let path = f.dir.path().join("workspace.db");
    drop(f.db);
    let db = BusinessDatabase::open(
        &path,
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(
        db.afternic_ownership_review_blocker(&later, DOMAIN)
            .unwrap(),
        Some("prior_outcome_unknown")
    );
}
#[test]
fn ownership_review_confirmed_get_retains_cooldown_until_authenticated_boundary() {
    let mut f = fixture();
    let operation = approve_review(&f);
    claim_review(&f, &operation, AT, true).unwrap();
    let seed =
        f.db.afternic_connection_seed(f.frozen["connectionId"].as_str().unwrap())
            .unwrap();
    let later = "2026-11-19T00:01:00Z";
    f.db.import_afternic_inventory(
        &seed,
        &[DesktopAfternicListingObservation {
            domain: DOMAIN.into(),
            status: "ACTIVE".into(),
            buynow_price: Some(100_000_000),
            floor_price: Some(0),
            minbid_price: Some(20_000_000),
            hidden: Some(false),
            created_at: AT.into(),
            updated_at: later.into(),
        }],
        "device-local",
        1,
        later,
        || Ok(()),
    )
    .unwrap();
    let observation:String=f.db.store.raw_connection().query_row("SELECT listing_observation_id FROM marketplace_listing_observations WHERE observed_at=?1",[later],|r|r.get(0)).unwrap();
    reconcile_review(&f, &operation, "confirmed", later, Some(&observation));
    let (before, _) = execution_evidence::test_context(&f.db.workspace_id, "2026-11-19T23:59:59Z");
    let (after, _) = execution_evidence::test_context(&f.db.workspace_id, "2026-11-20T00:00:00Z");
    assert_eq!(
        f.db.afternic_ownership_review_blocker(&before, DOMAIN)
            .unwrap(),
        Some("cooldown")
    );
    assert_eq!(
        f.db.afternic_ownership_review_blocker(&after, DOMAIN)
            .unwrap(),
        None
    );
    assert!(claim_review(&f, &operation, "2026-11-20T00:00:00Z", true).is_err());
    assert_eq!(count(&f, "device_execution_fact_outbox"), 1);
}

fn actual_request(
    f: &Fixture,
) -> (
    AfternicConnectionSeed,
    DesktopAfternicListingPlanPreviewRequest,
) {
    let mut legacy = f.frozen.clone();
    legacy["schemaVersion"] = 1.into();
    legacy["action"] = "update".into();
    for key in [
        "credentialPublicProof",
        "parentItemId",
        "parentRequestDigest",
        "triggerStatus",
        "maxDispatches",
        "minimumIntervalSeconds",
    ] {
        legacy.as_object_mut().unwrap().remove(key);
    }
    let legacy: afternic_listing_write::AfternicListingWriteFrozenItem =
        serde_json::from_value(legacy).unwrap();
    f.db.store.raw_connection().execute("UPDATE operation_plan_items SET precondition_json=?1,new_value_json=?2 WHERE plan_id=?3",params![serde_json::to_string(&legacy).unwrap(),afternic_listing_write::intent(&legacy).unwrap(),f.plan]).unwrap();
    let seed =
        f.db.afternic_connection_seed(f.frozen["connectionId"].as_str().unwrap())
            .unwrap();
    let request=serde_json::from_value(serde_json::json!({"schemaVersion":2,"connectionId":seed.connection_id,"action":"reactivate_ownership_review","items":[{"domain":DOMAIN}]})).unwrap();
    (seed, request)
}
#[test]
fn ownership_review_real_plan_projects_its_own_claim_and_reconciliation_after_reopen() {
    let mut f = fixture();
    let (seed, request) = actual_request(&f);
    let p =
        f.db.preview_afternic_listing_plan_with_time(&seed, &request, AT, AT, || Ok(()))
            .unwrap();
    assert_eq!(
        p.items[0].ownership_review.as_ref().unwrap().state,
        "preview"
    );
    assert!(
        p.items[0]
            .ownership_review
            .as_ref()
            .unwrap()
            .latest
            .is_none()
    );
    let (e, mut signer) = execution_evidence::test_context(&f.db.workspace_id, AT);
    let p =
        f.db.approve_afternic_listing_plan_with_evidence(
            &p.plan_ref,
            &p.plan_hash,
            AT,
            &e,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
    assert_eq!(
        p.items[0].ownership_review.as_ref().unwrap().state,
        "queued"
    );
    let work =
        f.db.next_afternic_listing_plan_work_with_evidence(AT, true, &e, &mut signer, || Ok(()))
            .unwrap()
            .unwrap();
    let mut observed: DesktopAfternicListingObservation =
        serde_json::from_value(f.frozen["listing"].clone()).unwrap();
    assert!(
        f.db.claim_afternic_listing_plan_with_evidence(
            &work,
            Some(&observed),
            AT,
            &e,
            &mut signer,
            || Ok(())
        )
        .unwrap()
    );
    let path = f.dir.path().join("workspace.db");
    drop(f.db);
    let mut db = BusinessDatabase::open(
        &path,
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    let work = db
        .next_afternic_listing_plan_work_with_evidence(AT, false, &e, &mut signer, || Ok(()))
        .unwrap()
        .unwrap();
    observed.status = "ACTIVE".into();
    db.reconcile_afternic_listing_plan_with_evidence(
        &work,
        Some(&observed),
        AT,
        &e,
        &mut signer,
        || Ok(()),
    )
    .unwrap();
    let p = db.afternic_listing_plan(&p.plan_ref, AT).unwrap();
    assert_eq!(p.state, "completed");
    let review = p.items[0].ownership_review.as_ref().unwrap();
    assert_eq!(review.state, "confirmed");
    assert_eq!(review.claimed_at.as_deref(), Some(AT));
    assert_eq!(review.latest.as_ref().unwrap().provider_status, "ACTIVE");
    assert!(
        db.next_afternic_listing_plan_work_with_evidence(AT, true, &e, &mut signer, || Ok(()))
            .unwrap()
            .is_none()
    );
    let status = db
        .afternic_listing_plan_status(Some(&p.plan_ref), AT)
        .unwrap();
    assert_eq!(status.plans.len(), 2);
}
#[test]
fn ownership_review_preview_never_uses_a_domain_missing_from_latest_scan() {
    let mut f = fixture();
    let (seed, request) = actual_request(&f);
    f.db.import_afternic_inventory(
        &seed,
        &[],
        "device-local",
        1,
        "2026-11-19T00:01:00Z",
        || Ok(()),
    )
    .unwrap();
    assert!(
        f.db.preview_afternic_listing_plan_with_time(
            &seed,
            &request,
            "2026-11-19T00:01:00Z",
            "2026-11-19T00:01:00Z",
            || Ok(())
        )
        .is_err()
    );
}

#[test]
fn ownership_review_controlled_run_blocks_only_its_exact_retained_slot() {
    let mut f = fixture();
    let (ordinary, request) = actual_request(&f);
    let controlled =
        f.db.prepare_afternic_connection("Controlled", &"b".repeat(64), AT, || Ok(()))
            .unwrap();
    f.db.store.raw_connection().execute("INSERT INTO afternic_controlled_acceptance_runs(run_id,workspace_id,account_id,device_id,active_lease_epoch,credential_epoch,connection_id,connection_incarnation_id,credential_generation,credential_public_proof,expires_at,bound_at) VALUES('afternic-wecin-linux-20261119',?1,'account-local','device-local',1,1,?2,?3,?4,?5,'2026-11-26T23:59:59Z',?6)",params![f.db.workspace_id,controlled.connection_id,controlled.connection_incarnation_id,i64::try_from(controlled.credential_generation).unwrap(),controlled.credential_public_proof,AT]).unwrap();
    let observed: DesktopAfternicListingObservation =
        serde_json::from_value(f.frozen["listing"].clone()).unwrap();
    f.db.import_afternic_inventory(&controlled, &[observed], "device-local", 1, AT, || Ok(()))
        .unwrap();
    let controlled =
        f.db.afternic_connection_seed(&controlled.connection_id)
            .unwrap();
    let controlled_request=serde_json::from_value(serde_json::json!({"schemaVersion":2,"connectionId":controlled.connection_id,"action":"reactivate_ownership_review","items":[{"domain":DOMAIN}]})).unwrap();
    assert!(
        f.db.preview_afternic_listing_plan_with_time(
            &controlled,
            &controlled_request,
            AT,
            AT,
            || Ok(())
        )
        .is_err()
    );
    let p =
        f.db.preview_afternic_listing_plan_with_time(&ordinary, &request, AT, AT, || Ok(()))
            .unwrap();
    let (e, mut signer) = execution_evidence::test_context(&f.db.workspace_id, AT);
    assert!(
        f.db.approve_afternic_listing_plan_with_evidence(
            &p.plan_ref,
            &p.plan_hash,
            AT,
            &e,
            &mut signer,
            || Ok(())
        )
        .is_ok()
    );
}

#[test]
fn ownership_review_failed_parent_has_signed_no_dispatch_terminal_and_drains_only_after_ack() {
    let mut f = fixture();
    let (seed, _) = actual_request(&f);
    let request=serde_json::from_value(serde_json::json!({"schemaVersion":2,"connectionId":seed.connection_id,"action":"update","items":[{"domain":DOMAIN,"patch":{"hidden":true},"ownershipReview":{"mode":"reactivate_once_if_review"}}]})).unwrap();
    let p =
        f.db.preview_afternic_listing_plan_with_time(&seed, &request, AT, AT, || Ok(()))
            .unwrap();
    let (e, mut signer) = execution_evidence::test_context(&f.db.workspace_id, AT);
    f.db.approve_afternic_listing_plan_with_evidence(
        &p.plan_ref,
        &p.plan_hash,
        AT,
        &e,
        &mut signer,
        || Ok(()),
    )
    .unwrap();
    let work =
        f.db.next_afternic_listing_plan_work_with_evidence(AT, true, &e, &mut signer, || Ok(()))
            .unwrap()
            .unwrap();
    assert!(
        !f.db
            .claim_afternic_listing_plan_with_evidence(&work, None, AT, &e, &mut signer, || Ok(()))
            .unwrap()
    );
    assert!(
        f.db.next_afternic_listing_plan_work_with_evidence(AT, true, &e, &mut signer, || Ok(()))
            .unwrap()
            .is_none()
    );
    let p = f.db.afternic_listing_plan(&p.plan_ref, AT).unwrap();
    assert_eq!(p.state, "partially_failed");
    assert_eq!(
        p.items[0].ownership_review.as_ref().unwrap().state,
        "conflict"
    );
    assert_eq!(count(&f, "afternic_ownership_review_claims"), 0);
    assert_eq!(count(&f, "device_execution_fact_outbox"), 0);
    assert!(f.db.has_unexported_provider_handoff_facts().unwrap());
    while let Some(upload) = f.db.next_execution_evidence_upload(&e).unwrap() {
        f.db.record_execution_evidence_response(
            &e,
            &upload,
            &upload.test_accepted_response(AT),
            || Ok(()),
        )
        .unwrap();
    }
    assert!(!f.db.has_unexported_provider_handoff_facts().unwrap());
}
#[test]
fn ownership_review_satisfied_without_claim_drains_only_after_signed_audit_ack() {
    let mut fixture = fixture();
    let (seed, request) = actual_request(&fixture);
    let p = fixture
        .db
        .preview_afternic_listing_plan_with_time(&seed, &request, AT, AT, || Ok(()))
        .unwrap();
    let (context, mut signer) = execution_evidence::test_context(&fixture.db.workspace_id, AT);
    fixture
        .db
        .approve_afternic_listing_plan_with_evidence(
            &p.plan_ref,
            &p.plan_hash,
            AT,
            &context,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
    let w = fixture
        .db
        .next_afternic_listing_plan_work_with_evidence(AT, true, &context, &mut signer, || Ok(()))
        .unwrap()
        .unwrap();
    let mut o: DesktopAfternicListingObservation =
        serde_json::from_value(fixture.frozen["listing"].clone()).unwrap();
    o.status = "ACTIVE".into();
    assert!(
        !fixture
            .db
            .claim_afternic_listing_plan_with_evidence(
                &w,
                Some(&o),
                AT,
                &context,
                &mut signer,
                || Ok(())
            )
            .unwrap()
    );
    let p = fixture.db.afternic_listing_plan(&p.plan_ref, AT).unwrap();
    let r = p.items[0].ownership_review.as_ref().unwrap();
    assert_eq!(r.state, "not_required");
    assert!(r.claimed_at.is_none());
    assert_eq!(count(&fixture, "device_execution_fact_outbox"), 0);
    assert!(fixture.db.has_unexported_provider_handoff_facts().unwrap());
    while let Some(upload) = fixture.db.next_execution_evidence_upload(&context).unwrap() {
        fixture
            .db
            .record_execution_evidence_response(
                &context,
                &upload,
                &upload.test_accepted_response(AT),
                || Ok(()),
            )
            .unwrap();
    }
    assert!(!fixture.db.has_unexported_provider_handoff_facts().unwrap());
}
#[test]
fn ownership_review_changed_lease_cannot_infer_complete_claim_history_from_empty_tables() {
    let mut fixture = fixture();
    let (seed, request) = actual_request(&fixture);
    let p = fixture
        .db
        .preview_afternic_listing_plan_with_time(&seed, &request, AT, AT, || Ok(()))
        .unwrap();
    let (mut context, mut signer) = execution_evidence::test_context(&fixture.db.workspace_id, AT);
    context.active_lease_epoch = 2;
    fixture
        .db
        .approve_afternic_listing_plan_with_evidence(
            &p.plan_ref,
            &p.plan_hash,
            AT,
            &context,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
    let w = fixture
        .db
        .next_afternic_listing_plan_work_with_evidence(AT, true, &context, &mut signer, || Ok(()))
        .unwrap()
        .unwrap();
    let o: DesktopAfternicListingObservation =
        serde_json::from_value(fixture.frozen["listing"].clone()).unwrap();
    assert!(
        !fixture
            .db
            .claim_afternic_listing_plan_with_evidence(
                &w,
                Some(&o),
                AT,
                &context,
                &mut signer,
                || Ok(())
            )
            .unwrap()
    );
    let p = fixture.db.afternic_listing_plan(&p.plan_ref, AT).unwrap();
    assert_eq!(
        p.items[0]
            .ownership_review
            .as_ref()
            .unwrap()
            .reason
            .as_deref(),
        Some("prior_outcome_unknown")
    );
    assert_eq!(count(&fixture, "afternic_ownership_review_claims"), 0);
}

#[test]
fn ownership_review_stale_queue_head_is_signed_terminal_and_does_not_starve_later_connection() {
    let mut fixture = fixture();
    let (seed, request) = actual_request(&fixture);
    let first = fixture
        .db
        .preview_afternic_listing_plan_with_time(&seed, &request, AT, AT, || Ok(()))
        .unwrap();
    let (context, mut signer) = execution_evidence::test_context(&fixture.db.workspace_id, AT);
    fixture
        .db
        .approve_afternic_listing_plan_with_evidence(
            &first.plan_ref,
            &first.plan_hash,
            AT,
            &context,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
    let second_seed = fixture
        .db
        .prepare_afternic_connection("Second", &"c".repeat(64), AT, || Ok(()))
        .unwrap();
    let observed: DesktopAfternicListingObservation =
        serde_json::from_value(fixture.frozen["listing"].clone()).unwrap();
    fixture
        .db
        .import_afternic_inventory(&second_seed, &[observed], "device-local", 1, AT, || Ok(()))
        .unwrap();
    let second_seed = fixture
        .db
        .afternic_connection_seed(&second_seed.connection_id)
        .unwrap();
    let request=serde_json::from_value(serde_json::json!({"schemaVersion":2,"connectionId":second_seed.connection_id,"action":"reactivate_ownership_review","items":[{"domain":DOMAIN}]})).unwrap();
    let second = fixture
        .db
        .preview_afternic_listing_plan_with_time(
            &second_seed,
            &request,
            "2026-11-19T00:00:01Z",
            AT,
            || Ok(()),
        )
        .unwrap();
    fixture
        .db
        .approve_afternic_listing_plan_with_evidence(
            &second.plan_ref,
            &second.plan_hash,
            "2026-11-19T00:00:01Z",
            &context,
            &mut signer,
            || Ok(()),
        )
        .unwrap();
    fixture.db.store.raw_connection().execute("UPDATE afternic_connection_publications SET publication_state='revoked' WHERE connection_id=?1",[seed.connection_id]).unwrap();
    let work = fixture
        .db
        .next_afternic_listing_plan_work_with_evidence(AT, true, &context, &mut signer, || Ok(()))
        .unwrap()
        .unwrap();
    assert_eq!(work.plan_id, second.plan_ref);
    let first = fixture
        .db
        .afternic_listing_plan(&first.plan_ref, AT)
        .unwrap();
    assert_eq!(first.state, "partially_failed");
    assert_eq!(
        first.items[0]
            .ownership_review
            .as_ref()
            .unwrap()
            .reason
            .as_deref(),
        Some("connection_changed")
    );
    assert_eq!(count(&fixture, "device_execution_fact_outbox"), 0);
}

#[test]
fn ownership_review_sql_rejects_missing_predecessor_history_even_with_signed_current_claim() {
    let fixture = fixture();
    let operation = approve_review(&fixture);
    fixture.db.store.raw_connection().execute("INSERT INTO initial_replica_installation_receipts(workspace_id,workflow_id,target_device_id,target_server_revision,workspace_schema_version,replica_digest,installed_at) VALUES(?1,'restore-workflow','device-test',0,1,?2,?3)",params![fixture.db.workspace_id,"r".repeat(43),AT]).unwrap();
    let audits = count(&fixture, "workspace_device_audit_outbox");
    assert!(claim_review(&fixture, &operation, AT, true).is_err());
    assert_eq!(count(&fixture, "afternic_ownership_review_claims"), 0);
    assert_eq!(count(&fixture, "device_execution_fact_outbox"), 0);
    assert_eq!(count(&fixture, "workspace_device_audit_outbox"), audits);
}
