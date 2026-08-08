import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  activeDeviceLeaseEnvelopeSchema,
  deviceBindingChallengeSchema,
  entitlementEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  signedCredentialEnvelopeSchema,
} from "../src/devices/device-identity";

const vectors = resolve(import.meta.dirname, "../test-vectors/device-identity");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

describe("device identity contract", () => {
  it("accepts a binding challenge", () => {
    expect(deviceBindingChallengeSchema.safeParse(vector("valid/binding-challenge.json")).success).toBe(true);
  });

  it("accepts a type-isolated active device lease", () => {
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/active-device-lease.json")).success).toBe(true);
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(false);
    expect(signedCredentialEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(true);
  });

  it("binds offline lease renewal to the outer access deadline", () => {
    expect(offlineDeviceLeaseEnvelopeSchema.safeParse(vector("valid/offline-device-lease.json")).success).toBe(true);
    expect(
      offlineDeviceLeaseEnvelopeSchema.safeParse(vector("invalid/offline-lease-renewal-after-access.json")).success,
    ).toBe(false);
  });

  it("separates a lifetime commercial entitlement from credential expiry", () => {
    expect(entitlementEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(true);
    expect(entitlementEnvelopeSchema.safeParse(vector("valid/entitlement-grace.json")).success).toBe(true);
    expect(
      entitlementEnvelopeSchema.safeParse(vector("invalid/entitlement-lifetime-expiry.json")).success,
    ).toBe(false);
  });

  for (const path of [
    "invalid/challenge-unknown-field.json",
    "invalid/challenge-version-rollback.json",
    "invalid/challenge-unsafe-key-version.json",
  ]) {
    it(`rejects ${path}`, () => {
      expect(deviceBindingChallengeSchema.safeParse(vector(path)).success).toBe(false);
    });
  }

  for (const path of [
    "invalid/credential-cross-audience.json",
    "invalid/credential-unknown-field.json",
    "invalid/credential-unknown-version.json",
    "invalid/credential-unsafe-lease-epoch.json",
    "invalid/credential-invalid-time-order.json",
    "invalid/credential-snake-case-wire.json",
    "invalid/entitlement-lifetime-expiry.json",
    "invalid/entitlement-missing-commercial-expiry.json",
    "invalid/entitlement-invalid-time.json",
    "invalid/entitlement-expiry-after-grace.json",
    "invalid/active-lease-offline-window-too-long.json",
    "invalid/offline-lease-renewal-after-access.json",
  ]) {
    it(`rejects ${path}`, () => {
      expect(signedCredentialEnvelopeSchema.safeParse(vector(path)).success).toBe(false);
    });
  }
});
