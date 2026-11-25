//! Closed Registrar intents. Account identity and secrets are confined to the Native service.
use crate::{
    native_cloud_runtime::NativeCloudCoordinator,
    provider_ipc::{decode_provider_request, is_provider_connection_uuid},
    provider_lane::{ProviderOperation, ProviderStatus, ProviderSubmission},
};
use gooddealer_local_storage::{DesktopLocalHost, DesktopPorkbunRegistrarStatus};
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
    /// One read-only record read of an asset's Zone through an existing connection.
    #[serde(rename = "observe-dns")]
    ObserveDns {
        schema_version: u8,
        connection_id: String,
        domain: String,
    },
}

/// A canonical lowercase LDH domain; the Host still requires it to be an inventoried asset.
fn is_zone_name(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

impl Intent {
    fn operation(self) -> Result<ProviderOperation, &'static str> {
        match self {
            Self::Connect { schema_version: 1 } => Ok(ProviderOperation::PorkbunConnect),
            Self::Refresh {
                schema_version: 1,
                connection_id,
            } if is_provider_connection_uuid(&connection_id) => {
                Ok(ProviderOperation::PorkbunRefresh { connection_id })
            }
            Self::Revoke {
                schema_version: 1,
                connection_id,
            } if is_provider_connection_uuid(&connection_id) => {
                Ok(ProviderOperation::PorkbunRevoke { connection_id })
            }
            Self::ObserveDns {
                schema_version: 1,
                connection_id,
                domain,
            } if is_provider_connection_uuid(&connection_id) && is_zone_name(&domain) => {
                Ok(ProviderOperation::PorkbunDnsObserve {
                    connection_id,
                    entity_id: domain,
                })
            }
            _ => Err("PORKBUN_INPUT_REJECTED"),
        }
    }
}

#[tauri::command]
pub(crate) async fn porkbun_registrar_submit(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), &'static str> {
    let intent: Intent =
        decode_provider_request(&request, 512).map_err(|_| "PORKBUN_INPUT_REJECTED")?;
    let operation = intent.operation()?;
    let submission = if let ProviderOperation::PorkbunRefresh { connection_id } = &operation {
        cloud.submit_porkbun_inventory_refresh(&host, connection_id)
    } else {
        cloud.submit_provider(&operation)
    };
    match submission {
        ProviderSubmission::Accepted => Ok(()),
        ProviderSubmission::Busy => Err("PORKBUN_BUSY"),
        ProviderSubmission::RateLimited => Err("PORKBUN_RATE_LIMITED"),
        ProviderSubmission::Unavailable => Err("PORKBUN_UNAVAILABLE"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistrarStatus {
    #[serde(flatten)]
    local: DesktopPorkbunRegistrarStatus,
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
pub(crate) fn porkbun_registrar_status(
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<RegistrarStatus, &'static str> {
    let local = host
        .read_porkbun_registrar_status()
        .map_err(|_| "PORKBUN_UNAVAILABLE")?;
    let lane_state = match cloud.porkbun_provider_status() {
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
        .filter(|record| record.kind.starts_with("porkbun_"))
        .map(|record| LastOperation {
            kind: record.kind,
            outcome: record.outcome,
        });
    Ok(RegistrarStatus {
        local,
        lane_state,
        capturable: gooddealer_secure_host_core::PorkbunCapture::supported(),
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
            Ok(ProviderOperation::PorkbunConnect)
        );
        assert!(parse(r#"{"action":"refresh","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111"}"#).is_ok());
        assert_eq!(
            parse(
                r#"{"action":"observe-dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domain":"xn--bcher-kva.example"}"#
            ),
            Ok(ProviderOperation::PorkbunDnsObserve {
                connection_id: "11111111-1111-4111-a111-111111111111".into(),
                entity_id: "xn--bcher-kva.example".into(),
            })
        );
        for input in [
            r#"{"action":"connect","schemaVersion":1,"apiKey":"refuse"}"#,
            r#"{"action":"connect","schemaVersion":1,"url":"https://example.test"}"#,
            r#"{"action":"connect","schemaVersion":1,"schemaVersion":1}"#,
            r#"{"action":"connect","schemaVersion":0}"#,
            r#"{"action":"refresh","schemaVersion":1,"connectionId":"11111111-1111-4111-A111-111111111111"}"#,
            r#"{"action":"update","schemaVersion":1}"#,
            r#"{"action":"observe-dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111"}"#,
            r#"{"action":"observe-dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domain":"Example.test"}"#,
            r#"{"action":"observe-dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domain":"example"}"#,
            r#"{"action":"observe-dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domain":"-a.example"}"#,
            r#"{"action":"observe-dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domain":"a..example"}"#,
            r#"{"action":"observe-dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domain":"example.test","records":[]}"#,
            r#"{"action":"observe_dns","schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domain":"example.test"}"#,
        ] {
            assert!(parse(input).is_err());
        }
    }
}
