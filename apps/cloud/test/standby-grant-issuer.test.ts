import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";
import { type DesktopStandbyGrant, encodeDesktopStandbyGrantSignatureTranscript } from "@gooddealer/protocol/devices";
import { DesktopStandbyGrantIssuer, DESKTOP_STANDBY_GRANT_KEY_PURPOSE, type DesktopStandbyGrantSigner } from "../src/modules/devices/standby-grant-issuer";

const claims: Omit<DesktopStandbyGrant, "kid" | "signature"> = {
  schemaVersion: 1, typ: "gd.desktop-standby-grant.v1", iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/standby", issuedAt: "2026-11-18T00:00:00Z", expiresAt: "2026-11-18T00:15:00Z",
  accountId: "account-a", deviceId: "device-a", accountSecurityEpoch: 2, leaseEpochFloor: 7,
  workspace: { workspaceId: "workspace-a", kind: "personal_default" }, scopes: ["workspace:read"],
};

describe("Standby purpose-specific issuer", () => {
  it("publishes exactly the requested read-only claims using its independent purpose", async () => {
    const issuer = new DesktopStandbyGrantIssuer(signer());
    await expect(issuer.issue(claims)).resolves.toMatchObject(claims);
  });
  it.each([
    ["account", { accountId: "account-b" }], ["workspace", { workspace: { workspaceId: "workspace-b", kind: "personal_default" } }],
    ["epoch", { leaseEpochFloor: 6 }], ["role escalation", { scopes: ["workspace:read", "workspace:mutate"] }],
    ["extra authority", { activeDeviceLease: {} }],
  ])("rejects signer substitution of %s", async (_label, changes) => {
    await expect(new DesktopStandbyGrantIssuer(signer(changes)).issue(claims)).rejects.toThrow();
  });
  it("rejects a valid Ed25519 signature over a different purpose transcript", async () => {
    await expect(new DesktopStandbyGrantIssuer(signer({}, true)).issue(claims)).rejects.toThrow("invalid authority");
  });
  it("returns no authority when signing is unavailable", async () => {
    await expect(new DesktopStandbyGrantIssuer({ sign: async () => ({ signed: false }) }).issue(claims)).resolves.toBeNull();
  });
});
function signer(changes: Record<string, unknown> = {}, wrongPurpose = false): DesktopStandbyGrantSigner {
  const pair = generateKeyPairSync("ed25519");
  return { async sign(input) {
    expect(input.purpose).toBe(DESKTOP_STANDBY_GRANT_KEY_PURPOSE);
    const draft = { ...input.claims, ...changes, kid: "standby-v1", signature: "AA" };
    const transcript = wrongPurpose ? encodeDomainSeparatedWireValue("GOODDEALER-ACTIVE-DEVICE-LEASE-V1", draft)
      : encodeDesktopStandbyGrantSignatureTranscript(draft as DesktopStandbyGrant);
    return { signed: true, envelope: { ...draft, signature: sign(null, transcript, pair.privateKey).toString("base64url") },
      verificationKey: pair.publicKey, receipt: Buffer.from("test") };
  } };
}
