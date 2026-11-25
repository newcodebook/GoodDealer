import {
  compareUtf8,
  computeDomainAssetEntityDigests,
  workspaceCheckpointStateSchema,
  type DomainAssetProjectionRow,
  type SubmittedSyncMutation,
  type WorkspaceCheckpointState,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";

export { PostgresBootstrapProjectionDigestPort } from "./bootstrap-port";

import type { WorkspaceTenantScope } from "../../tenant-scope";
import { workspaceTenantKey } from "../../tenant-scope";

type DomainAssetChangedField = SubmittedSyncMutation["changedFields"][number];
type DomainAssetFieldPath = DomainAssetChangedField["fieldPath"];

export interface DomainAssetSeed {
  readonly entityId: string;
  readonly note?: string | null;
  readonly portfolioId?: string | null;
  readonly tags?: readonly string[];
  readonly targetPrice?: { readonly currency: string; readonly amount: string } | null;
  /** Test double only: a later generation, as an accepted re-add leaves the row. */
  readonly entityGeneration?: number;
}

interface StoredField<Value> {
  value: Value;
  lastModifiedRevision: number;
}

interface StoredDomainAsset {
  readonly entityId: string;
  readonly entityGeneration: number;
  readonly note: StoredField<string | null>;
  readonly portfolioId: StoredField<string | null>;
  readonly tags: StoredField<readonly string[]>;
  readonly targetPrice: StoredField<{ readonly currency: string; readonly amount: string } | null>;
}

interface StoredTombstone {
  readonly entityGeneration: number;
  readonly deletedServerRevision: number;
  readonly deletedAt: string;
}

interface StoredRevisionState {
  readonly rows: Map<string, StoredDomainAsset>;
  readonly tombstones: Map<string, StoredTombstone>;
}

export interface DomainAssetProjection extends DomainAssetProjectionRow {
  readonly lastModifiedRevision: Readonly<Record<DomainAssetFieldPath, number>>;
}

/** The replica state of a DomainAsset: a live row, a tombstone, or never held. */
export type DomainAssetReplicaState = "active" | "deleted" | "absent";

/**
 * A live row with its generation, a tombstone with the generation it deleted and the revision that
 * deleted it (which a re-add must name), or an asset the replica never held.
 */
export type DomainAssetReplicaEntry =
  | { readonly state: "active"; readonly generation: number }
  | { readonly state: "deleted"; readonly generation: number; readonly deletedServerRevision: number }
  | { readonly state: "absent" };

export interface PortfolioMutationPort {
  readDomainAssetEntry(scope: WorkspaceTenantScope, entityId: string): DomainAssetReplicaEntry;
  readFieldRevision(scope: WorkspaceTenantScope, entityId: string, fieldPath: DomainAssetFieldPath): number | null;
  applyAcceptedMutations(
    scope: WorkspaceTenantScope,
    mutations: readonly { readonly mutation: SubmittedSyncMutation; readonly serverRevision: number }[],
  ): { rollback(): void };
}

/** In-memory V1 domain_asset projection; revision metadata never enters business digests. */
export class InMemoryDomainAssetPortfolio implements PortfolioMutationPort {
  readonly #rows = new Map<string, Map<string, StoredDomainAsset>>();
  readonly #history = new Map<string, Map<number, StoredRevisionState>>();
  /** Tombstoned entity ids with the generation each deleted and when. */
  readonly #tombstones = new Map<string, Map<string, StoredTombstone>>();

  seedDomainAsset(scope: WorkspaceTenantScope, seed: DomainAssetSeed): void {
    const rows = this.#workspaceRows(scope);
    if (rows.has(seed.entityId)) throw new TypeError("domain asset already exists");
    rows.set(seed.entityId, {
      entityId: seed.entityId,
      entityGeneration: seed.entityGeneration ?? 1,
      note: { value: seed.note ?? null, lastModifiedRevision: 0 },
      portfolioId: { value: seed.portfolioId ?? null, lastModifiedRevision: 0 },
      tags: { value: [...(seed.tags ?? [])], lastModifiedRevision: 0 },
      targetPrice: { value: seed.targetPrice === undefined ? null : cloneMoney(seed.targetPrice), lastModifiedRevision: 0 },
    });
    this.#recordSnapshot(scope, 0);
  }

  /** Test double only: records a tombstone for an asset deleted before this replica's history. */
  seedDomainAssetTombstone(
    scope: WorkspaceTenantScope,
    entityId: string,
    tombstone: Partial<StoredTombstone> = {},
  ): void {
    if (this.#workspaceRows(scope).has(entityId)) throw new TypeError("a tombstoned domain asset has no live row");
    this.#workspaceTombstones(scope).set(entityId, {
      entityGeneration: tombstone.entityGeneration ?? 1,
      deletedServerRevision: tombstone.deletedServerRevision ?? 1,
      deletedAt: tombstone.deletedAt ?? "2026-01-01T00:00:00Z",
    });
  }

  readDomainAssetEntry(scope: WorkspaceTenantScope, entityId: string): DomainAssetReplicaEntry {
    const key = workspaceTenantKey(scope);
    const row = this.#rows.get(key)?.get(entityId);
    if (row !== undefined) return { state: "active", generation: row.entityGeneration };
    const tombstone = this.#tombstones.get(key)?.get(entityId);
    return tombstone === undefined
      ? { state: "absent" }
      : {
        state: "deleted",
        generation: tombstone.entityGeneration,
        deletedServerRevision: tombstone.deletedServerRevision,
      };
  }

  readDomainAssetState(scope: WorkspaceTenantScope, entityId: string): DomainAssetReplicaState {
    return this.readDomainAssetEntry(scope, entityId).state;
  }

  readFieldRevision(scope: WorkspaceTenantScope, entityId: string, fieldPath: DomainAssetFieldPath): number | null {
    const row = this.#rows.get(workspaceTenantKey(scope))?.get(entityId);
    return row === undefined ? null : row[fieldPath].lastModifiedRevision;
  }

  applyAcceptedMutations(
    scope: WorkspaceTenantScope,
    mutations: readonly { readonly mutation: SubmittedSyncMutation; readonly serverRevision: number }[],
  ): { rollback(): void } {
    const rows = this.#workspaceRows(scope);
    const previous = cloneRows(rows);
    const key = workspaceTenantKey(scope);
    const previousHistory = cloneHistory(this.#history.get(key));
    const tombstones = this.#workspaceTombstones(scope);
    const previousTombstones = new Map(tombstones);
    for (const { mutation, serverRevision } of mutations) {
      if (mutation.operationKind === "delete") {
        // The ingest admitted this delete only for a live asset; the replica keeps its tombstone.
        const deleted = rows.get(mutation.entityId);
        if (deleted === undefined || mutation.deletedAt === undefined) {
          throw new TypeError("accepted delete names no live domain asset");
        }
        rows.delete(mutation.entityId);
        tombstones.set(mutation.entityId, {
          entityGeneration: deleted.entityGeneration,
          deletedServerRevision: serverRevision,
          deletedAt: mutation.deletedAt,
        });
      } else if (mutation.reAddsDeletedRevision !== undefined) {
        // ADR-0029 decision 3: the ingest admitted this re-add only for the tombstone it names. The
        // new generation keeps none of the deleted row's fields and every field is this revision's.
        const tombstone = tombstones.get(mutation.entityId);
        if (tombstone === undefined || rows.has(mutation.entityId) ||
            tombstone.deletedServerRevision !== mutation.reAddsDeletedRevision ||
            tombstone.entityGeneration + 1 !== mutation.entityGeneration) {
          throw new TypeError("accepted re-add names no matching tombstone");
        }
        tombstones.delete(mutation.entityId);
        const row = createDefaultRow(rows, mutation.entityId, mutation.entityGeneration, serverRevision);
        for (const field of mutation.changedFields) applyField(row, field, serverRevision);
      } else {
        if (tombstones.has(mutation.entityId)) throw new TypeError("accepted upsert names a deleted domain asset");
        // The first upsert of an asset creates it with every field at its default and revision 0.
        const row = rows.get(mutation.entityId) ?? createDefaultRow(rows, mutation.entityId, 1, 0);
        for (const field of mutation.changedFields) applyField(row, field, serverRevision);
      }
      this.#recordSnapshot(scope, serverRevision);
    }
    return {
      rollback: () => {
        this.#rows.set(key, previous);
        this.#tombstones.set(key, previousTombstones);
        if (previousHistory === undefined) this.#history.delete(key);
        else this.#history.set(key, previousHistory);
      },
    };
  }

  inspectDomainAsset(scope: WorkspaceTenantScope, entityId: string): DomainAssetProjection | null {
    const row = this.#rows.get(workspaceTenantKey(scope))?.get(entityId);
    return row === undefined ? null : projectRow(row);
  }

  snapshot(scope: WorkspaceTenantScope): readonly DomainAssetProjection[] {
    return [...(this.#rows.get(workspaceTenantKey(scope))?.values() ?? [])]
      .sort((left, right) => compareUtf8(left.entityId, right.entityId))
      .map(projectRow);
  }

  snapshotAtRevision(scope: WorkspaceTenantScope, throughServerRevision: number): readonly DomainAssetProjection[] {
    if (!Number.isSafeInteger(throughServerRevision) || throughServerRevision < 0) {
      throw new TypeError("workspace snapshot revision must be unsigned");
    }
    return [...this.#stateAt(scope, throughServerRevision).rows.values()]
      .sort((left, right) => compareUtf8(left.entityId, right.entityId)).map(projectRow);
  }

  /** The checkpoint state (live assets and tombstones, with generations) as of one revision. */
  readCheckpointStateAt(scope: WorkspaceTenantScope, throughServerRevision: number): WorkspaceCheckpointState {
    const state = this.#stateAt(scope, throughServerRevision);
    return workspaceCheckpointStateSchema.parse({
      assets: [...state.rows.values()]
        .sort((left, right) => compareUtf8(left.entityId, right.entityId))
        .map((row) => {
          const { lastModifiedRevision: _revision, ...projection } = projectRow(row);
          return { ...projection, entityGeneration: row.entityGeneration };
        }),
      tombstones: [...state.tombstones]
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([entityId, tombstone]) => ({ entityId, ...tombstone })),
    });
  }

  #stateAt(scope: WorkspaceTenantScope, throughServerRevision: number): StoredRevisionState {
    if (!Number.isSafeInteger(throughServerRevision) || throughServerRevision < 0) {
      throw new TypeError("workspace snapshot revision must be unsigned");
    }
    const state = this.#history.get(workspaceTenantKey(scope))?.get(throughServerRevision);
    if (state === undefined) throw new TypeError("workspace snapshot revision is unavailable");
    return state;
  }

  async computeBusinessDigest(
    scope: WorkspaceTenantScope,
    digest: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<string> {
    const canonicalRows = this.snapshot(scope).map(({ lastModifiedRevision: _revision, ...row }) => row);
    const [entityDigest] = await computeDomainAssetEntityDigests(canonicalRows, digest);
    if (entityDigest === undefined) throw new TypeError("domain asset digest encoder returned no digest");
    return entityDigest.digest;
  }

  async readEntityDigestsAt(
    scope: WorkspaceTenantScope,
    throughServerRevision: number,
    digest: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<readonly WorkspaceEntityDigest[]> {
    const canonicalRows = this.snapshotAtRevision(scope, throughServerRevision)
      .map(({ lastModifiedRevision: _revision, ...row }) => row);
    return computeDomainAssetEntityDigests(canonicalRows, digest);
  }

  #workspaceRows(scope: WorkspaceTenantScope): Map<string, StoredDomainAsset> {
    const key = workspaceTenantKey(scope);
    let rows = this.#rows.get(key);
    if (rows === undefined) {
      rows = new Map();
      this.#rows.set(key, rows);
    }
    return rows;
  }

  #workspaceTombstones(scope: WorkspaceTenantScope): Map<string, StoredTombstone> {
    const key = workspaceTenantKey(scope);
    let tombstones = this.#tombstones.get(key);
    if (tombstones === undefined) {
      tombstones = new Map();
      this.#tombstones.set(key, tombstones);
    }
    return tombstones;
  }

  #recordSnapshot(scope: WorkspaceTenantScope, revision: number): void {
    const key = workspaceTenantKey(scope);
    const history = this.#history.get(key) ?? new Map<number, StoredRevisionState>();
    history.set(revision, {
      rows: cloneRows(this.#workspaceRows(scope)),
      tombstones: new Map(this.#workspaceTombstones(scope)),
    });
    this.#history.set(key, history);
  }
}

function createDefaultRow(
  rows: Map<string, StoredDomainAsset>,
  entityId: string,
  entityGeneration: number,
  lastModifiedRevision: number,
): StoredDomainAsset {
  const row: StoredDomainAsset = {
    entityId,
    entityGeneration,
    note: { value: null, lastModifiedRevision },
    portfolioId: { value: null, lastModifiedRevision },
    tags: { value: [], lastModifiedRevision },
    targetPrice: { value: null, lastModifiedRevision },
  };
  rows.set(entityId, row);
  return row;
}

function applyField(row: StoredDomainAsset, field: DomainAssetChangedField, serverRevision: number): void {
  switch (field.fieldPath) {
    case "note":
      row.note.value = field.value;
      row.note.lastModifiedRevision = serverRevision;
      return;
    case "portfolioId":
      row.portfolioId.value = field.value;
      row.portfolioId.lastModifiedRevision = serverRevision;
      return;
    case "tags":
      row.tags.value = [...field.value];
      row.tags.lastModifiedRevision = serverRevision;
      return;
    case "targetPrice":
      row.targetPrice.value = cloneMoney(field.value);
      row.targetPrice.lastModifiedRevision = serverRevision;
      return;
  }
}

function projectRow(row: StoredDomainAsset): DomainAssetProjection {
  return {
    entityId: row.entityId,
    note: row.note.value,
    portfolioId: row.portfolioId.value,
    tags: [...row.tags.value],
    targetPrice: cloneMoney(row.targetPrice.value),
    lastModifiedRevision: {
      note: row.note.lastModifiedRevision,
      portfolioId: row.portfolioId.lastModifiedRevision,
      tags: row.tags.lastModifiedRevision,
      targetPrice: row.targetPrice.lastModifiedRevision,
    },
  };
}

function cloneRows(rows: Map<string, StoredDomainAsset>): Map<string, StoredDomainAsset> {
  return new Map([...rows].map(([entityId, row]) => [entityId, {
    entityId: row.entityId,
    entityGeneration: row.entityGeneration,
    note: { ...row.note },
    portfolioId: { ...row.portfolioId },
    tags: { value: [...row.tags.value], lastModifiedRevision: row.tags.lastModifiedRevision },
    targetPrice: { value: cloneMoney(row.targetPrice.value), lastModifiedRevision: row.targetPrice.lastModifiedRevision },
  }]));
}

function cloneHistory(
  history: Map<number, StoredRevisionState> | undefined,
): Map<number, StoredRevisionState> | undefined {
  return history === undefined
    ? undefined
    : new Map([...history].map(([revision, state]) => [revision, {
      rows: cloneRows(state.rows),
      tombstones: new Map(state.tombstones),
    }]));
}

function cloneMoney<Value extends { readonly currency: string; readonly amount: string } | null>(value: Value): Value {
  return (value === null ? null : { ...value }) as Value;
}

export {
  PostgresPortfolioMutationService,
  PostgresPortfolioProjectionQuery,
  PostgresPortfolioRepository,
  type LockedDomainAsset,
  type PortfolioMaterializationPort,
  type PortfolioProjectionQueryPort,
  type PortfolioSyncPersistencePort,
} from "./postgres-repository";
