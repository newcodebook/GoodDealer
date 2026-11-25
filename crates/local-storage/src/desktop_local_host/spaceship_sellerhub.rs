//! Exact `SellerHub` admission and publication through the workspace Host.
use super::{
    DesktopLocalHost, DesktopLocalHostError, RuntimeRestriction, current_unix_seconds,
    format_timestamp,
};
use crate::{
    BusinessDatabaseError, DesktopNativeCloudAdmission, DesktopSellerHubBinApproval,
    DesktopSellerHubBinApproveRequest, DesktopSellerHubBinPlan, DesktopSellerHubBinPlanSummary,
    DesktopSellerHubBinPreviewRequest, DesktopSellerHubBinStatusRequest,
    DesktopSellerHubConnectionSummary, DesktopSellerHubListingFact, DesktopSellerHubScanReceipt,
    DesktopSpaceshipConnectionState,
    active_workspace::{
        business::{SellerHubBinWorkSeed, SellerHubConnectionSeed, SellerHubInventoryCommit},
        capability_qualification::{
            SPACESHIP_MARKETPLACE_OBSERVE as OBSERVE, SPACESHIP_MARKETPLACE_WRITE as WRITE,
            capability_qualified,
        },
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};
use serde::Serialize;

#[path = "spaceship_sellerhub_creation.rs"]
mod creation;
pub use creation::{
    DesktopSellerHubCreateClaim, DesktopSellerHubCreateStatus, DesktopSellerHubCreateWork,
};

/// Opaque Native-only receipt for one exact credential incarnation and scan head.
pub struct DesktopSellerHubConnection {
    admission: DesktopNativeCloudAdmission,
    seed: SellerHubConnectionSeed,
    digest: String,
}

impl DesktopSellerHubConnection {
    fn new(admission: DesktopNativeCloudAdmission, seed: SellerHubConnectionSeed) -> Self {
        let digest = super::spaceship_account::spaceship_slot_digest(
            admission.workspace_id(),
            &seed.connection_id,
            &seed.incarnation_id,
        );
        Self {
            admission,
            seed,
            digest,
        }
    }

    #[must_use]
    pub fn connection_id(&self) -> &str {
        &self.seed.connection_id
    }
    #[must_use]
    pub fn connection_incarnation(&self) -> &str {
        &self.seed.incarnation_id
    }
    #[must_use]
    pub fn connection_digest(&self) -> &str {
        &self.digest
    }
    #[must_use]
    pub fn public_proof(&self) -> &str {
        &self.seed.credential_proof
    }
    #[must_use]
    pub fn is_prepared(&self) -> bool {
        self.seed.state == DesktopSpaceshipConnectionState::Prepared
    }
}

/// The next exact `SellerHub` price attempt. Native may use its connection only for this domain.
pub struct DesktopSellerHubBinWork {
    connection: DesktopSellerHubConnection,
    seed: SellerHubBinWorkSeed,
}

impl DesktopSellerHubBinWork {
    #[must_use]
    pub const fn connection(&self) -> &DesktopSellerHubConnection {
        &self.connection
    }
    #[must_use]
    pub fn domain(&self) -> &str {
        self.seed.domain()
    }
    #[must_use]
    pub const fn needs_reconciliation(&self) -> bool {
        self.seed.needs_reconciliation
    }

    #[must_use]
    pub const fn may_read_provider(&self) -> bool {
        self.seed.may_read_provider
    }
}

/// In-memory result of the one durable claim. Reopening reconstructs only reconciliation work.
pub struct DesktopSellerHubBinClaim(DesktopSellerHubBinWork);

impl DesktopSellerHubBinClaim {
    #[must_use]
    pub fn details(&self) -> (&DesktopSellerHubConnection, &str, u64) {
        (
            &self.0.connection,
            self.0.seed.domain(),
            self.0.seed.price_cents(),
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubStatus {
    pub schema_version: u8,
    pub observe_qualified: bool,
    pub observe_entitled: bool,
    pub connections: Vec<DesktopSellerHubConnectionSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubBinStatus {
    pub schema_version: u8,
    pub write_qualified: bool,
    pub write_entitled: bool,
    pub execution_available: bool,
    pub recent: Vec<DesktopSellerHubBinPlanSummary>,
    pub plan: Option<DesktopSellerHubBinPlan>,
}

fn database_error(error: BusinessDatabaseError) -> DesktopSyncError {
    match error {
        BusinessDatabaseError::MutationStale => DesktopSyncError::StaleAuthority,
        BusinessDatabaseError::InvalidInput => DesktopSyncError::InvalidInput,
        _ => DesktopSyncError::StorageRejected,
    }
}

fn now() -> Result<String, DesktopLocalHostError> {
    Ok(format_timestamp(
        current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?,
    ))
}

fn require_observe(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    if !capability_qualified(OBSERVE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    sync.require_provider_capability(run, OBSERVE)
}

fn require_bin_write(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    require_observe(sync, run)?;
    if !capability_qualified(WRITE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    sync.require_provider_capability(run, WRITE)
}

impl DesktopLocalHost {
    /// Persists the exact on-sale listings and prices a `SellerHub` BIN plan would change.
    ///
    /// # Errors
    /// Refuses unqualified write authority, stale execution context or noncurrent listing facts.
    pub fn preview_sellerhub_bin_price(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request: &DesktopSellerHubBinPreviewRequest,
    ) -> Result<DesktopSellerHubBinPlan, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            let database = business.database_for_backup();
            sync.recheck_sync_run(database, run)?;
            require_bin_write(sync, run)?;
            require_provider_dispatch(database)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let context = self.execution_evidence_context(run)?;
            let plan = business
                .database_for_backup_mut()
                .preview_sellerhub_bin_price(request, &at, &context.occurred_at, || {
                    self.require_execution_context(run)
                        .map_err(|_| BusinessDatabaseError::MutationStale)?;
                    fence.verify(sync, run)
                })
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(plan)
        })
    }

    /// Approves the exact durable BIN price preview once under current Native authority.
    ///
    /// # Errors
    /// Refuses an expired, edited or superseded preview, a competing execution, or stale authority.
    pub fn approve_sellerhub_bin_price(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request: &DesktopSellerHubBinApproveRequest,
    ) -> Result<DesktopSellerHubBinApproval, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            let database = business.database_for_backup();
            sync.recheck_sync_run(database, run)?;
            require_bin_write(sync, run)?;
            require_provider_dispatch(database)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let context = self.execution_evidence_context(run)?;
            let (receipt, changed) = business
                .database_for_backup_mut()
                .approve_sellerhub_bin_price(
                    request,
                    &at,
                    &context,
                    &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
                    |deadline| {
                        let current = self
                            .execution_evidence_context(run)
                            .map_err(|_| BusinessDatabaseError::MutationStale)?;
                        if deadline.is_some_and(|limit| current.occurred_at.as_str() >= limit) {
                            return Err(BusinessDatabaseError::MutationStale);
                        }
                        fence.verify(sync, run)
                    },
                )
                .map_err(database_error)?;
            if changed {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(receipt)
        })
    }

    /// Selects one durable price attempt. Previously claimed work is available for reads only.
    ///
    /// # Errors
    /// Refuses unknown authority, handoff, invalid persisted work or a changed connection.
    pub fn next_sellerhub_bin_work(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopSellerHubBinWork>, DesktopLocalHostError> {
        let result = self.with_sync_runtime(Some(&admission.inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(db)?;
            let context = self.execution_evidence_context(run)?;
            let may_claim = require_bin_write(sync, run).is_ok();
            let Some(seed) = db
                .next_sellerhub_bin_work(may_claim, &context)
                .map_err(database_error)?
            else {
                return Ok(None);
            };
            let connection = db
                .sellerhub_connection(seed.connection_id())
                .map_err(database_error)?;
            if seed.may_read_provider
                && (connection.incarnation_id != seed.connection_incarnation()
                    || connection.state != DesktopSpaceshipConnectionState::Active)
            {
                return Err(DesktopSyncError::StaleAuthority);
            }
            Ok(Some((seed, connection)))
        })?;
        Ok(result.map(|(seed, connection)| DesktopSellerHubBinWork {
            connection: DesktopSellerHubConnection::new(admission, connection),
            seed,
        }))
    }

    /// Rechecks an exact price observation independently of pending inventory scans.
    ///
    /// # Errors
    /// Refuses stale authority, expired permissions, replaced connections and stale work.
    pub fn recheck_sellerhub_bin_read(
        &self,
        work: &DesktopSellerHubBinWork,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&work.connection.admission.inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            if work.needs_reconciliation() {
                require_observe(sync, run)?;
            } else {
                require_bin_write(sync, run)?;
            }
            require_provider_dispatch(db)?;
            self.require_execution_context(run)?;
            let fresh = db
                .sellerhub_connection(work.seed.connection_id())
                .map_err(database_error)?;
            if fresh.state != DesktopSpaceshipConnectionState::Active
                || fresh.incarnation_id != work.connection.seed.incarnation_id
                || fresh.credential_proof != work.connection.seed.credential_proof
            {
                return Err(DesktopSyncError::StaleAuthority);
            }
            db.recheck_sellerhub_bin_read(&work.seed)
                .map_err(database_error)
        })
    }

    /// Applies an exact preflight read and returns a write claim only for the original price.
    ///
    /// # Errors
    /// Refuses mismatched observations, changed or revoked authority, and any prior claim.
    pub fn commit_sellerhub_bin_preflight(
        &self,
        work: DesktopSellerHubBinWork,
        observation: Option<&DesktopSellerHubListingFact>,
        retry_after_seconds: Option<u32>,
    ) -> Result<Option<DesktopSellerHubBinClaim>, DesktopLocalHostError> {
        if work.needs_reconciliation() {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        if let Some(observed) = observation.filter(|fact| work.seed.matches_prior_price(fact)) {
            match self.claim_sellerhub_bin_write(&work, observed) {
                Ok(()) => return Ok(Some(DesktopSellerHubBinClaim(work))),
                Err(DesktopLocalHostError::AuthorityRejected) => {
                    // The latest local inventory can supersede the approved preview during GET.
                    // Settlement rechecks authority and records that refusal only if the new state proves it.
                }
                Err(other) => return Err(other),
            }
        }
        self.settle_sellerhub_bin_observation(&work, observation, retry_after_seconds)?;
        Ok(None)
    }

    fn claim_sellerhub_bin_write(
        &self,
        work: &DesktopSellerHubBinWork,
        observed: &DesktopSellerHubListingFact,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, fence| {
                let db = business.database_for_backup();
                sync.recheck_sync_run(db, run)?;
                require_bin_write(sync, run)?;
                require_provider_dispatch(db)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let context = self.execution_evidence_context(run)?;
                business
                    .database_for_backup_mut()
                    .claim_sellerhub_bin_write(
                        &work.seed,
                        observed,
                        &at,
                        &context,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
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

    /// Rechecks a Native-only claim immediately before and during its one dispatch.
    ///
    /// # Errors
    /// Refuses stale authority, changed inventory, a revoked connection or a missing durable fact.
    pub fn recheck_sellerhub_bin_dispatch(
        &self,
        claim: &DesktopSellerHubBinClaim,
    ) -> Result<(), DesktopLocalHostError> {
        let work = &claim.0;
        let at = now()?;
        self.with_sync_runtime(Some(&work.connection.admission.inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            require_bin_write(sync, run)?;
            require_provider_dispatch(db)?;
            let context = self.execution_evidence_context(run)?;
            db.recheck_sellerhub_bin_dispatch(&work.seed, &at, &context)
                .map_err(database_error)
        })
    }

    /// Records an exact read result or a read retry against the durable item.
    ///
    /// # Errors
    /// Refuses stale authority, mismatched connection/binding or an invalid attempt transition.
    pub fn settle_sellerhub_bin_observation(
        &self,
        work: &DesktopSellerHubBinWork,
        observation: Option<&DesktopSellerHubListingFact>,
        retry_after_seconds: Option<u32>,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &work.connection.admission.inner,
            |sync, business, run, fence| {
                let db = business.database_for_backup();
                sync.recheck_sync_run(db, run)?;
                if work.needs_reconciliation() {
                    require_observe(sync, run)?;
                } else {
                    require_bin_write(sync, run)?;
                }
                require_provider_dispatch(db)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let context = self.execution_evidence_context(run)?;
                business
                    .database_for_backup_mut()
                    .settle_sellerhub_bin_observation(
                        &work.seed,
                        observation,
                        retry_after_seconds,
                        &at,
                        &context,
                        &mut |purpose, bytes| self.sign_execution_evidence(purpose, bytes),
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

    /// Reads the current workspace's redacted `SellerHub` BIN plans and per-item results.
    ///
    /// # Errors
    /// Refuses unavailable workspace authority or invalid selections or stored plan data.
    pub fn read_sellerhub_bin_status(
        &self,
        request: &DesktopSellerHubBinStatusRequest,
    ) -> Result<DesktopSellerHubBinStatus, DesktopLocalHostError> {
        let at = now()?;
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            let (recent, plan) = runtime
                .database_for_backup()
                .read_sellerhub_bin_status(request, &at)?;
            Ok(DesktopSellerHubBinStatus {
                schema_version: 1,
                write_qualified: capability_qualified(OBSERVE) && capability_qualified(WRITE),
                write_entitled: restriction == RuntimeRestriction::Active
                    && [OBSERVE, WRITE]
                        .iter()
                        .all(|cap| authority.capabilities.iter().any(|value| value == cap)),
                execution_available: false,
                recent,
                plan,
            })
        })
    }

    /// Returns only the public connection state and counts from the last complete local scan.
    ///
    /// # Errors
    /// Refuses unavailable authority or malformed persisted settings.
    pub fn read_sellerhub_status(&self) -> Result<DesktopSellerHubStatus, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            Ok(DesktopSellerHubStatus {
                schema_version: 1,
                observe_qualified: capability_qualified(OBSERVE),
                observe_entitled: restriction == RuntimeRestriction::Active
                    && authority.capabilities.iter().any(|cap| cap == OBSERVE),
                connections: runtime
                    .database_for_backup()
                    .sellerhub_connection_summaries(
                        (restriction == RuntimeRestriction::Active)
                            .then_some((authority.device_id.as_str(), authority.lease_epoch)),
                    )?,
            })
        })
    }

    /// Persists the exact refresh before the Native command acknowledges admission.
    ///
    /// # Errors
    /// Refuses revoked slots, stale authority and mismatched connection identifiers.
    pub fn queue_sellerhub_inventory_refresh(
        &self,
        admission: &DesktopNativeCloudAdmission,
        id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            sync.recheck_sync_run(business.database_for_backup(), run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(business.database_for_backup())?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            business
                .database_for_backup_mut()
                .queue_sellerhub_scan(id, (run.device_id(), run.lease_epoch()), || {
                    fence.verify(sync, run)
                })
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(())
        })
    }

    /// Loads the previously admitted request. Recovery cannot assign a new device or Lease.
    /// # Errors
    /// Refuses a missing, revoked or out-of-scope request.
    pub fn resume_sellerhub_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        id: &str,
    ) -> Result<DesktopSellerHubConnection, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(database)?;
            let seed = database.sellerhub_connection(id).map_err(database_error)?;
            if !seed.has_scan_for(run.device_id(), run.lease_epoch()) {
                return Err(DesktopSyncError::StaleAuthority);
            }
            Ok(seed)
        })?;
        Ok(DesktopSellerHubConnection::new(admission, seed))
    }

    /// Rechecks the exact slot immediately before Native operations and after awaits.
    ///
    /// # Errors
    /// Refuses an expired admission, another connection or a newer scan.
    pub fn recheck_sellerhub_connection(
        &self,
        connection: &DesktopSellerHubConnection,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&connection.admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            if connection.seed.state != DesktopSpaceshipConnectionState::Revoked {
                require_observe(sync, run)?;
                require_provider_dispatch(database)?;
                if !connection
                    .seed
                    .has_scan_for(run.device_id(), run.lease_epoch())
                {
                    return Err(DesktopSyncError::StaleAuthority);
                }
            }
            let current = database
                .sellerhub_connection(connection.connection_id())
                .map_err(database_error)?;
            if current != connection.seed {
                return Err(DesktopSyncError::StaleAuthority);
            }
            Ok(())
        })
    }

    /// Publishes a complete authenticated scan and the resulting asset changes together.
    ///
    /// # Errors
    /// Invalid inventory, stale authority and out-of-order scans all roll back.
    pub fn commit_sellerhub_inventory(
        &self,
        connection: &DesktopSellerHubConnection,
        listings: &[DesktopSellerHubListingFact],
    ) -> Result<DesktopSellerHubScanReceipt, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&connection.admission.inner, |sync, business, run, fence| {
            sync.recheck_sync_run(business.database_for_backup(), run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(business.database_for_backup())?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let receipt = business
                .database_for_backup_mut()
                .import_sellerhub_inventory(
                    &SellerHubInventoryCommit {
                        seed: &connection.seed,
                        listings,
                        device_id: run.device_id(),
                        lease_epoch: run.lease_epoch(),
                        at: &at,
                    },
                    || fence.verify(sync, run),
                )
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(receipt)
        })
    }
}
