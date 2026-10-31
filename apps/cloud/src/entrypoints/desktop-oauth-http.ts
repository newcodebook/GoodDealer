import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Pool } from "pg";

import {
  AccountTransactionRunner,
  IdentityCapabilityTransactionRunner,
  PreAuthEmailTransactionRunner,
} from "../db/index";
import {
  PostgresDesktopLoginLease,
  PostgresDeviceLoginProof,
  type ActiveDeviceLeaseSigner,
  type ActiveDeviceLeaseVerifier,
} from "../modules/devices/index";
import { PostgresEntitlementDeadlineReader } from "../modules/licensing/index";
import {
  DESKTOP_OAUTH_CLIENT_ID,
  DESKTOP_OAUTH_REDIRECT_URI,
  DesktopTokenRefreshService,
  PostgresDesktopOAuthAuthorizationService,
  PostgresIdentityAuthenticationRepository,
} from "../modules/identity/index";
import { IdentityAccountSessionVerifier, type IdentitySessionVerificationReader } from "../modules/identity/index";
import {
  InMemoryFixedWindowRateLimiter,
  cookieValue,
  preAuthRateLimitIdentity,
  trustLoopbackProxy,
  type RateLimitPolicy,
} from "./adapter/rate-limit";
import {
  CloudPublicSessionVerifier,
  PUBLIC_SESSION_COOKIE,
  type PublicSessionVerifierPort,
} from "./ports/public-session";

type DesktopOAuthAuthorizationPort = Pick<PostgresDesktopOAuthAuthorizationService, "authorize" | "exchange">;
type DesktopTokenRefreshPort = Pick<DesktopTokenRefreshService, "rotate">;

class InvalidOAuthRequestError extends Error {}

export interface DesktopOAuthHttpDependencies {
  readonly sessions: PublicSessionVerifierPort;
  readonly authorization: DesktopOAuthAuthorizationPort;
  readonly refresh: DesktopTokenRefreshPort;
  readonly rateLimit: RateLimitPolicy;
  readonly now: () => Date;
}

export interface PostgresDesktopOAuthHttpDependencies
  extends Omit<DesktopOAuthHttpDependencies, "sessions" | "authorization" | "refresh"> {
  readonly pool: Pool;
  readonly accountApiPool: Pool;
  readonly identityCapabilityIssuerPool: Pool;
  readonly identity: IdentitySessionVerificationReader;
  readonly activeDeviceLeaseSigner: ActiveDeviceLeaseSigner;
  readonly activeDeviceLeaseVerifier: ActiveDeviceLeaseVerifier;
}

export const DESKTOP_OAUTH_AUTHORIZE_ROUTE = "/v1/desktop-oauth/authorize" as const;
export const DESKTOP_OAUTH_TOKEN_ROUTE = "/v1/desktop-oauth/token" as const;
export const DESKTOP_OAUTH_BODY_LIMIT_BYTES = 4_096;
export const DESKTOP_OAUTH_MAX_URL_LENGTH = 2_048;

export function createPostgresDesktopOAuthHttp(
  deps: PostgresDesktopOAuthHttpDependencies,
): FastifyInstance {
  const transactions = new AccountTransactionRunner(deps.pool);
  const authenticatedTransactions = new IdentityCapabilityTransactionRunner(
    deps.accountApiPool,
    deps.identityCapabilityIssuerPool,
  );
  const authentication = new PostgresIdentityAuthenticationRepository(
    new PreAuthEmailTransactionRunner(deps.pool),
    transactions,
  );
  const leases = new PostgresDesktopLoginLease({
    transactions,
    entitlement: new PostgresEntitlementDeadlineReader(authenticatedTransactions),
    signer: deps.activeDeviceLeaseSigner,
    verifier: deps.activeDeviceLeaseVerifier,
  });
  return createDesktopOAuthHttp({
    sessions: new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier(deps.identity)),
    authorization: new PostgresDesktopOAuthAuthorizationService(
      transactions,
      authentication,
      new PostgresDeviceLoginProof(transactions),
      leases,
      authenticatedTransactions,
    ),
    refresh: new DesktopTokenRefreshService(authentication, leases),
    rateLimit: deps.rateLimit,
    now: deps.now,
  });
}

