import { DesktopShell, type DesktopShellBanner } from "../../src/app-shell";
import { CloudflareConnectionPresentation, type CloudflareConnectionState } from "../../src/features/connections";
import { ZoneDnsObservationPresentation, type ZoneDnsObservationState } from "../../src/features/dns";
import {
  AssetLibrary,
  DomainDetail,
  type PortfolioAssetRow,
  type PortfolioDetailData,
  type PortfolioListData,
  type PortfolioReadMeta,
  type PortfolioReadState,
} from "../../src/features/portfolio";
import { ActivationWizard, type ActivationPresentation } from "../../src/features/runtime-mode/activation";
import type { ReactNode } from "react";
import type { PresentationFixtureRegistration } from "./presentation-registry";

const observedAt = "2026-08-26T08:15:00.000Z";
const availableMeta = { source: "gooddealer-cloud", observedAt, version: 42, availability: "available", uncertainty: "confirmed" } as const satisfies PortfolioReadMeta;
const staleMeta = { ...availableMeta, uncertainty: "stale" } as const satisfies PortfolioReadMeta;
const uncertainMeta = { ...availableMeta, uncertainty: "conflicted" } as const satisfies PortfolioReadMeta;
const unavailableMeta = { ...availableMeta, observedAt: null, availability: "unavailable", uncertainty: "unknown" } as const satisfies PortfolioReadMeta;

const rows: readonly PortfolioAssetRow[] = [
  { entityId: "fixture-asset-001", displayName: "northstar.example", registrarLabel: "Fixture Registrar", expirationLabel: "2027-04-18", statusLabel: "Observed", tags: ["synthetic", "local QA"], meta: availableMeta },
  { entityId: "fixture-asset-002", displayName: "harbor.example", registrarLabel: null, expirationLabel: null, statusLabel: "Read only", tags: ["fixture"], meta: { ...availableMeta, version: 41, uncertainty: "unknown" } },
];

const listData: PortfolioListData = { rows, totalRows: rows.length, window: { startIndex: 0, size: 25 } };
const detailData: PortfolioDetailData = { entityId: rows[0]!.entityId, displayName: rows[0]!.displayName, registrarLabel: rows[0]!.registrarLabel, registeredOnLabel: "2021-04-18", expirationLabel: rows[0]!.expirationLabel, statusLabel: rows[0]!.statusLabel, tags: rows[0]!.tags, meta: availableMeta };

export const assetListFixtureModels = {
  loading: { state: "loading" },
  empty: { state: "empty", meta: availableMeta },
  unavailable: { state: "unavailable", meta: unavailableMeta, reason: "Synthetic fixture: local QA observation is unavailable." },
  error: { state: "error", code: "invalid-projection" },
  ready: { state: "ready", meta: availableMeta, data: listData },
  stale: { state: "stale", meta: staleMeta, data: listData },
  uncertain: { state: "uncertain", meta: uncertainMeta, data: listData },
} as const satisfies Readonly<Record<string, PortfolioReadState<PortfolioListData>>>;

export const assetDetailFixtureModels = {
  loading: { state: "loading" },
  unavailable: { state: "unavailable", meta: unavailableMeta, reason: "Synthetic fixture: detail observation is unavailable." },
  error: { state: "error", code: "read-failed" },
  ready: { state: "ready", meta: availableMeta, data: detailData },
  stale: { state: "stale", meta: staleMeta, data: { ...detailData, meta: staleMeta } },
  uncertain: { state: "uncertain", meta: uncertainMeta, data: { ...detailData, meta: uncertainMeta } },
} as const satisfies Readonly<Record<string, PortfolioReadState<PortfolioDetailData>>>;

export const activationFixtureModels = {
  pending: { state: "pending", submitted: true },
  accepted: { state: "accepted", workspace: { kind: "personal-default", label: "Synthetic personal workspace · local QA" } },
  rejected: { state: "rejected", code: "temporarily-unavailable", retryable: true },
} as const satisfies Readonly<Record<string, ActivationPresentation>>;

export const connectionFixtureModels = {
  loading: { state: "loading" },
  "not-configured": { state: "not-configured", manualGuidance: "Synthetic fixture: configure Cloudflare outside this read-only QA surface." },
  checking: { state: "checking", connectionLabel: "Fixture Cloudflare connection" },
  available: { state: "available", connectionLabel: "Fixture Cloudflare connection", zoneName: "northstar.example", observedAt, version: 42, uncertainty: "confirmed" },
  stale: { state: "stale", connectionLabel: "Fixture Cloudflare connection", zoneName: "northstar.example", observedAt, version: 41 },
  uncertain: { state: "uncertain", connectionLabel: "Fixture Cloudflare connection", zoneName: null, observedAt: null, version: null },
  unavailable: { state: "unavailable", code: "temporarily-unavailable", retryAfterSeconds: 60, manualGuidance: "Synthetic fixture: retry the read or inspect Cloudflare manually." },
  error: { state: "error", code: "invalid-projection", manualGuidance: "Synthetic fixture: the sanitized observation could not be displayed." },
} as const satisfies Readonly<Record<string, CloudflareConnectionState>>;

