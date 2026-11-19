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
        "schemaVersion": 4, "role": "active",
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
