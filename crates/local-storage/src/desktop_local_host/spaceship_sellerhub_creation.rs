//! Host admission for fixed-price `SellerHub` creation.
use super::{
    BusinessDatabaseError, DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission,
    DesktopSellerHubConnection, DesktopSpaceshipConnectionState, DesktopSyncError,
    DesktopSyncRunAdmission, DesktopSyncRuntime, OBSERVE, RuntimeRestriction, Serialize,
    WRITE, capability_qualified, database_error, now, require_observe, require_provider_dispatch,
};
use crate::{
    DesktopSellerHubCreateApproval, DesktopSellerHubCreateApproveRequest,
    DesktopSellerHubCreateDetail, DesktopSellerHubCreatePlanSummary, DesktopSellerHubCreatePreview,
    DesktopSellerHubCreatePreviewRequest, DesktopSellerHubCreateStatusRequest,
    SellerHubCreateReadback,
    active_workspace::{
        business::SellerHubCreateWork,
        capability_qualification::SPACESHIP_MARKETPLACE_CREATE as CREATE,
    },
};

pub struct DesktopSellerHubCreateWork {
    slot: CreationSlot,
    seed: SellerHubCreateWork,
}
enum CreationSlot {
    Active(DesktopSellerHubConnection),
    Withdrawn(DesktopNativeCloudAdmission),
}

impl DesktopSellerHubCreateWork {
    #[must_use]
    pub fn connection(&self) -> Option<&DesktopSellerHubConnection> {
        match &self.slot {
            CreationSlot::Active(connection) => Some(connection),
            CreationSlot::Withdrawn(_) => None,
        }
    }
    fn admission(&self) -> &DesktopNativeCloudAdmission {
        match &self.slot {
            CreationSlot::Active(connection) => &connection.admission,
            CreationSlot::Withdrawn(admission) => admission,
        }
    }
    #[must_use]
    pub fn domain(&self) -> &str {
        self.seed.domain()
    }
    #[must_use]
    pub fn price_cents(&self) -> u64 {
        self.seed.cents()
    }
    #[must_use]
    pub fn reconciliation_only(&self) -> bool {
        self.seed.reconciliation_only()
    }
}

pub struct DesktopSellerHubCreateClaim(DesktopSellerHubCreateWork);
impl DesktopSellerHubCreateClaim {
    #[must_use]
    pub fn details(&self) -> (&str, u64) {
        (self.0.domain(), self.0.price_cents())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSellerHubCreateStatus {
    pub schema_version: u8,
    pub write_qualified: bool,
    pub write_entitled: bool,
    pub execution_available: bool,
    pub recent: Vec<DesktopSellerHubCreatePlanSummary>,
    pub plan: Option<DesktopSellerHubCreateDetail>,
}

fn require_create(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    if !capability_qualified(CREATE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    require_observe(sync, run)?;
    sync.require_provider_capability(run, WRITE)
}

impl DesktopLocalHost {
    /// Persists the exact domains and fixed prices for `SellerHub` creation.
    ///
    /// # Errors
    /// Refuses unqualified write authority, stale execution context or noncurrent listing facts.
    pub fn preview_sellerhub_create(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request: &DesktopSellerHubCreatePreviewRequest,
    ) -> Result<DesktopSellerHubCreatePreview, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            let database = business.database_for_backup();
            sync.recheck_sync_run(database, run)?;
            require_create(sync, run)?;
            require_provider_dispatch(database)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let context = self.execution_evidence_context(run)?;
            let plan = business
                .database_for_backup_mut()
                .preview_sellerhub_create(request, &at, &context.occurred_at, || {
                    self.require_execution_context(run)
                        .map_err(|_| BusinessDatabaseError::MutationStale)?;
                    fence.verify(sync, run)
                })
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(plan)
        })
    }

