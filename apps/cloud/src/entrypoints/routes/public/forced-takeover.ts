import {
  forcedTakeoverPreviewRequestSchema, forcedTakeoverPreviewResponseSchema,
  forcedTakeoverStatusRequestSchema, forcedTakeoverStatusResponseSchema,
  forcedTakeoverResolveRequestSchema, forcedTakeoverResolveResponseSchema,
  forcedTakeoverCancelIntentRequestSchema, forcedTakeoverCancelIntentResponseSchema,
} from "@gooddealer/protocol/devices";
import type { DesktopRouteAuthorityPort } from "../../../modules/devices/index";
import { PUBLIC_SURFACE, type PublicSurface, type RouteAdapter } from "../../adapter/surface";
import { PublicRouteAuthorizationError } from "../../adapter/error-identity";
import type { ForcedTakeoverQueryPort } from "../../ports/forced-takeover";
import type { PublicPrincipal } from "../../ports/public-session";

export const FORCED_TAKEOVER_PREVIEW_ROUTE = "/v1/device-switch/forced/preview" as const;
export const FORCED_TAKEOVER_STATUS_ROUTE = "/v1/device-switch/forced/status" as const;
export const FORCED_TAKEOVER_RESOLVE_ROUTE = "/v1/device-switch/forced/resolve" as const;
export const FORCED_TAKEOVER_CANCEL_INTENT_ROUTE = "/v1/device-switch/forced/cancel-intent" as const;

export function createForcedTakeoverRoutes(
  takeover: ForcedTakeoverQueryPort | undefined,
  authority: DesktopRouteAuthorityPort,
): readonly RouteAdapter<PublicSurface, PublicPrincipal, any, any>[] {
  if (takeover === undefined) return [];
  const routes = [
    { path: FORCED_TAKEOVER_PREVIEW_ROUTE, request: forcedTakeoverPreviewRequestSchema,
      response: forcedTakeoverPreviewResponseSchema, method: "preview" },
    { path: FORCED_TAKEOVER_STATUS_ROUTE, request: forcedTakeoverStatusRequestSchema,
      response: forcedTakeoverStatusResponseSchema, method: "status" },
    { path: FORCED_TAKEOVER_RESOLVE_ROUTE, request: forcedTakeoverResolveRequestSchema,
      response: forcedTakeoverResolveResponseSchema, method: "resolve" },
    { path: FORCED_TAKEOVER_CANCEL_INTENT_ROUTE, request: forcedTakeoverCancelIntentRequestSchema,
      response: forcedTakeoverCancelIntentResponseSchema, method: "cancelIntent" },
  ] as const;
  return routes.map((route) => ({
    surface: PUBLIC_SURFACE, method: "POST", path: route.path,
    request: route.request, response: route.response, requiredScope: null, deviceRole: "active_or_standby",
    authorizeDeviceRole: (principal, role) => authority.authorize(principal, role),
    authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
    invoke: async (value: unknown, principal: PublicPrincipal) => {
      const result = await takeover[route.method](value, principal);
      if (result === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > 16_384) {
        throw new Error("forced takeover response exceeds its transport bound");
      }
      return result;
    },
    bodyLimit: 2_048,
  }));
}
