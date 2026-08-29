import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminHttp } from "../../src/entrypoints/admin-http";
import { accountRejectionStatus } from "../../src/entrypoints/adapter/error-identity";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import {
  openApiDocumentFor,
  openApiRouteSet,
} from "../../src/entrypoints/adapter/schema";
import {
  ADMIN_SURFACE,
  registerAdminRoutes,
  registeredRoutesFor,
} from "../../src/entrypoints/adapter/surface";
import { createPublicHttp } from "../../src/entrypoints/http";
import { InMemoryAuditSink } from "../../src/entrypoints/ports/audit-sink";
import {
  denyingPublicApplicationPorts,
  StaticPublicSessionVerifier,
} from "../support/public-session";
import { StaticStaffSessionVerifier } from "../../src/entrypoints/ports/staff-session";
import { accountRejectionCodeSchema } from "@gooddealer/protocol/account";
import {
  boundaryAcceptedResponseSchema,
  boundaryEmptyRequestSchema,
} from "@gooddealer/protocol/wire";

type AuditExpectation = "none" | "denial" | "access";

interface MatrixCase {
  readonly id: string;
  readonly surface: "public" | "admin";
  readonly method?: string;
  readonly path: string;
  readonly cookie?: string;
  readonly body?: string;
  readonly expectedStatus: number;
  readonly expectedBody: Readonly<Record<string, unknown>>;
  readonly audit: AuditExpectation;
}

