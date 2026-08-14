import { createHash } from "node:crypto";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  deviceAuditEventSchema,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
  type DeviceAuditEvent,
} from "@gooddealer/protocol/execution-events";

import type { AuditChainRegistryPort, DrainStreamWatermarkPort } from "../devices/ports";

interface WorkspaceAuditDomain {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
}

interface WorkspaceAuditRecord {
  readonly event: DeviceAuditEvent & { readonly scopeKind: "workspace" };
}

interface ChainRegistration {
  chainId: string;
  headSequence: number;
  headHash: string;
  forked: boolean;
}

/** Workspace drain ledger and unique chain registry; account-scope backlog is diagnostic only. */
export class InMemoryDeviceAuditLedger implements DrainStreamWatermarkPort, AuditChainRegistryPort {
  readonly #workspaceRecords = new Map<string, Map<number, WorkspaceAuditRecord>>();
  readonly #chains = new Map<string, ChainRegistration>();
  readonly #seals = new Map<string, number>();
  readonly #quarantined: { readonly event: DeviceAuditEvent; readonly reason: "drain_seal_violation" }[] = [];
  #accountBacklog = 0;

  appendAdjudicatedEvent(value: unknown):
    | { readonly outcome: "accepted"; readonly duplicate: boolean }
    | { readonly outcome: "quarantined"; readonly reason: "drain_seal_violation" } {
    const event = deviceAuditEventSchema.parse(value);
    if (event.scopeKind === "account") {
      this.#accountBacklog += 1;
      return { outcome: "accepted", duplicate: false };
    }
    const key = domainKey(event);
    const records = this.#workspaceRecords.get(key);
    const sealedThrough = this.#seals.get(key);
    if (sealedThrough !== undefined && event.auditSequence > sealedThrough) {
      this.#quarantined.push({ event, reason: "drain_seal_violation" });
      return { outcome: "quarantined", reason: "drain_seal_violation" };
    }
    if (records?.has(event.auditSequence) === true ||
      (sealedThrough !== undefined && event.auditSequence <= sealedThrough)) {
      return { outcome: "accepted", duplicate: true };
    }

    const target = records ?? new Map<number, WorkspaceAuditRecord>();
    target.set(event.auditSequence, { event });
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

  recordAcceptedDrainSeal(domain: WorkspaceAuditDomain, lastAssignedSequence: number): void {
    const key = domainKey(domain);
    const existing = this.#seals.get(key);
    if (existing !== undefined && existing !== lastAssignedSequence) {
      throw new TypeError("an accepted handoff proof is immutable");
    }
    this.#seals.set(key, lastAssignedSequence);
  }

  accountBacklog(): number {
    return this.#accountBacklog;
  }

  quarantined() {
    return [...this.#quarantined];
  }

  async readWatermark(domain: WorkspaceAuditDomain & { readonly stream: "device_audit" }) {
    if (domain.stream !== "device_audit") throw new TypeError("audit ledger serves only device audit");
    return projectWatermark(this.#workspaceRecords.get(domainKey(domain)));
  }

  async readChainRegistration(domain: WorkspaceAuditDomain) {
    const registration = this.#chains.get(domainKey(domain));
    return registration === undefined ? null : { ...registration };
  }
}

function domainKey(domain: WorkspaceAuditDomain): string {
  return `${domain.workspaceId}\u0000${domain.sourceDeviceId}\u0000${domain.activeLeaseEpoch}`;
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
    const envelope = encodeDrainStreamEnvelope("device_audit", record.event);
    digest = createHash("sha256").update(encodeDrainChainStepInput(digest, envelope)).digest();
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
