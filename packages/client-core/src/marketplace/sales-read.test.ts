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
      { ...row, entityId: "mint.io", askingPrice: { currency: "USD", amount: "0.25" } },
      row,
      { ...row, marketplaceKind: "spaceship" },
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
    // One row per domain: vault.io's two markets share a status and price, and count once.
    expect(view.listings.map((listing) => listing.domain)).toEqual(["mint.io", "vault.io", "zeta.io"]);
    expect(view.listings[1]).toMatchObject({ platforms: ["Atom", "Spaceship"], bin: row.askingPrice, views: null, offerCount: null, listedAtLabel: null, status: "active" });
    expect(view.listings[2]?.status).toBe("reserved");
  });

  it("never presents unconfirmed evidence as a definite status or mixed currencies as one value", () => {
    const stale = projectSalesDeskViewModel([parseSalesRead(read([{ ...row, evidenceStatus: "stale" }]))]);
    expect(stale.listings[0]?.status).toBe("unknown");
    expect(stale.metrics).toMatchObject({ activeListingCount: 0, listedValue: null });
    const mixed = projectSalesDeskViewModel([parseSalesRead(read([
      row,
      { ...row, entityId: "zeta.io", askingPrice: { currency: "EUR", amount: "5" } },
    ]))]);
    expect(mixed.metrics.listedValue).toBeNull();
  });

  it("merges a domain's markets without choosing between disagreeing states or prices", () => {
    const view = projectSalesDeskViewModel([parseSalesRead(read([
      { ...row, marketplaceKind: "afternic", listingStatus: "sold" },
      row,
      { ...row, marketplaceKind: "spaceship", askingPrice: { currency: "USD", amount: "1000.50" } },
      { ...row, entityId: "zeta.io" },
      { ...row, entityId: "zeta.io", marketplaceKind: "dynadot", evidenceStatus: "stale" },
      { ...row, entityId: "zeta.io", marketplaceKind: "spaceship", askingPrice: { currency: "USD", amount: "900" } },
    ]))]);
    const [vault, zeta] = view.listings;
    // Equal prices compare by value, so "1000.5" and "1000.50" are one price.
    expect(vault).toMatchObject({ id: "vault.io", platforms: ["Afternic", "Atom", "Spaceship"], bin: row.askingPrice, status: "conflict" });
    // Different prices have no single value; an unconfirmed market leaves the state unknown, not conflicting.
    expect(zeta).toMatchObject({ platforms: ["Atom", "Dynadot", "Spaceship"], bin: null, status: "unknown" });
    expect(view.metrics).toMatchObject({ activeListingCount: 0, listedValue: null });
  });

  it("does not total the listed value when an active domain has no single price", () => {
    const view = projectSalesDeskViewModel([parseSalesRead(read([
      { ...row, entityId: "mint.io" },
      row,
      { ...row, marketplaceKind: "spaceship", askingPrice: { currency: "USD", amount: "900" } },
    ]))]);
    expect(view.listings.map((listing) => [listing.status, listing.bin])).toEqual([["active", row.askingPrice], ["active", null]]);
    expect(view.metrics).toMatchObject({ activeListingCount: 2, listedValue: null });
  });

  it("merges a domain whose markets span two windows and rejects order that goes back across them", () => {
    const spanning = [row, { ...row, marketplaceKind: "spaceship" }, { ...row, entityId: "zeta.io" }];
    const window = (rows: readonly unknown[], startIndex: number) => parseSalesRead(read(rows, { totalRows: 3, window: { startIndex, size: 200, rows } }));
    const merged = projectSalesDeskViewModel([window(spanning.slice(0, 1), 0), window(spanning.slice(1), 1)]);
    expect(merged.listings.map((listing) => [listing.id, listing.platforms])).toEqual([["vault.io", ["Atom", "Spaceship"]], ["zeta.io", ["Atom"]]]);
    // Each window is ordered on its own, but vault.io returns after zeta.io across the boundary.
    const backwards = [row, { ...row, entityId: "zeta.io" }, { ...row, marketplaceKind: "spaceship" }];
    expect(() => projectSalesDeskViewModel([window(backwards.slice(0, 2), 0), window(backwards.slice(2), 2)])).toThrow();
    const repeated = [row, { ...row, entityId: "zeta.io" }, row];
    expect(() => projectSalesDeskViewModel([window(repeated.slice(0, 2), 0), window(repeated.slice(2), 2)])).toThrow();
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
