import { createHash } from "node:crypto";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  deviceAuditEventSchema,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
  type DeviceAuditEvent,
} from "@gooddealer/protocol/execution-events";

import type { AuditChainRegistryPort, DrainSealParticipantPort, DrainStreamWatermarkPort } from "../devices/ports";
import type { WorkspaceTenantScope } from "../workspace/tenant-scope";
import { workspaceTenantKey } from "../workspace/tenant-scope";

interface WorkspaceAuditDomain {
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
}

interface WorkspaceAuditRecord {
  readonly event: DeviceAuditEvent & { readonly scopeKind: "workspace" };
  readonly canonicalEnvelope: Uint8Array;
}

interface ChainRegistration {
  chainId: string;
  headSequence: number;
  headHash: string;
  forked: boolean;
}

/** Workspace drain ledger and unique chain registry; account-scope backlog is diagnostic only. */
export class InMemoryDeviceAuditLedger implements
  DrainStreamWatermarkPort,
  AuditChainRegistryPort,
  DrainSealParticipantPort<"device_audit"> {
  readonly #workspaceRecords = new Map<string, Map<number, WorkspaceAuditRecord>>();
  readonly #chains = new Map<string, ChainRegistration>();
  readonly #seals = new Map<string, number>();
  readonly #quarantined = new Map<string, {
    readonly event: DeviceAuditEvent;
    readonly reason: "sequence_replay" | "drain_seal_violation";
  }[]>();
  readonly #accountBacklog = new Map<string, number>();

  appendAdjudicatedEvent(scope: WorkspaceTenantScope, value: unknown):
    | { readonly outcome: "accepted"; readonly duplicate: boolean }
    | { readonly outcome: "quarantined"; readonly reason: "sequence_replay" | "drain_seal_violation" } {
    const event = deviceAuditEventSchema.parse(value);
    if (event.accountId !== scope.accountId || (event.scopeKind === "workspace" && event.workspaceId !== scope.workspaceId)) {
      throw new TypeError("device audit event tenant scope is unresolved");
    }
    if (event.scopeKind === "account") {
      this.#accountBacklog.set(scope.accountId, (this.#accountBacklog.get(scope.accountId) ?? 0) + 1);
      return { outcome: "accepted", duplicate: false };
    }
    const key = domainKey(scope, event);
    const records = this.#workspaceRecords.get(key);
    const sealedThrough = this.#seals.get(key);
    const existing = records?.get(event.auditSequence);
    const canonicalEnvelope = encodeDrainStreamEnvelope("device_audit", event);
    if (existing !== undefined) {
      if (Buffer.from(existing.canonicalEnvelope).equals(Buffer.from(canonicalEnvelope))) {
        return { outcome: "accepted", duplicate: true };
      }
      this.#recordQuarantine(scope, event, "sequence_replay");
      return { outcome: "quarantined", reason: "sequence_replay" };
    }
    if (sealedThrough !== undefined) {
      this.#recordQuarantine(scope, event, "drain_seal_violation");
      return { outcome: "quarantined", reason: "drain_seal_violation" };
    }

    const target = records ?? new Map<number, WorkspaceAuditRecord>();
    target.set(event.auditSequence, { event, canonicalEnvelope });
    this.#workspaceRecords.set(key, target);
    const registration = this.#chains.get(key);
    if (registration === undefined) {
      this.#chains.set(key, {
        chainId: event.chainId,
        headSequence: event.auditSequence,
        headHash: event.eventHash,
        forked: false,
      });
    } else {
      if (registration.chainId !== event.chainId) registration.forked = true;
      if (event.auditSequence > registration.headSequence) {
        registration.headSequence = event.auditSequence;
        registration.headHash = event.eventHash;
      }
    }
    return { outcome: "accepted", duplicate: false };
  }

  installAcceptedDrainSeal(scope: WorkspaceTenantScope, input: WorkspaceAuditDomain & {
    readonly stream: "device_audit";
    readonly lastAssignedSequence: number;
  }): { rollback(): void } {
    if (input.stream !== "device_audit") throw new TypeError("audit ledger serves only device audit");
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

  recordAcceptedDrainSeal(
    scope: WorkspaceTenantScope,
    domain: WorkspaceAuditDomain,
    lastAssignedSequence: number,
  ): { rollback(): void } {
    return this.installAcceptedDrainSeal(scope, { ...domain, stream: "device_audit", lastAssignedSequence });
  }

  accountBacklog(scope: WorkspaceTenantScope): number {
    workspaceTenantKey(scope);
    return this.#accountBacklog.get(scope.accountId) ?? 0;
  }

  quarantined(scope: WorkspaceTenantScope) {
    return [...(this.#quarantined.get(workspaceTenantKey(scope)) ?? [])].map((record) => ({ ...record }));
  }

  async readWatermark(
    scope: WorkspaceTenantScope,
    domain: WorkspaceAuditDomain & { readonly stream: "device_audit" },
  ) {
    if (domain.stream !== "device_audit") throw new TypeError("audit ledger serves only device audit");
    return projectWatermark(this.#workspaceRecords.get(domainKey(scope, domain)));
  }

  async readChainRegistration(scope: WorkspaceTenantScope, domain: WorkspaceAuditDomain) {
    const registration = this.#chains.get(domainKey(scope, domain));
    return registration === undefined ? null : { ...registration };
  }

  #recordQuarantine(
    scope: WorkspaceTenantScope,
    event: DeviceAuditEvent,
    reason: "sequence_replay" | "drain_seal_violation",
  ): void {
    const key = workspaceTenantKey(scope);
    const records = this.#quarantined.get(key) ?? [];
    records.push({ event, reason });
    this.#quarantined.set(key, records);
  }
}

function domainKey(scope: WorkspaceTenantScope, domain: WorkspaceAuditDomain): string {
  return `${workspaceTenantKey(scope)}\u0000${domain.sourceDeviceId}\u0000${domain.activeLeaseEpoch}`;
}

function projectWatermark(records: Map<number, WorkspaceAuditRecord> | undefined) {
  const highestReceivedSequence = records === undefined || records.size === 0 ? 0 : Math.max(...records.keys());
  let contiguousReceivedThrough = 0;
  while (records?.has(contiguousReceivedThrough + 1) === true) contiguousReceivedThrough += 1;
  const missingRanges = missingSequenceRanges(records, highestReceivedSequence);
  let digest = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
  for (let sequence = 1; sequence <= contiguousReceivedThrough; sequence += 1) {
    const record = records?.get(sequence);
    if (record === undefined) throw new TypeError("contiguous audit event disappeared");
    digest = createHash("sha256").update(encodeDrainChainStepInput(digest, record.canonicalEnvelope)).digest();
  }
  return { contiguousReceivedThrough, highestReceivedSequence, missingRanges, rollingDigest: digest.toString("base64url") };
}

function missingSequenceRanges(records: Map<number, WorkspaceAuditRecord> | undefined, highest: number) {
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
