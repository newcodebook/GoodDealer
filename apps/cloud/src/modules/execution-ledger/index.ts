import { createHash } from "node:crypto";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
  executionFactSchema,
  type ExecutionFact,
} from "@gooddealer/protocol/execution-events";

import type { DrainStreamWatermarkPort } from "../devices/ports";

export type ExecutionFactQuarantineReason =
  | "signature"
  | "epoch_unknown"
  | "time_unprovable"
  | "authorization"
  | "sequence_replay"
  | "drain_seal_violation"
  | "removal_boundary";

export type ExecutionFactAdjudication =
  | { readonly outcome: "accepted"; readonly classification: "current" | "late"; readonly duplicate: boolean }
  | { readonly outcome: "quarantined"; readonly reason: ExecutionFactQuarantineReason };

interface ExecutionDomain {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
}

export interface AdjudicatedExecutionFactInput {
  readonly fact: unknown;
  readonly receivedAt: string;
  readonly currentLeaseEpoch: number;
}

export type ExecutionFactIngestVerification =
  | { readonly verified: false; readonly reason: "signature_verification_disabled" }
  | {
    readonly verified: true;
    readonly heldActiveLeaseEpoch: number | null;
    readonly boundCredentialEpoch: number | null;
    readonly offlineExecuteUntil: string | null;
    readonly trustedTime: "proven" | "unproven";
    readonly authorization: "consistent" | "inconsistent";
    readonly removalBoundary: "clear" | "passed";
  };

export interface ExecutionFactIngestVerificationPort {
  verifyExecutionFact(input: {
    readonly fact: ExecutionFact;
    readonly receivedAt: string;
  }): Promise<ExecutionFactIngestVerification>;
}

/** P0-17 Fallback: fact ingestion cannot succeed without the deferred R0-06 verifier. */
export class RefusingExecutionFactIngestVerification implements ExecutionFactIngestVerificationPort {
  async verifyExecutionFact(): Promise<{
    readonly verified: false;
    readonly reason: "signature_verification_disabled";
  }> {
    return { verified: false, reason: "signature_verification_disabled" };
  }
}

interface AcceptedFactRecord {
  readonly fact: ExecutionFact;
  readonly receivedAt: string;
  readonly classification: "current" | "late";
}

/**
 * Server-side classification and read model for already-adjudicated facts. Late facts stay in the
 * evidence ledger and cannot produce mutations, candidates, Desired/Observed changes, or platform
 * side effects. A later seal violation is quarantined and never invalidates an accepted handoff.
 */
export class InMemoryExecutionLedger implements DrainStreamWatermarkPort {
  readonly #ingestVerification: ExecutionFactIngestVerificationPort;
  readonly #records = new Map<string, Map<number, AcceptedFactRecord>>();
  readonly #seals = new Map<string, number>();
  readonly #quarantine: { readonly fact: ExecutionFact | null; readonly reason: ExecutionFactQuarantineReason }[] = [];

  constructor(options: {
    readonly ingestVerification?: ExecutionFactIngestVerificationPort;
  } = {}) {
    this.#ingestVerification = options.ingestVerification ?? new RefusingExecutionFactIngestVerification();
  }

  recordAcceptedDrainSeal(domain: ExecutionDomain, lastAssignedSequence: number): void {
    if (!Number.isSafeInteger(lastAssignedSequence) || lastAssignedSequence < 0) {
      throw new TypeError("accepted drain seal sequence must be unsigned");
    }
    const key = domainKey(domain);
    const existing = this.#seals.get(key);
    if (existing !== undefined && existing !== lastAssignedSequence) {
      throw new TypeError("an accepted handoff proof is immutable");
    }
    this.#seals.set(key, lastAssignedSequence);
  }

