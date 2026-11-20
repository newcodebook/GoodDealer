//! Afternic's single-item runner. The Host owns durable plans, claims, retries and results.
use super::{
    ProviderCredentialError,
    afternic::{ConnectionPlan, observation},
};
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopAfternicConnection, DesktopAfternicListingObservation, DesktopAfternicListingPlanAction,
    DesktopAfternicListingPlanClaim, DesktopAfternicListingPlanWork,
    DesktopAfternicListingWriteAction, DesktopAfternicListingWriteClaim,
    DesktopAfternicListingWritePatch, DesktopAfternicListingWriteWork,
    DesktopAfternicListingWriteWorkKind, DesktopLocalHost,
};
use gooddealer_secure_host_core::{
    AfternicCredential, AfternicError, AfternicListingFields, AfternicListingIntent,
    AfternicProviderClient, NativePowerGate, load_afternic_credential_guarded,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

#[derive(Clone, Copy, Default)]
pub(crate) enum ListingTurn {
    #[default]
    ListingWrite,
    ListingPlan,
}
impl ListingTurn {
    const fn other(self) -> Self {
        match self {
            Self::ListingWrite => Self::ListingPlan,
            Self::ListingPlan => Self::ListingWrite,
        }
    }

    pub(crate) fn take(&mut self) -> Self {
        let turn = *self;
        *self = turn.other();
        turn
    }

    fn select<T, E>(
        self,
        mut read: impl FnMut(Self) -> std::result::Result<Option<T>, E>,
    ) -> std::result::Result<Option<T>, E> {
        if let Some(work) = read(self)? {
            return Ok(Some(work));
        }
        read(self.other())
    }
}

enum Work {
    ListingWrite(DesktopAfternicListingWriteWork),
    ListingPlan(DesktopAfternicListingPlanWork),
}
impl Work {
    fn kind(&self) -> DesktopAfternicListingWriteWorkKind {
        match self {
            Self::ListingWrite(work) => work.kind(),
            Self::ListingPlan(work) => work.kind(),
        }
    }
    fn connection(&self) -> &DesktopAfternicConnection {
        match self {
            Self::ListingWrite(work) => work.connection(),
            Self::ListingPlan(work) => work.connection(),
        }
    }
    fn domain(&self) -> &str {
        match self {
            Self::ListingWrite(work) => work.domain(),
            Self::ListingPlan(work) => work.domain(),
        }
    }
}

enum Claim {
    ListingWrite(DesktopAfternicListingWriteClaim),
    ListingPlan(DesktopAfternicListingPlanClaim),
}
impl Claim {
    fn intent(&self) -> Option<AfternicListingIntent> {
        match self {
            Self::ListingWrite(claim) => Some(approved_intent(
                claim.action(),
                claim.domain(),
                claim.fields(),
            )),
            Self::ListingPlan(claim) => plan_intent(claim.action(), claim.domain(), claim.fields()),
        }
    }
    fn into_reconciliation(self) -> Work {
        match self {
            Self::ListingWrite(claim) => Work::ListingWrite(claim.into_reconciliation()),
            Self::ListingPlan(claim) => Work::ListingPlan(claim.into_reconciliation()),
        }
    }
}

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
    fn work_guard(&self, work: &Work) -> std::result::Result<(), AfternicError> {
        recheck_with_power(
            &self.power,
            &self.cancel,
            self.epoch,
            matches!(work.kind(), DesktopAfternicListingWriteWorkKind::Preflight),
            || match work {
                Work::ListingWrite(work) => self.host.recheck_afternic_listing_write_work(work),
                Work::ListingPlan(work) => self.host.recheck_afternic_listing_plan_work(work),
            },
        )
    }
    fn claim_guard(&self, claim: &Claim) -> std::result::Result<(), AfternicError> {
        recheck_with_power(
            &self.power,
            &self.cancel,
            self.epoch,
            true,
            || match claim {
                Claim::ListingWrite(claim) => self.host.recheck_afternic_listing_write_claim(claim),
                Claim::ListingPlan(claim) => self.host.recheck_afternic_listing_plan_claim(claim),
            },
        )
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
    turn: ListingTurn,
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
                turn.select(|version| {
                    let admission = prepare.host.begin_native_cloud_run()?;
                    match version {
                        ListingTurn::ListingWrite => prepare
                            .host
                            .next_afternic_listing_write_work(admission)
                            .map(|work| work.map(Work::ListingWrite)),
                        ListingTurn::ListingPlan => prepare
                            .host
                            .next_afternic_listing_plan_work(admission)
                            .map(|work| work.map(Work::ListingPlan)),
                    }
                })
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
async fn credential_failure(run: Arc<Run>, work: Work, error: AfternicError) -> Result<()> {
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
    work: Work,
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
            .commit(|| match work {
                Work::ListingWrite(work) => claim_run
                    .host
                    .claim_afternic_listing_write(work, observed)
                    .map(|claim| claim.map(Claim::ListingWrite)),
                Work::ListingPlan(work) => claim_run
                    .host
                    .claim_afternic_listing_plan(work, observed)
                    .map(|claim| claim.map(Claim::ListingPlan)),
            })
            .ok_or(ProviderCredentialError::Host)?
            .map_err(|_| ProviderCredentialError::Host)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)??;
    let Some(claim) = claim else {
        return Ok(());
    };
    if let Some(intent) = claim.intent() {
        let mut guard = || run.claim_guard(&claim);
        // Every response, including a rejected/unknown write, becomes GET reconciliation. A power
        // event may drop this HTTP future; the durable claim then survives for GET on resume.
        let _outcome = tokio::select! {
            biased;
            _ = run.power.wait_for_epoch_change(run.epoch) => Err(AfternicError::AuthorityStale),
            result = provider.execute(credential, &intent, &mut guard) => result,
        };
    }
    let work = claim.into_reconciliation();
    reconcile(run, work, provider, credential).await
}

fn plan_intent(
    action: DesktopAfternicListingPlanAction,
    domain: &str,
    patch: Option<&DesktopAfternicListingWritePatch>,
) -> Option<AfternicListingIntent> {
    let intent = match (action, patch) {
        (DesktopAfternicListingPlanAction::Create, Some(patch)) => {
            approved_intent(DesktopAfternicListingWriteAction::Create, domain, patch)
        }
        (DesktopAfternicListingPlanAction::Update, Some(patch)) => {
            approved_intent(DesktopAfternicListingWriteAction::Update, domain, patch)
        }
        (DesktopAfternicListingPlanAction::ReactivateOwnershipReview, None) => {
            AfternicListingIntent::ReactivateOwnershipReview {
                domain: domain.to_owned(),
            }
        }
        _ => return None,
    };
    Some(intent)
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
    work: &Work,
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
    work: Work,
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
            .commit(|| match &work {
                Work::ListingWrite(work) => {
                    run.host.reconcile_afternic_listing_write(work, observed)
                }
                Work::ListingPlan(work) => run.host.reconcile_afternic_listing_plan(work, observed),
            })
            .ok_or(ProviderCredentialError::Host)?
            .map_err(|_| ProviderCredentialError::Host)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}
async fn defer(run: Arc<Run>, work: Work, error: AfternicError) -> Result<()> {
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
            .commit(|| match &work {
                Work::ListingWrite(work) => run.host.defer_afternic_listing_write_read(work, retry),
                Work::ListingPlan(work) => run.host.defer_afternic_listing_plan_read(work, retry),
            })
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
    fn hot_v1_backlog_cannot_starve_v2_in_the_same_lane() {
        let mut turn = ListingTurn::default();
        let mut reads = Vec::new();
        for _ in 0..4 {
            let claimed = turn.take().select(|version| {
                let is_v2 = matches!(version, ListingTurn::ListingPlan);
                reads.push(is_v2);
                Ok::<_, ()>(Some(is_v2))
            });
            assert_eq!(claimed, Ok(reads.last().copied()));
        }
        assert_eq!(reads, [false, true, false, true]);
        assert_eq!(
            turn.take().select(|version| Ok::<_, ()>(
                matches!(version, ListingTurn::ListingPlan).then_some(2)
            )),
            Ok(Some(2))
        );
    }

    #[test]
    fn only_a_review_claim_without_listing_fields_can_send_reactivate() {
        let domain = "example.com";
        let patch = DesktopAfternicListingWritePatch {
            buynow_price_micro_usd: None,
            floor_price_micro_usd: None,
            minbid_price_micro_usd: None,
            hidden: Some(false),
        };
        let action = DesktopAfternicListingPlanAction::ReactivateOwnershipReview;
        assert!(
            matches!(plan_intent(action, domain, None), Some(AfternicListingIntent::ReactivateOwnershipReview { domain: value }) if value == domain)
        );
        assert!(plan_intent(action, domain, Some(&patch)).is_none());
        assert!(plan_intent(DesktopAfternicListingPlanAction::Create, domain, None).is_none());
        assert!(plan_intent(DesktopAfternicListingPlanAction::Update, domain, None).is_none());
    }

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
