import { describe, expect, expectTypeOf, it } from "vitest";

import type { BrowserAutomationGrantPort } from "../browser-automation/index";
import {
  ValidatingOperationsPresentationPort,
  assetProtectionIncidentViewModelSchema,
  batchOperationViewModelSchema,
  createApproveBatchCommand,
  createCloseProtectionIncidentCommand,
  createManualTaskRiskCommand,
  createPlanReversalCommand,
  manualTaskInboxViewModelSchema,
  operationHistoryViewModelSchema,
  parseBatchOperationViewModel,
  startupRecoveryViewModelSchema,
  type AssetProtectionIncidentViewModel,
  type BatchOperationPhase,
  type BatchOperationViewModel,
  type ManualTaskBrowserGrantPort,
  type ManualTaskInboxViewModel,
  type OperationHistoryViewModel,
  type OperationsPresentationBoundary,
  type StartupRecoveryViewModel,
} from "./index";

const timestamp = "2026-08-17T06:00:00Z";
const digest = "a".repeat(64);

const phaseMatrix = {
  planned: { result: "planned", actions: ["cancel"], retryable: 0, unknown: 0 },
  awaiting_approval: { result: "planned", actions: ["approve", "cancel"], retryable: 0, unknown: 0 },
  queued: { result: "queued", actions: ["cancel"], retryable: 0, unknown: 0 },
  running: { result: "running", actions: ["cancel"], retryable: 0, unknown: 0 },
  completed: { result: "succeeded", actions: [], retryable: 0, unknown: 0 },
  partially_failed: {
    result: "outcome_unknown",
    actions: ["retry_failed", "check_unknown"],
    retryable: 1,
    unknown: 1,
  },
  rolled_back: { result: "rolled_back", actions: [], retryable: 0, unknown: 0 },
  cancelled: { result: "cancelled", actions: [], retryable: 0, unknown: 0 },
} as const;

function batch(phase: BatchOperationPhase): BatchOperationViewModel {
  const state = phaseMatrix[phase];
  return batchOperationViewModelSchema.parse({
    schemaVersion: 1,
    kind: "batch_operation",
    batchId: "batch-1",
    planId: "plan-1",
    planHash: digest,
    title: "Batch price update",
    createdAt: timestamp,
    source: "active_local",
    commandAdmission: "proven",
    phase,
    summary: {
      targetDomainCount: 1_000,
      platformCount: 4,
      requestOrFileCount: 4_000,
      automaticCount: 3_000,
      manualCount: 994,
      conflictCount: 6,
      unsupportedCount: 0,
      highRiskCount: 1,
      retryableCount: state.retryable,
      outcomeUnknownCount: state.unknown,
      estimatedDurationLabel: "18 min",
    },
    groups: [
      {
        id: "group-1",
        platform: "Atom",
        account: "Primary",
        actionLabel: "Change price",
        itemCount: 1_000,
        result: state.result,
      },
    ],
    itemWindow: {
      totalItems: 4_000,
      startIndex: 0,
      items: [
        {
          id: "item-1",
          domain: "vault.io",
          platform: "Atom",
          account: "Primary",
          fieldLabel: "BIN",
          oldValue: "3000.00",
          newValue: "2760.00",
          sourceLabel: "Rule -8%",
          risk: "high",
          executionMode: "automatic",
          result: state.result,
          detail: null,
        },
      ],
    },
    availableActions: state.actions,
  });
}

function grant(operationPlanId = "plan-1") {
  return {
    schemaVersion: 1,
    grantRequestId: "grant-1",
    providerConnectionId: "connection-1",
    browserSessionId: "session-1",
    operationPlanId,
    approvedPlanHash: digest,
    provider: "Afternic",
    accountAlias: "Primary",
    planItemCount: 12,
    planActionLabel: "Upload price CSV",
    allowedActions: ["click", "fill", "upload_csv", "read_result"],
    targetDomains: ["vault.io"],
    allowedHosts: ["*.afternic.com"],
    issuedAt: timestamp,
    expiresAt: "2026-08-17T06:10:00Z",
    requiresFinalConfirmation: true,
  } as const;
}

