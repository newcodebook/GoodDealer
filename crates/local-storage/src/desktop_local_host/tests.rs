use super::*;
#[cfg(unix)]
use crate::active_workspace::business::{
    TestActiveRebootstrapJournalLinkSnapshot, TestRebootstrapJournalLinkHostileCase,
};
use crate::test_tempdir::tempdir;
use crate::{DomainAssetWrite, LocalDatabaseKey};
use base64::Engine as _;
#[cfg(unix)]
use std::io::Write as _;
use tempfile::TempDir;

const OPERATION_ID: &str = "operation-opaque-0001";

#[test]
fn restore_refused_for_a_provisional_re_add_reports_a_conflict() {
    assert_eq!(
        map_database_error(BusinessDatabaseError::AssetReAddPending).code(),
        "BACKUP_CONFLICT_REJECTED"
    );
    assert_eq!(
        map_database_error(BusinessDatabaseError::MutationConflict).code(),
        "BACKUP_CONFLICT_REJECTED"
    );
}

fn rebootstrap_fixture_digest(domain: &[u8], value: &serde_json::Value) -> String {
    let mut encoded = Vec::new();
    rebootstrap_fixture_frame(&mut encoded, b'd', domain);
    rebootstrap_fixture_frame(
        &mut encoded,
        b'v',
        &rebootstrap_fixture_canonical_wire(value),
    );
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(encoded))
}

fn rebootstrap_fixture_canonical_wire(value: &serde_json::Value) -> Vec<u8> {
    let mut output = Vec::new();
    match value {
        serde_json::Value::Null => output.extend_from_slice(b"z0:"),
        serde_json::Value::Bool(value) => {
            output.extend_from_slice(if *value { b"b1:1" } else { b"b1:0" });
        }
        serde_json::Value::Number(value) => rebootstrap_fixture_frame(
            &mut output,
            b'n',
            value
                .as_i64()
                .expect("fixture numbers are signed integers")
                .to_string()
                .as_bytes(),
        ),
        serde_json::Value::String(value) => {
            rebootstrap_fixture_frame(&mut output, b's', value.as_bytes());
        }
        serde_json::Value::Array(values) => {
            let mut entries = Vec::new();
            for value in values {
                rebootstrap_fixture_frame(
                    &mut entries,
                    b'e',
                    &rebootstrap_fixture_canonical_wire(value),
                );
            }
            rebootstrap_fixture_frame(&mut output, b'a', &entries);
        }
        serde_json::Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut entries = Vec::new();
            for key in keys {
                let mut entry = Vec::new();
                rebootstrap_fixture_frame(&mut entry, b'k', key.as_bytes());
                rebootstrap_fixture_frame(
                    &mut entry,
                    b'v',
                    &rebootstrap_fixture_canonical_wire(&values[key]),
                );
                rebootstrap_fixture_frame(&mut entries, b'e', &entry);
            }
            rebootstrap_fixture_frame(&mut output, b'o', &entries);
        }
    }
    output
}

fn rebootstrap_fixture_frame(output: &mut Vec<u8>, tag: u8, payload: &[u8]) {
    output.push(tag);
    output.extend_from_slice(payload.len().to_string().as_bytes());
    output.push(b':');
    output.extend_from_slice(payload);
}

fn nonempty_rebootstrap_fixture(workspace_id: &str) -> (Vec<u8>, Vec<u8>) {
    let assets = serde_json::json!([{
        "entityId": "candidate-remote.example",
        "note": "candidate-only",
        "portfolioId": null,
        "tags": ["candidate"],
        "targetPrice": null,
        "entityGeneration": 1,
    }]);
    let partition_digest =
        rebootstrap_fixture_digest(b"GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-V3", &assets);
    let snapshot = serde_json::json!({ "assets": assets, "tombstones": [] });
    let checkpoint_digest = rebootstrap_fixture_digest(
        b"GOODDEALER-WORKSPACE-CHECKPOINT-ENTITY-DIGESTS-V3",
        &serde_json::json!([{
            "entityType": "domain_asset",
            "partitionId": "p0000",
            "digest": partition_digest,
        }]),
    );
    let checkpoint = serde_json::json!({
        "schemaVersion": 3,
        "checkpointId": "checkpoint-nonempty-fixture",
        "workspaceId": workspace_id,
        "workspaceSchemaVersion": 1,
        "throughServerRevision": 1,
        "checkpointDigest": checkpoint_digest,
    });
    let mut plan = serde_json::json!({
        "schemaVersion": 3,
        "checkpoint": checkpoint,
        "snapshot": snapshot,
        "requiredMutationRange": {
            "fromServerRevisionExclusive": 1,
            "throughServerRevisionInclusive": 1,
        },
        "mutations": [],
        "pinnedHeadRevision": 1,
    });
    let pinned_digest =
        rebootstrap_fixture_digest(b"GOODDEALER-WORKSPACE-REBOOTSTRAP-PLAN-V3", &plan);
    plan.as_object_mut()
        .expect("fixture plan is an object")
        .insert(
            "pinnedHeadDigest".to_owned(),
            serde_json::Value::String(pinned_digest),
        );
    (
        serde_json::to_vec(&plan["checkpoint"]).expect("fixture checkpoint serializes"),
        serde_json::to_vec(&plan).expect("fixture plan serializes"),
    )
}

#[cfg(unix)]
fn seed_rebootstrap_crash(
    boundary: RebootstrapCrashBoundary,
) -> (TempDir, DesktopApplicationRoot, TestRebootstrapKeyStore) {
    let directory = tempdir().unwrap();
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let store = TestRebootstrapKeyStore::default();
    let host = DesktopLocalHost::development_with_rebootstrap_custody_and_store(
        &root,
        application_path.join("native-backup-crash-driver"),
        "account-local",
        "workspace-local",
        "device-local",
        true,
        store.clone(),
    )
    .unwrap_or_else(|error| {
        panic!("failed to construct crash fixture for {boundary:?}: {error:?}")
    });
    host.runtime_state
        .lock()
        .unwrap()
        .as_mut()
        .expect("fixture starts with a business runtime")
        .business
        .database_for_backup_mut()
        .upsert_domain_asset(
            "seed-old-local-0001",
            "2026-09-16T00:00:00Z",
            &DomainAssetWrite {
                entity_id: "old-local.example".to_owned(),
                note: Some("old-only".to_owned()),
                portfolio_id: None,
                tags: vec!["old".to_owned()],
                target_price: None,
            },
        )
        .unwrap_or_else(|error| panic!("failed to seed old row for {boundary:?}: {error:?}"));
    let seeded = host
        .read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        })
        .unwrap();
    assert_eq!(seeded.total_rows, 1);
    assert_eq!(seeded.window.rows[0].domain, "old-local.example");
    let (checkpoint, plan) = nonempty_rebootstrap_fixture("workspace-local");

    assert_eq!(
        host.apply_rebootstrap_plan_until_for_test(&checkpoint, &plan, boundary),
        Ok(()),
        "failed to reach {boundary:?}"
    );
    drop(host);
    (directory, root, store)
}

#[cfg(unix)]
fn seed_cancel_restart_crash_from(
    source: RebootstrapCrashBoundary,
    boundary: RebootstrapCrashBoundary,
) -> (TempDir, DesktopApplicationRoot, TestRebootstrapKeyStore) {
    let custody_boundary = match boundary {
        RebootstrapCrashBoundary::CancelCandidateFileUnlinked => {
            TestRebootstrapCrashBoundary::AfterCancelCandidateFileUnlinkAndDirectoryFsync
        }
        RebootstrapCrashBoundary::CancelCandidateSlotDeleted => {
            TestRebootstrapCrashBoundary::AfterCancelCandidateSlotDeleteAndAbsentReadback
        }
        RebootstrapCrashBoundary::CancelAliasRepaired => {
            TestRebootstrapCrashBoundary::AfterCancelAliasRepairAndReadback
        }
        RebootstrapCrashBoundary::CancelOldSlotDeleted => {
            TestRebootstrapCrashBoundary::AfterCancelOldSlotDeleteAndAbsentReadback
        }
        _ => panic!("{boundary:?} is not a cancel-restart crash boundary"),
    };
    let (directory, root, store) = seed_rebootstrap_crash(source);
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    assert_eq!(
        DesktopLocalHost::restart_rebootstrap_until_for_test(
            root,
            store.clone(),
            "workspace-local",
            Some(custody_boundary),
        )
        .unwrap_err(),
        DesktopLocalHostError::StorageRejected,
        "failed to stop at cancel crash boundary {boundary:?}"
    );
    let restarted_root = DesktopApplicationRoot::validate(&application_path).unwrap();
    (directory, restarted_root, store)
}

fn is_cancel_restart_crash(boundary: RebootstrapCrashBoundary) -> bool {
    matches!(
        boundary,
        RebootstrapCrashBoundary::CancelCandidateFileUnlinked
            | RebootstrapCrashBoundary::CancelCandidateSlotDeleted
            | RebootstrapCrashBoundary::CancelAliasRepaired
            | RebootstrapCrashBoundary::CancelOldSlotDeleted
    )
}

fn activate_recovered_host(
    host: &mut DesktopLocalHost,
    name: &str,
    boundary: RebootstrapCrashBoundary,
) {
    let (verifier, signed_wire) =
        crate::desktop_local_host::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
    let device_id = host
        .production_custody
        .as_ref()
        .expect("coherent restart retains custody")
        .lock()
        .unwrap()
        .load_device_id()
        .unwrap();
    assert_eq!(device_id, "device-local", "device mismatch for {name}");
    VerifiedWorkspaceAuthority::verify(
        &signed_wire,
        &TrustedWorkspaceBinding {
            account_id: None,
            device_id: &device_id,
            minimum_account_security_epoch: 0,
            minimum_lease_epoch: 0,
        },
        current_unix_seconds().unwrap(),
        &verifier,
    )
    .unwrap_or_else(|error| {
        panic!("fresh Grant verification failed for {name}/{boundary:?}: {error:?}")
    });
    host.authority_verifier = Some(verifier);
    host.activate_authorization_grant(&signed_wire)
        .unwrap_or_else(|error| panic!("fresh Grant failed for {name}/{boundary:?}: {error:?}"));
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::Active
    );
}

fn activate_recovered_host_and_assert_business(
    host: &mut DesktopLocalHost,
    disposition: RebootstrapRestartDisposition,
    name: &str,
    boundary: RebootstrapCrashBoundary,
) {
    activate_recovered_host(host, name, boundary);
    let snapshot = host
        .read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        })
        .unwrap();
    let expected_count = if disposition == RebootstrapRestartDisposition::CancelledUnpublished {
        1
    } else {
        2
    };
    assert_eq!(
        snapshot.total_rows, expected_count,
        "wrong row count for {name}"
    );
    let domains = snapshot
        .window
        .rows
        .iter()
        .map(|row| row.domain.as_str())
        .collect::<Vec<_>>();
    assert!(domains.contains(&"old-local.example"));
    assert_eq!(
        domains.contains(&"candidate-remote.example"),
        disposition != RebootstrapRestartDisposition::CancelledUnpublished,
        "wrong selected database for {name}/{boundary:?}: {domains:?}"
    );
    let detail_request = |entity_id: &str| {
        serde_json::from_value::<DesktopDomainDetailReadRequest>(serde_json::json!({
            "entityId": entity_id,
        }))
        .unwrap()
    };
    let old_detail = host
        .read_domain_detail(detail_request("old-local.example"))
        .unwrap();
    assert_eq!(old_detail.asset.note.as_deref(), Some("old-only"));
    if disposition == RebootstrapRestartDisposition::CancelledUnpublished {
        assert!(
            host.read_domain_detail(detail_request("candidate-remote.example"))
                .is_err()
        );
    } else {
        let candidate_detail = host
            .read_domain_detail(detail_request("candidate-remote.example"))
            .unwrap();
        assert_eq!(
            candidate_detail.asset.note.as_deref(),
            Some("candidate-only")
        );
    }
    let mut runtime = host.runtime_state.lock().unwrap();
    let database = runtime
        .as_mut()
        .expect("fresh Grant installs the business runtime")
        .business
        .database_for_backup_mut();
    let portfolio = database.read_portfolio().unwrap();
    assert_eq!(
        portfolio.applied_through_server_revision,
        u64::from(disposition != RebootstrapRestartDisposition::CancelledUnpublished)
    );
    let pending = database.test_pending_sync_rows(10).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].mutation_id, "seed-old-local-0001");
    assert_eq!(pending[0].entity_id, "old-local.example");
    assert!(pending[0].mutation_payload_json.contains("old-only"));
    assert!(!pending[0].mutation_payload_json.contains("candidate-only"));
    let proof = database.recovery_proof().unwrap();
    assert_eq!(proof.workspace_id, "workspace-local");
    assert_eq!(
        proof.applied_server_revision,
        portfolio.applied_through_server_revision
    );
    assert_eq!(proof.local_commit_sequence, 1);
    assert_eq!(proof.next_device_mutation_sequence, 2);
    drop(runtime);
    assert!(host.begin_sync_run().is_ok());
}

fn mutate_recovered_asset(
    host: &DesktopLocalHost,
    entity_id: &str,
    mutation_id: &str,
    note: &str,
    tags: &[&str],
) {
    let detail = host
        .read_domain_detail(
            serde_json::from_value(serde_json::json!({"entityId": entity_id})).unwrap(),
        )
        .unwrap_or_else(|error| panic!("failed to read {entity_id} before edit: {error:?}"));
    let read_generation = host.business_status().read_generation;
    host.edit_domain_asset(
        serde_json::from_value(serde_json::json!({
            "mutationId": mutation_id,
            "expectedReadGeneration": read_generation,
            "expectedAssetVersion": detail.asset.asset_version,
            "asset": {
                "entityId": entity_id,
                "note": note,
                "portfolioId": null,
                "tags": tags,
                "targetPrice": null
            }
        }))
        .unwrap(),
    )
    .unwrap_or_else(|error| panic!("failed to edit {entity_id}: {error:?}"));
}

fn recovered_business_proof(host: &DesktopLocalHost) -> crate::DatabaseRecoveryProof {
    host.runtime_state
        .lock()
        .unwrap()
        .as_ref()
        .expect("active recovered Host retains a business runtime")
        .business
        .database_for_backup()
        .recovery_proof()
        .unwrap()
}

#[cfg(unix)]
fn active_publication_link_snapshot(
    host: &DesktopLocalHost,
) -> TestActiveRebootstrapJournalLinkSnapshot {
    host.runtime_state
        .lock()
        .unwrap()
        .as_ref()
        .expect("active recovered Host retains a business runtime")
        .business
        .database_for_backup()
        .active_rebootstrap_journal_link_snapshot_for_test()
        .unwrap()
}

