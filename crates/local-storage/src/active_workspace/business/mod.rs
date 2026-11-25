mod afternic_controlled_acceptance;
pub use afternic_controlled_acceptance::DesktopAfternicControlledAcceptance;
pub(crate) use afternic_controlled_acceptance::{
    AFTERNIC_ACCEPTANCE_ENABLED, AFTERNIC_ACCEPTANCE_EXPIRES,
};
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

mod afternic;
mod afternic_delist;
mod afternic_listing_plan;
mod afternic_ownership_review;
pub(crate) use afternic_listing_plan::AfternicListingPlanWorkSeed;
mod execution_evidence;
mod execution_evidence_delivery;
pub(crate) use afternic_delist::AfternicDelistWorkSeed;
pub use afternic_delist::{
    DesktopAfternicDelistApproveRequest, DesktopAfternicDelistPlan,
    DesktopAfternicDelistPreviewItem, DesktopAfternicDelistPreviewRequest,
    DesktopAfternicDelistStatus, DesktopAfternicDelistStatusRequest, DesktopAfternicDelistSummary,
    DesktopAfternicDelistWorkKind,
};
pub(crate) use execution_evidence::{EvidenceSignaturePurpose, ExecutionEvidenceContext};
pub(crate) use execution_evidence_delivery::EvidenceUploadSeed;
pub use execution_evidence_delivery::{
    DesktopExecutionEvidenceDeliveryOutcome, DesktopExecutionEvidenceStream,
};
mod assets;
pub(crate) use afternic::AfternicConnectionSeed;
pub use afternic::{
    DesktopAfternicConnectionSummary, DesktopAfternicConnectionsRead,
    DesktopAfternicInventoryReceipt, DesktopAfternicListingObservation, DesktopAfternicScanSummary,
};
pub(crate) use assets::write_recovered_asset_in_transaction;
mod checkpoint;
mod initial_replica;
pub(crate) use initial_replica::{InitialReplicaProjection, InitialReplicaReceipt};
mod conflicts;
mod database;
mod inbox;
mod outbox;
mod provider_observations;
mod reads;
mod repair;
mod wire;

use assets::check_replicated_re_add;
use assets::confirm_local_re_add;
use assets::supersede_replicated_tombstone;
use assets::withdraw_local_re_add;
use assets::withdraw_rejected_local_delete;
#[cfg(test)]
use conflicts::merge_checkpoint_existing_asset;
use conflicts::persist_conflict_candidate;
use conflicts::read_local_conflict_value;
#[cfg(all(test, unix))]
use database::append_digest_part;
#[cfg(test)]
use database::complete_database_digest;
#[cfg(test)]
use database::recovery_proof_from_connection;
use provider_observations::canonical_cloudflare_projection_digest;
use wire::append_frame;
use wire::canonical_mutation_digest;
pub(crate) use wire::canonical_page_digest;
#[cfg(test)]
use wire::canonical_sync_digest;
use wire::canonical_wire_value;
use wire::hex_digest;
use wire::local_wire_digest;
use wire::reconstruct_sync_mutation_v2;
pub(crate) use wire::serialize_sync_push_request;
pub(crate) use wire::sync_payload;
use wire::validate_cursor_token;
use wire::validate_digest;
#[cfg(all(test, unix))]
pub use wire::validate_rebootstrap_asset;
#[cfg(test)]
pub use wire::validate_rebootstrap_timestamp;
use wire::validate_sync_mutation_fields;
#[cfg(all(test, unix))]
pub use wire::verify_rebootstrap_checkpoint_digest;
#[cfg(all(test, unix))]
pub use wire::verify_rebootstrap_page_digest;
#[cfg(all(test, unix))]
pub use wire::verify_rebootstrap_plan_digest;

