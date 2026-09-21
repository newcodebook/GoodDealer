use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use super::source::{
    IsolatedBackupCandidate, SensitiveAsset, SensitiveDatabaseRow, bounded_revision, hex_digest,
    read_tags_into,
};
use crate::active_workspace::business::{BusinessDatabase, BusinessDatabaseError};
use crate::portfolio_projection::DomainAssetProjectionRow;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

struct SensitiveCurrentAssets(BTreeMap<String, SensitiveAsset>);

impl std::ops::Deref for SensitiveCurrentAssets {
    type Target = BTreeMap<String, SensitiveAsset>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for SensitiveCurrentAssets {
    fn drop(&mut self) {
        for (mut entity_id, asset) in std::mem::take(&mut self.0) {
            entity_id.zeroize();
            drop(asset);
        }
    }
}

#[derive(PartialEq, Eq)]
pub(super) struct RestoreRequest<'a> {
    pub operation_id: &'a str,
    pub expected_current_revision: u64,
    pub expected_candidate_set_version: u64,
    pub expected_authority_snapshot_digest: &'a str,
}

impl std::fmt::Debug for RestoreRequest<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RestoreRequest { <redacted> }")
    }
}

/// Host-owned authority and mutation identity captured while an opaque guard is held.
#[derive(PartialEq, Eq)]
pub(super) struct RestoreAuthoritySnapshot {
    pub authority_snapshot_digest: String,
    pub source_device_id: String,
    pub active_lease_epoch: u64,
    pub committed_at: String,
}

impl Drop for RestoreAuthoritySnapshot {
    fn drop(&mut self) {
        self.authority_snapshot_digest.zeroize();
        self.source_device_id.zeroize();
        self.committed_at.zeroize();
    }
}

impl std::fmt::Debug for RestoreAuthoritySnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RestoreAuthoritySnapshot { <redacted> }")
    }
}

#[derive(PartialEq, Eq)]
pub(super) struct RestoreReceipt {
    pub operation_id: String,
    pub disposition: String,
    pub mutations: u64,
    pub tombstones: u64,
    pub unchanged: u64,
    pub local_commit_sequence: u64,
}

impl Drop for RestoreReceipt {
    fn drop(&mut self) {
        self.operation_id.zeroize();
        self.disposition.zeroize();
    }
}

