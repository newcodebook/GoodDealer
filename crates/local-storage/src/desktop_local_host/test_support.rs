use super::*;

impl DesktopLocalHost {
    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the development fixture composes one complete and reviewable authority state"
    )]
    pub(crate) fn development(
        database: BusinessDatabase,
        native_root: std::path::PathBuf,
        account_id: &str,
        workspace_id: &str,
        device_id: &str,
    ) -> Result<Self, DesktopBackupError> {
        let generation: u64 = 1;
        let now = current_unix_seconds()?;
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/BACKUP-AUTHORITY-TEST-V1\0");
        for value in [account_id, workspace_id, device_id] {
            digest.update(value.len().to_be_bytes());
            digest.update(value.as_bytes());
        }
        digest.update(generation.to_be_bytes());
        let authority = PrivateWorkspaceAuthority {
            kind: WorkspaceAuthorityKind::Active,
            account_id: account_id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            device_id: device_id.to_owned(),
            lease_epoch: 1,
            account_security_epoch: 1,
            entitlement_revision: 1,
            entitlement_projection_digest: "11".repeat(32),
            commercial_expires_at: "9999-12-31T23:59:59Z".to_owned(),
            capability: "cloudflare:dns:observe".to_owned(),
            generation,
            trusted_time_floor: now,
            execute_before: i64::MAX,
            digest: digest.finalize().into(),
        };
        let installation_digest = digest_component(
            b"GOODDEALER/DEVELOPMENT-INSTALLATION-V1\0",
            &[account_id.as_bytes(), device_id.as_bytes()].concat(),
        );
        let account_digest =
            digest_component(b"GOODDEALER/BACKUP-ACCOUNT-V1\0", account_id.as_bytes());
        let workspace_digest =
            digest_component(b"GOODDEALER/BACKUP-WORKSPACE-V1\0", workspace_id.as_bytes());
        let device_digest =
            digest_component(b"GOODDEALER/BACKUP-DEVICE-V1\0", device_id.as_bytes());
        // The qualified development fixture models a stable SQLCipher lineage. Production does
        // not use this derivation and remains closed until real lineage plus a qualified monotonic
        // anchor are composed from custody.
        let database_lineage_digest = digest_component(
            b"GOODDEALER/DEVELOPMENT-DATABASE-LINEAGE-V1\0",
            workspace_id.as_bytes(),
        );
        let continuity_binding = ContinuityBinding {
            installation_digest,
            account_digest,
            workspace_digest,
            device_digest,
            minimum_account_security_epoch: authority.account_security_epoch,
            minimum_lease_epoch: authority.lease_epoch,
            minimum_entitlement_revision: authority.entitlement_revision,
            database_lineage_digest,
            database_publication_generation: 1,
        };
        let continuity_receipt = ContinuityReceiptV1 {
            sequence: generation,
            state: ReceiptState::Continuation,
            installation_digest,
            account_digest,
            workspace_digest,
            device_digest,
            account_security_epoch: authority.account_security_epoch,
            lease_epoch: authority.lease_epoch,
            entitlement_revision: authority.entitlement_revision,
            entitlement_projection_digest: [0x11; 32],
            commercial_expires_at: i64::MAX,
            trusted_time_floor: now,
            execute_before: i64::MAX,
            authority_generation: generation,
            database_lineage_digest,
            database_publication_generation: 1,
        };
        let continuity = ContinuityManager::development_for_test();
        let pending = continuity
            .begin_verified_replacement(continuity_receipt, &continuity_binding, now)
            .map_err(|_| DesktopBackupError::AuthorityRejected)?;
        let _committed = continuity
            .commit_receipt(pending)
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let startup = continuity
            .load_startup(&continuity_binding, now, true, true)
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        if startup.decision != StartupContinuity::VerifiedLocalContinuation {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let verified_continuation = startup
            .continuation
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        let container = BackupContainerHost::ephemeral_for_test(authority.binding())
            .map_err(map_container_error)?;
        let sync = DesktopSyncRuntime::new(
            authority.workspace_id.clone(),
            authority.device_id.clone(),
            authority.lease_epoch,
            authority.trusted_time_floor,
            authority.execute_before,
            hex_digest(&authority.digest),
            generation,
        )
        .map_err(|_| DesktopBackupError::AuthorityRejected)?;
        Ok(Self {
            application_root: None,
            production_custody: None,
            authority_verifier: None,
            transition_requested_epoch: AtomicU64::new(generation),
            provider_connection_generation: AtomicU64::new(0),
            operation_selection: Mutex::new(HostOperationState::default()),
            authority_publication: Mutex::new(WorkspaceAuthorityState {
                authority: Some(authority),
                backup: BackupArtifactState {
                    native: NativeBackupComposition::Development(DevelopmentNativeBackup::new(
                        native_root,
                    )?),
                    container: Some(container),
                },
                applied_authority_epoch: generation,
                restriction: RuntimeRestriction::Active,
                continuity: Some(continuity),
                verified_continuation: Some(verified_continuation),
            }),
            runtime_state: Mutex::new(Some(DesktopRuntimeState {
                business: DesktopBusinessRuntime::new(database),
                sync: Some(sync),
            })),
            rebootstrap_runtime: None,
            rebootstrap_quarantine_custody: None,
            rebootstrap_test_executor_enabled: false,
            development_installation_binding: Some(installation_digest),
            business_commit_transition_epoch: AtomicU64::new(0),
            restore_precommit_transition_epoch: AtomicU64::new(0),
            restore_postcommit_transition_epoch: AtomicU64::new(0),
        })
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn development_with_rebootstrap_custody(
        root: &DesktopApplicationRoot,
        native_root: std::path::PathBuf,
        account_id: &str,
        workspace_id: &str,
        device_id: &str,
        enable_test_create_only_backend: bool,
    ) -> Result<Self, DesktopBackupError> {
        Self::development_with_rebootstrap_custody_and_store(
            root,
            native_root,
            account_id,
            workspace_id,
            device_id,
            enable_test_create_only_backend,
            TestRebootstrapKeyStore::default(),
        )
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn development_with_rebootstrap_custody_and_store(
        root: &DesktopApplicationRoot,
        native_root: std::path::PathBuf,
        account_id: &str,
        workspace_id: &str,
        device_id: &str,
        enable_test_create_only_backend: bool,
        test_store: TestRebootstrapKeyStore,
    ) -> Result<Self, DesktopBackupError> {
        let custody = if enable_test_create_only_backend {
            DesktopProductionCustody::load_or_create_for_rebootstrap_test_with_store(
                root, test_store,
            )
        } else {
            DesktopProductionCustody::load_or_create(root)
        }
        .map_err(|_| DesktopBackupError::StorageRejected)?;
        let database = custody
            .open_workspace(workspace_id)
            .map_err(map_database_error)?;
        let journal = custody
            .rebootstrap_journal_store()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let mut host =
            Self::development(database, native_root, account_id, workspace_id, device_id)?;
        host.production_custody = Some(Mutex::new(custody));
        host.rebootstrap_runtime = Some(if enable_test_create_only_backend {
            RebootstrapRuntime::for_test_recovery(journal)
        } else {
            RebootstrapRuntime::new(journal)
        });
        host.rebootstrap_test_executor_enabled = enable_test_create_only_backend;
        Ok(host)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    fn restart_host_without_authority_for_test(
        root: DesktopApplicationRoot,
        custody: Option<DesktopProductionCustody>,
        rebootstrap: RebootstrapRuntime,
        quarantine_custody: Option<TestRebootstrapQuarantineCustody>,
    ) -> Self {
        let mut host = Self::production_unavailable();
        host.application_root = Some(root);
        host.production_custody = custody.map(Mutex::new);
        host.rebootstrap_runtime = Some(rebootstrap);
        host.rebootstrap_test_executor_enabled = true;
        if quarantine_custody.is_some() {
            host.authority_publication
                .get_mut()
                .expect("new Host authority mutex is not poisoned")
                .restriction = RuntimeRestriction::SecurityLocked;
        }
        host.rebootstrap_quarantine_custody = quarantine_custody;
        host
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn restart_rebootstrap_for_test(
        root: DesktopApplicationRoot,
        store: TestRebootstrapKeyStore,
        workspace_id: &str,
    ) -> Result<(Self, RebootstrapRestartDisposition), DesktopLocalHostError> {
        Self::restart_rebootstrap_until_for_test(root, store, workspace_id, None)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the restart harness keeps every journal disposition in one exhaustive protocol match"
    )]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the restart harness models transfer of the process-owned test Keychain store"
    )]
    pub(super) fn restart_rebootstrap_until_for_test(
        root: DesktopApplicationRoot,
        store: TestRebootstrapKeyStore,
        workspace_id: &str,
        crash_boundary: Option<TestRebootstrapCrashBoundary>,
    ) -> Result<(Self, RebootstrapRestartDisposition), DesktopLocalHostError> {
        let bootstrap = TestRebootstrapRecoveryCustody::open(&root, store.clone())
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let before_classification = bootstrap
            .state_digest()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let quarantine_custody = bootstrap
            .quarantine_custody()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let journal = bootstrap
            .journal_store()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let rebootstrap = RebootstrapRuntime::for_test_recovery(journal);
        let action = rebootstrap
            .startup_action()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;

        match action {
            StartupRebootstrapAction::Discard(action) => {
                let Ok(classified) = bootstrap.classify_discard(&action, workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let custody = match crash_boundary {
                    Some(boundary) => classified.discard_with_crash_for_test(boundary),
                    None => classified.discard(),
                }
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                rebootstrap
                    .confirm_discarded(action)
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        Some(custody),
                        rebootstrap,
                        None,
                    ),
                    RebootstrapRestartDisposition::CancelledUnpublished,
                ))
            }
            StartupRebootstrapAction::Recover(action) => {
                let Ok(classified) = bootstrap.classify_recovery(&action, workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let disposition = classified.disposition();
                let action = rebootstrap
                    .resolve_recovery(action, disposition)
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                match disposition {
                    RecoveryDisposition::CancelUnpublishedCandidate => {
                        let custody = match crash_boundary {
                            Some(boundary) => {
                                classified.cancel_unpublished_with_crash_for_test(boundary)
                            }
                            None => classified.cancel_unpublished(),
                        }
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        rebootstrap
                            .confirm_recovery_cancelled(action)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        Ok((
                            Self::restart_host_without_authority_for_test(
                                root,
                                Some(custody),
                                rebootstrap,
                                None,
                            ),
                            RebootstrapRestartDisposition::CancelledUnpublished,
                        ))
                    }
                    RecoveryDisposition::ResumeCandidate => {
                        if classified.is_retirement_prefix() {
                            let custody = classified
                                .resume_retirement_prefix()
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            let retire = rebootstrap
                                .confirm_recovery_reopened(action)
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            rebootstrap
                                .confirm_retired(retire)
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            custody
                                .opaque_rebootstrap_state_digest_for_test()
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                            return Ok((
                                Self::restart_host_without_authority_for_test(
                                    root,
                                    Some(custody),
                                    rebootstrap,
                                    None,
                                ),
                                RebootstrapRestartDisposition::ResumedPublished,
                            ));
                        }
                        let verified = classified
                            .verify_post_exchange()
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        assert_eq!(
                            before_classification,
                            verified
                                .state_digest()
                                .map_err(|_| DesktopLocalHostError::StorageRejected)?
                        );
                        let (custody, publication) = verified
                            .admit()
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        let retire = rebootstrap
                            .confirm_recovery_reopened(action)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        custody
                            .retire_rebootstrap_old(publication)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        rebootstrap
                            .confirm_retired(retire)
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        custody
                            .opaque_rebootstrap_state_digest_for_test()
                            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                        Ok((
                            Self::restart_host_without_authority_for_test(
                                root,
                                Some(custody),
                                rebootstrap,
                                None,
                            ),
                            RebootstrapRestartDisposition::ResumedPublished,
                        ))
                    }
                }
            }
            StartupRebootstrapAction::Terminal(action) => {
                let Ok(classified) = bootstrap.classify_terminal(&action, workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let custody = classified
                    .admit()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        Some(custody),
                        rebootstrap,
                        None,
                    ),
                    RebootstrapRestartDisposition::TerminalValidated,
                ))
            }
            StartupRebootstrapAction::None => {
                let Ok(classified) = bootstrap.classify_clean(workspace_id) else {
                    let after_rejection = quarantine_custody
                        .state_digest(&store)
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                    assert_eq!(before_classification, after_rejection);
                    return Ok((
                        Self::restart_host_without_authority_for_test(
                            root,
                            None,
                            rebootstrap,
                            Some(quarantine_custody),
                        ),
                        RebootstrapRestartDisposition::Quarantined,
                    ));
                };
                assert_eq!(
                    before_classification,
                    classified
                        .state_digest()
                        .map_err(|_| DesktopLocalHostError::StorageRejected)?
                );
                let custody = classified
                    .admit()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        Some(custody),
                        rebootstrap,
                        None,
                    ),
                    RebootstrapRestartDisposition::CleanValidated,
                ))
            }
            StartupRebootstrapAction::Quarantined => {
                let after_rejection = quarantine_custody
                    .state_digest(&store)
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                assert_eq!(before_classification, after_rejection);
                Ok((
                    Self::restart_host_without_authority_for_test(
                        root,
                        None,
                        rebootstrap,
                        Some(quarantine_custody),
                    ),
                    RebootstrapRestartDisposition::Quarantined,
                ))
            }
        }
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(crate) fn publish_transition_at_next_business_commit_for_test(
        &self,
    ) -> Result<u64, DesktopLocalHostError> {
        let requested = self
            .transition_requested_epoch
            .load(Ordering::Acquire)
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        self.business_commit_transition_epoch
            .store(requested, Ordering::Release);
        Ok(requested)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn publish_transition_at_restore_precommit_for_test(
        &self,
    ) -> Result<u64, DesktopLocalHostError> {
        self.schedule_restore_transition_for_test(&self.restore_precommit_transition_epoch)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn publish_transition_after_restore_commit_for_test(
        &self,
    ) -> Result<u64, DesktopLocalHostError> {
        self.schedule_restore_transition_for_test(&self.restore_postcommit_transition_epoch)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    fn schedule_restore_transition_for_test(
        &self,
        hook: &AtomicU64,
    ) -> Result<u64, DesktopLocalHostError> {
        let requested = self
            .transition_requested_epoch
            .load(Ordering::Acquire)
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        hook.store(requested, Ordering::Release);
        Ok(requested)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn publish_scheduled_restore_transition_for_test(&self, hook: &AtomicU64) {
        let requested = hook.swap(0, Ordering::AcqRel);
        if requested != 0 {
            self.transition_requested_epoch
                .store(requested, Ordering::Release);
        }
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(crate) fn renew_business_authority_for_test(
        &self,
        lease_epoch: u64,
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
        let _operation = self
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
        let current = authority
            .authority
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?;
        if lease_epoch <= current.lease_epoch || lease_epoch > MAX_SAFE_INTEGER {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let now = current_unix_seconds().map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        current.lease_epoch = lease_epoch;
        current.generation = requested;
        current.trusted_time_floor = now;
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/BACKUP-AUTHORITY-TEST-RENEWAL-V1\0");
        for value in [
            current.account_id.as_bytes(),
            current.workspace_id.as_bytes(),
            current.device_id.as_bytes(),
        ] {
            digest.update(value.len().to_be_bytes());
            digest.update(value);
        }
        digest.update(lease_epoch.to_be_bytes());
        digest.update(requested.to_be_bytes());
        current.digest = digest.finalize().into();
        let sync = DesktopSyncRuntime::new(
            current.workspace_id.clone(),
            current.device_id.clone(),
            current.lease_epoch,
            current.trusted_time_floor,
            current.execute_before,
            hex_digest(&current.digest),
            requested,
        )
        .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        runtime
            .as_mut()
            .ok_or(DesktopLocalHostError::AuthorityRejected)?
            .sync = Some(sync);
        authority.applied_authority_epoch = requested;
        authority.restriction = RuntimeRestriction::Active;
        Ok(())
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn request_security_lock_for_test(&self) -> Result<(), DesktopBackupError> {
        self.enter_security_lock().map_err(|error| match error {
            DesktopLocalHostError::AuthorityRejected => DesktopBackupError::AuthorityRejected,
            DesktopLocalHostError::StorageRejected
            | DesktopLocalHostError::ApplicationRootRejected
            | DesktopLocalHostError::CloudProtocolRejected
            | DesktopLocalHostError::Unavailable
            | DesktopLocalHostError::AssetExists
            | DesktopLocalHostError::AssetDeleted
            | DesktopLocalHostError::AssetReAddBlocked
            | DesktopLocalHostError::AssetReAddPending
            | DesktopLocalHostError::CapabilityUnqualified
            | DesktopLocalHostError::ZoneUnimportable => DesktopBackupError::StorageRejected,
        })
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn continuity_startup_for_test(
        &self,
    ) -> Result<StartupContinuity, DesktopBackupError> {
        let authority = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let Some(manager) = authority.continuity.as_ref() else {
            return Err(DesktopBackupError::StorageRejected);
        };
        let Some(continuation) = authority.verified_continuation.as_ref() else {
            return Err(DesktopBackupError::AuthorityRejected);
        };
        let now = current_unix_seconds()?;
        manager
            .load_startup(&continuation.binding(), now, true, true)
            .map(|load| load.decision)
            .map_err(|_| DesktopBackupError::StorageRejected)
    }
}