mod aliyun_registrar;
mod atom_marketplace;
mod atom_standard_delist;
pub(crate) use atom_standard_delist::AtomStandardDelistWorkSeed;
pub use atom_standard_delist::{
    DesktopAtomListingObservation, DesktopAtomStandardDelistApproveRequest,
    DesktopAtomStandardDelistPreview, DesktopAtomStandardDelistPreviewRequest,
    DesktopAtomStandardDelistStatus, DesktopAtomStandardDelistStatusRequest,
};
mod cloudflare_credential;
mod cloudflare_registrar;
mod cloudflare_registrar_account;
mod cloudflare_retirement;
mod godaddy_registrar;
mod porkbun_delegation;
mod porkbun_dns;
mod porkbun_registrar;
mod registrar_inventory;
mod sedo_marketplace;
mod spaceship_registrar;
mod spaceship_sellerhub;
mod spaceship_sellerhub_bin;
mod spaceship_sellerhub_create;
pub(crate) use aliyun_registrar::{AliyunConnectionSeed, AliyunInventoryCommit};
pub use aliyun_registrar::{DesktopAliyunConnectionState, DesktopAliyunConnectionSummary};
pub(crate) use atom_marketplace::{AtomConnectionSeed, AtomInventoryCommit};
pub use atom_marketplace::{
    DesktopAtomConnectionState, DesktopAtomConnectionSummary, DesktopAtomInventoryReceipt,
    DesktopAtomListingFact, DesktopAtomListingState,
};
pub(crate) use cloudflare_registrar::{
    CloudflareRegistrarInventoryCommit, CloudflareRegistrarScanHead, CloudflareRegistrarScanScope,
};
pub use cloudflare_registrar::{
    DesktopCloudflareRegistrarScanReceipt, DesktopCloudflareRegistrationFact,
    DesktopCloudflareRegistrationStanding,
};
pub use cloudflare_registrar_account::{
    DesktopCloudflareRegistrarAccountState, DesktopCloudflareRegistrarAccountSummary,
};
pub(crate) use cloudflare_registrar_account::{RegistrarAccountCommit, RegistrarAccountSeed};
pub use godaddy_registrar::{DesktopGoDaddyConnectionState, DesktopGoDaddyConnectionSummary};
pub(crate) use godaddy_registrar::{GoDaddyConnectionSeed, GoDaddyInventoryCommit};
pub use porkbun_delegation::DesktopPorkbunDelegationReceipt;
pub(crate) use porkbun_delegation::PorkbunDelegationCommit;
pub(crate) use porkbun_dns::PorkbunDnsCommit;
pub use porkbun_dns::{DesktopPorkbunDnsReceipt, DesktopPorkbunDnsRecord};
pub use porkbun_registrar::{DesktopPorkbunConnectionState, DesktopPorkbunConnectionSummary};
pub(crate) use porkbun_registrar::{PorkbunConnectionSeed, PorkbunInventoryCommit};
pub use registrar_inventory::{
    DesktopRegistrarScanReceipt, DesktopRegistrationFact, DesktopRegistrationStanding,
};
pub use sedo_marketplace::{
    DesktopSedoConnectionState, DesktopSedoCurrency, DesktopSedoMarketplaceConnectionSummary,
    DesktopSedoMarketplaceListingFact, DesktopSedoMarketplaceScanReceipt,
};
pub(crate) use sedo_marketplace::{SedoMarketplaceConnectionSeed, SedoMarketplaceInventoryCommit};
pub use spaceship_registrar::{DesktopSpaceshipConnectionState, DesktopSpaceshipConnectionSummary};
pub(crate) use spaceship_registrar::{SpaceshipConnectionSeed, SpaceshipInventoryCommit};
pub use spaceship_sellerhub::{
    DesktopSellerHubConnectionSummary, DesktopSellerHubListingFact, DesktopSellerHubListingState,
    DesktopSellerHubScanReceipt,
};
pub(crate) use spaceship_sellerhub::{SellerHubConnectionSeed, SellerHubInventoryCommit};
pub(crate) use spaceship_sellerhub_bin::SellerHubBinWorkSeed;
pub use spaceship_sellerhub_bin::{
    DesktopSellerHubBinApproval, DesktopSellerHubBinApproveRequest, DesktopSellerHubBinPlan,
    DesktopSellerHubBinPlanItem, DesktopSellerHubBinPlanSummary, DesktopSellerHubBinPreviewRequest,
    DesktopSellerHubBinStatusRequest, DesktopSellerHubBinTarget,
};
mod drain_claims;
mod normal_handoff;
pub(crate) use cloudflare_credential::{
    CloudflareCredentialEnvelopeKind, CloudflareCredentialOperationKind,
    CloudflareCredentialPreparation, CloudflareCredentialPreparationDisposition,
    CloudflareCredentialRecoveryObservation, CloudflareCredentialResolution,
    CloudflareCredentialStagedObservation, CloudflareCredentialWitness,
    CloudflarePrewriteFailureReason, staged_observation_digest,
};
pub(crate) use cloudflare_retirement::CloudflareRetirementSeed;
pub(crate) use drain_claims::{
    CloudMutationReceipt, DrainMutationProgress, DrainProofSchemaVersion, HandoffDrainProofClaims,
    signed_handoff_proof_digest,
};
pub(crate) use normal_handoff::{NormalHandoffAttempt, NormalHandoffReceipt, NormalHandoffRequest};

