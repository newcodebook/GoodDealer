//! Purpose-specific Afternic parent-plan facade; credentials and HTTP remain in Native/Core.
use super::afternic::{DesktopAfternicConnection, handle};
use super::{DesktopLocalHost, DesktopLocalHostError, current_unix_seconds, format_timestamp};
use crate::active_workspace::business::{
    AfternicListingPlanWorkSeed, DesktopAfternicListingObservation, DesktopAfternicListingPlan,
    DesktopAfternicListingPlanApproveRequest, DesktopAfternicListingPlanPreviewRequest,
    DesktopAfternicListingPlanStatus, DesktopAfternicListingPlanStatusRequest,
    DesktopAfternicListingWriteWorkKind,
};
use crate::active_workspace::capability_qualification::{
    AFTERNIC_OWNERSHIP_REVIEW, capability_qualified,
};
use crate::desktop_sync_runtime::{DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime};
use crate::{BusinessDatabaseError, DesktopNativeCloudAdmission};
const OBSERVE: &str = "afternic:marketplace:observe";
const WRITE: &str = "afternic:marketplace:write";

/// A Native-only exact slot and approved item. Reconciliation never grants another POST/PATCH.
pub struct DesktopAfternicListingPlanWork {
    connection: DesktopAfternicConnection,
    seed: AfternicListingPlanWorkSeed,
}
/// Issued only to the transaction that durably wins queued -> running; never recreated on restart.
pub struct DesktopAfternicListingPlanClaim {
    work: DesktopAfternicListingPlanWork,
}
impl std::fmt::Debug for DesktopAfternicListingPlanWork {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopAfternicListingPlanWork([REDACTED])")
    }
}
impl std::fmt::Debug for DesktopAfternicListingPlanClaim {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopAfternicListingPlanClaim([REDACTED])")
    }
}
impl DesktopAfternicListingPlanWork {
    #[must_use]
    pub const fn kind(&self) -> DesktopAfternicListingWriteWorkKind {
        self.seed.kind
    }
    #[must_use]
    pub const fn connection(&self) -> &DesktopAfternicConnection {
        &self.connection
    }
    #[must_use]
    pub fn domain(&self) -> &str {
        &self.seed.frozen.domain
    }
}
impl DesktopAfternicListingPlanClaim {
    #[must_use]
    pub const fn action(&self) -> crate::DesktopAfternicListingPlanAction {
        self.work.seed.frozen.action
    }
    #[must_use]
    pub const fn fields(&self) -> Option<&crate::DesktopAfternicListingWritePatch> {
        self.work.seed.frozen.changes.as_ref()
    }
    #[must_use]
    pub const fn connection(&self) -> &DesktopAfternicConnection {
        &self.work.connection
    }
    #[must_use]
    pub fn domain(&self) -> &str {
        self.work.domain()
    }
    #[must_use]
    pub fn into_reconciliation(self) -> DesktopAfternicListingPlanWork {
        self.work
    }
}
fn now() -> Result<String, DesktopLocalHostError> {
    Ok(format_timestamp(
        current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?,
    ))
}
fn database_error(error: BusinessDatabaseError) -> DesktopSyncError {
    match error {
        BusinessDatabaseError::MutationStale => DesktopSyncError::StaleAuthority,
        BusinessDatabaseError::InvalidInput => DesktopSyncError::InvalidInput,
        _ => DesktopSyncError::StorageRejected,
    }
}
fn admitted(
    host: &DesktopLocalHost,
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
    _database: &crate::active_workspace::business::BusinessDatabase,
    write: bool,
) -> Result<(), DesktopSyncError> {
    // Controlled v1 acceptance is deliberately not an authority for this distinct operation.
    sync.require_provider_capability(run, OBSERVE)?;
    if !capability_qualified(OBSERVE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    if write {
        sync.require_provider_capability(run, WRITE)?;
        if !capability_qualified(WRITE) || !capability_qualified(AFTERNIC_OWNERSHIP_REVIEW) {
            return Err(DesktopSyncError::CapabilityUnqualified);
        }
    }
    host.require_execution_context(run)
}

impl DesktopLocalHost {
    /// Persists a bounded preview of the selected connection's latest complete observed inventory.
    /// # Errors
    /// Rejects malformed intent, stale bindings, unqualified capabilities and non-Active authority.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn preview_afternic_listing_plan(
        &self,
        admission: DesktopNativeCloudAdmission,
        request: DesktopAfternicListingPlanPreviewRequest,
    ) -> Result<DesktopAfternicListingPlan, DesktopLocalHostError> {
        if request.schema_version() != 2 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        request
            .validate()
            .map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?;
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
            admitted(self, sync, run, business.database_for_backup(), true)?;
            self.require_execution_context(run)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let database = business.database_for_backup_mut();
            let seed = database
                .afternic_connection_seed(request.connection_id())
                .map_err(database_error)?;
            let plan = database
                .preview_afternic_listing_plan_with_time(
                    &seed,
                    &request,
                    &at,
                    &self.execution_evidence_context(run)?.occurred_at,
                    || {
                        self.require_execution_context(run)
                            .map_err(|_| BusinessDatabaseError::MutationStale)
                            .and_then(|()| guard.verify(sync, run))
                    },
                )
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(plan)
        })
    }
    /// Approves the exact immutable preview once; a repeated same-ref/hash response is idempotent.
    /// # Errors
    /// Rejects a changed/expired preview, concurrent target execution or stale current authority.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn approve_afternic_listing_plan(
        &self,
        admission: DesktopNativeCloudAdmission,
        request: DesktopAfternicListingPlanApproveRequest,
    ) -> Result<DesktopAfternicListingPlan, DesktopLocalHostError> {
        request
            .validate()
            .map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?;
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
            admitted(self, sync, run, business.database_for_backup(), true)?;
            self.require_execution_context(run)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let evidence = self.execution_evidence_context(run)?;
            let preview = business
                .database_for_backup()
                .afternic_listing_plan(&request.plan_ref, &at)
                .map_err(database_error)?;
            let approval_deadline = preview.approved_at.is_none().then_some(preview.expires_at);

            let before = business
                .database_for_backup()
                .afternic_listing_write_commit_sequence()
                .map_err(database_error)?;
            let plan = business
                .database_for_backup_mut()
                .approve_afternic_listing_plan_with_evidence(
                    &request.plan_ref,
                    &request.plan_hash,
                    &at,
                    &evidence,
                    &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                    || {
                        let current = self
                            .execution_evidence_context(run)
                            .map_err(|_| BusinessDatabaseError::MutationStale)?;
                        if approval_deadline
                            .as_ref()
                            .is_some_and(|deadline| current.occurred_at >= *deadline)
                        {
                            return Err(BusinessDatabaseError::MutationStale);
                        }
                        self.require_execution_context(run)
                            .map_err(|_| BusinessDatabaseError::MutationStale)
                            .and_then(|()| guard.verify(sync, run))
                    },
                )
                .map_err(database_error)?;
            if business
                .database_for_backup()
                .afternic_listing_write_commit_sequence()
                .map_err(database_error)?
                != before
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(plan)
        })
    }
    /// Reads recent plan summaries and optionally one exact detail under local read authority.
    /// # Errors
    /// Rejects malformed request or unadmitted reads; Standby can read but cannot approve or execute.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn read_afternic_listing_plan_status(
        &self,
        request: DesktopAfternicListingPlanStatusRequest,
    ) -> Result<DesktopAfternicListingPlanStatus, DesktopLocalHostError> {
        request
            .validate()
            .map_err(|_| DesktopLocalHostError::CloudProtocolRejected)?;
        let at = now()?;
        let mut status =
            self.with_authorized_business(false, |runtime, authority, _, restriction| {
                let mut status = runtime
                    .database_for_backup()
                    .afternic_listing_plan_status(request.plan_ref.as_deref(), &at)?;
                status.write_qualified =
                    capability_qualified(WRITE) && capability_qualified(OBSERVE);
                status.write_entitled = restriction == super::RuntimeRestriction::Active
                    && [WRITE, OBSERVE]
                        .iter()
                        .all(|expected| authority.capabilities.iter().any(|cap| cap == expected));
                status.ownership_review_qualified =
                    status.write_qualified && capability_qualified(AFTERNIC_OWNERSHIP_REVIEW);
                Ok(status)
            })?;
        // The Native composition intersects this Host authority with its live runner/power gate.
        status.ownership_review_execution_available = status.ownership_review_qualified
            && status.write_entitled
            && self.begin_native_cloud_run().is_ok_and(|admission| {
                self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
                    admitted(
                        self,
                        sync,
                        run.ok_or(DesktopSyncError::StaleAuthority)?,
                        database,
                        true,
                    )
                })
                .is_ok()
            });
        if !status.write_qualified && !status.ownership_review_qualified {
            status.controlled_acceptance = self.afternic_acceptance_status(true);
        }
        Ok(status)
    }
    /// Selects one due read/preflight; running or unknown attempts can only return reconciliation work.
    /// # Errors
    /// Requires current observation entitlement/qualification and refuses malformed durable state.
    pub fn next_afternic_listing_plan_work(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopAfternicListingPlanWork>, DesktopLocalHostError> {
        // Unqualified v2 must not starve an independently admitted legacy scheduler.
        if !capability_qualified(OBSERVE) {
            return Ok(None);
        }
        let at = now()?;
        let next =
            self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
                admitted(self, sync, run, business.database_for_backup(), false)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let allow_write =
                    admitted(self, sync, run, business.database_for_backup(), true).is_ok();
                let before = business
                    .database_for_backup()
                    .afternic_listing_write_commit_sequence()
                    .map_err(database_error)?;
                let database = business.database_for_backup_mut();
                let next = database
                    .next_afternic_listing_plan_work_with_evidence(
                        &at,
                        allow_write,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_execution_context(run)
                                .map_err(|_| BusinessDatabaseError::MutationStale)
                                .and_then(|()| guard.verify(sync, run))
                        },
                    )
                    .map_err(database_error)?;
                let next = next
                    .map(|seed| {
                        let connection = database
                            .afternic_connection_seed(&seed.frozen.connection_id)
                            .map_err(database_error)?;
                        if connection.connection_incarnation_id
                            != seed.frozen.connection_incarnation_id
                            || connection.credential_generation != seed.frozen.credential_generation
                        {
                            return Err(DesktopSyncError::StaleAuthority);
                        }
                        database
                            .admit_afternic_provider(&connection)
                            .map_err(database_error)?;
                        Ok((seed, connection))
                    })
                    .transpose()?;
                if business
                    .database_for_backup()
                    .afternic_listing_write_commit_sequence()
                    .map_err(database_error)?
                    != before
                {
                    business.advance_read_generation_after_sync_commit();
                }
                Ok(next)
            })?;
        Ok(
            next.map(|(seed, connection)| DesktopAfternicListingPlanWork {
                connection: handle(admission, connection),
                seed,
            }),
        )
    }
    /// Rechecks the exact authority, slot, entity and binding around each Native read await.
    /// # Errors
    /// Rejects changed authority/generation or a work item already settled by another runner.
    pub fn recheck_afternic_listing_plan_work(
        &self,
        work: &DesktopAfternicListingPlanWork,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&work.connection.admission.inner),
            |sync, database, run| {
                let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
                admitted(
                    self,
                    sync,
                    run,
                    database,
                    work.seed.kind == DesktopAfternicListingWriteWorkKind::Preflight,
                )?;
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                database
                    .recheck_afternic_listing_plan_work(&work.seed)
                    .map_err(database_error)
            },
        )
    }
    /// Atomically checks the exact GET preimage and claims one POST/PATCH, or settles absence/conflict.
    /// # Errors
    /// Rejects foreign/malformed observations, stale approval, duplicate claim or failed final fence.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn claim_afternic_listing_plan(
        &self,
        mut work: DesktopAfternicListingPlanWork,
        observation: Option<DesktopAfternicListingObservation>,
    ) -> Result<Option<DesktopAfternicListingPlanClaim>, DesktopLocalHostError> {
        let at = now()?;
        let claimed = self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, guard| {
                admitted(self, sync, run, business.database_for_backup(), true)?;
                self.require_execution_context(run)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                let claimed = database
                    .claim_afternic_listing_plan_with_evidence(
                        &work.seed,
                        observation.as_ref(),
                        &at,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_execution_context(run)
                                .map_err(|_| BusinessDatabaseError::MutationStale)
                                .and_then(|()| guard.verify(sync, run))
                        },
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(claimed)
            },
        )?;
        work.seed.kind = DesktopAfternicListingWriteWorkKind::Reconcile;
        Ok(claimed.then_some(DesktopAfternicListingPlanClaim { work }))
    }
    /// Checks current write admission for a one-shot mutation claim around every POST/PATCH await.
    /// # Errors
    /// Refuses revoked authority/credentials or a previously settled attempt.
    pub fn recheck_afternic_listing_plan_claim(
        &self,
        claim: &DesktopAfternicListingPlanClaim,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&claim.work.connection.admission.inner),
            |sync, database, run| {
                let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
                admitted(self, sync, run, database, true)?;
                self.require_execution_context(run)?;
                database
                    .require_afternic_listing_write_write_open()
                    .map_err(database_error)?;
                database
                    .require_afternic_listing_plan_signed_claim(
                        &claim.work.seed,
                        &self.execution_evidence_context(run)?,
                    )
                    .map_err(database_error)?;
                database
                    .admit_afternic_provider(&claim.work.connection.seed)
                    .map_err(database_error)?;
                database
                    .recheck_afternic_listing_plan_work(&claim.work.seed)
                    .map_err(database_error)
            },
        )
    }
    /// Records an exact post-dispatch GET; observation, binding, and result commit together
    /// behind the final fence.
    /// # Errors
    /// Refuses stale slot/entity/binding, malformed observation or failure of the publication fence.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn reconcile_afternic_listing_plan(
        &self,
        work: &DesktopAfternicListingPlanWork,
        observation: Option<DesktopAfternicListingObservation>,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, guard| {
                admitted(self, sync, run, business.database_for_backup(), false)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                database
                    .reconcile_afternic_listing_plan_with_evidence(
                        &work.seed,
                        observation.as_ref(),
                        &at,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_execution_context(run)
                                .map_err(|_| BusinessDatabaseError::MutationStale)
                                .and_then(|()| guard.verify(sync, run))
                        },
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(())
            },
        )
    }
    /// Persists bounded read-only backoff after a failed GET; this never makes a write retryable.
    /// # Errors
    /// Refuses stale handles, unrepresentable future timestamps or a failed final commit fence.
    pub fn defer_afternic_listing_plan_read(
        &self,
        work: &DesktopAfternicListingPlanWork,
        retry_after_seconds: Option<u32>,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, guard| {
                admitted(
                    self,
                    sync,
                    run,
                    business.database_for_backup(),
                    work.seed.kind == DesktopAfternicListingWriteWorkKind::Preflight,
                )?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                database
                    .defer_afternic_listing_plan_read_with_evidence(
                        &work.seed,
                        retry_after_seconds,
                        &at,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_execution_context(run)
                                .map_err(|_| BusinessDatabaseError::MutationStale)
                                .and_then(|()| guard.verify(sync, run))
                        },
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(())
            },
        )
    }
}

#[cfg(all(test, unix))]
#[path = "afternic_listing_plan_tests.rs"]
mod tests;
