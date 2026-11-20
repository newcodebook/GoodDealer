//! A single durable claim for an Atom Standard listing. A claimed item can only be observed.
use super::{
    ACTION, ApprovalPurpose, BusinessDatabase, BusinessDatabaseError, Connection, EvidenceSigner,
    ExecutionEvidenceContext, FrozenListing, KIND, OptionalExtension, Result, TransactionBehavior,
    freeze_listing, marketplace_approval, next_sequence, params, read_plan, request_digest,
    require_no_barrier, storage,
};
use crate::{
    DesktopAtomListingObservation, DesktopAtomListingState,
    active_workspace::business::atom_marketplace::listing_binding_digest,
    active_workspace::business::execution_evidence::sql,
};
use marketplace_approval::ReconciliationOutcome;

const STALE: BusinessDatabaseError = BusinessDatabaseError::MutationStale;
const PURPOSE: ApprovalPurpose = ApprovalPurpose::AtomStandardDelist;

#[derive(Clone, Copy)]
enum AttemptStage {
    Queued,
    Claimed,
    AwaitingRead,
}

impl AttemptStage {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Claimed => "running",
            Self::AwaitingRead => "waiting_remote",
        }
    }
}

pub(crate) struct AtomStandardDelistWorkSeed {
    operation_id: String,
    plan_id: String,
    target: FrozenListing,
    request_digest: String,
    retry_after: Option<String>,
    stage: AttemptStage,
    pub(crate) can_observe: bool,
}

impl AtomStandardDelistWorkSeed {
    pub(crate) fn claimed(&self) -> bool {
        !matches!(self.stage, AttemptStage::Queued)
    }

    pub(crate) fn domain(&self) -> &str {
        &self.target.domain
    }

    pub(crate) fn connection_id(&self) -> &str {
        &self.target.connection_id
    }

    pub(crate) fn matches_preflight(&self, observation: &DesktopAtomListingObservation) -> bool {
        observation.domain == self.target.domain
            && observation.reported_standard
            && matches!(observation.state, DesktopAtomListingState::SellerApproved)
            && listing_binding_digest(
                &self.target.connection_incarnation_id,
                &observation.resource_digest,
            ) == self.target.resource_binding_digest
    }
}

fn connection_is_current(db: &Connection, workspace: &str, target: &FrozenListing) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM atom_marketplace_connections
         WHERE workspace_id=?1 AND connection_id=?2 AND incarnation_id=?3
          AND state='active' AND purged_at IS NULL)",
        params![
            workspace,
            target.connection_id,
            target.connection_incarnation_id
        ],
        |row| row.get(0),
    )
    .map_err(storage)
}

fn target_is_current(
    db: &Connection,
    workspace: &str,
    target: &FrozenListing,
    at: &str,
) -> Result<bool> {
    match freeze_listing(
        db,
        workspace,
        &target.connection_id,
        &target.domain,
        at,
        target.item_id.clone(),
    ) {
        Ok(current) => Ok(current == *target),
        Err(BusinessDatabaseError::MutationStale) => Ok(false),
        Err(error) => Err(error),
    }
}

