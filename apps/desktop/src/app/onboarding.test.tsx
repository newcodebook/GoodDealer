// @vitest-environment happy-dom
import type { AssetLibraryViewModel, LocalDomainAssetMutationReceipt, SyncSnapshotViewModel } from "@gooddealer/client-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalWriteError, type LocalBusinessStatus } from "../adapters/tauri";
import { Onboarding, onboardingOffer, onboardingView } from "./onboarding";
import type { AuthoritativeWorkspacePorts, AuthoritativeWorkspacePublication } from "./workspace-publication";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lease = { schemaVersion: 1 as const, deviceId: "device-01HZX", leaseEpoch: 3 };
const frame = { platform: "windows" as const, framed: false, onMinimize: vi.fn(), onToggleMaximize: vi.fn(), onClose: vi.fn() };

function status(readGeneration: number, state: LocalBusinessStatus["state"] = "active"): LocalBusinessStatus {
  return {
    schemaVersion: 2,
    state,
    capabilities: state === "active" ? ["local:read", "workspace:mutate"] : ["local:read"],
    readGeneration,
  };
}

function portfolio(readGeneration: number, totalRows: number): AssetLibraryViewModel {
  return {
    schemaVersion: 3,
    kind: "asset_library",
    readGeneration,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 8, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    totalRows,
    totalValue: null,
    expiringWithin60Days: 0,
    conflictCount: 0,
    listingCount: 0,
    window: { startIndex: 0, size: 25, rows: [] },
  };
}

function sync(readGeneration: number, transport: SyncSnapshotViewModel["transport"] = "reachable"): SyncSnapshotViewModel {
  return {
    schemaVersion: 1,
    source: "active_local",
    readGeneration,
    transport,
    blockedReason: null,
    activity: "idle",
    pendingMutationCount: 0,
    openConflictCount: 0,
    rejectedMutationCount: 0,
    recoveryRequired: false,
    appliedThroughServerRevision: 8,
    lastReplicationActivityAt: null,
    transportObservedAt: null,
  };
}

function publication(readGeneration: number, totalRows = 0): AuthoritativeWorkspacePublication {
  return {
    status: status(readGeneration),
    portfolio: portfolio(readGeneration, totalRows),
    conflicts: { schemaVersion: 1, kind: "conflict_center", readGeneration, candidateSetVersion: 0, freshness: { source: "active_local", serverRevision: 8, observedAt: "2026-11-06T00:00:00Z" }, conflicts: [] },
    sync: sync(readGeneration),
  };
}

function receipt(entityId: string, readGeneration: number): LocalDomainAssetMutationReceipt {
  return {
    schemaVersion: 1,
    disposition: "committed",
    operation: "create",
    mutationId: "mutation-create",
    entityId,
    localCommitSequence: 1,
    deviceMutationSequence: 1,
    baseServerRevision: 8,
    activeLeaseEpoch: 3,
    committedAt: "2026-11-06T00:00:00Z",
    readGeneration,
    enqueuedForSync: true,
  } as LocalDomainAssetMutationReceipt;
}

/** A Host with one generation counter: each committed add advances it and adds a row. */
function host() {
  let generation = 1;
  let rows = 0;
  const held = new Set<string>();
  const createDomainAsset = vi.fn(async ({ asset }: { readonly asset: { readonly entityId: string } }) => {
    if (held.has(asset.entityId)) throw new LocalWriteError("DESKTOP_LOCAL_ASSET_EXISTS");
    held.add(asset.entityId);
    generation += 1;
    rows += 1;
    return receipt(asset.entityId, generation);
  });
  const ports = {
    business: { status: vi.fn(async () => status(generation)), createDomainAsset, editDomainAsset: vi.fn(), deleteDomainAsset: vi.fn() },
    portfolio: { loadAssetLibrary: vi.fn(async () => portfolio(generation, rows)), loadDomainDetail: vi.fn() },
    conflicts: { conflictCenter: vi.fn(async () => publication(generation).conflicts!), resolveConflict: vi.fn() },
    sync: { status: vi.fn(async () => sync(generation)) },
    dns: { loadDnsHealth: vi.fn() },
    settings: { loadSettings: vi.fn() },
    sales: { loadSales: vi.fn() },
    renewals: { loadRenewals: vi.fn() },
    batches: { loadBatchOperations: vi.fn() },
    history: { loadHistory: vi.fn() },
    manualTasks: { loadManualTasks: vi.fn() },
  } as unknown as AuthoritativeWorkspacePorts;
  return { ports, createDomainAsset };
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

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (found === undefined) throw new Error(`no button ${label}`);
  return found;
}

async function click(label: string) {
  await act(async () => { button(label).click(); await Promise.resolve(); });
}

