import { getPresentationCopy } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CloudflareConnectionState } from "./connection-presentation-contract";
import { CloudflareConnectionPresentation } from "./connection-settings";

interface InspectableElement extends ReactElement<Record<string, any>> {}

function elements(node: ReactNode): InspectableElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || node === undefined || typeof node !== "object" || !("props" in node)) return [];
  const element = node as InspectableElement;
  return [element, ...elements(element.props.children as ReactNode)];
}

function isolated(value: string): string {
  return `<bdi dir="auto">${value}</bdi>`;
}

const observed = {
  connectionLabel: "Primary Cloudflare observation",
  zoneName: "example.test",
  observedAt: "2026-08-26T12:30:00Z",
  version: 17,
} as const;

const states: readonly CloudflareConnectionState[] = [
  { state: "loading" },
  { state: "not-configured", manualGuidance: "Ask an administrator to configure read access." },
  { state: "checking", connectionLabel: observed.connectionLabel },
  { state: "available", ...observed, uncertainty: "confirmed" },
  { state: "stale", ...observed },
  { state: "uncertain", ...observed },
  {
    state: "unavailable",
    code: "permission",
    retryAfterSeconds: 60,
    manualGuidance: "Ask an administrator to review read access.",
  },
  { state: "error", code: "invalid-projection", manualGuidance: "Review the local observation." },
];

describe("CloudflareConnectionPresentation", () => {
  it("renders every closed state with explicit fail-closed metadata", () => {
    for (const presentation of states) {
      const html = renderToStaticMarkup(
        <CloudflareConnectionPresentation locale="en-US" presentation={presentation} />,
      );
      expect(html).toContain(`data-state="${presentation.state}"`);
      expect(html).toContain("Cloudflare Zone DNS");
      expect(html).toContain(getPresentationCopy("en-US", "settings").version);
      expect(html).toContain(getPresentationCopy("en-US", "dnsVerification").lastChecked);
      expect(html).toContain("data-availability=");
      expect(html).toContain("data-uncertainty=");
    }
  });

  it("shows observation provenance, time, version, zone, and uncertainty", () => {
    const availableHtml = renderToStaticMarkup(
      <CloudflareConnectionPresentation
        locale="en-US"
        presentation={{ state: "available", ...observed, uncertainty: "confirmed" }}
      />,
    );
    expect(availableHtml).toContain(observed.connectionLabel);
    expect(availableHtml).toContain(observed.zoneName);
    expect(availableHtml).toContain("Aug 26, 2026");
    expect(availableHtml).toContain(">17<");
    expect(availableHtml).toContain('data-uncertainty="confirmed"');

    const unavailableHtml = renderToStaticMarkup(
      <CloudflareConnectionPresentation locale="en-US" presentation={states[6]!} />,
    );
    expect(unavailableHtml).toContain("permission");
    expect(unavailableHtml).toContain("Ask an administrator to review read access.");
  });

  it("exposes only a payload-free retry on retryable read states", () => {
    const onRetryRead = vi.fn();
    const tree = CloudflareConnectionPresentation({
      locale: "en-US",
      presentation: states[7]!,
      onRetryRead,
    }) as InspectableElement;
    const retry = elements(tree).find((element) => element.type === Button);
    expect(retry).toBeDefined();
    retry?.props.onClick();
    expect(onRetryRead).toHaveBeenCalledOnce();
    expect(onRetryRead).toHaveBeenCalledWith();

    const availableHtml = renderToStaticMarkup(
      <CloudflareConnectionPresentation
        locale="en-US"
        presentation={{ state: "available", ...observed, uncertainty: "confirmed" }}
        onRetryRead={onRetryRead}
      />,
    );
    expect(availableHtml).not.toContain("<button");
    expect(availableHtml).not.toContain("<input");
    expect(availableHtml).not.toContain("<a");
  });

  it("isolates U+202E in hostile connection and zone labels without creating markup sinks", () => {
    const hostile = '<img src=x onerror=alert(1)> \u202E https://example.invalid';
    const html = renderToStaticMarkup(
      <CloudflareConnectionPresentation
        locale="en-US"
        presentation={{
          state: "available",
          connectionLabel: hostile,
          zoneName: hostile,
          observedAt: observed.observedAt,
          version: 1,
          uncertainty: "confirmed",
        }}
      />,
    );
    const escapedHostile = "&lt;img src=x onerror=alert(1)&gt; \u202E https://example.invalid";
    expect(html.match(/<bdi dir="auto">/g)).toHaveLength(2);
    expect(html.split(isolated(escapedHostile))).toHaveLength(3);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a");
  });

  it("isolates U+202E in hostile manual guidance", () => {
    const hostileGuidance = "Contact the administrator \u202E moc.elpmaxe//:sptth";
    const html = renderToStaticMarkup(
      <CloudflareConnectionPresentation
        locale="en-US"
        presentation={{ state: "error", code: "read-failed", manualGuidance: hostileGuidance }}
      />,
    );
    expect(html).toContain(isolated(hostileGuidance));
  });
});
