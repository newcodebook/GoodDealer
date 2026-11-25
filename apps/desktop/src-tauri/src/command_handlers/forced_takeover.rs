//! Bounded preview/intent references only; credentials and workflow operations stay in Native.
use crate::forced_takeover::DesktopForcedTakeover;
use crate::oauth_runtime::DesktopOAuthRuntime;
use crate::target_bootstrap_termination::TargetBootstrapError;
use gooddealer_local_storage::{
    DesktopForcedTakeoverPreview, DesktopForcedTakeoverPreviewReason,
    DesktopForcedTakeoverStoppedReason, DesktopForcedTakeoverView,
    DesktopTargetBootstrapTerminalStatus,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ForcedTakeoverConfirmRequest {
    schema_version: u8,
    preview_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ForcedTakeoverCancelRequest {
    schema_version: u8,
    intent_id: String,
}
fn request_body<T: serde::de::DeserializeOwned>(
    body: &tauri::ipc::InvokeBody,
) -> Result<T, String> {
    let tauri::ipc::InvokeBody::Raw(wire) = body else {
        return Err("FORCED_TAKEOVER_INVALID_REQUEST".into());
    };
    if wire.is_empty() || wire.len() > 512 {
        return Err("FORCED_TAKEOVER_INVALID_REQUEST".into());
    }
    serde_json::from_slice(wire).map_err(|_| "FORCED_TAKEOVER_INVALID_REQUEST".into())
}
fn validate(version: u8, reference: &str) -> Result<(), String> {
    if version != 1
        || reference.is_empty()
        || reference.len() > 160
        || !reference.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err("FORCED_TAKEOVER_INVALID_REQUEST".into());
    }
    Ok(())
}
#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ForcedTakeoverPreview {
    Available {
        schema_version: u8,
        preview_id: String,
        source_device_id: String,
        source_lease_epoch: u64,
        earliest_takeover_at: String,
        evaluated_at: String,
    },
    Unavailable {
        schema_version: u8,
        reason: &'static str,
    },
}
impl From<DesktopForcedTakeoverPreview> for ForcedTakeoverPreview {
    fn from(value: DesktopForcedTakeoverPreview) -> Self {
        match value {
            DesktopForcedTakeoverPreview::Available {
                preview_id,
                source_device_id,
                source_lease_epoch,
                earliest_takeover_at,
                evaluated_at,
            } => Self::Available {
                schema_version: 1,
                preview_id,
                source_device_id,
                source_lease_epoch,
                earliest_takeover_at,
                evaluated_at,
            },
            DesktopForcedTakeoverPreview::Unavailable { reason } => Self::Unavailable {
                schema_version: 1,
                reason: match reason {
                    DesktopForcedTakeoverPreviewReason::SourceUnavailable => "source_unavailable",
                    DesktopForcedTakeoverPreviewReason::SwitchInProgress => "switch_in_progress",
                    DesktopForcedTakeoverPreviewReason::TargetNotStandby => "target_not_standby",
                    DesktopForcedTakeoverPreviewReason::ReauthenticationRequired => {
                        "reauthentication_required"
                    }
                    DesktopForcedTakeoverPreviewReason::LocalRecoveryRequired => {
                        "local_recovery_required"
                    }
                    DesktopForcedTakeoverPreviewReason::HistoryFull => "history_full",
                },
            },
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ForcedTakeoverView {
    Idle {
        schema_version: u8,
    },
    Requesting {
        schema_version: u8,
        intent_id: String,
    },
    CancelledBeforeRequest {
        schema_version: u8,
        intent_id: String,
    },
    Waiting {
        schema_version: u8,
        intent_id: String,
        request_id: String,
        source_device_id: String,
        earliest_takeover_at: String,
        evaluated_at: String,
    },
    Cancelling {
        schema_version: u8,
        intent_id: String,
        request_id: Option<String>,
    },
    Installing {
        schema_version: u8,
        intent_id: String,
        request_id: String,
    },
    Finished {
        schema_version: u8,
        intent_id: String,
        request_id: String,
        status: &'static str,
    },
    Stopped {
        schema_version: u8,
        intent_id: String,
        reason: &'static str,
        can_cancel: bool,
    },
}
impl From<DesktopForcedTakeoverView> for ForcedTakeoverView {
    fn from(value: DesktopForcedTakeoverView) -> Self {
        match value {
            DesktopForcedTakeoverView::Idle => Self::Idle { schema_version: 1 },
            DesktopForcedTakeoverView::Requesting { intent_id } => Self::Requesting {
                schema_version: 1,
                intent_id,
            },
            DesktopForcedTakeoverView::CancelledBeforeRequest { intent_id } => {
                Self::CancelledBeforeRequest {
                    schema_version: 1,
                    intent_id,
                }
            }
            DesktopForcedTakeoverView::Waiting {
                intent_id,
                request_id,
                source_device_id,
                earliest_takeover_at,
                evaluated_at,
            } => Self::Waiting {
                schema_version: 1,
                intent_id,
                request_id,
                source_device_id,
                earliest_takeover_at,
                evaluated_at,
            },
            DesktopForcedTakeoverView::Cancelling {
                intent_id,
                request_id,
            } => Self::Cancelling {
                schema_version: 1,
                intent_id,
                request_id,
            },
            DesktopForcedTakeoverView::Installing {
                intent_id,
                request_id,
            } => Self::Installing {
                schema_version: 1,
                intent_id,
                request_id,
            },
            DesktopForcedTakeoverView::Finished {
                intent_id,
                request_id,
                status,
            } => Self::Finished {
                schema_version: 1,
                intent_id,
                request_id,
                status: match status {
                    DesktopTargetBootstrapTerminalStatus::Cancelled => "cancelled",
                    DesktopTargetBootstrapTerminalStatus::Failed => "failed",
                    DesktopTargetBootstrapTerminalStatus::Completed => "completed",
                },
            },
            DesktopForcedTakeoverView::Stopped {
                intent_id,
                reason,
                can_cancel,
            } => Self::Stopped {
                schema_version: 1,
                intent_id,
                can_cancel,
                reason: match reason {
                    DesktopForcedTakeoverStoppedReason::ReauthenticationRequired => {
                        "reauthentication_required"
                    }
                    DesktopForcedTakeoverStoppedReason::SourceChanged => "source_changed",
                    DesktopForcedTakeoverStoppedReason::AuthorizationChanged => {
                        "authorization_changed"
                    }
                    DesktopForcedTakeoverStoppedReason::LocalRecoveryRequired => {
                        "local_recovery_required"
                    }
                    DesktopForcedTakeoverStoppedReason::HistoryFull => "history_full",
                    DesktopForcedTakeoverStoppedReason::RequestRejected => "request_rejected",
                },
            },
        }
    }
}
fn failure(error: TargetBootstrapError) -> String {
    match error {
        TargetBootstrapError::AuthorizationRequired => "FORCED_TAKEOVER_AUTHORIZATION_REQUIRED",
        TargetBootstrapError::Retryable => "FORCED_TAKEOVER_RETRYABLE",
        TargetBootstrapError::Blocked => "FORCED_TAKEOVER_BLOCKED",
        TargetBootstrapError::Paused | TargetBootstrapError::Cancelled => {
            "FORCED_TAKEOVER_UNAVAILABLE"
        }
    }
    .into()
}
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn forced_takeover_reauthenticate(
    app: AppHandle,
    runtime: State<'_, Arc<DesktopOAuthRuntime>>,
) -> Result<(), String> {
    runtime
        .inner()
        .begin_forced_takeover_reauthentication(app)
        .map_err(|_| "FORCED_TAKEOVER_AUTHORIZATION_REQUIRED".into())
}
#[tauri::command]
pub(crate) async fn forced_takeover_preview(
    control: State<'_, Arc<DesktopForcedTakeover>>,
    runtime: State<'_, Arc<DesktopOAuthRuntime>>,
) -> Result<ForcedTakeoverPreview, String> {
    control
        .preview(runtime.inner())
        .await
        .map(Into::into)
        .map_err(failure)
}
#[tauri::command]
pub(crate) async fn forced_takeover_confirm(
    request: tauri::ipc::Request<'_>,
    control: State<'_, Arc<DesktopForcedTakeover>>,
    runtime: State<'_, Arc<DesktopOAuthRuntime>>,
) -> Result<ForcedTakeoverView, String> {
    let request: ForcedTakeoverConfirmRequest = request_body(request.body())?;
    validate(request.schema_version, &request.preview_id)?;
    control
        .confirm(runtime.inner(), &request.preview_id)
        .await
        .map(Into::into)
        .map_err(failure)
}
#[tauri::command]
pub(crate) async fn forced_takeover_status(
    control: State<'_, Arc<DesktopForcedTakeover>>,
) -> Result<ForcedTakeoverView, String> {
    control.status().await.map(Into::into).map_err(failure)
}
#[tauri::command]
pub(crate) async fn forced_takeover_cancel(
    request: tauri::ipc::Request<'_>,
    control: State<'_, Arc<DesktopForcedTakeover>>,
) -> Result<ForcedTakeoverView, String> {
    let request: ForcedTakeoverCancelRequest = request_body(request.body())?;
    validate(request.schema_version, &request.intent_id)?;
    control
        .cancel(&request.intent_id)
        .await
        .map(Into::into)
        .map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_references_reject_selectors_unknown_fields_and_invalid_identifiers() {
        for body in [
            r#"{"schemaVersion":1,"previewId":"p","sourceLeaseEpoch":2}"#,
            r#"{"schemaVersion":1,"previewId":"p","token":"canary"}"#,
            r#"{"schemaVersion":1,"intentId":"i"}"#,
        ] {
            assert!(serde_json::from_str::<ForcedTakeoverConfirmRequest>(body).is_err());
        }
        for reference in ["", "a b", "\n", &"a".repeat(161)] {
            assert!(validate(1, reference).is_err());
        }
        assert!(validate(2, "preview").is_err());
        assert!(validate(1, "preview").is_ok());
    }
    #[test]
    fn renderer_raw_intents_are_bounded_and_decoded_without_json_argument_wrapping() {
        use tauri::ipc::InvokeBody;
        let confirm: ForcedTakeoverConfirmRequest = request_body(&InvokeBody::Raw(
            br#"{"schemaVersion":1,"previewId":"original"}"#.to_vec(),
        ))
        .unwrap();
        assert_eq!(confirm.preview_id, "original");
        let cancel: ForcedTakeoverCancelRequest = request_body(&InvokeBody::Raw(
            br#"{"schemaVersion":1,"intentId":"original"}"#.to_vec(),
        ))
        .unwrap();
        assert_eq!(cancel.intent_id, "original");
        for body in [
            InvokeBody::Json(
                serde_json::json!({"request":{"schemaVersion":1,"previewId":"original"}}),
            ),
            InvokeBody::Raw(Vec::new()),
            InvokeBody::Raw(vec![b' '; 513]),
            InvokeBody::Raw(br#"{"schemaVersion":1,"previewId":"a","previewId":"b"}"#.to_vec()),
        ] {
            assert!(request_body::<ForcedTakeoverConfirmRequest>(&body).is_err());
        }
    }
    #[test]
    fn local_cancellation_without_cloud_request_has_no_fabricated_workflow_id() {
        let view = ForcedTakeoverView::from(DesktopForcedTakeoverView::CancelledBeforeRequest {
            intent_id: "original".into(),
        });
        assert_eq!(
            serde_json::to_value(view).unwrap(),
            serde_json::json!({
                "schemaVersion": 1, "kind": "cancelled_before_request", "intentId": "original"
            })
        );
        let view = ForcedTakeoverView::from(DesktopForcedTakeoverView::Cancelling {
            intent_id: "original".into(),
            request_id: None,
        });
        assert_eq!(
            serde_json::to_value(view).unwrap(),
            serde_json::json!({
                "schemaVersion": 1, "kind": "cancelling", "intentId": "original", "requestId": null
            })
        );
    }
    #[test]
    fn stopped_projection_preserves_the_host_cancel_decision() {
        for can_cancel in [false, true] {
            let view = ForcedTakeoverView::from(DesktopForcedTakeoverView::Stopped {
                intent_id: "original".into(),
                reason: DesktopForcedTakeoverStoppedReason::LocalRecoveryRequired,
                can_cancel,
            });
            assert_eq!(
                serde_json::to_value(view).unwrap(),
                serde_json::json!({
                    "schemaVersion": 1, "kind": "stopped", "intentId": "original", "reason": "local_recovery_required", "canCancel": can_cancel
                })
            );
        }
    }
}
