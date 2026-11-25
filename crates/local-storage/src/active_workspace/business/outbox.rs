//! Durable sync delivery, acknowledgement and retry.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    BusinessDatabase, BusinessDatabaseError, ClaimedSyncMutation, LOCAL_WIRE_SCHEMA_VERSION,
    OptionalExtension, SyncMutationAcknowledgement, SyncProjectionEffect, SyncRejectionKind,
    TransactionBehavior, confirm_local_re_add, local_wire_digest, params,
    reconstruct_sync_mutation_v2, serialize_sync_push_request, validate_identifier,
    validate_timestamp, withdraw_local_re_add, withdraw_rejected_local_delete,
};

impl BusinessDatabase {
    #[cfg(test)]
    pub(crate) fn test_sync_delivery_state(
        &self,
        mutation_id: &str,
    ) -> Result<(String, i64, Option<String>, Option<i64>), BusinessDatabaseError> {
        self.store
            .raw_connection()
            .query_row(
                "SELECT state,attempt_count,delivery_owner,delivery_attempt_fence
                   FROM sync_outbox WHERE workspace_id=?1 AND mutation_id=?2",
                params![self.workspace_id, mutation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Marks one pending Outbox mutation acknowledged at a safe server revision.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid identifiers, revisions, timestamps, missing pending rows, or storage rejection.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "legacy single-mutation acknowledgement remains a private test compatibility seam"
        )
    )]
    pub fn acknowledge_sync_mutation(
        &mut self,
        mutation_id: &str,
        server_revision: u64,
        acknowledged_at: &str,
    ) -> Result<(), BusinessDatabaseError> {
        self.acknowledge_sync_mutation_guarded(
            mutation_id,
            server_revision,
            acknowledged_at,
            || Ok(()),
        )
    }

