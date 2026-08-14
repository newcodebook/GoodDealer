import { createHash } from "node:crypto";

import {
  BOOTSTRAP_STEP_SCHEMA_VERSION,
  bootstrapStepRequestSchema,
  bootstrapStepResultSchema,
  encodeBootstrapStepRequestDigestInput,
  encodeBootstrapStepResultDigestInput,
  type BootstrapStepRequest,
  type BootstrapStepResult,
} from "@gooddealer/protocol/devices";
import {
  encodeMutationPageDigestInput,
  encodeWorkspaceEntityDigestsInput,
  checkpointDescriptorSchema,
  mutationPageSchema,
  syncMutationSchema,
  workspaceEntityDigestsSchema,
  type CheckpointDescriptor,
  type SyncMutation,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";

export type BootstrapFixtureRejectionCode =
  | "INVALID_REQUEST"
  | "BINDING_MISMATCH"
  | "DIGEST_MISMATCH"
  | "NONCE_MISMATCH"
  | "WORKFLOW_COMPLETED"
  | "WORKFLOW_REVISION_STALE"
  | "STEP_OUT_OF_ORDER"
  | "STEP_REPLAY_CONFLICT"
  | "CHECKPOINT_MISMATCH"
  | "MUTATION_CURSOR_MISMATCH"
  | "REBUILD_DIGEST_MISMATCH"
  | "WORKFLOW_NOT_BOOTSTRAPPING"
  | "WORKFLOW_CANCELLED"
  | "WORKFLOW_FAILED"
  | "CAPABILITY_INVALID"
  | "CAPABILITY_EXPIRED"
  | "CAPABILITY_CONSUMED"
  | "CHECKPOINT_PIN_UNAVAILABLE"
  | "PIN_EXPIRED"
  | "TARGET_REVISION_MISMATCH"
  | "WORKSPACE_SCHEMA_UNSUPPORTED"
  | "DRAIN_PROOF_UNVERIFIED"
  | "LEASE_ISSUANCE_DISABLED";

export interface BootstrapFixtureRejection {
  readonly accepted: false;
  readonly code: BootstrapFixtureRejectionCode;
}

interface AcceptedPresentation {
  readonly stepNonce: string;
  readonly requestDigest: string;
  readonly result: BootstrapStepResult;
}

type ResultWithout<T, Keys extends PropertyKey> = T extends unknown ? Omit<T, Keys> : never;
type BootstrapResultDraft = ResultWithout<BootstrapStepResult, "workflowRevision" | "nextStepNonce" | "resultDigest">;
type BootstrapResultWithoutDigest = ResultWithout<BootstrapStepResult, "resultDigest">;

export interface BootstrapFixtureOptions {
  readonly deviceSwitchRequestId: string;
  readonly capabilityJti: string;
  readonly checkpoint: CheckpointDescriptor;
  readonly mutations: readonly SyncMutation[];
  readonly expectedEntityDigests: readonly WorkspaceEntityDigest[];
  readonly stepNonceFor: (stepNumber: number) => string;
  readonly now?: () => Date;
  readonly pinTtlSeconds?: number;
  /** Seeds the strict-step CAS after control-plane mutations have already advanced it. */
  readonly initialWorkflowRevision?: number;
}

/** Fixture-only strict-step state machine. It never signs or returns an ActiveDeviceLease. */
export class BootstrapFixtureService {
  #workflowRevision: number;
  #nextStepNumber = 1;
  #phase: "awaiting_pin" | "fetching" | "awaiting_digest" | "completed" = "awaiting_pin";
  #returnedThroughRevision: number;
  #nextCursor: string | null = null;
  readonly #accepted = new Map<number, AcceptedPresentation>();
  readonly #deviceSwitchRequestId: string;
  readonly #capabilityJti: string;
  readonly #checkpoint: CheckpointDescriptor;
  readonly #mutations: readonly SyncMutation[];
  readonly #expectedEntityDigests: readonly WorkspaceEntityDigest[];
  readonly #stepNonceFor: (stepNumber: number) => string;
  readonly #now: () => Date;
  readonly #pinTtlSeconds: number;

  constructor(options: BootstrapFixtureOptions) {
    this.#deviceSwitchRequestId = options.deviceSwitchRequestId;
    this.#capabilityJti = options.capabilityJti;
    this.#checkpoint = checkpointDescriptorSchema.parse(options.checkpoint);
    this.#returnedThroughRevision = this.#checkpoint.throughRevision;
    this.#stepNonceFor = options.stepNonceFor;
    this.#now = options.now ?? (() => new Date());
    this.#pinTtlSeconds = options.pinTtlSeconds ?? 600;
    this.#workflowRevision = options.initialWorkflowRevision ?? 0;
    if (!Number.isSafeInteger(this.#workflowRevision) || this.#workflowRevision < 0) {
      throw new TypeError("initial workflow revision must be a safe unsigned integer");
    }
    if (!Number.isSafeInteger(this.#pinTtlSeconds) || this.#pinTtlSeconds < 1 || this.#pinTtlSeconds > 3_600) {
      throw new TypeError("fixture pin TTL must be an integer from 1 through 3600 seconds");
    }
    this.#expectedEntityDigests = workspaceEntityDigestsSchema.parse(options.expectedEntityDigests);
    if (options.mutations.length > 4_096) throw new TypeError("fixture mutation chain exceeds the in-memory limit");
    this.#mutations = options.mutations.map((mutation) => syncMutationSchema.parse(mutation));

    if (this.#checkpoint.throughRevision + this.#mutations.length > Number.MAX_SAFE_INTEGER) {
      throw new TypeError("fixture mutation chain exceeds the safe revision range");
    }

    let expectedRevision = this.#checkpoint.throughRevision + 1;
    for (const mutation of this.#mutations) {
      if (mutation.workspaceId !== this.#checkpoint.workspaceId || mutation.serverRevision !== expectedRevision) {
        throw new TypeError("fixture mutations must form one contiguous checkpoint-bound workspace chain");
      }
      expectedRevision += 1;
    }
  }

  execute(input: unknown): BootstrapStepResult | BootstrapFixtureRejection {
    const parsed = bootstrapStepRequestSchema.safeParse(input);
    if (!parsed.success) return reject("INVALID_REQUEST");
    const request = parsed.data;
    if (
      request.deviceSwitchRequestId !== this.#deviceSwitchRequestId ||
      request.capabilityJti !== this.#capabilityJti
    ) {
      return reject("BINDING_MISMATCH");
    }
    if (request.requestDigest !== digest(encodeBootstrapStepRequestDigestInput(request))) {
      return reject("DIGEST_MISMATCH");
    }

    const prior = this.#accepted.get(request.stepNumber);
    if (prior !== undefined) {
      return prior.stepNonce === request.stepNonce && prior.requestDigest === request.requestDigest
        ? prior.result
        : reject("STEP_REPLAY_CONFLICT");
    }
    if (this.#phase === "completed") return reject("WORKFLOW_COMPLETED");
    if (request.stepNumber !== this.#nextStepNumber) return reject("STEP_OUT_OF_ORDER");
    if (request.expectedWorkflowRevision !== this.#workflowRevision) {
      return reject("WORKFLOW_REVISION_STALE");
    }
    if (request.stepNonce !== this.#stepNonceFor(request.stepNumber)) return reject("NONCE_MISMATCH");

    const result = this.#executeExpectedStep(request);
    if (isRejection(result)) return result;
    this.#workflowRevision += 1;
    this.#nextStepNumber += 1;
    const finalized = withResultDigest({
      ...result,
      workflowRevision: this.#workflowRevision,
      nextStepNonce: result.stepKind === "submit_rebuild_digest"
        ? null
        : this.#stepNonceFor(this.#nextStepNumber),
    });
    this.#accepted.set(request.stepNumber, {
      stepNonce: request.stepNonce,
      requestDigest: request.requestDigest,
      result: finalized,
    });
    return finalized;
  }

  #executeExpectedStep(
    request: BootstrapStepRequest,
  ): BootstrapResultDraft | BootstrapFixtureRejection {
    if (this.#phase === "awaiting_pin") return this.#pinCheckpoint(request);
    if (this.#phase === "fetching") return this.#fetchMutations(request);
    return this.#submitRebuildDigest(request);
  }

  #pinCheckpoint(
    request: BootstrapStepRequest,
  ): BootstrapResultDraft | BootstrapFixtureRejection {
    if (request.stepKind !== "pin_checkpoint") return reject("STEP_OUT_OF_ORDER");
    if (
      request.stepPayload.checkpointId !== this.#checkpoint.checkpointId ||
      request.stepPayload.checkpointRevision !== this.#checkpoint.throughRevision ||
      request.stepPayload.checkpointDigest !== this.#checkpoint.checkpointDigest
    ) {
      return reject("CHECKPOINT_MISMATCH");
    }
    this.#phase = "fetching";
    return {
      schemaVersion: BOOTSTRAP_STEP_SCHEMA_VERSION,
      acceptedStepNumber: request.stepNumber,
      stepKind: "pin_checkpoint",
      resultPayload: {
        checkpointId: this.#checkpoint.checkpointId,
        checkpointRevision: this.#checkpoint.throughRevision,
        checkpointDigest: this.#checkpoint.checkpointDigest,
        pinExpiresAt: new Date(this.#now().getTime() + this.#pinTtlSeconds * 1000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
      },
    };
  }

  #fetchMutations(
    request: BootstrapStepRequest,
  ): BootstrapResultDraft | BootstrapFixtureRejection {
    if (request.stepKind !== "fetch_mutations") return reject("STEP_OUT_OF_ORDER");
    const targetRevision = this.#checkpoint.throughRevision + this.#mutations.length;
    const payload = request.stepPayload;
    if (
      payload.pinnedCheckpointId !== this.#checkpoint.checkpointId ||
      payload.pinnedCheckpointRevision !== this.#checkpoint.throughRevision ||
      payload.pinnedCheckpointDigest !== this.#checkpoint.checkpointDigest
    ) {
      return reject("CHECKPOINT_MISMATCH");
    }
    if (
      payload.fromRevisionExclusive !== this.#returnedThroughRevision ||
      payload.throughRevisionInclusive !== targetRevision ||
      payload.cursor !== this.#nextCursor
    ) {
      return reject("MUTATION_CURSOR_MISMATCH");
    }

    const offset = this.#returnedThroughRevision - this.#checkpoint.throughRevision;
    const mutations = this.#mutations.slice(offset, offset + payload.pageLimit);
    const returnedThroughRevision =
      mutations.length === 0 ? this.#returnedThroughRevision : mutations[mutations.length - 1]!.serverRevision;
    const nextCursor = returnedThroughRevision < targetRevision ? `bootstrap-after-${returnedThroughRevision}` : null;
    const pageWithoutDigest = {
      schemaVersion: 1 as const,
      workspaceId: this.#checkpoint.workspaceId,
      fromRevisionExclusive: this.#returnedThroughRevision,
      throughRevisionInclusive: targetRevision,
      mutations,
      returnedThroughRevision,
      nextCursor,
    };
    const mutationPage = mutationPageSchema.parse({
      ...pageWithoutDigest,
      pageDigest: digest(encodeMutationPageDigestInput({ ...pageWithoutDigest, pageDigest: ZERO_DIGEST })),
    });
    this.#returnedThroughRevision = returnedThroughRevision;
    this.#nextCursor = nextCursor;
    if (nextCursor === null) this.#phase = "awaiting_digest";
    return {
      schemaVersion: BOOTSTRAP_STEP_SCHEMA_VERSION,
      acceptedStepNumber: request.stepNumber,
      stepKind: "fetch_mutations",
      resultPayload: { mutationPage },
    };
  }

  #submitRebuildDigest(
    request: BootstrapStepRequest,
  ): BootstrapResultDraft | BootstrapFixtureRejection {
    if (request.stepKind !== "submit_rebuild_digest") return reject("STEP_OUT_OF_ORDER");
    const targetRevision = this.#checkpoint.throughRevision + this.#mutations.length;
    if (
      request.stepPayload.targetRevision !== targetRevision ||
      request.stepPayload.workspaceSchemaVersion !== this.#checkpoint.workspaceSchemaVersion ||
      !equalBytes(
        encodeWorkspaceEntityDigestsInput(request.stepPayload.entityDigests),
        encodeWorkspaceEntityDigestsInput(this.#expectedEntityDigests),
      )
    ) {
      return reject("REBUILD_DIGEST_MISMATCH");
    }
    this.#phase = "completed";
    return {
      schemaVersion: BOOTSTRAP_STEP_SCHEMA_VERSION,
      acceptedStepNumber: request.stepNumber,
      stepKind: "submit_rebuild_digest",
      resultPayload: {
        verifiedRevision: targetRevision,
        verifiedDigest: digest(encodeWorkspaceEntityDigestsInput(this.#expectedEntityDigests)),
        accepted: true,
      },
    };
  }
}

const ZERO_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function withResultDigest(
  result: BootstrapResultWithoutDigest,
): BootstrapStepResult {
  return bootstrapStepResultSchema.parse({
    ...result,
    resultDigest: digest(encodeBootstrapStepResultDigestInput({ ...result, resultDigest: ZERO_DIGEST })),
  });
}

function reject(code: BootstrapFixtureRejectionCode): BootstrapFixtureRejection {
  return { accepted: false, code };
}

function isRejection(
  value: BootstrapResultDraft | BootstrapFixtureRejection,
): value is BootstrapFixtureRejection {
  return "accepted" in value && value.accepted === false;
}
