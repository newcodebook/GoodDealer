import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { createForcedTakeoverPort } from "./forced-takeover";
const preview = { schemaVersion: 1, kind: "available", previewId: "preview-a", sourceDeviceId: "source-a", sourceLeaseEpoch: 2,
  earliestTakeoverAt: "2026-11-20T00:00:00Z", evaluatedAt: "2026-11-19T00:00:00Z" };
const body = () => JSON.parse(new TextDecoder().decode(invoke.mock.calls.at(-1)?.[1] as Uint8Array));
beforeEach(() => invoke.mockReset());
describe("forced takeover Native boundary", () => {
  it("reauthenticates without sending approval, then confirms only a bounded preview reference", async () => {
    const port = createForcedTakeoverPort();
    invoke.mockResolvedValue(null);
    await port.reauthenticate();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("forced_takeover_reauthenticate");
    invoke.mockResolvedValue(preview);
    expect(await port.preview()).toMatchObject({ previewId: "preview-a", sourceLeaseEpoch: 2 });
    invoke.mockResolvedValue({ schemaVersion: 1, kind: "requesting", intentId: "intent-a" });
    await port.confirm("preview-a");
    expect(body()).toEqual({ schemaVersion: 1, previewId: "preview-a" });
    expect(invoke.mock.calls.at(-1)?.[0]).toBe("forced_takeover_confirm");
  });
  it("requires exact cancellation correlation and nullable request identity", async () => {
    const port = createForcedTakeoverPort();
    invoke.mockResolvedValue({ schemaVersion: 1, kind: "cancelling", intentId: "intent-a", requestId: null });
    expect(await port.cancel("intent-a")).toEqual({ kind: "cancelling", intentId: "intent-a", requestId: null });
    expect(body()).toEqual({ schemaVersion: 1, intentId: "intent-a" });
    for (const result of [
      { schemaVersion: 1, kind: "cancelling", intentId: "other", requestId: null },
      { schemaVersion: 1, kind: "cancelling", intentId: "intent-a" },
      { schemaVersion: 1, kind: "idle" },
    ]) { invoke.mockResolvedValue(result); await expect(port.cancel("intent-a")).rejects.toThrow(); }
  });
  it("rejects secret-bearing, unknown, stale or malformed previews", async () => {
    const port = createForcedTakeoverPort();
    for (const result of [
      { ...preview, token: "canary-secret" }, { ...preview, sourceLeaseEpoch: 0 },
      { ...preview, earliestTakeoverAt: "2026-11-18T00:00:00Z" },
      { ...preview, evaluatedAt: "2026-02-31T00:00:00Z" }, { ...preview, previewId: "bad id" },
      { schemaVersion: 1, kind: "unavailable", reason: "not-yet-defined" },
    ]) { invoke.mockResolvedValue(result); await expect(port.preview()).rejects.toThrow(); }
    invoke.mockClear();
    await expect(port.confirm("bad id")).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("uses closed local states and does not make a poll an approval", async () => {
    const port = createForcedTakeoverPort();
    for (const state of [
      { kind: "idle" }, { kind: "requesting", intentId: "i" },
      { kind: "waiting", intentId: "i", requestId: "r", sourceDeviceId: "s", earliestTakeoverAt: preview.earliestTakeoverAt, evaluatedAt: preview.evaluatedAt },
      { kind: "installing", intentId: "i", requestId: "r" },
      { kind: "finished", intentId: "i", requestId: "r", status: "completed" },
      { kind: "stopped", intentId: "i", reason: "local_recovery_required", canCancel: true },
    ]) { invoke.mockResolvedValue({ schemaVersion: 1, ...state }); expect(await port.status()).toEqual(state); }
    expect(invoke.mock.calls.every(([name]) => name === "forced_takeover_status")).toBe(true);
    for (const state of [
      { kind: "stopped", intentId: "i", reason: "local_recovery_required" },
      { kind: "stopped", intentId: "i", reason: "unknown", canCancel: false },
      { kind: "finished", intentId: "i", requestId: "r", status: "succeeded" },
      { kind: "idle", cookie: "secret" },
    ]) { invoke.mockResolvedValue({ schemaVersion: 1, ...state }); await expect(port.status()).rejects.toThrow(); }
  });
});
