//! Private rebootstrap validation and publication state machine.
//!
//! The Desktop local-host aggregate remains the sole owner of the active database, its key and
//! its writer. This component owns only bounded protocol DTOs, monotonic publication state and an
//! append-only journal. Its actions are opaque, non-serializable and contain no path or key.

use std::fmt;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::{
    DatabaseRecoveryProof, DomainAssetProjectionRow, DomainAssetWrite, Money,
    RebootstrapJournalLink, RebootstrapReplayPage, RebootstrapSlotId,
    desktop_custody::{
        CandidateReservedEvidence, DesktopCustodyError, DesktopJournalStore, PreparedEvidence,
        VerifiedCustodyEvidence,
    },
    validate_rebootstrap_asset, validate_rebootstrap_timestamp,
    verify_rebootstrap_checkpoint_digest, verify_rebootstrap_page_digest,
    verify_rebootstrap_plan_digest,
};

const MAX_CHECKPOINT_BYTES: usize = 4_096;
const MAX_PLAN_BYTES: usize = 16 * 1_048_576;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_JOURNAL_RECORDS: usize = 4_096;
const JOURNAL_SCHEMA_VERSION: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RebootstrapStatus {
    Unavailable,
    #[expect(
        dead_code,
        reason = "the private test protocol reserves the admitted phase for aggregate observation"
    )]
    Admitted,
    Published,
    Cancelled,
    RecoveryRequired,
    Quarantined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RebootstrapError {
    Unavailable,
    InvalidPlan,
    AuthorityStale,
    StorageRejected,
    PhaseRejected,
}

impl fmt::Display for RebootstrapError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "LOCAL_REBOOTSTRAP_UNAVAILABLE",
            Self::InvalidPlan => "LOCAL_REBOOTSTRAP_PLAN_REJECTED",
            Self::AuthorityStale => "LOCAL_AUTHORITY_STALE",
            Self::StorageRejected => "LOCAL_STORAGE_REJECTED",
            Self::PhaseRejected => "LOCAL_REBOOTSTRAP_PHASE_REJECTED",
        })
    }
}

impl std::error::Error for RebootstrapError {}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckpointWire {
    schema_version: u8,
    checkpoint_id: String,
    workspace_id: String,
    workspace_schema_version: u64,
    through_server_revision: u64,
    checkpoint_digest: String,
}

pub(crate) struct RebootstrapCheckpoint(CheckpointWire);

impl RebootstrapCheckpoint {
    pub(crate) fn parse(wire: &[u8]) -> Result<Self, RebootstrapError> {
        if wire.is_empty() || wire.len() > MAX_CHECKPOINT_BYTES {
            return Err(RebootstrapError::InvalidPlan);
        }
        let checkpoint: CheckpointWire =
            serde_json::from_slice(wire).map_err(|_| RebootstrapError::InvalidPlan)?;
        if checkpoint.schema_version != 2
            || !valid_identifier(&checkpoint.checkpoint_id)
            || !valid_identifier(&checkpoint.workspace_id)
            || checkpoint.workspace_schema_version == 0
            || checkpoint.workspace_schema_version > MAX_SAFE_INTEGER
            || checkpoint.through_server_revision > MAX_SAFE_INTEGER
            || checkpoint.checkpoint_digest.len() != 43
        {
            return Err(RebootstrapError::InvalidPlan);
        }
        Ok(Self(checkpoint))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanWire {
    schema_version: u8,
    checkpoint: CheckpointWire,
    snapshot: Vec<DomainAssetProjectionRow>,
    required_mutation_range: RevisionRangeWire,
    mutations: Vec<serde_json::Value>,
    pinned_head_revision: u64,
    pinned_head_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevisionRangeWire {
    from_server_revision_exclusive: u64,
    through_server_revision_inclusive: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PageWire {
    schema_version: u8,
    workspace_id: String,
    from_server_revision_exclusive: u64,
    through_server_revision_inclusive: u64,
    mutations: Vec<MutationWire>,
    returned_through_server_revision: u64,
    next_cursor: Option<String>,
    page_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MutationWire {
    schema_version: u8,
    mutation_id: String,
    workspace_id: String,
    workspace_schema_version: u64,
    entity_type: String,
    entity_id: String,
    operation_kind: String,
    #[serde(default)]
    deleted_at: Option<String>,
    base_server_revision: u64,
    changed_fields: Vec<ChangedFieldWire>,
    source_device_id: String,
    active_lease_epoch: u64,
    device_mutation_sequence: u64,
    server_revision: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChangedFieldWire {
    field_path: String,
    value: serde_json::Value,
}

pub(crate) struct RebootstrapPlan {
    workspace_id: String,
    checkpoint_revision: u64,
    pinned_head_revision: u64,
    snapshot: Vec<DomainAssetWrite>,
    replay_pages: Vec<RebootstrapReplayPage>,
}

impl fmt::Debug for RebootstrapPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RebootstrapPlan")
            .field("workspace", &"[REDACTED]")
            .field("snapshot_count", &self.snapshot.len())
            .finish_non_exhaustive()
    }
}

impl RebootstrapPlan {
    #[allow(
        clippy::too_many_lines,
        reason = "strict nested validation remains contiguous before publication admission"
    )]
    pub(crate) fn parse(
        expected: &RebootstrapCheckpoint,
        wire: &[u8],
    ) -> Result<Self, RebootstrapError> {
        if wire.is_empty() || wire.len() > MAX_PLAN_BYTES {
            return Err(RebootstrapError::InvalidPlan);
        }
        let value: serde_json::Value =
            serde_json::from_slice(wire).map_err(|_| RebootstrapError::InvalidPlan)?;
        verify_rebootstrap_plan_digest(&value).map_err(|_| RebootstrapError::InvalidPlan)?;
        let plan: PlanWire =
            serde_json::from_value(value).map_err(|_| RebootstrapError::InvalidPlan)?;
        verify_rebootstrap_checkpoint_digest(&plan.snapshot, &plan.checkpoint.checkpoint_digest)
            .map_err(|_| RebootstrapError::InvalidPlan)?;
        if plan.schema_version != 2
            || plan.checkpoint != expected.0
            || plan.pinned_head_revision > MAX_SAFE_INTEGER
            || plan.pinned_head_digest.len() != 43
            || plan.snapshot.len() > 10_000
            || plan.mutations.len() > 4_096
            || plan.required_mutation_range.from_server_revision_exclusive
                != plan.checkpoint.through_server_revision
            || plan
                .required_mutation_range
                .through_server_revision_inclusive
                != plan.pinned_head_revision
        {
            return Err(RebootstrapError::InvalidPlan);
        }
        let mut expected_revision = plan.checkpoint.through_server_revision;
        let mut replay_pages = Vec::with_capacity(plan.mutations.len());
        for page in plan.mutations {
            verify_rebootstrap_page_digest(&page).map_err(|_| RebootstrapError::InvalidPlan)?;
            let decoded: PageWire =
                serde_json::from_value(page.clone()).map_err(|_| RebootstrapError::InvalidPlan)?;
            validate_page(
                &decoded,
                &plan.checkpoint.workspace_id,
                plan.pinned_head_revision,
            )?;
            if decoded.from_server_revision_exclusive != expected_revision {
                return Err(RebootstrapError::InvalidPlan);
            }
            expected_revision = decoded.returned_through_server_revision;
            replay_pages.push(RebootstrapReplayPage {
                page_json: serde_json::to_string(&page)
                    .map_err(|_| RebootstrapError::InvalidPlan)?,
                confirmation_token: "rebootstrap-plan".to_owned(),
            });
        }
        if expected_revision != plan.pinned_head_revision {
            return Err(RebootstrapError::InvalidPlan);
        }
        let snapshot = plan
            .snapshot
            .into_iter()
            .map(|asset| DomainAssetWrite {
                entity_id: asset.entity_id,
                note: asset.note,
                portfolio_id: asset.portfolio_id,
                tags: asset.tags,
                target_price: asset.target_price,
            })
            .collect::<Vec<_>>();
        for asset in &snapshot {
            validate_rebootstrap_asset(asset).map_err(|_| RebootstrapError::InvalidPlan)?;
        }
        Ok(Self {
            workspace_id: plan.checkpoint.workspace_id,
            checkpoint_revision: plan.checkpoint.through_server_revision,
            pinned_head_revision: plan.pinned_head_revision,
            snapshot,
            replay_pages,
        })
    }

    pub(crate) fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    #[expect(
        dead_code,
        reason = "the private test protocol retains the independently inspectable checkpoint fact"
    )]
    pub(crate) const fn checkpoint_revision(&self) -> u64 {
        self.checkpoint_revision
    }

    pub(crate) const fn pinned_head_revision(&self) -> u64 {
        self.pinned_head_revision
    }

    #[expect(
        dead_code,
        reason = "the private test protocol retains the independently inspectable snapshot fact"
    )]
    pub(crate) fn snapshot(&self) -> &[DomainAssetWrite] {
        &self.snapshot
    }

    #[expect(
        dead_code,
        reason = "the private test protocol retains independently inspectable replay-page facts"
    )]
    pub(crate) fn replay_pages(&self) -> &[RebootstrapReplayPage] {
        &self.replay_pages
    }

    pub(crate) fn installation_input(
        &self,
    ) -> (Vec<DomainAssetWrite>, u64, Vec<RebootstrapReplayPage>) {
        (
            self.snapshot.clone(),
            self.checkpoint_revision,
            self.replay_pages.clone(),
        )
    }
}

fn validate_page(
    page: &PageWire,
    workspace_id: &str,
    pinned_head: u64,
) -> Result<(), RebootstrapError> {
    if page.schema_version != 2
        || page.workspace_id != workspace_id
        || page.through_server_revision_inclusive != pinned_head
        || page.mutations.len() > 256
        || page.page_digest.len() != 43
    {
        return Err(RebootstrapError::InvalidPlan);
    }
    for (index, mutation) in page.mutations.iter().enumerate() {
        let revision = page
            .from_server_revision_exclusive
            .checked_add(index as u64 + 1)
            .ok_or(RebootstrapError::InvalidPlan)?;
        if mutation.schema_version != 2
            || mutation.workspace_id != workspace_id
            || mutation.workspace_schema_version == 0
            || mutation.workspace_schema_version > MAX_SAFE_INTEGER
            || mutation.entity_type != "domain_asset"
            || !valid_identifier(&mutation.entity_id)
            || !valid_identifier(&mutation.mutation_id)
            || !valid_identifier(&mutation.source_device_id)
            || mutation.active_lease_epoch == 0
            || mutation.active_lease_epoch > MAX_SAFE_INTEGER
            || mutation.device_mutation_sequence == 0
            || mutation.device_mutation_sequence > MAX_SAFE_INTEGER
            || mutation.server_revision != revision
            || mutation.base_server_revision >= mutation.server_revision
            || !matches!(mutation.operation_kind.as_str(), "upsert" | "delete")
            || (mutation.operation_kind == "delete"
                && (mutation.deleted_at.is_none() || !mutation.changed_fields.is_empty()))
            || (mutation.operation_kind == "upsert"
                && (mutation.deleted_at.is_some() || mutation.changed_fields.is_empty()))
        {
            return Err(RebootstrapError::InvalidPlan);
        }
        if mutation
            .deleted_at
            .as_deref()
            .is_some_and(|value| validate_rebootstrap_timestamp(value).is_err())
        {
            return Err(RebootstrapError::InvalidPlan);
        }
        validate_fields(&mutation.changed_fields)?;
    }
    let returned = page.returned_through_server_revision;
    let expected_returned = page
        .mutations
        .last()
        .map_or(page.from_server_revision_exclusive, |item| {
            item.server_revision
        });
    if returned != expected_returned
        || returned > page.through_server_revision_inclusive
        || (page.next_cursor.is_none() && returned != pinned_head)
        || (page.next_cursor.is_some() && returned >= pinned_head)
        || page.next_cursor.as_deref().is_some_and(|cursor| {
            cursor.is_empty()
                || cursor.len() > 512
                || cursor
                    .bytes()
                    .any(|byte| !byte.is_ascii_alphanumeric() && byte != b'_' && byte != b'-')
        })
    {
        return Err(RebootstrapError::InvalidPlan);
    }
    Ok(())
}

fn validate_fields(fields: &[ChangedFieldWire]) -> Result<(), RebootstrapError> {
    let mut previous = None;
    for field in fields {
        if field.field_path.is_empty()
            || previous.is_some_and(|prior: &str| prior >= field.field_path.as_str())
        {
            return Err(RebootstrapError::InvalidPlan);
        }
        previous = Some(field.field_path.as_str());
        let valid = match field.field_path.as_str() {
            "note" | "portfolioId" => field.value.is_null() || field.value.is_string(),
            "tags" => field.value.as_array().is_some_and(|tags| {
                tags.len() <= 128 && tags.iter().all(serde_json::Value::is_string)
            }),
            "targetPrice" => {
                field.value.is_null()
                    || serde_json::from_value::<Money>(field.value.clone()).is_ok()
            }
            _ => false,
        };
        if !valid {
            return Err(RebootstrapError::InvalidPlan);
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RebootstrapSlot {
    A,
    B,
}

impl RebootstrapSlot {
    const fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }

    const fn journal_id(self) -> RebootstrapSlotId {
        match self {
            Self::A => RebootstrapSlotId::A,
            Self::B => RebootstrapSlotId::B,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PublicationPhase {
    Prepared,
    CandidateReserved,
    Verified,
    PublishIntent,
    Published,
    ReopenedVerified,
    RetiredOld,
    Cancelled,
    Quarantined,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalRecord {
    schema_version: u8,
    operation_id: u64,
    publication_sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    workspace_id_digest: String,
    directory_dev: u64,
    directory_ino: u64,
    old_file_dev: u64,
    old_file_ino: u64,
    old_file_size: u64,
    old_file_ciphertext_digest: String,
    old_key_digest: String,
    old_slot_record_digest: String,
    candidate_slot_record_digest: String,
    old_slot_origin_operation_id: u64,
    old_slot_origin_publication_sequence: u64,
    candidate_slot_origin_operation_id: u64,
    candidate_slot_origin_publication_sequence: u64,
    old_slot_created_by_operation: bool,
    authority_digest: String,
    floor_digest: String,
    binding_digest: String,
    prepared_evidence_digest: Option<String>,
    candidate_key_digest: Option<String>,
    candidate_reserved_evidence_digest: Option<String>,
    verified_evidence_digest: Option<String>,
    logical_evidence_digest: Option<String>,
    publication_evidence_digest: Option<String>,
    recovery_proof_digest: Option<String>,
    phase: PublicationPhase,
}

struct AuthorityState {
    applied_epoch: u64,
    binding_digest: String,
    authority_digest: String,
    floor_digest: String,
}

pub(crate) struct RebootstrapAdmission {
    operation_id: u64,
    authority_epoch: u64,
}

/// An admitted operation whose durable identity and A/B topology are fixed, but whose custody
/// reservation has not yet been journaled. Only custody may turn this into prepared evidence.
pub(crate) struct RebootstrapReservation {
    operation_id: u64,
    authority_epoch: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    plan: RebootstrapPlan,
}

pub(crate) struct PreparedRebootstrap {
    operation_id: u64,
    authority_epoch: u64,
    sequence: u64,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
    workspace_id_digest: String,
    directory_dev: u64,
    directory_ino: u64,
    old_file_dev: u64,
    old_file_ino: u64,
    old_file_size: u64,
    old_file_ciphertext_digest: String,
    old_key_digest: String,
    old_slot_record_digest: String,
    candidate_slot_record_digest: String,
    old_slot_origin_operation_id: u64,
    old_slot_origin_publication_sequence: u64,
    candidate_slot_origin_operation_id: u64,
    candidate_slot_origin_publication_sequence: u64,
    old_slot_created_by_operation: bool,
    prepared_evidence_digest: String,
    candidate_key_digest: String,
    plan: RebootstrapPlan,
}

pub(crate) struct CandidateReservedRebootstrap {
    prepared: PreparedRebootstrap,
    #[expect(
        dead_code,
        reason = "the private typestate retains the custody digest for full-chain verification"
    )]
    candidate_reserved_evidence_digest: String,
}

pub(crate) struct VerifiedRebootstrap {
    reserved: CandidateReservedRebootstrap,
    verified_evidence_digest: String,
    #[expect(
        dead_code,
        reason = "the private typestate retains logical evidence for full-chain verification"
    )]
    logical_evidence_digest: String,
    #[expect(
        dead_code,
        reason = "the private typestate retains recovery evidence for full-chain verification"
    )]
    recovery_proof_digest: String,
    journal_link: RebootstrapJournalLink,
}

pub(crate) struct PublishRebootstrap(VerifiedRebootstrap);