#[cfg(unix)]
fn apply_publication_link_hostile_case(
    host: &DesktopLocalHost,
    hostile_case: TestRebootstrapJournalLinkHostileCase,
) {
    host.runtime_state
        .lock()
        .unwrap()
        .as_mut()
        .expect("active recovered Host retains a business runtime")
        .business
        .database_for_backup_mut()
        .apply_rebootstrap_journal_link_hostile_case_for_test(hostile_case)
        .unwrap();
}

fn encrypted_database_state_digest(database_path: &std::path::Path) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER/TEST/ENCRYPTED-DATABASE-STATE-V1\0");
    for suffix in ["", "-wal", "-journal"] {
        let path = if suffix.is_empty() {
            database_path.to_path_buf()
        } else {
            std::path::PathBuf::from(format!("{}{suffix}", database_path.display()))
        };
        match std::fs::read(path) {
            Ok(bytes) => {
                digest.update([1]);
                digest.update((bytes.len() as u64).to_be_bytes());
                digest.update(Sha256::digest(bytes));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => digest.update([0]),
            Err(error) => panic!("failed to read encrypted database state: {error}"),
        }
    }
    digest.finalize().into()
}

fn assert_recovered_note(host: &DesktopLocalHost, entity_id: &str, expected_note: &str) {
    let detail = host
        .read_domain_detail(
            serde_json::from_value(serde_json::json!({"entityId": entity_id})).unwrap(),
        )
        .unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some(expected_note));
}

fn activate_recovered_host_and_assert_empty_business(host: &mut DesktopLocalHost, name: &str) {
    let (verifier, signed_wire) =
        crate::desktop_local_host::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
    let device_id = host
        .production_custody
        .as_ref()
        .expect("clean restart retains custody")
        .lock()
        .unwrap()
        .load_device_id()
        .unwrap();
    VerifiedWorkspaceAuthority::verify(
        &signed_wire,
        &TrustedWorkspaceBinding {
            account_id: None,
            device_id: &device_id,
            minimum_account_security_epoch: 0,
            minimum_lease_epoch: 0,
        },
        current_unix_seconds().unwrap(),
        &verifier,
    )
    .unwrap();
    host.authority_verifier = Some(verifier);
    host.activate_authorization_grant(&signed_wire)
        .unwrap_or_else(|error| panic!("fresh Grant failed for {name}: {error:?}"));
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::Active
    );
    let lease = serde_json::to_value(host.device_lease().unwrap()).unwrap();
    assert_eq!(
        lease,
        serde_json::json!({ "schemaVersion": 1, "deviceId": device_id, "leaseEpoch": lease["leaseEpoch"] })
    );
    assert!(lease["leaseEpoch"].as_u64().is_some_and(|epoch| epoch > 0));
    let snapshot = host
        .read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        })
        .unwrap();
    assert_eq!(snapshot.total_rows, 0);
    assert!(snapshot.window.rows.is_empty());
    assert!(host.begin_sync_run().is_ok());
}

#[test]
fn production_status_is_closed_and_renderer_safe() {
    let host = DesktopLocalHost::production_unavailable();
    let business = serde_json::to_value(host.business_status()).unwrap();
    assert_eq!(business["schemaVersion"], 2);
    assert_eq!(business["state"], "activation_required");
    assert_eq!(business["capabilities"], serde_json::json!([]));
    // Without an Active authority there is no lease to show, and nothing is invented.
    assert_eq!(host.device_lease(), Err(DesktopLocalHostError::Unavailable));
    let value = serde_json::to_value(host.backup_status()).unwrap();
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["kind"], "local_backup_restore_status");
    assert_eq!(value["authority"], "unavailable");
    assert_eq!(value["exportAdmission"]["state"], "unavailable");
    assert_eq!(value["artifactSelectionAdmission"]["state"], "unavailable");
    assert_eq!(value["selectedArtifact"]["state"], "none");
    assert!(value["error"].is_null());
}

#[cfg(unix)]
#[test]
fn production_constructor_rejects_fixed_file_residue_before_database_or_key_access() {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    for name in [
        "rebootstrap.journal",
        "rebootstrap-a.db",
        "rebootstrap-a.db-wal",
        "rebootstrap-a.db-shm",
        "rebootstrap-a.db-journal",
        "rebootstrap-b.db",
        "rebootstrap-b.db-wal",
        "rebootstrap-b.db-shm",
        "rebootstrap-b.db-journal",
    ] {
        let directory = tempdir().unwrap();
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let workspace = application_path.join("active-workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::set_permissions(&workspace, std::fs::Permissions::from_mode(0o700)).unwrap();

        let residue = workspace.join(name);
        let expected = format!("fixed-residue:{name}").into_bytes();
        std::fs::write(&residue, &expected).unwrap();
        std::fs::set_permissions(&residue, std::fs::Permissions::from_mode(0o600)).unwrap();

        let residue_inode = std::fs::symlink_metadata(&residue).unwrap().ino();
        let mut entries_before = std::fs::read_dir(&workspace)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        entries_before.sort();

        reset_rebootstrap_inspection_for_test();
        assert_eq!(
            DesktopLocalHost::production(root).unwrap_err(),
            DesktopLocalHostError::ApplicationRootRejected,
            "production admitted {name}"
        );

        let inspection = rebootstrap_inspection_snapshot_for_test();
        assert_eq!(inspection.slot_inspections(), 0, "slot access for {name}");
        assert_eq!(inspection.alias_inspections(), 0, "alias access for {name}");
        assert_eq!(
            inspection.database_inspections(),
            0,
            "database access for {name}"
        );

        assert_eq!(std::fs::read(&residue).unwrap(), expected);
        assert_eq!(
            std::fs::symlink_metadata(&residue).unwrap().ino(),
            residue_inode
        );
        assert!(!workspace.join("business.db").exists());

        let mut entries_after = std::fs::read_dir(&workspace)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        entries_after.sort();
        assert_eq!(entries_after, entries_before);
    }
}

#[test]
fn status_closes_while_an_authority_transition_is_pending() {
    let directory = tempdir().unwrap();
    let database = BusinessDatabase::open(
        &directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x4f; 32]),
        "workspace-local",
    )
    .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    assert_eq!(
        host.authorization_status(),
        DesktopHostAuthorizationStatus::Authorized
    );

    host.transition_requested_epoch.store(2, Ordering::Release);

    assert_eq!(
        host.authorization_status(),
        DesktopHostAuthorizationStatus::SecurityLocked
    );
    let business = serde_json::to_value(host.business_status()).unwrap();
    assert_eq!(business["state"], "security_locked");
    assert_eq!(business["capabilities"], serde_json::json!([]));
}

#[test]
fn authority_identity_names_no_identifier_and_changes_only_with_the_authority() {
    let directory = tempdir().unwrap();
    let database = BusinessDatabase::open(
        &directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x5a; 32]),
        "workspace-local",
    )
    .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let first = host.authority_identity().unwrap();
    assert_eq!(host.authority_identity().as_ref(), Some(&first));
    let shown = format!("{first:?}");
    for identifier in ["account-local", "workspace-local", "device-local"] {
        assert!(!shown.contains(identifier));
    }
    // A new lease is a new authority, so results stamped under the old one stop matching.
    host.renew_business_authority_for_test(2).unwrap();
    let renewed = host.authority_identity().unwrap();
    assert_ne!(renewed, first);
}

#[test]
fn device_lease_is_refused_in_read_only_after_expiry_and_while_authority_switches() {
    let host_at = |seed: u8| {
        let directory = tempdir().unwrap();
        let database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &LocalDatabaseKey::from_bytes([seed; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            "workspace-local",
            "device-local",
        )
        .unwrap();
        // The Active development authority shows its lease, so each refusal below is caused
        // by the state it sets up and not by a host that never had one.
        assert!(host.device_lease().is_ok());
        (directory, host)
    };

    // Commercial read-only (the Host form of Standby): the verified continuation holds no
    // lease to show.
    let (_standby_directory, standby) = host_at(0x61);
    assert_eq!(
        standby.continuity_startup_for_test().unwrap(),
        StartupContinuity::VerifiedLocalContinuation
    );
    standby.enter_commercial_read_only().unwrap();
    assert_eq!(
        standby.business_status().state,
        DesktopLocalBusinessState::CommercialReadOnly
    );
    assert_eq!(
        standby.device_lease(),
        Err(DesktopLocalHostError::Unavailable)
    );

    // Expired: the published Active authority is past its execution window.
    let (_expired_directory, expired) = host_at(0x62);
    expired
        .authority_publication
        .lock()
        .unwrap()
        .authority
        .as_mut()
        .unwrap()
        .execute_before = 0;
    assert_eq!(
        expired.device_lease(),
        Err(DesktopLocalHostError::Unavailable)
    );

    // Switching: a transition was requested but not yet applied, so the current lease may
    // already be superseded and is not shown.
    let (_switching_directory, switching) = host_at(0x63);
    switching
        .transition_requested_epoch
        .fetch_add(1, Ordering::AcqRel);
    assert_eq!(
        switching.device_lease(),
        Err(DesktopLocalHostError::Unavailable)
    );
}

#[test]
fn status_closes_when_the_published_authority_is_expired() {
    let directory = tempdir().unwrap();
    let database = BusinessDatabase::open(
        &directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x50; 32]),
        "workspace-local",
    )
    .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    host.authority_publication
        .lock()
        .unwrap()
        .authority
        .as_mut()
        .unwrap()
        .execute_before = 0;

    assert_eq!(
        host.authorization_status(),
        DesktopHostAuthorizationStatus::SecurityLocked
    );
    let business = serde_json::to_value(host.business_status()).unwrap();
    assert_eq!(business["state"], "security_locked");
    assert_eq!(business["capabilities"], serde_json::json!([]));
}

#[cfg(unix)]
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the production gate test keeps the no-side-effect and private-fixture contrast in one scenario"
)]
fn production_rebootstrap_is_unavailable_without_side_effects_and_private_fake_completes() {
    let directory = tempdir().unwrap();
    let fixture_root = directory.path().canonicalize().unwrap();
    let application_path = fixture_root.join("GoodDealer-production");
    let root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let production_mode = DesktopLocalHost::development_with_rebootstrap_custody(
        &root,
        application_path.join("native-backup-production-mode"),
        "account-local",
        "workspace-local",
        "device-local",
        false,
    )
    .unwrap();
    let database_path = root.business_database_path();
    let before_database = std::fs::read(&database_path).unwrap();
    let before_generation = production_mode.business_status().read_generation;
    let before_rebootstrap_state = production_mode
        .production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .rebootstrap_state_digest_for_test()
        .unwrap();
    let (checkpoint, plan) =
        crate::rebootstrap_runtime::valid_rebootstrap_fixture("workspace-local");

    assert_eq!(
        production_mode.apply_rebootstrap_plan(&checkpoint, &plan),
        Err(DesktopLocalHostError::Unavailable)
    );
    let oversized_checkpoint = vec![b'x'; 4_097];
    for (name, hostile_checkpoint, hostile_plan) in [
        ("malformed-checkpoint", b"{".as_slice(), plan.as_slice()),
        ("malformed-plan", checkpoint.as_slice(), b"{".as_slice()),
        (
            "oversized-checkpoint",
            oversized_checkpoint.as_slice(),
            plan.as_slice(),
        ),
    ] {
        assert_eq!(
            production_mode.apply_rebootstrap_plan(hostile_checkpoint, hostile_plan),
            Err(DesktopLocalHostError::Unavailable),
            "production denial parsed or admitted {name}"
        );
    }
    assert_eq!(std::fs::read(&database_path).unwrap(), before_database);
    assert_eq!(
        production_mode
            .production_custody
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .rebootstrap_state_digest_for_test()
            .unwrap(),
        before_rebootstrap_state
    );
    assert_eq!(
        production_mode.business_status().state,
        DesktopLocalBusinessState::Active
    );
    assert_eq!(
        production_mode.business_status().read_generation,
        before_generation
    );
    assert_eq!(
        production_mode
            .rebootstrap_runtime
            .as_ref()
            .unwrap()
            .startup_status()
            .unwrap(),
        crate::rebootstrap_runtime::RebootstrapStatus::Unavailable
    );
    for name in [
        "rebootstrap.journal",
        "rebootstrap-a.db",
        "rebootstrap-b.db",
    ] {
        assert_eq!(
            std::fs::symlink_metadata(application_path.join("active-workspace").join(name))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::NotFound
        );
    }
    // The unavailable capability is scoped to rebootstrap: ordinary reads remain admitted.
    production_mode
        .read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        })
        .unwrap();
    drop(production_mode);

    // The test key store models native custody and is intentionally process-local. Exercise
    // the create-only fake against an independent installation so it cannot inherit the
    // production fixture's database without its corresponding custody records.
    let private_application_path = fixture_root.join("GoodDealer-private-fake");
    let private_root = DesktopApplicationRoot::validate(&private_application_path).unwrap();
    let private_fake = DesktopLocalHost::development_with_rebootstrap_custody(
        &private_root,
        private_application_path.join("native-backup-private-fake"),
        "account-local",
        "workspace-local",
        "device-local",
        true,
    )
    .unwrap();
    let private_result = private_fake.apply_rebootstrap_plan(&checkpoint, &plan);
    assert_eq!(
        private_result,
        Ok(()),
        "journal after failure: {:?}",
        std::fs::read_to_string(private_root.rebootstrap_journal_path())
    );
    assert_eq!(
        private_fake
            .rebootstrap_runtime
            .as_ref()
            .unwrap()
            .startup_status()
            .unwrap(),
        crate::rebootstrap_runtime::RebootstrapStatus::Published
    );
    assert_eq!(
        private_fake.business_status().state,
        DesktopLocalBusinessState::Active
    );
    for name in ["rebootstrap-a.db", "rebootstrap-b.db"] {
        assert_eq!(
            std::fs::symlink_metadata(private_application_path.join("active-workspace").join(name))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::NotFound
        );
    }
}

