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
}
