import { describe, expect, it } from "vitest";

import { createCommercialProviderComposition } from "../../src/entrypoints/commercial-providers";

const stripeOnlyConfiguration = () => ({
  stripe: {
    apiKey: "sk_test_fixture",
    webhookSecret: "whsec_fixture",
  },
  returnUrls: {
    successUrl: "https://account.gooddealer.com/billing/success",
    cancelUrl: "https://account.gooddealer.com/billing/cancel",
  },
  checkouts: [{
    provider: "stripe" as const,
    offer: "monthly" as const,
    campaignCode: null,
    providerItemId: "price_monthly",
    providerDiscountId: null,
    currency: "USD" as const,
    amountMinor: 980,
  }],
  subscriptionPlans: [{
    provider: "stripe" as const,
    providerPlanId: "price_monthly",
    plan: "pro",
    featureEntitlements: ["feature:portfolio"],
    offlineGraceSeconds: 259_200,
    credentialRefreshSeconds: 86_400,
  }],
  fixedTermPolicy: {
    plan: "ten-year",
    featureEntitlements: ["feature:portfolio"],
    offlineGraceSeconds: 259_200,
    credentialRefreshSeconds: 86_400,
  },
});

describe("commercial provider production composition", () => {
  it("accepts a Stripe-only launch and keeps optional PayPal boundaries closed", async () => {
    const composition = createCommercialProviderComposition(stripeOnlyConfiguration());

    expect(composition.checkoutCatalog.resolve("stripe", "monthly", null)).toMatchObject({
      provider: "stripe",
      providerItemId: "price_monthly",
    });
    expect(() => composition.checkoutCatalog.resolve("paypal", "monthly", null)).toThrow();
    await expect(composition.paypalWebhook.authenticate(Buffer.from("{}"), {}, new Date()))
      .rejects.toThrow(/not configured/u);
  });

  it("rejects PayPal catalog entries unless PayPal is explicitly configured", () => {
    const configuration = stripeOnlyConfiguration();
    expect(() => createCommercialProviderComposition({
      ...configuration,
      checkouts: [{
        provider: "paypal",
        offer: "monthly",
        campaignCode: null,
        providerItemId: "paypal-monthly",
        providerDiscountId: null,
        currency: "USD",
        amountMinor: 980,
      }],
      subscriptionPlans: [{
        provider: "paypal",
        providerPlanId: "paypal-monthly",
        plan: "pro",
        featureEntitlements: ["feature:portfolio"],
        offlineGraceSeconds: 259_200,
        credentialRefreshSeconds: 86_400,
      }],
    })).toThrow(/PayPal catalog entries require configured PayPal credentials/u);
  });
});
