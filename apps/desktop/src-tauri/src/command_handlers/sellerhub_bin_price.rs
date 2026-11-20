//! Customer preview, approval and readback for the exact `SellerHub` BIN price operation.
use crate::{native_cloud_runtime::NativeCloudCoordinator, provider_ipc::decode_provider_request};
use gooddealer_local_storage::{
    DesktopLocalHost, DesktopSellerHubBinApproval, DesktopSellerHubBinApproveRequest,
    DesktopSellerHubBinPlan, DesktopSellerHubBinPreviewRequest, DesktopSellerHubBinStatus,
    DesktopSellerHubBinStatusRequest,
};
use std::sync::Arc;
use tauri::State;

const REJECTED: &str = "SELLERHUB_BIN_PRICE_REJECTED";

#[tauri::command]
pub(crate) async fn sellerhub_bin_price_preview(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopSellerHubBinPlan, &'static str> {
    let request: DesktopSellerHubBinPreviewRequest =
        decode_provider_request(&request, 196_608).map_err(|_| REJECTED)?;
    let host = Arc::clone(host.inner());
    let fence = cloud.cancel_fence();
    tauri::async_runtime::spawn_blocking(move || {
        fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.preview_sellerhub_bin_price(&admission, &request)
            })
            .ok_or(REJECTED)?
            .map_err(|_| REJECTED)
    })
    .await
    .map_err(|_| REJECTED)?
}

#[tauri::command]
pub(crate) async fn sellerhub_bin_price_approve(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopSellerHubBinApproval, &'static str> {
    let request: DesktopSellerHubBinApproveRequest =
        decode_provider_request(&request, 512).map_err(|_| REJECTED)?;
    if !cloud.sellerhub_bin_execution_available() {
        return Err(REJECTED);
    }
    let host = Arc::clone(host.inner());
    let fence = cloud.cancel_fence();
    let power = cloud.power_gate();
    let epoch = power.snapshot().epoch;
    let approval = tauri::async_runtime::spawn_blocking(move || {
        let _power = power.hold_write_epoch(epoch).map_err(|_| REJECTED)?;
        fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.approve_sellerhub_bin_price(&admission, &request)
            })
            .ok_or(REJECTED)?
            .map_err(|_| REJECTED)
    })
    .await
    .map_err(|_| REJECTED)??;
    cloud.wake_sellerhub_bin();
    Ok(approval)
}

#[tauri::command]
pub(crate) async fn sellerhub_bin_price_status(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopSellerHubBinStatus, &'static str> {
    let request: DesktopSellerHubBinStatusRequest =
        decode_provider_request(&request, 512).map_err(|_| REJECTED)?;
    let host = Arc::clone(host.inner());
    let mut status =
        tauri::async_runtime::spawn_blocking(move || host.read_sellerhub_bin_status(&request))
            .await
            .map_err(|_| REJECTED)?
            .map_err(|_| REJECTED)?;
    status.execution_available = status.write_qualified
        && status.write_entitled
        && cloud.sellerhub_bin_execution_available();
    Ok(status)
}

#[cfg(test)]
mod tests {
    use crate::provider_ipc::decode_provider_body;
    use gooddealer_local_storage::{
        DesktopSellerHubBinApproveRequest, DesktopSellerHubBinPreviewRequest,
    };
    use tauri::ipc::InvokeBody;

    #[test]
    fn rejects_credentials_and_extra_write_instructions_at_ipc() {
        let preview = |item: &str| {
            decode_provider_body::<DesktopSellerHubBinPreviewRequest>(&InvokeBody::Raw(format!(
                r#"{{"schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","items":[{item}]}}"#,
            ).into_bytes()), 196_608).is_ok()
        };
        assert!(preview(r#"{"domain":"wecin.com","priceCents":125050}"#));
        for forbidden in [
            r#"{"domain":"wecin.com","priceCents":125050,"binPriceEnabled":false}"#,
            r#"{"domain":"wecin.com","priceCents":125050,"apiSecret":"refuse"}"#,
            r#"{"domain":"wecin.com","priceCents":125050,"priceCents":125050}"#,
            r#"{"domain":"wecin.com","priceCents":1250.50}"#,
        ] {
            assert!(!preview(forbidden));
        }
        assert!(decode_provider_body::<DesktopSellerHubBinApproveRequest>(
            &InvokeBody::Raw(br#"{"schemaVersion":1,"planId":"11111111-1111-4111-a111-111111111111","planHash":"a","priceCents":4000}"#.to_vec()),
            512,
        ).is_err());
    }
}
