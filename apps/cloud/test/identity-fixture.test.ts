import {
  accountRejectionSchema,
  accountSessionListSchema,
  authSessionStatusSchema,
  reauthProofRefSchema,
  type AccountRejectionCode,
  type AuthLoginRequest,
} from "@gooddealer/protocol/account";
import { describe, expect, it } from "vitest";

import { IdentityFixtureService } from "../src/modules/identity/index";

const loginRequest = (deviceId: string): AuthLoginRequest => ({
  schemaVersion: 1,
  method: "password",
  deviceId,
  rememberDevice: true,
});

function expectRejection(value: unknown, code: AccountRejectionCode): void {
  expect(accountRejectionSchema.parse(value).code).toBe(code);
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

  it("rotates by generation, detects old-generation reuse, and revokes the session family", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    const login = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    const request = { schemaVersion: 1 as const, deviceId: "fixture-device-active", reason: "scheduled" as const };

    const rotated = authSessionStatusSchema.parse(
      service.refresh(request, { sessionId: login.sessionId!, presentedRotationGeneration: 0 }),
    );
    expect(rotated.refreshRotationGeneration).toBe(1);
    expectRejection(
      service.refresh(request, { sessionId: login.sessionId!, presentedRotationGeneration: 0 }),
      "REFRESH_REUSE_DETECTED",
    );
    expectRejection(
      service.refresh(request, { sessionId: login.sessionId!, presentedRotationGeneration: 1 }),
      "SESSION_REVOKED",
    );
  });

  it("fails closed for concurrent rotation and unbound devices", () => {
    const service = new IdentityFixtureService({ now: () => new Date("2026-01-01T00:00:00Z") });
    expectRejection(service.login(loginRequest("unknown-device")), "DEVICE_NOT_BOUND");
    const login = authSessionStatusSchema.parse(service.login(loginRequest("fixture-device-active")));
    expectRejection(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "manual" },
        { sessionId: login.sessionId!, presentedRotationGeneration: 1 },
      ),
      "REFRESH_ROTATION_CONFLICT",
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
    const stale = service.issueReauthProof("password");
    service.advanceAccountSecurityEpoch();
    expectRejection(service.checkReauthProof(stale.reauthProofId), "ACCOUNT_SECURITY_EPOCH_STALE");
    expectRejection(
      service.refresh(
        { schemaVersion: 1, deviceId: "fixture-device-active", reason: "startup" },
        { sessionId: login.sessionId!, presentedRotationGeneration: 0 },
      ),
      "ACCOUNT_SECURITY_EPOCH_STALE",
    );
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
