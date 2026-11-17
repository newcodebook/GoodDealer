//! ADR-0032 S2a: the Desktop Host's drain-proof claims for a device switch.
//!
//! The Host, not the Renderer, owns the Outbox and the device key, so it rebuilds in Rust what
//! client-core's `foldPersistedMutationResults` and `buildDrainProofClaims` define for TypeScript:
//! the ADR-0030 v2 mutation result chain, the v1 submitted-envelope chain, and the drain proof's
//! signature transcript and digest input. Every encoding here is pinned to the same golden
//! digests the protocol tests pin, so a divergence fails both suites rather than a Cloud seal.
//!
//! Object keys are sorted by UTF-8 bytes while the TypeScript codec sorts by UTF-16 code units; the
//! two orders agree for the ASCII keys every drain-proof and mutation object uses.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use sha2::{Digest, Sha256};

use super::{
    BusinessDatabase, BusinessDatabaseError, append_frame, canonical_wire_value,
    reconstruct_sync_mutation_v2,
};

const DRAIN_STREAM_GENESIS_DOMAIN: &[u8] = b"GOODDEALER-DRAIN-SHA256-V1";
const SUBMITTED_MUTATION_DOMAIN: &[u8] = b"GOODDEALER-SYNC-MUTATION-SUBMITTED-V1";
const MUTATION_DRAIN_RESULT_DOMAIN: &[u8] = b"GOODDEALER-MUTATION-DRAIN-RESULT-V1";
const SYNC_MUTATION_CONFLICT: &str = "sync_mutation_conflict";
const DRAIN_PROOF_AUDIENCE: &str = "gooddealer-cloud/drain-verification";
const DRAIN_PROOF_DIGEST_ALGORITHM: &str = "sha256-chain-v1";
const DRAIN_PROOF_SIGNATURE_TRANSCRIPT_VERSION: i64 = 1;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// The proof schema; v1 chains submitted envelopes, v2 chains Cloud-recorded results (ADR-0030).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DrainProofSchemaVersion {
    V1,
    V2,
}

impl DrainProofSchemaVersion {
    fn number(self) -> i64 {
        match self {
            Self::V1 => 1,
            Self::V2 => 2,
        }
    }

    fn typ(self) -> &'static str {
        match self {
            Self::V1 => "gd.drain-proof.v1",
            Self::V2 => "gd.drain-proof.v2",
        }
    }

    fn signature_domain(self) -> &'static [u8] {
        match self {
            Self::V1 => b"GOODDEALER-DRAIN-PROOF-SIGNATURE-V1",
            Self::V2 => b"GOODDEALER-DRAIN-PROOF-SIGNATURE-V2",
        }
    }

    fn digest_domain(self) -> &'static [u8] {
        match self {
            Self::V1 => b"GOODDEALER-DRAIN-PROOF-V1",
            Self::V2 => b"GOODDEALER-DRAIN-PROOF-V2",
        }
    }
}

/// One stream's claim. `pending_count` is derived, so a claim can never contradict itself. The
/// digest is kept as the protocol's 43-character base64url wire string, which is what the
/// transcript signs; digests this module computes are always canonical encodings of 32 bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DrainStreamClaim {
    pub(crate) last_assigned_sequence: u64,
    pub(crate) contiguous_received_through: u64,
    pub(crate) rolling_digest: String,
}

impl DrainStreamClaim {
    /// An empty stream: sequence 0 at the genesis digest (ADR-0032 decision 2).
    pub(crate) fn empty() -> Self {
        Self {
            last_assigned_sequence: 0,
            contiguous_received_through: 0,
            rolling_digest: URL_SAFE_NO_PAD.encode(genesis_digest()),
        }
    }

    pub(crate) fn pending_count(&self) -> u64 {
        self.last_assigned_sequence
            .saturating_sub(self.contiguous_received_through)
    }
}

pub(crate) fn genesis_digest() -> [u8; 32] {
    Sha256::digest(DRAIN_STREAM_GENESIS_DOMAIN).into()
}

