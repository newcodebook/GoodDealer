use super::*;

#[test]
fn business_write_and_sync_outbox_commit_atomically() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "mutation-1",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "domain-1.test".to_owned(),
                note: Some("local source of truth".to_owned()),
                portfolio_id: None,
                tags: vec!["primary".to_owned()],
                target_price: Some(Money {
                    currency: "USD".to_owned(),
                    amount: "1250".to_owned(),
                }),
            },
        )
        .unwrap();
    assert_eq!(database.read_portfolio().unwrap().domains.len(), 1);
    let pending = database.test_pending_sync_rows(10).unwrap();
    assert_eq!(pending.len(), 1);
    assert!(
        pending[0]
            .mutation_payload_json
            .contains("local source of truth")
    );
    let (local_sequence, field_count, authority_count): (i64, i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT
               (SELECT local_commit_sequence FROM active_workspace_metadata WHERE singleton = 1),
               (SELECT count(*) FROM domain_asset_field_versions
                WHERE workspace_id = 'workspace-local' AND entity_id = 'domain-1.test'
                  AND sync_state = 'pending' AND local_commit_sequence = 1),
               (SELECT count(*) FROM domain_assets
                WHERE workspace_id = 'workspace-local' AND entity_id = 'domain-1.test'
                  AND local_commit_sequence = 1)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!((local_sequence, field_count, authority_count), (1, 4, 1));
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one create story: commit, replay, duplicate, stale, tombstone and invalid input share state"
)]
fn creating_a_domain_commits_one_synced_upsert_and_refuses_duplicates() {
    let mut database = database();
    let write = |note: &str| DomainAssetWrite {
        entity_id: "added.test".to_owned(),
        note: Some(note.to_owned()),
        portfolio_id: None,
        tags: vec!["new".to_owned()],
        target_price: Some(Money {
            currency: "USD".to_owned(),
            amount: "2500".to_owned(),
        }),
    };
    let create = |database: &mut BusinessDatabase, mutation: &str, asset: &DomainAssetWrite| {
        database.create_domain_asset_guarded(
            mutation,
            "device-1",
            7,
            TIMESTAMP,
            asset,
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
    };
    let receipt = create(&mut database, "create-1", &write("first")).unwrap();
    assert_eq!(
        (receipt.disposition.as_str(), receipt.operation.as_str()),
        ("committed", "create")
    );
    let detail = database.read_domain_detail("added.test").unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("first"));
    assert_eq!(detail.asset.tags, ["new"]);
    let (kind, state, fields): (String, String, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT operation_kind, state, (SELECT count(*) FROM sync_outbox_fields f WHERE f.mutation_id = o.mutation_id)
             FROM sync_outbox o WHERE mutation_id = 'create-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        (kind.as_str(), state.as_str(), fields),
        ("upsert", "pending", 4)
    );

    // The same request replays; a different one for the same domain is a duplicate, whether it
    // comes from an import or by hand, and changes nothing.
    assert_eq!(
        create(&mut database, "create-1", &write("first"))
            .unwrap()
            .disposition,
        "replayed"
    );
    assert_eq!(
        create(&mut database, "create-2", &write("second")),
        Err(BusinessDatabaseError::AssetExists)
    );
    assert_eq!(
        database
            .read_domain_detail("added.test")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("first")
    );
    // A stale read generation is refused before anything is written.
    assert_eq!(
        database.create_domain_asset_guarded(
            "create-3",
            "device-1",
            7,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "other.test".to_owned(),
                ..write("x")
            },
            false,
            |_| Ok(()),
            |(), _| Ok(()),
        ),
        Err(BusinessDatabaseError::MutationStale)
    );
    // A deleted domain keeps its tombstone, so it cannot come back under the same identity yet.
    database
        .delete_domain_asset("delete-1", 1, "device-1", 7, TIMESTAMP, "added.test", true)
        .unwrap();
    assert_eq!(
        create(&mut database, "create-4", &write("again")),
        Err(BusinessDatabaseError::AssetReAddBlocked)
    );
    // An invalid domain, or an IP literal, never reaches storage.
    assert_eq!(
        create(
            &mut database,
            "create-6",
            &DomainAssetWrite {
                entity_id: "10.0.0.1".to_owned(),
                ..write("x")
            }
        ),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(
        create(
            &mut database,
            "create-5",
            &DomainAssetWrite {
                entity_id: "Not A Domain".to_owned(),
                ..write("x")
            }
        ),
        Err(BusinessDatabaseError::InvalidInput)
    );
    let outbox: i64 = database
        .store
        .raw_connection()
        .query_row("SELECT count(*) FROM sync_outbox", [], |row| row.get(0))
        .unwrap();
    assert_eq!(outbox, 2);
}

#[test]
fn empty_cloud_replica_is_no_op_and_never_deletes_local_rows() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "mutation-local",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "domain-local.test".to_owned(),
                note: Some("must survive empty cloud".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    database.merge_domain_asset_replica(vec![]).unwrap();
    let snapshot = database.read_portfolio().unwrap();
    assert_eq!(snapshot.domains.len(), 1);
    assert_eq!(
        snapshot.domains[0].note.as_deref(),
        Some("must survive empty cloud")
    );
}

