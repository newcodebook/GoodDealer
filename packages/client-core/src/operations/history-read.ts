import { z } from "zod";

import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import { operationHistoryViewModelSchema, type OperationHistoryEntry, type OperationHistoryViewModel } from "./contracts";

const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Like the Host, counts Unicode scalar values rather than UTF-16 code units. */
function maxCharacters(limit: number) {
  return z.string().refine((value) => Array.from(value).length <= limit, `at most ${limit} characters`);
}

// Bounds mirror the Host's asset-write rules, so any value an edit could record is readable.
const noteSchema = maxCharacters(10_000);
const portfolioIdSchema = z.string().min(1).max(160);
const tagsSchema = z.array(maxCharacters(64).refine((tag) => tag !== "", "tags are non-empty")).max(128);
const moneySchema = z.object({ currency: z.string().min(1).max(16), amount: z.string().min(1).max(64) }).strict();

/** Each recorded field keeps the shape the Host validated; anything else is rejected. */
const historyFieldChangeSchema = z.discriminatedUnion("fieldPath", [
  z.object({ fieldPath: z.literal("note"), value: noteSchema.nullable(), previousValue: noteSchema.nullable().optional() }).strict(),
  z.object({ fieldPath: z.literal("portfolioId"), value: portfolioIdSchema.nullable(), previousValue: portfolioIdSchema.nullable().optional() }).strict(),
  z.object({ fieldPath: z.literal("tags"), value: tagsSchema, previousValue: tagsSchema.optional() }).strict(),
  z.object({ fieldPath: z.literal("targetPrice"), value: moneySchema.nullable(), previousValue: moneySchema.nullable().optional() }).strict(),
]);

const historyRowSchema = z.object({
  localRevision: revisionSchema,
  entityId: z.string().min(1).max(253),
  operation: z.enum(["edit", "delete"]),
  committedAt: z.iso.datetime(),
  state: z.enum(["pending", "sending", "acknowledged", "conflicted", "rejected"]),
  serverRevision: revisionSchema.min(1).nullable(),
  changes: z.array(historyFieldChangeSchema).max(4).readonly(),
}).strict().superRefine((row, context) => {
  if ((row.state === "acknowledged") !== (row.serverRevision !== null)) {
    context.addIssue({ code: "custom", path: ["serverRevision"], message: "only an acknowledged revision has a server revision" });
  }
  if (row.operation === "delete" && row.changes.length > 0) {
    context.addIssue({ code: "custom", path: ["changes"], message: "a deletion records no field values" });
  }
  if (new Set(row.changes.map((change) => change.fieldPath)).size !== row.changes.length) {
    context.addIssue({ code: "custom", path: ["changes"], message: "each field changes at most once per revision" });
  }
});

/** UTC to the second, the only form the Host compares with its commit times. */
const canonicalInstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u).pipe(z.iso.datetime());

/**
 * One window of the ledger, plus the person's local day (start inclusive, end exclusive) in which
 * the Host counts today's changes over the whole ledger. A day is 23 to 25 hours around a daylight
 * saving change.
 */
export const historyWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
  todayFrom: canonicalInstantSchema,
  todayUntil: canonicalInstantSchema,
}).strict().refine((request) => {
  const span = Date.parse(request.todayUntil) - Date.parse(request.todayFrom);
  return span > 0 && span <= 25 * 3_600_000;
}, "the day must end after it starts, within 25 hours");

/** The person's local day containing `now`, as canonical UTC instants for a history request. */
export function localHistoryDay(now: Date): Pick<HistoryWindowRequest, "todayFrom" | "todayUntil"> {
  const instant = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/u, "Z");
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { todayFrom: instant(from), todayUntil: instant(until) };
}

/** Host revision ledger window: local revisions newest first, without mutation or device identifiers. */
export const historyReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("history"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  totalRows: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pendingRows: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  /** Revisions committed within the requested day, over the whole ledger. */
  changesToday: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  window: z.object({
    startIndex: z.number().int().nonnegative().max(1_000_000),
    size: z.number().int().min(1).max(200),
    rows: z.array(historyRowSchema).max(200).readonly(),
  }).strict(),
}).strict().superRefine((read, context) => {
  const { startIndex, size, rows } = read.window;
  if (read.pendingRows > read.totalRows || read.changesToday > read.totalRows || rows.length > size
    || startIndex + rows.length > read.totalRows) {
    context.addIssue({ code: "custom", path: ["window", "rows"], message: "window exceeds its bounds" });
  }
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.localRevision < rows[index]!.localRevision) {
      context.addIssue({ code: "custom", path: ["window", "rows", index], message: "rows must be newest first" });
      break;
    }
  }
});

