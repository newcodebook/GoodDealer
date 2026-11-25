//! `Porkbun` registry delegation reads (`getNs`) through the workspace Host.
//!
//! A read reuses the inventory connection's custody slot and its `registrar.domain.observe`
//! qualification and entitlement: delegation is a registration fact. It is admitted only for an
//! active connection and an asset in that connection's latest inventory; the commit re-checks
//! both. It never touches a Zone binding.
use super::{
    DesktopLocalHost, DesktopLocalHostError,
    porkbun_registrar::{DesktopPorkbunConnection, now},
};
use crate::{
    BusinessDatabaseError, DesktopNativeCloudAdmission, DesktopPorkbunDelegationReceipt,
    active_workspace::{
        business::PorkbunDelegationCommit,
        capability_qualification::{PORKBUN_REGISTRAR_OBSERVE, capability_qualified},
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};

/// Opaque Native-only receipt for one admitted delegation read of one asset.
pub struct DesktopPorkbunDelegationRead {
    connection: DesktopPorkbunConnection,
    domain: String,
}

impl DesktopPorkbunDelegationRead {
    /// The custody slot whose key pair performs the read.
    #[must_use]
    pub const fn connection(&self) -> &DesktopPorkbunConnection {
        &self.connection
    }
    /// The canonical asset ID, which is the domain the read requests.
    #[must_use]
    pub fn domain(&self) -> &str {
        &self.domain
    }
}

fn database_error(error: BusinessDatabaseError) -> DesktopSyncError {
    match error {
        BusinessDatabaseError::MutationStale => DesktopSyncError::StaleAuthority,
        // Outside the latest inventory is a refusal of this request, not a storage fault.
        BusinessDatabaseError::InvalidInput | BusinessDatabaseError::ProviderBindingUnavailable => {
            DesktopSyncError::InvalidInput
        }
        _ => DesktopSyncError::StorageRejected,
    }
}

fn require_registrar_observe(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    if !capability_qualified(PORKBUN_REGISTRAR_OBSERVE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    sync.require_provider_capability(run, PORKBUN_REGISTRAR_OBSERVE)
}

impl DesktopLocalHost {
    /// Admits one delegation read of `zone` through connection `id` before any credential is
    /// loaded.
    ///
    /// # Errors
    /// Refuses unqualified, unentitled or stale authority, an inactive connection and an asset
    /// outside the connection's latest inventory.
    pub fn admit_porkbun_delegation_read(
        &self,
        admission: DesktopNativeCloudAdmission,
        id: &str,
        zone: &str,
    ) -> Result<DesktopPorkbunDelegationRead, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            require_registrar_observe(sync, run)?;
            require_provider_dispatch(database)?;
            let seed = database.porkbun_connection(id).map_err(database_error)?;
            database
                .porkbun_delegation_preflight(&seed, zone)
                .map_err(database_error)?;
            Ok(seed)
        })?;
        Ok(DesktopPorkbunDelegationRead {
            connection: DesktopPorkbunConnection::new(admission, seed),
            domain: zone.to_owned(),
        })
    }

    /// Rechecks the exact read immediately before the Native request and after awaits.
    ///
    /// # Errors
    /// Refuses an expired admission and a replaced or revoked connection.
    pub fn recheck_porkbun_delegation_read(
        &self,
        read: &DesktopPorkbunDelegationRead,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&read.connection.admission.inner),
            |sync, database, run| {
                let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
                sync.recheck_sync_run(database, run)?;
                require_registrar_observe(sync, run)?;
                require_provider_dispatch(database)?;
                database
                    .porkbun_delegation_preflight(&read.connection.seed, &read.domain)
                    .map_err(database_error)
            },
        )
    }

    /// Commits one registry nameserver set as local delegation evidence.
    ///
    /// # Errors
    /// A malformed set, stale authority and every admission refusal write nothing.
    pub fn commit_porkbun_delegation_read(
        &self,
        read: &DesktopPorkbunDelegationRead,
        nameservers: &[String],
    ) -> Result<DesktopPorkbunDelegationReceipt, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &read.connection.admission.inner,
            |sync, business, run, fence| {
                sync.recheck_sync_run(business.database_for_backup(), run)?;
                require_registrar_observe(sync, run)?;
                require_provider_dispatch(business.database_for_backup())?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let receipt = business
                    .database_for_backup_mut()
                    .commit_porkbun_delegation_observation(
                        &PorkbunDelegationCommit {
                            seed: &read.connection.seed,
                            entity_id: &read.domain,
                            nameservers,
                            at: &at,
                        },
                        || fence.verify(sync, run),
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(receipt)
            },
        )
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::{
        BusinessDatabase, DesktopRegistrationFact, DesktopRegistrationStanding, LocalDatabaseKey,
        active_workspace::capability_qualification::test_qualification,
    };

    const DOMAIN: &str = "porkbun-delegation.test";

    #[test]
    fn a_read_needs_registrar_qualification_and_an_inventoried_asset() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let root = directory.path().join("workspace-local");
        std::fs::create_dir(&root).unwrap();
        let database = BusinessDatabase::open(
            &root.join("workspace.db"),
            &LocalDatabaseKey::from_bytes([0x64; 32]),
            "workspace-local",
        )
        .unwrap();
        let host = DesktopLocalHost::development_with_provider_capabilities(
            database,
            root,
            "account-local",
            "workspace-local",
            "device-local",
            &[PORKBUN_REGISTRAR_OBSERVE],
        )
        .unwrap();
        let qualified = test_qualification::qualify(PORKBUN_REGISTRAR_OBSERVE);
        let connection = host
            .prepare_porkbun_connection(host.begin_native_cloud_run().unwrap(), "Porkbun")
            .unwrap();
        let id = connection.connection_id().to_owned();
        let fact = DesktopRegistrationFact {
            domain: DOMAIN.to_owned(),
            registered_on: "2025-04-01".to_owned(),
            expires_on: Some("2027-04-01".to_owned()),
            auto_renew: Some(true),
            locked: Some(true),
            standing: DesktopRegistrationStanding::Active,
        };
        host.commit_porkbun_inventory(&connection, &[fact]).unwrap();
        assert!(
            host.admit_porkbun_delegation_read(
                host.begin_native_cloud_run().unwrap(),
                &id,
                "elsewhere.test"
            )
            .is_err()
        );
        let read = host
            .admit_porkbun_delegation_read(host.begin_native_cloud_run().unwrap(), &id, DOMAIN)
            .unwrap();
        assert_eq!(read.domain(), DOMAIN);
        host.recheck_porkbun_delegation_read(&read).unwrap();
        let receipt = host
            .commit_porkbun_delegation_read(&read, &["ns1.example.net".to_owned()])
            .unwrap();
        assert_eq!(receipt.nameserver_count, 1);

        // Without the registrar qualification nothing is admitted or committed.
        drop(qualified);
        assert!(matches!(
            host.admit_porkbun_delegation_read(host.begin_native_cloud_run().unwrap(), &id, DOMAIN),
            Err(DesktopLocalHostError::CapabilityUnqualified)
        ));
        assert!(host.commit_porkbun_delegation_read(&read, &[]).is_err());
    }
}
