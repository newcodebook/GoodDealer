import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  ACCOUNT_SESSION_SCHEMA_VERSION,
  AUTH_SESSION_SCHEMA_VERSION,
  accountRejectionSchema,
  accountSessionListSchema,
  authSessionStatusSchema,
  reauthProofRefSchema,
  type AccountRejection,
  type AccountRejectionCode,
  type AccountSessionList,
  type AccountSessionClientKind,
  type AccountSessionRevokeRequest,
  type AuthLoginRequest,
  type AuthRevocationReason,
  type AuthRefreshRequest,
  type AuthSessionStatus,
  type AuthSignOutRequest,
  type ReauthProofRef,
} from "@gooddealer/protocol/account";

import type { IdentitySessionVerificationSnapshot } from "../../src/modules/identity/session-verifier";
import { SessionFamilyStore } from "../../src/modules/identity/session-families";

type AuthMethod = AuthLoginRequest["method"];

interface SessionRecord {
  readonly sessionId: string;
  readonly clientKind: AccountSessionClientKind;
  readonly deviceId: string | null;
  readonly method: AuthMethod;
  readonly createdAt: string;
  readonly rememberDevice: boolean;
  readonly expiresAt: string | null;
  displayName: string;
  lastSeenAt: string;
  rotationGeneration: number;
  accountSecurityEpoch: number;
  revokedAt: string | null;
  revocationReason: AuthSessionStatus["revocationReason"];
}

interface ReauthRecord {
  readonly proof: ReauthProofRef;
  readonly accountSecurityEpoch: number;
}

export interface RefreshFixtureContext {
  readonly sessionId: string;
  /** Credential identity obtained from the presented refresh envelope. */
  readonly presentedRefreshJti: string;
}

export interface IdentityFixtureOptions {
  readonly now?: () => Date;
  readonly boundDeviceIds?: readonly string[];
  readonly accountWebSessions?: readonly AccountWebSessionFixture[];
}

