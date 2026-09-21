import { useCallback, useEffect, useRef, useState } from "react";

import {
  createLocalBusinessPort,
  createLocalPortfolioPresentationPort,
  createDesktopAuthenticationPort,
  createCloudflarePort,
  createLocalConflictPort,
  createLocalSyncStatusPort,
  LocalReadError,
  type LocalBusinessPort,
  type DesktopAuthenticationStatus,
  type LocalBusinessStatus,
} from "./adapters/tauri";
import { createCloudflareJourney, type CloudflareJourneyState } from "./features/connections/cloudflare-coordinator";
import {
  assetLibraryWindowRequestSchema,
  parseAssetLibraryQuery,
  type AssetLibraryViewModel,
  type AssetLibraryWindowRequest,
  type PortfolioPresentationPort,
  type PortfolioReadErrorCode,
  type PortfolioReadState,
  type ValidatedPortfolioPresentationPort,
  type LocalDomainAssetMutationReceipt,
  type SyncSnapshotViewModel,
} from "@gooddealer/client-core";
import { AssetLibrary } from "./features/portfolio/asset-library";
import { DomainDetail } from "./features/portfolio/domain-detail";
import { ConflictCenter } from "./features/sync/conflict-center/conflict-center";
import { createConflictResolutionIntent, type ConflictCenterViewModel, type ConflictResolutionChoice } from "@gooddealer/client-core";
import type { DomainDetailViewModel } from "@gooddealer/client-core";
import { DesktopShell } from "./app-shell";
import { DesktopRouter } from "./app/desktop-router";
import { getAppRouteLabel } from "./app/route-registry";
import type { AppRoute } from "./app/app-route";
import type { AppRouteId } from "./app/app-route";
import type { WorkspaceDesktopSurface } from "./app/desktop-surface";

const localBusiness = createLocalBusinessPort();
const desktopAuthentication = createDesktopAuthenticationPort();
const portfolioPort = createLocalPortfolioPresentationPort();
const cloudflarePort = createCloudflarePort();
const localConflictPort = createLocalConflictPort();
const localSyncStatusPort = createLocalSyncStatusPort();

interface LocalBusinessView {
  readonly status: LocalBusinessStatus;
  readonly portfolio: AssetLibraryViewModel | null;
}

interface AuthoritativeWorkspacePublication {
  readonly status: LocalBusinessStatus;
  readonly portfolio: AssetLibraryViewModel | null;
  readonly conflicts: ConflictCenterViewModel | null;
  readonly sync: SyncSnapshotViewModel | null;
}

interface AuthoritativeWorkspacePorts {
  readonly business: LocalBusinessPort;
  readonly portfolio: ValidatedPortfolioPresentationPort;
  readonly conflicts: ReturnType<typeof createLocalConflictPort>;
  readonly sync: ReturnType<typeof createLocalSyncStatusPort>;
}

/** Reads a generation-stable set and returns nothing partially publishable. */
export async function readAuthoritativeWorkspacePublication(
  ports: AuthoritativeWorkspacePorts,
  minimumReadGeneration = 0,
): Promise<AuthoritativeWorkspacePublication> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await ports.business.status();
    if (!before.capabilities.includes("local:read")) {
      if (before.readGeneration < minimumReadGeneration) continue;
      return { status: before, portfolio: null, conflicts: null, sync: null };
    }
    const [portfolio, conflicts, sync] = await Promise.all([
      ports.portfolio.loadAssetLibrary({ startIndex: 0, size: 25, query: "" }),
      ports.conflicts.conflictCenter(),
      ports.sync.status(),
    ]);
    const after = await ports.business.status();
    if (
      before.state === after.state
      && before.readGeneration === after.readGeneration
      && after.readGeneration >= minimumReadGeneration
      && portfolio.readGeneration === after.readGeneration
      && conflicts.readGeneration === after.readGeneration
      && sync.readGeneration === after.readGeneration
    ) {
      return { status: after, portfolio, conflicts, sync };
    }
  }
  throw new Error("authoritative workspace snapshot did not stabilize");
}

