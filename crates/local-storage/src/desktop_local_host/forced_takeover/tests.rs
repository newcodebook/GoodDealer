use super::super::target_installation::tests::{
    committed, host, response as installation_response,
};
use super::super::target_installation::{
    DesktopTargetInstallationExchangeKind as InstallKind,
    DesktopTargetInstallationNewWorkflow as Next, DesktopTargetInstallationView as InstallView,
    DesktopTargetInstallationWork as InstallWork,
};
use super::*;
use crate::desktop_custody::{InitialReplicaPhase, TestRebootstrapKeyStore};

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../packages/protocol/test-vectors/forced-takeover/valid.json"
    ))
    .unwrap()
}
fn fixture(name: &str) -> Value {
    fn local(value: &mut Value) {
        match value {
            Value::Object(fields) => {
                for (key, value) in fields {
                    if key == "toDeviceId" {
                        *value = json!("device-local");
                    } else {
                        local(value);
                    }
                }
            }
            Value::Array(values) => {
                for value in values {
                    local(value);
                }
            }
            _ => {}
        }
    }
    let mut value = corpus()[name].clone();
    local(&mut value);
    value
}
fn admission(owner: &DesktopLocalHost) -> DesktopNativeCloudAdmission {
    owner.begin_target_installation_control_run().unwrap()
}
fn preview(owner: &DesktopLocalHost) -> String {
    let a = admission(owner);
    let exchange = owner.prepare_forced_takeover_preview(&a).unwrap();
    let DesktopForcedTakeoverPreview::Available { preview_id, .. } = owner
        .complete_forced_takeover_preview(
            &a,
            &exchange,
            &bytes(&fixture("previewResponse")).unwrap(),
        )
        .unwrap()
    else {
        panic!("preview unavailable")
    };
    preview_id
}
fn confirm(owner: &DesktopLocalHost) -> String {
    let id = preview(owner);
    let DesktopForcedTakeoverView::Requesting { intent_id } = owner
        .confirm_forced_takeover(&admission(owner), &id)
        .unwrap()
    else {
        panic!("expected intent")
    };
    intent_id
}
fn exchange(
    owner: &DesktopLocalHost,
    kind: DesktopForcedTakeoverExchangeKind,
) -> DesktopForcedTakeoverExchange {
    let DesktopForcedTakeoverWork::Exchange(exchange) = owner
        .prepare_forced_takeover_work(&admission(owner))
        .unwrap()
    else {
        panic!("expected forced exchange")
    };
    assert_eq!(exchange.kind(), kind);
    exchange
}
fn complete(
    owner: &DesktopLocalHost,
    exchange: &DesktopForcedTakeoverExchange,
    value: &Value,
) -> DesktopForcedTakeoverView {
    owner
        .complete_forced_takeover_work(&admission(owner), exchange, &bytes(value).unwrap())
        .unwrap()
}
fn request(owner: &DesktopLocalHost) -> String {
    let id = confirm(owner);
    let e = exchange(owner, DesktopForcedTakeoverExchangeKind::Request);
    complete(owner, &e, &fixture("requestResponse"));
    id
}
fn observe(owner: &DesktopLocalHost, claimable: bool) {
    let e = exchange(owner, DesktopForcedTakeoverExchangeKind::Status);
    let mut value = fixture("statusResponse");
    value["workflow"]["claimable"] = json!(claimable);
    value["workflow"]["evaluatedAt"] = json!("2030-01-01T00:00:00Z");
    complete(owner, &e, &value);
}
fn reserve(owner: &DesktopLocalHost) {
    assert!(matches!(
        owner
            .prepare_forced_takeover_work(&admission(owner))
            .unwrap(),
        DesktopForcedTakeoverWork::ResumeInstallation
    ));
}
fn install_exchange(
    owner: &DesktopLocalHost,
    kind: InstallKind,
) -> super::super::target_installation::DesktopTargetInstallationExchange {
    let InstallWork::Exchange(exchange) = owner
        .prepare_target_installation_work(&admission(owner))
        .unwrap()
    else {
        panic!("expected install exchange")
    };
    assert_eq!(exchange.kind(), kind);
    exchange
}
fn setup() -> (tempfile::TempDir, TestRebootstrapKeyStore, DesktopLocalHost) {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let store = TestRebootstrapKeyStore::default();
    let owner = host(&directory.path().join("GoodDealer"), &store);
    (directory, store, owner)
}
fn restart(
    directory: &tempfile::TempDir,
    store: &TestRebootstrapKeyStore,
    owner: DesktopLocalHost,
) -> DesktopLocalHost {
    drop(owner);
    host(&directory.path().join("GoodDealer"), store)
}