export interface AccountWebSessionFixture {
  readonly sessionId: string;
  readonly displayName: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export class IdentityFixtureService {
  readonly accountId = "internal-fixture-account" as const;
  readonly sellable = false;

  #accountSecurityEpoch = 1;
  #listRevision = 1;
  #nextSession = 1;
  #nextJti = 1;
  #nextProof = 1;
  #accountSecurityState: "normal" | "recovery_pending" = "normal";
  readonly #now: () => Date;
  readonly #boundDeviceIds: Set<string>;
  readonly #removedDeviceIds = new Set<string>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #families = new SessionFamilyStore();
  readonly #reauthProofs = new Map<string, ReauthRecord>();

  constructor(options: IdentityFixtureOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#boundDeviceIds = new Set(options.boundDeviceIds ?? ["fixture-device-active", "fixture-device-standby"]);
    for (const fixture of options.accountWebSessions ?? []) {
      const createdAt = canonicalTimestamp(fixture.createdAt);
      const expiresAt = canonicalTimestamp(fixture.expiresAt);
      if (createdAt >= expiresAt || this.#sessions.has(fixture.sessionId)) {
        throw new Error("invalid account-web session fixture");
      }
      const issued = this.#families.createFamily({
        familyId: fixture.sessionId,
        refreshJti: this.#newCredentialJti("refresh"),
        accessJti: this.#newCredentialJti("access"),
      });
      if (!issued.created) throw new Error("fixture credential JTI allocation failed closed");
      this.#sessions.set(fixture.sessionId, {
        sessionId: fixture.sessionId,
        clientKind: "account_web",
        deviceId: null,
        method: "password",
        createdAt,
        rememberDevice: false,
        expiresAt,
        displayName: fixture.displayName,
        lastSeenAt: createdAt,
        rotationGeneration: 0,
        accountSecurityEpoch: this.#accountSecurityEpoch,
        revokedAt: null,
        revocationReason: null,
      });
      this.#listRevision += 1;
    }
  }

  login(request: AuthLoginRequest): AuthSessionStatus | AccountRejection {
    if (!this.#boundDeviceIds.has(request.deviceId)) {
      return this.#reject("DEVICE_NOT_BOUND");
    }

    const now = this.#timestamp();
    for (const session of this.#sessions.values()) {
      if (session.revokedAt === null && session.deviceId === request.deviceId) {
        this.#revoke(session, now, "remote_sign_out");
      }
    }
    const session: SessionRecord = {
      sessionId: `fixture-session-${this.#nextSession++}`,
      clientKind: "desktop",
      deviceId: request.deviceId,
      method: request.method,
      createdAt: now,
      rememberDevice: request.rememberDevice,
      expiresAt: null,
      displayName: request.deviceId,
      lastSeenAt: now,
      rotationGeneration: 0,
      accountSecurityEpoch: this.#accountSecurityEpoch,
      revokedAt: null,
      revocationReason: null,
    };
    const issued = this.#families.createFamily({
      familyId: session.sessionId,
      refreshJti: this.#newCredentialJti("refresh"),
      accessJti: this.#newCredentialJti("access"),
    });
    if (!issued.created) throw new Error("fixture credential JTI allocation failed closed");
    this.#sessions.set(session.sessionId, session);
    this.#listRevision += 1;
    return this.#status(session, "authenticated");
  }

  refresh(request: AuthRefreshRequest, context: RefreshFixtureContext): AuthSessionStatus | AccountRejection {
    const inspection = this.#families.inspectRotation(context.sessionId, context.presentedRefreshJti);
    if (inspection.status === "invalid_credentials") return this.#reject("INVALID_CREDENTIALS");
    const session = this.#sessions.get(context.sessionId);
    if (session === undefined) {
      return this.#reject("INVALID_CREDENTIALS");
    }
    if (session.deviceId !== request.deviceId) {
      return this.#reject("DEVICE_NOT_BOUND");
    }
    if (this.#removedDeviceIds.has(request.deviceId)) {
      if (request.reason === "startup") return this.#signedOutStatus();
      return this.#reject("DEVICE_REMOVED");
    }
    if (!this.#boundDeviceIds.has(request.deviceId)) return this.#reject("DEVICE_NOT_BOUND");
    if (session.accountSecurityEpoch !== this.#accountSecurityEpoch) {
      if (request.reason === "startup") return this.#signedOutStatus();
      return this.#reject("ACCOUNT_SECURITY_EPOCH_STALE");
    }
    if (this.#accountSecurityState === "recovery_pending") {
      if (request.reason === "startup") return this.#signedOutStatus();
      return this.#reject("ACCOUNT_RECOVERY_PENDING");
    }
    if (session.revokedAt !== null || inspection.status === "session_revoked") {
      if (request.reason === "startup") return this.#signedOutStatus();
      return this.#reject("SESSION_REVOKED");
    }
    if (request.reason === "startup" && !session.rememberDevice) return this.#signedOutStatus();
    if (inspection.status === "refresh_reuse_detected") {
      const now = this.#timestamp();
      this.#revoke(session, now, "refresh_reuse_detected");
      return this.#reject("REFRESH_REUSE_DETECTED");
    }

    const committed = this.#families.commitRotation(inspection.preparation, {
      refreshJti: this.#newCredentialJti("refresh"),
      accessJti: this.#newCredentialJti("access"),
    });
    if (committed.status === "refresh_rotation_conflict") return this.#reject("REFRESH_ROTATION_CONFLICT");
    if (committed.status === "session_revoked") return this.#reject("SESSION_REVOKED");
    if (committed.status === "credential_jti_conflict") return this.#reject("INVALID_CREDENTIALS");

    session.rotationGeneration = committed.rotationGeneration;
    session.lastSeenAt = this.#timestamp();
    return this.#status(session, "authenticated");
  }

  readCurrentRefreshJti(sessionId: string): string | null {
    return this.#families.currentRefreshJti(sessionId);
  }

  readAccountSecurityEpoch(): number {
    return this.#accountSecurityEpoch;
  }

  readSessionVerification(sessionId: string): IdentitySessionVerificationSnapshot | null {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return null;
    return {
      sessionId: session.sessionId,
      accountId: this.accountId,
      clientKind: session.clientKind,
      expiresAt: session.expiresAt,
      sessionAccountSecurityEpoch: session.accountSecurityEpoch,
      currentAccountSecurityEpoch: this.#accountSecurityEpoch,
      familyState: this.#families.familyState(sessionId),
    };
  }

  signOut(request: AuthSignOutRequest, currentSessionId: string): AuthSessionStatus | AccountRejection {
    const current = this.#sessions.get(currentSessionId);
    if (current === undefined || current.revokedAt !== null) {
      return this.#reject("SESSION_REVOKED");
    }
    if (request.scope === "all_devices") {
      const proofFailure = this.#checkReauth(request.reauthProofId);
      if (proofFailure !== null) return proofFailure;
    }

    const now = this.#timestamp();
    if (request.scope === "this_device") {
      this.#revoke(current, now, "user_signed_out");
    } else {
      for (const session of this.#sessions.values()) {
        if (session.revokedAt === null) this.#revoke(session, now, "remote_sign_out");
      }
    }
    return this.#signedOutStatus();
  }

  listSessions(currentSessionId: string): AccountSessionList {
    return accountSessionListSchema.parse({
      schemaVersion: ACCOUNT_SESSION_SCHEMA_VERSION,
      listRevision: this.#listRevision,
      sessions: [...this.#sessions.values()].map((session) => ({
        schemaVersion: ACCOUNT_SESSION_SCHEMA_VERSION,
        sessionId: session.sessionId,
        clientKind: session.clientKind,
        deviceId: session.deviceId,
        displayName: session.displayName,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        currentSession: session.sessionId === currentSessionId && session.revokedAt === null,
        status: session.revokedAt === null ? "active" : "revoked",
        revokedAt: session.revokedAt,
      })),
    });
  }

  revokeSessions(request: AccountSessionRevokeRequest, currentSessionId: string): AccountSessionList | AccountRejection {
    if (request.expectedListRevision !== this.#listRevision) {
      return this.#reject("LIST_REVISION_STALE");
    }
    if (request.scope === "all_other_sessions") {
      const proofFailure = this.#checkReauth(request.reauthProofId);
      if (proofFailure !== null) return proofFailure;
    }

    const now = this.#timestamp();
    if (request.scope === "session") {
      const target = this.#sessions.get(request.sessionId);
      if (target === undefined || target.revokedAt !== null) return this.#reject("SESSION_REVOKED");
      this.#revoke(target, now, target.sessionId === currentSessionId ? "user_signed_out" : "remote_sign_out");
    } else {
      for (const session of this.#sessions.values()) {
        if (session.sessionId !== currentSessionId && session.revokedAt === null) {
          this.#revoke(session, now, "remote_sign_out");
        }
      }
    }
    return this.listSessions(currentSessionId);
  }

  issueReauthProof(method: AuthMethod, lifetimeSeconds = 300): ReauthProofRef {
    const verifiedAt = this.#now();
    const proof = reauthProofRefSchema.parse({
      schemaVersion: AUTH_SESSION_SCHEMA_VERSION,
      reauthProofId: `fixture-reauth-${this.#nextProof++}`,
      method,
      verifiedAt: canonicalTimestamp(verifiedAt),
      expiresAt: canonicalTimestamp(new Date(verifiedAt.getTime() + lifetimeSeconds * 1_000)),
    });
    this.#reauthProofs.set(proof.reauthProofId, { proof, accountSecurityEpoch: this.#accountSecurityEpoch });
    return proof;
  }

  checkReauthProof(reauthProofId: string): AccountRejection | null {
    return this.#checkReauth(reauthProofId);
  }

  advanceAccountSecurityEpoch(): AccountSessionList {
    this.#accountSecurityEpoch += 1;
    const now = this.#timestamp();
    for (const session of this.#sessions.values()) {
      if (session.revokedAt === null) this.#revoke(session, now, "account_security_epoch_advanced");
    }
    return this.listSessions("");
  }

  enterAccountRecoveryPending(): AccountSessionList {
    this.#accountSecurityState = "recovery_pending";
    const now = this.#timestamp();
    for (const session of this.#sessions.values()) {
      if (session.revokedAt === null) this.#revoke(session, now, "account_recovery_pending");
    }
    return this.listSessions("");
  }

  removeDeviceBinding(deviceId: string): AccountSessionList {
    this.#boundDeviceIds.delete(deviceId);
    this.#removedDeviceIds.add(deviceId);
    const now = this.#timestamp();
    for (const session of this.#sessions.values()) {
      if (session.deviceId === deviceId && session.revokedAt === null) {
        this.#revoke(session, now, "device_removed");
      }
    }
    return this.listSessions("");
  }

  #checkReauth(reauthProofId: string): AccountRejection | null {
    const record = this.#reauthProofs.get(reauthProofId);
    if (record === undefined) return this.#reject("REAUTHENTICATION_REQUIRED");
    if (record.accountSecurityEpoch !== this.#accountSecurityEpoch) {
      return this.#reject("ACCOUNT_SECURITY_EPOCH_STALE");
    }
    if (record.proof.expiresAt <= this.#timestamp()) return this.#reject("REAUTH_PROOF_EXPIRED");
    return null;
  }

  #revoke(session: SessionRecord, at: string, reason: AuthRevocationReason): void {
    if (session.revokedAt !== null) return;
    this.#families.revokeFamily(session.sessionId);
    session.revokedAt = at;
    session.revocationReason = reason;
    this.#listRevision += 1;
  }

  #status(session: SessionRecord, state: "authenticated" | "revoked"): AuthSessionStatus {
    const now = this.#now();
    return authSessionStatusSchema.parse({
      schemaVersion: AUTH_SESSION_SCHEMA_VERSION,
      state,
      accountId: this.accountId,
      deviceId: session.deviceId,
      accountSecurityEpoch: session.accountSecurityEpoch,
      sessionId: session.sessionId,
      accessTokenExpiresAt:
        state === "authenticated" ? canonicalTimestamp(new Date(now.getTime() + 15 * 60 * 1_000)) : null,
      refreshRotationGeneration: session.rotationGeneration,
      lastTrustedTimeAt: canonicalTimestamp(now),
      revocationReason: state === "revoked" ? session.revocationReason : null,
    });
  }

  #signedOutStatus(): AuthSessionStatus {
    return authSessionStatusSchema.parse({
      schemaVersion: AUTH_SESSION_SCHEMA_VERSION,
      state: "signed_out",
      accountId: null,
      deviceId: null,
      accountSecurityEpoch: null,
      sessionId: null,
      accessTokenExpiresAt: null,
      refreshRotationGeneration: null,
      lastTrustedTimeAt: null,
      revocationReason: null,
    });
  }

  #reject(code: AccountRejectionCode): AccountRejection {
    const retryable = ["REFRESH_ROTATION_CONFLICT", "LIST_REVISION_STALE"].includes(code);
    return accountRejectionSchema.parse({
      schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
      code,
      retryable,
      retryAfterSeconds: null,
      correlationId: `fixture-identity-${code.toLowerCase()}`,
    });
  }

  #timestamp(): string {
    return canonicalTimestamp(this.#now());
  }

  #newCredentialJti(kind: "access" | "refresh"): string {
    return `fixture-${kind}-jti-${this.#nextJti++}`;
  }
}

function canonicalTimestamp(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}
