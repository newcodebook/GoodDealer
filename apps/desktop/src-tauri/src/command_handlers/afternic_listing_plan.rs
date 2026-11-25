//! Bounded customer intents for a plan that can include an Afternic ownership recheck.
use crate::{native_cloud_runtime::NativeCloudCoordinator, provider_ipc::decode_provider_request};
use gooddealer_local_storage::{
    DesktopAfternicListingPlan, DesktopAfternicListingPlanApproveRequest,
    DesktopAfternicListingPlanPreviewRequest, DesktopAfternicListingPlanStatus,
    DesktopAfternicListingPlanStatusRequest, DesktopLocalHost,
};
use std::sync::Arc;
use tauri::State;

fn rejected() -> String {
    "AFTERNIC_LISTING_PLAN_REJECTED".to_owned()
}

#[tauri::command]
pub(crate) async fn afternic_listing_plan_preview(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicListingPlan, String> {
    let request: DesktopAfternicListingPlanPreviewRequest =
        decode_provider_request(&request, 262_144).map_err(|_| rejected())?;
    let host = Arc::clone(host.inner());
    let fence = cloud.cancel_fence();
    tauri::async_runtime::spawn_blocking(move || {
        fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.preview_afternic_listing_plan(admission, request)
            })
            .ok_or_else(rejected)?
            .map_err(|_| rejected())
    })
    .await
    .map_err(|_| rejected())?
}

#[tauri::command]
pub(crate) async fn afternic_listing_plan_approve(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicListingPlan, String> {
    let request: DesktopAfternicListingPlanApproveRequest =
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
                host.approve_afternic_listing_plan(admission, request)
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
pub(crate) async fn afternic_listing_plan_status(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopAfternicListingPlanStatus, String> {
    let request: DesktopAfternicListingPlanStatusRequest =
        decode_provider_request(&request, 512).map_err(|_| rejected())?;
    let host = Arc::clone(host.inner());
    let mut status = tauri::async_runtime::spawn_blocking(move || {
        host.read_afternic_listing_plan_status(request)
    })
    .await
    .map_err(|_| rejected())?
    .map_err(|_| rejected())?;
    status.execution_available = cloud.afternic_execution_available();
    status.ownership_review_execution_available &= status.execution_available;
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_ipc::decode_provider_body;
    use tauri::ipc::InvokeBody;

    #[test]
    fn preview_only_decodes_fixed_intents_through_raw_ipc() {
        let domain = r#"{"domain":"wecin.com"}"#;
        let body = |item| {
            InvokeBody::Raw(format!(
            r#"{{"schemaVersion":2,"connectionId":"a0000000-0000-4000-8000-000000000001","action":"reactivate_ownership_review","items":[{item}]}}"#,
        ).into_bytes())
        };
        assert!(
            decode_provider_body::<DesktopAfternicListingPlanPreviewRequest>(
                &body(domain),
                262_144
            )
            .is_ok()
        );
        for extra in [
            r#"{"domain":"wecin.com","providerStatus":"OWNERSHIP_REVIEW"}"#,
            r#"{"domain":"wecin.com","relistMode":"REACTIVATE"}"#,
            r#"{"domain":"wecin.com","apiSecret":"secret"}"#,
        ] {
            assert!(
                decode_provider_body::<DesktopAfternicListingPlanPreviewRequest>(
                    &body(extra),
                    262_144
                )
                .is_err()
            );
        }
    }
}
