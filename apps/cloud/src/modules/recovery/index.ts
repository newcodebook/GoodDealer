import type { TenantTransaction } from "../../db/index";

export const recoveryModule = "persistence-foundation" as const;

/** Checkpoint/compaction sees only the oldest unresolved baseline watermark. */
export interface RestoreCandidateWatermarkQueryPort {
  readOldestUnresolvedComparisonRevision(transaction: TenantTransaction): Promise<number | null>;
}

export {
  DenyingRecoveryWorkflowAuthority,
  createRestoreCandidateService,
  type RecoveryTenantTransactionPort,
  type RestoreCandidateService,
  type RecoveryWorkflowAuthority,
  type RecoveryWorkflowAuthorityPort,
} from "./restore-candidate-service";
export { PostgresRestoreCandidateRepository } from "./postgres-restore-candidate-repository";
