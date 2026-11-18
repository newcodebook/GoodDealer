import { describe, expect, it, vi } from "vitest";

import { PostgresDeviceSwitchApplication } from "../src/modules/devices/index";
import { drainProofKeyPair, signedHandoffDrainProof } from "./support/drain-proof";

const principal = { accountId: "account-switch", sessionId: "session-switch", clientKind: "desktop" as const };
const scope = { accountId: principal.accountId, workspaceId: "workspace-switch" } as const;
const subject = { ...scope, deviceId: "device-old" } as const;
const view = {
  schemaVersion: 1 as const, accepted: true as const,
  request: { schemaVersion: 1 as const, requestId: "switch-1", mode: "normal" as const, status: "draining" as const,
    fromDeviceId: "device-old", toDeviceId: "device-new", requestedAt: "2026-11-17T00:00:00Z",
    earliestTakeoverAt: null, bootstrapExpiresAt: null },
};

function fixture(options: { device?: string | null; workspace?: typeof scope | null } = {}) {
  const requests = {
    requestNormal: vi.fn(async () => view),
    read: vi.fn(async () => view),
    cancel: vi.fn(async () => view),
  };
  const drains = { submit: vi.fn(async () => view) };
  const application = new PostgresDeviceSwitchApplication({
    workspaces: { resolve: vi.fn(async () => (options.workspace === undefined ? scope : options.workspace)) },
    authority: { resolveActiveDevice: vi.fn(async () => (options.device === undefined ? "device-old" : options.device)) },
    requests,
    drains,
  });
  return { application, requests, drains };
}

describe("device switch application (ADR-0032 S1b)", () => {
  it("passes only the session-derived account, workspace, and device to the service", async () => {
    const { application, requests } = fixture();
    const body = { schemaVersion: 1, mode: "normal", toDeviceId: "device-new", idempotencyKey: "idem-1" };
    await expect(application.request(body, principal)).resolves.toEqual(view);
    expect(requests.requestNormal).toHaveBeenCalledWith(subject, body);
    await application.status({ schemaVersion: 1, requestId: "switch-1" }, principal);
    expect(requests.read).toHaveBeenCalledWith(subject, "switch-1");
    await application.cancel({ schemaVersion: 1, requestId: "switch-1" }, principal);
    expect(requests.cancel).toHaveBeenCalledWith(subject, "switch-1");
  });

  it("refuses forced takeover as unavailable while no target device can hold a session", async () => {
    const { application, requests } = fixture();
    await expect(application.request({
      schemaVersion: 1, mode: "forced", toDeviceId: "device-new", idempotencyKey: "idem-1", reauthProofId: "reauth-1",
    }, principal)).resolves.toEqual({ schemaVersion: 1, accepted: false, code: "FORCED_SWITCH_UNAVAILABLE" });
    expect(requests.requestNormal).not.toHaveBeenCalled();
  });

  it("denies non-Desktop callers and sessions without a workspace or the current Lease", async () => {
    const body = { schemaVersion: 1, mode: "normal", toDeviceId: "device-new", idempotencyKey: "idem-1" };
    for (const [setup, caller] of [
      [fixture(), { ...principal, clientKind: "account_web" as never }],
      [fixture({ workspace: null }), principal],
      [fixture({ device: null }), principal],
    ] as const) {
      await expect(setup.application.request(body, caller)).resolves.toBeNull();
      await expect(setup.application.status({ schemaVersion: 1, requestId: "switch-1" }, caller)).resolves.toBeNull();
      await expect(setup.application.cancel({ schemaVersion: 1, requestId: "switch-1" }, caller)).resolves.toBeNull();
      expect(setup.requests.requestNormal).not.toHaveBeenCalled();
      expect(setup.requests.read).not.toHaveBeenCalled();
      expect(setup.requests.cancel).not.toHaveBeenCalled();
    }
  });

  it("rejects caller-selected devices, accounts, and unknown fields before any read", async () => {
    const { application, requests } = fixture();
    for (const hostile of [
      { schemaVersion: 1, mode: "normal", toDeviceId: "device-new", idempotencyKey: "idem-1", fromDeviceId: "device-x" },
      { schemaVersion: 1, mode: "normal", toDeviceId: "device-new", idempotencyKey: "idem-1", accountId: "other" },
      { schemaVersion: 1, mode: "forced", toDeviceId: "device-new", idempotencyKey: "idem-1" },
      { schemaVersion: 2, mode: "normal", toDeviceId: "device-new", idempotencyKey: "idem-1" },
    ]) {
      await expect(application.request(hostile, principal)).rejects.toThrow();
    }
    await expect(application.status({ schemaVersion: 1, requestId: "switch-1", deviceId: "device-x" }, principal)).rejects.toThrow();
    await expect(application.cancel({ schemaVersion: 1 }, principal)).rejects.toThrow();
    expect(requests.requestNormal).not.toHaveBeenCalled();
    expect(requests.read).not.toHaveBeenCalled();
    expect(requests.cancel).not.toHaveBeenCalled();
  });

  it("hands a drain proof to the service only for the session's own device (S1c2)", async () => {
    const proof = signedHandoffDrainProof(drainProofKeyPair().privateKey);
    const { application, drains } = fixture();
    await expect(application.drain({ schemaVersion: 1, requestId: "switch-1", proof }, principal)).resolves.toEqual(view);
    expect(drains.submit).toHaveBeenCalledWith(subject, "switch-1", proof);
    for (const hostile of [
      { schemaVersion: 1, requestId: "switch-1", proof: { ...proof, unknown: true } },
      { schemaVersion: 1, requestId: "switch-1", proof, deviceId: "device-x" },
      { schemaVersion: 1, requestId: "switch-1" },
    ]) {
      await expect(application.drain(hostile, principal)).rejects.toThrow();
    }
    const denied = fixture({ device: null });
    await expect(denied.application.drain({ schemaVersion: 1, requestId: "switch-1", proof }, principal)).resolves.toBeNull();
    expect(drains.submit).toHaveBeenCalledTimes(1);
    expect(denied.drains.submit).not.toHaveBeenCalled();
  });
});
