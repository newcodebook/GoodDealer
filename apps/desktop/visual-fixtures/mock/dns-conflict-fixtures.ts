import {
  parseConflictCenterViewModel,
  projectDnsVerificationViewModel,
  type ConflictCenterViewModel,
  type DnsVerificationViewModel,
} from "@gooddealer/client-core";

/** Mock DNS rows adapted from brand/ui_kits/desktop/DnsVerify.jsx. */
export interface MockDnsRow {
  readonly domain: string;
  readonly ownership: "verified" | "pending" | "failed";
  readonly nameservers: readonly string[];
  readonly delegation: "healthy" | "mismatch" | "unresolved";
  readonly records: "healthy" | "warning" | "missing";
  readonly provider: { readonly kind: "cloudflare" | "registrar_dns"; readonly name: string } | null;
  readonly propagation: "current" | "propagating" | "warning";
  readonly checkedAt: string;
}

const cloudflare = ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"];

export function initialMockDnsRows(): readonly MockDnsRow[] {
  return [
    { domain: "vault.io", ownership: "verified", nameservers: cloudflare, delegation: "healthy", records: "healthy", provider: { kind: "cloudflare", name: "Cloudflare" }, propagation: "current", checkedAt: "2026-08-20T06:02:00Z" },
    { domain: "kanban.ai", ownership: "verified", nameservers: cloudflare, delegation: "healthy", records: "healthy", provider: { kind: "cloudflare", name: "Cloudflare" }, propagation: "current", checkedAt: "2026-08-20T06:01:00Z" },
    { domain: "goldrail.com", ownership: "pending", nameservers: cloudflare, delegation: "healthy", records: "warning", provider: { kind: "cloudflare", name: "Cloudflare" }, propagation: "propagating", checkedAt: "2026-08-20T05:40:00Z" },
    { domain: "quanta.trade", ownership: "verified", nameservers: cloudflare, delegation: "healthy", records: "healthy", provider: { kind: "cloudflare", name: "Cloudflare" }, propagation: "current", checkedAt: "2026-08-20T04:20:00Z" },
    { domain: "helio.systems", ownership: "failed", nameservers: ["ns1.dynadot.com"], delegation: "mismatch", records: "missing", provider: { kind: "registrar_dns", name: "Dynadot" }, propagation: "warning", checkedAt: "2026-07-30T01:11:00Z" },
    { domain: "crest.capital", ownership: "verified", nameservers: cloudflare, delegation: "healthy", records: "warning", provider: { kind: "cloudflare", name: "Cloudflare" }, propagation: "warning", checkedAt: "2026-08-20T03:05:00Z" },
    { domain: "north.capital", ownership: "pending", nameservers: ["ns1.spaceship.com"], delegation: "mismatch", records: "healthy", provider: { kind: "registrar_dns", name: "Spaceship" }, propagation: "warning", checkedAt: "2026-08-19T09:12:00Z" },
    { domain: "mint.money", ownership: "verified", nameservers: cloudflare, delegation: "healthy", records: "healthy", provider: { kind: "cloudflare", name: "Cloudflare" }, propagation: "current", checkedAt: "2026-08-20T06:00:00Z" },
    { domain: "forge.dev", ownership: "pending", nameservers: [], delegation: "unresolved", records: "missing", provider: null, propagation: "warning", checkedAt: "2026-08-18T10:00:00Z" },
    { domain: "spark.trade", ownership: "verified", nameservers: cloudflare, delegation: "healthy", records: "healthy", provider: { kind: "cloudflare", name: "Cloudflare" }, propagation: "current", checkedAt: "2026-08-20T05:58:00Z" },
  ];
}

const fingerprint = (seed: number) => `sha256:${seed.toString(16).padStart(2, "0").repeat(32)}`;

/** Runs the client-core DNS + verification projection, so the design host shows only valid states. */
export function mockDnsVerification(rows: readonly MockDnsRow[], standby: boolean): DnsVerificationViewModel {
  const freshness = {
    source: standby ? "standby_cloud" : "active_local",
    serverRevision: 8241,
    lastReplicationActivityAt: "2026-08-20T06:02:00Z",
    lastSuccessfulProviderObservationAt: "2026-08-20T05:48:00Z",
  } as const;
  const dns = {
    schemaVersion: 1 as const,
    workspaceId: "ws-personal",
    freshness,
    domains: rows.map((row, index) => ({
      domainAssetId: row.domain,
      domain: row.domain,
      delegatedNameservers: [...row.nameservers],
      delegationStatus: row.delegation,
      provider: row.provider === null
        ? { kind: "unresolved" as const, displayName: "—" as const }
        : { kind: "connected" as const, providerKind: row.provider.kind, connectionId: `conn-${row.provider.kind}`, displayName: row.provider.name },
      recordHealth: row.records,
      propagationStatus: row.propagation,
      records: [
        { recordId: `${row.domain}-a`, type: "A" as const, host: "@", ttl: "auto" as const, classification: "ordinary" as const, value: "185.199.108.153" },
        ...(row.records === "missing" ? [] : [{
          recordId: `${row.domain}-txt`, type: "TXT" as const, host: "_atomverify", ttl: 3600,
          classification: "verification_challenge_redacted" as const, valuePreview: "atom-verify=8f2a…", challengeFingerprint: fingerprint(index + 1),
        }]),
      ],
      lastCheckedAt: row.checkedAt,
    })),
  };
  const verification = {
    schemaVersion: 1 as const,
    workspaceId: "ws-personal",
    freshness,
    attempts: rows.map((row, index) => ({
      attemptId: `verify-${row.domain}`,
      domainAssetId: row.domain,
      status: row.ownership === "verified" ? "verified" as const : row.ownership === "pending" ? "waiting_dns" as const : "expired" as const,
      method: "txt" as const,
      challenge: { recordType: "TXT" as const, host: "_atomverify", valuePreview: "atom-verify=8f2a…", fingerprint: fingerprint(index + 1) },
      evidenceSource: row.ownership === "verified" ? "api" as const : "none" as const,
      lastCheckedAt: row.checkedAt,
      verifiedAt: row.ownership === "verified" ? row.checkedAt : null,
      expiresAt: null,
    })),
  };
  const availability = standby
    ? { surface: "standby_read_only" as const, admittedActions: [] as [] }
    : {
      surface: "active" as const,
      admittedActions: rows.flatMap((row) => [
        { domainAssetId: row.domain, action: "reverify_ownership" as const },
        { domainAssetId: row.domain, action: "plan_txt_append" as const },
        { domainAssetId: row.domain, action: "plan_nameserver_change" as const },
      ]),
    };
  return projectDnsVerificationViewModel(dns, verification, availability);
}

