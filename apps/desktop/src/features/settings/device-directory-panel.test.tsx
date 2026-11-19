// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeviceDirectorySettingsPort, type DeviceDirectoryView } from "@gooddealer/client-core";
import { DeviceDirectoryPanel } from "./device-directory-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const view = (name = "Desk"): DeviceDirectoryView => ({ schemaVersion: 1, listRevision: 2, devices: [
  { deviceId: "device-self", displayName: name, platform: "macos", status: "bound", role: "active", currentDevice: true, lastSeenAt: "2026-11-18T15:00:00Z" },
  { deviceId: "device-peer", displayName: null, platform: "windows", status: "bound", role: "standby", currentDevice: false, lastSeenAt: null },
] });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(port: DeviceDirectorySettingsPort) { await act(async () => root.render(<DeviceDirectoryPanel locale="en-US" port={port} />)); }
async function submit(name: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
async function refresh() {
  await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Refresh devices")!.click());
}
describe("device directory customer journey", () => {
  it("loads Cloud metadata, saves a self name, and reads the persisted name after reopening", async () => {
    let stored = view();
    const port = { read: vi.fn(async () => stored), reportSelf: vi.fn(async (intent) => { stored = view(intent.displayName); return stored; }) } satisfies DeviceDirectorySettingsPort;
    await render(port);
    expect(container.textContent).toContain("Desk");
    expect(container.textContent).toContain("Standby");
    expect(container.textContent).toContain("Not reported");
    expect(container.textContent).not.toContain("Switch to");
    const input = container.querySelector("input")!;
    expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    await submit("Studio");
    expect(port.reportSelf).toHaveBeenCalledWith({ schemaVersion: 1, displayName: "Studio" });
    expect(container.textContent).toContain("Device name saved.");
    await act(async () => root.render(null));
    await render(port);
    expect(container.querySelector("input")?.value).toBe("Studio");
  });
  it("requires reconciliation after an unknown save result instead of repeating the write", async () => {
    let stored = view();
    const port = { read: vi.fn(async () => stored), reportSelf: vi.fn(async (intent) => { stored = view(intent.displayName); throw new Error("private transport data"); }) } satisfies DeviceDirectorySettingsPort;
    await render(port); await submit("Already committed");
    expect(container.textContent).toContain("save result is unknown");
    expect(container.textContent).not.toContain("private transport data");
    expect(container.querySelector("form")).toBeNull();
    expect(port.reportSelf).toHaveBeenCalledTimes(1);
    await refresh();
    expect(container.querySelector("input")?.value).toBe("Already committed");
    expect(port.reportSelf).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid names and discards a response from a replaced session port", async () => {
    let resolveOld!: (value: DeviceDirectoryView) => void;
    const old = { read: () => new Promise<DeviceDirectoryView>((resolve) => { resolveOld = resolve; }), reportSelf: vi.fn() };
    await render(old);
    const current = { read: async () => view("New session"), reportSelf: vi.fn() };
    await render(current);
    await act(async () => resolveOld(view("Old account")));
    expect(container.textContent).not.toContain("Old account");
    expect(container.querySelector("input")?.value).toBe("New session");
    await submit(" invalid ");
    expect(current.reportSelf).not.toHaveBeenCalled();
    expect(container.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
  });
});
