import { z } from "zod";

import {
  operationDigestSchema,
  operationIdentifierSchema,
  type AssetProtectionIncidentViewModel,
  type BatchOperationViewModel,
  type ManualTaskView,
  type OperationHistoryEntry,
} from "./contracts";

export const approveBatchCommandSchema = z
  .object({
    kind: z.literal("approve_batch"),
    batchId: operationIdentifierSchema,
    planId: operationIdentifierSchema,
    planHash: operationDigestSchema,
    confirmedItemCount: z.number().int().positive().max(100_000),
    highRiskAcknowledged: z.boolean(),
  })
  .strict();

export const batchActionCommandSchema = z
  .object({ batchId: operationIdentifierSchema, action: z.enum(["cancel", "retry_failed", "check_unknown"]) })
  .strict();

export const manualTaskCommandSchema = z
  .object({
    manualTaskId: operationIdentifierSchema,
    taskRevision: z.number().int().positive(),
    action: z.enum(["open_platform", "mark_user_operation_done", "request_recheck", "cancel"]),
  })
  .strict();

export const acceptManualTaskRiskCommandSchema = z
  .object({
    manualTaskId: operationIdentifierSchema,
    taskRevision: z.number().int().positive(),
    unresolvedImpactDigest: operationDigestSchema,
    reason: z.string().min(1).max(2_000),
    acknowledged: z.literal(true),
    reauthProofId: operationIdentifierSchema.nullable(),
  })
  .strict();

export const planReversalCommandSchema = z
  .object({
    kind: z.literal("plan_reversal"),
    revisionId: operationIdentifierSchema,
    itemCount: z.number().int().positive().max(100_000),
    nameserverRiskAcknowledged: z.boolean(),
  })
  .strict();

export const recoveryCheckCommandSchema = z
  .object({ kind: z.literal("check_platform_state"), attemptId: operationIdentifierSchema })
  .strict();

export const protectionListingCommandSchema = z
  .object({
    incidentId: operationIdentifierSchema,
    incidentRevision: z.number().int().positive(),
    listingId: operationIdentifierSchema,
    action: z.enum(["approve_delist", "open_manual_site", "check_platform_state", "retry_delist"]),
  })
  .strict();

export const closeProtectionIncidentCommandSchema = z
  .object({
    incidentId: operationIdentifierSchema,
    incidentRevision: z.number().int().positive(),
    kind: z.enum(["close_confirmed", "close_with_residual_risk"]),
    unresolvedListingCount: z.number().int().nonnegative().max(1_000),
    unresolvedImpactDigest: operationDigestSchema.nullable(),
    reason: z.string().min(1).max(2_000).nullable(),
    residualRiskAcknowledged: z.boolean(),
    reauthProofId: operationIdentifierSchema.nullable(),
  })
  .strict();

export type ApproveBatchCommand = z.infer<typeof approveBatchCommandSchema>;
export type BatchActionCommand = z.infer<typeof batchActionCommandSchema>;
export type ManualTaskCommand = z.infer<typeof manualTaskCommandSchema>;
export type AcceptManualTaskRiskCommand = z.infer<typeof acceptManualTaskRiskCommandSchema>;
export type PlanReversalCommand = z.infer<typeof planReversalCommandSchema>;
export type RecoveryCheckCommand = z.infer<typeof recoveryCheckCommandSchema>;
export type ProtectionListingCommand = z.infer<typeof protectionListingCommandSchema>;
export type CloseProtectionIncidentCommand = z.infer<typeof closeProtectionIncidentCommandSchema>;

export function createApproveBatchCommand(
  view: BatchOperationViewModel,
  highRiskAcknowledged: boolean,
): ApproveBatchCommand | null {
  if (!view.availableActions.includes("approve")) return null;
  if (view.summary.highRiskCount > 0 && !highRiskAcknowledged) return null;
  return approveBatchCommandSchema.parse({
    kind: "approve_batch",
    batchId: view.batchId,
    planId: view.planId,
    planHash: view.planHash,
    confirmedItemCount: view.itemWindow.totalItems,
    highRiskAcknowledged,
  });
}

export function createManualTaskRiskCommand(
  task: ManualTaskView,
  reason: string,
  acknowledged: boolean,
  reauthProofId: string | null,
): AcceptManualTaskRiskCommand | null {
  if (
    !acknowledged ||
    !task.availableActions.includes("accept_residual_risk") ||
    task.unresolvedImpactDigest === null
  ) return null;
  if (task.riskAcceptancePolicy === "fresh_reauth_required" && reauthProofId === null) return null;
  return acceptManualTaskRiskCommandSchema.parse({
    manualTaskId: task.id,
    taskRevision: task.revision,
    unresolvedImpactDigest: task.unresolvedImpactDigest,
    reason,
    acknowledged: true,
    reauthProofId,
  });
}

export function createPlanReversalCommand(
  entry: OperationHistoryEntry,
  nameserverRiskAcknowledged: boolean,
): PlanReversalCommand | null {
  if (!entry.availableActions.includes("plan_reversal")) return null;
  if (entry.risk === "nameserver_high" && !nameserverRiskAcknowledged) return null;
  return planReversalCommandSchema.parse({
    kind: "plan_reversal",
    revisionId: entry.revisionId,
    itemCount: entry.itemCount,
    nameserverRiskAcknowledged,
  });
}

export function createCloseProtectionIncidentCommand(
  view: AssetProtectionIncidentViewModel,
  input: {
    readonly reason: string | null;
    readonly residualRiskAcknowledged: boolean;
    readonly reauthProofId: string | null;
  },
): CloseProtectionIncidentCommand | null {
  const unresolvedListingCount = view.listings.filter(
    (listing) => listing.role === "delist_target" && listing.state !== "confirmed",
  ).length;
  const kind = view.availableActions[0];
  if (kind === undefined) return null;
  if (kind === "close_with_residual_risk") {
    if (!input.residualRiskAcknowledged || view.unresolvedImpactDigest === null || input.reason === null) return null;
    if (view.residualRiskPolicy === "fresh_reauth_required" && input.reauthProofId === null) return null;
  }
  return closeProtectionIncidentCommandSchema.parse({
    incidentId: view.incidentId,
    incidentRevision: view.incidentRevision,
    kind,
    unresolvedListingCount,
    unresolvedImpactDigest: kind === "close_with_residual_risk" ? view.unresolvedImpactDigest : null,
    reason: kind === "close_with_residual_risk" ? input.reason : null,
    residualRiskAcknowledged: kind === "close_with_residual_risk",
    reauthProofId: kind === "close_with_residual_risk" ? input.reauthProofId : null,
  });
}