const hash = (seed: number) => seed.toString(16).padStart(2, "0").repeat(32);

/** Mock Conflict Center adapted from brand/ui_kits/desktop/data.js, validated by the client-core parser. */
export interface MockConflict {
  readonly id: string;
  readonly group: "price" | "dns" | "sales_status";
  readonly kind: "field_conflict" | "delete_conflict";
  readonly risk: "normal" | "high" | "safety_priority";
  readonly entity: string;
  readonly field: string;
  readonly base: string;
  readonly local: string;
  readonly remote: string;
  readonly note: string;
  readonly status: "pending" | "review_stale" | "resolved_local" | "resolved_remote";
}

export function initialMockConflicts(): readonly MockConflict[] {
  return [
    { id: "c-1", group: "price", kind: "field_conflict", risk: "normal", entity: "north.capital", field: "BIN", base: "8,900.00", local: "8,200.00", remote: "8,450.00", note: "远端 07-31 由 Atom 后台修改", status: "pending" },
    { id: "c-2", group: "price", kind: "field_conflict", risk: "normal", entity: "driftline.com", field: "BIN", base: "2,600.00", local: "2,400.00", remote: "2,550.00", note: "远端 07-30 修改", status: "pending" },
    { id: "c-3", group: "price", kind: "field_conflict", risk: "normal", entity: "lumen.dev", field: "最低报价", base: "400.00", local: "350.00", remote: "500.00", note: "远端 07-29 修改", status: "review_stale" },
    { id: "c-4", group: "dns", kind: "field_conflict", risk: "high", entity: "kanban.ai", field: "TXT _atomverify", base: "（无）", local: "atom-verify=8f2a…", remote: "atom-verify=c91d…", note: "不提供无预览覆盖", status: "pending" },
    { id: "c-5", group: "sales_status", kind: "field_conflict", risk: "safety_priority", entity: "vault.io", field: "Listing 状态", base: "Active", local: "Active", remote: "Sold", note: "平台已成交，保护成交结果", status: "pending" },
    { id: "c-6", group: "price", kind: "delete_conflict", risk: "normal", entity: "tessera.xyz", field: "Listing", base: "BIN 1,200.00", local: "BIN 1,500.00", remote: "已删除", note: "远端已删除 Listing", status: "pending" },
  ];
}

export function mockConflictCenter(conflicts: readonly MockConflict[], canResolve: boolean): ConflictCenterViewModel {
  return parseConflictCenterViewModel({
    schemaVersion: 1,
    kind: "conflict_center",
    readGeneration: 41,
    candidateSetVersion: 3,
    freshness: { source: canResolve ? "active_local" : "local_continuation", serverRevision: 8241, observedAt: "2026-08-20T06:02:00Z" },
    // A pending comparison must match the current revision; only a stale review compares an older one.
    conflicts: conflicts.map((conflict, index) => ({
      candidateId: conflict.id,
      candidateKind: conflict.kind,
      entityDisplay: conflict.entity,
      fieldDisplay: conflict.field,
      group: conflict.group,
      risk: conflict.risk,
      note: conflict.note,
      baseValue: conflict.base,
      localValue: conflict.local,
      remoteValue: conflict.remote,
      comparisonServerRevision: conflict.status === "review_stale" ? 8203 : 8241,
      currentValueHash: hash(index + 1),
      status: conflict.status,
      resolutionAdmission: canResolve && conflict.status === "pending" ? {
        state: "available",
        candidateId: conflict.id,
        expectedRevision: 8241,
        expectedCandidateVersion: 1,
        expectedCurrentValueHash: hash(index + 1),
        choices: conflict.kind === "delete_conflict" ? ["accept_remote"] : ["keep_local", "accept_remote"],
      } : { state: "unavailable" },
    })),
  });
}
