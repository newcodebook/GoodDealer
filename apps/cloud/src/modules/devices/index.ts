import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  accountRejectionSchema,
  type AccountRejection,
  type AccountRejectionCode,
} from "@gooddealer/protocol/account";
import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  activeDeviceLeaseStatusSchema,
  deviceBindingListSchema,
  deviceBindingSummarySchema,
  deviceAuthorityProjectionSchema,
  deviceSwitchRequestViewSchema,
  type ActiveDeviceLeaseStatus,
  type DeviceBindingList,
  type DeviceBindingSummary,
  type DeviceAuthorityProjection,
  type DeviceRemovalRequest,
  type DeviceSwitchRequest,
  type DeviceSwitchRequestView,
} from "@gooddealer/protocol/devices";

import {
  DrainVerifier,
  InMemoryDrainProofRegistry,
} from "./drain-verification";
import {
  ActiveDeviceLeaseLifecycle,
  type DrainTransactionFaultPoint,
} from "./lease-lifecycle";
import {
  RefusingDrainProofSignature,
  type AuditChainRegistryPort,
  type DrainProofSignaturePort,
  type DrainRejection,
  type DrainSealParticipantPort,
  type DrainStreamWatermarkPort,
  type DrainVerificationPort,
  type VerifiedDrainSealClaims,
} from "./ports";
import { DeviceSwitchWorkflow, isTerminal } from "./switch-workflow";

export { BootstrapFixtureService } from "./bootstrap-fixture";
export type {
  BootstrapFixtureOptions,
  BootstrapFixtureRejection,
  BootstrapFixtureRejectionCode,
} from "./bootstrap-fixture";
export { BootstrapWorkflow } from "./bootstrap-workflow";
export type {
  BootstrapActivationResult,
  BootstrapWorkflowOptions,
  BootstrapWorkflowResult,
} from "./bootstrap-workflow";
export {
  ActiveDeviceLeaseLifecycle,
  LEASE_OFFLINE_CEILING_SECONDS,
  LEASE_ONLINE_TTL_SECONDS,
  LEASE_RENEW_AFTER_SECONDS,
} from "./lease-lifecycle";
export type {
  ActiveDeviceLeaseClaims,
  BeginBootstrapTransaction,
  DrainTransactionFaultPoint,
  HeldLeaseRecord,
  LeaseAttemptResult,
  LeaseLifecycleOptions,
} from "./lease-lifecycle";
export {
  DRAIN_PROOF_MAX_TTL_SECONDS,
  DrainVerifier,
  InMemoryDrainProofRegistry,
} from "./drain-verification";
export type { DrainVerifierOptions } from "./drain-verification";
export * from "./ports";
export {
  BOOTSTRAP_CAPABILITY_TTL_SECONDS,
  DRAINING_STATE_TTL_SECONDS,
  PIN_TTL_SECONDS,
  REQUESTED_STATE_TTL_SECONDS,
  TAKEOVER_CLAIM_WINDOW_SECONDS,
  DeviceSwitchWorkflow,
  DeviceSwitchWorkflowRegistry,
  WorkflowTransitionError,
} from "./switch-workflow";
export type {
  BootstrapCapabilityRecord,
  CheckpointPinRecord,
  DeviceSwitchPurpose,
  DeviceSwitchStatus,
  DeviceSwitchWorkflowInput,
  DeviceSwitchWorkflowSnapshot,
} from "./switch-workflow";

interface LeaseRecord {
  readonly deviceId: string;
  readonly leaseEpoch: number;
  readonly issuedAt: string;
  readonly renewAfter: string;
  readonly onlineExpiresAt: string;
  readonly offlineExecuteUntil: string;
}

interface StoredSwitch {
  readonly idempotencyKey: string;
  readonly workflow: DeviceSwitchWorkflow;
}

