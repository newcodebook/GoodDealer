//! Closed `SellerHub` inventory intents. Account identity and secrets stay in the Native service.
use crate::{
    native_cloud_runtime::NativeCloudCoordinator,
    provider_ipc::{decode_provider_request, is_provider_connection_uuid},
    provider_lane::{ProviderOperation, ProviderStatus, ProviderSubmission},
};
use gooddealer_local_storage::{DesktopLocalHost, DesktopSellerHubStatus};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Intent {
    Connect {
        schema_version: u8,
    },
    Refresh {
        schema_version: u8,
        connection_id: String,
    },
    Revoke {
        schema_version: u8,
        connection_id: String,
    },
}

impl Intent {
    fn operation(self) -> Result<ProviderOperation, &'static str> {
        match self {
            Self::Connect { schema_version: 1 } => Ok(ProviderOperation::SellerHubConnect),
            Self::Refresh {
                schema_version: 1,
                connection_id,
            } if is_provider_connection_uuid(&connection_id) => {
                Ok(ProviderOperation::SellerHubRefresh { connection_id })
            }
            Self::Revoke {
                schema_version: 1,
                connection_id,
            } if is_provider_connection_uuid(&connection_id) => {
                Ok(ProviderOperation::SellerHubRevoke { connection_id })
            }
            _ => Err("SELLERHUB_INPUT_REJECTED"),
        }
    }
}

#[tauri::command]
pub(crate) async fn sellerhub_submit(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), &'static str> {
    let intent: Intent =
        decode_provider_request(&request, 512).map_err(|_| "SELLERHUB_INPUT_REJECTED")?;
    let operation = intent.operation()?;
    let submission = if let ProviderOperation::SellerHubRefresh { connection_id } = &operation {
        cloud.submit_sellerhub_inventory_refresh(&host, connection_id)
    } else {
        cloud.submit_provider(&operation)
    };
    match submission {
        ProviderSubmission::Accepted => Ok(()),
        ProviderSubmission::Busy => Err("SELLERHUB_BUSY"),
        ProviderSubmission::RateLimited => Err("SELLERHUB_RATE_LIMITED"),
        ProviderSubmission::Unavailable => Err("SELLERHUB_UNAVAILABLE"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SellerHubStatus {
    #[serde(flatten)]
    local: DesktopSellerHubStatus,
    lane_state: &'static str,
    capturable: bool,
    last_operation: Option<LastOperation>,
}

#[derive(Serialize)]
struct LastOperation {
    kind: &'static str,
    outcome: &'static str,
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn sellerhub_status(
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<SellerHubStatus, &'static str> {
    let local = host
        .read_sellerhub_status()
        .map_err(|_| "SELLERHUB_UNAVAILABLE")?;
    let lane_state = match cloud.sellerhub_provider_status() {
        ProviderStatus::Recovering => "recovering",
        ProviderStatus::Ready => "ready",
        ProviderStatus::Busy => "busy",
        ProviderStatus::Blocked => "blocked",
    };
    let last_operation = cloud
        .last_provider_operation(
            host.authority_identity().as_ref(),
            host.provider_connection_generation(),
        )
        .filter(|record| record.kind.starts_with("sellerhub_"))
        .map(|record| LastOperation {
            kind: record.kind,
            outcome: record.outcome,
        });
    Ok(SellerHubStatus {
        local,
        lane_state,
        capturable: gooddealer_secure_host_core::SpaceshipCapture::supported(),
        last_operation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_ipc::decode_provider_body;
    use tauri::ipc::InvokeBody;

    #[test]
    fn rejects_arbitrary_fields_old_versions_and_noncanonical_connections() {
        let parse = |wire: &str| -> Result<ProviderOperation, &'static str> {
            let intent: Intent =
                decode_provider_body(&InvokeBody::Raw(wire.as_bytes().to_vec()), 512)
                    .map_err(|_| "wire")?;
            intent.operation()
        };
        assert_eq!(
            parse(r#"{"action":"connect","schemaVersion":1}"#),
            Ok(ProviderOperation::SellerHubConnect)
        );
        assert!(parse(r#"{"action":"refresh","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111"}"#).is_ok());
        for input in [
            r#"{"action":"connect","schemaVersion":1,"apiKey":"refuse"}"#,
            r#"{"action":"connect","schemaVersion":1,"url":"https://example.test"}"#,
            r#"{"action":"connect","schemaVersion":1,"schemaVersion":1}"#,
            r#"{"action":"connect","schemaVersion":0}"#,
            r#"{"action":"refresh","schemaVersion":1,"connectionId":"11111111-1111-4111-A111-111111111111"}"#,
            r#"{"action":"update","schemaVersion":1}"#,
        ] {
            assert!(parse(input).is_err());
        }
    }
}
