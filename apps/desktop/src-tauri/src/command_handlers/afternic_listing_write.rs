//! Strict local preview/approval intents; no credential, endpoint or execution claim enters IPC.
use crate::{native_cloud_runtime::NativeCloudCoordinator, provider_ipc::decode_provider_request};
use gooddealer_local_storage::{
    DesktopAfternicListingWriteApproveRequest, DesktopAfternicListingWritePlan,
    DesktopAfternicListingWritePreviewRequest, DesktopAfternicListingWriteStatus,
    DesktopAfternicListingWriteStatusRequest, DesktopLocalHost,
};
use std::sync::Arc;
use tauri::State;
fn rejected() -> String {
    "AFTERNIC_LISTING_WRITE_REJECTED".to_owned()
}

#[tauri::command]
pub(crate) async fn afternic_listing_write_preview(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicListingWritePlan, String> {
    let request: DesktopAfternicListingWritePreviewRequest =
        decode_provider_request(&request, 262_144).map_err(|_| rejected())?;
    let host = Arc::clone(host.inner());
    let fence = cloud.cancel_fence();
    tauri::async_runtime::spawn_blocking(move || {
        fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.preview_afternic_listing_write(admission, request)
            })
            .ok_or_else(rejected)?
            .map_err(|_| rejected())
    })
    .await
    .map_err(|_| rejected())?
}

#[tauri::command]
pub(crate) async fn afternic_listing_write_approve(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicListingWritePlan, String> {
    let request: DesktopAfternicListingWriteApproveRequest =
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
                host.approve_afternic_listing_write(admission, request)
            })
            .ok_or_else(rejected)?
            .map_err(|_| rejected())
    })
    .await
    .map_err(|_| rejected())??;
    cloud.wake_afternic_listing_write();
    Ok(plan)
}

#[tauri::command]
pub(crate) async fn afternic_listing_write_status(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicListingWriteStatus, String> {
    let request: DesktopAfternicListingWriteStatusRequest =
        decode_provider_request(&request, 512).map_err(|_| rejected())?;
    let host = Arc::clone(host.inner());
    let mut status = tauri::async_runtime::spawn_blocking(move || {
        host.read_afternic_listing_write_status(request)
    })
    .await
    .map_err(|_| rejected())?
    .map_err(|_| rejected())?;
    status.execution_available = cloud.afternic_execution_available();
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_ipc::decode_provider_body;
    use tauri::ipc::InvokeBody;
    #[test]
    fn listing_write_raw_contract_requires_explicit_nullable_selection_and_refuses_secret_fields() {
        for wire in [
            r#"{"schemaVersion":1}"#,
            r#"{"schemaVersion":1,"planRef":null,"planRef":null}"#,
            r#"{"schemaVersion":1,"planRef":null,"apiKey":"secret"}"#,
        ] {
            assert!(
                decode_provider_body::<DesktopAfternicListingWriteStatusRequest>(
                    &InvokeBody::Raw(wire.as_bytes().to_vec()),
                    512
                )
                .is_err()
            );
        }
        let value = decode_provider_body::<DesktopAfternicListingWriteStatusRequest>(
            &InvokeBody::Raw(br#"{"schemaVersion":1,"planRef":null}"#.to_vec()),
            512,
        )
        .unwrap();
        assert!(value.plan_ref.is_none());
        assert!(
            decode_provider_body::<DesktopAfternicListingWriteApproveRequest>(
                &InvokeBody::Raw(
                    br#"{"schemaVersion":1,"planRef":"ref","planHash":"hash","force":true}"#
                        .to_vec()
                ),
                512
            )
            .is_err()
        );
        assert!(decode_provider_body::<DesktopAfternicListingWritePreviewRequest>(&InvokeBody::Raw(br#"{"schemaVersion":1,"connectionId":"id","domains":[],"url":"https://other"}"#.to_vec()), 262_144).is_err());
    }
    #[test]
    fn listing_write_raw_contract_preserves_selected_keys_and_refuses_secret_expansion() {
        let wire = br#"{"schemaVersion":1,"connectionId":"id","action":"update","items":[{"domain":"example.com","patch":{"buynowPriceMicroUsd":0,"hidden":false}}]}"#;
        assert!(
            decode_provider_body::<DesktopAfternicListingWritePreviewRequest>(
                &InvokeBody::Raw(wire.to_vec()),
                262_144
            )
            .is_ok()
        );
        for wire in [
            r#"{"schemaVersion":1,"connectionId":"id","action":"remove","items":[]}"#,
            r#"{"schemaVersion":1,"connectionId":"id","action":"update","items":[{"domain":"example.com","patch":{"hidden":null}}]}"#,
            r#"{"schemaVersion":1,"connectionId":"id","action":"create","items":[{"domain":"example.com","values":{"buynowPriceMicroUsd":0,"floorPriceMicroUsd":0,"minbidPriceMicroUsd":20000000}}]}"#,
            r#"{"schemaVersion":1,"connectionId":"id","action":"update","items":[{"domain":"example.com","patch":{"hidden":false,"apiSecret":"forbidden"}}]}"#,
            r#"{"schemaVersion":1,"connectionId":"id","action":"update","items":[{"domain":"example.com","patch":{"hidden":true,"hidden":false}}]}"#,
        ] {
            assert!(
                decode_provider_body::<DesktopAfternicListingWritePreviewRequest>(
                    &InvokeBody::Raw(wire.as_bytes().to_vec()),
                    262_144
                )
                .is_err()
            );
        }
        assert!(
            decode_provider_body::<DesktopAfternicListingWritePreviewRequest>(
                &InvokeBody::Json(serde_json::json!({})),
                262_144
            )
            .is_err()
        );
    }
}
