use super::DesktopLocalHost;
#[cfg(any(not(test), unix))]
use super::DesktopLocalHostError;
#[cfg(all(test, unix))]
use super::{
    BusinessDatabaseError, DesktopBusinessRuntime, DesktopRuntimeState, DesktopSyncRuntime,
    Ordering, RebootstrapCheckpoint, RebootstrapCrashBoundary, RebootstrapPlan, RuntimeRestriction,
    TestRebootstrapCrashBoundary, current_unix_seconds, hex_digest, rebootstrap_binding_digest,
    rebootstrap_floor_digest,
};

impl DesktopLocalHost {
    /// Applies one bounded Cloud rebootstrap plan inside the sole Local Host writer boundary.
    /// Neither the staged path nor either `SQLCipher` key is nameable by the caller.
    #[cfg(not(test))]
    #[expect(
        dead_code,
        reason = "the production sync coordinator will call this fail-closed Host seam"
    )]
    #[expect(
        clippy::unused_self,
        reason = "the method shape fixes rebootstrap at the Host authority boundary"
    )]
    pub(crate) fn apply_rebootstrap_plan(
        &self,
        _checkpoint_wire: &[u8],
        _plan_wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        // Production has no qualified create-only native rebootstrap capability. Deny at the
        // aggregate boundary before parsing untrusted wire or acquiring any runtime/custody lock.
        Err(DesktopLocalHostError::Unavailable)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(crate) fn apply_rebootstrap_plan(
        &self,
        checkpoint_wire: &[u8],
        plan_wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        if !self.rebootstrap_test_executor_enabled {
            return Err(DesktopLocalHostError::Unavailable);
        }
        self.apply_rebootstrap_plan_inner(
            checkpoint_wire,
            plan_wire,
            RebootstrapCrashBoundary::Completed,
        )
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    pub(super) fn apply_rebootstrap_plan_until_for_test(
        &self,
        checkpoint_wire: &[u8],
        plan_wire: &[u8],
        stop_after: RebootstrapCrashBoundary,
    ) -> Result<(), DesktopLocalHostError> {
        self.apply_rebootstrap_plan_inner(checkpoint_wire, plan_wire, stop_after)
    }

    #[cfg_attr(not(unix), cfg(any()))]
    #[cfg(test)]
    #[expect(
        clippy::too_many_lines,
        reason = "the test executor keeps the complete crash-boundary protocol visible in one linear harness"
    )]
    fn apply_rebootstrap_plan_inner(
        &self,
        checkpoint_wire: &[u8],
        plan_wire: &[u8],
        stop_after: RebootstrapCrashBoundary,
    ) -> Result<(), DesktopLocalHostError> {
        let checkpoint = RebootstrapCheckpoint::parse(checkpoint_wire)
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
        let plan = RebootstrapPlan::parse(&checkpoint, plan_wire)
            .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
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
        if authority.restriction != RuntimeRestriction::Active
            || self.transition_requested_epoch.load(Ordering::Acquire) != captured_epoch
            || !current.is_current_at(now)
            || current.workspace_id != plan.workspace_id()
        {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let mut runtime = runtime;
        let custody = self
            .production_custody
            .as_ref()
            .ok_or(DesktopLocalHostError::Unavailable)?
            .lock()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;

        // This gate is intentionally before runtime admission/allocation, journal creation,
        // slot access, candidate creation, alias repair, or database mutation. The current
        // production composition has no qualified create-only Keychain primitive and therefore
        // returns Unavailable here while ordinary local business operation remains unaffected.
        custody
            .require_rebootstrap_reservation_capability()
            .map_err(|error| match error {
                crate::desktop_custody::DesktopCustodyError::Unavailable => {
                    DesktopLocalHostError::Unavailable
                }
                crate::desktop_custody::DesktopCustodyError::Rejected
                | crate::desktop_custody::DesktopCustodyError::RandomUnavailable
                | crate::desktop_custody::DesktopCustodyError::StorageRejected => {
                    DesktopLocalHostError::StorageRejected
                }
            })?;
        {
            let rebootstrap = self
                .rebootstrap_runtime
                .as_ref()
                .ok_or(DesktopLocalHostError::Unavailable)?;
            let state = runtime
                .as_mut()
                .ok_or(DesktopLocalHostError::AuthorityRejected)?;

            let binding_digest = rebootstrap_binding_digest(current);
            let authority_digest = hex_digest(&current.digest);
            let floor_digest = rebootstrap_floor_digest(current);
            rebootstrap
                .apply_verified_authority(binding_digest, authority_digest, floor_digest)
                .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
            let admission = rebootstrap
                .begin()
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let reservation = rebootstrap
                .allocate(admission, plan)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let (candidate_reservation, prepared_evidence) = custody
                .reserve_rebootstrap(&reservation, state.business.database_for_backup_mut())
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::ReservationCreated {
                return Ok(());
            }
            let prepared = rebootstrap
                .prepare(reservation, &prepared_evidence)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::Prepared {
                return Ok(());
            }
            let (snapshot, tombstones, checkpoint_revision, replay_pages) =
                prepared.plan().installation_input();
            let (candidate, candidate_reserved_evidence) = custody
                .materialize_candidate(
                    candidate_reservation,
                    state.business.database_for_backup_mut(),
                )
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::CandidateCreated {
                return Ok(());
            }
            let Ok(reserved) =
                rebootstrap.confirm_candidate_reserved(prepared, &candidate_reserved_evidence)
            else {
                let _ = custody.discard_rebootstrap_candidate_handle(candidate);
                return Err(DesktopLocalHostError::StorageRejected);
            };
            if stop_after == RebootstrapCrashBoundary::CandidateReserved {
                return Ok(());
            }
            let mut proof_out = None;
            let mut journal_link_out = None;
            let device_id = current.device_id.clone();
            let install = custody.with_rebootstrap_candidate(
                &candidate,
                current.workspace_id.as_str(),
                |database| {
                    database
                        .install_rebootstrap_plan_with_generations_guarded(
                            &snapshot,
                            &tombstones,
                            checkpoint_revision,
                            &device_id,
                            &replay_pages,
                            |proof| {
                                let link = rebootstrap
                                    .candidate_journal_link(&reserved, proof)
                                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                                proof_out = Some(proof.clone());
                                journal_link_out = Some(link.clone());
                                Ok(link)
                            },
                            || self.require_business_commit_fence(captured_epoch, current),
                        )
                        .map(|_| ())
                },
            );
            let Ok(((), candidate_final)) = install else {
                if custody
                    .discard_rebootstrap_candidate_handle(candidate)
                    .is_ok()
                {
                    let _ = rebootstrap.cancel_candidate_reserved(reserved);
                }
                return Err(DesktopLocalHostError::StorageRejected);
            };
            let proof = proof_out.ok_or(DesktopLocalHostError::StorageRejected)?;
            let journal_link = journal_link_out.ok_or(DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::CandidateMutated {
                return Ok(());
            }

            // Publication owns the only writer. Remove the old runtime before custody closes and
            // evidences the old database; no SQLite connection survives PublishIntent/EXCHANGE.
            let old_state = runtime
                .take()
                .ok_or(DesktopLocalHostError::AuthorityRejected)?;
            let DesktopRuntimeState { business, sync } = old_state;
            drop(sync);
            let old_database = business.into_database();
            let verified_candidate = custody
                .verify_candidate(
                    candidate,
                    candidate_final,
                    old_database,
                    &proof,
                    &journal_link,
                )
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let verified = rebootstrap
                .verify_candidate(reserved, &proof, verified_candidate.evidence())
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::Verified {
                return Ok(());
            }
            let publish = rebootstrap
                .publish_intent(verified)
                .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
            if stop_after == RebootstrapCrashBoundary::PublishIntentPreExchange {
                return Ok(());
            }
            if matches!(
                stop_after,
                RebootstrapCrashBoundary::ExchangeBeforeDirectoryFsync
                    | RebootstrapCrashBoundary::AliasRepairBeforePublished
            ) {
                let custody_boundary = match stop_after {
                    RebootstrapCrashBoundary::ExchangeBeforeDirectoryFsync => {
                        TestRebootstrapCrashBoundary::AfterExchangeBeforeDirectoryFsync
                    }
                    RebootstrapCrashBoundary::AliasRepairBeforePublished => {
                        TestRebootstrapCrashBoundary::AfterAliasRepairBeforePublished
                    }
                    _ => unreachable!("matched crash boundary"),
                };
                return match custody.publish_with_crash_for_test(
                    verified_candidate,
                    &publish,
                    custody_boundary,
                ) {
                    Err(_) => Ok(()),
                    Ok(_) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            let publication = custody
                .publish(verified_candidate, &publish)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::PublishIntentPostExchange {
                return Ok(());
            }
            let publish = rebootstrap
                .confirm_published(publish)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::Published {
                return Ok(());
            }
            if stop_after == RebootstrapCrashBoundary::ReopenProofFailure {
                let before = custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                let result = custody.reopen_published_with_crash_for_test(
                    &publication,
                    current.workspace_id.as_str(),
                    publish.journal_link(),
                    TestRebootstrapCrashBoundary::ReopenProofFailure,
                );
                let after = custody
                    .opaque_rebootstrap_state_digest_for_test()
                    .map_err(|_| DesktopLocalHostError::StorageRejected)?;
                assert_eq!(before, after);
                return match result {
                    Err(_) => Ok(()),
                    Ok(()) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            custody
                .verify_published_read_only(
                    &publication,
                    current.workspace_id.as_str(),
                    publish.journal_link(),
                )
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::ReopenedBeforeConfirmation {
                return Ok(());
            }
            let retire = rebootstrap
                .confirm_reopened(publish)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::ReopenedVerified {
                return Ok(());
            }
            if matches!(
                stop_after,
                RebootstrapCrashBoundary::OldFileUnlinked
                    | RebootstrapCrashBoundary::OldSlotDeleted
            ) {
                let custody_boundary = match stop_after {
                    RebootstrapCrashBoundary::OldFileUnlinked => {
                        TestRebootstrapCrashBoundary::AfterOldFileUnlinkAndDirectoryFsync
                    }
                    RebootstrapCrashBoundary::OldSlotDeleted => {
                        TestRebootstrapCrashBoundary::AfterOldSlotDeleteAndAbsentReadback
                    }
                    _ => unreachable!("matched retirement boundary"),
                };
                return match custody
                    .retire_rebootstrap_old_with_crash_for_test(publication, custody_boundary)
                {
                    Err(_) => Ok(()),
                    Ok(()) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            custody
                .retire_rebootstrap_old(publication)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::RetiredOldJournalAppendFailure {
                return match rebootstrap.confirm_retired_with_crash_for_test(retire) {
                    Err(_) => Ok(()),
                    Ok(_) => Err(DesktopLocalHostError::StorageRejected),
                };
            }
            rebootstrap
                .confirm_retired(retire)
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            if stop_after == RebootstrapCrashBoundary::RetiredOld {
                return Ok(());
            }
            let database = custody
                .open_workspace(current.workspace_id.as_str())
                .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            let sync = DesktopSyncRuntime::new(
                current.workspace_id.clone(),
                current.device_id.clone(),
                current.lease_epoch,
                current.trusted_time_floor,
                current.execute_before,
                hex_digest(&current.digest),
                current.generation,
                current.capabilities.clone(),
            )
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
            *runtime = Some(DesktopRuntimeState {
                business: DesktopBusinessRuntime::new(database),
                sync: Some(sync),
            });
            Ok(())
        }
    }
}
