import { parseDnsHealthRead, projectDnsHealthViewModel, projectDnsVerificationViewModel, type DnsVerificationViewModel } from "@gooddealer/client-core";
import { getPresentationCopy } from "@gooddealer/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DnsVerification } from "./index";

const freshness = (source: "active_local" | "standby_cloud") => ({
  source, serverRevision: 7, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null,
});

function view(source: "active_local" | "standby_cloud" = "active_local"): DnsVerificationViewModel {
  return projectDnsVerificationViewModel(
    {
      schemaVersion: 1, workspaceId: "ws", freshness: freshness(source),
      domains: [
        {
          domainAssetId: "helio.systems", domain: "helio.systems", delegatedNameservers: ["ns1.dynadot.com"], delegationStatus: "mismatch",
          provider: { kind: "connected", providerKind: "dynadot", connectionId: "c1", displayName: "Dynadot" },
          recordHealth: "healthy", propagationStatus: "warning", records: [], lastCheckedAt: null,
        },
        {
          domainAssetId: "goldrail.com", domain: "goldrail.com", delegatedNameservers: ["ada.ns.cloudflare.com"], delegationStatus: "healthy",
          provider: { kind: "connected", providerKind: "cloudflare", connectionId: "c2", displayName: "Cloudflare" },
          recordHealth: "healthy", propagationStatus: "current", records: [], lastCheckedAt: null,
        },
      ],
    },
    {
      schemaVersion: 1, workspaceId: "ws", freshness: freshness(source),
      attempts: [
        { attemptId: "a1", domainAssetId: "helio.systems", status: "verified", method: "txt", challenge: null, evidenceSource: "api", lastCheckedAt: null, verifiedAt: "2026-08-20T00:00:00Z", expiresAt: null },
        {
          attemptId: "a2", domainAssetId: "goldrail.com", status: "waiting_dns", method: "txt",
          challenge: { recordType: "TXT", host: "_atomverify", valuePreview: "atom-verify=8f2a…", fingerprint: `sha256:${"ab".repeat(32)}` },
          evidenceSource: "none", lastCheckedAt: null, verifiedAt: null, expiresAt: null,
        },
      ],
    },
    source === "active_local"
      ? { surface: "active", admittedActions: [{ domainAssetId: "helio.systems", action: "plan_nameserver_change" }, { domainAssetId: "goldrail.com", action: "reverify_ownership" }] }
      : { surface: "standby_read_only", admittedActions: [] },
  );
}

describe("DNS & verification", () => {
  it("offers only the repairs the Host admits for each row", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={view()} onReverify={() => undefined} onRequestNameserverPlan={() => undefined} onRequestTxtPlan={() => undefined} />);

    expect(html).toContain("改 NS");
    expect(html).toContain("重新验证");
    expect(html).not.toContain("添加 TXT");
    expect(html).toContain("重新验证待验证项 · 1");
  });

  it("shows a verifying state instead of actions while a re-check is in flight", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={view()} verifyingIds={new Set(["goldrail.com"])} onReverify={() => undefined} />);

    expect(html).toContain("验证中");
  });

  it("removes every repair from a Standby view", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={view("standby_cloud")} onReverify={() => undefined} onRequestNameserverPlan={() => undefined} />);

    expect(html).toContain("备用设备只读");
    // No DNS write is qualified, so the notice never implies the Active device offers them.
    expect(html).toContain("尚未在任何设备上取得资格");
    expect(html).not.toContain("改 NS");
    expect(html).not.toContain("重新验证待验证项");
    expect(html).toContain("Standby 云端数据");
  });
});

