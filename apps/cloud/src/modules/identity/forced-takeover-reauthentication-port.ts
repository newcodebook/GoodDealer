import type { AccountTransaction } from "../../db/index";

/** Identity derives the exact session from the consumed capability; Devices cannot choose one. */
export interface ForcedTakeoverReauthenticationPort {
  checkLocked(transaction: AccountTransaction): Promise<Date | null>;
  consumeLocked(transaction: AccountTransaction): Promise<Date | null>;
}
export class PostgresForcedTakeoverReauthentication implements ForcedTakeoverReauthenticationPort {
  checkLocked(transaction: AccountTransaction): Promise<Date | null> { return this.read(transaction, false); }
  consumeLocked(transaction: AccountTransaction): Promise<Date | null> { return this.read(transaction, true); }
  private async read(transaction: AccountTransaction, consume: boolean): Promise<Date | null> {
    const result = await transaction.query<{ deadline: Date | null }>(
      "SELECT identity_private.forced_takeover_reauthentication($1) AS deadline", [consume]);
    const deadline = result.rows[0]?.deadline;
    if (deadline === null) return null;
    if (!(deadline instanceof Date) || !Number.isFinite(deadline.getTime())) throw new TypeError("invalid reauthentication deadline");
    return deadline;
  }
}
