import { z } from "zod";

import {
  browserAutomationGrantSchema,
  browserExecutionTaskSchema,
} from "../browser-automation/index";

export const operationIdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const operationDigestSchema = z.string().length(64).regex(/^[a-f0-9]+$/u);
export const operationQuerySourceSchema = z.enum(["active_local", "standby_cloud"]);
export const operationCommandAdmissionSchema = z.enum(["proven", "unavailable"]);

const displayTextSchema = z.string().min(1).max(500);
const domainSchema = z.string().min(1).max(253);

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function addActionIssue(context: z.RefinementCtx, actual: readonly string[], expected: readonly string[]): void {
  if (!sameMembers(actual, expected) || new Set(actual).size !== actual.length) {
    context.addIssue({
      code: "custom",
      path: ["availableActions"],
      message: "actions do not match the authoritative state",
    });
  }
}

function canIssueCommands(source: "active_local" | "standby_cloud", admission: "proven" | "unavailable") {
  return source === "active_local" && admission === "proven";
}

export const batchOperationPhaseSchema = z.enum([
  "planned",
  "awaiting_approval",
  "queued",
  "running",
  "completed",
  "partially_failed",
  "rolled_back",
  "cancelled",
]);

export const batchOperationItemResultSchema = z.enum([
  "planned",
  "queued",
  "running",
  "succeeded",
  "waiting_remote",
  "manual_action_required",
  "failed_retryable",
  "outcome_unknown",
  "failed_final",
  "excluded",
  "cancelled",
  "rolled_back",
]);

export const batchOperationActionSchema = z.enum(["approve", "cancel", "retry_failed", "check_unknown"]);

export const batchOperationGroupSchema = z
  .object({
    id: operationIdentifierSchema,
    platform: displayTextSchema,
    account: displayTextSchema,
    actionLabel: displayTextSchema,
    itemCount: z.number().int().positive().max(100_000),
    result: batchOperationItemResultSchema,
  })
  .strict();

export const batchOperationItemSchema = z
  .object({
    id: operationIdentifierSchema,
    domain: domainSchema,
    platform: displayTextSchema,
    account: displayTextSchema,
    fieldLabel: displayTextSchema,
    oldValue: z.string().max(2_000).nullable(),
    newValue: z.string().max(2_000).nullable(),
    sourceLabel: displayTextSchema,
    risk: z.enum(["standard", "high"]),
    executionMode: z.enum(["automatic", "manual", "unsupported"]),
    result: batchOperationItemResultSchema,
    detail: z.string().max(2_000).nullable(),
  })
  .strict();

export const batchOperationViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("batch_operation"),
    batchId: operationIdentifierSchema,
    planId: operationIdentifierSchema,
    planHash: operationDigestSchema,
    title: displayTextSchema,
    createdAt: z.iso.datetime(),
    source: operationQuerySourceSchema,
    commandAdmission: operationCommandAdmissionSchema,
    phase: batchOperationPhaseSchema,
    summary: z
      .object({
        targetDomainCount: z.number().int().positive().max(10_000),
        platformCount: z.number().int().positive().max(1_000),
        requestOrFileCount: z.number().int().positive().max(100_000),
        automaticCount: z.number().int().nonnegative().max(100_000),
        manualCount: z.number().int().nonnegative().max(100_000),
        conflictCount: z.number().int().nonnegative().max(100_000),
        unsupportedCount: z.number().int().nonnegative().max(100_000),
        highRiskCount: z.number().int().nonnegative().max(100_000),
        retryableCount: z.number().int().nonnegative().max(100_000),
        outcomeUnknownCount: z.number().int().nonnegative().max(100_000),
        estimatedDurationLabel: displayTextSchema,
      })
      .strict(),
    groups: z.array(batchOperationGroupSchema).min(1).max(2_000),
    itemWindow: z
      .object({
        totalItems: z.number().int().positive().max(100_000),
        startIndex: z.number().int().nonnegative().max(99_999),
        items: z.array(batchOperationItemSchema).max(200),
      })
      .strict(),
    availableActions: z.array(batchOperationActionSchema).max(4),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.source === "standby_cloud" && view.commandAdmission === "proven") {
      context.addIssue({ code: "custom", path: ["commandAdmission"], message: "Standby cannot admit commands" });
    }
    if (view.itemWindow.startIndex + view.itemWindow.items.length > view.itemWindow.totalItems) {
      context.addIssue({ code: "custom", path: ["itemWindow"], message: "item window exceeds total" });
    }
    const expected: string[] = [];
    if (canIssueCommands(view.source, view.commandAdmission)) {
      if (view.phase === "awaiting_approval") expected.push("approve", "cancel");
      else if (["planned", "queued", "running"].includes(view.phase)) expected.push("cancel");
      else if (view.phase === "partially_failed") {
        if (view.summary.retryableCount > 0) expected.push("retry_failed");
        if (view.summary.outcomeUnknownCount > 0) expected.push("check_unknown");
      }
    }
    addActionIssue(context, view.availableActions, expected);
    if (
      view.phase === "completed" &&
      view.itemWindow.items.some((item) => item.result !== "succeeded" && item.result !== "excluded")
    ) {
      context.addIssue({ code: "custom", path: ["phase"], message: "completed batches cannot contain unresolved items" });
    }
    if (view.phase === "partially_failed" && view.summary.retryableCount + view.summary.outcomeUnknownCount === 0) {
      context.addIssue({ code: "custom", path: ["summary"], message: "partial failure needs a retryable or unknown result" });
    }
  });

