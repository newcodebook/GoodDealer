import type { Pool } from "pg";

import type { IdentitySessionVerificationReader } from "./session-verifier";

interface SessionVerificationRow {
  readonly session_id: string;
  readonly account_id: string;
  readonly client_kind: string;
  readonly expires_at: Date | null;
  readonly session_account_security_epoch: string;
  readonly current_account_security_epoch: string;
  readonly family_state: string | null;
}

/** Executes only the identity-owned, non-secret session lookup function. */
export class PostgresIdentitySessionVerificationReader implements IdentitySessionVerificationReader {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async readSessionVerification(sessionId: string): Promise<unknown> {
    const result = await this.pool.query<SessionVerificationRow>(
      "SELECT * FROM identity_read_session_verification($1)",
      [sessionId],
    );
    if (result.rows.length !== 1) return null;
    const row = result.rows[0];
    if (row === undefined) return null;
    const sessionEpoch = positive(row.session_account_security_epoch);
    const currentEpoch = positive(row.current_account_security_epoch);
    if (sessionEpoch === null || currentEpoch === null) return null;
    return {
      sessionId: row.session_id,
      accountId: row.account_id,
      clientKind: row.client_kind,
      expiresAt: row.expires_at === null ? null : canonicalSecond(row.expires_at),
      sessionAccountSecurityEpoch: sessionEpoch,
      currentAccountSecurityEpoch: currentEpoch,
      familyState: row.family_state,
    };
  }
}

function positive(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function canonicalSecond(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("stored identity session timestamp is invalid");
  }
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
