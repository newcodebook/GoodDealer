use super::{
    ActionAdmission, BackupArtifactSelectRequest, BackupExportRequest, BackupRestoreRequest,
    BusinessDatabaseError, ConnectionGenerationAdvance, DesktopBackupError,
    DesktopBackupExportStatus, DesktopBackupRestoreStatus, DesktopLocalHost,
    DesktopVerifiedBackupArtifact, ExportRequest, IsolatedBackupCandidate, MAX_SAFE_INTEGER,
    Ordering, RestoreAdmission, SelectedArtifactView, WorkspaceAuthorityKind,
    WorkspaceAuthorityState, current_unix_seconds, format_timestamp, hex_digest,
    map_container_error, map_database_error, opaque_artifact_id, parse_request, random_identifier,
    validate_restore_request, validate_schema_and_operation,
};

impl DesktopLocalHost {
    pub(super) fn require_current_authority(
        &self,
        state: &WorkspaceAuthorityState,
        restore: bool,
    ) -> Result<u64, DesktopBackupError> {
        if !state.backup.native.is_qualified() {
            return Err(DesktopBackupError::StorageRejected);
        }
        let authority = state
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        if restore {
            if authority.kind != WorkspaceAuthorityKind::Active {
                return Err(DesktopBackupError::AuthorityRejected);
            }
        } else if !authority.kind.can_export_or_inspect() {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let captured_epoch = state.applied_authority_epoch;
        self.require_captured_epoch(state, captured_epoch, restore)?;
        Ok(captured_epoch)
    }

    pub(super) fn require_captured_epoch(
        &self,
        state: &WorkspaceAuthorityState,
        captured_epoch: u64,
        restore: bool,
    ) -> Result<(), DesktopBackupError> {
        let authority = state
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        let now = current_unix_seconds()?;
        if captured_epoch == 0
            || state.applied_authority_epoch != captured_epoch
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !authority.is_current_at(now)
            || restore && authority.kind != WorkspaceAuthorityKind::Active
        {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        Ok(())
    }

    /// Returns only the redacted current workflow status.
    #[must_use]
    pub fn backup_status(&self) -> DesktopBackupRestoreStatus {
        let Ok(mut operation) = self.operation_selection.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Ok(authority) = self.authority_publication.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Some(current_authority) = authority.authority.as_ref() else {
            operation.export_operation_id = None;
            operation.selection_operation_id = None;
            operation.export_consumed = true;
            operation.selection_consumed = true;
            return DesktopBackupRestoreStatus::unavailable(None);
        };
        if !authority.backup.native.is_qualified()
            || !current_authority.kind.can_export_or_inspect()
            || self.transition_requested_epoch.load(Ordering::Acquire)
                != authority.applied_authority_epoch
            || !current_authority.is_current_at(current_unix_seconds().unwrap_or(i64::MAX))
        {
            operation.export_operation_id = None;
            operation.selection_operation_id = None;
            operation.export_consumed = true;
            operation.selection_consumed = true;
            return DesktopBackupRestoreStatus::unavailable(None);
        }
        let Ok(export_operation_id) = random_identifier("export") else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Ok(selection_operation_id) = random_identifier("select") else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        operation.export_operation_id = Some(export_operation_id.clone());
        operation.selection_operation_id = Some(selection_operation_id.clone());
        operation.export_consumed = false;
        operation.selection_consumed = false;
        DesktopBackupRestoreStatus {
            schema_version: 1,
            kind: "local_backup_restore_status",
            authority: current_authority.kind.wire(),
            export_admission: ActionAdmission::Available {
                operation_id: export_operation_id,
            },
            artifact_selection_admission: ActionAdmission::Available {
                operation_id: selection_operation_id,
            },
            selected_artifact: operation.selected_artifact.as_ref().map_or(
                SelectedArtifactView::None,
                |artifact| SelectedArtifactView::Verified {
                    artifact_id: artifact.artifact_id.clone(),
                    created_at: artifact.created_at.clone(),
                    backup_schema_version: artifact.backup_schema_version,
                    compatibility: artifact.compatibility,
                    restore_admission: artifact.restore_admission.clone(),
                },
            ),
            error: None,
        }
    }

    /// Validates an untrusted export intent and performs the closed aggregate operation.
    ///
    /// # Errors
    ///
    /// Returns a coarse rejection without parser, authority, path, or key diagnostics.
    pub fn export_backup(
        &self,
        untrusted_request_wire: &[u8],
    ) -> Result<DesktopBackupExportStatus, DesktopBackupError> {
        let request: BackupExportRequest = parse_request(untrusted_request_wire)?;
        validate_schema_and_operation(request.schema_version, &request.operation_id)?;
        if request.include_platform_credentials {
            return Err(DesktopBackupError::CredentialsNotAllowed);
        }
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let mut authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        if operation.export_consumed
            || operation.export_operation_id.as_deref() != Some(request.operation_id.as_str())
        {
            return Err(DesktopBackupError::OperationRejected);
        }
        operation.export_consumed = true;
        let captured_epoch = self.require_current_authority(&authority, false)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let projection = runtime
            .as_mut()
            .ok_or(DesktopBackupError::AuthorityRejected)?
            .business
            .database_for_backup_mut()
            .backup_source()
            .snapshot()
            .map_err(map_database_error)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let current_authority = authority
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        if projection.workspace_id() != current_authority.workspace_id {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let frames = projection.data_frames();
        let data_plaintext_bytes = frames.iter().try_fold(0_u64, |total, frame| {
            total.checked_add(u64::try_from(frame.len()).ok()?)
        });
        let data_plaintext_bytes =
            data_plaintext_bytes.ok_or(DesktopBackupError::ArtifactRejected)?;
        let container = authority
            .backup
            .container
            .as_ref()
            .ok_or(DesktopBackupError::KeyUnavailable)?;
        let created_at_epoch_seconds = u64::try_from(current_unix_seconds()?)
            .map_err(|_| DesktopBackupError::AuthorityRejected)?;
        let manifest = container.manifest(
            *projection.source_proof_digest(),
            1,
            created_at_epoch_seconds,
            u32::from(crate::desktop_local_host::source::ALLOWLIST_VERSION),
            u32::try_from(frames.len()).map_err(|_| DesktopBackupError::ArtifactRejected)?,
            data_plaintext_bytes,
            current_authority.digest,
        );
        let sealed = container
            .export_at_epoch(
                ExportRequest::new(1, manifest, &frames),
                &self.transition_requested_epoch,
                captured_epoch,
            )
            .map_err(map_container_error)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let staged = authority
            .backup
            .native
            .stage_publication(&request.operation_id, sealed.bytes())?;
        if let Err(error) = self.require_captured_epoch(&authority, captured_epoch, false) {
            authority.backup.native.quarantine(&staged);
            return Err(error);
        }
        // Catalog visibility is the operation's linearization point. A transition publishes its
        // pending epoch before waiting for this authority guard; an intent observed above aborts,
        // while an intent published after the check is ordered after this guarded commit.
        authority.backup.native.mark_available(&staged)?;
        Ok(DesktopBackupExportStatus::completed())
    }

    /// Selects and fully authenticates a native artifact without exposing its handle or bytes.
    ///
    /// # Errors
    ///
    /// Returns a coarse rejection without parser, authority, path, or key diagnostics.
    #[allow(
        clippy::too_many_lines,
        reason = "selection admission, authentication, and retained CAS state stay contiguous"
    )]
    pub fn inspect_backup(
        &self,
        untrusted_request_wire: &[u8],
    ) -> Result<DesktopVerifiedBackupArtifact, DesktopBackupError> {
        let request: BackupArtifactSelectRequest = parse_request(untrusted_request_wire)?;
        validate_schema_and_operation(request.schema_version, &request.operation_id)?;
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        if operation.selection_consumed
            || operation.selection_operation_id.as_deref() != Some(request.operation_id.as_str())
        {
            return Err(DesktopBackupError::OperationRejected);
        }
        operation.selection_consumed = true;
        operation.selected_handle = None;
        operation.selected_artifact = None;
        let captured_epoch = self.require_current_authority(&authority, false)?;
        let handle = authority.backup.native.select()?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let artifact_bytes = authority.backup.native.read(&handle)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let candidate_set_version = operation
            .generation
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(DesktopBackupError::StorageRejected)?;
        let container = authority
            .backup
            .container
            .as_ref()
            .ok_or(DesktopBackupError::KeyUnavailable)?;
        let (verified, ()) = container
            .import_at_epoch(
                &artifact_bytes,
                &self.transition_requested_epoch,
                captured_epoch,
                |backup_id, source_proof, frames| {
                    let artifact_id = opaque_artifact_id(backup_id);
                    let candidate = IsolatedBackupCandidate::from_authenticated_frames(
                        &artifact_id,
                        candidate_set_version,
                        source_proof,
                        frames,
                    )
                    .map_err(|_| ())?;
                    drop(candidate);
                    Ok(())
                },
            )
            .map_err(map_container_error)?;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let current_revision = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?
            .business
            .recovery_proof()
            .map_err(map_database_error)?
            .local_commit_sequence;
        self.require_captured_epoch(&authority, captured_epoch, false)?;
        let artifact_id = opaque_artifact_id(verified.backup_id());
        let compatibility = if verified.workspace_schema_version() == 1
            && verified.allowlist_version()
                == u32::from(
                    crate::desktop_local_host::source::BackupProjection::allowlist_version(),
                ) {
            "compatible"
        } else {
            "unsupported_schema"
        };
        let restore_admission = if authority
            .authority
            .as_ref()
            .is_some_and(|current| current.kind == WorkspaceAuthorityKind::Active)
            && compatibility == "compatible"
        {
            RestoreAdmission::Available {
                operation_id: random_identifier("restore")?,
                dialog_id: random_identifier("dialog")?,
                expected_current_revision: current_revision,
                candidate_set_version,
            }
        } else {
            RestoreAdmission::Unavailable
        };
        let artifact = DesktopVerifiedBackupArtifact {
            state: "verified",
            artifact_id,
            created_at: format_timestamp(
                i64::try_from(verified.created_at_epoch_seconds())
                    .map_err(|_| DesktopBackupError::ArtifactRejected)?,
            ),
            backup_schema_version: verified.workspace_schema_version(),
            compatibility,
            restore_admission,
        };
        operation.selected_handle = Some(handle);
        operation.selected_artifact = Some(artifact.clone());
        operation.selected_authority_generation = authority
            .authority
            .as_ref()
            .map(|current| current.generation);
        operation.selected_authority_digest =
            authority.authority.as_ref().map(|current| current.digest);
        operation.generation = candidate_set_version;
        Ok(artifact)
    }

    /// Reauthenticates the exact admitted artifact and applies it under the owned DB writer.
    ///
    /// # Errors
    ///
    /// Returns a coarse rejection without parser, authority, path, or key diagnostics.
    #[allow(
        clippy::too_many_lines,
        reason = "reread, reauthentication, current-DB transaction, and final fence stay contiguous"
    )]
    pub fn restore_backup(
        &self,
        untrusted_request_wire: &[u8],
    ) -> Result<DesktopBackupRestoreStatus, DesktopBackupError> {
        let request: BackupRestoreRequest = parse_request(untrusted_request_wire)?;
        validate_restore_request(&request)?;
        let _generation = ConnectionGenerationAdvance::new(&self.provider_connection_generation);
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let selected = operation
            .selected_artifact
            .take()
            .ok_or(DesktopBackupError::OperationRejected)?;
        let restore_admission = match selected.restore_admission {
            RestoreAdmission::Available {
                operation_id,
                dialog_id,
                expected_current_revision,
                candidate_set_version,
            } => (
                operation_id,
                dialog_id,
                expected_current_revision,
                candidate_set_version,
            ),
            RestoreAdmission::Unavailable => return Err(DesktopBackupError::AuthorityRejected),
        };
        if request.operation_id != restore_admission.0
            || request.dialog_id != restore_admission.1
            || request.artifact_id != selected.artifact_id
            || request.expected_current_revision != restore_admission.2
            || request.candidate_set_version != restore_admission.3
        {
            return Err(DesktopBackupError::OperationRejected);
        }
        let captured_epoch = self.require_current_authority(&authority, true)?;
        let handle = operation
            .selected_handle
            .take()
            .ok_or(DesktopBackupError::OperationRejected)?;
        let artifact_bytes = authority.backup.native.read(&handle)?;
        self.require_captured_epoch(&authority, captured_epoch, true)?;
        let current_authority = authority
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        if operation.selected_authority_generation != Some(current_authority.generation)
            || operation.selected_authority_digest != Some(current_authority.digest)
        {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let authority_digest = hex_digest(&current_authority.digest);
        let restore_authority = crate::desktop_local_host::restore::RestoreAuthoritySnapshot {
            authority_snapshot_digest: authority_digest.clone(),
            source_device_id: current_authority.device_id.clone(),
            active_lease_epoch: current_authority.lease_epoch,
            committed_at: format_timestamp(current_unix_seconds()?),
        };
        let restore_request = crate::desktop_local_host::restore::RestoreRequest {
            operation_id: &request.operation_id,
            expected_current_revision: request.expected_current_revision,
            expected_candidate_set_version: request.candidate_set_version,
            expected_authority_snapshot_digest: &authority_digest,
        };
        let execute_before = current_authority.execute_before;
        let trusted_time_floor = current_authority.trusted_time_floor;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let database = runtime
            .as_mut()
            .ok_or(DesktopBackupError::AuthorityRejected)?
            .business
            .database_for_backup_mut();
        let container = authority
            .backup
            .container
            .as_ref()
            .ok_or(DesktopBackupError::KeyUnavailable)?;
        let (_, restore_result) = container
            .import_at_epoch(
                &artifact_bytes,
                &self.transition_requested_epoch,
                captured_epoch,
                |backup_id, source_proof, frames| {
                    if opaque_artifact_id(backup_id) != request.artifact_id {
                        return Err(());
                    }
                    let candidate = IsolatedBackupCandidate::from_authenticated_frames(
                        &request.artifact_id,
                        request.candidate_set_version,
                        source_proof,
                        frames,
                    )
                    .map_err(|_| ())?;
                    let mut authority_guard = ();
                    let result = database.restore_backup_candidate_guarded(
                        &candidate,
                        &restore_request,
                        &mut authority_guard,
                        &restore_authority,
                        |(), _| {
                            #[cfg_attr(not(unix), cfg(any()))]
                            #[cfg(test)]
                            self.publish_scheduled_restore_transition_for_test(
                                &self.restore_precommit_transition_epoch,
                            );
                            let now = current_unix_seconds()
                                .map_err(|_| BusinessDatabaseError::MutationStale)?;
                            if self.transition_requested_epoch.load(Ordering::Acquire)
                                != captured_epoch
                                || now < trusted_time_floor
                                || now >= execute_before
                            {
                                Err(BusinessDatabaseError::MutationStale)
                            } else {
                                Ok(())
                            }
                        },
                    );
                    #[cfg_attr(not(unix), cfg(any()))]
                    #[cfg(test)]
                    if result.is_ok() {
                        // The database callback has crossed SQLite COMMIT. Publishing a later
                        // transition intent here must not rewrite that durable outcome as failure.
                        self.publish_scheduled_restore_transition_for_test(
                            &self.restore_postcommit_transition_epoch,
                        );
                    }
                    drop(candidate);
                    Ok(result)
                },
            )
            .map_err(map_container_error)?;
        restore_result.map_err(map_database_error)?;
        operation.selected_handle = None;
        operation.selected_artifact = None;
        operation.selected_authority_generation = None;
        operation.selected_authority_digest = None;
        Ok(DesktopBackupRestoreStatus {
            schema_version: 1,
            kind: "local_backup_restore_status",
            authority: "active",
            export_admission: ActionAdmission::Unavailable,
            artifact_selection_admission: ActionAdmission::Unavailable,
            selected_artifact: SelectedArtifactView::None,
            error: None,
        })
    }

    /// Cancels private selection state and returns the resulting redacted status.
    #[must_use]
    pub fn cancel_backup(&self) -> DesktopBackupRestoreStatus {
        let Ok(mut operation) = self.operation_selection.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        let Ok(authority) = self.authority_publication.lock() else {
            return DesktopBackupRestoreStatus::unavailable(Some("BACKUP_STORAGE_REJECTED"));
        };
        operation.selected_handle = None;
        operation.selected_artifact = None;
        operation.selected_authority_generation = None;
        operation.selected_authority_digest = None;
        operation.export_operation_id = None;
        operation.selection_operation_id = None;
        operation.export_consumed = true;
        operation.selection_consumed = true;
        operation.generation = operation.generation.saturating_add(1);
        drop(authority);
        drop(operation);
        self.backup_status()
    }
}
