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
    autoRenewEnabledCount: rows.filter((row) => row.autoRenew === true).length,
    autoRenewDisabledCount: rows.filter((row) => row.autoRenew === false).length,
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
    // The same matrix as the Host's `valid_registrar_name` test: 128 code points fit; control,
    // bidirectional and invisible formatting characters do not.
    const named = (registrarName: string) => read({ totalRows: 1 }, [{ entityId: "soon.test", expiresOn: "2026-11-08", autoRenew: null, registrarName }]);
    expect(parseRenewalsRead(named("\u{1d538}".repeat(128))).window.rows[0]?.registrarName).toHaveLength(256);
    for (const name of ["Bad\u0000", "Bad\nRegistrar", "x".repeat(129), "", "Zero\u200bWidth", "Bidi\u202eName", "Soft\u00adHyphen", "\ufeffBom"]) {
      expect(() => parseRenewalsRead(named(name)), JSON.stringify(name)).toThrow();
    }
    expect(() => parseRenewalsRead(read({ totalRows: 1 }))).toThrow();
    expect(() => parseRenewalsRead(read({ autoRenewEnabledCount: 2, autoRenewDisabledCount: 1 }))).toThrow();
  });

  it("projects an unavailable plan with days counted from the Host date", () => {
    const view = projectRenewalDeskViewModel([read()], 200);
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
    expect(view.page).toEqual({ startIndex: 0, size: 200, totalItems: 2, autoRenewEnabledCount: 1, autoRenewDisabledCount: 0 });
  });

  it("carries commercial read-only freshness", () => {
    const view = projectRenewalDeskViewModel([read({
      freshness: { ...read().freshness, readOnlyReason: "commercial", canEdit: false },
    })], 200);
    expect(view.freshness).toMatchObject({ readOnlyReason: "commercial", canEdit: false });
  });

  it("projects one whole page with whole-desk counts and rejects short pages, gaps or mixed generations", () => {
    const [soon, later] = read().window.rows;
    const firstHalf = read({ totalRows: 2, window: { startIndex: 0, size: 1, rows: [soon!] } });
    const secondHalf = read({ totalRows: 2, window: { startIndex: 1, size: 1, rows: [later!] } });
    expect(projectRenewalDeskViewModel([firstHalf, secondHalf], 2).items).toHaveLength(2);
    // The second page alone shows its one row while the counts still describe both assets.
    const page = projectRenewalDeskViewModel([secondHalf], 1);
    if (page.state !== "list") throw new Error("expected the list state");
    expect(page.items.map((item) => item.domain)).toEqual(["later.test"]);
    expect(page.page).toEqual({ startIndex: 1, size: 1, totalItems: 2, autoRenewEnabledCount: 1, autoRenewDisabledCount: 0 });
    // The last page may be short; any other page must be full.
    expect(projectRenewalDeskViewModel([secondHalf], 50).items).toHaveLength(1);
    expect(() => projectRenewalDeskViewModel([firstHalf], 2)).toThrow();
    expect(() => projectRenewalDeskViewModel([read({ totalRows: 1000, window: { startIndex: 0, size: 50, rows: [soon!] } })], 50)).toThrow();
    expect(() => projectRenewalDeskViewModel([], 50)).toThrow();
    expect(() => projectRenewalDeskViewModel([firstHalf, { ...secondHalf, window: { ...secondHalf.window, startIndex: 2 } }], 2)).toThrow();
    expect(() => projectRenewalDeskViewModel([firstHalf, { ...secondHalf, autoRenewEnabledCount: 0 }], 2)).toThrow();
    expect(() => projectRenewalDeskViewModel([firstHalf, { ...secondHalf, readGeneration: 5 }], 2)).toThrow();
    expect(() => projectRenewalDeskViewModel([firstHalf, { ...secondHalf, asOfDate: "2026-11-04" }], 2)).toThrow();
  });
});
