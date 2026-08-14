import { accountRejectionSchema, type AccountRejectionCode } from "@gooddealer/protocol/account";
import {
  deviceBindingListSchema,
  deviceSwitchRequestViewSchema,
  type DeviceBindingSummary,
} from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

import { DevicesFixtureService } from "../src/modules/devices/index";

const binding = (
  deviceId: string,
  role: "active" | "standby" | "none",
  currentDevice = false,
): DeviceBindingSummary => ({
  schemaVersion: 1,
  deviceId,
  platform: "macos",
  displayName: deviceId,
  status: "bound",
  role,
  credentialEpoch: 1,
  signingKeyId: `fixture-key-${deviceId}`,
  signingKeyVersion: 1,
  signingKeyStatus: "active",
  boundAt: "2026-01-01T00:00:00Z",
  lastSeenAt: "2026-01-01T00:00:00Z",
  removedAt: null,
  currentDevice,
});

function expectRejection(value: unknown, code: AccountRejectionCode): void {
  expect(accountRejectionSchema.parse(value).code).toBe(code);
}

describe("DevicesFixtureService", () => {
  it("fails closed when a sensitive action has no reauth verifier", () => {
    const service = new DevicesFixtureService({ seedBindings: [binding("device-a", "standby")] });
    expectRejection(
      service.removeDevice({ schemaVersion: 1, deviceId: "device-a", expectedCredentialEpoch: 1, expectedListRevision: 1, reauthProofId: "proof" }),
      "REAUTHENTICATION_REQUIRED",
    );
  });

  it("enforces the two-bound-device quota in service logic", () => {
    const service = new DevicesFixtureService({ seedBindings: [binding("device-a", "active"), binding("device-b", "standby")] });
    expectRejection(service.bindDevice(binding("device-c", "standby")), "DEVICE_LIMIT_REACHED");
    expect(deviceBindingListSchema.parse(service.listBindings()).devices).toHaveLength(2);
  });

  it("rejects a second Active even when called directly with a contract-valid summary", () => {
    const service = new DevicesFixtureService({ seedBindings: [binding("device-a", "active")] });
    expectRejection(service.bindDevice(binding("device-b", "active")), "ACTIVE_DEVICE_CONFLICT");
  });

  it("rejects a second current device without committing the invalid binding", () => {
    const service = new DevicesFixtureService({
      seedBindings: [binding("device-a", "standby", true)],
    });

    expectRejection(
      service.bindDevice(binding("device-b", "standby", true)),
      "ACTIVE_DEVICE_CONFLICT",
    );

    expect(service.listBindings()).toMatchObject({
      listRevision: 1,
      devices: [{ deviceId: "device-a", currentDevice: true }],
    });
  });

  it("fails closed on stale list and credential epoch CAS values", () => {
    const service = new DevicesFixtureService({ seedBindings: [binding("device-a", "active")] });
    expectRejection(
      service.removeDevice({ schemaVersion: 1, deviceId: "device-a", expectedCredentialEpoch: 1, expectedListRevision: 2, reauthProofId: "proof" }),
      "LIST_REVISION_STALE",
    );
    expectRejection(
      service.removeDevice({ schemaVersion: 1, deviceId: "device-a", expectedCredentialEpoch: 2, expectedListRevision: 1, reauthProofId: "proof" }),
      "LIST_REVISION_STALE",
    );
  });

  it("distinguishes missing and already-removed bindings", () => {
    const service = new DevicesFixtureService({
      reauthCheck: () => null,
      seedBindings: [binding("device-a", "standby")],
    });
    expectRejection(
      service.removeDevice({ schemaVersion: 1, deviceId: "missing", expectedCredentialEpoch: 1, expectedListRevision: 1, reauthProofId: "proof" }),
      "DEVICE_NOT_BOUND",
    );
    deviceBindingListSchema.parse(
      service.removeDevice({ schemaVersion: 1, deviceId: "device-a", expectedCredentialEpoch: 1, expectedListRevision: 1, reauthProofId: "proof" }),
    );
    expectRejection(
      service.removeDevice({ schemaVersion: 1, deviceId: "device-a", expectedCredentialEpoch: 2, expectedListRevision: 2, reauthProofId: "proof" }),
      "DEVICE_REMOVED",
    );
  });

  it("accepts a forced switch during isolation but blocks claim_takeover until the offline window ends", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const service = new DevicesFixtureService({
      now: () => now,
      reauthCheck: () => null,
      seedBindings: [binding("device-a", "active"), binding("device-b", "standby")],
      activeLease: {
        deviceId: "device-a",
        leaseEpoch: 1,
        issuedAt: "2026-01-01T00:00:00Z",
        renewAfter: "2026-01-01T00:10:00Z",
        onlineExpiresAt: "2026-01-01T00:20:00Z",
        offlineExecuteUntil: "2026-01-01T01:00:00Z",
      },
    });
    service.removeDevice({ schemaVersion: 1, deviceId: "device-a", expectedCredentialEpoch: 1, expectedListRevision: 1, reauthProofId: "proof" });
    const waiting = deviceSwitchRequestViewSchema.parse(
      service.requestSwitch({ schemaVersion: 1, mode: "forced", toDeviceId: "device-b", idempotencyKey: "switch-key", reauthProofId: "proof" }),
    );
    expect(waiting).toMatchObject({
      status: "waiting_expiry",
      earliestTakeoverAt: "2026-01-01T01:00:00Z",
    });
    expectRejection(service.claimTakeover(waiting.requestId), "EXCLUSIVE_EXECUTION_BLOCKED");
    now = new Date("2026-01-01T01:00:01Z");
    expect(deviceSwitchRequestViewSchema.parse(service.claimTakeover(waiting.requestId))).toMatchObject({
      toDeviceId: "device-b",
      status: "bootstrapping",
    });
  });

  it("returns the same switch request for an idempotency replay and rejects a competing request", () => {
    const service = new DevicesFixtureService({ seedBindings: [binding("device-a", "active"), binding("device-b", "standby")] });
    const request = { schemaVersion: 1 as const, mode: "normal" as const, toDeviceId: "device-b", idempotencyKey: "same-key" };
    const first = deviceSwitchRequestViewSchema.parse(service.requestSwitch(request));
    const replay = deviceSwitchRequestViewSchema.parse(service.requestSwitch(request));
    expect(replay).toEqual(first);
    expectRejection(
      service.requestSwitch({ ...request, idempotencyKey: "different-key" }),
      "ACTIVE_DEVICE_CONFLICT",
    );
  });

  it("derives lease status from trusted evaluation time", () => {
    const service = new DevicesFixtureService({
      activeLease: {
        deviceId: "device-a",
        leaseEpoch: 1,
        issuedAt: "2026-01-01T00:00:00Z",
        renewAfter: "2026-01-01T00:10:00Z",
        onlineExpiresAt: "2026-01-01T00:20:00Z",
        offlineExecuteUntil: "2026-01-01T01:00:00Z",
      },
    });
    expect(service.getLeaseStatus("2026-01-01T00:15:00Z")).toMatchObject({ held: true, renewalState: "renewal_window" });
  });
});