    /// Approves the exact durable creation preview once under current Native authority.
    ///
    /// # Errors
    /// Refuses an expired, edited or superseded preview, a competing execution, or stale authority.
    pub fn approve_sellerhub_create(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request: &DesktopSellerHubCreateApproveRequest,
    ) -> Result<DesktopSellerHubCreateApproval, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            let database = business.database_for_backup();
            sync.recheck_sync_run(database, run)?;
            require_create(sync, run)?;
            require_provider_dispatch(database)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let context = self.execution_evidence_context(run)?;
            let (receipt, changed) = business
                .database_for_backup_mut()
                .approve_sellerhub_create(
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

    /// Selects a durable creation attempt under the current workspace and role.
    ///
    /// # Errors
    /// Refuses stale authority or invalid stored work.
    pub fn next_sellerhub_create_work(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopSellerHubCreateWork>, DesktopLocalHostError> {
        let selected = self.with_sync_runtime(Some(&admission.inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(db)?;
            let context = self.execution_evidence_context(run)?;
            // Qualification for a new POST can be withdrawn while a claim still needs readback.
            let Some(seed) = db
                .next_sellerhub_create_work(require_create(sync, run).is_ok(), &context)
                .map_err(database_error)?
            else {
                return Ok(None);
            };
            let connection = match db.sellerhub_connection(seed.connection_id()) {
                Ok(connection)
                    if connection.incarnation_id == seed.incarnation()
                        && connection.state == DesktopSpaceshipConnectionState::Active =>
                {
                    Some(connection)
                }
                Ok(_) | Err(BusinessDatabaseError::MutationStale)
                    if !seed.reconciliation_only() =>
                {
                    None
                }
                Ok(_) => return Err(DesktopSyncError::StaleAuthority),
                Err(error) => return Err(database_error(error)),
            };
            Ok(Some((seed, connection)))
        })?;
        Ok(
            selected.map(|(seed, connection)| DesktopSellerHubCreateWork {
                slot: match connection {
                    Some(connection) => {
                        CreationSlot::Active(DesktopSellerHubConnection::new(admission, connection))
                    }
                    None => CreationSlot::Withdrawn(admission),
                },
                seed,
            }),
        )
    }

    /// Checks current entitlement, active slot, and exact pending or claimed work before Native I/O.
    ///
    /// # Errors
    /// Rejects a superseded attempt or slot and an expired Native grant.
    pub fn recheck_sellerhub_create_read(
        &self,
        work: &DesktopSellerHubCreateWork,
    ) -> Result<(), DesktopLocalHostError> {
        self.check_sellerhub_create_io(work, false)
    }

    /// Rechecks the committed one-shot claim; no claim is reconstructed on reopen.
    ///
    /// # Errors
    /// Rejects withdrawn write authority or a claim superseded before dispatch.
    pub fn recheck_sellerhub_create_dispatch(
        &self,
        claim: &DesktopSellerHubCreateClaim,
    ) -> Result<(), DesktopLocalHostError> {
        self.check_sellerhub_create_io(&claim.0, true)
    }

    fn check_sellerhub_create_io(
        &self,
        work: &DesktopSellerHubCreateWork,
        dispatch: bool,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&work.admission().inner), |sync, db, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(db, run)?;
            if !dispatch && work.reconciliation_only() {
                require_observe(sync, run)?;
            } else {
                require_create(sync, run)?;
            }
            require_provider_dispatch(db)?;
            let context = self.execution_evidence_context(run)?;
            let slot = work.connection().ok_or(DesktopSyncError::StaleAuthority)?;
            let current = db
                .sellerhub_connection(work.seed.connection_id())
                .map_err(database_error)?;
            if current.credential_proof != slot.public_proof()
                || current.incarnation_id != slot.connection_incarnation()
                || current.state != DesktopSpaceshipConnectionState::Active
            {
                return Err(DesktopSyncError::StaleAuthority);
            }
            db.check_sellerhub_create_scope(&work.seed, dispatch, &context)
                .map_err(database_error)
        })
    }

    /// Records the authenticated complete preflight and yields a one-use claim only for absence.
    ///
    /// # Errors
    /// Rejects stale authority, malformed work, and an attempt already claimed.
    pub fn commit_sellerhub_create_preflight(
        &self,
        work: DesktopSellerHubCreateWork,
        inventory: Option<&[String]>,
    ) -> Result<Option<DesktopSellerHubCreateClaim>, DesktopLocalHostError> {
        if work.reconciliation_only() {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let at = now()?;
        let claimed = self.with_sync_business_write(
            &work.admission().inner,
            |sync, business, run, fence| {
                let db = business.database_for_backup();
                sync.recheck_sync_run(db, run)?;
                require_create(sync, run)?;
                require_provider_dispatch(db)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let context = self.execution_evidence_context(run)?;
                let guard = || {
                    self.require_execution_context(run)
                        .map_err(|_| BusinessDatabaseError::MutationStale)?;
                    fence.verify(sync, run)
                };
                let mut signer =
                    |purpose, bytes: &[u8]| self.sign_execution_evidence(purpose, bytes);
                let remote_present =
                    inventory.is_some_and(|rows| rows.iter().any(|domain| domain == work.domain()));
                let db = business.database_for_backup_mut();
                if let Some(rows) = inventory.filter(|_| !remote_present)
                    && db
                        .check_sellerhub_create_scope(&work.seed, false, &context)
                        .is_ok()
                {
                    db.claim_sellerhub_create(&work.seed, rows, &at, &context, &mut signer, guard)
                        .map_err(database_error)?;
                    business.advance_read_generation_after_sync_commit();
                    return Ok(true);
                }
                db.defer_or_refuse_sellerhub_create(
                    &work.seed,
                    remote_present,
                    &at,
                    &context,
                    &mut signer,
                    guard,
                )
                .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(false)
            },
        )?;
        Ok(claimed.then_some(DesktopSellerHubCreateClaim(work)))
    }

    /// Commits a readback for the prior claim under current observation authority.
    ///
    /// # Errors
    /// Rejects stale or revoked authority and any new attempt.
    pub fn settle_sellerhub_create(
        &self,
        work: &DesktopSellerHubCreateWork,
        observation: SellerHubCreateReadback,
        retry: Option<u32>,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&work.admission().inner, |sync, business, run, fence| {
            let db = business.database_for_backup();
            sync.recheck_sync_run(db, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(db)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let context = self.execution_evidence_context(run)?;
            business
                .database_for_backup_mut()
                .settle_sellerhub_create_observation(
                    &work.seed,
                    observation,
                    retry,
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
        })
    }

    /// Reads bounded plans and per-domain outcomes from the current workspace.
    ///
    /// # Errors
    /// Rejects invalid selections and inaccessible workspaces.
    pub fn read_sellerhub_create_status(
        &self,
        request: &DesktopSellerHubCreateStatusRequest,
    ) -> Result<DesktopSellerHubCreateStatus, DesktopLocalHostError> {
        let at = now()?;
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            let (recent, plan) = runtime
                .database_for_backup()
                .read_sellerhub_create_status(request, &at)?;
            Ok(DesktopSellerHubCreateStatus {
                schema_version: 1,
                write_qualified: capability_qualified(OBSERVE) && capability_qualified(CREATE),
                write_entitled: restriction == RuntimeRestriction::Active
                    && [OBSERVE, WRITE]
                        .iter()
                        .all(|cap| authority.capabilities.iter().any(|right| right == cap)),
                execution_available: false,
                recent,
                plan,
            })
        })
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::{
        DesktopSellerHubListingFact, DesktopSellerHubListingState,
        active_workspace::capability_qualification::test_qualification::qualify,
        desktop_local_host::{
            DesktopApplicationRoot, DesktopProductionCustody, Mutex, TestRebootstrapKeyStore,
            authority, execution_context,
        },
    };
    use serde_json::{json, to_value};

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the same Host and claim cross the exact change in technical qualification"
    )]
    fn sellerhub_create_reconciles_an_existing_claim_after_create_qualification_is_withdrawn() {
        let temp = crate::test_tempdir::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("GoodDealer");
        let root = DesktopApplicationRoot::validate(&path).unwrap();
        let store = TestRebootstrapKeyStore::default();
        let custody = DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
            &root,
            store.clone(),
        )
        .unwrap();
        let (verifier, grant) = authority::tests::long_lived_signed_grant_with_capabilities(
            2,
            &"22".repeat(32),
            "2099-12-31T23:59:59Z",
            2,
            &[OBSERVE, WRITE],
        );
        let role = serde_json::to_vec(&json!({
            "schemaVersion": 5,
            "role": "active",
            "grant": serde_json::from_slice::<serde_json::Value>(&grant).unwrap(),
        }))
        .unwrap();
        let mut host = DesktopLocalHost {
            application_root: Some(root),
            production_custody: Some(Mutex::new(custody)),
            authority_verifier: Some(verifier),
            ..DesktopLocalHost::default()
        };
        execution_context::tests::configure(&mut host, &store);
        host.activate_authorization_grant(&role).unwrap();
        execution_context::tests::admit(&host, &role);

        let _observe = qualify(OBSERVE);
        let create = qualify(CREATE);
        let admission = || host.begin_native_cloud_run().unwrap();
        let connection = host
            .prepare_sellerhub_connection(admission(), "SellerHub")
            .unwrap();
        let domains = ["first.test", "second.test"];
        let observations = domains.map(|domain| DesktopSellerHubListingFact {
            domain: domain.to_owned(),
            state: DesktopSellerHubListingState::Verifying,
            enabled_bin_price_usd: None,
        });
        host.commit_sellerhub_inventory(&connection, &observations)
            .unwrap();
        let connection_id = connection.connection_id();
        host.queue_sellerhub_inventory_refresh(&admission(), connection_id)
            .unwrap();
        let scan = host
            .resume_sellerhub_connection(admission(), connection_id)
            .unwrap();
        host.commit_sellerhub_inventory(&scan, &[]).unwrap();

        let request = serde_json::from_value(json!({
            "schemaVersion": 1,
            "connectionId": connection_id,
            "items": domains.map(|domain| json!({"domain": domain, "priceCents": 125_000})),
        }))
        .unwrap();
        let preview = to_value(
            host.preview_sellerhub_create(&admission(), &request)
                .unwrap(),
        )
        .unwrap();
        let approval = serde_json::from_value(json!({
            "schemaVersion": 1, "planId": preview["planId"], "planHash": preview["planHash"],
        }))
        .unwrap();
        host.approve_sellerhub_create(&admission(), &approval)
            .unwrap();

        let preflight = host
            .next_sellerhub_create_work(admission())
            .unwrap()
            .unwrap();
        assert!(!preflight.reconciliation_only());
        let claim = host
            .commit_sellerhub_create_preflight(preflight, Some(&[]))
            .unwrap()
            .unwrap();
        host.recheck_sellerhub_create_dispatch(&claim).unwrap();
        drop(create);
        assert!(host.recheck_sellerhub_create_dispatch(&claim).is_err());
        assert!(
            host.preview_sellerhub_create(&admission(), &request)
                .is_err()
        );

        let recovery = host
            .next_sellerhub_create_work(admission())
            .unwrap()
            .unwrap();
        assert!(recovery.reconciliation_only());
        assert_eq!(recovery.domain(), claim.details().0);
        host.recheck_sellerhub_create_read(&recovery).unwrap();
        host.settle_sellerhub_create(&recovery, SellerHubCreateReadback::Published, None)
            .unwrap();
        assert!(
            host.next_sellerhub_create_work(admission())
                .unwrap()
                .is_none()
        );
        let status_request =
            serde_json::from_value(json!({"schemaVersion": 1, "planId": preview["planId"]}))
                .unwrap();
        let status = to_value(host.read_sellerhub_create_status(&status_request).unwrap()).unwrap();
        assert_eq!(status["writeQualified"], false);
        assert_eq!(status["plan"]["items"][0]["state"], "published");
        assert_eq!(status["plan"]["items"][1]["state"], "queued");
    }
}