#[test]
fn replica_merge_commits_locally_without_echoing_to_outbox() {
    let mut database = database();
    database
        .merge_domain_asset_replica(vec![DomainAssetReplicaMutation {
            server_revision: 1,
            asset: DomainAssetWrite {
                entity_id: "domain-remote.test".to_owned(),
                note: Some("validated replica".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        }])
        .unwrap();
    let snapshot = database.read_portfolio().unwrap();
    assert_eq!(snapshot.applied_through_server_revision, 1);
    assert_eq!(snapshot.domains[0].entity_id, "domain-remote.test");
    assert!(database.test_pending_sync_rows(10).unwrap().is_empty());
}

#[test]
fn replica_merge_rejects_revision_gaps_atomically() {
    let mut database = database();
    let mutation = |server_revision, entity_id: &str| DomainAssetReplicaMutation {
        server_revision,
        asset: DomainAssetWrite {
            entity_id: entity_id.to_owned(),
            note: None,
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        },
    };

    assert_eq!(
        database.merge_domain_asset_replica(vec![mutation(2, "gap.test")]),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(database.current_server_revision().unwrap(), 0);
    assert!(database.read_portfolio().unwrap().domains.is_empty());

    assert_eq!(
        database
            .merge_domain_asset_replica(
                vec![mutation(1, "first.test"), mutation(3, "third.test"),]
            ),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(database.current_server_revision().unwrap(), 0);
    assert!(database.read_portfolio().unwrap().domains.is_empty());

    database
        .merge_domain_asset_replica(vec![mutation(1, "first.test"), mutation(2, "second.test")])
        .unwrap();
    assert_eq!(database.current_server_revision().unwrap(), 2);
    assert_eq!(database.read_portfolio().unwrap().domains.len(), 2);
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "provenance and fail-closed value assertions stay together"
)]
fn history_never_guesses_a_previous_value_across_a_pull_or_a_conflict() {
    let mut database = database();
    database
        .upsert_domain_asset("seed", TIMESTAMP, &history_write("seed", &[]))
        .unwrap();
    let edit = |database: &mut BusinessDatabase, mutation_id: &str, note: &str| {
        let expected: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM domain_assets WHERE entity_id = 'ledger.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        database
            .edit_domain_asset(
                mutation_id,
                expected.try_into().unwrap(),
                "device-1",
                7,
                TIMESTAMP,
                &history_write(note, &[]),
                true,
            )
            .unwrap();
    };
    edit(&mut database, "edit-1", "first");
    // A remote revision applied between two local commits may have changed the asset.
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE active_workspace_metadata SET applied_through_server_revision = applied_through_server_revision + 5",
            [],
        )
        .unwrap();
    edit(&mut database, "edit-2", "first");
    let rows = database
        .read_history(0, 10, HISTORY_DAY)
        .unwrap()
        .window
        .rows;
    assert_eq!(
        rows[0].changes.len(),
        4,
        "unknown previous values keep every field"
    );
    assert!(
        rows[0]
            .changes
            .iter()
            .all(|change| change.previous_value.is_none())
    );
    // A conflicted local value never became the asset's state, so it is not a previous value.
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE sync_outbox SET state = 'conflicted' WHERE mutation_id = 'edit-2'",
            [],
        )
        .unwrap();
    edit(&mut database, "edit-3", "third");
    let rows = database
        .read_history(0, 10, HISTORY_DAY)
        .unwrap()
        .window
        .rows;
    assert!(
        rows[0]
            .changes
            .iter()
            .all(|change| change.previous_value.is_none())
    );
    // Recorded values are held to asset-write rules; anything else fails the read closed.
    for (path, json) in [
        ("targetPrice", "{\"amount\":1}"),
        ("note", "\"\\u0007\""),
        ("tags", "[\"b\",\"a\"]"),
    ] {
        let mut corrupt = self::database();
        corrupt
            .upsert_domain_asset("seed", TIMESTAMP, &history_write("seed", &[]))
            .unwrap();
        corrupt
            .store
            .fixture_connection()
            .execute(
                "UPDATE sync_outbox_fields SET field_value_json = ?1 WHERE field_path = ?2",
                rusqlite::params![json, path],
            )
            .unwrap();
        assert!(
            matches!(
                corrupt.read_history(0, 10, HISTORY_DAY),
                Err(BusinessDatabaseError::ProjectionRejected)
            ),
            "{path} {json} must fail closed"
        );
    }
    let mut long = self::database();
    long.upsert_domain_asset("seed", TIMESTAMP, &history_write("seed", &[]))
        .unwrap();
    long.store
        .fixture_connection()
        .execute(
            "UPDATE sync_outbox_fields SET field_value_json = ?1 WHERE field_path = 'note'",
            [serde_json::to_string(&"x".repeat(10_001)).unwrap()],
        )
        .unwrap();
    assert!(matches!(
        long.read_history(0, 10, HISTORY_DAY),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
}

#[test]
fn provider_binding_commit_replay_conflict_and_fence_are_atomic() {
    let mut database = binding_database();
    let before = database.provider_binding_snapshot_for_test();
    let sequence_before: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT local_commit_sequence FROM active_workspace_metadata",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        database.bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Err(
            BusinessDatabaseError::MutationStale
        )),
        Err(BusinessDatabaseError::MutationStale)
    );
    assert_eq!(database.provider_binding_snapshot_for_test(), before);
    let committed = database
        .bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(()))
        .unwrap();
    assert_eq!(committed.disposition, "committed");
    let after = database.provider_binding_snapshot_for_test();
    assert_eq!(after[0].len(), 1);
    assert_eq!(&after[2..], &before[2..]);
    let old_sequence: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT local_commit_sequence FROM domain_asset_provider_bindings",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(old_sequence, sequence_before + 1);
    assert_eq!(
        committed.local_commit_sequence,
        u64::try_from(old_sequence).unwrap()
    );
    let replay = database
        .bind_latest_cloudflare_zone("example.com", false, false, TIMESTAMP, || Ok(()))
        .unwrap();
    assert_eq!(replay.disposition, "replayed");
    assert_eq!(
        replay.local_commit_sequence,
        committed.local_commit_sequence
    );
    assert_eq!(database.provider_binding_snapshot_for_test(), after);
    // A matching observation does not excuse a changed immutable binding identity.
    database
        .store
        .fixture_connection()
        .execute_batch("DROP TRIGGER cloudflare_dns_staged_batch_immutable;")
        .unwrap();
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE cloudflare_dns_staged_batches SET zone_digest=?1",
            ["f".repeat(64)],
        )
        .unwrap();
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE cloudflare_credential_roots SET known_zone_digest=?1",
            ["f".repeat(64)],
        )
        .unwrap();
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE local_provider_connections SET active_credential_zone_digest=?1",
            ["f".repeat(64)],
        )
        .unwrap();
    let conflict_before = database.provider_binding_snapshot_for_test();
    assert_eq!(
        database.bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(())),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(
        database.provider_binding_snapshot_for_test(),
        conflict_before
    );
}

