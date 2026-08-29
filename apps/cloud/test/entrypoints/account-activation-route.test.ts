import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_ACTIVATION_SCHEMA_VERSION,
  type AccountActivationResponse,
} from "@gooddealer/protocol/account";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import {
  openApiDocumentFor,
  openApiRouteSet,
} from "../../src/entrypoints/adapter/schema";
import { registeredRoutesFor } from "../../src/entrypoints/adapter/surface";
import { createPublicHttp } from "../../src/entrypoints/http";
import { ACCOUNT_ACTIVATION_ROUTE } from "../../src/entrypoints/routes/public/boundary";
import { StaticPublicSessionVerifier } from "../support/public-session";

const response: AccountActivationResponse = {
  schemaVersion: ACCOUNT_ACTIVATION_SCHEMA_VERSION,
  state: "active",
};

describe("account activation HTTP route", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  function create(
    activate = vi.fn(async (): Promise<AccountActivationResponse | null> => response),
  ) {
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([
        { sessionId: "web-session", accountId: "account-web", clientKind: "account_web" },
        { sessionId: "desktop-session", accountId: "account-desktop", clientKind: "desktop" },
      ]),
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-08-29T00:00:00Z"),
      correlationIds: () => "activation-correlation",
      ports: { accountActivation: { activate } },
    });
    apps.push(app);
    return { app, activate };
  }

  it("registers the route and invokes the application port with server-derived principal scope", async () => {
    const { app, activate } = create();
    const result = await app.inject({
      method: "POST",
      url: ACCOUNT_ACTIVATION_ROUTE,
      headers: { cookie: "gd_session=web-session" },
      payload: { schemaVersion: 1 },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(response);
    expect(activate).toHaveBeenCalledWith(
      { schemaVersion: 1 },
      { accountId: "account-web", sessionId: "web-session", clientKind: "account_web" },
    );
    expect(registeredRoutesFor(app)).toContainEqual({ method: "POST", path: ACCOUNT_ACTIVATION_ROUTE });
    expect(openApiRouteSet(openApiDocumentFor(app))).toContainEqual({ method: "POST", path: ACCOUNT_ACTIVATION_ROUTE });
  });

  it("rejects client-selected tenant fields and every unknown field before application invocation", async () => {
    for (const injected of [
      { accountId: "attacker" },
      { workspaceId: "attacker" },
      { tenantId: "attacker" },
      { role: "owner" },
    ]) {
      const { app, activate } = create();
      const result = await app.inject({
        method: "POST",
        url: ACCOUNT_ACTIVATION_ROUTE,
        headers: { cookie: "gd_session=web-session" },
        payload: { schemaVersion: 1, ...injected },
      });
      expect(result.statusCode).toBe(400);
      expect(result.json()).toEqual({
        schemaVersion: 1,
        code: "SCHEMA_INVALID",
        correlationId: "activation-correlation",
      });
      expect(activate).not.toHaveBeenCalled();
    }
  });

  it("authenticates before parsing and denies invalid client authorization without disclosure", async () => {
    const missing = create();
    const missingResult = await missing.app.inject({
      method: "POST",
      url: ACCOUNT_ACTIVATION_ROUTE,
      payload: { schemaVersion: 1, workspaceId: "attacker" },
    });
    expect(missingResult.statusCode).toBe(401);
    expect(missingResult.json()).toEqual({
      schemaVersion: 1,
      code: "UNAUTHENTICATED",
      correlationId: "activation-correlation",
    });
    expect(missing.activate).not.toHaveBeenCalled();

    const desktop = create();
    const desktopResult = await desktop.app.inject({
      method: "POST",
      url: ACCOUNT_ACTIVATION_ROUTE,
      headers: { cookie: "gd_session=desktop-session" },
      payload: { schemaVersion: 1 },
    });
    expect(desktopResult.statusCode).toBe(404);
    expect(desktopResult.json()).toEqual({
      schemaVersion: 1,
      code: "NOT_FOUND",
      correlationId: "activation-correlation",
    });
    expect(desktop.activate).not.toHaveBeenCalled();
  });

  it("maps revalidation denial to not found and unexpected application failures to internal", async () => {
    const denied = create(vi.fn(async () => null));
    const deniedResult = await denied.app.inject({
      method: "POST",
      url: ACCOUNT_ACTIVATION_ROUTE,
      headers: { cookie: "gd_session=web-session" },
      payload: { schemaVersion: 1 },
    });
    expect(deniedResult.statusCode).toBe(404);
    expect(deniedResult.json()).toEqual({
      schemaVersion: 1,
      code: "NOT_FOUND",
      correlationId: "activation-correlation",
    });

    const failed = create(vi.fn(async () => { throw new Error("database detail must not leak"); }));
    const failedResult = await failed.app.inject({
      method: "POST",
      url: ACCOUNT_ACTIVATION_ROUTE,
      headers: { cookie: "gd_session=web-session" },
      payload: { schemaVersion: 1 },
    });
    expect(failedResult.statusCode).toBe(500);
    expect(failedResult.json()).toEqual({
      schemaVersion: 1,
      code: "INTERNAL",
      correlationId: "activation-correlation",
    });
    expect(failedResult.body).not.toContain("database detail");
  });
});
