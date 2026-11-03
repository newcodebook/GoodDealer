/**
 * Every Account Web page. There is no Overview: everything it would show repeats License and
 * Devices, so signing in lands on License (the first route) until Cloud offers more to summarize.
 */
export const accountRouteIds = [
  "license",
  "devices",
  "billing",
  "security",
  "cloudData",
  "settings",
  "download",
] as const;

export type AccountRouteId = (typeof accountRouteIds)[number];

/**
 * Routes production may compose: only pages backed by a Cloud contract today. Devices and Billing
 * are designed ahead of their Account Web routes and join this list only once those routes exist.
 */
export const productionAccountRouteIds = ["license"] as const satisfies readonly AccountRouteId[];

export function isAccountRouteId(value: unknown): value is AccountRouteId {
  return typeof value === "string" && (accountRouteIds as readonly string[]).includes(value);
}
