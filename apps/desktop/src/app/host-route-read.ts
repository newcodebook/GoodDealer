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
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: V }
  | { readonly kind: "failed" };

export interface HostRouteReadOptions<T extends HostReadWindow, V> {
  readonly load: (request: HostWindowRequest) => Promise<T>;
  /** The generation of the workspace publication the route belongs to. */
  readonly readGeneration: number;
  readonly windowSize: number;
  /** Stop after this many rows even when the Host has more, for views that show only the newest. */
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
    let next = 0;
    do {
      const window = await options.load({ startIndex: next, size: options.windowSize });
      if (window.readGeneration !== options.readGeneration) {
        if (!options.isCancelled()) options.onStale();
        return null;
      }
      windows.push(window);
      next += window.window.rows.length;
      if (window.window.rows.length === 0) break;
    } while (next < Math.min(windows[0]?.totalRows ?? 0, options.rowLimit ?? Number.POSITIVE_INFINITY));
    const value = options.project(windows);
    return options.isCancelled() ? null : { kind: "ready", value };
  } catch {
    return options.isCancelled() ? null : { kind: "failed" };
  }
}

/**
 * Route state for one windowed Host read. The read restarts when the port, the generation or the
 * retry attempt changes; `load`, `project` and `onStale` are read through refs so callers can pass
 * inline functions without restarting it.
 */
export function useHostRouteRead<P, T extends HostReadWindow, V>(
  port: P,
  load: (port: P, request: HostWindowRequest) => Promise<T>,
  readGeneration: number,
  onStale: () => void,
  project: (windows: readonly T[]) => V,
  limits: { readonly windowSize: number; readonly rowLimit?: number },
): { readonly state: HostRouteReadState<V>; readonly retry: () => void } {
  const [state, setState] = useState<HostRouteReadState<V>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ load, project, onStale });
  callbacks.current = { load, project, onStale };
  const { windowSize, rowLimit } = limits;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void readHostRoute<T, V>({
      load: (request) => callbacks.current.load(port, request),
      readGeneration,
      windowSize,
      ...(rowLimit === undefined ? {} : { rowLimit }),
      project: (windows) => callbacks.current.project(windows),
      isCancelled: () => cancelled,
      onStale: () => callbacks.current.onStale(),
    }).then((next) => {
      if (next !== null) setState(next);
    });
    return () => { cancelled = true; };
  }, [port, readGeneration, attempt, windowSize, rowLimit]);

  return { state, retry: () => setAttempt((current) => current + 1) };
}
