import { createHash } from "node:crypto";
import {
  MAX_MUTATIONS_PER_PAGE,
  WORKSPACE_SYNC_SCHEMA_VERSION,
  encodeMutationPageDigestInput,
  encodeRebootstrapPlanDigestInput,
  rebootstrapPlanSchema,
  type CheckpointDescriptor,
  type RebootstrapPlan,
} from "@gooddealer/protocol/workspace";

import { TenantTransactionRunner } from "../../../db/index";
import type { WorkspaceTenantScope } from "../tenant-scope";
import { PostgresCheckpointRepository } from "./postgres-repository";
import { PostgresWorkspaceMutationRepository } from "../mutations/postgres-repository";
import { PostgresWorkspaceRevisionRepository } from "../revisions/postgres-repository";

export interface WorkspaceCheckpointReaderPort {
  readLatestAvailable(scope: WorkspaceTenantScope): Promise<CheckpointDescriptor | null>;
  readRebootstrapPlan?(scope: WorkspaceTenantScope): Promise<RebootstrapPlan | null>;
}

/** Checkpoint-owned, tenant-scoped read boundary for sync recovery hints. */
export class PostgresWorkspaceCheckpointReader implements WorkspaceCheckpointReaderPort {
  constructor(
    private readonly transactions: TenantTransactionRunner,
    private readonly checkpoints = new PostgresCheckpointRepository(),
    private readonly mutations = new PostgresWorkspaceMutationRepository(),
    private readonly revisions = new PostgresWorkspaceRevisionRepository(),
  ) {}

  async readLatestAvailable(scope: WorkspaceTenantScope): Promise<CheckpointDescriptor | null> {
    return this.transactions.withTenant(scope, async (transaction) =>
      (await this.checkpoints.readLatestAvailable(transaction))?.descriptor ?? null,
      { readOnly: true },
    );
  }

  async readRebootstrapPlan(scope: WorkspaceTenantScope): Promise<RebootstrapPlan | null> {
    return this.transactions.withTenant(scope, async (transaction) => {
      const checkpoint = await this.checkpoints.readLatestAvailable(transaction);
      const head = await this.revisions.read(transaction);
      if (checkpoint === null || head === null) return null;
      const from = checkpoint.descriptor.throughServerRevision;
      const through = head.serverRevision;
      const snapshot = await this.checkpoints.readSnapshot(transaction, checkpoint.descriptor.checkpointId);
      const mutations = await this.mutations.readRange(transaction, from, through);
      if (mutations.length !== through - from) throw new TypeError("rebootstrap mutation range is incomplete");
      const pages = [];
      for (let offset = 0; offset < mutations.length; offset += MAX_MUTATIONS_PER_PAGE) {
        const pageMutations = mutations.slice(offset, offset + MAX_MUTATIONS_PER_PAGE);
        const pageFrom = from + offset;
        const returnedThrough = pageFrom + pageMutations.length;
        const draft = {
          schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
          workspaceId: scope.workspaceId,
          fromServerRevisionExclusive: pageFrom,
          throughServerRevisionInclusive: through,
          mutations: pageMutations,
          returnedThroughServerRevision: returnedThrough,
          nextCursor: returnedThrough === through ? null : `rebootstrap_${returnedThrough}`,
          pageDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        };
        pages.push({ ...draft, pageDigest: digest(encodeMutationPageDigestInput(draft)) });
      }
      const unsigned = {
        schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
        checkpoint: checkpoint.descriptor,
        snapshot,
        requiredMutationRange: { fromServerRevisionExclusive: from, throughServerRevisionInclusive: through },
        mutations: pages,
        pinnedHeadRevision: through,
        pinnedHeadDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      };
      return rebootstrapPlanSchema.parse({
        ...unsigned,
        pinnedHeadDigest: digest(encodeRebootstrapPlanDigestInput(unsigned)),
      });
    }, { readOnly: true, repeatableRead: true });
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}
