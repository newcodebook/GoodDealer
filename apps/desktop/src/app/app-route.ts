import { copyPlainRecord, hasExactKeys } from "./presentation-input";

export const appRouteIds = [
  "portfolio.list",
  "portfolio.detail",
  "dns.health",
  "settings",
] as const;

export type AppRouteId = (typeof appRouteIds)[number];
export type DefaultAppRouteId = Exclude<AppRouteId, "portfolio.detail">;

export type AppRoute =
  | { readonly id: "portfolio.detail"; readonly domainId: string }
  | { readonly id: Exclude<AppRouteId, "portfolio.detail"> };

export function isAppRouteId(value: unknown): value is AppRouteId {
  return typeof value === "string" && appRouteIds.includes(value as AppRouteId);
}

export function isAppRoute(value: unknown): value is AppRoute {
  return parseAppRoute(value) !== null;
}

export function parseAppRoute(value: unknown): AppRoute | null {
  const record = copyPlainRecord(value);
  if (record === null) return null;
  if (!isAppRouteId(record["id"])) return null;

  if (record["id"] === "portfolio.detail") {
    const domainId = record["domainId"];
    if (
      !hasExactKeys(record, ["id", "domainId"]) ||
      typeof domainId !== "string" ||
      domainId.length === 0 ||
      domainId.length > 128 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(domainId)
    ) {
      return null;
    }
    return Object.freeze({ id: "portfolio.detail", domainId });
  }

  return hasExactKeys(record, ["id"]) ? Object.freeze({ id: record["id"] }) : null;
}

export function createAppRoute(id: DefaultAppRouteId): AppRoute {
  return { id };
}
