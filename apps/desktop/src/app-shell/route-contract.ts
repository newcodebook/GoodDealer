import { getPresentationCopy, type Locale } from "@gooddealer/i18n";

export const shellRouteIds = [
  "portfolio.list",
  "portfolio.detail",
  "dns.health",
  "settings",
] as const;

export type ShellRouteId = (typeof shellRouteIds)[number];
export type ShellNavigationRouteId = Exclude<ShellRouteId, "portfolio.detail">;
export type ShellRouteIcon = "globe" | "shield" | "settings";

export interface ShellRouteDefinition {
  readonly id: ShellNavigationRouteId;
  readonly label: string;
  readonly icon: ShellRouteIcon;
}

export function isShellRouteId(value: unknown): value is ShellRouteId {
  return typeof value === "string" && shellRouteIds.includes(value as ShellRouteId);
}

export function isShellNavigationRouteId(value: unknown): value is ShellNavigationRouteId {
  return isShellRouteId(value) && value !== "portfolio.detail";
}

export function createDefaultShellRoutes(
  locale: Locale,
  eligibleRouteIds: readonly ShellRouteId[],
): readonly ShellRouteDefinition[] {
  const shellCopy = getPresentationCopy(locale, "shell");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");
  const settingsCopy = getPresentationCopy(locale, "settings");
  const eligible = new Set(eligibleRouteIds);

  const routes = [
    { id: "portfolio.list", label: shellCopy.assetLibrary, icon: "globe" },
    { id: "dns.health", label: assetCopy.dnsRecords, icon: "shield" },
    { id: "settings", label: settingsCopy.connections, icon: "settings" },
  ] as const satisfies readonly ShellRouteDefinition[];

  return routes.filter((route) => eligible.has(route.id));
}

/**
 * Navigation events originate from a string-keyed UI primitive. Re-check both the closed route
 * vocabulary and current eligibility so stale or fabricated keys cannot escape the shell.
 */
export function selectEligibleShellRoute(
  routeId: unknown,
  eligibleRouteIds: readonly ShellRouteId[],
  onSelect: ((routeId: ShellNavigationRouteId) => void) | undefined,
): boolean {
  if (!isShellNavigationRouteId(routeId) || onSelect === undefined) return false;
  if (!eligibleRouteIds.includes(routeId)) return false;
  onSelect(routeId);
  return true;
}