impl BusinessDatabase {
    pub(crate) fn next_atom_standard_delist_work(
        &self,
        context: &ExecutionEvidenceContext,
        allow_write: bool,
    ) -> Result<Option<AtomStandardDelistWorkSeed>> {
        let workspace = &self.workspace_id;
        let db = self.store.raw_connection();
        if context.workspace_id != *workspace {
            return Err(STALE);
        }
        require_no_barrier(db, workspace)?;
        let Some((operation_id, plan_id, item_id, digest, status, retry_after)) = db.query_row(
            "SELECT o.operation_id,p.plan_id,i.item_id,a.request_digest,a.status,a.retry_after
             FROM operation_attempts a JOIN operations o USING(workspace_id,operation_id,plan_id)
             JOIN operation_plans p USING(workspace_id,plan_id)
             JOIN operation_plan_items i USING(workspace_id,plan_id,item_id)
             JOIN atom_marketplace_connections c ON c.workspace_id=i.workspace_id AND c.connection_id=i.connection_id
             WHERE p.workspace_id=?1 AND p.operation_kind=?2 AND p.phase='executing' AND o.phase='running'
              AND a.attempt_number=1 AND (a.retry_after IS NULL OR a.retry_after<=?3)
              AND ((a.status IN ('running','waiting_remote') AND c.state='active' AND c.purged_at IS NULL
                     AND c.incarnation_id=json_extract(i.precondition_json,'$.connectionIncarnationId'))
                OR (?4 AND a.status='queued' AND EXISTS(
                  SELECT 1 FROM afternic_listing_approvals b WHERE b.workspace_id=a.workspace_id
                   AND b.operation_id=a.operation_id AND b.plan_id=a.plan_id AND b.action=?5
                   AND b.source_device_id=?6 AND b.active_lease_epoch=?7 AND b.source_installation_digest=?8
                   AND b.credential_epoch=?9 AND b.signing_key_id=?10 AND b.signing_key_version=?11)))
             ORDER BY a.status='queued',o.requested_at,o.operation_id,i.ordinal LIMIT 1",
            params![workspace,KIND,context.occurred_at,allow_write,ACTION,context.source_device_id,
                sql(context.active_lease_epoch)?,context.source_installation_digest,sql(context.credential_epoch)?,
                context.signing_key_id,sql(context.signing_key_version)?],
            |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,String>(2)?,
                row.get::<_,String>(3)?, row.get::<_,String>(4)?, row.get::<_,Option<String>>(5)?)),
        ).optional().map_err(storage)? else {
            return Ok(None);
        };
        let plan = read_plan(db, workspace, &plan_id)?;
        let target = plan
            .targets
            .into_iter()
            .find(|item| item.item_id == item_id)
            .ok_or(STALE)?;
        if !super::is_uuid_v4(&operation_id) || request_digest(&target)? != digest {
            return Err(STALE);
        }
        let stage = match status.as_str() {
            "queued" => AttemptStage::Queued,
            "running" => AttemptStage::Claimed,
            "waiting_remote" => AttemptStage::AwaitingRead,
            _ => return Err(STALE),
        };
        let can_observe = match stage {
            AttemptStage::Queued => {
                target_is_current(db, workspace, &target, &context.occurred_at)?
            }
            AttemptStage::Claimed | AttemptStage::AwaitingRead => {
                connection_is_current(db, workspace, &target)?
            }
        };
        Ok(Some(AtomStandardDelistWorkSeed {
            operation_id,
            plan_id,
            target,
            request_digest: digest,
            retry_after,
            stage,
            can_observe,
        }))
    }

    pub(crate) fn recheck_atom_standard_delist_read(
        &self,
        work: &AtomStandardDelistWorkSeed,
        at: &str,
    ) -> Result<()> {
        let db = self.store.raw_connection();
        let workspace = &self.workspace_id;
        require_no_barrier(db, workspace)?;
        check_attempt(db, workspace, work, work.stage, work.retry_after.as_deref())?;
        let current = if work.claimed() {
            connection_is_current(db, workspace, &work.target)?
        } else {
            target_is_current(db, workspace, &work.target, at)?
        };
        if !work.can_observe || !current {
            return Err(STALE);
        }
        Ok(())
    }

    pub(crate) fn claim_atom_standard_delist<G>(
        &mut self,
        work: &AtomStandardDelistWorkSeed,
        observation: &DesktopAtomListingObservation,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let workspace = &self.workspace_id;
        if context.workspace_id != *workspace
            || work.claimed()
            || !work.matches_preflight(observation)
        {
            return Err(STALE);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        require_no_barrier(&tx, workspace)?;
        check_attempt(
            &tx,
            workspace,
            work,
            AttemptStage::Queued,
            work.retry_after.as_deref(),
        )?;
        if !target_is_current(&tx, workspace, &work.target, at)? {
            return Err(STALE);
        }
        marketplace_approval::record_claim(
            PURPOSE,
            &tx,
            context,
            &work.operation_id,
            &work.plan_id,
            &work.target.item_id,
            &work.request_digest,
            signer,
        )?;
        tx.execute(
            "UPDATE operation_attempts SET status='running',started_at=?4,retry_after=NULL
             WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
            params![workspace, work.operation_id, work.target.item_id, at],
        )
        .map_err(storage)?;
        next_sequence(&tx, at)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }

    pub(crate) fn recheck_atom_standard_delist_dispatch(
        &self,
        work: &AtomStandardDelistWorkSeed,
        at: &str,
        context: &ExecutionEvidenceContext,
    ) -> Result<()> {
        let workspace = &self.workspace_id;
        let db = self.store.raw_connection();
        if context.workspace_id != *workspace || work.claimed() {
            return Err(STALE);
        }
        require_no_barrier(db, workspace)?;
        check_attempt(db, workspace, work, AttemptStage::Claimed, None)?;
        if !target_is_current(db, workspace, &work.target, at)? {
            return Err(STALE);
        }
        let bound: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM device_execution_fact_outbox f
             JOIN afternic_listing_approvals a USING(workspace_id,operation_id)
             WHERE f.workspace_id=?1 AND f.operation_id=?2 AND f.item_id=?3 AND f.attempt_number=1
              AND f.source_device_id=?4 AND f.active_lease_epoch=?5 AND f.source_installation_digest=?6
              AND a.action=?7 AND a.credential_epoch=?8 AND a.signing_key_id=?9 AND a.signing_key_version=?10
              AND json_extract(f.envelope_json,'$.authorizationHash')=?11
              AND json_extract(f.envelope_json,'$.eventType')='atom_standard_delist_dispatch_claimed')",
            params![workspace,work.operation_id,work.target.item_id,context.source_device_id,
                sql(context.active_lease_epoch)?,context.source_installation_digest,ACTION,sql(context.credential_epoch)?,
                context.signing_key_id,sql(context.signing_key_version)?,context.authorization_hash],
            |row| row.get(0),
        ).map_err(storage)?;
        if !bound {
            return Err(STALE);
        }
        Ok(())
    }

    pub(crate) fn settle_atom_standard_delist_observation<G>(
        &mut self,
        work: &AtomStandardDelistWorkSeed,
        observed: Option<&DesktopAtomListingObservation>,
        at: &str,
        context: &ExecutionEvidenceContext,
        signer: &mut EvidenceSigner<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        let workspace = &self.workspace_id;
        if context.workspace_id != *workspace
            || observed.is_some_and(|fact| fact.domain != work.domain())
        {
            return Err(STALE);
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        require_no_barrier(&tx, workspace)?;
        check_attempt(
            &tx,
            workspace,
            work,
            work.stage,
            work.retry_after.as_deref(),
        )?;
        if work.claimed() {
            if !connection_is_current(&tx, workspace, &work.target)? {
                return Err(STALE);
            }
            if let Some(observed) = observed {
                super::validate_sha256_hex(&observed.resource_digest)?;
            }
            record_unverified_observation(&tx, work, observed, at, context, signer)?;
        } else if !connection_is_current(&tx, workspace, &work.target)? {
            refuse(&tx, work, "connection_changed", at, context, signer)?;
        } else if !target_is_current(&tx, workspace, &work.target, at)? {
            refuse(&tx, work, "precondition_changed", at, context, signer)?;
        } else if let Some(observed) = observed {
            if work.matches_preflight(observed) {
                return Err(STALE);
            }
            refuse(&tx, work, "provider_state_blocked", at, context, signer)?;
        } else {
            defer_observation(&tx, work, context, "read_failed")?;
        }
        next_sequence(&tx, at)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}

fn check_attempt(
    db: &Connection,
    workspace: &str,
    work: &AtomStandardDelistWorkSeed,
    stage: AttemptStage,
    retry_after: Option<&str>,
) -> Result<()> {
    let matches: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM operation_attempts a
         JOIN operation_plans p USING(workspace_id,plan_id)
         JOIN operations o USING(workspace_id,operation_id,plan_id)
         WHERE a.workspace_id=?1 AND a.operation_id=?2 AND a.plan_id=?3 AND a.item_id=?4
          AND a.attempt_number=1 AND a.request_digest=?5 AND a.status=?6 AND a.retry_after IS ?7
          AND p.operation_kind=?8 AND p.phase='executing' AND o.phase='running')",
            params![
                workspace,
                work.operation_id,
                work.plan_id,
                work.target.item_id,
                work.request_digest,
                stage.as_str(),
                retry_after,
                KIND
            ],
            |row| row.get(0),
        )
        .map_err(storage)?;
    if !matches || request_digest(&work.target)? != work.request_digest {
        return Err(STALE);
    }
    Ok(())
}

