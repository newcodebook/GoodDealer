//! Thin Tauri adapters for the single Desktop local-host aggregate.
pub(crate) mod afternic;
pub(crate) mod afternic_delist;
pub(crate) mod forced_takeover;
pub(crate) mod target_bootstrap;
pub(crate) mod target_installation;

use std::sync::Arc;

use gooddealer_local_storage::{
    AssetLibraryReadSnapshot, BatchOperationsReadSnapshot, DesktopAssetLibraryReadRequest,
    DesktopBackupError, DesktopBackupExportStatus, DesktopBackupRestoreStatus,
    DesktopBatchOperationsReadRequest, DesktopCloudflareConnectionCreateRequest,
    DesktopCloudflareConnectionCreated, DesktopCloudflareObservationReadRequest,
    DesktopConflictCenterView, DesktopConflictResolutionReceipt, DesktopConflictResolveRequest,
    DesktopDeviceLease, DesktopDeviceSwitchRejection, DesktopDeviceSwitchStatus,
    DesktopDnsHealthReadRequest, DesktopDomainAssetCreateRequest, DesktopDomainAssetDeleteRequest,
    DesktopDomainAssetEditRequest, DesktopDomainAssetProviderBindingReceipt,
    DesktopDomainAssetProviderBindingRequest, DesktopDomainDetailReadRequest,
    DesktopHistoryReadRequest, DesktopLocalBusinessStatus, DesktopLocalHost,
    DesktopManualTasksReadRequest, DesktopRenewalsReadRequest, DesktopSalesReadRequest,
    DesktopStorageRepairReceipt, DesktopStorageRepairRequest, DesktopSyncSnapshotView,
    DesktopVerifiedBackupArtifact, DnsHealthReadSnapshot, DomainAssetMutationReceipt,
    DomainDetailReadSnapshot, HistoryReadSnapshot, ManualTasksReadSnapshot, RenewalsReadSnapshot,
    SalesReadSnapshot, SettingsReadSnapshot,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::backup_ipc::bounded_request_wire;
use crate::device_switch_drain::{DesktopDeviceSwitch, DeviceSwitchError, DeviceSwitchStep};
use crate::native_cloud_runtime::NativeCloudCoordinator;
use crate::provider_ipc::decode_provider_request;
use crate::provider_lane::{
    ProviderOperation, ProviderStatus, ProviderSubmission, RetirementAction,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudflareConnectionPurgeRequest {
    schema_version: u8,
    connection_id: String,
    action: RetirementAction,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudflareConnectionActivateRequest {
    schema_version: u8,
    connection_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudflareConnectionRevokeRequest {
    schema_version: u8,
    connection_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudflareZoneObserveRequest {
    schema_version: u8,
    connection_id: String,
    entity_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudflareObservationReadRequest {
    schema_version: u8,
    entity_id: String,
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_business_status(
    host: State<'_, Arc<DesktopLocalHost>>,
) -> DesktopLocalBusinessStatus {
    host.business_status()
}

/// The Active device and lease epoch for display; refused unless the workspace is Active.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_device_lease_read(
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopDeviceLease, String> {
    host.device_lease()
        .map_err(|_| "LOCAL_LEASE_UNAVAILABLE".to_owned())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_asset_library_read(
    request: DesktopAssetLibraryReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<AssetLibraryReadSnapshot, String> {
    host.read_asset_library(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_domain_detail_read(
    request: DesktopDomainDetailReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DomainDetailReadSnapshot, String> {
    host.read_domain_detail(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_batch_operations_read(
    request: DesktopBatchOperationsReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<BatchOperationsReadSnapshot, String> {
    host.read_batch_operations(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_history_read(
    request: DesktopHistoryReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<HistoryReadSnapshot, String> {
    host.read_history(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_manual_tasks_read(
    request: DesktopManualTasksReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<ManualTasksReadSnapshot, String> {
    host.read_manual_tasks(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_renewals_read(
    request: DesktopRenewalsReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<RenewalsReadSnapshot, String> {
    host.read_renewals(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_sales_read(
    request: DesktopSalesReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<SalesReadSnapshot, String> {
    host.read_sales(request).map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_settings_read(
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<SettingsReadSnapshot, String> {
    host.read_settings().map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_dns_health_read(
    request: DesktopDnsHealthReadRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DnsHealthReadSnapshot, String> {
    host.read_dns_health(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_domain_asset_edit(
    request: DesktopDomainAssetEditRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DomainAssetMutationReceipt, String> {
    host.edit_domain_asset(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_domain_asset_create(
    request: DesktopDomainAssetCreateRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DomainAssetMutationReceipt, String> {
    host.create_domain_asset(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_domain_asset_delete(
    request: DesktopDomainAssetDeleteRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DomainAssetMutationReceipt, String> {
    host.delete_domain_asset(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_domain_asset_provider_bind(
    request: DesktopDomainAssetProviderBindingRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopDomainAssetProviderBindingReceipt, String> {
    host.bind_domain_asset_provider(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_storage_repair(
    request: DesktopStorageRepairRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopStorageRepairReceipt, String> {
    host.repair_stored_rows(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_conflict_center_read(
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopConflictCenterView, String> {
    host.read_conflict_center()
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_conflict_resolve(
    request: DesktopConflictResolveRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
    coordinator: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopConflictResolutionReceipt, String> {
    let receipt = host
        .resolve_conflict(request)
        .map_err(|error| error.to_string())?;
    coordinator.wake_sync();
    Ok(receipt)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn local_sync_status(
    host: State<'_, Arc<DesktopLocalHost>>,
    coordinator: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<DesktopSyncSnapshotView, String> {
    let observation = coordinator
        .transport_observation()
        .ok_or_else(|| "LOCAL_SYNC_UNAVAILABLE".to_owned())?;
    let mut snapshot = host
        .read_sync_snapshot()
        .map_err(|error| error.to_string())?;
    snapshot.apply_transport(
        observation.state,
        observation.syncing,
        observation.observed_at_unix_seconds,
    );
    Ok(snapshot)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeviceSwitchRequest {
    schema_version: u8,
    to_device_id: String,
}

/// Where this device's switch stands, as closed codes only: no switch id, Lease, receipt, proof
/// or signature crosses IPC (ADR-0032 S2d3b).
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceSwitchView {
    schema_version: u8,
    step: &'static str,
    unconfirmed: Option<u64>,
    frozen_unresolved: Option<u64>,
    status: Option<&'static str>,
    rejection: Option<&'static str>,
}

impl From<DeviceSwitchStep> for DeviceSwitchView {
    fn from(step: DeviceSwitchStep) -> Self {
        let (step, unconfirmed, status, rejection) = match step {
            DeviceSwitchStep::Idle => ("idle", None, None, None),
            DeviceSwitchStep::RequestPending => ("request_pending", None, None, None),
            DeviceSwitchStep::Rejected(code) => (
                "rejected",
                None,
                None,
                Some(device_switch_rejection_code(code)),
            ),
            DeviceSwitchStep::WaitingForSync { unconfirmed } => {
                ("waiting_for_sync", Some(unconfirmed), None, None)
            }
            DeviceSwitchStep::Blocked => ("blocked", None, None, None),
            DeviceSwitchStep::ReceiptsMissing => ("receipts_missing", None, None, None),
            DeviceSwitchStep::Switch(status) => (
                "switch",
                None,
                Some(device_switch_status_code(status)),
                None,
            ),
            DeviceSwitchStep::WritesReopened => ("writes_reopened", None, None, None),
        };
        Self {
            schema_version: 1,
            frozen_unresolved: None,
            step,
            unconfirmed,
            status,
            rejection,
        }
    }
}

const fn device_switch_status_code(status: DesktopDeviceSwitchStatus) -> &'static str {
    match status {
        DesktopDeviceSwitchStatus::Requested => "requested",
        DesktopDeviceSwitchStatus::Draining => "draining",
        DesktopDeviceSwitchStatus::WaitingExpiry => "waiting_expiry",
        DesktopDeviceSwitchStatus::Bootstrapping => "bootstrapping",
        DesktopDeviceSwitchStatus::Completed => "completed",
        DesktopDeviceSwitchStatus::Cancelled => "cancelled",
        DesktopDeviceSwitchStatus::Failed => "failed",
    }
}

const fn device_switch_rejection_code(code: DesktopDeviceSwitchRejection) -> &'static str {
    match code {
        DesktopDeviceSwitchRejection::SwitchInProgress => "SWITCH_IN_PROGRESS",
        DesktopDeviceSwitchRejection::SwitchNotFound => "SWITCH_NOT_FOUND",
        DesktopDeviceSwitchRejection::SwitchNotCancellable => "SWITCH_NOT_CANCELLABLE",
        DesktopDeviceSwitchRejection::IdempotencyConflict => "IDEMPOTENCY_CONFLICT",
        DesktopDeviceSwitchRejection::TargetIsSource => "TARGET_IS_SOURCE",
        DesktopDeviceSwitchRejection::TargetNotBound => "TARGET_NOT_BOUND",
        DesktopDeviceSwitchRejection::TargetRemoved => "TARGET_REMOVED",
        DesktopDeviceSwitchRejection::SourceLeaseChanged => "SOURCE_LEASE_CHANGED",
        DesktopDeviceSwitchRejection::AccountRecoveryPending => "ACCOUNT_RECOVERY_PENDING",
        DesktopDeviceSwitchRejection::ForcedSwitchUnavailable => "FORCED_SWITCH_UNAVAILABLE",
        DesktopDeviceSwitchRejection::DrainProofInvalid => "DRAIN_PROOF_INVALID",
        DesktopDeviceSwitchRejection::DrainProofExpired => "DRAIN_PROOF_EXPIRED",
        DesktopDeviceSwitchRejection::DrainStreamsIncomplete => "DRAIN_STREAMS_INCOMPLETE",
    }
}

fn device_switch_result(
    result: Result<DeviceSwitchStep, DeviceSwitchError>,
) -> Result<DeviceSwitchView, String> {
    result.map(DeviceSwitchView::from).map_err(|error| {
        match error {
            DeviceSwitchError::Retryable => "DEVICE_SWITCH_RETRY_LATER",
            DeviceSwitchError::AuthorizationRequired => "DEVICE_SWITCH_AUTHORIZATION_REQUIRED",
            DeviceSwitchError::Blocked => "DEVICE_SWITCH_BLOCKED",
            DeviceSwitchError::Cancelled => "DEVICE_SWITCH_UNAVAILABLE",
        }
        .to_owned()
    })
}

async fn device_switch_snapshot(
    result: Result<DeviceSwitchStep, DeviceSwitchError>,
    host: Arc<DesktopLocalHost>,
) -> Result<DeviceSwitchView, String> {
    let mut view = device_switch_result(result)?;
    // Missing authority is unknown, never a fabricated zero. This read cannot reopen the
    // frozen producer or grant execution capability after the source has relinquished its Lease.
    view.frozen_unresolved = tauri::async_runtime::spawn_blocking(move || {
        let admission = host.begin_native_cloud_read_run().ok()?;
        host.native_device_switch_frozen_unresolved_count(&admission)
            .ok()
    })
    .await
    .ok()
    .flatten();
    Ok(view)
}

/// Asks Cloud for a normal switch to a bound device and starts this device's drain. The switch
/// id comes only from Cloud's answer; the Renderer names only the target.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn device_switch_request(
    request: DeviceSwitchRequest,
    switch: State<'_, Arc<DesktopDeviceSwitch>>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DeviceSwitchView, String> {
    if request.schema_version != 1 {
        return Err("DEVICE_SWITCH_INVALID_REQUEST".to_owned());
    }
    device_switch_snapshot(
        switch.request(&request.to_device_id).await,
        Arc::clone(host.inner()),
    )
    .await
}

/// Moves this device's open switch forward: sync, receipts, then the signed drain proof.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn device_switch_advance(
    switch: State<'_, Arc<DesktopDeviceSwitch>>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DeviceSwitchView, String> {
    device_switch_snapshot(switch.advance().await, Arc::clone(host.inner())).await
}

/// Cloud's state of this device's open switch; writes reopen if Cloud ended it.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn device_switch_status(
    switch: State<'_, Arc<DesktopDeviceSwitch>>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DeviceSwitchView, String> {
    device_switch_snapshot(switch.status().await, Arc::clone(host.inner())).await
}

/// Cancels this device's open switch; writes reopen once Cloud confirms.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn device_switch_cancel(
    switch: State<'_, Arc<DesktopDeviceSwitch>>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DeviceSwitchView, String> {
    device_switch_snapshot(switch.cancel().await, Arc::clone(host.inner())).await
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn local_backup_restore_status(
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopBackupRestoreStatus, String> {
    let aggregate = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || aggregate.backup_status())
        .await
        .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn local_backup_export(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopBackupExportStatus, String> {
    let wire = bounded_request_wire(&request)?;
    let aggregate = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || aggregate.export_backup(&wire))
        .await
        .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())?
        .map_err(map_desktop_backup_error)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn local_backup_artifact_select(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopVerifiedBackupArtifact, String> {
    let wire = bounded_request_wire(&request)?;
    let aggregate = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || aggregate.inspect_backup(&wire))
        .await
        .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())?
        .map_err(map_desktop_backup_error)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn local_backup_restore_begin(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopBackupRestoreStatus, String> {
    let wire = bounded_request_wire(&request)?;
    let aggregate = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || aggregate.restore_backup(&wire))
        .await
        .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())?
        .map_err(map_desktop_backup_error)
}

fn map_desktop_backup_error(error: DesktopBackupError) -> String {
    error.code().to_owned()
}

/// Creates the Cloudflare connection activation provisions into. The Host refuses it with
/// `DESKTOP_CAPABILITY_UNQUALIFIED` until the capability is qualified (ADR-0027).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn cloudflare_connection_create(
    request: DesktopCloudflareConnectionCreateRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DesktopCloudflareConnectionCreated, String> {
    host.create_cloudflare_connection(&request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn cloudflare_connection_activate(
    request: tauri::ipc::Request<'_>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), String> {
    let request: CloudflareConnectionActivateRequest = decode_provider_request(&request, 512)?;
    validate_provider_schema_version(request.schema_version)?;
    validate_cloudflare_connection_id(&request.connection_id)?;
    map_provider_submission(cloud.submit_provider(&ProviderOperation::Activate {
        connection_id: request.connection_id,
    }))
}

/// Queues revocation of the connection's credential. The Host denies credential use as soon as
/// the revocation is prepared; the result is read back through `cloudflare_connection_status`.
#[tauri::command]
pub(crate) async fn cloudflare_connection_revoke(
    request: tauri::ipc::Request<'_>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), String> {
    let request: CloudflareConnectionRevokeRequest = decode_provider_request(&request, 512)?;
    validate_provider_schema_version(request.schema_version)?;
    validate_cloudflare_connection_id(&request.connection_id)?;
    map_provider_submission(cloud.submit_provider(&ProviderOperation::Revoke {
        connection_id: request.connection_id,
    }))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn cloudflare_retirement_candidates(
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<serde_json::Value, String> {
    let candidates = host
        .read_cloudflare_retirement_candidates()
        .map_err(|_| "CLOUDFLARE_STATUS_UNAVAILABLE".to_owned())?;
    Ok(serde_json::json!({"schemaVersion": 1, "candidates": candidates}))
}

#[tauri::command]
pub(crate) async fn cloudflare_connection_purge(
    request: tauri::ipc::Request<'_>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), String> {
    let request: CloudflareConnectionPurgeRequest = decode_provider_request(&request, 512)?;
    validate_provider_schema_version(request.schema_version)?;
    validate_cloudflare_connection_id(&request.connection_id)?;
    map_provider_submission(cloud.submit_provider(&ProviderOperation::Purge {
        connection_id: request.connection_id,
        action: request.action,
    }))
}

#[tauri::command]
pub(crate) async fn cloudflare_zone_observe(
    request: tauri::ipc::Request<'_>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<(), String> {
    let request: CloudflareZoneObserveRequest = decode_provider_request(&request, 1_024)?;
    validate_provider_schema_version(request.schema_version)?;
    validate_cloudflare_connection_id(&request.connection_id)?;
    validate_cloudflare_entity_id(&request.entity_id)?;
    map_provider_submission(cloud.submit_provider(&ProviderOperation::Observe {
        connection_id: request.connection_id,
        entity_id: request.entity_id,
    }))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn cloudflare_connection_status(
    host: State<'_, Arc<DesktopLocalHost>>,
    cloud: State<'_, Arc<NativeCloudCoordinator>>,
) -> Result<serde_json::Value, String> {
    let local = host
        .read_cloudflare_connection()
        .map_err(|_| "CLOUDFLARE_STATUS_UNAVAILABLE".to_owned())?;
    let state = match cloud.provider_status() {
        ProviderStatus::Recovering => "recovering",
        ProviderStatus::Busy => "busy",
        ProviderStatus::Blocked => "blocked",
        ProviderStatus::Ready if local.connection_ref.is_none() => "not-configured",
        ProviderStatus::Ready => "ready",
    };
    let last_operation = cloud
        .last_provider_operation(
            host.authority_identity().as_ref(),
            host.provider_connection_generation(),
        )
        .filter(|record| !record.kind.starts_with("afternic_"))
        .map(|record| serde_json::json!({ "kind": record.kind, "outcome": record.outcome }));
    Ok(
        serde_json::json!({ "schemaVersion": 1, "state": state, "connectionRef": local.connection_ref, "displayLabel": local.display_label, "qualified": local.qualified, "capturable": gooddealer_secure_host_core::CloudflareCapture::supported(), "lastOperation": last_operation, "readGeneration": local.read_generation }),
    )
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn cloudflare_observation_read(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<serde_json::Value, String> {
    let request: CloudflareObservationReadRequest = decode_provider_request(&request, 1_024)?;
    if request.schema_version != 1 {
        return Err("CLOUDFLARE_INPUT_REJECTED".to_owned());
    }
    let value = host
        .read_cloudflare_observation(DesktopCloudflareObservationReadRequest {
            schema_version: request.schema_version,
            entity_id: request.entity_id,
        })
        .map_err(|_| "CLOUDFLARE_OBSERVATION_UNAVAILABLE".to_owned())?;
    serde_json::to_value(value).map_err(|_| "CLOUDFLARE_OBSERVATION_UNAVAILABLE".to_owned())
}

fn map_provider_submission(submission: ProviderSubmission) -> Result<(), String> {
    match submission {
        ProviderSubmission::Accepted => Ok(()),
        ProviderSubmission::Busy => Err("CLOUDFLARE_BUSY".to_owned()),
        ProviderSubmission::RateLimited => Err("CLOUDFLARE_RATE_LIMITED".to_owned()),
        ProviderSubmission::Unavailable => Err("CLOUDFLARE_UNAVAILABLE".to_owned()),
    }
}

fn validate_provider_schema_version(value: u8) -> Result<(), String> {
    if value != 1 {
        return Err("CLOUDFLARE_INPUT_REJECTED".to_owned());
    }
    Ok(())
}

fn validate_cloudflare_connection_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 256
        || value.bytes().any(|byte| !(0x21..=0x7e).contains(&byte))
    {
        return Err("CLOUDFLARE_INPUT_REJECTED".to_owned());
    }
    Ok(())
}

fn validate_cloudflare_entity_id(value: &str) -> Result<(), String> {
    if value.len() > 253 || value != value.to_ascii_lowercase() || !value.contains('.') {
        return Err("CLOUDFLARE_INPUT_REJECTED".to_owned());
    }
    if value.split('.').any(|label| {
        label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    }) {
        return Err("CLOUDFLARE_INPUT_REJECTED".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_switch_views_carry_only_closed_codes() {
        let json = |step| serde_json::to_value(DeviceSwitchView::from(step)).expect("view json");
        assert_eq!(
            json(DeviceSwitchStep::WaitingForSync { unconfirmed: 3 }),
            serde_json::json!({ "schemaVersion": 1, "step": "waiting_for_sync", "unconfirmed": 3, "frozenUnresolved": null, "status": null, "rejection": null })
        );
        assert_eq!(
            json(DeviceSwitchStep::Switch(
                DesktopDeviceSwitchStatus::WaitingExpiry
            )),
            serde_json::json!({ "schemaVersion": 1, "step": "switch", "unconfirmed": null, "frozenUnresolved": null, "status": "waiting_expiry", "rejection": null })
        );
        assert_eq!(
            json(DeviceSwitchStep::Rejected(
                DesktopDeviceSwitchRejection::DrainStreamsIncomplete
            )),
            serde_json::json!({ "schemaVersion": 1, "step": "rejected", "unconfirmed": null, "frozenUnresolved": null, "status": null, "rejection": "DRAIN_STREAMS_INCOMPLETE" })
        );
        assert_eq!(
            device_switch_result(Err(DeviceSwitchError::Cancelled)),
            Err("DEVICE_SWITCH_UNAVAILABLE".to_owned())
        );
    }

    #[test]
    fn cloudflare_identifiers_are_bounded_before_closed_unavailability() {
        assert!(validate_cloudflare_connection_id("connection-1").is_ok());
        assert!(validate_cloudflare_connection_id("").is_err());
        assert!(validate_cloudflare_connection_id("line\nbreak").is_err());
        assert!(validate_cloudflare_entity_id("example.com").is_ok());
        assert!(validate_cloudflare_entity_id("Example.com").is_err());
        assert!(validate_cloudflare_entity_id("-bad.example").is_err());
    }

    #[test]
    fn provider_submission_maps_the_real_queue_outcome() {
        assert_eq!(
            map_provider_submission(ProviderSubmission::Accepted),
            Ok(())
        );
        assert_eq!(
            map_provider_submission(ProviderSubmission::Busy),
            Err("CLOUDFLARE_BUSY".to_owned())
        );
        assert_eq!(
            map_provider_submission(ProviderSubmission::RateLimited),
            Err("CLOUDFLARE_RATE_LIMITED".to_owned())
        );
        assert_eq!(
            map_provider_submission(ProviderSubmission::Unavailable),
            Err("CLOUDFLARE_UNAVAILABLE".to_owned())
        );
    }
}

/// Reads only the current account's redacted device directory.
#[tauri::command]
pub(crate) async fn device_directory_read(
    session: State<'_, Arc<crate::native_cloud_session::NativeCloudSession>>,
) -> Result<gooddealer_secure_host_core::DesktopDeviceDirectory, String> {
    session
        .device_directory(None)
        .await
        .map_err(|_| "DEVICE_DIRECTORY_UNAVAILABLE".to_owned())
}

/// The raw intent contains a name only; Native supplies the build platform.
#[tauri::command]
pub(crate) async fn device_self_report(
    request: tauri::ipc::Request<'_>,
    session: State<'_, Arc<crate::native_cloud_session::NativeCloudSession>>,
) -> Result<gooddealer_secure_host_core::DesktopDeviceDirectory, String> {
    let tauri::ipc::InvokeBody::Raw(wire) = request.body() else {
        return Err("DEVICE_DIRECTORY_INPUT_REJECTED".to_owned());
    };
    if wire.is_empty() || wire.len() > 1024 {
        return Err("DEVICE_DIRECTORY_INPUT_REJECTED".to_owned());
    }
    session
        .device_directory(Some(wire.clone()))
        .await
        .map_err(|_| "DEVICE_DIRECTORY_UNAVAILABLE".to_owned())
}
