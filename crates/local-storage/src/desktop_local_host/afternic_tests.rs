//! Signed Host and `SQLCipher` composition. Native HTTP/custody are separately exercised by Core.
use super::super::*;
use super::*;

fn grant(revision: u64, caps: &[&str]) -> (WorkspaceAuthorityVerifier, Vec<u8>) {
    let (verifier, wire) = authority::tests::long_lived_signed_grant_with_capabilities(
        revision,
        &format!("{revision:064x}"),
        "2099-12-31T23:59:59Z",
        2,
        caps,
    );
    (verifier, serde_json::to_vec(&serde_json::json!({"schemaVersion":5,"role":"active","grant":serde_json::from_slice::<serde_json::Value>(&wire).unwrap()})).unwrap())
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
        domain: "inventory.test".into(),
        status: "OWNERSHIP_REVIEW".into(),
        buynow_price: Some(2_000_000_000),
        floor_price: None,
        minbid_price: None,
        hidden: None,
        created_at: "2026-11-01T00:00:00Z".into(),
        updated_at: "2026-11-01T00:00:00Z".into(),
    }
}
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one signed lifecycle proves prepared recovery across two reopens and cleanup after entitlement removal"
)]
fn afternic_host_prepared_recovers_under_current_grant_and_never_reuses_revoked_handle() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let store = TestRebootstrapKeyStore::default();
    let (verifier, first) = grant(2, &[OBSERVE]);
    let local = host(&path, store.clone(), verifier);
    local.activate_authorization_grant(&first).unwrap();
    assert!(
        local
            .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Inventory")
            .is_err()
    );
    let _qualified =
        crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
    let original = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Inventory")
        .unwrap();
    let id = original.connection_id().to_owned();
    let proof = original.public_proof().to_owned();
    let (_, next) = grant(3, &[OBSERVE]);
    local.activate_authorization_grant(&next).unwrap();
    assert!(local.recheck_afternic_connection(&original).is_err());
    let resumed = local
        .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    assert_eq!(resumed.public_proof(), proof);
    assert!(resumed.is_prepared());
    drop(original);
    drop(resumed);
    drop(local);
    let (verifier, _) = grant(3, &[OBSERVE]);
    let local = host(&path, store.clone(), verifier);
    local.activate_authorization_grant(&next).unwrap();
    let resumed = local
        .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    assert!(resumed.is_prepared());
    assert_eq!(resumed.public_proof(), proof);
    local
        .commit_afternic_inventory(&resumed, &[listing()])
        .unwrap();
    assert_eq!(
        local
            .read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new()
            })
            .unwrap()
            .total_rows,
        1
    );
    let summary = local.read_afternic_connections().unwrap();
    assert_eq!(
        summary.connections[0].last_scan.as_ref().unwrap().observed,
        1
    );
    drop(resumed);
    drop(local);
    let (verifier, _) = grant(3, &[OBSERVE]);
    let local = host(&path, store, verifier);
    local.activate_authorization_grant(&next).unwrap();
    let resumed = local
        .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    assert!(!resumed.is_prepared());
    assert_eq!(resumed.public_proof(), proof);
    local.commit_afternic_inventory(&resumed, &[]).unwrap();
    let revoked = local
        .revoke_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    // Keep observe permission here: this must fail because the slot is revoked, not because
    // another authority check happens to reject an unentitled caller first.
    assert!(local.recheck_afternic_connection(&revoked).is_err());
    assert!(local.recheck_afternic_purge(&revoked).is_ok());
    let pending = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Pending cleanup")
        .unwrap();
    // Removing commercial permission must not prevent a first revocation or slot cleanup.
    let (_, no_provider) = grant(4, &[]);
    local.activate_authorization_grant(&no_provider).unwrap();
    assert!(
        local
            .resume_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
            .is_err()
    );
    let revoked = local
        .revoke_afternic_connection(local.begin_native_cloud_run().unwrap(), &id)
        .unwrap();
    assert!(local.recheck_afternic_connection(&revoked).is_err());
    assert!(local.recheck_afternic_purge(&revoked).is_ok());
    local.confirm_afternic_purge(&revoked).unwrap();
    let first_revoke = local
        .revoke_afternic_connection(
            local.begin_native_cloud_run().unwrap(),
            pending.connection_id(),
        )
        .unwrap();
    assert!(local.recheck_afternic_purge(&first_revoke).is_ok());
    local.confirm_afternic_purge(&first_revoke).unwrap();
    assert!(
        local
            .read_afternic_connections()
            .unwrap()
            .connections
            .is_empty()
    );
    assert_eq!(
        local
            .read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new()
            })
            .unwrap()
            .total_rows,
        1
    );
}

#[test]
fn afternic_final_epoch_fence_rolls_back_inventory_assets_and_activation() {
    let tmp = crate::test_tempdir::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap().join("GoodDealer");
    let (verifier, wire) = grant(2, &[OBSERVE]);
    let local = host(&path, TestRebootstrapKeyStore::default(), verifier);
    local.activate_authorization_grant(&wire).unwrap();
    let _qualified =
        crate::active_workspace::capability_qualification::test_qualification::qualify(OBSERVE);
    let connection = local
        .prepare_afternic_connection(local.begin_native_cloud_run().unwrap(), "Inventory")
        .unwrap();
    let generation = local.business_status().read_generation;
    let result = local.with_sync_business_write(
        &connection.admission.inner,
        |sync, business, run, guard| {
            admitted(sync, run)?;
            business
                .database_for_backup_mut()
                .import_afternic_inventory(
                    &connection.seed,
                    &[listing()],
                    run.device_id(),
                    run.lease_epoch(),
                    &format_timestamp(current_unix_seconds().unwrap()),
                    || {
                        local
                            .transition_requested_epoch
                            .fetch_add(1, Ordering::AcqRel);
                        guard.verify(sync, run)
                    },
                )
                .map_err(database_error)
        },
    );
    assert!(result.is_err());
    let runtime = local.runtime_state.lock().unwrap();
    let business = &runtime.as_ref().unwrap().business;
    assert_eq!(business.read_generation(), generation);
    assert_eq!(
        business.read_asset_library(0, 10, "").unwrap().total_rows,
        0
    );
    let state = business
        .database_for_backup()
        .afternic_connections()
        .unwrap();
    assert_eq!(state[0].state, "prepared");
    assert!(state[0].last_scan.is_none());
}
