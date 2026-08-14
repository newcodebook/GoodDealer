import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  deviceAuthorityProjectionSchema,
  deviceSwitchRequestViewSchema,
  type BootstrapStepResult,
  type DeviceAuthorityProjection,
  type DeviceSwitchRequestView,
} from "@gooddealer/protocol/devices";

export const BOOTSTRAP_CAPABILITY_TTL_SECONDS = 60 * 60;
export const PIN_TTL_SECONDS = 10 * 60;
export const REQUESTED_STATE_TTL_SECONDS = 24 * 60 * 60;
export const DRAINING_STATE_TTL_SECONDS = 24 * 60 * 60;
export const TAKEOVER_CLAIM_WINDOW_SECONDS = 24 * 60 * 60;

export type DeviceSwitchPurpose = "first_device" | "device_switch" | "recovery_activation";
export type DeviceSwitchStatus = DeviceSwitchRequestView["status"];

export interface BootstrapCapabilityRecord {
  readonly jti: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  consumedAt: string | null;
  consumedReason: "activated" | "cancelled" | "expired" | "failed" | null;
}

export interface CheckpointPinRecord {
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly checkpointDigest: string;
  readonly pinExpiresAt: string;
}

export interface DeviceSwitchWorkflowInput {
  readonly workflowId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly mode: "normal" | "forced";
  readonly fromDeviceId: string | null;
  readonly toDeviceId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly exclusiveExecutionBlockUntil: string | null;
  readonly oldLeaseOfflineExecuteUntil: string | null;
  readonly workspaceHasPublishedCheckpoint: boolean;
  readonly boundKeyId: string;
  readonly boundKeyVersion: number;
  readonly boundAccountSecurityEpoch: number;
}

export interface DeviceSwitchWorkflowSnapshot {
  readonly workflowId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly purpose: DeviceSwitchPurpose;
  readonly mode: "normal" | "forced";
  readonly fromDeviceId: string | null;
  readonly toDeviceId: string;
  readonly idempotencyKey: string;
  readonly status: DeviceSwitchStatus;
  readonly workflowRevision: number;
  readonly boundKeyId: string;
  readonly boundKeyVersion: number;
  readonly boundAccountSecurityEpoch: number;
  readonly pendingLeaseEpoch: number | null;
  readonly capability: BootstrapCapabilityRecord | null;
  readonly pin: CheckpointPinRecord | null;
  readonly targetRevision: number | null;
  readonly targetSchemaVersion: number | null;
  readonly rebuildVerified: boolean;
  readonly nextStepNumber: number;
  readonly requestedAt: string;
  readonly earliestTakeoverAt: string | null;
  readonly bootstrapExpiresAt: string | null;
  readonly stateDeadline: string | null;
  readonly terminalReason: string | null;
}

export class DeviceSwitchWorkflow {
  readonly workflowId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly purpose: DeviceSwitchPurpose;
  readonly mode: "normal" | "forced";
  readonly fromDeviceId: string | null;
  readonly toDeviceId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly earliestTakeoverAt: string | null;
  readonly boundKeyId: string;
  readonly boundKeyVersion: number;
  readonly boundAccountSecurityEpoch: number;

  #status: DeviceSwitchStatus;
  #workflowRevision = 0;
  #pendingLeaseEpoch: number | null = null;
  #capability: BootstrapCapabilityRecord | null = null;
  #pin: CheckpointPinRecord | null = null;
  #targetRevision: number | null = null;
  #targetSchemaVersion: number | null = null;
  #rebuildVerified = false;
  #nextStepNumber = 1;
  #bootstrapExpiresAt: string | null = null;
  #stateDeadline: string | null;
  #terminalReason: string | null = null;

