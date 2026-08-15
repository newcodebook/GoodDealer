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
import { IdentityFixtureService } from "../../src/modules/identity/index";
import { IdentityAccountSessionVerifier } from "../../src/modules/identity/session-verifier";

const evaluatedAt = new Date("2026-08-15T00:00:00.000Z");

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
  it("keeps the committed port signature and accepts a live account-web session", async () => {
    const identity = identityWithWebSession("web-session-live");
    const verifier: PublicSessionVerifierPort = new CloudPublicSessionVerifier(
      new IdentityAccountSessionVerifier(identity),
    );

    await expect(verifier.verify("web-session-live", evaluatedAt)).resolves.toMatchObject({
      accountId: "internal-fixture-account",
      sessionId: "web-session-live",
    });
    await expect(verifier.verify(null, evaluatedAt)).resolves.toBeNull();
    await expect(verifier.verify("unknown-session", evaluatedAt)).resolves.toBeNull();
  });

  it("keeps the static verifier as a test seam outside production composition", () => {
    const composition = readFileSync(
      new URL("../../src/entrypoints/http.ts", import.meta.url),
      "utf8",
    );
    expect(composition).toContain("new CloudPublicSessionVerifier(");
    expect(composition).not.toContain("StaticPublicSessionVerifier");
  });

  it("rejects stale epochs and non-web clients without changing the public disclosure", async () => {
    const staleVerifier = new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier({
      readSessionVerification() {
        return {
          accountId: "internal-fixture-account",
          clientKind: "account_web",
          expiresAt: "2026-08-15T01:00:00Z",
          sessionAccountSecurityEpoch: 1,
          currentAccountSecurityEpoch: 2,
          familyState: "active",
        };
      },
    }));
    const desktopIdentity = new IdentityFixtureService({ now: () => evaluatedAt });
    const desktop = authSessionStatusSchema.parse(desktopIdentity.login({
      schemaVersion: 1,
      method: "password",
      deviceId: "fixture-device-active",
      rememberDevice: true,
    }));
    if (desktop.state !== "authenticated" || desktop.sessionId === null) {
      throw new Error("fixture desktop login must authenticate");
    }
    const desktopVerifier = new CloudPublicSessionVerifier(
      new IdentityAccountSessionVerifier(desktopIdentity),
    );

    await expect(staleVerifier.verify("stale-epoch", evaluatedAt)).resolves.toBeNull();
    await expect(desktopVerifier.verify(desktop.sessionId, evaluatedAt)).resolves.toBeNull();
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
});
