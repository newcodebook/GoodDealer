use super::*;

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "end-to-end edit/delete atomicity assertions stay together"
)]
fn edit_delete_receipts_are_idempotent_and_tombstone_blocks_resurrection() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "seed",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "edit.test".to_owned(),
                note: Some("old".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let receipt = database
        .edit_domain_asset(
            "edit-1",
            1,
            "device-1",
            7,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "edit.test".to_owned(),
                note: Some("new".to_owned()),
                portfolio_id: None,
                tags: vec!["tag".to_owned()],
                target_price: None,
            },
            true,
        )
        .unwrap();
    assert_eq!(receipt.disposition, "committed");
    let edit_fields: i64 = database.store.raw_connection().query_row("SELECT count(*) FROM sync_outbox_fields WHERE workspace_id='workspace-local' AND mutation_id='edit-1'", [], |row| row.get(0)).unwrap();
    assert_eq!(edit_fields, 4);
    let replay = database
        .edit_domain_asset(
            "edit-1",
            999,
            "device-1",
            8,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "edit.test".to_owned(),
                note: Some("new".to_owned()),
                portfolio_id: None,
                tags: vec!["tag".to_owned()],
                target_price: None,
            },
            false,
        )
        .unwrap();
    assert_eq!(replay.disposition, "replayed");
    assert_eq!(
        database.edit_domain_asset(
            "edit-1",
            1,
            "device-1",
            8,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "edit.test".to_owned(),
                note: Some("different".to_owned()),
                portfolio_id: None,
                tags: vec!["tag".to_owned()],
                target_price: None,
            },
            false,
        ),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(
        database.edit_domain_asset(
            "edit-1",
            1,
            "device-2",
            7,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "edit.test".to_owned(),
                note: Some("new".to_owned()),
                portfolio_id: None,
                tags: vec!["tag".to_owned()],
                target_price: None,
            },
            false,
        ),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(
        database.delete_domain_asset("edit-1", 1, "device-1", 7, TIMESTAMP, "edit.test", false,),
        Err(BusinessDatabaseError::MutationConflict)
    );
    let deleted = database
        .delete_domain_asset(
            "delete-1",
            receipt.local_commit_sequence,
            "device-1",
            7,
            TIMESTAMP,
            "edit.test",
            true,
        )
        .unwrap();
    assert_eq!(deleted.disposition, "committed");
    let pending = database.test_pending_sync_rows(10).unwrap();
    let delete_candidate = pending
        .iter()
        .find(|mutation| mutation.mutation_id == "delete-1")
        .unwrap();
    assert_eq!(
        delete_candidate.mutation_payload_json,
        r#"{"entityId":"edit.test","operation":"delete"}"#
    );
    let lifecycle_version: (String, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT sync_state, local_commit_sequence
             FROM domain_asset_field_versions
             WHERE workspace_id='workspace-local' AND entity_id='edit.test'
               AND field_path='lifecycleStatus'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        lifecycle_version,
        (
            "pending".to_owned(),
            i64::try_from(deleted.local_commit_sequence).unwrap()
        )
    );
    assert_eq!(
        database.delete_domain_asset(
            "edit-after-delete",
            deleted.local_commit_sequence,
            "device-1",
            7,
            TIMESTAMP,
            "edit.test",
            true
        ),
        Err(BusinessDatabaseError::AssetDeleted)
    );
    let fields: i64 = database.store.raw_connection().query_row("SELECT count(*) FROM sync_outbox_fields WHERE workspace_id='workspace-local' AND mutation_id='delete-1'", [], |row| row.get(0)).unwrap();
    assert_eq!(fields, 0);
    assert_eq!(
        database.upsert_domain_asset(
            "legacy-resurrect",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "edit.test".to_owned(),
                note: None,
                portfolio_id: None,
                tags: vec![],
                target_price: None
            }
        ),
        Err(BusinessDatabaseError::AssetDeleted)
    );
}

#[test]
fn applied_replica_deletion_requires_a_matching_tombstone() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    assert!(
        connection
            .execute(
                "INSERT INTO sync_inbox
             (workspace_id, server_revision, mutation_id, workspace_schema_version,
              entity_kind, entity_id, operation_kind, source_device_id,
              base_server_revision, mutation_payload_json, mutation_payload_sha256, state,
              received_at, applied_at)
             VALUES ('workspace-local', 1, 'delete-without-tombstone', 1,
                     'domain_asset', 'deleted.test', 'delete', 'device-1', 0,
                     '{}', ?1, 'applied', ?2, ?2)",
                params!["A".repeat(43), TIMESTAMP],
            )
            .is_err()
    );
}

/// The sales desk is kept for as long as `sales_listing_generation` stands still, so every row
/// the merge reads must move it and nothing else should.

#[test]
fn sync_page_refuses_a_later_generation_a_re_add_or_another_wire_version() {
    // ADR-0029 C1a/C2b: a later generation reaches only an entity this replica holds, a re-add
    // must name a tombstone, and only v3 materializes; each is refused with nothing written.
    let mut database = database();
    let variants: [fn(&mut serde_json::Value); 5] = [
        |page| page["mutations"][0]["entityGeneration"] = serde_json::json!(2),
        |page| {
            page["mutations"][0]["entityGeneration"] = serde_json::json!(2);
            page["mutations"][0]["reAddsDeletedRevision"] = serde_json::json!(0);
        },
        |page| {
            page["mutations"][0]
                .as_object_mut()
                .unwrap()
                .remove("entityGeneration");
        },
        |page| page["mutations"][0]["schemaVersion"] = serde_json::json!(2),
        |page| page["schemaVersion"] = serde_json::json!(2),
    ];
    for variant in variants {
        let mut page: serde_json::Value =
            serde_json::from_str(&test_sync_page(1, "remote")).unwrap();
        variant(&mut page);
        page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());
        assert_eq!(
            database.apply_sync_page_v2("reader-local", &page.to_string(), "confirm-1"),
            Err(BusinessDatabaseError::InvalidInput)
        );
    }
    assert_eq!(database.current_server_revision().unwrap(), 0);
    assert!(database.read_portfolio().unwrap().domains.is_empty());
    let inbox_count: i64 = database
        .store
        .raw_connection()
        .query_row("SELECT count(*) FROM sync_inbox", [], |row| row.get(0))
        .unwrap();
    assert_eq!(inbox_count, 0);
    // The same page in its first-generation v3 form applies and records the legacy digest.
    database
        .apply_sync_page_v2("reader-local", &test_sync_page(1, "remote"), "confirm-1")
        .unwrap();
    let (version, digest): (i64, String) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT wire_schema_version, wire_mutation_digest FROM sync_inbox",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let mut legacy: serde_json::Value = serde_json::from_str(&test_sync_page(1, "remote")).unwrap();
    let legacy = legacy["mutations"][0].as_object_mut().unwrap();
    legacy.remove("entityGeneration");
    legacy.remove("workspaceId");
    legacy.remove("serverRevision");
    legacy.insert("schemaVersion".to_owned(), serde_json::json!(2));
    // ADR-0029 C1c2b: a newly received mutation records its v3 digest.
    assert_eq!(version, 3);
    assert_ne!(
        digest,
        canonical_sync_digest(&serde_json::Value::Object(legacy.clone())).unwrap()
    );
    let mut current: serde_json::Value =
        serde_json::from_str(&test_sync_page(1, "remote")).unwrap();
    let current = current["mutations"][0].as_object_mut().unwrap();
    current.remove("workspaceId");
    current.remove("serverRevision");
    assert_eq!(
        digest,
        canonical_sync_digest(&serde_json::Value::Object(current.clone())).unwrap()
    );
}