#[test]
fn source_preview_is_process_local_single_use_and_idle_poll_does_not_invalidate() {
    let (directory, store, owner) = setup();
    let id = preview(&owner);
    for _ in 0..3 {
        assert!(matches!(
            owner
                .prepare_forced_takeover_work(&admission(&owner))
                .unwrap(),
            DesktopForcedTakeoverWork::Settled(DesktopForcedTakeoverView::Idle)
        ));
    }
    owner
        .confirm_forced_takeover(&admission(&owner), &id)
        .unwrap();
    assert!(
        owner
            .confirm_forced_takeover(&admission(&owner), &id)
            .is_err()
    );
    let owner = restart(&directory, &store, owner);
    assert!(
        owner
            .confirm_forced_takeover(&admission(&owner), &id)
            .is_err()
    );
    assert_eq!(
        exchange(&owner, DesktopForcedTakeoverExchangeKind::Resolve).kind(),
        DesktopForcedTakeoverExchangeKind::Resolve
    );
}
#[test]
fn unknown_original_request_resolves_exact_body_and_never_replays_with_new_id() {
    let (directory, store, owner) = setup();
    confirm(&owner);
    let original = exchange(&owner, DesktopForcedTakeoverExchangeKind::Request);
    let body: Value = serde_json::from_slice(original.request_bytes()).unwrap();
    let owner = restart(&directory, &store, owner);
    let lookup = exchange(&owner, DesktopForcedTakeoverExchangeKind::Resolve);
    let mut resolved = fixture("resolveResponse");
    resolved["idempotencyKey"] = body["idempotencyKey"].clone();
    resolved["originalRequest"] = body.clone();
    let mut wrong = resolved.clone();
    wrong["originalRequest"]["expectedSourceLeaseEpoch"] = json!(99);
    assert!(
        owner
            .complete_forced_takeover_work(&admission(&owner), &lookup, &bytes(&wrong).unwrap())
            .is_err()
    );
    assert!(matches!(
        complete(&owner, &lookup, &resolved),
        DesktopForcedTakeoverView::Waiting { .. }
    ));
    assert!(
        owner
            .complete_forced_takeover_work(
                &admission(&owner),
                &original,
                &bytes(&fixture("requestResponse")).unwrap()
            )
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
            .phase,
        InitialReplicaPhase::Fresh
    );
}
#[test]
fn fresh_server_observation_reserves_before_claim_and_cannot_survive_restart() {
    let (directory, store, owner) = setup();
    request(&owner);
    observe(&owner, false);
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::Settled(InstallView::Idle)
    ));
    observe(&owner, true);
    reserve(&owner);
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let state = custody.initial_replica_state().unwrap();
    assert_eq!(state.phase, InitialReplicaPhase::Installing);
    let journal: Value = serde_json::from_slice(state.bytes.as_ref().unwrap()).unwrap();
    assert_eq!(journal["schemaVersion"], 3);
    assert_eq!(journal["origin"]["workflowId"], "installation-workflow");
    assert_eq!(journal["writeState"], "not_started");
    drop(custody);
    let owner = restart(&directory, &store, owner);
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::Settled(InstallView::Running { .. })
    ));
    observe(&owner, true);
    reserve(&owner);
    let claim = install_exchange(&owner, InstallKind::Claim);
    let owner = restart(&directory, &store, owner);
    let receipt = install_exchange(&owner, InstallKind::Receipt);
    let original: Value = serde_json::from_slice(claim.request_bytes()).unwrap();
    let query: Value = serde_json::from_slice(receipt.request_bytes()).unwrap();
    assert_eq!(original["requestId"], query["requestId"]);
}
#[test]
fn not_ready_and_waiting_receipt_require_another_server_observation_before_same_claim() {
    let (_directory, _store, owner) = setup();
    request(&owner);
    observe(&owner, true);
    reserve(&owner);
    let claim = install_exchange(&owner, InstallKind::Claim);
    owner
        .complete_target_installation_exchange(
            &admission(&owner),
            &claim,
            &bytes(&fixture("claimNotReady")).unwrap(),
        )
        .unwrap();
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::Settled(_)
    ));
    observe(&owner, true);
    reserve(&owner);
    let replay = install_exchange(&owner, InstallKind::Claim);
    assert_eq!(replay.request_bytes(), claim.request_bytes());
    let lookup = install_exchange(&owner, InstallKind::Receipt);
    owner
        .complete_target_installation_exchange(
            &admission(&owner),
            &lookup,
            &bytes(&fixture("waitingClaimReceipt")).unwrap(),
        )
        .unwrap();
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::Settled(_)
    ));
    observe(&owner, true);
    let replay = install_exchange(&owner, InstallKind::Claim);
    assert_eq!(replay.request_bytes(), claim.request_bytes());
}
#[test]
fn waiting_cancel_is_durable_terminal_evidence_and_allows_only_unwritten_successor() {
    let (directory, store, owner) = setup();
    let id = request(&owner);
    observe(&owner, true);
    reserve(&owner);
    owner
        .cancel_forced_takeover(&admission(&owner), &id)
        .unwrap();
    let owner = restart(&directory, &store, owner);
    observe(&owner, false);
    let cancel = exchange(&owner, DesktopForcedTakeoverExchangeKind::Cancel);
    let mut response = fixture("requestResponse");
    response["request"]["status"] = json!("cancelled");
    assert!(matches!(
        complete(&owner, &cancel, &response),
        DesktopForcedTakeoverView::Finished {
            status: Terminal::Cancelled,
            ..
        }
    ));
    let owner = restart(&directory, &store, owner);
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::Settled(InstallView::Stopped {
            new_workflow: Next::Allowed,
            ..
        })
    ));
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let state = custody.initial_replica_state().unwrap();
    let journal: Value = serde_json::from_slice(state.bytes.as_ref().unwrap()).unwrap();
    assert_eq!(journal["terminalEvidence"]["kind"], "forced_control");
    drop(custody);
    let id = preview(&owner);
    owner
        .confirm_forced_takeover(&admission(&owner), &id)
        .unwrap();
    let e = exchange(&owner, DesktopForcedTakeoverExchangeKind::Request);
    let mut response = fixture("requestResponse");
    response["request"]["requestId"] = json!("next-forced-workflow");
    complete(&owner, &e, &response);
    let e = exchange(&owner, DesktopForcedTakeoverExchangeKind::Status);
    let mut status = fixture("statusResponse");
    status["workflow"]["request"]["requestId"] = json!("next-forced-workflow");
    status["workflow"]["claimable"] = json!(true);
    status["workflow"]["evaluatedAt"] = json!("2030-01-01T00:00:00Z");
    complete(&owner, &e, &status);
    reserve(&owner);
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let state = custody.initial_replica_state().unwrap();
    assert_eq!(state.history.len(), 1);
    assert_eq!(state.history[0].scope.workflow, "installation-workflow");
}
#[test]
fn strict_wire_rejects_unknown_fields_scope_epoch_and_false_claimability() {
    let (_directory, _store, owner) = setup();
    request(&owner);
    let e = exchange(&owner, DesktopForcedTakeoverExchangeKind::Status);
    let good = fixture("statusResponse");
    for field in [
        "unknown",
        "toDeviceId",
        "sourceLeaseEpoch",
        "claimable",
        "normalHandoffReceipt",
    ] {
        let mut bad = good.clone();
        match field {
            "unknown" => bad["workflow"]["extra"] = json!(true),
            "toDeviceId" => bad["workflow"]["request"][field] = json!("foreign-target"),
            "sourceLeaseEpoch" => bad["workflow"][field] = json!(2),
            "claimable" => bad["workflow"][field] = json!(true),
            _ => bad["workflow"]["request"][field] = json!({}),
        }
        assert!(
            owner
                .complete_forced_takeover_work(&admission(&owner), &e, &bytes(&bad).unwrap())
                .is_err(),
            "{field}"
        );
    }
    complete(&owner, &e, &good);
}
#[test]
fn custody_missing_corrupt_marker_and_postwrite_crash_fail_closed() {
    for missing in [false, true] {
        let (_directory, store, owner) = setup();
        confirm(&owner);
        store.damage_forced_takeover_record(missing);
        assert!(owner.forced_takeover_status(&admission(&owner)).is_err());
    }
    let (_directory, store, owner) = setup();
    let id = preview(&owner);
    store.remove_forced_takeover_marker();
    owner
        .confirm_forced_takeover(&admission(&owner), &id)
        .unwrap();
    store.damage_forced_takeover_record(true);
    assert!(owner.forced_takeover_status(&admission(&owner)).is_err());
    for fail in [false, true] {
        let (directory, store, owner) = setup();
        let id = preview(&owner);
        let probe = store.pause_forced_takeover_after_write(fail);
        std::thread::scope(|scope| {
            let task = scope.spawn(|| owner.confirm_forced_takeover(&admission(&owner), &id));
            probe.persisted.wait();
            probe.resume.wait();
            let result = task.join().unwrap();
            assert_eq!(result.is_err(), fail);
        });
        let owner = restart(&directory, &store, owner);
        assert!(matches!(
            owner.forced_takeover_status(&admission(&owner)).unwrap(),
            DesktopForcedTakeoverView::Requesting { .. }
        ));
        exchange(&owner, DesktopForcedTakeoverExchangeKind::Resolve);
    }
}
#[test]
fn concurrent_confirmation_persists_one_original_intent() {
    let (_directory, _store, owner) = setup();
    let id = preview(&owner);
    std::thread::scope(|scope| {
        let first = scope.spawn(|| owner.confirm_forced_takeover(&admission(&owner), &id));
        let second = scope.spawn(|| owner.confirm_forced_takeover(&admission(&owner), &id));
        assert_eq!(
            usize::from(first.join().unwrap().is_ok())
                + usize::from(second.join().unwrap().is_ok()),
            1
        );
    });
}
#[test]
fn existing_replica_refuses_preview_without_source_release() {
    let (directory, store, owner) = setup();
    {
        let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
        custody.open_workspace("workspace-local").unwrap();
    }
    let owner = restart(&directory, &store, owner);
    let a = admission(&owner);
    let e = owner.prepare_forced_takeover_preview(&a).unwrap();
    assert!(matches!(
        owner
            .complete_forced_takeover_preview(&a, &e, &bytes(&fixture("previewResponse")).unwrap())
            .unwrap(),
        DesktopForcedTakeoverPreview::Unavailable {
            reason: DesktopForcedTakeoverPreviewReason::LocalRecoveryRequired
        }
    ));
    assert!(matches!(
        owner.prepare_forced_takeover_work(&a).unwrap(),
        DesktopForcedTakeoverWork::Settled(DesktopForcedTakeoverView::Idle)
    ));
}
#[test]
fn forced_claim_restarts_into_nonempty_sqlcipher_install_and_original_activation_receipt() {
    let (directory, store, owner) = setup();
    request(&owner);
    observe(&owner, true);
    reserve(&owner);
    let claim = install_exchange(&owner, InstallKind::Claim);
    let direct = installation_response(&claim);
    let mut owner = restart(&directory, &store, owner);
    let receipt = install_exchange(&owner, InstallKind::Receipt);
    owner
        .complete_target_installation_exchange(
            &admission(&owner),
            &receipt,
            &bytes(&committed(&receipt, &direct)).unwrap(),
        )
        .unwrap();
    loop {
        let a = admission(&owner);
        match owner.prepare_target_installation_work(&a).unwrap() {
            InstallWork::Exchange(e) => {
                let direct = installation_response(&e);
                if e.kind() == InstallKind::Checkpoint {
                    owner
                        .complete_target_installation_exchange(&a, &e, &bytes(&direct).unwrap())
                        .unwrap();
                } else {
                    owner = restart(&directory, &store, owner);
                    let receipt = install_exchange(&owner, InstallKind::Receipt);
                    owner
                        .complete_target_installation_exchange(
                            &admission(&owner),
                            &receipt,
                            &bytes(&committed(&receipt, &direct)).unwrap(),
                        )
                        .unwrap();
                }
            }
            InstallWork::Install => {
                let stage = owner.stage_target_installation(&a).unwrap();
                owner.publish_target_installation(&a, stage).unwrap();
            }
            InstallWork::RefreshAuthorization => break,
            InstallWork::Settled(_) => panic!("unexpected settle"),
        }
    }
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let database = custody
        .open_initial_replica_database("workspace-local")
        .unwrap();
    let receipt = database.initial_replica_receipt().unwrap().unwrap();
    database.verify_initial_replica_receipt(&receipt).unwrap();
    assert_eq!(receipt.workflow_id, "installation-workflow");
    assert_eq!(
        custody.initial_replica_state().unwrap().phase,
        InitialReplicaPhase::Installed
    );
    drop(database);
    drop(custody);
    authorize_restored_workspace(&owner);
}

