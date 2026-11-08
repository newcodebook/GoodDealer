import { describe, expect, it, vi } from "vitest";

import type { CloudflareConnectionStatus } from "../../adapters/tauri";
import { cloudflareNotice, readCloudflareNotice, settleCloudflareNotice } from "./cloudflare-notice";

const base: CloudflareConnectionStatus = { schemaVersion: 1, state: "ready", connectionRef: "opaque", displayLabel: "Cloudflare", qualified: true, capturable: true, lastOperation: null, readGeneration: 1 };

describe("Cloudflare notice", () => {
  it.each([
    [null, "unreadable"],
    [{ ...base, state: "busy", lastOperation: { kind: "revoke", outcome: "confirmed" } }, "busy"],
    [{ ...base, state: "recovering", qualified: false }, "recovering"],
    [{ ...base, state: "blocked" }, "blocked"],
    [{ ...base, qualified: false, capturable: true, lastOperation: { kind: "revoke", outcome: "confirmed" } }, "revoked"],
    [{ ...base, qualified: false, capturable: true, lastOperation: { kind: "activate", outcome: "failed" } }, "unqualified"],
    [{ ...base, qualified: false, capturable: true, lastOperation: { kind: "observe", outcome: "unqualified" } }, "unqualified"],
    [{ ...base, lastOperation: { kind: "observe", outcome: "unconfirmed" } }, "operationUnconfirmed"],
    [{ ...base, lastOperation: { kind: "activate", outcome: "failed" } }, "operationFailed"],
    [{ ...base, state: "not-configured", lastOperation: { kind: "activate", outcome: "zone_unimportable" } }, "zoneUnimportable"],
    [{ ...base, lastOperation: { kind: "observe", outcome: "unreachable" } }, "providerUnreachable"],
    [{ ...base, lastOperation: { kind: "observe", outcome: "retry_later" } }, "providerRetryLater"],
    [{ ...base, lastOperation: { kind: "activate", outcome: "credential_rejected" } }, "credentialRejected"],
    [{ ...base, qualified: false, capturable: true, lastOperation: { kind: "observe", outcome: "credential_rejected" } }, "unqualified"],
    [{ ...base, state: "busy", lastOperation: { kind: "observe", outcome: "unreachable" } }, "busy"],
    [{ ...base, state: "not-configured", lastOperation: { kind: "revoke", outcome: "nothing_to_revoke" } }, "notConfigured"],
    [{ ...base, lastOperation: { kind: "observe", outcome: "confirmed" } }, "connected"],
    [{ ...base, state: "not-configured", capturable: false, lastOperation: { kind: "activate", outcome: "failed" } }, "captureUnsupported"],
    [{ ...base, qualified: false, capturable: false }, "unqualified"],
    [{ ...base, lastOperation: { kind: "observe", outcome: "unqualified" } }, "connected"],
  ] as const)("decides %j as %s", (status, notice) => {
    expect(cloudflareNotice(status as CloudflareConnectionStatus | null)).toBe(notice);
  });

  it("turns a failed or invalid Host read into unreadable, never a guessed state", async () => {
    await expect(readCloudflareNotice({ status: vi.fn(async () => { throw new TypeError("invalid Cloudflare status"); }) })).resolves.toEqual({ status: null, notice: "unreadable" });
    await expect(readCloudflareNotice({ status: vi.fn(async () => base) })).resolves.toEqual({ status: base, notice: "connected" });
  });

  it("waits out a running operation, but stops when the caller no longer wants the answer or the bound is reached", async () => {
    const busy: CloudflareConnectionStatus = { ...base, state: "busy" };
    const sequence = [busy, busy, base];
    const port = { status: vi.fn(async () => sequence.shift() ?? base) };
    const wait = vi.fn(async () => undefined);
    await expect(settleCloudflareNotice(port, () => true, wait)).resolves.toEqual({ status: base, notice: "connected" });
    expect(port.status).toHaveBeenCalledTimes(3);

    const stuck = { status: vi.fn(async () => busy) };
    await expect(settleCloudflareNotice(stuck, () => true, wait, 4)).resolves.toEqual({ status: busy, notice: "busy" });
    expect(stuck.status).toHaveBeenCalledTimes(4);

    const unwanted = { status: vi.fn(async () => busy) };
    await expect(settleCloudflareNotice(unwanted, () => false, wait)).resolves.toMatchObject({ notice: "busy" });
    expect(unwanted.status).toHaveBeenCalledTimes(1);
  });
});