function inbox(options?: {
  readonly source?: "active_local" | "standby_cloud";
  readonly admission?: "proven" | "unavailable";
  readonly policy?: "forbidden" | "allowed" | "fresh_reauth_required";
  readonly status?: "open" | "awaiting_user" | "verification_pending" | "confirmed_completed" | "cancelled" | "risk_accepted";
  readonly withGrant?: boolean;
}): ManualTaskInboxViewModel {
  const source = options?.source ?? "active_local";
  const admission = options?.admission ?? "proven";
  const policy = options?.policy ?? "forbidden";
  const status = options?.status ?? "open";
  const withGrant = options?.withGrant ?? true;
  const actions: string[] = [];
  if (source === "active_local" && admission === "proven" && ["open", "awaiting_user", "verification_pending"].includes(status)) {
    actions.push("open_platform", "request_recheck", "cancel");
    if (status !== "verification_pending") actions.push("mark_user_operation_done");
    if (withGrant) actions.push("request_automation_grant");
    if (policy !== "forbidden") actions.push("accept_residual_risk");
  }
  return manualTaskInboxViewModelSchema.parse({
    schemaVersion: 1,
    kind: "manual_task_inbox",
    source,
    commandAdmission: admission,
    selectedTaskId: "task-1",
    tasks: [
      {
        id: "task-1",
        revision: 3,
        operationPlanId: "plan-1",
        title: "Upload price CSV",
        priority: "high",
        status,
        platform: "Afternic",
        account: "Primary",
        reason: "Provider requires an import flow",
        affectedDomains: ["vault.io"],
        preparedArtifactLabel: "prices.csv",
        completionCondition: "Provider import report is confirmed",
        lastCheckedAt: timestamp,
        checklist: [{ id: "step-1", label: "Open official site", state: "pending" }],
        riskAcceptancePolicy: policy,
        unresolvedImpactDigest: policy === "forbidden" ? null : digest,
        browserGrant: withGrant ? grant() : null,
        browserTask: null,
        availableActions: actions,
      },
    ],
  });
}

function history(source: "active_local" | "standby_cloud" = "active_local"): OperationHistoryViewModel {
  const active = source === "active_local";
  return operationHistoryViewModelSchema.parse({
    schemaVersion: 1,
    kind: "operation_history",
    source,
    commandAdmission: active ? "proven" : "unavailable",
    selectedRevisionId: "rev-8241",
    totalRevisions: 8_241,
    changesToday: 831,
    pendingRevisionCount: 2,
    entries: [
      {
        revisionId: "rev-8241",
        revisionLabel: "8,241",
        occurredAt: timestamp,
        actorLabel: "MacBook Pro",
        scope: "batch",
        actionLabel: "Batch price update",
        platformLabel: "Atom",
        itemCount: 799,
        state: "synced",
        risk: "nameserver_high",
        diffs: [{ entityLabel: "vault.io", fieldLabel: "BIN", oldValue: "3000", newValue: "2760" }],
        reversible: true,
        availableActions: active ? ["plan_reversal"] : [],
        lateExecution: null,
      },
      {
        revisionId: "fact-1",
        revisionLabel: "Late fact",
        occurredAt: timestamp,
        actorLabel: "Old Mac",
        scope: "system",
        actionLabel: "Late execution fact",
        platformLabel: "Atom",
        itemCount: 1,
        state: "late_execution",
        risk: "standard",
        diffs: [],
        reversible: false,
        availableActions: [],
        lateExecution: {
          sourceDeviceLabel: "Old Mac",
          leaseEpoch: 40,
          receivedAt: timestamp,
          evidenceLevel: "provider_observed",
        },
      },
    ],
  });
}

