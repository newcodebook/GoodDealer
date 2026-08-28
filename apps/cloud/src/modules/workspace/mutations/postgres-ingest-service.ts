import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  submittedSyncMutationSchema,
  type SubmittedSyncMutation,
} from "@gooddealer/protocol/workspace";
import { identifier, safePositiveInteger } from "@gooddealer/protocol/wire";

import { TenantTransactionRunner } from "../../../db/index";
import type { TransactionalMutationAuthorityPort } from "../../devices/ports";
import type {
  MutationIngestFailure,
  MutationIngestRejectionCode,
  MutationIngestRequest,
  MutationIngestResult,
} from "./index";
import type { WorkspaceRevisionMutationPort } from "../revisions/index";
import type {
  LockedDomainAsset,
  PortfolioSyncPersistencePort,
} from "../state/portfolio/index";
import { parseWorkspaceTenantScope } from "../tenant-scope";
import {
  PostgresWorkspaceMutationRepository,
  type MutationPersistenceFaultPoint,
} from "./postgres-repository";

const MAX_MUTATIONS_PER_INGEST = 256;
const MAX_TRANSACTION_ATTEMPTS = 3;

export type PostgresMutationCommitFaultPoint = MutationPersistenceFaultPoint
  | "after_materialization"
  | "before_revision_commit";

