import { bootstrapCapabilityEnvelopeSchema } from "@gooddealer/protocol/devices";
import type { CheckpointDescriptor, MutationPage } from "@gooddealer/protocol/workspace";

import type { ActiveDeviceLeaseClaims } from "./lease-lifecycle";

export interface CheckpointCatalogPort {
  selectPublishedCheckpoint(workspaceId: string, checkpointId: string): Promise<CheckpointDescriptor | null>;
  pinCheckpoint(workspaceId: string, checkpointId: string, until: string): Promise<boolean>;
  releasePin(workspaceId: string, checkpointId: string, workflowId: string): Promise<void>;
}

export interface WorkspaceRevisionPort {
  readHead(workspaceId: string): Promise<{
    readonly serverRevision: number;
    readonly workspaceSchemaVersion: number;
  }>;
}

export interface MutationPagePort {
  readPage(request: {
    readonly workspaceId: string;
    readonly fromRevisionExclusive: number;
    readonly throughRevisionInclusive: number;
    readonly cursor: string | null;
    readonly pageLimit: number;
  }): Promise<MutationPage>;
}

export interface DeviceCursorPort {
  retireCursor(workspaceId: string, deviceId: string, reason: "replaced" | "device_removed"): Promise<void>;
  activateCursor(workspaceId: string, deviceId: string, atRevision: number): Promise<void>;
}

export interface DrainVerificationPort {
  verifyHandoff(input: {
    readonly workflowId: string;
    readonly fromDeviceId: string;
    readonly leaseEpoch: number;
    readonly manifest: unknown;
  }): Promise<
    | { readonly accepted: true }
    | { readonly accepted: false; readonly reason: "unimplemented" | "gap" | "digest" | "binding" }
  >;
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

/** Fixture seam for P0-17: normal handoff remains unavailable. */
export class DenyingDrainVerifier implements DrainVerificationPort {
  async verifyHandoff(): Promise<{ readonly accepted: false; readonly reason: "unimplemented" }> {
    return { accepted: false, reason: "unimplemented" };
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
