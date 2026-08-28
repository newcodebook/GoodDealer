import {
  getPresentationCopy,
  type DesktopPresentation,
  type Locale,
} from "@gooddealer/i18n";

import { isAppRouteId, parseAppRoute, type AppRoute, type AppRouteId } from "./app-route";
import type { WorkspaceDesktopSurfaceKind } from "./desktop-surface";
import { parseDesktopSurface } from "./desktop-surface";
import { isWorkspaceDesktopSurface } from "./desktop-surface";

export interface AppRouteDefinition {
  readonly id: AppRouteId;
  readonly presentation: DesktopPresentation;
  readonly allowedSurfaceKinds: readonly WorkspaceDesktopSurfaceKind[];
}

const workspaceSurfaceKinds = ["standby", "active"] as const;

export const appRouteRegistry = {
  "portfolio.list": route("portfolio.list", "assetLibrary"),
  "portfolio.detail": route("portfolio.detail", "domainDetail"),
  "dns.health": route("dns.health", "dnsVerification"),
  settings: route("settings", "settings"),
} as const satisfies Readonly<Record<AppRouteId, AppRouteDefinition>>;

function route(id: AppRouteId, presentation: DesktopPresentation): AppRouteDefinition {
  return { id, presentation, allowedSurfaceKinds: workspaceSurfaceKinds };
}

export function getAppRouteLabel(locale: Locale, routeId: AppRouteId): string {
  const definition = appRouteRegistry[routeId];
  const copy = getPresentationCopy(locale, definition.presentation) as { readonly title: string };
  return copy.title;
}

/** Route eligibility is the intersection of an adjudicated surface and wired read capability. */
export function isAppRouteReachable(surfaceInput: unknown, routeId: unknown): boolean {
  const surface = parseDesktopSurface(surfaceInput);
  if (surface === null || !isAppRouteId(routeId)) return false;
  if (!isWorkspaceDesktopSurface(surface)) return false;
  const definition = appRouteRegistry[routeId];
  return (
    definition.allowedSurfaceKinds.includes(surface.kind) &&
    surface.availableRouteIds.includes(routeId) &&
    new Set(surface.availableRouteIds).size === surface.availableRouteIds.length
  );
}

export function resolveAppRoute(
  surfaceInput: unknown,
  requestedRouteInput: unknown,
): AppRoute | null {
  const surface = parseDesktopSurface(surfaceInput);
  if (surface === null) return null;
  if (!isWorkspaceDesktopSurface(surface)) return null;
  const requestedRoute = parseAppRoute(requestedRouteInput);
  if (requestedRoute !== null && isAppRouteReachable(surface, requestedRoute.id)) {
    return requestedRoute;
  }
  if (!isAppRouteReachable(surface, surface.defaultRouteId)) return null;
  return { id: surface.defaultRouteId };
}
