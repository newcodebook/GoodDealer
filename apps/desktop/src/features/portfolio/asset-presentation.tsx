import { formatMoney, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge } from "@gooddealer/ui";

import type { AssetRowStatus } from "./asset-library/asset-library-contract";

/** Narrow symbols keep the kit's "$284,120.00" instead of zh-CN's default "US$". */
export function formatAssetMoney(locale: Locale, amount: string, currency: string): string {
  return formatMoney(locale, Number(amount), currency, { currencyDisplay: "narrowSymbol" });
}

/** One status vocabulary for library rows and the detail header. */
export function AssetStatusBadge({ locale, status }: { readonly locale: Locale; readonly status: AssetRowStatus }) {
  const copy = getPresentationCopy(locale, "assetLibrary");
  switch (status) {
    case "synced": return <Badge tone="sync">SYNCED</Badge>;
    case "pending": return <Badge tone="warning" mono={false}>{copy.waitingProvider}</Badge>;
    case "conflict": return <Badge tone="danger" mono={false}>{copy.conflict}</Badge>;
    case "unlisted": return <Badge mono={false}>{copy.unlisted}</Badge>;
    case "sold": return <Badge tone="gold">SOLD</Badge>;
    case "local": return <Badge mono={false}>{getPresentationCopy(locale, "shell").unsynced}</Badge>;
  }
}

export function daysUntil(date: string, reference: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / 86_400_000);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