export async function resolveConflictAndReadWorkspace(
  current: ConflictCenterViewModel,
  candidateId: string,
  choice: ConflictResolutionChoice,
  ports: AuthoritativeWorkspacePorts,
): Promise<AuthoritativeWorkspacePublication> {
  const intent = createConflictResolutionIntent(current, candidateId, choice);
  if (intent === null) throw new Error("conflict resolution is unavailable");
  const receipt = await ports.conflicts.resolveConflict(intent);
  if (receipt.readGeneration !== intent.expectedReadGeneration + 1) {
    throw new Error("conflict resolution generation mismatch");
  }
  return readAuthoritativeWorkspacePublication(ports, receipt.readGeneration);
}

export function eligibleWorkspaceRouteIds(
  sync: SyncSnapshotViewModel | null,
): readonly AppRouteId[] {
  const syncRouteBlocked = sync === null
    || sync.recoveryRequired
    || sync.blockedReason === "security";
  return syncRouteBlocked
    ? ["portfolio.list", "portfolio.detail", "dns.health"]
    : ["portfolio.list", "portfolio.detail", "dns.health", "sync.conflicts"];
}

export async function readLocalBusinessView(port: LocalBusinessPort, reads?: PortfolioPresentationPort): Promise<LocalBusinessView> {
  const status = await port.status();
  const portfolio = status.capabilities.includes("local:read")
    ? reads === undefined
      ? null
      : await reads.loadAssetLibrary({ startIndex: 0, size: 25, query: "" }) as AssetLibraryViewModel
    : null;
  return { status, portfolio };
}

export async function synchronizeAfterAuthentication(
  status: DesktopAuthenticationStatus,
  synchronize: () => Promise<void>,
): Promise<void> {
  if (
    status === "authenticated"
    || status === "authorization_failed"
    || status === "authorization_retryable"
  ) await synchronize();
}

export function authenticationLocksRuntime(status: DesktopAuthenticationStatus): boolean {
  return status === "authorization_failed" || status === "authorization_retryable";
}

export interface AuthenticationStatusCoordinator {
  acceptEvent(status: DesktopAuthenticationStatus): Promise<void>;
  beginSnapshot(): (status: DesktopAuthenticationStatus) => Promise<void>;
}

export interface PortfolioRequestToken { readonly generation: number; readonly identity: string; }
export function createPortfolioReadCoordinator() {
  let generation = 0;
  let mounted = true;
  let hostGeneration = 0;
  return {
    acceptHostGeneration(value: number) { if (value !== hostGeneration) { hostGeneration = value; generation += 1; } },
    begin(identity: string): PortfolioRequestToken { return { generation: ++generation, identity }; },
    commit<T>(token: PortfolioRequestToken, identity: string, responseGeneration: number, value: T, accept: (value: T) => void): boolean {
      if (!mounted || token.generation !== generation || token.identity !== identity || responseGeneration !== hostGeneration) return false;
      accept(value);
      return true;
    },
    commitCurrent(token: PortfolioRequestToken, identity: string, accept: () => void): boolean {
      if (!mounted || token.generation !== generation || token.identity !== identity) return false;
      accept();
      return true;
    },
    invalidate() { generation += 1; },
    unmount() { mounted = false; generation += 1; },
  };
}

export interface PortfolioReadController {
  acceptHostGeneration(value: number): void;
  loadAssetLibrary(
    request: AssetLibraryWindowRequest,
    accept: (value: AssetLibraryViewModel) => void,
    reject: (error: unknown) => void,
  ): Promise<void>;
  loadDomainDetail(
    entityId: string,
    accept: (value: DomainDetailViewModel) => void,
    reject: (error: unknown) => void,
  ): Promise<void>;
  invalidate(): void;
  unmount(): void;
}

