import type { TenantTransaction } from "../../db/index";
import type { BootstrapCheckpointPort } from "./bootstrap-persistence-ports";

/** Caller holds account security/state before workflow. Every terminal effect shares its transaction. */
export async function terminateDeviceBootstrap(
  transaction: TenantTransaction,
  checkpoints: Pick<BootstrapCheckpointPort, "release">,
  requestId: string,
  reason: "expired" | "cancelled",
): Promise<boolean> {
  const { scope } = transaction;
  const workflow = await transaction.query<{
    workflow_id: string;
    pending_lease_epoch: string;
    to_device_id: string;
  }>(
    `SELECT workflow_id, pending_lease_epoch, to_device_id FROM device_switch_workflows
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND status = 'bootstrapping' FOR UPDATE`,
    [scope.accountId, scope.workspaceId, requestId],
  );
  if (workflow.rows.length === 0) return false;
  if (workflow.rows.length !== 1) corrupt();
  const row = workflow.rows[0]!;
  const selectors = [scope.accountId, scope.workspaceId, row.workflow_id];
  const allocation = await transaction.query<{ status: string }>(
    `SELECT status FROM device_lease_epoch_allocations
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND lease_epoch = $4 FOR UPDATE`,
    [...selectors, row.pending_lease_epoch],
  );
  const capability = await transaction.query<{
    jti: string;
    target_device_id: string;
    consumed_at: Date | null;
    expired: boolean;
  }>(
    `SELECT c.jti, c.target_device_id, c.consumed_at,
          clock_timestamp() >= LEAST(c.expires_at, w.state_deadline) AS expired
       FROM device_bootstrap_capabilities c JOIN device_switch_workflows w
         USING (account_id, workspace_id, workflow_id)
       WHERE c.account_id = $1 AND c.workspace_id = $2 AND c.workflow_id = $3 FOR UPDATE OF c`,
    selectors,
  );
  const cap = capability.rows[0];
  // Missing records are not an invitation to erase the reservation and grant a new Lease.
  if (
    allocation.rows.length !== 1 ||
    allocation.rows[0]?.status !== "pending" ||
    capability.rows.length !== 1 ||
    cap === undefined ||
    cap.consumed_at !== null ||
    cap.target_device_id !== row.to_device_id
  )
    return false;
  const epoch = await transaction.query<{ consistent: boolean }>(
    `SELECT current_lease_epoch < $2 AND highest_allocated_lease_epoch = $2
         AND NOT EXISTS (SELECT 1 FROM device_active_leases WHERE account_id = $1 AND lease_epoch = $2)
         AS consistent FROM device_account_states WHERE account_id = $1`,
    [scope.accountId, row.pending_lease_epoch],
  );
  if (epoch.rows.length !== 1 || epoch.rows[0]?.consistent !== true) return false;
  if (reason === "expired" && !cap.expired) return true;
  const authority = await transaction.query<{
    capability_jti: string;
    pending_lease_epoch: string;
    target_device_id: string;
    pinned_checkpoint_id: string | null;
  }>(
    `SELECT capability_jti, pending_lease_epoch, target_device_id, pinned_checkpoint_id
       FROM device_bootstrap_authorities
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 FOR UPDATE`,
    selectors,
  );
  if (authority.rows.length > 1) corrupt();
  const auth = authority.rows[0];
  // Drain has not yet created this row; later bootstrap steps have. Both are valid stages.
  if (
    auth !== undefined &&
    (auth.capability_jti !== cap.jti ||
      auth.pending_lease_epoch !== row.pending_lease_epoch ||
      auth.target_device_id !== row.to_device_id)
  )
    return false;
  const burned = await transaction.query(
    `UPDATE device_lease_epoch_allocations SET status = 'burned', terminal_at = clock_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3
         AND lease_epoch = $4 AND status = 'pending'`,
    [...selectors, row.pending_lease_epoch],
  );
  if (burned.rowCount !== 1) corrupt();
  const consumed = await transaction.query(
    `UPDATE device_bootstrap_capabilities SET consumed_at = clock_timestamp(), consumed_reason = $4
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND consumed_at IS NULL`,
    [...selectors, reason],
  );
  if (consumed.rowCount !== 1) corrupt();
  await transaction.query(
    `UPDATE device_bootstrap_step_nonces SET state = 'consumed', consumed_at = clock_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND state = 'active'`,
    selectors,
  );
  await transaction.query(
    `UPDATE device_bootstrap_authorities SET next_step_kind = NULL, next_nonce_digest = NULL,
         row_version = row_version + 1, updated_at = clock_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3`,
    selectors,
  );
  if (auth?.pinned_checkpoint_id !== undefined && auth.pinned_checkpoint_id !== null) {
    await checkpoints.release(transaction, row.workflow_id, auth.pinned_checkpoint_id);
  }
  const terminated = await transaction.query(
    `UPDATE device_switch_workflows SET status = $4, pending_lease_epoch = NULL,
         workflow_revision = workflow_revision + 1, updated_at = clock_timestamp()
       WHERE account_id = $1 AND workspace_id = $2 AND workflow_id = $3 AND status = 'bootstrapping'`,
    [...selectors, reason === "expired" ? "failed" : "cancelled"],
  );
  if (terminated.rowCount !== 1) corrupt();
  return true;
}
function corrupt(): never {
  throw new TypeError("bootstrap termination authority is inconsistent");
}
