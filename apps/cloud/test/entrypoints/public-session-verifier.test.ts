import { readFileSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { authSessionStatusSchema } from "@gooddealer/protocol/account";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createCloudPublicHttp } from "../../src/entrypoints/http";
import {
  CloudPublicSessionVerifier,
  type PublicSessionVerifierPort,
} from "../../src/entrypoints/ports/public-session";
import { IdentityFixtureService } from "../support/identity-fixture";
import { IdentityAccountSessionVerifier } from "../../src/modules/identity/session-verifier";

const evaluatedAt = new Date("2026-08-15T00:00:00.000Z");

function snapshot(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    sessionId: "session-live",
    accountId: "account-live",
    clientKind: "account_web",
    expiresAt: "2026-08-15T01:00:00Z",
    sessionAccountSecurityEpoch: 4,
    currentAccountSecurityEpoch: 4,
    familyState: "active",
    ...overrides,
  };
}

function ids(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function identityWithWebSession(
  sessionId: string,
  expiresAt = new Date("2026-08-15T01:00:00.000Z"),
): IdentityFixtureService {
  return new IdentityFixtureService({
    now: () => evaluatedAt,
    accountWebSessions: [{
      sessionId,
      displayName: "Chrome on macOS",
      createdAt: new Date("2026-08-14T00:00:00.000Z"),
      expiresAt,
    }],
  });
}

describe("CloudPublicSessionVerifier", () => {
  it("accepts exact web and desktop snapshots and returns only the minimal principal", async () => {
    const identity = identityWithWebSession("web-session-live");
    const verifier: PublicSessionVerifierPort = new CloudPublicSessionVerifier(
      new IdentityAccountSessionVerifier(identity),
    );

    await expect(verifier.verify("web-session-live", evaluatedAt)).resolves.toEqual({
      accountId: "internal-fixture-account",
      sessionId: "web-session-live",
      clientKind: "account_web",
    });
    await expect(verifier.verify(null, evaluatedAt)).resolves.toBeNull();
    await expect(verifier.verify("unknown-session", evaluatedAt)).resolves.toBeNull();

    const desktopIdentity = new IdentityFixtureService({ now: () => evaluatedAt });
    const desktop = authSessionStatusSchema.parse(desktopIdentity.login({
      schemaVersion: 1,
      method: "password",
      deviceId: "fixture-device-active",
      rememberDevice: true,
    }));
    if (desktop.state !== "authenticated" || desktop.sessionId === null) throw new Error("desktop fixture failed");
    await expect(new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier(desktopIdentity))
      .verify(desktop.sessionId, evaluatedAt)).resolves.toEqual({
        accountId: "internal-fixture-account",
        sessionId: desktop.sessionId,
        clientKind: "desktop",
      });
  });

  it("keeps the static verifier as a test seam outside production composition", () => {
    const composition = readFileSync(
      new URL("../../src/entrypoints/http.ts", import.meta.url),
      "utf8",
    );
    expect(composition).toContain("new CloudPublicSessionVerifier(");
    expect(composition).not.toContain("StaticPublicSessionVerifier");
  });

  it("reads identity again for every request and rejects substituted session snapshots", async () => {
    let calls = 0;
    const verifier = new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier({
      readSessionVerification(sessionId) {
        calls += 1;
        return snapshot({ sessionId });
      },
    }));
    await expect(verifier.verify("session-live", evaluatedAt)).resolves.not.toBeNull();
    await expect(verifier.verify("session-live", evaluatedAt)).resolves.not.toBeNull();
    expect(calls).toBe(2);

    const substituted = new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier({
      readSessionVerification: () => snapshot({ sessionId: "different-session" }),
    }));
    await expect(substituted.verify("session-live", evaluatedAt)).resolves.toBeNull();
  });

  it.each([
    ["missing", null],
    ["revoked family", snapshot({ familyState: "revoked" })],
    ["unknown family", snapshot({ familyState: null })],
    ["expired web", snapshot({ expiresAt: "2026-08-15T00:00:00Z" })],
    ["web without expiry", snapshot({ expiresAt: null })],
    ["desktop with expiry", snapshot({ clientKind: "desktop" })],
    ["stale epoch", snapshot({ currentAccountSecurityEpoch: 5 })],
    ["wrong client kind", snapshot({ clientKind: "mobile" })],
    ["extra field", snapshot({ unexpected: true })],
    ["malformed session id", snapshot({ sessionId: "contains space" })],
    ["malformed account id", snapshot({ accountId: "contains space" })],
    ["non-canonical expiry", snapshot({ expiresAt: "2026-08-15T01:00:00.000Z" })],
  ])("rejects %s", async (_name, value) => {
    const verifier = new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier({
      readSessionVerification: () => value,
    }));
    await expect(verifier.verify("session-live", evaluatedAt)).resolves.toBeNull();
  });

  it("rejects accessors, custom prototypes, symbols, and non-enumerable snapshot state", async () => {
    const accessor = snapshot();
    Object.defineProperty(accessor, "accountId", { get: () => "account-live", enumerable: true });
    const inherited = Object.assign(Object.create({ inherited: true }), snapshot());
    const symbol = Object.assign(snapshot(), { [Symbol("authority")]: true });
    const hidden = snapshot();
    Object.defineProperty(hidden, "hidden", { value: true });
    for (const value of [accessor, inherited, symbol, hidden]) {
      const verifier = new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier({
        readSessionVerification: () => value,
      }));
      await expect(verifier.verify("session-live", evaluatedAt)).resolves.toBeNull();
    }
  });
});

