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
fn response(exchange: &DesktopTargetInstallationExchange) -> Json {
    let corpus = corpus();
    let request: Json = serde_json::from_slice(exchange.request_bytes()).unwrap();
    let now = current_unix_seconds().unwrap();
    let timestamp = super::super::format_timestamp;
    match exchange.kind() {
        DesktopTargetInstallationExchangeKind::Claim => {
            let mut claim = corpus["claimResponse"].clone();
            let capability = &mut claim["claim"]["capability"];
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
            let page = corpus["checkpointPages"]
                .as_array()
                .unwrap()
                .iter()
                .find(|page| page["partitionId"] == request["partitionId"])
                .unwrap()
                .clone();
            json!({"schemaVersion":1,"accepted":true,"page":page})
        }
        DesktopTargetInstallationExchangeKind::Activate => {
            let mut receipt = corpus["activationResponse"]["receipt"].clone();
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
