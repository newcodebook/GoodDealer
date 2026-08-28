import { createHash } from "node:crypto";

export { PostgresMutationDrainLedger } from "./postgres-drain-ledger";
export { PostgresBootstrapMutationPagePort } from "./bootstrap-port";
export {
  PostgresWorkspaceMutationRepository,
  type AssignedMutation,
  type LockedMutationDrainDomain,
  type MutationPersistenceFaultPoint,
  type MutationReceipt,
  type MutationReceiptResolution,
} from "./postgres-repository";
export {
  PostgresWorkspaceMutationIngest,
  type PostgresMutationCommitFaultPoint,
} from "./postgres-ingest-service";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
} from "@gooddealer/protocol/execution-events";
import { identifier, safePositiveInteger } from "@gooddealer/protocol/wire";
import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  submittedSyncMutationSchema,
  syncMutationSchema,
  type SubmittedSyncMutation,
  type SyncMutation,
} from "@gooddealer/protocol/workspace";

import type { DrainSealParticipantPort, DrainStreamWatermarkPort } from "../../devices/ports";
import type { WorkspaceBindingPort } from "../revisions/index";
import type { WorkspaceTenantScope } from "../tenant-scope";
import { workspaceTenantKey } from "../tenant-scope";
import type { PortfolioMutationPort } from "../state/portfolio/index";

const MAX_MUTATIONS_PER_INGEST = 256;

export interface MutationDrainDomain {
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
}

export type MutationIngestRejectionCode =
  | "WORKSPACE_TENANT_UNRESOLVED"
  | "MUTATION_MALFORMED"
  | "MUTATION_WORKSPACE_MISMATCH"
  | "MUTATION_SCHEMA_VERSION_UNSUPPORTED"
  | "MUTATION_DEVICE_NOT_ACTIVE"
  | "MUTATION_EPOCH_STALE"
  | "MUTATION_DRAIN_SEALED"
  | "MUTATION_BATCH_UNORDERED"
  | "MUTATION_ID_CONFLICT"
  | "MUTATION_SEQUENCE_CONFLICT"
  | "MUTATION_ENTITY_UNKNOWN"
  | "MUTATION_BASE_REVISION_AHEAD"
  | "MUTATION_FIELD_STALE";

export interface MutationIngestRequest {
  readonly schemaVersion: typeof WORKSPACE_SYNC_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly mutations: readonly SubmittedSyncMutation[];
}

export interface MutationIngestFailure {
  readonly index: number;
  readonly mutationId: string | null;
  readonly fieldPath?: SubmittedSyncMutation["changedFields"][number]["fieldPath"];
  readonly lastModifiedRevision?: number;
  readonly headRevision?: number;
}

export type MutationIngestResult =
  | {
    readonly accepted: true;
    readonly assignments: readonly {
      readonly mutationId: string;
      readonly deviceMutationSequence: number;
      readonly serverRevision: number;
      readonly duplicate: boolean;
    }[];
    readonly headRevision: number;
  }
  | {
    readonly accepted: false;
    readonly code: MutationIngestRejectionCode;
    readonly failures?: readonly MutationIngestFailure[];
  };

export interface ActiveWorkspaceLeasePort {
  readActiveLease(scope: WorkspaceTenantScope): {
    readonly deviceId: string;
    readonly activeLeaseEpoch: number;
  } | null;
}

/** Fixture authority projection used by ingest; Standby bindings are deliberately not leases. */
export class InMemoryWorkspaceLeaseRegistry implements ActiveWorkspaceLeasePort {
  readonly #devices = new Map<string, Map<string, { readonly role: "active" | "standby"; readonly epoch: number }>>();

  bindDevice(
    scope: WorkspaceTenantScope,
    deviceId: string,
    role: "active" | "standby",
    activeLeaseEpoch: number,
  ): void {
    if (!identifier.safeParse(deviceId).success || !safePositiveInteger.safeParse(activeLeaseEpoch).success) {
      throw new TypeError("device lease binding is malformed");
    }
    const key = workspaceTenantKey(scope);
    const devices = this.#devices.get(key) ?? new Map();
    if (role === "active") {
      for (const [boundDeviceId, binding] of devices) {
        if (binding.role === "active" && boundDeviceId !== deviceId) {
          devices.set(boundDeviceId, { ...binding, role: "standby" });
        }
      }
    }
    devices.set(deviceId, { role, epoch: activeLeaseEpoch });
    this.#devices.set(key, devices);
  }