#[cfg(unix)]
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the restart matrix keeps all crash boundaries and their common invariant checks together"
)]
fn rebootstrap_v3_restart_matrix_cancels_pre_exchange_resumes_post_exchange_and_restores_no_authority()
 {
    let rows = [
        (
            "reservation-created",
            RebootstrapCrashBoundary::ReservationCreated,
            RebootstrapRestartDisposition::Quarantined,
        ),
        (
            "prepared",
            RebootstrapCrashBoundary::Prepared,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "candidate-created",
            RebootstrapCrashBoundary::CandidateCreated,
            RebootstrapRestartDisposition::Quarantined,
        ),
        (
            "candidate-reserved",
            RebootstrapCrashBoundary::CandidateReserved,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "candidate-mutated",
            RebootstrapCrashBoundary::CandidateMutated,
            RebootstrapRestartDisposition::Quarantined,
        ),
        (
            "verified",
            RebootstrapCrashBoundary::Verified,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "cancel-candidate-file-unlinked",
            RebootstrapCrashBoundary::CancelCandidateFileUnlinked,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "cancel-candidate-slot-deleted",
            RebootstrapCrashBoundary::CancelCandidateSlotDeleted,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "cancel-alias-repaired",
            RebootstrapCrashBoundary::CancelAliasRepaired,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "cancel-old-slot-deleted",
            RebootstrapCrashBoundary::CancelOldSlotDeleted,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "publish-intent-pre-exchange",
            RebootstrapCrashBoundary::PublishIntentPreExchange,
            RebootstrapRestartDisposition::CancelledUnpublished,
        ),
        (
            "exchange-before-directory-fsync",
            RebootstrapCrashBoundary::ExchangeBeforeDirectoryFsync,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "alias-repair-before-published",
            RebootstrapCrashBoundary::AliasRepairBeforePublished,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "publish-intent-post-exchange",
            RebootstrapCrashBoundary::PublishIntentPostExchange,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "published",
            RebootstrapCrashBoundary::Published,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "reopen-proof-failure",
            RebootstrapCrashBoundary::ReopenProofFailure,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "reopened-before-confirmation",
            RebootstrapCrashBoundary::ReopenedBeforeConfirmation,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "reopened-verified",
            RebootstrapCrashBoundary::ReopenedVerified,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "old-file-unlinked",
            RebootstrapCrashBoundary::OldFileUnlinked,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "old-slot-deleted",
            RebootstrapCrashBoundary::OldSlotDeleted,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "retired-old-journal-append-failure",
            RebootstrapCrashBoundary::RetiredOldJournalAppendFailure,
            RebootstrapRestartDisposition::ResumedPublished,
        ),
        (
            "retired-old",
            RebootstrapCrashBoundary::RetiredOld,
            RebootstrapRestartDisposition::TerminalValidated,
        ),
    ];
    for (name, boundary, expected) in rows {
        let (directory, root, store) = if is_cancel_restart_crash(boundary) {
            seed_cancel_restart_crash_from(RebootstrapCrashBoundary::CandidateReserved, boundary)
        } else {
            seed_rebootstrap_crash(boundary)
        };
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let (mut host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap_or_else(|error| {
                    panic!("restart failed for {name}/{boundary:?}: {error:?}")
                });

        assert_eq!(
            disposition, expected,
            "unexpected decision for {name}/{boundary:?}"
        );
        let expected_state = if expected == RebootstrapRestartDisposition::Quarantined {
            DesktopLocalBusinessState::SecurityLocked
        } else {
            DesktopLocalBusinessState::ActivationRequired
        };
        assert_eq!(host.business_status().state, expected_state);
        assert!(host.runtime_state.lock().unwrap().is_none());
        assert!(host.begin_sync_run().is_err());
        assert!(
            host.read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
            .is_err()
        );

        if disposition != RebootstrapRestartDisposition::Quarantined {
            activate_recovered_host_and_assert_business(&mut host, disposition, name, boundary);
        }

        drop(host);
        if matches!(
            boundary,
            RebootstrapCrashBoundary::Prepared
                | RebootstrapCrashBoundary::CancelCandidateFileUnlinked
                | RebootstrapCrashBoundary::CancelCandidateSlotDeleted
                | RebootstrapCrashBoundary::CancelAliasRepaired
                | RebootstrapCrashBoundary::CancelOldSlotDeleted
                | RebootstrapCrashBoundary::OldFileUnlinked
                | RebootstrapCrashBoundary::OldSlotDeleted
                | RebootstrapCrashBoundary::RetiredOldJournalAppendFailure
                | RebootstrapCrashBoundary::RetiredOld
        ) {
            let journal_path = application_path
                .join("active-workspace")
                .join("rebootstrap.journal");
            let journal_before_second = std::fs::read(&journal_path).unwrap();
            let second_root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let (mut second, second_disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                second_root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("second restart failed for {name}/{boundary:?}: {error:?}")
            });
            assert_eq!(
                second_disposition,
                RebootstrapRestartDisposition::TerminalValidated,
                "second restart disposition for {name}/{boundary:?}"
            );
            assert_eq!(
                second.business_status().state,
                DesktopLocalBusinessState::ActivationRequired
            );
            assert!(second.runtime_state.lock().unwrap().is_none());
            assert_eq!(std::fs::read(&journal_path).unwrap(), journal_before_second);
            let selected = if boundary == RebootstrapCrashBoundary::Prepared
                || is_cancel_restart_crash(boundary)
            {
                RebootstrapRestartDisposition::CancelledUnpublished
            } else {
                RebootstrapRestartDisposition::ResumedPublished
            };
            activate_recovered_host_and_assert_business(&mut second, selected, name, boundary);
            drop(second);
        }
        drop(directory);
    }
}

