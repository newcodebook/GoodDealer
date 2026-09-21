//! Private bridge between Host-owned credential plans and Secure Host custody.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};

use gooddealer_local_storage::{
    DesktopCloudflareCheckedObservation, DesktopCloudflareCustodyComparison,
    DesktopCloudflareEnvelopeKind, DesktopCloudflareKeychainPlan, DesktopCloudflarePrewriteFailure,
    DesktopCloudflareRecoveryPlan, DesktopCloudflareResolution, DesktopLocalHost,
    DesktopLocalHostError, InspectingCloudflareProvision,
};
use gooddealer_secure_host_core::{
    CloudflareCapture, CloudflareCaptureError, CloudflareCredentialObservationPlan,
    CloudflareCredentialProvisionPlan, CloudflareCredentialPublicKind,
    CloudflareCredentialRecoveryPlan, CloudflareCustodyComparison, CloudflareKeychainError,
    CloudflarePrewriteFailure, CloudflarePrewriteInspection, CloudflareProviderClient,
    CloudflareProviderError, CloudflareProviderObservation, CloudflareProviderZoneStatus,
    CloudflareRecordType, inspect_cloudflare_recovery_guarded,
    publish_cloudflare_candidate_guarded,
};

pub(crate) async fn recover(host: Arc<DesktopLocalHost>) -> Result<(), ProviderCredentialError> {
    tauri::async_runtime::spawn_blocking(move || {
        let admission = host
            .begin_native_cloud_run()
            .map_err(|_| ProviderCredentialError::Host)?;
        host.recover_cloudflare_credential_orphans(&admission)
            .map_err(|_| ProviderCredentialError::Host)?;
        let mut scan = host
            .begin_cloudflare_recovery_scan(admission)
            .map_err(|_| ProviderCredentialError::Host)?;
        loop {
            let Some(handle) = host
                .next_cloudflare_recovery(&mut scan)
                .map_err(|_| ProviderCredentialError::Host)?
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
) -> Result<bool, ProviderCredentialError> {
    if provider_custody_quarantined(&connection_hint) {
        return Err(ProviderCredentialError::Host);
    }
    let quarantine_connection = connection_hint.clone();
    let admission = host
        .begin_native_cloud_run()
        .map_err(|_| ProviderCredentialError::Host)?;
    let activation = host
        .begin_cloudflare_activation(admission, &connection_hint)
        .map_err(|_| ProviderCredentialError::Host)?;
    let capture_host = Arc::clone(&host);
    let capture_cancel_fence = Arc::clone(&cancel_fence);
    let candidate = tauri::async_runtime::spawn_blocking(move || {
        CloudflareCapture::capture_guarded(&mut || {
            if capture_cancel_fence.is_cancelled() {
                return Err(CloudflareCaptureError::AuthorityStale);
            }
            capture_host
                .recheck_cloudflare_activation(&activation)
                .map_err(|_| CloudflareCaptureError::AuthorityStale)
        })
        .map(|candidate| (activation, candidate))
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(|_| ProviderCredentialError::Capture)?;
    let (activation, candidate) = candidate;

    let mut provider = CloudflareProviderClient::production();
    let guard_host = Arc::clone(&host);
    let provider_cancel_fence = Arc::clone(&cancel_fence);
    let guard_activation = &activation;
    let observation = provider
        .observe_candidate_guarded(&candidate, &mut || {
            if provider_cancel_fence.is_cancelled() {
                return Err(CloudflareProviderError::AuthorityStale);
            }
            guard_host
                .recheck_cloudflare_activation(guard_activation)
                .map_err(|_| CloudflareProviderError::AuthorityStale)
        })
        .await
        .map_err(|_| ProviderCredentialError::Provider)?;
    let checked = checked_observation(&candidate.zone_binding_digest(), observation);

    let prepared_host = Arc::clone(&host);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        prepared_host.prepare_cloudflare_provision(activation, &checked)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(|_| ProviderCredentialError::Host)?;

    let prewrite_host = Arc::clone(&host);
    let inspecting = cancel_fence
        .commit(|| prewrite_host.begin_cloudflare_provision_prewrite_inspection(prepared))
        .unwrap_or(Err(DesktopLocalHostError::AuthorityRejected))
        .map_err(|_| ProviderCredentialError::Host)?;

    let publish_host = Arc::clone(&host);
    tauri::async_runtime::spawn_blocking(move || {
        inspecting.with_keychain_plan(|plan, inspecting| {
            let forwarded = ForwardedProvisionPlan(plan);
            let marker_host = Arc::clone(&publish_host);
            let remediation_host = Arc::clone(&publish_host);
            let resolve_host = Arc::clone(&publish_host);
            publish_cloudflare_candidate_guarded(
                &forwarded,
                candidate,
                ForwardedPrewriteInspection(inspecting),
                move |ForwardedPrewriteInspection(inspecting)| {
                    marker_host
                        .mark_cloudflare_provision_write_started(inspecting)
                        .map_err(map_host_to_keychain)
                },
                move |ForwardedPrewriteInspection(inspecting), reason| {
                    let result = remediation_host
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
                move |marked, comparison| {
                    resolve_host
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
    let admission = host
        .begin_native_cloud_run()
        .map_err(|_| ProviderCredentialError::Host)?;
    let prepare_host = Arc::clone(&host);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        prepare_host.prepare_cloudflare_observation(admission, &connection_hint, &entity_hint)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map_err(|_| ProviderCredentialError::Host)?;

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
        .map_err(|_| ProviderCredentialError::Provider)?;
    let checked = checked_observation(prepared.zone_digest(), observation);
    tauri::async_runtime::spawn_blocking(move || {
        host.commit_checked_cloudflare_observation(prepared, &checked)
    })
    .await
    .map_err(|_| ProviderCredentialError::Unavailable)?
    .map(|_| true)
    .map_err(|_| ProviderCredentialError::Host)
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

const fn map_host_to_keychain(error: DesktopLocalHostError) -> CloudflareKeychainError {
    match error {
        DesktopLocalHostError::AuthorityRejected => CloudflareKeychainError::AuthorityStale,
        DesktopLocalHostError::Unavailable => CloudflareKeychainError::Unavailable,
        DesktopLocalHostError::ApplicationRootRejected
        | DesktopLocalHostError::StorageRejected
        | DesktopLocalHostError::CloudProtocolRejected => CloudflareKeychainError::StateUnknown,
    }
}

#[derive(Debug)]
pub(crate) enum ProviderCredentialError {
    Host,
    Capture,
    Provider,
    Keychain,
    Unavailable,
}

#[cfg(test)]
mod tests {
    #[test]
    fn credential_orchestrator_is_the_only_native_forwarding_callsite() {
        let orchestrator = include_str!("provider_credential_orchestrator.rs");
        let production = orchestrator
            .split("#[cfg(test)]")
            .next()
            .expect("production source");
        let command_handlers = include_str!("command_handlers.rs");
        let runtime = include_str!("native_cloud_runtime.rs");
        let main = include_str!("main.rs");
        for call in [
            "publish_cloudflare_candidate_guarded(",
            ".observe_stored_credential_guarded(",
            ".begin_cloudflare_provision_prewrite_inspection(",
            ".mark_cloudflare_provision_write_started(",
            ".remediate_cloudflare_provision_prewrite(",
            ".resolve_cloudflare_provision(",
        ] {
            assert_eq!(production.matches(call).count(), 1, "{call}");
            assert!(!command_handlers.contains(call), "{call}");
            assert!(!runtime.contains(call), "{call}");
            assert!(!main.contains(call), "{call}");
        }
        let prewrite = production
            .find(".begin_cloudflare_provision_prewrite_inspection(")
            .expect("durable prewrite transition");
        let publish = production
            .find("publish_cloudflare_candidate_guarded(")
            .expect("Secure Host publication");
        let observation = production
            .find("pub(crate) async fn observe(")
            .expect("observation boundary");
        assert!(prewrite < publish && publish < observation);
        let post_prewrite_activation = &production[prewrite..observation];
        assert!(!post_prewrite_activation.contains("is_cancelled()"));
        assert!(!post_prewrite_activation.contains(".commit("));
        let host_types =
            include_str!("../../../../crates/local-storage/src/desktop_native_cloud.rs");
        let prepared = host_types
            .find("pub struct PreparedCloudflareProvision")
            .unwrap();
        let inspecting = host_types
            .find("pub struct InspectingCloudflareProvision")
            .unwrap();
        let marked = host_types
            .find("pub struct MarkedCloudflareProvision")
            .unwrap();
        assert!(prepared < inspecting && inspecting < marked);
        assert!(!host_types[prepared..inspecting].contains("with_keychain_plan"));
        assert!(host_types[inspecting..marked].contains("with_keychain_plan"));
    }

    #[test]
    fn renderer_ipc_has_lookup_hints_only_and_no_sync_command() {
        let handlers = include_str!("command_handlers.rs");
        for forbidden in [
            "target_generation",
            "expected_generation",
            "scope_digest",
            "zone_digest",
            "public_proof",
            "connection_incarnation",
            "api_token",
            "cloudflare_sync",
        ] {
            assert!(!handlers.contains(forbidden), "{forbidden}");
        }
        assert!(handlers.contains("tauri::ipc::Request<'_>"));
        assert!(handlers.contains("decode_provider_request"));
    }

    #[test]
    fn provider_transport_keeps_fixed_https_and_secret_confinement() {
        let provider =
            include_str!("../../../../crates/secure-host-core/src/cloudflare_provider.rs");
        assert!(provider.contains("const ORIGIN: &str = \"https://api.cloudflare.com\""));
        assert!(provider.contains(".https_only(true)"));
        assert!(provider.contains(".no_proxy()"));
        assert!(provider.contains(".retry(reqwest::retry::never())"));
        assert!(!provider.contains("pub fn authorization"));
        assert!(!provider.contains("pub struct CloudflareProviderRequest"));
        assert!(!provider.contains("pub struct CloudflareProviderResponse"));
    }
}
