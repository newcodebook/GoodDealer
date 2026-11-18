//! ADR-0032 S2d: the source device's side of a normal device switch, owned by the Desktop Host.
//!
//! The Host closes local writes behind a durable barrier, learns from Cloud's receipts which wire
//! version each legacy row was recorded under, folds its own Outbox into the handoff claims, and
//! builds the exact drain submission. Every Cloud response is decoded from untrusted bytes and
//! checked against what this device asked for; anything else is refused. The device key signs
//! outside this crate (`secure-host-core`), and only the transcript this module produced.

use serde_json::{Map, Value};

use crate::active_workspace::business::{
    CloudMutationReceipt, DrainMutationProgress, HandoffDrainProofClaims,
};
use crate::desktop_native_cloud::{
    strict_json, validate_digest43, validate_identifier, validate_timestamp,
};
use crate::desktop_sync_runtime::random_uuid_v4;
use crate::{DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission};

const DEVICE_MANAGEMENT_SCHEMA_VERSION: u64 = 1;
const RECEIPT_READ_SCHEMA_VERSION: u64 = 1;
const MAX_RECEIPT_READ_IDS: usize = 256;
const MAX_IDENTIFIER_BYTES: usize = 160;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
/// An Ed25519 signature is 64 bytes, 86 base64url characters without padding.
const DEVICE_SIGNATURE_LENGTH: usize = 86;

/// Where this device's drain stands (ADR-0032 decision 2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopDrainProgress {
    /// Rows are still being delivered; pushing continues and the user may cancel.
    Waiting { unconfirmed: u64 },
    /// Legacy version-2 rows need Cloud's receipt before the proof can be built.
    ReceiptsRequired,
    /// A row can never match Cloud's ledger; the switch must be cancelled.
    Blocked,
    /// The mutation stream is fully confirmed; the proof can be prepared.
    Ready,
}

/// One receipt read: the exact request body and the ids it asked about.
#[derive(Debug)]
pub struct DesktopDrainReceiptQuery {
    body: Vec<u8>,
    mutation_ids: Vec<String>,
}

impl DesktopDrainReceiptQuery {
    #[must_use]
    pub fn request_body(&self) -> &[u8] {
        &self.body
    }
}

/// An unsigned handoff proof built from Host-owned claims. Its transcript is the only input the
/// device key's drain signing accepts for it.
pub struct DesktopDrainProofDraft {
    claims: HandoffDrainProofClaims,
    transcript: Vec<u8>,
}

impl DesktopDrainProofDraft {
    #[must_use]
    pub fn signature_transcript(&self) -> &[u8] {
        &self.transcript
    }
}

impl std::fmt::Debug for DesktopDrainProofDraft {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DesktopDrainProofDraft")
            .field("proof_id", &self.claims.proof_id)
            .finish_non_exhaustive()
    }
}

/// One normal switch request from this device to `target_device_id` (ADR-0032 decision 1). The
/// idempotency key is the Host's own, so a retry of this exchange returns Cloud's first outcome.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopDeviceSwitchRequestExchange {
    body: Vec<u8>,
    target_device_id: String,
}

impl DesktopDeviceSwitchRequestExchange {
    #[must_use]
    pub fn request_body(&self) -> &[u8] {
        &self.body
    }

    #[must_use]
    pub fn target_device_id(&self) -> &str {
        &self.target_device_id
    }
}

/// Cloud's answer to a normal switch request. The switch id comes only from Cloud's view of a
/// switch from this device to the requested target.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DesktopDeviceSwitchStart {
    Accepted {
        device_switch_request_id: String,
        status: DesktopDeviceSwitchStatus,
    },
    Rejected(DesktopDeviceSwitchRejection),
}

/// The switch's status as Cloud reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopDeviceSwitchStatus {
    Requested,
    Draining,
    WaitingExpiry,
    Bootstrapping,
    Completed,
    Cancelled,
    Failed,
}

/// The closed rejection codes a Desktop can act on (`deviceSwitchRejectionCodeSchema`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopDeviceSwitchRejection {
    SwitchInProgress,
    SwitchNotFound,
    SwitchNotCancellable,
    IdempotencyConflict,
    TargetIsSource,
    TargetNotBound,
    TargetRemoved,
    AccountRecoveryPending,
    ForcedSwitchUnavailable,
    DrainProofInvalid,
    DrainProofExpired,
    DrainStreamsIncomplete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopDeviceSwitchOutcome {
    Accepted(DesktopDeviceSwitchStatus),
    Rejected(DesktopDeviceSwitchRejection),
}

