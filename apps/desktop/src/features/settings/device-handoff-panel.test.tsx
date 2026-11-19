// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeviceDirectoryView } from "@gooddealer/client-core";
import type { DeviceSwitchPort, DeviceSwitchStep } from "../../adapters/tauri";
import { DeviceHandoffPanel } from "./device-handoff-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const directory: DeviceDirectoryView = { schemaVersion: 1, listRevision: 1, devices: [
  { deviceId: "self", displayName: "Desk", platform: "macos", status: "bound", role: "active", currentDevice: true, lastSeenAt: null },
  { deviceId: "peer", displayName: "Laptop", platform: "windows", status: "bound", role: "standby", currentDevice: false, lastSeenAt: null },
] };
const idle: DeviceSwitchStep = { kind: "idle", frozenUnresolved: 0 };
const waiting: DeviceSwitchStep = { kind: "waiting_for_sync", unconfirmed: 3, frozenUnresolved: 1 };
function port(initial: DeviceSwitchStep = idle) {
  return { status: vi.fn(async () => initial), request: vi.fn(async () => waiting),
    cancel: vi.fn(async (): Promise<DeviceSwitchStep> => ({ kind: "writes_reopened", frozenUnresolved: 0 })),
    advance: vi.fn(async () => waiting) } satisfies DeviceSwitchPort;
}
let element: HTMLDivElement;
let root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); vi.useRealTimers(); });
async function render(native: DeviceSwitchPort, readOnly = false) {
  await act(async () => root.render(<DeviceHandoffPanel locale="en-US" port={native} directory={directory} readOnly={readOnly} />));
}
function button(label: string) { return Array.from(element.querySelectorAll("button")).find(node => node.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function confirm() {
  await click("Hand off to Laptop · peer");
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it("confirms a listed Standby target once and reports retained unknown operations", async () => {
  const native = port(); await render(native);
  await click("Hand off to Laptop · peer");
  expect(button("Confirm handoff").disabled).toBe(true);
  const input = element.querySelector<HTMLInputElement>("input")!;
  expect(element.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
  await act(async () => input.click());
  await act(async () => element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(native.request).toHaveBeenCalledExactlyOnceWith("peer");
  expect(element.querySelector('[role="status"]')?.textContent).toContain("3 records");
  expect(element.textContent).toContain("1 platform operations had unknown outcomes");
  expect(element.textContent).toContain("not transferred as executable work or sent again");
  expect(element.querySelector("form")).toBeNull();
  expect(native.advance).not.toHaveBeenCalled();
  await click("Cancel handoff");
  expect(native.cancel).toHaveBeenCalledTimes(1);
  expect(element.textContent).toContain("current authorization permits");
});

it("reads the original request after a lost reply without another confirmation or POST", async () => {
  const native = port(); native.request.mockRejectedValue(new Error("private response"));
  await render(native); await confirm();
  expect(element.textContent).toContain("outcome is unknown");
  expect(element.textContent).not.toContain("private response");
  expect(button("Hand off to Laptop · peer")).toBeUndefined();
  native.status.mockResolvedValue({ kind: "request_pending", frozenUnresolved: null });
  await click("Refresh handoff status");
  expect(element.textContent).toContain("Reconciling the handoff request");
  expect(element.textContent).not.toContain("platform operations had unknown outcomes");
  expect(button("Cancel handoff")).toBeUndefined();
  expect(native.request).toHaveBeenCalledTimes(1);
  native.status.mockResolvedValue(waiting);
  await click("Refresh handoff status");
  expect(element.textContent).toContain("3 records");
  expect(native.request).toHaveBeenCalledTimes(1);
});

it("reopens with persisted progress and only polls status while Native owns progression", async () => {
  vi.useFakeTimers(); const native = port(waiting); await render(native);
  expect(element.textContent).toContain("3 records");
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(native.status).toHaveBeenCalledTimes(2);
  expect(native.advance).not.toHaveBeenCalled();
  expect(native.request).not.toHaveBeenCalled();
});

it("withholds handoff and cancel on Standby and does not mistake missing counts for zero", async () => {
  const native = port({ kind: "switch", status: "bootstrapping", frozenUnresolved: null });
  await render(native, true);
  expect(button("Cancel handoff")).toBeUndefined();
  expect(button("Hand off to Laptop · peer")).toBeUndefined();
  expect(element.textContent).toContain("currently unavailable");
  expect(element.textContent).toContain("target still needs to complete setup");
  expect(native.cancel).not.toHaveBeenCalled();
});

it("discards a response from a replaced session and does not offer removed targets", async () => {
  let complete!: (step: DeviceSwitchStep) => void;
  const old = port(); old.status.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await render(old); const current = port(waiting); await render(current);
  await act(async () => complete(idle));
  expect(element.textContent).toContain("3 records");
  await act(async () => root.render(<DeviceHandoffPanel locale="en-US" port={port()} directory={{ ...directory, devices: [directory.devices[0]!, { ...directory.devices[1]!, status: "removed", role: "none" }] }} readOnly={false} />));
  expect(button("Hand off to Laptop · peer")).toBeUndefined();
});

it("distinguishes unnamed and identically named targets in the selection and confirmation", async () => {
  for (const displayName of [null, "Laptop"]) {
    const native = port();
    const targets = ["device-first-12345678", "device-next-87654321"].map(deviceId => ({ ...directory.devices[1]!, deviceId, displayName }));
    await act(async () => root.render(<DeviceHandoffPanel locale="en-US" port={native} directory={{ ...directory, devices: [directory.devices[0]!, ...targets] }} readOnly={false} />));
    const choices = Array.from(element.querySelectorAll("button")).filter(node => node.textContent?.startsWith("Hand off to "));
    expect(choices).toHaveLength(2);
    expect(choices[0]!.textContent).toContain("12345678");
    expect(choices[1]!.textContent).toContain("87654321");
    await act(async () => choices[1]!.click());
    expect(element.querySelector("form")!.textContent).toContain("87654321");
    expect(element.querySelector("form")!.textContent).not.toContain("12345678");
    await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(native.request).toHaveBeenCalledExactlyOnceWith("device-next-87654321");
  }
});

it("does not offer source cancellation after Lease release even before role refresh", async () => {
  const native = port({ kind: "switch", status: "bootstrapping", frozenUnresolved: 0 });
  await render(native, false);
  expect(button("Cancel handoff")).toBeUndefined();
  expect(native.cancel).not.toHaveBeenCalled();
});
