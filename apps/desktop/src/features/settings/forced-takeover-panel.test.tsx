// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ForcedTakeoverPort, ForcedTakeoverPreview, ForcedTakeoverView } from "../../adapters/tauri";
import { ForcedTakeoverPanel } from "./forced-takeover-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const available: ForcedTakeoverPreview = { kind: "available", previewId: "preview-a", sourceDeviceId: "source-a", sourceLeaseEpoch: 3,
  earliestTakeoverAt: "2026-11-20T00:00:00Z", evaluatedAt: "2026-11-19T00:00:00Z" };
function port() { return {
  reauthenticate: vi.fn(async () => {}), preview: vi.fn(async (): Promise<ForcedTakeoverPreview> => available),
  confirm: vi.fn(async (_id: string): Promise<ForcedTakeoverView> => ({ kind: "requesting", intentId: "original" })),
  status: vi.fn(async (): Promise<ForcedTakeoverView> => ({ kind: "idle" })),
  cancel: vi.fn(async (_id: string): Promise<ForcedTakeoverView> => ({ kind: "cancelled_before_request", intentId: "original" })),
} satisfies ForcedTakeoverPort; }
let element: HTMLDivElement, root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); vi.useRealTimers(); });
async function render(native: ForcedTakeoverPort, eligible = true) { await act(async () => root.render(<ForcedTakeoverPanel locale="en-US" port={native} eligible={eligible} />)); }
function button(text: string) { return Array.from(element.querySelectorAll("button")).find(node => node.textContent === text); }
async function click(text: string) { expect(button(text)).toBeDefined(); await act(async () => button(text)!.click()); }
async function check() { await act(async () => element.querySelector<HTMLInputElement>("input")!.click()); }
async function submit() { await act(async () => element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
it("keeps browser sign-in and preview separate from the one explicit durable approval", async () => {
  vi.useFakeTimers(); const native = port(); await render(native);
  await click("Verify identity again");
  expect(native.reauthenticate).toHaveBeenCalledTimes(1); expect(native.confirm).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Signing in alone does not start");
  await click("Read takeover preview");
  expect(button("Confirm takeover on this device")!.disabled).toBe(true);
  expect(element.textContent).toContain("execution epoch: 3");
  expect(element.textContent).toContain("may postpone takeover");
  const input = element.querySelector<HTMLInputElement>("input")!;
  expect(element.querySelector(`label[for="${input.id}"]`)!.textContent).toContain("unsynced changes");
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(native.confirm).not.toHaveBeenCalled();
  await check(); await submit();
  expect(native.confirm).toHaveBeenCalledExactlyOnceWith("preview-a");
  expect(element.querySelector("form")).toBeNull();
});
it("reads original status after a lost confirmation and never resends approval", async () => {
  vi.useFakeTimers(); const native = port(); native.confirm.mockRejectedValue(new Error("private token"));
  await render(native); await click("Read takeover preview"); await check(); await submit();
  expect(element.textContent).not.toContain("private token"); expect(button("Read takeover preview")).toBeUndefined();
  native.status.mockResolvedValue({ kind: "waiting", intentId: "original", requestId: "workflow", sourceDeviceId: "source-a",
    earliestTakeoverAt: "2026-11-21T00:00:00Z", evaluatedAt: "2026-11-19T00:00:00Z" });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.textContent).toContain("Nov 21");
  expect(native.confirm).toHaveBeenCalledTimes(1);
  expect(button("Stop this takeover")).toBeDefined();
});
it("cancels an unknown request by its original local intent without inventing a workflow", async () => {
  const native = port(); native.status.mockResolvedValue({ kind: "requesting", intentId: "original" });
  await render(native); await click("Stop this takeover");
  expect(button("Confirm stop takeover")!.disabled).toBe(true);
  await check(); await submit();
  expect(native.cancel).toHaveBeenCalledExactlyOnceWith("original");
  expect(element.textContent).toContain("Setup was cancelled");
  expect(native.confirm).not.toHaveBeenCalled();
});
it("withdraws an approval when eligibility changes and keeps blocking reasons cancellable", async () => {
  const native = port(); await render(native); await click("Read takeover preview"); await check();
  await render(native, false); expect(element.querySelector("form")).toBeNull(); expect(native.confirm).not.toHaveBeenCalled();
  native.status.mockResolvedValue({ kind: "stopped", intentId: "original", reason: "local_recovery_required", canCancel: true });
  await click("Refresh takeover status");
  expect(element.textContent).toContain("may already have been written");
  expect(button("Stop this takeover")).toBeDefined(); expect(button("Read takeover preview")).toBeUndefined();
});
it("discards an old preview when polling discovers an existing intent", async () => {
  vi.useFakeTimers(); const native = port(); await render(native); await click("Read takeover preview"); await check();
  native.status.mockResolvedValue({ kind: "requesting", intentId: "another" });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.querySelector("form")).toBeNull(); expect(native.confirm).not.toHaveBeenCalled();
});
it("discards a delayed preview across losing and regaining target eligibility", async () => {
  const native = port(); let resolvePreview!: (value: ForcedTakeoverPreview) => void;
  native.preview.mockImplementation(() => new Promise(resolve => { resolvePreview = resolve; }));
  await render(native); await click("Read takeover preview");
  await render(native, false); await render(native, true);
  await act(async () => resolvePreview(available));
  expect(element.querySelector("form")).toBeNull(); expect(native.confirm).not.toHaveBeenCalled();
  expect(button("Read takeover preview")!.disabled).toBe(false);
});