interface PortfolioMutationToken extends PortfolioRequestToken {
  readonly expectedReadGeneration: number;
}

interface AcceptedPortfolioMutation {
  readonly receipt: LocalDomainAssetMutationReceipt;
  readonly status: LocalBusinessStatus;
}

export interface PortfolioMutationController {
  execute(
    identity: string,
    expectedReadGeneration: number,
    mutate: () => Promise<LocalDomainAssetMutationReceipt>,
    accept: (value: AcceptedPortfolioMutation) => void,
    reject: (error: unknown) => void,
  ): Promise<void>;
  invalidate(): void;
  unmount(): void;
}

export function createPortfolioMutationController(port: LocalBusinessPort): PortfolioMutationController {
  let generation = 0;
  let mounted = true;
  const current = (token: PortfolioMutationToken, identity: string) => mounted
    && token.generation === generation
    && token.identity === identity;
  return {
    async execute(identity, expectedReadGeneration, mutate, accept, reject) {
      const token = { generation: ++generation, identity, expectedReadGeneration };
      try {
        const receipt = await mutate();
        if (!current(token, identity)) return;
        const nextStatus = await port.status();
        if (!current(token, identity)) return;
        if (
          nextStatus.state !== "active"
          || !nextStatus.capabilities.includes("workspace:mutate")
          || nextStatus.readGeneration !== receipt.readGeneration
          || receipt.readGeneration < token.expectedReadGeneration
        ) return;
        accept({ receipt, status: nextStatus });
      } catch (error) {
        if (current(token, identity)) reject(error);
      }
    },
    invalidate() { generation += 1; },
    unmount() { mounted = false; generation += 1; },
  };
}

export function createPortfolioReadController(port: ValidatedPortfolioPresentationPort): PortfolioReadController {
  const coordinator = createPortfolioReadCoordinator();
  const execute = async <T extends { readonly readGeneration: number }>(
    identity: string,
    read: () => Promise<T>,
    accept: (value: T) => void,
    reject: (error: unknown) => void,
  ) => {
    const token = coordinator.begin(identity);
    try {
      const value = await read();
      coordinator.commit(token, identity, value.readGeneration, value, accept);
    } catch (error) {
      coordinator.commitCurrent(token, identity, () => reject(error));
    }
  };
  return {
    acceptHostGeneration: (value) => coordinator.acceptHostGeneration(value),
    loadAssetLibrary: async (request, accept, reject) => execute(
      `list:${request.startIndex}:${request.size}:${request.query}`,
      async () => port.loadAssetLibrary(request),
      accept,
      reject,
    ),
    loadDomainDetail: async (entityId, accept, reject) => execute(
      `detail:${entityId}`,
      async () => port.loadDomainDetail(entityId),
      accept,
      reject,
    ),
    invalidate: () => coordinator.invalidate(),
    unmount: () => coordinator.unmount(),
  };
}

export function createAuthenticationStatusCoordinator(
  accept: (status: DesktopAuthenticationStatus) => Promise<void>,
): AuthenticationStatusCoordinator {
  let eventGeneration = 0;
  return {
    async acceptEvent(status) {
      eventGeneration += 1;
      await accept(status);
    },
    beginSnapshot() {
      const generation = eventGeneration;
      return async (status) => {
        if (generation === eventGeneration) await accept(status);
      };
    },
  };
}