#[test]
fn sync_page_refuses_a_mutation_for_another_generation_of_the_local_row() {
    // ADR-0029 C1c1: a local row on another generation is a different entity, so a pulled
    // mutation for it is refused with nothing written instead of merged into it.
    let mut database = database();
    database
        .store
        .raw_connection()
        .execute(
            "INSERT INTO domain_assets
             (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence,
              entity_generation)
             VALUES ('workspace-local','remote.test','active',?1,?1,1,2)",
            [TIMESTAMP],
        )
        .unwrap();
    assert_eq!(
        database.apply_sync_page_v2("reader-local", &test_sync_page(1, "remote"), "confirm-1"),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(database.current_server_revision().unwrap(), 0);
    let inbox_count: i64 = database
        .store
        .raw_connection()
        .query_row("SELECT count(*) FROM sync_inbox", [], |row| row.get(0))
        .unwrap();
    assert_eq!(inbox_count, 0);
}

#[test]
fn sync_page_refuses_a_mutation_for_another_generation_of_a_local_tombstone() {
    let mut database = database();
    database
        .store
        .raw_connection()
        .execute(
            "INSERT INTO sync_tombstones
             (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,deleted_at,state,
              barrier_state,entity_generation)
             VALUES ('workspace-local','domain_asset','remote.test',1,?1,'pending','pending',2)",
            [TIMESTAMP],
        )
        .unwrap();
    assert_eq!(
        database.apply_sync_page_v2("reader-local", &test_sync_page(1, "remote"), "confirm-1"),
        Err(BusinessDatabaseError::InvalidInput)
    );
    assert_eq!(database.current_server_revision().unwrap(), 0);
}

#[test]
fn sync_page_delete_records_the_generation_it_deleted() {
    let mut database = database();
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
    let generations: (i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT t.entity_generation, a.entity_generation
             FROM sync_tombstones t JOIN domain_assets a USING (workspace_id, entity_id)
             WHERE t.entity_id='remote.test' AND a.deleted_at IS NOT NULL",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(generations, (1, 1));
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one re-add is followed from materialization through replay, edit and delete"
)]
fn sync_page_applies_another_devices_re_add_as_the_next_generation() {
    // ADR-0029 C2b: the re-add Cloud accepted replaces the settled tombstone with a live row
    // of the next generation, built only from the re-add's own fields.
    let mut database = database_with_replicated_tombstone();
    let connection = database.store.raw_connection();
    connection
        .execute(
            "UPDATE domain_assets SET acquired_on='2026-01-01', auto_renew=1
             WHERE entity_id='remote.test'",
            [],
        )
        .unwrap();
    let page = generation_page(2, vec![re_add_mutation(2, 2, 2)]);
    database
        .apply_sync_page_v2("reader-local", &page, "confirm-2")
        .unwrap();
    let connection = database.store.raw_connection();
    let row: (i64, Option<String>, String, Option<String>, Option<i64>) = connection
        .query_row(
            "SELECT entity_generation, deleted_at, lifecycle_status, acquired_on, auto_renew
             FROM domain_assets WHERE entity_id='remote.test'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(row, (2, None, "active".to_owned(), None, None));
    let portfolio: (Option<String>, String, i64, i64, i64, i64) = connection
        .query_row(
            "SELECT note, tags_json, note_server_revision, portfolio_id_server_revision,
                    tags_server_revision, target_price_server_revision
             FROM portfolio_domain_assets WHERE entity_id='remote.test'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        portfolio,
        (Some("second life".to_owned()), "[]".to_owned(), 3, 3, 3, 3)
    );
    let leftovers: (i64, i64, String) = connection
        .query_row(
            "SELECT (SELECT count(*) FROM domain_asset_tags WHERE entity_id='remote.test'),
                    (SELECT count(*) FROM sync_tombstones),
                    (SELECT group_concat(field_path || ':' || server_revision)
                     FROM domain_asset_field_versions WHERE entity_id='remote.test')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(leftovers, (0, 0, "note:3".to_owned()));
    let record: (i64, i64, String, i64, String) = connection
        .query_row(
            "SELECT deleted_generation, deleted_server_revision, re_add_mutation_id,
                    re_add_server_revision, origin FROM sync_domain_asset_re_adds",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        record,
        (1, 2, "other-re-add".to_owned(), 3, "replicated".to_owned())
    );
    let inbox: String = connection
        .query_row(
            "SELECT state FROM sync_inbox WHERE server_revision=3",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(inbox, "applied");
    let domains = database.read_portfolio().unwrap().domains;
    assert_eq!(domains.len(), 1);
    assert_eq!(domains[0].note.as_deref(), Some("second life"));
    assert!(domains[0].tags.is_empty());
    // The page replays exactly, and the re-added asset is edited and deleted as generation 2.
    database
        .apply_sync_page_v2("reader-local", &page, "confirm-2")
        .unwrap();
    assert_eq!(re_add_footprint(&database), (3, 0, 1, 2, 3));
    let version = database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .edit_domain_asset(
            "local-edit",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            &DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("edited".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
            true,
        )
        .unwrap();
    let version = database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .delete_domain_asset(
            "local-delete",
            version,
            "device-local",
            1,
            "2026-08-28T00:02:00Z",
            "remote.test",
            true,
        )
        .unwrap();
    let generations: (String, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT group_concat(entity_generation) FROM sync_outbox
                     WHERE mutation_id IN ('local-edit','local-delete')),
                    (SELECT entity_generation FROM sync_tombstones)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(generations, ("2,2".to_owned(), 2));
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-1",
            "2026-08-28T00:03:00Z",
            "2026-08-28T00:04:00Z",
            256,
        )
        .unwrap();
    assert_eq!(claimed.len(), 2);
    for claim in claimed {
        let wire: serde_json::Value = serde_json::from_str(&claim.wire_mutation_json).unwrap();
        assert_eq!(wire["entityGeneration"], serde_json::json!(2));
    }
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the edit is followed from its hold through rejection to the re-add it unblocks"
)]
fn a_re_add_waits_for_a_queued_edit_then_retires_the_marks_of_its_rejection() {
    // Decision 3: no field of the deleted generation revives. A queued edit of that generation
    // is still owed, so the re-add waits for Cloud's answer to it; once Cloud refused it, its
    // `pending` field marks are residue, and the re-add retires them instead of stalling.
    let mut database = database();
    database
        .apply_sync_page_v2(
            "reader-local",
            &generation_page(
                0,
                vec![generation_mutation(
                    "other-create",
                    "remote.test",
                    1,
                    0,
                    &serde_json::json!([{"fieldPath": "note", "value": "first life"}]),
                )],
            ),
            "confirm-1",
        )
        .unwrap();
    let version = database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .edit_domain_asset(
            "local-edit",
            version,
            "device-local",
            1,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("first life".to_owned()),
                portfolio_id: None,
                tags: vec!["mine".to_owned()],
                target_price: None,
            },
            true,
        )
        .unwrap();
    database
        .apply_sync_page_v2(
            "reader-local",
            &generation_page(
                1,
                vec![generation_mutation(
                    "other-delete",
                    "remote.test",
                    1,
                    1,
                    &serde_json::json!([]),
                )],
            ),
            "confirm-2",
        )
        .unwrap();
    let candidate = database.read_sync_conflicts(10).unwrap().remove(0);
    assert_eq!(candidate.field_path, "lifecycleStatus");
    database
        .resolve_sync_conflict(
            "accept-delete",
            &candidate.conflict_id,
            2,
            candidate.candidate_version,
            candidate.remote_server_revision,
            &candidate.local_value_hash,
            "accept_remote",
            "device-local",
            1,
            TIMESTAMP,
        )
        .unwrap();
    let pending_marks = |database: &TestDatabase| -> i64 {
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
    assert!(pending_marks(&database) > 0);

    // The deletion is settled, but the edit is still queued: the page waits, unwritten.
    let page = generation_page(2, vec![re_add_mutation(2, 2, 2)]);
    let before = re_add_footprint(&database);
    assert_eq!(
        database.apply_sync_page_v2("reader-local", &page, "confirm-3"),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(re_add_footprint(&database), before);

    // Cloud refuses the edit against its tombstone. The marks stay, but nothing is owed.
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-1",
            "2026-08-28T00:01:01Z",
            "2026-08-28T00:02:01Z",
            256,
        )
        .unwrap();
    assert_eq!(claimed.len(), 1);
    database
        .reject_sync_batch_v2("owner-1", &claimed, SyncRejectionKind::MutationConflict)
        .unwrap();
    assert!(pending_marks(&database) > 0);

    database
        .apply_sync_page_v2("reader-local", &page, "confirm-4")
        .unwrap();
    assert_eq!(re_add_footprint(&database), (3, 0, 1, 2, 3));
    let detail = database.read_domain_detail("remote.test").unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("second life"));
    assert!(detail.asset.tags.is_empty());
    assert_eq!(pending_marks(&database), 0);
    assert!(
        database
            .read_sync_conflicts(10)
            .unwrap()
            .iter()
            .all(|candidate| candidate.status != "open")
    );
    // The refused edit stays as evidence of what the deleted generation did not keep.
    let evidence: (String, String) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state, last_error_code FROM sync_outbox WHERE mutation_id='local-edit'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        evidence,
        ("conflicted".to_owned(), "sync_mutation_conflict".to_owned())
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the deadlock and its exit are one scenario across pull, resolution, and retry"
)]
fn conflict_can_be_resolved_before_a_pinned_re_add_target_is_read() {
    let mut database = database_with_replicated_tombstone();
    database
        .store
        .raw_connection()
        .execute(
            "UPDATE portfolio_domain_assets SET note='first life'
         WHERE workspace_id='workspace-local' AND entity_id='remote.test'",
            [],
        )
        .unwrap();
    let local_json = serde_json::to_string(&serde_json::json!("first life")).unwrap();
    let remote_json = serde_json::to_string(&serde_json::json!("reviewed value")).unwrap();
    let local_hash = hex_digest(local_json.as_bytes());
    let remote_hash = hex_digest(remote_json.as_bytes());
    database
        .store
        .raw_connection()
        .execute(
            "UPDATE sync_reader_state
             SET pinned_target_server_revision=3,row_version=row_version+1
             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
            [],
        )
        .unwrap();
    database
        .store
        .raw_connection()
        .execute(
            "INSERT INTO sync_conflicts
         (workspace_id,conflict_id,entity_kind,entity_id,field_path,local_value_json,
          remote_value_json,local_commit_sequence,remote_server_revision,status,created_at,
          candidate_version,remote_source_device_id,remote_mutation_digest,
          remote_order_server_revision,remote_order_source_device_id,
          remote_order_mutation_id,local_value_hash,remote_value_hash)
         VALUES ('workspace-local','before-re-add','domain_asset','remote.test','note',
                 ?1,?2,1,2,'open',?3,2,'other-device',?4,2,'other-device',
                 'prior-mutation',?5,?6)",
            params![
                local_json,
                remote_json,
                TIMESTAMP,
                "A".repeat(43),
                local_hash,
                remote_hash
            ],
        )
        .unwrap();

    let candidate = database.read_sync_conflicts(10).unwrap().remove(0);
    let receipt = database
        .resolve_sync_conflict(
            "resolve-before-re-add",
            &candidate.conflict_id,
            2,
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
    let resolved_note: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT note FROM portfolio_domain_assets
             WHERE workspace_id='workspace-local' AND entity_id='remote.test'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(resolved_note, "reviewed value");

    database
        .apply_sync_page_v2(
            "reader-local",
            &generation_page(2, vec![re_add_mutation(2, 2, 2)]),
            "apply-re-add-after-resolution",
        )
        .unwrap();
    assert_eq!(database.current_server_revision().unwrap(), 3);
    let reader: (i64, Option<i64>) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT read_through_server_revision,pinned_target_server_revision
             FROM sync_reader_state WHERE workspace_id='workspace-local'
               AND device_id='reader-local'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(reader, (3, Some(3)));
    let status: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT status FROM sync_conflicts
             WHERE workspace_id='workspace-local' AND conflict_id='before-re-add'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status, "resolved_remote");
}

#[test]
fn sync_page_applies_a_re_add_over_an_acknowledged_local_delete() {
    // This device created and deleted the asset; Cloud acknowledged both, then accepted
    // another device's re-add of it.
    let mut database = database();
    let write = DomainAssetWrite {
        entity_id: "remote.test".to_owned(),
        note: Some("mine".to_owned()),
        portfolio_id: None,
        tags: vec!["kept-off".to_owned()],
        target_price: None,
    };
    database
        .create_domain_asset_guarded(
            "create-local",
            "device-local",
            1,
            TIMESTAMP,
            &write,
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
    let version = database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .delete_domain_asset(
            "delete-local",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            "remote.test",
            true,
        )
        .unwrap();
    // Before acknowledgement the local delete has no revision: the re-add waits for it.
    database
        .store
        .raw_connection()
        .execute(
            "UPDATE active_workspace_metadata SET applied_through_server_revision=2",
            [],
        )
        .unwrap();
    let page = generation_page(2, vec![re_add_mutation(2, 2, 2)]);
    assert_eq!(
        database.apply_sync_page_v2("reader-local", &page, "confirm-3"),
        Err(BusinessDatabaseError::MutationConflict)
    );
    assert_eq!(re_add_footprint(&database), (0, 1, 0, 1, 2));
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-1",
            "2026-08-28T00:01:01Z",
            "2026-08-28T00:02:00Z",
            256,
        )
        .unwrap();
    assert_eq!(claimed.len(), 2);
    let acknowledgements = claimed
        .iter()
        .zip(1..)
        .map(|(claim, server_revision)| SyncMutationAcknowledgement {
            mutation_id: claim.mutation_id.clone(),
            source_device_id: claim.source_device_id.clone(),
            active_lease_epoch: claim.active_lease_epoch,
            device_mutation_sequence: claim.device_mutation_sequence,
            delivery_attempt_fence: claim.delivery_attempt_fence,
            wire_mutation_digest: claim.wire_mutation_digest.clone(),
            server_revision,
        })
        .collect::<Vec<_>>();
    database
        .acknowledge_sync_batch_v2_guarded(
            "owner-1",
            &acknowledgements,
            "2026-08-28T00:01:02Z",
            |_| Ok(()),
        )
        .unwrap();
    let states: (String, String, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state, barrier_state, deleted_server_revision FROM sync_tombstones",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(states, ("acknowledged".to_owned(), "pending".to_owned(), 2));
    database
        .apply_sync_page_v2("reader-local", &page, "confirm-3")
        .unwrap();
    assert_eq!(re_add_footprint(&database), (1, 0, 1, 2, 3));
    let detail = database.read_domain_detail("remote.test").unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("second life"));
    assert!(detail.asset.tags.is_empty());
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "each kind of owed local work is seeded beside the one refusal it earns"
)]
fn sync_page_defers_a_re_add_while_local_work_on_the_entity_is_owed() {
    // A contested tombstone, a queued local mutation or an open conflict would be discarded by
    // the reset, so the page is refused as a conflict and nothing is written.
    let contested = database_with_replicated_tombstone();
    contested
        .store
        .raw_connection()
        .execute("UPDATE sync_tombstones SET barrier_state='contested'", [])
        .unwrap();
    let mut queued = database_with_replicated_tombstone();
    queued
        .upsert_domain_asset(
            "queued-other",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "other.test".to_owned(),
                note: None,
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    queued
        .store
        .raw_connection()
        .execute(
            "UPDATE sync_outbox SET entity_id='remote.test' WHERE mutation_id='queued-other'",
            [],
        )
        .unwrap();
    let conflicted = database_with_replicated_tombstone();
    conflicted
        .store
        .raw_connection()
        .execute(
            "UPDATE domain_asset_field_versions SET sync_state='conflicted'
             WHERE entity_id='remote.test' AND field_path='note'",
            [],
        )
        .unwrap();
    let open_conflict = database_with_replicated_tombstone();
    open_conflict
        .store
        .raw_connection()
        .execute(
            "INSERT INTO sync_conflicts
             (workspace_id,conflict_id,entity_kind,entity_id,field_path,local_value_json,
              remote_value_json,local_commit_sequence,remote_server_revision,status,created_at,
              candidate_version,remote_source_device_id,remote_mutation_digest,
              remote_order_server_revision,remote_order_source_device_id,
              remote_order_mutation_id,local_value_hash,remote_value_hash)
             VALUES ('workspace-local','open-conflict','domain_asset','remote.test','note',
                     '\"mine\"','\"theirs\"',1,1,'open',?1,1,'other-device',
                     'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',1,'other-device',
                     'other-create',?2,?3)",
            params![TIMESTAMP, "a".repeat(64), "b".repeat(64)],
        )
        .unwrap();
    // A remote delete held against a local edit leaves the row live under a contested
    // tombstone; the re-add waits for that conflict rather than failing as a divergence.
    let mut held = database();
    held.upsert_domain_asset(
        "local-edit-held",
        TIMESTAMP,
        &DomainAssetWrite {
            entity_id: "remote.test".to_owned(),
            note: Some("mine".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        },
    )
    .unwrap();
    held.apply_sync_page_v2(
        "reader-local",
        &generation_page(
            0,
            vec![
                generation_mutation(
                    "other-create",
                    "remote.test",
                    1,
                    0,
                    &serde_json::json!([{"fieldPath": "note", "value": "first life"}]),
                ),
                generation_mutation("other-delete", "remote.test", 1, 1, &serde_json::json!([])),
            ],
        ),
        "confirm-1",
    )
    .unwrap();
    let held_state: (String, Option<String>) = held
        .store
        .raw_connection()
        .query_row(
            "SELECT t.barrier_state, a.deleted_at FROM sync_tombstones t
             JOIN domain_assets a USING (workspace_id, entity_id)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(held_state, ("contested".to_owned(), None));
    let page = generation_page(2, vec![re_add_mutation(2, 2, 2)]);
    for mut database in [contested, queued, conflicted, open_conflict, held] {
        let before = re_add_footprint(&database);
        assert_eq!(
            database.apply_sync_page_v2("reader-local", &page, "confirm-2"),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(re_add_footprint(&database), before);
        assert_eq!(before.2, 0);
    }
}

#[test]
fn sync_page_refuses_a_re_add_of_a_tombstone_the_replica_does_not_hold() {
    // A re-add naming another deletion revision or generation, or an entity without a
    // tombstone, means the replica diverged from Cloud: the page is invalid.
    let pages = [
        generation_page(2, vec![re_add_mutation(2, 1, 2)]),
        generation_page(2, vec![re_add_mutation(3, 2, 2)]),
        generation_page(
            2,
            vec![{
                let mut mutation = re_add_mutation(2, 2, 2);
                mutation["entityId"] = serde_json::json!("never.test");
                mutation
            }],
        ),
        // A later generation without a re-add cannot reach an entity this replica never held.
        generation_page(
            2,
            vec![generation_mutation(
                "other-late",
                "never.test",
                2,
                2,
                &serde_json::json!([{"fieldPath": "note", "value": "late"}]),
            )],
        ),
    ];
    for page in pages {
        let mut database = database_with_replicated_tombstone();
        let before = re_add_footprint(&database);
        assert_eq!(
            database.apply_sync_page_v2("reader-local", &page, "confirm-2"),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(re_add_footprint(&database), before);
    }
    // A re-add of a live asset is refused the same way.
    let mut database = database();
    database
        .apply_sync_page_v2("reader-local", &test_sync_page(1, "live"), "confirm-1")
        .unwrap();
    assert_eq!(
        database.apply_sync_page_v2(
            "reader-local",
            &generation_page(1, vec![re_add_mutation(2, 1, 1)]),
            "confirm-2"
        ),
        Err(BusinessDatabaseError::InvalidInput)
    );
}

#[test]
fn sync_page_refuses_a_malformed_re_add() {
    let malformed: [fn(&mut serde_json::Value); 5] = [
        // Only an upsert re-adds.
        |mutation| {
            mutation["operationKind"] = serde_json::json!("delete");
            mutation["changedFields"] = serde_json::json!([]);
            mutation["deletedAt"] = serde_json::json!("2026-08-28T00:00:00Z");
        },
        // The first generation is never a re-add.
        |mutation| mutation["entityGeneration"] = serde_json::json!(1),
        // A re-add builds on the deletion it supersedes.
        |mutation| mutation["reAddsDeletedRevision"] = serde_json::json!(3),
        |mutation| mutation["reAddsDeletedRevision"] = serde_json::json!(0),
        |mutation| mutation["entityGeneration"] = serde_json::json!(0),
    ];
    for corrupt in malformed {
        let mut database = database_with_replicated_tombstone();
        let mut mutation = re_add_mutation(2, 2, 2);
        corrupt(&mut mutation);
        let before = re_add_footprint(&database);
        assert_eq!(
            database.apply_sync_page_v2(
                "reader-local",
                &generation_page(2, vec![mutation]),
                "confirm-2"
            ),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(re_add_footprint(&database), before);
    }
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one local re-add is followed from its write through the freeze, ACK and echo"
)]
fn local_re_add_is_provisional_frozen_and_confirmed_by_its_acknowledgement() {
    // ADR-0029 C2c1: another device deleted the asset; this device only received the
    // tombstone through the Inbox, then re-adds it.
    let mut database = database_with_replicated_tombstone();
    let receipt = database
        .re_add_domain_asset(
            "re-add-1",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("again"),
        )
        .unwrap();
    assert_eq!(receipt.operation, "re_add");
    // Provisional: generation 2 is live, the generation-1 tombstone stays, a pointer names it.
    let deleted_at: Option<String> = None;
    assert_eq!(local_re_add_state(&database), (2, deleted_at, 1, 1, 0));
    let detail = database.read_domain_detail("remote.test").unwrap();
    assert_eq!(detail.asset.note.as_deref(), Some("again"));
    assert_eq!(detail.asset.tags, vec!["fresh"]);
    let marked: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM sync_outbox_local_creations WHERE mutation_id='re-add-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(marked, 1);
    // Frozen: every other local write to the entity is refused with its own code.
    let version = detail.asset.asset_version;
    assert_eq!(
        database.edit_domain_asset(
            "edit-frozen",
            version,
            "device-local",
            1,
            "2026-08-28T00:11:00Z",
            &re_add_write("edited"),
            true
        ),
        Err(BusinessDatabaseError::AssetReAddPending)
    );
    assert_eq!(
        database.delete_domain_asset(
            "delete-frozen",
            version,
            "device-local",
            1,
            "2026-08-28T00:11:00Z",
            "remote.test",
            true
        ),
        Err(BusinessDatabaseError::AssetReAddPending)
    );
    assert_eq!(
        database.re_add_domain_asset(
            "re-add-twice",
            "device-local",
            1,
            "2026-08-28T00:11:00Z",
            &re_add_write("twice")
        ),
        Err(BusinessDatabaseError::AssetReAddPending)
    );
    // The same mutation replays exactly.
    assert_eq!(
        database
            .re_add_domain_asset(
                "re-add-1",
                "device-local",
                1,
                "2026-08-28T00:10:00Z",
                &re_add_write("again")
            )
            .unwrap()
            .disposition,
        "replayed"
    );
    // The wire names generation 2 and the deletion it supersedes.
    let wires = acknowledge_claimed(&mut database, 3);
    assert_eq!(wires.len(), 1);
    let wire: serde_json::Value = serde_json::from_str(&wires[0]).unwrap();
    assert_eq!(wire["entityGeneration"], serde_json::json!(2));
    assert_eq!(wire["reAddsDeletedRevision"], serde_json::json!(2));
    assert_eq!(wire["operationKind"], serde_json::json!("upsert"));
    // Acknowledged: the tombstone goes, a local record confirms generation 2, the freeze ends.
    assert_eq!(local_re_add_state(&database), (2, None, 0, 0, 1));
    let record: (i64, i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT deleted_generation, deleted_server_revision, re_add_server_revision
             FROM sync_domain_asset_re_adds WHERE re_add_mutation_id='re-add-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(record, (1, 2, 3));
    // Cloud's echo of this re-add applies as an ordinary upsert of generation 2.
    let mut echo = wire.clone();
    echo["workspaceId"] = serde_json::json!("workspace-local");
    echo["serverRevision"] = serde_json::json!(3);
    database
        .apply_sync_page_v2(
            "reader-local",
            &generation_page(2, vec![echo]),
            "confirm-echo",
        )
        .unwrap();
    assert_eq!(local_re_add_state(&database), (2, None, 0, 0, 1));
    let version = database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .edit_domain_asset(
            "edit-after",
            version,
            "device-local",
            1,
            "2026-08-28T00:20:00Z",
            &re_add_write("after"),
            true,
        )
        .unwrap();
    let generation: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT entity_generation FROM sync_outbox WHERE mutation_id='edit-after'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(generation, 2);
}

#[test]
fn a_rejected_local_re_add_is_withdrawn_and_may_be_attempted_again() {
    let mut database = database_with_replicated_tombstone();
    database
        .re_add_domain_asset(
            "re-add-1",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("first try"),
        )
        .unwrap();
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-1",
            "2026-08-28T00:11:00Z",
            "2026-08-28T00:12:00Z",
            256,
        )
        .unwrap();
    database
        .reject_sync_batch_v2("owner-1", &claimed, SyncRejectionKind::MutationConflict)
        .unwrap();
    // Withdrawn to the generation-1 tombstone; the attempt's Outbox row, fields and marker stay.
    let state = local_re_add_state(&database);
    assert_eq!(
        (state.0, state.1.is_some(), state.2, state.3, state.4),
        (1, true, 1, 0, 0)
    );
    let evidence: (String, String, i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state, last_error_code,
                    (SELECT count(*) FROM sync_outbox_fields WHERE mutation_id='re-add-1'),
                    (SELECT count(*) FROM sync_outbox_local_creations WHERE mutation_id='re-add-1')
             FROM sync_outbox WHERE mutation_id='re-add-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        evidence,
        (
            "conflicted".to_owned(),
            "sync_mutation_conflict".to_owned(),
            4,
            1
        )
    );
    // The attempt's fields are gone with it.
    let withdrawn: (Option<String>, String, i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT note, tags_json,
                    (SELECT count(*) FROM domain_asset_tags WHERE entity_id='remote.test'),
                    (SELECT count(*) FROM domain_asset_field_versions
                     WHERE entity_id='remote.test')
             FROM portfolio_domain_assets WHERE entity_id='remote.test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(withdrawn, (None, "[]".to_owned(), 0, 0));
    // A corrected attempt names generation 2 again and is confirmed.
    database
        .re_add_domain_asset(
            "re-add-2",
            "device-local",
            1,
            "2026-08-28T00:13:00Z",
            &re_add_write("second try"),
        )
        .unwrap();
    let wires = acknowledge_claimed(&mut database, 3);
    let wire: serde_json::Value = serde_json::from_str(&wires[0]).unwrap();
    assert_eq!(wire["entityGeneration"], serde_json::json!(2));
    assert_eq!(local_re_add_state(&database), (2, None, 0, 0, 1));
    assert_eq!(
        database
            .read_domain_detail("remote.test")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("second try")
    );
}

#[test]
fn a_deterministically_rejected_local_delete_is_withdrawn_too() {
    let mut database = database();
    own_create(&mut database);
    let create_echoes = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &create_echoes, "confirm-create").unwrap();
    let version = own_asset_version(&database);
    database
        .delete_domain_asset(
            "delete-refused",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            "remote.test",
            true,
        )
        .unwrap();
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-refuse-delete",
            "2026-08-28T01:00:00Z",
            "2026-08-28T01:01:00Z",
            256,
        )
        .unwrap();
    database
        .reject_sync_batch_v2(
            "owner-refuse-delete",
            &claimed,
            SyncRejectionKind::Deterministic,
        )
        .unwrap();
    let restored = database.read_domain_detail("remote.test").unwrap();
    assert_eq!(restored.asset.note.as_deref(), Some("first"));
    assert_eq!(restored.asset.asset_version, version);
    let state: (i64, Option<String>, String) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT count(*) FROM sync_tombstones WHERE entity_id='remote.test'),
                    (SELECT deleted_at FROM domain_assets WHERE entity_id='remote.test'),
                    (SELECT last_error_code FROM sync_outbox WHERE mutation_id='delete-refused')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, (0, None, "sync_deterministic_rejection".to_owned()));
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the withdrawal and the later Inbox page are one convergence scenario"
)]
fn a_definitively_rejected_local_delete_restores_the_asset_and_unblocks_inbox() {
    let mut database = database();
    own_create(&mut database);
    let create_echoes = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &create_echoes, "confirm-create").unwrap();
    let version = own_asset_version(&database);
    database
        .delete_domain_asset(
            "delete-rejected",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            "remote.test",
            true,
        )
        .unwrap();
    let before_reject: (i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT (SELECT count(*) FROM sync_tombstones WHERE entity_id='remote.test'),
                    (SELECT count(*) FROM domain_asset_field_versions
                     WHERE entity_id='remote.test' AND field_path='lifecycleStatus'
                       AND sync_state='pending')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(before_reject, (1, 1));
    assert!(
        database
            .store
            .raw_connection()
            .execute(
                "DELETE FROM sync_tombstones WHERE entity_id='remote.test'",
                [],
            )
            .is_err()
    );

    let claimed = database
        .claim_sync_mutations_v2(
            "owner-reject-delete",
            "2026-08-28T01:00:00Z",
            "2026-08-28T01:01:00Z",
            256,
        )
        .unwrap();
    assert_eq!(claimed.len(), 1);
    let delete_wire: serde_json::Value =
        serde_json::from_str(&claimed[0].wire_mutation_json).unwrap();
    assert_eq!(delete_wire["operationKind"], "delete");
    database
        .reject_sync_batch_v2(
            "owner-reject-delete",
            &claimed,
            SyncRejectionKind::MutationConflict,
        )
        .unwrap();

    let restored = database.read_domain_detail("remote.test").unwrap();
    assert_eq!(restored.asset.note.as_deref(), Some("first"));
    let state: (i64, i64, i64, String) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT a.entity_generation, a.local_commit_sequence,
                    (SELECT count(*) FROM sync_tombstones WHERE entity_id=a.entity_id),
                    (SELECT state FROM sync_outbox WHERE mutation_id='delete-rejected')
             FROM domain_assets AS a WHERE a.entity_id='remote.test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        state,
        (
            1,
            i64::try_from(version).unwrap(),
            0,
            "conflicted".to_owned()
        )
    );
    let lifecycle_versions: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM domain_asset_field_versions
             WHERE entity_id='remote.test' AND field_path='lifecycleStatus'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(lifecycle_versions, 0);

    let remote_edit = generation_mutation(
        "remote-edit-after-rejected-delete",
        "remote.test",
        1,
        1,
        &serde_json::json!([{"fieldPath":"note","value":"cloud edit"}]),
    );
    database
        .apply_sync_page_v2(
            "reader-local",
            &generation_page(1, vec![remote_edit]),
            "pull-after-rejected-delete",
        )
        .unwrap();
    assert_eq!(
        database
            .read_domain_detail("remote.test")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("cloud edit")
    );
    assert_eq!(database.current_server_revision().unwrap(), 2);
}

