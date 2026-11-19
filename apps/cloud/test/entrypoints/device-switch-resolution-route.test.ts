import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DeviceSwitchRequestResolutionResponse } from "@gooddealer/protocol/devices";
import { createPublicHttp } from "../../src/entrypoints/http";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { DEVICE_SWITCH_RESOLVE_ROUTE } from "../../src/entrypoints/routes/public/boundary";
import { denyingPublicApplicationPorts, StaticPublicSessionVerifier } from "../support/public-session";

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const principal = { accountId: "account-source", sessionId: "session-source", clientKind: "desktop" as const };
const request = { schemaVersion: 1, idempotencyKey: "request-original" };
const response: DeviceSwitchRequestResolutionResponse = { ...request, schemaVersion: 1, outcome: "not_found" };
function create(options: { allowed?: boolean; response?: DeviceSwitchRequestResolutionResponse | null; absent?: boolean } = {}) {
  const resolve = vi.fn(async () => options.response === undefined ? response : options.response);
  const authorize = vi.fn(async (_principal: unknown, role: string) => options.allowed !== false && role === "active_or_standby");
  const app = createPublicHttp({
    sessions: new StaticPublicSessionVerifier([]),
    desktopAccessTokens: { verifyAccessToken: async () => principal },
    preAuthRateLimit: rateLimitPolicy(60000, 100), sessionRateLimit: rateLimitPolicy(60000, 100),
    now: () => new Date(), correlationIds: () => "resolve-test",
    ports: { ...denyingPublicApplicationPorts, desktopRouteAuthority: { authorize }, ...(options.absent ? {} : { deviceSwitchResolution: { resolve } }) },
  });
  apps.push(app);
  return { app, resolve, authorize };
}
const headers = { authorization: "Bearer fixture" };
describe("original source switch request resolution", () => {
  it("admits a fixed read-only lookup for Active or Standby with server-derived scope", async () => {
    const { app, resolve, authorize } = create();
    const result = await app.inject({ method: "POST", url: DEVICE_SWITCH_RESOLVE_ROUTE, headers, payload: request });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(response);
    expect(resolve).toHaveBeenCalledWith(request, principal);
    expect(authorize).toHaveBeenCalledWith(principal, "active_or_standby");
  });
  it("rejects scope selectors, invalid input and oversized bodies before the owner runs", async () => {
    const { app, resolve } = create();
    for (const payload of [{ ...request, workspaceId: "foreign" }, { ...request, sourceDeviceId: "foreign" }, { ...request, expectedSourceLeaseEpoch: 8 }, { ...request, idempotencyKey: "" }, { ...request, idempotencyKey: "x".repeat(2200) }]) {
      const result = await app.inject({ method: "POST", url: DEVICE_SWITCH_RESOLVE_ROUTE, headers, payload });
      expect([400, 413]).toContain(result.statusCode);
    }
    expect(resolve).not.toHaveBeenCalled();
  });
  it("hides authority denials and rejects invalid owner output", async () => {
    const denied = create({ allowed: false });
    expect((await denied.app.inject({ method: "POST", url: DEVICE_SWITCH_RESOLVE_ROUTE, headers, payload: request })).statusCode).toBe(404);
    expect(denied.resolve).not.toHaveBeenCalled();
    for (const result of [null, { ...response, sourceLeaseEpoch: 1 } as never]) {
      const { app } = create({ response: result });
      const reply = await app.inject({ method: "POST", url: DEVICE_SWITCH_RESOLVE_ROUTE, headers, payload: request });
      expect(reply.statusCode).toBeGreaterThanOrEqual(400);
      expect(reply.json()).not.toHaveProperty("outcome");
    }
  });
  it("does not expose a route without its owner", async () => {
    const { app } = create({ absent: true });
    expect((await app.inject({ method: "POST", url: DEVICE_SWITCH_RESOLVE_ROUTE, headers, payload: request })).statusCode).toBe(404);
  });
});
