// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TargetBootstrapPort, TargetBootstrapView } from "../../adapters/tauri";
import { TargetBootstrapPanel } from "./target-bootstrap-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const available: TargetBootstrapView = { kind: "available", requestId: "workflow-original", bootstrapExpiresAt: "2026-11-19T12:00:00Z" };
function port() { return { status: vi.fn(async (): Promise<TargetBootstrapView> => available), cancel: vi.fn(async (_id: string): Promise<TargetBootstrapView> => ({ kind: "finished", requestId: "workflow-original", status: "cancelled" })) } satisfies TargetBootstrapPort; }
let element: HTMLDivElement; let root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); vi.useRealTimers(); });
async function render(native: TargetBootstrapPort) { await act(async () => root.render(<TargetBootstrapPanel locale="en-US" port={native} />)); }
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
