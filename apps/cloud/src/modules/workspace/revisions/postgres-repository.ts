import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";

import type { TenantTransaction } from "../../../db/index";

export interface WorkspaceRevisionSnapshot {
  readonly workspaceSchemaVersion: number;
  readonly serverRevision: number;
  readonly compactedThroughServerRevision: number;
  readonly lastReplicationActivityAt: string | null;
  readonly lastSuccessfulProviderObservationAt: string | null;
}

export interface WorkspaceRevisionQueryPort {
  read(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null>;
}

export interface WorkspaceRevisionMutationPort extends WorkspaceRevisionQueryPort {
  /** Locks the tenant workspace head. Callers must preserve the documented global lock order. */
  lock(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null>;
  compareAndAdvance(
    transaction: TenantTransaction,
    expectedRevision: number,
    nextRevision: number,
  ): Promise<void>;
  compareAndAdvanceCompactionWatermark(
    transaction: TenantTransaction,
    expectedWatermark: number,
    nextWatermark: number,
  ): Promise<void>;
}

export class PostgresWorkspaceRevisionRepository implements WorkspaceRevisionMutationPort {
  async bind(transaction: TenantTransaction, workspaceSchemaVersion: number): Promise<void> {
    assertPositiveSafeInteger(workspaceSchemaVersion, "workspace schema version");
    const result = await transaction.query(
      `INSERT INTO workspace_revisions (account_id, workspace_id, workspace_schema_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, workspace_id) DO UPDATE
       SET workspace_schema_version = workspace_revisions.workspace_schema_version
       WHERE workspace_revisions.workspace_schema_version = EXCLUDED.workspace_schema_version`,
      [transaction.scope.accountId, transaction.scope.workspaceId, workspaceSchemaVersion],
    );
    if (result.rowCount !== 1) throw new TypeError("workspace binding is immutable");
  }

  async read(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null> {
    return this.#read(transaction, false);
  }

  async lock(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null> {
    return this.#read(transaction, true);
  }

  async #read(transaction: TenantTransaction, forUpdate: boolean): Promise<WorkspaceRevisionSnapshot | null> {
    const result = await transaction.query<{
      workspace_schema_version: string;
      server_revision: string;
      compacted_through_server_revision: string;
      last_replication_activity_at: string | null;
      last_successful_provider_observation_at: string | null;
    }>(
      `SELECT workspace_schema_version, server_revision, compacted_through_server_revision,
              to_char(last_replication_activity_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_replication_activity_at,
              to_char(last_successful_provider_observation_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_successful_provider_observation_at
       FROM workspace_revisions
       WHERE account_id = $1 AND workspace_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      workspaceSchemaVersion: parseSafeInteger(row.workspace_schema_version),
      serverRevision: parseSafeInteger(row.server_revision),
      compactedThroughServerRevision: parseSafeInteger(row.compacted_through_server_revision),
      lastReplicationActivityAt: canonicalUtcTimestamp.nullable().parse(row.last_replication_activity_at),
      lastSuccessfulProviderObservationAt: canonicalUtcTimestamp.nullable().parse(row.last_successful_provider_observation_at),
    };
  }

  async compareAndAdvance(
    transaction: TenantTransaction,
    expectedRevision: number,
    nextRevision: number,
  ): Promise<void> {
    assertUnsignedSafeInteger(expectedRevision, "expected revision");
    assertPositiveSafeInteger(nextRevision, "next revision");
    if (nextRevision <= expectedRevision) throw new TypeError("next revision must advance the head");
    const result = await transaction.query(
      `UPDATE workspace_revisions
       SET server_revision = $3, last_replication_activity_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND server_revision = $4`,
      [transaction.scope.accountId, transaction.scope.workspaceId, nextRevision, expectedRevision],
    );
    if (result.rowCount !== 1) throw new TypeError("workspace revision compare-and-set lost");
  }

  async compareAndAdvanceCompactionWatermark(
    transaction: TenantTransaction,
    expectedWatermark: number,
    nextWatermark: number,
  ): Promise<void> {
    assertUnsignedSafeInteger(expectedWatermark, "expected compaction watermark");
    assertUnsignedSafeInteger(nextWatermark, "next compaction watermark");
    if (nextWatermark < expectedWatermark) throw new TypeError("compaction watermark cannot regress");
    const result = await transaction.query(
      `SELECT public.workspace_compaction_advance($1::bigint, $2::bigint)`,
      [expectedWatermark, nextWatermark],
    );
    if (result.rowCount !== 1) throw new TypeError("workspace compaction watermark compare-and-set lost");
  }
}

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  assertUnsignedSafeInteger(parsed, "stored workspace revision");
  return parsed;
}

function assertUnsignedSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be unsigned and safe`);
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be positive and safe`);
}