#[test]
fn drain_progress_waits_for_cloud_results_then_folds_them_as_cloud_recorded() {
    use super::super::drain_claims::{
        DrainMutationProgress, PersistedMutationResult, fold_persisted_mutation_results,
        submitted_mutation_drain_envelope,
    };
    let mut database = database();
    assert_eq!(
        database.read_drain_mutation_progress("device-1").unwrap(),
        DrainMutationProgress::Ready(super::super::drain_claims::DrainStreamClaim::empty())
    );
    for name in ["one", "two", "three"] {
        create_for_drain(&mut database, name);
    }
    assert_eq!(
        database.read_drain_mutation_progress("device-1").unwrap(),
        DrainMutationProgress::Waiting { unconfirmed: 3 }
    );
    let claimed = database
        .claim_sync_mutations_v2(
            "drain-owner",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
        )
        .unwrap();
    assert_eq!(claimed.len(), 3);
    database
        .acknowledge_sync_batch_v2_guarded(
            "drain-owner",
            &acknowledgements_for(&claimed[..2], 1),
            "2026-08-28T00:02:30Z",
            |_| Ok(()),
        )
        .unwrap();
    assert_eq!(
        database.read_drain_mutation_progress("device-1").unwrap(),
        DrainMutationProgress::Waiting { unconfirmed: 1 }
    );
    database
        .reject_sync_batch_v2(
            "drain-owner",
            &claimed[2..],
            SyncRejectionKind::MutationConflict,
        )
        .unwrap();
    let DrainMutationProgress::Ready(claim) =
        database.read_drain_mutation_progress("device-1").unwrap()
    else {
        panic!("a fully confirmed stream is ready");
    };
    // Independently: the bytes sent, stamped with the tenant workspace id, folded with the
    // outcomes Cloud returned (two ACKs, then one single-item conflict).
    let envelopes = claimed
        .iter()
        .map(|mutation| {
            let mut wire: serde_json::Value =
                serde_json::from_str(&mutation.wire_mutation_json).unwrap();
            wire["workspaceId"] = serde_json::json!("workspace-local");
            submitted_mutation_drain_envelope(&wire, 3).unwrap()
        })
        .collect::<Vec<_>>();
    let outcomes = [
        ("acknowledged", None),
        ("acknowledged", None),
        ("conflicted", Some("sync_mutation_conflict")),
    ];
    let rows = envelopes
        .iter()
        .zip(outcomes)
        .zip(1..)
        .map(
            |((envelope, (state, code)), sequence)| PersistedMutationResult {
                device_mutation_sequence: sequence,
                outbox_state: state,
                last_error_code: code,
                submitted_envelope: envelope,
            },
        )
        .collect::<Vec<_>>();
    assert_eq!(claim, fold_persisted_mutation_results(3, &rows).unwrap());
    assert_eq!(
        (claim.last_assigned_sequence, claim.pending_count()),
        (3, 0)
    );
    // A row naming another device is never folded into this device's proof.
    assert!(matches!(
        database.read_drain_mutation_progress("device-2"),
        Err(BusinessDatabaseError::StorageRejected)
    ));
}

