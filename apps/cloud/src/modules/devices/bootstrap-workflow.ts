import type { AccountRejectionCode } from "@gooddealer/protocol/account";
import {
  bootstrapStepRequestSchema,
  type BootstrapStepRequest,
  type BootstrapStepResult,
} from "@gooddealer/protocol/devices";
import type { CheckpointDescriptor, SyncMutation, WorkspaceEntityDigest } from "@gooddealer/protocol/workspace";

import {
  BootstrapFixtureService,
  type BootstrapFixtureRejection,
  type BootstrapFixtureRejectionCode,
} from "./bootstrap-fixture";
import { ActiveDeviceLeaseLifecycle } from "./lease-lifecycle";
import {
  DenyingCheckpointCatalog,
  DenyingDeviceCursor,
  DenyingEntitlementDeadlineReader,
  DenyingMutationPageReader,
  DenyingWorkspaceRevisionReader,
  SystemTrustedTime,
  type AccountSecurityPort,
  type CapabilityVerifierPort,
  type CheckpointCatalogPort,
  type DeviceCursorPort,
  type EntitlementDeadlinePort,
  type MutationPagePort,
  type TrustedTimePort,
  type WorkspaceRevisionPort,
} from "./ports";
import {
  PIN_TTL_SECONDS,
  DeviceSwitchWorkflow,
  type CheckpointPinRecord,
} from "./switch-workflow";

export interface BootstrapWorkflowOptions {
  readonly workflow: DeviceSwitchWorkflow;
  readonly checkpoint: CheckpointDescriptor;
  readonly mutations: readonly SyncMutation[];
  readonly expectedEntityDigests: readonly WorkspaceEntityDigest[];
  readonly stepNonceFor: (stepNumber: number) => string;
  readonly capabilityVerifier: CapabilityVerifierPort;
  readonly checkpointCatalog?: CheckpointCatalogPort;
  readonly workspaceRevision?: WorkspaceRevisionPort;
  readonly mutationPages?: MutationPagePort;
  readonly deviceCursor?: DeviceCursorPort;
  readonly trustedTime?: TrustedTimePort;
  readonly entitlement?: EntitlementDeadlinePort;
  readonly accountSecurity: AccountSecurityPort;
  readonly leaseLifecycle?: ActiveDeviceLeaseLifecycle;
  readonly readTargetBinding: () => {
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
  } | null;
}

export type BootstrapWorkflowResult = BootstrapStepResult | BootstrapFixtureRejection;
export type BootstrapActivationResult = {
  readonly activated: false;
  readonly code: BootstrapFixtureRejectionCode | Extract<AccountRejectionCode, "ENTITLEMENT_INACTIVE">;
};

/**
 * Capability/pin envelope around the landed strict-step executor. The executor retains the
 * frozen digest, nonce, replay and CAS guard order; this class owns cross-module lifecycles.
 */
export class BootstrapWorkflow {
  readonly #workflow: DeviceSwitchWorkflow;
  readonly #executor: BootstrapFixtureService;
  readonly #capabilityVerifier: CapabilityVerifierPort;
  readonly #checkpointCatalog: CheckpointCatalogPort;
  readonly #workspaceRevision: WorkspaceRevisionPort;
  readonly #mutationPages: MutationPagePort;
  readonly #deviceCursor: DeviceCursorPort;
  readonly #trustedTime: TrustedTimePort;
  readonly #entitlement: EntitlementDeadlinePort;
  readonly #accountSecurity: AccountSecurityPort;
  readonly #leaseLifecycle: ActiveDeviceLeaseLifecycle;
  readonly #readTargetBinding: BootstrapWorkflowOptions["readTargetBinding"];

