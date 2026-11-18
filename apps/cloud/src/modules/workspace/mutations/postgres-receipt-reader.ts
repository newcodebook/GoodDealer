import type { WorkspaceMutationReceipt } from "@gooddealer/protocol/workspace";

import { TenantTransactionRunner } from "../../../db/index";
import { parseWorkspaceTenantScope, type WorkspaceTenantScope } from "../tenant-scope";
import type { PostgresWorkspaceMutationRepository } from "./postgres-repository";

/** Reads one device's own mutation receipts in its tenant (ADR-0032 decision 4). */
export class PostgresWorkspaceMutationReceiptReader {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly repository: Pick<PostgresWorkspaceMutationRepository, "readOwnReceipts">;
  }) {}

  async readOwn(
    scope: WorkspaceTenantScope,
    sourceDeviceId: string,
    mutationIds: readonly string[],
  ): Promise<WorkspaceMutationReceipt[]> {
    const parsed = parseWorkspaceTenantScope(scope);
    if (parsed === null) throw new TypeError("workspace tenant scope is invalid");
    return this.dependencies.transactions.withTenant(parsed, (transaction) =>
      this.dependencies.repository.readOwnReceipts(transaction, sourceDeviceId, mutationIds));
  }
}
