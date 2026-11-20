//! Afternic's concrete Native composition. Only Host handles cross into custody and HTTP;
//! secrets, protocol bodies and filesystem identities never enter Renderer or Cloud.

#[cfg(all(
    feature = "afternic-controlled-acceptance",
    not(all(afternic_controlled_debug_linux, target_os = "linux", debug_assertions))
))]
compile_error!("afternic-controlled-acceptance requires the Linux debug Cargo profile");

use super::ProviderCredentialError;
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopAfternicConnection, DesktopAfternicListingObservation, DesktopLocalHost,
    DesktopLocalHostError,
};
use gooddealer_secure_host_core::{
    AfternicCapture, AfternicCredential, AfternicCredentialPlan, AfternicError, AfternicListing,
    AfternicListingStatus, AfternicProviderClient, NativePowerGate,
    load_afternic_credential_guarded, publish_afternic_credential_guarded,
    purge_afternic_credential_guarded,
};
use std::sync::Arc;

pub(super) struct ConnectionPlan<'a>(pub(super) &'a DesktopAfternicConnection);
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

struct Run {
    host: Arc<DesktopLocalHost>,
    cancel: Arc<NativeCloudCancelFence>,
    power: NativePowerGate,
    epoch: u64,
    require_ready: bool,
}
impl Run {
    fn power_guard(
        &self,
    ) -> Result<gooddealer_secure_host_core::NativePowerCommitGuard<'_>, AfternicError> {
        hold_current_power(&self.power, &self.cancel, self.epoch, self.require_ready)
    }

    fn guard(&self, connection: &DesktopAfternicConnection) -> Result<(), AfternicError> {
        recheck_with_power(
            &self.power,
            &self.cancel,
            self.epoch,
            self.require_ready,
            || self.host.recheck_afternic_connection(connection),
        )
    }

    fn check(&self) -> Result<(), ProviderCredentialError> {
        drop(self.power_guard().map_err(native_error)?);
        Ok(())
    }
}

fn hold_current_power<'a>(
    power: &'a NativePowerGate,
    cancel: &NativeCloudCancelFence,
    epoch: u64,
    require_ready: bool,
) -> Result<gooddealer_secure_host_core::NativePowerCommitGuard<'a>, AfternicError> {
    let held = if require_ready {
        power.hold_write_epoch(epoch)
    } else {
        power.hold_reconciliation_epoch(epoch)
    }
    .map_err(|_| AfternicError::AuthorityStale)?;
    if cancel.is_cancelled() {
        return Err(AfternicError::AuthorityStale);
    }
    Ok(held)
}

fn recheck_with_power(
    power: &NativePowerGate,
    cancel: &NativeCloudCancelFence,
    epoch: u64,
    require_ready: bool,
    recheck: impl FnOnce() -> Result<(), DesktopLocalHostError>,
) -> Result<(), AfternicError> {
    drop(hold_current_power(power, cancel, epoch, require_ready)?);
    recheck().map_err(|_| AfternicError::AuthorityStale)?;
    // Publication/SQLite can block. Recheck the same power epoch after that wait, without
    // holding the power mutex across custody, capture or a network future.
    drop(hold_current_power(power, cancel, epoch, require_ready)?);
    Ok(())
}

