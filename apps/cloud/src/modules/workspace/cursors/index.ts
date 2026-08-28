import type { MutationPage } from "@gooddealer/protocol/workspace";

import type { WorkspaceTenantScope } from "../tenant-scope";
import { workspaceTenantKey } from "../tenant-scope";

interface WorkspaceScopeResolverPort {
  resolveWorkspace(scope: WorkspaceTenantScope):
    | { readonly bound: true; readonly compactedThroughServerRevision: number }
    | { readonly bound: false };
}

interface WorkspaceHeadReaderPort {
  readHead(scope: WorkspaceTenantScope): { readonly serverRevision: number };
}

interface ReaderMutationPagePort {
  readPage(scope: WorkspaceTenantScope, input: {
    readonly fromServerRevisionExclusive: number;
    readonly throughServerRevisionInclusive: number;
    readonly cursor: string | null;
    readonly pageLimit: number;
  }): Promise<MutationPage>;
}

interface CursorTrustedTimePort {
  now(): string;
}

export interface ReaderCursorConfig {
  readonly schemaVersion: 1;
  readonly leaseTtlSeconds: number;
}

export const defaultReaderCursorConfig: ReaderCursorConfig = {
  schemaVersion: 1,
  leaseTtlSeconds: 15 * 60,
};

export interface ReaderCursorProjection {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly readThroughServerRevision: number;
  readonly leaseExpiresAt: string;
  readonly status: "active" | "retired";
  readonly resumeRequirement: "none" | "rebootstrap_required";
  readonly retiredAt: string | null;
  readonly retiredReason: "ttl_expired" | "device_removed" | "compaction_race" | null;
}

export type ReaderCursorRejectionCode =
  | "WORKSPACE_TENANT_UNRESOLVED"
  | "READER_CURSOR_UNKNOWN"
  | "READER_CURSOR_RETIRED"
  | "READER_CURSOR_TTL_EXPIRED"
  | "READER_CURSOR_COMPACTION_RACE"
  | "READER_CURSOR_DEVICE_REMOVED"
  | "CURSOR_REVISION_REGRESSION";

export type ReaderCursorResult =
  | { readonly accepted: true; readonly cursor: ReaderCursorProjection }
  | { readonly accepted: false; readonly code: ReaderCursorRejectionCode };

export type ReaderCursorPageResult =
  | { readonly accepted: true; readonly cursor: ReaderCursorProjection; readonly page: MutationPage }
  | { readonly accepted: false; readonly code: ReaderCursorRejectionCode };

type StoredReaderCursorLookup =
  | { readonly accepted: true; readonly cursor: StoredReaderCursor }
  | { readonly accepted: false; readonly code: ReaderCursorRejectionCode };

type StoredReaderCursor = {
  -readonly [Key in keyof ReaderCursorProjection]: ReaderCursorProjection[Key];
} & { nextCursor: string | null; pinnedPageTargetServerRevision: number | null };

/** Standby-only cursor state with no port to mutation ingest, revision allocation, or domain state. */
export class InMemoryReaderCursors {
  readonly #bindings: WorkspaceScopeResolverPort;
  readonly #heads: WorkspaceHeadReaderPort;
  readonly #pages: ReaderMutationPagePort;
  readonly #time: CursorTrustedTimePort;
  readonly #config: ReaderCursorConfig;
  readonly #cursors = new Map<string, Map<string, StoredReaderCursor>>();