  constructor(options: BootstrapWorkflowOptions) {
    const capabilityAtConstruction = options.workflow.capability;
    this.#workflow = options.workflow;
    this.#capabilityVerifier = options.capabilityVerifier;
    this.#checkpointCatalog = options.checkpointCatalog ?? new DenyingCheckpointCatalog();
    this.#workspaceRevision = options.workspaceRevision ?? new DenyingWorkspaceRevisionReader();
    this.#mutationPages = options.mutationPages ?? new DenyingMutationPageReader();
    this.#deviceCursor = options.deviceCursor ?? new DenyingDeviceCursor();
    this.#trustedTime = options.trustedTime ?? new SystemTrustedTime();
    this.#entitlement = options.entitlement ?? new DenyingEntitlementDeadlineReader(this.#trustedTime);
    this.#accountSecurity = options.accountSecurity;
    this.#leaseLifecycle = options.leaseLifecycle ?? new ActiveDeviceLeaseLifecycle({ trustedTime: this.#trustedTime });
    this.#readTargetBinding = options.readTargetBinding;
    this.#executor = new BootstrapFixtureService({
      deviceSwitchRequestId: options.workflow.workflowId,
      capabilityJti: capabilityAtConstruction?.jti ?? "unissued-capability",
      checkpoint: options.checkpoint,
      mutations: options.mutations,
      expectedEntityDigests: options.expectedEntityDigests,
      stepNonceFor: options.stepNonceFor,
      initialWorkflowRevision: options.workflow.workflowRevision,
      now: () => new Date(this.#trustedTime.now()),
      pinTtlSeconds: PIN_TTL_SECONDS,
    });
  }

  async executeStep(presentedCapability: unknown, input: unknown): Promise<BootstrapWorkflowResult> {
    const parsed = bootstrapStepRequestSchema.safeParse(input);
    if (!parsed.success) return this.#executor.execute(input);
    const request = parsed.data;
    const statusRejection = this.#statusRejection();
    if (statusRejection !== null) return reject(statusRejection);

    const capability = this.#workflow.capability;
    if (capability === null || request.capabilityJti !== capability.jti) return reject("CAPABILITY_INVALID");
    if (capability.consumedAt !== null) return reject("CAPABILITY_CONSUMED");
    const now = this.#trustedTime.now();
    if (now >= capability.expiresAt) return reject("CAPABILITY_EXPIRED");

    const verification = await this.#capabilityVerifier.verifyBootstrapCapability(presentedCapability, {
      accountId: this.#workflow.accountId,
      deviceId: this.#workflow.toDeviceId,
      accountSecurityEpoch: this.#workflow.boundAccountSecurityEpoch,
      jti: capability.jti,
      issuedAt: capability.issuedAt,
      expiresAt: capability.expiresAt,
      deviceSwitchRequestId: this.#workflow.workflowId,
      evaluatedAt: now,
    });
    if (!verification.accepted) {
      return reject(verification.reason === "expired" ? "CAPABILITY_EXPIRED" : "CAPABILITY_INVALID");
    }

    const security = await this.#accountSecurity.read(this.#workflow.accountId);
    const binding = this.#readTargetBinding();
    if (
      security.state !== "normal" ||
      binding === null ||
      !this.#workflow.bindingMatches({
        signingKeyId: binding.signingKeyId,
        signingKeyVersion: binding.signingKeyVersion,
        accountSecurityEpoch: security.accountSecurityEpoch,
      })
    ) {
      await this.#failAndRelease("binding_rotated");
      return reject("BINDING_MISMATCH");
    }

    const snapshot = this.#workflow.snapshot();
    const isReplay = request.stepNumber < snapshot.nextStepNumber;
    if (request.stepKind !== "pin_checkpoint") {
      if (snapshot.pin === null || now >= snapshot.pin.pinExpiresAt) return reject("PIN_EXPIRED");
    }
    if (isReplay) return this.#executor.execute(request);

    let pendingPin: CheckpointPinRecord | null = null;
    let targetRevision: number | null = null;
    let targetSchemaVersion: number | null = null;
    if (request.stepKind === "pin_checkpoint") {
      const scope = { accountId: this.#workflow.accountId, workspaceId: this.#workflow.workspaceId };
      const selected = await this.#checkpointCatalog.selectPublishedCheckpoint(
        scope,
        request.stepPayload.checkpointId,
      );
      if (
        selected === null ||
        selected.workspaceId !== this.#workflow.workspaceId ||
        selected.checkpointId !== request.stepPayload.checkpointId ||
        selected.throughRevision !== request.stepPayload.checkpointRevision ||
        selected.checkpointDigest !== request.stepPayload.checkpointDigest
      ) {
        return reject("CHECKPOINT_MISMATCH");
      }
      const head = await this.#workspaceRevision.readHead(scope);
      const pinExpiresAt = minimumTimestamp([addSeconds(now, PIN_TTL_SECONDS), capability.expiresAt]);
      if (!await this.#checkpointCatalog.pinCheckpoint(
        scope,
        selected.checkpointId,
        pinExpiresAt,
      )) {
        return reject("CHECKPOINT_PIN_UNAVAILABLE");
      }
      pendingPin = {
        checkpointId: selected.checkpointId,
        checkpointRevision: selected.throughRevision,
        checkpointDigest: selected.checkpointDigest,
        pinExpiresAt,
      };
      targetRevision = head.serverRevision;
      targetSchemaVersion = head.workspaceSchemaVersion;
    } else if (request.stepKind === "fetch_mutations") {
      if (request.stepPayload.throughRevisionInclusive !== snapshot.targetRevision) {
        return reject("TARGET_REVISION_MISMATCH");
      }
    } else {
      if (request.stepPayload.targetRevision !== snapshot.targetRevision) return reject("REBUILD_DIGEST_MISMATCH");
      if (request.stepPayload.workspaceSchemaVersion !== snapshot.targetSchemaVersion) {
        await this.#failAndRelease("workspace_schema_unsupported");
        return reject("WORKSPACE_SCHEMA_UNSUPPORTED");
      }
    }

    let expectedMutationPage: unknown = null;
    if (request.stepKind === "fetch_mutations") {
      try {
        expectedMutationPage = await this.#mutationPages.readPage({
          accountId: this.#workflow.accountId,
          workspaceId: this.#workflow.workspaceId,
        }, {
          fromRevisionExclusive: request.stepPayload.fromRevisionExclusive,
          throughRevisionInclusive: request.stepPayload.throughRevisionInclusive,
          cursor: request.stepPayload.cursor,
          pageLimit: request.stepPayload.pageLimit,
        });
      } catch {
        return reject("MUTATION_CURSOR_MISMATCH");
      }
    }

    const result = this.#executor.execute(request);
    if (isRejection(result)) {
      if (pendingPin !== null) {
        await this.#checkpointCatalog.releasePin(
          { accountId: this.#workflow.accountId, workspaceId: this.#workflow.workspaceId },
          pendingPin.checkpointId,
          this.#workflow.workflowId,
        );
      }
      return result;
    }

    // A concurrent identical presentation may have committed while this call was awaiting a
    // port. The executor returns the persisted result; do not re-apply aggregate mutations.
    if (result.workflowRevision <= this.#workflow.workflowRevision) return result;

    if (
      request.stepKind === "fetch_mutations" &&
      result.stepKind === "fetch_mutations" &&
      JSON.stringify(result.resultPayload.mutationPage) !== JSON.stringify(expectedMutationPage)
    ) {
      await this.#failAndRelease("mutation_page_mismatch");
      return reject("MUTATION_CURSOR_MISMATCH");
    }
    if (pendingPin !== null && targetRevision !== null && targetSchemaVersion !== null) {
      this.#workflow.recordPin(pendingPin, targetRevision, targetSchemaVersion);
    }
    this.#workflow.recordAcceptedStep(result);
    return result;
  }

  async activate(): Promise<BootstrapActivationResult> {
    const statusRejection = this.#statusRejection();
    if (statusRejection !== null) return { activated: false, code: statusRejection };
    const snapshot = this.#workflow.snapshot();
    if (!snapshot.rebuildVerified) return { activated: false, code: "REBUILD_DIGEST_MISMATCH" };
    if (snapshot.targetRevision === null) return { activated: false, code: "REBUILD_DIGEST_MISMATCH" };
    const now = this.#trustedTime.now();
    if (snapshot.capability === null || snapshot.capability.consumedAt !== null) {
      return { activated: false, code: "CAPABILITY_CONSUMED" };
    }
    if (now >= snapshot.capability.expiresAt) return { activated: false, code: "CAPABILITY_EXPIRED" };
    if (snapshot.pin === null || now >= snapshot.pin.pinExpiresAt) return { activated: false, code: "PIN_EXPIRED" };
    if (snapshot.pendingLeaseEpoch === null || snapshot.pendingLeaseEpoch !== this.#leaseLifecycle.highestAllocatedEpoch(snapshot.accountId)) {
      return { activated: false, code: "WORKFLOW_REVISION_STALE" };
    }

    const security = await this.#accountSecurity.read(snapshot.accountId);
    const binding = this.#readTargetBinding();
    if (
      security.state !== "normal" ||
      binding === null ||
      !this.#workflow.bindingMatches({
        signingKeyId: binding.signingKeyId,
        signingKeyVersion: binding.signingKeyVersion,
        accountSecurityEpoch: security.accountSecurityEpoch,
      })
    ) {
      await this.#failAndRelease("activation_binding_invalid");
      return { activated: false, code: "BINDING_MISMATCH" };
    }
    const entitlement = await this.#entitlement.read(snapshot.accountId);
    if (!entitlement.active) return { activated: false, code: "ENTITLEMENT_INACTIVE" };
    const claims = this.#leaseLifecycle.computeClaims({
      accountId: snapshot.accountId,
      deviceId: snapshot.toDeviceId,
      accountSecurityEpoch: security.accountSecurityEpoch,
      workflowId: snapshot.workflowId,
      jti: `lease-${snapshot.workflowId}-${snapshot.pendingLeaseEpoch}`,
      entitlement,
    });
    const issuance = await this.#leaseLifecycle.attemptIssue(claims);
    if (!issuance.issued) return { activated: false, code: issuance.code };

    // This completion path is intentionally unreachable while LeaseSignerPort can express only
    // refusal. Keeping the cursor transfer behind the consumed signer result makes both the
    // transaction shape and the Fallback's negative assertions discriminating.
    if (snapshot.fromDeviceId !== null) {
      await this.#deviceCursor.retireCursor(
        { accountId: snapshot.accountId, workspaceId: snapshot.workspaceId },
        snapshot.fromDeviceId,
        "replaced",
      );
    }
    await this.#deviceCursor.activateCursor(
      { accountId: snapshot.accountId, workspaceId: snapshot.workspaceId },
      snapshot.toDeviceId,
      snapshot.targetRevision,
    );
    throw new TypeError("lease issuance success is disabled in P0-16");
  }

  async cancel(): Promise<void> {
    const pin = this.#workflow.pin;
    if (pin !== null) {
      await this.#checkpointCatalog.releasePin(
        { accountId: this.#workflow.accountId, workspaceId: this.#workflow.workspaceId },
        pin.checkpointId,
        this.#workflow.workflowId,
      );
    }
    this.#leaseLifecycle.discardPending(this.#workflow.accountId, this.#workflow.workflowId);
    this.#workflow.cancel(this.#trustedTime.now());
  }

  async expire(): Promise<boolean> {
    const now = this.#trustedTime.now();
    if (this.#workflow.stateDeadline === null || now < this.#workflow.stateDeadline) return false;
    const pin = this.#workflow.pin;
    if (pin !== null) {
      await this.#checkpointCatalog.releasePin(
        { accountId: this.#workflow.accountId, workspaceId: this.#workflow.workspaceId },
        pin.checkpointId,
        this.#workflow.workflowId,
      );
    }
    this.#leaseLifecycle.discardPending(this.#workflow.accountId, this.#workflow.workflowId);
    return this.#workflow.expire(now) !== null;
  }

  async #failAndRelease(reason: string): Promise<void> {
    const pin = this.#workflow.pin;
    if (pin !== null) {
      await this.#checkpointCatalog.releasePin(
        { accountId: this.#workflow.accountId, workspaceId: this.#workflow.workspaceId },
        pin.checkpointId,
        this.#workflow.workflowId,
      );
    }
    this.#leaseLifecycle.discardPending(this.#workflow.accountId, this.#workflow.workflowId);
    if (!["completed", "cancelled", "failed"].includes(this.#workflow.status)) {
      this.#workflow.fail(this.#trustedTime.now(), reason);
    }
  }

  #statusRejection(): BootstrapFixtureRejectionCode | null {
    if (this.#workflow.status === "bootstrapping") return null;
    if (this.#workflow.status === "completed") return "WORKFLOW_COMPLETED";
    if (this.#workflow.status === "cancelled") return "WORKFLOW_CANCELLED";
    if (this.#workflow.status === "failed") return "WORKFLOW_FAILED";
    return "WORKFLOW_NOT_BOOTSTRAPPING";
  }
}

function reject(code: BootstrapFixtureRejectionCode): BootstrapFixtureRejection {
  return { accepted: false, code };
}

function isRejection(value: BootstrapWorkflowResult): value is BootstrapFixtureRejection {
  return "accepted" in value && value.accepted === false;
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function minimumTimestamp(values: readonly string[]): string {
  return values.reduce((minimum, value) => value < minimum ? value : minimum);
}
