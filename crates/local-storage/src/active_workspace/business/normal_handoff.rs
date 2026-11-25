//! Durable source-device evidence, owned by the existing business database writer.
use super::{BusinessDatabase, BusinessDatabaseError, validate_identifier, validate_timestamp};
use rusqlite::{OptionalExtension, TransactionBehavior, params};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NormalHandoffAttempt {
    pub(crate) request_id: String,
    pub(crate) source_device_id: String,
    pub(crate) target_device_id: String,
    pub(crate) source_lease_epoch: u64,
    pub(crate) proof_id: String,
    pub(crate) proof_digest: String,
    pub(crate) issued_at: String,
    pub(crate) expires_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NormalHandoffReceipt {
    pub(crate) source_lease_epoch: u64,
    pub(crate) proof_id: String,
    pub(crate) proof_digest: String,
    pub(crate) released_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NormalHandoffRequest {
    pub(crate) source_device_id: String,
    pub(crate) source_lease_epoch: u64,
    pub(crate) target_device_id: String,
    pub(crate) idempotency_key: String,
    pub(crate) request_json: String,
}
fn read_pending_request(
    c: &rusqlite::Connection,
    workspace: &str,
    source: &str,
    epoch: Option<u64>,
) -> Result<Option<NormalHandoffRequest>, BusinessDatabaseError> {
    let pending=c.query_row("SELECT source_lease_epoch,target_device_id,idempotency_key,request_json FROM normal_handoff_requests WHERE workspace_id=?1 AND source_device_id=?2 AND answer_json IS NULL",params![workspace,source],|r|Ok(NormalHandoffRequest{source_device_id:source.into(),source_lease_epoch:u64::try_from(r.get::<_,i64>(0)?).map_err(|_|rusqlite::Error::InvalidQuery)?,target_device_id:r.get(1)?,idempotency_key:r.get(2)?,request_json:r.get(3)?})).optional().map_err(|_|BusinessDatabaseError::StorageRejected)?;
    if let Some(request) = &pending {
        // A new epoch cannot replay a request that may never have reached Cloud; it needs a read-only lookup.
        if epoch.is_some_and(|epoch| request.source_lease_epoch != epoch) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        validate_identifier(&request.target_device_id)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if !super::is_uuid_v4(&request.idempotency_key)
            || request.request_json
                != normal_request_json(
                    &request.target_device_id,
                    &request.idempotency_key,
                    request.source_lease_epoch,
                )?
        {
            return Err(BusinessDatabaseError::StorageRejected);
        }
    }
    Ok(pending)
}
fn normal_request_json(
    target: &str,
    key: &str,
    epoch: u64,
) -> Result<String, BusinessDatabaseError> {
    serde_json::to_string(&serde_json::json!({"schemaVersion":2,"mode":"normal","toDeviceId":target,"idempotencyKey":key,"expectedSourceLeaseEpoch":epoch})).map_err(|_|BusinessDatabaseError::StorageRejected)
}
impl BusinessDatabase {
    pub(crate) fn pending_normal_handoff_request(
        &self,
        source: &str,
        epoch: u64,
    ) -> Result<Option<NormalHandoffRequest>, BusinessDatabaseError> {
        read_pending_request(
            self.store.raw_connection(),
            &self.workspace_id,
            source,
            Some(epoch),
        )
    }
    pub(crate) fn pending_normal_handoff_request_resolution(
        &self,
        source: &str,
    ) -> Result<Option<NormalHandoffRequest>, BusinessDatabaseError> {
        read_pending_request(
            self.store.raw_connection(),
            &self.workspace_id,
            source,
            None,
        )
    }
    pub(crate) fn prepare_normal_handoff_request(
        &mut self,
        source: &str,
        epoch: u64,
        target: &str,
        at: &str,
        guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<NormalHandoffRequest, BusinessDatabaseError> {
        for value in [source, target] {
            validate_identifier(value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        }
        validate_timestamp(Some(at.into())).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if source == target || !(1..=9_007_199_254_740_991).contains(&epoch) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let request = if let Some(pending) =
            read_pending_request(&tx, &self.workspace_id, source, Some(epoch))?
        {
            pending
        } else {
            super::execution_evidence::require_no_barrier(&tx, &self.workspace_id)?;
            let key = super::afternic::random_id()?;
            let request = NormalHandoffRequest {
                source_device_id: source.into(),
                source_lease_epoch: epoch,
                target_device_id: target.into(),
                idempotency_key: key.clone(),
                request_json: normal_request_json(target, &key, epoch)?,
            };
            tx.execute("INSERT INTO normal_handoff_requests(workspace_id,source_device_id,source_lease_epoch,idempotency_key,target_device_id,request_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![self.workspace_id,source,i64::try_from(epoch).map_err(|_|BusinessDatabaseError::InvalidInput)?,request.idempotency_key,target,request.request_json,at]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
            request
        };
        guard()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(request)
    }
    pub(crate) fn complete_normal_handoff_request(
        &mut self,
        request: &NormalHandoffRequest,
        answer: &str,
        drain_request_id: Option<&str>,
        at: &str,
        guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_timestamp(Some(at.into())).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if answer.is_empty() || answer.len() > 65536 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        if let Some(id) = drain_request_id {
            validate_identifier(id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let pending = read_pending_request(
            &tx,
            &self.workspace_id,
            &request.source_device_id,
            Some(request.source_lease_epoch),
        )?
        .ok_or(BusinessDatabaseError::MutationStale)?;
        if pending != *request {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if let Some(id) = drain_request_id {
            super::drain_claims::install_handoff_barrier(
                &tx,
                &self.workspace_id,
                id,
                &request.source_device_id,
                i64::try_from(request.source_lease_epoch)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                at,
            )?;
        }
        tx.execute("UPDATE normal_handoff_requests SET answer_json=?3,answered_at=?4 WHERE workspace_id=?1 AND idempotency_key=?2 AND answer_json IS NULL",params![self.workspace_id,request.idempotency_key,answer,at]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        guard()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}

impl NormalHandoffAttempt {
    fn validate(&self) -> Result<(), BusinessDatabaseError> {
        for value in [
            &self.request_id,
            &self.source_device_id,
            &self.target_device_id,
            &self.proof_id,
        ] {
            validate_identifier(value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        }
        for value in [&self.issued_at, &self.expires_at] {
            validate_timestamp(Some(value.clone()))
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        }
        if self.source_device_id == self.target_device_id
            || !(1..=9_007_199_254_740_991).contains(&self.source_lease_epoch)
            || self.issued_at >= self.expires_at
            || self.proof_digest.len() != 43
            || !self
                .proof_digest
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        Ok(())
    }
}

impl BusinessDatabase {
    pub(crate) fn normal_handoff_attempt(
        &self,
        request_id: &str,
    ) -> Result<Option<(NormalHandoffAttempt, Option<String>)>, BusinessDatabaseError> {
        let record = self.store.raw_connection().query_row(
            "SELECT a.source_device_id, a.target_device_id, a.source_lease_epoch, a.proof_id,
             a.proof_digest, a.issued_at, a.expires_at, r.released_at FROM normal_handoff_attempts a
             LEFT JOIN normal_handoff_receipts r ON r.workspace_id=a.workspace_id AND r.request_id=a.request_id
             WHERE a.workspace_id=?1 AND a.request_id=?2",
            params![self.workspace_id, request_id], |row| Ok((NormalHandoffAttempt {
                request_id: request_id.to_owned(), source_device_id: row.get(0)?, target_device_id: row.get(1)?,
                source_lease_epoch: u64::try_from(row.get::<_, i64>(2)?).map_err(|_| rusqlite::Error::InvalidQuery)?, proof_id: row.get(3)?, proof_digest: row.get(4)?,
                issued_at: row.get(5)?, expires_at: row.get(6)?,
            }, row.get::<_, Option<String>>(7)?)))
            .optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if let Some((attempt, released)) = &record {
            attempt.validate()?;
            if let Some(released) = released {
                validate_timestamp(Some(released.clone()))
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                if released < &attempt.issued_at || released >= &attempt.expires_at {
                    return Err(BusinessDatabaseError::StorageRejected);
                }
            }
        }
        Ok(record)
    }

    pub(crate) fn record_normal_handoff_attempt(
        &mut self,
        attempt: &NormalHandoffAttempt,
        fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        attempt.validate()?;
        if self
            .normal_handoff_attempt(&attempt.request_id)?
            .is_some_and(|(old, _)| old != *attempt)
        {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        tx.execute("INSERT INTO normal_handoff_attempts
          (workspace_id,request_id,source_device_id,target_device_id,source_lease_epoch,proof_id,proof_digest,issued_at,expires_at)
          VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(workspace_id,request_id) DO NOTHING",
          params![self.workspace_id,attempt.request_id,attempt.source_device_id,attempt.target_device_id,
            i64::try_from(attempt.source_lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?,attempt.proof_id,attempt.proof_digest,attempt.issued_at,attempt.expires_at])
          .map_err(|_| BusinessDatabaseError::MutationConflict)?;
        fence()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn record_normal_handoff_receipt(
        &mut self,
        request_id: &str,
        source: &str,
        target: &str,
        receipt: &NormalHandoffReceipt,
        fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        let (attempt, previous) = self
            .normal_handoff_attempt(request_id)?
            .ok_or(BusinessDatabaseError::MutationConflict)?;
        if attempt.source_device_id != source
            || attempt.target_device_id != target
            || attempt.source_lease_epoch != receipt.source_lease_epoch
            || attempt.proof_id != receipt.proof_id
            || attempt.proof_digest != receipt.proof_digest
            || receipt.released_at < attempt.issued_at
            || receipt.released_at >= attempt.expires_at
            || previous
                .as_ref()
                .is_some_and(|old| old != &receipt.released_at)
        {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        validate_timestamp(Some(receipt.released_at.clone()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        tx.execute(
            "INSERT INTO normal_handoff_receipts (workspace_id,request_id,released_at)
          VALUES (?1,?2,?3) ON CONFLICT(workspace_id,request_id) DO NOTHING",
            params![self.workspace_id, request_id, receipt.released_at],
        )
        .map_err(|_| BusinessDatabaseError::MutationConflict)?;
        let open_producer:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM execution_evidence_stream_heads WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND producer_state='open')",params![self.workspace_id,source,i64::try_from(receipt.source_lease_epoch).map_err(|_|BusinessDatabaseError::InvalidInput)?],|r|r.get(0)).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        if open_producer {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        // A successful release permanently closes this source epoch; cancellation cannot reopen it.
        tx.execute("UPDATE execution_evidence_stream_heads SET producer_state='sealed' WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND producer_state='frozen'",params![self.workspace_id,source,i64::try_from(receipt.source_lease_epoch).map_err(|_|BusinessDatabaseError::InvalidInput)?]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
        fence()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn normal_handoff_submission_refused(
        &self,
        request_id: &str,
    ) -> Result<bool, BusinessDatabaseError> {
        self.store.raw_connection().query_row("SELECT EXISTS(SELECT 1 FROM normal_handoff_refusals WHERE workspace_id=?1 AND request_id=?2)",
            params![self.workspace_id, request_id], |row| row.get(0)).map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn refuse_normal_handoff_submission(
        &mut self,
        request_id: &str,
        code: &str,
        fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        let Some((_, receipt)) = self.normal_handoff_attempt(request_id)? else {
            return Ok(());
        };
        if receipt.is_some() {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        tx.execute(
            "INSERT INTO normal_handoff_refusals(workspace_id,request_id,code) VALUES (?1,?2,?3)
            ON CONFLICT(workspace_id,request_id) DO NOTHING",
            params![self.workspace_id, request_id, code],
        )
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        fence()?;
        tx.commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn require_normal_handoff_replica(
        &self,
        device_id: &str,
        last_active_epoch: u64,
    ) -> Result<(), BusinessDatabaseError> {
        let barrier = self
            .device_handoff_barrier()?
            .ok_or(BusinessDatabaseError::MutationStale)?;
        let (attempt, receipt) = self
            .normal_handoff_attempt(&barrier.device_switch_request_id)?
            .ok_or(BusinessDatabaseError::MutationStale)?;
        if receipt.is_none()
            || attempt.source_device_id != device_id
            || attempt.source_lease_epoch != last_active_epoch
            || barrier.active_lease_epoch != Some(last_active_epoch)
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LocalDatabaseKey;

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one durable attempt is followed through rejection, commit, replay and reopen"
    )]
    fn normal_handoff_evidence_is_immutable_correlated_fenced_and_epoch_bound() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let mut db = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &LocalDatabaseKey::from_bytes([42; 32]),
            "workspace-a",
        )
        .unwrap();
        let attempt = NormalHandoffAttempt {
            request_id: "request-a".into(),
            source_device_id: "source-a".into(),
            target_device_id: "target-b".into(),
            source_lease_epoch: 2,
            proof_id: "proof-a".into(),
            proof_digest: "A".repeat(43),
            issued_at: "2026-11-19T00:00:00Z".into(),
            expires_at: "2026-11-19T00:05:00Z".into(),
        };
        assert!(
            db.record_normal_handoff_attempt(&attempt, || Ok(()))
                .is_err()
        );
        db.begin_device_handoff_barrier("request-a", 2, &attempt.issued_at, || Ok(()))
            .unwrap();
        assert!(
            db.record_normal_handoff_attempt(&attempt, || Err(
                BusinessDatabaseError::MutationStale
            ))
            .is_err()
        );
        assert!(db.normal_handoff_attempt("request-a").unwrap().is_none());
        db.record_normal_handoff_attempt(&attempt, || Ok(()))
            .unwrap();
        db.record_normal_handoff_attempt(&attempt, || Ok(()))
            .unwrap();
        let mut replacement = attempt.clone();
        replacement.proof_id = "proof-b".into();
        assert!(
            db.record_normal_handoff_attempt(&replacement, || Ok(()))
                .is_err()
        );
        let receipt = NormalHandoffReceipt {
            source_lease_epoch: 2,
            proof_id: attempt.proof_id.clone(),
            proof_digest: attempt.proof_digest.clone(),
            released_at: "2026-11-19T00:01:00Z".into(),
        };
        for (source, target) in [("other", "target-b"), ("source-a", "other")] {
            assert!(
                db.record_normal_handoff_receipt("request-a", source, target, &receipt, || Ok(()))
                    .is_err()
            );
        }
        for change in ["epoch", "proof", "digest", "early", "expired"] {
            let mut bad = receipt.clone();
            match change {
                "epoch" => bad.source_lease_epoch = 3,
                "proof" => bad.proof_id = "proof-b".into(),
                "digest" => bad.proof_digest = "B".repeat(43),
                "early" => bad.released_at = "2026-11-18T23:59:59Z".into(),
                _ => bad.released_at.clone_from(&attempt.expires_at),
            }
            assert!(
                db.record_normal_handoff_receipt("request-a", "source-a", "target-b", &bad, || Ok(
                    ()
                ))
                .is_err()
            );
        }
        assert!(db.require_normal_handoff_replica("source-a", 2).is_err());
        assert!(
            db.record_normal_handoff_receipt(
                "request-a",
                "source-a",
                "target-b",
                &receipt,
                || Err(BusinessDatabaseError::MutationStale)
            )
            .is_err()
        );
        assert!(
            db.normal_handoff_attempt("request-a")
                .unwrap()
                .unwrap()
                .1
                .is_none()
        );
        db.record_normal_handoff_receipt("request-a", "source-a", "target-b", &receipt, || Ok(()))
            .unwrap();
        db.record_normal_handoff_receipt("request-a", "source-a", "target-b", &receipt, || Ok(()))
            .unwrap();
        db.require_normal_handoff_replica("source-a", 2).unwrap();
        assert!(db.require_normal_handoff_replica("source-a", 3).is_err());
        assert!(db.require_normal_handoff_replica("other", 2).is_err());
        for sql in [
            "UPDATE normal_handoff_attempts SET proof_id='replacement'",
            "DELETE FROM normal_handoff_attempts",
            "UPDATE normal_handoff_receipts SET released_at='2026-11-19T00:02:00Z'",
            "DELETE FROM normal_handoff_receipts",
        ] {
            assert!(db.store.fixture_connection().execute(sql, []).is_err());
        }
        drop(db);
        let reopened = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &LocalDatabaseKey::from_bytes([42; 32]),
            "workspace-a",
        )
        .unwrap();
        reopened
            .require_normal_handoff_replica("source-a", 2)
            .unwrap();
        assert!(
            BusinessDatabase::open(
                &directory.path().join("business.db"),
                &LocalDatabaseKey::from_bytes([42; 32]),
                "workspace-b"
            )
            .is_err()
        );
    }
    #[test]
    fn initial_request_survives_reopen_and_answer_barrier_share_one_final_fence() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("request.db");
        let key = LocalDatabaseKey::from_bytes([42; 32]);
        let mut db = BusinessDatabase::open(&path, &key, "workspace-a").unwrap();
        let at = "2026-11-19T00:00:00Z";
        assert!(
            db.prepare_normal_handoff_request("source", 1, "target", at, || Err(
                BusinessDatabaseError::MutationStale
            ))
            .is_err()
        );
        assert!(
            db.pending_normal_handoff_request("source", 1)
                .unwrap()
                .is_none()
        );
        let first = db
            .prepare_normal_handoff_request("source", 1, "target", at, || Ok(()))
            .unwrap();
        let repeated = db
            .prepare_normal_handoff_request("source", 1, "different-target", at, || Ok(()))
            .unwrap();
        assert_eq!(first, repeated);
        drop(db);
        let mut db = BusinessDatabase::open(&path, &key, "workspace-a").unwrap();
        assert_eq!(
            db.pending_normal_handoff_request("source", 1)
                .unwrap()
                .as_ref(),
            Some(&first)
        );
        assert!(db.pending_normal_handoff_request("source", 2).is_err());
        assert!(
            db.prepare_normal_handoff_request("source", 2, "target", at, || Ok(()))
                .is_err()
        );
        assert_eq!(
            db.pending_normal_handoff_request_resolution("source")
                .unwrap()
                .as_ref(),
            Some(&first)
        );
        let response = r#"{"schemaVersion":1,"accepted":true}"#;
        assert!(
            db.complete_normal_handoff_request(&first, response, Some("switch"), at, || Err(
                BusinessDatabaseError::MutationStale
            ))
            .is_err()
        );
        assert!(db.device_handoff_barrier().unwrap().is_none());
        assert_eq!(
            db.pending_normal_handoff_request("source", 1)
                .unwrap()
                .as_ref(),
            Some(&first)
        );
        db.complete_normal_handoff_request(&first, response, Some("switch"), at, || Ok(()))
            .unwrap();
        assert!(
            db.pending_normal_handoff_request("source", 1)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            db.device_handoff_barrier()
                .unwrap()
                .unwrap()
                .device_switch_request_id,
            "switch"
        );
        assert!(
            db.prepare_normal_handoff_request("source", 1, "next-target", at, || Ok(()))
                .is_err()
        );
    }
    #[test]
    fn initial_request_definite_rejection_allows_new_key_but_foreign_answer_cannot_consume() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let mut db = BusinessDatabase::open(
            &directory.path().join("request.db"),
            &LocalDatabaseKey::from_bytes([42; 32]),
            "workspace-a",
        )
        .unwrap();
        let at = "2026-11-19T00:00:00Z";
        let first = db
            .prepare_normal_handoff_request("source", 1, "target", at, || Ok(()))
            .unwrap();
        let mut foreign = first.clone();
        foreign.target_device_id = "wrong".into();
        let response = r#"{"schemaVersion":1,"accepted":false,"code":"TARGET_REMOVED"}"#;
        assert!(
            db.complete_normal_handoff_request(&foreign, response, None, at, || Ok(()))
                .is_err()
        );
        assert!(
            db.pending_normal_handoff_request("source", 1)
                .unwrap()
                .is_some()
        );
        db.complete_normal_handoff_request(&first, response, None, at, || Ok(()))
            .unwrap();
        let second = db
            .prepare_normal_handoff_request("source", 1, "next-target", at, || Ok(()))
            .unwrap();
        assert_ne!(first.idempotency_key, second.idempotency_key);
        assert_eq!(second.target_device_id, "next-target");
        assert!(db.device_handoff_barrier().unwrap().is_none());
    }
}
