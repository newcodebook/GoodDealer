import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

const expectedSourceFiles = [
  "afternic_credentials.rs",
  "afternic_provider.rs",
  "afternic_provider_tests.rs",
  "afternic_wire.rs",
  "aliyun.rs",
  "aliyun/credentials.rs",
  "aliyun/registrar_wire.rs",
  "aliyun/signing.rs",
  "atom.rs",
  "atom/credentials.rs",
  "atom/portfolio_wire.rs",
  "cloudflare_capture.rs",
  "cloudflare_keychain.rs",
  "cloudflare_provider.rs",
  "cloudflare_registrar.rs",
  "cloudflare_registrar_credential.rs",
  "desktop_authorization_verifier.rs",
  "desktop_device_identity.rs",
  "desktop_device_identity/execution_evidence.rs",
  "desktop_device_directory.rs",
  "desktop_oauth.rs",
  "godaddy.rs",
  "godaddy/credentials.rs",
  "godaddy/dns_wire.rs",
  "godaddy/registrar_wire.rs",
  "lib.rs",
  "linux_credential_capture.rs",
  "local_workspace_binding.rs",
  "macos_pair_capture.rs",
  "native_continuous_clock.rs",
  "native_continuous_clock/macos.rs",
  "native_continuous_clock/windows.rs",
  "native_power.rs",
  "native_power/linux.rs",
  "native_power/macos.rs",
  "native_power/windows.rs",
  "porkbun.rs",
  "porkbun/credentials.rs",
  "porkbun/registrar_wire.rs",
  "provider_credential_slot.rs",
  // ADR-0027 per-platform Service skeleton: crate-private, no public export.
  "provider_services/afternic.rs",
  "provider_services/aliyun.rs",
  "provider_services/atom.rs",
  "provider_services/cloudflare.rs",
  "provider_services/dynadot.rs",
  "provider_services/ename.rs",
  "provider_services/godaddy.rs",
  "provider_services/mod.rs",
  "provider_services/namecheap.rs",
  "provider_services/porkbun.rs",
  "provider_services/sedo.rs",
  "provider_services/spaceship.rs",
  "provider_services/twenty_two_cn.rs",
  "secret_service_custody.rs",
  "sedo.rs",
  "sedo/credentials.rs",
  "sedo/portfolio_wire.rs",
  "spaceship.rs",
  "spaceship/credentials.rs",
  "spaceship/registrar_wire.rs",
  "spaceship/sellerhub_verification_wire.rs",
  "spaceship/sellerhub_wire.rs",
  "windows_credential_capture.rs",
  "windows_custody.rs",
  "windows_custody/format.rs",
  "windows_private_files.rs",
  "windows_private_files/protected_acl.rs",
];
// Fixed Afternic capability facade; no URL, request-header or credential-bytes forwarding.
const expectedAfternicExports = [
  "AfternicCapture", "AfternicCredential", "AfternicCredentialPlan",
  "load_afternic_credential_guarded", "publish_afternic_credential_guarded", "purge_afternic_credential_guarded",
  "AfternicDomainObservation", "AfternicError", "AfternicGuard", "AfternicListing", "AfternicListingFields",
  "AfternicListingIntent", "AfternicListingStatus", "AfternicPortfolio", "AfternicProviderClient", "AfternicWriteOutcome",
];
const expectedSpaceshipExports = [
  "SpaceshipCapture", "SpaceshipCredential", "SpaceshipCredentialPlan", "SpaceshipError", "SpaceshipGuard",
  "SpaceshipClient", "SpaceshipRegistration", "SpaceshipRegistrationStanding",
  "SpaceshipSellerHubCreateObservation", "SpaceshipSellerHubListing", "SpaceshipSellerHubStatus",
  "SpaceshipSellerHubTxtOption", "SpaceshipSellerHubTxtRecord",
  "load_spaceship_credential_guarded", "publish_spaceship_credential_guarded", "purge_spaceship_credential_guarded",
];
const expectedAliyunExports = [
  "AliyunCapture", "AliyunCredential", "AliyunCredentialPlan", "AliyunError", "AliyunGuard",
  "AliyunRegistrarClient", "AliyunRegistration",
  "load_aliyun_credential_guarded", "publish_aliyun_credential_guarded", "purge_aliyun_credential_guarded",
];
const expectedGoDaddyExports = [
  "GoDaddyCapture", "GoDaddyCredential", "GoDaddyCredentialPlan", "GoDaddyDnsClient",
  "GoDaddyDnsRecord", "GoDaddyDnsRecordType", "GoDaddyDnsZone", "GoDaddyError", "GoDaddyGuard",
  "GoDaddyRegistrarClient", "GoDaddyRegistration", "GoDaddyRegistrationStanding",
  "load_godaddy_credential_guarded", "publish_godaddy_credential_guarded", "purge_godaddy_credential_guarded",
];
const expectedPorkbunExports = [
  "PorkbunCapture", "PorkbunCredential", "PorkbunCredentialPlan", "PorkbunError", "PorkbunGuard",
  "PorkbunRegistrarClient", "PorkbunRegistration",
  "load_porkbun_credential_guarded", "publish_porkbun_credential_guarded", "purge_porkbun_credential_guarded",
];
const expectedAtomExports = [
  "AtomCapture", "AtomCredential", "AtomCredentialPlan", "AtomError", "AtomGuard",
  "AtomListing", "AtomListingState", "AtomPortfolioClient", "AtomSellerInventory",
  "load_atom_credential_guarded", "publish_atom_credential_guarded", "purge_atom_credential_guarded",
];
const expectedSedoExports = [
  "SedoCapture", "SedoCredential", "SedoCredentialPlan", "SedoCurrency", "SedoError",
  "SedoGuard", "SedoListing", "SedoPortfolioClient", "load_sedo_credential_guarded",
  "publish_sedo_credential_guarded", "purge_sedo_credential_guarded",
];
const expectedCloudflareCaptureExports = [
  "CloudflareCandidate",
  "CloudflareCapture",
  "CloudflareCaptureError",
];
const expectedCloudflareKeychainExports = [
  "CloudflareCredentialProvisionPlan",
  "CloudflareCredentialPublicKind",
  "CloudflareCredentialRecoveryPlan",
  // ADR-0028: only the committed retirement slot plan and closed delete outcome are public.
  "CloudflareCredentialRetirementPlan",
  "CloudflareCustodyComparison",
  "CloudflareKeychainError",
  "CloudflareKeychainGuard",
  "CloudflarePrewriteFailure",
  "CloudflarePrewriteInspection",
  "CloudflarePurgeOutcome",
  "inspect_cloudflare_recovery_guarded",
  "publish_cloudflare_candidate_guarded",
  "publish_cloudflare_tombstone_guarded",
  "purge_retired_cloudflare_slot",
];
const expectedCloudflareProviderExports = [
  "CloudflareCredentialObservationPlan",
  "CloudflareProviderClient",
  "CloudflareProviderError",
  "CloudflareProviderGuard",
  "CloudflareProviderObservation",
  "CloudflareProviderRecord",
  "CloudflareProviderZone",
  "CloudflareProviderZoneStatus",
  "CloudflareRecordType",
  "CloudflareRegistrarCredential",
  "CloudflareRegistrarCredentialError",
  "CloudflareRegistrarCredentialGuard",
  "CloudflareRegistrarCredentialPlan",
  "CloudflareRegistration",
  "CloudflareRegistrationInventory",
  "CloudflareRegistrationStanding",
  "load_cloudflare_registrar_credential",
  "publish_cloudflare_registrar_credential",
  "purge_cloudflare_registrar_credential",
];
const expectedNativePowerExports = [
  "NativePowerMonitor", "NativePowerGate", "NativePowerSnapshot",
  "NativePowerCommitGuard", "NativePowerUnavailable",
];
const expectedNativePowerPublicItems = [
  ...expectedNativePowerExports,
  "start", "stop", "gate", "snapshot", "wait_for_epoch_change",
  "hold_write_epoch", "hold_reconciliation_epoch",
];
const expectedNativeContinuousClockExports = [
  "NativeContinuousClockKind", "NativeContinuousClockSample", "NativeContinuousClockError",
  "capture_native_continuous_clock",
];
const expectedNativeContinuousClockPublicItems = [
  ...expectedNativeContinuousClockExports, "clock_kind", "boot_id", "ticks",
];
const desktopAuthorizationSourceFile = "desktop_authorization_verifier.rs";
const desktopDeviceIdentitySourceFile = "desktop_device_identity.rs";
const desktopOAuthSourceFile = "desktop_oauth.rs";
const localWorkspaceBindingSourceFile = "local_workspace_binding.rs";
const expectedDesktopAuthorizationExports = [
  "AuthorizationVerificationKeyError",
  "DesktopAuthorizationCredentialPurpose",
  "DesktopAuthorizationVerificationKey",
  "DesktopAuthorizationVerifier",
  "parse_desktop_authorization_verifier_registry",
];
const expectedDesktopAuthorizationPublicItems = [
  "AuthorizationVerificationKeyError",
  "DesktopAuthorizationCredentialPurpose",
  "DesktopAuthorizationVerificationKey",
  "DesktopAuthorizationVerifier",
  "new",
  "new",
  "parse_desktop_authorization_verifier_registry",
  "verify",
];
const expectedDesktopDeviceDirectoryExports = [
  "DesktopDeviceDirectory",
  "DeviceDirectoryRejected",
  "parse_desktop_device_directory",
  "prepare_desktop_device_self_report",
];
const expectedDesktopDeviceIdentityExports = [
  "DESKTOP_DEVICE_PROOF_DOMAIN",
  "DesktopDeviceIdentity",
  "DesktopDeviceIdentityError",
  "DesktopDeviceProofTranscript",
  "load_or_create_desktop_device_identity",
];
const expectedDesktopDeviceIdentityPublicItems = [
  "DESKTOP_DEVICE_PROOF_DOMAIN",
  "DesktopDeviceIdentity",
  "DesktopDeviceIdentityError",
  "DesktopDeviceProofTranscript",
  "device_id",
  "from_test_material",
  "key_id",
  "load_or_create_desktop_device_identity",
  "public_key_base64url",
  // ADR-0032 S2d1: signs only a handoff drain-proof transcript naming this device and key.
  "sign_drain_proof_transcript",
  "sign_login_proof",
];
const expectedDesktopOAuthExports = [
  "DesktopAccessToken",
  "DesktopAuthorizationCodeExchange",
  "DesktopOAuthAttempt",
  "DesktopOAuthContinuation",
  "DesktopOAuthError",
  "DesktopRefreshRequestId",
  "DesktopRefreshToken",
  "clear_desktop_refresh_request_id",
  "clear_desktop_refresh_token",
  "load_desktop_refresh_request_id",
  "load_desktop_refresh_token",
  "store_desktop_refresh_request_id",
  "store_desktop_refresh_token",
];
const expectedDesktopOAuthPublicItems = [
  "DesktopAccessToken",
  "DesktopAuthorizationCodeExchange",
  "DesktopOAuthAttempt",
  "DesktopOAuthContinuation",
  "DesktopOAuthError",
  "DesktopRefreshRequestId",
  "DesktopRefreshToken",
  "authorization_url",
  "begin",
  "begin_forced_takeover_reauthentication",
  "callback_state_matches",
  "clear_desktop_refresh_request_id",
  "clear_desktop_refresh_token",
  "advance",
  "expose",
  "expose",
  "expose",
  "expose",
  "generate",
  "load_desktop_refresh_request_id",
  "load_desktop_refresh_token",
  "new",
  "new",
  "store_desktop_refresh_request_id",
  "store_desktop_refresh_token",
];
const expectedLocalWorkspaceBindingExports = [
  "LocalWorkspaceBindingError",
  "VerifiedLocalWorkspaceBinding",
  "VerifiedLocalWorkspaceBindingParams",
  "clear_verified_local_workspace_binding",
  "load_verified_local_workspace_binding",
  "store_verified_local_workspace_binding",
];
const expectedLocalWorkspaceBindingPublicItems = [
  "LocalWorkspaceBindingError",
  "VerifiedLocalWorkspaceBinding",
  "account_id",
  "account_security_epoch",
  "allows_local_read",
  "allows_refresh_retry",
  "capability",
  "clear_verified_local_workspace_binding",
  "device_id",
  "entitlement_projection_digest",
  "entitlement_revision",
  "commercial_expires_at",
  "lease_epoch",
  "load_verified_local_workspace_binding",
  "new",
  "retryable_locked",
  "security_locked",
  "store_verified_local_workspace_binding",
  "trusted_time_floor",
  "with_trusted_time_floor",
  "workspace_id",
  "VerifiedLocalWorkspaceBindingParams",
];
const repositoryCoreRoot = resolve(import.meta.dirname, "../crates/secure-host-core");
const repositoryLocalStorageRoot = resolve(import.meta.dirname, "../crates/local-storage");
const expectedExecutionContextExports = [
  "DesktopContinuousClockKind", "DesktopContinuousClockReading", "DesktopExecutionSigningIdentity",
  "DesktopExecutionContextNativePort", "DesktopExecutionContextRequest", "DesktopExecutionContextError", "DesktopStagedExecutionContext",
];
const expectedLocalStorageExportModules = [
  "active_workspace::batch_operations",
  "active_workspace::business",
  "active_workspace::business",
  "active_workspace::business",
  "active_workspace::dns_health",
  "active_workspace::history",
  "active_workspace::manual_tasks",
  "active_workspace::renewals",
  "active_workspace::sales",
  "active_workspace::settings",
  "active_workspace::storage_repair",
  "desktop_local_host::afternic",
  "desktop_local_host::aliyun_registrar",
  "desktop_local_host::atom_marketplace",
  "desktop_local_host::cloudflare_registrar_account",
  "desktop_local_host::godaddy_registrar",
  "desktop_local_host::porkbun_registrar",
  "desktop_local_host::sedo_marketplace",
  "desktop_local_host::spaceship_registrar",
  "desktop_local_host::spaceship_sellerhub",
  "portfolio_projection",
  "application_root",
  "desktop_business_runtime",
  // ADR-0032 S2d: the source device's drain codecs for a device switch.
  "desktop_device_switch",
  "desktop_local_host",
  "desktop_local_host",
  "desktop_native_cloud",
  "desktop_sync_runtime",
  "active_workspace::business",
  "desktop_local_host::afternic_delist",
  "desktop_local_host::execution_context",
  "active_workspace::business",
  "desktop_local_host::execution_evidence_delivery",
  "desktop_local_host::target_installation",
  "desktop_local_host::target_bootstrap",
  "desktop_local_host::forced_takeover",
  "active_workspace::business",
  "desktop_local_host::afternic_listing_write",
  "active_workspace::business",
  "active_workspace::business",
  "desktop_local_host::afternic_listing_plan",
];
const expectedLocalStoragePublicExports = [
  "DesktopAfternicControlledAcceptance",
  "DesktopForcedTakeoverExchange", "DesktopForcedTakeoverExchangeKind",
  "DesktopForcedTakeoverPreview", "DesktopForcedTakeoverPreviewReason",
  "DesktopForcedTakeoverStoppedReason", "DesktopForcedTakeoverView", "DesktopForcedTakeoverWork",
  ...expectedExecutionContextExports,
  "DesktopTargetInstallationExchange", "DesktopTargetInstallationExchangeKind",
  "DesktopTargetInstallationNewWorkflow", "DesktopTargetInstallationPhase", "DesktopTargetInstallationStage",
  "DesktopTargetInstallationView", "DesktopTargetInstallationWork",
  "DesktopTargetBootstrapCancelExchange", "DesktopTargetBootstrapStatusExchange",
  "DesktopTargetBootstrapStatusOutcome", "DesktopTargetBootstrapTerminalStatus", "DesktopTargetBootstrapView",
  "AssetLibraryReadSnapshot",
  "AssetLibraryRow",
  "AssetLibraryWindow",
  "CloudflareDnsRecordWrite",
  "DesktopAfternicConnection",
  "DesktopAfternicConnectionSummary",
  "DesktopAfternicConnectionsRead",
  "DesktopAfternicInventoryReceipt",
  "DesktopAfternicListingObservation",
  "DesktopAfternicScanSummary",
  "DesktopAfternicDelistApproveRequest",
  "DesktopAfternicDelistClaim",
  "DesktopAfternicDelistPlan",
  "DesktopAfternicDelistPreviewItem",
  "DesktopAfternicDelistPreviewRequest",
  "DesktopAfternicDelistStatus",
  "DesktopAfternicDelistStatusRequest",
  "DesktopAfternicDelistSummary",
  "DesktopAfternicDelistWork",
  "DesktopAfternicDelistWorkKind",
  "DesktopAfternicListingWriteAction",
  "DesktopAfternicListingWritePatch",
  "DesktopAfternicListingWriteValues",
  "DesktopAfternicListingWriteCreateItem",
  "DesktopAfternicListingWriteUpdateItem",
  "DesktopAfternicListingWritePreviewRequest",
  "DesktopAfternicListingWriteApproveRequest",
  "DesktopAfternicListingWriteStatusRequest",
  "DesktopAfternicListingWriteObserved",
  "DesktopAfternicListingWriteItem",
  "DesktopAfternicListingWritePlan",
  "DesktopAfternicListingWriteSummary",
  "DesktopAfternicListingWriteStatus",
  "DesktopAfternicListingWriteWorkKind",
  "DesktopAfternicListingWriteWork",
  "DesktopAfternicListingWriteClaim",
  "DesktopAfternicListingPlan",
  "DesktopAfternicListingPlanAction",
  "DesktopAfternicListingPlanApproveRequest",
  "DesktopAfternicListingPlanPreviewRequest",
  "DesktopAfternicListingPlanStatus",
  "DesktopAfternicListingPlanStatusRequest",
  "DesktopAfternicListingPlanClaim",
  "DesktopAfternicListingPlanWork",
  "DesktopApplicationRoot",
  "DesktopApplicationRootError",
  "DesktopAssetLibraryReadRequest",
  "DesktopAuthorityIdentity",
  "DesktopBackupError",
  "DesktopBackupExportStatus",
  "DesktopBackupRestoreStatus",
  "DesktopCheckpointExchange",
  "DesktopCloudflareActivationAdmission",
  "DesktopCloudflareCheckedObservation",
  "DesktopCloudflareConnectionCreateRequest",
  "DesktopCloudflareConnectionCreated",
  "DesktopCloudflareConnectionRead",
  "DesktopCloudflareCustodyComparison",
  "DesktopCloudflareEnvelopeKind",
  "DesktopCloudflareKeychainPlan",
  "DesktopCloudflareMaintenanceAction",
  "DesktopCloudflarePrewriteFailure",
  "DesktopCloudflareObservationRead",
  "DesktopCloudflareObservationReadRequest",
  "DesktopCloudflareObservationRecord",
  "DesktopCloudflareProjectionClaim",
  "DesktopCloudflareProjectionDisposition",
  "DesktopCloudflareProjectionWork",
  "DesktopCloudflarePurgeOutcome",
  "DesktopCloudflareRecoveryHandle",
  "DesktopCloudflareRecoveryPlan",
  "DesktopCloudflareRecoveryScan",
  "DesktopCloudflareRegistrarScanReceipt",
  "DesktopCloudflareRegistrarAccount",
  "DesktopCloudflareRegistrarAccountState",
  "DesktopCloudflareRegistrarAccountStatus",
  "DesktopCloudflareRegistrarAccountSummary",
  "DesktopCloudflareRegistrationFact",
  "DesktopCloudflareRegistrationStanding",
  "DesktopRegistrarScanReceipt",
  "DesktopRegistrationFact",
  "DesktopRegistrationStanding",
  "DesktopSpaceshipConnection",
  "DesktopAliyunConnection",
  "DesktopGoDaddyConnection",
  "DesktopPorkbunConnection",
  "DesktopSpaceshipConnectionState",
  "DesktopAliyunConnectionState",
  "DesktopGoDaddyConnectionState",
  "DesktopPorkbunConnectionState",
  "DesktopSpaceshipConnectionSummary",
  "DesktopAliyunConnectionSummary",
  "DesktopGoDaddyConnectionSummary",
  "DesktopPorkbunConnectionSummary",
  "DesktopSpaceshipRegistrarStatus",
  "DesktopSellerHubConnection",
  "DesktopSellerHubCreateApproval",
  "DesktopSellerHubCreateApproveRequest",
  "DesktopSellerHubCreateClaim",
  "DesktopSellerHubCreateDetail",
  "DesktopSellerHubCreatePlanSummary",
  "DesktopSellerHubCreatePreview",
  "DesktopSellerHubCreatePreviewRequest",
  "DesktopSellerHubCreateStatus",
  "DesktopSellerHubCreateStatusRequest",
  "DesktopSellerHubCreateWork",
  "SellerHubCreateReadback",
  "DesktopSellerHubBinApproval",
  "DesktopSellerHubBinApproveRequest",
  "DesktopSellerHubBinClaim",
  "DesktopSellerHubBinPlan",
  "DesktopSellerHubBinPlanItem",
  "DesktopSellerHubBinPlanSummary",
  "DesktopSellerHubBinPreviewRequest",
  "DesktopSellerHubBinStatus",
  "DesktopSellerHubBinStatusRequest",
  "DesktopSellerHubBinTarget",
  "DesktopSellerHubBinWork",
  "DesktopSellerHubConnectionSummary",
  "DesktopSellerHubListingFact",
  "DesktopSellerHubListingState",
  "DesktopSellerHubScanReceipt",
  "DesktopSellerHubStatus",
  "DesktopAliyunRegistrarStatus",
  "DesktopGoDaddyRegistrarStatus",
  "DesktopPorkbunRegistrarStatus",
  "DesktopAtomConnection",
  "DesktopAtomConnectionState",
  "DesktopAtomConnectionSummary",
  "DesktopAtomMarketplaceStatus",
  "DesktopAtomInventoryReceipt",
  "DesktopAtomListingFact",
  "DesktopAtomListingObservation",
  "DesktopAtomListingState",
  "DesktopAtomStandardDelistApproveRequest",
  "DesktopAtomStandardDelistClaim",
  "DesktopAtomStandardDelistPreview",
  "DesktopAtomStandardDelistPreviewRequest",
  "DesktopAtomStandardDelistStatus",
  "DesktopAtomStandardDelistStatusRequest",
  "DesktopAtomStandardDelistWork",
  "DesktopSedoConnection",
  "DesktopSedoConnectionState",
  "DesktopSedoCurrency",
  "DesktopSedoMarketplaceConnectionSummary",
  "DesktopSedoMarketplaceListingFact",
  "DesktopSedoMarketplaceScanReceipt",
  "DesktopSedoMarketplaceStatus",
  "DesktopCloudflareResolution",
  "DesktopCloudflareRetirement",
  "DesktopCloudflareRetirementCandidate",
  "DesktopCloudflareRetirementPlan",
  "DesktopConflict",
  "DesktopConflictCenterView",
  "DesktopConflictFreshness",
  "DesktopConflictResolutionReceipt",
  "DesktopConflictResolveRequest",
  "DesktopDeviceLease",
  "DesktopDeviceSwitchOutcome",
  "DesktopDeviceSwitchRejection",
  "DesktopDeviceSwitchRequestExchange",
  "DesktopDeviceSwitchRequestResolution",
  "DesktopDeviceSwitchRequestResolutionOutcome",
  "DesktopExecutionEvidenceStream",
  "DesktopExecutionEvidenceDeliveryOutcome",
  "DesktopExecutionEvidenceUpload",
  "DesktopDeviceSwitchStart",
  "DesktopDeviceSwitchStatus",
  "DesktopDrainProgress",
  "DesktopDrainProofDraft",
  "DesktopDrainReceiptQuery",
  "DesktopDnsHealthReadRequest",
  "DesktopDomainAssetCreateRequest",
  "DesktopDomainAssetDeleteRequest",
  "DesktopDomainAssetEditRequest",
  "DesktopDomainAssetProviderBindingReceipt",
  "DesktopDomainAssetProviderBindingRequest",
  "DesktopDomainAssetWrite",
  "DesktopDomainDetailReadRequest",
  "DesktopHistoryReadRequest",
  "DesktopManualTasksReadRequest",
  "DesktopHostAuthorizationStatus",
  "DesktopLocalBusinessState",
  "DesktopLocalBusinessStatus",
  "DesktopLocalHost",
  "DesktopLocalHostError",
  "DesktopVerifiedBackupArtifact",
  "DesktopNativeCloudAdmission",
  "DesktopRenewalsReadRequest",
  "DesktopBatchOperationsReadRequest",
  "DesktopSalesReadRequest",
  "DesktopSyncCheckpointDisposition",
  "DesktopSyncPullDisposition",
  "DesktopSyncPullExchange",
  "DesktopSyncPushClaim",
  "DesktopSyncPushDisposition",
  "DesktopSyncPushWork",
  "DesktopStorageRepairReceipt",
  "DesktopStorageRepairRequest",
  "DesktopSyncSnapshotView",
  "DesktopSyncTransportState",
  "BatchOperationRow",
  "BatchOperationsReadSnapshot",
  "BatchOperationsWindow",
  "BatchPlannedCounts",
  "BatchResultCounts",
  "DnsHealthReadSnapshot",
  "DnsHealthRow",
  "DnsHealthWindow",
  "DnsRecordCounts",
  "DnsZoneBinding",
  "DnsZoneObservationSummary",
  "HistoryFieldChange",
  "HistoryReadSnapshot",
  "HistoryRow",
  "HistoryWindow",
  "ManualTaskRow",
  "ManualTasksReadSnapshot",
  "ManualTasksWindow",
  "DomainAssetMutationReceipt",
  "DomainDetailAsset",
  "DomainDetailReadSnapshot",
  "Money",
  "PortfolioReadFreshness",
  "InspectingCloudflareProvision",
  "InspectingCloudflareRevocation",
  "MarkedCloudflareProvision",
  "MarkedCloudflareRevocation",
  "PreparedCloudflareObservation",
  "PreparedCloudflareRegistrarInventory",
  "PreparedCloudflareProvision",
  "PreparedCloudflareRevocation",
  "RenewalRow",
  "RenewalsReadSnapshot",
  "RenewalsWindow",
  "SalesListingRow",
  "SalesMoney",
  "SalesReadSnapshot",
  "SalesWindow",
  "SettingsConnection",
  "SettingsConnectionRole",
  "SettingsReadSnapshot",
  "StorageRepairKind",
].sort();

