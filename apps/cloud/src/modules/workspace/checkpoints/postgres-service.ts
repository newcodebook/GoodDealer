import { createHash } from "node:crypto";

import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  checkpointDescriptorSchema,
  compareUtf8,
  computeWorkspaceCheckpointEntityDigests,
  encodeCheckpointEntityDigestsInput,
  syncMutationSchema,
  serverRevisionSchema,
  workspaceCheckpointStateSchema,
  type SyncMutation,
  type WorkspaceCheckpointState,
} from "@gooddealer/protocol/workspace";

import { TenantTransactionRunner } from "../../../db/index";
import {
  PostgresCheckpointRepository,
  type CheckpointPinBinding,
  type PersistentCheckpoint,
} from "./postgres-repository";
import type {
  CheckpointDeviceCursorWatermarkPort,
  CheckpointMutationRangePort,
  CheckpointPortfolioSnapshotPort,
  CheckpointReaderCursorWatermarkPort,
  CheckpointRevisionPort,
  RestoreCandidateWatermarkQueryPort,
} from "./postgres-ports";

export type CheckpointPersistenceRejectionCode =
  | "WORKSPACE_TENANT_UNRESOLVED"
  | "CHECKPOINT_HEAD_MISMATCH"
  | "CHECKPOINT_NOT_AVAILABLE"
  | "CHECKPOINT_DIGEST_MISMATCH"
  | "CHECKPOINT_STORAGE_MALFORMED"
  | "CHECKPOINT_PINNED"
  | "CHECKPOINT_LAST_USABLE"
  | "COMPACTION_AUTHORITY_UNAVAILABLE"
  | "COMPACTION_WATERMARK_BLOCKED"
  | "COMPACTION_CHAIN_INCOMPLETE"
  | "REBUILD_CHAIN_INVALID"
  | "REBUILD_DIGEST_MISMATCH";

export type CheckpointPersistenceResult<Value> =
  | { readonly accepted: true; readonly value: Value }
  | { readonly accepted: false; readonly code: CheckpointPersistenceRejectionCode };

export interface CompactionProjection {
  readonly compactedThroughServerRevision: number;
  readonly deletedMutationCount: number;
}

export interface RebuildProjection {
  readonly throughServerRevision: number;
  readonly state: WorkspaceCheckpointState;
  /** The checkpoint digest of `state`, comparable with any checkpoint descriptor's digest. */
  readonly stateDigest: string;
}

/**
 * Uncomposed PostgreSQL checkpoint orchestration. Cross-capability effects occur only through
 * transaction-aware ports, so Recovery and Mutation ownership remains enforceable.
 */
