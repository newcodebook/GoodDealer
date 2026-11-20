use super::super::*;
use super::*;
fn grant(revision: u64, caps: &[&str]) -> (WorkspaceAuthorityVerifier, Vec<u8>) {
    grant_at_epoch(revision, caps, 1)
}
fn grant_at_epoch(
    revision: u64,
    caps: &[&str],
    lease_epoch: u64,
) -> (WorkspaceAuthorityVerifier, Vec<u8>) {
    let (v, wire) = authority::tests::long_lived_signed_grant_with_capabilities(
        revision,
        &format!("{revision:064x}"),
        "2099-12-31T23:59:59Z",
        lease_epoch,
        caps,
    );
    (v,serde_json::to_vec(&serde_json::json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<serde_json::Value>(&wire).unwrap()})).unwrap())
}
fn host(
    path: &std::path::Path,
    store: TestRebootstrapKeyStore,
    verifier: WorkspaceAuthorityVerifier,
) -> DesktopLocalHost {
    let root = DesktopApplicationRoot::validate(path).unwrap();
    let custody = DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
        &root,
        store.clone(),
    )
    .unwrap();
    let mut host = DesktopLocalHost {
        application_root: Some(root),
        production_custody: Some(Mutex::new(custody)),
        authority_verifier: Some(verifier),
        ..DesktopLocalHost::default()
    };
    execution_context::tests::configure(&mut host, &store);
    drop(store);
    host
}
fn listing() -> DesktopAfternicListingObservation {
    DesktopAfternicListingObservation {
        domain: "example.test".into(),
        status: "OWNERSHIP_REVIEW".into(),
        buynow_price: Some(100_000_000),
        floor_price: None,
        minbid_price: Some(20_000_000),
        hidden: Some(false),
        created_at: "2026-11-01T00:00:00Z".into(),
        updated_at: "2026-11-01T00:00:00Z".into(),
    }
}
fn approve_request(plan: &DesktopAfternicListingPlan) -> DesktopAfternicListingPlanApproveRequest {
    DesktopAfternicListingPlanApproveRequest {
        schema_version: 2,
        plan_ref: plan.plan_ref.clone(),
        plan_hash: plan.plan_hash.clone(),
    }
}

