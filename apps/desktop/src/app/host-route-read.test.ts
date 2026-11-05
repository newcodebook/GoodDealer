import { describe, expect, it, vi } from "vitest";

import { readHostRoute, recoverHostPage, restartHostRouteState, type HostReadWindow, type HostWindowRequest } from "./host-route-read";

interface FakeWindow extends HostReadWindow {
  readonly window: { readonly startIndex: number; readonly rows: readonly string[] };
}

/** A Host that serves `rows` in windows, reporting `generation(call)` for each successive call. */
function host(rows: readonly string[], generation: (call: number) => number = () => 7) {
  let call = 0;
  const requests: HostWindowRequest[] = [];
  const load = vi.fn(async (request: HostWindowRequest): Promise<FakeWindow> => {
    requests.push(request);
    call += 1;
    return {
      readGeneration: generation(call),
      totalRows: rows.length,
      window: { startIndex: request.startIndex, rows: rows.slice(request.startIndex, request.startIndex + request.size) },
    };
  });
  return { load, requests };
}

const concat = (windows: readonly FakeWindow[]) => windows.flatMap((window) => window.window.rows).join(",");

function options(load: (request: HostWindowRequest) => Promise<FakeWindow>, overrides: Partial<Parameters<typeof readHostRoute<FakeWindow, string>>[0]> = {}) {
  return {
    load,
    readGeneration: 7,
    windowSize: 2,
    project: concat,
    isCancelled: () => false,
    onStale: vi.fn(),
    ...overrides,
  };
}

describe("windowed Host route read", () => {
  it("reads contiguous windows of the route's generation and projects them once", async () => {
    const { load, requests } = host(["a", "b", "c", "d", "e"]);
    const project = vi.fn(concat);
    await expect(readHostRoute(options(load, { project }))).resolves.toEqual({ kind: "ready", value: "a,b,c,d,e" });
    expect(requests.map((request) => request.startIndex)).toEqual([0, 2, 4]);
    expect(project).toHaveBeenCalledTimes(1);
  });

  it("reports a newer generation as stale instead of stitching or failing", async () => {
    const { load } = host(["a", "b", "c"], (call) => (call === 1 ? 7 : 8));
    const onStale = vi.fn();
    const project = vi.fn(concat);
    await expect(readHostRoute(options(load, { onStale, project }))).resolves.toBeNull();
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(project).not.toHaveBeenCalled();
    // An older generation is just as foreign as a newer one.
    const older = host(["a"], () => 6);
    const olderStale = vi.fn();
    await expect(readHostRoute(options(older.load, { onStale: olderStale }))).resolves.toBeNull();
    expect(olderStale).toHaveBeenCalledTimes(1);
  });

  it("stays silent once the route is gone, whether the read went stale, failed or succeeded", async () => {
    const onStale = vi.fn();
    const stale = host(["a"], () => 8);
    await expect(readHostRoute(options(stale.load, { onStale, isCancelled: () => true }))).resolves.toBeNull();
    expect(onStale).not.toHaveBeenCalled();
    const failing = vi.fn(async () => { throw new Error("transport"); });
    await expect(readHostRoute(options(failing, { isCancelled: () => true }))).resolves.toBeNull();
    await expect(readHostRoute(options(host(["a"]).load, { isCancelled: () => true }))).resolves.toBeNull();
  });

  it("reports a failed load or projection, and a retry reads afresh", async () => {
    let fail = true;
    const { load } = host(["a", "b", "c"]);
    const flaky = vi.fn(async (request: HostWindowRequest) => {
      if (fail && request.startIndex === 2) throw new Error("transport");
      return load(request);
    });
    await expect(readHostRoute(options(flaky))).resolves.toEqual({ kind: "failed" });
    fail = false;
    await expect(readHostRoute(options(flaky))).resolves.toEqual({ kind: "ready", value: "a,b,c" });
    // The retry starts again from the first window rather than resuming a partial read.
    expect(flaky.mock.calls.map(([request]) => request.startIndex)).toEqual([0, 2, 0, 2]);

    const rejecting = () => { throw new TypeError("windows must cover every row"); };
    await expect(readHostRoute(options(host(["a"]).load, { project: rejecting }))).resolves.toEqual({ kind: "failed" });
  });

  it("hands a short read to the projection, which rejects incomplete windows", async () => {
    const shrinking = vi.fn(async (request: HostWindowRequest): Promise<FakeWindow> => ({
      readGeneration: 7,
      totalRows: 4,
      window: { startIndex: request.startIndex, rows: request.startIndex === 0 ? ["a", "b"] : [] },
    }));
    const project = (windows: readonly FakeWindow[]) => {
      const rows = windows.flatMap((window) => window.window.rows);
      if (rows.length !== windows[0]!.totalRows) throw new TypeError("windows must cover every row");
      return rows.join(",");
    };
    await expect(readHostRoute(options(shrinking, { project }))).resolves.toEqual({ kind: "failed" });
    expect(shrinking).toHaveBeenCalledTimes(2);
  });

  it("reads one page from its first row up to the page size", async () => {
    const { load, requests } = host(["a", "b", "c", "d", "e"]);
    await expect(readHostRoute(options(load, { startIndex: 2, rowLimit: 2 }))).resolves.toEqual({ kind: "ready", value: "c,d" });
    expect(requests).toEqual([{ startIndex: 2, size: 2 }]);
    // The last page stops at the Host's total rather than asking past it.
    const last = host(["a", "b", "c", "d", "e"]);
    await expect(readHostRoute(options(last.load, { startIndex: 4, rowLimit: 2 }))).resolves.toEqual({ kind: "ready", value: "e" });
    expect(last.requests).toEqual([{ startIndex: 4, size: 2 }]);
  });

  it("stops at the row limit for views that show only the newest rows", async () => {
    const { load, requests } = host(["a", "b", "c", "d", "e"]);
    await expect(readHostRoute(options(load, { rowLimit: 3 }))).resolves.toEqual({ kind: "ready", value: "a,b,c,d" });
    expect(requests.map((request) => request.startIndex)).toEqual([0, 2]);
  });
});