export interface DeviceFixtureOptions {
  readonly now?: () => Date;
  readonly reauthCheck?: (reauthProofId: string) => AccountRejection | null;
  readonly seedBindings?: readonly DeviceBindingSummary[];
  readonly activeLease?: LeaseRecord | null;
  readonly accountId?: string;
  readonly workspaceId?: string;
  readonly workspaceHasPublishedCheckpoint?: boolean;
  readonly accountSecurityEpoch?: number;
  readonly callerAccountSecurityEpoch?: number;
  readonly accountSecurityState?: "normal" | "recovery_pending";
  readonly entitlementActive?: boolean;
  readonly drainVerifier?: DrainVerificationPort;
  readonly drainSignature?: DrainProofSignaturePort;
  readonly mutationWatermarks?: DrainStreamWatermarkPort;
  readonly executionFactWatermarks?: DrainStreamWatermarkPort;
  readonly deviceAuditWatermarks?: DrainStreamWatermarkPort;
  readonly auditChainRegistry?: AuditChainRegistryPort;
  readonly mutationDrainSeals?: DrainSealParticipantPort<"mutation">;
  readonly executionFactDrainSeals?: DrainSealParticipantPort<"execution_fact">;
  readonly deviceAuditDrainSeals?: DrainSealParticipantPort<"device_audit">;
  readonly drainTransactionFault?: (point: DrainTransactionFaultPoint) => void;
}

export class DevicesFixtureService {
  #listRevision = 1;
  #nextSwitch = 1;
  #activeLease: LeaseRecord | null;
  #exclusiveExecutionBlockUntil: string | null = null;
  #outstandingSwitch: StoredSwitch | null = null;
  #nextCapability = 1;
  readonly #now: () => Date;
  readonly #reauthCheck: (reauthProofId: string) => AccountRejection | null;
  readonly #bindings = new Map<string, DeviceBindingSummary>();
  readonly #accountId: string;
  readonly #workspaceId: string;
  readonly #workspaceHasPublishedCheckpoint: boolean;
  #accountSecurityEpoch: number;
  readonly #callerAccountSecurityEpoch: number;
  #accountSecurityState: "normal" | "recovery_pending";
  #entitlementActive: boolean;
  readonly #drainVerifier: DrainVerificationPort;
  readonly #leaseLifecycle: ActiveDeviceLeaseLifecycle;

