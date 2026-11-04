import { historyEntryLimit, parseAssetLibraryQuery, projectManualTaskInbox, type ManualTasksRead, projectBatchOperationList, projectOperationHistory, type HistoryRead, projectConnectionSettings, type BatchOperationListViewModel, type BatchOperationsRead, projectDnsHealthViewModel, projectRenewalDeskViewModel, projectSalesDeskViewModel, type RenewalDeskViewModel, type RenewalsRead, type SalesDeskViewModel, type SalesRead, type AssetLibraryViewModel, type ConnectionSettingsViewModel, type ConflictResolutionChoice, type DnsHealthRead, type DnsVerificationViewModel, type DomainDetailViewModel } from "@gooddealer/client-core";
import { getCapabilityCopy, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { AlertTriangleIcon, Banner, Button, CoinsIcon, GlobeIcon, HistoryIcon, InboxIcon, ListChecksIcon, SettingsIcon, ShieldIcon } from "@gooddealer/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { DesktopShell, type DesktopShellStatus, type ShellNavigationSection, type ShellWindowFrame } from "../app-shell";
import { AssetLibrary, DomainDetail, type AssetLibraryPresentation, type DomainDetailPresentation } from "../features/portfolio";
import { DnsVerification } from "../features/dns";
import { SalesDesk } from "../features/marketplace";
import { BatchList } from "../features/operations/batch-operations";
import { ManualTaskInbox } from "../features/operations/manual-tasks";
import { OperationHistory } from "../features/operations/operation-history";
import { RenewalDesk, type RenewalListView } from "../features/registration";
import { SettingsPanel } from "../features/settings";
import { ConflictCenter } from "../features/sync/conflict-center";
import { createAppRoute, type AppRoute, type AppRouteId } from "./app-route";
import type { DesktopPresentation } from "./desktop-presentation";
import { DesktopRouter } from "./desktop-router";
import {
  createPortfolioMutationController,
  createPortfolioReadController,
  presentAssetLibraryRead,
  presentDomainDetailReadError,
  presentPortfolioReadError,
} from "./portfolio-controllers";
import { getAppRouteLabel } from "./route-registry";
import {
  readAuthoritativeWorkspacePublication,
  resolveConflictAndReadWorkspace,
  type AuthoritativeWorkspacePorts,
  type AuthoritativeWorkspacePublication,
} from "./workspace-publication";

type WorkspacePresentation = Extract<DesktopPresentation, { readonly view: "workspace" }>;

export interface WorkspaceViewProps {
  readonly locale: Locale;
  readonly presentation: WorkspacePresentation;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly windowFrame: ShellWindowFrame;
  /** Publishes a generation-stable workspace read; the app root owns the authoritative copy. */
  readonly onPublication: (publication: AuthoritativeWorkspacePublication) => void;
  readonly onRefresh: () => void;
  readonly onLocaleChange: (locale: Locale) => void;
}

const windowSize = 25;

/**
 * Production workspace: the shell, rail, and the routes whose Host reads exist. Write affordances
 * are passed only when the adjudicated presentation is writable, so a read-only surface cannot
 * reach a mutation even if a feature would otherwise render the control.
 */
export function WorkspaceView({ locale, presentation, ports, windowFrame, onPublication, onRefresh, onLocaleChange }: WorkspaceViewProps) {
  const shellCopy = getPresentationCopy(locale, "shell");
  const runtimeCopy = getCapabilityCopy(locale, "runtimeMode");
  const { surface, publication, readOnly } = presentation;
  const [route, setRoute] = useState<AppRoute>(createAppRoute(surface.defaultRouteId));
  const [actionFailed, setActionFailed] = useState(false);
  const pendingConflicts = publication.conflicts.conflicts.filter((item) => item.status === "pending").length;

  const navigation = useMemo((): readonly ShellNavigationSection[] => {
    const has = (id: AppRouteId) => surface.availableRouteIds.includes(id);
    const assets = [
      ...(has("portfolio.list") ? [{ id: "portfolio.list", label: shellCopy.assetLibrary, icon: <GlobeIcon /> }] : []),
      ...(has("sales.desk") ? [{ id: "sales.desk", label: shellCopy.sales, icon: <CoinsIcon /> }] : []),
      ...(has("dns.health") ? [{ id: "dns.health", label: shellCopy.dns, icon: <ShieldIcon /> }] : []),
    ];
    const execution = [
      ...(has("operations.batch") ? [{ id: "operations.batch", label: shellCopy.batches, icon: <ListChecksIcon /> }] : []),
      ...(has("sync.conflicts")
        ? [{ id: "sync.conflicts", label: shellCopy.conflicts, icon: <AlertTriangleIcon />, ...(pendingConflicts > 0 ? { count: pendingConflicts, tone: "danger" as const } : {}) }]
        : []),
      ...(has("operations.manualTasks") ? [{ id: "operations.manualTasks", label: shellCopy.manualTasks, icon: <InboxIcon /> }] : []),
      ...(has("operations.history") ? [{ id: "operations.history", label: shellCopy.history, icon: <HistoryIcon /> }] : []),
    ];
    return [
      ...(assets.length === 0 ? [] : [{ id: "assets", label: shellCopy.assets, items: assets }]),
      ...(execution.length === 0 ? [] : [{ id: "execution", label: shellCopy.execution, items: execution }]),
      ...(has("settings") ? [{ id: "preferences", placement: "end" as const, items: [{ id: "settings", label: shellCopy.settings, icon: <SettingsIcon /> }] }] : []),
    ];
  }, [surface.availableRouteIds, pendingConflicts, shellCopy]);

  const status: DesktopShellStatus = {
    sync: publication.sync,
    // The Host reports this device's role but not its name, lease epoch, license, or providers yet.
    device: { name: shellCopy.device, role: surface.kind === "standby" ? "standby" : "active" },
    peerDevice: null,
    leaseEpoch: null,
    license: null,
    providerSummary: null,
  };
  // Detail and renewals are entered from the asset library, so the rail keeps Assets active.
  const navigationId = route.id === "portfolio.detail" || route.id === "renewals.desk" ? "portfolio.list" : route.id;
  const banner = actionFailed ? <Banner tone="danger" title={shellCopy.actionFailed} />
    : readOnly === "standby" ? <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner>
      : readOnly === "commercial" ? <Banner tone="warning" title={runtimeCopy.commercialReadOnlyTitle}>{runtimeCopy.commercialReadOnlyNotice}</Banner>
        : undefined;
  const reportFailure = () => { setActionFailed(true); onRefresh(); };

  return (
    <DesktopShell
      locale={locale}
      title={getAppRouteLabel(locale, route.id)}
      navigation={navigation}
      activeNavigationId={navigationId}
      onNavigate={(id) => { setActionFailed(false); if (id === "portfolio.list" || id === "sales.desk" || id === "dns.health" || id === "operations.batch" || id === "operations.manualTasks" || id === "operations.history" || id === "sync.conflicts" || id === "settings") setRoute(createAppRoute(id)); }}
      status={status}
      windowFrame={windowFrame}
      onRefresh={() => { setActionFailed(false); onRefresh(); }}
      {...(banner === undefined ? {} : { banner })}
    >
      <DesktopRouter
        surface={surface}
        requestedRoute={route}
        renderUnavailable={() => null}
        routeRenderers={{
          "portfolio.list": () => (
            <AssetLibraryRoute
              locale={locale}
              ports={ports}
              initial={publication.portfolio}
              onOpenAsset={(domainId) => setRoute({ id: "portfolio.detail", domainId })}
              onRenew={surface.availableRouteIds.includes("renewals.desk") ? () => setRoute(createAppRoute("renewals.desk")) : undefined}
            />
          ),
          "portfolio.detail": (current) => current.id !== "portfolio.detail" ? null : (
            <DomainDetailRoute
              key={current.domainId}
              locale={locale}
              ports={ports}
              entityId={current.domainId}
              readGeneration={publication.status.readGeneration}
              writable={readOnly === null}
              onBack={() => setRoute(createAppRoute("portfolio.list"))}
              onOpenConflicts={surface.availableRouteIds.includes("sync.conflicts") ? () => setRoute(createAppRoute("sync.conflicts")) : undefined}
              onPublication={onPublication}
              onFailure={reportFailure}
            />
          ),
          "renewals.desk": () => (
            <RenewalsRoute
              locale={locale}
              ports={ports}
              readGeneration={publication.status.readGeneration}
              onStale={onRefresh}
              onBack={() => setRoute(createAppRoute("portfolio.list"))}
            />
          ),
          "sales.desk": () => (
            <SalesRoute
              locale={locale}
              ports={ports}
              readGeneration={publication.status.readGeneration}
              onStale={onRefresh}
            />
          ),
          "dns.health": () => (
            <DnsHealthRoute
              locale={locale}
              ports={ports}
              readGeneration={publication.status.readGeneration}
              onStale={onRefresh}
            />
          ),
          "operations.batch": () => (
            <BatchRoute
              locale={locale}
              ports={ports}
              readGeneration={publication.status.readGeneration}
              onStale={onRefresh}
            />
          ),
          "operations.manualTasks": () => (
            <ManualTasksRoute
              locale={locale}
              ports={ports}
              readGeneration={publication.status.readGeneration}
              onStale={onRefresh}
            />
          ),
          "operations.history": () => (
            <HistoryRoute
              locale={locale}
              ports={ports}
              readGeneration={publication.status.readGeneration}
              onStale={onRefresh}
            />
          ),
          settings: () => (
            <SettingsRoute
              locale={locale}
              ports={ports}
              revisionBase={publication.sync?.appliedThroughServerRevision ?? null}
              onLocaleChange={onLocaleChange}
            />
          ),
          "sync.conflicts": () => (
            <ConflictsRoute
              locale={locale}
              ports={ports}
              publication={publication}
              writable={readOnly === null}
              onPublication={onPublication}
              onFailure={reportFailure}
            />
          ),
        }}
      />
    </DesktopShell>
  );
}

type SettingsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly connections: ConnectionSettingsViewModel }
  | { readonly kind: "failed" };