#[test]
fn not_found_keeps_sent_original_unknown_but_unsent_intent_can_require_reauthentication() {
    for sent in [false, true] {
        let (directory, store, owner) = setup();
        let id = confirm(&owner);
        if sent {
            exchange(&owner, DesktopForcedTakeoverExchangeKind::Request);
        }
        let owner = restart(&directory, &store, owner);
        let resolve = exchange(&owner, DesktopForcedTakeoverExchangeKind::Resolve);
        let view = complete(&owner, &resolve, &json!({"schemaVersion":1,"found":false}));
        if sent {
            assert!(matches!(view, DesktopForcedTakeoverView::Requesting { .. }));
            owner
                .cancel_forced_takeover(&admission(&owner), &id)
                .unwrap();
            exchange(&owner, DesktopForcedTakeoverExchangeKind::CancelIntent);
        } else {
            assert!(matches!(
                view,
                DesktopForcedTakeoverView::Stopped {
                    reason: DesktopForcedTakeoverStoppedReason::ReauthenticationRequired,
                    can_cancel: false,
                    ..
                }
            ));
        }
    }
}
#[test]
fn server_status_cannot_change_request_identity_or_roll_back_bootstrapping() {
    let (_directory, _store, owner) = setup();
    request(&owner);
    observe(&owner, false);
    let e = exchange(&owner, DesktopForcedTakeoverExchangeKind::Status);
    let mut status = fixture("statusResponse");
    status["workflow"]["evaluatedAt"] = json!("2030-01-01T00:00:00Z");
    let mut changed = status.clone();
    changed["workflow"]["request"]["requestedAt"] = json!("2029-12-30T00:00:00Z");
    assert!(
        owner
            .complete_forced_takeover_work(&admission(&owner), &e, &bytes(&changed).unwrap())
            .is_err()
    );
    changed = status.clone();
    changed["workflow"]["request"]["earliestTakeoverAt"] = json!("2030-01-02T00:00:00Z");
    assert!(
        owner
            .complete_forced_takeover_work(&admission(&owner), &e, &bytes(&changed).unwrap())
            .is_err()
    );
    status["workflow"]["workflowRevision"] = json!(2);
    status["workflow"]["request"]["status"] = json!("bootstrapping");
    status["workflow"]["request"]["bootstrapExpiresAt"] = json!("2030-01-01T01:00:00Z");
    complete(&owner, &e, &status);
    // The response parser also guards direct and resolve replies, not just the coordinator route.
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let control = installation_control(&custody).unwrap().unwrap();
    let intent = control.intent.unwrap();
    let mut rollback = intent.request.clone().unwrap();
    rollback.status = "waiting_expiry".into();
    rollback.bootstrap_expires_at = None;
    assert!(intent.matches_request(&rollback, "device-local").is_err());
}
#[test]
fn cancellation_after_claim_reuses_existing_bootstrap_pending_lane() {
    let (_directory, _store, owner) = setup();
    let id = request(&owner);
    observe(&owner, true);
    reserve(&owner);
    let claim = install_exchange(&owner, InstallKind::Claim);
    owner
        .complete_target_installation_exchange(
            &admission(&owner),
            &claim,
            &bytes(&installation_response(&claim)).unwrap(),
        )
        .unwrap();
    owner
        .cancel_forced_takeover(&admission(&owner), &id)
        .unwrap();
    assert!(matches!(
        owner
            .prepare_forced_takeover_work(&admission(&owner))
            .unwrap(),
        DesktopForcedTakeoverWork::Settled(DesktopForcedTakeoverView::Cancelling { .. })
    ));
    let lookup = owner
        .prepare_target_bootstrap_status(&admission(&owner))
        .unwrap();
    let mut request = fixture("requestResponse")["request"].clone();
    request["status"] = json!("bootstrapping");
    request["bootstrapExpiresAt"] = json!("2030-01-01T01:00:00Z");
    let outcome = owner
        .complete_target_bootstrap_status(
            &admission(&owner),
            &lookup,
            &bytes(&json!({"schemaVersion":1,"found":true,"request":request})).unwrap(),
        )
        .unwrap();
    let (_, cancel) = outcome.into_parts();
    let cancel = cancel.expect("inherited original cancellation");
    owner
        .complete_target_bootstrap_cancel(
            &admission(&owner),
            &cancel,
            &bytes(&fixture("cancelResponse")).unwrap(),
        )
        .unwrap();
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::Settled(InstallView::Stopped {
            new_workflow: Next::Allowed,
            ..
        })
    ));
    let e = exchange(&owner, DesktopForcedTakeoverExchangeKind::Status);
    let mut status = fixture("statusResponse");
    status["workflow"]["request"]["status"] = json!("cancelled");
    status["workflow"]["workflowRevision"] = json!(3);
    status["workflow"]["evaluatedAt"] = json!("2030-01-01T00:00:00Z");
    assert!(matches!(
        complete(&owner, &e, &status),
        DesktopForcedTakeoverView::Finished {
            status: Terminal::Cancelled,
            ..
        }
    ));
}

