use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};

use super::{
    BusinessDatabase, BusinessDatabaseError, CloudflareDnsRecordWrite,
    canonical_cloudflare_projection_digest, hex_digest, is_uuid_v4, validate_domain_asset_id,
    validate_local_text, validate_sha256_hex, validate_timestamp,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareCredentialOperationKind {
    Provision,
    Revoke,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareCredentialEnvelopeKind {
    Absent,
    Active,
    Tombstone,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareCredentialWitness {
    pub kind: CloudflareCredentialEnvelopeKind,
    pub generation: Option<u64>,
    pub scope_digest: Option<String>,
    pub zone_digest: Option<String>,
    pub public_proof: Option<String>,
}

impl CloudflareCredentialWitness {
    #[must_use]
    pub const fn absent() -> Self {
        Self {
            kind: CloudflareCredentialEnvelopeKind::Absent,
            generation: None,
            scope_digest: None,
            zone_digest: None,
            public_proof: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareCredentialStagedObservation {
    pub staged_batch_id: String,
    pub observation_digest: String,
    pub observation_id: String,
    pub observation_run_id: String,
    pub entity_id: String,
    pub lease_epoch: u64,
    pub observed_at: String,
    pub zone_name_ascii: String,
    pub authoritative_nameservers: Vec<String>,
    pub dnssec_status: String,
    pub availability: String,
    pub zone_status: String,
    pub records: Vec<CloudflareDnsRecordWrite>,
    pub provider_version_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareCredentialPreparation {
    pub logical_connection_id: String,
    pub connection_incarnation_id: String,
    pub display_label: String,
    pub intent_id: String,
    pub operation_kind: CloudflareCredentialOperationKind,
    pub expected_head_generation: u64,
    pub target_generation: u64,
    pub scope_digest: String,
    pub zone_digest: String,
    pub target_public_proof: String,
    pub prepared_authority_snapshot_digest: String,
    pub staged_observation: Option<CloudflareCredentialStagedObservation>,
    pub prepared_at: String,
}

pub(crate) struct CloudflareCredentialRecoverySeed {
    pub(crate) logical_connection_id: String,
    pub(crate) connection_incarnation_id: String,
    pub(crate) intent_id: String,
    pub(crate) expected_base: CloudflareCredentialWitness,
    pub(crate) target: CloudflareCredentialWitness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareCredentialPreparationDisposition {
    Prepared,
    NoopAbsentRevoke,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareCredentialRecoveryObservation {
    Canonical(CloudflareCredentialWitness),
    Missing,
    Malformed,
    Unreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflareCredentialResolution {
    Confirmed,
    TargetNotObservedBurned,
    TargetPresentAuthorityStaleBurned,
    RecoveryRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloudflarePrewriteFailureReason {
    BaseMismatch,
    MissingOther,
    Malformed,
    Unreadable,
    Orphaned,
}

#[derive(Debug)]
struct IntentRow {
    operation_kind: CloudflareCredentialOperationKind,
    expected_head_generation: u64,
    target_generation: u64,
    target: CloudflareCredentialWitness,
    base: CloudflareCredentialWitness,
    staged_batch_id: Option<String>,
    prepared_authority_snapshot_digest: String,
}

struct CredentialResolutionCommit<'a> {
    intent_id: &'a str,
    intent: &'a IntentRow,
    resolution: CloudflareCredentialResolution,
    prepared_authority_is_current: bool,
    updated_at: &'a str,
}

pub(crate) struct CloudflareProvisionSeed {
    pub(crate) logical_connection_id: String,
    pub(crate) connection_incarnation_id: String,
    pub(crate) display_label: String,
    pub(crate) expected_head_generation: u64,
    pub(crate) expected_base: CloudflareCredentialWitness,
}

impl BusinessDatabase {
    pub(crate) fn cloudflare_provision_seed(
        &self,
        connection_hint: &str,
    ) -> Result<CloudflareProvisionSeed, BusinessDatabaseError> {
        validate_local_text(connection_hint)?;
        let (connection_incarnation_id, display_label, published_generation) = self
            .store
            .raw_connection()
            .query_row(
                "SELECT connection_incarnation_id,display_label,active_credential_generation
                   FROM local_provider_connections
                  WHERE workspace_id=?1 AND connection_id=?2 AND provider_kind='cloudflare'
                    AND connection_incarnation_id IS NOT NULL
                    AND credential_use_state IN ('inactive','active')
                    AND json_array_length(capabilities_json)=1
                    AND json_extract(capabilities_json,'$[0]')='dns'",
                params![self.workspace_id, connection_hint],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_local_text(&connection_incarnation_id)?;
        validate_local_text(&display_label)?;
        let root = self
            .store
            .raw_connection()
            .query_row(
                "SELECT highest_resolved_generation,known_envelope_kind,
                        known_envelope_generation,known_scope_digest,known_zone_digest,
                        known_public_proof,retired_at
                   FROM cloudflare_credential_roots
                  WHERE workspace_id=?1 AND connection_incarnation_id=?2
                    AND logical_connection_id=?3",
                params![
                    self.workspace_id,
                    connection_incarnation_id,
                    connection_hint
                ],
                |row| {
                    let kind = row.get::<_, String>(1)?;
                    Ok((
                        row.get::<_, i64>(0)?,
                        witness_from_columns(
                            &kind,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        )?,
                        row.get::<_, Option<String>>(6)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (expected_head_generation, expected_base) = match root {
            Some((head, base, None)) => (
                u64::try_from(head).map_err(|_| BusinessDatabaseError::InvalidInput)?,
                base,
            ),
            None if published_generation.is_none() => (0, CloudflareCredentialWitness::absent()),
            Some((_, _, Some(_))) | None => return Err(BusinessDatabaseError::MutationStale),
        };
        let live_intent_exists = self
            .store
            .raw_connection()
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM cloudflare_credential_intents
                     WHERE workspace_id=?1 AND connection_incarnation_id=?2
                       AND phase IN ('prepared','prewrite_inspection_started',
                                     'keychain_write_started','recovery_required'))",
                params![self.workspace_id, connection_incarnation_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if live_intent_exists {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(CloudflareProvisionSeed {
            logical_connection_id: connection_hint.to_owned(),
            connection_incarnation_id,
            display_label,
            expected_head_generation,
            expected_base,
        })
    }

    pub(crate) fn prepare_cloudflare_credential_operation_guarded(
        &mut self,
        input: &CloudflareCredentialPreparation,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<CloudflareCredentialPreparationDisposition, BusinessDatabaseError> {
        validate_preparation(input)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;

        let known = load_or_create_credential_root(&transaction, &self.workspace_id, input)?;
        if revoke_is_idempotent_noop(&transaction, &self.workspace_id, input, &known)? {
            pre_commit_guard()?;
            transaction
                .commit()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            return Ok(CloudflareCredentialPreparationDisposition::NoopAbsentRevoke);
        }
        insert_credential_intent(&transaction, &self.workspace_id, input)?;
        deny_credential_use_for_revoke(&transaction, &self.workspace_id, input)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(CloudflareCredentialPreparationDisposition::Prepared)
    }

    pub(crate) fn begin_cloudflare_prewrite_inspection_guarded(
        &mut self,
        connection_incarnation_id: &str,
        intent_id: &str,
        current_authority_snapshot_digest: &str,
        updated_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_local_text(connection_incarnation_id)?;
        validate_local_text(intent_id)?;
        validate_timestamp(Some(updated_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_sha256_hex(current_authority_snapshot_digest)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (known, operation, logical_connection_id, prepared_authority) = transaction
            .query_row(
                "SELECT r.known_envelope_kind,r.known_envelope_generation,
                        r.known_scope_digest,r.known_zone_digest,r.known_public_proof,
                        i.operation_kind,r.logical_connection_id,
                        i.prepared_authority_snapshot_digest
                   FROM cloudflare_credential_intents i
                   JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
                  WHERE i.workspace_id=?1 AND i.connection_incarnation_id=?2
                    AND i.intent_id=?3 AND i.phase='prepared'",
                params![self.workspace_id, connection_incarnation_id, intent_id],
                |row| {
                    let known_kind = row.get::<_, String>(0)?;
                    Ok((
                        witness_from_columns(
                            &known_kind,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        )?,
                        parse_operation(&row.get::<_, String>(5)?)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .map_err(|_| BusinessDatabaseError::MutationStale)?;
        if prepared_authority != current_authority_snapshot_digest {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let publication =
            connection_publication(&transaction, &self.workspace_id, &logical_connection_id)?;
        if !publication_matches_root(&known, publication.as_ref()) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if operation == CloudflareCredentialOperationKind::Revoke
            && (known.kind != CloudflareCredentialEnvelopeKind::Active || publication.is_none())
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let changed = transaction
            .execute(
                "UPDATE cloudflare_credential_intents
                    SET phase='prewrite_inspection_started',updated_at=?1
                  WHERE workspace_id=?2 AND connection_incarnation_id=?3
                    AND intent_id=?4 AND phase='prepared'",
                params![
                    updated_at,
                    self.workspace_id,
                    connection_incarnation_id,
                    intent_id,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if operation == CloudflareCredentialOperationKind::Provision {
            transaction
                .execute(
                    "UPDATE local_provider_connections
                        SET credential_use_state='transition_pending',
                            lifecycle_status='invalid',validation_status='unknown',
                            active_credential_changed_at=?1
                      WHERE workspace_id=?2 AND connection_id=?3",
                    params![updated_at, self.workspace_id, logical_connection_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn mark_cloudflare_keychain_write_started_guarded(
        &mut self,
        connection_incarnation_id: &str,
        intent_id: &str,
        current_authority_snapshot_digest: &str,
        updated_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_local_text(connection_incarnation_id)?;
        validate_local_text(intent_id)?;
        validate_timestamp(Some(updated_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_sha256_hex(current_authority_snapshot_digest)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (base, logical_connection_id, prepared_authority) = transaction
            .query_row(
                "SELECT r.known_envelope_kind,r.known_envelope_generation,
                        r.known_scope_digest,r.known_zone_digest,r.known_public_proof,
                        r.logical_connection_id,i.prepared_authority_snapshot_digest
                   FROM cloudflare_credential_intents i
                   JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
                  WHERE i.workspace_id=?1 AND i.connection_incarnation_id=?2
                    AND i.intent_id=?3 AND i.phase='prewrite_inspection_started'",
                params![self.workspace_id, connection_incarnation_id, intent_id],
                |row| {
                    let kind = row.get::<_, String>(0)?;
                    Ok((
                        witness_from_columns(
                            &kind,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        )?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .map_err(|_| BusinessDatabaseError::MutationStale)?;
        if prepared_authority != current_authority_snapshot_digest {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let publication =
            connection_publication(&transaction, &self.workspace_id, &logical_connection_id)?;
        if !publication_matches_root(&base, publication.as_ref()) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let changed = transaction
            .execute(
                "UPDATE cloudflare_credential_intents
                    SET marker_base_recorded=1,marker_base_envelope_kind=?1,
                        marker_base_generation=?2,marker_base_scope_digest=?3,
                        marker_base_zone_digest=?4,marker_base_public_proof=?5,
                        phase='keychain_write_started',updated_at=?6
                  WHERE workspace_id=?7 AND connection_incarnation_id=?8
                    AND intent_id=?9 AND phase='prewrite_inspection_started'",
                params![
                    envelope_kind(base.kind),
                    optional_i64(base.generation)?,
                    base.scope_digest,
                    base.zone_digest,
                    base.public_proof,
                    updated_at,
                    self.workspace_id,
                    connection_incarnation_id,
                    intent_id,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn cancel_cloudflare_prewrite_for_remediation_guarded(
        &mut self,
        connection_incarnation_id: &str,
        intent_id: &str,
        reason: CloudflarePrewriteFailureReason,
        updated_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_local_text(connection_incarnation_id)?;
        validate_local_text(intent_id)?;
        validate_timestamp(Some(updated_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (logical_connection_id, staged_batch_id): (String, Option<String>) = transaction
            .query_row(
                "SELECT r.logical_connection_id,i.staged_batch_id
                   FROM cloudflare_credential_intents i
                   JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
                  WHERE i.workspace_id=?1 AND i.connection_incarnation_id=?2
                    AND i.intent_id=?3 AND i.phase='prewrite_inspection_started'",
                params![self.workspace_id, connection_incarnation_id, intent_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| BusinessDatabaseError::MutationStale)?;
        if let Some(batch_id) = staged_batch_id {
            transaction
                .execute(
                    "UPDATE cloudflare_dns_staged_batches SET visibility='discarded',updated_at=?1
                  WHERE workspace_id=?2 AND connection_incarnation_id=?3
                    AND staged_batch_id=?4 AND visibility='staged'",
                    params![
                        updated_at,
                        self.workspace_id,
                        connection_incarnation_id,
                        batch_id
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        let changed = transaction
            .execute(
                "UPDATE cloudflare_credential_intents
                SET phase='cancelled',terminal_reason=?1,updated_at=?2
              WHERE workspace_id=?3 AND connection_incarnation_id=?4
                AND intent_id=?5 AND phase='prewrite_inspection_started'",
                params![
                    prewrite_failure_reason(reason),
                    updated_at,
                    self.workspace_id,
                    connection_incarnation_id,
                    intent_id
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        transaction
            .execute(
                "UPDATE local_provider_connections
                SET credential_use_state='remediation_required',lifecycle_status='invalid',
                    validation_status='unknown',active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_id=?3 AND connection_incarnation_id=?4",
                params![
                    updated_at,
                    self.workspace_id,
                    logical_connection_id,
                    connection_incarnation_id
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn recover_cloudflare_credential_orphans_guarded(
        &mut self,
        updated_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<usize, BusinessDatabaseError> {
        validate_timestamp(Some(updated_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let orphan_count: i64 = transaction
            .query_row(
                "SELECT count(*) FROM cloudflare_credential_intents
              WHERE workspace_id=?1 AND phase IN ('prepared','prewrite_inspection_started')",
                params![self.workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute(
            "UPDATE cloudflare_dns_staged_batches SET visibility='discarded',updated_at=?1
              WHERE workspace_id=?2 AND visibility='staged'
                AND EXISTS (
                  SELECT 1 FROM cloudflare_credential_intents i
                   WHERE i.workspace_id=cloudflare_dns_staged_batches.workspace_id
                     AND i.connection_incarnation_id=cloudflare_dns_staged_batches.connection_incarnation_id
                     AND i.staged_batch_id=cloudflare_dns_staged_batches.staged_batch_id
                     AND i.phase IN ('prepared','prewrite_inspection_started'))",
            params![updated_at, self.workspace_id],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "UPDATE local_provider_connections
                SET credential_use_state='remediation_required',lifecycle_status='invalid',
                    validation_status='unknown',active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_incarnation_id IN (
                SELECT connection_incarnation_id FROM cloudflare_credential_intents
                 WHERE workspace_id=?2 AND phase='prewrite_inspection_started')",
                params![updated_at, self.workspace_id],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "UPDATE cloudflare_credential_intents
                    SET phase='cancelled',terminal_reason=?1,updated_at=?2
                  WHERE workspace_id=?3 AND phase='prepared'",
                params!["cancelled_before_inspection", updated_at, self.workspace_id],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "UPDATE cloudflare_credential_intents
                SET phase='cancelled',terminal_reason=?1,updated_at=?2
              WHERE workspace_id=?3 AND phase='prewrite_inspection_started'",
                params![
                    prewrite_failure_reason(CloudflarePrewriteFailureReason::Orphaned),
                    updated_at,
                    self.workspace_id
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        usize::try_from(orphan_count).map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn next_cloudflare_credential_recovery(
        &self,
        after: Option<(&str, &str)>,
    ) -> Result<Option<CloudflareCredentialRecoverySeed>, BusinessDatabaseError> {
        let (after_incarnation, after_intent) = after.unwrap_or(("", ""));
        let row = self
            .store
            .raw_connection()
            .query_row(
                "SELECT r.logical_connection_id,i.connection_incarnation_id,i.intent_id,
                        i.target_envelope_kind,i.target_generation,i.scope_digest,
                        i.zone_digest,i.target_public_proof,
                        i.marker_base_envelope_kind,i.marker_base_generation,
                        i.marker_base_scope_digest,i.marker_base_zone_digest,
                        i.marker_base_public_proof
                   FROM cloudflare_credential_intents i
                   JOIN cloudflare_credential_roots r
                     USING (workspace_id,connection_incarnation_id)
                  WHERE i.workspace_id=?1
                    AND i.phase IN ('keychain_write_started','recovery_required')
                    AND i.marker_base_recorded=1
                    AND (i.connection_incarnation_id>?2
                      OR (i.connection_incarnation_id=?2 AND i.intent_id>?3))
                  ORDER BY i.connection_incarnation_id,i.intent_id
                  LIMIT 1",
                params![self.workspace_id, after_incarnation, after_intent],
                |row| {
                    let target_generation = u64::try_from(row.get::<_, i64>(4)?)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    Ok(CloudflareCredentialRecoverySeed {
                        logical_connection_id: row.get(0)?,
                        connection_incarnation_id: row.get(1)?,
                        intent_id: row.get(2)?,
                        target: CloudflareCredentialWitness {
                            kind: parse_envelope(&row.get::<_, String>(3)?)?,
                            generation: Some(target_generation),
                            scope_digest: Some(row.get(5)?),
                            zone_digest: Some(row.get(6)?),
                            public_proof: Some(row.get(7)?),
                        },
                        expected_base: witness_from_columns(
                            &row.get::<_, String>(8)?,
                            row.get(9)?,
                            row.get(10)?,
                            row.get(11)?,
                            row.get(12)?,
                        )?,
                    })
                },
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if let Some(seed) = row.as_ref() {
            validate_witness(&seed.expected_base)?;
            validate_witness(&seed.target)?;
            let publication = connection_publication(
                self.store.raw_connection(),
                &self.workspace_id,
                &seed.logical_connection_id,
            )?;
            if !publication_matches_root(&seed.expected_base, publication.as_ref()) {
                return Err(BusinessDatabaseError::MutationStale);
            }
        }
        Ok(row)
    }

    pub(crate) fn resolve_cloudflare_credential_operation_guarded(
        &mut self,
        connection_incarnation_id: &str,
        intent_id: &str,
        observation: &CloudflareCredentialRecoveryObservation,
        current_authority_snapshot_digest: &str,
        updated_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<CloudflareCredentialResolution, BusinessDatabaseError> {
        validate_resolution_input(
            connection_incarnation_id,
            intent_id,
            observation,
            current_authority_snapshot_digest,
            updated_at,
        )?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let intent = load_intent(
            &transaction,
            &self.workspace_id,
            connection_incarnation_id,
            intent_id,
        )?;
        let prepared_authority_is_current =
            intent.prepared_authority_snapshot_digest == current_authority_snapshot_digest;
        let resolution = classify_resolution(observation, &intent, prepared_authority_is_current);
        if resolution == CloudflareCredentialResolution::RecoveryRequired {
            mark_credential_recovery_required(
                &transaction,
                &self.workspace_id,
                connection_incarnation_id,
                intent_id,
                updated_at,
            )?;
            pre_commit_guard()?;
            transaction
                .commit()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            return Ok(resolution);
        }

        commit_credential_resolution(
            &transaction,
            &self.workspace_id,
            connection_incarnation_id,
            &CredentialResolutionCommit {
                intent_id,
                intent: &intent,
                resolution,
                prepared_authority_is_current,
                updated_at,
            },
        )?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(resolution)
    }
}

fn load_or_create_credential_root(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    input: &CloudflareCredentialPreparation,
) -> Result<CloudflareCredentialWitness, BusinessDatabaseError> {
    let root = transaction
        .query_row(
            "SELECT highest_resolved_generation,known_envelope_kind,
                    known_envelope_generation,known_scope_digest,known_zone_digest,
                    known_public_proof,retired_at
               FROM cloudflare_credential_roots
              WHERE workspace_id=?1 AND connection_incarnation_id=?2
                AND logical_connection_id=?3",
            params![
                workspace_id,
                input.connection_incarnation_id,
                input.logical_connection_id
            ],
            |row| {
                let kind = row.get::<_, String>(1)?;
                Ok((
                    row.get::<_, i64>(0)?,
                    witness_from_columns(
                        &kind,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    )?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if let Some((head, known, retired_at)) = root {
        if retired_at.is_some() || u64::try_from(head).ok() != Some(input.expected_head_generation)
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        return Ok(known);
    }
    if input.operation_kind != CloudflareCredentialOperationKind::Provision
        || input.expected_head_generation != 0
    {
        return Err(BusinessDatabaseError::MutationStale);
    }
    transaction
        .execute(
            "INSERT INTO local_provider_connections
             (workspace_id,connection_id,provider_kind,display_label,
              active_credential_changed_at,lifecycle_status,capabilities_json,
              created_at,validation_status,connection_incarnation_id,
              credential_use_state)
             VALUES (?1,?2,'cloudflare',?3,?4,'invalid','[\"dns\"]',?4,
                     'unknown',?5,'inactive')
             ON CONFLICT(workspace_id,connection_id) DO UPDATE SET
               display_label=excluded.display_label,
               connection_incarnation_id=excluded.connection_incarnation_id",
            params![
                workspace_id,
                input.logical_connection_id,
                input.display_label,
                input.prepared_at,
                input.connection_incarnation_id,
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO cloudflare_credential_roots
             (workspace_id,connection_incarnation_id,logical_connection_id,
              highest_resolved_generation,head_ledger_generation,
              known_envelope_kind,updated_at)
             VALUES (?1,?2,?3,0,NULL,'absent',?4)",
            params![
                workspace_id,
                input.connection_incarnation_id,
                input.logical_connection_id,
                input.prepared_at,
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(CloudflareCredentialWitness::absent())
}

fn revoke_is_idempotent_noop(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    input: &CloudflareCredentialPreparation,
    known: &CloudflareCredentialWitness,
) -> Result<bool, BusinessDatabaseError> {
    if input.operation_kind != CloudflareCredentialOperationKind::Revoke {
        return Ok(false);
    }
    if known.kind == CloudflareCredentialEnvelopeKind::Absent {
        let publication_count: i64 = transaction
            .query_row(
                "SELECT count(*) FROM local_provider_connections
                  WHERE workspace_id=?1 AND connection_id=?2
                    AND active_credential_generation IS NOT NULL",
                params![workspace_id, input.logical_connection_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if publication_count == 0 {
            return Ok(true);
        }
    }
    if known.kind != CloudflareCredentialEnvelopeKind::Active
        || known.scope_digest.as_deref() != Some(input.scope_digest.as_str())
        || known.zone_digest.as_deref() != Some(input.zone_digest.as_str())
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(false)
}

fn insert_credential_intent(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    input: &CloudflareCredentialPreparation,
) -> Result<(), BusinessDatabaseError> {
    if let Some(stage) = &input.staged_observation {
        insert_staged_observation(transaction, workspace_id, input, stage)?;
    }
    transaction
        .execute(
            "INSERT INTO cloudflare_credential_intents
             (workspace_id,connection_incarnation_id,intent_id,operation_kind,
              expected_head_generation,target_generation,target_envelope_kind,
              scope_digest,zone_digest,target_public_proof,
              prepared_authority_snapshot_digest,staged_batch_id,
              staged_observation_digest,phase,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
                     'prepared',?14,?14)",
            params![
                workspace_id,
                input.connection_incarnation_id,
                input.intent_id,
                operation_kind(input.operation_kind),
                to_i64(input.expected_head_generation)?,
                to_i64(input.target_generation)?,
                target_kind(input.operation_kind),
                input.scope_digest,
                input.zone_digest,
                input.target_public_proof,
                input.prepared_authority_snapshot_digest,
                input
                    .staged_observation
                    .as_ref()
                    .map(|stage| stage.staged_batch_id.as_str()),
                input
                    .staged_observation
                    .as_ref()
                    .map(|stage| stage.observation_digest.as_str()),
                input.prepared_at,
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

fn deny_credential_use_for_revoke(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    input: &CloudflareCredentialPreparation,
) -> Result<(), BusinessDatabaseError> {
    if input.operation_kind != CloudflareCredentialOperationKind::Revoke {
        return Ok(());
    }
    let changed = transaction
        .execute(
            "UPDATE local_provider_connections
                SET credential_use_state='revocation_pending',
                    lifecycle_status='invalid',validation_status='unknown',
                    active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_id=?3
                AND connection_incarnation_id=?4",
            params![
                input.prepared_at,
                workspace_id,
                input.logical_connection_id,
                input.connection_incarnation_id
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if changed != 1 {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}

fn validate_resolution_input(
    connection_incarnation_id: &str,
    intent_id: &str,
    observation: &CloudflareCredentialRecoveryObservation,
    current_authority_snapshot_digest: &str,
    updated_at: &str,
) -> Result<(), BusinessDatabaseError> {
    validate_local_text(connection_incarnation_id)?;
    validate_local_text(intent_id)?;
    validate_timestamp(Some(updated_at.to_owned()))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if let CloudflareCredentialRecoveryObservation::Canonical(witness) = observation {
        validate_witness(witness)?;
    }
    validate_sha256_hex(current_authority_snapshot_digest)
}

fn classify_resolution(
    observation: &CloudflareCredentialRecoveryObservation,
    intent: &IntentRow,
    prepared_authority_is_current: bool,
) -> CloudflareCredentialResolution {
    let absent = CloudflareCredentialWitness::absent();
    let observed = match observation {
        CloudflareCredentialRecoveryObservation::Canonical(witness) => Some(witness),
        CloudflareCredentialRecoveryObservation::Missing => Some(&absent),
        CloudflareCredentialRecoveryObservation::Malformed
        | CloudflareCredentialRecoveryObservation::Unreadable => None,
    };
    let exact_target = observed == Some(&intent.target);
    if exact_target && prepared_authority_is_current {
        CloudflareCredentialResolution::Confirmed
    } else if observed == Some(&intent.base) {
        CloudflareCredentialResolution::TargetNotObservedBurned
    } else if exact_target {
        CloudflareCredentialResolution::TargetPresentAuthorityStaleBurned
    } else {
        CloudflareCredentialResolution::RecoveryRequired
    }
}

fn mark_credential_recovery_required(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    connection_incarnation_id: &str,
    intent_id: &str,
    updated_at: &str,
) -> Result<(), BusinessDatabaseError> {
    transaction
        .execute(
            "UPDATE cloudflare_credential_intents
                SET phase='recovery_required',updated_at=?1
              WHERE workspace_id=?2 AND connection_incarnation_id=?3
                AND intent_id=?4 AND phase='keychain_write_started'",
            params![
                updated_at,
                workspace_id,
                connection_incarnation_id,
                intent_id
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

fn commit_credential_resolution(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    connection_incarnation_id: &str,
    commit: &CredentialResolutionCommit<'_>,
) -> Result<(), BusinessDatabaseError> {
    append_resolution_ledger_and_advance_root(
        transaction,
        workspace_id,
        connection_incarnation_id,
        commit.intent_id,
        commit.intent,
        commit.resolution,
        commit.updated_at,
    )?;
    let logical_connection_id: String = transaction
        .query_row(
            "SELECT logical_connection_id FROM cloudflare_credential_roots
              WHERE workspace_id=?1 AND connection_incarnation_id=?2",
            params![workspace_id, connection_incarnation_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    apply_resolution_publication(
        transaction,
        workspace_id,
        &logical_connection_id,
        commit.intent,
        commit.resolution,
        commit.prepared_authority_is_current,
        commit.updated_at,
    )?;
    finalize_staged_observation(
        transaction,
        workspace_id,
        &logical_connection_id,
        commit.intent,
        commit.resolution,
        commit.updated_at,
    )?;
    consume_credential_intent(
        transaction,
        workspace_id,
        connection_incarnation_id,
        commit.intent_id,
        commit.updated_at,
    )
}

fn append_resolution_ledger_and_advance_root(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    connection_incarnation_id: &str,
    intent_id: &str,
    intent: &IntentRow,
    resolution: CloudflareCredentialResolution,
    updated_at: &str,
) -> Result<(), BusinessDatabaseError> {
    let (ledger_result, burn_reason) = match resolution {
        CloudflareCredentialResolution::Confirmed => (
            if intent.operation_kind == CloudflareCredentialOperationKind::Provision {
                "active_confirmed"
            } else {
                "tombstone_confirmed"
            },
            None,
        ),
        CloudflareCredentialResolution::TargetNotObservedBurned => {
            ("burned", Some("target_not_observed"))
        }
        CloudflareCredentialResolution::TargetPresentAuthorityStaleBurned => {
            ("burned", Some("target_present_authority_stale"))
        }
        CloudflareCredentialResolution::RecoveryRequired => unreachable!(),
    };
    transaction
        .execute(
            "INSERT INTO cloudflare_credential_generation_ledger
             (workspace_id,connection_incarnation_id,generation,result,operation_kind,
              target_envelope_kind,scope_digest,zone_digest,target_public_proof,
              source_intent_id,burn_reason,created_at)
             SELECT workspace_id,connection_incarnation_id,target_generation,?1,
                    operation_kind,target_envelope_kind,scope_digest,zone_digest,
                    target_public_proof,intent_id,?2,?3
               FROM cloudflare_credential_intents
              WHERE workspace_id=?4 AND connection_incarnation_id=?5 AND intent_id=?6
                AND phase IN ('keychain_write_started','recovery_required')",
            params![
                ledger_result,
                burn_reason,
                updated_at,
                workspace_id,
                connection_incarnation_id,
                intent_id,
            ],
        )
        .map_err(|_| BusinessDatabaseError::MutationStale)?;
    let update_known = matches!(
        resolution,
        CloudflareCredentialResolution::Confirmed
            | CloudflareCredentialResolution::TargetPresentAuthorityStaleBurned
    );
    let changed = transaction
        .execute(
            "UPDATE cloudflare_credential_roots
                SET highest_resolved_generation=?1,head_ledger_generation=?1,
                    known_envelope_kind=CASE WHEN ?2 THEN ?3 ELSE known_envelope_kind END,
                    known_envelope_generation=CASE WHEN ?2 THEN ?1 ELSE known_envelope_generation END,
                    known_scope_digest=CASE WHEN ?2 THEN ?4 ELSE known_scope_digest END,
                    known_zone_digest=CASE WHEN ?2 THEN ?5 ELSE known_zone_digest END,
                    known_public_proof=CASE WHEN ?2 THEN ?6 ELSE known_public_proof END,
                    updated_at=?7
              WHERE workspace_id=?8 AND connection_incarnation_id=?9
                AND highest_resolved_generation=?10",
            params![
                to_i64(intent.target_generation)?,
                update_known,
                envelope_kind(intent.target.kind),
                intent.target.scope_digest,
                intent.target.zone_digest,
                intent.target.public_proof,
                updated_at,
                workspace_id,
                connection_incarnation_id,
                to_i64(intent.expected_head_generation)?,
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if changed != 1 {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}

fn finalize_staged_observation(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    logical_connection_id: &str,
    intent: &IntentRow,
    resolution: CloudflareCredentialResolution,
    updated_at: &str,
) -> Result<(), BusinessDatabaseError> {
    let Some(staged_batch_id) = intent.staged_batch_id.as_deref() else {
        return Ok(());
    };
    let visibility = if resolution == CloudflareCredentialResolution::Confirmed {
        commit_staged_observation(
            transaction,
            workspace_id,
            logical_connection_id,
            staged_batch_id,
        )?;
        "committed"
    } else {
        "discarded"
    };
    transaction
        .execute(
            "UPDATE cloudflare_dns_staged_batches
                SET visibility=?1,updated_at=?2
              WHERE workspace_id=?3 AND staged_batch_id=?4 AND visibility='staged'",
            params![visibility, updated_at, workspace_id, staged_batch_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

fn consume_credential_intent(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    connection_incarnation_id: &str,
    intent_id: &str,
    updated_at: &str,
) -> Result<(), BusinessDatabaseError> {
    transaction
        .execute(
            "UPDATE cloudflare_credential_intents SET phase='consumed',updated_at=?1
              WHERE workspace_id=?2 AND connection_incarnation_id=?3 AND intent_id=?4
                AND phase IN ('keychain_write_started','recovery_required')",
            params![
                updated_at,
                workspace_id,
                connection_incarnation_id,
                intent_id
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

fn validate_preparation(
    input: &CloudflareCredentialPreparation,
) -> Result<(), BusinessDatabaseError> {
    for value in [
        &input.logical_connection_id,
        &input.connection_incarnation_id,
        &input.display_label,
        &input.intent_id,
    ] {
        validate_local_text(value)?;
    }
    for digest in [
        &input.scope_digest,
        &input.zone_digest,
        &input.target_public_proof,
        &input.prepared_authority_snapshot_digest,
    ] {
        validate_sha256_hex(digest)?;
    }
    validate_timestamp(Some(input.prepared_at.clone()))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if input.target_generation != input.expected_head_generation.saturating_add(1)
        || input.target_generation > MAX_SAFE_INTEGER
        || (input.operation_kind == CloudflareCredentialOperationKind::Provision)
            != input.staged_observation.is_some()
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    if let Some(stage) = &input.staged_observation {
        validate_stage(stage)?;
    }
    Ok(())
}

fn validate_stage(
    stage: &CloudflareCredentialStagedObservation,
) -> Result<(), BusinessDatabaseError> {
    for value in [
        &stage.staged_batch_id,
        &stage.observation_id,
        &stage.observation_run_id,
        &stage.entity_id,
        &stage.zone_name_ascii,
        &stage.provider_version_token,
    ] {
        validate_local_text(value)?;
    }
    validate_domain_asset_id(&stage.entity_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_sha256_hex(&stage.observation_digest)?;
    validate_timestamp(Some(stage.observed_at.clone()))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if !is_uuid_v4(&stage.observation_id)
        || !is_uuid_v4(&stage.observation_run_id)
        || !(1..=MAX_SAFE_INTEGER).contains(&stage.lease_epoch)
        || stage.records.len() > 1_024
        || stage.authoritative_nameservers.len() > 32
        || stage
            .authoritative_nameservers
            .iter()
            .any(|value| value.is_empty() || value.len() > 253)
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    if stage.availability == "unavailable" {
        if stage.zone_status != "unknown" || !stage.records.is_empty() {
            return Err(BusinessDatabaseError::InvalidInput);
        }
    } else if stage.availability != "available"
        || !matches!(stage.zone_status.as_str(), "active" | "pending")
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    for record in &stage.records {
        validate_local_text(&record.record_key)?;
        validate_local_text(&record.record_type)?;
        validate_local_text(&record.owner_name_ascii)?;
        validate_local_text(&record.canonical_value)?;
        if !matches!(
            record.record_type.to_ascii_lowercase().as_str(),
            "a" | "aaaa" | "cname" | "txt"
        ) || (record.proxied == Some(true)
            && !matches!(
                record.record_type.to_ascii_lowercase().as_str(),
                "a" | "aaaa" | "cname"
            ))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
    }
    if stage.observation_digest != staged_observation_digest(stage)? {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn staged_observation_digest(
    stage: &CloudflareCredentialStagedObservation,
) -> Result<String, BusinessDatabaseError> {
    let mut records = stage.records.clone();
    records.sort_by(|left, right| left.record_key.cmp(&right.record_key));
    let records = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "recordKey": record.record_key,
                "recordType": record.record_type,
                "ownerNameAscii": record.owner_name_ascii,
                "ttlSeconds": record.ttl_seconds,
                "priority": record.priority,
                "canonicalValue": record.canonical_value,
                "proxied": record.proxied,
            })
        })
        .collect::<Vec<_>>();
    let value = serde_json::json!({
        "schemaVersion": 1,
        "observationId": stage.observation_id,
        "observationRunId": stage.observation_run_id,
        "entityId": stage.entity_id,
        "leaseEpoch": stage.lease_epoch,
        "observedAt": stage.observed_at,
        "zoneNameAscii": stage.zone_name_ascii,
        "authoritativeNameservers": stage.authoritative_nameservers,
        "dnssecStatus": stage.dnssec_status,
        "availability": stage.availability,
        "zoneStatus": stage.zone_status,
        "records": records,
        "providerVersionToken": stage.provider_version_token,
    });
    let canonical = serde_json::to_vec(&value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    Ok(hex_digest(&canonical))
}

fn insert_staged_observation(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    input: &CloudflareCredentialPreparation,
    stage: &CloudflareCredentialStagedObservation,
) -> Result<(), BusinessDatabaseError> {
    let nameservers = serde_json::to_string(&stage.authoritative_nameservers)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    transaction
        .execute(
            "INSERT INTO cloudflare_dns_staged_batches
             (workspace_id,connection_incarnation_id,staged_batch_id,source_intent_id,
              observation_id,observation_run_id,entity_id,lease_epoch,scope_digest,
              zone_digest,observation_digest,observed_at,zone_name_ascii,
              authoritative_nameservers_json,dnssec_status,observation_availability,
              cloudflare_zone_status,provider_version_token,visibility,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,
                     ?16,?17,?18,'staged',?19,?19)",
            params![
                workspace_id,
                input.connection_incarnation_id,
                stage.staged_batch_id,
                input.intent_id,
                stage.observation_id,
                stage.observation_run_id,
                stage.entity_id,
                to_i64(stage.lease_epoch)?,
                input.scope_digest,
                input.zone_digest,
                stage.observation_digest,
                stage.observed_at,
                stage.zone_name_ascii,
                nameservers,
                stage.dnssec_status,
                stage.availability,
                stage.zone_status,
                stage.provider_version_token,
                input.prepared_at,
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for record in &stage.records {
        transaction
            .execute(
                "INSERT INTO cloudflare_dns_staged_records
                 (workspace_id,staged_batch_id,record_key,record_type,owner_name_ascii,
                  ttl_seconds,priority,canonical_value,proxied)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    workspace_id,
                    stage.staged_batch_id,
                    record.record_key,
                    record.record_type,
                    record.owner_name_ascii,
                    record.ttl_seconds.map(i64::from),
                    record.priority.map(i64::from),
                    record.canonical_value,
                    record.proxied.map(i64::from),
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    Ok(())
}

fn load_intent(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    incarnation_id: &str,
    intent_id: &str,
) -> Result<IntentRow, BusinessDatabaseError> {
    transaction
        .query_row(
            "SELECT operation_kind,expected_head_generation,target_generation,
                    target_envelope_kind,scope_digest,zone_digest,target_public_proof,
                    marker_base_envelope_kind,marker_base_generation,
                    marker_base_scope_digest,marker_base_zone_digest,
                    marker_base_public_proof,staged_batch_id,
                    prepared_authority_snapshot_digest
               FROM cloudflare_credential_intents
              WHERE workspace_id=?1 AND connection_incarnation_id=?2 AND intent_id=?3
                AND phase IN ('keychain_write_started','recovery_required')
                AND marker_base_recorded=1",
            params![workspace_id, incarnation_id, intent_id],
            |row| {
                let target_generation = u64::try_from(row.get::<_, i64>(2)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                let base_kind = row.get::<_, String>(7)?;
                Ok(IntentRow {
                    operation_kind: parse_operation(&row.get::<_, String>(0)?)?,
                    expected_head_generation: u64::try_from(row.get::<_, i64>(1)?)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?,
                    target_generation,
                    target: CloudflareCredentialWitness {
                        kind: parse_envelope(&row.get::<_, String>(3)?)?,
                        generation: Some(target_generation),
                        scope_digest: Some(row.get(4)?),
                        zone_digest: Some(row.get(5)?),
                        public_proof: Some(row.get(6)?),
                    },
                    base: witness_from_columns(
                        &base_kind,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                        row.get(11)?,
                    )?,
                    staged_batch_id: row.get(12)?,
                    prepared_authority_snapshot_digest: row.get(13)?,
                })
            },
        )
        .map_err(|_| BusinessDatabaseError::MutationStale)
}

fn apply_resolution_publication(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    logical_connection_id: &str,
    intent: &IntentRow,
    resolution: CloudflareCredentialResolution,
    authority_current: bool,
    updated_at: &str,
) -> Result<(), BusinessDatabaseError> {
    match resolution {
        CloudflareCredentialResolution::Confirmed
            if intent.operation_kind == CloudflareCredentialOperationKind::Provision =>
        {
            transaction.execute(
                "UPDATE local_provider_connections
                    SET credential_use_state='active',active_credential_generation=?1,
                        active_credential_scope_digest=?2,active_credential_zone_digest=?3,
                        active_credential_public_proof=?4,lifecycle_status='active',
                        validation_status='valid',last_validated_at=?5,
                        active_credential_changed_at=?5
                  WHERE workspace_id=?6 AND connection_id=?7",
                params![
                    to_i64(intent.target_generation)?,
                    intent.target.scope_digest,
                    intent.target.zone_digest,
                    intent.target.public_proof,
                    updated_at,
                    workspace_id,
                    logical_connection_id
                ],
            )
        }
        CloudflareCredentialResolution::Confirmed => transaction.execute(
            "UPDATE local_provider_connections
                SET credential_use_state='revoked',active_credential_generation=NULL,
                    active_credential_scope_digest=NULL,active_credential_zone_digest=NULL,
                    active_credential_public_proof=NULL,lifecycle_status='revoked',
                    validation_status='unknown',revoked_at=?1,active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_id=?3",
            params![updated_at, workspace_id, logical_connection_id],
        ),
        CloudflareCredentialResolution::TargetNotObservedBurned
            if intent.operation_kind == CloudflareCredentialOperationKind::Provision
                && authority_current
                && connection_publication(transaction, workspace_id, logical_connection_id)?
                    .as_ref()
                    == Some(&intent.base) =>
        {
            transaction.execute(
                "UPDATE local_provider_connections
                SET credential_use_state='active',lifecycle_status='active',
                    validation_status='valid',active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_id=?3",
                params![updated_at, workspace_id, logical_connection_id],
            )
        }
        CloudflareCredentialResolution::TargetNotObservedBurned
            if intent.operation_kind == CloudflareCredentialOperationKind::Revoke =>
        {
            transaction.execute(
                "UPDATE local_provider_connections
                SET credential_use_state='revoked',active_credential_generation=NULL,
                    active_credential_scope_digest=NULL,active_credential_zone_digest=NULL,
                    active_credential_public_proof=NULL,lifecycle_status='revoked',
                    validation_status='unknown',revoked_at=?1,active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_id=?3",
                params![updated_at, workspace_id, logical_connection_id],
            )
        }
        _ => transaction.execute(
            "UPDATE local_provider_connections
                SET credential_use_state='remediation_required',active_credential_generation=NULL,
                    active_credential_scope_digest=NULL,active_credential_zone_digest=NULL,
                    active_credential_public_proof=NULL,lifecycle_status='invalid',
                    validation_status='unknown',active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_id=?3",
            params![updated_at, workspace_id, logical_connection_id],
        ),
    }
    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

#[allow(clippy::too_many_lines)]
fn commit_staged_observation(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    connection_id: &str,
    staged_batch_id: &str,
) -> Result<(), BusinessDatabaseError> {
    let batch = transaction
        .query_row(
            "SELECT observation_id,observation_run_id,entity_id,lease_epoch,observed_at,
                zone_name_ascii,authoritative_nameservers_json,dnssec_status,
                observation_availability,cloudflare_zone_status,provider_version_token,
                observation_digest
           FROM cloudflare_dns_staged_batches
          WHERE workspace_id=?1 AND staged_batch_id=?2 AND visibility='staged'",
            params![workspace_id, staged_batch_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                ))
            },
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let mut records = Vec::new();
    let mut statement = transaction.prepare("SELECT record_key,record_type,owner_name_ascii,ttl_seconds,priority,canonical_value,proxied FROM cloudflare_dns_staged_records WHERE workspace_id=?1 AND staged_batch_id=?2 ORDER BY record_key").map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let rows = statement
        .query_map(params![workspace_id, staged_batch_id], |row| {
            Ok(CloudflareDnsRecordWrite {
                record_key: row.get(0)?,
                record_type: row.get(1)?,
                owner_name_ascii: row.get(2)?,
                ttl_seconds: row
                    .get::<_, Option<i64>>(3)?
                    .map(|v| u32::try_from(v).map_err(|_| rusqlite::Error::InvalidQuery))
                    .transpose()?,
                priority: row
                    .get::<_, Option<i64>>(4)?
                    .map(|v| u16::try_from(v).map_err(|_| rusqlite::Error::InvalidQuery))
                    .transpose()?,
                canonical_value: row.get(5)?,
                proxied: row.get::<_, Option<i64>>(6)?.map(|v| v != 0),
            })
        })
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for row in rows {
        records.push(row.map_err(|_| BusinessDatabaseError::StorageRejected)?);
    }
    drop(statement);
    let mut counts = serde_json::Map::from_iter([
        ("a".to_owned(), serde_json::Value::from(0)),
        ("aaaa".to_owned(), serde_json::Value::from(0)),
        ("cname".to_owned(), serde_json::Value::from(0)),
        ("txt".to_owned(), serde_json::Value::from(0)),
        ("proxied".to_owned(), serde_json::Value::from(0)),
    ]);
    for record in &records {
        let key = record.record_type.to_ascii_lowercase();
        *counts
            .get_mut(&key)
            .ok_or(BusinessDatabaseError::StorageRejected)? =
            serde_json::Value::from(counts[&key].as_u64().unwrap_or(0) + 1);
        if record.proxied == Some(true) {
            *counts
                .get_mut("proxied")
                .ok_or(BusinessDatabaseError::StorageRejected)? =
                serde_json::Value::from(counts["proxied"].as_u64().unwrap_or(0) + 1);
        }
    }
    let counts = if batch.8 == "unavailable" {
        serde_json::json!({"a":null,"aaaa":null,"cname":null,"txt":null,"proxied":null})
    } else {
        serde_json::Value::Object(counts)
    };
    let prior: Option<(i64,i64)>=transaction.query_row("SELECT lease_epoch,source_sequence FROM cloudflare_dns_source_heads WHERE workspace_id=?1 AND entity_id=?2",params![workspace_id,batch.2],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|_|BusinessDatabaseError::StorageRejected)?;
    let source = prior.map_or(1, |(epoch, sequence)| match batch.3.cmp(&epoch) {
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Equal => sequence.saturating_add(1),
        std::cmp::Ordering::Less => 0,
    });
    if !(1..=9_007_199_254_740_991_i64).contains(&source) {
        return Err(BusinessDatabaseError::MutationStale);
    }
    let projection = serde_json::json!({"schemaVersion":1,"providerKind":"cloudflare","observationCapability":"dns","observationId":batch.0,"entityId":batch.2,"leaseEpoch":batch.3,"sourceSequence":source,"observedAt":batch.4,"availability":batch.8,"zoneStatus":batch.9,"counts":counts});
    let projection_json =
        serde_json::to_string(&projection).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let projection_digest = canonical_cloudflare_projection_digest(&projection)?;
    transaction.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES (?1,?2,?3,'dns',?4,'running')",params![workspace_id,batch.1,connection_id,batch.4]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    transaction.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES (?1,?2,?3,0,'requested',?4)",params![workspace_id,batch.1,batch.2,batch.4]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    transaction.execute("INSERT INTO dns_zone_observations (workspace_id,zone_observation_id,observation_run_id,entity_id,zone_name_ascii,authoritative_nameservers_json,dnssec_status,observation_availability,evidence_status,observed_at,provider_version_token,normalized_evidence_sha256,cloudflare_zone_status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'confirmed',?9,?10,?11,?12)",params![workspace_id,batch.0,batch.1,batch.2,batch.5,batch.6,batch.7,batch.8,batch.4,batch.10,batch.11,batch.9]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    for record in &records {
        transaction.execute("INSERT INTO dns_record_observations (workspace_id,zone_observation_id,record_key,record_type,owner_name_ascii,ttl_seconds,priority,canonical_value,proxied) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![workspace_id,batch.0,record.record_key,record.record_type,record.owner_name_ascii,record.ttl_seconds.map(i64::from),record.priority.map(i64::from),record.canonical_value,record.proxied.map(i64::from)]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    }
    transaction.execute("UPDATE provider_observation_targets SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3 AND entity_id=?4 AND status='requested'",params![batch.4,workspace_id,batch.1,batch.2]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    transaction.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3 AND status='running'",params![batch.4,workspace_id,batch.1]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    transaction.execute("INSERT INTO cloudflare_dns_source_heads (workspace_id,entity_id,lease_epoch,source_sequence,updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET lease_epoch=excluded.lease_epoch,source_sequence=excluded.source_sequence,updated_at=excluded.updated_at",params![workspace_id,batch.2,batch.3,source,batch.4]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    transaction.execute("INSERT INTO cloudflare_dns_projection_outbox (workspace_id,observation_id,entity_id,lease_epoch,source_sequence,observed_at,projection_json,canonical_request_digest,state) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending')",params![workspace_id,batch.0,batch.2,batch.3,source,batch.4,projection_json,projection_digest]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    transaction.execute("INSERT INTO cloudflare_dns_projection_heads (workspace_id,entity_id,lease_epoch,source_sequence,observation_id,observed_at,projection_digest,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?6) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET lease_epoch=excluded.lease_epoch,source_sequence=excluded.source_sequence,observation_id=excluded.observation_id,observed_at=excluded.observed_at,projection_digest=excluded.projection_digest,updated_at=excluded.updated_at",params![workspace_id,batch.2,batch.3,source,batch.0,batch.4,projection_digest]).map_err(|_|BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

fn connection_publication(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    connection_id: &str,
) -> Result<Option<CloudflareCredentialWitness>, BusinessDatabaseError> {
    transaction.query_row("SELECT active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2 AND active_credential_generation IS NOT NULL",params![workspace_id,connection_id],|row|Ok(CloudflareCredentialWitness{kind:CloudflareCredentialEnvelopeKind::Active,generation:Some(u64::try_from(row.get::<_,i64>(0)?).map_err(|_|rusqlite::Error::InvalidQuery)?),scope_digest:Some(row.get(1)?),zone_digest:Some(row.get(2)?),public_proof:Some(row.get(3)?)})).optional().map_err(|_|BusinessDatabaseError::StorageRejected)
}

fn publication_matches_root(
    root: &CloudflareCredentialWitness,
    publication: Option<&CloudflareCredentialWitness>,
) -> bool {
    match root.kind {
        CloudflareCredentialEnvelopeKind::Active => publication == Some(root),
        CloudflareCredentialEnvelopeKind::Absent | CloudflareCredentialEnvelopeKind::Tombstone => {
            publication.is_none()
        }
    }
}

fn validate_witness(witness: &CloudflareCredentialWitness) -> Result<(), BusinessDatabaseError> {
    match witness.kind {
        CloudflareCredentialEnvelopeKind::Absent
            if witness.generation.is_none()
                && witness.scope_digest.is_none()
                && witness.zone_digest.is_none()
                && witness.public_proof.is_none() =>
        {
            Ok(())
        }
        CloudflareCredentialEnvelopeKind::Active | CloudflareCredentialEnvelopeKind::Tombstone
            if witness
                .generation
                .is_some_and(|value| (1..=MAX_SAFE_INTEGER).contains(&value))
                && witness
                    .scope_digest
                    .as_deref()
                    .is_some_and(|value| validate_sha256_hex(value).is_ok())
                && witness
                    .zone_digest
                    .as_deref()
                    .is_some_and(|value| validate_sha256_hex(value).is_ok())
                && witness
                    .public_proof
                    .as_deref()
                    .is_some_and(|value| validate_sha256_hex(value).is_ok()) =>
        {
            Ok(())
        }
        _ => Err(BusinessDatabaseError::InvalidInput),
    }
}

fn witness_from_columns(
    kind: &str,
    generation: Option<i64>,
    scope_digest: Option<String>,
    zone_digest: Option<String>,
    public_proof: Option<String>,
) -> rusqlite::Result<CloudflareCredentialWitness> {
    Ok(CloudflareCredentialWitness {
        kind: parse_envelope(kind)?,
        generation: generation
            .map(|value| u64::try_from(value).map_err(|_| rusqlite::Error::InvalidQuery))
            .transpose()?,
        scope_digest,
        zone_digest,
        public_proof,
    })
}
fn parse_operation(value: &str) -> rusqlite::Result<CloudflareCredentialOperationKind> {
    match value {
        "provision" => Ok(CloudflareCredentialOperationKind::Provision),
        "revoke" => Ok(CloudflareCredentialOperationKind::Revoke),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
fn parse_envelope(value: &str) -> rusqlite::Result<CloudflareCredentialEnvelopeKind> {
    match value {
        "absent" => Ok(CloudflareCredentialEnvelopeKind::Absent),
        "active" => Ok(CloudflareCredentialEnvelopeKind::Active),
        "tombstone" => Ok(CloudflareCredentialEnvelopeKind::Tombstone),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
const fn operation_kind(value: CloudflareCredentialOperationKind) -> &'static str {
    match value {
        CloudflareCredentialOperationKind::Provision => "provision",
        CloudflareCredentialOperationKind::Revoke => "revoke",
    }
}
const fn target_kind(value: CloudflareCredentialOperationKind) -> &'static str {
    match value {
        CloudflareCredentialOperationKind::Provision => "active",
        CloudflareCredentialOperationKind::Revoke => "tombstone",
    }
}
const fn envelope_kind(value: CloudflareCredentialEnvelopeKind) -> &'static str {
    match value {
        CloudflareCredentialEnvelopeKind::Absent => "absent",
        CloudflareCredentialEnvelopeKind::Active => "active",
        CloudflareCredentialEnvelopeKind::Tombstone => "tombstone",
    }
}

const fn prewrite_failure_reason(reason: CloudflarePrewriteFailureReason) -> &'static str {
    match reason {
        CloudflarePrewriteFailureReason::BaseMismatch => "keychain_base_mismatch",
        CloudflarePrewriteFailureReason::MissingOther => "keychain_missing_other",
        CloudflarePrewriteFailureReason::Malformed => "keychain_malformed",
        CloudflarePrewriteFailureReason::Unreadable => "keychain_unreadable",
        CloudflarePrewriteFailureReason::Orphaned => "prewrite_orphaned",
    }
}
fn to_i64(value: u64) -> Result<i64, BusinessDatabaseError> {
    i64::try_from(value)
        .ok()
        .filter(|value| {
            *value >= 0
                && u64::try_from(*value)
                    .ok()
                    .is_some_and(|value| value <= MAX_SAFE_INTEGER)
        })
        .ok_or(BusinessDatabaseError::InvalidInput)
}
fn optional_i64(value: Option<u64>) -> Result<Option<i64>, BusinessDatabaseError> {
    value.map(to_i64).transpose()
}

/// Reuses the credential protocol fixture so binding tests consume genuinely committed evidence.
#[cfg(test)]
impl BusinessDatabase {
    pub(crate) fn seed_verified_cloudflare_binding_for_test(&mut self, entity_id: &str) {
        tests::seed_binding(self, entity_id);
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::{DomainAssetWrite, LocalDatabaseKey};

    const AT: &str = "2026-09-16T12:00:00Z";

    fn database() -> BusinessDatabase {
        let directory = tempdir().unwrap().keep();
        let mut database = BusinessDatabase::open(
            &directory.join("workspace.db"),
            &LocalDatabaseKey::from_bytes([0x71; 32]),
            "workspace-local",
        )
        .unwrap();
        database
            .upsert_domain_asset(
                "credential-stage-asset",
                AT,
                &DomainAssetWrite {
                    entity_id: "credential-stage.test".to_owned(),
                    note: None,
                    portfolio_id: None,
                    tags: Vec::new(),
                    target_price: None,
                },
            )
            .unwrap();
        database
    }

    fn stage(sequence: u8) -> CloudflareCredentialStagedObservation {
        let mut stage = CloudflareCredentialStagedObservation {
            staged_batch_id: format!("stage-{sequence}"),
            observation_digest: String::new(),
            observation_id: format!("123e4567-e89b-42d3-a456-4266141740{sequence:02}"),
            observation_run_id: format!("223e4567-e89b-42d3-a456-4266141740{sequence:02}"),
            entity_id: "credential-stage.test".to_owned(),
            lease_epoch: 1,
            observed_at: AT.to_owned(),
            zone_name_ascii: "credential-stage.test".to_owned(),
            authoritative_nameservers: vec!["ns1.example.test".to_owned()],
            dnssec_status: "active".to_owned(),
            availability: "available".to_owned(),
            zone_status: "active".to_owned(),
            records: vec![CloudflareDnsRecordWrite {
                record_key: "a-root".to_owned(),
                record_type: "A".to_owned(),
                owner_name_ascii: "credential-stage.test".to_owned(),
                ttl_seconds: Some(300),
                priority: None,
                canonical_value: "192.0.2.1".to_owned(),
                proxied: Some(true),
            }],
            provider_version_token: format!("provider-version-{sequence}"),
        };
        stage.observation_digest = staged_observation_digest(&stage).unwrap();
        stage
    }

    fn preparation(
        generation: u64,
        staged: CloudflareCredentialStagedObservation,
    ) -> CloudflareCredentialPreparation {
        CloudflareCredentialPreparation {
            logical_connection_id: "cloudflare-primary".to_owned(),
            connection_incarnation_id: "cloudflare-incarnation-1".to_owned(),
            display_label: "Cloudflare DNS".to_owned(),
            intent_id: format!("intent-{generation}"),
            operation_kind: CloudflareCredentialOperationKind::Provision,
            expected_head_generation: generation - 1,
            target_generation: generation,
            scope_digest: "1".repeat(64),
            zone_digest: "2".repeat(64),
            target_public_proof: format!("{generation:064x}"),
            prepared_authority_snapshot_digest: "3".repeat(64),
            staged_observation: Some(staged),
            prepared_at: AT.to_owned(),
        }
    }

    fn target(input: &CloudflareCredentialPreparation) -> CloudflareCredentialWitness {
        CloudflareCredentialWitness {
            kind: CloudflareCredentialEnvelopeKind::Active,
            generation: Some(input.target_generation),
            scope_digest: Some(input.scope_digest.clone()),
            zone_digest: Some(input.zone_digest.clone()),
            public_proof: Some(input.target_public_proof.clone()),
        }
    }

    pub(super) fn seed_binding(database: &mut BusinessDatabase, entity_id: &str) {
        let mut staged = stage(1);
        staged.entity_id = entity_id.to_owned();
        staged.zone_name_ascii = entity_id.to_owned();
        staged.records[0].owner_name_ascii = entity_id.to_owned();
        staged.observation_digest = staged_observation_digest(&staged).unwrap();
        let input = preparation(1, staged);
        let result = provision(
            database,
            &input,
            &CloudflareCredentialWitness::absent(),
            true,
            &CloudflareCredentialRecoveryObservation::Canonical(target(&input)),
        );
        assert_eq!(result, CloudflareCredentialResolution::Confirmed);
    }

    fn revoke_preparation(
        active: &CloudflareCredentialPreparation,
    ) -> CloudflareCredentialPreparation {
        CloudflareCredentialPreparation {
            logical_connection_id: active.logical_connection_id.clone(),
            connection_incarnation_id: active.connection_incarnation_id.clone(),
            display_label: active.display_label.clone(),
            intent_id: "intent-revoke-2".to_owned(),
            operation_kind: CloudflareCredentialOperationKind::Revoke,
            expected_head_generation: 1,
            target_generation: 2,
            scope_digest: active.scope_digest.clone(),
            zone_digest: active.zone_digest.clone(),
            target_public_proof: "4".repeat(64),
            prepared_authority_snapshot_digest: "5".repeat(64),
            staged_observation: None,
            prepared_at: AT.to_owned(),
        }
    }

    fn provision(
        database: &mut BusinessDatabase,
        input: &CloudflareCredentialPreparation,
        _base: &CloudflareCredentialWitness,
        authority_current: bool,
        observed: &CloudflareCredentialRecoveryObservation,
    ) -> CloudflareCredentialResolution {
        let current_authority = if authority_current {
            input.prepared_authority_snapshot_digest.clone()
        } else {
            "4".repeat(64)
        };
        assert_eq!(
            database
                .prepare_cloudflare_credential_operation_guarded(input, || Ok(()))
                .unwrap(),
            CloudflareCredentialPreparationDisposition::Prepared
        );
        database
            .begin_cloudflare_prewrite_inspection_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                &input.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
        database
            .mark_cloudflare_keychain_write_started_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                &input.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
        database
            .resolve_cloudflare_credential_operation_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                observed,
                &current_authority,
                AT,
                || Ok(()),
            )
            .unwrap()
    }

    fn prepare_and_begin_prewrite(
        database: &mut BusinessDatabase,
        input: &CloudflareCredentialPreparation,
    ) {
        database
            .prepare_cloudflare_credential_operation_guarded(input, || Ok(()))
            .unwrap();
        database
            .begin_cloudflare_prewrite_inspection_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                &input.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
    }

    #[test]
    fn genesis_has_virtual_zero_without_ledger_and_confirmed_target_commits_everything() {
        let mut database = database();
        let input = preparation(1, stage(1));
        database
            .prepare_cloudflare_credential_operation_guarded(&input, || Ok(()))
            .unwrap();
        let genesis: (i64, Option<i64>, String, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT highest_resolved_generation,head_ledger_generation,
                        known_envelope_kind,
                        (SELECT count(*) FROM cloudflare_credential_generation_ledger)
                   FROM cloudflare_credential_roots",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(genesis, (0, None, "absent".to_owned(), 0));
        database
            .begin_cloudflare_prewrite_inspection_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                &input.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
        database
            .mark_cloudflare_keychain_write_started_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                &input.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
        assert_eq!(
            database
                .resolve_cloudflare_credential_operation_guarded(
                    &input.connection_incarnation_id,
                    &input.intent_id,
                    &CloudflareCredentialRecoveryObservation::Canonical(target(&input)),
                    &input.prepared_authority_snapshot_digest,
                    AT,
                    || Ok(()),
                )
                .unwrap(),
            CloudflareCredentialResolution::Confirmed
        );
        let state: (i64, i64, String, String, String, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT r.highest_resolved_generation,r.head_ledger_generation,
                        r.known_envelope_kind,c.credential_use_state,b.visibility,
                        (SELECT count(*) FROM dns_zone_observations),
                        (SELECT count(*) FROM cloudflare_dns_projection_outbox)
                   FROM cloudflare_credential_roots r
                   JOIN local_provider_connections c
                     ON c.workspace_id=r.workspace_id
                    AND c.connection_id=r.logical_connection_id
                   JOIN cloudflare_dns_staged_batches b
                     ON b.workspace_id=r.workspace_id",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            state,
            (
                1,
                1,
                "active".to_owned(),
                "active".to_owned(),
                "committed".to_owned(),
                1,
                1
            )
        );
    }

    #[test]
    fn exact_base_burns_when_base_equals_head_and_when_base_is_below_head() {
        let mut database = database();
        let first = preparation(1, stage(1));
        assert_eq!(
            provision(
                &mut database,
                &first,
                &CloudflareCredentialWitness::absent(),
                true,
                &CloudflareCredentialRecoveryObservation::Canonical(target(&first)),
            ),
            CloudflareCredentialResolution::Confirmed
        );
        let base = target(&first);
        let second = preparation(2, stage(2));
        assert_eq!(
            provision(
                &mut database,
                &second,
                &base,
                true,
                &CloudflareCredentialRecoveryObservation::Canonical(base.clone()),
            ),
            CloudflareCredentialResolution::TargetNotObservedBurned
        );
        let third = preparation(3, stage(3));
        assert_eq!(
            provision(
                &mut database,
                &third,
                &base,
                true,
                &CloudflareCredentialRecoveryObservation::Canonical(base.clone()),
            ),
            CloudflareCredentialResolution::TargetNotObservedBurned
        );
        let result: (i64, i64, String, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT highest_resolved_generation,known_envelope_generation,
                        credential_use_state,
                        (SELECT count(*) FROM cloudflare_credential_generation_ledger
                          WHERE result='burned' AND burn_reason='target_not_observed')
                   FROM cloudflare_credential_roots
                   JOIN local_provider_connections
                     ON local_provider_connections.workspace_id=cloudflare_credential_roots.workspace_id
                    AND local_provider_connections.connection_id=cloudflare_credential_roots.logical_connection_id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(result, (3, 1, "active".to_owned(), 2));
    }

    #[test]
    fn exact_target_with_stale_authority_burns_and_requires_remediation() {
        let mut database = database();
        let input = preparation(1, stage(1));
        assert_eq!(
            provision(
                &mut database,
                &input,
                &CloudflareCredentialWitness::absent(),
                false,
                &CloudflareCredentialRecoveryObservation::Canonical(target(&input)),
            ),
            CloudflareCredentialResolution::TargetPresentAuthorityStaleBurned
        );
        let state: (i64, String, String, String) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT highest_resolved_generation,known_envelope_kind,
                        credential_use_state,burn_reason
                   FROM cloudflare_credential_roots
                   JOIN local_provider_connections
                     ON local_provider_connections.workspace_id=cloudflare_credential_roots.workspace_id
                    AND local_provider_connections.connection_id=cloudflare_credential_roots.logical_connection_id
                   JOIN cloudflare_credential_generation_ledger USING (workspace_id,connection_incarnation_id)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            state,
            (
                1,
                "active".to_owned(),
                "remediation_required".to_owned(),
                "target_present_authority_stale".to_owned()
            )
        );
    }

    #[test]
    fn every_non_exact_or_unreadable_observation_enters_recovery_without_head_advance() {
        for (index, observation) in [
            CloudflareCredentialRecoveryObservation::Malformed,
            CloudflareCredentialRecoveryObservation::Unreadable,
            CloudflareCredentialRecoveryObservation::Canonical(CloudflareCredentialWitness {
                kind: CloudflareCredentialEnvelopeKind::Tombstone,
                generation: Some(9),
                scope_digest: Some("1".repeat(64)),
                zone_digest: Some("2".repeat(64)),
                public_proof: Some("9".repeat(64)),
            }),
        ]
        .into_iter()
        .enumerate()
        {
            let mut database = database();
            let input = preparation(1, stage(u8::try_from(index + 1).unwrap()));
            database
                .prepare_cloudflare_credential_operation_guarded(&input, || Ok(()))
                .unwrap();
            database
                .begin_cloudflare_prewrite_inspection_guarded(
                    &input.connection_incarnation_id,
                    &input.intent_id,
                    &input.prepared_authority_snapshot_digest,
                    AT,
                    || Ok(()),
                )
                .unwrap();
            database
                .mark_cloudflare_keychain_write_started_guarded(
                    &input.connection_incarnation_id,
                    &input.intent_id,
                    &input.prepared_authority_snapshot_digest,
                    AT,
                    || Ok(()),
                )
                .unwrap();
            assert_eq!(
                database
                    .resolve_cloudflare_credential_operation_guarded(
                        &input.connection_incarnation_id,
                        &input.intent_id,
                        &observation,
                        &input.prepared_authority_snapshot_digest,
                        AT,
                        || Ok(()),
                    )
                    .unwrap(),
                CloudflareCredentialResolution::RecoveryRequired
            );
            let state: (i64, i64, String) = database.store.raw_connection().query_row("SELECT highest_resolved_generation,(SELECT count(*) FROM cloudflare_credential_generation_ledger),(SELECT phase FROM cloudflare_credential_intents) FROM cloudflare_credential_roots",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
            assert_eq!(state, (0, 0, "recovery_required".to_owned()));
        }
    }

    #[test]
    fn missing_is_exact_base_only_when_the_marker_witnessed_absence() {
        let mut absent_database = database();
        let first = preparation(1, stage(1));
        assert_eq!(
            provision(
                &mut absent_database,
                &first,
                &CloudflareCredentialWitness::absent(),
                true,
                &CloudflareCredentialRecoveryObservation::Missing,
            ),
            CloudflareCredentialResolution::TargetNotObservedBurned
        );

        let mut canonical_database = database();
        let confirmed = preparation(1, stage(1));
        provision(
            &mut canonical_database,
            &confirmed,
            &CloudflareCredentialWitness::absent(),
            true,
            &CloudflareCredentialRecoveryObservation::Canonical(target(&confirmed)),
        );
        let next = preparation(2, stage(2));
        assert_eq!(
            provision(
                &mut canonical_database,
                &next,
                &target(&confirmed),
                true,
                &CloudflareCredentialRecoveryObservation::Missing,
            ),
            CloudflareCredentialResolution::RecoveryRequired
        );
    }

    #[test]
    fn prewrite_commit_denies_use_without_advancing_head_or_ledger() {
        let mut database = database();
        let input = preparation(1, stage(1));
        database
            .prepare_cloudflare_credential_operation_guarded(&input, || Ok(()))
            .unwrap();
        database
            .begin_cloudflare_prewrite_inspection_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                &input.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
        let state: (String, String, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT i.phase,c.credential_use_state,r.highest_resolved_generation,
                    (SELECT count(*) FROM cloudflare_credential_generation_ledger)
               FROM cloudflare_credential_intents i
               JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
               JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            state,
            (
                "prewrite_inspection_started".to_owned(),
                "transition_pending".to_owned(),
                0,
                0
            )
        );
    }

    #[test]
    fn prepared_orphan_is_cancelled_without_keychain_or_generation_effects() {
        let mut database = database();
        let input = preparation(1, stage(1));
        database
            .prepare_cloudflare_credential_operation_guarded(&input, || Ok(()))
            .unwrap();
        assert_eq!(
            database
                .recover_cloudflare_credential_orphans_guarded(AT, || Ok(()))
                .unwrap(),
            1
        );
        let state: (String, String, String, String, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT i.phase,i.terminal_reason,c.credential_use_state,b.visibility,
                        r.highest_resolved_generation,
                        (SELECT count(*) FROM cloudflare_credential_generation_ledger)
                   FROM cloudflare_credential_intents i
                   JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
                   JOIN local_provider_connections c
                     ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
                   JOIN cloudflare_dns_staged_batches b
                     ON b.workspace_id=i.workspace_id AND b.staged_batch_id=i.staged_batch_id",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            state,
            (
                "cancelled".to_owned(),
                "cancelled_before_inspection".to_owned(),
                "inactive".to_owned(),
                "discarded".to_owned(),
                0,
                0
            )
        );
    }

    #[test]
    fn prewrite_mismatch_is_atomic_and_failed_commit_remains_sticky() {
        let mut database = database();
        let input = preparation(1, stage(1));
        prepare_and_begin_prewrite(&mut database, &input);
        assert_eq!(
            database.cancel_cloudflare_prewrite_for_remediation_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                CloudflarePrewriteFailureReason::BaseMismatch,
                AT,
                || Err(BusinessDatabaseError::MutationStale)
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        let sticky: (String, String, String, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT i.phase,c.credential_use_state,b.visibility,r.highest_resolved_generation,
                    (SELECT count(*) FROM cloudflare_credential_generation_ledger)
               FROM cloudflare_credential_intents i
               JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
               JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
               JOIN cloudflare_dns_staged_batches b
                 ON b.workspace_id=i.workspace_id AND b.staged_batch_id=i.staged_batch_id",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            sticky,
            (
                "prewrite_inspection_started".to_owned(),
                "transition_pending".to_owned(),
                "staged".to_owned(),
                0,
                0
            )
        );
        database
            .cancel_cloudflare_prewrite_for_remediation_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                CloudflarePrewriteFailureReason::BaseMismatch,
                AT,
                || Ok(()),
            )
            .unwrap();
        let terminal: (String, String, String, String, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT i.phase,i.terminal_reason,c.credential_use_state,b.visibility,
                    r.highest_resolved_generation,
                    (SELECT count(*) FROM cloudflare_credential_generation_ledger)
               FROM cloudflare_credential_intents i
               JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
               JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
               JOIN cloudflare_dns_staged_batches b
                 ON b.workspace_id=i.workspace_id AND b.staged_batch_id=i.staged_batch_id",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            terminal,
            (
                "cancelled".to_owned(),
                "keychain_base_mismatch".to_owned(),
                "remediation_required".to_owned(),
                "discarded".to_owned(),
                0,
                0
            )
        );
    }

    #[test]
    fn orphaned_prewrite_and_marker_failure_never_restore_active_use() {
        let mut database = database();
        let input = preparation(1, stage(1));
        prepare_and_begin_prewrite(&mut database, &input);
        assert_eq!(
            database.mark_cloudflare_keychain_write_started_guarded(
                &input.connection_incarnation_id,
                &input.intent_id,
                &input.prepared_authority_snapshot_digest,
                AT,
                || Err(BusinessDatabaseError::MutationStale)
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            database
                .recover_cloudflare_credential_orphans_guarded(AT, || Ok(()))
                .unwrap(),
            1
        );
        let state: (String, String, String, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT i.phase,i.terminal_reason,c.credential_use_state,
                    (SELECT count(*) FROM cloudflare_credential_generation_ledger)
               FROM cloudflare_credential_intents i
               JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
               JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            state,
            (
                "cancelled".to_owned(),
                "prewrite_orphaned".to_owned(),
                "remediation_required".to_owned(),
                0
            )
        );
    }

    #[test]
    fn prior_credential_schema_epoch_requires_rebuild() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("prior-credential-schema.db");
        let key = [0x72; 32];
        drop(
            BusinessDatabase::open(&path, &LocalDatabaseKey::from_bytes(key), "workspace-local")
                .unwrap(),
        );
        let connection = crate::active_workspace::open_keyed(&path, &key).unwrap();
        connection
            .execute_batch(
                "PRAGMA ignore_check_constraints=ON;
                 UPDATE cloudflare_credential_schema_guard
                    SET schema_epoch='P0_07_CREDENTIAL_SCHEMA',
                        schema_fingerprint='d8e8a551a49e4dae75c8ae25ec97ec2d99157a3918e03c71477599097dfc3f01';
                 PRAGMA ignore_check_constraints=OFF;",
            )
            .unwrap();
        drop(connection);
        assert_eq!(
            BusinessDatabase::open(&path, &LocalDatabaseKey::from_bytes(key), "workspace-local",)
                .err(),
            Some(BusinessDatabaseError::CredentialSchemaRebuildRequired)
        );
    }

    #[test]
    fn prewrite_phase_is_live_and_has_only_closed_edges() {
        let database = database();
        let index_sql: String = database
            .store
            .raw_connection()
            .query_row(
                "SELECT sql FROM sqlite_schema
              WHERE type='index' AND name='cloudflare_credential_one_live_intent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(index_sql.contains("'prewrite_inspection_started'"));
        let trigger_sql: String = database
            .store
            .raw_connection()
            .query_row(
                "SELECT sql FROM sqlite_schema
              WHERE type='trigger' AND name='cloudflare_credential_intent_phase_edges'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(trigger_sql.contains(
            "OLD.phase = 'prepared' AND NEW.phase IN ('prewrite_inspection_started', 'cancelled')"
        ));
        assert!(trigger_sql.contains("OLD.phase = 'prewrite_inspection_started'"));
        assert!(trigger_sql.contains("NEW.phase IN ('keychain_write_started', 'cancelled')"));
    }

    #[test]
    fn prepared_revoke_recovery_remains_denied() {
        let mut database = database();
        let first = preparation(1, stage(1));
        provision(
            &mut database,
            &first,
            &CloudflareCredentialWitness::absent(),
            true,
            &CloudflareCredentialRecoveryObservation::Canonical(target(&first)),
        );
        let revoke = revoke_preparation(&first);
        database
            .prepare_cloudflare_credential_operation_guarded(&revoke, || Ok(()))
            .unwrap();
        assert_eq!(
            database
                .recover_cloudflare_credential_orphans_guarded(AT, || Ok(()))
                .unwrap(),
            1
        );
        let state: (String, String, String, i64) = database.store.raw_connection().query_row(
            "SELECT i.phase,i.terminal_reason,c.credential_use_state,r.highest_resolved_generation
               FROM cloudflare_credential_intents i
               JOIN cloudflare_credential_roots r USING (workspace_id,connection_incarnation_id)
               JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
              WHERE i.intent_id=?1",
            params![revoke.intent_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert_eq!(
            state,
            (
                "cancelled".to_owned(),
                "cancelled_before_inspection".to_owned(),
                "revocation_pending".to_owned(),
                1
            )
        );
        assert!(matches!(
            database.cloudflare_provision_seed(&first.logical_connection_id),
            Err(BusinessDatabaseError::InvalidInput)
        ));
    }

    #[test]
    fn revoke_requires_active_scope_and_retained_root_restricts_physical_connection_delete() {
        let mut database = database();
        let first = preparation(1, stage(1));
        provision(
            &mut database,
            &first,
            &CloudflareCredentialWitness::absent(),
            true,
            &CloudflareCredentialRecoveryObservation::Canonical(target(&first)),
        );
        let revoke = revoke_preparation(&first);
        assert_eq!(
            database
                .prepare_cloudflare_credential_operation_guarded(&revoke, || Ok(()))
                .unwrap(),
            CloudflareCredentialPreparationDisposition::Prepared
        );
        let denied_state: String = database
            .store
            .raw_connection()
            .query_row(
                "SELECT credential_use_state FROM local_provider_connections",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(denied_state, "revocation_pending");
        database
            .begin_cloudflare_prewrite_inspection_guarded(
                &revoke.connection_incarnation_id,
                &revoke.intent_id,
                &revoke.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
        database
            .mark_cloudflare_keychain_write_started_guarded(
                &revoke.connection_incarnation_id,
                &revoke.intent_id,
                &revoke.prepared_authority_snapshot_digest,
                AT,
                || Ok(()),
            )
            .unwrap();
        let tombstone = CloudflareCredentialWitness {
            kind: CloudflareCredentialEnvelopeKind::Tombstone,
            generation: Some(2),
            scope_digest: Some(revoke.scope_digest.clone()),
            zone_digest: Some(revoke.zone_digest.clone()),
            public_proof: Some(revoke.target_public_proof.clone()),
        };
        assert_eq!(
            database
                .resolve_cloudflare_credential_operation_guarded(
                    &revoke.connection_incarnation_id,
                    &revoke.intent_id,
                    &CloudflareCredentialRecoveryObservation::Canonical(tombstone),
                    &revoke.prepared_authority_snapshot_digest,
                    AT,
                    || Ok(()),
                )
                .unwrap(),
            CloudflareCredentialResolution::Confirmed
        );
        assert!(
            database
                .store
                .fixture_connection()
                .execute("DELETE FROM local_provider_connections", [])
                .is_err()
        );
        let retained: (i64, i64, String) = database.store.raw_connection().query_row("SELECT (SELECT count(*) FROM cloudflare_credential_roots),(SELECT count(*) FROM cloudflare_credential_generation_ledger),credential_use_state FROM local_provider_connections",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
        assert_eq!(retained, (1, 2, "revoked".to_owned()));
    }
}
