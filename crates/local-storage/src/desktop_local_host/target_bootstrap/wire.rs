//! Strict target-bound Cloud answers; no accepted answer is execution authority.
use super::{
    DesktopTargetBootstrapTerminalStatus as Terminal, DesktopTargetBootstrapView as View, Error,
    MAX_REVISION, rejected, required_option,
};
use crate::desktop_native_cloud::{
    strict_json, validate_digest43, validate_identifier, validate_timestamp,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BootstrapWorkflow {
    schema_version: u8,
    request_id: String,
    mode: String,
    status: String,
    #[serde(deserialize_with = "required_option")]
    from_device_id: Option<String>,
    to_device_id: String,
    requested_at: String,
    #[serde(deserialize_with = "required_option")]
    earliest_takeover_at: Option<String>,
    #[serde(deserialize_with = "required_option")]
    bootstrap_expires_at: Option<String>,
    #[serde(deserialize_with = "required_option")]
    normal_handoff_receipt: Option<Receipt>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    source_lease_epoch: u64,
    proof_id: String,
    proof_digest: String,
    released_at: String,
}

pub(super) fn validate_view(view: &View) -> Result<(), Error> {
    match view {
        View::Idle => Ok(()),
        View::Available {
            request_id,
            bootstrap_expires_at,
        } => {
            validate_identifier(request_id, 160)?;
            validate_timestamp(bootstrap_expires_at)
        }
        View::Pending { request_id } | View::Finished { request_id, .. } => {
            validate_identifier(request_id, 160)
        }
    }
}

fn response(bytes: &[u8]) -> Result<Value, Error> {
    if bytes.is_empty() || bytes.len() > 8192 {
        return Err(rejected());
    }
    strict_json(bytes)
}
fn exact(value: &Value, keys: &[&str]) -> Result<(), Error> {
    let object = value.as_object().ok_or_else(rejected)?;
    if object.len() != keys.len()
        || keys.iter().any(|key| !object.contains_key(*key))
        || value["schemaVersion"].as_u64() != Some(1)
    {
        return Err(rejected());
    }
    Ok(())
}

pub(super) fn status(
    bytes: &[u8],
    target: &str,
    request_id: Option<&str>,
) -> Result<Option<View>, Error> {
    let value = response(bytes)?;
    match value["found"].as_bool() {
        Some(false) => {
            exact(&value, &["schemaVersion", "found"])?;
            Ok(None)
        }
        Some(true) => {
            exact(&value, &["schemaVersion", "found", "request"])?;
            let view = request(value["request"].clone(), target, request_id)?;
            if request_id.is_none() && !matches!(view, View::Available { .. }) {
                return Err(rejected());
            }
            Ok(Some(view))
        }
        _ => Err(rejected()),
    }
}

pub(super) fn cancel(bytes: &[u8], target: &str, request_id: &str) -> Result<Option<View>, Error> {
    let value = response(bytes)?;
    match value["accepted"].as_bool() {
        Some(false) => {
            exact(&value, &["schemaVersion", "accepted", "code"])?;
            if !matches!(
                value["code"].as_str(),
                Some(
                    "SWITCH_IN_PROGRESS"
                        | "SWITCH_NOT_FOUND"
                        | "SWITCH_NOT_CANCELLABLE"
                        | "IDEMPOTENCY_CONFLICT"
                        | "TARGET_IS_SOURCE"
                        | "SOURCE_LEASE_CHANGED"
                        | "TARGET_NOT_BOUND"
                        | "TARGET_REMOVED"
                        | "ACCOUNT_RECOVERY_PENDING"
                        | "FORCED_SWITCH_UNAVAILABLE"
                        | "DRAIN_PROOF_INVALID"
                        | "DRAIN_PROOF_EXPIRED"
                        | "DRAIN_STREAMS_INCOMPLETE"
                )
            ) {
                return Err(rejected());
            }
            Ok(None)
        }
        Some(true) => {
            exact(&value, &["schemaVersion", "accepted", "request"])?;
            let view = request(value["request"].clone(), target, Some(request_id))?;
            if !matches!(view, View::Finished { .. }) {
                return Err(rejected());
            }
            Ok(Some(view))
        }
        _ => Err(rejected()),
    }
}

fn request(value: Value, target: &str, request_id: Option<&str>) -> Result<View, Error> {
    let request: BootstrapWorkflow = serde_json::from_value(value).map_err(|_| rejected())?;
    validate_identifier(&request.request_id, 160)?;
    validate_identifier(&request.to_device_id, 160)?;
    validate_timestamp(&request.requested_at)?;
    if let Some(source) = &request.from_device_id {
        validate_identifier(source, 160)?;
    }
    for timestamp in [&request.earliest_takeover_at, &request.bootstrap_expires_at]
        .into_iter()
        .flatten()
    {
        validate_timestamp(timestamp)?;
    }
    if request.schema_version != 2
        || request.to_device_id != target
        || request_id.is_some_and(|id| request.request_id != id)
        || !matches!(request.mode.as_str(), "normal" | "forced")
        || (request.mode == "forced" && request.earliest_takeover_at.is_none())
        || request
            .earliest_takeover_at
            .as_ref()
            .is_some_and(|at| *at < request.requested_at)
        || ((request.status == "bootstrapping") != request.bootstrap_expires_at.is_some())
    {
        return Err(rejected());
    }
    if let Some(receipt) = &request.normal_handoff_receipt {
        validate_identifier(&receipt.proof_id, 160)?;
        validate_digest43(&receipt.proof_digest)?;
        validate_timestamp(&receipt.released_at)?;
        if receipt.source_lease_epoch == 0
            || receipt.source_lease_epoch > MAX_REVISION
            || request.mode != "normal"
            || receipt.released_at < request.requested_at
            || request
                .from_device_id
                .as_ref()
                .is_none_or(|source| source == &request.to_device_id)
        {
            return Err(rejected());
        }
    }
    let status = match request.status.as_str() {
        "bootstrapping" => {
            return Ok(View::Available {
                request_id: request.request_id,
                bootstrap_expires_at: request.bootstrap_expires_at.ok_or_else(rejected)?,
            });
        }
        "cancelled" => Terminal::Cancelled,
        "failed" => Terminal::Failed,
        "completed" => Terminal::Completed,
        _ => return Err(rejected()),
    };
    Ok(View::Finished {
        request_id: request.request_id,
        status,
    })
}

#[cfg(test)]
pub(super) mod tests;
