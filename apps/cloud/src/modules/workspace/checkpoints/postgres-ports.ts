import type {
  DomainAssetProjectionRow,
  SyncMutation,
} from "@gooddealer/protocol/workspace";

import type { TenantTransaction } from "../../../db/index";
import type { RestoreCandidateWatermarkQueryPort } from "../../recovery/index";
import type { WorkspaceRevisionSnapshot } from "../revisions/index";

/** Portfolio-owned, transaction-aware snapshot boundary. */
export interface CheckpointPortfolioSnapshotPort {
  captureSnapshot(transaction: TenantTransaction): Promise<readonly DomainAssetProjectionRow[]>;
}

/** Mutation-owned replay and prefix deletion boundary. */
export interface CheckpointMutationRangePort {
  readRange(
    transaction: TenantTransaction,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): Promise<readonly SyncMutation[]>;
  hasCompleteRange(
    transaction: TenantTransaction,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): Promise<boolean>;
  compactPrefix(transaction: TenantTransaction, throughServerRevisionInclusive: number): Promise<number>;
}

/** Revision-owner boundary; checkpoint code never queries workspace_revisions directly. */
export interface CheckpointRevisionPort {
  read(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null>;
  lock(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null>;
  compareAndAdvanceCompactionWatermark(
    transaction: TenantTransaction,
    expectedWatermark: number,
    nextWatermark: number,
  ): Promise<void>;
}

export interface CheckpointReaderCursorWatermarkPort {
  retireExpiredAndReadMinimumActiveRevision(transaction: TenantTransaction): Promise<number | null>;
}

export interface CheckpointDeviceCursorWatermarkPort {
  readMinimumActiveRevision(transaction: TenantTransaction): Promise<number | null>;
}

export type { RestoreCandidateWatermarkQueryPort };