impl std::fmt::Debug for RestoreReceipt {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RestoreReceipt { <redacted> }")
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RestoreHistoryPayload {
    schema_version: u8,
    operation_id: String,
    artifact_id: String,
    candidate_set_version: u64,
    candidate_digest: String,
    expected_current_revision: u64,
    authority_snapshot_digest: String,
    source_device_id: String,
    active_lease_epoch: u64,
    committed_at: String,
    mutations: u64,
    tombstones: u64,
    unchanged: u64,
    final_local_commit_sequence: u64,
}

impl Drop for RestoreHistoryPayload {
    fn drop(&mut self) {
        self.operation_id.zeroize();
        self.artifact_id.zeroize();
        self.candidate_digest.zeroize();
        self.authority_snapshot_digest.zeroize();
        self.source_device_id.zeroize();
        self.committed_at.zeroize();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteOutboxPayload<'a> {
    entity_id: &'a str,
    operation: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RootHistoryPayload<'a> {
    restore_operation_id: &'a str,
    artifact_id: &'a str,
    candidate_digest: &'a str,
    operation: &'a str,
}

fn zeroizing_json(value: &impl Serialize) -> Result<Zeroizing<String>, BusinessDatabaseError> {
    // serde_json necessarily returns an owned String. Move that allocation directly into the
    // zeroizing owner at the call boundary; it is never copied into an ordinary local owner.
    serde_json::to_string(value)
        .map(Zeroizing::new)
        .map_err(|_| BusinessDatabaseError::ProjectionRejected)
}

impl BusinessDatabase {
    /// Applies an authenticated candidate while the aggregate's authority guard is already held.
    ///
    /// Keeping acquisition outside this method makes the only legal order explicit: authority,
    /// database writer, then the `IMMEDIATE` transaction opened by [`restore`].
    pub(super) fn restore_backup_candidate_guarded<G>(
        &mut self,
        candidate: &IsolatedBackupCandidate,
        request: &RestoreRequest<'_>,
        authority_guard: &mut G,
        authority: &RestoreAuthoritySnapshot,
        pre_commit_authority_check: impl FnOnce(
            &mut G,
            &RestoreAuthoritySnapshot,
        ) -> Result<(), BusinessDatabaseError>,
    ) -> Result<RestoreReceipt, BusinessDatabaseError> {
        restore(
            self,
            candidate,
            request,
            authority_guard,
            authority,
            pre_commit_authority_check,
        )
    }
}

/// Applies a complete authenticated candidate to the current active database as fresh local
/// mutations. The opaque Host guard remains alive across the transaction and is rechecked at the
/// final pre-commit boundary.
#[expect(
    clippy::too_many_lines,
    reason = "the restore transaction keeps all CAS, mutation, guard, and commit ordering contiguous"
)]
pub(super) fn restore<G>(
    database: &mut BusinessDatabase,
    candidate: &IsolatedBackupCandidate,
    request: &RestoreRequest<'_>,
    authority_guard: &mut G,
    authority: &RestoreAuthoritySnapshot,
    pre_commit_authority_check: impl FnOnce(
        &mut G,
        &RestoreAuthoritySnapshot,
    ) -> Result<(), BusinessDatabaseError>,
) -> Result<RestoreReceipt, BusinessDatabaseError> {
    validate_request(candidate, request)?;
    validate_authority(authority, request)?;
    let workspace_id = database.workspace_id().to_owned();
    let transaction = database
        .backup_connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let receipt_event_id = derived_id("receipt", request.operation_id, "workspace");
    if let Some(existing) = read_existing_receipt(&transaction, &workspace_id, &receipt_event_id)? {
        if !replay_matches(&existing, candidate, request) {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        pre_commit_authority_check(authority_guard, authority)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        return Ok(receipt_from_history(&existing, "replayed"));
    }
    let current_revision: i64 = transaction
        .query_row(
            "SELECT local_commit_sequence FROM active_workspace_metadata
              WHERE singleton=1 AND workspace_id=?1",
            [workspace_id.as_str()],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
    if bounded_revision(current_revision)? != request.expected_current_revision {
        return Err(BusinessDatabaseError::RevisionRejected);
    }
    if candidate.candidate_set_version != request.expected_candidate_set_version {
        return Err(BusinessDatabaseError::MutationStale);
    }
    let open_conflicts: i64 = transaction
        .query_row(
            "SELECT count(*) FROM sync_conflicts WHERE workspace_id=?1 AND status='open'",
            [workspace_id.as_str()],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if open_conflicts != 0 {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    reject_candidate_tombstone_conflicts(&transaction, &workspace_id, candidate)?;
    reject_missing_portfolios(&transaction, &workspace_id, candidate)?;
    let current = read_current_assets(&transaction, &workspace_id)?;
    let candidate_ids: BTreeSet<&str> = candidate
        .body
        .assets
        .iter()
        .map(|asset| asset.entity_id.as_str())
        .collect();
    let mut local_sequence = request.expected_current_revision;
    let mut mutations = 0_u64;
    let mut tombstones = 0_u64;
    let mut unchanged = 0_u64;
    for asset in &candidate.body.assets {
        if current.get(&asset.entity_id) == Some(asset) {
            unchanged += 1;
            continue;
        }
        let (next_local, device_sequence) =
            advance_sequences(&transaction, &authority.committed_at)?;
        local_sequence = next_local;
        write_asset(
            &transaction,
            &workspace_id,
            asset,
            local_sequence,
            device_sequence,
            authority,
            request,
            candidate,
        )?;
        mutations += 1;
    }
    for entity_id in current
        .keys()
        .filter(|id| !candidate_ids.contains(id.as_str()))
    {
        let (next_local, device_sequence) =
            advance_sequences(&transaction, &authority.committed_at)?;
        local_sequence = next_local;
        write_tombstone(
            &transaction,
            &workspace_id,
            entity_id,
            local_sequence,
            device_sequence,
            authority,
            request,
            candidate,
        )?;
        tombstones += 1;
    }
    // A restore receipt is itself business history. A previously empty database needs one legal
    // local commit sequence even when both complete sets are empty.
    if local_sequence == 0 {
        local_sequence = bounded_revision(
            transaction
                .query_row(
                    "UPDATE active_workspace_metadata SET local_commit_sequence=1,updated_at=?1
                      WHERE singleton=1 AND local_commit_sequence=0
                      RETURNING local_commit_sequence",
                    [authority.committed_at.as_str()],
                    |row| row.get(0),
                )
                .map_err(|_| BusinessDatabaseError::SequenceExhausted)?,
        )?;
    }
    let history = RestoreHistoryPayload {
        schema_version: 1,
        operation_id: request.operation_id.to_owned(),
        artifact_id: candidate.artifact_id.as_str().to_owned(),
        candidate_set_version: candidate.candidate_set_version,
        candidate_digest: candidate.source_proof_digest_hex(),
        expected_current_revision: request.expected_current_revision,
        authority_snapshot_digest: authority.authority_snapshot_digest.clone(),
        source_device_id: authority.source_device_id.clone(),
        active_lease_epoch: authority.active_lease_epoch,
        committed_at: authority.committed_at.clone(),
        mutations,
        tombstones,
        unchanged,
        final_local_commit_sequence: local_sequence,
    };
    let history_json = zeroizing_json(&history)?;
    append_history(
        &transaction,
        &workspace_id,
        &receipt_event_id,
        "workspace",
        "workspace",
        "backup_restore_completed",
        history_json.as_str(),
        &authority.committed_at,
        local_sequence,
    )?;
    pre_commit_authority_check(authority_guard, authority)?;
    transaction
        .commit()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(receipt_from_history(&history, "committed"))
}

fn validate_request(
    candidate: &IsolatedBackupCandidate,
    request: &RestoreRequest<'_>,
) -> Result<(), BusinessDatabaseError> {
    crate::portfolio_projection::validate_identifier(request.operation_id)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    crate::active_workspace::business::validate_sha256_hex(
        request.expected_authority_snapshot_digest,
    )?;
    if request.expected_current_revision > MAX_SAFE_INTEGER
        || request.expected_candidate_set_version == 0
        || request.expected_candidate_set_version > MAX_SAFE_INTEGER
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    if candidate.candidate_set_version != request.expected_candidate_set_version {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}

fn validate_authority(
    authority: &RestoreAuthoritySnapshot,
    request: &RestoreRequest<'_>,
) -> Result<(), BusinessDatabaseError> {
    crate::active_workspace::business::validate_sha256_hex(&authority.authority_snapshot_digest)?;
    crate::portfolio_projection::validate_identifier(&authority.source_device_id)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    crate::portfolio_projection::validate_timestamp(Some(authority.committed_at.clone()))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if authority.authority_snapshot_digest != request.expected_authority_snapshot_digest
        || authority.active_lease_epoch == 0
        || authority.active_lease_epoch > MAX_SAFE_INTEGER
    {
        return Err(BusinessDatabaseError::MutationStale);
    }
    Ok(())
}

fn read_existing_receipt(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    event_id: &str,
) -> Result<Option<RestoreHistoryPayload>, BusinessDatabaseError> {
    let existing = transaction
        .query_row(
            "SELECT event_kind,event_payload_json FROM business_history_events
              WHERE workspace_id=?1 AND event_id=?2",
            params![workspace_id, event_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((event_kind, payload)) = existing else {
        return Ok(None);
    };
    let payload = Zeroizing::new(payload);
    if event_kind != "backup_restore_completed" {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    serde_json::from_str(payload.as_str())
        .map(Some)
        .map_err(|_| BusinessDatabaseError::MutationConflict)
}

fn replay_matches(
    payload: &RestoreHistoryPayload,
    candidate: &IsolatedBackupCandidate,
    request: &RestoreRequest<'_>,
) -> bool {
    payload.schema_version == 1
        && payload.operation_id == request.operation_id
        && payload.artifact_id == candidate.artifact_id.as_str()
        && payload.candidate_set_version == request.expected_candidate_set_version
        && payload.candidate_digest == candidate.source_proof_digest_hex()
        && payload.expected_current_revision == request.expected_current_revision
        && payload.authority_snapshot_digest == request.expected_authority_snapshot_digest
}

fn receipt_from_history(payload: &RestoreHistoryPayload, disposition: &str) -> RestoreReceipt {
    RestoreReceipt {
        operation_id: payload.operation_id.clone(),
        disposition: disposition.to_owned(),
        mutations: payload.mutations,
        tombstones: payload.tombstones,
        unchanged: payload.unchanged,
        local_commit_sequence: payload.final_local_commit_sequence,
    }
}

fn reject_candidate_tombstone_conflicts(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    candidate: &IsolatedBackupCandidate,
) -> Result<(), BusinessDatabaseError> {
    for asset in &candidate.body.assets {
        let conflict: bool = transaction
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM sync_tombstones
                    WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                   UNION ALL
                   SELECT 1 FROM domain_assets
                    WHERE workspace_id=?1 AND entity_id=?2 AND deleted_at IS NOT NULL
                 )",
                params![workspace_id, asset.entity_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if conflict {
            return Err(BusinessDatabaseError::MutationConflict);
        }
    }
    Ok(())
}

fn reject_missing_portfolios(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    candidate: &IsolatedBackupCandidate,
) -> Result<(), BusinessDatabaseError> {
    for portfolio_id in candidate
        .body
        .assets
        .iter()
        .filter_map(|asset| asset.portfolio_id.as_deref())
    {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM portfolios
                  WHERE workspace_id=?1 AND portfolio_id=?2 AND deleted_at IS NULL)",
                params![workspace_id, portfolio_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if !exists {
            return Err(BusinessDatabaseError::MutationConflict);
        }
    }
    Ok(())
}

fn read_current_assets(
    transaction: &Transaction<'_>,
    workspace_id: &str,
) -> Result<SensitiveCurrentAssets, BusinessDatabaseError> {
    let mut statement = transaction
        .prepare(
            "SELECT a.entity_id,d.note,d.portfolio_id,d.target_price_currency,d.target_price_amount
               FROM domain_assets a JOIN domain_asset_desired_state d
                 ON d.workspace_id=a.workspace_id AND d.entity_id=a.entity_id
              WHERE a.workspace_id=?1 AND a.deleted_at IS NULL
              ORDER BY a.entity_id COLLATE BINARY",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let rows = statement
        .query_map([workspace_id], SensitiveDatabaseRow::read)
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let mut assets = SensitiveCurrentAssets(BTreeMap::new());
    for row in rows {
        let mut asset = row
            .map_err(|_| BusinessDatabaseError::ProjectionRejected)?
            .into_sensitive_asset()?;
        let (entity_id, tags) = asset.identity_and_tags_mut();
        read_tags_into(transaction, workspace_id, entity_id, tags)?;
        if assets.0.insert(asset.entity_id.clone(), asset).is_some() {
            return Err(BusinessDatabaseError::ProjectionRejected);
        }
    }
    Ok(assets)
}

fn advance_sequences(
    transaction: &Transaction<'_>,
    committed_at: &str,
) -> Result<(u64, u64), BusinessDatabaseError> {
    let (local, device): (i64, i64) = transaction
        .query_row(
            "UPDATE active_workspace_metadata
                SET local_commit_sequence=local_commit_sequence+1,
                    next_device_mutation_sequence=next_device_mutation_sequence+1,
                    updated_at=?1 WHERE singleton=1
              RETURNING local_commit_sequence,next_device_mutation_sequence-1",
            [committed_at],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    Ok((bounded_revision(local)?, bounded_revision(device)?))
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn write_asset(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    asset: &DomainAssetProjectionRow,
    local_sequence: u64,
    device_sequence: u64,
    authority: &RestoreAuthoritySnapshot,
    request: &RestoreRequest<'_>,
    candidate: &IsolatedBackupCandidate,
) -> Result<(), BusinessDatabaseError> {
    let local =
        i64::try_from(local_sequence).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    let device =
        i64::try_from(device_sequence).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    let existed: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2)",
            params![workspace_id, asset.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if existed {
        transaction
            .execute(
                "UPDATE domain_assets SET updated_at=?3,local_commit_sequence=?4
              WHERE workspace_id=?1 AND entity_id=?2 AND deleted_at IS NULL",
                params![workspace_id, asset.entity_id, authority.committed_at, local],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    } else {
        transaction
            .execute(
                "INSERT INTO domain_assets
             (workspace_id,entity_id,lifecycle_status,acquired_on,expires_on,
              acquisition_cost_currency,acquisition_cost_amount,auto_renew,registrar_lock,
              created_at,updated_at,deleted_at,local_commit_sequence)
             VALUES (?1,?2,'active',NULL,NULL,NULL,NULL,NULL,NULL,?3,?3,NULL,?4)",
                params![workspace_id, asset.entity_id, authority.committed_at, local],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    transaction
        .execute(
            "INSERT INTO domain_asset_desired_state
         (workspace_id,entity_id,portfolio_id,note,target_price_currency,target_price_amount,
          desired_sale_status,desired_nameservers_json,local_commit_sequence,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,'hold','[]',?7,?8)
         ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
           portfolio_id=excluded.portfolio_id,note=excluded.note,
           target_price_currency=excluded.target_price_currency,
           target_price_amount=excluded.target_price_amount,
           local_commit_sequence=excluded.local_commit_sequence,updated_at=excluded.updated_at",
            params![
                workspace_id,
                asset.entity_id,
                asset.portfolio_id,
                asset.note,
                asset.target_price.as_ref().map(|money| &money.currency),
                asset.target_price.as_ref().map(|money| &money.amount),
                local,
                authority.committed_at
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, asset.entity_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for tag in &asset.tags {
        transaction
            .execute(
                "INSERT INTO domain_asset_tags (workspace_id,entity_id,tag,local_commit_sequence)
             VALUES (?1,?2,?3,?4)",
                params![workspace_id, asset.entity_id, tag, local],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    let tags_json = zeroizing_json(&asset.tags)?;
    transaction.execute(
        "INSERT INTO portfolio_domain_assets
         (workspace_id,entity_id,note,portfolio_id,tags_json,target_price_currency,target_price_amount,
          note_server_revision,portfolio_id_server_revision,tags_server_revision,target_price_server_revision)
         VALUES (?1,?2,?3,?4,?5,?6,?7,0,0,0,0)
         ON CONFLICT(workspace_id,entity_id) DO UPDATE SET note=excluded.note,
          portfolio_id=excluded.portfolio_id,tags_json=excluded.tags_json,
          target_price_currency=excluded.target_price_currency,
          target_price_amount=excluded.target_price_amount",
        params![workspace_id,asset.entity_id,asset.note,asset.portfolio_id,tags_json.as_str(),
            asset.target_price.as_ref().map(|money| &money.currency),
            asset.target_price.as_ref().map(|money| &money.amount)],
    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let payload = Zeroizing::new(crate::active_workspace::business::sync_payload(asset)?);
    let mutation_id = derived_id("mutation-upsert", request.operation_id, &asset.entity_id);
    insert_outbox(
        transaction,
        workspace_id,
        &mutation_id,
        "upsert",
        &asset.entity_id,
        payload.as_str(),
        local,
        device,
        authority,
    )?;
    let field_values = [
        ("note", zeroizing_json(&asset.note)),
        ("portfolioId", zeroizing_json(&asset.portfolio_id)),
        ("tags", zeroizing_json(&asset.tags)),
        ("targetPrice", zeroizing_json(&asset.target_price)),
    ];
    for (ordinal, (field, value)) in field_values.into_iter().enumerate() {
        let value = value.map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
        transaction
            .execute(
                "INSERT INTO sync_outbox_fields
             (workspace_id,mutation_id,ordinal,field_path,field_value_json,field_value_sha256)
             VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    workspace_id,
                    mutation_id,
                    i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    field,
                    value.as_str(),
                    hex_digest(value.as_bytes())
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute(
            "INSERT INTO domain_asset_field_versions
             (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at)
             VALUES (?1,?2,?3,(SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton=1),?4,'pending',?5)
             ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET
               local_commit_sequence=excluded.local_commit_sequence,sync_state='pending',updated_at=excluded.updated_at",
            params![workspace_id,asset.entity_id,field,local,authority.committed_at],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    append_root_history(
        transaction,
        workspace_id,
        "upsert",
        &asset.entity_id,
        local_sequence,
        authority,
        request,
        candidate,
    )
}

#[allow(clippy::too_many_arguments)]
fn write_tombstone(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    entity_id: &str,
    local_sequence: u64,
    device_sequence: u64,
    authority: &RestoreAuthoritySnapshot,
    request: &RestoreRequest<'_>,
    candidate: &IsolatedBackupCandidate,
) -> Result<(), BusinessDatabaseError> {
    let local =
        i64::try_from(local_sequence).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    let device =
        i64::try_from(device_sequence).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    transaction
        .execute(
            "UPDATE domain_assets SET lifecycle_status='archived',deleted_at=?1,updated_at=?1,
          local_commit_sequence=?2 WHERE workspace_id=?3 AND entity_id=?4 AND deleted_at IS NULL",
            params![authority.committed_at, local, workspace_id, entity_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction.execute(
        "INSERT INTO domain_asset_field_versions
         (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at)
         VALUES (?1,?2,'lifecycleStatus',(SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton=1),?3,'pending',?4)
         ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET
           local_commit_sequence=excluded.local_commit_sequence,sync_state='pending',updated_at=excluded.updated_at",
        params![workspace_id,entity_id,local,authority.committed_at],
    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO sync_tombstones
         (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,deleted_server_revision,
          deleted_at,purge_after,state,barrier_state)
         VALUES (?1,'domain_asset',?2,?3,NULL,?4,NULL,'pending','pending')",
            params![workspace_id, entity_id, local, authority.committed_at],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let payload = zeroizing_json(&DeleteOutboxPayload {
        entity_id,
        operation: "delete",
    })?;
    let mutation_id = derived_id("mutation-delete", request.operation_id, entity_id);
    insert_outbox(
        transaction,
        workspace_id,
        &mutation_id,
        "delete",
        entity_id,
        payload.as_str(),
        local,
        device,
        authority,
    )?;
    append_root_history(
        transaction,
        workspace_id,
        "delete",
        entity_id,
        local_sequence,
        authority,
        request,
        candidate,
    )
}

#[allow(clippy::too_many_arguments)]
fn insert_outbox(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    mutation_id: &str,
    operation_kind: &str,
    entity_id: &str,
    payload: &str,
    local_sequence: i64,
    device_sequence: i64,
    authority: &RestoreAuthoritySnapshot,
) -> Result<(), BusinessDatabaseError> {
    transaction
        .execute(
            "INSERT INTO sync_outbox
         (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at,
          workspace_schema_version,operation_kind,base_server_revision,local_commit_sequence,
          source_device_id,active_lease_epoch,device_mutation_sequence,payload_schema_version,
          mutation_payload_sha256,state)
         VALUES (?1,?2,'domain_asset',?3,?4,?5,1,?6,
          (SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton=1),
          ?7,?8,?9,?10,1,?11,'pending')",
            params![
                workspace_id,
                mutation_id,
                entity_id,
                payload,
                authority.committed_at,
                operation_kind,
                local_sequence,
                authority.source_device_id,
                i64::try_from(authority.active_lease_epoch)
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                device_sequence,
                hex_digest(payload.as_bytes())
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_root_history(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    operation: &str,
    entity_id: &str,
    local_sequence: u64,
    authority: &RestoreAuthoritySnapshot,
    request: &RestoreRequest<'_>,
    candidate: &IsolatedBackupCandidate,
) -> Result<(), BusinessDatabaseError> {
    let candidate_digest = Zeroizing::new(candidate.source_proof_digest_hex());
    let payload = zeroizing_json(&RootHistoryPayload {
        restore_operation_id: request.operation_id,
        artifact_id: candidate.artifact_id.as_str(),
        candidate_digest: candidate_digest.as_str(),
        operation,
    })?;
    append_history(
        transaction,
        workspace_id,
        &derived_id(
            &format!("event-{operation}"),
            request.operation_id,
            entity_id,
        ),
        "domain_asset",
        entity_id,
        &format!("backup_restore_{operation}"),
        payload.as_str(),
        &authority.committed_at,
        local_sequence,
    )
}

#[allow(clippy::too_many_arguments)]
fn append_history(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    event_id: &str,
    aggregate_kind: &str,
    aggregate_id: &str,
    event_kind: &str,
    payload: &str,
    occurred_at: &str,
    local_sequence: u64,
) -> Result<(), BusinessDatabaseError> {
    let event_sequence: i64 = transaction.query_row(
        "SELECT coalesce(max(event_sequence),0)+1 FROM business_history_events WHERE workspace_id=?1",
        [workspace_id],|row| row.get(0),
    ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO business_history_events
         (workspace_id,event_sequence,event_id,aggregate_kind,aggregate_id,event_kind,actor_kind,
          event_payload_json,event_payload_sha256,occurred_at,local_commit_sequence)
         VALUES (?1,?2,?3,?4,?5,?6,'recovery',?7,?8,?9,?10)",
            params![
                workspace_id,
                event_sequence,
                event_id,
                aggregate_kind,
                aggregate_id,
                event_kind,
                payload,
                hex_digest(payload.as_bytes()),
                occurred_at,
                i64::try_from(local_sequence)
                    .map_err(|_| BusinessDatabaseError::SequenceExhausted)?
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}

fn derived_id(domain: &str, operation_id: &str, entity_id: &str) -> String {
    let transcript = Zeroizing::new(format!(
        "GOODDEALER/BACKUP-RESTORE-V1\0{domain}\0{operation_id}\0{entity_id}"
    ));
    format!("restore-{}", hex_digest(transcript.as_bytes()))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tempfile::tempdir;

    use super::*;
    use crate::active_workspace::business::DomainAssetReplicaMutation;
    use crate::{BusinessDatabase, DomainAssetWrite, LocalDatabaseKey, Money};

    const TIME: &str = "2026-09-15T09:00:00Z";

    fn asset(entity_id: &str, note: &str) -> DomainAssetWrite {
        DomainAssetWrite {
            entity_id: entity_id.to_owned(),
            note: Some(note.to_owned()),
            portfolio_id: None,
            tags: vec!["backup".to_owned()],
            target_price: Some(Money {
                currency: "USD".to_owned(),
                amount: "900".to_owned(),
            }),
        }
    }

    fn authority(digest: &str) -> RestoreAuthoritySnapshot {
        RestoreAuthoritySnapshot {
            authority_snapshot_digest: digest.to_owned(),
            source_device_id: "device-restore".to_owned(),
            active_lease_epoch: 9,
            committed_at: TIME.to_owned(),
        }
    }

    fn candidate(
        database: &mut BusinessDatabase,
        artifact_id: &str,
        version: u64,
    ) -> IsolatedBackupCandidate {
        let projection = database.backup_source().snapshot().unwrap();
        IsolatedBackupCandidate::from_authenticated_frames(
            artifact_id,
            version,
            projection.source_proof_digest(),
            &projection.data_frames(),
        )
        .unwrap()
    }

    fn request<'a>(
        operation_id: &'a str,
        current_revision: u64,
        candidate_version: u64,
        authority_digest: &'a str,
    ) -> RestoreRequest<'a> {
        RestoreRequest {
            operation_id,
            expected_current_revision: current_revision,
            expected_candidate_set_version: candidate_version,
            expected_authority_snapshot_digest: authority_digest,
        }
    }

    #[test]
    fn restore_control_debug_output_and_errors_are_data_free() {
        let restore_request = request("operation-secret", 41, 7, "authority-secret");
        let authority = RestoreAuthoritySnapshot {
            authority_snapshot_digest: "authority-secret".to_owned(),
            source_device_id: "device-secret".to_owned(),
            active_lease_epoch: 19,
            committed_at: "timestamp-secret".to_owned(),
        };
        let receipt = RestoreReceipt {
            operation_id: "operation-secret".to_owned(),
            disposition: "disposition-secret".to_owned(),
            mutations: 1,
            tombstones: 2,
            unchanged: 3,
            local_commit_sequence: 42,
        };

        assert_eq!(
            format!("{restore_request:?}"),
            "RestoreRequest { <redacted> }"
        );
        assert_eq!(
            format!("{authority:?}"),
            "RestoreAuthoritySnapshot { <redacted> }"
        );
        assert_eq!(format!("{receipt:?}"), "RestoreReceipt { <redacted> }");
        assert_eq!(
            format!(
                "{:?}:{}",
                BusinessDatabaseError::MutationConflict,
                BusinessDatabaseError::MutationConflict
            ),
            "MutationConflict:LOCAL_MUTATION_IDEMPOTENCY_CONFLICT"
        );
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the restore integration proof keeps control-floor, history, outbox, and pull assertions together"
    )]
    fn old_snapshot_restore_emits_fresh_history_versions_outbox_and_blocks_silent_pull() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x51; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed-old", TIME, &asset("one.example", "old"))
            .unwrap();
        let old = candidate(&mut database, "artifact-old", 7);
        database
            .upsert_domain_asset("seed-new", TIME, &asset("one.example", "new"))
            .unwrap();
        database.backup_connection_mut().execute(
            "UPDATE active_workspace_metadata SET applied_through_server_revision=7 WHERE singleton=1",
            [],
        ).unwrap();
        database
            .backup_connection_mut()
            .execute(
                "INSERT INTO sync_reader_state
             (workspace_id,device_id,cursor_generation,read_through_server_revision,
              continuation_token,status,updated_at,anti_rollback_server_revision_floor,
              anti_rollback_schema_version_floor,row_version)
             VALUES ('workspace-local','reader-control',4,7,'opaque-cursor','active',?1,7,2,4)",
                [TIME],
            )
            .unwrap();
        database
            .backup_connection_mut()
            .execute(
                "INSERT INTO local_provider_connections
             (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,
              capabilities_json,credential_use_state,active_credential_generation,
              active_credential_scope_digest,active_credential_zone_digest,
              active_credential_public_proof,validation_status)
             VALUES ('workspace-local','authority-control','cloudflare','Authority control',?1,
              '[]','active',11,?2,?3,?4,'unknown')",
                params![TIME, "1".repeat(64), "2".repeat(64), "3".repeat(64)],
            )
            .unwrap();
        database
            .backup_connection_mut()
            .execute(
                "INSERT INTO local_backup_catalog
             (workspace_id,backup_id,backup_class,workspace_schema_version,
              through_local_commit_sequence,through_server_revision,manifest_digest,
              crypto_profile,storage_locator_digest,status,created_at)
             VALUES ('workspace-local','catalog-control','local_full',1,2,7,?1,
              'gdbk-v1',?2,'creating',?3)",
                params!["A".repeat(43), "3".repeat(64), TIME],
            )
            .unwrap();
        let digest = "a".repeat(64);
        let before_revision = database.recovery_proof().unwrap().local_commit_sequence;
        let receipt = database
            .restore_backup_candidate_guarded(
                &old,
                &request("restore-old", before_revision, 7, &digest),
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            )
            .unwrap();
        assert_eq!(
            (receipt.mutations, receipt.tombstones, receipt.unchanged),
            (1, 0, 0)
        );
        assert_eq!(
            database
                .read_domain_detail("one.example")
                .unwrap()
                .asset
                .note
                .as_deref(),
            Some("old")
        );
        let state: (i64,i64,i64,i64,i64,i64,String,i64) = database.backup_connection_mut().query_row(
            "SELECT
              (SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton=1),
              (SELECT anti_rollback_server_revision_floor FROM sync_reader_state WHERE device_id='reader-control'),
              (SELECT row_version FROM sync_reader_state WHERE device_id='reader-control'),
              (SELECT count(*) FROM sync_outbox WHERE mutation_id LIKE 'restore-%' AND operation_kind='upsert'),
              (SELECT count(*) FROM business_history_events WHERE event_kind IN ('backup_restore_upsert','backup_restore_completed')),
              (SELECT active_credential_generation FROM local_provider_connections WHERE connection_id='authority-control'),
              (SELECT active_credential_scope_digest FROM local_provider_connections WHERE connection_id='authority-control'),
              (SELECT count(*) FROM local_backup_catalog WHERE backup_id='catalog-control' AND status='creating')",
            [],|row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?)),
        ).unwrap();
        assert_eq!(state, (7, 7, 4, 1, 2, 11, "1".repeat(64), 1));
        let versions: i64 = database
            .backup_connection_mut()
            .query_row(
                "SELECT count(*) FROM domain_asset_field_versions
              WHERE entity_id='one.example' AND sync_state='pending'
                AND local_commit_sequence=?1",
                [i64::try_from(receipt.local_commit_sequence).unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(versions, 4);
        let pending = database.test_pending_sync_rows(100).unwrap();
        assert!(pending.iter().any(|mutation| {
            mutation.mutation_id.starts_with("restore-")
                && mutation.entity_id == "one.example"
                && mutation.mutation_payload_json.contains("\"old\"")
        }));
        let remote = database.merge_domain_asset_replica(vec![DomainAssetReplicaMutation {
            server_revision: 8,
            asset: asset("one.example", "remote-overwrite"),
        }]);
        assert_eq!(remote, Err(BusinessDatabaseError::InvalidInput));
        assert_eq!(database.current_server_revision().unwrap(), 7);
        assert_eq!(
            database
                .read_domain_detail("one.example")
                .unwrap()
                .asset
                .note
                .as_deref(),
            Some("old")
        );
    }

    #[test]
    fn complete_set_absence_creates_fresh_pending_tombstone() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x52; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed-keep", TIME, &asset("keep.example", "keep"))
            .unwrap();
        let old = candidate(&mut database, "artifact-complete", 3);
        database
            .upsert_domain_asset("seed-remove", TIME, &asset("remove.example", "remove"))
            .unwrap();
        let digest = "b".repeat(64);
        let current = database.recovery_proof().unwrap().local_commit_sequence;
        let receipt = database
            .restore_backup_candidate_guarded(
                &old,
                &request("restore-complete", current, 3, &digest),
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            )
            .unwrap();
        assert_eq!(
            (receipt.mutations, receipt.tombstones, receipt.unchanged),
            (0, 1, 1)
        );
        let tombstone: (String, String, i64) = database
            .backup_connection_mut()
            .query_row(
                "SELECT state,barrier_state,deleted_local_commit_sequence FROM sync_tombstones
              WHERE entity_id='remove.example'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (tombstone.0.as_str(), tombstone.1.as_str()),
            ("pending", "pending")
        );
        assert_eq!(
            tombstone.2,
            i64::try_from(receipt.local_commit_sequence).unwrap()
        );
        let delete_outbox: i64 = database
            .backup_connection_mut()
            .query_row(
                "SELECT count(*) FROM sync_outbox WHERE entity_id='remove.example'
              AND operation_kind='delete' AND state='pending' AND mutation_id LIKE 'restore-%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(delete_outbox, 1);
    }

    #[test]
    fn current_revision_and_candidate_version_mismatches_are_zero_write() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x53; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed", TIME, &asset("one.example", "one"))
            .unwrap();
        let old = candidate(&mut database, "artifact-cas", 5);
        let digest = "c".repeat(64);
        let before = database.recovery_proof().unwrap();
        assert_eq!(
            database.restore_backup_candidate_guarded(
                &old,
                &request(
                    "restore-stale-revision",
                    before.local_commit_sequence + 1,
                    5,
                    &digest
                ),
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            ),
            Err(BusinessDatabaseError::RevisionRejected)
        );
        assert_eq!(
            database.restore_backup_candidate_guarded(
                &old,
                &request(
                    "restore-stale-candidate",
                    before.local_commit_sequence,
                    6,
                    &digest
                ),
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            database.restore_backup_candidate_guarded(
                &old,
                &request(
                    "restore-stale-authority",
                    before.local_commit_sequence,
                    5,
                    &digest
                ),
                &mut (),
                &authority(&"9".repeat(64)),
                |(), _| Ok(()),
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(database.recovery_proof().unwrap(), before);
        let restore_rows: i64 = database.backup_connection_mut().query_row(
            "SELECT count(*) FROM business_history_events WHERE event_kind LIKE 'backup_restore%'",
            [],|row| row.get(0),
        ).unwrap();
        assert_eq!(restore_rows, 0);
    }

    #[test]
    fn exact_replay_returns_receipt_without_duplicate_writes_and_rechecks_authority() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x54; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed-old", TIME, &asset("one.example", "old"))
            .unwrap();
        let old = candidate(&mut database, "artifact-replay", 2);
        database
            .upsert_domain_asset("seed-new", TIME, &asset("one.example", "new"))
            .unwrap();
        let current = database.recovery_proof().unwrap().local_commit_sequence;
        let digest = "d".repeat(64);
        let checks = AtomicUsize::new(0);
        let restore_request = request("restore-replay", current, 2, &digest);
        let first = database
            .restore_backup_candidate_guarded(
                &old,
                &restore_request,
                &mut (),
                &authority(&digest),
                |(), _| {
                    checks.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .unwrap();
        let after_first = database.recovery_proof().unwrap();
        let counts_before: (i64,i64) = database.backup_connection_mut().query_row(
            "SELECT (SELECT count(*) FROM sync_outbox),(SELECT count(*) FROM business_history_events)",
            [],|row| Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        let replay = database
            .restore_backup_candidate_guarded(
                &old,
                &restore_request,
                &mut (),
                &authority(&digest),
                |(), _| {
                    checks.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .unwrap();
        let counts_after: (i64,i64) = database.backup_connection_mut().query_row(
            "SELECT (SELECT count(*) FROM sync_outbox),(SELECT count(*) FROM business_history_events)",
            [],|row| Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(first.disposition, "committed");
        assert_eq!(replay.disposition, "replayed");
        assert_eq!(replay.local_commit_sequence, first.local_commit_sequence);
        assert_eq!(database.recovery_proof().unwrap(), after_first);
        assert_eq!(counts_after, counts_before);
        assert_eq!(checks.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn open_conflict_rejects_without_publication() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x55; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed", TIME, &asset("one.example", "one"))
            .unwrap();
        let old = candidate(&mut database, "artifact-conflict", 4);
        database
            .backup_connection_mut()
            .execute(
                "INSERT INTO sync_conflicts
             (workspace_id,conflict_id,entity_kind,entity_id,field_path,local_value_json,
              remote_value_json,local_commit_sequence,remote_server_revision,status,created_at,
              candidate_version,remote_source_device_id,remote_mutation_digest,
              remote_order_server_revision,remote_order_source_device_id,remote_order_mutation_id,
              local_value_hash,remote_value_hash)
             VALUES ('workspace-local','conflict-restore','domain_asset','one.example','note',
              '\"one\"','\"remote\"',1,1,'open',?1,1,'remote-device',?2,1,
              'remote-device','remote-mutation',?3,?4)",
                params![TIME, "A".repeat(43), "1".repeat(64), "2".repeat(64)],
            )
            .unwrap();
        let before = database.recovery_proof().unwrap();
        let digest = "e".repeat(64);
        assert_eq!(
            database.restore_backup_candidate_guarded(
                &old,
                &request("restore-conflict", before.local_commit_sequence, 4, &digest),
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(database.recovery_proof().unwrap(), before);
    }

    #[test]
    fn tombstoned_candidate_rejects_without_resurrection() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x57; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed", TIME, &asset("one.example", "one"))
            .unwrap();
        let old = candidate(&mut database, "artifact-tombstoned", 6);
        database
            .delete_domain_asset(
                "delete-after-backup",
                1,
                "device-delete",
                3,
                TIME,
                "one.example",
                true,
            )
            .unwrap();
        let before = database.recovery_proof().unwrap();
        let counts_before: (i64, i64) = database
            .backup_connection_mut()
            .query_row(
                "SELECT (SELECT count(*) FROM sync_outbox),
                        (SELECT count(*) FROM business_history_events)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let digest = "7".repeat(64);

        assert_eq!(
            database.restore_backup_candidate_guarded(
                &old,
                &request(
                    "restore-tombstoned",
                    before.local_commit_sequence,
                    6,
                    &digest,
                ),
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(database.recovery_proof().unwrap(), before);
        assert_eq!(
            database.read_domain_detail("one.example"),
            Err(BusinessDatabaseError::AssetNotFound)
        );
        let counts_after: (i64, i64) = database
            .backup_connection_mut()
            .query_row(
                "SELECT (SELECT count(*) FROM sync_outbox),
                        (SELECT count(*) FROM business_history_events)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts_after, counts_before);
    }

    #[test]
    fn operation_replay_with_a_different_candidate_is_a_zero_write_conflict() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x58; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed-old", TIME, &asset("one.example", "old"))
            .unwrap();
        let old = candidate(&mut database, "artifact-replay-conflict", 10);
        database
            .upsert_domain_asset("seed-new", TIME, &asset("one.example", "new"))
            .unwrap();
        let different = candidate(&mut database, "artifact-replay-conflict", 10);
        let current = database.recovery_proof().unwrap().local_commit_sequence;
        let digest = "8".repeat(64);
        let restore_request = request("restore-replay-conflict", current, 10, &digest);
        database
            .restore_backup_candidate_guarded(
                &old,
                &restore_request,
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            )
            .unwrap();
        let before = database.recovery_proof().unwrap();
        let counts_before: (i64, i64) = database
            .backup_connection_mut()
            .query_row(
                "SELECT (SELECT count(*) FROM sync_outbox),
                        (SELECT count(*) FROM business_history_events)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(
            database.restore_backup_candidate_guarded(
                &different,
                &restore_request,
                &mut (),
                &authority(&digest),
                |(), _| Ok(()),
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(database.recovery_proof().unwrap(), before);
        let counts_after: (i64, i64) = database
            .backup_connection_mut()
            .query_row(
                "SELECT (SELECT count(*) FROM sync_outbox),
                        (SELECT count(*) FROM business_history_events)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts_after, counts_before);
    }

    #[test]
    fn failed_final_authority_check_rolls_back_all_business_and_control_writes() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x56; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("seed-old", TIME, &asset("one.example", "old"))
            .unwrap();
        let old = candidate(&mut database, "artifact-rollback", 8);
        database
            .upsert_domain_asset("seed-new", TIME, &asset("one.example", "new"))
            .unwrap();
        let before = database.recovery_proof().unwrap();
        let counts_before: (i64,i64) = database.backup_connection_mut().query_row(
            "SELECT (SELECT count(*) FROM sync_outbox),(SELECT count(*) FROM business_history_events)",
            [],|row| Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        let digest = "f".repeat(64);
        assert_eq!(
            database.restore_backup_candidate_guarded(
                &old,
                &request("restore-rollback", before.local_commit_sequence, 8, &digest),
                &mut (),
                &authority(&digest),
                |(), _| Err(BusinessDatabaseError::MutationStale),
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(database.recovery_proof().unwrap(), before);
        assert_eq!(
            database
                .read_domain_detail("one.example")
                .unwrap()
                .asset
                .note
                .as_deref(),
            Some("new")
        );
        let counts_after: (i64,i64) = database.backup_connection_mut().query_row(
            "SELECT (SELECT count(*) FROM sync_outbox),(SELECT count(*) FROM business_history_events)",
            [],|row| Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(counts_after, counts_before);
    }
}
