//! Private bridge between Host-owned credential plans and Secure Host custody.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};

use gooddealer_local_storage::{
    DesktopCloudflareCheckedObservation, DesktopCloudflareCustodyComparison,
    DesktopCloudflareEnvelopeKind, DesktopCloudflareKeychainPlan, DesktopCloudflarePrewriteFailure,
    DesktopCloudflarePurgeOutcome, DesktopCloudflareRecoveryPlan,
    DesktopCloudflareRegistrationFact, DesktopCloudflareRegistrationStanding,
    DesktopCloudflareResolution, DesktopCloudflareRetirement, DesktopCloudflareRetirementPlan,
    DesktopLocalHost, DesktopLocalHostError, InspectingCloudflareProvision,
    InspectingCloudflareRevocation, PreparedCloudflareRegistrarInventory,
};
use gooddealer_secure_host_core::{
    CloudflareCapture, CloudflareCaptureError, CloudflareCredentialObservationPlan,
    CloudflareCredentialProvisionPlan, CloudflareCredentialPublicKind,
    CloudflareCredentialRecoveryPlan, CloudflareCredentialRetirementPlan,
    CloudflareCustodyComparison, CloudflareKeychainError, CloudflarePrewriteFailure,
    CloudflarePrewriteInspection, CloudflareProviderClient, CloudflareProviderError,
    CloudflareProviderObservation, CloudflareProviderZoneStatus, CloudflarePurgeOutcome,
    CloudflareRecordType, NativePowerGate, inspect_cloudflare_recovery_guarded,
    publish_cloudflare_candidate_guarded, publish_cloudflare_tombstone_guarded,
    purge_retired_cloudflare_slot,
};

