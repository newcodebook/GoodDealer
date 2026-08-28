import { canonicalUtcTimestamp, identifier } from "@gooddealer/protocol/wire";

import type { TenantTransaction } from "../../../db/index";

export type PostgresReaderCursorRetirementReason =
  | "ttl_expired"
  | "compaction_race"
  | "device_removed";

export interface PostgresReaderCursorSnapshot {
  readonly deviceId: string;
  readonly generation: number;
  readonly rowVersion: number;
  readonly readThroughServerRevision: number;
  readonly leaseExpiresAt: string;
  readonly status: "active" | "retired";
  readonly resumeRequirement: "none" | "rebootstrap_required";
  readonly retiredAt: string | null;
  readonly retirementReason: PostgresReaderCursorRetirementReason | null;
  readonly pinnedPageTargetServerRevision: number | null;
  readonly nextRevision: number | null;
  readonly continuationTokenDigest: Uint8Array | null;
}

export interface ReaderCursorDeviceRemovalPort {
  retireForDeviceRemoval(transaction: TenantTransaction, deviceId: string): Promise<void>;
}

export interface ReaderCursorCompactionWatermarkPort {
  retireExpiredAndReadMinimumActiveRevision(transaction: TenantTransaction): Promise<number | null>;
}

export class PostgresReaderCursorRepository
implements ReaderCursorDeviceRemovalPort, ReaderCursorCompactionWatermarkPort {
  async lock(
    transaction: TenantTransaction,
    deviceIdValue: unknown,
  ): Promise<PostgresReaderCursorSnapshot | null> {
    const deviceId = parseDeviceId(deviceIdValue);
    const result = await transaction.query<StoredReaderCursorRow>(
      `${SELECT_COLUMNS}
       FROM workspace_reader_cursors
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3
       FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseStoredRow(row);
  }

  async insertActive(
    transaction: TenantTransaction,
    deviceIdValue: unknown,
    atRevision: number,
    leaseTtlSeconds: number,
  ): Promise<PostgresReaderCursorSnapshot> {
    const deviceId = parseDeviceId(deviceIdValue);
    assertRevision(atRevision, "reader cursor revision");
    assertTtl(leaseTtlSeconds);
    const result = await transaction.query<StoredReaderCursorRow>(
      `INSERT INTO workspace_reader_cursors
         (account_id, workspace_id, device_id, cursor_generation, row_version,
          read_through_server_revision, lease_expires_at, status, resume_requirement)
       VALUES ($1, $2, $3, 1, 1, $4,
         transaction_timestamp() + ($5 * interval '1 second'), 'active', 'none')
       RETURNING ${RETURNING_COLUMNS}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId, atRevision, leaseTtlSeconds],
    );
    return parseRequiredRow(result.rows[0]);
  }

  async reopenAfterRebootstrap(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
    baselineServerRevision: number,
    leaseTtlSeconds: number,
  ): Promise<PostgresReaderCursorSnapshot> {
    assertRevision(baselineServerRevision, "rebootstrap baseline revision");
    assertTtl(leaseTtlSeconds);
    if (cursor.status !== "retired" || cursor.resumeRequirement !== "rebootstrap_required") {
      throw new TypeError("reader cursor does not require rebootstrap");
    }
    assertIncrementable(cursor.generation, "reader cursor generation");
    assertIncrementable(cursor.rowVersion, "reader cursor row version");
    const result = await transaction.query<StoredReaderCursorRow>(
      `UPDATE workspace_reader_cursors
       SET cursor_generation = cursor_generation + 1,
           row_version = row_version + 1,
           read_through_server_revision = $4,
           lease_expires_at = transaction_timestamp() + ($5 * interval '1 second'),
           status = 'active', resume_requirement = 'none',
           retired_at = NULL, retirement_reason = NULL,
           pinned_page_target_server_revision = NULL, next_server_revision = NULL, continuation_token_digest = NULL
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3
         AND cursor_generation = $6 AND row_version = $7
         AND status = 'retired' AND resume_requirement = 'rebootstrap_required'
       RETURNING ${RETURNING_COLUMNS}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId,
        baselineServerRevision, leaseTtlSeconds, cursor.generation, cursor.rowVersion],
    );
    return parseUpdatedRow(result.rows[0], "reader cursor rebootstrap compare-and-set lost");
  }

  async renew(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
    leaseTtlSeconds: number,
  ): Promise<PostgresReaderCursorSnapshot | null> {
    assertTtl(leaseTtlSeconds);
    assertIncrementable(cursor.rowVersion, "reader cursor row version");
    const result = await transaction.query<StoredReaderCursorRow>(
      `UPDATE workspace_reader_cursors
       SET row_version = row_version + 1,
           lease_expires_at = transaction_timestamp() + ($4 * interval '1 second')
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3
         AND cursor_generation = $5 AND row_version = $6
         AND status = 'active' AND transaction_timestamp() < lease_expires_at
       RETURNING ${RETURNING_COLUMNS}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId,
        leaseTtlSeconds, cursor.generation, cursor.rowVersion],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseStoredRow(row);
  }

  async retireIfExpired(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
  ): Promise<PostgresReaderCursorSnapshot | null> {
    assertIncrementable(cursor.rowVersion, "reader cursor row version");
    const result = await transaction.query<StoredReaderCursorRow>(
      `UPDATE workspace_reader_cursors
       SET row_version = row_version + 1, status = 'retired',
           resume_requirement = 'rebootstrap_required', retired_at = transaction_timestamp(),
           retirement_reason = 'ttl_expired', pinned_page_target_server_revision = NULL,
           next_server_revision = NULL, continuation_token_digest = NULL
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3
         AND cursor_generation = $4 AND row_version = $5 AND status = 'active'
         AND transaction_timestamp() >= lease_expires_at
       RETURNING ${RETURNING_COLUMNS}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId,
        cursor.generation, cursor.rowVersion],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseStoredRow(row);
  }

  async advancePage(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
    returnedThroughServerRevision: number,
    pinnedPageTargetServerRevision: number | null,
    nextRevision: number | null,
    continuationTokenDigest: Uint8Array | null,
  ): Promise<PostgresReaderCursorSnapshot> {
    assertRevision(returnedThroughServerRevision, "returned through revision");
    assertIncrementable(cursor.rowVersion, "reader cursor row version");
    assertPageContinuation(pinnedPageTargetServerRevision, nextRevision, continuationTokenDigest, returnedThroughServerRevision);
    const result = await transaction.query<StoredReaderCursorRow>(
      `UPDATE workspace_reader_cursors
       SET row_version = row_version + 1,
           read_through_server_revision = $4,
           pinned_page_target_server_revision = $5,
           next_server_revision = $6,
           continuation_token_digest = $7
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3
         AND cursor_generation = $8 AND row_version = $9 AND status = 'active'
       RETURNING ${RETURNING_COLUMNS}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId,
        returnedThroughServerRevision, pinnedPageTargetServerRevision, nextRevision,
        continuationTokenDigest === null ? null : Buffer.from(continuationTokenDigest),
        cursor.generation, cursor.rowVersion],
    );
    return parseUpdatedRow(result.rows[0], "reader cursor page compare-and-set lost");
  }

  async retire(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
    reason: PostgresReaderCursorRetirementReason,
  ): Promise<PostgresReaderCursorSnapshot> {
    assertIncrementable(cursor.rowVersion, "reader cursor row version");
    const result = await transaction.query<StoredReaderCursorRow>(
      `UPDATE workspace_reader_cursors
       SET row_version = row_version + 1, status = 'retired',
           resume_requirement = CASE WHEN $4 = 'device_removed' THEN 'none' ELSE 'rebootstrap_required' END,
           retired_at = transaction_timestamp(), retirement_reason = $4,
           pinned_page_target_server_revision = NULL, next_server_revision = NULL, continuation_token_digest = NULL
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3
         AND cursor_generation = $5 AND row_version = $6 AND status = 'active'
       RETURNING ${RETURNING_COLUMNS}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId,
        reason, cursor.generation, cursor.rowVersion],
    );
    return parseUpdatedRow(result.rows[0], "reader cursor retirement compare-and-set lost");
  }

  async retireForDeviceRemoval(transaction: TenantTransaction, deviceIdValue: unknown): Promise<void> {
    const deviceId = parseDeviceId(deviceIdValue);
    await transaction.query(
      `UPDATE workspace_reader_cursors
       SET row_version = row_version + 1, status = 'retired', resume_requirement = 'none',
           retired_at = transaction_timestamp(), retirement_reason = 'device_removed',
           pinned_page_target_server_revision = NULL, next_server_revision = NULL, continuation_token_digest = NULL
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3 AND status = 'active'`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId],
    );
  }

  async retireExpiredAndReadMinimumActiveRevision(transaction: TenantTransaction): Promise<number | null> {
    await transaction.query(
      `SELECT device_id FROM workspace_reader_cursors
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'active'
       ORDER BY device_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    await transaction.query(
      `UPDATE workspace_reader_cursors
       SET row_version = row_version + 1, status = 'retired',
           resume_requirement = 'rebootstrap_required', retired_at = transaction_timestamp(),
           retirement_reason = 'ttl_expired', pinned_page_target_server_revision = NULL,
           next_server_revision = NULL, continuation_token_digest = NULL
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'active'
         AND transaction_timestamp() >= lease_expires_at`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const result = await transaction.query<{ minimum_revision: string | null }>(
      `SELECT min(read_through_server_revision)::text AS minimum_revision
       FROM workspace_reader_cursors
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'active'`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const value = result.rows[0]?.minimum_revision ?? null;
    return value === null ? null : parseRevision(value, "minimum active reader revision");
  }
}

const SELECT_COLUMNS = `SELECT device_id, cursor_generation, row_version, read_through_server_revision,
  to_char(lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS lease_expires_at,
  status, resume_requirement,
  to_char(retired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS retired_at,
  retirement_reason, pinned_page_target_server_revision, next_server_revision, continuation_token_digest`;
const RETURNING_COLUMNS = SELECT_COLUMNS.slice("SELECT ".length);

interface StoredReaderCursorRow {
  readonly device_id: string;
  readonly cursor_generation: string;
  readonly row_version: string;
  readonly read_through_server_revision: string;
  readonly lease_expires_at: string;
  readonly status: string;
  readonly resume_requirement: string;
  readonly retired_at: string | null;
  readonly retirement_reason: string | null;
  readonly pinned_page_target_server_revision: string | null;
  readonly next_server_revision: string | null;
  readonly continuation_token_digest: Buffer | null;
}

function parseStoredRow(row: StoredReaderCursorRow): PostgresReaderCursorSnapshot {
  const status = row.status;
  const resumeRequirement = row.resume_requirement;
  const retirementReason = row.retirement_reason;
  if (status !== "active" && status !== "retired") throw new TypeError("stored reader cursor status is malformed");
  if (resumeRequirement !== "none" && resumeRequirement !== "rebootstrap_required") {
    throw new TypeError("stored reader cursor resume requirement is malformed");
  }
  if (retirementReason !== null && retirementReason !== "ttl_expired" &&
      retirementReason !== "compaction_race" && retirementReason !== "device_removed") {
    throw new TypeError("stored reader cursor retirement reason is malformed");
  }
  const tokenDigest = row.continuation_token_digest;
  if (tokenDigest !== null && tokenDigest.byteLength !== 32) {
    throw new TypeError("stored reader cursor continuation digest is malformed");
  }
  return {
    deviceId: identifier.parse(row.device_id),
    generation: parsePositiveSafeInteger(row.cursor_generation, "stored reader cursor generation"),
    rowVersion: parsePositiveSafeInteger(row.row_version, "stored reader cursor row version"),
    readThroughServerRevision: parseRevision(row.read_through_server_revision, "stored last read revision"),
    leaseExpiresAt: canonicalUtcTimestamp.parse(row.lease_expires_at),
    status,
    resumeRequirement,
    retiredAt: canonicalUtcTimestamp.nullable().parse(row.retired_at),
    retirementReason,
    pinnedPageTargetServerRevision: row.pinned_page_target_server_revision === null ? null : parseRevision(row.pinned_page_target_server_revision, "stored page target"),
    nextRevision: row.next_server_revision === null ? null : parsePositiveSafeInteger(row.next_server_revision, "stored next revision"),
    continuationTokenDigest: tokenDigest === null ? null : new Uint8Array(tokenDigest),
  };
}

function parseRequiredRow(row: StoredReaderCursorRow | undefined): PostgresReaderCursorSnapshot {
  if (row === undefined) throw new TypeError("reader cursor write returned no row");
  return parseStoredRow(row);
}

function parseUpdatedRow(row: StoredReaderCursorRow | undefined, message: string): PostgresReaderCursorSnapshot {
  if (row === undefined) throw new TypeError(message);
  return parseStoredRow(row);
}

function parseDeviceId(value: unknown): string {
  return identifier.parse(value);
}

function parseRevision(value: string, label: string): number {
  const parsed = Number(value);
  assertRevision(parsed, label);
  return parsed;
}

function parsePositiveSafeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`${label} is malformed`);
  return parsed;
}

function assertRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is malformed`);
}

function assertIncrementable(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`${label} cannot advance`);
  }
}

function assertTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) {
    throw new TypeError("reader cursor TTL is malformed");
  }
}

function assertPageContinuation(
  target: number | null,
  next: number | null,
  digest: Uint8Array | null,
  returnedThrough: number,
): void {
  const absent = target === null && next === null && digest === null;
  if (absent) return;
  if (target === null || next === null || digest === null || digest.byteLength !== 32) {
    throw new TypeError("reader cursor page continuation is malformed");
  }
  assertRevision(target, "page target revision");
  assertRevision(next, "next page revision");
  if (next !== returnedThrough + 1 || next > target) {
    throw new TypeError("reader cursor page continuation is not contiguous");
  }
}
