import { historyEntryLimit, parseAssetLibraryQuery, projectManualTaskInbox, type ManualTasksRead, projectBatchOperationList, projectOperationHistory, type HistoryRead, projectConnectionSettings, projectDnsHealthViewModel, projectRenewalDeskViewModel, projectSalesDeskViewModel, type RenewalsRead, type AssetLibraryViewModel, type ConnectionSettingsViewModel, type SettingsStorageIntegrity, type CanonicalDomainName, type ConflictResolutionChoice, type DomainDetailViewModel, type SettingsConnection } from "@gooddealer/client-core";
import { getCapabilityCopy, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { AlertTriangleIcon, Banner, Button, CoinsIcon, GlobeIcon, HistoryIcon, InboxIcon, ListChecksIcon, SettingsIcon, ShieldIcon } from "@gooddealer/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DesktopShell, type DesktopShellStatus, type ShellNavigationSection, type ShellWindowFrame } from "../app-shell";
import { AssetLibrary, DomainDetail, type AssetLibraryPresentation, type DomainDetailPresentation } from "../features/portfolio";
import { DnsVerification } from "../features/dns";
import { SalesDesk } from "../features/marketplace";
import { BatchList } from "../features/operations/batch-operations";
import { ManualTaskInbox } from "../features/operations/manual-tasks";
import { OperationHistory } from "../features/operations/operation-history";
import { RenewalDesk, type RenewalListView } from "../features/registration";
import { CloudflareRetirementPanel, cloudflareNoticeCopyKey, readCloudflareNotice } from "../features/connections";
import { SettingsPanel } from "../features/settings";
import { ConflictCenter } from "../features/sync/conflict-center";
import { createAppRoute, type AppRoute, type AppRouteId } from "./app-route";
import type { DesktopPresentation } from "./desktop-presentation";
import { DesktopRouter } from "./desktop-router";
import { recoverHostPage, useHostRouteRead, type HostPage, type HostRouteReadState } from "./host-route-read";
import { useLocalHistoryDay } from "./local-history-day";
import { HostRouteStatus, type HostRouteStatusCopy } from "./host-route-status";
import {
  addDomainAsset,
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
  /**
   * Re-enters onboarding, where Cloudflare is connected or revoked under the Host's gates. Settings
   * offers it only while the presentation is writable; the app root checks again before entering.
   */
  readonly onRunOnboarding?: () => void;
}

const windowSize = 25;

/**
 * Production workspace: the shell, rail, and the routes whose Host reads exist. Write affordances
 * are passed only when the adjudicated presentation is writable, so a read-only surface cannot
 * reach a mutation even if a feature would otherwise render the control.
 */
export function WorkspaceView({ locale, presentation, ports, windowFrame, onPublication, onRefresh, onLocaleChange, onRunOnboarding }: WorkspaceViewProps) {
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
              readGeneration={publication.status.readGeneration}
              writable={readOnly === null}
              onOpenAsset={(domainId) => setRoute({ id: "portfolio.detail", domainId })}
              onRenew={surface.availableRouteIds.includes("renewals.desk") ? () => setRoute(createAppRoute("renewals.desk")) : undefined}
              onPublication={onPublication}
              onFailure={reportFailure}
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
              writable={readOnly === null}
              onStale={onRefresh}
              onPublication={onPublication}
              onFailure={reportFailure}
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
              writable={readOnly === null}
              revisionBase={publication.sync?.appliedThroughServerRevision ?? null}
              onLocaleChange={onLocaleChange}
              {...(readOnly === null && onRunOnboarding !== undefined ? { onRunOnboarding } : {})}
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
  | { readonly kind: "ready"; readonly connections: ConnectionSettingsViewModel; readonly storageIntegrity: SettingsStorageIntegrity }
  | { readonly kind: "failed" };

/**
 * Settings from the Host projection. Role qualification remains authoritative; refused custody
 * has a separate Host-issued maintenance target, offered only when writable. Devices, license,
 * pull cadence and build facts have no Host source yet, so
 * the panel shows those as unavailable instead of placeholder values.
 */
function SettingsRoute({ locale, ports, revisionBase, writable, onLocaleChange, onRunOnboarding }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly revisionBase: number | null;
  readonly writable: boolean;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly onRunOnboarding?: () => void;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const [state, setState] = useState<SettingsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((current) => current.kind === "ready" ? current : { kind: "loading" });
    // The Cloudflare reason comes from its own Host status; an unreadable status says only that.
    Promise.all([ports.settings.loadSettings(), readCloudflareNotice(ports.cloudflare)])
      .then(([read, cloudflare]) => {
        const summary = (connection: SettingsConnection) => connection.providerKind === "cloudflare" ? copy[cloudflareNoticeCopyKey[cloudflare.notice]] : copy.capabilityPendingSummary;
        if (!cancelled) setState({ kind: "ready", connections: projectConnectionSettings(read, summary), storageIntegrity: read.storageIntegrity });
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
      connectionMaintenance={writable ? <CloudflareRetirementPanel locale={locale} port={ports.cloudflare} onChanged={() => setAttempt((current) => current + 1)} /> : null}
      devices={null}
      license="unavailable"
      sync={null}
      about={{ version: null, dataDirectory: null, revisionBase, storageIntegrity: state.storageIntegrity }}
      onLocaleChange={onLocaleChange}
      {...(onRunOnboarding === undefined ? {} : { onRunOnboarding })}
    />
  );
}

const hostWindowSize = 200;

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
  const { state, retry } = useHostRouteRead(
    ports.batches, (port, request) => port.loadBatchOperations(request), readGeneration, onStale,
    projectBatchOperationList, { windowSize: hostWindowSize },
  );
  if (state.kind === "ready") return <BatchList locale={locale} jobs={state.value.items} creationAvailability={state.value.creationAvailability} />;
  return <HostRouteStatus state={state} copy={copy} onRetry={retry} />;
}

const keepWindows = <T,>(windows: readonly T[]): readonly T[] => windows;

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
  const [selected, setSelected] = useState<string | null>(null);
  const { state, retry } = useHostRouteRead(
    ports.manualTasks, (port, request) => port.loadManualTasks(request), readGeneration, onStale,
    keepWindows<ManualTasksRead>, { windowSize: hostWindowSize },
  );

  const view = useMemo(() => {
    if (state.kind !== "ready") return null;
    try {
      return projectManualTaskInbox(state.value, {
        reason: (platform, capability) => (platform === null ? copy.manualReasonUnbound : copy.manualReason.replace("{platform}", platform)).replace("{capability}", capability),
        completionCondition: copy.completionByObservation,
        noPlatform: copy.noPlatform,
        noAccount: "—",
      }, selected);
    } catch {
      return null;
    }
  }, [state, copy, selected]);

  if (view !== null) return <ManualTaskInbox locale={locale} view={view} onSelect={setSelected} />;
  return <HostRouteStatus state={state.kind === "loading" ? state : { kind: "failed" }} copy={copy} onRetry={retry} />;
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
  const [selected, setSelected] = useState<string | null>(null);
  // Every window of one read asks for the same local day, and the read restarts with the next day
  // when this one ends, so "changes today" never mixes two days or keeps counting yesterday.
  const today = useLocalHistoryDay();
  const { state, retry } = useHostRouteRead(
    ports.history, (port, request) => port.loadHistory({ ...request, ...today }), readGeneration, onStale,
    keepWindows<HistoryRead>, { windowSize: hostWindowSize, rowLimit: historyEntryLimit, restartKey: today.todayFrom },
  );

  const view = useMemo(() => {
    if (state.kind !== "ready") return null;
    try {
      return projectOperationHistory(state.value, {
        create: copy.createAsset,
        edit: copy.editAsset,
        delete: copy.deleteAsset,
        actor: copy.localWorkspace,
        platform: copy.assetLibrary,
        empty: copy.emptyValue,
        fields: { note: copy.fieldNote, portfolioId: copy.fieldPortfolio, tags: copy.fieldTags, targetPrice: copy.fieldTargetPrice },
      }, selected);
    } catch {
      return null;
    }
  }, [state, copy, selected]);

  if (view !== null) return <OperationHistory locale={locale} view={view} onSelect={setSelected} />;
  return <HostRouteStatus state={state.kind === "loading" ? state : { kind: "failed" }} copy={copy} onRetry={retry} />;
}

function projectRenewalList(windows: readonly RenewalsRead[], pageSize: number): RenewalListView {
  const view = projectRenewalDeskViewModel(windows, pageSize);
  if (view.state !== "list") throw new TypeError("renewals project to the list state");
  return view;
}

/** Rows per renewal page until the person picks another size; within the Host's 200-row window. */
const renewalPageSize = 50;

/**
 * Reads one renewal page for one Host generation; the Host reports whole-desk counts with it, so
 * the desk never reads every window. The desk gets no selection, term, auto-renew or plan
 * callbacks: renewal quotes and registrar writes need capabilities that are not qualified yet, so
 * the plan is reported unavailable.
 */
function RenewalsRoute({ locale, ports, readGeneration, onStale, onBack }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly onStale: () => void;
  readonly onBack: () => void;
}) {
  const copy = getPresentationCopy(locale, "renewalDesk");
  const [page, setPage] = useState({ startIndex: 0, size: renewalPageSize });
  const { state, retry } = useHostRouteRead(
    ports.renewals, (port, request) => port.loadRenewals(request), readGeneration, onStale,
    (windows) => projectRenewalList(windows, page.size), { windowSize: page.size, startIndex: page.startIndex, rowLimit: page.size },
  );
  const outcome = state.kind === "ready" ? { kind: "ready" as const, totalItems: state.value.page?.totalItems ?? 0 } : state;
  const recovered = recoverHostPage(page, outcome);
  useEffect(() => {
    if (recovered !== null) setPage(recovered);
  }, [recovered?.startIndex, recovered?.size]);
  // Another page keeps the desk mounted on the last page, marked busy, until it arrives.
  const shown = state.kind === "ready" ? state.value : state.previous;
  if (shown !== undefined) {
    return withReadFailure(state, copy, retry, <RenewalDesk locale={locale} view={shown} busy={state.kind === "loading"} onBack={onBack} onPageChange={(startIndex, size) => changeHostPage(state, page, { startIndex, size }, setPage, retry)} />);
  }
  return <HostRouteStatus state={state} copy={copy} onRetry={retry} />;
}

