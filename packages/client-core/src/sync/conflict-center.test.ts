import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ValidatingConflictQueryPort,
  conflictCenterViewModelSchema,
  conflictResolutionIntentSchema,
  createConflictResolutionIntent,
  parseConflictCenterViewModel,
  type ConflictCenterViewModel,
  type ConflictResolvePort,
} from "./conflict-center";

const HASH = "a".repeat(64);

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
      expectedCandidateVersion: 1,
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
    readGeneration: 3,
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
      expectedReadGeneration: 3,
      candidateSetVersion: 4,
      candidateId: "candidate-price-1",
      expectedRevision: 8,
      expectedCandidateVersion: 1,
      expectedCurrentValueHash: HASH,
      choice: "keep_local",
    });
    expectTypeOf<keyof ConflictResolvePort>().toEqualTypeOf<"resolveConflict">();
  });

  it("allows only accept_remote for remote-delete candidates", () => {
    expect(conflictCenterViewModelSchema.safeParse({
      ...view(),
      conflicts: [conflict({
        candidateKind: "delete_conflict",
        resolutionAdmission: {
          state: "available",
          candidateId: "candidate-price-1",
          expectedRevision: 8,
          expectedCandidateVersion: 1,
          expectedCurrentValueHash: HASH,
          choices: ["keep_local"],
        },
      })],
    }).success).toBe(false);
  });

  it("accepts cross-revision open candidates only as stale, unavailable reviews", () => {
    const parsed = parseConflictCenterViewModel({
      ...view({
        candidateSetVersion: 9,
        freshness: { source: "active_local", serverRevision: 9, observedAt: "2026-08-17T05:00:00Z" },
      }),
      conflicts: [
        conflict({
          candidateId: "candidate-price-old",
          comparisonServerRevision: 8,
          resolutionAdmission: { state: "unavailable" },
          status: "review_stale",
        }),
        conflict({
          candidateId: "candidate-price-current",
          comparisonServerRevision: 9,
          resolutionAdmission: {
            state: "available",
            candidateId: "candidate-price-current",
            expectedRevision: 9,
            expectedCandidateVersion: 1,
            expectedCurrentValueHash: HASH,
            choices: ["keep_local", "accept_remote"],
          },
        }),
      ],
    });

    expect(parsed.conflicts[0]?.status).toBe("review_stale");
    expect(parsed.conflicts[0]?.resolutionAdmission.state).toBe("unavailable");
    expect(createConflictResolutionIntent(parsed, "candidate-price-old", "keep_local")).toBeNull();
    expect(createConflictResolutionIntent(parsed, "candidate-price-current", "keep_local")).not.toBeNull();
  });

  it("requires an explicit candidate version at every resolution boundary", async () => {
    const admissionWithoutCandidateVersion = {
      state: "available",
      candidateId: "candidate-price-1",
      expectedRevision: 8,
      expectedCurrentValueHash: HASH,
      choices: ["keep_local", "accept_remote"],
    };
    const hostileView = view({
      conflicts: [conflict({ resolutionAdmission: admissionWithoutCandidateVersion })],
    });
    expect(conflictCenterViewModelSchema.safeParse(hostileView).success).toBe(false);

    const port = new ValidatingConflictQueryPort({
      getConflictCenter: vi.fn(async () => hostileView),
    });
    await expect(port.getConflictCenter()).rejects.toThrow("invalid conflict center projection");

    expect(conflictResolutionIntentSchema.safeParse({
      schemaVersion: 1,
      expectedReadGeneration: 3,
      candidateSetVersion: 4,
      candidateId: "candidate-price-1",
      expectedRevision: 8,
      expectedCurrentValueHash: HASH,
      choice: "keep_local",
    }).success).toBe(false);

    const parsed = parseConflictCenterViewModel(view());
    const forged = {
      ...parsed,
      conflicts: [{
        ...parsed.conflicts[0],
        resolutionAdmission: admissionWithoutCandidateVersion,
      }],
    } as unknown as ConflictCenterViewModel;
    expect(createConflictResolutionIntent(forged, "candidate-price-1", "keep_local")).toBeNull();

    expect(parsed.conflicts[0]?.resolutionAdmission).toMatchObject({
      state: "available",
      expectedCandidateVersion: 1,
    });
    expect(createConflictResolutionIntent(parsed, "candidate-price-1", "keep_local"))
      .toMatchObject({ expectedCandidateVersion: 1 });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects actionable candidate-set version %s from Host views and intents",
    async (candidateSetVersion) => {
      const hostileView = view({ candidateSetVersion });
      expect(conflictCenterViewModelSchema.safeParse(hostileView).success).toBe(false);

      const port = new ValidatingConflictQueryPort({
        getConflictCenter: vi.fn(async () => hostileView),
      });
      await expect(port.getConflictCenter()).rejects.toThrow("invalid conflict center projection");

      expect(conflictResolutionIntentSchema.safeParse({
        schemaVersion: 1,
        expectedReadGeneration: 3,
        candidateSetVersion,
        candidateId: "candidate-price-1",
        expectedRevision: 8,
        expectedCandidateVersion: 1,
        expectedCurrentValueHash: HASH,
        choice: "keep_local",
      }).success).toBe(false);

      const forged = {
        ...parseConflictCenterViewModel(view()),
        candidateSetVersion,
      } as ConflictCenterViewModel;
      expect(createConflictResolutionIntent(forged, "candidate-price-1", "keep_local")).toBeNull();
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects actionable expected revision %s from Host views and constructors",
    async (expectedRevision) => {
      const hostileConflict = conflict({
        comparisonServerRevision: expectedRevision,
        resolutionAdmission: {
          state: "available",
          candidateId: "candidate-price-1",
          expectedRevision,
          expectedCandidateVersion: 1,
          expectedCurrentValueHash: HASH,
          choices: ["keep_local", "accept_remote"],
        },
      });
      const hostileView = view({
        freshness: {
          source: "active_local",
          serverRevision: expectedRevision,
          observedAt: "2026-08-17T05:00:00Z",
        },
        conflicts: [hostileConflict],
      });
      const port = new ValidatingConflictQueryPort({
        getConflictCenter: vi.fn(async () => hostileView),
      });
      await expect(port.getConflictCenter()).rejects.toThrow("invalid conflict center projection");

      expect(conflictResolutionIntentSchema.safeParse({
        schemaVersion: 1,
        expectedReadGeneration: 3,
        candidateSetVersion: 4,
        candidateId: "candidate-price-1",
        expectedRevision,
        expectedCandidateVersion: 1,
        expectedCurrentValueHash: HASH,
        choice: "keep_local",
      }).success).toBe(false);

      const base = parseConflictCenterViewModel(view());
      const current = base.conflicts[0];
      expect(current).toBeDefined();
      const forged = {
        ...base,
        conflicts: [{
          ...current,
          comparisonServerRevision: expectedRevision,
          resolutionAdmission: {
            ...current?.resolutionAdmission,
            state: "available",
            expectedRevision,
          },
        }],
      } as ConflictCenterViewModel;
      expect(createConflictResolutionIntent(forged, "candidate-price-1", "keep_local")).toBeNull();
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects actionable candidate version %s from Host views and constructors",
    async (expectedCandidateVersion) => {
      const hostileConflict = conflict({
        resolutionAdmission: {
          state: "available",
          candidateId: "candidate-price-1",
          expectedRevision: 8,
          expectedCandidateVersion,
          expectedCurrentValueHash: HASH,
          choices: ["keep_local", "accept_remote"],
        },
      });
      const hostileView = view({ conflicts: [hostileConflict] });
      const port = new ValidatingConflictQueryPort({
        getConflictCenter: vi.fn(async () => hostileView),
      });
      await expect(port.getConflictCenter()).rejects.toThrow("invalid conflict center projection");

      expect(conflictResolutionIntentSchema.safeParse({
        schemaVersion: 1,
        expectedReadGeneration: 3,
        candidateSetVersion: 4,
        candidateId: "candidate-price-1",
        expectedRevision: 8,
        expectedCandidateVersion,
        expectedCurrentValueHash: HASH,
        choice: "keep_local",
      }).success).toBe(false);

      const base = parseConflictCenterViewModel(view());
      const current = base.conflicts[0];
      expect(current).toBeDefined();
      const forged = {
        ...base,
        conflicts: [{
          ...current,
          resolutionAdmission: {
            ...current?.resolutionAdmission,
            state: "available",
            expectedCandidateVersion,
          },
        }],
      } as ConflictCenterViewModel;
      expect(createConflictResolutionIntent(forged, "candidate-price-1", "keep_local")).toBeNull();
    },
  );

  it("allows revision-zero empty and non-actionable views without creating authority", () => {
    const empty = parseConflictCenterViewModel(view({
      candidateSetVersion: 0,
      freshness: {
        source: "active_local",
        serverRevision: 0,
        observedAt: "2026-08-17T05:00:00Z",
      },
      conflicts: [],
    }));
    expect(empty.candidateSetVersion).toBe(0);
    expect(createConflictResolutionIntent(empty, "candidate-price-1", "keep_local")).toBeNull();

    const reviewed = parseConflictCenterViewModel(view({
      candidateSetVersion: 0,
      freshness: {
        source: "active_local",
        serverRevision: 0,
        observedAt: "2026-08-17T05:00:00Z",
      },
      conflicts: [conflict({
        comparisonServerRevision: 0,
        status: "resolved_local",
        resolutionAdmission: { state: "unavailable" },
      })],
    }));
    expect(createConflictResolutionIntent(reviewed, "candidate-price-1", "keep_local")).toBeNull();
  });

  it("keeps candidate-set CAS exact across refreshed views", () => {
    const first = parseConflictCenterViewModel(view({ candidateSetVersion: 4 }));
    const refreshed = parseConflictCenterViewModel(view({ candidateSetVersion: 5 }));
    expect(createConflictResolutionIntent(first, "candidate-price-1", "keep_local"))
      .toMatchObject({ candidateSetVersion: 4 });
    expect(createConflictResolutionIntent(refreshed, "candidate-price-1", "keep_local"))
      .toMatchObject({ candidateSetVersion: 5 });
  });

  it("accepts maximum safe positive actionable CAS values exactly", () => {
    const maximum = parseConflictCenterViewModel(view({
      candidateSetVersion: Number.MAX_SAFE_INTEGER,
      freshness: {
        source: "active_local",
        serverRevision: Number.MAX_SAFE_INTEGER,
        observedAt: "2026-08-17T05:00:00Z",
      },
      conflicts: [conflict({
        comparisonServerRevision: Number.MAX_SAFE_INTEGER,
        resolutionAdmission: {
          state: "available",
          candidateId: "candidate-price-1",
          expectedRevision: Number.MAX_SAFE_INTEGER,
          expectedCandidateVersion: Number.MAX_SAFE_INTEGER,
          expectedCurrentValueHash: HASH,
          choices: ["keep_local", "accept_remote"],
        },
      })],
    }));
    expect(createConflictResolutionIntent(maximum, "candidate-price-1", "keep_local"))
      .toMatchObject({
        candidateSetVersion: Number.MAX_SAFE_INTEGER,
        expectedRevision: Number.MAX_SAFE_INTEGER,
        expectedCandidateVersion: Number.MAX_SAFE_INTEGER,
      });
  });

  it("rejects accessors without invoking hostile code", () => {
    let invoked = false;
    const hostile = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() { invoked = true; return 1; },
    });
    expect(() => parseConflictCenterViewModel(hostile)).toThrow("invalid conflict center projection");
    expect(invoked).toBe(false);
  });

  it.each([
    ["unknown root field", { ...view(), surprise: true }],
    ["unknown schema version", { ...view(), schemaVersion: 999 }],
    ["duplicate candidate id", { ...view(), conflicts: [conflict(), conflict()] }],
    ["stale pending review", { ...view(), freshness: { source: "active_local", serverRevision: 9, observedAt: "2026-08-17T05:00:00Z" } }],
    ["mismatched CAS", { ...view(), conflicts: [conflict({ resolutionAdmission: { state: "available", candidateId: "other", expectedRevision: 8, expectedCandidateVersion: 1, expectedCurrentValueHash: HASH, choices: ["keep_local"] } })] }],
    ["continuation action authority", { ...view(), freshness: { source: "local_continuation", serverRevision: 8, observedAt: "2026-08-17T05:00:00Z" } }],
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

  it("refuses unavailable manual actions", () => {
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
