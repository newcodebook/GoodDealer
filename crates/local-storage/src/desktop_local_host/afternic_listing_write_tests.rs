use super::super::*;
use super::*;
fn grant(revision: u64, caps: &[&str]) -> (WorkspaceAuthorityVerifier, Vec<u8>) {
    let (v, wire) = authority::tests::long_lived_signed_grant_with_capabilities(
        revision,
        &format!("{revision:064x}"),
        "2099-12-31T23:59:59Z",
        2,
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
        status: "ACTIVE".into(),
        buynow_price: Some(100_000_000),
        floor_price: None,
        minbid_price: Some(20_000_000),
        hidden: Some(false),
        created_at: "2026-11-01T00:00:00Z".into(),
        updated_at: "2026-11-01T00:00:00Z".into(),
    }
}
fn approve_request(
    plan: &DesktopAfternicListingWritePlan,
) -> DesktopAfternicListingWriteApproveRequest {
    DesktopAfternicListingWriteApproveRequest {
        schema_version: 1,
        plan_ref: plan.plan_ref.clone(),
        plan_hash: plan.plan_hash.clone(),
    }
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the complete persisted Host restart journey includes both authority epochs"
)]
fn afternic_listing_write_host_reopens_only_for_get_and_empty_ticks_do_not_change_generation() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, store.clone(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let _observe =
        crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
    let _write =
        crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
    let before = local.business_status().read_generation;
    assert!(
        local
            .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
            .unwrap()
            .is_none()
    );
    assert_eq!(local.business_status().read_generation, before);
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let plan = local
        .preview_afternic_listing_write(
            local.begin_native_cloud_run().unwrap(),
            DesktopAfternicListingWritePreviewRequest::Update {
                schema_version: 1,
                connection_id: connection.connection_id().into(),
                items: vec![crate::DesktopAfternicListingWriteUpdateItem {
                    domain: "example.test".into(),
                    patch: crate::DesktopAfternicListingWritePatch {
                        buynow_price_micro_usd: Some(0),
                        floor_price_micro_usd: None,
                        minbid_price_micro_usd: None,
                        hidden: Some(false),
                    },
                }],
            },
        )
        .unwrap();
    local
        .approve_afternic_listing_write(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    let approved_generation = local.business_status().read_generation;
    local
        .approve_afternic_listing_write(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    assert_eq!(local.business_status().read_generation, approved_generation);
    let work = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(local.business_status().read_generation, approved_generation);
    assert_eq!(work.kind(), DesktopAfternicListingWriteWorkKind::Preflight);
    let claim = local
        .claim_afternic_listing_write(work, Some(listing()))
        .unwrap()
        .unwrap();
    assert!(local.recheck_afternic_listing_write_claim(&claim).is_ok());
    drop(claim);
    drop(connection);
    drop(local);
    let (verifier, wire) = grant(3, &[OBSERVE]);
    let local = host(&path, store, verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let recovered = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(
        recovered.kind(),
        DesktopAfternicListingWriteWorkKind::Reconcile
    );
    assert!(
        local
            .recheck_afternic_listing_write_work(&recovered)
            .is_ok()
    );
    let mut observed = listing();
    observed.buynow_price = Some(0);
    local
        .reconcile_afternic_listing_write(&recovered, Some(observed))
        .unwrap();
    let status = local
        .read_afternic_listing_write_status(DesktopAfternicListingWriteStatusRequest {
            schema_version: 1,
            plan_ref: Some(plan.plan_ref),
        })
        .unwrap();
    assert!(!status.write_entitled);
    assert_eq!(status.detail.unwrap().state, "completed");
    let before = local.business_status().read_generation;
    assert!(
        local
            .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
            .unwrap()
            .is_none()
    );
    assert_eq!(local.business_status().read_generation, before);
}
#[test]
fn afternic_listing_write_host_denies_unqualified_writes_and_stale_authority_after_claim() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let _observe =
        crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let request = || DesktopAfternicListingWritePreviewRequest::Update {
        schema_version: 1,
        connection_id: connection.connection_id().into(),
        items: vec![crate::DesktopAfternicListingWriteUpdateItem {
            domain: "example.test".into(),
            patch: crate::DesktopAfternicListingWritePatch {
                buynow_price_micro_usd: Some(0),
                floor_price_micro_usd: None,
                minbid_price_micro_usd: None,
                hidden: Some(false),
            },
        }],
    };
    assert!(
        local
            .preview_afternic_listing_write(local.begin_native_cloud_run().unwrap(), request())
            .is_err()
    );
    let _write =
        crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
    let plan = local
        .preview_afternic_listing_write(local.begin_native_cloud_run().unwrap(), request())
        .unwrap();
    local
        .approve_afternic_listing_write(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    let work = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let claim = local
        .claim_afternic_listing_write(work, Some(listing()))
        .unwrap()
        .unwrap();
    let (_, revoked) = grant(3, &[]);
    local.activate_authorization_grant(&revoked).unwrap();
    assert!(local.recheck_afternic_listing_write_claim(&claim).is_err());
    let work = claim.into_reconciliation();
    assert!(local.reconcile_afternic_listing_write(&work, None).is_err());
    assert!(
        local
            .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
            .is_err()
    );
    assert_eq!(
        local
            .read_afternic_listing_write_status(DesktopAfternicListingWriteStatusRequest {
                schema_version: 1,
                plan_ref: Some(plan.plan_ref)
            })
            .unwrap()
            .detail
            .unwrap()
            .items[0]
            .state,
        "reconciling"
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one signed Host and its sole writer prove both concurrent approval and one-shot claim races"
)]
fn afternic_listing_write_host_concurrent_approvals_and_claims_issue_one_mutation_permission() {
    use std::sync::{Arc, Barrier};
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = Arc::new(host(&path, TestRebootstrapKeyStore::default(), verifier));
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    let _observe =
        crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
    let _write =
        crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let plan = local
        .preview_afternic_listing_write(
            local.begin_native_cloud_run().unwrap(),
            DesktopAfternicListingWritePreviewRequest::Update {
                schema_version: 1,
                connection_id: connection.connection_id().into(),
                items: vec![crate::DesktopAfternicListingWriteUpdateItem {
                    domain: "example.test".into(),
                    patch: crate::DesktopAfternicListingWritePatch {
                        buynow_price_micro_usd: Some(0),
                        floor_price_micro_usd: None,
                        minbid_price_micro_usd: None,
                        hidden: Some(false),
                    },
                }],
            },
        )
        .unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let approvals: Vec<_> = (0..2)
        .map(|_| {
            let host = Arc::clone(&local);
            let barrier = Arc::clone(&barrier);
            let request = approve_request(&plan);
            let admission = host.begin_native_cloud_run().unwrap();
            std::thread::spawn(move || {
                let _observe =
                    crate::active_workspace::capability_qualification::test_qualification::qualify(
                        OBSERVE,
                    );
                let _write =
                    crate::active_workspace::capability_qualification::test_qualification::qualify(
                        WRITE,
                    );
                barrier.wait();
                host.approve_afternic_listing_write(admission, request)
            })
        })
        .collect();
    barrier.wait();
    for approval in approvals {
        assert!(approval.join().unwrap().is_ok());
    }
    let work_a = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let work_b = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(
        work_a.kind(),
        DesktopAfternicListingWriteWorkKind::Preflight
    );
    assert_eq!(
        work_b.kind(),
        DesktopAfternicListingWriteWorkKind::Preflight
    );
    let barrier = Arc::new(Barrier::new(3));
    let claims: Vec<_> = [work_a, work_b]
        .into_iter()
        .map(|work| {
            let host = Arc::clone(&local);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let _observe =
                    crate::active_workspace::capability_qualification::test_qualification::qualify(
                        OBSERVE,
                    );
                let _write =
                    crate::active_workspace::capability_qualification::test_qualification::qualify(
                        WRITE,
                    );
                barrier.wait();
                host.claim_afternic_listing_write(work, Some(listing()))
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = claims
        .into_iter()
        .map(|claim| claim.join().unwrap())
        .collect();
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Ok(Some(_))))
            .count(),
        1
    );
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    local
        .with_authorized_business(false, |runtime, _, _, _| {
            // The generic reader rejects multiple operations for one plan before publishing.
            let view = runtime
                .database_for_backup()
                .read_batch_operations(0, 20)
                .unwrap();
            assert_eq!(view.total_rows, 1);
            assert_eq!(view.window.rows[0].results.as_ref().unwrap().running, 1);
            Ok(())
        })
        .unwrap();
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the actual Host DTO matrix covers every provider status and explicit nullable hidden value"
)]
fn afternic_listing_write_host_exports_all_provider_status_and_hidden_contracts() {
    let mut output = Vec::new();
    for action in ["create", "update"] {
        let tmp = crate::test_tempdir::tempdir().unwrap();
        let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
        let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
        let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
        local.activate_authorization_grant(&wire).unwrap();
        execution_context::tests::admit(&local, &wire);
        let _observe =
            crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
        let _write =
            crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
        let base = local
            .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Inventory")
            .unwrap();
        local
            .commit_afternic_inventory(&base, &[listing()])
            .unwrap();

        for status in [
            "ACTIVE",
            "HIDDEN",
            "INACTIVE",
            "PENDING",
            "SOLD",
            "ON_HOLD",
            "FAILED_COMPLIANCE",
            "INVENTORY_COMPLIANCE_ISSUE",
            "TLD_UNSUPPORTED",
            "UNREGISTERED_DOMAIN",
            "OWNERSHIP_REVIEW",
            "OWNERSHIP_UNVERIFIED",
            "VERIFIED_OWNER_CONFLICT",
            "UNKNOWN",
        ] {
            for hidden in [None, Some(false), Some(true)] {
                let connection = local
                    .prepare_afternic_connection(
                        local.begin_native_cloud_run().unwrap(),
                        "Afternic",
                    )
                    .unwrap();
                let initial = if action == "create" {
                    vec![]
                } else {
                    vec![listing()]
                };
                local
                    .commit_afternic_inventory(&connection, &initial)
                    .unwrap();
                let request=serde_json::from_value(if action=="create" {serde_json::json!({"schemaVersion":1,"connectionId":connection.connection_id(),"action":action,"items":[{"domain":"example.test","values":{"buynowPriceMicroUsd":0,"floorPriceMicroUsd":0,"minbidPriceMicroUsd":20_000_000,"hidden":false}}]})} else {serde_json::json!({"schemaVersion":1,"connectionId":connection.connection_id(),"action":action,"items":[{"domain":"example.test","patch":{"buynowPriceMicroUsd":0}}]})}).unwrap();
                let plan = local
                    .preview_afternic_listing_write(
                        local.begin_native_cloud_run().unwrap(),
                        request,
                    )
                    .unwrap();
                let preview = serde_json::to_value(&plan).unwrap();
                local
                    .approve_afternic_listing_write(
                        local.begin_native_cloud_run().unwrap(),
                        approve_request(&plan),
                    )
                    .unwrap();
                let work = loop {
                    let w = local
                        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
                        .unwrap()
                        .unwrap();
                    if w.connection().connection_id() == connection.connection_id() {
                        break w;
                    }
                    local
                        .defer_afternic_listing_write_read(&w, Some(900))
                        .unwrap();
                };
                let claim = local
                    .claim_afternic_listing_write(
                        work,
                        if action == "create" {
                            None
                        } else {
                            Some(listing())
                        },
                    )
                    .unwrap()
                    .unwrap();
                let work = claim.into_reconciliation();
                let mut observed = listing();
                observed.buynow_price = Some(0);
                observed.floor_price = Some(0);
                observed.status = status.into();
                observed.hidden = hidden;
                local
                    .reconcile_afternic_listing_write(&work, Some(observed))
                    .unwrap();
                let result = local
                    .read_afternic_listing_write_status(DesktopAfternicListingWriteStatusRequest {
                        schema_version: 1,
                        plan_ref: Some(plan.plan_ref),
                    })
                    .unwrap();
                output.push(serde_json::json!({"action":action,"providerStatus":status,"hidden":hidden,"preview":preview,"status":result}));
            }
        }
    }
    assert_eq!(output.len(), 84);
    if let Ok(path) = std::env::var("GOODDEALER_TEST_AFTERNIC_WRITE_CONTRACT_OUTPUT") {
        std::fs::write(path, serde_json::to_vec_pretty(&output).unwrap()).unwrap();
    }
}
