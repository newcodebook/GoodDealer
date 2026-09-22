import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";

import type { IdentityAccountAccessService } from "../modules/identity/account-access";
import {
  cookieValue,
  InMemoryFixedWindowRateLimiter,
  preAuthRateLimitIdentity,
  rateLimitPolicy,
  type RateLimitPolicy,
  trustLoopbackProxy,
} from "./adapter/rate-limit";
import { PUBLIC_SESSION_COOKIE, type PublicSessionVerifierPort } from "./ports/public-session";

export type IdentityBoundaryOperation =
  | "registration" | "registration_resend" | "registration_verify"
  | "login" | "session_discovery" | "logout"
  | "password_reset_request" | "password_reset_complete";

export interface IdentityBoundaryObservation {
  readonly operation: IdentityBoundaryOperation;
  readonly outcome: "accepted" | "authenticated" | "completed" | "invalid" | "rate_limited" | "signed_out" | "unavailable";
}

export interface IdentityBoundaryObserver {
  observe(event: IdentityBoundaryObservation): void | Promise<void>;
}

export interface IdentityHttpDependencies {
  readonly accounts: IdentityAccountAccessService;
  readonly sessions: PublicSessionVerifierPort;
  readonly allowedOrigins: readonly string[];
  readonly now: () => Date;
  /** Independent server secret used only to derive the opaque browser custody namespace. */
  readonly accountNamespaceKey: Uint8Array;
  readonly rateLimit?: RateLimitPolicy;
  readonly observer?: IdentityBoundaryObserver;
}

export function createIdentityHttp(dependencies: IdentityHttpDependencies): FastifyInstance {
  const allowedOrigins = new Set(dependencies.allowedOrigins.map(parseOrigin));
  if (allowedOrigins.size === 0) throw new TypeError("Identity HTTP requires an allowed origin");
  if (dependencies.accountNamespaceKey.byteLength !== 32) {
    throw new TypeError("Identity HTTP account namespace key is invalid");
  }
  const accountNamespaceKey = Uint8Array.from(dependencies.accountNamespaceKey);
  const limiter = new InMemoryFixedWindowRateLimiter(
    dependencies.rateLimit ?? rateLimitPolicy(60_000, 30),
  );
  const app = Fastify({
    logger: false,
    bodyLimit: 4_096,
    requestTimeout: 15_000,
    trustProxy: trustLoopbackProxy,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    if (request.method !== "POST") return;
    const origin = request.headers.origin;
    const fetchSite = request.headers["sec-fetch-site"];
    if (typeof origin !== "string" || !allowedOrigins.has(origin)
      || (fetchSite !== undefined && fetchSite !== "same-origin")) {
      return reply.code(403).send({ status: "invalid" });
    }
    const operation = operationFor(request.url);
    const decision = limiter.consume(preAuthRateLimitIdentity(`${request.ip}|${operation}`));
    if (!decision.allowed) {
      await observe(dependencies.observer, operation, "rate_limited");
      reply.header("retry-after", String(decision.retryAfterSeconds ?? 1));
      return reply.code(429).send({ status: "rate_limited" });
    }
  });

  app.post("/v1/identity/registration", async (request, reply) => {
    const body = credentials(request.body);
    if (body === null) {
      await observe(dependencies.observer, "registration", "invalid");
      return reply.code(400).send({ status: "invalid" });
    }
    const result = await dependencies.accounts.requestRegistration(body.email, body.password);
    await observe(dependencies.observer, "registration", result.status === "invalid" ? "invalid" : "accepted");
    return result.status === "invalid" ? reply.code(400).send({ status: "invalid" })
      : reply.code(202).send({ status: "accepted" });
  });

  app.post("/v1/identity/registration/resend", async (request, reply) => {
    const body = emailOnly(request.body);
    if (body === null) {
      await observe(dependencies.observer, "registration_resend", "invalid");
      return reply.code(400).send({ status: "invalid" });
    }
    const result = await dependencies.accounts.resendRegistration(body.email);
    await observe(dependencies.observer, "registration_resend", result.status === "invalid" ? "invalid" : "accepted");
    return result.status === "invalid" ? reply.code(400).send({ status: "invalid" })
      : reply.code(202).send({ status: "accepted" });
  });

  app.post("/v1/identity/registration/verify", async (request, reply) => {
    const body = verification(request.body);
    if (body === null) {
      await observe(dependencies.observer, "registration_verify", "invalid");
      return reply.code(400).send({ status: "invalid" });
    }
    const result = await dependencies.accounts.verifyRegistration(body.email, body.code);
    await observe(dependencies.observer, "registration_verify", result.status === "verified" ? "completed" : "invalid");
    return result.status === "verified" ? reply.code(200).send({ status: "verified" })
      : reply.code(401).send({ status: "invalid" });
  });

  app.post("/v1/identity/login", async (request, reply) => {
    const body = credentials(request.body);
    if (body === null) {
      await observe(dependencies.observer, "login", "invalid");
      return reply.code(400).send({ status: "invalid" });
    }
    const presented = await dependencies.sessions.verify(
      cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE), dependencies.now(),
    );
    const result = await dependencies.accounts.login(body.email, body.password,
      presented?.clientKind === "account_web"
        ? { accountId: presented.accountId, sessionId: presented.sessionId }
        : undefined);
    if (result.status !== "authenticated") {
      await observe(dependencies.observer, "login", "invalid");
      return reply.code(401).send({ status: "invalid" });
    }
    setSessionCookie(reply, result.sessionCredential, result.expiresAt);
    await observe(dependencies.observer, "login", "authenticated");
    return reply.code(200).send({ status: "authenticated" });
  });

  app.post("/v1/identity/password-reset", async (request, reply) => {
    const body = emailOnly(request.body);
    if (body === null) {
      await observe(dependencies.observer, "password_reset_request", "invalid");
      return reply.code(400).send({ status: "invalid" });
    }
    const result = await dependencies.accounts.requestPasswordReset(body.email);
    await observe(dependencies.observer, "password_reset_request", result.status === "invalid" ? "invalid" : "accepted");
    return result.status === "invalid" ? reply.code(400).send({ status: "invalid" })
      : reply.code(202).send({ status: "accepted" });
  });

  app.post("/v1/identity/password-reset/complete", async (request, reply) => {
    const body = passwordReset(request.body);
    if (body === null) {
      await observe(dependencies.observer, "password_reset_complete", "invalid");
      return reply.code(400).send({ status: "invalid" });
    }
    const result = await dependencies.accounts.resetPassword(body.email, body.code, body.password);
    await observe(dependencies.observer, "password_reset_complete", result.status === "completed" ? "completed" : "invalid");
    return result.status === "completed" ? reply.code(200).send({ status: "completed" })
      : reply.code(401).send({ status: "invalid" });
  });

  app.post("/v1/identity/logout", async (request, reply) => {
    const principal = await dependencies.sessions.verify(
      cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE), dependencies.now(),
    );
    if (principal?.clientKind === "account_web") {
      await dependencies.accounts.logout({ accountId: principal.accountId, sessionId: principal.sessionId });
    }
    clearSessionCookie(reply);
    await observe(dependencies.observer, "logout", "signed_out");
    return reply.code(200).send({ status: "signed_out" });
  });

  app.get("/v1/identity/session", async (request, reply) => {
    const principal = await dependencies.sessions.verify(
      cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE), dependencies.now(),
    );
    if (principal?.clientKind === "account_web") {
      await observe(dependencies.observer, "session_discovery", "authenticated");
      return reply.code(200).send({ status: "authenticated", namespace: accountNamespace(principal.accountId, accountNamespaceKey) });
    }
    clearSessionCookie(reply);
    await observe(dependencies.observer, "session_discovery", "signed_out");
    return reply.code(401).send({ status: "signed_out" });
  });

  app.setErrorHandler(async (_error, request, reply) => {
    if (reply.sent) return;
    await observe(dependencies.observer, operationFor(request.url), "unavailable");
    return reply.code(500).send({ status: "unavailable" });
  });
  return app;
}

