import { parseDnsHealthRead, projectDnsHealthViewModel, projectDnsVerificationViewModel, type DnsVerificationViewModel } from "@gooddealer/client-core";
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
          provider: { kind: "connected", providerKind: "registrar_dns", connectionId: "c1", displayName: "Dynadot" },
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

    expect(html).toContain("当前为只读视图");
    expect(html).not.toContain("改 NS");
    expect(html).not.toContain("重新验证待验证项");
    expect(html).toContain("Standby 云端数据");
  });
});

describe("DNS & verification from the Host DNS health projection", () => {
  const hostView = () => projectDnsHealthViewModel([parseDnsHealthRead({
    schemaVersion: 1, kind: "dns_health", readGeneration: 2,
    freshness: { source: "active_local", readOnlyReason: null, serverRevision: 3, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
    totalRows: 2,
    window: {
      startIndex: 0, size: 200,
      rows: [
        {
          entityId: "observed.test", zoneBinding: null,
          observation: {
            providerKind: "cloudflare", observedAt: "2026-08-28T00:00:00Z", availability: "available", evidenceStatus: "confirmed",
            zoneLabel: "observed.test", zoneStatus: "active", authoritativeNameservers: ["ada.ns.cloudflare.com"], dnssecStatus: "unknown",
            recordCounts: { a: 2, aaaa: 0, cname: 1, txt: 0, other: 0 },
          },
        },
        { entityId: "plain.test", zoneBinding: null, observation: null },
      ],
    },
  })]);

  it("says ownership is not connected and offers no verification or repair controls", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="zh-CN" view={hostView()} />);

    expect(html).toContain("未接入");
    expect(html).toContain("所有权验证尚未接入");
    expect(html).toContain("3 条");
    expect(html).toContain("未观察");
    expect(html).toContain("ada.ns.cloudflare.com");
    for (const control of ["重新验证", "改 NS", "添加 TXT", "验证 TXT", "已验证所有权"]) expect(html).not.toContain(control);
    expect(html).not.toContain("dns-danger");
  });

  it("labels a confirmed Zone as observed, never as healthy", () => {
    const html = renderToStaticMarkup(<DnsVerification locale="en-US" view={hostView()} />);

    expect(html).toContain("Observed");
    expect(html).not.toContain("Healthy");
  });
});
