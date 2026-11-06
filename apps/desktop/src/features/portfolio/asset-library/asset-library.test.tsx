import { parseAssetLibraryViewModel, type AssetLibraryRow, type AssetLibraryViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssetLibrary, type AssetLibraryProps } from "./asset-library";
import { assetRowStatus, parseTargetPriceInput } from "./asset-library-contract";

function row(domain: string, overrides: Partial<AssetLibraryRow> = {}): AssetLibraryRow {
  return {
    id: domain, domain, tags: [], registrar: "Spaceship", lifecycleStatus: "active", syncStatus: "clean",
    targetPrice: { currency: "USD", amount: "3500" }, expiresOn: "2027-01-01", expiring: false, assetVersion: 1, ...overrides,
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
      onCreatePlan={() => undefined}
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*生成批量计划/su);
    expect(html).not.toContain("CSV");
  });

  it("offers inline BIN editing only for editable Active views", () => {
    expect(render({ presentation: { state: "ready", data: library(null) } })).toContain("gd-editable-value");
  });

  it("labels the expiring count as workspace-wide only while a search filters the other metrics", () => {
    const onRenew = () => undefined;
    const plain = render({ presentation: { state: "ready", data: library(null) }, onRenew });
    const searched = render({ presentation: { state: "ready", data: library(null) }, onRenew, query: "gold" });
    expect(plain).not.toContain("全工作区");
    expect(plain).toContain("去续费 →");
    expect(searched).toContain("全工作区 · 去续费 →");
    expect(searched).toContain('aria-label="60 天内到期 · 全工作区 · 去续费 →"');
    // Without the renewals link the note still shows, as plain text.
    expect(render({ presentation: { state: "ready", data: library(null) }, query: "gold" })).toContain("全工作区");
    expect(render({ presentation: { state: "ready", data: library(null) }, query: "  " })).not.toContain("全工作区");
  });

  it("shows prices and the page value exactly, and no page value for mixed currencies", () => {
    const exact = render({ presentation: { state: "ready", data: library(null, [
      row("big.com", { targetPrice: { currency: "USD", amount: "9007199254740993" } }),
      row("cent.com", { targetPrice: { currency: "USD", amount: "0.1" } }),
      row("dime.com", { targetPrice: { currency: "USD", amount: "0.2" } }),
    ]) } });
    expect(exact).toContain("9,007,199,254,740,993.00");
    expect(exact).toContain("$9,007,199,254,740,993.30");
    const mixed = render({ presentation: { state: "ready", data: library(null, [
      row("usd.com", { targetPrice: { currency: "USD", amount: "10" } }),
      row("eur.com", { targetPrice: { currency: "EUR", amount: "10" } }),
    ]) } });
    expect(mixed).toMatch(/<span class="asset-library-gold">—<\/span>/u);
  });

  it("marks only the assets the Host reports as expiring, whatever the Renderer's date", () => {
    // Same expiry date: the sold asset is no longer the workspace's to renew, so the Host leaves it unmarked.
    const html = render({
      presentation: { state: "ready", data: library(null, [
        row("kept.com", { expiresOn: "2026-12-20", expiring: true }),
        row("sold.com", { expiresOn: "2026-12-20", lifecycleStatus: "sold" }),
        row("later.com", { expiresOn: "2027-06-01" }),
      ]) },
    });

    expect(html.match(/asset-library-expiring/gu)).toHaveLength(1);
    expect(html).toMatch(/<span class="asset-library-expiring">2026-12-20<\/span>/u);
  });

  it("offers adding a domain only where the caller allows it, also in an empty workspace, and never on a read-only view", () => {
    const onAddDomain = async () => "added" as const;
    expect(render({ presentation: { state: "ready", data: library(null) } })).not.toContain("添加域名");
    expect(render({ presentation: { state: "ready", data: library(null) }, onAddDomain })).toMatch(/<button[^>]*>添加域名<\/button>/u);
    expect(render({ presentation: { state: "empty" }, onAddDomain })).toMatch(/<button[^>]*>添加域名<\/button>/u);
    expect(render({ presentation: { state: "ready", data: library("standby") }, onAddDomain })).toMatch(/<button[^>]*disabled=""[^>]*>添加域名<\/button>/u);
    // The kit's import slot holds manual add only: there is no CSV import.
    expect(render({ presentation: { state: "empty" }, onAddDomain })).not.toContain("CSV");
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
