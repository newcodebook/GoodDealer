use std::fmt::{Debug, Display, Formatter};
use std::path::Path;

use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{ActiveWorkspaceConnection, ActiveWorkspaceKey};
#[cfg(test)]
use crate::portfolio_projection::PortfolioReadSnapshot;
use crate::portfolio_projection::{
    AssetLibraryReadSnapshot, DomainAssetProjectionRow, DomainDetailReadSnapshot, Money,
    PortfolioReadError, validate_domain_asset_id, validate_identifier, validate_projection,
    validate_timestamp,
};

mod cloudflare_credential;
pub(crate) use cloudflare_credential::{
    CloudflareCredentialEnvelopeKind, CloudflareCredentialOperationKind,
    CloudflareCredentialPreparation, CloudflareCredentialPreparationDisposition,
    CloudflareCredentialRecoveryObservation, CloudflareCredentialResolution,
    CloudflareCredentialStagedObservation, CloudflareCredentialWitness,
    CloudflarePrewriteFailureReason, staged_observation_digest,
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

pub struct LocalDatabaseKey([u8; 32]);

impl LocalDatabaseKey {
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    #[cfg(test)]
    #[expect(
        dead_code,
        reason = "database-key cloning is retained for private rebootstrap test fixtures"
    )]
    pub(crate) fn cloned(&self) -> Self {
        Self(self.0)
    }

    #[cfg(test)]
    pub(crate) const fn custody_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Debug for LocalDatabaseKey {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("LocalDatabaseKey([REDACTED])")
    }
}

