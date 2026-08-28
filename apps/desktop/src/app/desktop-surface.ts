import type { AppRouteId, DefaultAppRouteId } from "./app-route";
import { isAppRouteId } from "./app-route";
import { copyDenseArray, copyPlainRecord, hasExactKeys } from "./presentation-input";

export const desktopSurfaceKinds = [
  "sign_in",
  "locked",
  "device_capacity",
  "standby",
  "activating",
  "active",
  "draining",
  "startup_recovery",
  "local_continuation",
] as const;

export type DesktopSurfaceKind = (typeof desktopSurfaceKinds)[number];
export type WorkspaceDesktopSurfaceKind = "standby" | "active";

interface AdjudicatedDesktopSurface<Kind extends DesktopSurfaceKind> {
  readonly kind: Kind;
  /** The surface may only be created after every authority input required by that surface is validated. */
  readonly authorityEvidence: "complete";
}

export interface WorkspaceDesktopSurface<Kind extends WorkspaceDesktopSurfaceKind = WorkspaceDesktopSurfaceKind>
  extends AdjudicatedDesktopSurface<Kind> {
  readonly availableRouteIds: readonly AppRouteId[];
  readonly defaultRouteId: DefaultAppRouteId;
}

export type DesktopSurface =
  | AdjudicatedDesktopSurface<"sign_in">
  | AdjudicatedDesktopSurface<"locked">
  | AdjudicatedDesktopSurface<"device_capacity">
  | WorkspaceDesktopSurface<"standby">
  | AdjudicatedDesktopSurface<"activating">
  | WorkspaceDesktopSurface<"active">
  | AdjudicatedDesktopSurface<"draining">
  | AdjudicatedDesktopSurface<"startup_recovery">
  // LocalContinuation remains route-free until the separate Sunset authority chain is delivered.
  | AdjudicatedDesktopSurface<"local_continuation">;

const routeFreeSurfaceKinds = desktopSurfaceKinds.filter(
  (kind): kind is Exclude<DesktopSurfaceKind, WorkspaceDesktopSurfaceKind> =>
    kind !== "standby" && kind !== "active",
);

export function parseDesktopSurface(value: unknown): DesktopSurface | null {
  const record = copyPlainRecord(value);
  if (record === null || record["authorityEvidence"] !== "complete") return null;
  const kind = record["kind"];

  if (kind === "standby" || kind === "active") {
    if (!hasExactKeys(record, ["kind", "authorityEvidence", "availableRouteIds", "defaultRouteId"])) {
      return null;
    }
    const availableRouteIds = copyDenseArray(record["availableRouteIds"]);
    const defaultRouteId = record["defaultRouteId"];
    if (
      availableRouteIds === null ||
      availableRouteIds.length === 0 ||
      !availableRouteIds.every(isAppRouteId) ||
      new Set(availableRouteIds).size !== availableRouteIds.length ||
      (defaultRouteId !== "portfolio.list" && defaultRouteId !== "dns.health" && defaultRouteId !== "settings") ||
      !availableRouteIds.includes(defaultRouteId)
    ) {
      return null;
    }
    return Object.freeze({
      kind,
      authorityEvidence: "complete",
      availableRouteIds: availableRouteIds as readonly AppRouteId[],
      defaultRouteId,
    });
  }

  if (
    typeof kind === "string" &&
    routeFreeSurfaceKinds.includes(kind as (typeof routeFreeSurfaceKinds)[number]) &&
    hasExactKeys(record, ["kind", "authorityEvidence"])
  ) {
    return Object.freeze({ kind, authorityEvidence: "complete" }) as DesktopSurface;
  }
  return null;
}

export function isDesktopSurface(value: unknown): value is DesktopSurface {
  return parseDesktopSurface(value) !== null;
}

export function isWorkspaceDesktopSurface(
  surface: DesktopSurface,
): surface is WorkspaceDesktopSurface {
  return surface.kind === "standby" || surface.kind === "active";
}
