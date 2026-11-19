import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import {
  DEVICE_SWITCH_CANCEL_ROUTE,
  DEVICE_SWITCH_DRAIN_ROUTE,
  DEVICE_SWITCH_REQUEST_ROUTE,
  DEVICE_SWITCH_STATUS_ROUTE,
} from "../../src/entrypoints/routes/public/boundary";
import { drainProofKeyPair, signedHandoffDrainProof } from "../support/drain-proof";
import { StaticPublicSessionVerifier } from "../support/public-session";

const principal = { accountId: "account-switch", sessionId: "session-switch", clientKind: "desktop" as const };
const view = {
  schemaVersion: 1 as const, accepted: true as const,
  request: { schemaVersion: 1 as const, requestId: "switch-1", mode: "normal" as const, status: "draining" as const,
    fromDeviceId: "device-old", toDeviceId: "device-new", requestedAt: "2026-11-17T00:00:00Z",
    earliestTakeoverAt: null, bootstrapExpiresAt: null },
};
const switchRequest = { schemaVersion: 1, mode: "normal", toDeviceId: "device-new", idempotencyKey: "idem-1" };

describe("device switch public routes", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

  function create(options: { deviceSwitch?: boolean; denied?: boolean; hostile?: boolean; drain?: boolean } = {}) {
    const respond = vi.fn(async () => (options.denied === true ? null
      : options.hostile === true ? { ...view, request: { ...view.request, fromDeviceId: 7 } } as never : view));
    const port = { request: respond, status: respond, cancel: respond, ...(options.drain === false ? {} : { drain: respond }) };
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([]),
      desktopAccessTokens: { async verifyAccessToken(token) { return token === "switch-token" ? principal : null; } },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-11-17T00:00:00Z"),
      correlationIds: () => "switch-route-correlation",
      ports: {
        desktopRouteAuthority: { async authorize() { return true; } },
        accountActivation: { activate: async () => null },
        desktopAuthorization: { issue: async () => null },
        commercialCheckout: {
          createCheckout: async () => null, readStatus: async () => null,
          cancelSubscription: async () => null, confirmFixedTerm: async () => null,
          requestFirstPurchaseRefund: async () => null, readFirstPurchaseRefundStatus: async () => null,
          claimApprovalRedirect: async () => null,
        },
        ...(options.deviceSwitch === false ? {} : { deviceSwitch: port }),
      },
    });
    apps.push(app);
    return { app, respond };
  }
  const headers = { authorization: "Bearer switch-token" };

  it("serves request, status, and cancel only to a verified Desktop bearer", async () => {
    const { app, respond } = create();
    const responses = await Promise.all([
      app.inject({ method: "POST", url: DEVICE_SWITCH_REQUEST_ROUTE, headers, payload: switchRequest }),
      app.inject({ method: "POST", url: DEVICE_SWITCH_STATUS_ROUTE, headers, payload: { schemaVersion: 1, requestId: "switch-1" } }),
      app.inject({ method: "POST", url: DEVICE_SWITCH_CANCEL_ROUTE, headers, payload: { schemaVersion: 1, requestId: "switch-1" } }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect(responses[0]?.json()).toEqual(view);
    expect(respond).toHaveBeenCalledTimes(3);
    const cookie = await app.inject({ method: "POST", url: DEVICE_SWITCH_REQUEST_ROUTE, headers: { cookie: "gd_session=unknown" }, payload: switchRequest });
    expect(cookie.statusCode).toBe(401);
    expect(respond).toHaveBeenCalledTimes(3);
  });

  it("rejects caller-selected devices and unknown fields before the service runs", async () => {
    const { app, respond } = create();
    for (const [url, payload] of [
      [DEVICE_SWITCH_REQUEST_ROUTE, { ...switchRequest, fromDeviceId: "device-x" }],
      [DEVICE_SWITCH_REQUEST_ROUTE, { ...switchRequest, workspaceId: "foreign" }],
      [DEVICE_SWITCH_STATUS_ROUTE, { schemaVersion: 1, requestId: "switch-1", deviceId: "device-x" }],
      [DEVICE_SWITCH_CANCEL_ROUTE, { schemaVersion: 1 }],
    ] as const) {
      const response = await app.inject({ method: "POST", url, headers, payload });
      expect(response.statusCode).toBe(400);
    }
    expect(respond).not.toHaveBeenCalled();
  });

  it("hides a denial's reason and never sends a response outside the contract", async () => {
    const denied = await create({ denied: true }).app.inject({ method: "POST", url: DEVICE_SWITCH_REQUEST_ROUTE, headers, payload: switchRequest });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
    expect(denied.json()).not.toHaveProperty("request");
    const hostile = await create({ hostile: true }).app.inject({ method: "POST", url: DEVICE_SWITCH_STATUS_ROUTE, headers, payload: { schemaVersion: 1, requestId: "switch-1" } });
    expect(hostile.statusCode).toBeGreaterThanOrEqual(500);
    expect(hostile.json()).not.toHaveProperty("request");
  });

  it("does not register the switch routes without a composed service", async () => {
    const { app } = create({ deviceSwitch: false });
    const response = await app.inject({ method: "POST", url: DEVICE_SWITCH_REQUEST_ROUTE, headers, payload: switchRequest });
    expect(response.statusCode).toBe(404);
  });

  it("accepts a drain proof up to its body limit and refuses an oversized or extended one (S1c2)", async () => {
    const proof = signedHandoffDrainProof(drainProofKeyPair().privateKey);
    const { app, respond } = create();
    const accepted = await app.inject({ method: "POST", url: DEVICE_SWITCH_DRAIN_ROUTE, headers, payload: { schemaVersion: 1, requestId: "switch-1", proof } });
    expect(accepted.statusCode).toBe(200);
    expect(respond).toHaveBeenCalledWith({ schemaVersion: 1, requestId: "switch-1", proof }, principal);
    const extended = await app.inject({ method: "POST", url: DEVICE_SWITCH_DRAIN_ROUTE, headers, payload: { schemaVersion: 1, requestId: "switch-1", proof, deviceId: "device-x" } });
    expect(extended.statusCode).toBe(400);
    const oversized = await app.inject({ method: "POST", url: DEVICE_SWITCH_DRAIN_ROUTE, headers, payload: { schemaVersion: 1, requestId: "switch-1", proof: { ...proof, pad: "x".repeat(17 * 1024) } } });
    expect(oversized.statusCode).toBe(413);
    expect(respond).toHaveBeenCalledTimes(1);
    const absent = await create({ drain: false }).app.inject({ method: "POST", url: DEVICE_SWITCH_DRAIN_ROUTE, headers, payload: { schemaVersion: 1, requestId: "switch-1" } });
    expect(absent.statusCode).toBe(404);
  });
});