/**
 * Settings from the Host projection. Connections carry no action and every role shows as
 * unavailable until qualified; devices, license, pull cadence and build facts have no Host source
 * yet, so the panel shows those as unavailable instead of placeholder values.
 */
function SettingsRoute({ locale, ports, revisionBase, onLocaleChange }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly revisionBase: number | null;
  readonly onLocaleChange: (locale: Locale) => void;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const [state, setState] = useState<SettingsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    ports.settings.loadSettings()
      .then((read) => {
        if (!cancelled) setState({ kind: "ready", connections: projectConnectionSettings(read, () => copy.capabilityPendingSummary) });
      })
      .catch(() => { if (!cancelled) setState({ kind: "failed" }); });
    return () => { cancelled = true; };
  }, [ports, attempt, copy]);

  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  if (state.kind === "failed") {
    return (
      <Banner tone="danger" title={copy.loadFailed}>
        <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>{copy.retryRead}</Button>
      </Banner>
    );
  }
  return (
    <SettingsPanel
      locale={locale}
      initialSection="connections"
      connections={state.connections}
      devices={null}
      license="unavailable"
      sync={null}
      about={{ version: null, dataDirectory: null, revisionBase }}
      onLocaleChange={onLocaleChange}
    />
  );
}

const batchWindowSize = 200;

