use super::super::authority::execution_context::{test_response, test_verifier};
use super::super::{DesktopProductionCustody, Mutex, TestRebootstrapKeyStore, authority};
use super::*;
use std::sync::atomic::AtomicU64;
pub(crate) struct TestNative {
    ticks: AtomicU64,
    boot: AtomicU64,
}
impl Default for TestNative {
    fn default() -> Self {
        Self {
            ticks: AtomicU64::new(1_000_000_000),
            boot: AtomicU64::new(1),
        }
    }
}
impl DesktopExecutionContextNativePort for TestNative {
    fn sign_afternic_delist_approval(&self, t: &[u8]) -> Result<[u8; 64], Error> {
        Ok(test_signature(t))
    }
    fn sign_device_audit_event(&self, t: &[u8]) -> Result<[u8; 64], Error> {
        Ok(test_signature(t))
    }
    fn sign_execution_fact(&self, t: &[u8]) -> Result<[u8; 64], Error> {
        Ok(test_signature(t))
    }

    fn capture_clock(&self) -> Result<DesktopContinuousClockReading, Error> {
        DesktopContinuousClockReading::from_native_parts(
            DesktopContinuousClockKind::LinuxBootNanoseconds,
            [u8::try_from(self.boot.load(Ordering::Acquire)).unwrap(); 16],
            self.ticks.load(Ordering::Acquire),
        )
    }
    fn signing_identity(&self) -> Result<DesktopExecutionSigningIdentity, Error> {
        DesktopExecutionSigningIdentity::from_native_parts("device-local", "device-test-key", {
            use ring::signature::KeyPair as _;
            ring::signature::Ed25519KeyPair::from_seed_unchecked(&[0x31; 32])
                .unwrap()
                .public_key()
                .as_ref()
                .try_into()
                .unwrap()
        })
    }
}
pub(crate) fn configure(host: &mut DesktopLocalHost, store: &TestRebootstrapKeyStore) {
    let native = Arc::new(TestNative::default());
    store.set_execution_test_binding(native.signing_identity().unwrap().binding());
    host.execution_context_native = Some(native);
    host.authority_verifier = Some(test_verifier(host.authority_verifier.take().unwrap()));
}
pub(crate) fn admit(host: &DesktopLocalHost, role: &[u8]) {
    let role: serde_json::Value = serde_json::from_slice(role).unwrap();
    let request = host.prepare_execution_context_request().unwrap();
    let request_value: serde_json::Value = serde_json::from_slice(request.request_body()).unwrap();
    let response = test_response(
        &serde_json::to_vec(&role["grant"]).unwrap(),
        request_value["nonce"].as_str().unwrap(),
    );
    host.complete_execution_context_request(request, &response)
        .unwrap();
}
fn fixture(
    path: &std::path::Path,
    store: TestRebootstrapKeyStore,
    native: Arc<TestNative>,
) -> (DesktopLocalHost, Vec<u8>) {
    let (verifier, grant) = authority::tests::long_lived_signed_grant_with_capabilities(
        2,
        &"22".repeat(32),
        "2099-12-31T23:59:59Z",
        2,
        &["afternic:marketplace:observe", "afternic:marketplace:write"],
    );
    store.set_execution_test_binding(native.signing_identity().unwrap().binding());
    let root = DesktopApplicationRoot::validate(path).unwrap();
    let custody =
        DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(&root, store)
            .unwrap();
    let host = DesktopLocalHost {
        application_root: Some(root),
        production_custody: Some(Mutex::new(custody)),
        authority_verifier: Some(test_verifier(verifier)),
        execution_context_native: Some(native),
        ..DesktopLocalHost::default()
    };
    let role=serde_json::to_vec(&serde_json::json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<serde_json::Value>(&grant).unwrap()})).unwrap();
    (host, role)
}
#[test]
fn continuous_time_includes_quantization_and_refuses_boot_regression_overflow_and_exact_expiry() {
    let start = DesktopContinuousClockReading::from_native_parts(
        DesktopContinuousClockKind::WindowsInterrupt100ns,
        [1; 16],
        1,
    )
    .unwrap();
    let mut end = start;
    end.ticks = 2;
    assert_eq!(end.elapsed(start), Ok(1));
    end.ticks = 10_001;
    assert_eq!(end.elapsed(start), Ok(1));
    end.ticks = 10_002;
    assert_eq!(end.elapsed(start), Ok(2));
    end.boot_id = [2; 16];
    assert_eq!(end.elapsed(start), Err(Error::Stale));
    end = start;
    end.ticks = 0;
    assert_eq!(end.elapsed(start), Err(Error::Stale));
    assert_eq!(upper_bound(100, 0, 102), Ok(101));
    assert_eq!(upper_bound(100, 1, 102), Err(Error::Expired));
    assert!(upper_bound(i64::MAX, u64::MAX, i64::MAX).is_err());
}
#[test]
fn signed_context_consumes_handles_preserves_t0_and_restores_only_same_boot() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let native = Arc::new(TestNative::default());
    let (host, role) = fixture(&path, store.clone(), native.clone());
    host.activate_authorization_grant(&role).unwrap();
    let dropped = host.prepare_execution_context_request().unwrap();
    assert_eq!(
        host.prepare_execution_context_request().unwrap_err(),
        Error::Busy
    );
    drop(dropped);
    admit(&host, &role);
    let stored = host
        .production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .load_authorization_record()
        .unwrap()
        .unwrap();
    assert_eq!(
        stored
            .execution_anchor
            .as_ref()
            .unwrap()
            .request_start_ticks,
        1_000_000_000
    );
    assert_eq!(stored.device_evidence_floor.unwrap().signing_key_version, 4);
    assert!(
        host.require_execution_context(&host.begin_native_cloud_run().unwrap().inner)
            .is_ok()
    );
    drop(host);
    native.ticks.store(2_000_000_000, Ordering::Release);
    let (host, _) = fixture(&path, store.clone(), native.clone());
    assert_eq!(host.restore_execution_context(), Ok(true));
    drop(host);
    native.boot.store(2, Ordering::Release);
    let (host, _) = fixture(&path, store, native);
    assert_eq!(host.restore_execution_context(), Err(Error::Stale));
    assert!(host.begin_native_cloud_run().is_err());
}
#[test]
fn malformed_nonce_delayed_response_and_concurrent_restriction_never_publish() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let native = Arc::new(TestNative::default());
    let (host, role) = fixture(&path, TestRebootstrapKeyStore::default(), native.clone());
    host.activate_authorization_grant(&role).unwrap();
    let request = host.prepare_execution_context_request().unwrap();
    assert_eq!(
        host.complete_execution_context_request(request, b"{}"),
        Err(Error::Rejected)
    );
    let request = host.prepare_execution_context_request().unwrap();
    native.ticks.fetch_add(30_000_000_001, Ordering::AcqRel);
    assert_eq!(
        host.complete_execution_context_request(request, b"{}"),
        Err(Error::Expired)
    );
    admit(&host, &role);
    let request = host.prepare_execution_context_request().unwrap();
    let nonce: serde_json::Value = serde_json::from_slice(request.request_body()).unwrap();
    let grant: serde_json::Value = serde_json::from_slice(&role).unwrap();
    let response = test_response(
        &serde_json::to_vec(&grant["grant"]).unwrap(),
        nonce["nonce"].as_str().unwrap(),
    );
    host.enter_security_lock().unwrap();
    assert_eq!(
        host.complete_execution_context_request(request, &response),
        Err(Error::Stale)
    );
    assert!(
        host.production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .load_authorization_record()
            .unwrap()
            .unwrap()
            .execution_anchor
            .is_none()
    );
}

