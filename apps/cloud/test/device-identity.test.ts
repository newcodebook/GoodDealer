import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  activeDeviceLeaseEnvelopeSchema,
  deviceBindingChallengeSchema,
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
  });

  it("rejects cross-audience and incompatible credential envelopes", () => {
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/active-device-lease.json")).success).toBe(true);
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(false);
    for (const path of [
      "invalid/credential-cross-audience.json",
      "invalid/credential-unknown-field.json",
      "invalid/credential-unknown-version.json",
    ]) {
      expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector(path)).success).toBe(false);
    }
  });
});