#[test]
fn drain_progress_blocks_on_results_cloud_never_records_or_a_missing_row() {
    use super::super::drain_claims::DrainMutationProgress;
    for kind in [
        SyncRejectionKind::Deterministic,
        SyncRejectionKind::IdempotencyConflict,
    ] {
        let mut database = database();
        create_for_drain(&mut database, "one");
        create_for_drain(&mut database, "two");
        let claimed = database
            .claim_sync_mutations_v2(
                "drain-owner",
                "2026-08-28T00:02:00Z",
                "2026-08-28T00:03:00Z",
                256,
            )
            .unwrap();
        database
            .acknowledge_sync_batch_v2_guarded(
                "drain-owner",
                &acknowledgements_for(&claimed[1..], 1),
                "2026-08-28T00:02:30Z",
                |_| Ok(()),
            )
            .unwrap();
        database
            .reject_sync_batch_v2("drain-owner", &claimed[..1], kind)
            .unwrap();
        assert_eq!(
            database.read_drain_mutation_progress("device-1").unwrap(),
            DrainMutationProgress::Blocked
        );
    }
    let mut database = database();
    create_for_drain(&mut database, "one");
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE active_workspace_metadata SET next_device_mutation_sequence = next_device_mutation_sequence + 1",
            [],
        )
        .unwrap();
    assert_eq!(
        database.read_drain_mutation_progress("device-1").unwrap(),
        DrainMutationProgress::Blocked
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the candidate, refusal, record and fold steps of one receipt check stay together"
)]
fn drain_records_cloud_wire_versions_for_version_2_rows_before_folding() {
    use super::super::drain_claims::{
        CloudMutationReceipt, DrainMutationProgress, PersistedMutationResult,
        fold_persisted_mutation_results, submitted_mutation_drain_envelope,
    };
    let mut database = database();
    create_for_drain(&mut database, "one");
    create_for_drain(&mut database, "two");
    let mut claimed = database
        .claim_sync_mutations_v2(
            "drain-owner",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
        )
        .unwrap();
    // Reproduce rows claimed before ADR-0029 C1c2b: only a test can rewrite a claimed identity.
    let connection = database.store.raw_connection();
    connection
        .execute_batch("DROP TRIGGER sync_outbox_v2_wire_identity_immutable")
        .unwrap();
    let claimed_v3_digests = claimed
        .iter()
        .map(|mutation| mutation.wire_mutation_digest.clone())
        .collect::<Vec<_>>();
    for mutation in &mut claimed {
        let wire: serde_json::Value = serde_json::from_str(&mutation.wire_mutation_json).unwrap();
        mutation.wire_mutation_digest = local_wire_digest(&wire, 2).unwrap();
        connection
            .execute(
                "UPDATE sync_outbox SET wire_schema_version=2, wire_mutation_digest=?1
                 WHERE mutation_id=?2",
                rusqlite::params![mutation.wire_mutation_digest, mutation.mutation_id],
            )
            .unwrap();
    }
    database
        .acknowledge_sync_batch_v2_guarded(
            "drain-owner",
            &acknowledgements_for(&claimed[..1], 1),
            "2026-08-28T00:02:30Z",
            |_| Ok(()),
        )
        .unwrap();
    database
        .reject_sync_batch_v2(
            "drain-owner",
            &claimed[1..],
            SyncRejectionKind::MutationConflict,
        )
        .unwrap();
    assert_eq!(
        database.read_drain_mutation_progress("device-1").unwrap(),
        DrainMutationProgress::ReceiptsRequired {
            mutation_ids: vec!["create-one".to_owned(), "create-two".to_owned()]
        }
    );

    // Independently: each row's chain envelope (tenant-stamped) under each wire version.
    let digest = |envelope: &[u8]| {
        use base64::Engine as _;
        use sha2::Digest as _;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(envelope))
    };
    let envelopes = claimed
        .iter()
        .map(|mutation| {
            let mut wire: serde_json::Value =
                serde_json::from_str(&mutation.wire_mutation_json).unwrap();
            wire["workspaceId"] = serde_json::json!("workspace-local");
            [
                submitted_mutation_drain_envelope(&wire, 2).unwrap(),
                submitted_mutation_drain_envelope(&wire, 3).unwrap(),
            ]
        })
        .collect::<Vec<_>>();
    // The receipt candidates are the wire digests the claim path itself recorded: the v2 digest
    // the rows now hold, and the v3 digest they were first claimed with. Neither is the chain
    // envelope digest.
    let candidates = database.drain_receipt_candidates("device-1").unwrap();
    assert_eq!(candidates.len(), 2);
    for ((candidate, mutation), v3_digest) in
        candidates.iter().zip(&claimed).zip(&claimed_v3_digests)
    {
        assert_eq!(
            candidate.candidate_digests,
            [mutation.wire_mutation_digest.clone(), v3_digest.clone()]
        );
        assert_eq!(
            (candidate.active_lease_epoch, candidate.accepted),
            (7, candidate.mutation_id == "create-one")
        );
    }
    // Cloud recorded row one as v3 and row two (a single-item conflict) as v2.
    let receipts = [
        CloudMutationReceipt {
            mutation_id: "create-one".to_owned(),
            active_lease_epoch: 7,
            device_mutation_sequence: 1,
            wire_schema_version: 3,
            wire_mutation_digest: candidates[0].candidate_digests[1].clone(),
            accepted: true,
        },
        CloudMutationReceipt {
            mutation_id: "create-two".to_owned(),
            active_lease_epoch: 7,
            device_mutation_sequence: 2,
            wire_schema_version: 2,
            wire_mutation_digest: candidates[1].candidate_digests[0].clone(),
            accepted: false,
        },
    ];

    // A receipt that disagrees with this device in any way records nothing.
    let disagreements = [
        // The v2 digest reported as v3, and the chain envelope digest in place of the wire digest.
        CloudMutationReceipt {
            wire_mutation_digest: candidates[0].candidate_digests[0].clone(),
            ..receipts[0].clone()
        },
        CloudMutationReceipt {
            wire_mutation_digest: digest(&envelopes[0][1]),
            ..receipts[0].clone()
        },
        CloudMutationReceipt {
            accepted: false,
            ..receipts[0].clone()
        },
        CloudMutationReceipt {
            device_mutation_sequence: 2,
            ..receipts[0].clone()
        },
        CloudMutationReceipt {
            active_lease_epoch: 8,
            ..receipts[0].clone()
        },
        CloudMutationReceipt {
            mutation_id: "create-unknown".to_owned(),
            ..receipts[0].clone()
        },
    ];
    for disagreement in disagreements {
        assert_eq!(
            database.record_cloud_wire_versions(
                "device-1",
                &[receipts[1].clone(), disagreement],
                "2026-08-28T00:04:00Z",
                || Ok(())
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
    }
    assert_eq!(
        database.record_cloud_wire_versions(
            "device-1",
            &[receipts[0].clone(), receipts[0].clone()],
            "2026-08-28T00:04:00Z",
            || Ok(())
        ),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(
        database.record_cloud_wire_versions(
            "device-1",
            &[CloudMutationReceipt {
                wire_schema_version: 4,
                ..receipts[0].clone()
            }],
            "2026-08-28T00:04:00Z",
            || Ok(())
        ),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(
        database.drain_receipt_candidates("device-1").unwrap().len(),
        2
    );

    database
        .record_cloud_wire_versions(
            "device-1",
            &receipts[..1],
            "2026-08-28T00:04:00Z",
            || Ok(()),
        )
        .unwrap();
    assert_eq!(
        database.read_drain_mutation_progress("device-1").unwrap(),
        DrainMutationProgress::ReceiptsRequired {
            mutation_ids: vec!["create-two".to_owned()]
        }
    );
    // A recorded row is no longer a candidate, so a second receipt for it is refused.
    assert_eq!(
        database
            .record_cloud_wire_versions("device-1", &receipts, "2026-08-28T00:04:30Z", || Ok(())),
        Err(BusinessDatabaseError::MutationConflict)
    );
    database
        .record_cloud_wire_versions(
            "device-1",
            &receipts[1..],
            "2026-08-28T00:05:00Z",
            || Ok(()),
        )
        .unwrap();
    let DrainMutationProgress::Ready(claim) =
        database.read_drain_mutation_progress("device-1").unwrap()
    else {
        panic!("every version is known");
    };
    let rows = [
        PersistedMutationResult {
            device_mutation_sequence: 1,
            outbox_state: "acknowledged",
            last_error_code: None,
            submitted_envelope: &envelopes[0][1],
        },
        PersistedMutationResult {
            device_mutation_sequence: 2,
            outbox_state: "conflicted",
            last_error_code: Some("sync_mutation_conflict"),
            submitted_envelope: &envelopes[1][0],
        },
    ];
    assert_eq!(claim, fold_persisted_mutation_results(2, &rows).unwrap());

    // The record is immutable and only names a resulted version-2 row.
    let connection = database.store.raw_connection();
    assert!(
        connection
            .execute(
                "UPDATE sync_outbox_cloud_wire_versions SET wire_schema_version = 2",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute("DELETE FROM sync_outbox_cloud_wire_versions", [])
            .is_err()
    );
    create_for_drain(&mut database, "three");
    assert!(
        database
            .store
            .raw_connection()
            .execute(
                "INSERT INTO sync_outbox_cloud_wire_versions VALUES
                 ('workspace-local','create-three',3,?1,'2026-08-28T00:06:00Z')",
                [digest(b"x")],
            )
            .is_err()
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the barrier's open, refuse, admit-results, clear and left-over steps stay together"
)]
fn device_handoff_barrier_closes_local_writes_but_not_cloud_results() {
    use super::super::drain_claims::DrainMutationProgress;
    let mut database = database();
    create_for_drain(&mut database, "one");
    let claimed = database
        .claim_sync_mutations_v2(
            "drain-owner",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
        )
        .unwrap();
    assert_eq!(database.device_handoff_barrier().unwrap(), None);
    database
        .begin_device_handoff_barrier("switch-1", 7, "2026-08-28T00:02:10Z", || Ok(()))
        .unwrap();
    // Idempotent for the same switch and epoch; another switch or epoch must wait for a clear.
    database
        .begin_device_handoff_barrier("switch-1", 7, "2026-08-28T00:02:11Z", || Ok(()))
        .unwrap();
    for (switch, epoch) in [("switch-2", 7), ("switch-1", 8)] {
        assert!(matches!(
            database.begin_device_handoff_barrier(switch, epoch, "2026-08-28T00:02:12Z", || Ok(())),
            Err(BusinessDatabaseError::MutationConflict)
        ));
    }
    assert!(matches!(
        database.begin_device_handoff_barrier("switch-1", 0, "2026-08-28T00:02:12Z", || Ok(())),
        Err(BusinessDatabaseError::InvalidInput)
    ));
    assert!(matches!(
        database.clear_device_handoff_barrier("switch-2", || Ok(())),
        Err(BusinessDatabaseError::MutationConflict)
    ));
    assert_eq!(
        database.device_handoff_barrier().unwrap(),
        Some(super::super::drain_claims::DeviceHandoffBarrier {
            device_switch_request_id: "switch-1".to_owned(),
            active_lease_epoch: Some(7),
        })
    );
    // Under the epoch it drains, the barrier is a drain in progress and is never cleared as
    // left over.
    assert!(
        !database
            .clear_left_over_device_handoff_barrier(7, || Ok(()))
            .unwrap()
    );

    // Every local writer is closed at the database: the guarded create path, a raw sequence
    // allocation, and a raw Outbox insert all fail, and the failed create leaves nothing.
    let write = DomainAssetWrite {
        entity_id: "blocked.test".to_owned(),
        note: None,
        portfolio_id: None,
        tags: Vec::new(),
        target_price: None,
    };
    assert!(
        database
            .create_domain_asset_guarded(
                "create-blocked",
                "device-1",
                7,
                TIMESTAMP,
                &write,
                true,
                |_| Ok(()),
                |(), _| Ok(()),
            )
            .is_err()
    );
    let connection = database.store.fixture_connection();
    let blocked_rows: i64 = connection
        .query_row(
            "SELECT (SELECT count(*) FROM domain_assets WHERE entity_id = 'blocked.test')
                  + (SELECT count(*) FROM sync_outbox WHERE mutation_id = 'create-blocked')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(blocked_rows, 0);
    assert!(
        connection
            .execute(
                "UPDATE active_workspace_metadata
                 SET next_device_mutation_sequence = next_device_mutation_sequence + 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE device_handoff_barriers SET device_switch_request_id = 'switch-2'",
                [],
            )
            .is_err()
    );

    // Cloud results still land while closed, so the drain can finish.
    database
        .acknowledge_sync_batch_v2_guarded(
            "drain-owner",
            &acknowledgements_for(&claimed, 1),
            "2026-08-28T00:02:30Z",
            |_| Ok(()),
        )
        .unwrap();
    assert!(matches!(
        database.read_drain_mutation_progress("device-1").unwrap(),
        DrainMutationProgress::Ready(_)
    ));

    database
        .clear_device_handoff_barrier("switch-1", || Ok(()))
        .unwrap();
    database
        .clear_device_handoff_barrier("switch-1", || Ok(()))
        .unwrap();
    assert_eq!(database.device_handoff_barrier().unwrap(), None);
    create_for_drain(&mut database, "two");
    // A barrier from an epoch this device no longer holds (or with no epoch) is left over.
    database
        .begin_device_handoff_barrier("switch-3", 7, "2026-08-28T00:07:00Z", || Ok(()))
        .unwrap();
    assert!(
        database
            .clear_left_over_device_handoff_barrier(8, || Ok(()))
            .unwrap()
    );
    assert_eq!(database.device_handoff_barrier().unwrap(), None);
    database
        .store
        .raw_connection()
        .execute(
            "INSERT INTO device_handoff_barriers (workspace_id, device_switch_request_id, began_at)
             VALUES ('workspace-local', 'switch-4', '2026-08-28T00:08:00Z')",
            [],
        )
        .unwrap();
    assert!(
        database
            .clear_left_over_device_handoff_barrier(1, || Ok(()))
            .unwrap()
    );
    assert!(
        !database
            .clear_left_over_device_handoff_barrier(1, || Ok(()))
            .unwrap()
    );
    create_for_drain(&mut database, "three");
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the complete claim, retry, terminal, and immutability lifecycle stays visible"
)]
fn sync_v2_claim_persists_canonical_digest_and_reclaims_by_new_owner() {
    let mut database = database();
    let initial = DomainAssetWrite {
        entity_id: "claim.test".to_owned(),
        note: None,
        portfolio_id: None,
        tags: vec!["initial".to_owned()],
        target_price: None,
    };
    database
        .upsert_domain_asset("seed-claim", TIMESTAMP, &initial)
        .unwrap();
    database
        .acknowledge_sync_mutation("seed-claim", 1, "2026-08-28T00:00:01Z")
        .unwrap();
    let version = database
        .read_domain_detail("claim.test")
        .unwrap()
        .asset
        .asset_version;
    let edited = DomainAssetWrite {
        note: Some("canonical note".to_owned()),
        tags: vec!["canonical".to_owned()],
        ..initial
    };
    database
        .edit_domain_asset(
            "claim-v2",
            version,
            "device-local",
            7,
            "2026-08-28T00:01:00Z",
            &edited,
            true,
        )
        .unwrap();

    let first = database
        .claim_sync_mutations_v2(
            "owner-generation-1",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
        )
        .unwrap();
    assert_eq!(first.len(), 1);
    // ADR-0029 C1c2b: a new claim records the v3 digest of the bytes it sends, no longer the
    // v2 encoding (`Aqu72459…`) recorded before the local tables were rebuilt.
    assert_eq!(
        first[0].wire_mutation_digest,
        canonical_sync_digest(&serde_json::from_str(&first[0].wire_mutation_json).unwrap())
            .unwrap()
    );
    assert_eq!(
        first[0].wire_mutation_digest,
        "X7Z9n10QiKyCcoj-5Y9FH9ftWmUntlIEpVRQfq7EWKs"
    );
    assert!(first[0].wire_mutation_json.contains("\"schemaVersion\":3"));
    assert!(
        first[0]
            .wire_mutation_json
            .contains("\"entityGeneration\":1")
    );
    assert!(
        first[0]
            .wire_mutation_json
            .contains("\"operationKind\":\"upsert\"")
    );
    assert!(!first[0].wire_mutation_json.contains("workspaceId"));
    let local_digest: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT mutation_payload_sha256 FROM sync_outbox WHERE mutation_id='claim-v2'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(first[0].wire_mutation_digest, local_digest);

    assert_eq!(
        database.defer_retryable_sync_batch_v2(
            "owner-generation-1",
            &[first[0].clone(), first[0].clone()],
            "2026-08-28T00:02:00Z",
        ),
        Err(BusinessDatabaseError::MutationConflict)
    );
    let state_after_rollback: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state FROM sync_outbox WHERE mutation_id='claim-v2'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(state_after_rollback, "sending");

    database
        .defer_retryable_sync_batch_v2("owner-generation-1", &first, "2026-08-28T00:02:00Z")
        .unwrap();
    let deferred: (String, String, String) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state,next_attempt_at,last_error_code
             FROM sync_outbox WHERE mutation_id='claim-v2'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        deferred,
        (
            "pending".to_owned(),
            "2026-08-28T00:02:02Z".to_owned(),
            "transport_retryable".to_owned()
        )
    );
    assert!(
        database
            .claim_sync_mutations_v2(
                "owner-generation-2",
                "2026-08-28T00:02:01Z",
                "2026-08-28T00:03:01Z",
                256,
            )
            .unwrap()
            .is_empty()
    );

    let second = database
        .claim_sync_mutations_v2(
            "owner-generation-2",
            "2026-08-28T00:04:00Z",
            "2026-08-28T00:05:00Z",
            256,
        )
        .unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(
        second[0].wire_mutation_digest,
        first[0].wire_mutation_digest
    );
    assert!(second[0].delivery_attempt_fence > first[0].delivery_attempt_fence);

    database
        .reject_sync_batch_v2(
            "owner-generation-2",
            &second,
            SyncRejectionKind::IdempotencyConflict,
        )
        .unwrap();
    let terminal: (String, String, Option<String>) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state,last_error_code,delivery_owner
             FROM sync_outbox WHERE mutation_id='claim-v2'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        terminal,
        (
            "conflicted".to_owned(),
            "sync_idempotency_conflict".to_owned(),
            None
        )
    );

    assert!(
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE sync_outbox_fields SET field_value_json='\"tampered\"'
         WHERE workspace_id='workspace-local' AND mutation_id='claim-v2' AND field_path='note'",
                [],
            )
            .is_err()
    );
}

#[test]
fn sync_v2_claim_stops_at_the_exact_request_byte_prefix() {
    let mut database = database();
    let asset = DomainAssetWrite {
        entity_id: "bounded-prefix.test".to_owned(),
        note: None,
        portfolio_id: None,
        tags: vec![],
        target_price: None,
    };
    database
        .upsert_domain_asset("bounded-prefix-seed", TIMESTAMP, &asset)
        .unwrap();
    database
        .acknowledge_sync_mutation("bounded-prefix-seed", 1, "2026-08-28T00:00:01Z")
        .unwrap();
    for index in 0..110_u64 {
        let version = database
            .read_domain_detail("bounded-prefix.test")
            .unwrap()
            .asset
            .asset_version;
        database
            .edit_domain_asset(
                &format!("bounded-prefix-{index:03}"),
                version,
                "device-local",
                7,
                "2026-08-28T00:01:00Z",
                &DomainAssetWrite {
                    note: Some(format!("{index:03}{}", "x".repeat(9_997))),
                    ..asset.clone()
                },
                true,
            )
            .unwrap();
    }

    let first = database
        .claim_sync_mutations_v2(
            "bounded-owner-1",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
        )
        .unwrap();
    assert!(!first.is_empty());
    assert!(first.len() < 110);
    let first_wire = first
        .iter()
        .map(|mutation| mutation.wire_mutation_json.clone())
        .collect::<Vec<_>>();
    assert!(serialize_sync_push_request(&first_wire).unwrap().len() <= MAX_SYNC_PUSH_REQUEST_BYTES);
    assert!(
        serialize_sync_push_request(
            &[first_wire.clone(), vec![first_wire.last().unwrap().clone()],].concat()
        )
        .is_err()
    );
    let first_last_sequence = first.last().unwrap().device_mutation_sequence;
    assert!(
        first
            .windows(2)
            .all(|pair| pair[1].device_mutation_sequence == pair[0].device_mutation_sequence + 1)
    );
    database
        .reject_sync_batch_v2("bounded-owner-1", &first, SyncRejectionKind::Deterministic)
        .unwrap();

    let second = database
        .claim_sync_mutations_v2(
            "bounded-owner-2",
            "2026-08-28T00:04:00Z",
            "2026-08-28T00:05:00Z",
            256,
        )
        .unwrap();
    assert_eq!(first.len() + second.len(), 110);
    assert_eq!(
        second.first().unwrap().device_mutation_sequence,
        first_last_sequence + 1
    );
    assert!(
        second
            .iter()
            .all(|mutation| mutation.delivery_attempt_fence == 1)
    );
}

#[test]
#[allow(clippy::too_many_lines)]
fn sync_delivery_commit_guards_roll_back_every_durable_stage() {
    let mut database = database();
    let initial = DomainAssetWrite {
        entity_id: "guarded-delivery.test".to_owned(),
        note: None,
        portfolio_id: None,
        tags: vec!["initial".to_owned()],
        target_price: None,
    };
    database
        .upsert_domain_asset("guard-seed", TIMESTAMP, &initial)
        .unwrap();
    database
        .acknowledge_sync_mutation("guard-seed", 1, "2026-08-28T00:00:01Z")
        .unwrap();
    let version = database
        .read_domain_detail("guarded-delivery.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .edit_domain_asset(
            "guarded-delivery",
            version,
            "device-local",
            7,
            "2026-08-28T00:01:00Z",
            &DomainAssetWrite {
                note: Some("guarded".to_owned()),
                ..initial
            },
            true,
        )
        .unwrap();

    assert_eq!(
        database.claim_sync_mutations_v2_guarded(
            "guard-owner",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
            || Err(BusinessDatabaseError::MutationStale),
        ),
        Err(BusinessDatabaseError::MutationStale)
    );
    assert_eq!(
        database
            .test_sync_delivery_state("guarded-delivery")
            .unwrap(),
        ("pending".to_owned(), 0, None, None)
    );

    let claimed = database
        .claim_sync_mutations_v2_guarded(
            "guard-owner",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
            || Ok(()),
        )
        .unwrap();
    let acknowledgement = SyncMutationAcknowledgement {
        mutation_id: claimed[0].mutation_id.clone(),
        source_device_id: claimed[0].source_device_id.clone(),
        active_lease_epoch: claimed[0].active_lease_epoch,
        device_mutation_sequence: claimed[0].device_mutation_sequence,
        delivery_attempt_fence: claimed[0].delivery_attempt_fence,
        wire_mutation_digest: claimed[0].wire_mutation_digest.clone(),
        server_revision: 2,
    };
    assert_eq!(
        database.acknowledge_sync_batch_v2_guarded(
            "guard-owner",
            std::slice::from_ref(&acknowledgement),
            "2026-08-28T00:02:01Z",
            |_| Err(BusinessDatabaseError::MutationStale),
        ),
        Err(BusinessDatabaseError::MutationStale)
    );
    assert_eq!(
        database.defer_retryable_sync_batch_v2_guarded(
            "guard-owner",
            &claimed,
            "2026-08-28T00:02:01Z",
            || Err(BusinessDatabaseError::MutationStale),
        ),
        Err(BusinessDatabaseError::MutationStale)
    );
    assert_eq!(
        database.reject_sync_batch_v2_guarded(
            "guard-owner",
            &claimed,
            SyncRejectionKind::Deterministic,
            |_| Err(BusinessDatabaseError::MutationStale),
        ),
        Err(BusinessDatabaseError::MutationStale)
    );
    assert_eq!(
        database
            .test_sync_delivery_state("guarded-delivery")
            .unwrap(),
        (
            "sending".to_owned(),
            1,
            Some("guard-owner".to_owned()),
            Some(1),
        )
    );

    assert_eq!(
        database.mark_sync_rebootstrap_required_v2_guarded("device-local", |_| {
            Err(BusinessDatabaseError::MutationStale)
        }),
        Err(BusinessDatabaseError::MutationStale)
    );
    assert!(
        database
            .read_sync_pull_request_v2("device-local", 64)
            .is_ok()
    );
}

#[test]
fn canonical_sync_v2_digest_ignores_object_key_order_and_json_whitespace() {
    let left: serde_json::Value =
        serde_json::from_str(r#"{"schemaVersion":2,"mutationId":"m","operationKind":"upsert"}"#)
            .unwrap();
    let right: serde_json::Value = serde_json::from_str(
        " { \"operationKind\" : \"upsert\", \"mutationId\" : \"m\", \"schemaVersion\" : 2 } ",
    )
    .unwrap();
    assert_eq!(
        canonical_sync_digest(&left).unwrap(),
        canonical_sync_digest(&right).unwrap()
    );
}

#[test]
fn sync_v2_page_apply_is_atomic_and_exactly_replayable() {
    let mut database = database();
    let page = test_sync_page(1, "remote value");
    database
        .apply_sync_page_v2("reader-local", &page, "confirm-1")
        .unwrap();
    assert_eq!(database.current_server_revision().unwrap(), 1);
    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("remote value")
    );
    let inbox_count: i64 = database
        .store
        .raw_connection()
        .query_row("SELECT count(*) FROM sync_inbox", [], |row| row.get(0))
        .unwrap();
    assert_eq!(inbox_count, 1);
    database
        .apply_sync_page_v2("reader-local", &page, "confirm-1")
        .unwrap();
    let tampered = page.replacen("remote value", "tampered", 1);
    assert_eq!(
        database.apply_sync_page_v2("reader-local", &tampered, "confirm-1"),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(database.current_server_revision().unwrap(), 1);
}

#[test]
fn sync_v3_persists_conflict_before_cursor_and_keeps_local_value() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "local-pending",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("local".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let page = test_sync_page(1, "remote");
    database
        .apply_sync_page_v2("reader-local", &page, "confirm")
        .unwrap();
    let candidates = database.read_sync_conflicts(10).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].field_path, "note");
    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("local")
    );
    assert_eq!(database.current_server_revision().unwrap(), 1);
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one scenario follows a conflicting row from rejection through the next Pull"
)]
fn mutation_conflict_ends_one_mutation_and_the_next_pull_still_opens_a_conflict() {
    let mut database = database();
    let seed = |entity_id: &str| DomainAssetWrite {
        entity_id: entity_id.to_owned(),
        note: None,
        portfolio_id: None,
        tags: vec![],
        target_price: None,
    };
    for (revision, mutation_id, entity_id) in [
        (1, "seed-remote", "remote.test"),
        (2, "seed-other", "other.test"),
    ] {
        database
            .upsert_domain_asset(mutation_id, TIMESTAMP, &seed(entity_id))
            .unwrap();
        database
            .acknowledge_sync_mutation(mutation_id, revision, "2026-08-28T00:00:01Z")
            .unwrap();
    }
    for (mutation_id, entity_id, note) in [
        ("conflicting-edit", "remote.test", "local"),
        ("later-edit", "other.test", "later"),
    ] {
        let version = database
            .read_domain_detail(entity_id)
            .unwrap()
            .asset
            .asset_version;
        database
            .edit_domain_asset(
                mutation_id,
                version,
                "device-local",
                1,
                TIMESTAMP,
                &DomainAssetWrite {
                    note: Some(note.to_owned()),
                    ..seed(entity_id)
                },
                true,
            )
            .unwrap();
    }
    let head = database
        .claim_sync_mutations_v2(
            "conflict-owner-1",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            1,
        )
        .unwrap();
    assert_eq!(head.len(), 1);
    assert_eq!(head[0].mutation_id, "conflicting-edit");
    database
        .reject_sync_batch_v2(
            "conflict-owner-1",
            &head,
            SyncRejectionKind::MutationConflict,
        )
        .unwrap();

    // The row and its frozen wire remain as evidence; only its delivery ends.
    let (state, code): (String, String) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state,last_error_code FROM sync_outbox WHERE mutation_id='conflicting-edit'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        (state.as_str(), code.as_str()),
        ("conflicted", "sync_mutation_conflict")
    );
    let field_state: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT sync_state FROM domain_asset_field_versions
             WHERE entity_id='remote.test' AND field_path='note'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(field_state, "pending");

    // The rejected row no longer holds the Outbox head.
    let next = database
        .claim_sync_mutations_v2(
            "conflict-owner-2",
            "2026-08-28T00:04:00Z",
            "2026-08-28T00:05:00Z",
            256,
        )
        .unwrap();
    assert_eq!(next[0].mutation_id, "later-edit");
    assert_eq!(
        next[0].device_mutation_sequence,
        head[0].device_mutation_sequence + 1
    );

    // The other writer's value arrives by Pull and becomes a candidate, not an overwrite.
    let revision = database.current_server_revision().unwrap() + 1;
    database
        .apply_sync_page_v2(
            "reader-local",
            &test_sync_page(revision, "remote"),
            "confirm",
        )
        .unwrap();
    let candidates = database.read_sync_conflicts(10).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].field_path, "note");
    assert_eq!(
        database
            .read_domain_detail("remote.test")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("local")
    );
}

