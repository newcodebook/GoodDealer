import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  connectionLabelSchema,
  deviceSelfNameIntentSchema,
  parseDeviceDirectoryView,
  type DeviceDirectorySettingsPort,
  copyPlainData,
  batchOperationsWindowRequestSchema,
  parseBatchOperationsRead,
  type BatchOperationsRead,
  type BatchOperationsReadPort,
  historyWindowRequestSchema,
  parseHistoryRead,
  type HistoryRead,
  type HistoryReadPort,
  manualTasksWindowRequestSchema,
  parseManualTasksRead,
  type ManualTasksRead,
  type ManualTasksReadPort,
  assetLibraryWindowRequestSchema,
  canonicalDomainNameSchema,
  parseAssetLibraryQuery,
  parseAssetLibraryViewModel,
  parseDomainDetailViewModel,
  parseDnsHealthRead,
  parseRenewalsRead,
  parseSalesRead,
  parseSettingsRead,
  parseStorageRepairReceipt,
  storageRepairRequestSchema,
  renewalsWindowRequestSchema,
  salesWindowRequestSchema,
  dnsHealthWindowRequestSchema,
  type DnsHealthPort,
  type DnsHealthRead,
  type RenewalsRead,
  type RenewalsReadPort,
  type SalesRead,
  type SalesReadPort,
  type SettingsRead,
  type SettingsReadPort,
  localDomainAssetCreateRequestSchema,
  localDomainAssetEditRequestSchema,
  localDomainAssetDeleteRequestSchema,
  localDomainAssetMutationReceiptSchema,
  ValidatingPortfolioProviderBindingPort,
  type PortfolioProviderBindingPort,
  parseConflictCenterViewModel,
  parseConflictResolutionReceipt,
  parseSyncSnapshotViewModel,
  conflictResolutionIntentSchema,
  type ConflictCenterViewModel,
  type ConflictResolutionIntent,
  type ConflictResolutionReceipt,
  type SyncSnapshotViewModel,
  type LocalDomainAssetCreateRequest,
  type LocalDomainAssetEditRequest,
  type LocalDomainAssetDeleteRequest,
  type LocalDomainAssetMutationReceipt,
  type LocalDomainAssetProviderBindingRequest,
  type LocalDomainAssetProviderBindingReceipt,
  type AssetLibraryViewModel,
  type DomainDetailViewModel,
  type ValidatedPortfolioPresentationPort,
} from "@gooddealer/client-core";

export interface LocalBusinessStatus {
  readonly schemaVersion: 2;
  readonly state:
    | "activation_required"
    | "security_locked"
    | "retryable_locked"
    | "commercial_read_only"
    | "target_installation_pending"
    | "standby_awaiting_replica"
    | "standby_read_only"
    | "active";
  readonly capabilities: readonly ("local:read" | "workspace:mutate")[];
  readonly readGeneration: number;
}

/** The Host refusals of an add the person can act on; every other refusal stays opaque. */
const localWriteErrorCodes = ["DESKTOP_LOCAL_ASSET_EXISTS", "DESKTOP_LOCAL_ASSET_DELETED", "DESKTOP_LOCAL_ASSET_RE_ADD_BLOCKED", "DESKTOP_LOCAL_ASSET_RE_ADD_PENDING"] as const;
export type LocalWriteErrorCode = (typeof localWriteErrorCodes)[number];

/**
 * A write the Host refused for a reason the person can act on: the domain is already held, or it
 * was deleted but its re-add preconditions are unmet, or its re-add is already waiting for Cloud.
 * Every other refusal stays an opaque failure, as for edits.
 */
export class LocalWriteError extends Error {
  constructor(readonly code: LocalWriteErrorCode) {
    super(code);
    this.name = "LocalWriteError";
  }
}

export interface LocalBusinessPort {
  status(): Promise<LocalBusinessStatus>;
  /** Adds a domain the workspace does not hold; a held or still-tombstoned one rejects with `LocalWriteError`. */
  createDomainAsset(request: LocalDomainAssetCreateRequest): Promise<LocalDomainAssetMutationReceipt>;
  editDomainAsset(request: LocalDomainAssetEditRequest): Promise<LocalDomainAssetMutationReceipt>;
  deleteDomainAsset(request: LocalDomainAssetDeleteRequest): Promise<LocalDomainAssetMutationReceipt>;
  /** Optional so read-only adapters need not supply it; the DNS page binds through it only when writable. */
  bindDomainAssetProvider?(request: LocalDomainAssetProviderBindingRequest): Promise<LocalDomainAssetProviderBindingReceipt>;
}

export interface LocalConflictPort {
  conflictCenter(): Promise<ConflictCenterViewModel>;
  resolveConflict(request: ConflictResolutionIntent): Promise<ConflictResolutionReceipt>;
}

/** The Active device and its lease epoch, for display. No envelope, key or capability crosses here. */
export interface LocalDeviceLease {
  readonly schemaVersion: 1;
  readonly deviceId: string;
  readonly leaseEpoch: number;
}

export interface LocalDeviceLeasePort {
  /** Rejects whenever this device does not hold a current Active lease. */
  read(): Promise<LocalDeviceLease>;
}

export interface LocalSyncStatusPort {
  status(): Promise<SyncSnapshotViewModel>;
}

const deviceSwitchStatuses = ["requested", "draining", "waiting_expiry", "bootstrapping", "completed", "cancelled", "failed"] as const;
export type DeviceSwitchStatus = (typeof deviceSwitchStatuses)[number];

const deviceSwitchRejections = [
  "SWITCH_IN_PROGRESS",
  "SWITCH_NOT_FOUND",
  "SWITCH_NOT_CANCELLABLE",
  "IDEMPOTENCY_CONFLICT",
  "TARGET_IS_SOURCE",
  "TARGET_NOT_BOUND",
  "TARGET_REMOVED",
  "SOURCE_LEASE_CHANGED",
  "ACCOUNT_RECOVERY_PENDING",
  "FORCED_SWITCH_UNAVAILABLE",
  "DRAIN_PROOF_INVALID",
  "DRAIN_PROOF_EXPIRED",
  "DRAIN_STREAMS_INCOMPLETE",
] as const;
export type DeviceSwitchRejection = (typeof deviceSwitchRejections)[number];

