use super::*;

#[test]
fn ordinary_keyed_open_retains_default_memory_security_in_unit_tests() {
    let database = database();
    let state: String = database
        .store
        .raw_connection()
        .query_row("PRAGMA cipher_memory_security", [], |row| row.get(0))
        .unwrap();
    assert_eq!(state, "0");
}

#[test]
fn sqlcipher_full_clone_rekeys_and_preserves_complete_database_proof() {
    let directory = tempdir().unwrap();
    let source_path = directory.path().join("source.db");
    let candidate_path = directory.path().join("candidate.db");
    let source_key = LocalDatabaseKey::from_bytes([0x31; 32]);
    let candidate_key = LocalDatabaseKey::from_bytes([0x52; 32]);
    let mut source = BusinessDatabase::open(&source_path, &source_key, "workspace-local").unwrap();
    source
        .upsert_domain_asset(
            "clone-mutation",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "clone.test".to_owned(),
                note: Some("preserved".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let before = source.recovery_proof().unwrap();
    clone_encrypted_database(&source_path, &source_key, &candidate_path, &candidate_key).unwrap();
    assert_eq!(
        BusinessDatabase::open(&candidate_path, &source_key, "workspace-local").err(),
        Some(BusinessDatabaseError::StorageRejected)
    );
    let candidate =
        BusinessDatabase::open(&candidate_path, &candidate_key, "workspace-local").unwrap();
    assert_eq!(candidate.recovery_proof().unwrap(), before);
    assert_eq!(candidate.test_pending_sync_rows(10).unwrap().len(), 1);
    drop(candidate);
    assert_eq!(
        clone_encrypted_database(&source_path, &source_key, &candidate_path, &candidate_key),
        Err(BusinessDatabaseError::StorageRejected)
    );
    assert_eq!(source.recovery_proof().unwrap(), before);
    let wrong_source_key = LocalDatabaseKey::from_bytes([0x71; 32]);
    assert_eq!(
        clone_encrypted_database(
            &source_path,
            &wrong_source_key,
            &directory.path().join("wrong-source.db"),
            &candidate_key,
        ),
        Err(BusinessDatabaseError::StorageRejected)
    );
    assert_eq!(source.recovery_proof().unwrap(), before);
}

#[test]
fn failed_duplicate_mutation_rolls_back_business_change() {
    let mut database = database();
    let first = DomainAssetWrite {
        entity_id: "domain-1.test".to_owned(),
        note: Some("first".to_owned()),
        portfolio_id: None,
        tags: vec![],
        target_price: None,
    };
    database
        .upsert_domain_asset("mutation-1", TIMESTAMP, &first)
        .unwrap();
    let conflicting = DomainAssetWrite {
        entity_id: "domain-1.test".to_owned(),
        note: Some("must roll back".to_owned()),
        portfolio_id: None,
        tags: vec![],
        target_price: None,
    };
    assert!(
        database
            .upsert_domain_asset("mutation-1", TIMESTAMP, &conflicting)
            .is_err()
    );
    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("first")
    );
}

#[test]
fn consecutive_unacknowledged_edits_share_the_applied_base_and_rise_in_device_sequence() {
    // Cloud's stale-field rule exempts a device's own earlier write only because the Host
    // freezes each edit against the head it has applied: two edits before any ACK both name
    // that head, and their device sequences rise. This pins the Host half of that contract.
    let mut database = database();
    database
        .upsert_domain_asset(
            "seed",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "twice.test".to_owned(),
                note: Some("old".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let current_version = |database: &BusinessDatabase| -> u64 {
        database
            .store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM domain_assets
                 WHERE workspace_id='workspace-local' AND entity_id='twice.test'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
            .try_into()
            .unwrap()
    };
    for (mutation_id, note) in [("edit-a", "first"), ("edit-b", "second")] {
        let version = current_version(&database);
        database
            .edit_domain_asset(
                mutation_id,
                version,
                "device-1",
                7,
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "twice.test".to_owned(),
                    note: Some(note.to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
                true,
            )
            .unwrap();
    }
    let rows: Vec<(i64, i64)> = database
        .store
        .raw_connection()
        .prepare(
            "SELECT base_server_revision, device_mutation_sequence FROM sync_outbox
             WHERE workspace_id='workspace-local' AND mutation_id IN ('edit-a','edit-b')
             ORDER BY device_mutation_sequence",
        )
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, rows[1].0);
    assert!(rows[0].1 < rows[1].1);
}

#[test]
fn pre_commit_guard_failure_rolls_back_all_mutation_rows() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "seed-guard",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "guard.test".to_owned(),
                note: None,
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let result = database.edit_domain_asset_guarded(
        "guard-edit",
        1,
        "device-1",
        7,
        TIMESTAMP,
        &DomainAssetWrite {
            entity_id: "guard.test".to_owned(),
            note: Some("blocked".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        },
        true,
        |_| -> Result<(), BusinessDatabaseError> { Err(BusinessDatabaseError::MutationStale) },
        |(), _| Ok(()),
    );
    assert_eq!(result, Err(BusinessDatabaseError::MutationStale));
    let detail = database.read_domain_detail("guard.test").unwrap();
    assert_eq!(detail.asset.note, None);
    let outbox: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT count(*) FROM sync_outbox WHERE mutation_id='guard-edit'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(outbox, 0);

    let delete_result = database.delete_domain_asset_guarded(
        "guard-delete",
        1,
        "device-1",
        7,
        TIMESTAMP,
        "guard.test",
        true,
        |_| -> Result<(), BusinessDatabaseError> { Err(BusinessDatabaseError::MutationStale) },
        |(), _| Ok(()),
    );
    assert_eq!(delete_result, Err(BusinessDatabaseError::MutationStale));
    let rollback_counts: (i64, i64, i64) = database
        .store
        .raw_connection()
        .query_row(
            "SELECT
               (SELECT count(*) FROM domain_assets
                WHERE entity_id='guard.test' AND deleted_at IS NULL
                  AND lifecycle_status='active' AND local_commit_sequence=1),
               (SELECT count(*) FROM sync_tombstones WHERE entity_id='guard.test'),
               (SELECT count(*) FROM domain_asset_field_versions
                WHERE entity_id='guard.test' AND field_path='lifecycleStatus')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(rollback_counts, (1, 0, 0));
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the adversarial scenario keeps all related target outcomes visible in one test"
)]
fn provider_observations_preserve_target_outcomes_and_capability_lineage() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    connection
        .execute(
            "INSERT INTO domain_assets
             (workspace_id, entity_id, lifecycle_status, created_at, updated_at,
              local_commit_sequence)
             VALUES ('workspace-local', 'observed.test', 'active', ?1, ?1, 1)",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO domain_assets
             (workspace_id, entity_id, lifecycle_status, created_at, updated_at,
              local_commit_sequence)
             VALUES ('workspace-local', 'missing.test', 'active', ?1, ?1, 1)",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO local_provider_connections
             (workspace_id, connection_id, provider_kind, display_label, active_credential_changed_at,
              capabilities_json)
             VALUES ('workspace-local', 'observation-connection', 'cloudflare', 'Observed',
                     ?1, '[\"dns\"]')",
            [TIMESTAMP],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "INSERT INTO operation_plans
             (workspace_id, plan_id, operation_kind, plan_hash, title, phase, risk_level,
              item_count, created_at, approved_at, local_commit_sequence)
             VALUES ('workspace-local', 'direct-approved', 'dns_change', ?1,
                     'Direct approval', 'approved', 'standard', 1, ?2, ?2, 1)",
                params!["0".repeat(64), TIMESTAMP],
            )
            .is_err()
    );
    connection
        .execute(
            "INSERT INTO provider_observation_runs
             (workspace_id, observation_run_id, connection_id, observation_capability, started_at,
              completed_at, status)
             VALUES ('workspace-local', 'dns-run', 'observation-connection', 'dns',
                     ?1, NULL, 'running')",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO provider_observation_targets
             (workspace_id, observation_run_id, entity_id, ordinal, status, error_code,
              requested_at, completed_at)
             VALUES ('workspace-local', 'dns-run', 'observed.test', 0, 'requested',
                     NULL, ?1, NULL)",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO provider_observation_targets
             (workspace_id, observation_run_id, entity_id, ordinal, status, error_code,
              requested_at, completed_at)
             VALUES ('workspace-local', 'dns-run', 'missing.test', 1, 'requested',
                     NULL, ?1, NULL)",
            [TIMESTAMP],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "INSERT INTO registrar_observations
             (workspace_id, observation_id, observation_run_id, entity_id, observation_availability,
              evidence_status, observed_at, provider_version_token)
             VALUES ('workspace-local', 'wrong-kind', 'dns-run', 'observed.test',
                     'unavailable', 'unknown', ?1, 'v1')",
                [TIMESTAMP],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "INSERT INTO asset_valuation_observations
             (workspace_id, valuation_id, observation_run_id, entity_id, valuation_kind,
              amount_currency, amount_value, observed_at)
             VALUES ('workspace-local', 'provider-valuation-without-run', NULL,
                     'observed.test', 'provider', 'USD', '100', ?1)",
                [TIMESTAMP],
            )
            .is_err()
    );
    connection
        .execute(
            "INSERT INTO dns_zone_observations
             (workspace_id, zone_observation_id, observation_run_id, entity_id,
              zone_name_ascii, authoritative_nameservers_json, dnssec_status,
              observation_availability, evidence_status, observed_at, provider_version_token)
             VALUES ('workspace-local', 'dns-observation', 'dns-run', 'observed.test',
                     'observed.test', '[]', 'unknown', 'unavailable', 'unknown', ?1, 'v1')",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE provider_observation_targets
             SET status = 'succeeded', completed_at = ?1
             WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'
               AND entity_id = 'observed.test'",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE provider_observation_targets
             SET status = 'failed', error_code = 'provider_timeout', completed_at = ?1
             WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'
               AND entity_id = 'missing.test'",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE provider_observation_runs
             SET status = 'partial', completed_at = ?1, error_code = 'provider_timeout'
             WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'",
            [TIMESTAMP],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "UPDATE dns_zone_observations SET normalized_evidence_sha256 = 'rewritten'
             WHERE workspace_id = 'workspace-local'
               AND zone_observation_id = 'dns-observation'",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "DELETE FROM provider_observation_runs
             WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'",
                [],
            )
            .is_err()
    );
    connection
        .execute(
            "INSERT INTO sync_tombstones
             (workspace_id, entity_kind, entity_id, deleted_local_commit_sequence,
              deleted_server_revision, deleted_at, purge_after, state,barrier_state,
              order_server_revision,order_source_device_id,order_mutation_id)
             VALUES ('workspace-local', 'domain_asset', 'observed.test', 1, 1, ?1, ?1,
                     'purge_eligible','purge_eligible',1,'test-source','test-delete')",
            ["2000-01-01T00:00:00Z"],
        )
        .unwrap();
    connection
        .execute(
            "DELETE FROM domain_assets
             WHERE workspace_id = 'workspace-local' AND entity_id = 'observed.test'",
            [],
        )
        .unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT count(*) FROM dns_zone_observations
                 WHERE workspace_id = 'workspace-local' AND entity_id = 'observed.test'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the operation-plan scenario keeps its full atomic lifecycle visible in one test"
)]
fn operations_require_an_approved_immutable_plan_and_real_item() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    connection
        .execute(
            "INSERT INTO domain_assets
             (workspace_id, entity_id, lifecycle_status, created_at, updated_at,
              local_commit_sequence)
             VALUES ('workspace-local', 'operation-target.test', 'active', ?1, ?1, 1)",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO local_provider_connections
             (workspace_id, connection_id, provider_kind, display_label, active_credential_changed_at)
             VALUES ('workspace-local', 'connection-1', 'cloudflare', 'DNS account', ?1)",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO operation_plans
             (workspace_id, plan_id, operation_kind, plan_hash, title, phase, risk_level,
              item_count, created_at, expires_at, approved_at, cancelled_at,
              local_commit_sequence)
             VALUES ('workspace-local', 'plan-1', 'dns_change', ?1, 'DNS change',
                     'planned', 'standard', 1, ?2, '2026-08-29T00:00:00Z', NULL, NULL, 1)",
            params!["0".repeat(64), TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO operation_plan_items
             (workspace_id, plan_id, item_id, ordinal, entity_id, connection_id,
              capability, field_path, old_value_json, new_value_json, precondition_json,
              risk_level, execution_mode, inclusion_status)
             VALUES ('workspace-local', 'plan-1', 'item-1', 0,
                     'operation-target.test', 'connection-1',
                     'dns_write', 'desiredNameservers', NULL, '[]', '{}',
                     'standard', 'automatic', 'included')",
            [],
        )
        .unwrap();
    let operation_sql = "INSERT INTO operations
         (workspace_id, operation_id, plan_id, idempotency_key, phase, requested_at,
          started_at, completed_at, local_commit_sequence)
         VALUES ('workspace-local', ?1, 'plan-1', ?2, 'queued', ?3, NULL, NULL, 1)";
    assert!(
        connection
            .execute(
                operation_sql,
                params!["operation-rejected", "key-rejected", TIMESTAMP]
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE operation_plans SET phase = 'executing', approved_at = ?1
             WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1'",
                [TIMESTAMP],
            )
            .is_err()
    );
    connection
        .execute(
            "UPDATE operation_plans SET phase = 'approved', approved_at = ?1
             WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1'",
            [TIMESTAMP],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "INSERT INTO operation_results
             (workspace_id, operation_id, plan_id, item_id, attempt_number,
              result_version, outcome, result_json, evidence_digest, observed_at)
             VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 1,
                     2, 'failed_final', '{}', ?1, ?2)",
                params!["2".repeat(64), TIMESTAMP],
            )
            .is_err()
    );
    connection
        .execute(operation_sql, params!["operation-1", "key-1", TIMESTAMP])
        .unwrap();
    connection
        .execute(
            operation_sql,
            params!["operation-retry-proof", "key-retry-proof", TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO operation_attempts
             (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
              request_digest, started_at, completed_at)
             VALUES ('workspace-local', 'operation-retry-proof', 'plan-1', 'item-1', 1,
                     'failed_retryable', ?1, ?2, ?2)",
            params!["3".repeat(64), TIMESTAMP],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "INSERT INTO operation_attempts
             (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
              request_digest, started_at, completed_at)
             VALUES ('workspace-local', 'operation-retry-proof', 'plan-1', 'item-1', 2,
                     'queued', ?1, NULL, NULL)",
                ["4".repeat(64)],
            )
            .is_err()
    );
    connection
        .execute(
            "INSERT INTO operation_attempts
             (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
              request_digest, started_at, completed_at)
             VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 1,
                     'outcome_unknown', ?1, ?2, ?2)",
            params!["0".repeat(64), TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO operation_results
             (workspace_id, operation_id, plan_id, item_id, attempt_number,
              result_version, outcome, result_json, evidence_digest, observed_at)
             VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 1,
                     1, 'outcome_unknown', '{}', ?1, ?2)",
            params!["1".repeat(64), TIMESTAMP],
        )
        .unwrap();
    assert!(
        connection
            .execute(
                "INSERT INTO operation_attempts
             (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
              request_digest, started_at, completed_at)
             VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 2,
                     'queued', ?1, NULL, NULL)",
                ["2".repeat(64)],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE operation_results SET result_json = '{\"rewritten\":true}'
             WHERE workspace_id = 'workspace-local' AND operation_id = 'operation-1'
               AND item_id = 'item-1' AND result_version = 1",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "INSERT INTO operation_plan_items
             (workspace_id, plan_id, item_id, ordinal, capability, precondition_json,
              risk_level, execution_mode, inclusion_status)
             VALUES ('workspace-local', 'plan-1', 'late-item', 1, 'dns_write', '{}',
                     'standard', 'manual', 'included')",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE operations SET plan_id = 'other-plan'
             WHERE workspace_id = 'workspace-local' AND operation_id = 'operation-1'",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE operation_plans SET plan_hash = ?1
             WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1'",
                ["1".repeat(64)],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "DELETE FROM operation_plan_items
             WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1' AND item_id = 'item-1'",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "INSERT INTO operation_attempts
             (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
              request_digest, started_at, completed_at)
             VALUES ('workspace-local', 'operation-1', 'plan-1', 'ghost-item', 1,
                     'queued', ?1, NULL, NULL)",
                ["0".repeat(64)],
            )
            .is_err()
    );
}

