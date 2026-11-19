use super::*;
use crate::desktop_custody::{DesktopProductionCustody, TestRebootstrapKeyStore};
use crate::desktop_local_host::{
    DesktopApplicationRoot, DesktopHostAuthorizationStatus, authority,
};
use serde_json::{Value, json};
use std::sync::Mutex;

fn native_host(
    path: &std::path::Path,
    store: &TestRebootstrapKeyStore,
    epoch: u64,
) -> DesktopLocalHost {
    let root = DesktopApplicationRoot::validate(path).unwrap();
    let custody = DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
        &root,
        store.clone(),
    )
    .unwrap();
    let (verifier, wire) = authority::signed_standby_for_host_test(0, epoch);
    let host = DesktopLocalHost {
        application_root: Some(root),
        production_custody: Some(Mutex::new(custody)),
        authority_verifier: Some(verifier),
        ..DesktopLocalHost::default()
    };
    host.activate_authorization_grant(&wire).unwrap();
    host
}
fn fixture() -> (
    tempfile::TempDir,
    std::path::PathBuf,
    TestRebootstrapKeyStore,
    DesktopLocalHost,
) {
    let dir = crate::test_tempdir::tempdir().unwrap();
    let path = dir.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let host = native_host(&path, &store, 2);
    (dir, path, store, host)
}
fn answer(id: &str, state: &str, status: bool) -> Vec<u8> {
    let mut value = json!({"schemaVersion":1,"request":wire::tests::request_view(id,state)});
    value[if status { "found" } else { "accepted" }] = json!(true);
    serde_json::to_vec(&value).unwrap()
}
fn discover(host: &DesktopLocalHost, admission: &DesktopNativeCloudAdmission, id: &str) {
    let exchange = host.prepare_target_bootstrap_status(admission).unwrap();
    let (view, retry) = host
        .complete_target_bootstrap_status(admission, &exchange, &answer(id, "bootstrapping", true))
        .unwrap()
        .into_parts();
    assert!(
        matches!(view, DesktopTargetBootstrapView::Available {request_id,..} if request_id == id)
    );
    assert!(retry.is_none());
}
fn request_id(body: &[u8]) -> Value {
    serde_json::from_slice::<Value>(body).unwrap()["requestId"].clone()
}

#[test]
fn cancellation_without_business_replica_survives_lost_ack_and_restart() {
    let (_dir, path, store, host) = fixture();
    let admission = host.begin_native_cloud_read_run().unwrap();
    discover(&host, &admission, "original");
    let cancel = host
        .prepare_target_bootstrap_cancel(&admission, "original")
        .unwrap();
    assert_eq!(request_id(cancel.request_bytes()), json!("original"));
    assert!(
        host.prepare_target_bootstrap_cancel(&admission, "replacement")
            .is_err()
    );
    assert!(host.runtime_state.lock().unwrap().is_none());
    drop(host);
    let restarted = native_host(&path, &store, 2);
    let admission = restarted.begin_native_cloud_read_run().unwrap();
    let status = restarted
        .prepare_target_bootstrap_status(&admission)
        .unwrap();
    assert_eq!(request_id(status.request_bytes()), json!("original"));
    let (_, retry) = restarted
        .complete_target_bootstrap_status(
            &admission,
            &status,
            &answer("original", "bootstrapping", true),
        )
        .unwrap()
        .into_parts();
    let retry = retry.unwrap();
    assert_eq!(retry.request_bytes(), cancel.request_bytes());
    let terminal = restarted
        .complete_target_bootstrap_cancel(
            &admission,
            &retry,
            &answer("original", "cancelled", false),
        )
        .unwrap();
    assert!(matches!(
        terminal,
        DesktopTargetBootstrapView::Finished {
            status: DesktopTargetBootstrapTerminalStatus::Cancelled,
            ..
        }
    ));
    assert_eq!(
        restarted.authorization_status(),
        DesktopHostAuthorizationStatus::Standby
    );
    assert!(restarted.runtime_state.lock().unwrap().is_none());
    assert_eq!(
        std::fs::metadata(
            restarted
                .application_root
                .as_ref()
                .unwrap()
                .business_database_path()
        )
        .unwrap()
        .len(),
        0
    );
    drop(restarted);
    let resumed = native_host(&path, &store, 2);
    let admission = resumed.begin_native_cloud_read_run().unwrap();
    let status = resumed.prepare_target_bootstrap_status(&admission).unwrap();
    assert_eq!(request_id(status.request_bytes()), Value::Null);
    let outcome = resumed
        .complete_target_bootstrap_status(
            &admission,
            &status,
            br#"{"schemaVersion":1,"found":false}"#,
        )
        .unwrap();
    assert_eq!(outcome.view(), &terminal);
    discover(&resumed, &admission, "next-workflow");
    assert!(
        resumed
            .prepare_target_bootstrap_cancel(&admission, "original")
            .is_err()
    );
}

