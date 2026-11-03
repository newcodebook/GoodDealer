import { z } from "zod";

import { canonicalDomainNameSchema } from "../portfolio/domain-name";
import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import { renewalDeskViewModelSchema, type RenewalDeskItem, type RenewalDeskViewModel } from "./index";

const renewalRowSchema = z.object({
  entityId: canonicalDomainNameSchema,
  expiresOn: z.iso.date(),
  autoRenew: z.boolean().nullable(),
  registrarName: z.string().min(1).max(128).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "registrar names reject control characters").nullable(),
}).strict();

export const renewalsWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
}).strict();

const dayMs = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / dayMs;
}

/** The Host's renewal window: unarchived assets expiring within 60 days of `asOfDate`, soonest first. */
export const renewalsReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("renewals"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  asOfDate: z.iso.date(),
  totalRows: z.number().int().nonnegative().max(1_000_200),
  window: z.object({
    startIndex: renewalsWindowRequestSchema.shape.startIndex,
    size: renewalsWindowRequestSchema.shape.size,
    rows: z.array(renewalRowSchema).max(200).readonly(),
  }).strict(),
}).strict().superRefine((read, context) => {
  const { startIndex, size, rows } = read.window;
  if (rows.length > size || startIndex + rows.length > read.totalRows) {
    context.addIssue({ code: "custom", path: ["window", "rows"], message: "window exceeds its bounds" });
  }
  const today = dayNumber(read.asOfDate);
  rows.forEach((row, index) => {
    const days = dayNumber(row.expiresOn) - today;
    if (days < 0 || days > 60) {
      context.addIssue({ code: "custom", path: ["window", "rows", index, "expiresOn"], message: "expiry is outside the renewal window" });
    }
    const previous = rows[index - 1];
    if (previous !== undefined && (previous.expiresOn > row.expiresOn
      || (previous.expiresOn === row.expiresOn && previous.entityId >= row.entityId))) {
      context.addIssue({ code: "custom", path: ["window", "rows", index], message: "rows must be unique and ordered" });
    }
  });
});

export type RenewalsWindowRequest = z.infer<typeof renewalsWindowRequestSchema>;
export type RenewalsRead = z.infer<typeof renewalsReadSchema>;

export function parseRenewalsRead(input: unknown): RenewalsRead {
  return renewalsReadSchema.parse(copyPlainData(input));
}

export interface RenewalsReadPort {
  loadRenewals(request: RenewalsWindowRequest): Promise<RenewalsRead>;
}

/**
 * Projects complete Host renewal windows into the renewal desk. Every window must come from one Host
 * generation and together cover every row. No registrar renewal or quote capability is qualified,
 * so the plan is unavailable: nothing is selectable, and term, price and budget stay empty.
 */
export function projectRenewalDeskViewModel(windows: readonly RenewalsRead[]): RenewalDeskViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("renewals need at least one Host window");
  let expectedStart = 0;
  for (const window of windows) {
    if (window.readGeneration !== first.readGeneration || window.totalRows !== first.totalRows
      || window.asOfDate !== first.asOfDate || window.window.startIndex !== expectedStart) {
      throw new TypeError("renewal windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart !== first.totalRows) throw new TypeError("renewal windows must cover every asset");
  const today = dayNumber(first.asOfDate);
  const items = windows.flatMap((window) => window.window.rows.map((row): RenewalDeskItem => ({
    id: row.entityId,
    domain: row.entityId,
    registrar: row.registrarName,
    expiresOn: row.expiresOn,
    daysRemaining: dayNumber(row.expiresOn) - today,
    autoRenewEnabled: row.autoRenew,
    termYears: null,
    annualPrice: null,
    selected: false,
    status: "due",
  })));
  const { freshness } = first;
  return renewalDeskViewModelSchema.parse({
    schemaVersion: 1,
    kind: "renewal_desk",
    state: "list",
    freshness: {
      source: freshness.source,
      ...(freshness.readOnlyReason === null ? {} : { readOnlyReason: freshness.readOnlyReason }),
      serverRevision: freshness.serverRevision,
      lastReplicationActivityAt: freshness.lastReplicationActivityAt,
      lastSuccessfulProviderObservationAt: freshness.lastSuccessfulProviderObservationAt,
      canEdit: freshness.canEdit,
    },
    planAvailability: "unavailable",
    budget: null,
    items,
    selectedCount: 0,
    selectedTotal: null,
  });
}