  readActiveLease(scope: WorkspaceTenantScope): {
    readonly deviceId: string;
    readonly activeLeaseEpoch: number;
  } | null {
    for (const [deviceId, binding] of this.#devices.get(workspaceTenantKey(scope)) ?? []) {
      if (binding.role === "active") return { deviceId, activeLeaseEpoch: binding.epoch };
    }
    return null;
  }
}

/**
 * Tenant-keyed mutation drain ledger. The legacy record method remains for read-side fixture
 * tests; accepted ingest uses appendAcceptedBatch so every append has a compensating rollback.
 */
export class InMemoryMutationDrainWatermarks implements DrainStreamWatermarkPort, DrainSealParticipantPort<"mutation"> {
  readonly #records = new Map<string, Map<number, Uint8Array>>();
  readonly #seals = new Map<string, number>();
  readonly #quarantined = new Map<string, {
    readonly sequence: number;
    readonly reason: "sequence_replay" | "drain_seal_violation";
  }[]>();

  recordLandedEnvelope(
    scope: WorkspaceTenantScope,
    domain: MutationDrainDomain,
    sequence: number,
    envelope: Uint8Array,
  ):
    | { readonly outcome: "accepted"; readonly duplicate: boolean }
    | { readonly outcome: "quarantined"; readonly reason: "sequence_replay" | "drain_seal_violation" } {
    assertSequence(sequence);
    const key = domainKey(scope, domain);
    const records = this.#records.get(key);
    const previous = records?.get(sequence);
    if (previous !== undefined) {
      if (!equalBytes(previous, envelope)) {
        this.#recordDiagnostic(scope, domain, sequence, "sequence_replay");
        return { outcome: "quarantined", reason: "sequence_replay" };
      }
      return { outcome: "accepted", duplicate: true };
    }
    if (this.#seals.has(key)) {
      this.#recordDiagnostic(scope, domain, sequence, "drain_seal_violation");
      return { outcome: "quarantined", reason: "drain_seal_violation" };
    }
    recordEnvelope(this.#records, key, sequence, envelope);
    return { outcome: "accepted", duplicate: false };
  }

  appendAcceptedBatch(
    scope: WorkspaceTenantScope,
    domain: MutationDrainDomain,
    entries: readonly { readonly sequence: number; readonly envelope: Uint8Array }[],
  ): { rollback(): void } {
    const key = domainKey(scope, domain);
    if (this.#seals.has(key)) throw new TypeError("accepted ingest crossed an immutable drain seal");
    const records = this.#records.get(key) ?? new Map<number, Uint8Array>();
    for (const entry of entries) {
      assertSequence(entry.sequence);
      const previous = records.get(entry.sequence);
      if (previous !== undefined && !equalBytes(previous, entry.envelope)) {
        throw new TypeError("accepted ingest conflicts with the mutation drain ledger");
      }
    }
    const inserted: number[] = [];
    for (const entry of entries) {
      if (!records.has(entry.sequence)) {
        records.set(entry.sequence, Uint8Array.from(entry.envelope));
        inserted.push(entry.sequence);
      }
    }
    this.#records.set(key, records);
    return {
      rollback: () => {
        for (const sequence of inserted) records.delete(sequence);
        if (records.size === 0) this.#records.delete(key);
      },
    };
  }

  installAcceptedDrainSeal(
    scope: WorkspaceTenantScope,
    input: MutationDrainDomain & {
      readonly stream: "mutation";
      readonly lastAssignedSequence: number;
    },
  ): { rollback(): void } {
    if (input.stream !== "mutation") throw new TypeError("mutation ledger serves only the mutation stream");
    if (!Number.isSafeInteger(input.lastAssignedSequence) || input.lastAssignedSequence < 0) {
      throw new TypeError("accepted drain seal sequence must be unsigned");
    }
    const key = domainKey(scope, input);
    const existing = this.#seals.get(key);
    if (existing !== undefined && existing !== input.lastAssignedSequence) {
      throw new TypeError("an accepted handoff proof is immutable");
    }
    this.#seals.set(key, input.lastAssignedSequence);
    return { rollback: () => { if (existing === undefined) this.#seals.delete(key); } };
  }

  acceptedSeal(scope: WorkspaceTenantScope, domain: MutationDrainDomain): number | null {
    return this.#seals.get(domainKey(scope, domain)) ?? null;
  }

  recordRejectedAfterSeal(scope: WorkspaceTenantScope, domain: MutationDrainDomain, sequence: number): void {
    if (this.#seals.has(domainKey(scope, domain))) {
      this.#recordDiagnostic(scope, domain, sequence, "drain_seal_violation");
    }
  }

  quarantined(scope: WorkspaceTenantScope): readonly {
    readonly sequence: number;
    readonly reason: "sequence_replay" | "drain_seal_violation";
  }[] {
    const prefix = `${workspaceTenantKey(scope)}\u0000`;
    return [...this.#quarantined]
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([, diagnostics]) => diagnostics.map((diagnostic) => ({ ...diagnostic })));
  }

  readEnvelope(scope: WorkspaceTenantScope, domain: MutationDrainDomain, sequence: number): Uint8Array | null {
    const envelope = this.#records.get(domainKey(scope, domain))?.get(sequence);
    return envelope === undefined ? null : Uint8Array.from(envelope);
  }

  async readWatermark(
    scope: WorkspaceTenantScope,
    domain: MutationDrainDomain & { readonly stream: "mutation" },
  ) {
    if (domain.stream !== "mutation") throw new TypeError("mutation ledger serves only the mutation stream");
    return projectWatermark(this.#records.get(domainKey(scope, domain)));
  }

  #recordDiagnostic(
    scope: WorkspaceTenantScope,
    domain: MutationDrainDomain,
    sequence: number,
    reason: "sequence_replay" | "drain_seal_violation",
  ): void {
    const key = domainKey(scope, domain);
    const diagnostics = this.#quarantined.get(key) ?? [];
    diagnostics.push({ sequence, reason });
    this.#quarantined.set(key, diagnostics);
  }
}

export interface WorkspaceMutationQueryPort {
  readCommitted(
    scope: WorkspaceTenantScope,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): readonly SyncMutation[];
  hasCompleteRange(
    scope: WorkspaceTenantScope,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): boolean;
  compactPrefix(scope: WorkspaceTenantScope, throughServerRevisionInclusive: number): { rollback(): void };
}

interface WorkspaceRevisionCommitPort {
  readHead(scope: WorkspaceTenantScope): { readonly serverRevision: number; readonly workspaceSchemaVersion: number };
  commitAcceptedMutations(
    scope: WorkspaceTenantScope,
    observedHead: number,
    acceptedMutationCount: number,
  ): readonly number[];
}

export type MutationCommitFaultPoint =
  | "after_ledger_append"
  | "after_materialization"
  | "after_log_insert"
  | "before_revision_commit";

export class InMemoryWorkspaceMutationIngest implements WorkspaceMutationQueryPort {
  readonly #bindings: WorkspaceBindingPort;
  readonly #revisions: WorkspaceRevisionCommitPort;
  readonly #leases: ActiveWorkspaceLeasePort;
  readonly #portfolio: PortfolioMutationPort;
  readonly #ledger: InMemoryMutationDrainWatermarks;
  readonly #fault?: (point: MutationCommitFaultPoint) => void;
  readonly #recordsById = new Map<string, Map<string, SyncMutation>>();
  readonly #mutationIdBySequence = new Map<string, Map<string, string>>();
  readonly #recordsByRevision = new Map<string, Map<number, SyncMutation>>();

  constructor(options: {
    readonly bindings: WorkspaceBindingPort;
    readonly revisions: WorkspaceRevisionCommitPort;
    readonly leases: ActiveWorkspaceLeasePort;
    readonly portfolio: PortfolioMutationPort;
    readonly ledger: InMemoryMutationDrainWatermarks;
    readonly fault?: (point: MutationCommitFaultPoint) => void;
  }) {
    this.#bindings = options.bindings;
    this.#revisions = options.revisions;
    this.#leases = options.leases;
    this.#portfolio = options.portfolio;
    this.#ledger = options.ledger;
    if (options.fault !== undefined) this.#fault = options.fault;
  }

  async ingest(scope: WorkspaceTenantScope, value: unknown): Promise<MutationIngestResult> {
    // Guard 1 is intentionally the first observable action and has one uniform payload.
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) return reject("WORKSPACE_TENANT_UNRESOLVED");

    // Guard 2 parses from unknown and rejects every unknown outer or mutation field.
    const request = parseMutationIngestRequest(value);
    if (request === null) return reject("MUTATION_MALFORMED");

    if (request.workspaceId !== scope.workspaceId) return reject("MUTATION_WORKSPACE_MISMATCH");

    const schemaFailures = request.mutations.flatMap((mutation, index) =>
      mutation.workspaceSchemaVersion === binding.workspaceSchemaVersion ? [] : [failure(index, mutation)],
    );
    if (schemaFailures.length > 0) return reject("MUTATION_SCHEMA_VERSION_UNSUPPORTED", schemaFailures);

    const activeLease = this.#leases.readActiveLease(scope);
    if (activeLease === null || activeLease.deviceId !== request.sourceDeviceId) {
      return reject("MUTATION_DEVICE_NOT_ACTIVE", request.mutations.map((mutation, index) => failure(index, mutation)));
    }
    if (activeLease.activeLeaseEpoch !== request.activeLeaseEpoch) {
      return reject("MUTATION_EPOCH_STALE", request.mutations.map((mutation, index) => failure(index, mutation)));
    }

    const domain = {
      sourceDeviceId: request.sourceDeviceId,
      activeLeaseEpoch: request.activeLeaseEpoch,
    } as const;
    const sealedThrough = this.#ledger.acceptedSeal(scope, domain);
    const sealedFailures = sealedThrough === null
      ? []
      : request.mutations.flatMap((mutation, index) =>
        mutation.deviceMutationSequence > sealedThrough ? [failure(index, mutation)] : [],
      );
    if (sealedFailures.length > 0) {
      for (const item of sealedFailures) {
        const mutation = request.mutations[item.index];
        if (mutation !== undefined) this.#ledger.recordRejectedAfterSeal(scope, domain, mutation.deviceMutationSequence);
      }
      return reject("MUTATION_DRAIN_SEALED", sealedFailures);
    }

    const orderFailures = unorderedFailures(request.mutations);
    if (orderFailures.length > 0) return reject("MUTATION_BATCH_UNORDERED", orderFailures);

    const tenantKey = workspaceTenantKey(scope);
    const storedById = this.#recordsById.get(tenantKey) ?? new Map<string, SyncMutation>();
    const storedBySequence = this.#mutationIdBySequence.get(tenantKey) ?? new Map<string, string>();
    const duplicateRevisions = new Map<number, number>();
    const stagedById = new Map<string, SubmittedSyncMutation>();
    const idFailures: MutationIngestFailure[] = [];
    for (const [index, mutation] of request.mutations.entries()) {
      const stored = storedById.get(mutation.mutationId);
      const staged = stagedById.get(mutation.mutationId);
      if (stored !== undefined) {
        if (!equalBytes(encodeDrainStreamEnvelope("mutation", stored), encodeDrainStreamEnvelope("mutation", mutation))) {
          idFailures.push(failure(index, mutation));
        } else {
          duplicateRevisions.set(index, stored.serverRevision);
        }
      } else if (staged !== undefined) {
        if (!equalBytes(encodeDrainStreamEnvelope("mutation", staged), encodeDrainStreamEnvelope("mutation", mutation))) {
          idFailures.push(failure(index, mutation));
        }
      } else {
        stagedById.set(mutation.mutationId, mutation);
      }
    }
    if (idFailures.length > 0) return reject("MUTATION_ID_CONFLICT", idFailures);

    const sequenceFailures: MutationIngestFailure[] = [];
    const batchSequenceOwners = new Map<string, string>();
    for (const [index, mutation] of request.mutations.entries()) {
      const key = sequenceKey(mutation);
      const owner = storedBySequence.get(key) ?? batchSequenceOwners.get(key);
      if (owner !== undefined && owner !== mutation.mutationId) sequenceFailures.push(failure(index, mutation));
      else batchSequenceOwners.set(key, mutation.mutationId);
    }
    if (sequenceFailures.length > 0) return reject("MUTATION_SEQUENCE_CONFLICT", sequenceFailures);

    const entityFailures = request.mutations.flatMap((mutation, index) =>
      duplicateRevisions.has(index) || this.#portfolio.hasDomainAsset(scope, mutation.entityId)
        ? []
        : [failure(index, mutation)],
    );
    if (entityFailures.length > 0) return reject("MUTATION_ENTITY_UNKNOWN", entityFailures);

    const observedHead = this.#revisions.readHead(scope).serverRevision;
    const baseFailures = request.mutations.flatMap((mutation, index) =>
      duplicateRevisions.has(index) || mutation.baseServerRevision <= observedHead
        ? []
        : [{ ...failure(index, mutation), headRevision: observedHead }],
    );
    if (baseFailures.length > 0) return reject("MUTATION_BASE_REVISION_AHEAD", baseFailures);

    const proposedRevisionByIndex = new Map<number, number>();
    let proposedRevision = observedHead;
    for (const index of request.mutations.keys()) {
      if (!duplicateRevisions.has(index)) proposedRevisionByIndex.set(index, ++proposedRevision);
    }
    const simulatedFieldRevisions = new Map<string, number>();
    const staleFailures: MutationIngestFailure[] = [];
    for (const [index, mutation] of request.mutations.entries()) {
      if (duplicateRevisions.has(index)) continue;
      for (const field of mutation.changedFields) {
        const key = `${mutation.entityId}\u0000${field.fieldPath}`;
        const lastModifiedRevision = simulatedFieldRevisions.get(key) ??
          this.#portfolio.readFieldRevision(scope, mutation.entityId, field.fieldPath) ?? 0;
        if (lastModifiedRevision > mutation.baseServerRevision) {
          staleFailures.push({
            ...failure(index, mutation),
            fieldPath: field.fieldPath,
            lastModifiedRevision,
            headRevision: observedHead,
          });
        }
      }
      const assigned = proposedRevisionByIndex.get(index);
      if (assigned === undefined) throw new TypeError("proposed revision disappeared");
      for (const field of mutation.changedFields) {
        simulatedFieldRevisions.set(`${mutation.entityId}\u0000${field.fieldPath}`, assigned);
      }
    }
    if (staleFailures.length > 0) return reject("MUTATION_FIELD_STALE", staleFailures);

    const accepted = request.mutations.flatMap((mutation, index) => {
      const serverRevision = proposedRevisionByIndex.get(index);
      if (serverRevision === undefined) return [];
      return [{ index, submitted: mutation, enriched: syncMutationSchema.parse({ ...mutation, serverRevision }) }];
    });
    const rollbacks: { rollback(): void }[] = [];
    if (accepted.length > 0) {
      try {
        rollbacks.push(this.#ledger.appendAcceptedBatch(scope, domain, accepted.map(({ submitted }) => ({
          sequence: submitted.deviceMutationSequence,
          envelope: encodeDrainStreamEnvelope("mutation", submitted),
        }))));
        this.#fault?.("after_ledger_append");
        rollbacks.push(this.#portfolio.applyAcceptedMutations(scope, accepted.map(({ submitted, enriched }) => ({
          mutation: submitted,
          serverRevision: enriched.serverRevision,
        }))));
        this.#fault?.("after_materialization");
        rollbacks.push(this.#insertAccepted(scope, accepted.map(({ enriched }) => enriched)));
        this.#fault?.("after_log_insert");
        this.#fault?.("before_revision_commit");
        const allocated = this.#revisions.commitAcceptedMutations(scope, observedHead, accepted.length);
        if (allocated.some((revision, index) => revision !== accepted[index]?.enriched.serverRevision)) {
          throw new TypeError("revision allocation diverged from the staged commit");
        }
      } catch (error) {
        for (const rollback of rollbacks.reverse()) rollback.rollback();
        throw error;
      }
    }

    const assignments = request.mutations.map((mutation, index) => {
      const duplicateRevision = duplicateRevisions.get(index);
      return {
        mutationId: mutation.mutationId,
        deviceMutationSequence: mutation.deviceMutationSequence,
        serverRevision: duplicateRevision ?? proposedRevisionByIndex.get(index)!,
        duplicate: duplicateRevision !== undefined,
      };
    });
    return {
      accepted: true,
      assignments,
      headRevision: accepted.length === 0 ? observedHead : proposedRevision,
    };
  }

  readCommitted(
    scope: WorkspaceTenantScope,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): readonly SyncMutation[] {
    const records = this.#recordsByRevision.get(workspaceTenantKey(scope));
    const output: SyncMutation[] = [];
    for (let revision = fromServerRevisionExclusive + 1; revision <= throughServerRevisionInclusive; revision += 1) {
      const mutation = records?.get(revision);
      if (mutation !== undefined) output.push(structuredClone(mutation));
    }
    return output;
  }

  hasCompleteRange(
    scope: WorkspaceTenantScope,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): boolean {
    if (
      !Number.isSafeInteger(fromServerRevisionExclusive) ||
      !Number.isSafeInteger(throughServerRevisionInclusive) ||
      fromServerRevisionExclusive < 0 ||
      throughServerRevisionInclusive < fromServerRevisionExclusive
    ) return false;
    return this.readCommitted(scope, fromServerRevisionExclusive, throughServerRevisionInclusive).length ===
      throughServerRevisionInclusive - fromServerRevisionExclusive;
  }

  compactPrefix(
    scope: WorkspaceTenantScope,
    throughServerRevisionInclusive: number,
  ): { rollback(): void } {
    if (!Number.isSafeInteger(throughServerRevisionInclusive) || throughServerRevisionInclusive < 0) {
      throw new TypeError("mutation compaction watermark must be unsigned");
    }
    const key = workspaceTenantKey(scope);
    const records = this.#recordsByRevision.get(key);
    if (records === undefined) return { rollback: () => undefined };
    const removed = new Map<number, SyncMutation>();
    for (const [revision, mutation] of records) {
      if (revision <= throughServerRevisionInclusive) {
        removed.set(revision, mutation);
        records.delete(revision);
      }
    }
    return {
      rollback: () => {
        for (const [revision, mutation] of removed) records.set(revision, mutation);
      },
    };
  }

  findByMutationId(scope: WorkspaceTenantScope, mutationId: string): SyncMutation | null {
    const mutation = this.#recordsById.get(workspaceTenantKey(scope))?.get(mutationId);
    return mutation === undefined ? null : structuredClone(mutation);
  }

  #insertAccepted(scope: WorkspaceTenantScope, mutations: readonly SyncMutation[]): { rollback(): void } {
    const key = workspaceTenantKey(scope);
    const byId = this.#recordsById.get(key) ?? new Map<string, SyncMutation>();
    const bySequence = this.#mutationIdBySequence.get(key) ?? new Map<string, string>();
    const byRevision = this.#recordsByRevision.get(key) ?? new Map<number, SyncMutation>();
    for (const mutation of mutations) {
      byId.set(mutation.mutationId, structuredClone(mutation));
      bySequence.set(sequenceKey(mutation), mutation.mutationId);
      byRevision.set(mutation.serverRevision, structuredClone(mutation));
    }
    this.#recordsById.set(key, byId);
    this.#mutationIdBySequence.set(key, bySequence);
    this.#recordsByRevision.set(key, byRevision);
    return {
      rollback: () => {
        for (const mutation of mutations) {
          byId.delete(mutation.mutationId);
          bySequence.delete(sequenceKey(mutation));
          byRevision.delete(mutation.serverRevision);
        }
        if (byId.size === 0) this.#recordsById.delete(key);
        if (bySequence.size === 0) this.#mutationIdBySequence.delete(key);
        if (byRevision.size === 0) this.#recordsByRevision.delete(key);
      },
    };
  }
}