pub(crate) struct RetireRebootstrap {
    operation_id: u64,
    sequence: u64,
    authority_epoch: Option<u64>,
    old_slot: RebootstrapSlot,
    candidate_slot: RebootstrapSlot,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RecoveryDisposition {
    ResumeCandidate,
    CancelUnpublishedCandidate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RecoveryPhase {
    PublishIntent,
    Published,
    ReopenedVerified,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DiscardPhase {
    Prepared,
    CandidateReserved,
    Verified,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TerminalPhase {
    Cancelled,
    RetiredOld,
}

pub(crate) struct RecoveryRebootstrap {
    record: JournalRecord,
    phase: RecoveryPhase,
    disposition: Option<RecoveryDisposition>,
}

pub(crate) struct DiscardRebootstrap(JournalRecord);

#[cfg(test)]
pub(crate) struct TerminalRebootstrap {
    record: JournalRecord,
    phase: TerminalPhase,
    active_publication_link: Option<RebootstrapJournalLink>,
}

pub(crate) enum StartupRebootstrapAction {
    None,
    Discard(DiscardRebootstrap),
    Recover(RecoveryRebootstrap),
    #[cfg(test)]
    Terminal(TerminalRebootstrap),
    Quarantined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RebootstrapMode {
    ProductionQuarantine,
    #[cfg(test)]
    TestRecovery,
}

#[cfg(test)]
#[expect(
    clippy::large_enum_variant,
    reason = "the private recovery classifier keeps validated journal evidence inline so no fallible allocation separates validation from the startup action"
)]
enum StartupJournalRecord {
    Empty,
    Valid {
        record: JournalRecord,
        active_publication_link: Option<RebootstrapJournalLink>,
    },
    Quarantined,
}

/// A journal head that can only be constructed after every durable record has passed the v3
/// grammar. Keeping the validated head opaque prevents callers from accidentally falling back to
/// last-line recovery semantics.
struct ValidatedJournalChain {
    last: Option<JournalRecord>,
    active_publication_link: Option<RebootstrapJournalLink>,
}

impl fmt::Debug for ValidatedJournalChain {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ValidatedJournalChain([REDACTED])")
    }
}

impl ValidatedJournalChain {
    fn last(&self) -> Option<&JournalRecord> {
        self.last.as_ref()
    }

    fn into_parts(self) -> (Option<JournalRecord>, Option<RebootstrapJournalLink>) {
        (self.last, self.active_publication_link)
    }
}

#[derive(Default)]
struct EvidenceUpdate {
    candidate_reserved: Option<String>,
    verified: Option<String>,
    logical: Option<String>,
    publication: Option<String>,
    proof: Option<String>,
}

macro_rules! redacted_debug {
    ($($type:ty => $name:literal),+ $(,)?) => {$ (
        impl fmt::Debug for $type {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(concat!($name, "([OPAQUE])"))
            }
        }
    )+ };
}

redacted_debug!(
    RebootstrapAdmission => "RebootstrapAdmission",
    RebootstrapReservation => "RebootstrapReservation",
    PreparedRebootstrap => "PreparedRebootstrap",
    CandidateReservedRebootstrap => "CandidateReservedRebootstrap",
    VerifiedRebootstrap => "VerifiedRebootstrap",
    PublishRebootstrap => "PublishRebootstrap",
    RetireRebootstrap => "RetireRebootstrap",
    RecoveryRebootstrap => "RecoveryRebootstrap",
    DiscardRebootstrap => "DiscardRebootstrap",
);

#[cfg(test)]
redacted_debug!(TerminalRebootstrap => "TerminalRebootstrap");

impl fmt::Debug for StartupRebootstrapAction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::None => "StartupRebootstrapAction::None",
            Self::Discard(_) => "StartupRebootstrapAction::Discard([OPAQUE])",
            Self::Recover(_) => "StartupRebootstrapAction::Recover([OPAQUE])",
            #[cfg(test)]
            Self::Terminal(_) => "StartupRebootstrapAction::Terminal([OPAQUE])",
            Self::Quarantined => "StartupRebootstrapAction::Quarantined",
        })
    }
}

impl PreparedRebootstrap {
    pub(crate) const fn operation_id(&self) -> u64 {
        self.operation_id
    }

    pub(crate) const fn publication_sequence(&self) -> u64 {
        self.sequence
    }

    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.candidate_slot
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) fn workspace_id_digest(&self) -> &str {
        &self.workspace_id_digest
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn directory_dev(&self) -> u64 {
        self.directory_dev
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn directory_ino(&self) -> u64 {
        self.directory_ino
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn old_file_dev(&self) -> u64 {
        self.old_file_dev
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn old_file_ino(&self) -> u64 {
        self.old_file_ino
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn old_file_size(&self) -> u64 {
        self.old_file_size
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) fn old_file_ciphertext_digest(&self) -> &str {
        &self.old_file_ciphertext_digest
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) fn old_key_digest(&self) -> &str {
        &self.old_key_digest
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) fn old_slot_record_digest(&self) -> &str {
        &self.old_slot_record_digest
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) fn candidate_slot_record_digest(&self) -> &str {
        &self.candidate_slot_record_digest
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn old_slot_origin_operation_id(&self) -> u64 {
        self.old_slot_origin_operation_id
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn old_slot_origin_publication_sequence(&self) -> u64 {
        self.old_slot_origin_publication_sequence
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn candidate_slot_origin_operation_id(&self) -> u64 {
        self.candidate_slot_origin_operation_id
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn candidate_slot_origin_publication_sequence(&self) -> u64 {
        self.candidate_slot_origin_publication_sequence
    }

    #[expect(
        dead_code,
        reason = "the private test protocol preserves decomposable prepared evidence"
    )]
    pub(crate) const fn old_slot_created_by_operation(&self) -> bool {
        self.old_slot_created_by_operation
    }

    pub(crate) fn plan(&self) -> &RebootstrapPlan {
        &self.plan
    }
}

impl CandidateReservedRebootstrap {
    pub(crate) const fn operation_id(&self) -> u64 {
        self.prepared.operation_id
    }

    pub(crate) const fn publication_sequence(&self) -> u64 {
        self.prepared.sequence
    }

    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.prepared.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.prepared.candidate_slot
    }

    #[expect(
        dead_code,
        reason = "the private test protocol retains the reserved plan for phase inspection"
    )]
    pub(crate) fn plan(&self) -> &RebootstrapPlan {
        &self.prepared.plan
    }
}

impl RebootstrapReservation {
    pub(crate) const fn operation_id(&self) -> u64 {
        self.operation_id
    }

    pub(crate) const fn publication_sequence(&self) -> u64 {
        self.sequence
    }

    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.candidate_slot
    }
}

impl VerifiedRebootstrap {
    pub(crate) fn journal_link(&self) -> &RebootstrapJournalLink {
        &self.journal_link
    }

    #[expect(
        dead_code,
        reason = "the private test protocol retains the verified candidate for phase inspection"
    )]
    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.reserved.prepared.candidate_slot
    }
}

impl PublishRebootstrap {
    pub(crate) const fn operation_id(&self) -> u64 {
        self.0.reserved.prepared.operation_id
    }

    pub(crate) const fn publication_sequence(&self) -> u64 {
        self.0.reserved.prepared.sequence
    }

    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.0.reserved.prepared.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.0.reserved.prepared.candidate_slot
    }

    pub(crate) fn journal_link(&self) -> &RebootstrapJournalLink {
        &self.0.journal_link
    }
}

impl RetireRebootstrap {
    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.candidate_slot
    }
}

impl RecoveryRebootstrap {
    #[cfg(test)]
    pub(crate) const fn operation_id(&self) -> u64 {
        self.record.operation_id
    }

    #[cfg(test)]
    pub(crate) const fn publication_sequence(&self) -> u64 {
        self.record.publication_sequence
    }

    pub(crate) const fn disposition(&self) -> Option<RecoveryDisposition> {
        self.disposition
    }

    pub(crate) const fn phase(&self) -> RecoveryPhase {
        self.phase
    }

    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.record.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.record.candidate_slot
    }

    pub(crate) fn workspace_id_digest(&self) -> &str {
        &self.record.workspace_id_digest
    }

    pub(crate) const fn directory_dev(&self) -> u64 {
        self.record.directory_dev
    }

    pub(crate) const fn directory_ino(&self) -> u64 {
        self.record.directory_ino
    }

    pub(crate) const fn old_file_dev(&self) -> u64 {
        self.record.old_file_dev
    }

    pub(crate) const fn old_file_ino(&self) -> u64 {
        self.record.old_file_ino
    }

    pub(crate) const fn old_file_size(&self) -> u64 {
        self.record.old_file_size
    }

    pub(crate) fn old_file_ciphertext_digest(&self) -> &str {
        &self.record.old_file_ciphertext_digest
    }

    pub(crate) fn old_key_digest(&self) -> &str {
        &self.record.old_key_digest
    }

    pub(crate) fn old_slot_record_digest(&self) -> &str {
        &self.record.old_slot_record_digest
    }

    pub(crate) fn candidate_slot_record_digest(&self) -> &str {
        &self.record.candidate_slot_record_digest
    }

    pub(crate) const fn old_slot_origin_operation_id(&self) -> u64 {
        self.record.old_slot_origin_operation_id
    }

    pub(crate) const fn old_slot_origin_publication_sequence(&self) -> u64 {
        self.record.old_slot_origin_publication_sequence
    }

    pub(crate) const fn candidate_slot_origin_operation_id(&self) -> u64 {
        self.record.candidate_slot_origin_operation_id
    }

    pub(crate) const fn candidate_slot_origin_publication_sequence(&self) -> u64 {
        self.record.candidate_slot_origin_publication_sequence
    }

    pub(crate) const fn old_slot_created_by_operation(&self) -> bool {
        self.record.old_slot_created_by_operation
    }

    pub(crate) fn logical_evidence_digest(&self) -> Option<&str> {
        self.record.logical_evidence_digest.as_deref()
    }

    pub(crate) fn prepared_evidence_digest(&self) -> Option<&str> {
        self.record.prepared_evidence_digest.as_deref()
    }

    pub(crate) fn candidate_reserved_evidence_digest(&self) -> Option<&str> {
        self.record.candidate_reserved_evidence_digest.as_deref()
    }

    pub(crate) fn verified_evidence_digest(&self) -> Option<&str> {
        self.record.verified_evidence_digest.as_deref()
    }

    pub(crate) fn publication_evidence_digest(&self) -> Option<&str> {
        self.record.publication_evidence_digest.as_deref()
    }

    pub(crate) fn candidate_key_digest(&self) -> Option<&str> {
        self.record.candidate_key_digest.as_deref()
    }

    pub(crate) fn journal_link(&self) -> Result<RebootstrapJournalLink, RebootstrapError> {
        let logical = self
            .record
            .logical_evidence_digest
            .as_deref()
            .ok_or(RebootstrapError::PhaseRejected)?;
        let proof = self
            .record
            .recovery_proof_digest
            .as_deref()
            .ok_or(RebootstrapError::PhaseRejected)?;
        Ok(RebootstrapJournalLink {
            journal_id: format!("rebootstrap-{}", self.record.publication_sequence),
            slot_id: self.record.candidate_slot.journal_id(),
            publication_sequence: self.record.publication_sequence,
            manifest_digest: publication_digest(
                self.record.candidate_slot,
                self.record.publication_sequence,
                logical,
                proof,
            ),
            authority_digest: self.record.authority_digest.clone(),
            floor_digest: self.record.floor_digest.clone(),
            binding_digest: self.record.binding_digest.clone(),
        })
    }

    pub(crate) fn recovery_proof_digest(&self) -> Option<&str> {
        self.record.recovery_proof_digest.as_deref()
    }
}

impl DiscardRebootstrap {
    #[cfg(test)]
    pub(crate) const fn operation_id(&self) -> u64 {
        self.0.operation_id
    }

    #[cfg(test)]
    pub(crate) const fn publication_sequence(&self) -> u64 {
        self.0.publication_sequence
    }

    #[cfg(test)]
    pub(crate) fn phase(&self) -> DiscardPhase {
        match self.0.phase {
            PublicationPhase::Prepared => DiscardPhase::Prepared,
            PublicationPhase::CandidateReserved => DiscardPhase::CandidateReserved,
            PublicationPhase::Verified => DiscardPhase::Verified,
            PublicationPhase::PublishIntent
            | PublicationPhase::Published
            | PublicationPhase::ReopenedVerified
            | PublicationPhase::RetiredOld
            | PublicationPhase::Cancelled
            | PublicationPhase::Quarantined => {
                unreachable!("DiscardRebootstrap is constructed only for pre-intent phases")
            }
        }
    }