function ids(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function normalized(rawBody: string): string {
  const body = JSON.parse(rawBody) as Record<string, unknown>;
  return rawBody.replace(JSON.stringify(body.correlationId), JSON.stringify("<correlation>"));
}

describe("the observed 16-row error identity matrix", () => {
  let publicApp: FastifyInstance;
  let adminApp: FastifyInstance;
  let publicUrl: string;
  let adminUrl: string;
  let audit: InMemoryAuditSink;

  beforeAll(async () => {
    audit = new InMemoryAuditSink();
    publicApp = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([
        { sessionId: "pub-session", accountId: "account-a" },
        { sessionId: "pub-rate-session", accountId: "account-rate" },
      ]),
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      correlationIds: ids("public-correlation"),
      ports: denyingPublicApplicationPorts,
    });
    adminApp = createAdminHttp({
      staffSessions: new StaticStaffSessionVerifier([
        {
          sessionId: "staff-session",
          staffId: "owner",
          scopes: ["admin:boundary:read"],
        },
        { sessionId: "staff-no-scope", staffId: "owner", scopes: [] },
        {
          sessionId: "staff-expired",
          staffId: "owner",
          scopes: ["admin:boundary:read"],
          expiresAt: new Date("2026-08-14T00:00:00.000Z"),
        },
      ]),
      audit,
      rateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      correlationIds: ids("admin-correlation"),
    });

    [publicUrl, adminUrl] = await Promise.all([
      publicApp.listen({ host: "127.0.0.1", port: 0 }),
      adminApp.listen({ host: "127.0.0.1", port: 0 }),
    ]);

  });

  afterAll(async () => {
    await Promise.all([publicApp.close(), adminApp.close()]);
  });

  const cases: readonly MatrixCase[] = [
    {
      id: "M1",
      surface: "public",
      path: "/v1/boundary/identity",
      expectedStatus: 401,
      expectedBody: { schemaVersion: 1, code: "UNAUTHENTICATED" },
      audit: "none",
    },
    {
      id: "M2",
      surface: "public",
      path: "/v1/boundary/identity",
      cookie: "gd_session=pub-session",
      expectedStatus: 200,
      expectedBody: { surface: "public", authenticated: true },
      audit: "none",
    },
    {
      id: "M3",
      surface: "public",
      path: "/v1/boundary/identity",
      cookie: "gd_staff_session=staff-session",
      expectedStatus: 401,
      expectedBody: { schemaVersion: 1, code: "UNAUTHENTICATED" },
      audit: "none",
    },
    {
      id: "M4",
      surface: "public",
      path: "/admin/v1/boundary/identity",
      cookie: "gd_session=pub-session",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "none",
    },
    {
      id: "M5",
      surface: "public",
      path: "/v1/nope",
      cookie: "gd_session=pub-session",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "none",
    },
    {
      id: "M6",
      surface: "admin",
      path: "/admin/v1/boundary/identity",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "denial",
    },
    {
      id: "M7",
      surface: "admin",
      path: "/admin/v1/boundary/identity",
      cookie: "gd_session=pub-session",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "denial",
    },
    {
      id: "M8",
      surface: "admin",
      path: "/admin/v1/boundary/identity",
      cookie: "gd_staff_session=staff-session",
      expectedStatus: 200,
      expectedBody: { surface: "admin" },
      audit: "access",
    },
    {
      id: "M9",
      surface: "admin",
      path: "/admin/v1/boundary/identity",
      cookie: "gd_staff_session=staff-no-scope",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "denial",
    },
    {
      id: "M10",
      surface: "admin",
      path: "/v1/boundary/identity",
      cookie: "gd_staff_session=staff-session",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "denial",
    },
    {
      id: "M11",
      surface: "admin",
      path: "/admin/v1/boundary/identity",
      cookie: "gd_staff_session=staff-expired",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "denial",
    },
    {
      id: "M12",
      surface: "public",
      method: "POST",
      path: "/v1/boundary/validate",
      cookie: "gd_session=pub-session",
      body: JSON.stringify({ count: "x" }),
      expectedStatus: 400,
      expectedBody: { schemaVersion: 1, code: "SCHEMA_INVALID" },
      audit: "none",
    },
    {
      id: "M14",
      surface: "public",
      method: "POST",
      path: "/v1/boundary/validate",
      cookie: "gd_session=pub-session",
      body: JSON.stringify({ count: 1, padding: "x".repeat(512) }),
      expectedStatus: 413,
      expectedBody: { schemaVersion: 1, code: "PAYLOAD_TOO_LARGE" },
      audit: "none",
    },
    {
      id: "M15",
      surface: "admin",
      path: "/admin/v1/nope",
      cookie: "gd_staff_session=staff-session",
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "denial",
    },
    {
      id: "M16",
      surface: "public",
      method: "DELETE",
      path: "/v1/boundary/identity",
      cookie: "gd_session=pub-session",
      // Fastify 5 routes an unsupported method through setNotFoundHandler.
      expectedStatus: 404,
      expectedBody: { schemaVersion: 1, code: "NOT_FOUND" },
      audit: "none",
    },
  ];

  it.each(cases)("observes $id", async (matrixCase) => {
    const before = audit.records().length;
    const request: RequestInit = {
      method: matrixCase.method ?? "GET",
      headers: {
        ...(matrixCase.cookie === undefined ? {} : { cookie: matrixCase.cookie }),
        ...(matrixCase.body === undefined ? {} : { "content-type": "application/json" }),
      },
    };
    if (matrixCase.body !== undefined) {
      request.body = matrixCase.body;
    }
    const response = await fetch(
      `${matrixCase.surface === "public" ? publicUrl : adminUrl}${matrixCase.path}`,
      request,
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(matrixCase.expectedStatus);
    for (const [key, value] of Object.entries(matrixCase.expectedBody)) {
      expect(body[key]).toBe(value);
    }
    if (matrixCase.expectedStatus >= 400) {
      expect(response.headers.get("x-gd-correlation-id")).toBe(body.correlationId);
      expect(Object.keys(body)).toEqual(["schemaVersion", "code", "correlationId"]);
    }

    const addedRecords = audit.records().slice(before);
    expect(addedRecords).toHaveLength(matrixCase.audit === "none" ? 0 : 1);
    if (matrixCase.audit !== "none") {
      expect(addedRecords[0]?.outcome).toBe(matrixCase.audit);
    }
  });

  it("makes M6/M7/M9/M11/M15 byte-identical after correlation normalization", async () => {
    const requests = [
      ["/admin/v1/boundary/identity", undefined],
      ["/admin/v1/boundary/identity", "gd_session=pub-session"],
      ["/admin/v1/boundary/identity", "gd_staff_session=staff-no-scope"],
      ["/admin/v1/boundary/identity", "gd_staff_session=staff-expired"],
      ["/admin/v1/nope", "gd_staff_session=staff-session"],
    ] as const;
    const identities: string[] = [];
    for (const [path, cookie] of requests) {
      const response = await fetch(`${adminUrl}${path}`, {
        headers: cookie === undefined ? {} : { cookie },
      });
      identities.push(normalized(await response.text()));
    }
    expect(new Set(identities)).toEqual(new Set([
      JSON.stringify({ schemaVersion: 1, code: "NOT_FOUND", correlationId: "<correlation>" }),
    ]));
  });

  it("uses two distinct live roots with disjoint route and OpenAPI path sets", () => {
    expect(publicApp).not.toBe(adminApp);
    expect(new URL(publicUrl).port).not.toBe(new URL(adminUrl).port);
    const publicRoutes = registeredRoutesFor(publicApp);
    const adminRoutes = registeredRoutesFor(adminApp);
    expect(publicRoutes).toEqual([
      { method: "GET", path: "/v1/boundary/identity" },
      { method: "POST", path: "/v1/boundary/validate" },
      { method: "POST", path: "/v1/account/activation" },
    ]);
    expect(adminRoutes).toEqual([
      { method: "GET", path: "/admin/v1/boundary/identity" },
      { method: "POST", path: "/admin/v1/boundary/validate" },
    ]);
    expect(new Set(publicRoutes.map(({ path }) => path))).toEqual(
      new Set(openApiRouteSet(openApiDocumentFor(publicApp)).map(({ path }) => path)),
    );
    expect(new Set(adminRoutes.map(({ path }) => path))).toEqual(
      new Set(openApiRouteSet(openApiDocumentFor(adminApp)).map(({ path }) => path)),
    );
    expect(publicRoutes.some(({ path }) => path.startsWith("/admin/"))).toBe(false);
    expect(adminRoutes.some(({ path }) => path.startsWith("/v1/"))).toBe(false);
  });

  it("keeps both admin boundary routes argument-free and free of business data", async () => {
    const identity = await fetch(`${adminUrl}/admin/v1/boundary/identity`, {
      headers: { cookie: "gd_staff_session=staff-session" },
    });
    const validate = await fetch(`${adminUrl}/admin/v1/boundary/validate`, {
      method: "POST",
      headers: { cookie: "gd_staff_session=staff-session" },
    });
    expect(await identity.json()).toEqual({ surface: "admin" });
    expect(await validate.json()).toEqual({ accepted: true });
  });

  it("maps every frozen account rejection code without a fallback", () => {
    expect(accountRejectionCodeSchema.options).toHaveLength(20);
    expect(accountRejectionCodeSchema.options.map(accountRejectionStatus)).toEqual([
      401, 429, 403, 403, 403, 409, 409, 401, 401, 409,
      403, 403, 409, 409, 409, 403, 409, 409, 409, 400,
    ]);
  });

  it("maps malformed public JSON to a disclosure-free schema rejection before authentication", async () => {
    const response = await fetch(`${publicUrl}/v1/boundary/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.code).toBe("SCHEMA_INVALID");
    expect(Object.keys(body)).toEqual(["schemaVersion", "code", "correlationId"]);
    expect(JSON.stringify(body)).not.toMatch(/not json|body|position|unexpected/i);
  });

  it("keeps scope gating and audit records for a live parameterized admin route", async () => {
    const parameterAudit = new InMemoryAuditSink();
    const parameterApp = createAdminHttp({
      staffSessions: new StaticStaffSessionVerifier([
        {
          sessionId: "parameter-scoped",
          staffId: "owner",
          scopes: ["admin:boundary:read"],
        },
        { sessionId: "parameter-unscoped", staffId: "owner", scopes: [] },
      ]),
      audit: parameterAudit,
      rateLimit: rateLimitPolicy(60_000, 10),
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      correlationIds: ids("parameter-correlation"),
    });
    registerAdminRoutes(parameterApp, [
      {
        surface: ADMIN_SURFACE,
        method: "GET",
        path: "/admin/v1/thing/:id",
        request: boundaryEmptyRequestSchema,
        response: boundaryAcceptedResponseSchema,
        requiredScope: "admin:boundary:read",
        authorize: (principal: { readonly scopes: ReadonlySet<string> }) =>
          principal.scopes.has("admin:boundary:read"),
        invoke: async () => ({ accepted: true as const }),
      },
    ]);

    const parameterUrl = await parameterApp.listen({ host: "127.0.0.1", port: 0 });
    try {
      const unscoped = await fetch(`${parameterUrl}/admin/v1/thing/42`, {
        headers: { cookie: "gd_staff_session=parameter-unscoped" },
      });
      expect(unscoped.status).toBe(404);
      expect(parameterAudit.records()).toEqual([
        expect.objectContaining({ outcome: "denial", reason: "insufficient_scope" }),
      ]);

      const scoped = await fetch(`${parameterUrl}/admin/v1/thing/42`, {
        headers: { cookie: "gd_staff_session=parameter-scoped" },
      });
      expect(scoped.status).toBe(200);
      expect(await scoped.json()).toEqual({ accepted: true });
      expect(parameterAudit.records()).toEqual([
        expect.objectContaining({ outcome: "denial", reason: "insufficient_scope" }),
        expect.objectContaining({ outcome: "access", reason: "authenticated_access" }),
      ]);
    } finally {
      await parameterApp.close();
    }
  });

  it("observes M13 on an independently exhausted source-address bucket", async () => {
    const rateLimitApp = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([
        { sessionId: "pub-rate-session", accountId: "account-rate" },
      ]),
      preAuthRateLimit: rateLimitPolicy(60_000, 3),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-08-15T00:00:00.000Z"),
      correlationIds: ids("matrix-rate-correlation"),
      ports: denyingPublicApplicationPorts,
    });
    const rateLimitUrl = await rateLimitApp.listen({ host: "127.0.0.1", port: 0 });
    try {
      for (let request = 0; request < 3; request += 1) {
        expect((await fetch(`${rateLimitUrl}/v1/boundary/identity`)).status).toBe(401);
      }
      const response = await fetch(`${rateLimitUrl}/v1/boundary/identity`, {
        headers: { cookie: "gd_session=pub-rate-session" },
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(429);
      expect(body).toEqual({
        schemaVersion: 1,
        code: "RATE_LIMITED",
        correlationId: expect.any(String),
        retryable: true,
        retryAfterSeconds: expect.any(Number),
      });
      expect(response.headers.get("retry-after")).toBe(String(body.retryAfterSeconds));
    } finally {
      await rateLimitApp.close();
    }
  });
});
