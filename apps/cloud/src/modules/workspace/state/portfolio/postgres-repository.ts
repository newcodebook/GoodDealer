import {
  compareUtf8,
  domainAssetProjectionRowSchema,
  domainAssetProjectionSchema,
  portfolioReadAssetSchema,
  portfolioReadProjectionSchema,
  submittedSyncMutationSchema,
  workspacePortfolioReadResponseSchema,
  serverRevisionSchema,
  type DomainAssetProjectionRow,
  type SubmittedSyncMutation,
} from "@gooddealer/protocol/workspace";

import {
  type TenantTransaction,
  TenantTransactionRunner,
} from "../../../../db/index";
import type {
  WorkspaceRevisionMutationPort,
  WorkspaceRevisionQueryPort,
} from "../../revisions/index";
import type { WorkspaceTenantScope } from "../../tenant-scope";

export interface PortfolioProjectionQueryPort {
  readPortfolio(scope: WorkspaceTenantScope): Promise<unknown>;
}

export interface PortfolioMaterializationPort {
  materialize(
    transaction: TenantTransaction,
    nextRevision: number,
    rows: readonly DomainAssetProjectionRow[],
  ): Promise<void>;
}

type DomainAssetFieldPath = SubmittedSyncMutation["changedFields"][number]["fieldPath"];

export interface LockedDomainAsset extends DomainAssetProjectionRow {
  readonly entityGeneration: number;
  readonly lastModifiedRevision: Readonly<Record<DomainAssetFieldPath, number>>;
}

/** Transaction-aware state boundary used by sync/checkpoint owners; it never allocates revisions. */
export interface PortfolioSyncPersistencePort extends PortfolioMaterializationPort {
  /** Live rows among `entityIds`; a soft-deleted row is reported by `readDomainAssetTombstones`. */
  lockDomainAssets(
    transaction: TenantTransaction,
    entityIds: readonly string[],
  ): Promise<readonly LockedDomainAsset[]>;
  /** Tombstoned domain assets among `entityIds`, each with the generation it deleted. */
  readDomainAssetTombstones(
    transaction: TenantTransaction,
    entityIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  applyAcceptedMutations(
    transaction: TenantTransaction,
    assignments: readonly { readonly mutation: SubmittedSyncMutation; readonly serverRevision: number }[],
  ): Promise<void>;
  captureSnapshot(transaction: TenantTransaction): Promise<readonly DomainAssetProjectionRow[]>;
}

export class PostgresPortfolioRepository implements PortfolioSyncPersistencePort {
  async materialize(
    transaction: TenantTransaction,
    nextRevision: number,
    values: readonly DomainAssetProjectionRow[],
  ): Promise<void> {
    const revision = serverRevisionSchema.parse(nextRevision);
    if (revision < 1) throw new TypeError("portfolio materialization revision must be positive");
    const rows = domainAssetProjectionSchema.parse(values);
    for (const row of rows) {
      await transaction.query(
        `INSERT INTO workspace_replica_domain_assets (
           account_id, workspace_id, entity_id, note, portfolio_id, tags,
           target_price_currency, target_price_amount,
           note_server_revision, portfolio_id_server_revision, tags_server_revision, target_price_server_revision
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9, $9)
         ON CONFLICT (account_id, workspace_id, entity_id) DO UPDATE SET
           note = EXCLUDED.note,
           portfolio_id = EXCLUDED.portfolio_id,
           tags = EXCLUDED.tags,
           target_price_currency = EXCLUDED.target_price_currency,
           target_price_amount = EXCLUDED.target_price_amount,
           note_server_revision = EXCLUDED.note_server_revision,
           portfolio_id_server_revision = EXCLUDED.portfolio_id_server_revision,
           tags_server_revision = EXCLUDED.tags_server_revision,
           target_price_server_revision = EXCLUDED.target_price_server_revision
         WHERE workspace_replica_domain_assets.deleted_at IS NULL`,
        [
          transaction.scope.accountId,
          transaction.scope.workspaceId,
          row.entityId,
          row.note,
          row.portfolioId,
          row.tags,
          row.targetPrice?.currency ?? null,
          row.targetPrice?.amount ?? null,
          revision,
        ],
      ).then((result) => {
        // A snapshot naming a deleted asset would revive it; ADR-0029 re-add is the only way back.
        if (result.rowCount !== 1) throw new TypeError("portfolio materialization names a deleted domain asset");
      });
    }
    const state = await transaction.query(
      `UPDATE workspace_replica_portfolio_state
       SET materialized_through_server_revision = $3, materialized_at = transaction_timestamp(),
           projection_availability = 'available', projection_evidence_status = 'confirmed'
       WHERE account_id = $1 AND workspace_id = $2`,
      [transaction.scope.accountId, transaction.scope.workspaceId, revision],
    );
    if (state.rowCount !== 1) {
      throw new TypeError("portfolio replica state is unavailable");
    }
  }

