import type { TenantTransaction } from "../../db/index";
import type { TransactionalMutationAuthorityPort } from "./ports";

/**
 * Acquires only the device-owned prefix of the sync lock order. A successful verdict remains
 * valid only for the caller's current transaction; no Lease row or repository escapes the port.
 */
export class PostgresMutationAuthority implements TransactionalMutationAuthorityPort {
  async lockAndValidateActiveLease(transaction: TenantTransaction, input: {
    readonly sourceDeviceId: string;
    readonly activeLeaseEpoch: number;
  }): Promise<boolean> {
    if (!isIdentifier(input.sourceDeviceId) || !isPositiveSafeInteger(input.activeLeaseEpoch)) return false;

    const account = await transaction.query(
      `SELECT 1 FROM device_account_states WHERE account_id = $1 FOR UPDATE`,
      [transaction.scope.accountId],
    );
    if (account.rowCount !== 1) return false;

    const binding = await transaction.query<{ status: "bound" | "removed" }>(
      `SELECT status FROM device_bindings
       WHERE account_id = $1 AND device_id = $2 FOR UPDATE`,
      [transaction.scope.accountId, input.sourceDeviceId],
    );
    if (binding.rows[0]?.status !== "bound") return false;

    // Current lease establishes transport authority; the submitted epoch is only immutable
    // provenance and may be an offline-valid historical lease after natural rotation.
    const lease = await transaction.query<{ device_id: string }>(
      `SELECT lease.device_id, lease.lease_epoch
       FROM device_active_leases lease
       JOIN device_lease_epoch_allocations allocation
         ON allocation.account_id = lease.account_id AND allocation.lease_epoch = lease.lease_epoch
       WHERE lease.account_id = $1 AND allocation.workspace_id = $2
         AND lease.released_at IS NULL
         AND lease.offline_execute_until > transaction_timestamp()
         AND allocation.status = 'activated'
       FOR UPDATE OF lease`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const held = lease.rows[0];
    if (held === undefined || held.device_id !== input.sourceDeviceId) return false;
    const historical = await transaction.query(
      `SELECT 1
       FROM device_active_leases lease
       JOIN device_lease_epoch_allocations allocation
         ON allocation.account_id = lease.account_id AND allocation.lease_epoch = lease.lease_epoch
       WHERE lease.account_id = $1 AND lease.device_id = $2 AND lease.lease_epoch = $3
         AND allocation.workspace_id = $4
         AND allocation.status = 'activated'
       FOR UPDATE OF lease`,
      [transaction.scope.accountId, input.sourceDeviceId, input.activeLeaseEpoch, transaction.scope.workspaceId],
    );
    return historical.rowCount === 1;
  }
}

function isIdentifier(value: string): boolean {
  return value.length >= 1 && value.length <= 160 && /^[!-~]+$/u.test(value);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}