/** Production-shaped persistence orchestration. No route, job, or production composition owns it. */
export class PostgresWorkspaceMutationIngest {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly authority: TransactionalMutationAuthorityPort;
    readonly revisions: WorkspaceRevisionMutationPort;
    readonly portfolio: PortfolioSyncPersistencePort;
    readonly mutations: PostgresWorkspaceMutationRepository;
    readonly fault?: (point: PostgresMutationCommitFaultPoint) => void;
  }) {}

  async ingest(scope: unknown, value: unknown): Promise<MutationIngestResult> {
    const request = parseRequest(value);
    if (request === null) return reject("MUTATION_MALFORMED");
    const parsedScope = parseWorkspaceTenantScope(scope);
    if (parsedScope === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
    if (request.workspaceId !== parsedScope.workspaceId) return reject("MUTATION_WORKSPACE_MISMATCH");
    const orderFailures = request.mutations.flatMap((mutation, index) =>
      index === 0 || request.mutations[index - 1]!.deviceMutationSequence < mutation.deviceMutationSequence
        ? [] : [failure(index, mutation)]);
    if (orderFailures.length > 0) return reject("MUTATION_BATCH_UNORDERED", orderFailures);

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.dependencies.transactions.withTenant(parsedScope, (transaction) =>
          this.#ingestTransaction(transaction, request));
      } catch (error) {
        if (error instanceof IngestRejected) return error.result;
        if (!isRetryableTransactionError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      }
    }
    throw new TypeError("mutation transaction retry bound is unreachable");
  }

  async #ingestTransaction(
    transaction: Parameters<Parameters<TenantTransactionRunner["withTenant"]>[1]>[0],
    request: MutationIngestRequest,
  ): Promise<MutationIngestResult> {
    await transaction.query("SET LOCAL lock_timeout = '5s'");
    await transaction.query("SET LOCAL statement_timeout = '20s'");
    if (request.workspaceId !== transaction.scope.workspaceId) {
      throw new IngestRejected(reject("MUTATION_WORKSPACE_MISMATCH"));
    }
    const authority = await this.dependencies.authority.lockAndValidateActiveLease(transaction, {
      sourceDeviceId: request.sourceDeviceId,
      activeLeaseEpoch: request.activeLeaseEpoch,
    });
    if (!authority) throw new IngestRejected(reject("MUTATION_DEVICE_NOT_ACTIVE", allFailures(request)));

    let drain;
    try {
      drain = await this.dependencies.mutations.lockDrainDomain(transaction, {
        sourceDeviceId: request.sourceDeviceId,
        activeLeaseEpoch: request.activeLeaseEpoch,
      });
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("sealed")) {
        throw new IngestRejected(reject("MUTATION_DRAIN_SEALED", allFailures(request)));
      }
      throw error;
    }

    const revision = await this.dependencies.revisions.lock(transaction);
    if (revision === null) throw new IngestRejected(reject("WORKSPACE_TENANT_UNRESOLVED"));
    const schemaFailures = request.mutations.flatMap((mutation, index) =>
      mutation.workspaceSchemaVersion === revision.workspaceSchemaVersion ? [] : [failure(index, mutation)]);
    if (schemaFailures.length > 0) {
      throw new IngestRejected(reject("MUTATION_SCHEMA_VERSION_UNSUPPORTED", schemaFailures));
    }

    const assets = await this.dependencies.portfolio.lockDomainAssets(
      transaction,
      request.mutations.map(({ entityId }) => entityId),
    );
    const assetsById = new Map(assets.map((asset) => [asset.entityId, asset]));

    const duplicateRevisionByIndex = new Map<number, number>();
    for (const [index, mutation] of request.mutations.entries()) {
      const resolution = await this.dependencies.mutations.resolveReceipt(transaction, drain, mutation);
      if (resolution.status === "exact") duplicateRevisionByIndex.set(index, resolution.receipt.serverRevision);
      if (resolution.status === "mutation_id_conflict") {
        throw new IngestRejected(reject("MUTATION_ID_CONFLICT", [failure(index, mutation)]));
      }
      if (resolution.status === "sequence_conflict") {
        throw new IngestRejected(reject("MUTATION_SEQUENCE_CONFLICT", [failure(index, mutation)]));
      }
    }

    const entityFailures = request.mutations.flatMap((mutation, index) =>
      duplicateRevisionByIndex.has(index) || assetsById.has(mutation.entityId) ? [] : [failure(index, mutation)]);
    if (entityFailures.length > 0) throw new IngestRejected(reject("MUTATION_ENTITY_UNKNOWN", entityFailures));

    const baseFailures = request.mutations.flatMap((mutation, index) =>
      duplicateRevisionByIndex.has(index) || mutation.baseServerRevision <= revision.serverRevision
        ? [] : [{ ...failure(index, mutation), headRevision: revision.serverRevision }]);
    if (baseFailures.length > 0) {
      throw new IngestRejected(reject("MUTATION_BASE_REVISION_AHEAD", baseFailures));
    }

    const assignedRevisionByIndex = new Map<number, number>();
    let proposedHead = revision.serverRevision;
    for (const index of request.mutations.keys()) {
      if (duplicateRevisionByIndex.has(index)) continue;
      proposedHead += 1;
      if (!Number.isSafeInteger(proposedHead)) throw new TypeError("workspace revision overflow");
      assignedRevisionByIndex.set(index, proposedHead);
    }
    const staleFailures = findStaleFields(
      request.mutations,
      duplicateRevisionByIndex,
      assignedRevisionByIndex,
      assetsById,
      revision.serverRevision,
    );
    if (staleFailures.length > 0) throw new IngestRejected(reject("MUTATION_FIELD_STALE", staleFailures));

    const accepted = request.mutations.flatMap((mutation, index) => {
      const serverRevision = assignedRevisionByIndex.get(index);
      return serverRevision === undefined ? [] : [{ mutation, serverRevision }];
    });
    if (accepted.length > 0) {
      await this.dependencies.mutations.appendAccepted(
        transaction,
        drain,
        accepted,
        this.dependencies.fault,
      );
      await this.dependencies.portfolio.applyAcceptedMutations(transaction, accepted);
      this.dependencies.fault?.("after_materialization");
      this.dependencies.fault?.("before_revision_commit");
      await this.dependencies.revisions.compareAndAdvance(transaction, revision.serverRevision, proposedHead);
    }

    return {
      accepted: true,
      assignments: request.mutations.map((mutation, index) => ({
        mutationId: mutation.mutationId,
        deviceMutationSequence: mutation.deviceMutationSequence,
        serverRevision: duplicateRevisionByIndex.get(index) ?? assignedRevisionByIndex.get(index)!,
        duplicate: duplicateRevisionByIndex.has(index),
      })),
      headRevision: proposedHead,
    };
  }
}

