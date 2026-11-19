use super::authority::VerifiedWorkspaceRole;
use super::{
    BarrierReason, DesktopAuthorityIdentity, DesktopBusinessRuntime, DesktopDeviceLease,
    DesktopHostAuthorizationStatus, DesktopLocalBusinessState, DesktopLocalBusinessStatus,
    DesktopLocalHost, DesktopLocalHostError, DesktopRuntimeState, DesktopStatusSnapshot,
    DesktopSyncRuntime, HostOperationState, MAX_SAFE_INTEGER, Ordering, PrivateWorkspaceAuthority,
    RuntimeRestriction, TrustedWorkspaceBinding, WorkspaceAuthorityKind, WorkspaceAuthorityState,
    clear_operation_state, closed_business_status, current_unix_seconds, format_timestamp,
};
use crate::desktop_custody::{CommercialAuthorizationFloor, WorkspaceAuthorizationFloor};

impl DesktopLocalHost {
    /// Returns a closed authorization state without exposing identity, epochs, or deadlines.
    #[must_use]
    pub fn authorization_status(&self) -> DesktopHostAuthorizationStatus {
        self.status_snapshot().authorization
    }

    /// Accepts the strict v4 role exchange. Native custody persists authority floors before
    /// publication; Standby never acquires execution authority or creates an empty replica.
    ///
    /// # Errors
    ///
    /// Returns a closed authority, availability, or storage error when the signed wire, current
    /// authority floor, native custody, or durable workspace cannot be verified and published.
    #[expect(
        clippy::too_many_lines,
        reason = "the activation transition intentionally keeps its complete lock and failure fence visible"
    )]
    pub fn activate_authorization_grant(
        &self,
        signed_wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        if signed_wire.is_empty()
            || signed_wire.len() > crate::desktop_local_host::authority::MAX_SIGNED_WIRE_BYTES
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let requested = self
            .transition_requested_epoch
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value
                    .checked_add(1)
                    .filter(|next| *next <= MAX_SAFE_INTEGER)
            })
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?
            .checked_add(1)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let custody = if let Some(custody) = self.production_custody.as_ref() {
            Some(custody.lock().map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::StorageRejected,
                )
            })?)
        } else {
            #[cfg(not(test))]
            {
                return Err(self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::Unavailable,
                ));
            }
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            {
                None
            }
        };
        let verifier = self.authority_verifier.as_ref().ok_or_else(|| {
            self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::Unavailable,
            )
        })?;
        let device_id = if let Some(custody) = custody.as_ref() {
            custody.load_device_id().map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::AuthorityRejected,
                )
            })?
        } else {
            #[cfg_attr(not(unix), cfg(any()))]
            #[cfg(test)]
            {
                authority
                    .authority
                    .as_ref()
                    .map(|current| current.device_id.clone())
                    .ok_or_else(|| {
                        self.abort_transition(
                            &mut authority,
                            &mut runtime,
                            &mut operation,
                            requested,
                            DesktopLocalHostError::Unavailable,
                        )
                    })?
            }
            #[cfg(not(test))]
            unreachable!("production custody absence returns above")
        };
        let Ok(now) = current_unix_seconds() else {
            return Err(self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            ));
        };
        let binding = TrustedWorkspaceBinding {
            account_id: authority
                .authority
                .as_ref()
                .map(|value| value.account_id.as_str()),
            device_id: &device_id,
            minimum_account_security_epoch: authority
                .authority
                .as_ref()
                .map_or(0, |value| value.account_security_epoch),
            minimum_lease_epoch: authority
                .authority
                .as_ref()
                .map_or(0, |value| value.lease_epoch),
        };
        let Ok(verified_role) = VerifiedWorkspaceRole::verify(signed_wire, &binding, now, verifier)
        else {
            return Err(self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            ));
        };
        // Reject an incompatible in-memory replacement before persisting its durable floor.
        if let VerifiedWorkspaceRole::Active(active) = &verified_role
            && authority.authority.as_ref().is_some_and(|current| {
                current.kind != WorkspaceAuthorityKind::Standby && !current.can_replace_with(active)
            })
        {
            return Err(self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            ));
        }
        let custody = custody.as_ref().ok_or_else(|| {
            self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::Unavailable,
            )
        })?;
        let floor_result = (|| {
            let old = custody.load_authorization_floor()?;
            let installation_binding = custody.installation_binding_digest()?;
            let candidate = match &verified_role {
                VerifiedWorkspaceRole::Active(active) => WorkspaceAuthorizationFloor {
                    schema_version: 3,
                    installation_binding,
                    account_id: active.account_id().to_owned(),
                    workspace_id: active.workspace_id().to_owned(),
                    device_id: active.device_id().to_owned(),
                    account_security_epoch: active.account_security_epoch(),
                    issued_at: active.issued_at(),
                    maximum_lease_epoch: active.lease_epoch(),
                    last_active_lease_epoch: Some(active.lease_epoch()),
                    standby_lease_epoch_floor: None,
                    commercial: Some(CommercialAuthorizationFloor {
                        revision: active.entitlement_revision(),
                        digest: active.entitlement_projection_digest().to_owned(),
                        expires_at: active.commercial_expires_at().to_owned(),
                        capabilities: active.capabilities().to_owned(),
                    }),
                },
                VerifiedWorkspaceRole::Standby(standby) => WorkspaceAuthorizationFloor {
                    schema_version: 3,
                    installation_binding,
                    account_id: standby.account_id.clone(),
                    workspace_id: standby.workspace_id.clone(),
                    device_id: standby.device_id.clone(),
                    account_security_epoch: standby.account_security_epoch,
                    issued_at: standby.issued_at,
                    maximum_lease_epoch: standby.lease_epoch_floor,
                    last_active_lease_epoch: None,
                    standby_lease_epoch_floor: Some(standby.lease_epoch_floor),
                    commercial: None,
                },
            };
            let advanced = candidate.advance(old.as_ref())?;
            custody.store_authorization_floor(&advanced)
        })();
        if floor_result.is_err() {
            return Err(self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            ));
        }
        let verified_authority = match verified_role {
            VerifiedWorkspaceRole::Active(active) => active,
            VerifiedWorkspaceRole::Standby(standby) => {
                // Durable continuation authority cannot resurrect the superseded Active Lease.
                if let (Some(manager), Some(continuation)) =
                    (&authority.continuity, &authority.verified_continuation)
                    && manager
                        .barrier_continuation(continuation, BarrierReason::Security)
                        .is_err()
                {
                    return Err(self.abort_transition(
                        &mut authority,
                        &mut runtime,
                        &mut operation,
                        requested,
                        DesktopLocalHostError::StorageRejected,
                    ));
                }
                if runtime.is_none() {
                    match custody.open_existing_workspace(&standby.workspace_id) {
                        Ok(Some(database)) => {
                            *runtime = Some(DesktopRuntimeState {
                                business: DesktopBusinessRuntime::new(database),
                                sync: None,
                            });
                        }
                        Ok(None) => {}
                        Err(_) => {
                            return Err(self.abort_transition(
                                &mut authority,
                                &mut runtime,
                                &mut operation,
                                requested,
                                DesktopLocalHostError::StorageRejected,
                            ));
                        }
                    }
                }
                if let Some(runtime) = runtime.as_mut() {
                    runtime.sync = None;
                }
                authority.authority = Some(PrivateWorkspaceAuthority::from_standby(
                    &standby, requested, now,
                ));
                authority.verified_continuation = None;
                authority.applied_authority_epoch = requested;
                authority.restriction = RuntimeRestriction::Standby;
                clear_operation_state(&mut operation);
                return Ok(());
            }
        };
        let mut database = custody
            .open_workspace(verified_authority.workspace_id())
            .map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::StorageRejected,
                )
            })?;
        let replacement = PrivateWorkspaceAuthority::from_verified(&verified_authority, requested);
        let sync_runtime = DesktopSyncRuntime::new(
            verified_authority.workspace_id().to_owned(),
            verified_authority.device_id().to_owned(),
            verified_authority.lease_epoch(),
            verified_authority.trusted_time_floor(),
            verified_authority.execute_before(),
            verified_authority.snapshot_digest_hex(),
            requested,
            verified_authority.capabilities().to_owned(),
        )
        .map_err(|_| {
            self.abort_transition(
                &mut authority,
                &mut runtime,
                &mut operation,
                requested,
                DesktopLocalHostError::AuthorityRejected,
            )
        })?;
        database
            .recover_cloudflare_credential_orphans_guarded(&format_timestamp(now), || Ok(()))
            .map_err(|_| {
                self.abort_transition(
                    &mut authority,
                    &mut runtime,
                    &mut operation,
                    requested,
                    DesktopLocalHostError::StorageRejected,
                )
            })?;
        *runtime = Some(DesktopRuntimeState {
            business: DesktopBusinessRuntime::new(database),
            sync: Some(sync_runtime),
        });
        authority.authority = Some(replacement);
        authority.applied_authority_epoch = requested;
        authority.restriction = RuntimeRestriction::Active;
        clear_operation_state(&mut operation);
        Ok(())
    }

    /// Permanently closes the current runtime under a durable security barrier.
    ///
    /// # Errors
    ///
    /// Returns a closed storage or authority error when the transition cannot be fenced.
    pub fn enter_security_lock(&self) -> Result<(), DesktopLocalHostError> {
        self.publish_restriction(RuntimeRestriction::SecurityLocked)
    }

    /// Temporarily closes the current runtime under a durable retryable barrier.
    ///
    /// # Errors
    ///
    /// Returns a closed storage or authority error when the transition cannot be fenced.
    pub fn enter_retryable_lock(&self) -> Result<(), DesktopLocalHostError> {
        self.publish_restriction(RuntimeRestriction::RetryableLocked)
    }

    /// Restricts a current verified continuation to local commercial read-only access.
    ///
    /// # Errors
    ///
    /// Returns a closed storage or authority error when current continuation evidence is absent
    /// or the transition cannot be fenced.
    pub fn enter_commercial_read_only(&self) -> Result<(), DesktopLocalHostError> {
        self.publish_restriction(RuntimeRestriction::CommercialReadOnly)
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the restriction transition keeps its durable barrier and lock fence together"
    )]
    fn publish_restriction(
        &self,
        restriction: RuntimeRestriction,
    ) -> Result<(), DesktopLocalHostError> {
        let requested = self
            .transition_requested_epoch
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value
                    .checked_add(1)
                    .filter(|next| *next <= MAX_SAFE_INTEGER)
            })
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?
            .checked_add(1)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        let mut operation = self
            .operation_selection
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        match restriction {
            RuntimeRestriction::CommercialReadOnly => {
                let now = current_unix_seconds().map_err(|_| {
                    self.abort_transition(
                        &mut authority,
                        &mut runtime,
                        &mut operation,
                        requested,
                        DesktopLocalHostError::AuthorityRejected,
                    )
                })?;
                let continuation_is_current = matches!(
                    (
                        authority.continuity.as_ref(),
                        authority.verified_continuation.as_ref(),
                    ),
                    (Some(_), Some(continuation)) if continuation.is_current_at(now)
                );
                let active_authority_is_current =
                    authority.authority.as_ref().is_some_and(|current| {
                        current.kind == WorkspaceAuthorityKind::Active && current.is_current_at(now)
                    });
                if !continuation_is_current || !active_authority_is_current || runtime.is_none() {
                    return Err(self.abort_transition(
                        &mut authority,
                        &mut runtime,
                        &mut operation,
                        requested,
                        DesktopLocalHostError::AuthorityRejected,
                    ));
                }
                authority
                    .authority
                    .as_mut()
                    .expect("authority presence was checked above")
                    .kind = WorkspaceAuthorityKind::VerifiedLocalContinuation;
            }
            RuntimeRestriction::RetryableLocked | RuntimeRestriction::SecurityLocked => {
                let barrier_persisted = match (
                    authority.continuity.as_ref(),
                    authority.verified_continuation.as_ref(),
                ) {
                    (Some(manager), Some(continuation)) => {
                        let reason = if restriction == RuntimeRestriction::RetryableLocked {
                            BarrierReason::Retryable
                        } else {
                            BarrierReason::Security
                        };
                        manager.barrier_continuation(continuation, reason).is_ok()
                    }
                    (None, None) => true,
                    _ => false,
                };
                if !barrier_persisted {
                    authority.authority = None;
                    authority.verified_continuation = None;
                    authority.applied_authority_epoch = requested;
                    authority.restriction = RuntimeRestriction::SecurityLocked;
                    *runtime = None;
                    clear_operation_state(&mut operation);
                    return Err(DesktopLocalHostError::StorageRejected);
                }
                authority.authority = None;
                authority.verified_continuation = None;
                *runtime = None;
            }
            RuntimeRestriction::ActivationRequired
            | RuntimeRestriction::Active
            | RuntimeRestriction::Standby => {
                return Err(DesktopLocalHostError::AuthorityRejected);
            }
        }
        authority.applied_authority_epoch = requested;
        authority.restriction = restriction;
        operation.selected_handle = None;
        operation.selected_artifact = None;
        operation.selected_authority_generation = None;
        operation.selected_authority_digest = None;
        operation.export_operation_id = None;
        operation.selection_operation_id = None;
        operation.export_consumed = true;
        operation.selection_consumed = true;
        Ok(())
    }

    #[expect(
        clippy::unused_self,
        reason = "keeping this as a Host method makes the transition failure boundary explicit at call sites"
    )]
    fn abort_transition(
        &self,
        authority: &mut WorkspaceAuthorityState,
        runtime: &mut std::sync::MutexGuard<'_, Option<DesktopRuntimeState>>,
        operation: &mut HostOperationState,
        requested: u64,
        original_error: DesktopLocalHostError,
    ) -> DesktopLocalHostError {
        // A previously committed continuation is durable authority evidence.  Persist its
        // Security barrier before clearing runtime state so a restart cannot revive it.  The
        // unqualified production composition is exactly `(None, None)` and remains independent
        // of continuity availability; any half-composed pair is an integrity failure.
        let barrier_persisted = match (
            authority.continuity.as_ref(),
            authority.verified_continuation.as_ref(),
        ) {
            (Some(manager), Some(continuation)) => manager
                .barrier_continuation(continuation, BarrierReason::Security)
                .is_ok(),
            (None, None) => true,
            _ => false,
        };
        authority.authority = None;
        authority.verified_continuation = None;
        authority.restriction = RuntimeRestriction::SecurityLocked;
        authority.applied_authority_epoch = requested;
        **runtime = None;
        clear_operation_state(operation);
        if barrier_persisted {
            original_error
        } else {
            DesktopLocalHostError::StorageRejected
        }
    }

    #[must_use]
    pub fn business_status(&self) -> DesktopLocalBusinessStatus {
        let snapshot = self.status_snapshot();
        match snapshot.business {
            DesktopLocalBusinessState::StandbyAwaitingReplica
            | DesktopLocalBusinessState::ActivationRequired
            | DesktopLocalBusinessState::SecurityLocked
            | DesktopLocalBusinessState::RetryableLocked => {
                closed_business_status(snapshot.business, snapshot.read_generation)
            }
            DesktopLocalBusinessState::StandbyReadOnly => DesktopLocalBusinessStatus {
                schema_version: 2,
                state: DesktopLocalBusinessState::StandbyReadOnly,
                capabilities: vec!["local:read"],
                read_generation: snapshot.read_generation,
            },
            DesktopLocalBusinessState::CommercialReadOnly => DesktopLocalBusinessStatus {
                schema_version: 2,
                state: DesktopLocalBusinessState::CommercialReadOnly,
                capabilities: vec!["local:read"],
                read_generation: snapshot.read_generation,
            },
            DesktopLocalBusinessState::Active => DesktopLocalBusinessStatus {
                schema_version: 2,
                state: DesktopLocalBusinessState::Active,
                capabilities: vec!["local:read", "workspace:mutate"],
                read_generation: snapshot.read_generation,
            },
        }
    }

    /// A counter that differs whenever the Cloudflare connection rows may have been replaced
    /// since it was last read. Callers stamp a Provider outcome with it before the operation
    /// starts and show the outcome only while it is unchanged, so an outcome about a replaced
    /// connection is never shown beside the new one, and one from an operation that ran beside a
    /// create or restore does not survive it either.
    #[must_use]
    pub fn provider_connection_generation(&self) -> u64 {
        self.provider_connection_generation.load(Ordering::Acquire)
    }

    /// Who the current authority is: account, workspace, device, lease epoch and account security
    /// epoch. Callers stamp results with it so a result produced under one authority is never
    /// presented under another.
    ///
    /// It deliberately leaves out the applied authority epoch, which also advances on every
    /// access-token refresh, and the runtime restriction: a refresh or a read-only round trip
    /// under the same account, workspace, device, lease and security epoch is the same authority.
    /// `None` without a current authority or when the publication lock is poisoned.
    #[must_use]
    pub fn authority_identity(&self) -> Option<DesktopAuthorityIdentity> {
        let authority = self.authority_publication.lock().ok()?;
        authority
            .authority
            .as_ref()
            .map(|current| DesktopAuthorityIdentity {
                account_id: current.account_id.clone(),
                workspace_id: current.workspace_id.clone(),
                device_id: current.device_id.clone(),
                lease_epoch: current.lease_epoch,
                account_security_epoch: current.account_security_epoch,
            })
    }

    /// The current Active device and lease epoch.
    ///
    /// # Errors
    ///
    /// Returns `Unavailable` unless the business state is Active under a current authority read
    /// in the same lock order as [`Self::business_status`].
    pub fn device_lease(&self) -> Result<DesktopDeviceLease, DesktopLocalHostError> {
        let Ok(_operation) = self.operation_selection.lock() else {
            return Err(DesktopLocalHostError::Unavailable);
        };
        let Ok(authority) = self.authority_publication.lock() else {
            return Err(DesktopLocalHostError::Unavailable);
        };
        let Ok(runtime) = self.runtime_state.lock() else {
            return Err(DesktopLocalHostError::Unavailable);
        };
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::Unavailable)?;
        if runtime.is_none()
            || self.transition_requested_epoch.load(Ordering::Acquire)
                != authority.applied_authority_epoch
            || authority.restriction != RuntimeRestriction::Active
        {
            return Err(DesktopLocalHostError::Unavailable);
        }
        authority
            .authority
            .as_ref()
            .filter(|current| {
                current.kind == WorkspaceAuthorityKind::Active && current.is_current_at(now)
            })
            .map(|current| DesktopDeviceLease {
                schema_version: 1,
                device_id: current.device_id.clone(),
                lease_epoch: current.lease_epoch,
            })
            .ok_or(DesktopLocalHostError::Unavailable)
    }

    fn status_snapshot(&self) -> DesktopStatusSnapshot {
        // Status is itself an authorization boundary. Use the same aggregate lock prefix as
        // operations so a renderer can never observe a restriction independently of a pending
        // transition, its authority deadline, or the writer it purports to authorize.
        let Ok(_operation) = self.operation_selection.lock() else {
            return DesktopStatusSnapshot::security_locked(0);
        };
        let Ok(authority) = self.authority_publication.lock() else {
            return DesktopStatusSnapshot::security_locked(0);
        };
        let Ok(runtime) = self.runtime_state.lock() else {
            return DesktopStatusSnapshot::security_locked(0);
        };
        let read_generation = runtime
            .as_ref()
            .map_or(0, |value| value.business.read_generation());
        let requested_epoch = self.transition_requested_epoch.load(Ordering::Acquire);
        if requested_epoch != authority.applied_authority_epoch {
            return DesktopStatusSnapshot::security_locked(read_generation);
        }
        let Ok(now) = current_unix_seconds() else {
            return DesktopStatusSnapshot::security_locked(read_generation);
        };

        match authority.restriction {
            RuntimeRestriction::ActivationRequired => DesktopStatusSnapshot {
                authorization: DesktopHostAuthorizationStatus::ActivationRequired,
                business: DesktopLocalBusinessState::ActivationRequired,
                read_generation,
            },
            RuntimeRestriction::RetryableLocked => DesktopStatusSnapshot {
                authorization: DesktopHostAuthorizationStatus::RetryableLocked,
                business: DesktopLocalBusinessState::RetryableLocked,
                read_generation,
            },
            RuntimeRestriction::SecurityLocked => {
                DesktopStatusSnapshot::security_locked(read_generation)
            }
            RuntimeRestriction::Standby => {
                if authority.authority.as_ref().is_some_and(|current| {
                    current.kind == WorkspaceAuthorityKind::Standby && current.is_current_at(now)
                }) {
                    DesktopStatusSnapshot {
                        authorization: DesktopHostAuthorizationStatus::Standby,
                        business: if runtime.is_some() {
                            DesktopLocalBusinessState::StandbyReadOnly
                        } else {
                            DesktopLocalBusinessState::StandbyAwaitingReplica
                        },
                        read_generation,
                    }
                } else {
                    DesktopStatusSnapshot::security_locked(read_generation)
                }
            }
            RuntimeRestriction::Active => {
                let valid = runtime.is_some()
                    && authority.authority.as_ref().is_some_and(|current| {
                        current.kind == WorkspaceAuthorityKind::Active && current.is_current_at(now)
                    });
                if valid {
                    DesktopStatusSnapshot {
                        authorization: DesktopHostAuthorizationStatus::Authorized,
                        business: DesktopLocalBusinessState::Active,
                        read_generation,
                    }
                } else {
                    DesktopStatusSnapshot::security_locked(read_generation)
                }
            }
            RuntimeRestriction::CommercialReadOnly => {
                let valid = runtime.is_some()
                    && authority.continuity.is_some()
                    && authority
                        .verified_continuation
                        .as_ref()
                        .is_some_and(|continuation| continuation.is_current_at(now))
                    && authority.authority.as_ref().is_some_and(|current| {
                        current.kind == WorkspaceAuthorityKind::VerifiedLocalContinuation
                            && current.is_current_at(now)
                    });
                if valid {
                    DesktopStatusSnapshot {
                        authorization: DesktopHostAuthorizationStatus::Continuation,
                        business: DesktopLocalBusinessState::CommercialReadOnly,
                        read_generation,
                    }
                } else {
                    DesktopStatusSnapshot::security_locked(read_generation)
                }
            }
        }
    }
}