function type(text: string) {
  const input = document.body.querySelector("input");
  if (input === null) throw new Error("no input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  for (let index = 0; index < 10; index += 1) await act(async () => { await Promise.resolve(); });
}

describe("first-run onboarding", () => {
  it("is offered only to an Active, writable workspace that holds no domain once sync has settled", () => {
    expect(onboardingOffer(publication(1))).toBe("offer");
    expect(onboardingOffer(publication(1, 4))).toBe("decline");
    expect(onboardingOffer({ ...publication(1), status: status(1, "standby_read_only") })).toBe("decline");
    expect(onboardingOffer({ status: status(1, "security_locked"), portfolio: null, conflicts: null, sync: null })).toBe("decline");
    // A returning person's first pull has not landed yet, so the empty workspace proves nothing.
    expect(onboardingOffer({ ...publication(1), sync: sync(1, "checking") })).toBe("wait");
    expect(onboardingOffer({ ...publication(1), sync: { ...sync(1), activity: "syncing" } })).toBe("wait");
    expect(onboardingOffer({ ...publication(1), sync: sync(1, "offline") })).toBe("decline");
  });

  it("builds every step from Host facts and shows Cloudflare and observation import as unavailable", () => {
    const device = onboardingView("device", lease, publication(1), "zh-CN");
    expect(device).toMatchObject({ step: "device", deviceName: null, activationState: "active", activeLease: { leaseEpoch: 3, deviceId: "device-01HZX" } });
    const connections = onboardingView("connections", lease, publication(1), "zh-CN");
    expect(connections).toMatchObject({ connectedCount: 0, providers: [{ providerId: "cloudflare", connectionState: "unavailable" }] });
    expect(connections?.availableActions).not.toContain("connect_provider");
    expect(onboardingView("initial_import", lease, publication(1), "zh-CN")?.availableActions).not.toContain("start_import");
    expect(onboardingView("complete", lease, publication(5, 2), "zh-CN")).toMatchObject({ importedDomains: 2, baselineServerRevision: 8, syncReady: true });
    const offline = { ...publication(5, 2), sync: sync(5, "offline") };
    expect(onboardingView("complete", lease, offline, "zh-CN")).toMatchObject({ syncReady: false });
    // A lease the Host could not have issued does not form a step, so onboarding is left.
    expect(onboardingView("device", { ...lease, leaseEpoch: 0 }, publication(1), "zh-CN")).toBeNull();
  });

  it("walks to completion, adds a domain through the create path once, and leaves on enter", async () => {
    const { ports, createDomainAsset } = host();
    const onFinish = vi.fn();
    let current = publication(1);
    const onPublication = vi.fn((next: AuthoritativeWorkspacePublication) => { current = next; rerender(); });
    const rerender = () => act(() => root.render(
      <Onboarding locale="zh-CN" windowFrame={frame} lease={lease} publication={current} ports={ports} onPublication={onPublication} onFinish={onFinish} />,
    ));
    rerender();

    await click("开始接入");
    expect(document.body.textContent).toContain("ACTIVE");
    expect(document.body.textContent).toContain("Epoch 3");
    expect(document.body.querySelector("input")).toBeNull();
    await click("继续");
    const cloudflare = [...document.body.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Cloudflare"));
    expect(cloudflare?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Cloudflare 能力取得资格前暂不可连接");
    await click("继续");
    expect(document.body.textContent).toContain("从观察结果导入不可用");

    await click("添加域名");
    type("Example.COM");
    await click("添加");
    await settle();
    expect(createDomainAsset).toHaveBeenCalledOnce();
    expect(createDomainAsset.mock.calls[0]?.[0]).toMatchObject({ expectedReadGeneration: 1, asset: { entityId: "example.com" } });
    expect(document.body.textContent).toContain("本次已添加 1 个域名");
    expect(onPublication).toHaveBeenCalled();
    expect(current.portfolio?.totalRows).toBe(1);

    // The same domain again is refused by the Host and reported, not added twice.
    await click("添加域名");
    type("example.com");
    await click("添加");
    await settle();
    expect(document.body.textContent).toContain("该域名已在工作区中，没有重复添加");
    expect(current.portfolio?.totalRows).toBe(1);
    await click("取消");

    await click("继续");
    expect(document.body.textContent).toContain("共 1 个域名");
    expect(onFinish).not.toHaveBeenCalled();
    await click("进入 GoodDealer");
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("can be skipped from the welcome step without writing anything", async () => {
    const { ports, createDomainAsset } = host();
    const onFinish = vi.fn();
    act(() => root.render(
      <Onboarding locale="zh-CN" windowFrame={frame} lease={lease} publication={publication(1)} ports={ports} onPublication={vi.fn()} onFinish={onFinish} />,
    ));
    await click("跳过接入");
    expect(onFinish).toHaveBeenCalledOnce();
    expect(createDomainAsset).not.toHaveBeenCalled();
  });
});
