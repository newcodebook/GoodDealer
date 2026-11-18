import { describe, expect, it } from "vitest";

import { salesDeskViewModelSchema } from "./index";
import { parseSalesRead, projectSalesDeskViewModel } from "./sales-read";

const freshness = { source: "active_local", readOnlyReason: null, serverRevision: 5, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true } as const;
const row = {
  entityId: "vault.io",
  marketplaces: ["atom", "spaceship"],
  listingStatus: "active",
  askingPrice: { currency: "USD", amount: "1000.5" },
} as const;

function read(rows: readonly unknown[], overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1, kind: "sales", readGeneration: 4, freshness, totalRows: rows.length,
    activeListingCount: 1, listedValue: { currency: "USD", amount: "1000.5" },
    window: { startIndex: 0, size: 200, rows }, ...overrides,
  };
}

describe("sales Host read", () => {
  it("projects Host-merged domains and reports offers, deals and views as unavailable", () => {
    const view = projectSalesDeskViewModel([parseSalesRead(read([
      { ...row, entityId: "mint.io", marketplaces: ["afternic", "godaddy"], listingStatus: "conflict", askingPrice: null },
      row,
      { ...row, entityId: "zeta.io", marketplaces: ["dynadot"], listingStatus: "reserved" },
    ]))], 200);
    expect(salesDeskViewModelSchema.parse(view)).toEqual(view);
    expect(view.offerDealAvailability).toBe("unavailable");
    expect(view.actionGrants).toEqual([]);
    expect(view.listings.map((listing) => listing.domain)).toEqual(["mint.io", "vault.io", "zeta.io"]);
    expect(view.listings[0]).toMatchObject({ platforms: ["Afternic", "GoDaddy"], bin: null, status: "conflict" });
    expect(view.listings[1]).toMatchObject({ id: "vault.io", platforms: ["Atom", "Spaceship"], bin: row.askingPrice, views: null, offerCount: null, listedAtLabel: null, status: "active" });
    expect(view.listings[2]?.status).toBe("reserved");
  });

  it("takes its metrics from the Host's whole-workspace counts, not from the page", () => {
    const view = projectSalesDeskViewModel([parseSalesRead(read([row], {
      totalRows: 1_234, activeListingCount: 900, listedValue: { currency: "USD", amount: "88000" },
      window: { startIndex: 50, size: 1, rows: [row] },
    }))], 1);
    expect(view.metrics).toEqual({
      activeListingCount: 900,
      listedValue: { currency: "USD", amount: "88000" },
      pendingOfferCount: null,
      monthGmv: null,
      settlingDealCount: null,
    });
    expect(view.page).toEqual({ startIndex: 50, size: 1, totalItems: 1_234 });
  });

  it("rejects a short page, which would hide domains the Host has", () => {
    const short = parseSalesRead(read([row], { totalRows: 3 }));
    expect(() => projectSalesDeskViewModel([short], 50)).toThrow(TypeError);
    // The last page stops at the Host's total.
    const last = parseSalesRead(read([row], { totalRows: 3, window: { startIndex: 2, size: 50, rows: [row] } }));
    expect(projectSalesDeskViewModel([last], 50).listings).toHaveLength(1);
  });

  it("rejects identifiers, unknown marketplaces, unmerged rows and impossible metrics", () => {
    for (const bad of [
      read([{ ...row, listingObservationId: "obs-1" }]),
      read([{ ...row, marketplaces: ["sedo"] }]),
      read([{ ...row, marketplaces: [] }]),
      read([{ ...row, marketplaces: ["spaceship", "atom"] }]),
      read([{ ...row, marketplaces: ["atom", "atom"] }]),
      read([{ ...row, listingStatus: "unlisted" }]),
      read([{ ...row, marketplaces: ["atom"], listingStatus: "conflict" }]),
      read([{ ...row, askingPrice: { currency: "USD", amount: "1e3" } }]),
      // A domain repeated on the page means the Host did not merge its markets.
      read([row, row]),
      read([{ ...row, entityId: "zeta.io" }, row]),
      read([row], { activeListingCount: 2 }),
      read([row], { activeListingCount: 0 }),
      read([row], { listedValue: { currency: "usd", amount: "1" } }),
      read([row], { workspaceId: "ws" }),
    ]) {
      expect(() => parseSalesRead(bad)).toThrow();
    }
  });

  it("refuses to stitch windows from different generations, metrics or with gaps", () => {
    const zeta = { ...row, entityId: "zeta.io" };
    const first = parseSalesRead(read([row], { totalRows: 2 }));
    const second = parseSalesRead(read([zeta], { totalRows: 2, window: { startIndex: 1, size: 200, rows: [zeta] } }));
    expect(projectSalesDeskViewModel([first, second], 2).listings).toHaveLength(2);
    expect(() => projectSalesDeskViewModel([first, { ...second, readGeneration: 9 }], 2)).toThrow();
    expect(() => projectSalesDeskViewModel([first, { ...second, listedValue: null }], 2)).toThrow();
    expect(() => projectSalesDeskViewModel([first], 2)).toThrow();
    // A domain that comes back across a window boundary is rejected too.
    const again = parseSalesRead(read([row], { totalRows: 2, window: { startIndex: 1, size: 200, rows: [row] } }));
    expect(() => projectSalesDeskViewModel([first, again], 2)).toThrow();
  });
});
