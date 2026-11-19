import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPublicHttp } from "../../src/entrypoints/http";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { TARGET_BOOTSTRAP_CANCEL_ROUTE, TARGET_BOOTSTRAP_STATUS_ROUTE } from "../../src/entrypoints/routes/public/boundary";
import { denyingPublicApplicationPorts, StaticPublicSessionVerifier } from "../support/public-session";

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const principal = { accountId: "account-target", sessionId: "session-target", clientKind: "desktop" as const };
const headers = { authorization: "Bearer fixture" };
function create({ allowed = true, absent = false, invalid = false, web = false } = {}) {
  const status = vi.fn(async () => invalid ? { schemaVersion: 1, found: false, privateData: "forbidden" } as never : { schemaVersion: 1 as const, found: false as const });
  const cancel = vi.fn(async () => invalid ? null : { schemaVersion: 1 as const, accepted: false as const, code: "SWITCH_NOT_CANCELLABLE" as const });
  const authorize = vi.fn(async (_principal: unknown, role: string) => allowed && role === "active_or_standby");
  const app = createPublicHttp({
    sessions: new StaticPublicSessionVerifier(web ? [{ ...principal, sessionId: "web", clientKind: "account_web" }] : []),
    desktopAccessTokens: { verifyAccessToken: async () => principal },
    preAuthRateLimit: rateLimitPolicy(60_000, 100), sessionRateLimit: rateLimitPolicy(60_000, 100),
    now: () => new Date(), correlationIds: () => "target-bootstrap-test",
    ports: { ...denyingPublicApplicationPorts, desktopRouteAuthority: { authorize }, ...(absent ? {} : { targetBootstrap: { status, cancel } }) },
  });
  apps.push(app);
  return { app, status, cancel, authorize };
}
describe("target bootstrap control routes", () => {
  it("admits bound Desktop roles and delegates strict discovery or exact cancellation", async () => {
    const { app, status, cancel, authorize } = create();
    const discovery = { schemaVersion: 1, requestId: null };
    const lookup = { schemaVersion: 1, requestId: "original-workflow" };
    expect((await app.inject({ method: "POST", url: TARGET_BOOTSTRAP_STATUS_ROUTE, headers, payload: discovery })).json()).toEqual({ schemaVersion: 1, found: false });
    expect((await app.inject({ method: "POST", url: TARGET_BOOTSTRAP_CANCEL_ROUTE, headers, payload: lookup })).json()).toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_NOT_CANCELLABLE" });
    expect(status).toHaveBeenCalledExactlyOnceWith(discovery, principal);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(lookup, principal);
    expect(authorize).toHaveBeenCalledWith(principal, "active_or_standby");
  });
  it("rejects implicit cancel, foreign selectors and oversized wire before the owner", async () => {
    const { app, status, cancel } = create();
    for (const url of [TARGET_BOOTSTRAP_STATUS_ROUTE, TARGET_BOOTSTRAP_CANCEL_ROUTE]) {
      for (const payload of [{ schemaVersion: 1 }, { schemaVersion: 1, requestId: "" }, { schemaVersion: 1, requestId: "a", targetDeviceId: "foreign" }, { schemaVersion: 1, requestId: "a", workspaceId: "foreign" }, { schemaVersion: 1, requestId: "x".repeat(2200) }]) {
        expect([400, 413]).toContain((await app.inject({ method: "POST", url, headers, payload })).statusCode);
      }
    }
    expect((await app.inject({ method: "POST", url: TARGET_BOOTSTRAP_CANCEL_ROUTE, headers, payload: { schemaVersion: 1, requestId: null } })).statusCode).toBe(400);
    expect(status).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  });
  it("hides authority rejection and unavailable composition without calling control", async () => {
    for (const options of [{ allowed: false }, { absent: true }]) {
      const { app, status, cancel } = create(options);
      for (const url of [TARGET_BOOTSTRAP_STATUS_ROUTE, TARGET_BOOTSTRAP_CANCEL_ROUTE]) {
        expect((await app.inject({ method: "POST", url, headers, payload: { schemaVersion: 1, requestId: "a" } })).statusCode).toBe(404);
      }
      expect(status).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    }
  });
  it("rejects Account Web sessions without invoking target control", async () => {
    const { app, status, cancel } = create({ web: true });
    for (const url of [TARGET_BOOTSTRAP_STATUS_ROUTE, TARGET_BOOTSTRAP_CANCEL_ROUTE]) {
      const reply = await app.inject({ method: "POST", url, headers: { cookie: "gd_session=web" }, payload: { schemaVersion: 1, requestId: "a" } });
      expect(reply.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(status).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  });
  it("rejects malformed owner output and final owner authorization denial", async () => {
    const { app } = create({ invalid: true });
    for (const url of [TARGET_BOOTSTRAP_STATUS_ROUTE, TARGET_BOOTSTRAP_CANCEL_ROUTE]) {
      const reply = await app.inject({ method: "POST", url, headers, payload: { schemaVersion: 1, requestId: "a" } });
      expect(reply.statusCode).toBeGreaterThanOrEqual(400);
      expect(reply.body).not.toContain("forbidden");
    }
  });
});
