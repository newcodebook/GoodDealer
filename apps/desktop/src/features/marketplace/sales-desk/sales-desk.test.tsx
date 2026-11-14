import { parseSalesRead, projectSalesDeskViewModel, salesDeskViewModelSchema } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SalesDesk } from "./sales-desk";
import { commissionPercent, offerBinDelta, parseCounterInput, transferConfirmationFor } from "./sales-desk-contract";

const usd = (amount: string) => ({ currency: "USD", amount });

function view(source: "active_local" | "standby_cloud", grants: readonly string[]) {
  return salesDeskViewModelSchema.parse({
    schemaVersion: 1,
    offerDealAvailability: "available",
    freshness: { source, serverRevision: 3, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null },
    actionGrants: grants,
    metrics: { activeListingCount: 1, listedValue: usd("280000.00"), pendingOfferCount: 1, monthGmv: usd("52000.00"), settlingDealCount: 1 },
    listings: [{ id: "l1", domain: "vault.io", platforms: ["Atom"], bin: usd("280000.00"), views: 10, offerCount: 1, status: "active", listedAtLabel: "06-02" }],
    offers: [{
      id: "f1", domain: "vault.io", buyerDisplay: "buyer·7Q2", offer: usd("212000.00"), bin: usd("280000.00"), counter: null,
      platform: "Atom", state: "pending", ageLabel: "2h", commission: { rateBasisPoints: 1000, fee: usd("21200.00"), net: usd("190800.00") },
    }],
    deals: [{ id: "d1", domain: "oxide.dev", amount: usd("52000.00"), net: usd("46800.00"), platform: "Atom", buyerDisplay: "buyer·55A", stage: "transfer_pending" }],
  });
}

const allGrants = ["accept_offer", "counter_offer", "decline_offer", "push_transfer", "create_listing", "pause_listing"];
const noop = () => undefined;

describe("Sales desk", () => {
  it("offers only the actions the Host grants", () => {
    const html = renderToStaticMarkup(
      <SalesDesk locale="zh-CN" view={view("active_local", ["decline_offer"])} onAcceptOffer={noop} onCounterOffer={noop} onDeclineOffer={noop} onCreateListing={noop} />,
    );
    expect(html).toContain(">拒绝<");
    expect(html).not.toContain(">接受<");
    expect(html).not.toContain("新建 Listing");
  });

  it("removes every write action on Standby and explains why", () => {
    const html = renderToStaticMarkup(
      <SalesDesk locale="zh-CN" view={view("standby_cloud", [])} onAcceptOffer={noop} onCounterOffer={noop} onDeclineOffer={noop} onCreateListing={noop} />,
    );
    expect(html).toContain("备用设备只读");
    expect(html).not.toMatch(/>(接受|还价 · Counter|拒绝)</u);
  });

  it("shows the transfer action on deals awaiting it and SOLD only as a value result", () => {
    const html = renderToStaticMarkup(<SalesDesk locale="zh-CN" view={view("active_local", allGrants)} initialTab="deals" onPushTransfer={noop} />);
    expect(html).toContain("推送转移");
    expect(html).toContain("$46,800.00");
    expect(html).not.toContain("SOLD");
  });
});

describe("Sales desk contract", () => {
  it("parses counteroffers in the offer currency and rejects malformed amounts", () => {
    expect(parseCounterInput(" 37,000.5 ", "USD")).toEqual({ currency: "USD", amount: "37000.5" });
    expect(parseCounterInput("0", "USD")).toBeNull();
    expect(parseCounterInput("0.00", "USD")).toBeNull();
    expect(parseCounterInput("-5", "USD")).toBeNull();
    expect(parseCounterInput("1e5", "USD")).toBeNull();
    expect(parseCounterInput("12.345", "USD")).toBeNull();
    expect(parseCounterInput("100", "usd")).toBeNull();
  });

  it("formats commission rates and BIN deltas", () => {
    expect(commissionPercent(1000)).toBe("10%");
    expect(commissionPercent(1250)).toBe("12.5%");
    expect(offerBinDelta({ offer: usd("212000"), bin: usd("280000") })).toBe(-24);
    expect(offerBinDelta({ offer: usd("1"), bin: usd("0") })).toBeNull();
    // Compared exactly: a double cannot tell these two amounts apart.
    expect(offerBinDelta({ offer: usd("9007199254740993"), bin: usd("9007199254740992") })).toBe(0);
    expect(offerBinDelta({ offer: usd("1.005"), bin: usd("1") })).toBe(1);
  });

  it("binds the transfer confirmation to exactly one deal target", () => {
    expect(transferConfirmationFor({ domain: "oxide.dev", buyerDisplay: "buyer·55A" })).toEqual({
      confirmedItemCount: 1,
      confirmedTarget: { domain: "oxide.dev", buyerDisplay: "buyer·55A" },
      irreversibleOwnershipTransferAcknowledged: true,
    });
  });
});