export function App() {
  const [workspace, setWorkspace] = useState<(AuthoritativeWorkspacePublication & {
    readonly portfolioPresentation: PortfolioReadState<AssetLibraryViewModel>;
  }) | null>(null);
  const portfolioData = useRef<AssetLibraryViewModel | null>(null);
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState(false);
  const [authentication, setAuthentication] = useState<DesktopAuthenticationStatus | null>(null);
  const [detailPresentation, setDetailPresentation] = useState<PortfolioReadState<DomainDetailViewModel>>({ state: "loading" });
  const [route, setRoute] = useState<AppRoute>({ id: "portfolio.list" });
  const [conflictError, setConflictError] = useState(false);
  const conflictGeneration = useRef(0);
  const requestController = useRef(createPortfolioReadController(portfolioPort));
  const mutationController = useRef(createPortfolioMutationController(localBusiness));
  const cloudflareJourneyRef = useRef<ReturnType<typeof createCloudflareJourney> | null>(null);
  const registerCloudflareJourney = useCallback((journey: ReturnType<typeof createCloudflareJourney>) => {
    cloudflareJourneyRef.current = journey;
  }, []);

  const acceptPortfolio = (value: AssetLibraryViewModel) => {
    portfolioData.current = value;
    setWorkspace((current) => current === null ? current : {
      ...current,
      portfolio: value,
      portfolioPresentation: presentAssetLibraryRead(value),
    });
  };
  const rejectPortfolio = (error: unknown) => {
    setWorkspace((current) => current === null ? current : {
      ...current,
      portfolioPresentation: presentPortfolioReadError(error, portfolioData.current),
    });
  };
  const requestAssetLibrary = (nextQuery: string, window: Omit<AssetLibraryWindowRequest, "query">) => {
    setQuery(nextQuery);
    let request: AssetLibraryWindowRequest;
    try {
      request = assetLibraryWindowRequestSchema.parse({ ...window, query: parseAssetLibraryQuery(nextQuery) });
    } catch {
      requestController.current.invalidate();
      const queryIsValid = (() => {
        try { parseAssetLibraryQuery(nextQuery); return true; } catch { return false; }
      })();
      setWorkspace((current) => current === null ? current : {
        ...current,
        portfolioPresentation: queryIsValid
          ? { state: "invalid-window" }
          : { state: "invalid-query", data: portfolioData.current },
      });
      return;
    }
    setWorkspace((current) => current === null ? current : {
      ...current,
      portfolioPresentation: { state: "loading" },
    });
    void requestController.current.loadAssetLibrary(request, acceptPortfolio, rejectPortfolio);
  };

  useEffect(() => {
    let active = true;
    let businessSyncGeneration = 0;
    const synchronizeBusiness = async () => {
      const generation = ++businessSyncGeneration;
      const publication = await readAuthoritativeWorkspacePublication({
        business: localBusiness,
        portfolio: portfolioPort,
        conflicts: localConflictPort,
        sync: localSyncStatusPort,
      });
      if (!active || generation !== businessSyncGeneration) return;
      const nextStatus = publication.status;
      mutationController.current.invalidate();
      requestController.current.acceptHostGeneration(nextStatus.readGeneration);
      portfolioData.current = publication.portfolio;
      setWorkspace({
        ...publication,
        portfolioPresentation: publication.portfolio === null
          ? { state: "unavailable" }
          : presentAssetLibraryRead(publication.portfolio),
      });
      setQuery("");
      setDetailPresentation({ state: "loading" });
      setRoute({ id: "portfolio.list" });
      setConflictError(false);
      setFailure(false);
    };
    const acceptAuthenticationStatus = async (value: DesktopAuthenticationStatus) => {
      if (!active) return;
      setAuthentication(value);
      if (authenticationLocksRuntime(value)) {
        cloudflareJourneyRef.current?.invalidate();
        // Native has already removed read authority; do not retain sensitive rows while the
        // authoritative business-status snapshot is in flight.
        portfolioData.current = null;
        setWorkspace(null);
        setDetailPresentation({ state: "unavailable" });
        requestController.current.invalidate();
        mutationController.current.invalidate();
        conflictGeneration.current += 1;
      }
      await synchronizeAfterAuthentication(value, synchronizeBusiness);
    };
    const reportFailure = () => {
      if (active) setFailure(true);
    };
    const authenticationStatuses = createAuthenticationStatusCoordinator(
      acceptAuthenticationStatus,
    );

    void synchronizeBusiness().catch(reportFailure);
    let unlisten: (() => void) | undefined;
    void desktopAuthentication.onStatus((value) => {
      void authenticationStatuses.acceptEvent(value).catch(reportFailure);
    }).then((dispose) => {
      if (!active) {
        dispose();
        return;
      }
      unlisten = dispose;
      // Read current state only after installing the listener, closing the startup race where
      // authorization could complete between an initial status read and subscription. Capture
      // the event generation so an older IPC response cannot overwrite a newer event.
      const acceptSnapshot = authenticationStatuses.beginSnapshot();
      void desktopAuthentication.status()
        .then(acceptSnapshot)
        .catch(() => {
          if (active) setAuthentication("unavailable");
        });
    }).catch(() => {
      if (active) setAuthentication("unavailable");
    });
    return () => {
      active = false;
      requestController.current.unmount();
      mutationController.current.unmount();
      unlisten?.();
    };
  }, []);

  if (failure) {
    return <Unavailable message="The local business host is unavailable." />;
  }
  if (workspace === null) {
    return <Unavailable message="Opening the local business database…" />;
  }
  const status = workspace.status;
  if (status.state === "activation_required") {
    return <AuthenticationRequired status={authentication} />;
  }
  if (status.state === "security_locked") {
    return <AuthenticationRequired status={authentication} securityLocked />;
  }
  if (status.state === "retryable_locked") {
    return <AuthenticationRequired status={authentication} retryableLocked />;
  }
  const surface: WorkspaceDesktopSurface = {
    kind: status.state === "active" ? "active" : "standby",
    authorityEvidence: "complete",
    availableRouteIds: eligibleWorkspaceRouteIds(workspace.sync),
    defaultRouteId: "portfolio.list",
  };
  const openAsset = (entityId: string) => {
    mutationController.current.invalidate();
    setRoute({ id: "portfolio.detail", domainId: entityId });
    setDetailPresentation({ state: "loading" });
    void requestController.current.loadDomainDetail(
      entityId,
      (value) => setDetailPresentation({ state: "ready", data: value }),
      (error) => setDetailPresentation(detailErrorState(error)),
    );
  };
  const renderDetail = (detailRoute: AppRoute) => {
    if (detailRoute.id !== "portfolio.detail") return <Unavailable message="Domain detail is unavailable." />;
    const current = detailPresentation.state === "ready" ? detailPresentation.data : null;
    const edit = status.state === "active" && current !== null ? async (note: string | null) => {
      const value = window.prompt("Asset note", note ?? "");
      if (value === null) return;
      const entityId = current.asset.id;
      await mutationController.current.execute(
        `edit:${entityId}`,
        status.readGeneration,
        async () => localBusiness.editDomainAsset({ mutationId: crypto.randomUUID(), expectedReadGeneration: status.readGeneration, expectedAssetVersion: current.asset.assetVersion, asset: { entityId, note: value === "" ? null : value, portfolioId: current.asset.portfolioId, tags: [...current.asset.tags], targetPrice: current.asset.targetPrice } }),
        ({ receipt, status: nextStatus }) => {
          requestController.current.acceptHostGeneration(receipt.readGeneration);
          setWorkspace((currentWorkspace) => currentWorkspace === null ? currentWorkspace : {
            ...currentWorkspace,
            status: nextStatus,
          });
          setDetailPresentation({ state: "loading" });
          void requestController.current.loadDomainDetail(entityId, (next) => setDetailPresentation({ state: "ready", data: next }), (error) => setDetailPresentation(detailErrorState(error)));
        },
        () => setDetailPresentation({ state: "unavailable" }),
      );
    } : undefined;
    const remove = status.state === "active" && current !== null ? async () => {
      if (!window.confirm(`Delete ${current.asset.domain}?`)) return;
      const entityId = current.asset.id;
      await mutationController.current.execute(
        `delete:${entityId}`,
        status.readGeneration,
        async () => localBusiness.deleteDomainAsset({ mutationId: crypto.randomUUID(), expectedReadGeneration: status.readGeneration, expectedAssetVersion: current.asset.assetVersion, entityId }),
        ({ receipt, status: nextStatus }) => {
          requestController.current.acceptHostGeneration(receipt.readGeneration);
          setWorkspace((currentWorkspace) => currentWorkspace === null ? currentWorkspace : {
            ...currentWorkspace,
            status: nextStatus,
          });
          setRoute({ id: "portfolio.list" });
          setDetailPresentation({ state: "loading" });
          requestAssetLibrary(query, { startIndex: 0, size: portfolioData.current?.window.size ?? 25 });
        },
        () => setDetailPresentation({ state: "unavailable" }),
      );
    } : undefined;
    return <DomainDetail locale="en-US" presentation={detailPresentation} onBack={() => {
      requestController.current.invalidate();
      mutationController.current.invalidate();
      setRoute({ id: "portfolio.list" });
      setDetailPresentation({ state: "loading" });
    }} onEdit={edit} onDelete={remove} />;
  };

  const resolveConflict = async (candidateId: string, choice: ConflictResolutionChoice) => {
    const current = workspace.conflicts;
    if (status.state !== "active" || current === null) return;
    const token = ++conflictGeneration.current;
    try {
      const publication = await resolveConflictAndReadWorkspace(current, candidateId, choice, {
        business: localBusiness,
        portfolio: portfolioPort,
        conflicts: localConflictPort,
        sync: localSyncStatusPort,
      });
      if (token !== conflictGeneration.current) return;
      portfolioData.current = publication.portfolio;
      requestController.current.acceptHostGeneration(publication.status.readGeneration);
      setWorkspace({
        ...publication,
        portfolioPresentation: publication.portfolio === null
          ? { state: "unavailable" }
          : presentAssetLibraryRead(publication.portfolio),
      });
      setQuery("");
      setConflictError(false);
    } catch {
      if (token === conflictGeneration.current) setConflictError(true);
    }
  };

  const routeRenderers = {
    "portfolio.list": () => (
      <AssetLibrary
        locale="en-US"
        presentation={workspace.portfolioPresentation}
        query={query}
        onOpenAsset={openAsset}
        onQueryChange={(value) => requestAssetLibrary(value, { startIndex: 0, size: portfolioData.current?.window.size ?? 25 })}
        onWindowChange={(window) => requestAssetLibrary(query, window)}
      />
    ),
    "portfolio.detail": renderDetail,
    "dns.health": () => <CloudflareConnectionPanel onJourney={registerCloudflareJourney} />,
    "sync.conflicts": () => (
      <SyncConflictRoute
        value={workspace.conflicts}
        sync={workspace.sync}
        error={conflictError}
        resolve={(candidateId, choice) => { void resolveConflict(candidateId, choice); }}
      />
    ),
  } as const;
  return (
    <DesktopShell
      locale="en-US"
      title={getAppRouteLabel("en-US", route.id)}
      activeRouteId={route.id}
      eligibleRouteIds={surface.availableRouteIds}
      onRouteSelect={(routeId) => {
        requestController.current.invalidate();
        mutationController.current.invalidate();
        conflictGeneration.current += 1;
        setRoute({ id: routeId });
      }}
      {...(status.state === "commercial_read_only" ? { banner: {
        tone: "warning" as const,
        title: "Commercial authorization inactive",
        description: "Local data remains available for viewing and export.",
      } } : status.state === "standby_read_only" ? { banner: {
        tone: "warning" as const,
        title: "Execution lease unavailable",
        description: "Local data remains available in read-only mode.",
      } } : {})}
    >
      <DesktopRouter
        surface={surface}
        requestedRoute={route}
        routeRenderers={routeRenderers}
        renderUnavailable={() => <Unavailable message="This route is unavailable." />}
      />
    </DesktopShell>
  );
}

