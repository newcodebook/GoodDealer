//! Host-owned business operations for the Desktop local workspace.
//!
//! This module deliberately contains no database path, key, workspace selector, or
//! authorization callback.  `DesktopLocalHost` constructs it from the already-open
//! `BusinessDatabase` and supplies a private mutation context derived from its own
//! verified authority state.

use std::fmt;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    AssetLibraryReadSnapshot, BusinessDatabase, BusinessDatabaseError, DatabaseRecoveryProof,
    DomainAssetMutationReceipt, DomainAssetWrite, DomainDetailReadSnapshot, DurableSyncSnapshot,
    SyncConflictCandidate, SyncResolutionReceipt,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Redacted authority values needed to commit a local business mutation.
///
/// Fields are private so a Renderer or another crate cannot select identity or lease values.
/// The Host composition creates this only after holding its authority read guard.
pub(crate) struct BusinessMutationContext {
    device_id: String,
    active_lease_epoch: u64,
    committed_at: String,
}

impl BusinessMutationContext {
    pub(crate) fn new(
        device_id: String,
        active_lease_epoch: u64,
        committed_at: String,
    ) -> Result<Self, BusinessDatabaseError> {
        if device_id.is_empty()
            || device_id.len() > 128
            || !device_id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        if active_lease_epoch == 0
            || active_lease_epoch > MAX_SAFE_INTEGER
            || committed_at.is_empty()
            || committed_at.len() > 64
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        Ok(Self {
            device_id,
            active_lease_epoch,
            committed_at,
        })
    }
}

impl fmt::Debug for BusinessMutationContext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BusinessMutationContext([REDACTED])")
    }
}

/// Inputs for one edit mutation.  The expected versions are CAS values from a prior local read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopDomainAssetEditRequest {
    pub(crate) mutation_id: String,
    pub(crate) expected_read_generation: u64,
    pub(crate) expected_asset_version: u64,
    pub(crate) asset: DesktopDomainAssetWrite,
}

/// Inputs for one delete mutation.  The expected versions are CAS values from a prior local read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopDomainAssetDeleteRequest {
    pub(crate) mutation_id: String,
    pub(crate) expected_read_generation: u64,
    pub(crate) expected_asset_version: u64,
    pub(crate) entity_id: String,
}

/// Binds one existing asset to the latest Host-verified Cloudflare Zone observation.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopDomainAssetProviderBindingRequest {
    pub(crate) schema_version: u8,
    pub(crate) expected_read_generation: u64,
    pub(crate) entity_id: String,
}

/// Inputs for one conflict resolution CAS operation.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopConflictResolveRequest {
    pub(crate) schema_version: u8,
    pub(crate) expected_read_generation: u64,
    pub(crate) candidate_set_version: u64,
    pub(crate) candidate_id: String,
    pub(crate) expected_candidate_version: u64,
    pub(crate) expected_revision: u64,
    pub(crate) expected_current_value_hash: String,
    pub(crate) choice: String,
}

