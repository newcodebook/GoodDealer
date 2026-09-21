import { createHash, randomBytes } from "node:crypto";

import { identifier } from "@gooddealer/protocol/wire";

import type {
  AccountTransaction,
  AccountTransactionRunner,
  IdentityCapabilityTransactionRunner,
} from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { DesktopOAuthLeasePort } from "../devices/postgres-desktop-login-lease";
import type { DeviceLoginChallenge, DeviceLoginProofPort } from "../devices/ports";
import {
  inspectDesktopBearerToken,
  issueDesktopBearerToken,
} from "./desktop-bearer-token";
import {
  ConsumableDesktopCredentials,
  DESKTOP_ACCESS_TOKEN_TTL_SECONDS,
  DESKTOP_REFRESH_TOKEN_TTL_SECONDS,
} from "./desktop-token-refresh-service";
import type { PostgresIdentityAuthenticationRepository } from "./postgres-authentication-repository";

export const DESKTOP_OAUTH_CLIENT_ID = "gooddealer-desktop" as const;
export const DESKTOP_OAUTH_REDIRECT_URI = "gooddealer://oauth/callback" as const;
export const DESKTOP_AUTHORIZATION_CODE_TTL_SECONDS = 300;
export const DESKTOP_ENROLLMENT_REAUTH_TTL_SECONDS = 300;

type AccountTransactions = Pick<AccountTransactionRunner, "withAccount">;

export class PostgresDesktopOAuthAuthorizationService {
  constructor(
    private readonly transactions: AccountTransactions,
    private readonly authentication: Pick<PostgresIdentityAuthenticationRepository, "issueInitial">,
    private readonly devices: DeviceLoginProofPort,
    private readonly leases: DesktopOAuthLeasePort,
    private readonly authenticatedTransactions?: Pick<
      IdentityCapabilityTransactionRunner,
      "withAccountCredential"
    >,
  ) {}

