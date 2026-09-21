import { describe, expect, it } from "vitest";

import {
  CommercialCheckoutCatalog,
  CommercialCheckoutUnavailableError,
} from "../src/modules/licensing/commercial-checkout";
import { CommercialSubscriptionPlanCatalog } from "../src/modules/licensing/commercial-plan-catalog";

describe("commercial checkout catalog", () => {
  const catalog = new CommercialCheckoutCatalog([
    {
      provider: "stripe",
      offer: "monthly",
      campaignCode: null,
      providerItemId: "price_monthly",
      providerDiscountId: null,
      currency: "USD",
      amountMinor: 980,
    },
    {
      provider: "stripe",
      offer: "monthly",
      campaignCode: "LAUNCH",
      providerItemId: "price_monthly",
      providerDiscountId: "coupon_launch",
      currency: "USD",
      amountMinor: 780,
    },
    {
      provider: "paypal",
      offer: "ten_year",
      campaignCode: null,
      providerItemId: "GOODDEALER-TEN-YEAR",
      providerDiscountId: null,
      currency: "USD",
      amountMinor: 49_800,
    },
  ]);

  it("maps case-insensitive GoodDealer campaigns to provider-owned objects", () => {
    expect(catalog.resolve("stripe", "monthly", "launch")).toMatchObject({
      campaignCode: "LAUNCH",
      providerItemId: "price_monthly",
      providerDiscountId: "coupon_launch",
      purchaseKind: "subscription",
    });
  });

  it("models the 10-year offer as fixed-term rather than perpetual or recurring", () => {
    expect(catalog.resolve("paypal", "ten_year", null)).toMatchObject({
      amountMinor: 49_800,
      purchaseKind: "fixed_term",
    });
  });

  it("fails closed for unknown campaigns, provider items, and duplicate mappings", () => {
    expect(() => catalog.resolve("stripe", "monthly", "UNKNOWN"))
      .toThrow(CommercialCheckoutUnavailableError);
    expect(() => new CommercialCheckoutCatalog([
      {
        provider: "stripe",
        offer: "annual",
        campaignCode: null,
        providerItemId: "price_a",
        providerDiscountId: null,
        currency: "USD",
        amountMinor: 9_800,
      },
      {
        provider: "stripe",
        offer: "annual",
        campaignCode: null,
        providerItemId: "price_b",
        providerDiscountId: null,
        currency: "USD",
        amountMinor: 9_800,
      },
    ])).toThrow(/duplicated/u);
  });

  it("rejects a sellable subscription without an entitlement plan mapping", () => {
    const plans = new CommercialSubscriptionPlanCatalog([{
      provider: "stripe",
      providerPlanId: "price_other",
      plan: "pro",
      featureEntitlements: ["feature:portfolio"],
      offlineGraceSeconds: 86_400,
      credentialRefreshSeconds: 3_600,
    }]);
    expect(() => catalog.assertSubscriptionPlans(plans)).toThrow(/no entitlement plan mapping/u);
  });
});
