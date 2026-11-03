import { describe, expect, it } from "vitest";

import { salesDeskViewModelSchema } from "./index";
import { parseSalesRead, projectSalesDeskViewModel } from "./sales-read";

const freshness = { source: "active_local", readOnlyReason: null, serverRevision: 5, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true } as const;
const row = {
  entityId: "vault.io",
  marketplaceKind: "atom",
  listingStatus: "active",
  askingPrice: { currency: "USD", amount: "1000.5" },
  observedAt: "2026-08-28T00:00:00Z",
  availability: "available",
  evidenceStatus: "confirmed",
} as const;

function read(rows: readonly unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { schemaVersion: 1, kind: "sales", readGeneration: 4, freshness, totalRows: rows.length, window: { startIndex: 0, size: 200, rows }, ...overrides };
}

describe("sales Host read", () => {
  it("projects observed listings and reports offers, deals and views as unavailable", () => {
    const view = projectSalesDeskViewModel([parseSalesRead(read([
      row,
      { ...row, marketplaceKind: "spaceship", askingPrice: { currency: "USD", amount: "0.25" } },
      { ...row, entityId: "zeta.io", listingStatus: "reserved" },
    ]))]);
    expect(salesDeskViewModelSchema.parse(view)).toEqual(view);
    expect(view.offerDealAvailability).toBe("unavailable");
    expect(view.actionGrants).toEqual([]);
    expect(view.metrics).toEqual({
      activeListingCount: 2,
      listedValue: { currency: "USD", amount: "1000.75" },
      pendingOfferCount: null,
      monthGmv: null,
      settlingDealCount: null,
    });
    expect(view.listings[0]).toMatchObject({ platforms: ["Atom"], views: null, offerCount: null, listedAtLabel: null, status: "active" });
    expect(view.listings[2]?.status).toBe("reserved");
  });

  it("never presents unconfirmed evidence as a definite status or mixed currencies as one value", () => {
    const stale = projectSalesDeskViewModel([parseSalesRead(read([{ ...row, evidenceStatus: "stale" }]))]);
    expect(stale.listings[0]?.status).toBe("unknown");
    expect(stale.metrics).toMatchObject({ activeListingCount: 0, listedValue: null });
    const mixed = projectSalesDeskViewModel([parseSalesRead(read([
      row,
      { ...row, marketplaceKind: "spaceship", askingPrice: { currency: "EUR", amount: "5" } },
    ]))]);
    expect(mixed.metrics.listedValue).toBeNull();
  });

  it("rejects identifiers, unknown marketplaces, unordered rows and malformed prices", () => {
    for (const bad of [
      read([{ ...row, listingObservationId: "obs-1" }]),
      read([{ ...row, marketplaceKind: "sedo" }]),
      read([{ ...row, listingStatus: "unlisted" }]),
      read([{ ...row, askingPrice: { currency: "USD", amount: "1e3" } }]),
      read([{ ...row, marketplaceKind: "spaceship" }, row]),
      read([row], { workspaceId: "ws" }),
    ]) {
      expect(() => parseSalesRead(bad)).toThrow();
    }
  });

  it("refuses to stitch windows from different generations or with gaps", () => {
    const first = parseSalesRead(read([row], { totalRows: 2 }));
    const second = parseSalesRead(read([{ ...row, entityId: "zeta.io" }], { totalRows: 2, window: { startIndex: 1, size: 200, rows: [{ ...row, entityId: "zeta.io" }] } }));
    expect(projectSalesDeskViewModel([first, second]).listings).toHaveLength(2);
    expect(() => projectSalesDeskViewModel([first, { ...second, readGeneration: 9 }])).toThrow();
    expect(() => projectSalesDeskViewModel([first])).toThrow();
  });
});