pub(crate) async fn recover(
    host: Arc<DesktopLocalHost>,
    cancel_fence: Arc<crate::native_cloud_runtime::NativeCloudCancelFence>,
) -> Result<(), ProviderCredentialError> {
    tauri::async_runtime::spawn_blocking(move || {
        let admission = host.begin_native_cloud_run().map_err(host_error)?;
        host.recover_cloudflare_credential_orphans(&admission)
            .map_err(host_error)?;
        while let Some(handle) = host
            .claim_cloudflare_retirement_retry()
            .map_err(host_error)?
        {
            // A failed purge stays durable, but must not prevent other slots or recovery from
            // being inspected. Claims are consumed once for this writable runtime.
            let _ = purge_retirement_handle(&host, &cancel_fence, handle);
        }
        let mut scan = host
            .begin_cloudflare_recovery_scan(admission)
            .map_err(host_error)?;
        loop {
            let Some(handle) = host
                .next_cloudflare_recovery(&mut scan)
                .map_err(host_error)?
            else {
                return Ok(());
            };
            handle.with_keychain_plan(|plan, handle| {
                let forwarded = ForwardedRecoveryPlan(plan);
                inspect_cloudflare_recovery_guarded(&forwarded, handle, |handle, comparison| {
                    host.resolve_cloudflare_recovery(&scan, handle, map_comparison(comparison))
                        .map_err(map_host_to_keychain)
                })
                .map(|_| ())
                .map_err(|_| ProviderCredentialError::Keychain)
            })?;
        }
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}

pub(crate) async fn activate(
    host: Arc<DesktopLocalHost>,
    connection_hint: String,
    cancel_fence: Arc<crate::native_cloud_runtime::NativeCloudCancelFence>,
    power: NativePowerGate,
) -> Result<bool, ProviderCredentialError> {
    if provider_custody_quarantined(&connection_hint) {
        return Err(ProviderCredentialError::Host);
    }
    let quarantine_connection = connection_hint.clone();
    let epoch = power.snapshot().epoch;
    let (activation, candidate) =
        capture_activation_candidate(&host, &connection_hint, &cancel_fence, &power, epoch).await?;

    let mut provider = CloudflareProviderClient::production();
    let guard_host = Arc::clone(&host);
    let provider_cancel_fence = Arc::clone(&cancel_fence);
    let mut provider_guard = || {
        guard_host
            .recheck_cloudflare_activation(&activation)
            .map_err(|_| CloudflareProviderError::AuthorityStale)?;
        let _power = power
            .hold_write_epoch(epoch)
            .map_err(|_| CloudflareProviderError::AuthorityStale)?;
        if provider_cancel_fence.is_cancelled() {
            return Err(CloudflareProviderError::AuthorityStale);
        }
        Ok(())
    };
    let observation = tokio::select! {
        biased;
        _ = power.wait_for_epoch_change(epoch) => Err(CloudflareProviderError::AuthorityStale),
        result = provider.observe_candidate_guarded(&candidate, &mut provider_guard) => result,
    }
    .map_err(provider_error)?;
    let checked = checked_observation(&candidate.zone_binding_digest(), observation);

    let prepared_host = Arc::clone(&host);
    let prepare_power = power.clone();
    let prepare_cancel = Arc::clone(&cancel_fence);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        activation_commit(&prepare_power, &prepare_cancel, epoch, || {
            prepared_host.prepare_cloudflare_provision(activation, &checked)
        })
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(host_error)?;

    let inspecting = activation_commit(&power, &cancel_fence, epoch, || {
        host.begin_cloudflare_provision_prewrite_inspection(prepared)
    })
    .map_err(host_error)?;

    let publish_host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || {
        inspecting.with_keychain_plan(|plan, inspecting| {
            let forwarded = ForwardedProvisionPlan(plan);
            publish_cloudflare_candidate_guarded(
                &forwarded,
                candidate,
                ForwardedPrewriteInspection(inspecting),
                |ForwardedPrewriteInspection(inspecting)| {
                    publish_host
                        .mark_cloudflare_provision_write_started(inspecting)
                        .map_err(map_host_to_keychain)
                },
                |ForwardedPrewriteInspection(inspecting), reason| {
                    let result = publish_host
                        .remediate_cloudflare_provision_prewrite(
                            inspecting,
                            map_prewrite_failure(reason),
                        )
                        .map_err(map_host_to_keychain);
                    if result.is_err() {
                        quarantine_provider_custody(&quarantine_connection);
                    }
                    result
                },
                |marked, comparison| {
                    publish_host
                        .resolve_cloudflare_provision(marked, map_comparison(comparison))
                        .map_err(map_host_to_keychain)
                },
            )
        })
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map(|resolution| resolution == DesktopCloudflareResolution::Confirmed)
    .map_err(|_| ProviderCredentialError::Keychain)
}

async fn capture_activation_candidate(
    host: &Arc<DesktopLocalHost>,
    connection_hint: &str,
    cancel_fence: &Arc<crate::native_cloud_runtime::NativeCloudCancelFence>,
    power: &NativePowerGate,
    epoch: u64,
) -> Result<
    (
        gooddealer_local_storage::DesktopCloudflareActivationAdmission,
        gooddealer_secure_host_core::CloudflareCandidate,
    ),
    ProviderCredentialError,
> {
    let admission = host.begin_native_cloud_run().map_err(host_error)?;
    let activation = host
        .begin_cloudflare_activation(admission, connection_hint)
        .map_err(host_error)?;
    let capture_host = Arc::clone(host);
    let capture_cancel_fence = Arc::clone(cancel_fence);
    let capture_power = power.clone();
    tauri::async_runtime::spawn_blocking(move || {
        CloudflareCapture::capture_guarded(&mut || {
            if capture_cancel_fence.is_cancelled() {
                return Err(CloudflareCaptureError::AuthorityStale);
            }
            capture_host
                .recheck_cloudflare_activation(&activation)
                .map_err(|_| CloudflareCaptureError::AuthorityStale)?;
            let _power = capture_power
                .hold_write_epoch(epoch)
                .map_err(|_| CloudflareCaptureError::AuthorityStale)?;
            if capture_cancel_fence.is_cancelled() {
                return Err(CloudflareCaptureError::AuthorityStale);
            }
            Ok(())
        })
        .map(|candidate| (activation, candidate))
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(|_| ProviderCredentialError::Capture)
}

fn activation_commit<T>(
    power: &NativePowerGate,
    cancel: &crate::native_cloud_runtime::NativeCloudCancelFence,
    epoch: u64,
    commit: impl FnOnce() -> Result<T, DesktopLocalHostError>,
) -> Result<T, DesktopLocalHostError> {
    let _power = power
        .hold_write_epoch(epoch)
        .map_err(|_| DesktopLocalHostError::AuthorityRejected)?;
    cancel
        .commit(commit)
        .ok_or(DesktopLocalHostError::AuthorityRejected)?
}

const fn map_prewrite_failure(
    reason: CloudflarePrewriteFailure,
) -> DesktopCloudflarePrewriteFailure {
    match reason {
        CloudflarePrewriteFailure::BaseMismatch => DesktopCloudflarePrewriteFailure::BaseMismatch,
        CloudflarePrewriteFailure::MissingOther => DesktopCloudflarePrewriteFailure::MissingOther,
        CloudflarePrewriteFailure::Malformed => DesktopCloudflarePrewriteFailure::Malformed,
        CloudflarePrewriteFailure::Unreadable => DesktopCloudflarePrewriteFailure::Unreadable,
    }
}

pub(crate) async fn observe(
    host: Arc<DesktopLocalHost>,
    connection_hint: String,
    entity_hint: String,
    cancel_fence: Arc<crate::native_cloud_runtime::NativeCloudCancelFence>,
) -> Result<bool, ProviderCredentialError> {
    if provider_custody_quarantined(&connection_hint) {
        return Err(ProviderCredentialError::Host);
    }
    let admission = host.begin_native_cloud_run().map_err(host_error)?;
    let prepare_host = Arc::clone(&host);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        prepare_host.prepare_cloudflare_observation(admission, &connection_hint, &entity_hint)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(host_error)?;

    let mut provider = CloudflareProviderClient::production();
    let plan = ForwardedObservationPlan(&prepared);
    let guard_host = Arc::clone(&host);
    let guard_cancel_fence = Arc::clone(&cancel_fence);
    let observation = provider
        .observe_stored_credential_guarded(&plan, &mut || {
            if guard_cancel_fence.is_cancelled() {
                return Err(CloudflareProviderError::AuthorityStale);
            }
            guard_host
                .recheck_cloudflare_observation(&prepared)
                .map_err(|_| CloudflareProviderError::AuthorityStale)
        })
        .await
        .map_err(provider_error)?;
    let checked = checked_observation(prepared.zone_digest(), observation);
    tauri::async_runtime::spawn_blocking(move || {
        host.commit_checked_cloudflare_observation(prepared, &checked)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map(|_| true)
    .map_err(host_error)
}

pub(crate) async fn refresh_registrar_inventory(
    host: Arc<DesktopLocalHost>,
    connection_id: String,
    cancel: Arc<crate::native_cloud_runtime::NativeCloudCancelFence>,
    power: NativePowerGate,
) -> Result<(), ProviderCredentialError> {
    if provider_custody_quarantined(&connection_id) {
        return Err(ProviderCredentialError::Host);
    }
    let epoch = power.snapshot().epoch;
    let prepare_host = Arc::clone(&host);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        let admission = prepare_host.begin_native_cloud_run()?;
        prepare_host.prepare_cloudflare_registrar_inventory(admission, &connection_id)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(host_error)?;
    let plan = ForwardedRegistrarPlan(&prepared);
    let mut provider = CloudflareProviderClient::production();
    let mut provider_guard = || {
        host.recheck_cloudflare_registrar_inventory(&prepared)
            .map_err(|_| CloudflareProviderError::AuthorityStale)?;
        let _power = power
            .hold_write_epoch(epoch)
            .map_err(|_| CloudflareProviderError::AuthorityStale)?;
        if cancel.is_cancelled() {
            return Err(CloudflareProviderError::AuthorityStale);
        }
        Ok(())
    };
    let scanned = tokio::select! {
        biased;
        _ = power.wait_for_epoch_change(epoch) => Err(CloudflareProviderError::AuthorityStale),
        result = provider.scan_registrations_guarded(&plan, prepared.expected_account_scope_digest(), &mut provider_guard) => result,
    }.map_err(|error| match error {
        CloudflareProviderError::InvalidResponse | CloudflareProviderError::ResponseLimit => ProviderCredentialError::ProviderResponseRejected,
        other => provider_error(other),
    })?;
    let facts: Vec<_> = scanned
        .registrations
        .into_iter()
        .map(|row| DesktopCloudflareRegistrationFact {
            domain: row.domain,
            registered_on: row.registered_on,
            expires_on: row.expires_on,
            auto_renew: row.auto_renew,
            locked: row.locked,
            standing: match row.standing {
                gooddealer_secure_host_core::CloudflareRegistrationStanding::Active => {
                    DesktopCloudflareRegistrationStanding::Active
                }
                gooddealer_secure_host_core::CloudflareRegistrationStanding::Pending => {
                    DesktopCloudflareRegistrationStanding::Pending
                }
                gooddealer_secure_host_core::CloudflareRegistrationStanding::Inactive => {
                    DesktopCloudflareRegistrationStanding::Inactive
                }
            },
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let _power = power
            .hold_write_epoch(epoch)
            .map_err(|_| ProviderCredentialError::Host)?;
        cancel
            .commit(|| {
                host.commit_cloudflare_registrar_inventory(
                    prepared,
                    &scanned.account_digest,
                    &facts,
                )
            })
            .ok_or(ProviderCredentialError::Host)?
            .map(|_| ())
            .map_err(host_error)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}

struct ForwardedRegistrarPlan<'a>(&'a PreparedCloudflareRegistrarInventory);

impl CloudflareCredentialObservationPlan for ForwardedRegistrarPlan<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation_id()
    }
    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
    }
    fn generation(&self) -> u64 {
        self.0.generation()
    }
    fn scope_digest(&self) -> &str {
        self.0.scope_digest()
    }
    fn zone_digest(&self) -> &str {
        self.0.zone_digest()
    }
    fn public_proof(&self) -> &str {
        self.0.public_proof()
    }
}

/// What one revocation did. Every outcome but `NothingToRevoke` left credential use denied in
/// the Host; only `Revoked` also confirmed the token left custody. The others name why custody
/// was not confirmed, so a caller never reads them as one indistinct `false`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RevocationOutcome {
    /// The connection held no credential; nothing was prepared or written.
    NothingToRevoke,
    /// The tombstone was confirmed and the token left custody.
    Revoked,
    /// Custody contradicted the Host's record before the write, so it was remediated instead.
    PrewriteRemediated,
    /// The write may have happened but the read-back did not show the tombstone.
    NotObservedBurned,
    /// The tombstone was read back but authority changed during the write.
    AuthorityStaleBurned,
    /// The read-back could not decide custody; startup recovery must resolve it.
    RecoveryRequired,
}

impl RevocationOutcome {
    const fn from_resolution(resolution: DesktopCloudflareResolution) -> Self {
        match resolution {
            DesktopCloudflareResolution::Confirmed => Self::Revoked,
            DesktopCloudflareResolution::PrewriteRemediated => Self::PrewriteRemediated,
            DesktopCloudflareResolution::TargetNotObservedBurned => Self::NotObservedBurned,
            DesktopCloudflareResolution::TargetPresentAuthorityStaleBurned => {
                Self::AuthorityStaleBurned
            }
            DesktopCloudflareResolution::RecoveryRequired => Self::RecoveryRequired,
        }
    }
}

/// Revokes a connection's credential. Preparation denies credential use in the Host in the same
/// commit, so the revocation takes effect before custody is touched; the tombstone publication
/// then removes the token from custody under the same fences as provision.
///
/// A quarantined connection is not refused here: revoking only withdraws access, and the
/// prewrite inspection still remediates any custody that contradicts the Host's record.
pub(crate) async fn revoke(
    host: Arc<DesktopLocalHost>,
    connection_hint: String,
    cancel_fence: Arc<crate::native_cloud_runtime::NativeCloudCancelFence>,
) -> Result<RevocationOutcome, ProviderCredentialError> {
    let admission = host.begin_native_cloud_run().map_err(host_error)?;
    let prepare_host = Arc::clone(&host);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        prepare_host.prepare_cloudflare_revocation(admission, &connection_hint)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(host_error)?;
    let Some(prepared) = prepared else {
        return Ok(RevocationOutcome::NothingToRevoke);
    };

    let prewrite_host = Arc::clone(&host);
    let inspecting = cancel_fence
        .commit(|| prewrite_host.begin_cloudflare_revocation_prewrite_inspection(prepared))
        .unwrap_or(Err(DesktopLocalHostError::AuthorityRejected))
        .map_err(host_error)?;

    tauri::async_runtime::spawn_blocking(move || {
        inspecting.with_keychain_plan(|plan, inspecting| {
            let forwarded = ForwardedProvisionPlan(plan);
            publish_cloudflare_tombstone_guarded(
                &forwarded,
                ForwardedRevocationInspection(inspecting),
                |ForwardedRevocationInspection(inspecting)| {
                    host.mark_cloudflare_revocation_write_started(inspecting)
                        .map_err(map_host_to_keychain)
                },
                |ForwardedRevocationInspection(inspecting), reason| {
                    host.remediate_cloudflare_revocation_prewrite(
                        inspecting,
                        map_prewrite_failure(reason),
                    )
                    .map_err(map_host_to_keychain)
                },
                |marked, comparison| {
                    host.resolve_cloudflare_revocation(marked, map_comparison(comparison))
                        .map_err(map_host_to_keychain)
                },
            )
        })
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map(RevocationOutcome::from_resolution)
    .map_err(|_| ProviderCredentialError::Keychain)
}

/// The first action requires explicit UI confirmation; retries only resume a durable request.
/// Cancellation after the request commit leaves that request intact for a later retry.
pub(crate) async fn purge(
    host: Arc<DesktopLocalHost>,
    connection_hint: String,
    action: crate::provider_lane::RetirementAction,
    cancel_fence: Arc<crate::native_cloud_runtime::NativeCloudCancelFence>,
) -> Result<bool, ProviderCredentialError> {
    tauri::async_runtime::spawn_blocking(move || {
        let admission = host.begin_native_cloud_run().map_err(host_error)?;
        let retirement = cancel_fence
            .commit(|| match action {
                crate::provider_lane::RetirementAction::ConfirmRetirement => {
                    host.request_cloudflare_retirement(admission, &connection_hint)
                }
                crate::provider_lane::RetirementAction::RetryPending => {
                    host.resume_cloudflare_retirement(admission, &connection_hint)
                }
            })
            .unwrap_or(Err(DesktopLocalHostError::AuthorityRejected))
            .map_err(host_error)?;
        purge_retirement_handle(&host, &cancel_fence, retirement)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
}

fn purge_retirement_handle(
    host: &DesktopLocalHost,
    cancel_fence: &crate::native_cloud_runtime::NativeCloudCancelFence,
    retirement: DesktopCloudflareRetirement,
) -> Result<bool, ProviderCredentialError> {
    retirement.with_keychain_plan(|plan, handle| {
        purge_retired_cloudflare_slot(
            &ForwardedRetirementPlan(plan),
            handle,
            |handle| {
                if cancel_fence.is_cancelled() {
                    return Err(CloudflareKeychainError::AuthorityStale);
                }
                host.check_cloudflare_retirement(handle)
                    .map_err(map_host_to_keychain)
            },
            |handle, outcome| {
                let outcome = match outcome {
                    CloudflarePurgeOutcome::Purged => DesktopCloudflarePurgeOutcome::Purged,
                    CloudflarePurgeOutcome::AlreadyAbsent => {
                        DesktopCloudflarePurgeOutcome::AlreadyAbsent
                    }
                    CloudflarePurgeOutcome::Unknown => DesktopCloudflarePurgeOutcome::Unknown,
                };
                cancel_fence
                    .commit(|| host.resolve_cloudflare_retirement(handle, outcome))
                    .unwrap_or(Err(DesktopLocalHostError::AuthorityRejected))
                    .map_err(map_host_to_keychain)
            },
        )
        .map_err(|_| ProviderCredentialError::Keychain)
    })
}

struct ForwardedRetirementPlan<'a>(DesktopCloudflareRetirementPlan<'a>);

impl CloudflareCredentialRetirementPlan for ForwardedRetirementPlan<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation_id()
    }
    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
    }
}

fn provider_custody_quarantine() -> &'static Mutex<HashSet<String>> {
    static QUARANTINE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    QUARANTINE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn provider_custody_quarantined(connection_id: &str) -> bool {
    provider_custody_quarantine()
        .lock()
        .map_or(true, |quarantine| quarantine.contains(connection_id))
}

fn quarantine_provider_custody(connection_id: &str) {
    if let Ok(mut quarantine) = provider_custody_quarantine().lock() {
        quarantine.insert(connection_id.to_owned());
    }
}

struct ForwardedProvisionPlan<'a>(DesktopCloudflareKeychainPlan<'a>);

struct ForwardedRecoveryPlan<'a>(DesktopCloudflareRecoveryPlan<'a>);

struct ForwardedPrewriteInspection(InspectingCloudflareProvision);

impl CloudflarePrewriteInspection for ForwardedPrewriteInspection {}

struct ForwardedRevocationInspection(InspectingCloudflareRevocation);

impl CloudflarePrewriteInspection for ForwardedRevocationInspection {}

struct ForwardedObservationPlan<'a>(&'a gooddealer_local_storage::PreparedCloudflareObservation);

impl CloudflareCredentialObservationPlan for ForwardedObservationPlan<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation_id()
    }

    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
    }

    fn generation(&self) -> u64 {
        self.0.generation()
    }

    fn scope_digest(&self) -> &str {
        self.0.scope_digest()
    }

    fn zone_digest(&self) -> &str {
        self.0.zone_digest()
    }

    fn public_proof(&self) -> &str {
        self.0.public_proof()
    }
}