describe("production public-session composition", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  function app(identity: IdentityFixtureService): FastifyInstance {
    const created = createCloudPublicHttp({
      identity,
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => evaluatedAt,
      correlationIds: ids("public-session-correlation"),
      ports: [],
    });
    apps.push(created);
    return created;
  }

  it("maps a family revocation to 401 on the very next request with no cache TTL", async () => {
    const identity = identityWithWebSession("web-session-revoked");
    const publicApp = app(identity);
    expect((await publicApp.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=web-session-revoked" },
    })).statusCode).toBe(200);

    const revision = identity.listSessions("web-session-revoked").listRevision;
    identity.revokeSessions({
      schemaVersion: 1,
      scope: "session",
      sessionId: "web-session-revoked",
      expectedListRevision: revision,
    }, "web-session-revoked");

    const rejected = await publicApp.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=web-session-revoked" },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toEqual({
      schemaVersion: 1,
      code: "UNAUTHENTICATED",
      correlationId: "public-session-correlation-2",
    });
  });

  it.each([
    {
      name: "expired session",
      create: () => identityWithWebSession("web-session-expired", evaluatedAt),
      sessionId: "web-session-expired",
    },
    {
      name: "stale account-security epoch",
      create: () => {
        const identity = identityWithWebSession("web-session-stale-epoch");
        identity.advanceAccountSecurityEpoch();
        return identity;
      },
      sessionId: "web-session-stale-epoch",
    },
  ])("maps $name to the same disclosure-free 401 identity", async ({ create, sessionId }) => {
    const response = await app(create()).inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: `gd_session=${sessionId}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "UNAUTHENTICATED",
      correlationId: "public-session-correlation-1",
    });
  });

  it.each([
    ["unknown", null],
    ["revoked", snapshot({ familyState: "revoked" })],
    ["expired", snapshot({ expiresAt: "2026-08-15T00:00:00Z" })],
    ["web expiry confusion", snapshot({ expiresAt: null })],
    ["desktop expiry confusion", snapshot({ clientKind: "desktop" })],
    ["stale epoch", snapshot({ currentAccountSecurityEpoch: 5 })],
    ["wrong kind", snapshot({ clientKind: "mobile" })],
    ["malformed shape", snapshot({ unexpected: true })],
  ])("keeps the HTTP policy failure identical for %s state", async (_name, value) => {
    const publicApp = createCloudPublicHttp({
      identity: { readSessionVerification: () => value },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => evaluatedAt,
      correlationIds: ids("uniform-policy-correlation"),
      ports: [],
    });
    apps.push(publicApp);
    const response = await publicApp.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-live" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "UNAUTHENTICATED",
      correlationId: "uniform-policy-correlation-1",
    });
  });

  it("maps identity reader failures to a generic disclosure-free 500", async () => {
    const sentinel = "identity-reader-sentinel-session-live";
    const publicApp = createCloudPublicHttp({
      identity: { readSessionVerification() { throw new Error(sentinel); } },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => evaluatedAt,
      correlationIds: ids("reader-failure-correlation"),
      ports: [],
    });
    apps.push(publicApp);
    const response = await publicApp.inject({
      method: "GET",
      url: "/v1/boundary/identity",
      headers: { cookie: "gd_session=session-live" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "INTERNAL",
      correlationId: "reader-failure-correlation-1",
    });
    expect(JSON.stringify({ body: response.body, headers: response.headers })).not.toContain(sentinel);
    expect(JSON.stringify({ body: response.body, headers: response.headers })).not.toContain("session-live");
  });
});
