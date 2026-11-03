import { salesDeskViewModelSchema } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SalesDesk } from "./sales-desk";
import { commissionPercent, offerBinDelta, parseCounterInput, transferConfirmationFor } from "./sales-desk-contract";

const usd = (amount: string) => ({ currency: "USD", amount });

function view(source: "active_local" | "standby_cloud", grants: readonly string[]) {
  return salesDeskViewModelSchema.parse({
    schemaVersion: 1,
    workspaceId: "ws",
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
  });

  it("binds the transfer confirmation to exactly one deal target", () => {
    expect(transferConfirmationFor({ domain: "oxide.dev", buyerDisplay: "buyer·55A" })).toEqual({
      confirmedItemCount: 1,
      confirmedTarget: { domain: "oxide.dev", buyerDisplay: "buyer·55A" },
      irreversibleOwnershipTransferAcknowledged: true,
    });
  });
});
