import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DESKTOP_STANDBY_GRANT_SIGNATURE_DOMAIN,
  desktopAuthorizationGrantRoleRequestSchema,
  desktopAuthorizationGrantRoleResponseSchema,
  desktopAuthorizationGrantSchema,
  desktopStandbyGrantSchema,
  deviceAuthorityProjectionSchema,
  encodeDesktopAuthorizationGrantSignatureTranscript,
  encodeDesktopStandbyGrantSignatureTranscript,
} from "../src/devices/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/standby-grant");
const vector = (path: string): unknown => JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
const standbyGrant = vector("valid/standby-grant.json") as Record<string, unknown>;

const lease = {
  schemaVersion: 1,
  typ: "gd.active-device-lease.v1",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/active-device-lease",
  kid: "lease-key-1",
  accountId: "account-local",
  deviceId: "device-local",
  accountSecurityEpoch: 4,
  jti: "lease-local",
  issuedAt: "2026-08-29T00:00:00Z",
  expiresAt: "2026-08-30T00:00:00Z",
  payload: {
    leaseEpoch: 7,
    renewAfter: "2026-08-29T06:00:00Z",
    onlineExpiresAt: "2026-08-29T12:00:00Z",
    offlineExecuteUntil: "2026-08-30T00:00:00Z",
  },
  signature: "fixture-signature",
} as const;
const activeGrant = {
  schemaVersion: 3,
  typ: "gd.desktop-authorization-grant.v3",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/local-business",
  kid: "grant-key-1",
  issuedAt: lease.issuedAt,
  expiresAt: lease.expiresAt,
  workspace: { workspaceId: "workspace-local", kind: "personal_default" },
  activeDeviceLease: lease,
  scopes: ["workspace:mutate", "workspace:read"],
  commercialAuthority: {
    schemaVersion: 1,
    entitlementRevision: 9,
    entitlementProjectionDigest: "a".repeat(64),
    state: "active",
    commercialExpiresAt: "2026-08-29T23:00:00Z",
    capability: "cloudflare:dns:observe",
  },
  signature: "fixture-grant-signature",
} as const;

describe("Desktop Standby Grant and role exchange (ADR-0032 Standby S3)", () => {
  it("accepts the read-only Standby Grant and pins its signature transcript for the Host", () => {
    expect(desktopStandbyGrantSchema.parse(standbyGrant)).toEqual(standbyGrant);
    const transcript = encodeDesktopStandbyGrantSignatureTranscript(standbyGrant);
    // The transcript names its own domain and never the signature it is signed into.
    expect(Buffer.from(transcript).toString("utf8")).toContain(DESKTOP_STANDBY_GRANT_SIGNATURE_DOMAIN);
    expect(Buffer.from(transcript).toString("utf8")).not.toContain(String(standbyGrant.signature));
    // The Host verifier (T3) reuses this vector and must reach the same digest.
    expect(createHash("sha256").update(transcript).digest("base64url")).toBe("flcU9oAsGcmEfUhVif4nF5vEvYa-61L1CS2DjsohAkM");
  });

  it("rejects every Standby Grant that carries execution authority or leaves its window", () => {
    const invalid = readdirSync(resolve(vectors, "invalid")).filter((name) => !name.startsWith("role-"));
    expect(invalid.length).toBeGreaterThanOrEqual(10);
    for (const name of invalid) {
      expect(desktopStandbyGrantSchema.safeParse(vector(`invalid/${name}`)).success, name).toBe(false);
    }
  });

  it("grants a Standby device exactly the scopes its authority projection allows", () => {
    const scopes = desktopStandbyGrantSchema.parse(standbyGrant).scopes;
    expect(deviceAuthorityProjectionSchema.safeParse({ schemaVersion: 1, role: "standby", scopes }).success).toBe(true);
    // The Active Grant's scopes would be refused for a Standby device, so the two cannot be swapped.
    expect(deviceAuthorityProjectionSchema.safeParse({ schemaVersion: 1, role: "standby", scopes: activeGrant.scopes }).success)
      .toBe(false);
  });

  it("keeps the two Grant shapes mutually unparseable and their transcripts domain-separated", () => {
    expect(desktopAuthorizationGrantSchema.safeParse(standbyGrant).success).toBe(false);
    expect(desktopStandbyGrantSchema.safeParse(activeGrant).success).toBe(false);
    expect(() => encodeDesktopStandbyGrantSignatureTranscript(activeGrant)).toThrow();
    expect(() => encodeDesktopAuthorizationGrantSignatureTranscript(standbyGrant)).toThrow();
  });

  it("asks for a Grant without naming a role and answers only with the Grant of the stated role", () => {
    expect(desktopAuthorizationGrantRoleRequestSchema.parse(vector("valid/role-request.json"))).toEqual({ schemaVersion: 4 });
    expect(desktopAuthorizationGrantRoleResponseSchema.parse(vector("valid/role-response-standby.json")))
      .toEqual({ schemaVersion: 4, role: "standby", grant: standbyGrant });
    expect(desktopAuthorizationGrantRoleResponseSchema.parse({ schemaVersion: 4, role: "active", grant: activeGrant }))
      .toEqual({ schemaVersion: 4, role: "active", grant: activeGrant });
    for (const name of ["role-request-names-a-role.json", "role-request-v3.json"]) {
      expect(desktopAuthorizationGrantRoleRequestSchema.safeParse(vector(`invalid/${name}`)).success, name).toBe(false);
    }
    for (const value of [
      vector("invalid/role-response-standby-with-v3-grant.json"),
      vector("invalid/role-response-missing-role.json"),
      vector("invalid/role-response-bare-standby-grant.json"),
      { schemaVersion: 4, role: "active", grant: standbyGrant },
      { schemaVersion: 4, role: "standby", grant: activeGrant },
      { schemaVersion: 4, role: "none", grant: standbyGrant },
      { schemaVersion: 3, role: "standby", grant: standbyGrant },
      { schemaVersion: 4, role: "standby", grant: standbyGrant, lease },
      activeGrant,
    ]) {
      expect(desktopAuthorizationGrantRoleResponseSchema.safeParse(value).success).toBe(false);
    }
  });
});
