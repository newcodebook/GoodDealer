//! `SellerHub` uses the same Spaceship transport, custody, power guard and Provider lane.
use super::{
    Arc, DesktopNativeCloudAdmission, ProviderCredentialError, Result, Run, SpaceshipCapture,
    SpaceshipClient, SpaceshipCredential, SpaceshipCredentialPlan, SpaceshipError, SpaceshipGuard,
    host_error, load_spaceship_credential_guarded, native_error,
    publish_spaceship_credential_guarded, purge_spaceship_credential_guarded,
};
use gooddealer_local_storage::{
    DesktopSellerHubConnection, DesktopSellerHubListingFact, DesktopSellerHubListingState,
    DesktopSellerHubStatus, DesktopSpaceshipConnectionState,
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
