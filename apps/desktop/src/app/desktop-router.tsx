import type { ReactNode } from "react";

import { parseAppRoute, type AppRoute, type AppRouteId } from "./app-route";
import type { DesktopSurface, DesktopSurfaceKind, WorkspaceDesktopSurface } from "./desktop-surface";
import { isWorkspaceDesktopSurface, parseDesktopSurface } from "./desktop-surface";
import { resolveAppRoute } from "./route-registry";

export type AppRouteRenderer = (
  route: AppRoute,
  surface: WorkspaceDesktopSurface,
) => ReactNode;

export type DesktopSurfaceRenderer = (surface: DesktopSurface) => ReactNode;

export interface DesktopRouterProps {
  readonly surface: unknown;
  readonly requestedRoute: unknown;
  readonly routeRenderers?: Readonly<Partial<Record<AppRouteId, AppRouteRenderer>>>;
  readonly surfaceRenderers?: Readonly<Partial<Record<DesktopSurfaceKind, DesktopSurfaceRenderer>>>;
  readonly renderUnavailable: () => ReactNode;
}

/**
 * The router selects only already-admitted renderers. It never constructs view models, supplies
 * actions, or treats a missing renderer as evidence that a route is available.
 */
export function DesktopRouter({
  surface,
  requestedRoute,
  routeRenderers = {},
  surfaceRenderers = {},
  renderUnavailable,
}: DesktopRouterProps) {
  const parsedSurface = parseDesktopSurface(surface);
  if (parsedSurface === null) return <>{renderUnavailable()}</>;

  if (isWorkspaceDesktopSurface(parsedSurface)) {
    const route = resolveAppRoute(parsedSurface, parseAppRoute(requestedRoute));
    const renderer = route === null ? undefined : routeRenderers[route.id];
    return <>{route !== null && renderer !== undefined ? renderer(route, parsedSurface) : renderUnavailable()}</>;
  }

  const renderer = surfaceRenderers[parsedSurface.kind];
  return <>{renderer === undefined ? renderUnavailable() : renderer(parsedSurface)}</>;
}