/**
 * Where this device's switch stands (ADR-0032). Only closed codes cross IPC: the switch id, Lease,
 * receipts, proof and signature stay in the Host.
 */
export type DeviceSwitchStep = { readonly frozenUnresolved: number | null } & (
  | { readonly kind: "idle" }
  | { readonly kind: "request_pending" }
  | { readonly kind: "rejected"; readonly rejection: DeviceSwitchRejection }
  | { readonly kind: "waiting_for_sync"; readonly unconfirmed: number }
  | { readonly kind: "blocked" }
  | { readonly kind: "receipts_missing" }
  | { readonly kind: "switch"; readonly status: DeviceSwitchStatus }
  | { readonly kind: "writes_reopened" });

const deviceSwitchErrorCodes = [
  "DEVICE_SWITCH_RETRY_LATER",
  "DEVICE_SWITCH_AUTHORIZATION_REQUIRED",
  "DEVICE_SWITCH_BLOCKED",
  "DEVICE_SWITCH_UNAVAILABLE",
  "DEVICE_SWITCH_INVALID_REQUEST",
] as const;
export type DeviceSwitchErrorCode = (typeof deviceSwitchErrorCodes)[number];

/** A switch call the Host could not finish; any unnamed refusal stays an opaque failure. */
export class DeviceSwitchError extends Error {
  constructor(readonly code: DeviceSwitchErrorCode) {
    super(code);
    this.name = "DeviceSwitchError";
  }
}

export interface DeviceSwitchPort {
  /** Asks Cloud for a normal switch to a bound device; an open switch is resumed instead. */
  request(toDeviceId: string): Promise<DeviceSwitchStep>;
  /** Moves the open switch forward: sync, receipts, then the signed drain proof. */
  advance(): Promise<DeviceSwitchStep>;
  status(): Promise<DeviceSwitchStep>;
  /** Writes reopen only once Cloud confirms the cancellation. */
  cancel(): Promise<DeviceSwitchStep>;
}

export type TargetBootstrapView =
  | { readonly kind: "idle" }
  | { readonly kind: "available"; readonly requestId: string; readonly bootstrapExpiresAt: string }
  | { readonly kind: "pending"; readonly requestId: string }
  | { readonly kind: "finished"; readonly requestId: string; readonly status: "cancelled" | "failed" | "completed" };

export interface TargetBootstrapPort {
  status(): Promise<TargetBootstrapView>;
  cancel(requestId: string): Promise<TargetBootstrapView>;
}

export type TargetInstallationPhase = "claiming" | "downloading" | "installing" | "verifying" | "activating" | "authorizing";
export type TargetInstallationView =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly requestId: string; readonly phase: TargetInstallationPhase }
  | { readonly kind: "completed" | "existing_replica"; readonly requestId: string }
  | { readonly kind: "stopped"; readonly requestId: string; readonly status: "cancelled" | "failed" | "completed";
      readonly newWorkflow: "allowed" | "requires_recovery" | "awaiting_terminal" | "authorization_changed" | "history_full" };
export interface TargetInstallationPort {
  /** Persists one confirmation; Native owns all subsequent work and replay. */
  start(requestId: string): Promise<TargetInstallationView>;
  /** Reads local progress only; never initiates or retries an installation. */
  status(): Promise<TargetInstallationView>;
}

export type CloudflareConnectionStatusState = "not-configured" | "recovering" | "ready" | "busy" | "blocked";
export interface CloudflareConnectionStatus {
  readonly schemaVersion: 1;
  readonly state: CloudflareConnectionStatusState;
  readonly connectionRef: string | null;
  readonly displayLabel: string | null;
  /** False until Cloudflare DNS observation passes ADR-0027 qualification; nothing can run before then. */
  readonly qualified: boolean;
  /** Whether the current Host build has a Native token capture adapter. */
  readonly capturable: boolean;
  /** The latest Provider operation's closed outcome, or null when none ran this session. */
  readonly lastOperation: CloudflareProviderOperation | null;
  readonly readGeneration: number;
  readonly registrar: CloudflareRegistrarStatus | null;
}

export interface CloudflareRegistrarStatus {
  readonly lastScan: { readonly observed: number; readonly imported: number; readonly skipped: number; readonly completedAt: string } | null;
  readonly lastOutcome: "confirmed" | "unqualified" | "unreachable" | "retry_later" | "credential_rejected" | "provider_response_rejected" | "failed" | null;
}

export interface CloudflareProviderOperation {
  readonly kind: "activate" | "revoke" | "observe" | "purge";
  readonly outcome: "confirmed" | "unconfirmed" | "nothing_to_revoke" | "unqualified" | "zone_unimportable" | "unreachable" | "retry_later" | "credential_rejected" | "failed";
}

/** The only maintenance the Host admits for a refused credential (ADR-0028). */
export type CloudflareMaintenanceAction = "retire" | "retry_retirement" | "retry_revoke";
export interface CloudflareRetirementCandidate {
  readonly connectionRef: string;
  readonly displayLabel: string;
  readonly action: CloudflareMaintenanceAction;
}

export type CloudflareRecordType = "A" | "AAAA" | "CAA" | "CNAME" | "MX" | "NS" | "SRV" | "TXT";
export interface CloudflareObservation {
  readonly schemaVersion: 1;
  readonly readGeneration: number;
  readonly entityId: string;
  readonly observedAt: string | null;
  readonly version: number;
  readonly availability: "available" | "unavailable";
  readonly uncertainty: "confirmed" | "stale" | "conflicted" | "unknown";
  readonly zoneLabel: string | null;
  readonly zoneStatus: "active" | "pending" | "moved" | "unknown";
  readonly records: readonly {
    readonly recordId: string;
    readonly fqdn: string;
    readonly type: CloudflareRecordType;
    readonly displayValue: string;
    readonly ttl: number | null;
    readonly proxied: boolean;
    readonly providerVersionToken: number;
    readonly classification: "ordinary" | "redacted";
  }[];
}

/** The Cloudflare connection activation provisions into; it holds no credential yet. */
export interface CloudflareConnectionCreated {
  readonly schemaVersion: 1;
  readonly connectionRef: string;
  readonly displayLabel: string;
  /** False when a connection that was never activated is returned instead of adding another. */
  readonly created: boolean;
  readonly readGeneration: number;
}