  constructor(input: DeviceSwitchWorkflowInput) {
    this.workflowId = input.workflowId;
    this.accountId = input.accountId;
    this.workspaceId = input.workspaceId;
    this.mode = input.mode;
    this.fromDeviceId = input.fromDeviceId;
    this.toDeviceId = input.toDeviceId;
    this.idempotencyKey = input.idempotencyKey;
    this.requestedAt = input.requestedAt;
    this.boundKeyId = input.boundKeyId;
    this.boundKeyVersion = input.boundKeyVersion;
    this.boundAccountSecurityEpoch = input.boundAccountSecurityEpoch;

    if (input.mode === "forced") {
      this.purpose = "device_switch";
      this.#status = "waiting_expiry";
      this.earliestTakeoverAt = maximumTimestamp([
        input.requestedAt,
        input.exclusiveExecutionBlockUntil,
        input.oldLeaseOfflineExecuteUntil,
      ]);
      this.#stateDeadline = addSeconds(this.earliestTakeoverAt, TAKEOVER_CLAIM_WINDOW_SECONDS);
    } else if (input.fromDeviceId !== null) {
      this.purpose = "device_switch";
      this.#status = "draining";
      this.earliestTakeoverAt = null;
      this.#stateDeadline = addSeconds(input.requestedAt, DRAINING_STATE_TTL_SECONDS);
    } else {
      this.purpose = input.workspaceHasPublishedCheckpoint ? "recovery_activation" : "first_device";
      this.#status = "requested";
      this.earliestTakeoverAt = null;
      this.#stateDeadline = addSeconds(input.requestedAt, REQUESTED_STATE_TTL_SECONDS);
    }
    this.project();
  }

  get status(): DeviceSwitchStatus {
    return this.#status;
  }

  get workflowRevision(): number {
    return this.#workflowRevision;
  }

  get capability(): BootstrapCapabilityRecord | null {
    return this.#capability === null ? null : { ...this.#capability };
  }

  get pin(): CheckpointPinRecord | null {
    return this.#pin === null ? null : { ...this.#pin };
  }

  get pendingLeaseEpoch(): number | null {
    return this.#pendingLeaseEpoch;
  }

  get targetRevision(): number | null {
    return this.#targetRevision;
  }

  get targetSchemaVersion(): number | null {
    return this.#targetSchemaVersion;
  }

  get rebuildVerified(): boolean {
    return this.#rebuildVerified;
  }

  get stateDeadline(): string | null {
    return this.#stateDeadline;
  }

