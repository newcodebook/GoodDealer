#[test]
fn provider_failures_a_person_can_act_on_stay_apart() {
    use super::{ProviderCredentialError, provider_error};
    use gooddealer_secure_host_core::CloudflareProviderError;
    assert_eq!(
        provider_error(CloudflareProviderError::Transport),
        ProviderCredentialError::ProviderUnreachable
    );
    assert_eq!(
        provider_error(CloudflareProviderError::Retryable),
        ProviderCredentialError::ProviderRetryLater
    );
    assert_eq!(
        provider_error(CloudflareProviderError::CredentialRefused),
        ProviderCredentialError::CredentialRejected
    );
    // Any other non-retryable refusal (a redirect, a missing zone, a malformed 200) says
    // nothing about the credential, so it stays generic.
    for error in [
        CloudflareProviderError::Deterministic,
        CloudflareProviderError::AuthorityStale,
        CloudflareProviderError::InvalidInput,
        CloudflareProviderError::InvalidResponse,
        CloudflareProviderError::ResponseLimit,
    ] {
        assert_eq!(provider_error(error), ProviderCredentialError::Provider);
    }
}

#[test]
fn credential_orchestrator_is_the_only_native_forwarding_callsite() {
    let orchestrator = include_str!("cloudflare.rs");
    let production = orchestrator
        .split("#[cfg(test)]")
        .next()
        .expect("production source");
    let command_handlers = include_str!("../command_handlers.rs");
    let runtime = include_str!("../native_cloud_runtime.rs");
    let main = include_str!("../main.rs");
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
    for call in [
        "publish_cloudflare_tombstone_guarded(",
        ".begin_cloudflare_revocation_prewrite_inspection(",
        ".mark_cloudflare_revocation_write_started(",
        ".remediate_cloudflare_revocation_prewrite(",
        ".resolve_cloudflare_revocation(",
    ] {
        assert_eq!(production.matches(call).count(), 1, "{call}");
        assert!(!command_handlers.contains(call), "{call}");
        assert!(!runtime.contains(call), "{call}");
        assert!(!main.contains(call), "{call}");
    }
    // Revocation: once custody inspection has durably begun, nothing may abandon the
    // tombstone publication midway, exactly as for provision.
    let revocation_prewrite = production
        .find(".begin_cloudflare_revocation_prewrite_inspection(")
        .expect("durable revocation prewrite transition");
    let tombstone = production
        .find("publish_cloudflare_tombstone_guarded(")
        .expect("Secure Host tombstone publication");
    let revocation_end = production
        .find("pub(crate) async fn purge(")
        .expect("end of the revocation boundary");
    assert!(revocation_prewrite < tombstone && tombstone < revocation_end);
    let post_prewrite_revocation = &production[revocation_prewrite..revocation_end];
    assert!(!post_prewrite_revocation.contains("is_cancelled()"));
    assert!(!post_prewrite_revocation.contains(".commit("));
    let host_types =
        include_str!("../../../../../crates/local-storage/src/desktop_native_cloud.rs");
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
    let prepared = host_types
        .find("pub struct PreparedCloudflareRevocation")
        .unwrap();
    let inspecting = host_types
        .find("pub struct InspectingCloudflareRevocation")
        .unwrap();
    let marked = host_types
        .find("pub struct MarkedCloudflareRevocation")
        .unwrap();
    assert!(prepared < inspecting && inspecting < marked);
    assert!(!host_types[prepared..inspecting].contains("with_keychain_plan"));
    assert!(host_types[inspecting..marked].contains("with_keychain_plan"));
}

#[test]
fn revocation_outcome_keeps_every_resolution_distinct() {
    use super::RevocationOutcome;
    use gooddealer_local_storage::DesktopCloudflareResolution as Resolution;
    let outcomes = [
        Resolution::Confirmed,
        Resolution::PrewriteRemediated,
        Resolution::TargetNotObservedBurned,
        Resolution::TargetPresentAuthorityStaleBurned,
        Resolution::RecoveryRequired,
    ]
    .map(RevocationOutcome::from_resolution);
    assert_eq!(
        outcomes,
        [
            RevocationOutcome::Revoked,
            RevocationOutcome::PrewriteRemediated,
            RevocationOutcome::NotObservedBurned,
            RevocationOutcome::AuthorityStaleBurned,
            RevocationOutcome::RecoveryRequired,
        ]
    );
    assert!(!outcomes.contains(&RevocationOutcome::NothingToRevoke));
}

#[test]
fn every_provider_operation_ends_by_re_reading_projections() {
    // An operation can commit Host state before it fails or returns an unconfirmed result,
    // so the wake must not depend on the outcome.
    let runtime = include_str!("../native_cloud_runtime.rs");
    let start = runtime
        .find("async fn run_provider_operation(")
        .expect("provider operation runner");
    let end = start + runtime[start..].find("\n}\n").expect("end of the runner");
    let runner = &runtime[start..end];
    // Exactly one wake, as the runner's last statement at function-body depth, so no branch
    // or early return can skip it.
    assert!(
        runner
            .trim_end_matches('\n')
            .ends_with("\n    projection.wake();")
    );
    assert_eq!(runner.matches("projection.wake()").count(), 1);
    assert!(!runner.contains("return ") && !runner.contains("return;") && !runner.contains(")?"));
}

#[test]
fn renderer_ipc_has_lookup_hints_only_and_no_sync_command() {
    let handlers = include_str!("../command_handlers.rs");
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
        include_str!("../../../../../crates/secure-host-core/src/cloudflare_provider.rs");
    assert!(provider.contains("const ORIGIN: &str = \"https://api.cloudflare.com\""));
    assert!(provider.contains(".https_only(true)"));
    assert!(provider.contains(".no_proxy()"));
    assert!(provider.contains(".retry(reqwest::retry::never())"));
    assert!(!provider.contains("pub fn authorization"));
    assert!(!provider.contains("pub struct CloudflareProviderRequest"));
    assert!(!provider.contains("pub struct CloudflareProviderResponse"));
}
