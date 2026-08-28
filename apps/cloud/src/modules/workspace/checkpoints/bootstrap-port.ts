import type { TenantTransaction } from "../../../db/index";
import type { BootstrapCheckpointPort } from "../../devices/bootstrap-persistence-ports";
import { PostgresCheckpointRepository } from "./postgres-repository";

/** Checkpoint-owned adapter used inside the devices-owned Bootstrap transaction. */
export class PostgresBootstrapCheckpointPort implements BootstrapCheckpointPort {
  constructor(private readonly repository = new PostgresCheckpointRepository()) {}

  async lockAvailableAndPin(
    transaction: TenantTransaction,
    input: Parameters<BootstrapCheckpointPort["lockAvailableAndPin"]>[1],
  ) {
    const checkpoint = await this.repository.read(transaction, input.descriptor.checkpointId, true);
    if (checkpoint === null || checkpoint.status !== "available" ||
      !sameDescriptor(checkpoint.descriptor, input.descriptor)) return null;
    await this.repository.pin(transaction, {
      checkpointId: checkpoint.descriptor.checkpointId,
      throughServerRevision: checkpoint.descriptor.throughServerRevision,
      checkpointDigest: checkpoint.descriptor.checkpointDigest,
      consumerKind: "bootstrap",
      consumerId: input.workflowId,
      expiresAt: input.expiresAt,
    });
    return checkpoint.descriptor;
  }

  async release(transaction: TenantTransaction, workflowId: string): Promise<void> {
    await this.repository.releasePin(transaction, "bootstrap", workflowId);
  }
}

function sameDescriptor(left: object, right: object): boolean {
  const leftValue = left as Record<string, unknown>;
  const rightValue = right as Record<string, unknown>;
  return leftValue.schemaVersion === rightValue.schemaVersion &&
    leftValue.checkpointId === rightValue.checkpointId &&
    leftValue.workspaceId === rightValue.workspaceId &&
    leftValue.workspaceSchemaVersion === rightValue.workspaceSchemaVersion &&
    leftValue.throughServerRevision === rightValue.throughServerRevision &&
    leftValue.checkpointDigest === rightValue.checkpointDigest;
}