impl DesktopConflictResolveRequest {
    /// Derives the stable local idempotency identity from Host-owned installation/account/
    /// workspace/device bindings and exact CAS. A rotating lease is intentionally not an input:
    /// lease renewal must not change the identity of an already-submitted resolution. The lease
    /// remains a pre-commit freshness fence instead.
    pub(crate) fn resolution_id(
        &self,
        installation_binding: &[u8; 32],
        account_id: &str,
        workspace_id: &str,
        device_id: &str,
    ) -> String {
        let mut digest = Sha256::new();
        digest.update(b"GOODDEALER/DESKTOP-CONFLICT-RESOLUTION-V1\0");
        digest.update((installation_binding.len() as u64).to_be_bytes());
        digest.update(installation_binding);
        let candidate_set_version = self.candidate_set_version.to_string();
        let read_generation = self.expected_read_generation.to_string();
        let candidate_version = self.expected_candidate_version.to_string();
        let revision = self.expected_revision.to_string();
        for value in [
            account_id,
            workspace_id,
            device_id,
            &read_generation,
            &candidate_set_version,
            &self.candidate_id,
            &candidate_version,
            &revision,
            &self.expected_current_value_hash,
            &self.choice,
        ] {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
        let mut identifier = String::from("resolution-");
        for byte in digest.finalize() {
            use std::fmt::Write;
            write!(&mut identifier, "{byte:02x}").expect("writing to a String cannot fail");
        }
        identifier
    }
}

/// Safe conflict center projection.  Raw storage and workspace identifiers never cross this DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopConflictCenterView {
    pub(crate) schema_version: u8,
    pub(crate) kind: &'static str,
    pub(crate) read_generation: u64,
    pub(crate) candidate_set_version: u64,
    pub(crate) freshness: DesktopConflictFreshness,
    pub(crate) conflicts: Vec<DesktopConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSyncSnapshotView {
    pub(crate) schema_version: u8,
    pub(crate) source: &'static str,
    pub(crate) read_generation: u64,
    pub(crate) transport: &'static str,
    pub(crate) blocked_reason: Option<&'static str>,
    pub(crate) activity: &'static str,
    pub(crate) pending_mutation_count: u64,
    pub(crate) open_conflict_count: u64,
    pub(crate) rejected_mutation_count: u64,
    pub(crate) recovery_required: bool,
    pub(crate) applied_through_server_revision: u64,
    pub(crate) last_replication_activity_at: Option<String>,
    pub(crate) transport_observed_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopSyncTransportState {
    Checking,
    Reachable,
    Offline,
    AuthorizationBlocked,
    SecurityBlocked,
}

impl DesktopSyncSnapshotView {
    pub fn apply_transport(
        &mut self,
        state: DesktopSyncTransportState,
        syncing: bool,
        observed_at_unix_seconds: Option<u64>,
    ) {
        if self.recovery_required || self.source == "local_continuation" {
            return;
        }
        let (transport, blocked_reason) = match state {
            DesktopSyncTransportState::Checking => ("checking", None),
            DesktopSyncTransportState::Reachable => ("reachable", None),
            DesktopSyncTransportState::Offline => ("offline", None),
            DesktopSyncTransportState::AuthorizationBlocked => ("blocked", Some("authorization")),
            DesktopSyncTransportState::SecurityBlocked => ("blocked", Some("security")),
        };
        self.transport = transport;
        self.blocked_reason = blocked_reason;
        self.activity = if syncing && transport != "blocked" {
            "syncing"
        } else {
            "idle"
        };
        self.transport_observed_at = if transport == "checking" {
            None
        } else {
            observed_at_unix_seconds
                .and_then(|value| i64::try_from(value).ok())
                .map(format_timestamp_seconds)
        };
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopConflictResolutionReceipt {
    pub(crate) schema_version: u8,
    pub(crate) read_generation: u64,
    pub(crate) enqueued_for_sync: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConflictFreshness {
    pub(crate) source: &'static str,
    pub(crate) server_revision: u64,
    pub(crate) observed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopConflict {
    pub(crate) candidate_id: String,
    pub(crate) candidate_kind: &'static str,
    pub(crate) entity_display: String,
    pub(crate) field_display: String,
    pub(crate) local_value: String,
    pub(crate) remote_value: String,
    pub(crate) current_value_hash: String,
    pub(crate) comparison_server_revision: u64,
    pub(crate) status: String,
    pub(crate) group: &'static str,
    pub(crate) risk: &'static str,
    pub(crate) note: &'static str,
    pub(crate) base_value: &'static str,
    pub(crate) resolution_admission: serde_json::Value,
}

/// Non-backup business aggregate owned by the local Host.
pub(crate) struct DesktopBusinessRuntime {
    database: BusinessDatabase,
    read_generation: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopAssetLibraryReadRequest {
    pub(crate) start_index: u32,
    pub(crate) size: u16,
    pub(crate) query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopDomainDetailReadRequest {
    pub(crate) entity_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopCloudflareObservationReadRequest {
    pub schema_version: u8,
    pub entity_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCloudflareConnectionRead {
    pub schema_version: u8,
    pub connection_ref: Option<String>,
    pub display_label: Option<String>,
    pub read_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCloudflareObservationRead {
    pub schema_version: u8,
    pub read_generation: u64,
    pub entity_id: String,
    pub observed_at: Option<String>,
    pub version: u64,
    pub availability: String,
    pub uncertainty: String,
    pub zone_label: Option<String>,
    pub zone_status: String,
    pub records: Vec<DesktopCloudflareObservationRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCloudflareObservationRecord {
    pub record_id: String,
    pub fqdn: String,
    pub r#type: String,
    pub display_value: String,
    pub ttl: Option<u32>,
    pub proxied: bool,
    pub provider_version_token: u64,
    pub classification: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDomainAssetProviderBindingReceipt {
    pub schema_version: u8,
    pub disposition: &'static str,
    pub entity_id: String,
    pub provider_kind: String,
    pub resource_kind: String,
    pub resource_binding_digest: String,
    pub resource_label: String,
    pub binding_generation: u64,
    pub validation_status: String,
    pub verified_at: String,
    pub last_observed_at: String,
    pub local_commit_sequence: u64,
    pub read_generation: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopDomainAssetWrite {
    entity_id: String,
    note: Option<String>,
    portfolio_id: Option<String>,
    tags: Vec<String>,
    target_price: Option<crate::Money>,
}

impl From<DesktopDomainAssetWrite> for DomainAssetWrite {
    fn from(value: DesktopDomainAssetWrite) -> Self {
        Self {
            entity_id: value.entity_id,
            note: value.note,
            portfolio_id: value.portfolio_id,
            tags: value.tags,
            target_price: value.target_price,
        }
    }
}

impl fmt::Debug for DesktopBusinessRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DesktopBusinessRuntime([REDACTED])")
    }
}

impl DesktopBusinessRuntime {
    pub(crate) fn new(database: BusinessDatabase) -> Self {
        Self {
            database,
            read_generation: 0,
        }
    }

    pub(crate) fn read_generation(&self) -> u64 {
        self.read_generation
    }

    pub(crate) fn has_read_generation_capacity(&self) -> bool {
        self.read_generation < MAX_SAFE_INTEGER
    }

    /// Advances the sole Host read fence after a sync projection transaction committed.
    /// The caller retains the aggregate runtime lock and preflights capacity in that
    /// transaction's final commit fence.
    pub(crate) fn advance_read_generation_after_sync_commit(&mut self) {
        self.bump_read_generation_after_preflight();
    }

    /// Returns the owned database only to the local backup composition after it has acquired
    /// operation, authority/publication, and writer locks in that order. The method is crate
    /// private and never appears in the public Desktop API.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "immutable database borrowing remains reserved for the private backup evidence path"
        )
    )]
    pub(crate) fn database_for_backup(&self) -> &BusinessDatabase {
        &self.database
    }

    /// Mutable counterpart of [`Self::database_for_backup`]. Callers must already hold the
    /// aggregate lock suffix; this accessor does not acquire or release any lock itself.
    pub(crate) fn database_for_backup_mut(&mut self) -> &mut BusinessDatabase {
        &mut self.database
    }

    /// Transfers the sole writer to custody after the Host has removed this runtime from its
    /// aggregate slot. Rebootstrap uses ownership, rather than a borrowed connection, so both the
    /// old and candidate `SQLite` connections can be publication-safe and closed before EXCHANGE.
    #[cfg(test)]
    pub(crate) fn into_database(self) -> BusinessDatabase {
        self.database
    }

    pub(crate) fn recovery_proof(&self) -> Result<DatabaseRecoveryProof, BusinessDatabaseError> {
        self.database.recovery_proof()
    }

    pub(crate) fn read_asset_library(
        &self,
        start_index: u32,
        size: u16,
        query: &str,
    ) -> Result<AssetLibraryReadSnapshot, BusinessDatabaseError> {
        let mut snapshot = self.database.read_asset_library(start_index, size, query)?;
        snapshot.read_generation = self.read_generation;
        Ok(snapshot)
    }

    pub(crate) fn read_domain_detail(
        &self,
        entity_id: &str,
    ) -> Result<DomainDetailReadSnapshot, BusinessDatabaseError> {
        let mut snapshot = self.database.read_domain_detail(entity_id)?;
        snapshot.read_generation = self.read_generation;
        Ok(snapshot)
    }

    pub(crate) fn read_cloudflare_connection(
        &self,
    ) -> Result<DesktopCloudflareConnectionRead, BusinessDatabaseError> {
        let (connection_ref, display_label) = self.database.read_cloudflare_connection()?;
        Ok(DesktopCloudflareConnectionRead {
            schema_version: 1,
            connection_ref,
            display_label,
            read_generation: self.read_generation,
        })
    }

    pub(crate) fn read_cloudflare_observation(
        &self,
        entity_id: &str,
    ) -> Result<DesktopCloudflareObservationRead, BusinessDatabaseError> {
        let mut value = self.database.read_cloudflare_observation(entity_id)?;
        value.read_generation = self.read_generation;
        Ok(value)
    }

    pub(crate) fn bind_domain_asset_provider_guarded(
        &mut self,
        request: DesktopDomainAssetProviderBindingRequest,
        context: &BusinessMutationContext,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<DesktopDomainAssetProviderBindingReceipt, BusinessDatabaseError> {
        if request.schema_version != 1 || request.expected_read_generation > MAX_SAFE_INTEGER {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let same_generation = request.expected_read_generation == self.read_generation;
        if same_generation && !self.has_read_generation_capacity() {
            return Err(BusinessDatabaseError::SequenceExhausted);
        }
        let allow_new = same_generation;
        let receipt = self.database.bind_latest_cloudflare_zone(
            &request.entity_id,
            allow_new,
            self.has_read_generation_capacity(),
            &context.committed_at,
            commit_fence,
        )?;
        if receipt.disposition == "committed" {
            self.bump_read_generation_after_preflight();
        }
        Ok(DesktopDomainAssetProviderBindingReceipt {
            schema_version: 1,
            disposition: receipt.disposition,
            entity_id: receipt.entity_id,
            provider_kind: receipt.provider_kind,
            resource_kind: receipt.resource_kind,
            resource_binding_digest: receipt.resource_binding_digest,
            resource_label: receipt.resource_label,
            binding_generation: receipt.binding_generation,
            validation_status: receipt.validation_status,
            verified_at: receipt.verified_at,
            last_observed_at: receipt.last_observed_at,
            local_commit_sequence: receipt.local_commit_sequence,
            read_generation: self.read_generation,
        })
    }

    pub(crate) fn edit_domain_asset_guarded(
        &mut self,
        request: DesktopDomainAssetEditRequest,
        context: &BusinessMutationContext,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError> {
        if request.expected_read_generation > MAX_SAFE_INTEGER
            || request.expected_asset_version > MAX_SAFE_INTEGER
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let has_generation_capacity = self.read_generation < MAX_SAFE_INTEGER;
        let allow_new = request.expected_read_generation == self.read_generation;
        let asset: DomainAssetWrite = request.asset.into();
        let receipt = self.database.edit_domain_asset_guarded(
            &request.mutation_id,
            request.expected_asset_version,
            &context.device_id,
            context.active_lease_epoch,
            &context.committed_at,
            &asset,
            allow_new,
            |replay| {
                if !replay && !has_generation_capacity {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                commit_fence()?;
                Ok(())
            },
            |(), _| Ok(()),
        )?;
        if receipt.disposition == "committed" {
            self.bump_read_generation_after_preflight();
        }
        Ok(receipt)
    }

    pub(crate) fn delete_domain_asset_guarded(
        &mut self,
        request: DesktopDomainAssetDeleteRequest,
        context: &BusinessMutationContext,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<DomainAssetMutationReceipt, BusinessDatabaseError> {
        let DesktopDomainAssetDeleteRequest {
            mutation_id,
            expected_read_generation,
            expected_asset_version,
            entity_id,
        } = request;
        if expected_read_generation > MAX_SAFE_INTEGER || expected_asset_version > MAX_SAFE_INTEGER
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let has_generation_capacity = self.read_generation < MAX_SAFE_INTEGER;
        let allow_new = expected_read_generation == self.read_generation;
        let receipt = self.database.delete_domain_asset_guarded(
            &mutation_id,
            expected_asset_version,
            &context.device_id,
            context.active_lease_epoch,
            &context.committed_at,
            &entity_id,
            allow_new,
            |replay| {
                if !replay && !has_generation_capacity {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                commit_fence()?;
                Ok(())
            },
            |(), _| Ok(()),
        )?;
        if receipt.disposition == "committed" {
            self.bump_read_generation_after_preflight();
        }
        Ok(receipt)
    }

    pub(crate) fn read_conflict_center(
        &self,
    ) -> Result<DesktopConflictCenterView, BusinessDatabaseError> {
        let candidates = self.database.read_sync_conflicts(1_000)?;
        let server_revision = self.database.current_server_revision()?;
        let conflicts = candidates
            .into_iter()
            .map(|candidate| conflict_projection(candidate, server_revision))
            .collect();
        Ok(DesktopConflictCenterView {
            schema_version: 1,
            candidate_set_version: server_revision,
            kind: "conflict_center",
            read_generation: self.read_generation,
            freshness: DesktopConflictFreshness {
                source: "active_local",
                server_revision,
                observed_at: now_timestamp(),
            },
            conflicts,
        })
    }

    pub(crate) fn read_sync_snapshot(
        &self,
        source: &'static str,
        blocked_reason: Option<&'static str>,
    ) -> Result<DesktopSyncSnapshotView, BusinessDatabaseError> {
        let DurableSyncSnapshot {
            pending_mutation_count,
            open_conflict_count,
            rejected_mutation_count,
            recovery_required,
            applied_through_server_revision,
            last_replication_activity_at,
        } = self.database.durable_sync_snapshot()?;
        let blocked_reason = if recovery_required {
            Some("recovery_required")
        } else {
            blocked_reason
        };
        Ok(DesktopSyncSnapshotView {
            schema_version: 1,
            source,
            read_generation: self.read_generation,
            transport: if blocked_reason.is_some() {
                "blocked"
            } else {
                "checking"
            },
            blocked_reason,
            activity: "idle",
            pending_mutation_count,
            open_conflict_count,
            rejected_mutation_count,
            recovery_required,
            applied_through_server_revision,
            last_replication_activity_at,
            transport_observed_at: None,
        })
    }

    pub(crate) fn resolve_conflict_guarded(
        &mut self,
        request: &DesktopConflictResolveRequest,
        resolution_id: &str,
        context: &BusinessMutationContext,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncResolutionReceipt, BusinessDatabaseError> {
        if request.schema_version != 1
            || request.expected_read_generation >= MAX_SAFE_INTEGER
            || request.candidate_set_version == 0
            || request.candidate_set_version > MAX_SAFE_INTEGER
            || request.candidate_id.is_empty()
            || request.candidate_id.len() > 160
            || !request
                .candidate_id
                .bytes()
                .all(|byte| (0x21..=0x7e).contains(&byte))
            || request.expected_candidate_version == 0
            || request.expected_candidate_version > MAX_SAFE_INTEGER
            || request.expected_revision == 0
            || request.expected_revision > MAX_SAFE_INTEGER
            || request.expected_current_value_hash.len() != 64
            || !request
                .expected_current_value_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || !matches!(request.choice.as_str(), "accept_remote" | "keep_local")
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let was_open = self
            .database
            .read_sync_conflicts(1_000)?
            .into_iter()
            .any(|candidate| {
                candidate.conflict_id == request.candidate_id && candidate.status == "open"
            });
        let has_generation_capacity = self.read_generation < MAX_SAFE_INTEGER;
        if was_open {
            if self.read_generation != request.expected_read_generation {
                return Err(BusinessDatabaseError::MutationStale);
            }
        } else if self.read_generation != request.expected_read_generation + 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        let receipt = self.database.resolve_sync_conflict_guarded(
            resolution_id,
            &request.candidate_id,
            request.candidate_set_version,
            request.expected_candidate_version,
            request.expected_revision,
            &request.expected_current_value_hash,
            &request.choice,
            &context.device_id,
            context.active_lease_epoch,
            &context.committed_at,
            || {
                if was_open && !has_generation_capacity {
                    return Err(BusinessDatabaseError::SequenceExhausted);
                }
                commit_fence()
            },
        )?;
        if was_open {
            self.bump_read_generation_after_preflight();
        }
        Ok(receipt)
    }

    pub(crate) fn resolution_view(
        &self,
        receipt: &SyncResolutionReceipt,
    ) -> DesktopConflictResolutionReceipt {
        DesktopConflictResolutionReceipt {
            schema_version: 1,
            read_generation: self.read_generation,
            enqueued_for_sync: receipt.outbox_mutation_id.is_some(),
        }
    }

    fn bump_read_generation_after_preflight(&mut self) {
        debug_assert!(self.read_generation < MAX_SAFE_INTEGER);
        self.read_generation += 1;
    }
}

fn conflict_projection(candidate: SyncConflictCandidate, current_revision: u64) -> DesktopConflict {
    let SyncConflictCandidate {
        conflict_id,
        entity_id,
        field_path,
        local_value_json,
        remote_value_json,
        local_value_hash,
        remote_value_hash: _,
        remote_server_revision,
        candidate_version,
        status: candidate_status,
    } = candidate;
    let candidate_kind = if field_path == "lifecycleStatus" {
        "delete_conflict"
    } else {
        "field_conflict"
    };
    let review_stale = candidate_status == "open" && remote_server_revision < current_revision;
    let status = if review_stale {
        "review_stale".to_owned()
    } else if candidate_status == "open" {
        "pending".to_owned()
    } else {
        safe_text(&candidate_status)
    };
    let choices = if candidate_status == "open" && !review_stale {
        if candidate_kind == "delete_conflict" {
            vec!["accept_remote"]
        } else {
            vec!["keep_local", "accept_remote"]
        }
    } else {
        Vec::new()
    };
    let resolution_admission = if choices.is_empty() {
        serde_json::json!({"state":"unavailable"})
    } else {
        serde_json::json!({
            "state":"available",
            "candidateId": conflict_id,
            "expectedRevision": remote_server_revision,
            "expectedCandidateVersion": candidate_version,
            "expectedCurrentValueHash": local_value_hash,
            "choices": choices,
        })
    };
    DesktopConflict {
        candidate_id: safe_text(&conflict_id),
        candidate_kind,
        entity_display: safe_text(&entity_id),
        field_display: safe_text(&field_path),
        local_value: safe_text(&local_value_json),
        remote_value: safe_text(&remote_value_json),
        current_value_hash: safe_text(&local_value_hash),
        comparison_server_revision: remote_server_revision,
        status,
        group: if field_path == "targetPrice" {
            "price"
        } else {
            "sales_status"
        },
        risk: if candidate_kind == "delete_conflict" {
            "high"
        } else {
            "normal"
        },
        note: "Manual review required",
        base_value: "Persisted comparison",
        resolution_admission,
    }
}

fn now_timestamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .unwrap_or(0);
    format_timestamp_seconds(seconds)
}

fn format_timestamp_seconds(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(m <= 2);
    format!(
        "{year:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        day_seconds / 3_600,
        (day_seconds % 3_600) / 60,
        day_seconds % 60
    )
}

fn safe_text(value: &str) -> String {
    let filtered = value
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    *character,
                    '\u{061c}'
                        | '\u{200e}'
                        | '\u{200f}'
                        | '\u{202a}'..='\u{202e}'
                        | '\u{2066}'..='\u{2069}'
                )
        })
        .take(512)
        .collect::<String>();
    if filtered.is_empty() {
        "(empty)".to_owned()
    } else {
        filtered
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LocalDatabaseKey, Money};

    fn asset(note: &str) -> DomainAssetWrite {
        DomainAssetWrite {
            entity_id: "example.com".to_owned(),
            note: Some(note.to_owned()),
            portfolio_id: None,
            tags: vec!["core".to_owned()],
            target_price: Some(Money {
                currency: "USD".to_owned(),
                amount: "1000".to_owned(),
            }),
        }
    }

    fn runtime() -> (tempfile::TempDir, DesktopBusinessRuntime) {
        let directory = tempfile::tempdir().expect("temp directory");
        let key = LocalDatabaseKey::from_bytes([23; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("business.db"), &key, "workspace-one")
                .expect("database");
        database
            .upsert_domain_asset("seed-mutation", "2026-01-01T00:00:00Z", &asset("before"))
            .expect("seed");
        (directory, DesktopBusinessRuntime::new(database))
    }

    #[test]
    fn mutation_context_rejects_empty_or_zero_authority_values() {
        assert!(
            BusinessMutationContext::new(String::new(), 1, "2026-01-01T00:00:00Z".into()).is_err()
        );
        assert!(
            BusinessMutationContext::new("device".into(), 0, "2026-01-01T00:00:00Z".into())
                .is_err()
        );
        assert!(BusinessMutationContext::new("device".into(), 1, String::new()).is_err());
    }

    #[test]
    fn local_commit_survives_a_later_cloud_failure() {
        let (directory, mut runtime) = runtime();
        let version = runtime
            .read_domain_detail("example.com")
            .expect("detail")
            .asset
            .asset_version;
        let context =
            BusinessMutationContext::new("device-one".into(), 1, "2026-01-01T00:01:00Z".into())
                .expect("context");
        runtime
            .edit_domain_asset_guarded(
                DesktopDomainAssetEditRequest {
                    mutation_id: "edit-mutation".into(),
                    expected_read_generation: 0,
                    expected_asset_version: version,
                    asset: DesktopDomainAssetWrite {
                        entity_id: "example.com".into(),
                        note: Some("after".into()),
                        portfolio_id: None,
                        tags: vec!["core".into()],
                        target_price: Some(Money {
                            currency: "USD".into(),
                            amount: "1000".into(),
                        }),
                    },
                },
                &context,
                || Ok(()),
            )
            .expect("local commit");
        let cloud_result: Result<(), &'static str> = Err("transport unavailable");
        assert!(cloud_result.is_err());
        drop(runtime);

        let key = LocalDatabaseKey::from_bytes([23; 32]);
        let reopened =
            BusinessDatabase::open(&directory.path().join("business.db"), &key, "workspace-one")
                .expect("reopen");
        assert_eq!(
            reopened
                .read_domain_detail("example.com")
                .expect("persisted detail")
                .asset
                .note
                .as_deref(),
            Some("after")
        );
    }

    #[test]
    fn workspace_binding_and_stale_generation_fail_closed() {
        let (directory, mut runtime) = runtime();
        let original = runtime.read_domain_detail("example.com").expect("detail");
        let context =
            BusinessMutationContext::new("device-one".into(), 1, "2026-01-01T00:01:00Z".into())
                .expect("context");
        let request = DesktopDomainAssetEditRequest {
            mutation_id: "edit-mutation".into(),
            expected_read_generation: 0,
            expected_asset_version: original.asset.asset_version,
            asset: DesktopDomainAssetWrite {
                entity_id: "example.com".into(),
                note: Some("first".into()),
                portfolio_id: None,
                tags: vec!["core".into()],
                target_price: None,
            },
        };
        let committed = runtime
            .edit_domain_asset_guarded(request, &context, || Ok(()))
            .expect("commit");
        assert_eq!(runtime.read_generation(), 1);

        let stale = runtime.edit_domain_asset_guarded(
            DesktopDomainAssetEditRequest {
                mutation_id: "different-mutation".into(),
                expected_read_generation: 0,
                expected_asset_version: committed.local_commit_sequence,
                asset: DesktopDomainAssetWrite {
                    entity_id: "example.com".into(),
                    note: Some("stale".into()),
                    portfolio_id: None,
                    tags: vec!["core".into()],
                    target_price: None,
                },
            },
            &context,
            || Ok(()),
        );
        assert_eq!(stale, Err(BusinessDatabaseError::MutationStale));
        let replay = runtime
            .edit_domain_asset_guarded(
                DesktopDomainAssetEditRequest {
                    mutation_id: "edit-mutation".into(),
                    expected_read_generation: 0,
                    expected_asset_version: original.asset.asset_version,
                    asset: DesktopDomainAssetWrite {
                        entity_id: "example.com".into(),
                        note: Some("first".into()),
                        portfolio_id: None,
                        tags: vec!["core".into()],
                        target_price: None,
                    },
                },
                &context,
                || Ok(()),
            )
            .expect("exact replay");
        assert_eq!(replay.disposition, "replayed");
        assert_eq!(runtime.read_generation(), 1);
        drop(runtime);

        let key = LocalDatabaseKey::from_bytes([23; 32]);
        assert_eq!(
            BusinessDatabase::open(&directory.path().join("business.db"), &key, "workspace-two")
                .err(),
            Some(BusinessDatabaseError::WorkspaceRejected)
        );
    }

    #[test]
    fn conflict_projection_redacts_controls_and_stale_choices() {
        let candidate = SyncConflictCandidate {
            conflict_id: "id\u{202e}".into(),
            entity_id: "entity".into(),
            field_path: "note".into(),
            local_value_json: "<script>\u{0000}".into(),
            remote_value_json: "remote".into(),
            local_value_hash: "hash".into(),
            remote_value_hash: "remote-hash".into(),
            remote_server_revision: 1,
            candidate_version: 1,
            status: "open".into(),
        };
        let projection = conflict_projection(candidate, 2);
        assert_eq!(projection.candidate_id, "id");
        assert_eq!(projection.local_value, "<script>");
        assert_eq!(
            projection.resolution_admission,
            serde_json::json!({"state":"unavailable"})
        );
        assert_eq!(projection.status, "review_stale");
    }

    #[test]
    fn dto_and_error_diagnostics_are_bounded_and_redacted() {
        let candidate = SyncConflictCandidate {
            conflict_id: "candidate".into(),
            entity_id: "entity".into(),
            field_path: "note".into(),
            local_value_json: "x".repeat(2_048),
            remote_value_json: "credential-token-canary".into(),
            local_value_hash: "a".repeat(64),
            remote_value_hash: "b".repeat(64),
            remote_server_revision: 1,
            candidate_version: 1,
            status: "open".into(),
        };
        let projection = conflict_projection(candidate, 1);
        let json = serde_json::to_string(&projection).expect("serialize");
        assert_eq!(projection.local_value.len(), 512);
        assert!(!json.contains("workspaceId"));
        assert!(!json.contains("deviceId"));
        assert!(!json.contains("leaseEpoch"));
        assert_eq!(
            BusinessDatabaseError::StorageRejected.to_string(),
            "LOCAL_STORAGE_REJECTED"
        );
        let context =
            BusinessMutationContext::new("device-secret".into(), 7, "2026-01-01T00:00:00Z".into())
                .expect("context");
        assert_eq!(
            format!("{context:?}"),
            "BusinessMutationContext([REDACTED])"
        );
    }

    #[test]
    fn generation_exhaustion_rejects_before_any_database_write() {
        let (_directory, mut runtime) = runtime();
        let before = runtime
            .read_domain_detail("example.com")
            .expect("detail")
            .asset
            .note;
        runtime.read_generation = MAX_SAFE_INTEGER;
        let context =
            BusinessMutationContext::new("device-one".into(), 1, "2026-01-01T00:01:00Z".into())
                .expect("context");
        let result = runtime.edit_domain_asset_guarded(
            DesktopDomainAssetEditRequest {
                mutation_id: "exhaustion".into(),
                expected_read_generation: MAX_SAFE_INTEGER,
                expected_asset_version: 1,
                asset: DesktopDomainAssetWrite {
                    entity_id: "example.com".into(),
                    note: Some("must-not-commit".into()),
                    portfolio_id: None,
                    tags: vec!["core".into()],
                    target_price: None,
                },
            },
            &context,
            || Ok(()),
        );
        assert_eq!(result, Err(BusinessDatabaseError::SequenceExhausted));
        assert_eq!(
            runtime
                .read_domain_detail("example.com")
                .unwrap()
                .asset
                .note,
            before
        );
    }

    #[test]
    fn generation_exhaustion_allows_exact_replay_without_increment() {
        let (_directory, mut runtime) = runtime();
        let detail = runtime.read_domain_detail("example.com").expect("detail");
        let context =
            BusinessMutationContext::new("device-one".into(), 1, "2026-01-01T00:01:00Z".into())
                .expect("context");
        let request = DesktopDomainAssetEditRequest {
            mutation_id: "replay-at-exhaustion".into(),
            expected_read_generation: 0,
            expected_asset_version: detail.asset.asset_version,
            asset: DesktopDomainAssetWrite {
                entity_id: "example.com".into(),
                note: Some("replay-safe".into()),
                portfolio_id: None,
                tags: vec!["core".into()],
                target_price: None,
            },
        };
        runtime
            .edit_domain_asset_guarded(request, &context, || Ok(()))
            .expect("initial commit");
        runtime.read_generation = MAX_SAFE_INTEGER;

        let replay = runtime
            .edit_domain_asset_guarded(
                DesktopDomainAssetEditRequest {
                    mutation_id: "replay-at-exhaustion".into(),
                    expected_read_generation: 0,
                    expected_asset_version: detail.asset.asset_version,
                    asset: DesktopDomainAssetWrite {
                        entity_id: "example.com".into(),
                        note: Some("replay-safe".into()),
                        portfolio_id: None,
                        tags: vec!["core".into()],
                        target_price: None,
                    },
                },
                &context,
                || Ok(()),
            )
            .expect("exact replay");
        assert_eq!(replay.disposition, "replayed");
        assert_eq!(runtime.read_generation(), MAX_SAFE_INTEGER);
    }

    #[test]
    fn conflict_resolve_wire_is_exact_and_rejects_unknown_or_legacy_fields() {
        let valid = r#"{
            "schemaVersion":1,
            "expectedReadGeneration":0,
            "candidateSetVersion":1,
            "candidateId":"candidate-id",
            "expectedRevision":1,
            "expectedCandidateVersion":1,
            "expectedCurrentValueHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "choice":"keep_local"
        }"#;
        let request: DesktopConflictResolveRequest = serde_json::from_str(valid).expect("wire");
        assert_eq!(request.schema_version, 1);
        assert_eq!(request.candidate_id, "candidate-id");

        for field in ["workspaceId", "resolutionId", "conflictId", "unknown"] {
            let injected = valid.replace(
                "\"choice\":\"keep_local\"",
                &format!("\"choice\":\"keep_local\",\"{field}\":\"x\""),
            );
            assert!(serde_json::from_str::<DesktopConflictResolveRequest>(&injected).is_err());
        }
        let missing_schema = valid.replace("\"schemaVersion\":1,", "");
        assert!(serde_json::from_str::<DesktopConflictResolveRequest>(&missing_schema).is_err());
    }

    #[test]
    fn conflict_resolution_id_is_stable_across_lease_renewal() {
        let request: DesktopConflictResolveRequest = serde_json::from_str(
            r#"{
                "schemaVersion":1,
                "expectedReadGeneration":0,
                "candidateSetVersion":1,
                "candidateId":"candidate-id",
                "expectedRevision":1,
                "expectedCandidateVersion":1,
                "expectedCurrentValueHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "choice":"keep_local"
            }"#,
        )
        .expect("wire");
        let installation = [7_u8; 32];
        let stable =
            request.resolution_id(&installation, "account-one", "workspace-one", "device-one");
        assert_eq!(
            stable,
            request.resolution_id(&installation, "account-one", "workspace-one", "device-one",)
        );
        assert_ne!(
            stable,
            request.resolution_id(&installation, "account-one", "workspace-one", "device-two",)
        );
        assert_ne!(
            stable,
            DesktopConflictResolveRequest {
                choice: "accept_remote".into(),
                ..request
            }
            .resolution_id(&installation, "account-one", "workspace-one", "device-one",)
        );
    }

    #[test]
    fn conflict_resolve_rejects_unsupported_schema_before_database_access() {
        let (_directory, mut runtime) = runtime();
        let request = DesktopConflictResolveRequest {
            schema_version: 2,
            expected_read_generation: 0,
            candidate_set_version: 1,
            candidate_id: "candidate-id".into(),
            expected_candidate_version: 1,
            expected_revision: 1,
            expected_current_value_hash: "a".repeat(64),
            choice: "keep_local".into(),
        };
        let context =
            BusinessMutationContext::new("device-one".into(), 1, "2026-01-01T00:01:00Z".into())
                .expect("context");
        let result =
            runtime.resolve_conflict_guarded(&request, "resolution-test", &context, || {
                panic!("unsupported schema must not reach commit fence")
            });
        assert_eq!(result, Err(BusinessDatabaseError::InvalidInput));
    }
}
