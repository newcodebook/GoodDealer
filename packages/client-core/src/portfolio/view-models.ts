import { z } from "zod";

import { canonicalDomainNameSchema } from "./domain-name";
const portfolioFreshnessSchema = z
  .object({
    source: z.enum(["active_local", "standby_cloud"]),
    readOnlyReason: z.enum(["commercial", "standby"]).nullable(),
    serverRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lastReplicationActivityAt: z.iso.datetime().nullable(),
    lastSuccessfulProviderObservationAt: z.iso.datetime().nullable(),
    canEdit: z.boolean(),
  })
  .strict()
  .superRefine((freshness, context) => {
    const expectedCanEdit = freshness.source === "active_local" && freshness.readOnlyReason === null;
    if (freshness.canEdit !== expectedCanEdit) context.addIssue({ code: "custom", path: ["canEdit"], message: "freshness editability does not match authority" });
  });


export const canonicalMoneyViewSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/u),
    amount: z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{0,7}[1-9])?$/u),
  })
  .strict();

const safeTextSchema = (maximum: number) => z.string().max(maximum).refine(
  (value) => !/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(value),
  "text contains forbidden controls",
);

export const lifecycleStatusSchema = z.enum(["active", "expired", "sold", "dropped", "archived"]);
export const syncStatusSchema = z.enum(["clean", "pending", "conflicted", "local_only"]);

export const assetLibraryRowSchema = z
  .object({
    id: z.string().min(1).max(128),
    domain: canonicalDomainNameSchema,
    tags: z.array(safeTextSchema(64).min(1).refine((value) => value.trim() === value)).max(128).readonly(),
    registrar: safeTextSchema(128).min(1).nullable(),
    lifecycleStatus: lifecycleStatusSchema,
    syncStatus: syncStatusSchema,
    targetPrice: canonicalMoneyViewSchema.nullable(),
    expiresOn: z.iso.date().nullable(),
    assetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.id !== row.domain) {
      context.addIssue({ code: "custom", path: ["id"], message: "asset id must equal its canonical domain" });
    }
    if (new Set(row.tags).size !== row.tags.length) {
      context.addIssue({ code: "custom", path: ["tags"], message: "asset tags must be unique" });
    }
  });

export const assetLibraryWindowRequestSchema = z
  .object({ startIndex: z.number().int().nonnegative().max(1_000_000), size: z.number().int().min(1).max(200), query: safeTextSchema(64) })
  .strict();

export const assetLibraryViewModelSchema = z
  .object({
    schemaVersion: z.literal(3),
    kind: z.literal("asset_library"),
    readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    freshness: portfolioFreshnessSchema,
    totalRows: z.number().int().nonnegative().max(1_000_000),
    totalValue: canonicalMoneyViewSchema.nullable(),
    expiringWithin60Days: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    listingCount: z.number().int().nonnegative(),
    window: z
      .object({
        startIndex: z.number().int().nonnegative(),
        size: z.number().int().min(1).max(200),
    rows: z.array(assetLibraryRowSchema).max(200).readonly(),
      })
      .strict(),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.window.startIndex + view.window.rows.length > view.totalRows) {
      context.addIssue({ code: "custom", path: ["window"], message: "visible window exceeds total rows" });
    }
    if (view.window.rows.length > view.window.size) {
      context.addIssue({ code: "custom", path: ["window", "rows"], message: "visible rows exceed requested window size" });
    }
    if (view.totalRows === 0 && (view.window.startIndex !== 0 || view.window.rows.length !== 0)) {
      context.addIssue({ code: "custom", path: ["window"], message: "empty library cannot expose rows" });
    }
    const ids = new Set(view.window.rows.map((row) => row.id));
    const domains = new Set(view.window.rows.map((row) => row.domain));
    if (ids.size !== view.window.rows.length || domains.size !== view.window.rows.length) {
      context.addIssue({ code: "custom", path: ["window", "rows"], message: "visible assets must be unique" });
    }
  });

export const domainDetailStateSchema = z.enum(["normal", "conflict", "sold"]);

