import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

import {
  encodeActiveDeviceLeaseSignatureTranscript,
  encodeDesktopAuthorizationGrantSignatureTranscript,
  type DesktopAuthorizationGrant,
} from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

import {
  OpenBaoTransitSigner,
  OpenBaoTransitSigningError,
} from "../src/entrypoints/openbao-transit-signer";
import { OpenBaoAppRoleTokenSource } from "../src/entrypoints/openbao-approle-token-source";
import {
  ACTIVE_DEVICE_LEASE_KEY_PURPOSE,
  type ActiveDeviceLeaseSigner,
} from "../src/modules/devices/postgres-bootstrap-activation";
import {
  DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
  type DesktopAuthorizationGrantSigner,
} from "../src/modules/devices/authorization-grant-issuer";

const lease = {
  schemaVersion: 1,
  typ: "gd.active-device-lease.v1",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/active-device-lease",
  kid: "lease-parent-key",
  accountId: "account-a",
  deviceId: "device-a",
  accountSecurityEpoch: 3,
  jti: "lease-a",
  issuedAt: "2026-08-30T00:00:00Z",
  expiresAt: "2026-08-31T00:00:00Z",
  payload: {
    leaseEpoch: 5,
    renewAfter: "2026-08-30T00:05:00Z",
    onlineExpiresAt: "2026-08-30T00:15:00Z",
    offlineExecuteUntil: "2026-08-31T00:00:00Z",
  },
  signature: Buffer.alloc(64, 1).toString("base64url"),
} as const;

const grantClaims: Omit<DesktopAuthorizationGrant, "kid" | "signature"> = {
  schemaVersion: 3,
  typ: "gd.desktop-authorization-grant.v3",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/local-business",
  issuedAt: lease.issuedAt,
  expiresAt: lease.expiresAt,
  workspace: { workspaceId: "workspace-a", kind: "personal_default" },
  activeDeviceLease: lease,
  scopes: ["workspace:mutate", "workspace:read"],
  commercialAuthority: {
    schemaVersion: 1,
    entitlementRevision: 2,
    entitlementProjectionDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: "active",
    commercialExpiresAt: "2026-08-30T00:00:00Z",
    capability: "cloudflare:dns:observe",
  },
};