export const manualTaskStatusSchema = z.enum([
  "open",
  "awaiting_user",
  "verification_pending",
  "confirmed_completed",
  "cancelled",
  "risk_accepted",
]);

export const riskAcceptancePolicySchema = z.enum(["forbidden", "allowed", "fresh_reauth_required"]);

export const manualTaskActionSchema = z.enum([
  "open_platform",
  "request_automation_grant",
  "mark_user_operation_done",
  "request_recheck",
  "cancel",
  "accept_residual_risk",
]);

export const manualTaskViewSchema = z
  .object({
    id: operationIdentifierSchema,
    revision: z.number().int().positive(),
    operationPlanId: operationIdentifierSchema,
    title: displayTextSchema,
    priority: z.enum(["high", "normal", "low"]),
    status: manualTaskStatusSchema,
    platform: displayTextSchema,
    account: displayTextSchema,
    reason: displayTextSchema,
    affectedDomains: z.array(domainSchema).min(1).max(10_000),
    preparedArtifactLabel: z.string().max(500).nullable(),
    completionCondition: displayTextSchema,
    lastCheckedAt: z.iso.datetime().nullable(),
    checklist: z
      .array(
        z
          .object({
            id: operationIdentifierSchema,
            label: displayTextSchema,
            state: z.enum(["pending", "completed", "not_applicable"]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    riskAcceptancePolicy: riskAcceptancePolicySchema,
    unresolvedImpactDigest: operationDigestSchema.nullable(),
    browserGrant: browserAutomationGrantSchema.nullable(),
    browserTask: browserExecutionTaskSchema.nullable(),
    availableActions: z.array(manualTaskActionSchema).max(6),
  })
  .strict();

export const manualTaskInboxViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("manual_task_inbox"),
    source: operationQuerySourceSchema,
    commandAdmission: operationCommandAdmissionSchema,
    selectedTaskId: operationIdentifierSchema.nullable(),
    tasks: z.array(manualTaskViewSchema).max(10_000),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.source === "standby_cloud" && view.commandAdmission === "proven") {
      context.addIssue({ code: "custom", path: ["commandAdmission"], message: "Standby cannot admit commands" });
    }
    const ids = new Set(view.tasks.map((task) => task.id));
    if (ids.size !== view.tasks.length || (view.selectedTaskId !== null && !ids.has(view.selectedTaskId))) {
      context.addIssue({ code: "custom", path: ["tasks"], message: "tasks and selection must be unique and consistent" });
    }
    for (const [index, task] of view.tasks.entries()) {
      if (task.browserGrant !== null && task.browserGrant.operationPlanId !== task.operationPlanId) {
        context.addIssue({ code: "custom", path: ["tasks", index, "browserGrant"], message: "grant must bind this task plan" });
      }
      if (task.riskAcceptancePolicy === "forbidden" && task.unresolvedImpactDigest !== null) {
        context.addIssue({ code: "custom", path: ["tasks", index, "unresolvedImpactDigest"], message: "forbidden policy cannot expose risk acceptance data" });
      }
      if (task.riskAcceptancePolicy !== "forbidden" && task.unresolvedImpactDigest === null) {
        context.addIssue({ code: "custom", path: ["tasks", index, "unresolvedImpactDigest"], message: "risk acceptance requires an impact digest" });
      }
      const expected: string[] = [];
      const nonTerminal = ["open", "awaiting_user", "verification_pending"].includes(task.status);
      if (nonTerminal && canIssueCommands(view.source, view.commandAdmission)) {
        expected.push("open_platform", "request_recheck", "cancel");
        if (task.status !== "verification_pending") expected.push("mark_user_operation_done");
        if (task.browserGrant !== null) expected.push("request_automation_grant");
        if (task.riskAcceptancePolicy !== "forbidden") expected.push("accept_residual_risk");
      }
      if (!sameMembers(task.availableActions, expected) || new Set(task.availableActions).size !== task.availableActions.length) {
        context.addIssue({ code: "custom", path: ["tasks", index, "availableActions"], message: "task actions do not match policy and state" });
      }
    }
  });

export const operationHistoryEntryStateSchema = z.enum([
  "applied",
  "synced",
  "rolled_back",
  "cloud_pull",
  "device_event",
  "late_execution",
]);

export const operationHistoryDiffSchema = z
  .object({
    entityLabel: displayTextSchema,
    fieldLabel: displayTextSchema,
    oldValue: z.string().max(2_000).nullable(),
    newValue: z.string().max(2_000).nullable(),
  })
  .strict();

export const operationHistoryEntrySchema = z
  .object({
    revisionId: operationIdentifierSchema,
    revisionLabel: displayTextSchema,
    occurredAt: z.iso.datetime(),
    actorLabel: displayTextSchema,
    scope: z.enum(["batch", "single_domain", "system", "sync"]),
    actionLabel: displayTextSchema,
    platformLabel: displayTextSchema,
    itemCount: z.number().int().positive().max(100_000),
    state: operationHistoryEntryStateSchema,
    risk: z.enum(["standard", "nameserver_high"]),
    diffs: z.array(operationHistoryDiffSchema).max(200),
    reversible: z.boolean(),
    availableActions: z.array(z.literal("plan_reversal")).max(1),
    lateExecution: z
      .object({
        sourceDeviceLabel: displayTextSchema,
        leaseEpoch: z.number().int().nonnegative(),
        receivedAt: z.iso.datetime(),
        evidenceLevel: z.enum(["reported", "provider_observed", "confirmed"]),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const operationHistoryViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("operation_history"),
    source: operationQuerySourceSchema,
    commandAdmission: operationCommandAdmissionSchema,
    selectedRevisionId: operationIdentifierSchema.nullable(),
    totalRevisions: z.number().int().nonnegative(),
    changesToday: z.number().int().nonnegative(),
    pendingRevisionCount: z.number().int().nonnegative(),
    entries: z.array(operationHistoryEntrySchema).max(500),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.source === "standby_cloud" && view.commandAdmission === "proven") {
      context.addIssue({ code: "custom", path: ["commandAdmission"], message: "Standby cannot admit commands" });
    }
    const ids = new Set(view.entries.map((entry) => entry.revisionId));
    if (ids.size !== view.entries.length || (view.selectedRevisionId !== null && !ids.has(view.selectedRevisionId))) {
      context.addIssue({ code: "custom", path: ["entries"], message: "history entries and selection must be consistent" });
    }
    for (const [index, entry] of view.entries.entries()) {
      const expected = entry.reversible && canIssueCommands(view.source, view.commandAdmission) ? ["plan_reversal"] : [];
      if (!sameMembers(entry.availableActions, expected)) {
        context.addIssue({ code: "custom", path: ["entries", index, "availableActions"], message: "history actions do not match reversibility" });
      }
      const isLate = entry.state === "late_execution";
      if (isLate !== (entry.lateExecution !== null) || (isLate && entry.reversible)) {
        context.addIssue({ code: "custom", path: ["entries", index, "lateExecution"], message: "late execution facts are read-only and require provenance" });
      }
      if (["rolled_back", "cloud_pull", "device_event", "late_execution"].includes(entry.state) && entry.reversible) {
        context.addIssue({ code: "custom", path: ["entries", index, "reversible"], message: "entry state cannot be reversed" });
      }
    }
  });

export const startupRecoveryBucketSchema = z.enum(["confirmed", "safe_retry", "outcome_unknown", "waiting_remote"]);

export const startupRecoveryItemSchema = z
  .object({
    attemptId: operationIdentifierSchema,
    operationLabel: displayTextSchema,
    accountLabel: displayTextSchema,
    reason: displayTextSchema,
    reconciliation: z.enum(["unchecked", "checking", "reconciled"]),
    availableActions: z.array(z.literal("check_platform_state")).max(1),
  })
  .strict();

export const startupRecoveryViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("startup_recovery"),
    source: z.literal("active_local"),
    commandAdmission: operationCommandAdmissionSchema,
    scanCompletedAt: z.iso.datetime(),
    scannedAttemptCount: z.number().int().nonnegative(),
    buckets: z
      .object({
        confirmed: z.number().int().nonnegative(),
        safeRetry: z.number().int().nonnegative(),
        outcomeUnknown: z.number().int().nonnegative(),
        waitingRemote: z.number().int().nonnegative(),
      })
      .strict(),
    outcomeUnknownItems: z.array(startupRecoveryItemSchema).max(200),
    workerBarrier: z.enum(["blocked", "ready"]),
    availableActions: z.array(z.literal("continue_after_reconciliation")).max(1),
  })
  .strict()
  .superRefine((view, context) => {
    const total = view.buckets.confirmed + view.buckets.safeRetry + view.buckets.outcomeUnknown + view.buckets.waitingRemote;
    if (total !== view.scannedAttemptCount || view.buckets.outcomeUnknown !== view.outcomeUnknownItems.length) {
      context.addIssue({ code: "custom", path: ["buckets"], message: "recovery bucket counts must reconcile" });
    }
    const allReconciled = view.outcomeUnknownItems.every((item) => item.reconciliation === "reconciled");
    if ((view.workerBarrier === "ready") !== allReconciled) {
      context.addIssue({ code: "custom", path: ["workerBarrier"], message: "worker remains blocked until every unknown outcome is reconciled" });
    }
    const canCommand = view.commandAdmission === "proven";
    for (const [index, item] of view.outcomeUnknownItems.entries()) {
      const expected = canCommand && item.reconciliation === "unchecked" ? ["check_platform_state"] : [];
      if (!sameMembers(item.availableActions, expected)) {
        context.addIssue({ code: "custom", path: ["outcomeUnknownItems", index, "availableActions"], message: "unknown outcomes are check-only" });
      }
    }
    const expected = canCommand && view.workerBarrier === "ready" ? ["continue_after_reconciliation"] : [];
    addActionIssue(context, view.availableActions, expected);
  });