impl CloudflareCredentialProvisionPlan for ForwardedProvisionPlan<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation_id()
    }

    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
    }

    fn expected_base_kind(&self) -> CloudflareCredentialPublicKind {
        map_kind(self.0.expected_base_kind())
    }

    fn expected_base_generation(&self) -> Option<u64> {
        self.0.expected_base_generation()
    }

    fn expected_base_scope_digest(&self) -> Option<&str> {
        self.0.expected_base_scope_digest()
    }

    fn expected_base_zone_digest(&self) -> Option<&str> {
        self.0.expected_base_zone_digest()
    }

    fn expected_base_public_proof(&self) -> Option<&str> {
        self.0.expected_base_public_proof()
    }

    fn target_generation(&self) -> u64 {
        self.0.target_generation()
    }

    fn target_scope_digest(&self) -> &str {
        self.0.target_scope_digest()
    }

    fn target_zone_digest(&self) -> &str {
        self.0.target_zone_digest()
    }

    fn target_public_proof(&self) -> &str {
        self.0.target_public_proof()
    }
}

impl CloudflareCredentialRecoveryPlan for ForwardedRecoveryPlan<'_> {
    fn connection_incarnation(&self) -> &str {
        self.0.connection_incarnation_id()
    }

    fn connection_digest(&self) -> &str {
        self.0.connection_digest()
    }

    fn expected_base_kind(&self) -> CloudflareCredentialPublicKind {
        map_kind(self.0.expected_base_kind())
    }

    fn expected_base_generation(&self) -> Option<u64> {
        self.0.expected_base_generation()
    }

    fn expected_base_scope_digest(&self) -> Option<&str> {
        self.0.expected_base_scope_digest()
    }

    fn expected_base_zone_digest(&self) -> Option<&str> {
        self.0.expected_base_zone_digest()
    }

    fn expected_base_public_proof(&self) -> Option<&str> {
        self.0.expected_base_public_proof()
    }

    fn target_kind(&self) -> CloudflareCredentialPublicKind {
        map_kind(self.0.target_kind())
    }

    fn target_generation(&self) -> u64 {
        self.0.target_generation()
    }

    fn target_scope_digest(&self) -> &str {
        self.0.target_scope_digest()
    }

    fn target_zone_digest(&self) -> &str {
        self.0.target_zone_digest()
    }

    fn target_public_proof(&self) -> &str {
        self.0.target_public_proof()
    }
}