#[test]
fn an_idempotency_conflict_does_not_withdraw_a_local_delete() {
    let mut database = database();
    own_create(&mut database);
    let create_echoes = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &create_echoes, "confirm-create").unwrap();
    let version = own_asset_version(&database);
    database
        .delete_domain_asset(
            "delete-ambiguous",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            "remote.test",
            true,
        )
        .unwrap();
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-ambiguous-delete",
            "2026-08-28T01:00:00Z",
            "2026-08-28T01:01:00Z",
            256,
        )
        .unwrap();
    database
        .reject_sync_batch_v2(
            "owner-ambiguous-delete",
            &claimed,
            SyncRejectionKind::IdempotencyConflict,
        )
        .unwrap();
    assert_eq!(
        database
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM sync_tombstones WHERE entity_id='remote.test'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    assert!(database.read_domain_detail("remote.test").is_err());
}

#[test]
fn local_re_add_follows_an_acknowledged_local_delete() {
    let mut database = database();
    database
        .create_domain_asset_guarded(
            "create-local",
            "device-local",
            1,
            TIMESTAMP,
            &re_add_write("first"),
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
    let version = database
        .read_domain_detail("remote.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .delete_domain_asset(
            "delete-local",
            version,
            "device-local",
            1,
            "2026-08-28T00:01:00Z",
            "remote.test",
            true,
        )
        .unwrap();
    // Unacknowledged, the deletion has no revision to build on.
    assert_eq!(
        database.re_add_domain_asset(
            "re-add-early",
            "device-local",
            1,
            "2026-08-28T00:02:00Z",
            &re_add_write("early")
        ),
        Err(BusinessDatabaseError::AssetReAddBlocked)
    );
    let echoes = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &echoes, "confirm-1").unwrap();
    let re_add_receipt = database
        .create_domain_asset_guarded(
            "re-add-1",
            "device-local",
            1,
            "2026-08-28T00:03:00Z",
            &re_add_write("again"),
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
    assert_eq!(re_add_receipt.operation, "re_add");
    let replay = database
        .create_domain_asset_guarded(
            "re-add-1",
            "device-local",
            1,
            "2026-08-28T00:03:00Z",
            &re_add_write("again"),
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
    assert_eq!(replay.disposition, "replayed");
    assert_eq!(replay.operation, "re_add");
    let wires = acknowledge_claimed(&mut database, 3);
    let wire: serde_json::Value = serde_json::from_str(&wires[0]).unwrap();
    assert_eq!(wire["reAddsDeletedRevision"], serde_json::json!(2));
    assert_eq!(local_re_add_state(&database), (2, None, 0, 0, 1));
}

/// ADR-0029 forbids an executable production re-add path before its completion condition, so
/// with the entry closed (as production builds have it) a deleted domain, whether its row is
/// soft-deleted behind a settled tombstone or only a tombstone exists, is refused exactly as
/// before re-adding existed and nothing is written.
#[test]
fn a_closed_re_add_entry_refuses_deleted_domains_as_before_without_writing() {
    super::super::close_local_re_add_entry_for_test();
    let mut settled = database_with_replicated_tombstone();
    // No production path purges yet, but the schema lets a purge-eligible tombstone outlive its
    // row; the create path must refuse that shape too.
    let mut tombstone_only = database_with_replicated_tombstone();
    let connection = tombstone_only.store.raw_connection();
    connection
        .execute(
            "UPDATE sync_tombstones SET state='purge_eligible', barrier_state='purge_eligible',
                    purge_after='2000-01-01T00:00:00Z' WHERE entity_id='remote.test'",
            [],
        )
        .unwrap();
    connection
        .execute(
            "DELETE FROM domain_assets WHERE entity_id='remote.test'",
            [],
        )
        .unwrap();
    // Everything a re-add (or any create) would touch: Outbox, commit sequence, asset rows and
    // their generation and deletion, tombstones, re-add records and provisional pointers.
    let footprint = |database: &TestDatabase| -> [i64; 7] {
        database
            .store
            .raw_connection()
            .query_row(
                "SELECT (SELECT count(*) FROM sync_outbox),
                        (SELECT local_commit_sequence FROM active_workspace_metadata),
                        (SELECT count(*) FROM domain_assets),
                        (SELECT coalesce(sum(entity_generation), 0) FROM domain_assets),
                        (SELECT count(*) FROM sync_tombstones),
                        (SELECT count(*) FROM sync_domain_asset_re_adds),
                        (SELECT count(*) FROM sync_domain_asset_provisional_re_adds)",
                [],
                |row| {
                    Ok([
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ])
                },
            )
            .unwrap()
    };
    let row_present = |database: &TestDatabase| footprint(database)[2] == 1;
    assert!(row_present(&settled));
    assert!(!row_present(&tombstone_only));
    for database in [&mut settled, &mut tombstone_only] {
        assert_eq!(footprint(database)[4], 1);
        let before = footprint(database);
        assert_eq!(
            database.create_domain_asset_guarded(
                "re-add-closed",
                "device-local",
                1,
                "2026-08-28T00:03:00Z",
                &re_add_write("again"),
                true,
                |_| Ok(()),
                |(), _| Ok(()),
            ),
            Err(BusinessDatabaseError::AssetDeleted)
        );
        assert_eq!(footprint(database), before);
    }
}

#[test]
fn own_echoes_of_a_create_and_its_delete_apply_after_both_are_acknowledged() {
    let mut database = database();
    own_create(&mut database);
    own_delete(&mut database, "delete-local");
    let wires = acknowledge_claimed(&mut database, 1);
    assert_eq!(wires.len(), 2);
    pull_echoes(&mut database, 0, &wires, "confirm-1").unwrap();
    // The create is not replayed over the deletion; the delete settles its own tombstone.
    assert_eq!(echo_state(&database), (1, true, 1, 2, 0));
    let tombstone: (String, String) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state, barrier_state FROM sync_tombstones",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        tombstone,
        ("replicated".to_owned(), "replicated".to_owned())
    );
    // Nothing stays owed: the next pull starts from the echoes' revision.
    pull_echoes(&mut database, 2, &[], "confirm-2").unwrap();
}

#[test]
fn own_echo_of_an_edit_superseded_by_a_local_delete_applies() {
    let mut database = database();
    own_create(&mut database);
    let create = acknowledge_claimed(&mut database, 1);
    // An echo pulled while the entity has not moved on is projected as before.
    pull_echoes(&mut database, 0, &create, "confirm-1").unwrap();
    let version = own_asset_version(&database);
    database
        .edit_domain_asset(
            "edit-local",
            version,
            "device-local",
            1,
            "2026-08-28T00:04:00Z",
            &re_add_write("edited"),
            true,
        )
        .unwrap();
    own_delete(&mut database, "delete-local");
    let later = acknowledge_claimed(&mut database, 2);
    assert_eq!(later.len(), 2);
    pull_echoes(&mut database, 1, &later, "confirm-2").unwrap();
    assert_eq!(echo_state(&database), (1, true, 1, 3, 0));
}

#[test]
fn own_echoes_of_a_local_re_add_and_its_later_delete_apply() {
    // A re-add builds on its deletion's revision (R <= base), so the device has pulled the
    // echoes up to that deletion before it can re-add; the re-add's own echo can then arrive
    // after a later local delete of the new generation.
    let mut database = database();
    own_create(&mut database);
    own_delete(&mut database, "delete-local");
    let first = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &first, "confirm-1").unwrap();
    assert_eq!(echo_state(&database), (1, true, 1, 2, 0));
    own_re_add(&mut database);
    let mut later = acknowledge_claimed(&mut database, 3);
    own_delete(&mut database, "delete-again");
    later.extend(acknowledge_claimed(&mut database, 4));
    pull_echoes(&mut database, 2, &later, "confirm-2").unwrap();
    assert_eq!(echo_state(&database), (2, true, 1, 4, 0));

    // The same after another device's deletion, which this device received as a tombstone.
    let mut database = database_with_replicated_tombstone();
    own_re_add(&mut database);
    let mut wires = acknowledge_claimed(&mut database, 3);
    own_delete(&mut database, "delete-again");
    wires.extend(acknowledge_claimed(&mut database, 4));
    pull_echoes(&mut database, 2, &wires, "confirm-2").unwrap();
    assert_eq!(echo_state(&database), (2, true, 1, 4, 0));
}

