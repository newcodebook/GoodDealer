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
  it("composes source handoff from the actual listed target and a bounded Native port", async () => {
    const native = {
      status: vi.fn(async () => ({ kind: "idle" as const, frozenUnresolved: 0 })),
      request: vi.fn(async () => ({ kind: "waiting_for_sync" as const, unconfirmed: 2, frozenUnresolved: 1 })),
      advance: vi.fn(), cancel: vi.fn(),
    };
    await act(async () => root.render(<DeviceDirectoryPanel locale="en-US" port={{ read: async () => view(), reportSelf: vi.fn() }} switchPort={native} />));
    const target = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.startsWith("Hand off to "))!;
    expect(target.textContent).toContain("ice-peer");
    await act(async () => target.click());
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const form = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.closest("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(native.request).toHaveBeenCalledExactlyOnceWith("device-peer");
    expect(container.textContent).toContain("2 records");
    expect(native.advance).not.toHaveBeenCalled();
  });
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
  it("reads and refreshes the Standby directory without exposing a name mutation", async () => {
    const standby = view();
    const port = { read: vi.fn(async () => standby), reportSelf: vi.fn() };
    await act(async () => root.render(<DeviceDirectoryPanel locale="en-US" port={port} readOnly />));
    expect(container.textContent).toContain("Desk");
    expect(container.querySelector("form")).toBeNull();
    await refresh();
    expect(port.read).toHaveBeenCalledTimes(2);
    expect(port.reportSelf).not.toHaveBeenCalled();
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

it("offers target termination on a read-only device even when directory metadata is unavailable", async () => {
  const native = { status: vi.fn(async () => ({ kind: "available" as const, requestId: "original", bootstrapExpiresAt: "2026-11-19T12:00:00Z" })),
    cancel: vi.fn(async () => ({ kind: "finished" as const, requestId: "original", status: "cancelled" as const })) };
  const directory = { read: vi.fn(async (): Promise<DeviceDirectoryView> => { throw new Error("offline directory"); }), reportSelf: vi.fn() };
  await act(async () => root.render(<DeviceDirectoryPanel locale="en-US" port={directory} bootstrapPort={native} readOnly />));
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find(item => item.textContent === label)!;
  await act(async () => button("Stop this setup").click());
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(native.cancel).toHaveBeenCalledExactlyOnceWith("original");
  expect(directory.reportSelf).not.toHaveBeenCalled();
});
