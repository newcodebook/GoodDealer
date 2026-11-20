use super::*;
use crate::LocalDatabaseKey;
const AT: &str = "2026-11-20T00:00:00Z";
fn fixture() -> (
    tempfile::TempDir,
    BusinessDatabase,
    ExecutionEvidenceContext,
) {
    let dir = crate::test_tempdir::tempdir().unwrap();
    let db = BusinessDatabase::open(
        &dir.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    let (context, _) = super::super::execution_evidence::test_context("workspace-local", AT);
    (dir, db, context)
}
#[cfg(feature = "afternic-controlled-acceptance")]
fn bind_one(db: &mut BusinessDatabase, e: &ExecutionEvidenceContext) -> AfternicConnectionSeed {
    db.prepare_afternic_connection_with_acceptance(
        "Acceptance",
        &"a".repeat(64),
        AT,
        Some(e),
        || Ok(()),
    )
    .unwrap()
}
fn count(db: &BusinessDatabase, table: &str) -> i64 {
    db.store
        .raw_connection()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
#[test]
fn controlled_acceptance_default_build_does_not_admit_or_persist_an_override() {
    if AFTERNIC_ACCEPTANCE_ENABLED {
        return;
    }
    let (_dir, mut db, e) = fixture();
    assert!(db.afternic_controlled_acceptance(&e, true).is_err());
    assert!(
        db.prepare_afternic_connection_with_acceptance(
            "Acceptance",
            &"a".repeat(64),
            AT,
            Some(&e),
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(count(&db, "afternic_controlled_acceptance_runs"), 0);
    assert_eq!(count(&db, "local_provider_connections"), 0);
}
#[cfg(feature = "afternic-controlled-acceptance")]
#[test]
fn controlled_acceptance_binding_is_atomic_immutable_and_cannot_bind_twice() {
    let (_dir, mut db, e) = fixture();
    assert!(
        db.afternic_controlled_acceptance(&e, true)
            .unwrap()
            .connection_id
            .is_none()
    );
    assert!(db.afternic_controlled_acceptance(&e, false).is_err());
    assert!(
        db.prepare_afternic_connection_with_acceptance(
            "Acceptance",
            &"a".repeat(64),
            AT,
            Some(&e),
            || Err::<(), _>(BusinessDatabaseError::MutationStale)
        )
        .is_err()
    );
    assert_eq!(count(&db, "afternic_controlled_acceptance_runs"), 0);
    assert_eq!(count(&db, "local_provider_connections"), 0);
    let seed = bind_one(&mut db, &e);
    assert_eq!(
        db.afternic_controlled_acceptance(&e, false)
            .unwrap()
            .connection_id
            .as_deref(),
        Some(seed.connection_id.as_str())
    );
    assert!(
        db.prepare_afternic_connection_with_acceptance(
            "Second",
            &"a".repeat(64),
            AT,
            Some(&e),
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(count(&db, "local_provider_connections"), 1);
    for sql in [
        "DELETE FROM afternic_controlled_acceptance_runs",
        "UPDATE afternic_controlled_acceptance_runs SET active_lease_epoch=2",
        "UPDATE afternic_controlled_acceptance_runs SET expires_at='2099-12-31T23:59:59Z'",
    ] {
        assert!(db.store.raw_connection().execute_batch(sql).is_err());
    }
}
#[cfg(feature = "afternic-controlled-acceptance")]
#[test]
fn controlled_acceptance_rejects_foreign_identity_epoch_time_and_scope() {
    let (_dir, mut db, e) = fixture();
    let seed = bind_one(&mut db, &e);
    for field in [
        "account",
        "workspace",
        "device",
        "lease",
        "credential",
        "expired",
        "before_binding",
    ] {
        let mut wrong = e.clone();
        match field {
            "account" => wrong.account_id = "foreign".into(),
            "workspace" => wrong.workspace_id = "foreign".into(),
            "device" => wrong.source_device_id = "foreign".into(),
            "lease" => wrong.active_lease_epoch += 1,
            "credential" => wrong.credential_epoch += 1,
            "expired" => wrong.occurred_at = AFTERNIC_ACCEPTANCE_EXPIRES.into(),
            _ => wrong.occurred_at = "2026-11-19T23:59:59Z".into(),
        }
        assert!(
            db.afternic_controlled_acceptance(&wrong, true).is_err(),
            "{field}"
        );
    }
    db.require_afternic_controlled_targets(&e, &seed.connection_id, [DOMAIN])
        .unwrap();
    for domain in ["other.test", "WECIN.COM", "wecin.com.", ""] {
        assert!(
            db.require_afternic_controlled_targets(&e, &seed.connection_id, [domain])
                .is_err()
        );
    }
    let other = db
        .prepare_afternic_connection("Other", &"a".repeat(64), AT, || Ok(()))
        .unwrap();
    assert!(
        db.require_afternic_controlled_targets(&e, &other.connection_id, [DOMAIN])
            .is_err()
    );
    db.revoke_afternic_connection(&seed, AT, || Ok(())).unwrap();
    assert!(db.afternic_controlled_acceptance(&e, true).is_err());
    assert_eq!(count(&db, "afternic_controlled_acceptance_runs"), 1);
}
#[cfg(feature = "afternic-controlled-acceptance")]
#[test]
fn controlled_acceptance_sqlcipher_reopen_retains_exact_binding_without_renewal() {
    let (dir, mut db, e) = fixture();
    let seed = bind_one(&mut db, &e);
    drop(db);
    let db = BusinessDatabase::open(
        &dir.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(
        db.afternic_controlled_acceptance(&e, false)
            .unwrap()
            .connection_id
            .as_deref(),
        Some(seed.connection_id.as_str())
    );
    let mut expired = e.clone();
    expired.occurred_at = AFTERNIC_ACCEPTANCE_EXPIRES.into();
    assert!(db.afternic_controlled_acceptance(&expired, false).is_err());
    assert!(
        !std::fs::read(dir.path().join("workspace.db"))
            .unwrap()
            .windows(RUN.len())
            .any(|bytes| bytes == RUN.as_bytes())
    );
}
#[cfg(feature = "afternic-controlled-acceptance")]
#[test]
fn controlled_acceptance_concurrent_first_connections_have_one_durable_winner() {
    let (dir, db, e) = fixture();
    drop(db);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let path = dir.path().join("workspace.db");
            let e = e.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut db = BusinessDatabase::open(
                    &path,
                    &LocalDatabaseKey::from_bytes([0x77; 32]),
                    "workspace-local",
                )
                .unwrap();
                barrier.wait();
                db.prepare_afternic_connection_with_acceptance(
                    "Acceptance",
                    &"a".repeat(64),
                    AT,
                    Some(&e),
                    || Ok(()),
                )
                .is_ok()
            })
        })
        .collect();
    assert_eq!(
        threads
            .into_iter()
            .filter_map(|thread| thread.join().ok())
            .filter(|ok| *ok)
            .count(),
        1
    );
    let db = BusinessDatabase::open(
        &dir.path().join("workspace.db"),
        &LocalDatabaseKey::from_bytes([0x77; 32]),
        "workspace-local",
    )
    .unwrap();
    assert_eq!(count(&db, "local_provider_connections"), 1);
    assert_eq!(count(&db, "afternic_controlled_acceptance_runs"), 1);
}

#[cfg(feature = "afternic-controlled-acceptance")]
#[test]
fn controlled_acceptance_durable_plan_scope_rejects_null_mismatched_and_invalid_actions() {
    let (_dir, mut db, e) = fixture();
    let seed = bind_one(&mut db, &e);
    for domain in [DOMAIN, "other.test"] {
        db.create_domain_asset_guarded(
            domain,
            "device-local",
            1,
            AT,
            &super::super::DomainAssetWrite {
                entity_id: domain.into(),
                note: None,
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
        .unwrap();
    }
    let other = db
        .prepare_afternic_connection("Other", &"a".repeat(64), AT, || Ok(()))
        .unwrap();
    for case in [
        "create",
        "update",
        "remove",
        "null_entity",
        "foreign_entity",
        "null_connection",
        "foreign_connection",
        "missing_domain",
        "foreign_domain",
        "missing_connection",
        "foreign_json_connection",
        "missing_action",
        "null_action",
        "remove_action",
        "unknown_kind",
    ] {
        let c = db.store.raw_connection();
        c.execute_batch("SAVEPOINT scoped_plan").unwrap();
        let kind = if case == "remove" {
            "afternic_delist"
        } else if case == "unknown_kind" {
            "unknown"
        } else {
            "afternic_listing_write"
        };
        let mut pre = serde_json::json!({"action":"update","domain":DOMAIN,"connectionId":seed.connection_id});
        match case {
            "create" => pre["action"] = "create".into(),
            "remove" | "missing_action" => {
                pre.as_object_mut().unwrap().remove("action");
            }
            "null_action" => pre["action"] = serde_json::Value::Null,
            "remove_action" => pre["action"] = "remove".into(),
            "missing_domain" => {
                pre.as_object_mut().unwrap().remove("domain");
            }
            "foreign_domain" => pre["domain"] = "other.test".into(),
            "missing_connection" => {
                pre.as_object_mut().unwrap().remove("connectionId");
            }
            "foreign_json_connection" => pre["connectionId"] = other.connection_id.clone().into(),
            _ => {}
        }
        let entity = match case {
            "null_entity" => None,
            "foreign_entity" => Some("other.test"),
            _ => Some(DOMAIN),
        };
        let connection = match case {
            "null_connection" => None,
            "foreign_connection" => Some(other.connection_id.as_str()),
            _ => Some(seed.connection_id.as_str()),
        };
        c.execute("INSERT INTO operation_plans(workspace_id,plan_id,operation_kind,plan_hash,title,phase,risk_level,item_count,created_at,local_commit_sequence) VALUES(?1,'scope-plan',?2,?3,'Scope','awaiting_approval','standard',1,?4,1)",params![db.workspace_id,kind,"a".repeat(64),AT]).unwrap();
        // Persist malformed historical intent without bypassing any schema constraint. Admission
        // must reject it before either approval or queue maintenance can act on the plan.
        c.execute("INSERT INTO operation_plan_items(workspace_id,plan_id,item_id,ordinal,entity_id,connection_id,capability,precondition_json,risk_level,execution_mode,inclusion_status) VALUES(?1,'scope-plan','item',0,?2,?3,'afternic:marketplace:write',?4,'standard','manual','included')",params![db.workspace_id,entity,connection,pre.to_string()]).unwrap();
        let allowed = matches!(case, "create" | "update" | "remove");
        assert_eq!(
            db.require_afternic_controlled_plans(&e, Some("scope-plan"))
                .is_ok(),
            allowed,
            "preview {case}"
        );
        c.execute(
            "UPDATE operation_plans SET phase='approved',approved_at=?1 WHERE plan_id='scope-plan'",
            [AT],
        )
        .unwrap();
        assert_eq!(
            db.require_afternic_controlled_plans(&e, None).is_ok(),
            allowed || case == "unknown_kind",
            "queue {case}"
        );
        c.execute_batch("ROLLBACK TO scoped_plan; RELEASE scoped_plan")
            .unwrap();
    }
}

#[cfg(feature = "afternic-controlled-acceptance")]
#[test]
fn controlled_acceptance_rejects_slot_drift_and_retains_remediation_binding() {
    let (_dir, mut db, e) = fixture();
    let seed = bind_one(&mut db, &e);
    for field in ["generation", "proof", "incarnation"] {
        let mut wrong = seed.clone();
        match field {
            "generation" => wrong.credential_generation += 1,
            "proof" => wrong.credential_public_proof = "b".repeat(64),
            _ => wrong.connection_incarnation_id = "11111111-1111-4111-8111-111111111111".into(),
        }
        assert!(db.admit_afternic_provider(&wrong).is_err(), "{field}");
    }
    let c = db.store.raw_connection();
    for sql in [
        "UPDATE afternic_connection_publications SET credential_generation=2",
        "UPDATE afternic_connection_publications SET credential_public_proof=printf('%064d',0)",
        "UPDATE afternic_connection_publications SET connection_incarnation_id='foreign'",
        "UPDATE local_provider_connections SET connection_incarnation_id='foreign'",
    ] {
        assert!(c.execute_batch(sql).is_err());
    }
    db.afternic_controlled_acceptance(&e, false).unwrap();
    c.execute(
        "UPDATE afternic_connection_publications SET publication_state='remediation_required'",
        [],
    )
    .unwrap();
    assert!(db.afternic_controlled_acceptance(&e, true).is_err());
    assert_eq!(count(&db, "afternic_controlled_acceptance_runs"), 1);
}