    #[cfg(test)]
    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.0.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.0.candidate_slot
    }

    #[cfg(test)]
    pub(crate) fn workspace_id_digest(&self) -> &str {
        &self.0.workspace_id_digest
    }

    #[cfg(test)]
    pub(crate) const fn directory_dev(&self) -> u64 {
        self.0.directory_dev
    }

    #[cfg(test)]
    pub(crate) const fn directory_ino(&self) -> u64 {
        self.0.directory_ino
    }

    #[cfg(test)]
    pub(crate) const fn old_file_dev(&self) -> u64 {
        self.0.old_file_dev
    }

    #[cfg(test)]
    pub(crate) const fn old_file_ino(&self) -> u64 {
        self.0.old_file_ino
    }

    #[cfg(test)]
    pub(crate) const fn old_file_size(&self) -> u64 {
        self.0.old_file_size
    }

    #[cfg(test)]
    pub(crate) fn old_file_ciphertext_digest(&self) -> &str {
        &self.0.old_file_ciphertext_digest
    }

    #[cfg(test)]
    pub(crate) fn old_key_digest(&self) -> &str {
        &self.0.old_key_digest
    }

    #[cfg(test)]
    pub(crate) fn old_slot_record_digest(&self) -> &str {
        &self.0.old_slot_record_digest
    }

    #[cfg(test)]
    pub(crate) fn candidate_slot_record_digest(&self) -> &str {
        &self.0.candidate_slot_record_digest
    }

    #[cfg(test)]
    pub(crate) const fn old_slot_origin_operation_id(&self) -> u64 {
        self.0.old_slot_origin_operation_id
    }

    #[cfg(test)]
    pub(crate) const fn old_slot_origin_publication_sequence(&self) -> u64 {
        self.0.old_slot_origin_publication_sequence
    }

    #[cfg(test)]
    pub(crate) const fn candidate_slot_origin_operation_id(&self) -> u64 {
        self.0.candidate_slot_origin_operation_id
    }

    #[cfg(test)]
    pub(crate) const fn candidate_slot_origin_publication_sequence(&self) -> u64 {
        self.0.candidate_slot_origin_publication_sequence
    }

    #[cfg(test)]
    pub(crate) const fn old_slot_created_by_operation(&self) -> bool {
        self.0.old_slot_created_by_operation
    }

    #[cfg(test)]
    pub(crate) fn prepared_evidence_digest(&self) -> Option<&str> {
        self.0.prepared_evidence_digest.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn candidate_key_digest(&self) -> Option<&str> {
        self.0.candidate_key_digest.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn candidate_reserved_evidence_digest(&self) -> Option<&str> {
        self.0.candidate_reserved_evidence_digest.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn verified_evidence_digest(&self) -> Option<&str> {
        self.0.verified_evidence_digest.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn logical_evidence_digest(&self) -> Option<&str> {
        self.0.logical_evidence_digest.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn publication_evidence_digest(&self) -> Option<&str> {
        self.0.publication_evidence_digest.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn recovery_proof_digest(&self) -> Option<&str> {
        self.0.recovery_proof_digest.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn journal_link(&self) -> Result<RebootstrapJournalLink, RebootstrapError> {
        if self.0.phase != PublicationPhase::Verified {
            return Err(RebootstrapError::PhaseRejected);
        }
        let logical = self
            .0
            .logical_evidence_digest
            .as_deref()
            .ok_or(RebootstrapError::PhaseRejected)?;
        let proof = self
            .0
            .recovery_proof_digest
            .as_deref()
            .ok_or(RebootstrapError::PhaseRejected)?;
        Ok(RebootstrapJournalLink {
            journal_id: format!("rebootstrap-{}", self.0.publication_sequence),
            slot_id: self.0.candidate_slot.journal_id(),
            publication_sequence: self.0.publication_sequence,
            manifest_digest: publication_digest(
                self.0.candidate_slot,
                self.0.publication_sequence,
                logical,
                proof,
            ),
            authority_digest: self.0.authority_digest.clone(),
            floor_digest: self.0.floor_digest.clone(),
            binding_digest: self.0.binding_digest.clone(),
        })
    }
}

#[cfg(test)]
impl TerminalRebootstrap {
    pub(crate) const fn phase(&self) -> TerminalPhase {
        self.phase
    }

    pub(crate) const fn operation_id(&self) -> u64 {
        self.record.operation_id
    }

    pub(crate) const fn publication_sequence(&self) -> u64 {
        self.record.publication_sequence
    }

    pub(crate) const fn old_slot(&self) -> RebootstrapSlot {
        self.record.old_slot
    }

    pub(crate) const fn candidate_slot(&self) -> RebootstrapSlot {
        self.record.candidate_slot
    }

    pub(crate) fn workspace_id_digest(&self) -> &str {
        &self.record.workspace_id_digest
    }

    pub(crate) const fn directory_dev(&self) -> u64 {
        self.record.directory_dev
    }

    pub(crate) const fn directory_ino(&self) -> u64 {
        self.record.directory_ino
    }

    pub(crate) const fn old_file_dev(&self) -> u64 {
        self.record.old_file_dev
    }

    pub(crate) const fn old_file_ino(&self) -> u64 {
        self.record.old_file_ino
    }

    pub(crate) const fn old_file_size(&self) -> u64 {
        self.record.old_file_size
    }

    pub(crate) fn old_file_ciphertext_digest(&self) -> &str {
        &self.record.old_file_ciphertext_digest
    }

    pub(crate) fn old_key_digest(&self) -> &str {
        &self.record.old_key_digest
    }

    pub(crate) fn old_slot_record_digest(&self) -> &str {
        &self.record.old_slot_record_digest
    }

    pub(crate) fn candidate_slot_record_digest(&self) -> &str {
        &self.record.candidate_slot_record_digest
    }

    pub(crate) const fn old_slot_origin_operation_id(&self) -> u64 {
        self.record.old_slot_origin_operation_id
    }

    pub(crate) const fn old_slot_origin_publication_sequence(&self) -> u64 {
        self.record.old_slot_origin_publication_sequence
    }

    pub(crate) const fn candidate_slot_origin_operation_id(&self) -> u64 {
        self.record.candidate_slot_origin_operation_id
    }

    pub(crate) const fn candidate_slot_origin_publication_sequence(&self) -> u64 {
        self.record.candidate_slot_origin_publication_sequence
    }

    pub(crate) const fn old_slot_created_by_operation(&self) -> bool {
        self.record.old_slot_created_by_operation
    }

    pub(crate) fn prepared_evidence_digest(&self) -> Option<&str> {
        self.record.prepared_evidence_digest.as_deref()
    }

    pub(crate) fn candidate_key_digest(&self) -> Option<&str> {
        self.record.candidate_key_digest.as_deref()
    }

    pub(crate) fn candidate_reserved_evidence_digest(&self) -> Option<&str> {
        self.record.candidate_reserved_evidence_digest.as_deref()
    }

    pub(crate) fn verified_evidence_digest(&self) -> Option<&str> {
        self.record.verified_evidence_digest.as_deref()
    }

    pub(crate) fn logical_evidence_digest(&self) -> Option<&str> {
        self.record.logical_evidence_digest.as_deref()
    }

    pub(crate) fn publication_evidence_digest(&self) -> Option<&str> {
        self.record.publication_evidence_digest.as_deref()
    }

    pub(crate) fn recovery_proof_digest(&self) -> Option<&str> {
        self.record.recovery_proof_digest.as_deref()
    }

    pub(crate) fn active_publication_link(&self) -> Option<&RebootstrapJournalLink> {
        self.active_publication_link.as_ref()
    }

    pub(crate) fn journal_link(&self) -> Result<RebootstrapJournalLink, RebootstrapError> {
        self.active_publication_link
            .clone()
            .ok_or(RebootstrapError::PhaseRejected)
    }
}

pub(crate) struct RebootstrapRuntime {
    journal: DesktopJournalStore,
    mode: RebootstrapMode,
    operation: Mutex<()>,
    authority: Mutex<AuthorityState>,
    requested_epoch: AtomicU64,
    next_operation: AtomicU64,
    consumed_operation: AtomicU64,
}

impl fmt::Debug for RebootstrapRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RebootstrapRuntime([REDACTED])")
    }
}

impl RebootstrapRuntime {
    pub(crate) fn new(journal: DesktopJournalStore) -> Self {
        Self {
            journal,
            mode: RebootstrapMode::ProductionQuarantine,
            operation: Mutex::new(()),
            authority: Mutex::new(AuthorityState {
                applied_epoch: 0,
                binding_digest: String::new(),
                authority_digest: String::new(),
                floor_digest: String::new(),
            }),
            requested_epoch: AtomicU64::new(0),
            next_operation: AtomicU64::new(0),
            consumed_operation: AtomicU64::new(0),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test_recovery(journal: DesktopJournalStore) -> Self {
        Self {
            journal,
            mode: RebootstrapMode::TestRecovery,
            operation: Mutex::new(()),
            authority: Mutex::new(AuthorityState {
                applied_epoch: 0,
                binding_digest: String::new(),
                authority_digest: String::new(),
                floor_digest: String::new(),
            }),
            requested_epoch: AtomicU64::new(0),
            next_operation: AtomicU64::new(0),
            consumed_operation: AtomicU64::new(0),
        }
    }

    pub(crate) fn apply_verified_authority(
        &self,
        binding_digest: String,
        authority_digest: String,
        floor_digest: String,
    ) -> Result<(), RebootstrapError> {
        self.require_test_recovery_mode()?;
        if [&binding_digest, &authority_digest, &floor_digest]
            .iter()
            .any(|value| value.len() != 64 || !is_lower_hex(value))
        {
            return Err(RebootstrapError::AuthorityStale);
        }
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let next = next_atomic(&self.requested_epoch)?;
        let mut authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        authority.applied_epoch = next;
        authority.binding_digest = binding_digest;
        authority.authority_digest = authority_digest;
        authority.floor_digest = floor_digest;
        Ok(())
    }

    pub(crate) fn begin(&self) -> Result<RebootstrapAdmission, RebootstrapError> {
        self.require_test_recovery_mode()?;
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        if authority.applied_epoch == 0
            || self.requested_epoch.load(Ordering::Acquire) != authority.applied_epoch
        {
            return Err(RebootstrapError::AuthorityStale);
        }
        let chain = self.validated_chain()?;
        if chain.last().is_some_and(|record| {
            !matches!(
                record.phase,
                PublicationPhase::RetiredOld | PublicationPhase::Cancelled
            )
        }) {
            return Err(RebootstrapError::PhaseRejected);
        }
        let last_operation = chain.last().map_or(0, |record| record.operation_id);
        self.next_operation
            .fetch_max(last_operation, Ordering::AcqRel);
        Ok(RebootstrapAdmission {
            operation_id: next_atomic(&self.next_operation)?,
            authority_epoch: authority.applied_epoch,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn allocate(
        &self,
        admission: RebootstrapAdmission,
        plan: RebootstrapPlan,
    ) -> Result<RebootstrapReservation, RebootstrapError> {
        self.require_test_recovery_mode()?;
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_epoch(&authority, admission.authority_epoch)?;
        let chain = self.validated_chain()?;
        self.consume(admission.operation_id)?;
        let old_slot = active_slot_from_record(chain.last())?;
        let candidate_slot = old_slot.other();
        let sequence = next_sequence(&chain)?;
        Ok(RebootstrapReservation {
            operation_id: admission.operation_id,
            authority_epoch: admission.authority_epoch,
            sequence,
            old_slot,
            candidate_slot,
            plan,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    #[expect(
        clippy::too_many_lines,
        reason = "the private prepare transition validates and snapshots one indivisible custody evidence transcript before its single journal append"
    )]
    pub(crate) fn prepare(
        &self,
        reservation: RebootstrapReservation,
        evidence: &PreparedEvidence,
    ) -> Result<PreparedRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_epoch(&authority, reservation.authority_epoch)?;
        if !evidence.matches(&reservation) {
            return Err(RebootstrapError::PhaseRejected);
        }
        let prepared_evidence_digest = checked_digest(evidence.digest())?;
        let candidate_key_digest = checked_digest(evidence.candidate_key_digest())?;
        let workspace_id_digest = checked_digest(evidence.workspace_id_digest())?;
        let directory_dev = evidence.directory_dev();
        let directory_ino = evidence.directory_ino();
        let old_file_dev = evidence.old_file_dev();
        let old_file_ino = evidence.old_file_ino();
        let old_file_size = evidence.old_file_size();
        let old_file_ciphertext_digest = checked_digest(evidence.old_file_ciphertext_digest())?;
        let old_key_digest = checked_digest(evidence.old_key_digest())?;
        let old_slot_record_digest = checked_digest(evidence.old_slot_record_digest())?;
        let candidate_slot_record_digest = checked_digest(evidence.candidate_slot_record_digest())?;
        if directory_dev == 0
            || directory_ino == 0
            || old_file_dev == 0
            || old_file_ino == 0
            || old_file_size == 0
        {
            return Err(RebootstrapError::PhaseRejected);
        }
        let old_slot_origin_operation_id = evidence.old_slot_origin_operation_id();
        let old_slot_origin_publication_sequence = evidence.old_slot_origin_publication_sequence();
        let candidate_slot_origin_operation_id = evidence.candidate_slot_origin_operation_id();
        let candidate_slot_origin_publication_sequence =
            evidence.candidate_slot_origin_publication_sequence();
        let old_slot_created_by_operation = evidence.old_slot_created_by_operation();
        if !valid_envelope_origins(
            reservation.operation_id,
            reservation.sequence,
            old_slot_origin_operation_id,
            old_slot_origin_publication_sequence,
            candidate_slot_origin_operation_id,
            candidate_slot_origin_publication_sequence,
            old_slot_created_by_operation,
        ) {
            return Err(RebootstrapError::PhaseRejected);
        }
        let chain = self.require_reservation_base(&reservation)?;
        let record = JournalRecord {
            schema_version: JOURNAL_SCHEMA_VERSION,
            operation_id: reservation.operation_id,
            publication_sequence: reservation.sequence,
            old_slot: reservation.old_slot,
            candidate_slot: reservation.candidate_slot,
            workspace_id_digest: workspace_id_digest.clone(),
            directory_dev,
            directory_ino,
            old_file_dev,
            old_file_ino,
            old_file_size,
            old_file_ciphertext_digest: old_file_ciphertext_digest.clone(),
            old_key_digest: old_key_digest.clone(),
            old_slot_record_digest: old_slot_record_digest.clone(),
            candidate_slot_record_digest: candidate_slot_record_digest.clone(),
            old_slot_origin_operation_id,
            old_slot_origin_publication_sequence,
            candidate_slot_origin_operation_id,
            candidate_slot_origin_publication_sequence,
            old_slot_created_by_operation,
            authority_digest: authority.authority_digest.clone(),
            floor_digest: authority.floor_digest.clone(),
            binding_digest: authority.binding_digest.clone(),
            prepared_evidence_digest: Some(prepared_evidence_digest.clone()),
            candidate_key_digest: Some(candidate_key_digest.clone()),
            candidate_reserved_evidence_digest: None,
            verified_evidence_digest: None,
            logical_evidence_digest: None,
            publication_evidence_digest: None,
            recovery_proof_digest: None,
            phase: PublicationPhase::Prepared,
        };
        if !valid_append_to_chain(&chain, &record) {
            return Err(RebootstrapError::PhaseRejected);
        }
        append_record(&self.journal, &record)?;
        Ok(PreparedRebootstrap {
            operation_id: reservation.operation_id,
            authority_epoch: reservation.authority_epoch,
            sequence: reservation.sequence,
            old_slot: reservation.old_slot,
            candidate_slot: reservation.candidate_slot,
            workspace_id_digest,
            directory_dev,
            directory_ino,
            old_file_dev,
            old_file_ino,
            old_file_size,
            old_file_ciphertext_digest,
            old_key_digest,
            old_slot_record_digest,
            candidate_slot_record_digest,
            old_slot_origin_operation_id,
            old_slot_origin_publication_sequence,
            candidate_slot_origin_operation_id,
            candidate_slot_origin_publication_sequence,
            old_slot_created_by_operation,
            prepared_evidence_digest,
            candidate_key_digest,
            plan: reservation.plan,
        })
    }

    pub(crate) fn candidate_journal_link(
        &self,
        reserved: &CandidateReservedRebootstrap,
        proof: &DatabaseRecoveryProof,
    ) -> Result<RebootstrapJournalLink, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let prepared = &reserved.prepared;
        self.require_epoch(&authority, prepared.authority_epoch)?;
        validate_candidate_proof(prepared, proof)?;
        self.require_exact_phase(
            prepared.operation_id,
            prepared.sequence,
            PublicationPhase::CandidateReserved,
        )?;
        make_journal_link(prepared, proof, &authority)
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "the prepared action is consumed after custody proves the closed candidate file"
    )]
    pub(crate) fn confirm_candidate_reserved(
        &self,
        prepared: PreparedRebootstrap,
        evidence: &CandidateReservedEvidence,
    ) -> Result<CandidateReservedRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_action_epoch(&prepared)?;
        if !evidence.matches(&prepared) {
            return Err(RebootstrapError::PhaseRejected);
        }
        let candidate_reserved_evidence_digest = checked_digest(evidence.digest())?;
        self.require_exact_phase(
            prepared.operation_id,
            prepared.sequence,
            PublicationPhase::Prepared,
        )?;
        self.advance(
            prepared.operation_id,
            prepared.sequence,
            PublicationPhase::Prepared,
            PublicationPhase::CandidateReserved,
            EvidenceUpdate {
                candidate_reserved: Some(candidate_reserved_evidence_digest.clone()),
                ..EvidenceUpdate::default()
            },
        )?;
        Ok(CandidateReservedRebootstrap {
            prepared,
            candidate_reserved_evidence_digest,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn verify_candidate(
        &self,
        reserved: CandidateReservedRebootstrap,
        proof: &DatabaseRecoveryProof,
        evidence: &VerifiedCustodyEvidence,
    ) -> Result<VerifiedRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        let prepared = &reserved.prepared;
        self.require_epoch(&authority, prepared.authority_epoch)?;
        validate_candidate_proof(prepared, proof)?;
        let logical_evidence_digest = checked_digest(&proof.row_digest)?;
        let verified_evidence_digest = checked_digest(evidence.digest())?;
        self.require_exact_phase(
            prepared.operation_id,
            prepared.sequence,
            PublicationPhase::CandidateReserved,
        )?;
        let proof_digest = recovery_proof_digest(proof)?;
        let link = make_journal_link(prepared, proof, &authority)?;
        if !evidence.matches(&reserved, proof, &link) {
            return Err(RebootstrapError::PhaseRejected);
        }
        self.advance(
            prepared.operation_id,
            prepared.sequence,
            PublicationPhase::CandidateReserved,
            PublicationPhase::Verified,
            EvidenceUpdate {
                verified: Some(verified_evidence_digest.clone()),
                logical: Some(logical_evidence_digest.clone()),
                proof: Some(proof_digest.clone()),
                ..EvidenceUpdate::default()
            },
        )?;
        Ok(VerifiedRebootstrap {
            reserved,
            verified_evidence_digest,
            logical_evidence_digest,
            recovery_proof_digest: proof_digest,
            journal_link: link,
        })
    }

    pub(crate) fn publish_intent(
        &self,
        verified: VerifiedRebootstrap,
    ) -> Result<PublishRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_action_epoch(&verified.reserved.prepared)?;
        self.advance(
            verified.reserved.prepared.operation_id,
            verified.reserved.prepared.sequence,
            PublicationPhase::Verified,
            PublicationPhase::PublishIntent,
            EvidenceUpdate {
                publication: Some(verified.verified_evidence_digest.clone()),
                ..EvidenceUpdate::default()
            },
        )?;
        Ok(PublishRebootstrap(verified))
    }

    pub(crate) fn confirm_published(
        &self,
        published: PublishRebootstrap,
    ) -> Result<PublishRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_action_epoch(&published.0.reserved.prepared)?;
        self.advance(
            published.0.reserved.prepared.operation_id,
            published.0.reserved.prepared.sequence,
            PublicationPhase::PublishIntent,
            PublicationPhase::Published,
            EvidenceUpdate::default(),
        )?;
        Ok(published)
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "opaque publication actions are linear and consumed by each transition"
    )]
    pub(crate) fn confirm_reopened(
        &self,
        published: PublishRebootstrap,
    ) -> Result<RetireRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_action_epoch(&published.0.reserved.prepared)?;
        self.advance(
            published.0.reserved.prepared.operation_id,
            published.0.reserved.prepared.sequence,
            PublicationPhase::Published,
            PublicationPhase::ReopenedVerified,
            EvidenceUpdate::default(),
        )?;
        Ok(RetireRebootstrap {
            operation_id: published.0.reserved.prepared.operation_id,
            sequence: published.0.reserved.prepared.sequence,
            authority_epoch: Some(published.0.reserved.prepared.authority_epoch),
            old_slot: published.0.reserved.prepared.old_slot,
            candidate_slot: published.0.reserved.prepared.candidate_slot,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn confirm_retired(
        &self,
        retired: RetireRebootstrap,
    ) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        if let Some(authority_epoch) = retired.authority_epoch {
            self.require_epoch_current(authority_epoch)?;
        }
        self.advance(
            retired.operation_id,
            retired.sequence,
            PublicationPhase::ReopenedVerified,
            PublicationPhase::RetiredOld,
            EvidenceUpdate::default(),
        )?;
        Ok(RebootstrapStatus::Published)
    }

    #[cfg(test)]
    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn confirm_retired_with_crash_for_test(
        &self,
        retired: RetireRebootstrap,
    ) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        if let Some(authority_epoch) = retired.authority_epoch {
            self.require_epoch_current(authority_epoch)?;
        }
        self.require_exact_phase(
            retired.operation_id,
            retired.sequence,
            PublicationPhase::ReopenedVerified,
        )?;
        Err(RebootstrapError::StorageRejected)
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn cancel(
        &self,
        prepared: PreparedRebootstrap,
    ) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.advance(
            prepared.operation_id,
            prepared.sequence,
            PublicationPhase::Prepared,
            PublicationPhase::Cancelled,
            EvidenceUpdate::default(),
        )?;
        Ok(RebootstrapStatus::Cancelled)
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "the reserved action is consumed after exact custody cleanup"
    )]
    pub(crate) fn cancel_candidate_reserved(
        &self,
        reserved: CandidateReservedRebootstrap,
    ) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.advance(
            reserved.prepared.operation_id,
            reserved.prepared.sequence,
            PublicationPhase::CandidateReserved,
            PublicationPhase::Cancelled,
            EvidenceUpdate::default(),
        )?;
        Ok(RebootstrapStatus::Cancelled)
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "opaque verified actions are one-shot cleanup capabilities"
    )]
    pub(crate) fn cancel_verified(
        &self,
        verified: VerifiedRebootstrap,
    ) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.advance(
            verified.reserved.prepared.operation_id,
            verified.reserved.prepared.sequence,
            PublicationPhase::Verified,
            PublicationPhase::Cancelled,
            EvidenceUpdate::default(),
        )?;
        Ok(RebootstrapStatus::Cancelled)
    }

    pub(crate) fn startup_status(&self) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        match self.mode {
            RebootstrapMode::ProductionQuarantine => self.production_startup_status(),
            #[cfg(test)]
            RebootstrapMode::TestRecovery => self.test_recovery_startup_status(),
        }
    }

    pub(crate) fn startup_action(&self) -> Result<StartupRebootstrapAction, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        match self.mode {
            RebootstrapMode::ProductionQuarantine => self.production_startup_action(),
            #[cfg(test)]
            RebootstrapMode::TestRecovery => self.test_recovery_startup_action(),
        }
    }

    pub(crate) fn startup_recovery(&self) -> Result<Option<RecoveryRebootstrap>, RebootstrapError> {
        match self.startup_action()? {
            StartupRebootstrapAction::Recover(recovery) => Ok(Some(recovery)),
            StartupRebootstrapAction::None
            | StartupRebootstrapAction::Discard(_)
            | StartupRebootstrapAction::Quarantined => Ok(None),
            #[cfg(test)]
            StartupRebootstrapAction::Terminal(_) => Ok(None),
        }
    }

    fn production_startup_status(&self) -> Result<RebootstrapStatus, RebootstrapError> {
        Ok(
            if self
                .journal
                .read_last()
                .map_err(map_custody_error)?
                .is_some()
            {
                RebootstrapStatus::Quarantined
            } else {
                RebootstrapStatus::Unavailable
            },
        )
    }

    fn production_startup_action(&self) -> Result<StartupRebootstrapAction, RebootstrapError> {
        Ok(
            if self
                .journal
                .read_last()
                .map_err(map_custody_error)?
                .is_some()
            {
                StartupRebootstrapAction::Quarantined
            } else {
                StartupRebootstrapAction::None
            },
        )
    }

    #[cfg(test)]
    fn test_recovery_startup_status(&self) -> Result<RebootstrapStatus, RebootstrapError> {
        let record = match self.test_recovery_startup_record()? {
            StartupJournalRecord::Empty => return Ok(RebootstrapStatus::Unavailable),
            StartupJournalRecord::Quarantined => return Ok(RebootstrapStatus::Quarantined),
            StartupJournalRecord::Valid { record, .. } => record,
        };
        Ok(match record.phase {
            PublicationPhase::Prepared
            | PublicationPhase::CandidateReserved
            | PublicationPhase::Verified
            | PublicationPhase::PublishIntent
            | PublicationPhase::Published
            | PublicationPhase::ReopenedVerified => RebootstrapStatus::RecoveryRequired,
            PublicationPhase::RetiredOld => RebootstrapStatus::Published,
            PublicationPhase::Cancelled => RebootstrapStatus::Cancelled,
            PublicationPhase::Quarantined => RebootstrapStatus::Quarantined,
        })
    }

    #[cfg(test)]
    fn test_recovery_startup_action(&self) -> Result<StartupRebootstrapAction, RebootstrapError> {
        let (record, active_publication_link) = match self.test_recovery_startup_record()? {
            StartupJournalRecord::Empty => return Ok(StartupRebootstrapAction::None),
            StartupJournalRecord::Quarantined => {
                return Ok(StartupRebootstrapAction::Quarantined);
            }
            StartupJournalRecord::Valid {
                record,
                active_publication_link,
            } => (record, active_publication_link),
        };
        match record.phase {
            PublicationPhase::Prepared
            | PublicationPhase::CandidateReserved
            | PublicationPhase::Verified => Ok(StartupRebootstrapAction::Discard(
                DiscardRebootstrap(record),
            )),
            phase @ (PublicationPhase::PublishIntent
            | PublicationPhase::Published
            | PublicationPhase::ReopenedVerified) => {
                let phase = match phase {
                    PublicationPhase::PublishIntent => RecoveryPhase::PublishIntent,
                    PublicationPhase::Published => RecoveryPhase::Published,
                    PublicationPhase::ReopenedVerified => RecoveryPhase::ReopenedVerified,
                    _ => return Err(RebootstrapError::PhaseRejected),
                };
                Ok(StartupRebootstrapAction::Recover(RecoveryRebootstrap {
                    record,
                    phase,
                    disposition: None,
                }))
            }
            PublicationPhase::Quarantined => Ok(StartupRebootstrapAction::Quarantined),
            phase @ (PublicationPhase::RetiredOld | PublicationPhase::Cancelled) => {
                let phase = match phase {
                    PublicationPhase::RetiredOld => TerminalPhase::RetiredOld,
                    PublicationPhase::Cancelled => TerminalPhase::Cancelled,
                    _ => return Err(RebootstrapError::PhaseRejected),
                };
                Ok(StartupRebootstrapAction::Terminal(TerminalRebootstrap {
                    record,
                    phase,
                    active_publication_link,
                }))
            }
        }
    }

    #[cfg(test)]
    fn test_recovery_startup_record(&self) -> Result<StartupJournalRecord, RebootstrapError> {
        match self.validated_chain() {
            Ok(chain) => Ok(match chain.into_parts() {
                (Some(record), active_publication_link) => StartupJournalRecord::Valid {
                    record,
                    active_publication_link,
                },
                (None, _) => StartupJournalRecord::Empty,
            }),
            Err(RebootstrapError::PhaseRejected) => Ok(StartupJournalRecord::Quarantined),
            Err(error) => Err(error),
        }
    }

    fn require_test_recovery_mode(&self) -> Result<(), RebootstrapError> {
        match self.mode {
            RebootstrapMode::ProductionQuarantine => Err(RebootstrapError::Unavailable),
            #[cfg(test)]
            RebootstrapMode::TestRecovery => Ok(()),
        }
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "the unresolved startup action is consumed into one explicit aggregate decision"
    )]
    pub(crate) fn resolve_recovery(
        &self,
        mut recovery: RecoveryRebootstrap,
        disposition: RecoveryDisposition,
    ) -> Result<RecoveryRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        if recovery.disposition.is_some() {
            return Err(RebootstrapError::PhaseRejected);
        }
        if disposition == RecoveryDisposition::CancelUnpublishedCandidate
            && recovery.phase != RecoveryPhase::PublishIntent
        {
            return Err(RebootstrapError::PhaseRejected);
        }
        self.require_exact_phase(
            recovery.record.operation_id,
            recovery.record.publication_sequence,
            recovery.record.phase,
        )?;
        recovery.disposition = Some(disposition);
        Ok(recovery)
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "opaque discard actions are one-shot cleanup capabilities"
    )]
    pub(crate) fn confirm_discarded(
        &self,
        discarded: DiscardRebootstrap,
    ) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.advance(
            discarded.0.operation_id,
            discarded.0.publication_sequence,
            discarded.0.phase,
            PublicationPhase::Cancelled,
            EvidenceUpdate::default(),
        )?;
        Ok(RebootstrapStatus::Cancelled)
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "opaque recovery actions are linear and consumed by each transition"
    )]
    pub(crate) fn confirm_recovery_reopened(
        &self,
        recovery: RecoveryRebootstrap,
    ) -> Result<RetireRebootstrap, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        if recovery.disposition != Some(RecoveryDisposition::ResumeCandidate) {
            return Err(RebootstrapError::PhaseRejected);
        }
        let chain = self.validated_chain()?;
        let current = chain.last().ok_or(RebootstrapError::PhaseRejected)?;
        if current.operation_id != recovery.record.operation_id
            || current.publication_sequence != recovery.record.publication_sequence
            || current.phase != recovery.record.phase
        {
            return Err(RebootstrapError::PhaseRejected);
        }
        let phase = recovery.record.phase;
        if phase == PublicationPhase::PublishIntent {
            self.advance(
                recovery.record.operation_id,
                recovery.record.publication_sequence,
                PublicationPhase::PublishIntent,
                PublicationPhase::Published,
                EvidenceUpdate::default(),
            )?;
        }
        if matches!(
            phase,
            PublicationPhase::PublishIntent | PublicationPhase::Published
        ) {
            self.advance(
                recovery.record.operation_id,
                recovery.record.publication_sequence,
                PublicationPhase::Published,
                PublicationPhase::ReopenedVerified,
                EvidenceUpdate::default(),
            )?;
        }
        Ok(RetireRebootstrap {
            operation_id: recovery.record.operation_id,
            sequence: recovery.record.publication_sequence,
            authority_epoch: None,
            old_slot: recovery.record.old_slot,
            candidate_slot: recovery.record.candidate_slot,
        })
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "opaque recovery actions are one-shot pre-exchange cleanup capabilities"
    )]
    pub(crate) fn confirm_recovery_cancelled(
        &self,
        recovery: RecoveryRebootstrap,
    ) -> Result<RebootstrapStatus, RebootstrapError> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        if recovery.disposition != Some(RecoveryDisposition::CancelUnpublishedCandidate)
            || recovery.phase != RecoveryPhase::PublishIntent
        {
            return Err(RebootstrapError::PhaseRejected);
        }
        self.advance(
            recovery.record.operation_id,
            recovery.record.publication_sequence,
            PublicationPhase::PublishIntent,
            PublicationPhase::Cancelled,
            EvidenceUpdate::default(),
        )?;
        Ok(RebootstrapStatus::Cancelled)
    }

    fn require_action_epoch(&self, prepared: &PreparedRebootstrap) -> Result<(), RebootstrapError> {
        let authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_epoch(&authority, prepared.authority_epoch)
    }

    fn require_epoch_current(&self, epoch: u64) -> Result<(), RebootstrapError> {
        let authority = self
            .authority
            .lock()
            .map_err(|_| RebootstrapError::StorageRejected)?;
        self.require_epoch(&authority, epoch)
    }

    fn require_epoch(
        &self,
        authority: &AuthorityState,
        epoch: u64,
    ) -> Result<(), RebootstrapError> {
        if authority.applied_epoch == epoch && self.requested_epoch.load(Ordering::Acquire) == epoch
        {
            Ok(())
        } else {
            Err(RebootstrapError::AuthorityStale)
        }
    }

    fn consume(&self, operation_id: u64) -> Result<(), RebootstrapError> {
        self.consumed_operation
            .try_update(Ordering::AcqRel, Ordering::Acquire, |last| {
                (operation_id > last).then_some(operation_id)
            })
            .map(|_| ())
            .map_err(|_| RebootstrapError::PhaseRejected)
    }

    #[cfg(test)]
    fn last_record(&self) -> Result<Option<JournalRecord>, RebootstrapError> {
        read_last_record(&self.journal)
    }

    fn validated_chain(&self) -> Result<ValidatedJournalChain, RebootstrapError> {
        let records = self.journal.read_all().map_err(|error| match error {
            DesktopCustodyError::Rejected => RebootstrapError::PhaseRejected,
            other => map_custody_error(other),
        })?;
        parse_validated_chain(records).ok_or(RebootstrapError::PhaseRejected)
    }

    fn require_exact_phase(
        &self,
        operation_id: u64,
        publication_sequence: u64,
        phase: PublicationPhase,
    ) -> Result<(), RebootstrapError> {
        let chain = self.validated_chain()?;
        let current = chain.last().ok_or(RebootstrapError::PhaseRejected)?;
        if current.operation_id == operation_id
            && current.publication_sequence == publication_sequence
            && current.phase == phase
        {
            Ok(())
        } else {
            Err(RebootstrapError::PhaseRejected)
        }
    }

    fn require_reservation_base(
        &self,
        reservation: &RebootstrapReservation,
    ) -> Result<ValidatedJournalChain, RebootstrapError> {
        let chain = self.validated_chain()?;
        if active_slot_from_record(chain.last())? != reservation.old_slot
            || reservation.candidate_slot != reservation.old_slot.other()
            || next_sequence(&chain)? != reservation.sequence
        {
            return Err(RebootstrapError::PhaseRejected);
        }
        Ok(chain)
    }

    fn advance(
        &self,
        operation_id: u64,
        publication_sequence: u64,
        expected: PublicationPhase,
        next: PublicationPhase,
        evidence: EvidenceUpdate,
    ) -> Result<(), RebootstrapError> {
        let chain = self.validated_chain()?;
        let mut record = chain
            .last()
            .cloned()
            .ok_or(RebootstrapError::PhaseRejected)?;
        if record.operation_id != operation_id
            || record.publication_sequence != publication_sequence
            || record.phase != expected
            || !valid_transition(expected, next)
        {
            return Err(RebootstrapError::PhaseRejected);
        }
        if let Some(value) = evidence.candidate_reserved {
            record.candidate_reserved_evidence_digest = Some(value);
        }
        if let Some(value) = evidence.verified {
            record.verified_evidence_digest = Some(value);
        }
        if let Some(value) = evidence.logical {
            record.logical_evidence_digest = Some(value);
        }
        if let Some(value) = evidence.publication {
            record.publication_evidence_digest = Some(value);
        }
        if let Some(value) = evidence.proof {
            record.recovery_proof_digest = Some(value);
        }
        record.phase = next;
        if !valid_append_to_chain(&chain, &record) {
            return Err(RebootstrapError::PhaseRejected);
        }
        append_record(&self.journal, &record)
    }
}