export const protectionListingStateSchema = z.enum([
  "prepared",
  "executing",
  "remote_pending",
  "manual_open",
  "checking",
  "outcome_unknown",
  "failed_retryable",
  "confirmed",
]);

export const protectionListingActionSchema = z.enum([
  "approve_delist",
  "open_manual_site",
  "check_platform_state",
  "retry_delist",
]);

export const protectionListingSchema = z
  .object({
    id: operationIdentifierSchema,
    role: z.enum(["sale_source", "delist_target"]),
    platform: displayTextSchema,
    account: displayTextSchema,
    method: z.enum(["api", "manual"]),
    state: protectionListingStateSchema,
    detail: z.string().max(2_000).nullable(),
    availableActions: z.array(protectionListingActionSchema).max(1),
  })
  .strict();

export const assetProtectionIncidentViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("asset_protection_incident"),
    source: z.literal("active_local"),
    commandAdmission: operationCommandAdmissionSchema,
    incidentId: operationIdentifierSchema,
    incidentRevision: z.number().int().positive(),
    incidentStatus: z.enum(["open", "closed_confirmed", "closed_risk_accepted"]),
    domain: domainSchema,
    saleSignalSourceLabel: displayTextSchema,
    detectedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    soldOn: z.iso.date(),
    soldAmount: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/u),
        amount: z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{1,8})?$/u),
      })
      .strict(),
    listings: z.array(protectionListingSchema).min(1).max(1_000),
    residualRiskPolicy: riskAcceptancePolicySchema,
    unresolvedImpactDigest: operationDigestSchema.nullable(),
    availableActions: z.array(z.enum(["close_confirmed", "close_with_residual_risk"])).max(1),
    closedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const targets = view.listings.filter((listing) => listing.role === "delist_target");
    if (targets.length === 0 || view.listings.filter((listing) => listing.role === "sale_source").length !== 1) {
      context.addIssue({ code: "custom", path: ["listings"], message: "incident needs one sale source and at least one delist target" });
    }
    const inFlight = targets.filter((listing) => ["executing", "checking"].includes(listing.state));
    if (inFlight.length > 1) {
      context.addIssue({ code: "custom", path: ["listings"], message: "delisting approval is sequential" });
    }
    const canCommand = view.commandAdmission === "proven" && view.incidentStatus === "open";
    for (const [index, listing] of view.listings.entries()) {
      const expected: string[] = [];
      if (canCommand && listing.role === "delist_target" && inFlight.length === 0) {
        if (listing.state === "prepared") expected.push(listing.method === "manual" ? "open_manual_site" : "approve_delist");
        else if (["manual_open", "remote_pending", "outcome_unknown"].includes(listing.state)) expected.push("check_platform_state");
        else if (listing.state === "failed_retryable") expected.push("retry_delist");
      }
      if (!sameMembers(listing.availableActions, expected)) {
        context.addIssue({ code: "custom", path: ["listings", index, "availableActions"], message: "listing actions do not match state" });
      }
    }
    const allConfirmed = targets.length > 0 && targets.every((listing) => listing.state === "confirmed");
    const expectedIncidentActions: string[] = [];
    if (canCommand && inFlight.length === 0) {
      if (allConfirmed) expectedIncidentActions.push("close_confirmed");
      else if (view.residualRiskPolicy !== "forbidden") expectedIncidentActions.push("close_with_residual_risk");
    }
    addActionIssue(context, view.availableActions, expectedIncidentActions);
    if (view.residualRiskPolicy === "forbidden" && view.unresolvedImpactDigest !== null) {
      context.addIssue({ code: "custom", path: ["unresolvedImpactDigest"], message: "forbidden policy cannot expose a risk-close digest" });
    }
    if (view.residualRiskPolicy !== "forbidden" && view.unresolvedImpactDigest === null) {
      context.addIssue({ code: "custom", path: ["unresolvedImpactDigest"], message: "risk closure requires the exact unresolved impact digest" });
    }
    if ((view.incidentStatus === "open") !== (view.closedAt === null)) {
      context.addIssue({ code: "custom", path: ["closedAt"], message: "incident closure time must match status" });
    }
    if (view.incidentStatus === "closed_confirmed" && !allConfirmed) {
      context.addIssue({ code: "custom", path: ["incidentStatus"], message: "clean closure requires every target confirmed" });
    }
  });

