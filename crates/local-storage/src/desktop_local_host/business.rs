use super::{
    BusinessDatabaseError, BusinessMutationContext, DesktopAssetLibraryReadRequest,
    DesktopBusinessRuntime, DesktopConflictCenterView, DesktopConflictResolveRequest,
    DesktopDomainAssetCreateRequest, DesktopDomainAssetDeleteRequest,
    DesktopDomainAssetEditRequest, DesktopDomainAssetProviderBindingReceipt,
    DesktopDomainAssetProviderBindingRequest, DesktopDomainDetailReadRequest, DesktopLocalHost,
    DesktopLocalHostError, Ordering, PrivateWorkspaceAuthority, RuntimeRestriction,
    WorkspaceAuthorityKind, current_unix_seconds, format_timestamp, map_host_database_error,
};

impl DesktopLocalHost {
    /// Reads one bounded window of operation plans under the current Host authority fence. Plan,
    /// operation, attempt and Provider identifiers stay in the Host.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_batch_operations(
        &self,
        request: crate::DesktopBatchOperationsReadRequest,
    ) -> Result<crate::BatchOperationsReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_batch_operations(request.start_index, request.size)?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads one bounded window of manual tasks under the current Host authority fence. Plan,
    /// operation, attempt and connection identifiers stay in the Host.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_manual_tasks(
        &self,
        request: crate::DesktopManualTasksReadRequest,
    ) -> Result<crate::ManualTasksReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_manual_tasks(request.start_index, request.size)?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads one bounded window of the local revision ledger under the current Host authority
    /// fence. Mutation, device and lease identifiers stay in the Host.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_history(
        &self,
        request: crate::DesktopHistoryReadRequest,
    ) -> Result<crate::HistoryReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_history(
                request.start_index,
                request.size,
                (&request.today_from, &request.today_until),
            )?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads one bounded window of expiring assets under the current Host authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_renewals(
        &self,
        request: crate::DesktopRenewalsReadRequest,
    ) -> Result<crate::RenewalsReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_renewals(request.start_index, request.size)?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads one bounded window of observed marketplace listings under the current Host authority
    /// fence. Observation and Provider identifiers stay in the Host.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_sales(
        &self,
        request: crate::DesktopSalesReadRequest,
    ) -> Result<crate::SalesReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_sales(request.start_index, request.size)?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads the settings projection under the current Host authority fence.
    ///
    /// Connection, credential and Provider account identifiers stay in the Host; every declared
    /// role is reported unavailable until its capabilities are qualified.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    pub fn read_settings(&self) -> Result<crate::SettingsReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_settings()?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads one bounded DNS health window under the current Host authority fence.
    ///
    /// The projection carries observed Zone facts only; Provider resource and connection
    /// identifiers stay in the Host.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_dns_health(
        &self,
        request: crate::DesktopDnsHealthReadRequest,
    ) -> Result<crate::DnsHealthReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot =
                runtime.read_dns_health(request.start_index, request.size, &request.query)?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads one bounded asset-library window under the current Host authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_asset_library(
        &self,
        request: DesktopAssetLibraryReadRequest,
    ) -> Result<crate::AssetLibraryReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot =
                runtime.read_asset_library(request.start_index, request.size, &request.query)?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Reads one domain detail under the current Host authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_domain_detail(
        &self,
        request: DesktopDomainDetailReadRequest,
    ) -> Result<crate::DomainDetailReadSnapshot, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut snapshot = runtime.read_domain_detail(&request.entity_id)?;
            apply_read_restriction(&mut snapshot.freshness, restriction);
            Ok(snapshot)
        })
    }

    /// Binds one existing asset to the latest Host-verified Cloudflare Zone observation.
    ///
    /// The Renderer supplies only the asset and an expected local generation. Connection and
    /// Provider resource identity are recovered from Host-local observation evidence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, protocol, or storage error when the binding cannot be admitted
    /// or the final commit fence fails.
    pub fn bind_domain_asset_provider(
        &self,
        request: DesktopDomainAssetProviderBindingRequest,
    ) -> Result<DesktopDomainAssetProviderBindingReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.bind_domain_asset_provider_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Repairs one category of stored rows that reads reject (ADR-0019) under the current Host
    /// commit fence. The repair is local and writes no Outbox row.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when admission, validation, or the final
    /// durable commit fence fails.
    pub fn repair_stored_rows(
        &self,
        request: crate::DesktopStorageRepairRequest,
    ) -> Result<crate::DesktopStorageRepairReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.repair_stored_rows_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Applies one domain-asset mutation under the current Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when mutation admission, validation, or the
    /// final durable commit fence fails.
    pub fn edit_domain_asset(
        &self,
        request: DesktopDomainAssetEditRequest,
    ) -> Result<crate::DomainAssetMutationReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.edit_domain_asset_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Adds one domain the workspace does not hold yet, under the current Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when mutation admission, validation, the
    /// duplicate check, or the final durable commit fence fails.
    pub fn create_domain_asset(
        &self,
        request: DesktopDomainAssetCreateRequest,
    ) -> Result<crate::DomainAssetMutationReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.create_domain_asset_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Deletes one domain asset under the current Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when mutation admission, validation, or the
    /// final durable commit fence fails.
    pub fn delete_domain_asset(
        &self,
        request: DesktopDomainAssetDeleteRequest,
    ) -> Result<crate::DomainAssetMutationReceipt, DesktopLocalHostError> {
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            runtime.delete_domain_asset_guarded(request, &context, || {
                self.require_business_commit_fence(captured_epoch, authority)
            })
        })
    }

    /// Reads the local conflict center under the current Host authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not currently admitted.
    pub fn read_conflict_center(&self) -> Result<DesktopConflictCenterView, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, restriction| {
            let mut view = runtime.read_conflict_center()?;
            if matches!(
                restriction,
                RuntimeRestriction::CommercialReadOnly | RuntimeRestriction::Standby
            ) {
                view.freshness.source = if restriction == RuntimeRestriction::Standby {
                    "standby_cloud"
                } else {
                    "local_continuation"
                };
                for conflict in &mut view.conflicts {
                    conflict.resolution_admission = serde_json::json!({"state":"unavailable"});
                }
            }
            Ok(view)
        })
    }

    /// Resolves one conflict under the current Host installation and commit fences.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when the installation binding, resolution
    /// request, or final durable commit fence cannot be verified.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn resolve_conflict(
        &self,
        request: DesktopConflictResolveRequest,
    ) -> Result<crate::DesktopConflictResolutionReceipt, DesktopLocalHostError> {
        let production_installation_binding = self
            .production_custody
            .as_ref()
            .map(|custody| {
                custody
                    .lock()
                    .map_err(|_| crate::desktop_custody::DesktopCustodyError::StorageRejected)?
                    .installation_binding_digest()
            })
            .transpose()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        #[cfg(test)]
        let installation_binding =
            production_installation_binding.or(self.development_installation_binding);
        #[cfg(not(test))]
        let installation_binding = production_installation_binding;
        let installation_binding =
            installation_binding.ok_or(DesktopLocalHostError::StorageRejected)?;
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            let context = BusinessMutationContext::new(
                authority.device_id.clone(),
                authority.lease_epoch,
                format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
                ),
            )?;
            let resolution_id = request.resolution_id(
                &installation_binding,
                &authority.account_id,
                &authority.workspace_id,
                &authority.device_id,
            );
            let receipt =
                runtime.resolve_conflict_guarded(&request, &resolution_id, &context, || {
                    self.require_business_commit_fence(captured_epoch, authority)
                })?;
            Ok(runtime.resolution_view(&receipt))
        })
    }

    pub(super) fn with_authorized_business<T>(
        &self,
        mutable: bool,
        operation: impl FnOnce(
            &mut DesktopBusinessRuntime,
            &PrivateWorkspaceAuthority,
            u64,
            RuntimeRestriction,
        ) -> Result<T, BusinessDatabaseError>,
    ) -> Result<T, DesktopLocalHostError> {
        // All durable business operations join the aggregate lock order before observing
        // authority. A transition publishes its epoch first, then waits on this same prefix.
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
        let restriction_authorizes = match authority.restriction {
            RuntimeRestriction::Active => current.kind == WorkspaceAuthorityKind::Active,
            RuntimeRestriction::Standby => {
                !mutable && current.kind == WorkspaceAuthorityKind::Standby
            }
            RuntimeRestriction::CommercialReadOnly => {
                !mutable
                    && current.kind == WorkspaceAuthorityKind::VerifiedLocalContinuation
                    && matches!(
                        (
                            authority.continuity.as_ref(),
                            authority.verified_continuation.as_ref(),
                        ),
                        (Some(_), Some(continuation)) if continuation.is_current_at(now)
                    )
            }
            RuntimeRestriction::ActivationRequired
            | RuntimeRestriction::RetryableLocked
            | RuntimeRestriction::SecurityLocked => false,
        };
        if !restriction_authorizes
            || mutable && authority.restriction != RuntimeRestriction::Active
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !current.is_current_at(now)
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let business = &mut runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?
            .business;
        let result = operation(business, current, captured_epoch, authority.restriction)
            .map_err(map_host_database_error)?;
        if !mutable && self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        Ok(result)
    }

    pub(super) fn require_business_commit_fence(
        &self,
        captured_epoch: u64,
        authority: &PrivateWorkspaceAuthority,
    ) -> Result<(), BusinessDatabaseError> {
        #[cfg(test)]
        {
            let requested = self
                .business_commit_transition_epoch
                .swap(0, Ordering::AcqRel);
            if requested != 0 {
                self.transition_requested_epoch
                    .store(requested, Ordering::Release);
            }
        }
        let now = current_unix_seconds().map_err(|_| BusinessDatabaseError::MutationStale)?;
        if self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !authority.is_current_at(now)
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }
}

fn apply_read_restriction(
    freshness: &mut crate::PortfolioReadFreshness,
    restriction: RuntimeRestriction,
) {
    match restriction {
        RuntimeRestriction::Standby => {
            "standby_cloud".clone_into(&mut freshness.source);
            freshness.can_edit = false;
            freshness.read_only_reason = Some("standby".to_owned());
        }
        RuntimeRestriction::CommercialReadOnly => {
            freshness.can_edit = false;
            freshness.read_only_reason = Some("commercial".to_owned());
        }
        _ => {}
    }
}