export function secureHostCoreFinalSurfaceErrors({ coreRoot = repositoryCoreRoot } = {}) {
  const errors = [];
  const sourceRoot = resolve(coreRoot, "src");
  const generatedRoot = resolve(sourceRoot, "generated");
  const generatedState = pathState(generatedRoot);
  if (generatedState !== "missing") {
    errors.push(`secure-host-core source generated root must be absent, found ${generatedState}`);
  }

  const sourceState = pathState(sourceRoot);
  if (sourceState !== "directory") {
    errors.push(`secure-host-core source root must be a real directory, found ${sourceState}`);
    return errors;
  }

  const observedFiles = listRegularFiles(sourceRoot, errors).sort();
  if (!sameArray(observedFiles, [...expectedSourceFiles].sort())) {
    errors.push(`secure-host-core source allowlist differs: ${observedFiles.join(", ")}`);
  }

  const libPath = resolve(sourceRoot, "lib.rs");
  if (pathState(libPath) !== "file") return errors;
  const libSource = readRegularFile(libPath, errors);
  if (libSource === null) return errors;
  const exportPattern = /^[\t ]*pub[\t ]+use[\t ]+(afternic_credentials|afternic_provider|cloudflare_capture|cloudflare_keychain|cloudflare_provider|desktop_authorization_verifier|desktop_device_identity|desktop_oauth|local_workspace_binding|desktop_device_directory|native_power|native_continuous_clock|aliyun|atom|godaddy|porkbun|sedo|spaceship)::[\t ]*(?:\{([\s\S]*?)\}|([A-Za-z_][A-Za-z0-9_]*))[\t ]*;/gmu;
  const exportMatches = [...libSource.matchAll(exportPattern)];
  const expectedExportModules = [
    "aliyun",
    "atom",
    "godaddy",
    "porkbun",
    "sedo",
    "spaceship",
    "afternic_credentials",
    "afternic_provider",    "cloudflare_capture",
    "cloudflare_keychain",
    "cloudflare_provider",
    "desktop_authorization_verifier",
    "desktop_device_identity",
    "desktop_oauth",
    "local_workspace_binding",
    "desktop_device_directory",
    "native_power",
    "native_continuous_clock",
  ];
  if (!sameArray(exportMatches.map((match) => match[1]), expectedExportModules)) {
    errors.push("secure-host-core direct capability export blocks are missing, reordered, or duplicated");
    return errors;
  }
  const exported = exportMatches
    .flatMap((match) => (match[2] ?? match[3]).split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const expectedPublicExports = [
    ...expectedNativePowerExports,
    ...expectedNativeContinuousClockExports,
    ...expectedAfternicExports,
    ...expectedSpaceshipExports,
    ...expectedAliyunExports,
    ...expectedGoDaddyExports,
    ...expectedPorkbunExports,
    ...expectedAtomExports,
    ...expectedSedoExports,
    ...expectedCloudflareCaptureExports,
    ...expectedCloudflareKeychainExports,
    ...expectedCloudflareProviderExports,
    ...expectedDesktopAuthorizationExports,
    ...expectedDesktopDeviceIdentityExports,
    ...expectedDesktopDeviceDirectoryExports,
    ...expectedDesktopOAuthExports,
    ...expectedLocalWorkspaceBindingExports,
  ].sort();
  if (!sameArray(exported, expectedPublicExports)) {
    errors.push(`secure-host-core public exports differ: ${exported.join(", ")}`);
  }
  const remainingSource = libSource.replace(exportPattern, "");
  if (/\bpub\s+(?:(?:(?:const|async|unsafe)\s+)*fn|use|mod|struct|enum|trait|type|const|static)\b/u.test(remainingSource)) {
    errors.push("secure-host-core exposes a public item outside the exact capability export blocks");
  }
  const exactPublicItemSurfaces = [
    ["desktop_device_identity/execution_evidence.rs", [
      "sign_afternic_delist_approval_transcript", "sign_afternic_listing_plan_approval_transcript",
      "sign_afternic_listing_write_approval_transcript", "sign_afternic_ownership_review_approval_transcript", "sign_sellerhub_bin_price_approval_transcript", "sign_sellerhub_create_listing_approval_transcript", "sign_atom_standard_delist_approval_transcript", "sign_atom_standard_listing_approval_transcript", "sign_device_audit_event_transcript",
      "sign_execution_fact_transcript",
    ], "device execution evidence"],
    ["native_continuous_clock.rs", expectedNativeContinuousClockPublicItems, "native continuous clock"],
    ["native_power.rs", expectedNativePowerPublicItems, "native power"],
    ["desktop_device_directory.rs", expectedDesktopDeviceDirectoryExports, "desktop device directory"],
    [desktopAuthorizationSourceFile, expectedDesktopAuthorizationPublicItems, "desktop authorization"],
    [desktopOAuthSourceFile, expectedDesktopOAuthPublicItems, "desktop OAuth"],
    [desktopDeviceIdentitySourceFile, expectedDesktopDeviceIdentityPublicItems, "desktop device identity"],
    [localWorkspaceBindingSourceFile, expectedLocalWorkspaceBindingPublicItems, "local workspace binding"],
  ];
  for (const [path, expected, label] of exactPublicItemSurfaces) {
    const source = readRegularFile(resolve(sourceRoot, path), errors);
    if (source !== null) {
      validateExactPublicItems(source, expected, label, errors);
      if (path === "native_continuous_clock.rs"
        && /\bpub\s+[A-Za-z_][A-Za-z0-9_]*\s*:/u.test(source)) {
        errors.push("native continuous clock must not expose public fields");
      }
      if (path === "native_power.rs") {
        const fields = [...source.matchAll(/\bpub\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^,\n]+)/gu)]
          .map((match) => `${match[1]}: ${match[2].trim()}`).sort();
        if (!sameArray(fields, ["epoch: u64", "paused: bool", "ready: bool"])) {
          errors.push("native power public fields differ from the safe snapshot");
        }
      }
    }
  }
  return errors;
}

