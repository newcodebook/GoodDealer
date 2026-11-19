use super::*;
use crate::{DesktopApplicationRoot, desktop_custody::TestRebootstrapKeyStore};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{Value as Json, json};
use std::sync::Mutex;
fn corpus() -> Json {
    serde_json::from_str(include_str!(
        "../../../../../packages/protocol/test-vectors/target-installation/valid.json"
    ))
    .unwrap()
}
fn protected(value: &Json) -> Value {
    wire::parse(&serde_json::to_vec(value).unwrap(), 1_048_576).unwrap()
}
fn rehash(value: &mut Json, field: &str, domain: &str) {
    let input = protected(value).without(&[field]).unwrap();
    value[field] = json!(wire::digest(domain, &input));
}
fn sign(value: &mut Json, seed: &[u8; 32], domain: &str) {
    let key = Ed25519KeyPair::from_seed_unchecked(seed).unwrap();
    value["signature"] = json!(
        URL_SAFE_NO_PAD.encode(
            key.sign(&wire::transcript(
                domain,
                &protected(value).without(&["signature"]).unwrap()
            ))
            .as_ref()
        )
    );
}
fn unauthenticated_host(
    path: &std::path::Path,
    store: &TestRebootstrapKeyStore,
) -> (DesktopLocalHost, Vec<u8>) {
    let root = DesktopApplicationRoot::validate(path).unwrap();
    let custody = DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
        &root,
        store.clone(),
    )
    .unwrap();
    let floor = custody
        .load_authorization_floor()
        .unwrap()
        .map_or(0, |floor| floor.maximum_lease_epoch);
    let (verifier, standby) = super::super::authority::signed_standby_for_host_test(floor, 2);
    let pair = Ed25519KeyPair::from_seed_unchecked(&std::array::from_fn::<u8, 32, _>(|index| {
        u8::try_from(index).unwrap()
    }))
    .unwrap();
    let mut host = DesktopLocalHost {
        application_root: Some(root),
        production_custody: Some(Mutex::new(custody)),
        authority_verifier: Some(
            verifier
                .with_bootstrap_key_for_test("bootstrap-fixture-key-1", pair.public_key().as_ref()),
        ),
        ..DesktopLocalHost::default()
    };
    super::super::execution_context::tests::configure(&mut host, store);
    (host, standby)
}
fn host(path: &std::path::Path, store: &TestRebootstrapKeyStore) -> DesktopLocalHost {
    let (host, standby) = unauthenticated_host(path, store);
    host.activate_authorization_grant(&standby).unwrap();
    host
}
fn status_response(status: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({"schemaVersion":1,"found":true,"request":{"schemaVersion":2,"requestId":"installation-workflow","mode":"normal","status":status,"fromDeviceId":"source-device","toDeviceId":"device-local","requestedAt":"2026-11-19T00:00:00Z","earliestTakeoverAt":null,"bootstrapExpiresAt":if status=="bootstrapping"{Some("2099-12-31T23:59:59Z")}else{None},"normalHandoffReceipt":null}})).unwrap()
}
fn start(host: &DesktopLocalHost) {
    let admission = host.begin_native_cloud_read_run().unwrap();
    let status = host.prepare_target_bootstrap_status(&admission).unwrap();
    host.complete_target_bootstrap_status(&admission, &status, &status_response("bootstrapping"))
        .unwrap();
    host.start_target_installation(&admission, "installation-workflow")
        .unwrap();
}
fn exchange(
    host: &DesktopLocalHost,
) -> (
    DesktopNativeCloudAdmission,
    DesktopTargetInstallationExchange,
) {
    let admission = host.begin_native_cloud_read_run().unwrap();
    let DesktopTargetInstallationWork::Exchange(exchange) =
        host.prepare_target_installation_work(&admission).unwrap()
    else {
        panic!("expected exchange")
    };
    (admission, exchange)
}
#[expect(
    clippy::too_many_lines,
    reason = "one signed test responder preserves the five wire operations and their shared binding"
)]
fn response(exchange: &DesktopTargetInstallationExchange) -> Json {
    let corpus = corpus();
    let request: Json = serde_json::from_slice(exchange.request_bytes()).unwrap();
    let now = current_unix_seconds().unwrap();
    let timestamp = super::super::format_timestamp;
    match exchange.kind() {
        DesktopTargetInstallationExchangeKind::Claim => {
            let mut claim = corpus["claimResponse"].clone();
            claim["claim"]["requestId"] = request["requestId"].clone();
            let capability = &mut claim["claim"]["capability"];
            capability["payload"]["deviceSwitchRequestId"] = request["requestId"].clone();
            capability["accountId"] = json!("account-local");
            capability["deviceId"] = json!("device-local");
            capability["accountSecurityEpoch"] = json!(2);
            capability["issuedAt"] = json!(timestamp(now - 60));
            capability["expiresAt"] = json!(timestamp(now + 3000));
            sign(
                capability,
                &std::array::from_fn::<u8, 32, _>(|index| u8::try_from(index).unwrap()),
                "GOODDEALER-BOOTSTRAP-CAPABILITY-V1",
            );
            claim
        }
        DesktopTargetInstallationExchangeKind::Step => {
            let index = match request["step"]["stepKind"].as_str().unwrap() {
                "pin_checkpoint" => 0,
                "fetch_mutations" => 1,
                _ => 2,
            };
            let mut result = corpus["steps"][index]["result"].clone();
            result["workflowRevision"] = json!(
                request["step"]["expectedWorkflowRevision"]
                    .as_u64()
                    .unwrap()
                    + 1
            );
            result["acceptedStepNumber"] = request["step"]["stepNumber"].clone();
            if index == 0 {
                result["resultPayload"]["checkpoint"]["workspaceId"] = json!("workspace-local");
                result["resultPayload"]["pinExpiresAt"] = json!(timestamp(now + 2400));
            }
            if index == 1 {
                let page = &mut result["resultPayload"]["mutationPage"];
                page["workspaceId"] = json!("workspace-local");
                for mutation in page["mutations"].as_array_mut().unwrap() {
                    mutation["workspaceId"] = json!("workspace-local");
                }
                page["pageDigest"] =
                    json!(crate::active_workspace::business::canonical_page_digest(page).unwrap());
            }
            rehash(
                &mut result,
                "resultDigest",
                "GOODDEALER-BOOTSTRAP-STEP-RESULT-V2",
            );
            json!({"schemaVersion":1,"accepted":true,"result":result})
        }
        DesktopTargetInstallationExchangeKind::Checkpoint => {
            let mut page = corpus["checkpointPages"]
                .as_array()
                .unwrap()
                .iter()
                .find(|page| page["partitionId"] == request["partitionId"])
                .unwrap()
                .clone();
            page["requestId"] = request["requestId"].clone();
            rehash(
                &mut page,
                "pageDigest",
                "GOODDEALER-BOOTSTRAP-CHECKPOINT-PAGE-V1",
            );
            json!({"schemaVersion":1,"accepted":true,"page":page})
        }
        DesktopTargetInstallationExchangeKind::Activate => {
            let mut receipt = corpus["activationResponse"]["receipt"].clone();
            receipt["requestId"] = request["requestId"].clone();
            for field in [
                "activationId",
                "requestDigest",
                "pendingLeaseEpoch",
                "targetServerRevision",
                "workspaceSchemaVersion",
                "verifiedRebuildDigest",
            ] {
                receipt[field] = request[field].clone();
            }
            receipt["workflowRevision"] =
                json!(request["expectedWorkflowRevision"].as_u64().unwrap() + 1);
            let lease = &mut receipt["lease"];
            lease["accountId"] = json!("account-local");
            lease["deviceId"] = json!("device-local");
            lease["accountSecurityEpoch"] = json!(2);
            lease["kid"] = json!("lease-key-host-test");
            lease["issuedAt"] = json!(timestamp(now - 20));
            lease["expiresAt"] = json!(timestamp(now + 3600));
            lease["payload"]["renewAfter"] = json!(timestamp(now + 60));
            lease["payload"]["onlineExpiresAt"] = json!(timestamp(now + 120));
            lease["payload"]["offlineExecuteUntil"] = json!(timestamp(now + 3600));
            sign(lease, &[0x52; 32], "GOODDEALER-ACTIVE-DEVICE-LEASE-V1");
            json!({"schemaVersion":1,"accepted":true,"receipt":receipt})
        }
        DesktopTargetInstallationExchangeKind::Receipt => {
            panic!("receipt requires original identity")
        }
    }
}
fn committed(exchange: &DesktopTargetInstallationExchange, direct: &Json) -> Json {
    let request: Json = serde_json::from_slice(exchange.request_bytes()).unwrap();
    let mut operation = request["operation"].clone();
    let (kind, field, revision, status) = match operation["kind"].as_str().unwrap() {
        "claim" => (
            "claim",
            "claim",
            direct["claim"]["workflowRevision"].clone(),
            "bootstrapping",
        ),
        "step" => (
            "step",
            "result",
            direct["result"]["workflowRevision"].clone(),
            "bootstrapping",
        ),
        _ => (
            "activate",
            "receipt",
            direct["receipt"]["workflowRevision"].clone(),
            "completed",
        ),
    };
    operation[field] = direct[field].clone();
    assert_eq!(operation["kind"], kind);
    json!({"schemaVersion":1,"outcome":"committed","workflow":{"requestId":"installation-workflow","workflowRevision":revision,"status":status},"operation":operation})
}
fn advance_to_activation(
    host: &DesktopLocalHost,
) -> (
    DesktopNativeCloudAdmission,
    DesktopTargetInstallationExchange,
) {
    loop {
        let admission = host.begin_native_cloud_read_run().unwrap();
        match host.prepare_target_installation_work(&admission).unwrap() {
            DesktopTargetInstallationWork::Exchange(exchange)
                if exchange.kind() == DesktopTargetInstallationExchangeKind::Activate =>
            {
                return (admission, exchange);
            }
            DesktopTargetInstallationWork::Exchange(exchange) => {
                host.complete_target_installation_exchange(
                    &admission,
                    &exchange,
                    &serde_json::to_vec(&response(&exchange)).unwrap(),
                )
                .unwrap();
            }
            DesktopTargetInstallationWork::Install => {
                let stage = host.stage_target_installation(&admission).unwrap();
                host.publish_target_installation(&admission, stage).unwrap();
            }
            _ => panic!("unexpected installation work"),
        }
    }
}
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one customer journey crosses every process and authorization boundary end to end"
)]
fn complete_nonempty_install_reopens_and_reconciles_every_unknown_mutation() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let mut owner = host(&path, &store);
    start(&owner);
    let mut recovered = Vec::new();
    loop {
        let admission = owner.begin_native_cloud_read_run().unwrap();
        match owner.prepare_target_installation_work(&admission).unwrap() {
            DesktopTargetInstallationWork::Exchange(original) => {
                let direct = response(&original);
                let kind = original.kind();
                if kind == DesktopTargetInstallationExchangeKind::Checkpoint {
                    owner
                        .complete_target_installation_exchange(
                            &admission,
                            &original,
                            &serde_json::to_vec(&direct).unwrap(),
                        )
                        .unwrap();
                    continue;
                }
                drop(owner);
                owner = host(&path, &store);
                let (admission, lookup) = exchange(&owner);
                assert_eq!(
                    lookup.kind(),
                    DesktopTargetInstallationExchangeKind::Receipt
                );
                let receipt = committed(&lookup, &direct);
                owner
                    .complete_target_installation_exchange(
                        &admission,
                        &lookup,
                        &serde_json::to_vec(&receipt).unwrap(),
                    )
                    .unwrap();
                recovered.push(kind);
                assert!(owner.runtime_state.lock().unwrap().is_none());
            }
            DesktopTargetInstallationWork::Install => {
                let stage = owner.stage_target_installation(&admission).unwrap();
                drop(stage);
                drop(owner);
                owner = host(&path, &store);
                assert!(owner.runtime_state.lock().unwrap().is_none());
            }
            DesktopTargetInstallationWork::RefreshAuthorization => break,
            DesktopTargetInstallationWork::Settled(_) => panic!("unexpected terminal"),
        }
    }
    assert_eq!(recovered.len(), 5);
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let database = custody
        .open_initial_replica_database("workspace-local")
        .unwrap();
    let receipt = database.initial_replica_receipt().unwrap().unwrap();
    assert_eq!(receipt.replica_digest, corpus()["verifiedDigest"]);
    database.verify_initial_replica_receipt(&receipt).unwrap();
    assert_eq!(
        custody.initial_replica_state().unwrap().phase,
        InitialReplicaPhase::Installed
    );
    assert!(
        custody
            .open_existing_workspace("workspace-local")
            .unwrap()
            .is_none()
    );
    assert!(custody.open_workspace("workspace-local").is_err());
    drop(database);
    drop(custody);
    let (_, grant) = super::super::authority::tests::long_lived_signed_grant_with_capabilities(
        2,
        &"22".repeat(32),
        "2099-12-31T23:59:59Z",
        2,
        &[],
    );
    let role=serde_json::to_vec(&json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<Json>(&grant).unwrap()})).unwrap();
    owner.activate_authorization_grant(&role).unwrap();
    assert!(owner.installation_context_gate.load(Ordering::Acquire));
    assert!(owner.read_sync_snapshot().is_err());
    assert!(owner.begin_native_cloud_run().is_err());
    let request = owner.prepare_execution_context_request().unwrap();
    let parsed: Json = serde_json::from_slice(request.request_body()).unwrap();
    let response = super::super::authority::execution_context::test_response(
        &grant,
        parsed["nonce"].as_str().unwrap(),
    );
    let stage = owner
        .stage_execution_context_response(request, &response)
        .unwrap();
    assert!(owner.read_sync_snapshot().is_err());
    owner.publish_staged_execution_context(stage).unwrap();
    assert!(owner.read_sync_snapshot().is_ok());
    let admission = owner.begin_native_cloud_read_run().unwrap();
    assert!(matches!(
        owner.prepare_target_installation_work(&admission).unwrap(),
        DesktopTargetInstallationWork::Settled(DesktopTargetInstallationView::Completed { .. })
    ));
    assert_eq!(
        owner
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .initial_replica_state()
            .unwrap()
            .phase,
        InitialReplicaPhase::Initialized
    );
    drop(owner);
    let owner = host(&path, &store);
    assert!(owner.read_sync_snapshot().is_ok());
}
#[test]
fn polling_is_read_only_and_uncommitted_receipt_replays_original_bytes() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    let (admission, original) = exchange(&owner);
    let revision = owner
        .production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .initial_replica_state()
        .unwrap()
        .revision;
    for _ in 0..3 {
        owner.target_installation_status(&admission).unwrap();
    }
    assert_eq!(
        revision,
        owner
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .initial_replica_state()
            .unwrap()
            .revision
    );
    let (_, lookup) = exchange(&owner);
    let request: Json = serde_json::from_slice(lookup.request_bytes()).unwrap();
    let answer = json!({"schemaVersion":1,"outcome":"uncommitted","workflow":{"requestId":"installation-workflow","workflowRevision":1,"status":"bootstrapping"},"operation":request["operation"],"nextStep":null});
    owner
        .complete_target_installation_exchange(
            &admission,
            &lookup,
            &serde_json::to_vec(&answer).unwrap(),
        )
        .unwrap();
    let (_, retry) = exchange(&owner);
    assert_eq!(retry.kind(), original.kind());
    assert_eq!(retry.request_bytes(), original.request_bytes());
    assert!(
        owner
            .complete_target_installation_exchange(
                &admission,
                &original,
                &serde_json::to_vec(&response(&original)).unwrap()
            )
            .is_err()
    );
}
#[test]
fn durable_cancel_waits_for_unknown_activation_and_never_replays_it() {
    for committed_activation in [false, true] {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = host(&path, &store);
        start(&owner);
        let (admission, activation) = advance_to_activation(&owner);
        let direct = response(&activation);
        owner
            .prepare_target_bootstrap_cancel(&admission, "installation-workflow")
            .unwrap();
        drop(owner);
        let owner = host(&path, &store);
        let admission = owner.begin_native_cloud_read_run().unwrap();
        let status = owner.prepare_target_bootstrap_status(&admission).unwrap();
        let outcome = owner
            .complete_target_bootstrap_status(
                &admission,
                &status,
                &status_response("bootstrapping"),
            )
            .unwrap();
        assert!(outcome.into_parts().1.is_none());
        let (_, lookup) = exchange(&owner);
        assert_eq!(
            lookup.kind(),
            DesktopTargetInstallationExchangeKind::Receipt
        );
        let answer = if committed_activation {
            committed(&lookup, &direct)
        } else {
            let request: Json = serde_json::from_slice(lookup.request_bytes()).unwrap();
            json!({"schemaVersion":1,"outcome":"uncommitted","workflow":{"requestId":"installation-workflow","workflowRevision":4,"status":"bootstrapping"},"operation":request["operation"],"nextStep":null})
        };
        owner
            .complete_target_installation_exchange(
                &admission,
                &lookup,
                &serde_json::to_vec(&answer).unwrap(),
            )
            .unwrap();
        let work = owner.prepare_target_installation_work(&admission).unwrap();
        if committed_activation {
            assert!(matches!(
                work,
                DesktopTargetInstallationWork::RefreshAuthorization
            ));
        } else {
            assert!(matches!(work, DesktopTargetInstallationWork::Settled(_)));
            let status = owner.prepare_target_bootstrap_status(&admission).unwrap();
            assert!(
                owner
                    .complete_target_bootstrap_status(
                        &admission,
                        &status,
                        &status_response("bootstrapping")
                    )
                    .unwrap()
                    .into_parts()
                    .1
                    .is_some()
            );
        }
    }
}
#[test]
fn rejects_wrong_signature_purpose_tenant_security_epoch_and_stale_exchange() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    let (admission, exchange) = exchange(&owner);
    let good = response(&exchange);
    for key in [
        "accountId",
        "deviceId",
        "accountSecurityEpoch",
        "typ",
        "kid",
    ] {
        let mut bad = good.clone();
        bad["claim"]["capability"][key] = if key == "accountSecurityEpoch" {
            json!(3)
        } else {
            json!("foreign")
        };
        assert!(
            owner
                .complete_target_installation_exchange(
                    &admission,
                    &exchange,
                    &serde_json::to_vec(&bad).unwrap()
                )
                .is_err(),
            "{key}"
        );
    }
    owner.enter_security_lock().unwrap();
    assert!(
        owner
            .complete_target_installation_exchange(
                &admission,
                &exchange,
                &serde_json::to_vec(&good).unwrap()
            )
            .is_err()
    );
}

