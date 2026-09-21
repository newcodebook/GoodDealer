import { readFile } from "node:fs/promises";

import {
  createStripeTestProviderComposition,
  type CommercialProviderComposition,
  type StripeTestProviderConfiguration,
} from "./commercial-providers";

const MAXIMUM_CONFIGURATION_BYTES = 32_768;

/** Reads the root-managed Stripe test configuration without copying secrets into process.env. */
export async function readStripeTestProviderComposition(
  path: string,
): Promise<CommercialProviderComposition> {
  if (!path.startsWith("/") || path.includes("\u0000")) {
    throw new TypeError("commercial provider configuration path must be absolute");
  }
  const bytes = await readFile(path);
  if (bytes.length < 1 || bytes.length > MAXIMUM_CONFIGURATION_BYTES) {
    throw new TypeError("commercial provider configuration is invalid");
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return createStripeTestProviderComposition(parseStripeTestProviderConfiguration(JSON.parse(decoded) as unknown));
}

export function parseStripeTestProviderConfiguration(value: unknown): StripeTestProviderConfiguration {
  const root = exactRecord(value, ["schemaVersion", "mode", "stripe", "returnUrls", "policy"]);
  if (root.schemaVersion !== 1 || root.mode !== "stripe_test") {
    throw new TypeError("commercial provider configuration mode is invalid");
  }
  const stripe = exactRecord(root.stripe, [
    "apiKey",
    "webhookSecret",
    "monthlyPriceId",
    "annualPriceId",
    "tenYearPriceId",
    "campaign",
  ]);
  const returnUrls = exactRecord(root.returnUrls, ["successUrl", "cancelUrl"]);
  const policy = exactRecord(root.policy, [
    "subscriptionPlan",
    "fixedTermPlan",
    "featureEntitlements",
    "offlineGraceSeconds",
    "credentialRefreshSeconds",
  ]);
  const campaign = stripe.campaign === null ? null : parseCampaign(stripe.campaign);
  const featureEntitlements = stringArray(policy.featureEntitlements, "feature entitlements");
  if (!strictlyAscending(featureEntitlements)) {
    throw new TypeError("feature entitlements must be strictly ascending");
  }
  return {
    apiKey: secret(stripe.apiKey, /^(?:sk|rk)_test_[A-Za-z0-9_]+$/u, "Stripe test API key"),
    webhookSecret: secret(stripe.webhookSecret, /^whsec_[A-Za-z0-9_]+$/u, "Stripe webhook secret"),
    monthlyPriceId: identifier(stripe.monthlyPriceId, /^price_[A-Za-z0-9]+$/u, "monthly Stripe price"),
    annualPriceId: identifier(stripe.annualPriceId, /^price_[A-Za-z0-9]+$/u, "annual Stripe price"),
    tenYearPriceId: identifier(stripe.tenYearPriceId, /^price_[A-Za-z0-9]+$/u, "ten-year Stripe price"),
    campaign,
    returnUrls: {
      successUrl: exactReturnUrl(returnUrls.successUrl, "/billing/success"),
      cancelUrl: exactReturnUrl(returnUrls.cancelUrl, "/billing/cancel"),
    },
    policy: {
      subscriptionPlan: identifier(policy.subscriptionPlan, /^[a-z][a-z0-9_-]{0,63}$/u, "subscription plan"),
      fixedTermPlan: identifier(policy.fixedTermPlan, /^[a-z][a-z0-9_-]{0,63}$/u, "fixed-term plan"),
      featureEntitlements,
      offlineGraceSeconds: boundedSeconds(policy.offlineGraceSeconds, "offline grace"),
      credentialRefreshSeconds: boundedSeconds(policy.credentialRefreshSeconds, "credential refresh"),
    },
  };
}

function parseCampaign(value: unknown): NonNullable<StripeTestProviderConfiguration["campaign"]> {
  const campaign = exactRecord(value, [
    "code",
    "couponId",
    "monthlyAmountMinor",
    "annualAmountMinor",
    "tenYearAmountMinor",
  ]);
  return {
    code: identifier(campaign.code, /^[A-Z0-9_-]{1,64}$/u, "campaign code"),
    couponId: identifier(campaign.couponId, /^[A-Za-z0-9_-]{1,160}$/u, "Stripe coupon"),
    monthlyAmountMinor: discountedAmount(campaign.monthlyAmountMinor, 980, "monthly campaign amount"),
    annualAmountMinor: discountedAmount(campaign.annualAmountMinor, 9_800, "annual campaign amount"),
    tenYearAmountMinor: discountedAmount(campaign.tenYearAmountMinor, 49_800, "ten-year campaign amount"),
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("commercial provider configuration is invalid");
  }
  const prototype = Object.getPrototypeOf(value);
  const ownKeys = Reflect.ownKeys(value);
  if ((prototype !== Object.prototype && prototype !== null)
    || ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new TypeError("commercial provider configuration is invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => descriptors[key]?.enumerable !== true || !("value" in descriptors[key]!))) {
    throw new TypeError("commercial provider configuration is invalid");
  }
  return value as Record<string, unknown>;
}

function secret(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || value.length > 512 || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function identifier(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function exactReturnUrl(value: unknown, pathname: string): string {
  if (typeof value !== "string") throw new TypeError("commercial return URL is invalid");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== "https://account.gooddealer.com"
    || parsed.pathname !== pathname || parsed.search !== "" || parsed.hash !== ""
    || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("commercial return URL is invalid");
  }
  return parsed.toString();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32
    || value.some((item) => typeof item !== "string" || !/^feature:[a-z0-9-]+$/u.test(item))) {
    throw new TypeError(`${label} is invalid`);
  }
  return [...value];
}

function strictlyAscending(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function boundedSeconds(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 60 || value > 31_536_000) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function discountedAmount(value: unknown, undiscounted: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value >= undiscounted) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