export function localStorageFinalSurfaceErrors({ storageRoot = repositoryLocalStorageRoot } = {}) {
  const errors = [];
  const libPath = resolve(storageRoot, "src/lib.rs");
  if (pathState(libPath) !== "file") {
    errors.push("local-storage public surface source must be a regular file");
    return errors;
  }
  const libSource = readRegularFile(libPath, errors, storageRoot);
  if (libSource === null) return errors;
  const bracedExportPattern = /^[\t ]*pub[\t ]+use[\t ]+([A-Za-z_][A-Za-z0-9_:]*)::[\t ]*\{([\s\S]*?)\};/gmu;
  const singleExportPattern = /^[\t ]*pub[\t ]+use[\t ]+([A-Za-z_][A-Za-z0-9_:]*)::([A-Za-z_][A-Za-z0-9_]*)[\t ]*;/gmu;
  const exportMatches = [
    ...[...libSource.matchAll(bracedExportPattern)].map((match) => ({
      index: match.index,
      module: match[1],
      exports: match[2].split(","),
    })),
    ...[...libSource.matchAll(singleExportPattern)].map((match) => ({
      index: match.index,
      module: match[1],
      exports: [match[2]],
    })),
  ].sort((left, right) => left.index - right.index);
  if (!sameArray(exportMatches.map(({ module }) => module), expectedLocalStorageExportModules)) {
    errors.push("local-storage direct public export blocks are missing, reordered, or duplicated");
    return errors;
  }
  const exported = exportMatches
    .flatMap(({ exports }) => exports)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  if (!sameArray(exported, expectedLocalStoragePublicExports)) {
    errors.push(`local-storage public exports differ: ${exported.join(", ")}`);
  }
  const remainingSource = libSource
    .replace(bracedExportPattern, "")
    .replace(singleExportPattern, "");
  if (/\bpub\s+(?:(?:(?:const|async|unsafe)\s+)*fn|use|mod|struct|enum|trait|type|const|static)\b/u.test(remainingSource)) {
    errors.push("local-storage exposes a public item outside the exact aggregate export blocks");
  }
  const context = readRegularFile(resolve(storageRoot, "src/desktop_local_host/execution_context.rs"), errors, storageRoot);
  if (context !== null) {
    // Only the constructor-installed Native port can sample time or installed identity. Runtime
    // setters, caller-selected clocks, and mutable request fields would bypass that boundary.
    const publicItems = [...context.matchAll(/\bpub\s+(?:(?:(?:const|async|unsafe)\s+)*fn|enum|struct|trait|type|const|static|use|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/gu)]
      .map((match) => match[1]).sort();
    const expected = [...expectedExecutionContextExports, "from_native_parts", "from_native_parts",
      "request_body", "production_with_execution_context", "prepare_execution_context_request",
      "stage_execution_context_response", "cancel_execution_context_request", "stage_execution_context_restore",
      "publish_staged_execution_context"].sort();
    if (!sameArray(publicItems, expected) || /\bpub\s+[A-Za-z_][A-Za-z0-9_]*\s*:/u.test(context)) {
      errors.push("execution context public surface must remain the exact Native admission boundary");
    }
    const port = context.match(/pub\s+trait\s+DesktopExecutionContextNativePort\s*:\s*Send\s*\+\s*Sync\s*\{([\s\S]*?)^\}/mu)?.[1];
    const methods = [...(port ?? "").matchAll(/^[\t ]*fn\s+[A-Za-z_][A-Za-z0-9_]*[\s\S]*?(?:;[\t ]*$|\{[\t ]*\n[\t ]*Err\(Error::Unavailable\)[\t ]*\n[\t ]*\}[\t ]*$)/gmu)]
      .map((match) => match[0].replace(/\s+/gu, "").replace(/,\)/gu, ")"));
    if (!sameArray(methods, [
      "fnsign_afternic_delist_approval(&self,transcript:&[u8])->Result<[u8;64],Error>;",
      "fnsign_afternic_listing_write_approval(&self,transcript:&[u8])->Result<[u8;64],Error>;",
      "fnsign_afternic_listing_plan_approval(&self,_transcript:&[u8])->Result<[u8;64],Error>{Err(Error::Unavailable)}",
      "fnsign_afternic_ownership_review_approval(&self,_transcript:&[u8])->Result<[u8;64],Error>{Err(Error::Unavailable)}",
      "fnsign_sellerhub_bin_price_approval(&self,_transcript:&[u8])->Result<[u8;64],Error>{Err(Error::Unavailable)}",
      "fnsign_sellerhub_create_listing_approval(&self,_transcript:&[u8])->Result<[u8;64],Error>{Err(Error::Unavailable)}",
      "fnsign_atom_standard_delist_approval(&self,_transcript:&[u8])->Result<[u8;64],Error>{Err(Error::Unavailable)}",
      "fnsign_device_audit_event(&self,transcript:&[u8])->Result<[u8;64],Error>;",
      "fnsign_execution_fact(&self,transcript:&[u8])->Result<[u8;64],Error>;",
      "fncapture_clock(&self)->Result<DesktopContinuousClockReading,Error>;",
      "fnsigning_identity(&self)->Result<DesktopExecutionSigningIdentity,Error>;"])) {
      errors.push("execution context Native port must not accept caller-selected clock or identity inputs");
    }
  }
  return errors;
}