/// Temporary gate on the Host create path's local re-add (ADR-0029 C2c2).
///
/// ADR-0029's completion condition forbids an executable production re-add path until every test
/// it lists passes, including the generation guards of all entry points (C3b rebootstrap/checkpoint
/// install and C3c continuity recovery), and PostgreSQL 18.6 qualification evidence covers the
/// delete and re-add ingest paths. Until then production builds refuse a deleted domain with
/// `AssetDeleted`. The change that closes that condition and records the evidence in ADR-0029
/// deletes this constant, the test bypass below and the closed-entry tests that use it.
const LOCAL_RE_ADD_ENTRY_QUALIFIED: bool = false;

/// Whether the create path may re-add a deleted domain. Production follows the constant alone; unit
/// tests open the entry by default so they exercise the full re-add path, and a test that closes it
/// observes exactly the production answer.
fn local_re_add_entry_open() -> bool {
    LOCAL_RE_ADD_ENTRY_QUALIFIED || local_re_add_test_bypass()
}

#[cfg(not(test))]
const fn local_re_add_test_bypass() -> bool {
    false
}

#[cfg(test)]
thread_local! {
    static LOCAL_RE_ADD_TEST_BYPASS: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

#[cfg(test)]
fn local_re_add_test_bypass() -> bool {
    LOCAL_RE_ADD_TEST_BYPASS.with(std::cell::Cell::get)
}

/// Closes the re-add entry for the calling test thread, as production builds have it.
#[cfg(test)]
pub(crate) fn close_local_re_add_entry_for_test() {
    LOCAL_RE_ADD_TEST_BYPASS.with(|bypass| bypass.set(false));
}

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

    pub(crate) fn derive_initial_replica_journal_key(
        &self,
        binding: &[u8],
    ) -> Result<zeroize::Zeroizing<[u8; 32]>, BusinessDatabaseError> {
        let salt = ring::hkdf::Salt::new(
            ring::hkdf::HKDF_SHA256,
            b"GOODDEALER/INITIAL-REPLICA-JOURNAL-KEY-V1",
        );
        let prk = salt.extract(&self.0);
        let info = [binding];
        let okm = prk
            .expand(&info, ring::hkdf::HKDF_SHA256)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut key = zeroize::Zeroizing::new([0; 32]);
        okm.fill(&mut *key)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(key)
    }

    #[cfg(test)]
    #[expect(
        dead_code,
        reason = "database-key cloning is retained for private rebootstrap test fixtures"
    )]
    pub(crate) fn cloned(&self) -> Self {
        Self(self.0)
    }

    #[cfg(all(test, unix))]
    pub(crate) const fn custody_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    #[cfg(windows)]
    pub(crate) fn matches_custody_bytes(&self, bytes: &[u8; 32]) -> bool {
        self.0 == *bytes
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

/// How a claimed batch ends when Cloud rejects it deterministically. Each kind keeps the row,
/// its frozen wire, and its fields as evidence; it differs only in the terminal state and code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncRejectionKind {
    /// Cloud cannot interpret the mutation (input or schema).
    Deterministic,
    /// The mutation id or device sequence was already used with different content.
    IdempotencyConflict,
    /// Cloud state holds a newer write to a field or a tombstone for the entity.
    MutationConflict,
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
        let row: Option<(String, String)> = self.store.raw_connection().query_row(
            "SELECT connection_id, display_label FROM local_provider_connections WHERE workspace_id=?1 AND provider_kind='cloudflare' AND lifecycle_status='active' AND validation_status='valid'
             AND json(capabilities_json)<>'[\"registrar\"]' ORDER BY connection_id LIMIT 1",
            [&self.workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        // Every other Host read applies the one connection-label rule; a row written outside the
        // create path (a migration or a restore) that breaks it fails this read closed rather
        // than reaching the Renderer.
        match row {
            None => Ok((None, None)),
            Some((_, label)) if !crate::portfolio_projection::valid_connection_label(&label) => {
                Err(BusinessDatabaseError::StorageRejected)
            }
            Some((connection_id, label)) => Ok((Some(connection_id), Some(label))),
        }
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

/// The mutation push/pull wire version (ADR-0029 C1a): each mutation carries `entityGeneration`.
/// Checkpoint and rebootstrap messages stay on version 2.
pub(crate) const SYNC_MUTATION_WIRE_SCHEMA_VERSION: u8 = 3;

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

/// One tombstone a version-3 checkpoint carries (ADR-0029): the generation it deleted and the
/// revision that deleted it.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebootstrapTombstone {
    pub entity_id: String,
    pub entity_generation: u64,
    pub deleted_server_revision: u64,
    pub deleted_at: String,
}

/// One live asset captured by a version-3 checkpoint, including its entity generation.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebootstrapAsset {
    pub asset: DomainAssetWrite,
    pub entity_generation: u64,
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
    /// The generation the mutation applies to (ADR-0029). A mutation whose generation differs from
    /// the local entity is refused at materialization, except a re-add, which names the next one.
    entity_generation: u64,
    /// Present only on a re-add (ADR-0029 C2b): the deletion revision of the tombstone this upsert
    /// supersedes. Omitted when absent, so the digest covers exactly the bytes Cloud sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    re_adds_deleted_revision: Option<u64>,
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
    Option<i64>,
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
    AssetExists,
    /// The asset's re-add is provisional (ADR-0029 decision 4): it is frozen until Cloud
    /// acknowledges or rejects the re-add.
    AssetReAddPending,
    /// A re-add's local preconditions are unmet: the deletion is unconfirmed or contested, or the
    /// entity still has queued mutations or open conflicts to settle first.
    AssetReAddBlocked,
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
            Self::AssetExists => "LOCAL_ASSET_EXISTS",
            Self::AssetReAddPending => "LOCAL_ASSET_RE_ADD_PENDING",
            Self::AssetReAddBlocked => "LOCAL_ASSET_RE_ADD_BLOCKED",
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

/// The latest committed Cloudflare Zone observation an asset may be bound from: a live asset, a
/// confirmed-available Zone with the asset's own name, observed through the connection's current
/// active credential for that Zone. The bind and the DNS health read both ask this one question, so
/// the read never offers a bind the Host would refuse for its evidence.
#[derive(Clone)]
pub(crate) struct BindableZone {
    pub(crate) connection_id: String,
    pub(crate) resource_binding_digest: String,
    pub(crate) observation_digest: String,
    pub(crate) resource_label: String,
    pub(crate) generation: u64,
    pub(crate) observed_at: String,
}

impl BindableZone {
    /// The bind's identity rule for an existing binding of this asset's Zone: the same connection,
    /// platform, Zone and name, at a credential generation no newer than this evidence. A binding
    /// identity is immutable, so anything else is a conflict, never a replacement.
    pub(crate) fn admits_existing(
        &self,
        connection_id: &str,
        provider_kind: &str,
        resource_binding_digest: &str,
        resource_label: &str,
        binding_generation: u64,
    ) -> bool {
        connection_id == self.connection_id
            && provider_kind == "cloudflare"
            && resource_binding_digest == self.resource_binding_digest
            && resource_label == self.resource_label
            && binding_generation <= self.generation
    }
}

/// # Errors
///
/// Returns `StorageRejected` when the query fails or a selected field is not in its stored form,
/// so a malformed row is never offered or bound.
pub(crate) fn latest_bindable_zone(
    connection: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
) -> Result<Option<BindableZone>, BusinessDatabaseError> {
    let selected: Option<(String, String, String, String, i64, String)> = connection
        .prepare(
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
                    AND r.retirement_requested_at IS NULL AND r.retired_at IS NULL
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
        )
        .and_then(|mut statement| {
            statement
                .query_row(params![workspace_id, entity_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })
                .optional()
        })
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let Some((
        connection_id,
        resource_binding_digest,
        observation_digest,
        resource_label,
        generation,
        observed_at,
    )) = selected
    else {
        return Ok(None);
    };
    let stored = |valid: bool| {
        if valid {
            Ok(())
        } else {
            Err(BusinessDatabaseError::StorageRejected)
        }
    };
    stored(validate_sha256_hex(&resource_binding_digest).is_ok())?;
    stored(validate_sha256_hex(&observation_digest).is_ok())?;
    stored(validate_local_text(&connection_id).is_ok())?;
    stored(validate_domain_asset_id(&resource_label).is_ok())?;
    Ok(Some(BindableZone {
        connection_id,
        resource_binding_digest,
        observation_digest,
        resource_label,
        generation: u64::try_from(generation)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        observed_at,
    }))
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

/// The wire version new local claims and received mutations are digested under (ADR-0029 C1c2b).
const LOCAL_WIRE_SCHEMA_VERSION: i64 = 3;

/// The local state a checkpoint tombstone is compared with.
#[cfg(test)]
struct LocalTombstoneState {
    tombstone_generation: Option<i64>,
    state: Option<String>,
    barrier: Option<String>,
    deleted_server_revision: Option<i64>,
    asset_generation: Option<i64>,
    asset_deleted: bool,
    provisional_re_add: bool,
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
mod tests;

mod afternic_listing_write;
pub(crate) use afternic_listing_write::AfternicListingWriteWorkSeed;
pub use afternic_listing_write::{
    DesktopAfternicListingWriteAction, DesktopAfternicListingWriteApproveRequest,
    DesktopAfternicListingWriteCreateItem, DesktopAfternicListingWriteItem,
    DesktopAfternicListingWriteObserved, DesktopAfternicListingWritePatch,
    DesktopAfternicListingWritePlan, DesktopAfternicListingWritePreviewRequest,
    DesktopAfternicListingWriteStatus, DesktopAfternicListingWriteStatusRequest,
    DesktopAfternicListingWriteSummary, DesktopAfternicListingWriteUpdateItem,
    DesktopAfternicListingWriteValues, DesktopAfternicListingWriteWorkKind,
};

#[cfg(test)]
mod afternic_ownership_review_tests;

mod afternic_listing_plan_wire;
pub use afternic_listing_plan_wire::{
    DesktopAfternicListingPlan, DesktopAfternicListingPlanAction,
    DesktopAfternicListingPlanApproveRequest, DesktopAfternicListingPlanCurrentSummary,
    DesktopAfternicListingPlanDetail, DesktopAfternicListingPlanItem,
    DesktopAfternicListingPlanOwnershipReview, DesktopAfternicListingPlanOwnershipReviewObserved,
    DesktopAfternicListingPlanPreviewRequest, DesktopAfternicListingPlanStatus,
    DesktopAfternicListingPlanStatusRequest, DesktopAfternicListingPlanSummary,
    DesktopAfternicListingPlanWrite,
};

pub(crate) use spaceship_sellerhub_create::SellerHubCreateWork;
pub use spaceship_sellerhub_create::{
    DesktopSellerHubCreateApproval, DesktopSellerHubCreateApproveRequest,
    DesktopSellerHubCreateDetail, DesktopSellerHubCreatePlanSummary, DesktopSellerHubCreatePreview,
    DesktopSellerHubCreatePreviewRequest, DesktopSellerHubCreateStatusRequest,
    SellerHubCreateReadback,
};
