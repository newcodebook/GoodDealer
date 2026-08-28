export type PortfolioAvailability = "available" | "unavailable";
export type PortfolioUncertainty = "confirmed" | "stale" | "conflicted" | "unknown";

export interface PortfolioReadMeta {
  readonly source: "gooddealer-cloud" | "workspace" | "cloudflare-zone-dns";
  readonly observedAt: string | null;
  readonly version: number;
  readonly availability: PortfolioAvailability;
  readonly uncertainty: PortfolioUncertainty;
}

export type PortfolioReadState<T> =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly code: "invalid-projection" | "read-failed" }
  | { readonly state: "unavailable"; readonly meta: PortfolioReadMeta & { readonly availability: "unavailable" }; readonly reason: string }
  | { readonly state: "empty"; readonly meta: PortfolioReadMeta & { readonly availability: "available" } }
  | { readonly state: "ready"; readonly meta: PortfolioReadMeta & { readonly availability: "available"; readonly uncertainty: "confirmed" }; readonly data: T }
  | { readonly state: "stale"; readonly meta: PortfolioReadMeta & { readonly uncertainty: "stale" }; readonly data: T }
  | { readonly state: "uncertain"; readonly meta: PortfolioReadMeta & { readonly uncertainty: "conflicted" | "unknown" }; readonly data: T | null };

export interface PortfolioAssetRow {
  readonly entityId: string;
  readonly displayName: string;
  readonly registrarLabel: string | null;
  readonly expirationLabel: string | null;
  readonly statusLabel: string;
  readonly tags: readonly string[];
  readonly meta: PortfolioReadMeta;
}

export interface PortfolioListData {
  readonly rows: readonly PortfolioAssetRow[];
  readonly totalRows: number;
  readonly window: { readonly startIndex: number; readonly size: number };
}

export interface PortfolioDetailData {
  readonly entityId: string;
  readonly displayName: string;
  readonly registrarLabel: string | null;
  readonly registeredOnLabel: string | null;
  readonly expirationLabel: string | null;
  readonly statusLabel: string;
  readonly tags: readonly string[];
  readonly meta: PortfolioReadMeta;
}

export interface PortfolioWindowRequest {
  readonly startIndex: number;
  readonly size: number;
}
