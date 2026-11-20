import {
  createConflictResolutionIntent,
  type DeviceDirectorySettingsPort,
  type AfternicConnectionPort,
  type SpaceshipRegistrarPort,
  type AliyunRegistrarPort,
  type GoDaddyRegistrarPort,
  type CloudflareRegistrarAccountPort,
  type AtomMarketplacePort,
  type AfternicDelistPort,
  type AfternicListingPlanPort,
  type AfternicListingWritePort,
  type AssetLibraryViewModel,
  type BatchOperationsReadPort,
  type HistoryReadPort,
  type ManualTasksReadPort,
  type ConflictCenterViewModel,
  type ConflictResolutionChoice,
  type DnsHealthPort,
  type RenewalsReadPort,
  type SalesReadPort,
  type SettingsReadPort,
  type SyncSnapshotViewModel,
  type ValidatedPortfolioPresentationPort,
} from "@gooddealer/client-core";

import type {
  DeviceSwitchPort,
  TargetBootstrapPort,
  TargetInstallationPort,
  ForcedTakeoverPort,
  LocalBusinessPort,
  LocalBusinessStatus,
  LocalConflictPort,
  LocalSyncStatusPort,
} from "../adapters/tauri";
import type { CloudflareConnectionPort } from "../features/connections";
import type { AppRouteId } from "./app-route";

export interface AuthoritativeWorkspacePublication {
  readonly status: LocalBusinessStatus;
  readonly portfolio: AssetLibraryViewModel | null;
  readonly conflicts: ConflictCenterViewModel | null;
  readonly sync: SyncSnapshotViewModel | null;
}

export interface AuthoritativeWorkspacePorts {
  /** Cloud device metadata; absent in offline-only compositions. */
  readonly devices?: DeviceDirectorySettingsPort;
  readonly deviceSwitch?: DeviceSwitchPort;
  readonly targetBootstrap?: TargetBootstrapPort;
  readonly targetInstallation?: TargetInstallationPort;
  readonly forcedTakeover?: ForcedTakeoverPort;
  readonly business: LocalBusinessPort;
  /** Read by the DNS route on demand; not part of the generation-stable workspace publication. */
  readonly dns: DnsHealthPort;
  /** Read by the settings route on demand; not part of the workspace publication either. */
  readonly settings: SettingsReadPort;
  /** Read by the sales route on demand; not part of the workspace publication. */
  readonly sales: SalesReadPort;
  /** Read by the renewals route on demand; not part of the workspace publication. */
  readonly renewals: RenewalsReadPort;
  /** Read by the batch route on demand; not part of the workspace publication. */
  readonly batches: BatchOperationsReadPort;
  /** Read by the history route on demand; not part of the workspace publication. */
  readonly history: HistoryReadPort;
  /** Read by the manual task route on demand; not part of the workspace publication. */
  readonly manualTasks: ManualTasksReadPort;
  /**
   * Read by settings and onboarding on demand; the Host status carries qualification and the last
   * outcome. Onboarding also connects and revokes through it, under the Host's own gates.
   */
  readonly cloudflare: CloudflareConnectionPort;
  readonly afternic: AfternicConnectionPort;
  readonly spaceship?: SpaceshipRegistrarPort;
  readonly aliyun?: AliyunRegistrarPort;
  readonly godaddy?: GoDaddyRegistrarPort;
  readonly cloudflareRegistrarAccount?: CloudflareRegistrarAccountPort;
  readonly atom?: AtomMarketplacePort;
  readonly afternicDelist: AfternicDelistPort;
  readonly afternicListingPlan?: AfternicListingPlanPort;
  readonly afternicListingWrite: AfternicListingWritePort;
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
    ? ["portfolio.list", "portfolio.detail", "renewals.desk", "sales.desk", "dns.health", "operations.batch", "operations.manualTasks", "operations.history", "settings"]
    : ["portfolio.list", "portfolio.detail", "renewals.desk", "sales.desk", "dns.health", "operations.batch", "operations.manualTasks", "operations.history", "sync.conflicts", "settings"];
}