/**
 * A paged desk showing its last result. When the latest page, search or retry failed, the failure is
 * reported above that result instead of replacing it, so the desk and its search box stay mounted;
 * the stale rows sit under the failure, which says they are stale, until a retry or another read
 * succeeds.
 */
function withReadFailure(state: HostRouteReadState<unknown>, copy: HostRouteStatusCopy & { readonly staleResult: string }, retry: () => void, desk: ReactNode) {
  // The same element shape in every state, so reporting a failure never remounts the desk.
  return <>{state.kind === "failed" ? <HostRouteStatus state={state} copy={copy} onRetry={retry} staleNote={copy.staleResult} /> : null}{desk}</>;
}

/**
 * Moves a paged route to the page the person picked. After a failed read the pager shows the last
 * result, so the page that failed is not the highlighted one; picking it again would set the page
 * it already is and read nothing, so it retries instead of looking like a dead control.
 */
function changeHostPage(state: HostRouteReadState<unknown>, page: HostPage, next: HostPage, setPage: (page: HostPage) => void, retry: () => void) {
  if (state.kind === "failed" && next.startIndex === page.startIndex && next.size === page.size) retry();
  else setPage(next);
}

/** Listed domains per sales page until the person picks another size; within the Host's 200-row window. */
const salesPageSize = 50;

