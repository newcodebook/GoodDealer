//! Purpose-specific Afternic parent-plan facade; credentials and HTTP remain in Native/Core.
use super::afternic::{DesktopAfternicConnection, handle};
use super::{DesktopLocalHost, DesktopLocalHostError, current_unix_seconds, format_timestamp};
use crate::active_workspace::business::{
    AfternicDelistWorkSeed, DesktopAfternicDelistApproveRequest, DesktopAfternicDelistPlan,
    DesktopAfternicDelistPreviewRequest, DesktopAfternicDelistStatus,
    DesktopAfternicDelistStatusRequest, DesktopAfternicDelistWorkKind,
    DesktopAfternicListingObservation,
};
use crate::active_workspace::capability_qualification::capability_qualified;
use crate::desktop_sync_runtime::{DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime};
use crate::{BusinessDatabaseError, DesktopNativeCloudAdmission};
const OBSERVE: &str = "afternic:marketplace:observe";
const WRITE: &str = "afternic:marketplace:write";

/// A Native-only exact slot and approved item. Reconciliation never grants another DELETE.
pub struct DesktopAfternicDelistWork {
    connection: DesktopAfternicConnection,
    seed: AfternicDelistWorkSeed,
}
/// Issued only to the transaction that durably wins queued -> running; never recreated on restart.
pub struct DesktopAfternicDelistClaim {
    work: DesktopAfternicDelistWork,
}
impl std::fmt::Debug for DesktopAfternicDelistWork {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopAfternicDelistWork([REDACTED])")
    }
}
impl std::fmt::Debug for DesktopAfternicDelistClaim {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopAfternicDelistClaim([REDACTED])")
    }
}
impl DesktopAfternicDelistWork {
    #[must_use]
    pub const fn kind(&self) -> DesktopAfternicDelistWorkKind {
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
impl DesktopAfternicDelistClaim {
    #[must_use]
    pub const fn connection(&self) -> &DesktopAfternicConnection {
        &self.work.connection
    }
    #[must_use]
    pub fn domain(&self) -> &str {
        self.work.domain()
    }
    #[must_use]
    pub fn into_reconciliation(self) -> DesktopAfternicDelistWork {
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
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
    write: bool,
) -> Result<(), DesktopSyncError> {
    sync.require_provider_capability(run, OBSERVE)?;
    if !capability_qualified(OBSERVE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    if write {
        sync.require_provider_capability(run, WRITE)?;
        if !capability_qualified(WRITE) {
            return Err(DesktopSyncError::CapabilityUnqualified);
        }
    }
    Ok(())
}

impl DesktopLocalHost {
    /// Persists a bounded preview of the selected connection's latest complete observed inventory.
    /// # Errors
    /// Rejects malformed intent, stale bindings, unqualified capabilities and non-Active authority.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn preview_afternic_delist(
        &self,
        admission: DesktopNativeCloudAdmission,
        request: DesktopAfternicDelistPreviewRequest,
    ) -> Result<DesktopAfternicDelistPlan, DesktopLocalHostError> {
        if request.schema_version != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
            admitted(sync, run, true)?;
            self.require_execution_context(run)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let database = business.database_for_backup_mut();
            let seed = database
                .afternic_connection_seed(&request.connection_id)
                .map_err(database_error)?;
            let plan = database
                .preview_afternic_delist_with_time(
                    &seed,
                    &request.domains,
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
    pub fn approve_afternic_delist(
        &self,
        admission: DesktopNativeCloudAdmission,
        request: DesktopAfternicDelistApproveRequest,
    ) -> Result<DesktopAfternicDelistPlan, DesktopLocalHostError> {
        if request.schema_version != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
            admitted(sync, run, true)?;
            self.require_execution_context(run)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let evidence = self.execution_evidence_context(run)?;
            let preview = business
                .database_for_backup()
                .afternic_delist_plan(&request.plan_ref, &at)
                .map_err(database_error)?;
            let approval_deadline = preview.approved_at.is_none().then_some(preview.expires_at);

            let before = business
                .database_for_backup()
                .afternic_delist_commit_sequence()
                .map_err(database_error)?;
            let plan = business
                .database_for_backup_mut()
                .approve_afternic_delist_with_evidence(
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
                .afternic_delist_commit_sequence()
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
    pub fn read_afternic_delist_status(
        &self,
        request: DesktopAfternicDelistStatusRequest,
    ) -> Result<DesktopAfternicDelistStatus, DesktopLocalHostError> {
        if request.schema_version != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let at = now()?;
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            let mut status = runtime
                .database_for_backup()
                .afternic_delist_status(request.plan_ref.as_deref(), &at)?;
            status.write_qualified = capability_qualified(WRITE) && capability_qualified(OBSERVE);
            status.write_entitled = restriction == super::RuntimeRestriction::Active
                && [WRITE, OBSERVE]
                    .iter()
                    .all(|expected| authority.capabilities.iter().any(|cap| cap == expected));
            Ok(status)
        })
    }
    /// Selects one due read/preflight; running or unknown attempts can only return reconciliation work.
    /// # Errors
    /// Requires current observation entitlement/qualification and refuses malformed durable state.
    pub fn next_afternic_delist_work(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopAfternicDelistWork>, DesktopLocalHostError> {
        let at = now()?;
        let next =
            self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
                admitted(sync, run, false)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let allow_write = admitted(sync, run, true).is_ok();
                let before = business
                    .database_for_backup()
                    .afternic_delist_commit_sequence()
                    .map_err(database_error)?;
                let database = business.database_for_backup_mut();
                let next = database
                    .next_afternic_delist_work_with_evidence(
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
                        database
                            .admit_afternic_provider(&connection)
                            .map_err(database_error)?;
                        Ok((seed, connection))
                    })
                    .transpose()?;
                if business
                    .database_for_backup()
                    .afternic_delist_commit_sequence()
                    .map_err(database_error)?
                    != before
                {
                    business.advance_read_generation_after_sync_commit();
                }
                Ok(next)
            })?;
        Ok(next.map(|(seed, connection)| DesktopAfternicDelistWork {
            connection: handle(admission, connection),
            seed,
        }))
    }
    /// Rechecks the exact authority, slot, entity and binding around each Native read await.
    /// # Errors
    /// Rejects changed authority/generation or a work item already settled by another runner.
    pub fn recheck_afternic_delist_work(
        &self,
        work: &DesktopAfternicDelistWork,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&work.connection.admission.inner),
            |sync, database, run| {
                let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
                admitted(
                    sync,
                    run,
                    work.seed.kind == DesktopAfternicDelistWorkKind::Preflight,
                )?;
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                database
                    .recheck_afternic_delist_work(&work.seed)
                    .map_err(database_error)
            },
        )
    }
    /// Atomically checks the exact GET preimage and claims one DELETE, or settles absence/conflict.
    /// # Errors
    /// Rejects foreign/malformed observations, stale approval, duplicate claim or failed final fence.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn claim_afternic_delist(
        &self,
        mut work: DesktopAfternicDelistWork,
        observation: Option<DesktopAfternicListingObservation>,
    ) -> Result<Option<DesktopAfternicDelistClaim>, DesktopLocalHostError> {
        let at = now()?;
        let claimed = self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, guard| {
                admitted(sync, run, true)?;
                self.require_execution_context(run)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                let claimed = database
                    .claim_afternic_delist_with_evidence(
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
        work.seed.kind = DesktopAfternicDelistWorkKind::Reconcile;
        Ok(claimed.then_some(DesktopAfternicDelistClaim { work }))
    }
    /// Checks current write admission for a one-shot mutation claim around every DELETE await.
    /// # Errors
    /// Refuses revoked authority/credentials or a previously settled attempt.
    pub fn recheck_afternic_delist_claim(
        &self,
        claim: &DesktopAfternicDelistClaim,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&claim.work.connection.admission.inner),
            |sync, database, run| {
                let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
                admitted(sync, run, true)?;
                self.require_execution_context(run)?;
                database
                    .require_afternic_delist_write_open()
                    .map_err(database_error)?;
                database
                    .require_afternic_delist_signed_claim(
                        &claim.work.seed,
                        &self.execution_evidence_context(run)?,
                    )
                    .map_err(database_error)?;
                database
                    .admit_afternic_provider(&claim.work.connection.seed)
                    .map_err(database_error)?;
                database
                    .recheck_afternic_delist_work(&claim.work.seed)
                    .map_err(database_error)
            },
        )
    }
    /// Records an exact post-dispatch GET; absence and detach commit together behind the final fence.
    /// # Errors
    /// Refuses stale slot/entity/binding, malformed observation or failure of the publication fence.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the frozen Native/IPC facade intentionally consumes each request or observation value"
    )]
    pub fn reconcile_afternic_delist(
        &self,
        work: &DesktopAfternicDelistWork,
        observation: Option<DesktopAfternicListingObservation>,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, guard| {
                admitted(sync, run, false)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                database
                    .reconcile_afternic_delist_with_evidence(
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
    pub fn defer_afternic_delist_read(
        &self,
        work: &DesktopAfternicDelistWork,
        retry_after_seconds: Option<u32>,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, guard| {
                admitted(
                    sync,
                    run,
                    work.seed.kind == DesktopAfternicDelistWorkKind::Preflight,
                )?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                database
                    .admit_afternic_provider(&work.connection.seed)
                    .map_err(database_error)?;
                database
                    .defer_afternic_delist_read_with_evidence(
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
#[path = "afternic_delist_tests.rs"]
mod tests;