function recovery(reconciled = false): StartupRecoveryViewModel {
  return startupRecoveryViewModelSchema.parse({
    schemaVersion: 1,
    kind: "startup_recovery",
    source: "active_local",
    commandAdmission: "proven",
    scanCompletedAt: timestamp,
    scannedAttemptCount: 818,
    buckets: { confirmed: 812, safeRetry: 3, outcomeUnknown: 2, waitingRemote: 1 },
    outcomeUnknownItems: ["attempt-1", "attempt-2"].map((attemptId) => ({
      attemptId,
      operationLabel: "Afternic price CSV",
      accountLabel: "Primary",
      reason: "Request sent before process exit",
      reconciliation: reconciled ? "reconciled" : "unchecked",
      availableActions: reconciled ? [] : ["check_platform_state"],
    })),
    workerBarrier: reconciled ? "ready" : "blocked",
    availableActions: reconciled ? ["continue_after_reconciliation"] : [],
  });
}

function incident(
  state: "prepared" | "executing" | "remote_pending" | "manual_open" | "checking" | "outcome_unknown" | "failed_retryable" | "confirmed",
  policy: "forbidden" | "allowed" | "fresh_reauth_required" = "allowed",
): AssetProtectionIncidentViewModel {
  const listingAction =
    state === "prepared" ? ["approve_delist"]
      : ["remote_pending", "manual_open", "outcome_unknown"].includes(state) ? ["check_platform_state"]
        : state === "failed_retryable" ? ["retry_delist"] : [];
  const open = true;
  const closeActions = state === "confirmed" ? ["close_confirmed"] :
    ["executing", "checking"].includes(state) || policy === "forbidden" ? [] : ["close_with_residual_risk"];
  return assetProtectionIncidentViewModelSchema.parse({
    schemaVersion: 1,
    kind: "asset_protection_incident",
    source: "active_local",
    commandAdmission: "proven",
    incidentId: "incident-1",
    incidentRevision: 4,
    incidentStatus: open ? "open" : "closed_confirmed",
    domain: "vault.io",
    saleSignalSourceLabel: "User refresh · Atom",
    detectedAt: timestamp,
    createdAt: timestamp,
    soldOn: "2026-08-17",
    soldAmount: { currency: "USD", amount: "268000" },
    listings: [
      {
        id: "listing-source",
        role: "sale_source",
        platform: "Atom",
        account: "Primary",
        method: "api",
        state: "confirmed",
        detail: "Sold source",
        availableActions: [],
      },
      {
        id: "listing-target",
        role: "delist_target",
        platform: "Afternic",
        account: "Primary",
        method: "api",
        state,
        detail: null,
        availableActions: listingAction,
      },
    ],
    residualRiskPolicy: policy,
    unresolvedImpactDigest: policy === "forbidden" ? null : digest,
    availableActions: closeActions,
    closedAt: null,
  });
}

describe("batch operation contracts", () => {
  it.each(Object.keys(phaseMatrix) as BatchOperationPhase[])("enforces the %s action matrix", (phase) => {
    expect(batch(phase).availableActions).toEqual(phaseMatrix[phase].actions);
  });

  it("removes all command capabilities from Standby and unavailable projections", () => {
    const active = batch("awaiting_approval");
    expect(batchOperationViewModelSchema.parse({
      ...active,
      source: "standby_cloud",
      commandAdmission: "unavailable",
      availableActions: [],
    }).availableActions).toEqual([]);
    expect(batchOperationViewModelSchema.safeParse({ ...active, source: "standby_cloud" }).success).toBe(false);
  });

  it("binds approval to the exact plan and refuses an unacknowledged high-risk plan", () => {
    const view = batch("awaiting_approval");
    expect(createApproveBatchCommand(view, false)).toBeNull();
    expect(createApproveBatchCommand(view, true)).toMatchObject({
      batchId: "batch-1",
      planHash: digest,
      confirmedItemCount: 4_000,
    });
  });

  it("makes unknown outcomes check-only and never retryable", () => {
    const view = batch("partially_failed");
    expect(view.availableActions).toContain("check_unknown");
    expect(view.availableActions).not.toContain("approve");
    expect(view.itemWindow.items[0]?.result).toBe("outcome_unknown");
  });
});

