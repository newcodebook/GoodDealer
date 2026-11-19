// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AfternicConnectionPort, AfternicListingWritePlan, AfternicListingWritePort, AfternicListingWritePreviewRequest } from "@gooddealer/client-core";
import { AfternicListingWritePanel } from "./afternic-listing-write-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = "aa000000-0000-4000-8000-000000000001";
const createdAt = "2026-11-19T00:00:00Z";
const values = { buynowPriceMicroUsd: 0, floorPriceMicroUsd: 0, minbidPriceMicroUsd: 20_000_000, hidden: false };
function preview(request: AfternicListingWritePreviewRequest = { schemaVersion: 1, connectionId: id, action: "create", items: [{ domain: "wecin.com", values }] }): AfternicListingWritePlan {
  return { schemaVersion: 1, planRef: id, planHash: "a".repeat(64), action: request.action, connectionLabel: "My market", createdAt,
    expiresAt: "2026-11-19T00:15:00Z", approvedAt: null, state: "awaiting_approval", items: request.items.map((item): AfternicListingWritePlan["items"][number] => ({ domain: item.domain,
      before: request.action === "update" ? { ...values, providerStatus: "ACTIVE", observedAt: createdAt } : null,
      changes: "values" in item ? item.values : item.patch, latest: null, fieldsMatched: false, state: "preview", reason: null, retryAt: null })).sort((a, b) => a.domain < b.domain ? -1 : 1) };
}
function queued(plan = preview()): AfternicListingWritePlan {
  return { ...plan, approvedAt: createdAt, state: "executing", items: plan.items.map(item => ({ ...item, state: "queued" })) };
}
let element: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-19T00:00:30Z"));
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); });
function ports(initial: AfternicListingWritePlan | null = null) {
  let saved = initial; let available = true;
  const port: AfternicListingWritePort = {
    preview: vi.fn(async request => { saved = preview(request); return saved; }),
    approve: vi.fn(async () => { saved = queued(saved ?? undefined); return saved; }),
    status: vi.fn<AfternicListingWritePort["status"]>(async ({ planRef }) => ({ schemaVersion: 1, writeQualified: true, writeEntitled: true, executionAvailable: available,
      plans: saved === null ? [] : [{ planRef: saved.planRef, action: saved.action, connectionLabel: saved.connectionLabel, createdAt, state: saved.state, total: saved.items.length,
        applied: saved.items.filter(item => item.state === "applied").length, conflicts: saved.items.filter(item => item.state === "conflict").length,
        pending: saved.items.filter(item => !["applied", "conflict"].includes(item.state)).length,
        pendingProvider: saved.items.filter(item => item.state === "pending_provider").length, pendingVerification: saved.items.filter(item => item.state === "pending_verification").length }],
      detail: planRef === null ? null : saved })),
  };
  const connections: AfternicConnectionPort = {
    status: vi.fn<AfternicConnectionPort["status"]>(async () => ({ schemaVersion: 1, observeQualified: true, observeEntitled: true, capturable: true,
      laneState: "ready", lastOperation: null, connections: [{ connectionId: id, displayLabel: "My market", state: "active", purgePending: false, lastScan: null }] })),
    connect: vi.fn(), refresh: vi.fn(), revoke: vi.fn(),
  };
  return { port, connections, setSaved(value: AfternicListingWritePlan) { saved = value; }, setAvailable(value: boolean) { available = value; } };
}
async function mount(native: ReturnType<typeof ports>, readOnly = false) {
  await act(async () => root.render(<AfternicListingWritePanel locale="en-US" port={native.port} connectionsPort={native.connections} readOnly={readOnly} onChanged={vi.fn()} />));
}
function button(text: string) {
  const result = [...element.querySelectorAll("button")].find(entry => entry.textContent === text);
  expect(result, text).toBeDefined(); return result!;
}
async function setInput(name: string, value: string) {
  const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  expect(input, name).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function select(name: string, value: string) {
  const input = element.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function check(name: string) { await act(async () => element.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.click()); }
async function submit() { await act(async () => element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function prepare(domains = "wecin.com", action = "create") { await select("connectionId", id); await select("action", action); await setInput("domains", domains); await submit(); }
async function openHistory() { await act(async () => element.querySelector<HTMLButtonElement>(".afternic-listing-write-history button")!.click()); }

it("supports distinct per-domain create settings, preserves zero/false and approves the exact saved batch once", async () => {
  const native = ports(); await mount(native); await prepare("WECIN.com\nexample.com");
  expect(native.port.preview).not.toHaveBeenCalled();
  await setInput("1-buynowPriceMicroUsd", "49999999"); await check("1-hidden"); await submit();
  expect(native.port.preview).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, connectionId: id, action: "create", items: [
    { domain: "wecin.com", values }, { domain: "example.com", values: { ...values, buynowPriceMicroUsd: 49_999_999_000_000, hidden: true } },
  ] });
  expect(native.port.approve).not.toHaveBeenCalled(); expect(element.textContent).toContain("No listing in the last complete inventory scan");
  expect(element.textContent).toContain("$49,999,999.00"); expect(element.querySelector('input[type="password"]')).toBeNull();
  await act(async () => { button("Approve changes for 2 domains").click(); button("Approve changes for 2 domains").click(); });
  expect(native.port.approve).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, planRef: id, planHash: "a".repeat(64) });
  expect(element.textContent).toContain("Waiting for preflight check"); expect(element.textContent).not.toContain("Listed");
});
it("updates only explicitly selected keys including zero and false", async () => {
  const native = ports(); await mount(native); await prepare("wecin.com", "update"); await submit();
  expect(native.port.preview).not.toHaveBeenCalled(); expect(element.textContent).toContain("Select at least one setting");
  await check("0-buynowPriceMicroUsd-selected"); await check("0-hidden-selected"); await submit();
  expect(native.port.preview).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, connectionId: id, action: "update", items: [{ domain: "wecin.com", patch: { buynowPriceMicroUsd: 0, hidden: false } }] });
  expect(element.textContent).toContain("Before (last complete scan)"); expect(native.port.approve).not.toHaveBeenCalled();
});
it("rejects fractions, exponent notation, minimum bids below twenty and values above the bound without rounding", async () => {
  const native = ports(); await mount(native); await prepare();
  for (const [name, value] of [["0-buynowPriceMicroUsd", "1.5"], ["0-floorPriceMicroUsd", "2e3"], ["0-minbidPriceMicroUsd", "19"], ["0-buynowPriceMicroUsd", "50000000"]]) {
    await setInput(name!, value!); await submit(); expect(native.port.preview).not.toHaveBeenCalled();
    expect(element.querySelector(`[name="${name}"]`)?.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(element.querySelector(`[name="${name}"]`));
    await setInput(name!, name!.includes("minbid") ? "20" : "0");
  }
});
it("rejects duplicate canonical targets and changing targets discards previous per-item fields", async () => {
  const native = ports(); await mount(native); await prepare("WECIN.com\nwecin.com");
  expect(native.port.preview).not.toHaveBeenCalled(); expect(element.textContent).toContain("distinct valid domains");
  await setInput("domains", "wecin.com"); await submit(); await setInput("0-buynowPriceMicroUsd", "123");
  await setInput("domains", "example.com"); expect(element.querySelector('[name="0-buynowPriceMicroUsd"]')).toBeNull();
  await submit(); expect(element.querySelector<HTMLInputElement>('[name="0-buynowPriceMicroUsd"]')?.value).toBe("0");
});
it("reads saved outcome after a lost approval reply and never reapproves automatically", async () => {
  const native = ports(preview());
  vi.mocked(native.port.approve).mockImplementation(async () => { native.setSaved(queued()); throw new Error("closed failure"); });
  await mount(native); await openHistory(); await act(async () => button("Approve changes for 1 domains").click());
  expect(native.port.approve).toHaveBeenCalledTimes(1); expect(native.port.preview).not.toHaveBeenCalled();
  expect(vi.mocked(native.port.status).mock.calls.at(-1)?.[0]).toEqual({ schemaVersion: 1, planRef: id });
  expect(element.textContent).toContain("outcome is unconfirmed"); expect(element.textContent).toContain("Waiting for preflight check");
});
it("lists a durably saved preview after a lost reply without reconstructing or approving it", async () => {
  const native = ports();
  vi.mocked(native.port.preview).mockImplementation(async request => { native.setSaved(preview(request)); throw new Error("closed failure"); });
  await mount(native); await prepare(); await submit();
  expect(native.port.preview).toHaveBeenCalledTimes(1); expect(native.port.approve).not.toHaveBeenCalled();
  expect(element.textContent).toContain("outcome is unconfirmed"); expect(element.querySelector(".afternic-listing-write-history button")).not.toBeNull();
  expect(element.querySelector("table")).toBeNull(); await openHistory(); expect(element.textContent).toContain("Settings to apply");
});
it("invalidates delayed preview across role loss and regain", async () => {
  const native = ports(); let resolve!: (plan: AfternicListingWritePlan) => void;
  vi.mocked(native.port.preview).mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(native); await prepare(); await submit(); await mount(native, true); await mount(native, false);
  await act(async () => resolve(preview()));
  expect(element.querySelector("table")).toBeNull(); expect(native.port.approve).not.toHaveBeenCalled();
  expect([...element.querySelectorAll("button")].some(entry => entry.textContent?.startsWith("Approve changes"))).toBe(false);
});
it("discards delayed preview replies from replaced ports", async () => {
  const old = ports(); let resolve!: (plan: AfternicListingWritePlan) => void;
  vi.mocked(old.port.preview).mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(old); await prepare(); await submit(); const next = ports(); await mount(next);
  await act(async () => resolve(preview())); expect(element.querySelector("table")).toBeNull();
  expect(old.port.approve).not.toHaveBeenCalled(); expect(next.port.approve).not.toHaveBeenCalled();
});
it("shows matching fields and pending ownership separately and retains read-only history", async () => {
  const plan = queued(); plan.items[0] = { ...plan.items[0]!, state: "pending_verification", latest: { ...values, providerStatus: "OWNERSHIP_UNVERIFIED", observedAt: createdAt }, fieldsMatched: true, reason: "postcondition_pending", retryAt: "2026-11-19T00:01:00Z" };
  const native = ports(plan); await mount(native, true); await openHistory();
  expect(element.textContent).toContain("OWNERSHIP_UNVERIFIED"); expect(element.textContent).toContain("Waiting for ownership verification");
  expect(element.textContent).toContain("does not prove ownership"); expect(element.textContent).not.toContain("Created and hidden");
  expect(element.querySelector("form")).toBeNull(); expect(native.port.approve).not.toHaveBeenCalled();
});
it("keeps preview available while execution is paused but disables approval, and refuses expired approval", async () => {
  const native = ports(preview()); native.setAvailable(false); await mount(native); expect(element.querySelector("form")).not.toBeNull(); await openHistory();
  expect(button("Approve changes for 1 domains").disabled).toBe(true);
  native.setAvailable(true); vi.mocked(Date.now).mockReturnValue(Date.parse("2026-11-19T00:15:00Z"));
  await act(async () => button("Refresh plan status").click()); expect(button("Approve changes for 1 domains").disabled).toBe(true);
  expect(native.port.approve).not.toHaveBeenCalled();
});
it("removes approval when a status read fails", async () => {
  const native = ports(preview()); await mount(native); await openHistory();
  vi.mocked(native.port.status).mockRejectedValue(new Error("closed failure")); await act(async () => button("Refresh plan status").click());
  expect(element.textContent).toContain("Plan status is unavailable"); expect(element.querySelector("table")).toBeNull(); expect(native.port.approve).not.toHaveBeenCalled();
});
