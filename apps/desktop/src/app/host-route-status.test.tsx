import { Button } from "@gooddealer/ui";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HostRouteStatus } from "./host-route-status";

const copy = { loading: "Loading reads", loadFailed: "Read failed", retryRead: "Retry read" };

/** Finds the first element of `type` in a rendered element tree without a DOM. */
function find(node: ReactNode, type: unknown): ReactElement<{ readonly onClick?: () => void }> | null {
  if (!isValidElement<{ readonly children?: ReactNode }>(node)) {
    if (Array.isArray(node)) for (const child of node) { const found = find(child, type); if (found !== null) return found; }
    return null;
  }
  if (node.type === type) return node as ReactElement<{ readonly onClick?: () => void }>;
  return find(node.props.children, type);
}

describe("Host route status", () => {
  it("shows loading without a retry control", () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(<HostRouteStatus state={{ kind: "loading" }} copy={copy} onRetry={onRetry} />);
    expect(html).toContain("Loading reads");
    expect(html).not.toContain("Retry read");
  });

  it("offers a retry on failure that restarts the read exactly once per press", () => {
    const onRetry = vi.fn();
    const element = HostRouteStatus({ state: { kind: "failed" }, copy, onRetry });
    expect(renderToStaticMarkup(element)).toContain("Read failed");
    const button = find(element, Button);
    expect(button?.props.onClick).toBeTypeOf("function");
    button!.props.onClick!();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says the rows under a failure are stale only when the route keeps them", () => {
    const failed = { kind: "failed" } as const;
    expect(renderToStaticMarkup(<HostRouteStatus state={failed} copy={copy} onRetry={vi.fn()} />)).not.toContain("Last rows");
    expect(renderToStaticMarkup(<HostRouteStatus state={failed} copy={copy} onRetry={vi.fn()} staleNote="Last rows" />)).toContain("Last rows");
  });
});
