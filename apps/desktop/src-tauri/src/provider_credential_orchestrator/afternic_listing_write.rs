//! Afternic's single-item runner. The Host owns durable plans, claims, retries and results.
use super::{
    ProviderCredentialError,
    afternic::{ConnectionPlan, observation},
};
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopAfternicListingObservation, DesktopAfternicListingWriteAction,
    DesktopAfternicListingWriteClaim, DesktopAfternicListingWritePatch,
    DesktopAfternicListingWriteWork, DesktopAfternicListingWriteWorkKind, DesktopLocalHost,
};
use gooddealer_secure_host_core::{
    AfternicCredential, AfternicError, AfternicListingFields, AfternicListingIntent,
    AfternicProviderClient, NativePowerGate, load_afternic_credential_guarded,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

struct Run {
    host: Arc<DesktopLocalHost>,
    cancel: Arc<NativeCloudCancelFence>,
    power: NativePowerGate,
    epoch: u64,
}
impl Run {
    fn power_guard(
        &self,
        write: bool,
    ) -> std::result::Result<gooddealer_secure_host_core::NativePowerCommitGuard<'_>, AfternicError>
    {
        hold_current_power(&self.power, &self.cancel, self.epoch, write)
    }
    fn work_guard(
        &self,
        work: &DesktopAfternicListingWriteWork,
    ) -> std::result::Result<(), AfternicError> {
        recheck_with_power(
            &self.power,
            &self.cancel,
            self.epoch,
            matches!(work.kind(), DesktopAfternicListingWriteWorkKind::Preflight),
            || self.host.recheck_afternic_listing_write_work(work),
        )
    }
    fn claim_guard(
        &self,
        claim: &DesktopAfternicListingWriteClaim,
    ) -> std::result::Result<(), AfternicError> {
        recheck_with_power(&self.power, &self.cancel, self.epoch, true, || {
            self.host.recheck_afternic_listing_write_claim(claim)
        })
    }
}
fn hold_current_power<'a>(
    power: &'a NativePowerGate,
    cancel: &NativeCloudCancelFence,
    epoch: u64,
    write: bool,
) -> std::result::Result<gooddealer_secure_host_core::NativePowerCommitGuard<'a>, AfternicError> {
    let guard = if write {
        power.hold_write_epoch(epoch)
    } else {
        power.hold_reconciliation_epoch(epoch)
    }
    .map_err(|_| AfternicError::AuthorityStale)?;
    // Cancellation is checked after the potentially contended power lock, in power -> cancel order.
    if cancel.is_cancelled() {
        return Err(AfternicError::AuthorityStale);
    }
    Ok(guard)
}
fn recheck_with_power(
    power: &NativePowerGate,
    cancel: &NativeCloudCancelFence,
    epoch: u64,
    write: bool,
    host_recheck: impl FnOnce() -> std::result::Result<
        (),
        gooddealer_local_storage::DesktopLocalHostError,
    >,
) -> std::result::Result<(), AfternicError> {
    drop(hold_current_power(power, cancel, epoch, write)?);
    host_recheck().map_err(|_| AfternicError::AuthorityStale)?;
    // The Host can wait for publication/SQLite locks. A pause or cancellation during that wait
    // must be seen by the last transport guard before it starts another request.
    drop(hold_current_power(power, cancel, epoch, write)?);
    Ok(())
}

