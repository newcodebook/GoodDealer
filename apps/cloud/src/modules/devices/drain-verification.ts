import { createHash } from "node:crypto";

import {
  DRAIN_STREAMS,
  drainProofSchema,
  encodeDrainProofDigestInput,
  encodeDrainProofSignatureTranscript,
  type DrainManifest,
  type DrainStream,
} from "@gooddealer/protocol/execution-events";

import {
  FailClosedAuditChainRegistry,
  FailClosedDrainLeaseState,
  FailClosedDrainStreamWatermarks,
  RefusingDrainProofSignature,
  type AuditChainRegistryPort,
  type DrainLeaseStatePort,
  type DrainProofConsumptionPort,
  type DrainProofSignaturePort,
  type DrainRejectionReason,
  type DrainStreamGapReport,
  type DrainStreamWatermarkPort,
  type DrainVerificationPort,
  type VerifiedDrainSealClaims,
} from "./ports";

export const DRAIN_PROOF_MAX_TTL_SECONDS = 600;

interface StoredProofIdentity {
  readonly proofDigest: string;
  readonly consumed: boolean;
  readonly accepted: boolean;
  readonly consumedAt: string | null;
  readonly acceptedAt: string | null;
  readonly purpose: "handoff" | null;
}

/** In-memory identity and consumption registry shared by verification and the release transaction. */
export class InMemoryDrainProofRegistry implements DrainProofConsumptionPort {
  readonly #proofs = new Map<string, StoredProofIdentity>();

  inspectProof(proofId: string, proofDigest: string):
    | { readonly status: "unseen" }
    | { readonly status: "seen"; readonly consumed: false }
    | { readonly status: "consumed"; readonly accepted: boolean }
    | { readonly status: "conflict" } {
    const stored = this.#proofs.get(proofId);
    if (stored === undefined) return { status: "unseen" };
    if (stored.proofDigest !== proofDigest) return { status: "conflict" };
    if (!stored.consumed) return { status: "seen", consumed: false };
    return { status: "consumed", accepted: stored.accepted };
  }

  rememberProof(proofId: string, proofDigest: string): void {
    const stored = this.#proofs.get(proofId);
    if (stored !== undefined && stored.proofDigest !== proofDigest) {
      throw new TypeError("proof id is already bound to a different digest");
    }
    if (stored === undefined) {
      this.#proofs.set(proofId, {
        proofDigest,
        consumed: false,
        accepted: false,
        consumedAt: null,
        acceptedAt: null,
        purpose: null,
      });
    }
  }

  consumeProof(input: {
    readonly proofId: string;
    readonly proofDigest: string;
    readonly consumedAt: string;
    readonly acceptedAt: string;
    readonly purpose: "handoff";
  }): { rollback(): void } {
    const previous = this.#proofs.get(input.proofId);
    if (previous !== undefined && previous.proofDigest !== input.proofDigest) {
      throw new TypeError("proof id is already bound to a different digest");
    }
    if (previous?.consumed === true) {
      if (!previous.accepted) throw new TypeError("proof was consumed without an accepted verdict");
      return { rollback() {} };
    }
    this.#proofs.set(input.proofId, {
      proofDigest: input.proofDigest,
      consumed: true,
      accepted: true,
      consumedAt: input.consumedAt,
      acceptedAt: input.acceptedAt,
      purpose: input.purpose,
    });
    return {
      rollback: () => {
        if (previous === undefined) this.#proofs.delete(input.proofId);
        else this.#proofs.set(input.proofId, previous);
      },
    };
  }

  consumedRecord(proofId: string): StoredProofIdentity | null {
    const stored = this.#proofs.get(proofId);
    return stored === undefined ? null : { ...stored };
  }
}

export interface DrainVerifierOptions {
  readonly drainSignature?: DrainProofSignaturePort;
  readonly mutationWatermarks?: DrainStreamWatermarkPort;
  readonly executionFactWatermarks?: DrainStreamWatermarkPort;
  readonly deviceAuditWatermarks?: DrainStreamWatermarkPort;
  readonly auditChainRegistry?: AuditChainRegistryPort;
  readonly leaseState?: DrainLeaseStatePort;
  readonly proofRegistry?: DrainProofConsumptionPort;
}

/**
 * Checks Cloud-derived contiguous watermarks and digests against a cooperative device's signed
 * tail claims. This is not Byzantine completeness: Cloud cannot discover an omitted local tail.
 * Guards 9–12 deliberately finish all stream reads before selecting a rejection; guard 13 is last
 * only while P0-17's refusing signature Fallback remains in force.
 */
