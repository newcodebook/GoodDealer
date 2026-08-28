import {
  checkpointDescriptorSchema,
  DOMAIN_ASSET_CHECKPOINT_PARTITION_ROWS,
  domainAssetCheckpointPartitionId,
  domainAssetProjectionSchema,
  workspaceEntityDigestsSchema,
  type CheckpointDescriptor,
  type DomainAssetProjectionRow,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";

import type { TenantTransaction } from "../../../db/index";

export type PersistentCheckpointStatus =
  | "building"
  | "verified"
  | "available"
  | "superseded"
  | "invalid";

export interface PersistentCheckpoint {
  readonly descriptor: CheckpointDescriptor;
  readonly status: PersistentCheckpointStatus;
  readonly rowVersion: number;
}

export interface CheckpointPinBinding {
  readonly checkpointId: string;
  readonly throughServerRevision: number;
  readonly checkpointDigest: string;
  readonly consumerKind: "bootstrap" | "recovery";
  readonly consumerId: string;
  readonly expiresAt: string;
}

export interface CheckpointCompactionBounds {
  readonly minimumPinnedRevision: number | null;
  readonly newestAvailableRevision: number | null;
}

export type CheckpointSupersedeResult = "superseded" | "pinned" | "last-usable" | "cas-lost";

export class PostgresCheckpointRepository {
  async createBuilding(
    transaction: TenantTransaction,
    descriptorValue: unknown,
    snapshotValue: unknown,
    entityDigestsValue: unknown,
  ): Promise<PersistentCheckpoint> {
    const descriptor = checkpointDescriptorSchema.parse(descriptorValue);
    assertWorkspace(descriptor.workspaceId, transaction.scope.workspaceId);
    const snapshot = domainAssetProjectionSchema.parse(snapshotValue);
    const entityDigests = workspaceEntityDigestsSchema.parse(entityDigestsValue);
    const digestBytes = decodeDigest(descriptor.checkpointDigest);

    const inserted = await transaction.query(
      `INSERT INTO workspace_checkpoints (
         account_id, workspace_id, checkpoint_id, schema_version, workspace_schema_version,
         through_server_revision, checkpoint_digest, capture_codec, capture_schema_version, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'domain-asset-projection-v1', 1, 'building')
       ON CONFLICT (account_id, workspace_id, checkpoint_id) DO NOTHING`,
      [
        transaction.scope.accountId,
        transaction.scope.workspaceId,
        descriptor.checkpointId,
        descriptor.schemaVersion,
        descriptor.workspaceSchemaVersion,
        descriptor.throughServerRevision,
        digestBytes,
      ],
    );

    if (inserted.rowCount === 0) {
      const existing = await this.read(transaction, descriptor.checkpointId, true);
      if (existing === null || !sameDescriptor(existing.descriptor, descriptor)) {
        throw new TypeError("checkpoint id is immutable");
      }
      return existing;
    }

    for (const [ordinal, entityDigest] of entityDigests.entries()) {
      await transaction.query(
        `INSERT INTO workspace_checkpoint_entity_digests (
           account_id, workspace_id, checkpoint_id, ordinal, entity_type, partition_key, partition_id, digest
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          transaction.scope.accountId,
          transaction.scope.workspaceId,
          descriptor.checkpointId,
          ordinal,
          entityDigest.entityType,
          entityDigest.partitionId ?? "",
          entityDigest.partitionId,
          decodeDigest(entityDigest.digest),
        ],
      );
    }
    for (const [index, row] of snapshot.entries()) {
      await insertSnapshotRow(
        transaction,
        descriptor.checkpointId,
        domainAssetCheckpointPartitionId(Math.floor(index / DOMAIN_ASSET_CHECKPOINT_PARTITION_ROWS)),
        row,
      );
    }
    return { descriptor, status: "building", rowVersion: 1 };
  }

  async read(
    transaction: TenantTransaction,
    checkpointId: string,
    lock = false,
  ): Promise<PersistentCheckpoint | null> {
    assertIdentifier(checkpointId, "checkpoint id");
    const result = await transaction.query<CheckpointRow>(
      `SELECT checkpoint_id, schema_version, workspace_schema_version, through_server_revision,
              checkpoint_digest, status, row_version
       FROM workspace_checkpoints
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
       ${lock ? "FOR UPDATE" : ""}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, checkpointId],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseCheckpointRow(row, transaction.scope.workspaceId);
  }

  async readSnapshot(
    transaction: TenantTransaction,
    checkpointId: string,
  ): Promise<readonly DomainAssetProjectionRow[]> {
    assertIdentifier(checkpointId, "checkpoint id");
    const result = await transaction.query<SnapshotRow>(
      `SELECT entity_id, note, portfolio_id, tags, target_price_currency, target_price_amount
       FROM workspace_checkpoint_domain_assets
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
       ORDER BY entity_id COLLATE "C"`,
      [transaction.scope.accountId, transaction.scope.workspaceId, checkpointId],
    );
    return domainAssetProjectionSchema.parse(result.rows.map(snapshotRowValue));
  }

  async readEntityDigests(
    transaction: TenantTransaction,
    checkpointId: string,
  ): Promise<readonly WorkspaceEntityDigest[]> {
    assertIdentifier(checkpointId, "checkpoint id");
    const result = await transaction.query<{
      ordinal: number;
      entity_type: string;
      partition_id: string | null;
      digest: Buffer;
    }>(
      `SELECT ordinal, entity_type, partition_id, digest
       FROM workspace_checkpoint_entity_digests
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
       ORDER BY ordinal`,
      [transaction.scope.accountId, transaction.scope.workspaceId, checkpointId],
    );
    result.rows.forEach((row, index) => {
      if (row.ordinal !== index) throw new TypeError("checkpoint digest ordinals are not contiguous");
    });
    return workspaceEntityDigestsSchema.parse(result.rows.map((row) => ({
      entityType: row.entity_type,
      partitionId: row.partition_id,
      digest: encodeDigest(row.digest),
    })));
  }

  async markVerified(
    transaction: TenantTransaction,
    checkpoint: PersistentCheckpoint,
  ): Promise<PersistentCheckpoint> {
    const result = await transaction.query(
      `UPDATE workspace_checkpoints
       SET status = 'verified', verified_at = transaction_timestamp(), row_version = row_version + 1
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
         AND status = 'building' AND row_version = $4`,
      [transaction.scope.accountId, transaction.scope.workspaceId, checkpoint.descriptor.checkpointId, checkpoint.rowVersion],
    );
    if (result.rowCount !== 1) throw new TypeError("checkpoint verify compare-and-set lost");
    return { ...checkpoint, status: "verified", rowVersion: checkpoint.rowVersion + 1 };
  }

  async markInvalid(
    transaction: TenantTransaction,
    checkpoint: PersistentCheckpoint,
    code: "checkpoint_digest_mismatch" | "checkpoint_storage_malformed",
    observedDigest: string | null,
  ): Promise<void> {
    const invalidated = await transaction.query(
      `UPDATE workspace_checkpoints
       SET status = 'invalid', invalidated_at = transaction_timestamp(), verified_at = NULL,
           row_version = row_version + 1
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
         AND status IN ('building', 'verified') AND row_version = $4`,
      [transaction.scope.accountId, transaction.scope.workspaceId, checkpoint.descriptor.checkpointId, checkpoint.rowVersion],
    );
    if (invalidated.rowCount !== 1) throw new TypeError("checkpoint invalidation compare-and-set lost");
    await transaction.query(
      `INSERT INTO workspace_checkpoint_diagnostics (
         account_id, workspace_id, checkpoint_id, diagnostic_code, observed_digest
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, workspace_id, checkpoint_id, diagnostic_code) DO NOTHING`,
      [
        transaction.scope.accountId,
        transaction.scope.workspaceId,
        checkpoint.descriptor.checkpointId,
        code,
        observedDigest === null ? null : decodeDigest(observedDigest),
      ],
    );
  }

  async publish(
    transaction: TenantTransaction,
    checkpoint: PersistentCheckpoint,
  ): Promise<PersistentCheckpoint> {
    if (checkpoint.status === "available") return checkpoint;
    const result = await transaction.query(
      `UPDATE workspace_checkpoints
       SET status = 'available', published_at = transaction_timestamp(), row_version = row_version + 1
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
         AND status = 'verified' AND row_version = $4`,
      [transaction.scope.accountId, transaction.scope.workspaceId, checkpoint.descriptor.checkpointId, checkpoint.rowVersion],
    );
    if (result.rowCount !== 1) throw new TypeError("checkpoint is not verified for publication");
    return { ...checkpoint, status: "available", rowVersion: checkpoint.rowVersion + 1 };
  }

  async supersede(
    transaction: TenantTransaction,
    checkpoint: PersistentCheckpoint,
  ): Promise<CheckpointSupersedeResult> {
    await transaction.query(
      `SELECT checkpoint_id FROM workspace_checkpoints
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'available'
       ORDER BY checkpoint_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    await transaction.query(
      `UPDATE workspace_checkpoint_pins
       SET released_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND released_at IS NULL
         AND expires_at <= transaction_timestamp()`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const pins = await transaction.query(
      `SELECT checkpoint_id FROM workspace_checkpoint_pins
       WHERE account_id = $1 AND workspace_id = $2 AND released_at IS NULL
       ORDER BY checkpoint_id COLLATE "C", consumer_kind COLLATE "C", consumer_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    if (pins.rows.some((row) => row["checkpoint_id"] === checkpoint.descriptor.checkpointId)) return "pinned";
    const available = await transaction.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM workspace_checkpoints
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'available'`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    if (available.rows[0]?.count === "1") return "last-usable";
    const result = await transaction.query(
      `UPDATE workspace_checkpoints
       SET status = 'superseded', superseded_at = transaction_timestamp(), row_version = row_version + 1
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
         AND status = 'available' AND row_version = $4`,
      [transaction.scope.accountId, transaction.scope.workspaceId, checkpoint.descriptor.checkpointId, checkpoint.rowVersion],
    );
    return result.rowCount === 1 ? "superseded" : "cas-lost";
  }

  async pin(transaction: TenantTransaction, value: CheckpointPinBinding): Promise<void> {
    const binding = parsePinBinding(value);
    const result = await transaction.query(
      `INSERT INTO workspace_checkpoint_pins (
         account_id, workspace_id, checkpoint_id, consumer_kind, consumer_id,
         expected_through_server_revision, expected_checkpoint_digest, expires_at
       )
       SELECT $1, $2, checkpoint_id, $4, $5, through_server_revision, checkpoint_digest, $8::timestamptz
       FROM workspace_checkpoints
       WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = $3
         AND status = 'available' AND through_server_revision = $6 AND checkpoint_digest = $7
         AND $8::timestamptz > transaction_timestamp()
       ON CONFLICT (account_id, workspace_id, checkpoint_id, consumer_kind, consumer_id)
       DO UPDATE SET expires_at = greatest(workspace_checkpoint_pins.expires_at, EXCLUDED.expires_at)
       WHERE workspace_checkpoint_pins.released_at IS NULL
         AND workspace_checkpoint_pins.expected_through_server_revision = EXCLUDED.expected_through_server_revision
         AND workspace_checkpoint_pins.expected_checkpoint_digest = EXCLUDED.expected_checkpoint_digest`,
      [
        transaction.scope.accountId,
        transaction.scope.workspaceId,
        binding.checkpointId,
        binding.consumerKind,
        binding.consumerId,
        binding.throughServerRevision,
        decodeDigest(binding.checkpointDigest),
        binding.expiresAt,
      ],
    );
    if (result.rowCount !== 1) throw new TypeError("checkpoint pin binding conflicts or is unavailable");
  }

  async releasePin(
    transaction: TenantTransaction,
    consumerKind: "bootstrap" | "recovery",
    consumerId: string,
  ): Promise<void> {
    assertIdentifier(consumerId, "checkpoint pin consumer id");
    await transaction.query(
      `UPDATE workspace_checkpoint_pins
       SET released_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND consumer_kind = $3 AND consumer_id = $4
         AND released_at IS NULL`,
      [transaction.scope.accountId, transaction.scope.workspaceId, consumerKind, consumerId],
    );
  }

  async lockCompactionBounds(transaction: TenantTransaction): Promise<CheckpointCompactionBounds> {
    await transaction.query(
      `SELECT checkpoint_id FROM workspace_checkpoints
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'available'
       ORDER BY checkpoint_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    await transaction.query(
      `UPDATE workspace_checkpoint_pins
       SET released_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND released_at IS NULL
         AND expires_at <= transaction_timestamp()`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    await transaction.query(
      `SELECT checkpoint_id FROM workspace_checkpoint_pins
       WHERE account_id = $1 AND workspace_id = $2 AND released_at IS NULL
       ORDER BY checkpoint_id COLLATE "C", consumer_kind COLLATE "C", consumer_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const result = await transaction.query<{
      minimum_pinned_revision: string | null;
      newest_available_revision: string | null;
    }>(
      `SELECT
         (SELECT min(expected_through_server_revision)::text FROM workspace_checkpoint_pins
          WHERE account_id = $1 AND workspace_id = $2 AND released_at IS NULL) AS minimum_pinned_revision,
         (SELECT max(through_server_revision)::text FROM workspace_checkpoints
          WHERE account_id = $1 AND workspace_id = $2 AND status = 'available') AS newest_available_revision`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("checkpoint compaction bounds are unavailable");
    return {
      minimumPinnedRevision: parseNullableRevision(row.minimum_pinned_revision),
      newestAvailableRevision: parseNullableRevision(row.newest_available_revision),
    };
  }
}

interface CheckpointRow {
  readonly checkpoint_id: string;
  readonly schema_version: number;
  readonly workspace_schema_version: string;
  readonly through_server_revision: string;
  readonly checkpoint_digest: Buffer;
  readonly status: string;
  readonly row_version: string;
}

interface SnapshotRow {
  readonly entity_id: string;
  readonly note: string | null;
  readonly portfolio_id: string | null;
  readonly tags: string[];
  readonly target_price_currency: string | null;
  readonly target_price_amount: string | null;
}

function parseCheckpointRow(row: CheckpointRow, workspaceId: string): PersistentCheckpoint {
  if (!isCheckpointStatus(row.status)) throw new TypeError("stored checkpoint status is malformed");
  return {
    descriptor: checkpointDescriptorSchema.parse({
      schemaVersion: row.schema_version,
      checkpointId: row.checkpoint_id,
      workspaceId,
      workspaceSchemaVersion: parsePositiveSafeInteger(row.workspace_schema_version, "workspace schema version"),
      throughServerRevision: parseSafeRevision(row.through_server_revision),
      checkpointDigest: encodeDigest(row.checkpoint_digest),
    }),
    status: row.status,
    rowVersion: parsePositiveSafeInteger(row.row_version, "checkpoint row version"),
  };
}

function snapshotRowValue(row: SnapshotRow): unknown {
  return {
    entityId: row.entity_id,
    note: row.note,
    portfolioId: row.portfolio_id,
    tags: row.tags,
    targetPrice: row.target_price_currency === null || row.target_price_amount === null
      ? null
      : { currency: row.target_price_currency, amount: row.target_price_amount },
  };
}

async function insertSnapshotRow(
  transaction: TenantTransaction,
  checkpointId: string,
  partitionId: string,
  row: DomainAssetProjectionRow,
): Promise<void> {
  await transaction.query(
    `INSERT INTO workspace_checkpoint_domain_assets (
       account_id, workspace_id, checkpoint_id, entity_id, partition_id, note, portfolio_id, tags,
       target_price_currency, target_price_amount
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      transaction.scope.accountId,
      transaction.scope.workspaceId,
      checkpointId,
      row.entityId,
      partitionId,
      row.note,
      row.portfolioId,
      row.tags,
      row.targetPrice?.currency ?? null,
      row.targetPrice?.amount ?? null,
    ],
  );
}

function parsePinBinding(value: CheckpointPinBinding): CheckpointPinBinding {
  assertIdentifier(value.checkpointId, "checkpoint id");
  assertIdentifier(value.consumerId, "checkpoint pin consumer id");
  if (value.consumerKind !== "bootstrap" && value.consumerKind !== "recovery") {
    throw new TypeError("checkpoint pin consumer kind is malformed");
  }
  if (!Number.isSafeInteger(value.throughServerRevision) || value.throughServerRevision < 0) {
    throw new TypeError("checkpoint pin revision is malformed");
  }
  decodeDigest(value.checkpointDigest);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value.expiresAt)) {
    throw new TypeError("checkpoint pin expiry is malformed");
  }
  return value;
}

function sameDescriptor(left: CheckpointDescriptor, right: CheckpointDescriptor): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.checkpointId === right.checkpointId &&
    left.workspaceId === right.workspaceId &&
    left.workspaceSchemaVersion === right.workspaceSchemaVersion &&
    left.throughServerRevision === right.throughServerRevision &&
    left.checkpointDigest === right.checkpointDigest;
}

function assertWorkspace(actual: string, expected: string): void {
  if (actual !== expected) throw new TypeError("checkpoint workspace does not match tenant scope");
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || !/^[!-~]+$/u.test(value)) {
    throw new TypeError(`${label} is malformed`);
  }
}

function parseSafeRevision(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("stored revision is malformed");
  return parsed;
}

function parsePositiveSafeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`stored ${label} is malformed`);
  return parsed;
}

function parseNullableRevision(value: string | null): number | null {
  return value === null ? null : parseSafeRevision(value);
}

function decodeDigest(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new TypeError("checkpoint digest is malformed");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32) throw new TypeError("checkpoint digest is malformed");
  return decoded;
}

function encodeDigest(value: Buffer): string {
  if (!Buffer.isBuffer(value) || value.byteLength !== 32) throw new TypeError("stored checkpoint digest is malformed");
  return value.toString("base64url");
}

function isCheckpointStatus(value: string): value is PersistentCheckpointStatus {
  return value === "building" || value === "verified" || value === "available" ||
    value === "superseded" || value === "invalid";
}
