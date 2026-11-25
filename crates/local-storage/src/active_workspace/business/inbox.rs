//! Replica application and cursor advancement.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    BusinessDatabase, BusinessDatabaseError, DomainAssetReplicaMutation, LOCAL_WIRE_SCHEMA_VERSION,
    OptionalExtension, SYNC_MUTATION_WIRE_SCHEMA_VERSION, SyncMutationV2, SyncPageV2,
    SyncProjectionEffect, SyncPullRequestV2, TransactionBehavior, canonical_mutation_digest,
    canonical_page_digest, check_replicated_re_add, hex_digest, params, persist_conflict_candidate,
    read_local_conflict_value, supersede_replicated_tombstone, validate_cursor_token,
    validate_digest, validate_domain_asset, validate_domain_asset_id, validate_identifier,
    validate_sync_mutation_fields,
};

impl BusinessDatabase {
    /// Applies strict Cloud sync-replica input to the local authority. An empty page is a no-op;
    /// omission is never interpreted as deletion. Replica merges do not generate a new Outbox row.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid revision sequences or projections, pending local fields, or storage rejection.
    #[expect(
        clippy::too_many_lines,
        reason = "the replica transaction remains contiguous so revision and rollback ordering is reviewable"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "legacy replica merge remains a private test compatibility seam"
        )
    )]
    pub fn merge_domain_asset_replica(
        &mut self,
        mutations: Vec<DomainAssetReplicaMutation>,
    ) -> Result<(), BusinessDatabaseError> {
        if mutations.len() > 1_000 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let current_revision = self.current_server_revision()?;
        let mut previous_revision = current_revision;
        for mutation in &mutations {
            if mutation.server_revision != previous_revision + 1
                || mutation.server_revision > 9_007_199_254_740_991
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            validate_domain_asset(&mutation.asset)?;
            previous_revision = mutation.server_revision;
        }
        if mutations.is_empty() {
            return Ok(());
        }

        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for mutation in mutations {
            let revision = i64::try_from(mutation.server_revision)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            let asset = mutation.asset;
            let pending_fields: i64 = transaction
                .query_row(
                    "SELECT count(*) FROM domain_asset_field_versions
                     WHERE workspace_id = ?1 AND entity_id = ?2
                       AND sync_state IN ('pending', 'conflicted')",
                    params![self.workspace_id, asset.entity_id],
                    |row| row.get(0),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if pending_fields != 0 {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            let local_commit_sequence: i64 = transaction
                .query_row(
                    "UPDATE active_workspace_metadata
                     SET local_commit_sequence = local_commit_sequence + 1,
                         applied_through_server_revision = ?1,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                     WHERE singleton = 1
                     RETURNING local_commit_sequence",
                    [revision],
                    |row| row.get(0),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let tags_json = serde_json::to_string(&asset.tags)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction
                .execute(
                    "INSERT INTO domain_assets
                     (workspace_id, entity_id, lifecycle_status, created_at,
                      updated_at, local_commit_sequence)
                     VALUES (?1, ?2, 'active', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                             strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?3)
                     ON CONFLICT(workspace_id, entity_id) DO UPDATE SET
                       updated_at = excluded.updated_at,
                       local_commit_sequence = excluded.local_commit_sequence",
                    params![self.workspace_id, asset.entity_id, local_commit_sequence],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "INSERT INTO domain_asset_desired_state
                     (workspace_id, entity_id, portfolio_id, note, target_price_currency,
                      target_price_amount, desired_sale_status, desired_nameservers_json,
                      local_commit_sequence, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'hold', '[]', ?7,
                             strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
                     ON CONFLICT(workspace_id, entity_id) DO UPDATE SET
                       portfolio_id = excluded.portfolio_id, note = excluded.note,
                       target_price_currency = excluded.target_price_currency,
                       target_price_amount = excluded.target_price_amount,
                       local_commit_sequence = excluded.local_commit_sequence,
                       updated_at = excluded.updated_at",
                    params![
                        self.workspace_id,
                        asset.entity_id,
                        asset.portfolio_id,
                        asset.note,
                        asset.target_price.as_ref().map(|money| &money.currency),
                        asset.target_price.as_ref().map(|money| &money.amount),
                        local_commit_sequence,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "DELETE FROM domain_asset_tags WHERE workspace_id = ?1 AND entity_id = ?2",
                    params![self.workspace_id, asset.entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for tag in &asset.tags {
                transaction
                    .execute(
                        "INSERT INTO domain_asset_tags
                         (workspace_id, entity_id, tag, local_commit_sequence)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![
                            self.workspace_id,
                            asset.entity_id,
                            tag,
                            local_commit_sequence
                        ],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            for field_path in ["note", "portfolioId", "tags", "targetPrice"] {
                transaction
                    .execute(
                        "INSERT INTO domain_asset_field_versions
                         (workspace_id, entity_id, field_path, server_revision,
                          local_commit_sequence, sync_state, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, 'clean',
                                 strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
                         ON CONFLICT(workspace_id, entity_id, field_path) DO UPDATE SET
                           server_revision = excluded.server_revision,
                           local_commit_sequence = excluded.local_commit_sequence,
                           sync_state = 'clean', updated_at = excluded.updated_at",
                        params![
                            self.workspace_id,
                            asset.entity_id,
                            field_path,
                            revision,
                            local_commit_sequence,
                        ],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            transaction
                .execute(
                    "INSERT INTO portfolio_domain_assets
                     (workspace_id, entity_id, note, portfolio_id, tags_json,
                      target_price_currency, target_price_amount, note_server_revision,
                      portfolio_id_server_revision, tags_server_revision, target_price_server_revision)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8, ?8)
                     ON CONFLICT(workspace_id, entity_id) DO UPDATE SET
                       note = excluded.note,
                       portfolio_id = excluded.portfolio_id,
                       tags_json = excluded.tags_json,
                       target_price_currency = excluded.target_price_currency,
                       target_price_amount = excluded.target_price_amount,
                       note_server_revision = excluded.note_server_revision,
                       portfolio_id_server_revision = excluded.portfolio_id_server_revision,
                       tags_server_revision = excluded.tags_server_revision,
                       target_price_server_revision = excluded.target_price_server_revision",
                    params![
                        self.workspace_id,
                        asset.entity_id,
                        asset.note,
                        asset.portfolio_id,
                        tags_json,
                        asset.target_price.as_ref().map(|money| &money.currency),
                        asset.target_price.as_ref().map(|money| &money.amount),
                        revision,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction
            .execute(
                "UPDATE active_workspace_metadata SET applied_through_server_revision = ?1 WHERE singleton = 1",
                [i64::try_from(previous_revision)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Atomically materializes one Cloud v2 mutation page and its reader proof.
    ///
    /// The page digest is checked before any write. Inbox rows, domain projections, and the
    /// reader cursor are committed in one `IMMEDIATE` transaction, so a crash cannot expose
    /// business values without the corresponding applied-through proof. Replaying an identical
    /// page is a no-op; a different digest for an existing revision is rejected.
    ///
    /// # Errors
    ///
    /// Returns a closed input, revision, conflict, or storage error.
    #[allow(
        clippy::too_many_lines,
        reason = "atomic page transaction remains contiguous for audit"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded pull port remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn apply_sync_page_v2(
        &mut self,
        device_id: &str,
        page_json: &str,
        confirmation_token: &str,
    ) -> Result<(), BusinessDatabaseError> {
        self.apply_sync_page_v2_guarded(device_id, page_json, confirmation_token, |_| Ok(()))
            .map(|_| ())
    }

    /// Applies a page with an opaque Host-provided check executed after every page write and
    /// immediately before COMMIT. A failed check rolls back candidates, inbox and cursor together.
    ///
    /// # Errors
    ///
    /// Returns a closed input, revision, conflict, storage, or final fence error.
    #[allow(
        clippy::too_many_lines,
        reason = "atomic page transaction remains contiguous for audit"
    )]
    pub(crate) fn apply_sync_page_v2_guarded(
        &mut self,
        device_id: &str,
        page_json: &str,
        confirmation_token: &str,
        commit_fence: impl FnOnce(SyncProjectionEffect) -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncProjectionEffect, BusinessDatabaseError> {
        self.store
            .fixture_connection()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let result = self.apply_sync_page_v2_savepoint(
            device_id,
            page_json,
            confirmation_token,
            commit_fence,
        );
        match result {
            Ok(effect) => {
                self.store
                    .fixture_connection()
                    .execute_batch("COMMIT")
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                Ok(effect)
            }
            Err(error) => {
                let _ = self.store.fixture_connection().execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    #[allow(
        clippy::too_many_lines,
        reason = "atomic page transaction remains contiguous for audit"
    )]
    pub(super) fn apply_sync_page_v2_savepoint(
        &mut self,
        device_id: &str,
        page_json: &str,
        confirmation_token: &str,
        commit_fence: impl FnOnce(SyncProjectionEffect) -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncProjectionEffect, BusinessDatabaseError> {
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if page_json.len() > 1_048_576 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let page: SyncPageV2 =
            serde_json::from_str(page_json).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if page.schema_version != SYNC_MUTATION_WIRE_SCHEMA_VERSION
            || page.workspace_id != self.workspace_id
            || page.mutations.len() > 256
            || page.from_server_revision_exclusive > page.through_server_revision_inclusive
            || page.returned_through_server_revision > page.through_server_revision_inclusive
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_cursor_token(page.next_cursor.as_deref())?;
        validate_cursor_token(Some(confirmation_token))?;
        let supplied_digest = page.page_digest.clone();
        validate_digest(&supplied_digest)?;
        let digest_value =
            serde_json::to_value(&page).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let mut unsigned = digest_value
            .as_object()
            .cloned()
            .ok_or(BusinessDatabaseError::InvalidInput)?;
        unsigned.insert(
            "pageDigest".to_owned(),
            serde_json::Value::String("A".repeat(43)),
        );
        let expected_digest = canonical_page_digest(&serde_json::Value::Object(unsigned))?;
        if expected_digest != supplied_digest {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let mut expected_revision = page.from_server_revision_exclusive.saturating_add(1);
        for mutation in &page.mutations {
            if mutation.schema_version != SYNC_MUTATION_WIRE_SCHEMA_VERSION
                || !(1..=9_007_199_254_740_991).contains(&mutation.entity_generation)
                || mutation.server_revision != expected_revision
                || mutation.entity_type != "domain_asset"
                || mutation.workspace_id != page.workspace_id
                || mutation.operation_kind != "upsert" && mutation.operation_kind != "delete"
                || mutation.mutation_id.is_empty()
                || mutation.entity_id.is_empty()
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            if mutation.operation_kind == "delete" {
                if mutation.deleted_at.is_none() || !mutation.changed_fields.is_empty() {
                    return Err(BusinessDatabaseError::InvalidInput);
                }
            } else if mutation.deleted_at.is_some() || mutation.changed_fields.is_empty() {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            // ADR-0029 decision 3: only an upsert re-adds, as a generation after the first, and it
            // builds on the deletion it supersedes.
            if let Some(deleted_revision) = mutation.re_adds_deleted_revision
                && (mutation.operation_kind != "upsert"
                    || mutation.entity_generation < 2
                    || deleted_revision == 0
                    || deleted_revision > mutation.base_server_revision)
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            validate_sync_mutation_fields(mutation)?;
            expected_revision = expected_revision
                .checked_add(1)
                .ok_or(BusinessDatabaseError::SequenceExhausted)?;
        }
        let expected_returned = if page.mutations.is_empty() {
            page.from_server_revision_exclusive
        } else {
            page.mutations
                .last()
                .map_or(page.from_server_revision_exclusive, |mutation| {
                    mutation.server_revision
                })
        };
        if page.returned_through_server_revision != expected_returned
            || (page.next_cursor.is_none()
                && page.returned_through_server_revision != page.through_server_revision_inclusive)
            || (page.next_cursor.is_some()
                && page.returned_through_server_revision >= page.through_server_revision_inclusive)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }

        let transaction = self
            .store
            .fixture_connection()
            .savepoint()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let current_revision: i64 = transaction
            .query_row(
                "SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let current_revision =
            u64::try_from(current_revision).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let state: Option<(i64, String, Option<String>, Option<String>)> = transaction
            .query_row(
                "SELECT cursor_generation, status, confirmation_token, last_page_digest
                 FROM sync_reader_state WHERE workspace_id=?1 AND device_id=?2",
                params![self.workspace_id, device_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if state
            .as_ref()
            .is_some_and(|(_, status, _, _)| status != "active")
        {
            return Err(BusinessDatabaseError::RevisionRejected);
        }
        if current_revision == page.returned_through_server_revision
            && state
                .as_ref()
                .and_then(|(_, _, _, digest)| digest.as_deref())
                == Some(supplied_digest.as_str())
        {
            if state.as_ref().and_then(|(_, _, token, _)| token.as_deref())
                != Some(confirmation_token)
            {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            commit_fence(SyncProjectionEffect::Unchanged)?;
            transaction
                .commit()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            return Ok(SyncProjectionEffect::Unchanged);
        }
        if page.from_server_revision_exclusive != current_revision {
            return Err(BusinessDatabaseError::RevisionRejected);
        }
        for mutation in &page.mutations {
            let mutation_json = serde_json::to_string(mutation)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let wire_digest = canonical_mutation_digest(mutation, LOCAL_WIRE_SCHEMA_VERSION)?;
            let payload_digest = hex_digest(mutation_json.as_bytes());
            let existing: Option<(String, Option<String>, Option<i64>)> = transaction
                .query_row(
                    "SELECT mutation_id, wire_mutation_digest, wire_schema_version FROM sync_inbox
                     WHERE workspace_id=?1 AND server_revision=?2",
                    params![
                        self.workspace_id,
                        i64::try_from(mutation.server_revision)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?
                    ],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if let Some((existing_id, existing_digest, existing_version)) = existing {
                // A replay matches the digest under the version the row was recorded with.
                let replay_digest = existing_version
                    .map(|version| canonical_mutation_digest(mutation, version))
                    .transpose()?;
                if existing_id != mutation.mutation_id
                    || existing_digest.is_none()
                    || existing_digest != replay_digest
                {
                    return Err(BusinessDatabaseError::MutationConflict);
                }
                continue;
            }
            let own_echo = is_own_acknowledged_echo(&transaction, &self.workspace_id, mutation)?;
            let conflicted = if own_echo
                && own_echo_superseded_locally(&transaction, &self.workspace_id, mutation)?
            {
                false
            } else {
                apply_sync_mutation_projection(
                    &transaction,
                    &self.workspace_id,
                    mutation,
                    own_echo,
                )?
            };
            let inbox_state = if conflicted { "conflicted" } else { "applied" };
            transaction
                .execute(
                    "INSERT INTO sync_inbox
                     (workspace_id, server_revision, mutation_id, workspace_schema_version,
                      entity_kind, entity_id, operation_kind, source_device_id,
                      base_server_revision, mutation_payload_json, mutation_payload_sha256,
                      state, received_at, applied_at, wire_schema_version, wire_mutation_digest)
                     VALUES (?1,?2,?3,?4,'domain_asset',?5,?6,?7,?8,?9,?10,
                             ?11,strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                             CASE WHEN ?11='applied' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') END,
                             3,?12)",
                    params![
                        self.workspace_id,
                        i64::try_from(mutation.server_revision)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        mutation.mutation_id,
                        i64::try_from(mutation.workspace_schema_version)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        mutation.entity_id,
                        mutation.operation_kind,
                        mutation.source_device_id,
                        i64::try_from(mutation.base_server_revision)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        mutation_json,
                        payload_digest,
                        inbox_state,
                        wire_digest,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        let generation = state
            .as_ref()
            .map_or(1, |(generation, _, _, _)| *generation);
        if state.is_none() {
            transaction
                .execute(
                    "INSERT INTO sync_reader_state
                     (workspace_id,device_id,cursor_generation,read_through_server_revision,
                      pinned_target_server_revision,continuation_token,status,updated_at,
                      confirmation_token,last_page_digest,anti_rollback_server_revision_floor,
                      anti_rollback_schema_version_floor,row_version)
                     VALUES (?1,?2,?3,?4,?5,?6,'active',strftime('%Y-%m-%dT%H:%M:%SZ','now'),?7,?8,?4,2,1)",
                    params![
                        self.workspace_id,
                        device_id,
                        generation,
                        i64::try_from(page.returned_through_server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        i64::try_from(page.through_server_revision_inclusive).map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        page.next_cursor,
                        confirmation_token,
                        supplied_digest,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        } else {
            transaction
                .execute(
                    "UPDATE sync_reader_state SET read_through_server_revision=?1,
                      pinned_target_server_revision=?2, continuation_token=?3,
                      confirmation_token=?4, last_page_digest=?5,
                      anti_rollback_server_revision_floor=MAX(anti_rollback_server_revision_floor,?1),
                      row_version=row_version+1,
                      updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                     WHERE workspace_id=?6 AND device_id=?7",
                    params![
                        i64::try_from(page.returned_through_server_revision)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        i64::try_from(page.through_server_revision_inclusive)
                            .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                        page.next_cursor,
                        confirmation_token,
                        supplied_digest,
                        self.workspace_id,
                        device_id,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction
            .execute(
                "UPDATE active_workspace_metadata SET applied_through_server_revision=?1,
                 last_replication_activity_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                 WHERE singleton=1",
                [i64::try_from(page.returned_through_server_revision)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        // Even an empty non-replay page advances the applied revision and last activity exposed
        // by SyncSnapshot, so it is a visible Host read-fence change.
        let effect = SyncProjectionEffect::VisibleStateChanged;
        commit_fence(effect)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(effect)
    }
}

/// Whether `mutation` is the echo of a mutation this device sent and Cloud accepted: matched by
/// mutation id, entity, the revision Cloud acknowledged and the wire digest under the version the
/// Outbox row was recorded with. Anything else, including a rewritten item reusing the id, is
/// treated as another device's write.
fn is_own_acknowledged_echo(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
) -> Result<bool, BusinessDatabaseError> {
    let server_revision =
        i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let acknowledged: Option<(i64, String)> = transaction
        .query_row(
            "SELECT wire_schema_version, wire_mutation_digest FROM sync_outbox
             WHERE workspace_id=?1 AND mutation_id=?2 AND entity_kind='domain_asset'
               AND entity_id=?3 AND state='acknowledged' AND server_revision=?4
               AND wire_schema_version IS NOT NULL AND wire_mutation_digest IS NOT NULL",
            params![
                workspace_id,
                mutation.mutation_id,
                mutation.entity_id,
                server_revision
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((wire_version, recorded_digest)) = acknowledged else {
        return Ok(false);
    };
    Ok(canonical_mutation_digest(mutation, wire_version)? == recorded_digest)
}

/// Whether a write this device committed after the echoed `mutation` carries `field_path` of the
/// same entity and has not been overtaken by it: still being delivered (`pending`/`sending`), or
/// accepted by Cloud at a later revision whose own echo the Inbox has not reached yet. Either way
/// the local field already holds that later write. This relies on Cloud accepting or refusing a
/// mutation as a whole: an acknowledged later write stored every field it carries. A write Cloud refused is terminal in another
/// state and does not count. The Outbox payload is keyed by field path; local edits, creates and
/// keep-local resolutions all write the full projection (a null field is present as JSON `null`),
/// so in practice any such later upsert covers every field.
fn own_later_write_supersedes(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
    field_path: &str,
) -> Result<bool, BusinessDatabaseError> {
    transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_outbox AS later
                 WHERE later.workspace_id=?1 AND later.entity_kind='domain_asset'
                   AND later.entity_id=?2
                   AND (later.state IN ('pending','sending')
                        OR (later.state='acknowledged' AND later.server_revision > ?5))
                   AND later.operation_kind='upsert'
                   AND json_type(later.mutation_payload_json, '$.' || ?4) IS NOT NULL
                   AND later.local_commit_sequence > (
                     SELECT echoed.local_commit_sequence FROM sync_outbox AS echoed
                     WHERE echoed.workspace_id=?1 AND echoed.mutation_id=?3))",
            params![
                workspace_id,
                mutation.entity_id,
                mutation.mutation_id,
                field_path,
                i64::try_from(mutation.server_revision)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?
            ],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)
}

/// Whether this device's own acknowledged echo (`is_own_acknowledged_echo`) finds its entity
/// already moved on locally, in which case it is recorded as applied without being replayed.
///
/// The Inbox applies revisions in order, so no remote write after the echo has been applied yet:
/// a tombstone the echo does not itself describe, or a row of another generation, can only come
/// from this device's own later writes, which already include the echo's effect. Replaying it
/// would fail against that newer state (stalling every later pull) or roll it back.
fn own_echo_superseded_locally(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
) -> Result<bool, BusinessDatabaseError> {
    let server_revision =
        i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let generation = i64::try_from(mutation.entity_generation)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    // A delete's echo describes the tombstone of its own generation, which the ordinary
    // projection settles; any other tombstone or generation is newer local state.
    let moved_on: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM domain_assets
                           WHERE workspace_id=?1 AND entity_id=?2 AND entity_generation!=?3)
                 OR EXISTS(SELECT 1 FROM sync_tombstones
                           WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                             AND (entity_generation!=?3 OR ?4!='delete'))",
            params![
                workspace_id,
                mutation.entity_id,
                generation,
                mutation.operation_kind
            ],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if !moved_on {
        return Ok(false);
    }
    transaction
        .execute(
            "UPDATE active_workspace_metadata SET applied_through_server_revision=?1,
             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE singleton=1",
            [server_revision],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(true)
}

/// Applies only the allowlisted domain-asset fields. A pending local field is retained and
/// surfaced as an inbox conflict instead of being overwritten by a Cloud replica value.
#[expect(
    clippy::too_many_lines,
    reason = "field materialization remains one transaction-local operation"
)]
fn apply_sync_mutation_projection(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
    own_echo: bool,
) -> Result<bool, BusinessDatabaseError> {
    validate_domain_asset_id(&mutation.entity_id)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_identifier(&mutation.mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_identifier(&mutation.source_device_id)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if mutation.workspace_id != workspace_id
        || mutation.workspace_schema_version == 0
        || mutation.active_lease_epoch == 0
        || mutation.device_mutation_sequence == 0
        || mutation.base_server_revision >= mutation.server_revision
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    // ADR-0029 C1c1: a replicated mutation names the generation it applies to; a local row on any
    // other generation is a different entity, so the page is refused rather than merged into it.
    let generation = i64::try_from(mutation.entity_generation)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    // This device's own re-add, already confirmed by its acknowledgement, comes back as an
    // ordinary upsert of the generation it created (ADR-0029 C2c1).
    let own_confirmed_re_add: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_domain_asset_re_adds
             WHERE workspace_id=?1 AND entity_id=?2 AND re_add_mutation_id=?3 AND origin='local'
               AND deleted_generation + 1 = ?4 AND re_add_server_revision=?5
               AND deleted_server_revision IS ?6)",
            params![
                workspace_id,
                mutation.entity_id,
                mutation.mutation_id,
                generation,
                i64::try_from(mutation.server_revision)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                mutation
                    .re_adds_deleted_revision
                    .map(i64::try_from)
                    .transpose()
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?
            ],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let re_adds = mutation
        .re_adds_deleted_revision
        .filter(|_| !own_confirmed_re_add);
    if re_adds.is_some() {
        check_replicated_re_add(transaction, workspace_id, mutation)?;
    } else {
        // A replicated tombstone can exist before any asset row, so both record the local
        // generation. An entity this replica never held starts at generation 1; a later one is
        // reached only through the re-add that superseded the earlier generation.
        let (other_generations, held): (i64, i64) = transaction
            .query_row(
                "SELECT (SELECT count(*) FROM domain_assets
                         WHERE workspace_id=?1 AND entity_id=?2 AND entity_generation!=?3)
                      + (SELECT count(*) FROM sync_tombstones
                         WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                           AND entity_generation!=?3),
                        (SELECT count(*) FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2)
                      + (SELECT count(*) FROM sync_tombstones
                         WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2)",
                params![workspace_id, mutation.entity_id, generation],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if other_generations != 0 || (held == 0 && generation != 1) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
    }
    let local_commit_sequence: i64 = transaction
        .query_row(
            "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,
             applied_through_server_revision=?1,
             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE singleton=1 RETURNING local_commit_sequence",
            [i64::try_from(mutation.server_revision)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let pending: i64 = transaction
        .query_row(
            "SELECT count(*) FROM domain_asset_field_versions
             WHERE workspace_id=?1 AND entity_id=?2 AND sync_state IN ('pending','conflicted')",
            params![workspace_id, mutation.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if let Some(deleted_revision) = re_adds {
        supersede_replicated_tombstone(
            transaction,
            workspace_id,
            mutation,
            deleted_revision,
            local_commit_sequence,
        )?;
    }
    if mutation.operation_kind == "delete" {
        if pending != 0 {
            persist_conflict_candidate(
                transaction,
                workspace_id,
                mutation,
                "lifecycleStatus",
                read_local_conflict_value(
                    transaction,
                    workspace_id,
                    &mutation.entity_id,
                    "lifecycleStatus",
                )?,
                None,
            )?;
            let local_commit_sequence: i64 = transaction.query_row(
                "SELECT local_commit_sequence FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, mutation.entity_id], |row| row.get(0)
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute(
                "INSERT INTO sync_tombstones
                 (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,
                  deleted_server_revision,deleted_at,purge_after,state,barrier_state,
                  order_server_revision,order_source_device_id,order_mutation_id,entity_generation)
                 VALUES (?1,'domain_asset',?2,?3,?4,?5,NULL,'replicated','contested',?4,?6,?7,?8)
                 ON CONFLICT(workspace_id,entity_kind,entity_id) DO UPDATE SET
                   deleted_server_revision=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.deleted_server_revision ELSE sync_tombstones.deleted_server_revision END,
                   deleted_at=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.deleted_at ELSE sync_tombstones.deleted_at END,
                   barrier_state=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN 'contested' ELSE sync_tombstones.barrier_state END,
                   order_server_revision=MAX(COALESCE(sync_tombstones.order_server_revision,0),excluded.order_server_revision),
                   order_source_device_id=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.order_source_device_id ELSE sync_tombstones.order_source_device_id END,
                   order_mutation_id=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.order_mutation_id ELSE sync_tombstones.order_mutation_id END",
                params![workspace_id,mutation.entity_id,local_commit_sequence,i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?,mutation.deleted_at.as_deref().unwrap_or("1970-01-01T00:00:00Z"),mutation.source_device_id,mutation.mutation_id,generation]
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            return Ok(true);
        }
        transaction
            .execute(
                "INSERT INTO sync_tombstones
                 (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,
                  deleted_server_revision,deleted_at,purge_after,state,barrier_state,
                  order_server_revision,order_source_device_id,order_mutation_id,entity_generation)
                 VALUES (?1,'domain_asset',?2,?3,?4,?5,NULL,'replicated','replicated',?4,?6,?7,?8)
                 ON CONFLICT(workspace_id,entity_kind,entity_id) DO UPDATE SET
                   deleted_server_revision=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision, 0) THEN excluded.deleted_server_revision ELSE sync_tombstones.deleted_server_revision END,
                   deleted_at=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision, 0) THEN excluded.deleted_at ELSE sync_tombstones.deleted_at END,
                   state=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision, 0) THEN 'replicated' ELSE sync_tombstones.state END,
                   barrier_state=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision, 0) THEN 'replicated' ELSE sync_tombstones.barrier_state END,
                   order_server_revision=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision, 0) THEN excluded.order_server_revision ELSE sync_tombstones.order_server_revision END,
                   order_source_device_id=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision, 0) THEN excluded.order_source_device_id ELSE sync_tombstones.order_source_device_id END,
                   order_mutation_id=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision, 0) THEN excluded.order_mutation_id ELSE sync_tombstones.order_mutation_id END",
                params![
                    workspace_id,
                    mutation.entity_id,
                    local_commit_sequence,
                    i64::try_from(mutation.server_revision)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    mutation
                        .deleted_at
                        .as_deref()
                        .unwrap_or("1970-01-01T00:00:00Z"),
                    mutation.source_device_id,
                    mutation.mutation_id,
                    generation,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id,entity_id,lifecycle_status,created_at,updated_at,deleted_at,local_commit_sequence,entity_generation)
                 VALUES (?1,?2,'archived',strftime('%Y-%m-%dT%H:%M:%SZ','now'),?3,?3,?4,?5)
                 ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
                   lifecycle_status='archived',updated_at=excluded.updated_at,
                   deleted_at=excluded.deleted_at,local_commit_sequence=excluded.local_commit_sequence",
                params![workspace_id, mutation.entity_id, mutation.deleted_at.as_deref().unwrap_or("1970-01-01T00:00:00Z"), local_commit_sequence, generation],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        return Ok(pending != 0);
    }

    let tombstoned: i64 = transaction
        .query_row(
            "SELECT count(*) FROM sync_tombstones
             WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",
            params![workspace_id, mutation.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if tombstoned != 0 {
        return Err(BusinessDatabaseError::MutationConflict);
    }

    transaction
        .execute(
            "INSERT INTO domain_assets
             (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence,entity_generation)
             VALUES (?1,?2,'active',strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'),?3,?4)
             ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
               lifecycle_status='active',deleted_at=NULL,updated_at=excluded.updated_at,
               local_commit_sequence=excluded.local_commit_sequence",
            params![workspace_id, mutation.entity_id, local_commit_sequence, generation],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO portfolio_domain_assets
             (workspace_id,entity_id,note,portfolio_id,tags_json,target_price_currency,
              target_price_amount,note_server_revision,portfolio_id_server_revision,
              tags_server_revision,target_price_server_revision)
             VALUES (?1,?2,NULL,NULL,'[]',NULL,NULL,0,0,0,0)
             ON CONFLICT(workspace_id,entity_id) DO NOTHING",
            params![workspace_id, mutation.entity_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO sync_asset_provenance(workspace_id,entity_id,root_provenance,replicated_server_revision,freshness,updated_at)
             VALUES (?1,?2,'replicated',?3,'confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now'))
             ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
               root_provenance='replicated',replicated_server_revision=MAX(replicated_server_revision,excluded.replicated_server_revision),freshness='confirmed'",
            params![workspace_id, mutation.entity_id, i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO domain_asset_desired_state
             (workspace_id,entity_id,desired_sale_status,desired_nameservers_json,local_commit_sequence,updated_at)
             VALUES (?1,?2,'hold','[]',?3,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
             ON CONFLICT(workspace_id,entity_id) DO UPDATE SET local_commit_sequence=excluded.local_commit_sequence,
               updated_at=excluded.updated_at",
            params![workspace_id, mutation.entity_id, local_commit_sequence],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let mut conflict = false;
    for field in &mutation.changed_fields {
        if !matches!(
            field.field_path.as_str(),
            "note" | "portfolioId" | "tags" | "targetPrice"
        ) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let field_pending: i64 = transaction
            .query_row(
                "SELECT count(*) FROM domain_asset_field_versions
                 WHERE workspace_id=?1 AND entity_id=?2 AND field_path=?3
                   AND sync_state IN ('pending','conflicted')",
                params![workspace_id, mutation.entity_id, field.field_path],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        // On the echo of this device's own accepted write, a field a later write of this device
        // still holds (in flight, or accepted after this echo and not yet echoed) supersedes the
        // echo as it does on Cloud (`isOwnEarlierWrite`): the local value and its version stay,
        // with no conflict, so a paginated pull never rolls the projection back to the earlier
        // value. A field left pending by a write Cloud refused keeps the conflict below, since
        // Cloud holds the echoed value and the replica does not.
        if own_echo
            && own_later_write_supersedes(transaction, workspace_id, mutation, &field.field_path)?
        {
            continue;
        }
        if field_pending != 0 {
            conflict = true;
            let local_value = read_local_conflict_value(
                transaction,
                workspace_id,
                &mutation.entity_id,
                &field.field_path,
            )?;
            persist_conflict_candidate(
                transaction,
                workspace_id,
                mutation,
                &field.field_path,
                local_value,
                None,
            )?;
            continue;
        }
        let value = &field.value;
        match field.field_path.as_str() {
            "note" => {
                let note = value.as_str().map(str::to_owned);
                transaction.execute("UPDATE domain_asset_desired_state SET note=?1 WHERE workspace_id=?2 AND entity_id=?3", params![note, workspace_id, mutation.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
                transaction.execute("UPDATE portfolio_domain_assets SET note=?1,note_server_revision=?2 WHERE workspace_id=?3 AND entity_id=?4", params![note, i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?, workspace_id, mutation.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            "portfolioId" => {
                let portfolio_id = value.as_str().map(str::to_owned);
                transaction.execute("UPDATE domain_asset_desired_state SET portfolio_id=?1 WHERE workspace_id=?2 AND entity_id=?3", params![portfolio_id, workspace_id, mutation.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
                transaction.execute("UPDATE portfolio_domain_assets SET portfolio_id=?1,portfolio_id_server_revision=?2 WHERE workspace_id=?3 AND entity_id=?4", params![portfolio_id, i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?, workspace_id, mutation.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            "tags" => {
                let tags: Vec<String> = serde_json::from_value(value.clone())
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?;
                transaction
                    .execute(
                        "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
                        params![workspace_id, mutation.entity_id],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                for tag in tags {
                    transaction.execute("INSERT INTO domain_asset_tags (workspace_id,entity_id,tag,local_commit_sequence) VALUES (?1,?2,?3,?4)", params![workspace_id, mutation.entity_id, tag, local_commit_sequence]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
                }
                transaction.execute("UPDATE portfolio_domain_assets SET tags_json=?1,tags_server_revision=?2 WHERE workspace_id=?3 AND entity_id=?4", params![serde_json::to_string(&serde_json::from_value::<Vec<String>>(value.clone()).map_err(|_| BusinessDatabaseError::InvalidInput)?).map_err(|_| BusinessDatabaseError::InvalidInput)?, i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?, workspace_id, mutation.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            "targetPrice" => {
                let (currency, amount): (Option<String>, Option<String>) = if value.is_null() {
                    (None, None)
                } else {
                    (
                        Some(
                            value
                                .get("currency")
                                .and_then(|v| v.as_str())
                                .ok_or(BusinessDatabaseError::InvalidInput)?
                                .to_owned(),
                        ),
                        Some(
                            value
                                .get("amount")
                                .and_then(|v| v.as_str())
                                .ok_or(BusinessDatabaseError::InvalidInput)?
                                .to_owned(),
                        ),
                    )
                };
                transaction.execute("UPDATE domain_asset_desired_state SET target_price_currency=?1,target_price_amount=?2 WHERE workspace_id=?3 AND entity_id=?4", params![currency, amount, workspace_id, mutation.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
                transaction.execute("UPDATE portfolio_domain_assets SET target_price_currency=?1,target_price_amount=?2,target_price_server_revision=?3 WHERE workspace_id=?4 AND entity_id=?5", params![currency, amount, i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?, workspace_id, mutation.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            _ => unreachable!(),
        }
        transaction.execute("INSERT INTO domain_asset_field_versions (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,provenance,freshness,updated_at) VALUES (?1,?2,?3,?4,?5,'clean','replicated','confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now')) ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET server_revision=excluded.server_revision,local_commit_sequence=excluded.local_commit_sequence,sync_state='clean',provenance='replicated',freshness='confirmed',updated_at=excluded.updated_at", params![workspace_id, mutation.entity_id, field.field_path, i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?, local_commit_sequence]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    Ok(conflict)
}

impl BusinessDatabase {
    /// Returns the next Host-owned pull presentation. The opaque cursor and confirmation token
    /// remain inside the Host process and are never a Renderer selector.
    ///
    /// # Errors
    ///
    /// Returns a closed input, revision, or storage error.
    pub fn read_sync_pull_request_v2(
        &self,
        device_id: &str,
        page_limit: u16,
    ) -> Result<SyncPullRequestV2, BusinessDatabaseError> {
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !(1..=256).contains(&page_limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let row: Option<(i64, Option<String>, Option<String>, String)> = self
            .store
            .raw_connection()
            .query_row(
                "SELECT read_through_server_revision,continuation_token,confirmation_token,status
                 FROM sync_reader_state WHERE workspace_id=?1 AND device_id=?2",
                params![self.workspace_id, device_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (revision, cursor, confirm) = if let Some((revision, cursor, confirm, status)) = row {
            if status != "active" {
                return Err(BusinessDatabaseError::RevisionRejected);
            }
            (revision, cursor, confirm)
        } else {
            (
                i64::try_from(self.current_server_revision()?)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                None,
                None,
            )
        };
        Ok(SyncPullRequestV2 {
            schema_version: SYNC_MUTATION_WIRE_SCHEMA_VERSION,
            after_server_revision: u64::try_from(revision)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            cursor,
            confirm,
            page_limit,
        })
    }
}
