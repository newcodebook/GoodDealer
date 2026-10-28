import {
  parseAssetLibraryViewModel,
  parseDomainDetailViewModel,
  type DomainDetailViewModel,
  parseSyncSnapshotViewModel,
  type AssetLibraryRow,
  type AssetLibraryViewModel,
  type SyncSnapshotViewModel,
} from "@gooddealer/client-core";

import type { AssetListingSummary, AssetSortKey, AssetStatusFilter } from "../../src/features/portfolio/asset-library";
import type { DomainDetailSections } from "../../src/features/portfolio/domain-detail";
import { assetRowStatus } from "../../src/features/portfolio/asset-library";

/**
 * Mock personal workspace, adapted from brand/ui_kits/desktop/data.js. Every projection goes through
 * the client-core parser, so the design host renders only shapes the Host contract accepts.
 */
export const mockReferenceDate = "2026-08-20";

interface MockAsset {
  readonly domain: string;
  readonly tags: readonly string[];
  readonly registrar: string;
  readonly dnsProvider: string;
  readonly platforms: readonly string[];
  readonly lifecycleStatus: AssetLibraryRow["lifecycleStatus"];
  readonly syncStatus: AssetLibraryRow["syncStatus"];
  readonly bin: string | null;
  readonly expiresOn: string;
}

