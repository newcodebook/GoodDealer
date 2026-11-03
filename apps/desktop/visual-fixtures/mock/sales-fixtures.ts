import { marketplaceActionSchema, salesDeskViewModelSchema, type SalesDeskViewModel } from "@gooddealer/client-core";

/** Mock sales rows adapted from brand/ui_kits/desktop/SalesDesk.jsx; amounts are whole USD. */
export interface MockListing {
  readonly id: string;
  readonly domain: string;
  readonly platforms: readonly string[];
  readonly bin: number;
  readonly views: number;
  readonly offerCount: number;
  readonly status: "active" | "paused" | "draft" | "pending" | "conflict" | "sold";
  readonly listedAtLabel: string;
}

export interface MockOffer {
  readonly id: string;
  readonly domain: string;
  readonly buyer: string;
  readonly offer: number;
  readonly bin: number;
  readonly counter: number | null;
  readonly platform: string;
  readonly state: "pending" | "countered" | "accepted" | "declined" | "expired";
  readonly ageLabel: string;
}

export interface MockDeal {
  readonly id: string;
  readonly domain: string;
  readonly amount: number;
  readonly platform: string;
  readonly buyer: string;
  readonly stage: "escrow" | "transfer_pending" | "transferred" | "paid";
}

export interface MockSales {
  readonly listings: readonly MockListing[];
  readonly offers: readonly MockOffer[];
  readonly deals: readonly MockDeal[];
}

/** Commission rate per platform in basis points; the Host quotes the real rate per offer. */
const commissionBasisPoints: Readonly<Record<string, number>> = { Atom: 1000, Afternic: 1500, SellerHub: 1200 };

function rateOf(platform: string): number {
  return commissionBasisPoints[platform] ?? 1200;
}

function usd(amount: number) {
  return { currency: "USD", amount: amount.toFixed(2) };
}

function commission(amount: number, platform: string) {
  const fee = Math.round(amount * rateOf(platform)) / 10_000;
  return { rateBasisPoints: rateOf(platform), fee: usd(fee), net: usd(amount - fee) };
}

export function initialMockSales(): MockSales {
  return {
    listings: [
      { id: "l1", domain: "vault.io", platforms: ["Atom", "Afternic"], bin: 280000, views: 1240, offerCount: 3, status: "active", listedAtLabel: "06-02" },
      { id: "l2", domain: "kanban.ai", platforms: ["Atom"], bin: 99999, views: 860, offerCount: 1, status: "active", listedAtLabel: "07-14" },
      { id: "l3", domain: "quanta.trade", platforms: ["Atom", "SellerHub"], bin: 42000, views: 410, offerCount: 1, status: "active", listedAtLabel: "05-20" },
      { id: "l4", domain: "helio.systems", platforms: ["Afternic"], bin: 18500, views: 96, offerCount: 0, status: "paused", listedAtLabel: "04-11" },
      { id: "l5", domain: "mint.money", platforms: ["Atom"], bin: 65000, views: 520, offerCount: 1, status: "active", listedAtLabel: "07-28" },
      { id: "l6", domain: "crest.capital", platforms: ["Afternic"], bin: 24000, views: 38, offerCount: 0, status: "conflict", listedAtLabel: "08-03" },
      { id: "l7", domain: "forge.dev", platforms: [], bin: 12000, views: 0, offerCount: 0, status: "draft", listedAtLabel: "—" },
    ],
    offers: [
      { id: "f1", domain: "vault.io", buyer: "buyer·7Q2", offer: 212000, bin: 280000, counter: null, platform: "Atom", state: "pending", ageLabel: "2 小时前" },
      { id: "f2", domain: "kanban.ai", buyer: "buyer·A19", offer: 88000, bin: 99999, counter: null, platform: "Atom", state: "pending", ageLabel: "今日 09:40" },
      { id: "f3", domain: "quanta.trade", buyer: "buyer·M53", offer: 31000, bin: 42000, counter: 37000, platform: "SellerHub", state: "countered", ageLabel: "昨日" },
      { id: "f4", domain: "vault.io", buyer: "buyer·K08", offer: 150000, bin: 280000, counter: null, platform: "Afternic", state: "declined", ageLabel: "07-30" },
      { id: "f5", domain: "mint.money", buyer: "buyer·33F", offer: 64000, bin: 65000, counter: null, platform: "Atom", state: "pending", ageLabel: "30 分钟前" },
      { id: "f6", domain: "helio.systems", buyer: "buyer·E40", offer: 9000, bin: 18500, counter: null, platform: "Afternic", state: "expired", ageLabel: "07-18" },
    ],
    deals: [
      { id: "d1", domain: "oxide.dev", amount: 52000, platform: "Atom", buyer: "buyer·55A", stage: "transfer_pending" },
      { id: "d2", domain: "arc.exchange", amount: 33000, platform: "Afternic", buyer: "buyer·9C1", stage: "escrow" },
      { id: "d3", domain: "north.capital", amount: 21500, platform: "Atom", buyer: "buyer·B7X", stage: "transferred" },
      { id: "d4", domain: "legacy.io", amount: 14200, platform: "Atom", buyer: "buyer·2D0", stage: "paid" },
    ],
  };
}

/** Projects mock rows through the client-core contract, so the screen only ever sees a valid view model. */
export function projectMockSales(sales: MockSales, standby: boolean): SalesDeskViewModel {
  const active = sales.listings.filter((listing) => listing.status === "active");
  return salesDeskViewModelSchema.parse({
    schemaVersion: 1,
    workspaceId: "ws-mock",
    freshness: {
      source: standby ? "standby_cloud" : "active_local",
      serverRevision: 8241,
      lastReplicationActivityAt: "2026-08-20T06:12:00Z",
      lastSuccessfulProviderObservationAt: "2026-08-20T06:05:00Z",
    },
    actionGrants: standby ? [] : marketplaceActionSchema.options,
    metrics: {
      activeListingCount: active.length,
      listedValue: usd(active.reduce((sum, listing) => sum + listing.bin, 0)),
      pendingOfferCount: sales.offers.filter((offer) => offer.state === "pending").length,
      monthGmv: usd(sales.deals.reduce((sum, deal) => sum + deal.amount, 0)),
      settlingDealCount: sales.deals.filter((deal) => deal.stage !== "paid").length,
    },
    listings: sales.listings.map((listing) => ({ ...listing, platforms: [...listing.platforms], bin: usd(listing.bin) })),
    offers: sales.offers.map(({ buyer, offer, bin, counter, ...rest }) => ({
      ...rest,
      buyerDisplay: buyer,
      offer: usd(offer),
      bin: usd(bin),
      counter: counter === null ? null : usd(counter),
      commission: commission(offer, rest.platform),
    })),
    deals: sales.deals.map(({ buyer, amount, ...rest }) => ({
      ...rest,
      buyerDisplay: buyer,
      amount: usd(amount),
      net: commission(amount, rest.platform).net,
    })),
  });
}