export type BatchOperationPhase = z.infer<typeof batchOperationPhaseSchema>;
export type BatchOperationAction = z.infer<typeof batchOperationActionSchema>;
export type BatchOperationItem = z.infer<typeof batchOperationItemSchema>;
export type BatchOperationViewModel = z.infer<typeof batchOperationViewModelSchema>;
export type ManualTaskStatus = z.infer<typeof manualTaskStatusSchema>;
export type RiskAcceptancePolicy = z.infer<typeof riskAcceptancePolicySchema>;
export type ManualTaskAction = z.infer<typeof manualTaskActionSchema>;
export type ManualTaskView = z.infer<typeof manualTaskViewSchema>;
export type ManualTaskInboxViewModel = z.infer<typeof manualTaskInboxViewModelSchema>;
export type OperationHistoryEntry = z.infer<typeof operationHistoryEntrySchema>;
export type OperationHistoryViewModel = z.infer<typeof operationHistoryViewModelSchema>;
export type StartupRecoveryItem = z.infer<typeof startupRecoveryItemSchema>;
export type StartupRecoveryViewModel = z.infer<typeof startupRecoveryViewModelSchema>;
export type ProtectionListing = z.infer<typeof protectionListingSchema>;
export type AssetProtectionIncidentViewModel = z.infer<typeof assetProtectionIncidentViewModelSchema>;

function parseWithoutEcho<Schema extends z.ZodType>(schema: Schema, input: unknown, message: string): z.infer<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new TypeError(message);
  return parsed.data;
}

export function parseBatchOperationViewModel(input: unknown): BatchOperationViewModel {
  return parseWithoutEcho(batchOperationViewModelSchema, input, "invalid batch operation projection");
}

export function parseManualTaskInboxViewModel(input: unknown): ManualTaskInboxViewModel {
  return parseWithoutEcho(manualTaskInboxViewModelSchema, input, "invalid manual task inbox projection");
}

export function parseOperationHistoryViewModel(input: unknown): OperationHistoryViewModel {
  return parseWithoutEcho(operationHistoryViewModelSchema, input, "invalid operation history projection");
}

export function parseStartupRecoveryViewModel(input: unknown): StartupRecoveryViewModel {
  return parseWithoutEcho(startupRecoveryViewModelSchema, input, "invalid startup recovery projection");
}

export function parseAssetProtectionIncidentViewModel(input: unknown): AssetProtectionIncidentViewModel {
  return parseWithoutEcho(assetProtectionIncidentViewModelSchema, input, "invalid asset protection incident projection");
}