#[cfg(unix)]
#[test]
fn cancellation_prefix_cross_product_resumes_once_and_then_validates_terminal_state() {
    let prepared_boundaries = [
        RebootstrapCrashBoundary::CancelCandidateSlotDeleted,
        RebootstrapCrashBoundary::CancelAliasRepaired,
        RebootstrapCrashBoundary::CancelOldSlotDeleted,
    ];
    let candidate_boundaries = [
        RebootstrapCrashBoundary::CancelCandidateFileUnlinked,
        RebootstrapCrashBoundary::CancelCandidateSlotDeleted,
        RebootstrapCrashBoundary::CancelAliasRepaired,
        RebootstrapCrashBoundary::CancelOldSlotDeleted,
    ];
    for source in [
        RebootstrapCrashBoundary::Prepared,
        RebootstrapCrashBoundary::CandidateReserved,
        RebootstrapCrashBoundary::Verified,
        RebootstrapCrashBoundary::PublishIntentPreExchange,
    ] {
        let boundaries = if source == RebootstrapCrashBoundary::Prepared {
            prepared_boundaries.as_slice()
        } else {
            candidate_boundaries.as_slice()
        };
        for &boundary in boundaries {
            let (directory, root, store) = seed_cancel_restart_crash_from(source, boundary);
            let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
            let journal_path = root.rebootstrap_journal_path();
            let (mut first, first_disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("cancel prefix {source:?}/{boundary:?} failed: {error:?}")
            });
            assert_eq!(
                first_disposition,
                RebootstrapRestartDisposition::CancelledUnpublished,
                "cancel prefix {source:?}/{boundary:?}"
            );
            activate_recovered_host_and_assert_business(
                &mut first,
                first_disposition,
                "cancel-prefix-first",
                boundary,
            );
            drop(first);

            let journal_after_cancel = std::fs::read(&journal_path).unwrap();
            let second_root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let (mut second, second_disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                second_root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("cancel terminal {source:?}/{boundary:?} failed: {error:?}")
            });
            assert_eq!(
                second_disposition,
                RebootstrapRestartDisposition::TerminalValidated,
                "cancel terminal {source:?}/{boundary:?}"
            );
            assert_eq!(std::fs::read(&journal_path).unwrap(), journal_after_cancel);
            activate_recovered_host_and_assert_business(
                &mut second,
                RebootstrapRestartDisposition::CancelledUnpublished,
                "cancel-prefix-terminal",
                boundary,
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn terminal_restart_accepts_current_business_proof_after_repeated_authorized_mutations() {
    let rows = [
        (
            "cancelled",
            RebootstrapCrashBoundary::Prepared,
            RebootstrapRestartDisposition::CancelledUnpublished,
            "old-local.example",
            ["old"],
        ),
        (
            "retired-old",
            RebootstrapCrashBoundary::RetiredOld,
            RebootstrapRestartDisposition::TerminalValidated,
            "candidate-remote.example",
            ["candidate"],
        ),
    ];
    for (name, boundary, expected, entity_id, tags) in rows {
        let (directory, root, store) = seed_rebootstrap_crash(boundary);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let database_path = root.business_database_path();
        let journal_path = root.rebootstrap_journal_path();
        let (mut host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap_or_else(|error| panic!("{name} recovery failed: {error:?}"));
        assert_eq!(disposition, expected, "{name} recovery disposition");
        activate_recovered_host(&mut host, name, boundary);
        let initial_link = active_publication_link_snapshot(&host);
        if expected == RebootstrapRestartDisposition::CancelledUnpublished {
            assert!(!initial_link.is_present(), "initial Cancelled has no link");
            assert_eq!(initial_link.active_row_count(), 0);
        } else {
            assert!(initial_link.is_present(), "RetiredOld has an active link");
            assert_eq!(initial_link.active_row_count(), 1);
        }

        let ciphertext_before = encrypted_database_state_digest(&database_path);
        let proof_before = recovered_business_proof(&host);
        mutate_recovered_asset(
            &host,
            entity_id,
            &format!("{name}-mutation-1"),
            &format!("{name}-note-1"),
            &tags,
        );
        mutate_recovered_asset(
            &host,
            entity_id,
            &format!("{name}-mutation-2"),
            &format!("{name}-note-2"),
            &tags,
        );
        let proof_after = recovered_business_proof(&host);
        let ciphertext_after = encrypted_database_state_digest(&database_path);
        assert_ne!(ciphertext_after, ciphertext_before, "{name} ciphertext");
        assert_ne!(
            proof_after.row_digest, proof_before.row_digest,
            "{name} proof"
        );
        assert_eq!(
            proof_after.local_commit_sequence,
            proof_before.local_commit_sequence + 2,
            "{name} commit sequence"
        );
        assert_eq!(
            proof_after.next_device_mutation_sequence,
            proof_before.next_device_mutation_sequence + 2,
            "{name} mutation sequence"
        );
        assert_recovered_note(&host, entity_id, &format!("{name}-note-2"));
        drop(host);

        let journal_after_mutations = std::fs::read(&journal_path).unwrap();
        for restart_index in 1..=2 {
            let restart_root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let (mut restarted, restart_disposition) =
                DesktopLocalHost::restart_rebootstrap_for_test(
                    restart_root,
                    store.clone(),
                    "workspace-local",
                )
                .unwrap_or_else(|error| {
                    panic!("{name} terminal restart {restart_index} failed: {error:?}")
                });
            assert_eq!(
                restart_disposition,
                RebootstrapRestartDisposition::TerminalValidated,
                "{name} terminal restart {restart_index}"
            );
            assert_eq!(
                std::fs::read(&journal_path).unwrap(),
                journal_after_mutations,
                "{name} terminal restart {restart_index} rewrote the journal"
            );
            activate_recovered_host(&mut restarted, name, boundary);
            assert_recovered_note(&restarted, entity_id, &format!("{name}-note-2"));
            assert_eq!(recovered_business_proof(&restarted), proof_after);
            drop(restarted);
        }
    }
}

#[cfg(unix)]
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the journal-link test keeps inheritance and replacement in one causal scenario"
)]
fn terminal_chain_preserves_link_across_cancel_and_replaces_it_on_next_publication() {
    let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let journal_path = root.rebootstrap_journal_path();

    let (mut first_terminal, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
            .unwrap();
    assert_eq!(
        disposition,
        RebootstrapRestartDisposition::TerminalValidated
    );
    activate_recovered_host(
        &mut first_terminal,
        "retired-op1",
        RebootstrapCrashBoundary::RetiredOld,
    );
    let op1_link = active_publication_link_snapshot(&first_terminal);
    assert!(op1_link.is_present());
    assert_eq!(op1_link.active_row_count(), 1);
    let op1_link_digest = op1_link.digest().unwrap().to_owned();

    let (checkpoint, plan) = nonempty_rebootstrap_fixture("workspace-local");
    assert_eq!(
        first_terminal.apply_rebootstrap_plan_until_for_test(
            &checkpoint,
            &plan,
            RebootstrapCrashBoundary::Prepared,
        ),
        Ok(())
    );
    drop(first_terminal);

    let cancelled_root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let (mut cancelled, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
        cancelled_root,
        store.clone(),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(
        disposition,
        RebootstrapRestartDisposition::CancelledUnpublished
    );
    activate_recovered_host(
        &mut cancelled,
        "cancelled-op2",
        RebootstrapCrashBoundary::Prepared,
    );
    let cancelled_link = active_publication_link_snapshot(&cancelled);
    assert_eq!(cancelled_link.active_row_count(), 1);
    assert_eq!(cancelled_link.digest(), Some(op1_link_digest.as_str()));
    assert_recovered_note(&cancelled, "candidate-remote.example", "candidate-only");
    drop(cancelled);

    let journal_after_cancel = std::fs::read(&journal_path).unwrap();
    let inherited_root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let (mut inherited, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
        inherited_root,
        store.clone(),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(
        disposition,
        RebootstrapRestartDisposition::TerminalValidated
    );
    assert_eq!(std::fs::read(&journal_path).unwrap(), journal_after_cancel);
    activate_recovered_host(
        &mut inherited,
        "inherited-op1-link",
        RebootstrapCrashBoundary::Prepared,
    );
    let inherited_link = active_publication_link_snapshot(&inherited);
    assert_eq!(inherited_link.active_row_count(), 1);
    assert_eq!(inherited_link.digest(), Some(op1_link_digest.as_str()));

    assert_eq!(
        inherited.apply_rebootstrap_plan_until_for_test(
            &checkpoint,
            &plan,
            RebootstrapCrashBoundary::RetiredOld,
        ),
        Ok(())
    );
    drop(inherited);

    let journal_after_replacement = std::fs::read(&journal_path).unwrap();
    assert_ne!(journal_after_replacement, journal_after_cancel);
    let replacement_root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let (mut replacement, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(replacement_root, store, "workspace-local")
            .unwrap();
    assert_eq!(
        disposition,
        RebootstrapRestartDisposition::TerminalValidated
    );
    assert_eq!(
        std::fs::read(&journal_path).unwrap(),
        journal_after_replacement
    );
    activate_recovered_host(
        &mut replacement,
        "retired-op3-replacement",
        RebootstrapCrashBoundary::RetiredOld,
    );
    let op3_link = active_publication_link_snapshot(&replacement);
    assert_eq!(op3_link.active_row_count(), 1);
    assert!(op3_link.is_present());
    assert_ne!(op3_link.digest(), Some(op1_link_digest.as_str()));
    assert_recovered_note(&replacement, "candidate-remote.example", "candidate-only");
}

#[cfg(unix)]
#[test]
fn hostile_terminal_publication_links_quarantine_without_repair_or_journal_write() {
    for hostile_case in [
        TestRebootstrapJournalLinkHostileCase::RemoveActive,
        TestRebootstrapJournalLinkHostileCase::DuplicateActive,
        TestRebootstrapJournalLinkHostileCase::MutateBindingDigest,
        TestRebootstrapJournalLinkHostileCase::MarkNonVerified,
    ] {
        let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let journal_path = root.rebootstrap_journal_path();
        let (mut host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap();
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::TerminalValidated
        );
        activate_recovered_host(
            &mut host,
            "hostile-terminal-link",
            RebootstrapCrashBoundary::RetiredOld,
        );
        let link_before = active_publication_link_snapshot(&host);
        assert!(link_before.is_present());
        assert_eq!(link_before.active_row_count(), 1);
        apply_publication_link_hostile_case(&host, hostile_case);
        drop(host);

        let journal_before_restart = std::fs::read(&journal_path).unwrap();
        let probe_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let custody = TestRebootstrapRecoveryCustody::open(&probe_root, store.clone()).unwrap();
        let state_before_restart = custody.state_digest().unwrap();
        drop(custody);
        let restart_root = DesktopApplicationRoot::validate(&application_path).unwrap();
        let (quarantined, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
            restart_root,
            store.clone(),
            "workspace-local",
        )
        .unwrap_or_else(|error| {
            panic!("hostile terminal link {hostile_case:?} escaped quarantine: {error:?}")
        });
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::Quarantined,
            "hostile terminal link {hostile_case:?}"
        );
        assert_eq!(
            quarantined.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert!(quarantined.runtime_state.lock().unwrap().is_none());
        assert_eq!(
            quarantined
                .rebootstrap_quarantine_custody
                .as_ref()
                .unwrap()
                .state_digest(&store)
                .unwrap(),
            state_before_restart,
            "hostile terminal link {hostile_case:?} was repaired"
        );
        assert_eq!(
            std::fs::read(&journal_path).unwrap(),
            journal_before_restart,
            "hostile terminal link {hostile_case:?} rewrote the journal"
        );
    }
}

#[cfg(unix)]
#[test]
fn cancelled_terminal_requires_the_exact_inherited_publication_link() {
    let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let journal_path = root.rebootstrap_journal_path();
    let (mut op1, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
            .unwrap();
    assert_eq!(
        disposition,
        RebootstrapRestartDisposition::TerminalValidated
    );
    activate_recovered_host(
        &mut op1,
        "inherited-link-op1",
        RebootstrapCrashBoundary::RetiredOld,
    );
    let (checkpoint, plan) = nonempty_rebootstrap_fixture("workspace-local");
    assert_eq!(
        op1.apply_rebootstrap_plan_until_for_test(
            &checkpoint,
            &plan,
            RebootstrapCrashBoundary::Prepared,
        ),
        Ok(())
    );
    drop(op1);

    let cancelled_root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let (mut cancelled, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
        cancelled_root,
        store.clone(),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(
        disposition,
        RebootstrapRestartDisposition::CancelledUnpublished
    );
    activate_recovered_host(
        &mut cancelled,
        "inherited-link-op2-cancelled",
        RebootstrapCrashBoundary::Prepared,
    );
    let inherited = active_publication_link_snapshot(&cancelled);
    assert!(inherited.is_present());
    assert_eq!(inherited.active_row_count(), 1);
    apply_publication_link_hostile_case(
        &cancelled,
        TestRebootstrapJournalLinkHostileCase::RemoveActive,
    );
    drop(cancelled);

    let journal_before_restart = std::fs::read(&journal_path).unwrap();
    let probe_root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let custody = TestRebootstrapRecoveryCustody::open(&probe_root, store.clone()).unwrap();
    let state_before_restart = custody.state_digest().unwrap();
    drop(custody);
    let restart_root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let (quarantined, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
        restart_root,
        store.clone(),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
    assert_eq!(
        quarantined.business_status().state,
        DesktopLocalBusinessState::SecurityLocked
    );
    assert_eq!(
        quarantined
            .rebootstrap_quarantine_custody
            .as_ref()
            .unwrap()
            .state_digest(&store)
            .unwrap(),
        state_before_restart
    );
    assert_eq!(
        std::fs::read(&journal_path).unwrap(),
        journal_before_restart
    );
}

#[cfg(unix)]
#[test]
fn candidate_file_with_missing_candidate_slot_quarantines_in_every_cancellation_phase() {
    for source in [
        RebootstrapCrashBoundary::CandidateReserved,
        RebootstrapCrashBoundary::Verified,
        RebootstrapCrashBoundary::PublishIntentPreExchange,
    ] {
        let (_directory, root, store) = seed_rebootstrap_crash(source);
        store
            .apply_hostile_case_for_test(TestRebootstrapStoreHostileCase::RemoveSlot(
                RebootstrapSlot::B,
            ))
            .unwrap();
        let journal_path = root.rebootstrap_journal_path();
        let journal_before = std::fs::read(&journal_path).unwrap();
        let probe = TestRebootstrapRecoveryCustody::open(&root, store.clone()).unwrap();
        let state_before = probe.state_digest().unwrap();
        drop(probe);

        let (host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap_or_else(|error| {
                    panic!("file-present/slot-missing {source:?} did not fail closed: {error:?}")
                });
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::Quarantined,
            "file-present/slot-missing {source:?} was admitted"
        );
        assert_eq!(
            host.rebootstrap_quarantine_custody
                .as_ref()
                .unwrap()
                .state_digest(&store)
                .unwrap(),
            state_before
        );
        assert_eq!(std::fs::read(&journal_path).unwrap(), journal_before);
    }
}

#[cfg(unix)]
#[test]
fn clean_restart_is_validated_but_requires_fresh_authority() {
    let directory = tempdir().unwrap();
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let store = TestRebootstrapKeyStore::default();
    let host = DesktopLocalHost::development_with_rebootstrap_custody_and_store(
        &root,
        application_path.join("native-backup-clean-restart"),
        "account-local",
        "workspace-local",
        "device-local",
        true,
        store.clone(),
    )
    .unwrap();
    drop(host);

    let root = DesktopApplicationRoot::validate(&application_path).unwrap();
    let (mut restarted, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local").unwrap();
    assert_eq!(disposition, RebootstrapRestartDisposition::CleanValidated);
    assert_eq!(
        restarted.business_status().state,
        DesktopLocalBusinessState::ActivationRequired
    );
    assert!(restarted.runtime_state.lock().unwrap().is_none());
    activate_recovered_host_and_assert_empty_business(&mut restarted, "clean-restart");
}

#[cfg(unix)]
#[test]
#[ignore = "subprocess helper invoked only by the quarantine process-lock test"]
fn rebootstrap_quarantine_lock_child_process() {
    let application_path = std::env::var_os("GOODDEALER_REBOOTSTRAP_LOCK_TEST_ROOT")
        .map(std::path::PathBuf::from)
        .expect("child application root is present");
    let expected = std::env::var("GOODDEALER_REBOOTSTRAP_LOCK_TEST_EXPECT")
        .expect("child expected outcome is present");
    let root = DesktopApplicationRoot::validate(&application_path)
        .expect("child application root is valid");

    reset_rebootstrap_inspection_for_test();
    let opened = TestRebootstrapRecoveryCustody::open(&root, TestRebootstrapKeyStore::default());
    let inspection = rebootstrap_inspection_snapshot_for_test();

    assert_eq!(inspection.lock_attempts(), 1);
    assert_eq!(inspection.journal_inspections(), 0);
    assert_eq!(inspection.slot_inspections(), 0);
    assert_eq!(inspection.alias_inspections(), 0);
    assert_eq!(inspection.database_inspections(), 0);
    match expected.as_str() {
        "blocked" => {
            assert!(matches!(
                opened,
                Err(crate::desktop_custody::DesktopCustodyError::Unavailable)
            ));
            assert_eq!(inspection.lock_acquired(), 0);
        }
        "acquired" => {
            assert!(opened.is_ok());
            assert_eq!(inspection.lock_acquired(), 1);
        }
        _ => panic!("unknown child expected outcome: {expected}"),
    }
    println!(
        "GOODDEALER_REBOOTSTRAP_LOCK_CHILD expected={expected} attempts={} acquired={} journal={} slot={} alias={} database={}",
        inspection.lock_attempts(),
        inspection.lock_acquired(),
        inspection.journal_inspections(),
        inspection.slot_inspections(),
        inspection.alias_inspections(),
        inspection.database_inspections(),
    );
}

#[cfg(unix)]
#[test]
fn terminal_restart_rejects_truncated_phase_history_without_repair() {
    let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::RetiredOld);
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let journal_path = root.rebootstrap_journal_path();
    let history = std::fs::read(&journal_path).unwrap();
    let mut terminal_only = history
        .split(|byte| *byte == b'\n')
        .rfind(|record| !record.is_empty())
        .expect("terminal history contains a final record")
        .to_vec();
    terminal_only.push(b'\n');
    assert_ne!(
        terminal_only, history,
        "fixture must contain a phase history"
    );
    std::fs::write(&journal_path, &terminal_only).unwrap();

    let probe = TestRebootstrapRecoveryCustody::open(&root, store.clone()).unwrap();
    let state_before_restart = probe.state_digest().unwrap();
    drop(probe);

    let (quarantined, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
            .unwrap();
    assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
    let status = quarantined.business_status();
    assert_eq!(status.state, DesktopLocalBusinessState::SecurityLocked);
    assert!(status.capabilities.is_empty());
    assert!(quarantined.runtime_state.lock().unwrap().is_none());
    assert_eq!(
        quarantined
            .rebootstrap_quarantine_custody
            .as_ref()
            .expect("quarantined Host retains lock-only custody")
            .state_digest(&store)
            .unwrap(),
        state_before_restart
    );
    assert_eq!(std::fs::read(&journal_path).unwrap(), terminal_only);

    let output = std::process::Command::new(
        std::env::current_exe().expect("current test executable is available"),
    )
    .arg("--exact")
    .arg("desktop_local_host::tests::rebootstrap_quarantine_lock_child_process")
    .arg("--ignored")
    .arg("--nocapture")
    .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_ROOT", &application_path)
    .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_EXPECT", "blocked")
    .output()
    .expect("lock contender child process starts");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "lock contender child failed: stdout={stdout}; stderr={stderr}"
    );
    assert!(stdout.contains(
        "GOODDEALER_REBOOTSTRAP_LOCK_CHILD expected=blocked attempts=1 acquired=0 journal=0 slot=0 alias=0 database=0"
    ));
    assert_eq!(
        quarantined
            .rebootstrap_quarantine_custody
            .as_ref()
            .expect("quarantined Host retains lock-only custody")
            .state_digest(&store)
            .unwrap(),
        state_before_restart
    );
    assert_eq!(std::fs::read(&journal_path).unwrap(), terminal_only);
}

#[cfg(unix)]
#[test]
fn quarantined_restart_retains_exclusive_process_lock_and_rejects_fresh_grant() {
    fn run_lock_child(application_path: &std::path::Path, expected: &str) -> String {
        let output = std::process::Command::new(
            std::env::current_exe().expect("current test executable is available"),
        )
        .arg("--exact")
        .arg("desktop_local_host::tests::rebootstrap_quarantine_lock_child_process")
        .arg("--ignored")
        .arg("--nocapture")
        .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_ROOT", application_path)
        .env("GOODDEALER_REBOOTSTRAP_LOCK_TEST_EXPECT", expected)
        .output()
        .expect("lock contender child process starts");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "lock contender child failed for {expected}: stdout={stdout}; stderr={stderr}"
        );
        let marker = format!("GOODDEALER_REBOOTSTRAP_LOCK_CHILD expected={expected}");
        assert!(
            stdout.contains(&marker),
            "child completion marker missing for {expected}: {stdout}"
        );
        stdout.into_owned()
    }

    let (directory, root, store) =
        seed_rebootstrap_crash(RebootstrapCrashBoundary::ReservationCreated);
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let journal_path = root.rebootstrap_journal_path();
    let (mut quarantined, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
            .unwrap();
    assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
    let before = quarantined
        .rebootstrap_quarantine_custody
        .as_ref()
        .unwrap()
        .state_digest(&store)
        .unwrap();
    let journal_before = std::fs::read(&journal_path).ok();

    let blocked = run_lock_child(&application_path, "blocked");
    assert!(blocked.contains("attempts=1 acquired=0 journal=0 slot=0 alias=0 database=0"));
    assert_eq!(
        quarantined
            .rebootstrap_quarantine_custody
            .as_ref()
            .unwrap()
            .state_digest(&store)
            .unwrap(),
        before
    );
    assert_eq!(std::fs::read(&journal_path).ok(), journal_before);

    let (verifier, signed_wire) =
        crate::desktop_local_host::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
    quarantined.authority_verifier = Some(verifier);
    assert!(
        quarantined
            .activate_authorization_grant(&signed_wire)
            .is_err()
    );
    assert_eq!(
        quarantined.business_status().state,
        DesktopLocalBusinessState::SecurityLocked
    );
    assert!(quarantined.business_status().capabilities.is_empty());
    assert!(quarantined.runtime_state.lock().unwrap().is_none());
    assert!(quarantined.begin_sync_run().is_err());
    assert!(
        quarantined
            .read_asset_library(DesktopAssetLibraryReadRequest {
                start_index: 0,
                size: 10,
                query: String::new(),
            })
            .is_err()
    );
    drop(quarantined);

    let acquired = run_lock_child(&application_path, "acquired");
    assert!(acquired.contains("attempts=1 acquired=1 journal=0 slot=0 alias=0 database=0"));
    assert_eq!(std::fs::read(&journal_path).ok(), journal_before);
}

#[cfg(unix)]
#[test]
#[allow(clippy::too_many_lines)]
fn hostile_quarantine_concurrently_rejects_grant_read_sync_and_mutation_without_writing() {
    let (directory, root, store) =
        seed_rebootstrap_crash(RebootstrapCrashBoundary::ReservationCreated);
    let journal_path = root.rebootstrap_journal_path();
    let (mut host, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
            .unwrap();
    assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
    let state_before = host
        .rebootstrap_quarantine_custody
        .as_ref()
        .unwrap()
        .state_digest(&store)
        .unwrap();
    let journal_before = std::fs::read(&journal_path).ok();
    let (verifier, signed_wire) =
        crate::desktop_local_host::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
    host.authority_verifier = Some(verifier);
    let host = std::sync::Arc::new(host);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(5));

    let grant_host = std::sync::Arc::clone(&host);
    let grant_barrier = std::sync::Arc::clone(&barrier);
    let grant = std::thread::spawn(move || {
        grant_barrier.wait();
        grant_host.activate_authorization_grant(&signed_wire)
    });
    let read_host = std::sync::Arc::clone(&host);
    let read_barrier = std::sync::Arc::clone(&barrier);
    let read = std::thread::spawn(move || {
        read_barrier.wait();
        read_host.read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        })
    });
    let sync_host = std::sync::Arc::clone(&host);
    let sync_barrier = std::sync::Arc::clone(&barrier);
    let sync = std::thread::spawn(move || {
        sync_barrier.wait();
        sync_host.begin_sync_run()
    });
    let mutation_host = std::sync::Arc::clone(&host);
    let mutation_barrier = std::sync::Arc::clone(&barrier);
    let mutation = std::thread::spawn(move || {
        mutation_barrier.wait();
        mutation_host.edit_domain_asset(edit_request(
            "quarantine-concurrent-mutation",
            0,
            1,
            "must-not-write",
        ))
    });
    barrier.wait();

    assert!(matches!(
        grant.join().unwrap(),
        Err(DesktopLocalHostError::AuthorityRejected | DesktopLocalHostError::Unavailable)
    ));
    assert!(matches!(
        read.join().unwrap(),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        sync.join().unwrap(),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        mutation.join().unwrap(),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.read_dns_health(crate::DesktopDnsHealthReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.read_settings(),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.read_sales(crate::DesktopSalesReadRequest {
            start_index: 0,
            size: 10,
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.read_batch_operations(crate::DesktopBatchOperationsReadRequest {
            start_index: 0,
            size: 10,
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.read_manual_tasks(crate::DesktopManualTasksReadRequest {
            start_index: 0,
            size: 10,
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.read_history(crate::DesktopHistoryReadRequest {
            start_index: 0,
            size: 10,
            today_from: "2026-08-28T00:00:00Z".to_owned(),
            today_until: "2026-08-29T00:00:00Z".to_owned(),
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert!(matches!(
        host.read_renewals(crate::DesktopRenewalsReadRequest {
            start_index: 0,
            size: 10,
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::SecurityLocked
    );
    assert!(host.runtime_state.lock().unwrap().is_none());
    assert_eq!(
        host.rebootstrap_quarantine_custody
            .as_ref()
            .unwrap()
            .state_digest(&store)
            .unwrap(),
        state_before
    );
    assert_eq!(std::fs::read(&journal_path).ok(), journal_before);
    drop(directory);
}

#[cfg(unix)]
#[test]
fn fresh_grant_read_and_sync_admission_linearize_after_recovery() {
    let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
    let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
    let journal_path = application_path
        .join("active-workspace")
        .join("rebootstrap.journal");
    let (mut host, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local").unwrap();
    assert_eq!(
        disposition,
        RebootstrapRestartDisposition::CancelledUnpublished
    );
    let journal_before = std::fs::read(&journal_path).unwrap();
    let (verifier, signed_wire) =
        crate::desktop_local_host::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "2099-12-31T23:59:59Z",
        );
    let device_id = host
        .production_custody
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .load_device_id()
        .unwrap();
    VerifiedWorkspaceAuthority::verify(
        &signed_wire,
        &TrustedWorkspaceBinding {
            account_id: None,
            device_id: &device_id,
            minimum_account_security_epoch: 0,
            minimum_lease_epoch: 0,
        },
        current_unix_seconds().unwrap(),
        &verifier,
    )
    .unwrap();
    host.authority_verifier = Some(verifier);
    let host = std::sync::Arc::new(host);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));

    let grant_host = std::sync::Arc::clone(&host);
    let grant_barrier = std::sync::Arc::clone(&barrier);
    let grant = std::thread::spawn(move || {
        grant_barrier.wait();
        grant_host.activate_authorization_grant(&signed_wire)
    });
    let read_host = std::sync::Arc::clone(&host);
    let read_barrier = std::sync::Arc::clone(&barrier);
    let read = std::thread::spawn(move || {
        read_barrier.wait();
        read_host.read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        })
    });
    let sync_host = std::sync::Arc::clone(&host);
    let sync_barrier = std::sync::Arc::clone(&barrier);
    let sync = std::thread::spawn(move || {
        sync_barrier.wait();
        sync_host.begin_sync_run()
    });
    barrier.wait();

    assert_eq!(grant.join().unwrap(), Ok(()));
    match read.join().unwrap() {
        Ok(snapshot) => {
            assert_eq!(snapshot.total_rows, 1);
            assert_eq!(snapshot.window.rows[0].domain, "old-local.example");
        }
        Err(error) => assert_eq!(error, DesktopLocalHostError::AuthorityRejected),
    }
    match sync.join().unwrap() {
        Ok(_) => {}
        Err(error) => assert_eq!(error, DesktopLocalHostError::AuthorityRejected),
    }
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::Active
    );
    assert!(host.begin_sync_run().is_ok());
    assert_eq!(std::fs::read(&journal_path).unwrap(), journal_before);
}

#[cfg(unix)]
#[test]
fn hostile_slot_states_quarantine_without_repair() {
    let cases = [
        TestRebootstrapStoreHostileCase::RemoveSlot(RebootstrapSlot::B),
        TestRebootstrapStoreHostileCase::MalformSlot(RebootstrapSlot::A),
        TestRebootstrapStoreHostileCase::MalformSlot(RebootstrapSlot::B),
        TestRebootstrapStoreHostileCase::ReplaceSlotKey(RebootstrapSlot::A),
        TestRebootstrapStoreHostileCase::ReplaceSlotKey(RebootstrapSlot::B),
        TestRebootstrapStoreHostileCase::ReplaceSlotOrigin(RebootstrapSlot::A),
        TestRebootstrapStoreHostileCase::ReplaceSlotOrigin(RebootstrapSlot::B),
        TestRebootstrapStoreHostileCase::SwapSlots,
    ];
    for hostile in cases {
        let (_directory, root, store) =
            seed_rebootstrap_crash(RebootstrapCrashBoundary::CandidateReserved);
        store.apply_hostile_case_for_test(hostile).unwrap();
        let (host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local")
                .unwrap_or_else(|error| {
                    panic!("hostile {hostile:?} failed closed incorrectly: {error:?}")
                });
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::Quarantined,
            "hostile {hostile:?} was admitted"
        );
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert!(host.runtime_state.lock().unwrap().is_none());
    }
}

#[cfg(unix)]
#[test]
fn corrupted_alias_cache_is_repaired_only_after_authenticated_slot_recovery() {
    let hostile_aliases = [
        TestRebootstrapStoreHostileCase::RemoveActiveAlias,
        TestRebootstrapStoreHostileCase::MalformActiveAliasShort,
        TestRebootstrapStoreHostileCase::MalformActiveAliasLong,
        TestRebootstrapStoreHostileCase::RandomActiveAlias,
        TestRebootstrapStoreHostileCase::ReplaceActiveAliasKey,
    ];
    for boundary in [
        RebootstrapCrashBoundary::CandidateReserved,
        RebootstrapCrashBoundary::Published,
    ] {
        let expected = if boundary == RebootstrapCrashBoundary::CandidateReserved {
            RebootstrapRestartDisposition::CancelledUnpublished
        } else {
            RebootstrapRestartDisposition::ResumedPublished
        };
        for hostile in hostile_aliases {
            let (directory, root, store) = seed_rebootstrap_crash(boundary);
            let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
            store.apply_hostile_case_for_test(hostile).unwrap();
            let (mut host, disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("alias cache {hostile:?}/{boundary:?} was not recoverable: {error:?}")
            });
            assert_eq!(
                disposition, expected,
                "alias cache {hostile:?}/{boundary:?}"
            );
            activate_recovered_host_and_assert_business(
                &mut host,
                expected,
                "alias-cache-repair",
                boundary,
            );
            drop(host);

            // A second process start must load the repaired alias from custody rather than
            // relying on the first recovery's in-memory slot key.
            let second_root = DesktopApplicationRoot::validate(&application_path).unwrap();
            let (mut second, second_disposition) = DesktopLocalHost::restart_rebootstrap_for_test(
                second_root,
                store.clone(),
                "workspace-local",
            )
            .unwrap_or_else(|error| {
                panic!("repaired alias {hostile:?}/{boundary:?} did not read back: {error:?}")
            });
            assert_eq!(
                second_disposition,
                RebootstrapRestartDisposition::TerminalValidated,
                "repaired alias {hostile:?}/{boundary:?}"
            );
            activate_recovered_host_and_assert_business(
                &mut second,
                expected,
                "alias-cache-readback",
                boundary,
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn sole_credential_cancel_prefix_requires_exact_alias_and_quarantines_without_writing() {
    for hostile in [
        TestRebootstrapStoreHostileCase::RemoveActiveAlias,
        TestRebootstrapStoreHostileCase::MalformActiveAliasShort,
        TestRebootstrapStoreHostileCase::MalformActiveAliasLong,
        TestRebootstrapStoreHostileCase::RandomActiveAlias,
        TestRebootstrapStoreHostileCase::ReplaceActiveAliasKey,
    ] {
        let (_directory, root, store) = seed_cancel_restart_crash_from(
            RebootstrapCrashBoundary::CandidateReserved,
            RebootstrapCrashBoundary::CancelOldSlotDeleted,
        );
        store.apply_hostile_case_for_test(hostile).unwrap();
        let journal_path = root.rebootstrap_journal_path();
        let journal_before = std::fs::read(&journal_path).unwrap();
        let probe = TestRebootstrapRecoveryCustody::open(&root, store.clone()).unwrap();
        let state_before = probe.state_digest().unwrap();
        drop(probe);

        let (host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store.clone(), "workspace-local")
                .unwrap_or_else(|error| {
                    panic!("sole-credential alias {hostile:?} did not fail closed: {error:?}")
                });
        assert_eq!(
            disposition,
            RebootstrapRestartDisposition::Quarantined,
            "sole-credential alias {hostile:?} was admitted"
        );
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
        assert!(host.runtime_state.lock().unwrap().is_none());
        assert_eq!(
            host.rebootstrap_quarantine_custody
                .as_ref()
                .unwrap()
                .state_digest(&store)
                .unwrap(),
            state_before,
            "sole-credential alias {hostile:?} was mutated during rejection"
        );
        assert_eq!(
            std::fs::read(&journal_path).unwrap(),
            journal_before,
            "sole-credential alias {hostile:?} appended a journal record"
        );
    }
}

#[cfg(unix)]
#[test]
fn hostile_journal_wires_and_file_topologies_fail_closed_without_repair() {
    for (name, wire) in [
        ("malformed", b"{".as_slice()),
        ("legacy-v2", br#"{"schemaVersion":2}"#.as_slice()),
        ("unknown-v4", br#"{"schemaVersion":4}"#.as_slice()),
        (
            "unknown-field",
            br#"{"schemaVersion":3,"unexpected":true}"#.as_slice(),
        ),
    ] {
        let (_directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
        std::fs::write(root.rebootstrap_journal_path(), wire).unwrap();
        let (host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local")
                .unwrap_or_else(|error| panic!("journal {name} did not fail closed: {error:?}"));
        assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
    }

    for topology in ["sidecar", "hardlink", "mode", "wrong-inode", "symlink"] {
        let (directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
        let application_path = directory.path().canonicalize().unwrap().join("GoodDealer");
        let workspace = application_path.join("active-workspace");
        let database = workspace.join("business.db");
        match topology {
            "sidecar" => std::fs::write(workspace.join("business.db-wal"), b"foreign").unwrap(),
            "hardlink" => {
                std::fs::hard_link(&database, workspace.join("business-hardlink.db")).unwrap();
            }
            "mode" => {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(&database, std::fs::Permissions::from_mode(0o644))
                    .unwrap();
            }
            "wrong-inode" => {
                let replacement = workspace.join("replacement.db");
                std::fs::copy(&database, &replacement).unwrap();
                std::fs::rename(&database, workspace.join("original.db")).unwrap();
                std::fs::rename(replacement, &database).unwrap();
            }
            "symlink" => {
                use std::os::unix::fs::symlink;
                std::fs::rename(&database, workspace.join("original.db")).unwrap();
                symlink("original.db", &database).unwrap();
            }
            _ => unreachable!(),
        }
        let result = DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local");
        match result {
            Ok((host, disposition)) => {
                assert_eq!(
                    disposition,
                    RebootstrapRestartDisposition::Quarantined,
                    "topology {topology} was admitted"
                );
                assert_eq!(
                    host.business_status().state,
                    DesktopLocalBusinessState::SecurityLocked
                );
            }
            Err(DesktopLocalHostError::StorageRejected) => {}
            Err(error) => panic!("topology {topology} returned wrong error: {error:?}"),
        }
    }
}

#[cfg(unix)]
#[test]
fn wrong_workspace_and_missing_journal_with_residue_are_quarantined() {
    for boundary in [
        RebootstrapCrashBoundary::Prepared,
        RebootstrapCrashBoundary::Published,
        RebootstrapCrashBoundary::RetiredOld,
    ] {
        let (_directory, root, store) = seed_rebootstrap_crash(boundary);
        let (host, disposition) =
            DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-foreign")
                .unwrap();
        assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
        assert_eq!(
            host.business_status().state,
            DesktopLocalBusinessState::SecurityLocked
        );
    }

    let (_directory, root, store) = seed_rebootstrap_crash(RebootstrapCrashBoundary::Prepared);
    std::fs::remove_file(root.rebootstrap_journal_path()).unwrap();
    let (host, disposition) =
        DesktopLocalHost::restart_rebootstrap_for_test(root, store, "workspace-local").unwrap();
    assert_eq!(disposition, RebootstrapRestartDisposition::Quarantined);
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::SecurityLocked
    );
}

#[test]
fn qualified_development_continuity_restarts_export_inspect_only() {
    let directory = tempdir().unwrap();
    let database = BusinessDatabase::open(
        &directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x51; 32]),
        "workspace-local",
    )
    .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    assert_eq!(
        host.continuity_startup_for_test().unwrap(),
        StartupContinuity::VerifiedLocalContinuation
    );

    host.enter_commercial_read_only().unwrap();
    assert_eq!(
        host.authorization_status(),
        DesktopHostAuthorizationStatus::Continuation
    );
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::CommercialReadOnly
    );
    let status = serde_json::to_value(host.backup_status()).unwrap();
    assert_eq!(status["authority"], "verified_local_continuation");
    assert_eq!(status["exportAdmission"]["state"], "available");
    assert_eq!(status["artifactSelectionAdmission"]["state"], "available");
    let sync = serde_json::to_value(host.read_sync_snapshot().unwrap()).unwrap();
    assert_eq!(sync["source"], "local_continuation");
    assert_eq!(sync["transport"], "blocked");
    assert_eq!(sync["blockedReason"], "authorization");
    assert_eq!(sync["activity"], "idle");
    let conflicts = serde_json::to_value(host.read_conflict_center().unwrap()).unwrap();
    assert_eq!(conflicts["freshness"]["source"], "local_continuation");
    let publication = host.authority_publication.lock().unwrap();
    assert!(host.require_current_authority(&publication, false).is_ok());
    assert_eq!(
        host.require_current_authority(&publication, true),
        Err(DesktopBackupError::AuthorityRejected)
    );
}

#[test]
fn unqualified_continuity_never_misreports_commercial_backup_authority() {
    let directory = tempdir().unwrap();
    let database = BusinessDatabase::open(
        &directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x52; 32]),
        "workspace-local",
    )
    .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    {
        let mut publication = host.authority_publication.lock().unwrap();
        publication.continuity = None;
        publication.verified_continuation = None;
    }
    assert_eq!(
        host.enter_commercial_read_only(),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
    assert_eq!(
        host.authorization_status(),
        DesktopHostAuthorizationStatus::SecurityLocked
    );
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::SecurityLocked
    );
    assert!(matches!(
        host.read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
    let status = serde_json::to_value(host.backup_status()).unwrap();
    assert_eq!(status["authority"], "unavailable");
    assert_eq!(status["exportAdmission"]["state"], "unavailable");
    assert_eq!(status["artifactSelectionAdmission"]["state"], "unavailable");
}

#[test]
fn qualified_host_startup_locks_on_receipt_tamper() {
    let directory = tempdir().unwrap();
    let database = BusinessDatabase::open(
        &directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x53; 32]),
        "workspace-local",
    )
    .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    {
        let publication = host.authority_publication.lock().unwrap();
        publication
            .continuity
            .as_ref()
            .unwrap()
            .tamper_committed_receipt_for_test()
            .unwrap();
    }
    assert_eq!(
        host.continuity_startup_for_test().unwrap(),
        StartupContinuity::SecurityLocked
    );
}

#[test]
fn qualified_host_persists_retryable_barrier_before_clearing_runtime() {
    let directory = tempdir().unwrap();
    let database = BusinessDatabase::open(
        &directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x54; 32]),
        "workspace-local",
    )
    .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let binding = host
        .authority_publication
        .lock()
        .unwrap()
        .verified_continuation
        .as_ref()
        .unwrap()
        .binding();
    host.enter_retryable_lock().unwrap();
    let publication = host.authority_publication.lock().unwrap();
    let startup = publication
        .continuity
        .as_ref()
        .unwrap()
        .load_startup(&binding, current_unix_seconds().unwrap(), true, true)
        .unwrap();
    assert_eq!(startup.decision, StartupContinuity::RetryableLocked);
    assert!(startup.continuation.is_none());
    assert!(host.runtime_state.lock().unwrap().is_none());
}

#[test]
fn half_composed_continuity_fails_closed_for_restriction_transitions() {
    let retryable_directory = tempdir().unwrap();
    let retryable_database = BusinessDatabase::open(
        &retryable_directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x55; 32]),
        "workspace-local",
    )
    .unwrap();
    let retryable_host = DesktopLocalHost::development(
        retryable_database,
        retryable_directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    retryable_host
        .authority_publication
        .lock()
        .unwrap()
        .verified_continuation = None;

    assert_eq!(
        retryable_host.enter_commercial_read_only(),
        Err(DesktopLocalHostError::StorageRejected)
    );
    let retryable_authority = retryable_host.authority_publication.lock().unwrap();
    assert_eq!(
        retryable_authority.restriction,
        RuntimeRestriction::SecurityLocked
    );
    assert!(retryable_authority.authority.is_none());
    assert!(retryable_authority.verified_continuation.is_none());
    drop(retryable_authority);
    assert!(retryable_host.runtime_state.lock().unwrap().is_none());
    assert_eq!(
        retryable_host.authorization_status(),
        DesktopHostAuthorizationStatus::SecurityLocked
    );
    assert!(matches!(
        retryable_host.read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));

    let commercial_directory = tempdir().unwrap();
    let commercial_database = BusinessDatabase::open(
        &commercial_directory.path().join("active.db"),
        &LocalDatabaseKey::from_bytes([0x56; 32]),
        "workspace-local",
    )
    .unwrap();
    let commercial_host = DesktopLocalHost::development(
        commercial_database,
        commercial_directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    commercial_host
        .authority_publication
        .lock()
        .unwrap()
        .continuity = None;

    assert_eq!(
        commercial_host.enter_commercial_read_only(),
        Err(DesktopLocalHostError::StorageRejected)
    );
    let commercial_authority = commercial_host.authority_publication.lock().unwrap();
    assert_eq!(
        commercial_authority.restriction,
        RuntimeRestriction::SecurityLocked
    );
    assert!(commercial_authority.authority.is_none());
    assert!(commercial_authority.verified_continuation.is_none());
    drop(commercial_authority);
    assert!(commercial_host.runtime_state.lock().unwrap().is_none());
    assert_eq!(
        commercial_host.authorization_status(),
        DesktopHostAuthorizationStatus::SecurityLocked
    );
    assert!(matches!(
        commercial_host.read_asset_library(DesktopAssetLibraryReadRequest {
            start_index: 0,
            size: 10,
            query: String::new(),
        }),
        Err(DesktopLocalHostError::AuthorityRejected)
    ));
}

#[test]
fn request_wire_is_bounded_exact_and_single_value() {
    let host = DesktopLocalHost::production_unavailable();
    for wire in [
        br"{}".as_slice(),
        br#"{"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false,"extra":true}"#,
        br#"{"schemaVersion":1,"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false}"#,
        br#"{"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false} {}"#,
    ] {
        assert_eq!(
            host.export_backup(wire),
            Err(DesktopBackupError::OperationRejected)
        );
    }
    assert_eq!(
        host.export_backup(&vec![b' '; MAX_REQUEST_WIRE_BYTES + 1]),
        Err(DesktopBackupError::OperationRejected)
    );
    let mut exact_maximum = br#"{"schemaVersion":1,"operationId":"operation-opaque-0001","includePlatformCredentials":false}"#.to_vec();
    exact_maximum.resize(MAX_REQUEST_WIRE_BYTES, b' ');
    assert!(parse_request::<BackupExportRequest>(&exact_maximum).is_ok());
}

#[test]
fn credential_request_is_rejected_before_native_availability() {
    let host = DesktopLocalHost::production_unavailable();
    let wire = format!(
        r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}","includePlatformCredentials":true}}"#
    );
    assert_eq!(
        host.export_backup(wire.as_bytes()),
        Err(DesktopBackupError::CredentialsNotAllowed)
    );
}

#[test]
fn valid_requests_without_host_issued_admission_fail_closed() {
    let host = DesktopLocalHost::production_unavailable();
    let export = format!(
        r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}","includePlatformCredentials":false}}"#
    );
    let inspect = format!(r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}"}}"#);
    let restore = format!(
        r#"{{"schemaVersion":1,"operationId":"{OPERATION_ID}","dialogId":"dialog-opaque-00001","artifactId":"artifact-opaque-001","expectedCurrentRevision":0,"candidateSetVersion":1,"confirmation":"RESTORE LOCAL BACKUP"}}"#
    );
    assert_eq!(
        host.export_backup(export.as_bytes()),
        Err(DesktopBackupError::OperationRejected)
    );
    assert_eq!(
        host.inspect_backup(inspect.as_bytes()),
        Err(DesktopBackupError::OperationRejected)
    );
    let before = host.provider_connection_generation();
    assert_eq!(
        host.restore_backup(restore.as_bytes()),
        Err(DesktopBackupError::OperationRejected)
    );
    // A refused restore still advances the connection generation past both of its edges, so
    // no Provider outcome stamped before or during it is shown afterwards.
    assert_eq!(host.provider_connection_generation(), before + 2);
    // A request refused before any restore work leaves it alone.
    assert!(host.restore_backup(b"{}").is_err());
    assert_eq!(host.provider_connection_generation(), before + 2);
}

#[test]
fn debug_output_is_redacted() {
    let host = DesktopLocalHost::production_unavailable();
    assert_eq!(format!("{host:?}"), "DesktopLocalHost([REDACTED])");
}

fn asset(note: &str) -> DomainAssetWrite {
    DomainAssetWrite {
        entity_id: "backup.example".to_owned(),
        note: Some(note.to_owned()),
        portfolio_id: None,
        tags: vec!["backup".to_owned()],
        target_price: None,
    }
}

fn development_business_host() -> (tempfile::TempDir, DesktopLocalHost) {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x5a; 32]);
    let mut database = BusinessDatabase::open(
        &directory.path().join("business.db"),
        &key,
        "workspace-local",
    )
    .unwrap();
    database
        .upsert_domain_asset("seed-business", "2026-09-15T08:00:00Z", &asset("before"))
        .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    (directory, host)
}

fn development_conflict_host() -> (tempfile::TempDir, DesktopLocalHost) {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x5b; 32]);
    let mut database = BusinessDatabase::open(
        &directory.path().join("business.db"),
        &key,
        "workspace-local",
    )
    .unwrap();
    database
        .upsert_domain_asset("seed-conflict", "2026-09-15T08:00:00Z", &asset("local"))
        .unwrap();
    let page = serde_json::json!({
        "schemaVersion": 3,
        "workspaceId": "workspace-local",
        "fromServerRevisionExclusive": 0,
        "throughServerRevisionInclusive": 1,
        "mutations": [{
            "schemaVersion": 3,
            "mutationId": "remote-conflict",
            "workspaceId": "workspace-local",
            "workspaceSchemaVersion": 1,
            "entityType": "domain_asset",
            "entityId": "backup.example",
            "entityGeneration": 1,
            "operationKind": "upsert",
            "baseServerRevision": 0,
            "changedFields": [{"fieldPath": "note", "value": "remote"}],
            "sourceDeviceId": "remote-device",
            "activeLeaseEpoch": 1,
            "deviceMutationSequence": 1,
            "serverRevision": 1
        }],
        "returnedThroughServerRevision": 1,
        "nextCursor": null,
        "pageDigest": "CEM15LbmHWo0wsDQgJ7ww85yoRWcjJ0CiSVlkgQf_p8"
    });
    database
        .apply_sync_page_v2("reader-local", &page.to_string(), "confirm-conflict")
        .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    (directory, host)
}

fn domain_detail_request() -> DesktopDomainDetailReadRequest {
    serde_json::from_value(serde_json::json!({"entityId": "backup.example"})).unwrap()
}

fn edit_request(
    mutation_id: &str,
    read_generation: u64,
    asset_version: u64,
    note: &str,
) -> DesktopDomainAssetEditRequest {
    serde_json::from_value(serde_json::json!({
        "mutationId": mutation_id,
        "expectedReadGeneration": read_generation,
        "expectedAssetVersion": asset_version,
        "asset": {
            "entityId": "backup.example",
            "note": note,
            "portfolioId": null,
            "tags": ["backup"],
            "targetPrice": null
        }
    }))
    .unwrap()
}

fn delete_request(
    mutation_id: &str,
    read_generation: u64,
    asset_version: u64,
) -> DesktopDomainAssetDeleteRequest {
    serde_json::from_value(serde_json::json!({
        "mutationId": mutation_id,
        "expectedReadGeneration": read_generation,
        "expectedAssetVersion": asset_version,
        "entityId": "backup.example"
    }))
    .unwrap()
}

fn conflict_request(view: &DesktopConflictCenterView) -> DesktopConflictResolveRequest {
    let conflict = view.conflicts.first().expect("conflict");
    serde_json::from_value(serde_json::json!({
        "schemaVersion": 1,
        "expectedReadGeneration": view.read_generation,
        "candidateSetVersion": view.candidate_set_version,
        "candidateId": conflict.candidate_id,
        "expectedRevision": conflict.comparison_server_revision,
        "expectedCandidateVersion": conflict.resolution_admission["expectedCandidateVersion"],
        "expectedCurrentValueHash": conflict.current_value_hash,
        "choice": "keep_local"
    }))
    .unwrap()
}

fn pending_mutation_count(host: &DesktopLocalHost) -> usize {
    host.runtime_state
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .business
        .database_for_backup()
        .test_pending_sync_rows(1_000)
        .unwrap()
        .len()
}

fn request_id(status: &serde_json::Value, field: &str) -> String {
    status[field]["operationId"]
        .as_str()
        .expect("available operation id")
        .to_owned()
}

fn development_restore_host(key_byte: u8) -> (tempfile::TempDir, DesktopLocalHost) {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([key_byte; 32]);
    let mut database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    database
        .upsert_domain_asset("mutation-old", "2026-09-15T08:00:00Z", &asset("old"))
        .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    (directory, host)
}

fn prepare_restore_request(host: &DesktopLocalHost) -> Vec<u8> {
    let status = serde_json::to_value(host.backup_status()).unwrap();
    let export_operation_id = request_id(&status, "exportAdmission");
    let selection_operation_id = request_id(&status, "artifactSelectionAdmission");
    host.export_backup(
        format!(r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#)
            .as_bytes(),
    )
    .unwrap();
    host.runtime_state
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .business
        .database_for_backup_mut()
        .upsert_domain_asset("mutation-new", "2026-09-15T08:01:00Z", &asset("new"))
        .unwrap();
    let verified = serde_json::to_value(
        host.inspect_backup(
            format!(r#"{{"schemaVersion":1,"operationId":"{selection_operation_id}"}}"#).as_bytes(),
        )
        .unwrap(),
    )
    .unwrap();
    let admission = &verified["restoreAdmission"];
    serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1,
        "operationId": admission["operationId"],
        "dialogId": admission["dialogId"],
        "artifactId": verified["artifactId"],
        "expectedCurrentRevision": admission["expectedCurrentRevision"],
        "candidateSetVersion": admission["candidateSetVersion"],
        "confirmation": REQUIRED_CONFIRMATION,
    }))
    .unwrap()
}

#[derive(Debug, PartialEq, Eq)]
struct RestoreDatabaseSnapshot {
    local_commit_sequence: u64,
    note: Option<String>,
    restore_outbox_rows: i64,
    restore_history_rows: i64,
}

fn restore_database_snapshot(host: &DesktopLocalHost) -> RestoreDatabaseSnapshot {
    let mut runtime = host.runtime_state.lock().unwrap();
    let database = runtime.as_mut().unwrap().business.database_for_backup_mut();
    let local_commit_sequence = database.recovery_proof().unwrap().local_commit_sequence;
    let note = database
        .read_domain_detail("backup.example")
        .unwrap()
        .asset
        .note;
    let (restore_outbox_rows, restore_history_rows) = database
        .backup_connection_mut()
        .query_row(
            "SELECT
               (SELECT count(*) FROM sync_outbox WHERE mutation_id LIKE 'restore-%'),
               (SELECT count(*) FROM business_history_events
                 WHERE event_kind LIKE 'backup_restore_%')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    RestoreDatabaseSnapshot {
        local_commit_sequence,
        note,
        restore_outbox_rows,
        restore_history_rows,
    }
}

fn create_request(
    mutation_id: &str,
    read_generation: u64,
    domain: &str,
) -> DesktopDomainAssetCreateRequest {
    serde_json::from_value(serde_json::json!({
        "mutationId": mutation_id,
        "expectedReadGeneration": read_generation,
        "asset": {
            "entityId": domain,
            "note": null,
            "portfolioId": null,
            "tags": [],
            "targetPrice": null
        }
    }))
    .unwrap()
}

#[test]
fn business_create_adds_a_new_domain_and_names_a_duplicate() {
    let (_directory, host) = development_business_host();
    let generation = host.business_status().read_generation;
    let receipt = host
        .create_domain_asset(create_request("host-create", generation, "added.example"))
        .unwrap();
    assert_eq!(receipt.operation, "create");
    assert!(
        host.read_domain_detail(
            serde_json::from_value(serde_json::json!({"entityId": "added.example"})).unwrap()
        )
        .is_ok()
    );
    // The seeded domain is already held: the duplicate keeps its own code and writes nothing.
    let pending = pending_mutation_count(&host);
    let generation = host.business_status().read_generation;
    assert_eq!(
        host.create_domain_asset(create_request(
            "host-duplicate",
            generation,
            "backup.example"
        )),
        Err(DesktopLocalHostError::AssetExists)
    );
    assert_eq!(pending_mutation_count(&host), pending);
    assert_eq!(
        DesktopLocalHostError::AssetExists.to_string(),
        "DESKTOP_LOCAL_ASSET_EXISTS"
    );
}

#[test]
fn business_create_of_an_unsettled_deleted_domain_is_blocked_without_writing() {
    let (_directory, host) = development_business_host();
    let before = host.read_domain_detail(domain_detail_request()).unwrap();
    let generation = host.business_status().read_generation;
    host.delete_domain_asset(delete_request(
        "host-delete",
        generation,
        before.asset.asset_version,
    ))
    .unwrap();
    // A pending deletion cannot be re-added; the Host keeps the refusal actionable and
    // does not create a second mutation.
    let pending = pending_mutation_count(&host);
    let generation = host.business_status().read_generation;
    let refused =
        host.create_domain_asset(create_request("host-readd", generation, "backup.example"));
    assert_eq!(refused, Err(DesktopLocalHostError::AssetReAddBlocked));
    assert_ne!(refused, Err(DesktopLocalHostError::AssetExists));
    assert_eq!(pending_mutation_count(&host), pending);
    assert_eq!(host.business_status().read_generation, generation);
    assert_eq!(
        DesktopLocalHostError::AssetReAddBlocked.to_string(),
        "DESKTOP_LOCAL_ASSET_RE_ADD_BLOCKED"
    );
}

#[test]
fn business_create_of_a_deleted_domain_is_refused_as_deleted_while_re_add_is_closed() {
    // Production builds keep the re-add entry closed until ADR-0029's completion condition
    // holds, so the Host answers a deleted domain exactly as it did before re-adding existed.
    crate::active_workspace::business::close_local_re_add_entry_for_test();
    let (_directory, host) = development_business_host();
    let before = host.read_domain_detail(domain_detail_request()).unwrap();
    let generation = host.business_status().read_generation;
    host.delete_domain_asset(delete_request(
        "host-delete",
        generation,
        before.asset.asset_version,
    ))
    .unwrap();
    let pending = pending_mutation_count(&host);
    let generation = host.business_status().read_generation;
    assert_eq!(
        host.create_domain_asset(create_request("host-readd", generation, "backup.example")),
        Err(DesktopLocalHostError::AssetDeleted)
    );
    assert_eq!(pending_mutation_count(&host), pending);
    assert_eq!(host.business_status().read_generation, generation);
    assert_eq!(
        DesktopLocalHostError::AssetDeleted.to_string(),
        "DESKTOP_LOCAL_ASSET_DELETED"
    );
}

#[test]
fn storage_repair_is_closed_to_unknown_input_stale_reads_and_a_moved_fence() {
    // ADR-0019: the Renderer names only a category it read a count for.
    let (_directory, host) = development_business_host();
    let generation = host.business_status().read_generation;
    let request = |kind: &str, generation: u64| -> crate::DesktopStorageRepairRequest {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "expectedReadGeneration": generation, "repairKind": kind,
        }))
        .unwrap()
    };
    assert!(
        serde_json::from_value::<crate::DesktopStorageRepairRequest>(serde_json::json!({
            "schemaVersion": 1, "expectedReadGeneration": generation,
            "repairKind": "malformedExpiries", "rowKey": "alpha.test",
        }))
        .is_err()
    );
    assert!(
        host.repair_stored_rows(request("everything", generation))
            .is_err()
    );
    assert!(
        host.repair_stored_rows(request("MalformedExpiries", generation))
            .is_err()
    );
    assert!(
        host.repair_stored_rows(request("malformedExpiries", generation + 1))
            .is_err()
    );
    // Nothing to repair: an empty receipt, and the read generation does not move.
    assert_eq!(
        host.repair_stored_rows(request("malformedExpiries", generation)),
        Ok(crate::DesktopStorageRepairReceipt {
            schema_version: 1,
            repair_kind: "malformedExpiries".to_owned(),
            repaired_rows: 0,
        })
    );
    assert_eq!(host.business_status().read_generation, generation);
    host.publish_transition_at_next_business_commit_for_test()
        .unwrap();
    assert_eq!(
        host.repair_stored_rows(request("malformedExpiries", generation)),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
}

#[test]
fn business_create_transition_at_final_fence_writes_nothing() {
    let (_directory, host) = development_business_host();
    let generation = host.business_status().read_generation;
    let pending = pending_mutation_count(&host);
    host.publish_transition_at_next_business_commit_for_test()
        .unwrap();
    assert_eq!(
        host.create_domain_asset(create_request(
            "fenced-create",
            generation,
            "fenced.example"
        )),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
    let runtime = host.runtime_state.lock().unwrap();
    let business = &runtime.as_ref().unwrap().business;
    assert!(business.read_domain_detail("fenced.example").is_err());
    assert_eq!(business.read_generation(), generation);
    drop(runtime);
    assert_eq!(pending_mutation_count(&host), pending);
}

#[test]
fn business_edit_transition_at_final_fence_rolls_back_every_write() {
    let (_directory, host) = development_business_host();
    let before = host.read_domain_detail(domain_detail_request()).unwrap();
    let before_pending = pending_mutation_count(&host);
    let before_generation = host.business_status().read_generation;
    host.publish_transition_at_next_business_commit_for_test()
        .unwrap();

    assert_eq!(
        host.edit_domain_asset(edit_request(
            "fenced-edit",
            before_generation,
            before.asset.asset_version,
            "must-rollback",
        )),
        Err(DesktopLocalHostError::AuthorityRejected)
    );

    let runtime = host.runtime_state.lock().unwrap();
    let business = &runtime.as_ref().unwrap().business;
    assert_eq!(
        business
            .read_domain_detail("backup.example")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("before")
    );
    assert_eq!(business.read_generation(), before_generation);
    assert_eq!(
        business
            .database_for_backup()
            .test_pending_sync_rows(1_000)
            .unwrap()
            .len(),
        before_pending
    );
}

#[test]
fn business_delete_transition_at_final_fence_rolls_back_every_write() {
    let (_directory, host) = development_business_host();
    let before = host.read_domain_detail(domain_detail_request()).unwrap();
    let before_pending = pending_mutation_count(&host);
    let before_generation = host.business_status().read_generation;
    host.publish_transition_at_next_business_commit_for_test()
        .unwrap();

    assert_eq!(
        host.delete_domain_asset(delete_request(
            "fenced-delete",
            before_generation,
            before.asset.asset_version,
        )),
        Err(DesktopLocalHostError::AuthorityRejected)
    );

    let runtime = host.runtime_state.lock().unwrap();
    let business = &runtime.as_ref().unwrap().business;
    let after = business.read_domain_detail("backup.example").unwrap();
    assert_eq!(after.asset.note.as_deref(), Some("before"));
    assert_eq!(business.read_generation(), before_generation);
    assert_eq!(
        business
            .database_for_backup()
            .test_pending_sync_rows(1_000)
            .unwrap()
            .len(),
        before_pending
    );
}

#[test]
fn business_resolve_transition_at_final_fence_rolls_back_every_write() {
    let (_directory, host) = development_conflict_host();
    let view = host.read_conflict_center().unwrap();
    let request = conflict_request(&view);
    let before_pending = pending_mutation_count(&host);
    let before_generation = host.business_status().read_generation;
    host.publish_transition_at_next_business_commit_for_test()
        .unwrap();

    assert_eq!(
        host.resolve_conflict(request),
        Err(DesktopLocalHostError::AuthorityRejected)
    );

    let runtime = host.runtime_state.lock().unwrap();
    let business = &runtime.as_ref().unwrap().business;
    let after = business.read_conflict_center().unwrap();
    assert_eq!(after.conflicts.len(), 1);
    assert_eq!(after.conflicts[0].status, "pending");
    assert_eq!(business.read_generation(), before_generation);
    assert_eq!(
        business
            .database_for_backup()
            .test_pending_sync_rows(1_000)
            .unwrap()
            .len(),
        before_pending
    );
}

#[test]
fn conflict_retry_after_lease_renewal_replays_without_duplicate_and_new_work_uses_new_lease() {
    let (_directory, host) = development_conflict_host();
    let view = host.read_conflict_center().unwrap();
    let request_wire = serde_json::json!({
        "schemaVersion": 1,
        "expectedReadGeneration": view.read_generation,
        "candidateSetVersion": view.candidate_set_version,
        "candidateId": view.conflicts[0].candidate_id,
        "expectedRevision": view.conflicts[0].comparison_server_revision,
        "expectedCandidateVersion": view.conflicts[0].resolution_admission["expectedCandidateVersion"],
        "expectedCurrentValueHash": view.conflicts[0].current_value_hash,
        "choice": "keep_local"
    });
    let before_pending = pending_mutation_count(&host);
    let first = host
        .resolve_conflict(serde_json::from_value(request_wire.clone()).unwrap())
        .unwrap();
    assert!(first.enqueued_for_sync);
    assert_eq!(first.read_generation, 1);
    assert_eq!(pending_mutation_count(&host), before_pending + 1);
    assert_eq!(host.business_status().read_generation, 1);

    host.renew_business_authority_for_test(2).unwrap();
    let replay = host
        .resolve_conflict(serde_json::from_value(request_wire.clone()).unwrap())
        .unwrap();
    assert_eq!(replay, first);
    assert_eq!(pending_mutation_count(&host), before_pending + 1);
    assert_eq!(host.business_status().read_generation, 1);

    let detail = host.read_domain_detail(domain_detail_request()).unwrap();
    let committed = host
        .edit_domain_asset(edit_request(
            "after-lease-renewal",
            1,
            detail.asset.asset_version,
            "lease-two",
        ))
        .unwrap();
    assert_eq!(committed.active_lease_epoch, 2);
    assert_eq!(pending_mutation_count(&host), before_pending + 2);
    assert_eq!(host.business_status().read_generation, 2);
    assert_eq!(
        host.resolve_conflict(serde_json::from_value(request_wire).unwrap()),
        Err(DesktopLocalHostError::AuthorityRejected)
    );
}

#[test]
fn restore_transition_at_final_commit_fence_rolls_back_and_consumes_candidate() {
    let (_directory, host) = development_restore_host(0x71);
    let restore_wire = prepare_restore_request(&host);
    let before = restore_database_snapshot(&host);
    let zeroized_before = crate::desktop_local_host::source::asset_drop_probe_counts().0;
    host.publish_transition_at_restore_precommit_for_test()
        .unwrap();

    assert_eq!(
        host.restore_backup(&restore_wire),
        Err(DesktopBackupError::AuthorityRejected)
    );
    assert_eq!(restore_database_snapshot(&host), before);
    assert!(crate::desktop_local_host::source::asset_drop_probe_counts().0 > zeroized_before);
    assert_eq!(
        crate::desktop_local_host::source::asset_drop_probe_counts().1,
        0
    );
    {
        let operation = host.operation_selection.lock().unwrap();
        assert!(operation.selected_artifact.is_none());
        assert!(operation.selected_handle.is_none());
    }
    assert_eq!(
        host.restore_backup(&restore_wire),
        Err(DesktopBackupError::OperationRejected)
    );

    // The pending intent can subsequently be applied as a real closed transition.
    host.request_security_lock_for_test().unwrap();
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::SecurityLocked
    );
}

#[test]
fn restore_transition_after_sqlite_commit_preserves_success_then_applies_lock() {
    let (_directory, host) = development_restore_host(0x72);
    let restore_wire = prepare_restore_request(&host);
    let before = restore_database_snapshot(&host);
    host.publish_transition_after_restore_commit_for_test()
        .unwrap();

    let completed = host.restore_backup(&restore_wire).unwrap();
    assert_eq!(completed.authority, "active");
    assert!(matches!(
        completed.selected_artifact,
        SelectedArtifactView::None
    ));
    let after = restore_database_snapshot(&host);
    assert_eq!(after.note.as_deref(), Some("old"));
    assert!(after.local_commit_sequence > before.local_commit_sequence);
    assert!(after.restore_outbox_rows > before.restore_outbox_rows);
    assert!(after.restore_history_rows > before.restore_history_rows);

    // COMMIT is the terminal outcome even though a later intent is already visible. The
    // transition can now acquire the aggregate locks and remove the active runtime.
    assert_ne!(
        host.transition_requested_epoch.load(Ordering::Acquire),
        host.authority_publication
            .lock()
            .unwrap()
            .applied_authority_epoch
    );
    host.request_security_lock_for_test().unwrap();
    assert_eq!(
        host.business_status().state,
        DesktopLocalBusinessState::SecurityLocked
    );
    assert!(host.runtime_state.lock().unwrap().is_none());
}

#[test]
fn private_development_e2e_projects_seals_rereads_and_restores_current_database() {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x7a; 32]);
    let mut database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    database
        .upsert_domain_asset("mutation-old", "2026-09-15T08:00:00Z", &asset("old"))
        .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();

    let status = serde_json::to_value(host.backup_status()).unwrap();
    let export_operation_id = request_id(&status, "exportAdmission");
    let selection_operation_id = request_id(&status, "artifactSelectionAdmission");
    let export_wire = format!(
        r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#
    );
    host.export_backup(export_wire.as_bytes()).unwrap();
    assert_eq!(
        std::fs::read_to_string(
            directory
                .path()
                .join("native-backup")
                .join(format!("{export_operation_id}.journal"))
        )
        .unwrap(),
        "catalog_available"
    );

    host.runtime_state
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .business
        .database_for_backup_mut()
        .upsert_domain_asset("mutation-new", "2026-09-15T08:01:00Z", &asset("new"))
        .unwrap();
    let zeroized_before = crate::desktop_local_host::source::asset_drop_probe_counts().0;
    let inspect_wire = format!(r#"{{"schemaVersion":1,"operationId":"{selection_operation_id}"}}"#);
    let verified =
        serde_json::to_value(host.inspect_backup(inspect_wire.as_bytes()).unwrap()).unwrap();
    assert!(crate::desktop_local_host::source::asset_drop_probe_counts().0 > zeroized_before);
    assert_eq!(verified["state"], "verified");
    assert_eq!(verified["compatibility"], "compatible");
    let admission = &verified["restoreAdmission"];
    let restore_wire = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1,
        "operationId": admission["operationId"],
        "dialogId": admission["dialogId"],
        "artifactId": verified["artifactId"],
        "expectedCurrentRevision": admission["expectedCurrentRevision"],
        "candidateSetVersion": admission["candidateSetVersion"],
        "confirmation": REQUIRED_CONFIRMATION,
    }))
    .unwrap();
    let restored = host.restore_backup(&restore_wire).unwrap();
    assert_eq!(
        serde_json::to_value(restored).unwrap()["selectedArtifact"]["state"],
        "none"
    );
    let detail = host
        .runtime_state
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .business
        .read_domain_detail("backup.example")
        .unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("old"));
    assert_eq!(
        crate::desktop_local_host::source::asset_drop_probe_counts().1,
        0
    );
}

#[test]
fn pending_authority_epoch_invalidates_an_admitted_operation_before_crypto() {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x7b; 32]);
    let database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let status = serde_json::to_value(host.backup_status()).unwrap();
    let export_operation_id = request_id(&status, "exportAdmission");
    host.transition_requested_epoch.store(2, Ordering::Release);
    let wire = format!(
        r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#
    );
    assert_eq!(
        host.export_backup(wire.as_bytes()),
        Err(DesktopBackupError::AuthorityRejected)
    );
}

