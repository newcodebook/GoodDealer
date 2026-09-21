import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AssetLibrary } from "./asset-library";
import { DomainDetail } from "./domain-detail";

const freshness = { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true } as const;
const row = { id: "example.test", domain: "example.test", tags: ["<script>alert(1)</script>"], registrar: "<img onerror=alert(1)>", lifecycleStatus: "active", syncStatus: "clean", targetPrice: null, expiresOn: null, assetVersion: 1 } as const;
const library = { schemaVersion: 3, kind: "asset_library", readGeneration: 1, freshness, totalRows: 1, totalValue: null, expiringWithin60Days: 0, conflictCount: 0, listingCount: 0, window: { startIndex: 0, size: 25, rows: [row] } } as const;
const detail = { schemaVersion: 3, kind: "domain_detail", readGeneration: 1, freshness, state: "normal", asset: { ...row, portfolioId: null, acquiredOn: null, acquisitionCost: null, autoRenew: null, registrarLock: null, note: "javascript:alert(1)" }, conflictFields: [] } as const;

describe("local portfolio presentations", () => {
  it("renders all closed local read states", () => {
    for (const state of ["loading", "empty", "invalid-window", "unavailable"] as const) {
      expect(renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state }} />)).toContain(`data-state="${state}"`);
    }
    expect(renderToStaticMarkup(<DomainDetail locale="en-US" presentation={{ state: "asset-not-found" }} onBack={vi.fn()} />)).toContain('data-state="asset-not-found"');
  });

  it("renders stored values only as escaped text and exposes no URL or raw HTML sink", () => {
    const listHtml = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state: "ready", data: library }} />);
    const detailHtml = renderToStaticMarkup(<DomainDetail locale="en-US" presentation={{ state: "ready", data: detail }} onBack={vi.fn()} />);
    expect(listHtml).toContain("&lt;script&gt;");
    expect(detailHtml).toContain("example.test");
    expect(`${listHtml}${detailHtml}`).not.toContain("dangerouslySetInnerHTML");
    expect(`${listHtml}${detailHtml}`).not.toContain("href=");
  });

  it("retains the last valid list for invalid queries", () => {
    const html = renderToStaticMarkup(<AssetLibrary locale="en-US" presentation={{ state: "invalid-query", data: library }} />);
    expect(html).toContain("example.test");
    expect(html).toContain("invalid-query");
  });
});