fn record_unverified_observation(
    tx: &Connection,
    work: &AtomStandardDelistWorkSeed,
    observation: Option<&DesktopAtomListingObservation>,
    at: &str,
    context: &ExecutionEvidenceContext,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    let (outcome, reason) = if observation.is_some() {
        (ReconciliationOutcome::Different, "postcondition_pending")
    } else {
        (ReconciliationOutcome::ReadFailed, "read_failed")
    };
    let latest: Option<String> = tx.query_row(
        "SELECT json_extract(result_json,'$.reason') FROM operation_results
         WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 ORDER BY result_version DESC LIMIT 1",
        params![context.workspace_id,work.operation_id,work.target.item_id],
        |row| row.get(0),
    ).optional().map_err(storage)?;
    if latest.as_deref() != Some(reason) {
        let (audit_id, audit_hash) = marketplace_approval::record_reconciliation(
            PURPOSE,
            tx,
            context,
            &work.operation_id,
            &work.target.item_id,
            &work.request_digest,
            outcome,
            signer,
        )?;
        tx.execute(
            "UPDATE operation_attempts SET status='waiting_remote',error_code=?4
              WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
            params![
                context.workspace_id,
                work.operation_id,
                work.target.item_id,
                reason
            ],
        )
        .map_err(storage)?;
        tx.execute(
            "INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,
              result_version,outcome,result_json,evidence_digest,observed_at)
             SELECT ?1,?2,?3,?4,1,coalesce(max(result_version),0)+1,'waiting_remote',
                    json_object('schemaVersion',1,'auditEventId',?5,'reason',?6),?7,?8
             FROM operation_results WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?4",
            params![context.workspace_id,work.operation_id,work.plan_id,work.target.item_id,audit_id,reason,audit_hash,at],
        ).map_err(storage)?;
    }
    defer_observation(tx, work, context, reason)
}

