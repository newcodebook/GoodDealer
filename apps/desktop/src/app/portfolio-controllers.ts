import type {
  AssetLibraryViewModel,
  AssetLibraryWindowRequest,
  DomainDetailViewModel,
  LocalDomainAssetMutationReceipt,
  PortfolioReadErrorCode,
  PortfolioReadState,
  ValidatedPortfolioPresentationPort,
} from "@gooddealer/client-core";

import { LocalReadError, type LocalBusinessPort, type LocalBusinessStatus } from "../adapters/tauri";

export interface PortfolioRequestToken { readonly generation: number; readonly identity: string; }

/** Accepts a response only for the newest request identity at the current Host read generation. */
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

export interface AcceptedPortfolioMutation {
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

/** A committed receipt is published only with a fresh Active status at the receipt generation. */
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

export function presentDomainDetailReadError(error: unknown): PortfolioReadState<DomainDetailViewModel> {
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