#[test]
fn active_grant_before_lost_activation_receipt_has_only_exact_control_admission() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    let (_, activation) = advance_to_activation(&owner);
    let direct = response(&activation);
    drop(owner);
    let (owner, _) = unauthenticated_host(&path, &store);
    let (_, grant) = super::super::authority::tests::long_lived_signed_grant_with_capabilities(
        2,
        &"22".repeat(32),
        "2099-12-31T23:59:59Z",
        2,
        &[],
    );
    let role=serde_json::to_vec(&json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<Json>(&grant).unwrap()})).unwrap();
    owner.activate_authorization_grant(&role).unwrap();
    assert!(owner.runtime_state.lock().unwrap().is_none());
    assert!(owner.begin_native_cloud_run().is_err());
    assert!(owner.begin_native_cloud_read_run().is_err());
    assert!(owner.read_sync_snapshot().is_err());
    assert!(owner.prepare_execution_context_request().is_err());
    let admission = owner.begin_target_installation_control_run().unwrap();
    assert!(admission.is_installing_target());
    assert!(!admission.is_active());
    owner.recheck_native_cloud(&admission).unwrap();
    let DesktopTargetInstallationWork::Exchange(lookup) =
        owner.prepare_target_installation_work(&admission).unwrap()
    else {
        panic!("exact receipt required")
    };
    assert_eq!(
        lookup.kind(),
        DesktopTargetInstallationExchangeKind::Receipt
    );
    owner
        .complete_target_installation_exchange(
            &admission,
            &lookup,
            &serde_json::to_vec(&committed(&lookup, &direct)).unwrap(),
        )
        .unwrap();
    assert!(matches!(
        owner.prepare_target_installation_work(&admission).unwrap(),
        DesktopTargetInstallationWork::RefreshAuthorization
    ));
    assert!(owner.runtime_state.lock().unwrap().is_none());
    owner.activate_authorization_grant(&role).unwrap();
    assert!(owner.read_sync_snapshot().is_err());
    assert!(owner.runtime_state.lock().unwrap().is_some());
    super::super::execution_context::tests::admit(&owner, &role);
    let admission = owner.begin_target_installation_control_run().unwrap();
    assert!(admission.is_active());
    assert!(matches!(
        owner.prepare_target_installation_work(&admission).unwrap(),
        DesktopTargetInstallationWork::Settled(DesktopTargetInstallationView::Completed { .. })
    ));
    assert!(owner.read_sync_snapshot().is_ok());
}
#[test]
fn changed_security_epoch_shows_stopped_and_refuses_old_exchange() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    let (admission, pending) = exchange(&owner);
    let answer = response(&pending);
    let (_, role) = super::super::authority::signed_standby_for_host_test(0, 3);
    owner.activate_authorization_grant(&role).unwrap();
    let new = owner.begin_target_installation_control_run().unwrap();
    assert!(matches!(
        owner.target_installation_status(&new).unwrap(),
        DesktopTargetInstallationView::Stopped {
            status: DesktopTargetBootstrapTerminalStatus::Failed,
            ..
        }
    ));
    assert!(matches!(
        owner.prepare_target_installation_work(&new).unwrap(),
        DesktopTargetInstallationWork::Settled(DesktopTargetInstallationView::Stopped { .. })
    ));
    assert!(
        owner
            .complete_target_installation_exchange(
                &admission,
                &pending,
                &serde_json::to_vec(&answer).unwrap()
            )
            .is_err()
    );
}

