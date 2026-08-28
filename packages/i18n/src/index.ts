export {
  capabilityNamespaces,
  desktopPresentations,
  isCapabilityNamespace,
  isDesktopPresentation,
  isLocale,
  parseCapabilityNamespace,
  parseDesktopPresentation,
  parseLocale,
  supportedLocales,
  type CapabilityNamespace,
  type DesktopPresentation,
  type Locale,
  type LocalizedCopy,
} from "./copy-types";
export {
  capabilityCopy,
  desktopCopy,
  getCapabilityCopy,
  getDesktopCopy,
  getPresentationCopy,
  type CapabilityCopy,
  type DesktopCopy,
} from "./copy";
export {
  copyDecisionIds,
  resolvedCopyDecisions,
  type CopyDecisionId,
} from "./copy-decisions";
export {
  formatDate,
  formatMoney,
  formatNumber,
  type DateFormatOptions,
  type DateValue,
  type MoneyFormatOptions,
  type NumberFormatOptions,
  type NumericValue,
} from "./formatters";
export { enUS, enUSCapabilityCopy } from "./locales/en-us";
export { zhCN, zhCNCapabilityCopy } from "./locales/zh-cn";
export {
  presentationCopyInventory,
  reconciledExactEnUSBrandCopyKeyCount,
  reconciledExactBrandCopyKeyCount,
  reconciledLocaleKeyCount,
  reconciledPresentationCount,
  type PresentationCopyInventoryEntry,
} from "./presentation-inventory";

export const defaultLocale = "zh-CN" as const;
