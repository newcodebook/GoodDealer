//! Conflict evidence and resolution.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    BusinessDatabase, BusinessDatabaseError, DomainAssetProjectionRow,
    ExistingResolutionReceiptRow, LOCAL_WIRE_SCHEMA_VERSION, Money, OptionalExtension,
    SyncConflictCandidate, SyncMutationV2, SyncResolutionReceipt, TransactionBehavior,
    canonical_mutation_digest, hex_digest, params, sync_payload, validate_identifier,
};

impl BusinessDatabase {
    /// Resolves one persisted candidate. `accept_remote` never creates an outbox mutation;
    /// `keep_local` creates exactly one fresh sequenced mutation and is forbidden for deletes.
    /// # Errors
    ///
    /// Returns an input, stale-CAS, conflict, or storage error.
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded conflict port remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn resolve_sync_conflict(
        &mut self,
        resolution_id: &str,
        conflict_id: &str,
        expected_candidate_set_version: u64,
        expected_candidate_version: u64,
        expected_remote_revision: u64,
        expected_current_value_hash: &str,
        choice: &str,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
    ) -> Result<SyncResolutionReceipt, BusinessDatabaseError> {
        self.resolve_sync_conflict_guarded(
            resolution_id,
            conflict_id,
            expected_candidate_set_version,
            expected_candidate_version,
            expected_remote_revision,
            expected_current_value_hash,
            choice,
            device_id,
            active_lease_epoch,
            committed_at,
            || Ok(()),
        )
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    /// Resolves a conflict with a final Host fence immediately before commit.
    ///
    /// # Errors
    ///
    /// Returns a closed input, stale-CAS, conflict, storage, or Host fence error.
    pub fn resolve_sync_conflict_guarded(
        &mut self,
        resolution_id: &str,
        conflict_id: &str,
        expected_candidate_set_version: u64,
        expected_candidate_version: u64,
        expected_remote_revision: u64,
        expected_current_value_hash: &str,
        choice: &str,
        device_id: &str,
        active_lease_epoch: u64,
        committed_at: &str,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncResolutionReceipt, BusinessDatabaseError> {
        validate_identifier(resolution_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(conflict_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !matches!(choice, "accept_remote" | "keep_local")
            || expected_candidate_set_version == 0
            || expected_candidate_version == 0
            || expected_remote_revision == 0
            || active_lease_epoch == 0
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let existing: Option<ExistingResolutionReceiptRow> = transaction.query_row(
            "SELECT conflict_id,choice,outbox_mutation_id,candidate_set_version,remote_server_revision,current_value_hash,choice_digest FROM sync_resolution_receipts WHERE workspace_id=?1 AND resolution_id=?2",
            params![self.workspace_id, resolution_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
        ).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if let Some((
            stored_conflict,
            stored_choice,
            outbox_mutation_id,
            stored_set,
            stored_revision,
            stored_hash,
            stored_digest,
        )) = existing
        {
            let expected_digest = resolution_choice_digest(
                resolution_id,
                conflict_id,
                expected_candidate_set_version,
                expected_candidate_version,
                expected_remote_revision,
                expected_current_value_hash,
                choice,
            );
            if stored_conflict != conflict_id
                || stored_choice != choice
                || u64::try_from(stored_set).ok() != Some(expected_candidate_set_version)
                || u64::try_from(stored_revision).ok() != Some(expected_remote_revision)
                || stored_hash != expected_current_value_hash
                || stored_digest != expected_digest
            {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            commit_fence()?;
            transaction
                .commit()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            return Ok(SyncResolutionReceipt {
                resolution_id: resolution_id.to_owned(),
                conflict_id: conflict_id.to_owned(),
                choice: stored_choice,
                outbox_mutation_id,
            });
        }
        let (entity_id, field_path, remote_json, local_hash, candidate_version, remote_revision, status): (String,String,String,String,i64,i64,String) = transaction.query_row(
            "SELECT entity_id,field_path,remote_value_json,local_value_hash,candidate_version,remote_server_revision,status FROM sync_conflicts WHERE workspace_id=?1 AND conflict_id=?2",
            params![self.workspace_id, conflict_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?))
        ).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?.ok_or(BusinessDatabaseError::AssetNotFound)?;
        let current_value =
            read_resolution_field(&transaction, &self.workspace_id, &entity_id, &field_path)?;
        let current_hash = hex_digest(
            serde_json::to_string(&current_value)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
                .as_bytes(),
        );
        if status != "open"
            || u64::try_from(candidate_version).ok() != Some(expected_candidate_version)
            || u64::try_from(remote_revision).ok() != Some(expected_remote_revision)
            || current_hash != expected_current_value_hash
            || local_hash != expected_current_value_hash
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let candidate_set_version: i64 = transaction.query_row(
            "SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton=1",
            [], |row| row.get(0)
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if u64::try_from(candidate_set_version).ok() != Some(expected_candidate_set_version) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let involved_outcome_unknown: i64 = transaction.query_row(
            "SELECT count(*) FROM sync_outbox WHERE workspace_id=?1 AND entity_id=?2 AND state='sending'",
            params![self.workspace_id, entity_id], |row| row.get(0)
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        // A pinned pull target can contain the mutation blocked by this conflict. Requiring every
        // reader to reach that target here would make the conflict and Inbox mutually unblockable.
        // Candidate identity, current-value hash, and candidate-set revision above still fence a
        // stale choice; mutations not yet read are applied afterward in server-revision order.
        if involved_outcome_unknown != 0 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let mut outbox_mutation_id = None;
        if choice == "keep_local" {
            if field_path == "lifecycleStatus" {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            let mutation_id = format!("resolution-{resolution_id}");
            let projection =
                read_resolution_projection(&transaction, &self.workspace_id, &entity_id)?;
            let payload = sync_payload(&projection)?;
            let digest = hex_digest(payload.as_bytes());
            let (local_seq, device_seq, base_rev): (i64,i64,i64) = transaction.query_row(
                "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,next_device_mutation_sequence=next_device_mutation_sequence+1 RETURNING local_commit_sequence,next_device_mutation_sequence-1,applied_through_server_revision", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute(
                "INSERT INTO sync_outbox (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at,operation_kind,base_server_revision,local_commit_sequence,source_device_id,active_lease_epoch,device_mutation_sequence,payload_schema_version,mutation_payload_sha256,state,entity_generation) VALUES (?1,?2,'domain_asset',?3,?4,?5,'upsert',?6,?7,?8,?9,?10,1,?11,'pending',COALESCE((SELECT entity_generation FROM domain_assets WHERE workspace_id=?1 AND entity_id=?3),1))",
                params![self.workspace_id, mutation_id, entity_id, payload, committed_at, base_rev, local_seq, device_id, i64::try_from(active_lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?, device_seq, digest]
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let values = [
                ("note", serde_json::to_string(&projection.note)),
                (
                    "portfolioId",
                    serde_json::to_string(&projection.portfolio_id),
                ),
                ("tags", serde_json::to_string(&projection.tags)),
                (
                    "targetPrice",
                    serde_json::to_string(&projection.target_price),
                ),
            ];
            for (ordinal, (path, value)) in values.into_iter().enumerate() {
                let value = value.map_err(|_| BusinessDatabaseError::InvalidInput)?;
                transaction.execute("INSERT INTO sync_outbox_fields (workspace_id,mutation_id,ordinal,field_path,field_value_json,field_value_sha256) VALUES (?1,?2,?3,?4,?5,?6)", params![self.workspace_id,mutation_id,i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?,path,value,hex_digest(value.as_bytes())]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            outbox_mutation_id = Some(mutation_id);
        } else {
            transaction.execute("UPDATE sync_conflicts SET status='resolved_remote',resolved_at=?1,resolution_id=?2,choice_digest=?3 WHERE workspace_id=?4 AND conflict_id=?5", params![committed_at,resolution_id,hex_digest(choice.as_bytes()),self.workspace_id,conflict_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            apply_remote_resolution(
                &transaction,
                &self.workspace_id,
                &entity_id,
                &field_path,
                &remote_json,
                remote_revision,
                committed_at,
            )?;
        }
        let choice_digest = resolution_choice_digest(
            resolution_id,
            conflict_id,
            expected_candidate_set_version,
            expected_candidate_version,
            expected_remote_revision,
            expected_current_value_hash,
            choice,
        );
        transaction.execute("INSERT INTO sync_resolution_receipts (workspace_id,resolution_id,conflict_id,candidate_version,choice,choice_digest,outbox_mutation_id,resolved_at,candidate_set_version,remote_server_revision,current_value_hash) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", params![self.workspace_id,resolution_id,conflict_id,candidate_version,choice,choice_digest,outbox_mutation_id,committed_at,i64::try_from(expected_candidate_set_version).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(expected_remote_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?,expected_current_value_hash]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if choice == "keep_local" {
            transaction.execute("UPDATE sync_conflicts SET status='resolved_local',resolved_at=?1,resolution_id=?2,choice_digest=?3 WHERE workspace_id=?4 AND conflict_id=?5", params![committed_at,resolution_id,hex_digest(choice.as_bytes()),self.workspace_id,conflict_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        commit_fence()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(SyncResolutionReceipt {
            resolution_id: resolution_id.to_owned(),
            conflict_id: conflict_id.to_owned(),
            choice: choice.to_owned(),
            outbox_mutation_id,
        })
    }
}

pub(super) fn read_local_conflict_value(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
    field_path: &str,
) -> Result<serde_json::Value, BusinessDatabaseError> {
    let value: Option<serde_json::Value> = match field_path {
        "note" => transaction
            .query_row(
                "SELECT note FROM portfolio_domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, entity_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .map(|value| value.map_or(serde_json::Value::Null, serde_json::Value::String)),
        "portfolioId" => transaction
            .query_row(
                "SELECT portfolio_id FROM portfolio_domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, entity_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .map(|value| value.map_or(serde_json::Value::Null, serde_json::Value::String)),
        "tags" => transaction
            .query_row(
                "SELECT tags_json FROM portfolio_domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, entity_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .map(|value| value
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(|| serde_json::json!([]))),
        "targetPrice" => transaction
            .query_row(
                "SELECT target_price_currency,target_price_amount FROM portfolio_domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, entity_id],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .map(|(currency, amount)| match (currency, amount) {
                (Some(currency), Some(amount)) => serde_json::json!({"currency": currency, "amount": amount}),
                _ => serde_json::Value::Null,
            }),
        "lifecycleStatus" => transaction
            .query_row(
                "SELECT lifecycle_status FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, entity_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .map(serde_json::Value::String),
        _ => return Err(BusinessDatabaseError::InvalidInput),
    };
    Ok(value.unwrap_or(serde_json::Value::Null))
}

#[allow(clippy::needless_pass_by_value)]
pub(super) fn persist_conflict_candidate(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
    field_path: &str,
    local_value: serde_json::Value,
    remote_override: Option<serde_json::Value>,
) -> Result<(), BusinessDatabaseError> {
    let remote_value = remote_override.unwrap_or_else(|| {
        if mutation.operation_kind == "delete" {
            serde_json::json!({"deletedAt": mutation.deleted_at})
        } else {
            mutation
                .changed_fields
                .iter()
                .find(|field| field.field_path == field_path)
                .map_or_else(|| serde_json::Value::Null, |field| field.value.clone())
        }
    });
    let local_json =
        serde_json::to_string(&local_value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let remote_json =
        serde_json::to_string(&remote_value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let conflict_id = format!("conflict-{}-{}", mutation.mutation_id, field_path);
    let remote_digest = canonical_mutation_digest(mutation, LOCAL_WIRE_SCHEMA_VERSION)?;
    let local_hash = hex_digest(local_json.as_bytes());
    let remote_hash = hex_digest(remote_json.as_bytes());
    let local_commit_sequence: i64 = transaction
        .query_row(
            "SELECT local_commit_sequence FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, mutation.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO sync_conflicts
             (workspace_id,conflict_id,entity_kind,entity_id,field_path,
              local_value_json,remote_value_json,local_commit_sequence,remote_server_revision,
              status,created_at,candidate_version,remote_source_device_id,remote_mutation_digest,
              remote_order_server_revision,remote_order_source_device_id,remote_order_mutation_id,
              local_value_hash,remote_value_hash)
             VALUES (?1,?2,'domain_asset',?3,?4,?5,?6,?7,?8,'open',
                     strftime('%Y-%m-%dT%H:%M:%SZ','now'),?8,?9,?10,?8,?9,?11,?12,?13)",
            params![
                workspace_id,
                conflict_id,
                mutation.entity_id,
                field_path,
                local_json,
                remote_json,
                local_commit_sequence,
                i64::try_from(mutation.server_revision)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                mutation.source_device_id,
                remote_digest,
                mutation.mutation_id,
                local_hash,
                remote_hash,
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

#[cfg(test)]
#[expect(
    clippy::too_many_lines,
    reason = "the generation check, provenance, and field merge of one checkpoint asset share a transaction"
)]
pub(super) fn merge_checkpoint_existing_asset(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    asset: &DomainAssetWrite,
    checkpoint_generation: u64,
    checkpoint_revision: u64,
) -> Result<(), BusinessDatabaseError> {
    // A checkpoint asset merges only into a live local row of the same generation: an older
    // snapshot must not overwrite the entity after a re-add, and a newer one is not this row.
    let local_generation: Option<(i64, Option<String>)> = transaction
        .query_row(
            "SELECT entity_generation, deleted_at FROM domain_assets
             WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, asset.entity_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if !matches!(local_generation, Some((generation, None)) if u64::try_from(generation).ok() == Some(checkpoint_generation))
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let root_provenance: String = transaction.query_row(
        "SELECT root_provenance FROM sync_asset_provenance WHERE workspace_id=?1 AND entity_id=?2",
        params![workspace_id, asset.entity_id], |row| row.get(0)
    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if !matches!(root_provenance.as_str(), "replicated" | "local_only") {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let revision =
        i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let values = [
        (
            "note",
            serde_json::to_value(&asset.note).map_err(|_| BusinessDatabaseError::InvalidInput)?,
        ),
        (
            "portfolioId",
            serde_json::to_value(&asset.portfolio_id)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
        ),
        (
            "tags",
            serde_json::to_value(&asset.tags).map_err(|_| BusinessDatabaseError::InvalidInput)?,
        ),
        (
            "targetPrice",
            serde_json::to_value(&asset.target_price)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
        ),
    ];
    for (field, value) in values {
        let field_metadata: Option<(String, String)> = transaction
            .query_row(
                "SELECT sync_state, provenance
             FROM domain_asset_field_versions
             WHERE workspace_id=?1 AND entity_id=?2 AND field_path=?3",
                params![workspace_id, asset.entity_id, field],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (state, field_provenance) =
            field_metadata.ok_or(BusinessDatabaseError::StorageRejected)?;
        if !matches!(
            state.as_str(),
            "clean" | "pending" | "conflicted" | "local_only"
        ) || !matches!(field_provenance.as_str(), "replicated" | "local_only")
        {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        let local = read_resolution_field(transaction, workspace_id, &asset.entity_id, field)?;
        if root_provenance == "local_only" || field_provenance == "local_only" || state != "clean" {
            if local != value {
                persist_checkpoint_conflict_candidate(
                    transaction,
                    workspace_id,
                    &asset.entity_id,
                    field,
                    &local,
                    &value,
                    checkpoint_revision,
                )?;
            }
            continue;
        }
        apply_remote_resolution(
            transaction,
            workspace_id,
            &asset.entity_id,
            field,
            &serde_json::to_string(&value).map_err(|_| BusinessDatabaseError::InvalidInput)?,
            revision,
            "checkpoint",
        )?;
        transaction.execute(
            "UPDATE domain_asset_field_versions SET provenance='replicated',freshness='confirmed',server_revision=?1 WHERE workspace_id=?2 AND entity_id=?3 AND field_path=?4",
            params![revision,workspace_id,asset.entity_id,field],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    if root_provenance == "replicated" {
        transaction
            .execute(
                "UPDATE sync_asset_provenance
             SET replicated_server_revision=?1,freshness='confirmed',
                 updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?2 AND entity_id=?3 AND root_provenance='replicated'",
                params![revision, workspace_id, asset.entity_id],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn persist_checkpoint_conflict_candidate(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
    field_path: &str,
    local_value: &serde_json::Value,
    remote_value: &serde_json::Value,
    checkpoint_revision: u64,
) -> Result<(), BusinessDatabaseError> {
    if checkpoint_revision == 0 {
        return Err(BusinessDatabaseError::RevisionRejected);
    }
    let local_json =
        serde_json::to_string(&local_value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let remote_json =
        serde_json::to_string(&remote_value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let remote_digest = canonical_sync_digest(&serde_json::json!({
        "checkpointRevision": checkpoint_revision,
        "entityId": entity_id,
        "fieldPath": field_path,
        "value": remote_value,
    }))?;
    let conflict_id = format!(
        "conflict-checkpoint-{checkpoint_revision}-{}",
        &hex_digest(format!("{entity_id}\0{field_path}").as_bytes())[..16]
    );
    let local_commit_sequence: i64 = transaction.query_row(
        "SELECT local_commit_sequence FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
        params![workspace_id,entity_id], |row| row.get(0)
    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let revision =
        i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    transaction.execute(
        "INSERT OR IGNORE INTO sync_conflicts
         (workspace_id,conflict_id,entity_kind,entity_id,field_path,local_value_json,remote_value_json,
          local_commit_sequence,remote_server_revision,status,created_at,candidate_version,
          remote_source_device_id,remote_mutation_digest,remote_order_server_revision,
          remote_order_source_device_id,remote_order_mutation_id,local_value_hash,remote_value_hash)
         VALUES (?1,?2,'domain_asset',?3,?4,?5,?6,?7,?8,'open',strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                 ?8,'checkpoint',?9,?8,'checkpoint',?10,?11,?12)",
        params![workspace_id,conflict_id,entity_id,field_path,local_json,remote_json,
            local_commit_sequence,revision,remote_digest,format!("checkpoint-{checkpoint_revision}"),
            hex_digest(local_json.as_bytes()),hex_digest(remote_json.as_bytes())],
    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

fn read_resolution_projection(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
) -> Result<DomainAssetProjectionRow, BusinessDatabaseError> {
    let (note, portfolio_id, tags_json, currency, amount): (Option<String>,Option<String>,String,Option<String>,Option<String>) = transaction.query_row(
        "SELECT note,portfolio_id,tags_json,target_price_currency,target_price_amount FROM portfolio_domain_assets WHERE workspace_id=?1 AND entity_id=?2",
        params![workspace_id, entity_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))
    ).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?.ok_or(BusinessDatabaseError::AssetNotFound)?;
    let tags =
        serde_json::from_str(&tags_json).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let target_price = match (currency, amount) {
        (Some(currency), Some(amount)) => Some(Money { currency, amount }),
        _ => None,
    };
    Ok(DomainAssetProjectionRow {
        entity_id: entity_id.to_owned(),
        note,
        portfolio_id,
        tags,
        target_price,
    })
}

fn read_resolution_field(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
    field_path: &str,
) -> Result<serde_json::Value, BusinessDatabaseError> {
    let projection = read_resolution_projection(transaction, workspace_id, entity_id)?;
    match field_path {
        "note" => Ok(projection
            .note
            .map_or(serde_json::Value::Null, serde_json::Value::String)),
        "portfolioId" => Ok(projection
            .portfolio_id
            .map_or(serde_json::Value::Null, serde_json::Value::String)),
        "tags" => serde_json::to_value(projection.tags)
            .map_err(|_| BusinessDatabaseError::StorageRejected),
        "targetPrice" => serde_json::to_value(projection.target_price)
            .map_err(|_| BusinessDatabaseError::StorageRejected),
        "lifecycleStatus" => transaction
            .query_row(
                "SELECT lifecycle_status FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, entity_id],
                |row| row.get::<_, String>(0),
            )
            .map(serde_json::Value::String)
            .map_err(|_| BusinessDatabaseError::StorageRejected),
        _ => Err(BusinessDatabaseError::InvalidInput),
    }
}

fn resolution_choice_digest(
    resolution_id: &str,
    conflict_id: &str,
    candidate_set_version: u64,
    candidate_version: u64,
    remote_revision: u64,
    current_value_hash: &str,
    choice: &str,
) -> String {
    let value = format!(
        "{resolution_id}\0{conflict_id}\0{candidate_set_version}\0{candidate_version}\0{remote_revision}\0{current_value_hash}\0{choice}"
    );
    hex_digest(value.as_bytes())
}

fn apply_remote_resolution(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
    field_path: &str,
    remote_json: &str,
    remote_revision: i64,
    committed_at: &str,
) -> Result<(), BusinessDatabaseError> {
    let value: serde_json::Value =
        serde_json::from_str(remote_json).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    match field_path {
        "note" => {
            transaction.execute("UPDATE portfolio_domain_assets SET note=?1 WHERE workspace_id=?2 AND entity_id=?3", params![value.as_str(),workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute("UPDATE domain_asset_desired_state SET note=?1,updated_at=?2 WHERE workspace_id=?3 AND entity_id=?4", params![value.as_str(),committed_at,workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        "portfolioId" => {
            transaction.execute("UPDATE portfolio_domain_assets SET portfolio_id=?1 WHERE workspace_id=?2 AND entity_id=?3", params![value.as_str(),workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute("UPDATE domain_asset_desired_state SET portfolio_id=?1,updated_at=?2 WHERE workspace_id=?3 AND entity_id=?4", params![value.as_str(),committed_at,workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        "tags" => {
            transaction.execute("UPDATE portfolio_domain_assets SET tags_json=?1 WHERE workspace_id=?2 AND entity_id=?3", params![serde_json::to_string(&value).map_err(|_| BusinessDatabaseError::InvalidInput)?,workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
                    params![workspace_id, entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for tag in value
                .as_array()
                .ok_or(BusinessDatabaseError::InvalidInput)?
            {
                transaction.execute("INSERT INTO domain_asset_tags(workspace_id,entity_id,tag,local_commit_sequence) SELECT ?1,?2,?3,local_commit_sequence FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",params![workspace_id,entity_id,tag.as_str().ok_or(BusinessDatabaseError::InvalidInput)?]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
        }
        "targetPrice" => {
            let currency = value.get("currency").and_then(serde_json::Value::as_str);
            let amount = value.get("amount").and_then(serde_json::Value::as_str);
            transaction.execute("UPDATE portfolio_domain_assets SET target_price_currency=?1,target_price_amount=?2 WHERE workspace_id=?3 AND entity_id=?4", params![currency,amount,workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute("UPDATE domain_asset_desired_state SET target_price_currency=?1,target_price_amount=?2,updated_at=?3 WHERE workspace_id=?4 AND entity_id=?5", params![currency,amount,committed_at,workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        "lifecycleStatus" => {
            transaction.execute("UPDATE domain_assets SET lifecycle_status='archived',deleted_at=?1,updated_at=?1 WHERE workspace_id=?2 AND entity_id=?3", params![committed_at,workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute("UPDATE sync_tombstones SET state='replicated',barrier_state='replicated' WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",params![workspace_id,entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        _ => return Err(BusinessDatabaseError::InvalidInput),
    }
    transaction.execute("UPDATE domain_asset_field_versions SET server_revision=?1,sync_state='clean',updated_at=?2 WHERE workspace_id=?3 AND entity_id=?4 AND field_path=?5", params![remote_revision,committed_at,workspace_id,entity_id,field_path]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

impl BusinessDatabase {
    /// # Errors
    ///
    /// Returns an input or storage error.
    pub fn read_sync_conflicts(
        &self,
        limit: usize,
    ) -> Result<Vec<SyncConflictCandidate>, BusinessDatabaseError> {
        if !(1..=1_000).contains(&limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut statement = self.store.raw_connection().prepare(
            "SELECT conflict_id,entity_id,field_path,local_value_json,remote_value_json,
                    local_value_hash,remote_value_hash,remote_server_revision,candidate_version,status
             FROM sync_conflicts WHERE workspace_id=?1 ORDER BY remote_server_revision,conflict_id LIMIT ?2"
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map(
                params![
                    self.workspace_id,
                    i64::try_from(limit).map_err(|_| BusinessDatabaseError::InvalidInput)?
                ],
                |row| {
                    Ok(SyncConflictCandidate {
                        conflict_id: row.get(0)?,
                        entity_id: row.get(1)?,
                        field_path: row.get(2)?,
                        local_value_json: row.get(3)?,
                        remote_value_json: row.get(4)?,
                        local_value_hash: row.get(5)?,
                        remote_value_hash: row.get(6)?,
                        remote_server_revision: u64::try_from(row.get::<_, i64>(7)?).unwrap_or(0),
                        candidate_version: u64::try_from(row.get::<_, i64>(8)?).unwrap_or(0),
                        status: row.get(9)?,
                    })
                },
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}