fn checked_observation(
    zone_binding_digest: &str,
    observation: CloudflareProviderObservation,
) -> DesktopCloudflareCheckedObservation {
    let provider_version_token = observation
        .records
        .iter()
        .map(|record| record.modified_on.as_str())
        .max()
        .unwrap_or(observation.zone.id.as_str())
        .to_owned();
    let authoritative_nameservers = observation.zone.authoritative_nameservers;
    DesktopCloudflareCheckedObservation {
        entity_id: observation.zone.name.clone(),
        zone_binding_digest: zone_binding_digest.to_owned(),
        zone_name_ascii: observation.zone.name,
        authoritative_nameservers,
        dnssec_status: "unknown".to_owned(),
        availability: "available".to_owned(),
        zone_status: match observation.zone.status {
            CloudflareProviderZoneStatus::Active => "active",
            CloudflareProviderZoneStatus::Pending => "pending",
        }
        .to_owned(),
        records: observation
            .records
            .into_iter()
            .map(
                |record| gooddealer_local_storage::CloudflareDnsRecordWrite {
                    record_key: record.id,
                    record_type: match record.record_type {
                        CloudflareRecordType::A => "A",
                        CloudflareRecordType::AAAA => "AAAA",
                        CloudflareRecordType::CNAME => "CNAME",
                        CloudflareRecordType::TXT => "TXT",
                    }
                    .to_owned(),
                    owner_name_ascii: record.name,
                    ttl_seconds: Some(record.ttl),
                    priority: None,
                    canonical_value: record.content,
                    proxied: Some(record.proxied),
                },
            )
            .collect(),
        provider_version_token,
    }
}

