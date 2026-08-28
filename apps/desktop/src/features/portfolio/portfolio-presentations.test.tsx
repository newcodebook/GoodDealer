import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Button, Input, Pagination, Table, Toolbar } from "@gooddealer/ui";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AssetLibrary } from "./asset-library";
import { DomainDetail } from "./domain-detail";
import type {
  PortfolioAssetRow,
  PortfolioDetailData,
  PortfolioListData,
  PortfolioReadMeta,
  PortfolioReadState,
} from "./portfolio-presentation-contract";

const confirmedMeta = {
  source: "gooddealer-cloud",
  observedAt: "2026-08-26T17:45:00Z",
  version: 42,
  availability: "available",
  uncertainty: "confirmed",
} as const satisfies PortfolioReadMeta;

const row = {
  entityId: "asset-1",
  displayName: "example.test",
  registrarLabel: "Example Registrar",
  expirationLabel: "2027-08-26",
  statusLabel: "Observed",
  tags: ["primary"],
  meta: confirmedMeta,
} as const satisfies PortfolioAssetRow;

const listData = {
  rows: [row],
  totalRows: 51,
  window: { startIndex: 25, size: 25 },
} as const satisfies PortfolioListData;

const detailData = {
  entityId: row.entityId,
  displayName: row.displayName,
  registrarLabel: row.registrarLabel,
  registeredOnLabel: "2024-08-26",
  expirationLabel: row.expirationLabel,
  statusLabel: row.statusLabel,
  tags: row.tags,
  meta: confirmedMeta,
} as const satisfies PortfolioDetailData;

const unavailableMeta = { ...confirmedMeta, availability: "unavailable", uncertainty: "unknown" } as const;
const staleMeta = { ...confirmedMeta, uncertainty: "stale" } as const;
const uncertainMeta = { ...confirmedMeta, uncertainty: "conflicted" } as const;

function listStates(): readonly PortfolioReadState<PortfolioListData>[] {
  return [
    { state: "loading" },
    { state: "empty", meta: confirmedMeta },
    { state: "unavailable", meta: unavailableMeta, reason: "projection unavailable" },
    { state: "error", code: "invalid-projection" },
    { state: "ready", meta: confirmedMeta, data: listData },
    { state: "stale", meta: staleMeta, data: listData },
    { state: "uncertain", meta: uncertainMeta, data: null },
  ];
}

function detailStates(): readonly PortfolioReadState<PortfolioDetailData>[] {
  return [
    { state: "loading" },
    { state: "empty", meta: confirmedMeta },
    { state: "unavailable", meta: unavailableMeta, reason: "projection unavailable" },
    { state: "error", code: "read-failed" },
    { state: "ready", meta: confirmedMeta, data: detailData },
    { state: "stale", meta: staleMeta, data: detailData },
    { state: "uncertain", meta: uncertainMeta, data: null },
  ];
}

type InspectableElement = ReactElement<Record<string, unknown>>;

function elements(node: ReactNode): InspectableElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as InspectableElement;
  return [element, ...elements(element.props.children as ReactNode)];
}