describe("manual task policy contracts", () => {
  it("keeps a user completion claim in verification rather than success", () => {
    const view = inbox({ status: "verification_pending" });
    expect(view.tasks[0]?.status).toBe("verification_pending");
    expect(view.tasks[0]?.availableActions).not.toContain("mark_user_operation_done");
    expect(view.tasks[0]?.availableActions).toContain("request_recheck");
  });

  it("removes actions for confirmed, cancelled, risk-accepted, and Standby tasks", () => {
    for (const status of ["confirmed_completed", "cancelled", "risk_accepted"] as const) {
      expect(inbox({ status }).tasks[0]?.availableActions).toEqual([]);
    }
    expect(inbox({ source: "standby_cloud", admission: "unavailable" }).tasks[0]?.availableActions).toEqual([]);
  });

  it("fails closed for unknown policy and consumes the browser grant contract without owning authorization", () => {
    const view = inbox({ policy: "allowed" });
    expect(view.tasks[0]?.availableActions).toContain("request_automation_grant");
    expect(manualTaskInboxViewModelSchema.safeParse({
      ...view,
      tasks: [{ ...view.tasks[0], riskAcceptancePolicy: "unknown" }],
    }).success).toBe(false);
    expectTypeOf<ManualTaskBrowserGrantPort>().toEqualTypeOf<BrowserAutomationGrantPort>();
  });

  it("requires fresh reauthentication when policy says so", () => {
    const task = inbox({ policy: "fresh_reauth_required" }).tasks[0];
    expect(task).toBeDefined();
    if (task === undefined) return;
    expect(createManualTaskRiskCommand(task, "Accepted impact", true, null)).toBeNull();
    expect(createManualTaskRiskCommand(task, "Accepted impact", true, "reauth-1")).toMatchObject({
      taskRevision: 3,
      unresolvedImpactDigest: digest,
      reauthProofId: "reauth-1",
    });
  });
});

describe("history and startup recovery contracts", () => {
  it("keeps history append-only and creates a separate reversal plan behind the risk gate", () => {
    const entry = history().entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(createPlanReversalCommand(entry, false)).toBeNull();
    expect(createPlanReversalCommand(entry, true)).toMatchObject({ kind: "plan_reversal", revisionId: "rev-8241" });
    expect(history("standby_cloud").entries.every((item) => item.availableActions.length === 0)).toBe(true);
  });

  it("keeps LateExecutionEvent provenance read-only", () => {
    const late = history().entries[1];
    expect(late).toMatchObject({ state: "late_execution", reversible: false, availableActions: [] });
    expect(late?.lateExecution).toMatchObject({ leaseEpoch: 40, evidenceLevel: "provider_observed" });
  });

  it("blocks the worker and exposes only checks until every unknown outcome is reconciled", () => {
    const blocked = recovery(false);
    expect(blocked.workerBarrier).toBe("blocked");
    expect(blocked.availableActions).toEqual([]);
    expect(blocked.outcomeUnknownItems.every((item) => item.availableActions.join() === "check_platform_state")).toBe(true);
    const ready = recovery(true);
    expect(ready.workerBarrier).toBe("ready");
    expect(ready.availableActions).toEqual(["continue_after_reconciliation"]);
  });

  it("rejects a retry action on an outcome-unknown recovery item", () => {
    const blocked = recovery(false);
    expect(startupRecoveryViewModelSchema.safeParse({
      ...blocked,
      outcomeUnknownItems: [{ ...blocked.outcomeUnknownItems[0], availableActions: ["retry"] }, blocked.outcomeUnknownItems[1]],
    }).success).toBe(false);
  });
});

