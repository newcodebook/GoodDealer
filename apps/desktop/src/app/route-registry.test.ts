import { describe, expect, it } from "vitest";

import { appRouteIds, type AppRoute } from "./app-route";
import {
  desktopSurfaceKinds,
  parseDesktopSurface,
  isWorkspaceDesktopSurface,
  type DesktopSurface,
  type WorkspaceDesktopSurface,
} from "./desktop-surface";
import {
  appRouteRegistry,
  getAppRouteLabel,
  isAppRouteReachable,
  resolveAppRoute,
} from "./route-registry";

describe("desktop route registry", () => {
  it("exhaustively registers every AppRoute", () => {
    expect(Object.keys(appRouteRegistry)).toEqual(appRouteIds);
    expect(new Set(Object.values(appRouteRegistry).map((route) => route.presentation)).size).toBe(
      appRouteIds.length,
    );
    for (const routeId of appRouteIds) {
      expect(getAppRouteLabel("zh-CN", routeId).length).toBeGreaterThan(0);
      expect(getAppRouteLabel("en-US", routeId).length).toBeGreaterThan(0);
    }
  });

  it("keeps every non-workspace surface route-free", () => {
    const nonWorkspaceKinds = desktopSurfaceKinds.filter(
      (kind) => kind !== "standby" && kind !== "active",
    );
    for (const kind of nonWorkspaceKinds) {
      const surface = { kind, authorityEvidence: "complete" } as DesktopSurface;
      for (const routeId of appRouteIds) {
        expect(isAppRouteReachable(surface, routeId), `${kind} -> ${routeId}`).toBe(false);
      }
      expect(resolveAppRoute(surface, { id: "portfolio.list" })).toBeNull();
    }
  });

  it("intersects surface eligibility with uniquely wired route capabilities", () => {
    const surface: WorkspaceDesktopSurface<"active"> = {
      kind: "active",
      authorityEvidence: "complete",
      availableRouteIds: ["portfolio.list", "portfolio.detail", "settings"],
      defaultRouteId: "portfolio.list",
    };
    const detail: AppRoute = { id: "portfolio.detail", domainId: "domain-1" };

    expect(resolveAppRoute(surface, detail)).toEqual(detail);
    expect(resolveAppRoute(surface, { id: "dns.health" })).toEqual({
      id: "portfolio.list",
    });
    expect(isAppRouteReachable(surface, "dns.health")).toBe(false);
    expect(
      isAppRouteReachable(
        { ...surface, availableRouteIds: ["portfolio.list", "portfolio.list"] },
        "portfolio.list",
      ),
    ).toBe(false);
  });

  it("covers every workspace surface and AppRoute combination", () => {
    const workspaceKinds = ["standby", "active"] as const;
    for (const kind of workspaceKinds) {
      const fullyWiredSurface: WorkspaceDesktopSurface = {
        kind,
        authorityEvidence: "complete",
        availableRouteIds: appRouteIds,
        defaultRouteId: "portfolio.list",
      };
      const unwiredSurface: WorkspaceDesktopSurface = {
        ...fullyWiredSurface,
        availableRouteIds: [],
      };
      for (const routeId of appRouteIds) {
        expect(isAppRouteReachable(fullyWiredSurface, routeId), `${kind} -> ${routeId}`).toBe(true);
        expect(isAppRouteReachable(unwiredSurface, routeId), `${kind} -X-> ${routeId}`).toBe(false);
      }
    }
  });

  it("rejects every business route for LocalContinuation even if route capabilities are injected", () => {
    const localContinuationSurface = {
      kind: "local_continuation",
      authorityEvidence: "complete",
      availableRouteIds: appRouteIds,
      defaultRouteId: "portfolio.list",
    } as const as DesktopSurface;

    expect(isWorkspaceDesktopSurface(localContinuationSurface)).toBe(false);
    for (const routeId of appRouteIds) {
      const requestedRoute: AppRoute =
        routeId === "portfolio.detail"
          ? { id: routeId, domainId: "domain-1" }
          : { id: routeId };
      expect(
        isAppRouteReachable(localContinuationSurface, routeId),
        `local_continuation -X-> ${routeId}`,
      ).toBe(false);
      expect(resolveAppRoute(localContinuationSurface, requestedRoute)).toBeNull();
    }
  });

  it("fails closed for an unknown surface kind", () => {
    const unknownSurface = {
      kind: "future_surface",
      authorityEvidence: "complete",
    } as unknown as DesktopSurface;

    expect(isWorkspaceDesktopSurface(unknownSurface)).toBe(false);
    for (const routeId of appRouteIds) {
      expect(isAppRouteReachable(unknownSurface, routeId)).toBe(false);
    }
    expect(resolveAppRoute(unknownSurface, { id: "portfolio.list" })).toBeNull();
  });

  it("rejects active/complete evidence when no default route capability is admitted", () => {
    expect(parseDesktopSurface({
      kind: "active",
      authorityEvidence: "complete",
      availableRouteIds: [],
      defaultRouteId: "portfolio.list",
    })).toBeNull();
  });

});
