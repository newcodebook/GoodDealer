//! Connect and recover the Atom seller portfolio through the existing serial Provider lane.
use super::ProviderCredentialError;
use crate::native_cloud_runtime::NativeCloudCancelFence;
use gooddealer_local_storage::{
    DesktopAtomConnection, DesktopAtomConnectionState, DesktopAtomListingFact,
    DesktopAtomListingObservation, DesktopAtomListingState, DesktopAtomMarketplaceStatus,
    DesktopAtomStandardDelistClaim, DesktopAtomStandardDelistWork, DesktopLocalHost,
    DesktopLocalHostError, DesktopNativeCloudAdmission,
};
use gooddealer_secure_host_core::{
    AtomCapture, AtomCredential, AtomCredentialPlan, AtomError, AtomGuard, AtomListing,
    AtomListingState, AtomPortfolioClient, AtomSellerInventory, NativePowerCommitGuard,
    NativePowerGate, load_atom_credential_guarded, publish_atom_credential_guarded,
    purge_atom_credential_guarded,
};
use std::sync::Arc;

type Result<T> = std::result::Result<T, ProviderCredentialError>;

struct Slot<'a>(&'a DesktopAtomConnection);
impl AtomCredentialPlan for Slot<'_> {
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

    fn hold_power(&self) -> std::result::Result<NativePowerCommitGuard<'_>, AtomError> {
        let held = if self.recovering {
            self.power.hold_reconciliation_epoch(self.epoch)
        } else {
            self.power.hold_write_epoch(self.epoch)
        }
        .map_err(|_| AtomError::AuthorityStale)?;
        if self.cancel.is_cancelled() {
            return Err(AtomError::AuthorityStale);
        }
        Ok(held)
    }

    fn check(&self, connection: &DesktopAtomConnection) -> std::result::Result<(), AtomError> {
        drop(self.hold_power()?);
        self.host
            .recheck_atom_connection(connection)
            .map_err(|_| AtomError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn check_preparation(&self, admission: &DesktopNativeCloudAdmission) -> Result<()> {
        drop(self.hold_power().map_err(native_error)?);
        self.host
            .recheck_atom_connection_preparation(admission)
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
        if !AtomCapture::supported() {
            return Err(ProviderCredentialError::Unavailable);
        }
        let capture = Arc::clone(self);
        let (admission, credential) = tauri::async_runtime::spawn_blocking(move || {
            let admission = capture.host.begin_native_cloud_run().map_err(host_error)?;
            capture.check_preparation(&admission)?;
            let credential = AtomCapture::capture_guarded(&mut || {
                capture
                    .check_preparation(&admission)
                    .map_err(|_| AtomError::AuthorityStale)
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
                    .map_err(|_| AtomError::AuthorityStale)
            })
            .await?;
        let publish = Arc::clone(self);
        let connection = tauri::async_runtime::spawn_blocking(move || {
            let connection =
                publish.commit(|host| host.prepare_atom_connection(admission, "Atom"))?;
            publish_atom_credential_guarded(&Slot(&connection), &credential, &mut || {
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
                .commit(|host| host.resume_atom_connection(host.begin_native_cloud_run()?, &id))?;
            let credential =
                load_atom_credential_guarded(&Slot(&connection), &mut || run.check(&connection))
                    .map_err(native_error)?;
            match credential {
                Some(credential) => Ok(Some((connection, credential))),
                None if connection.is_prepared() => {
                    let retired = run.commit(|host| host.abandon_atom_preparation(connection))?;
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
            self.commit(|host| host.revoke_atom_connection(host.begin_native_cloud_run()?, id))?;
        self.purge_and_confirm(&connection)
    }

    fn purge_and_confirm(&self, connection: &DesktopAtomConnection) -> Result<()> {
        purge_atom_credential_guarded(&Slot(connection), &mut || self.check(connection))
            .map_err(native_error)?;
        self.commit(|host| host.confirm_atom_purge(connection))
    }

    async fn scan(
        &self,
        credential: &AtomCredential,
        guard: &mut AtomGuard<'_>,
    ) -> Result<AtomSellerInventory> {
        let client = AtomPortfolioClient::production().map_err(native_error)?;
        tokio::select! {
            biased;
            _ = self.power.wait_for_epoch_change(self.epoch) => Err(AtomError::AuthorityStale),
            result = client.scan(credential, guard) => result,
        }
        .map_err(native_error)
    }

    async fn commit_inventory(
        self: &Arc<Self>,
        connection: DesktopAtomConnection,
        inventory: AtomSellerInventory,
    ) -> Result<()> {
        let run = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            let listings: Vec<_> = inventory.listings.into_iter().map(listing_fact).collect();
            run.commit(|host| {
                host.commit_atom_inventory(&connection, &listings, inventory.standard_scan_checked)
                    .map(|_| ())
            })
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)?
    }

    async fn status(&self) -> Result<DesktopAtomMarketplaceStatus> {
        let host = Arc::clone(&self.host);
        tauri::async_runtime::spawn_blocking(move || host.read_atom_marketplace_status())
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
            if row.state == DesktopAtomConnectionState::Revoked {
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
            .any(|row| row.state == DesktopAtomConnectionState::Revoked)
        {
            return Err(ProviderCredentialError::Keychain);
        }
        Ok(())
    }

    pub(crate) async fn standard_delist_step(self: &Arc<Self>) -> Result<bool> {
        let run = Arc::clone(self);
        let next = tauri::async_runtime::spawn_blocking(move || {
            let work = run.commit(|host| {
                host.next_atom_standard_delist_work(host.begin_native_cloud_run()?)
            })?;
            Ok::<_, ProviderCredentialError>(work.map(|work| {
                let credential = if work.can_observe() {
                    load_atom_credential_guarded(&Slot(work.connection()), &mut || {
                        run.delist_read_guard(&work)
                    })
                } else {
                    Ok(None)
                };
                (work, credential)
            }))
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        let Some((work, credential)) = next else {
            return Ok(false);
        };
        let client = AtomPortfolioClient::production().map_err(native_error)?;
        let read = match &credential {
            Ok(Some(credential)) => {
                let mut guard = || self.delist_read_guard(&work);
                tokio::select! {
                    biased;
                    _ = self.power.wait_for_epoch_change(self.epoch) => Err(AtomError::AuthorityStale),
                    result = client.observe_listing(credential, work.domain(), &mut guard) => result,
                }
            }
            Ok(None) => Err(AtomError::CustodyMismatch),
            Err(error) => Err(*error),
        };
        if matches!(read, Err(AtomError::AuthorityStale)) {
            return Err(ProviderCredentialError::Host);
        }
        let observation = read.ok().map(exact_observation);
        let run = Arc::clone(self);
        let claim = tauri::async_runtime::spawn_blocking(move || {
            if work.is_reconciliation() {
                run.commit(|host| host.settle_atom_standard_delist(&work, observation.as_ref()))?;
                return Ok(None);
            }
            let _power = run
                .power
                .hold_write_epoch(run.epoch)
                .map_err(|_| ProviderCredentialError::Host)?;
            run.cancel
                .commit(|| {
                    run.host
                        .commit_atom_standard_delist_preflight(work, observation.as_ref())
                })
                .ok_or(ProviderCredentialError::Host)?
                .map_err(host_error)
        })
        .await
        .map_err(|_| ProviderCredentialError::Unavailable)??;
        if let (Some(claim), Ok(Some(credential))) = (claim, credential) {
            let mut guard = || self.delist_dispatch_guard(&claim);
            // A receipt or interrupted send leaves the same durable, read-only reconciliation work.
            let _ = tokio::select! {
                biased;
                _ = self.power.wait_for_epoch_change(self.epoch) => Err(AtomError::AuthorityStale),
                result = client.send_standard_removal(&credential, claim.domain(), &mut guard) => result,
            };
        }
        Ok(true)
    }

    fn delist_read_guard(
        &self,
        work: &DesktopAtomStandardDelistWork,
    ) -> std::result::Result<(), AtomError> {
        drop(self.hold_power()?);
        self.host
            .recheck_atom_standard_delist_read(work)
            .map_err(|_| AtomError::AuthorityStale)?;
        drop(self.hold_power()?);
        Ok(())
    }

    fn delist_dispatch_guard(
        &self,
        claim: &DesktopAtomStandardDelistClaim,
    ) -> std::result::Result<(), AtomError> {
        let check_power = || {
            self.power
                .hold_write_epoch(self.epoch)
                .map_err(|_| AtomError::AuthorityStale)
        };
        drop(check_power()?);
        self.cancel
            .commit(|| self.host.recheck_atom_standard_delist_dispatch(claim))
            .ok_or(AtomError::AuthorityStale)?
            .map_err(|_| AtomError::AuthorityStale)?;
        drop(check_power()?);
        if self.cancel.is_cancelled() {
            return Err(AtomError::AuthorityStale);
        }
        Ok(())
    }
}

fn exact_observation(row: AtomListing) -> DesktopAtomListingObservation {
    let reported_standard = row.reports_standard();
    let fact = listing_fact(row);
    DesktopAtomListingObservation {
        domain: fact.domain,
        resource_digest: fact.resource_digest,
        state: fact.state,
        reported_standard,
    }
}

fn listing_fact(row: AtomListing) -> DesktopAtomListingFact {
    use std::fmt::Write as _;
    let mut digest = String::with_capacity(64);
    for byte in row.resource_digest {
        write!(digest, "{byte:02x}").expect("writing into String");
    }
    DesktopAtomListingFact {
        domain: row.domain,
        resource_digest: digest,
        observed_in_standard_scan: row.observed_in_standard_scan,
        state: match row.state {
            AtomListingState::SellerApproved => DesktopAtomListingState::SellerApproved,
            AtomListingState::TransferComplete => DesktopAtomListingState::TransferComplete,
            AtomListingState::Unclassified => DesktopAtomListingState::Unclassified,
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

const fn native_error(error: AtomError) -> ProviderCredentialError {
    match error {
        AtomError::AuthorityStale => ProviderCredentialError::Host,
        AtomError::CaptureCancelled | AtomError::InputRejected => ProviderCredentialError::Capture,
        AtomError::CustodyUnavailable
        | AtomError::CustodyMismatch
        | AtomError::CustodyOutcomeUnknown => ProviderCredentialError::Keychain,
        AtomError::AuthenticationRequired | AtomError::Forbidden => {
            ProviderCredentialError::CredentialRejected
        }
        AtomError::RateLimited => ProviderCredentialError::ProviderRetryLater,
        AtomError::Unavailable => ProviderCredentialError::ProviderUnreachable,
        AtomError::ProtocolRejected => ProviderCredentialError::ProviderResponseRejected,
    }
}