/**
 * Reads one page of listed domains for one Host generation; the Host merges each domain's markets
 * and reports workspace-wide metrics, so the desk never reads every window. The desk gets no action
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
  const [page, setPage] = useState({ startIndex: 0, size: salesPageSize });
  const { state, retry } = useHostRouteRead(
    ports.sales, (port, request) => port.loadSales(request), readGeneration, onStale,
    (windows) => projectSalesDeskViewModel(windows, page.size), { windowSize: page.size, startIndex: page.startIndex, rowLimit: page.size },
  );
  const outcome = state.kind === "ready" ? { kind: "ready" as const, totalItems: state.value.page?.totalItems ?? 0 } : state;
  const recovered = recoverHostPage(page, outcome);
  useEffect(() => {
    if (recovered !== null) setPage(recovered);
  }, [recovered?.startIndex, recovered?.size]);
  // Another page keeps the desk, and its tab, mounted on the last page, marked busy, until it arrives.
  const shown = state.kind === "ready" ? state.value : state.previous;
  if (shown !== undefined) {
    return withReadFailure(state, copy, retry, <SalesDesk locale={locale} view={shown} busy={state.kind === "loading"} initialTab="listings" onPageChange={(startIndex, size) => changeHostPage(state, page, { startIndex, size }, setPage, retry)} />);
  }
  return <HostRouteStatus state={state} copy={copy} onRetry={retry} />;
}

/** Rows per DNS page until the person picks another size; within the Host's 200-row window. */
const dnsPageSize = 50;

/**
 * Reads one DNS health page for one Host generation; the Host searches by domain prefix and reports
 * workspace-wide counts, so the page never reads every window. A window from a newer generation
 * means the workspace publication is stale, so the root republishes instead of stitching reads.
 */