#[test]
fn rejected_cancel_and_missing_status_retain_exact_intent_without_blind_retry() {
    let (_dir, _path, _store, host) = fixture();
    let admission = host.begin_native_cloud_read_run().unwrap();
    discover(&host, &admission, "original");
    let cancel = host
        .prepare_target_bootstrap_cancel(&admission, "original")
        .unwrap();
    let pending = host
        .complete_target_bootstrap_cancel(
            &admission,
            &cancel,
            br#"{"schemaVersion":1,"accepted":false,"code":"SWITCH_NOT_CANCELLABLE"}"#,
        )
        .unwrap();
    assert!(matches!(
        pending,
        DesktopTargetBootstrapView::Pending { .. }
    ));
    assert!(
        host.complete_target_bootstrap_cancel(
            &admission,
            &cancel,
            &answer("original", "cancelled", false)
        )
        .is_err()
    );
    let status = host.prepare_target_bootstrap_status(&admission).unwrap();
    let (view, retry) = host
        .complete_target_bootstrap_status(
            &admission,
            &status,
            br#"{"schemaVersion":1,"found":false}"#,
        )
        .unwrap()
        .into_parts();
    assert_eq!(view, pending);
    assert!(retry.is_none());
    assert!(
        host.prepare_target_bootstrap_cancel(&admission, "original")
            .is_err()
    );
}
#[test]
fn newer_preview_and_authority_generation_reject_old_responses() {
    let (_dir, _path, _store, host) = fixture();
    let admission = host.begin_native_cloud_read_run().unwrap();
    let first = host.prepare_target_bootstrap_status(&admission).unwrap();
    let second = host.prepare_target_bootstrap_status(&admission).unwrap();
    assert!(
        host.complete_target_bootstrap_status(
            &admission,
            &first,
            &answer("old", "bootstrapping", true)
        )
        .is_err()
    );
    host.complete_target_bootstrap_status(
        &admission,
        &second,
        &answer("current", "bootstrapping", true),
    )
    .unwrap();
    assert!(
        host.prepare_target_bootstrap_cancel(&admission, "old")
            .is_err()
    );
    let pending = host
        .prepare_target_bootstrap_cancel(&admission, "current")
        .unwrap();
    let (_, wire) = authority::signed_standby_for_host_test(0, 3);
    host.activate_authorization_grant(&wire).unwrap();
    assert!(
        host.complete_target_bootstrap_cancel(
            &admission,
            &pending,
            &answer("current", "cancelled", false)
        )
        .is_err()
    );
    let fresh = host.begin_native_cloud_read_run().unwrap();
    assert!(
        host.complete_target_bootstrap_cancel(
            &fresh,
            &pending,
            &answer("current", "cancelled", false)
        )
        .is_err()
    );
    let status = host.prepare_target_bootstrap_status(&fresh).unwrap();
    let (_, retry) = host
        .complete_target_bootstrap_status(
            &fresh,
            &status,
            &answer("current", "bootstrapping", true),
        )
        .unwrap()
        .into_parts();
    assert!(retry.is_none());
    let renewed = host
        .prepare_target_bootstrap_cancel(&fresh, "current")
        .unwrap();
    assert_eq!(renewed.request_bytes(), pending.request_bytes());
    assert!(
        host.complete_target_bootstrap_cancel(
            &fresh,
            &pending,
            &answer("current", "cancelled", false)
        )
        .is_err()
    );
    let status = host.prepare_target_bootstrap_status(&fresh).unwrap();
    assert!(matches!(
        host.complete_target_bootstrap_status(&fresh, &status, &answer("current", "failed", true))
            .unwrap()
            .view(),
        DesktopTargetBootstrapView::Finished {
            status: DesktopTargetBootstrapTerminalStatus::Failed,
            ..
        }
    ));
}
#[test]
fn custody_scope_and_missing_nullable_field_fail_closed() {
    let (_dir, _path, _store, host) = fixture();
    let admission = host.begin_native_cloud_read_run().unwrap();
    host.prepare_target_bootstrap_status(&admission).unwrap();
    let custody = host.production_custody.as_ref().unwrap().lock().unwrap();
    let original = custody.load_target_bootstrap_control().unwrap().unwrap();
    drop(custody);
    for key in ["account", "workspace", "device", "installation", "pending"] {
        let mut record: Value = serde_json::from_slice(&original).unwrap();
        match key {
            "installation" => record[key] = json!(vec![0; 32]),
            "pending" => {
                record.as_object_mut().unwrap().remove(key);
            }
            _ => record[key] = json!("foreign"),
        }
        let invalid = serde_json::to_vec(&record).unwrap();
        let custody = host.production_custody.as_ref().unwrap().lock().unwrap();
        custody
            .replace_target_bootstrap_control(Some(&original), &invalid)
            .unwrap();
        drop(custody);
        assert!(
            host.prepare_target_bootstrap_status(&admission).is_err(),
            "{key}"
        );
        host.production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .replace_target_bootstrap_control(Some(&invalid), &original)
            .unwrap();
    }
}

