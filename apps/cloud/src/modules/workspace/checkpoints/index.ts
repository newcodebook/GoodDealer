import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  checkpointDescriptorSchema,
  encodeWorkspaceEntityDigestsInput,
  type CheckpointDescriptor,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";

export { PostgresBootstrapCheckpointPort } from "./bootstrap-port";

import type { CheckpointCatalogPort } from "../../devices/ports";
import type { WorkspaceTenantScope } from "../tenant-scope";
import { workspaceTenantKey } from "../tenant-scope";

interface CheckpointBindingPort {
  resolveWorkspace(scope: WorkspaceTenantScope):
    | { readonly bound: true; readonly workspaceSchemaVersion: number; readonly compactedThroughServerRevision: number }
    | { readonly bound: false };
}

interface CheckpointRevisionPort {
  readHead(scope: WorkspaceTenantScope): {
    readonly serverRevision: number;
    readonly workspaceSchemaVersion: number;
  };
  advanceCompactionWatermark(scope: WorkspaceTenantScope, throughServerRevision: number): { rollback(): void };
}

interface CheckpointSnapshotPort {
  readEntityDigestsAt(
    scope: WorkspaceTenantScope,
    throughServerRevision: number,
    digest: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<readonly WorkspaceEntityDigest[]>;
}

interface CheckpointMutationLogPort {
  hasCompleteRange(
    scope: WorkspaceTenantScope,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): boolean;
  compactPrefix(scope: WorkspaceTenantScope, throughServerRevisionInclusive: number): { rollback(): void };
}

interface CursorWatermarkPort {
  minimumActiveRevision(scope: WorkspaceTenantScope): number | null;
}

export interface CandidateWatermarkPort {
  minimumUnresolvedComparisonRevision(scope: WorkspaceTenantScope): number | null;
}

interface CheckpointSha256Port {
  digest(bytes: Uint8Array): Promise<Uint8Array>;
}

interface CheckpointTrustedTimePort {
  now(): string;
}

export interface CheckpointOperationalConfig {
  readonly schemaVersion: 1;
  readonly retainedAvailableCheckpoints: number;
}

export const defaultCheckpointOperationalConfig: CheckpointOperationalConfig = {
  schemaVersion: 1,
  retainedAvailableCheckpoints: 2,
};

export class NoUnresolvedCandidateWatermark implements CandidateWatermarkPort {
  minimumUnresolvedComparisonRevision(scope: WorkspaceTenantScope): null {
    void scope;
    return null;
  }
}

export type CheckpointRejectionCode =
  | "WORKSPACE_TENANT_UNRESOLVED"
  | "CHECKPOINT_DIGEST_MISMATCH"
  | "CHECKPOINT_NOT_AVAILABLE"
  | "CHECKPOINT_PINNED"
  | "COMPACTION_WATERMARK_BLOCKED"
  | "COMPACTION_CHAIN_INCOMPLETE";

interface StoredCheckpoint {
  readonly descriptor: CheckpointDescriptor;
  status: "building" | "available" | "superseded";
  verified: boolean;
  publishedAt: string | null;
}

export interface CheckpointProjection extends CheckpointDescriptor {
  readonly status: "building" | "available" | "superseded";
  readonly publishedAt: string | null;
}

export type CheckpointLifecycleResult =
  | { readonly accepted: true; readonly checkpoint: CheckpointProjection }
  | { readonly accepted: false; readonly code: CheckpointRejectionCode };

export type CompactionResult =
  | { readonly accepted: true; readonly compactedThroughServerRevision: number; readonly deletedMutationCount: number }
  | { readonly accepted: false; readonly code: CheckpointRejectionCode };

/** Fixture implementation of build -> verify -> publish -> prefix-only compact. */
export class InMemoryCheckpointCatalog implements CheckpointCatalogPort {
  readonly #bindings: CheckpointBindingPort;
  readonly #revisions: CheckpointRevisionPort;
  readonly #state: CheckpointSnapshotPort;
  readonly #mutations: CheckpointMutationLogPort;
  readonly #deviceCursors: CursorWatermarkPort;
  readonly #readerCursors: CursorWatermarkPort;
  readonly #candidates: CandidateWatermarkPort;
  readonly #sha256: CheckpointSha256Port;
  readonly #time: CheckpointTrustedTimePort;
  readonly #config: CheckpointOperationalConfig;
  readonly #checkpoints = new Map<string, Map<string, StoredCheckpoint>>();
  readonly #pins = new Map<string, Map<string, string[]>>();
  readonly #diagnostics = new Map<string, { readonly checkpointId: string; readonly code: "checkpoint_digest_mismatch" }[]>();