#[test]
fn sync_v3_remote_delete_conflict_is_contested_and_keep_local_is_rejected() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "local-pending-delete",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("local".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let mut page = serde_json::json!({
        "schemaVersion":3,"workspaceId":"workspace-local","fromServerRevisionExclusive":0,
        "throughServerRevisionInclusive":1,"mutations":[{"schemaVersion":3,"mutationId":"remote-delete",
        "workspaceId":"workspace-local","workspaceSchemaVersion":1,"entityType":"domain_asset",
        "entityId":"remote.test","entityGeneration":1,"operationKind":"delete","deletedAt":"2026-08-28T00:00:00Z",
        "baseServerRevision":0,"changedFields":[],"sourceDeviceId":"cloud-device","activeLeaseEpoch":1,
        "deviceMutationSequence":1,"serverRevision":1}],"returnedThroughServerRevision":1,"nextCursor":null,
        "pageDigest":"A".repeat(43)
    });
    page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());
    database
        .apply_sync_page_v2("reader-local", &page.to_string(), "confirm")
        .unwrap();
    let candidates = database.read_sync_conflicts(10).unwrap();
    assert_eq!(candidates[0].field_path, "lifecycleStatus");
    let barrier: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT barrier_state FROM sync_tombstones WHERE entity_id='remote.test'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(barrier, "contested");
    assert_eq!(
        database.resolve_sync_conflict(
            "r1",
            &candidates[0].conflict_id,
            1,
            1,
            1,
            &candidates[0].local_value_hash,
            "keep_local",
            "device-local",
            1,
            TIMESTAMP
        ),
        Err(BusinessDatabaseError::MutationConflict)
    );
}