export type HistoryWindowRequest = z.infer<typeof historyWindowRequestSchema>;
export type HistoryRead = z.infer<typeof historyReadSchema>;
export type HistoryRow = z.infer<typeof historyRowSchema>;
export type HistoryFieldChange = z.infer<typeof historyFieldChangeSchema>;

export function parseHistoryRead(input: unknown): HistoryRead {
  return historyReadSchema.parse(copyPlainData(input));
}

export interface HistoryReadPort {
  loadHistory(request: HistoryWindowRequest): Promise<HistoryRead>;
}

/** The operation history view model holds at most this many of the newest revisions. */
export const historyEntryLimit = 500;

/** Localized labels the projection needs; the Host read carries none. */
export interface HistoryProjectionLabels {
  readonly edit: string;
  readonly delete: string;
  readonly actor: string;
  readonly platform: string;
  readonly empty: string;
  readonly fields: Readonly<Record<HistoryFieldChange["fieldPath"], string>>;
}

/** Diff values hold at most this many UTF-16 code units; longer notes and tag lists are clipped. */
const displayLimit = 2_000;

function displayValue(value: HistoryFieldChange["value"], empty: string): string {
  let text: string;
  if (value === null) return empty;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value)) text = value.join(", ");
  else text = `${value.currency} ${value.amount}`;
  if (text === "") return empty;
  if (text.length <= displayLimit) return text;
  // Clip on whole code points so a surrogate pair is never split, leaving room for the ellipsis.
  let clipped = "";
  for (const character of text) {
    if (clipped.length + character.length > displayLimit - 1) break;
    clipped += character;
  }
  return `${clipped}…`;
}

function entryState(state: HistoryRow["state"]): OperationHistoryEntry["state"] {
  switch (state) {
    case "pending":
    case "sending": return "applied";
    case "acknowledged": return "synced";
    case "conflicted": return "conflicted";
    case "rejected": return "rejected";
  }
}

/**
 * Projects contiguous Host history windows of one generation into the operation history view. The
 * windows cover the newest revisions up to `historyEntryLimit`; totals, including today's changes,
 * count the whole ledger. No reversal is
 * offered: rollback needs a qualified Host command, so every entry is read-only and an unknown
 * previous value stays null rather than looking empty.
 */
export function projectOperationHistory(
  windows: readonly HistoryRead[],
  labels: HistoryProjectionLabels,
  selectedRevisionId: string | null,
): OperationHistoryViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("history needs at least one Host window");
  let expectedStart = 0;
  for (const window of windows) {
    if (window.readGeneration !== first.readGeneration || window.totalRows !== first.totalRows
      || window.pendingRows !== first.pendingRows || window.changesToday !== first.changesToday
      || window.window.startIndex !== expectedStart) {
      throw new TypeError("history windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart < Math.min(first.totalRows, historyEntryLimit)) throw new TypeError("history windows must cover the newest revisions");
  const rows = windows.flatMap((window) => window.window.rows).slice(0, historyEntryLimit);
  const entries = rows.map((row): OperationHistoryEntry => ({
    revisionId: `rev-${row.localRevision}`,
    revisionLabel: String(row.localRevision),
    occurredAt: row.committedAt,
    actorLabel: labels.actor,
    scope: "single_domain",
    // A deletion carries no diffs, so the action itself names the asset.
    actionLabel: `${row.operation === "edit" ? labels.edit : labels.delete} · ${row.entityId}`,
    platformLabel: labels.platform,
    itemCount: 1,
    state: entryState(row.state),
    risk: "standard",
    diffs: row.changes.map((change) => ({
      entityLabel: row.entityId,
      fieldLabel: labels.fields[change.fieldPath],
      oldValue: change.previousValue === undefined ? null : displayValue(change.previousValue, labels.empty),
      newValue: displayValue(change.value, labels.empty),
    })),
    reversible: false,
    availableActions: [],
    lateExecution: null,
  }));
  return operationHistoryViewModelSchema.parse({
    schemaVersion: 1,
    kind: "operation_history",
    source: first.freshness.source,
    commandAdmission: "unavailable",
    selectedRevisionId: entries.some((entry) => entry.revisionId === selectedRevisionId) ? selectedRevisionId : null,
    totalRevisions: first.totalRows,
    changesToday: first.changesToday,
    pendingRevisionCount: first.pendingRows,
    entries,
  });
}