  async seed(transaction: TenantTransaction, value: unknown): Promise<void> {
    const row = domainAssetProjectionRowSchema.parse(value);
    await transaction.query(
      `INSERT INTO workspace_replica_domain_assets (
         account_id, workspace_id, entity_id, note, portfolio_id, tags,
         target_price_currency, target_price_amount
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        transaction.scope.accountId,
        transaction.scope.workspaceId,
        row.entityId,
        row.note,
        row.portfolioId,
        row.tags,
        row.targetPrice?.currency ?? null,
        row.targetPrice?.amount ?? null,
      ],
    );
  }

  async lockDomainAssets(
    transaction: TenantTransaction,
    values: readonly string[],
  ): Promise<readonly LockedDomainAsset[]> {
    const entityIds = [...new Set(values.map((value) => domainAssetProjectionRowSchema.shape.entityId.parse(value)))]
      .sort(compareUtf8);
    if (entityIds.length === 0) return [];
    const result = await transaction.query<StoredDomainAssetRow>(
      `SELECT entity_id, entity_generation::text AS entity_generation,
              note, portfolio_id, tags, target_price_currency, target_price_amount,
              note_server_revision, portfolio_id_server_revision, tags_server_revision, target_price_server_revision
       FROM workspace_replica_domain_assets
       WHERE account_id = $1 AND workspace_id = $2 AND entity_id = ANY($3::text[]) AND deleted_at IS NULL
       ORDER BY entity_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, entityIds],
    );
    return result.rows.map(parseLockedDomainAsset);
  }

  async readDomainAssetTombstones(
    transaction: TenantTransaction,
    values: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    const entityIds = [...new Set(values.map((value) => domainAssetProjectionRowSchema.shape.entityId.parse(value)))];
    if (entityIds.length === 0) return new Map();
    // Tombstones are written only by an ingest or materialization that holds the workspace revision
    // lock, which every caller already holds, so this read cannot race a concurrent delete.
    const result = await transaction.query<{ entity_id: unknown; entity_generation: unknown }>(
      `SELECT entity_id, entity_generation::text AS entity_generation FROM workspace_replica_tombstones
       WHERE account_id = $1 AND workspace_id = $2 AND entity_type = 'domain_asset' AND entity_id = ANY($3::text[])`,
      [transaction.scope.accountId, transaction.scope.workspaceId, entityIds],
    );
    return new Map(result.rows.map((row) => {
      const tombstone = strictRow(row, ["entity_id", "entity_generation"] as const);
      return [
        domainAssetProjectionRowSchema.shape.entityId.parse(tombstone.entity_id),
        parseStoredGeneration(tombstone.entity_generation),
      ] as const;
    }));
  }

  async applyAcceptedMutations(
    transaction: TenantTransaction,
    values: readonly { readonly mutation: SubmittedSyncMutation; readonly serverRevision: number }[],
  ): Promise<void> {
    for (const value of values) {
      const mutation = submittedSyncMutationSchema.parse(value.mutation);
      const revision = serverRevisionSchema.parse(value.serverRevision);
      if (revision < 1 || mutation.workspaceId !== transaction.scope.workspaceId) {
        throw new TypeError("accepted portfolio mutation binding is invalid");
      }
      if (mutation.operationKind === "delete") {
        await softDeleteDomainAsset(transaction, mutation, revision);
        continue;
      }
      // The first upsert of an asset the replica does not hold creates it with every field at its
      // default and revision 0; the ingest has already refused assets that are tombstoned.
      await transaction.query(
        `INSERT INTO workspace_replica_domain_assets (account_id, workspace_id, entity_id)
         VALUES ($1, $2, $3) ON CONFLICT (account_id, workspace_id, entity_id) DO NOTHING`,
        [transaction.scope.accountId, transaction.scope.workspaceId, mutation.entityId],
      );
      for (const field of mutation.changedFields) {
        const { assignments, parameters } = fieldAssignment(field, revision);
        const result = await transaction.query(
          `UPDATE workspace_replica_domain_assets SET ${assignments}
           WHERE account_id = $1 AND workspace_id = $2 AND entity_id = $3 AND deleted_at IS NULL`,
          [transaction.scope.accountId, transaction.scope.workspaceId, mutation.entityId, ...parameters],
        );
        if (result.rowCount !== 1) throw new TypeError("accepted mutation entity is unavailable");
      }
    }
  }