fn next_atomic(value: &AtomicU64) -> Result<u64, RebootstrapError> {
    value
        .try_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current
                .checked_add(1)
                .filter(|next| *next <= MAX_SAFE_INTEGER)
        })
        .map_err(|_| RebootstrapError::StorageRejected)?
        .checked_add(1)
        .ok_or(RebootstrapError::StorageRejected)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn checked_digest(value: &str) -> Result<String, RebootstrapError> {
    if value.len() == 64 && is_lower_hex(value) {
        Ok(value.to_owned())
    } else {
        Err(RebootstrapError::InvalidPlan)
    }
}

fn next_sequence(chain: &ValidatedJournalChain) -> Result<u64, RebootstrapError> {
    chain
        .last()
        .map_or(Some(1), |record| record.publication_sequence.checked_add(1))
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or(RebootstrapError::StorageRejected)
}

fn parse_validated_chain(records: Vec<Vec<u8>>) -> Option<ValidatedJournalChain> {
    if records.is_empty() {
        return Some(ValidatedJournalChain {
            last: None,
            active_publication_link: None,
        });
    }
    if records.len() > MAX_JOURNAL_RECORDS {
        return None;
    }
    let parsed = records
        .into_iter()
        .map(|bytes| serde_json::from_slice::<JournalRecord>(&bytes).ok())
        .collect::<Option<Vec<_>>>()?;
    if !valid_journal_chain(&parsed) {
        return None;
    }
    let mut active_publication_link = None;
    for record in &parsed {
        if record.phase == PublicationPhase::RetiredOld {
            active_publication_link = Some(publication_link_from_retired_record(record)?);
        }
    }
    Some(ValidatedJournalChain {
        last: parsed.into_iter().last(),
        active_publication_link,
    })
}

fn publication_link_from_retired_record(record: &JournalRecord) -> Option<RebootstrapJournalLink> {
    if record.phase != PublicationPhase::RetiredOld {
        return None;
    }
    let logical = record.logical_evidence_digest.as_deref()?;
    let proof = record.recovery_proof_digest.as_deref()?;
    Some(RebootstrapJournalLink {
        journal_id: format!("rebootstrap-{}", record.publication_sequence),
        slot_id: record.candidate_slot.journal_id(),
        publication_sequence: record.publication_sequence,
        manifest_digest: publication_digest(
            record.candidate_slot,
            record.publication_sequence,
            logical,
            proof,
        ),
        authority_digest: record.authority_digest.clone(),
        floor_digest: record.floor_digest.clone(),
        binding_digest: record.binding_digest.clone(),
    })
}

fn valid_append_to_chain(chain: &ValidatedJournalChain, next: &JournalRecord) -> bool {
    match chain.last() {
        Some(previous) => valid_journal_successor(previous, next),
        None => valid_initial_record(next),
    }
}

fn active_slot_from_record(
    previous: Option<&JournalRecord>,
) -> Result<RebootstrapSlot, RebootstrapError> {
    match previous {
        None => Ok(RebootstrapSlot::A),
        Some(record) if record.phase == PublicationPhase::RetiredOld => Ok(record.candidate_slot),
        Some(record) if record.phase == PublicationPhase::Cancelled => Ok(record.old_slot),
        Some(_) => Err(RebootstrapError::PhaseRejected),
    }
}

fn valid_transition(expected: PublicationPhase, next: PublicationPhase) -> bool {
    match expected {
        PublicationPhase::Prepared => matches!(
            next,
            PublicationPhase::CandidateReserved | PublicationPhase::Cancelled
        ),
        PublicationPhase::CandidateReserved => {
            matches!(
                next,
                PublicationPhase::Verified | PublicationPhase::Cancelled
            )
        }
        PublicationPhase::Verified => matches!(
            next,
            PublicationPhase::PublishIntent | PublicationPhase::Cancelled
        ),
        PublicationPhase::PublishIntent => matches!(
            next,
            PublicationPhase::Published | PublicationPhase::Cancelled
        ),
        PublicationPhase::Published => next == PublicationPhase::ReopenedVerified,
        PublicationPhase::ReopenedVerified => next == PublicationPhase::RetiredOld,
        PublicationPhase::RetiredOld
        | PublicationPhase::Cancelled
        | PublicationPhase::Quarantined => false,
    }
}

fn valid_optional_digest(value: Option<&str>) -> bool {
    value.is_some_and(|digest| digest.len() == 64 && is_lower_hex(digest))
}

fn valid_envelope_origins(
    operation_id: u64,
    publication_sequence: u64,
    old_slot_origin_operation_id: u64,
    old_slot_origin_publication_sequence: u64,
    candidate_slot_origin_operation_id: u64,
    candidate_slot_origin_publication_sequence: u64,
    old_slot_created_by_operation: bool,
) -> bool {
    let old_origin_is_current = old_slot_origin_operation_id == operation_id
        && old_slot_origin_publication_sequence == publication_sequence;
    let old_origin_is_prior = old_slot_origin_operation_id > 0
        && old_slot_origin_operation_id < operation_id
        && old_slot_origin_publication_sequence > 0
        && old_slot_origin_publication_sequence < publication_sequence;
    candidate_slot_origin_operation_id == operation_id
        && candidate_slot_origin_publication_sequence == publication_sequence
        && ((old_slot_created_by_operation && old_origin_is_current)
            || (!old_slot_created_by_operation && old_origin_is_prior))
}

fn valid_journal_record(record: &JournalRecord) -> bool {
    if record.schema_version != JOURNAL_SCHEMA_VERSION
        || record.operation_id == 0
        || record.operation_id > MAX_SAFE_INTEGER
        || record.publication_sequence == 0
        || record.publication_sequence > MAX_SAFE_INTEGER
        || record.old_slot == record.candidate_slot
        || record.directory_dev == 0
        || record.directory_ino == 0
        || record.old_file_dev == 0
        || record.old_file_ino == 0
        || record.old_file_size == 0
        || !valid_envelope_origins(
            record.operation_id,
            record.publication_sequence,
            record.old_slot_origin_operation_id,
            record.old_slot_origin_publication_sequence,
            record.candidate_slot_origin_operation_id,
            record.candidate_slot_origin_publication_sequence,
            record.old_slot_created_by_operation,
        )
        || [
            &record.workspace_id_digest,
            &record.old_file_ciphertext_digest,
            &record.old_key_digest,
            &record.old_slot_record_digest,
            &record.candidate_slot_record_digest,
            &record.authority_digest,
            &record.floor_digest,
            &record.binding_digest,
        ]
        .iter()
        .any(|value| value.len() != 64 || !is_lower_hex(value))
    {
        return false;
    }
    let prepared = valid_optional_digest(record.prepared_evidence_digest.as_deref())
        && valid_optional_digest(record.candidate_key_digest.as_deref());
    let reserved = valid_optional_digest(record.candidate_reserved_evidence_digest.as_deref());
    let verified = valid_optional_digest(record.verified_evidence_digest.as_deref())
        && valid_optional_digest(record.logical_evidence_digest.as_deref())
        && valid_optional_digest(record.recovery_proof_digest.as_deref());
    let publication = valid_optional_digest(record.publication_evidence_digest.as_deref());
    let prepared_shape = prepared
        && record.candidate_reserved_evidence_digest.is_none()
        && record.verified_evidence_digest.is_none()
        && record.logical_evidence_digest.is_none()
        && record.publication_evidence_digest.is_none()
        && record.recovery_proof_digest.is_none();
    let reserved_shape = prepared
        && reserved
        && record.verified_evidence_digest.is_none()
        && record.logical_evidence_digest.is_none()
        && record.publication_evidence_digest.is_none()
        && record.recovery_proof_digest.is_none();
    let verified_shape =
        prepared && reserved && verified && record.publication_evidence_digest.is_none();
    let post_intent_shape = prepared
        && reserved
        && verified
        && publication
        && record.publication_evidence_digest == record.verified_evidence_digest;
    match record.phase {
        PublicationPhase::Prepared => prepared_shape,
        PublicationPhase::CandidateReserved => reserved_shape,
        PublicationPhase::Verified => verified_shape,
        PublicationPhase::PublishIntent
        | PublicationPhase::Published
        | PublicationPhase::ReopenedVerified
        | PublicationPhase::RetiredOld => post_intent_shape,
        PublicationPhase::Cancelled => {
            prepared_shape || reserved_shape || verified_shape || post_intent_shape
        }
        PublicationPhase::Quarantined => false,
    }
}

fn valid_journal_chain(records: &[JournalRecord]) -> bool {
    let Some(first) = records.first() else {
        return false;
    };
    if records.len() > MAX_JOURNAL_RECORDS || !valid_initial_record(first) {
        return false;
    }
    records
        .windows(2)
        .all(|pair| valid_journal_successor(&pair[0], &pair[1]))
}

fn valid_initial_record(record: &JournalRecord) -> bool {
    valid_journal_record(record)
        && record.phase == PublicationPhase::Prepared
        && record.publication_sequence == 1
        && record.old_slot_created_by_operation
        && record.old_slot_origin_operation_id == record.operation_id
        && record.old_slot_origin_publication_sequence == record.publication_sequence
}

