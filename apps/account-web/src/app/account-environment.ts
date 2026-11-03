import type { AccountCopy } from "@gooddealer/i18n";

export const accountWebEnvironments = ["development", "staging", "production"] as const;

export type AccountWebEnvironment = (typeof accountWebEnvironments)[number];

/**
 * The deployment a build targets, fixed at build time from `GOODDEALER_ACCOUNT_WEB_ENVIRONMENT`.
 * Anything else fails the build and, defensively, the page start: an unknown target must never
 * render as production.
 */
export function parseAccountWebEnvironment(value: unknown): AccountWebEnvironment {
  if (typeof value !== "string" || !(accountWebEnvironments as readonly string[]).includes(value)) {
    throw new TypeError("GOODDEALER_ACCOUNT_WEB_ENVIRONMENT is invalid");
  }
  return value as AccountWebEnvironment;
}

/** Production shows no label; the others name themselves so test payments read as test payments. */
export function environmentLabelKey(environment: AccountWebEnvironment): keyof AccountCopy["accountShell"] | null {
  switch (environment) {
    case "development": return "environmentDevelopment";
    case "staging": return "environmentStaging";
    case "production": return null;
  }
}