#[test]
fn own_echo_of_an_earlier_edit_yields_to_the_later_edit_still_in_flight() {
    let mut database = database();
    own_create(&mut database);
    let create = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &create, "confirm-1").unwrap();
    own_edit(&mut database, "edit-a", "a");
    let earlier = acknowledge_claimed(&mut database, 2);
    own_edit(&mut database, "edit-b", "b");
    pull_echoes(&mut database, 1, &earlier, "confirm-2").unwrap();
    // The later edit keeps its value and stays owed; no conflict against this device's own write.
    assert_eq!(
        own_edit_echo_state(&database),
        (0, 0, 4, Some("b".to_owned()))
    );
    let later = acknowledge_claimed(&mut database, 3);
    pull_echoes(&mut database, 2, &later, "confirm-3").unwrap();
    assert_eq!(
        own_edit_echo_state(&database),
        (0, 0, 0, Some("b".to_owned()))
    );
}

#[test]
fn own_echo_of_an_earlier_edit_does_not_roll_back_a_later_acknowledged_edit() {
    // Both edits are acknowledged before the pull reaches either echo; a paginated pull then
    // applies the earlier echo on its own page before the later one.
    let mut database = database();
    own_create(&mut database);
    let create = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &create, "confirm-1").unwrap();
    own_edit(&mut database, "edit-a", "a");
    let earlier = acknowledge_claimed(&mut database, 2);
    own_edit(&mut database, "edit-b", "b");
    let later = acknowledge_claimed(&mut database, 3);
    pull_echoes(&mut database, 1, &earlier, "confirm-2").unwrap();
    assert_eq!(
        own_edit_echo_state(&database),
        (0, 0, 0, Some("b".to_owned()))
    );
    pull_echoes(&mut database, 2, &later, "confirm-3").unwrap();
    assert_eq!(
        own_edit_echo_state(&database),
        (0, 0, 0, Some("b".to_owned()))
    );
}