function SyncConflictRoute({
  value,
  sync,
  error,
  resolve,
}: {
  readonly value: ConflictCenterViewModel | null;
  readonly sync: SyncSnapshotViewModel | null;
  readonly error: boolean;
  readonly resolve: (candidateId: string, choice: ConflictResolutionChoice) => void;
}) {
  return <main aria-label="GoodDealer Desktop Sync conflicts">
    {error && <p role="alert">Sync conflicts are unavailable.</p>}
    {sync !== null && (
      <dl aria-label="Synchronization status">
        <dt>Transport</dt><dd>{sync.transport}</dd>
        <dt>Pending mutations</dt><dd>{sync.pendingMutationCount}</dd>
        <dt>Open conflicts</dt><dd>{sync.openConflictCount}</dd>
        <dt>Rejected mutations</dt><dd>{sync.rejectedMutationCount}</dd>
      </dl>
    )}
    {value !== null && <ConflictCenter value={value} resolve={resolve} />}
  </main>;
}

function CloudflareConnectionPanel({ onJourney }: { readonly onJourney: (journey: ReturnType<typeof createCloudflareJourney>) => void }) {
  const [connectionRef, setConnectionRef] = useState("cloudflare");
  const [entityId, setEntityId] = useState("");
  const [journeyState, setJourneyState] = useState<CloudflareJourneyState>({ state: "loading" });
  const journey = useRef(createCloudflareJourney(cloudflarePort, setJourneyState));
  useEffect(() => { onJourney(journey.current); }, [onJourney]);
  useEffect(() => {
    void journey.current.start();
    return () => journey.current.invalidate();
  }, []);
  const state = journeyState.state;
  return (
    <section aria-label="Cloudflare connection" data-cloudflare-state={state}>
      <h2>Cloudflare</h2>
      {state === "loading" && <p>Checking Cloudflare connection…</p>}
      {state === "not-configured" && <p>Cloudflare is not configured. Native will open a secure one-shot capture.</p>}
      {(state === "recovering" || state === "busy" || state === "blocked") && <p>Cloudflare connection is temporarily unavailable. Retry after Native recovery.</p>}
      {state === "unavailable" && <p>Cloudflare connection is unavailable. No provider details were returned.</p>}
      {(state === "ready" || state === "observing" || state === "available" || state === "empty") && <p>Cloudflare connection ready.</p>}
      <label>Connection reference <input value={connectionRef} maxLength={256} onChange={(event) => setConnectionRef(event.target.value)} /></label>
      {state === "not-configured" ? (
        <button type="button" onClick={() => { void journey.current.activate(connectionRef); }}>Activate securely</button>
      ) : (
        <button type="button" disabled={state === "loading" || state === "observing"} onClick={() => { void journey.current.start(); }}>Refresh connection status</button>
      )}
      <label>DNS entity <input value={entityId} maxLength={253} onChange={(event) => setEntityId(event.target.value)} /></label>
      <button type="button" disabled={state !== "ready" || entityId.length === 0} onClick={() => { void journey.current.observe(connectionRef, entityId); }}>Refresh DNS</button>
      {state === "available" && <p>{journeyState.observation.records.length} DNS records observed locally.</p>}
      {state === "empty" && <p>No DNS records were observed locally.</p>}
      <CloudflareObservationFreshness state={journeyState} />
    </section>
  );
}