impl Drop for LocalDatabaseKey {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseRecoveryProof {
    pub workspace_id: String,
    pub row_digest: String,
    pub applied_server_revision: u64,
    pub local_commit_sequence: u64,
    pub next_device_mutation_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DurableSyncSnapshot {
    pub pending_mutation_count: u64,
    pub open_conflict_count: u64,
    pub rejected_mutation_count: u64,
    pub recovery_required: bool,
    pub applied_through_server_revision: u64,
    pub last_replication_activity_at: Option<String>,
}

/// Renderer-visible effect of one atomically committed synchronization transaction.
///
/// The Host consumes this result while it still owns the sole business runtime lock. Exact
/// idempotent replay is unchanged; any commit that changes a customer-visible projection or
/// `SyncSnapshot` field advances the single Host read generation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SyncProjectionEffect {
    Unchanged,
    VisibleStateChanged,
}

/// Full-clones one `SQLCipher` database into a different file encrypted by a fresh key.
///
/// # Errors
///
/// Returns a storage error if either path/key is invalid, the destination exists, or export fails.
#[cfg(test)]
pub fn clone_encrypted_database(
    source: &Path,
    source_key: &LocalDatabaseKey,
    destination: &Path,
    destination_key: &LocalDatabaseKey,
) -> Result<(), BusinessDatabaseError> {
    super::clone_keyed_database(source, &source_key.0, destination, &destination_key.0)
        .map_err(|_| BusinessDatabaseError::StorageRejected)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainAssetWrite {
    pub entity_id: String,
    pub note: Option<String>,
    pub portfolio_id: Option<String>,
    pub tags: Vec<String>,
    pub target_price: Option<Money>,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "replica mutation input remains private behind the native sync facade"
    )
)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainAssetReplicaMutation {
    pub server_revision: u64,
    pub asset: DomainAssetWrite,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudflareDnsObservationWrite {
    pub observation_id: String,
    pub observation_run_id: String,
    pub entity_id: String,
    pub connection_id: String,
    pub lease_epoch: u64,
    pub observed_at: String,
    pub zone_name_ascii: String,
    pub authoritative_nameservers: Vec<String>,
    pub dnssec_status: String,
    pub availability: String,
    pub zone_status: String,
    pub records: Vec<CloudflareDnsRecordWrite>,
    pub provider_version_token: String,
    pub credential_generation: u64,
    pub credential_scope_digest: String,
    pub credential_zone_digest: String,
    pub credential_public_proof: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudflareConnectionObservationAdmission {
    pub generation: u64,
    pub scope_digest: String,
    pub zone_digest: String,
    pub public_proof: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DomainProviderBindingReceipt {
    pub disposition: &'static str,
    pub entity_id: String,
    pub connection_id: String,
    pub provider_kind: String,
    pub resource_kind: String,
    pub resource_binding_digest: String,
    pub observation_digest: String,
    pub resource_label: String,
    pub binding_generation: u64,
    pub validation_status: String,
    pub verified_at: String,
    pub last_observed_at: String,
    pub local_commit_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudflareDnsRecordWrite {
    pub record_key: String,
    pub record_type: String,
    pub owner_name_ascii: String,
    pub ttl_seconds: Option<u32>,
    pub priority: Option<u16>,
    pub canonical_value: String,
    pub proxied: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingCloudflareDnsProjection {
    pub observation_id: String,
    pub entity_id: String,
    pub lease_epoch: u64,
    pub source_sequence: u64,
    pub observed_at: String,
    pub projection_json: String,
    pub canonical_request_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedCloudflareDnsProjection {
    pub projection: PendingCloudflareDnsProjection,
    pub delivery_attempt_fence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudflareDnsProjectionAcknowledgement {
    pub observation_id: String,
    pub lease_epoch: u64,
    pub source_sequence: u64,
    pub delivery_attempt_fence: u64,
    pub canonical_request_digest: String,
    pub observation_sequence: u64,
    pub disposition: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedSyncMutation {
    pub mutation_id: String,
    pub source_device_id: String,
    pub active_lease_epoch: u64,
    pub device_mutation_sequence: u64,
    pub delivery_attempt_fence: u64,
    pub wire_mutation_json: String,
    pub wire_mutation_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncMutationAcknowledgement {
    pub mutation_id: String,
    pub source_device_id: String,
    pub active_lease_epoch: u64,
    pub device_mutation_sequence: u64,
    pub delivery_attempt_fence: u64,
    pub wire_mutation_digest: String,
    pub server_revision: u64,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TestPendingSyncRow {
    pub(crate) mutation_id: String,
    pub(crate) entity_id: String,
    pub(crate) mutation_payload_json: String,
}

impl BusinessDatabase {
    pub(crate) fn read_cloudflare_connection(
        &self,
    ) -> Result<(Option<String>, Option<String>), BusinessDatabaseError> {
        self.store.raw_connection().query_row(
            "SELECT connection_id, display_label FROM local_provider_connections WHERE workspace_id=?1 AND provider_kind='cloudflare' AND lifecycle_status='active' AND validation_status='valid' ORDER BY connection_id LIMIT 1",
            [&self.workspace_id],
            |row| Ok((Some(row.get(0)?), Some(row.get(1)?))),
        ).optional().map(|value| value.unwrap_or((None, None))).map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn read_cloudflare_observation(
        &self,
        entity_id: &str,
    ) -> Result<crate::DesktopCloudflareObservationRead, BusinessDatabaseError> {
        validate_domain_asset_id(entity_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let connection = self.store.raw_connection();
        let zone: Option<(String, String, String, String, String, i64)> = connection.query_row(
            "SELECT z.zone_observation_id,z.zone_name_ascii,z.observation_availability,z.evidence_status,z.observed_at,h.source_sequence FROM cloudflare_dns_projection_heads h JOIN dns_zone_observations z ON z.workspace_id=h.workspace_id AND z.zone_observation_id=h.observation_id WHERE h.workspace_id=?1 AND h.entity_id=?2",
            params![self.workspace_id, entity_id],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
        ).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let Some((observation_id, zone_label, availability, uncertainty, observed_at, version)) =
            zone
        else {
            return Ok(crate::DesktopCloudflareObservationRead {
                schema_version: 1,
                read_generation: 0,
                entity_id: entity_id.to_owned(),
                observed_at: None,
                version: 0,
                availability: "unavailable".to_owned(),
                uncertainty: "unknown".to_owned(),
                zone_label: None,
                zone_status: "unknown".to_owned(),
                records: Vec::new(),
            });
        };
        let zone_status: String = connection.query_row("SELECT coalesce(cloudflare_zone_status,'unknown') FROM dns_zone_observations WHERE workspace_id=?1 AND zone_observation_id=?2", params![self.workspace_id, observation_id], |row| row.get(0)).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut statement = connection.prepare("SELECT record_key,owner_name_ascii,record_type,canonical_value,ttl_seconds,coalesce(proxied,0) FROM dns_record_observations WHERE workspace_id=?1 AND zone_observation_id=?2 ORDER BY record_type,owner_name_ascii,record_key LIMIT 1025").map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let records = statement
            .query_map(params![self.workspace_id, observation_id], |row| {
                Ok(crate::DesktopCloudflareObservationRecord {
                    record_id: row.get(0)?,
                    fqdn: row.get(1)?,
                    r#type: row.get(2)?,
                    display_value: row.get(3)?,
                    ttl: row.get(4)?,
                    proxied: row.get::<_, i64>(5)? != 0,
                    provider_version_token: u64::try_from(version).unwrap_or(0),
                    classification: "ordinary",
                })
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if records.len() > 1_024 || !(0..=9_007_199_254_740_991).contains(&version) {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        Ok(crate::DesktopCloudflareObservationRead {
            schema_version: 1,
            read_generation: 0,
            entity_id: entity_id.to_owned(),
            observed_at: Some(observed_at),
            version: u64::try_from(version).map_err(|_| BusinessDatabaseError::StorageRejected)?,
            availability,
            uncertainty,
            zone_label: Some(zone_label),
            zone_status,
            records,
        })
    }

    #[cfg(test)]
    pub(crate) fn test_pending_sync_rows(
        &self,
        limit: usize,
    ) -> Result<Vec<TestPendingSyncRow>, BusinessDatabaseError> {
        let mut statement = self
            .store
            .raw_connection()
            .prepare(
                "SELECT mutation_id, entity_id, mutation_payload_json
                 FROM sync_outbox WHERE workspace_id=?1 AND acknowledged_at IS NULL
                 ORDER BY created_at, mutation_id LIMIT ?2",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        statement
            .query_map(
                params![
                    self.workspace_id,
                    i64::try_from(limit).map_err(|_| BusinessDatabaseError::InvalidInput)?
                ],
                |row| {
                    Ok(TestPendingSyncRow {
                        mutation_id: row.get(0)?,
                        entity_id: row.get(1)?,
                        mutation_payload_json: row.get(2)?,
                    })
                },
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}

pub(crate) const MAX_SYNC_PUSH_REQUEST_BYTES: usize = 1024 * 1024;

pub(crate) fn serialize_sync_push_request(
    wire_mutations: &[String],
) -> Result<Vec<u8>, BusinessDatabaseError> {
    let mutations = wire_mutations
        .iter()
        .map(|mutation| serde_json::from_str::<serde_json::Value>(mutation))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let request = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 2,
        "mutations": mutations,
    }))
    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if request.is_empty() || request.len() > MAX_SYNC_PUSH_REQUEST_BYTES {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(request)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeCheckpointDescriptor {
    pub schema_version: u64,
    pub checkpoint_id: String,
    pub workspace_id: String,
    pub workspace_schema_version: u64,
    pub through_server_revision: u64,
    pub checkpoint_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictCandidate {
    pub conflict_id: String,
    pub entity_id: String,
    pub field_path: String,
    pub local_value_json: String,
    pub remote_value_json: String,
    pub local_value_hash: String,
    pub remote_value_hash: String,
    pub remote_server_revision: u64,
    pub candidate_version: u64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncResolutionReceipt {
    pub resolution_id: String,
    pub conflict_id: String,
    pub choice: String,
    pub outbox_mutation_id: Option<String>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RebootstrapSlotId {
    A,
    B,
}

#[cfg(test)]
impl RebootstrapSlotId {
    const fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
        }
    }
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebootstrapJournalLink {
    pub journal_id: String,
    pub slot_id: RebootstrapSlotId,
    pub publication_sequence: u64,
    pub manifest_digest: String,
    pub authority_digest: String,
    pub floor_digest: String,
    pub binding_digest: String,
}

#[cfg(all(test, unix))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TestActiveRebootstrapJournalLinkSnapshot {
    active_row_count: u64,
    digest: Option<String>,
}

#[cfg(all(test, unix))]
impl TestActiveRebootstrapJournalLinkSnapshot {
    pub(crate) const fn is_present(&self) -> bool {
        self.digest.is_some()
    }

    pub(crate) const fn active_row_count(&self) -> u64 {
        self.active_row_count
    }

    pub(crate) fn digest(&self) -> Option<&str> {
        self.digest.as_deref()
    }
}

#[cfg(all(test, unix))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TestRebootstrapJournalLinkHostileCase {
    RemoveActive,
    DuplicateActive,
    MutateBindingDigest,
    MarkNonVerified,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebootstrapReplayPage {
    pub page_json: String,
    pub confirmation_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullRequestV2 {
    pub schema_version: u8,
    pub after_server_revision: u64,
    pub cursor: Option<String>,
    pub confirm: Option<String>,
    pub page_limit: u16,
}

/// Host-owned v2 pull page. The wire JSON is parsed with `deny_unknown_fields` before it
/// reaches the materialization transaction; callers cannot select another workspace.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncPageV2 {
    schema_version: u8,
    workspace_id: String,
    from_server_revision_exclusive: u64,
    through_server_revision_inclusive: u64,
    mutations: Vec<SyncMutationV2>,
    returned_through_server_revision: u64,
    next_cursor: Option<String>,
    page_digest: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncMutationV2 {
    schema_version: u8,
    mutation_id: String,
    workspace_id: String,
    workspace_schema_version: u64,
    entity_type: String,
    entity_id: String,
    operation_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted_at: Option<String>,
    base_server_revision: u64,
    changed_fields: Vec<SyncChangedFieldV2>,
    source_device_id: String,
    active_lease_epoch: u64,
    device_mutation_sequence: u64,
    server_revision: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncChangedFieldV2 {
    field_path: String,
    value: serde_json::Value,
}

type ExistingMutationRow = (
    String,
    String,
    String,
    Option<String>,
    i64,
    Option<i64>,
    i64,
    String,
    Option<String>,
    Option<i64>,
    i64,
);

type ExistingResolutionReceiptRow = (String, String, Option<String>, i64, i64, String, String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainAssetMutationReceipt {
    pub schema_version: u8,
    pub disposition: String,
    pub operation: String,
    pub mutation_id: String,
    pub entity_id: String,
    pub local_commit_sequence: u64,
    pub device_mutation_sequence: u64,
    pub base_server_revision: u64,
    pub active_lease_epoch: u64,
    pub committed_at: String,
    pub read_generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusinessDatabaseError {
    InvalidInput,
    StorageRejected,
    WorkspaceRejected,
    SecretInSyncPayload,
    SchemaRejected,
    CredentialSchemaRebuildRequired,
    ProjectionRejected,
    RevisionRejected,
    AssetNotFound,
    QueryRejected,
    WindowRejected,
    MutationConflict,
    MutationStale,
    AssetDeleted,
    SequenceExhausted,
    ProviderBindingUnavailable,
}

impl Display for BusinessDatabaseError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "LOCAL_INPUT_REJECTED",
            Self::StorageRejected => "LOCAL_STORAGE_REJECTED",
            Self::WorkspaceRejected => "LOCAL_WORKSPACE_REJECTED",
            Self::SecretInSyncPayload => "LOCAL_SYNC_SECRET_REJECTED",
            Self::SchemaRejected => "LOCAL_SCHEMA_REJECTED",
            Self::CredentialSchemaRebuildRequired => "RebuildRequired(P0_07_CREDENTIAL_SCHEMA)",
            Self::ProjectionRejected => "LOCAL_PROJECTION_REJECTED",
            Self::RevisionRejected => "LOCAL_REVISION_REJECTED",
            Self::AssetNotFound => "LOCAL_ASSET_NOT_FOUND",
            Self::QueryRejected => "LOCAL_QUERY_REJECTED",
            Self::WindowRejected => "LOCAL_WINDOW_REJECTED",
            Self::MutationConflict => "LOCAL_MUTATION_IDEMPOTENCY_CONFLICT",
            Self::MutationStale => "LOCAL_MUTATION_STALE_AUTHORITY",
            Self::AssetDeleted => "LOCAL_ASSET_DELETED",
            Self::SequenceExhausted => "LOCAL_MUTATION_SEQUENCE_EXHAUSTED",
            Self::ProviderBindingUnavailable => "LOCAL_PROVIDER_BINDING_UNAVAILABLE",
        })
    }
}

impl std::error::Error for BusinessDatabaseError {}

#[cfg(test)]
fn validate_rebootstrap_journal_link(
    link: &RebootstrapJournalLink,
) -> Result<(), BusinessDatabaseError> {
    validate_identifier(&link.journal_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    for digest in [
        &link.manifest_digest,
        &link.authority_digest,
        &link.floor_digest,
        &link.binding_digest,
    ] {
        validate_sha256_hex(digest)?;
    }
    if link.publication_sequence == 0
        || !matches!(link.slot_id, RebootstrapSlotId::A | RebootstrapSlotId::B)
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

pub struct BusinessDatabase {
    workspace_id: String,
    store: ActiveWorkspaceConnection,
}

#[cfg(test)]
fn verify_rebootstrap_journal_link_on_connection(
    connection: &Connection,
    workspace_id: &str,
    link: &RebootstrapJournalLink,
) -> Result<(), BusinessDatabaseError> {
    validate_identifier(workspace_id).map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
    validate_rebootstrap_journal_link(link)?;
    let sequence = i64::try_from(link.publication_sequence)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sync_rebootstrap_journal
             WHERE workspace_id=?1 AND publication_sequence=?2 AND journal_id=?3
               AND slot_id=?4 AND manifest_digest=?5 AND authority_digest=?6
               AND floor_digest=?7 AND binding_digest=?8 AND state='verified'",
            params![
                workspace_id,
                sequence,
                link.journal_id,
                link.slot_id.as_str(),
                link.manifest_digest,
                link.authority_digest,
                link.floor_digest,
                link.binding_digest
            ],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if count != 1 {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(())
}

#[cfg(all(test, unix))]
type TestRebootstrapJournalRow = (String, String, i64, String, String, String, String, String);

#[cfg(all(test, unix))]
fn active_rebootstrap_journal_link_snapshot_on_connection(
    connection: &Connection,
    workspace_id: &str,
) -> Result<TestActiveRebootstrapJournalLinkSnapshot, BusinessDatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT journal_id,slot_id,publication_sequence,manifest_digest,authority_digest,
                    floor_digest,binding_digest,state
             FROM sync_rebootstrap_journal
             WHERE workspace_id=?1 AND publication_sequence=(
               SELECT MAX(publication_sequence) FROM sync_rebootstrap_journal
               WHERE workspace_id=?1
             )",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let rows = statement
        .query_map([workspace_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })
        .map_err(|_| BusinessDatabaseError::StorageRejected)?
        .collect::<Result<Vec<TestRebootstrapJournalRow>, _>>()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let active_row_count =
        u64::try_from(rows.len()).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let digest =
        match rows.as_slice() {
            [(journal_id, slot_id, sequence, manifest, authority, floor, binding, state)]
                if state == "verified" =>
            {
                let mut digest = Sha256::new();
                digest.update(b"GOODDEALER/TEST-ACTIVE-REBOOTSTRAP-LINK\0");
                append_digest_part(&mut digest, workspace_id.as_bytes());
                append_digest_part(&mut digest, journal_id.as_bytes());
                append_digest_part(&mut digest, slot_id.as_bytes());
                digest.update(sequence.to_be_bytes());
                append_digest_part(&mut digest, manifest.as_bytes());
                append_digest_part(&mut digest, authority.as_bytes());
                append_digest_part(&mut digest, floor.as_bytes());
                append_digest_part(&mut digest, binding.as_bytes());
                Some(digest.finalize().iter().fold(
                    String::with_capacity(64),
                    |mut output, byte| {
                        use std::fmt::Write as _;
                        write!(output, "{byte:02x}").expect("String writes cannot fail");
                        output
                    },
                ))
            }
            _ => None,
        };
    Ok(TestActiveRebootstrapJournalLinkSnapshot {
        active_row_count,
        digest,
    })
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct CheckpointAdmissionFloor {
    applied: i64,
    read_through: i64,
    pinned_target: i64,
    checkpoint_through: i64,
    anti_rollback_server: i64,
    anti_rollback_schema: i64,
}

#[cfg(test)]
impl CheckpointAdmissionFloor {
    fn admit(self, revision: i64) -> Result<(), BusinessDatabaseError> {
        const SUPPORTED_SYNC_WIRE_SCHEMA_VERSION: i64 = 2;
        if [
            self.applied,
            self.read_through,
            self.pinned_target,
            self.checkpoint_through,
            self.anti_rollback_server,
        ]
        .into_iter()
        .any(|floor| floor < 0 || revision < floor)
            || self.anti_rollback_schema < 0
            || self.anti_rollback_schema > SUPPORTED_SYNC_WIRE_SCHEMA_VERSION
        {
            return Err(BusinessDatabaseError::RevisionRejected);
        }
        Ok(())
    }
}

#[cfg(test)]
fn checkpoint_admission_floor(
    connection: &Connection,
    expected_workspace_id: &str,
) -> Result<CheckpointAdmissionFloor, BusinessDatabaseError> {
    let row: (String, String, i64, i64, i64, i64, i64, i64, i64) = connection
        .query_row(
            "SELECT storage_domain,workspace_id,workspace_schema_version,
               applied_through_server_revision,
               COALESCE((SELECT MAX(read_through_server_revision)
                         FROM sync_reader_state WHERE workspace_id=?1),0),
               COALESCE((SELECT MAX(pinned_target_server_revision)
                         FROM sync_reader_state WHERE workspace_id=?1),0),
               COALESCE((SELECT MAX(checkpoint_through_server_revision)
                         FROM sync_reader_state WHERE workspace_id=?1),0),
               COALESCE((SELECT MAX(anti_rollback_server_revision_floor)
                         FROM sync_reader_state WHERE workspace_id=?1),0),
               COALESCE((SELECT MAX(anti_rollback_schema_version_floor)
                         FROM sync_reader_state WHERE workspace_id=?1),0)
             FROM active_workspace_metadata WHERE singleton=1",
            [expected_workspace_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if row.0 != "active_workspace" || row.2 != 1 {
        return Err(BusinessDatabaseError::SchemaRejected);
    }
    if row.1 != expected_workspace_id {
        return Err(BusinessDatabaseError::WorkspaceRejected);
    }
    Ok(CheckpointAdmissionFloor {
        applied: row.3,
        read_through: row.4,
        pinned_target: row.5,
        checkpoint_through: row.6,
        anti_rollback_server: row.7,
        anti_rollback_schema: row.8,
    })
}

#[cfg(test)]
#[expect(
    clippy::type_complexity,
    reason = "the test-only final-head oracle mirrors one fixed durable reader-state row"
)]
fn verify_rebootstrap_final_head(
    connection: &Connection,
    workspace_id: &str,
    device_id: &str,
    checkpoint_revision: i64,
    admission_floor: CheckpointAdmissionFloor,
) -> Result<(), BusinessDatabaseError> {
    let current_floor = checkpoint_admission_floor(connection, workspace_id)?;
    let row: Option<(i64, Option<i64>, Option<String>, String, i64, i64)> = connection
        .query_row(
            "SELECT read_through_server_revision,pinned_target_server_revision,
                    continuation_token,status,anti_rollback_server_revision_floor,
                    anti_rollback_schema_version_floor
             FROM sync_reader_state WHERE workspace_id=?1 AND device_id=?2",
            params![workspace_id, device_id],
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
        .optional()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((read_through, pinned_target, continuation, status, anti_server, anti_schema)) = row
    else {
        return Err(BusinessDatabaseError::StorageRejected);
    };
    let final_head = current_floor.applied;
    admission_floor.admit(final_head)?;
    current_floor.admit(final_head)?;
    if final_head < checkpoint_revision
        || read_through != final_head
        || pinned_target != Some(final_head)
        || continuation.is_some()
        || status != "active"
        || anti_server != final_head
        || anti_schema > 2
    {
        return Err(BusinessDatabaseError::RevisionRejected);
    }
    Ok(())
}

#[cfg(all(test, unix))]
fn open_descriptor_bound_database_read_only(
    file: &std::fs::File,
    key: &LocalDatabaseKey,
) -> Result<Connection, BusinessDatabaseError> {
    use std::os::fd::AsRawFd as _;

    use rusqlite::OpenFlags;
    let metadata = file
        .metadata()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let descriptor_path = format!("/dev/fd/{}", file.as_raw_fd());
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let descriptor_path = format!("/proc/self/fd/{}", file.as_raw_fd());
    let uri = format!("file:{descriptor_path}?mode=ro&immutable=1");
    let connection = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let key_sql = crate::sqlcipher_key_sql::key_pragma(key.custody_bytes());
    connection
        .execute_batch(key_sql.as_str())
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    crate::sqlcipher_process_policy::apply(&connection)
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    connection
        .execute_batch(
            "PRAGMA trusted_schema = OFF;
             PRAGMA query_only = ON;",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if !connection
        .is_readonly("main")
        .map_err(|_| BusinessDatabaseError::StorageRejected)?
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let query_only: i64 = connection
        .query_row("PRAGMA query_only", [], |row| row.get(0))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if query_only != 1 || journal_mode != "delete" {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    connection
        .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(connection)
}

#[cfg(all(test, unix))]
fn verify_clean_manifest_on_connection(
    connection: &Connection,
    expected_workspace_id: &str,
    expected_workspace_schema_version: u64,
) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
    validate_identifier(expected_workspace_id)
        .map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
    let expected_workspace_schema_version = i64::try_from(expected_workspace_schema_version)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    if expected_workspace_schema_version == 0 {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    if expected_workspace_schema_version != 1 {
        return Err(BusinessDatabaseError::SchemaRejected);
    }
    super::portfolio::verify_active_manifest(connection)
        .map_err(|_| BusinessDatabaseError::SchemaRejected)?;
    let metadata: Option<(String, String, i64)> = connection
        .query_row(
            "SELECT storage_domain,workspace_id,workspace_schema_version
             FROM active_workspace_metadata WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| BusinessDatabaseError::SchemaRejected)?;
    let Some((storage_domain, workspace_id, workspace_schema_version)) = metadata else {
        return Err(BusinessDatabaseError::SchemaRejected);
    };
    if storage_domain != "active_workspace"
        || workspace_schema_version != expected_workspace_schema_version
    {
        return Err(BusinessDatabaseError::SchemaRejected);
    }
    if workspace_id != expected_workspace_id {
        return Err(BusinessDatabaseError::WorkspaceRejected);
    }
    let proof = recovery_proof_from_connection(connection)?;
    if proof.workspace_id != expected_workspace_id {
        return Err(BusinessDatabaseError::WorkspaceRejected);
    }
    Ok(proof)
}

/// Verifies a custody-retained database and its optional active publication link through one
/// descriptor-bound, immutable, query-only connection.
///
/// The returned proof describes current durable rows. It is deliberately not compared with any
/// historical proof digest embedded in publication evidence; the exact verified journal-link row
/// is the independent continuity binding. `None` means that this caller has no active-link
/// expectation, so only the clean manifest and workspace binding are verified.
#[cfg(all(test, unix))]
pub(crate) fn verify_terminal_publication_database_read_only(
    file: &std::fs::File,
    key: &LocalDatabaseKey,
    expected_workspace_id: &str,
    expected_workspace_schema_version: u64,
    expected_journal_link: Option<&RebootstrapJournalLink>,
) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
    if let Some(link) = expected_journal_link {
        validate_rebootstrap_journal_link(link)?;
    }
    let connection = open_descriptor_bound_database_read_only(file, key)?;
    let proof = verify_clean_manifest_on_connection(
        &connection,
        expected_workspace_id,
        expected_workspace_schema_version,
    )?;
    if let Some(link) = expected_journal_link {
        verify_rebootstrap_journal_link_on_connection(&connection, expected_workspace_id, link)?;
    }
    Ok(proof)
}

/// Verifies a custody-retained clean-start database without selecting a path or mutating it.
///
/// This test-only seam cannot run migrations, change journal mode, or obtain a writable
/// connection. The schema check is exact against the current active-workspace manifest.
#[cfg(all(test, unix))]
pub(crate) fn verify_clean_start_database_read_only(
    file: &std::fs::File,
    key: &LocalDatabaseKey,
    expected_workspace_id: &str,
    expected_workspace_schema_version: u64,
) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
    verify_terminal_publication_database_read_only(
        file,
        key,
        expected_workspace_id,
        expected_workspace_schema_version,
        None,
    )
}

/// Reopens a custody-retained rebootstrap candidate through its descriptor and verifies only
/// durable recovery state. This test-only seam deliberately cannot run migrations, select a
/// pathname, change journal mode, or obtain a writable connection.
#[cfg(all(test, unix))]
pub(crate) fn verify_rebootstrap_recovery_read_only(
    file: &std::fs::File,
    key: &LocalDatabaseKey,
    expected_workspace_id: &str,
    expected_journal_link: &RebootstrapJournalLink,
) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
    verify_terminal_publication_database_read_only(
        file,
        key,
        expected_workspace_id,
        1,
        Some(expected_journal_link),
    )
}

impl BusinessDatabase {
    #[cfg(test)]
    pub(crate) fn provider_binding_snapshot_for_test(&self) -> Vec<Vec<Vec<String>>> {
        [
            "domain_asset_provider_bindings",
            "active_workspace_metadata",
            "sync_outbox",
            "sync_outbox_fields",
            "cloudflare_dns_projection_outbox",
        ]
        .iter()
        .map(|table| {
            let mut statement = self
                .store
                .raw_connection()
                .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = statement.column_count();
            statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|column| {
                            row.get::<_, rusqlite::types::Value>(column)
                                .map(|value| format!("{value:?}"))
                        })
                        .collect::<Result<Vec<_>, _>>()
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        })
        .collect()
    }

    /// Binds an existing local asset to the latest Host-verified Cloudflare Zone observation.
    ///
    /// The Provider resource digest and connection are read from the local staged observation;
    /// callers cannot provide either value. A binding identity is immutable, so credential or
    /// resource drift fails closed until an explicit replacement workflow is implemented.
    #[expect(
        clippy::too_many_lines,
        clippy::type_complexity,
        reason = "the binding transaction keeps selection, replay, and commit-fence invariants together"
    )]
    pub(crate) fn bind_latest_cloudflare_zone(
        &mut self,
        entity_id: &str,
        allow_new: bool,
        sequence_available: bool,
        committed_at: &str,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<DomainProviderBindingReceipt, BusinessDatabaseError> {
        validate_domain_asset_id(entity_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let latest: Option<(String, String, String, String, i64, String)> = transaction
            .query_row(
                "SELECT c.connection_id,b.zone_digest,b.observation_digest,b.zone_name_ascii,
                        c.active_credential_generation,b.observed_at
                   FROM cloudflare_dns_staged_batches b
                   JOIN domain_assets a
                     ON a.workspace_id=b.workspace_id
                    AND a.entity_id=b.entity_id
                   JOIN cloudflare_credential_roots r
                     ON r.workspace_id=b.workspace_id
                    AND r.connection_incarnation_id=b.connection_incarnation_id
                   JOIN local_provider_connections c
                     ON c.workspace_id=r.workspace_id
                    AND c.connection_id=r.logical_connection_id
                  WHERE b.workspace_id=?1
                    AND b.entity_id=?2
                    AND b.entity_id=b.zone_name_ascii
                    AND a.deleted_at IS NULL
                    AND a.lifecycle_status IN ('active','expired','sold','dropped')
                    AND b.visibility='committed'
                    AND b.observation_availability='available'
                    AND b.cloudflare_zone_status IN ('active','pending')
                    AND r.retired_at IS NULL
                    AND r.known_envelope_kind='active'
                    AND r.known_envelope_generation=c.active_credential_generation
                    AND r.known_zone_digest=b.zone_digest
                    AND c.provider_kind='cloudflare'
                    AND c.lifecycle_status='active'
                    AND c.validation_status='valid'
                    AND c.credential_use_state='active'
                    AND c.active_credential_generation IS NOT NULL
                    AND c.active_credential_zone_digest=b.zone_digest
                   ORDER BY b.observed_at DESC,b.updated_at DESC,b.staged_batch_id DESC
                   LIMIT 1",
                params![self.workspace_id, entity_id],
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
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let Some((
            connection_id,
            resource_binding_digest,
            observation_digest,
            resource_label,
            generation,
            observed_at,
        )) = latest
        else {
            return Err(BusinessDatabaseError::ProviderBindingUnavailable);
        };
        let binding_generation =
            u64::try_from(generation).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        validate_sha256_hex(&resource_binding_digest)?;
        validate_sha256_hex(&observation_digest)?;
        validate_local_text(&connection_id)?;
        validate_domain_asset_id(&resource_label)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if resource_label != entity_id {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let existing: Option<(
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
        )> = transaction
            .query_row(
                "SELECT connection_id,provider_kind,resource_binding_digest,observation_digest,
                        binding_generation,resource_label,validation_status,verified_at,last_observed_at
                   FROM domain_asset_provider_bindings
                  WHERE workspace_id=?1 AND entity_id=?2 AND resource_kind='zone'",
                params![self.workspace_id, entity_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if let Some((
            old_connection,
            old_provider,
            old_digest,
            old_observation,
            old_generation,
            old_label,
            old_status,
            old_verified_at,
            old_last_observed_at,
        )) = existing
        {
            if old_connection != connection_id
                || old_provider != "cloudflare"
                || old_digest != resource_binding_digest
                || old_label != resource_label
            {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            let old_generation = u64::try_from(old_generation)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if binding_generation < old_generation {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            if old_observation == observation_digest
                && old_generation == binding_generation
                && old_status == "verified"
            {
                let local_commit_sequence: i64 = transaction
                    .query_row(
                        "SELECT local_commit_sequence
                           FROM domain_asset_provider_bindings
                          WHERE workspace_id=?1 AND entity_id=?2 AND resource_kind='zone'",
                        params![self.workspace_id, entity_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                commit_fence()?;
                transaction
                    .commit()
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                return Ok(DomainProviderBindingReceipt {
                    disposition: "replayed",
                    entity_id: entity_id.to_owned(),
                    connection_id,
                    provider_kind: "cloudflare".to_owned(),
                    resource_kind: "zone".to_owned(),
                    resource_binding_digest,
                    observation_digest,
                    resource_label,
                    binding_generation,
                    validation_status: "verified".to_owned(),
                    verified_at: old_verified_at.ok_or(BusinessDatabaseError::StorageRejected)?,
                    last_observed_at: old_last_observed_at
                        .ok_or(BusinessDatabaseError::StorageRejected)?,
                    local_commit_sequence: u64::try_from(local_commit_sequence)
                        .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                });
            }
            if !allow_new {
                return Err(BusinessDatabaseError::MutationStale);
            }
        } else if !allow_new {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if !sequence_available {
            return Err(BusinessDatabaseError::SequenceExhausted);
        }
        let local_commit_sequence: i64 = transaction
            .query_row(
                "UPDATE active_workspace_metadata
                    SET local_commit_sequence=local_commit_sequence+1,updated_at=?1
                  WHERE singleton=1
                RETURNING local_commit_sequence",
                [committed_at],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO domain_asset_provider_bindings
                 (workspace_id,entity_id,connection_id,provider_kind,resource_kind,
                  resource_binding_digest,observation_digest,resource_label,binding_generation,
                  local_commit_sequence,validation_status,verified_at,last_observed_at,created_at,updated_at)
                 VALUES (?1,?2,?3,'cloudflare','zone',?4,?5,?6,?7,?8,'verified',?9,?10,?9,?9)
                 ON CONFLICT(workspace_id,entity_id,resource_kind) DO UPDATE SET
                   observation_digest=excluded.observation_digest,
                   resource_label=excluded.resource_label,
                   binding_generation=excluded.binding_generation,
                   local_commit_sequence=excluded.local_commit_sequence,
                   validation_status='verified',
                   verified_at=excluded.verified_at,
                   last_observed_at=excluded.last_observed_at,
                   updated_at=excluded.updated_at",
                params![
                    self.workspace_id,
                    entity_id,
                    connection_id,
                    resource_binding_digest,
                    observation_digest,
                    resource_label,
                    generation,
                    local_commit_sequence,
                    committed_at,
                    observed_at,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        commit_fence()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(DomainProviderBindingReceipt {
            disposition: "committed",
            entity_id: entity_id.to_owned(),
            connection_id,
            provider_kind: "cloudflare".to_owned(),
            resource_kind: "zone".to_owned(),
            resource_binding_digest,
            observation_digest,
            resource_label,
            binding_generation,
            validation_status: "verified".to_owned(),
            verified_at: committed_at.to_owned(),
            last_observed_at: observed_at,
            local_commit_sequence: u64::try_from(local_commit_sequence)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        })
    }

    pub(crate) fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    pub(crate) fn backup_connection_mut(&mut self) -> &mut Connection {
        self.store.fixture_connection()
    }

    #[cfg(all(test, unix))]
    pub(crate) fn clone_encrypted_to_file(
        &mut self,
        destination: &std::fs::File,
        destination_key: &LocalDatabaseKey,
    ) -> Result<(), BusinessDatabaseError> {
        self.store
            .clone_encrypted_to_file(destination, destination_key.custody_bytes())
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    #[cfg(test)]
    pub(crate) fn prepare_rebootstrap_publication(&mut self) -> Result<(), BusinessDatabaseError> {
        self.store
            .fixture_connection()
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        self.recovery_proof().map(|_| ())
    }

    /// Verifies the link from a Host publication record to this staged database's logical journal.
    ///
    /// # Errors
    ///
    /// Returns a closed storage error when the exact linked record is absent or unreadable.
    #[cfg(test)]
    pub fn verify_rebootstrap_journal_link(
        &self,
        link: &RebootstrapJournalLink,
    ) -> Result<(), BusinessDatabaseError> {
        verify_rebootstrap_journal_link_on_connection(
            self.store.raw_connection(),
            &self.workspace_id,
            link,
        )
    }

    #[cfg(all(test, unix))]
    pub(crate) fn active_rebootstrap_journal_link_snapshot_for_test(
        &self,
    ) -> Result<TestActiveRebootstrapJournalLinkSnapshot, BusinessDatabaseError> {
        active_rebootstrap_journal_link_snapshot_on_connection(
            self.store.raw_connection(),
            &self.workspace_id,
        )
    }

    #[cfg(all(test, unix))]
    pub(crate) fn apply_rebootstrap_journal_link_hostile_case_for_test(
        &mut self,
        hostile_case: TestRebootstrapJournalLinkHostileCase,
    ) -> Result<(), BusinessDatabaseError> {
        let workspace_id = self.workspace_id.clone();
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let publication_sequence: Option<i64> = transaction
            .query_row(
                "SELECT MAX(publication_sequence) FROM sync_rebootstrap_journal
                 WHERE workspace_id=?1",
                [&workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let publication_sequence =
            publication_sequence.ok_or(BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute_batch(
                "DROP TRIGGER sync_rebootstrap_journal_no_delete;
                 DROP TRIGGER sync_rebootstrap_journal_no_update;",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let affected = match hostile_case {
            TestRebootstrapJournalLinkHostileCase::RemoveActive => transaction.execute(
                "DELETE FROM sync_rebootstrap_journal
                 WHERE workspace_id=?1 AND publication_sequence=?2",
                params![workspace_id, publication_sequence],
            ),
            TestRebootstrapJournalLinkHostileCase::DuplicateActive => {
                transaction
                    .execute_batch(
                        "CREATE TABLE sync_rebootstrap_journal_hostile AS
                           SELECT * FROM sync_rebootstrap_journal;
                         DROP TABLE sync_rebootstrap_journal;
                         ALTER TABLE sync_rebootstrap_journal_hostile
                           RENAME TO sync_rebootstrap_journal;",
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                transaction.execute(
                    "INSERT INTO sync_rebootstrap_journal
                     SELECT * FROM sync_rebootstrap_journal
                     WHERE workspace_id=?1 AND publication_sequence=?2 LIMIT 1",
                    params![workspace_id, publication_sequence],
                )
            }
            TestRebootstrapJournalLinkHostileCase::MutateBindingDigest => transaction.execute(
                "UPDATE sync_rebootstrap_journal SET binding_digest=?3
                 WHERE workspace_id=?1 AND publication_sequence=?2",
                params![workspace_id, publication_sequence, "d".repeat(64)],
            ),
            TestRebootstrapJournalLinkHostileCase::MarkNonVerified => transaction.execute(
                "UPDATE sync_rebootstrap_journal SET state='prepared',failure_code=NULL
                 WHERE workspace_id=?1 AND publication_sequence=?2",
                params![workspace_id, publication_sequence],
            ),
        }
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if affected != 1 {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        transaction
            .execute_batch(
                "CREATE TRIGGER sync_rebootstrap_journal_no_delete
                 BEFORE DELETE ON sync_rebootstrap_journal BEGIN
                   SELECT RAISE(ABORT, 'rebootstrap journal cannot be deleted');
                 END;
                 CREATE TRIGGER sync_rebootstrap_journal_no_update
                 BEFORE UPDATE ON sync_rebootstrap_journal BEGIN
                   SELECT RAISE(ABORT, 'rebootstrap journal cannot be updated');
                 END;",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Opens the encrypted business database for one authorized workspace.
    ///
    /// # Errors
    ///
    /// Returns an error when the workspace identity is invalid or mismatched, or storage cannot be opened.
    pub fn open(
        path: &Path,
        key: &LocalDatabaseKey,
        workspace_id: &str,
    ) -> Result<Self, BusinessDatabaseError> {
        validate_identifier(workspace_id).map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        let active_key = ActiveWorkspaceKey(key.0);
        let mut store = ActiveWorkspaceConnection::create(path, &active_key)
            .map_err(map_portfolio_read_error)?;
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

    #[cfg(test)]
    pub(crate) fn open_existing_derived(
        path: &Path,
        key: &LocalDatabaseKey,
    ) -> Result<Self, BusinessDatabaseError> {
        let active_key = ActiveWorkspaceKey(key.0);
        let store = ActiveWorkspaceConnection::create(path, &active_key)
            .map_err(map_portfolio_read_error)?;
        let workspace_id: String = store
            .raw_connection()
            .query_row(
                "SELECT workspace_id FROM active_workspace_metadata WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        validate_identifier(&workspace_id).map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        Ok(Self {
            workspace_id,
            store,
        })
    }

    #[cfg(test)]
    pub(crate) fn read_portfolio(&self) -> Result<PortfolioReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_portfolio(&self.workspace_id)
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Reads one bounded, deterministic domain-library window from this database's workspace.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, query, or window error.
    pub fn read_asset_library(
        &self,
        start_index: u32,
        size: u16,
        query: &str,
    ) -> Result<AssetLibraryReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_asset_library(&self.workspace_id, start_index, size, query)
            .map_err(map_portfolio_read_error)
    }

    /// Reads one canonical domain detail from this database's workspace.
    ///
    /// # Errors
    ///
    /// Returns a closed storage, workspace, projection, or missing-asset error.
    pub fn read_domain_detail(
        &self,
        entity_id: &str,
    ) -> Result<DomainDetailReadSnapshot, BusinessDatabaseError> {
        self.store
            .read_domain_detail(&self.workspace_id, entity_id)
            .map_err(map_portfolio_read_error)
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
        clippy::too_many_lines,
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
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let existing: Option<ExistingMutationRow> = transaction.query_row(
            "SELECT entity_id,entity_kind,operation_kind,mutation_payload_sha256,local_commit_sequence,device_mutation_sequence,base_server_revision,created_at,source_device_id,active_lease_epoch,payload_schema_version FROM sync_outbox WHERE workspace_id=?1 AND mutation_id=?2",
            params![self.workspace_id, mutation_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?))).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
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
        )) = existing
        {
            let expected_op = if operation == "edit" {
                "upsert"
            } else {
                "delete"
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
                operation: operation.to_owned(),
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
            let mut guard = pre_commit_guard(true)?;
            transaction
                .commit()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            after_commit(&mut guard, true)?;
            return Ok(receipt);
        }
        if !allow_new {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let (current_version, deleted): (i64, Option<String>) = transaction.query_row("SELECT local_commit_sequence, deleted_at FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2", params![self.workspace_id, entity_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?.ok_or(BusinessDatabaseError::AssetNotFound)?;
        if deleted.is_some() {
            return Err(BusinessDatabaseError::AssetDeleted);
        }
        if u64::try_from(current_version).ok() != Some(expected_asset_version) {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let (local_seq, base_rev, device_seq): (i64, i64, i64) = transaction.query_row("UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1, next_device_mutation_sequence=next_device_mutation_sequence+1, updated_at=?1 WHERE singleton=1 RETURNING local_commit_sequence, applied_through_server_revision, next_device_mutation_sequence-1", [committed_at], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
        if operation == "edit" {
            let asset = edit.expect("edit operation carries asset");
            transaction.execute("UPDATE domain_assets SET updated_at=?3, local_commit_sequence=?4 WHERE workspace_id=?1 AND entity_id=?2", params![self.workspace_id, entity_id, committed_at, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute("UPDATE domain_asset_desired_state SET portfolio_id=?3,note=?4,target_price_currency=?5,target_price_amount=?6,local_commit_sequence=?7,updated_at=?8 WHERE workspace_id=?1 AND entity_id=?2", params![self.workspace_id, entity_id, asset.portfolio_id, asset.note, asset.target_price.as_ref().map(|m| &m.currency), asset.target_price.as_ref().map(|m| &m.amount), local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
                    params![self.workspace_id, entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for tag in &asset.tags {
                transaction.execute("INSERT INTO domain_asset_tags (workspace_id,entity_id,tag,local_commit_sequence) VALUES (?1,?2,?3,?4)", params![self.workspace_id, entity_id, tag, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            transaction.execute("UPDATE portfolio_domain_assets SET note=?3,portfolio_id=?4,tags_json=?5,target_price_currency=?6,target_price_amount=?7 WHERE workspace_id=?1 AND entity_id=?2", params![self.workspace_id, entity_id, asset.note, asset.portfolio_id, serde_json::to_string(&asset.tags).map_err(|_| BusinessDatabaseError::InvalidInput)?, asset.target_price.as_ref().map(|m| &m.currency), asset.target_price.as_ref().map(|m| &m.amount)]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for field_path in ["note", "portfolioId", "tags", "targetPrice"] {
                transaction.execute("INSERT INTO domain_asset_field_versions (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at) VALUES (?1,?2,?3,?4,?5,'pending',?6) ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET local_commit_sequence=excluded.local_commit_sequence,sync_state='pending',updated_at=excluded.updated_at", params![self.workspace_id, entity_id, field_path, base_rev, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
        } else {
            transaction.execute("UPDATE domain_assets SET lifecycle_status='archived',deleted_at=?3,updated_at=?3,local_commit_sequence=?4 WHERE workspace_id=?1 AND entity_id=?2", params![self.workspace_id, entity_id, committed_at, local_seq]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute("INSERT INTO domain_asset_field_versions (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,updated_at) VALUES (?1,?2,'lifecycleStatus',?3,?4,'pending',?5) ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET local_commit_sequence=excluded.local_commit_sequence,sync_state='pending',updated_at=excluded.updated_at", params![self.workspace_id, entity_id, base_rev, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute("INSERT INTO sync_tombstones (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,deleted_server_revision,deleted_at,purge_after,state,barrier_state) VALUES (?1,'domain_asset',?2,?3,NULL,?4,NULL,'pending','pending')", params![self.workspace_id, entity_id, local_seq, committed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        let lease_epoch =
            i64::try_from(active_lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let operation_kind = if operation == "edit" {
            "upsert"
        } else {
            "delete"
        };
        transaction.execute("INSERT INTO sync_outbox (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at,workspace_schema_version,operation_kind,base_server_revision,local_commit_sequence,source_device_id,active_lease_epoch,device_mutation_sequence,payload_schema_version,mutation_payload_sha256,state) VALUES (?1,?2,'domain_asset',?3,?4,?5,1,?6,?7,?8,?9,?10,?11,1,?12,'pending')", params![self.workspace_id, mutation_id, entity_id, payload, committed_at, operation_kind, base_rev, local_seq, device_id, lease_epoch, device_seq, digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if let Some(asset) = edit {
            let values = [
                ("note", serde_json::to_string(&asset.note)),
                ("portfolioId", serde_json::to_string(&asset.portfolio_id)),
                ("tags", serde_json::to_string(&asset.tags)),
                ("targetPrice", serde_json::to_string(&asset.target_price)),
            ];
            for (ordinal, (field, value)) in values.into_iter().enumerate() {
                let value = value.map_err(|_| BusinessDatabaseError::InvalidInput)?;
                transaction.execute("INSERT INTO sync_outbox_fields (workspace_id,mutation_id,ordinal,field_path,field_value_json,field_value_sha256) VALUES (?1,?2,?3,?4,?5,?6)", params![self.workspace_id, mutation_id, i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?, field, value, hex_digest(value.as_bytes())]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
        }
        let mut guard = pre_commit_guard(false)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        after_commit(&mut guard, false)?;
        Ok(DomainAssetMutationReceipt {
            schema_version: 1,
            disposition: "committed".to_owned(),
            operation: operation.to_owned(),
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

    /// Reads the non-secret committed credential identity required for Provider observation.
    ///
    /// # Errors
    ///
    /// Rejects inactive, unvalidated, incomplete, or malformed connection state.
    pub fn cloudflare_connection_observation_admission(
        &self,
        connection_id: &str,
    ) -> Result<CloudflareConnectionObservationAdmission, BusinessDatabaseError> {
        validate_local_text(connection_id)?;
        let admission = self
            .store
            .raw_connection()
            .query_row(
                "SELECT active_credential_generation,active_credential_scope_digest,
                        active_credential_zone_digest,active_credential_public_proof
                   FROM local_provider_connections
                  WHERE workspace_id=?1 AND connection_id=?2 AND provider_kind='cloudflare'
                    AND lifecycle_status='active' AND validation_status='valid'
                    AND json_array_length(capabilities_json)=1
                    AND json_extract(capabilities_json,'$[0]')='dns'",
                params![self.workspace_id, connection_id],
                |row| {
                    Ok(CloudflareConnectionObservationAdmission {
                        generation: u64::try_from(row.get::<_, i64>(0)?)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?,
                        scope_digest: row.get(1)?,
                        zone_digest: row.get(2)?,
                        public_proof: row.get(3)?,
                    })
                },
            )
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !(1..=9_007_199_254_740_991).contains(&admission.generation) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_sha256_hex(&admission.scope_digest)?;
        validate_sha256_hex(&admission.zone_digest)?;
        validate_sha256_hex(&admission.public_proof)?;
        Ok(admission)
    }

    /// Commits full local DNS evidence and its count-only Cloud projection in one transaction.
    /// Raw record values never enter the projection outbox.
    ///
    /// # Errors
    ///
    /// Rejects invalid evidence, stale lease epochs, exhausted sequences, or an atomic storage failure.
    #[allow(
        clippy::too_many_lines,
        reason = "the atomic observation/evidence/projection transaction keeps its fences contiguous"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded observation port remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn commit_cloudflare_dns_observation(
        &mut self,
        input: &CloudflareDnsObservationWrite,
    ) -> Result<PendingCloudflareDnsProjection, BusinessDatabaseError> {
        self.commit_cloudflare_dns_observation_guarded(input, || Ok(()))
    }

    /// # Errors
    ///
    /// Returns the same validation, authority, or storage errors as the unguarded operation.
    #[allow(clippy::too_many_lines)]
    pub fn commit_cloudflare_dns_observation_guarded(
        &mut self,
        input: &CloudflareDnsObservationWrite,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<PendingCloudflareDnsProjection, BusinessDatabaseError> {
        for value in [
            &input.observation_id,
            &input.observation_run_id,
            &input.entity_id,
            &input.connection_id,
            &input.zone_name_ascii,
            &input.provider_version_token,
        ] {
            validate_local_text(value)?;
        }
        validate_domain_asset_id(&input.entity_id)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !is_uuid_v4(&input.observation_id) || !is_uuid_v4(&input.observation_run_id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_timestamp(Some(input.observed_at.clone()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_sha256_hex(&input.credential_scope_digest)?;
        validate_sha256_hex(&input.credential_zone_digest)?;
        validate_sha256_hex(&input.credential_public_proof)?;
        let epoch =
            i64::try_from(input.lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if epoch < 1
            || input.records.len() > 1_024
            || !(1..=9_007_199_254_740_991).contains(&input.credential_generation)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        if input.authoritative_nameservers.len() > 32
            || input
                .authoritative_nameservers
                .iter()
                .any(|v| v.is_empty() || v.len() > 253)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut counts = serde_json::Map::from_iter([
            ("a".to_owned(), serde_json::Value::from(0)),
            ("aaaa".to_owned(), serde_json::Value::from(0)),
            ("cname".to_owned(), serde_json::Value::from(0)),
            ("txt".to_owned(), serde_json::Value::from(0)),
            ("proxied".to_owned(), serde_json::Value::from(0)),
        ]);
        for record in &input.records {
            validate_local_text(&record.record_key)?;
            validate_local_text(&record.record_type)?;
            validate_local_text(&record.owner_name_ascii)?;
            validate_local_text(&record.canonical_value)?;
            let key = record.record_type.to_ascii_lowercase();
            let value = counts
                .get_mut(&key)
                .ok_or(BusinessDatabaseError::InvalidInput)?;
            *value = serde_json::Value::from(value.as_u64().unwrap_or(0) + 1);
            if record.proxied == Some(true) {
                if !matches!(key.as_str(), "a" | "aaaa" | "cname") {
                    return Err(BusinessDatabaseError::InvalidInput);
                }
                let value = counts
                    .get_mut("proxied")
                    .ok_or(BusinessDatabaseError::StorageRejected)?;
                *value = serde_json::Value::from(value.as_u64().unwrap_or(0) + 1);
            }
        }
        let counts = if input.availability == "unavailable" {
            if input.zone_status != "unknown" || !input.records.is_empty() {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            serde_json::json!({ "a": null, "aaaa": null, "cname": null, "txt": null, "proxied": null })
        } else if input.availability == "available"
            && matches!(input.zone_status.as_str(), "active" | "pending")
        {
            serde_json::Value::Object(counts)
        } else {
            return Err(BusinessDatabaseError::InvalidInput);
        };
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let connection_ready: i64 = transaction.query_row("SELECT count(*) FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2 AND provider_kind='cloudflare' AND lifecycle_status='active' AND validation_status='valid' AND credential_use_state='active' AND active_credential_generation=?3 AND active_credential_scope_digest=?4 AND active_credential_zone_digest=?5 AND active_credential_public_proof=?6 AND json_array_length(capabilities_json)=1 AND json_extract(capabilities_json,'$[0]')='dns'", params![self.workspace_id,input.connection_id,i64::try_from(input.credential_generation).map_err(|_| BusinessDatabaseError::InvalidInput)?,input.credential_scope_digest,input.credential_zone_digest,input.credential_public_proof], |row| row.get(0)).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if connection_ready != 1 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        transaction.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES (?1,?2,?3,'dns',?4,'running')", params![self.workspace_id,input.observation_run_id,input.connection_id,input.observed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES (?1,?2,?3,0,'requested',?4)", params![self.workspace_id,input.observation_run_id,input.entity_id,input.observed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let prior: Option<(i64, i64)> = transaction.query_row("SELECT lease_epoch, source_sequence FROM cloudflare_dns_source_heads WHERE workspace_id=?1 AND entity_id=?2", params![self.workspace_id, input.entity_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let source = prior.map_or(1, |(prior_epoch, prior_source)| {
            match epoch.cmp(&prior_epoch) {
                std::cmp::Ordering::Greater => 1,
                std::cmp::Ordering::Equal => prior_source.saturating_add(1),
                std::cmp::Ordering::Less => 0,
            }
        });
        if !(1..=9_007_199_254_740_991).contains(&source) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let projection = serde_json::json!({
            "schemaVersion": 1,
            "providerKind": "cloudflare",
            "observationCapability": "dns",
            "observationId": input.observation_id,
            "entityId": input.entity_id,
            "leaseEpoch": input.lease_epoch,
            "sourceSequence": source,
            "observedAt": input.observed_at,
            "availability": input.availability,
            "zoneStatus": input.zone_status,
            "counts": counts,
        });
        let projection_json =
            serde_json::to_string(&projection).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if projection_json.len() > 65_536 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        transaction.execute(
            "INSERT INTO dns_zone_observations (workspace_id,zone_observation_id,observation_run_id,entity_id,zone_name_ascii,authoritative_nameservers_json,dnssec_status,observation_availability,evidence_status,observed_at,provider_version_token,normalized_evidence_sha256,cloudflare_zone_status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'confirmed',?9,?10,NULL,?11)",
            params![self.workspace_id,input.observation_id,input.observation_run_id,input.entity_id,input.zone_name_ascii,serde_json::to_string(&input.authoritative_nameservers).map_err(|_| BusinessDatabaseError::InvalidInput)?,input.dnssec_status,input.availability,input.observed_at,input.provider_version_token,input.zone_status],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for record in &input.records {
            transaction.execute("INSERT INTO dns_record_observations (workspace_id,zone_observation_id,record_key,record_type,owner_name_ascii,ttl_seconds,priority,canonical_value,proxied) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![self.workspace_id,input.observation_id,record.record_key,record.record_type,record.owner_name_ascii,record.ttl_seconds.map(i64::from),record.priority.map(i64::from),record.canonical_value,record.proxied.map(i64::from)]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3 AND entity_id=?4 AND status='requested'", params![input.observed_at,self.workspace_id,input.observation_run_id,input.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3 AND status='running'", params![input.observed_at,self.workspace_id,input.observation_run_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO cloudflare_dns_source_heads (workspace_id,entity_id,lease_epoch,source_sequence,updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET lease_epoch=excluded.lease_epoch,source_sequence=excluded.source_sequence,updated_at=excluded.updated_at", params![self.workspace_id,input.entity_id,epoch,source,input.observed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let digest = canonical_cloudflare_projection_digest(&projection)?;
        transaction.execute("INSERT INTO cloudflare_dns_projection_outbox (workspace_id,observation_id,entity_id,lease_epoch,source_sequence,observed_at,projection_json,canonical_request_digest,state) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending')", params![self.workspace_id,input.observation_id,input.entity_id,epoch,source,input.observed_at,projection_json,digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO cloudflare_dns_projection_heads (workspace_id,entity_id,lease_epoch,source_sequence,observation_id,observed_at,projection_digest,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?6) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET lease_epoch=excluded.lease_epoch,source_sequence=excluded.source_sequence,observation_id=excluded.observation_id,observed_at=excluded.observed_at,projection_digest=excluded.projection_digest,updated_at=excluded.updated_at", params![self.workspace_id,input.entity_id,epoch,source,input.observation_id,input.observed_at,digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(PendingCloudflareDnsProjection {
            observation_id: input.observation_id.clone(),
            entity_id: input.entity_id.clone(),
            lease_epoch: input.lease_epoch,
            source_sequence: u64::try_from(source)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            observed_at: input.observed_at.clone(),
            projection_json,
            canonical_request_digest: digest,
        })
    }

    /// Reads a bounded pending projection page without changing delivery ownership.
    ///
    /// # Errors
    ///
    /// Rejects an invalid limit or unreadable/tampered storage.
    pub fn pending_cloudflare_dns_projections(
        &self,
        limit: usize,
    ) -> Result<Vec<PendingCloudflareDnsProjection>, BusinessDatabaseError> {
        if !(1..=256).contains(&limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut statement = self.store.raw_connection().prepare("SELECT observation_id,entity_id,lease_epoch,source_sequence,observed_at,projection_json,canonical_request_digest FROM cloudflare_dns_projection_outbox WHERE workspace_id=?1 AND state='pending' ORDER BY observed_at,observation_id LIMIT ?2").map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map(
                params![
                    self.workspace_id,
                    i64::try_from(limit).map_err(|_| BusinessDatabaseError::InvalidInput)?
                ],
                |row| {
                    Ok(PendingCloudflareDnsProjection {
                        observation_id: row.get(0)?,
                        entity_id: row.get(1)?,
                        lease_epoch: u64::try_from(row.get::<_, i64>(2)?)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?,
                        source_sequence: u64::try_from(row.get::<_, i64>(3)?)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?,
                        observed_at: row.get(4)?,
                        projection_json: row.get(5)?,
                        canonical_request_digest: row.get(6)?,
                    })
                },
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn next_cloudflare_projection_attempt_unix_seconds(
        &self,
        now_unix_seconds: i64,
    ) -> Result<Option<i64>, BusinessDatabaseError> {
        self.store
            .raw_connection()
            .query_row(
                "SELECT CASE
                    WHEN state='pending' THEN COALESCE(unixepoch(next_attempt_at), ?2)
                    WHEN state='sending' THEN unixepoch(delivery_lease_expires_at)
                    ELSE NULL
                 END
                 FROM cloudflare_dns_projection_outbox
                 WHERE workspace_id=?1 AND state IN ('pending','sending')
                 ORDER BY lease_epoch,source_sequence
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

    /// Claims count-only projections using a durable lease and monotonically increasing fence.
    ///
    /// # Errors
    ///
    /// Rejects invalid lease inputs, digest corruption, sequence exhaustion, or a failed claim CAS.
    pub fn claim_cloudflare_dns_projections_guarded(
        &mut self,
        delivery_owner: &str,
        now: &str,
        lease_expires_at: &str,
        limit: usize,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<Vec<ClaimedCloudflareDnsProjection>, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(now.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(lease_expires_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if now >= lease_expires_at || !(1..=256).contains(&limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let candidates = {
            let mut statement = transaction.prepare("SELECT observation_id,entity_id,lease_epoch,source_sequence,observed_at,projection_json,canonical_request_digest,delivery_attempt_fence,state,next_attempt_at,delivery_lease_expires_at FROM cloudflare_dns_projection_outbox WHERE workspace_id=?1 AND state IN ('pending','sending') ORDER BY lease_epoch,source_sequence LIMIT ?4").map_err(|_| BusinessDatabaseError::StorageRejected)?;
            statement
                .query_map(
                    params![
                        self.workspace_id,
                        now,
                        delivery_owner,
                        i64::try_from(limit).map_err(|_| BusinessDatabaseError::InvalidInput)?
                    ],
                    |row| {
                        Ok((
                            PendingCloudflareDnsProjection {
                                observation_id: row.get(0)?,
                                entity_id: row.get(1)?,
                                lease_epoch: u64::try_from(row.get::<_, i64>(2)?)
                                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                                source_sequence: u64::try_from(row.get::<_, i64>(3)?)
                                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                                observed_at: row.get(4)?,
                                projection_json: row.get(5)?,
                                canonical_request_digest: row.get(6)?,
                            },
                            row.get::<_, i64>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, Option<String>>(9)?,
                            row.get::<_, Option<String>>(10)?,
                        ))
                    },
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
        };
        let mut claimed = Vec::with_capacity(candidates.len());
        for (projection, prior_fence, state, next_attempt_at, delivery_lease_expires_at) in
            candidates
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
            let parsed: serde_json::Value = serde_json::from_str(&projection.projection_json)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if canonical_cloudflare_projection_digest(&parsed)?
                != projection.canonical_request_digest
            {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            let fence = prior_fence
                .checked_add(1)
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or(BusinessDatabaseError::SequenceExhausted)?;
            let changed = transaction.execute("UPDATE cloudflare_dns_projection_outbox SET state='sending',delivery_owner=?1,delivery_lease_expires_at=?2,delivery_attempt_fence=?3,next_attempt_at=NULL,last_error_code=NULL WHERE workspace_id=?4 AND observation_id=?5 AND (state='pending' OR (state='sending' AND delivery_lease_expires_at<=?6))", params![delivery_owner,lease_expires_at,fence,self.workspace_id,projection.observation_id,now]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if changed != 1 {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            claimed.push(ClaimedCloudflareDnsProjection {
                projection,
                delivery_attempt_fence: u64::try_from(fence)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            });
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(claimed)
    }

    /// Returns one exact claimed projection to pending and reports its durable retry deadline.
    pub(crate) fn defer_cloudflare_dns_projection_guarded(
        &mut self,
        delivery_owner: &str,
        projection: &ClaimedCloudflareDnsProjection,
        now: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<i64, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(now.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let fence = i64::try_from(projection.delivery_attempt_fence)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let delay_seconds = 1_i64
            .checked_shl(
                u32::try_from(fence.clamp(0, 9))
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            )
            .unwrap_or(256)
            .min(300);
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let changed = transaction
            .execute(
                "UPDATE cloudflare_dns_projection_outbox
             SET state='pending',delivery_owner=NULL,delivery_lease_expires_at=NULL,
                 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%SZ',datetime(?1,?2)),
                 last_error_code='transport_retryable'
             WHERE workspace_id=?3 AND observation_id=?4 AND state='sending'
               AND delivery_owner=?5 AND delivery_attempt_fence=?6
               AND lease_epoch=?7 AND source_sequence=?8 AND canonical_request_digest=?9",
                params![
                    now,
                    format!("+{delay_seconds} seconds"),
                    self.workspace_id,
                    projection.projection.observation_id,
                    delivery_owner,
                    fence,
                    i64::try_from(projection.projection.lease_epoch)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    i64::try_from(projection.projection.source_sequence)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    projection.projection.canonical_request_digest,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let deadline = transaction
            .query_row(
                "SELECT unixepoch(next_attempt_at) FROM cloudflare_dns_projection_outbox
             WHERE workspace_id=?1 AND observation_id=?2",
                params![self.workspace_id, projection.projection.observation_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(deadline)
    }

    /// Applies one exact projection ACK. Exact replay is idempotent; every mismatch fails closed.
    ///
    /// # Errors
    ///
    /// Rejects malformed or mismatched ACK identity, stale ownership, or storage failure.
    pub fn acknowledge_cloudflare_dns_projection_guarded(
        &mut self,
        delivery_owner: &str,
        acknowledgement: &CloudflareDnsProjectionAcknowledgement,
        acknowledged_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_local_text(&acknowledgement.observation_id)?;
        validate_sha256_hex(&acknowledgement.canonical_request_digest)?;
        validate_timestamp(Some(acknowledged_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !matches!(acknowledgement.disposition.as_str(), "current" | "stale") {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let values = [
            acknowledgement.lease_epoch,
            acknowledgement.source_sequence,
            acknowledgement.delivery_attempt_fence,
            acknowledgement.observation_sequence,
        ];
        if values
            .iter()
            .any(|value| !(1..=9_007_199_254_740_991).contains(value))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let changed = transaction.execute("UPDATE cloudflare_dns_projection_outbox SET state='acknowledged',observation_sequence=?1,disposition=?2,acknowledged_at=?3,delivery_owner=NULL,delivery_lease_expires_at=NULL,next_attempt_at=NULL,last_error_code=NULL WHERE workspace_id=?4 AND observation_id=?5 AND state='sending' AND delivery_owner=?6 AND delivery_attempt_fence=?7 AND lease_epoch=?8 AND source_sequence=?9 AND canonical_request_digest=?10", params![i64::try_from(acknowledgement.observation_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.disposition,acknowledged_at,self.workspace_id,acknowledgement.observation_id,delivery_owner,i64::try_from(acknowledgement.delivery_attempt_fence).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.source_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.canonical_request_digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            let exact: i64 = transaction.query_row("SELECT count(*) FROM cloudflare_dns_projection_outbox WHERE workspace_id=?1 AND observation_id=?2 AND state='acknowledged' AND lease_epoch=?3 AND source_sequence=?4 AND delivery_attempt_fence=?5 AND canonical_request_digest=?6 AND observation_sequence=?7 AND disposition=?8", params![self.workspace_id,acknowledgement.observation_id,i64::try_from(acknowledgement.lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.source_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.delivery_attempt_fence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.canonical_request_digest,i64::try_from(acknowledgement.observation_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.disposition], |row| row.get(0)).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if exact != 1 {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
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

    /// Installs a verified complete checkpoint into replica-owned rows of a staged clone.
    /// Pending/conflicted local fields and all outbox/inbox/conflict/tombstone evidence remain intact.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed, unordered, oversized input or storage rejection.
    #[allow(
        clippy::too_many_lines,
        reason = "checkpoint replacement keeps root, projection, field, and reader updates atomic"
    )]
    #[cfg(test)]
    pub fn install_rebootstrap_checkpoint(
        &mut self,
        snapshot: &[DomainAssetWrite],
        checkpoint_revision: u64,
        device_id: &str,
        make_journal: impl FnOnce(
            &DatabaseRecoveryProof,
        ) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
    ) -> Result<(DatabaseRecoveryProof, RebootstrapJournalLink), BusinessDatabaseError> {
        self.install_rebootstrap_checkpoint_guarded(
            snapshot,
            checkpoint_revision,
            device_id,
            make_journal,
            || Ok(()),
        )
    }

    /// Installs a checkpoint and, when supplied, its opaque SQL journal link in one transaction.
    /// The Host fence runs immediately before commit; a failed fence or journal insert rolls back
    /// every root, field, cursor and journal write.
    ///
    /// # Errors
    ///
    /// Returns a closed validation, storage, revision, conflict, or Host fence error.
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg(test)]
    pub fn install_rebootstrap_checkpoint_guarded(
        &mut self,
        snapshot: &[DomainAssetWrite],
        checkpoint_revision: u64,
        device_id: &str,
        make_journal: impl FnOnce(
            &DatabaseRecoveryProof,
        ) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(DatabaseRecoveryProof, RebootstrapJournalLink), BusinessDatabaseError> {
        let revision =
            i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let admission_floor =
            checkpoint_admission_floor(self.store.raw_connection(), &self.workspace_id)?;
        admission_floor.admit(revision)?;
        self.store
            .fixture_connection()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let result = self.install_rebootstrap_checkpoint_savepoint(
            snapshot,
            checkpoint_revision,
            device_id,
            Some(make_journal),
            commit_fence,
            admission_floor,
        );
        match result {
            Ok((proof, Some(link))) => {
                self.store
                    .fixture_connection()
                    .execute_batch("COMMIT")
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                Ok((proof, link))
            }
            Ok(_) => {
                let _ = self.store.fixture_connection().execute_batch("ROLLBACK");
                Err(BusinessDatabaseError::StorageRejected)
            }
            Err(error) => {
                let _ = self.store.fixture_connection().execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Atomically installs a checkpoint, applies every replay page, derives the final recovery
    /// proof, appends its exact logical-journal link, and performs the Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns a closed validation, storage, revision, conflict, or Host fence error. Any error
    /// rolls back the whole plan, including its logical journal row.
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg(test)]
    pub fn install_rebootstrap_plan_guarded(
        &mut self,
        snapshot: &[DomainAssetWrite],
        checkpoint_revision: u64,
        device_id: &str,
        replay_pages: &[RebootstrapReplayPage],
        make_journal: impl FnOnce(
            &DatabaseRecoveryProof,
        ) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(DatabaseRecoveryProof, RebootstrapJournalLink), BusinessDatabaseError> {
        if replay_pages.len() > 4_096
            || replay_pages
                .iter()
                .try_fold(0_usize, |total, page| {
                    total.checked_add(page.page_json.len() + page.confirmation_token.len())
                })
                .is_none_or(|total| total > 64 * 1_048_576)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let revision =
            i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let admission_floor =
            checkpoint_admission_floor(self.store.raw_connection(), &self.workspace_id)?;
        admission_floor.admit(revision)?;
        self.store
            .fixture_connection()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let result = (|| {
            let _ = self.install_rebootstrap_checkpoint_savepoint(
                snapshot,
                checkpoint_revision,
                device_id,
                None::<
                    fn(
                        &DatabaseRecoveryProof,
                    )
                        -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
                >,
                || Ok(()),
                admission_floor,
            )?;
            for page in replay_pages {
                self.apply_sync_page_v2_savepoint(
                    device_id,
                    &page.page_json,
                    &page.confirmation_token,
                    |_| Ok(()),
                )?;
            }
            let proof = self.recovery_proof()?;
            let link = make_journal(&proof)?;
            validate_rebootstrap_journal_link(&link)?;
            let publication_sequence = i64::try_from(link.publication_sequence)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            self.store.fixture_connection().execute(
                "INSERT INTO sync_rebootstrap_journal
                 (workspace_id,journal_id,slot_id,publication_sequence,manifest_digest,
                  authority_digest,floor_digest,binding_digest,state,failure_code,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'verified',NULL,
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
                params![self.workspace_id,link.journal_id,link.slot_id.as_str(),publication_sequence,
                    link.manifest_digest,link.authority_digest,link.floor_digest,link.binding_digest],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            verify_rebootstrap_final_head(
                self.store.fixture_connection(),
                &self.workspace_id,
                device_id,
                revision,
                admission_floor,
            )?;
            commit_fence()?;
            Ok((proof, link))
        })();
        match result {
            Ok(value) => {
                self.store
                    .fixture_connection()
                    .execute_batch("COMMIT")
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.store.fixture_connection().execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg(test)]
    fn install_rebootstrap_checkpoint_savepoint<F, G>(
        &mut self,
        snapshot: &[DomainAssetWrite],
        checkpoint_revision: u64,
        device_id: &str,
        make_journal: Option<F>,
        commit_fence: G,
        admission_floor: CheckpointAdmissionFloor,
    ) -> Result<(DatabaseRecoveryProof, Option<RebootstrapJournalLink>), BusinessDatabaseError>
    where
        F: FnOnce(&DatabaseRecoveryProof) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
        G: FnOnce() -> Result<(), BusinessDatabaseError>,
    {
        if snapshot.len() > 10_000 || checkpoint_revision > 9_007_199_254_740_991 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        for (index, asset) in snapshot.iter().enumerate() {
            validate_domain_asset(asset)?;
            if index > 0 && snapshot[index - 1].entity_id.as_bytes() >= asset.entity_id.as_bytes() {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        let revision =
            i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .savepoint()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        admission_floor.admit(revision)?;
        let transaction_floor = checkpoint_admission_floor(&transaction, &self.workspace_id)?;
        transaction_floor.admit(revision)?;
        let local_commit_sequence: i64 = transaction
            .query_row(
                "SELECT MAX(local_commit_sequence, 1) FROM active_workspace_metadata WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS temp_checkpoint_entities(entity_id TEXT PRIMARY KEY) WITHOUT ROWID;
                 DELETE FROM temp_checkpoint_entities;",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for asset in snapshot {
            transaction
                .execute(
                    "INSERT INTO temp_checkpoint_entities(entity_id) VALUES (?1)",
                    [&asset.entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let root_exists: i64 = transaction
                .query_row(
                    "SELECT count(*) FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                    params![self.workspace_id, asset.entity_id],
                    |row| row.get(0),
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if root_exists != 0 {
                merge_checkpoint_existing_asset(
                    &transaction,
                    &self.workspace_id,
                    asset,
                    checkpoint_revision,
                )?;
                continue;
            }
            let tags_json = serde_json::to_string(&asset.tags)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction
                .execute(
                    "INSERT INTO domain_assets
                     (workspace_id,entity_id,lifecycle_status,created_at,updated_at,deleted_at,local_commit_sequence)
                     VALUES (?1,?2,'active',strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                             strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL,?3)
                     ON CONFLICT(workspace_id,entity_id) DO NOTHING",
                    params![self.workspace_id, asset.entity_id, local_commit_sequence],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "INSERT INTO domain_asset_desired_state
                     (workspace_id,entity_id,portfolio_id,note,target_price_currency,
                      target_price_amount,desired_sale_status,desired_nameservers_json,
                      local_commit_sequence,updated_at)
                     VALUES (?1,?2,NULL,?3,?4,?5,'hold','[]',?6,
                             strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                     ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
                       note=excluded.note,target_price_currency=excluded.target_price_currency,
                       target_price_amount=excluded.target_price_amount,
                       updated_at=excluded.updated_at",
                    params![
                        self.workspace_id,
                        asset.entity_id,
                        asset.note,
                        asset.target_price.as_ref().map(|money| &money.currency),
                        asset.target_price.as_ref().map(|money| &money.amount),
                        local_commit_sequence,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
                    params![self.workspace_id, asset.entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for tag in &asset.tags {
                transaction
                    .execute(
                        "INSERT INTO domain_asset_tags
                         (workspace_id,entity_id,tag,local_commit_sequence) VALUES (?1,?2,?3,?4)",
                        params![
                            self.workspace_id,
                            asset.entity_id,
                            tag,
                            local_commit_sequence
                        ],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            transaction.execute(
                "INSERT INTO portfolio_domain_assets
                 (workspace_id,entity_id,note,portfolio_id,tags_json,target_price_currency,
                  target_price_amount,note_server_revision,portfolio_id_server_revision,
                  tags_server_revision,target_price_server_revision)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?8,?8)
                 ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
                  note=excluded.note,portfolio_id=excluded.portfolio_id,tags_json=excluded.tags_json,
                  target_price_currency=excluded.target_price_currency,target_price_amount=excluded.target_price_amount,
                  note_server_revision=excluded.note_server_revision,
                  portfolio_id_server_revision=excluded.portfolio_id_server_revision,
                  tags_server_revision=excluded.tags_server_revision,
                  target_price_server_revision=excluded.target_price_server_revision",
                params![self.workspace_id, asset.entity_id, asset.note, asset.portfolio_id, tags_json,
                    asset.target_price.as_ref().map(|money| &money.currency),
                    asset.target_price.as_ref().map(|money| &money.amount), revision],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for field in ["note", "portfolioId", "tags", "targetPrice"] {
                transaction.execute(
                    "INSERT INTO domain_asset_field_versions
                     (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,provenance,freshness,updated_at)
                     VALUES (?1,?2,?3,?4,0,'clean','replicated','confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                     ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET
                      server_revision=excluded.server_revision,sync_state='clean',provenance='replicated',freshness='confirmed',updated_at=excluded.updated_at
                      WHERE domain_asset_field_versions.sync_state='clean'",
                    params![self.workspace_id, asset.entity_id, field, revision],
                ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            transaction.execute(
                "INSERT INTO sync_asset_provenance(workspace_id,entity_id,root_provenance,replicated_server_revision,freshness,updated_at)
                 VALUES (?1,?2,'replicated',?3,'confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                 ON CONFLICT(workspace_id,entity_id) DO UPDATE SET root_provenance='replicated',replicated_server_revision=excluded.replicated_server_revision,freshness='confirmed',updated_at=excluded.updated_at",
                params![self.workspace_id, asset.entity_id, revision],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction.execute(
            "UPDATE sync_asset_provenance SET freshness='stale', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND root_provenance='replicated' AND entity_id NOT IN
             (SELECT entity_id FROM temp_checkpoint_entities)",
            [&self.workspace_id],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute(
            "UPDATE domain_asset_field_versions SET freshness='stale', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND provenance='replicated' AND sync_state='clean' AND entity_id NOT IN
             (SELECT entity_id FROM temp_checkpoint_entities)",
            [&self.workspace_id],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute_batch("DROP TABLE temp_checkpoint_entities;")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "UPDATE active_workspace_metadata SET applied_through_server_revision=?1,
             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE singleton=1",
                [revision],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO sync_reader_state
                 (workspace_id,device_id,cursor_generation,read_through_server_revision,
                  pinned_target_server_revision,continuation_token,checkpoint_id,
                  checkpoint_through_server_revision,status,updated_at,confirmation_token,
                  last_page_digest,anti_rollback_server_revision_floor,
                  anti_rollback_schema_version_floor,row_version)
                 VALUES (?2,?3,1,?1,?1,NULL,NULL,NULL,'active',
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL,NULL,?1,2,1)
                 ON CONFLICT(workspace_id,device_id) DO UPDATE SET
                   read_through_server_revision=?1,status='active',
                   pinned_target_server_revision=?1,continuation_token=NULL,
                   confirmation_token=NULL,last_page_digest=NULL,
                   anti_rollback_server_revision_floor=MAX(anti_rollback_server_revision_floor,?1),
                   row_version=row_version+1,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')",
                params![revision, self.workspace_id, device_id],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let proof = recovery_proof_from_connection(&transaction)?;
        let link = if let Some(make_journal) = make_journal {
            let link = make_journal(&proof)?;
            validate_rebootstrap_journal_link(&link)?;
            let publication_sequence = i64::try_from(link.publication_sequence)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction.execute(
                "INSERT INTO sync_rebootstrap_journal
                 (workspace_id,journal_id,slot_id,publication_sequence,manifest_digest,
                  authority_digest,floor_digest,binding_digest,state,failure_code,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'verified',NULL,
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
                params![self.workspace_id, link.journal_id, link.slot_id.as_str(), publication_sequence,
                    link.manifest_digest, link.authority_digest, link.floor_digest, link.binding_digest],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            Some(link)
        } else {
            None
        };
        verify_rebootstrap_final_head(
            &transaction,
            &self.workspace_id,
            device_id,
            revision,
            transaction_floor,
        )?;
        commit_fence()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok((proof, link))
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
    fn apply_sync_page_v2_savepoint(
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
        if page.schema_version != 2
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
            if mutation.schema_version != 2
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
            let wire_digest = canonical_mutation_digest(mutation)?;
            let payload_digest = hex_digest(mutation_json.as_bytes());
            let existing: Option<(String, Option<String>, String)> = transaction
                .query_row(
                    "SELECT mutation_id, wire_mutation_digest, state FROM sync_inbox
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
            if let Some((existing_id, existing_digest, _)) = existing {
                if existing_id != mutation.mutation_id
                    || existing_digest.as_deref() != Some(&wire_digest)
                {
                    return Err(BusinessDatabaseError::MutationConflict);
                }
                continue;
            }
            let conflicted =
                apply_sync_mutation_projection(&transaction, &self.workspace_id, mutation)?;
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
                             2,?12)",
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
            schema_version: 2,
            after_server_revision: u64::try_from(revision)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            cursor,
            confirm,
            page_limit,
        })
    }

    /// Stops pull materialization after Cloud reports that this reader is behind compaction.
    /// Existing local business data and pending outbox rows are retained for P0-04 recovery.
    ///
    /// # Errors
    ///
    /// Returns a closed input or storage error.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded rebootstrap marker remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn mark_sync_rebootstrap_required_v2(
        &mut self,
        device_id: &str,
    ) -> Result<(), BusinessDatabaseError> {
        self.mark_sync_rebootstrap_required_v2_guarded(device_id, |_| Ok(()))
            .map(|_| ())
    }

    /// Marks the reader as requiring rebootstrap with a final authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed input, authority-fence, or storage error.
    pub fn mark_sync_rebootstrap_required_v2_guarded(
        &mut self,
        device_id: &str,
        pre_commit_guard: impl FnOnce(SyncProjectionEffect) -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncProjectionEffect, BusinessDatabaseError> {
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let revision = i64::try_from(self.current_server_revision()?)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let already_required: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_reader_state
                 WHERE workspace_id=?1 AND device_id=?2 AND status='rebootstrap_required')",
                params![self.workspace_id, device_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value == 1)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO sync_reader_state
                 (workspace_id,device_id,cursor_generation,read_through_server_revision,
                  pinned_target_server_revision,continuation_token,status,updated_at,
                  confirmation_token,last_page_digest,anti_rollback_server_revision_floor,
                  anti_rollback_schema_version_floor,row_version)
                 VALUES (?1,?2,1,?3,NULL,NULL,'rebootstrap_required',
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL,NULL,?3,2,1)
                 ON CONFLICT(workspace_id,device_id) DO UPDATE SET
                   status='rebootstrap_required',continuation_token=NULL,confirmation_token=NULL,
                   anti_rollback_server_revision_floor=MAX(sync_reader_state.anti_rollback_server_revision_floor,excluded.anti_rollback_server_revision_floor),
                   row_version=sync_reader_state.row_version+1,updated_at=excluded.updated_at",
                params![self.workspace_id, device_id, revision],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO native_cloud_checkpoint_state(workspace_id,checkpoint_due)
                 VALUES (?1,1)
                 ON CONFLICT(workspace_id) DO UPDATE SET checkpoint_due=1",
                [self.workspace_id.as_str()],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let effect = if already_required {
            SyncProjectionEffect::Unchanged
        } else {
            SyncProjectionEffect::VisibleStateChanged
        };
        pre_commit_guard(effect)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(effect)
    }

    /// Returns the Host-durable checkpoint demand bit. It is initialized due for every active
    /// workspace and remains due across restart until a strictly parsed response is committed.
    pub fn native_checkpoint_due(&self) -> Result<bool, BusinessDatabaseError> {
        self.store.raw_connection().query_row(
            "SELECT COALESCE((SELECT checkpoint_due FROM native_cloud_checkpoint_state WHERE workspace_id=?1),1)",
            [self.workspace_id.as_str()],
            |row| row.get::<_, i64>(0),
        ).map(|value| value == 1).map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Commits a valid checkpoint response and clears the durable due bit in one guarded
    /// transaction. `None` records a successful null response without inventing a descriptor.
    pub fn complete_native_checkpoint_guarded(
        &mut self,
        descriptor: Option<&NativeCheckpointDescriptor>,
        checked_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_timestamp(Some(checked_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if let Some(descriptor) = descriptor {
            if descriptor.schema_version != 2
                || descriptor.workspace_id != self.workspace_id
                || descriptor.workspace_schema_version == 0
                || descriptor.workspace_schema_version > 9_007_199_254_740_991
                || descriptor.through_server_revision > 9_007_199_254_740_991
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            validate_local_text(&descriptor.checkpoint_id)?;
            if descriptor.checkpoint_digest.len() != 43
                || !descriptor
                    .checkpoint_digest
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let changed = if let Some(descriptor) = descriptor {
            transaction.execute(
                "INSERT INTO native_cloud_checkpoint_state
                    (workspace_id,checkpoint_due,checkpoint_id,checkpoint_schema_version,
                     through_server_revision,workspace_schema_version,checkpoint_digest,checked_at)
                 VALUES (?7,0,?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    checkpoint_due=0,checkpoint_id=excluded.checkpoint_id,
                    checkpoint_schema_version=excluded.checkpoint_schema_version,
                    through_server_revision=excluded.through_server_revision,
                    workspace_schema_version=excluded.workspace_schema_version,
                    checkpoint_digest=excluded.checkpoint_digest,checked_at=excluded.checked_at
                 WHERE native_cloud_checkpoint_state.checkpoint_due=1",
                params![
                    descriptor.checkpoint_id,
                    i64::try_from(descriptor.schema_version)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    i64::try_from(descriptor.through_server_revision)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    i64::try_from(descriptor.workspace_schema_version)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    descriptor.checkpoint_digest,
                    checked_at,
                    self.workspace_id,
                ],
            )
        } else {
            transaction.execute(
                "INSERT INTO native_cloud_checkpoint_state(workspace_id,checkpoint_due,checked_at)
                 VALUES (?2,0,?1)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    checkpoint_due=0,checkpoint_id=NULL,checkpoint_schema_version=NULL,
                    through_server_revision=NULL,workspace_schema_version=NULL,
                    checkpoint_digest=NULL,checked_at=excluded.checked_at
                 WHERE native_cloud_checkpoint_state.checkpoint_due=1",
                params![checked_at, self.workspace_id],
            )
        }
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

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
        let reader_not_caught_up: i64 = transaction.query_row(
            "SELECT count(*) FROM sync_reader_state WHERE workspace_id=?1 AND (pinned_target_server_revision IS NOT NULL AND read_through_server_revision < pinned_target_server_revision)",
            [&self.workspace_id], |row| row.get(0)
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let involved_outcome_unknown: i64 = transaction.query_row(
            "SELECT count(*) FROM sync_outbox WHERE workspace_id=?1 AND entity_id=?2 AND state='sending'",
            params![self.workspace_id, entity_id], |row| row.get(0)
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if reader_not_caught_up != 0 || involved_outcome_unknown != 0 {
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
                "INSERT INTO sync_outbox (workspace_id,mutation_id,entity_kind,entity_id,mutation_payload_json,created_at,operation_kind,base_server_revision,local_commit_sequence,source_device_id,active_lease_epoch,device_mutation_sequence,payload_schema_version,mutation_payload_sha256,state) VALUES (?1,?2,'domain_asset',?3,?4,?5,'upsert',?6,?7,?8,?9,?10,1,?11,'pending')",
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

    #[cfg(test)]
    pub(crate) fn seed_cloudflare_projection_for_test(
        &mut self,
    ) -> Result<PendingCloudflareDnsProjection, BusinessDatabaseError> {
        let observed_at = "2026-09-15T00:00:00Z";
        {
            let connection = self.store.fixture_connection();
            connection
                .execute(
                    "INSERT INTO domain_assets
                     (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
                     VALUES (?1,'projection.test','active',?2,?2,1)",
                    params![self.workspace_id, observed_at],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            connection
                .execute(
                    "INSERT INTO local_provider_connections
                     (workspace_id,connection_id,provider_kind,display_label,
                      active_credential_changed_at,capabilities_json,credential_use_state,
                      active_credential_generation,active_credential_scope_digest,
                      active_credential_zone_digest,active_credential_public_proof,validation_status)
                     VALUES (?1,'cf-projection','cloudflare','Cloudflare',?2,'[\"dns\"]',
                             'active',1,?3,?4,?5,'valid')",
                    params![
                        self.workspace_id,
                        observed_at,
                        "a".repeat(64),
                        "c".repeat(64),
                        "b".repeat(64)
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        self.commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000011".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000012".into(),
            entity_id: "projection.test".into(),
            connection_id: "cf-projection".into(),
            lease_epoch: 1,
            observed_at: observed_at.into(),
            zone_name_ascii: "projection.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
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
            let wire_digest = canonical_sync_digest(&wire)?;
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
                    continue;
                }
                break;
            }
            let updated = transaction
                .execute(
                    "UPDATE sync_outbox
                     SET state = 'sending', attempt_count = ?1, delivery_owner = ?2,
                         delivery_lease_expires_at = ?3, delivery_attempt_fence = ?1,
                         wire_schema_version = 2, wire_mutation_digest = ?4,
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
                   AND device_mutation_sequence=?9 AND wire_schema_version=2
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
                       AND device_mutation_sequence=?9 AND wire_schema_version=2
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
        conflicted: bool,
    ) -> Result<(), BusinessDatabaseError> {
        self.reject_sync_batch_v2_guarded(delivery_owner, mutations, conflicted, |_| Ok(()))
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
        conflicted: bool,
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
        let terminal_state = if conflicted { "conflicted" } else { "rejected" };
        let error_code = if conflicted {
            "sync_idempotency_conflict"
        } else {
            "sync_deterministic_rejection"
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
                       AND device_mutation_sequence=?9 AND wire_schema_version=2
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
        }
        let effect = SyncProjectionEffect::VisibleStateChanged;
        pre_commit_guard(effect)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(effect)
    }

    /// # Errors
    ///
    /// Returns a storage error when metadata cannot be read.
    pub fn current_server_revision(&self) -> Result<u64, BusinessDatabaseError> {
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

    pub(crate) fn durable_sync_snapshot(
        &self,
    ) -> Result<DurableSyncSnapshot, BusinessDatabaseError> {
        let (pending, open, rejected, recovery, applied, last_activity):
            (i64, i64, i64, i64, i64, Option<String>) = self
            .store
            .raw_connection()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM sync_outbox WHERE workspace_id=m.workspace_id AND state IN ('pending','sending')),
                   (SELECT count(*) FROM sync_conflicts WHERE workspace_id=m.workspace_id AND status='open'),
                   (SELECT count(*) FROM sync_outbox WHERE workspace_id=m.workspace_id AND state='rejected'),
                   EXISTS(SELECT 1 FROM sync_reader_state WHERE workspace_id=m.workspace_id AND status='rebootstrap_required'),
                   m.applied_through_server_revision,m.last_replication_activity_at
                 FROM active_workspace_metadata m WHERE m.singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let last_replication_activity_at = match last_activity {
            Some(value) => Some(
                validate_timestamp(Some(value))
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?
                    .ok_or(BusinessDatabaseError::StorageRejected)?,
            ),
            None => None,
        };
        Ok(DurableSyncSnapshot {
            pending_mutation_count: u64::try_from(pending)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            open_conflict_count: u64::try_from(open)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            rejected_mutation_count: u64::try_from(rejected)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            recovery_required: recovery == 1,
            applied_through_server_revision: u64::try_from(applied)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            last_replication_activity_at,
        })
    }

    /// Produces a deterministic proof over durable application state.
    ///
    /// The publication journal is deliberately excluded: it contains the digest of the manifest
    /// that embeds this proof, and including it would create a circular digest dependency. The
    /// private `cfg(test)` recovery protocol validates that journal independently when exercising
    /// publication recovery; production backup proofs remain journal-independent.
    ///
    /// # Errors
    ///
    /// Returns a storage error when any schema or row cannot be read.
    pub fn recovery_proof(&self) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
        let (workspace_id, applied, local, next): (String, i64, i64, i64) = self
            .store
            .raw_connection()
            .query_row(
                "SELECT workspace_id,applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence FROM active_workspace_metadata WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(DatabaseRecoveryProof {
            workspace_id,
            row_digest: complete_database_digest(self.store.raw_connection())?,
            applied_server_revision: u64::try_from(applied)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            local_commit_sequence: u64::try_from(local)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            next_device_mutation_sequence: u64::try_from(next)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        })
    }
}

fn complete_database_digest(
    connection: &rusqlite::Connection,
) -> Result<String, BusinessDatabaseError> {
    use rusqlite::types::ValueRef;

    let mut names = connection
        .prepare(
            "SELECT name FROM sqlite_schema
                  WHERE type='table' AND name NOT LIKE 'sqlite_%'
                    AND name != 'sync_rebootstrap_journal'
                  ORDER BY name",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    names.sort();
    let mut digest = Sha256::new();
    for name in names {
        append_digest_part(&mut digest, name.as_bytes());
        let quoted = name.replace('"', "\"\"");
        let mut statement = connection
            .prepare(&format!("SELECT * FROM \"{quoted}\""))
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let column_count = statement.column_count();
        let mut rows = statement
            .query_map([], |row| {
                let mut encoded = Vec::new();
                for index in 0..column_count {
                    match row.get_ref(index)? {
                        ValueRef::Null => encoded.extend_from_slice(&[0]),
                        ValueRef::Integer(value) => {
                            encoded.extend_from_slice(&[1]);
                            encoded.extend_from_slice(&value.to_be_bytes());
                        }
                        ValueRef::Real(value) => {
                            encoded.extend_from_slice(&[2]);
                            encoded.extend_from_slice(&value.to_bits().to_be_bytes());
                        }
                        ValueRef::Text(value) => {
                            encoded.extend_from_slice(&[3]);
                            append_bytes(&mut encoded, value);
                        }
                        ValueRef::Blob(value) => {
                            encoded.extend_from_slice(&[4]);
                            append_bytes(&mut encoded, value);
                        }
                    }
                }
                Ok(encoded)
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        rows.sort();
        for row in rows {
            append_digest_part(&mut digest, &row);
        }
    }
    Ok(digest
        .finalize()
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write as _;
            write!(output, "{byte:02x}").expect("String writes cannot fail");
            output
        }))
}

#[cfg(test)]
fn recovery_proof_from_connection(
    transaction: &rusqlite::Connection,
) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
    let (workspace_id, applied, local, next): (String, i64, i64, i64) = transaction
        .query_row(
            "SELECT workspace_id,applied_through_server_revision,local_commit_sequence,next_device_mutation_sequence FROM active_workspace_metadata WHERE singleton=1",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(DatabaseRecoveryProof {
        workspace_id,
        row_digest: complete_database_digest(transaction)?,
        applied_server_revision: u64::try_from(applied)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        local_commit_sequence: u64::try_from(local)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        next_device_mutation_sequence: u64::try_from(next)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
    })
}

fn append_digest_part(digest: &mut Sha256, bytes: &[u8]) {
    digest.update(u64::try_from(bytes.len()).unwrap_or(u64::MAX).to_be_bytes());
    digest.update(bytes);
}

fn append_bytes(output: &mut Vec<u8>, bytes: &[u8]) {
    output.extend_from_slice(&u64::try_from(bytes.len()).unwrap_or(u64::MAX).to_be_bytes());
    output.extend_from_slice(bytes);
}

fn map_portfolio_read_error(error: PortfolioReadError) -> BusinessDatabaseError {
    match error {
        PortfolioReadError::StorageRejected => BusinessDatabaseError::StorageRejected,
        PortfolioReadError::SchemaRejected => BusinessDatabaseError::SchemaRejected,
        PortfolioReadError::CredentialSchemaRebuildRequired => {
            BusinessDatabaseError::CredentialSchemaRebuildRequired
        }
        PortfolioReadError::WorkspaceRejected => BusinessDatabaseError::WorkspaceRejected,
        PortfolioReadError::ProjectionRejected => BusinessDatabaseError::ProjectionRejected,
        PortfolioReadError::RevisionRejected => BusinessDatabaseError::RevisionRejected,
        PortfolioReadError::AssetNotFound => BusinessDatabaseError::AssetNotFound,
        PortfolioReadError::QueryRejected => BusinessDatabaseError::QueryRejected,
        PortfolioReadError::WindowRejected => BusinessDatabaseError::WindowRejected,
    }
}

pub(crate) fn sync_payload(value: &impl Serialize) -> Result<String, BusinessDatabaseError> {
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

fn canonical_cloudflare_projection_digest(
    value: &serde_json::Value,
) -> Result<String, BusinessDatabaseError> {
    fn frame(tag: u8, payload: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(payload.len() + 24);
        output.push(tag);
        output.extend_from_slice(payload.len().to_string().as_bytes());
        output.push(b':');
        output.extend_from_slice(payload);
        output
    }
    fn encode(value: &serde_json::Value) -> Result<Vec<u8>, BusinessDatabaseError> {
        match value {
            serde_json::Value::Null => Ok(b"z0:".to_vec()),
            serde_json::Value::Bool(value) => Ok(if *value { b"b1:1" } else { b"b1:0" }.to_vec()),
            serde_json::Value::Number(value) => value
                .as_i64()
                .map(|value| frame(b'n', value.to_string().as_bytes()))
                .ok_or(BusinessDatabaseError::InvalidInput),
            serde_json::Value::String(value) => Ok(frame(b's', value.as_bytes())),
            serde_json::Value::Array(values) => {
                let mut payload = Vec::new();
                for value in values {
                    payload.extend(frame(b'e', &encode(value)?));
                }
                Ok(frame(b'a', &payload))
            }
            serde_json::Value::Object(values) => {
                let mut payload = Vec::new();
                let mut entries: Vec<_> = values.iter().collect();
                entries.sort_by(|(left, _), (right, _)| left.as_bytes().cmp(right.as_bytes()));
                for (key, value) in entries {
                    let mut entry = frame(b'k', key.as_bytes());
                    entry.extend(frame(b'v', &encode(value)?));
                    payload.extend(frame(b'e', &entry));
                }
                Ok(frame(b'o', &payload))
            }
        }
    }
    let domain = frame(b'd', b"GOODDEALER-CLOUDFLARE-DNS-PROJECTION-V1");
    let mut input = domain;
    input.extend(frame(b'v', &encode(value)?));
    Ok(hex_digest(&input))
}

#[allow(clippy::too_many_arguments)]
fn reconstruct_sync_mutation_v2(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    mutation_id: &str,
    entity_id: &str,
    operation_kind: &str,
    base_server_revision: i64,
    workspace_schema_version: i64,
    source_device_id: &str,
    active_lease_epoch: i64,
    device_mutation_sequence: i64,
    created_at: &str,
) -> Result<serde_json::Value, BusinessDatabaseError> {
    if operation_kind != "upsert" && operation_kind != "delete" {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let fields = {
        let mut statement = transaction
            .prepare(
                "SELECT field_path, field_value_json, field_value_sha256
                 FROM sync_outbox_fields
                 WHERE workspace_id=?1 AND mutation_id=?2
                 ORDER BY ordinal",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map(params![workspace_id, mutation_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
    };
    if (operation_kind == "upsert" && fields.is_empty())
        || (operation_kind == "delete" && !fields.is_empty())
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let mut previous: Option<&str> = None;
    let mut changed_fields = Vec::with_capacity(fields.len());
    for (field_path, value_json, value_digest) in &fields {
        if !matches!(
            field_path.as_str(),
            "note" | "portfolioId" | "tags" | "targetPrice"
        ) || previous.is_some_and(|value| value >= field_path.as_str())
        {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        if hex_digest(value_json.as_bytes()) != *value_digest {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        previous = Some(field_path);
        let value: serde_json::Value =
            serde_json::from_str(value_json).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        changed_fields.push(serde_json::json!({ "fieldPath": field_path, "value": value }));
    }
    let mut mutation = serde_json::json!({
        "schemaVersion": 2,
        "mutationId": mutation_id,
        "workspaceSchemaVersion": workspace_schema_version,
        "entityType": "domain_asset",
        "entityId": entity_id,
        "operationKind": operation_kind,
        "baseServerRevision": base_server_revision,
        "changedFields": changed_fields,
        "sourceDeviceId": source_device_id,
        "activeLeaseEpoch": active_lease_epoch,
        "deviceMutationSequence": device_mutation_sequence,
    });
    if operation_kind == "delete" {
        mutation
            .as_object_mut()
            .ok_or(BusinessDatabaseError::StorageRejected)?
            .insert(
                "deletedAt".to_owned(),
                serde_json::Value::String(created_at.to_owned()),
            );
    }
    Ok(mutation)
}

fn validate_cursor_token(token: Option<&str>) -> Result<(), BusinessDatabaseError> {
    if token.is_some_and(|value| {
        value.is_empty()
            || value.len() > 512
            || value
                .bytes()
                .any(|byte| !byte.is_ascii_alphanumeric() && byte != b'_' && byte != b'-')
    }) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

fn validate_digest(value: &str) -> Result<(), BusinessDatabaseError> {
    if value.len() != 43
        || value
            .bytes()
            .any(|byte| !byte.is_ascii_alphanumeric() && byte != b'_' && byte != b'-')
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn canonical_page_digest(
    value: &serde_json::Value,
) -> Result<String, BusinessDatabaseError> {
    let mut digest_input = value
        .as_object()
        .cloned()
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    digest_input.remove("pageDigest");
    let mut encoded = Vec::new();
    append_frame(&mut encoded, b'd', b"GOODDEALER-WORKSPACE-MUTATION-PAGE-V2");
    append_frame(
        &mut encoded,
        b'v',
        &canonical_wire_value(&serde_json::Value::Object(digest_input))?,
    );
    Ok(base64url(&Sha256::digest(encoded)))
}

/// Verifies the protocol-owned pinned rebootstrap plan digest with the canonical wire codec.
///
/// # Errors
///
/// Returns an input error for malformed objects or a digest mismatch.
#[cfg(test)]
pub fn verify_rebootstrap_plan_digest(
    value: &serde_json::Value,
) -> Result<(), BusinessDatabaseError> {
    let mut input = value
        .as_object()
        .cloned()
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    let advertised = input
        .remove("pinnedHeadDigest")
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    validate_digest(&advertised)?;
    let mut encoded = Vec::new();
    append_frame(
        &mut encoded,
        b'd',
        b"GOODDEALER-WORKSPACE-REBOOTSTRAP-PLAN-V2",
    );
    append_frame(
        &mut encoded,
        b'v',
        &canonical_wire_value(&serde_json::Value::Object(input))?,
    );
    if base64url(&Sha256::digest(encoded)) != advertised {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

/// Verifies that a complete checkpoint snapshot matches its advertised aggregate digest.
///
/// The computation mirrors the protocol's bounded 512-row domain-asset partitions and its
/// domain-separated aggregate of entity digests. Callers must perform this check before creating
/// a candidate key or touching staged storage.
///
/// # Errors
///
/// Returns an input error for a malformed projection, malformed digest, or digest mismatch.
#[cfg(test)]
pub fn verify_rebootstrap_checkpoint_digest(
    rows: &[DomainAssetProjectionRow],
    advertised: &str,
) -> Result<(), BusinessDatabaseError> {
    validate_projection(rows).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    validate_digest(advertised)?;
    let partitions: Vec<(String, &[DomainAssetProjectionRow])> = if rows.is_empty() {
        vec![("empty".to_owned(), rows)]
    } else {
        rows.chunks(512)
            .enumerate()
            .map(|(index, partition)| (format!("p{index:04}"), partition))
            .collect()
    };
    let mut entity_digests = Vec::with_capacity(partitions.len());
    for (partition_id, partition) in partitions {
        let mut encoded = Vec::new();
        append_frame(&mut encoded, b'd', b"GOODDEALER-WORKSPACE-DOMAIN-ASSET-V1");
        let value =
            serde_json::to_value(partition).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        append_frame(&mut encoded, b'v', &canonical_wire_value(&value)?);
        entity_digests.push(serde_json::json!({
            "entityType": "domain_asset",
            "partitionId": partition_id,
            "digest": base64url(&Sha256::digest(encoded)),
        }));
    }
    let mut aggregate = Vec::new();
    append_frame(
        &mut aggregate,
        b'd',
        b"GOODDEALER-WORKSPACE-ENTITY-DIGESTS-V2",
    );
    append_frame(
        &mut aggregate,
        b'v',
        &canonical_wire_value(&serde_json::Value::Array(entity_digests))?,
    );
    if base64url(&Sha256::digest(aggregate)) != advertised {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

/// Validates one recovery projection row with the same rules used by local business writes.
///
/// # Errors
///
/// Returns an input error when the row is not a canonical domain-asset projection.
#[cfg(test)]
pub fn validate_rebootstrap_asset(asset: &DomainAssetWrite) -> Result<(), BusinessDatabaseError> {
    validate_domain_asset(asset)
}

/// Validates a canonical UTC-second timestamp from a recovery wire value.
///
/// # Errors
///
/// Returns an input error when the timestamp is not canonical or is not a real date.
#[cfg(test)]
pub fn validate_rebootstrap_timestamp(value: &str) -> Result<(), BusinessDatabaseError> {
    validate_timestamp(Some(value.to_owned()))
        .map(|_| ())
        .map_err(|_| BusinessDatabaseError::InvalidInput)
}

/// Verifies a mutation page digest before staged storage is touched.
///
/// # Errors
///
/// Returns an input error for malformed objects or a digest mismatch.
#[cfg(test)]
pub fn verify_rebootstrap_page_digest(
    value: &serde_json::Value,
) -> Result<(), BusinessDatabaseError> {
    let advertised = value
        .get("pageDigest")
        .and_then(serde_json::Value::as_str)
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    validate_digest(advertised)?;
    if canonical_page_digest(value)? != advertised {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

fn canonical_mutation_digest(mutation: &SyncMutationV2) -> Result<String, BusinessDatabaseError> {
    let mut value =
        serde_json::to_value(mutation).map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if let Some(object) = value.as_object_mut() {
        object.remove("workspaceId");
        object.remove("serverRevision");
    }
    canonical_sync_digest(&value)
}

fn validate_sync_mutation_fields(mutation: &SyncMutationV2) -> Result<(), BusinessDatabaseError> {
    let mut previous: Option<&str> = None;
    for field in &mutation.changed_fields {
        if previous.is_some_and(|prior| prior >= field.field_path.as_str()) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        previous = Some(&field.field_path);
        match field.field_path.as_str() {
            "note" | "portfolioId" if field.value.is_null() || field.value.is_string() => {}
            "tags" => {
                let tags: Vec<String> = serde_json::from_value(field.value.clone())
                    .map_err(|_| BusinessDatabaseError::InvalidInput)?;
                if tags.len() > 64 || tags.iter().any(|tag| tag.is_empty() || tag.len() > 64) {
                    return Err(BusinessDatabaseError::InvalidInput);
                }
            }
            "targetPrice" if field.value.is_null() => {}
            "targetPrice" => {
                let object = field
                    .value
                    .as_object()
                    .ok_or(BusinessDatabaseError::InvalidInput)?;
                if object.len() != 2
                    || object
                        .get("currency")
                        .and_then(|value| value.as_str())
                        .is_none()
                    || object
                        .get("amount")
                        .and_then(|value| value.as_str())
                        .is_none()
                {
                    return Err(BusinessDatabaseError::InvalidInput);
                }
            }
            _ => return Err(BusinessDatabaseError::InvalidInput),
        }
    }
    Ok(())
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
            )?;
            let local_commit_sequence: i64 = transaction.query_row(
                "SELECT local_commit_sequence FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                params![workspace_id, mutation.entity_id], |row| row.get(0)
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction.execute(
                "INSERT INTO sync_tombstones
                 (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,
                  deleted_server_revision,deleted_at,purge_after,state,barrier_state,
                  order_server_revision,order_source_device_id,order_mutation_id)
                 VALUES (?1,'domain_asset',?2,?3,?4,?5,NULL,'replicated','contested',?4,?6,?7)
                 ON CONFLICT(workspace_id,entity_kind,entity_id) DO UPDATE SET
                   deleted_server_revision=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.deleted_server_revision ELSE sync_tombstones.deleted_server_revision END,
                   deleted_at=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.deleted_at ELSE sync_tombstones.deleted_at END,
                   barrier_state=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN 'contested' ELSE sync_tombstones.barrier_state END,
                   order_server_revision=MAX(COALESCE(sync_tombstones.order_server_revision,0),excluded.order_server_revision),
                   order_source_device_id=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.order_source_device_id ELSE sync_tombstones.order_source_device_id END,
                   order_mutation_id=CASE WHEN excluded.order_server_revision > COALESCE(sync_tombstones.order_server_revision,0) THEN excluded.order_mutation_id ELSE sync_tombstones.order_mutation_id END",
                params![workspace_id,mutation.entity_id,local_commit_sequence,i64::try_from(mutation.server_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?,mutation.deleted_at.as_deref().unwrap_or("1970-01-01T00:00:00Z"),mutation.source_device_id,mutation.mutation_id]
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            return Ok(true);
        }
        transaction
            .execute(
                "INSERT INTO sync_tombstones
                 (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,
                  deleted_server_revision,deleted_at,purge_after,state,barrier_state,
                  order_server_revision,order_source_device_id,order_mutation_id)
                 VALUES (?1,'domain_asset',?2,?3,?4,?5,NULL,'replicated','replicated',?4,?6,?7)
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
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO domain_assets
                 (workspace_id,entity_id,lifecycle_status,created_at,updated_at,deleted_at,local_commit_sequence)
                 VALUES (?1,?2,'archived',strftime('%Y-%m-%dT%H:%M:%SZ','now'),?3,?3,?4)
                 ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
                   lifecycle_status='archived',updated_at=excluded.updated_at,
                   deleted_at=excluded.deleted_at,local_commit_sequence=excluded.local_commit_sequence",
                params![workspace_id, mutation.entity_id, mutation.deleted_at.as_deref().unwrap_or("1970-01-01T00:00:00Z"), local_commit_sequence],
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
             (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
             VALUES (?1,?2,'active',strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'),?3)
             ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
               lifecycle_status='active',deleted_at=NULL,updated_at=excluded.updated_at,
               local_commit_sequence=excluded.local_commit_sequence",
            params![workspace_id, mutation.entity_id, local_commit_sequence],
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

fn read_local_conflict_value(
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
fn persist_conflict_candidate(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    mutation: &SyncMutationV2,
    field_path: &str,
    local_value: serde_json::Value,
) -> Result<(), BusinessDatabaseError> {
    let remote_value = if mutation.operation_kind == "delete" {
        serde_json::json!({"deletedAt": mutation.deleted_at})
    } else {
        mutation
            .changed_fields
            .iter()
            .find(|field| field.field_path == field_path)
            .map_or_else(|| serde_json::Value::Null, |field| field.value.clone())
    };
    let local_json =
        serde_json::to_string(&local_value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let remote_json =
        serde_json::to_string(&remote_value).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let conflict_id = format!("conflict-{}-{}", mutation.mutation_id, field_path);
    let remote_digest = canonical_mutation_digest(mutation)?;
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
fn merge_checkpoint_existing_asset(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    asset: &DomainAssetWrite,
    checkpoint_revision: u64,
) -> Result<(), BusinessDatabaseError> {
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

fn canonical_sync_digest(value: &serde_json::Value) -> Result<String, BusinessDatabaseError> {
    let mut encoded = Vec::new();
    append_frame(&mut encoded, b'd', b"GOODDEALER-WORKSPACE-MUTATION-V2");
    let canonical = canonical_wire_value(value)?;
    append_frame(&mut encoded, b'v', &canonical);
    Ok(base64url(&Sha256::digest(encoded)))
}

fn canonical_wire_value(value: &serde_json::Value) -> Result<Vec<u8>, BusinessDatabaseError> {
    let mut output = Vec::new();
    match value {
        serde_json::Value::Null => output.extend_from_slice(b"z0:"),
        serde_json::Value::Bool(value) => {
            output.extend_from_slice(if *value { b"b1:1" } else { b"b1:0" });
        }
        serde_json::Value::Number(value) => {
            let number = value
                .as_i64()
                .ok_or(BusinessDatabaseError::StorageRejected)?;
            append_frame(&mut output, b'n', number.to_string().as_bytes());
        }
        serde_json::Value::String(value) => append_frame(&mut output, b's', value.as_bytes()),
        serde_json::Value::Array(values) => {
            let mut entries = Vec::new();
            for value in values {
                append_frame(&mut entries, b'e', &canonical_wire_value(value)?);
            }
            append_frame(&mut output, b'a', &entries);
        }
        serde_json::Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut entries = Vec::new();
            for key in keys {
                let mut entry = Vec::new();
                append_frame(&mut entry, b'k', key.as_bytes());
                append_frame(&mut entry, b'v', &canonical_wire_value(&values[key])?);
                append_frame(&mut entries, b'e', &entry);
            }
            append_frame(&mut output, b'o', &entries);
        }
    }
    Ok(output)
}

fn append_frame(output: &mut Vec<u8>, tag: u8, payload: &[u8]) {
    output.push(tag);
    output.extend_from_slice(payload.len().to_string().as_bytes());
    output.push(b':');
    output.extend_from_slice(payload);
}

fn base64url(value: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(value.len().div_ceil(3) * 4);
    for chunk in value.chunks(3) {
        let bits = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        output.push(char::from(ALPHABET[((bits >> 18) & 63) as usize]));
        output.push(char::from(ALPHABET[((bits >> 12) & 63) as usize]));
        if chunk.len() > 1 {
            output.push(char::from(ALPHABET[((bits >> 6) & 63) as usize]));
        }
        if chunk.len() > 2 {
            output.push(char::from(ALPHABET[(bits & 63) as usize]));
        }
    }
    output
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
    Ok(())
}

fn contains_forbidden_sync_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized: String = key
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .flat_map(char::to_lowercase)
                .collect();
            FORBIDDEN_SYNC_KEYS.iter().any(|forbidden| {
                let forbidden: String = forbidden
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
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
    if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_sha256_hex(value: &str) -> Result<(), BusinessDatabaseError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    Ok(())
}

fn is_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 8 | 13 | 18 | 23)
                || (byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    const TIMESTAMP: &str = "2026-08-28T00:00:00Z";

    #[test]
    fn cloudflare_projection_digest_matches_protocol_golden() {
        let projection = serde_json::json!({
            "schemaVersion": 1,
            "providerKind": "cloudflare",
            "observationCapability": "dns",
            "observationId": "123e4567-e89b-42d3-a456-426614174000",
            "entityId": "example.com",
            "leaseEpoch": 7,
            "sourceSequence": 1,
            "observedAt": "2026-09-15T00:00:00Z",
            "availability": "available",
            "zoneStatus": "active",
            "counts": { "a": 1, "aaaa": 0, "cname": 2, "txt": 3, "proxied": 1 },
        });
        assert_eq!(
            canonical_cloudflare_projection_digest(&projection).unwrap(),
            "5600723db76bdce097579641d89e0aaa517b28edd557fc41dd5346710c93ca55"
        );
    }

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
    fn ordinary_keyed_open_retains_default_memory_security_in_unit_tests() {
        let database = database();
        let state: String = database
            .store
            .raw_connection()
            .query_row("PRAGMA cipher_memory_security", [], |row| row.get(0))
            .unwrap();
        assert_eq!(state, "0");
    }

    #[test]
    fn business_write_and_sync_outbox_commit_atomically() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "mutation-1",
                TIMESTAMP,
                &DomainAssetWrite {
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
        let pending = database.test_pending_sync_rows(10).unwrap();
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
    fn sqlcipher_full_clone_rekeys_and_preserves_complete_database_proof() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("source.db");
        let candidate_path = directory.path().join("candidate.db");
        let source_key = LocalDatabaseKey::from_bytes([0x31; 32]);
        let candidate_key = LocalDatabaseKey::from_bytes([0x52; 32]);
        let mut source =
            BusinessDatabase::open(&source_path, &source_key, "workspace-local").unwrap();
        source
            .upsert_domain_asset(
                "clone-mutation",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "clone.test".to_owned(),
                    note: Some("preserved".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let before = source.recovery_proof().unwrap();
        clone_encrypted_database(&source_path, &source_key, &candidate_path, &candidate_key)
            .unwrap();
        assert_eq!(
            BusinessDatabase::open(&candidate_path, &source_key, "workspace-local").err(),
            Some(BusinessDatabaseError::StorageRejected)
        );
        let candidate =
            BusinessDatabase::open(&candidate_path, &candidate_key, "workspace-local").unwrap();
        assert_eq!(candidate.recovery_proof().unwrap(), before);
        assert_eq!(candidate.test_pending_sync_rows(10).unwrap().len(), 1);
        drop(candidate);
        assert_eq!(
            clone_encrypted_database(&source_path, &source_key, &candidate_path, &candidate_key),
            Err(BusinessDatabaseError::StorageRejected)
        );
        assert_eq!(source.recovery_proof().unwrap(), before);
        let wrong_source_key = LocalDatabaseKey::from_bytes([0x71; 32]);
        assert_eq!(
            clone_encrypted_database(
                &source_path,
                &wrong_source_key,
                &directory.path().join("wrong-source.db"),
                &candidate_key,
            ),
            Err(BusinessDatabaseError::StorageRejected)
        );
        assert_eq!(source.recovery_proof().unwrap(), before);
    }

    #[test]
    fn native_checkpoint_due_is_durable_and_clears_only_with_exact_descriptor() {
        let mut database = database();
        assert_eq!(database.native_checkpoint_due(), Ok(true));
        let invalid = NativeCheckpointDescriptor {
            schema_version: 2,
            checkpoint_id: "checkpoint-1".to_owned(),
            workspace_id: "other-workspace".to_owned(),
            workspace_schema_version: 1,
            through_server_revision: 0,
            checkpoint_digest: "A".repeat(43),
        };
        assert_eq!(
            database.complete_native_checkpoint_guarded(Some(&invalid), TIMESTAMP, || Ok(())),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(database.native_checkpoint_due(), Ok(true));
        let descriptor = NativeCheckpointDescriptor {
            workspace_id: "workspace-local".to_owned(),
            checkpoint_digest: "A".repeat(43),
            ..invalid
        };
        database
            .complete_native_checkpoint_guarded(Some(&descriptor), TIMESTAMP, || Ok(()))
            .unwrap();
        assert_eq!(database.native_checkpoint_due(), Ok(false));
        database
            .mark_sync_rebootstrap_required_v2("device-local")
            .unwrap();
        assert_eq!(database.native_checkpoint_due(), Ok(true));
    }

    #[test]
    #[allow(clippy::too_many_lines)]
    fn cloudflare_projection_claim_reclaim_and_ack_are_exactly_fenced() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','projection.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-projection','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
        let _ = connection;
        let pending = database
            .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
                observation_id: "00000000-0000-4000-8000-000000000011".into(),
                observation_run_id: "00000000-0000-4000-8000-000000000012".into(),
                entity_id: "projection.test".into(),
                connection_id: "cf-projection".into(),
                lease_epoch: 7,
                observed_at: TIMESTAMP.into(),
                zone_name_ascii: "projection.test".into(),
                authoritative_nameservers: vec![],
                dnssec_status: "unknown".into(),
                availability: "available".into(),
                zone_status: "active".into(),
                records: vec![],
                provider_version_token: "v1".into(),
                credential_generation: 1,
                credential_scope_digest: "a".repeat(64),
                credential_zone_digest: "c".repeat(64),
                credential_public_proof: "b".repeat(64),
            })
            .unwrap();
        let first = database
            .claim_cloudflare_dns_projections_guarded(
                "owner-a",
                TIMESTAMP,
                "2026-09-15T00:01:00Z",
                1,
                || Ok(()),
            )
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(first.delivery_attempt_fence, 1);
        let second = database
            .claim_cloudflare_dns_projections_guarded(
                "owner-b",
                "2026-09-15T00:02:00Z",
                "2026-09-15T00:03:00Z",
                1,
                || Ok(()),
            )
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(second.delivery_attempt_fence, 2);
        let acknowledgement = CloudflareDnsProjectionAcknowledgement {
            observation_id: pending.observation_id,
            lease_epoch: pending.lease_epoch,
            source_sequence: pending.source_sequence,
            delivery_attempt_fence: second.delivery_attempt_fence,
            canonical_request_digest: pending.canonical_request_digest,
            observation_sequence: 9,
            disposition: "current".into(),
        };
        let mut old = acknowledgement.clone();
        old.delivery_attempt_fence = first.delivery_attempt_fence;
        assert!(
            database
                .acknowledge_cloudflare_dns_projection_guarded(
                    "owner-a",
                    &old,
                    "2026-09-15T00:02:01Z",
                    || Ok(()),
                )
                .is_err()
        );
        let mut wrong = acknowledgement.clone();
        wrong.canonical_request_digest = "f".repeat(64);
        assert!(
            database
                .acknowledge_cloudflare_dns_projection_guarded(
                    "owner-b",
                    &wrong,
                    "2026-09-15T00:02:01Z",
                    || Ok(()),
                )
                .is_err()
        );
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                "owner-b",
                &acknowledgement,
                "2026-09-15T00:02:01Z",
                || Ok(()),
            )
            .unwrap();
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                "owner-b",
                &acknowledgement,
                "2026-09-15T00:02:02Z",
                || Ok(()),
            )
            .unwrap();
        let mut replay_mismatch = acknowledgement;
        replay_mismatch.disposition = "stale".into();
        assert!(
            database
                .acknowledge_cloudflare_dns_projection_guarded(
                    "owner-b",
                    &replay_mismatch,
                    "2026-09-15T00:02:03Z",
                    || Ok(()),
                )
                .is_err()
        );
    }

    #[test]
    fn cloudflare_projection_retry_deferral_persists_exact_deadline_and_error() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','retry.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-retry','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
        let pending = database
            .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
                observation_id: "00000000-0000-4000-8000-000000000031".into(),
                observation_run_id: "00000000-0000-4000-8000-000000000032".into(),
                entity_id: "retry.test".into(),
                connection_id: "cf-retry".into(),
                lease_epoch: 7,
                observed_at: TIMESTAMP.into(),
                zone_name_ascii: "retry.test".into(),
                authoritative_nameservers: vec![],
                dnssec_status: "unknown".into(),
                availability: "available".into(),
                zone_status: "active".into(),
                records: vec![],
                provider_version_token: "v1".into(),
                credential_generation: 1,
                credential_scope_digest: "a".repeat(64),
                credential_zone_digest: "c".repeat(64),
                credential_public_proof: "b".repeat(64),
            })
            .unwrap();
        let claimed = database
            .claim_cloudflare_dns_projections_guarded(
                "retry-owner",
                TIMESTAMP,
                "2026-09-15T00:01:00Z",
                1,
                || Ok(()),
            )
            .unwrap()
            .pop()
            .unwrap();
        let deadline = database
            .defer_cloudflare_dns_projection_guarded(
                "retry-owner",
                &claimed,
                "2026-09-15T00:00:00Z",
                || Ok(()),
            )
            .unwrap();
        assert_eq!(deadline, 1_789_430_402);
        let row: (String, Option<String>, Option<String>) = database.store.raw_connection().query_row("SELECT state,next_attempt_at,last_error_code FROM cloudflare_dns_projection_outbox WHERE observation_id=?1", [pending.observation_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        assert_eq!(row.0, "pending");
        assert_eq!(row.1.as_deref(), Some("2026-09-15T00:00:02Z"));
        assert_eq!(row.2.as_deref(), Some("transport_retryable"));
    }

    #[test]
    fn cloudflare_projection_wake_returns_the_ordered_head_deadline() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        connection
            .execute(
                "INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
                 VALUES ('workspace-local','head.test','active',?1,?1,1)",
                [TIMESTAMP],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
                 VALUES ('workspace-local','later.test','active',?1,?1,2)",
                [TIMESTAMP],
            )
            .unwrap();
        let projection = r#"{"schemaVersion":1,"entityId":"head.test"}"#;
        let digest =
            canonical_cloudflare_projection_digest(&serde_json::from_str(projection).unwrap())
                .unwrap();
        connection
            .execute(
                "INSERT INTO cloudflare_dns_projection_outbox
                 (workspace_id,observation_id,entity_id,lease_epoch,source_sequence,observed_at,
                  projection_json,canonical_request_digest,state,next_attempt_at)
                 VALUES ('workspace-local',?1,'head.test',1,1,?2,?3,?4,'pending',?5)",
                rusqlite::params![
                    "00000000-0000-4000-8000-000000000081",
                    TIMESTAMP,
                    projection,
                    digest,
                    "2026-09-15T00:10:00Z"
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO cloudflare_dns_projection_outbox
                 (workspace_id,observation_id,entity_id,lease_epoch,source_sequence,observed_at,
                  projection_json,canonical_request_digest,state)
                 VALUES ('workspace-local',?1,'later.test',2,1,?2,?3,?4,'pending')",
                rusqlite::params![
                    "00000000-0000-4000-8000-000000000082",
                    TIMESTAMP,
                    projection,
                    digest
                ],
            )
            .unwrap();
        assert_eq!(
            database
                .next_cloudflare_projection_attempt_unix_seconds(1_789_430_400)
                .unwrap(),
            Some(1_789_431_000)
        );
        assert!(
            database
                .claim_cloudflare_dns_projections_guarded(
                    "head-owner",
                    "2026-09-15T00:00:00Z",
                    "2026-09-15T00:01:00Z",
                    2,
                    || Ok(()),
                )
                .unwrap()
                .is_empty()
        );
        let later_state: String = database
            .store
            .raw_connection()
            .query_row(
                "SELECT state FROM cloudflare_dns_projection_outbox
                 WHERE observation_id='00000000-0000-4000-8000-000000000082'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(later_state, "pending");
    }

    #[test]
    fn cloudflare_projection_commit_guard_rolls_back_claim_and_ack() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','guard.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-guard','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
        let pending = database
            .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
                observation_id: "00000000-0000-4000-8000-000000000021".into(),
                observation_run_id: "00000000-0000-4000-8000-000000000022".into(),
                entity_id: "guard.test".into(),
                connection_id: "cf-guard".into(),
                lease_epoch: 7,
                observed_at: TIMESTAMP.into(),
                zone_name_ascii: "guard.test".into(),
                authoritative_nameservers: vec![],
                dnssec_status: "unknown".into(),
                availability: "available".into(),
                zone_status: "active".into(),
                records: vec![],
                provider_version_token: "v1".into(),
                credential_generation: 1,
                credential_scope_digest: "a".repeat(64),
                credential_zone_digest: "c".repeat(64),
                credential_public_proof: "b".repeat(64),
            })
            .unwrap();
        let failed_claim = database.claim_cloudflare_dns_projections_guarded(
            "guard-owner",
            TIMESTAMP,
            "2026-09-15T00:01:00Z",
            1,
            || Err(BusinessDatabaseError::WorkspaceRejected),
        );
        assert!(failed_claim.is_err());
        let claimed = database
            .claim_cloudflare_dns_projections_guarded(
                "guard-owner",
                TIMESTAMP,
                "2026-09-15T00:01:00Z",
                1,
                || Ok(()),
            )
            .unwrap()
            .pop()
            .unwrap();
        let ack = CloudflareDnsProjectionAcknowledgement {
            observation_id: pending.observation_id,
            lease_epoch: pending.lease_epoch,
            source_sequence: pending.source_sequence,
            delivery_attempt_fence: claimed.delivery_attempt_fence,
            canonical_request_digest: pending.canonical_request_digest,
            observation_sequence: 1,
            disposition: "current".into(),
        };
        assert!(
            database
                .acknowledge_cloudflare_dns_projection_guarded(
                    "guard-owner",
                    &ack,
                    "2026-09-15T00:01:01Z",
                    || Err(BusinessDatabaseError::WorkspaceRejected),
                )
                .is_err()
        );
        database
            .acknowledge_cloudflare_dns_projection_guarded(
                "guard-owner",
                &ack,
                "2026-09-15T00:01:02Z",
                || Ok(()),
            )
            .unwrap();
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
            .upsert_domain_asset("mutation-1", TIMESTAMP, &first)
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
                .upsert_domain_asset("mutation-1", TIMESTAMP, &conflicting)
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
    #[expect(
        clippy::too_many_lines,
        reason = "end-to-end edit/delete atomicity assertions stay together"
    )]
    fn edit_delete_receipts_are_idempotent_and_tombstone_blocks_resurrection() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "seed",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "edit.test".to_owned(),
                    note: Some("old".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let receipt = database
            .edit_domain_asset(
                "edit-1",
                1,
                "device-1",
                7,
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "edit.test".to_owned(),
                    note: Some("new".to_owned()),
                    portfolio_id: None,
                    tags: vec!["tag".to_owned()],
                    target_price: None,
                },
                true,
            )
            .unwrap();
        assert_eq!(receipt.disposition, "committed");
        let edit_fields: i64 = database.store.raw_connection().query_row("SELECT count(*) FROM sync_outbox_fields WHERE workspace_id='workspace-local' AND mutation_id='edit-1'", [], |row| row.get(0)).unwrap();
        assert_eq!(edit_fields, 4);
        let replay = database
            .edit_domain_asset(
                "edit-1",
                999,
                "device-1",
                8,
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "edit.test".to_owned(),
                    note: Some("new".to_owned()),
                    portfolio_id: None,
                    tags: vec!["tag".to_owned()],
                    target_price: None,
                },
                false,
            )
            .unwrap();
        assert_eq!(replay.disposition, "replayed");
        assert_eq!(
            database.edit_domain_asset(
                "edit-1",
                1,
                "device-1",
                8,
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "edit.test".to_owned(),
                    note: Some("different".to_owned()),
                    portfolio_id: None,
                    tags: vec!["tag".to_owned()],
                    target_price: None,
                },
                false,
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(
            database.edit_domain_asset(
                "edit-1",
                1,
                "device-2",
                7,
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "edit.test".to_owned(),
                    note: Some("new".to_owned()),
                    portfolio_id: None,
                    tags: vec!["tag".to_owned()],
                    target_price: None,
                },
                false,
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(
            database
                .delete_domain_asset("edit-1", 1, "device-1", 7, TIMESTAMP, "edit.test", false,),
            Err(BusinessDatabaseError::MutationConflict)
        );
        let deleted = database
            .delete_domain_asset(
                "delete-1",
                receipt.local_commit_sequence,
                "device-1",
                7,
                TIMESTAMP,
                "edit.test",
                true,
            )
            .unwrap();
        assert_eq!(deleted.disposition, "committed");
        let pending = database.test_pending_sync_rows(10).unwrap();
        let delete_candidate = pending
            .iter()
            .find(|mutation| mutation.mutation_id == "delete-1")
            .unwrap();
        assert_eq!(
            delete_candidate.mutation_payload_json,
            r#"{"entityId":"edit.test","operation":"delete"}"#
        );
        let lifecycle_version: (String, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT sync_state, local_commit_sequence
                 FROM domain_asset_field_versions
                 WHERE workspace_id='workspace-local' AND entity_id='edit.test'
                   AND field_path='lifecycleStatus'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            lifecycle_version,
            (
                "pending".to_owned(),
                i64::try_from(deleted.local_commit_sequence).unwrap()
            )
        );
        assert_eq!(
            database.delete_domain_asset(
                "edit-after-delete",
                deleted.local_commit_sequence,
                "device-1",
                7,
                TIMESTAMP,
                "edit.test",
                true
            ),
            Err(BusinessDatabaseError::AssetDeleted)
        );
        let fields: i64 = database.store.raw_connection().query_row("SELECT count(*) FROM sync_outbox_fields WHERE workspace_id='workspace-local' AND mutation_id='delete-1'", [], |row| row.get(0)).unwrap();
        assert_eq!(fields, 0);
        assert_eq!(
            database.upsert_domain_asset(
                "legacy-resurrect",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "edit.test".to_owned(),
                    note: None,
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None
                }
            ),
            Err(BusinessDatabaseError::AssetDeleted)
        );
    }

    #[test]
    fn pre_commit_guard_failure_rolls_back_all_mutation_rows() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "seed-guard",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "guard.test".to_owned(),
                    note: None,
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let result = database.edit_domain_asset_guarded(
            "guard-edit",
            1,
            "device-1",
            7,
            TIMESTAMP,
            &DomainAssetWrite {
                entity_id: "guard.test".to_owned(),
                note: Some("blocked".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            },
            true,
            |_| -> Result<(), BusinessDatabaseError> { Err(BusinessDatabaseError::MutationStale) },
            |(), _| Ok(()),
        );
        assert_eq!(result, Err(BusinessDatabaseError::MutationStale));
        let detail = database.read_domain_detail("guard.test").unwrap();
        assert_eq!(detail.asset.note, None);
        let outbox: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM sync_outbox WHERE mutation_id='guard-edit'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(outbox, 0);

        let delete_result = database.delete_domain_asset_guarded(
            "guard-delete",
            1,
            "device-1",
            7,
            TIMESTAMP,
            "guard.test",
            true,
            |_| -> Result<(), BusinessDatabaseError> { Err(BusinessDatabaseError::MutationStale) },
            |(), _| Ok(()),
        );
        assert_eq!(delete_result, Err(BusinessDatabaseError::MutationStale));
        let rollback_counts: (i64, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM domain_assets
                    WHERE entity_id='guard.test' AND deleted_at IS NULL
                      AND lifecycle_status='active' AND local_commit_sequence=1),
                   (SELECT count(*) FROM sync_tombstones WHERE entity_id='guard.test'),
                   (SELECT count(*) FROM domain_asset_field_versions
                    WHERE entity_id='guard.test' AND field_path='lifecycleStatus')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(rollback_counts, (1, 0, 0));
    }

    #[test]
    fn empty_cloud_replica_is_no_op_and_never_deletes_local_rows() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "mutation-local",
                TIMESTAMP,
                &DomainAssetWrite {
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
        assert!(database.test_pending_sync_rows(10).unwrap().is_empty());
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
    #[expect(
        clippy::too_many_lines,
        reason = "the adversarial scenario keeps all related target outcomes visible in one test"
    )]
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
                  deleted_server_revision, deleted_at, purge_after, state,barrier_state,
                  order_server_revision,order_source_device_id,order_mutation_id)
                 VALUES ('workspace-local', 'domain_asset', 'observed.test', 1, 1, ?1, ?1,
                         'purge_eligible','purge_eligible',1,'test-source','test-delete')",
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
    #[allow(clippy::too_many_lines)]
    fn cloudflare_dns_observation_atomically_writes_local_evidence_and_count_projection() {
        let mut database = database();
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','observed.test','active',?1,?1,1)", [TIMESTAMP]).unwrap();
        connection.execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-observe','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
        let _ = connection;
        let result = database
            .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
                observation_id: "00000000-0000-4000-8000-000000000001".into(),
                observation_run_id: "00000000-0000-4000-8000-000000000002".into(),
                entity_id: "observed.test".into(),
                connection_id: "cf-observe".into(),
                lease_epoch: 3,
                observed_at: TIMESTAMP.into(),
                zone_name_ascii: "observed.test".into(),
                authoritative_nameservers: vec![],
                dnssec_status: "unknown".into(),
                availability: "available".into(),
                zone_status: "active".into(),
                records: vec![CloudflareDnsRecordWrite {
                    record_key: "r1".into(),
                    record_type: "A".into(),
                    owner_name_ascii: "observed.test".into(),
                    ttl_seconds: None,
                    priority: None,
                    canonical_value: "192.0.2.1".into(),
                    proxied: Some(true),
                }],
                provider_version_token: "v1".into(),
                credential_generation: 1,
                credential_scope_digest: "a".repeat(64),
                credential_zone_digest: "c".repeat(64),
                credential_public_proof: "b".repeat(64),
            })
            .unwrap();
        assert!(!result.projection_json.contains("192.0.2.1"));
        assert_eq!(
            database
                .pending_cloudflare_dns_projections(10)
                .unwrap()
                .len(),
            1
        );
        let connection = database.store.fixture_connection();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM dns_record_observations", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );
        assert_eq!(connection.query_row("SELECT status FROM provider_observation_targets WHERE observation_run_id='00000000-0000-4000-8000-000000000002'", [], |row| row.get::<_,String>(0)).unwrap(), "succeeded");
        assert_eq!(
            connection
                .query_row(
                    "SELECT source_sequence FROM cloudflare_dns_source_heads WHERE entity_id='observed.test'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        let _ = connection;
        database.store.fixture_connection().execute("INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,validation_status) VALUES ('workspace-local','cf-observe-2','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')", rusqlite::params![TIMESTAMP,"a".repeat(64),"c".repeat(64),"b".repeat(64)]).unwrap();
        let same_entity = database
            .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
                observation_id: "00000000-0000-4000-8000-000000000003".into(),
                observation_run_id: "00000000-0000-4000-8000-000000000004".into(),
                entity_id: "observed.test".into(),
                connection_id: "cf-observe-2".into(),
                lease_epoch: 3,
                observed_at: "2026-08-28T00:00:01Z".into(),
                zone_name_ascii: "observed.test".into(),
                authoritative_nameservers: vec![],
                dnssec_status: "unknown".into(),
                availability: "available".into(),
                zone_status: "active".into(),
                records: vec![],
                provider_version_token: "v2".into(),
                credential_generation: 1,
                credential_scope_digest: "a".repeat(64),
                credential_zone_digest: "c".repeat(64),
                credential_public_proof: "b".repeat(64),
            })
            .unwrap();
        assert_eq!(same_entity.source_sequence, 2);
        let connection = database.store.fixture_connection();
        connection.execute("INSERT INTO domain_assets (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence) VALUES ('workspace-local','other.test','active',?1,?1,2)", [TIMESTAMP]).unwrap();
        let _ = connection;
        let new_entity = database
            .commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
                observation_id: "00000000-0000-4000-8000-000000000005".into(),
                observation_run_id: "00000000-0000-4000-8000-000000000006".into(),
                entity_id: "other.test".into(),
                connection_id: "cf-observe-2".into(),
                lease_epoch: 3,
                observed_at: "2026-08-28T00:00:02Z".into(),
                zone_name_ascii: "other.test".into(),
                authoritative_nameservers: vec![],
                dnssec_status: "unknown".into(),
                availability: "available".into(),
                zone_status: "active".into(),
                records: vec![],
                provider_version_token: "v3".into(),
                credential_generation: 1,
                credential_scope_digest: "a".repeat(64),
                credential_zone_digest: "c".repeat(64),
                credential_public_proof: "b".repeat(64),
            })
            .unwrap();
        assert_eq!(new_entity.source_sequence, 1);
    }

    fn binding_database() -> BusinessDatabase {
        let mut database = database();
        database
            .upsert_domain_asset(
                "binding-seed",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "example.com".to_owned(),
                    note: None,
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        database.seed_verified_cloudflare_binding_for_test("example.com");
        database
    }

    #[test]
    fn provider_binding_rejections_are_zero_write() {
        let cases = [
            (
                "unavailable observation",
                "UPDATE cloudflare_dns_staged_batches SET observation_availability='unavailable'",
            ),
            (
                "uncommitted observation",
                "UPDATE cloudflare_dns_staged_batches SET visibility='staged'",
            ),
            (
                "tombstoned asset",
                "UPDATE domain_assets SET lifecycle_status='archived',deleted_at='2026-08-28T00:00:00Z' WHERE entity_id='example.com'",
            ),
            (
                "wrong workspace asset",
                "UPDATE domain_assets SET workspace_id='workspace-other' WHERE entity_id='example.com'",
            ),
            (
                "inactive connection",
                "UPDATE local_provider_connections SET lifecycle_status='invalid'",
            ),
            (
                "remediation credential",
                "UPDATE local_provider_connections SET credential_use_state='remediation_required'",
            ),
            (
                "resource mismatch",
                "UPDATE cloudflare_dns_staged_batches SET zone_name_ascii='other.test'",
            ),
            (
                "zone mismatch",
                "UPDATE local_provider_connections SET active_credential_zone_digest='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
            ),
            (
                "generation mismatch",
                "UPDATE cloudflare_credential_roots SET known_envelope_generation=2,highest_resolved_generation=2,head_ledger_generation=2",
            ),
        ];
        for (label, mutation) in cases {
            let mut database = binding_database();
            // Corrupt the otherwise genuine fixture after provisioning to exercise the query filters.
            database
                .store
                .fixture_connection()
                .execute_batch(
                    "PRAGMA foreign_keys=OFF; DROP TRIGGER cloudflare_dns_staged_batch_immutable;",
                )
                .unwrap();
            database
                .store
                .fixture_connection()
                .execute_batch(mutation)
                .unwrap();
            let before = database.provider_binding_snapshot_for_test();
            assert_eq!(
                database
                    .bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(())),
                Err(BusinessDatabaseError::ProviderBindingUnavailable),
                "{label}"
            );
            assert_eq!(
                database.provider_binding_snapshot_for_test(),
                before,
                "{label}"
            );
        }
        for (allow_new, sequence_available, error) in [
            (false, true, BusinessDatabaseError::MutationStale),
            (true, false, BusinessDatabaseError::SequenceExhausted),
        ] {
            let mut database = binding_database();
            let before = database.provider_binding_snapshot_for_test();
            assert_eq!(
                database.bind_latest_cloudflare_zone(
                    "example.com",
                    allow_new,
                    sequence_available,
                    TIMESTAMP,
                    || Ok(())
                ),
                Err(error)
            );
            assert_eq!(database.provider_binding_snapshot_for_test(), before);
        }
    }

    #[test]
    fn provider_binding_commit_replay_conflict_and_fence_are_atomic() {
        let mut database = binding_database();
        let before = database.provider_binding_snapshot_for_test();
        let sequence_before: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM active_workspace_metadata",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            database.bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Err(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(database.provider_binding_snapshot_for_test(), before);
        let committed = database
            .bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(()))
            .unwrap();
        assert_eq!(committed.disposition, "committed");
        let after = database.provider_binding_snapshot_for_test();
        assert_eq!(after[0].len(), 1);
        assert_eq!(&after[2..], &before[2..]);
        let old_sequence: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT local_commit_sequence FROM domain_asset_provider_bindings",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_sequence, sequence_before + 1);
        assert_eq!(
            committed.local_commit_sequence,
            u64::try_from(old_sequence).unwrap()
        );
        let replay = database
            .bind_latest_cloudflare_zone("example.com", false, false, TIMESTAMP, || Ok(()))
            .unwrap();
        assert_eq!(replay.disposition, "replayed");
        assert_eq!(
            replay.local_commit_sequence,
            committed.local_commit_sequence
        );
        assert_eq!(database.provider_binding_snapshot_for_test(), after);
        // A matching observation does not excuse a changed immutable binding identity.
        database
            .store
            .fixture_connection()
            .execute_batch("DROP TRIGGER cloudflare_dns_staged_batch_immutable;")
            .unwrap();
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE cloudflare_dns_staged_batches SET zone_digest=?1",
                ["f".repeat(64)],
            )
            .unwrap();
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE cloudflare_credential_roots SET known_zone_digest=?1",
                ["f".repeat(64)],
            )
            .unwrap();
        database
            .store
            .fixture_connection()
            .execute(
                "UPDATE local_provider_connections SET active_credential_zone_digest=?1",
                ["f".repeat(64)],
            )
            .unwrap();
        let conflict_before = database.provider_binding_snapshot_for_test();
        assert_eq!(
            database.bind_latest_cloudflare_zone("example.com", true, true, TIMESTAMP, || Ok(())),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(
            database.provider_binding_snapshot_for_test(),
            conflict_before
        );
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the operation-plan scenario keeps its full atomic lifecycle visible in one test"
    )]
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
    fn bounded_asset_library_and_detail_read_the_bound_workspace() {
        let mut database = database();
        for (index, domain) in ["alpha.test", "beta.test"].into_iter().enumerate() {
            database
                .upsert_domain_asset(
                    &format!("read-mutation-{index}"),
                    TIMESTAMP,
                    &DomainAssetWrite {
                        entity_id: domain.to_owned(),
                        note: Some("<script>text only</script>".to_owned()),
                        portfolio_id: None,
                        tags: vec!["safe-tag".to_owned()],
                        target_price: Some(Money {
                            currency: "USD".to_owned(),
                            amount: "10.5".to_owned(),
                        }),
                    },
                )
                .unwrap();
        }
        let list = database.read_asset_library(0, 1, " ALP").unwrap();
        assert_eq!(list.total_rows, 1);
        assert_eq!(list.window.rows[0].domain, "alpha.test");
        assert_eq!(
            list.total_value,
            Some(Money {
                currency: "USD".to_owned(),
                amount: "10.5".to_owned()
            })
        );
        let detail = database.read_domain_detail("alpha.test").unwrap();
        assert_eq!(
            detail.asset.note.as_deref(),
            Some("<script>text only</script>")
        );
        assert_eq!(
            database.read_domain_detail("missing.test"),
            Err(BusinessDatabaseError::AssetNotFound)
        );
        assert_eq!(
            database.read_asset_library(0, 0, ""),
            Err(BusinessDatabaseError::WindowRejected)
        );
        assert_eq!(
            database.read_asset_library(0, 1, "bad\u{202e}"),
            Err(BusinessDatabaseError::QueryRejected)
        );
    }

    #[test]
    fn asset_library_window_uses_the_workspace_entity_index_without_a_sort() {
        let database = database();
        let mut statement = database
            .store
            .raw_connection()
            .prepare(
                "EXPLAIN QUERY PLAN
             SELECT a.entity_id FROM domain_assets a
             WHERE a.workspace_id = ?1 AND a.deleted_at IS NULL
               AND (?2 = '' OR (a.entity_id >= ?2 AND a.entity_id < ?3))
             ORDER BY a.entity_id COLLATE BINARY LIMIT ?4 OFFSET ?5",
            )
            .unwrap();
        let plan = statement
            .query_map(
                params![database.workspace_id, "alp", "alp{", 25, 0],
                |row| row.get::<_, String>(3),
            )
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(
            plan.iter()
                .any(|step| step.contains("sqlite_autoindex_domain_assets_1"))
        );
        assert!(
            !plan
                .iter()
                .any(|step| step.contains("USE TEMP B-TREE FOR ORDER BY"))
        );
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the complete claim, retry, terminal, and immutability lifecycle stays visible"
    )]
    fn sync_v2_claim_persists_canonical_digest_and_reclaims_by_new_owner() {
        let mut database = database();
        let initial = DomainAssetWrite {
            entity_id: "claim.test".to_owned(),
            note: None,
            portfolio_id: None,
            tags: vec!["initial".to_owned()],
            target_price: None,
        };
        database
            .upsert_domain_asset("seed-claim", TIMESTAMP, &initial)
            .unwrap();
        database
            .acknowledge_sync_mutation("seed-claim", 1, "2026-08-28T00:00:01Z")
            .unwrap();
        let version = database
            .read_domain_detail("claim.test")
            .unwrap()
            .asset
            .asset_version;
        let edited = DomainAssetWrite {
            note: Some("canonical note".to_owned()),
            tags: vec!["canonical".to_owned()],
            ..initial
        };
        database
            .edit_domain_asset(
                "claim-v2",
                version,
                "device-local",
                7,
                "2026-08-28T00:01:00Z",
                &edited,
                true,
            )
            .unwrap();

        let first = database
            .claim_sync_mutations_v2(
                "owner-generation-1",
                "2026-08-28T00:02:00Z",
                "2026-08-28T00:03:00Z",
                256,
            )
            .unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(
            first[0].wire_mutation_digest,
            "Aqu72459aAXWoEPGtAF3HWrcSqs4-Oz7byBPuq-C2qo"
        );
        assert!(first[0].wire_mutation_json.contains("\"schemaVersion\":2"));
        assert!(
            first[0]
                .wire_mutation_json
                .contains("\"operationKind\":\"upsert\"")
        );
        assert!(!first[0].wire_mutation_json.contains("workspaceId"));
        let local_digest: String = database
            .store
            .raw_connection()
            .query_row(
                "SELECT mutation_payload_sha256 FROM sync_outbox WHERE mutation_id='claim-v2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(first[0].wire_mutation_digest, local_digest);

        assert_eq!(
            database.defer_retryable_sync_batch_v2(
                "owner-generation-1",
                &[first[0].clone(), first[0].clone()],
                "2026-08-28T00:02:00Z",
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
        let state_after_rollback: String = database
            .store
            .raw_connection()
            .query_row(
                "SELECT state FROM sync_outbox WHERE mutation_id='claim-v2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state_after_rollback, "sending");

        database
            .defer_retryable_sync_batch_v2("owner-generation-1", &first, "2026-08-28T00:02:00Z")
            .unwrap();
        let deferred: (String, String, String) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT state,next_attempt_at,last_error_code
                 FROM sync_outbox WHERE mutation_id='claim-v2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            deferred,
            (
                "pending".to_owned(),
                "2026-08-28T00:02:02Z".to_owned(),
                "transport_retryable".to_owned()
            )
        );
        assert!(
            database
                .claim_sync_mutations_v2(
                    "owner-generation-2",
                    "2026-08-28T00:02:01Z",
                    "2026-08-28T00:03:01Z",
                    256,
                )
                .unwrap()
                .is_empty()
        );

        let second = database
            .claim_sync_mutations_v2(
                "owner-generation-2",
                "2026-08-28T00:04:00Z",
                "2026-08-28T00:05:00Z",
                256,
            )
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(
            second[0].wire_mutation_digest,
            first[0].wire_mutation_digest
        );
        assert!(second[0].delivery_attempt_fence > first[0].delivery_attempt_fence);

        database
            .reject_sync_batch_v2("owner-generation-2", &second, true)
            .unwrap();
        let terminal: (String, String, Option<String>) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT state,last_error_code,delivery_owner
                 FROM sync_outbox WHERE mutation_id='claim-v2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            terminal,
            (
                "conflicted".to_owned(),
                "sync_idempotency_conflict".to_owned(),
                None
            )
        );

        assert!(
            database
                .store
                .fixture_connection()
                .execute(
                    "UPDATE sync_outbox_fields SET field_value_json='\"tampered\"'
             WHERE workspace_id='workspace-local' AND mutation_id='claim-v2' AND field_path='note'",
                    [],
                )
                .is_err()
        );
    }

    #[test]
    fn sync_v2_claim_stops_at_the_exact_request_byte_prefix() {
        let mut database = database();
        let asset = DomainAssetWrite {
            entity_id: "bounded-prefix.test".to_owned(),
            note: None,
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        };
        database
            .upsert_domain_asset("bounded-prefix-seed", TIMESTAMP, &asset)
            .unwrap();
        database
            .acknowledge_sync_mutation("bounded-prefix-seed", 1, "2026-08-28T00:00:01Z")
            .unwrap();
        for index in 0..110_u64 {
            let version = database
                .read_domain_detail("bounded-prefix.test")
                .unwrap()
                .asset
                .asset_version;
            database
                .edit_domain_asset(
                    &format!("bounded-prefix-{index:03}"),
                    version,
                    "device-local",
                    7,
                    "2026-08-28T00:01:00Z",
                    &DomainAssetWrite {
                        note: Some(format!("{index:03}{}", "x".repeat(9_997))),
                        ..asset.clone()
                    },
                    true,
                )
                .unwrap();
        }

        let first = database
            .claim_sync_mutations_v2(
                "bounded-owner-1",
                "2026-08-28T00:02:00Z",
                "2026-08-28T00:03:00Z",
                256,
            )
            .unwrap();
        assert!(!first.is_empty());
        assert!(first.len() < 110);
        let first_wire = first
            .iter()
            .map(|mutation| mutation.wire_mutation_json.clone())
            .collect::<Vec<_>>();
        assert!(
            serialize_sync_push_request(&first_wire).unwrap().len() <= MAX_SYNC_PUSH_REQUEST_BYTES
        );
        assert!(
            serialize_sync_push_request(
                &[first_wire.clone(), vec![first_wire.last().unwrap().clone()],].concat()
            )
            .is_err()
        );
        let first_last_sequence = first.last().unwrap().device_mutation_sequence;
        assert!(
            first.windows(2).all(
                |pair| pair[1].device_mutation_sequence == pair[0].device_mutation_sequence + 1
            )
        );
        database
            .reject_sync_batch_v2("bounded-owner-1", &first, false)
            .unwrap();

        let second = database
            .claim_sync_mutations_v2(
                "bounded-owner-2",
                "2026-08-28T00:04:00Z",
                "2026-08-28T00:05:00Z",
                256,
            )
            .unwrap();
        assert_eq!(first.len() + second.len(), 110);
        assert_eq!(
            second.first().unwrap().device_mutation_sequence,
            first_last_sequence + 1
        );
        assert!(
            second
                .iter()
                .all(|mutation| mutation.delivery_attempt_fence == 1)
        );
    }

    #[test]
    #[allow(clippy::too_many_lines)]
    fn sync_delivery_commit_guards_roll_back_every_durable_stage() {
        let mut database = database();
        let initial = DomainAssetWrite {
            entity_id: "guarded-delivery.test".to_owned(),
            note: None,
            portfolio_id: None,
            tags: vec!["initial".to_owned()],
            target_price: None,
        };
        database
            .upsert_domain_asset("guard-seed", TIMESTAMP, &initial)
            .unwrap();
        database
            .acknowledge_sync_mutation("guard-seed", 1, "2026-08-28T00:00:01Z")
            .unwrap();
        let version = database
            .read_domain_detail("guarded-delivery.test")
            .unwrap()
            .asset
            .asset_version;
        database
            .edit_domain_asset(
                "guarded-delivery",
                version,
                "device-local",
                7,
                "2026-08-28T00:01:00Z",
                &DomainAssetWrite {
                    note: Some("guarded".to_owned()),
                    ..initial
                },
                true,
            )
            .unwrap();

        assert_eq!(
            database.claim_sync_mutations_v2_guarded(
                "guard-owner",
                "2026-08-28T00:02:00Z",
                "2026-08-28T00:03:00Z",
                256,
                || Err(BusinessDatabaseError::MutationStale),
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            database
                .test_sync_delivery_state("guarded-delivery")
                .unwrap(),
            ("pending".to_owned(), 0, None, None)
        );

        let claimed = database
            .claim_sync_mutations_v2_guarded(
                "guard-owner",
                "2026-08-28T00:02:00Z",
                "2026-08-28T00:03:00Z",
                256,
                || Ok(()),
            )
            .unwrap();
        let acknowledgement = SyncMutationAcknowledgement {
            mutation_id: claimed[0].mutation_id.clone(),
            source_device_id: claimed[0].source_device_id.clone(),
            active_lease_epoch: claimed[0].active_lease_epoch,
            device_mutation_sequence: claimed[0].device_mutation_sequence,
            delivery_attempt_fence: claimed[0].delivery_attempt_fence,
            wire_mutation_digest: claimed[0].wire_mutation_digest.clone(),
            server_revision: 2,
        };
        assert_eq!(
            database.acknowledge_sync_batch_v2_guarded(
                "guard-owner",
                std::slice::from_ref(&acknowledgement),
                "2026-08-28T00:02:01Z",
                |_| Err(BusinessDatabaseError::MutationStale),
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            database.defer_retryable_sync_batch_v2_guarded(
                "guard-owner",
                &claimed,
                "2026-08-28T00:02:01Z",
                || Err(BusinessDatabaseError::MutationStale),
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            database.reject_sync_batch_v2_guarded("guard-owner", &claimed, false, |_| Err(
                BusinessDatabaseError::MutationStale
            ),),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            database
                .test_sync_delivery_state("guarded-delivery")
                .unwrap(),
            (
                "sending".to_owned(),
                1,
                Some("guard-owner".to_owned()),
                Some(1),
            )
        );

        assert_eq!(
            database.mark_sync_rebootstrap_required_v2_guarded("device-local", |_| {
                Err(BusinessDatabaseError::MutationStale)
            }),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert!(
            database
                .read_sync_pull_request_v2("device-local", 64)
                .is_ok()
        );
    }

    #[test]
    fn canonical_sync_v2_digest_ignores_object_key_order_and_json_whitespace() {
        let left: serde_json::Value = serde_json::from_str(
            r#"{"schemaVersion":2,"mutationId":"m","operationKind":"upsert"}"#,
        )
        .unwrap();
        let right: serde_json::Value = serde_json::from_str(
            " { \"operationKind\" : \"upsert\", \"mutationId\" : \"m\", \"schemaVersion\" : 2 } ",
        )
        .unwrap();
        assert_eq!(
            canonical_sync_digest(&left).unwrap(),
            canonical_sync_digest(&right).unwrap()
        );
    }

    fn test_sync_page(revision: u64, note: &str) -> String {
        let mut page = serde_json::json!({
            "schemaVersion": 2,
            "workspaceId": "workspace-local",
            "fromServerRevisionExclusive": revision - 1,
            "throughServerRevisionInclusive": revision,
            "mutations": [{
                "schemaVersion": 2,
                "mutationId": format!("remote-{revision}"),
                "workspaceId": "workspace-local",
                "workspaceSchemaVersion": 1,
                "entityType": "domain_asset",
                "entityId": "remote.test",
                "operationKind": "upsert",
                "baseServerRevision": revision - 1,
                "changedFields": [{"fieldPath": "note", "value": note}],
                "sourceDeviceId": "cloud-device",
                "activeLeaseEpoch": 1,
                "deviceMutationSequence": revision,
                "serverRevision": revision,
            }],
            "returnedThroughServerRevision": revision,
            "nextCursor": null,
            "pageDigest": "A".repeat(43),
        });
        let digest = canonical_page_digest(&page).unwrap();
        page["pageDigest"] = serde_json::Value::String(digest);
        page.to_string()
    }

    fn seed_rebootstrap_floor_guard_evidence(database: &mut BusinessDatabase) {
        database
            .upsert_domain_asset(
                "local-pending-before-floor-guard",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("retain local".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let mut page = serde_json::json!({
            "schemaVersion":2,"workspaceId":"workspace-local","fromServerRevisionExclusive":0,
            "throughServerRevisionInclusive":1,"mutations":[{"schemaVersion":2,
            "mutationId":"remote-delete-floor-guard","workspaceId":"workspace-local",
            "workspaceSchemaVersion":1,"entityType":"domain_asset","entityId":"remote.test",
            "operationKind":"delete","deletedAt":"2026-08-28T00:00:00Z",
            "baseServerRevision":0,"changedFields":[],"sourceDeviceId":"cloud-device",
            "activeLeaseEpoch":1,"deviceMutationSequence":1,"serverRevision":1}],
            "returnedThroughServerRevision":1,"nextCursor":null,"pageDigest":"A".repeat(43)
        });
        page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());
        database
            .apply_sync_page_v2("reader-local", &page.to_string(), "confirm-floor-guard")
            .unwrap();
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RebootstrapFloorGuardOracle {
        proof: DatabaseRecoveryProof,
        evidence_counts: (i64, i64, i64, i64, i64),
        #[expect(
            clippy::type_complexity,
            reason = "the test oracle preserves the exact durable reader-state row shape"
        )]
        reader_state: Vec<(String, i64, Option<i64>, Option<i64>, i64, i64, i64, String)>,
    }

    fn rebootstrap_floor_guard_oracle(database: &BusinessDatabase) -> RebootstrapFloorGuardOracle {
        let evidence_counts = database
            .store
            .raw_connection()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM sync_outbox WHERE workspace_id='workspace-local'),
                   (SELECT count(*) FROM sync_conflicts WHERE workspace_id='workspace-local'),
                   (SELECT count(*) FROM sync_tombstones WHERE workspace_id='workspace-local'),
                   (SELECT count(*) FROM sync_inbox WHERE workspace_id='workspace-local'),
                   (SELECT count(*) FROM sync_rebootstrap_journal WHERE workspace_id='workspace-local')",
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
        let mut statement = database
            .store
            .raw_connection()
            .prepare(
                "SELECT device_id,read_through_server_revision,pinned_target_server_revision,
                        checkpoint_through_server_revision,anti_rollback_server_revision_floor,
                        anti_rollback_schema_version_floor,row_version,status
                 FROM sync_reader_state WHERE workspace_id='workspace-local' ORDER BY device_id",
            )
            .unwrap();
        let reader_state = statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        RebootstrapFloorGuardOracle {
            proof: database.recovery_proof().unwrap(),
            evidence_counts,
            reader_state,
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RebootstrapCorruptionOracle {
        row_digest: String,
        journal_count: i64,
        temp_checkpoint_table_count: i64,
        total_changes: u64,
        is_autocommit: bool,
        database_bytes: Vec<u8>,
        sidecar_bytes: [Option<Vec<u8>>; 3],
    }

    fn rebootstrap_corruption_oracle(database: &BusinessDatabase) -> RebootstrapCorruptionOracle {
        let connection = database.store.raw_connection();
        let database_path: String = connection
            .query_row(
                "SELECT file FROM pragma_database_list WHERE name='main'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let database_path = std::path::PathBuf::from(database_path);
        let read_sidecar = |suffix: &str| {
            let mut path = database_path.as_os_str().to_os_string();
            path.push(suffix);
            match std::fs::read(path) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => panic!("failed to snapshot SQLite sidecar: {error}"),
            }
        };
        RebootstrapCorruptionOracle {
            row_digest: complete_database_digest(connection).unwrap(),
            journal_count: connection
                .query_row("SELECT count(*) FROM sync_rebootstrap_journal", [], |row| {
                    row.get(0)
                })
                .unwrap(),
            temp_checkpoint_table_count: connection
                .query_row(
                    "SELECT count(*) FROM sqlite_temp_schema
                     WHERE type='table' AND name='temp_checkpoint_entities'",
                    [],
                    |row| row.get(0),
                )
                .unwrap(),
            total_changes: connection.total_changes(),
            is_autocommit: connection.is_autocommit(),
            database_bytes: std::fs::read(&database_path).unwrap(),
            sidecar_bytes: [
                read_sidecar("-wal"),
                read_sidecar("-shm"),
                read_sidecar("-journal"),
            ],
        }
    }

    fn relax_strict_table_for_corruption(connection: &Connection, table_name: &str) {
        let schema_version: i64 = connection
            .pragma_query_value(None, "schema_version", |row| row.get(0))
            .unwrap();
        let table_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?1",
                [table_name],
                |row| row.get(0),
            )
            .unwrap();
        let relaxed_table_sql = table_sql
            .strip_suffix(" STRICT")
            .expect("fixture table remains STRICT");
        connection
            .execute_batch("PRAGMA writable_schema=ON;")
            .unwrap();
        connection
            .execute(
                "UPDATE sqlite_schema SET sql=?1 WHERE type='table' AND name=?2",
                params![relaxed_table_sql, table_name],
            )
            .unwrap();
        connection
            .execute_batch("PRAGMA writable_schema=OFF;")
            .unwrap();
        connection
            .pragma_update(None, "schema_version", schema_version + 1)
            .unwrap();
    }

    #[test]
    fn sync_v2_page_apply_is_atomic_and_exactly_replayable() {
        let mut database = database();
        let page = test_sync_page(1, "remote value");
        database
            .apply_sync_page_v2("reader-local", &page, "confirm-1")
            .unwrap();
        assert_eq!(database.current_server_revision().unwrap(), 1);
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("remote value")
        );
        let inbox_count: i64 = database
            .store
            .raw_connection()
            .query_row("SELECT count(*) FROM sync_inbox", [], |row| row.get(0))
            .unwrap();
        assert_eq!(inbox_count, 1);
        database
            .apply_sync_page_v2("reader-local", &page, "confirm-1")
            .unwrap();
        let tampered = page.replacen("remote value", "tampered", 1);
        assert_eq!(
            database.apply_sync_page_v2("reader-local", &tampered, "confirm-1"),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(database.current_server_revision().unwrap(), 1);
    }

    #[test]
    fn sync_v3_persists_conflict_before_cursor_and_keeps_local_value() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "local-pending",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("local".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let page = test_sync_page(1, "remote");
        database
            .apply_sync_page_v2("reader-local", &page, "confirm")
            .unwrap();
        let candidates = database.read_sync_conflicts(10).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].field_path, "note");
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("local")
        );
        assert_eq!(database.current_server_revision().unwrap(), 1);
    }

    #[test]
    fn sync_v3_remote_delete_conflict_is_contested_and_keep_local_is_rejected() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "local-pending-delete",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("local".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let mut page = serde_json::json!({
            "schemaVersion":2,"workspaceId":"workspace-local","fromServerRevisionExclusive":0,
            "throughServerRevisionInclusive":1,"mutations":[{"schemaVersion":2,"mutationId":"remote-delete",
            "workspaceId":"workspace-local","workspaceSchemaVersion":1,"entityType":"domain_asset",
            "entityId":"remote.test","operationKind":"delete","deletedAt":"2026-08-28T00:00:00Z",
            "baseServerRevision":0,"changedFields":[],"sourceDeviceId":"cloud-device","activeLeaseEpoch":1,
            "deviceMutationSequence":1,"serverRevision":1}],"returnedThroughServerRevision":1,"nextCursor":null,
            "pageDigest":"A".repeat(43)
        });
        page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());
        database
            .apply_sync_page_v2("reader-local", &page.to_string(), "confirm")
            .unwrap();
        let candidates = database.read_sync_conflicts(10).unwrap();
        assert_eq!(candidates[0].field_path, "lifecycleStatus");
        let barrier: String = database
            .store
            .raw_connection()
            .query_row(
                "SELECT barrier_state FROM sync_tombstones WHERE entity_id='remote.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(barrier, "contested");
        assert_eq!(
            database.resolve_sync_conflict(
                "r1",
                &candidates[0].conflict_id,
                1,
                1,
                1,
                &candidates[0].local_value_hash,
                "keep_local",
                "device-local",
                1,
                TIMESTAMP
            ),
            Err(BusinessDatabaseError::MutationConflict)
        );
    }

    #[test]
    fn sync_v3_accept_remote_is_local_only_and_exactly_replayable() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "local-pending-accept",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("local".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let page = test_sync_page(1, "remote");
        database
            .apply_sync_page_v2("reader-local", &page, "confirm")
            .unwrap();
        let candidate = database.read_sync_conflicts(10).unwrap().remove(0);
        let before_outbox: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM sync_outbox WHERE workspace_id='workspace-local'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let receipt = database
            .resolve_sync_conflict(
                "resolution-accept",
                &candidate.conflict_id,
                1,
                candidate.candidate_version,
                candidate.remote_server_revision,
                &candidate.local_value_hash,
                "accept_remote",
                "device-local",
                1,
                TIMESTAMP,
            )
            .unwrap();
        assert_eq!(receipt.outbox_mutation_id, None);
        let after_outbox: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM sync_outbox WHERE workspace_id='workspace-local'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before_outbox, after_outbox);
        let replay = database
            .resolve_sync_conflict(
                "resolution-accept",
                &candidate.conflict_id,
                1,
                candidate.candidate_version,
                candidate.remote_server_revision,
                &candidate.local_value_hash,
                "accept_remote",
                "device-local",
                1,
                TIMESTAMP,
            )
            .unwrap();
        assert_eq!(replay, receipt);
    }

    #[test]
    fn sync_v2_page_apply_rejects_gaps_without_partial_inbox_or_projection() {
        let mut database = database();
        let gap = test_sync_page(2, "gap");
        assert_eq!(
            database.apply_sync_page_v2("reader-local", &gap, "confirm-gap"),
            Err(BusinessDatabaseError::RevisionRejected)
        );
        assert_eq!(database.current_server_revision().unwrap(), 0);
        assert!(database.read_portfolio().unwrap().domains.is_empty());
        let inbox_count: i64 = database
            .store
            .raw_connection()
            .query_row("SELECT count(*) FROM sync_inbox", [], |row| row.get(0))
            .unwrap();
        assert_eq!(inbox_count, 0);
    }

    #[test]
    fn sync_v2_poisoned_page_rolls_back_earlier_mutation_and_reader_proof() {
        let mutation = |revision: u64, note: &str| {
            serde_json::json!({
                "schemaVersion": 2,
                "mutationId": "duplicate-in-page",
                "workspaceId": "workspace-local",
                "workspaceSchemaVersion": 1,
                "entityType": "domain_asset",
                "entityId": format!("remote-{revision}.test"),
                "operationKind": "upsert",
                "baseServerRevision": revision - 1,
                "changedFields": [{"fieldPath": "note", "value": note}],
                "sourceDeviceId": "cloud-device",
                "activeLeaseEpoch": 1,
                "deviceMutationSequence": revision,
                "serverRevision": revision,
            })
        };
        let mut page = serde_json::json!({
            "schemaVersion": 2,
            "workspaceId": "workspace-local",
            "fromServerRevisionExclusive": 0,
            "throughServerRevisionInclusive": 2,
            "mutations": [mutation(1, "first"), mutation(2, "poison")],
            "returnedThroughServerRevision": 2,
            "nextCursor": null,
            "pageDigest": "A".repeat(43),
        });
        page["pageDigest"] = serde_json::Value::String(canonical_page_digest(&page).unwrap());

        let mut database = database();
        assert_eq!(
            database.apply_sync_page_v2("reader-local", &page.to_string(), "confirm-poison"),
            Err(BusinessDatabaseError::StorageRejected)
        );
        assert_eq!(database.current_server_revision().unwrap(), 0);
        assert!(database.read_portfolio().unwrap().domains.is_empty());
        let counts: (i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT (SELECT count(*) FROM sync_inbox),
                        (SELECT count(*) FROM sync_reader_state)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (0, 0));
    }

    #[test]
    fn sync_v2_compacted_behind_stops_pull_without_deleting_local_authority() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "local-before-rebootstrap",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "local.test".to_owned(),
                    note: Some("retain me".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        database
            .mark_sync_rebootstrap_required_v2("reader-local")
            .unwrap();
        assert_eq!(
            database.read_sync_pull_request_v2("reader-local", 256),
            Err(BusinessDatabaseError::RevisionRejected)
        );
        assert_eq!(
            database.apply_sync_page_v2(
                "reader-local",
                &test_sync_page(1, "must not apply"),
                "confirm-closed"
            ),
            Err(BusinessDatabaseError::RevisionRejected)
        );
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("retain me")
        );
        assert_eq!(database.test_pending_sync_rows(10).unwrap().len(), 1);
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the table-driven test keeps every incompatible floor and its zero-write assertion together"
    )]
    fn rebootstrap_checkpoint_rejects_every_incompatible_floor_without_writing() {
        for floor in [
            "applied",
            "read-through",
            "pinned-target",
            "checkpoint-through",
            "anti-rollback",
            "anti-schema",
        ] {
            let mut database = database();
            seed_rebootstrap_floor_guard_evidence(&mut database);
            match floor {
                "applied" => {
                    database
                        .store
                        .raw_connection()
                        .execute(
                            "UPDATE active_workspace_metadata
                             SET applied_through_server_revision=7 WHERE singleton=1",
                            [],
                        )
                        .unwrap();
                }
                "read-through" => {
                    database
                        .store
                        .raw_connection()
                        .execute(
                            "UPDATE sync_reader_state
                             SET read_through_server_revision=7,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "pinned-target" => {
                    database
                        .store
                        .raw_connection()
                        .execute(
                            "UPDATE sync_reader_state
                             SET pinned_target_server_revision=7,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "checkpoint-through" => {
                    database
                        .store
                        .raw_connection()
                        .execute(
                            "UPDATE sync_reader_state
                             SET checkpoint_id='checkpoint-7',checkpoint_through_server_revision=7,
                                 row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "anti-rollback" => {
                    database
                        .store
                        .raw_connection()
                        .execute(
                            "UPDATE sync_reader_state
                             SET anti_rollback_server_revision_floor=7,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "anti-schema" => {
                    database
                        .store
                        .raw_connection()
                        .execute(
                            "UPDATE sync_reader_state
                             SET anti_rollback_schema_version_floor=3,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                _ => unreachable!(),
            }
            let before = rebootstrap_floor_guard_oracle(&database);
            assert_eq!(before.evidence_counts, (1, 1, 1, 1, 0));

            let rejected =
                database.install_rebootstrap_checkpoint(&[], 6, "reader-local", |proof| {
                    Ok(journal_link(proof, 1))
                });

            assert_eq!(
                rejected,
                Err(BusinessDatabaseError::RevisionRejected),
                "floor={floor}"
            );
            assert_eq!(
                rebootstrap_floor_guard_oracle(&database),
                before,
                "floor={floor}"
            );
        }
    }

    #[test]
    fn rebootstrap_checkpoint_rejects_workspace_binding_drift_without_writing() {
        let mut database = database();
        seed_rebootstrap_floor_guard_evidence(&mut database);
        let before = rebootstrap_floor_guard_oracle(&database);
        database.workspace_id = "other-workspace".to_owned();

        let rejected = database.install_rebootstrap_checkpoint(&[], 7, "reader-local", |proof| {
            Ok(journal_link(proof, 1))
        });

        assert_eq!(rejected, Err(BusinessDatabaseError::WorkspaceRejected));
        database.workspace_id = "workspace-local".to_owned();
        assert_eq!(rebootstrap_floor_guard_oracle(&database), before);
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the table-driven test keeps every negative floor and its zero-write assertion together"
    )]
    fn rebootstrap_checkpoint_rejects_every_negative_floor_without_writing() {
        for floor in [
            "applied",
            "read-through",
            "pinned-target",
            "checkpoint-through",
            "anti-rollback",
            "anti-schema",
        ] {
            let mut database = database();
            seed_rebootstrap_floor_guard_evidence(&mut database);
            let connection = database.store.raw_connection();
            connection
                .execute_batch("PRAGMA ignore_check_constraints=ON;")
                .unwrap();
            if matches!(floor, "anti-rollback" | "anti-schema") {
                connection
                    .execute_batch("DROP TRIGGER sync_reader_state_v3_floor_monotonic;")
                    .unwrap();
            }
            match floor {
                "applied" => {
                    connection
                        .execute(
                            "UPDATE active_workspace_metadata
                             SET applied_through_server_revision=-1 WHERE singleton=1",
                            [],
                        )
                        .unwrap();
                }
                "read-through" => {
                    connection
                        .execute(
                            "UPDATE sync_reader_state
                             SET read_through_server_revision=-1,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "pinned-target" => {
                    connection
                        .execute(
                            "UPDATE sync_reader_state
                             SET pinned_target_server_revision=-1,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "checkpoint-through" => {
                    connection
                        .execute(
                            "UPDATE sync_reader_state
                             SET checkpoint_id='corrupt-checkpoint',
                                 checkpoint_through_server_revision=-1,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "anti-rollback" => {
                    connection
                        .execute(
                            "UPDATE sync_reader_state
                             SET anti_rollback_server_revision_floor=-1,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                "anti-schema" => {
                    connection
                        .execute(
                            "UPDATE sync_reader_state
                             SET anti_rollback_schema_version_floor=-1,row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                _ => unreachable!(),
            }
            connection
                .execute_batch("PRAGMA ignore_check_constraints=OFF;")
                .unwrap();
            let before = rebootstrap_corruption_oracle(&database);
            assert_eq!(before.temp_checkpoint_table_count, 0);

            let rejected =
                database.install_rebootstrap_checkpoint(&[], 7, "reader-local", |proof| {
                    Ok(journal_link(proof, 1))
                });

            assert_eq!(
                rejected,
                Err(BusinessDatabaseError::RevisionRejected),
                "floor={floor}"
            );
            assert_eq!(
                rebootstrap_corruption_oracle(&database),
                before,
                "floor={floor}"
            );
        }
    }

    #[test]
    fn rebootstrap_checkpoint_rejects_missing_metadata_singleton_without_writing() {
        let mut database = database();
        let connection = database.store.raw_connection();
        connection
            .execute_batch("DROP TRIGGER active_workspace_metadata_no_delete;")
            .unwrap();
        connection
            .execute(
                "DELETE FROM active_workspace_metadata WHERE singleton=1",
                [],
            )
            .unwrap();
        let before = rebootstrap_corruption_oracle(&database);
        assert_eq!(before.temp_checkpoint_table_count, 0);

        let rejected = database.install_rebootstrap_checkpoint(&[], 1, "reader-local", |proof| {
            Ok(journal_link(proof, 1))
        });

        assert_eq!(rejected, Err(BusinessDatabaseError::StorageRejected));
        assert_eq!(rebootstrap_corruption_oracle(&database), before);
    }

    #[test]
    fn rebootstrap_checkpoint_rejects_non_integer_floors_without_writing() {
        for source in ["metadata-applied", "reader-aggregate"] {
            let mut database = database();
            seed_rebootstrap_floor_guard_evidence(&mut database);
            let connection = database.store.raw_connection();
            connection
                .execute_batch("PRAGMA ignore_check_constraints=ON;")
                .unwrap();
            match source {
                "metadata-applied" => {
                    relax_strict_table_for_corruption(connection, "active_workspace_metadata");
                    connection
                        .execute(
                            "UPDATE active_workspace_metadata
                             SET applied_through_server_revision='corrupt' WHERE singleton=1",
                            [],
                        )
                        .unwrap();
                }
                "reader-aggregate" => {
                    relax_strict_table_for_corruption(connection, "sync_reader_state");
                    connection
                        .execute(
                            "UPDATE sync_reader_state
                             SET pinned_target_server_revision='corrupt',row_version=row_version+1
                             WHERE workspace_id='workspace-local' AND device_id='reader-local'",
                            [],
                        )
                        .unwrap();
                }
                _ => unreachable!(),
            }
            connection
                .execute_batch("PRAGMA ignore_check_constraints=OFF;")
                .unwrap();
            let before = rebootstrap_corruption_oracle(&database);
            assert_eq!(before.temp_checkpoint_table_count, 0);

            let rejected =
                database.install_rebootstrap_checkpoint(&[], 7, "reader-local", |proof| {
                    Ok(journal_link(proof, 1))
                });

            assert_eq!(
                rejected,
                Err(BusinessDatabaseError::StorageRejected),
                "source={source}"
            );
            assert_eq!(
                rebootstrap_corruption_oracle(&database),
                before,
                "source={source}"
            );
        }
    }

    #[test]
    fn stale_checkpoint_cannot_be_hidden_by_later_replay_and_is_zero_write() {
        let mut database = database();
        for revision in 1..=7 {
            database
                .apply_sync_page_v2(
                    "reader-local",
                    &test_sync_page(revision, &format!("remote {revision}")),
                    &format!("confirm-{revision}"),
                )
                .unwrap();
        }
        let before = rebootstrap_floor_guard_oracle(&database);
        assert_eq!(before.proof.applied_server_revision, 7);
        assert_eq!(before.evidence_counts, (0, 0, 0, 7, 0));
        let journal_called = std::cell::Cell::new(false);
        let fence_called = std::cell::Cell::new(false);
        let replay = RebootstrapReplayPage {
            // This page is byte-equivalent to the already retained revision-7 inbox record.
            // Without the baseline floor gate it would be treated as idempotent and skip the
            // projection overwritten by the stale checkpoint.
            page_json: test_sync_page(7, "remote 7"),
            confirmation_token: "confirm-7".to_owned(),
        };

        let rejected = database.install_rebootstrap_plan_guarded(
            &[],
            6,
            "reader-local",
            &[replay],
            |proof| {
                journal_called.set(true);
                Ok(journal_link(proof, 1))
            },
            || {
                fence_called.set(true);
                Ok(())
            },
        );

        assert_eq!(rejected, Err(BusinessDatabaseError::RevisionRejected));
        assert!(!journal_called.get());
        assert!(!fence_called.get());
        assert_eq!(rebootstrap_floor_guard_oracle(&database), before);
    }

    #[test]
    fn newer_checkpoint_preserves_local_authority_while_advancing_all_revision_floors() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "local-before-newer-checkpoint",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "local.test".to_owned(),
                    note: Some("local authority".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();

        database
            .install_rebootstrap_checkpoint(
                &[DomainAssetWrite {
                    entity_id: "local.test".to_owned(),
                    note: Some("remote checkpoint".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                }],
                7,
                "reader-local",
                |proof| Ok(journal_link(proof, 1)),
            )
            .unwrap();

        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("local authority")
        );
        assert_eq!(database.test_pending_sync_rows(10).unwrap().len(), 1);
        assert!(!database.read_sync_conflicts(10).unwrap().is_empty());
        let floors: (i64, i64, Option<i64>, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT m.applied_through_server_revision,r.read_through_server_revision,
                        r.pinned_target_server_revision,r.anti_rollback_server_revision_floor
                 FROM active_workspace_metadata m JOIN sync_reader_state r
                   ON r.workspace_id=m.workspace_id
                 WHERE m.singleton=1 AND r.device_id='reader-local'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(floors, (7, 7, Some(7), 7));
    }

    #[test]
    fn rebootstrap_checkpoint_creates_remote_roots_and_preserves_omitted_local_state() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "local-before-rebootstrap",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "local.test".to_owned(),
                    note: Some("pending local".to_owned()),
                    portfolio_id: None,
                    tags: vec!["local".to_owned()],
                    target_price: None,
                },
            )
            .unwrap();
        database
            .install_rebootstrap_checkpoint(
                &[DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("checkpoint".to_owned()),
                    portfolio_id: None,
                    tags: vec!["remote".to_owned()],
                    target_price: Some(Money {
                        currency: "USD".to_owned(),
                        amount: "42".to_owned(),
                    }),
                }],
                7,
                "reader-local",
                |_| {
                    Ok(RebootstrapJournalLink {
                        journal_id: "journal-checkpoint".to_owned(),
                        slot_id: RebootstrapSlotId::A,
                        publication_sequence: 1,
                        manifest_digest: "a".repeat(64),
                        authority_digest: "b".repeat(64),
                        floor_digest: "c".repeat(64),
                        binding_digest: "d".repeat(64),
                    })
                },
            )
            .unwrap();

        let snapshot = database.read_portfolio().unwrap();
        assert_eq!(snapshot.applied_through_server_revision, 7);
        assert_eq!(
            snapshot
                .domains
                .iter()
                .map(|row| row.entity_id.as_str())
                .collect::<Vec<_>>(),
            vec!["local.test", "remote.test"]
        );
        let (root, desired, tags, reader): (i64, i64, i64, i64) = database
            .store
            .raw_connection()
            .query_row(
                "SELECT
                   (SELECT count(*) FROM domain_assets
                    WHERE workspace_id='workspace-local' AND entity_id='remote.test'
                      AND lifecycle_status='active'),
                   (SELECT count(*) FROM domain_asset_desired_state
                    WHERE workspace_id='workspace-local' AND entity_id='remote.test'),
                   (SELECT count(*) FROM domain_asset_tags
                    WHERE workspace_id='workspace-local' AND entity_id='remote.test' AND tag='remote'),
                   (SELECT count(*) FROM sync_reader_state
                    WHERE workspace_id='workspace-local' AND device_id='reader-local'
                      AND read_through_server_revision=7 AND status='active')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!((root, desired, tags, reader), (1, 1, 1, 1));
        assert_eq!(database.test_pending_sync_rows(10).unwrap().len(), 1);
    }

    #[test]
    fn rebootstrap_checkpoint_journal_failure_rolls_back_projection() {
        let mut database = database();
        let link = RebootstrapJournalLink {
            journal_id: "journal-a".to_owned(),
            slot_id: RebootstrapSlotId::A,
            publication_sequence: 1,
            manifest_digest: "a".repeat(64),
            authority_digest: "b".repeat(64),
            floor_digest: "c".repeat(64),
            binding_digest: "d".repeat(64),
        };
        database
            .install_rebootstrap_checkpoint_guarded(
                &[DomainAssetWrite {
                    entity_id: "first.test".to_owned(),
                    note: Some("one".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                }],
                1,
                "reader-local",
                |_| Ok(link.clone()),
                || Ok(()),
            )
            .unwrap();
        let error = database.install_rebootstrap_checkpoint_guarded(
            &[DomainAssetWrite {
                entity_id: "second.test".to_owned(),
                note: Some("two".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            }],
            2,
            "reader-local",
            |_| Ok(link.clone()),
            || Ok(()),
        );
        assert!(error.is_err());
        let count: i64 = database
            .store
            .raw_connection()
            .query_row(
                "SELECT count(*) FROM domain_assets WHERE entity_id='second.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn resolving_after_local_projection_change_is_stale_and_zero_write() {
        let mut database = database();
        database
            .upsert_domain_asset(
                "local-seed",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("local".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let page = test_sync_page(1, "remote");
        database
            .apply_sync_page_v2("reader-local", &page, "confirm")
            .unwrap();
        let candidate = database.read_sync_conflicts(10).unwrap().remove(0);
        database
            .upsert_domain_asset(
                "local-change",
                TIMESTAMP,
                &DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("changed".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                },
            )
            .unwrap();
        let result = database.resolve_sync_conflict(
            "resolution-stale",
            &candidate.conflict_id,
            1,
            candidate.candidate_version,
            candidate.remote_server_revision,
            &candidate.local_value_hash,
            "accept_remote",
            "device-local",
            1,
            TIMESTAMP,
        );
        assert_eq!(result, Err(BusinessDatabaseError::MutationStale));
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("changed")
        );
    }

    fn journal_link(proof: &DatabaseRecoveryProof, sequence: u64) -> RebootstrapJournalLink {
        RebootstrapJournalLink {
            journal_id: format!("journal-{sequence}"),
            slot_id: if sequence.is_multiple_of(2) {
                RebootstrapSlotId::B
            } else {
                RebootstrapSlotId::A
            },
            publication_sequence: sequence,
            manifest_digest: proof.row_digest.clone(),
            authority_digest: "a".repeat(64),
            floor_digest: "b".repeat(64),
            binding_digest: "c".repeat(64),
        }
    }

    #[cfg(unix)]
    fn prepared_read_only_recovery_candidate() -> (
        tempfile::TempDir,
        std::path::PathBuf,
        LocalDatabaseKey,
        DatabaseRecoveryProof,
        RebootstrapJournalLink,
    ) {
        let directory = tempdir().unwrap();
        let path = directory.path().join("candidate.db");
        let key = LocalDatabaseKey::from_bytes([0x6c; 32]);
        let (proof, link) = {
            let mut database = BusinessDatabase::open(&path, &key, "workspace-recovery").unwrap();
            let result = database
                .install_rebootstrap_checkpoint(
                    &[DomainAssetWrite {
                        entity_id: "recovered.test".to_owned(),
                        note: Some("durable".to_owned()),
                        portfolio_id: None,
                        tags: vec!["recovery".to_owned()],
                        target_price: None,
                    }],
                    7,
                    "device-recovery",
                    |proof| Ok(journal_link(proof, 1)),
                )
                .unwrap();
            database.prepare_rebootstrap_publication().unwrap();
            assert_eq!(database.recovery_proof().unwrap(), result.0);
            result
        };
        (directory, path, key, proof, link)
    }

    #[cfg(unix)]
    fn recovery_candidate_file_state(
        path: &Path,
    ) -> ([u8; 32], u64, std::time::SystemTime, [bool; 3]) {
        let bytes = std::fs::read(path).unwrap();
        let metadata = std::fs::metadata(path).unwrap();
        let file_name = path.file_name().unwrap().to_string_lossy();
        let parent = path.parent().unwrap();
        (
            Sha256::digest(bytes).into(),
            metadata.len(),
            metadata.modified().unwrap(),
            [
                parent.join(format!("{file_name}-wal")).exists(),
                parent.join(format!("{file_name}-shm")).exists(),
                parent.join(format!("{file_name}-journal")).exists(),
            ],
        )
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_bound_clean_start_verification_is_read_only_and_exact() {
        let (_directory, path, key, expected_proof, _link) =
            prepared_read_only_recovery_candidate();
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);
        assert_eq!(before.3, [false, false, false]);

        let actual =
            verify_clean_start_database_read_only(&retained, &key, "workspace-recovery", 1)
                .unwrap();

        assert_eq!(actual, expected_proof);
        assert_eq!(recovery_candidate_file_state(&path), before);
        let connection = open_descriptor_bound_database_read_only(&retained, &key).unwrap();
        let memory_security: String = connection
            .query_row("PRAGMA cipher_memory_security", [], |row| row.get(0))
            .unwrap();
        assert_eq!(memory_security, "0");
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_bound_clean_start_rejection_is_zero_write() {
        let (_directory, path, key, _expected_proof, _link) =
            prepared_read_only_recovery_candidate();
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);

        assert_eq!(
            verify_clean_start_database_read_only(&retained, &key, "other-workspace", 1),
            Err(BusinessDatabaseError::WorkspaceRejected)
        );
        assert_eq!(recovery_candidate_file_state(&path), before);

        assert_eq!(
            verify_clean_start_database_read_only(&retained, &key, "workspace-recovery", 2,),
            Err(BusinessDatabaseError::SchemaRejected)
        );
        assert_eq!(recovery_candidate_file_state(&path), before);

        let wrong_key = LocalDatabaseKey::from_bytes([0x6d; 32]);
        assert_eq!(
            verify_clean_start_database_read_only(&retained, &wrong_key, "workspace-recovery", 1,),
            Err(BusinessDatabaseError::StorageRejected)
        );
        assert_eq!(recovery_candidate_file_state(&path), before);
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_bound_clean_start_rejects_schema_drift_without_writing() {
        let (_directory, path, key, _expected_proof, _link) =
            prepared_read_only_recovery_candidate();
        {
            let mut database = BusinessDatabase::open_existing_derived(&path, &key).unwrap();
            database
                .store
                .fixture_connection()
                .execute_batch(
                    "CREATE TABLE unexpected_schema_drift (
                       id INTEGER PRIMARY KEY
                     ) STRICT;",
                )
                .unwrap();
            database.prepare_rebootstrap_publication().unwrap();
        }
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);
        assert_eq!(before.3, [false, false, false]);

        assert_eq!(
            verify_clean_start_database_read_only(&retained, &key, "workspace-recovery", 1,),
            Err(BusinessDatabaseError::SchemaRejected)
        );
        assert_eq!(recovery_candidate_file_state(&path), before);
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_bound_recovery_verification_is_read_only_and_exact() {
        let (_directory, path, key, expected_proof, link) = prepared_read_only_recovery_candidate();
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);
        assert_eq!(before.3, [false, false, false]);

        let actual =
            verify_rebootstrap_recovery_read_only(&retained, &key, "workspace-recovery", &link)
                .unwrap();

        assert_eq!(actual, expected_proof);
        assert_eq!(recovery_candidate_file_state(&path), before);
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_bound_terminal_publication_verifies_optional_link_on_one_read_only_connection() {
        let (_directory, path, key, expected_proof, link) = prepared_read_only_recovery_candidate();
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);

        let linked = verify_terminal_publication_database_read_only(
            &retained,
            &key,
            "workspace-recovery",
            1,
            Some(&link),
        )
        .unwrap();
        let without_link_expectation = verify_terminal_publication_database_read_only(
            &retained,
            &key,
            "workspace-recovery",
            1,
            None,
        )
        .unwrap();

        assert_eq!(linked, expected_proof);
        assert_eq!(without_link_expectation, expected_proof);
        assert_eq!(recovery_candidate_file_state(&path), before);
    }

    #[cfg(unix)]
    #[test]
    fn terminal_publication_returns_current_proof_without_comparing_historical_manifest_digest() {
        let (_directory, path, key, old_proof, link) = prepared_read_only_recovery_candidate();
        {
            let mut database = BusinessDatabase::open_existing_derived(&path, &key).unwrap();
            database
                .store
                .fixture_connection()
                .execute(
                    "UPDATE active_workspace_metadata
                     SET last_replication_activity_at=?1 WHERE singleton=1",
                    [TIMESTAMP],
                )
                .unwrap();
            database.prepare_rebootstrap_publication().unwrap();
        }
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);

        let current = verify_terminal_publication_database_read_only(
            &retained,
            &key,
            "workspace-recovery",
            1,
            Some(&link),
        )
        .unwrap();

        assert_ne!(current.row_digest, old_proof.row_digest);
        assert_ne!(current.row_digest, link.manifest_digest);
        assert_eq!(recovery_candidate_file_state(&path), before);
    }

    #[cfg(unix)]
    #[test]
    fn terminal_publication_rejects_hostile_link_rows_without_writing() {
        for hostile_case in [
            TestRebootstrapJournalLinkHostileCase::RemoveActive,
            TestRebootstrapJournalLinkHostileCase::DuplicateActive,
            TestRebootstrapJournalLinkHostileCase::MutateBindingDigest,
            TestRebootstrapJournalLinkHostileCase::MarkNonVerified,
        ] {
            let (_directory, path, key, _proof, link) = prepared_read_only_recovery_candidate();
            let expected_snapshot = {
                let mut database = BusinessDatabase::open_existing_derived(&path, &key).unwrap();
                let snapshot = database
                    .active_rebootstrap_journal_link_snapshot_for_test()
                    .unwrap();
                assert!(snapshot.is_present());
                assert_eq!(snapshot.active_row_count(), 1);
                assert!(snapshot.digest().is_some());
                database
                    .apply_rebootstrap_journal_link_hostile_case_for_test(hostile_case)
                    .unwrap();
                let hostile_snapshot = database
                    .active_rebootstrap_journal_link_snapshot_for_test()
                    .unwrap();
                match hostile_case {
                    TestRebootstrapJournalLinkHostileCase::RemoveActive => {
                        assert_eq!(hostile_snapshot.active_row_count(), 0);
                        assert!(!hostile_snapshot.is_present());
                    }
                    TestRebootstrapJournalLinkHostileCase::DuplicateActive => {
                        assert_eq!(hostile_snapshot.active_row_count(), 2);
                        assert!(!hostile_snapshot.is_present());
                    }
                    TestRebootstrapJournalLinkHostileCase::MutateBindingDigest => {
                        assert_eq!(hostile_snapshot.active_row_count(), 1);
                        assert!(hostile_snapshot.is_present());
                        assert_ne!(hostile_snapshot.digest(), snapshot.digest());
                    }
                    TestRebootstrapJournalLinkHostileCase::MarkNonVerified => {
                        assert_eq!(hostile_snapshot.active_row_count(), 1);
                        assert!(!hostile_snapshot.is_present());
                    }
                }
                database.prepare_rebootstrap_publication().unwrap();
                snapshot
            };
            assert!(expected_snapshot.is_present());
            let retained = std::fs::File::open(&path).unwrap();
            let before = recovery_candidate_file_state(&path);

            assert_eq!(
                verify_terminal_publication_database_read_only(
                    &retained,
                    &key,
                    "workspace-recovery",
                    1,
                    Some(&link),
                ),
                Err(BusinessDatabaseError::StorageRejected),
                "hostile_case={hostile_case:?}"
            );
            assert_eq!(
                recovery_candidate_file_state(&path),
                before,
                "hostile_case={hostile_case:?}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_bound_recovery_rejection_is_zero_write() {
        let (_directory, path, key, _expected_proof, link) =
            prepared_read_only_recovery_candidate();
        let retained = std::fs::File::open(&path).unwrap();
        let before = recovery_candidate_file_state(&path);

        assert_eq!(
            verify_rebootstrap_recovery_read_only(&retained, &key, "other-workspace", &link),
            Err(BusinessDatabaseError::WorkspaceRejected)
        );
        assert_eq!(recovery_candidate_file_state(&path), before);

        let mut wrong_link = link.clone();
        wrong_link.binding_digest = "d".repeat(64);
        assert_eq!(
            verify_rebootstrap_recovery_read_only(
                &retained,
                &key,
                "workspace-recovery",
                &wrong_link,
            ),
            Err(BusinessDatabaseError::StorageRejected)
        );
        assert_eq!(recovery_candidate_file_state(&path), before);

        let wrong_key = LocalDatabaseKey::from_bytes([0x6d; 32]);
        assert_eq!(
            verify_rebootstrap_recovery_read_only(
                &retained,
                &wrong_key,
                "workspace-recovery",
                &link,
            ),
            Err(BusinessDatabaseError::StorageRejected)
        );
        assert_eq!(recovery_candidate_file_state(&path), before);
    }

    #[test]
    fn combined_rebootstrap_plan_journals_final_replay_proof_and_fence_failure_is_zero_write() {
        let mut database = database();
        let replay = RebootstrapReplayPage {
            page_json: test_sync_page(2, "final"),
            confirmation_token: "rebootstrap-plan".to_owned(),
        };
        let (proof, link) = database
            .install_rebootstrap_plan_guarded(
                &[DomainAssetWrite {
                    entity_id: "remote.test".to_owned(),
                    note: Some("checkpoint".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                }],
                1,
                "reader-local",
                &[replay],
                |proof| Ok(journal_link(proof, 1)),
                || Ok(()),
            )
            .unwrap();
        assert_eq!(proof.applied_server_revision, 2);
        assert_eq!(link.manifest_digest, proof.row_digest);
        database.verify_rebootstrap_journal_link(&link).unwrap();
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("final")
        );

        let before = database.recovery_proof().unwrap();
        let rejected = database.install_rebootstrap_plan_guarded(
            &[DomainAssetWrite {
                entity_id: "other.test".to_owned(),
                note: Some("must rollback".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            }],
            3,
            "reader-local",
            &[],
            |proof| Ok(journal_link(proof, 2)),
            || Err(BusinessDatabaseError::MutationStale),
        );
        assert_eq!(rejected, Err(BusinessDatabaseError::MutationStale));
        assert_eq!(database.recovery_proof().unwrap(), before);
    }

    #[test]
    fn checkpoint_preserves_local_only_difference_and_marks_omitted_replica_stale() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("local-only.db");
        let key = LocalDatabaseKey::from_bytes([0x31; 32]);
        {
            let mut local_db = BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
            local_db
                .upsert_domain_asset(
                    "local",
                    TIMESTAMP,
                    &DomainAssetWrite {
                        entity_id: "local.test".to_owned(),
                        note: Some("local".to_owned()),
                        portfolio_id: None,
                        tags: vec![],
                        target_price: None,
                    },
                )
                .unwrap();
            local_db
                .install_rebootstrap_checkpoint(
                    &[DomainAssetWrite {
                        entity_id: "local.test".to_owned(),
                        note: Some("remote".to_owned()),
                        portfolio_id: None,
                        tags: vec![],
                        target_price: None,
                    }],
                    1,
                    "reader-local",
                    |proof| Ok(journal_link(proof, 1)),
                )
                .unwrap();
        }

        let local_db = BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        assert_eq!(
            local_db.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("local")
        );
        assert!(!local_db.read_sync_conflicts(10).unwrap().is_empty());
        let provenance: (String, i64, i64) = local_db
            .store
            .raw_connection()
            .query_row(
                "SELECT p.root_provenance,
                    (SELECT count(*) FROM domain_asset_field_versions f
                     WHERE f.workspace_id=p.workspace_id AND f.entity_id=p.entity_id
                       AND f.provenance='local_only'),
                    (SELECT count(*) FROM domain_asset_field_versions f
                     WHERE f.workspace_id=p.workspace_id AND f.entity_id=p.entity_id)
             FROM sync_asset_provenance p
             WHERE p.workspace_id='workspace-local' AND p.entity_id='local.test'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(provenance, ("local_only".to_owned(), 4, 4));

        let mut replica = database();
        replica
            .install_rebootstrap_checkpoint(
                &[DomainAssetWrite {
                    entity_id: "replica.test".to_owned(),
                    note: Some("replica".to_owned()),
                    portfolio_id: None,
                    tags: vec![],
                    target_price: None,
                }],
                1,
                "reader-local",
                |proof| Ok(journal_link(proof, 1)),
            )
            .unwrap();
        replica
            .install_rebootstrap_checkpoint(&[], 2, "reader-local", |proof| {
                Ok(journal_link(proof, 2))
            })
            .unwrap();
        let freshness: (String, String) = replica.store.raw_connection().query_row(
            "SELECT p.freshness,f.freshness FROM sync_asset_provenance p JOIN domain_asset_field_versions f USING(workspace_id,entity_id) WHERE p.entity_id='replica.test' AND f.field_path='note'",
            [], |row| Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(freshness, ("stale".to_owned(), "stale".to_owned()));
        assert_eq!(replica.read_portfolio().unwrap().domains.len(), 1);
    }

    #[test]
    fn checkpoint_rejects_missing_field_version_without_advancing_state() {
        let mut database = database();
        let initial = DomainAssetWrite {
            entity_id: "missing-field.test".to_owned(),
            note: Some("initial".to_owned()),
            portfolio_id: None,
            tags: vec![],
            target_price: None,
        };
        database
            .install_rebootstrap_checkpoint(
                std::slice::from_ref(&initial),
                1,
                "reader-local",
                |proof| Ok(journal_link(proof, 1)),
            )
            .unwrap();
        database
            .store
            .raw_connection()
            .execute(
                "DELETE FROM domain_asset_field_versions
                 WHERE workspace_id=?1 AND entity_id=?2 AND field_path='note'",
                params!["workspace-local", initial.entity_id],
            )
            .unwrap();
        let before = database.recovery_proof().unwrap();

        let rejected = database.install_rebootstrap_checkpoint(
            &[DomainAssetWrite {
                note: Some("must-not-apply".to_owned()),
                ..initial.clone()
            }],
            2,
            "reader-local",
            |proof| Ok(journal_link(proof, 2)),
        );
        assert_eq!(rejected, Err(BusinessDatabaseError::StorageRejected));
        assert_eq!(database.recovery_proof().unwrap(), before);
        assert_eq!(
            database.read_portfolio().unwrap().domains[0]
                .note
                .as_deref(),
            Some("initial")
        );
    }

    #[test]
    fn checkpoint_rejects_invalid_field_metadata_without_advancing_state() {
        for (entity_id, corruption) in [
            (
                "invalid-provenance.test",
                "UPDATE domain_asset_field_versions SET provenance='untrusted'
                 WHERE workspace_id=?1 AND entity_id=?2 AND field_path='note'",
            ),
            (
                "invalid-state.test",
                "UPDATE domain_asset_field_versions SET sync_state='untrusted'
                 WHERE workspace_id=?1 AND entity_id=?2 AND field_path='note'",
            ),
        ] {
            let mut database = database();
            let initial = DomainAssetWrite {
                entity_id: entity_id.to_owned(),
                note: Some("initial".to_owned()),
                portfolio_id: None,
                tags: vec![],
                target_price: None,
            };
            database
                .install_rebootstrap_checkpoint(
                    std::slice::from_ref(&initial),
                    1,
                    "reader-local",
                    |proof| Ok(journal_link(proof, 1)),
                )
                .unwrap();
            database
                .store
                .raw_connection()
                .execute_batch("PRAGMA ignore_check_constraints=ON;")
                .unwrap();
            database
                .store
                .raw_connection()
                .execute(corruption, params!["workspace-local", initial.entity_id])
                .unwrap();
            database
                .store
                .raw_connection()
                .execute_batch("PRAGMA ignore_check_constraints=OFF;")
                .unwrap();
            let before = database.recovery_proof().unwrap();

            let rejected = database.install_rebootstrap_checkpoint(
                &[DomainAssetWrite {
                    note: Some("must-not-apply".to_owned()),
                    ..initial.clone()
                }],
                2,
                "reader-local",
                |proof| Ok(journal_link(proof, 2)),
            );
            assert_eq!(rejected, Err(BusinessDatabaseError::StorageRejected));
            assert_eq!(database.recovery_proof().unwrap(), before);
            assert_eq!(
                database.read_portfolio().unwrap().domains[0]
                    .note
                    .as_deref(),
                Some("initial")
            );
        }
    }
}