describe("Sales desk from the Host sales projection", () => {
  const hostView = projectSalesDeskViewModel([parseSalesRead({
    schemaVersion: 1, kind: "sales", readGeneration: 1,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 2, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    totalRows: 2, activeListingCount: 1, listedValue: { currency: "USD", amount: "280000" },
    window: { startIndex: 0, size: 200, rows: [
      { entityId: "vault.io", marketplaces: ["atom"], listingStatus: "active", askingPrice: { currency: "USD", amount: "280000" } },
      { entityId: "zeta.io", marketplaces: ["afternic"], listingStatus: "unknown", askingPrice: null },
    ] },
  })], 200);

  it("shows observed listings with unobserved values as dashes and no listing controls", () => {
    const html = renderToStaticMarkup(<SalesDesk locale="zh-CN" view={hostView} initialTab="listings" />);
    expect(html).toContain("vault.io");
    expect(html).toContain("Atom");
    expect(html).toContain("未确认");
    expect(html).toContain("暂不可用");
    for (const control of ["改价", ">暂停<", "下架", "新建 Listing", ">接受<"]) expect(html).not.toContain(control);
  });

  it("names a disagreement between markets apart from the sync Conflict Center", () => {
    const split = projectSalesDeskViewModel([parseSalesRead({
      schemaVersion: 1, kind: "sales", readGeneration: 1,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 2, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1, activeListingCount: 0, listedValue: null,
      window: { startIndex: 0, size: 200, rows: [
        { entityId: "split.io", marketplaces: ["afternic", "atom"], listingStatus: "conflict", askingPrice: null },
      ] },
    })], 200);
    const zh = renderToStaticMarkup(<SalesDesk locale="zh-CN" view={split} initialTab="listings" />);
    expect(zh).toContain("市场间不一致");
    expect(zh).not.toContain(">冲突<");
    expect(renderToStaticMarkup(<SalesDesk locale="en-US" view={split} initialTab="listings" />)).toContain("Markets disagree");
  });

  it("reports workspace-wide metrics on a Host page and pages through the rest", () => {
    const paged = projectSalesDeskViewModel([parseSalesRead({
      schemaVersion: 1, kind: "sales", readGeneration: 1,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 2, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1_234, activeListingCount: 900, listedValue: { currency: "USD", amount: "88000" },
      window: { startIndex: 50, size: 50, rows: Array.from({ length: 50 }, (_, index) => ({
        entityId: `page-${String(index).padStart(2, "0")}.io`, marketplaces: ["atom"], listingStatus: "active", askingPrice: null,
      })) },
    })], 50);
    const html = renderToStaticMarkup(<SalesDesk locale="en-US" view={paged} initialTab="listings" onPageChange={() => undefined} />);
    // Metrics describe every listed domain, not the 50 on this page.
    expect(html).toContain("900");
    expect(html).toContain("88,000");
    expect(html).toContain("51–100");
    expect(html).toContain('aria-current="page">2<');
    expect(html).not.toContain("aria-busy");
    // While another page loads, this one stays mounted and is marked busy.
    expect(renderToStaticMarkup(<SalesDesk locale="en-US" view={paged} busy initialTab="listings" />)).toContain('aria-busy="true"');
  });

  it("shows a row price in a market's notation and the listed value in the Host's the same way", () => {
    const view = projectSalesDeskViewModel([parseSalesRead({
      schemaVersion: 1, kind: "sales", readGeneration: 1,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 2, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1, activeListingCount: 1, listedValue: { currency: "USD", amount: "1000.5" },
      window: { startIndex: 0, size: 200, rows: [
        { entityId: "vault.io", marketplaces: ["afternic", "atom"], listingStatus: "active", askingPrice: { currency: "USD", amount: "1000.50" } },
      ] },
    })], 200);
    const html = renderToStaticMarkup(<SalesDesk locale="en-US" view={view} initialTab="listings" />);
    // "1000.50" (the first market's notation) and "1000.5" (the Host's total) are one amount.
    expect(html.match(/\$1,000\.50/gu)).toHaveLength(2);
  });

  it("says offers and deals are unavailable instead of showing an empty inbox", () => {
    for (const initialTab of ["offers", "deals"] as const) {
      const html = renderToStaticMarkup(<SalesDesk locale="zh-CN" view={hostView} initialTab={initialTab} />);
      expect(html).toContain("报价与成交尚未接入已认证的平台能力");
      expect(html).not.toContain("<table");
    }
  });
});
