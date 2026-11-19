import { randomUUID } from "node:crypto";
import { deviceSwitchRequestViewSchema, type DeviceSwitchRequestView } from "@gooddealer/protocol/devices";
import type { AccountTransaction, TenantTransaction } from "../../db/index";
import { canonicalSecond } from "./desktop-authorization-readers";

export interface ForcedWorkflowRow {
  workflow_id: string; mode: "normal" | "forced"; status: string; workflow_revision: string;
  from_device_id: string | null; to_device_id: string; created_at: Date; earliest_takeover_at: Date | null;
  state_deadline: Date; source_lease_epoch: string | null; pending_lease_epoch: string | null;
  bound_key_id: string; bound_key_version: string; bound_account_security_epoch: string;
  idempotency_key: string; request_digest: Buffer;
}
export function forcedInteger(value: string | null): number {
  if (value === null || !/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new TypeError("invalid forced authority integer");
  return Number(value);
}
export function forcedView(row: ForcedWorkflowRow): DeviceSwitchRequestView {
  return deviceSwitchRequestViewSchema.parse({ schemaVersion: 2, requestId: row.workflow_id, mode: row.mode,
    status: row.status, fromDeviceId: row.from_device_id, toDeviceId: row.to_device_id,
    requestedAt: canonicalSecond(row.created_at), earliestTakeoverAt: row.earliest_takeover_at === null ? null : canonicalSecond(row.earliest_takeover_at),
    bootstrapExpiresAt: row.status === "bootstrapping" ? canonicalSecond(row.state_deadline) : null, normalHandoffReceipt: null });
}
/** Caller already holds account security/account writer locks, before workflow and Lease locks. */
export async function expireForcedWaitingLocked(transaction: Pick<AccountTransaction, "query">, accountId: string): Promise<void> {
  await transaction.query(`UPDATE device_switch_workflows SET status='failed',workflow_revision=workflow_revision+1,updated_at=clock_timestamp()
    WHERE account_id=$1 AND mode='forced' AND status='waiting_expiry' AND state_deadline<=clock_timestamp()`, [accountId]);
}
export async function forcedRenewalAllowedLocked(transaction: AccountTransaction, sourceEpoch: number): Promise<boolean> {
  const waiting = await transaction.query<{ allowed: boolean }>(`SELECT clock_timestamp()<earliest_takeover_at AS allowed
    FROM device_switch_workflows WHERE account_id=$1 AND mode='forced' AND status='waiting_expiry'
    AND source_lease_epoch=$2 FOR UPDATE`, [transaction.accountId, sourceEpoch]);
  return waiting.rows.length === 0 || waiting.rows[0]?.allowed === true;
}
export async function advanceForcedWaitingLocked(transaction: AccountTransaction, sourceEpoch: number): Promise<void> {
  await transaction.query(`UPDATE device_switch_workflows w SET
    earliest_takeover_at=date_trunc('second',greatest(w.earliest_takeover_at,l.max_issued_offline_execute_until,s.exclusive_execution_block_until)+interval '0.999999 seconds'),
    state_deadline=date_trunc('second',greatest(w.earliest_takeover_at,l.max_issued_offline_execute_until,s.exclusive_execution_block_until)+interval '0.999999 seconds')+interval '24 hours',
    workflow_revision=w.workflow_revision+1,updated_at=clock_timestamp()
    FROM device_active_leases l,device_account_states s WHERE w.account_id=$1 AND w.mode='forced'
      AND w.status='waiting_expiry' AND w.source_lease_epoch=$2 AND l.account_id=w.account_id AND l.lease_epoch=$2
      AND s.account_id=w.account_id AND clock_timestamp()<w.earliest_takeover_at
      AND greatest(l.max_issued_offline_execute_until,s.exclusive_execution_block_until)>w.earliest_takeover_at`, [transaction.accountId, sourceEpoch]);
}
export async function forcedClaimableLocked(transaction: TenantTransaction, row: ForcedWorkflowRow, evaluatedAt: Date | null = null): Promise<boolean> {
  if (row.mode !== "forced" || row.status !== "waiting_expiry" || row.source_lease_epoch === null) return false;
  const result = await transaction.query<{ allowed: boolean }>(`WITH evaluation AS MATERIALIZED (SELECT coalesce($4::timestamptz,clock_timestamp()) AS at) SELECT (
    evaluation.at>=w.earliest_takeover_at AND evaluation.at<w.state_deadline
    AND s.current_lease_epoch=w.source_lease_epoch AND s.highest_allocated_lease_epoch=s.current_lease_epoch
    AND l.device_id=w.from_device_id AND l.released_at IS NULL
    AND l.max_issued_offline_execute_until<=evaluation.at
    AND (s.exclusive_execution_block_until IS NULL OR s.exclusive_execution_block_until<=evaluation.at)
    AND w.bound_account_security_epoch=security.account_security_epoch AND security.status='normal'
    AND b.status='bound' AND k.status='active' AND k.key_id=w.bound_key_id AND k.key_version=w.bound_key_version
    AND NOT EXISTS(SELECT 1 FROM device_lease_epoch_allocations a WHERE a.account_id=w.account_id AND a.status='pending')
    ) AS allowed FROM device_switch_workflows w CROSS JOIN evaluation JOIN device_account_states s USING(account_id)
    JOIN identity_account_security_states security USING(account_id)
    JOIN device_active_leases l ON l.account_id=w.account_id AND l.lease_epoch=w.source_lease_epoch
    JOIN device_bindings b ON b.account_id=w.account_id AND b.device_id=w.to_device_id
    JOIN device_signing_keys k ON k.account_id=b.account_id AND k.device_id=b.device_id AND k.status='active'
    WHERE w.account_id=$1 AND w.workspace_id=$2 AND w.workflow_id=$3 FOR UPDATE OF w,l`,
    [transaction.scope.accountId,transaction.scope.workspaceId,row.workflow_id,evaluatedAt]);
  return result.rows.length === 1 && result.rows[0]?.allowed === true;
}
/** No response escapes until the caller signs, verifies and persists the original claim in this transaction. */
export async function beginForcedBootstrapLocked(transaction: TenantTransaction, row: ForcedWorkflowRow): Promise<Date | null> {
  if (!await forcedClaimableLocked(transaction,row)) return null;
  const deadline = row.state_deadline;
  const released = await transaction.query(`UPDATE device_active_leases SET released_at=clock_timestamp(),release_reason='forced_takeover'
    WHERE account_id=$1 AND lease_epoch=$2 AND device_id=$3 AND released_at IS NULL`,
    [transaction.scope.accountId,row.source_lease_epoch,row.from_device_id]);
  if (released.rowCount !== 1) throw new TypeError("forced source disappeared under writer lock");
  const allocation = await transaction.query<{ epoch: string }>(`UPDATE device_account_states
    SET highest_allocated_lease_epoch=highest_allocated_lease_epoch+1,updated_at=clock_timestamp()
    WHERE account_id=$1 AND highest_allocated_lease_epoch<9007199254740991 RETURNING highest_allocated_lease_epoch AS epoch`,[transaction.scope.accountId]);
  const epoch = forcedInteger(allocation.rows[0]?.epoch ?? null);
  await transaction.query(`INSERT INTO device_lease_epoch_allocations(account_id,workspace_id,workflow_id,lease_epoch,status)
    VALUES($1,$2,$3,$4,'pending')`,[transaction.scope.accountId,transaction.scope.workspaceId,row.workflow_id,epoch]);
  await transaction.query(`INSERT INTO device_bootstrap_capabilities(account_id,workspace_id,workflow_id,jti,target_device_id,issued_at,expires_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    [transaction.scope.accountId,transaction.scope.workspaceId,row.workflow_id,`bootstrap-${randomUUID()}`,row.to_device_id]);
  const updated=await transaction.query<ForcedWorkflowRow>(`UPDATE device_switch_workflows w
    SET status='bootstrapping',pending_lease_epoch=$4,workflow_revision=workflow_revision+1,
      state_deadline=c.expires_at,updated_at=clock_timestamp() FROM device_bootstrap_capabilities c
    WHERE w.account_id=$1 AND w.workspace_id=$2 AND w.workflow_id=$3 AND c.account_id=w.account_id
      AND c.workspace_id=w.workspace_id AND c.workflow_id=w.workflow_id RETURNING w.*`,
    [transaction.scope.accountId,transaction.scope.workspaceId,row.workflow_id,epoch]);
  if (updated.rows[0] === undefined) throw new TypeError("forced bootstrap transition missing");
  Object.assign(row,updated.rows[0]);
  return deadline;
}
