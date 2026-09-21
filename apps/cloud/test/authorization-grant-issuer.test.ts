import { generateKeyPairSync, sign } from "node:crypto";

import {
  encodeDesktopAuthorizationGrantSignatureTranscript,
  type DesktopAuthorizationGrant,
} from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

import {
  DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
  DenyingDesktopAuthorizationGrantSigner,
  DesktopAuthorizationGrantIssuer,
  type DesktopAuthorizationGrantSigner,
} from "../src/modules/devices/index";

const lease = {
  schemaVersion: 1,
  typ: "gd.active-device-lease.v1",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/active-device-lease",
  kid: "lease-key-1",
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
  signature: "bGVhc2Utc2lnbmF0dXJl",
} as const;

const commercialSnapshot = {
  sourceEventId: "payment-event-2",
  sourceRevision: 2,
  occurredAt: "2026-08-29T00:00:00Z",
  state: "active",
  licenseId: "license-pro",
  plan: "pro",
  entitlementKind: "subscription",
  commercialExpiresAt: "2026-09-30T00:00:00Z",
  offlineGraceUntil: "2026-10-03T00:00:00Z",
  credentialRefreshDueAt: "2026-09-01T00:00:00Z",
  featureEntitlements: ["cloudflare:dns:observe", "feature:portfolio"],
  versionEntitlement: { kind: "subscription_supported" },
} as const;

describe("Desktop authorization Grant issuer", () => {
  it("publishes only a signer-returned envelope independently verified against exact claims", async () => {
    const issuer = new DesktopAuthorizationGrantIssuer(new FixedGrantSigner(false));
    const result = await issuer.issue({
      accountId: "account-a",
      deviceId: "device-a",
      workspaceId: "workspace-a",
      activeDeviceLease: lease,
      authoritativeEntitlementSnapshot: commercialSnapshot,
      trustedNow: "2026-08-30T00:00:00Z",
    });
    expect(result).toMatchObject({
      issued: true,
      grant: { workspace: { workspaceId: "workspace-a" }, activeDeviceLease: { jti: "lease-a" } },
    });
    expect(result.issued && result.receiptDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("fails closed for disabled signing, subject mismatch, and signer claim substitution", async () => {
    await expect(new DesktopAuthorizationGrantIssuer(
      new DenyingDesktopAuthorizationGrantSigner(),
    ).issue({
      accountId: "account-a",
      deviceId: "device-a",
      workspaceId: "workspace-a",
      activeDeviceLease: lease,
      authoritativeEntitlementSnapshot: commercialSnapshot,
      trustedNow: "2026-08-30T00:00:00Z",
    }))
      .resolves.toEqual({ issued: false, code: "GRANT_SIGNING_DISABLED" });
    await expect(new DesktopAuthorizationGrantIssuer(new FixedGrantSigner(false)).issue({
      accountId: "account-a",
      deviceId: "other-device",
      workspaceId: "workspace-a",
      activeDeviceLease: lease,
      authoritativeEntitlementSnapshot: commercialSnapshot,
      trustedNow: "2026-08-30T00:00:00Z",
    })).rejects.toThrow(/does not match/u);
    await expect(new DesktopAuthorizationGrantIssuer(new FixedGrantSigner(true)).issue({
      accountId: "account-a",
      deviceId: "device-a",
      workspaceId: "workspace-a",
      activeDeviceLease: lease,
      authoritativeEntitlementSnapshot: commercialSnapshot,
      trustedNow: "2026-08-30T00:00:00Z",
    })).rejects.toThrow(/invalid authority/u);
  });

  it.each([
    { state: "grace" },
    { commercialExpiresAt: "2026-08-30T00:00:00Z" },
    { featureEntitlements: ["feature:portfolio"] },
  ])("rejects inactive, expired, or missing-capability commercial authority", async (override) => {
    const signer = new FixedGrantSigner(false);
    await expect(new DesktopAuthorizationGrantIssuer(signer).issue({
      accountId: "account-a",
      deviceId: "device-a",
      workspaceId: "workspace-a",
      activeDeviceLease: lease,
      authoritativeEntitlementSnapshot: { ...commercialSnapshot, ...override },
      trustedNow: "2026-08-30T00:00:00Z",
    })).rejects.toThrow(/commercial authority/u);
    expect(signer.calls).toBe(0);
  });
});

class FixedGrantSigner implements DesktopAuthorizationGrantSigner {
  readonly #privateKey;
  readonly #publicKey;
  calls = 0;

  constructor(private readonly substituteWorkspace: boolean) {
    const pair = generateKeyPairSync("ed25519");
    this.#privateKey = pair.privateKey;
    this.#publicKey = pair.publicKey;
  }

  async sign(input: Parameters<DesktopAuthorizationGrantSigner["sign"]>[0]) {
    this.calls += 1;
    expect(input.purpose).toBe(DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE);
    const envelope: DesktopAuthorizationGrant = {
      ...input.claims,
      workspace: this.substituteWorkspace
        ? { workspaceId: "workspace-substituted", kind: "personal_default" }
        : input.claims.workspace,
      kid: "grant-key-1",
      signature: "AA",
    };
    const signature = sign(
      null,
      encodeDesktopAuthorizationGrantSignatureTranscript(envelope),
      this.#privateKey,
    ).toString("base64url");
    return {
      signed: true as const,
      envelope: { ...envelope, signature },
      verificationKey: this.#publicKey,
      receipt: new Uint8Array([1, 2, 3]),
    };
  }
}
