import type { TenantTransaction } from "../../../db/index";

/** Cursor writes remain workspace-owned and are deliberately absent from the Drain transaction. */
export class PostgresDeviceCursorRepository {
  readonly #lockedDomains = new WeakSet<TenantTransaction>();

  async activate(transaction: TenantTransaction, deviceId: string, atRevision: number): Promise<void> {
    const existing = await transaction.query<{ acknowledged_through_server_revision: string; status: "active" | "retired" }>(
      `SELECT acknowledged_through_server_revision, status FROM workspace_device_cursors
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3
       ORDER BY cursor_generation DESC FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId],
    );
    const current = existing.rows.find(({ status }) => status === "active");
    if (current === undefined) {
      if (existing.rows.length !== 0) throw new TypeError("retired cursor cannot be reactivated");
      await transaction.query(
        `INSERT INTO workspace_device_cursors
           (account_id, workspace_id, device_id, cursor_generation, acknowledged_through_server_revision, status)
         VALUES ($1, $2, $3, 1, $4, 'active')`,
        [transaction.scope.accountId, transaction.scope.workspaceId, deviceId, atRevision],
      );
      return;
    }
    if (parseRevision(current.acknowledged_through_server_revision) > atRevision) {
      throw new TypeError("active cursor cannot move backwards");
    }
    const result = await transaction.query(
      `UPDATE workspace_device_cursors SET acknowledged_through_server_revision = $4
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3 AND status = 'active'`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId, atRevision],
    );
    if (result.rowCount !== 1) throw new TypeError("active cursor update lost its lock");
  }

  async retire(
    transaction: TenantTransaction,
    deviceId: string,
    reason: "replaced" | "device_removed" | "workspace_left",
  ): Promise<void> {
    const result = await transaction.query(
      `UPDATE workspace_device_cursors SET status = 'retired', retirement_reason = $4,
         retired_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3 AND status = 'active'`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId, reason],
    );
    if (result.rowCount !== 1) throw new TypeError("cursor is absent or already retired");
  }

  async readMinimumActiveRevision(transaction: TenantTransaction): Promise<number | null> {
    const result = await transaction.query<{ acknowledged_through_server_revision: string }>(
      `SELECT acknowledged_through_server_revision FROM workspace_device_cursors
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'active'
       ORDER BY device_id COLLATE "C" FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    if (result.rows.length === 0) return null;
    const revisions = result.rows.map(({ acknowledged_through_server_revision }) => parseRevision(acknowledged_through_server_revision));
    return Math.min(...revisions);
  }

  /** Activation-only domain lock; future generations may be created only through this handle. */
  async lockDomain(transaction: TenantTransaction): Promise<void> {
    await transaction.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, hashtextextended($2, 0)))`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    await transaction.query(
      `SELECT device_id, cursor_generation FROM workspace_device_cursors
       WHERE account_id = $1 AND workspace_id = $2
       ORDER BY device_id COLLATE "C", cursor_generation FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    this.#lockedDomains.add(transaction);
  }

  async retireCurrent(transaction: TenantTransaction, reason: "replaced"): Promise<void> {
    this.#assertDomainLock(transaction);
    await transaction.query(
      `UPDATE workspace_device_cursors
       SET status = 'retired', retirement_reason = $3, retired_at = transaction_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND status = 'active'`,
      [transaction.scope.accountId, transaction.scope.workspaceId, reason],
    );
  }

  async insertNextGeneration(
    transaction: TenantTransaction,
    deviceId: string,
    atRevision: number,
  ): Promise<number> {
    this.#assertDomainLock(transaction);
    const generation = await transaction.query<{ next_generation: string }>(
      `SELECT COALESCE(MAX(cursor_generation), 0) + 1 AS next_generation
       FROM workspace_device_cursors
       WHERE account_id = $1 AND workspace_id = $2 AND device_id = $3`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId],
    );
    const next = parseRevision(generation.rows[0]?.next_generation ?? "0");
    if (next < 1) throw new TypeError("cursor generation overflow");
    await transaction.query(
      `INSERT INTO workspace_device_cursors
         (account_id, workspace_id, device_id, cursor_generation, acknowledged_through_server_revision, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [transaction.scope.accountId, transaction.scope.workspaceId, deviceId, next, atRevision],
    );
    return next;
  }

  #assertDomainLock(transaction: TenantTransaction): void {
    if (!this.#lockedDomains.has(transaction)) throw new TypeError("device cursor domain is not locked");
  }
}

function parseRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("stored device cursor revision is malformed");
  }
  return revision;
}
