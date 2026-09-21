import type { Pool } from "pg";

import { AccountTransactionRunner, PreAuthEmailTransactionRunner } from "../../db/index";
import {
  type IdentityAccountAccessRecord,
  type IdentityAccountAccessRepository,
  type RegistrationWrite,
  type SealedEmailEnvelope,
} from "./account-access";
import { PostgresIdentityAuthenticationRepository } from "./postgres-authentication-repository";

export class PostgresIdentityAccountAccessRepository implements IdentityAccountAccessRepository {
  readonly #accounts: PreAuthEmailTransactionRunner;
  readonly #transactions: AccountTransactionRunner;
  readonly #authentication: PostgresIdentityAuthenticationRepository;

  constructor(private readonly pool: Pool) {
    this.#accounts = new PreAuthEmailTransactionRunner(pool);
    this.#transactions = new AccountTransactionRunner(pool);
    this.#authentication = new PostgresIdentityAuthenticationRepository(this.#accounts, this.#transactions);
  }

  async findExactAccount(emailNormalized: string): Promise<IdentityAccountAccessRecord | null> {
    const account = await this.#authentication.findExactAccount(emailNormalized);
    if (account === null) return null;
    return this.#transactions.withAccount(account.accountId, async (transaction) => {
      const state = await transaction.query<{ account_security_epoch: string }>(
        "SELECT account_security_epoch FROM identity_account_security_states WHERE account_id = $1",
        [account.accountId],
      );
      const epoch = Number(state.rows[0]?.account_security_epoch);
      if (!Number.isSafeInteger(epoch) || epoch < 1) return null;
      return {
        accountId: account.accountId,
        emailNormalized: account.emailNormalized,
        emailVerified: account.emailVerified,
        storedPasswordHash: { policyId: account.passwordPolicyId, phc: account.passwordHashPhc },
        accountSecurityEpoch: epoch,
      };
    });
  }

  async requestRegistration(write: RegistrationWrite, now: Date): Promise<"queued" | "cooldown" | "already_verified"> {
    let account = await this.findExactAccount(write.emailNormalized);
    if (account?.emailVerified === true) return "already_verified";
    const accountId = account?.accountId ?? write.accountId;
    try {
      return await this.#transactions.withAccount(accountId, async (transaction) => {
        if (account === null) {
          await transaction.query(
            `INSERT INTO identity_accounts
               (account_id, email_normalized, password_policy_id, password_hash_phc)
             VALUES ($1, $2, $3, $4)`,
            [accountId, write.emailNormalized, write.password.policyId, write.password.phc],
          );
          await transaction.query("INSERT INTO identity_account_security_states (account_id) VALUES ($1)", [accountId]);
        } else {
          const cooldown = await transaction.query<{ blocked: boolean }>(
            `SELECT consumed_at IS NULL AND resend_available_at > $2 AS blocked
               FROM identity_registration_challenges WHERE account_id = $1 FOR UPDATE`,
            [accountId, now],
          );
          if (cooldown.rows[0]?.blocked === true) return "cooldown";
          await transaction.query(
            `UPDATE identity_accounts SET password_policy_id = $2, password_hash_phc = $3,
                 updated_at = transaction_timestamp()
               WHERE account_id = $1 AND email_verified_at IS NULL`,
            [accountId, write.password.policyId, write.password.phc],
          );
        }
        await transaction.query(
          `INSERT INTO identity_registration_challenges
             (account_id, workspace_id, email_normalized, challenge_digest, expires_at, resend_available_at,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (account_id) DO UPDATE SET
             challenge_digest = excluded.challenge_digest,
             expires_at = excluded.expires_at,
             resend_available_at = excluded.resend_available_at,
             failed_attempts = 0, consumed_at = NULL, updated_at = excluded.updated_at`,
          [accountId, write.workspaceId, write.emailNormalized, Buffer.from(write.challengeDigest),
            write.challengeExpiresAt, write.resendAvailableAt, now],
        );
        await transaction.query(
          `INSERT INTO identity_email_outbox
             (outbox_id, account_id, key_id, nonce, ciphertext, authentication_tag)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [write.outboxId, accountId, write.envelope.keyId, Buffer.from(write.envelope.nonce),
            Buffer.from(write.envelope.ciphertext), Buffer.from(write.envelope.authenticationTag)],
        );
        return "queued";
      });
    } catch (error) {
      if (account === null && isUniqueViolation(error)) {
        account = await this.findExactAccount(write.emailNormalized);
        if (account !== null) return this.requestRegistration({ ...write, accountId: account.accountId }, now);
      }
      throw error;
    }
  }

  async verifyRegistration(input: { emailNormalized: string; challengeDigest: Uint8Array; now: Date }) {
    const account = await this.findExactAccount(input.emailNormalized);
    if (account === null || account.emailVerified) return { status: "invalid" as const };
    return this.#transactions.withAccount(account.accountId, async (transaction) => {
      const challenge = await transaction.query<{ valid: boolean; workspace_id: string }>(
        `UPDATE identity_registration_challenges
            SET failed_attempts = failed_attempts + 1, updated_at = transaction_timestamp(),
                consumed_at = CASE WHEN challenge_digest = $2 AND expires_at > $3
                                      AND consumed_at IS NULL AND failed_attempts < 6
                                   THEN transaction_timestamp() ELSE consumed_at END
          WHERE account_id = $1 AND consumed_at IS NULL AND failed_attempts < 6
          RETURNING challenge_digest = $2 AND expires_at > $3 AND consumed_at IS NOT NULL AS valid,
                    workspace_id`,
        [account.accountId, Buffer.from(input.challengeDigest), input.now],
      );
      const accepted = challenge.rows[0];
      if (accepted?.valid !== true) return { status: "invalid" as const };
      const updated = await transaction.query(
        `UPDATE identity_accounts SET email_verified_at = transaction_timestamp(), updated_at = transaction_timestamp()
          WHERE account_id = $1 AND email_verified_at IS NULL`, [account.accountId]);
      if (updated.rowCount !== 1) return { status: "invalid" as const };
      await transaction.query("INSERT INTO device_account_states (account_id) VALUES ($1)", [account.accountId]);
      await transaction.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [accepted.workspace_id]);
      await transaction.query(
        "INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name) VALUES ($1, $2, 'personal', 'Personal workspace')",
        [accepted.workspace_id, account.accountId],
      );
      await transaction.query(
        `INSERT INTO workspace_account_bindings
           (account_id, workspace_id, owner_kind, role, is_default)
         VALUES ($1, $2, 'account', 'default_owner', true)`,
        [account.accountId, accepted.workspace_id],
      );
      await transaction.query(
        `INSERT INTO workspace_revisions (account_id, workspace_id, workspace_schema_version)
         VALUES ($1, $2, 1)`, [account.accountId, accepted.workspace_id],
      );
      return { status: "verified" as const, account: { ...account, emailVerified: true } };
    });
  }

  async issueAccountWebSession(input: {
    accountId: string; expectedEpoch: number; sessionId: string; familyId: string;
    accessJti: string; refreshJti: string; expiresAt: Date;
  }): Promise<"issued" | "conflict"> {
    const issued = await this.#authentication.issueInitial({
      ...input,
      clientKind: "account_web",
      deviceId: null,
      authMethod: "password",
      rememberDevice: true,
      accessExpiresAt: input.expiresAt,
      refreshExpiresAt: input.expiresAt,
    });
    return issued === "issued" ? "issued" : "conflict";
  }

  async claimEmail(): Promise<{ outboxId: string; accountId: string; envelope: SealedEmailEnvelope } | null> {
    const result = await this.pool.query<{
      outbox_id: string; account_id: string; key_id: string; nonce: Buffer;
      ciphertext: Buffer; authentication_tag: Buffer;
    }>("SELECT * FROM identity_claim_email_outbox()");
    const row = result.rows[0];
    return row === undefined ? null : {
      outboxId: row.outbox_id,
      accountId: row.account_id,
      envelope: {
        keyId: row.key_id,
        nonce: Uint8Array.from(row.nonce),
        ciphertext: Uint8Array.from(row.ciphertext),
        authenticationTag: Uint8Array.from(row.authentication_tag),
      },
    };
  }

  completeEmail(accountId: string, outboxId: string, delivered: boolean, now: Date): Promise<void> {
    return this.#transactions.withAccount(accountId, async (transaction) => {
      const result = await transaction.query(
        delivered
          ? `UPDATE identity_email_outbox SET state = 'sent', sent_at = $3, locked_until = NULL
               WHERE account_id = $1 AND outbox_id = $2 AND state = 'sending'`
          : `UPDATE identity_email_outbox SET state = 'pending', available_at = $3 + interval '1 minute', locked_until = NULL
               WHERE account_id = $1 AND outbox_id = $2 AND state = 'sending'`,
        [accountId, outboxId, now],
      );
      if (result.rowCount !== 1) throw new Error("identity email completion conflict");
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