  constructor(options: {
    readonly bindings: WorkspaceScopeResolverPort;
    readonly heads: WorkspaceHeadReaderPort;
    readonly pages: ReaderMutationPagePort;
    readonly time?: CursorTrustedTimePort;
    readonly config?: ReaderCursorConfig;
  }) {
    this.#bindings = options.bindings;
    this.#heads = options.heads;
    this.#pages = options.pages;
    this.#time = options.time ?? { now: () => canonicalNow() };
    this.#config = options.config ?? defaultReaderCursorConfig;
    if (
      this.#config.schemaVersion !== 1 ||
      !Number.isSafeInteger(this.#config.leaseTtlSeconds) ||
      this.#config.leaseTtlSeconds < 1
    ) throw new TypeError("reader cursor config is malformed");
  }

  async openReaderCursor(
    scope: WorkspaceTenantScope,
    deviceId: string,
    atRevision: number,
  ): Promise<ReaderCursorResult> {
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    const head = this.#heads.readHead(scope).serverRevision;
    if (!Number.isSafeInteger(atRevision) || atRevision < binding.compactedThroughServerRevision || atRevision > head) {
      return reject(atRevision < binding.compactedThroughServerRevision
        ? "READER_CURSOR_COMPACTION_RACE"
        : "CURSOR_REVISION_REGRESSION");
    }
    const now = this.#time.now();
    const existing = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (existing?.status === "active" && atRevision < existing.readThroughServerRevision) {
      return reject("CURSOR_REVISION_REGRESSION");
    }
    const cursor: StoredReaderCursor = {
      schemaVersion: 1,
      workspaceId: scope.workspaceId,
      deviceId,
      readThroughServerRevision: atRevision,
      leaseExpiresAt: addSeconds(now, this.#config.leaseTtlSeconds),
      status: "active",
      resumeRequirement: "none",
      retiredAt: null,
      retiredReason: null,
      nextCursor: null,
      pinnedPageTargetServerRevision: null,
    };
    this.#workspaceCursors(scope).set(deviceId, cursor);
    return accept(cursor);
  }

  async readAfter(
    scope: WorkspaceTenantScope,
    deviceId: string,
    pageLimit: number,
  ): Promise<ReaderCursorPageResult> {
    const checked = this.#activeCursor(scope, deviceId);
    if (!checked.accepted) return checked;
    const cursor = checked.cursor;
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    if (cursor.readThroughServerRevision < binding.compactedThroughServerRevision) {
      this.#retire(scope, cursor, "compaction_race");
      return reject("READER_CURSOR_COMPACTION_RACE");
    }
    const throughServerRevisionInclusive = cursor.pinnedPageTargetServerRevision ?? this.#heads.readHead(scope).serverRevision;
    try {
      const page = await this.#pages.readPage(scope, {
        fromServerRevisionExclusive: cursor.readThroughServerRevision,
        throughServerRevisionInclusive,
        cursor: cursor.nextCursor,
        pageLimit,
      });
      if (page.returnedThroughServerRevision < cursor.readThroughServerRevision) return reject("CURSOR_REVISION_REGRESSION");
      cursor.readThroughServerRevision = page.returnedThroughServerRevision;
      cursor.nextCursor = page.nextCursor;
      cursor.pinnedPageTargetServerRevision = page.nextCursor === null ? null : throughServerRevisionInclusive;
      return { accepted: true, cursor: project(cursor), page };
    } catch (error) {
      if (hasCode(error, "MUTATION_PAGE_COMPACTED")) {
        this.#retire(scope, cursor, "compaction_race");
        return reject("READER_CURSOR_COMPACTION_RACE");
      }
      return reject("READER_CURSOR_RETIRED");
    }
  }

