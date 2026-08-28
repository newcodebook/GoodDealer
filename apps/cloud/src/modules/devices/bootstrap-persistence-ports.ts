import type {
  CheckpointDescriptor,
  MutationPage,
  WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";

import type { TenantTransaction } from "../../db/index";

/** Lock order prefix owned by identity; devices can observe but never update it. */
export interface BootstrapAccountSecurityPort {
  lockCurrent(transaction: TenantTransaction): Promise<{
    readonly accountSecurityEpoch: number;
    readonly status: "normal" | "recovery_pending";
  } | null>;
}

/** Workspace revision authority. It receives the already-open tenant transaction. */
export interface BootstrapRevisionPort {
  lock(transaction: TenantTransaction): Promise<{
    readonly serverRevision: number;
    readonly workspaceSchemaVersion: number;
  } | null>;
}

/** Checkpoint owner is the only participant allowed to create or release pins. */
export interface BootstrapCheckpointPort {
  lockAvailableAndPin(
    transaction: TenantTransaction,
    input: {
      readonly workflowId: string;
      readonly descriptor: CheckpointDescriptor;
      readonly expiresAt: string;
    },
  ): Promise<CheckpointDescriptor | null>;
  release(transaction: TenantTransaction, workflowId: string, checkpointId: string): Promise<void>;
}

/** Mutation owner returns a strict dense page from its immutable revision ledger. */
export interface BootstrapMutationPagePort {
  readDensePage(transaction: TenantTransaction, input: {
    readonly fromServerRevisionExclusive: number;
    readonly throughServerRevisionInclusive: number;
    readonly cursor: string | null;
    readonly pageLimit: number;
  }): Promise<MutationPage>;
}

/** Portfolio owner derives the authoritative final projection digest at the frozen target. */
export interface BootstrapProjectionDigestPort {
  readEntityDigestsAt(transaction: TenantTransaction, input: {
    readonly checkpointId: string;
    readonly throughServerRevisionInclusive: number;
    readonly workspaceSchemaVersion: number;
  }): Promise<readonly WorkspaceEntityDigest[]>;
}

export interface BootstrapDeviceCursorPort {
  lockDomain(transaction: TenantTransaction): Promise<void>;
  retireCurrent(transaction: TenantTransaction, reason: "replaced"): Promise<void>;
  insertNextGeneration(transaction: TenantTransaction, deviceId: string, atRevision: number): Promise<number>;
}

/** Production entitlement persistence is intentionally unavailable in this Phase 0 slice. */
export interface ActiveEntitlementDeadlinePort {
  lockCurrent(transaction: TenantTransaction): Promise<{
    readonly active: true;
    readonly securityDeadline: string;
    readonly entitlementDeadline: string;
  } | null>;
}

export class DenyingActiveEntitlementDeadlinePort implements ActiveEntitlementDeadlinePort {
  async lockCurrent(): Promise<null> {
    return null;
  }
}
