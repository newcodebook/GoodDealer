use super::*;

#[test]
fn cloudflare_projection_digest_matches_protocol_golden() {
    let projection = serde_json::json!({
        "schemaVersion": 1,
        "providerKind": "cloudflare",
        "observationCapability": "dns",
        "observationId": "123e4567-e89b-42d3-a456-426614174000",
        "entityId": "example.com",
        "leaseEpoch": 7,
        "sourceSequence": 1,
        "observedAt": "2026-09-15T00:00:00Z",
        "availability": "available",
        "zoneStatus": "active",
        "counts": { "a": 1, "aaaa": 0, "cname": 2, "txt": 3, "proxied": 1 },
    });
    assert_eq!(
        canonical_cloudflare_projection_digest(&projection).unwrap(),
        "5600723db76bdce097579641d89e0aaa517b28edd557fc41dd5346710c93ca55"
    );
}

#[test]
fn cloudflare_connection_read_applies_the_connection_label_rule() {
    let mut database = database();
    assert_eq!(database.read_cloudflare_connection().unwrap(), (None, None));
    let insert = "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,validation_status) VALUES ('workspace-local','connection-1','cloudflare',?1,?2,'valid')";
    database
        .store
        .fixture_connection()
        .execute(insert, rusqlite::params!["Cloudflare DNS", TIMESTAMP])
        .unwrap();
    assert_eq!(
        database.read_cloudflare_connection().unwrap(),
        (
            Some("connection-1".to_owned()),
            Some("Cloudflare DNS".to_owned())
        )
    );
    // A label written outside the create path that breaks the shared rule (a format
    // character, a control character, or more than 120 UTF-16 units) fails the read closed.
    for label in [
        "Cloud\u{200B}flare".to_owned(),
        "Cloud\u{7}flare".to_owned(),
        "a".repeat(121),
    ] {
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE local_provider_connections SET display_label=?1 WHERE connection_id='connection-1'",
                [&label],
            )
            .unwrap();
        assert!(matches!(
            database.read_cloudflare_connection(),
            Err(BusinessDatabaseError::StorageRejected)
        ));
    }
}

#[test]
#[allow(clippy::too_many_lines)]
fn cloudflare_projection_claim_reclaim_and_ack_are_exactly_fenced() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','projection.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-projection','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let _ = connection;
    let pending = database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000011".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000012".into(),
            entity_id: "projection.test".into(),
            connection_id: "cf-projection".into(),
            lease_epoch: 7,
            observed_at: TIMESTAMP.into(),
            zone_name_ascii: "projection.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();
    let first = database
        .claim_cloudflare_dns_projections_guarded(
            "owner-a",
            TIMESTAMP,
            "2026-09-15T00:01:00Z",
            1,
            || Ok(()),
        )
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(first.delivery_attempt_fence, 1);
    let second = database
        .claim_cloudflare_dns_projections_guarded(
            "owner-b",
            "2026-09-15T00:02:00Z",
            "2026-09-15T00:03:00Z",
            1,
            || Ok(()),
        )
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(second.delivery_attempt_fence, 2);
    let acknowledgement = CloudflareDnsProjectionAcknowledgement {
        observation_id: pending.observation_id,
        lease_epoch: pending.lease_epoch,
        source_sequence: pending.source_sequence,
        delivery_attempt_fence: second.delivery_attempt_fence,
        canonical_request_digest: pending.canonical_request_digest,
        observation_sequence: 9,
        disposition: "current".into(),
    };
    let mut old = acknowledgement.clone();
    old.delivery_attempt_fence = first.delivery_attempt_fence;
    assert!(
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                "owner-a",
                &old,
                "2026-09-15T00:02:01Z",
                || Ok(()),
            )
            .is_err()
    );
    let mut wrong = acknowledgement.clone();
    wrong.canonical_request_digest = "f".repeat(64);
    assert!(
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                "owner-b",
                &wrong,
                "2026-09-15T00:02:01Z",
                || Ok(()),
            )
            .is_err()
    );
    database
        .acknowledge_cloudflare_dns_projection_guarded(
            "owner-b",
            &acknowledgement,
            "2026-09-15T00:02:01Z",
            || Ok(()),
        )
        .unwrap();
    database
        .acknowledge_cloudflare_dns_projection_guarded(
            "owner-b",
            &acknowledgement,
            "2026-09-15T00:02:02Z",
            || Ok(()),
        )
        .unwrap();
    let mut replay_mismatch = acknowledgement;
    replay_mismatch.disposition = "stale".into();
    assert!(
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                "owner-b",
                &replay_mismatch,
                "2026-09-15T00:02:03Z",
                || Ok(()),
            )
            .is_err()
    );
}