export interface CloudflarePort {
  status(): Promise<CloudflareConnectionStatus>;
  /** Refused by the Host with `DESKTOP_CAPABILITY_UNQUALIFIED` until the capability is qualified. */
  create(displayLabel: string): Promise<CloudflareConnectionCreated>;
  /** Native opens the bounded credential capture; the token never enters this argument. */
  activate(connectionRef: string): Promise<void>;
  /** Queues revocation; the Host denies the credential at once and tombstones it in custody. */
  revoke(connectionRef: string): Promise<void>;
  retirementCandidates(): Promise<readonly CloudflareRetirementCandidate[]>;
  purge(connectionRef: string, action: "confirm_retirement" | "retry_pending"): Promise<void>;
  observe(connectionRef: string, entityId: string): Promise<void>;
  refreshRegistrar(connectionRef: string): Promise<void>;
  readObservation(entityId: string): Promise<CloudflareObservation>;
}

const commands = {
  status: "local_business_status",
  readAssetLibrary: "local_asset_library_read",
  readDomainDetail: "local_domain_detail_read",
  readDnsHealth: "local_dns_health_read",
  readSettings: "local_settings_read",
  repairStoredRows: "local_storage_repair",
  readRenewals: "local_renewals_read",
  readBatchOperations: "local_batch_operations_read",
  readHistory: "local_history_read",
  readManualTasks: "local_manual_tasks_read",
  readSales: "local_sales_read",
  createDomainAsset: "local_domain_asset_create",
  editDomainAsset: "local_domain_asset_edit",
  deleteDomainAsset: "local_domain_asset_delete",
  bindDomainAssetProvider: "local_domain_asset_provider_bind",
  conflictCenter: "local_conflict_center_read",
  resolveConflict: "local_conflict_resolve",
  localSyncStatus: "local_sync_status",
  readDeviceLease: "local_device_lease_read",
  deviceSwitchRequest: "device_switch_request",
  deviceSwitchAdvance: "device_switch_advance",
  deviceSwitchStatus: "device_switch_status",
  deviceSwitchCancel: "device_switch_cancel",
  cloudflareStatus: "cloudflare_connection_status",
  cloudflareActivate: "cloudflare_connection_activate",
  cloudflareCreate: "cloudflare_connection_create",
  cloudflareRevoke: "cloudflare_connection_revoke",
  cloudflarePurge: "cloudflare_connection_purge",
  cloudflareRetirementCandidates: "cloudflare_retirement_candidates",
  cloudflareObserve: "cloudflare_zone_observe",
  cloudflareObservationRead: "cloudflare_observation_read",
  cloudflareRegistrarRefresh: "cloudflare_registrar_inventory_refresh",
} as const;

export function createCloudflarePort(): CloudflarePort {
  const wire = (intent: object) => new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, ...intent }));
  return {
    async status() {
      return parseCloudflareStatus(await invoke(commands.cloudflareStatus));
    },
    async create(displayLabel) {
      // The Host applies the same label rule; refusing here keeps an invalid label off the wire.
      if (!connectionLabelSchema.safeParse(displayLabel).success) throw new TypeError("invalid Cloudflare connection label");
      return parseCloudflareConnectionCreated(await invoke(commands.cloudflareCreate, { request: { schemaVersion: 1, displayLabel } }));
    },
    async activate(connectionRef) {
      await invoke(commands.cloudflareActivate, wire({ connectionId: boundedOpaqueRef(connectionRef) }));
    },
    async revoke(connectionRef) {
      await invoke(commands.cloudflareRevoke, wire({ connectionId: boundedOpaqueRef(connectionRef) }));
    },
    async retirementCandidates() {
      return parseCloudflareRetirementCandidates(await invoke(commands.cloudflareRetirementCandidates));
    },
    async refreshRegistrar(connectionRef) {
      await invoke(commands.cloudflareRegistrarRefresh, wire({ connectionId: boundedOpaqueRef(connectionRef) }));
    },
    async purge(connectionRef, action) {
      if (action !== "confirm_retirement" && action !== "retry_pending") throw new TypeError("invalid retirement action");
      await invoke(commands.cloudflarePurge, wire({ connectionId: boundedOpaqueRef(connectionRef), action }));
    },
    async observe(connectionRef, entityId) {
      await invoke(commands.cloudflareObserve, wire({ connectionId: boundedOpaqueRef(connectionRef), entityId: boundedEntityId(entityId) }));
    },
    async readObservation(entityId) {
      return parseCloudflareObservation(await invoke(commands.cloudflareObservationRead, wire({ entityId: boundedEntityId(entityId) })));
    },
  };
}

export type DesktopAuthenticationStatus =
  | "unavailable"
  | "signed_out"
  | "pending"
  | "authorization_failed"
  | "authorization_retryable"
  | "authenticated";

export interface DesktopAuthenticationPort {
  status(): Promise<DesktopAuthenticationStatus>;
  begin(): Promise<void>;
  refresh(): Promise<void>;
  onStatus(listener: (status: DesktopAuthenticationStatus) => void): Promise<UnlistenFn>;
}

export type LocalReadErrorCode =
  | "LOCAL_READ_AUTHORIZATION_REQUIRED" | "LOCAL_ASSET_NOT_FOUND"
  | "LOCAL_WORKSPACE_REJECTED"
  | "LOCAL_QUERY_REJECTED" | "LOCAL_WINDOW_REJECTED" | "LOCAL_STORAGE_REJECTED"
  | "LOCAL_SCHEMA_REJECTED" | "LOCAL_PROJECTION_REJECTED" | "LOCAL_REVISION_REJECTED"
  | "LOCAL_RESPONSE_REJECTED";

export class LocalReadError extends Error {
  constructor(readonly code: LocalReadErrorCode) { super(code); this.name = "LocalReadError"; }
}

