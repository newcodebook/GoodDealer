import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  copyPlainData,
  assetLibraryWindowRequestSchema,
  canonicalDomainNameSchema,
  parseAssetLibraryQuery,
  parseAssetLibraryViewModel,
  parseDomainDetailViewModel,
  localDomainAssetEditRequestSchema,
  localDomainAssetDeleteRequestSchema,
  localDomainAssetMutationReceiptSchema,
  parseConflictCenterViewModel,
  parseConflictResolutionReceipt,
  parseSyncSnapshotViewModel,
  conflictResolutionIntentSchema,
  type ConflictCenterViewModel,
  type ConflictResolutionIntent,
  type ConflictResolutionReceipt,
  type SyncSnapshotViewModel,
  type LocalDomainAssetEditRequest,
  type LocalDomainAssetDeleteRequest,
  type LocalDomainAssetMutationReceipt,
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
    | "standby_read_only"
    | "active";
  readonly capabilities: readonly ("local:read" | "workspace:mutate")[];
  readonly readGeneration: number;
}

export interface LocalBusinessPort {
  status(): Promise<LocalBusinessStatus>;
  editDomainAsset(request: LocalDomainAssetEditRequest): Promise<LocalDomainAssetMutationReceipt>;
  deleteDomainAsset(request: LocalDomainAssetDeleteRequest): Promise<LocalDomainAssetMutationReceipt>;
}

export interface LocalConflictPort {
  conflictCenter(): Promise<ConflictCenterViewModel>;
  resolveConflict(request: ConflictResolutionIntent): Promise<ConflictResolutionReceipt>;
}

export interface LocalSyncStatusPort {
  status(): Promise<SyncSnapshotViewModel>;
}

export type CloudflareConnectionStatusState = "not-configured" | "recovering" | "ready" | "busy" | "blocked";
export interface CloudflareConnectionStatus {
  readonly schemaVersion: 1;
  readonly state: CloudflareConnectionStatusState;
  readonly connectionRef: string | null;
  readonly displayLabel: string | null;
  readonly readGeneration: number;
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

export interface CloudflarePort {
  status(): Promise<CloudflareConnectionStatus>;
  /** Native opens the bounded credential capture; the token never enters this argument. */
  activate(connectionRef: string): Promise<void>;
  observe(connectionRef: string, entityId: string): Promise<void>;
  readObservation(entityId: string): Promise<CloudflareObservation>;
}

const commands = {
  status: "local_business_status",
  readAssetLibrary: "local_asset_library_read",
  readDomainDetail: "local_domain_detail_read",
  editDomainAsset: "local_domain_asset_edit",
  deleteDomainAsset: "local_domain_asset_delete",
  conflictCenter: "local_conflict_center_read",
  resolveConflict: "local_conflict_resolve",
  localSyncStatus: "local_sync_status",
  cloudflareStatus: "cloudflare_connection_status",
  cloudflareActivate: "cloudflare_connection_activate",
  cloudflareObserve: "cloudflare_zone_observe",
  cloudflareObservationRead: "cloudflare_observation_read",
} as const;

export function createCloudflarePort(): CloudflarePort {
  return {
    async status() {
      return parseCloudflareStatus(await invoke(commands.cloudflareStatus));
    },
    async activate(connectionRef) {
      await invoke(commands.cloudflareActivate, { request: { schemaVersion: 1, connectionId: boundedOpaqueRef(connectionRef) } });
    },
    async observe(connectionRef, entityId) {
      await invoke(commands.cloudflareObserve, {
        request: { schemaVersion: 1, connectionId: boundedOpaqueRef(connectionRef), entityId: boundedEntityId(entityId) },
      });
    },
    async readObservation(entityId) {
      return parseCloudflareObservation(await invoke(commands.cloudflareObservationRead, {
        request: { schemaVersion: 1, entityId: boundedEntityId(entityId) },
      }));
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
        if (value.freshness.source !== "active_local") throw new TypeError("local read provenance is invalid");
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
        if (value.freshness.source !== "active_local") throw new TypeError("local read provenance is invalid");
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
export function createLocalBusinessPort(): LocalBusinessPort {
  return {
    async status() {
      return parseStatus(await invoke(commands.status));
    },
    async editDomainAsset(request) {
      const parsed = localDomainAssetEditRequestSchema.parse(request);
      return localDomainAssetMutationReceiptSchema.parse(await invoke(commands.editDomainAsset, { request: parsed }));
    },
    async deleteDomainAsset(request) {
      const parsed = localDomainAssetDeleteRequestSchema.parse(request);
      return localDomainAssetMutationReceiptSchema.parse(await invoke(commands.deleteDomainAsset, { request: parsed }));
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

function parseStatus(value: unknown): LocalBusinessStatus {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "state", "capabilities", "readGeneration"]);
  const states = [
    "activation_required",
    "security_locked",
    "retryable_locked",
    "commercial_read_only",
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

function parseCloudflareStatus(value: unknown): CloudflareConnectionStatus {
  const record = exactRecord(copyPlainData(value), ["schemaVersion", "state", "connectionRef", "displayLabel", "readGeneration"]);
  const states: readonly CloudflareConnectionStatusState[] = ["not-configured", "recovering", "ready", "busy", "blocked"];
  const bounded = (field: unknown): string | null => field === null ? null
    : typeof field === "string" && field.length > 0 && field.length <= 256 && [...field].every((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    }) ? field : (() => { throw new TypeError("invalid Cloudflare status text"); })();
  if (record.schemaVersion !== 1 || !states.includes(record.state as CloudflareConnectionStatusState)
    || !Number.isSafeInteger(record.readGeneration) || (record.readGeneration as number) < 0) {
    throw new TypeError("invalid Cloudflare status");
  }
  return Object.freeze({
    schemaVersion: 1,
    state: record.state as CloudflareConnectionStatusState,
    connectionRef: bounded(record.connectionRef),
    displayLabel: bounded(record.displayLabel),
    readGeneration: record.readGeneration as number,
  });
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
