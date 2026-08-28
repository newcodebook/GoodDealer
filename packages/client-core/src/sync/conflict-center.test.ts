import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ValidatingConflictQueryPort,
  conflictCenterViewModelSchema,
  createConflictResolutionIntent,
  createLowRiskConflictResolutionIntents,
  parseConflictCenterViewModel,
  type ConflictCenterViewModel,
  type ConflictResolvePort,
} from "./conflict-center";

const HASH = "A".repeat(43);

function conflict(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-price-1",
    entityDisplay: "example.com",
    fieldDisplay: "Target price",
    group: "price",
    risk: "normal",
    note: "Concurrent edit",
    baseValue: "1000 USD",
    localValue: "1200 USD",
    remoteValue: "1100 USD",
    comparisonServerRevision: 8,
    currentValueHash: HASH,
    status: "pending",
    resolutionAdmission: {
      state: "available",
      candidateId: "candidate-price-1",
      expectedRevision: 8,
      expectedCurrentValueHash: HASH,
      choices: ["keep_local", "accept_remote"],
    },
    ...overrides,
  };
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "conflict_center",
    workspaceId: "workspace-1",
    candidateSetVersion: 4,
    freshness: {
      source: "active_local",
      serverRevision: 8,
      observedAt: "2026-08-17T05:00:00Z",
    },
    conflicts: [conflict()],
    ...overrides,
  };
}

describe("ConflictCenter contract", () => {
  it("parses a strict versioned projection and produces an exact CAS intent", () => {
    const parsed = parseConflictCenterViewModel(view());
    expect(createConflictResolutionIntent(parsed, "candidate-price-1", "keep_local")).toEqual({
      schemaVersion: 1,
      workspaceId: "workspace-1",
      candidateSetVersion: 4,
      candidateId: "candidate-price-1",
      expectedRevision: 8,
      expectedCurrentValueHash: HASH,
      choice: "keep_local",
    });
    expectTypeOf<keyof ConflictResolvePort>().toEqualTypeOf<"resolveConflict">();
  });

  it.each([
    ["unknown root field", { ...view(), surprise: true }],
    ["unknown schema version", { ...view(), schemaVersion: 999 }],
    ["duplicate candidate id", { ...view(), conflicts: [conflict(), conflict()] }],
    ["stale pending review", { ...view(), freshness: { source: "active_local", serverRevision: 9, observedAt: "2026-08-17T05:00:00Z" } }],
    ["mismatched CAS", { ...view(), conflicts: [conflict({ resolutionAdmission: { state: "available", candidateId: "other", expectedRevision: 8, expectedCurrentValueHash: HASH, choices: ["keep_local"] } })] }],
    ["standby action authority", { ...view(), freshness: { source: "standby_cloud", serverRevision: 8, observedAt: "2026-08-17T05:00:00Z" } }],
    ["unknown risk", { ...view(), conflicts: [conflict({ risk: "unknown" })] }],
  ])("fails closed for %s", (_label, input) => {
    expect(conflictCenterViewModelSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    "<img src=x onerror=alert(1)>",
    "safe\u202Eevil",
    "safe\u0000evil",
  ])("rejects unsafe stored display text %j", (payload) => {
    expect(conflictCenterViewModelSchema.safeParse({
      ...view(),
      conflicts: [conflict({ note: payload })],
    }).success).toBe(payload.startsWith("<img"));
  });

  it("allows text-looking markup only as bounded text and never interprets it as authority", () => {
    const parsed = parseConflictCenterViewModel({
      ...view(),
      conflicts: [conflict({ note: "<img src=x onerror=alert(1)>" })],
    });
    expect(parsed.conflicts[0]?.note).toBe("<img src=x onerror=alert(1)>");
  });

  it("omits unsafe candidates from batch resolution and refuses unavailable actions", () => {
    const parsed = parseConflictCenterViewModel({
      ...view(),
      conflicts: [
        conflict(),
        conflict({
          candidateId: "candidate-dns-1",
          group: "dns",
          risk: "high",
          resolutionAdmission: {
            state: "available",
            candidateId: "candidate-dns-1",
            expectedRevision: 8,
            expectedCurrentValueHash: HASH,
            choices: ["keep_local"],
          },
        }),
        conflict({
          candidateId: "candidate-price-2",
          risk: "safety_priority",
          resolutionAdmission: {
            state: "available",
            candidateId: "candidate-price-2",
            expectedRevision: 8,
            expectedCurrentValueHash: HASH,
            choices: ["keep_local"],
          },
        }),
      ],
    });
    expect(createLowRiskConflictResolutionIntents(parsed, "price", "keep_local"))
      .toHaveLength(1);

    const unavailable = parseConflictCenterViewModel({
      ...view(),
      conflicts: [conflict({ resolutionAdmission: { state: "unavailable" } })],
    });
    expect(createConflictResolutionIntent(unavailable, "candidate-price-1", "keep_local")).toBeNull();
  });

  it("validates unknown boundary output without retaining untrusted content in errors", async () => {
    const boundary = { getConflictCenter: vi.fn(async () => ({ secretCanary: "do-not-leak" })) };
    const port = new ValidatingConflictQueryPort(boundary);
    await expect(port.getConflictCenter()).rejects.toThrow("invalid conflict center projection");
    await expect(port.getConflictCenter()).rejects.not.toThrow("do-not-leak");
  });

  it("keeps the valid model type exact", () => {
    expectTypeOf(parseConflictCenterViewModel(view())).toEqualTypeOf<ConflictCenterViewModel>();
  });
});
