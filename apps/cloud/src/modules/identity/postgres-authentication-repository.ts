import type {
  AccountTransaction,
  AccountTransactionRunner,
  PreAuthEmailTransaction,
  PreAuthEmailTransactionRunner,
} from "../../db/index";

export interface PreAuthAccountRecord {
  readonly accountId: string;
  readonly emailNormalized: string;
  readonly emailVerified: boolean;
  readonly passwordPolicyId: "argon2id-v1";
  readonly passwordHashPhc: string;
}

export class PostgresAccountRepository {
  async findExactForLogin(transaction: PreAuthEmailTransaction): Promise<PreAuthAccountRecord | null> {
    const result = await transaction.query<{
      account_id: string;
      email_normalized: string;
      email_verified: boolean;
      password_policy_id: "argon2id-v1";
      password_hash_phc: string;
    }>(
      `SELECT account_id, email_normalized, email_verified_at IS NOT NULL AS email_verified,
              password_policy_id, password_hash_phc
       FROM identity_accounts
       WHERE email_normalized = $1`,
      [transaction.emailNormalized],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      accountId: row.account_id,
      emailNormalized: row.email_normalized,
      emailVerified: row.email_verified,
      passwordPolicyId: row.password_policy_id,
      passwordHashPhc: row.password_hash_phc,
    };
  }
}

export interface VerifiedRefreshSnapshot {
  readonly accountId: string;
  readonly sessionId: string;
  readonly familyId: string;
  readonly presentedRefreshJti: string;
  readonly accountSecurityEpoch: number;
}

export interface PreparedPostgresRefresh extends VerifiedRefreshSnapshot {
  readonly expectedGeneration: number;
}

export type RefreshPreparation =
  | { readonly status: "ready"; readonly preparation: PreparedPostgresRefresh }
  | { readonly status: "invalid_credentials" | "refresh_reuse_detected" | "session_revoked" };

export type RefreshCommitResult =
  | { readonly status: "rotated"; readonly generation: number }
  | { readonly status: "refresh_rotation_conflict" | "credential_jti_conflict" | "session_revoked" };

export class PostgresIdentityAuthenticationRepository {
  constructor(
    private readonly accounts: PreAuthEmailTransactionRunner,
    private readonly transactions: AccountTransactionRunner,
    private readonly accountRepository = new PostgresAccountRepository(),
  ) {}

  findExactAccount(emailNormalized: string): Promise<PreAuthAccountRecord | null> {
    return this.accounts.withExactEmail(emailNormalized, (transaction) =>
      this.accountRepository.findExactForLogin(transaction));
  }

  async issueInitial(input: {
    readonly accountId: string;
    readonly expectedEpoch: number;
    readonly sessionId: string;
    readonly familyId: string;
    readonly accessJti: string;
    readonly refreshJti: string;
    readonly deviceId: string;
    readonly rememberDevice: boolean;
    readonly accessExpiresAt: Date;
    readonly refreshExpiresAt: Date;
  }): Promise<"issued" | "epoch_conflict" | "credential_jti_conflict"> {
    try {
      return await this.transactions.withAccount(input.accountId, async (transaction) => {
        const state = await lockSecurityState(transaction);
        if (state === null || state.epoch !== input.expectedEpoch || state.status !== "normal") {
          return "epoch_conflict";
        }
        await transaction.query(
          `INSERT INTO identity_auth_sessions
             (account_id, session_id, client_kind, device_id, auth_method, remember_device, epoch_at_issue)
           VALUES ($1, $2, 'desktop', $3, 'password', $4, $5)`,
          [input.accountId, input.sessionId, input.deviceId, input.rememberDevice, input.expectedEpoch],
        );
        await transaction.query(
          `INSERT INTO identity_refresh_families
             (account_id, family_id, session_id, current_refresh_jti)
           VALUES ($1, $2, $3, $4)`,
          [input.accountId, input.familyId, input.sessionId, input.refreshJti],
        );
        await insertCredential(transaction, input, "access", input.accessJti, input.accessExpiresAt);
        await insertCredential(transaction, input, "refresh", input.refreshJti, input.refreshExpiresAt);
        await transaction.query(
          `UPDATE identity_account_security_states
           SET session_list_revision = session_list_revision + 1, updated_at = transaction_timestamp()
           WHERE account_id = $1`,
          [input.accountId],
        );
        return "issued";
      });
    } catch (error) {
      if (isUniqueViolation(error)) return "credential_jti_conflict";
      throw error;
    }
  }