fn preview(connection: &DesktopAfternicConnection) -> DesktopAfternicListingPlanPreviewRequest {
    serde_json::from_value(serde_json::json!({"schemaVersion":2,
        "connectionId":connection.connection_id(),"action":"reactivate_ownership_review",
        "items":[{"domain":"example.test"}]}))
    .unwrap()
}
fn qualify_review() -> crate::active_workspace::capability_qualification::test_qualification::Guard
{
    crate::active_workspace::capability_qualification::test_qualification::qualify_for_target(
        AFTERNIC_OWNERSHIP_REVIEW,
        Some(std::env::consts::OS),
    )
}
#[test]
fn ownership_review_host_requires_exact_os_qualification_and_never_borrows_controlled_acceptance() {
    use crate::active_workspace::capability_qualification::test_qualification as q;
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let before = local.business_status().read_generation;
    assert!(
        local
            .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
            .unwrap()
            .is_none()
    );
    assert_eq!(before, local.business_status().read_generation);
    let _observe = q::qualify(OBSERVE);
    let _write = q::qualify(WRITE);
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let _unscoped = q::qualify(AFTERNIC_OWNERSHIP_REVIEW);
    let wrong = if std::env::consts::OS == "windows" {
        "macos"
    } else {
        "windows"
    };
    let _wrong = q::qualify_for_target(AFTERNIC_OWNERSHIP_REVIEW, Some(wrong));
    assert!(
        local
            .preview_afternic_listing_plan(
                local.begin_native_cloud_run().unwrap(),
                preview(&connection)
            )
            .is_err()
    );
    let before = local.business_status().read_generation;
    let _review = qualify_review();
    let plan = local
        .preview_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            preview(&connection),
        )
        .unwrap();
    assert!(local.business_status().read_generation > before);
    assert_eq!(
        plan.items[0].ownership_review.as_ref().unwrap().state,
        "preview"
    );
    let status = local
        .read_afternic_listing_plan_status(DesktopAfternicListingPlanStatusRequest {
            schema_version: 2,
            plan_ref: None,
        })
        .unwrap();
    assert!(status.ownership_review_qualified);
    assert!(status.controlled_acceptance.is_none());
}
#[test]
fn ownership_review_host_reopens_for_get_without_another_write_and_revocation_stops_claim() {
    use crate::active_workspace::capability_qualification::test_qualification as q;
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, store.clone(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let _observe = q::qualify(OBSERVE);
    let _write = q::qualify(WRITE);
    let review = qualify_review();
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let plan = local
        .preview_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            preview(&connection),
        )
        .unwrap();
    local
        .approve_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    let before = local.business_status().read_generation;
    local
        .approve_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    assert_eq!(before, local.business_status().read_generation);
    let work = local
        .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(work.kind(), DesktopAfternicListingWriteWorkKind::Preflight);
    let claim = local
        .claim_afternic_listing_plan(work, Some(listing()))
        .unwrap()
        .unwrap();
    assert_eq!(
        claim.action(),
        crate::DesktopAfternicListingPlanAction::ReactivateOwnershipReview
    );
    assert!(claim.fields().is_none());
    assert!(local.recheck_afternic_listing_plan_claim(&claim).is_ok());
    let (_, revoked) = grant(3, &[OBSERVE]);
    local.activate_authorization_grant(&revoked).unwrap();
    assert!(local.recheck_afternic_listing_plan_claim(&claim).is_err());
    drop(claim);
    drop(connection);
    drop(local);
    drop(review);
    let (verifier, wire) = grant(4, &[OBSERVE]);
    let local = host(&path, store, verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let work = local
        .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(work.kind(), DesktopAfternicListingWriteWorkKind::Reconcile);
    local.recheck_afternic_listing_plan_work(&work).unwrap();
    let mut observed = listing();
    observed.status = "ACTIVE".into();
    local
        .reconcile_afternic_listing_plan(&work, Some(observed))
        .unwrap();
    let status = local
        .read_afternic_listing_plan_status(DesktopAfternicListingPlanStatusRequest {
            schema_version: 2,
            plan_ref: Some(plan.plan_ref),
        })
        .unwrap();
    assert!(!status.write_entitled);
    assert!(!status.ownership_review_qualified);
    let crate::active_workspace::business::DesktopAfternicListingPlanDetail::Current(detail) =
        status.detail.unwrap()
    else {
        panic!("v2 detail")
    };
    assert_eq!(detail.state, "completed");
    assert_eq!(
        detail.items[0].ownership_review.as_ref().unwrap().state,
        "confirmed"
    );
    let before = local.business_status().read_generation;
    assert!(
        local
            .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
            .unwrap()
            .is_none()
    );
    assert_eq!(before, local.business_status().read_generation);
}

#[test]
fn ownership_review_host_standby_reads_but_cannot_approve_a_retained_preview() {
    use crate::active_workspace::capability_qualification::test_qualification as q;
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, standby) = authority::signed_standby_for_host_test(2, 2);
    let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
    let (_, active) = grant(2, &[OBSERVE, WRITE]);
    local.activate_authorization_grant(&active).unwrap();
    execution_context::tests::admit(&local, &active);
    let _observe = q::qualify(OBSERVE);
    let _write = q::qualify(WRITE);
    let _review = qualify_review();
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let plan = local
        .preview_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            preview(&connection),
        )
        .unwrap();
    let admission = local.begin_native_cloud_run().unwrap();
    local.activate_authorization_grant(&standby).unwrap();
    assert!(
        local
            .approve_afternic_listing_plan(admission, approve_request(&plan))
            .is_err()
    );
    assert!(local.begin_native_cloud_run().is_err());
    let status = local
        .read_afternic_listing_plan_status(DesktopAfternicListingPlanStatusRequest {
            schema_version: 2,
            plan_ref: Some(plan.plan_ref),
        })
        .unwrap();
    assert!(!status.write_entitled);
    assert!(!status.ownership_review_execution_available);
    let crate::active_workspace::business::DesktopAfternicListingPlanDetail::Current(detail) =
        status.detail.unwrap()
    else {
        panic!("v2 detail")
    };
    assert_eq!(detail.state, "awaiting_approval");
}