#[test]
fn rows_recorded_under_wire_version_2_keep_their_version_and_digest() {
    // ADR-0029 C1c2b: rows claimed or received before the local tables were rebuilt keep the
    // v2 digest they were recorded with; their wire identity is immutable.
    let mut database = database();
    let initial = DomainAssetWrite {
        entity_id: "legacy.test".to_owned(),
        note: None,
        portfolio_id: None,
        tags: vec![],
        target_price: None,
    };
    database
        .upsert_domain_asset("seed-legacy", TIMESTAMP, &initial)
        .unwrap();
    database
        .acknowledge_sync_mutation("seed-legacy", 1, "2026-08-28T00:00:01Z")
        .unwrap();
    let version = database
        .read_domain_detail("legacy.test")
        .unwrap()
        .asset
        .asset_version;
    database
        .edit_domain_asset(
            "legacy-claim",
            version,
            "device-local",
            7,
            "2026-08-28T00:01:00Z",
            &DomainAssetWrite {
                note: Some("legacy".to_owned()),
                ..initial
            },
            true,
        )
        .unwrap();
    let claimed = database
        .claim_sync_mutations_v2(
            "owner-1",
            "2026-08-28T00:02:00Z",
            "2026-08-28T00:03:00Z",
            256,
        )
        .unwrap();
    let wire: serde_json::Value = serde_json::from_str(&claimed[0].wire_mutation_json).unwrap();
    let legacy_digest = local_wire_digest(&wire, 2).unwrap();
    assert_ne!(legacy_digest, claimed[0].wire_mutation_digest);
    // Reproduce a row claimed before the rebuild: only a test can rewrite a claimed identity.
    let connection = database.store.raw_connection();
    connection
        .execute_batch("DROP TRIGGER sync_outbox_v2_wire_identity_immutable")
        .unwrap();
    connection
        .execute(
            "UPDATE sync_outbox SET wire_schema_version=2, wire_mutation_digest=?1
             WHERE mutation_id='legacy-claim'",
            [&legacy_digest],
        )
        .unwrap();
    let mut legacy_claim = claimed[0].clone();
    legacy_claim.wire_mutation_digest = legacy_digest.clone();
    database
        .defer_retryable_sync_batch_v2("owner-1", &[legacy_claim], "2026-08-28T00:02:00Z")
        .unwrap();
    let reclaimed = database
        .claim_sync_mutations_v2(
            "owner-2",
            "2026-08-28T00:10:00Z",
            "2026-08-28T00:11:00Z",
            256,
        )
        .unwrap();
    assert_eq!(reclaimed[0].wire_mutation_digest, legacy_digest);
    assert_eq!(
        reclaimed[0].wire_mutation_json,
        claimed[0].wire_mutation_json
    );
    let version: i64 = database
        .store
        .raw_connection()
        .query_row(
            "SELECT wire_schema_version FROM sync_outbox WHERE mutation_id='legacy-claim'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, 2);
    // Version 2 exists only for generation 1.
    let mut later = wire.clone();
    later["entityGeneration"] = serde_json::json!(2);
    assert_eq!(
        local_wire_digest(&later, 2),
        Err(BusinessDatabaseError::StorageRejected)
    );
    assert!(local_wire_digest(&later, 3).is_ok());
    assert_eq!(
        local_wire_digest(&wire, 4),
        Err(BusinessDatabaseError::StorageRejected)
    );
}

#[test]
fn a_page_item_that_is_not_the_acknowledged_echo_keeps_the_ordinary_checks() {
    let mut database = database();
    own_create(&mut database);
    own_delete(&mut database, "delete-local");
    let wires = acknowledge_claimed(&mut database, 1);
    let before = echo_state(&database);
    // Same mutation id, rewritten content: not the mutation Cloud accepted.
    let mut forged: serde_json::Value = serde_json::from_str(&wires[0]).unwrap();
    forged["changedFields"] = serde_json::json!([{"fieldPath": "note", "value": "forged"}]);
    assert!(
        pull_echoes(
            &mut database,
            0,
            &[forged.to_string(), wires[1].clone()],
            "c-1"
        )
        .is_err()
    );
    assert_eq!(echo_state(&database), before);
    // The genuine content at a revision Cloud did not acknowledge it at.
    let filler = generation_mutation(
        "other-create",
        "other.test",
        1,
        0,
        &serde_json::json!([{"fieldPath": "note", "value": "unrelated"}]),
    );
    assert!(
        pull_echoes(
            &mut database,
            0,
            &[filler.to_string(), wires[0].clone()],
            "c-2"
        )
        .is_err()
    );
    assert_eq!(echo_state(&database), before);
}

#[test]
fn resolving_after_local_projection_change_is_stale_and_zero_write() {
    let mut database = database();
    database
        .upsert_domain_asset(
            "local-seed",
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
    database
        .upsert_domain_asset(
            "local-change",
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "remote.test".to_owned(),
                note: Some("changed".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        )
        .unwrap();
    let result = database.resolve_sync_conflict(
        "resolution-stale",
        &candidate.conflict_id,
        1,
        candidate.candidate_version,
        candidate.remote_server_revision,
        &candidate.local_value_hash,
        "accept_remote",
        "device-local",
        1,
        TIMESTAMP,
    );
    assert_eq!(result, Err(BusinessDatabaseError::MutationStale));
    assert_eq!(
        database.read_portfolio().unwrap().domains[0]
            .note
            .as_deref(),
        Some("changed")
    );
}
