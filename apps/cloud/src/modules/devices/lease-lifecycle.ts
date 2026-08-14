import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  activeDeviceLeaseStatusSchema,
  type ActiveDeviceLeaseStatus,
} from "@gooddealer/protocol/devices";

import {
  DenyingLeaseSigner,
  SystemTrustedTime,
  type EntitlementDeadlinePort,
  type LeaseSignerPort,
  type TrustedTimePort,
} from "./ports";

export const LEASE_RENEW_AFTER_SECONDS = 5 * 60;
export const LEASE_ONLINE_TTL_SECONDS = 15 * 60;
export const LEASE_OFFLINE_CEILING_SECONDS = 24 * 60 * 60;

/** Unsigned claims only. Missing signer-owned key id and signature keeps this from being an envelope. */
export interface ActiveDeviceLeaseClaims {
  readonly typ: "gd.active-device-lease.v1";
  readonly aud: "gooddealer-desktop/active-device-lease";
  readonly accountId: string;
  readonly deviceId: string;
  readonly accountSecurityEpoch: number;
  readonly jti: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly payload: {
    readonly leaseEpoch: number;
    readonly renewAfter: string;
    readonly onlineExpiresAt: string;
    readonly offlineExecuteUntil: string;
  };
}

export interface HeldLeaseRecord {
  readonly deviceId: string;
  readonly leaseEpoch: number;
  readonly issuedAt: string;
  readonly renewAfter: string;
  readonly onlineExpiresAt: string;
  readonly offlineExecuteUntil: string;
  readonly releasedAt: string | null;
}

interface AccountLeaseState {
  currentLeaseEpoch: number;
  highestAllocatedEpoch: number;
  held: HeldLeaseRecord | null;
  pendingByWorkflow: Map<string, number>;
}

export interface LeaseLifecycleOptions {
  readonly signer?: LeaseSignerPort;
  readonly trustedTime?: TrustedTimePort;
  readonly seed?: Readonly<Record<string, {
    readonly currentLeaseEpoch: number;
    readonly highestAllocatedEpoch?: number;
    readonly held?: HeldLeaseRecord | null;
  }>>;
}

export type LeaseAttemptResult = {
  readonly issued: false;
  readonly code: "LEASE_ISSUANCE_DISABLED";
  readonly claims: ActiveDeviceLeaseClaims;
};

/** In-memory lifecycle model. P0-16 can allocate/burn epochs but cannot persist an issued lease. */
export class ActiveDeviceLeaseLifecycle {
  readonly #signer: LeaseSignerPort;
  readonly #trustedTime: TrustedTimePort;
  readonly #accounts = new Map<string, AccountLeaseState>();