function DnsHealthRoute({ locale, ports, readGeneration, writable, onStale, onPublication, onFailure }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly readGeneration: number;
  readonly writable: boolean;
  readonly onStale: () => void;
  readonly onPublication: (publication: AuthoritativeWorkspacePublication) => void;
  readonly onFailure: () => void;
}) {
  const copy = getPresentationCopy(locale, "dnsVerification");
  const [bindingId, setBindingId] = useState<string | null>(null);
  // Binding is a local write from Host-verified Zone evidence; the Host re-checks that evidence
  // and the read generation, and a committed bind republishes the workspace at its receipt. A
  // read-only surface is never handed the write.
  const bindProvider = writable ? ports.business.bindDomainAssetProvider : undefined;
  const bindZone = bindProvider !== undefined
    ? (row: { readonly domainAssetId: string }) => {
      if (bindingId !== null) return;
      setBindingId(row.domainAssetId);
      void bindProvider.call(ports.business, { schemaVersion: 1, expectedReadGeneration: readGeneration, entityId: row.domainAssetId as CanonicalDomainName })
        .then((receipt) => readAuthoritativeWorkspacePublication(ports, receipt.readGeneration))
        .then(onPublication, onFailure)
        .finally(() => setBindingId(null));
    }
    : undefined;
  const [page, setPage] = useState({ startIndex: 0, size: dnsPageSize });
  const [text, setText] = useState("");
  // The Host accepts the asset library's canonical prefix; other text can match no domain, so it is
  // shown as an empty result instead of being sent.
  let query: string | null;
  try { query = parseAssetLibraryQuery(text); } catch { query = null; }
  const { state, retry } = useHostRouteRead(
    ports.dns, (port, request) => port.loadDnsHealth({ ...request, query: query ?? "" }), readGeneration, onStale,
    (windows) => projectDnsHealthViewModel(windows, page.size),
    { windowSize: page.size, startIndex: page.startIndex, rowLimit: page.size, restartKey: query ?? "" },
  );
  const outcome = state.kind === "ready" ? { kind: "ready" as const, totalItems: state.value.page?.totalItems ?? 0 } : state;
  const recovered = recoverHostPage(page, outcome);
  useEffect(() => {
    if (recovered !== null) setPage(recovered);
  }, [recovered?.startIndex, recovered?.size]);
  // A search or another page keeps the page, and so the focused search box, mounted on the last
  // result, marked busy, until the Host answers.
  const shown = state.kind === "ready" ? state.value : state.previous;
  if (shown !== undefined) {
    const view = query === null ? { ...shown, rows: [], page: { startIndex: 0, size: page.size, totalItems: 0 } } : shown;
    return withReadFailure(state, copy, retry, (
      <DnsVerification
        locale={locale}
        view={view}
        busy={state.kind === "loading"}
        query={text}
        onQueryChange={(next) => { setText(next); setPage({ startIndex: 0, size: page.size }); }}
        onPageChange={(startIndex, size) => changeHostPage(state, page, { startIndex, size }, setPage, retry)}
        bindingId={bindingId}
        {...(bindZone === undefined ? {} : { onBindZone: bindZone })}
      />
    ));
  }
  return <HostRouteStatus state={state} copy={copy} onRetry={retry} />;
}

function AssetLibraryRoute({ locale, ports, initial, readGeneration, writable, onOpenAsset, onRenew, onPublication, onFailure }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly initial: AssetLibraryViewModel;
  readonly readGeneration: number;
  readonly writable: boolean;
  readonly onOpenAsset: (domainId: string) => void;
  readonly onRenew: (() => void) | undefined;
  readonly onPublication: (publication: AuthoritativeWorkspacePublication) => void;
  readonly onFailure: () => void;
}) {
  const controller = useRef(createPortfolioReadController(ports.portfolio)).current;
  const mutations = useRef(createPortfolioMutationController(ports.business)).current;
  useEffect(() => () => mutations.unmount(), [mutations]);
  // An added domain republishes the workspace at the receipt's generation, as an edit does.
  const addDomain = async (domain: CanonicalDomainName) => {
    const result = await addDomainAsset(ports.business, mutations, domain, readGeneration);
    if (result.outcome === "added") {
      void readAuthoritativeWorkspacePublication(ports, result.accepted.receipt.readGeneration).then(onPublication, onFailure);
    }
    return result.outcome;
  };
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
      {...(writable ? { onAddDomain: addDomain } : {})}
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