function validateExactPublicItems(source, expected, label, errors) {
  const publicItems = [...source.matchAll(
    /\bpub(?:\s*\([^)]*\))?\s+(?:(?:(?:const|async|unsafe)\s+)*fn|const|enum|mod|static|struct|trait|type|use)\s+([A-Za-z_][A-Za-z0-9_]*)/gu,
  )].map((match) => match[1]).sort();
  if (!sameArray(publicItems, [...expected].sort())) {
    errors.push(`${label} public items differ: ${publicItems.join(", ")}`);
  }
}

function pathState(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    return "unreadable";
  }
}

function listRegularFiles(root, errors) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const state = pathState(path);
      if (state === "directory") {
        visit(path);
      } else if (state === "file") {
        files.push(relative(root, path).replaceAll("\\", "/"));
      } else {
        errors.push(`secure-host-core source entry must be a regular file or directory: ${relative(root, path)}`);
      }
    }
  }
  visit(root);
  return files;
}

function readRegularFile(path, errors, ownerRoot = repositoryCoreRoot) {
  try {
    return lstatSync(path).isFile() ? readFileSync(path, "utf8") : null;
  } catch (error) {
    errors.push(`surface source file is unreadable: ${relative(ownerRoot, path)}`);
    return null;
  }
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function writeFixture(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  for (const path of expectedSourceFiles) {
    mkdirSync(dirname(join(root, "src", path)), { recursive: true });
    writeFileSync(
      join(root, "src", path),
      readFileSync(resolve(repositoryCoreRoot, "src", path), "utf8"),
    );
  }
}

function useFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-secure-host-core-"));
  writeFixture(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function useLocalStorageFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-local-storage-surface-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src/lib.rs"),
    readFileSync(resolve(repositoryLocalStorageRoot, "src/lib.rs"), "utf8"),
  );
  mkdirSync(join(root, "src/desktop_local_host"), { recursive: true });
  writeFileSync(join(root, "src/desktop_local_host/execution_context.rs"),
    readFileSync(resolve(repositoryLocalStorageRoot, "src/desktop_local_host/execution_context.rs"), "utf8"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the repository Core surface is the exact staged native capability allowlist", () => {
  assert.deepEqual(secureHostCoreFinalSurfaceErrors(), []);
  assert.deepEqual(localStorageFinalSurfaceErrors(), []);
});

test("accepts the exact staged native capability surface", (t) => {
  assert.deepEqual(secureHostCoreFinalSurfaceErrors({ coreRoot: useFixture(t) }), []);
  assert.deepEqual(localStorageFinalSurfaceErrors({ storageRoot: useLocalStorageFixture(t) }), []);
  const missingFileFixture = useFixture(t);
  rmSync(join(missingFileFixture, "src", "cloudflare_capture.rs"));
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: missingFileFixture }).some(
    (error) => error.includes("allowlist"),
  ));
});

