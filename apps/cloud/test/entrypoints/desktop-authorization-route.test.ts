import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopAuthorizationGrant } from "@gooddealer/protocol/devices";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import { DESKTOP_AUTHORIZATION_GRANT_ROUTE } from "../../src/entrypoints/routes/public/boundary";
import { StaticPublicSessionVerifier } from "../support/public-session";

const grant: DesktopAuthorizationGrant = {
  schemaVersion: 3,
  typ: "gd.desktop-authorization-grant.v3",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/local-business",
  kid: "grant-key-1",
  issuedAt: "2026-08-29T00:00:00Z",
  expiresAt: "2026-08-30T00:00:00Z",
  workspace: { workspaceId: "workspace-1", kind: "personal_default" },
  activeDeviceLease: {
    schemaVersion: 1,
    typ: "gd.active-device-lease.v1",
    iss: "https://accounts.gooddealer.com",
    aud: "gooddealer-desktop/active-device-lease",
    kid: "lease-key-1",
    accountId: "account-desktop",
    deviceId: "device-1",
    accountSecurityEpoch: 3,
    jti: "lease-1",
    issuedAt: "2026-08-29T00:00:00Z",
    expiresAt: "2026-08-30T00:00:00Z",
    payload: {
      leaseEpoch: 4,
      renewAfter: "2026-08-29T00:05:00Z",
      onlineExpiresAt: "2026-08-29T00:15:00Z",
      offlineExecuteUntil: "2026-08-30T00:00:00Z",
    },
    signature: "lease-signature",
  },
  scopes: ["workspace:mutate", "workspace:read"],
  commercialAuthority: {
    schemaVersion: 1,
    entitlementRevision: 2,
    entitlementProjectionDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: "active",
    commercialExpiresAt: "2026-08-29T23:00:00Z",
    capability: "cloudflare:dns:observe",
  },
  signature: "grant-signature",
};

describe("Desktop authorization Grant HTTP route", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  function create(issue = vi.fn(async (): Promise<DesktopAuthorizationGrant | null> => grant)) {
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([
        { sessionId: "web-session", accountId: "account-web", clientKind: "account_web" },
      ]),
      desktopAccessTokens: {
        async verifyAccessToken(token) {
          return token === "desktop-access-token"
            ? { accountId: "account-desktop", sessionId: "desktop-session", clientKind: "desktop" }
            : null;
        },
      },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-08-29T00:00:00Z"),
      correlationIds: () => "grant-correlation",
      ports: {
        accountActivation: { activate: async () => null },
        desktopAuthorization: { issue },
        commercialCheckout: {
          createCheckout: async () => null,
          readStatus: async () => null,
          cancelSubscription: async () => null,
          confirmFixedTerm: async () => null,
          requestFirstPurchaseRefund: async () => null,
          readFirstPurchaseRefundStatus: async () => null,
          claimApprovalRedirect: async () => null,
        },
      },
    });
    apps.push(app);
    return { app, issue };
  }

  it("derives authorization scope only from the authenticated Desktop principal", async () => {
    const { app, issue } = create();
    const result = await app.inject({
      method: "POST",
      url: DESKTOP_AUTHORIZATION_GRANT_ROUTE,
      headers: { authorization: "Bearer desktop-access-token" },
      payload: { schemaVersion: 3 },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(grant);
    expect(issue).toHaveBeenCalledWith(
      { schemaVersion: 3 },
      { accountId: "account-desktop", sessionId: "desktop-session", clientKind: "desktop" },
    );
  });

  it("accepts the exact request body emitted by the production Desktop host", async () => {
    const body = readFileSync(
      new URL(
        "../../../../packages/protocol/test-vectors/device-identity/valid/desktop-authorization-request.json",
        import.meta.url,
      ),
      "utf8",
    );
    const { app, issue } = create();
    const result = await app.inject({
      method: "POST",
      url: DESKTOP_AUTHORIZATION_GRANT_ROUTE,
      headers: { authorization: "Bearer desktop-access-token" },
      payload: JSON.parse(body),
    });
    expect(result.statusCode).toBe(200);
    expect(issue).toHaveBeenCalledWith(
      { schemaVersion: 3 },
      { accountId: "account-desktop", sessionId: "desktop-session", clientKind: "desktop" },
    );
  });

  it("rejects caller-selected authority before invoking the application port", async () => {
    const { app, issue } = create();
    const result = await app.inject({
      method: "POST",
      url: DESKTOP_AUTHORIZATION_GRANT_ROUTE,
      headers: { authorization: "Bearer desktop-access-token" },
      payload: { schemaVersion: 3, deviceId: "attacker-device" },
    });

    expect(result.statusCode).toBe(400);
    expect(result.json()).toEqual({
      schemaVersion: 1,
      code: "SCHEMA_INVALID",
      correlationId: "grant-correlation",
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it("hides wrong-client and application denials behind the same not-found identity", async () => {
    const wrongClient = create();
    const wrongClientResult = await wrongClient.app.inject({
      method: "POST",
      url: DESKTOP_AUTHORIZATION_GRANT_ROUTE,
      headers: { cookie: "gd_session=web-session" },
      payload: { schemaVersion: 3 },
    });
    expect(wrongClientResult.statusCode).toBe(404);
    expect(wrongClient.issue).not.toHaveBeenCalled();

    const denied = create(vi.fn(async () => null));
    const deniedResult = await denied.app.inject({
      method: "POST",
      url: DESKTOP_AUTHORIZATION_GRANT_ROUTE,
      headers: { authorization: "Bearer desktop-access-token" },
      payload: { schemaVersion: 3 },
    });
    expect(deniedResult.statusCode).toBe(404);
    expect(wrongClientResult.json()).toEqual(deniedResult.json());
  });
});
