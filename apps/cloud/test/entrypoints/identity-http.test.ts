import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIdentityHttp } from "../../src/entrypoints/identity-http";

const expiresAt = new Date("2026-10-04T00:00:00Z");
const origin = "https://account.gooddealer.com";
const namespaceKey = new Uint8Array(32).fill(7);

describe("Identity HTTP ingress", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  function create(overrides: Record<string, unknown> = {}, accountId = "account-a") {
    const accounts = {
      requestRegistration: vi.fn(async () => ({ status: "accepted" as const })),
      verifyRegistration: vi.fn(async () => ({
        status: "authenticated" as const, sessionCredential: "fresh-session", expiresAt,
      })),
      login: vi.fn(async () => ({ status: "authenticated" as const, sessionCredential: "fresh-session", expiresAt })),
      ...overrides,
    };
    const app = createIdentityHttp({
      accounts: accounts as never,
      sessions: {
        cookieName: "gd_session",
        async verify(value) {
          return value === "fresh-session" || value === "replacement-session"
            ? { accountId, sessionId: value, clientKind: "account_web" } : null;
        },
      },
      allowedOrigins: [origin], now: () => new Date("2026-09-04T00:00:00Z"),
      accountNamespaceKey: namespaceKey,
    });
    apps.push(app);
    return { app, accounts };
  }

  it("keeps registration enumeration-safe while rejecting malformed wire data", async () => {
    const { app, accounts } = create({ requestRegistration: vi.fn(async () => ({ status: "accepted" })) });
    const accepted = await app.inject({
      method: "POST", url: "/v1/identity/registration", headers: { origin, "sec-fetch-site": "same-origin" },
      payload: { email: "owner@example.com", password: "correct horse battery staple" },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ status: "accepted" });
    for (const payload of [
      { email: "owner@example.com" },
      { email: "owner@example.com", password: "secret", accountId: "attacker" },
    ]) {
      expect((await app.inject({ method: "POST", url: "/v1/identity/registration", headers: { origin }, payload })).statusCode)
        .toBe(400);
    }
    expect(accounts.requestRegistration).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-site and missing origins before credentials reach the application", async () => {
    const { app, accounts } = create();
    for (const headers of [
      {},
      { origin: "https://evil.example" },
      { origin, "sec-fetch-site": "cross-site" },
    ]) {
      const response = await app.inject({
        method: "POST", url: "/v1/identity/login", headers,
        payload: { email: "owner@example.com", password: "correct horse battery staple" },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(accounts.login).not.toHaveBeenCalled();
  });

  it("replaces any presented session with a fresh secure host-only cookie", async () => {
    const { app } = create();
    const response = await app.inject({
      method: "POST", url: "/v1/identity/login",
      headers: { origin, cookie: "gd_session=attacker-fixed" },
      payload: { email: "owner@example.com", password: "correct horse battery staple" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBe(
      "gd_session=fresh-session; Path=/; Expires=Sun, 04 Oct 2026 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
    );
    expect(response.headers["set-cookie"]).not.toContain("Domain=");
  });

  it("maps unknown, unverified, and wrong-password login outcomes to one response", async () => {
    const { app } = create({ login: vi.fn(async () => ({ status: "invalid" })) });
    const response = await app.inject({
      method: "POST", url: "/v1/identity/login", headers: { origin },
      payload: { email: "missing@example.com", password: "some-password" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ status: "invalid" });
  });

  it("returns only session state and an opaque stable namespace, never account identifiers", async () => {
    const { app } = create();
    const signedIn = await app.inject({
      method: "GET", url: "/v1/identity/session", headers: { cookie: "gd_session=fresh-session" },
    });
    const body = signedIn.json() as { status: string; namespace: string };
    expect(body.status).toBe("authenticated");
    expect(body.namespace).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(body.namespace).not.toContain("account-a");
    expect(signedIn.body).not.toContain("account-a");
    expect((await app.inject({ method: "GET", url: "/v1/identity/session" })).json())
      .toEqual({ status: "signed_out" });
  });

  it("keeps namespaces stable for one account and distinct across accounts", async () => {
    const { app } = create();
    const first = await app.inject({ method: "GET", url: "/v1/identity/session", headers: { cookie: "gd_session=fresh-session" } });
    const firstNamespace = (first.json() as { namespace: string }).namespace;
    const replacement = await app.inject({ method: "GET", url: "/v1/identity/session", headers: { cookie: "gd_session=replacement-session" } });
    expect((replacement.json() as { namespace: string }).namespace).toBe(firstNamespace);
    const secondApp = create({}, "account-b");
    const second = await secondApp.app.inject({ method: "GET", url: "/v1/identity/session", headers: { cookie: "gd_session=fresh-session" } });
    expect((second.json() as { namespace: string }).namespace).not.toBe(firstNamespace);
  });

  it("rejects a missing-strength namespace derivation key at composition", () => {
    expect(() => createIdentityHttp({
      accounts: {} as never,
      sessions: { cookieName: "gd_session", async verify() { return null; } },
      allowedOrigins: [origin],
      now: () => new Date(),
      accountNamespaceKey: new Uint8Array(31),
    })).toThrow(/namespace key/u);
  });
});
