//! Store exact read outcomes without creating another attempt for an uncertain write.
use super::{
    BusinessDatabase, BusinessDatabaseError, Connection, DesktopSellerHubListingFact,
    DesktopSellerHubListingState, EvidenceSigner, ExecutionEvidenceContext, OptionalExtension,
    PLAN_KIND, Result, SellerHubBinWorkSeed, TransactionBehavior, execution_evidence, load_target,
    next_sequence, params, price_cents, provider_block_reason, request_digest, storage,
    validate_timestamp,
};
use crate::active_workspace::business::spaceship_sellerhub::queue_scan_in_transaction;
use execution_evidence::sellerhub_bin::{self as evidence, ReconciliationOutcome};

impl BusinessDatabase {
    #[expect(
        clippy::too_many_arguments,
        reason = "exact work, observation and signed authority have separate trust boundaries"
    )]
    pub(crate) fn settle_sellerhub_bin_observation<G>(
        &mut self,
        work: &SellerHubBinWorkSeed,
        observation: Option<&DesktopSellerHubListingFact>,
        retry_after_seconds: Option<u32>,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let stale = BusinessDatabaseError::MutationStale;
        let target = &work.target;
        if context.workspace_id != self.workspace_id
            || request_digest(target)? != work.request_digest
        {
            return Err(stale);
        }
        if observation.is_some_and(|fact| fact.domain != target.domain) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_timestamp(Some(at.to_owned())).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        execution_evidence::require_no_barrier(&tx, workspace)?;
        let started = current_attempt_start(&tx, workspace, work)?;
        let outcome = observed_bin_price(observation);
        let blocked = provider_block_reason(&tx, workspace, target)?;
        if work.needs_reconciliation && blocked.is_some() {
            return Err(stale);
        }
        let terminal = observation_evidence(&tx, work, outcome, at, context, signer, blocked)?;
        let at = at.max(started.as_deref().unwrap_or(at));
        let sequence = next_sequence(&tx, at)?;
        if let Some((status, reason, audit_id, audit_hash)) = terminal {
            finish_item(
                &tx,
                workspace,
                work,
                at,
                sequence,
                status,
                reason,
                &audit_id,
                &audit_hash,
            )?;
            if status == "succeeded" {
                queue_scan_in_transaction(
                    &tx,
                    workspace,
                    &target.connection_id,
                    (&context.source_device_id, context.active_lease_epoch),
                )?;
            }
        } else {
            let retry = retry_after_seconds.unwrap_or(30).max(30);
            let due: String = tx
                .query_row(
                    "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+'||?2||' seconds')",
                    params![context.occurred_at, retry],
                    |r| r.get(0),
                )
                .map_err(storage)?;
            validate_timestamp(Some(due.clone()))
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            tx.execute(
                "UPDATE operation_attempts SET retry_after=?4
                 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
                params![workspace, work.operation_id, target.item_id, due],
            )
            .map_err(storage)?;
        }
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}

type TerminalObservation = (&'static str, Option<&'static str>, String, String);

fn observation_evidence(
    tx: &Connection,
    work: &SellerHubBinWorkSeed,
    outcome: ObservedBinPrice,
    at: &str,
    context: &ExecutionEvidenceContext,
    signer: &mut EvidenceSigner<'_>,
    blocked: Option<&'static str>,
) -> Result<Option<TerminalObservation>> {
    let target = &work.target;
    let workspace = &context.workspace_id;
    let terminal = if work.needs_reconciliation {
        let kind = match outcome {
            ObservedBinPrice::Price(cents) if cents == target.price_cents => {
                ReconciliationOutcome::Matched
            }
            ObservedBinPrice::ReadFailed => ReconciliationOutcome::ReadFailed,
            _ => ReconciliationOutcome::Different,
        };
        let matched = matches!(kind, ReconciliationOutcome::Matched);
        let (audit_id, audit_hash) = evidence::record_reconciliation(
            tx,
            context,
            &work.operation_id,
            &target.item_id,
            &work.request_digest,
            kind,
            signer,
        )?;
        matched.then_some(("succeeded", None, audit_id, audit_hash))
    } else {
        let reason = if let Some(reason) = blocked {
            Some(reason)
        } else {
            let current = load_target(
                tx,
                workspace,
                &target.connection_id,
                &target.domain,
                target.price_cents,
                at,
                target.item_id.clone(),
            );
            match current {
                Ok(current) if current == *target => match outcome {
                    ObservedBinPrice::ReadFailed => None,
                    ObservedBinPrice::Price(cents) if cents == target.previous_price_cents => {
                        return Err(BusinessDatabaseError::MutationStale);
                    }
                    ObservedBinPrice::Price(_) => Some("precondition_changed"),
                    ObservedBinPrice::Blocked => Some("provider_state_blocked"),
                },
                Ok(_)
                | Err(BusinessDatabaseError::InvalidInput | BusinessDatabaseError::MutationStale) => {
                    Some("precondition_changed")
                }
                Err(other) => return Err(other),
            }
        };
        if let Some(reason) = reason {
            let (audit_id, audit_hash) = evidence::record_preflight_refusal(
                tx,
                context,
                &work.operation_id,
                &work.plan_id,
                &target.item_id,
                &work.request_digest,
                reason,
                signer,
            )?;
            Some(("failed_final", Some(reason), audit_id, audit_hash))
        } else {
            None
        }
    };
    Ok(terminal)
}