test("rejects a recreated generated directory or dangling symbolic link", (t) => {
  const directoryFixture = useFixture(t);
  mkdirSync(join(directoryFixture, "src", "generated"));
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: directoryFixture }).some((error) => error.includes("must be absent")));

  const linkFixture = useFixture(t);
  symlinkSync("missing-target", join(linkFixture, "src", "generated"));
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: linkFixture }).some((error) => error.includes("symlink")));
});

test("rejects extra source files and public exports", (t) => {
  const extraFileFixture = useFixture(t);
  writeFileSync(join(extraFileFixture, "src", "unreviewed.rs"), "// unexpected\n");
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraFileFixture }).some((error) => error.includes("allowlist")));

  const exportFixture = useFixture(t);
  writeFileSync(join(exportFixture, "src", "lib.rs"), "\npub fn unreviewed() {}\n", { flag: "a" });
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: exportFixture }).some((error) => error.includes("outside")));

  const rawProviderExportFixture = useFixture(t);
  const rawProviderExportPath = join(rawProviderExportFixture, "src", "lib.rs");
  writeFileSync(
    rawProviderExportPath,
    readFileSync(rawProviderExportPath, "utf8").replace(
      /^pub use cloudflare_provider::\{/mu,
      "pub use cloudflare_provider::{\n    CloudflareProviderTransport,",
    ),
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: rawProviderExportFixture }).some(
    (error) => error.includes("public exports differ"),
  ));

  const missingStorageExportFixture = useLocalStorageFixture(t);
  const missingStorageExportPath = join(missingStorageExportFixture, "src/lib.rs");
  writeFileSync(
    missingStorageExportPath,
    // Drops one export whatever line rustfmt wraps it onto.
    readFileSync(missingStorageExportPath, "utf8").replace(/\bDesktopCloudflareObservationRead,\s*/u, ""),
  );
  assert.ok(localStorageFinalSurfaceErrors({ storageRoot: missingStorageExportFixture }).some(
    (error) => error.includes("public exports differ"),
  ));
});

