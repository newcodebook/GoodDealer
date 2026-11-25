// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AfternicConnectionPort, AfternicListingPlan, AfternicListingPlanPort, AfternicListingWritePlan, AfternicListingWritePort, AfternicListingWritePreviewRequest } from "@gooddealer/client-core";
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
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
function ports(initial: AfternicListingWritePlan | null = null) {
  let saved = initial; let available = true;
  const port: AfternicListingWritePort = {
    preview: vi.fn(async request => { saved = preview(request); return saved; }),
    approve: vi.fn(async () => { saved = queued(saved ?? undefined); return saved; }),
    status: vi.fn<AfternicListingWritePort["status"]>(async ({ planRef }) => ({ schemaVersion: 1, controlledAcceptance: null, writeQualified: true, writeEntitled: true, executionAvailable: available,
      plans: saved === null ? [] : [{ planRef: saved.planRef, action: saved.action, connectionLabel: saved.connectionLabel, createdAt, state: saved.state, total: saved.items.length,
        applied: saved.items.filter(item => item.state === "applied").length, conflicts: saved.items.filter(item => item.state === "conflict").length,
        pending: saved.items.filter(item => !["applied", "conflict"].includes(item.state)).length,
        pendingProvider: saved.items.filter(item => item.state === "pending_provider").length, pendingVerification: saved.items.filter(item => item.state === "pending_verification").length }],
      detail: planRef === null ? null : saved })),
  };
  const connections: AfternicConnectionPort = {
    status: vi.fn<AfternicConnectionPort["status"]>(async () => ({ schemaVersion: 1, controlledAcceptance: null, observeQualified: true, observeEntitled: true, capturable: true,
      laneState: "ready", lastOperation: null, connections: [{ connectionId: id, displayLabel: "My market", state: "active", purgePending: false, lastScan: null }] })),
    connect: vi.fn(), refresh: vi.fn(), revoke: vi.fn(),
  };
  return { port, connections, setSaved(value: AfternicListingWritePlan) { saved = value; }, setAvailable(value: boolean) { available = value; } };
}
async function mount(native: ReturnType<typeof ports>, readOnly = false, planPort?: AfternicListingPlanPort) {
  await act(async () => root.render(<AfternicListingWritePanel locale="en-US" port={native.port} {...(planPort ? { planPort } : {})}
    connectionsPort={native.connections} readOnly={readOnly} onChanged={vi.fn()} />));
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

function reviewPorts(available = true) {
  const native = ports();
  const { items: [sample], ...base } = preview();
  const { domain: _domain, ...listingWrite } = sample!;
  const draft = { state: "preview", latest: null, reason: null, claimedAt: null, retryAt: null, retryNotBefore: null } as const;
  let saved: AfternicListingPlan | null = null;
  const planPort: AfternicListingPlanPort = {
    preview: vi.fn<AfternicListingPlanPort["preview"]>(async request => {
      const items: AfternicListingPlan["items"] = request.action === "reactivate_ownership_review"
        ? request.items.map(({ domain }) => ({ domain, listingWrite: null, ownershipReview: draft }))
        : request.items.map(item => ({ domain: item.domain, listingWrite: {
          ...listingWrite, changes: "values" in item ? item.values : item.patch,
        }, ownershipReview: item.ownershipReview ? draft : null }));
      saved = { ...base, schemaVersion: 2, action: request.action, items: items.sort((a, b) => a.domain.localeCompare(b.domain)) };
      return saved;
    }),
    approve: vi.fn(async () => {
      if (saved === null) throw new Error("missing preview");
      saved = { ...saved, state: "executing", approvedAt: createdAt, items: saved.items.map(item => ({
        ...item, listingWrite: item.listingWrite === null ? null : { ...item.listingWrite, state: "queued" },
        ownershipReview: item.ownershipReview === null ? null : { ...item.ownershipReview, state: item.listingWrite === null ? "queued" : "waiting_parent" },
      })) };
      return saved;
    }),
    status: vi.fn<AfternicListingPlanPort["status"]>(async ({ planRef }) => ({ schemaVersion: 2, controlledAcceptance: null,
      writeQualified: true, writeEntitled: true, executionAvailable: true, ownershipReviewQualified: true,
      ownershipReviewExecutionAvailable: available, plans: [], detail: planRef === null ? null : saved })),
  };
  return { native, planPort };
}

it("freezes the optional review per domain and approves the mixed batch once", async () => {
  const { native, planPort } = reviewPorts();
  await mount(native, false, planPort); await prepare("wecin.com\nexample.com");
  const choice = element.querySelector<HTMLInputElement>('[name="0-ownership-review"]')!;
  expect(choice.checked).toBe(false);
  expect(choice.labels?.[0]?.textContent).toContain("wecin.com");
  await check("0-ownership-review"); await submit();
  expect(planPort.preview).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 2, connectionId: id, action: "create", items: [
    { domain: "wecin.com", values, ownershipReview: { mode: "reactivate_once_if_review" } },
    { domain: "example.com", values, ownershipReview: null },
  ] });
  expect(native.port.preview).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Ownership rechecks in this batch (1)");
  await act(async () => { button("Confirm batch (2 selected)").click(); button("Confirm batch (2 selected)").click(); });
  expect(planPort.approve).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 2, planRef: id, planHash: "a".repeat(64) });
  expect(element.textContent).toContain("Waiting for listing changes to be confirmed");
  expect(native.port.approve).not.toHaveBeenCalled();
});

