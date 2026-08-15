import type { WorkspaceTenantScope } from "../tenant-scope";
import { parseWorkspaceTenantScope, workspaceTenantKey } from "../tenant-scope";

export interface ResolvedWorkspaceBinding {
  readonly bound: true;
  readonly workspaceSchemaVersion: number;
  readonly compactionWatermark: number;
}

export interface WorkspaceBindingPort {
  resolveWorkspace(scope: WorkspaceTenantScope): ResolvedWorkspaceBinding | { readonly bound: false };
}

interface WorkspaceRevisionHead {
  serverRevision: number;
  readonly workspaceSchemaVersion: number;
  compactionWatermark: number;
}

/**
 * Fixture-only dense workspace revision heads. Mutation ingest is the sole source caller of
 * commitAcceptedMutations; proposed revision numbers do not become allocated until that call.
 */
export class InMemoryWorkspaceRevisions implements WorkspaceBindingPort {
  readonly #heads = new Map<string, WorkspaceRevisionHead>();

  bindWorkspace(scope: WorkspaceTenantScope, workspaceSchemaVersion: number): void {
    const key = workspaceTenantKey(scope);
    if (!Number.isSafeInteger(workspaceSchemaVersion) || workspaceSchemaVersion < 1) {
      throw new TypeError("workspace schema version must be positive");
    }
    const existing = this.#heads.get(key);
    if (existing !== undefined && existing.workspaceSchemaVersion !== workspaceSchemaVersion) {
      throw new TypeError("workspace binding is immutable");
    }
    if (existing === undefined) {
      this.#heads.set(key, { serverRevision: 0, workspaceSchemaVersion, compactionWatermark: 0 });
    }
  }

  resolveWorkspace(scope: WorkspaceTenantScope): ResolvedWorkspaceBinding | { readonly bound: false } {
    const parsed = parseWorkspaceTenantScope(scope);
    if (parsed === null) return { bound: false };
    const head = this.#heads.get(workspaceTenantKey(parsed));
    if (head === undefined) return { bound: false };
    return {
      bound: true,
      workspaceSchemaVersion: head.workspaceSchemaVersion,
      compactionWatermark: head.compactionWatermark,
    };
  }

  readHead(scope: WorkspaceTenantScope): {
    readonly serverRevision: number;
    readonly workspaceSchemaVersion: number;
  } {
    const head = this.#requiredHead(scope);
    return { serverRevision: head.serverRevision, workspaceSchemaVersion: head.workspaceSchemaVersion };
  }

  commitAcceptedMutations(
    scope: WorkspaceTenantScope,
    observedHead: number,
    acceptedMutationCount: number,
  ): readonly number[] {
    const head = this.#requiredHead(scope);
    if (!Number.isSafeInteger(observedHead) || observedHead < 0 || head.serverRevision !== observedHead) {
      throw new TypeError("workspace revision compare-and-set lost");
    }
    if (!Number.isSafeInteger(acceptedMutationCount) || acceptedMutationCount < 1) {
      throw new TypeError("accepted mutation count must be positive");
    }
    const revisions = Array.from(
      { length: acceptedMutationCount },
      (_, index) => observedHead + index + 1,
    );
    const nextHead = revisions.at(-1);
    if (nextHead === undefined || !Number.isSafeInteger(nextHead)) {
      throw new TypeError("workspace revision overflow");
    }
    head.serverRevision = nextHead;
    return revisions;
  }

  assignedRevisions(scope: WorkspaceTenantScope): readonly number[] {
    const head = this.#requiredHead(scope);
    return Array.from(
      { length: head.serverRevision - head.compactionWatermark },
      (_, index) => head.compactionWatermark + index + 1,
    );
  }

  advanceCompactionWatermark(
    scope: WorkspaceTenantScope,
    throughRevision: number,
  ): { rollback(): void } {
    const head = this.#requiredHead(scope);
    if (
      !Number.isSafeInteger(throughRevision) ||
      throughRevision < head.compactionWatermark ||
      throughRevision > head.serverRevision
    ) {
      throw new TypeError("workspace compaction watermark is invalid");
    }
    const previous = head.compactionWatermark;
    head.compactionWatermark = throughRevision;
    return { rollback: () => { head.compactionWatermark = previous; } };
  }

  #requiredHead(scope: WorkspaceTenantScope): WorkspaceRevisionHead {
    const parsed = parseWorkspaceTenantScope(scope);
    if (parsed === null) throw new TypeError("workspace tenant scope is unresolved");
    const head = this.#heads.get(workspaceTenantKey(parsed));
    if (head === undefined) throw new TypeError("workspace tenant scope is unresolved");
    return head;
  }
}

export type { WorkspaceTenantScope } from "../tenant-scope";
