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

export interface PostgresPendingDeliverySnapshot {
  readonly generation: number;
  readonly fromServerRevisionExclusive: number;
  readonly throughServerRevisionInclusive: number;
  readonly targetServerRevision: number;
  readonly pageLimit: number;
  readonly pageDigest: Uint8Array;
  readonly nextCursorDigest: Uint8Array | null;
  readonly predecessorConfirmationDigest: Uint8Array | null;
  readonly confirmationTokenDigest: Uint8Array;
  readonly expiresAt: string;
  readonly expired: boolean;
}

export interface NewPostgresPendingDelivery {
  readonly fromServerRevisionExclusive: number;
  readonly throughServerRevisionInclusive: number;
  readonly targetServerRevision: number;
  readonly pageLimit: number;
  readonly pageDigest: Uint8Array;
  readonly nextCursorDigest: Uint8Array | null;
  readonly predecessorConfirmationDigest: Uint8Array | null;
  readonly confirmationTokenDigest: Uint8Array;
  readonly expiresAt: string;
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

  async readDeliveryExpiry(transaction: TenantTransaction, ttlSeconds: number): Promise<string> {
    assertTtl(ttlSeconds);
    const result = await transaction.query<{ expires_at: string }>(
      `SELECT to_char(
         (transaction_timestamp() + ($1 * interval '1 second')) AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS expires_at`,
      [ttlSeconds],
    );
    return canonicalUtcTimestamp.parse(result.rows[0]?.expires_at);
  }

