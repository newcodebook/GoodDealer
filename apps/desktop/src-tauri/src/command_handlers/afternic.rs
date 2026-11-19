//! Bounded Afternic business intents. Credentials are captured only by Native.
use crate::native_cloud_runtime::NativeCloudCoordinator;
use crate::provider_ipc::decode_provider_request;
use crate::provider_lane::{ProviderOperation, ProviderStatus, ProviderSubmission};
use gooddealer_local_storage::DesktopLocalHost;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectRequest {
    schema_version: u8,
    display_label: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectionRequest {
    schema_version: u8,
    connection_id: String,
}

fn rejected() -> String {
    "AFTERNIC_INPUT_REJECTED".to_owned()
}
impl ConnectRequest {
    fn validate(self) -> Result<String, String> {
        if self.schema_version != 1
            || self.display_label.is_empty()
            || self.display_label.encode_utf16().count() > 80
            || self.display_label.chars().any(char::is_control)
        {
            return Err(rejected());
        }
        Ok(self.display_label)
    }
}
impl ConnectionRequest {
    fn validate(self) -> Result<String, String> {
        let bytes = self.connection_id.as_bytes();
        if self.schema_version != 1
            || bytes.len() != 36
            || bytes[14] != b'4'
            || !matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
            || bytes.iter().enumerate().any(|(i, b)| {
                if matches!(i, 8 | 13 | 18 | 23) {
                    *b != b'-'
                } else {
                    !matches!(b, b'0'..=b'9' | b'a'..=b'f')
                }
            })
        {
            return Err(rejected());
        }
        Ok(self.connection_id)
    }
}
fn submission(result: ProviderSubmission) -> Result<(), String> {
    match result {
        ProviderSubmission::Accepted => Ok(()),
        ProviderSubmission::Busy => Err("AFTERNIC_BUSY".to_owned()),
        ProviderSubmission::RateLimited => Err("AFTERNIC_RATE_LIMITED".to_owned()),
        ProviderSubmission::Unavailable => Err("AFTERNIC_UNAVAILABLE".to_owned()),
    }
}
#[tauri::command]
pub(crate) async fn afternic_connection_connect(
    request: tauri::ipc::Request<'_>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), String> {
    let request: ConnectRequest =
        decode_provider_request(&request, 1_024).map_err(|_| rejected())?;
    submission(cloud.submit_provider(&ProviderOperation::AfternicConnect {
        display_label: request.validate()?,
    }))
}
#[tauri::command]
pub(crate) async fn afternic_inventory_refresh(
    request: tauri::ipc::Request<'_>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), String> {
    let request: ConnectionRequest =
        decode_provider_request(&request, 512).map_err(|_| rejected())?;
    submission(cloud.submit_provider(&ProviderOperation::AfternicRefresh {
        connection_id: request.validate()?,
    }))
}
#[tauri::command]
pub(crate) async fn afternic_connection_revoke(
    request: tauri::ipc::Request<'_>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), String> {
    let request: ConnectionRequest =
        decode_provider_request(&request, 512).map_err(|_| rejected())?;
    submission(cloud.submit_provider(&ProviderOperation::AfternicRevoke {
        connection_id: request.validate()?,
    }))
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn afternic_connection_status(
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<serde_json::Value, String> {
    let local = host
        .read_afternic_connections()
        .map_err(|_| "AFTERNIC_STATUS_UNAVAILABLE".to_owned())?;
    let lane_state = match cloud.afternic_provider_status() {
        ProviderStatus::Recovering => "recovering",
        ProviderStatus::Ready => "ready",
        ProviderStatus::Busy => "busy",
        ProviderStatus::Blocked => "blocked",
    };
    let last = cloud
        .last_provider_operation(
            host.authority_identity().as_ref(),
            host.provider_connection_generation(),
        )
        .filter(|record| record.kind.starts_with("afternic_"))
        .map(|record| serde_json::json!({"kind":record.kind,"outcome":record.outcome}));
    let mut value =
        serde_json::to_value(local).map_err(|_| "AFTERNIC_STATUS_UNAVAILABLE".to_owned())?;
    value["laneState"] = serde_json::json!(lane_state);
    value["capturable"] =
        serde_json::json!(gooddealer_secure_host_core::AfternicCapture::supported());
    value["lastOperation"] = serde_json::json!(last);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_ipc::decode_provider_body;
    use tauri::ipc::InvokeBody;
    fn connect(wire: &str) -> Result<String, String> {
        decode_provider_body::<ConnectRequest>(&InvokeBody::Raw(wire.as_bytes().to_vec()), 1_024)?
            .validate()
    }
    #[test]
    fn raw_intents_reject_credentials_duplicates_and_noncanonical_identifiers() {
        assert_eq!(
            connect(r#"{"schemaVersion":1,"displayLabel":"My portfolio"}"#).unwrap(),
            "My portfolio"
        );
        for wire in [
            r#"{"schemaVersion":1,"displayLabel":"A","apiKey":"secret"}"#,
            r#"{"schemaVersion":1,"schemaVersion":1,"displayLabel":"A"}"#,
            r#"{"schemaVersion":2,"displayLabel":"A"}"#,
            r#"{"schemaVersion":1,"displayLabel":""}"#,
            r#"{"schemaVersion":1,"displayLabel":"A\nB"}"#,
        ] {
            assert!(connect(wire).is_err());
        }
        assert!(
            connect(&format!(
                r#"{{"schemaVersion":1,"displayLabel":"{}"}}"#,
                "😀".repeat(41)
            ))
            .is_err()
        );
        assert!(
            decode_provider_body::<ConnectRequest>(
                &InvokeBody::Json(serde_json::json!({"schemaVersion":1,"displayLabel":"A"})),
                1_024
            )
            .is_err()
        );
        for id in [
            "",
            "11111111-1111-1111-8111-111111111111",
            "11111111-1111-4111-c111-111111111111",
            "11111111-1111-4111-A111-111111111111",
        ] {
            assert!(
                ConnectionRequest {
                    schema_version: 1,
                    connection_id: id.to_owned()
                }
                .validate()
                .is_err()
            );
        }
        assert!(
            ConnectionRequest {
                schema_version: 1,
                connection_id: "11111111-1111-4111-a111-111111111111".to_owned()
            }
            .validate()
            .is_ok()
        );
    }
}