fn status_for(owner: &DesktopLocalHost, workflow: &str, status: &str) {
    let admission = owner.begin_native_cloud_read_run().unwrap();
    let selected = owner.prepare_target_bootstrap_status(&admission).unwrap();
    let mut body: Json = serde_json::from_slice(&status_response(status)).unwrap();
    body["request"]["requestId"] = json!(workflow);
    owner
        .complete_target_bootstrap_status(
            &admission,
            &selected,
            &serde_json::to_vec(&body).unwrap(),
        )
        .unwrap();
}
fn stop_attempt(owner: &DesktopLocalHost, workflow: &str, status: &str) {
    status_for(owner, workflow, status);
    let admission = owner.begin_native_cloud_read_run().unwrap();
    assert!(matches!(
        owner.prepare_target_installation_work(&admission).unwrap(),
        DesktopTargetInstallationWork::Settled(DesktopTargetInstallationView::Stopped { .. })
    ));
}
fn assert_next(owner: &DesktopLocalHost, expected: DesktopTargetInstallationNewWorkflow) {
    let admission = owner.begin_native_cloud_read_run().unwrap();
    assert!(
        matches!(owner.target_installation_status(&admission).unwrap(), DesktopTargetInstallationView::Stopped { new_workflow, .. } if new_workflow == expected)
    );
}
fn finish_activation(owner: &DesktopLocalHost) {
    let (admission, activate) = advance_to_activation(owner);
    owner
        .complete_target_installation_exchange(
            &admission,
            &activate,
            &serde_json::to_vec(&response(&activate)).unwrap(),
        )
        .unwrap();
    let (_, grant) = super::super::authority::tests::long_lived_signed_grant_with_capabilities(
        2,
        &"22".repeat(32),
        "2099-12-31T23:59:59Z",
        2,
        &[],
    );
    let role=serde_json::to_vec(&json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<Json>(&grant).unwrap()})).unwrap();
    owner.activate_authorization_grant(&role).unwrap();
    let request = owner.prepare_execution_context_request().unwrap();
    let parsed: Json = serde_json::from_slice(request.request_body()).unwrap();
    let response = super::super::authority::execution_context::test_response(
        &grant,
        parsed["nonce"].as_str().unwrap(),
    );
    let stage = owner
        .stage_execution_context_response(request, &response)
        .unwrap();
    owner.publish_staged_execution_context(stage).unwrap();
    let admission = owner.begin_native_cloud_read_run().unwrap();
    assert!(matches!(
        owner.prepare_target_installation_work(&admission).unwrap(),
        DesktopTargetInstallationWork::Settled(DesktopTargetInstallationView::Completed { .. })
    ));
}

