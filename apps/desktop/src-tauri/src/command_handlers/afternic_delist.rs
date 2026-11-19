//! Strict local preview/approval intents; no credential, endpoint or execution claim enters IPC.
use crate::{native_cloud_runtime::NativeCloudCoordinator, provider_ipc::decode_provider_request};
use gooddealer_local_storage::{
    DesktopAfternicDelistApproveRequest, DesktopAfternicDelistPlan,
    DesktopAfternicDelistPreviewRequest, DesktopAfternicDelistStatusRequest, DesktopLocalHost,
};
use std::sync::Arc;
use tauri::State;
fn rejected() -> String {
    "AFTERNIC_DELIST_REJECTED".to_owned()
}

#[tauri::command]
pub(crate) async fn afternic_delist_preview(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicDelistPlan, String> {
    let request: DesktopAfternicDelistPreviewRequest =
        decode_provider_request(&request, 131_072).map_err(|_| rejected())?;
    let host = Arc::clone(host.inner());
    let fence = cloud.cancel_fence();
    tauri::async_runtime::spawn_blocking(move || {
        fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.preview_afternic_delist(admission, request)
            })
            .ok_or_else(rejected)?
            .map_err(|_| rejected())
    })
    .await
    .map_err(|_| rejected())?
}

#[tauri::command]
pub(crate) async fn afternic_delist_approve(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicDelistPlan, String> {
    let request: DesktopAfternicDelistApproveRequest =
        decode_provider_request(&request, 512).map_err(|_| rejected())?;
    if !cloud.afternic_execution_available() {
        return Err(rejected());
    }
    let host = Arc::clone(host.inner());
    let fence = cloud.cancel_fence();
    let power = cloud.power_gate();
    let epoch = power.snapshot().epoch;
    let plan = tauri::async_runtime::spawn_blocking(move || {
        let _power_commit = power.hold_write_epoch(epoch).map_err(|_| rejected())?;
        fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.approve_afternic_delist(admission, request)
            })
            .ok_or_else(rejected)?
            .map_err(|_| rejected())
    })
    .await
    .map_err(|_| rejected())??;
    cloud.wake_afternic_delist();
    Ok(plan)
}

#[tauri::command]
pub(crate) async fn afternic_delist_status(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<serde_json::Value, String> {
    let request: DesktopAfternicDelistStatusRequest =
        decode_provider_request(&request, 512).map_err(|_| rejected())?;
    let host = Arc::clone(host.inner());
    let status =
        tauri::async_runtime::spawn_blocking(move || host.read_afternic_delist_status(request))
            .await
            .map_err(|_| rejected())?
            .map_err(|_| rejected())?;
    let mut status = serde_json::to_value(status).map_err(|_| rejected())?;
    status["executionAvailable"] = serde_json::json!(cloud.afternic_execution_available());
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_ipc::decode_provider_body;
    use tauri::ipc::InvokeBody;
    #[test]
    fn delist_raw_contract_requires_explicit_nullable_selection_and_refuses_secret_fields() {
        for wire in [
            r#"{"schemaVersion":1}"#,
            r#"{"schemaVersion":1,"planRef":null,"planRef":null}"#,
            r#"{"schemaVersion":1,"planRef":null,"apiKey":"secret"}"#,
        ] {
            assert!(
                decode_provider_body::<DesktopAfternicDelistStatusRequest>(
                    &InvokeBody::Raw(wire.as_bytes().to_vec()),
                    512
                )
                .is_err()
            );
        }
        let value = decode_provider_body::<DesktopAfternicDelistStatusRequest>(
            &InvokeBody::Raw(br#"{"schemaVersion":1,"planRef":null}"#.to_vec()),
            512,
        )
        .unwrap();
        assert!(value.plan_ref.is_none());
        assert!(
            decode_provider_body::<DesktopAfternicDelistApproveRequest>(
                &InvokeBody::Raw(
                    br#"{"schemaVersion":1,"planRef":"ref","planHash":"hash","force":true}"#
                        .to_vec()
                ),
                512
            )
            .is_err()
        );
        assert!(decode_provider_body::<DesktopAfternicDelistPreviewRequest>(&InvokeBody::Raw(br#"{"schemaVersion":1,"connectionId":"id","domains":[],"url":"https://other"}"#.to_vec()), 131_072).is_err());
    }
}
