import { createHash } from "node:crypto";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
} from "@gooddealer/protocol/execution-events";

import type { DrainSealParticipantPort, DrainStreamWatermarkPort } from "../../devices/ports";

interface MutationDrainDomain {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
}

/**
 * Read-side fixture ledger only. Recording a landed canonical envelope does not accept a
 * SyncMutation, assign a server revision, publish a checkpoint, or persist a cursor.
 */
export class InMemoryMutationDrainWatermarks implements DrainStreamWatermarkPort, DrainSealParticipantPort<"mutation"> {
  readonly #records = new Map<string, Map<number, Uint8Array>>();
  readonly #seals = new Map<string, number>();
  readonly #quarantined: {
    readonly sequence: number;
    readonly reason: "sequence_replay" | "drain_seal_violation";
  }[] = [];

  recordLandedEnvelope(domain: MutationDrainDomain, sequence: number, envelope: Uint8Array):
    | { readonly outcome: "accepted"; readonly duplicate: boolean }
    | { readonly outcome: "quarantined"; readonly reason: "sequence_replay" | "drain_seal_violation" } {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("mutation sequence must be positive");
    const key = domainKey(domain);
    const records = this.#records.get(key);
    const previous = records?.get(sequence);
    if (previous !== undefined) {
      if (!Buffer.from(previous).equals(Buffer.from(envelope))) {
        this.#quarantined.push({ sequence, reason: "sequence_replay" });
        return { outcome: "quarantined", reason: "sequence_replay" };
      }
      return { outcome: "accepted", duplicate: true };
    }
    if (this.#seals.has(key)) {
      this.#quarantined.push({ sequence, reason: "drain_seal_violation" });
      return { outcome: "quarantined", reason: "drain_seal_violation" };
    }
    recordEnvelope(this.#records, key, sequence, envelope);
    return { outcome: "accepted", duplicate: false };
  }

  installAcceptedDrainSeal(input: MutationDrainDomain & {
    readonly stream: "mutation";
    readonly lastAssignedSequence: number;
  }): { rollback(): void } {
    if (input.stream !== "mutation") throw new TypeError("mutation ledger serves only the mutation stream");
    if (!Number.isSafeInteger(input.lastAssignedSequence) || input.lastAssignedSequence < 0) {
      throw new TypeError("accepted drain seal sequence must be unsigned");
    }
    const key = domainKey(input);
    const existing = this.#seals.get(key);
    if (existing !== undefined && existing !== input.lastAssignedSequence) {
      throw new TypeError("an accepted handoff proof is immutable");
    }
    this.#seals.set(key, input.lastAssignedSequence);
    return { rollback: () => { if (existing === undefined) this.#seals.delete(key); } };
  }

  quarantined() {
    return [...this.#quarantined];
  }

  async readWatermark(domain: MutationDrainDomain & { readonly stream: "mutation" }) {
    if (domain.stream !== "mutation") throw new TypeError("mutation ledger serves only the mutation stream");
    return projectWatermark(this.#records.get(domainKey(domain)));
  }
}

function domainKey(domain: MutationDrainDomain): string {
  return `${domain.workspaceId}\u0000${domain.sourceDeviceId}\u0000${domain.activeLeaseEpoch}`;
}

function recordEnvelope(
  store: Map<string, Map<number, Uint8Array>>,
  key: string,
  sequence: number,
  envelope: Uint8Array,
): void {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("mutation sequence must be positive");
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
