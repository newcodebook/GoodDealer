//! Signed-role integration through the real Host activation and filesystem custody. The
//! key-store adapter remains a test double; these are not OS Keychain qualification results.

use super::*;

fn native_host(
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

fn active_grant() -> Vec<u8> {
    let (_, wire) =
        authority::tests::long_lived_signed_grant(2, &"11".repeat(32), "2099-12-31T23:59:59Z");
    serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 5, "role": "active",
        "grant": serde_json::from_slice::<serde_json::Value>(&wire).unwrap(),
    }))
    .unwrap()
}

fn library(host: &DesktopLocalHost) -> crate::AssetLibraryReadSnapshot {
    host.read_asset_library(DesktopAssetLibraryReadRequest {
        start_index: 0,
        size: 10,
        query: String::new(),
    })
    .unwrap()
}

fn create_request(host: &DesktopLocalHost, name: &str) -> DesktopDomainAssetCreateRequest {
    DesktopDomainAssetCreateRequest {
        mutation_id: format!("create-{name}"),
        expected_read_generation: library(host).read_generation,
        asset: crate::DesktopDomainAssetWrite::bare(name),
    }
}

#[test]
fn signed_standby_first_login_has_directory_authority_without_an_empty_replica() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, wire) = authority::signed_standby_for_host_test(0, 2);
    let host = native_host(&path, store, verifier);
    host.activate_authorization_grant(&wire).unwrap();
    assert_eq!(
        host.authorization_status(),
        DesktopHostAuthorizationStatus::Standby
    );
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::StandbyAwaitingReplica
    );
    assert!(host.runtime_state.lock().unwrap().is_none());
    assert_eq!(
        std::fs::metadata(
            host.application_root
                .as_ref()
                .unwrap()
                .business_database_path()
        )
        .unwrap()
        .len(),
        0
    );
    let admission = host.begin_native_cloud_read_run().unwrap();
    assert!(!admission.is_active());
    assert_eq!(host.recheck_native_cloud(&admission), Ok(()));
    assert!(host.begin_native_cloud_run().is_err());
    assert!(host.read_settings().is_err());
    assert!(host.device_lease().is_err());
}

#[test]
fn signed_demotion_retains_real_assets_but_closes_mutations_and_active_replay() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, standby) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, TestRebootstrapKeyStore::default(), verifier);
    let active = active_grant();
    host.activate_authorization_grant(&active).unwrap();
    host.create_domain_asset(create_request(&host, "retained.test"))
        .unwrap();
    let old_admission = host.begin_native_cloud_run().unwrap();
    let pending_create = create_request(&host, "forbidden.test");
    host.activate_authorization_grant(&standby).unwrap();
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::StandbyReadOnly
    );
    let view = library(&host);
    assert_eq!(view.window.rows.len(), 1);
    assert_eq!(view.window.rows[0].domain, "retained.test");
    assert_eq!(view.freshness.source, "standby_cloud");
    assert!(!view.freshness.can_edit);
    assert_eq!(
        host.create_domain_asset(pending_create).unwrap_err(),
        DesktopLocalHostError::AuthorityRejected
    );
    assert!(host.recheck_native_cloud(&old_admission).is_err());
    let read_admission = host.begin_native_cloud_read_run().unwrap();
    assert!(host.claim_native_sync_push(&read_admission).is_err());
    assert!(
        host.claim_native_cloudflare_projection(&read_admission)
            .is_err()
    );
    assert!(host.prepare_native_sync_pull(&read_admission).is_err());
    assert_eq!(
        host.activate_authorization_grant(&active),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
    assert!(host.begin_native_cloud_run().is_err());
}

