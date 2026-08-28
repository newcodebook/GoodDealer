import { createHash } from "node:crypto";

export { PostgresExecutionFactDrainLedger } from "./postgres-drain-ledger";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
  executionFactSchema,
  type ExecutionFact,
} from "@gooddealer/protocol/execution-events";

import type { DrainSealParticipantPort, DrainStreamWatermarkPort } from "../devices/ports";
import type { WorkspaceTenantScope } from "../workspace/tenant-scope";
import { workspaceTenantKey } from "../workspace/tenant-scope";

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
  readonly canonicalEnvelope: Uint8Array;
  readonly receivedAt: string;
  readonly classification: "current" | "late";
}

/**
 * Server-side classification and read model for already-adjudicated facts. Late facts stay in the
 * evidence ledger and cannot produce mutations, candidates, Desired/Observed changes, or platform
 * side effects. A later seal violation is quarantined and never invalidates an accepted handoff.
 */
export class InMemoryExecutionLedger implements DrainStreamWatermarkPort, DrainSealParticipantPort<"execution_fact"> {
  readonly #ingestVerification: ExecutionFactIngestVerificationPort;
  readonly #records = new Map<string, Map<number, AcceptedFactRecord>>();
  readonly #seals = new Map<string, number>();
  readonly #quarantine = new Map<string, {
    readonly fact: ExecutionFact | null;
    readonly reason: ExecutionFactQuarantineReason;
  }[]>();

  constructor(options: {
    readonly ingestVerification?: ExecutionFactIngestVerificationPort;
  } = {}) {
    this.#ingestVerification = options.ingestVerification ?? new RefusingExecutionFactIngestVerification();
  }

  installAcceptedDrainSeal(scope: WorkspaceTenantScope, input: ExecutionDomain & {
    readonly stream: "execution_fact";
    readonly lastAssignedSequence: number;
  }): { rollback(): void } {
    if (input.stream !== "execution_fact") throw new TypeError("execution ledger serves only execution facts");
    const { lastAssignedSequence } = input;
    if (!Number.isSafeInteger(lastAssignedSequence) || lastAssignedSequence < 0) {
      throw new TypeError("accepted drain seal sequence must be unsigned");
    }
    const key = domainKey(scope, input);
    const existing = this.#seals.get(key);
    if (existing !== undefined && existing !== lastAssignedSequence) {
      throw new TypeError("an accepted handoff proof is immutable");
    }
    this.#seals.set(key, lastAssignedSequence);
    return { rollback: () => { if (existing === undefined) this.#seals.delete(key); } };
  }

  recordAcceptedDrainSeal(
    scope: WorkspaceTenantScope,
    domain: ExecutionDomain,
    lastAssignedSequence: number,
  ): { rollback(): void } {
    return this.installAcceptedDrainSeal(scope, { ...domain, stream: "execution_fact", lastAssignedSequence });
  }

  /**
   * Classification begins only after the verification port has adjudicated the fact. An accepting
   * port must derive heldActiveLeaseEpoch and boundCredentialEpoch from the same authoritative
   * device/lease binding; they are conjunctive evidence, not caller assertions.
   */
  async appendAdjudicatedFact(
    scope: WorkspaceTenantScope,
    input: AdjudicatedExecutionFactInput,
  ): Promise<ExecutionFactAdjudication> {
    const parsed = executionFactSchema.safeParse(input.fact);
    if (!parsed.success) return this.#quarantineFact(scope, null, "signature");
    const fact = parsed.data;
    if (fact.workspaceId !== scope.workspaceId) return this.#quarantineFact(scope, fact, "authorization");
    const key = domainKey(scope, fact);
    const verification = await this.#ingestVerification.verifyExecutionFact({
      fact,
      receivedAt: input.receivedAt,
    });
    if (!verification.verified) return this.#quarantineFact(scope, fact, "signature");
    if (
      verification.heldActiveLeaseEpoch === null ||
      verification.heldActiveLeaseEpoch !== fact.activeLeaseEpoch ||
      verification.boundCredentialEpoch === null ||
      verification.boundCredentialEpoch !== fact.credentialEpoch
    ) {
      return this.#quarantineFact(scope, fact, "epoch_unknown");
    }
    if (
      verification.trustedTime !== "proven" ||
      verification.offlineExecuteUntil === null ||
      fact.requestStartBoundary > verification.offlineExecuteUntil ||
      fact.occurredAt > verification.offlineExecuteUntil
    ) {
      return this.#quarantineFact(scope, fact, "time_unprovable");
    }
    if (verification.authorization !== "consistent") return this.#quarantineFact(scope, fact, "authorization");
    if (verification.removalBoundary === "passed") return this.#quarantineFact(scope, fact, "removal_boundary");

    const sealedThrough = this.#seals.get(key);
    const records = this.#records.get(key);
    const existing = records?.get(fact.executionFactSequence);
    const canonicalEnvelope = encodeDrainStreamEnvelope("execution_fact", fact);
    if (existing !== undefined) {
      if (Buffer.from(existing.canonicalEnvelope).equals(Buffer.from(canonicalEnvelope))) {
        if (existing.classification === "late" && sealedThrough === undefined) {
          return this.#quarantineFact(scope, fact, "sequence_replay");
        }
        return { outcome: "accepted", classification: existing.classification, duplicate: true };
      }
      return this.#quarantineFact(scope, fact, "sequence_replay");
    }
    if (sealedThrough !== undefined) {
      return this.#quarantineFact(scope, fact, "drain_seal_violation");
    }

    const classification = fact.activeLeaseEpoch < input.currentLeaseEpoch ? "late" : "current";
    const target = records ?? new Map<number, AcceptedFactRecord>();
    target.set(fact.executionFactSequence, { fact, canonicalEnvelope, receivedAt: input.receivedAt, classification });
    this.#records.set(key, target);
    return { outcome: "accepted", classification, duplicate: false };
  }

  quarantined(scope: WorkspaceTenantScope): readonly { readonly fact: ExecutionFact | null; readonly reason: ExecutionFactQuarantineReason }[] {
    return [...(this.#quarantine.get(workspaceTenantKey(scope)) ?? [])].map((record) => ({ ...record }));
  }

  accepted(scope: WorkspaceTenantScope): readonly AcceptedFactRecord[] {
    const prefix = `${workspaceTenantKey(scope)}\u0000`;
    return [...this.#records]
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([, records]) => [...records.values()]);
  }

  async readWatermark(
    scope: WorkspaceTenantScope,
    domain: ExecutionDomain & { readonly stream: "execution_fact" },
  ) {
    if (domain.stream !== "execution_fact") throw new TypeError("execution ledger serves only execution facts");
    const records = this.#records.get(domainKey(scope, domain));
    return projectWatermark(records);
  }

  #quarantineFact(
    scope: WorkspaceTenantScope,
    fact: ExecutionFact | null,
    reason: ExecutionFactQuarantineReason,
  ): ExecutionFactAdjudication {
    const key = workspaceTenantKey(scope);
    const records = this.#quarantine.get(key) ?? [];
    records.push({ fact, reason });
    this.#quarantine.set(key, records);
    return { outcome: "quarantined", reason };
  }
}

function domainKey(scope: WorkspaceTenantScope, domain: ExecutionDomain): string {
  return `${workspaceTenantKey(scope)}\u0000${domain.sourceDeviceId}\u0000${domain.activeLeaseEpoch}`;
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
    digest = createHash("sha256").update(encodeDrainChainStepInput(digest, record.canonicalEnvelope)).digest();
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
