import { createHash } from "node:crypto";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
} from "@gooddealer/protocol/execution-events";

import type { DrainStreamWatermarkPort } from "../../devices/ports";

interface MutationDrainDomain {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
}

/**
 * Read-side fixture ledger only. Recording a landed canonical envelope does not accept a
 * SyncMutation, assign a server revision, publish a checkpoint, or persist a cursor.
 */
export class InMemoryMutationDrainWatermarks implements DrainStreamWatermarkPort {
  readonly #records = new Map<string, Map<number, Uint8Array>>();

  recordLandedEnvelope(domain: MutationDrainDomain, sequence: number, envelope: Uint8Array): void {
    recordEnvelope(this.#records, domainKey(domain), sequence, envelope);
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
  const previous = records.get(sequence);
  if (previous !== undefined) {
    if (!Buffer.from(previous).equals(Buffer.from(envelope))) {
      throw new TypeError("a landed mutation sequence cannot be rewritten");
    }
    return;
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