export class PostgresCheckpointService {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly checkpoints: PostgresCheckpointRepository;
    readonly revisions: CheckpointRevisionPort;
    readonly portfolio: CheckpointPortfolioSnapshotPort;
    readonly mutations: CheckpointMutationRangePort;
    readonly deviceCursors: CheckpointDeviceCursorWatermarkPort;
    readonly readerCursors: CheckpointReaderCursorWatermarkPort;
    readonly recovery: RestoreCandidateWatermarkQueryPort | null;
  }) {}

  async build(
    scope: unknown,
    checkpointIdValue: unknown,
    throughServerRevisionValue: unknown,
  ): Promise<CheckpointPersistenceResult<PersistentCheckpoint>> {
    const checkpointId = parseIdentifier(checkpointIdValue, "checkpoint id");
    const throughServerRevision = serverRevisionSchema.parse(throughServerRevisionValue);
    return this.dependencies.transactions.withTenant(scope, async (transaction) => {
      const revision = await this.dependencies.revisions.lock(transaction);
      if (revision === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
      if (throughServerRevision !== revision.serverRevision) return reject("CHECKPOINT_HEAD_MISMATCH");
      const state = workspaceCheckpointStateSchema.parse(
        await this.dependencies.portfolio.captureCheckpointState(transaction),
      );
      // Captured under the revision lock at the head, so no tombstone can postdate the checkpoint.
      if (state.tombstones.some((tombstone) => tombstone.deletedServerRevision > throughServerRevision)) {
        throw new TypeError("checkpoint capture holds a deletion after its revision");
      }
      const entityDigests = await computeWorkspaceCheckpointEntityDigests(state, sha256);
      const checkpointDigest = digestBytes(encodeCheckpointEntityDigestsInput(entityDigests));
      const descriptor = checkpointDescriptorSchema.parse({
        schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
        checkpointId,
        workspaceId: transaction.scope.workspaceId,
        workspaceSchemaVersion: revision.workspaceSchemaVersion,
        throughServerRevision,
        checkpointDigest,
      });
      const checkpoint = await this.dependencies.checkpoints.createBuilding(
        transaction,
        descriptor,
        state,
        entityDigests,
      );
      return accept(checkpoint);
    });
  }

  async verify(
    scope: unknown,
    checkpointIdValue: unknown,
  ): Promise<CheckpointPersistenceResult<PersistentCheckpoint>> {
    const checkpointId = parseIdentifier(checkpointIdValue, "checkpoint id");
    return this.dependencies.transactions.withTenant(scope, async (transaction) => {
      const checkpoint = await this.dependencies.checkpoints.read(transaction, checkpointId, true);
      if (checkpoint === null || checkpoint.status !== "building") return reject("CHECKPOINT_NOT_AVAILABLE");
      try {
        const state = await this.dependencies.checkpoints.readState(transaction, checkpointId);
        const storedEntityDigests = await this.dependencies.checkpoints.readEntityDigests(transaction, checkpointId);
        const recomputedEntityDigests = await computeWorkspaceCheckpointEntityDigests(state, sha256);
        const recomputedCheckpointDigest = digestBytes(encodeCheckpointEntityDigestsInput(recomputedEntityDigests));
        if (
          !sameEntityDigests(storedEntityDigests, recomputedEntityDigests) ||
          recomputedCheckpointDigest !== checkpoint.descriptor.checkpointDigest
        ) {
          await this.dependencies.checkpoints.markInvalid(
            transaction,
            checkpoint,
            "checkpoint_digest_mismatch",
            recomputedCheckpointDigest,
          );
          return reject("CHECKPOINT_DIGEST_MISMATCH");
        }
        return accept(await this.dependencies.checkpoints.markVerified(transaction, checkpoint));
      } catch (error) {
        await this.dependencies.checkpoints.markInvalid(
          transaction,
          checkpoint,
          "checkpoint_storage_malformed",
          null,
        );
        void error;
        return reject("CHECKPOINT_STORAGE_MALFORMED");
      }
    });
  }

  async publish(
    scope: unknown,
    checkpointIdValue: unknown,
  ): Promise<CheckpointPersistenceResult<PersistentCheckpoint>> {
    const checkpointId = parseIdentifier(checkpointIdValue, "checkpoint id");
    return this.dependencies.transactions.withTenant(scope, async (transaction) => {
      const checkpoint = await this.dependencies.checkpoints.read(transaction, checkpointId, true);
      if (checkpoint === null || (checkpoint.status !== "verified" && checkpoint.status !== "available")) {
        return reject("CHECKPOINT_NOT_AVAILABLE");
      }
      return accept(await this.dependencies.checkpoints.publish(transaction, checkpoint));
    });
  }

  async pin(scope: unknown, bindingValue: unknown): Promise<void> {
    const binding = parsePinInput(bindingValue);
    await this.dependencies.transactions.withTenant(scope, async (transaction) => {
      await this.dependencies.checkpoints.pin(transaction, binding);
    });
  }

  async supersede(
    scope: unknown,
    checkpointIdValue: unknown,
  ): Promise<CheckpointPersistenceResult<null>> {
    const checkpointId = parseIdentifier(checkpointIdValue, "checkpoint id");
    return this.dependencies.transactions.withTenant(scope, async (transaction) => {
      const checkpoint = await this.dependencies.checkpoints.read(transaction, checkpointId);
      if (checkpoint === null || checkpoint.status !== "available") return reject("CHECKPOINT_NOT_AVAILABLE");
      const result = await this.dependencies.checkpoints.supersede(transaction, checkpoint);
      if (result === "pinned") return reject("CHECKPOINT_PINNED");
      if (result === "last-usable") return reject("CHECKPOINT_LAST_USABLE");
      if (result === "cas-lost") return reject("CHECKPOINT_NOT_AVAILABLE");
      return accept(null);
    });
  }

  async compact(
    scope: unknown,
    requestedThroughValue: unknown,
  ): Promise<CheckpointPersistenceResult<CompactionProjection>> {
    const requestedThrough = serverRevisionSchema.parse(requestedThroughValue);
    try {
      return await this.dependencies.transactions.withTenant(scope, async (transaction) => {
        const revision = await this.dependencies.revisions.lock(transaction);
        if (revision === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
        if (
          requestedThrough <= revision.compactedThroughServerRevision ||
          requestedThrough > revision.serverRevision
        ) return reject("COMPACTION_WATERMARK_BLOCKED");
        if (this.dependencies.recovery === null) return reject("COMPACTION_AUTHORITY_UNAVAILABLE");

        const deviceMinimum = await this.dependencies.deviceCursors.readMinimumActiveRevision(transaction);
        const readerMinimum = await this.dependencies.readerCursors
          .retireExpiredAndReadMinimumActiveRevision(transaction);
        const checkpointBounds = await this.dependencies.checkpoints.lockCompactionBounds(transaction);
        let recoveryMinimum: number | null;
        try {
          recoveryMinimum = await this.dependencies.recovery
            .readOldestUnresolvedComparisonRevision(transaction);
        } catch {
          throw new CompactionRejected("COMPACTION_AUTHORITY_UNAVAILABLE");
        }
        validateNullableRevision(recoveryMinimum, "recovery comparison revision");
        const safeThrough = minimumRevision([
          readerMinimum,
          deviceMinimum,
          checkpointBounds.minimumPinnedRevision,
          recoveryMinimum,
          checkpointBounds.newestAvailableRevision,
        ]);
        if (
          safeThrough === null || requestedThrough > safeThrough ||
          checkpointBounds.newestAvailableRevision === null ||
          checkpointBounds.newestAvailableRevision < requestedThrough
        ) throw new CompactionRejected("COMPACTION_WATERMARK_BLOCKED");

        if (!await this.dependencies.mutations.hasCompleteRange(
          transaction,
          revision.compactedThroughServerRevision,
          revision.serverRevision,
        )) throw new CompactionRejected("COMPACTION_CHAIN_INCOMPLETE");

        await this.dependencies.revisions.compareAndAdvanceCompactionWatermark(
          transaction,
          revision.compactedThroughServerRevision,
          requestedThrough,
        );
        const deletedMutationCount = await this.dependencies.mutations.compactPrefix(
          transaction,
          requestedThrough,
        );
        return accept({ compactedThroughServerRevision: requestedThrough, deletedMutationCount });
      });
    } catch (error) {
      if (error instanceof CompactionRejected) return reject(error.code);
      throw error;
    }
  }

  async rebuild(
    scope: unknown,
    checkpointIdValue: unknown,
    targetServerRevisionValue: unknown,
    expectedStateDigest?: string,
  ): Promise<CheckpointPersistenceResult<RebuildProjection>> {
    const checkpointId = parseIdentifier(checkpointIdValue, "checkpoint id");
    const targetServerRevision = serverRevisionSchema.parse(targetServerRevisionValue);
    if (expectedStateDigest !== undefined) assertDigest(expectedStateDigest);
    return this.dependencies.transactions.withTenant(scope, async (transaction) => {
      const revision = await this.dependencies.revisions.read(transaction);
      if (revision === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
      // Rebuild is a pure snapshot read. The repeatable-read transaction below binds the
      // checkpoint, replay range, and live projection without taking a write-only row lock.
      const checkpoint = await this.dependencies.checkpoints.read(transaction, checkpointId);
      if (
        checkpoint === null || checkpoint.status !== "available" ||
        targetServerRevision < checkpoint.descriptor.throughServerRevision || targetServerRevision !== revision.serverRevision
      ) return reject("CHECKPOINT_NOT_AVAILABLE");
      try {
        const snapshot = await this.dependencies.checkpoints.readState(transaction, checkpointId);
        const storedEntityDigests = await this.dependencies.checkpoints.readEntityDigests(transaction, checkpointId);
        const snapshotEntityDigests = await computeWorkspaceCheckpointEntityDigests(snapshot, sha256);
        if (
          !sameEntityDigests(storedEntityDigests, snapshotEntityDigests) ||
          digestBytes(encodeCheckpointEntityDigestsInput(snapshotEntityDigests)) !== checkpoint.descriptor.checkpointDigest
        ) return reject("REBUILD_CHAIN_INVALID");
        const mutations = await this.dependencies.mutations.readRange(
          transaction,
          checkpoint.descriptor.throughServerRevision,
          targetServerRevision,
        );
        const state = replayCheckpointState(
          snapshot,
          mutations,
          checkpoint.descriptor.throughServerRevision,
          targetServerRevision,
          transaction.scope.workspaceId,
        );
        // The rebuilt state, tombstones and generations included, must equal the live replica.
        const stateDigest = await checkpointStateDigest(state);
        const liveStateDigest = await checkpointStateDigest(
          await this.dependencies.portfolio.captureCheckpointState(transaction),
        );
        if (
          stateDigest !== liveStateDigest ||
          (expectedStateDigest !== undefined && stateDigest !== expectedStateDigest)
        ) {
          return reject("REBUILD_DIGEST_MISMATCH");
        }
        return accept({ throughServerRevision: targetServerRevision, state, stateDigest });
      } catch {
        return reject("REBUILD_CHAIN_INVALID");
      }
    }, { readOnly: true, repeatableRead: true });
  }
}

/**
 * Replays a dense mutation range onto a checkpoint state (ADR-0029 decisions 1-3). A delete turns
 * the live row into a tombstone of the same generation at the delete's revision and time. A re-add
 * replaces the tombstone it names (generation g, deletion revision R, built on R and before its own
 * revision) with a live row of generation g + 1 holding only the re-add's fields. Any other item on
 * a tombstone, and a re-add of anything but that tombstone, is a corrupt chain. A creating upsert
 * must be generation 1 and every other item must name the live row's generation, exactly as ingest
 * admits. The mutation log stores each accepted generation (migration 202611140005), so these
 * checks compare what ingest accepted.
 */
export function replayCheckpointState(
  snapshotValue: unknown,
  mutationValues: readonly unknown[],
  fromServerRevisionExclusive: number,
  throughServerRevisionInclusive: number,
  workspaceId: string,
): WorkspaceCheckpointState {
  const snapshot = workspaceCheckpointStateSchema.parse(snapshotValue);
  const fromRevision = serverRevisionSchema.parse(fromServerRevisionExclusive);
  const throughServerRevision = serverRevisionSchema.parse(throughServerRevisionInclusive);
  if (throughServerRevision < fromRevision) throw new TypeError("rebuild bounds are inverted");
  if (snapshot.tombstones.some((tombstone) => tombstone.deletedServerRevision > fromRevision)) {
    throw new TypeError("rebuild checkpoint holds a deletion after its revision");
  }
  const mutations = mutationValues.map((value) => syncMutationSchema.parse(value));
  if (mutations.length !== throughServerRevision - fromRevision) {
    throw new TypeError("rebuild mutation range is incomplete");
  }
  const rows = new Map(snapshot.assets.map((row) => [row.entityId, cloneRow(row)]));
  const tombstones = new Map(snapshot.tombstones.map((tombstone) => [tombstone.entityId, { ...tombstone }]));
  let expectedRevision = fromRevision + 1;
  for (const mutation of mutations) {
    if (mutation.serverRevision !== expectedRevision) throw new TypeError("rebuild revisions are missing or reordered");
    if (mutation.workspaceId !== workspaceId) throw new TypeError("rebuild mutation crosses workspace scope");
    const tombstone = tombstones.get(mutation.entityId);
    if (mutation.reAddsDeletedRevision !== undefined) {
      if (tombstone === undefined || tombstone.deletedServerRevision !== mutation.reAddsDeletedRevision ||
          mutation.entityGeneration !== tombstone.entityGeneration + 1 ||
          mutation.baseServerRevision < tombstone.deletedServerRevision ||
          mutation.baseServerRevision >= mutation.serverRevision) {
        throw new TypeError("rebuild re-add names no matching tombstone");
      }
      tombstones.delete(mutation.entityId);
      applyMutation(createDefaultRow(rows, mutation.entityId, mutation.entityGeneration), mutation);
      expectedRevision += 1;
      continue;
    }
    if (tombstone !== undefined) throw new TypeError("rebuild mutation revives a deleted entity");
    const row = rows.get(mutation.entityId);
    if (mutation.entityGeneration !== (row?.entityGeneration ?? 1)) {
      throw new TypeError("rebuild mutation names another entity generation");
    }
    if (mutation.operationKind === "delete") {
      if (row === undefined || mutation.deletedAt === undefined) throw new TypeError("rebuild delete references an unknown entity");
      rows.delete(mutation.entityId);
      tombstones.set(mutation.entityId, {
        entityId: mutation.entityId,
        entityGeneration: row.entityGeneration,
        deletedServerRevision: mutation.serverRevision,
        deletedAt: mutation.deletedAt,
      });
    } else {
      // The first upsert of an asset the snapshot does not hold creates it, as ingest did.
      applyMutation(row ?? createDefaultRow(rows, mutation.entityId, 1), mutation);
    }
    expectedRevision += 1;
  }
  return workspaceCheckpointStateSchema.parse({
    assets: [...rows.values()].sort((left, right) => compareUtf8(left.entityId, right.entityId)),
    tombstones: [...tombstones.values()].sort((left, right) => compareUtf8(left.entityId, right.entityId)),
  });
}

async function checkpointStateDigest(state: unknown): Promise<string> {
  return digestBytes(encodeCheckpointEntityDigestsInput(await computeWorkspaceCheckpointEntityDigests(state, sha256)));
}

function createDefaultRow(
  rows: Map<string, MutableDomainAsset>,
  entityId: string,
  entityGeneration: number,
): MutableDomainAsset {
  const row: MutableDomainAsset = { entityId, entityGeneration, note: null, portfolioId: null, tags: [], targetPrice: null };
  rows.set(entityId, row);
  return row;
}

function applyMutation(row: MutableDomainAsset, mutation: SyncMutation): void {
  for (const field of mutation.changedFields) {
    switch (field.fieldPath) {
      case "note": row.note = field.value; break;
      case "portfolioId": row.portfolioId = field.value; break;
      case "tags": row.tags = [...field.value]; break;
      case "targetPrice": row.targetPrice = field.value === null ? null : { ...field.value }; break;
    }
  }
}

interface MutableDomainAsset {
  entityId: string;
  entityGeneration: number;
  note: string | null;
  portfolioId: string | null;
  tags: string[];
  targetPrice: { currency: string; amount: string } | null;
}

function cloneRow(row: WorkspaceCheckpointState["assets"][number]): MutableDomainAsset {
  return {
    entityId: row.entityId,
    entityGeneration: row.entityGeneration,
    note: row.note,
    portfolioId: row.portfolioId,
    tags: [...row.tags],
    targetPrice: row.targetPrice === null ? null : { ...row.targetPrice },
  };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return createHash("sha256").update(bytes).digest();
}

function digestBytes(value: Uint8Array | string): string {
  return typeof value === "string"
    ? createHash("sha256").update(value, "utf8").digest("base64url")
    : createHash("sha256").update(value).digest("base64url");
}

function sameEntityDigests(left: readonly unknown[], right: readonly unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function minimumRevision(values: readonly (number | null)[]): number | null {
  for (const value of values) validateNullableRevision(value, "compaction watermark");
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.min(...present);
}

function validateNullableRevision(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`${label} is malformed`);
  }
}

function assertDigest(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new TypeError("expected projection digest is malformed");
}

function parseIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || !/^[!-~]+$/u.test(value)) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function parsePinInput(value: unknown): CheckpointPinBinding {
  const record = strictDataRecord(value, [
    "checkpointId",
    "throughServerRevision",
    "checkpointDigest",
    "consumerKind",
    "consumerId",
    "expiresAt",
  ]);
  const checkpointId = parseIdentifier(record["checkpointId"], "checkpoint id");
  const consumerId = parseIdentifier(record["consumerId"], "checkpoint pin consumer id");
  const consumerKind = record["consumerKind"];
  if (consumerKind !== "bootstrap" && consumerKind !== "recovery") {
    throw new TypeError("checkpoint pin consumer kind is malformed");
  }
  const throughServerRevision = serverRevisionSchema.parse(record["throughServerRevision"]);
  const checkpointDigest = record["checkpointDigest"];
  if (typeof checkpointDigest !== "string") throw new TypeError("checkpoint pin digest is malformed");
  assertDigest(checkpointDigest);
  const expiresAt = record["expiresAt"];
  if (typeof expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(expiresAt)) {
    throw new TypeError("checkpoint pin expiry is malformed");
  }
  return { checkpointId, throughServerRevision, checkpointDigest, consumerKind, consumerId, expiresAt };
}

function strictDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new TypeError("checkpoint request is malformed");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("checkpoint request is malformed");
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("checkpoint request is malformed");
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    throw new TypeError("checkpoint request is malformed");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError("checkpoint request is malformed");
    }
  }
  return value as Record<string, unknown>;
}

function accept<Value>(value: Value): CheckpointPersistenceResult<Value> {
  return { accepted: true, value };
}

function reject(code: CheckpointPersistenceRejectionCode): CheckpointPersistenceResult<never> {
  return { accepted: false, code };
}

class CompactionRejected extends Error {
  constructor(readonly code: CheckpointPersistenceRejectionCode) {
    super(code);
  }
}
