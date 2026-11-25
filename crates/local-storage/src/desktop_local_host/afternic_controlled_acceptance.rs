//! The development run narrows existing Afternic admission; it never replaces live authority.
use super::DesktopLocalHost;
use crate::active_workspace::business::{
    AFTERNIC_ACCEPTANCE_ENABLED, AFTERNIC_ACCEPTANCE_EXPIRES, BusinessDatabase,
    DesktopAfternicControlledAcceptance, ExecutionEvidenceContext,
};
use crate::active_workspace::capability_qualification::capability_qualified;
use crate::desktop_sync_runtime::{DesktopSyncError, DesktopSyncRunAdmission, DesktopSyncRuntime};
const OBSERVE: &str = "afternic:marketplace:observe";
const WRITE: &str = "afternic:marketplace:write";
impl DesktopLocalHost {
    pub(super) fn afternic_acceptance_context(
        &self,
        run: &DesktopSyncRunAdmission,
        write: bool,
    ) -> Result<Option<ExecutionEvidenceContext>, DesktopSyncError> {
        if capability_qualified(OBSERVE) && (!write || capability_qualified(WRITE)) {
            return Ok(None);
        }
        if !AFTERNIC_ACCEPTANCE_ENABLED {
            return Err(DesktopSyncError::CapabilityUnqualified);
        }
        let evidence = self.execution_evidence_context(run)?;
        if evidence.occurred_at.as_str() < "2026-11-19T00:00:00Z"
            || evidence.occurred_at.as_str() >= AFTERNIC_ACCEPTANCE_EXPIRES
        {
            return Err(DesktopSyncError::StaleAuthority);
        }
        Ok(Some(evidence))
    }
    pub(super) fn admit_afternic_access(
        &self,
        sync: &DesktopSyncRuntime,
        run: &DesktopSyncRunAdmission,
        database: &BusinessDatabase,
        write: bool,
        allow_unbound: bool,
    ) -> Result<(), DesktopSyncError> {
        sync.require_provider_capability(run, OBSERVE)?;
        if write {
            sync.require_provider_capability(run, WRITE)?;
        }
        if let Some(e) = self.afternic_acceptance_context(run, write)? {
            database
                .afternic_controlled_acceptance(&e, allow_unbound)
                .map_err(|_| DesktopSyncError::StaleAuthority)?;
        }
        Ok(())
    }
    pub(super) fn require_afternic_execution_context(
        &self,
        run: &DesktopSyncRunAdmission,
        write: bool,
    ) -> Result<(), DesktopSyncError> {
        self.require_execution_context(run)?;
        self.afternic_acceptance_context(run, write).map(|_| ())
    }
    pub(super) fn require_afternic_acceptance_targets(
        &self,
        run: &DesktopSyncRunAdmission,
        database: &BusinessDatabase,
        connection: &str,
        domains: impl IntoIterator<Item = impl AsRef<str>>,
        write: bool,
    ) -> Result<(), DesktopSyncError> {
        if let Some(e) = self.afternic_acceptance_context(run, write)? {
            database
                .require_afternic_controlled_targets(&e, connection, domains)
                .map_err(|_| DesktopSyncError::StaleAuthority)?;
        }
        Ok(())
    }
    pub(super) fn require_afternic_acceptance_plans(
        &self,
        run: &DesktopSyncRunAdmission,
        database: &BusinessDatabase,
        plan: Option<&str>,
        write: bool,
    ) -> Result<(), DesktopSyncError> {
        if let Some(e) = self.afternic_acceptance_context(run, write)? {
            database
                .require_afternic_controlled_plans(&e, plan)
                .map_err(|_| DesktopSyncError::StaleAuthority)?;
        }
        Ok(())
    }
    /// Separate read lock scope avoids reentering publication while deriving current admission.
    pub(super) fn afternic_acceptance_status(
        &self,
        write: bool,
    ) -> Option<DesktopAfternicControlledAcceptance> {
        let admission = self.begin_native_cloud_run().ok()?;
        self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            sync.require_provider_capability(run, OBSERVE)?;
            if write {
                sync.require_provider_capability(run, WRITE)?;
            }
            let Some(e) = self.afternic_acceptance_context(run, write)? else {
                return Ok(None);
            };
            database
                .afternic_controlled_acceptance(&e, true)
                .map(Some)
                .map_err(|_| DesktopSyncError::StaleAuthority)
        })
        .ok()
        .flatten()
    }
}

#[cfg(all(test, feature = "afternic-controlled-acceptance", target_os = "linux"))]
#[path = "afternic_controlled_acceptance_tests.rs"]
mod tests;