#[test]
fn cloudflare_projection_retry_deferral_persists_exact_deadline_and_error() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','retry.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-retry','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let pending = database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000031".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000032".into(),
            entity_id: "retry.test".into(),
            connection_id: "cf-retry".into(),
            lease_epoch: 7,
            observed_at: TIMESTAMP.into(),
            zone_name_ascii: "retry.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();
    let claimed = database
        .claim_cloudflare_dns_projections_guarded(
            "retry-owner",
            TIMESTAMP,
            "2026-09-15T00:01:00Z",
            1,
            || Ok(()),
        )
        .unwrap()
        .pop()
        .unwrap();
    let deadline = database
        .defer_cloudflare_dns_projection_guarded(
            "retry-owner",
            &claimed,
            "2026-09-15T00:00:00Z",
            || Ok(()),
        )
        .unwrap();
    assert_eq!(deadline, 1_789_430_402);
    let row: (String, Option<String>, Option<String>) = database.store.raw_connection().query_row("SELECT state,next_attempt_at,last_error_code FROM cloudflare_dns_projection_outbox WHERE observation_id=?1", [pending.observation_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
    assert_eq!(row.0, "pending");
    assert_eq!(row.1.as_deref(), Some("2026-09-15T00:00:02Z"));
    assert_eq!(row.2.as_deref(), Some("transport_retryable"));
}

#[test]
fn cloudflare_projection_wake_returns_the_ordered_head_deadline() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    connection
        .execute(
            "INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
             VALUES ('workspace-local','head.test','active',?1,?1,1)",
            [TIMESTAMP],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
             VALUES ('workspace-local','later.test','active',?1,?1,2)",
            [TIMESTAMP],
        )
        .unwrap();
    let projection = r#"{"schemaVersion":1,"entityId":"head.test"}"#;
    let digest =
        canonical_cloudflare_projection_digest(&serde_json::from_str(projection).unwrap()).unwrap();
    connection
        .execute(
            "INSERT INTO cloudflare_dns_projection_outbox
             (workspace_id,observation_id,entity_id,lease_epoch,source_sequence,observed_at,
              projection_json,canonical_request_digest,state,next_attempt_at)
             VALUES ('workspace-local',?1,'head.test',1,1,?2,?3,?4,'pending',?5)",
            rusqlite::params![
                "00000000-0000-4000-8000-000000000081",
                TIMESTAMP,
                projection,
                digest,
                "2026-09-15T00:10:00Z"
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO cloudflare_dns_projection_outbox
             (workspace_id,observation_id,entity_id,lease_epoch,source_sequence,observed_at,
              projection_json,canonical_request_digest,state)
             VALUES ('workspace-local',?1,'later.test',2,1,?2,?3,?4,'pending')",
            rusqlite::params![
                "00000000-0000-4000-8000-000000000082",
                TIMESTAMP,
                projection,
                digest
            ],
        )
        .unwrap();
    assert_eq!(
        database
            .next_cloudflare_projection_attempt_unix_seconds(1_789_430_400)
            .unwrap(),
        Some(1_789_431_000)
    );
    assert!(
        database
            .claim_cloudflare_dns_projections_guarded(
                "head-owner",
                "2026-09-15T00:00:00Z",
                "2026-09-15T00:01:00Z",
                2,
                || Ok(()),
            )
            .unwrap()
            .is_empty()
    );
    let later_state: String = database
        .store
        .raw_connection()
        .query_row(
            "SELECT state FROM cloudflare_dns_projection_outbox
             WHERE observation_id='00000000-0000-4000-8000-000000000082'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(later_state, "pending");
}

#[test]
fn cloudflare_projection_commit_guard_rolls_back_claim_and_ack() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','guard.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-guard','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let pending = database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000021".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000022".into(),
            entity_id: "guard.test".into(),
            connection_id: "cf-guard".into(),
            lease_epoch: 7,
            observed_at: TIMESTAMP.into(),
            zone_name_ascii: "guard.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();
    let failed_claim = database.claim_cloudflare_dns_projections_guarded(
        "guard-owner",
        TIMESTAMP,
        "2026-09-15T00:01:00Z",
        1,
        || Err(BusinessDatabaseError::WorkspaceRejected),
    );
    assert!(failed_claim.is_err());
    let claimed = database
        .claim_cloudflare_dns_projections_guarded(
            "guard-owner",
            TIMESTAMP,
            "2026-09-15T00:01:00Z",
            1,
            || Ok(()),
        )
        .unwrap()
        .pop()
        .unwrap();
    let ack = CloudflareDnsProjectionAcknowledgement {
        observation_id: pending.observation_id,
        lease_epoch: pending.lease_epoch,
        source_sequence: pending.source_sequence,
        delivery_attempt_fence: claimed.delivery_attempt_fence,
        canonical_request_digest: pending.canonical_request_digest,
        observation_sequence: 1,
        disposition: "current".into(),
    };
    assert!(
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                "guard-owner",
                &ack,
                "2026-09-15T00:01:01Z",
                || Err(BusinessDatabaseError::WorkspaceRejected),
            )
            .is_err()
    );
    database
        .acknowledge_cloudflare_dns_projection_guarded(
            "guard-owner",
            &ack,
            "2026-09-15T00:01:02Z",
            || Ok(()),
        )
        .unwrap();
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "the observation fixture is written out in full beside the repair it exercises"
)]
fn a_rejected_zone_observation_is_quarantined_alone_and_counts_follow() {
    // ADR-0019: only the failing part of a DNS row is quarantined. This asset has no binding,
    // so its observation alone is set aside and the asset reads as unobserved, with the
    // workspace counts derived from the same joins.
    let mut database = database();
    let connection = database.store.fixture_connection();
    for entity in ["observed.test", "plain.test"] {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',?2,?2,1)", rusqlite::params![entity, TIMESTAMP]).unwrap();
    }
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-observe','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let _ = connection;
    database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000001".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000002".into(),
            entity_id: "observed.test".into(),
            connection_id: "cf-observe".into(),
            lease_epoch: 3,
            observed_at: TIMESTAMP.into(),
            zone_name_ascii: "observed.test".into(),
            authoritative_nameservers: vec!["ada.ns.cloudflare.com".into()],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![
                CloudflareDnsRecordWrite {
                    record_key: "r1".into(),
                    record_type: "A".into(),
                    owner_name_ascii: "observed.test".into(),
                    ttl_seconds: None,
                    priority: None,
                    canonical_value: "192.0.2.1".into(),
                    proxied: Some(true),
                },
                CloudflareDnsRecordWrite {
                    record_key: "r2".into(),
                    record_type: "TXT".into(),
                    owner_name_ascii: "observed.test".into(),
                    ttl_seconds: Some(300),
                    priority: None,
                    canonical_value: "v=spf1 -all".into(),
                    proxied: None,
                },
            ],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();

    let connection = database.store.fixture_connection();
    connection
        .execute_batch(
            "DROP TRIGGER dns_zone_observations_no_update;
             UPDATE dns_zone_observations
             SET authoritative_nameservers_json = '[\"bad\\u0007.ns\"]';",
        )
        .unwrap();
    let _ = connection;
    assert_eq!(
        database
            .read_settings()
            .unwrap()
            .storage_integrity
            .rejected_dns_rows,
        1
    );
    assert!(matches!(
        database.read_dns_health(0, 10, ""),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
    assert_eq!(
        database.repair_stored_rows_guarded(
            crate::StorageRepairKind::RejectedDnsRows,
            TIMESTAMP,
            || Ok(()),
        ),
        Ok(1)
    );
    let kinds: Vec<(String, String)> = database
        .store
        .raw_connection()
        .prepare("SELECT repair_kind, row_key FROM storage_repair_receipts")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        kinds,
        [(
            "dns_zone_observation".to_owned(),
            "00000000-0000-4000-8000-000000000001".to_owned()
        )]
    );
    let snapshot = database.read_dns_health(0, 10, "").unwrap();
    assert_eq!(snapshot.observed_count, 0);
    assert_eq!(snapshot.warning_count, 0);
    assert!(
        snapshot
            .window
            .rows
            .iter()
            .all(|row| row.observation.is_none() && row.zone_binding.is_none())
    );
    assert_eq!(
        database
            .read_settings()
            .unwrap()
            .storage_integrity
            .rejected_dns_rows,
        0
    );
}

#[test]
#[allow(clippy::too_many_lines)]
fn dns_health_reports_observed_zone_facts_without_health_verdicts() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    for entity in ["observed.test", "plain.test"] {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',?2,?2,1)", rusqlite::params![entity, TIMESTAMP]).unwrap();
    }
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-observe','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let _ = connection;
    database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000001".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000002".into(),
            entity_id: "observed.test".into(),
            connection_id: "cf-observe".into(),
            lease_epoch: 3,
            observed_at: TIMESTAMP.into(),
            zone_name_ascii: "observed.test".into(),
            authoritative_nameservers: vec!["ada.ns.cloudflare.com".into()],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![
                CloudflareDnsRecordWrite {
                    record_key: "r1".into(),
                    record_type: "A".into(),
                    owner_name_ascii: "observed.test".into(),
                    ttl_seconds: None,
                    priority: None,
                    canonical_value: "192.0.2.1".into(),
                    proxied: Some(true),
                },
                CloudflareDnsRecordWrite {
                    record_key: "r2".into(),
                    record_type: "TXT".into(),
                    owner_name_ascii: "observed.test".into(),
                    ttl_seconds: Some(300),
                    priority: None,
                    canonical_value: "v=spf1 -all".into(),
                    proxied: None,
                },
            ],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();

    let snapshot = database.read_dns_health(0, 10, "").unwrap();
    assert_eq!(snapshot.kind, "dns_health");
    assert_eq!(snapshot.total_rows, 2);
    let current = snapshot.window.rows[0]
        .observation
        .as_ref()
        .is_some_and(|zone| {
            zone.availability == "available"
                && zone.evidence_status == "confirmed"
                && zone.zone_status == "active"
        });
    assert_eq!(
        (
            snapshot.asset_count,
            snapshot.observed_count,
            snapshot.warning_count
        ),
        (2, 1, u32::from(!current))
    );
    // The search narrows the rows to a domain prefix; the counts still cover every asset.
    let searched = database.read_dns_health(0, 10, "obs").unwrap();
    assert_eq!(
        (
            searched.total_rows,
            searched.asset_count,
            searched.observed_count
        ),
        (1, 2, 1)
    );
    assert_eq!(searched.window.rows[0].entity_id, "observed.test");
    assert_eq!(
        database.read_dns_health(0, 10, "zzz").unwrap().total_rows,
        0
    );
    // Like the asset library, the prefix is case-folded and anything else non-canonical fails.
    assert_eq!(
        database.read_dns_health(0, 10, "Obs").unwrap().total_rows,
        1
    );
    for hostile in ["ob s", "\u{e9}", "obs%", &"a".repeat(65)] {
        assert!(
            database.read_dns_health(0, 10, hostile).is_err(),
            "{hostile:?} must be rejected"
        );
    }
    let rows = &snapshot.window.rows;
    assert_eq!(
        rows.iter()
            .map(|row| row.entity_id.as_str())
            .collect::<Vec<_>>(),
        ["observed.test", "plain.test"]
    );
    let observation = rows[0].observation.as_ref().unwrap();
    assert_eq!(observation.zone_label, "observed.test");
    assert_eq!(
        observation.authoritative_nameservers,
        ["ada.ns.cloudflare.com"]
    );
    assert_eq!(
        (observation.record_counts.a, observation.record_counts.txt),
        (1, 1)
    );
    assert!(rows[1].observation.is_none() && rows[1].zone_binding.is_none());
    // Record values and Provider identifiers never reach this projection.
    let wire = serde_json::to_string(&snapshot).unwrap();
    for secret in [
        "192.0.2.1",
        "v=spf1",
        "cf-observe",
        "00000000-0000-4000-8000-000000000001",
    ] {
        assert!(
            !wire.contains(secret),
            "{secret} leaked into the DNS health projection"
        );
    }

    assert_eq!(
        database
            .read_dns_health(1, 10, "")
            .unwrap()
            .window
            .rows
            .len(),
        1
    );
    for (start, size) in [(0, 0), (0, 201), (1_000_001, 1)] {
        assert!(matches!(
            database.read_dns_health(start, size, ""),
            Err(BusinessDatabaseError::WindowRejected)
        ));
    }

    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,verified_at,last_observed_at,created_at,updated_at) VALUES ('workspace-local','observed.test','cf-observe','cloudflare','zone',?1,?2,'observed.test',1,2,'verified',?3,?3,?3,?3)", rusqlite::params!["d".repeat(64), "e".repeat(64), TIMESTAMP]).unwrap();
    let _ = connection;
    let binding = database.read_dns_health(0, 1, "").unwrap().window.rows[0]
        .zone_binding
        .clone()
        .unwrap();
    assert_eq!(
        (
            binding.connection_label.as_str(),
            binding.validation_status.as_str()
        ),
        ("Cloudflare", "verified")
    );
    // An asset bound on another platform but carrying a Cloudflare observation: the observation
    // says nothing about the bound Zone, so it is neither reported for the row nor counted.
    {
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','rebound.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','spaceship-1','spaceship','Spaceship',?1,'[\"dns\"]')", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,created_at,updated_at) VALUES ('workspace-local','rebound.test','spaceship-1','spaceship','zone',?1,?2,'rebound.test',1,2,'unverified',?3,?3)", rusqlite::params!["f".repeat(64), "e".repeat(64), TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO cloudflare_dns_projection_heads (workspace_id,entity_id,lease_epoch,source_sequence,observation_id,observed_at,projection_digest,updated_at) SELECT workspace_id,'rebound.test',lease_epoch,source_sequence,observation_id,observed_at,projection_digest,updated_at FROM cloudflare_dns_projection_heads WHERE entity_id='observed.test'", []).unwrap();
    }
    let rebound = database.read_dns_health(0, 10, "").unwrap();
    let row = &rebound.window.rows[2];
    assert_eq!(row.entity_id, "rebound.test");
    assert!(row.observation.is_none());
    assert_eq!((rebound.asset_count, rebound.observed_count), (3, 1));
    // A label that would smuggle control characters into the Renderer fails the whole read.
    database
        .store
        .fixture_connection()
        .execute(
            "UPDATE local_provider_connections SET display_label='Cloud'||char(7)||'flare'",
            [],
        )
        .unwrap();
    assert!(matches!(
        database.read_dns_health(0, 10, ""),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
}

#[test]
fn dns_health_reports_zone_bindings_on_any_launch_platform_and_rejects_others() {
    const ASSET: &str = "INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',?2,?2,1)";
    const CONNECTION: &str = "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local',?1,?2,?3,?4,'[\"dns\"]')";
    const BINDING: &str = "INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,created_at,updated_at) VALUES ('workspace-local',?1,?2,?3,'zone',?4,?5,?1,1,2,'unverified',?6,?6)";
    let bind = |database: &mut BusinessDatabase, entity: &str, connection_id: &str, kind: &str| {
        database
            .store
            .fixture_connection()
            .execute(
                BINDING,
                rusqlite::params![
                    entity,
                    connection_id,
                    kind,
                    "d".repeat(64),
                    "e".repeat(64),
                    TIMESTAMP
                ],
            )
            .unwrap();
    };
    let mut database = database();
    {
        let connection = database.store.fixture_connection();
        for entity in ["alpha.test", "beta.test"] {
            connection
                .execute(ASSET, rusqlite::params![entity, TIMESTAMP])
                .unwrap();
        }
        for (id, kind, label) in [
            ("spaceship-1", "spaceship", "Spaceship"),
            ("porkbun-1", "porkbun", "Porkbun"),
        ] {
            connection
                .execute(CONNECTION, rusqlite::params![id, kind, label, TIMESTAMP])
                .unwrap();
        }
    }
    bind(&mut database, "alpha.test", "spaceship-1", "spaceship");
    let rows = database.read_dns_health(0, 10, "").unwrap().window.rows;
    let binding = rows[0].zone_binding.as_ref().unwrap();
    assert_eq!(
        (
            binding.provider_kind.as_str(),
            binding.connection_label.as_str()
        ),
        ("spaceship", "Spaceship")
    );
    // A non-Cloudflare Zone has no composed observation, so none is reported for it.
    assert!(rows[0].observation.is_none());

    // A binding that names a platform other than its connection's fails the whole read, also
    // from a page or a search that does not include it: the counts would still include it.
    allow_legacy_rows(database.store.fixture_connection());
    bind(&mut database, "beta.test", "porkbun-1", "spaceship");
    for (start, size, query) in [(0, 10, ""), (0, 1, ""), (0, 10, "alpha")] {
        assert!(
            matches!(
                database.read_dns_health(start, size, query),
                Err(BusinessDatabaseError::ProjectionRejected)
            ),
            "{start} {size} {query:?}"
        );
    }

    // A platform outside ADR-0027 never reaches the Renderer.
    let mut database = self::database();
    {
        let connection = database.store.fixture_connection();
        connection
            .execute(ASSET, rusqlite::params!["alpha.test", TIMESTAMP])
            .unwrap();
        connection
            .execute(
                CONNECTION,
                rusqlite::params!["other-1", "example", "Example", TIMESTAMP],
            )
            .unwrap();
    }
    bind(&mut database, "alpha.test", "other-1", "example");
    assert!(matches!(
        database.read_dns_health(0, 10, ""),
        Err(BusinessDatabaseError::ProjectionRejected)
    ));
}

#[test]
fn storage_rejects_mismatched_bindings_and_malformed_expiry_dates() {
    const BINDING: &str = "INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,local_commit_sequence,validation_status,created_at,updated_at) VALUES ('workspace-local',?1,'porkbun-1',?2,'zone',?3,?3,?1,1,2,'unverified',?4,?4)";
    let mut database = database();
    let connection = database.store.fixture_connection();
    for entity in ["alpha.test", "beta.test"] {
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?1,'active',?2,?2,1)", rusqlite::params![entity, TIMESTAMP]).unwrap();
    }
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json) VALUES ('workspace-local','porkbun-1','porkbun','Porkbun',?1,'[\"dns\"]')", [TIMESTAMP]).unwrap();
    let bind = |entity: &str, kind: &str| {
        connection.execute(
            BINDING,
            rusqlite::params![entity, kind, "d".repeat(64), TIMESTAMP],
        )
    };
    // A binding must name its connection's platform.
    assert!(bind("alpha.test", "spaceship").is_err());
    bind("alpha.test", "porkbun").unwrap();
    // Once bound, the connection's platform cannot change underneath the binding.
    assert!(
        connection
            .execute(
                "UPDATE local_provider_connections SET provider_kind = 'spaceship'",
                [],
            )
            .is_err()
    );
    connection
        .execute(
            "UPDATE local_provider_connections SET display_label = 'Renamed'",
            [],
        )
        .unwrap();

    // A recorded expiry is a real calendar date or nothing, on insert and on update.
    for (index, (expires_on, valid)) in [
        (Some("2028-02-29"), true),
        (None, true),
        (Some("2026-02-30"), false),
        (Some("2026-1-10"), false),
        (Some("2026-11-10T00:00:00Z"), false),
        (Some(""), false),
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            connection
                .execute(
                    "UPDATE domain_assets SET expires_on = ?1 WHERE entity_id = 'beta.test'",
                    [expires_on],
                )
                .is_ok(),
            valid,
            "{expires_on:?}"
        );
        assert_eq!(
            connection
                .execute(
                    "INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,expires_on,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local',?3,'active',?1,?2,?2,1)",
                    rusqlite::params![expires_on, TIMESTAMP, format!("gamma-{index}.test")],
                )
                .is_ok(),
            valid,
            "{expires_on:?}"
        );
    }
}

