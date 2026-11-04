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
  shell: { source: "Shell.jsx", typedBoundary: "DesktopShellViewModel", localeKeyCount: 71, exactBrandCopyKeys: 27 },
  assetLibrary: { source: "AssetLibrary.jsx", typedBoundary: "AssetLibraryViewModel", localeKeyCount: 47, exactBrandCopyKeys: 36 },
  batchOperation: { source: "BatchPreview.jsx", typedBoundary: "BatchOperationViewModel", localeKeyCount: 145, exactBrandCopyKeys: 79 },
  conflictCenter: { source: "ConflictCenter.jsx", typedBoundary: "ConflictCenterViewModel", localeKeyCount: 28, exactBrandCopyKeys: 19 },
  manualTaskInbox: { source: "TaskInbox.jsx", typedBoundary: "ManualTaskInboxViewModel", localeKeyCount: 41, exactBrandCopyKeys: 19 },
  settings: { source: "SettingsPanel.jsx", typedBoundary: "ComposedSettingsViewModel", localeKeyCount: 88, exactBrandCopyKeys: 58 },
  operationHistory: { source: "HistoryLog.jsx", typedBoundary: "OperationHistoryViewModel", localeKeyCount: 67, exactBrandCopyKeys: 41 },
  salesDesk: { source: "SalesDesk.jsx", typedBoundary: "SalesDeskViewModel", localeKeyCount: 81, exactBrandCopyKeys: 59 },
  activation: { source: "Onboarding.jsx", typedBoundary: "ActivationWizardViewModel", localeKeyCount: 62, exactBrandCopyKeys: 42 },
  dnsVerification: { source: "DnsVerify.jsx", typedBoundary: "DnsVerificationViewModel", localeKeyCount: 74, exactBrandCopyKeys: 34 },
  renewalDesk: { source: "RenewDesk.jsx", typedBoundary: "RenewalDeskViewModel", localeKeyCount: 51, exactBrandCopyKeys: 27 },
  domainDetail: { source: "DomainDetail.jsx", typedBoundary: "DomainDetailViewModel", localeKeyCount: 62, exactBrandCopyKeys: 45 },
  signIn: { source: "SignIn.jsx", typedBoundary: "DesktopAuthenticationStatus", localeKeyCount: 21, exactBrandCopyKeys: 9, exactEnUSBrandCopyKeys: 8 },
} as const satisfies Record<DesktopPresentation, PresentationCopyInventoryEntry>;

export const reconciledPresentationCount = 13 as const;
export const reconciledLocaleKeyCount = 838 as const;
export const reconciledExactBrandCopyKeyCount = 495 as const;
export const reconciledExactEnUSBrandCopyKeyCount = 8 as const;