test("rejects recreated database-key capability source or export", (t) => {
  const extraFileFixture = useFixture(t);
  writeFileSync(join(extraFileFixture, "src", "local_database_key.rs"), "// forbidden\n");
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraFileFixture }).some(
    (error) => error.includes("allowlist"),
  ));

  const extraExportFixture = useFixture(t);
  writeFileSync(
    join(extraExportFixture, "src", "lib.rs"),
    "\npub use cloudflare_provider::LocalDatabaseKeyMaterial;\n",
    { flag: "a" },
  );
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: extraExportFixture }).some(
    (error) => error.includes("outside")
      || error.includes("public exports differ")
      || error.includes("export blocks"),
  ));

  const rawStorageExportFixture = useLocalStorageFixture(t);
  const rawStorageExportPath = join(rawStorageExportFixture, "src/lib.rs");
  writeFileSync(
    rawStorageExportPath,
    `${readFileSync(rawStorageExportPath, "utf8")}\npub use active_workspace::business::BusinessDatabase;\n`,
  );
  assert.ok(localStorageFinalSurfaceErrors({ storageRoot: rawStorageExportFixture }).some(
    (error) => error.includes("export blocks"),
  ));

  const publicBackupModuleFixture = useLocalStorageFixture(t);
  const publicBackupModulePath = join(publicBackupModuleFixture, "src/lib.rs");
  writeFileSync(
    publicBackupModulePath,
    `${readFileSync(publicBackupModulePath, "utf8")}\npub mod public_backup_capability;\n`,
  );
  assert.ok(localStorageFinalSurfaceErrors({ storageRoot: publicBackupModuleFixture }).some(
    (error) => error.includes("outside"),
  ));
});

