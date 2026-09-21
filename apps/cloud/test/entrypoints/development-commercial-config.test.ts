import { describe, expect, it } from "vitest";

import { parseStripeTestProviderConfiguration } from "../../src/entrypoints/development-commercial-config";

const configuration = () => ({
  schemaVersion: 1,
  mode: "stripe_test",
  stripe: {
    apiKey: "sk_test_fixture",
    webhookSecret: "whsec_fixture",
    monthlyPriceId: "price_monthly",
    annualPriceId: "price_annual",
    tenYearPriceId: "price_tenyear",
    campaign: {
      code: "LAUNCH20",
      couponId: "coupon_launch20",
      monthlyAmountMinor: 784,
      annualAmountMinor: 7_840,
      tenYearAmountMinor: 39_840,
    },
  },
  returnUrls: {
    successUrl: "https://account.gooddealer.com/billing/success",
    cancelUrl: "https://account.gooddealer.com/billing/cancel",
  },
  policy: {
    subscriptionPlan: "pro",
    fixedTermPlan: "ten-year",
    featureEntitlements: ["feature:portfolio", "feature:provider-read"],
    offlineGraceSeconds: 259_200,
    credentialRefreshSeconds: 86_400,
  },
});

describe("Stripe test provider configuration", () => {
  it("accepts the exact test-mode deployment shape", () => {
    expect(parseStripeTestProviderConfiguration(configuration())).toMatchObject({
      monthlyPriceId: "price_monthly",
      policy: { subscriptionPlan: "pro", offlineGraceSeconds: 259_200 },
    });
  });

  it("rejects live keys, unexpected fields, unsafe return URLs, and unordered features", () => {
    expect(() => parseStripeTestProviderConfiguration({
      ...configuration(), stripe: { ...configuration().stripe, apiKey: "sk_live_fixture" },
    })).toThrow(/test API key/u);
    expect(() => parseStripeTestProviderConfiguration({ ...configuration(), unexpected: true })).toThrow(/invalid/u);
    expect(() => parseStripeTestProviderConfiguration({
      ...configuration(), returnUrls: { ...configuration().returnUrls, successUrl: "https://evil.example/billing/success" },
    })).toThrow(/return URL/u);
    expect(() => parseStripeTestProviderConfiguration({
      ...configuration(), policy: { ...configuration().policy,
        featureEntitlements: ["feature:provider-read", "feature:portfolio"] },
    })).toThrow(/strictly ascending/u);
  });
});
