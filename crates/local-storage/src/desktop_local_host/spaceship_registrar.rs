//! Exact Spaceship admission and publication through the workspace Host.
use super::{
    DesktopLocalHost, DesktopLocalHostError, RuntimeRestriction, current_unix_seconds,
    format_timestamp,
};
use crate::{
    BusinessDatabaseError, DesktopNativeCloudAdmission, DesktopRegistrarScanReceipt,
    DesktopRegistrationFact, DesktopSpaceshipConnectionState, DesktopSpaceshipConnectionSummary,
    active_workspace::{
        business::{SpaceshipConnectionSeed, SpaceshipInventoryCommit},
        capability_qualification::{
            SPACESHIP_MARKETPLACE_OBSERVE, SPACESHIP_REGISTRAR_OBSERVE as OBSERVE,
            capability_qualified,
        },
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};
use serde::Serialize;

/// Opaque Native-only receipt for one exact credential incarnation and scan head.
pub struct DesktopSpaceshipConnection {
    admission: DesktopNativeCloudAdmission,
    seed: SpaceshipConnectionSeed,
    digest: String,
}

impl DesktopSpaceshipConnection {
    fn new(admission: DesktopNativeCloudAdmission, seed: SpaceshipConnectionSeed) -> Self {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSpaceshipRegistrarStatus {
    pub schema_version: u8,
    pub observe_qualified: bool,
    pub observe_entitled: bool,
    /// One connect serves every Spaceship role, so it opens when any role is qualified and
    /// entitled, even when Registrar observation itself is not.
    pub connect_available: bool,
    pub connections: Vec<DesktopSpaceshipConnectionSummary>,
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

impl DesktopLocalHost {
    /// Returns only the public connection state and counts from the last complete local scan.
    ///
    /// # Errors
    /// Refuses unavailable authority or malformed persisted settings.
    pub fn read_spaceship_registrar_status(
        &self,
    ) -> Result<DesktopSpaceshipRegistrarStatus, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            Ok(DesktopSpaceshipRegistrarStatus {
                schema_version: 1,
                observe_qualified: capability_qualified(OBSERVE),
                observe_entitled: restriction == RuntimeRestriction::Active
                    && authority.capabilities.iter().any(|cap| cap == OBSERVE),
                connect_available: restriction == RuntimeRestriction::Active
                    && [OBSERVE, SPACESHIP_MARKETPLACE_OBSERVE].iter().any(|role| {
                        capability_qualified(role)
                            && authority.capabilities.iter().any(|cap| cap == role)
                    }),
                connections: runtime
                    .database_for_backup()
                    .spaceship_connection_summaries(
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
    pub fn queue_spaceship_inventory_refresh(
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
                .queue_spaceship_scan(id, (run.device_id(), run.lease_epoch()), || {
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
    pub fn resume_spaceship_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        id: &str,
    ) -> Result<DesktopSpaceshipConnection, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(database)?;
            let seed = database.spaceship_connection(id).map_err(database_error)?;
            if !seed.has_scan_for(run.device_id(), run.lease_epoch()) {
                return Err(DesktopSyncError::StaleAuthority);
            }
            Ok(seed)
        })?;
        Ok(DesktopSpaceshipConnection::new(admission, seed))
    }

    /// Rechecks the exact slot immediately before Native operations and after awaits.
    ///
    /// # Errors
    /// Refuses an expired admission, another connection or a newer scan.
    pub fn recheck_spaceship_connection(
        &self,
        connection: &DesktopSpaceshipConnection,
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
                .spaceship_connection(connection.connection_id())
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
    pub fn commit_spaceship_inventory(
        &self,
        connection: &DesktopSpaceshipConnection,
        registrations: &[DesktopRegistrationFact],
    ) -> Result<DesktopRegistrarScanReceipt, DesktopLocalHostError> {
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
                .import_spaceship_inventory(
                    &SpaceshipInventoryCommit {
                        seed: &connection.seed,
                        registrations,
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::active_workspace::capability_qualification::test_qualification;
    use crate::{BusinessDatabase, LocalDatabaseKey, SpaceshipRoles};

    #[test]
    fn preflight_is_read_only_and_refresh_rechecks_the_current_workspace() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let host = |workspace: &str, capabilities: &[&str]| {
            let root = directory.path().join(workspace);
            std::fs::create_dir(&root).unwrap();
            let database = BusinessDatabase::open(
                &root.join("workspace.db"),
                &LocalDatabaseKey::from_bytes([0x62; 32]),
                workspace,
            )
            .unwrap();
            DesktopLocalHost::development_with_provider_capabilities(
                database,
                root,
                "account-local",
                workspace,
                "device-local",
                capabilities,
            )
            .unwrap()
        };
        let local = host("workspace-local", &[OBSERVE]);
        let other = host("workspace-other", &[OBSERVE]);
        let unentitled = host("workspace-unentitled", &[]);
        let admission = local.begin_native_cloud_run().unwrap();
        assert_eq!(
            local.recheck_spaceship_account_preparation(&admission, None),
            Err(DesktopLocalHostError::CapabilityUnqualified)
        );

        let _qualification = test_qualification::qualify(OBSERVE);
        assert!(
            unentitled
                .recheck_spaceship_account_preparation(
                    &unentitled.begin_native_cloud_run().unwrap(),
                    None,
                )
                .is_err()
        );
        assert!(
            other
                .recheck_spaceship_account_preparation(&admission, None)
                .is_err()
        );
        local
            .recheck_spaceship_account_preparation(&admission, None)
            .unwrap();
        assert!(
            local
                .read_spaceship_registrar_status()
                .unwrap()
                .connections
                .is_empty()
        );

        let account = local
            .prepare_spaceship_account(
                local.begin_native_cloud_run().unwrap(),
                "Spaceship",
                SpaceshipRoles::REGISTRAR,
            )
            .unwrap();
        let connection = local
            .resume_spaceship_connection(
                local.begin_native_cloud_run().unwrap(),
                account.connection_id(),
            )
            .unwrap();
        let id = connection.connection_id();
        local.commit_spaceship_inventory(&connection, &[]).unwrap();
        assert!(
            local
                .resume_spaceship_connection(local.begin_native_cloud_run().unwrap(), id)
                .is_err()
        );
        assert!(
            other
                .queue_spaceship_inventory_refresh(&admission, id)
                .is_err()
        );
        local
            .queue_spaceship_inventory_refresh(&admission, id)
            .unwrap();
        let refresh = local
            .resume_spaceship_connection(local.begin_native_cloud_run().unwrap(), id)
            .unwrap();
        local.recheck_spaceship_connection(&refresh).unwrap();

        local.enter_security_lock().unwrap();
        assert!(local.commit_spaceship_inventory(&refresh, &[]).is_err());
        assert!(
            local
                .recheck_spaceship_account_preparation(&admission, None)
                .is_err()
        );
    }
}
