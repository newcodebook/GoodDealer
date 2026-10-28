import type { AssetLibraryRow, AssetLibraryViewModel, PortfolioReadState } from "@gooddealer/client-core";

export type AssetLibraryPresentation = PortfolioReadState<AssetLibraryViewModel>;

/**
 * Listing and DNS facts the Asset Library can show beside each row. The Host projection does not
 * carry them yet, so production omits this map and the DNS / platform columns stay hidden; the mock
 * design host supplies it to design the full table.
 */
export interface AssetListingSummary {
  readonly dnsProvider: string | null;
  readonly platforms: readonly string[];
}

export type AssetStatusFilter = "all" | "synced" | "pending" | "conflict" | "unlisted" | "sold";
export type AssetBatchAction = "price" | "nameserver" | "records" | "list" | "delist";
export type AssetSortKey = "domain" | "targetPrice" | "expiresOn";

export interface AssetLibraryFilters {
  readonly registrar: string;
  readonly registrarOptions: readonly string[];
  readonly status: AssetStatusFilter;
}

export type AssetRowStatus = Exclude<AssetStatusFilter, "all"> | "local";

/** Sold and conflict outrank sync progress; a row with no listing platform reads as unlisted. */
export function assetRowStatus(row: AssetLibraryRow, listing: AssetListingSummary | undefined): AssetRowStatus {
  if (row.lifecycleStatus === "sold") return "sold";
  if (row.syncStatus === "conflicted") return "conflict";
  if (row.syncStatus === "pending") return "pending";
  if (row.syncStatus === "local_only") return "local";
  if (listing !== undefined && listing.platforms.length === 0) return "unlisted";
  return "synced";
}

/** Accepts a plain decimal amount ("12800", "12,800.50", "$980") and returns a canonical money string. */
export function parseTargetPriceInput(input: string): string | null {
  const normalized = input.replace(/[\s,$]/gu, "");
  if (!/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const trimmed = fraction.replace(/0+$/u, "");
  return trimmed === "" ? whole ?? null : `${whole}.${trimmed}`;
}
