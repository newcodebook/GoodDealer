import { describe, expect, it, vi } from "vitest";

import {
  ActiveLocalMarketplaceAdapter,
  StandbyCloudMarketplaceAdapter,
  createAcceptOfferPlan,
  createConfirmedTransferSubmission,
  createTransferActionPlan,
  domainDetailCommerceViewModelSchema,
  hasMarketplaceActionGrant,
  isExactTransferConfirmation,
  salesDeskViewModelSchema,
  type SalesDeskViewModel,
} from "./index";

function createView(source: "active_local" | "standby_cloud" = "active_local"): SalesDeskViewModel {
  return salesDeskViewModelSchema.parse({
    schemaVersion: 1,
    workspaceId: "workspace-1",
    freshness: {
      source,
      serverRevision: 42,
      lastReplicationActivityAt: "2026-08-17T05:00:00Z",
      lastSuccessfulProviderObservationAt: "2026-08-17T05:10:00Z",
    },
    actionGrants: source === "active_local" ? ["accept_offer", "push_transfer"] : [],
    metrics: {
      activeListingCount: 1,
      listedValue: { currency: "USD", amount: "280000" },
      pendingOfferCount: 1,
      monthGmv: { currency: "USD", amount: "52000" },
      settlingDealCount: 1,
    },
    listings: [
      {
        id: "listing-1",
        domain: "vault.io",
        platforms: ["Atom", "Afternic"],
        bin: { currency: "USD", amount: "280000" },
        views: 1240,
        offerCount: 3,
        status: "active",
        listedAtLabel: "06-02",
      },
    ],
    offers: [
      {
        id: "offer-1",
        domain: "vault.io",
        buyerDisplay: "buyer·7Q2",
        offer: { currency: "USD", amount: "212000" },
        bin: { currency: "USD", amount: "280000" },
        counter: null,
        platform: "Atom",
        state: "pending",
        ageLabel: "2 小时前",
        commission: {
          rateBasisPoints: 1000,
          fee: { currency: "USD", amount: "21200" },
          net: { currency: "USD", amount: "190800" },
        },
      },
    ],
    deals: [
      {
        id: "deal-1",
        domain: "oxide.dev",
        amount: { currency: "USD", amount: "52000" },
        net: { currency: "USD", amount: "46800" },
        platform: "Atom",
        buyerDisplay: "buyer·55A",
        stage: "transfer_pending",
      },
    ],
  });
}

describe("marketplace contracts", () => {
  it("validates unknown Active data and returns an isolated copy", async () => {
    const source = createView();
    const adapter = new ActiveLocalMarketplaceAdapter({
      getSalesDesk: vi.fn().mockResolvedValue(source),
      getDomainCommerce: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        domain: "vault.io",
        freshness: source.freshness,
        actionGrants: source.actionGrants,
        listings: source.listings,
      }),
    });
    const result = await adapter.getSalesDesk();

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(hasMarketplaceActionGrant(result, "accept_offer")).toBe(true);
  });

  it("fails closed on unknown fields, malformed money, and source confusion", async () => {
    const active = createView();
    await expect(new StandbyCloudMarketplaceAdapter({ getSalesDesk: async () => active, getDomainCommerce: async () => ({}) }).getSalesDesk()).rejects.toThrow(
      "expected standby_cloud",
    );
    await expect(
      new ActiveLocalMarketplaceAdapter({ getSalesDesk: async () => ({ ...active, unexpected: true }), getDomainCommerce: async () => ({}) }).getSalesDesk(),
    ).rejects.toThrow();
    await expect(
      new ActiveLocalMarketplaceAdapter({
        getSalesDesk: async () => ({
          ...active,
          offers: [{ ...active.offers[0], offer: { currency: "USD", amount: 212000 } }],
        }),
        getDomainCommerce: async () => ({}),
      }).getSalesDesk(),
    ).rejects.toThrow();
    expect(() => salesDeskViewModelSchema.parse({
      ...active,
      listings: [{ ...active.listings[0], domain: "<script>alert(1)</script>" }],
    })).toThrow("canonical ASCII/Punycode");
    expect(() => salesDeskViewModelSchema.parse({
      ...active,
      offers: [{ ...active.offers[0], buyerDisplay: "buyer\u202Etxt" }],
    })).toThrow("bidirectional override");
  });

  it("keeps DomainDetail commerce injected and domain-scoped", async () => {
    const active = createView();
    const detail = domainDetailCommerceViewModelSchema.parse({
      schemaVersion: 1,
      domain: "vault.io",
      freshness: active.freshness,
      actionGrants: ["change_price", "delist_listing"],
      listings: active.listings,
    });
    const adapter = new ActiveLocalMarketplaceAdapter({
      getSalesDesk: async () => active,
      getDomainCommerce: async () => detail,
    });

    await expect(adapter.getDomainCommerce("vault.io")).resolves.toEqual(detail);
    await expect(adapter.getDomainCommerce("other.dev")).rejects.toThrow("another domain");
    expect(() => domainDetailCommerceViewModelSchema.parse({
      ...detail,
      listings: [{ ...detail.listings[0], domain: "other.dev" }],
    })).toThrow("must belong to the requested domain");
  });

  it("rejects every Standby write grant", () => {
    const standby = createView("standby_cloud");
    expect(hasMarketplaceActionGrant(standby, "accept_offer")).toBe(false);
    expect(() => salesDeskViewModelSchema.parse({ ...standby, actionGrants: ["accept_offer"] })).toThrow(
      "Standby marketplace reads cannot grant write actions",
    );
  });

  it("requires the exact binding acknowledgement for offer acceptance", () => {
    const offer = createView().offers[0]!;
    expect(createAcceptOfferPlan("plan-accept", offer, false)).toBeNull();
    expect(createAcceptOfferPlan("plan-accept", offer, true)).toMatchObject({
      kind: "accept_offer",
      offerId: "offer-1",
      bindingAcknowledged: true,
      commission: { fee: { amount: "21200" }, net: { amount: "190800" } },
    });
  });

  it("requires transfer confirmation to match item count and target exactly", () => {
    const plan = createTransferActionPlan("plan-transfer", createView().deals[0]!);
    const exact = {
      confirmedItemCount: 1,
      confirmedTarget: { domain: "oxide.dev", buyerDisplay: "buyer·55A" },
      irreversibleOwnershipTransferAcknowledged: true,
    } as const;

    expect(isExactTransferConfirmation(plan, exact)).toBe(true);
    expect(createConfirmedTransferSubmission(plan, exact)).toEqual({ plan, confirmation: exact });
    expect(isExactTransferConfirmation(plan, { ...exact, confirmedItemCount: 2 })).toBe(false);
    expect(createConfirmedTransferSubmission(plan, { ...exact, confirmedItemCount: 2 })).toBeNull();
    expect(isExactTransferConfirmation(plan, {
      ...exact,
      confirmedTarget: { ...exact.confirmedTarget, domain: "other.dev" },
    })).toBe(false);
    expect(isExactTransferConfirmation(plan, {
      ...exact,
      confirmedTarget: { ...exact.confirmedTarget, buyerDisplay: "buyer·other" },
    })).toBe(false);
    expect(isExactTransferConfirmation(plan, { ...exact, irreversibleOwnershipTransferAcknowledged: false })).toBe(false);
  });
});
