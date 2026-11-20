import { executionSellerHubCreateListingEvidenceMigration } from "../modules/execution-ledger/migrations/202611200006-execution-sellerhub-create-listing-evidence";
import { auditSellerHubCreateListingEvidenceMigration } from "../modules/audit/migrations/202611200005-audit-sellerhub-create-listing-evidence";
import { auditAtomStandardDelistEvidenceMigration } from "../modules/audit/migrations/202611200003-audit-atom-standard-delist-evidence";
import { executionAtomStandardDelistEvidenceMigration } from "../modules/execution-ledger/migrations/202611200004-execution-atom-standard-delist-evidence";
import { auditSellerHubBinPriceEvidenceMigration } from "../modules/audit/migrations/202611200001-audit-sellerhub-bin-price-evidence";
import { executionSellerHubBinPriceEvidenceMigration } from "../modules/execution-ledger/migrations/202611200002-execution-sellerhub-bin-price-evidence";
import { auditListingPlanEvidenceMigration } from "../modules/audit/migrations/202611190032-audit-listing-plan-evidence";
import { executionListingPlanEvidenceMigration } from "../modules/execution-ledger/migrations/202611190033-execution-listing-plan-evidence";
import { forcedIntentCapabilityPolicyMigration } from "../modules/devices/migrations/202611190029-forced-intent-capability-policy";
import { forcedIntentCancellationMigration } from "../modules/devices/migrations/202611190028-forced-intent-cancellation";
import { desktopForcedReauthenticationMigration } from "../modules/identity/migrations/202611190025-desktop-forced-reauth";
import { leaseIssuedOfflineHighWaterMigration } from "../modules/devices/migrations/202611190026-lease-issued-offline-high-water";
import { forcedTakeoverWorkflowMigration } from "../modules/devices/migrations/202611190027-forced-takeover-workflow";
import { auditListingWriteEvidenceMigration } from "../modules/audit/migrations/202611190030-audit-listing-write-evidence";
import { executionListingWriteEvidenceMigration } from "../modules/execution-ledger/migrations/202611190031-execution-listing-write-evidence";
import { bootstrapCheckpointPolicyMigration } from "../modules/workspace/checkpoints/migrations/202611190024-bootstrap-checkpoint-policy";
import { bootstrapCheckpointCapabilityMigration } from "../modules/workspace/checkpoints/migrations/202611190023-bootstrap-checkpoint-capability";
import { targetBootstrapInstallationMigration } from "../modules/devices/migrations/202611190022-target-bootstrap-installation";
import { mutationDrainLoginAllocationMigration } from "../modules/workspace/mutations/migrations/202611190021-mutation-drain-login-allocation";
import { switchSourceEpochPurposeMigration } from "../modules/devices/migrations/202611190020-switch-source-epoch-purpose";
import { switchRequestSourceEpochMigration } from "../modules/devices/migrations/202611190019-switch-request-source-epoch";
import { auditEvidenceSealRollbackMigration } from "../modules/audit/migrations/202611190018-audit-evidence-seal-rollback";
import { factEvidenceReplayAndSealMigration } from "../modules/execution-ledger/migrations/202611190017-fact-evidence-replay-and-seal";
import { factEvidencePayloadProjectionMigration } from "../modules/execution-ledger/migrations/202611190016-fact-evidence-payload-projection";
import { auditEvidencePayloadProjectionMigration } from "../modules/audit/migrations/202611190015-audit-evidence-payload-projection";
import { factEvidenceClosedShapeMigration } from "../modules/execution-ledger/migrations/202611190014-fact-evidence-closed-shape";
import { auditEvidenceClosedShapeMigration } from "../modules/audit/migrations/202611190013-audit-evidence-closed-shape";
import { factEvidenceEventIdentityMigration } from "../modules/execution-ledger/migrations/202611190012-fact-evidence-event-identity";
import { auditEvidenceEventIdentityMigration } from "../modules/audit/migrations/202611190011-audit-evidence-event-identity";
import { auditExecutionEvidenceMigration } from "../modules/audit/migrations/202611190009-audit-execution-evidence";
import { executionFactEvidenceMigration } from "../modules/execution-ledger/migrations/202611190010-execution-fact-evidence";
import { executionContextKeyReadPolicyMigration } from "../modules/devices/migrations/202611190008-execution-context-key-read-policy";
import { executionContextKeyEvidenceMigration } from "../modules/devices/migrations/202611190007-execution-context-key-evidence";
import { securityEpochEndBoundariesMigration } from "../modules/identity/migrations/202611190006-security-epoch-end-boundaries";
import { executionContextDeviceColumnMigration } from "../modules/identity/migrations/202611190005-execution-context-device-column";
import { executionContextDeviceMigration } from "../modules/identity/migrations/202611190003-execution-context-device";
import { executionContextEnvelopeBindingMigration } from "../modules/devices/migrations/202611190004-execution-context-envelope-binding";
import { executionContextCapabilityMigration } from "../modules/devices/migrations/202611190002-execution-context-capability";
import { executionContextMigration } from "../modules/devices/migrations/202611190001-execution-context";
import { workspaceRevisionsMigration } from "../modules/workspace/revisions/migrations/202608200001-workspace-revisions";
import { businessReplicaModelMigration } from "../modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";
import { identityAuthenticationMigration } from "../modules/identity/migrations/202608200003-identity-authentication";
import { deviceControlMigration } from "../modules/devices/migrations/202608200004-device-control";
import { deviceCursorsMigration } from "../modules/workspace/cursors/migrations/202608200005-device-cursors";
import { mutationDrainLedgerMigration } from "../modules/workspace/mutations/migrations/202608200006-mutation-drain-ledger";
import { executionFactDrainLedgerMigration } from "../modules/execution-ledger/migrations/202608200007-execution-fact-drain-ledger";
import { workspaceDeviceAuditDrainLedgerMigration } from "../modules/audit/migrations/202608200008-workspace-device-audit-drain-ledger";
import { workspaceMutationLogMigration } from "../modules/workspace/mutations/migrations/202608200009-workspace-mutation-log";
import { workspaceCheckpointsMigration } from "../modules/workspace/checkpoints/migrations/202608200010-workspace-checkpoints";
import { workspaceCheckpointV2Migration } from "../modules/workspace/checkpoints/migrations/202609150001-workspace-checkpoint-v2";
import { cloudflareDnsObservationMigration } from "../modules/workspace/sync/migrations/202609150002-cloudflare-dns-observation";
import { restoreCandidateFoundationMigration } from "../modules/recovery/migrations/202608200011-restore-candidate-foundation";
import { jobRuntimeMigration } from "../modules/job-runtime/migrations/202608200012-job-runtime";
import { serverAuditSubstrateMigration } from "../modules/audit/migrations/202608200013-server-audit-substrate";
import { accountDefaultWorkspaceMigration } from "../modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";
import { accountDefaultWorkspaceCapabilityPolicyMigration } from "../modules/workspace/default-workspace/migrations/202609220002-account-default-workspace-capability-policy";
import { commercialEntitlementsMigration } from "../modules/licensing/migrations/202608200015-commercial-entitlements";
import { commercialEntitlementSnapshotMigration } from "../modules/licensing/migrations/202609220001-commercial-entitlement-snapshot";
import { desktopRefreshIdempotencyMigration } from "../modules/identity/migrations/202608200016-desktop-refresh-idempotency";
import { desktopLoginAuthorityMigration } from "../modules/devices/migrations/202608200017-desktop-login-authority";
import { identityTransactionCapabilityMigration } from "../modules/identity/migrations/202608200019-transaction-capability";
import { accountAccessMigration } from "../modules/identity/migrations/202609040001-account-access";
import { accountRecoveryMigration } from "../modules/identity/migrations/202609210001-account-recovery";
import { syncV2LedgerMigration } from "../modules/workspace/mutations/migrations/202609140001-sync-v2-ledger";
import { desktopLoginLoopbackRedirectMigration } from "../modules/devices/migrations/202611020001-desktop-login-loopback-redirect";
import { desktopCodeLoopbackRedirectMigration } from "../modules/identity/migrations/202611020002-desktop-code-loopback-redirect";
import { drainProofSchemaVersionMigration } from "../modules/devices/migrations/202611130001-drain-proof-schema-version";
import { drainHandoffTargetKeyMigration } from "../modules/devices/migrations/202611170001-drain-handoff-target-key";
import { drainProofAdmissionMigration } from "../modules/devices/migrations/202611170002-drain-proof-admission";
import { deviceSelfReportMigration } from "../modules/devices/migrations/202611180001-device-self-report";
import { loginLeaseAllocationGuardMigration } from "../modules/devices/migrations/202611180002-login-lease-allocation-guard";
import { mutationDrainResultChainMigration } from "../modules/workspace/mutations/migrations/202611130002-mutation-drain-result-chain";
import { mutationResultLedgerMigration } from "../modules/workspace/mutations/migrations/202611130003-mutation-result-ledger";
import { mutationDrainDeviceChainMigration } from "../modules/workspace/mutations/migrations/202611130004-mutation-drain-device-chain";
import { mutationWireV3Migration } from "../modules/workspace/mutations/migrations/202611130005-mutation-wire-v3";
import { replicaDomainAssetDeletionMigration } from "../modules/workspace/state/portfolio/migrations/202611140001-replica-domain-asset-deletion";
import { replicaEntityGenerationMigration } from "../modules/workspace/state/portfolio/migrations/202611140002-replica-entity-generation";
import { mutationGenerationMismatchReceiptMigration } from "../modules/workspace/mutations/migrations/202611140003-mutation-generation-mismatch-receipt";
import { workspaceCheckpointStateV3Migration } from "../modules/workspace/checkpoints/migrations/202611140004-workspace-checkpoint-state-v3";
import { mutationLogGenerationMigration } from "../modules/workspace/mutations/migrations/202611140005-mutation-log-generation";
import { replicaDomainAssetReAddMigration } from "../modules/workspace/state/portfolio/migrations/202611140006-replica-domain-asset-re-add";
import { buildMigrationCatalog, type CloudMigration } from "./index";

