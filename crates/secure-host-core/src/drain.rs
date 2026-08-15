use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::wire_scalar::{
    SafeUnsignedInteger, deserialize_required_option, is_base64_url, is_canonical_utc_timestamp,
    is_identifier,
};

pub const DRAIN_PROOF_SCHEMA_VERSION: u64 = 1;
pub const DRAIN_STREAM_GENESIS_DIGEST: &str = "58It6o62GZGmXgy6-ER1rezwYX-LCZVJzlZuZOGcWUs";
pub const DRAIN_STREAM_GENESIS_DOMAIN: &str = "GOODDEALER-DRAIN-SHA256-V1";
const DRAIN_SEQUENCE_DOMAIN: &str = "GOODDEALER-DRAIN-SEQUENCE-DOMAIN-V1";
const DEVICE_AUDIT_CHAIN_DOMAIN: &str = "GOODDEALER-DEVICE-AUDIT-CHAIN-V1";
const MUTATION_ENVELOPE_DOMAIN: &str = "GOODDEALER-SYNC-MUTATION-SUBMITTED-V1";
const EXECUTION_FACT_DOMAIN: &str = "GOODDEALER-EXECUTION-FACT-V1";
const DEVICE_AUDIT_EVENT_DOMAIN: &str = "GOODDEALER-DEVICE-AUDIT-EVENT-V1";
const DRAIN_PROOF_SIGNATURE_DOMAIN: &str = "GOODDEALER-DRAIN-PROOF-SIGNATURE-V1";
const DRAIN_PROOF_DIGEST_DOMAIN: &str = "GOODDEALER-DRAIN-PROOF-V1";
const REDACTED_WIRE_VALUE_MAXIMUM_DEPTH: usize = 32;
const REDACTED_WIRE_VALUE_MAXIMUM_NODES: usize = 4096;
const REDACTED_WIRE_VALUE_MAXIMUM_ARRAY_LENGTH: usize = 256;
const REDACTED_WIRE_VALUE_MAXIMUM_STRING_LENGTH: usize = 16_384;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrainStream {
    Mutation,
    ExecutionFact,
    DeviceAudit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DrainSequenceDomain<'a> {
    pub workspace_id: &'a str,
    pub source_device_id: &'a str,
    pub active_lease_epoch: u64,
    pub stream: DrainStream,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrainValidationError {
    InvalidJson,
    InvalidEnvelope,
    InvalidProof,
    InvalidDigestLength,
    EnvelopeTooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DrainManifest(DrainManifestWire);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SynchronizedBackupDrainProof(SynchronizedBackupDrainProofWire);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum DrainProof {
    Handoff(DrainManifest),
    SynchronizedBackup(SynchronizedBackupDrainProof),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmittedSyncMutation {
    schema_version: SafeUnsignedInteger,
    mutation_id: String,
    workspace_id: String,
    workspace_schema_version: SafeUnsignedInteger,
    entity_type: DomainAssetLiteral,
    entity_id: String,
    base_revision: SafeUnsignedInteger,
    changed_fields: Vec<DomainAssetChangedField>,
    source_device_id: String,
    active_lease_epoch: SafeUnsignedInteger,
    mutation_sequence: SafeUnsignedInteger,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    server_revision: Option<SafeUnsignedInteger>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum DomainAssetLiteral {
    #[serde(rename = "domain_asset")]
    DomainAsset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "fieldPath", deny_unknown_fields)]
enum DomainAssetChangedField {
    #[serde(rename = "note")]
    Note {
        #[serde(deserialize_with = "deserialize_required_option")]
        value: Option<String>,
    },
    #[serde(rename = "portfolioId")]
    PortfolioId {
        #[serde(deserialize_with = "deserialize_required_option")]
        value: Option<String>,
    },
    #[serde(rename = "tags")]
    Tags { value: Vec<String> },
    #[serde(rename = "targetPrice")]
    TargetPrice {
        #[serde(deserialize_with = "deserialize_required_option")]
        value: Option<CanonicalMoney>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CanonicalMoney {
    currency: String,
    amount: String,
}

impl SubmittedSyncMutation {
    fn is_valid(&self) -> bool {
        self.schema_version.get() == 1
            && is_identifier(&self.mutation_id)
            && is_identifier(&self.workspace_id)
            && self.workspace_schema_version.get() > 0
            && is_identifier(&self.entity_id)
            && is_identifier(&self.source_device_id)
            && self.active_lease_epoch.get() > 0
            && self.mutation_sequence.get() > 0
            && self.server_revision.is_none_or(|revision| {
                revision.get() > 0 && self.base_revision.get() < revision.get()
            })
            && (1..=4).contains(&self.changed_fields.len())
            && self
                .changed_fields
                .iter()
                .all(DomainAssetChangedField::is_valid)
            && self
                .changed_fields
                .windows(2)
                .all(|fields| fields[0].field_path().as_bytes() < fields[1].field_path().as_bytes())
    }
}

impl DomainAssetChangedField {
    const fn field_path(&self) -> &'static str {
        match self {
            Self::Note { .. } => "note",
            Self::PortfolioId { .. } => "portfolioId",
            Self::Tags { .. } => "tags",
            Self::TargetPrice { .. } => "targetPrice",
        }
    }

    fn is_valid(&self) -> bool {
        match self {
            Self::Note { value } => value.as_deref().is_none_or(is_valid_note),
            Self::PortfolioId { value } => value.as_deref().is_none_or(is_identifier),
            Self::Tags { value } => {
                value.len() <= 128
                    && value.iter().all(|tag| is_valid_tag(tag))
                    && value
                        .windows(2)
                        .all(|tags| tags[0].as_bytes() < tags[1].as_bytes())
            }
            Self::TargetPrice { value } => value.as_ref().is_none_or(CanonicalMoney::is_valid),
        }
    }
}

impl CanonicalMoney {
    fn is_valid(&self) -> bool {
        self.currency.len() == 3
            && self.currency.bytes().all(|byte| byte.is_ascii_uppercase())
            && is_canonical_amount(&self.amount)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionAuthorizationEvidence {
    approved_operation_digest: String,
    approved_operation_envelope: String,
    signing_key_id: String,
    signing_key_version: SafeUnsignedInteger,
    credential_epoch: SafeUnsignedInteger,
    signature_transcript_version: SafeUnsignedInteger,
}

impl ExecutionAuthorizationEvidence {
    fn is_valid(&self) -> bool {
        is_sha256_digest(&self.approved_operation_digest)
            && is_bounded_base64_url(&self.approved_operation_envelope, 8192)
            && is_identifier(&self.signing_key_id)
            && self.signing_key_version.get() > 0
            && self.credential_epoch.get() > 0
            && self.signature_transcript_version.get() > 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionFactWire {
    schema_version: SafeUnsignedInteger,
    execution_fact_id: String,
    operation_id: String,
    operation_item_id: String,
    workflow_node_id: String,
    attempt_id: String,
    attempt_no: SafeUnsignedInteger,
    approved_operation_id: String,
    plan_hash: String,
    idempotency_key_hash: String,
    source_device_id: String,
    workspace_id: String,
    active_lease_epoch: SafeUnsignedInteger,
    execution_sequence: SafeUnsignedInteger,
    event_type: String,
    evidence_level: String,
    occurred_at: String,
    signing_key_id: String,
    signing_key_version: SafeUnsignedInteger,
    credential_epoch: SafeUnsignedInteger,
    trusted_time_anchor_id: String,
    monotonic_delta_ms: SafeUnsignedInteger,
    request_start_boundary: String,
    authorization_hash: String,
    execution_authorization_evidence: ExecutionAuthorizationEvidence,
    signature_transcript_version: SafeUnsignedInteger,
    payload_redacted: Value,
    audit_event_ref: String,
    audit_event_hash: String,
    device_signature: String,
}

impl ExecutionFactWire {
    fn is_valid(&self) -> bool {
        self.schema_version.get() == 1
            && [
                &self.execution_fact_id,
                &self.operation_id,
                &self.operation_item_id,
                &self.workflow_node_id,
                &self.attempt_id,
                &self.approved_operation_id,
                &self.source_device_id,
                &self.workspace_id,
                &self.event_type,
                &self.evidence_level,
                &self.signing_key_id,
                &self.trusted_time_anchor_id,
                &self.audit_event_ref,
            ]
            .into_iter()
            .all(|value| is_identifier(value))
            && [
                self.attempt_no,
                self.active_lease_epoch,
                self.execution_sequence,
                self.signing_key_version,
                self.credential_epoch,
                self.signature_transcript_version,
            ]
            .into_iter()
            .all(|value| value.get() > 0)
            && [
                &self.plan_hash,
                &self.idempotency_key_hash,
                &self.authorization_hash,
                &self.audit_event_hash,
            ]
            .into_iter()
            .all(|value| is_sha256_digest(value))
            && is_canonical_utc_timestamp(&self.occurred_at)
            && is_canonical_utc_timestamp(&self.request_start_boundary)
            && self.execution_authorization_evidence.is_valid()
            && is_redacted_wire_value(&self.payload_redacted)
            && is_bounded_base64_url(&self.device_signature, 1024)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DeviceAuditEventType {
    UserSessionActivity,
    ApprovedOperationExecution,
    DeviceBindingLifecycle,
    RuntimeSecurityLifecycle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AuthorizationSource {
    UserSession,
    ApprovedOperation,
    DeviceBinding,
    RuntimeSecurityContext,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ActorKind {
    User,
    DeviceService,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum DeviceAuditKind {
    #[serde(rename = "device")]
    Device,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum DeviceAuditSigningPurpose {
    #[serde(rename = "device_identity_audit")]
    DeviceIdentityAudit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAuditCommonFields {
    schema_version: SafeUnsignedInteger,
    audit_event_id: String,
    audit_event_kind: DeviceAuditKind,
    event_type: DeviceAuditEventType,
    account_id: String,
    actor_kind: ActorKind,
    authorization_source: AuthorizationSource,
    target_type: String,
    target_ref: String,
    source_device_id: String,
    credential_epoch: SafeUnsignedInteger,
    chain_id: String,
    audit_sequence: SafeUnsignedInteger,
    previous_hash: String,
    event_hash: String,
    occurred_at: String,
    signing_key_id: String,
    signing_key_version: SafeUnsignedInteger,
    signing_key_purpose: DeviceAuditSigningPurpose,
    trusted_time_anchor_id: String,
    monotonic_delta_ms: SafeUnsignedInteger,
    authorization_context_hash: String,
    signature_transcript_version: SafeUnsignedInteger,
    payload_redacted: Value,
    device_signature: String,
}

impl DeviceAuditCommonFields {
    fn is_valid(&self) -> bool {
        self.schema_version.get() == 1
            && [
                &self.audit_event_id,
                &self.account_id,
                &self.target_type,
                &self.target_ref,
                &self.source_device_id,
                &self.signing_key_id,
                &self.trusted_time_anchor_id,
            ]
            .into_iter()
            .all(|value| is_identifier(value))
            && [
                self.credential_epoch,
                self.audit_sequence,
                self.signing_key_version,
                self.signature_transcript_version,
            ]
            .into_iter()
            .all(|value| value.get() > 0)
            && [
                &self.chain_id,
                &self.previous_hash,
                &self.event_hash,
                &self.authorization_context_hash,
            ]
            .into_iter()
            .all(|value| is_sha256_digest(value))
            && is_canonical_utc_timestamp(&self.occurred_at)
            && is_redacted_wire_value(&self.payload_redacted)
            && is_bounded_base64_url(&self.device_signature, 1024)
            && matches!(
                (self.event_type, self.authorization_source),
                (
                    DeviceAuditEventType::UserSessionActivity,
                    AuthorizationSource::UserSession
                ) | (
                    DeviceAuditEventType::ApprovedOperationExecution,
                    AuthorizationSource::ApprovedOperation
                ) | (
                    DeviceAuditEventType::DeviceBindingLifecycle,
                    AuthorizationSource::DeviceBinding
                ) | (
                    DeviceAuditEventType::RuntimeSecurityLifecycle,
                    AuthorizationSource::RuntimeSecurityContext
                )
            )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountDeviceAuditEventWire {
    #[serde(flatten)]
    common: DeviceAuditCommonFields,
    scope_kind: AccountScopeLiteral,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDeviceAuditEventWire {
    #[serde(flatten)]
    common: DeviceAuditCommonFields,
    scope_kind: WorkspaceScopeLiteral,
    workspace_id: String,
    active_lease_epoch: SafeUnsignedInteger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum AccountScopeLiteral {
    #[serde(rename = "account")]
    Account,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum WorkspaceScopeLiteral {
    #[serde(rename = "workspace")]
    Workspace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
enum DeviceAuditEventWire {
    Account(AccountDeviceAuditEventWire),
    Workspace(WorkspaceDeviceAuditEventWire),
}

impl DeviceAuditEventWire {
    fn common(&self) -> &DeviceAuditCommonFields {
        match self {
            Self::Account(event) => &event.common,
            Self::Workspace(event) => &event.common,
        }
    }

    fn is_valid(&self) -> bool {
        self.common().is_valid()
            && match self {
                Self::Account(_) => true,
                Self::Workspace(event) => {
                    is_identifier(&event.workspace_id) && event.active_lease_epoch.get() > 0
                }
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DrainStreamClaim {
    stream: DrainStream,
    last_assigned_sequence: SafeUnsignedInteger,
    contiguous_received_through: SafeUnsignedInteger,
    pending_count: SafeUnsignedInteger,
    rolling_digest: String,
}

impl DrainStreamClaim {
    fn is_valid(&self) -> bool {
        self.contiguous_received_through.get() <= self.last_assigned_sequence.get()
            && self.pending_count.get()
                == self.last_assigned_sequence.get() - self.contiguous_received_through.get()
            && self.pending_count.get() == 0
            && is_sha256_digest(&self.rolling_digest)
            && (self.last_assigned_sequence.get() != 0
                || self.rolling_digest == DRAIN_STREAM_GENESIS_DIGEST)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrainProofCommonFields {
    schema_version: SafeUnsignedInteger,
    typ: DrainProofTypeLiteral,
    aud: DrainProofAudienceLiteral,
    proof_id: String,
    workspace_id: String,
    source_device_id: String,
    active_lease_epoch: SafeUnsignedInteger,
    streams: [DrainStreamClaim; 3],
    canonical_codec_version: SafeUnsignedInteger,
    digest_algorithm: DrainDigestAlgorithmLiteral,
    issued_at: String,
    expires_at: String,
    signing_key_id: String,
    signing_key_version: SafeUnsignedInteger,
    signature_transcript_version: SafeUnsignedInteger,
    device_signature: String,
}

impl DrainProofCommonFields {
    fn is_valid(&self) -> bool {
        self.schema_version.get() == DRAIN_PROOF_SCHEMA_VERSION
            && is_identifier(&self.proof_id)
            && is_identifier(&self.workspace_id)
            && is_identifier(&self.source_device_id)
            && self.active_lease_epoch.get() > 0
            && self.canonical_codec_version.get() == 1
            && is_canonical_utc_timestamp(&self.issued_at)
            && is_canonical_utc_timestamp(&self.expires_at)
            && self.issued_at < self.expires_at
            && is_identifier(&self.signing_key_id)
            && self.signing_key_version.get() > 0
            && self.signature_transcript_version.get() > 0
            && is_bounded_base64_url(&self.device_signature, 1024)
            && self.streams[0].stream == DrainStream::Mutation
            && self.streams[1].stream == DrainStream::ExecutionFact
            && self.streams[2].stream == DrainStream::DeviceAudit
            && self.streams.iter().all(DrainStreamClaim::is_valid)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum DrainProofTypeLiteral {
    #[serde(rename = "gd.drain-proof.v1")]
    V1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum DrainProofAudienceLiteral {
    #[serde(rename = "gooddealer-cloud/drain-verification")]
    CloudDrainVerification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum DrainDigestAlgorithmLiteral {
    #[serde(rename = "sha256-chain-v1")]
    Sha256ChainV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum HandoffPurposeLiteral {
    #[serde(rename = "handoff")]
    Handoff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum SynchronizedBackupPurposeLiteral {
    #[serde(rename = "synchronized_backup")]
    SynchronizedBackup,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrainManifestWire {
    #[serde(flatten)]
    common: DrainProofCommonFields,
    purpose: HandoffPurposeLiteral,
    device_switch_request_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SynchronizedBackupDrainProofWire {
    #[serde(flatten)]
    common: DrainProofCommonFields,
    purpose: SynchronizedBackupPurposeLiteral,
    synchronized_snapshot_binding: SynchronizedSnapshotBinding,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SynchronizedSnapshotBinding {
    local_commit_sequence: SafeUnsignedInteger,
    server_revision: SafeUnsignedInteger,
}

impl DrainManifestWire {
    fn is_valid(&self) -> bool {
        self.common.is_valid() && is_identifier(&self.device_switch_request_id)
    }
}

impl SynchronizedBackupDrainProofWire {
    fn is_valid(&self) -> bool {
        self.common.is_valid()
    }
}

/// Parses and semantically validates the strict Rust mirror of a drain proof.
///
/// # Errors
///
/// Returns [`DrainValidationError::InvalidJson`] for malformed JSON and
/// [`DrainValidationError::InvalidProof`] for any structural or semantic mismatch.
pub fn validate_drain_proof_json(source: &str) -> Result<DrainProof, DrainValidationError> {
    let value: Value =
        serde_json::from_str(source).map_err(|_| DrainValidationError::InvalidJson)?;
    parse_drain_proof_value(value)
}

/// Parses a handoff-only `DrainManifest`, rejecting synchronized-backup proofs.
///
/// # Errors
///
/// Returns [`DrainValidationError`] when the JSON or manifest contract is invalid.
pub fn validate_drain_manifest_json(source: &str) -> Result<DrainManifest, DrainValidationError> {
    match validate_drain_proof_json(source)? {
        DrainProof::Handoff(manifest) => Ok(manifest),
        DrainProof::SynchronizedBackup(_) => Err(DrainValidationError::InvalidProof),
    }
}

fn parse_drain_proof_value(value: Value) -> Result<DrainProof, DrainValidationError> {
    let purpose = value
        .as_object()
        .and_then(|object| object.get("purpose"))
        .and_then(Value::as_str)
        .ok_or(DrainValidationError::InvalidProof)?;
    match purpose {
        "handoff" => {
            require_exact_keys(&value, &DRAIN_MANIFEST_KEYS)
                .map_err(|()| DrainValidationError::InvalidProof)?;
            let raw: DrainManifestWire =
                serde_json::from_value(value).map_err(|_| DrainValidationError::InvalidProof)?;
            if !raw.is_valid() {
                return Err(DrainValidationError::InvalidProof);
            }
            Ok(DrainProof::Handoff(DrainManifest(raw)))
        }
        "synchronized_backup" => {
            require_exact_keys(&value, &SYNCHRONIZED_BACKUP_KEYS)
                .map_err(|()| DrainValidationError::InvalidProof)?;
            let raw: SynchronizedBackupDrainProofWire =
                serde_json::from_value(value).map_err(|_| DrainValidationError::InvalidProof)?;
            if !raw.is_valid() {
                return Err(DrainValidationError::InvalidProof);
            }
            Ok(DrainProof::SynchronizedBackup(
                SynchronizedBackupDrainProof(raw),
            ))
        }
        _ => Err(DrainValidationError::InvalidProof),
    }
}

const DRAIN_MANIFEST_KEYS: [&str; 18] = [
    "schemaVersion",
    "typ",
    "aud",
    "proofId",
    "workspaceId",
    "sourceDeviceId",
    "activeLeaseEpoch",
    "streams",
    "canonicalCodecVersion",
    "digestAlgorithm",
    "issuedAt",
    "expiresAt",
    "signingKeyId",
    "signingKeyVersion",
    "signatureTranscriptVersion",
    "deviceSignature",
    "purpose",
    "deviceSwitchRequestId",
];
const SYNCHRONIZED_BACKUP_KEYS: [&str; 18] = [
    "schemaVersion",
    "typ",
    "aud",
    "proofId",
    "workspaceId",
    "sourceDeviceId",
    "activeLeaseEpoch",
    "streams",
    "canonicalCodecVersion",
    "digestAlgorithm",
    "issuedAt",
    "expiresAt",
    "signingKeyId",
    "signingKeyVersion",
    "signatureTranscriptVersion",
    "deviceSignature",
    "purpose",
    "synchronizedSnapshotBinding",
];

const DEVICE_AUDIT_COMMON_KEYS: [&str; 26] = [
    "schemaVersion",
    "auditEventId",
    "auditEventKind",
    "eventType",
    "accountId",
    "actorKind",
    "authorizationSource",
    "targetType",
    "targetRef",
    "sourceDeviceId",
    "credentialEpoch",
    "chainId",
    "auditSequence",
    "previousHash",
    "eventHash",
    "occurredAt",
    "signingKeyId",
    "signingKeyVersion",
    "signingKeyPurpose",
    "trustedTimeAnchorId",
    "monotonicDeltaMs",
    "authorizationContextHash",
    "signatureTranscriptVersion",
    "payloadRedacted",
    "deviceSignature",
    "scopeKind",
];

fn parse_device_audit_value(value: Value) -> Result<DeviceAuditEventWire, DrainValidationError> {
    let scope = value
        .as_object()
        .and_then(|object| object.get("scopeKind"))
        .and_then(Value::as_str)
        .ok_or(DrainValidationError::InvalidEnvelope)?;
    let event = match scope {
        "account" => {
            require_exact_keys(&value, &DEVICE_AUDIT_COMMON_KEYS)
                .map_err(|()| DrainValidationError::InvalidEnvelope)?;
            DeviceAuditEventWire::Account(
                serde_json::from_value(value).map_err(|_| DrainValidationError::InvalidEnvelope)?,
            )
        }
        "workspace" => {
            let mut keys = DEVICE_AUDIT_COMMON_KEYS.to_vec();
            keys.extend(["workspaceId", "activeLeaseEpoch"]);
            require_exact_keys(&value, &keys)
                .map_err(|()| DrainValidationError::InvalidEnvelope)?;
            DeviceAuditEventWire::Workspace(
                serde_json::from_value(value).map_err(|_| DrainValidationError::InvalidEnvelope)?,
            )
        }
        _ => return Err(DrainValidationError::InvalidEnvelope),
    };
    if !event.is_valid() {
        return Err(DrainValidationError::InvalidEnvelope);
    }
    Ok(event)
}

/// Encodes the device-committed mutation envelope, excluding `serverRevision` enrichment.
///
/// # Errors
///
/// Returns [`DrainValidationError`] when the input does not match either mutation wire schema.
pub fn encode_mutation_drain_envelope_json(source: &str) -> Result<Vec<u8>, DrainValidationError> {
    let mut mutation: SubmittedSyncMutation =
        serde_json::from_str(source).map_err(|_| DrainValidationError::InvalidJson)?;
    if !mutation.is_valid() {
        return Err(DrainValidationError::InvalidEnvelope);
    }
    mutation.server_revision = None;
    let value =
        serde_json::to_value(mutation).map_err(|_| DrainValidationError::InvalidEnvelope)?;
    Ok(encode_domain_separated_wire_value(
        MUTATION_ENVELOPE_DOMAIN,
        &value,
    ))
}

/// Encodes an execution-fact envelope after removing the three Cloud enrichment fields.
///
/// # Errors
///
/// Returns [`DrainValidationError`] when the device-committed fact is invalid.
pub fn encode_execution_fact_drain_envelope_json(
    source: &str,
) -> Result<Vec<u8>, DrainValidationError> {
    let mut value: Value =
        serde_json::from_str(source).map_err(|_| DrainValidationError::InvalidJson)?;
    let object = value
        .as_object_mut()
        .ok_or(DrainValidationError::InvalidEnvelope)?;
    object.remove("receivedAt");
    object.remove("classification");
    object.remove("quarantineState");
    let fact: ExecutionFactWire =
        serde_json::from_value(value).map_err(|_| DrainValidationError::InvalidEnvelope)?;
    if !fact.is_valid() {
        return Err(DrainValidationError::InvalidEnvelope);
    }
    encode_signed_envelope(EXECUTION_FACT_DOMAIN, fact, |fact| &fact.device_signature)
}

/// Encodes an account- or workspace-scoped device-audit envelope.
///
/// # Errors
///
/// Returns [`DrainValidationError`] when the event is not a strict device-audit event.
pub fn encode_device_audit_drain_envelope_json(
    source: &str,
) -> Result<Vec<u8>, DrainValidationError> {
    let value: Value =
        serde_json::from_str(source).map_err(|_| DrainValidationError::InvalidJson)?;
    let event = parse_device_audit_value(value)?;
    encode_signed_envelope(DEVICE_AUDIT_EVENT_DOMAIN, event, |event| {
        &event.common().device_signature
    })
}

fn encode_signed_envelope<T, F>(
    domain: &str,
    value: T,
    signature: F,
) -> Result<Vec<u8>, DrainValidationError>
where
    T: Serialize,
    F: FnOnce(&T) -> &str,
{
    let device_signature = signature(&value).to_owned();
    let mut unsigned =
        serde_json::to_value(value).map_err(|_| DrainValidationError::InvalidEnvelope)?;
    unsigned
        .as_object_mut()
        .ok_or(DrainValidationError::InvalidEnvelope)?
        .remove("deviceSignature");
    let mut output = encode_domain_separated_wire_value(domain, &unsigned);
    output.extend(encode_length_prefixed_drain_bytes(
        device_signature.as_bytes(),
    )?);
    Ok(output)
}

/// Encodes the derived sequence domain for one drain stream.
///
/// # Errors
///
/// Returns [`DrainValidationError::InvalidEnvelope`] for invalid identifiers or epoch zero.
pub fn encode_drain_sequence_domain(
    domain: &DrainSequenceDomain<'_>,
) -> Result<Vec<u8>, DrainValidationError> {
    if !is_identifier(domain.workspace_id)
        || !is_identifier(domain.source_device_id)
        || domain.active_lease_epoch == 0
        || domain.active_lease_epoch > crate::wire_scalar::MAX_JAVASCRIPT_SAFE_INTEGER
    {
        return Err(DrainValidationError::InvalidEnvelope);
    }
    let value = serde_json::json!({
        "workspaceId": domain.workspace_id,
        "sourceDeviceId": domain.source_device_id,
        "activeLeaseEpoch": domain.active_lease_epoch,
        "stream": domain.stream,
    });
    Ok(encode_domain_separated_wire_value(
        DRAIN_SEQUENCE_DOMAIN,
        &value,
    ))
}

/// Encodes the workspace device-audit chain-id domain.
///
/// # Errors
///
/// Returns [`DrainValidationError::InvalidEnvelope`] for an invalid domain field.
pub fn encode_workspace_device_audit_chain_domain(
    workspace_id: &str,
    source_device_id: &str,
    active_lease_epoch: u64,
) -> Result<Vec<u8>, DrainValidationError> {
    encode_device_audit_chain_domain(
        &serde_json::json!({
            "scope": "workspace",
            "workspaceId": workspace_id,
            "sourceDeviceId": source_device_id,
            "activeLeaseEpoch": active_lease_epoch,
        }),
        [workspace_id, source_device_id],
        active_lease_epoch,
    )
}

/// Encodes the account device-audit chain-id domain.
///
/// # Errors
///
/// Returns [`DrainValidationError::InvalidEnvelope`] for an invalid domain field.
pub fn encode_account_device_audit_chain_domain(
    account_id: &str,
    source_device_id: &str,
    credential_epoch: u64,
) -> Result<Vec<u8>, DrainValidationError> {
    encode_device_audit_chain_domain(
        &serde_json::json!({
            "scope": "account",
            "accountId": account_id,
            "sourceDeviceId": source_device_id,
            "credentialEpoch": credential_epoch,
        }),
        [account_id, source_device_id],
        credential_epoch,
    )
}

fn encode_device_audit_chain_domain(
    value: &Value,
    identifiers: [&str; 2],
    epoch: u64,
) -> Result<Vec<u8>, DrainValidationError> {
    if !identifiers.into_iter().all(is_identifier)
        || epoch == 0
        || epoch > crate::wire_scalar::MAX_JAVASCRIPT_SAFE_INTEGER
    {
        return Err(DrainValidationError::InvalidEnvelope);
    }
    Ok(encode_domain_separated_wire_value(
        DEVICE_AUDIT_CHAIN_DOMAIN,
        value,
    ))
}

/// Encodes the `sha256-chain-v1` step input as `digest || uint32_be(len) || envelope`.
///
/// # Errors
///
/// Returns [`DrainValidationError::InvalidDigestLength`] unless the prior digest is 32 bytes,
/// or [`DrainValidationError::EnvelopeTooLarge`] when its length does not fit `uint32`.
pub fn encode_drain_chain_step_input(
    previous_digest: &[u8],
    envelope: &[u8],
) -> Result<Vec<u8>, DrainValidationError> {
    if previous_digest.len() != 32 {
        return Err(DrainValidationError::InvalidDigestLength);
    }
    let envelope_length =
        u32::try_from(envelope.len()).map_err(|_| DrainValidationError::EnvelopeTooLarge)?;
    let mut output = Vec::with_capacity(36 + envelope.len());
    output.extend_from_slice(previous_digest);
    output.extend_from_slice(&envelope_length.to_be_bytes());
    output.extend_from_slice(envelope);
    Ok(output)
}

/// Recomputes one `sha256-chain-v1` digest from the prior digest and canonical envelope.
///
/// # Errors
///
/// Returns the same framing errors as [`encode_drain_chain_step_input`].
pub fn advance_drain_chain_digest(
    previous_digest: &[u8],
    envelope: &[u8],
) -> Result<[u8; 32], DrainValidationError> {
    Ok(sha256(&encode_drain_chain_step_input(
        previous_digest,
        envelope,
    )?))
}

/// Computes the `sha256-chain-v1` genesis digest from its fixed domain bytes.
#[must_use]
pub fn drain_stream_genesis_digest() -> [u8; 32] {
    sha256(DRAIN_STREAM_GENESIS_DOMAIN.as_bytes())
}

/// Encodes the device-signature transcript for an already signed drain proof.
///
/// # Errors
///
/// Returns [`DrainValidationError`] when serialization of the validated proof fails.
pub fn encode_drain_proof_signature_transcript(
    proof: &DrainProof,
) -> Result<Vec<u8>, DrainValidationError> {
    let mut value = serde_json::to_value(proof).map_err(|_| DrainValidationError::InvalidProof)?;
    value
        .as_object_mut()
        .ok_or(DrainValidationError::InvalidProof)?
        .remove("deviceSignature");
    Ok(encode_domain_separated_wire_value(
        DRAIN_PROOF_SIGNATURE_DOMAIN,
        &value,
    ))
}

/// Encodes the signed proof input under its distinct digest domain.
///
/// # Errors
///
/// Returns [`DrainValidationError`] when proof serialization or length framing fails.
pub fn encode_drain_proof_digest_input(
    proof: &DrainProof,
) -> Result<Vec<u8>, DrainValidationError> {
    let transcript = encode_drain_proof_signature_transcript(proof)?;
    let signature = match proof {
        DrainProof::Handoff(manifest) => &manifest.0.common.device_signature,
        DrainProof::SynchronizedBackup(backup) => &backup.0.common.device_signature,
    };
    let mut canonical_signed_proof = transcript;
    canonical_signed_proof.extend(encode_length_prefixed_drain_bytes(signature.as_bytes())?);
    let mut output = DRAIN_PROOF_DIGEST_DOMAIN.as_bytes().to_vec();
    output.extend(encode_length_prefixed_drain_bytes(&canonical_signed_proof)?);
    Ok(output)
}

fn encode_length_prefixed_drain_bytes(value: &[u8]) -> Result<Vec<u8>, DrainValidationError> {
    let length = u32::try_from(value.len()).map_err(|_| DrainValidationError::EnvelopeTooLarge)?;
    let mut output = Vec::with_capacity(4 + value.len());
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(value);
    Ok(output)
}

fn encode_domain_separated_wire_value(domain: &str, value: &Value) -> Vec<u8> {
    let mut output = frame(b'd', domain.as_bytes());
    output.extend(frame(b'v', &encode_canonical_wire_value(value)));
    output
}

fn encode_canonical_wire_value(value: &Value) -> Vec<u8> {
    match value {
        Value::Null => b"z0:".to_vec(),
        Value::Bool(value) => {
            if *value {
                b"b1:1".to_vec()
            } else {
                b"b1:0".to_vec()
            }
        }
        Value::Number(value) => {
            let canonical = safe_unsigned_wire_number(value)
                .map_or_else(|| value.to_string(), |value| value.to_string());
            frame(b'n', canonical.as_bytes())
        }
        Value::String(value) => frame(b's', value.as_bytes()),
        Value::Array(values) => {
            let payload = values.iter().fold(Vec::new(), |mut output, value| {
                output.extend(frame(b'e', &encode_canonical_wire_value(value)));
                output
            });
            frame(b'a', &payload)
        }
        Value::Object(object) => {
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_unstable();
            let payload = keys.into_iter().fold(Vec::new(), |mut output, key| {
                let mut entry = frame(b'k', key.as_bytes());
                entry.extend(frame(b'v', &encode_canonical_wire_value(&object[key])));
                output.extend(frame(b'e', &entry));
                output
            });
            frame(b'o', &payload)
        }
    }
}

fn frame(tag: u8, payload: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(1 + payload.len().to_string().len() + 1 + payload.len());
    output.push(tag);
    output.extend(payload.len().to_string().as_bytes());
    output.push(b':');
    output.extend(payload);
    output
}

fn require_exact_keys(value: &Value, expected: &[&str]) -> Result<(), ()> {
    let object = value.as_object().ok_or(())?;
    if object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key)) {
        Ok(())
    } else {
        Err(())
    }
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    let value = Value::deserialize(deserializer)?;
    if value.is_null() {
        return Err(serde::de::Error::custom(
            "expected a non-null optional value",
        ));
    }
    T::deserialize(value)
        .map(Some)
        .map_err(serde::de::Error::custom)
}

fn is_sha256_digest(value: &str) -> bool {
    value.len() == 43 && is_base64_url(value)
}

fn is_bounded_base64_url(value: &str, maximum: usize) -> bool {
    value.len() <= maximum && is_base64_url(value)
}

fn safe_unsigned_wire_number(number: &serde_json::Number) -> Option<u64> {
    if let Some(value) = number.as_u64() {
        return (value <= crate::wire_scalar::MAX_JAVASCRIPT_SAFE_INTEGER).then_some(value);
    }
    let value = number.as_f64().filter(|value| {
        value.is_finite()
            && *value >= 0.0
            && value.fract() == 0.0
            && *value <= 9_007_199_254_740_991.0
    })?;
    if value == 0.0 {
        Some(0)
    } else {
        format!("{value:.0}").parse().ok()
    }
}

fn is_valid_note(value: &str) -> bool {
    value.encode_utf16().count() <= 10_000
        && value.chars().all(|character| {
            !matches!(
                character,
                '\u{0000}'..='\u{0008}'
                    | '\u{000B}'
                    | '\u{000C}'
                    | '\u{000E}'..='\u{001F}'
                    | '\u{007F}'..='\u{009F}'
                    | '\u{00AD}'
                    | '\u{061C}'
                    | '\u{200B}'..='\u{200F}'
                    | '\u{202A}'..='\u{202E}'
                    | '\u{2060}'..='\u{206F}'
                    | '\u{FEFF}'
            )
        })
}

fn is_valid_tag(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 64
        && value.trim() == value
        && value.chars().all(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '\u{00AD}'
                        | '\u{061C}'
                        | '\u{200B}'..='\u{200F}'
                        | '\u{202A}'..='\u{202E}'
                        | '\u{2060}'..='\u{206F}'
                        | '\u{FEFF}'
                )
        })
}

fn is_canonical_amount(value: &str) -> bool {
    let mut parts = value.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some()
        || integer.is_empty()
        || integer.len() > 16
        || !integer.bytes().all(|byte| byte.is_ascii_digit())
        || (integer != "0" && integer.starts_with('0'))
    {
        return false;
    }
    fraction.is_none_or(|fraction| {
        (1..=8).contains(&fraction.len())
            && fraction.bytes().all(|byte| byte.is_ascii_digit())
            && fraction.as_bytes().last().is_some_and(|byte| *byte != b'0')
    })
}

fn is_redacted_wire_value(value: &Value) -> bool {
    let mut pending = vec![(value, 0_usize)];
    let mut nodes = 0_usize;

    while let Some((current, depth)) = pending.pop() {
        if depth > REDACTED_WIRE_VALUE_MAXIMUM_DEPTH {
            return false;
        }

        nodes += 1;
        if nodes > REDACTED_WIRE_VALUE_MAXIMUM_NODES {
            return false;
        }

        match current {
            Value::Null | Value::Bool(_) => {}
            Value::Number(number) => {
                if safe_unsigned_wire_number(number).is_none() {
                    return false;
                }
            }
            Value::String(value) => {
                if value.encode_utf16().count() > REDACTED_WIRE_VALUE_MAXIMUM_STRING_LENGTH {
                    return false;
                }
            }
            Value::Array(values) => {
                if values.len() > REDACTED_WIRE_VALUE_MAXIMUM_ARRAY_LENGTH {
                    return false;
                }
                pending.extend(values.iter().rev().map(|value| (value, depth + 1)));
            }
            Value::Object(object) => {
                if !object.keys().all(|key| is_identifier(key)) {
                    return false;
                }
                pending.extend(object.values().rev().map(|value| (value, depth + 1)));
            }
        }
    }

    true
}

// This implementation is local to the mirror so adding chain parity does not mutate the
// workspace lockfile. It is the standard FIPS 180-4 compression function and is exercised by
// every shared genesis/step digest below.
// The conventional a-h working-variable names and contiguous round constants keep comparison
// against FIPS 180-4 direct; splitting or renaming them would make this fixed algorithm harder to
// audit without changing its behavior.
#[allow(clippy::many_single_char_names, clippy::too_many_lines)]
fn sha256(input: &[u8]) -> [u8; 32] {
    const INITIAL: [u32; 8] = [
        0x6a09_e667,
        0xbb67_ae85,
        0x3c6e_f372,
        0xa54f_f53a,
        0x510e_527f,
        0x9b05_688c,
        0x1f83_d9ab,
        0x5be0_cd19,
    ];
    const ROUND: [u32; 64] = [
        0x428a_2f98,
        0x7137_4491,
        0xb5c0_fbcf,
        0xe9b5_dba5,
        0x3956_c25b,
        0x59f1_11f1,
        0x923f_82a4,
        0xab1c_5ed5,
        0xd807_aa98,
        0x1283_5b01,
        0x2431_85be,
        0x550c_7dc3,
        0x72be_5d74,
        0x80de_b1fe,
        0x9bdc_06a7,
        0xc19b_f174,
        0xe49b_69c1,
        0xefbe_4786,
        0x0fc1_9dc6,
        0x240c_a1cc,
        0x2de9_2c6f,
        0x4a74_84aa,
        0x5cb0_a9dc,
        0x76f9_88da,
        0x983e_5152,
        0xa831_c66d,
        0xb003_27c8,
        0xbf59_7fc7,
        0xc6e0_0bf3,
        0xd5a7_9147,
        0x06ca_6351,
        0x1429_2967,
        0x27b7_0a85,
        0x2e1b_2138,
        0x4d2c_6dfc,
        0x5338_0d13,
        0x650a_7354,
        0x766a_0abb,
        0x81c2_c92e,
        0x9272_2c85,
        0xa2bf_e8a1,
        0xa81a_664b,
        0xc24b_8b70,
        0xc76c_51a3,
        0xd192_e819,
        0xd699_0624,
        0xf40e_3585,
        0x106a_a070,
        0x19a4_c116,
        0x1e37_6c08,
        0x2748_774c,
        0x34b0_bcb5,
        0x391c_0cb3,
        0x4ed8_aa4a,
        0x5b9c_ca4f,
        0x682e_6ff3,
        0x748f_82ee,
        0x78a5_636f,
        0x84c8_7814,
        0x8cc7_0208,
        0x90be_fffa,
        0xa450_6ceb,
        0xbef9_a3f7,
        0xc671_78f2,
    ];

    let bit_length = u64::try_from(input.len())
        .expect("slice length fits u64")
        .wrapping_mul(8);
    let mut padded = input.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_length.to_be_bytes());

    let mut state = INITIAL;
    for chunk in padded.chunks_exact(64) {
        let mut words = [0_u32; 64];
        for (index, bytes) in chunk.chunks_exact(4).enumerate() {
            words[index] =
                u32::from_be_bytes(bytes.try_into().expect("four-byte chunk has fixed length"));
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for index in 0..64 {
            let sigma1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ (!e & g);
            let temporary1 = h
                .wrapping_add(sigma1)
                .wrapping_add(choice)
                .wrapping_add(ROUND[index])
                .wrapping_add(words[index]);
            let sigma0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temporary2 = sigma0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temporary1);
            d = c;
            c = b;
            b = a;
            a = temporary1.wrapping_add(temporary2);
        }
        for (target, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *target = target.wrapping_add(value);
        }
    }

    let mut digest = [0_u8; 32];
    for (output, word) in digest.chunks_exact_mut(4).zip(state) {
        output.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde::Deserialize;

    use super::{
        DRAIN_STREAM_GENESIS_DIGEST, DRAIN_STREAM_GENESIS_DOMAIN, DrainProof, DrainSequenceDomain,
        DrainStream, REDACTED_WIRE_VALUE_MAXIMUM_ARRAY_LENGTH, REDACTED_WIRE_VALUE_MAXIMUM_DEPTH,
        REDACTED_WIRE_VALUE_MAXIMUM_NODES, REDACTED_WIRE_VALUE_MAXIMUM_STRING_LENGTH,
        advance_drain_chain_digest, encode_account_device_audit_chain_domain,
        encode_canonical_wire_value, encode_device_audit_drain_envelope_json,
        encode_drain_proof_digest_input, encode_drain_proof_signature_transcript,
        encode_drain_sequence_domain, encode_execution_fact_drain_envelope_json,
        encode_mutation_drain_envelope_json, encode_workspace_device_audit_chain_domain,
        is_redacted_wire_value, sha256, validate_drain_manifest_json, validate_drain_proof_json,
    };

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RedactedWireValueCorpus {
        limits: RedactedWireValueLimits,
        cases: Vec<RedactedWireValueCase>,
    }

    #[derive(Deserialize)]
    struct RedactedWireValueLimits {
        #[serde(rename = "maximumDepth")]
        depth: usize,
        #[serde(rename = "maximumNodes")]
        nodes: usize,
        #[serde(rename = "maximumArrayLength")]
        array_length: usize,
        #[serde(rename = "maximumStringLength")]
        string_length: usize,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RedactedWireValueCase {
        name: String,
        valid: bool,
        shape: RedactedWireValueShape,
        size: Option<usize>,
        value: Option<serde_json::Value>,
        expected_canonical_sha256: Option<String>,
    }

    #[derive(Deserialize)]
    enum RedactedWireValueShape {
        #[serde(rename = "nestedArray")]
        NestedArray,
        #[serde(rename = "objectWithNullFields")]
        ObjectWithNullFields,
        #[serde(rename = "arrayWithNullItems")]
        ArrayWithNullItems,
        #[serde(rename = "repeatedString")]
        RepeatedString,
        #[serde(rename = "literal")]
        Literal,
    }

    fn materialize_redacted_wire_value(test_case: &RedactedWireValueCase) -> serde_json::Value {
        match test_case.shape {
            RedactedWireValueShape::NestedArray => {
                let mut value = serde_json::Value::Null;
                for _ in 0..test_case.size.unwrap_or_default() {
                    value = serde_json::Value::Array(vec![value]);
                }
                value
            }
            RedactedWireValueShape::ObjectWithNullFields => {
                let object = (0..test_case.size.unwrap_or_default())
                    .map(|index| (format!("k{index}"), serde_json::Value::Null))
                    .collect();
                serde_json::Value::Object(object)
            }
            RedactedWireValueShape::ArrayWithNullItems => serde_json::Value::Array(vec![
                serde_json::Value::Null;
                test_case.size.unwrap_or_default()
            ]),
            RedactedWireValueShape::RepeatedString => {
                let scalar = test_case
                    .value
                    .as_ref()
                    .and_then(serde_json::Value::as_str)
                    .expect("repeatedString requires a string value");
                serde_json::Value::String(scalar.repeat(test_case.size.unwrap_or_default()))
            }
            RedactedWireValueShape::Literal => {
                test_case.value.clone().expect("literal requires a value")
            }
        }
    }

    const VALID_PROOFS: [(&str, &str); 4] = [
        (
            "proof-handoff-all-empty.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/valid/proof-handoff-all-empty.json"
            ),
        ),
        (
            "proof-handoff-mixed-empty.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/valid/proof-handoff-mixed-empty.json"
            ),
        ),
        (
            "proof-handoff-three-streams.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/valid/proof-handoff-three-streams.json"
            ),
        ),
        (
            "proof-synchronized-backup.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/valid/proof-synchronized-backup.json"
            ),
        ),
    ];
    const INVALID_PROOFS: [(&str, &str); 18] = [
        (
            "proof-backup-with-request-id.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-backup-with-request-id.json"
            ),
        ),
        (
            "proof-codec-version-two.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-codec-version-two.json"
            ),
        ),
        (
            "proof-contiguous-behind-assigned.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-contiguous-behind-assigned.json"
            ),
        ),
        (
            "proof-digest-algorithm-unknown.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-digest-algorithm-unknown.json"
            ),
        ),
        (
            "proof-empty-stream-nongenesis-digest.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-empty-stream-nongenesis-digest.json"
            ),
        ),
        (
            "proof-expires-before-issued.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-expires-before-issued.json"
            ),
        ),
        (
            "proof-handoff-missing-request-id.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-handoff-missing-request-id.json"
            ),
        ),
        (
            "proof-handoff-with-backup-binding.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-handoff-with-backup-binding.json"
            ),
        ),
        (
            "proof-lease-epoch-zero.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-lease-epoch-zero.json"
            ),
        ),
        (
            "proof-pending-nonzero.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-pending-nonzero.json"
            ),
        ),
        (
            "proof-rolling-digest-length.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-rolling-digest-length.json"
            ),
        ),
        (
            "proof-snake-case-wire.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-snake-case-wire.json"
            ),
        ),
        (
            "proof-stream-account-device-audit.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-stream-account-device-audit.json"
            ),
        ),
        (
            "proof-stream-duplicated.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-stream-duplicated.json"
            ),
        ),
        (
            "proof-stream-missing.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-stream-missing.json"
            ),
        ),
        (
            "proof-stream-reordered.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-stream-reordered.json"
            ),
        ),
        (
            "proof-stream-unknown-name.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-stream-unknown-name.json"
            ),
        ),
        (
            "proof-unknown-field.json",
            include_str!(
                "../../../packages/protocol/test-vectors/drain/invalid/proof-unknown-field.json"
            ),
        ),
    ];

    #[test]
    fn mirrors_every_shared_proof_vector_verdict() {
        for (name, source) in VALID_PROOFS {
            let proof = validate_drain_proof_json(source)
                .unwrap_or_else(|error| panic!("TypeScript accepts valid/{name}: {error:?}"));
            if name.starts_with("proof-handoff") {
                assert!(
                    validate_drain_manifest_json(source).is_ok(),
                    "handoff manifest {name}"
                );
                assert!(matches!(proof, DrainProof::Handoff(_)));
            } else {
                assert!(validate_drain_manifest_json(source).is_err());
                assert!(matches!(proof, DrainProof::SynchronizedBackup(_)));
            }
        }
        for (name, source) in INVALID_PROOFS {
            assert!(
                validate_drain_proof_json(source).is_err(),
                "TypeScript rejects invalid/{name}"
            );
        }
    }

    #[test]
    fn pins_typescript_envelope_and_proof_digests() {
        let mutation = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/mutation-submitted.json"
        );
        let enriched = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/mutation-server-enriched.json"
        );
        let fact = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/execution-fact.json"
        );
        let account_audit = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/device-audit-account.json"
        );
        let workspace_audit = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/device-audit-workspace.json"
        );
        let proof = validate_drain_proof_json(VALID_PROOFS[2].1).expect("shared proof is valid");

        let mutation_envelope = encode_mutation_drain_envelope_json(mutation).expect("mutation");
        assert_eq!(
            mutation_envelope,
            encode_mutation_drain_envelope_json(enriched).expect("enriched mutation")
        );
        assert_digest(
            &mutation_envelope,
            "-rJZQVVa2abp5-tP_23kG8mnk9-nBBLgtYga1Lpm0AI",
        );
        assert_digest(
            &encode_execution_fact_drain_envelope_json(fact).expect("fact"),
            "UKQxe32lm0Hr4rutp8FSvJHHljNBwdLBhsSnFxnHebo",
        );
        assert_digest(
            &encode_device_audit_drain_envelope_json(account_audit).expect("account audit"),
            "fAHpQJ-mescIlXS7HvH8bavuQ8grbXtOcT0qYVdpKCc",
        );
        assert_digest(
            &encode_device_audit_drain_envelope_json(workspace_audit).expect("workspace audit"),
            "L2zd005Nd-s1O6qra6AZjmNKizSTubu4tgoxB0bHEjw",
        );
        assert_digest(
            &encode_drain_proof_signature_transcript(&proof).expect("proof transcript"),
            "qiD196D0e2kn_0eKxd7UiFQoa68laqzx8cKUQIzDX_8",
        );
        assert_digest(
            &encode_drain_proof_digest_input(&proof).expect("proof digest input"),
            "NsJxtr1QEVKfM_-1xKXqCVi9e5zeva_Z18UxqRglrPs",
        );
    }

    #[test]
    fn mirrors_encoder_treatment_of_shared_invalid_execution_event_vectors() {
        const INVALID_FACTS: [(&str, &str); 2] = [
            (
                "execution-fact-evidence-oversize.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/execution-fact-evidence-oversize.json"
                ),
            ),
            (
                "execution-fact-missing-approved-operation.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/execution-fact-missing-approved-operation.json"
                ),
            ),
        ];
        const INVALID_AUDITS: [(&str, &str); 6] = [
            (
                "audit-kind-service.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/audit-kind-service.json"
                ),
            ),
            (
                "audit-kind-staff.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/audit-kind-staff.json"
                ),
            ),
            (
                "audit-kind-user.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/audit-kind-user.json"
                ),
            ),
            (
                "device-audit-account-with-lease-epoch.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/device-audit-account-with-lease-epoch.json"
                ),
            ),
            (
                "device-audit-with-approved-operation-authorization.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/device-audit-with-approved-operation-authorization.json"
                ),
            ),
            (
                "device-audit-workspace-missing-workspace-id.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/device-audit-workspace-missing-workspace-id.json"
                ),
            ),
        ];
        for (name, source) in INVALID_FACTS {
            assert!(
                encode_execution_fact_drain_envelope_json(source).is_err(),
                "{name}"
            );
        }
        for (name, source) in INVALID_AUDITS {
            assert!(
                encode_device_audit_drain_envelope_json(source).is_err(),
                "{name}"
            );
        }

        let base = encode_execution_fact_drain_envelope_json(include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/execution-fact.json"
        ))
        .expect("base execution fact");
        for (name, source) in [
            (
                "execution-fact-with-late-classification.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/execution-fact-with-late-classification.json"
                ),
            ),
            (
                "execution-fact-with-received-at.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/execution-events/invalid/execution-fact-with-received-at.json"
                ),
            ),
        ] {
            assert_eq!(
                encode_execution_fact_drain_envelope_json(source)
                    .unwrap_or_else(|error| panic!("{name}: {error:?}")),
                base,
                "the TypeScript encoder strips server enrichment in {name}"
            );
        }
    }

    #[test]
    fn mirrors_the_shared_redacted_wire_value_budget_corpus() {
        let corpus: RedactedWireValueCorpus = serde_json::from_str(include_str!(
            "../../../packages/protocol/test-vectors/execution-events/redacted-wire-value-budget.json"
        ))
        .expect("shared redacted wire value corpus");
        assert_eq!(corpus.limits.depth, REDACTED_WIRE_VALUE_MAXIMUM_DEPTH);
        assert_eq!(corpus.limits.nodes, REDACTED_WIRE_VALUE_MAXIMUM_NODES);
        assert_eq!(
            corpus.limits.array_length,
            REDACTED_WIRE_VALUE_MAXIMUM_ARRAY_LENGTH
        );
        assert_eq!(
            corpus.limits.string_length,
            REDACTED_WIRE_VALUE_MAXIMUM_STRING_LENGTH
        );

        let fact_source = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/execution-fact.json"
        );
        let audit_source = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/device-audit-account.json"
        );
        for test_case in corpus.cases {
            let payload = materialize_redacted_wire_value(&test_case);
            assert_eq!(
                is_redacted_wire_value(&payload),
                test_case.valid,
                "payload verdict for {}",
                test_case.name
            );

            let fact = mutate_json(fact_source, |value| {
                value["payloadRedacted"] = payload.clone();
            });
            assert_eq!(
                encode_execution_fact_drain_envelope_json(&fact).is_ok(),
                test_case.valid,
                "execution fact verdict for {}",
                test_case.name
            );

            let audit = mutate_json(audit_source, |value| {
                value["payloadRedacted"] = payload.clone();
            });
            assert_eq!(
                encode_device_audit_drain_envelope_json(&audit).is_ok(),
                test_case.valid,
                "device audit verdict for {}",
                test_case.name
            );

            if let Some(expected) = test_case.expected_canonical_sha256.as_deref() {
                assert_digest(&encode_canonical_wire_value(&payload), expected);
            }
        }
    }

    #[test]
    fn rejects_pathological_depth_at_both_json_entries_without_panicking() {
        let nested = format!("{}null{}", "[".repeat(20_000), "]".repeat(20_000));
        for source in [
            include_str!(
                "../../../packages/protocol/test-vectors/execution-events/valid/execution-fact.json"
            ),
            include_str!(
                "../../../packages/protocol/test-vectors/execution-events/valid/device-audit-account.json"
            ),
        ] {
            let marked = mutate_json(source, |value| {
                value["payloadRedacted"] = "__deep_payload__".into();
            });
            let pathological = marked.replace("\"__deep_payload__\"", &nested);
            if source.contains("executionFactId") {
                assert!(encode_execution_fact_drain_envelope_json(&pathological).is_err());
            } else {
                assert!(encode_device_audit_drain_envelope_json(&pathological).is_err());
            }
        }
    }

    #[test]
    fn rejects_unknown_fields_closed_enums_and_schema_version_drift() {
        let mutation_source = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/mutation-submitted.json"
        );
        for mutation in [
            mutate_json(mutation_source, |value| value["schemaVersion"] = 2.into()),
            mutate_json(mutation_source, |value| {
                value["entityType"] = "unknown".into();
            }),
            mutate_json(mutation_source, |value| value["unknownField"] = true.into()),
        ] {
            assert!(encode_mutation_drain_envelope_json(&mutation).is_err());
        }

        let fact_source = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/execution-fact.json"
        );
        for fact in [
            mutate_json(fact_source, |value| value["schemaVersion"] = 2.into()),
            mutate_json(fact_source, |value| value["unknownField"] = true.into()),
        ] {
            assert!(encode_execution_fact_drain_envelope_json(&fact).is_err());
        }

        let audit_source = include_str!(
            "../../../packages/protocol/test-vectors/execution-events/valid/device-audit-workspace.json"
        );
        for audit in [
            mutate_json(audit_source, |value| value["schemaVersion"] = 2.into()),
            mutate_json(audit_source, |value| value["actorKind"] = "service".into()),
            mutate_json(audit_source, |value| value["unknownField"] = true.into()),
        ] {
            assert!(encode_device_audit_drain_envelope_json(&audit).is_err());
        }

        let proof_source = VALID_PROOFS[2].1;
        for proof in [
            mutate_json(proof_source, |value| value["schemaVersion"] = 2.into()),
            mutate_json(proof_source, |value| value["purpose"] = "unknown".into()),
        ] {
            assert!(validate_drain_proof_json(&proof).is_err());
        }
    }

    #[derive(Deserialize)]
    struct GenesisVector {
        #[serde(rename = "genesisInputBase64url")]
        genesis_input_base64url: String,
        #[serde(rename = "expectedDigest")]
        expected_digest: String,
    }

    #[derive(Deserialize)]
    struct OrderedVector {
        steps: Vec<OrderedStep>,
        #[serde(rename = "expectedDigest")]
        expected_digest: String,
    }

    #[derive(Deserialize)]
    struct OrderedStep {
        #[serde(rename = "previousDigest")]
        previous_digest: String,
        #[serde(rename = "envelopeBase64url")]
        envelope_base64url: String,
        #[serde(rename = "expectedDigest")]
        expected_digest: String,
    }

    #[derive(Deserialize)]
    struct ArrivalVector {
        records: Vec<ArrivalRecord>,
        #[serde(rename = "expectedDigest")]
        expected_digest: String,
    }

    #[derive(Deserialize)]
    struct ArrivalRecord {
        sequence: u64,
        #[serde(rename = "envelopeBase64url")]
        envelope_base64url: String,
    }

    #[test]
    fn recomputes_every_digest_in_the_shared_chain_corpus() {
        let genesis: GenesisVector = serde_json::from_str(include_str!(
            "../../../packages/protocol/test-vectors/drain/chain/genesis.json"
        ))
        .expect("genesis vector");
        let genesis_input = decode_base64_url(&genesis.genesis_input_base64url);
        assert_eq!(genesis_input, DRAIN_STREAM_GENESIS_DOMAIN.as_bytes());
        let genesis_digest = sha256(&genesis_input);
        assert_eq!(encode_base64_url(&genesis_digest), genesis.expected_digest);
        assert_eq!(
            encode_base64_url(&genesis_digest),
            DRAIN_STREAM_GENESIS_DIGEST
        );

        for (name, source) in [
            (
                "single-record.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/drain/chain/single-record.json"
                ),
            ),
            (
                "three-records.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/drain/chain/three-records.json"
                ),
            ),
        ] {
            let vector: OrderedVector = serde_json::from_str(source).expect("ordered vector");
            let mut actual = String::new();
            for (index, step) in vector.steps.iter().enumerate() {
                let digest = advance_drain_chain_digest(
                    &decode_base64_url(&step.previous_digest),
                    &decode_base64_url(&step.envelope_base64url),
                )
                .unwrap_or_else(|error| panic!("{name} step {index}: {error:?}"));
                actual = encode_base64_url(&digest);
                assert_eq!(actual, step.expected_digest, "{name} step {index}");
            }
            assert_eq!(actual, vector.expected_digest, "{name} final digest");
        }

        for (name, source) in [
            (
                "duplicate-does-not-advance.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/drain/chain/duplicate-does-not-advance.json"
                ),
            ),
            (
                "gap-then-fill.json",
                include_str!(
                    "../../../packages/protocol/test-vectors/drain/chain/gap-then-fill.json"
                ),
            ),
        ] {
            let vector: ArrivalVector = serde_json::from_str(source).expect("arrival vector");
            let mut pending = BTreeMap::new();
            let mut through = 0_u64;
            let mut rolling_digest = genesis_digest;
            for record in vector.records {
                if record.sequence <= through || pending.contains_key(&record.sequence) {
                    continue;
                }
                pending.insert(
                    record.sequence,
                    decode_base64_url(&record.envelope_base64url),
                );
                while let Some(envelope) = pending.remove(&(through + 1)) {
                    rolling_digest = advance_drain_chain_digest(&rolling_digest, &envelope)
                        .unwrap_or_else(|error| panic!("{name}: {error:?}"));
                    through += 1;
                }
            }
            assert_eq!(
                encode_base64_url(&rolling_digest),
                vector.expected_digest,
                "{name}"
            );
        }
    }

    #[test]
    fn domain_encoders_are_distinct_and_fail_closed() {
        let sequence = encode_drain_sequence_domain(&DrainSequenceDomain {
            workspace_id: "workspace-a",
            source_device_id: "device-a",
            active_lease_epoch: 2,
            stream: DrainStream::Mutation,
        })
        .expect("sequence domain");
        let workspace = encode_workspace_device_audit_chain_domain("workspace-a", "device-a", 2)
            .expect("workspace audit domain");
        let account = encode_account_device_audit_chain_domain("account-a", "device-a", 3)
            .expect("account audit domain");
        assert_ne!(sequence, workspace);
        assert_ne!(workspace, account);
        assert_digest(&sequence, "4EVmbEIhkqa4K8YYMQ2PnPeCSRPrf7Kze48mfFQCvys");
        assert_digest(&workspace, "ynlGx-HrUzZYUfCRILOTRJMIeloYbl8VEc2xKK6sjWU");
        assert_digest(&account, "ALRwof0pWhOEMnG9KgNBCwnN8oHf_f3AXHrCp5fBrLk");
        assert!(encode_workspace_device_audit_chain_domain("", "device-a", 2).is_err());
        assert!(encode_account_device_audit_chain_domain("account-a", "device-a", 0).is_err());
    }

    fn assert_digest(input: &[u8], expected: &str) {
        assert_eq!(encode_base64_url(&sha256(input)), expected);
    }

    fn mutate_json(source: &str, mutate: impl FnOnce(&mut serde_json::Value)) -> String {
        let mut value = serde_json::from_str(source).expect("shared vector is valid JSON");
        mutate(&mut value);
        serde_json::to_string(&value).expect("mutated vector serializes")
    }

    fn decode_base64_url(value: &str) -> Vec<u8> {
        let mut output = Vec::new();
        let mut buffer = 0_u32;
        let mut bits = 0_u8;
        for byte in value.bytes() {
            let digit = match byte {
                b'A'..=b'Z' => byte - b'A',
                b'a'..=b'z' => byte - b'a' + 26,
                b'0'..=b'9' => byte - b'0' + 52,
                b'-' => 62,
                b'_' => 63,
                _ => panic!("invalid base64url vector"),
            };
            buffer = (buffer << 6) | u32::from(digit);
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                output.push(u8::try_from((buffer >> bits) & 0xff).expect("decoded byte"));
            }
        }
        output
    }

    fn encode_base64_url(value: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut output = String::new();
        let mut buffer = 0_u32;
        let mut bits = 0_u8;
        for byte in value {
            buffer = (buffer << 8) | u32::from(*byte);
            bits += 8;
            while bits >= 6 {
                bits -= 6;
                output.push(char::from(
                    ALPHABET
                        [usize::from(u8::try_from((buffer >> bits) & 0x3f).expect("base64 digit"))],
                ));
            }
        }
        if bits != 0 {
            output.push(char::from(
                ALPHABET[usize::from(
                    u8::try_from((buffer << (6 - bits)) & 0x3f).expect("base64 tail"),
                )],
            ));
        }
        output
    }
}
