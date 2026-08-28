import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createAdminHttp } from "../../src/entrypoints/admin-http";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import { InMemoryAuditSink } from "../../src/entrypoints/ports/audit-sink";
import { StaticPublicSessionVerifier } from "../support/public-session";
import { StaticStaffSessionVerifier } from "../../src/entrypoints/ports/staff-session";

function ids(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function normalize(rawBody: string): string {
  const body = JSON.parse(rawBody) as Record<string, unknown>;
  return rawBody.replace(JSON.stringify(body.correlationId), JSON.stringify("<correlation>"));
}

describe("the pre-auth address-bucketed rate-limit boundary", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  function publicApp(
    windowMs: number,
    preAuthBurst: number,
    sessionBurst = preAuthBurst,
  ): FastifyInstance {
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([
        { sessionId: "session-a", accountId: "account-a" },
        { sessionId: "session-b", accountId: "account-b" },
      ]),
      preAuthRateLimit: rateLimitPolicy(windowMs, preAuthBurst),
      sessionRateLimit: rateLimitPolicy(windowMs, sessionBurst),
      now: () => new Date("2020-01-01T00:00:00.000Z"),
      correlationIds: ids("rate-correlation"),
      ports: [],
    });
    apps.push(app);
    return app;
  }

  it("does not let rotating unverified cookies escape the source-address bucket", async () => {
    const app = publicApp(60_000, 1);
    const firstA = await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=unknown-a" },
    });
    const limitedAfterCookieRotation = await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=unknown-b" },
    });

    expect(firstA.statusCode).toBe(401);
    expect(limitedAfterCookieRotation.statusCode).toBe(429);
    const limitedBody = limitedAfterCookieRotation.json<Record<string, unknown>>();
    expect(limitedBody.code).toBe("RATE_LIMITED");
    expect(limitedBody.retryable).toBe(true);
    expect(limitedAfterCookieRotation.headers["retry-after"]).toBe(
      String(limitedBody.retryAfterSeconds),
    );
  });

  it("applies a verified gd_session bucket in addition to the source-address bucket", async () => {
    const app = publicApp(60_000, 100, 1);
    expect((await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-a" },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-a" },
    })).statusCode).toBe(429);
    expect((await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-b" },
    })).statusCode).toBe(200);
  });

  it("resets an exhausted bucket using the real wall clock", async () => {
    const app = publicApp(2_000, 1);
    const first = await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-a" },
    });
    const limited = await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-a" },
    });
    expect(first.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const resetA = await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-a" },
    });
    expect(resetA.statusCode).toBe(200);
  });

  it("does not let any header select a bucket", async () => {
    const app = publicApp(60_000, 1);
    const first = await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { "x-rate-limit-identity": "chosen-a" },
    });
    const second = await app.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { "x-rate-limit-identity": "chosen-b" },
    });
    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(429);
  });

  it("keeps nine spoofed client-identity inputs in the exhausted socket-address bucket", async () => {
    const app = publicApp(60_000, 2, 100);
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const vectors: readonly Record<string, string>[] = [
      {},
      { "x-forwarded-for": "203.0.113.1" },
      { "x-forwarded-for": "203.0.113.2, 198.51.100.7" },
      { "x-real-ip": "203.0.113.3" },
      { forwarded: "for=203.0.113.4" },
      { "x-client-ip": "203.0.113.5" },
      { "true-client-ip": "203.0.113.6" },
      { "cf-connecting-ip": "203.0.113.7" },
      { cookie: "gd_session=rotate-1" },
      { cookie: "gd_session=rotate-2", "x-forwarded-for": "203.0.113.8" },
      { "x-rate-limit-key": "chosen" },
    ];
    const statuses: number[] = [];
    for (const headers of vectors) {
      statuses.push((await fetch(`${url}/v1/boundary/identity`, { headers })).status);
    }
    expect(statuses).toEqual([401, 401, 429, 429, 429, 429, 429, 429, 429, 429, 429]);
  });

  it("authenticates before JSON Schema validation and leaks no validation details", async () => {
    const app = publicApp(60_000, 10);
    const response = await app.inject({
      method: "POST",
      url: "/v1/boundary/validate",
      payload: { count: "not-an-integer", privateField: "secret" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "UNAUTHENTICATED",
      correlationId: "rate-correlation-1",
    });
  });

  it("keeps admin pre-auth faults byte-identical while recording true reasons internally", async () => {
    const audit = new InMemoryAuditSink();
    const sessions = new StaticStaffSessionVerifier([
      {
        sessionId: "staff-session",
        staffId: "owner",
        scopes: ["admin:boundary:read"],
      },
    ]);
    const create = (burst: number) => {
      const app = createAdminHttp({
        staffSessions: sessions,
        audit,
        rateLimit: rateLimitPolicy(60_000, burst),
        now: () => new Date("2026-08-15T00:00:00.000Z"),
        correlationIds: ids(`admin-${apps.length}`),
      });
      apps.push(app);
      return app;
    };

    const missing = await create(100).inject({ method: "GET", url: "/admin/v1/boundary/identity" });

    const rateApp = create(1);
    expect((await rateApp.inject({
      method: "GET",
      url: "/admin/v1/boundary/identity",
      headers: { cookie: "gd_staff_session=staff-session" },
    })).statusCode).toBe(200);
    const limited = await rateApp.inject({
      method: "GET",
      url: "/admin/v1/boundary/identity",
      headers: { cookie: "gd_staff_session=staff-session" },
    });

    const oversized = await create(100).inject({
      method: "POST",
      url: "/admin/v1/boundary/validate",
      headers: {
        cookie: "gd_staff_session=staff-session",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ count: 1, padding: "x".repeat(512) }),
    });
    const unsupportedMedia = await create(100).inject({
      method: "POST",
      url: "/admin/v1/boundary/validate",
      headers: {
        cookie: "gd_staff_session=staff-session",
        "content-type": "application/x-gooddealer-unknown",
      },
      payload: "opaque",
    });

    const bodies = [missing, limited, oversized, unsupportedMedia].map((response) => {
      expect(response.statusCode).toBe(404);
      return normalize(response.body);
    });
    expect(new Set(bodies)).toEqual(new Set([
      JSON.stringify({ schemaVersion: 1, code: "NOT_FOUND", correlationId: "<correlation>" }),
    ]));
    expect(audit.records().some(({ reason }) => reason === "authentication_failed")).toBe(true);
    expect(audit.records().some(({ reason }) => reason === "rate_limited")).toBe(true);
    expect(audit.records().some(({ reason }) => reason === "payload_too_large")).toBe(true);
    expect(audit.records().some(({ reason }) => reason === "unsupported_media_type")).toBe(true);
  });

  it("reveals only SCHEMA_INVALID after staff authentication and scope checks", async () => {
    const app = createAdminHttp({
      staffSessions: new StaticStaffSessionVerifier([
        {
          sessionId: "staff-session",
          staffId: "owner",
          scopes: ["admin:boundary:read"],
        },
      ]),
      audit: new InMemoryAuditSink(),
      rateLimit: rateLimitPolicy(60_000, 10),
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      correlationIds: ids("schema-correlation"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/admin/v1/boundary/validate",
      headers: { cookie: "gd_staff_session=staff-session" },
      payload: { count: "x", confidentialFieldName: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "SCHEMA_INVALID",
      correlationId: "schema-correlation-1",
    });
  });
});
