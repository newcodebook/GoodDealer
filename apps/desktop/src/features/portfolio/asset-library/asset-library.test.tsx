import { parseAssetLibraryViewModel, type AssetLibraryRow, type AssetLibraryViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssetLibrary, type AssetLibraryProps } from "./asset-library";
import { assetRowStatus, parseTargetPriceInput } from "./asset-library-contract";

function row(domain: string, overrides: Partial<AssetLibraryRow> = {}): AssetLibraryRow {
  return {
    id: domain, domain, tags: [], registrar: "Spaceship", lifecycleStatus: "active", syncStatus: "clean",
    targetPrice: { currency: "USD", amount: "3500" }, expiresOn: "2027-01-01", assetVersion: 1, ...overrides,
  };
}

function library(readOnlyReason: "standby" | null, rows: readonly AssetLibraryRow[] = [row("goldrail.com"), row("kanban.ai")]): AssetLibraryViewModel {
  return parseAssetLibraryViewModel({
    schemaVersion: 3,
    kind: "asset_library",
    readGeneration: 4,
    freshness: {
      source: readOnlyReason === "standby" ? "standby_cloud" : "active_local",
      readOnlyReason,
      serverRevision: 12,
      lastReplicationActivityAt: null,
      lastSuccessfulProviderObservationAt: null,
      canEdit: readOnlyReason === null,
    },
    totalRows: rows.length,
    totalValue: { currency: "USD", amount: "284120" },
    expiringWithin60Days: 2,
    conflictCount: 1,
    listingCount: 1,
    window: { startIndex: 0, size: 25, rows },
  });
}

function render(props: Partial<AssetLibraryProps> & Pick<AssetLibraryProps, "presentation">): string {
  return renderToStaticMarkup(
    <AssetLibrary
      locale="zh-CN"
      query=""
      selectedIds={[]}
      onSelectionChange={() => undefined}
      onTargetPriceCommit={() => undefined}
      onImportCsv={() => undefined}
      onCreatePlan={() => undefined}
      referenceDate="2026-12-01"
      {...props}
    />,
  );
}

describe("Asset Library presentation", () => {
  it("renders the KPI ribbon from the Host projection with narrow currency symbols", () => {
    const html = render({ presentation: { state: "ready", data: library(null) } });

    expect(html).toContain("域名总数");
    expect(html).toContain("$284,120.00");
    expect(html).not.toContain("US$");
    expect(html).toContain("goldrail.com");
  });

  it("hides DNS and platform columns until the Host supplies listing summaries", () => {
    const withoutListings = render({ presentation: { state: "ready", data: library(null) } });
    const withListings = render({
      presentation: { state: "ready", data: library(null) },
      listingSummaries: new Map([["goldrail.com", { dnsProvider: "Cloudflare", platforms: ["Atom"] }]]),
    });

    expect(withoutListings).not.toContain("Cloudflare");
    expect(withListings).toContain("Cloudflare");
    expect(withListings).toContain("Atom");
  });

  it("removes selection and inline editing from read-only views and disables write entry points", () => {
    const html = render({ presentation: { state: "ready", data: library("standby") } });

    expect(html).toContain("当前为只读视图");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("gd-editable-value");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*导入 CSV/su);
  });

  it("offers inline BIN editing only for editable Active views", () => {
    expect(render({ presentation: { state: "ready", data: library(null) } })).toContain("gd-editable-value");
  });

  it("marks only assets expiring within 60 days of the reference date", () => {
    const html = render({
      presentation: { state: "ready", data: library(null, [row("soon.com", { expiresOn: "2026-12-20" }), row("later.com", { expiresOn: "2027-06-01" })]) },
    });

    expect(html.match(/asset-library-expiring/gu)).toHaveLength(1);
  });

  it("renders explicit empty, loading, and unavailable states instead of an empty table", () => {
    expect(render({ presentation: { state: "empty" } })).toContain("还没有域名资产");
    expect(render({ presentation: { state: "loading" } })).toContain("正在读取本地资产");
    expect(render({ presentation: { state: "error", code: "LOCAL_STORAGE_REJECTED" } })).toContain("本地资产暂不可读取");
  });
});

describe("Asset row status", () => {
  it("ranks sold and conflict above sync progress and treats a listing-free row as unlisted", () => {
    expect(assetRowStatus(row("a.com", { lifecycleStatus: "sold", syncStatus: "conflicted" }), undefined)).toBe("sold");
    expect(assetRowStatus(row("a.com", { syncStatus: "conflicted" }), undefined)).toBe("conflict");
    expect(assetRowStatus(row("a.com", { syncStatus: "pending" }), undefined)).toBe("pending");
    expect(assetRowStatus(row("a.com", { syncStatus: "local_only" }), undefined)).toBe("local");
    expect(assetRowStatus(row("a.com"), { dnsProvider: null, platforms: [] })).toBe("unlisted");
    expect(assetRowStatus(row("a.com"), undefined)).toBe("synced");
  });
});

describe("Target price input", () => {
  it("normalizes plain decimal amounts to canonical money strings", () => {
    expect(parseTargetPriceInput("42,500")).toBe("42500");
    expect(parseTargetPriceInput("$980.50")).toBe("980.5");
    expect(parseTargetPriceInput("12800.00")).toBe("12800");
    expect(parseTargetPriceInput("0")).toBe("0");
  });

  it("rejects negative, exponent, over-precise, leading-zero, and non-numeric input", () => {
    for (const input of ["-5", "1e5", "10.123", "007", "abc", "", "1.", "12345678901234567"]) {
      expect(parseTargetPriceInput(input), input).toBeNull();
    }
  });
});
