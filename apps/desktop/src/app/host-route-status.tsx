import { Banner, Button } from "@gooddealer/ui";

import type { HostRouteReadState } from "./host-route-read";

export interface HostRouteStatusCopy {
  readonly loading: string;
  readonly loadFailed: string;
  readonly retryRead: string;
}

/** Loading and failure presentation shared by the windowed Host routes; retry restarts the read. */
export function HostRouteStatus({ state, copy, onRetry }: {
  readonly state: HostRouteReadState<unknown>;
  readonly copy: HostRouteStatusCopy;
  readonly onRetry: () => void;
}) {
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      <Button size="sm" onClick={onRetry}>{copy.retryRead}</Button>
    </Banner>
  );
}
