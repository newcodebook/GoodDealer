use std::fmt::{Debug, Display, Formatter};
use std::path::Path;

use rusqlite::{TransactionBehavior, params};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{ActiveWorkspaceConnection, ActiveWorkspaceKey};
use crate::portfolio_projection::{
    DomainAssetProjectionRow, Money, PortfolioReadSnapshot, validate_identifier,
    validate_projection, validate_timestamp,
};

const FORBIDDEN_SYNC_KEYS: &[&str] = &[
    "accountId",
    "accountLabel",
    "apiKey",
    "authorization",
    "browserProfile",
    "connectionId",
    "cookie",
    "credential",
    "credentialRef",
    "password",
    "provider",
    "providerAccountId",
    "refreshToken",
    "sealedCredential",
    "secret",
    "twoFactor",
    "token",
];

#[derive(Clone)]
pub struct LocalDatabaseKey([u8; 32]);

impl LocalDatabaseKey {
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl Debug for LocalDatabaseKey {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("LocalDatabaseKey([REDACTED])")
    }
}

pub struct SealedProviderCredential(Vec<u8>);

impl SealedProviderCredential {
    pub fn new(value: Vec<u8>) -> Result<Self, BusinessDatabaseError> {
        if value.is_empty() || value.len() > 65_536 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        Ok(Self(value))
    }
}

impl Debug for SealedProviderCredential {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SealedProviderCredential([REDACTED])")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainAssetWrite {
    pub entity_id: String,
    pub note: Option<String>,
    pub portfolio_id: Option<String>,
    pub tags: Vec<String>,
    pub target_price: Option<Money>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainAssetReplicaMutation {
    pub server_revision: u64,
    pub asset: DomainAssetWrite,
}

#[derive(Debug)]
pub struct ProviderConnectionWrite {
    pub connection_id: String,
    pub provider_kind: String,
    pub display_label: String,
    pub provider_account_id: Option<String>,
    pub sealed_credential: SealedProviderCredential,
    pub active_credential_changed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingSyncMutation {
    pub mutation_id: String,
    pub entity_kind: String,
    pub entity_id: String,
    pub mutation_payload_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusinessDatabaseError {
    InvalidInput,
    StorageRejected,
    WorkspaceRejected,
    SecretInSyncPayload,
}

impl Display for BusinessDatabaseError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "LOCAL_INPUT_REJECTED",
            Self::StorageRejected => "LOCAL_STORAGE_REJECTED",
            Self::WorkspaceRejected => "LOCAL_WORKSPACE_REJECTED",
            Self::SecretInSyncPayload => "LOCAL_SYNC_SECRET_REJECTED",
        })
    }
}

impl std::error::Error for BusinessDatabaseError {}

pub struct BusinessDatabase {
    workspace_id: String,
    store: ActiveWorkspaceConnection,
}