type BatchState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: BatchOperationListViewModel }
  | { readonly kind: "failed" };

/**
 * Reads every batch window for one Host generation. Rows do not open: the Host has no plan detail
 * read yet, and generating, approving or running a plan needs operation capabilities that are not
 * qualified, so the list reports creation as unavailable.
 */
function BatchRoute({ locale, ports, readGeneration, onStale }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly onStale: () => void;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [state, setState] = useState<BatchState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const windows: BatchOperationsRead[] = [];
        let next = 0;
        do {
          const window = await ports.batches.loadBatchOperations({ startIndex: next, size: batchWindowSize });
          if (window.readGeneration !== readGeneration) {
            if (!cancelled) staleRef.current();
            return;
          }
          windows.push(window);
          next += window.window.rows.length;
          if (window.window.rows.length === 0) break;
        } while (next < (windows[0]?.totalRows ?? 0));
        const view = projectBatchOperationList(windows);
        if (!cancelled) setState({ kind: "ready", view });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => { cancelled = true; };
  }, [ports, readGeneration, attempt]);

  if (state.kind === "ready") return <BatchList locale={locale} jobs={state.view.items} creationAvailability={state.view.creationAvailability} />;
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>{copy.retryRead}</Button>
    </Banner>
  );
}

const manualTasksWindowSize = 200;

type ManualTasksState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly windows: readonly ManualTasksRead[] }
  | { readonly kind: "failed" };

/**
 * Reads every manual task window for one Host generation. The inbox gets no action or risk
 * callback: opening the platform, reporting completion and re-checking need qualified Host
 * capabilities, and the person completes the step in the platform's own console.
 */
