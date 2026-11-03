import { describe, expect, it } from "vitest";

import { parseRenewalsRead, projectRenewalDeskViewModel, type RenewalsRead } from "./renewals-read";

function read(overrides: Partial<RenewalsRead> = {}, rows: RenewalsRead["window"]["rows"] = [
  { entityId: "soon.test", expiresOn: "2026-11-08", autoRenew: true, registrarName: "Spaceship" },
  { entityId: "later.test", expiresOn: "2027-01-02", autoRenew: null, registrarName: null },
]): RenewalsRead {
  return {
    schemaVersion: 1,
    kind: "renewals",
    readGeneration: 4,
    freshness: {
      source: "active_local",
      readOnlyReason: null,
      serverRevision: 7,
      lastReplicationActivityAt: null,
      lastSuccessfulProviderObservationAt: null,
      canEdit: true,
    },
    asOfDate: "2026-11-03",
    totalRows: rows.length,
    window: { startIndex: 0, size: 200, rows },
    ...overrides,
  };
}

describe("renewals read", () => {
  it("parses the Host window and rejects unknown, out-of-window or unordered rows", () => {
    expect(parseRenewalsRead(read())).toEqual(read());
    expect(() => parseRenewalsRead({ ...read(), renewalPrice: "1" })).toThrow();
    expect(() => parseRenewalsRead(read({}, [{ entityId: "past.test", expiresOn: "2026-11-02", autoRenew: null, registrarName: null }]))).toThrow();
    expect(() => parseRenewalsRead(read({}, [{ entityId: "far.test", expiresOn: "2027-01-03", autoRenew: null, registrarName: null }]))).toThrow();
    expect(() => parseRenewalsRead(read({}, [...read().window.rows].reverse()))).toThrow();
    expect(() => parseRenewalsRead(read({}, [{ entityId: "soon.test", expiresOn: "2026-11-08", autoRenew: null, registrarName: "Bad\u0000" }]))).toThrow();
    expect(() => parseRenewalsRead(read({ totalRows: 1 }))).toThrow();
  });

  it("projects an unavailable plan with days counted from the Host date", () => {
    const view = projectRenewalDeskViewModel([read()]);
    if (view.state !== "list") throw new Error("expected the list state");
    expect(view.planAvailability).toBe("unavailable");
    expect(view.budget).toBeNull();
    expect(view.selectedTotal).toBeNull();
    expect(view.items.map((item) => [item.domain, item.daysRemaining, item.registrar, item.autoRenewEnabled, item.termYears, item.annualPrice, item.selected]))
      .toEqual([
        ["soon.test", 5, "Spaceship", true, null, null, false],
        ["later.test", 60, null, null, null, null, false],
      ]);
    expect(view.freshness).not.toHaveProperty("readOnlyReason");
  });

  it("carries commercial read-only freshness", () => {
    const view = projectRenewalDeskViewModel([read({
      freshness: { ...read().freshness, readOnlyReason: "commercial", canEdit: false },
    })]);
    expect(view.freshness).toMatchObject({ readOnlyReason: "commercial", canEdit: false });
  });

  it("rejects incomplete or mixed-generation windows", () => {
    const [soon, later] = read().window.rows;
    const firstHalf = read({ totalRows: 2, window: { startIndex: 0, size: 1, rows: [soon!] } });
    const secondHalf = read({ totalRows: 2, window: { startIndex: 1, size: 1, rows: [later!] } });
    expect(projectRenewalDeskViewModel([firstHalf, secondHalf]).items).toHaveLength(2);
    expect(() => projectRenewalDeskViewModel([])).toThrow();
    expect(() => projectRenewalDeskViewModel([firstHalf])).toThrow();
    expect(() => projectRenewalDeskViewModel([firstHalf, { ...secondHalf, readGeneration: 5 }])).toThrow();
    expect(() => projectRenewalDeskViewModel([firstHalf, { ...secondHalf, asOfDate: "2026-11-04" }])).toThrow();
  });
});