  constructor(options: LeaseLifecycleOptions = {}) {
    this.#signer = options.signer ?? new DenyingLeaseSigner();
    this.#trustedTime = options.trustedTime ?? new SystemTrustedTime();
    for (const [accountId, seed] of Object.entries(options.seed ?? {})) {
      const highestAllocatedEpoch = seed.highestAllocatedEpoch ?? seed.currentLeaseEpoch;
      if (highestAllocatedEpoch < seed.currentLeaseEpoch) {
        throw new TypeError("highest allocated lease epoch cannot precede the current epoch");
      }
      this.#accounts.set(accountId, {
        currentLeaseEpoch: seed.currentLeaseEpoch,
        highestAllocatedEpoch,
        held: seed.held ?? null,
        pendingByWorkflow: new Map(),
      });
    }
  }

  /** Atomic fixture analogue of predecessor release plus monotone pending-epoch allocation. */
  beginBootstrap(accountId: string, workflowId: string, predecessorDeviceId: string | null): number {
    const state = this.#state(accountId);
    const existing = state.pendingByWorkflow.get(workflowId);
    if (existing !== undefined) return existing;

    state.highestAllocatedEpoch += 1;
    const pendingEpoch = state.highestAllocatedEpoch;
    state.pendingByWorkflow.set(workflowId, pendingEpoch);
    if (predecessorDeviceId !== null && state.held?.deviceId === predecessorDeviceId) {
      state.held = { ...state.held, releasedAt: this.#trustedTime.now() };
    }
    return pendingEpoch;
  }

  /** Cancelling burns the allocation: highestAllocatedEpoch deliberately does not decrease. */
  discardPending(accountId: string, workflowId: string): void {
    this.#state(accountId).pendingByWorkflow.delete(workflowId);
  }

  pendingEpoch(accountId: string, workflowId: string): number | null {
    return this.#state(accountId).pendingByWorkflow.get(workflowId) ?? null;
  }

  currentLeaseEpoch(accountId: string): number {
    return this.#state(accountId).currentLeaseEpoch;
  }

  highestAllocatedEpoch(accountId: string): number {
    return this.#state(accountId).highestAllocatedEpoch;
  }

  computeClaims(input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly accountSecurityEpoch: number;
    readonly workflowId: string;
    readonly jti: string;
    readonly entitlement: {
      readonly offlineGraceUntil: string;
      readonly commercialExpiresAt: string | null;
    };
    readonly accountSecurityDeadline?: string | null;
  }): ActiveDeviceLeaseClaims {
    const pendingEpoch = this.pendingEpoch(input.accountId, input.workflowId);
    if (pendingEpoch === null) throw new TypeError("workflow has no pending lease epoch");

    const issuedAt = this.#trustedTime.now();
    const renewAfter = addSeconds(issuedAt, LEASE_RENEW_AFTER_SECONDS);
    const onlineExpiresAt = addSeconds(issuedAt, LEASE_ONLINE_TTL_SECONDS);
    const offlineExecuteUntil = minimumTimestamp([
      addSeconds(issuedAt, LEASE_OFFLINE_CEILING_SECONDS),
      input.entitlement.offlineGraceUntil,
      input.entitlement.commercialExpiresAt,
      input.accountSecurityDeadline ?? null,
    ]);
    if (!(issuedAt < renewAfter && renewAfter < onlineExpiresAt && onlineExpiresAt <= offlineExecuteUntil)) {
      throw new TypeError("authorization deadlines cannot satisfy the active lease window");
    }

    return {
      typ: "gd.active-device-lease.v1",
      aud: "gooddealer-desktop/active-device-lease",
      accountId: input.accountId,
      deviceId: input.deviceId,
      accountSecurityEpoch: input.accountSecurityEpoch,
      jti: input.jti,
      issuedAt,
      expiresAt: offlineExecuteUntil,
      payload: {
        leaseEpoch: pendingEpoch,
        renewAfter,
        onlineExpiresAt,
        offlineExecuteUntil,
      },
    };
  }

  async attemptIssue(claims: ActiveDeviceLeaseClaims): Promise<LeaseAttemptResult> {
    const result = await this.#signer.signActiveDeviceLease(claims);
    return { issued: result.issued, code: "LEASE_ISSUANCE_DISABLED", claims };
  }

  async renew(
    accountId: string,
    forcedWorkflowStatus: "waiting_expiry" | "requested" | "draining" | null,
    entitlementPort: EntitlementDeadlinePort,
    accountSecurityEpoch: number,
  ): Promise<LeaseAttemptResult | { readonly renewed: false; readonly code: "ACTIVE_DEVICE_CONFLICT" | "LEASE_NOT_HELD" }> {
    if (forcedWorkflowStatus === "waiting_expiry") {
      return { renewed: false, code: "ACTIVE_DEVICE_CONFLICT" };
    }
    const state = this.#state(accountId);
    if (state.held === null || state.held.releasedAt !== null) return { renewed: false, code: "LEASE_NOT_HELD" };
    const entitlement = await entitlementPort.read(accountId);
    const claims = this.computeRenewalClaims(accountId, state.held, accountSecurityEpoch, entitlement);
    return this.attemptIssue(claims);
  }

  computeRenewalClaims(
    accountId: string,
    held: HeldLeaseRecord,
    accountSecurityEpoch: number,
    entitlement: { readonly offlineGraceUntil: string; readonly commercialExpiresAt: string | null },
  ): ActiveDeviceLeaseClaims {
    const issuedAt = this.#trustedTime.now();
    const renewAfter = addSeconds(issuedAt, LEASE_RENEW_AFTER_SECONDS);
    const onlineExpiresAt = addSeconds(issuedAt, LEASE_ONLINE_TTL_SECONDS);
    const offlineExecuteUntil = minimumTimestamp([
      addSeconds(issuedAt, LEASE_OFFLINE_CEILING_SECONDS),
      entitlement.offlineGraceUntil,
      entitlement.commercialExpiresAt,
    ]);
    if (!(issuedAt < renewAfter && renewAfter < onlineExpiresAt && onlineExpiresAt <= offlineExecuteUntil)) {
      throw new TypeError("authorization deadlines cannot satisfy the active lease renewal window");
    }
    return {
      typ: "gd.active-device-lease.v1",
      aud: "gooddealer-desktop/active-device-lease",
      accountId,
      deviceId: held.deviceId,
      accountSecurityEpoch,
      jti: `renew-${held.leaseEpoch}-${Date.parse(issuedAt)}`,
      issuedAt,
      expiresAt: offlineExecuteUntil,
      payload: {
        leaseEpoch: held.leaseEpoch,
        renewAfter,
        onlineExpiresAt,
        offlineExecuteUntil,
      },
    };
  }

  removeActiveDevice(accountId: string, deviceId: string): string | null {
    const state = this.#state(accountId);
    if (state.held?.deviceId !== deviceId || state.held.releasedAt !== null) return null;
    const blockUntil = state.held.offlineExecuteUntil;
    state.held = { ...state.held, releasedAt: this.#trustedTime.now() };
    return blockUntil;
  }

  revokeForSecurity(accountId: string): void {
    const state = this.#state(accountId);
    if (state.held !== null && state.held.releasedAt === null) {
      state.held = { ...state.held, releasedAt: this.#trustedTime.now() };
    }
  }

  getStatus(accountId: string, evaluatedAt = this.#trustedTime.now()): ActiveDeviceLeaseStatus {
    const held = this.#state(accountId).held;
    if (held === null || held.releasedAt !== null) {
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
    const renewalState = evaluatedAt < held.renewAfter
      ? "fresh"
      : evaluatedAt < held.onlineExpiresAt
        ? "renewal_window"
        : evaluatedAt < held.offlineExecuteUntil
          ? "offline_grace"
          : "expired";
    return activeDeviceLeaseStatusSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      held: true,
      deviceId: held.deviceId,
      leaseEpoch: held.leaseEpoch,
      issuedAt: held.issuedAt,
      renewAfter: held.renewAfter,
      onlineExpiresAt: held.onlineExpiresAt,
      offlineExecuteUntil: held.offlineExecuteUntil,
      renewalState,
      evaluatedAt,
    });
  }

  #state(accountId: string): AccountLeaseState {
    let state = this.#accounts.get(accountId);
    if (state === undefined) {
      state = {
        currentLeaseEpoch: 0,
        highestAllocatedEpoch: 0,
        held: null,
        pendingByWorkflow: new Map(),
      };
      this.#accounts.set(accountId, state);
    }
    return state;
  }
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function minimumTimestamp(values: readonly (string | null)[]): string {
  const timestamps = values.filter((value): value is string => value !== null);
  if (timestamps.length === 0) throw new TypeError("at least one lease deadline is required");
  return timestamps.reduce((minimum, value) => value < minimum ? value : minimum);
}