export class DrainVerifier implements DrainVerificationPort {
  readonly #drainSignature: DrainProofSignaturePort;
  readonly #watermarks: Readonly<Record<DrainStream, DrainStreamWatermarkPort>>;
  readonly #auditChainRegistry: AuditChainRegistryPort;
  readonly #leaseState: DrainLeaseStatePort;
  readonly #proofRegistry: DrainProofConsumptionPort;

  constructor(options: DrainVerifierOptions = {}) {
    this.#drainSignature = options.drainSignature ?? new RefusingDrainProofSignature();
    this.#watermarks = {
      mutation: options.mutationWatermarks ?? new FailClosedDrainStreamWatermarks(),
      execution_fact: options.executionFactWatermarks ?? new FailClosedDrainStreamWatermarks(),
      device_audit: options.deviceAuditWatermarks ?? new FailClosedDrainStreamWatermarks(),
    };
    this.#auditChainRegistry = options.auditChainRegistry ?? new FailClosedAuditChainRegistry();
    this.#leaseState = options.leaseState ?? new FailClosedDrainLeaseState();
    this.#proofRegistry = options.proofRegistry ?? new InMemoryDrainProofRegistry();
  }

  async verifyHandoff(input: {
    readonly workflowId: string;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly fromDeviceId: string;
    readonly leaseEpoch: number;
    readonly evaluatedAt: string;
    readonly manifest: unknown;
  }): ReturnType<DrainVerificationPort["verifyHandoff"]> {
    // Guard 1: strict parse and fixed envelope constants.
    const parsed = drainProofSchema.safeParse(input.manifest);
    if (!parsed.success) return rejection("DRAIN_PROOF_MALFORMED");
    const proof = parsed.data;

    // Guard 2: purpose and workflow binding are isolated before any storage read.
    if (proof.purpose !== "handoff" || proof.deviceSwitchRequestId !== input.workflowId) {
      return rejection("DRAIN_PROOF_PURPOSE_MISMATCH");
    }

    // Guard 3: derive every stream domain only from this header and the expected workflow.
    if (
      proof.workspaceId !== input.workspaceId ||
      proof.sourceDeviceId !== input.fromDeviceId ||
      proof.activeLeaseEpoch !== input.leaseEpoch
    ) {
      return rejection("DRAIN_PROOF_BINDING_MISMATCH");
    }

    // Guard 4: account-head epoch is never a substitute for the predecessor's held lease.
    const held = this.#leaseState.readHeldLease(input.accountId);
    if (
      held === null ||
      held.releasedAt !== null ||
      held.deviceId !== input.fromDeviceId ||
      held.leaseEpoch !== input.leaseEpoch
    ) {
      return rejection("DRAIN_LEASE_NOT_HELD");
    }

    // Guard 5: evaluatedAt is trusted orchestration time supplied by the caller.
    if (!(proof.issuedAt <= input.evaluatedAt && input.evaluatedAt < proof.expiresAt)) {
      return rejection("DRAIN_PROOF_EXPIRED");
    }

    // Guard 6: the proof chooses neither its own unbounded lifetime nor another feature's TTL.
    if (Date.parse(proof.expiresAt) - Date.parse(proof.issuedAt) > DRAIN_PROOF_MAX_TTL_SECONDS * 1_000) {
      return rejection("DRAIN_PROOF_TTL_EXCESSIVE");
    }

    const proofDigest = sha256Base64Url(encodeDrainProofDigestInput(proof));

    // Guard 7: a proof id is permanently bound to one complete signed-envelope digest.
    const identity = this.#proofRegistry.inspectProof(proof.proofId, proofDigest);
    if (identity.status === "conflict") return rejection("DRAIN_PROOF_ID_CONFLICT");
    this.#proofRegistry.rememberProof(proof.proofId, proofDigest);

    // Guard 8: an idempotent replay of a stored accepted verdict does not re-read stream state.
    if (identity.status === "consumed") {
      return identity.accepted
        ? {
          accepted: true,
          proofId: proof.proofId,
          proofDigest,
          sealClaims: sealClaimsFrom(proof),
        }
        : rejection("DRAIN_PROOF_CONSUMED");
    }

    // Guards 9–12: collect all Cloud facts before choosing the first frozen rejection reason.
    const reports: DrainStreamGapReport[] = [];
    let hasGap = false;
    let hasShortWatermark = false;
    let hasDigestMismatch = false;
    const claimsByStream = new Map(proof.streams.map((claim) => [claim.stream, claim] as const));
    for (const stream of DRAIN_STREAMS) {
      const claim = claimsByStream.get(stream);
      if (claim === undefined) return rejection("DRAIN_PROOF_MALFORMED");
      const cloud = await this.#readWatermarkFailClosed(
        { accountId: input.accountId, workspaceId: input.workspaceId },
        stream,
        proof,
      );
      const gap = cloud.missingRanges.length > 0;
      const short = cloud.contiguousReceivedThrough !== claim.contiguousReceivedThrough ||
        claim.contiguousReceivedThrough !== claim.lastAssignedSequence;
      const digestMismatch = cloud.rollingDigest !== claim.rollingDigest;
      hasGap ||= gap;
      hasShortWatermark ||= short;
      hasDigestMismatch ||= digestMismatch;
      reports.push({
        stream,
        claimedLastAssignedSequence: claim.lastAssignedSequence,
        cloudContiguousReceivedThrough: cloud.contiguousReceivedThrough,
        cloudHighestReceivedSequence: cloud.highestReceivedSequence,
        missingRanges: cloud.missingRanges,
        digestMatches: !digestMismatch,
      });
    }

    const deviceAuditClaim = claimsByStream.get("device_audit");
    const auditRegistration = await this.#readAuditRegistrationFailClosed(
      { accountId: input.accountId, workspaceId: input.workspaceId },
      proof,
    );
    const auditForked = deviceAuditClaim === undefined || auditRegistration === null ||
      auditRegistration.forked || auditRegistration.headSequence !== deviceAuditClaim.lastAssignedSequence;
    const failingReports = reports.filter((report) =>
      report.missingRanges.length > 0 ||
      report.cloudContiguousReceivedThrough !== report.claimedLastAssignedSequence ||
      !report.digestMatches ||
      (report.stream === "device_audit" && auditForked),
    );
    if (hasGap) return rejection("DRAIN_STREAM_GAP", failingReports);
    if (hasShortWatermark) return rejection("DRAIN_STREAM_WATERMARK_SHORT", failingReports);
    if (hasDigestMismatch) return rejection("DRAIN_STREAM_DIGEST_MISMATCH", failingReports);
    if (auditForked) return rejection("DRAIN_AUDIT_CHAIN_FORKED", failingReports);

    // Guard 13: structurally refusing signature port, intentionally last for P17-E-2.
    await this.#drainSignature.checkDrainProofSignature({
      transcript: encodeDrainProofSignatureTranscript(proof),
      signature: proof.deviceSignature,
      signingKeyId: proof.signingKeyId,
      signingKeyVersion: proof.signingKeyVersion,
      sourceDeviceId: proof.sourceDeviceId,
    });
    return rejection("DRAIN_SIGNATURE_UNVERIFIED");
  }

  async #readWatermarkFailClosed(
    scope: { readonly accountId: string; readonly workspaceId: string },
    stream: DrainStream,
    proof: DrainManifest,
  ) {
    try {
      return await this.#watermarks[stream].readWatermark(scope, {
        sourceDeviceId: proof.sourceDeviceId,
        activeLeaseEpoch: proof.activeLeaseEpoch,
        stream,
      });
    } catch {
      return {
        contiguousReceivedThrough: 0,
        highestReceivedSequence: 0,
        missingRanges: [{ fromSequence: 1, toSequence: Math.max(1, proof.streams.find((claim) => claim.stream === stream)?.lastAssignedSequence ?? 1) }],
        rollingDigest: "",
      };
    }
  }

  async #readAuditRegistrationFailClosed(
    scope: { readonly accountId: string; readonly workspaceId: string },
    proof: DrainManifest,
  ) {
    try {
      return await this.#auditChainRegistry.readChainRegistration(scope, {
        sourceDeviceId: proof.sourceDeviceId,
        activeLeaseEpoch: proof.activeLeaseEpoch,
      });
    } catch {
      return null;
    }
  }
}

function sealClaimsFrom(proof: DrainManifest): VerifiedDrainSealClaims {
  const claims = new Map(proof.streams.map((claim) => [claim.stream, claim.lastAssignedSequence] as const));
  const mutation = claims.get("mutation");
  const executionFact = claims.get("execution_fact");
  const deviceAudit = claims.get("device_audit");
  if (mutation === undefined || executionFact === undefined || deviceAudit === undefined) {
    throw new TypeError("verified drain manifest omitted a stream claim");
  }
  return {
    workspaceId: proof.workspaceId,
    sourceDeviceId: proof.sourceDeviceId,
    activeLeaseEpoch: proof.activeLeaseEpoch,
    lastAssignedSequence: {
      mutation,
      execution_fact: executionFact,
      device_audit: deviceAudit,
    },
  };
}

function rejection(
  reason: DrainRejectionReason,
  streams: readonly DrainStreamGapReport[] = [],
): { readonly accepted: false; readonly reason: DrainRejectionReason; readonly streams: readonly DrainStreamGapReport[] } {
  return { accepted: false, reason, streams };
}

function sha256Base64Url(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url");
}