#[test]
fn final_fence_after_persistence_clears_anchor_and_closes_older_in_memory_authority() {
    use std::sync::Barrier;
    struct RacingNative {
        inner: TestNative,
        calls: AtomicU64,
        arrival: Arc<Barrier>,
        release: Arc<Barrier>,
    }
    impl DesktopExecutionContextNativePort for RacingNative {
        fn sign_afternic_delist_approval(&self, t: &[u8]) -> Result<[u8; 64], Error> {
            Ok(test_signature(t))
        }
        fn sign_device_audit_event(&self, t: &[u8]) -> Result<[u8; 64], Error> {
            Ok(test_signature(t))
        }
        fn sign_execution_fact(&self, t: &[u8]) -> Result<[u8; 64], Error> {
            Ok(test_signature(t))
        }

        fn signing_identity(&self) -> Result<DesktopExecutionSigningIdentity, Error> {
            self.inner.signing_identity()
        }
        fn capture_clock(&self) -> Result<DesktopContinuousClockReading, Error> {
            if self.calls.fetch_add(1, Ordering::AcqRel) == 3 {
                self.arrival.wait();
                self.release.wait();
            }
            self.inner.capture_clock()
        }
    }
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (mut host, role) = fixture(&path, store.clone(), Arc::new(TestNative::default()));
    host.activate_authorization_grant(&role).unwrap();
    admit(&host, &role);
    let arrival = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    host.execution_context_native = Some(Arc::new(RacingNative {
        inner: TestNative::default(),
        calls: AtomicU64::new(0),
        arrival: arrival.clone(),
        release: release.clone(),
    }));
    let request = host.prepare_execution_context_request().unwrap();
    let req: serde_json::Value = serde_json::from_slice(request.request_body()).unwrap();
    let grant: serde_json::Value = serde_json::from_slice(&role).unwrap();
    let response = test_response(
        &serde_json::to_vec(&grant["grant"]).unwrap(),
        req["nonce"].as_str().unwrap(),
    );
    std::thread::scope(|scope| {
        let complete = scope.spawn(|| host.complete_execution_context_request(request, &response));
        arrival.wait();
        host.transition_requested_epoch
            .fetch_add(1, Ordering::AcqRel);
        release.wait();
        assert_eq!(complete.join().unwrap(), Err(Error::Stale));
    });
    assert!(
        host.execution_context_state
            .lock()
            .unwrap()
            .current
            .is_none()
    );
    assert!(host.begin_native_cloud_run().is_err());
    let record = host
        .production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .load_authorization_record()
        .unwrap()
        .unwrap();
    assert!(record.execution_anchor.is_none());
    assert_eq!(record.device_evidence_floor.unwrap().credential_epoch, 3);
    drop(host);
    let (host, _) = fixture(&path, store, Arc::new(TestNative::default()));
    assert_eq!(host.restore_execution_context(), Ok(false));
}