/// `previous ‖ u32be(len) ‖ envelope`, hashed into the next rolling digest.
fn chain_step(previous: &[u8; 32], envelope: &[u8]) -> Result<[u8; 32], BusinessDatabaseError> {
    let mut input = Vec::with_capacity(36 + envelope.len());
    input.extend_from_slice(previous);
    append_length_prefixed(&mut input, envelope)?;
    Ok(Sha256::digest(input).into())
}

fn append_length_prefixed(output: &mut Vec<u8>, value: &[u8]) -> Result<(), BusinessDatabaseError> {
    let length = u32::try_from(value.len()).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(value);
    Ok(())
}

fn domain_separated(
    domain: &[u8],
    value: &serde_json::Value,
) -> Result<Vec<u8>, BusinessDatabaseError> {
    let mut encoded = Vec::new();
    append_frame(&mut encoded, b'd', domain);
    append_frame(&mut encoded, b'v', &canonical_wire_value(value)?);
    Ok(encoded)
}

/// The submitted mutation's drain envelope as Cloud recorded it: the frozen wire stamped with the
/// tenant `workspaceId`, without `serverRevision`. A row recorded under wire version 2 is re-derived
/// in its v2 form, which only a first-generation mutation without a re-add has (ADR-0029).
pub(crate) fn submitted_mutation_drain_envelope(
    mutation: &serde_json::Value,
    wire_version: i64,
) -> Result<Vec<u8>, BusinessDatabaseError> {
    let mut object = mutation
        .as_object()
        .cloned()
        .ok_or(BusinessDatabaseError::InvalidInput)?;
    object.remove("serverRevision");
    if object.get("schemaVersion") != Some(&serde_json::json!(3))
        || !object
            .get("workspaceId")
            .is_some_and(serde_json::Value::is_string)
        || !only_safe_integers(mutation)
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    match wire_version {
        3 => {}
        2 => {
            if object.remove("entityGeneration") != Some(serde_json::json!(1))
                || object.remove("reAddsDeletedRevision").is_some()
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            object.insert("schemaVersion".to_owned(), serde_json::json!(2));
        }
        _ => return Err(BusinessDatabaseError::InvalidInput),
    }
    domain_separated(
        SUBMITTED_MUTATION_DOMAIN,
        &serde_json::Value::Object(object),
    )
}

/// The protocol codec accepts only safe integers; the shared Rust codec accepts any `i64`, so the
/// drain path refuses the difference rather than hashing an envelope Cloud could never have recorded.
fn only_safe_integers(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .is_some_and(|integer| integer.unsigned_abs() <= MAX_SAFE_INTEGER),
        serde_json::Value::Array(values) => values.iter().all(only_safe_integers),
        serde_json::Value::Object(values) => values.values().all(only_safe_integers),
        _ => true,
    }
}

/// One device-sequence Outbox row with the frozen submitted envelope Cloud recorded for it.
pub(crate) struct PersistedMutationResult<'a> {
    pub(crate) device_mutation_sequence: u64,
    pub(crate) outbox_state: &'a str,
    pub(crate) last_error_code: Option<&'a str>,
    pub(crate) submitted_envelope: &'a [u8],
}

/// Only an ACK or a single-item `SYNC_MUTATION_CONFLICT` is a durable Cloud result; pending,
/// sending, input rejections and idempotency conflicts leave a gap (ADR-0030 decisions 4 and 5).
fn classify(row: &PersistedMutationResult<'_>) -> Option<&'static [u8]> {
    classify_parts(row.outbox_state, row.last_error_code)
}

fn classify_parts(outbox_state: &str, last_error_code: Option<&str>) -> Option<&'static [u8]> {
    match (outbox_state, last_error_code) {
        ("acknowledged", None) => Some(b"accepted"),
        ("conflicted", Some(SYNC_MUTATION_CONFLICT)) => Some(b"rejected"),
        _ => None,
    }
}

