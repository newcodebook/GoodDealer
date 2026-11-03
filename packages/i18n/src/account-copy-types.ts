/**
 * Account Web presentations. They are a separate family from the Desktop presentations: Account
 * Web is a browser trust domain with its own brand kit (`brand/ui_kits/account-web`).
 */
export const accountPresentations = ["accountShell", "accountAccess", "accountLicense", "accountDevices", "accountBilling"] as const;

export type AccountPresentation = (typeof accountPresentations)[number];

export function isAccountPresentation(value: unknown): value is AccountPresentation {
  return typeof value === "string" && (accountPresentations as readonly string[]).includes(value);
}

export function parseAccountPresentation(value: unknown): AccountPresentation {
  if (!isAccountPresentation(value)) throw new TypeError("Unsupported account presentation");
  return value;
}
