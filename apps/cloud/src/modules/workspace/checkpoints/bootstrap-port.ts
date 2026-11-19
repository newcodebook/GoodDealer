import { createHash } from "node:crypto";
import { computeWorkspaceCheckpointEntityDigests, encodeCheckpointEntityDigestsInput,
  checkpointDescriptorSchema, WORKSPACE_SYNC_SCHEMA_VERSION, partitionWorkspaceCheckpointState } from "@gooddealer/protocol/workspace";
import { DEVICE_BOOTSTRAP_INSTALLATION_LIMITS, deviceBootstrapCheckpointPageSchema,
 encodeBootstrapCheckpointPageDigestInput, type DeviceBootstrapCheckpointRequest } from "@gooddealer/protocol/devices";
import type { CheckpointPortfolioSnapshotPort, CheckpointMutationRangePort, CheckpointRevisionPort } from "./postgres-ports";
import type { TenantTransaction } from "../../../db/index";
import type { BootstrapCheckpointPort } from "../../devices/bootstrap-persistence-ports";
import { PostgresCheckpointRepository } from "./postgres-repository";

/** Checkpoint-owned adapter used inside the devices-owned Bootstrap transaction. */
export class PostgresBootstrapCheckpointPort implements BootstrapCheckpointPort {
  constructor(private readonly repository = new PostgresCheckpointRepository(), private readonly owners?: {
    readonly revisions: CheckpointRevisionPort;
    readonly portfolio: CheckpointPortfolioSnapshotPort;
    readonly mutations: CheckpointMutationRangePort;
  }) {}

  /** Runs wholly inside the authenticated caller transaction, including persisted readback. */
  async ensureBootstrapCheckpointLocked(transaction: TenantTransaction, input: { readonly workflowId: string; readonly expiresAt: string }) {
    if (this.owners === undefined) throw new TypeError("checkpoint production owners are required");
    const head = await this.owners.revisions.lock(transaction);
    if (head === null) return null;
    let checkpoint = await this.repository.readLatestAvailable(transaction);
    if (checkpoint !== null && (checkpoint.descriptor.workspaceSchemaVersion !== head.workspaceSchemaVersion ||
      checkpoint.descriptor.throughServerRevision > head.serverRevision ||
      !await this.owners.mutations.hasCompleteRange(transaction, checkpoint.descriptor.throughServerRevision, head.serverRevision))) checkpoint = null;
    if (checkpoint === null) {
      const checkpointId = `bootstrap-${sha(Buffer.from(JSON.stringify([transaction.scope.accountId, transaction.scope.workspaceId,
        input.workflowId, head.serverRevision, head.workspaceSchemaVersion])))}`;
      const state = await this.owners.portfolio.captureCheckpointState(transaction);
      if (state.tombstones.some(row => row.deletedServerRevision > head.serverRevision)) throw new TypeError("checkpoint capture exceeds head");
      const manifest = await computeWorkspaceCheckpointEntityDigests(state, hash);
      const descriptor = checkpointDescriptorSchema.parse({schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
        checkpointId, workspaceId: transaction.scope.workspaceId, workspaceSchemaVersion: head.workspaceSchemaVersion,
        throughServerRevision: head.serverRevision, checkpointDigest: sha(encodeCheckpointEntityDigestsInput(manifest))});
      checkpoint = await this.repository.createBuilding(transaction, descriptor, state, manifest);
    }
    const state = await this.repository.readState(transaction, checkpoint.descriptor.checkpointId);
    const persisted = await this.repository.readEntityDigests(transaction, checkpoint.descriptor.checkpointId);
    const recomputed = await computeWorkspaceCheckpointEntityDigests(state, hash);
    if (JSON.stringify(persisted) !== JSON.stringify(recomputed) ||
      sha(encodeCheckpointEntityDigestsInput(recomputed)) !== checkpoint.descriptor.checkpointDigest)
      throw new TypeError("persisted bootstrap checkpoint verification failed");
    if (checkpoint.status === "building") checkpoint = await this.repository.markVerified(transaction, checkpoint);
    if (checkpoint.status === "verified") checkpoint = await this.repository.publish(transaction, checkpoint);
    if (checkpoint.status !== "available") throw new TypeError("bootstrap checkpoint is not available");
    await this.repository.pin(transaction, {checkpointId: checkpoint.descriptor.checkpointId,
      throughServerRevision: checkpoint.descriptor.throughServerRevision, checkpointDigest: checkpoint.descriptor.checkpointDigest,
      consumerKind: "bootstrap", consumerId: input.workflowId, expiresAt: input.expiresAt});
    return {checkpoint: checkpoint.descriptor, checkpointEntityDigests: persisted,
      targetServerRevision: head.serverRevision, workspaceSchemaVersion: head.workspaceSchemaVersion};
  }

  async readBootstrapPageLocked(transaction: TenantTransaction, request: DeviceBootstrapCheckpointRequest) {
    const checkpoint = await this.repository.read(transaction, request.checkpointId, true);
    if (checkpoint?.status !== "available" || checkpoint.descriptor.checkpointDigest !== request.checkpointDigest) return null;
    const manifest = await this.repository.readEntityDigests(transaction, request.checkpointId);
    if (!manifest.some(item => item.entityType === request.entityType && item.partitionId === request.partitionId)) return null;
    const partitions = partitionWorkspaceCheckpointState(await this.repository.readState(transaction, request.checkpointId));
    const partition = (request.entityType === "domain_asset" ? partitions.assets : partitions.tombstones).find(item => item.partitionId === request.partitionId);
    if (partition === undefined || request.offset > partition.rows.length || (partition.rows.length > 0 && request.offset === partition.rows.length)) return null;
    const rows = [];
    let bytes = 2;
    for (const row of partition.rows.slice(request.offset, request.offset + request.pageLimit)) {
      const size = Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
      if (bytes + size > DEVICE_BOOTSTRAP_INSTALLATION_LIMITS.pageDataBytes) break;
      rows.push(row); bytes += size;
    }
    if (partition.rows.length > 0 && rows.length === 0) throw new TypeError("checkpoint row exceeds page budget");
    const end = request.offset + rows.length;
    const draft = {requestId: request.requestId, checkpointId: request.checkpointId, checkpointDigest: request.checkpointDigest,
      entityType: request.entityType, partitionId: request.partitionId, offset: request.offset, totalRows: partition.rows.length,
      nextOffset: end < partition.rows.length ? end : null, rows, pageDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"};
    return deviceBootstrapCheckpointPageSchema.parse({...draft, pageDigest: sha(encodeBootstrapCheckpointPageDigestInput(draft))});
  }

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

async function hash(bytes: Uint8Array): Promise<Uint8Array> { return createHash("sha256").update(bytes).digest(); }
function sha(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("base64url"); }