impl DesktopLocalHost {
    /// The `/v1/device-switch/requests` body for a normal switch to `target_device_id`.
    ///
    /// # Errors
    ///
    /// Returns `CloudProtocolRejected` for a malformed target, or a storage error if no idempotency key
    /// could be drawn.
    pub fn prepare_native_device_switch_request(
        target_device_id: &str,
    ) -> Result<DesktopDeviceSwitchRequestExchange, DesktopLocalHostError> {
        validate_identifier(target_device_id, MAX_IDENTIFIER_BYTES)?;
        let idempotency_key =
            random_uuid_v4().map_err(|_| DesktopLocalHostError::StorageRejected)?;
        let body = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": DEVICE_MANAGEMENT_SCHEMA_VERSION,
            "mode": "normal",
            "toDeviceId": target_device_id,
            "idempotencyKey": idempotency_key,
        }))
        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        Ok(DesktopDeviceSwitchRequestExchange {
            body,
            target_device_id: target_device_id.to_owned(),
        })
    }

    /// Decodes Cloud's answer to `exchange`. An accepted view must be a normal switch from this
    /// device to the requested target; only then is its id used.
    ///
    /// # Errors
    ///
    /// Returns `CloudProtocolRejected` for a malformed response or one about another switch.
    pub fn complete_native_device_switch_request(
        &self,
        admission: &DesktopNativeCloudAdmission,
        exchange: &DesktopDeviceSwitchRequestExchange,
        response_wire: &[u8],
    ) -> Result<DesktopDeviceSwitchStart, DesktopLocalHostError> {
        decode_switch_start(
            response_wire,
            &exchange.target_device_id,
            admission.inner.device_id(),
        )
    }

    /// The `/status` or `/cancel` body naming `device_switch_request_id`.
    ///
    /// # Errors
    ///
    /// Returns `CloudProtocolRejected` for a malformed id.
    pub fn native_device_switch_lookup(
        device_switch_request_id: &str,
    ) -> Result<Vec<u8>, DesktopLocalHostError> {
        validate_identifier(device_switch_request_id, MAX_IDENTIFIER_BYTES)?;
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": DEVICE_MANAGEMENT_SCHEMA_VERSION,
            "requestId": device_switch_request_id,
        }))
        .map_err(|_| DesktopLocalHostError::StorageRejected)
    }

    /// The switch whose barrier holds this device's writes closed under this run's Lease epoch.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error.
    pub fn native_device_switch_in_progress(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<Option<String>, DesktopLocalHostError> {
        self.with_sync_business_write(&admission.inner, |sync, business, admission, _| {
            sync.drain_current_barrier(business.database_for_backup_mut(), admission)
        })
    }

    /// Closes local mutation admission for `device_switch_request_id` under this run's Lease
    /// epoch. Idempotent for the same switch.
    ///
    /// # Errors
    ///
    /// Returns an authority, conflict (another switch holds the barrier) or storage error.
    pub fn begin_native_device_switch_drain(
        &self,
        admission: &DesktopNativeCloudAdmission,
        device_switch_request_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        validate_identifier(device_switch_request_id, MAX_IDENTIFIER_BYTES)?;
        self.with_sync_business_write(&admission.inner, |sync, business, admission, guard| {
            sync.drain_begin_barrier(
                business.database_for_backup_mut(),
                admission,
                device_switch_request_id,
                guard,
            )
        })
    }

    /// This device's drain progress.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error.
    pub fn native_device_switch_drain_progress(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<DesktopDrainProgress, DesktopLocalHostError> {
        self.with_sync_business_write(&admission.inner, |sync, business, admission, _| {
            sync.drain_progress(business.database_for_backup_mut(), admission)
        })
        .map(|progress| match progress {
            DrainMutationProgress::Waiting { unconfirmed } => {
                DesktopDrainProgress::Waiting { unconfirmed }
            }
            DrainMutationProgress::ReceiptsRequired { .. } => {
                DesktopDrainProgress::ReceiptsRequired
            }
            DrainMutationProgress::Blocked => DesktopDrainProgress::Blocked,
            DrainMutationProgress::Ready(_) => DesktopDrainProgress::Ready,
        })
    }

    /// The next receipt read for at most 256 legacy rows, or `None` when none needs a receipt.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error.
    pub fn native_drain_receipt_query(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<Option<DesktopDrainReceiptQuery>, DesktopLocalHostError> {
        let mut mutation_ids =
            self.with_sync_business_write(&admission.inner, |sync, business, admission, _| {
                sync.drain_receipt_mutation_ids(business.database_for_backup_mut(), admission)
            })?;
        if mutation_ids.is_empty() {
            return Ok(None);
        }
        mutation_ids.truncate(MAX_RECEIPT_READ_IDS);
        let body = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": RECEIPT_READ_SCHEMA_VERSION,
            "mutationIds": mutation_ids,
        }))
        .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        Ok(Some(DesktopDrainReceiptQuery { body, mutation_ids }))
    }

    /// Decodes Cloud's receipt response for `query` and records every receipt, all or nothing. A
    /// receipt must name an id this query asked about; ids Cloud omits stay unrecorded, so the
    /// drain keeps reporting `ReceiptsRequired` and the coordinator must fail closed.
    ///
    /// # Errors
    ///
    /// Returns `CloudProtocolRejected` for any malformed or unexpected response, or an authority,
    /// mismatch or storage error from recording.
    pub fn complete_native_drain_receipts(
        &self,
        admission: &DesktopNativeCloudAdmission,
        query: &DesktopDrainReceiptQuery,
        response_wire: &[u8],
    ) -> Result<(), DesktopLocalHostError> {
        let receipts = decode_receipt_response(response_wire, &query.mutation_ids)?;
        if receipts.is_empty() {
            return Ok(());
        }
        self.with_sync_business_write(&admission.inner, |sync, business, admission, guard| {
            sync.drain_record_receipts(
                business.database_for_backup_mut(),
                admission,
                &receipts,
                guard,
            )
        })
    }

    /// Builds the unsigned handoff proof for `device_switch_request_id`, signed later by the
    /// device key named `signing_key_id`. Refused unless this switch's barrier holds writes
    /// closed under this run's Lease epoch and the mutation stream is fully confirmed.
    ///
    /// # Errors
    ///
    /// Returns an authority, blocked, or storage error.
    pub fn prepare_native_drain_proof(
        &self,
        admission: &DesktopNativeCloudAdmission,
        device_switch_request_id: &str,
        signing_key_id: &str,
    ) -> Result<DesktopDrainProofDraft, DesktopLocalHostError> {
        validate_identifier(device_switch_request_id, MAX_IDENTIFIER_BYTES)?;
        validate_identifier(signing_key_id, MAX_IDENTIFIER_BYTES)?;
        let claims =
            self.with_sync_business_write(&admission.inner, |sync, business, admission, _| {
                sync.drain_prepare_proof(
                    business.database_for_backup_mut(),
                    admission,
                    device_switch_request_id,
                    signing_key_id,
                )
            })?;
        let transcript = claims
            .signature_transcript()
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        Ok(DesktopDrainProofDraft { claims, transcript })
    }

    /// The exact `/v1/device-switch/requests/drain` body for a signed draft.
    ///
    /// # Errors
    ///
    /// Returns `CloudProtocolRejected` if the signature is not an Ed25519 base64url signature.
    pub fn native_drain_submission(
        &self,
        draft: &DesktopDrainProofDraft,
        device_signature: &str,
    ) -> Result<Vec<u8>, DesktopLocalHostError> {
        if device_signature.len() != DEVICE_SIGNATURE_LENGTH
            || !device_signature
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let proof = draft
            .claims
            .to_wire(Some(device_signature))
            .map_err(|_| DesktopLocalHostError::StorageRejected)?;
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": DEVICE_MANAGEMENT_SCHEMA_VERSION,
            "requestId": draft.claims.device_switch_request_id,
            "proof": proof,
        }))
        .map_err(|_| DesktopLocalHostError::StorageRejected)
    }

    /// Decodes a device-switch response for this device's own switch `device_switch_request_id`.
    ///
    /// # Errors
    ///
    /// Returns `CloudProtocolRejected` for a malformed response, or one about another switch or
    /// another source device.
    pub fn complete_native_device_switch_response(
        &self,
        admission: &DesktopNativeCloudAdmission,
        device_switch_request_id: &str,
        response_wire: &[u8],
    ) -> Result<DesktopDeviceSwitchOutcome, DesktopLocalHostError> {
        decode_switch_response(
            response_wire,
            device_switch_request_id,
            admission.inner.device_id(),
        )
    }

    /// Reopens local writes after `device_switch_request_id` was cancelled or failed, or after its
    /// handoff completed.
    ///
    /// # Errors
    ///
    /// Returns an authority, conflict (another switch holds the barrier) or storage error.
    pub fn clear_native_device_switch_barrier(
        &self,
        admission: &DesktopNativeCloudAdmission,
        device_switch_request_id: &str,
    ) -> Result<(), DesktopLocalHostError> {
        validate_identifier(device_switch_request_id, MAX_IDENTIFIER_BYTES)?;
        self.with_sync_business_write(&admission.inner, |sync, business, admission, _| {
            sync.drain_clear_barrier(
                business.database_for_backup_mut(),
                admission,
                device_switch_request_id,
            )
        })
    }

    /// Clears a barrier left by a switch whose Lease epoch this device no longer holds. Returns
    /// whether one was cleared.
    ///
    /// # Errors
    ///
    /// Returns an authority or storage error.
    pub fn clear_left_over_device_switch_barrier(
        &self,
        admission: &DesktopNativeCloudAdmission,
    ) -> Result<bool, DesktopLocalHostError> {
        self.with_sync_business_write(&admission.inner, |sync, business, admission, _| {
            sync.drain_clear_left_over_barrier(business.database_for_backup_mut(), admission)
        })
    }
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a Map<String, Value>, DesktopLocalHostError> {
    let object = value
        .as_object()
        .ok_or(DesktopLocalHostError::CloudProtocolRejected)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    Ok(object)
}