it("previews a standalone review without price controls and disables approval when the Host cannot run it", async () => {
  const { native, planPort } = reviewPorts(false);
  await mount(native, false, planPort); await prepare("example.com", "reactivate_ownership_review");
  expect(planPort.preview).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 2, connectionId: id,
    action: "reactivate_ownership_review", items: [{ domain: "example.com" }] });
  expect(element.textContent).toContain("One recheck if required");
  expect(element.textContent).not.toContain("Settings to apply");
  expect(button("Confirm batch (1 selected)").disabled).toBe(true);
  expect(planPort.approve).not.toHaveBeenCalled();
});

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

const acceptance = { runId: "afternic-wecin-linux-20261119", domain: "wecin.com", expiresAt: "2026-11-26T23:59:59Z", connectionId: id } as const;
function controlledPorts(initial: AfternicListingWritePlan | null = null) {
  const native = ports(initial);
  const read = vi.mocked(native.port.status).getMockImplementation()!;
  const readConnections = vi.mocked(native.connections.status).getMockImplementation()!;
  let entitled = true;
  let scope: typeof acceptance | null = acceptance;
  vi.mocked(native.port.status).mockImplementation(async request => ({ ...await read(request), writeQualified: false, writeEntitled: entitled, controlledAcceptance: scope }));
  vi.mocked(native.connections.status).mockImplementation(async () => {
    const view = await readConnections();
    return { ...view, observeQualified: false, controlledAcceptance: scope, connections: [...view.connections,
      { ...view.connections[0]!, connectionId: "bb000000-0000-4000-8000-000000000002", displayLabel: "Other market" }] };
  });
  return { ...native, withdraw() { scope = null; }, removeEntitlement() { entitled = false; } };
}
it("uses only the bound connection and wecin.com without upgrading production qualification", async () => {
  const native = controlledPorts(); await mount(native);
  expect(element.textContent).toContain("Production qualification is pending");
  expect(element.querySelector('select[name="connectionId"]')?.textContent).not.toContain("Other market");
  await prepare("example.com");
  expect(element.textContent).toContain("This acceptance run permits only wecin.com");
  expect(element.querySelector('[name="domains"]')?.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(element.querySelector('[name="domains"]'));
  expect(native.port.preview).not.toHaveBeenCalled();
  await setInput("domains", "WECIN.com"); await submit(); await submit();
  expect(native.port.preview).toHaveBeenCalledExactlyOnceWith({ schemaVersion: 1, connectionId: id, action: "create", items: [{ domain: "wecin.com", values }] });
});
it("keeps controlled approval disabled by runtime pause and entitlement removal", async () => {
  const native = controlledPorts(preview()); native.setAvailable(false); await mount(native); await openHistory();
  expect(button("Approve changes for 1 domains").disabled).toBe(true);
  native.setAvailable(true); native.removeEntitlement();
  await act(async () => button("Refresh plan status").click());
  expect(button("Approve changes for 1 domains").disabled).toBe(true); expect(native.port.approve).not.toHaveBeenCalled();
});
it("discards an in-flight controlled preview when Host withdraws the scope", async () => {
  vi.useFakeTimers();
  const native = controlledPorts(); let finish!: (plan: AfternicListingWritePlan) => void;
  vi.mocked(native.port.preview).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(native); await prepare(); await submit();
  native.withdraw(); await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => finish(preview()));
  expect(element.querySelector("form")).toBeNull(); expect(element.querySelector("table")).toBeNull();
  expect(native.port.approve).not.toHaveBeenCalled();
});