function accountNamespace(accountId: string, key: Uint8Array): string {
  return createHmac("sha256", key)
    .update("GOODDEALER-ACCOUNT-WEB-NAMESPACE-V1\0", "utf8")
    .update(accountId, "utf8")
    .digest("base64url");
}

function credentials(value: unknown): { email: string; password: string } | null {
  return exactStrings(value, ["email", "password"]);
}

function verification(value: unknown): { email: string; code: string } | null {
  return exactStrings(value, ["email", "code"]);
}

function emailOnly(value: unknown): { email: string } | null {
  return exactStrings(value, ["email"]);
}

function passwordReset(value: unknown): { email: string; code: string; password: string } | null {
  return exactStrings(value, ["email", "code", "password"]);
}

function exactStrings<Key extends string>(value: unknown, keys: readonly Key[]): Record<Key, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key as Key))) return null;
  const output = Object.create(null) as Record<Key, string>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true
      || typeof descriptor.value !== "string") return null;
    output[key] = descriptor.value;
  }
  return output;
}

function parseOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username !== "" || url.password !== "") {
    throw new TypeError("Identity HTTP allowed origin must be an exact HTTPS origin");
  }
  return value;
}

function setSessionCookie(reply: { header(name: string, value: string): unknown }, value: string, expiresAt: Date): void {
  reply.header("set-cookie", `${PUBLIC_SESSION_COOKIE}=${value}; Path=/; Expires=${expiresAt.toUTCString()}; Secure; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(reply: { header(name: string, value: string): unknown }): void {
  reply.header("set-cookie", `${PUBLIC_SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
}

async function observe(
  observer: IdentityBoundaryObserver | undefined,
  operation: IdentityBoundaryOperation,
  outcome: IdentityBoundaryObservation["outcome"],
): Promise<void> {
  try {
    await observer?.observe({ operation, outcome });
  } catch {
    // Observability is deliberately non-authoritative and contains no credential fallback path.
  }
}

function operationFor(url: string): IdentityBoundaryOperation {
  const path = url.split("?", 1)[0];
  if (path === "/v1/identity/registration") return "registration";
  if (path === "/v1/identity/registration/resend") return "registration_resend";
  if (path === "/v1/identity/registration/verify") return "registration_verify";
  if (path === "/v1/identity/login") return "login";
  if (path === "/v1/identity/logout") return "logout";
  if (path === "/v1/identity/password-reset") return "password_reset_request";
  if (path === "/v1/identity/password-reset/complete") return "password_reset_complete";
  return "session_discovery";
}
