import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequired,
  authenticationLocksRuntime,
  createAuthenticationStatusCoordinator,
  createPortfolioReadController,
  presentAssetLibraryRead,
  presentPortfolioReadError,
  createPortfolioReadCoordinator,
  createPortfolioMutationController,
  readLocalBusinessView,
  synchronizeAfterAuthentication,
} from "../app";
import { LocalReadError } from "../adapters/tauri";
import type { AssetLibraryViewModel, DomainDetailViewModel } from "@gooddealer/client-core";
import type { LocalDomainAssetMutationReceipt } from "@gooddealer/client-core";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function emptyLibrary(readGeneration: number, startIndex = 0, size = 25): AssetLibraryViewModel {
  return {
    schemaVersion: 3,
    kind: "asset_library",
    readGeneration,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 0, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    totalRows: 0,
    totalValue: null,
    expiringWithin60Days: 0,
    conflictCount: 0,
    listingCount: 0,
    window: { startIndex, size, rows: [] },
  };
}

function detail(domain: string, readGeneration: number): DomainDetailViewModel {
  return {
    schemaVersion: 3,
    kind: "domain_detail",
    readGeneration,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 0, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    state: "normal",
    asset: { id: domain, domain, tags: [], registrar: null, lifecycleStatus: "active", syncStatus: "clean", targetPrice: null, expiresOn: null, assetVersion: 1, portfolioId: null, acquiredOn: null, acquisitionCost: null, autoRenew: null, registrarLock: null, note: null },
    conflictFields: [],
  };
}

function receipt(operation: "edit" | "delete", entityId: string, readGeneration: number): LocalDomainAssetMutationReceipt {
  return {
    schemaVersion: 1,
    disposition: "committed",
    operation,
    mutationId: `mutation-${operation}`,
    entityId,
    localCommitSequence: 2,
    deviceMutationSequence: 2,
    baseServerRevision: 0,
    activeLeaseEpoch: 7,
    committedAt: "2026-08-29T18:00:00Z",
    readGeneration,
  };
}

