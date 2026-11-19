use super::super::PrivateWorkspaceAuthority;
use super::*;

fn publish_standby(host: &DesktopLocalHost) {
    let now = current_unix_seconds().unwrap();
    let mut publication = host.authority_publication.lock().unwrap();
    publication.authority = Some(PrivateWorkspaceAuthority {
        kind: WorkspaceAuthorityKind::Standby,
        account_id: "account-local".to_owned(),
        workspace_id: "workspace-local".to_owned(),
        device_id: "device-local".to_owned(),
        lease_epoch: 0,
        account_security_epoch: 1,
        entitlement_revision: 0,
        entitlement_projection_digest: String::new(),
        commercial_expires_at: String::new(),
        capabilities: Vec::new(),
        generation: 2,
        trusted_time_floor: now,
        execute_before: now + 600,
        digest: [0x43; 32],
    });
    publication.restriction = RuntimeRestriction::Standby;
    publication.applied_authority_epoch = 2;
    host.transition_requested_epoch.store(2, Ordering::Release);
    if let Some(runtime) = host.runtime_state.lock().unwrap().as_mut() {
        runtime.sync = None;
    }
}

#[test]
fn standby_directory_admission_needs_no_database_and_cannot_be_used_for_execution() {
    let host = DesktopLocalHost::default();
    publish_standby(&host);
    let admission = host.begin_native_cloud_read_run().unwrap();
    assert!(!admission.is_active());
    assert!(host.runtime_state.lock().unwrap().is_none());
    assert_eq!(host.fast_recheck_native_cloud(&admission), Ok(()));
    assert_eq!(host.recheck_native_cloud(&admission), Ok(()));
    assert_eq!(host.native_device_switch_in_progress(&admission), Ok(None));
    assert_eq!(
        host.begin_native_cloud_run().unwrap_err(),
        DesktopLocalHostError::AuthorityRejected
    );
    assert!(matches!(
        host.claim_native_sync_push(&admission),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.claim_native_cloudflare_projection(&admission),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.prepare_native_sync_pull(&admission),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(host.read_settings().is_err());
    assert_eq!(
        crate::desktop_sync_runtime::delivery_owner(&admission.inner),
        Err(DesktopSyncError::StaleAuthority)
    );
}

#[test]
fn standby_read_admission_is_exact_and_cannot_survive_revocation_or_a_transition() {
    let mutations: [fn(&mut PrivateWorkspaceAuthority); 6] = [
        |authority| authority.workspace_id = "workspace-other".to_owned(),
        |authority| authority.device_id = "device-other".to_owned(),
        |authority| authority.lease_epoch += 1,
        |authority| authority.digest = [0x44; 32],
        |authority| authority.execute_before += 1,
        |authority| authority.trusted_time_floor -= 1,
    ];
    for mutate in mutations {
        let host = DesktopLocalHost::default();
        publish_standby(&host);
        let admission = host.begin_native_cloud_read_run().unwrap();
        mutate(
            host.authority_publication
                .lock()
                .unwrap()
                .authority
                .as_mut()
                .unwrap(),
        );
        assert_eq!(
            host.recheck_native_cloud(&admission),
            Err(DesktopLocalHostError::AuthorityRejected)
        );
    }
    let host = DesktopLocalHost::default();
    publish_standby(&host);
    let admission = host.begin_native_cloud_read_run().unwrap();
    host.transition_requested_epoch.store(3, Ordering::Release);
    assert_eq!(
        host.fast_recheck_native_cloud(&admission),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
    assert_eq!(
        host.recheck_native_cloud(&admission),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
    assert!(host.begin_native_cloud_read_run().is_err());
    host.transition_requested_epoch.store(2, Ordering::Release);
    host.authority_publication.lock().unwrap().restriction = RuntimeRestriction::SecurityLocked;
    assert!(host.recheck_native_cloud(&admission).is_err());
    assert!(host.begin_native_cloud_read_run().is_err());
}

#[test]
fn standby_expiry_and_clock_rollback_close_admission() {
    for expires in [true, false] {
        let host = DesktopLocalHost::default();
        publish_standby(&host);
        let now = current_unix_seconds().unwrap();
        let mut publication = host.authority_publication.lock().unwrap();
        let authority = publication.authority.as_mut().unwrap();
        if expires {
            authority.execute_before = now;
        } else {
            authority.trusted_time_floor = now + 600;
        }
        drop(publication);
        assert!(host.begin_native_cloud_read_run().is_err());
    }
}

#[cfg(unix)]
#[test]
fn standby_keeps_the_existing_replica_read_only_and_freezes_inbox_and_outbox() {
    let directory = crate::test_tempdir::tempdir().unwrap();
    let mut database = BusinessDatabase::open(
        &directory.path().join("business.db"),
        &crate::LocalDatabaseKey::from_bytes([0x6a; 32]),
        "workspace-local",
    )
    .unwrap();
    database
        .create_domain_asset_guarded(
            "mutation-local",
            "device-local",
            1,
            "2026-09-16T00:00:00Z",
            &crate::DomainAssetWrite {
                entity_id: "example.test".to_owned(),
                note: None,
                portfolio_id: None,
                tags: Vec::new(),
                target_price: None,
            },
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let active = host.begin_native_cloud_run().unwrap();
    host.begin_native_device_switch_drain(&active, "switch-1")
        .unwrap();
    publish_standby(&host);
    let standby = host.begin_native_cloud_read_run().unwrap();
    assert!(host.recheck_native_cloud(&active).is_err());
    assert_eq!(
        host.native_device_switch_in_progress(&standby),
        Ok(Some("switch-1".to_owned()))
    );
    let view = host
        .read_asset_library(crate::DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        })
        .unwrap();
    assert_eq!(view.freshness.source, "standby_cloud");
    assert_eq!(view.freshness.read_only_reason.as_deref(), Some("standby"));
    assert!(!view.freshness.can_edit);
    let sync = serde_json::to_value(host.read_sync_snapshot().unwrap()).unwrap();
    assert_eq!(sync["source"], "standby_cloud");
    assert_eq!(sync["blockedReason"], "standby");
    assert_eq!(sync["pendingMutationCount"], 1);
    assert!(
        host.with_authorized_business(true, |_, _, _, _| Ok(()))
            .is_err()
    );
    assert!(host.claim_native_sync_push(&standby).is_err());
    assert!(host.prepare_native_sync_pull(&standby).is_err());
    assert!(
        host.clear_native_device_switch_barrier(&standby, "switch-1")
            .is_err()
    );
    assert!(
        host.with_sync_business_write(&standby.inner, |_, _, _, _| Ok(()))
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(host.read_sync_snapshot().unwrap()).unwrap()["pendingMutationCount"],
        1
    );
}