#[test]
fn cancelled_or_expired_unwritten_install_accepts_new_confirmation_and_retains_original_evidence() {
    for terminal in ["cancelled", "failed"] {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = host(&path, &store);
        start(&owner);
        let (old_admission, old_exchange) = exchange(&owner);
        // The exact terminal proves this pending claim cannot grant a later operation.
        stop_attempt(&owner, "installation-workflow", terminal);
        assert_next(&owner, DesktopTargetInstallationNewWorkflow::Allowed);
        let before = owner
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .initial_replica_state()
            .unwrap();
        let previous = before.bytes.unwrap();
        status_for(&owner, "next-workflow", "bootstrapping");
        let admission = owner.begin_native_cloud_read_run().unwrap();
        owner
            .start_target_installation(&admission, "next-workflow")
            .unwrap();
        assert!(
            owner
                .complete_target_installation_exchange(
                    &old_admission,
                    &old_exchange,
                    &serde_json::to_vec(&response(&old_exchange)).unwrap()
                )
                .is_err()
        );
        drop(owner); // new start ACK was lost, but approval and its history were one publication.
        let owner = host(&path, &store);
        let admission = owner.begin_native_cloud_read_run().unwrap();
        owner
            .start_target_installation(&admission, "next-workflow")
            .unwrap();
        {
            let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
            let state = custody.initial_replica_state().unwrap();
            assert_eq!(state.history.len(), 1);
            assert_eq!(state.history[0].bytes.as_slice(), previous.as_slice());
            assert_eq!(state.history[0].scope.workflow, "installation-workflow");
            assert_eq!(
                load_journal(&state).unwrap().unwrap().request_id,
                "next-workflow"
            );
            assert!(custody.open_workspace("workspace-local").is_err());
        }
        assert!(
            owner
                .start_target_installation(&admission, "installation-workflow")
                .is_err()
        );
        finish_activation(&owner);
        assert!(owner.read_sync_snapshot().is_ok());
        let state = owner
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .initial_replica_state()
            .unwrap();
        assert_eq!(state.history[0].bytes.as_slice(), previous.as_slice());
        assert_eq!(state.phase, InitialReplicaPhase::Initialized);
    }
}

