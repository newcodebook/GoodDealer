//! Host admission for preview, confirmation and Native claims on Atom Standard listings.
use super::{DesktopAtomConnection, RuntimeRestriction, database_error, now, require_observe};
use crate::{
    BusinessDatabaseError, DesktopAtomConnectionState, DesktopAtomListingObservation,
    DesktopAtomStandardDelistApproveRequest, DesktopAtomStandardDelistPreview,
    DesktopAtomStandardDelistPreviewRequest, DesktopAtomStandardDelistStatus,
    DesktopAtomStandardDelistStatusRequest, DesktopLocalHost, DesktopLocalHostError,
    DesktopNativeCloudAdmission,
    active_workspace::{
        business::{AtomConnectionSeed, AtomStandardDelistWorkSeed, BusinessDatabase},
        capability_qualification::{
            ATOM_MARKETPLACE_OBSERVE as OBSERVE, ATOM_MARKETPLACE_WRITE as WRITE,
            capability_qualified,
        },
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};

/// One Native-only attempt selected from the durable queue.
pub struct DesktopAtomStandardDelistWork {
    connection: DesktopAtomConnection,
    seed: AtomStandardDelistWorkSeed,
}

impl DesktopAtomStandardDelistWork {
    #[must_use]
    pub fn domain(&self) -> &str {
        self.seed.domain()
    }

    #[must_use]
    pub fn connection(&self) -> &DesktopAtomConnection {
        &self.connection
    }

    #[must_use]
    pub fn is_reconciliation(&self) -> bool {
        self.seed.claimed()
    }

    #[must_use]
    pub fn can_observe(&self) -> bool {
        self.seed.can_observe
    }
}

/// Minted only by the transaction that commits the first and only dispatch claim.
pub struct DesktopAtomStandardDelistClaim(DesktopAtomStandardDelistWork);

impl DesktopAtomStandardDelistClaim {
    #[must_use]
    pub fn domain(&self) -> &str {
        self.0.domain()
    }
}

fn require_write(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    require_observe(sync, run)?;
    if !capability_qualified(WRITE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    sync.require_provider_capability(run, WRITE)
}

fn require_exact_slot(
    db: &BusinessDatabase,
    connection: &AtomConnectionSeed,
) -> Result<(), DesktopSyncError> {
    let found = db
        .atom_connection(&connection.connection_id)
        .map_err(database_error)?;
    if found.state != DesktopAtomConnectionState::Active
        || found.incarnation_id != connection.incarnation_id
        || found.credential_proof != connection.credential_proof
    {
        return Err(DesktopSyncError::StaleAuthority);
    }
    Ok(())
}

impl DesktopLocalHost {
    /// Freezes a batch from the latest confirmed Standard evidence.
    /// # Errors
    /// Refuses unavailable authority, invalid targets, or stale inventory.
    pub fn preview_atom_standard_delist(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request: &DesktopAtomStandardDelistPreviewRequest,
    ) -> Result<DesktopAtomStandardDelistPreview, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            let db = business.database_for_backup();
            sync.recheck_sync_run(db, run)?;
            require_write(sync, run)?;
            require_provider_dispatch(db)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let context = self.execution_evidence_context(run)?;
            let plan = business
                .database_for_backup_mut()
                .preview_atom_standard_delist(request, &at, &context.occurred_at, || {
                    self.require_execution_context(run)
                        .map_err(|_| BusinessDatabaseError::MutationStale)?;
                    fence.verify(sync, run)
                })
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(plan)
        })
    }

    /// Approves exactly the stored preview. A replay returns the same operation identifier.
    /// # Errors
    /// Refuses expired, stale, or concurrently approved targets.
    pub fn approve_atom_standard_delist(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request: &DesktopAtomStandardDelistApproveRequest,
    ) -> Result<String, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            let db = business.database_for_backup();
            sync.recheck_sync_run(db, run)?;
            require_write(sync, run)?;
            require_provider_dispatch(db)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let context = self.execution_evidence_context(run)?;
            let mut inserted = false;
            let operation = business
                .database_for_backup_mut()
                .approve_atom_standard_delist(
                    request,
                    &at,
                    &context,
                    &mut |purpose, transcript| self.sign_execution_evidence(purpose, transcript),
                    |deadline| {
                        let current = self
                            .execution_evidence_context(run)
                            .map_err(|_| BusinessDatabaseError::MutationStale)?;
                        if deadline.is_some_and(|deadline| current.occurred_at.as_str() >= deadline)
                        {
                            return Err(BusinessDatabaseError::MutationStale);
                        }
                        inserted = deadline.is_some();
                        fence.verify(sync, run)
                    },
                )
                .map_err(database_error)?;
            if inserted {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(operation)
        })
    }

    /// Returns redacted persisted operation status.
    /// # Errors
    /// Refuses invalid plan identifiers, unavailable workspace authority, or invalid persisted data.
    pub fn read_atom_standard_delist_status(
        &self,
        request: &DesktopAtomStandardDelistStatusRequest,
    ) -> Result<DesktopAtomStandardDelistStatus, DesktopLocalHostError> {
        let at = now()?;
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            let capable = capability_qualified(OBSERVE)
                && capability_qualified(WRITE)
                && restriction == RuntimeRestriction::Active
                && [OBSERVE, WRITE]
                    .into_iter()
                    .all(|cap| authority.capabilities.iter().any(|value| value == cap));
            runtime
                .database_for_backup()
                .read_atom_standard_delist_status(request, &at, capable)
        })
    }

    /// Selects one due attempt. Observe-only authority receives only claimed work.
    /// # Errors
    /// Refuses a stale authorization, handoff barrier, or corrupt claim.
    pub fn next_atom_standard_delist_work(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopAtomStandardDelistWork>, DesktopLocalHostError> {
        let pending = self.with_sync_runtime(Some(&admission.inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(db)?;
            let context = self.execution_evidence_context(run)?;
            let writable = require_write(sync, run).is_ok();
            let Some(work) = db
                .next_atom_standard_delist_work(&context, writable)
                .map_err(database_error)?
            else {
                return Ok(None);
            };
            let seed = db
                .atom_connection(work.connection_id())
                .map_err(database_error)?;
            Ok(Some((work, seed)))
        })?;
        Ok(
            pending.map(|(seed, connection)| DesktopAtomStandardDelistWork {
                seed,
                connection: DesktopAtomConnection::new(admission, connection),
            }),
        )
    }

    /// Verifies work and exact credential scope before Native custody or HTTP.
    /// # Errors
    /// Refuses absent qualification, stale authority, changed scope, and noncurrent work.
    pub fn recheck_atom_standard_delist_read(
        &self,
        work: &DesktopAtomStandardDelistWork,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_runtime(Some(&work.connection.admission.inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            if work.is_reconciliation() {
                require_observe(sync, run)?;
            } else {
                require_write(sync, run)?;
            }
            require_provider_dispatch(db)?;
            self.require_execution_context(run)?;
            require_exact_slot(db, &work.connection.seed)?;
            db.recheck_atom_standard_delist_read(&work.seed, &at)
                .map_err(database_error)
        })
    }

    /// Commits the exact observation, minting a dispatch claim only for current Standard preflight.
    /// # Errors
    /// Refuses a changed target or authority, and rolls back if the final fence fails.
    pub fn commit_atom_standard_delist_preflight(
        &self,
        work: DesktopAtomStandardDelistWork,
        observation: Option<&DesktopAtomListingObservation>,
    ) -> Result<Option<DesktopAtomStandardDelistClaim>, DesktopLocalHostError> {
        if work.is_reconciliation() {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        if let Some(observed) = observation.filter(|fact| work.seed.matches_preflight(fact)) {
            match self.claim_atom_standard_delist(&work, observed) {
                Ok(()) => return Ok(Some(DesktopAtomStandardDelistClaim(work))),
                Err(DesktopLocalHostError::AuthorityRejected) => {}
                Err(error) => return Err(error),
            }
        }
        self.settle_atom_standard_delist(&work, observation)?;
        Ok(None)
    }

    fn claim_atom_standard_delist(
        &self,
        work: &DesktopAtomStandardDelistWork,
        observation: &DesktopAtomListingObservation,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, fence| {
                let db = business.database_for_backup();
                sync.recheck_sync_run(db, run)?;
                require_write(sync, run)?;
                require_provider_dispatch(db)?;
                require_exact_slot(db, &work.connection.seed)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let context = self.execution_evidence_context(run)?;
                business
                    .database_for_backup_mut()
                    .claim_atom_standard_delist(
                        &work.seed,
                        observation,
                        &at,
                        &context,
                        &mut |purpose, transcript| {
                            self.sign_execution_evidence(purpose, transcript)
                        },
                        || {
                            self.require_execution_context(run)
                                .map_err(|_| BusinessDatabaseError::MutationStale)?;
                            fence.verify(sync, run)
                        },
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(())
            },
        )
    }

    /// Rechecks the same claim while the Native send is in progress.
    /// # Errors
    /// Refuses a revoked or replaced connection, stale authorization or missing signed claim.
    pub fn recheck_atom_standard_delist_dispatch(
        &self,
        claim: &DesktopAtomStandardDelistClaim,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        let work = &claim.0;
        self.with_sync_runtime(Some(&work.connection.admission.inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            require_write(sync, run)?;
            require_provider_dispatch(db)?;
            require_exact_slot(db, &work.connection.seed)?;
            let context = self.execution_evidence_context(run)?;
            db.recheck_atom_standard_delist_dispatch(&work.seed, &at, &context)
                .map_err(database_error)
        })
    }

    /// Records preflight refusal or retry, or an unresolved read after a claim.
    /// # Errors
    /// Refuses stale admission, crossed observations or invalid attempt transitions.
    pub fn settle_atom_standard_delist(
        &self,
        work: &DesktopAtomStandardDelistWork,
        observation: Option<&DesktopAtomListingObservation>,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, fence| {
                let db = business.database_for_backup();
                sync.recheck_sync_run(db, run)?;
                if work.is_reconciliation() {
                    require_observe(sync, run)?;
                    require_exact_slot(db, &work.connection.seed)?;
                } else {
                    require_write(sync, run)?;
                }
                require_provider_dispatch(db)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let context = self.execution_evidence_context(run)?;
                business
                    .database_for_backup_mut()
                    .settle_atom_standard_delist_observation(
                        &work.seed,
                        observation,
                        &at,
                        &context,
                        &mut |purpose, transcript| {
                            self.sign_execution_evidence(purpose, transcript)
                        },
                        || {
                            self.require_execution_context(run)
                                .map_err(|_| BusinessDatabaseError::MutationStale)?;
                            fence.verify(sync, run)
                        },
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(())
            },
        )
    }
}
