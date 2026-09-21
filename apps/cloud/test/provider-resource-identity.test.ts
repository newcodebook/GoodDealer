import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { providerResourceBindingDigest } from "../src/modules/licensing/provider-resource-identity";

describe("Provider resource identity", () => {
  it.each([
    ["stripe", "checkout_session", "cs_test_1"],
    ["paypal", "subscription", "I-SUBSCRIPTION-1"],
  ] as const)("uses the canonical %s binding transcript", (provider, resourceKind, resourceId) => {
    const canonical = createHash("sha256")
      .update(JSON.stringify({ provider, resourceKind, resourceId }))
      .digest();
    const formerDispatchOrder = createHash("sha256")
      .update(JSON.stringify({ resourceKind, resourceId, provider }))
      .digest();

    expect(Buffer.from(providerResourceBindingDigest(provider, resourceKind, resourceId))).toEqual(canonical);
    expect(canonical).not.toEqual(formerDispatchOrder);
  });
});
