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
    let custody =
        DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(&root, store)
            .unwrap();
    DesktopLocalHost {
        application_root: Some(root),
        production_custody: Some(Mutex::new(custody)),
        authority_verifier: Some(verifier),
        ..DesktopLocalHost::default()
    }
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
fn approve_request(plan: &DesktopAfternicDelistPlan) -> DesktopAfternicDelistApproveRequest {
    DesktopAfternicDelistApproveRequest {
        schema_version: 1,
        plan_ref: plan.plan_ref.clone(),
        plan_hash: plan.plan_hash.clone(),
    }
}

#[test]
fn afternic_delist_host_reopens_only_for_get_and_empty_ticks_do_not_change_generation() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, store.clone(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    let _observe =
        crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
    let _write =
        crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
    let before = local.business_status().read_generation;
    assert!(
        local
            .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
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
        .preview_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            DesktopAfternicDelistPreviewRequest {
                schema_version: 1,
                connection_id: connection.connection_id().into(),
                domains: vec!["example.test".into()],
            },
        )
        .unwrap();
    local
        .approve_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    let approved_generation = local.business_status().read_generation;
    local
        .approve_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    assert_eq!(local.business_status().read_generation, approved_generation);
    let work = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(local.business_status().read_generation, approved_generation);
    assert_eq!(work.kind(), DesktopAfternicDelistWorkKind::Preflight);
    let claim = local
        .claim_afternic_delist(work, Some(listing()))
        .unwrap()
        .unwrap();
    assert!(local.recheck_afternic_delist_claim(&claim).is_ok());
    drop(claim);
    drop(connection);
    drop(local);
    let (verifier, wire) = grant(3, &[OBSERVE]);
    let local = host(&path, store, verifier);
    local.activate_authorization_grant(&wire).unwrap();
    let recovered = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(recovered.kind(), DesktopAfternicDelistWorkKind::Reconcile);
    assert!(local.recheck_afternic_delist_work(&recovered).is_ok());
    local.reconcile_afternic_delist(&recovered, None).unwrap();
    let status = local
        .read_afternic_delist_status(DesktopAfternicDelistStatusRequest {
            schema_version: 1,
            plan_ref: Some(plan.plan_ref),
        })
        .unwrap();
    assert!(!status.write_entitled);
    assert_eq!(status.detail.unwrap().state, "completed");
    let before = local.business_status().read_generation;
    assert!(
        local
            .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
            .unwrap()
            .is_none()
    );
    assert_eq!(local.business_status().read_generation, before);
}
#[test]
fn afternic_delist_host_denies_unqualified_writes_and_stale_authority_after_claim() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    let _observe =
        crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Afternic")
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing()])
        .unwrap();
    let request = || DesktopAfternicDelistPreviewRequest {
        schema_version: 1,
        connection_id: connection.connection_id().into(),
        domains: vec!["example.test".into()],
    };
    assert!(
        local
            .preview_afternic_delist(local.begin_native_cloud_run().unwrap(), request())
            .is_err()
    );
    let _write =
        crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
    let plan = local
        .preview_afternic_delist(local.begin_native_cloud_run().unwrap(), request())
        .unwrap();
    local
        .approve_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    let work = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let claim = local
        .claim_afternic_delist(work, Some(listing()))
        .unwrap()
        .unwrap();
    let (_, revoked) = grant(3, &[]);
    local.activate_authorization_grant(&revoked).unwrap();
    assert!(local.recheck_afternic_delist_claim(&claim).is_err());
    let work = claim.into_reconciliation();
    assert!(local.reconcile_afternic_delist(&work, None).is_err());
    assert!(
        local
            .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
            .is_err()
    );
    assert_eq!(
        local
            .read_afternic_delist_status(DesktopAfternicDelistStatusRequest {
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
fn afternic_delist_host_concurrent_approvals_and_claims_issue_one_mutation_permission() {
    use std::sync::{Arc, Barrier};
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = Arc::new(host(&path, TestRebootstrapKeyStore::default(), verifier));
    local.activate_authorization_grant(&wire).unwrap();
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
        .preview_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            DesktopAfternicDelistPreviewRequest {
                schema_version: 1,
                connection_id: connection.connection_id().into(),
                domains: vec!["example.test".into()],
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
                host.approve_afternic_delist(admission, request)
            })
        })
        .collect();
    barrier.wait();
    for approval in approvals {
        assert!(approval.join().unwrap().is_ok());
    }
    let work_a = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let work_b = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(work_a.kind(), DesktopAfternicDelistWorkKind::Preflight);
    assert_eq!(work_b.kind(), DesktopAfternicDelistWorkKind::Preflight);
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
                host.claim_afternic_delist(work, Some(listing()))
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

fn acknowledge_inventory(local: &DesktopLocalHost) {
    let admission = local.begin_native_cloud_run().unwrap();
    let crate::DesktopSyncPushWork::Ready(claim) =
        local.claim_native_sync_push(&admission).unwrap()
    else {
        panic!("inventory imported one asset");
    };
    let request: serde_json::Value = serde_json::from_slice(claim.request_body()).unwrap();
    let acknowledgements:Vec<_>=request["mutations"].as_array().unwrap().iter().zip(1_u64..).map(|(mutation,revision)|serde_json::json!({"mutationId":mutation["mutationId"],"deviceMutationSequence":mutation["deviceMutationSequence"],"serverRevision":revision,"duplicate":false})).collect();
    let wire=serde_json::to_vec(&serde_json::json!({"schemaVersion":3,"accepted":true,"headServerRevision":acknowledgements.len(),"acknowledgements":acknowledgements})).unwrap();
    local
        .complete_native_sync_push(&admission, &claim, &wire)
        .unwrap();
}
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one signed Host proves a ready mutation drain cannot conceal queued, in-flight, unknown or terminal Provider facts across reopen"
)]
fn afternic_delist_host_drain_never_claims_empty_streams_after_provider_facts() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, store.clone(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
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
    acknowledge_inventory(&local);
    let plan = local
        .preview_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            DesktopAfternicDelistPreviewRequest {
                schema_version: 1,
                connection_id: connection.connection_id().into(),
                domains: vec!["example.test".into()],
            },
        )
        .unwrap();
    let admission = local.begin_native_cloud_run().unwrap();
    local
        .begin_native_device_switch_drain(&admission, "switch")
        .unwrap();
    assert_eq!(
        local
            .native_device_switch_drain_progress(&admission)
            .unwrap(),
        crate::DesktopDrainProgress::Ready
    );
    assert!(
        local
            .prepare_native_drain_proof(&admission, "switch", "key")
            .is_ok()
    );
    assert!(
        local
            .preview_afternic_delist(
                local.begin_native_cloud_run().unwrap(),
                DesktopAfternicDelistPreviewRequest {
                    schema_version: 1,
                    connection_id: connection.connection_id().into(),
                    domains: vec!["example.test".into()]
                }
            )
            .is_err()
    );
    assert!(
        local
            .approve_afternic_delist(
                local.begin_native_cloud_run().unwrap(),
                approve_request(&plan)
            )
            .is_err()
    );
    local
        .clear_native_device_switch_barrier(&admission, "switch")
        .unwrap();
    local
        .approve_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            approve_request(&plan),
        )
        .unwrap();
    local
        .begin_native_device_switch_drain(&admission, "switch")
        .unwrap();
    assert_eq!(
        local
            .native_device_switch_drain_progress(&admission)
            .unwrap(),
        crate::DesktopDrainProgress::Blocked
    );
    assert!(
        local
            .prepare_native_drain_proof(&admission, "switch", "key")
            .is_err()
    );
    local
        .clear_native_device_switch_barrier(&admission, "switch")
        .unwrap();
    let work = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let claim = local
        .claim_afternic_delist(work, Some(listing()))
        .unwrap()
        .unwrap();
    local
        .begin_native_device_switch_drain(&admission, "switch")
        .unwrap();
    assert!(local.recheck_afternic_delist_claim(&claim).is_err());
    assert_eq!(
        local
            .native_device_switch_drain_progress(&admission)
            .unwrap(),
        crate::DesktopDrainProgress::Blocked
    );
    assert!(
        local
            .prepare_native_drain_proof(&admission, "switch", "key")
            .is_err()
    );
    let work = claim.into_reconciliation();
    assert!(local.recheck_afternic_delist_work(&work).is_ok());
    local.defer_afternic_delist_read(&work, None).unwrap();
    assert_eq!(
        local
            .native_device_switch_drain_progress(&admission)
            .unwrap(),
        crate::DesktopDrainProgress::Blocked
    );
    assert!(
        local
            .prepare_native_drain_proof(&admission, "switch", "key")
            .is_err()
    );
    local.reconcile_afternic_delist(&work, None).unwrap();
    assert_eq!(
        local
            .native_device_switch_drain_progress(&admission)
            .unwrap(),
        crate::DesktopDrainProgress::Blocked
    );
    assert!(
        local
            .prepare_native_drain_proof(&admission, "switch", "key")
            .is_err()
    );
    drop(work);
    drop(connection);
    drop(local);
    let (verifier, wire) = grant(3, &[OBSERVE]);
    let local = host(&path, store, verifier);
    local.activate_authorization_grant(&wire).unwrap();
    let admission = local.begin_native_cloud_run().unwrap();
    assert_eq!(
        local
            .native_device_switch_drain_progress(&admission)
            .unwrap(),
        crate::DesktopDrainProgress::Blocked
    );
    assert!(
        local
            .prepare_native_drain_proof(&admission, "switch", "key")
            .is_err()
    );
}
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the two real Host threads race first approval against barrier/proof under one writer"
)]
fn afternic_delist_host_barrier_race_cannot_both_approve_and_prove_empty() {
    use std::sync::{Arc, Barrier};
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = Arc::new(host(&path, TestRebootstrapKeyStore::default(), verifier));
    local.activate_authorization_grant(&wire).unwrap();
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
    acknowledge_inventory(&local);
    let plan = local
        .preview_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            DesktopAfternicDelistPreviewRequest {
                schema_version: 1,
                connection_id: connection.connection_id().into(),
                domains: vec!["example.test".into()],
            },
        )
        .unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let approve_host = Arc::clone(&local);
    let approve_barrier = Arc::clone(&barrier);
    let request = approve_request(&plan);
    let approval = std::thread::spawn(move || {
        let _observe =
            crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
        let _write =
            crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
        let admission = approve_host.begin_native_cloud_run().unwrap();
        approve_barrier.wait();
        approve_host
            .approve_afternic_delist(admission, request)
            .is_ok()
    });
    let drain_host = Arc::clone(&local);
    let drain_barrier = Arc::clone(&barrier);
    let proof = std::thread::spawn(move || {
        let admission = drain_host.begin_native_cloud_run().unwrap();
        drain_barrier.wait();
        drain_host
            .begin_native_device_switch_drain(&admission, "race")
            .unwrap();
        drain_host
            .prepare_native_drain_proof(&admission, "race", "key")
            .is_ok()
    });
    barrier.wait();
    let approved = approval.join().unwrap();
    let proved = proof.join().unwrap();
    assert_ne!(approved, proved);
    let admission = local.begin_native_cloud_run().unwrap();
    local
        .clear_native_device_switch_barrier(&admission, "race")
        .unwrap();
    if !approved {
        local
            .approve_afternic_delist(
                local.begin_native_cloud_run().unwrap(),
                approve_request(&plan),
            )
            .unwrap();
    }
    let work = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let claim_host = Arc::clone(&local);
    let claim_barrier = Arc::clone(&barrier);
    let claim = std::thread::spawn(move || {
        let _observe =
            crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
        let _write =
            crate::active_workspace::capability_qualification::test_qualification::qualify(WRITE);
        claim_barrier.wait();
        claim_host.claim_afternic_delist(work, Some(listing()))
    });
    let drain_host = Arc::clone(&local);
    let drain_barrier = Arc::clone(&barrier);
    let drain = std::thread::spawn(move || {
        let admission = drain_host.begin_native_cloud_run().unwrap();
        drain_barrier.wait();
        drain_host
            .begin_native_device_switch_drain(&admission, "race")
            .unwrap();
        assert!(
            drain_host
                .prepare_native_drain_proof(&admission, "race", "key")
                .is_err()
        );
    });
    barrier.wait();
    let claimed = claim.join().unwrap();
    drain.join().unwrap();
    if let Ok(Some(claim)) = claimed {
        assert!(local.recheck_afternic_delist_claim(&claim).is_err());
    }
}