function ManualTasksRoute({ locale, ports, readGeneration, onStale }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly onStale: () => void;
}) {
  const copy = getPresentationCopy(locale, "manualTaskInbox");
  const [state, setState] = useState<ManualTasksState>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const windows: ManualTasksRead[] = [];
        let next = 0;
        do {
          const window = await ports.manualTasks.loadManualTasks({ startIndex: next, size: manualTasksWindowSize });
          if (window.readGeneration !== readGeneration) {
            if (!cancelled) staleRef.current();
            return;
          }
          windows.push(window);
          next += window.window.rows.length;
          if (window.window.rows.length === 0) break;
        } while (next < (windows[0]?.totalRows ?? 0));
        if (!cancelled) setState({ kind: "ready", windows });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => { cancelled = true; };
  }, [ports, readGeneration, attempt]);

  const view = useMemo(() => {
    if (state.kind !== "ready") return null;
    try {
      return projectManualTaskInbox(state.windows, {
        reason: (platform, capability) => copy.manualReason.replace("{platform}", platform).replace("{capability}", capability),
        completionCondition: copy.completionByObservation,
        noPlatform: copy.noPlatform,
        noAccount: "—",
      }, selected);
    } catch {
      return null;
    }
  }, [state, copy, selected]);

  if (view !== null) return <ManualTaskInbox locale={locale} view={view} onSelect={setSelected} />;
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>{copy.retryRead}</Button>
    </Banner>
  );
}

const historyWindowSize = 200;

type HistoryState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly windows: readonly HistoryRead[] }
  | { readonly kind: "failed" };

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Reads the newest history windows for one Host generation, up to the view's entry limit. The
 * ledger gets no reversal or export callback: rollback needs a qualified Host command and export
 * has no Host source, so every Revision is read-only.
 */
function HistoryRoute({ locale, ports, readGeneration, onStale }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly onStale: () => void;
}) {
  const copy = getPresentationCopy(locale, "operationHistory");
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const windows: HistoryRead[] = [];
        let next = 0;
        do {
          const window = await ports.history.loadHistory({ startIndex: next, size: historyWindowSize });
          if (window.readGeneration !== readGeneration) {
            if (!cancelled) staleRef.current();
            return;
          }
          windows.push(window);
          next += window.window.rows.length;
          if (window.window.rows.length === 0) break;
        } while (next < Math.min(windows[0]?.totalRows ?? 0, historyEntryLimit));
        if (!cancelled) setState({ kind: "ready", windows });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => { cancelled = true; };
  }, [ports, readGeneration, attempt]);

  const view = useMemo(() => {
    if (state.kind !== "ready") return null;
    const today = localIsoDate(new Date());
    try {
      return projectOperationHistory(state.windows, {
        edit: copy.editAsset,
        delete: copy.deleteAsset,
        actor: copy.localWorkspace,
        platform: copy.assetLibrary,
        empty: copy.emptyValue,
        fields: { note: copy.fieldNote, portfolioId: copy.fieldPortfolio, tags: copy.fieldTags, targetPrice: copy.fieldTargetPrice },
      }, (committedAt) => localIsoDate(new Date(committedAt)) === today, selected);
    } catch {
      return null;
    }
  }, [state, copy, selected]);

  if (view !== null) return <OperationHistory locale={locale} view={view} onSelect={setSelected} />;
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>{copy.retryRead}</Button>
    </Banner>
  );
}

const renewalsWindowSize = 200;

type RenewalsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: RenewalListView }
  | { readonly kind: "failed" };

function isRenewalList(view: RenewalDeskViewModel): view is RenewalListView {
  return view.state === "list";
}

/**
 * Reads every renewal window for one Host generation, like sales. The desk gets no selection,
 * term, auto-renew or plan callbacks: renewal quotes and registrar writes need capabilities that
 * are not qualified yet, so the plan is reported unavailable.
 */
