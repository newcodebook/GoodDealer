import { z } from "zod";

import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import { batchOperationPhaseSchema } from "./contracts";

/** ADR-0027 launch platforms; the Host rejects plan items bound to any other Provider kind. */
const batchProviderKindSchema = z.enum([
  "afternic", "atom", "cloudflare", "dynadot", "godaddy", "namecheap", "porkbun", "spaceship",
]);

const countSchema = z.number().int().nonnegative().max(100_000);

const batchPlannedCountsSchema = z.object({
  automatic: countSchema,
  manual: countSchema,
  unsupported: countSchema,
  conflict: countSchema,
  excluded: countSchema,
  highRisk: countSchema,
}).strict();

const batchAttemptCountsSchema = z.object({
  queued: countSchema,
  running: countSchema,
  succeeded: countSchema,
  waitingRemote: countSchema,
  manualActionRequired: countSchema,
  failedRetryable: countSchema,
  outcomeUnknown: countSchema,
  failedFinal: countSchema,
  cancelled: countSchema,
  rolledBack: countSchema,
}).strict();

const batchOperationRowSchema = z.object({
  title: z.string().min(1).max(500).refine((value) => !/[\p{Cc}]/u.test(value), "titles reject control characters"),
  operationKind: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  planPhase: z.enum(["planned", "awaiting_approval", "approved", "cancelled", "expired", "executing", "completed"]),
  operationPhase: z.enum(["queued", "running", "completed", "partially_failed", "cancelled", "rolled_back"]).nullable(),
  riskLevel: z.enum(["standard", "high"]),
  itemCount: z.number().int().min(1).max(100_000),
  targetCount: countSchema,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  providerKinds: z.array(batchProviderKindSchema).max(8).readonly(),
  planned: batchPlannedCountsSchema,
  results: batchAttemptCountsSchema.nullable(),
}).strict().superRefine((row, context) => {
  if ((row.operationPhase === null) !== (row.results === null)) {
    context.addIssue({ code: "custom", path: ["results"], message: "attempt counts exist exactly when an operation exists" });
  }
  if (row.completedAt !== null && row.operationPhase === null) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "only an operation completes" });
  }
  // A plan may still be gaining items before approval; an executed plan's set is complete.
  const { automatic, manual, unsupported, conflict, excluded } = row.planned;
  const planned = automatic + manual + unsupported + conflict + excluded;
  if (planned > row.itemCount || (row.operationPhase !== null && planned !== row.itemCount)) {
    context.addIssue({ code: "custom", path: ["planned"], message: "planned counts must not exceed the plan" });
  }
  if (new Set(row.providerKinds).size !== row.providerKinds.length) {
    context.addIssue({ code: "custom", path: ["providerKinds"], message: "provider kinds must be unique" });
  }
});

export const batchOperationsWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
}).strict();

/** Host batch list window: operation plans newest first, without plan or operation identifiers. */
export const batchOperationsReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("batch_operations"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  totalRows: z.number().int().nonnegative().max(1_000_200),
  window: z.object({
    startIndex: batchOperationsWindowRequestSchema.shape.startIndex,
    size: batchOperationsWindowRequestSchema.shape.size,
    rows: z.array(batchOperationRowSchema).max(200).readonly(),
  }).strict(),
}).strict().superRefine((read, context) => {
  const { startIndex, size, rows } = read.window;
  if (rows.length > size || startIndex + rows.length > read.totalRows) {
    context.addIssue({ code: "custom", path: ["window", "rows"], message: "window exceeds its bounds" });
  }
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.createdAt < rows[index]!.createdAt) {
      context.addIssue({ code: "custom", path: ["window", "rows", index], message: "rows must be newest first" });
      break;
    }
  }
});

export type BatchOperationsWindowRequest = z.infer<typeof batchOperationsWindowRequestSchema>;
export type BatchOperationsRead = z.infer<typeof batchOperationsReadSchema>;
export type BatchOperationRow = z.infer<typeof batchOperationRowSchema>;

export function parseBatchOperationsRead(input: unknown): BatchOperationsRead {
  return batchOperationsReadSchema.parse(copyPlainData(input));
}

export interface BatchOperationsReadPort {
  loadBatchOperations(request: BatchOperationsWindowRequest): Promise<BatchOperationsRead>;
}

const resultCountsSchema = z.object({
  succeeded: countSchema,
  waitingRemote: countSchema,
  retryable: countSchema,
  outcomeUnknown: countSchema,
  manual: countSchema,
  failedFinal: countSchema,
}).strict();

