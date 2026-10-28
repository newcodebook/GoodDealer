import type { BatchOperationViewModel } from "@gooddealer/client-core";

export type BatchPhase = BatchOperationViewModel["phase"];

/**
 * One row of the batch list. The Host exposes only a single batch projection today, so this list
 * shape is Desktop-local and supplied by the mock design host until a list contract exists.
 */
export interface BatchJobSummary {
  readonly id: string;
  readonly title: string;
  readonly ruleLabel: string;
  readonly targetCount: number;
  readonly platform: string;
  readonly account: string;
  readonly createdLabel: string;
  readonly phase: BatchPhase;
  readonly progressPercent: number;
  readonly highRisk: boolean;
  readonly plannedCounts: { readonly automatic: number; readonly manual: number; readonly conflict: number } | null;
  readonly resultCounts: BatchResultCounts | null;
}

/** Per-outcome totals for a running or finished batch; not yet part of the Host projection. */
export interface BatchResultCounts {
  readonly succeeded: number;
  readonly waitingRemote: number;
  readonly retryable: number;
  readonly outcomeUnknown: number;
  readonly manual: number;
  readonly failedFinal: number;
}

export interface BatchExecutionProgress {
  readonly percent: number;
  readonly counts: BatchResultCounts;
  readonly throughputLabel: string | null;
  readonly operationId: string | null;
}

export type BatchDetailMode = "plan" | "run" | "result";

export function batchDetailMode(phase: BatchPhase): BatchDetailMode {
  if (phase === "planned" || phase === "awaiting_approval") return "plan";
  if (phase === "queued" || phase === "running") return "run";
  return "result";
}

export type BatchPhaseTone = "warning" | "sync" | "success" | "danger" | "neutral";

export function batchPhaseTone(phase: BatchPhase): BatchPhaseTone {
  switch (phase) {
    case "planned":
    case "awaiting_approval": return "warning";
    case "queued":
    case "running": return "sync";
    case "completed": return "success";
    case "partially_failed": return "danger";
    case "rolled_back":
    case "cancelled": return "neutral";
  }
}
