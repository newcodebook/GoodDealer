//! Exact Aliyun admission and publication through the workspace Host.
use super::{
    DesktopLocalHost, DesktopLocalHostError, RuntimeRestriction, current_unix_seconds,
    format_timestamp,
};
use crate::{
    BusinessDatabaseError, DesktopAliyunConnectionState, DesktopAliyunConnectionSummary,
    DesktopNativeCloudAdmission, DesktopRegistrarScanReceipt, DesktopRegistrationFact,
    active_workspace::{
        business::{AliyunConnectionSeed, AliyunInventoryCommit},
        capability_qualification::{ALIYUN_REGISTRAR_OBSERVE as OBSERVE, capability_qualified},
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Opaque Native-only receipt for one exact credential incarnation and scan head.
pub struct DesktopAliyunConnection {
    admission: DesktopNativeCloudAdmission,
    seed: AliyunConnectionSeed,
    digest: String,
}

impl DesktopAliyunConnection {
    fn new(admission: DesktopNativeCloudAdmission, seed: AliyunConnectionSeed) -> Self {
        let mut hash = Sha256::new();
        hash.update(b"GOODDEALER-ALIYUN-REGISTRAR-V1\0");
        for part in [
            admission.workspace_id(),
            &seed.connection_id,
            &seed.incarnation_id,
        ] {
            hash.update((part.len() as u64).to_be_bytes());
            hash.update(part.as_bytes());
        }
        let digest = hash
            .finalize()
            .iter()
            .fold(String::with_capacity(64), |mut output, byte| {
                use std::fmt::Write as _;
                write!(output, "{byte:02x}").expect("writing into String");
                output
            });
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
        self.seed.state == DesktopAliyunConnectionState::Prepared
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAliyunRegistrarStatus {
    pub schema_version: u8,
    pub observe_qualified: bool,
    pub observe_entitled: bool,
    pub connections: Vec<DesktopAliyunConnectionSummary>,
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
    /// Admits Native capture and a read-only registrar scan before creating a credential slot.
    ///
    /// # Errors
    /// Refuses stale authority, missing qualification or missing commercial access.
    pub fn recheck_aliyun_connection_preparation(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(database)
        })
    }

    /// Returns only the public connection state and counts from the last complete local scan.
    ///
    /// # Errors
    /// Refuses unavailable authority or malformed persisted settings.
    pub fn read_aliyun_registrar_status(
        &self,
    ) -> Result<DesktopAliyunRegistrarStatus, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            Ok(DesktopAliyunRegistrarStatus {
                schema_version: 1,
                observe_qualified: capability_qualified(OBSERVE),
                observe_entitled: restriction == RuntimeRestriction::Active
                    && authority.capabilities.iter().any(|cap| cap == OBSERVE),
                connections: runtime.database_for_backup().aliyun_connection_summaries(
                    (restriction == RuntimeRestriction::Active)
                        .then_some((authority.device_id.as_str(), authority.lease_epoch)),
                )?,
            })
        })
    }

    /// Stages a new slot under current authority before credentials are written.
    ///
    /// # Errors
    /// Refuses unqualified, unentitled or stale authority, invalid labels and storage failures.
    pub fn prepare_aliyun_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        label: &str,
    ) -> Result<DesktopAliyunConnection, DesktopLocalHostError> {
        let at = now()?;
        let seed =
            self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
                sync.recheck_sync_run(business.database_for_backup(), run)?;
                require_observe(sync, run)?;
                require_provider_dispatch(business.database_for_backup())?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let seed = business
                    .database_for_backup_mut()
                    .prepare_aliyun_connection(
                        label,
                        &at,
                        (run.device_id(), run.lease_epoch()),
                        || fence.verify(sync, run),
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(seed)
            })?;
        Ok(DesktopAliyunConnection::new(admission, seed))
    }

    /// Persists the exact refresh before the Native command acknowledges admission.
    ///
    /// # Errors
    /// Refuses revoked slots, stale authority and mismatched connection identifiers.
    pub fn queue_aliyun_inventory_refresh(
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
                .queue_aliyun_scan(id, (run.device_id(), run.lease_epoch()), || {
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
    pub fn resume_aliyun_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        id: &str,
    ) -> Result<DesktopAliyunConnection, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            require_observe(sync, run)?;
            require_provider_dispatch(database)?;
            let seed = database.aliyun_connection(id).map_err(database_error)?;
            if !seed.has_scan_for(run.device_id(), run.lease_epoch()) {
                return Err(DesktopSyncError::StaleAuthority);
            }
            Ok(seed)
        })?;
        Ok(DesktopAliyunConnection::new(admission, seed))
    }

    /// Rechecks the exact slot immediately before Native operations and after awaits.
    ///
    /// # Errors
    /// Refuses an expired admission, another connection or a newer scan.
    pub fn recheck_aliyun_connection(
        &self,
        connection: &DesktopAliyunConnection,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&connection.admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            if connection.seed.state != DesktopAliyunConnectionState::Revoked {
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
                .aliyun_connection(connection.connection_id())
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
    pub fn commit_aliyun_inventory(
        &self,
        connection: &DesktopAliyunConnection,
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
                .import_aliyun_inventory(
                    &AliyunInventoryCommit {
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

    /// Durably denies further use before the Native slot is removed. Available after Provider rights expire.
    ///
    /// # Errors
    /// Refuses stale workspace authority or a nonexistent connection.
    pub fn revoke_aliyun_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        id: &str,
    ) -> Result<DesktopAliyunConnection, DesktopLocalHostError> {
        let at = now()?;
        let seed =
            self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let db = business.database_for_backup_mut();
                sync.recheck_sync_run(db, run)?;
                let seed = db.aliyun_connection(id).map_err(database_error)?;
                let revoked = db
                    .revoke_aliyun_connection(&seed, &at, || fence.verify(sync, run))
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(revoked)
            })?;
        Ok(DesktopAliyunConnection::new(admission, seed))
    }

    /// Retires exactly the preparation whose Native capture was canceled or whose slot is absent.
    ///
    /// # Errors
    /// Refuses active connections, stale authority and a replaced preparation.
    pub fn abandon_aliyun_preparation(
        &self,
        connection: DesktopAliyunConnection,
    ) -> Result<DesktopAliyunConnection, DesktopLocalHostError> {
        if !connection.is_prepared() {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let at = now()?;
        let seed = self.with_sync_business_write(
            &connection.admission.inner,
            |sync, business, run, fence| {
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let revoked = business
                    .database_for_backup_mut()
                    .revoke_aliyun_connection(&connection.seed, &at, || fence.verify(sync, run))
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(revoked)
            },
        )?;
        Ok(DesktopAliyunConnection::new(connection.admission, seed))
    }

    /// Publishes the verified absence of the exact revoked Native credential.
    ///
    /// # Errors
    /// Refuses stale authority and any slot that has not been durably revoked.
    pub fn confirm_aliyun_purge(
        &self,
        connection: &DesktopAliyunConnection,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&connection.admission.inner, |sync, business, run, fence| {
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            business
                .database_for_backup_mut()
                .confirm_aliyun_purge(&connection.seed, &at, || fence.verify(sync, run))
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(())
        })
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::active_workspace::capability_qualification::test_qualification;
    use crate::{BusinessDatabase, LocalDatabaseKey};

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
            local.recheck_aliyun_connection_preparation(&admission),
            Err(DesktopLocalHostError::CapabilityUnqualified)
        );

        let _qualification = test_qualification::qualify(OBSERVE);
        assert!(
            unentitled
                .recheck_aliyun_connection_preparation(
                    &unentitled.begin_native_cloud_run().unwrap()
                )
                .is_err()
        );
        assert!(
            other
                .recheck_aliyun_connection_preparation(&admission)
                .is_err()
        );
        local
            .recheck_aliyun_connection_preparation(&admission)
            .unwrap();
        assert!(
            local
                .read_aliyun_registrar_status()
                .unwrap()
                .connections
                .is_empty()
        );

        let connection = local
            .prepare_aliyun_connection(local.begin_native_cloud_run().unwrap(), "Alibaba Cloud")
            .unwrap();
        let id = connection.connection_id();
        local.commit_aliyun_inventory(&connection, &[]).unwrap();
        assert!(
            local
                .resume_aliyun_connection(local.begin_native_cloud_run().unwrap(), id)
                .is_err()
        );
        assert!(
            other
                .queue_aliyun_inventory_refresh(&admission, id)
                .is_err()
        );
        local
            .queue_aliyun_inventory_refresh(&admission, id)
            .unwrap();
        let refresh = local
            .resume_aliyun_connection(local.begin_native_cloud_run().unwrap(), id)
            .unwrap();
        local.recheck_aliyun_connection(&refresh).unwrap();

        local.enter_security_lock().unwrap();
        assert!(local.commit_aliyun_inventory(&refresh, &[]).is_err());
        assert!(
            local
                .recheck_aliyun_connection_preparation(&admission)
                .is_err()
        );
    }
}
