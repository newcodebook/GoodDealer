//! One immutable local acceptance run. This record never supplies current execution authority.

#[cfg(all(
    feature = "afternic-controlled-acceptance",
    not(all(target_os = "linux", debug_assertions))
))]
compile_error!("afternic-controlled-acceptance requires Linux debug assertions");

use super::{
    AfternicConnectionSeed, BusinessDatabase, BusinessDatabaseError, ExecutionEvidenceContext,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
type Result<T> = std::result::Result<T, BusinessDatabaseError>;
pub(crate) const AFTERNIC_ACCEPTANCE_ENABLED: bool = cfg!(all(
    feature = "afternic-controlled-acceptance",
    target_os = "linux",
    debug_assertions
));
pub(crate) const AFTERNIC_ACCEPTANCE_EXPIRES: &str = "2026-11-26T23:59:59Z";
const RUN: &str = "afternic-wecin-linux-20261119";
const DOMAIN: &str = "wecin.com";
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAfternicControlledAcceptance {
    pub run_id: &'static str,
    pub domain: &'static str,
    pub expires_at: &'static str,
    pub connection_id: Option<String>,
}
fn rejected(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
fn integer(value: u64) -> Result<i64> {
    if !(1..=9_007_199_254_740_991).contains(&value) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    i64::try_from(value).map_err(|_| BusinessDatabaseError::InvalidInput)
}
fn valid_context(e: &ExecutionEvidenceContext) -> Result<()> {
    if !AFTERNIC_ACCEPTANCE_ENABLED
        || e.occurred_at.as_str() < "2026-11-19T00:00:00Z"
        || e.occurred_at.as_str() >= AFTERNIC_ACCEPTANCE_EXPIRES
    {
        return Err(BusinessDatabaseError::MutationStale);
    }
    for value in [&e.account_id, &e.workspace_id, &e.source_device_id] {
        super::validate_identifier(value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    }
    super::validate_timestamp(Some(e.occurred_at.clone()))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    Ok(())
}
/// Called inside the same transaction that first creates the prepared credential slot.
pub(super) fn bind(
    c: &Connection,
    e: &ExecutionEvidenceContext,
    seed: &AfternicConnectionSeed,
) -> Result<()> {
    valid_context(e)?;
    c.execute("INSERT INTO afternic_controlled_acceptance_runs(run_id,workspace_id,account_id,device_id,active_lease_epoch,credential_epoch,connection_id,connection_incarnation_id,credential_generation,credential_public_proof,expires_at,bound_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![RUN,e.workspace_id,e.account_id,e.source_device_id,integer(e.active_lease_epoch)?,integer(e.credential_epoch)?,seed.connection_id,seed.connection_incarnation_id,integer(seed.credential_generation)?,seed.credential_public_proof,AFTERNIC_ACCEPTANCE_EXPIRES,e.occurred_at]).map_err(rejected)?;
    Ok(())
}
impl BusinessDatabase {
    pub(crate) fn afternic_controlled_acceptance(
        &self,
        e: &ExecutionEvidenceContext,
        allow_unbound: bool,
    ) -> Result<DesktopAfternicControlledAcceptance> {
        valid_context(e)?;
        if e.workspace_id != self.workspace_id {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let c = self.store.raw_connection();
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM afternic_controlled_acceptance_runs)",
                [],
                |r| r.get(0),
            )
            .map_err(rejected)?;
        let id:Option<String>=c.query_row("SELECT connection_id FROM afternic_controlled_acceptance_runs WHERE run_id=?1 AND workspace_id=?2 AND account_id=?3 AND device_id=?4 AND active_lease_epoch=?5 AND credential_epoch=?6 AND expires_at=?7 AND bound_at<=?8",params![RUN,e.workspace_id,e.account_id,e.source_device_id,integer(e.active_lease_epoch)?,integer(e.credential_epoch)?,AFTERNIC_ACCEPTANCE_EXPIRES,e.occurred_at],|r|r.get(0)).optional().map_err(rejected)?;
        if let Some(id) = &id {
            let seed = self.afternic_connection_seed(id)?;
            self.admit_afternic_provider(&seed)?;
            let exact:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM afternic_controlled_acceptance_runs WHERE run_id=?1 AND connection_id=?2 AND connection_incarnation_id=?3 AND credential_generation=?4 AND credential_public_proof=?5)",params![RUN,seed.connection_id,seed.connection_incarnation_id,integer(seed.credential_generation)?,seed.credential_public_proof],|r|r.get(0)).map_err(rejected)?;
            if !exact {
                return Err(BusinessDatabaseError::MutationStale);
            }
        } else if exists || !allow_unbound {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(DesktopAfternicControlledAcceptance {
            run_id: RUN,
            domain: DOMAIN,
            expires_at: AFTERNIC_ACCEPTANCE_EXPIRES,
            connection_id: id,
        })
    }
    pub(crate) fn require_afternic_controlled_targets(
        &self,
        e: &ExecutionEvidenceContext,
        connection: &str,
        domains: impl IntoIterator<Item = impl AsRef<str>>,
    ) -> Result<()> {
        let scope = self.afternic_controlled_acceptance(e, false)?;
        if scope.connection_id.as_deref() != Some(connection)
            || domains.into_iter().any(|d| d.as_ref() != DOMAIN)
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }
    /// A due-work tick may reconcile stale durable items before returning a handle. Check the
    /// entire eligible queue first, so an old unrelated plan cannot be changed by this run.
    pub(crate) fn require_afternic_controlled_plans(
        &self,
        e: &ExecutionEvidenceContext,
        plan: Option<&str>,
    ) -> Result<()> {
        let scope = self.afternic_controlled_acceptance(e, false)?;
        let invalid:bool=self.store.raw_connection().query_row("SELECT EXISTS(SELECT 1 FROM operation_plans p JOIN operation_plan_items i USING(workspace_id,plan_id) WHERE p.workspace_id=?1 AND ((?2 IS NOT NULL AND p.plan_id=?2) OR (?2 IS NULL AND p.operation_kind IN ('afternic_delist','afternic_listing_write') AND p.phase IN ('approved','executing'))) AND (p.operation_kind NOT IN ('afternic_delist','afternic_listing_write') OR (p.operation_kind='afternic_listing_write' AND (json_extract(i.precondition_json,'$.action') IN ('create','update')) IS NOT TRUE) OR i.entity_id IS NOT ?3 OR i.connection_id IS NOT ?4 OR json_extract(i.precondition_json,'$.domain') IS NOT ?3 OR json_extract(i.precondition_json,'$.connectionId') IS NOT ?4))",params![self.workspace_id,plan,DOMAIN,scope.connection_id],|r|r.get(0)).map_err(rejected)?;
        if invalid {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "afternic_controlled_acceptance_tests.rs"]
mod tests;
