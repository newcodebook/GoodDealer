//! Connect and recover the Sedo seller portfolio through the existing serial Provider lane.
use super::ProviderCredentialError;
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission, DesktopSedoConnection,
    DesktopSedoConnectionState, DesktopSedoCurrency, DesktopSedoMarketplaceListingFact,
    DesktopSedoMarketplaceStatus,
};
use gooddealer_secure_host_core::{
    NativePowerCommitGuard, NativePowerGate, SedoCapture, SedoCredential, SedoCredentialPlan,
    SedoCurrency, SedoError, SedoGuard, SedoListing, SedoPortfolioClient,
    load_sedo_credential_guarded, publish_sedo_credential_guarded, purge_sedo_credential_guarded,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

struct Slot<'a>(&'a DesktopSedoConnection);
impl SedoCredentialPlan for Slot<'_> {
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

pub(crate) struct Run {
    host: Arc<DesktopLocalHost>,
    cancel: Arc<NativeCloudCancelFence>,
    power: NativePowerGate,
    epoch: u64,
    recovering: bool,
}

impl Run {
    pub(crate) fn new(
        host: Arc<DesktopLocalHost>,
        cancel: Arc<NativeCloudCancelFence>,
        power: NativePowerGate,
        recovering: bool,
    ) -> Self {
        let epoch = power.snapshot().epoch;
        Self {
            host,
            cancel,
            power,
            epoch,
            recovering,
        }
    }

