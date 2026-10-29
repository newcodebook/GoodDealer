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
  shell: { source: "Shell.jsx", typedBoundary: "DesktopShellViewModel", localeKeyCount: 70, exactBrandCopyKeys: 27 },
  assetLibrary: { source: "AssetLibrary.jsx", typedBoundary: "AssetLibraryViewModel", localeKeyCount: 48, exactBrandCopyKeys: 37 },
  batchOperation: { source: "BatchPreview.jsx", typedBoundary: "BatchOperationViewModel", localeKeyCount: 139, exactBrandCopyKeys: 79 },
  conflictCenter: { source: "ConflictCenter.jsx", typedBoundary: "ConflictCenterViewModel", localeKeyCount: 28, exactBrandCopyKeys: 19 },
  manualTaskInbox: { source: "TaskInbox.jsx", typedBoundary: "ManualTaskInboxViewModel", localeKeyCount: 54, exactBrandCopyKeys: 34 },
  settings: { source: "SettingsPanel.jsx", typedBoundary: "ComposedSettingsViewModel", localeKeyCount: 82, exactBrandCopyKeys: 58 },
  operationHistory: { source: "HistoryLog.jsx", typedBoundary: "OperationHistoryViewModel", localeKeyCount: 52, exactBrandCopyKeys: 40 },
  salesDesk: { source: "SalesDesk.jsx", typedBoundary: "SalesDeskViewModel", localeKeyCount: 73, exactBrandCopyKeys: 59 },
  activation: { source: "Onboarding.jsx", typedBoundary: "ActivationWizardViewModel", localeKeyCount: 62, exactBrandCopyKeys: 42 },
  dnsVerification: { source: "DnsVerify.jsx", typedBoundary: "DnsVerificationViewModel", localeKeyCount: 64, exactBrandCopyKeys: 34 },
  renewalDesk: { source: "RenewDesk.jsx", typedBoundary: "RenewalDeskViewModel", localeKeyCount: 46, exactBrandCopyKeys: 27 },
  domainDetail: { source: "DomainDetail.jsx", typedBoundary: "DomainDetailViewModel", localeKeyCount: 62, exactBrandCopyKeys: 45 },
  signIn: { source: "SignIn.jsx", typedBoundary: "AuthGateViewModel", localeKeyCount: 57, exactBrandCopyKeys: 55, exactEnUSBrandCopyKeys: 55 },
} as const satisfies Record<DesktopPresentation, PresentationCopyInventoryEntry>;

export const reconciledPresentationCount = 13 as const;
export const reconciledLocaleKeyCount = 837 as const;
export const reconciledExactBrandCopyKeyCount = 556 as const;
export const reconciledExactEnUSBrandCopyKeyCount = 55 as const;