#[test]
fn standby_native_floor_survives_close_and_reopen_and_rejects_old_active() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, standby) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, store.clone(), verifier);
    let active = active_grant();
    host.activate_authorization_grant(&active).unwrap();
    host.create_domain_asset(create_request(&host, "reopened.test"))
        .unwrap();
    host.activate_authorization_grant(&standby).unwrap();
    drop(host);

    let (verifier, _) = authority::signed_standby_for_host_test(2, 2);
    let restarted = native_host(&path, store.clone(), verifier);
    assert!(restarted.begin_native_cloud_read_run().is_err());
    assert_eq!(
        restarted.activate_authorization_grant(&active),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
    assert!(restarted.begin_native_cloud_run().is_err());
    drop(restarted);

    let (verifier, _) = authority::signed_standby_for_host_test(2, 2);
    let resumed = native_host(&path, store, verifier);
    resumed.activate_authorization_grant(&standby).unwrap();
    assert_eq!(
        resumed.business_status().state,
        DesktopLocalBusinessState::StandbyReadOnly
    );
    assert_eq!(library(&resumed).window.rows[0].domain, "reopened.test");
    assert!(!resumed.begin_native_cloud_read_run().unwrap().is_active());
}

#[test]
fn signed_role_transition_keeps_the_final_business_commit_fence() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, standby) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, TestRebootstrapKeyStore::default(), verifier);
    host.activate_authorization_grant(&active_grant()).unwrap();
    let request = create_request(&host, "racing.test");
    host.publish_transition_at_next_business_commit_for_test()
        .unwrap();
    assert_eq!(
        host.create_domain_asset(request).unwrap_err(),
        DesktopLocalHostError::AuthorityRejected
    );
    host.activate_authorization_grant(&standby).unwrap();
    assert!(library(&host).window.rows.is_empty());
    assert_eq!(
        serde_json::to_value(host.read_sync_snapshot().unwrap()).unwrap()["pendingMutationCount"],
        0
    );
}

fn persist_handoff(host: &DesktopLocalHost) -> serde_json::Value {
    let admission = host.begin_native_cloud_run().unwrap();
    host.begin_native_device_switch_drain(&admission, "normal-switch")
        .unwrap();
    let draft = host
        .prepare_native_drain_proof(&admission, "normal-switch", "device-key-host-test")
        .unwrap();
    host.persist_native_drain_attempt(&admission, &draft, &"A".repeat(86), "target-device")
        .unwrap();
    let (attempt, receipt) = host
        .runtime_state
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .business
        .database_for_backup_mut()
        .normal_handoff_attempt("normal-switch")
        .unwrap()
        .unwrap();
    assert!(receipt.is_none());
    serde_json::json!({"schemaVersion":1,"accepted":true,"request":{
        "schemaVersion":2,"requestId":"normal-switch","mode":"normal","status":"bootstrapping",
        "fromDeviceId":"device-local","toDeviceId":"target-device","requestedAt":attempt.issued_at,
        "earliestTakeoverAt":null,"bootstrapExpiresAt":attempt.expires_at,
        "normalHandoffReceipt":{"sourceLeaseEpoch":attempt.source_lease_epoch,"proofId":attempt.proof_id,
        "proofDigest":attempt.proof_digest,"releasedAt":attempt.issued_at}
    }})
}

fn remote_replica_page() -> Vec<u8> {
    let mut page = serde_json::json!({"schemaVersion":3,"workspaceId":"workspace-local",
        "fromServerRevisionExclusive":0,"throughServerRevisionInclusive":1,
        "mutations":[{"schemaVersion":3,"mutationId":"remote-after-handoff","workspaceId":"workspace-local",
        "workspaceSchemaVersion":1,"entityType":"domain_asset","entityId":"new-on-target.test","entityGeneration":1,
        "operationKind":"upsert","baseServerRevision":0,"changedFields":[{"fieldPath":"note","value":"from new active"}],
        "sourceDeviceId":"target-device","activeLeaseEpoch":3,"deviceMutationSequence":1,"serverRevision":1}],
        "returnedThroughServerRevision":1,"nextCursor":null,"pageDigest":"A".repeat(43)});
    page["pageDigest"] =
        serde_json::json!(crate::active_workspace::business::canonical_page_digest(&page).unwrap());
    serde_json::to_vec(&serde_json::json!({"schemaVersion":3,"accepted":true,"page":page,"confirmedThrough":0,
        "pendingDelivery":{"generation":1,"fromServerRevisionExclusive":0,"throughServerRevisionInclusive":1,
        "targetServerRevision":1,"pageDigest":page["pageDigest"],"nextCursorDigest":null,
        "predecessorConfirmationDigest":null,"expiresAt":"2099-12-31T23:59:59Z"},"confirmToken":"standby-confirm"})).unwrap()
}