  enterBootstrapping(input: {
    readonly pendingLeaseEpoch: number;
    readonly capabilityJti: string;
    readonly now: string;
    readonly expectedWorkflowRevision?: number;
  }): DeviceSwitchRequestView {
    this.#assertExpectedRevision(input.expectedWorkflowRevision);
    if (!(["requested", "draining", "waiting_expiry"] as const).includes(this.#status as never)) {
      throw new WorkflowTransitionError(terminalCode(this.#status));
    }
    const expiresAt = addSeconds(input.now, BOOTSTRAP_CAPABILITY_TTL_SECONDS);
    this.#pendingLeaseEpoch = input.pendingLeaseEpoch;
    this.#capability = {
      jti: input.capabilityJti,
      issuedAt: input.now,
      expiresAt,
      consumedAt: null,
      consumedReason: null,
    };
    this.#status = "bootstrapping";
    this.#bootstrapExpiresAt = expiresAt;
    this.#stateDeadline = expiresAt;
    this.#workflowRevision += 1;
    return this.project();
  }

  recordPin(pin: CheckpointPinRecord, targetRevision: number, targetSchemaVersion: number): void {
    if (this.#status !== "bootstrapping") throw new WorkflowTransitionError("WORKFLOW_NOT_BOOTSTRAPPING");
    if (this.#pin !== null || this.#targetRevision !== null) throw new WorkflowTransitionError("STEP_REPLAY_CONFLICT");
    this.#pin = { ...pin };
    this.#targetRevision = targetRevision;
    this.#targetSchemaVersion = targetSchemaVersion;
  }

  recordAcceptedStep(result: BootstrapStepResult): void {
    if (this.#status !== "bootstrapping") throw new WorkflowTransitionError("WORKFLOW_NOT_BOOTSTRAPPING");
    if (result.workflowRevision !== this.#workflowRevision + 1) {
      throw new WorkflowTransitionError("WORKFLOW_REVISION_STALE");
    }
    this.#workflowRevision = result.workflowRevision;
    this.#nextStepNumber = result.acceptedStepNumber + 1;
    if (result.stepKind === "submit_rebuild_digest") this.#rebuildVerified = true;
  }

  bindingMatches(input: {
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
    readonly accountSecurityEpoch: number;
  }): boolean {
    return input.signingKeyId === this.boundKeyId &&
      input.signingKeyVersion === this.boundKeyVersion &&
      input.accountSecurityEpoch === this.boundAccountSecurityEpoch;
  }

  takeoverAllowed(now: string): boolean {
    return this.#status === "waiting_expiry" && this.earliestTakeoverAt !== null && now >= this.earliestTakeoverAt;
  }

  consumeCapability(now: string, reason: BootstrapCapabilityRecord["consumedReason"]): void {
    if (this.#capability !== null && this.#capability.consumedAt === null) {
      this.#capability.consumedAt = now;
      this.#capability.consumedReason = reason;
    }
  }

  cancel(now: string): DeviceSwitchRequestView {
    if (this.#status === "cancelled") return this.project();
    if (isTerminal(this.#status)) throw new WorkflowTransitionError(terminalCode(this.#status));
    this.#cleanup(now, "cancelled");
    this.#status = "cancelled";
    this.#terminalReason = "cancelled";
    this.#workflowRevision += 1;
    return this.project();
  }

  expire(now: string): DeviceSwitchRequestView | null {
    if (isTerminal(this.#status) || this.#stateDeadline === null || now < this.#stateDeadline) return null;
    this.#cleanup(now, "expired");
    this.#status = "failed";
    this.#terminalReason = "expired";
    this.#workflowRevision += 1;
    return this.project();
  }

  fail(now: string, reason: string): DeviceSwitchRequestView {
    if (isTerminal(this.#status)) throw new WorkflowTransitionError(terminalCode(this.#status));
    this.#cleanup(now, "failed");
    this.#status = "failed";
    this.#terminalReason = reason;
    this.#workflowRevision += 1;
    return this.project();
  }

  project(): DeviceSwitchRequestView {
    return deviceSwitchRequestViewSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      requestId: this.workflowId,
      mode: this.mode,
      status: this.#status,
      fromDeviceId: this.fromDeviceId,
      toDeviceId: this.toDeviceId,
      requestedAt: this.requestedAt,
      earliestTakeoverAt: this.earliestTakeoverAt,
      bootstrapExpiresAt: this.#bootstrapExpiresAt,
    });
  }

  targetAuthority(): DeviceAuthorityProjection {
    if (this.#status === "completed") {
      return deviceAuthorityProjectionSchema.parse({
        schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
        role: "active",
        scopes: ["account:manage", "workspace:mutate", "workspace:read"],
      });
    }
    return deviceAuthorityProjectionSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      role: "standby",
      scopes: ["account:manage", "workspace:read"],
    });
  }

  snapshot(): DeviceSwitchWorkflowSnapshot {
    return {
      workflowId: this.workflowId,
      accountId: this.accountId,
      workspaceId: this.workspaceId,
      purpose: this.purpose,
      mode: this.mode,
      fromDeviceId: this.fromDeviceId,
      toDeviceId: this.toDeviceId,
      idempotencyKey: this.idempotencyKey,
      status: this.#status,
      workflowRevision: this.#workflowRevision,
      boundKeyId: this.boundKeyId,
      boundKeyVersion: this.boundKeyVersion,
      boundAccountSecurityEpoch: this.boundAccountSecurityEpoch,
      pendingLeaseEpoch: this.#pendingLeaseEpoch,
      capability: this.capability,
      pin: this.pin,
      targetRevision: this.#targetRevision,
      targetSchemaVersion: this.#targetSchemaVersion,
      rebuildVerified: this.#rebuildVerified,
      nextStepNumber: this.#nextStepNumber,
      requestedAt: this.requestedAt,
      earliestTakeoverAt: this.earliestTakeoverAt,
      bootstrapExpiresAt: this.#bootstrapExpiresAt,
      stateDeadline: this.#stateDeadline,
      terminalReason: this.#terminalReason,
    };
  }

  #cleanup(now: string, reason: "cancelled" | "expired" | "failed"): void {
    this.consumeCapability(now, reason);
    this.#pin = null;
    this.#pendingLeaseEpoch = null;
    this.#bootstrapExpiresAt = null;
    this.#stateDeadline = null;
  }

  #assertExpectedRevision(expected: number | undefined): void {
    if (expected !== undefined && expected !== this.#workflowRevision) {
      throw new WorkflowTransitionError("WORKFLOW_REVISION_STALE");
    }
  }
}

export class WorkflowTransitionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class DeviceSwitchWorkflowRegistry {
  readonly #byId = new Map<string, DeviceSwitchWorkflow>();
  readonly #idempotencyByAccount = new Map<string, Map<string, string>>();

  find(workflowId: string): DeviceSwitchWorkflow | null {
    return this.#byId.get(workflowId) ?? null;
  }

  findOutstanding(accountId: string): DeviceSwitchWorkflow | null {
    return [...this.#byId.values()].find(
      (workflow) => workflow.accountId === accountId && !isTerminal(workflow.status),
    ) ?? null;
  }

  create(input: DeviceSwitchWorkflowInput):
    | { readonly accepted: true; readonly workflow: DeviceSwitchWorkflow; readonly replay: boolean }
    | { readonly accepted: false; readonly code: "ACTIVE_DEVICE_CONFLICT" } {
    const accountKeys = this.#idempotencyByAccount.get(input.accountId) ?? new Map<string, string>();
    const priorId = accountKeys.get(input.idempotencyKey);
    if (priorId !== undefined) {
      return { accepted: true, workflow: this.#byId.get(priorId)!, replay: true };
    }
    if (this.findOutstanding(input.accountId) !== null) {
      return { accepted: false, code: "ACTIVE_DEVICE_CONFLICT" };
    }
    const workflow = new DeviceSwitchWorkflow(input);
    this.#byId.set(workflow.workflowId, workflow);
    accountKeys.set(input.idempotencyKey, workflow.workflowId);
    this.#idempotencyByAccount.set(input.accountId, accountKeys);
    return { accepted: true, workflow, replay: false };
  }

  failForDevice(deviceId: string, now: string, reason: string): void {
    for (const workflow of this.#byId.values()) {
      if (!isTerminal(workflow.status) && (workflow.toDeviceId === deviceId || workflow.fromDeviceId === deviceId)) {
        workflow.fail(now, reason);
      }
    }
  }

  failForAccount(accountId: string, now: string, reason: string): void {
    const workflow = this.findOutstanding(accountId);
    if (workflow !== null) workflow.fail(now, reason);
  }
}

export function isTerminal(status: DeviceSwitchStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function terminalCode(status: DeviceSwitchStatus): string {
  if (status === "completed") return "WORKFLOW_COMPLETED";
  if (status === "cancelled") return "WORKFLOW_CANCELLED";
  if (status === "failed") return "WORKFLOW_FAILED";
  return "WORKFLOW_NOT_BOOTSTRAPPING";
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function maximumTimestamp(values: readonly (string | null)[]): string {
  return values.filter((value): value is string => value !== null).reduce(
    (maximum, value) => value > maximum ? value : maximum,
  );
}
