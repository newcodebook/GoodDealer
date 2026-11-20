//! Afternic's Native facade. The Host owns admissions and transactions; Core owns credentials/HTTP.
use super::{DesktopLocalHost, DesktopLocalHostError, current_unix_seconds, format_timestamp};
use crate::active_workspace::business::{
    AfternicConnectionSeed, DesktopAfternicInventoryReceipt, DesktopAfternicListingObservation,
};
use crate::active_workspace::capability_qualification::capability_qualified;
use crate::desktop_sync_runtime::DesktopSyncError;
use crate::{BusinessDatabaseError, DesktopNativeCloudAdmission};
use sha2::{Digest, Sha256};

const OBSERVE: &str = "afternic:marketplace:observe";

/// This handle is Native-only, non-serializable and bound to an exact Host admission and slot.
pub struct DesktopAfternicConnection {
    pub(super) admission: DesktopNativeCloudAdmission,
    pub(super) seed: AfternicConnectionSeed,
    connection_digest: String,
}
impl std::fmt::Debug for DesktopAfternicConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopAfternicConnection([REDACTED])")
    }
}
impl DesktopAfternicConnection {
    #[must_use]
    pub fn connection_id(&self) -> &str {
        &self.seed.connection_id
    }
    #[must_use]
    pub fn connection_incarnation(&self) -> &str {
        &self.seed.connection_incarnation_id
    }
    #[must_use]
    pub fn connection_digest(&self) -> &str {
        &self.connection_digest
    }
    #[must_use]
    pub const fn generation(&self) -> u64 {
        self.seed.credential_generation
    }
    #[must_use]
    pub fn public_proof(&self) -> &str {
        &self.seed.credential_public_proof
    }
    #[must_use]
    pub fn is_prepared(&self) -> bool {
        self.seed.publication_state == "prepared"
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
pub(super) fn handle(
    admission: DesktopNativeCloudAdmission,
    seed: AfternicConnectionSeed,
) -> DesktopAfternicConnection {
    let mut hash = Sha256::new();
    hash.update(b"GOODDEALER-AFTERNIC-CONNECTION-V1\0");
    for part in [
        admission.workspace_id(),
        &seed.connection_id,
        &seed.connection_incarnation_id,
    ] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    DesktopAfternicConnection {
        admission,
        seed,
        connection_digest: hash.finalize().iter().fold(
            String::with_capacity(64),
            |mut output, byte| {
                use std::fmt::Write as _;
                write!(output, "{byte:02x}").expect("writing into String");
                output
            },
        ),
    }
}

impl DesktopLocalHost {
    /// Admits an in-memory Native capture and read-only validation before reserving a slot.
    /// # Errors
    /// Rejects stale authority, unavailable permissions or a previously bound acceptance run.
    pub fn recheck_afternic_connection_preparation(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            self.admit_afternic_access(sync, run, database, false, true)?;
            if let Some(evidence) = self.afternic_acceptance_context(run, false)? {
                let scope = database
                    .afternic_controlled_acceptance(&evidence, true)
                    .map_err(database_error)?;
                if scope.connection_id.is_some() {
                    return Err(DesktopSyncError::StaleAuthority);
                }
            }
            Ok(())
        })
    }

