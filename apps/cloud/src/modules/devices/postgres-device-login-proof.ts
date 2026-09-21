import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";

import type { AccountTransaction, AccountTransactionRunner } from "../../db/index";
import type { DeviceLoginChallenge, DeviceLoginProofPort } from "./ports";

export const DESKTOP_DEVICE_PROOF_DOMAIN = "GOODDEALER-DESKTOP-OAUTH-DEVICE-PROOF-V1" as const;
export const DESKTOP_DEVICE_LOGIN_CHALLENGE_TTL_SECONDS = 120;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export class PostgresDeviceLoginProof implements DeviceLoginProofPort {
  constructor(
    private readonly transactions: Pick<AccountTransactionRunner, "withAccount">,
  ) {}

  async issueLoginChallenge(transaction: AccountTransaction, input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly keyId: string;
    readonly publicKey: string;
    readonly codeChallenge: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly accountSecurityEpoch: number;
    readonly accountSessionDigest: string;
    readonly enrollmentAuthorizedUntil: Date | null;
    readonly evaluatedAt: Date;
  }): Promise<{ readonly issued: true; readonly challenge: DeviceLoginChallenge }
    | { readonly issued: false }> {
    const proposedPublicKey = decodeFixedBase64Url(input.publicKey, 32);
    const accountSessionDigest = decodeFixedBase64Url(input.accountSessionDigest, 32);
    if (
      proposedPublicKey === null || accountSessionDigest === null
      || !Number.isFinite(input.evaluatedAt.getTime())
      || (input.enrollmentAuthorizedUntil !== null
        && !Number.isFinite(input.enrollmentAuthorizedUntil.getTime()))
    ) {
      return { issued: false };
    }
    const account = await transaction.query<{ present: boolean }>(
      `SELECT true AS present FROM device_account_states WHERE account_id = $1 FOR UPDATE`,
      [input.accountId],
    );
    if (account.rows.length !== 1) return { issued: false };
    await transaction.query(
      `DELETE FROM device_login_challenges
        WHERE account_id = $1 AND consumed_at IS NULL
          AND transaction_timestamp() >= expires_at`,
      [input.accountId],
    );
    const pending = await transaction.query<{ allowed: boolean }>(
      `SELECT count(*) < 4 AS allowed FROM device_login_challenges
        WHERE account_id = $1 AND consumed_at IS NULL`,
      [input.accountId],
    );
    if (pending.rows[0]?.allowed !== true) return { issued: false };

    const existing = await transaction.query<{
      binding_status: string;
      key_id: string | null;
      public_key: Buffer | null;
    }>(
      `SELECT b.status AS binding_status, k.key_id, k.public_key
         FROM device_bindings b
         LEFT JOIN device_signing_keys k
           ON k.account_id = b.account_id AND k.device_id = b.device_id AND k.status = 'active'
        WHERE b.account_id = $1 AND b.device_id = $2
        FOR UPDATE OF b`,
      [input.accountId, input.deviceId],
    );
    const row = existing.rows[0];
    const purpose = row === undefined ? "enroll" : "login";
    if (
      row !== undefined
      && (row.binding_status !== "bound" || row.key_id !== input.keyId
        || row.public_key === null || !row.public_key.equals(proposedPublicKey))
    ) return { issued: false };
    if (row === undefined) {
      if (
        input.enrollmentAuthorizedUntil === null
        || input.enrollmentAuthorizedUntil.getTime() <= input.evaluatedAt.getTime()
      ) return { issued: false };
      const available = await transaction.query<{ available: boolean }>(
        `SELECT count(*) < 2 AS available FROM device_bindings
          WHERE account_id = $1 AND status = 'bound'`,
        [input.accountId],
      );
      if (available.rows[0]?.available !== true) return { issued: false };
    }

    const challengeId = `login-challenge-${randomBytes(18).toString("base64url")}`;
    const nonceDigest = createHash("sha256").update(randomBytes(32)).digest();
    const ordinaryExpiry = input.evaluatedAt.getTime()
      + DESKTOP_DEVICE_LOGIN_CHALLENGE_TTL_SECONDS * 1_000;
    const expiresAt = new Date(purpose === "enroll"
      ? Math.min(ordinaryExpiry, input.enrollmentAuthorizedUntil?.getTime() ?? Number.NEGATIVE_INFINITY)
      : ordinaryExpiry);
    await transaction.query(
      `INSERT INTO device_login_challenges
         (account_id, challenge_id, device_id, purpose, key_id, proposed_public_key,
          nonce_digest, account_session_digest, code_challenge, client_id, redirect_uri,
          account_security_epoch, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [input.accountId, challengeId, input.deviceId, purpose, input.keyId, proposedPublicKey,
        nonceDigest, accountSessionDigest, input.codeChallenge, input.clientId, input.redirectUri,
        input.accountSecurityEpoch, input.evaluatedAt, expiresAt],
    );
    return {
      issued: true,
      challenge: {
        challengeId,
        accountId: input.accountId,
        deviceId: input.deviceId,
        keyId: input.keyId,
        nonceDigest: nonceDigest.toString("base64url"),
        expiresAt: canonicalSecond(expiresAt),
      },
    };
  }

  async verifyAndConsumeLoginProof(transaction: AccountTransaction, input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly keyId: string;
    readonly publicKey: string;
    readonly challengeId: string;
    readonly signature: string;
    readonly codeChallenge: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly accountSecurityEpoch: number;
    readonly accountSessionDigest: string;
  }): Promise<{ readonly verified: boolean }> {
    const publicKey = decodeFixedBase64Url(input.publicKey, 32);
    const signature = decodeFixedBase64Url(input.signature, 64);
    const accountSessionDigest = decodeFixedBase64Url(input.accountSessionDigest, 32);
    if (publicKey === null || signature === null || accountSessionDigest === null) {
      return { verified: false };
    }
    const result = await transaction.query<{
      purpose: "login" | "enroll";
      key_id: string;
      proposed_public_key: Buffer;
      nonce_digest: Buffer;
      expires_at: Date;
    }>(
      `SELECT purpose, key_id, proposed_public_key, nonce_digest, expires_at
         FROM device_login_challenges
        WHERE account_id = $1 AND challenge_id = $2 AND device_id = $3
          AND key_id = $4 AND proposed_public_key = $5 AND code_challenge = $6
          AND client_id = $7 AND redirect_uri = $8 AND account_security_epoch = $9
          AND account_session_digest = $10
          AND consumed_at IS NULL
          AND transaction_timestamp() >= issued_at AND transaction_timestamp() < expires_at
        FOR UPDATE`,
      [input.accountId, input.challengeId, input.deviceId, input.keyId, publicKey,
        input.codeChallenge, input.clientId, input.redirectUri, input.accountSecurityEpoch,
        accountSessionDigest],
    );
    const challenge = result.rows[0];
    if (challenge === undefined) return { verified: false };
    const transcript = desktopDeviceProofTranscript({
      accountId: input.accountId,
      deviceId: input.deviceId,
      keyId: input.keyId,
      challengeId: input.challengeId,
      codeChallenge: input.codeChallenge,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      nonceDigest: challenge.nonce_digest.toString("base64url"),
      expiresAt: canonicalSecond(challenge.expires_at),
    });
    if (!verifyEd25519(publicKey, transcript, signature)) return { verified: false };

    if (challenge.purpose === "login") {
      const active = await transaction.query<{ active: boolean }>(
        `SELECT true AS active
           FROM device_bindings b JOIN device_signing_keys k
             ON k.account_id = b.account_id AND k.device_id = b.device_id
          WHERE b.account_id = $1 AND b.device_id = $2 AND b.status = 'bound'
            AND k.status = 'active' AND k.key_id = $3 AND k.public_key = $4
          FOR UPDATE OF b, k`,
        [input.accountId, input.deviceId, input.keyId, publicKey],
      );
      if (active.rows.length !== 1) return { verified: false };
    } else if (!await this.enroll(transaction, input, publicKey)) {
      return { verified: false };
    }
    const consumed = await transaction.query(
      `UPDATE device_login_challenges
          SET consumed_at = transaction_timestamp(), verdict = 'accepted'
        WHERE account_id = $1 AND challenge_id = $2 AND consumed_at IS NULL`,
      [input.accountId, input.challengeId],
    );
    return { verified: consumed.rowCount === 1 };
  }

  async checkLoginEligibility(input: {
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

  private async enroll(
    transaction: AccountTransaction,
    input: { readonly accountId: string; readonly deviceId: string; readonly keyId: string },
    publicKey: Buffer,
  ): Promise<boolean> {
    const existing = await transaction.query(
      `SELECT 1 FROM device_bindings WHERE account_id = $1 AND device_id = $2 FOR UPDATE`,
      [input.accountId, input.deviceId],
    );
    if (existing.rows.length !== 0) return false;
    const slots = await transaction.query<{ slot: number }>(
      `SELECT candidate.slot
         FROM (VALUES (1::smallint), (2::smallint)) AS candidate(slot)
         LEFT JOIN device_bindings b ON b.account_id = $1 AND b.slot = candidate.slot
        WHERE b.slot IS NULL ORDER BY candidate.slot LIMIT 1`,
      [input.accountId],
    );
    const slot = slots.rows[0]?.slot;
    if (slot !== 1 && slot !== 2) return false;
    await transaction.query(
      `INSERT INTO device_bindings
         (account_id, device_id, slot, status, credential_epoch)
       VALUES ($1,$2,$3,'bound',1)`,
      [input.accountId, input.deviceId, slot],
    );
    await transaction.query(
      `INSERT INTO device_signing_keys
         (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
       VALUES ($1,$2,1,$3,$4,$5,'active')`,
      [input.accountId, input.deviceId, input.keyId, publicKey,
        createHash("sha256").update(publicKey).digest()],
    );
    await transaction.query(
      `UPDATE device_account_states
          SET binding_list_revision = binding_list_revision + 1, updated_at = transaction_timestamp()
        WHERE account_id = $1`,
      [input.accountId],
    );
    return true;
  }
}

export function desktopDeviceProofTranscript(input: {
  readonly accountId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly challengeId: string;
  readonly codeChallenge: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly nonceDigest: string;
  readonly expiresAt: string;
}): Buffer {
  return Buffer.from([
    DESKTOP_DEVICE_PROOF_DOMAIN,
    input.accountId,
    input.deviceId,
    input.keyId,
    input.challengeId,
    input.codeChallenge,
    input.clientId,
    input.redirectUri,
    input.nonceDigest,
    input.expiresAt,
  ].join("\n"), "utf8");
}

function verifyEd25519(publicKey: Buffer, transcript: Buffer, signature: Buffer): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
      format: "der",
      type: "spki",
    });
    return verifySignature(null, transcript, key, signature);
  } catch {
    return false;
  }
}

function decodeFixedBase64Url(value: string, length: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === length && decoded.toString("base64url") === value ? decoded : null;
}

function canonicalSecond(value: Date): string {
  return value.toISOString().replace(/\.000Z$/u, "Z");
}
