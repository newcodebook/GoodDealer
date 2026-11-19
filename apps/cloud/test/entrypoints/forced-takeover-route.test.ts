import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPublicHttp } from "../../src/entrypoints/http";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { denyingPublicApplicationPorts, StaticPublicSessionVerifier } from "../support/public-session";
import { FORCED_TAKEOVER_PREVIEW_ROUTE as preview, FORCED_TAKEOVER_STATUS_ROUTE as status,
  FORCED_TAKEOVER_RESOLVE_ROUTE as resolve, FORCED_TAKEOVER_CANCEL_INTENT_ROUTE as cancel } from "../../src/entrypoints/routes/public/forced-takeover";
const principal = { accountId: "account-target", sessionId: "session-target", clientKind: "desktop" as const };
const originalRequest = { schemaVersion: 2, mode: "forced", toDeviceId: "target", expectedSourceLeaseEpoch: 3, idempotencyKey: "original" } as const;
const headers = { authorization: "Bearer fixture", "content-type": "application/json" };
const routes = [ [preview, "preview", { schemaVersion: 1 }], [status, "status", { schemaVersion: 1, requestId: "workflow" }],
  [resolve, "resolve", { schemaVersion: 1, idempotencyKey: "original" }], [cancel, "cancelIntent", { schemaVersion: 1, originalRequest }] ] as const;
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function create(allowed = true, invalid = false) {
  const port = {
    preview: vi.fn(async () => ({ schemaVersion: 1, available: false, reason: "REAUTH_REQUIRED", ...(invalid ? { token: "private" } : {}) } as never)),
    status: vi.fn(async () => ({ schemaVersion: 1, found: false } as const)),
    resolve: vi.fn(async () => ({ schemaVersion: 1, found: false } as const)),
    cancelIntent: vi.fn(async () => ({ schemaVersion: 1, outcome: "cancelled_before_request", originalRequest } as const)),
  };
  const authorize = vi.fn(async () => allowed);
  const app = createPublicHttp({ sessions: new StaticPublicSessionVerifier([]),
    desktopAccessTokens: { verifyAccessToken: async () => principal },
    preAuthRateLimit: rateLimitPolicy(60_000, 100), sessionRateLimit: rateLimitPolicy(60_000, 100),
    now: () => new Date(), correlationIds: () => "forced-test",
    ports: { ...denyingPublicApplicationPorts, forcedTakeover: port, desktopRouteAuthority: { authorize } },
  }); apps.push(app); return { app, port, authorize };
}
describe("forced takeover fixed target HTTP routes", () => {
  it("routes only strict target queries and exact cancellation through role admission", async () => {
    const { app, port, authorize } = create();
    for (const [url, method, payload] of routes) {
      expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(200);
      expect(port[method]).toHaveBeenCalledExactlyOnceWith(payload, principal);
    }
    expect(authorize).toHaveBeenCalledWith(principal, "active_or_standby");
  });
  it("rejects foreign selectors, duplicate escaped keys and unknown original-request fields before invocation", async () => {
    const { app, port } = create();
    for (const [url, method, payload] of routes) {
      for (const body of [{ ...payload, accountId: "foreign" }, { ...payload, targetDeviceId: "foreign" }])
        expect((await app.inject({ method: "POST", url, headers, payload: body })).statusCode).toBe(400);
      const duplicate = JSON.stringify(payload).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1');
      expect((await app.inject({ method: "POST", url, headers, payload: duplicate })).statusCode).toBe(400);
      expect(port[method]).not.toHaveBeenCalled();
    }
    expect((await app.inject({ method: "POST", url: cancel, headers,
      payload: { schemaVersion: 1, originalRequest: { ...originalRequest, reauthProofId: "forbidden" } } })).statusCode).toBe(400);
    expect(port.cancelIntent).not.toHaveBeenCalled();
  });
  it("fails closed on role denial and secret-bearing owner responses", async () => {
    const denied = create(false);
    for (const [url, method, payload] of routes) {
      const response = await denied.app.inject({ method: "POST", url, headers, payload });
      expect(response.statusCode).toBe(404); expect(denied.port[method]).not.toHaveBeenCalled();
    }
    const invalid = create(true, true);
    const response = await invalid.app.inject({ method: "POST", url: preview, headers, payload: { schemaVersion: 1 } });
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain("private");
  });
});