#[test]
fn bounded_history_blocks_ninth_retirement_without_discarding_evidence() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    let mut current = "installation-workflow".to_string();
    for number in 0..8 {
        stop_attempt(&owner, &current, "cancelled");
        assert_next(&owner, DesktopTargetInstallationNewWorkflow::Allowed);
        let next = format!("next-{number}");
        status_for(&owner, &next, "bootstrapping");
        let admission = owner.begin_native_cloud_read_run().unwrap();
        owner.start_target_installation(&admission, &next).unwrap();
        current = next;
    }
    stop_attempt(&owner, &current, "cancelled");
    assert_next(&owner, DesktopTargetInstallationNewWorkflow::HistoryFull);
    status_for(&owner, "beyond-limit", "bootstrapping");
    let admission = owner.begin_native_cloud_read_run().unwrap();
    assert!(
        owner
            .start_target_installation(&admission, "beyond-limit")
            .is_err()
    );
    assert_eq!(
        owner
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .initial_replica_state()
            .unwrap()
            .history
            .len(),
        8
    );
    owner
        .prepare_target_bootstrap_cancel(&admission, "beyond-limit")
        .unwrap();
}

#[test]
fn new_write_fact_is_strict_and_legacy_conversion_never_guesses_after_pin() {
    let original = Journal::new("original", 2);
    let mut legacy: Json = serde_json::from_slice(&protected_bytes(&original).unwrap()).unwrap();
    legacy["schemaVersion"] = json!(1);
    legacy.as_object_mut().unwrap().remove("writeState");
    legacy.as_object_mut().unwrap().remove("terminalEvidence");
    assert!(
        retry::decode_journal(&serde_json::to_vec(&legacy).unwrap())
            .unwrap()
            .write_state
            == retry::WriteState::NotStarted
    );
    legacy["pin"] = json!({});
    legacy["claim"] = json!({});
    assert!(
        retry::decode_journal(&serde_json::to_vec(&legacy).unwrap())
            .unwrap()
            .write_state
            == retry::WriteState::LegacyUnknown
    );
    legacy["schemaVersion"] = json!(2);
    assert!(retry::decode_journal(&serde_json::to_vec(&legacy).unwrap()).is_err());
    legacy["writeState"] = json!("not_started");
    assert!(retry::decode_journal(&serde_json::to_vec(&legacy).unwrap()).is_err());
    legacy["terminalEvidence"] = Json::Null;
    legacy["localReceipt"] = json!({"workflow_id":"original","target_device_id":"device-local","target_server_revision":0,"workspace_schema_version":3,"replica_digest":"a".repeat(43)});
    assert!(retry::decode_journal(&serde_json::to_vec(&legacy).unwrap()).is_err());
}

