//! Afternic's concrete Native composition. Only Host handles cross into custody and HTTP;
//! secrets, protocol bodies and filesystem identities never enter Renderer or Cloud.

use super::ProviderCredentialError;
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopAfternicConnection, DesktopAfternicListingObservation, DesktopLocalHost,
    DesktopLocalHostError,
};
use gooddealer_secure_host_core::{
    AfternicCapture, AfternicCredential, AfternicCredentialPlan, AfternicError, AfternicListing,
    AfternicListingStatus, AfternicProviderClient, load_afternic_credential_guarded,
    publish_afternic_credential_guarded, purge_afternic_credential_guarded,
};
use std::sync::Arc;

struct ConnectionPlan<'a>(&'a DesktopAfternicConnection);
impl AfternicCredentialPlan for ConnectionPlan<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation()
    }
    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
    }
    fn generation(&self) -> u64 {
        self.0.generation()
    }
    fn public_proof(&self) -> &str {
        self.0.public_proof()
    }
}

fn guard(
    host: &DesktopLocalHost,
    fence: &NativeCloudCancelFence,
    connection: &DesktopAfternicConnection,
) -> Result<(), AfternicError> {
    if fence.is_cancelled() {
        return Err(AfternicError::AuthorityStale);
    }
    host.recheck_afternic_connection(connection)
        .map_err(|_| AfternicError::AuthorityStale)
}

