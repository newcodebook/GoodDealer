import type { MutationPage } from "@gooddealer/protocol/workspace";

import type { WorkspaceTenantScope } from "../tenant-scope";
import { workspaceTenantKey } from "../tenant-scope";

interface WorkspaceScopeResolverPort {
  resolveWorkspace(scope: WorkspaceTenantScope): { readonly bound: boolean };
}

interface ReaderMutationPagePort {
  readPage(scope: WorkspaceTenantScope, input: {
    readonly fromRevisionExclusive: number;
    readonly throughRevisionInclusive: number;
    readonly cursor: string | null;
    readonly pageLimit: number;
  }): Promise<{ readonly accepted: true; readonly page: MutationPage } | { readonly accepted: false; readonly code: string }>;
}

export interface ReaderCursorProjection {
  readonly deviceId: string;
  readonly lastReadRevision: number;
  readonly status: "active" | "retired";
  readonly retiredReason: "ttl_expired" | "device_removed" | "compaction_race" | null;
}

export type ReaderCursorResult =
  | { readonly accepted: true; readonly cursor: ReaderCursorProjection }
  | { readonly accepted: false; readonly code: "WORKSPACE_TENANT_UNRESOLVED" | "READER_CURSOR_UNKNOWN" | "READER_CURSOR_RETIRED" };

/** Reader cursor state is deliberately incapable of reaching mutation ingest or revision allocation. */
export class InMemoryReaderCursors {
  readonly #bindings: WorkspaceScopeResolverPort;
  readonly #pages: ReaderMutationPagePort;
  readonly #cursors = new Map<string, Map<string, ReaderCursorProjection>>();

  constructor(options: { readonly bindings: WorkspaceScopeResolverPort; readonly pages: ReaderMutationPagePort }) {
    this.#bindings = options.bindings;
    this.#pages = options.pages;
  }

  async openReaderCursor(
    scope: WorkspaceTenantScope,
    deviceId: string,
    atRevision: number,
  ): Promise<ReaderCursorResult> {
    if (!this.#bindings.resolveWorkspace(scope).bound) {
      return { accepted: false, code: "WORKSPACE_TENANT_UNRESOLVED" };
    }
    const cursors = this.#workspaceCursors(scope);
    const cursor = { deviceId, lastReadRevision: atRevision, status: "active", retiredReason: null } as const;
    cursors.set(deviceId, cursor);
    return { accepted: true, cursor: { ...cursor } };
  }

  async readAfter(
    scope: WorkspaceTenantScope,
    deviceId: string,
    throughRevisionInclusive: number,
    pageLimit: number,
  ): Promise<ReaderCursorResult & { readonly page?: MutationPage }> {
    const cursor = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (cursor === undefined) return { accepted: false, code: "READER_CURSOR_UNKNOWN" };
    if (cursor.status === "retired") return { accepted: false, code: "READER_CURSOR_RETIRED" };
    const result = await this.#pages.readPage(scope, {
      fromRevisionExclusive: cursor.lastReadRevision,
      throughRevisionInclusive,
      cursor: cursor.lastReadRevision === 0 ? null : null,
      pageLimit,
    });
    if (!result.accepted) return { accepted: false, code: "READER_CURSOR_RETIRED" };
    const next = { ...cursor, lastReadRevision: result.page.returnedThroughRevision };
    this.#workspaceCursors(scope).set(deviceId, next);
    return { accepted: true, cursor: next, page: result.page };
  }

  async renewReaderCursor(scope: WorkspaceTenantScope, deviceId: string): Promise<ReaderCursorResult> {
    const cursor = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (cursor === undefined) return { accepted: false, code: "READER_CURSOR_UNKNOWN" };
    if (cursor.status === "retired") return { accepted: false, code: "READER_CURSOR_RETIRED" };
    return { accepted: true, cursor: { ...cursor } };
  }

  async retireReaderCursor(
    scope: WorkspaceTenantScope,
    deviceId: string,
    reason: "ttl_expired" | "device_removed" | "compaction_race",
  ): Promise<void> {
    const cursor = this.#cursors.get(workspaceTenantKey(scope))?.get(deviceId);
    if (cursor === undefined) return;
    this.#workspaceCursors(scope).set(deviceId, { ...cursor, status: "retired", retiredReason: reason });
  }

  snapshot(scope: WorkspaceTenantScope): readonly ReaderCursorProjection[] {
    return [...(this.#cursors.get(workspaceTenantKey(scope))?.values() ?? [])].map((cursor) => ({ ...cursor }));
  }

  #workspaceCursors(scope: WorkspaceTenantScope): Map<string, ReaderCursorProjection> {
    const key = workspaceTenantKey(scope);
    const existing = this.#cursors.get(key);
    if (existing !== undefined) return existing;
    const cursors = new Map<string, ReaderCursorProjection>();
    this.#cursors.set(key, cursors);
    return cursors;
  }
}
