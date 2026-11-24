//! Connect and recover `Porkbun` Registrar through the existing serial Provider lane.
use super::ProviderCredentialError;
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopLocalHost, DesktopLocalHostError, DesktopNativeCloudAdmission, DesktopPorkbunConnection,
    DesktopPorkbunConnectionState, DesktopPorkbunRegistrarStatus, DesktopRegistrationFact,
    DesktopRegistrationStanding,
};
use gooddealer_secure_host_core::{
    NativePowerCommitGuard, NativePowerGate, PorkbunCapture, PorkbunCredential,
    PorkbunCredentialPlan, PorkbunError, PorkbunGuard, PorkbunRegistrarClient, PorkbunRegistration,
    load_porkbun_credential_guarded, publish_porkbun_credential_guarded,
    purge_porkbun_credential_guarded,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

struct Slot<'a>(&'a DesktopPorkbunConnection);
impl PorkbunCredentialPlan for Slot<'_> {
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

    fn hold_power(&self) -> std::result::Result<NativePowerCommitGuard<'_>, PorkbunError> {
        let held = if self.recovering {
            self.power.hold_reconciliation_epoch(self.epoch)
        } else {
            self.power.hold_write_epoch(self.epoch)
        }
        .map_err(|_| PorkbunError::AuthorityStale)?;
        if self.cancel.is_cancelled() {
            return Err(PorkbunError::AuthorityStale);
        }
        Ok(held)
    }

    fn check(
        &self,
        connection: &DesktopPorkbunConnection,
    ) -> std::result::Result<(), PorkbunError> {
        drop(self.hold_power()?);
        self.host
            .recheck_porkbun_connection(connection)
            .map_err(|_| PorkbunError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn check_preparation(&self, admission: &DesktopNativeCloudAdmission) -> Result<()> {
        drop(self.hold_power().map_err(native_error)?);
        self.host
            .recheck_porkbun_connection_preparation(admission)
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
        if !PorkbunCapture::supported() {
            return Err(ProviderCredentialError::Unavailable);
        }
        let capture = Arc::clone(self);
        let (admission, credential) = tauri::async_runtime::spawn_blocking(move || {
            let admission = capture.host.begin_native_cloud_run().map_err(host_error)?;
            capture.check_preparation(&admission)?;
            let credential = PorkbunCapture::capture_guarded(&mut || {
                capture
                    .check_preparation(&admission)
                    .map_err(|_| PorkbunError::AuthorityStale)
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
                    .map_err(|_| PorkbunError::AuthorityStale)
            })
            .await?;
        let publish = Arc::clone(self);
        let connection = tauri::async_runtime::spawn_blocking(move || {
            let connection =
                publish.commit(|host| host.prepare_porkbun_connection(admission, "Porkbun"))?;
            publish_porkbun_credential_guarded(&Slot(&connection), &credential, &mut || {
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
                host.resume_porkbun_connection(host.begin_native_cloud_run()?, &id)
            })?;
            let credential =
                load_porkbun_credential_guarded(&Slot(&connection), &mut || run.check(&connection))
                    .map_err(native_error)?;
            match credential {
                Some(credential) => Ok(Some((connection, credential))),
                None if connection.is_prepared() => {
                    let retired =
                        run.commit(|host| host.abandon_porkbun_preparation(connection))?;
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
            self.commit(|host| host.revoke_porkbun_connection(host.begin_native_cloud_run()?, id))?;
        self.purge_and_confirm(&connection)
    }

    fn purge_and_confirm(&self, connection: &DesktopPorkbunConnection) -> Result<()> {
        if !connection.is_revoked() {
            return Err(ProviderCredentialError::Host);
        }
        purge_porkbun_credential_guarded(&Slot(connection), &mut || self.check(connection))
            .map_err(native_error)?;
        self.commit(|host| host.confirm_porkbun_purge(connection))
    }

    async fn scan(
        &self,
        credential: &PorkbunCredential,
        guard: &mut PorkbunGuard<'_>,
    ) -> Result<Vec<DesktopRegistrationFact>> {
        let client = PorkbunRegistrarClient::production().map_err(native_error)?;
        let registrations = tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(PorkbunError::AuthorityStale),
            result = client.scan(credential, guard) => result,
        }
        .map_err(native_error)?;
        Ok(registrations.into_iter().map(registration_fact).collect())
    }

    async fn commit_inventory(
        self: &Arc<Self>,
        connection: DesktopPorkbunConnection,
        registrations: Vec<DesktopRegistrationFact>,
    ) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            run.commit(|host| {
                host.commit_porkbun_inventory(&connection, &registrations)
                    .map(|_| ())
            })
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    async fn status(&self) -> Result<DesktopPorkbunRegistrarStatus> {
        let host = Arc::clone(&self.host);
        tauri::async_runtime::spawn_blocking(move || host.read_porkbun_registrar_status())
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
            if row.state == DesktopPorkbunConnectionState::Revoked {
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

fn registration_fact(row: PorkbunRegistration) -> DesktopRegistrationFact {
    DesktopRegistrationFact {
        domain: row.domain,
        registered_on: row.registered_on,
        expires_on: Some(row.expires_on),
        auto_renew: Some(row.auto_renew),
        locked: Some(row.transfer_locked),
        // Native admits only the documented `ACTIVE` status; any other status rejects the scan.
        // Per-domain API opt-in does not change inventory ownership, so it is not projected.
        standing: DesktopRegistrationStanding::Active,
    }
}

fn host_error(error: DesktopLocalHostError) -> ProviderCredentialError {
    if error == DesktopLocalHostError::CapabilityUnqualified {
        ProviderCredentialError::Unqualified
    } else {
        ProviderCredentialError::Host
    }
}

const fn native_error(error: PorkbunError) -> ProviderCredentialError {
    match error {
        PorkbunError::AuthorityStale => ProviderCredentialError::Host,
        PorkbunError::CaptureCancelled | PorkbunError::InputRejected => {
            ProviderCredentialError::Capture
        }
        PorkbunError::CustodyUnavailable
        | PorkbunError::CustodyMismatch
        | PorkbunError::CustodyOutcomeUnknown => ProviderCredentialError::Keychain,
        PorkbunError::AuthenticationRequired => ProviderCredentialError::CredentialRejected,
        PorkbunError::RateLimited => ProviderCredentialError::ProviderRetryLater,
        PorkbunError::Unavailable => ProviderCredentialError::ProviderUnreachable,
        PorkbunError::ProtocolRejected => ProviderCredentialError::ProviderResponseRejected,
    }
}
