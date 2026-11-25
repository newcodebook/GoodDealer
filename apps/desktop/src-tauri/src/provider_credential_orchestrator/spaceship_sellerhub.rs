//! `SellerHub` uses the same Spaceship transport, custody, power guard and Provider lane.
use super::{
    Arc, ProviderCredentialError, Result, Run, SpaceshipClient, SpaceshipCredential,
    SpaceshipCredentialPlan, SpaceshipError, SpaceshipGuard, host_error,
    load_spaceship_credential_guarded, native_error,
};
use gooddealer_local_storage::{
    DesktopSellerHubBinClaim, DesktopSellerHubBinWork, DesktopSellerHubConnection,
    DesktopSellerHubListingFact, DesktopSellerHubListingState, DesktopSellerHubStatus,
    DesktopSpaceshipConnectionState,
};
use gooddealer_secure_host_core::{SpaceshipSellerHubListing, SpaceshipSellerHubStatus};

#[path = "spaceship_sellerhub_creation.rs"]
mod creation;

struct Slot<'a>(&'a DesktopSellerHubConnection);
impl SpaceshipCredentialPlan for Slot<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation()
    }
    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
    }
    fn generation(&self) -> u64 {
        1
    }
    fn public_proof(&self) -> &str {
        self.0.public_proof()
    }
}

