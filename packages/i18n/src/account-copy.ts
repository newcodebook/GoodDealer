import { parseAccountPresentation, type AccountPresentation } from "./account-copy-types";
import { parseLocale, type Locale, type LocalizedCopy } from "./copy-types";
import { enUSAccount } from "./locales/account-en-us";
import { zhCNAccount } from "./locales/account-zh-cn";

export type AccountCopy = LocalizedCopy<typeof zhCNAccount>;

export const accountCopy = {
  "zh-CN": zhCNAccount,
  "en-US": enUSAccount,
} as const satisfies Record<Locale, AccountCopy>;

export function getAccountCopy<Name extends AccountPresentation>(
  locale: Locale,
  presentation: Name,
): AccountCopy[Name] {
  const checkedLocale = parseLocale(locale);
  const checkedPresentation = parseAccountPresentation(presentation);
  return accountCopy[checkedLocale][checkedPresentation] as AccountCopy[Name];
}
