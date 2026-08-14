import Fastify, { type FastifyError } from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  accountRejectionSchema,
  type AccountRejection,
} from "@gooddealer/protocol/account";
import {
  publicBoundaryIdentityResponseSchema,
  type PublicBoundaryIdentityResponse,
} from "@gooddealer/protocol/wire";

import { assignCorrelationId } from "../../src/entrypoints/adapter/correlation";
import { sendTransportRejection } from "../../src/entrypoints/adapter/error-identity";
import { zodToJsonSchema } from "../../src/entrypoints/adapter/schema";
import {
  PUBLIC_SURFACE,
  registerPublicRoutes,
  setRoutePrincipal,
  type PublicSurface,
  type RouteAdapter,
} from "../../src/entrypoints/adapter/surface";

interface TestPrincipal {
  readonly fixture: true;
}

describe("the built-in Zod JSON Schema adapter", () => {
  it("targets draft-07, which Fastify 5's default AJV accepts", () => {
    expect(zodToJsonSchema(accountRejectionSchema).$schema).toBe(
      "http://json-schema.org/draft-07/schema#",
    );
  });

  it("re-parses after AJV so superRefine-only constraints cannot reach invoke", async () => {
    const invoke = vi.fn(async (): Promise<PublicBoundaryIdentityResponse> => ({
      surface: "public",
      authenticated: true,
    }));
    const route: RouteAdapter<
      PublicSurface,
      TestPrincipal,
      AccountRejection,
      PublicBoundaryIdentityResponse
    > = {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: "/test/super-refine",
      request: accountRejectionSchema,
      response: publicBoundaryIdentityResponseSchema,
      requiredScope: null,
      authorize: () => true,
      invoke,
    };
    const app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    app.addHook("onRequest", async (request, reply) => {
      assignCorrelationId(request, reply, () => "schema-adapter-correlation");
    });
    app.addHook("preValidation", async (request) => {
      setRoutePrincipal<TestPrincipal>(request, { fixture: true });
    });
    registerPublicRoutes(app, [route]);
    app.setErrorHandler(async (error: FastifyError, request, reply) => {
      if (error.validation !== undefined) {
        return sendTransportRejection(request, reply, 400, "SCHEMA_INVALID");
      }
      return sendTransportRejection(request, reply, 500, "INTERNAL");
    });

    const response = await app.inject({
      method: "POST",
      url: "/test/super-refine",
      payload: {
        schemaVersion: 1,
        code: "DEVICE_REMOVED",
        retryable: true,
        retryAfterSeconds: null,
        correlationId: "domain-correlation",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "SCHEMA_INVALID",
      correlationId: "schema-adapter-correlation",
    });
    expect(invoke).not.toHaveBeenCalled();
    await app.close();
  });
});