describe("paged Host route recovery", () => {
  const page3 = { startIndex: 100, size: 50 };

  it("returns a later page whose read failed to the first page, where a retry can succeed", () => {
    // The Host rejects a window that starts past a total that shrank, so the read fails.
    expect(recoverHostPage(page3, { kind: "failed" })).toEqual({ startIndex: 0, size: 50 });
    expect(recoverHostPage({ startIndex: 0, size: 50 }, { kind: "failed" })).toBeNull();
  });

  it("moves a page past the end back to the last page, or the first when nothing is left", () => {
    expect(recoverHostPage(page3, { kind: "ready", totalItems: 100 })).toEqual({ startIndex: 50, size: 50 });
    expect(recoverHostPage(page3, { kind: "ready", totalItems: 0 })).toEqual({ startIndex: 0, size: 50 });
    expect(recoverHostPage(page3, { kind: "ready", totalItems: 101 })).toBeNull();
    expect(recoverHostPage(page3, { kind: "loading" })).toBeNull();
  });
});

describe("Host route restart", () => {
  it("keeps the last ready value while another page or search of the same source loads", () => {
    const loading = restartHostRouteState({ kind: "ready", value: "page 1" }, true);
    expect(loading).toEqual({ kind: "loading", previous: "page 1" });
    // A search typed while the previous one is still loading keeps the same value on screen.
    expect(restartHostRouteState(loading, true)).toEqual({ kind: "loading", previous: "page 1" });
  });

  it("never carries a value into a new port or generation, or out of a failure", () => {
    expect(restartHostRouteState({ kind: "ready", value: "page 1" }, false)).toEqual({ kind: "loading" });
    expect(restartHostRouteState({ kind: "loading", previous: "page 1" }, false)).toEqual({ kind: "loading" });
    expect(restartHostRouteState<string>({ kind: "failed" }, true)).toEqual({ kind: "loading" });
  });
});
