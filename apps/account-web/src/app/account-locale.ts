import { defaultLocale, isLocale, supportedLocales, type Locale } from "@gooddealer/i18n";

import type { RecoveryStorage } from "../browser-storage";

/** A per-browser display preference only; it carries no account data. */
export const ACCOUNT_LOCALE_KEY = "gooddealer.account.locale.v1";

/** A remembered choice wins, then the browser's first language that a supported locale shares, then the default. */
export function initialAccountLocale(storage: Pick<RecoveryStorage, "getItem"> | null, languages: readonly string[]): Locale {
  let stored: string | null = null;
  try { stored = storage?.getItem(ACCOUNT_LOCALE_KEY) ?? null; } catch { stored = null; }
  if (isLocale(stored)) return stored;
  for (const language of languages) {
    const primary = language.split("-")[0]?.toLowerCase();
    const match = supportedLocales.find((locale) => locale.split("-")[0]?.toLowerCase() === primary);
    if (match !== undefined) return match;
  }
  return defaultLocale;
}

export function rememberAccountLocale(storage: Pick<RecoveryStorage, "setItem"> | null, locale: Locale): void {
  try { storage?.setItem(ACCOUNT_LOCALE_KEY, locale); } catch { /* Blocked storage only forgets the preference. */ }
}
