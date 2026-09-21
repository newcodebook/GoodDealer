import { identifier } from "@gooddealer/protocol/wire";

import type { AccountTransactionRunner } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";

export interface DesktopSyncAuthorityPort {
  resolveActiveDevice(principal: PublicPrincipal, workspaceId: string): Promise<string | null>;
}

/** Resolves the current active device solely from the authenticated desktop session and server state. */
export class PostgresDesktopSyncAuthority implements DesktopSyncAuthorityPort {
  constructor(private readonly transactions: AccountTransactionRunner) {}

  async resolveActiveDevice(principal: PublicPrincipal, workspaceIdValue: string): Promise<string | null> {
    if (principal.clientKind !== "desktop") return null;
    const workspaceId = identifier.safeParse(workspaceIdValue);
    if (!workspaceId.success) return null;
    return this.transactions.withAccount(principal.accountId, async (transaction) => {
      const result = await transaction.query<{ device_id: string | null }>(
        `SELECT session.device_id
           FROM identity_auth_sessions session
           JOIN identity_refresh_families family
             ON family.account_id=session.account_id AND family.session_id=session.session_id
           JOIN identity_account_security_states security ON security.account_id=session.account_id
           JOIN device_bindings binding
             ON binding.account_id=session.account_id AND binding.device_id=session.device_id
           JOIN device_account_states device_state ON device_state.account_id=session.account_id
           JOIN device_active_leases lease
             ON lease.account_id=session.account_id AND lease.device_id=session.device_id
            AND lease.lease_epoch=device_state.current_lease_epoch
           JOIN device_lease_epoch_allocations allocation
             ON allocation.account_id=lease.account_id AND allocation.lease_epoch=lease.lease_epoch
          WHERE session.account_id=$1 AND session.session_id=$2 AND session.client_kind='desktop'
            AND session.revoked_at IS NULL AND session.epoch_at_issue=security.account_security_epoch
            AND (session.expires_at IS NULL OR session.expires_at > transaction_timestamp())
            AND security.status='normal' AND family.state='active' AND binding.status='bound'
            AND lease.released_at IS NULL AND lease.issued_at <= transaction_timestamp()
            AND lease.offline_execute_until > transaction_timestamp()
            AND allocation.workspace_id=$3 AND allocation.status='activated'
          LIMIT 2`, [principal.accountId, principal.sessionId, workspaceId.data]);
      const value = result.rows[0]?.device_id;
      return result.rows.length === 1 && value !== null && value !== undefined
        && identifier.safeParse(value).success ? value : null;
    });
  }
}