#[test]
fn sync_v3_accept_remote_is_local_only_and_exactly_replayable() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "local-pending-accept",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("local".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let page = test_sync_page(1, "remote");
    database
        .apply_sync_page_v2("reader-local", &page, "confirm")
        .unwrap();
    let candidate = database.read_sync_conflicts(10).unwrap().remove(0);
    let before_outbox: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM sync_outbox WHERE workspace_id='workspace-local'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let receipt = database
        .resolve_sync_conflict(
            "resolution-accept",
            &candidate.conflict_id,
            1,
            candidate.candidate_version,
            candidate.remote_server_revision,
            &candidate.local_value_hash,
            "accept_remote",
            "device-local",
            1,
            TIMESTAMP,
        )
        .unwrap();
    assert_eq!(receipt.outbox_mutation_id, None);
    let after_outbox: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM sync_outbox WHERE workspace_id='workspace-local'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before_outbox, after_outbox);
    let replay = database
        .resolve_sync_conflict(
            "resolution-accept",
            &candidate.conflict_id,
            1,
            candidate.candidate_version,
            candidate.remote_server_revision,
            &candidate.local_value_hash,
            "accept_remote",
            "device-local",
            1,
            TIMESTAMP,
        )
        .unwrap();
    assert_eq!(replay, receipt);
}

