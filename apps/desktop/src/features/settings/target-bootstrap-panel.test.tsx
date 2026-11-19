// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TargetBootstrapPort, TargetBootstrapView, TargetInstallationPort, TargetInstallationView } from "../../adapters/tauri";
import { TargetBootstrapPanel } from "./target-bootstrap-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const available: TargetBootstrapView = { kind: "available", requestId: "workflow-original", bootstrapExpiresAt: "2026-11-19T12:00:00Z" };
function port() { return { status: vi.fn(async (): Promise<TargetBootstrapView> => available), cancel: vi.fn(async (_id: string): Promise<TargetBootstrapView> => ({ kind: "finished", requestId: "workflow-original", status: "cancelled" })) } satisfies TargetBootstrapPort; }
let element: HTMLDivElement; let root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); vi.useRealTimers(); });
async function render(native: TargetBootstrapPort, installation?: TargetInstallationPort) { await act(async () => root.render(<TargetBootstrapPanel locale="en-US" port={native} {...(installation === undefined ? {} : { installationPort: installation })} />)); }
function button(text: string) { return Array.from(element.querySelectorAll("button")).find(node => node.textContent === text); }
async function click(text: string) { await act(async () => button(text)!.click()); }
async function preview() { await click("Stop this setup"); await act(async () => element.querySelector<HTMLInputElement>("input")!.click()); }
async function submit() { await act(async () => element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it("confirms only the displayed workflow and never promises restored execution", async () => {
  const native = port(); await render(native); await click("Stop this setup");
  expect(button("Confirm stop setup")!.disabled).toBe(true);
  const input = element.querySelector<HTMLInputElement>("input")!;
  expect(element.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
  await act(async () => input.click()); await submit();
  expect(native.cancel).toHaveBeenCalledExactlyOnceWith("workflow-original");
  expect(element.textContent).toContain("Execution authorization has not been restored");
  expect(element.textContent).toContain("data are preserved");
  expect(element.querySelector("form")).toBeNull();
});
it("keeps unknown outcomes read-only and lets Native reconcile after a lost reply", async () => {
  const native = port(); native.cancel.mockRejectedValue(new Error("private response")); await render(native); await preview(); await submit();
  expect(element.textContent).toContain("outcome is unknown"); expect(element.textContent).not.toContain("private response");
  expect(button("Stop this setup")).toBeUndefined();
  native.status.mockResolvedValue({ kind: "pending", requestId: "workflow-original" });
  await click("Refresh setup status");
  expect(element.textContent).toContain("Checking the original stop request");
  expect(native.cancel).toHaveBeenCalledTimes(1);
});
it("discards confirmation when polling discovers a different workflow", async () => {
  vi.useFakeTimers(); const native = port(); await render(native); await preview();
  native.status.mockResolvedValue({ ...available, requestId: "workflow-next" });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.querySelector("form")).toBeNull(); expect(native.cancel).not.toHaveBeenCalled();
  await click("Stop this setup"); expect(button("Confirm stop setup")!.disabled).toBe(true);
});
it("does not let a replaced session publish a late cancellation result", async () => {
  const old = port(); let complete!: (value: TargetBootstrapView) => void;
  old.cancel.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await render(old); await preview();
  act(() => { element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  const current = port(); current.status.mockResolvedValue({ kind: "idle" }); await render(current);
  await act(async () => complete({ kind: "finished", requestId: "workflow-original", status: "cancelled" }));
  expect(element.textContent).toContain("No device setup is waiting"); expect(element.textContent).not.toContain("Setup was cancelled");
});
it("only displays completion when activation won the race", async () => {
  const native = port(); native.cancel.mockResolvedValue({ kind: "finished", requestId: "workflow-original", status: "completed" });
  await render(native); await preview(); await submit();
  expect(element.textContent).toContain("already activated"); expect(button("Stop this setup")).toBeUndefined();
});


function installer() {
  return { status: vi.fn(async (): Promise<TargetInstallationView> => ({ kind: "idle" })),
    start: vi.fn(async (requestId: string): Promise<TargetInstallationView> => ({ kind: "running", requestId, phase: "claiming" })) } satisfies TargetInstallationPort;
}
async function receive() {
  await click("Receive on this device");
  await act(async () => element.querySelector<HTMLInputElement>("input")!.click());
}
it("confirms receive once, explains the recovery limit, and leaves all progress to Native", async () => {
  vi.useFakeTimers(); const native = port(); const installation = installer(); await render(native, installation);
  await click("Receive on this device"); expect(button("Confirm receive and activate")!.disabled).toBe(true);
  expect(element.textContent).toContain("last successfully synchronized Cloud data");
  expect(element.textContent).toContain("Reconnect your platforms");
  expect(button("Stop this setup")).toBeUndefined();
  await act(async () => element.querySelector<HTMLInputElement>("input")!.click()); await submit();
  expect(installation.start).toHaveBeenCalledExactlyOnceWith("workflow-original");
  installation.status.mockResolvedValue({ kind: "running", requestId: "workflow-original", phase: "activating" });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(element.textContent).toContain("Reconciling activation");
  expect(installation.start).toHaveBeenCalledTimes(1); expect(native.cancel).not.toHaveBeenCalled();
});
it("reads original progress after lost start acknowledgement without sending start again", async () => {
  vi.useFakeTimers(); const native = port(); const installation = installer(); installation.start.mockRejectedValue(new Error("private capability"));
  await render(native, installation); await receive(); await submit();
  expect(element.textContent).toContain("outcome is unknown"); expect(element.textContent).not.toContain("private capability");
  installation.status.mockResolvedValue({ kind: "running", requestId: "workflow-original", phase: "downloading" });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.textContent).toContain("Downloading and validating"); expect(installation.start).toHaveBeenCalledTimes(1);
});
it("invalidates a receive confirmation on workflow change and on another start", async () => {
  vi.useFakeTimers(); const native = port(); const installation = installer(); await render(native, installation); await receive();
  native.status.mockResolvedValue({ ...available, requestId: "next" });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.querySelector("form")).toBeNull();
  await click("Receive on this device"); expect(button("Confirm receive and activate")!.disabled).toBe(true);
  installation.status.mockResolvedValue({ kind: "running", requestId: "next", phase: "claiming" });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.querySelector("form")).toBeNull(); expect(installation.start).not.toHaveBeenCalled();
});
it("never replaces an existing replica or equates stopped setup with completed installation", async () => {
  const native = port(); const installation = installer();
  installation.status.mockResolvedValue({ kind: "existing_replica", requestId: "workflow-original" }); await render(native, installation);
  expect(element.textContent).toContain("cannot replace it"); expect(button("Receive on this device")).toBeUndefined();
  installation.status.mockResolvedValue({ kind: "stopped", requestId: "workflow-original", status: "failed" }); await click("Refresh setup status");
  expect(element.textContent).toContain("setup has ended"); expect(element.textContent).not.toContain("Setup is complete");
});
it("does not publish a late result from a replaced installation port", async () => {
  const native = port(); const old = installer(); let complete!: (value: TargetInstallationView) => void;
  old.start.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await render(native, old); await receive();
  act(() => { element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await render(native, installer());
  await act(async () => complete({ kind: "completed", requestId: "workflow-original" }));
  expect(element.textContent).not.toContain("Setup is complete");
});

it("retains an existing-replica refusal during local idle polls until the workflow changes", async () => {
  vi.useFakeTimers(); const native = port(); const installation = installer();
  installation.start.mockResolvedValue({ kind: "existing_replica", requestId: "workflow-original" });
  await render(native, installation); await receive(); await submit();
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.textContent).toContain("cannot replace it"); expect(button("Receive on this device")).toBeUndefined();
  native.status.mockResolvedValue({ ...available, requestId: "next" });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.textContent).not.toContain("cannot replace it"); expect(button("Receive on this device")).toBeDefined();
});