    /// Marks one pending mutation acknowledged with a final authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed input, authority-fence, or storage error.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "legacy guarded single-mutation acknowledgement remains a private test compatibility seam"
        )
    )]
    pub fn acknowledge_sync_mutation_guarded(
        &mut self,
        mutation_id: &str,
        server_revision: u64,
        acknowledged_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !(1..=9_007_199_254_740_991).contains(&server_revision) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_timestamp(Some(acknowledged_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let server_revision =
            i64::try_from(server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let updated = transaction
            .execute(
                "UPDATE sync_outbox
                 SET acknowledged_at = ?1, server_revision = ?2, state = 'acknowledged'
                 WHERE workspace_id = ?3 AND mutation_id = ?4 AND acknowledged_at IS NULL",
                params![
                    acknowledged_at,
                    server_revision,
                    self.workspace_id,
                    mutation_id
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if updated != 1 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Claims one bounded contiguous device stream for sync v2 delivery.
    ///
    /// The Host reconstructs the wire item from allowlisted durable columns. Existing v2 digests
    /// are verified before ownership changes, so storage tampering cannot alter a retry.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed ownership/time bounds, inconsistent durable rows, or storage failure.
    pub(crate) fn next_sync_push_attempt_unix_seconds(
        &self,
        now_unix_seconds: i64,
    ) -> Result<Option<i64>, BusinessDatabaseError> {
        self.store
            .raw_connection()
            .query_row(
                "SELECT CASE state
                    WHEN 'pending' THEN COALESCE(unixepoch(next_attempt_at), ?2)
                    WHEN 'sending' THEN unixepoch(delivery_lease_expires_at)
                    ELSE NULL
                 END
                 FROM sync_outbox
                 WHERE workspace_id=?1 AND state IN ('pending','sending')
                 ORDER BY device_mutation_sequence, created_at, mutation_id
                 LIMIT 1",
                params![self.workspace_id, now_unix_seconds],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
            .and_then(|deadline| {
                deadline
                    .flatten()
                    .map_or(Ok(None), |deadline| Ok(Some(deadline)))
            })
    }

    #[cfg(test)]
    pub fn claim_sync_mutations_v2(
        &mut self,
        delivery_owner: &str,
        now: &str,
        lease_expires_at: &str,
        limit: usize,
    ) -> Result<Vec<ClaimedSyncMutation>, BusinessDatabaseError> {
        self.claim_sync_mutations_v2_guarded(
            delivery_owner,
            now,
            lease_expires_at,
            limit,
            || Ok(()),
        )
    }

    /// Claims one bounded stream with a final authority fence immediately before COMMIT.
    ///
    /// # Errors
    ///
    /// Returns a closed input, authority-fence, sequence, or storage error.
    #[allow(
        clippy::too_many_lines,
        reason = "claim projection and lease CAS stay in one auditable transaction"
    )]
    pub fn claim_sync_mutations_v2_guarded(
        &mut self,
        delivery_owner: &str,
        now: &str,
        lease_expires_at: &str,
        limit: usize,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<Vec<ClaimedSyncMutation>, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(now.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(lease_expires_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if now >= lease_expires_at || !(1..=256).contains(&limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let limit = i64::try_from(limit).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let candidates = {
            let mut statement = transaction
                .prepare(
                    "SELECT mutation_id, entity_id, operation_kind, base_server_revision,
                            workspace_schema_version, source_device_id, active_lease_epoch,
                            device_mutation_sequence, created_at, wire_mutation_digest,
                            attempt_count, mutation_payload_sha256, state,
                            next_attempt_at, delivery_lease_expires_at
                     FROM sync_outbox
                     WHERE workspace_id = ?1
                       AND state IN ('pending', 'sending')
                     ORDER BY device_mutation_sequence, created_at, mutation_id
                     LIMIT ?4",
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let rows = statement
                .query_map(
                    params![self.workspace_id, now, delivery_owner, limit],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<i64>>(6)?,
                            row.get::<_, Option<i64>>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, Option<String>>(9)?,
                            row.get::<_, i64>(10)?,
                            row.get::<_, Option<String>>(11)?,
                            row.get::<_, String>(12)?,
                            row.get::<_, Option<String>>(13)?,
                            row.get::<_, Option<String>>(14)?,
                        ))
                    },
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
        };
        let mut claimed = Vec::with_capacity(candidates.len());
        let mut wire_mutations = Vec::with_capacity(candidates.len());
        for (
            mutation_id,
            entity_id,
            operation_kind,
            base_server_revision,
            workspace_schema_version,
            source_device_id,
            active_lease_epoch,
            device_mutation_sequence,
            created_at,
            stored_wire_digest,
            attempt_count,
            local_json_digest,
            state,
            next_attempt_at,
            delivery_lease_expires_at,
        ) in candidates
        {
            let due = match state.as_str() {
                "pending" => next_attempt_at
                    .as_deref()
                    .is_none_or(|deadline| deadline <= now),
                "sending" => delivery_lease_expires_at
                    .as_deref()
                    .is_some_and(|deadline| deadline <= now),
                _ => false,
            };
            if !due {
                break;
            }
            let source_device_id =
                source_device_id.ok_or(BusinessDatabaseError::StorageRejected)?;
            let active_lease_epoch =
                active_lease_epoch.ok_or(BusinessDatabaseError::StorageRejected)?;
            let device_mutation_sequence =
                device_mutation_sequence.ok_or(BusinessDatabaseError::StorageRejected)?;
            let wire = reconstruct_sync_mutation_v2(
                &transaction,
                &self.workspace_id,
                &mutation_id,
                &entity_id,
                &operation_kind,
                base_server_revision,
                workspace_schema_version,
                &source_device_id,
                active_lease_epoch,
                device_mutation_sequence,
                &created_at,
            )?;
            let wire_json =
                serde_json::to_string(&wire).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            // A row claimed before the local wire moved to version 3 keeps its recorded version:
            // its wire identity is immutable, and for generation 1 both encodings are equivalent.
            let wire_version = if stored_wire_digest.is_some() {
                transaction
                    .query_row(
                        "SELECT wire_schema_version FROM sync_outbox
                         WHERE workspace_id=?1 AND mutation_id=?2",
                        params![self.workspace_id, mutation_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?
            } else {
                LOCAL_WIRE_SCHEMA_VERSION
            };
            let wire_digest = local_wire_digest(&wire, wire_version)?;
            if local_json_digest.as_deref() == Some(&wire_digest)
                || stored_wire_digest
                    .as_ref()
                    .is_some_and(|value| value != &wire_digest)
            {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            let fence = attempt_count
                .checked_add(1)
                .filter(|value| *value <= 9_007_199_254_740_991)
                .ok_or(BusinessDatabaseError::SequenceExhausted)?;
            wire_mutations.push(wire_json.clone());
            if serialize_sync_push_request(&wire_mutations).is_err() {
                wire_mutations.pop();
                if claimed.is_empty() {
                    // Product validators bound one canonical mutation far below the request cap
                    // (10k text characters plus 128 bounded tags and fixed metadata). Reaching
                    // this branch therefore means durable corruption, not valid user input.
                    let terminalized = transaction
                        .execute(
                            "UPDATE sync_outbox
                             SET state='rejected', delivery_owner=NULL,
                                 delivery_lease_expires_at=NULL,
                                 delivery_attempt_fence=NULL, next_attempt_at=NULL,
                                 last_error_code='sync_payload_too_large'
                             WHERE workspace_id=?1 AND mutation_id=?2
                               AND (state='pending'
                                 OR (state='sending' AND delivery_lease_expires_at<=?3))",
                            params![self.workspace_id, mutation_id, now],
                        )
                        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                    if terminalized != 1 {
                        return Err(BusinessDatabaseError::MutationConflict);
                    }
                    // A terminal re-add is withdrawn like any rejected one, or its entity would
                    // stay frozen behind a pointer nothing can end.
                    withdraw_local_re_add(&transaction, &self.workspace_id, &mutation_id)?;
                    continue;
                }
                break;
            }
            let updated = transaction
                .execute(
                    "UPDATE sync_outbox
                     SET state = 'sending', attempt_count = ?1, delivery_owner = ?2,
                         delivery_lease_expires_at = ?3, delivery_attempt_fence = ?1,
                         wire_schema_version = ?8, wire_mutation_digest = ?4,
                         next_attempt_at = NULL, last_error_code = NULL
                     WHERE workspace_id = ?5 AND mutation_id = ?6
                       AND (state = 'pending'
                         OR (state = 'sending' AND delivery_lease_expires_at <= ?7))",
                    params![
                        fence,
                        delivery_owner,
                        lease_expires_at,
                        wire_digest,
                        self.workspace_id,
                        mutation_id,
                        now,
                        wire_version,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if updated != 1 {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            claimed.push(ClaimedSyncMutation {
                mutation_id,
                source_device_id,
                active_lease_epoch: u64::try_from(active_lease_epoch)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                device_mutation_sequence: u64::try_from(device_mutation_sequence)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                delivery_attempt_fence: u64::try_from(fence)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                wire_mutation_json: wire_json,
                wire_mutation_digest: wire_digest,
            });
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(claimed)
    }

    /// Applies a complete Cloud acknowledgement batch with owner/fence/digest CAS.
    ///
    /// # Errors
    ///
    /// Any missing or mismatched item rolls back the whole batch.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded sync acknowledgement remains private; production uses the Host-fenced operation"
        )
    )]
    #[cfg_attr(
        test,
        expect(
            dead_code,
            reason = "tests exercise the guarded acknowledgement port directly"
        )
    )]
    pub fn acknowledge_sync_batch_v2(
        &mut self,
        delivery_owner: &str,
        acknowledgements: &[SyncMutationAcknowledgement],
        acknowledged_at: &str,
    ) -> Result<(), BusinessDatabaseError> {
        self.acknowledge_sync_batch_v2_guarded(
            delivery_owner,
            acknowledgements,
            acknowledged_at,
            |_| Ok(()),
        )
        .map(|_| ())
    }

    /// Applies a complete Cloud acknowledgement batch with a final authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed input, acknowledgement-CAS, authority-fence, or storage error.
    #[allow(
        clippy::too_many_lines,
        clippy::if_not_else,
        reason = "ACK CAS and exact replay remain adjacent"
    )]
    pub fn acknowledge_sync_batch_v2_guarded(
        &mut self,
        delivery_owner: &str,
        acknowledgements: &[SyncMutationAcknowledgement],
        acknowledged_at: &str,
        pre_commit_guard: impl FnOnce(SyncProjectionEffect) -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncProjectionEffect, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(acknowledged_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if acknowledgements.is_empty() || acknowledgements.len() > 256 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut changed = false;
        for acknowledgement in acknowledgements {
            validate_identifier(&acknowledgement.mutation_id)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            let outbox_identity: Option<(String, String, i64)> = transaction
                .query_row(
                    "SELECT entity_id, operation_kind, local_commit_sequence
                     FROM sync_outbox WHERE workspace_id=?1 AND mutation_id=?2",
                    params![self.workspace_id, acknowledgement.mutation_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let updated = transaction
                .execute(
                    "UPDATE sync_outbox SET state='acknowledged', acknowledged_at=?1,
                   server_revision=?2, delivery_owner=NULL, delivery_lease_expires_at=NULL,
                   delivery_attempt_fence=NULL
                 WHERE workspace_id=?3 AND mutation_id=?4 AND state='sending'
                   AND delivery_owner=?5 AND delivery_attempt_fence=?6
                   AND source_device_id=?7 AND active_lease_epoch=?8
                   AND device_mutation_sequence=?9 AND wire_schema_version IN (2,3)
                   AND wire_mutation_digest=?10",
                    params![
                        acknowledged_at,
                        i64::try_from(acknowledgement.server_revision)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        self.workspace_id,
                        acknowledgement.mutation_id,
                        delivery_owner,
                        i64::try_from(acknowledgement.delivery_attempt_fence)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        acknowledgement.source_device_id,
                        i64::try_from(acknowledgement.active_lease_epoch)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        i64::try_from(acknowledgement.device_mutation_sequence)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        acknowledgement.wire_mutation_digest
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if updated != 1 {
                let exact: i64 = transaction
                    .query_row(
                        "SELECT count(*) FROM sync_outbox WHERE workspace_id=?1 AND mutation_id=?2
                       AND state='acknowledged' AND server_revision=?3
                       AND source_device_id=?4 AND active_lease_epoch=?5
                       AND device_mutation_sequence=?6 AND wire_mutation_digest=?7",
                        params![
                            self.workspace_id,
                            acknowledgement.mutation_id,
                            i64::try_from(acknowledgement.server_revision)
                                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                            acknowledgement.source_device_id,
                            i64::try_from(acknowledgement.active_lease_epoch)
                                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                            i64::try_from(acknowledgement.device_mutation_sequence)
                                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                            acknowledgement.wire_mutation_digest
                        ],
                        |row| row.get(0),
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                if exact != 1 {
                    return Err(BusinessDatabaseError::MutationConflict);
                }
            } else {
                changed = true;
                let (entity_id, operation_kind, local_commit_sequence) =
                    outbox_identity.ok_or(BusinessDatabaseError::StorageRejected)?;
                transaction
                    .execute(
                        "UPDATE domain_asset_field_versions
                     SET server_revision=?1, sync_state='clean', updated_at=?2
                     WHERE workspace_id=?3 AND entity_id=?4 AND local_commit_sequence=?5",
                        params![
                            i64::try_from(acknowledgement.server_revision)
                                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                            acknowledged_at,
                            self.workspace_id,
                            entity_id,
                            local_commit_sequence
                        ],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                if operation_kind == "delete" {
                    transaction.execute(
                        "UPDATE sync_tombstones SET deleted_server_revision=?1, state='acknowledged'
                         WHERE workspace_id=?2 AND entity_kind='domain_asset' AND entity_id=?3
                           AND deleted_local_commit_sequence=?4 AND state='pending'",
                        params![i64::try_from(acknowledgement.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?, self.workspace_id, entity_id, local_commit_sequence],
                    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
                }
                confirm_local_re_add(
                    &transaction,
                    &self.workspace_id,
                    &acknowledgement.mutation_id,
                    i64::try_from(acknowledgement.server_revision)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    local_commit_sequence,
                )?;
            }
        }
        let effect = if changed {
            SyncProjectionEffect::VisibleStateChanged
        } else {
            SyncProjectionEffect::Unchanged
        };
        pre_commit_guard(effect)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(effect)
    }

    /// Returns a whole claimed batch to pending in one owner/fence/digest CAS transaction.
    /// The delay derives from trusted Host time and the durable attempt count, and is capped at
    /// five minutes so a transient response cannot create an unbounded delivery delay.
    ///
    /// # Errors
    ///
    /// Returns an error when the batch is malformed, any claim identity is stale, or storage fails.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded retry deferral remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn defer_retryable_sync_batch_v2(
        &mut self,
        delivery_owner: &str,
        mutations: &[ClaimedSyncMutation],
        now: &str,
    ) -> Result<(), BusinessDatabaseError> {
        self.defer_retryable_sync_batch_v2_guarded(delivery_owner, mutations, now, || Ok(()))
    }

    /// Returns a claimed batch to pending with a final authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed input, claim-CAS, authority-fence, or storage error.
    pub fn defer_retryable_sync_batch_v2_guarded(
        &mut self,
        delivery_owner: &str,
        mutations: &[ClaimedSyncMutation],
        now: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        self.defer_retryable_sync_batch_v2_guarded_with_deadline(
            delivery_owner,
            mutations,
            now,
            pre_commit_guard,
        )
        .map(|_| ())
    }

    pub(crate) fn defer_retryable_sync_batch_v2_guarded_with_deadline(
        &mut self,
        delivery_owner: &str,
        mutations: &[ClaimedSyncMutation],
        now: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<i64, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(now.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if mutations.is_empty() || mutations.len() > 256 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut earliest_deadline: Option<i64> = None;
        for mutation in mutations {
            validate_identifier(&mutation.mutation_id)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            let attempt_count: i64 = transaction
                .query_row(
                    "SELECT attempt_count FROM sync_outbox
                     WHERE workspace_id=?1 AND mutation_id=?2",
                    params![self.workspace_id, mutation.mutation_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
                .ok_or(BusinessDatabaseError::MutationConflict)?;
            let delay_seconds = 1_i64
                .checked_shl(
                    u32::try_from(attempt_count.clamp(0, 9))
                        .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                )
                .unwrap_or(256)
                .min(300);
            let updated = transaction
                .execute(
                    "UPDATE sync_outbox
                     SET state='pending', delivery_owner=NULL, delivery_lease_expires_at=NULL,
                         delivery_attempt_fence=NULL,
                         next_attempt_at=strftime('%Y-%m-%dT%H:%M:%SZ', datetime(?1, ?2)),
                         last_error_code='transport_retryable'
                     WHERE workspace_id=?3 AND mutation_id=?4 AND state='sending'
                       AND delivery_owner=?5 AND delivery_attempt_fence=?6
                       AND source_device_id=?7 AND active_lease_epoch=?8
                       AND device_mutation_sequence=?9 AND wire_schema_version IN (2,3)
                       AND wire_mutation_digest=?10",
                    params![
                        now,
                        format!("+{delay_seconds} seconds"),
                        self.workspace_id,
                        mutation.mutation_id,
                        delivery_owner,
                        i64::try_from(mutation.delivery_attempt_fence)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        mutation.source_device_id,
                        i64::try_from(mutation.active_lease_epoch)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        i64::try_from(mutation.device_mutation_sequence)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        mutation.wire_mutation_digest,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if updated != 1 {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            let deadline = transaction
                .query_row(
                    "SELECT unixepoch(next_attempt_at) FROM sync_outbox
                     WHERE workspace_id=?1 AND mutation_id=?2",
                    params![self.workspace_id, mutation.mutation_id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if earliest_deadline
                .as_ref()
                .is_none_or(|earliest| deadline < *earliest)
            {
                earliest_deadline = Some(deadline);
            }
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        earliest_deadline.ok_or(BusinessDatabaseError::StorageRejected)
    }

    /// Closes a complete claimed batch after a deterministic Cloud rejection.
    ///
    /// # Errors
    ///
    /// Returns an error when the batch is malformed, any claim identity is stale, or storage fails.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded terminal rejection remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn reject_sync_batch_v2(
        &mut self,
        delivery_owner: &str,
        mutations: &[ClaimedSyncMutation],
        kind: SyncRejectionKind,
    ) -> Result<(), BusinessDatabaseError> {
        self.reject_sync_batch_v2_guarded(delivery_owner, mutations, kind, |_| Ok(()))
            .map(|_| ())
    }

    /// Closes a claimed batch with a final authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed input, claim-CAS, authority-fence, or storage error.
    pub fn reject_sync_batch_v2_guarded(
        &mut self,
        delivery_owner: &str,
        mutations: &[ClaimedSyncMutation],
        kind: SyncRejectionKind,
        pre_commit_guard: impl FnOnce(SyncProjectionEffect) -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncProjectionEffect, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if mutations.is_empty() || mutations.len() > 256 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (terminal_state, error_code) = match kind {
            SyncRejectionKind::Deterministic => ("rejected", "sync_deterministic_rejection"),
            SyncRejectionKind::IdempotencyConflict => ("conflicted", "sync_idempotency_conflict"),
            SyncRejectionKind::MutationConflict => ("conflicted", "sync_mutation_conflict"),
        };
        for mutation in mutations {
            validate_identifier(&mutation.mutation_id)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            let updated = transaction
                .execute(
                    "UPDATE sync_outbox
                     SET state=?1, delivery_owner=NULL, delivery_lease_expires_at=NULL,
                         delivery_attempt_fence=NULL, next_attempt_at=NULL, last_error_code=?2
                     WHERE workspace_id=?3 AND mutation_id=?4 AND state='sending'
                       AND delivery_owner=?5 AND delivery_attempt_fence=?6
                       AND source_device_id=?7 AND active_lease_epoch=?8
                       AND device_mutation_sequence=?9 AND wire_schema_version IN (2,3)
                       AND wire_mutation_digest=?10",
                    params![
                        terminal_state,
                        error_code,
                        self.workspace_id,
                        mutation.mutation_id,
                        delivery_owner,
                        i64::try_from(mutation.delivery_attempt_fence)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        mutation.source_device_id,
                        i64::try_from(mutation.active_lease_epoch)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        i64::try_from(mutation.device_mutation_sequence)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        mutation.wire_mutation_digest,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if updated != 1 {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            withdraw_local_re_add(&transaction, &self.workspace_id, &mutation.mutation_id)?;
            if kind != SyncRejectionKind::IdempotencyConflict {
                withdraw_rejected_local_delete(
                    &transaction,
                    &self.workspace_id,
                    &mutation.mutation_id,
                )?;
            }
        }
        let effect = SyncProjectionEffect::VisibleStateChanged;
        pre_commit_guard(effect)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(effect)
    }
}
