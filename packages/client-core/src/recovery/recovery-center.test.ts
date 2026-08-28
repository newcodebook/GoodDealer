import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ValidatingRecoveryQueryPort,
  createLowRiskRecoveryApplyIntents,
  createRecoveryCandidateDecisionIntent,
  parseRecoveryCenterViewModel,
  recoveryCenterViewModelSchema,
  type LateExecutionEvent,
  type RecoveryCandidateDecisionPort,
  type RecoveryCenterViewModel,
  type RestoreCandidate,
  type StaleDeviceCandidate,
} from "./recovery-center";

const HASH = "B".repeat(43);
const DIGEST = "C".repeat(43);

function admission(candidateId: string) {
  return { state: "available", candidateId, expectedRevision: 12, expectedCurrentValueHash: HASH };
}

function stale(overrides: Record<string, unknown> = {}) {
  return {
    kind: "stale_device_candidate",
    candidateId: "stale-1",
    entityDisplay: "example.com",
    fieldDisplay: "Target price",
    baseValue: "1000 USD",
    candidateValue: "1200 USD",
    currentValue: "1100 USD",
    comparisonServerRevision: 12,
    currentValueHash: HASH,
    risk: "normal",
    status: "pending",
    admission: admission("stale-1"),
    sourceDeviceDisplay: "Previous laptop",
    sourceEpoch: 4,
    ...overrides,
  };
}

function restore(overrides: Record<string, unknown> = {}) {
  return {
    kind: "restore_candidate",
    candidateId: "restore-1",
    entityDisplay: "example.net",
    fieldDisplay: "Nameservers",
    baseValue: "ns1.old.test",
    candidateValue: "ns1.backup.test",
    currentValue: "ns1.cloud.test",
    comparisonServerRevision: 12,
    currentValueHash: HASH,
    risk: "high",
    status: "pending",
    admission: admission("restore-1"),
    backupId: "backup-1",
    manifestDigest: DIGEST,
    backupCreatedAt: "2026-08-16T05:00:00Z",
    backupRevision: 9,
    ...overrides,
  };
}

function late(overrides: Record<string, unknown> = {}) {
  return {
    kind: "late_execution_event",
    eventId: "event-1",
    entityDisplay: "example.org",
    operationDisplay: "Listing update",
    sourceDeviceDisplay: "Previous laptop",
    sourceEpoch: 3,
    occurredAt: "2026-08-16T04:00:00Z",
    receivedAt: "2026-08-16T05:00:00Z",
    evidenceLevel: "verified",
    ...overrides,
  };
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "recovery_center",
    workspaceId: "workspace-1",
    surface: "active",
    candidateSetVersion: 7,
    freshness: { source: "cloud", serverRevision: 12, observedAt: "2026-08-17T05:00:00Z" },
    staleDeviceCandidates: [stale()],
    restoreCandidates: [restore()],
    lateExecutionEvents: [late()],
    ...overrides,
  };
}