test("the Linux Secret Service adapter stays identical in both Host crates", () => {
  // ADR-0025: each trust domain keeps a private copy instead of a shared secret API, so the two
  // copies must not drift apart in their fail-closed rules.
  const root = resolve(import.meta.dirname, "..");
  const core = readFileSync(join(root, "crates/secure-host-core/src/secret_service_custody.rs"), "utf8");
  const storage = readFileSync(join(root, "crates/local-storage/src/secret_service_custody.rs"), "utf8");
  assert.equal(core, storage);
  assert.match(core, /EncryptionType::Dh/u);
  assert.doesNotMatch(core, /EncryptionType::Plain/u);
});


test("rejects unreviewed power methods, async methods and OS-handle fields", (t) => {
  for (const addition of [
    "impl NativePowerGate { pub fn unexpected_callback() {} }",
    "impl NativePowerGate { pub async fn unexpected_async_callback() {} }",
    "pub struct ForeignHandle { pub os_handle: usize }",
  ]) {
    const fixture = useFixture(t);
    writeFileSync(join(fixture, "src/native_power.rs"), `\n${addition}\n`, { flag: "a" });
    assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: fixture })
      .some((error) => error.includes("native power public")));
  }
  const fixture = useFixture(t);
  const path = join(fixture, "src/native_power.rs");
  writeFileSync(path, readFileSync(path, "utf8").replace("pub epoch: u64,", "pub epoch: u64,\n    pub os_handle: usize,"));
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: fixture })
    .some((error) => error.includes("native power public fields")));
  const rootFixture = useFixture(t);
  writeFileSync(join(rootFixture, "src/lib.rs"), "\npub async fn unexpected() {}\n", { flag: "a" });
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: rootFixture })
    .some((error) => error.includes("outside")));
});