  async lockPendingDelivery(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
  ): Promise<PostgresPendingDeliverySnapshot | null> {
    const result = await transaction.query<StoredPendingDeliveryRow>(
      `SELECT cursor_generation, from_server_revision_exclusive,
              through_server_revision_inclusive, target_server_revision, page_limit,
              page_digest, next_cursor_digest, predecessor_confirmation_digest,
              confirmation_token_digest,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at,
              transaction_timestamp() >= expires_at AS expired
       FROM workspace_reader_pending_deliveries
       WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3
       FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const pending = parsePendingDelivery(row);
    if (pending.generation !== cursor.generation) {
      throw new TypeError("pending delivery generation does not match its reader cursor");
    }
    return pending;
  }

  async insertPendingDelivery(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
    value: NewPostgresPendingDelivery,
  ): Promise<PostgresPendingDeliverySnapshot> {
    assertPendingDelivery(value, cursor);
    const result = await transaction.query<StoredPendingDeliveryRow>(
      `INSERT INTO workspace_reader_pending_deliveries (
         account_id, workspace_id, device_id, cursor_generation,
         from_server_revision_exclusive, through_server_revision_inclusive,
         target_server_revision, page_limit, page_digest, next_cursor_digest,
         predecessor_confirmation_digest, confirmation_token_digest, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)
       RETURNING cursor_generation, from_server_revision_exclusive,
         through_server_revision_inclusive, target_server_revision, page_limit,
         page_digest, next_cursor_digest, predecessor_confirmation_digest,
         confirmation_token_digest,
         to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at,
         transaction_timestamp() >= expires_at AS expired`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId, cursor.generation,
        value.fromServerRevisionExclusive, value.throughServerRevisionInclusive,
        value.targetServerRevision, value.pageLimit, Buffer.from(value.pageDigest),
        nullableBuffer(value.nextCursorDigest), nullableBuffer(value.predecessorConfirmationDigest),
        Buffer.from(value.confirmationTokenDigest), value.expiresAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("pending delivery insert returned no row");
    return parsePendingDelivery(row);
  }

  async confirmPendingDelivery(
    transaction: TenantTransaction,
    cursor: PostgresReaderCursorSnapshot,
    pending: PostgresPendingDeliverySnapshot,
    confirmationTokenDigest: Uint8Array,
    leaseTtlSeconds: number,
  ): Promise<PostgresReaderCursorSnapshot> {
    assertDigest(confirmationTokenDigest, "confirmation token digest");
    assertTtl(leaseTtlSeconds);
    if (pending.generation !== cursor.generation || pending.fromServerRevisionExclusive !== cursor.readThroughServerRevision) {
      throw new TypeError("pending delivery cannot advance this reader cursor");
    }
    const deleted = await transaction.query(
      `DELETE FROM workspace_reader_pending_deliveries
       WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3
         AND cursor_generation=$4 AND confirmation_token_digest=$5
         AND transaction_timestamp() < expires_at`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId,
        cursor.generation, Buffer.from(confirmationTokenDigest)],
    );
    if (deleted.rowCount !== 1) throw new TypeError("pending delivery confirmation compare-and-set lost");
    const continuation = pending.nextCursorDigest;
    const result = await transaction.query<StoredReaderCursorRow>(
      `UPDATE workspace_reader_cursors
       SET row_version=row_version+1,
           read_through_server_revision=$4,
           lease_expires_at=transaction_timestamp() + ($5 * interval '1 second'),
           pinned_page_target_server_revision=$6,
           next_server_revision=$7,
           continuation_token_digest=$8
       WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3
         AND cursor_generation=$9 AND row_version=$10 AND status='active'
         AND read_through_server_revision=$11
       RETURNING ${RETURNING_COLUMNS}`,
      [transaction.scope.accountId, transaction.scope.workspaceId, cursor.deviceId,
        pending.throughServerRevisionInclusive, leaseTtlSeconds,
        continuation === null ? null : pending.targetServerRevision,
        continuation === null ? null : pending.throughServerRevisionInclusive + 1,
        nullableBuffer(continuation), cursor.generation, cursor.rowVersion,
        pending.fromServerRevisionExclusive],
    );
    return parseUpdatedRow(result.rows[0], "reader cursor confirmation compare-and-set lost");
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

interface StoredPendingDeliveryRow {
  readonly cursor_generation: string;
  readonly from_server_revision_exclusive: string;
  readonly through_server_revision_inclusive: string;
  readonly target_server_revision: string;
  readonly page_limit: number;
  readonly page_digest: Buffer;
  readonly next_cursor_digest: Buffer | null;
  readonly predecessor_confirmation_digest: Buffer | null;
  readonly confirmation_token_digest: Buffer;
  readonly expires_at: string;
  readonly expired: boolean;
}

function parsePendingDelivery(row: StoredPendingDeliveryRow): PostgresPendingDeliverySnapshot {
  const pageDigest = parseBinaryDigest(row.page_digest, "stored pending page digest");
  const nextCursorDigest = row.next_cursor_digest === null ? null : parseBinaryDigest(row.next_cursor_digest, "stored pending cursor digest");
  const predecessor = row.predecessor_confirmation_digest === null
    ? null : parseBinaryDigest(row.predecessor_confirmation_digest, "stored predecessor confirmation digest");
  const confirmation = parseBinaryDigest(row.confirmation_token_digest, "stored confirmation token digest");
  return {
    generation: parsePositiveSafeInteger(row.cursor_generation, "pending delivery generation"),
    fromServerRevisionExclusive: parseRevision(row.from_server_revision_exclusive, "pending delivery from revision"),
    throughServerRevisionInclusive: parseRevision(row.through_server_revision_inclusive, "pending delivery through revision"),
    targetServerRevision: parseRevision(row.target_server_revision, "pending delivery target revision"),
    pageLimit: row.page_limit,
    pageDigest, nextCursorDigest, predecessorConfirmationDigest: predecessor,
    confirmationTokenDigest: confirmation,
    expiresAt: canonicalUtcTimestamp.parse(row.expires_at),
    expired: row.expired === true,
  };
}

function assertPendingDelivery(value: NewPostgresPendingDelivery, cursor: PostgresReaderCursorSnapshot): void {
  assertRevision(value.fromServerRevisionExclusive, "pending delivery from revision");
  assertRevision(value.throughServerRevisionInclusive, "pending delivery through revision");
  assertRevision(value.targetServerRevision, "pending delivery target revision");
  if (!Number.isSafeInteger(value.pageLimit) || value.pageLimit < 1 || value.pageLimit > 256) {
    throw new TypeError("pending delivery page limit is malformed");
  }
  if (value.fromServerRevisionExclusive > value.throughServerRevisionInclusive ||
      value.throughServerRevisionInclusive > value.targetServerRevision ||
      value.fromServerRevisionExclusive !== cursor.readThroughServerRevision) {
    throw new TypeError("pending delivery revision bounds are invalid");
  }
  assertDigest(value.pageDigest, "pending page digest");
  assertDigest(value.confirmationTokenDigest, "confirmation token digest");
  if (value.nextCursorDigest !== null) assertDigest(value.nextCursorDigest, "pending cursor digest");
  if (value.predecessorConfirmationDigest !== null) assertDigest(value.predecessorConfirmationDigest, "predecessor confirmation digest");
  canonicalUtcTimestamp.parse(value.expiresAt);
}

function nullableBuffer(value: Uint8Array | null): Buffer | null {
  return value === null ? null : Buffer.from(value);
}

function assertDigest(value: Uint8Array, label: string): void {
  if (value.byteLength !== 32) throw new TypeError(`${label} is malformed`);
}

function parseBinaryDigest(value: Buffer, label: string): Uint8Array {
  assertDigest(value, label);
  return new Uint8Array(value);
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
