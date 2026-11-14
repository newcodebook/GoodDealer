import { z } from "zod";

import { canonicalDomainNameSchema } from "../portfolio/domain-name";
import { copyPlainData, portfolioFreshnessSchema, registrarNameSchema } from "../portfolio/view-models";
import { renewalDeskViewModelSchema, type RenewalDeskItem, type RenewalDeskViewModel } from "./index";

const renewalRowSchema = z.object({
  entityId: canonicalDomainNameSchema,
  expiresOn: z.iso.date(),
  autoRenew: z.boolean().nullable(),
  registrarName: registrarNameSchema.nullable(),
}).strict();

export const renewalsWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
}).strict();

const dayMs = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / dayMs;
}

/** The Host's renewal window: assets still to renew (not sold, dropped or archived) expiring within 60 days of `asOfDate`, soonest first. */
export const renewalsReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("renewals"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  asOfDate: z.iso.date(),
  totalRows: z.number().int().nonnegative().max(1_000_200),
  autoRenewEnabledCount: z.number().int().nonnegative().max(1_000_200),
  autoRenewDisabledCount: z.number().int().nonnegative().max(1_000_200),
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
  if (read.autoRenewEnabledCount + read.autoRenewDisabledCount > read.totalRows) {
    context.addIssue({ code: "custom", path: ["autoRenewDisabledCount"], message: "auto-renew counts exceed the window total" });
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
 * Projects one page of `pageSize` rows from Host renewal windows into the renewal desk. The windows
 * must come from one Host generation, be contiguous from the page's first window and hold every row
 * of the page (fewer only on the last page); the page's metrics come from the
 * Host's whole-desk counts, never from the rows on this page. No registrar renewal or quote
 * capability is qualified, so the plan is unavailable: nothing is selectable, and term, price and
 * budget stay empty.
 */
export function projectRenewalDeskViewModel(windows: readonly RenewalsRead[], pageSize: number): RenewalDeskViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("renewals need at least one Host window");
  let expectedStart = first.window.startIndex;
  for (const window of windows) {
    if (window.readGeneration !== first.readGeneration || window.totalRows !== first.totalRows
      || window.asOfDate !== first.asOfDate || window.window.startIndex !== expectedStart
      || window.autoRenewEnabledCount !== first.autoRenewEnabledCount
      || window.autoRenewDisabledCount !== first.autoRenewDisabledCount) {
      throw new TypeError("renewal windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  // The page must hold every row it promises, so a short Host read fails instead of showing a
  // partial page under a full page's range.
  if (expectedStart !== Math.min(first.totalRows, first.window.startIndex + pageSize)) {
    throw new TypeError("renewal windows must cover the whole page");
  }
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
    page: {
      startIndex: first.window.startIndex,
      size: pageSize,
      totalItems: first.totalRows,
      autoRenewEnabledCount: first.autoRenewEnabledCount,
      autoRenewDisabledCount: first.autoRenewDisabledCount,
    },
  });
}
