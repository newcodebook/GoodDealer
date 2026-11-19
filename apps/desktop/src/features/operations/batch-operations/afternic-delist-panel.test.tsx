// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AfternicConnectionPort, AfternicDelistPlan, AfternicDelistPort } from "@gooddealer/client-core";
import { AfternicDelistPanel } from "./afternic-delist-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = "aa000000-0000-4000-8000-000000000001";
const createdAt = "2026-11-19T00:00:00Z";
function preview(): AfternicDelistPlan {
  return { schemaVersion: 1, planRef: id, planHash: "a".repeat(64), connectionLabel: "My market",
    createdAt, expiresAt: "2026-11-19T00:15:00Z", approvedAt: null, state: "awaiting_approval",
    items: [{ domain: "example.com", providerStatus: "ACTIVE", buynowPrice: 100_000_000,
      floorPrice: 80_000_000, minbidPrice: 20_000_000, hidden: false, observedAt: createdAt,
      state: "preview", reason: null, retryAt: null }] };
}
let element: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-19T00:00:30Z"));
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); });
function ports(initial: AfternicDelistPlan | null = null) {
  let saved = initial;
  let executionAvailable = true;
  const port: AfternicDelistPort = {
    preview: vi.fn(async () => { saved = preview(); return saved; }),
    approve: vi.fn(async () => {
      saved = { ...preview(), approvedAt: createdAt, state: "executing", items: preview().items.map((item) => ({ ...item, state: "queued" })) };
      return saved;
    }),
    status: vi.fn<AfternicDelistPort["status"]>(async ({ planRef }) => ({ schemaVersion: 1, writeQualified: true, writeEntitled: true, executionAvailable,
      plans: saved === null ? [] : [{ planRef: saved.planRef, connectionLabel: saved.connectionLabel, createdAt,
        state: saved.state, total: 1, succeeded: saved.state === "completed" ? 1 : 0, conflicts: 0, pending: saved.state === "completed" ? 0 : 1 }],
      detail: planRef === null ? null : saved })),
  };
  const connections: AfternicConnectionPort = {
    status: vi.fn<AfternicConnectionPort["status"]>(async () => ({ schemaVersion: 1, observeQualified: true, observeEntitled: true, capturable: true,
      laneState: "ready", lastOperation: null, connections: [{ connectionId: id, displayLabel: "My market", state: "active", purgePending: false, lastScan: null }] })),
    connect: vi.fn(), refresh: vi.fn(), revoke: vi.fn(),
  };
  return { port, connections, setSaved(value: AfternicDelistPlan) { saved = value; }, setAvailable(value: boolean) { executionAvailable = value; } };
}
async function mount(native: ReturnType<typeof ports>, readOnly = false) {
  await act(async () => root.render(<AfternicDelistPanel locale="en-US" port={native.port} connectionsPort={native.connections} readOnly={readOnly} onChanged={vi.fn()} />));
}
function button(text: string) {
  const value = [...element.querySelectorAll("button")].find((entry) => entry.textContent === text);
  expect(value).toBeDefined(); return value!;
}
async function openHistory() { await act(async () => element.querySelector<HTMLButtonElement>(".afternic-delist-history button")!.click()); }
async function input(value: string) {
  const area = element.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function chooseConnection() {
  const select = element.querySelector("select")!;
  await act(async () => { select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function submit() { await act(async () => element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it("creates an observed preview and requires one explicit approval of the exact batch", async () => {
  const native = ports(); await mount(native); await chooseConnection(); await input("EXAMPLE.com"); await submit();
  expect(native.port.preview).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, connectionId: id, domains: ["example.com"] });
  expect(native.port.approve).not.toHaveBeenCalled();
  expect(element.textContent).toContain("last completed inventory scan");
  expect(element.textContent).toContain("$100.00"); expect(element.textContent).toContain("$80.00"); expect(element.textContent).toContain("$20.00");
  expect(element.querySelector('input[type="password"]')).toBeNull();
  await act(async () => button("Approve removal of 1 listings").click());
  expect(native.port.approve).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, planRef: id, planHash: "a".repeat(64) });
  expect(element.textContent).toContain("Waiting for preflight check");
  expect(element.textContent).not.toContain("Absence confirmed");
});

it("reconciles lost approval replies by reading status without automatic reapproval", async () => {
  const native = ports(preview());
  vi.mocked(native.port.approve).mockImplementation(async () => {
    native.setSaved({ ...preview(), approvedAt: createdAt, state: "executing", items: preview().items.map((item) => ({ ...item, state: "reconciling", reason: "still_present", retryAt: "2026-11-19T00:01:00Z" })) });
    throw new Error("closed failure");
  });
  await mount(native); await openHistory(); await act(async () => button("Approve removal of 1 listings").click());
  expect(native.port.approve).toHaveBeenCalledTimes(1); expect(native.port.preview).not.toHaveBeenCalled();
  expect(vi.mocked(native.port.status).mock.calls.at(-1)?.[0]).toEqual({ schemaVersion: 1, planRef: id });
  expect(element.textContent).toContain("without sending another removal");
  expect(element.textContent).toContain("outcome is unconfirmed");
  expect([...element.querySelectorAll("button")].some((entry) => entry.textContent?.startsWith("Approve removal"))).toBe(false);
});

it("removes write affordances on role downgrade while retaining read-only plan history", async () => {
  const native = ports(preview()); await mount(native); await openHistory(); await mount(native, true);
  expect(element.querySelector("form")).toBeNull(); expect(element.textContent).toContain("example.com");
  expect([...element.querySelectorAll("button")].some((entry) => entry.textContent?.startsWith("Approve removal"))).toBe(false);
  expect(native.port.preview).not.toHaveBeenCalled(); expect(native.port.approve).not.toHaveBeenCalled();
});

it("keeps local preview available but disables approval while background execution is unavailable", async () => {
  const native = ports(preview()); native.setAvailable(false); await mount(native);
  expect(element.querySelector("form")).not.toBeNull(); await openHistory();
  expect(button("Approve removal of 1 listings").disabled).toBe(true);
  expect(element.textContent).toContain("Background execution is temporarily unavailable");
  expect(native.port.approve).not.toHaveBeenCalled();
});

it("refuses duplicate targets with accessible feedback and sends no preview", async () => {
  const native = ports(); await mount(native); await chooseConnection(); await input("example.com\nexample.com"); await submit();
  expect(native.port.preview).not.toHaveBeenCalled();
  expect(element.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(element.querySelector("textarea"));
  expect(element.textContent).toContain("1–500 distinct valid domains");
});

it("never approves an expired observed preview", async () => {
  const native = ports({ ...preview(), expiresAt: "2026-11-19T00:00:20Z" }); await mount(native); await openHistory();
  expect(button("Approve removal of 1 listings").disabled).toBe(true);
  await act(async () => button("Approve removal of 1 listings").click()); expect(native.port.approve).not.toHaveBeenCalled();
});

it("continues saved history after reopen without creating or approving a new plan", async () => {
  const native = ports({ ...preview(), state: "completed", approvedAt: createdAt, items: preview().items.map((item) => ({ ...item, state: "succeeded" })) });
  await mount(native, true); await openHistory(); expect(element.textContent).toContain("Absence confirmed");
  expect(native.port.preview).not.toHaveBeenCalled(); expect(native.port.approve).not.toHaveBeenCalled();
});

it("reads persisted history after a lost preview reply without creating a second plan", async () => {
  const native = ports();
  vi.mocked(native.port.preview).mockImplementation(async () => {
    native.setSaved(preview()); throw new Error("closed failure");
  });
  await mount(native); await chooseConnection(); await input("example.com"); await submit();
  expect(native.port.preview).toHaveBeenCalledTimes(1);
  expect(native.port.approve).not.toHaveBeenCalled();
  expect(element.textContent).toContain("outcome is unconfirmed");
  await openHistory();
  expect(element.textContent).toContain("$100.00");
  expect(native.port.preview).toHaveBeenCalledTimes(1);
});

it("dispatches approval once when clicks arrive before the pending render", async () => {
  const native = ports(preview());
  let finish!: (plan: AfternicDelistPlan) => void;
  vi.mocked(native.port.approve).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount(native); await openHistory();
  await act(async () => {
    const approve = button("Approve removal of 1 listings");
    approve.click(); approve.click();
  });
  expect(native.port.approve).toHaveBeenCalledTimes(1);
  expect(button("Approve removal of 1 listings").disabled).toBe(true);
  const executing: AfternicDelistPlan = { ...preview(), approvedAt: createdAt, state: "executing",
    items: preview().items.map((item) => ({ ...item, state: "queued" })) };
  native.setSaved(executing);
  await act(async () => finish(executing));
  expect(native.port.approve).toHaveBeenCalledTimes(1);
});

it("keeps write controls absent when a preview reply arrives after demotion", async () => {
  const native = ports();
  let finish!: (plan: AfternicDelistPlan) => void;
  vi.mocked(native.port.preview).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount(native); await chooseConnection(); await input("example.com"); await submit();
  await mount(native, true);
  native.setSaved(preview());
  await act(async () => finish(preview()));
  expect(element.querySelector("form")).toBeNull();
  expect(element.textContent).toContain("example.com");
  expect([...element.querySelectorAll("button")].some((entry) => entry.textContent?.startsWith("Approve removal"))).toBe(false);
  expect(native.port.approve).not.toHaveBeenCalled();
});

it("drops an old workspace reply after its native port is replaced", async () => {
  const old = ports();
  let finish!: (plan: AfternicDelistPlan) => void;
  vi.mocked(old.port.preview).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount(old); await chooseConnection(); await input("example.com"); await submit();
  const current = ports(); await mount(current);
  await act(async () => finish(preview()));
  expect(element.textContent).not.toContain("$100.00");
  expect(element.querySelector("textarea")?.disabled).toBe(false);
  expect(current.port.preview).not.toHaveBeenCalled();
  expect(current.port.approve).not.toHaveBeenCalled();
});

it.each(["new-preview", "other-history"] as const)("hides old approval while a %s selection read is delayed", async (selection) => {
  const native = ports(preview());
  const secondId = "aa000000-0000-4000-8000-000000000002";
  const original = vi.mocked(native.port.status).getMockImplementation()!;
  const second = { ...preview(), planRef: secondId, connectionLabel: "Other batch" };
  vi.mocked(native.port.status).mockImplementation(async (request) => {
    const value = await original(request);
    return { ...value, detail: request.planRef === secondId ? second : value.detail,
      plans: [{ ...value.plans[0]!, planRef: secondId, connectionLabel: second.connectionLabel }, ...value.plans] };
  });
  await mount(native); await openHistory();
  expect(element.textContent).toContain("$100.00");
  let finish!: (value: Awaited<ReturnType<AfternicDelistPort["status"]>>) => void;
  vi.mocked(native.port.status).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => {
    if (selection === "new-preview") button("Create a removal preview").click();
    else element.querySelectorAll<HTMLButtonElement>(".afternic-delist-history button")[1]!.click();
  });
  expect(element.textContent).not.toContain("$100.00");
  expect([...element.querySelectorAll("button")].some((entry) => entry.textContent?.startsWith("Approve removal"))).toBe(false);
  expect(native.port.approve).not.toHaveBeenCalled();
  await act(async () => finish({ schemaVersion: 1, writeQualified: true, writeEntitled: true, executionAvailable: true, plans: [], detail: null }));
});