#[test]
fn normal_handoff_lost_response_reopens_to_receipt_reconciliation_then_read_only_inbox() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, standby) = authority::signed_standby_for_host_test(3, 2);
    let host = native_host(&path, store.clone(), verifier);
    host.activate_authorization_grant(&active_grant()).unwrap();
    let receipt = persist_handoff(&host);
    // Cloud consumed the proof, but the source exited before reading its response.
    drop(host);
    let (verifier, _) = authority::signed_standby_for_host_test(3, 2);
    let host = native_host(&path, store.clone(), verifier);
    host.activate_authorization_grant(&standby).unwrap();
    let admission = host.begin_native_cloud_read_run().unwrap();
    assert_eq!(
        host.native_device_switch_in_progress(&admission)
            .unwrap()
            .as_deref(),
        Some("normal-switch")
    );
    assert!(
        host.native_drain_attempt_pending(&admission, "normal-switch")
            .unwrap()
    );
    assert!(host.prepare_native_sync_pull(&admission).is_err());
    for key in ["proofId", "proofDigest", "sourceLeaseEpoch"] {
        let mut bad = receipt.clone();
        bad["request"]["normalHandoffReceipt"][key] = match key {
            "sourceLeaseEpoch" => serde_json::json!(3),
            "proofDigest" => serde_json::json!("B".repeat(43)),
            _ => serde_json::json!("other-proof"),
        };
        assert!(
            host.complete_native_device_switch_response(
                &admission,
                "normal-switch",
                &serde_json::to_vec(&bad).unwrap()
            )
            .is_err()
        );
        assert!(host.prepare_native_sync_pull(&admission).is_err());
    }
    host.complete_native_device_switch_response(
        &admission,
        "normal-switch",
        &serde_json::to_vec(&receipt).unwrap(),
    )
    .unwrap();
    assert!(
        host.native_drain_attempt_succeeded(&admission, "normal-switch")
            .unwrap()
    );
    let exchange = host.prepare_native_sync_pull(&admission).unwrap();
    let before = library(&host).read_generation;
    let page = remote_replica_page();
    host.complete_native_sync_pull(&admission, &exchange, &page)
        .unwrap();
    assert_eq!(library(&host).read_generation, before + 1);
    assert_eq!(library(&host).window.rows[0].domain, "new-on-target.test");
    host.complete_native_sync_pull(&admission, &exchange, &page)
        .unwrap();
    assert_eq!(library(&host).read_generation, before + 1);
    let mut wrong_token: serde_json::Value = serde_json::from_slice(&page).unwrap();
    wrong_token["confirmToken"] = serde_json::json!("other-token");
    assert!(
        host.complete_native_sync_pull(
            &admission,
            &exchange,
            &serde_json::to_vec(&wrong_token).unwrap()
        )
        .is_err()
    );
    assert!(host.claim_native_sync_push(&admission).is_err());
    assert!(host.claim_native_cloudflare_projection(&admission).is_err());
    assert!(
        host.create_domain_asset(create_request(&host, "cannot-write.test"))
            .is_err()
    );
    drop(host);
    let (verifier, _) = authority::signed_standby_for_host_test(3, 2);
    let reopened = native_host(&path, store, verifier);
    reopened.activate_authorization_grant(&standby).unwrap();
    let admission = reopened.begin_native_cloud_read_run().unwrap();
    assert!(reopened.prepare_native_sync_pull(&admission).is_ok());
    assert_eq!(
        library(&reopened).window.rows[0].domain,
        "new-on-target.test"
    );
}

