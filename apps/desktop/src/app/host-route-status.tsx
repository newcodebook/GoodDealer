import { Banner, Button } from "@gooddealer/ui";

import type { HostRouteReadState } from "./host-route-read";

export interface HostRouteStatusCopy {
  readonly loading: string;
  readonly loadFailed: string;
  readonly retryRead: string;
}

/**
 * Loading and failure presentation shared by the windowed Host routes; retry restarts the read.
 * `staleNote` is for a route that keeps showing its last result under the failure, whose rows and
 * counts no longer match the page or search the person asked for.
 */
export function HostRouteStatus({ state, copy, onRetry, staleNote }: {
  readonly state: HostRouteReadState<unknown>;
  readonly copy: HostRouteStatusCopy;
  readonly onRetry: () => void;
  readonly staleNote?: string;
}) {
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      {staleNote === undefined ? null : <>{staleNote} </>}
      <Button size="sm" onClick={onRetry}>{copy.retryRead}</Button>
    </Banner>
  );
}
