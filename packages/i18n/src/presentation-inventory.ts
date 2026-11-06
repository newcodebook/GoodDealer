import type { DesktopPresentation } from "./copy-types";

export interface PresentationCopyInventoryEntry {
  /** Brand kit files whose copy this presentation reconciles against. */
  readonly source: string | readonly string[];
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
  // The shell also owns the kit's shared controls (controls.jsx), such as pagination labels.
  shell: { source: ["Shell.jsx", "controls.jsx"], typedBoundary: "DesktopShellViewModel", localeKeyCount: 74, exactBrandCopyKeys: 30 },
  assetLibrary: { source: "AssetLibrary.jsx", typedBoundary: "AssetLibraryViewModel", localeKeyCount: 54, exactBrandCopyKeys: 38 },
  batchOperation: { source: "BatchPreview.jsx", typedBoundary: "BatchOperationViewModel", localeKeyCount: 145, exactBrandCopyKeys: 79 },
  conflictCenter: { source: "ConflictCenter.jsx", typedBoundary: "ConflictCenterViewModel", localeKeyCount: 28, exactBrandCopyKeys: 19 },
  manualTaskInbox: { source: "TaskInbox.jsx", typedBoundary: "ManualTaskInboxViewModel", localeKeyCount: 44, exactBrandCopyKeys: 19 },
  settings: { source: "SettingsPanel.jsx", typedBoundary: "ComposedSettingsViewModel", localeKeyCount: 96, exactBrandCopyKeys: 58 },
  operationHistory: { source: "HistoryLog.jsx", typedBoundary: "OperationHistoryViewModel", localeKeyCount: 69, exactBrandCopyKeys: 43 },
  salesDesk: { source: "SalesDesk.jsx", typedBoundary: "SalesDeskViewModel", localeKeyCount: 83, exactBrandCopyKeys: 60 },
  activation: { source: "Onboarding.jsx", typedBoundary: "ActivationWizardViewModel", localeKeyCount: 62, exactBrandCopyKeys: 42 },
  dnsVerification: { source: "DnsVerify.jsx", typedBoundary: "DnsVerificationViewModel", localeKeyCount: 81, exactBrandCopyKeys: 35 },
  renewalDesk: { source: "RenewDesk.jsx", typedBoundary: "RenewalDeskViewModel", localeKeyCount: 54, exactBrandCopyKeys: 27 },
  domainDetail: { source: "DomainDetail.jsx", typedBoundary: "DomainDetailViewModel", localeKeyCount: 62, exactBrandCopyKeys: 45 },
  signIn: { source: "SignIn.jsx", typedBoundary: "DesktopAuthenticationStatus", localeKeyCount: 21, exactBrandCopyKeys: 9, exactEnUSBrandCopyKeys: 8 },
} as const satisfies Record<DesktopPresentation, PresentationCopyInventoryEntry>;

export const reconciledPresentationCount = 13 as const;
export const reconciledLocaleKeyCount = 873 as const;
export const reconciledExactBrandCopyKeyCount = 504 as const;
export const reconciledExactEnUSBrandCopyKeyCount = 8 as const;
