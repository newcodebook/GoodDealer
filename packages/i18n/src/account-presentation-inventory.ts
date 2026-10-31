import type { AccountPresentation } from "./account-copy-types";
import type { PresentationCopyInventoryEntry } from "./presentation-inventory";

/**
 * Reconciliation manifest for Account Web copy against `brand/ui_kits/account-web`. Sources are
 * relative to that kit. The kit has no sign-in screen, so access pages are designed from the
 * Desktop sign-in and their wording follows the Identity service's anti-enumeration semantics.
 * License, Devices, and Billing drop kit content the product does not have: License Keys, Sunset
 * continuation, pairing codes, usage meters, and editable billing profiles.
 */
export const accountPresentationCopyInventory = {
  accountShell: { source: "AccountShell.jsx", typedBoundary: "AccountShellProps", localeKeyCount: 17, exactBrandCopyKeys: 10 },
  accountAccess: { source: "../desktop/SignIn.jsx", typedBoundary: "AccountAccessStep", localeKeyCount: 50, exactBrandCopyKeys: 9 },
  accountLicense: { source: "License.jsx", typedBoundary: "LicenseView", localeKeyCount: 96, exactBrandCopyKeys: 13 },
  accountDevices: { source: "Devices.jsx", typedBoundary: "AccountDeviceView", localeKeyCount: 36, exactBrandCopyKeys: 12 },
  accountBilling: { source: "Billing.jsx", typedBoundary: "AccountInvoiceView", localeKeyCount: 33, exactBrandCopyKeys: 10 },
} as const satisfies Record<AccountPresentation, PresentationCopyInventoryEntry>;

export const reconciledAccountPresentationCount = 5 as const;
export const reconciledAccountLocaleKeyCount = 232 as const;
export const reconciledAccountExactBrandCopyKeyCount = 54 as const;