/// Folds persisted Cloud results in device sequence order into the v2 mutation stream claim. Rows
/// must be strictly increasing and within the assigned range; folding stops at the first sequence
/// without a durable result, so the received watermark is exactly the folded prefix.
pub(crate) fn fold_persisted_mutation_results(
    last_assigned_sequence: u64,
    rows: &[PersistedMutationResult<'_>],
) -> Result<DrainStreamClaim, BusinessDatabaseError> {
    if last_assigned_sequence > MAX_SAFE_INTEGER {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let mut rolling_digest = genesis_digest();
    let mut contiguous_received_through = 0;
    let mut previous = 0;
    let mut folding = true;
    for row in rows {
        if row.device_mutation_sequence <= previous
            || row.device_mutation_sequence > last_assigned_sequence
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        previous = row.device_mutation_sequence;
        if !folding {
            continue;
        }
        let outcome = classify(row);
        let Some(outcome) =
            outcome.filter(|_| row.device_mutation_sequence == contiguous_received_through + 1)
        else {
            folding = false;
            continue;
        };
        let mut step = Vec::new();
        append_length_prefixed(&mut step, MUTATION_DRAIN_RESULT_DOMAIN)?;
        append_length_prefixed(&mut step, outcome)?;
        append_length_prefixed(&mut step, &Sha256::digest(row.submitted_envelope))?;
        rolling_digest = chain_step(&rolling_digest, &step)?;
        contiguous_received_through = row.device_mutation_sequence;
    }
    Ok(DrainStreamClaim {
        last_assigned_sequence,
        contiguous_received_through,
        rolling_digest: URL_SAFE_NO_PAD.encode(rolling_digest),
    })
}

/// Where this device's mutation stream stands for a handoff drain (ADR-0032 decision 2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DrainMutationProgress {
    /// Every assigned sequence has a durable Cloud result; the claim can be signed.
    Ready(DrainStreamClaim),
    /// Rows are still pending or sending; pushing continues and the user may cancel.
    Waiting { unconfirmed: u64 },
    /// A sequence can never gain a Cloud result (a terminal local rejection, an idempotency
    /// conflict, or a missing row), so no proof can match Cloud's ledger; the drain fails closed.
    Blocked,
}

struct DrainOutboxRow {
    mutation_id: String,
    entity_id: String,
    operation_kind: String,
    base_server_revision: i64,
    workspace_schema_version: i64,
    source_device_id: Option<String>,
    active_lease_epoch: Option<i64>,
    device_mutation_sequence: Option<i64>,
    created_at: String,
    state: String,
    last_error_code: Option<String>,
    wire_schema_version: Option<i64>,
}

impl BusinessDatabase {
    /// Closes local mutation admission for one device switch (ADR-0032 S2b). Idempotent for the
    /// same switch; a barrier left by another switch must be cleared first. Writers that try to
    /// assign a device sequence or add an Outbox row afterwards fail inside SQLite.
    pub(crate) fn begin_device_handoff_barrier(
        &mut self,
        device_switch_request_id: &str,
        began_at: &str,
    ) -> Result<(), BusinessDatabaseError> {
        let workspace_id = self.workspace_id.clone();
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO device_handoff_barriers (workspace_id, device_switch_request_id, began_at)
                 VALUES (?1, ?2, ?3) ON CONFLICT (workspace_id) DO NOTHING",
                params![workspace_id, device_switch_request_id, began_at],
            )
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let held: String = transaction
            .query_row(
                "SELECT device_switch_request_id FROM device_handoff_barriers WHERE workspace_id = ?1",
                params![workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if held != device_switch_request_id {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// The switch whose barrier currently closes local mutation admission, if any.
    pub(crate) fn device_handoff_barrier(&self) -> Result<Option<String>, BusinessDatabaseError> {
        self.store
            .raw_connection()
            .query_row(
                "SELECT device_switch_request_id FROM device_handoff_barriers WHERE workspace_id = ?1",
                params![self.workspace_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Reopens local mutation admission after the named switch was cancelled, failed, or completed.
    /// Clearing another switch's barrier is refused; clearing an absent barrier is a no-op.
    pub(crate) fn clear_device_handoff_barrier(
        &mut self,
        device_switch_request_id: &str,
    ) -> Result<(), BusinessDatabaseError> {
        match self.device_handoff_barrier()? {
            None => Ok(()),
            Some(held) if held != device_switch_request_id => {
                Err(BusinessDatabaseError::MutationConflict)
            }
            Some(_) => self
                .store
                .fixture_connection()
                .execute(
                    "DELETE FROM device_handoff_barriers
                     WHERE workspace_id = ?1 AND device_switch_request_id = ?2",
                    params![self.workspace_id, device_switch_request_id],
                )
                .map(|_| ())
                .map_err(|_| BusinessDatabaseError::StorageRejected),
        }
    }

    /// Reads, in one snapshot, the last sequence this device assigned and every Outbox row, and
    /// folds the persisted Cloud results into the v2 mutation claim. Each confirmed row's drain
    /// envelope is rebuilt from its immutable claimed fields under the wire version it was sent
    /// with and stamped with this workspace id, as Cloud recorded it. Rows are never pruned, so the
    /// fold always starts at genesis; a row naming another device is storage corruption.
    pub(crate) fn read_drain_mutation_progress(
        &mut self,
        source_device_id: &str,
    ) -> Result<DrainMutationProgress, BusinessDatabaseError> {
        let workspace_id = self.workspace_id.clone();
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let next: i64 = transaction
            .query_row(
                "SELECT next_device_mutation_sequence FROM active_workspace_metadata
                 WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let last_assigned =
            u64::try_from(next - 1).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = load_drain_outbox_rows(&transaction, &workspace_id)?;
        let mut sequences = Vec::with_capacity(rows.len());
        let mut envelopes = Vec::with_capacity(rows.len());
        let mut blocked = false;
        for row in &rows {
            let (Some(row_device_id), Some(active_lease_epoch), Some(sequence)) = (
                row.source_device_id.as_deref(),
                row.active_lease_epoch,
                row.device_mutation_sequence,
            ) else {
                return Err(BusinessDatabaseError::StorageRejected);
            };
            if row_device_id != source_device_id {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            sequences
                .push(u64::try_from(sequence).map_err(|_| BusinessDatabaseError::StorageRejected)?);
            let has_result = classify_parts(&row.state, row.last_error_code.as_deref()).is_some();
            blocked |= !has_result && !matches!(row.state.as_str(), "pending" | "sending");
            let envelope = if has_result {
                let mut wire = reconstruct_sync_mutation_v2(
                    &transaction,
                    &workspace_id,
                    &row.mutation_id,
                    &row.entity_id,
                    &row.operation_kind,
                    row.base_server_revision,
                    row.workspace_schema_version,
                    row_device_id,
                    active_lease_epoch,
                    sequence,
                    &row.created_at,
                )?;
                wire.as_object_mut()
                    .ok_or(BusinessDatabaseError::StorageRejected)?
                    .insert("workspaceId".to_owned(), serde_json::json!(workspace_id));
                let version = row
                    .wire_schema_version
                    .ok_or(BusinessDatabaseError::StorageRejected)?;
                submitted_mutation_drain_envelope(&wire, version)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?
            } else {
                Vec::new()
            };
            envelopes.push(envelope);
        }
        drop(transaction);
        // Sequences are assigned densely from 1 when a row is created; anything else means a row
        // Cloud may hold is missing here, and no local fold could match Cloud's chain.
        if sequences.iter().copied().ne(1..=last_assigned) {
            return Ok(DrainMutationProgress::Blocked);
        }
        let persisted = rows
            .iter()
            .zip(&sequences)
            .zip(&envelopes)
            .map(|((row, sequence), envelope)| PersistedMutationResult {
                device_mutation_sequence: *sequence,
                outbox_state: &row.state,
                last_error_code: row.last_error_code.as_deref(),
                submitted_envelope: envelope,
            })
            .collect::<Vec<_>>();
        let claim = fold_persisted_mutation_results(last_assigned, &persisted)?;
        Ok(if blocked {
            DrainMutationProgress::Blocked
        } else if claim.pending_count() == 0 {
            DrainMutationProgress::Ready(claim)
        } else {
            DrainMutationProgress::Waiting {
                unconfirmed: claim.pending_count(),
            }
        })
    }
}

/// A handoff drain proof before its signature. Host-owned fields (proof id, key binding, trusted
/// time) are supplied by the caller; `signatureTranscriptVersion` is fixed at 1.
pub(crate) struct HandoffDrainProofClaims {
    pub(crate) schema_version: DrainProofSchemaVersion,
    pub(crate) proof_id: String,
    pub(crate) workspace_id: String,
    pub(crate) source_device_id: String,
    pub(crate) active_lease_epoch: u64,
    pub(crate) device_switch_request_id: String,
    /// In the fixed order `mutation`, `execution_fact`, `device_audit`.
    pub(crate) streams: [DrainStreamClaim; 3],
    pub(crate) issued_at: String,
    pub(crate) expires_at: String,
    pub(crate) signing_key_id: String,
    pub(crate) signing_key_version: u64,
}

const STREAM_NAMES: [&str; 3] = ["mutation", "execution_fact", "device_audit"];

impl HandoffDrainProofClaims {
    /// Refuses claims whose streams Cloud could never seal: a stream still pending, an inconsistent
    /// claim, an unsafe integer, a malformed digest, or an empty stream away from the genesis digest.
    /// Identifier shapes and the trusted-time window are checked where those values are made (S2d).
    fn validate(&self) -> Result<(), BusinessDatabaseError> {
        let genesis = URL_SAFE_NO_PAD.encode(genesis_digest());
        let safe = |value: u64| (1..=MAX_SAFE_INTEGER).contains(&value);
        let valid_streams = self.streams.iter().all(|claim| {
            claim.last_assigned_sequence <= MAX_SAFE_INTEGER
                && claim.contiguous_received_through == claim.last_assigned_sequence
                && claim.rolling_digest.len() == 43
                && claim
                    .rolling_digest
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
                && (claim.last_assigned_sequence != 0 || claim.rolling_digest == genesis)
        });
        if !valid_streams || !safe(self.active_lease_epoch) || !safe(self.signing_key_version) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        Ok(())
    }

    /// The proof as wire JSON, with `deviceSignature` when it is known.
    pub(crate) fn to_wire(
        &self,
        device_signature: Option<&str>,
    ) -> Result<serde_json::Value, BusinessDatabaseError> {
        self.validate()?;
        let streams = self
            .streams
            .iter()
            .zip(STREAM_NAMES)
            .map(|(claim, stream)| {
                serde_json::json!({
                    "stream": stream,
                    "lastAssignedSequence": claim.last_assigned_sequence,
                    "contiguousReceivedThrough": claim.contiguous_received_through,
                    "pendingCount": claim.pending_count(),
                    "rollingDigest": claim.rolling_digest,
                })
            })
            .collect::<Vec<_>>();
        let mut proof = serde_json::json!({
            "schemaVersion": self.schema_version.number(),
            "typ": self.schema_version.typ(),
            "canonicalCodecVersion": self.schema_version.number(),
            "aud": DRAIN_PROOF_AUDIENCE,
            "proofId": self.proof_id,
            "purpose": "handoff",
            "workspaceId": self.workspace_id,
            "sourceDeviceId": self.source_device_id,
            "activeLeaseEpoch": self.active_lease_epoch,
            "deviceSwitchRequestId": self.device_switch_request_id,
            "streams": streams,
            "digestAlgorithm": DRAIN_PROOF_DIGEST_ALGORITHM,
            "issuedAt": self.issued_at,
            "expiresAt": self.expires_at,
            "signingKeyId": self.signing_key_id,
            "signingKeyVersion": self.signing_key_version,
            "signatureTranscriptVersion": DRAIN_PROOF_SIGNATURE_TRANSCRIPT_VERSION,
        });
        if let Some(signature) = device_signature {
            proof["deviceSignature"] = serde_json::json!(signature);
        }
        Ok(proof)
    }

    /// The bytes the device key signs: the proof without `deviceSignature` under its version's domain.
    pub(crate) fn signature_transcript(&self) -> Result<Vec<u8>, BusinessDatabaseError> {
        domain_separated(self.schema_version.signature_domain(), &self.to_wire(None)?)
    }

    /// The digest input Cloud binds the proof id to: domain ‖ u32be(len) ‖ (transcript ‖ u32be(len) ‖ signature).
    pub(crate) fn digest_input(
        &self,
        device_signature: &str,
    ) -> Result<Vec<u8>, BusinessDatabaseError> {
        let mut signed = self.signature_transcript()?;
        append_length_prefixed(&mut signed, device_signature.as_bytes())?;
        let mut input = self.schema_version.digest_domain().to_vec();
        append_length_prefixed(&mut input, &signed)?;
        Ok(input)
    }
}

/// Every Outbox row of this workspace in device-sequence order, read inside the caller's snapshot.
fn load_drain_outbox_rows(
    transaction: &rusqlite::Transaction<'_>,
    workspace_id: &str,
) -> Result<Vec<DrainOutboxRow>, BusinessDatabaseError> {
    let mut statement = transaction
        .prepare(
            "SELECT mutation_id, entity_id, operation_kind, base_server_revision,
                        workspace_schema_version, source_device_id, active_lease_epoch,
                        device_mutation_sequence, created_at, state, last_error_code,
                        wire_schema_version
                 FROM sync_outbox WHERE workspace_id = ?1
                 ORDER BY device_mutation_sequence, created_at, mutation_id",
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    statement
        .query_map(params![workspace_id], |row| {
            Ok(DrainOutboxRow {
                mutation_id: row.get(0)?,
                entity_id: row.get(1)?,
                operation_kind: row.get(2)?,
                base_server_revision: row.get(3)?,
                workspace_schema_version: row.get(4)?,
                source_device_id: row.get(5)?,
                active_lease_epoch: row.get(6)?,
                device_mutation_sequence: row.get(7)?,
                created_at: row.get(8)?,
                state: row.get(9)?,
                last_error_code: row.get(10)?,
                wire_schema_version: row.get(11)?,
            })
        })
        .map_err(|_| BusinessDatabaseError::StorageRejected)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BusinessDatabaseError::StorageRejected)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTORS: &str = "../../packages/protocol/test-vectors";

    fn vector(path: &str) -> serde_json::Value {
        let full = format!("{}/{VECTORS}/{path}", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(full).expect("read vector"))
            .expect("parse vector")
    }

    fn digest(bytes: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
    }

    fn claims_from_wire(wire: &serde_json::Value) -> HandoffDrainProofClaims {
        let text = |key: &str| wire[key].as_str().expect(key).to_owned();
        let number = |value: &serde_json::Value| value.as_u64().expect("number");
        let streams = wire["streams"].as_array().expect("streams");
        let claim = |index: usize| DrainStreamClaim {
            last_assigned_sequence: number(&streams[index]["lastAssignedSequence"]),
            contiguous_received_through: number(&streams[index]["contiguousReceivedThrough"]),
            rolling_digest: streams[index]["rollingDigest"]
                .as_str()
                .expect("digest")
                .to_owned(),
        };
        HandoffDrainProofClaims {
            schema_version: if wire["schemaVersion"] == 2 {
                DrainProofSchemaVersion::V2
            } else {
                DrainProofSchemaVersion::V1
            },
            proof_id: text("proofId"),
            workspace_id: text("workspaceId"),
            source_device_id: text("sourceDeviceId"),
            active_lease_epoch: number(&wire["activeLeaseEpoch"]),
            device_switch_request_id: text("deviceSwitchRequestId"),
            streams: [claim(0), claim(1), claim(2)],
            issued_at: text("issuedAt"),
            expires_at: text("expiresAt"),
            signing_key_id: text("signingKeyId"),
            signing_key_version: number(&wire["signingKeyVersion"]),
        }
    }

    #[test]
    fn genesis_matches_the_protocol_and_cloud_constant() {
        assert_eq!(
            URL_SAFE_NO_PAD.encode(genesis_digest()),
            "58It6o62GZGmXgy6-ER1rezwYX-LCZVJzlZuZOGcWUs"
        );
    }

    #[test]
    fn submitted_envelopes_match_the_protocol_golden_digests_for_wire_v3_and_v2() {
        let mutation = vector("execution-events/valid/mutation-submitted.json");
        let v3 = submitted_mutation_drain_envelope(&mutation, 3).expect("v3 envelope");
        assert_eq!(digest(&v3), "GraedUUM-E1daDqh76REQ2g2SV6ZMKYaehT5T2yfQ2w");
        let v2 = submitted_mutation_drain_envelope(&mutation, 2).expect("v2 envelope");
        assert_eq!(digest(&v2), "bs2VrWtJ3gpBKktmZyz8Wpx7OoU_EQUZcU4Khrhy8ac");
        // A server-enriched copy names the same envelope.
        let mut enriched = mutation.clone();
        enriched["serverRevision"] = serde_json::json!(5);
        assert_eq!(
            submitted_mutation_drain_envelope(&enriched, 3).expect("enriched"),
            v3
        );
    }

    #[test]
    fn submitted_envelopes_refuse_forms_cloud_never_recorded() {
        let mutation = vector("execution-events/valid/mutation-submitted.json");
        let mut later = mutation.clone();
        later["entityGeneration"] = serde_json::json!(2);
        assert!(submitted_mutation_drain_envelope(&later, 2).is_err());
        let mut re_add = mutation.clone();
        re_add["reAddsDeletedRevision"] = serde_json::json!(3);
        assert!(submitted_mutation_drain_envelope(&re_add, 2).is_err());
        let mut tenant_neutral = mutation.clone();
        tenant_neutral
            .as_object_mut()
            .expect("object")
            .remove("workspaceId");
        assert!(submitted_mutation_drain_envelope(&tenant_neutral, 3).is_err());
        assert!(submitted_mutation_drain_envelope(&mutation, 4).is_err());
        let mut unsafe_integer = mutation.clone();
        unsafe_integer["baseServerRevision"] = serde_json::json!(MAX_SAFE_INTEGER + 1);
        assert!(submitted_mutation_drain_envelope(&unsafe_integer, 3).is_err());
        assert!(submitted_mutation_drain_envelope(&serde_json::json!([]), 3).is_err());
    }

    #[test]
    fn folds_the_protocol_v2_result_chain_vector() {
        let chain = vector("drain/chain/mutation-result-v2.json");
        let steps = chain["steps"].as_array().expect("steps");
        let envelopes = steps
            .iter()
            .map(|step| {
                URL_SAFE_NO_PAD
                    .decode(
                        step["submittedEnvelopeBase64url"]
                            .as_str()
                            .expect("envelope"),
                    )
                    .expect("bytes")
            })
            .collect::<Vec<_>>();
        let rows = steps
            .iter()
            .zip(&envelopes)
            .map(|(step, envelope)| {
                let rejected = step["outcome"] == "rejected";
                PersistedMutationResult {
                    device_mutation_sequence: step["sequence"].as_u64().expect("sequence"),
                    outbox_state: if rejected {
                        "conflicted"
                    } else {
                        "acknowledged"
                    },
                    last_error_code: rejected.then_some(SYNC_MUTATION_CONFLICT),
                    submitted_envelope: envelope,
                }
            })
            .collect::<Vec<_>>();
        let claim = fold_persisted_mutation_results(3, &rows).expect("fold");
        assert_eq!(claim.contiguous_received_through, 3);
        assert_eq!(claim.pending_count(), 0);
        assert_eq!(
            claim.rolling_digest,
            chain["expectedDigest"].as_str().expect("expected")
        );
    }

    #[test]
    fn stops_folding_at_the_first_sequence_without_a_durable_cloud_result() {
        let envelope = b"submitted".as_slice();
        let row = |sequence, state, code| PersistedMutationResult {
            device_mutation_sequence: sequence,
            outbox_state: state,
            last_error_code: code,
            submitted_envelope: envelope,
        };
        for gap in [
            row(2, "pending", None),
            row(2, "sending", None),
            row(2, "rejected", Some("mutation_input_invalid")),
            row(2, "conflicted", Some("mutation_idempotency_conflict")),
            row(2, "acknowledged", Some("sync_mutation_conflict")),
        ] {
            let claim = fold_persisted_mutation_results(
                3,
                &[
                    row(1, "acknowledged", None),
                    gap,
                    row(3, "acknowledged", None),
                ],
            )
            .expect("fold");
            assert_eq!(
                (claim.contiguous_received_through, claim.pending_count()),
                (1, 2)
            );
        }
        // A missing row is a gap too; later results are never folded past it.
        let claim = fold_persisted_mutation_results(
            3,
            &[row(1, "acknowledged", None), row(3, "acknowledged", None)],
        )
        .expect("fold");
        assert_eq!(claim.contiguous_received_through, 1);
        assert_eq!(
            fold_persisted_mutation_results(0, &[]).expect("empty"),
            DrainStreamClaim::empty()
        );
    }

    #[test]
    fn refuses_rows_out_of_order_or_beyond_the_assigned_range() {
        let row = |sequence| PersistedMutationResult {
            device_mutation_sequence: sequence,
            outbox_state: "acknowledged",
            last_error_code: None,
            submitted_envelope: b"submitted",
        };
        assert!(fold_persisted_mutation_results(3, &[row(2), row(1)]).is_err());
        assert!(fold_persisted_mutation_results(3, &[row(1), row(1)]).is_err());
        assert!(fold_persisted_mutation_results(1, &[row(1), row(2)]).is_err());
        assert!(fold_persisted_mutation_results(3, &[row(0)]).is_err());
        assert!(fold_persisted_mutation_results(MAX_SAFE_INTEGER + 1, &[]).is_err());
    }

    #[test]
    fn reproduces_the_protocol_wire_transcript_and_digest_input_for_v1_and_v2_handoff_proofs() {
        for (path, transcript, digest_input) in [
            (
                "drain/valid/proof-handoff-three-streams.json",
                "qiD196D0e2kn_0eKxd7UiFQoa68laqzx8cKUQIzDX_8",
                "NsJxtr1QEVKfM_-1xKXqCVi9e5zeva_Z18UxqRglrPs",
            ),
            (
                "drain/valid/proof-handoff-v2-three-streams.json",
                "XYqcVqbAtXfallw52YDJOmG_VSdcSesHZ13dAF1RY98",
                "wkohcTfRlEUJJcXOFftXcxeVQdDRQlyYGk0d3wmDsZk",
            ),
        ] {
            let wire = vector(path);
            let claims = claims_from_wire(&wire);
            let signature = wire["deviceSignature"].as_str().expect("signature");
            assert_eq!(
                claims.to_wire(Some(signature)).expect("wire"),
                wire,
                "{path}"
            );
            assert_eq!(
                digest(&claims.signature_transcript().expect("transcript")),
                transcript,
                "{path}"
            );
            assert_eq!(
                digest(&claims.digest_input(signature).expect("digest input")),
                digest_input,
                "{path}"
            );
        }
    }

    #[test]
    fn refuses_to_build_a_proof_cloud_would_reject() {
        let wire = vector("drain/valid/proof-handoff-v2-three-streams.json");
        let pending = HandoffDrainProofClaims {
            streams: [
                DrainStreamClaim {
                    last_assigned_sequence: 3,
                    contiguous_received_through: 2,
                    rolling_digest: "M".repeat(43),
                },
                DrainStreamClaim::empty(),
                DrainStreamClaim::empty(),
            ],
            ..claims_from_wire(&wire)
        };
        assert!(pending.signature_transcript().is_err());
        let empty_off_genesis = HandoffDrainProofClaims {
            streams: [
                DrainStreamClaim {
                    rolling_digest: "M".repeat(43),
                    ..DrainStreamClaim::empty()
                },
                DrainStreamClaim::empty(),
                DrainStreamClaim::empty(),
            ],
            ..claims_from_wire(&wire)
        };
        assert!(empty_off_genesis.to_wire(None).is_err());
        let malformed = HandoffDrainProofClaims {
            streams: [
                DrainStreamClaim {
                    last_assigned_sequence: 1,
                    contiguous_received_through: 1,
                    rolling_digest: format!("{}+", "M".repeat(42)),
                },
                DrainStreamClaim::empty(),
                DrainStreamClaim::empty(),
            ],
            ..claims_from_wire(&wire)
        };
        assert!(malformed.to_wire(None).is_err());
        let zero_epoch = HandoffDrainProofClaims {
            active_lease_epoch: 0,
            ..claims_from_wire(&wire)
        };
        assert!(zero_epoch.to_wire(None).is_err());
        let all_empty = HandoffDrainProofClaims {
            streams: [
                DrainStreamClaim::empty(),
                DrainStreamClaim::empty(),
                DrainStreamClaim::empty(),
            ],
            ..claims_from_wire(&wire)
        };
        assert!(all_empty.signature_transcript().is_ok());
    }
}
