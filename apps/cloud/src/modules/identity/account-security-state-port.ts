import type { TenantTransaction } from "../../db/index";

export interface LockedIdentityAccountSecurityState {
  readonly accountSecurityEpoch: number;
  readonly status: "normal" | "recovery_pending";
}

/**
 * Identity owns account security authority. Cross-capability transactions may lock and observe
 * the current state through this narrow port, but cannot update it or access identity repositories.
 */
export interface IdentityAccountSecurityStatePort {
  lockCurrent(transaction: TenantTransaction): Promise<LockedIdentityAccountSecurityState | null>;
}

export class PostgresIdentityAccountSecurityStatePort implements IdentityAccountSecurityStatePort {
  async lockCurrent(transaction: TenantTransaction): Promise<LockedIdentityAccountSecurityState | null> {
    const result = await transaction.query<{
      account_security_epoch: string;
      status: "normal" | "recovery_pending";
    }>(
      `SELECT account_security_epoch, status
       FROM identity_account_security_states
       WHERE account_id = $1
       FOR UPDATE`,
      [transaction.scope.accountId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const accountSecurityEpoch = Number(row.account_security_epoch);
    if (!Number.isSafeInteger(accountSecurityEpoch) || accountSecurityEpoch < 1) {
      throw new TypeError("stored account security epoch is invalid");
    }
    return { accountSecurityEpoch, status: row.status };
  }
}