impl BusinessDatabase {
    pub fn open(
        path: &Path,
        key: &LocalDatabaseKey,
        workspace_id: &str,
    ) -> Result<Self, BusinessDatabaseError> {
        validate_identifier(workspace_id).map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        let active_key = ActiveWorkspaceKey(key.0);
        let mut store = ActiveWorkspaceConnection::create(path, &active_key)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let existing: Option<String> = store
            .raw_connection()
            .query_row(
                "SELECT workspace_id FROM active_workspace_metadata WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        match existing {
            Some(existing) if existing != workspace_id => {
                return Err(BusinessDatabaseError::WorkspaceRejected);
            }
            Some(_) => {}
            None => {
                store
                    .fixture_connection()
                    .execute(
                        "INSERT INTO active_workspace_metadata
                         (singleton, storage_domain, workspace_id, workspace_schema_version, applied_through_server_revision,
                          last_replication_activity_at, last_successful_provider_observation_at)
                         VALUES (1, 'active_workspace', ?1, 1, 0, NULL, NULL)",
                        [workspace_id],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
        }
        Ok(Self {
            workspace_id: workspace_id.to_owned(),
            store,
        })
    }

    pub fn read_portfolio(&self) -> Result<PortfolioReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_portfolio(&self.workspace_id)
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub fn upsert_domain_asset(
        &mut self,
        mutation_id: &str,
        created_at: &str,
        asset: DomainAssetWrite,
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
                  local_commit_sequence, device_mutation_sequence, mutation_payload_sha256, state)
                 VALUES (?1, ?2, 'domain_asset', ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, 'pending')",
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
            transaction
                .execute(
                    "INSERT INTO sync_outbox_fields
                     (workspace_id, mutation_id, ordinal, field_path, field_value_json, field_value_sha256)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        self.workspace_id,
                        mutation_id,
                        ordinal as i64,
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

    pub fn upsert_provider_connection(
        &mut self,
        account: ProviderConnectionWrite,
    ) -> Result<(), BusinessDatabaseError> {
        for value in [
            &account.connection_id,
            &account.provider_kind,
            &account.display_label,
        ] {
            validate_local_text(value)?;
        }
        if let Some(provider_account_id) = &account.provider_account_id {
            validate_local_text(provider_account_id)?;
        }
        validate_timestamp(Some(account.active_credential_changed_at.clone()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO local_provider_connections
                 (workspace_id, connection_id, provider_kind, display_label, provider_account_id,
                  active_credential_changed_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(workspace_id, connection_id) DO UPDATE SET
                   provider_kind = excluded.provider_kind,
                   display_label = excluded.display_label,
                   provider_account_id = excluded.provider_account_id,
                   active_credential_changed_at = excluded.active_credential_changed_at",
                params![
                    self.workspace_id,
                    account.connection_id,
                    account.provider_kind,
                    account.display_label,
                    account.provider_account_id,
                    account.active_credential_changed_at,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let next_version: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(credential_version), 0) + 1
                 FROM provider_credential_versions
                 WHERE workspace_id = ?1 AND connection_id = ?2",
                params![self.workspace_id, account.connection_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "UPDATE provider_credential_versions
                 SET state = 'rotated', retired_at = ?1
                 WHERE workspace_id = ?2 AND connection_id = ?3 AND state = 'active'",
                params![
                    account.active_credential_changed_at,
                    self.workspace_id,
                    account.connection_id
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO provider_credential_versions
                 (workspace_id, connection_id, credential_version, credential_kind,
                  seal_format, key_version, sealed_credential, state, created_at,
                  last_validated_at, validation_status, retired_at)
                 VALUES (?1, ?2, ?3, 'provider_token', 'host-sealed-v1', 1, ?4,
                         'active', ?5, NULL, 'unknown', NULL)",
                params![
                    self.workspace_id,
                    account.connection_id,
                    next_version,
                    account.sealed_credential.0,
                    account.active_credential_changed_at,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Applies strict Cloud sync-replica input to the local authority. An empty page is a no-op;
    /// omission is never interpreted as deletion. Replica merges do not generate a new Outbox row.
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

    pub fn pending_sync_mutations(
        &self,
        limit: usize,
    ) -> Result<Vec<PendingSyncMutation>, BusinessDatabaseError> {
        if !(1..=1_000).contains(&limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut statement = self
            .store
            .raw_connection()
            .prepare(
                "SELECT mutation_id, entity_kind, entity_id, mutation_payload_json, created_at
                 FROM sync_outbox
                 WHERE workspace_id = ?1 AND acknowledged_at IS NULL
                 ORDER BY created_at, mutation_id LIMIT ?2",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map(params![self.workspace_id, limit as i64], |row| {
                Ok(PendingSyncMutation {
                    mutation_id: row.get(0)?,
                    entity_kind: row.get(1)?,
                    entity_id: row.get(2)?,
                    mutation_payload_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mutations = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for mutation in &mutations {
            reject_secret_keys(&mutation.mutation_payload_json)?;
        }
        Ok(mutations)
    }

    pub fn acknowledge_sync_mutation(
        &mut self,
        mutation_id: &str,
        server_revision: u64,
        acknowledged_at: &str,
    ) -> Result<(), BusinessDatabaseError> {
        validate_identifier(mutation_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !(1..=9_007_199_254_740_991).contains(&server_revision) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_timestamp(Some(acknowledged_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let server_revision =
            i64::try_from(server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let updated = self
            .store
            .fixture_connection()
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
        Ok(())
    }

    fn current_server_revision(&self) -> Result<u64, BusinessDatabaseError> {
        let revision = self
            .store
            .raw_connection()
            .query_row(
                "SELECT applied_through_server_revision FROM active_workspace_metadata WHERE singleton = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        u64::try_from(revision).map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}

fn sync_payload(value: &impl Serialize) -> Result<String, BusinessDatabaseError> {
    let payload = serde_json::to_string(value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    reject_secret_keys(&payload)?;
    Ok(payload)
}

fn hex_digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write;
            write!(output, "{byte:02x}").expect("writing into a String cannot fail");
            output
        })
}

fn reject_secret_keys(payload: &str) -> Result<(), BusinessDatabaseError> {
    if payload.len() > 1_048_576 {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if !value.is_object() {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    if contains_forbidden_sync_key(&value) {
        return Err(BusinessDatabaseError::SecretInSyncPayload);
    }
    let projection: DomainAssetProjectionRow =
        serde_json::from_value(value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_projection(std::slice::from_ref(&projection))
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    Ok(())
}

fn contains_forbidden_sync_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized: String = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect();
            FORBIDDEN_SYNC_KEYS.iter().any(|forbidden| {
                let forbidden: String = forbidden
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect();
                normalized.contains(&forbidden)
            }) || contains_forbidden_sync_key(value)
        }),
        serde_json::Value::Array(values) => values.iter().any(contains_forbidden_sync_key),
        _ => false,
    }
}

fn validate_domain_asset(asset: &DomainAssetWrite) -> Result<(), BusinessDatabaseError> {
    validate_projection(&[DomainAssetProjectionRow {
        entity_id: asset.entity_id.clone(),
        note: asset.note.clone(),
        portfolio_id: asset.portfolio_id.clone(),
        tags: asset.tags.clone(),
        target_price: asset.target_price.clone(),
    }])
    .map_err(|_| BusinessDatabaseError::InvalidInput)
}

fn validate_local_text(value: &str) -> Result<(), BusinessDatabaseError> {
    if value.is_empty()
        || value.len() > 512
        || value.chars().any(|character| character.is_control())
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    const TIMESTAMP: &str = "2026-08-28T00:00:00Z";

    fn database() -> BusinessDatabase {
        let directory = tempdir().unwrap().keep();
        BusinessDatabase::open(
            &directory.join("workspace.db"),
            &LocalDatabaseKey::from_bytes([0x31; 32]),
            "workspace-local",
        )
        .unwrap()
    }

    #[test]
    fn business_write_and_sync_outbox_commit_atomically() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "mutation-1",
                TIMESTAMP,
                DomainAssetWrite {
                    entity_id: "domain-1.test".to_owned(),
                    note: Some("local source of truth".to_owned()),
                    portfolio_id: None,
                    tags: vec!["primary".to_owned()],
                    target_price: Some(Money {
                        currency: "USD".to_owned(),
                        amount: "1250".to_owned(),
                    }),
                },
            )
            .unwrap();
        assert_eq!(database.read_portfolio().unwrap().domains.len(), 1);
        let pending = database.pending_sync_mutations(10).unwrap();
        assert_eq!(pending.len(), 1);
        assert!(
            pending[0]
                .mutation_payload_json
                .contains("local source of truth")
        );
        let (local_sequence, field_count, authority_count): (i64, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT
                   (SELECT local_commit_sequence FROM active_workspace_metadata WHERE singleton = 1),
                   (SELECT count(*) FROM domain_asset_field_versions
                    WHERE workspace_id = 'workspace-local' AND entity_id = 'domain-1.test'
                      AND sync_state = 'pending' AND local_commit_sequence = 1),
                   (SELECT count(*) FROM domain_assets
                    WHERE workspace_id = 'workspace-local' AND entity_id = 'domain-1.test'
                      AND local_commit_sequence = 1)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((local_sequence, field_count, authority_count), (1, 4, 1));
    }

    #[test]
    fn provider_connection_and_sealed_credential_are_local_only() {
        let mut database = database();
        database
            .upsert_provider_connection(ProviderConnectionWrite {
                connection_id: "connection-local".to_owned(),
                provider_kind: "cloudflare".to_owned(),
                display_label: "private account".to_owned(),
                provider_account_id: Some("provider-account-secret".to_owned()),
                sealed_credential: SealedProviderCredential::new(b"sealed-token-canary".to_vec())
                    .unwrap(),
                active_credential_changed_at: TIMESTAMP.to_owned(),
            })
            .unwrap();
        assert!(database.pending_sync_mutations(10).unwrap().is_empty());
        let credential_versions: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM provider_credential_versions
                 WHERE workspace_id = 'workspace-local' AND connection_id = 'connection-local'
                   AND state = 'active'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(credential_versions, 1);
        assert!(!format!("{:?}", LocalDatabaseKey::from_bytes([0x55; 32])).contains("55"));
        assert!(
            !format!("{:?}", SealedProviderCredential::new(vec![0x55]).unwrap()).contains("55")
        );
    }

    #[test]
    fn failed_duplicate_mutation_rolls_back_business_change() {
        let mut database = database();
        let first = DomainAssetWrite {
            entity_id: "domain-1.test".to_owned(),
            note: Some("first".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        };
        database
            .upsert_domain_asset("mutation-1", TIMESTAMP, first)
            .unwrap();
        let conflicting = DomainAssetWrite {
            entity_id: "domain-1.test".to_owned(),
            note: Some("must roll back".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        };
        assert!(
            database
                .upsert_domain_asset("mutation-1", TIMESTAMP, conflicting)
                .is_err()
        );
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("first")
        );
    }

    #[test]
    fn empty_cloud_replica_is_no_op_and_never_deletes_local_rows() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "mutation-local",
                TIMESTAMP,
                DomainAssetWrite {
                    entity_id: "domain-local.test".to_owned(),
                    note: Some("must survive empty cloud".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        database.merge_domain_asset_replica(vec![]).unwrap();
        let snapshot = database.read_portfolio().unwrap();
        assert_eq!(snapshot.domains.len(), 1);
        assert_eq!(
            snapshot.domains[0].note.as_deref(),
            Some("must survive empty cloud")
        );
    }

    #[test]
    fn applied_replica_deletion_requires_a_matching_tombstone() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        assert!(
            connection
                .execute(
                    "INSERT INTO sync_inbox
                 (workspace_id, server_revision, mutation_id, workspace_schema_version,
                  entity_kind, entity_id, operation_kind, source_device_id,
                  base_server_revision, mutation_payload_json, mutation_payload_sha256, state,
                  received_at, applied_at)
                 VALUES ('workspace-local', 1, 'delete-without-tombstone', 1,
                         'domain_asset', 'deleted.test', 'delete', 'device-1', 0,
                         '{}', ?1, 'applied', ?2, ?2)",
                    params!["A".repeat(43), TIMESTAMP],
                )
                .is_err()
        );
    }

    #[test]
    fn replica_merge_commits_locally_without_echoing_to_outbox() {
        let mut database = database();
        database
            .merge_domain_asset_replica(vec![DomainAssetReplicaMutation {
                server_revision: 1,
                asset: DomainAssetWrite {
                    entity_id: "domain-remote.test".to_owned(),
                    note: Some("validated replica".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            }])
            .unwrap();
        let snapshot = database.read_portfolio().unwrap();
        assert_eq!(snapshot.applied_through_server_revision, 1);
        assert_eq!(snapshot.domains[0].entity_id, "domain-remote.test");
        assert!(database.pending_sync_mutations(10).unwrap().is_empty());
    }

    #[test]
    fn replica_merge_rejects_revision_gaps_atomically() {
        let mut database = database();
        let mutation = |server_revision, entity_id: &str| DomainAssetReplicaMutation {
            server_revision,
            asset: DomainAssetWrite {
                entity_id: entity_id.to_owned(),
                note: None,
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
        };

        assert_eq!(
            database.merge_domain_asset_replica(vec![mutation(2, "gap.test")]),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(database.current_server_revision().unwrap(), 0);
        assert!(database.read_portfolio().unwrap().domains.is_empty());

        assert_eq!(
            database.merge_domain_asset_replica(vec![
                mutation(1, "first.test"),
                mutation(3, "third.test"),
            ]),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(database.current_server_revision().unwrap(), 0);
        assert!(database.read_portfolio().unwrap().domains.is_empty());

        database
            .merge_domain_asset_replica(vec![mutation(1, "first.test"), mutation(2, "second.test")])
            .unwrap();
        assert_eq!(database.current_server_revision().unwrap(), 2);
        assert_eq!(database.read_portfolio().unwrap().domains.len(), 2);
    }

    #[test]
    fn database_enforces_workspace_and_append_only_history_invariants() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        assert!(
            connection
                .execute(
                    "INSERT INTO local_backup_catalog
                 (workspace_id, backup_id, backup_class, workspace_schema_version,
                  through_local_commit_sequence, through_server_revision, manifest_digest,
                  crypto_profile, storage_locator_digest, status, created_at)
                 VALUES ('rogue-workspace', 'backup-1', 'local_full', 1, 0, 0,
                         ?1, 'sqlcipher-v1', ?2, 'creating', ?3)",
                    params!["A".repeat(43), "1".repeat(64), TIMESTAMP],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE active_workspace_metadata SET workspace_id = 'rebound-workspace'
                 WHERE singleton = 1",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "DELETE FROM active_workspace_metadata WHERE singleton = 1",
                    []
                )
                .is_err()
        );

        connection
            .execute(
                "INSERT INTO business_history_events
                 (workspace_id, event_sequence, event_id, aggregate_kind, aggregate_id,
                  event_kind, actor_kind, event_payload_json, event_payload_sha256, occurred_at,
                  local_commit_sequence)
                 VALUES ('workspace-local', 1, 'event-1', 'domain_asset', 'history.test',
                         'created', 'system', '{}', ?1, ?2, 1)",
                params!["0".repeat(64), TIMESTAMP],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "UPDATE business_history_events SET event_kind = 'tampered'
                 WHERE workspace_id = 'workspace-local' AND event_sequence = 1",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "DELETE FROM business_history_events
                 WHERE workspace_id = 'workspace-local' AND event_sequence = 1",
                    [],
                )
                .is_err()
        );
    }

    #[test]
    fn provider_observations_preserve_target_outcomes_and_capability_lineage() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        connection
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id, entity_id, lifecycle_status, created_at, updated_at,
                  local_commit_sequence)
                 VALUES ('workspace-local', 'observed.test', 'active', ?1, ?1, 1)",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id, entity_id, lifecycle_status, created_at, updated_at,
                  local_commit_sequence)
                 VALUES ('workspace-local', 'missing.test', 'active', ?1, ?1, 1)",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO local_provider_connections
                 (workspace_id, connection_id, provider_kind, display_label, active_credential_changed_at,
                  capabilities_json)
                 VALUES ('workspace-local', 'observation-connection', 'cloudflare', 'Observed',
                         ?1, '[\"dns\"]')",
                [TIMESTAMP],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "INSERT INTO operation_plans
                 (workspace_id, plan_id, operation_kind, plan_hash, title, phase, risk_level,
                  item_count, created_at, approved_at, local_commit_sequence)
                 VALUES ('workspace-local', 'direct-approved', 'dns_change', ?1,
                         'Direct approval', 'approved', 'standard', 1, ?2, ?2, 1)",
                    params!["0".repeat(64), TIMESTAMP],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO provider_observation_runs
                 (workspace_id, observation_run_id, connection_id, observation_capability, started_at,
                  completed_at, status)
                 VALUES ('workspace-local', 'dns-run', 'observation-connection', 'dns',
                         ?1, NULL, 'running')",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO provider_observation_targets
                 (workspace_id, observation_run_id, entity_id, ordinal, status, error_code,
                  requested_at, completed_at)
                 VALUES ('workspace-local', 'dns-run', 'observed.test', 0, 'requested',
                         NULL, ?1, NULL)",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO provider_observation_targets
                 (workspace_id, observation_run_id, entity_id, ordinal, status, error_code,
                  requested_at, completed_at)
                 VALUES ('workspace-local', 'dns-run', 'missing.test', 1, 'requested',
                         NULL, ?1, NULL)",
                [TIMESTAMP],
            )
            .unwrap();
        assert!(connection
            .execute(
                "INSERT INTO registrar_observations
                 (workspace_id, observation_id, observation_run_id, entity_id, observation_availability,
                  evidence_status, observed_at, provider_version_token)
                 VALUES ('workspace-local', 'wrong-kind', 'dns-run', 'observed.test',
                         'unavailable', 'unknown', ?1, 'v1')",
                [TIMESTAMP],
            )
            .is_err());
        assert!(
            connection
                .execute(
                    "INSERT INTO asset_valuation_observations
                 (workspace_id, valuation_id, observation_run_id, entity_id, valuation_kind,
                  amount_currency, amount_value, observed_at)
                 VALUES ('workspace-local', 'provider-valuation-without-run', NULL,
                         'observed.test', 'provider', 'USD', '100', ?1)",
                    [TIMESTAMP],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO dns_zone_observations
                 (workspace_id, zone_observation_id, observation_run_id, entity_id,
                  zone_name_ascii, authoritative_nameservers_json, dnssec_status,
                  observation_availability, evidence_status, observed_at, provider_version_token)
                 VALUES ('workspace-local', 'dns-observation', 'dns-run', 'observed.test',
                         'observed.test', '[]', 'unknown', 'unavailable', 'unknown', ?1, 'v1')",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE provider_observation_targets
                 SET status = 'succeeded', completed_at = ?1
                 WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'
                   AND entity_id = 'observed.test'",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE provider_observation_targets
                 SET status = 'failed', error_code = 'provider_timeout', completed_at = ?1
                 WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'
                   AND entity_id = 'missing.test'",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE provider_observation_runs
                 SET status = 'partial', completed_at = ?1, error_code = 'provider_timeout'
                 WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'",
                [TIMESTAMP],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "UPDATE dns_zone_observations SET normalized_evidence_sha256 = 'rewritten'
                 WHERE workspace_id = 'workspace-local'
                   AND zone_observation_id = 'dns-observation'",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "DELETE FROM provider_observation_runs
                 WHERE workspace_id = 'workspace-local' AND observation_run_id = 'dns-run'",
                    [],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO sync_tombstones
                 (workspace_id, entity_kind, entity_id, deleted_local_commit_sequence,
                  deleted_server_revision, deleted_at, purge_after, state)
                 VALUES ('workspace-local', 'domain_asset', 'observed.test', 1, 1, ?1, ?1,
                         'purge_eligible')",
                ["2000-01-01T00:00:00Z"],
            )
            .unwrap();
        connection
            .execute(
                "DELETE FROM domain_assets
                 WHERE workspace_id = 'workspace-local' AND entity_id = 'observed.test'",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM dns_zone_observations
                     WHERE workspace_id = 'workspace-local' AND entity_id = 'observed.test'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn operations_require_an_approved_immutable_plan_and_real_item() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        connection
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id, entity_id, lifecycle_status, created_at, updated_at,
                  local_commit_sequence)
                 VALUES ('workspace-local', 'operation-target.test', 'active', ?1, ?1, 1)",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO local_provider_connections
                 (workspace_id, connection_id, provider_kind, display_label, active_credential_changed_at)
                 VALUES ('workspace-local', 'connection-1', 'cloudflare', 'DNS account', ?1)",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO operation_plans
                 (workspace_id, plan_id, operation_kind, plan_hash, title, phase, risk_level,
                  item_count, created_at, expires_at, approved_at, cancelled_at,
                  local_commit_sequence)
                 VALUES ('workspace-local', 'plan-1', 'dns_change', ?1, 'DNS change',
                         'planned', 'standard', 1, ?2, '2026-08-29T00:00:00Z', NULL, NULL, 1)",
                params!["0".repeat(64), TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO operation_plan_items
                 (workspace_id, plan_id, item_id, ordinal, entity_id, connection_id,
                  capability, field_path, old_value_json, new_value_json, precondition_json,
                  risk_level, execution_mode, inclusion_status)
                 VALUES ('workspace-local', 'plan-1', 'item-1', 0,
                         'operation-target.test', 'connection-1',
                         'dns_write', 'desiredNameservers', NULL, '[]', '{}',
                         'standard', 'automatic', 'included')",
                [],
            )
            .unwrap();
        let operation_sql = "INSERT INTO operations
             (workspace_id, operation_id, plan_id, idempotency_key, phase, requested_at,
              started_at, completed_at, local_commit_sequence)
             VALUES ('workspace-local', ?1, 'plan-1', ?2, 'queued', ?3, NULL, NULL, 1)";
        assert!(
            connection
                .execute(
                    operation_sql,
                    params!["operation-rejected", "key-rejected", TIMESTAMP]
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE operation_plans SET phase = 'executing', approved_at = ?1
                 WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1'",
                    [TIMESTAMP],
                )
                .is_err()
        );
        connection
            .execute(
                "UPDATE operation_plans SET phase = 'approved', approved_at = ?1
                 WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1'",
                [TIMESTAMP],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "INSERT INTO operation_results
                 (workspace_id, operation_id, plan_id, item_id, attempt_number,
                  result_version, outcome, result_json, evidence_digest, observed_at)
                 VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 1,
                         2, 'failed_final', '{}', ?1, ?2)",
                    params!["2".repeat(64), TIMESTAMP],
                )
                .is_err()
        );
        connection
            .execute(operation_sql, params!["operation-1", "key-1", TIMESTAMP])
            .unwrap();
        connection
            .execute(
                operation_sql,
                params!["operation-retry-proof", "key-retry-proof", TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO operation_attempts
                 (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
                  request_digest, started_at, completed_at)
                 VALUES ('workspace-local', 'operation-retry-proof', 'plan-1', 'item-1', 1,
                         'failed_retryable', ?1, ?2, ?2)",
                params!["3".repeat(64), TIMESTAMP],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "INSERT INTO operation_attempts
                 (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
                  request_digest, started_at, completed_at)
                 VALUES ('workspace-local', 'operation-retry-proof', 'plan-1', 'item-1', 2,
                         'queued', ?1, NULL, NULL)",
                    ["4".repeat(64)],
                )
                .is_err()
        );
        connection
            .execute(
                "INSERT INTO operation_attempts
                 (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
                  request_digest, started_at, completed_at)
                 VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 1,
                         'outcome_unknown', ?1, ?2, ?2)",
                params!["0".repeat(64), TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO operation_results
                 (workspace_id, operation_id, plan_id, item_id, attempt_number,
                  result_version, outcome, result_json, evidence_digest, observed_at)
                 VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 1,
                         1, 'outcome_unknown', '{}', ?1, ?2)",
                params!["1".repeat(64), TIMESTAMP],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "INSERT INTO operation_attempts
                 (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
                  request_digest, started_at, completed_at)
                 VALUES ('workspace-local', 'operation-1', 'plan-1', 'item-1', 2,
                         'queued', ?1, NULL, NULL)",
                    ["2".repeat(64)],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE operation_results SET result_json = '{\"rewritten\":true}'
                 WHERE workspace_id = 'workspace-local' AND operation_id = 'operation-1'
                   AND item_id = 'item-1' AND result_version = 1",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "INSERT INTO operation_plan_items
                 (workspace_id, plan_id, item_id, ordinal, capability, precondition_json,
                  risk_level, execution_mode, inclusion_status)
                 VALUES ('workspace-local', 'plan-1', 'late-item', 1, 'dns_write', '{}',
                         'standard', 'manual', 'included')",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE operations SET plan_id = 'other-plan'
                 WHERE workspace_id = 'workspace-local' AND operation_id = 'operation-1'",
                    [],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE operation_plans SET plan_hash = ?1
                 WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1'",
                    ["1".repeat(64)],
                )
                .is_err()
        );
        assert!(connection
            .execute(
                "DELETE FROM operation_plan_items
                 WHERE workspace_id = 'workspace-local' AND plan_id = 'plan-1' AND item_id = 'item-1'",
                [],
            )
            .is_err());
        assert!(
            connection
                .execute(
                    "INSERT INTO operation_attempts
                 (workspace_id, operation_id, plan_id, item_id, attempt_number, status,
                  request_digest, started_at, completed_at)
                 VALUES ('workspace-local', 'operation-1', 'plan-1', 'ghost-item', 1,
                         'queued', ?1, NULL, NULL)",
                    ["0".repeat(64)],
                )
                .is_err()
        );
    }

    #[test]
    fn nested_provider_account_canary_in_outbox_fails_closed() {
        let mut database = database();
        let workspace_id = database.workspace_id.clone();
        database
            .store
            .fixture_connection()
            .execute(
                "INSERT INTO sync_outbox
                 (workspace_id, mutation_id, entity_kind, entity_id, mutation_payload_json, created_at, acknowledged_at)
                 VALUES (?1, 'mutation-canary', 'domain_asset', 'domain-canary.test', ?2, ?3, NULL)",
                params![
                    workspace_id,
                    r#"{"safe":{"provider_account-id":"must-never-sync"}}"#,
                    TIMESTAMP,
                ],
            )
            .unwrap();
        assert_eq!(
            database.pending_sync_mutations(10),
            Err(BusinessDatabaseError::SecretInSyncPayload)
        );
    }
}
