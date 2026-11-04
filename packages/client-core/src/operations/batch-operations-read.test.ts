import { describe, expect, it } from "vitest";

import { parseBatchOperationsRead, projectBatchOperationList, type BatchOperationRow, type BatchOperationsRead } from "./batch-operations-read";

const planned: BatchOperationRow = {
  title: "Price change",
  operationKind: "price_change",
  planPhase: "awaiting_approval",
  operationPhase: null,
  riskLevel: "standard",
  itemCount: 3,
  targetCount: 2,
  createdAt: "2026-11-03T10:00:00Z",
  completedAt: null,
  providerKinds: ["atom"],
  planned: { automatic: 2, manual: 0, unsupported: 0, conflict: 1, excluded: 0, highRisk: 0 },
  results: null,
};

const running: BatchOperationRow = {
  title: "Nameserver change",
  operationKind: "dns_change",
  planPhase: "approved",
  operationPhase: "running",
  riskLevel: "high",
  itemCount: 4,
  targetCount: 4,
  createdAt: "2026-11-02T10:00:00Z",
  completedAt: null,
  providerKinds: ["cloudflare", "spaceship"],
  planned: { automatic: 3, manual: 1, unsupported: 0, conflict: 0, excluded: 0, highRisk: 4 },
  results: {
    queued: 1, running: 0, succeeded: 2, waitingRemote: 0, manualActionRequired: 1,
    failedRetryable: 0, outcomeUnknown: 0, failedFinal: 0, cancelled: 0, rolledBack: 0,
  },
};

function read(rows: readonly BatchOperationRow[] = [planned, running], overrides: Partial<BatchOperationsRead> = {}): BatchOperationsRead {
  return {
    schemaVersion: 1,
    kind: "batch_operations",
    readGeneration: 2,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    totalRows: rows.length,
    window: { startIndex: 0, size: 200, rows },
    ...overrides,
  };
}

describe("batch operations read", () => {
  it("parses the Host window and rejects identifiers, unknown platforms and inconsistent rows", () => {
    expect(parseBatchOperationsRead(read())).toEqual(read());
    expect(() => parseBatchOperationsRead(read([{ ...planned, planId: "plan-1" } as BatchOperationRow]))).toThrow();
    expect(() => parseBatchOperationsRead(read([{ ...planned, providerKinds: ["sedo"] } as unknown as BatchOperationRow]))).toThrow();
    expect(() => parseBatchOperationsRead(read([{ ...planned, results: running.results }]))).toThrow();
    expect(() => parseBatchOperationsRead(read([{ ...running, itemCount: 5 }]))).toThrow();
    expect(() => parseBatchOperationsRead(read([{ ...planned, completedAt: "2026-11-03T11:00:00Z" }]))).toThrow();
    expect(() => parseBatchOperationsRead(read([running, planned]))).toThrow();
    expect(() => parseBatchOperationsRead(read([{ ...planned, title: "Bad\u0007" }]))).toThrow();
    expect(parseBatchOperationsRead(read([{ ...planned, itemCount: 4 }])).window.rows).toHaveLength(1);
  });

  it("projects phases, counts and progress without plan identifiers and with creation unavailable", () => {
    const view = projectBatchOperationList([read()]);
    expect(view.creationAvailability).toBe("unavailable");
    const [first, second] = view.items;
    expect(first).toMatchObject({
      id: "batch-0", phase: "awaiting_approval", targetCount: 2, platform: "Atom", ruleLabel: null, account: null,
      createdLabel: "2026-11-03", highRisk: false, plannedCounts: { automatic: 2, manual: 0, conflict: 1 }, resultCounts: null, progressPercent: 0,
    });
    expect(second).toMatchObject({
      phase: "running", platform: "Cloudflare / Spaceship", highRisk: true, plannedCounts: null, progressPercent: 75,
      resultCounts: { succeeded: 2, waitingRemote: 0, retryable: 0, outcomeUnknown: 0, manual: 1, failedFinal: 0 },
    });
    expect(JSON.stringify(view)).not.toMatch(/plan-|operation-/u);
  });

  it("maps unexecuted plan phases and rejects incomplete or mixed windows", () => {
    const phases = (["planned", "approved", "expired", "cancelled"] as const).map((planPhase) =>
      projectBatchOperationList([read([{ ...planned, planPhase }])]).items[0]!.phase);
    expect(phases).toEqual(["planned", "queued", "cancelled", "cancelled"]);
    const firstHalf = read([planned], { totalRows: 2, window: { startIndex: 0, size: 1, rows: [planned] } });
    const secondHalf = read([running], { totalRows: 2, window: { startIndex: 1, size: 1, rows: [running] } });
    expect(projectBatchOperationList([firstHalf, secondHalf]).items).toHaveLength(2);
    expect(() => projectBatchOperationList([])).toThrow();
    expect(() => projectBatchOperationList([firstHalf])).toThrow();
    expect(() => projectBatchOperationList([firstHalf, { ...secondHalf, readGeneration: 3 }])).toThrow();
  });
});