  async captureSnapshot(transaction: TenantTransaction): Promise<readonly DomainAssetProjectionRow[]> {
    const result = await transaction.query<Pick<StoredDomainAssetRow,
      "entity_id" | "note" | "portfolio_id" | "tags" | "target_price_currency" | "target_price_amount">>(
      `SELECT entity_id, note, portfolio_id, tags, target_price_currency, target_price_amount
       FROM workspace_replica_domain_assets
       WHERE account_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       ORDER BY entity_id COLLATE "C"`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    return domainAssetProjectionSchema.parse(result.rows.map(parseProjection));
  }
}

export class PostgresPortfolioProjectionQuery implements PortfolioProjectionQueryPort {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly revisions: WorkspaceRevisionQueryPort;
  }) {}

  async readPortfolio(scope: WorkspaceTenantScope): Promise<unknown> {
    return this.dependencies.transactions.withTenant(scope, async (transaction) => {
      const assets = await transaction.query(
        `SELECT entity_id, note, portfolio_id, tags, target_price_currency, target_price_amount,
                materialization_origin, materialization_version_token,
                to_char(materialized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                  AS materialized_at,
                projection_availability, projection_evidence_status
         FROM workspace_replica_domain_assets
         WHERE account_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
         ORDER BY entity_id COLLATE "C"`,
        [transaction.scope.accountId, transaction.scope.workspaceId],
      );
      const states = await transaction.query(
        `SELECT materialized_through_server_revision::text AS materialized_through_server_revision,
                to_char(materialized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS materialized_at,
                projection_availability, projection_evidence_status
         FROM workspace_replica_portfolio_state
         WHERE account_id = $1 AND workspace_id = $2`,
        [transaction.scope.accountId, transaction.scope.workspaceId],
      );
      if (states.rows.length !== 1) {
        throw new TypeError("portfolio projection state invariant is violated");
      }
      const parsedAssets = assets.rows
        .map(parsePortfolioReadAsset)
        .sort((left, right) => compareUtf8(left.asset.entityId, right.asset.entityId));
      return workspacePortfolioReadResponseSchema.parse({
        schemaVersion: 1,
        assets: parsedAssets,
        projection: parsePortfolioProjectionState(states.rows[0]),
      });
    }, { readOnly: true, repeatableRead: true });
  }
}

/**
 * ADR-0029 decision 2: the row stays, because immutable DNS observation receipts reference it, but
 * keeps none of its business fields and is archived; the tombstone carries the deletion revision.
 * The database refuses a deleted row without its tombstone at commit and any later change to it.
 */
async function softDeleteDomainAsset(
  transaction: TenantTransaction,
  mutation: SubmittedSyncMutation,
  revision: number,
): Promise<void> {
  if (mutation.deletedAt === undefined) throw new TypeError("accepted delete has no deletion time");
  const deleted = await transaction.query(
    `UPDATE workspace_replica_domain_assets SET
       deleted_at = $4::timestamptz, lifecycle_status = 'archived', lifecycle_status_server_revision = $5,
       note = NULL, note_server_revision = $5,
       portfolio_id = NULL, portfolio_id_server_revision = $5,
       tags = '{}', tags_server_revision = $5,
       target_price_currency = NULL, target_price_amount = NULL, target_price_server_revision = $5
     WHERE account_id = $1 AND workspace_id = $2 AND entity_id = $3 AND deleted_at IS NULL`,
    [transaction.scope.accountId, transaction.scope.workspaceId, mutation.entityId, mutation.deletedAt, revision],
  );
  if (deleted.rowCount !== 1) throw new TypeError("accepted delete names no live domain asset");
  await transaction.query(
    `INSERT INTO workspace_replica_tombstones (
       account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at
     ) VALUES ($1, $2, 'domain_asset', $3, $4, $5::timestamptz)`,
    [transaction.scope.accountId, transaction.scope.workspaceId, mutation.entityId, revision, mutation.deletedAt],
  );
}

interface StoredDomainAssetRow {
  readonly entity_id: string;
  readonly note: string | null;
  readonly portfolio_id: string | null;
  readonly tags: string[];
  readonly target_price_currency: string | null;
  readonly target_price_amount: string | null;
  readonly note_server_revision: string;
  readonly portfolio_id_server_revision: string;
  readonly tags_server_revision: string;
  readonly target_price_server_revision: string;
}

function parseProjection(value: unknown): DomainAssetProjectionRow {
  const row = strictRow(value, PROJECTION_ROW_KEYS);
  const currency = row.target_price_currency;
  const amount = row.target_price_amount;
  if ((currency === null) !== (amount === null)) {
    throw new TypeError("stored target price is partially null");
  }
  return domainAssetProjectionRowSchema.parse({
    entityId: row.entity_id,
    note: row.note,
    portfolioId: row.portfolio_id,
    tags: row.tags,
    targetPrice: currency === null
      ? null
      : { currency, amount },
  });
}