export const domainDetailViewModelSchema = z
  .object({
    schemaVersion: z.literal(3),
    kind: z.literal("domain_detail"),
    readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    freshness: portfolioFreshnessSchema,
    state: domainDetailStateSchema,
    asset: assetLibraryRowSchema.extend({
      acquiredOn: z.iso.date().nullable(),
      acquisitionCost: canonicalMoneyViewSchema.nullable(),
      autoRenew: z.boolean().nullable(),
      registrarLock: z.boolean().nullable(),
      note: safeTextSchema(10_000).nullable(),
      portfolioId: z.string().min(1).max(128).nullable(),
    }).strict(),
    conflictFields: z.array(safeTextSchema(128).min(1)).max(64).readonly(),
  })
  .strict()
  .superRefine((view, context) => {
    if ((view.state === "conflict") !== (view.conflictFields.length > 0)) {
      context.addIssue({ code: "custom", path: ["conflictFields"], message: "conflict fields must match detail state" });
    }
    if (view.state === "sold" && view.asset.lifecycleStatus !== "sold") {
      context.addIssue({ code: "custom", path: ["asset", "lifecycleStatus"], message: "sold detail requires sold asset" });
    }
    if (view.state === "conflict" && view.asset.syncStatus !== "conflicted") {
      context.addIssue({ code: "custom", path: ["asset", "syncStatus"], message: "conflict detail requires conflicted sync status" });
    }
    if (view.state === "normal" && (view.asset.lifecycleStatus === "sold" || view.asset.syncStatus === "conflicted")) {
      context.addIssue({ code: "custom", path: ["asset"], message: "normal detail cannot conceal sold or conflict state" });
    }
  });

export type CanonicalMoneyView = z.infer<typeof canonicalMoneyViewSchema>;
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type AssetLibraryRow = z.infer<typeof assetLibraryRowSchema>;
export type AssetLibraryWindowRequest = z.infer<typeof assetLibraryWindowRequestSchema>;
export type AssetLibraryViewModel = z.infer<typeof assetLibraryViewModelSchema>;
export type DomainDetailState = z.infer<typeof domainDetailStateSchema>;
export type DomainDetailViewModel = z.infer<typeof domainDetailViewModelSchema>;
export type PortfolioReadErrorCode =
  | "LOCAL_WORKSPACE_REJECTED" | "LOCAL_STORAGE_REJECTED" | "LOCAL_SCHEMA_REJECTED" | "LOCAL_PROJECTION_REJECTED"
  | "LOCAL_REVISION_REJECTED" | "LOCAL_RESPONSE_REJECTED";
export type PortfolioReadState<T> =
  | { readonly state: "loading" }
  | { readonly state: "empty" }
  | { readonly state: "ready"; readonly data: T }
  | { readonly state: "asset-not-found" }
  | { readonly state: "invalid-query"; readonly data: T | null }
  | { readonly state: "invalid-window" }
  | { readonly state: "unavailable" }
  | { readonly state: "error"; readonly code: PortfolioReadErrorCode };

export function parseAssetLibraryViewModel(input: unknown): AssetLibraryViewModel {
  return assetLibraryViewModelSchema.parse(copyPlainData(input));
}

export function parseDomainDetailViewModel(input: unknown): DomainDetailViewModel {
  return domainDetailViewModelSchema.parse(copyPlainData(input));
}

export function createAssetLibraryWindow(
  rows: readonly AssetLibraryRow[],
  request: AssetLibraryWindowRequest,
): AssetLibraryViewModel["window"] {
  const parsedRequest = assetLibraryWindowRequestSchema.parse(request);
  return {
    startIndex: parsedRequest.startIndex,
    size: parsedRequest.size,
    rows: rows.slice(parsedRequest.startIndex, parsedRequest.startIndex + parsedRequest.size),
  };
}

export function copyPlainData(input: unknown): unknown {
  let nodes = 0;
  const seen = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 10_000 || depth > 12) throw new TypeError("portfolio response is oversized");
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) throw new TypeError("portfolio response is cyclic");
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > 10_000) throw new TypeError("portfolio response array is invalid");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("portfolio response array is sparse");
      }
      if (Reflect.ownKeys(value).some((key) => typeof key === "symbol" || (key !== "length" && !/^\d+$/u.test(key)))) throw new TypeError("portfolio response array has extra keys");
      const result = value.map((item) => copy(item, depth + 1));
      seen.delete(value);
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("portfolio response record prototype is invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) throw new TypeError("portfolio response record symbols are invalid");
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError("portfolio response accessors are invalid");
      result[key] = copy(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return result;
  };
  return copy(input, 0);
}
