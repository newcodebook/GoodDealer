import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import type { AccountRejection } from "@gooddealer/protocol/account";

import { IdentityAccountSessionVerifier, type IdentitySessionVerificationReader } from "../modules/identity/session-verifier";
import { assignCorrelationId, correlationIdFor } from "./adapter/correlation";
import {
  rateLimitedRejection,
  sendAccountRejection,
  sendNotFound,
  sendTransportRejection,
} from "./adapter/error-identity";
import {
  InMemoryFixedWindowRateLimiter,
  cookieValue,
  preAuthRateLimitIdentity,
  sessionRateLimitIdentity,
  type RateLimitPolicy,
} from "./adapter/rate-limit";
import { attachOpenApiDocument, buildOpenApiDocument } from "./adapter/schema";
import { registerPublicRoutes, setRoutePrincipal } from "./adapter/surface";
import {
  CloudPublicSessionVerifier,
  PUBLIC_SESSION_COOKIE,
  type PublicSessionVerifierPort,
} from "./ports/public-session";
import {
  publicBoundaryRoutes,
  publicBusinessRoutes,
} from "./routes/public/boundary";

export type PublicApplicationPorts = readonly [];

export interface PublicHttpDependencies {
  readonly sessions: PublicSessionVerifierPort;
  readonly preAuthRateLimit: RateLimitPolicy;
  readonly sessionRateLimit: RateLimitPolicy;
  readonly now: () => Date;
  readonly correlationIds: () => string;
  readonly ports: PublicApplicationPorts;
}

export interface CloudPublicHttpDependencies extends Omit<PublicHttpDependencies, "sessions"> {
  readonly identity: IdentitySessionVerificationReader;
}

export const PUBLIC_BODY_LIMIT_BYTES = 256;
export const PUBLIC_MAX_URL_LENGTH = 2_048;

/** Production composition always resolves the public seam from live identity state. */
export function createCloudPublicHttp(deps: CloudPublicHttpDependencies): FastifyInstance {
  const { identity, ...http } = deps;
  return createPublicHttp({
    ...http,
    sessions: new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier(identity)),
  });
}

export function createPublicHttp(deps: PublicHttpDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: PUBLIC_BODY_LIMIT_BYTES,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const preAuthLimiter = new InMemoryFixedWindowRateLimiter(deps.preAuthRateLimit);
  const sessionLimiter = new InMemoryFixedWindowRateLimiter(deps.sessionRateLimit);
  const routes = [...publicBoundaryRoutes, ...publicBusinessRoutes] as const;

  app.addHook("onRequest", async (request, reply) => {
    assignCorrelationId(request, reply, deps.correlationIds);
  });

  app.addHook("onRequest", async (request, reply) => {
    if ((request.raw.url?.length ?? 0) > PUBLIC_MAX_URL_LENGTH) {
      return sendTransportRejection(request, reply, 413, "PAYLOAD_TOO_LARGE");
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    // A cookie is unverified at this stage and therefore cannot choose a pre-auth bucket.
    const decision = preAuthLimiter.consume(preAuthRateLimitIdentity(request.ip));
    if (!decision.allowed) {
      const rejection: AccountRejection = rateLimitedRejection(
        correlationIdFor(request),
        decision.retryAfterSeconds ?? 1,
      );
      return sendAccountRejection(reply, rejection);
    }
  });

  // Fastify validates immediately after preValidation; preHandler would authenticate too late.
  app.addHook("preValidation", async (request, reply) => {
    const sessionId = cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE);
    const principal = await deps.sessions.verify(sessionId, deps.now());
    if (principal === null) {
      return sendTransportRejection(request, reply, 401, "UNAUTHENTICATED");
    }
    // Only the verified principal may select this layer; the raw cookie remains address-bucketed.
    const decision = sessionLimiter.consume(sessionRateLimitIdentity(principal.sessionId));
    if (!decision.allowed) {
      const rejection: AccountRejection = rateLimitedRejection(
        correlationIdFor(request),
        decision.retryAfterSeconds ?? 1,
      );
      return sendAccountRejection(reply, rejection);
    }
    setRoutePrincipal(request, principal);
  });

  registerPublicRoutes(app, routes);
  attachOpenApiDocument(app, buildOpenApiDocument("GoodDealer Public Boundary", routes));

  app.setNotFoundHandler(async (request, reply) => sendNotFound(request, reply));
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (
      error.validation !== undefined
      || error.code === "FST_ERR_VALIDATION"
      || error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
    ) {
      return sendTransportRejection(request, reply, 400, "SCHEMA_INVALID");
    }
    if (error.statusCode === 413) {
      return sendTransportRejection(request, reply, 413, "PAYLOAD_TOO_LARGE");
    }
    if (error.statusCode === 415) {
      return sendTransportRejection(request, reply, 415, "UNSUPPORTED_MEDIA_TYPE");
    }
    return sendTransportRejection(request, reply, 500, "INTERNAL");
  });

  return app;
}