/** DNS health windows from the Host; a response from any other provenance is rejected. */
export function createLocalDnsHealthPort(): DnsHealthPort {
  return {
    async loadDnsHealth(request): Promise<DnsHealthRead> {
      let validatedRequest;
      try { validatedRequest = dnsHealthWindowRequestSchema.parse(request); }
      catch { throw new LocalReadError("LOCAL_WINDOW_REJECTED"); }
      try {
        const value = parseDnsHealthRead(await invoke(commands.readDnsHealth, { request: validatedRequest }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
  };
}

/** Operation plan windows from the Host; any other provenance is rejected. */
export function createLocalBatchOperationsPort(): BatchOperationsReadPort {
  return {
    async loadBatchOperations(request): Promise<BatchOperationsRead> {
      let validatedRequest;
      try { validatedRequest = batchOperationsWindowRequestSchema.parse(request); }
      catch { throw new LocalReadError("LOCAL_WINDOW_REJECTED"); }
      try {
        const value = parseBatchOperationsRead(await invoke(commands.readBatchOperations, { request: validatedRequest }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
  };
}

/** Revision ledger windows from the Host; any other provenance is rejected. */
export function createLocalHistoryPort(): HistoryReadPort {
  return {
    async loadHistory(request): Promise<HistoryRead> {
      let validatedRequest;
      try { validatedRequest = historyWindowRequestSchema.parse(request); }
      catch { throw new LocalReadError("LOCAL_WINDOW_REJECTED"); }
      try {
        const value = parseHistoryRead(await invoke(commands.readHistory, { request: validatedRequest }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
  };
}

/** Manual task windows from the Host; any other provenance is rejected. */
export function createLocalManualTasksPort(): ManualTasksReadPort {
  return {
    async loadManualTasks(request): Promise<ManualTasksRead> {
      let validatedRequest;
      try { validatedRequest = manualTasksWindowRequestSchema.parse(request); }
      catch { throw new LocalReadError("LOCAL_WINDOW_REJECTED"); }
      try {
        const value = parseManualTasksRead(await invoke(commands.readManualTasks, { request: validatedRequest }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
  };
}

/** Expiring-asset windows from the Host; any other provenance is rejected. */
export function createLocalRenewalsPort(): RenewalsReadPort {
  return {
    async loadRenewals(request): Promise<RenewalsRead> {
      let validatedRequest;
      try { validatedRequest = renewalsWindowRequestSchema.parse(request); }
      catch { throw new LocalReadError("LOCAL_WINDOW_REJECTED"); }
      try {
        const value = parseRenewalsRead(await invoke(commands.readRenewals, { request: validatedRequest }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
  };
}

/** Observed marketplace listing windows from the Host; any other provenance is rejected. */
export function createLocalSalesPort(): SalesReadPort {
  return {
    async loadSales(request): Promise<SalesRead> {
      let validatedRequest;
      try { validatedRequest = salesWindowRequestSchema.parse(request); }
      catch { throw new LocalReadError("LOCAL_WINDOW_REJECTED"); }
      try {
        const value = parseSalesRead(await invoke(commands.readSales, { request: validatedRequest }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
  };
}

/** Redacted Provider connections and role availability; any other provenance is rejected. */
export function createLocalSettingsPort(): SettingsReadPort {
  return {
    async loadSettings(): Promise<SettingsRead> {
      try {
        const value = parseSettingsRead(await invoke(commands.readSettings));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
    async repairStoredRows(request) {
      // Only a closed category and a read generation reach the Host; no row identity or value.
      const validatedRequest = storageRepairRequestSchema.parse(request);
      return parseStorageRepairReceipt(
        await invoke(commands.repairStoredRows, { request: validatedRequest }),
        validatedRequest.repairKind,
      );
    },
  };
}

export function createLocalPortfolioPresentationPort(): ValidatedPortfolioPresentationPort {
  return {
    async loadAssetLibrary(request): Promise<AssetLibraryViewModel> {
      let validatedRequest;
      try {
        validatedRequest = assetLibraryWindowRequestSchema.parse({
          ...request,
          query: parseAssetLibraryQuery(request.query),
        });
      } catch (error) {
        const queryValid = (() => {
          try { parseAssetLibraryQuery(request.query); return true; } catch { return false; }
        })();
        throw new LocalReadError(queryValid ? "LOCAL_WINDOW_REJECTED" : "LOCAL_QUERY_REJECTED");
      }
      try {
        const value = parseAssetLibraryViewModel(await invoke(commands.readAssetLibrary, { request: validatedRequest }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
    async loadDomainDetail(entityId): Promise<DomainDetailViewModel> {
      let validatedEntityId: string;
      try { validatedEntityId = canonicalDomainNameSchema.parse(entityId); }
      catch { throw new LocalReadError("LOCAL_QUERY_REJECTED"); }
      try {
        const value = parseDomainDetailViewModel(await invoke(commands.readDomainDetail, { request: { entityId: validatedEntityId } }));
        if ((value.freshness.source === "standby_cloud") !== (value.freshness.readOnlyReason === "standby")) throw new TypeError("local read provenance is invalid");
        return value;
      }
      catch (error) { throw mapLocalReadError(error); }
    },
  };
}

const authenticationCommands = {
  status: "desktop_authentication_status",
  begin: "desktop_authentication_begin",
  refresh: "desktop_authentication_refresh",
} as const;

/** Only sanitized state crosses IPC; OAuth URLs and bearer credentials remain native-only. */
export function createDesktopAuthenticationPort(): DesktopAuthenticationPort {
  return {
    async status() {
      return parseAuthenticationStatus(await invoke(authenticationCommands.status));
    },
    async begin() {
      await invoke(authenticationCommands.begin);
    },
    async refresh() {
      await invoke(authenticationCommands.refresh);
    },
    async onStatus(listener) {
      return listen<unknown>("desktop-authentication-status", (event) => {
        listener(parseAuthenticationStatus(event.payload));
      });
    },
  };
}

/** The adapter exposes only named local business capabilities; it has no path, key, SQL, or Cloud API. */
export function createLocalBusinessPort(): LocalBusinessPort & PortfolioProviderBindingPort {
  const providerBinding = new ValidatingPortfolioProviderBindingPort({
    async bindDomainAssetProvider(request) {
      return invoke(commands.bindDomainAssetProvider, { request });
    },
  });
  return {
    async status() {
      return parseStatus(await invoke(commands.status));
    },
    async createDomainAsset(request) {
      const parsed = localDomainAssetCreateRequestSchema.parse(request);
      let receipt: unknown;
      try {
        receipt = await invoke(commands.createDomainAsset, { request: parsed });
      } catch (error) {
        const named = localWriteErrorCodes.find((code) => code === error);
        if (named !== undefined) throw new LocalWriteError(named);
        throw error;
      }
      const parsedReceipt = localDomainAssetMutationReceiptSchema.parse(receipt);
      // The Host answers for the request it was given; anything else is not this write's receipt.
      if (!(parsedReceipt.operation === "create" || parsedReceipt.operation === "re_add") || parsedReceipt.entityId !== parsed.asset.entityId || parsedReceipt.mutationId !== parsed.mutationId) {
        throw new TypeError("create receipt does not match the request");
      }
      return parsedReceipt;
    },
    async editDomainAsset(request) {
      const parsed = localDomainAssetEditRequestSchema.parse(request);
      return localDomainAssetMutationReceiptSchema.parse(await invoke(commands.editDomainAsset, { request: parsed }));
    },
    async deleteDomainAsset(request) {
      const parsed = localDomainAssetDeleteRequestSchema.parse(request);
      return localDomainAssetMutationReceiptSchema.parse(await invoke(commands.deleteDomainAsset, { request: parsed }));
    },
    async bindDomainAssetProvider(request) {
      return providerBinding.bindDomainAssetProvider(request);
    },
  };
}

export function createLocalConflictPort(): LocalConflictPort {
  return {
    async conflictCenter() { return parseConflictCenterViewModel(await invoke(commands.conflictCenter)); },
    async resolveConflict(request) {
      const parsed = conflictResolutionIntentSchema.parse(request);
      return parseConflictResolutionReceipt(await invoke(commands.resolveConflict, { request: parsed }));
    },
  };
}

export function createLocalSyncStatusPort(): LocalSyncStatusPort {
  return { async status() { return parseSyncSnapshotViewModel(await invoke(commands.localSyncStatus)); } };
}

export function createLocalDeviceLeasePort(): LocalDeviceLeasePort {
  return { async read() { return parseDeviceLease(await invoke(commands.readDeviceLease)); } };
}

export function createDeviceSwitchPort(): DeviceSwitchPort {
  const call = async (command: string, args?: Record<string, unknown>) => {
    let view: unknown;
    try {
      view = await invoke(command, args);
    } catch (error) {
      const named = deviceSwitchErrorCodes.find((code) => code === error);
      if (named !== undefined) throw new DeviceSwitchError(named);
      throw error;
    }
    return parseDeviceSwitchStep(view);
  };
  return {
    async request(toDeviceId) {
      // The Host applies the same identifier rule; refusing here keeps an invalid id off the wire.
      if (!isPrintableIdentifier(toDeviceId, 160)) throw new TypeError("invalid target device");
      return call(commands.deviceSwitchRequest, { request: { schemaVersion: 1, toDeviceId } });
    },
    async advance() { return call(commands.deviceSwitchAdvance); },
    async status() { return call(commands.deviceSwitchStatus); },
    async cancel() { return call(commands.deviceSwitchCancel); },
  };
}

function isPrintableIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && [...value].every((char) => { const code = char.codePointAt(0) ?? 0; return code >= 0x21 && code <= 0x7e; });
}

export function createTargetBootstrapPort(): TargetBootstrapPort {
  return {
    async status() { return parseTargetBootstrapView(await invoke<unknown>("target_bootstrap_status")); },
    async cancel(requestId) {
      if (!isPrintableIdentifier(requestId, 160)) throw new TypeError("invalid bootstrap request");
      return parseTargetBootstrapView(await invoke<unknown>("target_bootstrap_cancel", { request: { schemaVersion: 1, requestId } }));
    },
  };
}

export function createTargetInstallationPort(): TargetInstallationPort {
  return {
    async status() { return parseTargetInstallationView(await invoke<unknown>("target_installation_status")); },
    async start(requestId) {
      if (!isPrintableIdentifier(requestId, 160)) throw new TypeError("invalid installation request");
      const view = parseTargetInstallationView(await invoke<unknown>("target_installation_start", { request: { schemaVersion: 1, requestId } }));
      if (view.kind === "idle" || view.requestId !== requestId) throw new TypeError("installation identity mismatch");
      return view;
    },
  };
}
function parseTargetInstallationView(value: unknown): TargetInstallationView {
  const data = copyPlainData(value);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new TypeError("invalid installation view");
  const kind = (data as Record<string, unknown>)["kind"];
  const fields = kind === "idle" ? ["schemaVersion", "kind"] : kind === "running"
    ? ["schemaVersion", "kind", "requestId", "phase"] : kind === "stopped"
      ? ["schemaVersion", "kind", "requestId", "status", "newWorkflow"] : ["schemaVersion", "kind", "requestId"];
  const record = exactRecord(data, fields);
  if (record["schemaVersion"] !== 1) throw new TypeError("invalid installation version");
  if (kind === "idle") return Object.freeze({ kind });
  const requestId = record["requestId"];
  if (!isPrintableIdentifier(requestId, 160)) throw new TypeError("invalid installation identity");
  if (kind === "completed" || kind === "existing_replica") return Object.freeze({ kind, requestId });
  const phase = record["phase"];
  if (kind === "running" && (phase === "claiming" || phase === "downloading" || phase === "installing" || phase === "verifying" || phase === "activating" || phase === "authorizing")) return Object.freeze({ kind, requestId, phase });
  const status = record["status"];
  const newWorkflow = record["newWorkflow"];
  if (kind === "stopped" && (status === "cancelled" || status === "failed" || status === "completed")
    && (newWorkflow === "allowed" || newWorkflow === "requires_recovery" || newWorkflow === "awaiting_terminal"
      || newWorkflow === "authorization_changed" || newWorkflow === "history_full")
    && !(status === "completed" && newWorkflow === "allowed")) return Object.freeze({ kind, requestId, status, newWorkflow });
  throw new TypeError("invalid installation state");
}

function parseTargetBootstrapView(value: unknown): TargetBootstrapView {
  const data = copyPlainData(value);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new TypeError("invalid target bootstrap view");
  const kind = (data as Record<string, unknown>)["kind"];
  const fields = kind === "idle" ? ["schemaVersion", "kind"] : kind === "available"
    ? ["schemaVersion", "kind", "requestId", "bootstrapExpiresAt"] : kind === "pending"
      ? ["schemaVersion", "kind", "requestId"] : ["schemaVersion", "kind", "requestId", "status"];
  const record = exactRecord(data, fields);
  if (record["schemaVersion"] !== 1) throw new TypeError("invalid target bootstrap version");
  if (kind === "idle") return Object.freeze({ kind });
  const requestId = record["requestId"];
  if (!isPrintableIdentifier(requestId, 160)) throw new TypeError("invalid target bootstrap identity");
  if (kind === "pending") return Object.freeze({ kind, requestId });
  const bootstrapExpiresAt = record["bootstrapExpiresAt"];
  if (kind === "available" && typeof bootstrapExpiresAt === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(bootstrapExpiresAt)
      && Number.isFinite(Date.parse(bootstrapExpiresAt))
      && new Date(bootstrapExpiresAt).toISOString().replace(".000Z", "Z") === bootstrapExpiresAt) {
    return Object.freeze({ kind, requestId, bootstrapExpiresAt });
  }
  const status = record["status"];
  if (kind === "finished" && (status === "cancelled" || status === "failed" || status === "completed")) {
    return Object.freeze({ kind, requestId, status });
  }
  throw new TypeError("invalid target bootstrap state");
}

function parseDeviceSwitchStep(value: unknown): DeviceSwitchStep {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "step", "unconfirmed", "frozenUnresolved", "status", "rejection"]);
  const { step, unconfirmed, frozenUnresolved, status, rejection } = record;
  if (frozenUnresolved !== null && (!Number.isSafeInteger(frozenUnresolved) || (frozenUnresolved as number) < 0)) throw new TypeError("invalid frozen outcome count");
  const frozen = frozenUnresolved as number | null;
  const empty = (...fields: unknown[]) => fields.every((field) => field === null);
  if (record["schemaVersion"] === 1) {
    if (step === "request_pending" && empty(unconfirmed, status, rejection)) return Object.freeze({ frozenUnresolved: frozen, kind: "request_pending" });
    if (step === "idle" && empty(unconfirmed, status, rejection)) return Object.freeze({ frozenUnresolved: frozen, kind: "idle" });
    if (step === "blocked" && empty(unconfirmed, status, rejection)) return Object.freeze({ frozenUnresolved: frozen, kind: "blocked" });
    if (step === "receipts_missing" && empty(unconfirmed, status, rejection)) return Object.freeze({ frozenUnresolved: frozen, kind: "receipts_missing" });
    if (step === "writes_reopened" && empty(unconfirmed, status, rejection)) return Object.freeze({ frozenUnresolved: frozen, kind: "writes_reopened" });
    if (step === "waiting_for_sync" && empty(status, rejection) && Number.isSafeInteger(unconfirmed) && (unconfirmed as number) >= 0) {
      return Object.freeze({ frozenUnresolved: frozen, kind: "waiting_for_sync", unconfirmed: unconfirmed as number });
    }
    const knownStatus = deviceSwitchStatuses.find((candidate) => candidate === status);
    if (step === "switch" && empty(unconfirmed, rejection) && knownStatus !== undefined) {
      return Object.freeze({ frozenUnresolved: frozen, kind: "switch", status: knownStatus });
    }
    const knownRejection = deviceSwitchRejections.find((candidate) => candidate === rejection);
    if (step === "rejected" && empty(unconfirmed, status) && knownRejection !== undefined) {
      return Object.freeze({ frozenUnresolved: frozen, kind: "rejected", rejection: knownRejection });
    }
  }
  throw new TypeError("invalid device switch step");
}

function parseDeviceLease(value: unknown): LocalDeviceLease {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "deviceId", "leaseEpoch"]);
  const deviceId = record["deviceId"];
  if (
    record["schemaVersion"] !== 1
    || typeof deviceId !== "string" || deviceId.length === 0 || deviceId.length > 128
    // The Host admits only printable ASCII device identifiers; anything else is not its value.
    || [...deviceId].some((char) => { const code = char.codePointAt(0) ?? 0; return code < 0x21 || code > 0x7e; })
    || !Number.isSafeInteger(record["leaseEpoch"]) || (record["leaseEpoch"] as number) < 1
  ) {
    throw new TypeError("invalid device lease");
  }
  return Object.freeze({ schemaVersion: 1, deviceId, leaseEpoch: record["leaseEpoch"] as number });
}

function parseStatus(value: unknown): LocalBusinessStatus {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "state", "capabilities", "readGeneration"]);
  const states = [
    "activation_required",
    "security_locked",
    "retryable_locked",
    "commercial_read_only",
    "target_installation_pending",
    "standby_awaiting_replica",
    "standby_read_only",
    "active",
  ] as const;
  if (
    record["schemaVersion"] !== 2 ||
    !states.includes(record["state"] as (typeof states)[number]) ||
    (!Number.isSafeInteger(record["readGeneration"]) || (record["readGeneration"] as number) < 0) ||
    !Array.isArray(record["capabilities"]) ||
    !record["capabilities"].every((capability) =>
      capability === "local:read" || capability === "workspace:mutate")
  ) {
    throw new TypeError("invalid local business status");
  }
  const capabilities = record["capabilities"] as ("local:read" | "workspace:mutate")[];
  const expected = record["state"] === "active"
    ? ["local:read", "workspace:mutate"]
    : record["state"] === "commercial_read_only" || record["state"] === "standby_read_only"
      ? ["local:read"]
      : [];
  if (capabilities.length !== expected.length || capabilities.some((value, index) => value !== expected[index])) {
    throw new TypeError("invalid local business capabilities");
  }
  return Object.freeze({
    schemaVersion: 2,
    state: record["state"] as LocalBusinessStatus["state"],
    capabilities: Object.freeze([...capabilities]),
    readGeneration: record["readGeneration"] as number,
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid local business response");
  }
  const record = value as Record<string, unknown>;
  const observed = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (observed.length !== expected.length || observed.some((key, index) => key !== expected[index])) {
    throw new TypeError("invalid local business response shape");
  }
  return record;
}

function parseCloudflareConnectionCreated(value: unknown): CloudflareConnectionCreated {
  const keys = ["connectionRef", "created", "displayLabel", "readGeneration", "schemaVersion"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid Cloudflare connection");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== keys.join()) throw new TypeError("invalid Cloudflare connection");
  const { schemaVersion, connectionRef, displayLabel, created, readGeneration } = record;
  if (schemaVersion !== 1 || typeof connectionRef !== "string" || !connectionLabelSchema.safeParse(displayLabel).success
    || typeof created !== "boolean" || typeof readGeneration !== "number"
    || !Number.isSafeInteger(readGeneration) || readGeneration < 0) throw new TypeError("invalid Cloudflare connection");
  return { schemaVersion, connectionRef: boundedOpaqueRef(connectionRef), displayLabel: displayLabel as string, created, readGeneration };
}

/** A connection label under the one label rule every Host read applies, or none. */
function connectionLabel(value: unknown): string | null {
  if (value === null) return null;
  const parsed = connectionLabelSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("invalid Cloudflare connection label");
  return parsed.data;
}

function boundedOpaqueRef(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x21 || code > 0x7e;
  })) throw new TypeError("invalid Cloudflare connection reference");
  return value;
}

function boundedEntityId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 253 || value !== value.toLowerCase()
    || !value.includes(".") || value.split(".").some((label) => label.length === 0 || label.length > 63)) {
    throw new TypeError("invalid Cloudflare entity id");
  }
  return value;
}

function parseCloudflareRetirementCandidates(value: unknown): readonly CloudflareRetirementCandidate[] {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "candidates"]);
  if (record.schemaVersion !== 1 || !Array.isArray(record.candidates) || record.candidates.length > 64) {
    throw new TypeError("invalid retirement candidates");
  }
  const seen = new Set<string>();
  return Object.freeze(record.candidates.map((value: unknown) => {
    const candidate = exactRecord(value, ["connectionRef", "displayLabel", "action"]);
    const actions: readonly CloudflareMaintenanceAction[] = ["retire", "retry_retirement", "retry_revoke"];
    const action = actions.find((item) => item === candidate.action);
    if (typeof candidate.connectionRef !== "string" || action === undefined
      || !connectionLabelSchema.safeParse(candidate.displayLabel).success || typeof candidate.displayLabel !== "string") {
      throw new TypeError("invalid retirement candidate");
    }
    const connectionRef = boundedOpaqueRef(candidate.connectionRef);
    if (seen.has(connectionRef)) throw new TypeError("duplicate retirement candidate");
    seen.add(connectionRef);
    return Object.freeze({ connectionRef, displayLabel: candidate.displayLabel, action });
  }));
}

function parseProviderOperation(value: unknown): CloudflareProviderOperation | null {
  if (value === null) return null;
  const record = exactRecord(value, ["kind", "outcome"]);
  const kinds: readonly CloudflareProviderOperation["kind"][] = ["activate", "revoke", "observe", "purge"];
  const outcomes: readonly CloudflareProviderOperation["outcome"][] = ["confirmed", "unconfirmed", "nothing_to_revoke", "unqualified", "zone_unimportable", "unreachable", "retry_later", "credential_rejected", "failed"];
  // Only a Provider call can be unreachable, asked to retry, or refuse the credential; a
  // revocation makes none, it only withdraws this device's custody.
  const providerOutcomes: readonly CloudflareProviderOperation["outcome"][] = ["unreachable", "retry_later", "credential_rejected"];
  const kind = kinds.find((candidate) => candidate === record.kind);
  const outcome = outcomes.find((candidate) => candidate === record.outcome);
  // Only a revocation can find nothing to revoke.
  if (kind === undefined || outcome === undefined || (outcome === "nothing_to_revoke" && kind !== "revoke")
    || (providerOutcomes.includes(outcome) && (kind === "revoke" || kind === "purge"))
    || (kind === "purge" && !["confirmed", "unconfirmed", "failed"].includes(outcome))
    // Only an activation imports a Zone.
    || (outcome === "zone_unimportable" && kind !== "activate")) {
    throw new TypeError("invalid Cloudflare operation outcome");
  }
  return Object.freeze({ kind, outcome });
}

function parseCloudflareStatus(value: unknown): CloudflareConnectionStatus {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "state", "connectionRef", "displayLabel", "qualified", "capturable", "lastOperation", "readGeneration", "registrar"]);
  const states: readonly CloudflareConnectionStatusState[] = ["not-configured", "recovering", "ready", "busy", "blocked"];
  const bounded = (field: unknown): string | null => field === null ? null
    : typeof field === "string" && field.length > 0 && field.length <= 256 && [...field].every((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    }) ? field : (() => { throw new TypeError("invalid Cloudflare status text"); })();
  if (record.schemaVersion !== 1 || !states.includes(record.state as CloudflareConnectionStatusState)
    || typeof record.qualified !== "boolean" || typeof record.capturable !== "boolean"
    || !Number.isSafeInteger(record.readGeneration) || (record.readGeneration as number) < 0) {
    throw new TypeError("invalid Cloudflare status");
  }
  const connectionRef = bounded(record.connectionRef);
  const registrar = parseCloudflareRegistrarStatus(record.registrar);
  if (registrar !== null && (connectionRef === null || record.state === "not-configured")) {
    throw new TypeError("invalid Cloudflare Registrar connection");
  }
  return Object.freeze({
    schemaVersion: 1,
    state: record.state as CloudflareConnectionStatusState,
    connectionRef,
    displayLabel: connectionLabel(record.displayLabel),
    qualified: record.qualified,
    capturable: record.capturable,
    lastOperation: parseProviderOperation(record.lastOperation),
    readGeneration: record.readGeneration as number,
    registrar,
  });
}

function parseCloudflareRegistrarStatus(value: unknown): CloudflareRegistrarStatus | null {
  if (value === null) return null;
  const { lastScan, lastOutcome } = exactRecord(value, ["lastScan", "lastOutcome"]);
  const outcomes: readonly unknown[] = [null, "confirmed", "unqualified", "unreachable", "retry_later", "credential_rejected", "provider_response_rejected", "failed"];
  if (!outcomes.includes(lastOutcome)) throw new TypeError("invalid Cloudflare Registrar outcome");
  const outcome = lastOutcome as CloudflareRegistrarStatus["lastOutcome"];
  if (lastScan === null) return Object.freeze({ lastScan: null, lastOutcome: outcome });
  const { observed, imported, skipped, completedAt } = exactRecord(lastScan, ["observed", "imported", "skipped", "completedAt"]);
  const count = (field: unknown): field is number => typeof field === "number" && Number.isSafeInteger(field) && field >= 0 && field <= 10_000;
  if (!count(observed) || !count(imported) || !count(skipped) || imported + skipped > observed
    || typeof completedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(completedAt)
    || !Number.isFinite(Date.parse(completedAt)) || new Date(completedAt).toISOString() !== completedAt.replace(/Z$/u, ".000Z")) {
    throw new TypeError("invalid Cloudflare Registrar scan");
  }
  return Object.freeze({ lastScan: Object.freeze({ observed, imported, skipped, completedAt }), lastOutcome: outcome });
}

function parseCloudflareObservation(value: unknown): CloudflareObservation {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "readGeneration", "entityId", "observedAt", "version", "availability", "uncertainty", "zoneLabel", "zoneStatus", "records"]);
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.readGeneration) || (record.readGeneration as number) < 0
    || !Number.isSafeInteger(record.version) || (record.version as number) < 0 || typeof record.entityId !== "string"
    || (record.entityId as string).length > 253 || (record.observedAt !== null && typeof record.observedAt !== "string")
    || (record.observedAt !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(record.observedAt as string))
    || (record.availability !== "available" && record.availability !== "unavailable")
    || !["confirmed", "stale", "conflicted", "unknown"].includes(record.uncertainty as string)
    || (record.zoneLabel !== null && (typeof record.zoneLabel !== "string" || (record.zoneLabel as string).length > 253))
    || !["active", "pending", "moved", "unknown"].includes(record.zoneStatus as string)
    || !Array.isArray(record.records) || record.records.length > 1024) throw new TypeError("invalid Cloudflare observation");
  const records = record.records.map((item): CloudflareObservation["records"][number] => {
    const r = exactRecord(copyPlainData(item), ["recordId", "fqdn", "type", "displayValue", "ttl", "proxied", "providerVersionToken", "classification"]);
    if (typeof r.recordId !== "string" || r.recordId.length === 0 || r.recordId.length > 256
      || typeof r.fqdn !== "string" || r.fqdn.length === 0 || r.fqdn.length > 253
      || !["A", "AAAA", "CAA", "CNAME", "MX", "NS", "SRV", "TXT"].includes(r.type as string)
      || typeof r.displayValue !== "string" || r.displayValue.length > 1024
      || (r.ttl !== null && (!Number.isSafeInteger(r.ttl) || (r.ttl as number) < 0)) || typeof r.proxied !== "boolean"
      || !Number.isSafeInteger(r.providerVersionToken) || (r.providerVersionToken as number) < 0
      || (r.classification !== "ordinary" && r.classification !== "redacted")) throw new TypeError("invalid Cloudflare observation record");
    return Object.freeze({ recordId: r.recordId, fqdn: r.fqdn, type: r.type as CloudflareRecordType, displayValue: r.displayValue, ttl: r.ttl as number | null, proxied: r.proxied, providerVersionToken: r.providerVersionToken as number, classification: r.classification as "ordinary" | "redacted" });
  });
  return Object.freeze({ schemaVersion: 1, readGeneration: record.readGeneration as number, entityId: record.entityId as string, observedAt: record.observedAt as string | null, version: record.version as number, availability: record.availability as "available" | "unavailable", uncertainty: record.uncertainty as CloudflareObservation["uncertainty"], zoneLabel: record.zoneLabel as string | null, zoneStatus: record.zoneStatus as CloudflareObservation["zoneStatus"], records: Object.freeze(records) });
}

function mapLocalReadError(error: unknown): LocalReadError {
  const allowed = new Set<LocalReadErrorCode>([
    "LOCAL_READ_AUTHORIZATION_REQUIRED", "LOCAL_ASSET_NOT_FOUND", "LOCAL_WORKSPACE_REJECTED", "LOCAL_QUERY_REJECTED",
    "LOCAL_WINDOW_REJECTED", "LOCAL_STORAGE_REJECTED", "LOCAL_SCHEMA_REJECTED",
    "LOCAL_PROJECTION_REJECTED", "LOCAL_REVISION_REJECTED", "LOCAL_RESPONSE_REJECTED",
  ]);
  if (typeof error === "string" && allowed.has(error as LocalReadErrorCode)) return new LocalReadError(error as LocalReadErrorCode);
  return new LocalReadError("LOCAL_RESPONSE_REJECTED");
}

function parseAuthenticationStatus(value: unknown): DesktopAuthenticationStatus {
  if (
    value !== "unavailable" && value !== "signed_out"
    && value !== "pending" && value !== "authorization_failed"
    && value !== "authorization_retryable" && value !== "authenticated"
  ) throw new TypeError("invalid Desktop authentication status");
  return value;
}

export {
  createDesktopWindowControlsPort,
  detectDesktopWindowPlatform,
  type DesktopWindowControlsPort,
  type DesktopWindowPlatform,
} from "./window-controls";

export function createDeviceDirectoryPort(): DeviceDirectorySettingsPort {
  return {
    async read() {
      return parseDeviceDirectoryView(await invoke<unknown>("device_directory_read"));
    },
    async reportSelf(intent) {
      const parsed = deviceSelfNameIntentSchema.safeParse(copyPlainData(intent));
      if (!parsed.success) throw new TypeError("invalid device name intent");
      return parseDeviceDirectoryView(await invoke<unknown>("device_self_report", new TextEncoder().encode(JSON.stringify(parsed.data))));
    },
  };
}
export { createAfternicPort } from "./afternic";
export { createSpaceshipRegistrarPort } from "./spaceship-registrar";
export { createAliyunRegistrarPort } from "./aliyun-registrar";
export { createGoDaddyRegistrarPort } from "./godaddy-registrar";
export { createAtomMarketplacePort } from "./atom-marketplace";
export { createAfternicDelistPort } from "./afternic-delist";
export { createForcedTakeoverPort, type ForcedTakeoverPort, type ForcedTakeoverPreview,
  type ForcedTakeoverView, type ForcedTakeoverPreviewReason, type ForcedTakeoverStoppedReason } from "./forced-takeover";

export { createAfternicListingWritePort } from "./afternic-listing-write";
export { createAfternicListingPlanPort } from "./afternic-listing-plan";

export { createCloudflareRegistrarAccountPort } from "./cloudflare-registrar-account";
export { createSellerHubPort } from "./sellerhub";