function RenewalsRoute({ locale, ports, readGeneration, onStale, onBack }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly onStale: () => void;
  readonly onBack: () => void;
}) {
  const copy = getPresentationCopy(locale, "renewalDesk");
  const [state, setState] = useState<RenewalsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const windows: RenewalsRead[] = [];
        let next = 0;
        do {
          const window = await ports.renewals.loadRenewals({ startIndex: next, size: renewalsWindowSize });
          if (window.readGeneration !== readGeneration) {
            if (!cancelled) staleRef.current();
            return;
          }
          windows.push(window);
          next += window.window.rows.length;
          if (window.window.rows.length === 0) break;
        } while (next < (windows[0]?.totalRows ?? 0));
        const view = projectRenewalDeskViewModel(windows);
        if (!isRenewalList(view)) throw new TypeError("renewals project to the list state");
        if (!cancelled) setState({ kind: "ready", view });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => { cancelled = true; };
  }, [ports, readGeneration, attempt]);

  if (state.kind === "ready") return <RenewalDesk locale={locale} view={state.view} onBack={onBack} />;
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>{copy.retryRead}</Button>
    </Banner>
  );
}

const salesWindowSize = 200;

type SalesState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: SalesDeskViewModel }
  | { readonly kind: "failed" };

/**
 * Reads every sales window for one Host generation, like DNS health. The desk gets no action
 * callbacks: listing, offer and transfer writes need marketplace capabilities that are not
 * qualified, and the projection grants none.
 */
function SalesRoute({ locale, ports, readGeneration, onStale }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly onStale: () => void;
}) {
  const copy = getPresentationCopy(locale, "salesDesk");
  const [state, setState] = useState<SalesState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const windows: SalesRead[] = [];
        let next = 0;
        do {
          const window = await ports.sales.loadSales({ startIndex: next, size: salesWindowSize });
          if (window.readGeneration !== readGeneration) {
            if (!cancelled) staleRef.current();
            return;
          }
          windows.push(window);
          next += window.window.rows.length;
          if (window.window.rows.length === 0) break;
        } while (next < (windows[0]?.totalRows ?? 0));
        const view = projectSalesDeskViewModel(windows);
        if (!cancelled) setState({ kind: "ready", view });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => { cancelled = true; };
  }, [ports, readGeneration, attempt]);

  if (state.kind === "ready") return <SalesDesk locale={locale} view={state.view} initialTab="listings" />;
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>{copy.retryRead}</Button>
    </Banner>
  );
}

const dnsWindowSize = 200;

type DnsHealthState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: DnsVerificationViewModel }
  | { readonly kind: "failed" };

/**
 * Reads every DNS health window for one Host generation. A window from a newer generation means the
 * workspace publication is stale, so the root republishes instead of stitching mixed reads.
 */
function DnsHealthRoute({ locale, ports, readGeneration, onStale }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly onStale: () => void;
}) {
  const copy = getPresentationCopy(locale, "dnsVerification");
  const [state, setState] = useState<DnsHealthState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const staleRef = useRef(onStale);
  staleRef.current = onStale;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const windows: DnsHealthRead[] = [];
        let next = 0;
        do {
          const window = await ports.dns.loadDnsHealth({ startIndex: next, size: dnsWindowSize });
          if (window.readGeneration !== readGeneration) {
            if (!cancelled) staleRef.current();
            return;
          }
          windows.push(window);
          next += window.window.rows.length;
          if (window.window.rows.length === 0) break;
        } while (next < (windows[0]?.totalRows ?? 0));
        const view = projectDnsHealthViewModel(windows);
        if (!cancelled) setState({ kind: "ready", view });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => { cancelled = true; };
  }, [ports, readGeneration, attempt]);

  if (state.kind === "ready") return <DnsVerification locale={locale} view={state.view} />;
  if (state.kind === "loading") return <p className="gd-t-meta">{copy.loading}</p>;
  return (
    <Banner tone="danger" title={copy.loadFailed}>
      <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>{copy.retryRead}</Button>
    </Banner>
  );
}

