import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createDesktopAuthorizationVerifierRegistry,
  serializeDesktopAuthorizationVerifierRegistry,
} from "../src/entrypoints/desktop-authorization-registry";

function signingKey(kid: string, type: "ed25519" | "rsa" = "ed25519") {
  const pair = type === "ed25519"
    ? generateKeyPairSync("ed25519")
    : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  return { kid, publicKeyPem, raw: (pair.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32) };
}

describe("Desktop authorization verifier registry", () => {
  it("converts purpose-separated Ed25519 PEM keys into the strict Desktop registry", () => {
    const oldGrantKey = signingKey("grant-key-v2");
    const grantKey = signingKey("grant-key-v3");
    const oldLeaseKey = signingKey("lease-key-v4");
    const leaseKey = signingKey("lease-key-v5");

    const input = {
      grantKeys: [oldGrantKey, grantKey],
      leaseKeys: [oldLeaseKey, leaseKey],
    };
    const registry = createDesktopAuthorizationVerifierRegistry(input);

    expect(registry).toEqual({
      schemaVersion: 1,
      keys: [
        { purpose: "grant_v3", keyId: "grant-key-v2", publicKey: oldGrantKey.raw.toString("base64url") },
        { purpose: "grant_v3", keyId: "grant-key-v3", publicKey: grantKey.raw.toString("base64url") },
        {
          purpose: "active_device_lease_v1",
          keyId: "lease-key-v4",
          publicKey: oldLeaseKey.raw.toString("base64url"),
        },
        {
          purpose: "active_device_lease_v1",
          keyId: "lease-key-v5",
          publicKey: leaseKey.raw.toString("base64url"),
        },
      ],
    });
    expect(JSON.parse(serializeDesktopAuthorizationVerifierRegistry(input))).toEqual(registry);
  });

  it("rejects non-Ed25519, duplicate IDs, shared keys, and malformed identifiers", () => {
    const grantKey = signingKey("grant-key-v1");
    const leaseKey = signingKey("lease-key-v1");
    expect(() => createDesktopAuthorizationVerifierRegistry({
      grantKeys: [signingKey("rsa-key", "rsa")], leaseKeys: [leaseKey],
    })).toThrow("must be Ed25519");
    expect(() => createDesktopAuthorizationVerifierRegistry({
      grantKeys: [grantKey], leaseKeys: [{ ...leaseKey, kid: grantKey.kid }],
    })).toThrow("IDs must be purpose-separated");
    expect(() => createDesktopAuthorizationVerifierRegistry({
      grantKeys: [grantKey], leaseKeys: [{ ...grantKey, kid: leaseKey.kid }],
    })).toThrow("public keys must be purpose-separated");
    expect(() => createDesktopAuthorizationVerifierRegistry({
      grantKeys: [{ ...grantKey, kid: "bad key" }], leaseKeys: [leaseKey],
    })).toThrow();
    expect(() => createDesktopAuthorizationVerifierRegistry({
      grantKeys: [grantKey, grantKey], leaseKeys: [leaseKey],
    })).toThrow("duplicated");
    expect(() => createDesktopAuthorizationVerifierRegistry({
      grantKeys: [], leaseKeys: [leaseKey],
    })).toThrow("invalid");
  });
});
