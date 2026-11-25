//! Exact seller-account observations of the existing creation claim.
use super::{
    BusinessDatabase, BusinessDatabaseError, EvidenceSigner, ExecutionEvidenceContext, KIND,
    OptionalExtension, Result, SellerHubCreateWork, TransactionBehavior, current_asset_generation,
    current_scan, execution_evidence, marketplace_approval, next_sequence, params, request_digest,
    storage, validate_timestamp,
};
use crate::active_workspace::business::spaceship_sellerhub::queue_scan_in_transaction;
use marketplace_approval::{ApprovalPurpose, ReconciliationOutcome};

#[derive(Clone, Copy)]
pub enum SellerHubCreateReadback {
    Published,
    OwnershipPending,
    TermsUnconfirmed,
    StateBlocked,
    ReadFailed,
}

impl SellerHubCreateReadback {
    pub(super) fn evidence(self) -> (ReconciliationOutcome, Option<&'static str>) {
        match self {
            Self::Published => (ReconciliationOutcome::Matched, None),
            Self::OwnershipPending => (
                ReconciliationOutcome::OwnershipPending,
                Some("ownership_verifying"),
            ),
            Self::TermsUnconfirmed => (
                ReconciliationOutcome::Different,
                Some("postcondition_pending"),
            ),
            Self::StateBlocked => (ReconciliationOutcome::StateBlocked, Some("not_on_sale")),
            Self::ReadFailed => (ReconciliationOutcome::ReadFailed, Some("read_failed")),
        }
    }
}

impl BusinessDatabase {
    #[expect(
        clippy::too_many_arguments,
        reason = "the observed state, claimed work, and signing authority are separate inputs"
    )]
    pub(crate) fn settle_sellerhub_create_observation<G>(
        &mut self,
        work: &SellerHubCreateWork,
        readback: SellerHubCreateReadback,
        retry_after_seconds: Option<u32>,
        observed_at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let stale = BusinessDatabaseError::MutationStale;
        if context.workspace_id != self.workspace_id
            || !work.reconciliation_only
            || request_digest(&work.connection_id, &work.target)? != work.request_digest
        {
            return Err(stale);
        }
        validate_timestamp(Some(observed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, workspace)?;
        let scan = current_scan(&tx, workspace, &work.connection_id)?;
        if scan.incarnation != work.target.connection_incarnation_id
            || current_asset_generation(&tx, workspace, &work.target.terms.domain)?
                != work.target.asset_generation
        {
            return Err(stale);
        }
        let item = &work.target.item_id;
        let started_at: String = tx.query_row(
            "SELECT a.started_at FROM operation_attempts a JOIN operations o USING(workspace_id,operation_id,plan_id)
             JOIN operation_plans p USING(workspace_id,plan_id)
             WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
               AND a.attempt_number=1 AND a.request_digest=?5 AND a.status IN ('running','waiting_remote')
               AND a.retry_after IS ?6 AND p.operation_kind=?7 AND p.phase='executing' AND o.phase='running'",
            params![workspace,work.operation_id,work.plan_id,item,work.request_digest,work.retry_after,KIND],
            |row| row.get(0),
        ).optional().map_err(storage)?.ok_or(stale)?;
        let at = observed_at.max(&started_at);
        let (outcome, reason) = readback.evidence();
        let (audit_id, audit_digest) = marketplace_approval::record_reconciliation(
            ApprovalPurpose::SellerHubCreateListing,
            &tx,
            context,
            &work.operation_id,
            item,
            &work.request_digest,
            outcome,
            signer,
        )?;
        let (status, completed_at, next_read) = if reason.is_none() {
            ("succeeded", Some(at), None)
        } else {
            let retry = retry_after_seconds.unwrap_or(30).max(30);
            let due: String = tx
                .query_row(
                    "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+'||?2||' seconds')",
                    params![context.occurred_at, retry],
                    |row| row.get(0),
                )
                .map_err(storage)?;
            validate_timestamp(Some(due.clone()))
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            ("waiting_remote", None, Some(due))
        };
        let sequence = next_sequence(&tx, at)?;
        tx.execute(
            "UPDATE operation_attempts SET status=?4,completed_at=?5,retry_after=?6,error_code=?7
             WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
            params![
                workspace,
                work.operation_id,
                item,
                status,
                completed_at,
                next_read,
                reason
            ],
        )
        .map_err(storage)?;
        tx.execute(
            "INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,
              outcome,result_json,evidence_digest,observed_at)
             SELECT ?1,?2,?3,?4,1,coalesce(max(result_version),0)+1,?5,
                 json_object('schemaVersion',1,'auditEventId',?6,'reason',?7),?8,?9
             FROM operation_results WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?4",
            params![workspace,work.operation_id,work.plan_id,item,status,audit_id,reason,audit_digest,at],
        ).map_err(storage)?;
        if status == "succeeded" {
            queue_scan_in_transaction(
                &tx,
                workspace,
                &work.connection_id,
                (&context.source_device_id, context.active_lease_epoch),
            )?;
            finish_operation(&tx, work, workspace, at, sequence)?;
        }
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}

