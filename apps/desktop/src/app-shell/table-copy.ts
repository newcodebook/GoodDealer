import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";

/** Localized chrome for every Desktop table: hidden-column note and selection checkbox names. */
export function shellTableLabels(locale: Locale) {
  const copy = getPresentationCopy(locale, "shell");
  return {
    hiddenColumnsLabel: (count: number) => copy.hiddenColumns.replace("{count}", formatNumber(locale, count)),
    selectAllLabel: copy.selectAllRows,
    selectRowLabel: copy.selectRow,
  };
}
