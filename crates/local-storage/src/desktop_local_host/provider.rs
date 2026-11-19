use super::{
    BusinessDatabaseError, ConnectionGenerationAdvance, DesktopLocalHost, DesktopLocalHostError,
    DesktopSyncError, DesktopSyncRunAdmission, current_unix_seconds, format_timestamp,
};

fn recovery_observation(
    plan: &crate::DesktopCloudflareKeychainPlanData,
    comparison: crate::DesktopCloudflareCustodyComparison,
) -> crate::CloudflareCredentialRecoveryObservation {
    match comparison {
        crate::DesktopCloudflareCustodyComparison::ExactTarget => {
            crate::CloudflareCredentialRecoveryObservation::Canonical(plan.target.clone())
        }
        crate::DesktopCloudflareCustodyComparison::ExactBase => {
            if plan.expected_base.kind == crate::CloudflareCredentialEnvelopeKind::Absent {
                crate::CloudflareCredentialRecoveryObservation::Missing
            } else {
                crate::CloudflareCredentialRecoveryObservation::Canonical(
                    plan.expected_base.clone(),
                )
            }
        }
        crate::DesktopCloudflareCustodyComparison::MissingOther => {
            crate::CloudflareCredentialRecoveryObservation::Missing
        }
        crate::DesktopCloudflareCustodyComparison::OtherCanonical
        | crate::DesktopCloudflareCustodyComparison::Malformed => {
            crate::CloudflareCredentialRecoveryObservation::Malformed
        }
        crate::DesktopCloudflareCustodyComparison::Unavailable => {
            crate::CloudflareCredentialRecoveryObservation::Unreadable
        }
    }
}

const fn prewrite_failure_reason(
    reason: crate::DesktopCloudflarePrewriteFailure,
) -> crate::CloudflarePrewriteFailureReason {
    match reason {
        crate::DesktopCloudflarePrewriteFailure::BaseMismatch => {
            crate::CloudflarePrewriteFailureReason::BaseMismatch
        }
        crate::DesktopCloudflarePrewriteFailure::MissingOther => {
            crate::CloudflarePrewriteFailureReason::MissingOther
        }
        crate::DesktopCloudflarePrewriteFailure::Malformed => {
            crate::CloudflarePrewriteFailureReason::Malformed
        }
        crate::DesktopCloudflarePrewriteFailure::Unreadable => {
            crate::CloudflarePrewriteFailureReason::Unreadable
        }
    }
}

const fn desktop_cloudflare_resolution(
    resolution: crate::CloudflareCredentialResolution,
) -> crate::DesktopCloudflareResolution {
    match resolution {
        crate::CloudflareCredentialResolution::Confirmed => {
            crate::DesktopCloudflareResolution::Confirmed
        }
        crate::CloudflareCredentialResolution::TargetNotObservedBurned => {
            crate::DesktopCloudflareResolution::TargetNotObservedBurned
        }
        crate::CloudflareCredentialResolution::TargetPresentAuthorityStaleBurned => {
            crate::DesktopCloudflareResolution::TargetPresentAuthorityStaleBurned
        }
        crate::CloudflareCredentialResolution::RecoveryRequired => {
            crate::DesktopCloudflareResolution::RecoveryRequired
        }
    }
}

impl DesktopLocalHost {
    /// Admits Cloudflare activation before native secret capture or Provider I/O.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, a non-Cloudflare/non-DNS relation, or any live denied credential
    /// transition for the connection.
    pub fn begin_cloudflare_activation(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
        connection_hint: &str,
    ) -> Result<crate::DesktopCloudflareActivationAdmission, DesktopLocalHostError> {
        self.with_sync_runtime(Some(&admission.inner), |sync, database, admitted| {
            sync.admit_cloudflare_activation(
                database,
                admitted.ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                connection_hint,
            )
        })?;
        Ok(crate::DesktopCloudflareActivationAdmission {
            admission,
            connection_hint: connection_hint.to_owned(),
        })
    }