pub(crate) async fn connect(
    host: Arc<DesktopLocalHost>,
    display_label: String,
    fence: Arc<NativeCloudCancelFence>,
) -> Result<(), ProviderCredentialError> {
    if !AfternicCapture::supported() {
        return Err(ProviderCredentialError::Unavailable);
    }
    let prepare_host = Arc::clone(&host);
    let prepare_fence = Arc::clone(&fence);
    let connection = tauri::async_runtime::spawn_blocking(move || {
        prepare_fence
            .commit(|| {
                let admission = prepare_host.begin_native_cloud_run()?;
                prepare_host.prepare_afternic_connection(admission, &display_label)
            })
            .ok_or(ProviderCredentialError::Host)?
            .map_err(host_error)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    let capture_host = Arc::clone(&host);
    let capture_fence = Arc::clone(&fence);
    let (connection, credential) = tauri::async_runtime::spawn_blocking(move || {
        let mut check = || guard(&capture_host, &capture_fence, &connection);
        let result = (|| {
            let captured = AfternicCapture::capture_guarded(&mut check)?;
            publish_afternic_credential_guarded(
                &ConnectionPlan(&connection),
                &captured,
                &mut check,
            )?;
            // Use the stored readback, never the capture, for the first HTTP request. A crash
            // after publication leaves exactly this generation available to restart recovery.
            load_afternic_credential_guarded(&ConnectionPlan(&connection), &mut check)
        })();
        (connection, result)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?;
    let credential = reconcile_load_result(&host, &fence, &connection, credential)?;
    scan_and_commit(host, fence, connection, credential).await
}

pub(crate) async fn refresh(
    host: Arc<DesktopLocalHost>,
    connection_id: String,
    fence: Arc<NativeCloudCancelFence>,
) -> Result<(), ProviderCredentialError> {
    let load_host = Arc::clone(&host);
    let load_fence = Arc::clone(&fence);
    let (connection, credential) = tauri::async_runtime::spawn_blocking(move || {
        if load_fence.is_cancelled() {
            return Err(ProviderCredentialError::Host);
        }
        let admission = load_host.begin_native_cloud_run().map_err(host_error)?;
        let connection = load_host
            .resume_afternic_connection(admission, &connection_id)
            .map_err(host_error)?;
        let result = load_afternic_credential_guarded(&ConnectionPlan(&connection), &mut || {
            guard(&load_host, &load_fence, &connection)
        });
        Ok((connection, result))
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    let credential = reconcile_load_result(&host, &fence, &connection, credential)?;
    scan_and_commit(host, fence, connection, credential).await
}

fn reconcile_load_result(
    host: &DesktopLocalHost,
    fence: &NativeCloudCancelFence,
    connection: &DesktopAfternicConnection,
    result: Result<AfternicCredential, AfternicError>,
) -> Result<AfternicCredential, ProviderCredentialError> {
    if matches!(
        result,
        Err(AfternicError::CustodyMismatch
            | AfternicError::CaptureCancelled
            | AfternicError::InputRejected)
    ) {
        fence
            .commit(|| host.mark_afternic_remediation(connection))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(host_error)?;
    }
    result.map_err(native_error)
}

async fn scan_and_commit(
    host: Arc<DesktopLocalHost>,
    fence: Arc<NativeCloudCancelFence>,
    connection: DesktopAfternicConnection,
    credential: AfternicCredential,
) -> Result<(), ProviderCredentialError> {
    let mut provider = AfternicProviderClient::production().map_err(native_error)?;
    let portfolio = provider
        .scan(&credential, &mut || guard(&host, &fence, &connection))
        .await
        .map_err(native_error)?;
    let listings: Vec<_> = portfolio.listings.into_iter().map(observation).collect();
    tauri::async_runtime::spawn_blocking(move || {
        fence
            .commit(|| host.commit_afternic_inventory(&connection, &listings))
            .ok_or(ProviderCredentialError::Host)?
            .map(|_| ())
            .map_err(host_error)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}

pub(crate) async fn revoke(
    host: Arc<DesktopLocalHost>,
    connection_id: String,
    fence: Arc<NativeCloudCancelFence>,
) -> Result<(), ProviderCredentialError> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = fence
            .commit(|| {
                let admission = host.begin_native_cloud_run()?;
                host.revoke_afternic_connection(admission, &connection_id)
            })
            .ok_or(ProviderCredentialError::Host)?
            .map_err(host_error)?;
        purge_afternic_credential_guarded(&ConnectionPlan(&connection), &mut || {
            if fence.is_cancelled() {
                return Err(AfternicError::AuthorityStale);
            }
            host.recheck_afternic_purge(&connection)
                .map_err(|_| AfternicError::AuthorityStale)
        })
        .map_err(native_error)?;
        fence
            .commit(|| host.confirm_afternic_purge(&connection))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(host_error)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}

/// Recovery inspects only persisted slots. Missing or malformed material requires reconnecting
/// through a new connection; it never silently captures or overwrites the old generation.
pub(crate) async fn recover(
    host: Arc<DesktopLocalHost>,
    fence: Arc<NativeCloudCancelFence>,
) -> Result<(), ProviderCredentialError> {
    if fence.is_cancelled() {
        return Err(ProviderCredentialError::Host);
    }
    let read_host = Arc::clone(&host);
    let view = tauri::async_runtime::spawn_blocking(move || read_host.read_afternic_connections())
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
        .map_err(host_error)?;
    let mut complete = true;
    for connection in view.connections {
        if fence.is_cancelled() {
            return Err(ProviderCredentialError::Host);
        }
        let result = if connection.purge_pending {
            revoke(
                Arc::clone(&host),
                connection.connection_id.clone(),
                Arc::clone(&fence),
            )
            .await
        } else if view.observe_entitled
            && view.observe_qualified
            && matches!(connection.state.as_str(), "prepared" | "active")
        {
            refresh(
                Arc::clone(&host),
                connection.connection_id.clone(),
                Arc::clone(&fence),
            )
            .await
        } else {
            continue;
        };
        if result.is_err() {
            let read_host = Arc::clone(&host);
            let settled = tauri::async_runtime::spawn_blocking(move || {
                read_host.read_afternic_connections().is_ok_and(|current| {
                    current.connections.iter().any(|row| {
                        row.connection_id == connection.connection_id
                            && (row.state == "remediation_required"
                                || (row.state == "revoked" && !row.purge_pending))
                    })
                })
            })
            .await
            .unwrap_or(false);
            complete &= settled;
        }
    }
    if complete {
        Ok(())
    } else {
        Err(ProviderCredentialError::Unavailable)
    }
}

fn observation(listing: AfternicListing) -> DesktopAfternicListingObservation {
    let status = match listing.status {
        AfternicListingStatus::Pending => "PENDING",
        AfternicListingStatus::FailedCompliance => "FAILED_COMPLIANCE",
        AfternicListingStatus::Active => "ACTIVE",
        AfternicListingStatus::Hidden => "HIDDEN",
        AfternicListingStatus::OnHold => "ON_HOLD",
        AfternicListingStatus::Sold => "SOLD",
        AfternicListingStatus::Inactive => "INACTIVE",
        AfternicListingStatus::OwnershipReview => "OWNERSHIP_REVIEW",
        AfternicListingStatus::OwnershipUnverified => "OWNERSHIP_UNVERIFIED",
        AfternicListingStatus::VerifiedOwnerConflict => "VERIFIED_OWNER_CONFLICT",
        AfternicListingStatus::InventoryComplianceIssue => "INVENTORY_COMPLIANCE_ISSUE",
        AfternicListingStatus::TldUnsupported => "TLD_UNSUPPORTED",
        AfternicListingStatus::UnregisteredDomain => "UNREGISTERED_DOMAIN",
        AfternicListingStatus::Unknown => "UNKNOWN",
    };
    DesktopAfternicListingObservation {
        domain: listing.domain,
        status: status.to_owned(),
        buynow_price: listing.buynow_price,
        floor_price: listing.floor_price,
        minbid_price: listing.minbid_price,
        hidden: listing.hidden,
        created_at: listing.created_at,
        updated_at: listing.updated_at,
    }
}
fn host_error(error: DesktopLocalHostError) -> ProviderCredentialError {
    if error == DesktopLocalHostError::CapabilityUnqualified {
        ProviderCredentialError::Unqualified
    } else {
        ProviderCredentialError::Host
    }
}
const fn native_error(error: AfternicError) -> ProviderCredentialError {
    match error {
        AfternicError::AuthenticationRequired | AfternicError::Forbidden => {
            ProviderCredentialError::CredentialRejected
        }
        AfternicError::RateLimited { .. } | AfternicError::Retryable => {
            ProviderCredentialError::ProviderRetryLater
        }
        AfternicError::CustodyUnavailable | AfternicError::CustodyMismatch => {
            ProviderCredentialError::Keychain
        }
        AfternicError::CaptureCancelled => ProviderCredentialError::Capture,
        AfternicError::AuthorityStale => ProviderCredentialError::Host,
        _ => ProviderCredentialError::Provider,
    }
}