/** Browser authorization and native token exchange intentionally live outside session APIs. */
export function createDesktopOAuthHttp(deps: DesktopOAuthHttpDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: DESKTOP_OAUTH_BODY_LIMIT_BYTES,
    trustProxy: trustLoopbackProxy,
  });
  const limiter = new InMemoryFixedWindowRateLimiter(deps.rateLimit);
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        if (typeof body !== "string") throw new InvalidOAuthRequestError();
        done(null, parseFormBody(body));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
    reply.header("referrer-policy", "no-referrer");
    if ((request.raw.url?.length ?? 0) > DESKTOP_OAUTH_MAX_URL_LENGTH) return reply.code(413).send();
    if (!limiter.consume(preAuthRateLimitIdentity(request.ip)).allowed) return reply.code(429).send();
  });

  app.get(DESKTOP_OAUTH_AUTHORIZE_ROUTE, async (request, reply) => {
    if (request.headers.authorization !== undefined) return reply.code(400).send();
    const query = parseAuthorizationQuery(request.query);
    if (query === null) return reply.code(400).send();
    const evaluatedAt = deps.now();
    const principal = await deps.sessions.verify(
      cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE),
      evaluatedAt,
    );
    if (principal === null) {
      // Desktop opens this route on the Account Web origin, which proxies `/v1/*` here. Without a
      // session the browser is sent to sign in on that same origin and returns to this exact,
      // already-validated request; Account Web accepts no other continuation target.
      return reply.redirect(`/?continue=${encodeURIComponent(request.raw.url ?? "")}`, 302);
    }
    if (principal.clientKind !== "account_web") return reply.code(401).send();
    const proof = query.challenge_id === undefined ? {} : {
      proof: {
        challengeId: query.challenge_id,
        signature: query.device_signature as string,
      },
    };
    const result = await deps.authorization.authorize({
      principal,
      deviceId: query.device_id,
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      keyId: query.key_id,
      publicKey: query.public_key,
      ...proof,
      evaluatedAt,
    });
    if (!result.authorized && "challengeRequired" in result && result.challengeRequired) {
      const callback = new URL(DESKTOP_OAUTH_REDIRECT_URI);
      callback.searchParams.set("challenge_id", result.challenge.challengeId);
      callback.searchParams.set("account_id", result.challenge.accountId);
      callback.searchParams.set("device_id", result.challenge.deviceId);
      callback.searchParams.set("key_id", result.challenge.keyId);
      callback.searchParams.set("nonce_digest", result.challenge.nonceDigest);
      callback.searchParams.set("expires_at", result.challenge.expiresAt);
      callback.searchParams.set("state", query.state);
      return reply.redirect(callback.toString(), 302);
    }
    if (!result.authorized) return reply.code(403).send();
    const callback = new URL(DESKTOP_OAUTH_REDIRECT_URI);
    callback.searchParams.set("code", result.code);
    callback.searchParams.set("state", query.state);
    return reply.redirect(callback.toString(), 302);
  });

  app.post(DESKTOP_OAUTH_TOKEN_ROUTE, async (request, reply) => {
    if (!isFormUrlEncoded(request.headers["content-type"])) {
      return reply.code(415).send({ error: "invalid_request" });
    }
    if (request.headers.cookie !== undefined || request.headers.authorization !== undefined) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const form = parseTokenForm(request.body);
    if (form === null) return reply.code(400).send({ error: "invalid_request" });
    const evaluatedAt = deps.now();
    if (form.grant_type === "authorization_code") {
      const result = await deps.authorization.exchange({
        code: form.code,
        codeVerifier: form.code_verifier,
        clientId: form.client_id,
        redirectUri: form.redirect_uri,
        evaluatedAt,
      });
      if (!result.exchanged) return reply.code(400).send({ error: "invalid_grant" });
      return result.credentials.consume((credentials) => reply.code(200).send({
        token_type: "Bearer",
        access_token: credentials.accessToken,
        expires_in: secondsUntil(result.credentials.accessTokenExpiresAt, evaluatedAt),
        refresh_token: credentials.refreshToken,
        refresh_expires_in: secondsUntil(result.credentials.refreshTokenExpiresAt, evaluatedAt),
      }));
    }
    const result = await deps.refresh.rotate({
      refreshToken: form.refresh_token,
      deviceId: form.device_id,
      requestId: form.request_id,
      evaluatedAt,
    });
    if (!result.rotated) {
      if (result.reason === "authorization_unavailable" || result.reason === "rotation_conflict") {
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
      return reply.code(400).send({ error: "invalid_grant" });
    }
    return result.credentials.consume((credentials) => reply.code(200).send({
      token_type: "Bearer",
      access_token: credentials.accessToken,
      expires_in: secondsUntil(result.credentials.accessTokenExpiresAt, evaluatedAt),
      refresh_token: credentials.refreshToken,
      refresh_expires_in: secondsUntil(result.credentials.refreshTokenExpiresAt, evaluatedAt),
      rotation_generation: result.credentials.rotationGeneration,
    }));
  });

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send());
  app.setErrorHandler(async (error: FastifyError, _request, reply) => {
    if (error.statusCode === 413) return reply.code(413).send();
    if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return reply.code(415).send();
    if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY" || error instanceof InvalidOAuthRequestError) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    return reply.code(500).send();
  });
  return app;
}

