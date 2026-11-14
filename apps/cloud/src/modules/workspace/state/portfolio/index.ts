import {
  compareUtf8,
  computeDomainAssetEntityDigests,
  type DomainAssetProjectionRow,
  type SubmittedSyncMutation,
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
}

interface StoredField<Value> {
  value: Value;
  lastModifiedRevision: number;
}

interface StoredDomainAsset {
  readonly entityId: string;
  readonly note: StoredField<string | null>;
  readonly portfolioId: StoredField<string | null>;
  readonly tags: StoredField<readonly string[]>;
  readonly targetPrice: StoredField<{ readonly currency: string; readonly amount: string } | null>;
}

export interface DomainAssetProjection extends DomainAssetProjectionRow {
  readonly lastModifiedRevision: Readonly<Record<DomainAssetFieldPath, number>>;
}

/** The replica state of a DomainAsset: a live row, a tombstone, or never held. */
export type DomainAssetReplicaState = "active" | "deleted" | "absent";

export interface PortfolioMutationPort {
  /** A live row, a tombstone, or an asset this replica never held. */
  readDomainAssetState(scope: WorkspaceTenantScope, entityId: string): DomainAssetReplicaState;
  readFieldRevision(scope: WorkspaceTenantScope, entityId: string, fieldPath: DomainAssetFieldPath): number | null;
  applyAcceptedMutations(
    scope: WorkspaceTenantScope,
    mutations: readonly { readonly mutation: SubmittedSyncMutation; readonly serverRevision: number }[],
  ): { rollback(): void };
}

/** In-memory V1 domain_asset projection; revision metadata never enters business digests. */
export class InMemoryDomainAssetPortfolio implements PortfolioMutationPort {
  readonly #rows = new Map<string, Map<string, StoredDomainAsset>>();
  readonly #history = new Map<string, Map<number, Map<string, StoredDomainAsset>>>();
  readonly #tombstones = new Map<string, Set<string>>();

  seedDomainAsset(scope: WorkspaceTenantScope, seed: DomainAssetSeed): void {
    const rows = this.#workspaceRows(scope);
    if (rows.has(seed.entityId)) throw new TypeError("domain asset already exists");
    rows.set(seed.entityId, {
      entityId: seed.entityId,
      note: { value: seed.note ?? null, lastModifiedRevision: 0 },
      portfolioId: { value: seed.portfolioId ?? null, lastModifiedRevision: 0 },
      tags: { value: [...(seed.tags ?? [])], lastModifiedRevision: 0 },
      targetPrice: { value: seed.targetPrice === undefined ? null : cloneMoney(seed.targetPrice), lastModifiedRevision: 0 },
    });
    this.#recordSnapshot(scope, 0, rows);
  }

  /** Test double only: records a tombstone for an asset deleted before this replica's history. */
  seedDomainAssetTombstone(scope: WorkspaceTenantScope, entityId: string): void {
    if (this.#workspaceRows(scope).has(entityId)) throw new TypeError("a tombstoned domain asset has no live row");
    this.#workspaceTombstones(scope).add(entityId);
  }

  readDomainAssetState(scope: WorkspaceTenantScope, entityId: string): DomainAssetReplicaState {
    const key = workspaceTenantKey(scope);
    if (this.#rows.get(key)?.has(entityId) === true) return "active";
    return this.#tombstones.get(key)?.has(entityId) === true ? "deleted" : "absent";
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
    const previousTombstones = new Set(tombstones);
    for (const { mutation, serverRevision } of mutations) {
      if (mutation.operationKind === "delete") {
        // The ingest admitted this delete only for a live asset; the replica keeps its tombstone.
        if (!rows.delete(mutation.entityId)) throw new TypeError("accepted delete names no live domain asset");
        tombstones.add(mutation.entityId);
      } else {
        if (tombstones.has(mutation.entityId)) throw new TypeError("accepted upsert names a deleted domain asset");
        // The first upsert of an asset creates it with every field at its default and revision 0.
        const row = rows.get(mutation.entityId) ?? createDefaultRow(rows, mutation.entityId);
        for (const field of mutation.changedFields) applyField(row, field, serverRevision);
      }
      this.#recordSnapshot(scope, serverRevision, rows);
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
    const rows = this.#history.get(workspaceTenantKey(scope))?.get(throughServerRevision);
    if (rows === undefined) throw new TypeError("workspace snapshot revision is unavailable");
    return [...rows.values()].sort((left, right) => compareUtf8(left.entityId, right.entityId)).map(projectRow);
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

  #workspaceTombstones(scope: WorkspaceTenantScope): Set<string> {
    const key = workspaceTenantKey(scope);
    let tombstones = this.#tombstones.get(key);
    if (tombstones === undefined) {
      tombstones = new Set();
      this.#tombstones.set(key, tombstones);
    }
    return tombstones;
  }

  #recordSnapshot(scope: WorkspaceTenantScope, revision: number, rows: Map<string, StoredDomainAsset>): void {
    const key = workspaceTenantKey(scope);
    const history = this.#history.get(key) ?? new Map<number, Map<string, StoredDomainAsset>>();
    history.set(revision, cloneRows(rows));
    this.#history.set(key, history);
  }
}

function createDefaultRow(rows: Map<string, StoredDomainAsset>, entityId: string): StoredDomainAsset {
  const row: StoredDomainAsset = {
    entityId,
    note: { value: null, lastModifiedRevision: 0 },
    portfolioId: { value: null, lastModifiedRevision: 0 },
    tags: { value: [], lastModifiedRevision: 0 },
    targetPrice: { value: null, lastModifiedRevision: 0 },
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
    note: { ...row.note },
    portfolioId: { ...row.portfolioId },
    tags: { value: [...row.tags.value], lastModifiedRevision: row.tags.lastModifiedRevision },
    targetPrice: { value: cloneMoney(row.targetPrice.value), lastModifiedRevision: row.targetPrice.lastModifiedRevision },
  }]));
}

function cloneHistory(
  history: Map<number, Map<string, StoredDomainAsset>> | undefined,
): Map<number, Map<string, StoredDomainAsset>> | undefined {
  return history === undefined
    ? undefined
    : new Map([...history].map(([revision, rows]) => [revision, cloneRows(rows)]));
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
