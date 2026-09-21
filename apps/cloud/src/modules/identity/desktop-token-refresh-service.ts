import { identifier } from "@gooddealer/protocol/wire";

import {
  deriveDesktopRefreshResultToken,
  inspectDesktopBearerToken,
} from "./desktop-bearer-token";
import type { DesktopLoginLeasePort } from "../devices/index";
import type { PostgresIdentityAuthenticationRepository } from "./postgres-authentication-repository";

export const DESKTOP_ACCESS_TOKEN_TTL_SECONDS = 900;
export const DESKTOP_REFRESH_TOKEN_TTL_SECONDS = 2_592_000;
export const DESKTOP_TRANSIENT_REFRESH_TOKEN_TTL_SECONDS = 28_800;

export type DesktopTokenRefreshResult =
  | { readonly rotated: false; readonly reason: "invalid_credentials" | "session_revoked" | "refresh_reuse_detected" | "rotation_conflict" | "authorization_unavailable" }
  | { readonly rotated: true; readonly credentials: ConsumableDesktopCredentials };

/** Raw bearer values can be consumed once and cannot be serialized into logs or ordinary JSON. */
export class ConsumableDesktopCredentials {
  #value: { readonly accessToken: string; readonly refreshToken: string } | null;

  constructor(
    value: { readonly accessToken: string; readonly refreshToken: string },
    readonly accessTokenExpiresAt: string,
    readonly refreshTokenExpiresAt: string,
    readonly rotationGeneration: number,
  ) {
    this.#value = value;
  }

  consume<Result>(operation: (value: {
    readonly accessToken: string;
    readonly refreshToken: string;
  }) => Result): Result {
    const value = this.#value;
    if (value === null) throw new TypeError("desktop credentials already consumed");
    this.#value = null;
    return operation(value);
  }

  toJSON(): string {
    return "[REDACTED]";
  }
}

export class DesktopTokenRefreshService {
  constructor(
    private readonly repository: Pick<
      PostgresIdentityAuthenticationRepository,
      "identifyRefreshCredential" | "prepareRefresh" | "commitRefresh" | "recoverRefresh"
    >,
    private readonly leases: DesktopLoginLeasePort,
  ) {}

  async rotate(input: {
    readonly refreshToken: unknown;
    readonly deviceId: unknown;
    readonly requestId: unknown;
    readonly evaluatedAt: Date;
  }): Promise<DesktopTokenRefreshResult> {
    const inspected = inspectDesktopBearerToken("refresh", input.refreshToken);
    const deviceId = identifier.safeParse(input.deviceId);
    const requestId = identifier.safeParse(input.requestId);
    if (
      inspected === null || typeof input.refreshToken !== "string"
      || !deviceId.success || !requestId.success || !Number.isFinite(input.evaluatedAt.getTime())
    ) {
      return { rotated: false, reason: "invalid_credentials" };
    }
    const identified = await this.repository.identifyRefreshCredential(
      inspected.accountId,
      inspected.credentialDigest,
    );
    if (identified === null || identified.deviceId !== deviceId.data) {
      return { rotated: false, reason: "invalid_credentials" };
    }
    const prepared = await this.repository.prepareRefresh(identified, requestId.data);
    if (prepared.status === "replayable") {
      return this.replay(
        input.refreshToken as string,
        requestId.data,
        prepared.replay,
      );
    }
    if (prepared.status !== "ready") {
      return {
        rotated: false,
        reason: prepared.status === "refresh_reuse_detected"
          ? "refresh_reuse_detected"
          : prepared.status === "session_revoked" ? "session_revoked" : "invalid_credentials",
      };
    }
    const transactionCredential = new TextEncoder().encode(input.refreshToken);
    let leased: Awaited<ReturnType<DesktopLoginLeasePort["ensureCurrentLease"]>>;
    try {
      leased = await this.leases.ensureCurrentLease({
        accountId: identified.accountId,
        deviceId: identified.deviceId,
        accountSecurityEpoch: identified.accountSecurityEpoch,
        transactionCredential,
      });
    } finally {
      transactionCredential.fill(0);
    }
    if (!leased.ensured) return { rotated: false, reason: "authorization_unavailable" };
    const generation = prepared.preparation.expectedGeneration + 1;
    const access = deriveDesktopRefreshResultToken(
      "access", identified.accountId, input.refreshToken, requestId.data, generation,
    );
    const refresh = deriveDesktopRefreshResultToken(
      "refresh", identified.accountId, input.refreshToken, requestId.data, generation,
    );
    const accessExpiresAt = addSeconds(input.evaluatedAt, DESKTOP_ACCESS_TOKEN_TTL_SECONDS);
    const refreshExpiresAt = addSeconds(
      input.evaluatedAt,
      identified.rememberDevice
        ? DESKTOP_REFRESH_TOKEN_TTL_SECONDS
        : DESKTOP_TRANSIENT_REFRESH_TOKEN_TTL_SECONDS,
    );
    const committed = await this.repository.commitRefresh(prepared.preparation, {
      accessJti: access.credentialDigest,
      refreshJti: refresh.credentialDigest,
      accessExpiresAt,
      refreshExpiresAt,
    });
    if (committed.status !== "rotated") {
      if (committed.status === "refresh_reuse_detected") {
        return { rotated: false, reason: "refresh_reuse_detected" };
      }
      if (committed.status === "refresh_rotation_conflict" || committed.status === "credential_jti_conflict") {
        const recovered = await this.replay(input.refreshToken as string, requestId.data, {
          ...prepared.preparation,
          generation,
        });
        if (recovered.rotated) return recovered;
      }
      return {
        rotated: false,
        reason: committed.status === "session_revoked" ? "session_revoked" : "rotation_conflict",
      };
    }
    return {
      rotated: true,
      credentials: new ConsumableDesktopCredentials(
        { accessToken: access.token, refreshToken: refresh.token },
        canonicalSecond(accessExpiresAt),
        canonicalSecond(refreshExpiresAt),
        committed.generation,
      ),
    };
  }

  private async replay(
    presentedRefreshToken: string,
    requestId: string,
    replay: {
      readonly accountId: string;
      readonly sessionId: string;
      readonly familyId: string;
      readonly presentedRefreshJti: string;
      readonly accountSecurityEpoch: number;
      readonly generation: number;
    },
  ): Promise<DesktopTokenRefreshResult> {
    const access = deriveDesktopRefreshResultToken(
      "access", replay.accountId, presentedRefreshToken, requestId, replay.generation,
    );
    const refresh = deriveDesktopRefreshResultToken(
      "refresh", replay.accountId, presentedRefreshToken, requestId, replay.generation,
    );
    const recovered = await this.repository.recoverRefresh(replay, {
      requestId,
      accessJti: access.credentialDigest,
      refreshJti: refresh.credentialDigest,
    });
    if (recovered === null) return { rotated: false, reason: "rotation_conflict" };
    return {
      rotated: true,
      credentials: new ConsumableDesktopCredentials(
        { accessToken: access.token, refreshToken: refresh.token },
        canonicalSecond(recovered.accessExpiresAt),
        canonicalSecond(recovered.refreshExpiresAt),
        recovered.generation,
      ),
    };
  }
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

function canonicalSecond(value: Date): string {
  return value.toISOString().replace(/\.000Z$/u, "Z");
}
