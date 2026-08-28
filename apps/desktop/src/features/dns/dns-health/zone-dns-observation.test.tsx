import { Button, Input, Select, Table, type TableColumn } from "@gooddealer/ui";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DomainDetailDnsSection } from "./domain-detail-dns-section";
import type {
  DnsObservationMeta,
  ObservedDnsRecord,
  ZoneDnsObservationData,
  ZoneDnsObservationState,
} from "./presentation-contract";
import {
  ZoneDnsObservationPresentation,
  ZoneDnsObservationReadSection,
} from "./zone-dns-observation";

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

const meta = {
  source: "cloudflare-zone-dns",
  observedAt: "2026-08-26T12:30:00Z",
  version: 23,
  availability: "available",
  uncertainty: "confirmed",
} as const satisfies DnsObservationMeta;

const records: readonly ObservedDnsRecord[] = [
  {
    recordId: "record-a",
    fqdn: "www.example.test",
    type: "A",
    displayValue: "192.0.2.1",
    ttl: 300,
    proxied: true,
    providerVersionToken: 23,
    classification: "ordinary",
  },
  {
    recordId: "record-txt",
    fqdn: "example.test",
    type: "TXT",
    displayValue: "redacted-observed-value…",
    ttl: null,
    proxied: false,
    providerVersionToken: 23,
    classification: "redacted",
  },
];

const data = {
  zoneId: "zone-1",
  zoneLabel: "example.test",
  zoneStatus: "active",
  records,
} as const satisfies ZoneDnsObservationData;

const states: readonly ZoneDnsObservationState[] = [
  { state: "loading" },
  { state: "empty", meta, manualGuidance: "No observed records are available." },
  { state: "available", meta, data },
  { state: "stale", meta: { ...meta, uncertainty: "stale" }, data },
  {
    state: "uncertain",
    meta: { ...meta, uncertainty: "unknown" },
    data: null,
    manualGuidance: "Treat this observation as uncertain.",
  },
  {
    state: "unavailable",
    code: "rate-limited",
    retryAfterSeconds: 45,
    manualGuidance: "Wait before reading again.",
  },
  { state: "error", code: "read-failed", manualGuidance: "Review the local observation." },
];

describe("ZoneDnsObservationPresentation", () => {
  it("renders all closed states with provenance, availability, uncertainty, time, and version", () => {
    for (const presentation of states) {
      const html = renderToStaticMarkup(
        <ZoneDnsObservationPresentation locale="en-US" presentation={presentation} />,
      );
      expect(html).toContain(`data-state="${presentation.state}"`);
      expect(html).toContain("cloudflare-zone-dns");
      expect(html).toContain("data-availability=");
      expect(html).toContain("data-uncertainty=");
      expect(html).toContain("Last checked");
      expect(html).toContain("Version");
    }
  });

  it("renders sanitized observed records, including redacted TXT, as read-only text", () => {
    const html = renderToStaticMarkup(
      <ZoneDnsObservationPresentation locale="en-US" presentation={states[2]!} />,
    );
    expect(html).toContain("example.test");
    expect(html).toContain("192.0.2.1");
    expect(html).toContain("TXT");
    expect(html).toContain("redacted-observed-value…");
    expect(html).toContain("Redacted preview");
    expect(html).not.toContain("<a");
    expect(html).not.toContain('type="checkbox"');
  });

  it("forwards only local query and validated record filters", () => {
    const onQueryChange = vi.fn();
    const onRecordFilterChange = vi.fn();
    const tree = ZoneDnsObservationReadSection({
      locale: "en-US",
      presentation: states[2]!,
      actions: { onQueryChange, onRecordFilterChange },
      showControls: true,
    }) as InspectableElement;
    const all = elements(tree);
    const input = all.find((element) => element.type === Input);
    const select = all.find((element) => element.type === Select);
    input?.props.onChange({ currentTarget: { value: "www" } });
    select?.props.onChange({ currentTarget: { value: "TXT" } });
    select?.props.onChange({ currentTarget: { value: "unexpected" } });
    expect(onQueryChange).toHaveBeenCalledWith("www");
    expect(onRecordFilterChange).toHaveBeenCalledOnce();
    expect(onRecordFilterChange).toHaveBeenCalledWith("TXT");
  });

  it("applies local filters without changing record authority", () => {
    const tree = ZoneDnsObservationReadSection({
      locale: "en-US",
      presentation: states[2]!,
      query: "www",
      recordFilter: "A",
      showControls: true,
    }) as InspectableElement;
    const table = elements(tree).find((element) => element.type === Table);
    expect(table?.props.rows).toEqual([records[0]]);
    const columns = table?.props.columns as readonly TableColumn<ObservedDnsRecord>[];
    expect(columns.map((column) => column.key)).toEqual([
      "type",
      "fqdn",
      "value",
      "ttl",
      "proxied",
      "providerVersionToken",
    ]);
  });

  it("exposes only payload-free retry in closed read states", () => {
    const onRetryRead = vi.fn();
    const tree = ZoneDnsObservationReadSection({
      locale: "en-US",
      presentation: states[6]!,
      actions: { onRetryRead },
      showControls: true,
    }) as InspectableElement;
    const retry = elements(tree).find((element) => element.type === Button);
    retry?.props.onClick();
    expect(onRetryRead).toHaveBeenCalledOnce();
    expect(onRetryRead).toHaveBeenCalledWith();

    const availableHtml = renderToStaticMarkup(
      <ZoneDnsObservationPresentation
        locale="en-US"
        presentation={states[2]!}
        actions={{ onRetryRead }}
      />,
    );
    expect(availableHtml).not.toContain("<button");
  });

  it("isolates U+202E in hostile zone, FQDN, and record values without producing active markup", () => {
    const hostile = '<img src=x onerror=alert(1)> \u202E https://example.invalid';
    const hostileData: ZoneDnsObservationData = {
      zoneId: "zone-hostile",
      zoneLabel: hostile,
      zoneStatus: "unknown",
      records: [{ ...records[1]!, recordId: "record-hostile", fqdn: hostile, displayValue: hostile }],
    };
    const html = renderToStaticMarkup(
      <ZoneDnsObservationPresentation
        locale="en-US"
        presentation={{ state: "available", meta, data: hostileData }}
      />,
    );
    const escapedHostile = "&lt;img src=x onerror=alert(1)&gt; \u202E https://example.invalid";
    expect(html.match(/<bdi dir="auto">/g)).toHaveLength(3);
    expect(html.split(isolated(escapedHostile))).toHaveLength(4);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a");
  });

  it("isolates U+202E in hostile manual guidance", () => {
    const hostileGuidance = "Use the read-only observation \u202E moc.elpmaxe//:sptth";
    const html = renderToStaticMarkup(
      <ZoneDnsObservationPresentation
        locale="en-US"
        presentation={{ state: "error", code: "read-failed", manualGuidance: hostileGuidance }}
      />,
    );
    expect(html).toContain(isolated(hostileGuidance));
  });
});

describe("DomainDetailDnsSection", () => {
  it("uses the same fail-closed read section without local filter controls", () => {
    const html = renderToStaticMarkup(
      <DomainDetailDnsSection locale="en-US" presentation={states[3]!} />,
    );
    expect(html).toContain('data-state="stale"');
    expect(html).toContain("redacted-observed-value…");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
  });
});
