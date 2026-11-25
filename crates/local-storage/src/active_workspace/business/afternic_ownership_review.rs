//! Local ownership review admission never infers write authority from a retained claim.
#[cfg(test)]
use super::BusinessDatabase;
use super::{BusinessDatabaseError, ExecutionEvidenceContext};
use rusqlite::params;
#[cfg(test)]
impl BusinessDatabase {
    pub(crate) fn afternic_ownership_review_blocker(
        &self,
        context: &ExecutionEvidenceContext,
        domain: &str,
    ) -> Result<Option<&'static str>, BusinessDatabaseError> {
        if context.workspace_id != self.workspace_id {
            return Err(BusinessDatabaseError::MutationStale);
        }
        blocker(self.store.raw_connection(), context, domain)
    }
}
pub(super) fn blocker(
    c: &rusqlite::Connection,
    context: &ExecutionEvidenceContext,
    domain: &str,
) -> Result<Option<&'static str>, BusinessDatabaseError> {
    super::validate_domain_asset_id(domain).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    super::validate_timestamp(Some(context.occurred_at.clone()))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if !initial_source_complete(c, context)? {
        return Ok(Some("prior_outcome_unknown"));
    }
    let(unknown,cooldown):(bool,bool)=c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_ownership_review_claims c WHERE c.workspace_id=?1 AND c.domain=?2 AND NOT EXISTS(SELECT 1 FROM afternic_ownership_review_reconciliations r WHERE r.workspace_id=c.workspace_id AND r.operation_id=c.operation_id AND r.item_id=c.item_id AND r.outcome='confirmed')),EXISTS(SELECT 1 FROM afternic_ownership_review_claims c WHERE c.workspace_id=?1 AND c.domain=?2 AND ?3<c.retry_not_before)",params![context.workspace_id,domain,context.occurred_at],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    Ok(if unknown {
        Some("prior_outcome_unknown")
    } else if cooldown {
        Some("cooldown")
    } else {
        None
    })
}

/// Until activation persists a verified predecessor closure, a later lease or restored
/// replica cannot prove that its missing local claims were never dispatched. Remove this
/// restriction only with an exact activation-bound closure and authenticated 24h floor.
pub(super) fn initial_source_complete(
    c: &rusqlite::Connection,
    e: &ExecutionEvidenceContext,
) -> Result<bool, BusinessDatabaseError> {
    if e.active_lease_epoch != 1 {
        return Ok(false);
    }
    c.query_row("SELECT NOT EXISTS(SELECT 1 FROM initial_replica_installation_receipts WHERE workspace_id=?1) AND NOT EXISTS(SELECT 1 FROM execution_evidence_stream_heads WHERE workspace_id=?1 AND (source_device_id!=?2 OR active_lease_epoch!=?3 OR source_installation_digest!=?4))",params![e.workspace_id,e.source_device_id,1_i64,e.source_installation_digest],|r|r.get(0)).map_err(|_|BusinessDatabaseError::StorageRejected)
}
