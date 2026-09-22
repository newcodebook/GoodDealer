import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIdentityHttp } from "../../src/entrypoints/identity-http";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";

const expiresAt = new Date("2026-10-04T00:00:00Z");
const origin = "https://account.gooddealer.com";
const namespaceKey = new Uint8Array(32).fill(7);

describe("Identity HTTP ingress", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  function create(overrides: Record<string, unknown> = {}, accountId = "account-a") {
    const accounts = {
      requestRegistration: vi.fn(async () => ({ status: "accepted" as const })),
      resendRegistration: vi.fn(async () => ({ status: "accepted" as const })),
      verifyRegistration: vi.fn(async () => ({ status: "verified" as const })),
      login: vi.fn(async () => ({ status: "authenticated" as const, sessionCredential: "fresh-session", expiresAt })),
      requestPasswordReset: vi.fn(async () => ({ status: "accepted" as const })),
      resetPassword: vi.fn(async () => ({ status: "completed" as const })),
      logout: vi.fn(async () => ({ status: "signed_out" as const })),
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

  it("replaces and revokes a presented session with a fresh secure host-only cookie", async () => {
    const { app, accounts } = create();
    const response = await app.inject({
      method: "POST", url: "/v1/identity/login",
      headers: { origin, cookie: "gd_session=replacement-session" },
      payload: { email: "owner@example.com", password: "correct horse battery staple" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBe(
      "gd_session=fresh-session; Path=/; Expires=Sun, 04 Oct 2026 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
    );
    expect(response.headers["set-cookie"]).not.toContain("Domain=");
    expect(accounts.login).toHaveBeenCalledWith("owner@example.com", "correct horse battery staple", {
      accountId: "account-a", sessionId: "replacement-session",
    });
  });

  it("verifies without creating a session, supports enumeration-safe resend and password recovery", async () => {
    const { app, accounts } = create();
    const verify = await app.inject({ method: "POST", url: "/v1/identity/registration/verify", headers: { origin },
      payload: { email: "owner@example.com", code: "123456" } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ status: "verified" });
    expect(verify.headers["set-cookie"]).toBeUndefined();
    const resend = await app.inject({ method: "POST", url: "/v1/identity/registration/resend", headers: { origin },
      payload: { email: "owner@example.com" } });
    expect(resend.statusCode).toBe(202);
    expect(resend.json()).toEqual({ status: "accepted" });
    const requested = await app.inject({ method: "POST", url: "/v1/identity/password-reset", headers: { origin },
      payload: { email: "owner@example.com" } });
    expect(requested.statusCode).toBe(202);
    const completed = await app.inject({ method: "POST", url: "/v1/identity/password-reset/complete", headers: { origin },
      payload: { email: "owner@example.com", code: "123456", password: "replacement horse battery staple" } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ status: "completed" });
    expect(accounts.resendRegistration).toHaveBeenCalledTimes(1);
    expect(accounts.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(accounts.resetPassword).toHaveBeenCalledTimes(1);
  });

  it("revokes logout server-side, clears the host-only cookie, and remains idempotent", async () => {
    const { app, accounts } = create();
    const response = await app.inject({ method: "POST", url: "/v1/identity/logout",
      headers: { origin, cookie: "gd_session=fresh-session" }, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "signed_out" });
    expect(response.headers["set-cookie"]).toBe(
      "gd_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
    );
    expect(accounts.logout).toHaveBeenCalledWith({ accountId: "account-a", sessionId: "fresh-session" });
    const repeated = await app.inject({ method: "POST", url: "/v1/identity/logout", headers: { origin }, payload: {} });
    expect(repeated.statusCode).toBe(200);
    expect(accounts.logout).toHaveBeenCalledTimes(1);
  });

  it("rate-limits state-changing access by trusted client address without observing credentials", async () => {
    const observations: unknown[] = [];
    const accounts = {
      requestRegistration: vi.fn(async () => ({ status: "accepted" as const })),
      login: vi.fn(async () => ({ status: "authenticated" as const, sessionCredential: "fresh-session", expiresAt })),
    };
    const app = createIdentityHttp({
      accounts: accounts as never,
      sessions: { cookieName: "gd_session", async verify() { return null; } },
      allowedOrigins: [origin], now: () => new Date("2026-09-04T00:00:00Z"),
      accountNamespaceKey: namespaceKey,
      rateLimit: rateLimitPolicy(60_000, 1),
      observer: { observe(event) { observations.push(event); } },
    });
    apps.push(app);
    const request = { method: "POST" as const, url: "/v1/identity/registration", headers: { origin },
      payload: { email: "owner@example.com", password: "correct horse battery staple" } };
    expect((await app.inject(request)).statusCode).toBe(202);
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ status: "rate_limited" });
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await app.inject({
      method: "POST", url: "/v1/identity/login", headers: { origin },
      payload: { email: "owner@example.com", password: "correct horse battery staple" },
    })).statusCode).toBe(200);
    expect(JSON.stringify(observations)).not.toContain("owner@example.com");
    expect(JSON.stringify(observations)).not.toContain("correct horse");
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
