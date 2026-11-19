//! Asset lifecycle and generation transitions.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    BusinessDatabase, BusinessDatabaseError, DomainAssetMutationReceipt, DomainAssetProjectionRow,
    DomainAssetWrite, ExistingMutationRow, OptionalExtension, SyncMutationV2, TransactionBehavior,
    hex_digest, local_re_add_entry_open, params, sync_payload, validate_domain_asset,
    validate_identifier, validate_projection, validate_timestamp,
};

impl BusinessDatabase {
    /// # Errors
    ///
    /// Returns a closed validation, authorization, CAS, transaction, or sequence error.
    #[expect(
        clippy::too_many_arguments,
        reason = "the public mutation port keeps CAS and authority fields explicit"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded edit compatibility port remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn edit_domain_asset(
        &mut self,
        mutation_id: &str,
        expected_asset_version: u64,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        asset: &DomainAssetWrite,
        allow_new: bool,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError> {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_domain_asset(asset)?;
        self.mutate_domain_asset(
            "edit",
            mutation_id,
            &asset.entity_id,
            expected_asset_version,
            device_id,
            active_lease_epoch,
            committed_at,
            Some(asset),
            allow_new,
            |_| Ok(()),
            |(), _| Ok(()),
        )
    }

    /// Test helper for the same provisional generation transition used by Host create (ADR-0029 C2c2).
    #[cfg(test)]
    pub(crate) fn re_add_domain_asset(
        &mut self,
        mutation_id: &str,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        asset: &DomainAssetWrite,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError> {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_domain_asset(asset)?;
        self.mutate_domain_asset(
            "re_add",
            mutation_id,
            &asset.entity_id,
            0,
            device_id,
            active_lease_epoch,
            committed_at,
            Some(asset),
            true,
            |_| Ok(()),
            |(), _| Ok(()),
        )
    }

    /// # Errors
    ///
    /// Returns a closed validation, authorization, CAS, transaction, or sequence error.
    #[expect(
        clippy::too_many_arguments,
        reason = "the public mutation port keeps CAS and authority fields explicit"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded delete compatibility port remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn delete_domain_asset(
        &mut self,
        mutation_id: &str,
        expected_asset_version: u64,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        entity_id: &str,
        allow_new: bool,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError> {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        crate::portfolio_projection::validate_domain_asset_id(entity_id)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        self.mutate_domain_asset(
            "delete",
            mutation_id,
            entity_id,
            expected_asset_version,
            device_id,
            active_lease_epoch,
            committed_at,
            None,
            allow_new,
            |_| Ok(()),
            |(), _| Ok(()),
        )
    }

    /// # Errors
    ///
    /// Returns a closed validation, authorization, CAS, transaction, or pre-COMMIT guard error.
    #[expect(
        clippy::too_many_arguments,
        reason = "the guarded port carries explicit authority and critical-section callbacks"
    )]
    pub fn edit_domain_asset_guarded<G, F, A>(
        &mut self,
        mutation_id: &str,
        expected_asset_version: u64,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        asset: &DomainAssetWrite,
        allow_new: bool,
        guard: F,
        after_commit: A,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError>
    where
        F: FnOnce(bool) -> Result<G, BusinessDatabaseError>,
        A: FnOnce(&mut G, bool) -> Result<(), BusinessDatabaseError>,
    {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_domain_asset(asset)?;
        self.mutate_domain_asset(
            "edit",
            mutation_id,
            &asset.entity_id,
            expected_asset_version,
            device_id,
            active_lease_epoch,
            committed_at,
            Some(asset),
            allow_new,
            guard,
            after_commit,
        )
    }

    /// Adds a domain the workspace does not hold yet, as one synced upsert mutation.
    ///
    /// # Errors
    ///
    /// Returns `AssetExists` when the workspace already holds the domain and `AssetDeleted` while a
    /// deleted one keeps its tombstone; otherwise a closed validation, authorization, transaction, or
    /// pre-COMMIT guard error.
    #[expect(
        clippy::too_many_arguments,
        reason = "the guarded port carries explicit authority and critical-section callbacks"
    )]
    pub fn create_domain_asset_guarded<G, F, A>(
        &mut self,
        mutation_id: &str,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        asset: &DomainAssetWrite,
        allow_new: bool,
        guard: F,
        after_commit: A,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError>
    where
        F: FnOnce(bool) -> Result<G, BusinessDatabaseError>,
        A: FnOnce(&mut G, bool) -> Result<(), BusinessDatabaseError>,
    {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_domain_asset(asset)?;
        // A new identity is also held to the Renderer's canonical form: an all-numeric last label
        // would be an IP literal, not a registrable domain.
        if !asset
            .entity_id
            .rsplit('.')
            .next()
            .is_some_and(|label| label.bytes().any(|byte| byte.is_ascii_lowercase()))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        self.mutate_domain_asset(
            "create",
            mutation_id,
            &asset.entity_id,
            0,
            device_id,
            active_lease_epoch,
            committed_at,
            Some(asset),
            allow_new,
            guard,
            after_commit,
        )
    }

    /// # Errors
    ///
    /// Returns a closed validation, authorization, CAS, transaction, or pre-COMMIT guard error.
    #[expect(
        clippy::too_many_arguments,
        reason = "the guarded port carries explicit authority and critical-section callbacks"
    )]
    pub fn delete_domain_asset_guarded<G, F, A>(
        &mut self,
        mutation_id: &str,
        expected_asset_version: u64,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        entity_id: &str,
        allow_new: bool,
        guard: F,
        after_commit: A,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError>
    where
        F: FnOnce(bool) -> Result<G, BusinessDatabaseError>,
        A: FnOnce(&mut G, bool) -> Result<(), BusinessDatabaseError>,
    {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        crate::portfolio_projection::validate_domain_asset_id(entity_id)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        self.mutate_domain_asset(
            "delete",
            mutation_id,
            entity_id,
            expected_asset_version,
            device_id,
            active_lease_epoch,
            committed_at,
            None,
            allow_new,
            guard,
            after_commit,
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "mutation transaction inputs are explicit authority and CAS fields"
    )]
    fn mutate_domain_asset<G>(
        &mut self,
        operation: &str,
        mutation_id: &str,
        entity_id: &str,
        expected_asset_version: u64,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        edit: Option<&DomainAssetWrite>,
        allow_new: bool,
        pre_commit_guard: impl FnOnce(bool) -> Result<G, BusinessDatabaseError>,
        after_commit: impl FnOnce(&mut G, bool) -> Result<(), BusinessDatabaseError>,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError> {
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let receipt = mutate_domain_asset_in_transaction(
            &transaction,
            &self.workspace_id,
            operation,
            mutation_id,
            entity_id,
            expected_asset_version,
            device_id,
            active_lease_epoch,
            committed_at,
            edit,
            allow_new,
        )?;
        let replayed = receipt.disposition == "replayed";
        let mut guard = pre_commit_guard(replayed)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        after_commit(&mut guard, replayed)?;
        Ok(receipt)
    }

    /// Commits one validated domain mutation and its Outbox fields atomically.
    ///
    /// # Errors
    ///
    /// Returns an error when input is invalid, sync payloads contain secrets, or storage rejects the transaction.
    #[allow(
        clippy::too_many_lines,
        reason = "the full immediate transaction remains contiguous so atomic write ordering is reviewable"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "legacy upsert remains a private test compatibility seam"
        )
    )]
    pub fn upsert_domain_asset(
        &mut self,
        mutation_id: &str,
        created_at: &str,
        asset: &DomainAssetWrite,
    ) -> Result<(), BusinessDatabaseError> {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(created_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let projection = DomainAssetProjectionRow {
            entity_id: asset.entity_id.clone(),
            note: asset.note.clone(),
            portfolio_id: asset.portfolio_id.clone(),
            tags: asset.tags.clone(),
            target_price: asset.target_price.clone(),
        };
        validate_projection(std::slice::from_ref(&projection))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let mutation_payload_json = sync_payload(&projection)?;
        let mutation_payload_sha256 = hex_digest(mutation_payload_json.as_bytes());
        let connection = self.store.fixture_connection();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let tombstoned: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_tombstones WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2)",
            params![self.workspace_id, asset.entity_id],
            |row| row.get(0),
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if tombstoned {
            return Err(BusinessDatabaseError::AssetDeleted);
        }
        let (local_commit_sequence, server_revision, device_mutation_sequence): (i64, i64, i64) =
            transaction
                .query_row(
                    "UPDATE active_workspace_metadata
                 SET local_commit_sequence = local_commit_sequence + 1,
                     next_device_mutation_sequence = next_device_mutation_sequence + 1,
                     updated_at = ?1
                 WHERE singleton = 1
                 RETURNING local_commit_sequence, applied_through_server_revision, next_device_mutation_sequence - 1",
                    [created_at],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id, entity_id, lifecycle_status,
                  acquired_on, expires_on, acquisition_cost_currency, acquisition_cost_amount,
                  auto_renew, registrar_lock, created_at, updated_at, deleted_at,
                  local_commit_sequence)
                 VALUES (?1, ?2, 'active', NULL, NULL, NULL, NULL, NULL, NULL,
                         ?3, ?3, NULL, ?4)
                 ON CONFLICT(workspace_id, entity_id) DO UPDATE SET
                   updated_at = excluded.updated_at,
                   local_commit_sequence = excluded.local_commit_sequence",
                params![
                    self.workspace_id,
                    asset.entity_id,
                    created_at,
                    local_commit_sequence
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO domain_asset_desired_state
                 (workspace_id, entity_id, portfolio_id, note, target_price_currency,
                  target_price_amount, desired_sale_status, desired_nameservers_json,
                  local_commit_sequence, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'hold', '[]', ?7, ?8)
                 ON CONFLICT(workspace_id, entity_id) DO UPDATE SET
                   portfolio_id = excluded.portfolio_id,
                   note = excluded.note,
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
                    created_at,
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
                     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)
                     ON CONFLICT(workspace_id, entity_id, field_path) DO UPDATE SET
                       local_commit_sequence = excluded.local_commit_sequence,
                       sync_state = 'pending',
                       updated_at = excluded.updated_at",
                    params![
                        self.workspace_id,
                        asset.entity_id,
                        field_path,
                        server_revision,
                        local_commit_sequence,
                        created_at,
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
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 0, 0)
                 ON CONFLICT(workspace_id, entity_id) DO UPDATE SET
                   note = excluded.note,
                   portfolio_id = excluded.portfolio_id,
                   tags_json = excluded.tags_json,
                   target_price_currency = excluded.target_price_currency,
                   target_price_amount = excluded.target_price_amount",
                params![
                    self.workspace_id,
                    asset.entity_id,
                    asset.note,
                    asset.portfolio_id,
                    serde_json::to_string(&asset.tags)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    asset.target_price.as_ref().map(|money| &money.currency),
                    asset.target_price.as_ref().map(|money| &money.amount),
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO sync_outbox
                 (workspace_id, mutation_id, entity_kind, entity_id, mutation_payload_json,
                  created_at, acknowledged_at, base_server_revision,
                  local_commit_sequence, device_mutation_sequence, mutation_payload_sha256, state,
                  entity_generation)
                 VALUES (?1, ?2, 'domain_asset', ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, 'pending',
                         COALESCE((SELECT entity_generation FROM domain_assets
                                   WHERE workspace_id=?1 AND entity_id=?3),1))",
                params![
                    self.workspace_id,
                    mutation_id,
                    asset.entity_id,
                    mutation_payload_json,
                    created_at,
                    server_revision,
                    local_commit_sequence,
                    device_mutation_sequence,
                    mutation_payload_sha256,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let field_values = [
            (
                "note",
                serde_json::to_string(&asset.note)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            ),
            (
                "portfolioId",
                serde_json::to_string(&asset.portfolio_id)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            ),
            (
                "tags",
                serde_json::to_string(&asset.tags)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            ),
            (
                "targetPrice",
                serde_json::to_string(&asset.target_price)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            ),
        ];
        for (ordinal, (field_path, field_value_json)) in field_values.iter().enumerate() {
            let ordinal =
                i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction
                .execute(
                    "INSERT INTO sync_outbox_fields
                     (workspace_id, mutation_id, ordinal, field_path, field_value_json, field_value_sha256)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        self.workspace_id,
                        mutation_id,
                        ordinal,
                        field_path,
                        field_value_json,
                        hex_digest(field_value_json.as_bytes()),
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}

/// ADR-0029 decision 3 as the Inbox sees it: another device re-added an asset Cloud had deleted,
/// and Cloud accepted it only because its tombstone was generation g with deletion revision R. This
/// replica applies it only when its own confirmed state is that same tombstone. A different or
/// missing tombstone means the replica diverged from Cloud, so the page is refused as invalid, like
/// any other generation mismatch (C1c1). A tombstone the replica has not settled yet, or local work
/// still owed on the entity, would be silently discarded by the reset, so the page is refused as a
/// conflict instead and retried on a later cycle, once the Outbox has drained and the conflict has
/// been resolved.
pub(super) fn check_replicated_re_add(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
) -> Result<(), BusinessDatabaseError> {
    let deleted_revision = mutation
        .re_adds_deleted_revision
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    // While this device's own re-add is provisional, its echo (or anything else re-adding the
    // entity) waits for that re-add's acknowledgement or rejection, which settles the tombstone.
    let provisional: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds
             WHERE workspace_id=?1 AND entity_id=?2)",
            params![workspace_id, mutation.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if provisional {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    let deleted_generation = mutation
        .entity_generation
        .checked_sub(1)
        .filter(|generation| *generation >= 1)
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    let tombstone: Option<(i64, Option<i64>, String, Option<String>)> = transaction
        .query_row(
            "SELECT entity_generation, deleted_server_revision, state, barrier_state
             FROM sync_tombstones
             WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",
            params![workspace_id, mutation.entity_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((generation, local_revision, state, barrier_state)) = tombstone else {
        return Err(BusinessDatabaseError::InvalidInput);
    };
    if u64::try_from(generation).ok() != Some(deleted_generation) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    // An unacknowledged local delete has no deletion revision yet, and a contested barrier still
    // holds a remote delete against unsynchronized local work. An acknowledged local delete keeps
    // its `pending` barrier, yet Cloud confirmed its revision, so it is settled.
    if state == "pending" || barrier_state.as_deref() == Some("contested") {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    if local_revision.and_then(|revision| u64::try_from(revision).ok()) != Some(deleted_revision) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let unknown_outcome: i64 = transaction
        .query_row(
            "SELECT (SELECT count(*) FROM sync_outbox
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                       AND state='sending')
                  + (SELECT count(*) FROM sync_conflicts
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                       AND status='open')
                  + (SELECT count(*) FROM domain_asset_field_versions
                     WHERE workspace_id=?1 AND entity_id=?2
                       AND sync_state='conflicted')",
            params![workspace_id, mutation.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if unknown_outcome != 0 {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    // Decision 3: no field of the deleted generation revives. A queued write of that generation
    // is still owed and Cloud will refuse it against the tombstone, so the page waits for that
    // terminal answer. A `pending` field mark with no queued write left is the residue of a write
    // Cloud already refused: its terminal Outbox row keeps the evidence, nothing is owed, and the
    // re-add's field reset retires the mark instead of stalling the pull behind it.
    let pending_outbox: i64 = transaction
        .query_row(
            "SELECT count(*) FROM sync_outbox
         WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
           AND state='pending'",
            params![workspace_id, mutation.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if pending_outbox != 0 {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    // Once nothing is owed, the tombstone pairs with a soft-deleted row of its generation, or with
    // no row at all. (A remote delete held against local edits leaves the row live under a
    // contested tombstone, which waits above for the conflict instead of failing here.)
    let live_or_other: i64 = transaction
        .query_row(
            "SELECT count(*) FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2
               AND (deleted_at IS NULL OR entity_generation!=?3)",
            params![workspace_id, mutation.entity_id, generation],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if live_or_other != 0 {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

/// Decision 4's preconditions for this device's own re-add, read in the write transaction: the
/// deletion is confirmed at revision R (acknowledged here or replicated), its barrier is settled,
/// and the entity has no queued mutation or open conflict. Returns the tombstone's generation and
/// R. The provisional pointer's insert trigger checks the same conditions again.
fn check_local_re_add(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
) -> Result<(i64, i64), BusinessDatabaseError> {
    let tombstone: Option<(i64, Option<i64>, String, Option<String>)> = transaction
        .query_row(
            "SELECT entity_generation, deleted_server_revision, state, barrier_state
             FROM sync_tombstones
             WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",
            params![workspace_id, entity_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((generation, Some(deleted_revision), state, barrier_state)) = tombstone else {
        return Err(BusinessDatabaseError::AssetReAddBlocked);
    };
    let owed: i64 = transaction
        .query_row(
            "SELECT (SELECT count(*) FROM sync_outbox
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                       AND state IN ('pending','sending'))
                  + (SELECT count(*) FROM sync_conflicts
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                       AND status='open')",
            params![workspace_id, entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if !matches!(state.as_str(), "acknowledged" | "replicated")
        || barrier_state.as_deref() == Some("contested")
        || owed != 0
    {
        return Err(BusinessDatabaseError::AssetReAddBlocked);
    }
    Ok((generation, deleted_revision))
}

/// Writes this device's re-add as provisional generation g + 1 (decision 4): the pointer first,
/// because the schema admits the generation change and the Outbox re-add only beside it, then the
/// row as a new entity holding only the re-add's fields. The tombstone stays until Cloud answers.
#[expect(
    clippy::too_many_lines,
    reason = "the provisional write is one ordered sequence the schema checks step by step"
)]
fn write_local_re_add(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation_id: &str,
    asset: &DomainAssetWrite,
    (deleted_generation, deleted_revision): (i64, i64),
    (local_seq, base_rev): (i64, i64),
    committed_at: &str,
) -> Result<(), BusinessDatabaseError> {
    let entity_id = asset.entity_id.as_str();
    let currency = asset.target_price.as_ref().map(|money| &money.currency);
    let amount = asset.target_price.as_ref().map(|money| &money.amount);
    let tags_json =
        serde_json::to_string(&asset.tags).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    transaction
        .execute(
            "INSERT INTO sync_domain_asset_provisional_re_adds
             (workspace_id,entity_id,deleted_generation,deleted_server_revision,mutation_id)
             VALUES (?1,?2,?3,?4,?5)",
            params![
                workspace_id,
                entity_id,
                deleted_generation,
                deleted_revision,
                mutation_id
            ],
        )
        .map_err(|_| BusinessDatabaseError::AssetReAddBlocked)?;
    transaction
        .execute(
            "UPDATE domain_assets SET entity_generation=?3, lifecycle_status='active',
               deleted_at=NULL, acquired_on=NULL, expires_on=NULL,
               acquisition_cost_currency=NULL, acquisition_cost_amount=NULL, auto_renew=NULL,
               registrar_lock=NULL, created_at=?4, updated_at=?4, local_commit_sequence=?5
             WHERE workspace_id=?1 AND entity_id=?2",
            params![
                workspace_id,
                entity_id,
                deleted_generation + 1,
                committed_at,
                local_seq
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO domain_asset_desired_state
             (workspace_id,entity_id,portfolio_id,note,target_price_currency,target_price_amount,
              desired_sale_status,desired_nameservers_json,local_commit_sequence,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,'hold','[]',?7,?8)
             ON CONFLICT(workspace_id,entity_id) DO UPDATE SET portfolio_id=excluded.portfolio_id,
               note=excluded.note, target_price_currency=excluded.target_price_currency,
               target_price_amount=excluded.target_price_amount, desired_sale_status='hold',
               desired_nameservers_json='[]', local_commit_sequence=excluded.local_commit_sequence,
               updated_at=excluded.updated_at",
            params![
                workspace_id,
                entity_id,
                asset.portfolio_id,
                asset.note,
                currency,
                amount,
                local_seq,
                committed_at
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO portfolio_domain_assets
             (workspace_id,entity_id,note,portfolio_id,tags_json,target_price_currency,
              target_price_amount,note_server_revision,portfolio_id_server_revision,
              tags_server_revision,target_price_server_revision)
             VALUES (?1,?2,?3,?4,?5,?6,?7,0,0,0,0)
             ON CONFLICT(workspace_id,entity_id) DO UPDATE SET note=excluded.note,
               portfolio_id=excluded.portfolio_id, tags_json=excluded.tags_json,
               target_price_currency=excluded.target_price_currency,
               target_price_amount=excluded.target_price_amount, note_server_revision=0,
               portfolio_id_server_revision=0, tags_server_revision=0,
               target_price_server_revision=0",
            params![
                workspace_id,
                entity_id,
                asset.note,
                asset.portfolio_id,
                tags_json,
                currency,
                amount
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for statement in [
        "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
        "DELETE FROM domain_asset_field_versions WHERE workspace_id=?1 AND entity_id=?2",
    ] {
        transaction
            .execute(statement, params![workspace_id, entity_id])
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    for tag in &asset.tags {
        transaction
            .execute(
                "INSERT INTO domain_asset_tags (workspace_id,entity_id,tag,local_commit_sequence)
                 VALUES (?1,?2,?3,?4)",
                params![workspace_id, entity_id, tag, local_seq],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    for field_path in ["note", "portfolioId", "tags", "targetPrice"] {
        transaction
            .execute(
                "INSERT INTO domain_asset_field_versions
                 (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,
                  sync_state,updated_at)
                 VALUES (?1,?2,?3,?4,?5,'pending',?6)",
                params![
                    workspace_id,
                    entity_id,
                    field_path,
                    base_rev,
                    local_seq,
                    committed_at
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    Ok(())
}

/// Confirms a provisional re-add Cloud acknowledged at `server_revision`: the `local` record, then
/// the tombstone it supersedes, then the pointer, so generation g + 1 becomes the confirmed one.
pub(super) fn confirm_local_re_add(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation_id: &str,
    server_revision: i64,
    local_commit_sequence: i64,
) -> Result<(), BusinessDatabaseError> {
    let provisional: Option<(String, i64, i64)> = transaction
        .query_row(
            "SELECT entity_id, deleted_generation, deleted_server_revision
             FROM sync_domain_asset_provisional_re_adds WHERE workspace_id=?1 AND mutation_id=?2",
            params![workspace_id, mutation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((entity_id, deleted_generation, deleted_revision)) = provisional else {
        return Ok(());
    };
    transaction
        .execute(
            "INSERT INTO sync_domain_asset_re_adds
             (workspace_id,entity_id,deleted_generation,deleted_server_revision,re_add_mutation_id,
              re_add_server_revision,origin,local_commit_sequence)
             VALUES (?1,?2,?3,?4,?5,?6,'local',?7)",
            params![
                workspace_id,
                entity_id,
                deleted_generation,
                deleted_revision,
                mutation_id,
                server_revision,
                local_commit_sequence
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "DELETE FROM sync_tombstones
             WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",
            params![workspace_id, entity_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "DELETE FROM sync_domain_asset_provisional_re_adds
             WHERE workspace_id=?1 AND mutation_id=?2",
            params![workspace_id, mutation_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

/// Withdraws a provisional re-add Cloud rejected (decision 4, business withdrawal): the row returns
/// to the soft-deleted generation g its tombstone records, with the attempt's fields and field
/// versions cleared, and the pointer goes, which unfreezes the entity. The terminal Outbox row, its
/// fields and its creation marker stay as the attempt's evidence; a corrected attempt names g + 1
/// again. The portfolio revisions stay at the 0 the provisional write gave them: a deleted row's
/// field revisions are never read, and the next re-add sets them again.
pub(super) fn withdraw_local_re_add(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation_id: &str,
) -> Result<(), BusinessDatabaseError> {
    let provisional: Option<(String, i64, String)> = transaction
        .query_row(
            "SELECT provisional.entity_id, provisional.deleted_generation, tombstone.deleted_at
             FROM sync_domain_asset_provisional_re_adds AS provisional
             JOIN sync_tombstones AS tombstone
               ON tombstone.workspace_id=provisional.workspace_id
              AND tombstone.entity_kind='domain_asset'
              AND tombstone.entity_id=provisional.entity_id
             WHERE provisional.workspace_id=?1 AND provisional.mutation_id=?2",
            params![workspace_id, mutation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((entity_id, deleted_generation, deleted_at)) = provisional else {
        return Ok(());
    };
    transaction
        .execute(
            "UPDATE domain_assets SET entity_generation=?3, lifecycle_status='archived',
               deleted_at=?4, updated_at=?4
             WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, entity_id, deleted_generation, deleted_at],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for statement in [
        "UPDATE portfolio_domain_assets SET note=NULL, portfolio_id=NULL, tags_json='[]',
           target_price_currency=NULL, target_price_amount=NULL
         WHERE workspace_id=?1 AND entity_id=?2",
        "UPDATE domain_asset_desired_state SET portfolio_id=NULL, note=NULL,
           target_price_currency=NULL, target_price_amount=NULL
         WHERE workspace_id=?1 AND entity_id=?2",
        "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
        "DELETE FROM domain_asset_field_versions WHERE workspace_id=?1 AND entity_id=?2",
        "DELETE FROM sync_domain_asset_provisional_re_adds WHERE workspace_id=?1 AND entity_id=?2",
    ] {
        transaction
            .execute(statement, params![workspace_id, entity_id])
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    Ok(())
}

/// Reverses a local delete only when Cloud has durably rejected that exact mutation. The business
/// fields were retained while the row was soft-deleted; removing the paired pending tombstone
/// before clearing `deleted_at` restores that projection. The terminal Outbox row remains the
/// evidence that this delete attempt did not take effect.
pub(super) fn withdraw_rejected_local_delete(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation_id: &str,
) -> Result<(), BusinessDatabaseError> {
    // The restored version comes from `domain_asset_desired_state`: a delete never writes that
    // table, so it still holds the last edit's commit sequence and time, which is exactly the
    // version the row had before this delete.
    let rejected: Option<(String, i64, i64, i64, String)> = transaction
        .query_row(
            "SELECT outbox.entity_id, outbox.local_commit_sequence, outbox.entity_generation,
                    desired.local_commit_sequence, desired.updated_at
             FROM sync_outbox AS outbox
             JOIN sync_tombstones AS tombstone
               ON tombstone.workspace_id=outbox.workspace_id
              AND tombstone.entity_kind='domain_asset' AND tombstone.entity_id=outbox.entity_id
              AND tombstone.deleted_local_commit_sequence=outbox.local_commit_sequence
              AND tombstone.entity_generation=outbox.entity_generation
             JOIN domain_assets AS asset
               ON asset.workspace_id=outbox.workspace_id AND asset.entity_id=outbox.entity_id
              AND asset.entity_generation=outbox.entity_generation
              AND asset.deleted_at=tombstone.deleted_at
             JOIN domain_asset_desired_state AS desired
               ON desired.workspace_id=outbox.workspace_id AND desired.entity_id=outbox.entity_id
             WHERE outbox.workspace_id=?1 AND outbox.mutation_id=?2
               AND outbox.operation_kind='delete' AND outbox.state IN ('rejected','conflicted')
               AND outbox.last_error_code IN ('sync_deterministic_rejection','sync_mutation_conflict')
               AND tombstone.state='pending' AND tombstone.barrier_state='pending'
               AND tombstone.deleted_server_revision IS NULL",
            params![workspace_id, mutation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((entity_id, delete_sequence, _generation, prior_sequence, prior_updated_at)) =
        rejected
    else {
        return Ok(());
    };
    let deleted = transaction
        .execute(
            "DELETE FROM sync_tombstones
             WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
               AND deleted_local_commit_sequence=?3 AND state='pending'
               AND barrier_state='pending' AND deleted_server_revision IS NULL",
            params![workspace_id, entity_id, delete_sequence],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if deleted != 1 {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    let restored = transaction
        .execute(
            "UPDATE domain_assets SET lifecycle_status='active', deleted_at=NULL,
               updated_at=?3, local_commit_sequence=?4
             WHERE workspace_id=?1 AND entity_id=?2 AND deleted_at IS NOT NULL",
            params![workspace_id, entity_id, prior_updated_at, prior_sequence],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if restored != 1 {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    transaction
        .execute(
            "DELETE FROM domain_asset_field_versions
             WHERE workspace_id=?1 AND entity_id=?2 AND field_path='lifecycleStatus'
               AND local_commit_sequence=?3 AND sync_state='pending'",
            params![workspace_id, entity_id, delete_sequence],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

/// Replaces the tombstone `check_replicated_re_add` accepted with a live row of the next
/// generation. The record comes first because the schema requires it before the tombstone may go
/// and before the generation may change. The row restarts as a new entity: synchronized fields,
/// tags and local desired state return to their defaults with the re-add's revision, local
/// lifecycle facts (acquisition, expiry, renewal, lock) are cleared, and field versions of the old
/// generation are dropped, so nothing of the deleted generation resurfaces. Provider bindings and
/// observations describe the real-world domain rather than this entity, so they are kept.
pub(super) fn supersede_replicated_tombstone(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
    deleted_revision: u64,
    local_commit_sequence: i64,
) -> Result<(), BusinessDatabaseError> {
    let generation = i64::try_from(mutation.entity_generation)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let deleted_revision =
        i64::try_from(deleted_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let server_revision =
        i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    transaction
        .execute(
            "INSERT INTO sync_domain_asset_re_adds
             (workspace_id,entity_id,deleted_generation,deleted_server_revision,
              re_add_mutation_id,re_add_server_revision,origin,local_commit_sequence)
             VALUES (?1,?2,?3,?4,?5,?6,'replicated',?7)",
            params![
                workspace_id,
                mutation.entity_id,
                generation - 1,
                deleted_revision,
                mutation.mutation_id,
                server_revision,
                local_commit_sequence,
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "DELETE FROM sync_tombstones
             WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",
            params![workspace_id, mutation.entity_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    // A tombstone that arrived before any asset row has no row to reset; the upsert that follows
    // creates it at the new generation, so no affected-row count is required here.
    transaction
        .execute(
            "UPDATE domain_assets SET entity_generation=?3, lifecycle_status='active',
               deleted_at=NULL, acquired_on=NULL, expires_on=NULL,
               acquisition_cost_currency=NULL, acquisition_cost_amount=NULL, auto_renew=NULL,
               registrar_lock=NULL, local_commit_sequence=?4,
               updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND entity_id=?2",
            params![
                workspace_id,
                mutation.entity_id,
                generation,
                local_commit_sequence
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "UPDATE portfolio_domain_assets SET note=NULL, portfolio_id=NULL, tags_json='[]',
               target_price_currency=NULL, target_price_amount=NULL, note_server_revision=?3,
               portfolio_id_server_revision=?3, tags_server_revision=?3,
               target_price_server_revision=?3
             WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, mutation.entity_id, server_revision],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "UPDATE domain_asset_desired_state SET portfolio_id=NULL, note=NULL,
               target_price_currency=NULL, target_price_amount=NULL, desired_sale_status='hold',
               desired_nameservers_json='[]', local_commit_sequence=?3,
               updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, mutation.entity_id, local_commit_sequence],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for statement in [
        "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
        "DELETE FROM domain_asset_field_versions WHERE workspace_id=?1 AND entity_id=?2",
    ] {
        transaction
            .execute(statement, params![workspace_id, mutation.entity_id])
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    Ok(())
}

// Both manual creation and a complete market scan use the asset owner's exact mutation rules.
// The caller owns the one transaction and retains its final authorization guard through COMMIT.
#[expect(
    clippy::too_many_arguments,
    clippy::too_many_lines,
    reason = "one asset mutation retains explicit identity, CAS and authorizing epoch"
)]
fn mutate_domain_asset_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    workspace_id: &str,
    operation: &str,
    mutation_id: &str,
    entity_id: &str,
    expected_asset_version: u64,
    device_id: &str,
    active_lease_epoch: u64,
    committed_at: &str,
    edit: Option<&DomainAssetWrite>,
    allow_new: bool,
) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError> {
    let payload = if let Some(asset) = edit {
        sync_payload(&DomainAssetProjectionRow {
            entity_id: asset.entity_id.clone(),
            note: asset.note.clone(),
            portfolio_id: asset.portfolio_id.clone(),
            tags: asset.tags.clone(),
            target_price: asset.target_price.clone(),
        })?
    } else {
        serde_json::json!({"entityId": entity_id, "operation": "delete"}).to_string()
    };
    let digest = hex_digest(payload.as_bytes());
    let existing: Option<ExistingMutationRow> = transaction.query_row(
            "SELECT entity_id,entity_kind,operation_kind,mutation_payload_sha256,local_commit_sequence,device_mutation_sequence,base_server_revision,created_at,source_device_id,active_lease_epoch,payload_schema_version,re_adds_deleted_revision FROM sync_outbox WHERE workspace_id=?1 AND mutation_id=?2",
            params![workspace_id, mutation_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?))).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if let Some((
        stored_entity,
        kind,
        stored_op,
        stored_digest,
        local_seq,
        device_seq,
        base_rev,
        created,
        source_device,
        stored_epoch,
        payload_schema,
        stored_re_add_revision,
    )) = existing
    {
        let expected_op = if operation == "delete" {
            "delete"
        } else {
            "upsert"
        };
        if stored_entity != entity_id
            || kind != "domain_asset"
            || stored_op != expected_op
            || stored_digest.as_deref() != Some(&digest)
            || source_device.as_deref() != Some(device_id)
            || payload_schema != 1
        {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let receipt = DomainAssetMutationReceipt {
            schema_version: 1,
            disposition: "replayed".to_owned(),
            operation: if stored_re_add_revision.is_some() {
                "re_add".to_owned()
            } else {
                operation.to_owned()
            },
            mutation_id: mutation_id.to_owned(),
            entity_id: entity_id.to_owned(),
            local_commit_sequence: u64::try_from(local_seq)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            device_mutation_sequence: u64::try_from(
                device_seq.ok_or(BusinessDatabaseError::StorageRejected)?,
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            base_server_revision: u64::try_from(base_rev)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            active_lease_epoch: u64::try_from(
                stored_epoch.ok_or(BusinessDatabaseError::MutationConflict)?,
            )
            .map_err(|_| BusinessDatabaseError::MutationConflict)?,
            committed_at: created,
            read_generation: 0,
        };
        return Ok(receipt);
    }
    if !allow_new {
        return Err(BusinessDatabaseError::MutationStale);
    }
    let stored: Option<(i64, Option<String>)> = transaction.query_row("SELECT local_commit_sequence, deleted_at FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2", params![workspace_id, entity_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
    // ADR-0029 decision 4: a provisional re-add freezes its entity until Cloud answers, so a
    // rejection has only that one Outbox row to undo. The schema refuses the write as well.
    let frozen: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds
                 WHERE workspace_id=?1 AND entity_id=?2)",
            params![workspace_id, entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if frozen {
        return Err(BusinessDatabaseError::AssetReAddPending);
    }
    let mut re_adds: Option<(i64, i64)> = None;
    if operation == "re_add" {
        if expected_asset_version != 0 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        match stored {
            None => return Err(BusinessDatabaseError::AssetNotFound),
            Some((_, None)) => return Err(BusinessDatabaseError::AssetExists),
            Some((_, Some(_))) => {}
        }
        re_adds = Some(check_local_re_add(transaction, workspace_id, entity_id)?);
    } else if operation == "create" {
        // The entity ID is the canonical domain, so the domain is the deduplication key: adding
        // a domain the workspace already holds, from an import or by hand, is refused rather
        // than merged. A deleted domain keeps its tombstone until the delete has synced and
        // been acknowledged and settled, so only the explicit re-add preconditions can
        // advance it to the next generation.
        if expected_asset_version != 0 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let tombstoned: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM sync_tombstones WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2)", params![workspace_id, entity_id], |row| row.get(0)).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        match stored {
            Some((_, None)) => return Err(BusinessDatabaseError::AssetExists),
            // Until the re-add entry is qualified, a deleted domain answers exactly as it did
            // before re-adding existed, so production has no executable re-add path.
            Some((_, Some(_))) if !local_re_add_entry_open() => {
                return Err(BusinessDatabaseError::AssetDeleted);
            }
            None if tombstoned && !local_re_add_entry_open() => {
                return Err(BusinessDatabaseError::AssetDeleted);
            }
            Some((_, Some(_))) => {
                re_adds = Some(check_local_re_add(transaction, workspace_id, entity_id)?);
            }
            None if tombstoned => return Err(BusinessDatabaseError::AssetReAddBlocked),
            None => {}
        }
    } else {
        let (current_version, deleted) = stored.ok_or(BusinessDatabaseError::AssetNotFound)?;
        if deleted.is_some() {
            return Err(BusinessDatabaseError::AssetDeleted);
        }
        if u64::try_from(current_version).ok() != Some(expected_asset_version) {
            return Err(BusinessDatabaseError::MutationStale);
        }
    }
    let (local_seq, base_rev, device_seq): (i64, i64, i64) = transaction.query_row("UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1, next_device_mutation_sequence=next_device_mutation_sequence+1, updated_at=?1 WHERE singleton=1 RETURNING local_commit_sequence, applied_through_server_revision, next_device_mutation_sequence-1", [committed_at], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    if operation == "create" && re_adds.is_none() {
        let asset = edit.expect("create operation carries asset");
        let tags_json =
            serde_json::to_string(&asset.tags).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let (currency, amount) = (
            asset.target_price.as_ref().map(|money| &money.currency),
            asset.target_price.as_ref().map(|money| &money.amount),
        );
        transaction.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES (?1,?2,'active',?3,?3,?4)", params![workspace_id, entity_id, committed_at, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO domain_asset_desired_state (workspace_id,entity_id,portfolio_id,note,target_price_currency,target_price_amount,desired_sale_status,desired_nameservers_json,local_commit_sequence,updated_at) VALUES (?1,?2,?3,?4,?5,?6,'hold','[]',?7,?8)", params![workspace_id, entity_id, asset.portfolio_id, asset.note, currency, amount, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for tag in &asset.tags {
            transaction.execute("INSERT INTO domain_asset_tags (workspace_id,entity_id,tag,local_commit_sequence) VALUES (?1,?2,?3,?4)", params![workspace_id, entity_id, tag, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction.execute("INSERT INTO portfolio_domain_assets (workspace_id,entity_id,note,portfolio_id,tags_json,target_price_currency,target_price_amount,note_server_revision,portfolio_id_server_revision,tags_server_revision,target_price_server_revision) VALUES (?1,?2,?3,?4,?5,?6,?7,0,0,0,0)", params![workspace_id, entity_id, asset.note, asset.portfolio_id, tags_json, currency, amount]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for field_path in ["note", "portfolioId", "tags", "targetPrice"] {
            transaction.execute("INSERT INTO domain_asset_field_versions (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at) VALUES (?1,?2,?3,?4,?5,'pending',?6)", params![workspace_id, entity_id, field_path, base_rev, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
    } else if operation == "edit" {
        let asset = edit.expect("edit operation carries asset");
        transaction.execute("UPDATE domain_assets SET updated_at=?3, local_commit_sequence=?4 WHERE workspace_id=?1 AND entity_id=?2", params![workspace_id, entity_id, committed_at, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("UPDATE domain_asset_desired_state SET portfolio_id=?3,note=?4,target_price_currency=?5,target_price_amount=?6,local_commit_sequence=?7,updated_at=?8 WHERE workspace_id=?1 AND entity_id=?2", params![workspace_id, entity_id, asset.portfolio_id, asset.note, asset.target_price.as_ref().map(|m| &m.currency), asset.target_price.as_ref().map(|m| &m.amount), local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, entity_id],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for tag in &asset.tags {
            transaction.execute("INSERT INTO domain_asset_tags (workspace_id,entity_id,tag,local_commit_sequence) VALUES (?1,?2,?3,?4)", params![workspace_id, entity_id, tag, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction.execute("UPDATE portfolio_domain_assets SET note=?3,portfolio_id=?4,tags_json=?5,target_price_currency=?6,target_price_amount=?7 WHERE workspace_id=?1 AND entity_id=?2", params![workspace_id, entity_id, asset.note, asset.portfolio_id, serde_json::to_string(&asset.tags).map_err(|_| BusinessDatabaseError::InvalidInput)?, asset.target_price.as_ref().map(|m| &m.currency), asset.target_price.as_ref().map(|m| &m.amount)]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for field_path in ["note", "portfolioId", "tags", "targetPrice"] {
            transaction.execute("INSERT INTO domain_asset_field_versions (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at) VALUES (?1,?2,?3,?4,?5,'pending',?6) ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET local_commit_sequence=excluded.local_commit_sequence,sync_state='pending',updated_at=excluded.updated_at", params![workspace_id, entity_id, field_path, base_rev, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
    } else if let Some((deleted_generation, deleted_revision)) = re_adds {
        let asset = edit.expect("re-add operation carries asset");
        write_local_re_add(
            transaction,
            workspace_id,
            mutation_id,
            asset,
            (deleted_generation, deleted_revision),
            (local_seq, base_rev),
            committed_at,
        )?;
    } else {
        transaction.execute("UPDATE domain_assets SET lifecycle_status='archived',deleted_at=?3,updated_at=?3,local_commit_sequence=?4 WHERE workspace_id=?1 AND entity_id=?2", params![workspace_id, entity_id, committed_at, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO domain_asset_field_versions (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at) VALUES (?1,?2,'lifecycleStatus',?3,?4,'pending',?5) ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET local_commit_sequence=excluded.local_commit_sequence,sync_state='pending',updated_at=excluded.updated_at", params![workspace_id, entity_id, base_rev, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO sync_tombstones (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,deleted_server_revision,deleted_at,purge_after,state,barrier_state,entity_generation) VALUES (?1,'domain_asset',?2,?3,NULL,?4,NULL,'pending','pending',COALESCE((SELECT entity_generation FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2),1))", params![workspace_id, entity_id, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    let lease_epoch =
        i64::try_from(active_lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let operation_kind = if operation == "delete" {
        "delete"
    } else {
        "upsert"
    };
    transaction.execute("INSERT INTO sync_outbox (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at,workspace_schema_version,operation_kind,base_server_revision,local_commit_sequence,source_device_id,active_lease_epoch,device_mutation_sequence,payload_schema_version,mutation_payload_sha256,state,entity_generation,re_adds_deleted_revision) VALUES (?1,?2,'domain_asset',?3,?4,?5,1,?6,?7,?8,?9,?10,?11,1,?12,'pending',COALESCE((SELECT entity_generation FROM domain_assets WHERE workspace_id=?1 AND entity_id=?3),1),?13)", params![workspace_id, mutation_id, entity_id, payload, committed_at, operation_kind, base_rev, local_seq, device_id, lease_epoch, device_seq, digest, re_adds.map(|(_, revision)| revision)]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if operation == "create" || operation == "re_add" {
        // The wire keeps creation an upsert; the Host-only marker lets history name it. A
        // re-add starts a new generation, so each attempt is marked as an add of its own.
        transaction
            .execute(
                "INSERT INTO sync_outbox_local_creations (workspace_id,mutation_id) VALUES (?1,?2)",
                params![workspace_id, mutation_id],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    if let Some(asset) = edit {
        let values = [
            ("note", serde_json::to_string(&asset.note)),
            ("portfolioId", serde_json::to_string(&asset.portfolio_id)),
            ("tags", serde_json::to_string(&asset.tags)),
            ("targetPrice", serde_json::to_string(&asset.target_price)),
        ];
        for (ordinal, (field, value)) in values.into_iter().enumerate() {
            let value = value.map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction.execute("INSERT INTO sync_outbox_fields (workspace_id,mutation_id,ordinal,field_path,field_value_json,field_value_sha256) VALUES (?1,?2,?3,?4,?5,?6)", params![workspace_id, mutation_id, i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?, field, value, hex_digest(value.as_bytes())]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
    }
    Ok(DomainAssetMutationReceipt {
        schema_version: 1,
        disposition: "committed".to_owned(),
        operation: if re_adds.is_some() {
            "re_add".to_owned()
        } else {
            operation.to_owned()
        },
        mutation_id: mutation_id.to_owned(),
        entity_id: entity_id.to_owned(),
        local_commit_sequence: u64::try_from(local_seq)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        device_mutation_sequence: u64::try_from(device_seq)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        base_server_revision: u64::try_from(base_rev)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        active_lease_epoch,
        committed_at: committed_at.to_owned(),
        read_generation: 0,
    })
}

/// Portfolio discovery never resurrects a tombstone or changes a user's existing fields.
/// `None` means the caller must report the skipped domain without publishing a new binding.
pub(super) fn import_market_asset(
    transaction: &rusqlite::Transaction<'_>,
    workspace_id: &str,
    mutation_id: &str,
    device_id: &str,
    active_lease_epoch: u64,
    committed_at: &str,
    entity_id: &str,
) -> Result<Option<bool>, BusinessDatabaseError> {
    validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_timestamp(Some(committed_at.to_owned()))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let asset = DomainAssetWrite {
        entity_id: entity_id.to_owned(),
        note: None,
        portfolio_id: None,
        tags: Vec::new(),
        target_price: None,
    };
    validate_domain_asset(&asset)?;
    let blocked: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_tombstones WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2)
             OR EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds WHERE workspace_id=?1 AND entity_id=?2)
             OR EXISTS(SELECT 1 FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2 AND (deleted_at IS NOT NULL OR lifecycle_status='archived'))",
        params![workspace_id,entity_id], |row| row.get(0),
    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if blocked {
        return Ok(None);
    }
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2)",
            params![workspace_id, entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if exists {
        return Ok(Some(false));
    }
    mutate_domain_asset_in_transaction(
        transaction,
        workspace_id,
        "create",
        mutation_id,
        entity_id,
        0,
        device_id,
        active_lease_epoch,
        committed_at,
        Some(&asset),
        true,
    )?;
    Ok(Some(true))
}