fn defer_observation(
    tx: &Connection,
    work: &AtomStandardDelistWorkSeed,
    context: &ExecutionEvidenceContext,
    reason: &str,
) -> Result<()> {
    let retry_seconds = if work.claimed() { 300 } else { 30 };
    let due: String = tx
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+'||?2||' seconds')",
            params![context.occurred_at, retry_seconds],
            |row| row.get(0),
        )
        .map_err(storage)?;
    super::validate_timestamp(Some(due.clone()))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    tx.execute(
        "UPDATE operation_attempts SET retry_after=?4,error_code=?5
         WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3 AND attempt_number=1",
        params![
            context.workspace_id,
            work.operation_id,
            work.target.item_id,
            due,
            reason
        ],
    )
    .map_err(storage)?;
    Ok(())
}

fn refuse(
    tx: &Connection,
    work: &AtomStandardDelistWorkSeed,
    reason: &str,
    at: &str,
    context: &ExecutionEvidenceContext,
    signer: &mut EvidenceSigner<'_>,
) -> Result<()> {
    let workspace = &context.workspace_id;
    let (audit_id, audit_hash) = marketplace_approval::record_preflight_refusal(
        PURPOSE,
        tx,
        context,
        &work.operation_id,
        &work.plan_id,
        &work.target.item_id,
        &work.request_digest,
        reason,
        signer,
    )?;
    tx.execute(
        "UPDATE operation_attempts SET status='failed_final',started_at=?4,completed_at=?4,
          retry_after=NULL,error_code=?5 WHERE workspace_id=?1 AND operation_id=?2 AND item_id=?3
          AND attempt_number=1",
        params![
            workspace,
            work.operation_id,
            work.target.item_id,
            at,
            reason
        ],
    )
    .map_err(storage)?;
    tx.execute(
        "INSERT INTO operation_results(workspace_id,operation_id,plan_id,item_id,attempt_number,
          result_version,outcome,result_json,evidence_digest,observed_at)
         VALUES(?1,?2,?3,?4,1,1,'failed_final',json_object('schemaVersion',1,'auditEventId',?5,'reason',?6),?7,?8)",
        params![workspace,work.operation_id,work.plan_id,work.target.item_id,audit_id,reason,audit_hash,at],
    ).map_err(storage)?;
    let settled: bool = tx
        .query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM operation_attempts
         WHERE workspace_id=?1 AND operation_id=?2 AND status IN ('queued','running','waiting_remote'))",
            params![workspace, work.operation_id],
            |row| row.get(0),
        )
        .map_err(storage)?;
    if settled {
        tx.execute(
            "UPDATE operations SET phase='partially_failed',completed_at=max(started_at,?3)
             WHERE workspace_id=?1 AND operation_id=?2",
            params![workspace, work.operation_id, at],
        )
        .map_err(storage)?;
        tx.execute(
            "UPDATE operation_plans SET phase='completed' WHERE workspace_id=?1 AND plan_id=?2",
            params![workspace, work.plan_id],
        )
        .map_err(storage)?;
    }
    Ok(())
}
