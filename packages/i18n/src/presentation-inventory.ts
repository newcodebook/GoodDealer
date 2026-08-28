import type { DesktopPresentation } from "./copy-types";

export interface PresentationCopyInventoryEntry {
  readonly source: string;
  readonly typedBoundary: string;
  readonly localeKeyCount: number;
  readonly exactBrandCopyKeys: number;
  readonly exactEnUSBrandCopyKeys?: number;
}

/**
 * Reconciliation manifest for the latest 13-presentation desktop contract.
 * Counts exclude sample domains/accounts/amounts/timestamps. Values that differ
 * from the brand are explicit docs-authoritative states or security corrections.
 */
export const presentationCopyInventory = {
  shell: { source: "Shell.jsx", typedBoundary: "DesktopShellViewModel", localeKeyCount: 57, exactBrandCopyKeys: 22 },
  assetLibrary: { source: "AssetLibrary.jsx", typedBoundary: "AssetLibraryViewModel", localeKeyCount: 33, exactBrandCopyKeys: 33 },
  batchOperation: { source: "BatchPreview.jsx", typedBoundary: "BatchOperationViewModel", localeKeyCount: 54, exactBrandCopyKeys: 54 },
  conflictCenter: { source: "ConflictCenter.jsx", typedBoundary: "ConflictCenterViewModel", localeKeyCount: 18, exactBrandCopyKeys: 18 },
  manualTaskInbox: { source: "TaskInbox.jsx", typedBoundary: "ManualTaskInboxViewModel", localeKeyCount: 32, exactBrandCopyKeys: 32 },
  settings: { source: "SettingsPanel.jsx", typedBoundary: "ComposedSettingsViewModel", localeKeyCount: 48, exactBrandCopyKeys: 33 },
  operationHistory: { source: "HistoryLog.jsx", typedBoundary: "OperationHistoryViewModel", localeKeyCount: 28, exactBrandCopyKeys: 28 },
  salesDesk: { source: "SalesDesk.jsx", typedBoundary: "SalesDeskViewModel", localeKeyCount: 60, exactBrandCopyKeys: 55 },
  activation: { source: "Onboarding.jsx", typedBoundary: "ActivationWizardViewModel", localeKeyCount: 51, exactBrandCopyKeys: 38 },
  dnsVerification: { source: "DnsVerify.jsx", typedBoundary: "DnsVerificationViewModel", localeKeyCount: 60, exactBrandCopyKeys: 32 },
  renewalDesk: { source: "RenewDesk.jsx", typedBoundary: "RenewalDeskViewModel", localeKeyCount: 15, exactBrandCopyKeys: 15 },
  domainDetail: { source: "DomainDetail.jsx", typedBoundary: "DomainDetailViewModel", localeKeyCount: 37, exactBrandCopyKeys: 29 },
  signIn: { source: "SignIn.jsx", typedBoundary: "AuthGateViewModel", localeKeyCount: 57, exactBrandCopyKeys: 55, exactEnUSBrandCopyKeys: 55 },
} as const satisfies Record<DesktopPresentation, PresentationCopyInventoryEntry>;

export const reconciledPresentationCount = 13 as const;
export const reconciledLocaleKeyCount = 550 as const;
export const reconciledExactBrandCopyKeyCount = 444 as const;
export const reconciledExactEnUSBrandCopyKeyCount = 55 as const;