#[test]
fn restore_rereads_exact_handle_and_rejects_same_size_cas_change() {
    use std::io::{Seek as _, SeekFrom, Write as _};

    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x7d; 32]);
    let mut database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    database
        .upsert_domain_asset("mutation-old", "2026-09-15T08:00:00Z", &asset("old"))
        .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let status = serde_json::to_value(host.backup_status()).unwrap();
    let export_operation_id = request_id(&status, "exportAdmission");
    let selection_operation_id = request_id(&status, "artifactSelectionAdmission");
    host.export_backup(
        format!(r#"{{"schemaVersion":1,"operationId":"{export_operation_id}","includePlatformCredentials":false}}"#)
            .as_bytes(),
    )
    .unwrap();
    let verified = serde_json::to_value(
        host.inspect_backup(
            format!(r#"{{"schemaVersion":1,"operationId":"{selection_operation_id}"}}"#).as_bytes(),
        )
        .unwrap(),
    )
    .unwrap();
    let admission = &verified["restoreAdmission"];
    let restore_wire = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1,
        "operationId": admission["operationId"],
        "dialogId": admission["dialogId"],
        "artifactId": verified["artifactId"],
        "expectedCurrentRevision": admission["expectedCurrentRevision"],
        "candidateSetVersion": admission["candidateSetVersion"],
        "confirmation": REQUIRED_CONFIRMATION,
    }))
    .unwrap();
    let path = directory
        .path()
        .join("native-backup")
        .join(format!("{export_operation_id}.gdbk"));
    let mut file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    file.seek(SeekFrom::Start(0)).unwrap();
    file.write_all(b"X").unwrap();
    file.sync_all().unwrap();

    assert_eq!(
        host.restore_backup(&restore_wire),
        Err(DesktopBackupError::ArtifactRejected)
    );
    assert!(
        host.operation_selection
            .lock()
            .unwrap()
            .selected_handle
            .is_none()
    );
}