impl Run {
    fn sellerhub_check(
        &self,
        connection: &DesktopSellerHubConnection,
    ) -> std::result::Result<(), SpaceshipError> {
        drop(self.hold_power()?);
        self.host
            .recheck_sellerhub_connection(connection)
            .map_err(|_| SpaceshipError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    pub(super) async fn sellerhub_resume(
        self: &Arc<Self>,
        id: &str,
    ) -> Result<DesktopSellerHubConnection> {
        let run = Arc::clone(self);
        let id = id.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            run.commit(|host| host.resume_sellerhub_connection(host.begin_native_cloud_run()?, &id))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    pub(crate) async fn sellerhub_refresh(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        let work = tauri::async_runtime::spawn_blocking(move || {
            let connection = run.commit(|host| {
                host.resume_sellerhub_connection(host.begin_native_cloud_run()?, &id)
            })?;
            let credential = load_spaceship_credential_guarded(&Slot(&connection), &mut || {
                run.sellerhub_check(&connection)
            })
            .map_err(native_error)?;
            match credential {
                Some(credential) => Ok(Some((connection, credential))),
                None if connection.is_prepared() => {
                    // Capture never completed custody for this connection, so retire all of it.
                    run.revoke_blocking(connection.connection_id())?;
                    Ok(None)
                }
                None => Err(ProviderCredentialError::Keychain),
            }
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        let (connection, credential) = work.ok_or(ProviderCredentialError::Keychain)?;
        let listings = self
            .sellerhub_scan(&credential, &mut || self.sellerhub_check(&connection))
            .await
            .map_err(native_error)?;
        drop(credential);
        self.sellerhub_commit_inventory(connection, listings).await
    }

    pub(super) async fn sellerhub_scan(
        &self,
        credential: &SpaceshipCredential,
        guard: &mut SpaceshipGuard<'_>,
    ) -> std::result::Result<Vec<DesktopSellerHubListingFact>, SpaceshipError> {
        let client = SpaceshipClient::production()?;
        let listings = tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
            result = client.scan_sellerhub_listings(credential, guard) => result,
        }?;
        Ok(listings.into_iter().map(listing_fact).collect())
    }

    pub(super) async fn sellerhub_commit_inventory(
        self: &Arc<Self>,
        connection: DesktopSellerHubConnection,
        listings: Vec<DesktopSellerHubListingFact>,
    ) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            run.commit(|host| {
                host.commit_sellerhub_inventory(&connection, &listings)
                    .map(|_| ())
            })
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    async fn sellerhub_status(&self) -> Result<DesktopSellerHubStatus> {
        let host = Arc::clone(&self.host);
        tauri::async_runtime::spawn_blocking(move || host.read_sellerhub_status())
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
            .map_err(host_error)
    }

    pub(crate) async fn sellerhub_bin_step(self: &Arc<Self>) -> Result<bool> {
        let run = Arc::clone(self);
        let loaded = tauri::async_runtime::spawn_blocking(move || {
            let work =
                run.commit(|host| host.next_sellerhub_bin_work(host.begin_native_cloud_run()?))?;
            Ok::<_, ProviderCredentialError>(work.map(|work| {
                let credential = if work.may_read_provider() {
                    load_spaceship_credential_guarded(&Slot(work.connection()), &mut || {
                        run.sellerhub_bin_read_guard(&work)
                    })
                } else {
                    Ok(None)
                };
                (work, credential)
            }))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        let Some((work, credential)) = loaded else {
            self.sellerhub_resume_pending_scan().await?;
            return Ok(false);
        };
        if !work.needs_reconciliation() && self.power.hold_write_epoch(self.epoch).is_err() {
            return Ok(false);
        }
        let client = SpaceshipClient::production().map_err(native_error)?;
        let read = match &credential {
            Ok(Some(credential)) => {
                let mut guard = || self.sellerhub_bin_read_guard(&work);
                tokio::select! {
                    biased;
                    _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
                    result = client.observe_sellerhub_listing(credential, work.domain(), &mut guard) => result,
                }
            }
            Ok(None) => Err(SpaceshipError::CustodyMismatch),
            Err(error) => Err(*error),
        };
        if matches!(read, Err(SpaceshipError::AuthorityStale)) {
            return Err(ProviderCredentialError::Host);
        }
        let retry = matches!(read, Err(SpaceshipError::RateLimited)).then_some(60);
        let observation = read.ok().map(listing_fact);
        let claim = self
            .sellerhub_commit_bin_read(work, observation, retry)
            .await?;
        if let (Some(claim), Ok(Some(credential))) = (claim, credential) {
            let (_, domain, cents) = claim.details();
            // Every outcome leaves the durable attempt in the same read-only reconciliation stage.
            let mut guard = || self.sellerhub_bin_dispatch_guard(&claim);
            let _ = tokio::select! {
                biased;
                _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
                result = client.send_sellerhub_bin_price(
                    &credential, domain, cents, &mut guard
                ) => result,
            };
        }
        Ok(true)
    }

    async fn sellerhub_commit_bin_read(
        self: &Arc<Self>,
        work: DesktopSellerHubBinWork,
        observed: Option<DesktopSellerHubListingFact>,
        retry: Option<u32>,
    ) -> Result<Option<DesktopSellerHubBinClaim>> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            if work.needs_reconciliation() {
                run.commit(|host| {
                    host.settle_sellerhub_bin_observation(&work, observed.as_ref(), retry)
                })?;
                return Ok(None);
            }
            let _power = run
                .power
                .hold_write_epoch(run.epoch)
                .map_err(|_| ProviderCredentialError::Host)?;
            run.cancel
                .commit(|| {
                    run.host
                        .commit_sellerhub_bin_preflight(work, observed.as_ref(), retry)
                })
                .ok_or(ProviderCredentialError::Host)?
                .map_err(host_error)
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    fn sellerhub_bin_read_guard(
        &self,
        work: &DesktopSellerHubBinWork,
    ) -> std::result::Result<(), SpaceshipError> {
        drop(self.hold_power()?);
        self.host
            .recheck_sellerhub_bin_read(work)
            .map_err(|_| SpaceshipError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn sellerhub_bin_dispatch_guard(
        &self,
        claim: &DesktopSellerHubBinClaim,
    ) -> std::result::Result<(), SpaceshipError> {
        drop(
            self.power
                .hold_write_epoch(self.epoch)
                .map_err(|_| SpaceshipError::AuthorityStale)?,
        );
        self.cancel
            .commit(|| self.host.recheck_sellerhub_bin_dispatch(claim))
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

    async fn sellerhub_resume_pending_scan(self: &Arc<Self>) -> Result<()> {
        let status = self.sellerhub_status().await?;
        if status.observe_entitled
            && status.observe_qualified
            && let Some(row) = status.connections.into_iter().find(|row| {
                row.scan_pending && row.state == DesktopSpaceshipConnectionState::Active
            })
        {
            self.sellerhub_refresh(row.connection_id).await?;
        }
        Ok(())
    }

    pub(crate) async fn sellerhub_recover(self: &Arc<Self>) -> Result<()> {
        let status = self.sellerhub_status().await?;
        // Complete interrupted local retirement separately from read-only scans. A scan failure
        // preserves the last receipt and leaves the manual refresh path available.
        for row in status.connections {
            drop(self.hold_power().map_err(native_error)?);
            if row.state == DesktopSpaceshipConnectionState::Revoked {
                let _ = self.revoke(row.connection_id).await;
            } else if status.observe_entitled && status.observe_qualified && row.scan_pending {
                let _ = self.sellerhub_refresh(row.connection_id).await;
            }
        }
        // A refresh can retire a preparation when custody proves the slot absent. Reread
        // durable state so a failed purge/confirmation in that branch also keeps the gate closed.
        let current = self.sellerhub_status().await?;
        drop(self.hold_power().map_err(native_error)?);
        if current
            .connections
            .iter()
            .any(|row| row.state == DesktopSpaceshipConnectionState::Revoked)
        {
            return Err(ProviderCredentialError::Keychain);
        }
        Ok(())
    }
}

fn listing_fact(row: SpaceshipSellerHubListing) -> DesktopSellerHubListingFact {
    use DesktopSellerHubListingState as Local;
    use SpaceshipSellerHubStatus as Wire;
    DesktopSellerHubListingFact {
        domain: row.domain,
        state: match row.status {
            Wire::Failed => Local::Failed,
            Wire::Verifying => Local::Verifying,
            Wire::OnSale => Local::OnSale,
            Wire::OnSaleStopped => Local::OnSaleStopped,
            Wire::SaleProcessing => Local::SaleProcessing,
            Wire::PrivateSale => Local::PrivateSale,
            Wire::LeaseActive => Local::LeaseActive,
            Wire::Sold => Local::Sold,
        },
        enabled_bin_price_usd: row
            .bin_price_usd
            .filter(|_| row.bin_price_enabled == Some(true)),
    }
}