describe("asset protection contracts", () => {
  it.each([
    ["prepared", "approve_delist"],
    ["remote_pending", "check_platform_state"],
    ["manual_open", "check_platform_state"],
    ["outcome_unknown", "check_platform_state"],
    ["failed_retryable", "retry_delist"],
    ["confirmed", undefined],
  ] as const)("maps %s to only its legal listing action", (state, action) => {
    expect(incident(state).listings[1]?.availableActions[0]).toBe(action);
  });

  it("enforces one-at-a-time execution and removes actions while a listing is in flight", () => {
    expect(incident("executing").listings.every((listing) => listing.availableActions.length === 0)).toBe(true);
    const running = incident("executing");
    expect(assetProtectionIncidentViewModelSchema.safeParse({
      ...running,
      listings: [...running.listings, { ...running.listings[1], id: "listing-2", state: "checking" }],
    }).success).toBe(false);
  });

  it("cannot downgrade residual-risk closure to fixture wording or a boolean click", () => {
    const view = incident("outcome_unknown", "fresh_reauth_required");
    expect(createCloseProtectionIncidentCommand(view, {
      reason: "Accepted secondary-sale risk",
      residualRiskAcknowledged: true,
      reauthProofId: null,
    })).toBeNull();
    expect(createCloseProtectionIncidentCommand(view, {
      reason: "Accepted secondary-sale risk",
      residualRiskAcknowledged: true,
      reauthProofId: "reauth-1",
    })).toMatchObject({
      kind: "close_with_residual_risk",
      unresolvedListingCount: 1,
      unresolvedImpactDigest: digest,
    });
  });
});

describe("strict unknown boundaries", () => {
  it.each([
    [batchOperationViewModelSchema, batch("running")],
    [manualTaskInboxViewModelSchema, inbox()],
    [operationHistoryViewModelSchema, history()],
    [startupRecoveryViewModelSchema, recovery(false)],
    [assetProtectionIncidentViewModelSchema, incident("outcome_unknown")],
  ] as const)("rejects missing, extra, and unsafe projection shapes", (schema, valid) => {
    expect(schema.safeParse({ ...valid, credentialRef: "must-not-leak" }).success).toBe(false);
    const { schemaVersion: _schemaVersion, ...missing } = valid;
    expect(schema.safeParse(missing).success).toBe(false);
  });

  it("uses value-free errors and validates every boundary result", async () => {
    const validBatch = batch("running");
    const boundary: OperationsPresentationBoundary = {
      loadBatchOperation: async () => ({ ...validBatch, rawPassword: "secret-canary" }),
      loadManualTaskInbox: async () => inbox(),
      loadOperationHistory: async () => history(),
      loadStartupRecovery: async () => recovery(false),
      loadAssetProtectionIncident: async () => incident("outcome_unknown"),
    };
    const port = new ValidatingOperationsPresentationPort(boundary);
    await expect(port.loadBatchOperation("batch-1")).rejects.toThrow("invalid batch operation projection");
    try {
      parseBatchOperationViewModel({ ...validBatch, rawPassword: "secret-canary" });
    } catch (error) {
      expect(String(error)).not.toContain("secret-canary");
    }
    await expect(port.loadManualTaskInbox()).resolves.toMatchObject({ kind: "manual_task_inbox" });
    await expect(port.loadOperationHistory()).resolves.toMatchObject({ kind: "operation_history" });
    await expect(port.loadStartupRecovery()).resolves.toMatchObject({ kind: "startup_recovery" });
    await expect(port.loadAssetProtectionIncident("incident-1")).resolves.toMatchObject({
      kind: "asset_protection_incident",
    });
  });

  it("exposes only presentation reads on the validated query port", () => {
    expectTypeOf<keyof ValidatingOperationsPresentationPort>().toEqualTypeOf<
      | "loadBatchOperation"
      | "loadManualTaskInbox"
      | "loadOperationHistory"
      | "loadStartupRecovery"
      | "loadAssetProtectionIncident"
    >();
  });
});