#[test]
fn normal_handoff_inbox_final_fence_rolls_back_and_later_active_epoch_refreezes_old_evidence() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, standby) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, store.clone(), verifier);
    host.activate_authorization_grant(&active_grant()).unwrap();
    let receipt = persist_handoff(&host);
    host.activate_authorization_grant(&standby).unwrap();
    let admission = host.begin_native_cloud_read_run().unwrap();
    host.complete_native_device_switch_response(
        &admission,
        "normal-switch",
        &serde_json::to_vec(&receipt).unwrap(),
    )
    .unwrap();
    let exchange = host.prepare_native_sync_pull(&admission).unwrap();
    host.publish_transition_at_next_business_commit_for_test()
        .unwrap();
    assert_eq!(
        host.complete_native_sync_pull(&admission, &exchange, &remote_replica_page()),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
    drop(host);
    let (verifier, forced) = authority::signed_standby_for_host_test(4, 2);
    let host = native_host(&path, store, verifier);
    let (_, active) = authority::tests::long_lived_signed_grant_at_epoch(
        2,
        &"11".repeat(32),
        "2099-12-31T23:59:59Z",
        3,
    );
    host.activate_authorization_grant(&serde_json::to_vec(&serde_json::json!({"schemaVersion":5,"role":"active", "grant":serde_json::from_slice::<serde_json::Value>(&active).unwrap()})).unwrap()).unwrap();
    assert!(library(&host).window.rows.is_empty());
    host.activate_authorization_grant(&forced).unwrap();
    let admission = host.begin_native_cloud_read_run().unwrap();
    // Source epoch 2's genuine normal receipt cannot thaw an epoch 3 forced-out replica.
    assert!(
        host.native_drain_attempt_succeeded(&admission, "normal-switch")
            .unwrap()
    );
    assert!(host.prepare_native_sync_pull(&admission).is_err());
}

#[test]
fn normal_handoff_replay_restores_exact_native_bytes_and_refusal_survives_restart() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, _) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, store.clone(), verifier);
    let active = active_grant();
    host.activate_authorization_grant(&active).unwrap();
    let mut status = persist_handoff(&host);
    status["request"]["status"] = serde_json::json!("draining");
    status["request"]["normalHandoffReceipt"] = serde_json::Value::Null;
    status["request"]["bootstrapExpiresAt"] = serde_json::Value::Null;
    let wire = serde_json::to_vec(&status).unwrap();
    let admission = host.begin_native_cloud_run().unwrap();
    let exact = host
        .native_pending_drain_submission(&admission, "normal-switch", &wire)
        .unwrap()
        .unwrap();
    let mut changed_target = status.clone();
    changed_target["request"]["toDeviceId"] = serde_json::json!("different-device");
    assert!(
        host.native_pending_drain_submission(
            &admission,
            "normal-switch",
            &serde_json::to_vec(&changed_target).unwrap()
        )
        .is_err()
    );
    drop(host);
    let (verifier, _) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, store.clone(), verifier);
    host.activate_authorization_grant(&active).unwrap();
    let admission = host.begin_native_cloud_run().unwrap();
    assert_eq!(
        host.native_pending_drain_submission(&admission, "normal-switch", &wire)
            .unwrap(),
        Some(exact)
    );
    host.complete_native_device_switch_response(
        &admission,
        "normal-switch",
        br#"{"schemaVersion":1,"accepted":false,"code":"DRAIN_PROOF_INVALID"}"#,
    )
    .unwrap();
    assert!(
        host.native_pending_drain_submission(&admission, "normal-switch", &wire)
            .unwrap()
            .is_none()
    );
    drop(host);
    let (verifier, _) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, store, verifier);
    host.activate_authorization_grant(&active).unwrap();
    assert!(
        host.native_pending_drain_submission(
            &host.begin_native_cloud_run().unwrap(),
            "normal-switch",
            &wire
        )
        .unwrap()
        .is_none()
    );
}

#[test]
fn normal_handoff_native_orphan_can_be_replaced_only_before_attempt_commit() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, _) = authority::signed_standby_for_host_test(2, 2);
    let host = native_host(&path, TestRebootstrapKeyStore::default(), verifier);
    host.activate_authorization_grant(&active_grant()).unwrap();
    let admission = host.begin_native_cloud_run().unwrap();
    host.begin_native_device_switch_drain(&admission, "normal-switch")
        .unwrap();
    let first = host
        .prepare_native_drain_proof(&admission, "normal-switch", "key-a")
        .unwrap();
    let bytes = host
        .native_drain_submission(&first, &"A".repeat(86))
        .unwrap();
    host.production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .store_handoff_submission("normal-switch", &bytes)
        .unwrap();
    let replacement = host
        .prepare_native_drain_proof(&admission, "normal-switch", "key-a")
        .unwrap();
    host.persist_native_drain_attempt(&admission, &replacement, &"A".repeat(86), "target-device")
        .unwrap();
    assert!(
        host.persist_native_drain_attempt(&admission, &first, &"A".repeat(86), "target-device")
            .is_err()
    );
}

