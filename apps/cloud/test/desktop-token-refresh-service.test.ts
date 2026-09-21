import { describe, expect, it, vi } from "vitest";

import { issueDesktopBearerToken, inspectDesktopBearerToken } from "../src/modules/identity/desktop-bearer-token";
import { DesktopTokenRefreshService } from "../src/modules/identity/desktop-token-refresh-service";

const evaluatedAt = new Date("2026-09-01T00:00:00Z");

describe("Desktop refresh token rotation", () => {
  it("rotates once, persists only credential digests, and makes returned secrets consumable once", async () => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    let committed: {
      readonly accessJti: string;
      readonly refreshJti: string;
      readonly accessExpiresAt: Date;
      readonly refreshExpiresAt: Date;
    } | undefined;
    const commitRefresh = vi.fn(async (_preparation: unknown, next: NonNullable<typeof committed>) => {
      committed = next;
      return { status: "rotated" as const, generation: 3 };
    });
    const service = new DesktopTokenRefreshService({
      identifyRefreshCredential: async (accountId, digest) => ({
        accountId,
        sessionId: "session-a",
        familyId: "family-a",
        presentedRefreshJti: digest,
        accountSecurityEpoch: 4,
        deviceId: "device-a",
        rememberDevice: true,
      }),
      prepareRefresh: async (snapshot) => ({
        status: "ready" as const,
        preparation: { ...snapshot, requestId: "refresh-request-a", expectedGeneration: 2 },
      }),
      commitRefresh,
      recoverRefresh: async () => null,
    }, acceptingLease());

    const result = await service.rotate({
      refreshToken: presented.token,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt,
    });
    expect(result.rotated).toBe(true);
    if (!result.rotated) throw new Error("rotation unexpectedly denied");
    expect(JSON.stringify(result.credentials)).toBe('"[REDACTED]"');
    const values = result.credentials.consume((credentials) => credentials);
    expect(inspectDesktopBearerToken("access", values.accessToken)).not.toBeNull();
    expect(inspectDesktopBearerToken("refresh", values.refreshToken)).not.toBeNull();
    expect(() => result.credentials.consume(() => undefined)).toThrow(/already consumed/u);
    expect(committed?.accessJti).toMatch(/^[a-f0-9]{64}$/u);
    expect(committed?.refreshJti).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(committed)).not.toContain(values.accessToken);
    expect(JSON.stringify(committed)).not.toContain(values.refreshToken);
  });

  it.each([
    ["unknown credential", null, "invalid_credentials"],
    ["device substitution", "other-device", "invalid_credentials"],
  ])("rejects %s before rotation", async (_name, deviceId, reason) => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    const prepareRefresh = vi.fn();
    const service = new DesktopTokenRefreshService({
      identifyRefreshCredential: async () => deviceId === null ? null : ({
        accountId: "account-a",
        sessionId: "session-a",
        familyId: "family-a",
        presentedRefreshJti: presented.credentialDigest,
        accountSecurityEpoch: 4,
        deviceId,
        rememberDevice: true,
      }),
      prepareRefresh,
      commitRefresh: vi.fn(),
      recoverRefresh: async () => null,
    }, acceptingLease());
    await expect(service.rotate({
      refreshToken: presented.token,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt,
    }))
      .resolves.toEqual({ rotated: false, reason });
    expect(prepareRefresh).not.toHaveBeenCalled();
  });

  it("maps refresh reuse to family revocation without issuing replacement credentials", async () => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    const service = new DesktopTokenRefreshService({
      identifyRefreshCredential: async () => ({
        accountId: "account-a",
        sessionId: "session-a",
        familyId: "family-a",
        presentedRefreshJti: presented.credentialDigest,
        accountSecurityEpoch: 4,
        deviceId: "device-a",
        rememberDevice: true,
      }),
      prepareRefresh: async () => ({ status: "refresh_reuse_detected" as const }),
      commitRefresh: vi.fn(),
      recoverRefresh: async () => null,
    }, acceptingLease());
    await expect(service.rotate({
      refreshToken: presented.token,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt,
    }))
      .resolves.toEqual({ rotated: false, reason: "refresh_reuse_detected" });
  });

  it("fails closed when a concurrent different request wins the rotation commit", async () => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    const recoverRefresh = vi.fn();
    const service = new DesktopTokenRefreshService({
      identifyRefreshCredential: async () => ({
        accountId: "account-a",
        sessionId: "session-a",
        familyId: "family-a",
        presentedRefreshJti: presented.credentialDigest,
        accountSecurityEpoch: 4,
        deviceId: "device-a",
        rememberDevice: true,
      }),
      prepareRefresh: async (snapshot) => ({
        status: "ready" as const,
        preparation: { ...snapshot, requestId: "refresh-request-b", expectedGeneration: 2 },
      }),
      commitRefresh: async () => ({ status: "refresh_reuse_detected" as const }),
      recoverRefresh,
    }, acceptingLease());

    await expect(service.rotate({
      refreshToken: presented.token,
      deviceId: "device-a",
      requestId: "refresh-request-b",
      evaluatedAt,
    })).resolves.toEqual({ rotated: false, reason: "refresh_reuse_detected" });
    expect(recoverRefresh).not.toHaveBeenCalled();
  });

  it("recovers the exact winner when the same request loses the rotation commit", async () => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    const recoverRefresh = vi.fn(async () => ({
      generation: 3,
      accessExpiresAt: new Date("2026-09-01T00:15:00Z"),
      refreshExpiresAt: new Date("2026-10-01T00:00:00Z"),
    }));
    const service = new DesktopTokenRefreshService({
      identifyRefreshCredential: async () => ({
        accountId: "account-a",
        sessionId: "session-a",
        familyId: "family-a",
        presentedRefreshJti: presented.credentialDigest,
        accountSecurityEpoch: 4,
        deviceId: "device-a",
        rememberDevice: true,
      }),
      prepareRefresh: async (snapshot) => ({
        status: "ready" as const,
        preparation: { ...snapshot, requestId: "refresh-request-a", expectedGeneration: 2 },
      }),
      commitRefresh: async () => ({ status: "refresh_rotation_conflict" as const }),
      recoverRefresh,
    }, acceptingLease());

    const result = await service.rotate({
      refreshToken: presented.token,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt,
    });
    expect(result.rotated).toBe(true);
    if (!result.rotated) throw new Error("same-request recovery unexpectedly denied");
    expect(result.credentials.rotationGeneration).toBe(3);
    expect(result.credentials.accessTokenExpiresAt).toBe("2026-09-01T00:15:00Z");
    expect(result.credentials.refreshTokenExpiresAt).toBe("2026-10-01T00:00:00Z");
    expect(recoverRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not consume the current refresh token when online Lease renewal is unavailable", async () => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    const commitRefresh = vi.fn();
    const service = new DesktopTokenRefreshService({
      identifyRefreshCredential: async () => ({
        accountId: "account-a",
        sessionId: "session-a",
        familyId: "family-a",
        presentedRefreshJti: presented.credentialDigest,
        accountSecurityEpoch: 4,
        deviceId: "device-a",
        rememberDevice: true,
      }),
      prepareRefresh: async (snapshot) => ({
        status: "ready" as const,
        preparation: { ...snapshot, requestId: "refresh-request-a", expectedGeneration: 2 },
      }),
      commitRefresh,
      recoverRefresh: async () => null,
    }, {
      ensureCurrentLease: async () => ({ ensured: false as const }),
    });
    await expect(service.rotate({
      refreshToken: presented.token,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt,
    }))
      .resolves.toEqual({ rotated: false, reason: "authorization_unavailable" });
    expect(commitRefresh).not.toHaveBeenCalled();
  });

  it("replays the exact issued credentials for the same rotated token and request identity", async () => {
    const presented = issueDesktopBearerToken("refresh", "account-a");
    const recoverRefresh = vi.fn(async () => ({
      generation: 3,
      accessExpiresAt: new Date("2026-09-01T00:15:00Z"),
      refreshExpiresAt: new Date("2026-10-01T00:00:00Z"),
    }));
    const service = new DesktopTokenRefreshService({
      identifyRefreshCredential: async () => ({
        accountId: "account-a",
        sessionId: "session-a",
        familyId: "family-a",
        presentedRefreshJti: presented.credentialDigest,
        accountSecurityEpoch: 4,
        deviceId: "device-a",
        rememberDevice: true,
      }),
      prepareRefresh: async (snapshot) => ({
        status: "replayable" as const,
        replay: { ...snapshot, generation: 3 },
      }),
      commitRefresh: vi.fn(),
      recoverRefresh,
    }, acceptingLease());

    const rotate = () => service.rotate({
      refreshToken: presented.token,
      deviceId: "device-a",
      requestId: "refresh-request-a",
      evaluatedAt,
    });
    const first = await rotate();
    const second = await rotate();
    if (!first.rotated || !second.rotated) throw new Error("replay unexpectedly denied");
    expect(first.credentials.consume((value) => value))
      .toEqual(second.credentials.consume((value) => value));
    expect(first.credentials.rotationGeneration).toBe(3);
    expect(recoverRefresh).toHaveBeenCalledTimes(2);
  });
});

function acceptingLease() {
  return {
    ensureCurrentLease: async () => ({ ensured: true as const, lease: {} as never }),
  };
}
