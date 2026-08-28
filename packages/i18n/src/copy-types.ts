export const supportedLocales = ["zh-CN", "en-US"] as const;

export type Locale = (typeof supportedLocales)[number];

export const desktopPresentations = [
  "shell",
  "assetLibrary",
  "batchOperation",
  "conflictCenter",
  "manualTaskInbox",
  "settings",
  "operationHistory",
  "salesDesk",
  "activation",
  "dnsVerification",
  "renewalDesk",
  "domainDetail",
  "signIn",
] as const;

export type DesktopPresentation = (typeof desktopPresentations)[number];

export const capabilityNamespaces = [
  "runtimeMode",
  "recovery",
  "browserAutomation",
  "portfolio",
  "operations",
] as const;

export type CapabilityNamespace = (typeof capabilityNamespaces)[number];

/** Preserve dictionary structure while widening source-locale string literals. */
export type LocalizedCopy<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: LocalizedCopy<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: LocalizedCopy<T[K]> }
      : never;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && supportedLocales.includes(value as Locale);
}

export function parseLocale(value: unknown): Locale {
  if (!isLocale(value)) {
    throw new RangeError("Unsupported locale");
  }
  return value;
}

export function isDesktopPresentation(value: unknown): value is DesktopPresentation {
  return (
    typeof value === "string" &&
    desktopPresentations.includes(value as DesktopPresentation)
  );
}

export function parseDesktopPresentation(value: unknown): DesktopPresentation {
  if (!isDesktopPresentation(value)) {
    throw new RangeError("Unknown desktop presentation");
  }
  return value;
}

export function isCapabilityNamespace(value: unknown): value is CapabilityNamespace {
  return (
    typeof value === "string" &&
    capabilityNamespaces.includes(value as CapabilityNamespace)
  );
}

export function parseCapabilityNamespace(value: unknown): CapabilityNamespace {
  if (!isCapabilityNamespace(value)) {
    throw new RangeError("Unknown capability namespace");
  }
  return value;
}