    /// Rechecks the purpose-specific activation admission across a native await boundary.
    ///
    /// # Errors
    ///
    /// Rejects authority, relation, capability, or credential-state drift.
    pub fn recheck_cloudflare_activation(
        &self,
        activation: &crate::DesktopCloudflareActivationAdmission,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&activation.admission.inner),
            |sync, database, admitted| {
                sync.admit_cloudflare_activation(
                    database,
                    admitted
                        .ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                    &activation.connection_hint,
                )
            },
        )
    }

    /// Starts one authority-bound, one-at-a-time post-marker credential recovery scan.
    ///
    /// # Errors
    ///
    /// Rejects stale authority or unavailable randomness before any recovery item is exposed.
    pub fn begin_cloudflare_recovery_scan(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
    ) -> Result<crate::DesktopCloudflareRecoveryScan, DesktopLocalHostError> {
        self.recheck_native_cloud(&admission)?;
        let mut scan_nonce = [0_u8; 16];
        getrandom::fill(&mut scan_nonce).map_err(|_| DesktopLocalHostError::StorageRejected)?;
        Ok(crate::DesktopCloudflareRecoveryScan {
            admission,
            cursor: None,
            scan_nonce,
        })
    }

    /// Yields at most one live post-marker credential intent and advances the private cursor.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, persistence drift, or malformed durable recovery state.
    pub fn next_cloudflare_recovery(
        &self,
        scan: &mut crate::DesktopCloudflareRecoveryScan,
    ) -> Result<Option<crate::DesktopCloudflareRecoveryHandle>, DesktopLocalHostError> {
        let after = scan
            .cursor
            .as_ref()
            .map(|(incarnation, intent)| (incarnation.as_str(), intent.as_str()));
        let recovered =
            self.with_sync_runtime(Some(&scan.admission.inner), |sync, database, admitted| {
                sync.next_cloudflare_recovery(
                    database,
                    admitted
                        .ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                    after,
                )
            })?;
        let Some(recovered) = recovered else {
            return Ok(None);
        };
        scan.cursor = Some((
            recovered.connection_incarnation_id.clone(),
            recovered.intent_id.clone(),
        ));
        Ok(Some(crate::DesktopCloudflareRecoveryHandle {
            scan_nonce: scan.scan_nonce,
            connection_incarnation_id: recovered.connection_incarnation_id.clone(),
            intent_id: recovered.intent_id,
            plan: crate::DesktopCloudflareKeychainPlanData {
                connection_incarnation_id: recovered.connection_incarnation_id,
                connection_digest: recovered.connection_digest,
                expected_base: recovered.expected_base,
                target: recovered.target,
            },
        }))
    }

    /// Resolves one yielded post-marker intent while Secure Host retains its Keychain lock.
    ///
    /// # Errors
    ///
    /// Rejects a substituted scan/handle, stale authority, or failed durable resolution.
    pub fn resolve_cloudflare_recovery(
        &self,
        scan: &crate::DesktopCloudflareRecoveryScan,
        handle: crate::DesktopCloudflareRecoveryHandle,
        comparison: crate::DesktopCloudflareCustodyComparison,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        let crate::DesktopCloudflareRecoveryHandle {
            scan_nonce,
            connection_incarnation_id,
            intent_id,
            plan,
        } = handle;
        let cursor_matches = scan.cursor.as_ref().is_some_and(|(incarnation, intent)| {
            incarnation == &connection_incarnation_id && intent == &intent_id
        });
        if scan_nonce != scan.scan_nonce || !cursor_matches {
            return Err(DesktopLocalHostError::AuthorityRejected);
        }
        let observation = recovery_observation(&plan, comparison);
        let resolution = self.resolve_cloudflare_credential_operation(
            &scan.admission,
            &connection_incarnation_id,
            &intent_id,
            &observation,
        )?;
        Ok(desktop_cloudflare_resolution(resolution))
    }

    /// Imports the activated Zone under the activation's own admission; see
    /// `DesktopSyncRuntime::import_cloudflare_zone_asset`. It runs after the Provider observed the
    /// Zone and before the credential is prepared. If a later step fails, the domain stays added:
    /// the person connected that Zone, and the asset is an ordinary one they can delete.
    fn import_cloudflare_zone_asset(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        entity_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_business_write(&admission.inner, |sync, business, admitted, guard| {
            sync.import_cloudflare_zone_asset(business, admitted, entity_id, guard)
        })
    }

    /// Derives and durably prepares one Cloudflare provision from Host-owned state.
    ///
    /// # Errors
    ///
    /// Rejects an invalid lookup hint, observation, authority, generation, or storage state.
    pub fn prepare_cloudflare_provision(
        &self,
        activation: crate::DesktopCloudflareActivationAdmission,
        observation: &crate::DesktopCloudflareCheckedObservation,
    ) -> Result<crate::PreparedCloudflareProvision, DesktopLocalHostError> {
        let crate::DesktopCloudflareActivationAdmission {
            admission,
            connection_hint,
        } = activation;
        self.import_cloudflare_zone_asset(&admission, &observation.entity_id)?;
        let prepared =
            self.with_sync_write(&admission.inner, |sync, database, admitted, guard| {
                sync.prepare_cloudflare_provision(
                    database,
                    admitted,
                    &connection_hint,
                    observation,
                    guard,
                )
            })?;
        let target = crate::CloudflareCredentialWitness {
            kind: crate::CloudflareCredentialEnvelopeKind::Active,
            generation: Some(prepared.preparation.target_generation),
            scope_digest: Some(prepared.preparation.scope_digest.clone()),
            zone_digest: Some(prepared.preparation.zone_digest.clone()),
            public_proof: Some(prepared.preparation.target_public_proof.clone()),
        };
        Ok(crate::PreparedCloudflareProvision {
            admission,
            plan: crate::DesktopCloudflareKeychainPlanData {
                connection_incarnation_id: prepared.preparation.connection_incarnation_id.clone(),
                connection_digest: prepared.connection_digest,
                expected_base: prepared.expected_base,
                target,
            },
            preparation: prepared.preparation,
        })
    }

    /// Durably enters prewrite inspection after the final cancellation/authority fence.
    ///
    /// # Errors
    ///
    /// Rejects a stale handle, authority, or persisted intent before Keychain is entered.
    pub fn begin_cloudflare_provision_prewrite_inspection(
        &self,
        prepared: crate::PreparedCloudflareProvision,
    ) -> Result<crate::InspectingCloudflareProvision, DesktopLocalHostError> {
        self.begin_cloudflare_prewrite_inspection(
            &prepared.admission,
            &prepared.preparation.connection_incarnation_id,
            &prepared.preparation.intent_id,
        )?;
        Ok(crate::InspectingCloudflareProvision {
            admission: prepared.admission,
            preparation: prepared.preparation,
            plan: prepared.plan,
        })
    }

    /// Records the Host-owned exact base after Secure Host proved it under the Keychain lock.
    ///
    /// # Errors
    ///
    /// Rejects a stale handle, authority, persisted intent, or root/publication drift.
    pub fn mark_cloudflare_provision_write_started(
        &self,
        inspecting: crate::InspectingCloudflareProvision,
    ) -> Result<crate::MarkedCloudflareProvision, DesktopLocalHostError> {
        self.mark_cloudflare_keychain_write_started(
            &inspecting.admission,
            &inspecting.preparation.connection_incarnation_id,
            &inspecting.preparation.intent_id,
        )?;
        Ok(crate::MarkedCloudflareProvision {
            admission: inspecting.admission,
            preparation: inspecting.preparation,
            plan: inspecting.plan,
        })
    }

    /// Converts a prewrite custody contradiction into terminal, sticky remediation.
    ///
    /// # Errors
    ///
    /// Rejects a stale admission, non-prewrite intent, invalid transition, or failed storage commit.
    pub fn remediate_cloudflare_provision_prewrite(
        &self,
        inspecting: crate::InspectingCloudflareProvision,
        reason: crate::DesktopCloudflarePrewriteFailure,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        let crate::InspectingCloudflareProvision {
            admission,
            preparation,
            plan: _,
        } = inspecting;
        self.cancel_cloudflare_prewrite_for_remediation(
            &admission,
            &preparation.connection_incarnation_id,
            &preparation.intent_id,
            prewrite_failure_reason(reason),
        )?;
        Ok(crate::DesktopCloudflareResolution::PrewriteRemediated)
    }

    /// Resolves an active stored credential into an opaque Provider-observation handle.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, an unknown entity/connection hint, or inconsistent publication.
    pub fn prepare_cloudflare_observation(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
        connection_hint: &str,
        entity_hint: &str,
    ) -> Result<crate::PreparedCloudflareObservation, DesktopLocalHostError> {
        crate::portfolio_projection::validate_domain_asset_id(entity_hint)
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let prepared =
            self.with_sync_runtime(Some(&admission.inner), |sync, database, admitted| {
                sync.prepare_cloudflare_observation(
                    database,
                    admitted
                        .ok_or(crate::desktop_sync_runtime::DesktopSyncError::StaleAuthority)?,
                    connection_hint,
                    entity_hint,
                )
            })?;
        Ok(crate::PreparedCloudflareObservation {
            admission,
            connection_id: connection_hint.to_owned(),
            entity_id: entity_hint.to_owned(),
            connection_incarnation_id: prepared.connection_incarnation_id,
            connection_digest: prepared.connection_digest,
            generation: prepared.generation,
            scope_digest: prepared.scope_digest,
            zone_digest: prepared.zone_digest,
            public_proof: prepared.public_proof,
        })
    }

    /// Rechecks a stored-credential observation before each Secure Host await.
    ///
    /// # Errors
    ///
    /// Rejects an expired or superseded Host admission.
    pub fn recheck_cloudflare_observation(
        &self,
        prepared: &crate::PreparedCloudflareObservation,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_runtime(
            Some(&prepared.admission.inner),
            |sync, database, admitted| {
                let current = sync.prepare_cloudflare_observation(
                    database,
                    admitted.ok_or(DesktopSyncError::StaleAuthority)?,
                    &prepared.connection_id,
                    &prepared.entity_id,
                )?;
                if current.connection_incarnation_id != prepared.connection_incarnation_id
                    || current.connection_digest != prepared.connection_digest
                    || current.generation != prepared.generation
                    || current.scope_digest != prepared.scope_digest
                    || current.zone_digest != prepared.zone_digest
                    || current.public_proof != prepared.public_proof
                {
                    return Err(DesktopSyncError::StaleAuthority);
                }
                Ok(())
            },
        )
    }

    /// Commits checked Provider facts under the exact credential identity in the opaque handle.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, entity/zone substitution, malformed evidence, or storage failure.
    pub fn commit_checked_cloudflare_observation(
        &self,
        prepared: crate::PreparedCloudflareObservation,
        observation: &crate::DesktopCloudflareCheckedObservation,
    ) -> Result<crate::PendingCloudflareDnsProjection, DesktopLocalHostError> {
        let credential = crate::desktop_sync_runtime::PreparedCloudflareObservationData {
            connection_id: prepared.connection_id,
            entity_id: prepared.entity_id,
            connection_incarnation_id: prepared.connection_incarnation_id,
            connection_digest: prepared.connection_digest,
            generation: prepared.generation,
            scope_digest: prepared.scope_digest,
            zone_digest: prepared.zone_digest,
            public_proof: prepared.public_proof,
        };
        self.with_sync_write(
            &prepared.admission.inner,
            |sync, database, admission, guard| {
                sync.commit_checked_cloudflare_observation(
                    database,
                    admission,
                    &credential,
                    observation,
                    guard,
                )
            },
        )
    }

    /// Resolves a marked operation from a closed Secure Host custody comparison.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, invalid persisted state, or storage failure.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "consuming the opaque marked handle prevents replay after resolution"
    )]
    pub fn resolve_cloudflare_provision(
        &self,
        marked: crate::MarkedCloudflareProvision,
        comparison: crate::DesktopCloudflareCustodyComparison,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        let observation = recovery_observation(&marked.plan, comparison);
        let resolution = self.resolve_cloudflare_credential_operation(
            &marked.admission,
            &marked.preparation.connection_incarnation_id,
            &marked.preparation.intent_id,
            &observation,
        )?;
        Ok(desktop_cloudflare_resolution(resolution))
    }

    /// Durably prepares the revocation of a connection's Active credential. Credential use is
    /// denied in the same commit, so revocation takes effect in the Host before custody changes;
    /// the tombstone publication that follows only removes the token from custody.
    ///
    /// Returns `None` when the connection holds no credential, which leaves nothing to revoke.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, an unknown connection, a live credential operation, or a
    /// credential that is not Active.
    pub fn prepare_cloudflare_revocation(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
        connection_hint: &str,
    ) -> Result<Option<crate::PreparedCloudflareRevocation>, DesktopLocalHostError> {
        let prepared =
            self.with_sync_write(&admission.inner, |sync, database, admitted, guard| {
                sync.prepare_cloudflare_revocation(database, admitted, connection_hint, guard)
            })?;
        let Some(prepared) = prepared else {
            return Ok(None);
        };
        let target = crate::CloudflareCredentialWitness {
            kind: crate::CloudflareCredentialEnvelopeKind::Tombstone,
            generation: Some(prepared.preparation.target_generation),
            scope_digest: Some(prepared.preparation.scope_digest.clone()),
            zone_digest: Some(prepared.preparation.zone_digest.clone()),
            public_proof: Some(prepared.preparation.target_public_proof.clone()),
        };
        Ok(Some(crate::PreparedCloudflareRevocation {
            admission,
            plan: crate::DesktopCloudflareKeychainPlanData {
                connection_incarnation_id: prepared.preparation.connection_incarnation_id.clone(),
                connection_digest: prepared.connection_digest,
                expected_base: prepared.expected_base,
                target,
            },
            preparation: prepared.preparation,
        }))
    }

    /// Reads actionable refused slots under the current writable workspace admission.
    ///
    /// # Errors
    ///
    /// Rejects stale authority or malformed/oversized stored action targets.
    pub fn read_cloudflare_retirement_candidates(
        &self,
    ) -> Result<Vec<crate::DesktopCloudflareRetirementCandidate>, DesktopLocalHostError> {
        let admission = self.begin_native_cloud_run()?;
        self.with_sync_runtime(Some(&admission.inner), |sync, database, admitted| {
            sync.read_cloudflare_retirement_candidates(
                database,
                admitted.ok_or(DesktopSyncError::Blocked)?,
            )
        })
    }

    /// Claims each request pending at writable opening at most once for automatic retry.
    /// Later wakes do not retry failed deletions or include newly confirmed requests.
    ///
    /// # Errors
    ///
    /// Rejects stale authority or invalid stored requests.
    pub fn claim_cloudflare_retirement_retry(
        &self,
    ) -> Result<Option<crate::DesktopCloudflareRetirement>, DesktopLocalHostError> {
        let admission = self.begin_native_cloud_run()?;
        let claimed =
            self.with_sync_runtime(Some(&admission.inner), |sync, database, admitted| {
                sync.claim_cloudflare_retirement_retry(
                    database,
                    admitted.ok_or(DesktopSyncError::Blocked)?,
                )
            })?;
        Ok(claimed.map(
            |(seed, connection_digest)| crate::DesktopCloudflareRetirement {
                admission,
                seed,
                connection_digest,
            },
        ))
    }

    /// Permanently denies a refused credential and issues its opaque local-only purge plan.
    /// The native caller must obtain the user's first-cleanup confirmation before this call.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, a usable credential, or a possible in-flight Keychain writer.
    pub fn request_cloudflare_retirement(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
        connection_hint: &str,
    ) -> Result<crate::DesktopCloudflareRetirement, DesktopLocalHostError> {
        let (seed, connection_digest) =
            self.with_sync_write(&admission.inner, |sync, database, admitted, guard| {
                sync.request_cloudflare_retirement(database, admitted, connection_hint, guard)
            })?;
        Ok(crate::DesktopCloudflareRetirement {
            admission,
            seed,
            connection_digest,
        })
    }

    /// Resumes an already committed request, without repeating user confirmation.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, an unknown connection, or a request that is not pending.
    pub fn resume_cloudflare_retirement(
        &self,
        admission: crate::DesktopNativeCloudAdmission,
        connection_hint: &str,
    ) -> Result<crate::DesktopCloudflareRetirement, DesktopLocalHostError> {
        let (seed, connection_digest) =
            self.with_sync_runtime(Some(&admission.inner), |sync, database, admitted| {
                sync.resume_cloudflare_retirement(
                    database,
                    admitted.ok_or(DesktopSyncError::Blocked)?,
                    connection_hint,
                )
            })?;
        Ok(crate::DesktopCloudflareRetirement {
            admission,
            seed,
            connection_digest,
        })
    }

    /// Resolves a purge under the same slot lock. Unknown leaves the durable request retryable.
    ///
    /// # Errors
    ///
    /// Rejects a stale handle, authority, or failed transaction. Completion is atomic with hiding
    /// the retired connection; no Keychain deletion result is fabricated on commit failure.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the one-use retirement handle is consumed so it cannot resolve twice"
    )]
    pub fn resolve_cloudflare_retirement(
        &self,
        retirement: crate::DesktopCloudflareRetirement,
        outcome: crate::DesktopCloudflarePurgeOutcome,
    ) -> Result<bool, DesktopLocalHostError> {
        self.with_sync_write(
            &retirement.admission.inner,
            |sync, database, admitted, guard| {
                sync.resolve_cloudflare_retirement(
                    database,
                    admitted,
                    &retirement.seed,
                    outcome != crate::DesktopCloudflarePurgeOutcome::Unknown,
                    guard,
                )
            },
        )
    }

    /// Rechecks the committed request and current authority after acquiring the custody slot lock.
    ///
    /// # Errors
    ///
    /// Rejects a request or authority that is no longer admitted; this does not touch custody.
    pub fn check_cloudflare_retirement(
        &self,
        retirement: &crate::DesktopCloudflareRetirement,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(
            &retirement.admission.inner,
            |sync, database, admitted, guard| {
                sync.resolve_cloudflare_retirement(
                    database,
                    admitted,
                    &retirement.seed,
                    false,
                    guard,
                )
                .map(|_| ())
            },
        )
    }

    /// Durably enters revocation prewrite inspection after the final cancellation fence.
    ///
    /// # Errors
    ///
    /// Rejects a stale handle, authority, or persisted intent before Keychain is entered.
    pub fn begin_cloudflare_revocation_prewrite_inspection(
        &self,
        prepared: crate::PreparedCloudflareRevocation,
    ) -> Result<crate::InspectingCloudflareRevocation, DesktopLocalHostError> {
        self.begin_cloudflare_prewrite_inspection(
            &prepared.admission,
            &prepared.preparation.connection_incarnation_id,
            &prepared.preparation.intent_id,
        )?;
        Ok(crate::InspectingCloudflareRevocation {
            admission: prepared.admission,
            preparation: prepared.preparation,
            plan: prepared.plan,
        })
    }

    /// Records the exact Active base after Secure Host proved it under the Keychain lock.
    ///
    /// # Errors
    ///
    /// Rejects a stale handle, authority, persisted intent, or root/publication drift.
    pub fn mark_cloudflare_revocation_write_started(
        &self,
        inspecting: crate::InspectingCloudflareRevocation,
    ) -> Result<crate::MarkedCloudflareRevocation, DesktopLocalHostError> {
        self.mark_cloudflare_keychain_write_started(
            &inspecting.admission,
            &inspecting.preparation.connection_incarnation_id,
            &inspecting.preparation.intent_id,
        )?;
        Ok(crate::MarkedCloudflareRevocation {
            admission: inspecting.admission,
            preparation: inspecting.preparation,
            plan: inspecting.plan,
        })
    }

    /// Converts a revocation prewrite custody contradiction into terminal, sticky remediation.
    /// Credential use stays denied: a revocation never restores a credential it could not prove.
    ///
    /// # Errors
    ///
    /// Rejects a stale admission, non-prewrite intent, invalid transition, or failed storage commit.
    pub fn remediate_cloudflare_revocation_prewrite(
        &self,
        inspecting: crate::InspectingCloudflareRevocation,
        reason: crate::DesktopCloudflarePrewriteFailure,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        // Consuming the opaque handle prevents a remediation from being replayed.
        let crate::InspectingCloudflareRevocation {
            admission,
            preparation,
            plan: _,
        } = inspecting;
        self.cancel_cloudflare_prewrite_for_remediation(
            &admission,
            &preparation.connection_incarnation_id,
            &preparation.intent_id,
            prewrite_failure_reason(reason),
        )?;
        Ok(crate::DesktopCloudflareResolution::PrewriteRemediated)
    }

    /// Resolves a marked revocation from a closed Secure Host custody comparison.
    ///
    /// # Errors
    ///
    /// Rejects stale authority, invalid persisted state, or storage failure.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "consuming the opaque marked handle prevents replay after resolution"
    )]
    pub fn resolve_cloudflare_revocation(
        &self,
        marked: crate::MarkedCloudflareRevocation,
        comparison: crate::DesktopCloudflareCustodyComparison,
    ) -> Result<crate::DesktopCloudflareResolution, DesktopLocalHostError> {
        let observation = recovery_observation(&marked.plan, comparison);
        let resolution = self.resolve_cloudflare_credential_operation(
            &marked.admission,
            &marked.preparation.connection_incarnation_id,
            &marked.preparation.intent_id,
            &observation,
        )?;
        Ok(desktop_cloudflare_resolution(resolution))
    }

    /// Reads the sole bounded, non-secret Cloudflare connection marker under Host authority.
    ///
    /// # Errors
    ///
    /// Returns a closed authority or storage error when local reads are not admitted.
    pub fn read_cloudflare_connection(
        &self,
    ) -> Result<crate::DesktopCloudflareConnectionRead, DesktopLocalHostError> {
        self.with_authorized_business(false, |runtime, _, _, _| {
            runtime.read_cloudflare_connection()
        })
    }

    /// Reads the latest committed local Cloudflare DNS evidence under Host authority.
    ///
    /// # Errors
    ///
    /// Returns a closed protocol, authority, or storage error for invalid or unavailable reads.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the IPC-facing request contract is intentionally accepted as an owned wire value"
    )]
    pub fn read_cloudflare_observation(
        &self,
        request: crate::DesktopCloudflareObservationReadRequest,
    ) -> Result<crate::DesktopCloudflareObservationRead, DesktopLocalHostError> {
        if request.schema_version != 1 {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        self.with_authorized_business(false, |runtime, _, _, _| {
            runtime.read_cloudflare_observation(&request.entity_id)
        })
    }

    /// Creates the workspace's Cloudflare connection, holding no credential, so activation has a
    /// row to provision into. Refused before any authority or storage work while the Cloudflare
    /// capability is unqualified (ADR-0027): a connection is only useful to run that capability.
    ///
    /// # Errors
    ///
    /// Returns `CapabilityUnqualified`, or a closed authority or storage error when mutation
    /// admission, validation, or the final durable commit fence fails.
    pub fn create_cloudflare_connection(
        &self,
        request: &crate::DesktopCloudflareConnectionCreateRequest,
    ) -> Result<crate::DesktopCloudflareConnectionCreated, DesktopLocalHostError> {
        if !crate::active_workspace::capability_qualification::capability_qualified(
            crate::active_workspace::capability_qualification::CLOUDFLARE_DNS_OBSERVE,
        ) {
            return Err(DesktopLocalHostError::CapabilityUnqualified);
        }
        let _generation = ConnectionGenerationAdvance::new(&self.provider_connection_generation);
        let connection_id = crate::desktop_sync_runtime::random_uuid_v4()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let incarnation_id = crate::desktop_sync_runtime::random_uuid_v4()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        self.with_authorized_business(true, |runtime, authority, captured_epoch, _| {
            if authority.kind != super::WorkspaceAuthorityKind::Active
                || !authority
                    .capabilities
                    .iter()
                    .any(|capability| capability == "cloudflare:dns:observe")
            {
                return Err(BusinessDatabaseError::MutationStale);
            }
            let created_at = format_timestamp(
                current_unix_seconds().map_err(|_| BusinessDatabaseError::WorkspaceRejected)?,
            );
            runtime.create_cloudflare_connection_guarded(
                request,
                &connection_id,
                &incarnation_id,
                &created_at,
                || self.require_business_commit_fence(captured_epoch, authority),
            )
        })
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "projection inspection remains a test oracle; production claims through the sealed Native exchange"
        )
    )]
    pub(crate) fn pending_cloudflare_projections(
        &self,
        admission: &DesktopSyncRunAdmission,
        limit: usize,
    ) -> Result<Vec<crate::PendingCloudflareDnsProjection>, DesktopLocalHostError> {
        self.with_sync_runtime(Some(admission), |sync, database, admission| {
            sync.pending_cloudflare_projections(
                database,
                admission.expect("admission checked"),
                limit,
            )
        })
    }

    pub(crate) fn claim_cloudflare_projection(
        &self,
        admission: &DesktopSyncRunAdmission,
    ) -> Result<crate::desktop_sync_runtime::CloudflareProjectionClaimSchedule, DesktopLocalHostError>
    {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.claim_cloudflare_projection(database, admission, guard)
        })
    }

    pub(crate) fn acknowledge_cloudflare_projection(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        acknowledgement: &crate::CloudflareDnsProjectionAcknowledgement,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.acknowledge_cloudflare_projection(
                database,
                admission,
                delivery_owner,
                acknowledgement,
                guard,
            )
        })
    }

    pub(crate) fn defer_cloudflare_projection(
        &self,
        admission: &DesktopSyncRunAdmission,
        delivery_owner: &str,
        projection: &crate::ClaimedCloudflareDnsProjection,
    ) -> Result<std::time::Duration, DesktopLocalHostError> {
        self.with_sync_write(admission, |sync, database, admission, guard| {
            sync.defer_cloudflare_projection(database, admission, delivery_owner, projection, guard)
        })
    }

    /// Records the exact credential base before the caller begins the OS Keychain mutation.
    ///
    /// # Errors
    ///
    /// Returns a validation, stale-authority, or storage error when the marker cannot commit.
    pub(crate) fn begin_cloudflare_prewrite_inspection(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.begin_cloudflare_prewrite_inspection(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                guard,
            )
        })
    }

    pub(crate) fn mark_cloudflare_keychain_write_started(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.mark_cloudflare_keychain_write_started(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                guard,
            )
        })
    }

    pub(crate) fn cancel_cloudflare_prewrite_for_remediation(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        reason: crate::CloudflarePrewriteFailureReason,
    ) -> Result<(), DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.cancel_cloudflare_prewrite_for_remediation(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                reason,
                guard,
            )
        })
    }

    /// Cancels never-entered preparations and remediates prewrite orphans under fresh authority.
    ///
    /// # Errors
    ///
    /// Rejects stale authority or an atomic storage transition failure.
    pub fn recover_cloudflare_credential_orphans(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
    ) -> Result<usize, DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.recover_cloudflare_credential_orphans(database, admission, guard)
        })
    }

    /// Resolves a prepared credential transition from the post-write Keychain observation.
    ///
    /// # Errors
    ///
    /// Returns a validation, stale-authority, or storage error when resolution cannot commit.
    pub(crate) fn resolve_cloudflare_credential_operation(
        &self,
        admission: &crate::DesktopNativeCloudAdmission,
        connection_incarnation_id: &str,
        intent_id: &str,
        observation: &crate::CloudflareCredentialRecoveryObservation,
    ) -> Result<crate::CloudflareCredentialResolution, DesktopLocalHostError> {
        self.with_sync_write(&admission.inner, |sync, database, admission, guard| {
            sync.resolve_cloudflare_credential_operation(
                database,
                admission,
                connection_incarnation_id,
                intent_id,
                observation,
                guard,
            )
        })
    }
}
