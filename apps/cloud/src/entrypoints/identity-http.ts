import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";

import type { IdentityAccountAccessService } from "../modules/identity/account-access";
import { cookieValue } from "./adapter/rate-limit";
import { PUBLIC_SESSION_COOKIE, type PublicSessionVerifierPort } from "./ports/public-session";

export interface IdentityHttpDependencies {
  readonly accounts: IdentityAccountAccessService;
  readonly sessions: PublicSessionVerifierPort;
  readonly allowedOrigins: readonly string[];
  readonly now: () => Date;
  /** Independent server secret used only to derive the opaque browser custody namespace. */
  readonly accountNamespaceKey: Uint8Array;
}

export function createIdentityHttp(dependencies: IdentityHttpDependencies): FastifyInstance {
  const allowedOrigins = new Set(dependencies.allowedOrigins.map(parseOrigin));
  if (allowedOrigins.size === 0) throw new TypeError("Identity HTTP requires an allowed origin");
  if (dependencies.accountNamespaceKey.byteLength !== 32) {
    throw new TypeError("Identity HTTP account namespace key is invalid");
  }
  const accountNamespaceKey = Uint8Array.from(dependencies.accountNamespaceKey);
  const app = Fastify({ logger: false, bodyLimit: 4_096, requestTimeout: 15_000 });

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
  });

  app.post("/v1/identity/registration", async (request, reply) => {
    const body = credentials(request.body);
    if (body === null) return reply.code(400).send({ status: "invalid" });
    const result = await dependencies.accounts.requestRegistration(body.email, body.password);
    return result.status === "invalid"
      ? reply.code(400).send({ status: "invalid" })
      : reply.code(202).send({ status: "accepted" });
  });

  app.post("/v1/identity/registration/verify", async (request, reply) => {
    const body = verification(request.body);
    if (body === null) return reply.code(400).send({ status: "invalid" });
    const result = await dependencies.accounts.verifyRegistration(body.email, body.code);
    if (result.status !== "authenticated") return reply.code(401).send({ status: "invalid" });
    setSessionCookie(reply, result.sessionCredential, result.expiresAt);
    return reply.code(200).send({ status: "authenticated" });
  });

  app.post("/v1/identity/login", async (request, reply) => {
    const body = credentials(request.body);
    if (body === null) return reply.code(400).send({ status: "invalid" });
    const result = await dependencies.accounts.login(body.email, body.password);
    if (result.status !== "authenticated") return reply.code(401).send({ status: "invalid" });
    setSessionCookie(reply, result.sessionCredential, result.expiresAt);
    return reply.code(200).send({ status: "authenticated" });
  });

  app.get("/v1/identity/session", async (request, reply) => {
    const principal = await dependencies.sessions.verify(
      cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE), dependencies.now(),
    );
    return principal?.clientKind === "account_web"
      ? reply.code(200).send({ status: "authenticated", namespace: accountNamespace(principal.accountId, accountNamespaceKey) })
      : reply.code(401).send({ status: "signed_out" });
  });

  app.setErrorHandler(async (_error, _request, reply) => {
    if (reply.sent) return;
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