const fn map_kind(kind: DesktopCloudflareEnvelopeKind) -> CloudflareCredentialPublicKind {
    match kind {
        DesktopCloudflareEnvelopeKind::Absent => CloudflareCredentialPublicKind::Absent,
        DesktopCloudflareEnvelopeKind::Active => CloudflareCredentialPublicKind::Active,
        DesktopCloudflareEnvelopeKind::Tombstone => CloudflareCredentialPublicKind::Tombstone,
    }
}

const fn map_comparison(
    comparison: CloudflareCustodyComparison,
) -> DesktopCloudflareCustodyComparison {
    match comparison {
        CloudflareCustodyComparison::ExactTarget => DesktopCloudflareCustodyComparison::ExactTarget,
        CloudflareCustodyComparison::ExactBase => DesktopCloudflareCustodyComparison::ExactBase,
        CloudflareCustodyComparison::OtherCanonical => {
            DesktopCloudflareCustodyComparison::OtherCanonical
        }
        CloudflareCustodyComparison::MissingOther => {
            DesktopCloudflareCustodyComparison::MissingOther
        }
        CloudflareCustodyComparison::Malformed => DesktopCloudflareCustodyComparison::Malformed,
        CloudflareCustodyComparison::Unavailable => DesktopCloudflareCustodyComparison::Unavailable,
    }
}