#[test]
fn ownership_review_host_rejects_malformed_read_intent_before_authority_lookup() {
    let local = DesktopLocalHost::default();
    for request in [
        DesktopAfternicListingPlanStatusRequest {
            schema_version: 1,
            plan_ref: None,
        },
        DesktopAfternicListingPlanStatusRequest {
            schema_version: 2,
            plan_ref: Some("foreign-plan".into()),
        },
    ] {
        assert!(matches!(
            local.read_afternic_listing_plan_status(request),
            Err(DesktopLocalHostError::CloudProtocolRejected)
        ));
    }
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the signing race and reopening the actual encrypted workspace prove atomic rollback across publication"
)]
fn ownership_review_host_final_fence_rolls_back_signed_approval_after_publication_changes() {
    use super::super::execution_context::tests::TestNative;
    use crate::active_workspace::capability_qualification::test_qualification as q;
    use crate::{
        DesktopContinuousClockReading, DesktopExecutionContextError,
        DesktopExecutionContextNativePort, DesktopExecutionSigningIdentity,
    };
    use std::sync::Arc;
    struct RacingNative {
        inner: TestNative,
        host: std::sync::Weak<DesktopLocalHost>,
    }
    impl DesktopExecutionContextNativePort for RacingNative {
        fn capture_clock(
            &self,
        ) -> Result<DesktopContinuousClockReading, DesktopExecutionContextError> {
            self.inner.capture_clock()
        }
        fn signing_identity(
            &self,
        ) -> Result<DesktopExecutionSigningIdentity, DesktopExecutionContextError> {
            self.inner.signing_identity()
        }
        fn sign_afternic_delist_approval(
            &self,
            bytes: &[u8],
        ) -> Result<[u8; 64], DesktopExecutionContextError> {
            self.inner.sign_afternic_delist_approval(bytes)
        }
        fn sign_afternic_listing_write_approval(
            &self,
            bytes: &[u8],
        ) -> Result<[u8; 64], DesktopExecutionContextError> {
            self.inner.sign_afternic_listing_write_approval(bytes)
        }
        fn sign_afternic_listing_plan_approval(
            &self,
            bytes: &[u8],
        ) -> Result<[u8; 64], DesktopExecutionContextError> {
            self.inner.sign_afternic_listing_plan_approval(bytes)
        }
        fn sign_afternic_ownership_review_approval(
            &self,
            bytes: &[u8],
        ) -> Result<[u8; 64], DesktopExecutionContextError> {
            self.host
                .upgrade()
                .unwrap()
                .transition_requested_epoch
                .fetch_add(1, Ordering::AcqRel);
            self.inner.sign_afternic_ownership_review_approval(bytes)
        }
        fn sign_device_audit_event(
            &self,
            bytes: &[u8],
        ) -> Result<[u8; 64], DesktopExecutionContextError> {
            self.inner.sign_device_audit_event(bytes)
        }
        fn sign_execution_fact(
            &self,
            bytes: &[u8],
        ) -> Result<[u8; 64], DesktopExecutionContextError> {
            self.inner.sign_execution_fact(bytes)
        }
    }
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = Arc::new_cyclic(|weak| {
        let mut local = host(&path, store.clone(), verifier);
        local.execution_context_native = Some(Arc::new(RacingNative {
            inner: TestNative::default(),
            host: weak.clone(),
        }));
        local
    });
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let _observe = q::qualify(OBSERVE);
    let _write = q::qualify(WRITE);
    let _review = qualify_review();
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let plan = local
        .preview_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            preview(&connection),
        )
        .unwrap();
    assert!(
        local
            .approve_afternic_listing_plan(
                local.begin_native_cloud_run().unwrap(),
                approve_request(&plan)
            )
            .is_err()
    );
    drop(connection);
    drop(local);
    let (verifier, wire) = grant(3, &[OBSERVE, WRITE]);
    let local = host(&path, store, verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let status = local
        .read_afternic_listing_plan_status(DesktopAfternicListingPlanStatusRequest {
            schema_version: 2,
            plan_ref: Some(plan.plan_ref),
        })
        .unwrap();
    let crate::active_workspace::business::DesktopAfternicListingPlanDetail::Current(detail) =
        status.detail.unwrap()
    else {
        panic!("v2 detail")
    };
    assert_eq!(detail.state, "awaiting_approval");
    assert!(detail.approved_at.is_none());
    assert!(
        local
            .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
            .unwrap()
            .is_none()
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one linked customer journey verifies both dispatch gates and exports its actual Host projections"
)]
fn ownership_review_host_linked_update_waits_for_fields_then_finishes_both_get_results() {
    use crate::active_workspace::capability_qualification::test_qualification as q;
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let _observe = q::qualify(OBSERVE);
    let _write = q::qualify(WRITE);
    let _review = qualify_review();
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let request = serde_json::from_value(serde_json::json!({
        "schemaVersion":2,"connectionId":connection.connection_id(),"action":"update",
        "items":[{"domain":"example.test","patch":{"buynowPriceMicroUsd":200_000_000},
            "ownershipReview":{"mode":"reactivate_once_if_review"}}]
    }))
    .unwrap();
    let plan = local
        .preview_afternic_listing_plan(local.begin_native_cloud_run().unwrap(), request)
        .unwrap();
    let approved = local
        .approve_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    assert_eq!(
        approved.items[0].ownership_review.as_ref().unwrap().state,
        "waiting_parent"
    );
    let snapshot = || {
        serde_json::to_value(
            local
                .read_afternic_listing_plan_status(DesktopAfternicListingPlanStatusRequest {
                    schema_version: 2,
                    plan_ref: Some(plan.plan_ref.clone()),
                })
                .unwrap(),
        )
        .unwrap()
    };
    let mut statuses = vec![snapshot()];
    let parent = local
        .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let parent = local
        .claim_afternic_listing_plan(parent, Some(listing()))
        .unwrap()
        .unwrap();
    assert_eq!(
        parent.action(),
        crate::DesktopAfternicListingPlanAction::Update
    );
    assert_eq!(
        parent.fields().unwrap().buynow_price_micro_usd,
        Some(200_000_000)
    );
    let parent = parent.into_reconciliation();
    let mut changed = listing();
    changed.buynow_price = Some(200_000_000);
    local
        .reconcile_afternic_listing_plan(&parent, Some(changed.clone()))
        .unwrap();
    statuses.push(snapshot());
    let review = local
        .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let review = local
        .claim_afternic_listing_plan(review, Some(changed.clone()))
        .unwrap()
        .unwrap();
    assert_eq!(
        review.action(),
        crate::DesktopAfternicListingPlanAction::ReactivateOwnershipReview
    );
    assert!(review.fields().is_none());
    statuses.push(snapshot());
    changed.status = "ACTIVE".into();
    local
        .reconcile_afternic_listing_plan(&review.into_reconciliation(), Some(changed.clone()))
        .unwrap();
    statuses.push(snapshot());
    // The original parent still needs its own GET confirmation after provider ownership resolves.
    local.recheck_afternic_listing_plan_work(&parent).unwrap();
    local
        .reconcile_afternic_listing_plan(&parent, Some(changed))
        .unwrap();
    let status = local
        .read_afternic_listing_plan_status(DesktopAfternicListingPlanStatusRequest {
            schema_version: 2,
            plan_ref: Some(plan.plan_ref.clone()),
        })
        .unwrap();
    statuses.push(serde_json::to_value(&status).unwrap());
    if let Ok(path) = std::env::var("GOODDEALER_TEST_AFTERNIC_PLAN_CONTRACT_OUTPUT") {
        std::fs::write(
            path,
            serde_json::to_vec_pretty(
                &serde_json::json!({"plans":[plan,approved],"statuses":statuses}),
            )
            .unwrap(),
        )
        .unwrap();
    }
    let crate::active_workspace::business::DesktopAfternicListingPlanDetail::Current(detail) =
        status.detail.unwrap()
    else {
        panic!("v2 detail")
    };
    assert_eq!(detail.state, "completed");
    assert_eq!(
        detail.items[0].listing_write.as_ref().unwrap().state,
        "applied"
    );
    assert_eq!(
        detail.items[0].ownership_review.as_ref().unwrap().state,
        "confirmed"
    );
    assert!(
        local
            .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
            .unwrap()
            .is_none()
    );
}