#[test]
fn grant_only_or_republished_role_never_authorizes_new_provider_execution() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (host, role) = fixture(
        &path,
        TestRebootstrapKeyStore::default(),
        Arc::new(TestNative::default()),
    );
    host.activate_authorization_grant(&role).unwrap();
    let read = host.begin_native_cloud_run().unwrap();
    assert!(host.recheck_native_cloud(&read).is_ok());
    assert!(host.require_execution_context(&read.inner).is_err());
    admit(&host, &role);
    let run = host.begin_native_cloud_run().unwrap();
    assert!(host.require_execution_context(&run.inner).is_ok());
    host.activate_authorization_grant(&role).unwrap();
    assert!(
        host.require_execution_context(&host.begin_native_cloud_run().unwrap().inner)
            .is_err()
    );
    assert!(
        host.production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .load_authorization_record()
            .unwrap()
            .unwrap()
            .execution_anchor
            .is_none()
    );
}

#[test]
fn higher_lease_epoch_and_standby_demotion_consume_old_requests_and_bar_restore() {
    for standby in [false, true] {
        let tmp = crate::test_tempdir::tempdir().unwrap();
        let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
        let (mut host, role) = fixture(
            &path,
            TestRebootstrapKeyStore::default(),
            Arc::new(TestNative::default()),
        );
        let (standby_verifier, standby_wire) = authority::signed_standby_for_host_test(3, 2);
        host.authority_verifier = Some(test_verifier(standby_verifier));
        host.activate_authorization_grant(&role).unwrap();
        admit(&host, &role);
        let request = host.prepare_execution_context_request().unwrap();
        let req: serde_json::Value = serde_json::from_slice(request.request_body()).unwrap();
        let grant: serde_json::Value = serde_json::from_slice(&role).unwrap();
        let response = test_response(
            &serde_json::to_vec(&grant["grant"]).unwrap(),
            req["nonce"].as_str().unwrap(),
        );
        let replacement = if standby {
            standby_wire
        } else {
            let (_, wire) = authority::tests::long_lived_signed_grant_with_capabilities(
                2,
                &"22".repeat(32),
                "2099-12-31T23:59:59Z",
                3,
                &["afternic:marketplace:observe", "afternic:marketplace:write"],
            );
            serde_json::to_vec(&serde_json::json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<serde_json::Value>(&wire).unwrap()})).unwrap()
        };
        host.activate_authorization_grant(&replacement).unwrap();
        assert_eq!(
            host.complete_execution_context_request(request, &response),
            Err(Error::Stale)
        );
        assert_eq!(host.restore_execution_context(), Ok(false));
        let record = host
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .load_authorization_record()
            .unwrap()
            .unwrap();
        assert_eq!(record.floor.maximum_lease_epoch, 3);
        assert!(record.execution_anchor.is_none());
        if standby {
            assert_eq!(
                host.authorization_status(),
                super::super::DesktopHostAuthorizationStatus::Standby
            );
        }
    }
}

fn test_signature(transcript: &[u8]) -> [u8; 64] {
    ring::signature::Ed25519KeyPair::from_seed_unchecked(&[0x31; 32])
        .unwrap()
        .sign(transcript)
        .as_ref()
        .try_into()
        .unwrap()
}