describe("OpenBao Transit signer", () => {
  it("uses isolated pinned key versions and returns locally verifiable Grant and Lease envelopes", async () => {
    const grantPair = generateKeyPairSync("ed25519");
    const leasePair = generateKeyPairSync("ed25519");
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const signer = new OpenBaoTransitSigner({
      address: "https://openbao.internal.example",
      namespace: "gooddealer/production",
      mount: "gooddealer-transit",
      grantKey: {
        name: "desktop-authorization-grant",
        version: 7,
        kid: "grant-openbao-v7",
        publicKeyPem: publicKeyPem(grantPair.publicKey),
      },
      leaseKey: {
        name: "active-device-lease",
        version: 11,
        kid: "lease-openbao-v11",
        publicKeyPem: publicKeyPem(leasePair.publicKey),
      },
      tokenSource: {
        token: async () => "short-lived-workload-token",
        invalidate: () => undefined,
      },
      fetch: async (url, init) => {
        calls.push({ url, init });
        const request = JSON.parse(String(init.body)) as { input: string; key_version: number };
        const selected = url.endsWith("/desktop-authorization-grant")
          ? { pair: grantPair, version: 7 }
          : { pair: leasePair, version: 11 };
        expect(request.key_version).toBe(selected.version);
        const signature = sign(null, Buffer.from(request.input, "base64"), selected.pair.privateKey);
        return jsonResponse({
          request_id: `request-${selected.version}`,
          data: { signature: `vault:v${selected.version}:${signature.toString("base64")}` },
        });
      },
    });
    const grantSigner: DesktopAuthorizationGrantSigner = signer;
    const leaseSigner: ActiveDeviceLeaseSigner = signer;

    const grantResult = await grantSigner.sign({
      purpose: DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
      claims: grantClaims,
    });
    const { kid: _kid, signature: _signature, ...leaseClaims } = lease;
    const leaseResult = await leaseSigner.sign({
      purpose: ACTIVE_DEVICE_LEASE_KEY_PURPOSE,
      claims: leaseClaims,
    });

    expect(grantResult.signed).toBe(true);
    expect(leaseResult.signed).toBe(true);
    if (!grantResult.signed || !leaseResult.signed) throw new Error("OpenBao fixture refused signing");
    const grant = grantResult.envelope as DesktopAuthorizationGrant;
    const signedLease = leaseResult.envelope as typeof lease;
    expect(grant.kid).toBe("grant-openbao-v7");
    expect(signedLease.kid).toBe("lease-openbao-v11");
    expect(verify(null, encodeDesktopAuthorizationGrantSignatureTranscript(grant),
      grantResult.verificationKey, Buffer.from(grant.signature, "base64url"))).toBe(true);
    expect(verify(null, encodeActiveDeviceLeaseSignatureTranscript(signedLease),
      leaseResult.verificationKey, Buffer.from(signedLease.signature, "base64url"))).toBe(true);
    expect(grantResult.receipt.byteLength).toBeGreaterThan(32);
    expect(leaseResult.receipt.byteLength).toBeGreaterThan(32);
    expect(calls.map(({ url }) => url)).toEqual([
      "https://openbao.internal.example/v1/gooddealer-transit/sign/desktop-authorization-grant",
      "https://openbao.internal.example/v1/gooddealer-transit/sign/active-device-lease",
    ]);
    for (const { init } of calls) {
      expect(init.redirect).toBe("error");
      expect(init.headers).toMatchObject({
        "x-vault-token": "short-lived-workload-token",
        "x-vault-namespace": "gooddealer/production",
      });
    }
  });

  it("rejects insecure configuration and shared-purpose keys before network access", () => {
    const pair = generateKeyPairSync("ed25519");
    const otherPair = generateKeyPairSync("ed25519");
    const key = {
      name: "shared-key",
      version: 1,
      kid: "shared-v1",
      publicKeyPem: publicKeyPem(pair.publicKey),
    };
    const base = {
      mount: "transit",
      grantKey: key,
      leaseKey: { ...key, kid: "lease-v1" },
      tokenSource: { token: async () => "token", invalidate: () => undefined },
    };
    expect(() => new OpenBaoTransitSigner({ ...base, address: "http://openbao.internal" }))
      .toThrow(/HTTPS origin/u);
    expect(() => new OpenBaoTransitSigner({ ...base, address: "https://openbao.internal" }))
      .toThrow(/purpose-separated/u);
    expect(() => new OpenBaoTransitSigner({
      ...base,
      address: "https://openbao.internal",
      leaseKey: {
        name: "lease",
        version: 1,
        kid: key.kid,
        publicKeyPem: publicKeyPem(otherPair.publicKey),
      },
    })).toThrow(/purpose-separated/u);
    expect(() => new OpenBaoTransitSigner({
      ...base,
      address: "https://openbao.internal",
      leaseKey: { ...key, name: "lease", kid: "lease-v1" },
    })).toThrow(/purpose-separated/u);
  });

  it("fails closed without exposing tokens for wrong versions, invalid signatures, oversized wire, and auth failures", async () => {
    const pair = generateKeyPairSync("ed25519");
    const leasePair = generateKeyPairSync("ed25519");
    const failures = [
      jsonResponse({ request_id: "wrong-version", data: { signature: `vault:v2:${Buffer.alloc(64).toString("base64")}` } }),
      jsonResponse({ request_id: "short-signature", data: { signature: `vault:v1:${Buffer.alloc(63).toString("base64")}` } }),
      jsonResponse({ request_id: "untrusted-signature", data: { signature: `vault:v1:${Buffer.alloc(64).toString("base64")}` } }),
      jsonResponse({ request_id: "oversized", data: { signature: "x" }, padding: "x".repeat(33_000) }),
      jsonResponse({ errors: ["permission denied"] }, 403),
    ];
    const failureCount = failures.length;
    const signer = new OpenBaoTransitSigner({
      address: "https://openbao.internal",
      mount: "transit",
      grantKey: {
        name: "grant",
        version: 1,
        kid: "grant-v1",
        publicKeyPem: publicKeyPem(pair.publicKey),
      },
      leaseKey: {
        name: "lease",
        version: 1,
        kid: "lease-v1",
        publicKeyPem: publicKeyPem(leasePair.publicKey),
      },
      tokenSource: { token: async () => "do-not-leak-this-token", invalidate: () => undefined },
      fetch: async () => failures.shift()!,
    });
    const input = { purpose: DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE, claims: grantClaims } as const;
    for (let index = 0; index < failureCount; index += 1) {
      let observed: unknown;
      try {
        await signer.sign(input);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(OpenBaoTransitSigningError);
      expect(String(observed)).not.toContain("do-not-leak-this-token");
    }
  });

  it("shares reauthentication across concurrent rejected tokens and retries each request once", async () => {
    const pair = generateKeyPairSync("ed25519");
    const leasePair = generateKeyPairSync("ed25519");
    const rejectedTokenBarrier = twoPartyBarrier();
    let login = 0;
    const tokenSource = new OpenBaoAppRoleTokenSource({
      address: "https://openbao.internal",
      requiredPolicy: "authority",
      allowedPolicies: ["authority"],
      credentialsSource: async () => ({ roleId: "role", secretId: "secret" }),
      fetch: async () => {
        login += 1;
        return jsonResponse({
          auth: {
            client_token: `token-${login}`,
            lease_duration: 900,
            policies: ["authority"],
          },
        });
      },
    });
    const observedTokens: string[] = [];
    const signer = new OpenBaoTransitSigner({
      address: "https://openbao.internal",
      mount: "transit",
      grantKey: {
        name: "grant",
        version: 1,
        kid: "grant-v1",
        publicKeyPem: publicKeyPem(pair.publicKey),
      },
      leaseKey: {
        name: "lease",
        version: 1,
        kid: "lease-v1",
        publicKeyPem: publicKeyPem(leasePair.publicKey),
      },
      tokenSource,
      fetch: async (_url, init) => {
        const token = (init.headers as Record<string, string>)["x-vault-token"]!;
        observedTokens.push(token);
        if (token === "token-1") {
          await rejectedTokenBarrier.arrive();
          return jsonResponse({ errors: ["revoked"] }, 403);
        }
        const request = JSON.parse(String(init.body)) as { input: string };
        const signature = sign(null, Buffer.from(request.input, "base64"), pair.privateKey);
        return jsonResponse({
          request_id: "request-after-reauthentication",
          data: { signature: `vault:v1:${signature.toString("base64")}` },
        });
      },
    });

    await expect(Promise.all([signGrant(signer), signGrant(signer)]))
      .resolves.toEqual([expect.objectContaining({ signed: true }), expect.objectContaining({ signed: true })]);
    expect(observedTokens).toHaveLength(4);
    expect(observedTokens.filter((token) => token === "token-1")).toHaveLength(2);
    expect(observedTokens.filter((token) => token === "token-2")).toHaveLength(2);
    expect(login).toBe(2);
  });

  it("cancels streaming 401/403 bodies before retrying and failing", async () => {
    const pair = generateKeyPairSync("ed25519");
    const leasePair = generateKeyPairSync("ed25519");
    let cancelled = 0;
    let tokens = 0;
    const signer = new OpenBaoTransitSigner({
      address: "https://openbao.internal",
      mount: "transit",
      grantKey: {
        name: "grant",
        version: 1,
        kid: "grant-v1",
        publicKeyPem: publicKeyPem(pair.publicKey),
      },
      leaseKey: {
        name: "lease",
        version: 1,
        kid: "lease-v1",
        publicKeyPem: publicKeyPem(leasePair.publicKey),
      },
      tokenSource: {
        token: async () => `token-${tokens += 1}`,
        invalidate: () => undefined,
      },
      fetch: async () => streamingErrorResponse(() => { cancelled += 1; }),
    });

    await expect(signer.sign({
      purpose: DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
      claims: grantClaims,
    })).rejects.toBeInstanceOf(OpenBaoTransitSigningError);
    expect(tokens).toBe(2);
    expect(cancelled).toBe(2);
  });

  it("cancels a streaming successful response with invalid metadata", async () => {
    const pair = generateKeyPairSync("ed25519");
    const leasePair = generateKeyPairSync("ed25519");
    let cancelled = false;
    const signer = new OpenBaoTransitSigner({
      address: "https://openbao.internal",
      mount: "transit",
      grantKey: {
        name: "grant",
        version: 1,
        kid: "grant-v1",
        publicKeyPem: publicKeyPem(pair.publicKey),
      },
      leaseKey: {
        name: "lease",
        version: 1,
        kid: "lease-v1",
        publicKeyPem: publicKeyPem(leasePair.publicKey),
      },
      tokenSource: { token: async () => "token", invalidate: () => undefined },
      fetch: async () => streamingResponse(200, "text/plain", () => { cancelled = true; }),
    });

    await expect(signGrant(signer)).rejects.toBeInstanceOf(OpenBaoTransitSigningError);
    expect(cancelled).toBe(true);
  });
});

function twoPartyBarrier() {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return {
    async arrive() {
      arrivals += 1;
      if (arrivals === 2) release?.();
      await ready;
    },
  };
}

function signGrant(signer: OpenBaoTransitSigner) {
  return signer.sign({
    purpose: DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
    claims: grantClaims,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamingErrorResponse(onCancel: () => void): Response {
  return streamingResponse(403, "application/json", onCancel);
}

function streamingResponse(status: number, contentType: string, onCancel: () => void): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"errors":['));
    },
    cancel() {
      onCancel();
    },
  }), {
    status,
    headers: { "content-type": contentType },
  });
}

function publicKeyPem(key: KeyObject): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}