#[test]
fn normal_handoff_standby_refresh_revocation_and_retired_cursor_keep_inbox_closed() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, standby) = authority::signed_standby_for_host_test(3, 2);
    let host = native_host(&path, store.clone(), verifier);
    host.activate_authorization_grant(&active_grant()).unwrap();
    let receipt = persist_handoff(&host);
    host.activate_authorization_grant(&standby).unwrap();
    let old = host.begin_native_cloud_read_run().unwrap();
    host.complete_native_device_switch_response(
        &old,
        "normal-switch",
        &serde_json::to_vec(&receipt).unwrap(),
    )
    .unwrap();
    let exchange = host.prepare_native_sync_pull(&old).unwrap();
    host.activate_authorization_grant(&standby).unwrap();
    assert!(
        host.complete_native_sync_pull(&old, &exchange, &remote_replica_page())
            .is_err()
    );
    let refreshed = host.begin_native_cloud_read_run().unwrap();
    let exchange = host.prepare_native_sync_pull(&refreshed).unwrap();
    host.enter_security_lock().unwrap();
    assert!(
        host.complete_native_sync_pull(&refreshed, &exchange, &remote_replica_page())
            .is_err()
    );
    // A newly accepted current authority permits the read, but a retired Cloud cursor freezes
    // the reader durably without granting checkpoint publication or replacing this old replica.
    host.activate_authorization_grant(&standby).unwrap();
    let admission = host.begin_native_cloud_read_run().unwrap();
    let exchange = host.prepare_native_sync_pull(&admission).unwrap();
    assert!(library(&host).window.rows.is_empty());
    let retired = br#"{"schemaVersion":3,"accepted":false,"code":"SYNC_REBOOTSTRAP_REQUIRED","checkpoint":null,"correlationId":"retired-reader"}"#;
    assert_eq!(
        host.complete_native_sync_pull(&admission, &exchange, retired),
        Ok(crate::DesktopSyncPullDisposition::RebootstrapRequired)
    );
    assert!(host.prepare_native_sync_pull(&admission).is_err());
    drop(host);
    let (verifier, _) = authority::signed_standby_for_host_test(3, 2);
    let reopened = native_host(&path, store, verifier);
    reopened.activate_authorization_grant(&standby).unwrap();
    let admission = reopened.begin_native_cloud_read_run().unwrap();
    assert!(reopened.prepare_native_sync_pull(&admission).is_err());
    assert!(reopened.native_checkpoint_due(&admission).is_err());
    assert!(library(&reopened).window.rows.is_empty());
}

#[test]
fn normal_handoff_cancel_and_previous_epoch_cleanup_keep_final_commit_fence() {
    for later_epoch in [false, true] {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let (verifier, _) = authority::signed_standby_for_host_test(2, 2);
        let host = native_host(&path, TestRebootstrapKeyStore::default(), verifier);
        host.activate_authorization_grant(&active_grant()).unwrap();
        let admission = host.begin_native_cloud_run().unwrap();
        host.begin_native_device_switch_drain(&admission, "cancel-race")
            .unwrap();
        if later_epoch {
            let (_, active) = authority::tests::long_lived_signed_grant_at_epoch(
                2,
                &"11".repeat(32),
                "2099-12-31T23:59:59Z",
                3,
            );
            host.activate_authorization_grant(&serde_json::to_vec(&serde_json::json!({"schemaVersion":5,"role":"active", "grant":serde_json::from_slice::<serde_json::Value>(&active).unwrap()})).unwrap()).unwrap();
        }
        let admission = host.begin_native_cloud_run().unwrap();
        host.publish_transition_at_next_business_commit_for_test()
            .unwrap();
        let result = if later_epoch {
            host.clear_left_over_device_switch_barrier(&admission)
                .map(|_| ())
        } else {
            host.clear_native_device_switch_barrier(&admission, "cancel-race")
        };
        assert_eq!(result, Err(DesktopLocalHostError::AuthorityRejected));
        assert_eq!(
            host.runtime_state
                .lock()
                .unwrap()
                .as_mut()
                .unwrap()
                .business
                .database_for_backup_mut()
                .device_handoff_barrier()
                .unwrap()
                .unwrap()
                .device_switch_request_id,
            "cancel-race"
        );
    }
}

