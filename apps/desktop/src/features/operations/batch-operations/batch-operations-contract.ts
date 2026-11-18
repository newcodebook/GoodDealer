import type { BatchOperationListItem } from "@gooddealer/client-core";

/** List phases; a batch detail's phases are a subset of these. */
export type BatchPhase = BatchOperationListItem["phase"];

/** One row of the batch list, from the client-core list contract the Host projection fills. */
export type BatchJobSummary = BatchOperationListItem;

/** Per-outcome totals for a running or finished batch. */
export type BatchResultCounts = NonNullable<BatchOperationListItem["resultCounts"]>;

export interface BatchExecutionProgress {
  readonly percent: number;
  readonly counts: BatchResultCounts;
  readonly throughputLabel: string | null;
  readonly operationId: string | null;
}

export type BatchDetailMode = "plan" | "run" | "result";

export function batchDetailMode(phase: BatchPhase): BatchDetailMode {
  if (phase === "planned" || phase === "awaiting_approval" || phase === "approved") return "plan";
  if (phase === "queued" || phase === "running") return "run";
  return "result";
}

export type BatchPhaseTone = "warning" | "sync" | "success" | "danger" | "neutral";

export function batchPhaseTone(phase: BatchPhase): BatchPhaseTone {
  switch (phase) {
    case "planned":
    case "awaiting_approval":
    case "approved": return "warning";
    case "queued":
    case "running": return "sync";
    case "completed": return "success";
    case "partially_failed": return "danger";
    case "rolled_back":
    case "cancelled":
    case "expired": return "neutral";
  }
}
