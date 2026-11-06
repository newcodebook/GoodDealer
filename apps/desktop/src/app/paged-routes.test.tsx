// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  localHistoryDay,
  parseDnsHealthRead,
  parseHistoryRead,
  parseRenewalsRead,
  parseSalesRead,
  type AssetLibraryViewModel,
  type SyncSnapshotViewModel,
} from "@gooddealer/client-core";

import { adjudicateDesktopPresentation } from "./desktop-presentation";
import type { HostWindowRequest } from "./host-route-read";
import type { AuthoritativeWorkspacePorts, AuthoritativeWorkspacePublication } from "./workspace-publication";
import { WorkspaceView } from "./workspace-view";

// The paged routes keep their page in React state and read through effects, so these tests render
// the real workspace in a DOM and drive it the way a person does: open a route, click page 2.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const generation = 4;
const freshness = { source: "active_local", readOnlyReason: null, serverRevision: 8, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true } as const;
const portfolio: AssetLibraryViewModel = {
  schemaVersion: 3, kind: "asset_library", readGeneration: generation, freshness,
  totalRows: 1, totalValue: null, expiringWithin60Days: 120, conflictCount: 0, listingCount: 0,
  window: { startIndex: 0, size: 25, rows: [{
    id: "vault.io", domain: "vault.io", tags: [], registrar: null, lifecycleStatus: "active", syncStatus: "clean",
    targetPrice: null, expiresOn: "2026-09-01", expiring: false, assetVersion: 1,
  }] },
};
const sync: SyncSnapshotViewModel = {
  schemaVersion: 1, source: "active_local", readGeneration: generation, transport: "reachable", blockedReason: null,
  activity: "idle", pendingMutationCount: 0, openConflictCount: 0, rejectedMutationCount: 0, recoveryRequired: false,
  appliedThroughServerRevision: 8, lastReplicationActivityAt: null, transportObservedAt: "2026-09-20T00:00:00Z",
};
const publication: AuthoritativeWorkspacePublication = {
  status: { schemaVersion: 2, state: "active", capabilities: ["local:read"], readGeneration: generation } as AuthoritativeWorkspacePublication["status"],
  portfolio,
  conflicts: { schemaVersion: 1, kind: "conflict_center", readGeneration: generation, candidateSetVersion: 8, freshness: { source: "active_local", serverRevision: 8, observedAt: "2026-09-20T00:00:00Z" }, conflicts: [] },
  sync,
};

const total = 120;
const domain = (index: number) => `page-${String(index).padStart(3, "0")}.io`;
const rows = <T,>(request: HostWindowRequest, row: (index: number) => T): T[] =>
  Array.from({ length: Math.max(0, Math.min(request.size, total - request.startIndex)) }, (_, offset) => row(request.startIndex + offset));

