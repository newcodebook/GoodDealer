//! One Spaceship connection through the workspace Host. A single API key serves every role it
//! proved at connect time, so preparation, credential custody, retirement and purge happen once
//! for the whole connection. Each role keeps its own scan admission and publication.
use super::{DesktopLocalHost, DesktopLocalHostError, current_unix_seconds, format_timestamp};
use crate::{
    BusinessDatabaseError, DesktopNativeCloudAdmission,
    active_workspace::{
        business::{SpaceshipAccountSeeds, SpaceshipRoles},
        capability_qualification::{
            SPACESHIP_MARKETPLACE_OBSERVE, SPACESHIP_REGISTRAR_OBSERVE, capability_qualified,
        },
    },
    desktop_sync_runtime::{
        DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime, require_provider_dispatch,
    },
};
use sha2::{Digest, Sha256};

/// The Native slot key for one connection incarnation. Every role of the connection derives the
/// same digest, so the key is stored once and retired once.
pub(super) fn spaceship_slot_digest(
    workspace: &str,
    connection: &str,
    incarnation: &str,
) -> String {
    let mut hash = Sha256::new();
    hash.update(b"GOODDEALER-SPACESHIP-CONNECTION-V1\0");
    for part in [workspace, connection, incarnation] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    hash.finalize()
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write as _;
            write!(output, "{byte:02x}").expect("writing into String");
            output
        })
}

/// Opaque Native-only receipt for one exact connection incarnation and every declared role.
pub struct DesktopSpaceshipAccount {
    admission: DesktopNativeCloudAdmission,
    seeds: SpaceshipAccountSeeds,
    digest: String,
}

impl DesktopSpaceshipAccount {
    fn new(admission: DesktopNativeCloudAdmission, seeds: SpaceshipAccountSeeds) -> Self {
        let digest = spaceship_slot_digest(
            admission.workspace_id(),
            seeds.connection_id(),
            seeds.incarnation_id(),
        );
        Self {
            admission,
            seeds,
            digest,
        }
    }

    #[must_use]
    pub fn connection_id(&self) -> &str {
        self.seeds.connection_id()
    }
    #[must_use]
    pub fn connection_incarnation(&self) -> &str {
        self.seeds.incarnation_id()
    }
    #[must_use]
    pub fn connection_digest(&self) -> &str {
        &self.digest
    }
    #[must_use]
    pub fn public_proof(&self) -> &str {
        self.seeds.credential_proof()
    }
    #[must_use]
    pub const fn roles(&self) -> SpaceshipRoles {
        SpaceshipRoles {
            registrar: self.seeds.registrar.is_some(),
            marketplace: self.seeds.sellerhub.is_some(),
        }
    }
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

fn require_role(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
    capability: &str,
) -> Result<(), DesktopSyncError> {
    if !capability_qualified(capability) {
        return Err(DesktopSyncError::CapabilityUnqualified);
    }
    sync.require_provider_capability(run, capability)
}

/// The roles this run may use. With `required`, every listed role must still be admitted;
/// without it, at least one role must be, and the first refusal explains an empty set.
fn admitted_roles(
    sync: &DesktopSyncRuntime,
    run: &DesktopSyncRunAdmission,
    required: Option<SpaceshipRoles>,
) -> Result<SpaceshipRoles, DesktopSyncError> {
    let registrar = require_role(sync, run, SPACESHIP_REGISTRAR_OBSERVE);
    let marketplace = require_role(sync, run, SPACESHIP_MARKETPLACE_OBSERVE);
    let roles = SpaceshipRoles {
        registrar: registrar.is_ok(),
        marketplace: marketplace.is_ok(),
    };
    match required {
        Some(required) => {
            if required.registrar {
                registrar?;
            }
            if required.marketplace {
                marketplace?;
            }
            Ok(required)
        }
        None if roles.registrar || roles.marketplace => Ok(roles),
        None => registrar.and(marketplace).map(|()| roles),
    }
}

impl DesktopLocalHost {
    /// Admits Native capture and read-only role probes before creating a credential slot.
    /// Returns the roles this run may probe; `required` pins an already chosen role set.
    ///
    /// # Errors
    /// Refuses stale authority, or a run with no qualified and entitled Spaceship role.
    pub fn recheck_spaceship_account_preparation(
        &self,
        admission: &DesktopNativeCloudAdmission,
        required: Option<SpaceshipRoles>,
    ) -> Result<SpaceshipRoles, DesktopLocalHostError> {
        self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            let roles = admitted_roles(sync, run, required)?;
            require_provider_dispatch(database)?;
            Ok(roles)
        })
    }

    /// Stages one connection with every role its key proved, before the credential is written.
    ///
    /// # Errors
    /// Refuses an empty role set, any unadmitted role, stale authority and storage failures.
    pub fn prepare_spaceship_account(
        &self,
        admission: DesktopNativeCloudAdmission,
        label: &str,
        roles: SpaceshipRoles,
    ) -> Result<DesktopSpaceshipAccount, DesktopLocalHostError> {
        let at = now()?;
        let seeds =
            self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
                sync.recheck_sync_run(business.database_for_backup(), run)?;
                admitted_roles(sync, run, Some(roles))?;
                require_provider_dispatch(business.database_for_backup())?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let seeds = business
                    .database_for_backup_mut()
                    .prepare_spaceship_account(
                        label,
                        roles,
                        &at,
                        (run.device_id(), run.lease_epoch()),
                        || fence.verify(sync, run),
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(seeds)
            })?;
        Ok(DesktopSpaceshipAccount::new(admission, seeds))
    }

    /// Rechecks the exact connection immediately before Native custody operations.
    ///
    /// # Errors
    /// Refuses an expired admission, a lost role or a changed connection.
    pub fn recheck_spaceship_account(
        &self,
        account: &DesktopSpaceshipAccount,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&account.admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.recheck_sync_run(database, run)?;
            if !account.seeds.is_revoked() {
                admitted_roles(sync, run, Some(account.roles()))?;
                require_provider_dispatch(database)?;
            }
            let current = database
                .spaceship_account(account.connection_id())
                .map_err(database_error)?;
            if current != account.seeds {
                return Err(DesktopSyncError::StaleAuthority);
            }
            Ok(())
        })
    }

    /// Durably denies every role before the shared Native slot is removed. Available after
    /// Provider rights expire, and idempotent for an already revoked connection.
    ///
    /// # Errors
    /// Refuses stale workspace authority or a nonexistent connection.
    pub fn revoke_spaceship_account(
        &self,
        admission: DesktopNativeCloudAdmission,
        id: &str,
    ) -> Result<DesktopSpaceshipAccount, DesktopLocalHostError> {
        let at = now()?;
        let seeds =
            self.with_sync_business_write(&admission.inner, |sync, business, run, fence| {
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let db = business.database_for_backup_mut();
                sync.recheck_sync_run(db, run)?;
                let current = db.spaceship_account(id).map_err(database_error)?;
                let revoked = db
                    .revoke_spaceship_account(&current, &at, || fence.verify(sync, run))
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(revoked)
            })?;
        Ok(DesktopSpaceshipAccount::new(admission, seeds))
    }

    /// Publishes the verified absence of the shared Native credential for every role.
    ///
    /// # Errors
    /// Refuses stale authority and any connection that has not been durably revoked.
    pub fn confirm_spaceship_account_purge(
        &self,
        account: &DesktopSpaceshipAccount,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&account.admission.inner, |sync, business, run, fence| {
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            business
                .database_for_backup_mut()
                .confirm_spaceship_account_purge(&account.seeds, &at, || fence.verify(sync, run))
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(())
        })
    }
}