function AssetLibraryRoute({ locale, ports, initial, onOpenAsset, onRenew }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly initial: AssetLibraryViewModel;
  readonly onOpenAsset: (domainId: string) => void;
  readonly onRenew: (() => void) | undefined;
}) {
  const controller = useRef(createPortfolioReadController(ports.portfolio)).current;
  const [query, setQuery] = useState("");
  const [presentation, setPresentation] = useState<AssetLibraryPresentation>(presentAssetLibraryRead(initial));
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const current = presentation.state === "ready" ? presentation.data : null;

  // A newer Host generation replaces the first window; any in-flight read for the old one is dropped.
  useEffect(() => {
    controller.acceptHostGeneration(initial.readGeneration);
    setQuery("");
    setPresentation(presentAssetLibraryRead(initial));
  }, [controller, initial]);
  useEffect(() => () => controller.unmount(), [controller]);

  const load = (startIndex: number, size: number, nextQuery: string) => {
    let normalized: string;
    try { normalized = parseAssetLibraryQuery(nextQuery); }
    catch { setPresentation({ state: "invalid-query", data: current }); return; }
    void controller.loadAssetLibrary(
      { startIndex, size, query: normalized },
      (value) => setPresentation(presentAssetLibraryRead(value)),
      (error) => setPresentation(presentPortfolioReadError(error, current)),
    );
  };

  return (
    <AssetLibrary
      locale={locale}
      presentation={presentation}
      query={query}
      onQueryChange={(next) => { setQuery(next); load(0, windowSize, next); }}
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
      onWindowChange={(startIndex, size) => load(startIndex, size, query)}
      onOpenAsset={onOpenAsset}
      {...(onRenew === undefined ? {} : { onRenew })}
    />
  );
}

function DomainDetailRoute({ locale, ports, entityId, readGeneration, writable, onBack, onOpenConflicts, onPublication, onFailure }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly entityId: string;
  readonly readGeneration: number;
  readonly writable: boolean;
  readonly onBack: () => void;
  readonly onOpenConflicts: (() => void) | undefined;
  readonly onPublication: (publication: AuthoritativeWorkspacePublication) => void;
  readonly onFailure: () => void;
}) {
  const reader = useRef(createPortfolioReadController(ports.portfolio)).current;
  const mutations = useRef(createPortfolioMutationController(ports.business)).current;
  const [presentation, setPresentation] = useState<DomainDetailPresentation>({ state: "loading" });

  useEffect(() => {
    reader.acceptHostGeneration(readGeneration);
    void reader.loadDomainDetail(
      entityId,
      (value) => setPresentation({ state: "ready", data: value }),
      (error) => setPresentation(presentDomainDetailReadError(error)),
    );
  }, [reader, entityId, readGeneration]);
  useEffect(() => () => { reader.unmount(); mutations.unmount(); }, [reader, mutations]);

  const detail: DomainDetailViewModel | null = presentation.state === "ready" ? presentation.data : null;
  // An edit restates every editable field, so it is offered only when the detail carries the
  // current currency; it never guesses one for an unpriced asset.
  const commitTargetPrice = writable && detail !== null && detail.asset.targetPrice !== null
    ? (amount: string) => {
      const asset = detail.asset;
      const currency = asset.targetPrice?.currency;
      if (currency === undefined) return;
      void mutations.execute(
        `edit:${asset.id}`,
        detail.readGeneration,
        async () => ports.business.editDomainAsset({
          mutationId: crypto.randomUUID(),
          expectedReadGeneration: detail.readGeneration,
          expectedAssetVersion: asset.assetVersion,
          asset: { entityId: asset.id, note: asset.note, portfolioId: asset.portfolioId, tags: [...asset.tags], targetPrice: { currency, amount } },
        }),
        ({ receipt }) => {
          void readAuthoritativeWorkspacePublication(ports, receipt.readGeneration).then(onPublication, onFailure);
        },
        onFailure,
      );
    }
    : undefined;

  return (
    <DomainDetail
      locale={locale}
      presentation={presentation}
      onBack={onBack}
      {...(commitTargetPrice === undefined ? {} : { onTargetPriceCommit: commitTargetPrice })}
      {...(onOpenConflicts === undefined ? {} : { onOpenConflicts })}
    />
  );
}

function ConflictsRoute({ locale, ports, publication, writable, onPublication, onFailure }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly publication: WorkspacePresentation["publication"];
  readonly writable: boolean;
  readonly onPublication: (publication: AuthoritativeWorkspacePublication) => void;
  readonly onFailure: () => void;
}) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const resolve = (candidateId: string, choice: ConflictResolutionChoice) => {
    if (resolvingId !== null) return;
    setResolvingId(candidateId);
    void resolveConflictAndReadWorkspace(publication.conflicts, candidateId, choice, ports)
      .then(onPublication, onFailure)
      .finally(() => setResolvingId(null));
  };
  return (
    <ConflictCenter
      locale={locale}
      view={publication.conflicts}
      resolvingId={resolvingId}
      {...(writable ? { onResolve: resolve } : {})}
    />
  );
}