#[test]
#[allow(clippy::too_many_lines)]
fn cloudflare_dns_observation_atomically_writes_local_evidence_and_count_projection() {
    let mut database = database();
    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','observed.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
    connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-observe','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let _ = connection;
    let result = database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000001".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000002".into(),
            entity_id: "observed.test".into(),
            connection_id: "cf-observe".into(),
            lease_epoch: 3,
            observed_at: TIMESTAMP.into(),
            zone_name_ascii: "observed.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![CloudflareDnsRecordWrite {
                record_key: "r1".into(),
                record_type: "A".into(),
                owner_name_ascii: "observed.test".into(),
                ttl_seconds: None,
                priority: None,
                canonical_value: "192.0.2.1".into(),
                proxied: Some(true),
            }],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();
    assert!(!result.projection_json.contains("192.0.2.1"));
    assert_eq!(
        database
            .pending_cloudflare_dns_projections(10)
            .unwrap()
            .len(),
        1
    );
    let connection = database.store.fixture_connection();
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM dns_record_observations", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        1
    );
    assert_eq!(connection.query_row("SELECT status FROM provider_observation_targets WHERE observation_run_id='00000000-0000-4000-8000-000000000002'", [], |row| row.get::<_,String>(0)).unwrap(), "succeeded");
    assert_eq!(
        connection
            .query_row(
                "SELECT source_sequence FROM cloudflare_dns_source_heads WHERE entity_id='observed.test'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    let _ = connection;
    database.store.fixture_connection().execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-observe-2','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
    let same_entity = database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000003".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000004".into(),
            entity_id: "observed.test".into(),
            connection_id: "cf-observe-2".into(),
            lease_epoch: 3,
            observed_at: "2026-08-28T00:00:01Z".into(),
            zone_name_ascii: "observed.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![],
            provider_version_token: "v2".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();
    assert_eq!(same_entity.source_sequence, 2);
    let connection = database.store.fixture_connection();
    connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','other.test','active',?1,?1,2)", [TIMESTAMP]).unwrap();
    let _ = connection;
    let new_entity = database
        .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000005".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000006".into(),
            entity_id: "other.test".into(),
            connection_id: "cf-observe-2".into(),
            lease_epoch: 3,
            observed_at: "2026-08-28T00:00:02Z".into(),
            zone_name_ascii: "other.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![],
            provider_version_token: "v3".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();
    assert_eq!(new_entity.source_sequence, 1);
}

#[test]
fn dns_health_offers_a_bind_exactly_when_the_bind_would_be_admitted() {
    let bindable = |database: &TestDatabase| {
        database.read_dns_health(0, 10, "").unwrap().window.rows[0].bindable
    };
    // Every evidence refusal the bind makes: revoked or invalid credentials, a changed
    // credential generation or Zone, an archived asset, unavailable or uncommitted evidence.
    let refusals = [
        "UPDATE cloudflare_dns_staged_batches SET observation_availability='unavailable'",
        "UPDATE cloudflare_dns_staged_batches SET visibility='staged'",
        "UPDATE domain_assets SET lifecycle_status='archived' WHERE entity_id='example.com'",
        "UPDATE local_provider_connections SET lifecycle_status='invalid'",
        "UPDATE local_provider_connections SET credential_use_state='revocation_pending'",
        "UPDATE local_provider_connections SET credential_use_state='remediation_required'",
        "UPDATE local_provider_connections SET active_credential_zone_digest='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
        "UPDATE cloudflare_credential_roots SET known_envelope_generation=2,highest_resolved_generation=2,head_ledger_generation=2",
    ];
    for mutation in refusals {
        let mut database = binding_database();
        assert!(bindable(&database), "fixture is bindable before {mutation}");
        database
            .store
            .fixture_connection()
            .execute_batch(&format!(
                "PRAGMA foreign_keys=OFF; DROP TRIGGER cloudflare_dns_staged_batch_immutable; {mutation}"
            ))
            .unwrap();
        assert!(!bindable(&database), "{mutation}");
        assert_eq!(
            database.bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(())),
            Err(BusinessDatabaseError::ProviderBindingUnavailable),
            "{mutation}"
        );
    }

    // Once bound, the live binding is not offered again; detached with the same identity it is,
    // and detached under another Zone it is not, because the bind would refuse the change.
    let mut database = binding_database();
    database
        .bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(()))
        .unwrap();
    assert!(!bindable(&database));
    let connection = database.store.fixture_connection();
    connection
        .execute_batch(
            "UPDATE domain_asset_provider_bindings SET validation_status='detached', verified_at=NULL",
        )
        .unwrap();
    assert!(bindable(&database));
    database
        .store
        .fixture_connection()
        .execute_batch(
            "PRAGMA foreign_keys=OFF;
             DROP TRIGGER domain_asset_provider_bindings_identity_immutable;
             UPDATE domain_asset_provider_bindings SET resource_binding_digest='dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'",
        )
        .unwrap();
    assert!(!bindable(&database));
    assert_eq!(
        database.bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(())),
        Err(BusinessDatabaseError::MutationConflict)
    );
}