fn safe_positive(value: &Value) -> Result<u64, DesktopLocalHostError> {
    value
        .as_u64()
        .filter(|number| (1..=MAX_SAFE_INTEGER).contains(number))
        .ok_or(DesktopLocalHostError::CloudProtocolRejected)
}

fn text(value: &Value) -> Result<&str, DesktopLocalHostError> {
    value
        .as_str()
        .ok_or(DesktopLocalHostError::CloudProtocolRejected)
}

fn identifier(value: &Value) -> Result<&str, DesktopLocalHostError> {
    let value = text(value)?;
    validate_identifier(value, MAX_IDENTIFIER_BYTES)?;
    Ok(value)
}

fn timestamp(value: &Value) -> Result<&str, DesktopLocalHostError> {
    let value = text(value)?;
    validate_timestamp(value)?;
    Ok(value)
}

fn nullable<'a, T>(
    value: &'a Value,
    decode: impl FnOnce(&'a Value) -> Result<T, DesktopLocalHostError>,
) -> Result<Option<T>, DesktopLocalHostError> {
    if value.is_null() {
        Ok(None)
    } else {
        decode(value).map(Some)
    }
}

/// `workspaceMutationReceiptReadResponseSchema`, plus: every receipt names an id this device asked
/// about, and no id appears twice.
fn decode_receipt_response(
    wire: &[u8],
    asked: &[String],
) -> Result<Vec<CloudMutationReceipt>, DesktopLocalHostError> {
    let value: Value = strict_json(wire)?;
    let response = exact_object(&value, &["schemaVersion", "receipts"])?;
    if response["schemaVersion"].as_u64() != Some(RECEIPT_READ_SCHEMA_VERSION) {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    let entries = response["receipts"]
        .as_array()
        .filter(|entries| entries.len() <= MAX_RECEIPT_READ_IDS)
        .ok_or(DesktopLocalHostError::CloudProtocolRejected)?;
    let mut seen = std::collections::BTreeSet::new();
    let mut receipts = Vec::with_capacity(entries.len());
    for entry in entries {
        let receipt = exact_object(
            entry,
            &[
                "mutationId",
                "activeLeaseEpoch",
                "deviceMutationSequence",
                "wireSchemaVersion",
                "wireMutationDigest",
                "outcome",
            ],
        )?;
        let mutation_id = identifier(&receipt["mutationId"])?;
        if !asked.iter().any(|id| id == mutation_id) || !seen.insert(mutation_id.to_owned()) {
            return Err(DesktopLocalHostError::CloudProtocolRejected);
        }
        let wire_schema_version = match receipt["wireSchemaVersion"].as_u64() {
            Some(2) => 2,
            Some(3) => 3,
            _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
        };
        let digest = text(&receipt["wireMutationDigest"])?;
        validate_digest43(digest)?;
        let accepted = match text(&receipt["outcome"])? {
            "accepted" => true,
            "rejected" => false,
            _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
        };
        receipts.push(CloudMutationReceipt {
            mutation_id: mutation_id.to_owned(),
            active_lease_epoch: safe_positive(&receipt["activeLeaseEpoch"])?,
            device_mutation_sequence: safe_positive(&receipt["deviceMutationSequence"])?,
            wire_schema_version,
            wire_mutation_digest: digest.to_owned(),
            accepted,
        });
    }
    Ok(receipts)
}

/// A response to a new normal switch: a switch from this device to the requested target.
fn decode_switch_start(
    wire: &[u8],
    target_device_id: &str,
    source_device_id: &str,
) -> Result<DesktopDeviceSwitchStart, DesktopLocalHostError> {
    Ok(match decode_switch_view(wire, source_device_id)? {
        SwitchResponse::Rejected(code) => DesktopDeviceSwitchStart::Rejected(code),
        SwitchResponse::Accepted(view) => {
            if view.forced || view.to_device_id != target_device_id {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            DesktopDeviceSwitchStart::Accepted {
                device_switch_request_id: view.request_id,
                status: view.status,
            }
        }
    })
}

/// A response about this device's existing switch `device_switch_request_id`.
fn decode_switch_response(
    wire: &[u8],
    device_switch_request_id: &str,
    source_device_id: &str,
) -> Result<DesktopDeviceSwitchOutcome, DesktopLocalHostError> {
    Ok(match decode_switch_view(wire, source_device_id)? {
        SwitchResponse::Rejected(code) => DesktopDeviceSwitchOutcome::Rejected(code),
        SwitchResponse::Accepted(view) => {
            if view.request_id != device_switch_request_id {
                return Err(DesktopLocalHostError::CloudProtocolRejected);
            }
            DesktopDeviceSwitchOutcome::Accepted(view.status)
        }
    })
}

struct SwitchView {
    request_id: String,
    forced: bool,
    status: DesktopDeviceSwitchStatus,
    to_device_id: String,
}

enum SwitchResponse {
    Accepted(SwitchView),
    Rejected(DesktopDeviceSwitchRejection),
}

/// `deviceSwitchResponseSchema`, plus: an accepted view must be a switch from this device. The
/// caller binds the switch id or target.
fn decode_switch_view(
    wire: &[u8],
    source_device_id: &str,
) -> Result<SwitchResponse, DesktopLocalHostError> {
    let value: Value = strict_json(wire)?;
    let accepted = value
        .get("accepted")
        .and_then(Value::as_bool)
        .ok_or(DesktopLocalHostError::CloudProtocolRejected)?;
    let response = if accepted {
        exact_object(&value, &["schemaVersion", "accepted", "request"])?
    } else {
        exact_object(&value, &["schemaVersion", "accepted", "code"])?
    };
    if response["schemaVersion"].as_u64() != Some(DEVICE_MANAGEMENT_SCHEMA_VERSION) {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    if !accepted {
        return rejection(text(&response["code"])?).map(SwitchResponse::Rejected);
    }
    let view = exact_object(
        &response["request"],
        &[
            "schemaVersion",
            "requestId",
            "mode",
            "status",
            "fromDeviceId",
            "toDeviceId",
            "requestedAt",
            "earliestTakeoverAt",
            "bootstrapExpiresAt",
        ],
    )?;
    let status = match text(&view["status"])? {
        "requested" => DesktopDeviceSwitchStatus::Requested,
        "draining" => DesktopDeviceSwitchStatus::Draining,
        "waiting_expiry" => DesktopDeviceSwitchStatus::WaitingExpiry,
        "bootstrapping" => DesktopDeviceSwitchStatus::Bootstrapping,
        "completed" => DesktopDeviceSwitchStatus::Completed,
        "cancelled" => DesktopDeviceSwitchStatus::Cancelled,
        "failed" => DesktopDeviceSwitchStatus::Failed,
        _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
    };
    let forced = match text(&view["mode"])? {
        "normal" => false,
        "forced" => true,
        _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
    };
    let requested_at = timestamp(&view["requestedAt"])?;
    let earliest_takeover_at = nullable(&view["earliestTakeoverAt"], timestamp)?;
    let bootstrap_expires_at = nullable(&view["bootstrapExpiresAt"], timestamp)?;
    let terminal = matches!(
        status,
        DesktopDeviceSwitchStatus::Completed
            | DesktopDeviceSwitchStatus::Cancelled
            | DesktopDeviceSwitchStatus::Failed
    );
    // The schema's refinements, then the binding to this device's own switch.
    if view["schemaVersion"].as_u64() != Some(DEVICE_MANAGEMENT_SCHEMA_VERSION)
        || (forced && earliest_takeover_at.is_none())
        || ((status == DesktopDeviceSwitchStatus::Bootstrapping) != bootstrap_expires_at.is_some())
        || (terminal && bootstrap_expires_at.is_some())
        || earliest_takeover_at.is_some_and(|earliest| requested_at > earliest)
        || nullable(&view["fromDeviceId"], identifier)? != Some(source_device_id)
    {
        return Err(DesktopLocalHostError::CloudProtocolRejected);
    }
    Ok(SwitchResponse::Accepted(SwitchView {
        request_id: identifier(&view["requestId"])?.to_owned(),
        forced,
        status,
        to_device_id: identifier(&view["toDeviceId"])?.to_owned(),
    }))
}

fn rejection(code: &str) -> Result<DesktopDeviceSwitchRejection, DesktopLocalHostError> {
    Ok(match code {
        "SWITCH_IN_PROGRESS" => DesktopDeviceSwitchRejection::SwitchInProgress,
        "SWITCH_NOT_FOUND" => DesktopDeviceSwitchRejection::SwitchNotFound,
        "SWITCH_NOT_CANCELLABLE" => DesktopDeviceSwitchRejection::SwitchNotCancellable,
        "IDEMPOTENCY_CONFLICT" => DesktopDeviceSwitchRejection::IdempotencyConflict,
        "TARGET_IS_SOURCE" => DesktopDeviceSwitchRejection::TargetIsSource,
        "TARGET_NOT_BOUND" => DesktopDeviceSwitchRejection::TargetNotBound,
        "TARGET_REMOVED" => DesktopDeviceSwitchRejection::TargetRemoved,
        "ACCOUNT_RECOVERY_PENDING" => DesktopDeviceSwitchRejection::AccountRecoveryPending,
        "FORCED_SWITCH_UNAVAILABLE" => DesktopDeviceSwitchRejection::ForcedSwitchUnavailable,
        "DRAIN_PROOF_INVALID" => DesktopDeviceSwitchRejection::DrainProofInvalid,
        "DRAIN_PROOF_EXPIRED" => DesktopDeviceSwitchRejection::DrainProofExpired,
        "DRAIN_STREAMS_INCOMPLETE" => DesktopDeviceSwitchRejection::DrainStreamsIncomplete,
        _ => return Err(DesktopLocalHostError::CloudProtocolRejected),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BusinessDatabase, DesktopSyncPushWork, DomainAssetWrite, LocalDatabaseKey};

    const WORKSPACE_ID: &str = "workspace-local";
    const SIGNATURE: &str =
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn drain_host() -> (tempfile::TempDir, DesktopLocalHost) {
        let directory = crate::test_tempdir::tempdir().expect("temporary Host directory");
        let mut database = BusinessDatabase::open(
            &directory.path().join("business.db"),
            &LocalDatabaseKey::from_bytes([0x6c; 32]),
            WORKSPACE_ID,
        )
        .expect("open test database");
        for name in ["one", "two"] {
            database
                .create_domain_asset_guarded(
                    &format!("create-{name}"),
                    "device-local",
                    1,
                    "2026-09-16T00:00:00Z",
                    &DomainAssetWrite {
                        entity_id: format!("{name}.test"),
                        note: None,
                        portfolio_id: None,
                        tags: Vec::new(),
                        target_price: None,
                    },
                    true,
                    |_| Ok(()),
                    |(), _| Ok(()),
                )
                .expect("create local mutation");
        }
        let host = DesktopLocalHost::development(
            database,
            directory.path().join("native-backup"),
            "account-local",
            WORKSPACE_ID,
            "device-local",
        )
        .expect("construct development Host");
        (directory, host)
    }

    fn view(overrides: &[(&str, Value)]) -> Value {
        let mut view = serde_json::json!({
            "schemaVersion": 1,
            "requestId": "switch-1",
            "mode": "normal",
            "status": "bootstrapping",
            "fromDeviceId": "device-local",
            "toDeviceId": "device-target",
            "requestedAt": "2026-09-16T00:00:00Z",
            "earliestTakeoverAt": null,
            "bootstrapExpiresAt": "2026-09-16T00:30:00Z",
        });
        for (key, value) in overrides {
            view[*key] = value.clone();
        }
        view
    }

    fn accepted(view: &Value) -> Vec<u8> {
        serde_json::to_vec(
            &serde_json::json!({ "schemaVersion": 1, "accepted": true, "request": view }),
        )
        .expect("encode response")
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "the barrier, push, prepare and submit steps of one drain stay in order"
    )]
    fn drain_closes_writes_folds_confirmed_rows_and_builds_the_exact_submission() {
        let (_directory, host) = drain_host();
        let admission = host.begin_native_cloud_run().expect("admit run");
        assert_eq!(
            host.native_device_switch_drain_progress(&admission),
            Ok(DesktopDrainProgress::Waiting { unconfirmed: 2 })
        );
        // No proof without this switch's barrier holding writes closed.
        assert!(
            host.prepare_native_drain_proof(&admission, "switch-1", "device-key-1")
                .is_err()
        );
        assert_eq!(host.native_device_switch_in_progress(&admission), Ok(None));
        host.begin_native_device_switch_drain(&admission, "switch-1")
            .expect("open barrier");
        assert_eq!(
            host.native_device_switch_in_progress(&admission),
            Ok(Some("switch-1".to_owned()))
        );
        host.begin_native_device_switch_drain(&admission, "switch-1")
            .expect("reopen the same barrier");
        assert!(
            host.begin_native_device_switch_drain(&admission, "switch-2")
                .is_err()
        );
        // Still waiting: the proof cannot be built before every row has a Cloud result.
        assert!(
            host.prepare_native_drain_proof(&admission, "switch-1", "device-key-1")
                .is_err()
        );

        let DesktopSyncPushWork::Ready(claim) = host
            .claim_native_sync_push(&admission)
            .expect("claim pending rows")
        else {
            panic!("two rows are pending");
        };
        let request: Value = serde_json::from_slice(claim.request_body()).expect("push request");
        let acknowledgements = request["mutations"]
            .as_array()
            .expect("mutations")
            .iter()
            .zip(1_u64..)
            .map(|(mutation, revision)| {
                serde_json::json!({
                    "mutationId": mutation["mutationId"],
                    "deviceMutationSequence": mutation["deviceMutationSequence"],
                    "serverRevision": revision,
                    "duplicate": false,
                })
            })
            .collect::<Vec<_>>();
        let response = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 3,
            "accepted": true,
            "acknowledgements": acknowledgements,
            "headServerRevision": 2,
        }))
        .expect("encode push response");
        host.complete_native_sync_push(&admission, &claim, &response)
            .expect("acknowledge under the barrier");
        assert_eq!(
            host.native_device_switch_drain_progress(&admission),
            Ok(DesktopDrainProgress::Ready)
        );
        assert!(
            host.native_drain_receipt_query(&admission)
                .expect("receipt query")
                .is_none()
        );
        assert!(
            host.prepare_native_drain_proof(&admission, "switch-2", "device-key-1")
                .is_err()
        );

        let draft = host
            .prepare_native_drain_proof(&admission, "switch-1", "device-key-1")
            .expect("prepare proof");
        assert!(
            draft
                .signature_transcript()
                .starts_with(b"d35:GOODDEALER-DRAIN-PROOF-SIGNATURE-V2v")
        );
        for signature in ["", "A", &SIGNATURE[1..], "!".repeat(86).as_str()] {
            assert_eq!(
                host.native_drain_submission(&draft, signature),
                Err(DesktopLocalHostError::CloudProtocolRejected)
            );
        }
        let body: Value = serde_json::from_slice(
            &host
                .native_drain_submission(&draft, SIGNATURE)
                .expect("submission"),
        )
        .expect("submission JSON");
        assert_eq!(body["schemaVersion"], 1);
        assert_eq!(body["requestId"], "switch-1");
        let proof = &body["proof"];
        assert_eq!(proof["schemaVersion"], 2);
        assert_eq!(proof["purpose"], "handoff");
        assert_eq!(proof["workspaceId"], WORKSPACE_ID);
        assert_eq!(proof["sourceDeviceId"], "device-local");
        assert_eq!(proof["activeLeaseEpoch"], 1);
        assert_eq!(proof["deviceSwitchRequestId"], "switch-1");
        assert_eq!(proof["signingKeyId"], "device-key-1");
        assert_eq!(proof["signingKeyVersion"], 1);
        assert_eq!(proof["deviceSignature"], SIGNATURE);
        assert_eq!(proof["streams"][0]["stream"], "mutation");
        assert_eq!(proof["streams"][0]["lastAssignedSequence"], 2);
        assert_eq!(proof["streams"][0]["pendingCount"], 0);
        for empty in [1, 2] {
            assert_eq!(proof["streams"][empty]["lastAssignedSequence"], 0);
            assert_eq!(
                proof["streams"][empty]["rollingDigest"],
                "58It6o62GZGmXgy6-ER1rezwYX-LCZVJzlZuZOGcWUs"
            );
        }
        let seconds = |value: &Value| {
            let text = value.as_str().expect("timestamp");
            text[11..13].parse::<i64>().unwrap() * 3600
                + text[14..16].parse::<i64>().unwrap() * 60
                + text[17..19].parse::<i64>().unwrap()
        };
        assert_eq!(
            (seconds(&proof["expiresAt"]) - seconds(&proof["issuedAt"])).rem_euclid(86_400),
            300
        );

        assert_eq!(
            host.complete_native_device_switch_response(
                &admission,
                "switch-1",
                &accepted(&view(&[]))
            ),
            Ok(DesktopDeviceSwitchOutcome::Accepted(
                DesktopDeviceSwitchStatus::Bootstrapping
            ))
        );
        host.clear_native_device_switch_barrier(&admission, "switch-1")
            .expect("clear barrier");
        assert_eq!(host.native_device_switch_in_progress(&admission), Ok(None));
        assert_eq!(
            host.clear_left_over_device_switch_barrier(&admission),
            Ok(false)
        );
    }

    #[test]
    fn switch_responses_must_be_this_switch_from_this_device_in_the_closed_shape() {
        let decode = |wire: &[u8]| decode_switch_response(wire, "switch-1", "device-local");
        assert_eq!(
            decode(&accepted(&view(&[]))),
            Ok(DesktopDeviceSwitchOutcome::Accepted(
                DesktopDeviceSwitchStatus::Bootstrapping
            ))
        );
        assert_eq!(
            decode(br#"{"schemaVersion":1,"accepted":false,"code":"DRAIN_PROOF_EXPIRED"}"#),
            Ok(DesktopDeviceSwitchOutcome::Rejected(
                DesktopDeviceSwitchRejection::DrainProofExpired
            ))
        );
        let mut extra = view(&[]);
        extra["extra"] = Value::Bool(true);
        let refused = [
            accepted(&view(&[("requestId", serde_json::json!("switch-2"))])),
            accepted(&view(&[(
                "fromDeviceId",
                serde_json::json!("device-other"),
            )])),
            accepted(&view(&[("fromDeviceId", Value::Null)])),
            accepted(&view(&[("bootstrapExpiresAt", Value::Null)])),
            accepted(&view(&[("status", serde_json::json!("completed"))])),
            accepted(&view(&[("mode", serde_json::json!("forced"))])),
            accepted(&view(&[("status", serde_json::json!("paused"))])),
            accepted(&view(&[(
                "requestedAt",
                serde_json::json!("2026-09-16 00:00:00"),
            )])),
            accepted(&view(&[("schemaVersion", serde_json::json!(2))])),
            accepted(&extra),
            br#"{"schemaVersion":1,"accepted":false,"code":"SOMETHING_ELSE"}"#.to_vec(),
            br#"{"schemaVersion":1,"accepted":false,"code":"DRAIN_PROOF_EXPIRED","x":1}"#.to_vec(),
            br#"{"schemaVersion":1,"accepted":"true","request":{}}"#.to_vec(),
            br#"{"schemaVersion":1,"accepted":false,"accepted":false,"code":"SWITCH_NOT_FOUND"}"#
                .to_vec(),
            b"".to_vec(),
        ];
        for wire in refused {
            assert_eq!(
                decode(&wire),
                Err(DesktopLocalHostError::CloudProtocolRejected),
                "{}",
                String::from_utf8_lossy(&wire)
            );
        }
    }

    #[test]
    fn a_new_switch_takes_its_id_only_from_a_normal_switch_from_this_device_to_the_target() {
        let draining = |overrides: &[(&str, Value)]| {
            let mut fields = vec![
                ("status", serde_json::json!("draining")),
                ("bootstrapExpiresAt", Value::Null),
                ("requestId", serde_json::json!("switch-cloud")),
            ];
            fields.extend(overrides.iter().cloned());
            accepted(&view(&fields))
        };
        let decode = |wire: &[u8]| decode_switch_start(wire, "device-target", "device-local");
        assert_eq!(
            decode(&draining(&[])),
            Ok(DesktopDeviceSwitchStart::Accepted {
                device_switch_request_id: "switch-cloud".to_owned(),
                status: DesktopDeviceSwitchStatus::Draining,
            })
        );
        assert_eq!(
            decode(br#"{"schemaVersion":1,"accepted":false,"code":"TARGET_REMOVED"}"#),
            Ok(DesktopDeviceSwitchStart::Rejected(
                DesktopDeviceSwitchRejection::TargetRemoved
            ))
        );
        for wire in [
            draining(&[("toDeviceId", serde_json::json!("device-other"))]),
            draining(&[("fromDeviceId", serde_json::json!("device-other"))]),
            draining(&[("fromDeviceId", Value::Null)]),
            draining(&[
                ("mode", serde_json::json!("forced")),
                (
                    "earliestTakeoverAt",
                    serde_json::json!("2026-09-16T00:10:00Z"),
                ),
            ]),
            draining(&[("requestId", serde_json::json!(""))]),
            draining(&[("requestId", serde_json::json!(7))]),
        ] {
            assert_eq!(
                decode(&wire),
                Err(DesktopLocalHostError::CloudProtocolRejected),
                "{}",
                String::from_utf8_lossy(&wire)
            );
        }
    }

    #[test]
    fn switch_request_and_lookup_bodies_are_the_closed_protocol_shapes() {
        let first = DesktopLocalHost::prepare_native_device_switch_request("device-target")
            .expect("request");
        let second = DesktopLocalHost::prepare_native_device_switch_request("device-target")
            .expect("request");
        assert_eq!(first.target_device_id(), "device-target");
        let body: Value = serde_json::from_slice(first.request_body()).expect("request json");
        let keys: Vec<&str> = body
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            ["idempotencyKey", "mode", "schemaVersion", "toDeviceId"]
        );
        assert_eq!(body["schemaVersion"], 1);
        assert_eq!(body["mode"], "normal");
        assert_eq!(body["toDeviceId"], "device-target");
        // Each prepared request is a new switch; only a retry of the same exchange reuses its key.
        assert_ne!(first.request_body(), second.request_body());
        assert_eq!(
            DesktopLocalHost::prepare_native_device_switch_request(""),
            Err(DesktopLocalHostError::CloudProtocolRejected)
        );
        assert_eq!(
            DesktopLocalHost::native_device_switch_lookup("switch-1").expect("lookup"),
            br#"{"requestId":"switch-1","schemaVersion":1}"#.to_vec()
        );
        assert_eq!(
            DesktopLocalHost::native_device_switch_lookup("switch 1"),
            Err(DesktopLocalHostError::CloudProtocolRejected)
        );
    }

    #[test]
    fn receipt_responses_must_answer_only_the_ids_asked_in_the_closed_shape() {
        let asked = vec!["mutation-a".to_owned(), "mutation-b".to_owned()];
        let receipt = |overrides: &[(&str, Value)]| {
            let mut receipt = serde_json::json!({
                "mutationId": "mutation-a",
                "activeLeaseEpoch": 1,
                "deviceMutationSequence": 1,
                "wireSchemaVersion": 3,
                "wireMutationDigest": "YWRjj4bGVnNB_L2T2DX-zAZ5DhUluceTstJSk_xMjtU",
                "outcome": "accepted",
            });
            for (key, value) in overrides {
                receipt[*key] = value.clone();
            }
            receipt
        };
        let response = |receipts: Vec<Value>| {
            serde_json::to_vec(&serde_json::json!({ "schemaVersion": 1, "receipts": receipts }))
                .expect("encode receipts")
        };
        let decoded =
            decode_receipt_response(&response(vec![receipt(&[])]), &asked).expect("decode");
        assert_eq!(
            decoded,
            vec![CloudMutationReceipt {
                mutation_id: "mutation-a".to_owned(),
                active_lease_epoch: 1,
                device_mutation_sequence: 1,
                wire_schema_version: 3,
                wire_mutation_digest: "YWRjj4bGVnNB_L2T2DX-zAZ5DhUluceTstJSk_xMjtU".to_owned(),
                accepted: true,
            }]
        );
        assert_eq!(
            decode_receipt_response(&response(vec![]), &asked),
            Ok(vec![])
        );
        let mut extra = receipt(&[]);
        extra["serverRevision"] = serde_json::json!(1);
        let refused = [
            response(vec![receipt(&[(
                "mutationId",
                serde_json::json!("mutation-z"),
            )])]),
            response(vec![receipt(&[]), receipt(&[])]),
            response(vec![receipt(&[(
                "wireSchemaVersion",
                serde_json::json!(4),
            )])]),
            response(vec![receipt(&[(
                "wireMutationDigest",
                serde_json::json!("short"),
            )])]),
            response(vec![receipt(&[("activeLeaseEpoch", serde_json::json!(0))])]),
            response(vec![receipt(&[(
                "deviceMutationSequence",
                serde_json::json!(9_007_199_254_740_992_u64),
            )])]),
            response(vec![receipt(&[("outcome", serde_json::json!("pending"))])]),
            response(vec![extra]),
            br#"{"schemaVersion":2,"receipts":[]}"#.to_vec(),
            br#"{"schemaVersion":1,"receipts":[],"more":true}"#.to_vec(),
        ];
        for wire in refused {
            assert_eq!(
                decode_receipt_response(&wire, &asked),
                Err(DesktopLocalHostError::CloudProtocolRejected),
                "{}",
                String::from_utf8_lossy(&wire)
            );
        }
    }
}