function parseRequest(value: unknown): MutationIngestRequest | null {
  if (!isSafeWireValue(value)) return null;
  const record = exactRecord(value, [
    "activeLeaseEpoch",
    "mutations",
    "schemaVersion",
    "sourceDeviceId",
    "workspaceId",
  ]);
  if (record === null ||
    record.schemaVersion !== WORKSPACE_SYNC_SCHEMA_VERSION ||
    !identifier.safeParse(record.workspaceId).success ||
    !identifier.safeParse(record.sourceDeviceId).success ||
    !safePositiveInteger.safeParse(record.activeLeaseEpoch).success ||
    !Array.isArray(record.mutations) || record.mutations.length < 1 || record.mutations.length > MAX_MUTATIONS_PER_INGEST) {
    return null;
  }
  const mutations: SubmittedSyncMutation[] = [];
  for (const candidate of record.mutations) {
    const parsed = submittedSyncMutationSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.operationKind === "delete" ||
      parsed.data.workspaceId !== record.workspaceId ||
      parsed.data.sourceDeviceId !== record.sourceDeviceId ||
      parsed.data.activeLeaseEpoch !== record.activeLeaseEpoch) return null;
    mutations.push(parsed.data);
  }
  return {
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    workspaceId: record.workspaceId as string,
    sourceDeviceId: record.sourceDeviceId as string,
    activeLeaseEpoch: record.activeLeaseEpoch as number,
    mutations,
  };
}

function findStaleFields(
  mutations: readonly SubmittedSyncMutation[],
  duplicates: ReadonlyMap<number, number>,
  assignments: ReadonlyMap<number, number>,
  assets: ReadonlyMap<string, LockedDomainAsset>,
  headRevision: number,
): readonly MutationIngestFailure[] {
  const simulated = new Map<string, number>();
  const failures: MutationIngestFailure[] = [];
  for (const [index, mutation] of mutations.entries()) {
    if (duplicates.has(index)) continue;
    const asset = assets.get(mutation.entityId);
    if (asset === undefined) continue;
    for (const field of mutation.changedFields) {
      const key = `${mutation.entityId}\u0000${field.fieldPath}`;
      const lastModifiedRevision = simulated.get(key) ?? asset.lastModifiedRevision[field.fieldPath];
      if (lastModifiedRevision > mutation.baseServerRevision) {
        failures.push({ ...failure(index, mutation), fieldPath: field.fieldPath, lastModifiedRevision, headRevision });
      }
    }
    const assigned = assignments.get(index);
    if (assigned === undefined) throw new TypeError("accepted mutation revision disappeared");
    for (const field of mutation.changedFields) simulated.set(`${mutation.entityId}\u0000${field.fieldPath}`, assigned);
  }
  return failures;
}

function reject(
  code: MutationIngestRejectionCode,
  failures: readonly MutationIngestFailure[] = [],
): MutationIngestResult {
  return failures.length === 0 ? { accepted: false, code } : { accepted: false, code, failures };
}

function allFailures(request: MutationIngestRequest): readonly MutationIngestFailure[] {
  return request.mutations.map((mutation, index) => failure(index, mutation));
}

function failure(index: number, mutation: SubmittedSyncMutation): MutationIngestFailure {
  return { index, mutationId: mutation.mutationId };
}

class IngestRejected extends Error {
  constructor(readonly result: MutationIngestResult) {
    super("mutation ingest rejected");
  }
}

function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "40001" || error.code === "40P01";
}

function isSafeWireValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1) return false;
    return ownKeys.every((key) => {
      if (key === "length") return true;
      if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)) return false;
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor &&
        isSafeWireValue(descriptor.value, seen);
    });
  }
  if (!isPlainRecord(value)) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor &&
      isSafeWireValue(descriptor.value, seen);
  });
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> | null {
  if (!isPlainRecord(value)) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string") ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return null;
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) return null;
  }
  return value as Record<Keys[number], unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