pub(crate) async fn connect(
    host: Arc<DesktopLocalHost>,
    display_label: String,
    fence: Arc<NativeCloudCancelFence>,
    power: NativePowerGate,
) -> Result<(), ProviderCredentialError> {
    if !AfternicCapture::supported() {
        return Err(ProviderCredentialError::Unavailable);
    }
    let epoch = power.snapshot().epoch;
    let run = Arc::new(Run {
        host,
        cancel: fence,
        power,
        epoch,
        require_ready: true,
    });
    run.check()?;
    let prepare = Arc::clone(&run);
    let connection = tauri::async_runtime::spawn_blocking(move || {
        let _power = prepare.power_guard().map_err(native_error)?;
        prepare
            .cancel
            .commit(|| {
                let admission = prepare.host.begin_native_cloud_run()?;
                prepare
                    .host
                    .prepare_afternic_connection(admission, &display_label)
            })
            .ok_or(ProviderCredentialError::Host)?
            .map_err(host_error)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    run.guard(&connection).map_err(native_error)?;
    let capture = Arc::clone(&run);
    let (connection, credential) = tauri::async_runtime::spawn_blocking(move || {
        let mut check = || capture.guard(&connection);
        let result = (|| {
            let captured = AfternicCapture::capture_guarded(&mut check)?;
            check()?;
            publish_afternic_credential_guarded(
                &ConnectionPlan(&connection),
                &captured,
                &mut check,
            )?;
            check()?;
            // Read back the exact persisted slot. A crash after publication leaves this
            // generation available to recovery; capture is never an alternative HTTP source.
            let credential =
                load_afternic_credential_guarded(&ConnectionPlan(&connection), &mut check)?;
            check()?;
            Ok(credential)
        })();
        (connection, result)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?;
    run.guard(&connection).map_err(native_error)?;
    let credential = reconcile_load_result(&run, &connection, credential)?;
    scan_and_commit(run, connection, credential).await
}

pub(crate) async fn refresh(
    host: Arc<DesktopLocalHost>,
    connection_id: String,
    fence: Arc<NativeCloudCancelFence>,
    power: NativePowerGate,
) -> Result<(), ProviderCredentialError> {
    let epoch = power.snapshot().epoch;
    refresh_in_run(
        Arc::new(Run {
            host,
            cancel: fence,
            power,
            epoch,
            require_ready: false,
        }),
        connection_id,
    )
    .await
}

async fn refresh_in_run(
    run: Arc<Run>,
    connection_id: String,
) -> Result<(), ProviderCredentialError> {
    run.check()?;
    let load = Arc::clone(&run);
    let (connection, credential) = tauri::async_runtime::spawn_blocking(move || {
        load.check()?;
        let admission = load.host.begin_native_cloud_run().map_err(host_error)?;
        let connection = load
            .host
            .resume_afternic_connection(admission, &connection_id)
            .map_err(host_error)?;
        load.guard(&connection).map_err(native_error)?;
        let result = load_afternic_credential_guarded(&ConnectionPlan(&connection), &mut || {
            load.guard(&connection)
        });
        load.guard(&connection).map_err(native_error)?;
        Ok((connection, result))
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    run.guard(&connection).map_err(native_error)?;
    let credential = reconcile_load_result(&run, &connection, credential)?;
    scan_and_commit(run, connection, credential).await
}

fn reconcile_load_result(
    run: &Run,
    connection: &DesktopAfternicConnection,
    result: Result<AfternicCredential, AfternicError>,
) -> Result<AfternicCredential, ProviderCredentialError> {
    if matches!(
        result,
        Err(AfternicError::CustodyMismatch
            | AfternicError::CaptureCancelled
            | AfternicError::InputRejected)
    ) {
        let _power = run.power_guard().map_err(native_error)?;
        run.cancel
            .commit(|| run.host.mark_afternic_remediation(connection))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(host_error)?;
    }
    result.map_err(native_error)
}

async fn scan_and_commit(
    run: Arc<Run>,
    connection: DesktopAfternicConnection,
    credential: AfternicCredential,
) -> Result<(), ProviderCredentialError> {
    run.guard(&connection).map_err(native_error)?;
    let mut provider = AfternicProviderClient::production().map_err(native_error)?;
    let mut guard = || run.guard(&connection);
    let portfolio = tokio::select! {
        biased;
        _ = run.power.wait_for_epoch_change(run.epoch) => Err(AfternicError::AuthorityStale),
        result = provider.scan(&credential, &mut guard) => result,
    }
    .map_err(native_error)?;
    run.guard(&connection).map_err(native_error)?;
    let listings: Vec<_> = portfolio.listings.into_iter().map(observation).collect();
    let commit = Arc::clone(&run);
    tauri::async_runtime::spawn_blocking(move || {
        // The final lock order is power -> cancellation -> Host publication -> SQLite.
        let _power = commit.power_guard().map_err(native_error)?;
        commit
            .cancel
            .commit(|| {
                commit
                    .host
                    .commit_afternic_inventory(&connection, &listings)
            })
            .ok_or(ProviderCredentialError::Host)?
            .map(|_| ())
            .map_err(host_error)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    run.check()
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
    power: NativePowerGate,
) -> Result<(), ProviderCredentialError> {
    if fence.is_cancelled() {
        return Err(ProviderCredentialError::Host);
    }
    let epoch = power.snapshot().epoch;
    let run = Arc::new(Run {
        host,
        cancel: fence,
        power,
        epoch,
        require_ready: false,
    });
    let read_host = Arc::clone(&run.host);
    let view = tauri::async_runtime::spawn_blocking(move || read_host.read_afternic_connections())
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
        .map_err(host_error)?;
    let controlled_connection = view
        .controlled_acceptance
        .as_ref()
        .and_then(|scope| scope.connection_id.as_deref());
    let mut complete = true;
    for connection in view.connections {
        if run.cancel.is_cancelled() {
            return Err(ProviderCredentialError::Host);
        }
        let result = if connection.purge_pending {
            // Retirement reduces secret holdings and remains available while execution is paused.
            revoke(
                Arc::clone(&run.host),
                connection.connection_id.clone(),
                Arc::clone(&run.cancel),
            )
            .await
        } else if should_recover_connection(
            view.observe_entitled,
            view.observe_qualified,
            controlled_connection,
            &connection.connection_id,
            &connection.state,
        ) {
            // Every slot shares the epoch captured before the initial await. A wake cannot
            // silently continue this recovery pass under new execution authority.
            run.check()?;
            let result = refresh_in_run(Arc::clone(&run), connection.connection_id.clone()).await;
            run.check()?;
            result
        } else {
            continue;
        };
        if result.is_err() {
            let read_host = Arc::clone(&run.host);
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
            if run.cancel.is_cancelled() {
                return Err(ProviderCredentialError::Host);
            }
            complete &= settled;
        }
    }
    if complete {
        Ok(())
    } else {
        Err(ProviderCredentialError::Unavailable)
    }
}

fn should_recover_connection(
    entitled: bool,
    qualified: bool,
    controlled_connection: Option<&str>,
    connection_id: &str,
    state: &str,
) -> bool {
    entitled
        && (qualified || controlled_connection == Some(connection_id))
        && matches!(state, "prepared" | "active")
}

pub(super) fn observation(listing: AfternicListing) -> DesktopAfternicListingObservation {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controlled_recovery_requires_exact_connection_and_real_entitlement() {
        for state in ["prepared", "active"] {
            assert!(should_recover_connection(
                true,
                false,
                Some("bound"),
                "bound",
                state
            ));
            assert!(!should_recover_connection(
                true,
                false,
                Some("bound"),
                "other",
                state
            ));
            assert!(!should_recover_connection(
                true, false, None, "bound", state
            ));
            assert!(!should_recover_connection(
                false,
                false,
                Some("bound"),
                "bound",
                state
            ));
            assert!(!should_recover_connection(
                false,
                true,
                Some("bound"),
                "bound",
                state
            ));
            assert!(should_recover_connection(
                true,
                true,
                None,
                "production",
                state
            ));
        }
        for state in ["revoked", "remediation_required", "", "unknown"] {
            assert!(!should_recover_connection(
                true,
                true,
                Some("bound"),
                "bound",
                state
            ));
        }
    }

    #[test]
    fn power_change_during_host_recheck_rejects_late_custody_or_network_result() {
        let mut monitor = gooddealer_secure_host_core::NativePowerMonitor::start();
        let power = monitor.gate();
        let cancel = NativeCloudCancelFence::default();
        let epoch = power.snapshot().epoch;
        assert!(recheck_with_power(&power, &cancel, epoch, false, || Ok(())).is_ok());
        assert_eq!(
            recheck_with_power(&power, &cancel, epoch, false, || {
                monitor.stop();
                Ok(())
            }),
            Err(AfternicError::AuthorityStale)
        );
        assert!(hold_current_power(&power, &cancel, epoch, false).is_err());
    }

    #[test]
    fn cancellation_during_host_recheck_rejects_late_custody_or_network_result() {
        let monitor = gooddealer_secure_host_core::NativePowerMonitor::start();
        let power = monitor.gate();
        let cancel = NativeCloudCancelFence::default();
        assert_eq!(
            recheck_with_power(&power, &cancel, power.snapshot().epoch, false, || {
                cancel.cancel();
                Ok(())
            }),
            Err(AfternicError::AuthorityStale)
        );
    }

    #[test]
    fn stale_host_or_power_never_reaches_next_guarded_step() {
        let mut monitor = gooddealer_secure_host_core::NativePowerMonitor::start();
        let power = monitor.gate();
        let cancel = NativeCloudCancelFence::default();
        let epoch = power.snapshot().epoch;
        assert_eq!(
            recheck_with_power(&power, &cancel, epoch, false, || {
                Err(DesktopLocalHostError::AuthorityRejected)
            }),
            Err(AfternicError::AuthorityStale)
        );
        monitor.stop();
        assert_eq!(
            recheck_with_power(&power, &cancel, epoch, false, || {
                panic!("stale power must reject before Host or custody");
            }),
            Err(AfternicError::AuthorityStale)
        );
    }
}
