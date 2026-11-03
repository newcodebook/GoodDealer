import {
  createConflictResolutionIntent,
  type AssetLibraryViewModel,
  type ConflictCenterViewModel,
  type ConflictResolutionChoice,
  type SyncSnapshotViewModel,
  type ValidatedPortfolioPresentationPort,
} from "@gooddealer/client-core";

import type {
  LocalBusinessPort,
  LocalBusinessStatus,
  LocalConflictPort,
  LocalSyncStatusPort,
} from "../adapters/tauri";
import type { AppRouteId } from "./app-route";

export interface AuthoritativeWorkspacePublication {
  readonly status: LocalBusinessStatus;
  readonly portfolio: AssetLibraryViewModel | null;
  readonly conflicts: ConflictCenterViewModel | null;
  readonly sync: SyncSnapshotViewModel | null;
}

export interface AuthoritativeWorkspacePorts {
  readonly business: LocalBusinessPort;
  readonly portfolio: ValidatedPortfolioPresentationPort;
  readonly conflicts: LocalConflictPort;
  readonly sync: LocalSyncStatusPort;
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
