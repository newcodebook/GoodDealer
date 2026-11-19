//! Only a previously displayed target workflow may be confirmed for termination.
use crate::target_bootstrap_termination::{
    DesktopTargetBootstrapTermination, TargetBootstrapError,
};
use gooddealer_local_storage::{DesktopTargetBootstrapTerminalStatus, DesktopTargetBootstrapView};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TargetBootstrapCancelRequest {
    schema_version: u8,
    request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum TargetBootstrapView {
    Idle {
        schema_version: u8,
    },
    Available {
        schema_version: u8,
        request_id: String,
        bootstrap_expires_at: String,
    },
    Pending {
        schema_version: u8,
        request_id: String,
    },
    Finished {
        schema_version: u8,
        request_id: String,
        status: &'static str,
    },
}
impl From<DesktopTargetBootstrapView> for TargetBootstrapView {
    fn from(view: DesktopTargetBootstrapView) -> Self {
        match view {
            DesktopTargetBootstrapView::Idle => Self::Idle { schema_version: 1 },
            DesktopTargetBootstrapView::Available {
                request_id,
                bootstrap_expires_at,
            } => Self::Available {
                schema_version: 1,
                request_id,
                bootstrap_expires_at,
            },
            DesktopTargetBootstrapView::Pending { request_id } => Self::Pending {
                schema_version: 1,
                request_id,
            },
            DesktopTargetBootstrapView::Finished { request_id, status } => Self::Finished {
                schema_version: 1,
                request_id,
                status: match status {
                    DesktopTargetBootstrapTerminalStatus::Cancelled => "cancelled",
                    DesktopTargetBootstrapTerminalStatus::Failed => "failed",
                    DesktopTargetBootstrapTerminalStatus::Completed => "completed",
                },
            },
        }
    }
}
fn result(
    view: Result<DesktopTargetBootstrapView, TargetBootstrapError>,
) -> Result<TargetBootstrapView, String> {
    view.map(TargetBootstrapView::from).map_err(|error| {
        match error {
            TargetBootstrapError::Retryable => "TARGET_BOOTSTRAP_RETRY_LATER",
            TargetBootstrapError::AuthorizationRequired => {
                "TARGET_BOOTSTRAP_AUTHORIZATION_REQUIRED"
            }
            TargetBootstrapError::Blocked => "TARGET_BOOTSTRAP_BLOCKED",
            TargetBootstrapError::Paused | TargetBootstrapError::Cancelled => {
                "TARGET_BOOTSTRAP_UNAVAILABLE"
            }
        }
        .to_owned()
    })
}
#[tauri::command]
pub(crate) async fn target_bootstrap_status(
    control: State<'_, Arc<DesktopTargetBootstrapTermination>>,
) -> Result<TargetBootstrapView, String> {
    result(control.status().await)
}
#[tauri::command]
pub(crate) async fn target_bootstrap_cancel(
    request: TargetBootstrapCancelRequest,
    control: State<'_, Arc<DesktopTargetBootstrapTermination>>,
) -> Result<TargetBootstrapView, String> {
    if request.schema_version != 1
        || request.request_id.is_empty()
        || request.request_id.len() > 160
        || !request
            .request_id
            .bytes()
            .all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err("TARGET_BOOTSTRAP_INVALID_REQUEST".to_owned());
    }
    result(control.cancel(&request.request_id).await)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projection_is_closed_and_does_not_expose_authority_or_cloud_receipts() {
        assert_eq!(
            serde_json::to_value(TargetBootstrapView::from(
                DesktopTargetBootstrapView::Available {
                    request_id: "workflow".into(),
                    bootstrap_expires_at: "2026-11-19T12:00:00Z".into(),
                }
            ))
            .unwrap(),
            serde_json::json!({"schemaVersion":1,"kind":"available","requestId":"workflow","bootstrapExpiresAt":"2026-11-19T12:00:00Z"})
        );
        assert_eq!(
            result(Err(TargetBootstrapError::Blocked)).unwrap_err(),
            "TARGET_BOOTSTRAP_BLOCKED"
        );
        assert!(
            serde_json::from_value::<TargetBootstrapCancelRequest>(
                serde_json::json!({"schemaVersion":1,"requestId":"workflow","deviceId":"foreign"})
            )
            .is_err()
        );
    }
}