#[test]
fn own_echo_still_conflicts_with_a_local_value_cloud_refused() {
    let mut database = database();
    own_create(&mut database);
    let create = acknowledge_claimed(&mut database, 1);
    pull_echoes(&mut database, 0, &create, "confirm-1").unwrap();
    own_edit(&mut database, "edit-a", "a");
    let earlier = acknowledge_claimed(&mut database, 2);
    own_edit(&mut database, "edit-b", "b");
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-reject",
            "2026-08-28T01:00:00Z",
            "2026-08-28T01:01:00Z",
            256,
        )
        .unwrap();
    database
        .reject_sync_batch_v2_guarded(
            "owner-reject",
            &claimed,
            SyncRejectionKind::MutationConflict,
            |_| Ok(()),
        )
        .unwrap();
    // Cloud holds "a"; the refused "b" is still surfaced against it.
    pull_echoes(&mut database, 1, &earlier, "confirm-2").unwrap();
    let (conflicts, conflicted_inbox, _, note) = own_edit_echo_state(&database);
    assert!(conflicts > 0);
    assert_eq!((conflicted_inbox, note), (1, Some("b".to_owned())));
}

#[test]
fn local_re_add_is_refused_without_writing_until_its_preconditions_hold() {
    let outbox_count = |database: &TestDatabase| -> i64 {
        database
            .store
            .raw_connection()
            .query_row("SELECT count(*) FROM sync_outbox", [], |row| row.get(0))
            .unwrap()
    };
    let attempt = |database: &mut TestDatabase| {
        database.re_add_domain_asset(
            "re-add",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("again"),
        )
    };
    let contested = database_with_replicated_tombstone();
    contested
        .store
        .raw_connection()
        .execute("UPDATE sync_tombstones SET barrier_state='contested'", [])
        .unwrap();
    let open_conflict = database_with_replicated_tombstone();
    open_conflict
        .store
        .raw_connection()
        .execute(
            "INSERT INTO sync_conflicts
             (workspace_id,conflict_id,entity_kind,entity_id,field_path,local_value_json,
              remote_value_json,local_commit_sequence,remote_server_revision,status,created_at,
              candidate_version,remote_source_device_id,remote_mutation_digest,
              remote_order_server_revision,remote_order_source_device_id,
              remote_order_mutation_id,local_value_hash,remote_value_hash)
             VALUES ('workspace-local','open-conflict','domain_asset','remote.test','note',
                     '\"mine\"','\"theirs\"',1,1,'open',?1,1,'other-device',
                     'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',1,'other-device',
                     'other-create',?2,?3)",
            params![TIMESTAMP, "a".repeat(64), "b".repeat(64)],
        )
        .unwrap();
    for mut database in [contested, open_conflict] {
        let before = outbox_count(&database);
        assert_eq!(
            attempt(&mut database),
            Err(BusinessDatabaseError::AssetReAddBlocked)
        );
        assert_eq!(outbox_count(&database), before);
        assert_eq!(local_re_add_state(&database).3, 0);
    }
    // A live asset is not deleted, and an asset never held cannot be re-added.
    let mut live = database();
    live.apply_sync_page_v2("reader-local", &test_sync_page(1, "live"), "confirm-1")
        .unwrap();
    assert_eq!(attempt(&mut live), Err(BusinessDatabaseError::AssetExists));
    let mut never = database();
    assert_eq!(
        attempt(&mut never),
        Err(BusinessDatabaseError::AssetNotFound)
    );
}