#[test]
fn provider_binding_rejections_are_zero_write() {
    let cases = [
        (
            "unavailable observation",
            "UPDATE cloudflare_dns_staged_batches SET observation_availability='unavailable'",
        ),
        (
            "uncommitted observation",
            "UPDATE cloudflare_dns_staged_batches SET visibility='staged'",
        ),
        (
            "tombstoned asset",
            "UPDATE domain_assets SET lifecycle_status='archived',deleted_at='2026-08-28T00:00:00Z' WHERE entity_id='example.com'",
        ),
        (
            "wrong workspace asset",
            "UPDATE domain_assets SET workspace_id='workspace-other' WHERE entity_id='example.com'",
        ),
        (
            "inactive connection",
            "UPDATE local_provider_connections SET lifecycle_status='invalid'",
        ),
        (
            "remediation credential",
            "UPDATE local_provider_connections SET credential_use_state='remediation_required'",
        ),
        (
            "resource mismatch",
            "UPDATE cloudflare_dns_staged_batches SET zone_name_ascii='other.test'",
        ),
        (
            "zone mismatch",
            "UPDATE local_provider_connections SET active_credential_zone_digest='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
        ),
        (
            "generation mismatch",
            "UPDATE cloudflare_credential_roots SET known_envelope_generation=2,highest_resolved_generation=2,head_ledger_generation=2",
        ),
    ];
    for (label, mutation) in cases {
        let mut database = binding_database();
        // Corrupt the otherwise genuine fixture after provisioning to exercise the query filters.
        database
            .store
            .fixture_connection()
            .execute_batch(
                "PRAGMA foreign_keys=OFF; DROP TRIGGER cloudflare_dns_staged_batch_immutable;",
            )
            .unwrap();
        database
            .store
            .fixture_connection()
            .execute_batch(mutation)
            .unwrap();
        let before = database.provider_binding_snapshot_for_test();
        assert_eq!(
            database.bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(())),
            Err(BusinessDatabaseError::ProviderBindingUnavailable),
            "{label}"
        );
        assert_eq!(
            database.provider_binding_snapshot_for_test(),
            before,
            "{label}"
        );
    }
    for (allow_new, sequence_available, error) in [
        (false, true, BusinessDatabaseError::MutationStale),
        (true, false, BusinessDatabaseError::SequenceExhausted),
    ] {
        let mut database = binding_database();
        let before = database.provider_binding_snapshot_for_test();
        assert_eq!(
            database.bind_latest_cloudflare_zone(
                "example.com",
                allow_new,
                sequence_available,
                TIMESTAMP,
                || Ok(())
            ),
            Err(error)
        );
        assert_eq!(database.provider_binding_snapshot_for_test(), before);
    }
}
