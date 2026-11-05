import { z } from "zod";

import { launchPlatformKindSchema, launchPlatformNames } from "../connections/launch-platforms";
import { commerceMoneySchema } from "../pricing/index";
import { canonicalDomainNameSchema } from "../portfolio/domain-name";
import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import { salesDeskViewModelSchema, type ListingView, type SalesDeskViewModel } from "./index";

/** ADR-0027 launch platforms; the Host rejects any other. */
export const salesMarketplaceKindSchema = launchPlatformKindSchema;

/**
 * One listed domain, merged by the Host across its markets: `unknown` when a market has not
 * confirmed its state, `conflict` when two markets report different definite states, and no price
 * unless every market agrees on one. Nothing is chosen on the person's behalf.
 */
const salesListingRowSchema = z.object({
  entityId: canonicalDomainNameSchema,
  marketplaces: z.array(salesMarketplaceKindSchema).min(1).max(salesMarketplaceKindSchema.options.length).readonly()
    .refine((kinds) => kinds.every((kind, index) => index === 0 || kinds[index - 1]! < kind), "marketplaces must be unique and ordered"),
  listingStatus: z.enum(["draft", "active", "reserved", "sold", "suspended", "unknown", "conflict"]),
  askingPrice: commerceMoneySchema.nullable(),
}).strict().refine((row) => row.listingStatus !== "conflict" || row.marketplaces.length > 1, {
  path: ["listingStatus"], message: "markets can only disagree when there are two of them",
});

export const salesWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
}).strict();

/**
 * Host sales page: one row per listed domain, never offers or deals, with metrics over every listed
 * domain in the workspace rather than this page.
 */
export const salesReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("sales"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  totalRows: z.number().int().nonnegative().max(1_000_200),
  activeListingCount: z.number().int().nonnegative().max(1_000_200),
  /** Null when no active domain has a price, prices span currencies, or one has no single price. */
  listedValue: commerceMoneySchema.nullable(),
  window: z.object({
    startIndex: salesWindowRequestSchema.shape.startIndex,
    size: salesWindowRequestSchema.shape.size,
    rows: z.array(salesListingRowSchema).max(200).readonly(),
  }).strict(),
}).strict().superRefine((read, context) => {
  const { startIndex, size, rows } = read.window;
  if (rows.length > size || startIndex + rows.length > read.totalRows) {
    context.addIssue({ code: "custom", path: ["window", "rows"], message: "window exceeds its bounds" });
  }
  if (read.activeListingCount > read.totalRows) {
    context.addIssue({ code: "custom", path: ["activeListingCount"], message: "active listings exceed listed domains" });
  }
  if (read.activeListingCount === 0 && read.listedValue !== null) {
    context.addIssue({ code: "custom", path: ["listedValue"], message: "a listed value needs an active listing" });
  }
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.entityId >= rows[index]!.entityId) {
      context.addIssue({ code: "custom", path: ["window", "rows", index], message: "rows must be unique and ordered" });
      break;
    }
  }
});

export type SalesWindowRequest = z.infer<typeof salesWindowRequestSchema>;
export type SalesRead = z.infer<typeof salesReadSchema>;
export type SalesListingRow = z.infer<typeof salesListingRowSchema>;

export function parseSalesRead(input: unknown): SalesRead {
  return salesReadSchema.parse(copyPlainData(input));
}

export interface SalesReadPort {
  loadSales(request: SalesWindowRequest): Promise<SalesRead>;
}

function listingView(row: SalesListingRow): ListingView {
  return {
    // A presentation key scoped to this read, not a marketplace listing identifier.
    id: row.entityId,
    domain: row.entityId,
    platforms: row.marketplaces.map((kind) => launchPlatformNames[kind]),
    bin: row.askingPrice,
    views: null,
    offerCount: null,
    // A marketplace reservation is the platform's state; it is never shown as local sync progress.
    status: row.listingStatus,
    listedAtLabel: null,
  };
}

/**
 * Projects one Host sales page into the sales desk. Every window must come from one Host generation
 * and together cover the page; the metrics are the Host's, over every listed domain. Offers, deals,
 * views and listing dates are not observed by any qualified capability, so they are reported
 * unavailable and no write action is granted.
 */
export function projectSalesDeskViewModel(windows: readonly SalesRead[], pageSize: number): SalesDeskViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("sales needs at least one Host window");
  let expectedStart = first.window.startIndex;
  for (const window of windows) {
    if (window.readGeneration !== first.readGeneration || window.totalRows !== first.totalRows
      || window.activeListingCount !== first.activeListingCount
      || JSON.stringify(window.listedValue) !== JSON.stringify(first.listedValue)
      || window.window.startIndex !== expectedStart) {
      throw new TypeError("sales windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart !== Math.min(first.totalRows, first.window.startIndex + pageSize)) {
    throw new TypeError("sales windows must cover the whole page");
  }
  const rows = windows.flatMap((window) => window.window.rows);
  // Each window checks its own order; the order across window boundaries is checked here, so a
  // domain can never come back as a second row with the same key.
  if (rows.some((row, index) => index > 0 && rows[index - 1]!.entityId >= row.entityId)) {
    throw new TypeError("sales rows must be unique and ordered across windows");
  }
  // Parse the result so the view-model refinements also hold on the production path.
  return salesDeskViewModelSchema.parse({
    schemaVersion: 1,
    freshness: {
      source: first.freshness.source,
      serverRevision: first.freshness.serverRevision,
      lastReplicationActivityAt: first.freshness.lastReplicationActivityAt,
      lastSuccessfulProviderObservationAt: first.freshness.lastSuccessfulProviderObservationAt,
    },
    actionGrants: [],
    offerDealAvailability: "unavailable",
    metrics: {
      activeListingCount: first.activeListingCount,
      listedValue: first.listedValue,
      pendingOfferCount: null,
      monthGmv: null,
      settlingDealCount: null,
    },
    listings: rows.map(listingView),
    offers: [],
    deals: [],
    page: { startIndex: first.window.startIndex, size: pageSize, totalItems: first.totalRows },
  });
}