#[test]
fn schema_admits_a_provisional_re_add_only_beside_its_pointer_and_outcome() {
    let mut database = database_with_replicated_tombstone();
    let connection = database.store.raw_connection();
    let refused = |statement: &str, message: &str| {
        let error = connection.execute_batch(statement).unwrap_err().to_string();
        assert!(error.contains(message), "{statement}: {error}");
    };
    // A pointer needs a settled tombstone of its generation and revision.
    refused(
        "INSERT INTO sync_domain_asset_provisional_re_adds VALUES
           ('workspace-local','remote.test',1,1,'wrong-revision')",
        "a local re-add needs a confirmed, settled tombstone and no owed work",
    );
    // Without a pointer, the row cannot revive and no Outbox re-add can be written.
    refused(
        "UPDATE domain_assets SET entity_generation=2, deleted_at=NULL,
           lifecycle_status='active'",
        "re-adding",
    );
    refused(
        "INSERT INTO sync_outbox
         (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at,
          base_server_revision,entity_generation,re_adds_deleted_revision)
         VALUES ('workspace-local','stray','domain_asset','remote.test','{}',
                 '2026-08-28T00:00:00Z',2,1,2)",
        "an outbox re-add must name its provisional pointer",
    );
    database
        .re_add_domain_asset(
            "re-add-1",
            "device-local",
            1,
            "2026-08-28T00:10:00Z",
            &re_add_write("again"),
        )
        .unwrap();
    let connection = database.store.raw_connection();
    let refused = |statement: &str, message: &str| {
        let error = connection.execute_batch(statement).unwrap_err().to_string();
        assert!(error.contains(message), "{statement}: {error}");
    };
    // While provisional: no other Outbox row, no withdrawal before an outcome, no early end.
    refused(
        "INSERT INTO sync_outbox
         (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at,
          entity_generation)
         VALUES ('workspace-local','sneaky','domain_asset','remote.test','{}',
                 '2026-08-28T00:00:00Z',2)",
        "a domain asset is frozen while its re-add is provisional",
    );
    refused(
        "UPDATE domain_assets SET entity_generation=1, deleted_at='2026-08-28T00:00:00Z',
           lifecycle_status='archived'",
        "entity generation changes only through re-adding",
    );
    refused(
        "DELETE FROM sync_domain_asset_provisional_re_adds",
        "a provisional re-add ends only when acknowledged or withdrawn",
    );
    refused(
        "INSERT INTO sync_domain_asset_re_adds VALUES
           ('workspace-local','remote.test',1,2,'re-add-1',3,'local',9)",
        "a local re-add record confirms an acknowledged provisional re-add",
    );
    refused(
        "UPDATE sync_outbox SET re_adds_deleted_revision=1 WHERE mutation_id='re-add-1'",
        "an outbox re-add revision is immutable",
    );
}