#[test]
fn old_stopped_without_terminal_evidence_selects_exact_status_and_never_approves_new_work() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    let admission = owner.begin_native_cloud_read_run().unwrap();
    owner
        .with_initial_replica(&admission, |_, _, state| {
            let mut journal = load_journal(&state)?.unwrap();
            journal.view = DesktopTargetInstallationView::Stopped {
                request_id: journal.request_id.clone(),
                status: DesktopTargetBootstrapTerminalStatus::Failed,
                new_workflow: DesktopTargetInstallationNewWorkflow::AwaitingTerminal,
            };
            Ok(((), Some((journal, state.phase))))
        })
        .unwrap();
    assert_next(
        &owner,
        DesktopTargetInstallationNewWorkflow::AwaitingTerminal,
    );
    let selected = owner.prepare_target_bootstrap_status(&admission).unwrap();
    let body: Json = serde_json::from_slice(selected.request_bytes()).unwrap();
    assert_eq!(body["requestId"], "installation-workflow");
    assert!(
        owner
            .start_target_installation(&admission, "unrelated")
            .is_err()
    );
    stop_attempt(&owner, "installation-workflow", "failed");
    assert_next(&owner, DesktopTargetInstallationNewWorkflow::Allowed);
}

fn reach_install(owner: &DesktopLocalHost) {
    loop {
        let admission = owner.begin_native_cloud_read_run().unwrap();
        match owner.prepare_target_installation_work(&admission).unwrap() {
            DesktopTargetInstallationWork::Exchange(selected) => {
                owner
                    .complete_target_installation_exchange(
                        &admission,
                        &selected,
                        &serde_json::to_vec(&response(&selected)).unwrap(),
                    )
                    .unwrap();
            }
            DesktopTargetInstallationWork::Install => return,
            _ => panic!("unexpected terminal before SQL"),
        }
    }
}
#[test]
fn write_started_before_open_and_sql_commit_before_journal_ack_never_allow_replacement() {
    for prefix in [
        "before-open",
        "after-sql",
        "truncated-after-sql",
        "installed",
    ] {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = host(&path, &store);
        start(&owner);
        reach_install(&owner);
        let admission = owner.begin_native_cloud_read_run().unwrap();
        owner.mark_installation_write_started(&admission).unwrap();
        {
            let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
            let state = custody.initial_replica_state().unwrap();
            let journal = load_journal(&state).unwrap().unwrap();
            assert!(journal.write_state == retry::WriteState::Started);
            assert!(custody.initial_replica_database_unwritten().unwrap());
            if prefix == "after-sql" || prefix == "truncated-after-sql" {
                let projection = journal.projection("workspace-local").unwrap();
                let pin = journal.pin.as_ref().unwrap();
                let receipt = InitialReplicaReceipt {
                    workflow_id: journal.request_id.clone(),
                    target_device_id: "device-local".into(),
                    target_server_revision: pin
                        .get("targetServerRevision")
                        .unwrap()
                        .number()
                        .unwrap(),
                    workspace_schema_version: pin
                        .get("workspaceSchemaVersion")
                        .unwrap()
                        .number()
                        .unwrap(),
                    replica_digest: projection.digest().unwrap(),
                };
                let mut database = custody
                    .open_initial_replica_database("workspace-local")
                    .unwrap();
                database
                    .install_initial_replica(&projection, &receipt, || Ok(()))
                    .unwrap();
                assert!(
                    load_journal(&custody.initial_replica_state().unwrap())
                        .unwrap()
                        .unwrap()
                        .local_receipt
                        .is_none()
                );
            }
        }
        if prefix == "installed" {
            owner.stage_target_installation(&admission).unwrap();
        }
        stop_attempt(&owner, "installation-workflow", "cancelled");
        if prefix == "truncated-after-sql" {
            std::fs::OpenOptions::new()
                .write(true)
                .open(path.join("active-workspace/business.db"))
                .unwrap()
                .set_len(0)
                .unwrap();
        }
        drop(owner);
        let owner = host(&path, &store);
        assert_next(
            &owner,
            DesktopTargetInstallationNewWorkflow::RequiresRecovery,
        );
        status_for(&owner, "cannot-replace", "bootstrapping");
        let admission = owner.begin_native_cloud_read_run().unwrap();
        assert!(
            owner
                .start_target_installation(&admission, "cannot-replace")
                .is_err()
        );
        owner
            .prepare_target_bootstrap_cancel(&admission, "cannot-replace")
            .unwrap();
    }
}

