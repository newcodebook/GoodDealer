import type { FastifyInstance, FastifyRequest } from "fastify";

import { accountRejectionSchema, type AccountRejection } from "@gooddealer/protocol/account";

import {
  sendAccountRejection,
  sendNotFound,
  sendTransportRejection,
} from "./error-identity";
import { zodToJsonSchema } from "./schema";

const surfaceBrand: unique symbol = Symbol("GoodDealerHttpSurface");

export type PublicSurface = { readonly [surfaceBrand]: "public" };
export type AdminSurface = { readonly [surfaceBrand]: "admin" };
export type Surface = PublicSurface | AdminSurface;

export const PUBLIC_SURFACE: PublicSurface = Object.freeze({ [surfaceBrand]: "public" });
export const ADMIN_SURFACE: AdminSurface = Object.freeze({ [surfaceBrand]: "admin" });

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteSchema<T> {
  safeParse(input: unknown):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: unknown };
  toJSONSchema(options: { readonly target: "draft-7" }): unknown;
}

export interface RouteAdapter<S extends Surface, TAuth, TIn, TOut> {
  readonly surface: S;
  readonly method: RouteMethod;
  readonly path: string;
  readonly request: RouteSchema<TIn>;
  readonly response: RouteSchema<TOut>;
  readonly requiredScope: string | null;
  readonly authorize: (principal: TAuth) => boolean;
  readonly invoke: (input: TIn, principal: TAuth) => Promise<TOut | AccountRejection>;
}

export interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
}

const principals = new WeakMap<FastifyRequest, unknown>();
const registeredRoutes = new WeakMap<FastifyInstance, RegisteredRoute[]>();
const requiredScopes = new WeakMap<FastifyInstance, Map<string, string | null>>();

export function setRoutePrincipal<TAuth>(request: FastifyRequest, principal: TAuth): void {
  principals.set(request, principal);
}

export function routePrincipal<TAuth>(request: FastifyRequest): TAuth | null {
  return (principals.get(request) as TAuth | undefined) ?? null;
}

export function registeredRoutesFor(app: FastifyInstance): readonly RegisteredRoute[] {
  return registeredRoutes.get(app)?.map((route) => ({ ...route })) ?? [];
}

export function requiredScopeFor(
  app: FastifyInstance,
  method: string,
  rawUrl: string,
): string | null | undefined {
  const scopes = requiredScopes.get(app);
  if (scopes === undefined) {
    return undefined;
  }

  const path = rawUrl.split("?", 1)[0] ?? rawUrl;
  const exactKey = routeKey(method, path);
  if (scopes.has(exactKey)) {
    return scopes.get(exactKey);
  }

  const matched = app.findRoute({ method, url: path });
  if (matched === null) {
    return undefined;
  }
  const route = registeredRoutes.get(app)?.find((registered) =>
    registered.method === method.toUpperCase()
      && registeredPatternMatches(registered.path, path, matched.params)
  );
  return route === undefined ? undefined : scopes.get(routeKey(method, route.path));
}

export function registerPublicRoutes<TAuth>(
  app: FastifyInstance,
  routes: readonly RouteAdapter<PublicSurface, TAuth, any, any>[],
): void {
  registerRoutes(app, routes, "public");
}

export function registerAdminRoutes<TAuth>(
  app: FastifyInstance,
  routes: readonly RouteAdapter<AdminSurface, TAuth, any, any>[],
): void {
  registerRoutes(app, routes, "admin");
}

function registerRoutes<S extends Surface, TAuth>(
  app: FastifyInstance,
  routes: readonly RouteAdapter<S, TAuth, any, any>[],
  surface: "public" | "admin",
): void {
  const registry = registeredRoutes.get(app) ?? [];
  const scopes = requiredScopes.get(app) ?? new Map<string, string | null>();

  for (const route of routes) {
    registry.push({ method: route.method, path: route.path });
    scopes.set(routeKey(route.method, route.path), route.requiredScope);

    const inputSchema = zodToJsonSchema(route.request);
    const properties = inputSchema.properties;
    const hasInputFields = properties !== null
      && typeof properties === "object"
      && Object.keys(properties).length > 0;
    app.route({
      method: route.method,
      url: route.path,
      schema: {
        ...(route.method === "GET"
          ? { querystring: inputSchema }
          : hasInputFields
            ? { body: inputSchema }
            : {}),
        response: { 200: zodToJsonSchema(route.response) },
      },
      handler: async (request, reply) => {
        const input = route.request.safeParse(
          route.method === "GET" ? request.query : (request.body ?? {}),
        );
        if (!input.success) {
          return sendTransportRejection(request, reply, 400, "SCHEMA_INVALID");
        }

        const principal = routePrincipal<TAuth>(request);
        if (principal === null) {
          return surface === "public"
            ? sendTransportRejection(request, reply, 401, "UNAUTHENTICATED")
            : sendNotFound(request, reply);
        }
        if (!route.authorize(principal)) {
          return sendNotFound(request, reply);
        }

        // Fastify's JSON Schema cannot express Zod superRefine; invoke only receives re-parsed data.
        const output = await route.invoke(input.data, principal);
        const rejection = accountRejectionSchema.safeParse(output);
        if (rejection.success) {
          return sendAccountRejection(reply, rejection.data);
        }

        const response = route.response.safeParse(output);
        if (!response.success) {
          throw new Error("application port returned an invalid route response");
        }
        return response.data;
      },
    });
  }

  registeredRoutes.set(app, registry);
  requiredScopes.set(app, scopes);
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function registeredPatternMatches(
  registeredPath: string,
  actualPath: string,
  params: Readonly<Record<string, string | undefined>>,
): boolean {
  const registeredSegments = registeredPath.split("/");
  const actualSegments = actualPath.split("/");
  if (registeredSegments.length !== actualSegments.length) {
    return false;
  }

  return registeredSegments.every((segment, index) => {
    if (segment === actualSegments[index]) {
      return true;
    }
    const parameterName = /^:([^?(.:]+)(?:[?(.:].*)?$/.exec(segment)?.[1];
    return parameterName !== undefined
      && Object.prototype.hasOwnProperty.call(params, parameterName);
  });
}