#[test]
fn cancellation_does_not_send_ahead_of_unknown_activation() {
    let (_directory, _store, owner) = setup();
    let id = request(&owner);
    observe(&owner, true);
    reserve(&owner);
    let (a, activation) = super::super::target_installation::tests::advance_to_activation(&owner);
    owner.cancel_forced_takeover(&a, &id).unwrap();
    assert!(matches!(
        owner.prepare_forced_takeover_work(&a).unwrap(),
        DesktopForcedTakeoverWork::ResumeInstallation
    ));
    let receipt = install_exchange(&owner, InstallKind::Receipt);
    let direct = installation_response(&activation);
    owner
        .complete_target_installation_exchange(
            &admission(&owner),
            &receipt,
            &bytes(&committed(&receipt, &direct)).unwrap(),
        )
        .unwrap();
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::RefreshAuthorization
    ));
    let lookup = owner
        .prepare_target_bootstrap_status(&admission(&owner))
        .unwrap();
    let mut completed = fixture("requestResponse")["request"].clone();
    completed["status"] = json!("completed");
    owner
        .complete_target_bootstrap_status(
            &admission(&owner),
            &lookup,
            &bytes(&json!({"schemaVersion":1,"found":true,"request":completed})).unwrap(),
        )
        .unwrap();
    let e = exchange(&owner, DesktopForcedTakeoverExchangeKind::Status);
    let mut status = fixture("statusResponse");
    status["workflow"]["workflowRevision"] = json!(6);
    status["workflow"]["evaluatedAt"] = json!("2030-01-01T00:00:00Z");
    status["workflow"]["request"]["status"] = json!("completed");
    assert!(matches!(
        complete(&owner, &e, &status),
        DesktopForcedTakeoverView::Finished {
            status: Terminal::Completed,
            ..
        }
    ));
}

