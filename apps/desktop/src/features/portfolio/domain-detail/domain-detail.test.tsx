import { parseDomainDetailViewModel, type DomainDetailViewModel } from "@gooddealer/client-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DomainDetail, type DomainDetailProps } from "./index";

function detail(overrides: { readonly state?: "normal" | "conflict" | "sold"; readonly readOnly?: boolean } = {}): DomainDetailViewModel {
  const state = overrides.state ?? "normal";
  return parseDomainDetailViewModel({
    schemaVersion: 3,
    kind: "domain_detail",
    readGeneration: 3,
    freshness: {
      source: overrides.readOnly ? "standby_cloud" : "active_local",
      readOnlyReason: overrides.readOnly ? "standby" : null,
      serverRevision: 9,
      lastReplicationActivityAt: null,
      lastSuccessfulProviderObservationAt: null,
      canEdit: !overrides.readOnly,
    },
    state,
    asset: {
      id: "kanban.ai", domain: "kanban.ai", tags: ["AI"], registrar: "Namecheap",
      lifecycleStatus: state === "sold" ? "sold" : "active",
      syncStatus: state === "conflict" ? "conflicted" : "clean",
      targetPrice: { currency: "USD", amount: "45000" }, expiresOn: "2027-01-28", assetVersion: 2,
      acquiredOn: "2025-01-28", acquisitionCost: { currency: "USD", amount: "8100" },
      autoRenew: true, registrarLock: true, note: null, portfolioId: null,
    },
    conflictFields: state === "conflict" ? ["BIN"] : [],
  });
}

function render(props: Partial<DomainDetailProps> & Pick<DomainDetailProps, "presentation">): string {
  return renderToStaticMarkup(
    <DomainDetail locale="zh-CN" onBack={() => undefined} onTargetPriceCommit={() => undefined} onDelist={() => undefined} referenceDate="2026-08-20" {...props} />,
  );
}

describe("Domain detail presentation", () => {
  it("renders the value ribbon with the unrealized gain against acquisition cost", () => {
    const html = render({ presentation: { state: "ready", data: detail() } });

    expect(html).toContain("kanban.ai");
    expect(html).toContain("$45,000.00");
    expect(html).toContain("浮盈 +$36,900.00");
    expect(html).toContain("编辑价格");
  });

  it("hides listing, DNS, ownership, and history panels until those sections are supplied", () => {
    const bare = render({ presentation: { state: "ready", data: detail() } });
    const full = render({
      presentation: { state: "ready", data: detail() },
      sections: {
        listings: [{ platform: "Afternic", status: "active", price: { currency: "USD", amount: "45000" }, updatedLabel: "14:02" }],
        dns: { provider: "Cloudflare", nameservers: ["ada.ns.cloudflare.com"], records: [{ type: "A", host: "@", value: "185.199.108.153", ttl: "Auto" }] },
        ownership: { verified: true, txtHost: "_atomverify", lastVerifiedLabel: "07-30 09:11" },
        history: [{ revision: "8,241", whenLabel: "今日 14:02", label: "批量改价", field: "BIN" }],
      },
    });

    expect(bare).not.toContain("销售 Listing");
    expect(bare).not.toContain("DNS 记录");
    expect(full).toContain("销售 Listing");
    expect(full).toContain("ada.ns.cloudflare.com");
    expect(full).toContain("_atomverify");
    expect(full).toContain("rev 8,241");
  });

  it("removes every write entry point from a read-only view", () => {
    const html = render({ presentation: { state: "ready", data: detail({ readOnly: true }) } });

    expect(html).toContain("当前为只读视图");
    expect(html).not.toContain("编辑价格");
    expect(html).not.toContain(">下架<");
    expect(html).toMatch(/<input[^>]*disabled=""/u);
  });

  it("offers no price editing for a sold domain and flags conflicts", () => {
    expect(render({ presentation: { state: "ready", data: detail({ state: "sold" }) } })).not.toContain("编辑价格");
    expect(render({ presentation: { state: "ready", data: detail({ state: "conflict" }) } })).toContain("存在同步冲突");
  });

  it("renders explicit loading, not-found, and unavailable states", () => {
    expect(render({ presentation: { state: "loading" } })).toContain("正在读取域名详情");
    expect(render({ presentation: { state: "asset-not-found" } })).toContain("该域名不在本地资产中");
    expect(render({ presentation: { state: "unavailable" } })).toContain("域名详情暂不可读取");
  });
});
