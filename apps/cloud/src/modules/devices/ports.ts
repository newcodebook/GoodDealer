import { bootstrapCapabilityEnvelopeSchema } from "@gooddealer/protocol/devices";
import {
  DRAIN_STREAM_GENESIS_DIGEST,
  type DrainStream,
} from "@gooddealer/protocol/execution-events";
import type { CheckpointDescriptor, MutationPage } from "@gooddealer/protocol/workspace";

import type { ActiveDeviceLeaseClaims } from "./lease-lifecycle";
import type { WorkspaceTenantScope } from "../workspace/tenant-scope";

export interface CheckpointCatalogPort {
  selectPublishedCheckpoint(scope: WorkspaceTenantScope, checkpointId: string): Promise<CheckpointDescriptor | null>;
  pinCheckpoint(scope: WorkspaceTenantScope, checkpointId: string, until: string): Promise<boolean>;
  releasePin(scope: WorkspaceTenantScope, checkpointId: string, workflowId: string): Promise<void>;
}

export interface WorkspaceRevisionPort {
  readHead(scope: WorkspaceTenantScope): Promise<{
    readonly serverRevision: number;
    readonly workspaceSchemaVersion: number;
  }>;
}

export interface MutationPagePort {
  readPage(scope: WorkspaceTenantScope, request: {
    readonly fromRevisionExclusive: number;
    readonly throughRevisionInclusive: number;
    readonly cursor: string | null;
    readonly pageLimit: number;
  }): Promise<MutationPage>;
}

export interface DeviceCursorPort {
  retireCursor(scope: WorkspaceTenantScope, deviceId: string, reason: "replaced" | "device_removed"): Promise<void>;
  activateCursor(scope: WorkspaceTenantScope, deviceId: string, atRevision: number): Promise<void>;
}

export type DrainRejectionReason =
  | "DRAIN_PROOF_MALFORMED"
  | "DRAIN_PROOF_PURPOSE_MISMATCH"
  | "DRAIN_PROOF_BINDING_MISMATCH"
  | "DRAIN_LEASE_NOT_HELD"
  | "DRAIN_PROOF_EXPIRED"
  | "DRAIN_PROOF_TTL_EXCESSIVE"
  | "DRAIN_PROOF_ID_CONFLICT"
  | "DRAIN_PROOF_CONSUMED"
  | "DRAIN_STREAM_GAP"
  | "DRAIN_STREAM_WATERMARK_SHORT"
  | "DRAIN_STREAM_DIGEST_MISMATCH"
  | "DRAIN_AUDIT_CHAIN_FORKED"
  | "DRAIN_SIGNATURE_UNVERIFIED";

export interface DrainStreamGapReport {
  readonly stream: DrainStream;
  readonly claimedLastAssignedSequence: number;
  readonly cloudContiguousReceivedThrough: number;
  readonly cloudHighestReceivedSequence: number;
  readonly missingRanges: readonly {
    readonly fromSequence: number;
    readonly toSequence: number;
  }[];
  readonly digestMatches: boolean;
}

export interface DrainRejection {
  readonly code: "DRAIN_PROOF_UNVERIFIED";
  readonly reason: DrainRejectionReason;
  readonly streams: readonly DrainStreamGapReport[];
}

export interface DrainVerificationPort {
  verifyHandoff(input: {
    readonly workflowId: string;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly fromDeviceId: string;
    readonly leaseEpoch: number;
    readonly evaluatedAt: string;
    readonly manifest: unknown;
  }): Promise<
    | {
      readonly accepted: true;
      readonly proofId: string;
      readonly proofDigest: string;
      readonly sealClaims: VerifiedDrainSealClaims;
    }
    | {
      readonly accepted: false;
      readonly reason: DrainRejectionReason;
      readonly streams: readonly DrainStreamGapReport[];
    }
  >;
}

export interface VerifiedDrainSealClaims {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly lastAssignedSequence: Readonly<Record<DrainStream, number>>;
}

/**
 * Transaction participant owned by one drain ledger; claims are supplied only by verification.
 * A thrown installation must leave the participant unchanged; a successful installation returns
 * the compensating action used by the fixture transaction.
 */
export interface DrainSealParticipantPort<Stream extends DrainStream = DrainStream> {
  installAcceptedDrainSeal(scope: WorkspaceTenantScope, input: {
    readonly sourceDeviceId: string;
    readonly activeLeaseEpoch: number;
    readonly stream: Stream;
    readonly lastAssignedSequence: number;
  }): { rollback(): void };
}