describe("DNS & verification from the Host DNS health projection", () => {
  const hostView = (dnssecStatus: "active" | "inactive" | "unknown" | "unsupported" = "unknown") => projectDnsHealthViewModel([parseDnsHealthRead({
    schemaVersion: 1, kind: "dns_health", readGeneration: 2,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 3, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    totalRows: 2, assetCount: 2, observedCount: 1, warningCount: 0,
    window: {
      startIndex: 0, size: 200,
      rows: [
        {
          entityId: "observed.test", bindable: true, zoneBinding: null,
          observation: {
            providerKind: "cloudflare", observedAt: "2026-08-28T00:00:00Z", availability: "available", evidenceStatus: "confirmed",
            zoneLabel: "observed.test", zoneStatus: "active", authoritativeNameservers: ["ada.ns.cloudflare.com"], dnssecStatus,
            recordCounts: { a: 2, aaaa: 0, cname: 1, txt: 0, other: 0 },
          },
        },
        { entityId: "plain.test", bindable: false, zoneBinding: null, observation: null },
      ],
    },
  })], 200);

  it("says ownership is not connected and offers no verification or repair controls", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={hostView()} />);

    expect(html).toContain("未接入");
    expect(html).toContain("所有权验证尚未接入");
    expect(html).toContain("3 条");
    expect(html).toContain("未观察");
    // Delegation stays unknown; the observed Zone nameservers and DNSSEC are labelled as Zone facts.
    expect(html).toContain("未知 NS");
    expect(html).toContain("Zone 分配");
    expect(html).toContain("ada.ns.cloudflare.com");
    expect(html).toContain("DNSSEC 未知");
    // An observed Zone always reports DNSSEC; the unobserved row has no status, so no label.
    expect(html.split("DNSSEC ").length - 1).toBe(1);
    for (const control of ["重新验证", "改 NS", "添加 TXT", "验证 TXT", "已验证所有权"]) expect(html).not.toContain(control);
    // The brand guide's TXT ownership and repair description is not shown for flows that do not exist.
    for (const claim of ["_atomverify", "修复分别走"]) expect(html).not.toContain(claim);
    expect(html).not.toContain("dns-danger");
  });

  it("leaves search to the Host and pages through its results", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="en-US" view={hostView()} query="zzz" onQueryChange={() => undefined} onPageChange={() => undefined} />);

    // The Host already searched, so its rows are shown even though "zzz" matches neither locally.
    expect(html).toContain('value="zzz"');
    expect(html).toContain("observed.test");
    expect(html).toContain("plain.test");
    expect(html).toContain("1–2");
    const empty = { ...hostView(), rows: [], page: { startIndex: 0, size: 200, totalItems: 0 } };
    const searched = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={empty} query="zzz" onQueryChange={() => undefined} />);
    expect(searched).toContain(getPresentationCopy("zh-CN", "dnsVerification").searchEmpty);
    expect(html).not.toContain("aria-busy");
    // While the next search loads, the last result stays mounted (and the search box with it), marked busy.
    const busy = renderToStaticMarkup(<DnsVerification locale="en-US" view={hostView()} busy query="zz" onQueryChange={() => undefined} />);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('value="zz"');
  });

  it.each([
    ["en-US", "active", "DNSSEC On"],
    ["en-US", "inactive", "DNSSEC Off"],
    ["en-US", "unknown", "DNSSEC Unknown"],
    ["en-US", "unsupported", "DNSSEC Unsupported"],
    ["zh-CN", "active", "DNSSEC 已启用"],
    ["zh-CN", "inactive", "DNSSEC 未启用"],
    ["zh-CN", "unsupported", "DNSSEC 不支持"],
  ] as const)("labels an observed %s DNSSEC status %s as a Zone fact", (locale, status, label) => {
    expect(renderToStaticMarkup(<DnsVerification locale={locale} view={hostView(status)} />)).toContain(label);
  });

  it("offers to bind only a row with confirmed evidence of its own Zone, and only when a bind handler is composed", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={hostView()} onBindZone={() => undefined} />);
    // One observed, unbound row: exactly one bind button.
    expect(html.split("绑定 Zone").length - 1).toBe(1);
    expect(renderToStaticMarkup(<DnsVerification locale="zh-CN" view={hostView()} />)).not.toContain("绑定 Zone");
    const busy = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={hostView()} onBindZone={() => undefined} bindingId="observed.test" />);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>绑定 Zone<\/button>/u);
    const standby = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={{ ...hostView(), readSource: "standby_cloud" }} onBindZone={() => undefined} />);
    expect(standby).not.toContain("绑定 Zone");
  });

  it("labels a confirmed Zone as observed, never as healthy", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="en-US" view={hostView()} />);

    expect(html).toContain("Observed");
    expect(html).not.toContain("Healthy");
    for (const claim of ["_atomverify", "Each repair"]) expect(html).not.toContain(claim);
  });
});