#[test]
fn restriction_transition_clears_selection_and_admission() {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x7c; 32]);
    let database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(host.backup_status()).unwrap()["authority"],
        "active"
    );
    host.request_security_lock_for_test().unwrap();
    assert_eq!(
        serde_json::to_value(host.backup_status()).unwrap()["authority"],
        "unavailable"
    );
}

#[test]
fn activation_failure_fails_closed_and_clears_runtime_state() {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x7d; 32]);
    let database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let before = host.transition_requested_epoch.load(Ordering::Acquire);
    assert_eq!(
        host.activate_authorization_grant(b"malformed-grant"),
        Err(DesktopLocalHostError::Unavailable)
    );
    let after = host.transition_requested_epoch.load(Ordering::Acquire);
    let authority = host.authority_publication.lock().unwrap();
    assert_eq!(authority.restriction, RuntimeRestriction::SecurityLocked);
    assert!(authority.authority.is_none());
    assert_eq!(authority.applied_authority_epoch, after);
    assert!(after > before);
    assert!(host.runtime_state.lock().unwrap().is_none());
}

#[test]
fn valid_signed_incompatible_replacement_fails_closed_and_clears_all_runtime_state() {
    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x5d; 32]);
    let database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    let mut host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let (verifier, signed_wire) =
        crate::desktop_local_host::authority::tests::long_lived_signed_grant(
            2,
            &"11".repeat(32),
            "9998-12-31T23:59:59Z",
        );
    host.authority_verifier = Some(verifier);
    let continuation_binding = host
        .authority_publication
        .lock()
        .unwrap()
        .verified_continuation
        .as_ref()
        .unwrap()
        .binding();
    let _ = host.backup_status();
    let before = host.transition_requested_epoch.load(Ordering::Acquire);

    assert_eq!(
        host.activate_authorization_grant(&signed_wire),
        Err(DesktopLocalHostError::AuthorityRejected)
    );

    let after = host.transition_requested_epoch.load(Ordering::Acquire);
    let authority = host.authority_publication.lock().unwrap();
    assert_eq!(authority.restriction, RuntimeRestriction::SecurityLocked);
    assert!(authority.authority.is_none());
    assert!(authority.verified_continuation.is_none());
    assert_eq!(authority.applied_authority_epoch, after);
    assert!(after > before);
    let startup = authority
        .continuity
        .as_ref()
        .unwrap()
        .load_startup(
            &continuation_binding,
            current_unix_seconds().unwrap(),
            true,
            true,
        )
        .unwrap();
    assert_eq!(startup.decision, StartupContinuity::SecurityLocked);
    assert!(startup.continuation.is_none());
    drop(authority);
    assert!(host.runtime_state.lock().unwrap().is_none());
    let operation = host.operation_selection.lock().unwrap();
    assert!(operation.selected_handle.is_none());
    assert!(operation.selected_artifact.is_none());
    assert!(operation.export_operation_id.is_none());
    assert!(operation.selection_operation_id.is_none());
    assert!(operation.export_consumed);
    assert!(operation.selection_consumed);
}