export function CloudflareObservationFreshness({ state }: { readonly state: CloudflareJourneyState }) {
  if (state.state === "stale") {
    return <p role="status">Local DNS evidence is stale and cannot be used as a fresh available result. Refresh after the connection recovers.</p>;
  }
  if (state.state === "uncertain") {
    return <p role="status">Local DNS evidence is uncertain and cannot be used as an available result. Retry the observation.</p>;
  }
  return null;
}

/** A successful zero-row projection is an explicit empty state, not a ready table with no data. */
export function presentAssetLibraryRead(value: AssetLibraryViewModel): PortfolioReadState<AssetLibraryViewModel> {
  return value.totalRows === 0 ? { state: "empty" } : { state: "ready", data: value };
}

export function presentPortfolioReadError(
  error: unknown,
  current: AssetLibraryViewModel | null,
): PortfolioReadState<AssetLibraryViewModel> {
  if (error instanceof LocalReadError && error.code === "LOCAL_QUERY_REJECTED") {
    return { state: "invalid-query", data: current };
  }
  if (error instanceof LocalReadError && error.code === "LOCAL_WINDOW_REJECTED") {
    return { state: "invalid-window" };
  }
  if (error instanceof LocalReadError && isPortfolioReadErrorCode(error.code)) {
    return { state: "error", code: error.code };
  }
  return { state: "unavailable" };
}

