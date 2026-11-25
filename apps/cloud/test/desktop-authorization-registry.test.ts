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
  it("requires an independent bootstrap ring across all four existing authority purposes", () => {
    const grant = signingKey("grant-v1"), lease = signingKey("lease-v1");
    const standby = signingKey("standby-v1"), context = signingKey("context-v1");
    const base = { grantKeys: [grant], leaseKeys: [lease], standbyKeys: [standby], contextKeys: [context] };
    expect(() => createDesktopAuthorizationVerifierRegistry({ ...base, bootstrapKeys: [] })).toThrow("invalid");
    for (const other of [grant, lease, standby, context]) {
      expect(() => createDesktopAuthorizationVerifierRegistry({ ...base,
        bootstrapKeys: [{ ...signingKey("bootstrap-v1"), kid: other.kid }],
      })).toThrow("IDs must be purpose-separated");
      expect(() => createDesktopAuthorizationVerifierRegistry({ ...base,
        bootstrapKeys: [{ ...other, kid: "bootstrap-v1" }],
      })).toThrow("public keys must be purpose-separated");
    }
  });
  it("requires a distinct execution-context ring and rejects reuse of every authority purpose", () => {
    const grant=signingKey("grant-v1"),lease=signingKey("lease-v1"),standby=signingKey("standby-v1");
    const base={bootstrapKeys:[signingKey("bootstrap-v1")],grantKeys:[grant],leaseKeys:[lease],standbyKeys:[standby]};
    expect(()=>createDesktopAuthorizationVerifierRegistry({...base,contextKeys:[]})).toThrow("invalid");
    for(const other of [grant,lease,standby]) {
      expect(()=>createDesktopAuthorizationVerifierRegistry({...base,contextKeys:[{...signingKey("context-v1"),kid:other.kid}]})).toThrow("IDs must be purpose-separated");
      expect(()=>createDesktopAuthorizationVerifierRegistry({...base,contextKeys:[{...other,kid:"context-v1"}]})).toThrow("public keys must be purpose-separated");
    }
  });
  it("rejects a Standby key reusing an Active purpose's ID or material", () => {
    const grant = signingKey("grant-v3");
    const lease = signingKey("lease-v1");
    for (const active of [grant, lease]) {
      expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")], grantKeys: [grant], leaseKeys: [lease], standbyKeys: [{ ...signingKey("standby-v1"), kid: active.kid }] })).toThrow("IDs must be purpose-separated");
      expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")], grantKeys: [grant], leaseKeys: [lease], standbyKeys: [{ ...active, kid: "standby-v1" }] })).toThrow("public keys must be purpose-separated");
    }
  });

  it("converts purpose-separated Ed25519 PEM keys into the strict Desktop registry", () => {
    const oldGrantKey = signingKey("grant-key-v2");
    const grantKey = signingKey("grant-key-v3");
    const oldLeaseKey = signingKey("lease-key-v4");
    const leaseKey = signingKey("lease-key-v5");

    const standbyKey = signingKey("standby-key-v1");
    const contextKey = signingKey("context-v1");
    const bootstrapKey = signingKey("bootstrap-v1");
    const input = { bootstrapKeys: [bootstrapKey], contextKeys: [contextKey],
      standbyKeys: [standbyKey],
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
        { purpose: "standby_grant_v1", keyId: standbyKey.kid, publicKey: standbyKey.raw.toString("base64url") },
        { purpose: "execution_context_v1", keyId: contextKey.kid, publicKey: contextKey.raw.toString("base64url") },
        { purpose: "bootstrap_capability_v1", keyId: bootstrapKey.kid, publicKey: bootstrapKey.raw.toString("base64url") },
      ],
    });
    expect(JSON.parse(serializeDesktopAuthorizationVerifierRegistry(input))).toEqual(registry);
  });

  it("rejects non-Ed25519, duplicate IDs, shared keys, and malformed identifiers", () => {
    const grantKey = signingKey("grant-key-v1");
    const leaseKey = signingKey("lease-key-v1");
    expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")],
      standbyKeys: [signingKey("standby-test")],
      grantKeys: [signingKey("rsa-key", "rsa")], leaseKeys: [leaseKey],
    })).toThrow("must be Ed25519");
    expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")],
      standbyKeys: [signingKey("standby-test")],
      grantKeys: [grantKey], leaseKeys: [{ ...leaseKey, kid: grantKey.kid }],
    })).toThrow("IDs must be purpose-separated");
    expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")],
      standbyKeys: [signingKey("standby-test")],
      grantKeys: [grantKey], leaseKeys: [{ ...grantKey, kid: leaseKey.kid }],
    })).toThrow("public keys must be purpose-separated");
    expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")],
      standbyKeys: [signingKey("standby-test")],
      grantKeys: [{ ...grantKey, kid: "bad key" }], leaseKeys: [leaseKey],
    })).toThrow();
    expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")],
      standbyKeys: [signingKey("standby-test")],
      grantKeys: [grantKey, grantKey], leaseKeys: [leaseKey],
    })).toThrow("duplicated");
    expect(() => createDesktopAuthorizationVerifierRegistry({ bootstrapKeys: [signingKey("bootstrap-v1")], contextKeys: [signingKey("context-v1")],
      standbyKeys: [signingKey("standby-test")],
      grantKeys: [], leaseKeys: [leaseKey],
    })).toThrow("invalid");
  });
});