fn stage_response(host: &DesktopLocalHost, role: &[u8]) -> DesktopStagedExecutionContext {
    let request = host.prepare_execution_context_request().unwrap();
    let nonce: serde_json::Value = serde_json::from_slice(request.request_body()).unwrap();
    let grant: serde_json::Value = serde_json::from_slice(role).unwrap();
    let response = test_response(
        &serde_json::to_vec(&grant["grant"]).unwrap(),
        nonce["nonce"].as_str().unwrap(),
    );
    host.stage_execution_context_response(request, &response)
        .unwrap()
}
#[test]
fn staged_anchor_closes_old_execution_and_publishes_without_acquiring_custody() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (host, role) = fixture(
        &path,
        TestRebootstrapKeyStore::default(),
        Arc::new(TestNative::default()),
    );
    host.activate_authorization_grant(&role).unwrap();
    admit(&host, &role);
    let old = host.begin_native_cloud_run().unwrap();
    let stage = stage_response(&host, &role);
    assert!(host.begin_native_cloud_run().is_err());
    assert!(host.require_execution_context(&old.inner).is_err());
    assert!(
        host.runtime_state
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .sync
            .is_none()
    );
    // Holding custody across publication proves the final power-guarded operation cannot reach it.
    let custody = host.production_custody.as_ref().unwrap().lock().unwrap();
    std::thread::scope(|scope| {
        let (send, receive) = std::sync::mpsc::channel();
        let host_ref = &host;
        let task = scope.spawn(move || {
            send.send(host_ref.publish_staged_execution_context(stage))
                .unwrap();
        });
        let result = receive.recv_timeout(std::time::Duration::from_secs(2));
        drop(custody);
        task.join().unwrap();
        assert_eq!(result.unwrap(), Ok(()));
    });
    assert!(
        host.require_execution_context(&host.begin_native_cloud_run().unwrap().inner)
            .is_ok()
    );
}
#[test]
fn staged_publication_rechecks_generation_clock_and_original_time_origin() {
    for changed_generation in [false, true] {
        let tmp = crate::test_tempdir::tempdir().unwrap();
        let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
        let native = Arc::new(TestNative::default());
        let (host, role) = fixture(&path, TestRebootstrapKeyStore::default(), native.clone());
        host.activate_authorization_grant(&role).unwrap();
        let stage = stage_response(&host, &role);
        if changed_generation {
            host.transition_requested_epoch
                .fetch_add(1, Ordering::AcqRel);
        } else {
            native.boot.store(2, Ordering::Release);
        }
        assert_eq!(
            host.publish_staged_execution_context(stage),
            Err(Error::Stale)
        );
        assert!(host.begin_native_cloud_run().is_err());
    }
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let native = Arc::new(TestNative::default());
    let (host, role) = fixture(&path, TestRebootstrapKeyStore::default(), native.clone());
    host.activate_authorization_grant(&role).unwrap();
    let stage = stage_response(&host, &role);
    let expires = stage.current.expires;
    let observed = stage.current.observed;
    let elapsed = u64::try_from(expires - observed).unwrap() * 1_000_000_000;
    native.ticks.fetch_add(elapsed, Ordering::AcqRel);
    assert_eq!(
        host.publish_staged_execution_context(stage),
        Err(Error::Expired)
    );
    assert!(host.begin_native_cloud_run().is_err());
}
#[test]
fn dropped_and_foreign_stages_never_publish_and_restore_requires_its_own_stage() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let native = Arc::new(TestNative::default());
    let (host, role) = fixture(&path, store.clone(), native.clone());
    host.activate_authorization_grant(&role).unwrap();
    let stage = stage_response(&host, &role);
    let other = DesktopLocalHost::default();
    assert!(other.publish_staged_execution_context(stage).is_err());
    assert!(host.begin_native_cloud_run().is_err());
    drop(host);
    let (host, _) = fixture(&path, store, native);
    let first = host.stage_execution_context_restore().unwrap().unwrap();
    assert!(host.begin_native_cloud_run().is_err());
    let current = host.stage_execution_context_restore().unwrap().unwrap();
    assert_eq!(
        host.publish_staged_execution_context(first),
        Err(Error::Stale)
    );
    host.publish_staged_execution_context(current).unwrap();
    assert!(host.begin_native_cloud_run().is_ok());
}

#[test]
fn failed_response_stage_cannot_leave_an_older_executable_context() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (host, role) = fixture(
        &path,
        TestRebootstrapKeyStore::default(),
        Arc::new(TestNative::default()),
    );
    host.activate_authorization_grant(&role).unwrap();
    admit(&host, &role);
    let old = host.begin_native_cloud_run().unwrap();
    let request = host.prepare_execution_context_request().unwrap();
    assert!(
        host.stage_execution_context_response(request, b"{}")
            .is_err()
    );
    assert!(host.require_execution_context(&old.inner).is_err());
    // Valid current authorization can request a fresh context with a new nonce and original t0.
    admit(&host, &role);
    assert!(
        host.require_execution_context(&host.begin_native_cloud_run().unwrap().inner)
            .is_ok()
    );
}
