use super::{
    BusinessDatabase, DesktopBusinessRuntime, DesktopLocalHost, DesktopLocalHostError,
    DesktopRuntimeState, DesktopSyncCommitGuard, DesktopSyncError, DesktopSyncRejectBatch,
    DesktopSyncRejectDisposition, DesktopSyncRunAdmission, DesktopSyncRuntime, Ordering,
    RuntimeRestriction, WorkspaceAuthorityKind, current_unix_seconds, map_sync_error,
};

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;

impl DesktopLocalHost {
    /// Reads the durable sync snapshot under the same authority gate as business reads.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not admitted.
    pub fn read_sync_snapshot(
        &self,
    ) -> Result<crate::DesktopSyncSnapshotView, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let source = match restriction {
                RuntimeRestriction::CommercialReadOnly => "local_continuation",
                RuntimeRestriction::Standby => "standby_cloud",
                _ => "active_local",
            };
            let blocked_reason = match restriction {
                RuntimeRestriction::CommercialReadOnly => Some("authorization"),
                RuntimeRestriction::Standby => Some("standby"),
                _ => None,
            };
            runtime.read_sync_snapshot(source, blocked_reason)
        })
    }

    pub(crate) fn begin_sync_run(&self) -> Result<DesktopSyncRunAdmission, DesktopLocalHostError> {
        self.with_sync_runtime(None, |sync, database, _| sync.begin_sync_run(database))
    }

    /// Begins one opaque Native Cloud run under the currently accepted Host authority.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error when the Host cannot admit a current run.
    pub fn begin_native_cloud_run(
        &self,
    ) -> Result<crate::DesktopNativeCloudAdmission, DesktopLocalHostError> {
        self.begin_sync_run()
            .map(|inner| crate::DesktopNativeCloudAdmission { inner })
    }

    /// Admits a purpose-bounded Cloud read. A Standby device needs no business database to
    /// inspect its device directory or the progress of a handoff.
    ///
    /// # Errors
    ///
    /// Rejects expired, revoked or superseded authority and continuation-only workspaces.
    pub fn begin_native_cloud_read_run(
        &self,
    ) -> Result<crate::DesktopNativeCloudAdmission, DesktopLocalHostError> {
        let operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        if authority.restriction == RuntimeRestriction::Active {
            drop(authority);
            drop(operation);
            return self.begin_native_cloud_run();
        }
        let current = authority
            .authority
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let epoch = authority.applied_authority_epoch;
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        if authority.restriction != RuntimeRestriction::Standby
            || current.kind != WorkspaceAuthorityKind::Standby
            || self.transition_requested_epoch.load(Ordering::Acquire) != epoch
            || !current.is_current_at(now)
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let inner = DesktopSyncRunAdmission::standby_authority(
            current.workspace_id.clone(),
            current.device_id.clone(),
            current.lease_epoch,
            current.trusted_time_floor,
            current.execute_before,
            super::hex_digest(&current.digest),
            epoch,
        );
        Ok(crate::DesktopNativeCloudAdmission { inner })
    }

    /// Admits only target installation controls while a signed server Active identity awaits
    /// its exact activation receipt. Ordinary sync and Provider callers cannot use this role.
    /// # Errors
    /// Rejects stale identity or a changed local installation gate.
    pub fn begin_target_installation_control_run(
        &self,
    ) -> Result<crate::DesktopNativeCloudAdmission, DesktopLocalHostError> {
        let operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        if authority.restriction == RuntimeRestriction::Active
            && self.installation_context_gate.load(Ordering::Acquire)
        {
            let current = authority
                .authority
                .as_ref()
                .ok_or(DesktopLocalHostError::AuthorityRejected)?;
            let epoch = authority.applied_authority_epoch;
            if current.kind != WorkspaceAuthorityKind::Active
                || self.transition_requested_epoch.load(Ordering::Acquire) != epoch
                || !current.is_current_at(
                    current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?,
                )
            {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
            return Ok(crate::DesktopNativeCloudAdmission {
                inner: DesktopSyncRunAdmission::initial_replica_authority(
                    current.workspace_id.clone(),
                    current.device_id.clone(),
                    current.lease_epoch,
                    current.trusted_time_floor,
                    current.execute_before,
                    super::hex_digest(&current.digest),
                    epoch,
                ),
            });
        }
        drop(authority);
        drop(operation);
        self.begin_native_cloud_read_run()
    }

    /// Lock-free prompt cancellation check. Exact identity and final commit authorization remain
    /// owned by `recheck_native_cloud` and the one-shot Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns an authority error when the admitted run is expired or no longer current.
    pub fn fast_recheck_native_cloud(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        if self.transition_requested_epoch.load(Ordering::Acquire)
            != admission.inner.authority_epoch
            || now < admission.inner.trusted_time_floor
            || now >= admission.inner.execute_before
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        Ok(())
    }

    /// Performs the full exact Host check after an async or blocking boundary.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error when the admitted run is no longer current.
    pub fn recheck_native_cloud(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        if admission.is_installing_target() {
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
            if !self.installation_context_gate.load(Ordering::Acquire)
                || authority.restriction != RuntimeRestriction::Active
                || current.kind != WorkspaceAuthorityKind::Active
                || self.transition_requested_epoch.load(Ordering::Acquire) != epoch
                || !current.is_current_at(
                    current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?,
                )
                || !admission.inner.matches_initial_replica_authority(
                    &current.workspace_id,
                    &current.device_id,
                    current.lease_epoch,
                    current.trusted_time_floor,
                    current.execute_before,
                    &super::hex_digest(&current.digest),
                    epoch,
                )
            {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
            return Ok(());
        }
        if admission.is_active() {
            return self.recheck_sync_run(&admission.inner);
        }
        self.with_standby_cloud_read(admission, || Ok(()))
    }

    fn with_standby_cloud_read<T>(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        read: impl FnOnce() -> Result<T, DesktopLocalHostError>,
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
        if authority.restriction != RuntimeRestriction::Standby
            || current.kind != WorkspaceAuthorityKind::Standby
            || self.transition_requested_epoch.load(Ordering::Acquire) != epoch
            || !current.is_current_at(now)
            || !admission.inner.matches_standby_authority(
                &current.workspace_id,
                &current.device_id,
                current.lease_epoch,
                current.trusted_time_floor,
                current.execute_before,
                &super::hex_digest(&current.digest),
                epoch,
            )
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let result = read()?;
        if self.transition_requested_epoch.load(Ordering::Acquire) != epoch {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        Ok(result)
    }

    pub(crate) fn standby_device_switch_in_progress(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
    ) -> Result<Option<String>, DesktopLocalHostError> {
        self.with_standby_cloud_read(admission, || {
            let mut runtime = self
                .runtime_state
                .lock()
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let Some(runtime) = runtime.as_mut() else {
                return Ok(None);
            };
            let database = runtime.business.database_for_backup_mut();
            if database.workspace_id() != admission.workspace_id() {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
            database
                .device_handoff_barrier()
                .map(|barrier| barrier.map(|barrier| barrier.device_switch_request_id))
                .map_err(super::map_host_database_error)
        })
    }

    /// Rechecks the exact opaque run after a network await without exposing authority fields.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when the run is no longer current.
    pub(crate) fn recheck_sync_run(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.recheck_sync_run(database, admission.expect("admission checked"))
        })
    }

    pub(crate) fn sync_claim(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<crate::desktop_sync_runtime::SyncPushClaimSchedule, DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.sync_claim(database, admission, guard)
        })
    }

    pub(crate) fn sync_acknowledge(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        acknowledgements: &[crate::SyncMutationAcknowledgement],
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_acknowledge(
                business.database_for_backup_mut(),
                admission,
                delivery_owner,
                acknowledgements,
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn sync_defer_retryable_with_deadline(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        mutations: &[crate::ClaimedSyncMutation],
    ) -> Result<std::time::Duration, DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.sync_defer_retryable_with_deadline(
                database,
                admission,
                delivery_owner,
                mutations,
                guard,
            )
        })
    }

    pub(crate) fn sync_reject(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        mutations: &[crate::ClaimedSyncMutation],
        disposition: DesktopSyncRejectDisposition,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_reject(
                business.database_for_backup_mut(),
                admission,
                DesktopSyncRejectBatch {
                    delivery_owner,
                    mutations,
                    disposition,
                },
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn sync_pull_request(
        &self,
        admission: &DesktopSyncRunAdmission,
        page_limit: u16,
    ) -> Result<crate::SyncPullRequestV2, DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.sync_pull_request(database, admission.expect("admission checked"), page_limit)
        })
    }

    pub(crate) fn sync_apply_page(
        &self,
        admission: &DesktopSyncRunAdmission,
        page_json: &str,
        confirmation_token: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_apply_page(
                business.database_for_backup_mut(),
                admission,
                page_json,
                confirmation_token,
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn sync_mark_rebootstrap_required(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            let has_read_generation_capacity = business.has_read_generation_capacity();
            let effect = sync.sync_mark_rebootstrap_required(
                business.database_for_backup_mut(),
                admission,
                has_read_generation_capacity,
                guard,
            )?;
            if effect
                == crate::active_workspace::business::SyncProjectionEffect::VisibleStateChanged
            {
                business.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
    }

    pub(crate) fn checkpoint_due(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<bool, DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.checkpoint_due(database, admission.expect("admission checked"))
        })
    }

    pub(crate) fn complete_checkpoint(
        &self,
        admission: &DesktopSyncRunAdmission,
        descriptor: Option<&crate::NativeCheckpointDescriptor>,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.complete_checkpoint(database, admission, descriptor, guard)
        })
    }
    pub(super) fn with_sync_runtime<T>(
        &self,
        admission: Option<&DesktopSyncRunAdmission>,
        operation: impl FnOnce(
            &DesktopSyncRuntime,
            &mut BusinessDatabase,
            Option<&DesktopSyncRunAdmission>,
        ) -> Result<T, DesktopSyncError>,
    ) -> Result<T, DesktopLocalHostError> {
        let _operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        if self.installation_context_gate.load(Ordering::Acquire)
            || authority.restriction != RuntimeRestriction::Active
            || self.transition_requested_epoch.load(Ordering::Acquire)
                != authority.applied_authority_epoch
            || authority.authority.as_ref().is_none_or(|current| {
                current.kind != WorkspaceAuthorityKind::Active
                    || current_unix_seconds().map_or(true, |now| !current.is_current_at(now))
            })
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let DesktopRuntimeState { business, sync } = runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let sync = sync
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let database = business.database_for_backup_mut();
        let result = operation(sync, database, admission).map_err(map_sync_error)?;
        if self.transition_requested_epoch.load(Ordering::Acquire)
            != authority.applied_authority_epoch
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        Ok(result)
    }

    /// Runs one durable sync/provider stage under the Host lock order
    /// authority -> runtime/writer -> `SQLite`. The one-shot guard captures the exact published
    /// authority and epoch and is consumed as the transaction's final pre-COMMIT action.
    pub(super) fn with_sync_write<T>(
        &self,
        admission: &DesktopSyncRunAdmission,
        operation: impl FnOnce(
            &DesktopSyncRuntime,
            &mut BusinessDatabase,
            &DesktopSyncRunAdmission,
            DesktopSyncCommitGuard<'_>,
        ) -> Result<T, DesktopSyncError>,
    ) -> Result<T, DesktopLocalHostError> {
        self.with_sync_business_write(admission, |sync, business, admission, guard| {
            operation(sync, business.database_for_backup_mut(), admission, guard)
        })
    }

    pub(crate) fn with_sync_business_write<T>(
        &self,
        admission: &DesktopSyncRunAdmission,
        operation: impl FnOnce(
            &DesktopSyncRuntime,
            &mut DesktopBusinessRuntime,
            &DesktopSyncRunAdmission,
            DesktopSyncCommitGuard<'_>,
        ) -> Result<T, DesktopSyncError>,
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
        let captured_epoch = authority.applied_authority_epoch;
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        if self.installation_context_gate.load(Ordering::Acquire)
            || authority.restriction != RuntimeRestriction::Active
            || current.kind != WorkspaceAuthorityKind::Active
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !current.is_current_at(now)
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let DesktopRuntimeState { business, sync } = runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let sync = sync
            .as_ref()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let guard = DesktopSyncCommitGuard::new(|| {
            self.require_business_commit_fence(captured_epoch, current)
                .map_err(|_| DesktopSyncError::StaleAuthority)
        });
        operation(sync, business, admission, guard).map_err(map_sync_error)
    }
}
