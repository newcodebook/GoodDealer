//! Forced takeover carries no capability or authentication secret; all wire shapes are closed.
use super::{Error, rejected, required_option};
use crate::desktop_native_cloud::{strict_json, validate_identifier, validate_timestamp};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) const MAX_NUMBER: u64 = 9_007_199_254_740_991;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[expect(
    clippy::struct_field_names,
    reason = "matches the closed Cloud wire contract"
)]
pub(super) struct Request {
    pub schema_version: u8,
    pub request_id: String,
    pub mode: String,
    pub status: String,
    #[serde(deserialize_with = "required_option")]
    pub from_device_id: Option<String>,
    pub to_device_id: String,
    pub requested_at: String,
    #[serde(deserialize_with = "required_option")]
    pub earliest_takeover_at: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub bootstrap_expires_at: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub normal_handoff_receipt: Option<Value>,
}
impl Request {
    pub fn validate(&self, target: &str) -> Result<(), Error> {
        validate_identifier(&self.request_id, 160)?;
        validate_identifier(&self.to_device_id, 160)?;
        let source = self.from_device_id.as_ref().ok_or_else(rejected)?;
        validate_identifier(source, 160)?;
        validate_timestamp(&self.requested_at)?;
        let earliest = self.earliest_takeover_at.as_ref().ok_or_else(rejected)?;
        validate_timestamp(earliest)?;
        if let Some(expires) = &self.bootstrap_expires_at {
            validate_timestamp(expires)?;
        }
        if self.schema_version != 2
            || self.mode != "forced"
            || self.to_device_id != target
            || source == target
            || earliest < &self.requested_at
            || self.normal_handoff_receipt.is_some()
            || ![
                "waiting_expiry",
                "bootstrapping",
                "completed",
                "cancelled",
                "failed",
            ]
            .contains(&self.status.as_str())
            || (self.status == "bootstrapping") != self.bootstrap_expires_at.is_some()
        {
            return Err(rejected());
        }
        Ok(())
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[expect(
    clippy::struct_field_names,
    reason = "matches the closed Cloud wire contract"
)]
pub(super) struct Workflow {
    pub request: Request,
    pub workflow_revision: u64,
    pub source_lease_epoch: u64,
    pub evaluated_at: String,
    pub claimable: bool,
}
impl Workflow {
    pub fn validate(&self, target: &str) -> Result<(), Error> {
        self.request.validate(target)?;
        positive(self.workflow_revision)?;
        positive(self.source_lease_epoch)?;
        validate_timestamp(&self.evaluated_at)?;
        let earliest = self
            .request
            .earliest_takeover_at
            .as_ref()
            .ok_or_else(rejected)?;
        if self.claimable
            && (self.request.status != "waiting_expiry"
                || &self.evaluated_at < earliest
                || timestamp(&self.evaluated_at)?
                    >= timestamp(earliest)?
                        .checked_add(86_400)
                        .ok_or_else(rejected)?)
        {
            return Err(rejected());
        }
        Ok(())
    }
}
pub(super) fn timestamp(value: &str) -> Result<i64, Error> {
    super::super::authority::parse_canonical_utc(value).map_err(|_| rejected())
}
pub(super) fn positive(value: u64) -> Result<(), Error> {
    if value == 0 || value > MAX_NUMBER {
        Err(rejected())
    } else {
        Ok(())
    }
}
pub(super) fn parse(bytes: &[u8]) -> Result<Value, Error> {
    if bytes.is_empty() || bytes.len() > 16_384 {
        return Err(rejected());
    }
    strict_json(bytes)
}
pub(super) fn exact(value: &Value, fields: &[&str]) -> Result<(), Error> {
    let object = value.as_object().ok_or_else(rejected)?;
    if object.len() != fields.len()
        || fields.iter().any(|key| !object.contains_key(*key))
        || value["schemaVersion"].as_u64() != Some(1)
    {
        return Err(rejected());
    }
    Ok(())
}
pub(super) fn request(value: Value, target: &str) -> Result<Request, Error> {
    let request: Request = serde_json::from_value(value).map_err(|_| rejected())?;
    request.validate(target)?;
    Ok(request)
}
pub(super) fn workflow(value: Value, target: &str) -> Result<Workflow, Error> {
    let workflow: Workflow = serde_json::from_value(value).map_err(|_| rejected())?;
    workflow.validate(target)?;
    Ok(workflow)
}
pub(super) fn rejection(code: &str) -> Result<super::DesktopForcedTakeoverStoppedReason, Error> {
    use super::DesktopForcedTakeoverStoppedReason as Reason;
    Ok(match code {
        "REAUTH_REQUIRED" => Reason::ReauthenticationRequired,
        "SOURCE_LEASE_CHANGED" => Reason::SourceChanged,
        "FORCED_INTENT_CANCELLED"
        | "SWITCH_IN_PROGRESS"
        | "SWITCH_NOT_FOUND"
        | "SWITCH_NOT_CANCELLABLE"
        | "IDEMPOTENCY_CONFLICT"
        | "TARGET_IS_SOURCE"
        | "TARGET_NOT_BOUND"
        | "TARGET_REMOVED"
        | "ACCOUNT_RECOVERY_PENDING"
        | "FORCED_SWITCH_UNAVAILABLE"
        | "DRAIN_PROOF_INVALID"
        | "DRAIN_PROOF_EXPIRED"
        | "DRAIN_STREAMS_INCOMPLETE" => Reason::RequestRejected,
        _ => return Err(rejected()),
    })
}
