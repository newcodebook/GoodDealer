import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import {
  WORKSPACE_SYNC_CHECKPOINT_ROUTE,
  WORKSPACE_SYNC_PULL_ROUTE,
  WORKSPACE_SYNC_PUSH_ROUTE,
  WORKSPACE_SYNC_RECEIPTS_ROUTE,
} from "../../src/entrypoints/routes/public/boundary";
import { StaticPublicSessionVerifier } from "../support/public-session";

const principal = { accountId: "account-sync", sessionId: "session-sync", clientKind: "desktop" as const };
const mutation = {
  schemaVersion: 3 as const,
  mutationId: "mutation-sync-1",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset" as const,
  entityId: "asset.test",
  entityGeneration: 1,
  operationKind: "upsert" as const,
  baseServerRevision: 0,
  changedFields: [{ fieldPath: "note" as const, value: "hello" }],
  sourceDeviceId: "device-sync",
  activeLeaseEpoch: 1,
  deviceMutationSequence: 1,
};

describe("workspace sync public routes", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

  function create(options: { receipts?: boolean } = {}) {
    const push = vi.fn(async () => ({
      schemaVersion: 3 as const,
      accepted: true as const,
      acknowledgements: [{ mutationId: mutation.mutationId, deviceMutationSequence: 1, serverRevision: 1, duplicate: false }],
      headServerRevision: 1,
    }));
    const pull = vi.fn(async () => ({
      schemaVersion: 3 as const,
      accepted: true as const,
      page: {
        schemaVersion: 3 as const,
        workspaceId: "workspace-sync",
        fromServerRevisionExclusive: 0,
        throughServerRevisionInclusive: 0,
        mutations: [],
        returnedThroughServerRevision: 0,
        nextCursor: null,
        pageDigest: "A".repeat(43),
      },
      confirmedThrough: 0,
      pendingDelivery: {
        generation: 1,
        fromServerRevisionExclusive: 0,
        throughServerRevisionInclusive: 0,
        targetServerRevision: 0,
        pageDigest: "A".repeat(43),
        nextCursorDigest: null,
        predecessorConfirmationDigest: null,
        expiresAt: "2026-09-14T01:00:00Z",
      },
      confirmToken: "B".repeat(43),
    }));
    const checkpoint = vi.fn(async () => ({ schemaVersion: 3 as const, checkpoint: null }));
    const receipts = vi.fn(async (request: { mutationIds: readonly string[] }) => (request.mutationIds.includes("denied") ? null : {
      schemaVersion: 1 as const,
      receipts: [{ mutationId: mutation.mutationId, activeLeaseEpoch: 1, deviceMutationSequence: 1,
        wireSchemaVersion: 2 as const, wireMutationDigest: "D".repeat(43), outcome: "accepted" as const }],
    }));
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([]),
      desktopAccessTokens: { async verifyAccessToken(token) { return token === "sync-token" ? principal : null; } },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-09-14T00:00:00Z"),
      correlationIds: () => "sync-route-correlation",
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
        workspaceSync: { push, pull, checkpoint, ...(options.receipts === false ? {} : { receipts }) },
      },
    });
    apps.push(app);
    return { app, push, pull, checkpoint, receipts };
  }

  it("exposes push, pull, and checkpoint only to a verified desktop bearer", async () => {
    const { app, push, pull, checkpoint } = create();
    const headers = { authorization: "Bearer sync-token" };
    const pushRequest = { schemaVersion: 3, mutations: [mutation] };
    const pullRequest = { schemaVersion: 3, afterServerRevision: 0, cursor: null, confirm: null, pageLimit: 256 };
    const responses = await Promise.all([
      app.inject({ method: "POST", url: WORKSPACE_SYNC_PUSH_ROUTE, headers, payload: pushRequest }),
      app.inject({ method: "POST", url: WORKSPACE_SYNC_PULL_ROUTE, headers, payload: pullRequest }),
      app.inject({ method: "POST", url: WORKSPACE_SYNC_CHECKPOINT_ROUTE, headers, payload: { schemaVersion: 3 } }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect(push).toHaveBeenCalledWith(pushRequest, principal);
    expect(pull).toHaveBeenCalledWith(pullRequest, principal);
    expect(checkpoint).toHaveBeenCalledWith({ schemaVersion: 3 }, principal);
    // ADR-0029: a version 2 checkpoint request is refused before the service sees it.
    const legacy = await app.inject({ method: "POST", url: WORKSPACE_SYNC_CHECKPOINT_ROUTE, headers, payload: { schemaVersion: 2 } });
    expect(legacy.statusCode).toBe(400);
    expect(checkpoint).toHaveBeenCalledTimes(1);
  });

  it("rejects selector injection and hides cookie-authenticated callers", async () => {
    const { app, push } = create();
    const injected = await app.inject({
      method: "POST", url: WORKSPACE_SYNC_PUSH_ROUTE,
      headers: { authorization: "Bearer sync-token" },
      payload: { schemaVersion: 3, workspaceId: "foreign", mutations: [mutation] },
    });
    expect(injected.statusCode).toBe(400);
    expect(push).not.toHaveBeenCalled();

    const cookie = await app.inject({
      method: "POST", url: WORKSPACE_SYNC_CHECKPOINT_ROUTE,
      headers: { cookie: "gd_session=unknown" }, payload: { schemaVersion: 3 },
    });
    expect(cookie.statusCode).toBe(401);
  });

  it("reads own receipts only for a verified desktop bearer and never accepts a named device", async () => {
    const { app, receipts } = create();
    const headers = { authorization: "Bearer sync-token" };
    const request = { schemaVersion: 1, mutationIds: [mutation.mutationId] };
    const ok = await app.inject({ method: "POST", url: WORKSPACE_SYNC_RECEIPTS_ROUTE, headers, payload: request });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ schemaVersion: 1, receipts: [{ mutationId: mutation.mutationId, wireSchemaVersion: 2 }] });
    expect(receipts).toHaveBeenCalledWith(request, principal);
    for (const payload of [
      { ...request, sourceDeviceId: "other-device" },
      { ...request, workspaceId: "foreign" },
      { schemaVersion: 1, mutationIds: [] },
      { schemaVersion: 1, mutationIds: ["a", "a"] },
    ]) {
      const rejected = await app.inject({ method: "POST", url: WORKSPACE_SYNC_RECEIPTS_ROUTE, headers, payload });
      expect(rejected.statusCode).toBe(400);
    }
    expect(receipts).toHaveBeenCalledTimes(1);
    const denied = await app.inject({ method: "POST", url: WORKSPACE_SYNC_RECEIPTS_ROUTE, headers, payload: { schemaVersion: 1, mutationIds: ["denied"] } });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
    expect(denied.json()).not.toHaveProperty("receipts");
    const cookie = await app.inject({ method: "POST", url: WORKSPACE_SYNC_RECEIPTS_ROUTE, headers: { cookie: "gd_session=unknown" }, payload: request });
    expect(cookie.statusCode).toBe(401);
  });

  it("admits the largest schema-valid receipt request and refuses one id more", async () => {
    const { app, receipts } = create();
    const headers = { authorization: "Bearer sync-token" };
    // Every character escapes to two JSON bytes; a distinct prefix keeps the ids unique.
    const ids = Array.from({ length: 256 }, (_, index) => `${index.toString().padStart(3, "0")}${"\\".repeat(157)}`);
    const largest = await app.inject({ method: "POST", url: WORKSPACE_SYNC_RECEIPTS_ROUTE, headers, payload: { schemaVersion: 1, mutationIds: ids } });
    expect(largest.statusCode).toBe(200);
    expect(receipts).toHaveBeenCalledTimes(1);
    const tooMany = await app.inject({ method: "POST", url: WORKSPACE_SYNC_RECEIPTS_ROUTE, headers, payload: { schemaVersion: 1, mutationIds: [...ids, "extra"] } });
    expect(tooMany.statusCode).toBe(400);
    expect(receipts).toHaveBeenCalledTimes(1);
  });

  it("does not register the receipt route without a composed reader", async () => {
    const { app } = create({ receipts: false });
    const response = await app.inject({
      method: "POST", url: WORKSPACE_SYNC_RECEIPTS_ROUTE,
      headers: { authorization: "Bearer sync-token" }, payload: { schemaVersion: 1, mutationIds: [mutation.mutationId] },
    });
    expect(response.statusCode).toBe(404);
  });
});