#[test]
fn authority_transition_and_sync_recheck_complete_without_lock_inversion() {
    use std::sync::{Arc, Barrier, mpsc};
    use std::time::Duration;

    let directory = tempdir().unwrap();
    let key = LocalDatabaseKey::from_bytes([0x6d; 32]);
    let database =
        BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
            .unwrap();
    let host = DesktopLocalHost::development(
        database,
        directory.path().join("native-backup"),
        "account-local",
        "workspace-local",
        "device-local",
    )
    .unwrap();
    let admission = host.begin_sync_run().unwrap();
    let start = Arc::new(Barrier::new(3));
    let (sender, receiver) = mpsc::channel();

    std::thread::scope(|scope| {
        let sync_start = Arc::clone(&start);
        let sync_sender = sender.clone();
        let sync_host = &host;
        let sync_admission = &admission;
        scope.spawn(move || {
            sync_start.wait();
            sync_sender
                .send(("sync", sync_host.recheck_sync_run(sync_admission)))
                .unwrap();
        });
        let transition_start = Arc::clone(&start);
        let transition_sender = sender.clone();
        let transition_host = &host;
        scope.spawn(move || {
            transition_start.wait();
            transition_sender
                .send((
                    "transition",
                    transition_host
                        .request_security_lock_for_test()
                        .map_err(|_| DesktopLocalHostError::AuthorityRejected),
                ))
                .unwrap();
        });
        start.wait();

        let first = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("first concurrent operation must complete");
        let second = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("second concurrent operation must complete");
        let results = [first, second];
        assert!(
            results
                .iter()
                .any(|(kind, result)| { *kind == "transition" && result == &Ok(()) })
        );
        assert!(results.iter().any(|(kind, result)| {
            *kind == "sync"
                && matches!(
                    result,
                    Ok(()) | Err(DesktopLocalHostError::AuthorityRejected)
                )
        }));
    });
    assert_eq!(
        host.authorization_status(),
        DesktopHostAuthorizationStatus::SecurityLocked
    );
}

