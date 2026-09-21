import {
  authoritativeEntitlementSnapshotSchema,
  type AuthoritativeEntitlementSnapshot,
} from "@gooddealer/protocol/account";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";

import type {
  AccountTransaction,
  IdentityCapabilityTransactionRunner,
} from "../../db/index";

export { authoritativeEntitlementSnapshotSchema };
export type { AuthoritativeEntitlementSnapshot };

/**
 * Reads only the authority-derived projection deadline. The opaque credential is consumed by
 * Identity and the Licensing facade executes in that same gd_account_api transaction.
 */
export class PostgresEntitlementDeadlineReader {
  constructor(private readonly transactions: Pick<
    IdentityCapabilityTransactionRunner,
    "withAccountCredential"
  >) {}

  readCurrent(input: {
    readonly transactionCredential: Uint8Array;
    readonly expectedAccountId: string;
  }): Promise<{
    readonly active: true;
    readonly entitlementDeadline: string;
  } | null> {
    return this.transactions.withAccountCredential(
      input.transactionCredential,
      "identity_account",
      async (transaction) => {
        if (transaction.accountId !== input.expectedAccountId) return null;
        return readLockedDeadline(transaction);
      },
    );
  }
}

async function readLockedDeadline(transaction: AccountTransaction): Promise<{
  readonly active: true;
  readonly entitlementDeadline: string;
} | null> {
    const result = await transaction.query<{ entitlement_deadline: Date | string; currently_active: boolean }>(
      "SELECT entitlement_deadline, currently_active FROM licensing_api.read_entitlement_deadline()",
    );
    if (result.rows.length > 1) throw new TypeError("active entitlement identity is not unique");
    const row = result.rows[0];
    if (row === undefined || row.currently_active !== true) return null;
    return { active: true, entitlementDeadline: timestamp(row.entitlement_deadline) };
}

function timestamp(value: Date | string): string {
  const candidate = value instanceof Date ? value.toISOString().replace(/\.\d{3}Z$/u, "Z") : value;
  return canonicalUtcTimestamp.parse(candidate);
}