  prepareRefresh(snapshot: VerifiedRefreshSnapshot): Promise<RefreshPreparation> {
    return this.transactions.withAccount(snapshot.accountId, async (transaction) => {
      const result = await transaction.query<{
        generation: string;
        family_state: "active" | "revoked";
        credential_state: "current" | "rotated" | "revoked";
        current_epoch: string;
        security_status: "normal" | "recovery_pending";
        session_revoked: boolean;
        session_epoch: string;
        credential_expired: boolean;
        session_expired: boolean;
        is_family_head: boolean;
      }>(
        `SELECT f.generation, f.state AS family_state, j.state AS credential_state,
                s.account_security_epoch AS current_epoch, s.status AS security_status,
                a.revoked_at IS NOT NULL AS session_revoked, a.epoch_at_issue AS session_epoch,
                j.expires_at <= transaction_timestamp() AS credential_expired,
                a.expires_at IS NOT NULL AND a.expires_at <= transaction_timestamp() AS session_expired,
                f.current_refresh_jti = j.jti AS is_family_head
         FROM identity_credential_jtis j
         JOIN identity_refresh_families f
           ON f.account_id = j.account_id AND f.family_id = j.family_id
         JOIN identity_auth_sessions a
           ON a.account_id = j.account_id AND a.session_id = j.session_id
         JOIN identity_account_security_states s ON s.account_id = j.account_id
         WHERE j.account_id = $1 AND j.jti = $2 AND j.kind = 'refresh'
           AND j.family_id = $3 AND j.session_id = $4
         FOR UPDATE OF j, f, a, s`,
        [snapshot.accountId, snapshot.presentedRefreshJti, snapshot.familyId, snapshot.sessionId],
      );
      const row = result.rows[0];
      if (row === undefined) return { status: "invalid_credentials" };
      if (row.credential_state === "rotated") {
        await revokeFamily(transaction, snapshot.accountId, snapshot.familyId, snapshot.sessionId, "refresh_reuse_detected");
        return { status: "refresh_reuse_detected" };
      }
      const epoch = parseSafeInteger(row.current_epoch);
      if (
        row.family_state !== "active" || row.credential_state !== "current" || !row.is_family_head ||
        row.session_revoked || row.credential_expired || row.session_expired ||
        row.security_status !== "normal" || epoch !== snapshot.accountSecurityEpoch ||
        parseSafeInteger(row.session_epoch) !== epoch
      ) return { status: "session_revoked" };
      return {
        status: "ready",
        preparation: { ...snapshot, expectedGeneration: parseSafeInteger(row.generation) },
      };
    });
  }