#[test]
fn unknown_request_cancel_uses_exact_tombstone_and_survives_lost_ack() {
    let (directory, store, owner) = setup();
    let id = confirm(&owner);
    let original = exchange(&owner, DesktopForcedTakeoverExchangeKind::Request);
    let original: Value = serde_json::from_slice(original.request_bytes()).unwrap();
    owner
        .cancel_forced_takeover(&admission(&owner), &id)
        .unwrap();
    let cancel = exchange(&owner, DesktopForcedTakeoverExchangeKind::CancelIntent);
    assert_eq!(
        serde_json::from_slice::<Value>(cancel.request_bytes()).unwrap(),
        json!({"schemaVersion":1,"originalRequest":original})
    );
    let owner = restart(&directory, &store, owner);
    let retry = exchange(&owner, DesktopForcedTakeoverExchangeKind::CancelIntent);
    assert_eq!(retry.request_bytes(), cancel.request_bytes());
    let answer =
        json!({"schemaVersion":1,"outcome":"cancelled_before_request","originalRequest":original});
    let mut wrong = answer.clone();
    wrong["originalRequest"]["expectedSourceLeaseEpoch"] = json!(9);
    assert!(
        owner
            .complete_forced_takeover_work(&admission(&owner), &retry, &bytes(&wrong).unwrap())
            .is_err()
    );
    assert!(matches!(
        complete(&owner, &retry, &answer),
        DesktopForcedTakeoverView::CancelledBeforeRequest { .. }
    ));
    let owner = restart(&directory, &store, owner);
    assert!(matches!(
        owner
            .prepare_forced_takeover_work(&admission(&owner))
            .unwrap(),
        DesktopForcedTakeoverWork::Settled(
            DesktopForcedTakeoverView::CancelledBeforeRequest { .. }
        )
    ));
    let id = preview(&owner);
    owner
        .confirm_forced_takeover(&admission(&owner), &id)
        .unwrap();
    let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
    let record = installation_control(&custody).unwrap().unwrap();
    assert!(record.history[0].cancelled_before_request.is_some());
    assert_eq!(record.history[0].request_bytes, bytes(&original).unwrap());
}
#[test]
fn unknown_request_cancel_that_lost_to_post_keeps_original_workflow_cancellation() {
    let (_directory, _store, owner) = setup();
    let id = confirm(&owner);
    let original = exchange(&owner, DesktopForcedTakeoverExchangeKind::Request);
    let original: Value = serde_json::from_slice(original.request_bytes()).unwrap();
    owner
        .cancel_forced_takeover(&admission(&owner), &id)
        .unwrap();
    let cancel = exchange(&owner, DesktopForcedTakeoverExchangeKind::CancelIntent);
    let mut workflow = fixture("statusResponse")["workflow"].clone();
    workflow["request"]["status"] = json!("cancelled");
    workflow["workflowRevision"] = json!(2);
    assert!(matches!(
        complete(
            &owner,
            &cancel,
            &json!({"schemaVersion":1,"outcome":"workflow","originalRequest":original,"workflow":workflow})
        ),
        DesktopForcedTakeoverView::Finished {
            status: Terminal::Cancelled,
            ..
        }
    ));
}