#[test]
fn write_readback_failure_and_transition_after_durable_intent_never_publish() {
    for readback_failure in [false, true] {
        let (_dir, path, store, host) = fixture();
        let admission = host.begin_native_cloud_read_run().unwrap();
        discover(&host, &admission, "original");
        let probe = store.pause_target_bootstrap_after_write(readback_failure);
        std::thread::scope(|scope| {
            let task = scope.spawn(|| host.prepare_target_bootstrap_cancel(&admission, "original"));
            probe.persisted.wait();
            if !readback_failure {
                host.transition_requested_epoch
                    .fetch_add(1, Ordering::AcqRel);
            }
            probe.resume.wait();
            assert!(task.join().unwrap().is_err());
        });
        drop(host);
        let restarted = native_host(&path, &store, 2);
        let admission = restarted.begin_native_cloud_read_run().unwrap();
        let status = restarted
            .prepare_target_bootstrap_status(&admission)
            .unwrap();
        assert_eq!(request_id(status.request_bytes()), json!("original"));
        let (_, retry) = restarted
            .complete_target_bootstrap_status(
                &admission,
                &status,
                &answer("original", "bootstrapping", true),
            )
            .unwrap()
            .into_parts();
        assert!(retry.is_some());
    }
}
#[test]
fn transition_before_persist_does_not_create_cancellation_and_cas_rejects_overwrite() {
    let (_dir, _path, _store, host) = fixture();
    let admission = host.begin_native_cloud_read_run().unwrap();
    discover(&host, &admission, "original");
    let before = host
        .production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .load_target_bootstrap_control()
        .unwrap()
        .unwrap();
    let result = host.with_target_control(&admission, |record, _, _, _| {
        record.state = DesktopTargetBootstrapView::Idle;
        host.transition_requested_epoch
            .fetch_add(1, Ordering::AcqRel);
        Ok(())
    });
    assert!(result.is_err());
    let custody = host.production_custody.as_ref().unwrap().lock().unwrap();
    assert_eq!(
        custody.load_target_bootstrap_control().unwrap().unwrap(),
        before
    );
    assert!(
        custody
            .replace_target_bootstrap_control(None, b"{}")
            .is_err()
    );
    assert_eq!(
        custody.load_target_bootstrap_control().unwrap().unwrap(),
        before
    );
}
#[test]
fn concurrent_confirmations_can_create_only_one_durable_intent() {
    let (_dir, _path, _store, host) = fixture();
    let admission = host.begin_native_cloud_read_run().unwrap();
    discover(&host, &admission, "original");
    std::thread::scope(|scope| {
        let first = scope.spawn(|| host.prepare_target_bootstrap_cancel(&admission, "original"));
        let second = scope.spawn(|| host.prepare_target_bootstrap_cancel(&admission, "original"));
        assert_ne!(
            first.join().unwrap().is_ok(),
            second.join().unwrap().is_ok()
        );
    });
    let status = host.prepare_target_bootstrap_status(&admission).unwrap();
    assert_eq!(request_id(status.request_bytes()), json!("original"));
}

