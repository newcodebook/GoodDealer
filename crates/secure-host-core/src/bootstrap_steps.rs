use serde::{Deserialize, Deserializer, Serialize};

use crate::wire_scalar::{
    SafeUnsignedInteger, deserialize_required_option, is_base64_url, is_canonical_utc_timestamp,
    is_identifier,
};

pub const BOOTSTRAP_STEP_SCHEMA_VERSION: u64 = 2;
const WORKSPACE_SYNC_SCHEMA_VERSION: u64 = 1;
const MAX_MUTATIONS_PER_PAGE: usize = 256;
const MAX_ENTITY_DIGESTS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapStepKind {
    PinCheckpoint,
    FetchMutations,
    SubmitRebuildDigest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BootstrapStepRequest(RawBootstrapStepRequest);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "stepKind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum RawBootstrapStepRequest {
    PinCheckpoint {
        schema_version: SafeUnsignedInteger,
        device_switch_request_id: String,
        capability_jti: String,
        step_number: SafeUnsignedInteger,
        step_nonce: String,
        expected_workflow_revision: SafeUnsignedInteger,
        step_payload: PinCheckpointRequestPayload,
        request_digest: String,
    },
    FetchMutations {
        schema_version: SafeUnsignedInteger,
        device_switch_request_id: String,
        capability_jti: String,
        step_number: SafeUnsignedInteger,
        step_nonce: String,
        expected_workflow_revision: SafeUnsignedInteger,
        step_payload: FetchMutationsRequestPayload,
        request_digest: String,
    },
    SubmitRebuildDigest {
        schema_version: SafeUnsignedInteger,
        device_switch_request_id: String,
        capability_jti: String,
        step_number: SafeUnsignedInteger,
        step_nonce: String,
        expected_workflow_revision: SafeUnsignedInteger,
        step_payload: SubmitRebuildDigestRequestPayload,
        request_digest: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PinCheckpointRequestPayload {
    #[serde(rename = "checkpointId")]
    id: String,
    #[serde(rename = "checkpointRevision")]
    revision: SafeUnsignedInteger,
    #[serde(rename = "checkpointDigest")]
    digest: String,
}

impl PinCheckpointRequestPayload {
    fn is_valid(&self) -> bool {
        is_identifier(&self.id) && is_sha256_digest(&self.digest)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FetchMutationsRequestPayload {
    pinned_checkpoint_id: String,
    pinned_checkpoint_revision: SafeUnsignedInteger,
    pinned_checkpoint_digest: String,
    from_revision_exclusive: SafeUnsignedInteger,
    through_revision_inclusive: SafeUnsignedInteger,
    #[serde(deserialize_with = "deserialize_required_option")]
    cursor: Option<String>,
    page_limit: SafeUnsignedInteger,
}

impl FetchMutationsRequestPayload {
    fn is_valid(&self) -> bool {
        is_identifier(&self.pinned_checkpoint_id)
            && is_sha256_digest(&self.pinned_checkpoint_digest)
            && self
                .cursor
                .as_deref()
                .is_none_or(|cursor| is_bounded_base64_url(cursor, 512))
            && (1..=MAX_MUTATIONS_PER_PAGE as u64).contains(&self.page_limit.get())
            && self.from_revision_exclusive.get() >= self.pinned_checkpoint_revision.get()
            && self.from_revision_exclusive.get() <= self.through_revision_inclusive.get()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitRebuildDigestRequestPayload {
    target_revision: SafeUnsignedInteger,
    workspace_schema_version: SafeUnsignedInteger,
    entity_digests: Vec<WorkspaceEntityDigest>,
}

impl SubmitRebuildDigestRequestPayload {
    fn is_valid(&self) -> bool {
        self.workspace_schema_version.get() > 0
            && (1..=MAX_ENTITY_DIGESTS).contains(&self.entity_digests.len())
            && self
                .entity_digests
                .iter()
                .all(WorkspaceEntityDigest::is_valid)
            && self
                .entity_digests
                .windows(2)
                .all(|pair| entity_digest_key(&pair[0]) < entity_digest_key(&pair[1]))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceEntityDigest {
    entity_type: WorkspaceEntityType,
    #[serde(deserialize_with = "deserialize_required_option")]
    partition_id: Option<String>,
    digest: String,
}

impl WorkspaceEntityDigest {
    fn is_valid(&self) -> bool {
        self.partition_id.as_deref().is_none_or(is_identifier) && is_sha256_digest(&self.digest)
    }
}

fn entity_digest_key(digest: &WorkspaceEntityDigest) -> (&str, &str) {
    (
        digest.entity_type.as_str(),
        digest.partition_id.as_deref().unwrap_or(""),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WorkspaceEntityType {
    DomainAsset,
}

impl WorkspaceEntityType {
    const fn as_str(self) -> &'static str {
        match self {
            Self::DomainAsset => "domain_asset",
        }
    }
}

impl RawBootstrapStepRequest {
    fn is_valid(&self) -> bool {
        match self {
            Self::PinCheckpoint {
                schema_version,
                device_switch_request_id,
                capability_jti,
                step_number,
                step_nonce,
                expected_workflow_revision: _,
                step_payload,
                request_digest,
            } => {
                request_fields_are_valid(
                    *schema_version,
                    device_switch_request_id,
                    capability_jti,
                    *step_number,
                    step_nonce,
                    request_digest,
                ) && step_payload.is_valid()
            }
            Self::FetchMutations {
                schema_version,
                device_switch_request_id,
                capability_jti,
                step_number,
                step_nonce,
                expected_workflow_revision: _,
                step_payload,
                request_digest,
            } => {
                request_fields_are_valid(
                    *schema_version,
                    device_switch_request_id,
                    capability_jti,
                    *step_number,
                    step_nonce,
                    request_digest,
                ) && step_payload.is_valid()
            }
            Self::SubmitRebuildDigest {
                schema_version,
                device_switch_request_id,
                capability_jti,
                step_number,
                step_nonce,
                expected_workflow_revision: _,
                step_payload,
                request_digest,
            } => {
                request_fields_are_valid(
                    *schema_version,
                    device_switch_request_id,
                    capability_jti,
                    *step_number,
                    step_nonce,
                    request_digest,
                ) && step_payload.is_valid()
            }
        }
    }
}

fn request_fields_are_valid(
    schema_version: SafeUnsignedInteger,
    device_switch_request_id: &str,
    capability_jti: &str,
    step_number: SafeUnsignedInteger,
    step_nonce: &str,
    request_digest: &str,
) -> bool {
    schema_version.get() == BOOTSTRAP_STEP_SCHEMA_VERSION
        && is_identifier(device_switch_request_id)
        && is_identifier(capability_jti)
        && step_number.get() > 0
        && is_bounded_base64_url(step_nonce, 128)
        && is_sha256_digest(request_digest)
}

impl<'de> Deserialize<'de> for BootstrapStepRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawBootstrapStepRequest::deserialize(deserializer)?;
        if !raw.is_valid() {
            return Err(serde::de::Error::custom("invalid bootstrap step request"));
        }
        Ok(Self(raw))
    }
}

impl BootstrapStepRequest {
    #[must_use]
    pub const fn step_kind(&self) -> BootstrapStepKind {
        match self.0 {
            RawBootstrapStepRequest::PinCheckpoint { .. } => BootstrapStepKind::PinCheckpoint,
            RawBootstrapStepRequest::FetchMutations { .. } => BootstrapStepKind::FetchMutations,
            RawBootstrapStepRequest::SubmitRebuildDigest { .. } => {
                BootstrapStepKind::SubmitRebuildDigest
            }
        }
    }

    #[must_use]
    pub const fn schema_version(&self) -> u64 {
        match &self.0 {
            RawBootstrapStepRequest::PinCheckpoint { schema_version, .. }
            | RawBootstrapStepRequest::FetchMutations { schema_version, .. }
            | RawBootstrapStepRequest::SubmitRebuildDigest { schema_version, .. } => {
                schema_version.get()
            }
        }
    }

    #[must_use]
    pub const fn step_number(&self) -> u64 {
        match &self.0 {
            RawBootstrapStepRequest::PinCheckpoint { step_number, .. }
            | RawBootstrapStepRequest::FetchMutations { step_number, .. }
            | RawBootstrapStepRequest::SubmitRebuildDigest { step_number, .. } => step_number.get(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BootstrapStepResult(RawBootstrapStepResult);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "stepKind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum RawBootstrapStepResult {
    PinCheckpoint {
        schema_version: SafeUnsignedInteger,
        workflow_revision: SafeUnsignedInteger,
        accepted_step_number: SafeUnsignedInteger,
        #[serde(deserialize_with = "deserialize_required_option")]
        next_step_nonce: Option<String>,
        result_payload: PinCheckpointResultPayload,
        result_digest: String,
    },
    FetchMutations {
        schema_version: SafeUnsignedInteger,
        workflow_revision: SafeUnsignedInteger,
        accepted_step_number: SafeUnsignedInteger,
        #[serde(deserialize_with = "deserialize_required_option")]
        next_step_nonce: Option<String>,
        result_payload: FetchMutationsResultPayload,
        result_digest: String,
    },
    SubmitRebuildDigest {
        schema_version: SafeUnsignedInteger,
        workflow_revision: SafeUnsignedInteger,
        accepted_step_number: SafeUnsignedInteger,
        #[serde(deserialize_with = "deserialize_required_option")]
        next_step_nonce: Option<String>,
        result_payload: SubmitRebuildDigestResultPayload,
        result_digest: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PinCheckpointResultPayload {
    checkpoint_id: String,
    checkpoint_revision: SafeUnsignedInteger,
    checkpoint_digest: String,
    pin_expires_at: String,
}

impl PinCheckpointResultPayload {
    fn is_valid(&self) -> bool {
        is_identifier(&self.checkpoint_id)
            && is_sha256_digest(&self.checkpoint_digest)
            && is_canonical_utc_timestamp(&self.pin_expires_at)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FetchMutationsResultPayload {
    mutation_page: MutationPage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitRebuildDigestResultPayload {
    verified_revision: SafeUnsignedInteger,
    verified_digest: String,
    accepted: bool,
}

impl SubmitRebuildDigestResultPayload {
    fn is_valid(&self) -> bool {
        is_sha256_digest(&self.verified_digest) && self.accepted
    }
}

impl RawBootstrapStepResult {
    fn is_valid(&self) -> bool {
        match self {
            Self::PinCheckpoint {
                schema_version,
                workflow_revision,
                accepted_step_number,
                next_step_nonce,
                result_payload,
                result_digest,
            } => {
                result_fields_are_valid(
                    *schema_version,
                    *workflow_revision,
                    *accepted_step_number,
                    next_step_nonce.as_deref(),
                    false,
                    result_digest,
                ) && result_payload.is_valid()
            }
            Self::FetchMutations {
                schema_version,
                workflow_revision,
                accepted_step_number,
                next_step_nonce,
                result_payload,
                result_digest,
            } => {
                result_fields_are_valid(
                    *schema_version,
                    *workflow_revision,
                    *accepted_step_number,
                    next_step_nonce.as_deref(),
                    false,
                    result_digest,
                ) && result_payload.mutation_page.is_valid()
            }
            Self::SubmitRebuildDigest {
                schema_version,
                workflow_revision,
                accepted_step_number,
                next_step_nonce,
                result_payload,
                result_digest,
            } => {
                result_fields_are_valid(
                    *schema_version,
                    *workflow_revision,
                    *accepted_step_number,
                    next_step_nonce.as_deref(),
                    true,
                    result_digest,
                ) && result_payload.is_valid()
            }
        }
    }
}

fn result_fields_are_valid(
    schema_version: SafeUnsignedInteger,
    workflow_revision: SafeUnsignedInteger,
    accepted_step_number: SafeUnsignedInteger,
    next_step_nonce: Option<&str>,
    terminal: bool,
    result_digest: &str,
) -> bool {
    schema_version.get() == BOOTSTRAP_STEP_SCHEMA_VERSION
        && workflow_revision.get() > 0
        && accepted_step_number.get() > 0
        && next_step_nonce.is_none() == terminal
        && next_step_nonce.is_none_or(|nonce| is_bounded_base64_url(nonce, 128))
        && is_sha256_digest(result_digest)
}

impl<'de> Deserialize<'de> for BootstrapStepResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawBootstrapStepResult::deserialize(deserializer)?;
        if !raw.is_valid() {
            return Err(serde::de::Error::custom("invalid bootstrap step result"));
        }
        Ok(Self(raw))
    }
}

impl BootstrapStepResult {
    #[must_use]
    pub const fn step_kind(&self) -> BootstrapStepKind {
        match self.0 {
            RawBootstrapStepResult::PinCheckpoint { .. } => BootstrapStepKind::PinCheckpoint,
            RawBootstrapStepResult::FetchMutations { .. } => BootstrapStepKind::FetchMutations,
            RawBootstrapStepResult::SubmitRebuildDigest { .. } => {
                BootstrapStepKind::SubmitRebuildDigest
            }
        }
    }

    #[must_use]
    pub const fn schema_version(&self) -> u64 {
        match &self.0 {
            RawBootstrapStepResult::PinCheckpoint { schema_version, .. }
            | RawBootstrapStepResult::FetchMutations { schema_version, .. }
            | RawBootstrapStepResult::SubmitRebuildDigest { schema_version, .. } => {
                schema_version.get()
            }
        }
    }

    #[must_use]
    pub fn next_step_nonce(&self) -> Option<&str> {
        match &self.0 {
            RawBootstrapStepResult::PinCheckpoint {
                next_step_nonce, ..
            }
            | RawBootstrapStepResult::FetchMutations {
                next_step_nonce, ..
            }
            | RawBootstrapStepResult::SubmitRebuildDigest {
                next_step_nonce, ..
            } => next_step_nonce.as_deref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MutationPage {
    schema_version: SafeUnsignedInteger,
    workspace_id: String,
    from_revision_exclusive: SafeUnsignedInteger,
    through_revision_inclusive: SafeUnsignedInteger,
    mutations: Vec<SyncMutation>,
    returned_through_revision: SafeUnsignedInteger,
    #[serde(deserialize_with = "deserialize_required_option")]
    next_cursor: Option<String>,
    page_digest: String,
}

impl MutationPage {
    fn is_valid(&self) -> bool {
        if self.schema_version.get() != WORKSPACE_SYNC_SCHEMA_VERSION
            || !is_identifier(&self.workspace_id)
            || self.mutations.len() > MAX_MUTATIONS_PER_PAGE
            || self.from_revision_exclusive.get() > self.through_revision_inclusive.get()
            || !is_sha256_digest(&self.page_digest)
            || self
                .next_cursor
                .as_deref()
                .is_some_and(|cursor| !is_bounded_base64_url(cursor, 512))
        {
            return false;
        }

        let mut expected_revision = self.from_revision_exclusive.get();
        for mutation in &self.mutations {
            let Some(next_revision) = expected_revision.checked_add(1) else {
                return false;
            };
            if !mutation.is_valid()
                || mutation.workspace_id != self.workspace_id
                || mutation.server_revision.get() != next_revision
            {
                return false;
            }
            expected_revision = next_revision;
        }

        let expected_returned_revision = if self.mutations.is_empty() {
            self.from_revision_exclusive.get()
        } else {
            expected_revision
        };
        self.returned_through_revision.get() == expected_returned_revision
            && self.returned_through_revision.get() <= self.through_revision_inclusive.get()
            && if self.next_cursor.is_none() {
                self.returned_through_revision.get() == self.through_revision_inclusive.get()
            } else {
                self.returned_through_revision.get() < self.through_revision_inclusive.get()
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncMutation {
    schema_version: SafeUnsignedInteger,
    mutation_id: String,
    workspace_id: String,
    workspace_schema_version: SafeUnsignedInteger,
    entity_type: WorkspaceEntityType,
    entity_id: String,
    base_revision: SafeUnsignedInteger,
    changed_fields: Vec<DomainAssetChangedField>,
    source_device_id: String,
    active_lease_epoch: SafeUnsignedInteger,
    mutation_sequence: SafeUnsignedInteger,
    server_revision: SafeUnsignedInteger,
}

impl SyncMutation {
    fn is_valid(&self) -> bool {
        self.schema_version.get() == WORKSPACE_SYNC_SCHEMA_VERSION
            && is_identifier(&self.mutation_id)
            && is_identifier(&self.workspace_id)
            && self.workspace_schema_version.get() > 0
            && is_identifier(&self.entity_id)
            && self.base_revision.get() < self.server_revision.get()
            && (1..=4).contains(&self.changed_fields.len())
            && self
                .changed_fields
                .iter()
                .all(DomainAssetChangedField::is_valid)
            && self
                .changed_fields
                .windows(2)
                .all(|pair| pair[0].field_path() < pair[1].field_path())
            && is_identifier(&self.source_device_id)
            && self.active_lease_epoch.get() > 0
            && self.mutation_sequence.get() > 0
            && self.server_revision.get() > 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "fieldPath", rename_all = "camelCase", deny_unknown_fields)]
enum DomainAssetChangedField {
    Note {
        #[serde(deserialize_with = "deserialize_required_option")]
        value: Option<String>,
    },
    PortfolioId {
        #[serde(deserialize_with = "deserialize_required_option")]
        value: Option<String>,
    },
    Tags {
        value: Vec<String>,
    },
    TargetPrice {
        #[serde(deserialize_with = "deserialize_required_option")]
        value: Option<CanonicalMoney>,
    },
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
            Self::Note { value } => value.as_deref().is_none_or(is_conservative_note),
            Self::PortfolioId { value } => value.as_deref().is_none_or(is_identifier),
            Self::Tags { value } => {
                value.len() <= 128
                    && value.iter().all(|tag| is_conservative_tag(tag))
                    && value.windows(2).all(|pair| pair[0] < pair[1])
            }
            Self::TargetPrice { value } => value.as_ref().is_none_or(CanonicalMoney::is_valid),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CanonicalMoney {
    currency: String,
    amount: String,
}

impl CanonicalMoney {
    fn is_valid(&self) -> bool {
        self.currency.len() == 3
            && self.currency.bytes().all(|byte| byte.is_ascii_uppercase())
            && is_canonical_amount(&self.amount)
    }
}

fn is_bounded_base64_url(value: &str, max_length: usize) -> bool {
    value.len() <= max_length && is_base64_url(value)
}

fn is_sha256_digest(value: &str) -> bool {
    value.len() == 43 && is_base64_url(value)
}

// This nested-body mirror deliberately accepts an ASCII subset of the TypeScript human-text
// schemas. Rejecting otherwise-valid Unicode here is fail-closed until workspace sync owns a full
// Rust mirror; all identifiers, digests, numeric bounds, object shapes, and revision invariants
// remain exact.
fn is_conservative_note(value: &str) -> bool {
    value.len() <= 10_000
        && value.is_ascii()
        && value
            .bytes()
            .all(|byte| !matches!(byte, 0x00..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f | 0x7f))
}

fn is_conservative_tag(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value.is_ascii()
        && value.trim() == value
        && value.bytes().all(|byte| !byte.is_ascii_control())
}

fn is_canonical_amount(value: &str) -> bool {
    let mut parts = value.split('.');
    let Some(integer) = parts.next() else {
        return false;
    };
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootstrapStepValidationError {
    InvalidJson,
    InvalidRequest,
    InvalidResult,
}

/// Parses and semantically validates the strict Rust mirror of a bootstrap-step request.
///
/// # Errors
///
/// Returns [`BootstrapStepValidationError::InvalidJson`] for malformed or structurally invalid
/// wire data and [`BootstrapStepValidationError::InvalidRequest`] for cross-field violations.
pub fn validate_bootstrap_step_request_json(
    source: &str,
) -> Result<BootstrapStepRequest, BootstrapStepValidationError> {
    let raw: RawBootstrapStepRequest =
        serde_json::from_str(source).map_err(|_| BootstrapStepValidationError::InvalidJson)?;
    if !raw.is_valid() {
        return Err(BootstrapStepValidationError::InvalidRequest);
    }
    Ok(BootstrapStepRequest(raw))
}

/// Parses and semantically validates the strict Rust mirror of a bootstrap-step result.
///
/// # Errors
///
/// Returns [`BootstrapStepValidationError::InvalidJson`] for malformed or structurally invalid
/// wire data and [`BootstrapStepValidationError::InvalidResult`] for cross-field violations.
pub fn validate_bootstrap_step_result_json(
    source: &str,
) -> Result<BootstrapStepResult, BootstrapStepValidationError> {
    let raw: RawBootstrapStepResult =
        serde_json::from_str(source).map_err(|_| BootstrapStepValidationError::InvalidJson)?;
    if !raw.is_valid() {
        return Err(BootstrapStepValidationError::InvalidResult);
    }
    Ok(BootstrapStepResult(raw))
}

#[cfg(test)]
mod tests {
    use super::{
        BootstrapStepRequest, BootstrapStepResult, validate_bootstrap_step_request_json,
        validate_bootstrap_step_result_json,
    };

    const VALID_REQUEST_VECTORS: [(&str, &str); 3] = [
        (
            "request-fetch-mutations.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/valid/request-fetch-mutations.json"
            ),
        ),
        (
            "request-pin-checkpoint.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/valid/request-pin-checkpoint.json"
            ),
        ),
        (
            "request-submit-rebuild-digest.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/valid/request-submit-rebuild-digest.json"
            ),
        ),
    ];
    const VALID_RESULT_VECTORS: [(&str, &str); 3] = [
        (
            "result-fetch-mutations.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/valid/result-fetch-mutations.json"
            ),
        ),
        (
            "result-pin-checkpoint.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/valid/result-pin-checkpoint.json"
            ),
        ),
        (
            "result-submit-rebuild-digest.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/valid/result-submit-rebuild-digest.json"
            ),
        ),
    ];
    const INVALID_REQUEST_VECTORS: [(&str, &str); 8] = [
        (
            "request-fetch-before-checkpoint.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-fetch-before-checkpoint.json"
            ),
        ),
        (
            "request-fetch-inverted-range.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-fetch-inverted-range.json"
            ),
        ),
        (
            "request-page-limit-too-large.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-page-limit-too-large.json"
            ),
        ),
        (
            "request-payload-kind-mismatch.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-payload-kind-mismatch.json"
            ),
        ),
        (
            "request-snake-case.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-snake-case.json"
            ),
        ),
        (
            "request-unknown-field.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-unknown-field.json"
            ),
        ),
        (
            "request-unsafe-workflow-revision.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-unsafe-workflow-revision.json"
            ),
        ),
        (
            "request-unsorted-entity-digests.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/request-unsorted-entity-digests.json"
            ),
        ),
    ];
    const INVALID_RESULT_VECTORS: [(&str, &str); 7] = [
        (
            "result-invalid-next-step-nonce-encoding.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/result-invalid-next-step-nonce-encoding.json"
            ),
        ),
        (
            "result-missing-next-step-nonce.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/result-missing-next-step-nonce.json"
            ),
        ),
        (
            "result-mutation-page-gap.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/result-mutation-page-gap.json"
            ),
        ),
        (
            "result-nonterminal-null-next-step-nonce.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/result-nonterminal-null-next-step-nonce.json"
            ),
        ),
        (
            "result-payload-kind-mismatch.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/result-payload-kind-mismatch.json"
            ),
        ),
        (
            "result-terminal-nonnull-next-step-nonce.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/result-terminal-nonnull-next-step-nonce.json"
            ),
        ),
        (
            "result-unknown-field.json",
            include_str!(
                "../../../packages/protocol/test-vectors/bootstrap-steps/invalid/result-unknown-field.json"
            ),
        ),
    ];

    #[test]
    fn mirrors_request_typescript_verdicts_per_shared_vector() {
        for (name, vector) in VALID_REQUEST_VECTORS {
            let request = validate_bootstrap_step_request_json(vector)
                .unwrap_or_else(|error| panic!("TypeScript accepts valid/{name}: {error:?}"));
            assert!(
                serde_json::from_str::<BootstrapStepRequest>(vector).is_ok(),
                "Serde must preserve the fail-closed verdict for valid/{name}"
            );
            let serialized = serde_json::to_string(&request).expect("validated request serializes");
            assert!(
                serde_json::from_str::<BootstrapStepRequest>(&serialized).is_ok(),
                "validated request round-trips for valid/{name}"
            );
        }
        for (name, vector) in INVALID_REQUEST_VECTORS {
            assert!(
                validate_bootstrap_step_request_json(vector).is_err(),
                "TypeScript rejects invalid/{name}"
            );
            assert!(
                serde_json::from_str::<BootstrapStepRequest>(vector).is_err(),
                "Serde must preserve the fail-closed verdict for invalid/{name}"
            );
        }
    }

    #[test]
    fn mirrors_result_typescript_verdicts_per_shared_vector() {
        for (name, vector) in VALID_RESULT_VECTORS {
            let result = validate_bootstrap_step_result_json(vector)
                .unwrap_or_else(|error| panic!("TypeScript accepts valid/{name}: {error:?}"));
            assert!(
                serde_json::from_str::<BootstrapStepResult>(vector).is_ok(),
                "Serde must preserve the fail-closed verdict for valid/{name}"
            );
            let serialized = serde_json::to_string(&result).expect("validated result serializes");
            assert!(
                serde_json::from_str::<BootstrapStepResult>(&serialized).is_ok(),
                "validated result round-trips for valid/{name}"
            );
        }
        for (name, vector) in INVALID_RESULT_VECTORS {
            assert!(
                validate_bootstrap_step_result_json(vector).is_err(),
                "TypeScript rejects invalid/{name}"
            );
            assert!(
                serde_json::from_str::<BootstrapStepResult>(vector).is_err(),
                "Serde must preserve the fail-closed verdict for invalid/{name}"
            );
        }
    }

    #[test]
    fn rejects_mutated_literal_nullable_and_nested_boundaries() {
        let mut request: serde_json::Value = serde_json::from_str(VALID_REQUEST_VECTORS[0].1)
            .expect("shared request vector is valid JSON");
        request["schemaVersion"] = serde_json::Value::from(3);
        assert!(serde_json::from_value::<BootstrapStepRequest>(request).is_err());

        let mut request: serde_json::Value = serde_json::from_str(VALID_REQUEST_VECTORS[0].1)
            .expect("shared request vector is valid JSON");
        request["stepPayload"]
            .as_object_mut()
            .expect("step payload is an object")
            .remove("cursor");
        assert!(serde_json::from_value::<BootstrapStepRequest>(request).is_err());

        let mut request: serde_json::Value = serde_json::from_str(VALID_REQUEST_VECTORS[0].1)
            .expect("shared request vector is valid JSON");
        request["stepNonce"] = serde_json::Value::String("A".repeat(129));
        assert!(serde_json::from_value::<BootstrapStepRequest>(request).is_err());

        let mut result: serde_json::Value = serde_json::from_str(VALID_RESULT_VECTORS[1].1)
            .expect("shared result vector is valid JSON");
        result["nextStepNonce"] = serde_json::Value::String("A".repeat(129));
        assert!(serde_json::from_value::<BootstrapStepResult>(result).is_err());

        let mut result: serde_json::Value = serde_json::from_str(VALID_RESULT_VECTORS[1].1)
            .expect("shared result vector is valid JSON");
        result["resultDigest"] = serde_json::Value::String("A".repeat(42));
        assert!(serde_json::from_value::<BootstrapStepResult>(result).is_err());

        let mut result: serde_json::Value = serde_json::from_str(VALID_RESULT_VECTORS[0].1)
            .expect("shared result vector is valid JSON");
        result["resultPayload"]["mutationPage"]["unexpected"] = serde_json::Value::Bool(true);
        assert!(serde_json::from_value::<BootstrapStepResult>(result).is_err());
    }
}