fn authorize_restored_workspace(owner: &DesktopLocalHost) {
    let (_, grant) = super::super::authority::tests::long_lived_signed_grant_with_capabilities(
        2,
        &"22".repeat(32),
        "2099-12-31T23:59:59Z",
        2,
        &[],
    );
    owner.activate_authorization_grant(&bytes(&json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<Value>(&grant).unwrap()})).unwrap()).unwrap();
    assert!(owner.read_sync_snapshot().is_err());
    let request = owner.prepare_execution_context_request().unwrap();
    let parsed: Value = serde_json::from_slice(request.request_body()).unwrap();
    let response = super::super::authority::execution_context::test_response(
        &grant,
        parsed["nonce"].as_str().unwrap(),
    );
    let stage = owner
        .stage_execution_context_response(request, &response)
        .unwrap();
    owner.publish_staged_execution_context(stage).unwrap();
    assert!(owner.read_sync_snapshot().is_ok());
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(owner))
            .unwrap(),
        InstallWork::Settled(InstallView::Completed { .. })
    ));
    assert!(matches!(
        owner.forced_takeover_status(&admission(owner)).unwrap(),
        DesktopForcedTakeoverView::Finished {
            status: Terminal::Completed,
            ..
        }
    ));
    // A completed local install must reconcile the exact Cloud workflow, not wake a settled installer forever.
    let e = exchange(owner, DesktopForcedTakeoverExchangeKind::Status);
    let mut status = fixture("statusResponse");
    status["workflow"]["request"]["status"] = json!("completed");
    status["workflow"]["workflowRevision"] = json!(6);
    status["workflow"]["evaluatedAt"] = json!("2030-01-01T00:00:00Z");
    complete(owner, &e, &status);
    assert!(matches!(
        owner
            .prepare_forced_takeover_work(&admission(owner))
            .unwrap(),
        DesktopForcedTakeoverWork::Settled(DesktopForcedTakeoverView::Finished {
            status: Terminal::Completed,
            ..
        })
    ));
}
#[test]
fn forced_wire_and_journal_reject_duplicate_fields_missing_origin_and_foreign_terminal_scope() {
    assert!(wire::parse(br#"{"schemaVersion":1,"found":false,"found":true}"#).is_err());
    let (_directory, _store, owner) = setup();
    let id = request(&owner);
    observe(&owner, true);
    reserve(&owner);
    owner
        .cancel_forced_takeover(&admission(&owner), &id)
        .unwrap();
    observe(&owner, false);
    let cancel = exchange(&owner, DesktopForcedTakeoverExchangeKind::Cancel);
    complete(&owner, &cancel, &fixture("cancelResponse"));
    owner
        .prepare_target_installation_work(&admission(&owner))
        .unwrap();
    let original = {
        let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
        let state = custody.initial_replica_state().unwrap();
        serde_json::from_slice::<Value>(state.bytes.as_ref().unwrap()).unwrap()
    };
    for field in ["origin", "account", "workspace", "device"] {
        let mut invalid = original.clone();
        if field == "origin" {
            invalid.as_object_mut().unwrap().remove("origin");
        } else {
            invalid["terminalEvidence"]["record"][field] = json!("foreign");
        }
        {
            let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
            let state = custody.initial_replica_state().unwrap();
            custody
                .store_initial_replica_state(
                    state.revision,
                    state.scope.as_ref().unwrap(),
                    &bytes(&invalid).unwrap(),
                    state.phase,
                )
                .unwrap();
        }
        assert!(
            owner
                .target_installation_status(&admission(&owner))
                .is_err(),
            "{field}"
        );
        let custody = owner.production_custody.as_ref().unwrap().lock().unwrap();
        let state = custody.initial_replica_state().unwrap();
        custody
            .store_initial_replica_state(
                state.revision,
                state.scope.as_ref().unwrap(),
                &bytes(&original).unwrap(),
                state.phase,
            )
            .unwrap();
    }
}

#[test]
fn changed_security_epoch_cannot_publish_old_response_or_reuse_old_consent() {
    let (_directory, _store, owner) = setup();
    confirm(&owner);
    let old = admission(&owner);
    let original = exchange(&owner, DesktopForcedTakeoverExchangeKind::Request);
    let (_, changed) = super::super::authority::signed_standby_for_host_test(0, 3);
    owner.activate_authorization_grant(&changed).unwrap();
    assert!(
        owner
            .complete_forced_takeover_work(
                &old,
                &original,
                &bytes(&fixture("requestResponse")).unwrap()
            )
            .is_err()
    );
    assert!(matches!(
        owner.forced_takeover_status(&admission(&owner)).unwrap(),
        DesktopForcedTakeoverView::Stopped {
            reason: DesktopForcedTakeoverStoppedReason::AuthorizationChanged,
            can_cancel: false,
            ..
        }
    ));
    assert!(matches!(
        owner
            .prepare_forced_takeover_work(&admission(&owner))
            .unwrap(),
        DesktopForcedTakeoverWork::Settled(DesktopForcedTakeoverView::Stopped {
            reason: DesktopForcedTakeoverStoppedReason::AuthorizationChanged,
            ..
        })
    ));
}

#[test]
fn fresh_marker_does_not_authorize_claim_after_database_was_written() {
    let (directory, _store, owner) = setup();
    let id = request(&owner);
    observe(&owner, true);
    reserve(&owner);
    std::fs::OpenOptions::new()
        .write(true)
        .open(
            directory
                .path()
                .join("GoodDealer/active-workspace/business.db"),
        )
        .unwrap()
        .set_len(1)
        .unwrap();
    assert!(matches!(
        owner
            .prepare_target_installation_work(&admission(&owner))
            .unwrap(),
        InstallWork::Settled(_)
    ));
    assert!(matches!(
        owner
            .prepare_forced_takeover_work(&admission(&owner))
            .unwrap(),
        DesktopForcedTakeoverWork::Settled(DesktopForcedTakeoverView::Stopped {
            reason: DesktopForcedTakeoverStoppedReason::LocalRecoveryRequired,
            can_cancel: true,
            ..
        })
    ));
    owner
        .cancel_forced_takeover(&admission(&owner), &id)
        .unwrap();
    exchange(&owner, DesktopForcedTakeoverExchangeKind::Status);
}