export interface DrainStreamWatermarkPort {
  readWatermark(scope: WorkspaceTenantScope, domain: {
    readonly sourceDeviceId: string;
    readonly activeLeaseEpoch: number;
    readonly stream: DrainStream;
  }): Promise<{
    readonly contiguousReceivedThrough: number;
    readonly highestReceivedSequence: number;
    readonly missingRanges: readonly {
      readonly fromSequence: number;
      readonly toSequence: number;
    }[];
    readonly rollingDigest: string;
  }>;
}

export interface AuditChainRegistryPort {
  readChainRegistration(scope: WorkspaceTenantScope, input: {
    readonly sourceDeviceId: string;
    readonly activeLeaseEpoch: number;
  }): Promise<{
    readonly chainId: string;
    readonly headSequence: number;
    readonly headHash: string;
    readonly forked: boolean;
  } | null>;
}

export interface DrainProofSignaturePort {
  /** P0-17 Fallback: this return type deliberately cannot express success. */
  checkDrainProofSignature(input: {
    readonly transcript: Uint8Array;
    readonly signature: string;
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
    readonly sourceDeviceId: string;
  }): Promise<{
    readonly verified: false;
    readonly reason: "signature_verification_disabled";
  }>;
}

export interface DrainLeaseStatePort {
  readHeldLease(accountId: string): {
    readonly deviceId: string;
    readonly leaseEpoch: number;
    readonly releasedAt: string | null;
  } | null;
}

export interface DrainProofConsumptionPort {
  inspectProof(proofId: string, proofDigest: string):
    | { readonly status: "unseen" }
    | { readonly status: "seen"; readonly consumed: false }
    | { readonly status: "consumed"; readonly accepted: boolean }
    | { readonly status: "conflict" };
  rememberProof(proofId: string, proofDigest: string): void;
  consumeProof(input: {
    readonly proofId: string;
    readonly proofDigest: string;
    readonly consumedAt: string;
    readonly acceptedAt: string;
    readonly purpose: "handoff";
  }): { rollback(): void };
}

export type CapabilityRejectionReason =
  | "malformed"
  | "type"
  | "issuer"
  | "audience"
  | "binding"
  | "window"
  | "expired";

export interface BootstrapCapabilityBinding {
  readonly accountId: string;
  readonly deviceId: string;
  readonly accountSecurityEpoch: number;
  readonly jti: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly deviceSwitchRequestId: string;
  readonly evaluatedAt: string;
}

export interface CapabilityVerifierPort {
  verifyBootstrapCapability(
    presented: unknown,
    expected: BootstrapCapabilityBinding,
  ): Promise<
    | { readonly accepted: true }
    | { readonly accepted: false; readonly reason: CapabilityRejectionReason }
  >;
}

export interface LeaseSignerPort {
  /** P0-16 deliberately has no success variant. Widening this type requires a later Gate decision. */
  signActiveDeviceLease(
    claims: ActiveDeviceLeaseClaims,
  ): Promise<{ readonly issued: false; readonly reason: "lease_issuance_disabled" }>;
}

export interface TrustedTimePort {
  now(): string;
}

export interface AccountSecurityPort {
  read(accountId: string): Promise<{
    readonly accountSecurityEpoch: number;
    readonly state: "normal" | "recovery_pending";
  }>;
}

export interface EntitlementDeadlinePort {
  read(accountId: string): Promise<{
    readonly active: boolean;
    readonly offlineGraceUntil: string;
    readonly commercialExpiresAt: string | null;
  }>;
}

/** Explicit blunt-refusal seam; the default composition uses the real verifier. */
export class DenyingDrainVerifier implements DrainVerificationPort {
  async verifyHandoff(): Promise<{
    readonly accepted: false;
    readonly reason: "DRAIN_SIGNATURE_UNVERIFIED";
    readonly streams: readonly [];
  }> {
    return { accepted: false, reason: "DRAIN_SIGNATURE_UNVERIFIED", streams: [] };
  }
}

export class RefusingDrainProofSignature implements DrainProofSignaturePort {
  async checkDrainProofSignature(): Promise<{
    readonly verified: false;
    readonly reason: "signature_verification_disabled";
  }> {
    return { verified: false, reason: "signature_verification_disabled" };
  }
}

export class FailClosedDrainStreamWatermarks implements DrainStreamWatermarkPort {
  async readWatermark(): Promise<{
    readonly contiguousReceivedThrough: 0;
    readonly highestReceivedSequence: 0;
    readonly missingRanges: readonly [{ readonly fromSequence: 1; readonly toSequence: 1 }];
    readonly rollingDigest: typeof DRAIN_STREAM_GENESIS_DIGEST;
  }> {
    return {
      contiguousReceivedThrough: 0,
      highestReceivedSequence: 0,
      missingRanges: [{ fromSequence: 1, toSequence: 1 }],
      rollingDigest: DRAIN_STREAM_GENESIS_DIGEST,
    };
  }
}

