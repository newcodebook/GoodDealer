//! Admission and exact publication of direct Cloudflare Registrar inventory.
use super::{
    DesktopLocalHost, DesktopLocalHostError, RuntimeRestriction, current_unix_seconds,
    format_timestamp,
};
use crate::{
    BusinessDatabase, BusinessDatabaseError, DesktopCloudflareRegistrarAccountState as State,
    DesktopCloudflareRegistrarAccountSummary, DesktopNativeCloudAdmission, DesktopRegistrationFact,
    active_workspace::{
        business::{RegistrarAccountCommit, RegistrarAccountSeed},
        capability_qualification::{CLOUDFLARE_REGISTRAR_OBSERVE as OBSERVE, capability_qualified},
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt::Write as _;

pub struct DesktopCloudflareRegistrarAccount {
    admission: DesktopNativeCloudAdmission,
    seed: RegistrarAccountSeed,
    digest: String,
}

impl DesktopCloudflareRegistrarAccount {
    fn new(admission: DesktopNativeCloudAdmission, seed: RegistrarAccountSeed) -> Self {
        let mut hash = Sha256::new();
        hash.update(b"GoodDealer/Cloudflare/RegistrarSlot/v1\0");
        for field in [
            admission.workspace_id(),
            &seed.connection_id,
            &seed.incarnation_id,
        ] {
            hash.update((field.len() as u64).to_be_bytes());
            hash.update(field.as_bytes());
        }
        let mut digest = String::with_capacity(64);
        for byte in hash.finalize() {
            write!(digest, "{byte:02x}").expect("writing into String");
        }
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
        self.seed.state == State::Prepared
    }

    #[must_use]
    pub fn is_revoked(&self) -> bool {
        self.seed.state == State::Revoked
    }

    #[must_use]
    pub fn expected_account_digest(&self) -> Option<&str> {
        self.seed.account_scope_digest.as_deref()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCloudflareRegistrarAccountStatus {
    pub schema_version: u8,
    pub observe_qualified: bool,
    pub observe_entitled: bool,
    pub connections: Vec<DesktopCloudflareRegistrarAccountSummary>,
}

fn now() -> Result<String, DesktopLocalHostError> {
    Ok(format_timestamp(
        current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?,
    ))
}

fn rejected(error: BusinessDatabaseError) -> DesktopSyncError {
    match error {
        BusinessDatabaseError::MutationStale => DesktopSyncError::StaleAuthority,
        BusinessDatabaseError::InvalidInput => DesktopSyncError::InvalidInput,
        _ => DesktopSyncError::StorageRejected,
    }
}

fn authorize(
    sync: &DesktopSyncRuntime,
    database: &BusinessDatabase,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    sync.recheck_sync_run(database, run)?;
    if !capability_qualified(OBSERVE) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    sync.require_provider_capability(run, OBSERVE)?;
    require_provider_dispatch(database)
}

fn current_request(
    seed: &RegistrarAccountSeed,
    run: &DesktopSyncRunAdmission,
) -> Result<(), DesktopSyncError> {
    if seed.state == State::Revoked
        || seed
            .request
            .as_ref()
            .is_none_or(|request| !request.matches(run.device_id(), run.lease_epoch()))
    {
        return Err(DesktopSyncError::StaleAuthority);
    }
    Ok(())
}

impl DesktopLocalHost {
    /// Reports only direct Registrar connection statuses and the last saved scan count.
    /// # Errors
    /// Refuses unavailable authority or unreadable storage.
    pub fn read_cloudflare_registrar_account_status(
        &self,
    ) -> Result<DesktopCloudflareRegistrarAccountStatus, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, authority, _, restriction| {
            let active = restriction == RuntimeRestriction::Active;
            Ok(DesktopCloudflareRegistrarAccountStatus {
                schema_version: 1,
                observe_qualified: capability_qualified(OBSERVE),
                observe_entitled: active && authority.capabilities.iter().any(|cap| cap == OBSERVE),
                connections: runtime
                    .database_for_backup()
                    .cloudflare_registrar_account_summaries(
                        active.then_some((&authority.device_id, authority.lease_epoch)),
                    )?,
            })
        })
    }

    /// Holds a durable, current-lease preparation before collecting Native credentials.
    /// # Errors
    /// Refuses stale or unqualified authorization, handoff, or storage failure.
    pub fn prepare_cloudflare_registrar_account(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<DesktopCloudflareRegistrarAccount, DesktopLocalHostError> {
        let at = now()?;
        let seed =
            self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
                authorize(sync, business.database_for_backup(), run)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let seed = business
                    .database_for_backup_mut()
                    .prepare_cloudflare_registrar_account(
                        run.device_id(),
                        run.lease_epoch(),
                        &at,
                        || fence.verify(sync, run),
                    )
                    .map_err(rejected)?;
                business.advance_read_generation_after_sync_commit();
                Ok(seed)
            })?;
        Ok(DesktopCloudflareRegistrarAccount::new(admission, seed))
    }

    /// Durably accepts an explicit refresh for exactly this device and lease.
    /// # Errors
    /// Refuses inactive slots, handoff or stale authority.
    pub fn queue_cloudflare_registrar_account_scan(
        &self,
        admission: &DesktopNativeCloudAdmission,
        connection_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
            authorize(sync, business.database_for_backup(), run)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            business
                .database_for_backup_mut()
                .queue_cloudflare_registrar_account_scan(
                    connection_id,
                    run.device_id(),
                    run.lease_epoch(),
                    || fence.verify(sync, run),
                )
                .map_err(rejected)?;
            business.advance_read_generation_after_sync_commit();
            Ok(())
        })
    }

    /// Recovers only the persisted exact request for current execution authority.
    /// # Errors
    /// Refuses any old, cleared, or revoked request, and a handoff barrier.
    pub fn resume_cloudflare_registrar_account(
        &self,
        admission: DesktopNativeCloudAdmission,
        connection_id: &str,
    ) -> Result<DesktopCloudflareRegistrarAccount, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            authorize(sync, database, run)?;
            let seed = database
                .cloudflare_registrar_account(connection_id)
                .map_err(rejected)?;
            current_request(&seed, run)?;
            Ok(seed)
        })?;
        Ok(DesktopCloudflareRegistrarAccount::new(admission, seed))
    }

    /// Checks the exact persisted slot and request around Native I/O.
    /// # Errors
    /// Refuses late authority, credential or request replacement.
    pub fn recheck_cloudflare_registrar_account(
        &self,
        slot: &DesktopCloudflareRegistrarAccount,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&slot.admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            if slot.seed.state == State::Revoked {
                sync.recheck_sync_run(database, run)?;
            } else {
                authorize(sync, database, run)?;
                current_request(&slot.seed, run)?;
            }
            if database
                .cloudflare_registrar_account(slot.connection_id())
                .map_err(rejected)?
                != slot.seed
            {
                return Err(DesktopSyncError::StaleAuthority);
            }
            Ok(())
        })
    }

    /// Installs or refreshes a complete inventory in the sole asset transaction.
    /// # Errors
    /// Stale authorization, changed scope and invalid or late facts abort the whole commit.
    pub fn commit_cloudflare_registrar_account(
        &self,
        slot: &DesktopCloudflareRegistrarAccount,
        scope_digest: &str,
        registrations: &[DesktopRegistrationFact],
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&slot.admission.inner, |sync, business, run, fence| {
            authorize(sync, business.database_for_backup(), run)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            business
                .database_for_backup_mut()
                .import_cloudflare_registrar_account(
                    &RegistrarAccountCommit {
                        seed: &slot.seed,
                        registrations,
                        scope_digest,
                        device_id: run.device_id(),
                        lease_epoch: run.lease_epoch(),
                        at: &at,
                    },
                    || fence.verify(sync, run),
                )
                .map_err(rejected)?;
            business.advance_read_generation_after_sync_commit();
            Ok(())
        })
    }

    /// Permanently disables a slot before custody removal.
    /// # Errors
    /// Refuses stale workspace authority or an unknown connection.
    pub fn revoke_cloudflare_registrar_account(
        &self,
        admission: DesktopNativeCloudAdmission,
        connection_id: &str,
    ) -> Result<DesktopCloudflareRegistrarAccount, DesktopLocalHostError> {
        let at = now()?;
        let seed =
            self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                sync.recheck_sync_run(database, run)?;
                let slot = database
                    .cloudflare_registrar_account(connection_id)
                    .map_err(rejected)?;
                let seed = database
                    .revoke_cloudflare_registrar_account(&slot, &at, || fence.verify(sync, run))
                    .map_err(rejected)?;
                business.advance_read_generation_after_sync_commit();
                Ok(seed)
            })?;
        Ok(DesktopCloudflareRegistrarAccount::new(admission, seed))
    }

    /// Records confirmed absence of the exact retired custody slot.
    /// # Errors
    /// Refuses a live or replaced slot and stale authority.
    pub fn confirm_cloudflare_registrar_account_purge(
        &self,
        slot: &DesktopCloudflareRegistrarAccount,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&slot.admission.inner, |sync, business, run, fence| {
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let database = business.database_for_backup_mut();
            sync.recheck_sync_run(database, run)?;
            database
                .confirm_cloudflare_registrar_account_purge(&slot.seed, &at, || {
                    fence.verify(sync, run)
                })
                .map_err(rejected)?;
            business.advance_read_generation_after_sync_commit();
            Ok(())
        })
    }
}
