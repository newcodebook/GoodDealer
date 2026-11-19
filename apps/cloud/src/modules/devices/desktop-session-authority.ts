import { identifier } from "@gooddealer/protocol/wire";
import type { AccountTransaction } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";

export interface DesktopSessionAuthority {
  readonly deviceId: string;
  readonly role: "active" | "standby";
  readonly accountSecurityEpoch: number;
  readonly leaseEpochFloor: number;
}

/** All readers share the same locked eligibility and role derivation; a request never chooses its role. */
export async function readDesktopSessionAuthority(
  transaction: AccountTransaction, principal: PublicPrincipal, workspaceId: string,
): Promise<DesktopSessionAuthority | null> {
  if (principal.clientKind !== "desktop" || principal.accountId !== transaction.accountId
    || !identifier.safeParse(workspaceId).success) return null;
  const security = await transaction.query<{ account_security_epoch: string; status: string }>(
    "SELECT account_security_epoch, status FROM identity_account_security_states WHERE account_id = $1 FOR SHARE",
    [principal.accountId]);
  const epoch = unsigned(security.rows[0]?.account_security_epoch);
  if (security.rows.length !== 1 || security.rows[0]?.status !== "normal" || epoch === null || epoch < 1) return null;
  const session = await transaction.query<{ device_id: string }>(
    `SELECT s.device_id FROM identity_auth_sessions s JOIN identity_refresh_families f
       ON f.account_id = s.account_id AND f.session_id = s.session_id
     WHERE s.account_id = $1 AND s.session_id = $2 AND s.client_kind = 'desktop'
       AND s.revoked_at IS NULL AND s.epoch_at_issue = $3 AND f.state = 'active'
       AND (s.expires_at IS NULL OR clock_timestamp() < s.expires_at) FOR SHARE OF s, f`,
    [principal.accountId, principal.sessionId, epoch]);
  const deviceId = session.rows[0]?.device_id;
  if (session.rows.length !== 1 || !identifier.safeParse(deviceId).success || deviceId === undefined) return null;
  const workspace = await transaction.query(
    `SELECT 1 FROM workspace_account_bindings WHERE account_id = $1 AND workspace_id = $2
       AND owner_kind = 'account' AND role = 'default_owner' AND is_default = true`,
    [principal.accountId, workspaceId]);
  if (workspace.rows.length !== 1) return null;
  // The default binding was server-derived; install and lock that exact tenant before reading workflows.
  await transaction.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [workspaceId]);
  const lockedWorkspace = await transaction.query(
    `SELECT 1 FROM workspace_account_bindings WHERE account_id = $1 AND workspace_id = $2
       AND owner_kind = 'account' AND role = 'default_owner' AND is_default = true FOR SHARE`,
    [principal.accountId, workspaceId]);
  if (lockedWorkspace.rows.length !== 1) return null;
  const state = await transaction.query<{ highest_allocated_lease_epoch: string; current_lease_epoch: string }>(
    `SELECT highest_allocated_lease_epoch, current_lease_epoch FROM device_account_states
     WHERE account_id = $1 FOR SHARE`, [principal.accountId]);
  let floor = unsigned(state.rows[0]?.highest_allocated_lease_epoch);
  const current = unsigned(state.rows[0]?.current_lease_epoch);
  if (state.rows.length !== 1 || floor === null || current === null || current > floor) return null;
  const binding = await transaction.query(
    `SELECT 1 FROM device_bindings b JOIN device_signing_keys k
       ON k.account_id = b.account_id AND k.device_id = b.device_id AND k.status = 'active'
     WHERE b.account_id = $1 AND b.device_id = $2 AND b.status = 'bound' FOR SHARE OF b, k`,
    [principal.accountId, deviceId]);
  if (binding.rows.length !== 1) return null;
  const lease = await transaction.query<{ device_id: string; lease_epoch: string; live: boolean; allocation_valid: boolean }>(
    `SELECT l.device_id, l.lease_epoch,
       clock_timestamp() >= l.issued_at AND clock_timestamp() < l.online_expires_at AS live,
       a.status = 'activated' AND (a.workspace_id = $2 OR a.allocation_source = 'desktop_login') AS allocation_valid
     FROM device_active_leases l JOIN device_lease_epoch_allocations a USING (account_id, lease_epoch)
     WHERE l.account_id = $1 AND l.released_at IS NULL FOR SHARE OF l, a`,
    [principal.accountId, workspaceId]);
  if (lease.rows.length > 1) return null;
  const held = lease.rows[0];
  // A holder with an expired/stale Lease must refresh; it cannot reinterpret its own Lease as Standby.
  if (held?.device_id === deviceId) {
    if (!held.live || !held.allocation_valid || unsigned(held.lease_epoch) !== current) return null;
    return { deviceId, role: "active", accountSecurityEpoch: epoch, leaseEpochFloor: floor };
  }
  const pending = await transaction.query<{ lease_epoch: string; workspace_id: string; workflow_id: string }>(
    `SELECT lease_epoch, workspace_id, workflow_id FROM device_lease_epoch_allocations
     WHERE account_id = $1 AND status = 'pending' FOR SHARE`, [principal.accountId]);
  if (pending.rows.length > 1) return null;
  const allocation = pending.rows[0];
  if (allocation !== undefined) {
    if (allocation.workspace_id !== workspaceId || unsigned(allocation.lease_epoch) !== floor || floor <= current) return null;
    const target = await transaction.query<{ to_device_id: string }>(
      `SELECT w.to_device_id FROM device_switch_workflows w
       JOIN device_bootstrap_capabilities c USING (account_id, workspace_id, workflow_id)
       JOIN device_bindings b ON b.account_id = w.account_id AND b.device_id = w.to_device_id
       JOIN device_signing_keys k ON k.account_id = w.account_id AND k.device_id = w.to_device_id
         AND k.key_id = w.bound_key_id AND k.key_version = w.bound_key_version
       WHERE w.account_id = $1 AND w.workspace_id = $2 AND w.workflow_id = $3
         AND w.status = 'bootstrapping' AND w.pending_lease_epoch = $4
         AND w.bound_account_security_epoch = $5 AND b.status = 'bound' AND k.status = 'active'
         AND c.target_device_id = w.to_device_id AND c.consumed_at IS NULL
         AND clock_timestamp() >= c.issued_at AND clock_timestamp() < c.expires_at
         AND clock_timestamp() < w.state_deadline FOR SHARE OF w, c, b, k`,
      [principal.accountId, workspaceId, allocation.workflow_id, floor, epoch]);
    if (target.rows.length !== 1) return null;
    // Only the exact reserved target may later activate this pending epoch. Other devices burn it as a floor.
    if (target.rows[0]?.to_device_id === deviceId) floor -= 1;
  }
  return { deviceId, role: "standby", accountSecurityEpoch: epoch, leaseEpochFloor: floor };
}
function unsigned(value: string | undefined): number | null {
  if (value === undefined || !/^(0|[1-9]\d*)$/u.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