/** Explicit imports make cross-module ordering reviewable without moving table ownership into db. */
export const cloudMigrations: readonly CloudMigration[] = [
  workspaceRevisionsMigration,
  businessReplicaModelMigration,
  identityAuthenticationMigration,
  deviceControlMigration,
  deviceCursorsMigration,
  mutationDrainLedgerMigration,
  executionFactDrainLedgerMigration,
  workspaceDeviceAuditDrainLedgerMigration,
  workspaceMutationLogMigration,
  workspaceCheckpointsMigration,
  restoreCandidateFoundationMigration,
  jobRuntimeMigration,
  serverAuditSubstrateMigration,
  accountDefaultWorkspaceMigration,
  commercialEntitlementsMigration,
  desktopRefreshIdempotencyMigration,
  desktopLoginAuthorityMigration,
  identityTransactionCapabilityMigration,
  accountAccessMigration,
  syncV2LedgerMigration,
  workspaceCheckpointV2Migration,
  cloudflareDnsObservationMigration,
  accountRecoveryMigration,
  commercialEntitlementSnapshotMigration,
  accountDefaultWorkspaceCapabilityPolicyMigration,
  desktopLoginLoopbackRedirectMigration,
  desktopCodeLoopbackRedirectMigration,
  drainProofSchemaVersionMigration,
  mutationDrainResultChainMigration,
  mutationResultLedgerMigration,
  mutationDrainDeviceChainMigration,
  mutationWireV3Migration,
  replicaDomainAssetDeletionMigration,
  replicaEntityGenerationMigration,
  mutationGenerationMismatchReceiptMigration,
  workspaceCheckpointStateV3Migration,
  mutationLogGenerationMigration,
  replicaDomainAssetReAddMigration,
  drainHandoffTargetKeyMigration,
  drainProofAdmissionMigration,
  deviceSelfReportMigration,
  loginLeaseAllocationGuardMigration,
  executionContextMigration,
  executionContextCapabilityMigration,
  executionContextDeviceMigration,
  executionContextEnvelopeBindingMigration,
  executionContextDeviceColumnMigration,
  securityEpochEndBoundariesMigration,
  executionContextKeyEvidenceMigration,
  executionContextKeyReadPolicyMigration,
  auditExecutionEvidenceMigration,
  executionFactEvidenceMigration,
  auditEvidenceEventIdentityMigration,
  factEvidenceEventIdentityMigration,
  auditEvidenceClosedShapeMigration,
  factEvidenceClosedShapeMigration,
  auditEvidencePayloadProjectionMigration,
  factEvidencePayloadProjectionMigration,
  factEvidenceReplayAndSealMigration,
  auditEvidenceSealRollbackMigration,
  switchRequestSourceEpochMigration,
  switchSourceEpochPurposeMigration,
  mutationDrainLoginAllocationMigration,
  targetBootstrapInstallationMigration,
  bootstrapCheckpointCapabilityMigration,
  bootstrapCheckpointPolicyMigration,
  desktopForcedReauthenticationMigration,
  leaseIssuedOfflineHighWaterMigration,
  forcedTakeoverWorkflowMigration,
  forcedIntentCancellationMigration,
  forcedIntentCapabilityPolicyMigration,
  auditListingWriteEvidenceMigration,
  executionListingWriteEvidenceMigration,
  auditListingPlanEvidenceMigration,
  executionListingPlanEvidenceMigration,
  auditSellerHubBinPriceEvidenceMigration,
  executionSellerHubBinPriceEvidenceMigration,
  auditAtomStandardDelistEvidenceMigration,
  executionAtomStandardDelistEvidenceMigration,
  auditSellerHubCreateListingEvidenceMigration,
  executionSellerHubCreateListingEvidenceMigration,
];

// Validate ordering and checksums when the catalog is imported, before any database access.
export const checkedCloudMigrationCatalog = buildMigrationCatalog(cloudMigrations);