  constructor(options: DeviceFixtureOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#reauthCheck = options.reauthCheck ?? (() => this.#reject("REAUTHENTICATION_REQUIRED"));
    this.#activeLease = options.activeLease ?? null;
    this.#accountId = options.accountId ?? "fixture-account";
    this.#workspaceId = options.workspaceId ?? "fixture-workspace";
    this.#workspaceHasPublishedCheckpoint = options.workspaceHasPublishedCheckpoint ?? true;
    this.#accountSecurityEpoch = options.accountSecurityEpoch ?? 1;
    this.#callerAccountSecurityEpoch = options.callerAccountSecurityEpoch ?? this.#accountSecurityEpoch;
    this.#accountSecurityState = options.accountSecurityState ?? "normal";
    this.#entitlementActive = options.entitlementActive ?? true;
    const proofRegistry = new InMemoryDrainProofRegistry();
    this.#leaseLifecycle = new ActiveDeviceLeaseLifecycle({
      trustedTime: { now: () => this.#timestamp() },
      proofRegistry,
      ...(options.mutationDrainSeals === undefined ? {} : { mutationDrainSeals: options.mutationDrainSeals }),
      ...(options.executionFactDrainSeals === undefined ? {} : { executionFactDrainSeals: options.executionFactDrainSeals }),
      ...(options.deviceAuditDrainSeals === undefined ? {} : { deviceAuditDrainSeals: options.deviceAuditDrainSeals }),
      ...(options.drainTransactionFault === undefined ? {} : {
        drainTransactionFault: options.drainTransactionFault,
      }),
      ...(options.activeLease === undefined || options.activeLease === null ? {} : { seed: {
        [this.#accountId]: {
          currentLeaseEpoch: options.activeLease.leaseEpoch,
          held: { ...options.activeLease, releasedAt: null },
        },
      } }),
    });
    this.#drainVerifier = options.drainVerifier ?? new DrainVerifier({
      drainSignature: options.drainSignature ?? new RefusingDrainProofSignature(),
      ...(options.mutationWatermarks === undefined ? {} : { mutationWatermarks: options.mutationWatermarks }),
      ...(options.executionFactWatermarks === undefined ? {} : { executionFactWatermarks: options.executionFactWatermarks }),
      ...(options.deviceAuditWatermarks === undefined ? {} : { deviceAuditWatermarks: options.deviceAuditWatermarks }),
      ...(options.auditChainRegistry === undefined ? {} : { auditChainRegistry: options.auditChainRegistry }),
      leaseState: this.#leaseLifecycle,
      proofRegistry,
    });
    for (const binding of options.seedBindings ?? []) {
      this.#bindings.set(binding.deviceId, deviceBindingSummarySchema.parse(binding));
    }
    this.#assertDirectoryInvariant();
  }

  listBindings(): DeviceBindingList {
    return deviceBindingListSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      listRevision: this.#listRevision,
      devices: [...this.#bindings.values()],
    });
  }

  bindDevice(binding: DeviceBindingSummary): DeviceBindingList | AccountRejection {
    const parsed = deviceBindingSummarySchema.parse(binding);
    const existing = this.#bindings.get(parsed.deviceId);
    const boundCount = [...this.#bindings.values()].filter(({ status }) => status === "bound").length;
    if (parsed.status === "bound" && existing?.status !== "bound" && boundCount >= 2) {
      return this.#reject("DEVICE_LIMIT_REACHED");
    }
    const otherActive = [...this.#bindings.values()].some(
      ({ deviceId, role }) => deviceId !== parsed.deviceId && role === "active",
    );
    if (parsed.role === "active" && otherActive) return this.#reject("ACTIVE_DEVICE_CONFLICT");
    const otherCurrentDevice = [...this.#bindings.values()].some(
      ({ deviceId, currentDevice }) => deviceId !== parsed.deviceId && currentDevice,
    );
    if (parsed.currentDevice && otherCurrentDevice) return this.#reject("ACTIVE_DEVICE_CONFLICT");

    deviceBindingListSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      listRevision: this.#listRevision + 1,
      devices: [...this.#bindings.values()].filter(({ deviceId }) => deviceId !== parsed.deviceId).concat(parsed),
    });
    this.#bindings.set(parsed.deviceId, parsed);
    this.#listRevision += 1;
    return this.listBindings();
  }

  removeDevice(request: DeviceRemovalRequest): DeviceBindingList | AccountRejection {
    if (request.expectedListRevision !== this.#listRevision) return this.#reject("LIST_REVISION_STALE");
    const binding = this.#bindings.get(request.deviceId);
    if (binding === undefined) return this.#reject("DEVICE_NOT_BOUND");
    if (binding.status === "removed") return this.#reject("DEVICE_REMOVED");
    if (request.expectedCredentialEpoch !== binding.credentialEpoch) {
      return this.#reject("LIST_REVISION_STALE");
    }
    const proofFailure = this.#reauthCheck(request.reauthProofId);
    if (proofFailure !== null) return proofFailure;

    const removedAt = this.#timestamp();
    const removedWasActive = binding.role === "active";
    this.#bindings.set(
      binding.deviceId,
      deviceBindingSummarySchema.parse({
        ...binding,
        status: "removed",
        role: "none",
        credentialEpoch: binding.credentialEpoch + 1,
        signingKeyStatus: "revoked",
        removedAt,
        currentDevice: false,
      }),
    );
    this.#listRevision += 1;
    if (removedWasActive && this.#activeLease?.deviceId === binding.deviceId) {
      this.#exclusiveExecutionBlockUntil = this.#activeLease.offlineExecuteUntil;
      this.#leaseLifecycle.removeActiveDevice(this.#accountId, binding.deviceId);
      this.#activeLease = null;
    }
    this.#failOutstandingForDevice(binding.deviceId, "device_removed");
    return this.listBindings();
  }

  advanceCredentialEpoch(deviceId: string): DeviceBindingList | AccountRejection {
    const binding = this.#bindings.get(deviceId);
    if (binding === undefined) return this.#reject("DEVICE_NOT_BOUND");
    if (binding.status === "removed") return this.#reject("DEVICE_REMOVED");
    this.#bindings.set(binding.deviceId, deviceBindingSummarySchema.parse({ ...binding, credentialEpoch: binding.credentialEpoch + 1 }));
    this.#listRevision += 1;
    this.#failOutstandingForDevice(binding.deviceId, "credential_epoch_advanced");
    return this.listBindings();
  }

  getLeaseStatus(evaluatedAt = this.#timestamp()): ActiveDeviceLeaseStatus {
    const lease = this.#activeLease;
    if (lease === null) {
      return activeDeviceLeaseStatusSchema.parse({
        schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
        held: false,
        deviceId: null,
        leaseEpoch: null,
        issuedAt: null,
        renewAfter: null,
        onlineExpiresAt: null,
        offlineExecuteUntil: null,
        renewalState: "expired",
        evaluatedAt,
      });
    }
    const renewalState =
      evaluatedAt < lease.renewAfter
        ? "fresh"
        : evaluatedAt < lease.onlineExpiresAt
          ? "renewal_window"
          : evaluatedAt < lease.offlineExecuteUntil
            ? "offline_grace"
            : "expired";
    return activeDeviceLeaseStatusSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      held: true,
      ...lease,
      renewalState,
      evaluatedAt,
    });
  }

  requestSwitch(request: DeviceSwitchRequest): DeviceSwitchRequestView | AccountRejection {
    if (this.#outstandingSwitch?.idempotencyKey === request.idempotencyKey) {
      return this.#outstandingSwitch.workflow.project();
    }
    if (this.#outstandingSwitch !== null && !isTerminal(this.#outstandingSwitch.workflow.status)) {
      return this.#reject("ACTIVE_DEVICE_CONFLICT");
    }
    if (this.#accountSecurityState !== "normal") return this.#reject("ACCOUNT_RECOVERY_PENDING");
    if (this.#callerAccountSecurityEpoch !== this.#accountSecurityEpoch) {
      return this.#reject("ACCOUNT_SECURITY_EPOCH_STALE");
    }
    if (!this.#entitlementActive) return this.#reject("ENTITLEMENT_INACTIVE");
    const target = this.#bindings.get(request.toDeviceId);
    if (target === undefined) return this.#reject("DEVICE_NOT_BOUND");
    if (target.status === "removed") return this.#reject("DEVICE_REMOVED");
    if (target.signingKeyStatus === "revoked") return this.#reject("DEVICE_NOT_BOUND");
    if (request.mode === "forced") {
      const proofFailure = this.#reauthCheck(request.reauthProofId);
      if (proofFailure !== null) return proofFailure;
    }

    const requestedAt = this.#timestamp();
    const fromDeviceId = [...this.#bindings.values()].find(({ role }) => role === "active")?.deviceId ?? null;
    if (
      request.mode === "normal" &&
      fromDeviceId === null &&
      this.#exclusiveExecutionBlockUntil !== null &&
      requestedAt < this.#exclusiveExecutionBlockUntil
    ) {
      return this.#reject("EXCLUSIVE_EXECUTION_BLOCKED");
    }
    const workflow = new DeviceSwitchWorkflow({
      workflowId: `fixture-switch-${this.#nextSwitch++}`,
      accountId: this.#accountId,
      workspaceId: this.#workspaceId,
      mode: request.mode,
      fromDeviceId,
      toDeviceId: request.toDeviceId,
      idempotencyKey: request.idempotencyKey,
      requestedAt,
      exclusiveExecutionBlockUntil: this.#exclusiveExecutionBlockUntil,
      oldLeaseOfflineExecuteUntil: this.#activeLease?.offlineExecuteUntil ?? null,
      workspaceHasPublishedCheckpoint: this.#workspaceHasPublishedCheckpoint,
      boundKeyId: target.signingKeyId,
      boundKeyVersion: target.signingKeyVersion,
      boundAccountSecurityEpoch: this.#accountSecurityEpoch,
    });
    this.#outstandingSwitch = { idempotencyKey: request.idempotencyKey, workflow };
    return deviceSwitchRequestViewSchema.parse(workflow.project());
  }

  getSwitchStatus(requestId: string): DeviceSwitchRequestView | null {
    const workflow = this.#outstandingSwitch?.workflow;
    return workflow?.workflowId === requestId ? workflow.project() : null;
  }

  beginBootstrap(requestId: string): DeviceSwitchRequestView | AccountRejection {
    const workflow = this.#workflowFor(requestId);
    if (workflow === null || workflow.status !== "requested") return this.#reject("ACTIVE_DEVICE_CONFLICT");
    return this.#enterBootstrapping(workflow);
  }

  async acceptDrain(
    requestId: string,
    manifest: unknown,
  ): Promise<DeviceSwitchRequestView | AccountRejection | DrainRejection> {
    const workflow = this.#workflowFor(requestId);
    if (workflow === null || workflow.status !== "draining" || workflow.fromDeviceId === null) {
      return this.#reject("ACTIVE_DEVICE_CONFLICT");
    }
    const heldLease = this.#leaseLifecycle.readHeldLease(this.#accountId);
    const claimedEpoch = isRecord(manifest) &&
      typeof manifest.activeLeaseEpoch === "number" &&
      Number.isSafeInteger(manifest.activeLeaseEpoch)
      ? manifest.activeLeaseEpoch
      : 0;
    const leaseEpoch = heldLease?.leaseEpoch ?? claimedEpoch;
    const verification = await this.#drainVerifier.verifyHandoff({
      workflowId: workflow.workflowId,
      accountId: this.#accountId,
      workspaceId: this.#workspaceId,
      fromDeviceId: workflow.fromDeviceId,
      leaseEpoch,
      evaluatedAt: this.#timestamp(),
      manifest,
    });
    if (!verification.accepted) {
      return { code: "DRAIN_PROOF_UNVERIFIED", reason: verification.reason, streams: verification.streams };
    }
    const sealClaims = verification.sealClaims;
    if (
      sealClaims.workspaceId !== this.#workspaceId ||
      sealClaims.sourceDeviceId !== workflow.fromDeviceId ||
      sealClaims.activeLeaseEpoch !== leaseEpoch
    ) {
      return { code: "DRAIN_PROOF_UNVERIFIED", reason: "DRAIN_PROOF_BINDING_MISMATCH", streams: [] };
    }
    if ([
      sealClaims.lastAssignedSequence.mutation,
      sealClaims.lastAssignedSequence.execution_fact,
      sealClaims.lastAssignedSequence.device_audit,
    ].some(
      (sequence) => !Number.isSafeInteger(sequence) || sequence < 0,
    )) {
      return { code: "DRAIN_PROOF_UNVERIFIED", reason: "DRAIN_PROOF_MALFORMED", streams: [] };
    }
    return this.#enterBootstrapping(workflow, {
      proofId: verification.proofId,
      proofDigest: verification.proofDigest,
      sealClaims,
    });
  }

  claimTakeover(requestId: string): DeviceSwitchRequestView | AccountRejection {
    const workflow = this.#workflowFor(requestId);
    if (workflow === null || workflow.status !== "waiting_expiry") return this.#reject("ACTIVE_DEVICE_CONFLICT");
    if (!workflow.takeoverAllowed(this.#timestamp())) return this.#reject("EXCLUSIVE_EXECUTION_BLOCKED");
    return this.#enterBootstrapping(workflow);
  }

  cancelSwitch(requestId: string): DeviceSwitchRequestView | AccountRejection {
    const workflow = this.#workflowFor(requestId);
    if (workflow === null) return this.#reject("ACTIVE_DEVICE_CONFLICT");
    this.#leaseLifecycle.discardPending(this.#accountId, workflow.workflowId);
    return workflow.cancel(this.#timestamp());
  }

  /** Fixture analogue of a deadline sweeper; a null result means missing, terminal, or not due. */
  expireSwitch(requestId: string): DeviceSwitchRequestView | null {
    const workflow = this.#workflowFor(requestId);
    if (workflow === null) return null;
    const expired = workflow.expire(this.#timestamp());
    if (expired === null) return null;
    this.#leaseLifecycle.discardPending(this.#accountId, workflow.workflowId);
    return expired;
  }

  getAuthority(deviceId: string): DeviceAuthorityProjection {
    const binding = this.#bindings.get(deviceId);
    if (binding === undefined || binding.status === "removed" || binding.role === "none") {
      return deviceAuthorityProjectionSchema.parse({ schemaVersion: 1, role: "none", scopes: [] });
    }
    if (binding.role === "standby") {
      return deviceAuthorityProjectionSchema.parse({
        schemaVersion: 1,
        role: "standby",
        scopes: ["account:manage", "workspace:read"],
      });
    }
    return deviceAuthorityProjectionSchema.parse({
      schemaVersion: 1,
      role: "active",
      scopes: ["account:manage", "workspace:mutate", "workspace:read"],
    });
  }

  rotateSigningKey(deviceId: string, signingKeyId: string, signingKeyVersion: number): DeviceBindingList | AccountRejection {
    const binding = this.#bindings.get(deviceId);
    if (binding === undefined) return this.#reject("DEVICE_NOT_BOUND");
    if (this.#outstandingSwitch?.workflow.status === "bootstrapping") {
      return this.#reject("ACTIVE_DEVICE_CONFLICT");
    }
    this.#bindings.set(deviceId, deviceBindingSummarySchema.parse({
      ...binding,
      signingKeyId,
      signingKeyVersion,
      signingKeyStatus: "active",
    }));
    this.#listRevision += 1;
    return this.listBindings();
  }

  advanceAccountSecurityEpoch(): void {
    this.#accountSecurityEpoch += 1;
    this.#leaseLifecycle.revokeForSecurity(this.#accountId);
    this.#failOutstandingForAccount("account_security_epoch_advanced");
  }

  setAccountSecurityState(state: "normal" | "recovery_pending"): void {
    this.#accountSecurityState = state;
    if (state === "recovery_pending") this.#failOutstandingForAccount("account_recovery_pending");
  }

  setEntitlementActive(active: boolean): void {
    this.#entitlementActive = active;
    if (!active) this.#failOutstandingForAccount("entitlement_inactive");
  }

  #assertDirectoryInvariant(): void {
    deviceBindingListSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      listRevision: this.#listRevision,
      devices: [...this.#bindings.values()],
    });
  }

  #workflowFor(requestId: string): DeviceSwitchWorkflow | null {
    const workflow = this.#outstandingSwitch?.workflow;
    return workflow?.workflowId === requestId ? workflow : null;
  }

  #enterBootstrapping(
    workflow: DeviceSwitchWorkflow,
    acceptedDrain?: {
      readonly proofId: string;
      readonly proofDigest: string;
      readonly sealClaims: VerifiedDrainSealClaims;
    },
  ): DeviceSwitchRequestView | AccountRejection {
    const target = this.#bindings.get(workflow.toDeviceId);
    if (this.#accountSecurityState !== "normal") return this.#reject("ACCOUNT_RECOVERY_PENDING");
    if (this.#callerAccountSecurityEpoch !== this.#accountSecurityEpoch) {
      return this.#reject("ACCOUNT_SECURITY_EPOCH_STALE");
    }
    if (!this.#entitlementActive) return this.#reject("ENTITLEMENT_INACTIVE");
    if (target === undefined || target.signingKeyStatus === "revoked") return this.#reject("DEVICE_NOT_BOUND");
    if (target.status === "removed") return this.#reject("DEVICE_REMOVED");
    if (!workflow.bindingMatches({
      signingKeyId: target.signingKeyId,
      signingKeyVersion: target.signingKeyVersion,
      accountSecurityEpoch: this.#accountSecurityEpoch,
    })) {
      workflow.fail(this.#timestamp(), "binding_rotated");
      return this.#reject("ACTIVE_DEVICE_CONFLICT");
    }
    const capabilityJti = `fixture-bootstrap-${this.#nextCapability}`;
    const predecessorLeaseEpoch = this.#leaseLifecycle.readHeldLease(this.#accountId)?.leaseEpoch;
    let transitionView: DeviceSwitchRequestView | undefined;
    this.#leaseLifecycle.beginBootstrap(
      this.#accountId,
      workflow.workflowId,
      workflow.fromDeviceId,
      {
        ...(acceptedDrain === undefined ? {} : {
          acceptedDrain,
          ...(predecessorLeaseEpoch === undefined ? {} : { predecessorLeaseEpoch }),
        }),
        transition: (pendingLeaseEpoch) => {
          const previousActiveLease = this.#activeLease;
          const transition = workflow.enterBootstrappingTransaction({
            pendingLeaseEpoch,
            capabilityJti,
            now: this.#timestamp(),
            expectedWorkflowRevision: workflow.workflowRevision,
          });
          transitionView = transition.view;
          this.#activeLease = null;
          return {
            rollback: () => {
              this.#activeLease = previousActiveLease;
              transition.rollback();
              transitionView = undefined;
            },
          };
        },
      },
    );
    this.#nextCapability += 1;
    if (transitionView === undefined) throw new TypeError("bootstrap transaction omitted its workflow transition");
    return transitionView;
  }

  #failOutstandingForDevice(deviceId: string, reason: string): void {
    const workflow = this.#outstandingSwitch?.workflow;
    if (
      workflow !== undefined &&
      !isTerminal(workflow.status) &&
      (workflow.toDeviceId === deviceId || workflow.fromDeviceId === deviceId)
    ) {
      this.#leaseLifecycle.discardPending(this.#accountId, workflow.workflowId);
      workflow.fail(this.#timestamp(), reason);
    }
  }

  #failOutstandingForAccount(reason: string): void {
    const workflow = this.#outstandingSwitch?.workflow;
    if (workflow !== undefined && !isTerminal(workflow.status)) {
      this.#leaseLifecycle.discardPending(this.#accountId, workflow.workflowId);
      workflow.fail(this.#timestamp(), reason);
    }
  }

  #reject(code: AccountRejectionCode): AccountRejection {
    const retryable = ["LIST_REVISION_STALE", "ACTIVE_DEVICE_CONFLICT"].includes(code);
    return accountRejectionSchema.parse({
      schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
      code,
      retryable,
      retryAfterSeconds: null,
      correlationId: `fixture-devices-${code.toLowerCase()}`,
    });
  }

  #timestamp(): string {
    return this.#now().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