  async renewReaderCursor(scope: WorkspaceTenantScope, deviceId: string): Promise<ReaderCursorResult> {
    const checked = this.#activeCursor(scope, deviceId);
    if (!checked.accepted) return checked;
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    if (checked.cursor.readThroughServerRevision < binding.compactedThroughServerRevision) {
      this.#retire(scope, checked.cursor, "compaction_race");
      return reject("READER_CURSOR_COMPACTION_RACE");
    }
    checked.cursor.leaseExpiresAt = addSeconds(this.#time.now(), this.#config.leaseTtlSeconds);
    return accept(checked.cursor);
  }

  async retireReaderCursor(
    scope: WorkspaceTenantScope,
    deviceId: string,
    reason: "ttl_expired" | "device_removed" | "compaction_race",
  ): Promise<void> {
    if (!this.#bindings.resolveWorkspace(scope).bound) return;
    const cursor = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (cursor !== undefined && cursor.status === "active") this.#retire(scope, cursor, reason);
  }

  snapshot(scope: WorkspaceTenantScope): readonly ReaderCursorProjection[] {
    if (!this.#bindings.resolveWorkspace(scope).bound) return [];
    return [...(this.#cursors.get(workspaceTenantKey(scope))?.values() ?? [])].map(project);
  }

  minimumActiveRevision(scope: WorkspaceTenantScope): number | null {
    if (!this.#bindings.resolveWorkspace(scope).bound) return null;
    const active: number[] = [];
    for (const cursor of this.#cursors.get(workspaceTenantKey(scope))?.values() ?? []) {
      if (cursor.status === "active" && this.#time.now() >= cursor.leaseExpiresAt) {
        this.#retire(scope, cursor, "ttl_expired");
      }
      if (cursor.status === "active") active.push(cursor.readThroughServerRevision);
    }
    return active.length === 0 ? null : Math.min(...active);
  }

  #activeCursor(scope: WorkspaceTenantScope, deviceId: string): StoredReaderCursorLookup {
    if (!this.#bindings.resolveWorkspace(scope).bound) return reject("WORKSPACE_TENANT_UNRESOLVED");
    const cursor = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (cursor === undefined) return reject("READER_CURSOR_UNKNOWN");
    if (cursor.status === "retired") {
      if (cursor.retiredReason === "device_removed") return reject("READER_CURSOR_DEVICE_REMOVED");
      return reject("READER_CURSOR_RETIRED");
    }
    if (this.#time.now() >= cursor.leaseExpiresAt) {
      this.#retire(scope, cursor, "ttl_expired");
      return reject("READER_CURSOR_TTL_EXPIRED");
    }
    return { accepted: true, cursor };
  }

  #retire(
    _scope: WorkspaceTenantScope,
    cursor: StoredReaderCursor,
    reason: "ttl_expired" | "device_removed" | "compaction_race",
  ): void {
    cursor.status = "retired";
    cursor.retiredAt = this.#time.now();
    cursor.retiredReason = reason;
    cursor.resumeRequirement = reason === "device_removed" ? "none" : "rebootstrap_required";
    cursor.nextCursor = null;
    cursor.pinnedPageTargetServerRevision = null;
  }

  #workspaceCursors(scope: WorkspaceTenantScope): Map<string, StoredReaderCursor> {
    const key = workspaceTenantKey(scope);
    const existing = this.#cursors.get(key);
    if (existing !== undefined) return existing;
    const cursors = new Map<string, StoredReaderCursor>();
    this.#cursors.set(key, cursors);
    return cursors;
  }
}

export interface DeviceCursorProjection {
  readonly deviceId: string;
  readonly lastPulledRevision: number;
  readonly status: "active" | "retired";
  readonly retiredAt: string | null;
  readonly retiredReason: "device_removed" | "workspace_left" | "replaced" | null;
}

/** Active-device cursor lifecycle is separate from the read-only ReaderCursor surface. */
export class InMemoryDeviceCursors {
  readonly #time: CursorTrustedTimePort;
  readonly #cursors = new Map<string, Map<string, DeviceCursorProjection>>();

  constructor(time: CursorTrustedTimePort = { now: () => canonicalNow() }) {
    this.#time = time;
  }

  async activateCursor(scope: WorkspaceTenantScope, deviceId: string, atRevision: number): Promise<void> {
    if (!Number.isSafeInteger(atRevision) || atRevision < 0) throw new TypeError("device cursor revision is invalid");
    const cursors = this.#workspaceCursors(scope);
    const existing = cursors.get(deviceId);
    if (existing?.status === "retired") throw new TypeError("a retired device cursor cannot be reactivated");
    if (existing?.status === "active" && atRevision < existing.lastPulledRevision) {
      throw new TypeError("CURSOR_REVISION_REGRESSION");
    }
    if ([...cursors.values()].some((cursor) => cursor.status === "active" && cursor.deviceId !== deviceId)) {
      throw new TypeError("workspace already has an active device cursor");
    }
    cursors.set(deviceId, {
      deviceId,
      lastPulledRevision: atRevision,
      status: "active",
      retiredAt: null,
      retiredReason: null,
    });
  }

  async retireCursor(
    scope: WorkspaceTenantScope,
    deviceId: string,
    reason: "device_removed" | "workspace_left" | "replaced",
  ): Promise<void> {
    const cursor = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (cursor === undefined || cursor.status === "retired") return;
    this.#workspaceCursors(scope).set(deviceId, {
      ...cursor,
      status: "retired",
      retiredAt: this.#time.now(),
      retiredReason: reason,
    });
  }

  advanceCursor(scope: WorkspaceTenantScope, deviceId: string, throughServerRevision: number): void {
    const cursor = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (cursor === undefined || cursor.status !== "active") throw new TypeError("active device cursor is unavailable");
    if (!Number.isSafeInteger(throughServerRevision) || throughServerRevision < cursor.lastPulledRevision) {
      throw new TypeError("CURSOR_REVISION_REGRESSION");
    }
    this.#workspaceCursors(scope).set(deviceId, { ...cursor, lastPulledRevision: throughServerRevision });
  }

  snapshot(scope: WorkspaceTenantScope): readonly DeviceCursorProjection[] {
    return [...(this.#cursors.get(workspaceTenantKey(scope))?.values() ?? [])].map((cursor) => ({ ...cursor }));
  }

  minimumActiveRevision(scope: WorkspaceTenantScope): number | null {
    const active = [...(this.#cursors.get(workspaceTenantKey(scope))?.values() ?? [])]
      .filter((cursor) => cursor.status === "active")
      .map((cursor) => cursor.lastPulledRevision);
    return active.length === 0 ? null : Math.min(...active);
  }

  #workspaceCursors(scope: WorkspaceTenantScope): Map<string, DeviceCursorProjection> {
    const key = workspaceTenantKey(scope);
    const existing = this.#cursors.get(key);
    if (existing !== undefined) return existing;
    const cursors = new Map<string, DeviceCursorProjection>();
    this.#cursors.set(key, cursors);
    return cursors;
  }
}

function accept(cursor: StoredReaderCursor): ReaderCursorResult {
  return { accepted: true, cursor: project(cursor) };
}

function reject(code: ReaderCursorRejectionCode): { readonly accepted: false; readonly code: ReaderCursorRejectionCode } {
  return { accepted: false, code };
}

function project(cursor: StoredReaderCursor): ReaderCursorProjection {
  const { nextCursor: _nextCursor, pinnedPageTargetServerRevision: _pinnedPageTargetServerRevision, ...projection } = cursor;
  return { ...projection };
}

function addSeconds(timestamp: string, seconds: number): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new TypeError("trusted cursor time is malformed");
  return new Date(value + seconds * 1_000).toISOString().replace(/\.000Z$/, "Z");
}

function canonicalNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
export { PostgresDeviceCursorRepository } from "./postgres-repository";