  constructor(options: {
    readonly bindings: CheckpointBindingPort;
    readonly revisions: CheckpointRevisionPort;
    readonly state: CheckpointSnapshotPort;
    readonly mutations: CheckpointMutationLogPort;
    readonly deviceCursors: CursorWatermarkPort;
    readonly readerCursors: CursorWatermarkPort;
    readonly candidates?: CandidateWatermarkPort;
    readonly sha256: CheckpointSha256Port;
    readonly time?: CheckpointTrustedTimePort;
    readonly config?: CheckpointOperationalConfig;
  }) {
    this.#bindings = options.bindings;
    this.#revisions = options.revisions;
    this.#state = options.state;
    this.#mutations = options.mutations;
    this.#deviceCursors = options.deviceCursors;
    this.#readerCursors = options.readerCursors;
    this.#candidates = options.candidates ?? new NoUnresolvedCandidateWatermark();
    this.#sha256 = options.sha256;
    this.#time = options.time ?? { now: () => canonicalNow() };
    this.#config = options.config ?? defaultCheckpointOperationalConfig;
    if (
      this.#config.schemaVersion !== 1 ||
      !Number.isSafeInteger(this.#config.retainedAvailableCheckpoints) ||
      this.#config.retainedAvailableCheckpoints < 1
    ) throw new TypeError("checkpoint operational config is malformed");
  }

  async buildCheckpoint(
    scope: WorkspaceTenantScope,
    checkpointId: string,
    throughServerRevision: number,
  ): Promise<CheckpointLifecycleResult> {
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    const head = this.#revisions.readHead(scope);
    if (!Number.isSafeInteger(throughServerRevision) || throughServerRevision < 0 || throughServerRevision > head.serverRevision) {
      return reject("COMPACTION_CHAIN_INCOMPLETE");
    }
    const checkpoints = this.#workspaceCheckpoints(scope);
    if (checkpoints.has(checkpointId)) throw new TypeError("checkpoint id is immutable");
    const entityDigests = await this.#state.readEntityDigestsAt(scope, throughServerRevision, (bytes) => this.#sha256.digest(bytes));
    const checkpointDigest = Buffer.from(
      await this.#sha256.digest(encodeWorkspaceEntityDigestsInput(entityDigests)),
    ).toString("base64url");
    const descriptor = checkpointDescriptorSchema.parse({
      schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
      checkpointId,
      workspaceId: scope.workspaceId,
      workspaceSchemaVersion: binding.workspaceSchemaVersion,
      throughServerRevision,
      checkpointDigest,
    });
    const stored: StoredCheckpoint = { descriptor, status: "building", verified: false, publishedAt: null };
    checkpoints.set(checkpointId, stored);
    return accept(stored);
  }

  async verifyCheckpoint(scope: WorkspaceTenantScope, checkpointId: string): Promise<CheckpointLifecycleResult> {
    if (!this.#bindings.resolveWorkspace(scope).bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
    if (checkpoint === undefined || checkpoint.status !== "building") return reject("CHECKPOINT_NOT_AVAILABLE");
    const entityDigests = await this.#state.readEntityDigestsAt(
      scope,
      checkpoint.descriptor.throughServerRevision,
      (bytes) => this.#sha256.digest(bytes),
    );
    const recomputed = Buffer.from(
      await this.#sha256.digest(encodeWorkspaceEntityDigestsInput(entityDigests)),
    ).toString("base64url");
    if (recomputed !== checkpoint.descriptor.checkpointDigest) {
      const key = workspaceTenantKey(scope);
      const diagnostics = this.#diagnostics.get(key) ?? [];
      diagnostics.push({ checkpointId, code: "checkpoint_digest_mismatch" });
      this.#diagnostics.set(key, diagnostics);
      return reject("CHECKPOINT_DIGEST_MISMATCH");
    }
    checkpoint.verified = true;
    return accept(checkpoint);
  }

  async publishCheckpoint(scope: WorkspaceTenantScope, checkpointId: string): Promise<CheckpointLifecycleResult> {
    if (!this.#bindings.resolveWorkspace(scope).bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
    if (checkpoint === undefined || checkpoint.status !== "building" || !checkpoint.verified) {
      return reject("CHECKPOINT_NOT_AVAILABLE");
    }
    checkpoint.status = "available";
    checkpoint.publishedAt = this.#time.now();
    this.#supersedeExcess(scope);
    return accept(checkpoint);
  }

  supersedeCheckpoint(scope: WorkspaceTenantScope, checkpointId: string): CheckpointLifecycleResult {
    if (!this.#bindings.resolveWorkspace(scope).bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    this.#purgeExpiredPins(scope);
    const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
    if (checkpoint?.status !== "available") return reject("CHECKPOINT_NOT_AVAILABLE");
    if (this.#pins.get(workspaceTenantKey(scope))?.has(checkpointId)) return reject("CHECKPOINT_PINNED");
    checkpoint.status = "superseded";
    return accept(checkpoint);
  }

  async selectPublishedCheckpoint(
    scope: WorkspaceTenantScope,
    checkpointId: string,
  ): Promise<CheckpointDescriptor | null> {
    if (!this.#bindings.resolveWorkspace(scope).bound) return null;
    const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
    return checkpoint?.status === "available" ? structuredClone(checkpoint.descriptor) : null;
  }

  async pinCheckpoint(scope: WorkspaceTenantScope, checkpointId: string, until: string): Promise<boolean> {
    const untilMs = Date.parse(until);
    const nowMs = Date.parse(this.#time.now());
    if (
      !this.#bindings.resolveWorkspace(scope).bound ||
      !Number.isFinite(untilMs) ||
      !Number.isFinite(nowMs) ||
      untilMs <= nowMs
    ) return false;
    const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
    if (checkpoint?.status !== "available") return false;
    const key = workspaceTenantKey(scope);
    const pins = this.#pins.get(key) ?? new Map<string, string[]>();
    const expiries = pins.get(checkpointId) ?? [];
    expiries.push(until);
    pins.set(checkpointId, expiries);
    this.#pins.set(key, pins);
    return true;
  }

  async releasePin(scope: WorkspaceTenantScope, checkpointId: string, _workflowId: string): Promise<void> {
    const pins = this.#pins.get(workspaceTenantKey(scope));
    const expiries = pins?.get(checkpointId);
    if (pins === undefined || expiries === undefined) return;
    expiries.shift();
    if (expiries.length === 0) pins.delete(checkpointId);
  }

  pinCount(scope: WorkspaceTenantScope): number {
    this.#purgeExpiredPins(scope);
    return [...(this.#pins.get(workspaceTenantKey(scope))?.values() ?? [])]
      .reduce((count, expiries) => count + expiries.length, 0);
  }

  inspectCheckpoint(scope: WorkspaceTenantScope, checkpointId: string): CheckpointProjection | null {
    const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
    return checkpoint === undefined ? null : project(checkpoint);
  }

  diagnostics(scope: WorkspaceTenantScope): readonly {
    readonly checkpointId: string;
    readonly code: "checkpoint_digest_mismatch";
  }[] {
    return (this.#diagnostics.get(workspaceTenantKey(scope)) ?? []).map((diagnostic) => ({ ...diagnostic }));
  }

  compactedThroughServerRevision(scope: WorkspaceTenantScope): number | null {
    if (!this.#bindings.resolveWorkspace(scope).bound) return null;
    this.#purgeExpiredPins(scope);
    const available = [...(this.#checkpoints.get(workspaceTenantKey(scope))?.values() ?? [])]
      .filter((checkpoint) => checkpoint.status === "available")
      .map((checkpoint) => checkpoint.descriptor.throughServerRevision);
    if (available.length === 0) return null;
    const terms = [
      this.#deviceCursors.minimumActiveRevision(scope),
      this.#readerCursors.minimumActiveRevision(scope),
      this.#minimumPinnedRevision(scope),
      this.#candidates.minimumUnresolvedComparisonRevision(scope),
      Math.max(...available),
    ].filter((value): value is number => value !== null);
    return Math.min(...terms);
  }

  compact(scope: WorkspaceTenantScope, requestedThroughRevision?: number): CompactionResult {
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    const watermark = this.compactedThroughServerRevision(scope);
    if (watermark === null) return reject("COMPACTION_CHAIN_INCOMPLETE");
    const throughServerRevision = requestedThroughRevision ?? watermark;
    if (
      !Number.isSafeInteger(throughServerRevision) ||
      throughServerRevision < binding.compactedThroughServerRevision ||
      throughServerRevision > watermark
    ) return reject("COMPACTION_WATERMARK_BLOCKED");

    const head = this.#revisions.readHead(scope).serverRevision;
    const hasCheckpoint = [...(this.#checkpoints.get(workspaceTenantKey(scope))?.values() ?? [])]
      .some((checkpoint) => checkpoint.status === "available" && checkpoint.descriptor.throughServerRevision >= throughServerRevision);
    if (!hasCheckpoint || !this.#mutations.hasCompleteRange(scope, binding.compactedThroughServerRevision, head)) {
      return reject("COMPACTION_CHAIN_INCOMPLETE");
    }
    const deletedMutationCount = throughServerRevision - binding.compactedThroughServerRevision;
    const mutationRollback = this.#mutations.compactPrefix(scope, throughServerRevision);
    try {
      this.#revisions.advanceCompactionWatermark(scope, throughServerRevision);
    } catch (error) {
      mutationRollback.rollback();
      throw error;
    }
    return { accepted: true, compactedThroughServerRevision: throughServerRevision, deletedMutationCount };
  }

  #workspaceCheckpoints(scope: WorkspaceTenantScope): Map<string, StoredCheckpoint> {
    const key = workspaceTenantKey(scope);
    const existing = this.#checkpoints.get(key);
    if (existing !== undefined) return existing;
    const checkpoints = new Map<string, StoredCheckpoint>();
    this.#checkpoints.set(key, checkpoints);
    return checkpoints;
  }

  #minimumPinnedRevision(scope: WorkspaceTenantScope): number | null {
    const pins = this.#pins.get(workspaceTenantKey(scope));
    if (pins === undefined || pins.size === 0) return null;
    const revisions = [...pins.keys()].flatMap((checkpointId) => {
      const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
      return checkpoint === undefined ? [] : [checkpoint.descriptor.throughServerRevision];
    });
    return revisions.length === 0 ? null : Math.min(...revisions);
  }

  #purgeExpiredPins(scope: WorkspaceTenantScope): void {
    const pins = this.#pins.get(workspaceTenantKey(scope));
    if (pins === undefined) return;
    const now = this.#time.now();
    for (const [checkpointId, expiries] of pins) {
      const active = expiries.filter((until) => now < until);
      if (active.length === 0) pins.delete(checkpointId);
      else pins.set(checkpointId, active);
    }
  }

  #supersedeExcess(scope: WorkspaceTenantScope): void {
    const available = [...this.#workspaceCheckpoints(scope).values()]
      .filter((checkpoint) => checkpoint.status === "available")
      .sort((left, right) => right.descriptor.throughServerRevision - left.descriptor.throughServerRevision);
    for (const checkpoint of available.slice(this.#config.retainedAvailableCheckpoints)) {
      if (!this.#pins.get(workspaceTenantKey(scope))?.has(checkpoint.descriptor.checkpointId)) {
        checkpoint.status = "superseded";
      }
    }
  }
}

function accept(checkpoint: StoredCheckpoint): { readonly accepted: true; readonly checkpoint: CheckpointProjection } {
  return { accepted: true, checkpoint: project(checkpoint) };
}

function reject(code: CheckpointRejectionCode): { readonly accepted: false; readonly code: CheckpointRejectionCode } {
  return { accepted: false, code };
}

function project(checkpoint: StoredCheckpoint): CheckpointProjection {
  return structuredClone({
    ...checkpoint.descriptor,
    status: checkpoint.status,
    publishedAt: checkpoint.publishedAt,
  });
}

function canonicalNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
