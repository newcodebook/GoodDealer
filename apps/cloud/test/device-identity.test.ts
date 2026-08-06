import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  activeDeviceLeaseEnvelopeSchema,
  deviceBindingChallengeSchema,
  entitlementEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
} from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

const vectors = resolve(import.meta.dirname, "../../../packages/protocol/test-vectors/device-identity");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

describe("Cloud device identity ingress", () => {
  it("accepts only the shared binding challenge contract", () => {
    expect(deviceBindingChallengeSchema.safeParse(vector("valid/binding-challenge.json")).success).toBe(true);
    expect(deviceBindingChallengeSchema.safeParse(vector("invalid/challenge-unknown-field.json")).success).toBe(false);
    expect(deviceBindingChallengeSchema.safeParse(vector("invalid/challenge-version-rollback.json")).success).toBe(false);
    expect(deviceBindingChallengeSchema.safeParse(vector("invalid/challenge-unsafe-key-version.json")).success).toBe(false);
  });

  it("rejects cross-audience and incompatible credential envelopes", () => {
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/active-device-lease.json")).success).toBe(true);
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(false);
    for (const path of [
      "invalid/credential-cross-audience.json",
      "invalid/credential-unknown-field.json",
      "invalid/credential-unknown-version.json",
      "invalid/credential-unsafe-lease-epoch.json",
      "invalid/credential-invalid-time-order.json",
      "invalid/credential-snake-case-wire.json",
      "invalid/active-lease-offline-window-too-long.json",
    ]) {
      expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector(path)).success).toBe(false);
    }
  });

  it("accepts coherent lifetime and grace entitlement payloads", () => {
    expect(entitlementEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(true);
    expect(entitlementEnvelopeSchema.safeParse(vector("valid/entitlement-grace.json")).success).toBe(true);
    expect(
      entitlementEnvelopeSchema.safeParse(vector("invalid/entitlement-lifetime-expiry.json")).success,
    ).toBe(false);
    expect(
      entitlementEnvelopeSchema.safeParse(vector("invalid/entitlement-missing-commercial-expiry.json")).success,
    ).toBe(false);
    expect(
      entitlementEnvelopeSchema.safeParse(vector("invalid/entitlement-invalid-time.json")).success,
    ).toBe(false);
    expect(
      entitlementEnvelopeSchema.safeParse(vector("invalid/entitlement-expiry-after-grace.json")).success,
    ).toBe(false);
  });

  it("uses the offline credential expiry as accessUntil", () => {
    expect(offlineDeviceLeaseEnvelopeSchema.safeParse(vector("valid/offline-device-lease.json")).success).toBe(true);
    expect(
      offlineDeviceLeaseEnvelopeSchema.safeParse(
        vector("invalid/offline-lease-renewal-after-access.json"),
      ).success,
    ).toBe(false);
  });
});