  /**
   * Classification begins only after the verification port has adjudicated the fact. An accepting
   * port must derive heldActiveLeaseEpoch and boundCredentialEpoch from the same authoritative
   * device/lease binding; they are conjunctive evidence, not caller assertions.
   */
  async appendAdjudicatedFact(input: AdjudicatedExecutionFactInput): Promise<ExecutionFactAdjudication> {
    const parsed = executionFactSchema.safeParse(input.fact);
    if (!parsed.success) return this.#quarantineFact(null, "signature");
    const fact = parsed.data;
    const key = domainKey(fact);
    const verification = await this.#ingestVerification.verifyExecutionFact({
      fact,
      receivedAt: input.receivedAt,
    });
    if (!verification.verified) return this.#quarantineFact(fact, "signature");
    if (
      verification.heldActiveLeaseEpoch === null ||
      verification.heldActiveLeaseEpoch !== fact.activeLeaseEpoch ||
      verification.boundCredentialEpoch === null ||
      verification.boundCredentialEpoch !== fact.credentialEpoch
    ) {
      return this.#quarantineFact(fact, "epoch_unknown");
    }
    if (
      verification.trustedTime !== "proven" ||
      verification.offlineExecuteUntil === null ||
      fact.requestStartBoundary > verification.offlineExecuteUntil ||
      fact.occurredAt > verification.offlineExecuteUntil
    ) {
      return this.#quarantineFact(fact, "time_unprovable");
    }
    if (verification.authorization !== "consistent") return this.#quarantineFact(fact, "authorization");
    if (verification.removalBoundary === "passed") return this.#quarantineFact(fact, "removal_boundary");

    const sealedThrough = this.#seals.get(key);
    const records = this.#records.get(key);
    const existing = records?.get(fact.executionSequence);
    if (sealedThrough !== undefined) {
      if (fact.executionSequence > sealedThrough) {
        return this.#quarantineFact(fact, "drain_seal_violation");
      }
      if (existing !== undefined || fact.executionSequence <= sealedThrough) {
        return {
          outcome: "accepted",
          classification: existing?.classification ?? (fact.activeLeaseEpoch < input.currentLeaseEpoch ? "late" : "current"),
          duplicate: true,
        };
      }
    }
    if (existing !== undefined) return this.#quarantineFact(fact, "sequence_replay");

    const classification = fact.activeLeaseEpoch < input.currentLeaseEpoch ? "late" : "current";
    const target = records ?? new Map<number, AcceptedFactRecord>();
    target.set(fact.executionSequence, { fact, receivedAt: input.receivedAt, classification });
    this.#records.set(key, target);
    return { outcome: "accepted", classification, duplicate: false };
  }

  quarantined(): readonly { readonly fact: ExecutionFact | null; readonly reason: ExecutionFactQuarantineReason }[] {
    return [...this.#quarantine];
  }

  accepted(): readonly AcceptedFactRecord[] {
    return [...this.#records.values()].flatMap((records) => [...records.values()]);
  }

  async readWatermark(domain: ExecutionDomain & { readonly stream: "execution_fact" }) {
    if (domain.stream !== "execution_fact") throw new TypeError("execution ledger serves only execution facts");
    const records = this.#records.get(domainKey(domain));
    return projectWatermark(records);
  }

  #quarantineFact(fact: ExecutionFact | null, reason: ExecutionFactQuarantineReason): ExecutionFactAdjudication {
    this.#quarantine.push({ fact, reason });
    return { outcome: "quarantined", reason };
  }
}

function domainKey(domain: ExecutionDomain): string {
  return `${domain.workspaceId}\u0000${domain.sourceDeviceId}\u0000${domain.activeLeaseEpoch}`;
}

function projectWatermark(records: Map<number, AcceptedFactRecord> | undefined) {
  const highestReceivedSequence = records === undefined || records.size === 0 ? 0 : Math.max(...records.keys());
  let contiguousReceivedThrough = 0;
  while (records?.has(contiguousReceivedThrough + 1) === true) contiguousReceivedThrough += 1;
  const missingRanges = missingSequenceRanges(records, highestReceivedSequence);
  let digest = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
  for (let sequence = 1; sequence <= contiguousReceivedThrough; sequence += 1) {
    const record = records?.get(sequence);
    if (record === undefined) throw new TypeError("contiguous execution fact disappeared");
    const envelope = encodeDrainStreamEnvelope("execution_fact", record.fact);
    digest = createHash("sha256").update(encodeDrainChainStepInput(digest, envelope)).digest();
  }
  return { contiguousReceivedThrough, highestReceivedSequence, missingRanges, rollingDigest: digest.toString("base64url") };
}

function missingSequenceRanges(records: Map<number, AcceptedFactRecord> | undefined, highest: number) {
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