    /// Stages a fresh connection for Native credential publication.
    /// # Errors
    /// Refuses non-Active, unqualified, unentitled or stale authority and invalid labels.
    pub fn prepare_afternic_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        label: &str,
    ) -> Result<DesktopAfternicConnection, DesktopLocalHostError> {
        let at = now()?;
        let seed =
            self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
                self.admit_afternic_access(sync, run, business.database_for_backup(), false, true)?;
                let acceptance = self.afternic_acceptance_context(run, false)?;
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let seed = business
                    .database_for_backup_mut()
                    .prepare_afternic_connection_with_acceptance(
                        label,
                        run.authority_snapshot_digest(),
                        &at,
                        acceptance.as_ref(),
                        || {
                            if acceptance.is_some() {
                                self.afternic_acceptance_context(run, false)
                                    .map_err(|_| BusinessDatabaseError::MutationStale)?;
                            }
                            guard.verify(sync, run)
                        },
                    )
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(seed)
            })?;
        Ok(handle(admission, seed))
    }

    /// Resumes an exact persisted generation; this does not capture or replace a missing secret.
    /// # Errors
    /// Rejects revoked connections, unqualified or unentitled access. The current Grant authorizes
    /// recovery; the original preparation digest remains audit evidence, never reusable authority.
    pub fn resume_afternic_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        connection_id: &str,
    ) -> Result<DesktopAfternicConnection, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            self.admit_afternic_access(sync, run, database, false, false)?;
            let seed = database
                .afternic_connection_seed(connection_id)
                .map_err(database_error)?;
            self.require_afternic_acceptance_targets(
                run,
                database,
                &seed.connection_id,
                std::iter::empty::<&str>(),
                false,
            )?;
            database
                .admit_afternic_provider(&seed)
                .map_err(database_error)?;
            Ok(seed)
        })?;
        Ok(handle(admission, seed))
    }

    /// Rechecks named permission, qualification and exact generation around every Native await.
    /// # Errors
    /// Fails closed on authorization, connection or custody-publication drift.
    pub fn recheck_afternic_connection(
        &self,
        connection: &DesktopAfternicConnection,
    ) -> Result<(), DesktopLocalHostError> {
        if !["prepared", "active"].contains(&connection.seed.publication_state.as_str()) {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        self.with_sync_runtime(Some(&connection.admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            self.admit_afternic_access(sync, run, database, false, false)?;
            self.require_afternic_acceptance_targets(
                run,
                database,
                &connection.seed.connection_id,
                std::iter::empty::<&str>(),
                false,
            )?;
            database
                .admit_afternic_provider(&connection.seed)
                .map_err(database_error)
        })
    }

    /// Commits a complete verified Native scan, new asset Outbox and binding observations atomically.
    /// # Errors
    /// Rejects malformed/duplicate inventories, stale authority or generation; all writes roll back.
    pub fn commit_afternic_inventory(
        &self,
        connection: &DesktopAfternicConnection,
        listings: &[DesktopAfternicListingObservation],
    ) -> Result<DesktopAfternicInventoryReceipt, DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&connection.admission.inner, |sync, business, run, guard| {
            self.admit_afternic_access(sync, run, business.database_for_backup(), false, false)?;
            self.require_afternic_acceptance_targets(
                run,
                business.database_for_backup(),
                &connection.seed.connection_id,
                std::iter::empty::<&str>(),
                false,
            )?;
            let acceptance = self.afternic_acceptance_context(run, false)?;
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            let receipt = business
                .database_for_backup_mut()
                .import_afternic_inventory(
                    &connection.seed,
                    listings,
                    run.device_id(),
                    run.lease_epoch(),
                    &at,
                    || {
                        if acceptance.is_some() {
                            self.afternic_acceptance_context(run, false)
                                .map_err(|_| BusinessDatabaseError::MutationStale)?;
                        }
                        guard.verify(sync, run)
                    },
                )
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(receipt)
        })
    }

    /// Denies local credential use before Native purge, even after Provider entitlement is removed.
    /// # Errors
    /// Requires current local Active authority and the exact stored connection.
    pub fn revoke_afternic_connection(
        &self,
        admission: DesktopNativeCloudAdmission,
        connection_id: &str,
    ) -> Result<DesktopAfternicConnection, DesktopLocalHostError> {
        let at = now()?;
        let seed =
            self.with_sync_business_write(&admission.inner, |sync, business, run, guard| {
                if !business.has_read_generation_capacity() {
                    return Err(DesktopSyncError::StorageRejected);
                }
                let database = business.database_for_backup_mut();
                let seed = database
                    .afternic_connection_seed(connection_id)
                    .map_err(database_error)?;
                let revoked = database
                    .revoke_afternic_connection(&seed, &at, || guard.verify(sync, run))
                    .map_err(database_error)?;
                business.advance_read_generation_after_sync_commit();
                Ok(revoked)
            })?;
        Ok(handle(admission, seed))
    }

    /// Only an already revoked exact slot can be removed. This guard grants no Provider action.
    /// # Errors
    /// Rejects non-revoked, superseded or unauthorized custody requests.
    pub fn recheck_afternic_purge(
        &self,
        connection: &DesktopAfternicConnection,
    ) -> Result<(), DesktopLocalHostError> {
        self.recheck_native_cloud(&connection.admission)?;
        if connection.seed.publication_state != "revoked" {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        self.with_sync_runtime(Some(&connection.admission.inner), |_, database, _| {
            database
                .recheck_afternic_connection(&connection.seed)
                .map_err(database_error)
        })
    }

    /// Records Native-confirmed absence while retaining the immutable generation/proof history.
    /// # Errors
    /// Rejects stale authority, non-revoked generations and storage errors.
    pub fn confirm_afternic_purge(
        &self,
        connection: &DesktopAfternicConnection,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_write(&connection.admission.inner, |sync, database, run, guard| {
            database
                .confirm_afternic_purge(&connection.seed, &at, || guard.verify(sync, run))
                .map_err(database_error)
        })
    }
}

impl DesktopLocalHost {
    /// Returns only local connection labels, closed state and the last completed inventory counts.
    /// # Errors
    /// Rejects unauthorized reads and malformed or oversized persisted projections.
    pub fn read_afternic_connections(
        &self,
    ) -> Result<crate::DesktopAfternicConnectionsRead, DesktopLocalHostError> {
        let mut status =
            self.with_authorized_business(false, |runtime, authority, _, restriction| {
                Ok(crate::DesktopAfternicConnectionsRead {
                    schema_version: 1,
                    controlled_acceptance: None,
                    connections: runtime.database_for_backup().afternic_connections()?,
                    observe_qualified: capability_qualified(OBSERVE),
                    observe_entitled: restriction == super::RuntimeRestriction::Active
                        && authority.capabilities.iter().any(|cap| cap == OBSERVE),
                })
            })?;
        status.controlled_acceptance = self.afternic_acceptance_status(false).filter(|scope| {
            status.observe_entitled
                && !status.observe_qualified
                && scope.connection_id.as_ref().is_none_or(|id| {
                    status.connections.iter().any(|row| {
                        &row.connection_id == id
                            && matches!(row.state.as_str(), "prepared" | "active")
                    })
                })
        });
        Ok(status)
    }
    /// A missing or malformed exact Native slot disables credential use; no replacement is guessed.
    /// # Errors
    /// Rejects stale authority or an already replaced/revoked generation.
    pub fn mark_afternic_remediation(
        &self,
        connection: &DesktopAfternicConnection,
    ) -> Result<(), DesktopLocalHostError> {
        let at = now()?;
        self.with_sync_business_write(&connection.admission.inner, |sync, business, run, guard| {
            if !business.has_read_generation_capacity() {
                return Err(DesktopSyncError::StorageRejected);
            }
            business
                .database_for_backup_mut()
                .mark_afternic_remediation(&connection.seed, &at, || guard.verify(sync, run))
                .map_err(database_error)?;
            business.advance_read_generation_after_sync_commit();
            Ok(())
        })
    }
}

// This integration fixture uses Unix custody and its in-memory OS key-store adapter.
#[cfg(all(test, unix))]
#[path = "afternic_tests.rs"]
mod tests;
