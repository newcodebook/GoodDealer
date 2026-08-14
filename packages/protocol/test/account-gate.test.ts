import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accountGateStatusSchema,
  accountRejectionCodeSchema,
  accountRejectionSchema,
  entitlementProjectionSchema,
} from "../src/account/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/account");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

const validCases = [
  ["entitlement-projection-lifetime.json", entitlementProjectionSchema],
  ["entitlement-projection-subscription-active.json", entitlementProjectionSchema],
  ["entitlement-projection-subscription-grace.json", entitlementProjectionSchema],
  ["gate-active-eligible.json", accountGateStatusSchema],
  ["gate-standby-eligible.json", accountGateStatusSchema],
  ["gate-locked.json", accountGateStatusSchema],
  ["rejection-rate-limited.json", accountRejectionSchema],
  ["rejection-device-removed.json", accountRejectionSchema],
] as const;

const invalidCases = [
  ["entitlement-projection-lifetime-with-expiry.json", entitlementProjectionSchema],
  ["entitlement-projection-subscription-all-major-versions.json", entitlementProjectionSchema],
  ["entitlement-projection-expiry-after-grace.json", entitlementProjectionSchema],
  ["entitlement-projection-refresh-after-grace.json", entitlementProjectionSchema],
  ["entitlement-projection-unsorted-features.json", entitlementProjectionSchema],
  ["entitlement-projection-with-payment-watermark.json", entitlementProjectionSchema],
  ["gate-active-with-failed-check.json", accountGateStatusSchema],
  ["gate-standby-with-active-lease-pass.json", accountGateStatusSchema],
  ["gate-locked-without-reason.json", accountGateStatusSchema],
  ["gate-reason-without-locked.json", accountGateStatusSchema],
  ["gate-locked-all-checks-pass.json", accountGateStatusSchema],
  ["rejection-retry-after-on-non-rate-limited.json", accountRejectionSchema],
  ["rejection-non-retryable-marked-retryable.json", accountRejectionSchema],
  ["rejection-with-message-field.json", accountRejectionSchema],
] as const;

describe("account entitlement, gate, and rejection contracts", () => {
  for (const [path, schema] of validCases) {
    it(`accepts valid/${path}`, () => {
      expect(schema.safeParse(vector(`valid/${path}`)).success).toBe(true);
    });
  }

  for (const [path, schema] of invalidCases) {
    it(`rejects invalid/${path}`, () => {
      expect(schema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  it("does not over-constrain a lifetime grace projection (INV-16)", () => {
    const lifetime = vector("valid/entitlement-projection-lifetime.json");
    expect(entitlementProjectionSchema.safeParse({ ...(lifetime as object), state: "grace" }).success).toBe(true);
  });

  it("freezes all 20 account rejection codes", () => {
    expect(accountRejectionCodeSchema.options).toHaveLength(20);
  });
});
