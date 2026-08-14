import type { FastifyInstance } from "fastify";

import type { RegisteredRoute, RouteAdapter, RouteSchema, Surface } from "./surface";

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface OpenApiDocument {
  readonly openapi: "3.0.3";
  readonly info: {
    readonly title: string;
    readonly version: "1";
  };
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const openApiDocuments = new WeakMap<FastifyInstance, OpenApiDocument>();

/** Zod 4 defaults to draft 2020-12, while Fastify 5's default AJV compiler uses draft-07. */
export function zodToJsonSchema<T>(schema: RouteSchema<T>): JsonSchema {
  return schema.toJSONSchema({ target: "draft-7" }) as JsonSchema;
}

export function buildOpenApiDocument<S extends Surface>(
  title: string,
  routes: readonly RouteAdapter<S, any, any, any>[],
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const requestSchema = zodToJsonSchema(route.request);
    const responseSchema = zodToJsonSchema(route.response);
    const operation: Record<string, unknown> = {
      responses: {
        200: {
          description: "Boundary response",
          content: { "application/json": { schema: responseSchema } },
        },
      },
    };

    if (route.method === "GET") {
      operation.parameters = [];
    } else {
      const properties = requestSchema.properties;
      const hasInputFields = properties !== null
        && typeof properties === "object"
        && Object.keys(properties).length > 0;
      if (hasInputFields) {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: requestSchema } },
        };
      }
    }

    const path = paths[route.path] ?? {};
    path[route.method.toLowerCase()] = operation;
    paths[route.path] = path;
  }

  return {
    openapi: "3.0.3",
    info: { title, version: "1" },
    paths,
  };
}

export function attachOpenApiDocument(app: FastifyInstance, document: OpenApiDocument): void {
  openApiDocuments.set(app, document);
}

export function openApiDocumentFor(app: FastifyInstance): OpenApiDocument {
  const document = openApiDocuments.get(app);
  if (document === undefined) {
    throw new Error("OpenAPI document was not attached to this composition root");
  }
  return document;
}

export function openApiRouteSet(document: OpenApiDocument): readonly RegisteredRoute[] {
  return Object.entries(document.paths).flatMap(([path, operations]) =>
    Object.keys(operations).map((method) => ({ method: method.toUpperCase(), path })),
  );
}
