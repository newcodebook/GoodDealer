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
  readonly requestId: string;
  readonly expectedGeneration: number;
}

export interface ReplayablePostgresRefresh extends VerifiedRefreshSnapshot {
  readonly generation: number;
}

export interface IdentifiedRefreshCredential extends VerifiedRefreshSnapshot {
  readonly deviceId: string;
  readonly rememberDevice: boolean;
}

export type RefreshPreparation =
  | { readonly status: "ready"; readonly preparation: PreparedPostgresRefresh }
  | { readonly status: "replayable"; readonly replay: ReplayablePostgresRefresh }
  | { readonly status: "invalid_credentials" | "refresh_reuse_detected" | "session_revoked" };

export type RefreshCommitResult =
  | { readonly status: "rotated"; readonly generation: number }
  | { readonly status: "refresh_rotation_conflict" | "credential_jti_conflict" | "refresh_reuse_detected" | "session_revoked" };

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

  identifyRefreshCredential(
    accountId: string,
    presentedRefreshJti: string,
  ): Promise<IdentifiedRefreshCredential | null> {
    return this.transactions.withAccount(accountId, async (transaction) => {
      const result = await transaction.query<{
        session_id: string;
        family_id: string;
        device_id: string | null;
        remember_device: boolean;
        account_security_epoch: string;
      }>(
        `SELECT j.session_id, j.family_id, a.device_id, a.remember_device,
                s.account_security_epoch
           FROM identity_credential_jtis j
           JOIN identity_auth_sessions a
             ON a.account_id = j.account_id AND a.session_id = j.session_id
           JOIN identity_account_security_states s ON s.account_id = j.account_id
          WHERE j.account_id = $1 AND j.jti = $2 AND j.kind = 'refresh'`,
        [accountId, presentedRefreshJti],
      );
      const row = result.rows[0];
      if (result.rows.length !== 1 || row === undefined || row.device_id === null) return null;
      return {
        accountId,
        sessionId: row.session_id,
        familyId: row.family_id,
        presentedRefreshJti,
        accountSecurityEpoch: parseSafeInteger(row.account_security_epoch),
        deviceId: row.device_id,
        rememberDevice: row.remember_device,
      };
    });
  }

  async issueInitial(input: {
    readonly accountId: string;
    readonly expectedEpoch: number;
    readonly sessionId: string;
    readonly familyId: string;
    readonly accessJti: string;
    readonly refreshJti: string;
    readonly clientKind?: "desktop" | "account_web";
    readonly deviceId: string | null;
    readonly authMethod: "password" | "passkey" | "oauth_pkce";
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
             (account_id, session_id, client_kind, device_id, auth_method, remember_device, epoch_at_issue, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [input.accountId, input.sessionId, input.clientKind ?? "desktop", input.deviceId,
            input.authMethod, input.rememberDevice, input.expectedEpoch,
            (input.clientKind ?? "desktop") === "account_web" ? input.refreshExpiresAt : null],
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

  prepareRefresh(snapshot: VerifiedRefreshSnapshot, requestId: string): Promise<RefreshPreparation> {
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
        rotation_request_id: string | null;
        resulting_generation: string | null;
      }>(
        `SELECT f.generation, f.state AS family_state, j.state AS credential_state,
                s.account_security_epoch AS current_epoch, s.status AS security_status,
                a.revoked_at IS NOT NULL AS session_revoked, a.epoch_at_issue AS session_epoch,
                j.expires_at <= transaction_timestamp() AS credential_expired,
                a.expires_at IS NOT NULL AND a.expires_at <= transaction_timestamp() AS session_expired,
                f.current_refresh_jti = j.jti AS is_family_head,
                j.rotation_request_id, j.resulting_generation
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
      const epoch = parseSafeInteger(row.current_epoch);
      if (
        row.family_state !== "active" || row.session_revoked || row.credential_expired
        || row.session_expired || row.security_status !== "normal"
        || epoch !== snapshot.accountSecurityEpoch || parseSafeInteger(row.session_epoch) !== epoch
      ) return { status: "session_revoked" };
      if (row.credential_state === "rotated") {
        if (row.rotation_request_id === requestId && row.resulting_generation !== null) {
          return {
            status: "replayable",
            replay: { ...snapshot, generation: parsePositiveInteger(row.resulting_generation) },
          };
        }
        await revokeFamily(transaction, snapshot.accountId, snapshot.familyId, snapshot.sessionId, "refresh_reuse_detected");
        return { status: "refresh_reuse_detected" };
      }
      if (
        row.credential_state !== "current" || !row.is_family_head
      ) return { status: "session_revoked" };
      return {
        status: "ready",
        preparation: { ...snapshot, requestId, expectedGeneration: parseSafeInteger(row.generation) },
      };
    });
  }

  async commitRefresh(
    preparation: PreparedPostgresRefresh,
    next: {
      readonly accessJti: string;
      readonly refreshJti: string;
      readonly accessExpiresAt: Date;
      readonly refreshExpiresAt: Date;
    },
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
        if (updated === undefined) {
          const conflict = await transaction.query<{
            credential_state: "current" | "rotated" | "revoked";
            family_state: "active" | "revoked";
            rotation_request_id: string | null;
          }>(
            `SELECT j.state AS credential_state, f.state AS family_state, j.rotation_request_id
               FROM identity_credential_jtis j
               JOIN identity_refresh_families f
                 ON f.account_id = j.account_id AND f.family_id = j.family_id
              WHERE j.account_id = $1 AND j.family_id = $2 AND j.session_id = $3
                AND j.jti = $4 AND j.kind = 'refresh'
              FOR UPDATE OF j, f`,
            [preparation.accountId, preparation.familyId, preparation.sessionId,
              preparation.presentedRefreshJti],
          );
          const winner = conflict.rows[0];
          if (winner === undefined || winner.family_state !== "active") {
            return { status: "session_revoked" };
          }
          if (
            winner.credential_state === "rotated"
            && winner.rotation_request_id !== preparation.requestId
          ) {
            await revokeFamily(
              transaction,
              preparation.accountId,
              preparation.familyId,
              preparation.sessionId,
              "refresh_reuse_detected",
            );
            return { status: "refresh_reuse_detected" };
          }
          return { status: "refresh_rotation_conflict" };
        }
        const presented = await transaction.query(
          `UPDATE identity_credential_jtis
           SET state = 'rotated', rotation_request_id = $5, resulting_generation = $6
           WHERE account_id = $1 AND family_id = $2 AND session_id = $3
             AND jti = $4 AND kind = 'refresh' AND state = 'current'`,
          [preparation.accountId, preparation.familyId, preparation.sessionId,
            preparation.presentedRefreshJti, preparation.requestId, updated.generation],
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

  recoverRefresh(
    replay: ReplayablePostgresRefresh,
    input: { readonly requestId: string; readonly accessJti: string; readonly refreshJti: string },
  ): Promise<{ readonly generation: number; readonly accessExpiresAt: Date; readonly refreshExpiresAt: Date } | null> {
    return this.transactions.withAccount(replay.accountId, async (transaction) => {
      const result = await transaction.query<{
        resulting_generation: string;
        access_expires_at: Date;
        refresh_expires_at: Date;
      }>(
        `SELECT presented.resulting_generation,
                access.expires_at AS access_expires_at,
                refresh.expires_at AS refresh_expires_at
           FROM identity_credential_jtis presented
           JOIN identity_refresh_families family
             ON family.account_id = presented.account_id AND family.family_id = presented.family_id
           JOIN identity_auth_sessions session
             ON session.account_id = presented.account_id AND session.session_id = presented.session_id
           JOIN identity_account_security_states security
             ON security.account_id = presented.account_id
           JOIN identity_credential_jtis access
             ON access.account_id = presented.account_id AND access.family_id = presented.family_id
            AND access.session_id = presented.session_id AND access.jti = $6 AND access.kind = 'access'
           JOIN identity_credential_jtis refresh
             ON refresh.account_id = presented.account_id AND refresh.family_id = presented.family_id
            AND refresh.session_id = presented.session_id AND refresh.jti = $7 AND refresh.kind = 'refresh'
          WHERE presented.account_id = $1 AND presented.family_id = $2 AND presented.session_id = $3
            AND presented.jti = $4 AND presented.kind = 'refresh' AND presented.state = 'rotated'
            AND presented.rotation_request_id = $5 AND presented.resulting_generation = $8
            AND family.state = 'active' AND family.current_refresh_jti = refresh.jti
            AND session.revoked_at IS NULL
            AND (session.expires_at IS NULL OR session.expires_at > transaction_timestamp())
            AND session.epoch_at_issue = security.account_security_epoch AND security.status = 'normal'
            AND presented.expires_at > transaction_timestamp()
            AND access.state = 'active'
            AND refresh.state = 'current' AND refresh.expires_at > transaction_timestamp()`,
        [replay.accountId, replay.familyId, replay.sessionId, replay.presentedRefreshJti,
          input.requestId, input.accessJti, input.refreshJti, replay.generation],
      );
      const row = result.rows[0];
      if (result.rows.length !== 1 || row === undefined) return null;
      const generation = parsePositiveInteger(row.resulting_generation);
      if (generation !== replay.generation
        || !Number.isFinite(row.access_expires_at.getTime())
        || !Number.isFinite(row.refresh_expires_at.getTime())) return null;
      return {
        generation,
        accessExpiresAt: row.access_expires_at,
        refreshExpiresAt: row.refresh_expires_at,
      };
    });
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

function parsePositiveInteger(value: string): number {
  const parsed = parseSafeInteger(value);
  if (parsed < 1) throw new TypeError("stored identity integer is invalid");
  return parsed;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