#[test]
fn active_capabilities_survive_reopen_and_revocation_fences_provider_operations() {
    fn grant(
        revision: u64,
        digest: &str,
        capabilities: &[&str],
    ) -> (WorkspaceAuthorityVerifier, Vec<u8>) {
        let (verifier, wire) = authority::tests::long_lived_signed_grant_with_capabilities(
            revision,
            digest,
            "2099-12-31T23:59:59Z",
            2,
            capabilities,
        );
        (
            verifier,
            serde_json::to_vec(&serde_json::json!({"schemaVersion":5,"role":"active",
            "grant":serde_json::from_slice::<serde_json::Value>(&wire).unwrap()}))
            .unwrap(),
        )
    }
    fn require(
        host: &DesktopLocalHost,
        admission: &crate::DesktopNativeCloudAdmission,
        capability: &str,
    ) -> Result<(), DesktopLocalHostError> {
        host.with_sync_runtime(Some(&admission.inner), |sync, _, admitted| {
            sync.require_provider_capability(admitted.unwrap(), capability)
        })
    }
    let temp = crate::test_tempdir::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, local_only) = grant(2, &"11".repeat(32), &[]);
    let host = native_host(&path, store.clone(), verifier);
    host.activate_authorization_grant(&local_only).unwrap();
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::Active
    );
    let admission = host.begin_native_cloud_run().unwrap();
    assert!(require(&host, &admission, "cloudflare:dns:observe").is_err());
    assert!(require(&host, &admission, "afternic:marketplace:observe").is_err());
    assert!(
        host.begin_cloudflare_recovery_scan(host.begin_native_cloud_run().unwrap())
            .is_ok()
    );
    let _qualification =
        crate::active_workspace::capability_qualification::test_qualification::qualify(
            "cloudflare:dns:observe",
        );
    assert!(
        host.create_cloudflare_connection(&crate::DesktopCloudflareConnectionCreateRequest {
            schema_version: 1,
            display_label: "Cloudflare".into(),
        })
        .is_err()
    );
    let (_, afternic) = grant(
        3,
        &"22".repeat(32),
        &["afternic:marketplace:observe", "afternic:marketplace:write"],
    );
    host.activate_authorization_grant(&afternic).unwrap();
    assert!(host.recheck_native_cloud(&admission).is_err());
    let afternic_admission = host.begin_native_cloud_run().unwrap();
    assert!(require(&host, &afternic_admission, "afternic:marketplace:write").is_ok());
    assert!(require(&host, &afternic_admission, "cloudflare:dns:observe").is_err());
    let (_, revoked) = grant(4, &"33".repeat(32), &[]);
    host.activate_authorization_grant(&revoked).unwrap();
    assert!(require(&host, &afternic_admission, "afternic:marketplace:write").is_err());
    drop(host);
    let (verifier, _) = grant(4, &"33".repeat(32), &[]);
    let host = native_host(&path, store, verifier);
    assert!(host.activate_authorization_grant(&afternic).is_err());
    host.activate_authorization_grant(&revoked).unwrap();
    let admission = host.begin_native_cloud_run().unwrap();
    assert!(require(&host, &admission, "afternic:marketplace:write").is_err());
    let floor = host
        .production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .load_authorization_floor()
        .unwrap()
        .unwrap();
    assert_eq!(floor.schema_version, 3);
    assert_eq!(floor.last_active_lease_epoch, Some(2));
    assert!(floor.commercial.unwrap().capabilities.is_empty());
}
