import { beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import { createDeviceDirectoryPort } from "./index";
const view = { schemaVersion: 1, listRevision: 1, devices: [{ deviceId: "self", displayName: "Desk", platform: "linux", status: "bound", role: "active", currentDevice: true, lastSeenAt: null }] };
beforeEach(() => invokeMock.mockReset());
describe("device directory IPC", () => {
  it("uses fixed commands and submits only the name intent as bounded raw JSON", async () => {
    invokeMock.mockResolvedValue(view);
    const port = createDeviceDirectoryPort();
    await expect(port.read()).resolves.toEqual(view);
    expect(invokeMock).toHaveBeenLastCalledWith("device_directory_read");
    await expect(port.reportSelf({ schemaVersion: 1, displayName: "Desk" })).resolves.toEqual(view);
    const [command, wire] = invokeMock.mock.calls.at(-1)!;
    expect(command).toBe("device_self_report");
    expect(JSON.parse(new TextDecoder().decode(wire))).toEqual({ schemaVersion: 1, displayName: "Desk" });
  });
  it("rejects forged input before IPC and signing metadata returned by IPC", async () => {
    const port = createDeviceDirectoryPort();
    await expect(port.reportSelf({ schemaVersion: 1, displayName: "x", deviceId: "other" } as never)).rejects.toThrow("invalid device name intent");
    expect(invokeMock).not.toHaveBeenCalled();
    invokeMock.mockResolvedValue({ ...view, token: "secret" });
    await expect(port.read()).rejects.toThrow("invalid device directory projection");
  });
});
