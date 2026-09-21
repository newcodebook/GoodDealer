import type { AccountTransactionRunner } from "../../db/index";
import type { DeviceLoginEligibilityPort } from "./ports";

type AccountTransactions = Pick<AccountTransactionRunner, "withAccount">;

export class PostgresDeviceLoginEligibility implements DeviceLoginEligibilityPort {
  constructor(private readonly transactions: AccountTransactions) {}

  checkLoginEligibility(input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly accountSecurityEpoch: number;
  }): Promise<{ readonly eligible: boolean }> {
    return this.transactions.withAccount(input.accountId, async (transaction) => {
      const result = await transaction.query<{ eligible: boolean }>(
        `SELECT b.status = 'bound'
                AND EXISTS (
                  SELECT 1 FROM device_signing_keys k
                   WHERE k.account_id = b.account_id AND k.device_id = b.device_id
                     AND k.status = 'active'
                ) AS eligible
           FROM device_bindings b
          WHERE b.account_id = $1 AND b.device_id = $2`,
        [input.accountId, input.deviceId],
      );
      return { eligible: result.rows.length === 1 && result.rows[0]?.eligible === true };
    });
  }
}