const dnsMeta = { source: "cloudflare-zone-dns", observedAt, version: 42, availability: "available", uncertainty: "confirmed" } as const;
const dnsData = {
  zoneId: "fixture-zone-001",
  zoneLabel: "northstar.example",
  zoneStatus: "active",
  records: [
    { recordId: "fixture-record-a", fqdn: "northstar.example", type: "A", displayValue: "192.0.2.24", ttl: 300, proxied: true, providerVersionToken: 42, classification: "ordinary" },
    { recordId: "fixture-record-txt", fqdn: "_qa.northstar.example", type: "TXT", displayValue: "[sanitized TXT fixture value]", ttl: 300, proxied: false, providerVersionToken: 42, classification: "redacted" },
  ],
} as const;

export const dnsFixtureModels = {
  loading: { state: "loading" },
  empty: { state: "empty", meta: dnsMeta, manualGuidance: "Synthetic fixture: no observed DNS records." },
  available: { state: "available", meta: dnsMeta, data: dnsData },
  stale: { state: "stale", meta: { ...dnsMeta, version: 41, uncertainty: "stale" }, data: dnsData },
  uncertain: { state: "uncertain", meta: { ...dnsMeta, uncertainty: "conflicted" }, data: dnsData, manualGuidance: "Synthetic fixture: observations conflict; inspect manually." },
  unavailable: { state: "unavailable", code: "permission", retryAfterSeconds: null, manualGuidance: "Synthetic fixture: the read observation is unavailable." },
  error: { state: "error", code: "invalid-projection", manualGuidance: "Synthetic fixture: the sanitized DNS projection is invalid." },
} as const satisfies Readonly<Record<string, ZoneDnsObservationState>>;

function fixtureModel<T>(models: Readonly<Record<string, T>>, state: string, presentation: string): T {
  const model = models[state];
  if (model === undefined) throw new TypeError(`Unknown ${presentation} fixture state: ${state}`);
  return model;
}

function surface(children: ReactNode) {
  return <div className="gd-fixture-production-surface">{children}</div>;
}

const shellBanners: Readonly<Record<string, DesktopShellBanner | undefined>> = {
  default: undefined,
  unavailable: { tone: "warning", title: "Synthetic fixture · observation unavailable", description: "Local QA layout only. No product availability is implied." },
  uncertain: { tone: "neutral", title: "Synthetic fixture · observation uncertain", description: "Review provenance and observed time before relying on this local QA state." },
};

export const dUiV1Registrations: readonly PresentationFixtureRegistration[] = [
  {
    presentation: "shell",
    render: ({ fixtureCase, onFixtureIntent }) => {
      if (!(fixtureCase.state in shellBanners)) throw new TypeError(`Unknown shell fixture state: ${fixtureCase.state}`);
      const banner = shellBanners[fixtureCase.state];
      return <DesktopShell locale={fixtureCase.locale} title="Synthetic asset observation · local QA" activeRouteId="portfolio.list" eligibleRouteIds={["portfolio.list", "portfolio.detail", "dns.health", "settings"]} {...(banner === undefined ? {} : { banner })} onRouteSelect={(routeId) => onFixtureIntent(`fixture:navigate:${routeId}`)}><AssetLibrary locale={fixtureCase.locale} presentation={assetListFixtureModels.ready} onOpenAsset={(entityId) => onFixtureIntent(`fixture:open:${entityId}`)} /></DesktopShell>;
    },
  },
  {
    presentation: "activation",
    render: ({ fixtureCase, onFixtureIntent }) => surface(<ActivationWizard locale={fixtureCase.locale} presentation={fixtureModel(activationFixtureModels, fixtureCase.state, "activation")} actions={{ onRetry: () => onFixtureIntent("fixture:retry-activation"), onContinue: () => onFixtureIntent("fixture:continue") }} />),
  },
  {
    presentation: "asset-list",
    render: ({ fixtureCase, onFixtureIntent }) => surface(<AssetLibrary locale={fixtureCase.locale} presentation={fixtureModel(assetListFixtureModels, fixtureCase.state, "asset list")} onOpenAsset={(entityId) => onFixtureIntent(`fixture:open:${entityId}`)} onQueryChange={(query) => onFixtureIntent(`fixture:query:${query}`)} onWindowChange={({ startIndex, size }) => onFixtureIntent(`fixture:window:${startIndex}:${size}`)} />),
  },
  {
    presentation: "asset-detail",
    render: ({ fixtureCase, onFixtureIntent }) => surface(<DomainDetail locale={fixtureCase.locale} presentation={fixtureModel(assetDetailFixtureModels, fixtureCase.state, "asset detail")} onBack={() => onFixtureIntent("fixture:back")} />),
  },
  {
    presentation: "cloudflare-connection",
    render: ({ fixtureCase, onFixtureIntent }) => surface(<CloudflareConnectionPresentation locale={fixtureCase.locale} presentation={fixtureModel(connectionFixtureModels, fixtureCase.state, "Cloudflare connection")} onRetryRead={() => onFixtureIntent("fixture:retry-cloudflare-read")} />),
  },
  {
    presentation: "zone-dns-observation",
    render: ({ fixtureCase, onFixtureIntent }) => surface(<ZoneDnsObservationPresentation locale={fixtureCase.locale} presentation={fixtureModel(dnsFixtureModels, fixtureCase.state, "Zone DNS observation")} actions={{ onQueryChange: (query) => onFixtureIntent(`fixture:dns-query:${query}`), onRecordFilterChange: (filter) => onFixtureIntent(`fixture:dns-filter:${filter}`), onRetryRead: () => onFixtureIntent("fixture:retry-dns-read") }} />),
  },
];