// Each stub answers through the real read parser, so a stub that drifts from the wire shape fails.
function hostPorts() {
  const loadRenewals = vi.fn(async (request: HostWindowRequest) => parseRenewalsRead({
    schemaVersion: 1, kind: "renewals", readGeneration: generation, freshness, asOfDate: "2026-08-20",
    totalRows: total, autoRenewEnabledCount: 0, autoRenewDisabledCount: 0,
    window: { ...request, rows: rows(request, (index) => ({ entityId: domain(index), expiresOn: "2026-09-01", autoRenew: null, registrarName: null })) },
  }));
  const loadDnsHealth = vi.fn(async (request: HostWindowRequest & { readonly query: string }) => parseDnsHealthRead({
    schemaVersion: 1, kind: "dns_health", readGeneration: generation, freshness,
    totalRows: total, assetCount: total, observedCount: 0, warningCount: 0,
    window: { startIndex: request.startIndex, size: request.size, rows: rows(request, (index) => ({ entityId: domain(index), zoneBinding: null, observation: null })) },
  }));
  const loadSales = vi.fn(async (request: HostWindowRequest) => parseSalesRead({
    schemaVersion: 1, kind: "sales", readGeneration: generation, freshness,
    totalRows: total, activeListingCount: 0, listedValue: null,
    window: { ...request, rows: rows(request, (index) => ({ entityId: domain(index), marketplaces: ["atom"], listingStatus: "draft", askingPrice: null })) },
  }));
  // The Host counts both revisions as today's, although neither row's date is the test's today.
  const loadHistory = vi.fn(async (request: HostWindowRequest) => parseHistoryRead({
    schemaVersion: 1, kind: "history", readGeneration: generation, freshness,
    totalRows: 2, pendingRows: 0, changesToday: 2,
    window: { startIndex: request.startIndex, size: request.size, rows: request.startIndex > 0 ? [] : [
      { localRevision: 2, entityId: "vault.io", operation: "delete", committedAt: "2026-09-20T00:00:00Z", state: "pending", serverRevision: null, changes: [] },
      { localRevision: 1, entityId: "page-000.io", operation: "delete", committedAt: "2026-09-19T00:00:00Z", state: "pending", serverRevision: null, changes: [] },
    ] },
  }));
  const ports = { renewals: { loadRenewals }, dns: { loadDnsHealth }, sales: { loadSales }, history: { loadHistory } } as unknown as AuthoritativeWorkspacePorts;
  return { ports, loadRenewals, loadDnsHealth, loadSales, loadHistory };
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(ports: AuthoritativeWorkspacePorts) {
  const presentation = adjudicateDesktopPresentation(false, publication, "authenticated");
  if (presentation.view !== "workspace") throw new Error("expected a workspace");
  await act(async () => {
    root.render(
      <WorkspaceView
        locale="en-US"
        presentation={presentation}
        ports={ports}
        windowFrame={{ platform: "linux", framed: false }}
        onPublication={vi.fn()}
        onRefresh={vi.fn()}
        onLocaleChange={vi.fn()}
      />,
    );
  });
}

/** Clicks the first button whose accessible text or label matches, then lets reads settle. */
async function click(match: (button: HTMLButtonElement) => boolean) {
  const button = [...container.querySelectorAll("button")].find(match);
  if (button === undefined) throw new Error("button not found");
  await act(async () => { button.click(); });
}

const named = (name: string) => (button: HTMLButtonElement) =>
  button.textContent?.trim() === name || button.getAttribute("aria-label") === name;

describe("paged Host routes", () => {
  it.each([
    ["Sales", "loadSales"],
    ["DNS & verification", "loadDnsHealth"],
  ] as const)("reads the next Host page when %s moves to page 2", async (label, loader) => {
    const host = hostPorts();
    await render(host.ports);
    await click(named(label));
    expect(host[loader].mock.calls.map(([request]) => [request.startIndex, request.size])).toEqual([[0, 50]]);
    expect(container.textContent).toContain(domain(0));

    await click(named("2"));
    expect(host[loader].mock.calls.map(([request]) => [request.startIndex, request.size])).toEqual([[0, 50], [50, 50]]);
    expect(container.textContent).toContain(domain(50));
    expect(container.textContent).not.toContain(domain(0));
  });

  it("reads the next renewal page after entering from the asset library", async () => {
    const host = hostPorts();
    await render(host.ports);
    await click((button) => button.getAttribute("aria-label")?.startsWith("Expiring within 60 days") === true);
    expect(host.loadRenewals.mock.calls.map(([request]) => request.startIndex)).toEqual([0]);
    await click(named("3"));
    expect(host.loadRenewals.mock.calls.map(([request]) => [request.startIndex, request.size])).toEqual([[0, 50], [100, 50]]);
    expect(container.textContent).toContain(domain(100));
  });

  it("reads again from the same page when the person retries a failed read", async () => {
    const host = hostPorts();
    const succeed = host.loadSales.getMockImplementation()!;
    host.loadSales.mockImplementationOnce(async () => { throw new Error("transport"); });
    await render(host.ports);
    await click(named("Sales"));
    expect(container.textContent).toContain("Local sales data could not be read");

    // The retry attempt restarts the read; nothing is cached from the failed one.
    host.loadSales.mockImplementation(succeed);
    await click(named("Read again"));
    expect(host.loadSales.mock.calls.map(([request]) => request.startIndex)).toEqual([0, 0]);
    expect(container.textContent).toContain(domain(0));
  });

  const openSales = () => click(named("Sales"));
  const openRenewals = () => click((button) => button.getAttribute("aria-label")?.startsWith("Expiring within 60 days") === true);

  it.each([
    ["sales", "loadSales", openSales],
    ["renewals", "loadRenewals", openRenewals],
  ] as const)("reports a failed %s page above the last page and retries the same page", async (desk, loader, open) => {
    const host = hostPorts();
    const succeed = host[loader].getMockImplementation()! as (request: HostWindowRequest) => Promise<unknown>;
    host[loader].mockImplementation((async (request: HostWindowRequest) => {
      if (request.startIndex > 0) throw new Error("transport");
      return succeed(request);
    }) as never);
    await render(host.ports);
    await open();
    await click(named("2"));
    // The failed page 2 stays the page: the last page sits under the failure, no longer busy, with
    // its pager, instead of the route quietly returning to page 1.
    expect(host[loader].mock.calls.map(([request]) => request.startIndex)).toEqual([0, 50]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("from the last successful read");
    expect(container.textContent).toContain(domain(0));
    expect(container.querySelector(`.${desk === "sales" ? "sales-desk" : "renewal-desk"}`)?.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelector(".gd-pager-busy")).toBeNull();

    // Picking the failed page again is a retry, not a dead control that sets the page it already is.
    await click(named("2"));
    expect(host[loader].mock.calls.map(([request]) => request.startIndex)).toEqual([0, 50, 50]);

    host[loader].mockImplementation(succeed as never);
    await click(named("Read again"));
    expect(host[loader].mock.calls.map(([request]) => request.startIndex)).toEqual([0, 50, 50, 50]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain(domain(50));
  });

  it("reports a failed DNS search above the last result and keeps the search box", async () => {
    const host = hostPorts();
    const answer = host.loadDnsHealth.getMockImplementation()!;
    await render(host.ports);
    await click(named("DNS & verification"));
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search domain / provider"]');
    if (search === null) throw new Error("search box not found");
    search.focus();
    host.loadDnsHealth.mockImplementation(async () => { throw new Error("transport"); });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "pa");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The failure sits above the last result; the same box stays mounted, focused and typed into.
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be read");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("from the last successful read");
    expect(search.isConnected).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe("pa");
    expect(container.textContent).toContain(domain(0));

    // The failed search asked for page 1, so picking page 1 again retries that search.
    const reads = host.loadDnsHealth.mock.calls.length;
    await click(named("1"));
    expect(host.loadDnsHealth.mock.calls.length).toBe(reads + 1);
    expect(host.loadDnsHealth.mock.calls.at(-1)?.[0]).toMatchObject({ startIndex: 0, query: "pa" });

    host.loadDnsHealth.mockImplementation(answer);
    await click(named("Read again"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(host.loadDnsHealth.mock.calls.at(-1)?.[0].query).toBe("pa");
  });

  it("asks the Host for today's changes in the person's local day and shows its count", async () => {
    const host = hostPorts();
    await render(host.ports);
    const day = localHistoryDay(new Date());
    await click(named("Operation history"));
    expect(host.loadHistory.mock.calls[0]?.[0]).toMatchObject({ startIndex: 0, ...day });
    const metric = [...container.querySelectorAll(".gd-metric, [class*=metric]")].find((node) => node.textContent?.includes("Changes today"));
    expect(metric?.textContent).toContain("2");
  });

  it("reads today's changes again with the next local day when the day ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      vi.setSystemTime(new Date(2026, 10, 6, 23, 59, 50));
      const host = hostPorts();
      await render(host.ports);
      await click(named("Operation history"));
      const before = host.loadHistory.mock.calls.length;
      const yesterday = localHistoryDay(new Date(2026, 10, 6, 12));
      expect(host.loadHistory.mock.calls.at(-1)?.[0]).toMatchObject(yesterday);

      // Nothing is re-read before the day ends.
      await act(async () => { vi.advanceTimersByTime(5_000); });
      expect(host.loadHistory.mock.calls.length).toBe(before);

      await act(async () => { vi.advanceTimersByTime(6_000); });
      const next = localHistoryDay(new Date(2026, 10, 7, 12));
      expect(next.todayFrom).toBe(yesterday.todayUntil);
      expect(host.loadHistory.mock.calls.length).toBeGreaterThan(before);
      // Every window of the new read asks for the new day.
      for (const [request] of host.loadHistory.mock.calls.slice(before)) expect(request).toMatchObject(next);
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds an observed Zone through the Host and republishes at the receipt's generation", async () => {
    const next = generation + 1;
    const observed = { providerKind: "cloudflare", observedAt: "2026-09-20T00:00:00Z", availability: "available", evidenceStatus: "confirmed", zoneLabel: "vault.io", zoneStatus: "active", authoritativeNameservers: ["ada.ns.cloudflare.com"], dnssecStatus: "unknown", recordCounts: { a: 1, aaaa: 0, cname: 0, txt: 0, other: 0 } };
    const loadDnsHealth = vi.fn(async () => parseDnsHealthRead({
      schemaVersion: 1, kind: "dns_health", readGeneration: generation, freshness,
      totalRows: 1, assetCount: 1, observedCount: 1, warningCount: 0,
      window: { startIndex: 0, size: 50, rows: [{ entityId: "vault.io", zoneBinding: null, observation: observed }] },
    }));
    const bindDomainAssetProvider = vi.fn(async () => ({ readGeneration: next }));
    const status = (readGeneration: number) => ({ schemaVersion: 2, state: "active", capabilities: ["local:read", "workspace:mutate"], readGeneration });
    const ports = {
      dns: { loadDnsHealth },
      business: { status: vi.fn(async () => status(next)), bindDomainAssetProvider },
      portfolio: { loadAssetLibrary: vi.fn(async () => ({ ...portfolio, readGeneration: next })) },
      conflicts: { conflictCenter: vi.fn(async () => ({ ...publication.conflicts!, readGeneration: next })) },
      sync: { status: vi.fn(async () => ({ ...sync, readGeneration: next })) },
    } as unknown as AuthoritativeWorkspacePorts;
    const writable = { ...publication, status: status(generation) } as AuthoritativeWorkspacePublication;
    const presentation = adjudicateDesktopPresentation(false, writable, "authenticated");
    if (presentation.view !== "workspace") throw new Error("expected a workspace");
    const onPublication = vi.fn();
    await act(async () => {
      root.render(
        <WorkspaceView locale="en-US" presentation={presentation} ports={ports} windowFrame={{ platform: "linux", framed: false }}
          onPublication={onPublication} onRefresh={vi.fn()} onLocaleChange={vi.fn()} />,
      );
    });
    await click(named("DNS & verification"));
    await click(named("Bind Zone"));
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    expect(bindDomainAssetProvider).toHaveBeenCalledWith({ schemaVersion: 1, expectedReadGeneration: generation, entityId: "vault.io" });
    expect(onPublication).toHaveBeenCalledOnce();
    expect(onPublication.mock.calls[0]?.[0].status.readGeneration).toBe(next);
  });

  it("sends the DNS search to the Host and keeps the search box focused while it reads", async () => {
    const host = hostPorts();
    const answer = host.loadDnsHealth.getMockImplementation()!;
    await render(host.ports);
    await click(named("DNS & verification"));
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search domain / provider"]');
    if (search === null) throw new Error("search box not found");
    search.focus();
    // Hold the search read open, so the route is observed while the Host has not answered yet.
    let release: () => void = () => undefined;
    host.loadDnsHealth.mockImplementation((request) => new Promise((resolve) => { release = () => resolve(answer(request)); }));
    await act(async () => {
      // React listens for the native input event and reads the value through the prototype setter.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "pa");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.loadDnsHealth.mock.calls.map(([request]) => request.query)).toEqual(["", "pa"]);
    // While the read is in flight the same box stays mounted and focused, with the last page busy.
    expect(search.isConnected).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(container.querySelector(".dns-verification")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => { release(); });
    expect(container.querySelector(".dns-verification")?.hasAttribute("aria-busy")).toBe(false);
    expect(document.activeElement).toBe(search);
  });
});