  async authorize(input: {
    readonly principal: PublicPrincipal;
    readonly deviceId: unknown;
    readonly clientId: unknown;
    readonly redirectUri: unknown;
    readonly codeChallenge: unknown;
    readonly codeChallengeMethod: unknown;
    readonly keyId: unknown;
    readonly publicKey: unknown;
    readonly proof?: {
      readonly challengeId: unknown;
      readonly signature: unknown;
    };
    readonly evaluatedAt: Date;
  }): Promise<
    | { readonly authorized: true; readonly code: string }
    | { readonly authorized: false }
    | { readonly authorized: false; readonly challengeRequired: true; readonly challenge: DeviceLoginChallenge }
  > {
    const deviceId = identifier.safeParse(input.deviceId);
    const keyId = identifier.safeParse(input.keyId);
    if (
      input.principal.clientKind !== "account_web" || !deviceId.success || !keyId.success
      || input.clientId !== DESKTOP_OAUTH_CLIENT_ID || input.redirectUri !== DESKTOP_OAUTH_REDIRECT_URI
      || input.codeChallengeMethod !== "S256" || !validChallenge(input.codeChallenge)
      || !validPublicKey(input.publicKey)
      || !Number.isFinite(input.evaluatedAt.getTime())
    ) return { authorized: false };
    const publicKey = input.publicKey;
    const codeChallenge = input.codeChallenge;
    const authorize = async (transaction: AccountTransaction) => {
      const security = await transaction.query<{ account_security_epoch: string; status: string }>(
        `SELECT account_security_epoch, status FROM identity_account_security_states
          WHERE account_id = $1 FOR UPDATE`,
        [input.principal.accountId],
      );
      const epoch = security.rows[0]?.status === "normal"
        ? safePositive(security.rows[0].account_security_epoch)
        : null;
      if (epoch === null) return { authorized: false } as const;
      const accountSession = await transaction.query<{ enrollment_authorized_until: Date | null }>(
        `SELECT CASE
                  WHEN auth_method IN ('password', 'passkey')
                    AND transaction_timestamp() < created_at + make_interval(secs => $4)
                  THEN created_at + make_interval(secs => $4)
                  ELSE NULL
                END AS enrollment_authorized_until
           FROM identity_auth_sessions
          WHERE account_id = $1 AND session_id = $2 AND client_kind = 'account_web'
            AND epoch_at_issue = $3 AND revoked_at IS NULL
            AND expires_at IS NOT NULL
            AND transaction_timestamp() >= created_at
            AND transaction_timestamp() < expires_at
            AND EXISTS (
              SELECT 1 FROM identity_refresh_families
               WHERE account_id = $1 AND session_id = $2 AND state = 'active'
            )
          FOR UPDATE`,
        [input.principal.accountId, input.principal.sessionId, epoch,
          DESKTOP_ENROLLMENT_REAUTH_TTL_SECONDS],
      );
      const session = accountSession.rows[0];
      if (session === undefined) return { authorized: false } as const;
      const accountSessionDigest = createHash("sha256")
        .update(input.principal.sessionId, "utf8")
        .digest("base64url");
      const enrollmentAuthorizedUntil = session.enrollment_authorized_until;
      if (
        enrollmentAuthorizedUntil !== null
        && !Number.isFinite(enrollmentAuthorizedUntil.getTime())
      ) return { authorized: false } as const;
      if (input.proof === undefined) {
        const challenged = await this.devices.issueLoginChallenge(transaction, {
          accountId: input.principal.accountId,
          deviceId: deviceId.data,
          keyId: keyId.data,
          publicKey,
          codeChallenge,
          clientId: DESKTOP_OAUTH_CLIENT_ID,
          redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
          accountSecurityEpoch: epoch,
          accountSessionDigest,
          enrollmentAuthorizedUntil,
          evaluatedAt: input.evaluatedAt,
        });
        return challenged.issued
          ? { authorized: false, challengeRequired: true, challenge: challenged.challenge } as const
          : { authorized: false } as const;
      }
      const challengeId = identifier.safeParse(input.proof.challengeId);
      if (!challengeId.success || !validSignature(input.proof.signature)) {
        return { authorized: false } as const;
      }
      const verified = await this.devices.verifyAndConsumeLoginProof(transaction, {
        accountId: input.principal.accountId,
        deviceId: deviceId.data,
        keyId: keyId.data,
        publicKey,
        challengeId: challengeId.data,
        signature: input.proof.signature,
        codeChallenge,
        clientId: DESKTOP_OAUTH_CLIENT_ID,
        redirectUri: DESKTOP_OAUTH_REDIRECT_URI,
        accountSecurityEpoch: epoch,
        accountSessionDigest,
      });
      if (!verified.verified) return { authorized: false } as const;
      const code = issueDesktopBearerToken("authorization_code", input.principal.accountId);
      const expiresAt = addSeconds(input.evaluatedAt, DESKTOP_AUTHORIZATION_CODE_TTL_SECONDS);
      await transaction.query(
        `INSERT INTO identity_desktop_authorization_codes
           (account_id, code_digest, device_id, client_id, redirect_uri, code_challenge,
            account_security_epoch, issued_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [input.principal.accountId, code.credentialDigest, deviceId.data, DESKTOP_OAUTH_CLIENT_ID,
          DESKTOP_OAUTH_REDIRECT_URI, codeChallenge, epoch, input.evaluatedAt, expiresAt],
      );
      return {
        authorized: true,
        code: code.token,
        deviceId: deviceId.data,
        accountSecurityEpoch: epoch,
      } as const;
    };
    let result: Awaited<ReturnType<typeof authorize>>;
    if (this.authenticatedTransactions !== undefined) {
      if (input.principal.transactionCredential === undefined) return { authorized: false };
      result = await this.authenticatedTransactions.withAccountCredential(
        input.principal.transactionCredential,
        "devices_account",
        authorize,
      );
    } else {
      result = await this.transactions.withAccount(input.principal.accountId, authorize);
    }
    if (!result.authorized) return result;
    const transactionCredential = input.principal.transactionCredential;
    if (transactionCredential === undefined) return { authorized: false };
    const leased = await this.leases.ensureCurrentLease({
      accountId: input.principal.accountId,
      deviceId: result.deviceId,
      accountSecurityEpoch: result.accountSecurityEpoch,
      transactionCredential,
    });
    return leased.ensured
      ? { authorized: true, code: result.code }
      : { authorized: false };
  }

  async exchange(input: {
    readonly code: unknown;
    readonly codeVerifier: unknown;
    readonly clientId: unknown;
    readonly redirectUri: unknown;
    readonly evaluatedAt: Date;
  }): Promise<{ readonly exchanged: true; readonly credentials: ConsumableDesktopCredentials }
    | { readonly exchanged: false }> {
    const code = inspectDesktopBearerToken("authorization_code", input.code);
    if (
      code === null || !validVerifier(input.codeVerifier)
      || input.clientId !== DESKTOP_OAUTH_CLIENT_ID || input.redirectUri !== DESKTOP_OAUTH_REDIRECT_URI
      || !Number.isFinite(input.evaluatedAt.getTime())
    ) return { exchanged: false };
    const challenge = pkceChallenge(input.codeVerifier);
    const reserved = await this.transactions.withAccount(code.accountId, async (transaction) => {
      const result = await transaction.query<{
        device_id: string;
        account_security_epoch: string;
      }>(
        `UPDATE identity_desktop_authorization_codes
            SET consumed_at = transaction_timestamp()
          WHERE account_id = $1 AND code_digest = $2 AND code_challenge = $3
            AND client_id = $4 AND redirect_uri = $5 AND consumed_at IS NULL
            AND transaction_timestamp() >= issued_at AND transaction_timestamp() < expires_at
          RETURNING device_id, account_security_epoch`,
        [code.accountId, code.credentialDigest, challenge, DESKTOP_OAUTH_CLIENT_ID, DESKTOP_OAUTH_REDIRECT_URI],
      );
      return result.rows.length === 1 ? result.rows[0] : undefined;
    });
    if (reserved === undefined) return { exchanged: false };
    const epoch = safePositive(reserved.account_security_epoch);
    if (epoch === null) return { exchanged: false };
    const eligible = await this.devices.checkLoginEligibility({
      accountId: code.accountId,
      deviceId: reserved.device_id,
      accountSecurityEpoch: epoch,
    });
    if (!eligible.eligible) return { exchanged: false };
    const leased = await this.leases.requireCurrentLease({
      accountId: code.accountId,
      deviceId: reserved.device_id,
      accountSecurityEpoch: epoch,
    });
    if (!leased.ensured) return { exchanged: false };

    const access = issueDesktopBearerToken("access", code.accountId);
    const refresh = issueDesktopBearerToken("refresh", code.accountId);
    const sessionId = `session-${randomBytes(18).toString("base64url")}`;
    const familyId = `family-${randomBytes(18).toString("base64url")}`;
    const accessExpiresAt = addSeconds(input.evaluatedAt, DESKTOP_ACCESS_TOKEN_TTL_SECONDS);
    const refreshExpiresAt = addSeconds(input.evaluatedAt, DESKTOP_REFRESH_TOKEN_TTL_SECONDS);
    const issued = await this.authentication.issueInitial({
      accountId: code.accountId,
      expectedEpoch: epoch,
      sessionId,
      familyId,
      accessJti: access.credentialDigest,
      refreshJti: refresh.credentialDigest,
      deviceId: reserved.device_id,
      authMethod: "oauth_pkce",
      rememberDevice: true,
      accessExpiresAt,
      refreshExpiresAt,
    });
    if (issued !== "issued") return { exchanged: false };
    return {
      exchanged: true,
      credentials: new ConsumableDesktopCredentials(
        { accessToken: access.token, refreshToken: refresh.token },
        canonicalSecond(accessExpiresAt),
        canonicalSecond(refreshExpiresAt),
        0,
      ),
    };
  }

}

function validVerifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 43 && value.length <= 128
    && /^[A-Za-z0-9._~-]+$/u.test(value);
}

function validChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function validPublicKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function validSignature(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{86}$/u.test(value);
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function safePositive(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

function canonicalSecond(value: Date): string {
  return value.toISOString().replace(/\.000Z$/u, "Z");
}
