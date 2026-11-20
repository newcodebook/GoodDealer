//! Connect and recover Cloudflare Registrar accounts through the existing serial Provider lane.
use super::{ProviderCredentialError, cloudflare::provider_error};
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopCloudflareRegistrarAccount, DesktopCloudflareRegistrarAccountState,
    DesktopCloudflareRegistrarAccountStatus, DesktopLocalHost, DesktopLocalHostError,
    DesktopRegistrationFact, DesktopRegistrationStanding,
};
use gooddealer_secure_host_core::{
    CloudflareProviderClient, CloudflareProviderError, CloudflareRegistrarCredential as Credential,
    CloudflareRegistrarCredentialError as Fault, CloudflareRegistrarCredentialPlan,
    CloudflareRegistration, CloudflareRegistrationInventory, CloudflareRegistrationStanding,
    NativePowerCommitGuard, NativePowerGate, load_cloudflare_registrar_credential,
    publish_cloudflare_registrar_credential, purge_cloudflare_registrar_credential,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

struct Slot<'a>(&'a DesktopCloudflareRegistrarAccount);
impl CloudflareRegistrarCredentialPlan for Slot<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation()
    }
    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
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

    fn hold_power(&self) -> std::result::Result<NativePowerCommitGuard<'_>, Fault> {
        let held = if self.recovering {
            self.power.hold_reconciliation_epoch(self.epoch)
        } else {
            self.power.hold_write_epoch(self.epoch)
        }
        .map_err(|_| Fault::AuthorityStale)?;
        if self.cancel.is_cancelled() {
            return Err(Fault::AuthorityStale);
        }
        Ok(held)
    }

    fn check(
        &self,
        connection: &DesktopCloudflareRegistrarAccount,
    ) -> std::result::Result<(), Fault> {
        drop(self.hold_power()?);
        self.host
            .recheck_cloudflare_registrar_account(connection)
            .map_err(|_| Fault::AuthorityStale)?;
        drop(self.hold_power()?);
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
        if !Credential::capture_supported() {
            return Err(ProviderCredentialError::Unavailable);
        }
        let run = Arc::clone(self);
        let (connection, credential) = tauri::async_runtime::spawn_blocking(move || {
            let connection = run.commit(|host| {
                host.prepare_cloudflare_registrar_account(host.begin_native_cloud_run()?)
            })?;
            let mut guard = || run.check(&connection);
            match Credential::capture_guarded(&mut guard) {
                Ok(credential) => Ok((connection, credential)),
                Err(error @ (Fault::CaptureCancelled | Fault::InputRejected)) => {
                    run.revoke_blocking(connection.connection_id())?;
                    Err(native_error(error))
                }
                Err(error) => Err(native_error(error)),
            }
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        let inventory = match self.scan(&connection, &credential).await {
            Ok(inventory) => inventory,
            Err(error) => {
                // No secret was published. If the admission expired, restart recovery can
                // identify the preparation's absent slot without loading a different account.
                let _ = self.revoke(connection.connection_id().to_owned()).await;
                return Err(error);
            }
        };
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            let mut guard = || run.check(&connection);
            publish_cloudflare_registrar_credential(&Slot(&connection), &credential, &mut guard)
                .map_err(native_error)?;
            drop(credential);
            run.commit_inventory(&connection, inventory)
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    pub(crate) async fn refresh(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        let work = tauri::async_runtime::spawn_blocking(move || {
            let connection = run
                .host
                .resume_cloudflare_registrar_account(
                    run.host.begin_native_cloud_run().map_err(host_error)?,
                    &id,
                )
                .map_err(host_error)?;
            let credential = load_cloudflare_registrar_credential(&Slot(&connection), &mut || {
                run.check(&connection)
            })
            .map_err(native_error)?;
            match credential {
                Some(credential) => Ok(Some((connection, credential))),
                None if connection.is_prepared() => {
                    run.revoke_blocking(connection.connection_id())?;
                    Ok(None)
                }
                None => Err(ProviderCredentialError::Keychain),
            }
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        let (connection, credential) = work.ok_or(ProviderCredentialError::Keychain)?;
        let inventory = self.scan(&connection, &credential).await?;
        drop(credential);
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || run.commit_inventory(&connection, inventory))
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    pub(crate) async fn revoke(self: &Arc<Self>, id: String) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || run.revoke_blocking(&id))
            .await
            .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    fn revoke_blocking(&self, id: &str) -> Result<()> {
        let connection = self.commit(|host| {
            host.revoke_cloudflare_registrar_account(host.begin_native_cloud_run()?, id)
        })?;
        self.purge_and_confirm(&connection)
    }

    fn purge_and_confirm(&self, connection: &DesktopCloudflareRegistrarAccount) -> Result<()> {
        if !connection.is_revoked() {
            return Err(ProviderCredentialError::Host);
        }
        purge_cloudflare_registrar_credential(&Slot(connection), &mut || self.check(connection))
            .map_err(native_error)?;
        self.commit(|host| host.confirm_cloudflare_registrar_account_purge(connection))
    }

    async fn scan(
        &self,
        connection: &DesktopCloudflareRegistrarAccount,
        credential: &Credential,
    ) -> Result<CloudflareRegistrationInventory> {
        let mut client = CloudflareProviderClient::production();
        let mut guard = || {
            self.check(connection)
                .map_err(|_| CloudflareProviderError::AuthorityStale)
        };
        tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(CloudflareProviderError::AuthorityStale),
            result = client.scan_account_registrations_guarded(
                credential, connection.connection_digest(), connection.expected_account_digest(), &mut guard,
            ) => result,
        }
        .map_err(|error| match error {
            CloudflareProviderError::InvalidResponse | CloudflareProviderError::ResponseLimit =>
                ProviderCredentialError::ProviderResponseRejected,
            CloudflareProviderError::AuthorityStale => ProviderCredentialError::Host,
            _ => provider_error(error),
        })
    }

    fn commit_inventory(
        &self,
        slot: &DesktopCloudflareRegistrarAccount,
        inventory: CloudflareRegistrationInventory,
    ) -> Result<()> {
        let registrations: Vec<_> = inventory
            .registrations
            .into_iter()
            .map(registration_fact)
            .collect();
        self.commit(|host| {
            host.commit_cloudflare_registrar_account(
                slot,
                &inventory.account_digest,
                &registrations,
            )
        })
    }

    async fn status(&self) -> Result<DesktopCloudflareRegistrarAccountStatus> {
        let host = Arc::clone(&self.host);
        tauri::async_runtime::spawn_blocking(move || {
            host.read_cloudflare_registrar_account_status()
        })
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
            if row.state == DesktopCloudflareRegistrarAccountState::Revoked {
                let _ = self.revoke(row.connection_id).await;
            } else if status.observe_entitled && status.observe_qualified && row.scan_pending {
                let _ = self.refresh(row.connection_id).await;
            }
        }
        drop(self.hold_power().map_err(native_error)?);
        // A revoked slot is already unusable. Its unresolved purge stays visible for retry
        // without preventing reads that belong to other connection incarnations.
        Ok(())
    }
}

fn registration_fact(row: CloudflareRegistration) -> DesktopRegistrationFact {
    DesktopRegistrationFact {
        domain: row.domain,
        registered_on: row.registered_on,
        expires_on: row.expires_on,
        auto_renew: Some(row.auto_renew),
        locked: Some(row.locked),
        standing: match row.standing {
            CloudflareRegistrationStanding::Active => DesktopRegistrationStanding::Active,
            CloudflareRegistrationStanding::Pending => DesktopRegistrationStanding::Pending,
            CloudflareRegistrationStanding::Inactive => DesktopRegistrationStanding::Inactive,
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

const fn native_error(error: Fault) -> ProviderCredentialError {
    match error {
        Fault::AuthorityStale => ProviderCredentialError::Host,
        Fault::CaptureCancelled | Fault::InputRejected => ProviderCredentialError::Capture,
        Fault::CustodyUnavailable | Fault::CustodyMismatch | Fault::CustodyOutcomeUnknown => {
            ProviderCredentialError::Keychain
        }
    }
}