fn valid_journal_successor(previous: &JournalRecord, next: &JournalRecord) -> bool {
    if !valid_journal_record(next) || next.phase == PublicationPhase::Quarantined {
        return false;
    }
    if next.operation_id == previous.operation_id {
        return next.publication_sequence == previous.publication_sequence
            && valid_transition(previous.phase, next.phase)
            && same_operation_identity(previous, next)
            && valid_evidence_transition(previous, next);
    }
    let Some(expected_sequence) = previous.publication_sequence.checked_add(1) else {
        return false;
    };
    if !matches!(
        previous.phase,
        PublicationPhase::RetiredOld | PublicationPhase::Cancelled
    ) || next.phase != PublicationPhase::Prepared
        || next.operation_id <= previous.operation_id
        || next.publication_sequence != expected_sequence
        || active_slot_from_record(Some(previous)).ok() != Some(next.old_slot)
    {
        return false;
    }
    let (expected_origin_operation, expected_origin_sequence, expected_created) =
        match previous.phase {
            PublicationPhase::RetiredOld => (
                previous.candidate_slot_origin_operation_id,
                previous.candidate_slot_origin_publication_sequence,
                false,
            ),
            PublicationPhase::Cancelled if previous.old_slot_created_by_operation => {
                (next.operation_id, next.publication_sequence, true)
            }
            PublicationPhase::Cancelled => (
                previous.old_slot_origin_operation_id,
                previous.old_slot_origin_publication_sequence,
                false,
            ),
            _ => return false,
        };
    let common_custody_identity = next.workspace_id_digest == previous.workspace_id_digest
        && next.directory_dev == previous.directory_dev
        && next.directory_ino == previous.directory_ino;
    let active_key_continuity = match previous.phase {
        PublicationPhase::RetiredOld => {
            next.old_key_digest == previous.candidate_key_digest.as_deref().unwrap_or_default()
                && next.old_slot_record_digest == previous.candidate_slot_record_digest
        }
        PublicationPhase::Cancelled => {
            next.old_key_digest == previous.old_key_digest
                && (previous.old_slot_created_by_operation
                    || next.old_slot_record_digest == previous.old_slot_record_digest)
        }
        _ => false,
    };
    common_custody_identity
        && active_key_continuity
        && next.old_slot_origin_operation_id == expected_origin_operation
        && next.old_slot_origin_publication_sequence == expected_origin_sequence
        && next.old_slot_created_by_operation == expected_created
}

fn same_operation_identity(previous: &JournalRecord, next: &JournalRecord) -> bool {
    previous.old_slot == next.old_slot
        && previous.candidate_slot == next.candidate_slot
        && previous.workspace_id_digest == next.workspace_id_digest
        && previous.directory_dev == next.directory_dev
        && previous.directory_ino == next.directory_ino
        && previous.old_file_dev == next.old_file_dev
        && previous.old_file_ino == next.old_file_ino
        && previous.old_file_size == next.old_file_size
        && previous.old_file_ciphertext_digest == next.old_file_ciphertext_digest
        && previous.old_key_digest == next.old_key_digest
        && previous.old_slot_record_digest == next.old_slot_record_digest
        && previous.candidate_slot_record_digest == next.candidate_slot_record_digest
        && previous.old_slot_origin_operation_id == next.old_slot_origin_operation_id
        && previous.old_slot_origin_publication_sequence
            == next.old_slot_origin_publication_sequence
        && previous.candidate_slot_origin_operation_id == next.candidate_slot_origin_operation_id
        && previous.candidate_slot_origin_publication_sequence
            == next.candidate_slot_origin_publication_sequence
        && previous.old_slot_created_by_operation == next.old_slot_created_by_operation
        && previous.authority_digest == next.authority_digest
        && previous.floor_digest == next.floor_digest
        && previous.binding_digest == next.binding_digest
        && previous.prepared_evidence_digest == next.prepared_evidence_digest
        && previous.candidate_key_digest == next.candidate_key_digest
}

#[expect(
    clippy::match_same_arms,
    reason = "the private journal grammar spells out legal publication edges separately from the cancellation edge so protocol review cannot hide a newly admitted transition"
)]
fn valid_evidence_transition(previous: &JournalRecord, next: &JournalRecord) -> bool {
    let reserved_same =
        previous.candidate_reserved_evidence_digest == next.candidate_reserved_evidence_digest;
    let verified_same = previous.verified_evidence_digest == next.verified_evidence_digest;
    let logical_same = previous.logical_evidence_digest == next.logical_evidence_digest;
    let publication_same = previous.publication_evidence_digest == next.publication_evidence_digest;
    let proof_same = previous.recovery_proof_digest == next.recovery_proof_digest;
    match (previous.phase, next.phase) {
        (PublicationPhase::Prepared, PublicationPhase::CandidateReserved) => {
            previous.candidate_reserved_evidence_digest.is_none()
                && valid_optional_digest(next.candidate_reserved_evidence_digest.as_deref())
                && verified_same
                && logical_same
                && publication_same
                && proof_same
        }
        (PublicationPhase::CandidateReserved, PublicationPhase::Verified) => {
            reserved_same
                && previous.verified_evidence_digest.is_none()
                && valid_optional_digest(next.verified_evidence_digest.as_deref())
                && previous.logical_evidence_digest.is_none()
                && valid_optional_digest(next.logical_evidence_digest.as_deref())
                && previous.recovery_proof_digest.is_none()
                && valid_optional_digest(next.recovery_proof_digest.as_deref())
                && publication_same
        }
        (PublicationPhase::Verified, PublicationPhase::PublishIntent) => {
            reserved_same
                && verified_same
                && logical_same
                && proof_same
                && previous.publication_evidence_digest.is_none()
                && next.publication_evidence_digest == next.verified_evidence_digest
        }
        (PublicationPhase::PublishIntent, PublicationPhase::Published)
        | (PublicationPhase::Published, PublicationPhase::ReopenedVerified)
        | (PublicationPhase::ReopenedVerified, PublicationPhase::RetiredOld) => {
            reserved_same && verified_same && logical_same && publication_same && proof_same
        }
        (_, PublicationPhase::Cancelled) => {
            reserved_same && verified_same && logical_same && publication_same && proof_same
        }
        _ => false,
    }
}

fn validate_candidate_proof(
    prepared: &PreparedRebootstrap,
    proof: &DatabaseRecoveryProof,
) -> Result<(), RebootstrapError> {
    if proof.workspace_id != prepared.plan.workspace_id
        || proof.applied_server_revision != prepared.plan.pinned_head_revision
        || proof.row_digest.len() != 64
        || !is_lower_hex(&proof.row_digest)
    {
        return Err(RebootstrapError::InvalidPlan);
    }
    Ok(())
}

fn make_journal_link(
    prepared: &PreparedRebootstrap,
    proof: &DatabaseRecoveryProof,
    authority: &AuthorityState,
) -> Result<RebootstrapJournalLink, RebootstrapError> {
    let proof_digest = recovery_proof_digest(proof)?;
    Ok(RebootstrapJournalLink {
        journal_id: format!("rebootstrap-{}", prepared.sequence),
        slot_id: prepared.candidate_slot.journal_id(),
        publication_sequence: prepared.sequence,
        manifest_digest: publication_digest(
            prepared.candidate_slot,
            prepared.sequence,
            &proof.row_digest,
            &proof_digest,
        ),
        authority_digest: authority.authority_digest.clone(),
        floor_digest: authority.floor_digest.clone(),
        binding_digest: authority.binding_digest.clone(),
    })
}

fn publication_digest(
    slot: RebootstrapSlot,
    sequence: u64,
    candidate: &str,
    proof: &str,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"gooddealer.rebootstrap.publication.v1\0");
    digest.update(match slot {
        RebootstrapSlot::A => b"A",
        RebootstrapSlot::B => b"B",
    });
    digest.update(sequence.to_be_bytes());
    digest.update(candidate.as_bytes());
    digest.update(proof.as_bytes());
    hex(&digest.finalize())
}

fn recovery_proof_digest(proof: &DatabaseRecoveryProof) -> Result<String, RebootstrapError> {
    let encoded = serde_json::to_vec(proof).map_err(|_| RebootstrapError::StorageRejected)?;
    Ok(hex(&Sha256::digest(encoded)))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(
        String::with_capacity(bytes.len() * 2),
        |mut output, byte| {
            use std::fmt::Write as _;
            write!(output, "{byte:02x}").expect("String writes cannot fail");
            output
        },
    )
}

fn append_record(
    journal: &DesktopJournalStore,
    value: &JournalRecord,
) -> Result<(), RebootstrapError> {
    let bytes = serde_json::to_vec(value).map_err(|_| RebootstrapError::StorageRejected)?;
    if bytes.is_empty() || bytes.len() > 16_384 {
        return Err(RebootstrapError::StorageRejected);
    }
    journal.append(&bytes).map_err(map_custody_error)
}

#[cfg(test)]
fn read_last_record(
    journal: &DesktopJournalStore,
) -> Result<Option<JournalRecord>, RebootstrapError> {
    let bytes = journal.read_last().map_err(map_custody_error)?;
    bytes
        .map(|line| serde_json::from_slice(&line).map_err(|_| RebootstrapError::StorageRejected))
        .transpose()
}

const fn map_custody_error(error: DesktopCustodyError) -> RebootstrapError {
    match error {
        DesktopCustodyError::Rejected => RebootstrapError::PhaseRejected,
        DesktopCustodyError::Unavailable
        | DesktopCustodyError::RandomUnavailable
        | DesktopCustodyError::StorageRejected => RebootstrapError::StorageRejected,
    }
}

#[cfg(test)]
pub(crate) fn valid_rebootstrap_fixture(workspace_id: &str) -> (Vec<u8>, Vec<u8>) {
    let empty_snapshot = serde_json::json!([]);
    let partition_digest = fixture_digest(b"GOODDEALER-WORKSPACE-DOMAIN-ASSET-V1", &empty_snapshot);
    let checkpoint_digest = fixture_digest(
        b"GOODDEALER-WORKSPACE-ENTITY-DIGESTS-V2",
        &serde_json::json!([{
            "entityType": "domain_asset",
            "partitionId": "empty",
            "digest": partition_digest,
        }]),
    );
    let checkpoint = serde_json::json!({
        "schemaVersion": 2,
        "checkpointId": "checkpoint-fixture",
        "workspaceId": workspace_id,
        "workspaceSchemaVersion": 1,
        "throughServerRevision": 0,
        "checkpointDigest": checkpoint_digest,
    });
    let mut plan = serde_json::json!({
        "schemaVersion": 2,
        "checkpoint": checkpoint,
        "snapshot": [],
        "requiredMutationRange": {
            "fromServerRevisionExclusive": 0,
            "throughServerRevisionInclusive": 0,
        },
        "mutations": [],
        "pinnedHeadRevision": 0,
    });
    let pinned_digest = fixture_digest(b"GOODDEALER-WORKSPACE-REBOOTSTRAP-PLAN-V2", &plan);
    plan.as_object_mut()
        .expect("fixture plan is an object")
        .insert(
            "pinnedHeadDigest".to_owned(),
            serde_json::Value::String(pinned_digest),
        );
    let checkpoint_wire = serde_json::to_vec(&plan["checkpoint"]).expect("fixture serializes");
    let plan_wire = serde_json::to_vec(&plan).expect("fixture serializes");
    (checkpoint_wire, plan_wire)
}

#[cfg(test)]
fn fixture_digest(domain: &[u8], value: &serde_json::Value) -> String {
    use base64::Engine as _;

    let mut encoded = Vec::new();
    fixture_frame(&mut encoded, b'd', domain);
    fixture_frame(&mut encoded, b'v', &fixture_canonical_wire(value));
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(encoded))
}

#[cfg(test)]
fn fixture_canonical_wire(value: &serde_json::Value) -> Vec<u8> {
    let mut output = Vec::new();
    match value {
        serde_json::Value::Null => output.extend_from_slice(b"z0:"),
        serde_json::Value::Bool(value) => {
            output.extend_from_slice(if *value { b"b1:1" } else { b"b1:0" });
        }
        serde_json::Value::Number(value) => fixture_frame(
            &mut output,
            b'n',
            value
                .as_i64()
                .expect("fixture integer")
                .to_string()
                .as_bytes(),
        ),
        serde_json::Value::String(value) => fixture_frame(&mut output, b's', value.as_bytes()),
        serde_json::Value::Array(values) => {
            let mut entries = Vec::new();
            for value in values {
                fixture_frame(&mut entries, b'e', &fixture_canonical_wire(value));
            }
            fixture_frame(&mut output, b'a', &entries);
        }
        serde_json::Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut entries = Vec::new();
            for key in keys {
                let mut entry = Vec::new();
                fixture_frame(&mut entry, b'k', key.as_bytes());
                fixture_frame(&mut entry, b'v', &fixture_canonical_wire(&values[key]));
                fixture_frame(&mut entries, b'e', &entry);
            }
            fixture_frame(&mut output, b'o', &entries);
        }
    }
    output
}

