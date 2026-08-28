import { z } from "zod";

import { canonicalDomainNameSchema } from "./domain-name";
import { dataFreshnessSchema } from "./data-freshness";

export const canonicalMoneyViewSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/u),
    amount: z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{0,7}[1-9])?$/u),
  })
  .strict();

export const assetStatusSchema = z.enum(["synced", "pending", "conflict", "unlisted", "sold"]);

export const assetLibraryRowSchema = z
  .object({
    id: z.string().min(1).max(128),
    domain: canonicalDomainNameSchema,
    tags: z.array(z.string().min(1).max(64)).max(128),
    registrar: z.string().min(1).max(128),
    dnsProvider: z.string().min(1).max(128).nullable(),
    platforms: z.array(z.string().min(1).max(128)).max(32),
    status: assetStatusSchema,
    targetPrice: canonicalMoneyViewSchema.nullable(),
    expiresOn: z.iso.date().nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (new Set(row.tags).size !== row.tags.length || new Set(row.platforms).size !== row.platforms.length) {
      context.addIssue({ code: "custom", path: [], message: "asset tags and platforms must be unique" });
    }
  });

export const assetLibraryWindowRequestSchema = z
  .object({ startIndex: z.number().int().nonnegative(), size: z.number().int().min(1).max(200) })
  .strict();

export const assetLibraryViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("asset_library"),
    freshness: dataFreshnessSchema,
    totalRows: z.number().int().nonnegative().max(1_000_000),
    totalValue: canonicalMoneyViewSchema,
    expiringWithin60Days: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    listingCount: z.number().int().nonnegative(),
    window: z
      .object({
        startIndex: z.number().int().nonnegative(),
        size: z.number().int().min(1).max(200),
        rows: z.array(assetLibraryRowSchema).max(200),
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
    schemaVersion: z.literal(1),
    kind: z.literal("domain_detail"),
    freshness: dataFreshnessSchema,
    state: domainDetailStateSchema,
    asset: assetLibraryRowSchema.extend({
      acquiredOn: z.iso.date().nullable(),
      acquisitionCost: canonicalMoneyViewSchema.nullable(),
      autoRenew: z.boolean(),
      registrarLock: z.boolean(),
      note: z.string().max(10_000).nullable(),
    }).strict(),
    conflictFields: z.array(z.string().min(1).max(128)).max(64),
  })
  .strict()
  .superRefine((view, context) => {
    if ((view.state === "conflict") !== (view.conflictFields.length > 0)) {
      context.addIssue({ code: "custom", path: ["conflictFields"], message: "conflict fields must match detail state" });
    }
    if (view.state === "sold" && view.asset.status !== "sold") {
      context.addIssue({ code: "custom", path: ["asset", "status"], message: "sold detail requires sold asset" });
    }
    if (view.state === "conflict" && view.asset.status !== "conflict") {
      context.addIssue({ code: "custom", path: ["asset", "status"], message: "conflict detail requires conflict asset" });
    }
    if (view.state === "normal" && (view.asset.status === "sold" || view.asset.status === "conflict")) {
      context.addIssue({ code: "custom", path: ["asset", "status"], message: "normal detail cannot conceal sold or conflict state" });
    }
  });

export type CanonicalMoneyView = z.infer<typeof canonicalMoneyViewSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type AssetLibraryRow = z.infer<typeof assetLibraryRowSchema>;
export type AssetLibraryWindowRequest = z.infer<typeof assetLibraryWindowRequestSchema>;
export type AssetLibraryViewModel = z.infer<typeof assetLibraryViewModelSchema>;
export type DomainDetailState = z.infer<typeof domainDetailStateSchema>;
export type DomainDetailViewModel = z.infer<typeof domainDetailViewModelSchema>;

export function parseAssetLibraryViewModel(input: unknown): AssetLibraryViewModel {
  return assetLibraryViewModelSchema.parse(input);
}

export function parseDomainDetailViewModel(input: unknown): DomainDetailViewModel {
  return domainDetailViewModelSchema.parse(input);
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