function parseMutationIngestRequest(value: unknown): MutationIngestRequest | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 5 ||
    !keys.includes("schemaVersion") ||
    !keys.includes("workspaceId") ||
    !keys.includes("sourceDeviceId") ||
    !keys.includes("activeLeaseEpoch") ||
    !keys.includes("mutations") ||
    value.schemaVersion !== WORKSPACE_SYNC_SCHEMA_VERSION ||
    !identifier.safeParse(value.workspaceId).success ||
    !identifier.safeParse(value.sourceDeviceId).success ||
    !safePositiveInteger.safeParse(value.activeLeaseEpoch).success ||
    !Array.isArray(value.mutations) ||
    value.mutations.length < 1 ||
    value.mutations.length > MAX_MUTATIONS_PER_INGEST
  ) return null;
  const mutations: SubmittedSyncMutation[] = [];
  for (const mutation of value.mutations) {
    const parsed = submittedSyncMutationSchema.safeParse(mutation);
    if (!parsed.success || parsed.data.operationKind === "delete") return null;
    if (
      parsed.data.workspaceId !== value.workspaceId ||
      parsed.data.sourceDeviceId !== value.sourceDeviceId ||
      parsed.data.activeLeaseEpoch !== value.activeLeaseEpoch
    ) return null;
    mutations.push(parsed.data);
  }
  return {
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    workspaceId: value.workspaceId as string,
    sourceDeviceId: value.sourceDeviceId as string,
    activeLeaseEpoch: value.activeLeaseEpoch as number,
    mutations,
  };
}