#[test]
fn schema_changes_a_generation_or_removes_a_tombstone_only_through_a_re_add_record() {
    let database = database_with_replicated_tombstone();
    let connection = database.store.raw_connection();
    let refused = |statement: &str, message: &str| {
        let error = connection.execute_batch(statement).unwrap_err().to_string();
        assert!(error.contains(message), "{statement}: {error}");
    };
    refused(
        "DELETE FROM sync_tombstones",
        "a tombstone is removed only by a confirmed re-add, a rejected local delete or a checkpoint advance",
    );
    // Either guard may fire first; both refuse a revival under the tombstone.
    refused(
        "UPDATE domain_assets SET entity_generation=2, deleted_at=NULL,
           lifecycle_status='active'",
        "re-adding",
    );
    refused(
        "UPDATE domain_assets SET deleted_at=NULL, lifecycle_status='active'",
        "a deleted domain asset revives only by re-adding",
    );
    refused(
        "INSERT INTO sync_domain_asset_re_adds VALUES
           ('workspace-local','remote.test',1,1,'wrong-revision',3,'replicated',9)",
        "a re-add record must name its tombstone",
    );
    refused(
        "INSERT INTO sync_domain_asset_re_adds VALUES
           ('workspace-local','remote.test',1,2,'local-origin',3,'local',9)",
        "a local re-add record confirms an acknowledged provisional re-add",
    );
    // With the record, the tombstone may go, but the row may move only one generation on.
    connection
        .execute_batch(
            "INSERT INTO sync_domain_asset_re_adds VALUES
               ('workspace-local','remote.test',1,2,'other-re-add',3,'replicated',9);
             DELETE FROM sync_tombstones;",
        )
        .unwrap();
    refused(
        "UPDATE domain_assets SET entity_generation=3, deleted_at=NULL,
           lifecycle_status='active'",
        "entity generation changes only through re-adding",
    );
    refused(
        "UPDATE domain_assets SET entity_generation=2",
        "entity generation changes only through re-adding",
    );
    refused(
        "UPDATE sync_domain_asset_re_adds SET re_add_server_revision=4",
        "a re-add record is immutable",
    );
    refused(
        "DELETE FROM sync_domain_asset_re_adds",
        "a re-add record is immutable",
    );
    connection
        .execute_batch(
            "UPDATE domain_assets SET entity_generation=2, deleted_at=NULL,
               lifecycle_status='active'",
        )
        .unwrap();
    // Once live, the generation is fixed again.
    refused(
        "UPDATE domain_assets SET entity_generation=1",
        "entity generation changes only through re-adding",
    );
}

