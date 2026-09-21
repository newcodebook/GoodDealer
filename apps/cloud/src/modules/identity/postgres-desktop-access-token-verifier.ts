import type { AccountTransactionRunner } from "../../db/index";
import {
  withTransactionCredential,
  type DesktopAccessTokenVerifierPort,
  type PublicPrincipal,
} from "../../entrypoints/ports/public-session";
import { inspectDesktopBearerToken } from "./desktop-bearer-token";

type AccountTransactions = Pick<AccountTransactionRunner, "withAccount">;

export class PostgresDesktopAccessTokenVerifier implements DesktopAccessTokenVerifierPort {
  constructor(private readonly transactions: AccountTransactions) {}

  async verifyAccessToken(token: string, now: Date): Promise<PublicPrincipal | null> {
    const inspected = inspectDesktopBearerToken("access", token);
    if (inspected === null || !Number.isFinite(now.getTime())) return null;
    return this.transactions.withAccount(inspected.accountId, async (transaction) => {
      const result = await transaction.query<{
        account_id: string;
        session_id: string;
        client_kind: string;
        family_state: string;
        credential_state: string;
        credential_live: boolean;
        session_live: boolean;
        epoch_current: boolean;
      }>(
        `SELECT j.account_id, j.session_id, a.client_kind, f.state AS family_state,
                j.state AS credential_state,
                j.expires_at > transaction_timestamp() AS credential_live,
                a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > transaction_timestamp()) AS session_live,
                a.epoch_at_issue = s.account_security_epoch AND s.status = 'normal' AS epoch_current
           FROM identity_credential_jtis j
           JOIN identity_refresh_families f
             ON f.account_id = j.account_id AND f.family_id = j.family_id
           JOIN identity_auth_sessions a
             ON a.account_id = j.account_id AND a.session_id = j.session_id
           JOIN identity_account_security_states s ON s.account_id = j.account_id
          WHERE j.account_id = $1 AND j.jti = $2 AND j.kind = 'access'`,
        [inspected.accountId, inspected.credentialDigest],
      );
      const row = result.rows[0];
      if (
        result.rows.length !== 1 || row === undefined || row.account_id !== inspected.accountId
        || row.client_kind !== "desktop" || row.family_state !== "active"
        || row.credential_state !== "active" || !row.credential_live || !row.session_live
        || !row.epoch_current
      ) return null;
      return withTransactionCredential(
        { accountId: row.account_id, sessionId: row.session_id, clientKind: "desktop" },
        new TextEncoder().encode(token),
      );
    });
  }
}