pub(super) fn current_attempt_start(
    tx: &Connection,
    workspace: &str,
    work: &SellerHubBinWorkSeed,
) -> Result<Option<String>> {
    let target = &work.target;
    let status = if work.needs_reconciliation {
        "running"
    } else {
        "queued"
    };
    let current: Option<Option<String>> = tx
        .query_row(
            "SELECT a.started_at FROM operation_attempts a
         JOIN operation_plans p USING(workspace_id,plan_id)
         JOIN operations o USING(workspace_id,operation_id,plan_id)
         WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
          AND a.request_digest=?5 AND a.attempt_number=1 AND a.status=?6 AND a.retry_after IS ?7
          AND p.operation_kind=?8 AND p.phase='executing' AND o.phase='running'",
            params![
                workspace,
                work.operation_id,
                work.plan_id,
                target.item_id,
                work.request_digest,
                status,
                work.retry_after,
                PLAN_KIND
            ],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    current.ok_or(BusinessDatabaseError::MutationStale)
}

#[derive(Clone, Copy)]
enum ObservedBinPrice {
    Price(u64),
    Blocked,
    ReadFailed,
}

fn observed_bin_price(observation: Option<&DesktopSellerHubListingFact>) -> ObservedBinPrice {
    match observation {
        None => ObservedBinPrice::ReadFailed,
        Some(fact) if matches!(fact.state, DesktopSellerHubListingState::OnSale) => fact
            .enabled_bin_price_usd
            .as_deref()
            .and_then(price_cents)
            .map_or(ObservedBinPrice::Blocked, ObservedBinPrice::Price),
        Some(_) => ObservedBinPrice::Blocked,
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the completed status and signed audit must be persisted together"
)]
fn finish_item(
    tx: &Connection,
    workspace: &str,
    work: &SellerHubBinWorkSeed,
    at: &str,
    sequence: i64,
    status: &str,
    reason: Option<&str>,
    audit_id: &str,
    audit_hash: &str,
) -> Result<()> {
    tx.execute(
        "UPDATE operation_attempts SET status=?4,started_at=coalesce(started_at,?5),
         completed_at=?5,retry_after=NULL,error_code=?6
         WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
        params![
            workspace,
            work.operation_id,
            work.target.item_id,
            status,
            at,
            reason
        ],
    )
    .map_err(storage)?;
    tx.execute(
        "INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,result_version,
         outcome,result_json,evidence_digest,observed_at)
         VALUES(?1,?2,?3,?4,1,1,?5,json_object('schemaVersion',1,'auditEventId',?6,'reason',?7),?8,?9)",
        params![workspace,work.operation_id,work.plan_id,work.target.item_id,status,audit_id,reason,audit_hash,at],
    ).map_err(storage)?;
    let next_phase: Option<String> = tx
        .query_row(
            "SELECT CASE WHEN sum(status IN ('queued','running'))!=0 THEN NULL
          WHEN sum(status='failed_final')!=0 THEN 'partially_failed' ELSE 'completed' END
         FROM operation_attempts WHERE workspace_id=?1 AND operation_id=?2",
            params![workspace, work.operation_id],
            |r| r.get(0),
        )
        .map_err(storage)?;
    if let Some(phase) = next_phase {
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
