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
import { restoreCandidateFoundationMigration } from "../modules/recovery/migrations/202608200011-restore-candidate-foundation";
import { jobRuntimeMigration } from "../modules/job-runtime/migrations/202608200012-job-runtime";
import { serverAuditSubstrateMigration } from "../modules/audit/migrations/202608200013-server-audit-substrate";
import { accountDefaultWorkspaceMigration } from "../modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";
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
];

// Validate ordering and checksums when the catalog is imported, before any database access.
export const checkedCloudMigrationCatalog = buildMigrationCatalog(cloudMigrations);