const mockAssets: readonly MockAsset[] = [
  { domain: "vault.io", tags: ["三字母"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Atom", "Afternic"], lifecycleStatus: "sold", syncStatus: "clean", bin: "12800", expiresOn: "2027-03-14" },
  { domain: "goldrail.com", tags: ["portfolio-a"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Atom"], lifecycleStatus: "active", syncStatus: "clean", bin: "3500", expiresOn: "2026-10-02" },
  { domain: "kanban.ai", tags: ["AI"], registrar: "Namecheap", dnsProvider: "注册商", platforms: ["Afternic"], lifecycleStatus: "active", syncStatus: "clean", bin: "45000", expiresOn: "2027-01-28" },
  { domain: "lumen.dev", tags: [], registrar: "Dynadot", dnsProvider: "Cloudflare", platforms: ["SellerHub"], lifecycleStatus: "active", syncStatus: "conflicted", bin: "980", expiresOn: "2026-09-19" },
  { domain: "north.capital", tags: ["portfolio-a"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Atom", "Afternic"], lifecycleStatus: "active", syncStatus: "clean", bin: "8200", expiresOn: "2028-05-01" },
  { domain: "tessera.xyz", tags: [], registrar: "Namecheap", dnsProvider: "注册商", platforms: [], lifecycleStatus: "active", syncStatus: "clean", bin: null, expiresOn: "2026-08-30" },
  { domain: "quanta.trade", tags: ["金融"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Atom"], lifecycleStatus: "active", syncStatus: "clean", bin: "6600", expiresOn: "2027-06-11" },
  { domain: "driftline.com", tags: ["portfolio-b"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Atom", "Afternic"], lifecycleStatus: "active", syncStatus: "pending", bin: "2400", expiresOn: "2026-12-24" },
  { domain: "helio.systems", tags: [], registrar: "Dynadot", dnsProvider: "注册商", platforms: ["Afternic"], lifecycleStatus: "active", syncStatus: "clean", bin: "1750", expiresOn: "2027-09-08" },
  { domain: "marble.finance", tags: ["金融"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Atom"], lifecycleStatus: "active", syncStatus: "clean", bin: "15000", expiresOn: "2027-02-17" },
  { domain: "oxide.dev", tags: ["AI"], registrar: "Namecheap", dnsProvider: "Cloudflare", platforms: ["Atom", "SellerHub"], lifecycleStatus: "active", syncStatus: "pending", bin: "5200", expiresOn: "2026-10-05" },
  { domain: "lantern.app", tags: [], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Afternic"], lifecycleStatus: "active", syncStatus: "clean", bin: "3900", expiresOn: "2027-07-22" },
  { domain: "crest.capital", tags: ["金融", "portfolio-a"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Atom", "Afternic"], lifecycleStatus: "active", syncStatus: "clean", bin: "9800", expiresOn: "2027-11-30" },
  { domain: "puresignal.com", tags: [], registrar: "Dynadot", dnsProvider: "注册商", platforms: ["Atom"], lifecycleStatus: "active", syncStatus: "clean", bin: "4100", expiresOn: "2026-09-02" },
  { domain: "ember.studio", tags: ["portfolio-b"], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: ["Afternic"], lifecycleStatus: "active", syncStatus: "clean", bin: "2900", expiresOn: "2027-04-09" },
  { domain: "atlas.exchange", tags: ["金融"], registrar: "Namecheap", dnsProvider: "Cloudflare", platforms: ["Atom", "Afternic"], lifecycleStatus: "active", syncStatus: "clean", bin: "22000", expiresOn: "2028-01-15" },
  { domain: "parcel.cloud", tags: [], registrar: "Spaceship", dnsProvider: "Cloudflare", platforms: [], lifecycleStatus: "active", syncStatus: "local_only", bin: "1200", expiresOn: "2026-11-21" },
  { domain: "cobalt.network", tags: ["AI"], registrar: "Dynadot", dnsProvider: "注册商", platforms: ["SellerHub"], lifecycleStatus: "active", syncStatus: "clean", bin: "3300", expiresOn: "2027-05-30" },
];

export interface MockAssetRecord {
  readonly row: AssetLibraryRow;
  readonly listing: AssetListingSummary;
}

export function initialMockAssets(): readonly MockAssetRecord[] {
  return mockAssets.map((asset, index) => ({
    row: {
      id: asset.domain,
      domain: asset.domain,
      tags: asset.tags,
      registrar: asset.registrar,
      lifecycleStatus: asset.lifecycleStatus,
      syncStatus: asset.syncStatus,
      targetPrice: asset.bin === null ? null : { currency: "USD", amount: asset.bin },
      expiresOn: asset.expiresOn,
      assetVersion: index + 3,
    },
    listing: { dnsProvider: asset.dnsProvider, platforms: asset.platforms },
  }));
}

export const mockRegistrars = ["Spaceship", "Namecheap", "Dynadot"] as const;

export interface MockLibraryQuery {
  readonly query: string;
  readonly registrar: string;
  readonly status: AssetStatusFilter;
  readonly sortKey: AssetSortKey;
  readonly sortDirection: "asc" | "desc";
  readonly startIndex: number;
  readonly size: number;
}

/** Performs the filter / sort / window the Host would perform, then validates the projection. */
export function projectMockLibrary(
  records: readonly MockAssetRecord[],
  request: MockLibraryQuery,
  readOnlyReason: "standby" | "commercial" | null,
): AssetLibraryViewModel {
  const needle = request.query.trim().toLowerCase();
  const matching = records.filter(({ row, listing }) =>
    (needle === "" || row.domain.includes(needle) || row.tags.some((tag) => tag.toLowerCase().includes(needle)))
    && (request.registrar === "" || row.registrar === request.registrar)
    && (request.status === "all" || assetRowStatus(row, listing) === request.status));
  const value = (row: AssetLibraryRow): string | number | null =>
    request.sortKey === "domain" ? row.domain
      : request.sortKey === "expiresOn" ? row.expiresOn
        : row.targetPrice === null ? null : Number(row.targetPrice.amount);
  const sorted = [...matching].sort((left, right) => {
    const a = value(left.row);
    const b = value(right.row);
    if (a === null) return 1;
    if (b === null) return -1;
    const order = a < b ? -1 : a > b ? 1 : 0;
    return request.sortDirection === "asc" ? order : -order;
  });
  const startIndex = sorted.length === 0 ? 0 : Math.min(request.startIndex, Math.floor((sorted.length - 1) / request.size) * request.size);
  const total = records.reduce((sum, { row }) => sum + (row.targetPrice === null ? 0 : Number(row.targetPrice.amount)), 0);
  return parseAssetLibraryViewModel({
    schemaVersion: 3,
    kind: "asset_library",
    readGeneration: 41,
    freshness: {
      source: readOnlyReason === "standby" ? "standby_cloud" : "active_local",
      readOnlyReason,
      serverRevision: 8241,
      lastReplicationActivityAt: "2026-08-20T06:02:00Z",
      lastSuccessfulProviderObservationAt: "2026-08-20T05:48:00Z",
      canEdit: readOnlyReason === null,
    },
    totalRows: sorted.length,
    totalValue: { currency: "USD", amount: String(total) },
    expiringWithin60Days: records.filter(({ row }) => row.expiresOn !== null && row.expiresOn <= "2026-10-19").length,
    conflictCount: records.filter(({ row }) => row.syncStatus === "conflicted").length,
    listingCount: records.filter(({ listing }) => listing.platforms.length > 0).length,
    window: { startIndex, size: request.size, rows: sorted.slice(startIndex, startIndex + request.size).map(({ row }) => row) },
  });
}

export function mockSyncSnapshot(pendingMutationCount: number, syncing: boolean): SyncSnapshotViewModel {
  return parseSyncSnapshotViewModel({
    schemaVersion: 1,
    source: "active_local",
    readGeneration: 41,
    transport: "reachable",
    blockedReason: null,
    activity: syncing ? "syncing" : "idle",
    pendingMutationCount,
    openConflictCount: 6,
    rejectedMutationCount: 0,
    recoveryRequired: false,
    appliedThroughServerRevision: 8241,
    lastReplicationActivityAt: "2026-08-20T06:02:00Z",
    transportObservedAt: "2026-08-20T06:02:00Z",
  });
}

/** Detail projection for one mock asset; mirrors the kit's synthesized registration / DNS / history. */
export function mockDomainDetail(record: MockAssetRecord, readOnlyReason: "standby" | null): DomainDetailViewModel {
  const { row } = record;
  const conflict = row.syncStatus === "conflicted";
  const sold = row.lifecycleStatus === "sold";
  const acquired = row.expiresOn === null ? null : `${Number(row.expiresOn.slice(0, 4)) - 2}${row.expiresOn.slice(4)}`;
  return parseDomainDetailViewModel({
    schemaVersion: 3,
    kind: "domain_detail",
    readGeneration: 41,
    freshness: {
      source: readOnlyReason === "standby" ? "standby_cloud" : "active_local",
      readOnlyReason,
      serverRevision: 8241,
      lastReplicationActivityAt: "2026-08-20T06:02:00Z",
      lastSuccessfulProviderObservationAt: "2026-08-20T05:48:00Z",
      canEdit: readOnlyReason === null,
    },
    state: sold ? "sold" : conflict ? "conflict" : "normal",
    asset: {
      ...row,
      acquiredOn: acquired,
      acquisitionCost: row.targetPrice === null ? null : { currency: "USD", amount: String(Math.round(Number(row.targetPrice.amount) * 0.18)) },
      autoRenew: true,
      registrarLock: true,
      note: null,
      portfolioId: row.tags.find((tag) => tag.startsWith("portfolio")) ?? null,
    },
    conflictFields: conflict ? ["BIN", "Listing"] : [],
  });
}

export function mockDomainSections(record: MockAssetRecord): DomainDetailSections {
  const { row, listing } = record;
  const registrar = (row.registrar ?? "registrar").toLowerCase();
  const nameservers = listing.dnsProvider === "Cloudflare"
    ? ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]
    : [`ns1.${registrar}.com`, `ns2.${registrar}.com`];
  return {
    listings: listing.platforms.map((platform, index) => ({
      platform,
      status: row.lifecycleStatus === "sold" && index === 0 ? "sold" : row.syncStatus === "pending" ? "pending" : "active",
      price: row.targetPrice,
      updatedLabel: index === 0 ? "14:02" : "07-28",
    })),
    dns: {
      provider: listing.dnsProvider ?? "—",
      nameservers,
      records: [
        { type: "A", host: "@", value: "185.199.108.153", ttl: "Auto" },
        { type: "CNAME", host: "www", value: row.domain, ttl: "Auto" },
        { type: "TXT", host: "_atomverify", value: "atom-verify=8f2a…", ttl: "3600" },
        { type: "MX", host: "@", value: `10 mail.${row.domain}`, ttl: "3600" },
      ],
    },
    ownership: { verified: true, txtHost: "_atomverify", lastVerifiedLabel: "07-30 09:11" },
    history: [
      { revision: "8,241", whenLabel: "今日 14:02", label: "批量改价 −8%", field: "BIN" },
      { revision: "8,180", whenLabel: "07-30 09:11", label: "同步 · Atom", field: "Listing" },
      { revision: "7,905", whenLabel: "07-14 16:40", label: "手动编辑", field: "标签" },
    ],
  };
}
