//! Native-only delivery of locally signed evidence; no Renderer-selected envelopes or receipts.
use super::{DesktopLocalHost, DesktopLocalHostError};
use crate::active_workspace::business::{
    DesktopExecutionEvidenceDeliveryOutcome, DesktopExecutionEvidenceStream, EvidenceUploadSeed,
};
use crate::desktop_sync_runtime::DesktopSyncError;
use crate::{BusinessDatabaseError, DesktopNativeCloudAdmission};

pub struct DesktopExecutionEvidenceUpload {
    admission: DesktopNativeCloudAdmission,
    seed: EvidenceUploadSeed,
}
impl std::fmt::Debug for DesktopExecutionEvidenceUpload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DesktopExecutionEvidenceUpload([REDACTED])")
    }
}
impl DesktopExecutionEvidenceUpload {
    #[must_use]
    pub const fn stream(&self) -> DesktopExecutionEvidenceStream {
        self.seed.stream
    }
    #[must_use]
    pub fn request_bytes(&self) -> &[u8] {
        &self.seed.request
    }
}
fn database_error(error: BusinessDatabaseError) -> DesktopSyncError {
    match error {
        BusinessDatabaseError::InvalidInput => DesktopSyncError::InvalidInput,
        BusinessDatabaseError::MutationStale => DesktopSyncError::StaleAuthority,
        _ => DesktopSyncError::StorageRejected,
    }
}
impl DesktopLocalHost {
    /// Selects one exact own-source envelope after its actual causal predecessors are acknowledged.
    /// # Errors
    /// Refuses stale authority, unknown installation origin, quarantined receipts or corrupt sources.
    pub fn next_execution_evidence_upload(
        &self,
        admission: DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopExecutionEvidenceUpload>, DesktopLocalHostError> {
        let seed = self.with_sync_runtime(Some(&admission.inner), |_, database, run| {
            let run = run.ok_or(DesktopSyncError::StaleAuthority)?;
            database
                .next_execution_evidence_upload(&self.execution_evidence_context(run)?)
                .map_err(database_error)
        })?;
        Ok(seed.map(|seed| DesktopExecutionEvidenceUpload { admission, seed }))
    }
    /// Persists only the exact immutable Cloud receipt for the offered envelope, behind the final fence.
    /// # Errors
    /// Rejects oversized/unknown responses, mismatched receipts, changed authority and canceled read generations.
    pub fn record_execution_evidence_response(
        &self,
        upload: &DesktopExecutionEvidenceUpload,
        response: &[u8],
    ) -> Result<DesktopExecutionEvidenceDeliveryOutcome, DesktopLocalHostError> {
        self.with_sync_business_write(&upload.admission.inner, |sync, business, run, guard| {
            let context = self.execution_evidence_context(run)?;
            business
                .database_for_backup_mut()
                .record_execution_evidence_response(&context, &upload.seed, response, || {
                    self.require_execution_context(run)
                        .map_err(|_| BusinessDatabaseError::MutationStale)
                        .and_then(|()| guard.verify(sync, run))
                })
                .map_err(database_error)
        })
    }
}

#[cfg(all(test, unix))]
impl DesktopExecutionEvidenceUpload {
    pub(crate) fn test_accepted_response(&self, at: &str) -> Vec<u8> {
        self.seed.test_accepted_response(at)
    }
}

impl DesktopLocalHost {
    /// Counts unresolved Provider claims explicitly retained on this source device by the drain freeze.
    /// # Errors
    /// Refuses stale Native admission or malformed durable state.
    pub fn native_device_switch_frozen_unresolved_count(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<u64, DesktopLocalHostError> {
        self.with_sync_runtime(Some(&admission.inner), |sync, database, run| {
            let run = run.ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?;
            sync.drain_frozen_unresolved_count(database, run)
        })
    }
}

impl DesktopLocalHost {
    pub(crate) fn drain_signing_key_version(
        &self,
        run: &crate::desktop_sync_runtime::DesktopSyncRunAdmission,
        key_id: &str,
    ) -> Result<u64, DesktopSyncError> {
        let context = self.execution_evidence_context(run)?;
        if context.signing_key_id != key_id {
            return Err(DesktopSyncError::StaleAuthority);
        }
        Ok(context.signing_key_version)
    }
}