  async commitRefresh(
    preparation: PreparedPostgresRefresh,
    next: { readonly accessJti: string; readonly refreshJti: string; readonly accessExpiresAt: Date; readonly refreshExpiresAt: Date },
  ): Promise<RefreshCommitResult> {
    try {
      return await this.transactions.withAccount(preparation.accountId, async (transaction) => {
        const state = await lockSecurityState(transaction);
        if (state === null || state.epoch !== preparation.accountSecurityEpoch || state.status !== "normal") {
          return { status: "session_revoked" };
        }
        const family = await transaction.query<{ generation: string }>(
          `UPDATE identity_refresh_families
           SET current_refresh_jti = $5, generation = generation + 1
           WHERE account_id = $1 AND family_id = $2 AND session_id = $3
             AND state = 'active' AND current_refresh_jti = $4 AND generation = $6
           RETURNING generation`,
          [preparation.accountId, preparation.familyId, preparation.sessionId,
            preparation.presentedRefreshJti, next.refreshJti, preparation.expectedGeneration],
        );
        const updated = family.rows[0];
        if (updated === undefined) return { status: "refresh_rotation_conflict" };
        const presented = await transaction.query(
          `UPDATE identity_credential_jtis SET state = 'rotated'
           WHERE account_id = $1 AND family_id = $2 AND session_id = $3
             AND jti = $4 AND kind = 'refresh' AND state = 'current'`,
          [preparation.accountId, preparation.familyId, preparation.sessionId, preparation.presentedRefreshJti],
        );
        if (presented.rowCount !== 1) throw new Error("refresh CAS invariant failed");
        await insertCredential(transaction, preparation, "access", next.accessJti, next.accessExpiresAt);
        await insertCredential(transaction, preparation, "refresh", next.refreshJti, next.refreshExpiresAt);
        await transaction.query(
          `UPDATE identity_auth_sessions
           SET rotation_generation = $4, last_seen_at = transaction_timestamp()
           WHERE account_id = $1 AND session_id = $2 AND revoked_at IS NULL AND epoch_at_issue = $3`,
          [preparation.accountId, preparation.sessionId, preparation.accountSecurityEpoch, updated.generation],
        );
        return { status: "rotated", generation: parseSafeInteger(updated.generation) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { status: "credential_jti_conflict" };
      throw error;
    }
  }

  advanceSecurityEpoch(accountId: string, status: "normal" | "recovery_pending"): Promise<number> {
    return this.transactions.withAccount(accountId, async (transaction) => {
      const advanced = await transaction.query<{ account_security_epoch: string }>(
        `UPDATE identity_account_security_states
         SET account_security_epoch = account_security_epoch + 1, status = $2,
             session_list_revision = session_list_revision + 1, updated_at = transaction_timestamp()
         WHERE account_id = $1 RETURNING account_security_epoch`,
        [accountId, status],
      );
      const row = advanced.rows[0];
      if (row === undefined) throw new TypeError("account security state is unresolved");
      await transaction.query(
        `UPDATE identity_auth_sessions SET revoked_at = coalesce(revoked_at, transaction_timestamp()),
           revocation_reason = coalesce(revocation_reason, 'account_security_epoch_advanced')
         WHERE account_id = $1`, [accountId]);
      await transaction.query(
        `UPDATE identity_refresh_families SET state = 'revoked', revoked_at = coalesce(revoked_at, transaction_timestamp()),
           revocation_reason = coalesce(revocation_reason, 'account_security_epoch_advanced')
         WHERE account_id = $1`, [accountId]);
      await transaction.query(
        "UPDATE identity_credential_jtis SET state = 'revoked' WHERE account_id = $1", [accountId]);
      return parseSafeInteger(row.account_security_epoch);
    });
  }
}

async function lockSecurityState(transaction: AccountTransaction) {
  const result = await transaction.query<{ account_security_epoch: string; status: "normal" | "recovery_pending" }>(
    `SELECT account_security_epoch, status FROM identity_account_security_states
     WHERE account_id = $1 FOR UPDATE`, [transaction.accountId]);
  const row = result.rows[0];
  return row === undefined ? null : { epoch: parseSafeInteger(row.account_security_epoch), status: row.status };
}

async function insertCredential(
  transaction: AccountTransaction,
  input: { readonly accountId: string; readonly familyId: string; readonly sessionId: string; readonly accountSecurityEpoch?: number; readonly expectedEpoch?: number },
  kind: "access" | "refresh",
  jti: string,
  expiresAt: Date,
): Promise<void> {
  await transaction.query(
    `INSERT INTO identity_credential_jtis
       (jti, account_id, family_id, session_id, kind, state, issued_epoch, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [jti, input.accountId, input.familyId, input.sessionId, kind, kind === "access" ? "active" : "current",
      input.accountSecurityEpoch ?? input.expectedEpoch, expiresAt],
  );
}

async function revokeFamily(
  transaction: AccountTransaction,
  accountId: string,
  familyId: string,
  sessionId: string,
  reason: string,
): Promise<void> {
  await transaction.query(
    `UPDATE identity_refresh_families SET state = 'revoked', revoked_at = transaction_timestamp(), revocation_reason = $4
     WHERE account_id = $1 AND family_id = $2 AND session_id = $3 AND state = 'active'`,
    [accountId, familyId, sessionId, reason]);
  await transaction.query(
    `UPDATE identity_auth_sessions SET revoked_at = coalesce(revoked_at, transaction_timestamp()), revocation_reason = $3
     WHERE account_id = $1 AND session_id = $2`, [accountId, sessionId, reason]);
  await transaction.query(
    "UPDATE identity_credential_jtis SET state = 'revoked' WHERE account_id = $1 AND family_id = $2",
    [accountId, familyId]);
  await transaction.query(
    `UPDATE identity_account_security_states SET session_list_revision = session_list_revision + 1,
       updated_at = transaction_timestamp() WHERE account_id = $1`, [accountId]);
}

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("stored identity integer is invalid");
  return parsed;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
