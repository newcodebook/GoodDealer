import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from "fastify";

import { assignCorrelationId, correlationIdFor } from "./adapter/correlation";
import {
  sendNotFound,
  sendTransportRejection,
} from "./adapter/error-identity";
import {
  InMemoryFixedWindowRateLimiter,
  adminRateLimitIdentity,
  cookieValue,
  type RateLimitPolicy,
} from "./adapter/rate-limit";
import { attachOpenApiDocument, buildOpenApiDocument } from "./adapter/schema";
import {
  registerAdminRoutes,
  requiredScopeFor,
  routePrincipal,
  setRoutePrincipal,
} from "./adapter/surface";
import type {
  AdminBoundaryAuditReason,
  AuditSinkPort,
} from "./ports/audit-sink";
import {
  STAFF_SESSION_COOKIE,
  type StaffPrincipal,
  type StaffSessionVerifierPort,
} from "./ports/staff-session";
import {
  adminBoundaryRoutes,
  adminBusinessRoutes,
} from "./routes/admin/boundary";

export interface AdminHttpDependencies {
  readonly staffSessions: StaffSessionVerifierPort;
  readonly audit: AuditSinkPort;
  readonly rateLimit: RateLimitPolicy;
  readonly now: () => Date;
  readonly correlationIds: () => string;
}

export const ADMIN_BODY_LIMIT_BYTES = 256;
export const ADMIN_MAX_URL_LENGTH = 2_048;

export function createAdminHttp(deps: AdminHttpDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: ADMIN_BODY_LIMIT_BYTES,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const limiter = new InMemoryFixedWindowRateLimiter(deps.rateLimit);
  const routes = [...adminBoundaryRoutes, ...adminBusinessRoutes] as const;
  const auditRecorded = new WeakSet<FastifyRequest>();
  const authorizedRequests = new WeakSet<FastifyRequest>();

  async function recordDenial(request: FastifyRequest, reason: AdminBoundaryAuditReason): Promise<void> {
    if (auditRecorded.has(request)) {
      return;
    }
    auditRecorded.add(request);
    await deps.audit.record({
      correlationId: correlationIdFor(request),
      outcome: "denial",
      reason,
      method: request.method,
      path: request.url,
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    assignCorrelationId(request, reply, deps.correlationIds);
  });

  app.addHook("onRequest", async (request, reply) => {
    if ((request.raw.url?.length ?? 0) > ADMIN_MAX_URL_LENGTH) {
      await recordDenial(request, "payload_too_large");
      return sendNotFound(request, reply);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const decision = limiter.consume(adminRateLimitIdentity(request.ip));
    if (!decision.allowed) {
      await recordDenial(request, "rate_limited");
      return sendNotFound(request, reply);
    }
  });

  // This lifecycle stage is the last Fastify hook before JSON Schema validation.
  app.addHook("preValidation", async (request, reply) => {
    const sessionId = cookieValue(request.headers.cookie, STAFF_SESSION_COOKIE);
    const principal = await deps.staffSessions.verify(sessionId, deps.now());
    if (principal === null) {
      await recordDenial(request, "authentication_failed");
      return sendNotFound(request, reply);
    }
    setRoutePrincipal(request, principal);

    const requiredScope = requiredScopeFor(app, request.method, request.url);
    if (requiredScope !== undefined) {
      if (requiredScope !== null && !principal.scopes.has(requiredScope)) {
        await recordDenial(request, "insufficient_scope");
        return sendNotFound(request, reply);
      }
      authorizedRequests.add(request);
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (reply.statusCode < 400 && authorizedRequests.has(request) && !auditRecorded.has(request)) {
      const principal = routePrincipal<StaffPrincipal>(request);
      if (principal !== null) {
        auditRecorded.add(request);
        await deps.audit.record({
          correlationId: correlationIdFor(request),
          outcome: "access",
          reason: "authenticated_access",
          method: request.method,
          path: request.url,
        });
      }
    }
    return payload;
  });

  registerAdminRoutes(app, routes);
  attachOpenApiDocument(app, buildOpenApiDocument("GoodDealer Admin Boundary", routes));

  app.setNotFoundHandler(async (request, reply) => {
    await recordDenial(request, "not_found");
    return sendNotFound(request, reply);
  });
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (!authorizedRequests.has(request)) {
      const reason = error.statusCode === 413
        ? "payload_too_large"
        : error.statusCode === 415
          ? "unsupported_media_type"
          : "unexpected_error";
      await recordDenial(request, reason);
      return sendNotFound(request, reply);
    }
    if (error.validation !== undefined || error.code === "FST_ERR_VALIDATION") {
      return sendTransportRejection(request, reply, 400, "SCHEMA_INVALID");
    }
    return sendTransportRejection(request, reply, 500, "INTERNAL");
  });

  return app;
}
