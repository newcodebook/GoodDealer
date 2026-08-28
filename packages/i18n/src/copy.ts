import {
  parseCapabilityNamespace,
  parseDesktopPresentation,
  parseLocale,
  type CapabilityNamespace,
  type DesktopPresentation,
  type Locale,
  type LocalizedCopy,
} from "./copy-types";
import { enUS, enUSCapabilityCopy } from "./locales/en-us";
import { zhCN, zhCNCapabilityCopy } from "./locales/zh-cn";

export type DesktopCopy = LocalizedCopy<typeof zhCN>;
export type CapabilityCopy = LocalizedCopy<typeof zhCNCapabilityCopy>;

export const desktopCopy = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const satisfies Record<Locale, DesktopCopy>;

export const capabilityCopy = {
  "zh-CN": zhCNCapabilityCopy,
  "en-US": enUSCapabilityCopy,
} as const satisfies Record<Locale, CapabilityCopy>;

export function getDesktopCopy(locale: Locale): DesktopCopy {
  return desktopCopy[parseLocale(locale)];
}

export function getPresentationCopy<Name extends DesktopPresentation>(
  locale: Locale,
  presentation: Name,
): DesktopCopy[Name] {
  const checkedLocale = parseLocale(locale);
  const checkedPresentation = parseDesktopPresentation(presentation);
  return desktopCopy[checkedLocale][checkedPresentation] as DesktopCopy[Name];
}

export function getCapabilityCopy<Name extends CapabilityNamespace>(
  locale: Locale,
  namespace: Name,
): CapabilityCopy[Name] {
  const checkedLocale = parseLocale(locale);
  const checkedNamespace = parseCapabilityNamespace(namespace);
  return capabilityCopy[checkedLocale][checkedNamespace] as CapabilityCopy[Name];
}
