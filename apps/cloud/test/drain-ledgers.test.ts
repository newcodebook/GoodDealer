import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
  executionFactSchema,
  type ExecutionFact,
} from "@gooddealer/protocol/execution-events";
import { describe, expect, expectTypeOf, it } from "vitest";

import { InMemoryDeviceAuditLedger } from "../src/modules/audit/index";
import {
  InMemoryExecutionLedger,
  RefusingExecutionFactIngestVerification,
  type ExecutionFactIngestVerification,
  type ExecutionFactIngestVerificationPort,
} from "../src/modules/execution-ledger/index";
import { InMemoryMutationDrainWatermarks } from "../src/modules/workspace/mutations/index";

const executionFact = executionFactSchema.parse(JSON.parse(readFileSync(
  new URL("../../../packages/protocol/test-vectors/execution-events/valid/execution-fact.json", import.meta.url),
  "utf8",
)));
const workspaceAudit = JSON.parse(readFileSync(
  new URL("../../../packages/protocol/test-vectors/execution-events/valid/device-audit-workspace.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;
const accountAudit = JSON.parse(readFileSync(
  new URL("../../../packages/protocol/test-vectors/execution-events/valid/device-audit-account.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;

const domain = { workspaceId: "workspace-a", sourceDeviceId: "device-a", activeLeaseEpoch: 2 } as const;

function fact(sequence: number, overrides: Partial<ExecutionFact> = {}) {
  return executionFactSchema.parse({
    ...structuredClone(executionFact),
    executionFactId: `execution-fact-${sequence}`,
    executionSequence: sequence,
    ...overrides,
  });
}

function adjudicationInput(value: ExecutionFact, currentLeaseEpoch = 2) {
  return {
    fact: value,
    receivedAt: "2026-08-14T18:01:00Z",
    currentLeaseEpoch,
  } as const;
}

function acceptingVerification(
  overrides: Partial<Extract<ExecutionFactIngestVerification, { readonly verified: true }>> = {},
): ExecutionFactIngestVerificationPort {
  return {
    verifyExecutionFact: async () => ({
      verified: true,
      heldActiveLeaseEpoch: 2,
      boundCredentialEpoch: 3,
      offlineExecuteUntil: "2026-08-14T19:00:00Z",
      trustedTime: "proven",
      authorization: "consistent",
      removalBoundary: "clear",
      ...overrides,
    }),
  };
}

function executionLedger(
  overrides: Partial<Extract<ExecutionFactIngestVerification, { readonly verified: true }>> = {},
) {
  return new InMemoryExecutionLedger({ ingestVerification: acceptingVerification(overrides) });
}

describe("per-module drain watermark ledgers", () => {
  it("P17-INV-17 keeps highestSeen diagnostic while a gap blocks the contiguous mutation digest", async () => {
    const ledger = new InMemoryMutationDrainWatermarks();
    const first = new TextEncoder().encode("mutation-1");
    const second = new TextEncoder().encode("mutation-2");
    ledger.recordLandedEnvelope(domain, 2, second);
    expect(await ledger.readWatermark({ ...domain, stream: "mutation" })).toEqual({
      contiguousReceivedThrough: 0,
      highestReceivedSequence: 2,
      missingRanges: [{ fromSequence: 1, toSequence: 1 }],
      rollingDigest: DRAIN_STREAM_GENESIS_DIGEST,
    });

    ledger.recordLandedEnvelope(domain, 1, first);
    const afterFill = await ledger.readWatermark({ ...domain, stream: "mutation" });
    let expected = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
    expected = createHash("sha256").update(encodeDrainChainStepInput(expected, first)).digest();
    expected = createHash("sha256").update(encodeDrainChainStepInput(expected, second)).digest();
    expect(afterFill).toEqual({
      contiguousReceivedThrough: 2,
      highestReceivedSequence: 2,
      missingRanges: [],
      rollingDigest: expected.toString("base64url"),
    });
    ledger.recordLandedEnvelope(domain, 2, second);
    expect(await ledger.readWatermark({ ...domain, stream: "mutation" })).toEqual(afterFill);
    expect(() => ledger.recordLandedEnvelope(domain, 2, new TextEncoder().encode("rewrite"))).toThrowError(
      "a landed mutation sequence cannot be rewritten",
    );
  });

  it("P17-INV-24 excludes account-scope audit backlog from the workspace stream and chain guard", async () => {
    const ledger = new InMemoryDeviceAuditLedger();
    expect(ledger.appendAdjudicatedEvent(accountAudit)).toEqual({ outcome: "accepted", duplicate: false });
    expect(ledger.accountBacklog()).toBe(1);

    const event1 = { ...workspaceAudit, auditEventId: "audit-workspace-1", auditSequence: 1 };
    expect(ledger.appendAdjudicatedEvent(event1)).toEqual({ outcome: "accepted", duplicate: false });
    const watermark = await ledger.readWatermark({ ...domain, stream: "device_audit" });
    expect(watermark).toMatchObject({
      contiguousReceivedThrough: 1,
      highestReceivedSequence: 1,
      missingRanges: [],
    });
    expect(await ledger.readChainRegistration(domain)).toMatchObject({
      chainId: workspaceAudit.chainId,
      headSequence: 1,
      forked: false,
    });
  });

  it("P17-INV-4 detects a second workspace audit chain without merging it", async () => {
    const ledger = new InMemoryDeviceAuditLedger();
    ledger.appendAdjudicatedEvent({ ...workspaceAudit, auditEventId: "audit-workspace-1", auditSequence: 1 });
    ledger.appendAdjudicatedEvent({
      ...workspaceAudit,
      auditEventId: "audit-workspace-2",
      auditSequence: 2,
      chainId: "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ",
    });
    expect(await ledger.readChainRegistration(domain)).toMatchObject({ headSequence: 2, forked: true });
  });
});

describe("LateExecutionEvent classification and drain seals", () => {
  it("P17-INV-30 accepts a stale-epoch fact as late when no handoff proof sealed the epoch", async () => {
    const ledger = executionLedger();
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(1), 3))).toEqual({
      outcome: "accepted",
      classification: "late",
      duplicate: false,
    });
    expect(ledger.accepted()[0]).toMatchObject({ classification: "late", fact: { activeLeaseEpoch: 2 } });
    expect(await ledger.readWatermark({ ...domain, stream: "execution_fact" })).toMatchObject({
      contiguousReceivedThrough: 1,
      highestReceivedSequence: 1,
      missingRanges: [],
    });
  });

  it("P17-INV-30/31 quarantines beyond the accepted seal without invalidating or rolling it back", async () => {
    const ledger = executionLedger();
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(1)))).toMatchObject({ outcome: "accepted" });
    ledger.recordAcceptedDrainSeal(domain, 1);
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(2), 3))).toEqual({
      outcome: "quarantined",
      reason: "drain_seal_violation",
    });
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(1), 3))).toEqual({
      outcome: "accepted",
      classification: "current",
      duplicate: true,
    });
    expect(ledger.quarantined()).toHaveLength(1);
    expect(ledger.accepted()).toHaveLength(1);
    expect(await ledger.readWatermark({ ...domain, stream: "execution_fact" })).toMatchObject({
      contiguousReceivedThrough: 1,
      highestReceivedSequence: 1,
    });
    expect(() => ledger.recordAcceptedDrainSeal(domain, 2)).toThrowError("an accepted handoff proof is immutable");
  });

  it("P17-INV-32 keeps late facts evidence-only and exercises fail-closed quarantine reasons", async () => {
    expect(await executionLedger({ boundCredentialEpoch: null }).appendAdjudicatedFact(adjudicationInput(fact(1)))).toEqual({
      outcome: "quarantined",
      reason: "epoch_unknown",
    });
    expect(await executionLedger({ trustedTime: "unproven" }).appendAdjudicatedFact(adjudicationInput(fact(1)))).toEqual({
      outcome: "quarantined",
      reason: "time_unprovable",
    });
    expect(await executionLedger({ authorization: "inconsistent" }).appendAdjudicatedFact(adjudicationInput(fact(1)))).toEqual({
      outcome: "quarantined",
      reason: "authorization",
    });
    const ledger = executionLedger();
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(1), 3))).toMatchObject({
      outcome: "accepted",
      classification: "late",
    });
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(1), 3))).toEqual({
      outcome: "quarantined",
      reason: "sequence_replay",
    });
    expect(await executionLedger({ removalBoundary: "passed" }).appendAdjudicatedFact(adjudicationInput(fact(2)))).toEqual({
      outcome: "quarantined",
      reason: "removal_boundary",
    });
    const stored = JSON.stringify(ledger.accepted());
    expect(stored).not.toMatch(/SyncMutation|Candidate|Desired|Observed|platformSideEffect/);
  });

  it("EP-20 rejects a fact whose claimed activeLeaseEpoch was not held", async () => {
    const ledger = executionLedger({ heldActiveLeaseEpoch: 2, boundCredentialEpoch: 3 });
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(1, { activeLeaseEpoch: 99 })))).toEqual({
      outcome: "quarantined",
      reason: "epoch_unknown",
    });
    expect(ledger.accepted()).toEqual([]);
  });

  it("uses a structurally refusing ingest verifier by default", async () => {
    type Refusal = Awaited<ReturnType<RefusingExecutionFactIngestVerification["verifyExecutionFact"]>>;
    expectTypeOf<Refusal>().toEqualTypeOf<{
      readonly verified: false;
      readonly reason: "signature_verification_disabled";
    }>();

    const ledger = new InMemoryExecutionLedger();
    expect(await ledger.appendAdjudicatedFact(adjudicationInput(fact(1)))).toEqual({
      outcome: "quarantined",
      reason: "signature",
    });
    expect(ledger.accepted()).toEqual([]);
  });

  it("P17-INV-30 applies the same immutable seal to workspace audit without inventing a Late label", () => {
    const ledger = new InMemoryDeviceAuditLedger();
    ledger.appendAdjudicatedEvent({ ...workspaceAudit, auditEventId: "audit-workspace-1", auditSequence: 1 });
    ledger.recordAcceptedDrainSeal(domain, 1);
    expect(ledger.appendAdjudicatedEvent({ ...workspaceAudit, auditEventId: "audit-workspace-2", auditSequence: 2 })).toEqual({
      outcome: "quarantined",
      reason: "drain_seal_violation",
    });
    expect(JSON.stringify(ledger.quarantined())).not.toMatch(/classification|LateExecutionEvent/);
    expect(() => ledger.recordAcceptedDrainSeal(domain, 2)).toThrowError("an accepted handoff proof is immutable");
  });
});
