import { describe, expect, it } from "vitest";

import { historyEntryLimit, parseHistoryRead, projectOperationHistory, type HistoryRead, type HistoryRow } from "./history-read";

const freshness = { source: "active_local", readOnlyReason: null, serverRevision: 7, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true } as const;

const edit: HistoryRow = {
  localRevision: 4,
  entityId: "ledger.test",
  operation: "edit",
  committedAt: "2026-11-03T10:00:00Z",
  state: "pending",
  serverRevision: null,
  changes: [
    { fieldPath: "note", value: "second", previousValue: "first" },
    { fieldPath: "tags", value: [], previousValue: ["sale"] },
    { fieldPath: "targetPrice", value: { currency: "USD", amount: "120.00" } },
  ],
};
const deletion: HistoryRow = {
  localRevision: 2,
  entityId: "gone.test",
  operation: "delete",
  committedAt: "2026-11-01T10:00:00Z",
  state: "acknowledged",
  serverRevision: 9,
  changes: [],
};

function read(rows: readonly HistoryRow[] = [edit, deletion], overrides: Partial<HistoryRead> = {}): HistoryRead {
  return {
    schemaVersion: 1,
    kind: "history",
    readGeneration: 3,
    freshness,
    totalRows: rows.length,
    pendingRows: 1,
    window: { startIndex: 0, size: 200, rows },
    ...overrides,
  };
}

const labels = {
  edit: "Edit asset",
  delete: "Delete asset",
  actor: "Local workspace",
  platform: "Asset library",
  empty: "(empty)",
  fields: { note: "Note", portfolioId: "Portfolio", tags: "Tags", targetPrice: "Target price" },
};

describe("history read", () => {
  it("accepts the Host ledger and rejects identifiers, bad shapes and broken ordering", () => {
    expect(parseHistoryRead(read())).toEqual(read());
    expect(() => parseHistoryRead(read([{ ...edit, mutationId: "m-1" } as HistoryRow]))).toThrow();
    expect(() => parseHistoryRead(read([{ ...edit, changes: [{ fieldPath: "tags", value: "sale" }] } as unknown as HistoryRow]))).toThrow();
    expect(() => parseHistoryRead(read([{ ...edit, changes: [{ fieldPath: "lifecycleStatus", value: "archived" }] } as unknown as HistoryRow]))).toThrow();
    expect(() => parseHistoryRead(read([{ ...edit, changes: [edit.changes[0]!, edit.changes[0]!] }]))).toThrow();
    expect(() => parseHistoryRead(read([{ ...deletion, changes: edit.changes }]))).toThrow();
    expect(() => parseHistoryRead(read([{ ...edit, serverRevision: 3 }]))).toThrow();
    expect(() => parseHistoryRead(read([{ ...deletion, serverRevision: null }]))).toThrow();
    expect(() => parseHistoryRead(read([deletion, edit]))).toThrow();
    expect(() => parseHistoryRead(read([edit], { pendingRows: 2 }))).toThrow();
    expect(() => parseHistoryRead(read([edit], { totalRows: 0 }))).toThrow();
  });

  it("projects read-only entries with known and unknown previous values", () => {
    const view = projectOperationHistory([read()], labels, (at) => at.startsWith("2026-11-03"), "rev-2");
    expect(view).toMatchObject({ commandAdmission: "unavailable", totalRevisions: 2, changesToday: 1, pendingRevisionCount: 1, selectedRevisionId: "rev-2" });
    const [first, second] = view.entries;
    expect(first).toMatchObject({ revisionLabel: "4", actionLabel: "Edit asset · ledger.test", state: "applied", reversible: false, availableActions: [] });
    expect(first!.diffs).toEqual([
      { entityLabel: "ledger.test", fieldLabel: "Note", oldValue: "first", newValue: "second" },
      { entityLabel: "ledger.test", fieldLabel: "Tags", oldValue: "sale", newValue: "(empty)" },
      { entityLabel: "ledger.test", fieldLabel: "Target price", oldValue: null, newValue: "USD 120.00" },
    ]);
    expect(second).toMatchObject({ actionLabel: "Delete asset · gone.test", state: "synced", diffs: [] });
    for (const [state, expected] of [["sending", "applied"], ["conflicted", "conflicted"], ["rejected", "rejected"]] as const) {
      expect(projectOperationHistory([read([{ ...edit, state }])], labels, () => false, null).entries[0]!.state).toBe(expected);
    }
    expect(projectOperationHistory([read()], labels, () => false, "rev-99").selectedRevisionId).toBeNull();
    const long = projectOperationHistory([read([{ ...edit, changes: [{ fieldPath: "note", value: "x".repeat(10_000) }] }])], labels, () => false, null);
    expect(long.entries[0]!.diffs[0]!.newValue!).toHaveLength(2_000);
    // Astral characters count once on the Host but twice in UTF-16; both bounds must hold.
    const emoji = "😀".repeat(10_000);
    const astral = projectOperationHistory([read([{ ...edit, changes: [{ fieldPath: "note", value: emoji, previousValue: "😀".repeat(1_500) }] }])], labels, () => false, null);
    const [diff] = astral.entries[0]!.diffs;
    expect(diff!.newValue!.length).toBeLessThanOrEqual(2_000);
    expect(diff!.oldValue!.length).toBeLessThanOrEqual(2_000);
    expect(diff!.newValue!.endsWith("😀…")).toBe(true);
    expect(parseHistoryRead(read([{ ...edit, changes: [{ fieldPath: "tags", value: ["😀".repeat(64)] }] }])).window.rows).toHaveLength(1);
    expect(() => parseHistoryRead(read([{ ...edit, changes: [{ fieldPath: "note", value: `${emoji}😀` }] }]))).toThrow();
    expect(long.entries[0]!.diffs[0]!.newValue!.endsWith("…")).toBe(true);
    expect(() => parseHistoryRead(read([{ ...edit, changes: [{ fieldPath: "note", value: "x".repeat(10_001) }] }]))).toThrow();
  });

  it("requires contiguous windows of one generation and keeps only the newest revisions", () => {
    const rows = (start: number, count: number) => Array.from({ length: count }, (_, index): HistoryRow => ({ ...deletion, localRevision: 10_000 - start - index }));
    const total = historyEntryLimit + 50;
    const windows = [0, 200, 400].map((startIndex) => read(rows(startIndex, 200), { totalRows: total, window: { startIndex, size: 200, rows: rows(startIndex, 200) } }));
    const view = projectOperationHistory(windows, labels, () => false, null);
    expect(view.entries).toHaveLength(historyEntryLimit);
    expect(view.totalRevisions).toBe(total);
    expect(() => projectOperationHistory(windows.slice(0, 2), labels, () => false, null)).toThrow();
    expect(() => projectOperationHistory([windows[0]!, { ...windows[1]!, readGeneration: 4 }, windows[2]!], labels, () => false, null)).toThrow();
    expect(() => projectOperationHistory([], labels, () => false, null)).toThrow();
  });
});
