//! Thin Tauri adapters for the single Desktop local-host aggregate.

use std::sync::Arc;

use gooddealer_local_storage::{
    AssetLibraryReadSnapshot, DesktopAssetLibraryReadRequest, DesktopBackupError,
    DesktopBackupExportStatus, DesktopBackupRestoreStatus, DesktopCloudflareObservationReadRequest,
    DesktopConflictCenterView, DesktopConflictResolutionReceipt, DesktopConflictResolveRequest,
    DesktopDomainAssetDeleteRequest, DesktopDomainAssetEditRequest,
    DesktopDomainAssetProviderBindingReceipt, DesktopDomainAssetProviderBindingRequest,
    DesktopDomainDetailReadRequest, DesktopLocalBusinessStatus, DesktopLocalHost,
    DesktopSyncSnapshotView, DesktopVerifiedBackupArtifact, DomainAssetMutationReceipt,
    DomainDetailReadSnapshot,
};
use serde::Deserialize;
use tauri::State;

use crate::backup_ipc::bounded_request_wire;
use crate::native_cloud_runtime::NativeCloudCoordinator;
use crate::provider_ipc::decode_provider_request;
use crate::provider_lane::{ProviderOperation, ProviderStatus, ProviderSubmission};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudflareConnectionActivateRequest {
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
pub(crate) fn local_domain_asset_edit(
    request: DesktopDomainAssetEditRequest,
    host: State<'_, Arc<DesktopLocalHost>>,
) -> Result<DomainAssetMutationReceipt, String> {
    host.edit_domain_asset(request)
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
    Ok(
        serde_json::json!({ "schemaVersion": 1, "state": state, "connectionRef": local.connection_ref, "displayLabel": local.display_label, "readGeneration": local.read_generation }),
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