/// Keeps the Provider failures a person can act on apart: a transport failure, a retryable
/// refusal (rate limit or server error), and a refusal of the credential (401 or 403). Every
/// other failure (any other non-retryable status, malformed input or response, a response over
/// its limit, stale authority) stays one closed outcome.
const fn provider_error(error: CloudflareProviderError) -> ProviderCredentialError {
    match error {
        CloudflareProviderError::Transport => ProviderCredentialError::ProviderUnreachable,
        CloudflareProviderError::Retryable => ProviderCredentialError::ProviderRetryLater,
        CloudflareProviderError::CredentialRefused => ProviderCredentialError::CredentialRejected,
        CloudflareProviderError::AuthorityStale
        | CloudflareProviderError::Deterministic
        | CloudflareProviderError::InvalidInput
        | CloudflareProviderError::InvalidResponse
        | CloudflareProviderError::ResponseLimit => ProviderCredentialError::Provider,
    }
}

/// Keeps the Host refusals a person can act on, an unqualified capability and a Zone name that
/// cannot be imported, apart from every other Host failure.
const fn host_error(error: DesktopLocalHostError) -> ProviderCredentialError {
    match error {
        DesktopLocalHostError::CapabilityUnqualified => ProviderCredentialError::Unqualified,
        DesktopLocalHostError::ZoneUnimportable => ProviderCredentialError::ZoneUnimportable,
        _ => ProviderCredentialError::Host,
    }
}