#[test]
fn ownership_review_host_later_lease_cannot_infer_an_absent_predecessor_dispatch() {
    use crate::active_workspace::capability_qualification::test_qualification as q;
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant_at_epoch(2, &[OBSERVE, WRITE], 2);
    let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let _observe = q::qualify(OBSERVE);
    let _write = q::qualify(WRITE);
    let _review = qualify_review();
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let plan = local
        .preview_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            preview(&connection),
        )
        .unwrap();
    local
        .approve_afternic_listing_plan(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    let work = local
        .next_afternic_listing_plan_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert!(
        local
            .claim_afternic_listing_plan(work, Some(listing()))
            .unwrap()
            .is_none()
    );
    let status = local
        .read_afternic_listing_plan_status(DesktopAfternicListingPlanStatusRequest {
            schema_version: 2,
            plan_ref: Some(plan.plan_ref),
        })
        .unwrap();
    let crate::active_workspace::business::DesktopAfternicListingPlanDetail::Current(detail) =
        status.detail.unwrap()
    else {
        panic!("v2 detail")
    };
    let review = detail.items[0].ownership_review.as_ref().unwrap();
    assert_eq!(review.state, "conflict");
    assert_eq!(review.reason.as_deref(), Some("prior_outcome_unknown"));
    assert!(review.claimed_at.is_none());
}
