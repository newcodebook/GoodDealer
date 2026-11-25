//! Fixed-price creation and readback over the `SellerHub` credential slot.
use super::{
    Arc, ProviderCredentialError, Result, Run, Slot, SpaceshipClient, SpaceshipError, host_error,
    load_spaceship_credential_guarded, native_error,
};
use gooddealer_local_storage::{
    DesktopSellerHubCreateClaim, DesktopSellerHubCreateWork, SellerHubCreateReadback,
};
use gooddealer_secure_host_core::SpaceshipSellerHubCreateObservation;

impl Run {
    pub(crate) async fn sellerhub_create_step(self: &Arc<Self>) -> Result<bool> {
        let run = Arc::clone(self);
        let loaded = tauri::async_runtime::spawn_blocking(move || {
            let work =
                run.commit(|host| host.next_sellerhub_create_work(host.begin_native_cloud_run()?))?;
            Ok::<_, ProviderCredentialError>(work.map(|work| {
                let credential = work.connection().and_then(|slot| {
                    load_spaceship_credential_guarded(&Slot(slot), &mut || {
                        run.creation_read_guard(&work)
                    })
                    .ok()
                    .flatten()
                });
                (work, credential)
            }))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        let Some((work, credential)) = loaded else {
            return Ok(false);
        };
        let client = SpaceshipClient::production().map_err(native_error)?;
        if work.reconciliation_only() {
            let read = match &credential {
                Some(credential) => {
                    let mut guard = || self.creation_read_guard(&work);
                    tokio::select! {
                        biased;
                        _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
                        result = client.observe_sellerhub_listing_create(credential,work.domain(),work.price_cents(),&mut guard) => result,
                    }
                }
                None => Err(SpaceshipError::CustodyMismatch),
            };
            if matches!(read, Err(SpaceshipError::AuthorityStale)) {
                return Ok(false);
            }
            let retry = matches!(read, Err(SpaceshipError::RateLimited)).then_some(60);
            let outcome = match read {
                Ok(SpaceshipSellerHubCreateObservation::Published) => {
                    SellerHubCreateReadback::Published
                }
                Ok(SpaceshipSellerHubCreateObservation::WaitingForOwnership) => {
                    SellerHubCreateReadback::OwnershipPending
                }
                Ok(SpaceshipSellerHubCreateObservation::TermsUnconfirmed) => {
                    SellerHubCreateReadback::TermsUnconfirmed
                }
                Ok(SpaceshipSellerHubCreateObservation::NotPublished(_)) => {
                    SellerHubCreateReadback::StateBlocked
                }
                Err(_) => SellerHubCreateReadback::ReadFailed,
            };
            let run = Arc::clone(self);
            tauri::async_runtime::spawn_blocking(move || {
                run.commit(|host| host.settle_sellerhub_create(&work, outcome, retry))
            })
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)??;
            return Ok(true);
        }

        let inventory = if let Some(credential) = &credential {
            let mut guard = || self.creation_read_guard(&work);
            let read = tokio::select! {
                biased;
                _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
                result = client.scan_sellerhub_listings(credential,&mut guard) => result,
            };
            read.ok()
                .map(|rows| rows.into_iter().map(|row| row.domain).collect::<Vec<_>>())
        } else {
            None
        };
        let run = Arc::clone(self);
        let claim = tauri::async_runtime::spawn_blocking(move || {
            let _power = run
                .power
                .hold_write_epoch(run.epoch)
                .map_err(|_| ProviderCredentialError::Host)?;
            run.cancel
                .commit(|| {
                    run.host
                        .commit_sellerhub_create_preflight(work, inventory.as_deref())
                })
                .ok_or(ProviderCredentialError::Host)?
                .map_err(host_error)
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        if let (Some(claim), Some(credential)) = (claim, credential) {
            let (domain, cents) = claim.details();
            let mut guard = || self.creation_dispatch_guard(&claim);
            // The committed claim is consumed by this dispatch. All later turns use exact GET.
            let _ = tokio::select! {
                biased;
                _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
                result = client.send_sellerhub_listing_create(&credential,domain,cents,&mut guard) => result,
            };
        }
        Ok(true)
    }

    fn creation_read_guard(
        &self,
        work: &DesktopSellerHubCreateWork,
    ) -> std::result::Result<(), SpaceshipError> {
        drop(self.hold_power()?);
        self.host
            .recheck_sellerhub_create_read(work)
            .map_err(|_| SpaceshipError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn creation_dispatch_guard(
        &self,
        claim: &DesktopSellerHubCreateClaim,
    ) -> std::result::Result<(), SpaceshipError> {
        drop(
            self.power
                .hold_write_epoch(self.epoch)
                .map_err(|_| SpaceshipError::AuthorityStale)?,
        );
        self.cancel
            .commit(|| self.host.recheck_sellerhub_create_dispatch(claim))
            .ok_or(SpaceshipError::AuthorityStale)?
            .map_err(|_| SpaceshipError::AuthorityStale)?;
        drop(
            self.power
                .hold_write_epoch(self.epoch)
                .map_err(|_| SpaceshipError::AuthorityStale)?,
        );
        if self.cancel.is_cancelled() {
            return Err(SpaceshipError::AuthorityStale);
        }
        Ok(())
    }
}