#[test]
fn completed_download_without_sql_can_restart_but_legacy_pin_state_cannot() {
    for legacy in [false, true] {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("GoodDealer");
        let store = TestRebootstrapKeyStore::default();
        let owner = host(&path, &store);
        start(&owner);
        reach_install(&owner);
        if legacy {
            let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
            let state = custody.initial_replica_state().unwrap();
            let mut value: Json = serde_json::from_slice(state.bytes.as_ref().unwrap()).unwrap();
            value["schemaVersion"] = json!(1);
            value.as_object_mut().unwrap().remove("writeState");
            value.as_object_mut().unwrap().remove("terminalEvidence");
            custody
                .store_initial_replica_state(
                    state.revision,
                    state.scope.as_ref().unwrap(),
                    &serde_json::to_vec(&value).unwrap(),
                    state.phase,
                )
                .unwrap();
        }
        stop_attempt(&owner, "installation-workflow", "failed");
        assert_next(
            &owner,
            if legacy {
                DesktopTargetInstallationNewWorkflow::RequiresRecovery
            } else {
                DesktopTargetInstallationNewWorkflow::Allowed
            },
        );
        status_for(&owner, "new-after-download", "bootstrapping");
        let admission = owner.begin_native_cloud_read_run().unwrap();
        assert_eq!(
            owner
                .start_target_installation(&admission, "new-after-download")
                .is_ok(),
            !legacy
        );
    }
}

