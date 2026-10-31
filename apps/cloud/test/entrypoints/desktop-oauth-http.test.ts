import { describe, expect, it, vi } from "vitest";

import {
  createDesktopOAuthHttp,
  DESKTOP_OAUTH_AUTHORIZE_ROUTE,
  DESKTOP_OAUTH_TOKEN_ROUTE,
} from "../../src/entrypoints/desktop-oauth-http";
import {
  ConsumableDesktopCredentials,
  DESKTOP_OAUTH_CLIENT_ID,
  DESKTOP_OAUTH_REDIRECT_URI,
} from "../../src/modules/identity/index";
import { StaticPublicSessionVerifier } from "../support/public-session";

const now = new Date("2026-09-01T00:00:00Z");
const rateLimit = { windowMs: 60_000, burst: 100, identityHeaderNames: [] } as const;

describe("Desktop OAuth HTTP boundary", () => {
  it("authenticates authorization with the Account Web cookie and preserves state", async () => {
    const authorize = vi.fn(async () => ({ authorized: true as const, code: "gd_ac1.account.code" }));
    const app = createApp({ authorize });
    const query = new URLSearchParams({
      response_type: "code",
      client_id: DESKTOP_OAUTH_CLIENT_ID,
      redirect_uri: DESKTOP_OAUTH_REDIRECT_URI,
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
      device_id: "device-a",
      key_id: "device-key-a",
      public_key: "P".repeat(43),
      state: "S".repeat(32),
    });
    const response = await app.inject({
      method: "GET",
      url: `${DESKTOP_OAUTH_AUTHORIZE_ROUTE}?${query.toString()}`,
      headers: { cookie: "gd_session=web-session" },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `gooddealer://oauth/callback?code=gd_ac1.account.code&state=${"S".repeat(32)}`,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      principal: { accountId: "account-a", sessionId: "web-session", clientKind: "account_web" },
      deviceId: "device-a",
      keyId: "device-key-a",
      publicKey: "P".repeat(43),
    }));
    await app.close();
  });

  it("sends a browser without a session to same-origin sign-in that returns to this request", async () => {
    const authorize = vi.fn(async () => ({ authorized: true as const, code: "gd_ac1.account.code" }));
    const app = createApp({ authorize });
    const query = new URLSearchParams({
      response_type: "code",
      client_id: DESKTOP_OAUTH_CLIENT_ID,
      redirect_uri: DESKTOP_OAUTH_REDIRECT_URI,
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
      device_id: "device-a",
      key_id: "device-key-a",
      public_key: "P".repeat(43),
      state: "S".repeat(32),
    });
    const requested = `${DESKTOP_OAUTH_AUTHORIZE_ROUTE}?${query.toString()}`;
    for (const headers of [{}, { cookie: "gd_session=unknown-session" }]) {
      const response = await app.inject({ method: "GET", url: requested, headers });
      expect(response.statusCode).toBe(302);
      // Relative: the redirect stays on whichever proxying origin served the request.
      const location = response.headers.location ?? "";
      expect(location.startsWith("/?continue=")).toBe(true);
      expect(new URLSearchParams(location.slice(2)).get("continue")).toBe(requested);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(authorize).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an invalid authorization request before considering sign-in", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: `${DESKTOP_OAUTH_AUTHORIZE_ROUTE}?response_type=code&redirect_uri=https%3A%2F%2Fevil.example`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers.location).toBeUndefined();
    await app.close();
  });

  it("round-trips an account-scoped device challenge before issuing a code", async () => {
    const authorize = vi.fn(async () => ({
      authorized: false as const,
      challengeRequired: true as const,
      challenge: {
        challengeId: "login-challenge-a",
        accountId: "account-a",
        deviceId: "device-a",
        keyId: "device-key-a",
        nonceDigest: "N".repeat(43),
        expiresAt: "2026-09-01T00:02:00Z",
      },
    }));
    const query = new URLSearchParams({
      response_type: "code",
      client_id: DESKTOP_OAUTH_CLIENT_ID,
      redirect_uri: DESKTOP_OAUTH_REDIRECT_URI,
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
      device_id: "device-a",
      key_id: "device-key-a",
      public_key: "P".repeat(43),
      state: "S".repeat(32),
    });
    const app = createApp({ authorize });
    const response = await app.inject({
      method: "GET",
      url: `${DESKTOP_OAUTH_AUTHORIZE_ROUTE}?${query.toString()}`,
      headers: { cookie: "gd_session=web-session" },
    });
    expect(response.statusCode).toBe(302);
    const callback = new URL(response.headers.location ?? "");
    expect(callback.searchParams.get("challenge_id")).toBe("login-challenge-a");
    expect(callback.searchParams.get("nonce_digest")).toBe("N".repeat(43));
    expect(callback.searchParams.get("state")).toBe("S".repeat(32));
    await app.close();
  });

  it("exchanges an authorization code without exposing credentials to the application port", async () => {
    const credentials = new ConsumableDesktopCredentials(
      { accessToken: "non-secret-fixture-value-1", refreshToken: "non-secret-fixture-value-2" },
      "2026-09-01T00:15:00Z",
      "2026-10-01T00:00:00Z",
      0,
    );
    const exchange = vi.fn(async () => ({ exchanged: true as const, credentials }));
    const app = createApp({ exchange });
    const response = await app.inject({
      method: "POST",
      url: DESKTOP_OAUTH_TOKEN_ROUTE,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        code: "gd_ac1.account.code",
        code_verifier: "V".repeat(64),
        client_id: DESKTOP_OAUTH_CLIENT_ID,
        redirect_uri: DESKTOP_OAUTH_REDIRECT_URI,
      }).toString(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      token_type: "Bearer",
      access_token: "non-secret-fixture-value-1",
      expires_in: 900,
      refresh_token: "non-secret-fixture-value-2",
      refresh_expires_in: 2_592_000,
    });
    expect(exchange).toHaveBeenCalledWith(expect.objectContaining({ codeVerifier: "V".repeat(64) }));
    expect(JSON.stringify(credentials)).toBe('"[REDACTED]"');
    await app.close();
  });

  it("rotates a refresh token and collapses repository reasons into invalid_grant", async () => {
    const rotate = vi.fn(async () => ({ rotated: false as const, reason: "refresh_reuse_detected" as const }));
    const app = createApp({ rotate });
    const response = await app.inject({
      method: "POST",
      url: DESKTOP_OAUTH_TOKEN_ROUTE,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "non-secret-fixture-value-2",
        device_id: "device-a",
        request_id: "refresh-request-a",
      }).toString(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_grant" });
    expect(rotate).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: "device-a",
      requestId: "refresh-request-a",
    }));
    await app.close();
  });

  it("returns the persisted positive rotation generation with refreshed credentials", async () => {
    const credentials = new ConsumableDesktopCredentials(
      { accessToken: "non-secret-fixture-value-1", refreshToken: "non-secret-fixture-value-3" },
      "2026-09-01T00:15:00Z",
      "2026-10-01T00:00:00Z",
      3,
    );
    const app = createApp({
      rotate: vi.fn(async () => ({ rotated: true as const, credentials })),
    });
    const response = await app.inject({
      method: "POST",
      url: DESKTOP_OAUTH_TOKEN_ROUTE,
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      payload: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "non-secret-fixture-value-2",
        device_id: "device-a",
        request_id: "refresh-request-a",
      }).toString(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      token_type: "Bearer",
      rotation_generation: 3,
    });
    await app.close();
  });

  it("rejects credential ambiguity, duplicate fields, unsupported media and bad redirects", async () => {
    const app = createApp();
    const token = await app.inject({
      method: "POST",
      url: DESKTOP_OAUTH_TOKEN_ROUTE,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "gd_session=web-session",
      },
      payload: "grant_type=refresh_token&refresh_token=a&device_id=device-a&request_id=refresh-request-a",
    });
    expect(token.statusCode).toBe(400);
    expect((await app.inject({
      method: "POST",
      url: DESKTOP_OAUTH_TOKEN_ROUTE,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "grant_type=refresh_token&refresh_token=a&refresh_token=b&device_id=device-a&request_id=refresh-request-a",
    })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: DESKTOP_OAUTH_TOKEN_ROUTE, payload: "x" })).statusCode)
      .toBe(415);
    expect((await app.inject({
      method: "POST",
      url: DESKTOP_OAUTH_TOKEN_ROUTE,
      headers: { "content-type": "application/json" },
      payload: {
        grant_type: "refresh_token",
        refresh_token: "a",
        device_id: "device-a",
        request_id: "refresh-request-a",
      },
    })).statusCode).toBe(415);
    expect((await app.inject({
      method: "GET",
      url: `${DESKTOP_OAUTH_AUTHORIZE_ROUTE}?response_type=code&redirect_uri=https%3A%2F%2Fevil.example`,
      headers: { cookie: "gd_session=web-session" },
    })).statusCode).toBe(400);
    await app.close();
  });

  it.each(["authorization_unavailable", "rotation_conflict"] as const)(
    "keeps transient refresh failure %s distinct from invalid_grant",
    async (reason) => {
      const app = createApp({ rotate: vi.fn(async () => ({ rotated: false as const, reason })) });
      const response = await app.inject({
        method: "POST",
        url: DESKTOP_OAUTH_TOKEN_ROUTE,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: "non-secret-fixture-value-2",
          device_id: "device-a",
          request_id: "refresh-request-a",
        }).toString(),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "temporarily_unavailable" });
      await app.close();
    },
  );

  it("rate-limits OAuth clients by the address from the trusted loopback proxy", async () => {
    const app = createApp({
      rateLimit: { windowMs: 60_000, burst: 1, identityHeaderNames: [] },
    });
    const request = (client: string) => app.inject({
      method: "GET" as const,
      url: DESKTOP_OAUTH_AUTHORIZE_ROUTE,
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": client },
    });
    expect((await request("203.0.113.30")).statusCode).toBe(400);
    expect((await request("203.0.113.30")).statusCode).toBe(429);
    expect((await request("203.0.113.31")).statusCode).toBe(400);
    await app.close();
  });
});

function createApp(overrides: {
  readonly authorize?: (input: never) => Promise<unknown>;
  readonly exchange?: (input: never) => Promise<unknown>;
  readonly rotate?: (input: never) => Promise<unknown>;
  readonly rateLimit?: {
    readonly windowMs: number;
    readonly burst: number;
    readonly identityHeaderNames: readonly [];
  };
} = {}) {
  return createDesktopOAuthHttp({
    sessions: new StaticPublicSessionVerifier([
      { accountId: "account-a", sessionId: "web-session", clientKind: "account_web" },
    ]),
    authorization: {
      authorize: (overrides.authorize ?? vi.fn(async () => ({ authorized: false }))) as never,
      exchange: (overrides.exchange ?? vi.fn(async () => ({ exchanged: false }))) as never,
    },
    refresh: {
      rotate: (overrides.rotate ?? vi.fn(async () => ({ rotated: false, reason: "invalid_credentials" }))) as never,
    },
    rateLimit: overrides.rateLimit ?? rateLimit,
    now: () => now,
  });
}