#[test]
fn a_withdrawn_re_add_then_takes_the_cloud_snapshot_and_tombstone() {
    // ADR-0029: Cloud refuses this device's re-add (another device re-added first), the
    // provisional generation is withdrawn, and the checkpoint then carries Cloud's state.
    let rejected = || {
        let mut database = database_with_replicated_tombstone();
        database
            .re_add_domain_asset(
                "re-add-refused",
                "device-local",
                1,
                "2026-08-28T00:10:00Z",
                &re_add_write("mine"),
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
        database
            .reject_sync_batch_v2(
                "owner-refuse",
                &claimed,
                SyncRejectionKind::MutationConflict,
            )
            .unwrap();
        assert_eq!(remote_generation(&database), (1, true, Some((1, 2))));
        database
    };
    // The other device's generation 2 is live in the checkpoint.
    let mut live = rejected();
    install_generations(
        &mut live,
        &[RebootstrapAsset {
            asset: re_add_write("theirs"),
            entity_generation: 2,
        }],
        &[],
        3,
    )
    .unwrap();
    assert_eq!(remote_generation(&live), (2, false, None));
    assert_eq!(
        live.read_domain_detail("remote.test")
            .unwrap()
            .asset
            .note
            .as_deref(),
        Some("theirs")
    );
    // The refused attempt stays as evidence.
    let state: String = live
        .store
        .raw_connection()
        .query_row(
            "SELECT state FROM sync_outbox WHERE mutation_id='re-add-refused'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(state, "conflicted");
    // Or Cloud still holds the same generation-1 tombstone: it is confirmed unchanged.
    let mut deleted = rejected();
    install_generations(&mut deleted, &[], &[remote_tombstone(1, 2)], 3).unwrap();
    assert_eq!(remote_generation(&deleted), (1, true, Some((1, 2))));
    assert!(advances(&deleted).is_empty());
}