describe("Desktop authorization recovery actions", () => {
  it("rejects stale detail and query responses after navigation, lock, or unmount", () => {
    const coordinator = createPortfolioReadCoordinator();
    coordinator.acceptHostGeneration(4);
    const first = coordinator.begin("detail:alpha.test");
    const second = coordinator.begin("detail:beta.test");
    const accepted: string[] = [];
    expect(coordinator.commit(first, "detail:alpha.test", 4, "alpha", (value) => accepted.push(value))).toBe(false);
    expect(coordinator.commit(second, "detail:beta.test", 4, "beta", (value) => accepted.push(value))).toBe(true);
    coordinator.invalidate();
    expect(coordinator.commit(second, "detail:beta.test", 4, "late", (value) => accepted.push(value))).toBe(false);
    coordinator.unmount();
    expect(coordinator.commit(coordinator.begin("list:query-n+1"), "list:query-n+1", 4, "gamma", (value) => accepted.push(value))).toBe(false);
    expect(accepted).toEqual(["beta"]);
  });

  it("accepts only the newest query/window response", async () => {
    const first = deferred<AssetLibraryViewModel>();
    const second = deferred<AssetLibraryViewModel>();
    const port = {
      loadAssetLibrary: vi.fn(async (request: { query: string }) => request.query === "alpha" ? first.promise : second.promise),
      loadDomainDetail: vi.fn(),
    };
    const controller = createPortfolioReadController(port);
    controller.acceptHostGeneration(7);
    const accepted: AssetLibraryViewModel[] = [];

    const firstRun = controller.loadAssetLibrary({ startIndex: 0, size: 25, query: "alpha" }, (value) => accepted.push(value), vi.fn());
    const secondRun = controller.loadAssetLibrary({ startIndex: 25, size: 25, query: "beta" }, (value) => accepted.push(value), vi.fn());
    second.resolve(emptyLibrary(7, 25));
    await secondRun;
    first.resolve(emptyLibrary(7));
    await firstRun;

    expect(accepted).toEqual([emptyLibrary(7, 25)]);
  });

  it("maps a Host-returned zero-row snapshot to the explicit empty presentation state", async () => {
    const snapshot = emptyLibrary(7);
    const controller = createPortfolioReadController({
      loadAssetLibrary: vi.fn(async () => snapshot),
      loadDomainDetail: vi.fn(),
    });
    controller.acceptHostGeneration(7);
    const presentations: unknown[] = [];

    await controller.loadAssetLibrary(
      { startIndex: 0, size: 25, query: "" },
      (value) => presentations.push(presentAssetLibraryRead(value)),
      vi.fn(),
    );

    expect(presentations).toEqual([{ state: "empty" }]);
    expect(presentAssetLibraryRead({ ...emptyLibrary(7), totalRows: 1, window: { startIndex: 0, size: 25, rows: [] } })).toEqual({
      state: "ready",
      data: { ...emptyLibrary(7), totalRows: 1, window: { startIndex: 0, size: 25, rows: [] } },
    });
  });

  it("retains the last valid library only for invalid-query presentation", () => {
    const previous = { ...emptyLibrary(7), totalRows: 1 };
    expect(presentPortfolioReadError(new LocalReadError("LOCAL_QUERY_REJECTED"), previous)).toEqual({
      state: "invalid-query",
      data: previous,
    });
    expect(presentPortfolioReadError(new LocalReadError("LOCAL_WINDOW_REJECTED"), previous)).toEqual({ state: "invalid-window" });
  });

  it("rejects detail A after navigation to detail B", async () => {
    const alpha = deferred<DomainDetailViewModel>();
    const beta = deferred<DomainDetailViewModel>();
    const port = {
      loadAssetLibrary: vi.fn(),
      loadDomainDetail: vi.fn(async (domain: string) => domain === "alpha.test" ? alpha.promise : beta.promise),
    };
    const controller = createPortfolioReadController(port);
    controller.acceptHostGeneration(8);
    const accepted: string[] = [];

    const alphaRun = controller.loadDomainDetail("alpha.test", (value) => accepted.push(value.asset.domain), vi.fn());
    const betaRun = controller.loadDomainDetail("beta.test", (value) => accepted.push(value.asset.domain), vi.fn());
    beta.resolve(detail("beta.test", 8));
    await betaRun;
    alpha.resolve(detail("alpha.test", 8));
    await alphaRun;

    expect(accepted).toEqual(["beta.test"]);
  });

  it("rejects deferred reads after an authorization lock or unmount", async () => {
    const locked = deferred<AssetLibraryViewModel>();
    const unmounted = deferred<AssetLibraryViewModel>();
    const port = { loadAssetLibrary: vi.fn()
      .mockImplementationOnce(async () => locked.promise)
      .mockImplementationOnce(async () => unmounted.promise), loadDomainDetail: vi.fn() };
    const controller = createPortfolioReadController(port);
    controller.acceptHostGeneration(9);
    const accepted = vi.fn();

    const lockedRun = controller.loadAssetLibrary({ startIndex: 0, size: 25, query: "" }, accepted, vi.fn());
    controller.invalidate();
    locked.resolve(emptyLibrary(9));
    await lockedRun;
    const unmountedRun = controller.loadAssetLibrary({ startIndex: 0, size: 25, query: "next" }, accepted, vi.fn());
    controller.unmount();
    unmounted.resolve(emptyLibrary(9));
    await unmountedRun;

    expect(accepted).not.toHaveBeenCalled();
  });

  it("rejects a deferred mutation receipt after an authorization lock", async () => {
    const mutation = deferred<LocalDomainAssetMutationReceipt>();
    const status = vi.fn(async () => ({
      schemaVersion: 2 as const,
      state: "active" as const,
      capabilities: ["local:read", "workspace:mutate"] as const,
      readGeneration: 8,
    }));
    const controller = createPortfolioMutationController({
      status,
      editDomainAsset: vi.fn(),
      deleteDomainAsset: vi.fn(),
    });
    const accept = vi.fn();
    const reject = vi.fn();

    const run = controller.execute("edit:alpha.test", 7, async () => mutation.promise, accept, reject);
    controller.invalidate();
    mutation.resolve(receipt("edit", "alpha.test", 8));
    await run;

    expect(status).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it("fences edit and delete completion across entity changes, routes, and unmount", async () => {
    const edit = deferred<LocalDomainAssetMutationReceipt>();
    const deletion = deferred<LocalDomainAssetMutationReceipt>();
    const status = vi.fn(async () => ({
      schemaVersion: 2 as const,
      state: "active" as const,
      capabilities: ["local:read", "workspace:mutate"] as const,
      readGeneration: 8,
    }));
    const controller = createPortfolioMutationController({
      status,
      editDomainAsset: vi.fn(),
      deleteDomainAsset: vi.fn(),
    });
    const accept = vi.fn();

    const editRun = controller.execute("edit:alpha.test", 7, async () => edit.promise, accept, vi.fn());
    const deleteRun = controller.execute("delete:beta.test", 7, async () => deletion.promise, accept, vi.fn());
    edit.resolve(receipt("edit", "alpha.test", 8));
    await editRun;
    controller.unmount();
    deletion.resolve(receipt("delete", "beta.test", 8));
    await deleteRun;

    expect(status).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it("requires a fresh matching Active Host status before accepting a mutation", async () => {
    const status = vi.fn(async () => ({
      schemaVersion: 2 as const,
      state: "security_locked" as const,
      capabilities: [] as const,
      readGeneration: 8,
    }));
    const controller = createPortfolioMutationController({
      status,
      editDomainAsset: vi.fn(),
      deleteDomainAsset: vi.fn(),
    });
    const accept = vi.fn();

    await controller.execute(
      "delete:alpha.test",
      7,
      async () => receipt("delete", "alpha.test", 8),
      accept,
      vi.fn(),
    );

    expect(status).toHaveBeenCalledOnce();
    expect(accept).not.toHaveBeenCalled();
  });
  it("requires a new sign-in when the authorization-code Grant never committed refresh custody", () => {
    const html = renderToStaticMarkup(<AuthenticationRequired status="authorization_failed" />);

    expect(html).toContain("Sign in again");
    expect(html).not.toContain("Retry authorization");
  });

  it("offers refresh retry only after Native retained a rotated refresh credential", () => {
    const html = renderToStaticMarkup(<AuthenticationRequired status="authorization_retryable" />);

    expect(html).toContain("Retry authorization");
    expect(html).toContain("Sign in again");
  });

  it("reloads the activated local workspace after Native reports authenticated", async () => {
    const synchronize = vi.fn(async () => undefined);

    await synchronizeAfterAuthentication("authenticated", synchronize);

    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("reloads locked local business state for retryable authorization changes", async () => {
    const synchronize = vi.fn(async () => undefined);

    await synchronizeAfterAuthentication("authorization_retryable", synchronize);

    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("classifies both Native lock events for immediate Portfolio eviction", () => {
    expect(authenticationLocksRuntime("authorization_failed")).toBe(true);
    expect(authenticationLocksRuntime("authorization_retryable")).toBe(true);
    expect(authenticationLocksRuntime("authenticated")).toBe(false);
  });

  it("discards an older authentication snapshot after a newer event arrives", async () => {
    const accepted: string[] = [];
    const statuses = createAuthenticationStatusCoordinator(async (status) => {
      accepted.push(status);
    });
    const acceptSnapshot = statuses.beginSnapshot();

    await statuses.acceptEvent("authenticated");
    await acceptSnapshot("pending");

    expect(accepted).toEqual(["authenticated"]);
  });

  it("accepts the subscribed authentication snapshot when no event supersedes it", async () => {
    const accepted: string[] = [];
    const statuses = createAuthenticationStatusCoordinator(async (status) => {
      accepted.push(status);
    });
    const acceptSnapshot = statuses.beginSnapshot();

    await acceptSnapshot("signed_out");

    expect(accepted).toEqual(["signed_out"]);
  });

  it("reads Portfolio only after the refreshed business status grants local read", async () => {
    const status = {
      schemaVersion: 2 as const,
      state: "active" as const,
      capabilities: ["local:read", "workspace:mutate"] as const,
      readGeneration: 1,
    };
    const portfolio = { schemaVersion: 3, kind: "asset_library", readGeneration: 1,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 0, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 0, totalValue: null, expiringWithin60Days: 0, conflictCount: 0, listingCount: 0,
      window: { startIndex: 0, size: 25, rows: [] } } as const;
    const port = {
      status: vi.fn(async () => status),
      editDomainAsset: vi.fn(), deleteDomainAsset: vi.fn(),
    };
    const reads = { loadAssetLibrary: vi.fn(async () => portfolio), loadDomainDetail: vi.fn() };

    await expect(readLocalBusinessView(port, reads)).resolves.toEqual({
      status,
      portfolio,
    });
    expect(reads.loadAssetLibrary).toHaveBeenCalledOnce();
  });

  it("does not read Portfolio while the refreshed business state remains locked", async () => {
    const status = {
      schemaVersion: 2 as const,
      state: "security_locked" as const,
      capabilities: [] as const,
      readGeneration: 2,
    };
    const port = {
      status: vi.fn(async () => status),
      editDomainAsset: vi.fn(), deleteDomainAsset: vi.fn(),
    };

    await expect(readLocalBusinessView(port)).resolves.toEqual({ status, portfolio: null });
  });
});
