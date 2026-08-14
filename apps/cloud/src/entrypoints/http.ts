import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import type { AccountRejection } from "@gooddealer/protocol/account";

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
  sessionRateLimitIdentity,
  type RateLimitPolicy,
} from "./adapter/rate-limit";
import { attachOpenApiDocument, buildOpenApiDocument } from "./adapter/schema";
import { registerPublicRoutes, setRoutePrincipal } from "./adapter/surface";
import {
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
  readonly rateLimit: RateLimitPolicy;
  readonly now: () => Date;
  readonly correlationIds: () => string;
  readonly ports: PublicApplicationPorts;
}

export const PUBLIC_BODY_LIMIT_BYTES = 256;
export const PUBLIC_MAX_URL_LENGTH = 2_048;

export function createPublicHttp(deps: PublicHttpDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: PUBLIC_BODY_LIMIT_BYTES,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const limiter = new InMemoryFixedWindowRateLimiter(deps.rateLimit);
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
    const sessionId = cookieValue(request.headers.cookie, PUBLIC_SESSION_COOKIE);
    const decision = limiter.consume(sessionRateLimitIdentity(sessionId, request.ip));
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