function parseLockedDomainAsset(value: unknown): LockedDomainAsset {
  const row = strictRow(value, LOCKED_ROW_KEYS);
  return {
    ...parseProjection(pickRow(row, PROJECTION_ROW_KEYS)),
    entityGeneration: parseStoredGeneration(row.entity_generation),
    lastModifiedRevision: {
      note: parseStoredRevision(row.note_server_revision),
      portfolioId: parseStoredRevision(row.portfolio_id_server_revision),
      tags: parseStoredRevision(row.tags_server_revision),
      targetPrice: parseStoredRevision(row.target_price_server_revision),
    },
  };
}

function parseStoredGeneration(value: unknown): number {
  const generation = parseStoredRevision(value);
  if (generation < 1) throw new TypeError("stored entity generation must be positive");
  return generation;
}

function parseStoredRevision(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("stored revision must be unsigned decimal text");
  }
  const revision = Number(value);
  return serverRevisionSchema.parse(revision);
}

const PROJECTION_ROW_KEYS = [
  "entity_id",
  "note",
  "portfolio_id",
  "tags",
  "target_price_currency",
  "target_price_amount",
] as const;

const LOCKED_ROW_KEYS = [
  ...PROJECTION_ROW_KEYS,
  "entity_generation",
  "note_server_revision",
  "portfolio_id_server_revision",
  "tags_server_revision",
  "target_price_server_revision",
] as const;

const READ_ASSET_ROW_KEYS = [
  ...PROJECTION_ROW_KEYS,
  "materialization_origin",
  "materialization_version_token",
  "materialized_at",
  "projection_availability",
  "projection_evidence_status",
] as const;

const PROJECTION_STATE_ROW_KEYS = [
  "materialized_through_server_revision",
  "materialized_at",
  "projection_availability",
  "projection_evidence_status",
] as const;

function parsePortfolioReadAsset(value: unknown) {
  const row = strictRow(value, READ_ASSET_ROW_KEYS);
  return portfolioReadAssetSchema.parse({
    asset: parseProjection(pickRow(row, PROJECTION_ROW_KEYS)),
    materialization: {
      origin: row.materialization_origin,
      versionToken: row.materialization_version_token,
      materializedAt: row.materialized_at,
      projectionAvailability: row.projection_availability,
      projectionEvidenceStatus: row.projection_evidence_status,
    },
  });
}

function parsePortfolioProjectionState(value: unknown) {
  const row = strictRow(value, PROJECTION_STATE_ROW_KEYS);
  return portfolioReadProjectionSchema.parse({
    materializedThroughServerRevision: parseStoredRevision(row.materialized_through_server_revision),
    materializedAt: row.materialized_at,
    projectionAvailability: row.projection_availability,
    projectionEvidenceStatus: row.projection_evidence_status,
  });
}

function strictRow<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("stored portfolio row must be an object");
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("stored portfolio row has an invalid shape");
  }
  return value as Record<Keys[number], unknown>;
}

function pickRow<const Keys extends readonly string[]>(
  row: Record<string, unknown>,
  keys: Keys,
): Record<Keys[number], unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as Record<Keys[number], unknown>;
}

function fieldAssignment(
  field: SubmittedSyncMutation["changedFields"][number],
  revision: number,
): { readonly assignments: string; readonly parameters: readonly unknown[] } {
  switch (field.fieldPath) {
    case "note":
      return { assignments: "note = $4, note_server_revision = $5", parameters: [field.value, revision] };
    case "portfolioId":
      return { assignments: "portfolio_id = $4, portfolio_id_server_revision = $5", parameters: [field.value, revision] };
    case "tags":
      return { assignments: "tags = $4, tags_server_revision = $5", parameters: [field.value, revision] };
    case "targetPrice":
      return {
        assignments: "target_price_currency = $4, target_price_amount = $5, target_price_server_revision = $6",
        parameters: [field.value?.currency ?? null, field.value?.amount ?? null, revision],
      };
  }
}

/** Advances the workspace head and materializes its projection in one tenant transaction. */
export class PostgresPortfolioMutationService {
  constructor(private readonly dependencies: {
    readonly transactions: TenantTransactionRunner;
    readonly revisions: WorkspaceRevisionMutationPort;
    readonly portfolio: PortfolioMaterializationPort;
  }) {}

  async compareAndMaterialize(
    scope: unknown,
    expectedRevision: number,
    nextRevision: number,
    value: unknown,
  ): Promise<void> {
    const rows = domainAssetProjectionSchema.parse(value);
    await this.dependencies.transactions.withTenant(scope, async (transaction) => {
      await this.dependencies.revisions.compareAndAdvance(transaction, expectedRevision, nextRevision);
      await this.dependencies.portfolio.materialize(transaction, nextRevision, rows);
    });
  }
}