/// True wakes this same Provider lane for another due item. No second runner or write retry exists.
pub(crate) async fn step(
    host: Arc<DesktopLocalHost>,
    cancel: Arc<NativeCloudCancelFence>,
    power: NativePowerGate,
) -> Result<bool> {
    let epoch = power.snapshot().epoch;
    let run = Arc::new(Run {
        host,
        cancel,
        power,
        epoch,
    });
    let prepare = Arc::clone(&run);
    let work = tauri::async_runtime::spawn_blocking(move || {
        let _power_commit = prepare
            .power_guard(false)
            .map_err(|_| ProviderCredentialError::Host)?;
        prepare
            .cancel
            .commit(|| {
                let admission = prepare.host.begin_native_cloud_run()?;
                prepare.host.next_afternic_listing_write_work(admission)
            })
            .ok_or(ProviderCredentialError::Host)?
            .map_err(|_| ProviderCredentialError::Host)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    let Some(work) = work else {
        return Ok(false);
    };
    if matches!(work.kind(), DesktopAfternicListingWriteWorkKind::Preflight)
        && run.power_guard(true).is_err()
    {
        // Monitoring failure forbids a new claim but leaves already-dispatched reconciliation usable.
        return Ok(false);
    }
    let load = Arc::clone(&run);
    let (work, credential) = tauri::async_runtime::spawn_blocking(move || {
        let credential =
            load_afternic_credential_guarded(&ConnectionPlan(work.connection()), &mut || {
                load.work_guard(&work)
            });
        (work, credential)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?;
    let credential = match credential {
        Ok(value) => value,
        Err(error) => {
            credential_failure(run, work, error).await?;
            return Ok(true);
        }
    };
    let mut provider =
        AfternicProviderClient::production().map_err(|_| ProviderCredentialError::Unavailable)?;
    if matches!(work.kind(), DesktopAfternicListingWriteWorkKind::Reconcile) {
        reconcile(run, work, &mut provider, &credential).await?;
    } else {
        preflight_and_write(run, work, &mut provider, &credential).await?;
    }
    Ok(true)
}

const fn requires_credential_remediation(error: AfternicError) -> bool {
    matches!(error, AfternicError::CustodyMismatch)
}
async fn credential_failure(
    run: Arc<Run>,
    work: DesktopAfternicListingWriteWork,
    error: AfternicError,
) -> Result<()> {
    if !requires_credential_remediation(error) {
        return defer(run, work, error).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _power_commit = run
            .power_guard(false)
            .map_err(|_| ProviderCredentialError::Host)?;
        // A missing/malformed exact slot is never recaptured or substituted. Keep dispatched
        // uncertainty; subsequent Host maintenance records the connection conflict separately.
        run.cancel
            .commit(|| run.host.mark_afternic_remediation(work.connection()))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(|_| ProviderCredentialError::Host)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}

async fn preflight_and_write(
    run: Arc<Run>,
    work: DesktopAfternicListingWriteWork,
    provider: &mut AfternicProviderClient,
    credential: &AfternicCredential,
) -> Result<()> {
    let observed = match exact_get(&run, &work, provider, credential).await {
        Ok(value) => value,
        Err(error) => return defer(run, work, error).await,
    };
    let claim_run = Arc::clone(&run);
    let claim = tauri::async_runtime::spawn_blocking(move || {
        let _power_commit = claim_run
            .power_guard(true)
            .map_err(|_| ProviderCredentialError::Host)?;
        claim_run
            .cancel
            .commit(|| claim_run.host.claim_afternic_listing_write(work, observed))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(|_| ProviderCredentialError::Host)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    let Some(claim) = claim else {
        return Ok(());
    };
    let intent = approved_intent(claim.action(), claim.domain(), claim.fields());
    let mut guard = || run.claim_guard(&claim);
    // Every response, including a rejected/unknown write, becomes GET reconciliation. A power
    // event may drop this HTTP future; the durable claim then survives for GET on resume.
    let _outcome = tokio::select! {
        biased;
        _ = run.power.wait_for_epoch_change(run.epoch) => Err(AfternicError::AuthorityStale),
        result = provider.execute(credential, &intent, &mut guard) => result,
    };
    let work = claim.into_reconciliation();
    reconcile(run, work, provider, credential).await
}

fn approved_intent(
    action: DesktopAfternicListingWriteAction,
    domain: &str,
    patch: &DesktopAfternicListingWritePatch,
) -> AfternicListingIntent {
    let fields = AfternicListingFields {
        buynow_price: patch.buynow_price_micro_usd,
        floor_price: patch.floor_price_micro_usd,
        minbid_price: patch.minbid_price_micro_usd,
        hidden: patch.hidden,
    };
    match action {
        DesktopAfternicListingWriteAction::Create => AfternicListingIntent::Create {
            domain: domain.to_owned(),
            fields,
        },
        DesktopAfternicListingWriteAction::Update => AfternicListingIntent::Update {
            domain: domain.to_owned(),
            fields,
        },
    }
}

async fn exact_get(
    run: &Run,
    work: &DesktopAfternicListingWriteWork,
    provider: &mut AfternicProviderClient,
    credential: &AfternicCredential,
) -> std::result::Result<Option<DesktopAfternicListingObservation>, AfternicError> {
    let domains = [work.domain().to_owned()];
    let mut guard = || run.work_guard(work);
    let mut result = tokio::select! {
        biased;
        _ = run.power.wait_for_epoch_change(run.epoch) => return Err(AfternicError::AuthorityStale),
        result = provider.observe(credential, &domains, &mut guard) => result?,
    };
    if result.len() != 1 {
        return Err(AfternicError::ProtocolRejected);
    }
    let row = result.remove(0);
    if row.domain != work.domain() {
        return Err(AfternicError::ProtocolRejected);
    }
    Ok(row.listing.map(observation))
}

async fn reconcile(
    run: Arc<Run>,
    work: DesktopAfternicListingWriteWork,
    provider: &mut AfternicProviderClient,
    credential: &AfternicCredential,
) -> Result<()> {
    let observed = match exact_get(&run, &work, provider, credential).await {
        Ok(value) => value,
        Err(error) => return defer(run, work, error).await,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _power_commit = run
            .power_guard(false)
            .map_err(|_| ProviderCredentialError::Host)?;
        run.cancel
            .commit(|| run.host.reconcile_afternic_listing_write(&work, observed))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(|_| ProviderCredentialError::Host)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}
async fn defer(
    run: Arc<Run>,
    work: DesktopAfternicListingWriteWork,
    error: AfternicError,
) -> Result<()> {
    let retry = if let AfternicError::RateLimited {
        retry_after_seconds,
    } = error
    {
        Some(retry_after_seconds)
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _power_commit = run
            .power_guard(false)
            .map_err(|_| ProviderCredentialError::Host)?;
        run.cancel
            .commit(|| run.host.defer_afternic_listing_write_read(&work, retry))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(|_| ProviderCredentialError::Host)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_or_malformed_slot_requires_remediation_but_locked_custody_remains_retryable() {
        assert!(requires_credential_remediation(
            AfternicError::CustodyMismatch
        ));
        for transient in [
            AfternicError::CustodyUnavailable,
            AfternicError::AuthorityStale,
            AfternicError::OutcomeUnknown,
            AfternicError::Retryable,
        ] {
            assert!(!requires_credential_remediation(transient));
        }
    }

    #[test]
    fn power_change_during_host_recheck_cannot_reach_network() {
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
    }
    #[test]
    fn cancellation_during_host_recheck_cannot_reach_network() {
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
    fn create_is_explicit_and_update_preserves_omission_zero_and_false() {
        let patch = DesktopAfternicListingWritePatch {
            buynow_price_micro_usd: Some(0),
            floor_price_micro_usd: None,
            minbid_price_micro_usd: None,
            hidden: Some(false),
        };
        let AfternicListingIntent::Update { fields, .. } = approved_intent(
            DesktopAfternicListingWriteAction::Update,
            "example.com",
            &patch,
        ) else {
            panic!("wrong action")
        };
        assert_eq!(fields.buynow_price, Some(0));
        assert_eq!(fields.hidden, Some(false));
        assert_eq!(fields.floor_price, None);
        assert_eq!(fields.minbid_price, None);
        let values = DesktopAfternicListingWritePatch {
            floor_price_micro_usd: Some(0),
            minbid_price_micro_usd: Some(20_000_000),
            ..patch
        };
        let AfternicListingIntent::Create { fields, .. } = approved_intent(
            DesktopAfternicListingWriteAction::Create,
            "example.com",
            &values,
        ) else {
            panic!("wrong action")
        };
        assert_eq!(fields.buynow_price, Some(0));
        assert_eq!(fields.floor_price, Some(0));
        assert_eq!(fields.minbid_price, Some(20_000_000));
        assert_eq!(fields.hidden, Some(false));
    }
}
