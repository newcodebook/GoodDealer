//! Purpose-bounded receipt persistence and Standby Inbox access; never an Active writer gate.
use super::{
    DesktopBusinessRuntime, DesktopLocalHost, DesktopLocalHostError, Ordering, RuntimeRestriction,
    WorkspaceAuthorityKind, current_unix_seconds, hex_digest, map_host_database_error,
    map_sync_error,
};
use crate::{BusinessDatabaseError, DesktopNativeCloudAdmission};

impl DesktopLocalHost {
    pub(crate) fn with_native_handoff_state<T>(
        &self,
        admission: &DesktopNativeCloudAdmission,
        require_drained_replica: bool,
        action: impl FnOnce(
            &mut DesktopBusinessRuntime,
            &dyn Fn() -> Result<(), BusinessDatabaseError>,
        ) -> Result<T, BusinessDatabaseError>,
    ) -> Result<T, DesktopLocalHostError> {
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let current = authority
            .authority
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let epoch = authority.applied_authority_epoch;
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        if self.transition_requested_epoch.load(Ordering::Acquire) != epoch
            || !current.is_current_at(now)
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let standby = authority.restriction == RuntimeRestriction::Standby
            && current.kind == WorkspaceAuthorityKind::Standby;
        if standby {
            if !admission.inner.matches_standby_authority(
                &current.workspace_id,
                &current.device_id,
                current.lease_epoch,
                current.trusted_time_floor,
                current.execute_before,
                &hex_digest(&current.digest),
                epoch,
            ) {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
        } else if !admission.is_active()
            || authority.restriction != RuntimeRestriction::Active
            || current.kind != WorkspaceAuthorityKind::Active
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let runtime = runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let db = runtime.business.database_for_backup_mut();
        if db.workspace_id() != admission.workspace_id() {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        if !standby {
            runtime
                .sync
                .as_ref()
                .ok_or(DesktopLocalHostError::AuthorityRejected)?
                .recheck_sync_run(db, &admission.inner)
                .map_err(map_sync_error)?;
        }
        if require_drained_replica {
            if !standby {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
            let custody = self
                .production_custody
                .as_ref()
                .ok_or(DesktopLocalHostError::AuthorityRejected)?
                .lock()
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let floor = custody
                .load_authorization_floor()
                .map_err(|_| DesktopLocalHostError::AuthorityRejected)?
                .ok_or(DesktopLocalHostError::AuthorityRejected)?;
            if floor.account_id != current.account_id
                || floor.workspace_id != current.workspace_id
                || floor.device_id != current.device_id
                || floor.account_security_epoch != current.account_security_epoch
            {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
            let last_active = floor
                .last_active_lease_epoch
                .ok_or(DesktopLocalHostError::AuthorityRejected)?;
            db.require_normal_handoff_replica(&current.device_id, last_active)
                .map_err(map_host_database_error)?;
        }
        // The same publication mutex remains held across the single database transaction. The
        // last check also catches prompt cancellation before the pending role publication locks.
        let fence = || self.require_business_commit_fence(epoch, current);
        let result = action(&mut runtime.business, &fence).map_err(map_host_database_error)?;
        fence().map_err(map_host_database_error)?;
        Ok(result)
    }

    pub(crate) fn store_native_handoff_attempt(
        &self,
        admission: &DesktopNativeCloudAdmission,
        attempt: &crate::active_workspace::business::NormalHandoffAttempt,
        body: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        self.with_native_handoff_state(admission, false, |business, fence| {
            let db = business.database_for_backup_mut();
            let barrier = db
                .device_handoff_barrier()?
                .ok_or(BusinessDatabaseError::MutationStale)?;
            if barrier.device_switch_request_id != attempt.request_id
                || barrier.active_lease_epoch != Some(attempt.source_lease_epoch)
                || db
                    .normal_handoff_attempt(&attempt.request_id)?
                    .is_some_and(|(old, _)| old != *attempt)
            {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            let custody = self
                .production_custody
                .as_ref()
                .ok_or(BusinessDatabaseError::StorageRejected)?
                .lock()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            // Native material first, public attempt second, HTTP last. An orphaned Native slot
            // cannot execute; a committed attempt always has its exact recoverable request.
            if db.normal_handoff_attempt(&attempt.request_id)?.is_none()
                && custody
                    .load_handoff_submission(&attempt.request_id)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?
                    .is_some()
            {
                // No committed attempt means this slot never reached HTTP; replace only this
                // orphan. An existing database attempt can only replay its original bytes.
                custody
                    .clear_handoff_submission(&attempt.request_id)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            custody
                .store_handoff_submission(&attempt.request_id, body)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            db.record_normal_handoff_attempt(attempt, fence)
        })
    }

    pub(crate) fn load_native_handoff_attempt(
        &self,
        admission: &DesktopNativeCloudAdmission,
        request_id: &str,
    ) -> Result<
        Option<(
            crate::active_workspace::business::NormalHandoffAttempt,
            Vec<u8>,
        )>,
        DesktopLocalHostError,
    > {
        if !admission.is_active() {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        self.with_native_handoff_state(admission, false, |business, _| {
            let db = business.database_for_backup_mut();
            let Some((attempt, receipt)) = db.normal_handoff_attempt(request_id)? else {
                return Ok(None);
            };
            let barrier = db
                .device_handoff_barrier()?
                .ok_or(BusinessDatabaseError::MutationStale)?;
            if barrier.device_switch_request_id != request_id
                || barrier.active_lease_epoch != Some(attempt.source_lease_epoch)
                || attempt.source_lease_epoch != admission.inner.lease_epoch()
                || attempt.source_device_id != admission.inner.device_id()
            {
                return Err(BusinessDatabaseError::MutationStale);
            }
            let now = crate::desktop_sync_runtime::timestamp(
                crate::desktop_sync_runtime::trusted_now()
                    .map_err(|_| BusinessDatabaseError::MutationStale)?,
            )
            .map_err(|_| BusinessDatabaseError::MutationStale)?;
            if receipt.is_some()
                || db.normal_handoff_submission_refused(request_id)?
                || now >= attempt.expires_at
                || now < attempt.issued_at
            {
                return Ok(None);
            }
            let custody = self
                .production_custody
                .as_ref()
                .ok_or(BusinessDatabaseError::StorageRejected)?
                .lock()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let body = custody
                .load_handoff_submission(request_id)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
                .ok_or(BusinessDatabaseError::StorageRejected)?;
            Ok(Some((attempt, body)))
        })
    }

    pub(crate) fn standby_sync_pull_request(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<crate::SyncPullRequestV2, DesktopLocalHostError> {
        self.with_native_handoff_state(admission, true, |business, _| {
            business
                .database_for_backup_mut()
                .read_sync_pull_request_v2(admission.inner.device_id(), 256)
        })
    }

    pub(crate) fn standby_sync_apply_page(
        &self,
        admission: &DesktopNativeCloudAdmission,
        page: &str,
        token: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_native_handoff_state(admission, true, |business, fence| {
            let capacity = business.has_read_generation_capacity();
            let effect = business.database_for_backup_mut().apply_sync_page_v2_guarded(admission.inner.device_id(), page, token, |effect| {
                if effect == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged && !capacity {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                fence()
            })?;
            if effect == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn standby_sync_mark_rebootstrap_required(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_native_handoff_state(admission, true, |business, fence| {
            let capacity = business.has_read_generation_capacity();
            let effect = business.database_for_backup_mut().mark_sync_rebootstrap_required_v2_guarded(admission.inner.device_id(), |effect| {
                if effect == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged && !capacity {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                fence()
            })?;
            if effect == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }
}