    fn hold_power(&self) -> std::result::Result<NativePowerCommitGuard<'_>, SedoError> {
        let held = if self.recovering {
            self.power.hold_reconciliation_epoch(self.epoch)
        } else {
            self.power.hold_write_epoch(self.epoch)
        }
        .map_err(|_| SedoError::AuthorityStale)?;
        if self.cancel.is_cancelled() {
            return Err(SedoError::AuthorityStale);
        }
        Ok(held)
    }

    fn check(&self, connection: &DesktopSedoConnection) -> std::result::Result<(), SedoError> {
        drop(self.hold_power()?);
        self.host
            .recheck_sedo_connection(connection)
            .map_err(|_| SedoError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn check_preparation(&self, admission: &DesktopNativeCloudAdmission) -> Result<()> {
        drop(self.hold_power().map_err(native_error)?);
        self.host
            .recheck_sedo_connection_preparation(admission)
            .map_err(host_error)?;
        drop(self.hold_power().map_err(native_error)?);
        Ok(())
    }

    fn commit<T>(
        &self,
        operation: impl FnOnce(&DesktopLocalHost) -> std::result::Result<T, DesktopLocalHostError>,
    ) -> Result<T> {
        let _power = self.hold_power().map_err(native_error)?;
        self.cancel
            .commit(|| operation(&self.host))
            .ok_or(ProviderCredentialError::Host)?
            .map_err(host_error)
    }

    pub(crate) async fn connect(self: &Arc<Self>) -> Result<()> {
        if !SedoCapture::supported() {
            return Err(ProviderCredentialError::Unavailable);
        }
        let capture = Arc::clone(self);
        let (admission, credential) = tauri::async_runtime::spawn_blocking(move || {
            let admission = capture.host.begin_native_cloud_run().map_err(host_error)?;
            capture.check_preparation(&admission)?;
            let credential = SedoCapture::capture_guarded(&mut || {
                capture
                    .check_preparation(&admission)
                    .map_err(|_| SedoError::AuthorityStale)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>((admission, credential))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        // A rejected or incomplete first read never creates a durable connection. Once custody
        // confirms the same candidate bytes, the scan can be published without a second request.
        let inventory = self
            .scan(&credential, &mut || {
                self.check_preparation(&admission)
                    .map_err(|_| SedoError::AuthorityStale)
            })
            .await?;
        let publish = Arc::clone(self);
        let connection = tauri::async_runtime::spawn_blocking(move || {
            let connection =
                publish.commit(|host| host.prepare_sedo_connection(admission, "Sedo"))?;
            publish_sedo_credential_guarded(&Slot(&connection), &credential, &mut || {
                publish.check(&connection)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>(connection)
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        self.commit_inventory(connection, inventory).await
    }

    pub(crate) async fn refresh(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        let work = tauri::async_runtime::spawn_blocking(move || {
            let connection = run
                .commit(|host| host.resume_sedo_connection(host.begin_native_cloud_run()?, &id))?;
            let credential =
                load_sedo_credential_guarded(&Slot(&connection), &mut || run.check(&connection))
                    .map_err(native_error)?;
            match credential {
                Some(credential) => Ok(Some((connection, credential))),
                None if connection.is_prepared() => {
                    let retired = run.commit(|host| host.abandon_sedo_preparation(connection))?;
                    run.purge_and_confirm(&retired)?;
                    Ok(None)
                }
                None => Err(ProviderCredentialError::Keychain),
            }
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        let (connection, credential) = work.ok_or(ProviderCredentialError::Keychain)?;
        let inventory = self
            .scan(&credential, &mut || self.check(&connection))
            .await?;
        drop(credential);
        self.commit_inventory(connection, inventory).await
    }

    pub(crate) async fn revoke(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || run.revoke_blocking(&id))
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    fn revoke_blocking(&self, id: &str) -> Result<()> {
        let connection =
            self.commit(|host| host.revoke_sedo_connection(host.begin_native_cloud_run()?, id))?;
        self.purge_and_confirm(&connection)
    }

    fn purge_and_confirm(&self, connection: &DesktopSedoConnection) -> Result<()> {
        purge_sedo_credential_guarded(&Slot(connection), &mut || self.check(connection))
            .map_err(native_error)?;
        self.commit(|host| host.confirm_sedo_purge(connection))
    }

    async fn scan(
        &self,
        credential: &SedoCredential,
        guard: &mut SedoGuard<'_>,
    ) -> Result<Vec<SedoListing>> {
        let client = SedoPortfolioClient::production().map_err(native_error)?;
        tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(SedoError::AuthorityStale),
            result = client.inventory(credential, guard) => result,
        }
        .map_err(native_error)
    }

    async fn commit_inventory(
        self: &Arc<Self>,
        connection: DesktopSedoConnection,
        inventory: Vec<SedoListing>,
    ) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            let listings: Vec<_> = inventory.into_iter().map(listing_fact).collect();
            run.commit(|host| {
                host.commit_sedo_inventory(&connection, &listings)
                    .map(|_| ())
            })
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    async fn status(&self) -> Result<DesktopSedoMarketplaceStatus> {
        let host = Arc::clone(&self.host);
        tauri::async_runtime::spawn_blocking(move || host.read_sedo_marketplace_status())
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
            .map_err(host_error)
    }

    pub(crate) async fn recover(self: &Arc<Self>) -> Result<()> {
        let status = self.status().await?;
        // Complete interrupted local retirement separately from read-only scans. A scan failure
        // preserves the last receipt and leaves the manual refresh path available.
        for row in status.connections {
            drop(self.hold_power().map_err(native_error)?);
            if row.state == DesktopSedoConnectionState::Revoked {
                let _ = self.revoke(row.connection_id).await;
            } else if status.observe_entitled && status.observe_qualified && row.scan_pending {
                let _ = self.refresh(row.connection_id).await;
            }
        }
        // A refresh can retire a preparation when custody proves the slot absent. Reread
        // durable state so a failed purge/confirmation in that branch also keeps the gate closed.
        let current = self.status().await?;
        drop(self.hold_power().map_err(native_error)?);
        if current
            .connections
            .iter()
            .any(|row| row.state == DesktopSedoConnectionState::Revoked)
        {
            return Err(ProviderCredentialError::Keychain);
        }
        Ok(())
    }
}

fn listing_fact(row: SedoListing) -> DesktopSedoMarketplaceListingFact {
    DesktopSedoMarketplaceListingFact {
        domain: row.domain,
        for_sale: row.for_sale,
        fixed_price: row.fixed_price,
        price_cents: row.price_cents,
        currency: match row.currency {
            SedoCurrency::Eur => DesktopSedoCurrency::Eur,
            SedoCurrency::Usd => DesktopSedoCurrency::Usd,
            SedoCurrency::Gbp => DesktopSedoCurrency::Gbp,
        },
    }
}
fn host_error(error: DesktopLocalHostError) -> ProviderCredentialError {
    if error == DesktopLocalHostError::CapabilityUnqualified {
        ProviderCredentialError::Unqualified
    } else {
        ProviderCredentialError::Host
    }
}

const fn native_error(error: SedoError) -> ProviderCredentialError {
    match error {
        SedoError::AuthorityStale => ProviderCredentialError::Host,
        SedoError::CaptureCancelled | SedoError::InputRejected => ProviderCredentialError::Capture,
        SedoError::CustodyUnavailable
        | SedoError::CustodyMismatch
        | SedoError::CustodyOutcomeUnknown => ProviderCredentialError::Keychain,
        SedoError::AuthenticationRequired | SedoError::Forbidden => {
            ProviderCredentialError::CredentialRejected
        }
        SedoError::RateLimited => ProviderCredentialError::ProviderRetryLater,
        SedoError::Unavailable => ProviderCredentialError::ProviderUnreachable,
        SedoError::ProviderFault | SedoError::ProtocolRejected => {
            ProviderCredentialError::ProviderResponseRejected
        }
    }
}
