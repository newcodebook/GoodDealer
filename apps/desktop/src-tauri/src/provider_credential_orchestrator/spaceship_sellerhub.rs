//! `SellerHub` uses the same Spaceship transport, custody, power guard and Provider lane.
use super::{
    Arc, DesktopNativeCloudAdmission, ProviderCredentialError, Result, Run, SpaceshipCapture,
    SpaceshipClient, SpaceshipCredential, SpaceshipCredentialPlan, SpaceshipError, SpaceshipGuard,
    host_error, load_spaceship_credential_guarded, native_error,
    publish_spaceship_credential_guarded, purge_spaceship_credential_guarded,
};
use gooddealer_local_storage::{
    DesktopSellerHubBinClaim, DesktopSellerHubBinWork, DesktopSellerHubConnection,
    DesktopSellerHubListingFact, DesktopSellerHubListingState, DesktopSellerHubStatus,
    DesktopSpaceshipConnectionState,
};
use gooddealer_secure_host_core::{SpaceshipSellerHubListing, SpaceshipSellerHubStatus};

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

    fn sellerhub_check_preparation(&self, admission: &DesktopNativeCloudAdmission) -> Result<()> {
        drop(self.hold_power().map_err(native_error)?);
        self.host
            .recheck_sellerhub_connection_preparation(admission)
            .map_err(host_error)?;
        drop(self.hold_power().map_err(native_error)?);
        Ok(())
    }

    pub(crate) async fn sellerhub_connect(self: &Arc<Self>) -> Result<()> {
        if !SpaceshipCapture::supported() {
            return Err(ProviderCredentialError::Unavailable);
        }
        let capture = Arc::clone(self);
        let (admission, credential) = tauri::async_runtime::spawn_blocking(move || {
            let admission = capture.host.begin_native_cloud_run().map_err(host_error)?;
            capture.sellerhub_check_preparation(&admission)?;
            let credential = SpaceshipCapture::capture_guarded(&mut || {
                capture
                    .sellerhub_check_preparation(&admission)
                    .map_err(|_| SpaceshipError::AuthorityStale)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>((admission, credential))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        // A rejected or incomplete first read never creates a durable connection. Once custody
        // confirms the same candidate bytes, the scan can be published without a second request.
        let listings = self
            .sellerhub_scan(&credential, &mut || {
                self.sellerhub_check_preparation(&admission)
                    .map_err(|_| SpaceshipError::AuthorityStale)
            })
            .await?;
        let publish = Arc::clone(self);
        let connection = tauri::async_runtime::spawn_blocking(move || {
            let connection = publish.commit(|host| {
                host.prepare_sellerhub_connection(admission, "Spaceship SellerHub")
            })?;
            publish_spaceship_credential_guarded(&Slot(&connection), &credential, &mut || {
                publish.sellerhub_check(&connection)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>(connection)
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        self.sellerhub_commit_inventory(connection, listings).await
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
                    let retired =
                        run.commit(|host| host.abandon_sellerhub_preparation(connection))?;
                    run.sellerhub_purge_and_confirm(&retired)?;
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
            .await?;
        drop(credential);
        self.sellerhub_commit_inventory(connection, listings).await
    }

    pub(crate) async fn sellerhub_revoke(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || run.sellerhub_revoke_blocking(&id))
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    fn sellerhub_revoke_blocking(&self, id: &str) -> Result<()> {
        let connection = self
            .commit(|host| host.revoke_sellerhub_connection(host.begin_native_cloud_run()?, id))?;
        self.sellerhub_purge_and_confirm(&connection)
    }

    fn sellerhub_purge_and_confirm(&self, connection: &DesktopSellerHubConnection) -> Result<()> {
        purge_spaceship_credential_guarded(&Slot(connection), &mut || {
            self.sellerhub_check(connection)
        })
        .map_err(native_error)?;
        self.commit(|host| host.confirm_sellerhub_purge(connection))
    }

    async fn sellerhub_scan(
        &self,
        credential: &SpaceshipCredential,
        guard: &mut SpaceshipGuard<'_>,
    ) -> Result<Vec<DesktopSellerHubListingFact>> {
        let client = SpaceshipClient::production().map_err(native_error)?;
        let listings = tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
            result = client.scan_sellerhub_listings(credential, guard) => result,
        }
        .map_err(native_error)?;
        Ok(listings.into_iter().map(listing_fact).collect())
    }

    async fn sellerhub_commit_inventory(
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
                let _ = self.sellerhub_revoke(row.connection_id).await;
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
