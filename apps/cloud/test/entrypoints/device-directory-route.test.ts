import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import { DEVICE_LIST_ROUTE, DEVICE_SELF_REPORT_ROUTE } from "../../src/entrypoints/routes/public/boundary";
import { StaticPublicSessionVerifier } from "../support/public-session";

const principal = { accountId: "account-devices", sessionId: "session-devices", clientKind: "desktop" as const };
const list = {
  schemaVersion: 1 as const,
  listRevision: 3,
  devices: [{
    schemaVersion: 1 as const, deviceId: "device-a", platform: "linux" as const, displayName: "studio",
    status: "bound" as const, role: "standby" as const, credentialEpoch: 1, signingKeyId: "key-a",
    signingKeyVersion: 1, signingKeyStatus: "active" as const, boundAt: "2026-11-18T01:20:00Z",
    lastSeenAt: "2026-11-18T01:00:00Z", removedAt: null, currentDevice: true,
  }],
};
const report = { schemaVersion: 1, platform: "linux", displayName: "studio" };

describe("device directory public routes (ADR-0032 S3a)", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

  function create(options: { directory?: boolean; denied?: boolean; hostile?: boolean } = {}) {
    const respond = vi.fn(async () => (options.denied === true ? null
      : options.hostile === true ? { ...list, devices: [{ ...list.devices[0], role: "active", status: "removed" }] } as never : list));
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([]),
      desktopAccessTokens: { async verifyAccessToken(token) { return token === "devices-token" ? principal : null; } },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-11-18T02:00:00Z"),
      correlationIds: () => "devices-route-correlation",
      ports: {
        accountActivation: { activate: async () => null },
        desktopAuthorization: { issue: async () => null },
        commercialCheckout: {
          createCheckout: async () => null, readStatus: async () => null,
          cancelSubscription: async () => null, confirmFixedTerm: async () => null,
          requestFirstPurchaseRefund: async () => null, readFirstPurchaseRefundStatus: async () => null,
          claimApprovalRedirect: async () => null,
        },
        ...(options.directory === false ? {} : { deviceDirectory: { list: respond, reportSelf: respond } }),
      },
    });
    apps.push(app);
    return { app, respond };
  }
  const headers = { authorization: "Bearer devices-token" };

  it("serves the list and a self-report only to a verified Desktop bearer", async () => {
    const { app, respond } = create();
    const listed = await app.inject({ method: "POST", url: DEVICE_LIST_ROUTE, headers, payload: { schemaVersion: 1 } });
    const reported = await app.inject({ method: "POST", url: DEVICE_SELF_REPORT_ROUTE, headers, payload: report });
    expect([listed.statusCode, reported.statusCode]).toEqual([200, 200]);
    expect(listed.json()).toEqual(list);
    expect(respond).toHaveBeenCalledWith(report, principal);
    const cookie = await app.inject({ method: "POST", url: DEVICE_LIST_ROUTE, headers: { cookie: "gd_session=unknown" }, payload: { schemaVersion: 1 } });
    expect(cookie.statusCode).toBe(401);
    const unknownBearer = await app.inject({ method: "POST", url: DEVICE_SELF_REPORT_ROUTE, headers: { authorization: "Bearer other" }, payload: report });
    expect(unknownBearer.statusCode).toBe(401);
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("rejects a named device, a foreign account, or an invalid report before the service runs", async () => {
    const { app, respond } = create();
    for (const [url, payload] of [
      [DEVICE_LIST_ROUTE, { schemaVersion: 1, accountId: "account-other" }],
      [DEVICE_SELF_REPORT_ROUTE, { ...report, deviceId: "device-b" }],
      [DEVICE_SELF_REPORT_ROUTE, { ...report, platform: "solaris" }],
      [DEVICE_SELF_REPORT_ROUTE, { ...report, displayName: "a\u0007b" }],
      [DEVICE_SELF_REPORT_ROUTE, { ...report, displayName: "" }],
    ] as const) {
      const response = await app.inject({ method: "POST", url, headers, payload });
      expect(response.statusCode).toBe(400);
    }
    const oversized = await app.inject({ method: "POST", url: DEVICE_SELF_REPORT_ROUTE, headers, payload: { ...report, displayName: "x".repeat(2048) } });
    expect(oversized.statusCode).toBe(413);
    expect(respond).not.toHaveBeenCalled();
  });

  it("hides a denial's reason and never sends a list outside the contract", async () => {
    const denied = await create({ denied: true }).app.inject({ method: "POST", url: DEVICE_LIST_ROUTE, headers, payload: { schemaVersion: 1 } });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
    expect(denied.json()).not.toHaveProperty("devices");
    const hostile = await create({ hostile: true }).app.inject({ method: "POST", url: DEVICE_LIST_ROUTE, headers, payload: { schemaVersion: 1 } });
    expect(hostile.statusCode).toBeGreaterThanOrEqual(500);
    expect(hostile.json()).not.toHaveProperty("devices");
  });

  it("does not register the device routes without a composed service", async () => {
    const response = await create({ directory: false }).app.inject({ method: "POST", url: DEVICE_LIST_ROUTE, headers, payload: { schemaVersion: 1 } });
    expect(response.statusCode).toBe(404);
  });
});