export class FailClosedAuditChainRegistry implements AuditChainRegistryPort {
  async readChainRegistration(): Promise<null> {
    return null;
  }
}

export class FailClosedDrainLeaseState implements DrainLeaseStatePort {
  readHeldLease(): null {
    return null;
  }
}

/**
 * Parses and checks capability bindings but intentionally performs no signature verification.
 * Production must replace this only when R0-06 has a trusted verification-key registry.
 */
export class BindingOnlyCapabilityVerifier implements CapabilityVerifierPort {
  async verifyBootstrapCapability(
    presented: unknown,
    expected: BootstrapCapabilityBinding,
  ): Promise<
    | { readonly accepted: true }
    | { readonly accepted: false; readonly reason: CapabilityRejectionReason }
  > {
    if (!isRecord(presented)) return { accepted: false, reason: "malformed" };
    if (presented.typ !== "gd.bootstrap-capability.v1") return { accepted: false, reason: "type" };
    if (presented.iss !== "https://accounts.gooddealer.com") return { accepted: false, reason: "issuer" };
    if (presented.aud !== "gooddealer-desktop/bootstrap") return { accepted: false, reason: "audience" };

    const parsed = bootstrapCapabilityEnvelopeSchema.safeParse(presented);
    if (!parsed.success) return { accepted: false, reason: "malformed" };
    const capability = parsed.data;
    if (
      capability.accountId !== expected.accountId ||
      capability.deviceId !== expected.deviceId ||
      capability.accountSecurityEpoch !== expected.accountSecurityEpoch ||
      capability.jti !== expected.jti ||
      capability.issuedAt !== expected.issuedAt ||
      capability.expiresAt !== expected.expiresAt ||
      capability.payload.deviceSwitchRequestId !== expected.deviceSwitchRequestId
    ) {
      return { accepted: false, reason: "binding" };
    }
    if (capability.issuedAt >= capability.expiresAt) return { accepted: false, reason: "window" };
    if (expected.evaluatedAt >= capability.expiresAt) return { accepted: false, reason: "expired" };
    return { accepted: true };
  }
}

/** P0-16 Fallback: issuance is structurally impossible through this port. */
export class DenyingLeaseSigner implements LeaseSignerPort {
  async signActiveDeviceLease(): Promise<{
    readonly issued: false;
    readonly reason: "lease_issuance_disabled";
  }> {
    return { issued: false, reason: "lease_issuance_disabled" };
  }
}

export class SystemTrustedTime implements TrustedTimePort {
  now(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

export class DenyingCheckpointCatalog implements CheckpointCatalogPort {
  async selectPublishedCheckpoint(): Promise<null> {
    return null;
  }

  async pinCheckpoint(): Promise<false> {
    return false;
  }

  async releasePin(): Promise<void> {
    // There is no pin to release in the denying implementation.
  }
}

export class DenyingWorkspaceRevisionReader implements WorkspaceRevisionPort {
  async readHead(): Promise<never> {
    throw new Error("workspace revision reads are unavailable in the P0-16 default");
  }
}

export class DenyingMutationPageReader implements MutationPagePort {
  async readPage(): Promise<never> {
    throw new Error("mutation page reads are unavailable in the P0-16 default");
  }
}

export class DenyingDeviceCursor implements DeviceCursorPort {
  async retireCursor(): Promise<never> {
    throw new Error("device cursor retirement is unavailable in the P0-16 default");
  }

  async activateCursor(): Promise<never> {
    throw new Error("device cursor activation is unavailable in the P0-16 default");
  }
}

export class DenyingAccountSecurityReader implements AccountSecurityPort {
  async read(): Promise<{ readonly accountSecurityEpoch: 1; readonly state: "recovery_pending" }> {
    return { accountSecurityEpoch: 1, state: "recovery_pending" };
  }
}

export class DenyingEntitlementDeadlineReader implements EntitlementDeadlinePort {
  constructor(private readonly trustedTime: TrustedTimePort = new SystemTrustedTime()) {}

  async read(): Promise<{
    readonly active: false;
    readonly offlineGraceUntil: string;
    readonly commercialExpiresAt: null;
  }> {
    return {
      active: false,
      offlineGraceUntil: this.trustedTime.now(),
      commercialExpiresAt: null,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