impl BusinessDatabase {
    pub(crate) fn defer_or_refuse_sellerhub_create<G>(
        &mut self,
        work: &SellerHubCreateWork,
        remote_present: bool,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let stale = BusinessDatabaseError::MutationStale;
        if context.workspace_id != self.workspace_id || work.reconciliation_only {
            return Err(stale);
        }
        validate_timestamp(Some(at.to_owned())).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, workspace)?;
        let current = current_scan(&tx, workspace, &work.connection_id);
        let reason = match current {
            Ok(scan) if scan.incarnation == work.target.connection_incarnation_id => {
                match current_asset_generation(&tx, workspace, &work.target.terms.domain) {
                    Ok(generation) if generation == work.target.asset_generation => {
                        remote_present.then_some("provider_state_blocked")
                    }
                    Ok(_) | Err(BusinessDatabaseError::MutationStale) => {
                        Some("precondition_changed")
                    }
                    Err(error) => return Err(error),
                }
            }
            Ok(_) | Err(BusinessDatabaseError::MutationStale) => Some("connection_changed"),
            Err(error) => return Err(error),
        };
        let item = &work.target.item_id;
        let queued: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM operation_attempts a JOIN operations o USING(workspace_id,operation_id,plan_id)
             WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
               AND a.attempt_number=1 AND a.request_digest=?5 AND a.status='queued' AND a.retry_after IS ?6
               AND o.phase='running')",
            params![workspace,work.operation_id,work.plan_id,item,work.request_digest,work.retry_after],
            |row| row.get(0),
        ).map_err(storage)?;
        if !queued {
            return Err(stale);
        }
        if let Some(reason) = reason {
            let (audit_id, audit_digest) = marketplace_approval::record_preflight_refusal(
                ApprovalPurpose::SellerHubCreateListing,
                &tx,
                context,
                &work.operation_id,
                &work.plan_id,
                item,
                &work.request_digest,
                reason,
                signer,
            )?;
            tx.execute(
                "UPDATE operation_attempts SET status='failed_final',started_at=?4,completed_at=?4,
                 retry_after=NULL,error_code=?5 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
                params![workspace,work.operation_id,item,at,reason],
            ).map_err(storage)?;
            tx.execute(
                "INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,
                 outcome,result_json,evidence_digest,observed_at)
                 VALUES(?1,?2,?3,?4,1,1,'failed_final',json_object('schemaVersion',1,'auditEventId',?5,'reason',?6),?7,?8)",
                params![workspace,work.operation_id,work.plan_id,item,audit_id,reason,audit_digest,at],
            ).map_err(storage)?;
            finish_operation(&tx, work, workspace, at, next_sequence(&tx, at)?)?;
        } else {
            tx.execute(
                "UPDATE operation_attempts SET retry_after=strftime('%Y-%m-%dT%H:%M:%SZ',?4,'+60 seconds')
                 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
                params![workspace,work.operation_id,item,context.occurred_at],
            ).map_err(storage)?;
        }
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}

fn finish_operation(
    tx: &rusqlite::Connection,
    work: &SellerHubCreateWork,
    workspace: &str,
    at: &str,
    sequence: i64,
) -> Result<()> {
    let phase: Option<String> = tx
        .query_row(
            "SELECT CASE WHEN sum(status NOT IN ('succeeded','failed_final'))>0 THEN NULL
         WHEN sum(status='failed_final')>0 THEN 'partially_failed' ELSE 'completed' END
         FROM operation_attempts WHERE workspace_id=?1 AND operation_id=?2",
            params![workspace, work.operation_id],
            |row| row.get(0),
        )
        .map_err(storage)?;
    if let Some(phase) = phase {
        tx.execute(
            "UPDATE operations SET phase=?3,completed_at=?4,local_commit_sequence=?5
                      WHERE workspace_id=?1 AND operation_id=?2",
            params![workspace, work.operation_id, phase, at, sequence],
        )
        .map_err(storage)?;
        tx.execute(
            "UPDATE operation_plans SET phase='completed',local_commit_sequence=?3
                      WHERE workspace_id=?1 AND plan_id=?2",
            params![workspace, work.plan_id, sequence],
        )
        .map_err(storage)?;
    }
    Ok(())
}
