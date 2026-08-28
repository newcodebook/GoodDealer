import {
  accountRejectionSchema,
  accountSessionListSchema,
  authSessionStatusSchema,
  reauthProofRefSchema,
  type AccountRejectionCode,
  type AuthLoginRequest,
} from "@gooddealer/protocol/account";
import { describe, expect, it } from "vitest";

import { IdentityFixtureService } from "./support/identity-fixture";

const loginRequest = (deviceId: string): AuthLoginRequest => ({
  schemaVersion: 1,
  method: "password",
  deviceId,
  rememberDevice: true,
});

function expectRejection(value: unknown, code: AccountRejectionCode): void {
  expect(accountRejectionSchema.parse(value).code).toBe(code);
}

function currentRefreshJti(service: IdentityFixtureService, sessionId: string): string {
  const jti = service.readCurrentRefreshJti(sessionId);
  expect(jti).not.toBeNull();
  return jti!;
}

describe("IdentityFixtureService", () => {
  it("creates only contract-valid status, inventory, and proof DTOs for an internal fixture account", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    expect(service.sellable).toBe(false);
    const status = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    const sessions = accountSessionListSchema.parse(service.listSessions(status.sessionId!));
    const proof = reauthProofRefSchema.parse(service.issueReauthProof("password"));

    expect(status.accountId).toBe("internal-fixture-account");
    expect(sessions.sessions).toHaveLength(1);
    expect(proof.method).toBe("password");
  });

  it("rotates by JTI, detects retired-JTI reuse, revokes only that family, and preserves the security epoch", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    const login = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    const other = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-standby")));
    const request = { schemaVersion: 1 as const, deviceId: "fixture-device-active", reason: "scheduled" as const };
    const retiredJti = currentRefreshJti(service, login.sessionId!);
    const epochBeforeReuse = service.readAccountSecurityEpoch();

    const rotated = authSessionStatusSchema.parse(
      service.refresh(request, { sessionId: login.sessionId!, presentedRefreshJti: retiredJti }),
    );
    expect(rotated.refreshRotationGeneration).toBe(1);
    const revokedFamilyCurrentJti = currentRefreshJti(service, login.sessionId!);
    expectRejection(
      service.refresh(request, { sessionId: login.sessionId!, presentedRefreshJti: retiredJti }),
      "REFRESH_REUSE_DETECTED",
    );
    expect(service.readAccountSecurityEpoch()).toBe(epochBeforeReuse);
    expect(service.listSessions(other.sessionId!).sessions.find(({ sessionId }) => sessionId === other.sessionId)?.status).toBe(
      "active",
    );
    expectRejection(
      service.refresh(request, {
        sessionId: login.sessionId!,
        presentedRefreshJti: revokedFamilyCurrentJti,
      }),
      "SESSION_REVOKED",
    );
  });

  it("fails closed for unknown and cross-family JTIs and unbound devices", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    expectRejection(service.login(loginRequest("unknown-device")), "DEVICE_NOT_BOUND");
    const login = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    expectRejection(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "manual" },
        { sessionId: login.sessionId!, presentedRefreshJti: "unknown-refresh-jti" },
      ),
      "INVALID_CREDENTIALS",
    );
    const other = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-standby")));
    expectRejection(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "manual" },
        { sessionId: login.sessionId!, presentedRefreshJti: currentRefreshJti(service, other.sessionId!) },
      ),
      "INVALID_CREDENTIALS",
    );
  });

  it("rejects stale session-list CAS and requires reauth for all-other revocation", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    const current = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    expectRejection(
      service.revokeSessions(
        { schemaVersion: 1, scope: "all_other_sessions", expectedListRevision: 1, reauthProofId: "missing-proof" },
        current.sessionId!,
      ),
      "LIST_REVISION_STALE",
    );
    expect(service.listSessions(current.sessionId!).sessions).toEqual([
      expect.objectContaining({ sessionId: current.sessionId, status: "active" }),
    ]);
    const revision = service.listSessions(current.sessionId!).listRevision;
    expectRejection(
      service.revokeSessions(
        { schemaVersion: 1, scope: "all_other_sessions", expectedListRevision: revision, reauthProofId: "missing-proof" },
        current.sessionId!,
      ),
      "REAUTHENTICATION_REQUIRED",
    );
  });

  it("expires reauth proofs and invalidates them when the account security epoch advances", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const service = new IdentityFixtureService({ now: () => now });
    const expired = service.issueReauthProof("passkey", 1);
    now = new Date("2026-01-01T00:00:02Z");
    expectRejection(service.checkReauthProof(expired.reauthProofId), "REAUTH_PROOF_EXPIRED");

    const login = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    expectRejection(
      service.revokeSessions(
        {
          schemaVersion: 1,
          scope: "all_other_sessions",
          expectedListRevision: service.listSessions(login.sessionId!).listRevision,
          reauthProofId: expired.reauthProofId,
        },
        login.sessionId!,
      ),
      "REAUTH_PROOF_EXPIRED",
    );
    const refreshJti = currentRefreshJti(service, login.sessionId!);
    const stale = service.issueReauthProof("password");
    service.advanceAccountSecurityEpoch();
    expectRejection(service.checkReauthProof(stale.reauthProofId), "ACCOUNT_SECURITY_EPOCH_STALE");
    expectRejection(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "manual" },
        { sessionId: login.sessionId!, presentedRefreshJti: refreshJti },
      ),
      "ACCOUNT_SECURITY_EPOCH_STALE",
    );
    expect(authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active"))).accountSecurityEpoch).toBe(2);
  });

  it("does not advance listRevision for last-seen rotation and fails startup recovery closed", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    const transient = authSessionStatusSchema.parse(
      service.login({ ...loginRequest("fixture-device-active"), rememberDevice: false }),
    );
    const before = service.listSessions(transient.sessionId!).listRevision;
    expect(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "startup" },
        { sessionId: transient.sessionId!, presentedRefreshJti: currentRefreshJti(service, transient.sessionId!) },
      ),
    ).toMatchObject({ state: "signed_out" });
    expect(service.listSessions(transient.sessionId!).listRevision).toBe(before);

    const durable = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    const durableBefore = service.listSessions(durable.sessionId!).listRevision;
    expect(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "startup" },
        { sessionId: durable.sessionId!, presentedRefreshJti: currentRefreshJti(service, durable.sessionId!) },
      ),
    ).toMatchObject({ state: "authenticated", refreshRotationGeneration: 1 });
    expect(service.listSessions(durable.sessionId!).listRevision).toBe(durableBefore);
  });

  it("revokes device families and recovery-pending families with their frozen reasons", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    const removed = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    const removedJti = currentRefreshJti(service, removed.sessionId!);
    service.removeDeviceBinding("fixture-device-active");
    expectRejection(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "manual" },
        { sessionId: removed.sessionId!, presentedRefreshJti: removedJti },
      ),
      "DEVICE_REMOVED",
    );

    const recovering = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-standby")));
    const recoveringJti = currentRefreshJti(service, recovering.sessionId!);
    service.enterAccountRecoveryPending();
    expectRejection(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-standby", reason: "manual" },
        { sessionId: recovering.sessionId!, presentedRefreshJti: recoveringJti },
      ),
      "ACCOUNT_RECOVERY_PENDING",
    );
    expect(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-standby", reason: "startup" },
        { sessionId: recovering.sessionId!, presentedRefreshJti: recoveringJti },
      ),
    ).toMatchObject({ state: "signed_out" });
  });

  it("fails silent recovery closed for every frozen family revocation reason", () => {
    const startup = (service: IdentityFixtureService, sessionId: string, deviceId: string, presentedRefreshJti: string) =>
      service.refresh(
        { schemaVersion: 1, deviceId, reason: "startup" },
        { sessionId, presentedRefreshJti },
      );

    const signedOut = new IdentityFixtureService();
    const signedOutSession = authSessionStatusSchema.parse(signedOut.login(loginRequest("fixture-device-active")));
    const signedOutJti = currentRefreshJti(signedOut, signedOutSession.sessionId!);
    signedOut.signOut({ schemaVersion: 1, scope: "this_device" }, signedOutSession.sessionId!);
    expect(startup(signedOut, signedOutSession.sessionId!, "fixture-device-active", signedOutJti)).toMatchObject({
      state: "signed_out",
    });

    const remote = new IdentityFixtureService();
    const remoteSession = authSessionStatusSchema.parse(remote.login(loginRequest("fixture-device-active")));
    const remoteJti = currentRefreshJti(remote, remoteSession.sessionId!);
    remote.login(loginRequest("fixture-device-active"));
    expect(startup(remote, remoteSession.sessionId!, "fixture-device-active", remoteJti)).toMatchObject({
      state: "signed_out",
    });

    const reused = new IdentityFixtureService();
    const reusedSession = authSessionStatusSchema.parse(reused.login(loginRequest("fixture-device-active")));
    const retiredJti = currentRefreshJti(reused, reusedSession.sessionId!);
    const scheduled = { schemaVersion: 1 as const, deviceId: "fixture-device-active", reason: "scheduled" as const };
    reused.refresh(scheduled, { sessionId: reusedSession.sessionId!, presentedRefreshJti: retiredJti });
    const reusedFamilyJti = currentRefreshJti(reused, reusedSession.sessionId!);
    reused.refresh(scheduled, { sessionId: reusedSession.sessionId!, presentedRefreshJti: retiredJti });
    expect(startup(reused, reusedSession.sessionId!, "fixture-device-active", reusedFamilyJti)).toMatchObject({
      state: "signed_out",
    });

    const advanced = new IdentityFixtureService();
    const advancedSession = authSessionStatusSchema.parse(advanced.login(loginRequest("fixture-device-active")));
    const advancedJti = currentRefreshJti(advanced, advancedSession.sessionId!);
    advanced.advanceAccountSecurityEpoch();
    expect(startup(advanced, advancedSession.sessionId!, "fixture-device-active", advancedJti)).toMatchObject({
      state: "signed_out",
    });

    const removed = new IdentityFixtureService();
    const removedSession = authSessionStatusSchema.parse(removed.login(loginRequest("fixture-device-active")));
    const removedJti = currentRefreshJti(removed, removedSession.sessionId!);
    removed.removeDeviceBinding("fixture-device-active");
    expect(startup(removed, removedSession.sessionId!, "fixture-device-active", removedJti)).toMatchObject({
      state: "signed_out",
    });

    const recovery = new IdentityFixtureService();
    const recoverySession = authSessionStatusSchema.parse(recovery.login(loginRequest("fixture-device-active")));
    const recoveryJti = currentRefreshJti(recovery, recoverySession.sessionId!);
    recovery.enterAccountRecoveryPending();
    expect(startup(recovery, recoverySession.sessionId!, "fixture-device-active", recoveryJti)).toMatchObject({
      state: "signed_out",
    });
  });

  it("signs out this device and all devices without emitting credential material", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    const first = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    expect(service.signOut({ schemaVersion: 1, scope: "this_device" }, first.sessionId!)).toMatchObject({ state: "signed_out" });

    const current = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    service.login(loginRequest("fixture-device-standby"));
    const proof = service.issueReauthProof("password");
    expect(
      service.signOut(
        { schemaVersion: 1, scope: "all_devices", reauthProofId: proof.reauthProofId },
        current.sessionId!,
      ),
    ).toMatchObject({ state: "signed_out" });
    expect(service.listSessions("").sessions.every(({ status }) => status === "revoked")).toBe(true);
  });
});
