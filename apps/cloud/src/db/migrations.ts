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
import { mutationDrainResultChainMigration } from "../modules/workspace/mutations/migrations/202611130002-mutation-drain-result-chain";
import { mutationResultLedgerMigration } from "../modules/workspace/mutations/migrations/202611130003-mutation-result-ledger";
import { mutationDrainDeviceChainMigration } from "../modules/workspace/mutations/migrations/202611130004-mutation-drain-device-chain";
import { mutationWireV3Migration } from "../modules/workspace/mutations/migrations/202611130005-mutation-wire-v3";
import { replicaDomainAssetDeletionMigration } from "../modules/workspace/state/portfolio/migrations/202611140001-replica-domain-asset-deletion";
import { replicaEntityGenerationMigration } from "../modules/workspace/state/portfolio/migrations/202611140002-replica-entity-generation";
import { mutationGenerationMismatchReceiptMigration } from "../modules/workspace/mutations/migrations/202611140003-mutation-generation-mismatch-receipt";
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
];

// Validate ordering and checksums when the catalog is imported, before any database access.
export const checkedCloudMigrationCatalog = buildMigrationCatalog(cloudMigrations);