test("rejects generic clock selectors and exposed clock state", (t) => {
  for (const addition of [
    "impl NativeContinuousClockSample { pub fn query_clock(_clock_id: u64) {} }",
    "impl NativeContinuousClockSample { pub async fn query_clock_async() {} }",
    "struct CallerSuppliedClock { pub os_clock_id: u64 }",
  ]) {
    const fixture = useFixture(t);
    writeFileSync(join(fixture, "src/native_continuous_clock.rs"), `\n${addition}\n`, { flag: "a" });
    assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: fixture })
      .some((error) => error.includes("native continuous clock")));
  }
});

test("rejects execution context setters, public samples and caller-selected trusted inputs", (t) => {
  for (const addition of [
    "impl DesktopLocalHost { pub fn set_execution_clock() {} }",
    "impl DesktopLocalHost { pub async fn install_authorization_anchor() {} }",
    "struct ClockOverride { pub ticks: u64 }",
  ]) {
    const fixture = useLocalStorageFixture(t);
    writeFileSync(join(fixture, "src/desktop_local_host/execution_context.rs"), `\n${addition}\n`, { flag: "a" });
    assert.ok(localStorageFinalSurfaceErrors({ storageRoot: fixture }).some((error) => error.includes("execution context public")));
  }
  const fixture = useLocalStorageFixture(t);
  const path = join(fixture, "src/desktop_local_host/execution_context.rs");
  writeFileSync(path, readFileSync(path, "utf8").replace("fn capture_clock(&self)", "fn capture_clock(&self, caller_ticks: u64)"));
  assert.ok(localStorageFinalSurfaceErrors({ storageRoot: fixture }).some((error) => error.includes("Native port")));
});

test("rejects an arbitrary device evidence signer outside the fixed purposes", (t) => {
  const fixture = useFixture(t);
  writeFileSync(join(fixture, "src/desktop_device_identity/execution_evidence.rs"),
    "\nimpl DesktopDeviceIdentity { pub fn sign_arbitrary_bytes(&self, bytes: &[u8]) {} }\n", { flag: "a" });
  assert.ok(secureHostCoreFinalSurfaceErrors({ coreRoot: fixture }).some((error) => error.includes("device execution evidence")));
});
