import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import {
  WORKSPACE_SYNC_CHECKPOINT_ROUTE,
  WORKSPACE_SYNC_PULL_ROUTE,
  WORKSPACE_SYNC_PUSH_ROUTE,
} from "../../src/entrypoints/routes/public/boundary";
import { StaticPublicSessionVerifier } from "../support/public-session";

const principal = { accountId: "account-sync", sessionId: "session-sync", clientKind: "desktop" as const };
const mutation = {
  schemaVersion: 2 as const,
  mutationId: "mutation-sync-1",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset" as const,
  entityId: "asset.test",
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

  function create() {
    const push = vi.fn(async () => ({
      schemaVersion: 2 as const,
      accepted: true as const,
      acknowledgements: [{ mutationId: mutation.mutationId, deviceMutationSequence: 1, serverRevision: 1, duplicate: false }],
      headServerRevision: 1,
    }));
    const pull = vi.fn(async () => ({
      schemaVersion: 2 as const,
      accepted: true as const,
      page: {
        schemaVersion: 2 as const,
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
    const checkpoint = vi.fn(async () => ({ schemaVersion: 2 as const, checkpoint: null }));
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([]),
      desktopAccessTokens: { async verifyAccessToken(token) { return token === "sync-token" ? principal : null; } },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-09-14T00:00:00Z"),
      correlationIds: () => "sync-route-correlation",
      ports: {
        accountActivation: { activate: async () => null },
        desktopAuthorization: { issue: async () => null },
        commercialCheckout: {
          createCheckout: async () => null, readStatus: async () => null,
          cancelSubscription: async () => null, confirmFixedTerm: async () => null,
          requestFirstPurchaseRefund: async () => null, readFirstPurchaseRefundStatus: async () => null,
          claimApprovalRedirect: async () => null,
        },
        workspaceSync: { push, pull, checkpoint },
      },
    });
    apps.push(app);
    return { app, push, pull, checkpoint };
  }

  it("exposes push, pull, and checkpoint only to a verified desktop bearer", async () => {
    const { app, push, pull, checkpoint } = create();
    const headers = { authorization: "Bearer sync-token" };
    const pushRequest = { schemaVersion: 2, mutations: [mutation] };
    const pullRequest = { schemaVersion: 2, afterServerRevision: 0, cursor: null, confirm: null, pageLimit: 256 };
    const responses = await Promise.all([
      app.inject({ method: "POST", url: WORKSPACE_SYNC_PUSH_ROUTE, headers, payload: pushRequest }),
      app.inject({ method: "POST", url: WORKSPACE_SYNC_PULL_ROUTE, headers, payload: pullRequest }),
      app.inject({ method: "POST", url: WORKSPACE_SYNC_CHECKPOINT_ROUTE, headers, payload: { schemaVersion: 2 } }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect(push).toHaveBeenCalledWith(pushRequest, principal);
    expect(pull).toHaveBeenCalledWith(pullRequest, principal);
    expect(checkpoint).toHaveBeenCalledWith({ schemaVersion: 2 }, principal);
  });

  it("rejects selector injection and hides cookie-authenticated callers", async () => {
    const { app, push } = create();
    const injected = await app.inject({
      method: "POST", url: WORKSPACE_SYNC_PUSH_ROUTE,
      headers: { authorization: "Bearer sync-token" },
      payload: { schemaVersion: 2, workspaceId: "foreign", mutations: [mutation] },
    });
    expect(injected.statusCode).toBe(400);
    expect(push).not.toHaveBeenCalled();

    const cookie = await app.inject({
      method: "POST", url: WORKSPACE_SYNC_CHECKPOINT_ROUTE,
      headers: { cookie: "gd_session=unknown" }, payload: { schemaVersion: 2 },
    });
    expect(cookie.statusCode).toBe(401);
  });
});