function detailErrorState(error: unknown): PortfolioReadState<DomainDetailViewModel> {
  if (error instanceof LocalReadError && error.code === "LOCAL_ASSET_NOT_FOUND") {
    return { state: "asset-not-found" };
  }
  if (error instanceof LocalReadError && isPortfolioReadErrorCode(error.code)) {
    return { state: "error", code: error.code };
  }
  return { state: "unavailable" };
}

function isPortfolioReadErrorCode(code: string): code is PortfolioReadErrorCode {
  return code === "LOCAL_WORKSPACE_REJECTED" || code === "LOCAL_STORAGE_REJECTED" || code === "LOCAL_SCHEMA_REJECTED"
    || code === "LOCAL_PROJECTION_REJECTED" || code === "LOCAL_REVISION_REJECTED"
    || code === "LOCAL_RESPONSE_REJECTED";
}

export function AuthenticationRequired({
  status,
  securityLocked = false,
  retryableLocked = false,
}: {
  readonly status: DesktopAuthenticationStatus | null;
  readonly securityLocked?: boolean;
  readonly retryableLocked?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const begin = () => {
    setFailed(false);
    void desktopAuthentication.begin().catch(() => setFailed(true));
  };
  const retry = () => {
    setFailed(false);
    void desktopAuthentication.refresh().catch(() => setFailed(true));
  };
  const message = securityLocked
    ? "This device is security locked. Reauthenticate or start recovery to reopen local data."
    : retryableLocked
      ? "Device authorization is temporarily unavailable. Retry authorization to reopen local data."
    : "Sign in and authorize this device to open local business data.";
  return (
    <main aria-label="GoodDealer Desktop">
      <h1>GoodDealer</h1>
      <p>{message}</p>
      {status === "pending" && <p>Complete sign-in in your browser…</p>}
      {status === "authenticated" && <p>This device authorization is verified.</p>}
      {status === "authorization_failed" && (
        <>
          <p>Sign-in succeeded, but this device authorization could not be verified.</p>
          <button type="button" onClick={begin}>Sign in again</button>
        </>
      )}
      {status === "authorization_retryable" && (
        <>
          <p>Device authorization could not be refreshed. Local access remains locked.</p>
          <button type="button" onClick={retry}>Retry authorization</button>
          <button type="button" onClick={begin}>Sign in again</button>
        </>
      )}
      {status === "unavailable" && <p>Native device authentication is not configured for this build.</p>}
      {status === "signed_out" && (
        <button type="button" onClick={begin}>Sign in securely</button>
      )}
      {failed && <p>Authentication could not continue. Try again.</p>}
    </main>
  );
}

function Unavailable({ message }: { readonly message: string }) {
  return (
    <main aria-label="GoodDealer Desktop">
      <h1>GoodDealer</h1>
      <p>{message}</p>
    </main>
  );
}
