//! Connect and recover `GoDaddy` Registrar through the existing serial Provider lane.
use super::ProviderCredentialError;
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopGoDaddyConnection, DesktopGoDaddyConnectionState, DesktopGoDaddyRegistrarStatus,
    DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission, DesktopRegistrationFact,
    DesktopRegistrationStanding,
};
use gooddealer_secure_host_core::{
    GoDaddyCapture, GoDaddyCredential, GoDaddyCredentialPlan, GoDaddyError, GoDaddyGuard,
    GoDaddyRegistrarClient, GoDaddyRegistration, GoDaddyRegistrationStanding,
    NativePowerCommitGuard, NativePowerGate, load_godaddy_credential_guarded,
    publish_godaddy_credential_guarded, purge_godaddy_credential_guarded,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

struct Slot<'a>(&'a DesktopGoDaddyConnection);
impl GoDaddyCredentialPlan for Slot<'_> {
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

    fn hold_power(&self) -> std::result::Result<NativePowerCommitGuard<'_>, GoDaddyError> {
        let held = if self.recovering {
            self.power.hold_reconciliation_epoch(self.epoch)
        } else {
            self.power.hold_write_epoch(self.epoch)
        }
        .map_err(|_| GoDaddyError::AuthorityStale)?;
        if self.cancel.is_cancelled() {
            return Err(GoDaddyError::AuthorityStale);
        }
        Ok(held)
    }

    fn check(
        &self,
        connection: &DesktopGoDaddyConnection,
    ) -> std::result::Result<(), GoDaddyError> {
        drop(self.hold_power()?);
        self.host
            .recheck_godaddy_connection(connection)
            .map_err(|_| GoDaddyError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn check_preparation(&self, admission: &DesktopNativeCloudAdmission) -> Result<()> {
        drop(self.hold_power().map_err(native_error)?);
        self.host
            .recheck_godaddy_connection_preparation(admission)
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
        if !GoDaddyCapture::supported() {
            return Err(ProviderCredentialError::Unavailable);
        }
        let capture = Arc::clone(self);
        let (admission, credential) = tauri::async_runtime::spawn_blocking(move || {
            let admission = capture.host.begin_native_cloud_run().map_err(host_error)?;
            capture.check_preparation(&admission)?;
            let credential = GoDaddyCapture::capture_guarded(&mut || {
                capture
                    .check_preparation(&admission)
                    .map_err(|_| GoDaddyError::AuthorityStale)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>((admission, credential))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        // A rejected or incomplete first read never creates a durable connection. Once custody
        // confirms the same candidate bytes, the scan can be published without a second request.
        let registrations = self
            .scan(&credential, &mut || {
                self.check_preparation(&admission)
                    .map_err(|_| GoDaddyError::AuthorityStale)
            })
            .await?;
        let publish = Arc::clone(self);
        let connection = tauri::async_runtime::spawn_blocking(move || {
            let connection =
                publish.commit(|host| host.prepare_godaddy_connection(admission, "GoDaddy"))?;
            publish_godaddy_credential_guarded(&Slot(&connection), &credential, &mut || {
                publish.check(&connection)
            })
            .map_err(native_error)?;
            Ok::<_, ProviderCredentialError>(connection)
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        self.commit_inventory(connection, registrations).await
    }

    pub(crate) async fn refresh(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        let work = tauri::async_runtime::spawn_blocking(move || {
            let connection = run.commit(|host| {
                host.resume_godaddy_connection(host.begin_native_cloud_run()?, &id)
            })?;
            let credential =
                load_godaddy_credential_guarded(&Slot(&connection), &mut || run.check(&connection))
                    .map_err(native_error)?;
            match credential {
                Some(credential) => Ok(Some((connection, credential))),
                None if connection.is_prepared() => {
                    let retired =
                        run.commit(|host| host.abandon_godaddy_preparation(connection))?;
                    run.purge_and_confirm(&retired)?;
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
            .await?;
        drop(credential);
        self.commit_inventory(connection, registrations).await
    }

    pub(crate) async fn revoke(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || run.revoke_blocking(&id))
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    fn revoke_blocking(&self, id: &str) -> Result<()> {
        let connection =
            self.commit(|host| host.revoke_godaddy_connection(host.begin_native_cloud_run()?, id))?;
        self.purge_and_confirm(&connection)
    }

    fn purge_and_confirm(&self, connection: &DesktopGoDaddyConnection) -> Result<()> {
        if !connection.is_revoked() {
            return Err(ProviderCredentialError::Host);
        }
        purge_godaddy_credential_guarded(&Slot(connection), &mut || self.check(connection))
            .map_err(native_error)?;
        self.commit(|host| host.confirm_godaddy_purge(connection))
    }

    async fn scan(
        &self,
        credential: &GoDaddyCredential,
        guard: &mut GoDaddyGuard<'_>,
    ) -> Result<Vec<DesktopRegistrationFact>> {
        let client = GoDaddyRegistrarClient::production().map_err(native_error)?;
        let registrations = tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(GoDaddyError::AuthorityStale),
            result = client.scan(credential, guard) => result,
        }
        .map_err(native_error)?;
        Ok(registrations.into_iter().map(registration_fact).collect())
    }

    async fn commit_inventory(
        self: &Arc<Self>,
        connection: DesktopGoDaddyConnection,
        registrations: Vec<DesktopRegistrationFact>,
    ) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            run.commit(|host| {
                host.commit_godaddy_inventory(&connection, &registrations)
                    .map(|_| ())
            })
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    async fn status(&self) -> Result<DesktopGoDaddyRegistrarStatus> {
        let host = Arc::clone(&self.host);
        tauri::async_runtime::spawn_blocking(move || host.read_godaddy_registrar_status())
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
            if row.state == DesktopGoDaddyConnectionState::Revoked {
                let _ = self.revoke(row.connection_id).await;
            } else if status.observe_entitled && status.observe_qualified && row.scan_pending {
                let _ = self.refresh(row.connection_id).await;
            }
        }
        // Durable revocation denies reuse of a retired incarnation even when its slot
        // could not be deleted yet. Other connections remain independently usable.
        drop(self.hold_power().map_err(native_error)?);
        Ok(())
    }
}

fn registration_fact(row: GoDaddyRegistration) -> DesktopRegistrationFact {
    DesktopRegistrationFact {
        domain: row.domain,
        registered_on: row.registered_on,
        expires_on: Some(row.expires_on),
        auto_renew: Some(row.auto_renew),
        locked: row.transfer_locked,
        standing: match row.standing {
            GoDaddyRegistrationStanding::Active => DesktopRegistrationStanding::Active,
            GoDaddyRegistrationStanding::PendingTransfer => DesktopRegistrationStanding::Pending,
            GoDaddyRegistrationStanding::Inactive => DesktopRegistrationStanding::Inactive,
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

const fn native_error(error: GoDaddyError) -> ProviderCredentialError {
    match error {
        GoDaddyError::AuthorityStale => ProviderCredentialError::Host,
        GoDaddyError::CaptureCancelled | GoDaddyError::InputRejected => {
            ProviderCredentialError::Capture
        }
        GoDaddyError::CustodyUnavailable
        | GoDaddyError::CustodyMismatch
        | GoDaddyError::CustodyOutcomeUnknown => ProviderCredentialError::Keychain,
        GoDaddyError::AuthenticationRequired | GoDaddyError::Forbidden => {
            ProviderCredentialError::CredentialRejected
        }
        GoDaddyError::RateLimited => ProviderCredentialError::ProviderRetryLater,
        GoDaddyError::Unavailable => ProviderCredentialError::ProviderUnreachable,
        GoDaddyError::ProtocolRejected => ProviderCredentialError::ProviderResponseRejected,
    }
}