#[test]
fn sync_v2_page_apply_rejects_gaps_without_partial_inbox_or_projection() {
    let mut database = database();
    let gap = test_sync_page(2, "gap");
    assert_eq!(
        database.apply_sync_page_v2("reader-local", &gap, "confirm-gap"),
        Err(BusinessDatabaseError::RevisionRejected)
    );
    assert_eq!(database.current_server_revision().unwrap(), 0);
    assert!(database.read_portfolio().unwrap().domains.is_empty());
    let inbox_count: i64 = database
        .store
        .raw_connection()
        .query_row("SELECT count(*) FROM sync_inbox", [], |row| row.get(0))
        .unwrap();
    assert_eq!(inbox_count, 0);
}

#[test]
fn sync_v2_poisoned_page_rolls_back_earlier_mutation_and_reader_proof() {
    let mutation = |revision: u64, note: &str| {
        serde_json::json!({
            "schemaVersion": 3,
            "mutationId": "duplicate-in-page",
            "workspaceId": "workspace-local",
            "workspaceSchemaVersion": 1,
            "entityType": "domain_asset",
            "entityId": format!("remote-{revision}.test"),
            "entityGeneration": 1,
            "operationKind": "upsert",
            "baseServerRevision": revision - 1,
            "changedFields": [{"fieldPath": "note", "value": note}],
            "sourceDeviceId": "cloud-device",
            "activeLeaseEpoch": 1,
            "deviceMutationSequence": revision,
            "serverRevision": revision,
        })
    };
    let mut page = serde_json::json!({
        "schemaVersion": 3,
        "workspaceId": "workspace-local",
        "fromServerRevisionExclusive": 0,
        "throughServerRevisionInclusive": 2,
        "mutations": [mutation(1, "first"), mutation(2, "poison")],
        "returnedThroughServerRevision": 2,
        "nextCursor": null,
        "pageDigest": "A".repeat(43),
    });
    page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());

    let mut database = database();
    assert_eq!(
        database.apply_sync_page_v2("reader-local", &page.to_string(), "confirm-poison"),
        Err(BusinessDatabaseError::StorageRejected)
    );
    assert_eq!(database.current_server_revision().unwrap(), 0);
    assert!(database.read_portfolio().unwrap().domains.is_empty());
    let counts: (i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT count(*) FROM sync_inbox),
                    (SELECT count(*) FROM sync_reader_state)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(counts, (0, 0));
}

#[test]
fn sync_v2_compacted_behind_stops_pull_without_deleting_local_authority() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "local-before-rebootstrap",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "local.test".to_owned(),
                note: Some("retain me".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    database
        .mark_sync_rebootstrap_required_v2("reader-local")
        .unwrap();
    assert_eq!(
        database.read_sync_pull_request_v2("reader-local", 256),
        Err(BusinessDatabaseError::RevisionRejected)
    );
    assert_eq!(
        database.apply_sync_page_v2(
            "reader-local",
            &test_sync_page(1, "must not apply"),
            "confirm-closed"
        ),
        Err(BusinessDatabaseError::RevisionRejected)
    );
    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("retain me")
    );
    assert_eq!(database.test_pending_sync_rows(10).unwrap().len(), 1);
}
