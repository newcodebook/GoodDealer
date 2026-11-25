//! Connect and recover Spaceship through the existing serial Provider lane. One API key forms one
//! connection; the Registrar and `SellerHub` roles it proves share that connection's Native slot.
#[path = "spaceship_sellerhub.rs"]
mod sellerhub;

use super::ProviderCredentialError;
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission, DesktopRegistrationFact,
    DesktopRegistrationStanding, DesktopSpaceshipAccount, DesktopSpaceshipConnection,
    DesktopSpaceshipConnectionState, DesktopSpaceshipRegistrarStatus, SpaceshipRoles,
};
use gooddealer_secure_host_core::{
    NativePowerCommitGuard, NativePowerGate, SpaceshipCapture, SpaceshipClient,
    SpaceshipCredential, SpaceshipCredentialPlan, SpaceshipError, SpaceshipGuard,
    SpaceshipRegistration, SpaceshipRegistrationStanding, load_spaceship_credential_guarded,
    publish_spaceship_credential_guarded, purge_spaceship_credential_guarded,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

struct Slot<'a>(&'a DesktopSpaceshipConnection);
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

/// The whole connection's slot; every role derives the same key from the same incarnation.
struct AccountSlot<'a>(&'a DesktopSpaceshipAccount);
impl SpaceshipCredentialPlan for AccountSlot<'_> {
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