function unorderedFailures(mutations: readonly SubmittedSyncMutation[]): MutationIngestFailure[] {
  const failures: MutationIngestFailure[] = [];
  for (let index = 1; index < mutations.length; index += 1) {
    if (mutations[index - 1]!.deviceMutationSequence >= mutations[index]!.deviceMutationSequence) {
      failures.push(failure(index, mutations[index]!));
    }
  }
  return failures;
}

function reject(
  code: MutationIngestRejectionCode,
  failures: readonly MutationIngestFailure[] = [],
): MutationIngestResult {
  return failures.length === 0 ? { accepted: false, code } : { accepted: false, code, failures };
}

function failure(index: number, mutation: SubmittedSyncMutation): MutationIngestFailure {
  return { index, mutationId: mutation.mutationId };
}

function sequenceKey(mutation: SubmittedSyncMutation): string {
  return `${mutation.sourceDeviceId}\u0000${mutation.activeLeaseEpoch}\u0000${mutation.deviceMutationSequence}`;
}

function domainKey(scope: WorkspaceTenantScope, domain: MutationDrainDomain): string {
  return `${workspaceTenantKey(scope)}\u0000${domain.sourceDeviceId}\u0000${domain.activeLeaseEpoch}`;
}

function recordEnvelope(
  store: Map<string, Map<number, Uint8Array>>,
  key: string,
  sequence: number,
  envelope: Uint8Array,
): void {
  assertSequence(sequence);
  let records = store.get(key);
  if (records === undefined) {
    records = new Map();
    store.set(key, records);
  }
  records.set(sequence, Uint8Array.from(envelope));
}