#[test]
fn established_missing_or_corrupt_control_cannot_become_a_new_discovery() {
    for missing in [false, true] {
        let (_dir, path, store, host) = fixture();
        let admission = host.begin_native_cloud_read_run().unwrap();
        discover(&host, &admission, "original");
        host.prepare_target_bootstrap_cancel(&admission, "original")
            .unwrap();
        drop(host);
        store.damage_target_bootstrap_record(missing);
        let host = native_host(&path, &store, 2);
        let admission = host.begin_native_cloud_read_run().unwrap();
        assert!(host.prepare_target_bootstrap_status(&admission).is_err());
        assert!(
            host.prepare_target_bootstrap_cancel(&admission, "original")
                .is_err()
        );
    }
}
#[test]
fn first_record_prefix_repairs_marker_only_after_validating_original_intent() {
    for corrupt in [false, true] {
        let (_dir, path, store, host) = fixture();
        let admission = host.begin_native_cloud_read_run().unwrap();
        discover(&host, &admission, "original");
        host.prepare_target_bootstrap_cancel(&admission, "original")
            .unwrap();
        drop(host);
        store.remove_target_bootstrap_marker();
        if corrupt {
            store.damage_target_bootstrap_record(false);
        }
        let host = native_host(&path, &store, 2);
        let admission = host.begin_native_cloud_read_run().unwrap();
        let status = host.prepare_target_bootstrap_status(&admission);
        if corrupt {
            assert!(status.is_err());
        } else {
            assert_eq!(
                request_id(status.unwrap().request_bytes()),
                json!("original")
            );
            // Successful repair establishes the missing-record fence without replacing the intent.
            store.damage_target_bootstrap_record(true);
            assert!(host.prepare_target_bootstrap_status(&admission).is_err());
        }
    }
}

#[test]
fn terminal_workflow_cannot_regress_to_available() {
    let (_dir, _path, _store, host) = fixture();
    let admission = host.begin_native_cloud_read_run().unwrap();
    discover(&host, &admission, "original");
    let cancel = host
        .prepare_target_bootstrap_cancel(&admission, "original")
        .unwrap();
    host.complete_target_bootstrap_cancel(
        &admission,
        &cancel,
        &answer("original", "cancelled", false),
    )
    .unwrap();
    let status = host.prepare_target_bootstrap_status(&admission).unwrap();
    assert!(
        host.complete_target_bootstrap_status(
            &admission,
            &status,
            &answer("original", "bootstrapping", true)
        )
        .is_err()
    );
    assert!(
        host.prepare_target_bootstrap_cancel(&admission, "original")
            .is_err()
    );
    discover(&host, &admission, "next");
}