describe("portfolio read-only presentations", () => {
  it("renders every closed list and detail state distinctly", () => {
    for (const presentation of listStates()) {
      const html = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={presentation} />);
      expect(html).toContain(`data-state="${presentation.state}"`);
    }
    for (const presentation of detailStates()) {
      const html = renderToStaticMarkup(<DomainDetail locale="en-US" presentation={presentation} onBack={vi.fn()} />);
      expect(html).toContain(`data-state="${presentation.state}"`);
    }
  });

  it("shows source, observed time, version, availability, and uncertainty", () => {
    const listHtml = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state: "ready", meta: confirmedMeta, data: listData }} />);
    const detailHtml = renderToStaticMarkup(<DomainDetail locale="en-US" presentation={{ state: "stale", meta: staleMeta, data: detailData }} onBack={vi.fn()} />);

    for (const expected of ["gooddealer-cloud", confirmedMeta.observedAt, String(confirmedMeta.version), "available", "confirmed"]) {
      expect(listHtml).toContain(expected);
    }
    for (const expected of ["gooddealer-cloud", confirmedMeta.observedAt, String(confirmedMeta.version), "available", "stale"]) {
      expect(detailHtml).toContain(expected);
    }
  });

  it("keeps the wide metadata grid out of the nested detail panel", () => {
    const css = ["asset-library/asset-library.css", "portfolio-read-meta.css"]
      .map((path) => readFileSync(resolve(import.meta.dirname, path), "utf8"))
      .join("\n");
    const detailHtml = renderToStaticMarkup(<DomainDetail locale="en-US" presentation={{ state: "ready", meta: confirmedMeta, data: detailData }} onBack={vi.fn()} />);

    expect(css).not.toMatch(/\.portfolio-read-meta\s+\.gd-key-values/);
    expect(css).toMatch(/\.portfolio-read-meta--strip\s*>\s*\.gd-key-values\s*\{[^}]*grid-template-columns:\s*repeat\(4,[^}]*column-gap:\s*24px/s);
    expect(css).toMatch(/\.portfolio-read-meta--panel\s*>\s*\.gd-key-values\s*\{[^}]*display:\s*flex/s);
    expect(detailHtml.match(/portfolio-read-meta--strip/g)).toHaveLength(1);
    expect(detailHtml.match(/portfolio-read-meta--panel/g)).toHaveLength(1);
  });

  it("forwards only navigation, query, and window intents", () => {
    const onOpenAsset = vi.fn();
    const onQueryChange = vi.fn();
    const onWindowChange = vi.fn();
    const onBack = vi.fn();
    const tree = AssetLibrary({ locale: "en-US", presentation: { state: "ready", meta: confirmedMeta, data: listData }, onOpenAsset, onQueryChange, onWindowChange }) as InspectableElement;
    const descendants = elements(tree.props.children as ReactNode);
    const toolbar = descendants.find((element) => element.type === Toolbar);
    const input = elements(toolbar?.props.left as ReactNode).find((element) => element.type === Input);
    const table = descendants.find((element) => element.type === Table);
    const pagination = isValidElement(table?.props.footer) ? table.props.footer as InspectableElement : undefined;

    (input?.props.onChange as ((event: { currentTarget: { value: string } }) => void))({ currentTarget: { value: "example" } });
    (table?.props.onRowClick as ((value: PortfolioAssetRow) => void))(row);
    expect(pagination?.type).toBe(Pagination);
    (pagination?.props.onPageChange as ((page: number) => void))(3);
    (pagination?.props.onPageSizeChange as ((size: number) => void))(50);

    expect(onQueryChange).toHaveBeenCalledWith("example");
    expect(onOpenAsset).toHaveBeenCalledWith("asset-1");
    expect(onWindowChange).toHaveBeenNthCalledWith(1, { startIndex: 50, size: 25 });
    expect(onWindowChange).toHaveBeenNthCalledWith(2, { startIndex: 0, size: 50 });

    const detailTree = DomainDetail({ locale: "en-US", presentation: { state: "ready", meta: confirmedMeta, data: detailData }, onBack }) as InspectableElement;
    const backButton = elements(detailTree.props.children as ReactNode).find((element) => element.type === Button);
    (backButton?.props.onClick as (() => void))();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders hostile projection labels as escaped text without HTML or URL sinks", () => {
    const hostile = `<img src=x onerror="alert(1)">javascript:alert(2)\u202E`;
    const hostileRow = { ...row, displayName: hostile, registrarLabel: hostile, statusLabel: hostile, tags: [hostile] };
    const hostileData = { ...listData, rows: [hostileRow] };
    const html = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state: "ready", meta: confirmedMeta, data: hostileData }} />);
    const unavailableHtml = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state: "unavailable", meta: unavailableMeta, reason: hostile }} />);

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(unavailableHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(unavailableHtml).not.toContain("<img");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps unavailable and uncertain states non-actionable", () => {
    const unavailable = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state: "unavailable", meta: unavailableMeta, reason: "manual observation required" }} onOpenAsset={vi.fn()} onQueryChange={vi.fn()} onWindowChange={vi.fn()} />);
    const uncertain = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state: "uncertain", meta: uncertainMeta, data: null }} onOpenAsset={vi.fn()} />);

    expect(unavailable).not.toContain("<input");
    expect(unavailable).not.toContain("<table");
    expect(uncertain).toContain("<input");
    expect(uncertain).not.toContain("gd-row--clickable");
    expect(unavailable).not.toContain("type=\"checkbox\"");
  });
});
