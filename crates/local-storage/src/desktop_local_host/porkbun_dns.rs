//! Exact `Porkbun` Zone record reads through the workspace Host.
//!
//! A read reuses the inventory connection's custody slot. It is admitted only for an active
//! connection, an asset in that connection's latest inventory, and an asset whose Zone is unbound
//! or already bound to this connection; the commit re-checks every one of those.
use super::{
    DesktopLocalHost, DesktopLocalHostError,
    porkbun_registrar::{DesktopPorkbunConnection, now},
};
use crate::{
    BusinessDatabaseError, DesktopNativeCloudAdmission, DesktopPorkbunDnsReceipt,
    DesktopPorkbunDnsRecord,
    active_workspace::{
        business::PorkbunDnsCommit,
        capability_qualification::{PORKBUN_DNS_OBSERVE, capability_qualified},
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};

/// Opaque Native-only receipt for one admitted read of one asset's Zone.
pub struct DesktopPorkbunDnsRead {
    connection: DesktopPorkbunConnection,
    zone: String,
}

impl DesktopPorkbunDnsRead {
    /// The custody slot whose key pair performs the read.
    #[must_use]
    pub const fn connection(&self) -> &DesktopPorkbunConnection {
        &self.connection
    }
    /// The canonical asset ID, which is the Zone name the read requests.
    #[must_use]
    pub fn zone(&self) -> &str {
        &self.zone
    }
}

fn database_error(error: BusinessDatabaseError) -> DesktopSyncError {
    match error {
        BusinessDatabaseError::MutationStale => DesktopSyncError::StaleAuthority,
        // Outside the latest inventory, or the Zone is bound elsewhere: both are refusals of this
        // request, not storage faults. The Renderer explains them from the DNS health row.
        BusinessDatabaseError::InvalidInput
        | BusinessDatabaseError::MutationConflict
        | BusinessDatabaseError::ProviderBindingUnavailable => DesktopSyncError::InvalidInput,
        _ => DesktopSyncError::StorageRejected,
    }
}

fn require_dns_observe(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    if !capability_qualified(PORKBUN_DNS_OBSERVE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    sync.require_provider_capability(run, PORKBUN_DNS_OBSERVE)
}

impl DesktopLocalHost {
    /// Admits one read of `zone` through connection `id` before any credential is loaded.
    ///
    /// # Errors
    /// Refuses unqualified, unentitled or stale authority, an inactive connection, an asset
    /// outside the connection's latest inventory and a Zone bound to anything else.
    pub fn admit_porkbun_dns_read(
        &self,
        admission: DesktopNativeCloudAdmission,
        id: &str,
        zone: &str,
    ) -> Result<DesktopPorkbunDnsRead, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            require_dns_observe(sync, run)?;
            require_provider_dispatch(database)?;
            let seed = database.porkbun_connection(id).map_err(database_error)?;
            database
                .porkbun_dns_preflight(&seed, zone)
                .map_err(database_error)?;
            Ok(seed)
        })?;
        Ok(DesktopPorkbunDnsRead {
            connection: DesktopPorkbunConnection::new(admission, seed),
            zone: zone.to_owned(),
        })
    }

    /// Rechecks the exact read immediately before the Native request and after awaits.
    ///
    /// # Errors
    /// Refuses an expired admission, a replaced or revoked connection or a newly bound Zone.
    pub fn recheck_porkbun_dns_read(
        &self,
        read: &DesktopPorkbunDnsRead,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&read.connection.admission.inner),
            |sync, database, run| {
                let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
                sync.recheck_sync_run(database, run)?;
                require_dns_observe(sync, run)?;
                require_provider_dispatch(database)?;
                database
                    .porkbun_dns_preflight(&read.connection.seed, &read.zone)
                    .map_err(database_error)
            },
        )
    }

    /// Commits one complete read as local DNS evidence and the asset's Zone binding.
    ///
    /// # Errors
    /// Malformed records, stale authority and every admission refusal roll the whole read back.
    pub fn commit_porkbun_dns_read(
        &self,
        read: &DesktopPorkbunDnsRead,
        records: &[DesktopPorkbunDnsRecord],
        answered_elsewhere: bool,
    ) -> Result<DesktopPorkbunDnsReceipt, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(
            &read.connection.admission.inner,
            |sync, business, run, fence| {
                sync.recheck_sync_run(business.database_for_backup(), run)?;
                require_dns_observe(sync, run)?;
                require_provider_dispatch(business.database_for_backup())?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let receipt = business
                    .database_for_backup_mut()
                    .commit_porkbun_dns_observation(
                        &PorkbunDnsCommit {
                            seed: &read.connection.seed,
                            entity_id: &read.zone,
                            records,
                            answered_elsewhere,
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
    use crate::active_workspace::capability_qualification::{
        PORKBUN_REGISTRAR_OBSERVE, test_qualification,
    };
    use crate::{
        BusinessDatabase, DesktopRegistrationFact, DesktopRegistrationStanding, LocalDatabaseKey,
    };

    const ZONE: &str = "porkbun-dns.test";

    fn record() -> DesktopPorkbunDnsRecord {
        DesktopPorkbunDnsRecord {
            record_id: "7".to_owned(),
            owner_name_ascii: ZONE.to_owned(),
            record_type: "A".to_owned(),
            content: "192.0.2.7".to_owned(),
            ttl_seconds: 600,
            priority: None,
        }
    }

    #[test]
    fn a_read_needs_qualification_entitlement_and_an_inventoried_asset() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let host = |workspace: &str, capabilities: &[&str]| {
            let root = directory.path().join(workspace);
            std::fs::create_dir(&root).unwrap();
            let database = BusinessDatabase::open(
                &root.join("workspace.db"),
                &LocalDatabaseKey::from_bytes([0x63; 32]),
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
        let local = host(
            "workspace-local",
            &[PORKBUN_DNS_OBSERVE, PORKBUN_REGISTRAR_OBSERVE],
        );
        let inventory_only = host("workspace-inventory", &[PORKBUN_REGISTRAR_OBSERVE]);
        let _inventory = test_qualification::qualify(PORKBUN_REGISTRAR_OBSERVE);
        let connection = local
            .prepare_porkbun_connection(local.begin_native_cloud_run().unwrap(), "Porkbun")
            .unwrap();
        let id = connection.connection_id().to_owned();
        let fact = DesktopRegistrationFact {
            domain: ZONE.to_owned(),
            registered_on: "2025-04-01".to_owned(),
            expires_on: Some("2027-04-01".to_owned()),
            auto_renew: Some(true),
            locked: Some(true),
            standing: DesktopRegistrationStanding::Active,
        };
        local
            .commit_porkbun_inventory(&connection, &[fact])
            .unwrap();
        let status = local.read_porkbun_registrar_status().unwrap();
        assert!(!status.dns_observe.qualified && status.dns_observe.entitled);

        // Unqualified: refused before any slot or record is touched.
        assert!(matches!(
            local.admit_porkbun_dns_read(local.begin_native_cloud_run().unwrap(), &id, ZONE),
            Err(DesktopLocalHostError::CapabilityUnqualified)
        ));
        let _dns = test_qualification::qualify(PORKBUN_DNS_OBSERVE);
        assert!(
            local
                .read_porkbun_registrar_status()
                .unwrap()
                .dns_observe
                .qualified
        );
        let inventory_connection = inventory_only
            .prepare_porkbun_connection(inventory_only.begin_native_cloud_run().unwrap(), "Porkbun")
            .unwrap();
        assert!(
            inventory_only
                .admit_porkbun_dns_read(
                    inventory_only.begin_native_cloud_run().unwrap(),
                    inventory_connection.connection_id(),
                    ZONE,
                )
                .is_err()
        );
        assert!(
            local
                .admit_porkbun_dns_read(
                    local.begin_native_cloud_run().unwrap(),
                    &id,
                    "elsewhere.test"
                )
                .is_err()
        );

        let read = local
            .admit_porkbun_dns_read(local.begin_native_cloud_run().unwrap(), &id, ZONE)
            .unwrap();
        assert_eq!(read.zone(), ZONE);
        assert_eq!(read.connection().connection_id(), id);
        local.recheck_porkbun_dns_read(&read).unwrap();
        let receipt = local
            .commit_porkbun_dns_read(&read, &[record()], false)
            .unwrap();
        assert_eq!(
            (receipt.record_count, receipt.binding_status.as_str()),
            (1, "unverified")
        );

        local.enter_security_lock().unwrap();
        assert!(local.recheck_porkbun_dns_read(&read).is_err());
        assert!(
            local
                .commit_porkbun_dns_read(&read, &[record()], false)
                .is_err()
        );
    }
}
