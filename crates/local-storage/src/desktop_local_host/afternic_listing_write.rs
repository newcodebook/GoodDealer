//! Purpose-specific Afternic parent-plan facade; credentials and HTTP remain in Native/Core.
use super::afternic::{DesktopAfternicConnection, handle};
use super::{DesktopLocalHost, DesktopLocalHostError, current_unix_seconds, format_timestamp};
use crate::active_workspace::business::{
    AfternicListingWriteWorkSeed, DesktopAfternicListingObservation,
    DesktopAfternicListingWriteApproveRequest, DesktopAfternicListingWritePlan,
    DesktopAfternicListingWritePreviewRequest, DesktopAfternicListingWriteStatus,
    DesktopAfternicListingWriteStatusRequest, DesktopAfternicListingWriteWorkKind,
};
use crate::active_workspace::capability_qualification::capability_qualified;
use crate::desktop_sync_runtime::{DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime};
use crate::{BusinessDatabaseError, DesktopNativeCloudAdmission};
const OBSERVE: &str = "afternic:marketplace:observe";
const WRITE: &str = "afternic:marketplace:write";

/// A Native-only exact slot and approved item. Reconciliation never grants another POST/PATCH.
pub struct DesktopAfternicListingWriteWork {
    connection: DesktopAfternicConnection,
    seed: AfternicListingWriteWorkSeed,
}
/// Issued only to the transaction that durably wins queued -> running; never recreated on restart.
pub struct DesktopAfternicListingWriteClaim {
    work: DesktopAfternicListingWriteWork,
}
impl std::fmt::Debug for DesktopAfternicListingWriteWork {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopAfternicListingWriteWork([REDACTED])")
    }
}
impl std::fmt::Debug for DesktopAfternicListingWriteClaim {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopAfternicListingWriteClaim([REDACTED])")
    }
}
impl DesktopAfternicListingWriteWork {
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
impl DesktopAfternicListingWriteClaim {
    #[must_use]
    pub const fn action(&self) -> crate::DesktopAfternicListingWriteAction {
        self.work.seed.frozen.action
    }
    #[must_use]
    pub const fn fields(&self) -> &crate::DesktopAfternicListingWritePatch {
        &self.work.seed.frozen.changes
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
    pub fn into_reconciliation(self) -> DesktopAfternicListingWriteWork {
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
    database: &crate::active_workspace::business::BusinessDatabase,
    write: bool,
) -> Result<(), DesktopSyncError> {
    host.admit_afternic_access(sync, run, database, write, false)?;
    host.require_afternic_acceptance_plans(run, database, None, write)
}

impl DesktopLocalHost {
    /// Persists a bounded preview of the selected connection's latest complete observed inventory.
    /// # Errors
    /// Rejects malformed intent, stale bindings, unqualified capabilities and non-Active authority.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn preview_afternic_listing_write(
        &self,
        admission: DesktopNativeCloudAdmission,
        request: DesktopAfternicListingWritePreviewRequest,
    ) -> Result<DesktopAfternicListingWritePlan, DesktopLocalHostError> {
        if request.schema_version() != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
            admitted(self, sync, run, business.database_for_backup(), true)?;
            self.require_afternic_execution_context(run, true)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let database = business.database_for_backup_mut();
            let seed = database
                .afternic_connection_seed(request.connection_id())
                .map_err(database_error)?;
            let domains: Vec<&str> = match &request {
                DesktopAfternicListingWritePreviewRequest::Create { items, .. } => {
                    items.iter().map(|i| i.domain.as_str()).collect()
                }
                DesktopAfternicListingWritePreviewRequest::Update { items, .. } => {
                    items.iter().map(|i| i.domain.as_str()).collect()
                }
            };
            self.require_afternic_acceptance_targets(
                run,
                database,
                &seed.connection_id,
                domains,
                true,
            )?;
            let plan = database
                .preview_afternic_listing_write_with_time(
                    &seed,
                    &request,
                    &at,
                    &self.execution_evidence_context(run)?.occurred_at,
                    || {
                        self.require_afternic_execution_context(run, true)
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
    pub fn approve_afternic_listing_write(
        &self,
        admission: DesktopNativeCloudAdmission,
        request: DesktopAfternicListingWriteApproveRequest,
    ) -> Result<DesktopAfternicListingWritePlan, DesktopLocalHostError> {
        if request.schema_version != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
            admitted(self, sync, run, business.database_for_backup(), true)?;
            self.require_afternic_execution_context(run, true)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let evidence = self.execution_evidence_context(run)?;
            let preview = business
                .database_for_backup()
                .afternic_listing_write_plan(&request.plan_ref, &at)
                .map_err(database_error)?;
            self.require_afternic_acceptance_plans(
                run,
                business.database_for_backup(),
                Some(&request.plan_ref),
                true,
            )?;
            let approval_deadline = preview.approved_at.is_none().then_some(preview.expires_at);

            let before = business
                .database_for_backup()
                .afternic_listing_write_commit_sequence()
                .map_err(database_error)?;
            let plan = business
                .database_for_backup_mut()
                .approve_afternic_listing_write_with_evidence(
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
                        self.require_afternic_execution_context(run, true)
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
    pub fn read_afternic_listing_write_status(
        &self,
        request: DesktopAfternicListingWriteStatusRequest,
    ) -> Result<DesktopAfternicListingWriteStatus, DesktopLocalHostError> {
        if request.schema_version != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let at = now()?;
        let mut status =
            self.with_authorized_business(false, |runtime, authority, _, restriction| {
                let mut status = runtime
                    .database_for_backup()
                    .afternic_listing_write_status(request.plan_ref.as_deref(), &at)?;
                status.write_qualified =
                    capability_qualified(WRITE) && capability_qualified(OBSERVE);
                status.write_entitled = restriction == super::RuntimeRestriction::Active
                    && [WRITE, OBSERVE]
                        .iter()
                        .all(|expected| authority.capabilities.iter().any(|cap| cap == expected));
                Ok(status)
            })?;
        status.controlled_acceptance = self.afternic_acceptance_status(true);
        Ok(status)
    }
    /// Selects one due read/preflight; running or unknown attempts can only return reconciliation work.
    /// # Errors
    /// Requires current observation entitlement/qualification and refuses malformed durable state.
    pub fn next_afternic_listing_write_work(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopAfternicListingWriteWork>, DesktopLocalHostError> {
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
                    .next_afternic_listing_write_work_with_evidence(
                        &at,
                        allow_write,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_afternic_execution_context(run, false)
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
            next.map(|(seed, connection)| DesktopAfternicListingWriteWork {
                connection: handle(admission, connection),
                seed,
            }),
        )
    }
    /// Rechecks the exact authority, slot, entity and binding around each Native read await.
    /// # Errors
    /// Rejects changed authority/generation or a work item already settled by another runner.
    pub fn recheck_afternic_listing_write_work(
        &self,
        work: &DesktopAfternicListingWriteWork,
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
                    .recheck_afternic_listing_write_work(&work.seed)
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
    pub fn claim_afternic_listing_write(
        &self,
        mut work: DesktopAfternicListingWriteWork,
        observation: Option<DesktopAfternicListingObservation>,
    ) -> Result<Option<DesktopAfternicListingWriteClaim>, DesktopLocalHostError> {
        let at = now()?;
        let claimed = self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, guard| {
                admitted(self, sync, run, business.database_for_backup(), true)?;
                self.require_afternic_execution_context(run, true)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                let claimed = database
                    .claim_afternic_listing_write_with_evidence(
                        &work.seed,
                        observation.as_ref(),
                        &at,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_afternic_execution_context(run, true)
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
        Ok(claimed.then_some(DesktopAfternicListingWriteClaim { work }))
    }
    /// Checks current write admission for a one-shot mutation claim around every POST/PATCH await.
    /// # Errors
    /// Refuses revoked authority/credentials or a previously settled attempt.
    pub fn recheck_afternic_listing_write_claim(
        &self,
        claim: &DesktopAfternicListingWriteClaim,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&claim.work.connection.admission.inner),
            |sync, database, run| {
                let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
                admitted(self, sync, run, database, true)?;
                self.require_afternic_execution_context(run, true)?;
                database
                    .require_afternic_listing_write_write_open()
                    .map_err(database_error)?;
                database
                    .require_afternic_listing_write_signed_claim(
                        &claim.work.seed,
                        &self.execution_evidence_context(run)?,
                    )
                    .map_err(database_error)?;
                database
                    .admit_afternic_provider(&claim.work.connection.seed)
                    .map_err(database_error)?;
                database
                    .recheck_afternic_listing_write_work(&claim.work.seed)
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
    pub fn reconcile_afternic_listing_write(
        &self,
        work: &DesktopAfternicListingWriteWork,
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
                    .reconcile_afternic_listing_write_with_evidence(
                        &work.seed,
                        observation.as_ref(),
                        &at,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_afternic_execution_context(run, false)
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
    pub fn defer_afternic_listing_write_read(
        &self,
        work: &DesktopAfternicListingWriteWork,
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
                    .defer_afternic_listing_write_read_with_evidence(
                        &work.seed,
                        retry_after_seconds,
                        &at,
                        &self.execution_evidence_context(run)?,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                        || {
                            self.require_afternic_execution_context(
                                run,
                                work.seed.kind == DesktopAfternicListingWriteWorkKind::Preflight,
                            )
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
#[path = "afternic_listing_write_tests.rs"]
mod tests;
