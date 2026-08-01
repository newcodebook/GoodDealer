import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  activeDeviceLeaseEnvelopeSchema,
  deviceBindingChallengeSchema,
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

  for (const path of [
    "invalid/challenge-unknown-field.json",
    "invalid/challenge-version-rollback.json",
  ]) {
    it(`rejects ${path}`, () => {
      expect(deviceBindingChallengeSchema.safeParse(vector(path)).success).toBe(false);
    });
  }

  for (const path of [
    "invalid/credential-cross-audience.json",
    "invalid/credential-unknown-field.json",
    "invalid/credential-unknown-version.json",
  ]) {
    it(`rejects ${path}`, () => {
      expect(signedCredentialEnvelopeSchema.safeParse(vector(path)).success).toBe(false);
    });
  }
});
