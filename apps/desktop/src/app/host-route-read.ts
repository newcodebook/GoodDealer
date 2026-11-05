import { useEffect, useRef, useState } from "react";

/** The fields every windowed Host read shares; the rest belongs to each read's own contract. */
export interface HostReadWindow {
  readonly readGeneration: number;
  readonly totalRows: number;
  readonly window: { readonly rows: readonly unknown[] };
}

export interface HostWindowRequest {
  readonly startIndex: number;
  readonly size: number;
}

export type HostRouteReadState<V> =
  /**
   * `previous` is the last ready value while another page, search or retry of the same port and
   * generation loads, so a route can keep its controls mounted (and focused) instead of flashing
   * the loading page; a new port or generation never carries a value forward.
   */
  | { readonly kind: "loading"; readonly previous?: V }
  | { readonly kind: "ready"; readonly value: V }
  /** `previous` is kept the same way, so a failed page or search can be reported beside the last result. */
  | { readonly kind: "failed"; readonly previous?: V };

export interface HostRouteReadOptions<T extends HostReadWindow, V> {
  readonly load: (request: HostWindowRequest) => Promise<T>;
  /** The generation of the workspace publication the route belongs to. */
  readonly readGeneration: number;
  readonly windowSize: number;
  /** First row to read, for routes that show one page; reads start at the first row otherwise. */
  readonly startIndex?: number;
  /** Stop after this many rows even when the Host has more: a page, or only the newest rows. */
  readonly rowLimit?: number;
  /** Validates the complete windows into the route's value; a throw reports the read as failed. */
  readonly project: (windows: readonly T[]) => V;
  readonly isCancelled: () => boolean;
  readonly onStale: () => void;
}

/**
 * Reads contiguous Host windows for one publication generation and projects them. A window from
 * another generation means the publication is stale: the root must republish instead of stitching
 * mixed reads, so `onStale` runs and no state is returned. A cancelled read also returns no state,
 * and never reports staleness for a route that is gone. Any other failure is reported as `failed`;
 * a retry is simply another call, because nothing is cached between attempts.
 */
export async function readHostRoute<T extends HostReadWindow, V>(
  options: HostRouteReadOptions<T, V>,
): Promise<HostRouteReadState<V> | null> {
  try {
    const windows: T[] = [];
    const start = options.startIndex ?? 0;
    let next = start;
    do {
      const window = await options.load({ startIndex: next, size: options.windowSize });
      if (window.readGeneration !== options.readGeneration) {
        if (!options.isCancelled()) options.onStale();
        return null;
      }
      windows.push(window);
      next += window.window.rows.length;
      if (window.window.rows.length === 0) break;
    } while (next < Math.min(windows[0]?.totalRows ?? 0, start + (options.rowLimit ?? Number.POSITIVE_INFINITY)));
    const value = options.project(windows);
    return options.isCancelled() ? null : { kind: "ready", value };
  } catch {
    return options.isCancelled() ? null : { kind: "failed" };
  }
}

export interface HostPage {
  readonly startIndex: number;
  readonly size: number;
}

/**
 * The page a paged route should move to after a read, or null to stay. A page past the end, after
 * rows left the read, moves back to the last page. The Host rejects a window that starts past its
 * total, so that read fails rather than reporting a total, and the Renderer cannot tell that
 * failure from any other. A failed later page that still shows the last result stays put: the
 * failure is reported over that result, whose pager lets the person retry or pick another page.
 * With nothing to show, only the failure would be on screen, so the route returns to the first
 * page, where a retry can succeed, instead of retrying the same start forever.
 */
export function recoverHostPage(
  page: HostPage,
  outcome:
    | { readonly kind: "loading" }
    | { readonly kind: "failed"; readonly previous?: unknown }
    | { readonly kind: "ready"; readonly totalItems: number },
): HostPage | null {
  if (page.startIndex === 0) return null;
  if (outcome.kind === "failed") return outcome.previous === undefined ? { startIndex: 0, size: page.size } : null;
  if (outcome.kind === "ready" && page.startIndex >= outcome.totalItems) {
    return { startIndex: Math.max(0, Math.floor((outcome.totalItems - 1) / page.size)) * page.size, size: page.size };
  }
  return null;
}

/**
 * The loading state a read starts from. Within the same port and generation it carries the last
 * ready value (or the one an interrupted or failed read already carried), so a page change, a
 * search or a retry does not unmount the route; a new source has nothing to keep.
 */
export function restartHostRouteState<V>(current: HostRouteReadState<V>, sameSource: boolean): HostRouteReadState<V> {
  const previous = !sameSource ? undefined : current.kind === "ready" ? current.value : current.previous;
  return previous === undefined ? { kind: "loading" } : { kind: "loading", previous };
}

/**
 * The state a finished read leaves. A failure keeps the value the read's loading state carried,
 * which `restartHostRouteState` limited to the same port and generation.
 */
export function settleHostRouteState<V>(current: HostRouteReadState<V>, next: HostRouteReadState<V>): HostRouteReadState<V> {
  if (next.kind !== "failed" || current.kind !== "loading" || current.previous === undefined) return next;
  return { kind: "failed", previous: current.previous };
}

/**
 * Route state for one windowed Host read. The read restarts when the port, the generation, the
 * page, the restart key or the retry attempt changes; `load`, `project` and `onStale` are read through refs so callers can pass
 * inline functions without restarting it. A restart within the same port and generation keeps the
 * last ready value as `previous` while it loads.
 */
export function useHostRouteRead<P, T extends HostReadWindow, V>(
  port: P,
  load: (port: P, request: HostWindowRequest) => Promise<T>,
  readGeneration: number,
  onStale: () => void,
  project: (windows: readonly T[]) => V,
  limits: {
    readonly windowSize: number;
    readonly startIndex?: number;
    readonly rowLimit?: number;
    /** Restarts the read when it changes, for inputs `load` reads through its ref, such as a search. */
    readonly restartKey?: string;
  },
): { readonly state: HostRouteReadState<V>; readonly retry: () => void } {
  const [state, setState] = useState<HostRouteReadState<V>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ load, project, onStale });
  const source = useRef<{ readonly port: P; readonly readGeneration: number } | null>(null);
  callbacks.current = { load, project, onStale };
  const { windowSize, startIndex, rowLimit, restartKey } = limits;

  useEffect(() => {
    let cancelled = false;
    const sameSource = source.current?.port === port && source.current.readGeneration === readGeneration;
    source.current = { port, readGeneration };
    setState((current) => restartHostRouteState(current, sameSource));
    void readHostRoute<T, V>({
      load: (request) => callbacks.current.load(port, request),
      readGeneration,
      windowSize,
      ...(startIndex === undefined ? {} : { startIndex }),
      ...(rowLimit === undefined ? {} : { rowLimit }),
      project: (windows) => callbacks.current.project(windows),
      isCancelled: () => cancelled,
      onStale: () => callbacks.current.onStale(),
    }).then((next) => {
      if (next !== null) setState((current) => settleHostRouteState(current, next));
    });
    return () => { cancelled = true; };
    // `restartKey` is a dependency only so that a change restarts the read.
  }, [port, readGeneration, attempt, windowSize, startIndex, rowLimit, restartKey]);

  return { state, retry: () => setAttempt((current) => current + 1) };
}