function projectWatermark(records: Map<number, Uint8Array> | undefined) {
  const highestReceivedSequence = records === undefined || records.size === 0
    ? 0
    : Math.max(...records.keys());
  let contiguousReceivedThrough = 0;
  while (records?.has(contiguousReceivedThrough + 1) === true) contiguousReceivedThrough += 1;
  const missingRanges = missingSequenceRanges(records, highestReceivedSequence);
  let digest = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
  for (let sequence = 1; sequence <= contiguousReceivedThrough; sequence += 1) {
    const envelope = records?.get(sequence);
    if (envelope === undefined) throw new TypeError("contiguous mutation envelope disappeared");
    digest = createHash("sha256").update(encodeDrainChainStepInput(digest, envelope)).digest();
  }
  return {
    contiguousReceivedThrough,
    highestReceivedSequence,
    missingRanges,
    rollingDigest: digest.toString("base64url"),
  };
}

function missingSequenceRanges(records: Map<number, Uint8Array> | undefined, highest: number) {
  const ranges: { fromSequence: number; toSequence: number }[] = [];
  let start: number | null = null;
  for (let sequence = 1; sequence <= highest; sequence += 1) {
    if (records?.has(sequence) !== true && start === null) start = sequence;
    if (records?.has(sequence) === true && start !== null) {
      ranges.push({ fromSequence: start, toSequence: sequence - 1 });
      start = null;
    }
  }
  if (start !== null) ranges.push({ fromSequence: start, toSequence: highest });
  return ranges;
}

function assertSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("mutation sequence must be positive");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
