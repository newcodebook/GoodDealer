//! Renderer confirms a displayed workflow; all installation authority stays in Native.
use crate::target_bootstrap_termination::TargetBootstrapError;
use crate::target_installation::DesktopTargetInstallation;
use gooddealer_local_storage::{
    DesktopTargetBootstrapTerminalStatus, DesktopTargetInstallationNewWorkflow,
    DesktopTargetInstallationPhase, DesktopTargetInstallationView,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TargetInstallationStartRequest {
    schema_version: u8,
    request_id: String,
}
impl TargetInstallationStartRequest {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || self.request_id.is_empty()
            || self.request_id.len() > 160
            || !self
                .request_id
                .bytes()
                .all(|byte| (0x21..=0x7e).contains(&byte))
        {
            return Err("TARGET_INSTALLATION_INVALID_REQUEST".to_owned());
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum TargetInstallationView {
    Idle {
        schema_version: u8,
    },
    Running {
        schema_version: u8,
        request_id: String,
        phase: &'static str,
    },
    Completed {
        schema_version: u8,
        request_id: String,
    },
    Stopped {
        schema_version: u8,
        request_id: String,
        status: &'static str,
        new_workflow: &'static str,
    },
    ExistingReplica {
        schema_version: u8,
        request_id: String,
    },
}
impl From<DesktopTargetInstallationView> for TargetInstallationView {
    fn from(view: DesktopTargetInstallationView) -> Self {
        match view {
            DesktopTargetInstallationView::Idle => Self::Idle { schema_version: 1 },
            DesktopTargetInstallationView::Running { request_id, phase } => Self::Running {
                schema_version: 1,
                request_id,
                phase: match phase {
                    DesktopTargetInstallationPhase::Claiming => "claiming",
                    DesktopTargetInstallationPhase::Downloading => "downloading",
                    DesktopTargetInstallationPhase::Installing => "installing",
                    DesktopTargetInstallationPhase::Verifying => "verifying",
                    DesktopTargetInstallationPhase::Activating => "activating",
                    DesktopTargetInstallationPhase::Authorizing => "authorizing",
                },
            },
            DesktopTargetInstallationView::Completed { request_id } => Self::Completed {
                schema_version: 1,
                request_id,
            },
            DesktopTargetInstallationView::ExistingReplica { request_id } => {
                Self::ExistingReplica {
                    schema_version: 1,
                    request_id,
                }
            }
            DesktopTargetInstallationView::Stopped {
                request_id,
                status,
                new_workflow,
            } => Self::Stopped {
                schema_version: 1,
                request_id,
                status: match status {
                    DesktopTargetBootstrapTerminalStatus::Cancelled => "cancelled",
                    DesktopTargetBootstrapTerminalStatus::Failed => "failed",
                    DesktopTargetBootstrapTerminalStatus::Completed => "completed",
                },
                new_workflow: match new_workflow {
                    DesktopTargetInstallationNewWorkflow::Allowed => "allowed",
                    DesktopTargetInstallationNewWorkflow::RequiresRecovery => "requires_recovery",
                    DesktopTargetInstallationNewWorkflow::AwaitingTerminal => "awaiting_terminal",
                    DesktopTargetInstallationNewWorkflow::AuthorizationChanged => {
                        "authorization_changed"
                    }
                    DesktopTargetInstallationNewWorkflow::HistoryFull => "history_full",
                },
            },
        }
    }
}
fn result(
    view: Result<DesktopTargetInstallationView, TargetBootstrapError>,
) -> Result<TargetInstallationView, String> {
    view.map(TargetInstallationView::from).map_err(|error| {
        match error {
            TargetBootstrapError::Retryable => "TARGET_INSTALLATION_RETRY_LATER",
            TargetBootstrapError::AuthorizationRequired => {
                "TARGET_INSTALLATION_AUTHORIZATION_REQUIRED"
            }
            TargetBootstrapError::Blocked => "TARGET_INSTALLATION_BLOCKED",
            TargetBootstrapError::Paused | TargetBootstrapError::Cancelled => {
                "TARGET_INSTALLATION_UNAVAILABLE"
            }
        }
        .to_owned()
    })
}
#[tauri::command]
pub(crate) async fn target_installation_status(
    control: State<'_, Arc<DesktopTargetInstallation>>,
) -> Result<TargetInstallationView, String> {
    result(control.status().await)
}
#[tauri::command]
pub(crate) async fn target_installation_start(
    request: TargetInstallationStartRequest,
    control: State<'_, Arc<DesktopTargetInstallation>>,
) -> Result<TargetInstallationView, String> {
    request.validate()?;
    result(control.start(&request.request_id).await)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn intent_and_projection_are_bounded_and_closed() {
        for request_id in ["", "a b", &"x".repeat(161)] {
            assert!(
                TargetInstallationStartRequest {
                    schema_version: 1,
                    request_id: request_id.into()
                }
                .validate()
                .is_err()
            );
        }
        for wire in [
            r#"{"schemaVersion":1,"requestId":"w","path":"/tmp/db"}"#,
            r#"{"schemaVersion":1,"requestId":"w","requestId":"other"}"#,
        ] {
            assert!(serde_json::from_str::<TargetInstallationStartRequest>(wire).is_err());
        }
        assert_eq!(
            serde_json::to_value(TargetInstallationView::from(
                DesktopTargetInstallationView::Running {
                    request_id: "w".into(),
                    phase: DesktopTargetInstallationPhase::Authorizing,
                }
            ))
            .unwrap(),
            serde_json::json!({"schemaVersion":1,"kind":"running","requestId":"w","phase":"authorizing"})
        );
        assert_eq!(
            result(Err(TargetBootstrapError::Blocked)).unwrap_err(),
            "TARGET_INSTALLATION_BLOCKED"
        );
    }
    #[test]
    fn stopped_projection_reports_only_the_closed_new_workflow_decision() {
        for (new_workflow, wire) in [
            (DesktopTargetInstallationNewWorkflow::Allowed, "allowed"),
            (
                DesktopTargetInstallationNewWorkflow::RequiresRecovery,
                "requires_recovery",
            ),
            (
                DesktopTargetInstallationNewWorkflow::AwaitingTerminal,
                "awaiting_terminal",
            ),
            (
                DesktopTargetInstallationNewWorkflow::AuthorizationChanged,
                "authorization_changed",
            ),
            (
                DesktopTargetInstallationNewWorkflow::HistoryFull,
                "history_full",
            ),
        ] {
            let view = TargetInstallationView::from(DesktopTargetInstallationView::Stopped {
                request_id: "previous".into(),
                status: DesktopTargetBootstrapTerminalStatus::Cancelled,
                new_workflow,
            });
            assert_eq!(
                serde_json::to_value(view).unwrap(),
                serde_json::json!({
                    "schemaVersion": 1, "kind": "stopped", "requestId": "previous",
                    "status": "cancelled", "newWorkflow": wire
                })
            );
        }
    }
}