function parseAuthorizationQuery(value: unknown): {
  readonly response_type: "code";
  readonly client_id: typeof DESKTOP_OAUTH_CLIENT_ID;
  readonly redirect_uri: typeof DESKTOP_OAUTH_REDIRECT_URI;
  readonly code_challenge: string;
  readonly code_challenge_method: "S256";
  readonly device_id: string;
  readonly key_id: string;
  readonly public_key: string;
  readonly state: string;
  readonly challenge_id?: string;
  readonly device_signature?: string;
} | null {
  if (!isRecord(value)) return null;
  const baseKeys = [
    "response_type", "client_id", "redirect_uri", "code_challenge",
    "code_challenge_method", "device_id", "key_id", "public_key", "state",
  ];
  const initial = hasExactKeys(value, baseKeys);
  const proof = hasExactKeys(value, [...baseKeys, "challenge_id", "device_signature"]);
  if (!initial && !proof) return null;
  if (
    value.response_type !== "code" || value.client_id !== DESKTOP_OAUTH_CLIENT_ID
    || value.redirect_uri !== DESKTOP_OAUTH_REDIRECT_URI || value.code_challenge_method !== "S256"
    || typeof value.code_challenge !== "string" || typeof value.device_id !== "string"
    || typeof value.key_id !== "string" || typeof value.public_key !== "string"
    || typeof value.state !== "string" || !/^[A-Za-z0-9._~-]{32,128}$/u.test(value.state)
  ) return null;
  if (proof && (typeof value.challenge_id !== "string" || typeof value.device_signature !== "string")) {
    return null;
  }
  return {
    response_type: "code",
    client_id: DESKTOP_OAUTH_CLIENT_ID,
    redirect_uri: DESKTOP_OAUTH_REDIRECT_URI,
    code_challenge: value.code_challenge,
    code_challenge_method: "S256",
    device_id: value.device_id,
    key_id: value.key_id,
    public_key: value.public_key,
    state: value.state,
    ...(proof ? {
      challenge_id: value.challenge_id as string,
      device_signature: value.device_signature as string,
    } : {}),
  };
}

type AuthorizationCodeForm = {
  readonly grant_type: "authorization_code";
  readonly code: string;
  readonly code_verifier: string;
  readonly client_id: string;
  readonly redirect_uri: string;
};
type RefreshTokenForm = {
  readonly grant_type: "refresh_token";
  readonly refresh_token: string;
  readonly device_id: string;
  readonly request_id: string;
};

function parseTokenForm(value: unknown): AuthorizationCodeForm | RefreshTokenForm | null {
  if (!isRecord(value)) return null;
  if (value.grant_type === "authorization_code" && hasExactKeys(value, [
    "grant_type", "code", "code_verifier", "client_id", "redirect_uri",
  ])) {
    return allStrings(value) ? value as AuthorizationCodeForm : null;
  }
  if (value.grant_type === "refresh_token" && hasExactKeys(value, [
    "grant_type", "refresh_token", "device_id", "request_id",
  ])) {
    return allStrings(value) ? value as RefreshTokenForm : null;
  }
  return null;
}

function isFormUrlEncoded(value: string | undefined): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded";
}

function parseFormBody(body: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of new URLSearchParams(body)) {
    if (Object.hasOwn(result, key)) throw new InvalidOAuthRequestError();
    result[key] = value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && [...expected].sort().every((key, index) => key === actual[index]);
}

function allStrings(value: Record<string, unknown>): boolean {
  return Object.values(value).every((field) => typeof field === "string");
}

function secondsUntil(expiresAt: string, now: Date): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now.getTime()) / 1_000));
}
