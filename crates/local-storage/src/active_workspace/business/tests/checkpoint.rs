use super::*;

#[test]
fn native_checkpoint_due_is_durable_and_clears_only_with_exact_descriptor() {
    let mut database = database();
    assert_eq!(database.native_checkpoint_due(), Ok(true));
    let invalid = NativeCheckpointDescriptor {
        schema_version: 3,
        checkpoint_id: "checkpoint-1".to_owned(),
        workspace_id: "other-workspace".to_owned(),
        workspace_schema_version: 1,
        through_server_revision: 0,
        checkpoint_digest: "A".repeat(43),
    };
    assert_eq!(
        database.complete_native_checkpoint_guarded(Some(&invalid), TIMESTAMP, || Ok(())),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(database.native_checkpoint_due(), Ok(true));
    let descriptor = NativeCheckpointDescriptor {
        workspace_id: "workspace-local".to_owned(),
        checkpoint_digest: "A".repeat(43),
        ..invalid
    };
    database
        .complete_native_checkpoint_guarded(Some(&descriptor), TIMESTAMP, || Ok(()))
        .unwrap();
    assert_eq!(database.native_checkpoint_due(), Ok(false));
    database
        .mark_sync_rebootstrap_required_v2("device-local")
        .unwrap();
    assert_eq!(database.native_checkpoint_due(), Ok(true));
}

/// A descriptor stored before the version 3 upgrade is inert: nothing reads its fields back, the
/// due bit alone schedules the next fetch, and that fetch replaces it. A version 2 response is
/// refused rather than stored again.
#[test]
fn native_checkpoint_state_from_a_version_2_descriptor_upgrades_on_the_next_fetch() {
    let mut database = database();
    database
        .store
        .fixture_connection()
        .execute(
            "INSERT INTO native_cloud_checkpoint_state
                (workspace_id,checkpoint_due,checkpoint_id,checkpoint_schema_version,
                 through_server_revision,workspace_schema_version,checkpoint_digest,checked_at)
             VALUES ('workspace-local',0,'legacy',2,0,1,?1,?2)",
            rusqlite::params!["B".repeat(43), TIMESTAMP],
        )
        .unwrap();
    assert_eq!(database.native_checkpoint_due(), Ok(false));
    database
        .mark_sync_rebootstrap_required_v2("device-local")
        .unwrap();
    assert_eq!(database.native_checkpoint_due(), Ok(true));
    let legacy = NativeCheckpointDescriptor {
        schema_version: 2,
        checkpoint_id: "checkpoint-2".to_owned(),
        workspace_id: "workspace-local".to_owned(),
        workspace_schema_version: 1,
        through_server_revision: 0,
        checkpoint_digest: "A".repeat(43),
    };
    assert_eq!(
        database.complete_native_checkpoint_guarded(Some(&legacy), TIMESTAMP, || Ok(())),
        Err(BusinessDatabaseError::InvalidInput)
    );
    let current = NativeCheckpointDescriptor {
        schema_version: 3,
        ..legacy
    };
    database
        .complete_native_checkpoint_guarded(Some(&current), TIMESTAMP, || Ok(()))
        .unwrap();
    let stored: (String, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT checkpoint_id,checkpoint_schema_version FROM native_cloud_checkpoint_state
             WHERE workspace_id='workspace-local'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(stored, ("checkpoint-2".to_owned(), 3));
    assert_eq!(database.native_checkpoint_due(), Ok(false));
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the table-driven test keeps every incompatible floor and its zero-write assertion together"
)]
fn rebootstrap_checkpoint_rejects_every_incompatible_floor_without_writing() {
    for floor in [
        "applied",
        "read-through",
        "pinned-target",
        "checkpoint-through",
        "anti-rollback",
        "anti-schema",
    ] {
        let mut database = database();
        seed_rebootstrap_floor_guard_evidence(&mut database);
        match floor {
            "applied" => {
                database
                    .store
                    .raw_connection()
                    .execute(
                        "UPDATE active_workspace_metadata
                         SET applied_through_server_revision=7 WHERE singleton=1",
                        [],
                    )
                    .unwrap();
            }
            "read-through" => {
                database
                    .store
                    .raw_connection()
                    .execute(
                        "UPDATE sync_reader_state
                         SET read_through_server_revision=7,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "pinned-target" => {
                database
                    .store
                    .raw_connection()
                    .execute(
                        "UPDATE sync_reader_state
                         SET pinned_target_server_revision=7,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "checkpoint-through" => {
                database
                    .store
                    .raw_connection()
                    .execute(
                        "UPDATE sync_reader_state
                         SET checkpoint_id='checkpoint-7',checkpoint_through_server_revision=7,
                             row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "anti-rollback" => {
                database
                    .store
                    .raw_connection()
                    .execute(
                        "UPDATE sync_reader_state
                         SET anti_rollback_server_revision_floor=7,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "anti-schema" => {
                database
                    .store
                    .raw_connection()
                    .execute(
                        "UPDATE sync_reader_state
                         SET anti_rollback_schema_version_floor=3,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            _ => unreachable!(),
        }
        let before = rebootstrap_floor_guard_oracle(&database);
        assert_eq!(before.evidence_counts, (1, 1, 1, 1, 0));

        let rejected = database.install_rebootstrap_checkpoint(&[], 6, "reader-local", |proof| {
            Ok(journal_link(proof, 1))
        });

        assert_eq!(
            rejected,
            Err(BusinessDatabaseError::RevisionRejected),
            "floor={floor}"
        );
        assert_eq!(
            rebootstrap_floor_guard_oracle(&database),
            before,
            "floor={floor}"
        );
    }
}

#[test]
fn rebootstrap_checkpoint_rejects_workspace_binding_drift_without_writing() {
    let mut database = database();
    seed_rebootstrap_floor_guard_evidence(&mut database);
    let before = rebootstrap_floor_guard_oracle(&database);
    database.workspace_id = "other-workspace".to_owned();

    let rejected = database
        .install_rebootstrap_checkpoint(&[], 7, "reader-local", |proof| Ok(journal_link(proof, 1)));

    assert_eq!(rejected, Err(BusinessDatabaseError::WorkspaceRejected));
    database.workspace_id = "workspace-local".to_owned();
    assert_eq!(rebootstrap_floor_guard_oracle(&database), before);
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the table-driven test keeps every negative floor and its zero-write assertion together"
)]
fn rebootstrap_checkpoint_rejects_every_negative_floor_without_writing() {
    for floor in [
        "applied",
        "read-through",
        "pinned-target",
        "checkpoint-through",
        "anti-rollback",
        "anti-schema",
    ] {
        let mut database = database();
        seed_rebootstrap_floor_guard_evidence(&mut database);
        let connection = database.store.raw_connection();
        connection
            .execute_batch("PRAGMA ignore_check_constraints=ON;")
            .unwrap();
        if matches!(floor, "anti-rollback" | "anti-schema") {
            connection
                .execute_batch("DROP TRIGGER sync_reader_state_v3_floor_monotonic;")
                .unwrap();
        }
        match floor {
            "applied" => {
                connection
                    .execute(
                        "UPDATE active_workspace_metadata
                         SET applied_through_server_revision=-1 WHERE singleton=1",
                        [],
                    )
                    .unwrap();
            }
            "read-through" => {
                connection
                    .execute(
                        "UPDATE sync_reader_state
                         SET read_through_server_revision=-1,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "pinned-target" => {
                connection
                    .execute(
                        "UPDATE sync_reader_state
                         SET pinned_target_server_revision=-1,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "checkpoint-through" => {
                connection
                    .execute(
                        "UPDATE sync_reader_state
                         SET checkpoint_id='corrupt-checkpoint',
                             checkpoint_through_server_revision=-1,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "anti-rollback" => {
                connection
                    .execute(
                        "UPDATE sync_reader_state
                         SET anti_rollback_server_revision_floor=-1,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            "anti-schema" => {
                connection
                    .execute(
                        "UPDATE sync_reader_state
                         SET anti_rollback_schema_version_floor=-1,row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            _ => unreachable!(),
        }
        connection
            .execute_batch("PRAGMA ignore_check_constraints=OFF;")
            .unwrap();
        let before = rebootstrap_corruption_oracle(&database);
        assert_eq!(before.temp_checkpoint_table_count, 0);

        let rejected = database.install_rebootstrap_checkpoint(&[], 7, "reader-local", |proof| {
            Ok(journal_link(proof, 1))
        });

        assert_eq!(
            rejected,
            Err(BusinessDatabaseError::RevisionRejected),
            "floor={floor}"
        );
        assert_eq!(
            rebootstrap_corruption_oracle(&database),
            before,
            "floor={floor}"
        );
    }
}

#[test]
fn rebootstrap_checkpoint_rejects_missing_metadata_singleton_without_writing() {
    let mut database = database();
    let connection = database.store.raw_connection();
    connection
        .execute_batch("DROP TRIGGER active_workspace_metadata_no_delete;")
        .unwrap();
    connection
        .execute(
            "DELETE FROM active_workspace_metadata WHERE singleton=1",
            [],
        )
        .unwrap();
    let before = rebootstrap_corruption_oracle(&database);
    assert_eq!(before.temp_checkpoint_table_count, 0);

    let rejected = database
        .install_rebootstrap_checkpoint(&[], 1, "reader-local", |proof| Ok(journal_link(proof, 1)));

    assert_eq!(rejected, Err(BusinessDatabaseError::StorageRejected));
    assert_eq!(rebootstrap_corruption_oracle(&database), before);
}

#[test]
fn rebootstrap_checkpoint_rejects_non_integer_floors_without_writing() {
    for source in ["metadata-applied", "reader-aggregate"] {
        let mut database = database();
        seed_rebootstrap_floor_guard_evidence(&mut database);
        let connection = database.store.raw_connection();
        connection
            .execute_batch("PRAGMA ignore_check_constraints=ON;")
            .unwrap();
        match source {
            "metadata-applied" => {
                relax_strict_table_for_corruption(connection, "active_workspace_metadata");
                connection
                    .execute(
                        "UPDATE active_workspace_metadata
                         SET applied_through_server_revision='corrupt' WHERE singleton=1",
                        [],
                    )
                    .unwrap();
            }
            "reader-aggregate" => {
                relax_strict_table_for_corruption(connection, "sync_reader_state");
                connection
                    .execute(
                        "UPDATE sync_reader_state
                         SET pinned_target_server_revision='corrupt',row_version=row_version+1
                         WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                        [],
                    )
                    .unwrap();
            }
            _ => unreachable!(),
        }
        connection
            .execute_batch("PRAGMA ignore_check_constraints=OFF;")
            .unwrap();
        let before = rebootstrap_corruption_oracle(&database);
        assert_eq!(before.temp_checkpoint_table_count, 0);

        let rejected = database.install_rebootstrap_checkpoint(&[], 7, "reader-local", |proof| {
            Ok(journal_link(proof, 1))
        });

        assert_eq!(
            rejected,
            Err(BusinessDatabaseError::StorageRejected),
            "source={source}"
        );
        assert_eq!(
            rebootstrap_corruption_oracle(&database),
            before,
            "source={source}"
        );
    }
}

#[test]
fn stale_checkpoint_cannot_be_hidden_by_later_replay_and_is_zero_write() {
    let mut database = database();
    for revision in 1..=7 {
        database
            .apply_sync_page_v2(
                "reader-local",
                &test_sync_page(revision, &format!("remote {revision}")),
                &format!("confirm-{revision}"),
            )
            .unwrap();
    }
    let before = rebootstrap_floor_guard_oracle(&database);
    assert_eq!(before.proof.applied_server_revision, 7);
    assert_eq!(before.evidence_counts, (0, 0, 0, 7, 0));
    let journal_called = std::cell::Cell::new(false);
    let fence_called = std::cell::Cell::new(false);
    let replay = RebootstrapReplayPage {
        // This page is byte-equivalent to the already retained revision-7 inbox record.
        // Without the baseline floor gate it would be treated as idempotent and skip the
        // projection overwritten by the stale checkpoint.
        page_json: test_sync_page(7, "remote 7"),
        confirmation_token: "confirm-7".to_owned(),
    };

    let rejected = database.install_rebootstrap_plan_guarded(
        &[],
        &[],
        6,
        "reader-local",
        &[replay],
        |proof| {
            journal_called.set(true);
            Ok(journal_link(proof, 1))
        },
        || {
            fence_called.set(true);
            Ok(())
        },
    );

    assert_eq!(rejected, Err(BusinessDatabaseError::RevisionRejected));
    assert!(!journal_called.get());
    assert!(!fence_called.get());
    assert_eq!(rebootstrap_floor_guard_oracle(&database), before);
}

#[test]
fn newer_checkpoint_preserves_local_authority_while_advancing_all_revision_floors() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "local-before-newer-checkpoint",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "local.test".to_owned(),
                note: Some("local authority".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();

    database
        .install_rebootstrap_checkpoint(
            &[DomainAssetWrite {
                entity_id: "local.test".to_owned(),
                note: Some("remote checkpoint".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            }],
            7,
            "reader-local",
            |proof| Ok(journal_link(proof, 1)),
        )
        .unwrap();

    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("local authority")
    );
    assert_eq!(database.test_pending_sync_rows(10).unwrap().len(), 1);
    assert!(!database.read_sync_conflicts(10).unwrap().is_empty());
    let floors: (i64, i64, Option<i64>, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT m.applied_through_server_revision,r.read_through_server_revision,
                    r.pinned_target_server_revision,r.anti_rollback_server_revision_floor
             FROM active_workspace_metadata m JOIN sync_reader_state r
               ON r.workspace_id=m.workspace_id
             WHERE m.singleton=1 AND r.device_id='reader-local'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(floors, (7, 7, Some(7), 7));
}

#[test]
fn rebootstrap_checkpoint_creates_remote_roots_and_preserves_omitted_local_state() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "local-before-rebootstrap",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "local.test".to_owned(),
                note: Some("pending local".to_owned()),
                portfolio_id: None,
                tags: vec!["local".to_owned()],
                target_price: None,
            },
        )
        .unwrap();
    database
        .install_rebootstrap_checkpoint(
            &[DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("checkpoint".to_owned()),
                portfolio_id: None,
                tags: vec!["remote".to_owned()],
                target_price: Some(Money {
                    currency: "USD".to_owned(),
                    amount: "42".to_owned(),
                }),
            }],
            7,
            "reader-local",
            |_| {
                Ok(RebootstrapJournalLink {
                    journal_id: "journal-checkpoint".to_owned(),
                    slot_id: RebootstrapSlotId::A,
                    publication_sequence: 1,
                    manifest_digest: "a".repeat(64),
                    authority_digest: "b".repeat(64),
                    floor_digest: "c".repeat(64),
                    binding_digest: "d".repeat(64),
                })
            },
        )
        .unwrap();

    let snapshot = database.read_portfolio().unwrap();
    assert_eq!(snapshot.applied_through_server_revision, 7);
    assert_eq!(
        snapshot
            .domains
            .iter()
            .map(|row| row.entity_id.as_str())
            .collect::<Vec<_>>(),
        vec!["local.test", "remote.test"]
    );
    let (root, desired, tags, reader): (i64, i64, i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT
               (SELECT count(*) FROM domain_assets
                WHERE workspace_id='workspace-local' AND entity_id='remote.test'
                  AND lifecycle_status='active'),
               (SELECT count(*) FROM domain_asset_desired_state
                WHERE workspace_id='workspace-local' AND entity_id='remote.test'),
               (SELECT count(*) FROM domain_asset_tags
                WHERE workspace_id='workspace-local' AND entity_id='remote.test' AND tag='remote'),
               (SELECT count(*) FROM sync_reader_state
                WHERE workspace_id='workspace-local' AND device_id='reader-local'
                  AND read_through_server_revision=7 AND status='active')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!((root, desired, tags, reader), (1, 1, 1, 1));
    assert_eq!(database.test_pending_sync_rows(10).unwrap().len(), 1);
}

#[test]
fn rebootstrap_checkpoint_journal_failure_rolls_back_projection() {
    let mut database = database();
    let link = RebootstrapJournalLink {
        journal_id: "journal-a".to_owned(),
        slot_id: RebootstrapSlotId::A,
        publication_sequence: 1,
        manifest_digest: "a".repeat(64),
        authority_digest: "b".repeat(64),
        floor_digest: "c".repeat(64),
        binding_digest: "d".repeat(64),
    };
    database
        .install_rebootstrap_checkpoint_guarded(
            &[DomainAssetWrite {
                entity_id: "first.test".to_owned(),
                note: Some("one".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            }],
            1,
            "reader-local",
            |_| Ok(link.clone()),
            || Ok(()),
        )
        .unwrap();
    let error = database.install_rebootstrap_checkpoint_guarded(
        &[DomainAssetWrite {
            entity_id: "second.test".to_owned(),
            note: Some("two".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        }],
        2,
        "reader-local",
        |_| Ok(link.clone()),
        || Ok(()),
    );
    assert!(error.is_err());
    let count: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM domain_assets WHERE entity_id='second.test'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[cfg(unix)]
#[test]
fn descriptor_bound_clean_start_verification_is_read_only_and_exact() {
    let (_directory, path, key, expected_proof, _link) = prepared_read_only_recovery_candidate();
    let retained = std::fs::File::open(&path).unwrap();
    let before = recovery_candidate_file_state(&path);
    assert_eq!(before.3, [false, false, false]);

    let actual =
        verify_clean_start_database_read_only(&retained, &key, "workspace-recovery", 1).unwrap();

    assert_eq!(actual, expected_proof);
    assert_eq!(recovery_candidate_file_state(&path), before);
    let connection = open_descriptor_bound_database_read_only(&retained, &key).unwrap();
    let memory_security: String = connection
        .query_row("PRAGMA cipher_memory_security", [], |row| row.get(0))
        .unwrap();
    assert_eq!(memory_security, "0");
}

#[cfg(unix)]
#[test]
fn descriptor_bound_clean_start_rejection_is_zero_write() {
    let (_directory, path, key, _expected_proof, _link) = prepared_read_only_recovery_candidate();
    let retained = std::fs::File::open(&path).unwrap();
    let before = recovery_candidate_file_state(&path);

    assert_eq!(
        verify_clean_start_database_read_only(&retained, &key, "other-workspace", 1),
        Err(BusinessDatabaseError::WorkspaceRejected)
    );
    assert_eq!(recovery_candidate_file_state(&path), before);

    assert_eq!(
        verify_clean_start_database_read_only(&retained, &key, "workspace-recovery", 2,),
        Err(BusinessDatabaseError::SchemaRejected)
    );
    assert_eq!(recovery_candidate_file_state(&path), before);

    let wrong_key = LocalDatabaseKey::from_bytes([0x6d; 32]);
    assert_eq!(
        verify_clean_start_database_read_only(&retained, &wrong_key, "workspace-recovery", 1,),
        Err(BusinessDatabaseError::StorageRejected)
    );
    assert_eq!(recovery_candidate_file_state(&path), before);
}

#[cfg(unix)]
#[test]
fn descriptor_bound_clean_start_rejects_schema_drift_without_writing() {
    let (_directory, path, key, _expected_proof, _link) = prepared_read_only_recovery_candidate();
    {
        let mut database = BusinessDatabase::open_existing_derived(&path, &key).unwrap();
        database
            .store
            .fixture_connection()
            .execute_batch(
                "CREATE TABLE unexpected_schema_drift (
                   id INTEGER PRIMARY KEY
                 ) STRICT;",
            )
            .unwrap();
        database.prepare_rebootstrap_publication().unwrap();
    }
    let retained = std::fs::File::open(&path).unwrap();
    let before = recovery_candidate_file_state(&path);
    assert_eq!(before.3, [false, false, false]);

    assert_eq!(
        verify_clean_start_database_read_only(&retained, &key, "workspace-recovery", 1,),
        Err(BusinessDatabaseError::SchemaRejected)
    );
    assert_eq!(recovery_candidate_file_state(&path), before);
}

#[cfg(unix)]
#[test]
fn descriptor_bound_recovery_verification_is_read_only_and_exact() {
    let (_directory, path, key, expected_proof, link) = prepared_read_only_recovery_candidate();
    let retained = std::fs::File::open(&path).unwrap();
    let before = recovery_candidate_file_state(&path);
    assert_eq!(before.3, [false, false, false]);

    let actual =
        verify_rebootstrap_recovery_read_only(&retained, &key, "workspace-recovery", &link)
            .unwrap();

    assert_eq!(actual, expected_proof);
    assert_eq!(recovery_candidate_file_state(&path), before);
}

#[cfg(unix)]
#[test]
fn descriptor_bound_terminal_publication_verifies_optional_link_on_one_read_only_connection() {
    let (_directory, path, key, expected_proof, link) = prepared_read_only_recovery_candidate();
    let retained = std::fs::File::open(&path).unwrap();
    let before = recovery_candidate_file_state(&path);

    let linked = verify_terminal_publication_database_read_only(
        &retained,
        &key,
        "workspace-recovery",
        1,
        Some(&link),
    )
    .unwrap();
    let without_link_expectation = verify_terminal_publication_database_read_only(
        &retained,
        &key,
        "workspace-recovery",
        1,
        None,
    )
    .unwrap();

    assert_eq!(linked, expected_proof);
    assert_eq!(without_link_expectation, expected_proof);
    assert_eq!(recovery_candidate_file_state(&path), before);
}

#[cfg(unix)]
#[test]
fn terminal_publication_returns_current_proof_without_comparing_historical_manifest_digest() {
    let (_directory, path, key, old_proof, link) = prepared_read_only_recovery_candidate();
    {
        let mut database = BusinessDatabase::open_existing_derived(&path, &key).unwrap();
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE active_workspace_metadata
                 SET last_replication_activity_at=?1 WHERE singleton=1",
                [TIMESTAMP],
            )
            .unwrap();
        database.prepare_rebootstrap_publication().unwrap();
    }
    let retained = std::fs::File::open(&path).unwrap();
    let before = recovery_candidate_file_state(&path);

    let current = verify_terminal_publication_database_read_only(
        &retained,
        &key,
        "workspace-recovery",
        1,
        Some(&link),
    )
    .unwrap();

    assert_ne!(current.row_digest, old_proof.row_digest);
    assert_ne!(current.row_digest, link.manifest_digest);
    assert_eq!(recovery_candidate_file_state(&path), before);
}

#[cfg(unix)]
#[test]
fn terminal_publication_rejects_hostile_link_rows_without_writing() {
    for hostile_case in [
        TestRebootstrapJournalLinkHostileCase::RemoveActive,
        TestRebootstrapJournalLinkHostileCase::DuplicateActive,
        TestRebootstrapJournalLinkHostileCase::MutateBindingDigest,
        TestRebootstrapJournalLinkHostileCase::MarkNonVerified,
    ] {
        let (_directory, path, key, _proof, link) = prepared_read_only_recovery_candidate();
        let expected_snapshot = {
            let mut database = BusinessDatabase::open_existing_derived(&path, &key).unwrap();
            let snapshot = database
                .active_rebootstrap_journal_link_snapshot_for_test()
                .unwrap();
            assert!(snapshot.is_present());
            assert_eq!(snapshot.active_row_count(), 1);
            assert!(snapshot.digest().is_some());
            database
                .apply_rebootstrap_journal_link_hostile_case_for_test(hostile_case)
                .unwrap();
            let hostile_snapshot = database
                .active_rebootstrap_journal_link_snapshot_for_test()
                .unwrap();
            match hostile_case {
                TestRebootstrapJournalLinkHostileCase::RemoveActive => {
                    assert_eq!(hostile_snapshot.active_row_count(), 0);
                    assert!(!hostile_snapshot.is_present());
                }
                TestRebootstrapJournalLinkHostileCase::DuplicateActive => {
                    assert_eq!(hostile_snapshot.active_row_count(), 2);
                    assert!(!hostile_snapshot.is_present());
                }
                TestRebootstrapJournalLinkHostileCase::MutateBindingDigest => {
                    assert_eq!(hostile_snapshot.active_row_count(), 1);
                    assert!(hostile_snapshot.is_present());
                    assert_ne!(hostile_snapshot.digest(), snapshot.digest());
                }
                TestRebootstrapJournalLinkHostileCase::MarkNonVerified => {
                    assert_eq!(hostile_snapshot.active_row_count(), 1);
                    assert!(!hostile_snapshot.is_present());
                }
            }
            database.prepare_rebootstrap_publication().unwrap();
            snapshot
        };
        assert!(expected_snapshot.is_present());
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);

        assert_eq!(
            verify_terminal_publication_database_read_only(
                &retained,
                &key,
                "workspace-recovery",
                1,
                Some(&link),
            ),
            Err(BusinessDatabaseError::StorageRejected),
            "hostile_case={hostile_case:?}"
        );
        assert_eq!(
            recovery_candidate_file_state(&path),
            before,
            "hostile_case={hostile_case:?}"
        );
    }
}

#[cfg(unix)]
#[test]
fn descriptor_bound_recovery_rejection_is_zero_write() {
    let (_directory, path, key, _expected_proof, link) = prepared_read_only_recovery_candidate();
    let retained = std::fs::File::open(&path).unwrap();
    let before = recovery_candidate_file_state(&path);

    assert_eq!(
        verify_rebootstrap_recovery_read_only(&retained, &key, "other-workspace", &link),
        Err(BusinessDatabaseError::WorkspaceRejected)
    );
    assert_eq!(recovery_candidate_file_state(&path), before);

    let mut wrong_link = link.clone();
    wrong_link.binding_digest = "d".repeat(64);
    assert_eq!(
        verify_rebootstrap_recovery_read_only(&retained, &key, "workspace-recovery", &wrong_link,),
        Err(BusinessDatabaseError::StorageRejected)
    );
    assert_eq!(recovery_candidate_file_state(&path), before);

    let wrong_key = LocalDatabaseKey::from_bytes([0x6d; 32]);
    assert_eq!(
        verify_rebootstrap_recovery_read_only(&retained, &wrong_key, "workspace-recovery", &link,),
        Err(BusinessDatabaseError::StorageRejected)
    );
    assert_eq!(recovery_candidate_file_state(&path), before);
}

#[test]
fn combined_rebootstrap_plan_journals_final_replay_proof_and_fence_failure_is_zero_write() {
    let mut database = database();
    let replay = RebootstrapReplayPage {
        page_json: test_sync_page(2, "final"),
        confirmation_token: "rebootstrap-plan".to_owned(),
    };
    let (proof, link) = database
        .install_rebootstrap_plan_guarded(
            &[DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("checkpoint".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            }],
            &[],
            1,
            "reader-local",
            &[replay],
            |proof| Ok(journal_link(proof, 1)),
            || Ok(()),
        )
        .unwrap();
    assert_eq!(proof.applied_server_revision, 2);
    assert_eq!(link.manifest_digest, proof.row_digest);
    database.verify_rebootstrap_journal_link(&link).unwrap();
    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("final")
    );

    let before = database.recovery_proof().unwrap();
    let rejected = database.install_rebootstrap_plan_guarded(
        &[DomainAssetWrite {
            entity_id: "other.test".to_owned(),
            note: Some("must rollback".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        }],
        &[],
        3,
        "reader-local",
        &[],
        |proof| Ok(journal_link(proof, 2)),
        || Err(BusinessDatabaseError::MutationStale),
    );
    assert_eq!(rejected, Err(BusinessDatabaseError::MutationStale));
    assert_eq!(database.recovery_proof().unwrap(), before);
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one database walks every checkpoint tombstone install case in order"
)]
fn rebootstrap_installs_checkpoint_tombstones_and_refuses_unsynced_deleted_edits() {
    // ADR-0029 C1c2a: a checkpoint's tombstones install as replicated deletions carrying only
    // their deletion revision; nothing about a deleted entity is lost or revived.
    let mut database = database();
    let asset = |entity_id: &str| DomainAssetWrite {
        entity_id: entity_id.to_owned(),
        note: Some("checkpoint".to_owned()),
        portfolio_id: None,
        tags: vec![],
        target_price: None,
    };
    let tombstone = |entity_id: &str, revision: u64| RebootstrapTombstone {
        entity_id: entity_id.to_owned(),
        entity_generation: 1,
        deleted_server_revision: revision,
        deleted_at: "2026-11-14T00:00:00Z".to_owned(),
    };
    let install = |database: &mut BusinessDatabase,
                   snapshot: &[DomainAssetWrite],
                   tombstones: &[RebootstrapTombstone],
                   revision: u64,
                   journal: u64| {
        database.install_rebootstrap_plan_guarded(
            snapshot,
            tombstones,
            revision,
            "reader-local",
            &[],
            |proof| Ok(journal_link(proof, journal)),
            || Ok(()),
        )
    };
    install(
        &mut database,
        &[asset("clean.test"), asset("pending.test")],
        &[],
        1,
        1,
    )
    .unwrap();
    database
        .upsert_domain_asset("local-edit", TIMESTAMP, &asset("pending.test"))
        .unwrap();

    // Malformed tombstone sets are refused before any write.
    let before = database.recovery_proof().unwrap();
    for (snapshot, tombstones) in [
        (vec![asset("clean.test")], vec![tombstone("clean.test", 2)]),
        (vec![], vec![tombstone("gone.test", 4)]),
        (vec![], vec![tombstone("gone.test", 0)]),
        (vec![], vec![tombstone("b.test", 2), tombstone("a.test", 2)]),
        (
            vec![],
            vec![RebootstrapTombstone {
                entity_generation: 0,
                ..tombstone("gone.test", 2)
            }],
        ),
        (
            vec![],
            vec![RebootstrapTombstone {
                deleted_at: "2026-11-14".to_owned(),
                ..tombstone("gone.test", 2)
            }],
        ),
    ] {
        assert_eq!(
            install(&mut database, &snapshot, &tombstones, 3, 2),
            Err(BusinessDatabaseError::InvalidInput)
        );
    }
    assert_eq!(database.recovery_proof().unwrap(), before);

    // A clean replicated asset is soft-deleted and an unseen one is recorded as deleted.
    install(
        &mut database,
        &[],
        &[tombstone("clean.test", 2), tombstone("gone.test", 3)],
        3,
        2,
    )
    .unwrap();
    // The library reads only live assets.
    assert_eq!(
        database.read_asset_library(0, 10, "").unwrap().total_rows,
        1
    );
    let tombstones = |database: &BusinessDatabase| {
        let connection = database.store.raw_connection();
        let mut statement = connection
            .prepare(
                "SELECT t.entity_id, t.entity_generation, t.deleted_server_revision,
                        t.order_server_revision, t.order_provenance, t.state, t.barrier_state,
                        a.deleted_at IS NOT NULL, a.entity_generation
                 FROM sync_tombstones t JOIN domain_assets a USING (workspace_id, entity_id)
                 ORDER BY t.entity_id",
            )
            .unwrap();
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, bool>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let installed = tombstones(&database);
    let expected = |entity_id: &str, revision: i64| {
        (
            entity_id.to_owned(),
            1,
            revision,
            revision,
            "checkpoint".to_owned(),
            "replicated".to_owned(),
            "replicated".to_owned(),
            true,
            1,
        )
    };
    assert_eq!(
        installed,
        [expected("clean.test", 2), expected("gone.test", 3)]
    );

    // A checkpoint tombstone never gains mutation ids it was not given.
    assert!(
        database
            .store
            .raw_connection()
            .execute(
                "UPDATE sync_tombstones SET order_source_device_id='device',
                 order_mutation_id='mutation' WHERE entity_id='gone.test'",
                [],
            )
            .unwrap_err()
            .to_string()
            .contains("tombstone order provenance is immutable")
    );

    // An unsynced local edit to a deleted entity refuses the whole installation.
    let before = database.recovery_proof().unwrap();
    assert_eq!(
        install(&mut database, &[], &[tombstone("pending.test", 4)], 4, 3),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(database.recovery_proof().unwrap(), before);

    // Re-installing a checkpoint that names tombstones already held keeps them unchanged.
    install(
        &mut database,
        &[],
        &[tombstone("clean.test", 2), tombstone("gone.test", 3)],
        4,
        3,
    )
    .unwrap();
    assert_eq!(tombstones(&database), installed);
}

#[test]
fn rebootstrap_generation_one_checkpoint_cannot_overwrite_provisional_generation_two() {
    let mut database = database_with_replicated_tombstone();
    database
        .re_add_domain_asset(
            "re-add-checkpoint-guard",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("current generation"),
        )
        .unwrap();
    let before = database.recovery_proof().unwrap();

    let result = database.install_rebootstrap_checkpoint(
        &[re_add_write("stale checkpoint")],
        2,
        "reader-local",
        |proof| Ok(journal_link(proof, 1)),
    );

    assert_eq!(result, Err(BusinessDatabaseError::InvalidInput));
    assert_eq!(database.recovery_proof().unwrap(), before);
    assert_eq!(
        database
            .read_domain_detail("remote.test")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("current generation")
    );
}

#[test]
fn rebootstrap_installs_generation_two_assets_and_tombstones_and_replays_idempotently() {
    let mut database = database();
    let asset = RebootstrapAsset {
        asset: re_add_write("generation two"),
        entity_generation: 2,
    };
    let tombstone = RebootstrapTombstone {
        entity_id: "deleted.test".to_owned(),
        entity_generation: 2,
        deleted_server_revision: 2,
        deleted_at: "2026-11-14T00:00:00Z".to_owned(),
    };
    let install = |database: &mut BusinessDatabase, publication_sequence| {
        database.install_rebootstrap_plan_with_generations_guarded(
            std::slice::from_ref(&asset),
            std::slice::from_ref(&tombstone),
            2,
            "reader-local",
            &[],
            |proof| Ok(journal_link(proof, publication_sequence)),
            || Ok(()),
        )
    };
    install(&mut database, 1).unwrap();
    install(&mut database, 2).unwrap();

    let connection = database.store.raw_connection();
    let generations: (i64, i64, i64) = connection
        .query_row(
            "SELECT (SELECT entity_generation FROM domain_assets WHERE entity_id='remote.test'),
                    (SELECT entity_generation FROM sync_tombstones WHERE entity_id='deleted.test'),
                    (SELECT entity_generation FROM domain_assets WHERE entity_id='deleted.test')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(generations, (2, 2, 2));
}

#[test]
fn rebootstrap_only_confirms_the_tombstone_under_a_provisional_re_add() {
    // ADR-0029 decision 4: while g + 1 is provisional, a checkpoint carrying the generation-g
    // tombstone agrees with the confirmed local state. It confirms that tombstone and leaves
    // the provisional row and its Outbox item to the acknowledgement or rejection.
    let mut database = database_with_replicated_tombstone();
    database
        .re_add_domain_asset(
            "re-add-provisional",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("provisional"),
        )
        .unwrap();
    let state = local_re_add_state(&database);
    install_generations(&mut database, &[], &[remote_tombstone(1, 2)], 2).unwrap();
    assert_eq!(local_re_add_state(&database), state);
    assert_eq!(state.0, 2);
    assert_eq!(state.3, 1);
    assert_eq!(
        database
            .read_domain_detail("remote.test")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("provisional")
    );
    // Cloud may already hold g + 1 (this re-add, its acknowledgement lost, or another
    // device's): the installation waits for the push result rather than deciding it.
    let before = remote_footprint(&database);
    assert_eq!(
        install_generations(
            &mut database,
            &[RebootstrapAsset {
                asset: re_add_write("cloud"),
                entity_generation: 2
            }],
            &[],
            3,
        ),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(remote_footprint(&database), before);
    // A tombstone of the same generation at another revision is not this deletion.
    assert_eq!(
        install_generations(&mut database, &[], &[remote_tombstone(1, 3)], 3),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(remote_footprint(&database), before);
}

#[test]
fn rebootstrap_waits_for_this_devices_unsettled_delete() {
    let mut database = database();
    own_create(&mut database);
    let echoes = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &echoes, "confirm-create").unwrap();
    let version = own_asset_version(&database);
    database
        .delete_domain_asset(
            "delete-unsettled",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            "remote.test",
            true,
        )
        .unwrap();
    let before = remote_footprint(&database);
    // Cloud has not answered the delete: the checkpoint may still hold the live asset, or
    // already hold this deletion. Either way the push result settles it first.
    assert_eq!(
        install_generations(
            &mut database,
            &[RebootstrapAsset {
                asset: re_add_write("cloud"),
                entity_generation: 1
            }],
            &[],
            2,
        ),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(
        install_generations(&mut database, &[], &[remote_tombstone(1, 2)], 2),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(remote_footprint(&database), before);
}

#[test]
fn rebootstrap_waits_for_a_contested_deletion_barrier() {
    let mut database = database_with_replicated_tombstone();
    database
        .store
        .raw_connection()
        .execute("UPDATE sync_tombstones SET barrier_state='contested'", [])
        .unwrap();
    let before = remote_footprint(&database);
    assert_eq!(
        install_generations(&mut database, &[], &[remote_tombstone(1, 2)], 2),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(remote_footprint(&database), before);
}

#[test]
fn rebootstrap_refuses_checkpoint_data_older_than_the_confirmed_generation() {
    // The settled generation-1 tombstone is the confirmed state; a checkpoint showing that
    // generation live, or a generation-1 deletion at another revision, is older data.
    let mut database = database_with_replicated_tombstone();
    let before = remote_footprint(&database);
    for (assets, tombstones) in [
        (
            vec![RebootstrapAsset {
                asset: re_add_write("old"),
                entity_generation: 1,
            }],
            vec![],
        ),
        (vec![], vec![remote_tombstone(1, 1)]),
    ] {
        assert_eq!(
            install_generations(&mut database, &assets, &tombstones, 2),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(remote_footprint(&database), before);
    }
    // The tombstone itself is accepted and changes nothing.
    install_generations(&mut database, &[], &[remote_tombstone(1, 2)], 2).unwrap();
    assert_eq!(remote_footprint(&database).1, before.1);
}

#[test]
fn rebootstrap_advances_a_settled_tombstone_to_a_later_checkpoint_deletion() {
    // Cloud re-added and deleted the entity again in history compaction folded away: the
    // checkpoint's generation-2 deletion replaces the confirmed generation-1 tombstone.
    let mut database = database_with_replicated_tombstone();
    install_generations(&mut database, &[], &[remote_tombstone(2, 3)], 3).unwrap();
    assert_eq!(remote_generation(&database), (2, true, Some((2, 3))));
    assert_eq!(advances(&database), [(1, 2, 3)]);
    // Re-installing the same checkpoint meets its own tombstone and changes nothing.
    let before = remote_footprint(&database);
    install_generations(&mut database, &[], &[remote_tombstone(2, 3)], 3).unwrap();
    assert_eq!(remote_footprint(&database).1, before.1);
    assert_eq!(advances(&database), [(1, 2, 3)]);
    // The generation-1 checkpoint data is now older and refused.
    assert_eq!(
        install_generations(&mut database, &[], &[remote_tombstone(1, 2)], 3),
        Err(BusinessDatabaseError::InvalidInput)
    );
}

#[test]
fn rebootstrap_advances_a_settled_entity_to_a_later_live_generation() {
    // From a confirmed tombstone to a live later generation.
    let mut deleted = database_with_replicated_tombstone();
    install_generations(
        &mut deleted,
        &[RebootstrapAsset {
            asset: re_add_write("generation two"),
            entity_generation: 2,
        }],
        &[],
        3,
    )
    .unwrap();
    assert_eq!(remote_generation(&deleted), (2, false, None));
    assert_eq!(advances(&deleted), [(1, 2, 3)]);
    let detail = deleted.read_domain_detail("remote.test").unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("generation two"));
    assert_eq!(detail.asset.tags, ["fresh"]);

    // From a live, synced generation 1 straight to generation 3: nothing of generation 1
    // survives, and the fields are clean replicated values at the checkpoint revision.
    let mut live = database();
    own_create(&mut live);
    let echoes = acknowledge_claimed(&mut live, 1);
    pull_echoes(&mut live, 0, &echoes, "confirm-create").unwrap();
    install_generations(
        &mut live,
        &[RebootstrapAsset {
            asset: DomainAssetWrite {
                tags: vec![],
                ..re_add_write("generation three")
            },
            entity_generation: 3,
        }],
        &[],
        5,
    )
    .unwrap();
    assert_eq!(remote_generation(&live), (3, false, None));
    assert_eq!(advances(&live), [(1, 3, 5)]);
    let detail = live.read_domain_detail("remote.test").unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("generation three"));
    assert!(detail.asset.tags.is_empty());
    let unclean: i64 = live
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM domain_asset_field_versions
             WHERE entity_id='remote.test' AND (sync_state!='clean' OR server_revision!=5)",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unclean, 0);
}

#[test]
fn rebootstrap_waits_before_advancing_over_unsettled_local_work() {
    let later = |generation| RebootstrapAsset {
        asset: re_add_write("later"),
        entity_generation: generation,
    };
    // An unsynced edit of generation 1 (Cloud has since deleted that generation).
    let mut edited = database();
    own_create(&mut edited);
    let echoes = acknowledge_claimed(&mut edited, 1);
    pull_echoes(&mut edited, 0, &echoes, "confirm-create").unwrap();
    let version: i64 = edited
        .store
        .raw_connection()
        .query_row(
            "SELECT local_commit_sequence FROM domain_assets WHERE entity_id='remote.test'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let version = u64::try_from(version).unwrap();
    edited
        .edit_domain_asset(
            "edit-unsynced",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            &re_add_write("mine"),
            true,
        )
        .unwrap();
    // A provisional re-add whose generation the checkpoint has already passed.
    let mut provisional = database_with_replicated_tombstone();
    provisional
        .re_add_domain_asset(
            "re-add-provisional",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("provisional"),
        )
        .unwrap();
    for (mut database, assets, tombstones) in [
        (edited, vec![later(2)], vec![]),
        (provisional, vec![later(3)], vec![]),
    ] {
        let before = remote_footprint(&database);
        assert_eq!(
            install_generations(&mut database, &assets, &tombstones, 3),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(remote_footprint(&database), before);
        assert!(advances(&database).is_empty());
    }
    let mut provisional = database_with_replicated_tombstone();
    provisional
        .re_add_domain_asset(
            "re-add-provisional",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("provisional"),
        )
        .unwrap();
    let before = remote_footprint(&provisional);
    assert_eq!(
        install_generations(&mut provisional, &[], &[remote_tombstone(2, 3)], 3),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(remote_footprint(&provisional), before);
}

#[test]
fn rebootstrap_advances_over_the_field_marks_a_refused_edit_left() {
    // An edit of generation 1 that Cloud refused leaves its fields marked `pending` with
    // nothing queued. Nothing is owed, so the advance proceeds and retires the marks; the
    // refused Outbox row stays as evidence. No field of generation 1 reaches generation 2.
    let mut database = database();
    own_create(&mut database);
    let echoes = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &echoes, "confirm-create").unwrap();
    let version: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT local_commit_sequence FROM domain_assets WHERE entity_id='remote.test'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    database
        .edit_domain_asset(
            "edit-refused",
            u64::try_from(version).unwrap(),
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            &re_add_write("mine"),
            true,
        )
        .unwrap();
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-refuse",
            "2026-08-28T01:00:00Z",
            "2026-08-28T01:01:00Z",
            256,
        )
        .unwrap();
    assert_eq!(claimed.len(), 1);
    database
        .reject_sync_batch_v2(
            "owner-refuse",
            &claimed,
            SyncRejectionKind::MutationConflict,
        )
        .unwrap();
    let marks = |database: &TestDatabase| -> i64 {
        database
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM domain_asset_field_versions
                 WHERE entity_id='remote.test' AND sync_state='pending'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    };
    assert!(marks(&database) > 0);

    install_generations(
        &mut database,
        &[RebootstrapAsset {
            asset: re_add_write("later"),
            entity_generation: 2,
        }],
        &[],
        3,
    )
    .unwrap();
    assert_eq!(marks(&database), 0);
    assert_eq!(advances(&database).len(), 1);
    let detail = database.read_domain_detail("remote.test").unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("later"));
    let evidence: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state FROM sync_outbox WHERE mutation_id='edit-refused'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(evidence, "conflicted");
}

#[test]
fn a_generation_advances_only_through_its_recorded_settled_checkpoint_advance() {
    let database = database_with_replicated_tombstone();
    let connection = database.store.raw_connection();
    // No record: the generation cannot move, and the tombstone cannot be removed.
    assert!(
        connection
            .execute(
                "DELETE FROM sync_tombstones WHERE entity_id='remote.test'",
                []
            )
            .is_err()
    );
    // A record must leave the confirmed generation, and settled state only.
    for (from, to) in [(2, 3), (1, 1)] {
        assert!(
            connection
                .execute(
                    "INSERT INTO sync_domain_asset_checkpoint_advances
                     VALUES ('workspace-local','remote.test',?1,?2,3,1)",
                    params![from, to],
                )
                .is_err()
        );
    }
    connection
        .execute("UPDATE sync_tombstones SET barrier_state='contested'", [])
        .unwrap();
    assert!(
        connection
            .execute(
                "INSERT INTO sync_domain_asset_checkpoint_advances
                 VALUES ('workspace-local','remote.test',1,2,3,1)",
                [],
            )
            .unwrap_err()
            .to_string()
            .contains("requires settled local state")
    );
    connection
        .execute("UPDATE sync_tombstones SET barrier_state='replicated'", [])
        .unwrap();
    connection
        .execute(
            "INSERT INTO sync_domain_asset_checkpoint_advances
             VALUES ('workspace-local','remote.test',1,2,3,1)",
            [],
        )
        .unwrap();
    // The recorded advance names generation 2; no other generation is admitted, and the
    // record itself is immutable.
    connection
        .execute(
            "DELETE FROM sync_tombstones WHERE entity_id='remote.test'",
            [],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "UPDATE domain_assets SET entity_generation=3, deleted_at=NULL,
                 lifecycle_status='active' WHERE entity_id='remote.test'",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute("DELETE FROM sync_domain_asset_checkpoint_advances", [])
            .is_err()
    );
    connection
        .execute(
            "UPDATE domain_assets SET entity_generation=2, deleted_at=NULL,
             lifecycle_status='active' WHERE entity_id='remote.test'",
            [],
        )
        .unwrap();
}

#[test]
fn checkpoint_preserves_local_only_difference_and_marks_omitted_replica_stale() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("local-only.db");
    let key = LocalDatabaseKey::from_bytes([0x31; 32]);
    {
        let mut local_db = BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        local_db
            .upsert_domain_asset(
                "local",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "local.test".to_owned(),
                    note: Some("local".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        local_db
            .install_rebootstrap_checkpoint(
                &[DomainAssetWrite {
                    entity_id: "local.test".to_owned(),
                    note: Some("remote".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                }],
                1,
                "reader-local",
                |proof| Ok(journal_link(proof, 1)),
            )
            .unwrap();
    }

    let local_db = BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
    assert_eq!(
        local_db.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("local")
    );
    assert!(!local_db.read_sync_conflicts(10).unwrap().is_empty());
    let provenance: (String, i64, i64) = local_db
        .store
        .raw_connection()
        .query_row(
            "SELECT p.root_provenance,
                (SELECT count(*) FROM domain_asset_field_versions f
                 WHERE f.workspace_id=p.workspace_id AND f.entity_id=p.entity_id
                   AND f.provenance='local_only'),
                (SELECT count(*) FROM domain_asset_field_versions f
                 WHERE f.workspace_id=p.workspace_id AND f.entity_id=p.entity_id)
         FROM sync_asset_provenance p
         WHERE p.workspace_id='workspace-local' AND p.entity_id='local.test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(provenance, ("local_only".to_owned(), 4, 4));

    let mut replica = database();
    replica
        .install_rebootstrap_checkpoint(
            &[DomainAssetWrite {
                entity_id: "replica.test".to_owned(),
                note: Some("replica".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            }],
            1,
            "reader-local",
            |proof| Ok(journal_link(proof, 1)),
        )
        .unwrap();
    replica
        .install_rebootstrap_checkpoint(&[], 2, "reader-local", |proof| Ok(journal_link(proof, 2)))
        .unwrap();
    let freshness: (String, String) = replica.store.raw_connection().query_row(
        "SELECT p.freshness,f.freshness FROM sync_asset_provenance p JOIN domain_asset_field_versions f USING(workspace_id,entity_id) WHERE p.entity_id='replica.test' AND f.field_path='note'",
        [], |row| Ok((row.get(0)?,row.get(1)?)),
    ).unwrap();
    assert_eq!(freshness, ("stale".to_owned(), "stale".to_owned()));
    assert_eq!(replica.read_portfolio().unwrap().domains.len(), 1);
}

#[test]
fn checkpoint_rejects_missing_field_version_without_advancing_state() {
    let mut database = database();
    let initial = DomainAssetWrite {
        entity_id: "missing-field.test".to_owned(),
        note: Some("initial".to_owned()),
        portfolio_id: None,
        tags: vec![],
        target_price: None,
    };
    database
        .install_rebootstrap_checkpoint(
            std::slice::from_ref(&initial),
            1,
            "reader-local",
            |proof| Ok(journal_link(proof, 1)),
        )
        .unwrap();
    database
        .store
        .raw_connection()
        .execute(
            "DELETE FROM domain_asset_field_versions
             WHERE workspace_id=?1 AND entity_id=?2 AND field_path='note'",
            params!["workspace-local", initial.entity_id],
        )
        .unwrap();
    let before = database.recovery_proof().unwrap();

    let rejected = database.install_rebootstrap_checkpoint(
        &[DomainAssetWrite {
            note: Some("must-not-apply".to_owned()),
            ..initial.clone()
        }],
        2,
        "reader-local",
        |proof| Ok(journal_link(proof, 2)),
    );
    assert_eq!(rejected, Err(BusinessDatabaseError::StorageRejected));
    assert_eq!(database.recovery_proof().unwrap(), before);
    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("initial")
    );
}

#[test]
fn checkpoint_rejects_invalid_field_metadata_without_advancing_state() {
    for (entity_id, corruption) in [
        (
            "invalid-provenance.test",
            "UPDATE domain_asset_field_versions SET provenance='untrusted'
             WHERE workspace_id=?1 AND entity_id=?2 AND field_path='note'",
        ),
        (
            "invalid-state.test",
            "UPDATE domain_asset_field_versions SET sync_state='untrusted'
             WHERE workspace_id=?1 AND entity_id=?2 AND field_path='note'",
        ),
    ] {
        let mut database = database();
        let initial = DomainAssetWrite {
            entity_id: entity_id.to_owned(),
            note: Some("initial".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        };
        database
            .install_rebootstrap_checkpoint(
                std::slice::from_ref(&initial),
                1,
                "reader-local",
                |proof| Ok(journal_link(proof, 1)),
            )
            .unwrap();
        database
            .store
            .raw_connection()
            .execute_batch("PRAGMA ignore_check_constraints=ON;")
            .unwrap();
        database
            .store
            .raw_connection()
            .execute(corruption, params!["workspace-local", initial.entity_id])
            .unwrap();
        database
            .store
            .raw_connection()
            .execute_batch("PRAGMA ignore_check_constraints=OFF;")
            .unwrap();
        let before = database.recovery_proof().unwrap();

        let rejected = database.install_rebootstrap_checkpoint(
            &[DomainAssetWrite {
                note: Some("must-not-apply".to_owned()),
                ..initial.clone()
            }],
            2,
            "reader-local",
            |proof| Ok(journal_link(proof, 2)),
        );
        assert_eq!(rejected, Err(BusinessDatabaseError::StorageRejected));
        assert_eq!(database.recovery_proof().unwrap(), before);
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("initial")
        );
    }
}
