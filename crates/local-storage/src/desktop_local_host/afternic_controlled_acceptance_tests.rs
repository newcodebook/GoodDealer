use super::super::*;
use crate::{
    DesktopAfternicDelistStatusRequest, DesktopAfternicListingObservation,
    DesktopAfternicListingWriteApproveRequest, DesktopAfternicListingWritePlan,
    DesktopAfternicListingWritePreviewRequest, DesktopAfternicListingWriteStatusRequest,
};
use crate::{
    DesktopContinuousClockKind, DesktopContinuousClockReading, DesktopExecutionContextError,
    DesktopExecutionContextNativePort, DesktopExecutionSigningIdentity,
};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64};
const OBSERVE: &str = "afternic:marketplace:observe";
const WRITE: &str = "afternic:marketplace:write";
const BASE: u64 = 1_000_000_000;
struct Native {
    inner: execution_context::tests::TestNative,
    ticks: AtomicU64,
    expire_on_sign: AtomicBool,
}
impl Default for Native {
    fn default() -> Self {
        Self {
            inner: execution_context::tests::TestNative::default(),
            ticks: AtomicU64::new(BASE),
            expire_on_sign: AtomicBool::new(false),
        }
    }
}
impl Native {
    fn expire(&self) {
        self.ticks
            .store(BASE + 14 * 24 * 60 * 60 * 1_000_000_000, Ordering::Release);
    }
    fn signed(&self) {
        if self.expire_on_sign.load(Ordering::Acquire) {
            self.expire();
        }
    }
}
impl DesktopExecutionContextNativePort for Native {
    fn sign_afternic_delist_approval(
        &self,
        t: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.signed();
        self.inner.sign_afternic_delist_approval(t)
    }
    fn sign_afternic_listing_write_approval(
        &self,
        t: &[u8],
    ) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.signed();
        self.inner.sign_afternic_listing_write_approval(t)
    }
    fn sign_device_audit_event(&self, t: &[u8]) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.signed();
        self.inner.sign_device_audit_event(t)
    }
    fn sign_execution_fact(&self, t: &[u8]) -> Result<[u8; 64], DesktopExecutionContextError> {
        self.signed();
        self.inner.sign_execution_fact(t)
    }
    fn signing_identity(
        &self,
    ) -> Result<DesktopExecutionSigningIdentity, DesktopExecutionContextError> {
        self.inner.signing_identity()
    }
    fn capture_clock(&self) -> Result<DesktopContinuousClockReading, DesktopExecutionContextError> {
        DesktopContinuousClockReading::from_native_parts(
            DesktopContinuousClockKind::LinuxBootNanoseconds,
            [1; 16],
            self.ticks.load(Ordering::Acquire),
        )
    }
}
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
    store: &TestRebootstrapKeyStore,
    verifier: WorkspaceAuthorityVerifier,
    native: Arc<Native>,
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
    execution_context::tests::configure(&mut host, store);
    host.execution_context_native = Some(native);
    host
}
fn fixture() -> (
    tempfile::TempDir,
    std::path::PathBuf,
    TestRebootstrapKeyStore,
    Arc<Native>,
    DesktopLocalHost,
    Vec<u8>,
) {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let native = Arc::new(Native::default());
    let (v, wire) = grant(2, &[OBSERVE, WRITE]);
    let local = host(&path, &store, v, native.clone());
    local.activate_authorization_grant(&wire).unwrap();
    execution_context::tests::admit(&local, &wire);
    (tmp, path, store, native, local, wire)
}
fn listing(domain: &str) -> DesktopAfternicListingObservation {
    DesktopAfternicListingObservation {
        domain: domain.into(),
        status: "ACTIVE".into(),
        buynow_price: Some(100_000_000),
        floor_price: Some(0),
        minbid_price: Some(20_000_000),
        hidden: Some(false),
        created_at: "2026-11-01T00:00:00Z".into(),
        updated_at: "2026-11-01T00:00:00Z".into(),
    }
}
fn connect(local: &DesktopLocalHost) -> String {
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Acceptance")
        .unwrap();
    let id = connection.connection_id().to_owned();
    local
        .commit_afternic_inventory(&connection, &[listing("wecin.com"), listing("other.test")])
        .unwrap();
    id
}
fn preview(
    local: &DesktopLocalHost,
    id: &str,
    domain: &str,
    action: &str,
) -> Result<DesktopAfternicListingWritePlan, DesktopLocalHostError> {
    let item = if action == "create" {
        serde_json::json!({"domain":domain,"values":{"buynowPriceMicroUsd":0,"floorPriceMicroUsd":0,"minbidPriceMicroUsd":20_000_000,"hidden":false}})
    } else {
        serde_json::json!({"domain":domain,"patch":{"buynowPriceMicroUsd":0,"hidden":false}})
    };
    let request: DesktopAfternicListingWritePreviewRequest = serde_json::from_value(
        serde_json::json!({"schemaVersion":1,"connectionId":id,"action":action,"items":[item]}),
    )
    .unwrap();
    local.preview_afternic_listing_write(local.begin_native_cloud_run().unwrap(), request)
}
fn approve(
    local: &DesktopLocalHost,
    plan: &DesktopAfternicListingWritePlan,
) -> Result<DesktopAfternicListingWritePlan, DesktopLocalHostError> {
    local.approve_afternic_listing_write(
        local.begin_native_cloud_run().unwrap(),
        DesktopAfternicListingWriteApproveRequest {
            schema_version: 1,
            plan_ref: plan.plan_ref.clone(),
            plan_hash: plan.plan_hash.clone(),
        },
    )
}
fn corpus(local: &DesktopLocalHost, label: &str) -> serde_json::Value {
    serde_json::json!({"label":label,"connections":local.read_afternic_connections().unwrap(),"delist":local.read_afternic_delist_status(DesktopAfternicDelistStatusRequest{schema_version:1,plan_ref:None}).unwrap(),"listingWrite":local.read_afternic_listing_write_status(DesktopAfternicListingWriteStatusRequest{schema_version:1,plan_ref:None}).unwrap()})
}
fn count(local: &DesktopLocalHost, table: &str) -> i64 {
    local
        .with_authorized_business(false, |runtime, _, _, _| {
            Ok(runtime
                .database_for_backup_mut()
                .backup_connection_mut()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap())
        })
        .unwrap()
}
#[test]
fn controlled_acceptance_host_binds_once_keeps_qualification_false_and_exports_real_status_contracts()
 {
    let (_tmp, _path, _store, _native, local, _wire) = fixture();
    let mut rows = vec![corpus(&local, "unbound")];
    assert!(
        !rows[0]["connections"]["observeQualified"]
            .as_bool()
            .unwrap()
    );
    assert!(rows[0]["connections"]["controlledAcceptance"]["connectionId"].is_null());
    let id = connect(&local);
    rows.push(corpus(&local, "bound"));
    assert_eq!(
        rows[1]["connections"]["controlledAcceptance"]["connectionId"],
        id
    );
    assert!(
        local
            .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Second")
            .is_err()
    );
    assert_eq!(count(&local, "local_provider_connections"), 1);
    assert!(preview(&local, &id, "other.test", "update").is_err());
    assert!(
        local
            .preview_afternic_delist(
                local.begin_native_cloud_run().unwrap(),
                crate::DesktopAfternicDelistPreviewRequest {
                    schema_version: 1,
                    connection_id: id.clone(),
                    domains: vec!["other.test".into()]
                }
            )
            .is_err()
    );
    let revoked = local
        .revoke_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    local.confirm_afternic_purge(&revoked).unwrap();
    rows.push(corpus(&local, "revoked"));
    assert!(rows[2]["connections"]["controlledAcceptance"].is_null());
    assert_eq!(count(&local, "afternic_controlled_acceptance_runs"), 1);
    if let Ok(path) = std::env::var("GOODDEALER_TEST_AFTERNIC_ACCEPTANCE_CONTRACT_OUTPUT") {
        std::fs::write(path, serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
    }
}
#[test]
fn controlled_acceptance_host_closes_restart_to_get_and_requires_current_entitlement() {
    let (_tmp, path, store, _native, local, _wire) = fixture();
    let id = connect(&local);
    let plan = preview(&local, &id, "wecin.com", "update").unwrap();
    approve(&local, &plan).unwrap();
    let work = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let claim = local
        .claim_afternic_listing_write(work, Some(listing("wecin.com")))
        .unwrap()
        .unwrap();
    drop(claim);
    drop(local);
    let (v, wire) = grant(3, &[OBSERVE]);
    let native = Arc::new(Native::default());
    let local = host(&path, &store, v, native);
    local.activate_authorization_grant(&wire).unwrap();
    assert!(
        local
            .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
            .is_err()
    );
    execution_context::tests::admit(&local, &wire);
    assert!(
        local
            .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
            .is_ok()
    );
    assert!(approve(&local, &plan).is_err());
    let work = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(
        work.kind(),
        crate::DesktopAfternicListingWriteWorkKind::Reconcile
    );
    let mut observed = listing("wecin.com");
    observed.buynow_price = Some(0);
    local
        .reconcile_afternic_listing_write(&work, Some(observed))
        .unwrap();
    assert_eq!(count(&local, "device_execution_fact_outbox"), 1);
    let status = local
        .read_afternic_listing_write_status(DesktopAfternicListingWriteStatusRequest {
            schema_version: 1,
            plan_ref: Some(plan.plan_ref),
        })
        .unwrap();
    assert_eq!(status.detail.unwrap().state, "completed");
    assert!(!status.write_entitled);
    assert!(status.controlled_acceptance.is_none());
}
#[test]
fn controlled_acceptance_host_remove_then_create_uses_original_binding_and_single_claims() {
    let (_tmp, _path, _store, _native, local, _wire) = fixture();
    let id = connect(&local);
    let delist = local
        .preview_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            crate::DesktopAfternicDelistPreviewRequest {
                schema_version: 1,
                connection_id: id.clone(),
                domains: vec!["wecin.com".into()],
            },
        )
        .unwrap();
    local
        .approve_afternic_delist(
            local.begin_native_cloud_run().unwrap(),
            crate::DesktopAfternicDelistApproveRequest {
                schema_version: 1,
                plan_ref: delist.plan_ref,
                plan_hash: delist.plan_hash,
            },
        )
        .unwrap();
    let work = local
        .next_afternic_delist_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let claim = local
        .claim_afternic_delist(work, Some(listing("wecin.com")))
        .unwrap()
        .unwrap();
    let work = claim.into_reconciliation();
    local.reconcile_afternic_delist(&work, None).unwrap();
    let connection = local
        .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    local
        .commit_afternic_inventory(&connection, &[listing("other.test")])
        .unwrap();
    let plan = preview(&local, &id, "wecin.com", "create").unwrap();
    approve(&local, &plan).unwrap();
    let work = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let duplicate = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let claim = local
        .claim_afternic_listing_write(work, None)
        .unwrap()
        .unwrap();
    assert!(local.claim_afternic_listing_write(duplicate, None).is_err());
    let work = claim.into_reconciliation();
    let mut observed = listing("wecin.com");
    observed.buynow_price = Some(0);
    observed.created_at = "2026-11-19T01:00:00Z".into();
    local
        .reconcile_afternic_listing_write(&work, Some(observed))
        .unwrap();
    assert_eq!(count(&local, "device_execution_fact_outbox"), 2);
    assert_eq!(count(&local, "afternic_controlled_acceptance_runs"), 1);
}
#[test]
fn controlled_acceptance_host_expiry_during_signing_rolls_back_approval_and_all_audits() {
    let (_tmp, _path, _store, native, local, _wire) = fixture();
    let id = connect(&local);
    let plan = preview(&local, &id, "wecin.com", "update").unwrap();
    native.expire_on_sign.store(true, Ordering::Release);
    assert!(approve(&local, &plan).is_err());
    assert_eq!(count(&local, "operations"), 0);
    assert_eq!(count(&local, "workspace_device_audit_outbox"), 0);
    assert_eq!(count(&local, "afternic_listing_approvals"), 0);
    assert!(
        local
            .read_afternic_connections()
            .unwrap()
            .controlled_acceptance
            .is_none()
    );
}
#[test]
fn controlled_acceptance_host_expiry_after_dispatch_preserves_unknown_and_blocks_late_results() {
    let (_tmp, _path, _store, native, local, _wire) = fixture();
    let id = connect(&local);
    let plan = preview(&local, &id, "wecin.com", "update").unwrap();
    approve(&local, &plan).unwrap();
    let work = local
        .next_afternic_listing_write_work(local.begin_native_cloud_run().unwrap())
        .unwrap()
        .unwrap();
    let claim = local
        .claim_afternic_listing_write(work, Some(listing("wecin.com")))
        .unwrap()
        .unwrap();
    let work = claim.into_reconciliation();
    native.expire();
    assert!(local.recheck_afternic_listing_write_work(&work).is_err());
    assert!(
        local
            .reconcile_afternic_listing_write(&work, Some(listing("wecin.com")))
            .is_err()
    );
    assert!(
        local
            .defer_afternic_listing_write_read(&work, None)
            .is_err()
    );
    assert_eq!(count(&local, "device_execution_fact_outbox"), 1);
    assert_eq!(count(&local, "afternic_listing_write_reconciliations"), 0);
}
#[test]
fn controlled_acceptance_host_refuses_clock_regression_and_current_authority_change() {
    let (_tmp, _path, _store, native, local, _wire) = fixture();
    let id = connect(&local);
    let connection = local
        .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    native.ticks.store(BASE - 1, Ordering::Release);
    assert!(local.recheck_afternic_connection(&connection).is_err());
    let (_, wire) = grant(3, &[]);
    local.activate_authorization_grant(&wire).unwrap();
    assert!(
        local
            .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
            .is_err()
    );
    assert!(
        local
            .read_afternic_connections()
            .unwrap()
            .controlled_acceptance
            .is_none()
    );
}