#[cfg(unix)]
#[test]
fn native_select_rejects_inode_swap_between_stat_and_open() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path().join("native");
    let native = DevelopmentNativeBackup::new(root.clone()).unwrap();
    let token = OPERATION_ID;
    let path = root.join(format!("{token}.gdbk"));
    let replacement = root.join("replacement.gdbk");
    std::fs::write(&path, b"original").unwrap();
    // Same byte length makes the inode identity check, rather than a size mismatch, the
    // mechanism that rejects the swap.
    std::fs::write(&replacement, b"intruder").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::set_permissions(&replacement, std::fs::Permissions::from_mode(0o600)).unwrap();
    let mut native = native;
    native.available.push(format!("{token}.gdbk"));
    let result = native.select_with_hooks(
        |path| {
            std::fs::rename(path, path.with_extension("gdbk.original")).unwrap();
            std::fs::rename(&replacement, path).unwrap();
        },
        |file, path| {
            let original = path.with_extension("gdbk.original");
            std::fs::rename(path, &replacement).unwrap();
            std::fs::rename(original, path).unwrap();
            // Keep the opened replacement alive until the identity comparison runs.
            assert!(file.metadata().is_ok());
        },
    );
    assert!(matches!(result, Err(DesktopBackupError::ArtifactRejected)));
}

#[cfg(unix)]
#[test]
fn recovery_rejects_symlinked_journal() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path().join("native");
    std::fs::create_dir_all(&root).unwrap();
    let target = root.join("outside");
    std::fs::write(&target, b"catalog_available").unwrap();
    let journal = root.join(format!("{OPERATION_ID}.journal"));
    std::os::unix::fs::symlink(&target, &journal).unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(matches!(
        DevelopmentNativeBackup::new(root),
        Err(DesktopBackupError::StorageRejected)
    ));
}

#[cfg(unix)]
#[test]
fn recovery_rejects_oversized_journal() {
    use std::os::unix::fs::OpenOptionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path().join("native");
    std::fs::create_dir_all(&root).unwrap();
    let journal = root.join(format!("{OPERATION_ID}.journal"));
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&journal)
        .unwrap();
    file.write_all(&[b'x'; 65]).unwrap();
    file.sync_all().unwrap();
    assert!(matches!(
        DevelopmentNativeBackup::new(root),
        Err(DesktopBackupError::StorageRejected)
    ));
}

#[cfg(unix)]
#[test]
fn native_reread_rejects_retained_handle_link_count_change() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path().join("native");
    let mut native = DevelopmentNativeBackup::new(root.clone()).unwrap();
    let path = root.join(format!("{OPERATION_ID}.gdbk"));
    std::fs::write(&path, b"artifact").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    native.available.push(format!("{OPERATION_ID}.gdbk"));
    let handle = native.select().unwrap();
    std::fs::hard_link(&path, root.join("attacker-link")).unwrap();
    assert!(matches!(
        native.read(&handle),
        Err(DesktopBackupError::ArtifactRejected)
    ));
}

#[cfg(unix)]
#[test]
fn journal_replacement_does_not_follow_existing_symlink() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path().join("native");
    let native = DevelopmentNativeBackup::new(root.clone()).unwrap();
    let outside = root.join("outside");
    std::fs::write(&outside, b"do-not-overwrite").unwrap();
    std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o600)).unwrap();
    let journal = root.join(format!("{OPERATION_ID}.journal"));
    std::os::unix::fs::symlink(&outside, &journal).unwrap();
    native.persist_journal(OPERATION_ID, "reserved").unwrap();
    assert_eq!(std::fs::read(&outside).unwrap(), b"do-not-overwrite");
    let metadata = std::fs::symlink_metadata(&journal).unwrap();
    assert!(metadata.file_type().is_file());
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::read(&journal).unwrap(), b"reserved");
}

#[cfg(unix)]
#[test]
fn recovery_quarantines_every_incomplete_publication_phase() {
    use std::os::unix::fs::OpenOptionsExt;

    for phase in ["reserved", "writing", "fsynced", "renamed", "quarantined"] {
        let directory = tempdir().unwrap();
        let root = directory.path().join("native");
        std::fs::create_dir_all(&root).unwrap();
        let journal = root.join(format!("{OPERATION_ID}.journal"));
        let mut journal_file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&journal)
            .unwrap();
        journal_file.write_all(phase.as_bytes()).unwrap();
        journal_file.sync_all().unwrap();
        let available = root.join(format!("{OPERATION_ID}.gdbk"));
        let writing = root.join(format!(".{OPERATION_ID}.writing"));
        let mut available_file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&available)
            .unwrap();
        available_file.write_all(b"partial").unwrap();
        let mut writing_file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&writing)
            .unwrap();
        writing_file.write_all(b"partial").unwrap();

        let native = DevelopmentNativeBackup::new(root.clone()).unwrap();
        assert!(native.available.is_empty(), "phase {phase}");
        assert!(!available.exists(), "phase {phase}");
        assert!(!writing.exists(), "phase {phase}");
        assert_eq!(
            std::fs::read(&journal).unwrap(),
            b"quarantined",
            "phase {phase}"
        );
    }
}

#[cfg(unix)]
#[test]
fn recovery_restores_only_catalog_available_publication() {
    use std::os::unix::fs::OpenOptionsExt;

    let directory = tempdir().unwrap();
    let root = directory.path().join("native");
    std::fs::create_dir_all(&root).unwrap();
    let journal = root.join(format!("{OPERATION_ID}.journal"));
    let artifact = root.join(format!("{OPERATION_ID}.gdbk"));
    for (path, bytes) in [
        (&journal, b"catalog_available".as_slice()),
        (&artifact, b"artifact".as_slice()),
    ] {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .unwrap();
        file.write_all(bytes).unwrap();
        file.sync_all().unwrap();
    }
    let native = DevelopmentNativeBackup::new(root).unwrap();
    assert_eq!(native.available, vec![format!("{OPERATION_ID}.gdbk")]);
}