#[test]
fn exact_terminal_receipt_retains_pending_request_through_restart_and_new_workflow() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    // Pin step has both the original signed capability and nonce, so retaining only a digest is insufficient.
    let (admission, claim) = exchange(&owner);
    owner
        .complete_target_installation_exchange(
            &admission,
            &claim,
            &serde_json::to_vec(&response(&claim)).unwrap(),
        )
        .unwrap();
    let (_, original) = exchange(&owner);
    let original_bytes = original.request_bytes().to_vec();
    let (admission, lookup) = exchange(&owner);
    assert_eq!(
        lookup.kind(),
        DesktopTargetInstallationExchangeKind::Receipt
    );
    let request: Json = serde_json::from_slice(lookup.request_bytes()).unwrap();
    let answer = json!({"schemaVersion":1,"outcome":"terminal","workflow":{"requestId":"installation-workflow","workflowRevision":3,"status":"failed"},"operation":request["operation"]});
    owner
        .complete_target_installation_exchange(
            &admission,
            &lookup,
            &serde_json::to_vec(&answer).unwrap(),
        )
        .unwrap();
    drop(owner);
    let owner = host(&path, &store);
    assert_next(&owner, DesktopTargetInstallationNewWorkflow::Allowed);
    status_for(&owner, "after-receipt", "bootstrapping");
    let admission = owner.begin_native_cloud_read_run().unwrap();
    owner
        .start_target_installation(&admission, "after-receipt")
        .unwrap();
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let state = custody.initial_replica_state().unwrap();
    let archived = retry::decode_journal(&state.history[0].bytes).unwrap();
    assert_eq!(
        archived.pending.unwrap().body.bytes().unwrap().as_slice(),
        original_bytes
    );
    assert!(archived.terminal_evidence.unwrap().get("response").unwrap() == &protected(&answer));
}
#[test]
fn terminal_arriving_after_started_before_second_stage_never_opens_database() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    reach_install(&owner);
    let admission = owner.begin_native_cloud_read_run().unwrap();
    owner.mark_installation_write_started(&admission).unwrap();
    status_for(&owner, "installation-workflow", "cancelled");
    assert!(owner.stage_target_installation(&admission).is_err());
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    assert!(custody.initial_replica_database_unwritten().unwrap());
    assert!(
        load_journal(&custody.initial_replica_state().unwrap())
            .unwrap()
            .unwrap()
            .write_state
            == retry::WriteState::Started
    );
}

#[test]
fn concurrent_new_confirmation_keeps_one_history_and_cancel_stops_new_claim() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    stop_attempt(&owner, "installation-workflow", "cancelled");
    status_for(&owner, "new-concurrent", "bootstrapping");
    std::thread::scope(|threads| {
        let first = threads.spawn(|| {
            let admission = owner.begin_native_cloud_read_run().unwrap();
            owner.start_target_installation(&admission, "new-concurrent")
        });
        let second = threads.spawn(|| {
            let admission = owner.begin_native_cloud_read_run().unwrap();
            owner.start_target_installation(&admission, "new-concurrent")
        });
        assert!(first.join().unwrap().is_ok());
        assert!(second.join().unwrap().is_ok());
    });
    let admission = owner.begin_native_cloud_read_run().unwrap();
    owner
        .prepare_target_bootstrap_cancel(&admission, "new-concurrent")
        .unwrap();
    assert!(matches!(
        owner.prepare_target_installation_work(&admission).unwrap(),
        DesktopTargetInstallationWork::Settled(_)
    ));
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let state = custody.initial_replica_state().unwrap();
    assert_eq!(state.history.len(), 1);
    assert!(load_journal(&state).unwrap().unwrap().pending.is_none());
}
#[test]
fn terminal_status_for_another_tenant_never_unlocks_old_installation() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let path = directory.path().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&path, &store);
    start(&owner);
    stop_attempt(&owner, "installation-workflow", "cancelled");
    {
        let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
        let original = custody.load_target_bootstrap_control().unwrap().unwrap();
        let mut control: Json = serde_json::from_slice(&original).unwrap();
        control["account"] = json!("foreign");
        custody
            .replace_target_bootstrap_control(
                Some(&original),
                &serde_json::to_vec(&control).unwrap(),
            )
            .unwrap();
    }
    let admission = owner.begin_native_cloud_read_run().unwrap();
    assert!(owner.start_target_installation(&admission, "new").is_err());
}
