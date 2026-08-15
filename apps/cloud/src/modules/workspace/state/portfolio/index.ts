import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";
import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";

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

export interface DomainAssetProjection {
  readonly entityId: string;
  readonly note: string | null;
  readonly portfolioId: string | null;
  readonly tags: readonly string[];
  readonly targetPrice: { readonly currency: string; readonly amount: string } | null;
  readonly lastModifiedRevision: Readonly<Record<DomainAssetFieldPath, number>>;
}

export interface PortfolioMutationPort {
  hasDomainAsset(scope: WorkspaceTenantScope, entityId: string): boolean;
  readFieldRevision(scope: WorkspaceTenantScope, entityId: string, fieldPath: DomainAssetFieldPath): number | null;
  applyAcceptedMutations(
    scope: WorkspaceTenantScope,
    mutations: readonly { readonly mutation: SubmittedSyncMutation; readonly serverRevision: number }[],
  ): { rollback(): void };
}

/** In-memory V1 domain_asset projection; revision metadata never enters business digests. */
export class InMemoryDomainAssetPortfolio implements PortfolioMutationPort {
  readonly #rows = new Map<string, Map<string, StoredDomainAsset>>();

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
  }

  hasDomainAsset(scope: WorkspaceTenantScope, entityId: string): boolean {
    return this.#rows.get(workspaceTenantKey(scope))?.has(entityId) === true;
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
    for (const { mutation, serverRevision } of mutations) {
      const row = rows.get(mutation.entityId);
      if (row === undefined) throw new TypeError("accepted mutation names an unknown domain asset");
      for (const field of mutation.changedFields) applyField(row, field, serverRevision);
    }
    return { rollback: () => this.#rows.set(workspaceTenantKey(scope), previous) };
  }

  inspectDomainAsset(scope: WorkspaceTenantScope, entityId: string): DomainAssetProjection | null {
    const row = this.#rows.get(workspaceTenantKey(scope))?.get(entityId);
    return row === undefined ? null : projectRow(row);
  }

  snapshot(scope: WorkspaceTenantScope): readonly DomainAssetProjection[] {
    return [...(this.#rows.get(workspaceTenantKey(scope))?.values() ?? [])]
      .sort((left, right) => left.entityId.localeCompare(right.entityId))
      .map(projectRow);
  }

  async computeBusinessDigest(
    scope: WorkspaceTenantScope,
    digest: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<string> {
    const canonicalRows = this.snapshot(scope).map(({ lastModifiedRevision: _revision, ...row }) => row);
    const bytes = encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-DOMAIN-ASSET-V1", canonicalRows);
    return Buffer.from(await digest(bytes)).toString("base64url");
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

function cloneMoney<Value extends { readonly currency: string; readonly amount: string } | null>(value: Value): Value {
  return (value === null ? null : { ...value }) as Value;
}