const fn map_host_to_keychain(error: DesktopLocalHostError) -> CloudflareKeychainError {
    match error {
        DesktopLocalHostError::AuthorityRejected => CloudflareKeychainError::AuthorityStale,
        DesktopLocalHostError::Unavailable => CloudflareKeychainError::Unavailable,
        DesktopLocalHostError::ApplicationRootRejected
        | DesktopLocalHostError::StorageRejected
        | DesktopLocalHostError::CloudProtocolRejected
        | DesktopLocalHostError::AssetExists
        | DesktopLocalHostError::AssetDeleted
        | DesktopLocalHostError::AssetReAddBlocked
        | DesktopLocalHostError::AssetReAddPending
        | DesktopLocalHostError::CapabilityUnqualified
        | DesktopLocalHostError::ZoneUnimportable => CloudflareKeychainError::StateUnknown,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProviderCredentialError {
    Host,
    /// The capability has not passed ADR-0027 qualification; the Host attempted nothing.
    Unqualified,
    /// The observed Zone's name cannot become a domain asset; nothing was imported or prepared.
    ZoneUnimportable,
    Capture,
    /// Cloudflare could not be reached; nothing was written.
    ProviderUnreachable,
    /// Cloudflare rate limited the request or failed on its side; nothing was written.
    ProviderRetryLater,
    /// Cloudflare refused the credential (401 or 403). Its documentation does not say which of
    /// the two an invalid token and which a missing permission produces, so both stay one
    /// outcome; nothing was written.
    CredentialRejected,
    ProviderResponseRejected,
    Provider,
    Keychain,
    Unavailable,
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