#[cfg(test)]
fn fixture_frame(output: &mut Vec<u8>, tag: u8, payload: &[u8]) {
    output.push(tag);
    output.extend_from_slice(payload.len().to_string().as_bytes());
    output.push(b':');
    output.extend_from_slice(payload);
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn runtime() -> (tempfile::TempDir, RebootstrapRuntime) {
        let directory = tempdir().unwrap();
        let journal =
            DesktopJournalStore::for_test(directory.path().join("journal.jsonl")).unwrap();
        let runtime = RebootstrapRuntime::for_test_recovery(journal);
        runtime
            .apply_verified_authority("a".repeat(64), "b".repeat(64), "c".repeat(64))
            .unwrap();
        (directory, runtime)
    }

    fn plan() -> RebootstrapPlan {
        RebootstrapPlan {
            workspace_id: "workspace".to_owned(),
            checkpoint_revision: 0,
            pinned_head_revision: 0,
            snapshot: Vec::new(),
            replay_pages: Vec::new(),
        }
    }

    fn proof() -> DatabaseRecoveryProof {
        DatabaseRecoveryProof {
            workspace_id: "workspace".to_owned(),
            row_digest: "d".repeat(64),
            applied_server_revision: 0,
            local_commit_sequence: 0,
            next_device_mutation_sequence: 1,
        }
    }

    fn prepared_evidence(reservation: &RebootstrapReservation) -> PreparedEvidence {
        PreparedEvidence::for_test_for(reservation, "a".repeat(64), "b".repeat(64))
    }

    fn reserved_evidence(prepared: &PreparedRebootstrap) -> CandidateReservedEvidence {
        CandidateReservedEvidence::for_test_for(prepared, "c".repeat(64))
    }

    fn verified_evidence(
        reserved: &CandidateReservedRebootstrap,
        proof: &DatabaseRecoveryProof,
        link: &RebootstrapJournalLink,
    ) -> VerifiedCustodyEvidence {
        VerifiedCustodyEvidence::for_test_for(reserved, proof, link, "e".repeat(64))
    }

    fn prepared(runtime: &RebootstrapRuntime) -> PreparedRebootstrap {
        let reservation = runtime.allocate(runtime.begin().unwrap(), plan()).unwrap();
        let evidence = prepared_evidence(&reservation);
        runtime.prepare(reservation, &evidence).unwrap()
    }

    fn reserved(runtime: &RebootstrapRuntime) -> CandidateReservedRebootstrap {
        let prepared = prepared(runtime);
        let evidence = reserved_evidence(&prepared);
        runtime
            .confirm_candidate_reserved(prepared, &evidence)
            .unwrap()
    }

    fn verified(runtime: &RebootstrapRuntime) -> VerifiedRebootstrap {
        let reserved = reserved(runtime);
        let proof = proof();
        let link = runtime.candidate_journal_link(&reserved, &proof).unwrap();
        let evidence = verified_evidence(&reserved, &proof, &link);
        runtime
            .verify_candidate(reserved, &proof, &evidence)
            .unwrap()
    }

    fn record_for_phase(phase: PublicationPhase) -> JournalRecord {
        let reserved = matches!(
            phase,
            PublicationPhase::CandidateReserved
                | PublicationPhase::Verified
                | PublicationPhase::PublishIntent
                | PublicationPhase::Published
                | PublicationPhase::ReopenedVerified
                | PublicationPhase::RetiredOld
        );
        let verified = matches!(
            phase,
            PublicationPhase::Verified
                | PublicationPhase::PublishIntent
                | PublicationPhase::Published
                | PublicationPhase::ReopenedVerified
                | PublicationPhase::RetiredOld
        );
        let post_intent = matches!(
            phase,
            PublicationPhase::PublishIntent
                | PublicationPhase::Published
                | PublicationPhase::ReopenedVerified
                | PublicationPhase::RetiredOld
        );
        JournalRecord {
            schema_version: JOURNAL_SCHEMA_VERSION,
            operation_id: 1,
            publication_sequence: 1,
            old_slot: RebootstrapSlot::A,
            candidate_slot: RebootstrapSlot::B,
            workspace_id_digest: "e".repeat(64),
            directory_dev: 1,
            directory_ino: 1,
            old_file_dev: 1,
            old_file_ino: 1,
            old_file_size: 1,
            old_file_ciphertext_digest: "a".repeat(64),
            old_key_digest: "b".repeat(64),
            old_slot_record_digest: "f".repeat(64),
            candidate_slot_record_digest: "0".repeat(64),
            old_slot_origin_operation_id: 1,
            old_slot_origin_publication_sequence: 1,
            candidate_slot_origin_operation_id: 1,
            candidate_slot_origin_publication_sequence: 1,
            old_slot_created_by_operation: true,
            authority_digest: "b".repeat(64),
            floor_digest: "c".repeat(64),
            binding_digest: "a".repeat(64),
            prepared_evidence_digest: Some("a".repeat(64)),
            candidate_key_digest: Some("b".repeat(64)),
            candidate_reserved_evidence_digest: reserved.then(|| "c".repeat(64)),
            verified_evidence_digest: verified.then(|| "e".repeat(64)),
            logical_evidence_digest: verified.then(|| "d".repeat(64)),
            publication_evidence_digest: post_intent.then(|| "e".repeat(64)),
            recovery_proof_digest: verified.then(|| "f".repeat(64)),
            phase,
        }
    }

    fn record_with_preexisting_old_origin(phase: PublicationPhase) -> JournalRecord {
        let mut record = record_for_phase(phase);
        record.operation_id = 2;
        record.publication_sequence = 2;
        record.old_slot_record_digest = "0".repeat(64);
        record.candidate_slot_record_digest = "1".repeat(64);
        record.old_slot_origin_operation_id = 1;
        record.old_slot_origin_publication_sequence = 1;
        record.candidate_slot_origin_operation_id = 2;
        record.candidate_slot_origin_publication_sequence = 2;
        record.old_slot_created_by_operation = false;
        record
    }

    fn followup_record(
        operation_id: u64,
        publication_sequence: u64,
        phase: PublicationPhase,
    ) -> JournalRecord {
        let mut record = record_with_preexisting_old_origin(phase);
        record.operation_id = operation_id;
        record.publication_sequence = publication_sequence;
        record.candidate_slot_origin_operation_id = operation_id;
        record.candidate_slot_origin_publication_sequence = publication_sequence;
        record
    }

    fn recovery_record(phase: PublicationPhase) -> JournalRecord {
        record_for_phase(phase)
    }

    fn phase_prefix(phase: PublicationPhase) -> &'static [PublicationPhase] {
        match phase {
            PublicationPhase::Prepared => &[PublicationPhase::Prepared],
            PublicationPhase::CandidateReserved => &[
                PublicationPhase::Prepared,
                PublicationPhase::CandidateReserved,
            ],
            PublicationPhase::Verified => &[
                PublicationPhase::Prepared,
                PublicationPhase::CandidateReserved,
                PublicationPhase::Verified,
            ],
            PublicationPhase::PublishIntent => &[
                PublicationPhase::Prepared,
                PublicationPhase::CandidateReserved,
                PublicationPhase::Verified,
                PublicationPhase::PublishIntent,
            ],
            PublicationPhase::Published => &[
                PublicationPhase::Prepared,
                PublicationPhase::CandidateReserved,
                PublicationPhase::Verified,
                PublicationPhase::PublishIntent,
                PublicationPhase::Published,
            ],
            PublicationPhase::ReopenedVerified => &[
                PublicationPhase::Prepared,
                PublicationPhase::CandidateReserved,
                PublicationPhase::Verified,
                PublicationPhase::PublishIntent,
                PublicationPhase::Published,
                PublicationPhase::ReopenedVerified,
            ],
            PublicationPhase::RetiredOld => &[
                PublicationPhase::Prepared,
                PublicationPhase::CandidateReserved,
                PublicationPhase::Verified,
                PublicationPhase::PublishIntent,
                PublicationPhase::Published,
                PublicationPhase::ReopenedVerified,
                PublicationPhase::RetiredOld,
            ],
            PublicationPhase::Cancelled => {
                &[PublicationPhase::Prepared, PublicationPhase::Cancelled]
            }
            PublicationPhase::Quarantined => &[PublicationPhase::Quarantined],
        }
    }

    fn append_chain_through(journal: &DesktopJournalStore, phase: PublicationPhase) {
        for record in chain_records_through(phase) {
            append_record(journal, &record).unwrap();
        }
    }

    fn chain_records_through(phase: PublicationPhase) -> Vec<JournalRecord> {
        phase_prefix(phase)
            .iter()
            .map(|phase| record_for_phase(*phase))
            .collect()
    }

    fn assert_chain_quarantined_without_writing(records: Vec<JournalRecord>, case: &str) {
        let (_directory, runtime) = runtime();
        for record in records {
            append_record(&runtime.journal, &record).unwrap();
        }
        let before = runtime.journal.read_all().unwrap();
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Quarantined,
            "{case}"
        );
        assert!(
            matches!(
                runtime.startup_action().unwrap(),
                StartupRebootstrapAction::Quarantined
            ),
            "{case}"
        );
        assert_eq!(
            runtime.begin().unwrap_err(),
            RebootstrapError::PhaseRejected,
            "{case}"
        );
        assert_eq!(runtime.journal.read_all().unwrap(), before, "{case}");
    }

    macro_rules! assert_exact_prepared_components {
        ($action:expr) => {{
            assert_eq!($action.workspace_id_digest(), "e".repeat(64));
            assert_eq!($action.directory_dev(), 1);
            assert_eq!($action.directory_ino(), 1);
            assert_eq!($action.old_file_dev(), 1);
            assert_eq!($action.old_file_ino(), 1);
            assert_eq!($action.old_file_size(), 1);
            assert_eq!($action.old_file_ciphertext_digest(), "a".repeat(64));
            assert_eq!($action.old_key_digest(), "b".repeat(64));
            assert_eq!($action.old_slot_record_digest(), "f".repeat(64));
            assert_eq!($action.candidate_slot_record_digest(), "0".repeat(64));
        }};
    }

    fn append_preexisting_chain_through(journal: &DesktopJournalStore, phase: PublicationPhase) {
        for record in preexisting_retired_records() {
            append_record(journal, &record).unwrap();
        }
        for operation_phase in phase_prefix(phase) {
            append_record(
                journal,
                &record_with_preexisting_old_origin(*operation_phase),
            )
            .unwrap();
        }
    }

    fn preexisting_retired_records() -> Vec<JournalRecord> {
        phase_prefix(PublicationPhase::RetiredOld)
            .iter()
            .map(|phase| {
                let mut record = record_for_phase(*phase);
                record.old_slot = RebootstrapSlot::B;
                record.candidate_slot = RebootstrapSlot::A;
                record
            })
            .collect()
    }

    #[test]
    fn actions_are_opaque_and_redacted() {
        let (_directory, runtime) = runtime();
        let admission = runtime.begin().unwrap();
        assert_eq!(format!("{admission:?}"), "RebootstrapAdmission([OPAQUE])");
        let reservation = runtime.allocate(admission, plan()).unwrap();
        assert_eq!(
            format!("{reservation:?}"),
            "RebootstrapReservation([OPAQUE])"
        );
        let evidence = prepared_evidence(&reservation);
        let prepared = runtime.prepare(reservation, &evidence).unwrap();
        assert_eq!(format!("{prepared:?}"), "PreparedRebootstrap([OPAQUE])");
        assert_eq!(
            format!("{:?}", runtime.startup_action().unwrap()),
            "StartupRebootstrapAction::Discard([OPAQUE])"
        );
    }

    #[test]
    fn complete_typestate_sequence_is_monotonic_and_replay_rejected() {
        let (_directory, runtime) = runtime();
        let prepared = prepared(&runtime);
        assert_eq!(
            runtime.last_record().unwrap().unwrap().phase,
            PublicationPhase::Prepared
        );
        let evidence = reserved_evidence(&prepared);
        let reserved = runtime
            .confirm_candidate_reserved(prepared, &evidence)
            .unwrap();
        let expected_link = runtime.candidate_journal_link(&reserved, &proof()).unwrap();
        let proof = proof();
        let evidence = verified_evidence(&reserved, &proof, &expected_link);
        let verified = runtime
            .verify_candidate(reserved, &proof, &evidence)
            .unwrap();
        assert_eq!(verified.journal_link(), &expected_link);
        let published = runtime.publish_intent(verified).unwrap();
        let published = runtime.confirm_published(published).unwrap();
        let retired = runtime.confirm_reopened(published).unwrap();
        assert_eq!(retired.old_slot(), RebootstrapSlot::A);
        assert_eq!(
            runtime.confirm_retired(retired).unwrap(),
            RebootstrapStatus::Published
        );
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Published
        );
    }

    #[test]
    fn retired_append_failure_leaves_reopened_verified_for_restart_recovery() {
        let (_directory, runtime) = runtime();
        let verified = verified(&runtime);
        let published = runtime.publish_intent(verified).unwrap();
        let published = runtime.confirm_published(published).unwrap();
        let retired = runtime.confirm_reopened(published).unwrap();
        let before = runtime.journal.read_last().unwrap();

        assert_eq!(
            runtime
                .confirm_retired_with_crash_for_test(retired)
                .unwrap_err(),
            RebootstrapError::StorageRejected
        );
        assert_eq!(runtime.journal.read_last().unwrap(), before);
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::RecoveryRequired
        );
        let StartupRebootstrapAction::Recover(recovery) = runtime.startup_action().unwrap() else {
            panic!("reopened-verified append failure must remain restart-recoverable");
        };
        assert_eq!(recovery.phase(), RecoveryPhase::ReopenedVerified);
    }

    #[test]
    fn authority_transition_invalidates_in_flight_action_before_publish_intent() {
        let (_directory, runtime) = runtime();
        let verified = verified(&runtime);
        runtime
            .apply_verified_authority("f".repeat(64), "1".repeat(64), "2".repeat(64))
            .unwrap();
        assert_eq!(
            runtime.publish_intent(verified).unwrap_err(),
            RebootstrapError::AuthorityStale
        );
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::RecoveryRequired
        );
        let StartupRebootstrapAction::Discard(discard) = runtime.startup_action().unwrap() else {
            panic!("verified pre-intent state must require candidate discard");
        };
        assert_eq!(discard.candidate_slot(), RebootstrapSlot::B);
        assert_eq!(
            runtime.confirm_discarded(discard).unwrap(),
            RebootstrapStatus::Cancelled
        );
    }

    #[test]
    fn startup_classifies_every_crash_phase_without_promoting_pre_intent() {
        for (phase, expected) in [
            (
                PublicationPhase::Prepared,
                RebootstrapStatus::RecoveryRequired,
            ),
            (
                PublicationPhase::CandidateReserved,
                RebootstrapStatus::RecoveryRequired,
            ),
            (
                PublicationPhase::Verified,
                RebootstrapStatus::RecoveryRequired,
            ),
            (
                PublicationPhase::PublishIntent,
                RebootstrapStatus::RecoveryRequired,
            ),
            (
                PublicationPhase::Published,
                RebootstrapStatus::RecoveryRequired,
            ),
            (
                PublicationPhase::ReopenedVerified,
                RebootstrapStatus::RecoveryRequired,
            ),
            (PublicationPhase::RetiredOld, RebootstrapStatus::Published),
        ] {
            let (_directory, runtime) = runtime();
            append_chain_through(&runtime.journal, phase);
            assert_eq!(runtime.startup_status().unwrap(), expected, "{phase:?}");
        }
    }

    #[test]
    fn terminal_startup_action_preserves_exact_v3_custody_evidence() {
        for (phase, expected_phase) in [
            (PublicationPhase::Cancelled, TerminalPhase::Cancelled),
            (PublicationPhase::RetiredOld, TerminalPhase::RetiredOld),
        ] {
            let (_directory, runtime) = runtime();
            append_chain_through(&runtime.journal, phase);
            let before = runtime.journal.read_last().unwrap();
            let StartupRebootstrapAction::Terminal(terminal) = runtime.startup_action().unwrap()
            else {
                panic!("{phase:?} must produce an opaque terminal custody action");
            };

            assert_eq!(format!("{terminal:?}"), "TerminalRebootstrap([OPAQUE])");
            assert_eq!(terminal.phase(), expected_phase);
            assert_eq!(terminal.operation_id(), 1);
            assert_eq!(terminal.publication_sequence(), 1);
            assert_eq!(terminal.old_slot(), RebootstrapSlot::A);
            assert_eq!(terminal.candidate_slot(), RebootstrapSlot::B);
            assert_exact_prepared_components!(terminal);
            assert_eq!(
                terminal.prepared_evidence_digest(),
                Some("a".repeat(64).as_str())
            );
            assert_eq!(
                terminal.candidate_key_digest(),
                Some("b".repeat(64).as_str())
            );

            if phase == PublicationPhase::RetiredOld {
                assert_eq!(
                    terminal.candidate_reserved_evidence_digest(),
                    Some("c".repeat(64).as_str())
                );
                assert_eq!(
                    terminal.verified_evidence_digest(),
                    Some("e".repeat(64).as_str())
                );
                assert_eq!(
                    terminal.logical_evidence_digest(),
                    Some("d".repeat(64).as_str())
                );
                assert_eq!(
                    terminal.publication_evidence_digest(),
                    Some("e".repeat(64).as_str())
                );
                assert_eq!(
                    terminal.recovery_proof_digest(),
                    Some("f".repeat(64).as_str())
                );
                let expected = publication_link_from_retired_record(&record_for_phase(
                    PublicationPhase::RetiredOld,
                ))
                .unwrap();
                assert_eq!(terminal.active_publication_link(), Some(&expected));
                assert_eq!(terminal.journal_link().unwrap(), expected);
            } else {
                assert_eq!(terminal.candidate_reserved_evidence_digest(), None);
                assert_eq!(terminal.verified_evidence_digest(), None);
                assert_eq!(terminal.logical_evidence_digest(), None);
                assert_eq!(terminal.publication_evidence_digest(), None);
                assert_eq!(terminal.recovery_proof_digest(), None);
                assert_eq!(terminal.active_publication_link(), None);
                assert_eq!(
                    terminal.journal_link().unwrap_err(),
                    RebootstrapError::PhaseRejected
                );
            }
            assert_eq!(runtime.journal.read_last().unwrap(), before, "{phase:?}");
        }
    }

    #[test]
    fn production_startup_quarantines_every_legacy_record_without_writing() {
        for phase in [
            PublicationPhase::Prepared,
            PublicationPhase::CandidateReserved,
            PublicationPhase::Verified,
            PublicationPhase::PublishIntent,
            PublicationPhase::Published,
            PublicationPhase::ReopenedVerified,
            PublicationPhase::RetiredOld,
            PublicationPhase::Cancelled,
            PublicationPhase::Quarantined,
        ] {
            let directory = tempdir().unwrap();
            let journal =
                DesktopJournalStore::for_test(directory.path().join("journal.jsonl")).unwrap();
            let runtime = RebootstrapRuntime::new(journal);
            append_record(&runtime.journal, &record_for_phase(phase)).unwrap();
            let before = runtime.journal.read_last().unwrap();
            assert!(matches!(
                runtime.startup_action().unwrap(),
                StartupRebootstrapAction::Quarantined
            ));
            assert_eq!(
                runtime.startup_status().unwrap(),
                RebootstrapStatus::Quarantined
            );
            assert_eq!(runtime.journal.read_last().unwrap(), before, "{phase:?}");
        }
    }

    #[test]
    fn production_mode_is_unavailable_before_allocation_without_writing() {
        let directory = tempdir().unwrap();
        let journal =
            DesktopJournalStore::for_test(directory.path().join("journal.jsonl")).unwrap();
        let runtime = RebootstrapRuntime::new(journal);

        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Unavailable
        );
        assert!(matches!(
            runtime.startup_action().unwrap(),
            StartupRebootstrapAction::None
        ));
        assert_eq!(
            runtime
                .apply_verified_authority("a".repeat(64), "b".repeat(64), "c".repeat(64))
                .unwrap_err(),
            RebootstrapError::Unavailable
        );
        assert_eq!(runtime.begin().unwrap_err(), RebootstrapError::Unavailable);
        assert_eq!(
            runtime
                .allocate(
                    RebootstrapAdmission {
                        operation_id: 1,
                        authority_epoch: 1,
                    },
                    plan(),
                )
                .unwrap_err(),
            RebootstrapError::Unavailable
        );
        assert_eq!(runtime.requested_epoch.load(Ordering::Acquire), 0);
        assert_eq!(runtime.next_operation.load(Ordering::Acquire), 0);
        assert_eq!(runtime.consumed_operation.load(Ordering::Acquire), 0);
        let authority = runtime.authority.lock().unwrap();
        assert_eq!(authority.applied_epoch, 0);
        assert!(authority.binding_digest.is_empty());
        assert!(authority.authority_digest.is_empty());
        assert!(authority.floor_digest.is_empty());
        assert_eq!(runtime.journal.read_last().unwrap(), None);
    }

    #[test]
    fn production_startup_quarantines_unparseable_record_without_writing() {
        let directory = tempdir().unwrap();
        let journal =
            DesktopJournalStore::for_test(directory.path().join("journal.jsonl")).unwrap();
        let runtime = RebootstrapRuntime::new(journal);
        runtime.journal.append(b"not-json").unwrap();
        let before = runtime.journal.read_last().unwrap();

        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Quarantined
        );
        assert!(matches!(
            runtime.startup_action().unwrap(),
            StartupRebootstrapAction::Quarantined
        ));
        assert_eq!(runtime.journal.read_last().unwrap(), before);
    }

    #[test]
    fn test_recovery_startup_quarantines_unparseable_record_without_writing() {
        let (_directory, runtime) = runtime();
        runtime.journal.append(b"not-json").unwrap();
        let before = runtime.journal.read_last().unwrap();

        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Quarantined
        );
        assert!(matches!(
            runtime.startup_action().unwrap(),
            StartupRebootstrapAction::Quarantined
        ));
        assert_eq!(runtime.journal.read_last().unwrap(), before);
    }

    #[test]
    fn test_recovery_startup_quarantines_non_v3_records_without_writing() {
        for schema_version in [1, 2, 4] {
            let (_directory, runtime) = runtime();
            let mut record = record_for_phase(PublicationPhase::Published);
            record.schema_version = schema_version;
            append_record(&runtime.journal, &record).unwrap();
            let before = runtime.journal.read_last().unwrap();

            assert_eq!(
                runtime.startup_status().unwrap(),
                RebootstrapStatus::Quarantined,
                "schema v{schema_version}"
            );
            assert!(
                matches!(
                    runtime.startup_action().unwrap(),
                    StartupRebootstrapAction::Quarantined
                ),
                "schema v{schema_version}"
            );
            assert_eq!(
                runtime.journal.read_last().unwrap(),
                before,
                "schema v{schema_version}"
            );
        }
    }

    #[test]
    fn test_recovery_startup_quarantines_v3_missing_mandatory_origin_fields_without_writing() {
        for field in [
            "oldSlotOriginOperationId",
            "oldSlotOriginPublicationSequence",
            "candidateSlotOriginOperationId",
            "candidateSlotOriginPublicationSequence",
            "oldSlotCreatedByOperation",
        ] {
            let (_directory, runtime) = runtime();
            let mut wire = serde_json::to_value(record_for_phase(PublicationPhase::Published))
                .unwrap()
                .as_object()
                .unwrap()
                .clone();
            assert!(wire.remove(field).is_some(), "fixture must contain {field}");
            let bytes = serde_json::to_vec(&wire).unwrap();
            runtime.journal.append(&bytes).unwrap();
            let before = runtime.journal.read_last().unwrap();

            assert_eq!(
                runtime.startup_status().unwrap(),
                RebootstrapStatus::Quarantined,
                "missing {field}"
            );
            assert!(
                matches!(
                    runtime.startup_action().unwrap(),
                    StartupRebootstrapAction::Quarantined
                ),
                "missing {field}"
            );
            assert_eq!(
                runtime.journal.read_last().unwrap(),
                before,
                "missing {field}"
            );
        }
    }

    #[test]
    fn test_recovery_startup_quarantines_inconsistent_origin_facts_without_writing() {
        let valid = record_with_preexisting_old_origin(PublicationPhase::Published);
        let mut cases = Vec::new();

        let mut record = valid.clone();
        record.old_slot_origin_operation_id = 0;
        cases.push(record);
        let mut record = valid.clone();
        record.old_slot_origin_publication_sequence = 0;
        cases.push(record);
        let mut record = valid.clone();
        record.old_slot_origin_operation_id = 3;
        cases.push(record);
        let mut record = valid.clone();
        record.old_slot_origin_publication_sequence = 3;
        cases.push(record);
        let mut record = valid.clone();
        record.candidate_slot_origin_operation_id = 1;
        cases.push(record);
        let mut record = valid.clone();
        record.candidate_slot_origin_publication_sequence = 1;
        cases.push(record);
        let mut record = valid.clone();
        record.old_slot_created_by_operation = true;
        cases.push(record);
        let mut record = valid.clone();
        record.old_slot_origin_operation_id = 2;
        cases.push(record);
        let mut record = valid.clone();
        record.old_slot_origin_publication_sequence = 2;
        cases.push(record);
        let mut record = valid;
        record.old_slot_origin_operation_id = 2;
        record.old_slot_origin_publication_sequence = 2;
        cases.push(record);

        for (index, record) in cases.into_iter().enumerate() {
            let (_directory, runtime) = runtime();
            append_record(&runtime.journal, &record).unwrap();
            let before = runtime.journal.read_last().unwrap();
            assert_eq!(
                runtime.startup_status().unwrap(),
                RebootstrapStatus::Quarantined,
                "invalid origin case {index}"
            );
            assert!(matches!(
                runtime.startup_action().unwrap(),
                StartupRebootstrapAction::Quarantined
            ));
            assert_eq!(runtime.journal.read_last().unwrap(), before);
        }
    }

    #[test]
    fn typed_startup_actions_preserve_preexisting_old_envelope_origin() {
        let (_directory, discard_runtime) = runtime();
        append_preexisting_chain_through(
            &discard_runtime.journal,
            PublicationPhase::CandidateReserved,
        );
        let StartupRebootstrapAction::Discard(discard) = discard_runtime.startup_action().unwrap()
        else {
            panic!("candidate-reserved record must expose discard custody evidence");
        };
        assert_eq!(discard.old_slot_origin_operation_id(), 1);
        assert_eq!(discard.old_slot_origin_publication_sequence(), 1);
        assert_eq!(discard.candidate_slot_origin_operation_id(), 2);
        assert_eq!(discard.candidate_slot_origin_publication_sequence(), 2);
        assert!(!discard.old_slot_created_by_operation());

        let (_directory, recovery_runtime) = runtime();
        append_preexisting_chain_through(&recovery_runtime.journal, PublicationPhase::Published);
        let StartupRebootstrapAction::Recover(recovery) =
            recovery_runtime.startup_action().unwrap()
        else {
            panic!("published record must expose recovery custody evidence");
        };
        assert_eq!(recovery.old_slot_origin_operation_id(), 1);
        assert_eq!(recovery.old_slot_origin_publication_sequence(), 1);
        assert_eq!(recovery.candidate_slot_origin_operation_id(), 2);
        assert_eq!(recovery.candidate_slot_origin_publication_sequence(), 2);
        assert!(!recovery.old_slot_created_by_operation());

        let (_directory, terminal_runtime) = runtime();
        append_preexisting_chain_through(&terminal_runtime.journal, PublicationPhase::RetiredOld);
        let StartupRebootstrapAction::Terminal(terminal) =
            terminal_runtime.startup_action().unwrap()
        else {
            panic!("retired record must expose terminal custody evidence");
        };
        assert_eq!(terminal.old_slot_origin_operation_id(), 1);
        assert_eq!(terminal.old_slot_origin_publication_sequence(), 1);
        assert_eq!(terminal.candidate_slot_origin_operation_id(), 2);
        assert_eq!(terminal.candidate_slot_origin_publication_sequence(), 2);
        assert!(!terminal.old_slot_created_by_operation());
    }

    #[test]
    fn tampered_journal_is_quarantined_and_not_replayed() {
        let (_directory, runtime) = runtime();
        append_record(
            &runtime.journal,
            &JournalRecord {
                schema_version: 9,
                operation_id: 1,
                publication_sequence: 1,
                old_slot: RebootstrapSlot::A,
                candidate_slot: RebootstrapSlot::A,
                workspace_id_digest: "bad".to_owned(),
                directory_dev: 0,
                directory_ino: 0,
                old_file_dev: 0,
                old_file_ino: 0,
                old_file_size: 0,
                old_file_ciphertext_digest: "bad".to_owned(),
                old_key_digest: "bad".to_owned(),
                old_slot_record_digest: "bad".to_owned(),
                candidate_slot_record_digest: "bad".to_owned(),
                old_slot_origin_operation_id: 1,
                old_slot_origin_publication_sequence: 1,
                candidate_slot_origin_operation_id: 1,
                candidate_slot_origin_publication_sequence: 1,
                old_slot_created_by_operation: true,
                authority_digest: "bad".to_owned(),
                floor_digest: "c".repeat(64),
                binding_digest: "a".repeat(64),
                prepared_evidence_digest: None,
                candidate_key_digest: None,
                candidate_reserved_evidence_digest: None,
                verified_evidence_digest: None,
                logical_evidence_digest: None,
                publication_evidence_digest: None,
                recovery_proof_digest: None,
                phase: PublicationPhase::Published,
            },
        )
        .unwrap();
        let before_startup = runtime.journal.read_last().unwrap();
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Quarantined
        );
        assert!(matches!(
            runtime.startup_action().unwrap(),
            StartupRebootstrapAction::Quarantined
        ));
        assert_eq!(runtime.journal.read_last().unwrap(), before_startup);
        assert_eq!(
            runtime.begin().unwrap_err(),
            RebootstrapError::PhaseRejected
        );
        assert_eq!(runtime.journal.read_last().unwrap(), before_startup);
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Quarantined
        );
    }

    #[test]
    fn operation_replay_and_out_of_order_phase_fail_closed() {
        let (_directory, runtime) = runtime();
        let admission = runtime.begin().unwrap();
        let replay = RebootstrapAdmission {
            operation_id: admission.operation_id,
            authority_epoch: admission.authority_epoch,
        };
        let reservation = runtime.allocate(admission, plan()).unwrap();
        assert_eq!(
            runtime.allocate(replay, plan()).unwrap_err(),
            RebootstrapError::PhaseRejected
        );
        let evidence = prepared_evidence(&reservation);
        let prepared = runtime.prepare(reservation, &evidence).unwrap();
        assert_eq!(
            runtime.cancel(prepared).unwrap(),
            RebootstrapStatus::Cancelled
        );
    }

    #[test]
    fn typed_custody_evidence_cannot_be_swapped_between_actions() {
        let (_directory, first_runtime) = runtime();
        let first = first_runtime
            .allocate(first_runtime.begin().unwrap(), plan())
            .unwrap();
        let first_evidence = prepared_evidence(&first);
        let second = first_runtime
            .allocate(first_runtime.begin().unwrap(), plan())
            .unwrap();
        assert_eq!(
            first_runtime.prepare(second, &first_evidence).unwrap_err(),
            RebootstrapError::PhaseRejected
        );

        let (_directory, second_runtime) = runtime();
        let prepared = prepared(&second_runtime);
        let foreign_prepared = PreparedRebootstrap {
            operation_id: prepared.operation_id + 1,
            authority_epoch: prepared.authority_epoch,
            sequence: prepared.sequence,
            old_slot: prepared.old_slot,
            candidate_slot: prepared.candidate_slot,
            workspace_id_digest: prepared.workspace_id_digest.clone(),
            directory_dev: prepared.directory_dev,
            directory_ino: prepared.directory_ino,
            old_file_dev: prepared.old_file_dev,
            old_file_ino: prepared.old_file_ino,
            old_file_size: prepared.old_file_size,
            old_file_ciphertext_digest: prepared.old_file_ciphertext_digest.clone(),
            old_key_digest: prepared.old_key_digest.clone(),
            old_slot_record_digest: prepared.old_slot_record_digest.clone(),
            candidate_slot_record_digest: prepared.candidate_slot_record_digest.clone(),
            old_slot_origin_operation_id: prepared.old_slot_origin_operation_id,
            old_slot_origin_publication_sequence: prepared.old_slot_origin_publication_sequence,
            candidate_slot_origin_operation_id: prepared.candidate_slot_origin_operation_id,
            candidate_slot_origin_publication_sequence: prepared
                .candidate_slot_origin_publication_sequence,
            old_slot_created_by_operation: prepared.old_slot_created_by_operation,
            prepared_evidence_digest: prepared.prepared_evidence_digest.clone(),
            candidate_key_digest: prepared.candidate_key_digest.clone(),
            plan: plan(),
        };
        let foreign_evidence = reserved_evidence(&foreign_prepared);
        assert_eq!(
            second_runtime
                .confirm_candidate_reserved(prepared, &foreign_evidence)
                .unwrap_err(),
            RebootstrapError::PhaseRejected
        );

        let (_directory, third_runtime) = runtime();
        let reserved = reserved(&third_runtime);
        let expected_proof = proof();
        let link = third_runtime
            .candidate_journal_link(&reserved, &expected_proof)
            .unwrap();
        let mut foreign_proof = proof();
        foreign_proof.row_digest = "e".repeat(64);
        let foreign_evidence = verified_evidence(&reserved, &foreign_proof, &link);
        assert_eq!(
            third_runtime
                .verify_candidate(reserved, &expected_proof, &foreign_evidence)
                .unwrap_err(),
            RebootstrapError::PhaseRejected
        );
    }

    #[test]
    fn hostile_checkpoint_and_plan_are_bounded_and_exact() {
        let (checkpoint_wire, plan_wire) = valid_rebootstrap_fixture("workspace");
        let checkpoint = RebootstrapCheckpoint::parse(&checkpoint_wire).unwrap();
        let parsed = RebootstrapPlan::parse(&checkpoint, &plan_wire).unwrap();
        assert_eq!(parsed.workspace_id(), "workspace");
        assert_eq!(parsed.pinned_head_revision(), 0);

        assert!(RebootstrapCheckpoint::parse(&[]).is_err());
        assert!(RebootstrapCheckpoint::parse(&vec![b'x'; MAX_CHECKPOINT_BYTES + 1]).is_err());
        let checkpoint = RebootstrapCheckpoint(CheckpointWire {
            schema_version: 2,
            checkpoint_id: "checkpoint".to_owned(),
            workspace_id: "workspace".to_owned(),
            workspace_schema_version: 1,
            through_server_revision: 0,
            checkpoint_digest: "0".repeat(43),
        });
        assert!(RebootstrapPlan::parse(&checkpoint, &vec![b'x'; MAX_PLAN_BYTES + 1]).is_err());
        assert!(RebootstrapPlan::parse(&checkpoint, br#"{"unknown":true}"#).is_err());
    }

    #[test]
    fn startup_recovery_is_unresolved_until_aggregate_proves_resume() {
        for phase in [
            PublicationPhase::PublishIntent,
            PublicationPhase::Published,
            PublicationPhase::ReopenedVerified,
        ] {
            let (_directory, runtime) = runtime();
            append_chain_through(&runtime.journal, phase);
            let recovery = runtime.startup_recovery().unwrap().unwrap();
            assert_eq!(recovery.disposition(), None);
            assert_eq!(recovery.operation_id(), 1);
            assert_eq!(recovery.publication_sequence(), 1);
            assert_eq!(
                recovery.phase(),
                match phase {
                    PublicationPhase::PublishIntent => RecoveryPhase::PublishIntent,
                    PublicationPhase::Published => RecoveryPhase::Published,
                    PublicationPhase::ReopenedVerified => RecoveryPhase::ReopenedVerified,
                    _ => unreachable!(),
                }
            );
            assert_eq!(recovery.old_slot(), RebootstrapSlot::A);
            assert_eq!(recovery.candidate_slot(), RebootstrapSlot::B);
            assert_exact_prepared_components!(recovery);
            let expected_prepared = "a".repeat(64);
            let expected_key = "b".repeat(64);
            let expected_reserved = "c".repeat(64);
            let expected_verified = "e".repeat(64);
            let expected_logical = "d".repeat(64);
            let expected_proof = "f".repeat(64);
            assert_eq!(
                recovery.prepared_evidence_digest(),
                Some(expected_prepared.as_str())
            );
            assert_eq!(recovery.candidate_key_digest(), Some(expected_key.as_str()));
            assert_eq!(
                recovery.candidate_reserved_evidence_digest(),
                Some(expected_reserved.as_str())
            );
            assert_eq!(
                recovery.verified_evidence_digest(),
                Some(expected_verified.as_str())
            );
            assert_eq!(
                recovery.logical_evidence_digest(),
                Some(expected_logical.as_str())
            );
            assert_eq!(
                recovery.publication_evidence_digest(),
                Some(expected_verified.as_str())
            );
            assert_eq!(
                recovery.recovery_proof_digest(),
                Some(expected_proof.as_str())
            );
            assert_eq!(
                recovery.journal_link().unwrap().manifest_digest,
                publication_digest(RebootstrapSlot::B, 1, &expected_logical, &expected_proof,)
            );
            let recovery = runtime
                .resolve_recovery(recovery, RecoveryDisposition::ResumeCandidate)
                .unwrap();
            let retirement = runtime.confirm_recovery_reopened(recovery).unwrap();
            assert_eq!(retirement.old_slot(), RebootstrapSlot::A);
            assert_eq!(retirement.candidate_slot(), RebootstrapSlot::B);
            assert_eq!(
                runtime.confirm_retired(retirement).unwrap(),
                RebootstrapStatus::Published
            );
        }
    }

    #[test]
    fn topology_resolution_only_cancels_an_unexchanged_publish_intent() {
        let (_directory, runtime) = runtime();
        append_chain_through(&runtime.journal, PublicationPhase::PublishIntent);
        runtime
            .apply_verified_authority("1".repeat(64), "2".repeat(64), "3".repeat(64))
            .unwrap();
        let recovery = runtime.startup_recovery().unwrap().unwrap();
        assert_eq!(recovery.disposition(), None);
        assert_eq!(
            runtime.confirm_recovery_cancelled(recovery).unwrap_err(),
            RebootstrapError::PhaseRejected
        );
        let recovery = runtime.startup_recovery().unwrap().unwrap();
        let recovery = runtime
            .resolve_recovery(recovery, RecoveryDisposition::CancelUnpublishedCandidate)
            .unwrap();
        assert_eq!(
            runtime.confirm_recovery_cancelled(recovery).unwrap(),
            RebootstrapStatus::Cancelled
        );
        assert!(runtime.startup_recovery().unwrap().is_none());

        for phase in [
            PublicationPhase::Published,
            PublicationPhase::ReopenedVerified,
        ] {
            let (_directory, later_runtime) = super::tests::runtime();
            append_chain_through(&later_runtime.journal, phase);
            let recovery = later_runtime.startup_recovery().unwrap().unwrap();
            assert_eq!(
                later_runtime
                    .resolve_recovery(recovery, RecoveryDisposition::CancelUnpublishedCandidate,)
                    .unwrap_err(),
                RebootstrapError::PhaseRejected
            );
        }
    }

    #[test]
    fn malformed_recovery_evidence_is_quarantined() {
        let (_directory, runtime) = runtime();
        append_chain_through(&runtime.journal, PublicationPhase::PublishIntent);
        let mut record = recovery_record(PublicationPhase::Published);
        record.verified_evidence_digest = Some("NOT-A-DIGEST".to_owned());
        append_record(&runtime.journal, &record).unwrap();
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Quarantined
        );
        assert!(runtime.startup_recovery().unwrap().is_none());
    }

    #[test]
    fn pre_intent_phases_never_produce_recovery_action_and_verified_can_cancel() {
        let (_directory, runtime) = runtime();
        let prepared = prepared(&runtime);
        assert!(runtime.startup_recovery().unwrap().is_none());
        assert!(matches!(
            runtime.startup_action().unwrap(),
            StartupRebootstrapAction::Discard(_)
        ));
        let evidence = reserved_evidence(&prepared);
        let reserved = runtime
            .confirm_candidate_reserved(prepared, &evidence)
            .unwrap();
        assert!(runtime.startup_recovery().unwrap().is_none());
        assert!(matches!(
            runtime.startup_action().unwrap(),
            StartupRebootstrapAction::Discard(_)
        ));
        let proof = proof();
        let link = runtime.candidate_journal_link(&reserved, &proof).unwrap();
        let evidence = verified_evidence(&reserved, &proof, &link);
        let verified = runtime
            .verify_candidate(reserved, &proof, &evidence)
            .unwrap();
        assert!(runtime.startup_recovery().unwrap().is_none());
        assert!(matches!(
            runtime.startup_action().unwrap(),
            StartupRebootstrapAction::Discard(_)
        ));
        assert_eq!(
            runtime.cancel_verified(verified).unwrap(),
            RebootstrapStatus::Cancelled
        );
    }

    #[test]
    fn discard_capability_exposes_only_exact_test_recovery_evidence() {
        for (phase, expected_phase) in [
            (PublicationPhase::Prepared, DiscardPhase::Prepared),
            (
                PublicationPhase::CandidateReserved,
                DiscardPhase::CandidateReserved,
            ),
            (PublicationPhase::Verified, DiscardPhase::Verified),
        ] {
            let (_directory, runtime) = runtime();
            append_chain_through(&runtime.journal, phase);
            let StartupRebootstrapAction::Discard(discard) = runtime.startup_action().unwrap()
            else {
                panic!("pre-intent record must produce discard capability");
            };
            assert_eq!(discard.operation_id(), 1);
            assert_eq!(discard.publication_sequence(), 1);
            assert_eq!(discard.phase(), expected_phase);
            assert_eq!(discard.old_slot(), RebootstrapSlot::A);
            assert_eq!(discard.candidate_slot(), RebootstrapSlot::B);
            assert_exact_prepared_components!(discard);
            assert_eq!(
                discard.prepared_evidence_digest(),
                Some("a".repeat(64).as_str())
            );
            assert_eq!(
                discard.candidate_key_digest(),
                Some("b".repeat(64).as_str())
            );
            assert_eq!(
                discard.candidate_reserved_evidence_digest(),
                (phase != PublicationPhase::Prepared)
                    .then_some("c".repeat(64))
                    .as_deref()
            );
            assert_eq!(
                discard.verified_evidence_digest(),
                (phase == PublicationPhase::Verified)
                    .then_some("e".repeat(64))
                    .as_deref()
            );
            assert_eq!(
                discard.logical_evidence_digest(),
                (phase == PublicationPhase::Verified)
                    .then_some("d".repeat(64))
                    .as_deref()
            );
            assert_eq!(discard.publication_evidence_digest(), None);
            assert_eq!(
                discard.recovery_proof_digest(),
                (phase == PublicationPhase::Verified)
                    .then_some("f".repeat(64))
                    .as_deref()
            );
            if phase == PublicationPhase::Verified {
                assert!(discard.journal_link().is_ok());
            } else {
                assert_eq!(
                    discard.journal_link().unwrap_err(),
                    RebootstrapError::PhaseRejected
                );
            }
        }
    }

    #[test]
    fn discarded_candidate_keeps_old_slot_while_retirement_promotes_candidate() {
        let (_directory, runtime) = runtime();
        let first = prepared(&runtime);
        assert_eq!(first.candidate_slot(), RebootstrapSlot::B);
        runtime.cancel(first).unwrap();
        let second = prepared(&runtime);
        assert_eq!(second.candidate_slot(), RebootstrapSlot::B);
        let evidence = reserved_evidence(&second);
        let reserved = runtime
            .confirm_candidate_reserved(second, &evidence)
            .unwrap();
        let proof = proof();
        let link = runtime.candidate_journal_link(&reserved, &proof).unwrap();
        let evidence = verified_evidence(&reserved, &proof, &link);
        let verified = runtime
            .verify_candidate(reserved, &proof, &evidence)
            .unwrap();
        let published = runtime.publish_intent(verified).unwrap();
        let published = runtime.confirm_published(published).unwrap();
        let retired = runtime.confirm_reopened(published).unwrap();
        runtime.confirm_retired(retired).unwrap();
        let third = prepared(&runtime);
        assert_eq!(third.candidate_slot(), RebootstrapSlot::A);
    }

    #[test]
    fn operation_ids_advance_past_durable_journal_after_restart() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("journal.jsonl");
        let first = RebootstrapRuntime::for_test_recovery(
            DesktopJournalStore::for_test(path.clone()).unwrap(),
        );
        first
            .apply_verified_authority("a".repeat(64), "b".repeat(64), "c".repeat(64))
            .unwrap();
        let prepared = prepared(&first);
        first.cancel(prepared).unwrap();
        drop(first);

        let restarted =
            RebootstrapRuntime::for_test_recovery(DesktopJournalStore::for_test(path).unwrap());
        restarted
            .apply_verified_authority("a".repeat(64), "b".repeat(64), "c".repeat(64))
            .unwrap();
        let admission = restarted.begin().unwrap();
        assert_eq!(admission.operation_id, 2);
        let reservation = restarted.allocate(admission, plan()).unwrap();
        let evidence = prepared_evidence(&reservation);
        restarted.prepare(reservation, &evidence).unwrap();
    }

    #[test]
    fn recovery_confirmation_rejects_replay_after_retirement() {
        let (_directory, runtime) = runtime();
        append_chain_through(&runtime.journal, PublicationPhase::Published);
        let first = runtime.startup_recovery().unwrap().unwrap();
        assert_eq!(
            runtime.confirm_recovery_reopened(first).unwrap_err(),
            RebootstrapError::PhaseRejected
        );
        let first = runtime.startup_recovery().unwrap().unwrap();
        let first = runtime
            .resolve_recovery(first, RecoveryDisposition::ResumeCandidate)
            .unwrap();
        let retirement = runtime.confirm_recovery_reopened(first).unwrap();
        let replay = runtime.startup_recovery().unwrap().unwrap();
        let replay = runtime
            .resolve_recovery(replay, RecoveryDisposition::ResumeCandidate)
            .unwrap();
        runtime.confirm_retired(retirement).unwrap();
        assert_eq!(
            runtime.confirm_recovery_reopened(replay).unwrap_err(),
            RebootstrapError::PhaseRejected
        );
    }

    #[test]
    fn full_chain_rejects_truncation_reorder_duplicates_and_splices_without_writing() {
        let published = chain_records_through(PublicationPhase::Published);

        let mut missing_first = published.clone();
        missing_first.remove(0);
        assert_chain_quarantined_without_writing(missing_first, "missing first Prepared");

        assert_chain_quarantined_without_writing(
            vec![record_for_phase(PublicationPhase::Published)],
            "valid-looking last line without prefix",
        );

        let mut missing_intermediate = published.clone();
        missing_intermediate.remove(1);
        assert_chain_quarantined_without_writing(missing_intermediate, "missing CandidateReserved");

        let mut reordered = published.clone();
        reordered.swap(1, 2);
        assert_chain_quarantined_without_writing(reordered, "reordered phases");

        let mut duplicate = published.clone();
        duplicate.insert(2, duplicate[1].clone());
        assert_chain_quarantined_without_writing(duplicate, "duplicate phase");

        assert_chain_quarantined_without_writing(
            vec![
                record_for_phase(PublicationPhase::Prepared),
                record_for_phase(PublicationPhase::Verified),
            ],
            "phase skip",
        );

        let mut mixed_operation = chain_records_through(PublicationPhase::CandidateReserved);
        mixed_operation[1].operation_id = 2;
        mixed_operation[1].candidate_slot_origin_operation_id = 2;
        assert_chain_quarantined_without_writing(mixed_operation, "mixed operation segment");

        let mut extra_after_in_progress =
            chain_records_through(PublicationPhase::CandidateReserved);
        let mut next_prepared = record_with_preexisting_old_origin(PublicationPhase::Prepared);
        next_prepared.old_slot_record_digest = "f".repeat(64);
        extra_after_in_progress.push(next_prepared);
        assert_chain_quarantined_without_writing(
            extra_after_in_progress,
            "new operation before terminal",
        );
    }

    #[test]
    fn full_chain_rejects_sequence_topology_and_cross_operation_drift_without_writing() {
        let first_operation = chain_records_through(PublicationPhase::RetiredOld);
        let mut next = record_with_preexisting_old_origin(PublicationPhase::Prepared);
        next.old_slot = RebootstrapSlot::B;
        next.candidate_slot = RebootstrapSlot::A;
        next.old_slot_origin_operation_id = 1;
        next.old_slot_origin_publication_sequence = 1;
        next.old_slot_record_digest = "0".repeat(64);

        let mut sequence_gap = first_operation.clone();
        let mut gap = next.clone();
        gap.publication_sequence = 3;
        gap.candidate_slot_origin_publication_sequence = 3;
        sequence_gap.push(gap);
        assert_chain_quarantined_without_writing(sequence_gap, "publication sequence gap");

        let mut wrong_active_slot = first_operation.clone();
        let mut drift = next.clone();
        drift.old_slot = RebootstrapSlot::A;
        drift.candidate_slot = RebootstrapSlot::B;
        wrong_active_slot.push(drift);
        assert_chain_quarantined_without_writing(wrong_active_slot, "active slot drift");

        let mut wrong_origin = first_operation.clone();
        let mut drift = next.clone();
        drift.old_slot_origin_operation_id = 2;
        drift.old_slot_origin_publication_sequence = 2;
        drift.old_slot_created_by_operation = true;
        wrong_origin.push(drift);
        assert_chain_quarantined_without_writing(wrong_origin, "active origin drift");

        let mut wrong_workspace = first_operation.clone();
        let mut drift = next.clone();
        drift.workspace_id_digest = "9".repeat(64);
        wrong_workspace.push(drift);
        assert_chain_quarantined_without_writing(wrong_workspace, "workspace splice");

        let mut wrong_directory = first_operation.clone();
        let mut drift = next.clone();
        drift.directory_ino = 2;
        wrong_directory.push(drift);
        assert_chain_quarantined_without_writing(wrong_directory, "directory splice");

        let mut wrong_active_key = first_operation.clone();
        let mut drift = next.clone();
        drift.old_key_digest = "9".repeat(64);
        wrong_active_key.push(drift);
        assert_chain_quarantined_without_writing(wrong_active_key, "active key splice");

        let mut wrong_active_envelope = first_operation.clone();
        let mut drift = next;
        drift.old_slot_record_digest = "9".repeat(64);
        wrong_active_envelope.push(drift);
        assert_chain_quarantined_without_writing(wrong_active_envelope, "active envelope splice");
    }

    #[test]
    fn full_chain_rejects_prepared_and_phase_evidence_mutation_without_writing() {
        let mut immutable_component = chain_records_through(PublicationPhase::CandidateReserved);
        immutable_component[1].old_file_ciphertext_digest = "9".repeat(64);
        assert_chain_quarantined_without_writing(
            immutable_component,
            "same-operation Prepared component mutation",
        );

        let mut evidence_mutation = chain_records_through(PublicationPhase::Verified);
        evidence_mutation[2].candidate_reserved_evidence_digest = Some("9".repeat(64));
        assert_chain_quarantined_without_writing(evidence_mutation, "reserved evidence mutation");

        let mut evidence_removal = chain_records_through(PublicationPhase::PublishIntent);
        evidence_removal[3].recovery_proof_digest = None;
        assert_chain_quarantined_without_writing(evidence_removal, "evidence removal");

        let mut early_evidence = record_for_phase(PublicationPhase::Prepared);
        early_evidence.candidate_reserved_evidence_digest = Some("c".repeat(64));
        assert_chain_quarantined_without_writing(vec![early_evidence], "early evidence");

        let prepared = record_for_phase(PublicationPhase::Prepared);
        let mut cancelled = record_for_phase(PublicationPhase::Cancelled);
        cancelled.candidate_reserved_evidence_digest = Some("c".repeat(64));
        assert_chain_quarantined_without_writing(
            vec![prepared, cancelled],
            "Cancelled evidence differs from predecessor",
        );

        let mut persisted_quarantine = record_for_phase(PublicationPhase::Prepared);
        persisted_quarantine.phase = PublicationPhase::Quarantined;
        assert_chain_quarantined_without_writing(
            vec![persisted_quarantine],
            "persisted Quarantined",
        );
    }

    #[test]
    fn full_chain_rejects_missing_or_invalid_decomposable_prepared_components() {
        for field in [
            "workspaceIdDigest",
            "directoryDev",
            "directoryIno",
            "oldFileDev",
            "oldFileIno",
            "oldFileSize",
            "oldFileCiphertextDigest",
            "oldKeyDigest",
            "oldSlotRecordDigest",
            "candidateSlotRecordDigest",
        ] {
            let mut wire = serde_json::to_value(record_for_phase(PublicationPhase::Prepared))
                .unwrap()
                .as_object()
                .unwrap()
                .clone();
            assert!(wire.remove(field).is_some());
            let bytes = serde_json::to_vec(&wire).unwrap();
            assert!(
                parse_validated_chain(vec![bytes]).is_none(),
                "missing {field}"
            );
        }

        let valid = record_for_phase(PublicationPhase::Prepared);
        let mut cases = Vec::new();
        let mut record = valid.clone();
        record.directory_dev = 0;
        cases.push(record);
        let mut record = valid.clone();
        record.directory_ino = 0;
        cases.push(record);
        let mut record = valid.clone();
        record.old_file_dev = 0;
        cases.push(record);
        let mut record = valid.clone();
        record.old_file_ino = 0;
        cases.push(record);
        let mut record = valid.clone();
        record.old_file_size = 0;
        cases.push(record);
        let mut record = valid;
        record.old_key_digest = "A".repeat(64);
        cases.push(record);
        for (index, record) in cases.into_iter().enumerate() {
            assert_chain_quarantined_without_writing(
                vec![record],
                &format!("invalid Prepared component {index}"),
            );
        }
    }

    #[test]
    fn full_chain_record_limit_and_live_advance_tamper_are_fail_closed_without_writing() {
        let encoded = serde_json::to_vec(&record_for_phase(PublicationPhase::Prepared)).unwrap();
        assert!(
            parse_validated_chain(vec![encoded; MAX_JOURNAL_RECORDS + 1]).is_none(),
            "runtime must retain its own defensive record-count bound"
        );

        let (_directory, runtime) = runtime();
        let prepared = prepared(&runtime);
        let evidence = reserved_evidence(&prepared);
        append_record(
            &runtime.journal,
            &record_for_phase(PublicationPhase::Prepared),
        )
        .unwrap();
        let before = runtime.journal.read_all().unwrap();
        assert_eq!(
            runtime
                .confirm_candidate_reserved(prepared, &evidence)
                .unwrap_err(),
            RebootstrapError::PhaseRejected
        );
        assert_eq!(runtime.journal.read_all().unwrap(), before);
    }

    #[test]
    fn active_publication_link_is_none_for_cancellation_only_ancestry() {
        let (_directory, runtime) = runtime();
        append_chain_through(&runtime.journal, PublicationPhase::Cancelled);

        let StartupRebootstrapAction::Terminal(terminal) = runtime.startup_action().unwrap() else {
            panic!("cancelled operation must produce a terminal action");
        };
        assert_eq!(terminal.phase(), TerminalPhase::Cancelled);
        assert_eq!(terminal.active_publication_link(), None);
        assert_eq!(
            terminal.journal_link().unwrap_err(),
            RebootstrapError::PhaseRejected
        );
    }

    #[test]
    fn active_publication_link_survives_multiple_later_cancellations() {
        let (_directory, runtime) = runtime();
        append_preexisting_chain_through(&runtime.journal, PublicationPhase::Cancelled);
        for phase in phase_prefix(PublicationPhase::Cancelled) {
            append_record(&runtime.journal, &followup_record(3, 3, *phase)).unwrap();
        }

        let expected = publication_link_from_retired_record(
            preexisting_retired_records()
                .last()
                .expect("retired prefix has a terminal record"),
        )
        .unwrap();
        let StartupRebootstrapAction::Terminal(terminal) = runtime.startup_action().unwrap() else {
            panic!("latest cancelled operation must produce a terminal action");
        };
        assert_eq!(terminal.operation_id(), 3);
        assert_eq!(terminal.phase(), TerminalPhase::Cancelled);
        assert_eq!(terminal.active_publication_link(), Some(&expected));
        assert_eq!(terminal.journal_link().unwrap(), expected);
    }

    #[test]
    fn later_retirement_replaces_the_active_publication_link() {
        let (_directory, runtime) = runtime();
        append_preexisting_chain_through(&runtime.journal, PublicationPhase::Cancelled);
        for phase in phase_prefix(PublicationPhase::RetiredOld) {
            append_record(&runtime.journal, &followup_record(3, 3, *phase)).unwrap();
        }

        let old = publication_link_from_retired_record(
            preexisting_retired_records()
                .last()
                .expect("retired prefix has a terminal record"),
        )
        .unwrap();
        let replacement = publication_link_from_retired_record(&followup_record(
            3,
            3,
            PublicationPhase::RetiredOld,
        ))
        .unwrap();
        assert_ne!(old, replacement);

        let StartupRebootstrapAction::Terminal(terminal) = runtime.startup_action().unwrap() else {
            panic!("latest retired operation must produce a terminal action");
        };
        assert_eq!(terminal.operation_id(), 3);
        assert_eq!(terminal.phase(), TerminalPhase::RetiredOld);
        assert_eq!(terminal.active_publication_link(), Some(&replacement));
        assert_eq!(terminal.journal_link().unwrap(), replacement);
    }

    #[test]
    fn cancelled_candidate_evidence_cannot_invent_or_replace_the_active_link() {
        let mut records = preexisting_retired_records();
        for phase in [
            PublicationPhase::Prepared,
            PublicationPhase::CandidateReserved,
            PublicationPhase::Verified,
        ] {
            records.push(followup_record(2, 2, phase));
        }
        let mut cancelled = records.last().expect("verified predecessor exists").clone();
        cancelled.phase = PublicationPhase::Cancelled;
        records.push(cancelled);
        let expected = publication_link_from_retired_record(
            records
                .iter()
                .find(|record| record.phase == PublicationPhase::RetiredOld)
                .expect("first operation is retired"),
        )
        .unwrap();
        let cancelled = records.last().expect("cancelled terminal exists");
        let mut forged_retirement = cancelled.clone();
        forged_retirement.phase = PublicationPhase::RetiredOld;
        let forged = publication_link_from_retired_record(&forged_retirement).unwrap();
        assert_ne!(expected, forged);

        let parsed = parse_validated_chain(
            records
                .iter()
                .map(|record| serde_json::to_vec(record).unwrap())
                .collect(),
        )
        .expect("legal retired-then-cancelled chain validates");
        assert_eq!(parsed.active_publication_link.as_ref(), Some(&expected));

        let mut tampered = records;
        tampered.last_mut().unwrap().logical_evidence_digest = Some("9".repeat(64));
        assert!(
            parse_validated_chain(
                tampered
                    .into_iter()
                    .map(|record| serde_json::to_vec(&record).unwrap())
                    .collect(),
            )
            .is_none(),
            "tampering must reject the chain instead of changing its active link"
        );
    }

    #[test]
    fn legal_multi_operation_chain_allows_operation_id_gaps_and_preserves_ancestry() {
        let (_directory, runtime) = runtime();
        for operation_phase in phase_prefix(PublicationPhase::RetiredOld) {
            let mut record = record_for_phase(*operation_phase);
            record.operation_id = 7;
            record.old_slot = RebootstrapSlot::B;
            record.candidate_slot = RebootstrapSlot::A;
            record.old_slot_origin_operation_id = 7;
            record.candidate_slot_origin_operation_id = 7;
            append_record(&runtime.journal, &record).unwrap();
        }
        for operation_phase in phase_prefix(PublicationPhase::Cancelled) {
            let mut record = record_with_preexisting_old_origin(*operation_phase);
            record.operation_id = 99;
            record.old_slot_origin_operation_id = 7;
            record.candidate_slot_origin_operation_id = 99;
            record.old_slot_record_digest = "0".repeat(64);
            append_record(&runtime.journal, &record).unwrap();
        }
        assert_eq!(
            runtime.startup_status().unwrap(),
            RebootstrapStatus::Cancelled
        );
        let StartupRebootstrapAction::Terminal(terminal) = runtime.startup_action().unwrap() else {
            panic!("legal second operation must remain readable");
        };
        assert_eq!(terminal.operation_id(), 99);
        assert_eq!(terminal.publication_sequence(), 2);
        assert_eq!(terminal.old_slot_origin_operation_id(), 7);
        assert!(!terminal.old_slot_created_by_operation());
    }

    #[test]
    fn publication_digest_has_a_stable_domain_separated_vector() {
        assert_eq!(
            publication_digest(RebootstrapSlot::B, 1, &"e".repeat(64), &"f".repeat(64)),
            "d41d3ac24532bcd6cce33561c946e1ff7ae16e158c2411c82a06953eda454b3b"
        );
    }
}