/// A role the key's scopes do not cover answers `Forbidden` and is left out of the connection.
/// Any other failure rejects the key before anything is stored.
fn proven<T>(probe: std::result::Result<T, SpaceshipError>) -> Result<Option<T>> {
    match probe {
        Ok(value) => Ok(Some(value)),
        Err(SpaceshipError::Forbidden) => Ok(None),
        Err(error) => Err(native_error(error)),
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

    fn hold_power(&self) -> std::result::Result<NativePowerCommitGuard<'_>, SpaceshipError> {
        let held = if self.recovering {
            self.power.hold_reconciliation_epoch(self.epoch)
        } else {
            self.power.hold_write_epoch(self.epoch)
        }
        .map_err(|_| SpaceshipError::AuthorityStale)?;
        if self.cancel.is_cancelled() {
            return Err(SpaceshipError::AuthorityStale);
        }
        Ok(held)
    }

    fn check(
        &self,
        connection: &DesktopSpaceshipConnection,
    ) -> std::result::Result<(), SpaceshipError> {
        drop(self.hold_power()?);
        self.host
            .recheck_spaceship_connection(connection)
            .map_err(|_| SpaceshipError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn check_account(
        &self,
        account: &DesktopSpaceshipAccount,
    ) -> std::result::Result<(), SpaceshipError> {
        drop(self.hold_power()?);
        self.host
            .recheck_spaceship_account(account)
            .map_err(|_| SpaceshipError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn check_preparation(
        &self,
        admission: &DesktopNativeCloudAdmission,
        required: Option<SpaceshipRoles>,
    ) -> Result<SpaceshipRoles> {
        drop(self.hold_power().map_err(native_error)?);
        let roles = self
            .host
            .recheck_spaceship_account_preparation(admission, required)
            .map_err(host_error)?;
        drop(self.hold_power().map_err(native_error)?);
        Ok(roles)
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
        if !SpaceshipCapture::supported() {
            return Err(ProviderCredentialError::Unavailable);
        }
        let capture = Arc::clone(self);
        let (admission, offered, credential) = tauri::async_runtime::spawn_blocking(move || {
            let admission = capture.host.begin_native_cloud_run().map_err(host_error)?;
            let offered = capture.check_preparation(&admission, None)?;
            let credential = SpaceshipCapture::capture_guarded(&mut || {
                capture
                    .check_preparation(&admission, Some(offered))
                    .map(drop)
                    .map_err(|_| SpaceshipError::AuthorityStale)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>((admission, offered, credential))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        // A rejected or incomplete first read never creates a durable connection. Each admitted
        // role is probed with the same candidate key; the roles it proves form the connection,
        // and once custody confirms those bytes their scans publish without a second request.
        let mut guard = || {
            self.check_preparation(&admission, Some(offered))
                .map(drop)
                .map_err(|_| SpaceshipError::AuthorityStale)
        };
        let registrations = if offered.registrar {
            proven(self.scan(&credential, &mut guard).await)?
        } else {
            None
        };
        let listings = if offered.marketplace {
            proven(self.sellerhub_scan(&credential, &mut guard).await)?
        } else {
            None
        };
        let roles = SpaceshipRoles {
            registrar: registrations.is_some(),
            marketplace: listings.is_some(),
        };
        if !roles.registrar && !roles.marketplace {
            return Err(ProviderCredentialError::CredentialRejected);
        }
        let publish = Arc::clone(self);
        let id = tauri::async_runtime::spawn_blocking(move || {
            let account = publish
                .commit(|host| host.prepare_spaceship_account(admission, "Spaceship", roles))?;
            publish_spaceship_credential_guarded(&AccountSlot(&account), &credential, &mut || {
                publish.check_account(&account)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>(account.connection_id().to_owned())
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        // Each role publishes its own first scan. A failure leaves that role's scan pending for
        // recovery without undoing the roles already published.
        if let Some(registrations) = registrations {
            let connection = self.resume(&id).await?;
            self.commit_inventory(connection, registrations).await?;
        }
        if let Some(listings) = listings {
            let connection = self.sellerhub_resume(&id).await?;
            self.sellerhub_commit_inventory(connection, listings)
                .await?;
        }
        Ok(())
    }

    async fn resume(self: &Arc<Self>, id: &str) -> Result<DesktopSpaceshipConnection> {
        let run = Arc::clone(self);
        let id = id.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            run.commit(|host| host.resume_spaceship_connection(host.begin_native_cloud_run()?, &id))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    pub(crate) async fn refresh(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        let work = tauri::async_runtime::spawn_blocking(move || {
            let connection = run.commit(|host| {
                host.resume_spaceship_connection(host.begin_native_cloud_run()?, &id)
            })?;
            let credential = load_spaceship_credential_guarded(&Slot(&connection), &mut || {
                run.check(&connection)
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
        let registrations = self
            .scan(&credential, &mut || self.check(&connection))
            .await
            .map_err(native_error)?;
        drop(credential);
        self.commit_inventory(connection, registrations).await
    }

    pub(crate) async fn revoke(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || run.revoke_blocking(&id))
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    /// Retires the whole connection: every role is denied before the shared slot is removed.
    fn revoke_blocking(&self, id: &str) -> Result<()> {
        let account =
            self.commit(|host| host.revoke_spaceship_account(host.begin_native_cloud_run()?, id))?;
        purge_spaceship_credential_guarded(&AccountSlot(&account), &mut || {
            self.check_account(&account)
        })
        .map_err(native_error)?;
        self.commit(|host| host.confirm_spaceship_account_purge(&account))
    }

    async fn scan(
        &self,
        credential: &SpaceshipCredential,
        guard: &mut SpaceshipGuard<'_>,
    ) -> std::result::Result<Vec<DesktopRegistrationFact>, SpaceshipError> {
        let client = SpaceshipClient::production()?;
        let registrations = tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(SpaceshipError::AuthorityStale),
            result = client.scan_registrations(credential, guard) => result,
        }?;
        Ok(registrations.into_iter().map(registration_fact).collect())
    }

    async fn commit_inventory(
        self: &Arc<Self>,
        connection: DesktopSpaceshipConnection,
        registrations: Vec<DesktopRegistrationFact>,
    ) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            run.commit(|host| {
                host.commit_spaceship_inventory(&connection, &registrations)
                    .map(|_| ())
            })
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    async fn status(&self) -> Result<DesktopSpaceshipRegistrarStatus> {
        let host = Arc::clone(&self.host);
        tauri::async_runtime::spawn_blocking(move || host.read_spaceship_registrar_status())
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
            if row.state == DesktopSpaceshipConnectionState::Revoked {
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
            .any(|row| row.state == DesktopSpaceshipConnectionState::Revoked)
        {
            return Err(ProviderCredentialError::Keychain);
        }
        Ok(())
    }
}

fn registration_fact(row: SpaceshipRegistration) -> DesktopRegistrationFact {
    DesktopRegistrationFact {
        domain: row.domain,
        registered_on: row.registered_on,
        expires_on: Some(row.expires_on),
        auto_renew: Some(row.auto_renew),
        locked: Some(row.transfer_locked),
        standing: match row.standing {
            SpaceshipRegistrationStanding::Active => DesktopRegistrationStanding::Active,
            SpaceshipRegistrationStanding::Pending => DesktopRegistrationStanding::Pending,
            SpaceshipRegistrationStanding::Inactive => DesktopRegistrationStanding::Inactive,
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

const fn native_error(error: SpaceshipError) -> ProviderCredentialError {
    match error {
        SpaceshipError::AuthorityStale => ProviderCredentialError::Host,
        SpaceshipError::CaptureCancelled | SpaceshipError::InputRejected => {
            ProviderCredentialError::Capture
        }
        SpaceshipError::CustodyUnavailable
        | SpaceshipError::CustodyMismatch
        | SpaceshipError::CustodyOutcomeUnknown => ProviderCredentialError::Keychain,
        SpaceshipError::AuthenticationRequired | SpaceshipError::Forbidden => {
            ProviderCredentialError::CredentialRejected
        }
        SpaceshipError::RateLimited => ProviderCredentialError::ProviderRetryLater,
        SpaceshipError::Unavailable => ProviderCredentialError::ProviderUnreachable,
        SpaceshipError::ProtocolRejected => ProviderCredentialError::ProviderResponseRejected,
    }
}
