import { projectDnsVerificationViewModel, type DnsVerificationViewModel } from "@gooddealer/client-core";
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
