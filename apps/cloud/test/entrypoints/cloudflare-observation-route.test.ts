import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPublicHttp } from "../../src/entrypoints/http";
import { CLOUDFLARE_DNS_OBSERVATION_ROUTE } from "../../src/entrypoints/routes/public/boundary";
import type { CloudflareDnsProjectionAck } from "@gooddealer/protocol/workspace-observations/cloudflare-dns";
import { StaticPublicSessionVerifier, denyingPublicApplicationPorts } from "../support/public-session";

const principal = { accountId: "account-observation", sessionId: "session-observation", clientKind: "desktop" as const };
const projection = {
  schemaVersion: 1,
  providerKind: "cloudflare",
  observationCapability: "dns",
  observationId: "11111111-1111-4111-8111-111111111111",
  entityId: "example.com",
  leaseEpoch: 1,
  sourceSequence: 1,
  observedAt: "2026-09-15T00:00:00Z",
  availability: "available",
  zoneStatus: "active",
  counts: { a: 1, aaaa: 0, cname: 0, txt: 0, proxied: 1 },
};

describe("Cloudflare observation public route", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it("accepts only a verified desktop bearer and never exposes selectors", async () => {
    const submit = vi.fn(async (): Promise<CloudflareDnsProjectionAck> => ({
      schemaVersion: 1 as const,
      accepted: true as const,
      observationId: projection.observationId,
      leaseEpoch: 1,
      sourceSequence: 1,
      canonicalRequestDigest: "a".repeat(64),
      observationSequence: 1,
      disposition: "current" as const,
    } as CloudflareDnsProjectionAck));
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([]),
      desktopAccessTokens: { async verifyAccessToken(token) { return token === "obs-token" ? principal : null; } },
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-09-15T00:00:00Z"),
      correlationIds: () => "observation-route-correlation",
      ports: {
        ...denyingPublicApplicationPorts,
        cloudflareDnsObservation: { submit },
      },
    });
    apps.push(app);
    const accepted = await app.inject({
      method: "POST", url: CLOUDFLARE_DNS_OBSERVATION_ROUTE,
      headers: { authorization: "Bearer obs-token" }, payload: projection,
    });
    expect(accepted.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledWith(projection, principal);
    const injected = await app.inject({
      method: "POST", url: CLOUDFLARE_DNS_OBSERVATION_ROUTE,
      headers: { authorization: "Bearer obs-token" }, payload: { ...projection, workspaceId: "foreign" },
    });
    expect(injected.statusCode).toBe(400);
    expect(submit).toHaveBeenCalledTimes(1);
    const cookie = await app.inject({
      method: "POST", url: CLOUDFLARE_DNS_OBSERVATION_ROUTE,
      headers: { cookie: "gd_session=unknown" }, payload: projection,
    });
    expect(cookie.statusCode).toBe(401);
  });
});