describe("RecoveryCenter contract", () => {
  it("keeps all three source kinds distinct and late events read-only", () => {
    const parsed = parseRecoveryCenterViewModel(view());
    expectTypeOf(parsed.staleDeviceCandidates[0]).toEqualTypeOf<StaleDeviceCandidate | undefined>();
    expectTypeOf(parsed.restoreCandidates[0]).toEqualTypeOf<RestoreCandidate | undefined>();
    expectTypeOf(parsed.lateExecutionEvents[0]).toEqualTypeOf<LateExecutionEvent | undefined>();
    expect(parsed.lateExecutionEvents[0]).not.toHaveProperty("admission");
    expect(parsed.lateExecutionEvents[0]).not.toHaveProperty("candidateId");
    expectTypeOf<keyof RecoveryCandidateDecisionPort>().toEqualTypeOf<"decideCandidate">();
  });

  it("creates an exact candidateId/revision/value-hash CAS decision", () => {
    const parsed = parseRecoveryCenterViewModel(view());
    expect(createRecoveryCandidateDecisionIntent(parsed, "stale-1", "apply_candidate")).toEqual({
      schemaVersion: 1,
      decision: "apply_candidate",
      workspaceId: "workspace-1",
      candidateSetVersion: 7,
      candidateId: "stale-1",
      expectedRevision: 12,
      expectedCurrentValueHash: HASH,
    });
  });

  it.each([
    ["unknown root", { ...view(), extra: true }],
    ["wrong kind fields", { ...view(), restoreCandidates: [{ ...restore(), kind: "stale_device_candidate" }] }],
    ["duplicate candidates", { ...view(), restoreCandidates: [{ ...restore(), candidateId: "stale-1", admission: admission("stale-1") }] }],
    ["mismatched CAS", { ...view(), staleDeviceCandidates: [stale({ admission: admission("other") })] }],
    ["duplicate late events", { ...view(), lateExecutionEvents: [late(), late()] }],
    ["receipt before occurrence", { ...view(), lateExecutionEvents: [late({ receivedAt: "2026-08-16T03:00:00Z" })] }],
    ["stale pending", { ...view(), freshness: { source: "cloud", serverRevision: 13, observedAt: "2026-08-17T05:00:00Z" } }],
    ["standby admission", { ...view(), surface: "standby" }],
    ["isolated source on active", { ...view(), freshness: { source: "isolated_recovery", serverRevision: 12, observedAt: "2026-08-17T05:00:00Z" } }],
    ["unknown evidence", { ...view(), lateExecutionEvents: [late({ evidenceLevel: "trusted" })] }],
    ["late event action authority", { ...view(), lateExecutionEvents: [late({ action: "apply_candidate" })] }],
    ["bidi content", { ...view(), lateExecutionEvents: [late({ operationDisplay: "safe\u202Eevil" })] }],
  ])("fails closed for %s", (_label, input) => {
    expect(recoveryCenterViewModelSchema.safeParse(input).success).toBe(false);
  });

  it("requires renewed review and excludes high/safety candidates from batch apply", () => {
    const parsed = parseRecoveryCenterViewModel({
      ...view(),
      staleDeviceCandidates: [
        stale(),
        stale({ candidateId: "stale-high", risk: "high", admission: admission("stale-high") }),
        stale({ candidateId: "stale-safety", risk: "safety_priority", admission: admission("stale-safety") }),
      ],
    });
    expect(createLowRiskRecoveryApplyIntents(parsed, "stale_device_candidate")).toHaveLength(1);

    const staleReview = parseRecoveryCenterViewModel({
      ...view(),
      staleDeviceCandidates: [stale({ status: "review_stale", admission: { state: "unavailable" }, comparisonServerRevision: 11 })],
    });
    expect(createRecoveryCandidateDecisionIntent(staleReview, "stale-1", "apply_candidate")).toBeNull();
  });

  it("validates unknown boundary output with a non-reflective error", async () => {
    const port = new ValidatingRecoveryQueryPort({
      getRecoveryCenter: vi.fn(async () => ({ recoverySecret: "do-not-leak" })),
    });
    await expect(port.getRecoveryCenter()).rejects.toThrow("invalid recovery center projection");
    await expect(port.getRecoveryCenter()).rejects.not.toThrow("do-not-leak");
  });

  it("rejects restored execution authority and queue state", () => {
    for (const forbidden of [
      { workerLease: "lease-1" },
      { activeLeaseEpoch: 99 },
      { approvedOperation: "approval-1" },
      { automationExecutionTicket: "ticket-1" },
      { queue: [] },
      { outbox: [] },
    ]) {
      expect(recoveryCenterViewModelSchema.safeParse({ ...view(), ...forbidden }).success).toBe(false);
    }
  });

  it("keeps the valid model type exact", () => {
    expectTypeOf(parseRecoveryCenterViewModel(view())).toEqualTypeOf<RecoveryCenterViewModel>();
  });
});
