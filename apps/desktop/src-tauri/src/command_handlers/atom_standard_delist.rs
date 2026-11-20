//! Customer command surface for one exact Atom Standard removal batch.
use crate::{native_cloud_runtime::NativeCloudCoordinator, provider_ipc::decode_provider_request};
use gooddealer_local_storage::{
    DesktopAtomStandardDelistApproveRequest, DesktopAtomStandardDelistPreview,
    DesktopAtomStandardDelistPreviewRequest, DesktopAtomStandardDelistStatus,
    DesktopAtomStandardDelistStatusRequest, DesktopLocalHost,
};
use std::sync::Arc;
use tauri::State;

const REJECTED: &str = "ATOM_STANDARD_DELIST_REJECTED";

#[tauri::command]
pub(crate) async fn atom_standard_delist_preview(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAtomStandardDelistPreview, &'static str> {
    let request: DesktopAtomStandardDelistPreviewRequest =
        decode_provider_request(&request, 196_608).map_err(|_| REJECTED)?;
    let host = Arc::clone(host.inner());
    let fence = cloud.cancel_fence();
    tauri::async_runtime::spawn_blocking(move || {
        fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.preview_atom_standard_delist(&admission, &request)
            })
            .ok_or(REJECTED)?
            .map_err(|_| REJECTED)
    })
    .await
    .map_err(|_| REJECTED)?
}

#[tauri::command]
pub(crate) async fn atom_standard_delist_approve(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<String, &'static str> {
    let request: DesktopAtomStandardDelistApproveRequest =
        decode_provider_request(&request, 512).map_err(|_| REJECTED)?;
    if !cloud.atom_standard_delist_execution_available() {
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
                host.approve_atom_standard_delist(&admission, &request)
            })
            .ok_or(REJECTED)?
            .map_err(|_| REJECTED)
    })
    .await
    .map_err(|_| REJECTED)??;
    cloud.wake_atom_standard_delist();
    Ok(approval)
}

#[tauri::command]
pub(crate) async fn atom_standard_delist_status(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAtomStandardDelistStatus, &'static str> {
    let request: DesktopAtomStandardDelistStatusRequest =
        decode_provider_request(&request, 512).map_err(|_| REJECTED)?;
    let host = Arc::clone(host.inner());
    let mut status = tauri::async_runtime::spawn_blocking(move || {
        host.read_atom_standard_delist_status(&request)
    })
    .await
    .map_err(|_| REJECTED)?
    .map_err(|_| REJECTED)?;
    status.execution_available &= cloud.atom_standard_delist_execution_available();
    Ok(status)
}

#[cfg(test)]
mod tests {
    use crate::provider_ipc::decode_provider_body;
    use gooddealer_local_storage::{
        DesktopAtomStandardDelistApproveRequest, DesktopAtomStandardDelistPreviewRequest,
    };
    use tauri::ipc::InvokeBody;

    #[test]
    fn atom_standard_delist_ipc_refuses_credentials_and_additional_instructions() {
        let decode = |body: &[u8]| {
            decode_provider_body::<DesktopAtomStandardDelistPreviewRequest>(
                &InvokeBody::Raw(body.to_vec()),
                196_608,
            )
            .is_ok()
        };
        assert!(decode(br#"{"schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domains":["one.test"]}"#));
        assert!(!decode(br#"{"schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domains":["one.test"],"apiToken":"refuse"}"#));
        assert!(!decode(br#"{"schemaVersion":1,"connectionId":"11111111-1111-4111-a111-111111111111","domains":["one.test"],"listingType":"premium"}"#));
        assert!(decode_provider_body::<DesktopAtomStandardDelistApproveRequest>(
            &InvokeBody::Raw(br#"{"schemaVersion":1,"planId":"11111111-1111-4111-a111-111111111111","planHash":"a","domains":["one.test"]}"#.to_vec()),
            512,
        ).is_err());
    }
}