/** One batch list row. Rule and account labels are null where no Host fact describes them. */
export const batchOperationListItemSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(500),
  ruleLabel: z.string().min(1).max(500).nullable(),
  targetCount: countSchema,
  platform: z.string().min(1).max(500).nullable(),
  account: z.string().min(1).max(500).nullable(),
  createdLabel: z.string().min(1).max(64),
  completedOn: z.iso.date().nullable(),
  phase: batchOperationPhaseSchema,
  progressPercent: z.number().int().min(0).max(100),
  highRisk: z.boolean(),
  plannedCounts: z.object({ automatic: countSchema, manual: countSchema, conflict: countSchema }).strict().nullable(),
  resultCounts: resultCountsSchema.nullable(),
}).strict();

export const batchOperationListViewModelSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("batch_operation_list"),
  /** Whether new plans can be generated; "unavailable" until an operation capability is qualified. */
  creationAvailability: z.enum(["available", "unavailable"]),
  items: z.array(batchOperationListItemSchema).max(1_000_200),
}).strict();

export type BatchOperationListItem = z.infer<typeof batchOperationListItemSchema>;
export type BatchOperationListViewModel = z.infer<typeof batchOperationListViewModelSchema>;

const providerNames: Readonly<Record<BatchOperationRow["providerKinds"][number], string>> = {
  afternic: "Afternic",
  atom: "Atom",
  cloudflare: "Cloudflare",
  dynadot: "Dynadot",
  godaddy: "GoDaddy",
  namecheap: "Namecheap",
  porkbun: "Porkbun",
  spaceship: "Spaceship",
};

/** The execution phase wins once an operation exists; an unexecuted plan reports its own phase. */
function batchPhase(row: BatchOperationRow): BatchOperationListItem["phase"] {
  if (row.operationPhase !== null) return row.operationPhase;
  switch (row.planPhase) {
    case "planned": return "planned";
    case "awaiting_approval": return "awaiting_approval";
    case "approved": return "queued";
    case "executing": return "running";
    case "completed": return "completed";
    case "cancelled":
    case "expired": return "cancelled";
  }
}

/** Share of attempted items whose latest attempt left the queue; zero before any operation. */
function progressPercent(row: BatchOperationRow): number {
  const results = row.results;
  const included = row.planned.automatic + row.planned.manual;
  if (results === null || included === 0) return 0;
  const settled = results.succeeded + results.waitingRemote + results.manualActionRequired
    + results.failedRetryable + results.outcomeUnknown + results.failedFinal + results.cancelled + results.rolledBack;
  return Math.min(100, Math.floor((settled * 100) / included));
}

/**
 * Projects complete Host batch windows into the batch list. Every window must come from one Host
 * generation and together cover every plan. Row keys are scoped to this read, never plan
 * identifiers, and creation stays unavailable: no operation capability is qualified yet.
 */
export function projectBatchOperationList(windows: readonly BatchOperationsRead[]): BatchOperationListViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("batch operations need at least one Host window");
  let expectedStart = 0;
  for (const window of windows) {
    if (window.readGeneration !== first.readGeneration || window.totalRows !== first.totalRows
      || window.window.startIndex !== expectedStart) {
      throw new TypeError("batch windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart !== first.totalRows) throw new TypeError("batch windows must cover every plan");
  const rows = windows.flatMap((window) => window.window.rows);
  return batchOperationListViewModelSchema.parse({
    schemaVersion: 1,
    kind: "batch_operation_list",
    creationAvailability: "unavailable",
    items: rows.map((row, index): BatchOperationListItem => {
      const phase = batchPhase(row);
      return {
        id: `batch-${index}`,
        title: row.title,
        ruleLabel: null,
        targetCount: row.targetCount,
        platform: row.providerKinds.length === 0 ? null : row.providerKinds.map((kind) => providerNames[kind]).join(" / "),
        account: null,
        createdLabel: row.createdAt.slice(0, 10),
        completedOn: row.completedAt === null ? null : row.completedAt.slice(0, 10),
        phase,
        progressPercent: progressPercent(row),
        highRisk: row.riskLevel === "high" || row.planned.highRisk > 0,
        plannedCounts: phase === "planned" || phase === "awaiting_approval"
          ? { automatic: row.planned.automatic, manual: row.planned.manual, conflict: row.planned.conflict }
          : null,
        resultCounts: row.results === null ? null : {
          succeeded: row.results.succeeded,
          waitingRemote: row.results.waitingRemote,
          retryable: row.results.failedRetryable,
          outcomeUnknown: row.results.outcomeUnknown,
          manual: row.results.manualActionRequired,
          failedFinal: row.results.failedFinal,
        },
      };
    }),
  });
}
