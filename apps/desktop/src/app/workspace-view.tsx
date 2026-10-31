import { parseAssetLibraryQuery, type AssetLibraryViewModel, type ConflictResolutionChoice, type DomainDetailViewModel } from "@gooddealer/client-core";
import { getCapabilityCopy, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { AlertTriangleIcon, Banner, GlobeIcon } from "@gooddealer/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { DesktopShell, type DesktopShellStatus, type ShellNavigationSection, type ShellWindowFrame } from "../app-shell";
import { AssetLibrary, DomainDetail, type AssetLibraryPresentation, type DomainDetailPresentation } from "../features/portfolio";
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
}

const windowSize = 25;

/**
 * Production workspace: the shell, rail, and the routes whose Host reads exist. Write affordances
 * are passed only when the adjudicated presentation is writable, so a read-only surface cannot
 * reach a mutation even if a feature would otherwise render the control.
 */
export function WorkspaceView({ locale, presentation, ports, windowFrame, onPublication, onRefresh }: WorkspaceViewProps) {
  const shellCopy = getPresentationCopy(locale, "shell");
  const runtimeCopy = getCapabilityCopy(locale, "runtimeMode");
  const { surface, publication, readOnly } = presentation;
  const [route, setRoute] = useState<AppRoute>(createAppRoute(surface.defaultRouteId));
  const [actionFailed, setActionFailed] = useState(false);
  const pendingConflicts = publication.conflicts.conflicts.filter((item) => item.status === "pending").length;

  const navigation = useMemo((): readonly ShellNavigationSection[] => {
    const has = (id: AppRouteId) => surface.availableRouteIds.includes(id);
    const assets = has("portfolio.list") ? [{ id: "portfolio.list", label: shellCopy.assetLibrary, icon: <GlobeIcon /> }] : [];
    const execution = has("sync.conflicts")
      ? [{ id: "sync.conflicts", label: shellCopy.conflicts, icon: <AlertTriangleIcon />, ...(pendingConflicts > 0 ? { count: pendingConflicts, tone: "danger" as const } : {}) }]
      : [];
    return [
      ...(assets.length === 0 ? [] : [{ id: "assets", label: shellCopy.assets, items: assets }]),
      ...(execution.length === 0 ? [] : [{ id: "execution", label: shellCopy.execution, items: execution }]),
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
  const navigationId = route.id === "portfolio.detail" ? "portfolio.list" : route.id;
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
      onNavigate={(id) => { setActionFailed(false); if (id === "portfolio.list" || id === "sync.conflicts") setRoute(createAppRoute(id)); }}
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

function AssetLibraryRoute({ locale, ports, initial, onOpenAsset }: {
  readonly locale: Locale;
  readonly ports: AuthoritativeWorkspacePorts;
  readonly initial: AssetLibraryViewModel;
  readonly onOpenAsset: (domainId: string) => void;
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
