import { z } from "zod";

import { commerceMoneySchema, type CommerceMoney } from "../pricing/index";
import { canonicalDomainNameSchema } from "../portfolio/domain-name";
import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import { salesDeskViewModelSchema, type ListingView, type SalesDeskViewModel } from "./index";

/** ADR-0027 launch platforms; the Host rejects listings from any other marketplace. */
export const salesMarketplaceKindSchema = z.enum([
  "afternic", "atom", "cloudflare", "dynadot", "godaddy", "namecheap", "porkbun", "spaceship",
]);

const salesListingRowSchema = z.object({
  entityId: canonicalDomainNameSchema,
  marketplaceKind: salesMarketplaceKindSchema,
  listingStatus: z.enum(["draft", "active", "reserved", "sold", "suspended", "unknown"]),
  askingPrice: commerceMoneySchema.nullable(),
  observedAt: z.iso.datetime(),
  availability: z.enum(["available", "unavailable"]),
  evidenceStatus: z.enum(["confirmed", "stale", "conflicted", "unknown"]),
}).strict();

export const salesWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
}).strict();

/** Host sales window: the latest observed listing per (asset, marketplace), never offers or deals. */
export const salesReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("sales"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  totalRows: z.number().int().nonnegative().max(1_000_200),
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
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    if (previous.entityId > current.entityId
      || (previous.entityId === current.entityId && previous.marketplaceKind >= current.marketplaceKind)) {
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

const marketplaceNames: Readonly<Record<SalesListingRow["marketplaceKind"], string>> = {
  afternic: "Afternic",
  atom: "Atom",
  cloudflare: "Cloudflare",
  dynadot: "Dynadot",
  godaddy: "GoDaddy",
  namecheap: "Namecheap",
  porkbun: "Porkbun",
  spaceship: "Spaceship",
};

/** Unconfirmed or unavailable evidence never presents as a definite listing state. */
function listingStatus(row: SalesListingRow): ListingView["status"] {
  if (row.availability !== "available" || row.evidenceStatus !== "confirmed") return "unknown";
  // A marketplace reservation is the platform's state; it is never shown as local sync progress.
  return row.listingStatus;
}

const scale = 100_000_000n;

function toUnits(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(8, "0"));
}

function fromUnits(units: bigint): string {
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(8, "0").replace(/0+$/u, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

/** Sums prices exactly; null when there is nothing to sum or the prices span currencies. */
function listedValue(listings: readonly ListingView[]): CommerceMoney | null {
  const prices = listings.flatMap((listing) => listing.status === "active" && listing.bin !== null ? [listing.bin] : []);
  const currency = prices[0]?.currency;
  if (currency === undefined || prices.some((price) => price.currency !== currency)) return null;
  const parsed = commerceMoneySchema.safeParse({ currency, amount: fromUnits(prices.reduce((sum, price) => sum + toUnits(price.amount), 0n)) });
  return parsed.success ? parsed.data : null;
}

/**
 * Projects complete Host sales windows into the sales desk. Every window must come from one Host
 * generation and together cover every row. Offers, deals, views and listing dates are not observed
 * by any qualified capability, so they are reported unavailable and no write action is granted.
 */
export function projectSalesDeskViewModel(windows: readonly SalesRead[]): SalesDeskViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("sales needs at least one Host window");
  let expectedStart = 0;
  for (const window of windows) {
    if (window.readGeneration !== first.readGeneration || window.totalRows !== first.totalRows
      || window.window.startIndex !== expectedStart) {
      throw new TypeError("sales windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart !== first.totalRows) throw new TypeError("sales windows must cover every listing");
  const listings = windows.flatMap((window) => window.window.rows.map((row): ListingView => ({
    // A presentation key scoped to this read, not a marketplace listing identifier.
    id: `${row.entityId}:${row.marketplaceKind}`,
    domain: row.entityId,
    platforms: [marketplaceNames[row.marketplaceKind]],
    bin: row.askingPrice,
    views: null,
    offerCount: null,
    status: listingStatus(row),
    listedAtLabel: null,
  })));
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
      activeListingCount: listings.filter((listing) => listing.status === "active").length,
      listedValue: listedValue(listings),
      pendingOfferCount: null,
      monthGmv: null,
      settlingDealCount: null,
    },
    listings,
    offers: [],
    deals: [],
  });
}
