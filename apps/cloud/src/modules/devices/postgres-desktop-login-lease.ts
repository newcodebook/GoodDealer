import { createHash, randomBytes, verify } from "node:crypto";

import {
  activeDeviceLeaseEnvelopeSchema,
  encodeActiveDeviceLeaseSignatureTranscript,
  type ActiveDeviceLeaseEnvelope,
} from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import type { AccountTransactionRunner } from "../../db/index";
import type { ActiveDeviceLeaseVerifier } from "./active-device-lease-verifier";
import {
  ACTIVE_DEVICE_LEASE_KEY_PURPOSE,
  type ActiveDeviceLeaseSigner,
} from "./postgres-bootstrap-activation";

export interface DesktopLoginLeaseEntitlementPort {
  readCurrent(input: {
    readonly transactionCredential: Uint8Array;
    readonly expectedAccountId: string;
  }): Promise<{
    readonly active: true;
    readonly entitlementDeadline: string;
  } | null>;
}

export interface DesktopLoginLeasePort {
  ensureCurrentLease(input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly accountSecurityEpoch: number;
    readonly transactionCredential: Uint8Array;
  }): Promise<{ readonly ensured: true; readonly lease: ActiveDeviceLeaseEnvelope }
    | { readonly ensured: false }>;
}

export interface DesktopOAuthLeasePort extends DesktopLoginLeasePort {
  requireCurrentLease(input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly accountSecurityEpoch: number;
  }): Promise<{ readonly ensured: true; readonly lease: ActiveDeviceLeaseEnvelope }
    | { readonly ensured: false }>;
}

type AccountTransactions = Pick<AccountTransactionRunner, "withAccount">;

/** Establishes or renews only the authenticated device's account-wide execution Lease. */
export class PostgresDesktopLoginLease implements DesktopLoginLeasePort {
  constructor(private readonly dependencies: {
    readonly transactions: AccountTransactions;
    readonly entitlement: DesktopLoginLeaseEntitlementPort;
    readonly signer: ActiveDeviceLeaseSigner;
    readonly verifier: ActiveDeviceLeaseVerifier;
  }) {}

  async ensureCurrentLease(input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly accountSecurityEpoch: number;
    readonly transactionCredential: Uint8Array;
  }): Promise<{ readonly ensured: true; readonly lease: ActiveDeviceLeaseEnvelope }
    | { readonly ensured: false }> {
    try {
      const entitlement = await this.dependencies.entitlement.readCurrent({
        transactionCredential: input.transactionCredential,
        expectedAccountId: input.accountId,
      });
      if (entitlement === null) refuse();
      return await this.dependencies.transactions.withAccount(input.accountId, async (transaction) => {
        await transaction.query("SET LOCAL lock_timeout = '2s'");
        await transaction.query("SET LOCAL statement_timeout = '10s'");
        const security = await transaction.query<{ account_security_epoch: string; status: string }>(
          `SELECT account_security_epoch, status FROM identity_account_security_states
            WHERE account_id = $1 FOR UPDATE`,
          [input.accountId],
        );
        if (
          security.rows.length !== 1 || security.rows[0]?.status !== "normal"
          || parsePositive(security.rows[0].account_security_epoch) !== input.accountSecurityEpoch
        ) refuse();
        const account = await transaction.query<{
          highest_allocated_lease_epoch: string;
          current_lease_epoch: string;
          unblocked: boolean;
        }>(
          `SELECT highest_allocated_lease_epoch, current_lease_epoch,
                  exclusive_execution_block_until IS NULL
                    OR exclusive_execution_block_until <= transaction_timestamp() AS unblocked
             FROM device_account_states WHERE account_id = $1 FOR UPDATE`,
          [input.accountId],
        );
        const accountRow = account.rows[0];
        if (account.rows.length !== 1 || accountRow === undefined || !accountRow.unblocked) refuse();
        const subject = await transaction.query<{ active: boolean }>(
          `SELECT b.status = 'bound' AND EXISTS (
                    SELECT 1 FROM device_signing_keys k
                     WHERE k.account_id = b.account_id AND k.device_id = b.device_id
                       AND k.status = 'active'
                  ) AS active
             FROM device_bindings b
            WHERE b.account_id = $1 AND b.device_id = $2
            FOR UPDATE OF b`,
          [input.accountId, input.deviceId],
        );
        if (subject.rows.length !== 1 || subject.rows[0]?.active !== true) refuse();
        const held = await transaction.query<{
          lease_epoch: string;
          device_id: string;
          jti: string;
          issued_at: Date;
          renew_after: Date;
          online_expires_at: Date;
          offline_execute_until: Date;
          wire_envelope: unknown;
          renewal_due: boolean;
          online: boolean;
        }>(
          `SELECT lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
                  offline_execute_until, wire_envelope,
                  transaction_timestamp() >= renew_after AS renewal_due,
                  transaction_timestamp() < online_expires_at AS online
             FROM device_active_leases
            WHERE account_id = $1 AND released_at IS NULL FOR UPDATE`,
          [input.accountId],
        );
        if (held.rows.length > 1) refuse();
        const existing = held.rows[0];
        const currentEpoch = parseUnsigned(accountRow.current_lease_epoch);
        let leaseEpoch: number;
        if (existing !== undefined) {
          leaseEpoch = parsePositive(existing.lease_epoch);
          if (existing.device_id !== input.deviceId || leaseEpoch !== currentEpoch) refuse();
          const parsed = this.dependencies.verifier.verify(existing.wire_envelope);
          if (
            parsed === null || parsed.accountId !== input.accountId
            || parsed.deviceId !== input.deviceId
            || parsed.accountSecurityEpoch !== input.accountSecurityEpoch
            || !persistedLeaseMatches(existing, parsed)
          ) refuse();
          if (!existing.renewal_due && existing.online) return { ensured: true, lease: parsed } as const;
        } else {
          const highest = parseUnsigned(accountRow.highest_allocated_lease_epoch);
          if (currentEpoch > highest || highest >= Number.MAX_SAFE_INTEGER) refuse();
          leaseEpoch = highest + 1;
        }
        const clock = await transaction.query<{ now: Date }>("SELECT transaction_timestamp() AS now");
        const now = clock.rows[0]?.now;
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) refuse();
        const issuedAt = canonicalSecond(now);
        const deadline = Date.parse(entitlement.entitlementDeadline);
        const renewAfterMs = now.getTime() + 300_000;
        const onlineExpiresAtMs = Math.min(now.getTime() + 900_000, deadline);
        const offlineExecuteUntilMs = Math.min(now.getTime() + 86_400_000, deadline);
        if (
          !Number.isFinite(deadline) || renewAfterMs >= onlineExpiresAtMs
          || onlineExpiresAtMs > offlineExecuteUntilMs
        ) refuse();
        const claims = {
          schemaVersion: 1 as const,
          typ: "gd.active-device-lease.v1" as const,
          iss: "https://accounts.gooddealer.com" as const,
          aud: "gooddealer-desktop/active-device-lease" as const,
          accountId: input.accountId,
          deviceId: input.deviceId,
          accountSecurityEpoch: input.accountSecurityEpoch,
          jti: `lease-${randomBytes(18).toString("base64url")}`,
          issuedAt,
          expiresAt: canonicalSecond(new Date(offlineExecuteUntilMs)),
          payload: {
            leaseEpoch,
            renewAfter: canonicalSecond(new Date(renewAfterMs)),
            onlineExpiresAt: canonicalSecond(new Date(onlineExpiresAtMs)),
            offlineExecuteUntil: canonicalSecond(new Date(offlineExecuteUntilMs)),
          },
        };
        let signed: Awaited<ReturnType<ActiveDeviceLeaseSigner["sign"]>>;
        try {
          signed = await this.dependencies.signer.sign({
            purpose: ACTIVE_DEVICE_LEASE_KEY_PURPOSE,
            claims,
          });
        } catch {
          refuse();
        }
        if (!signed.signed) refuse();
        const parsedEnvelope = activeDeviceLeaseEnvelopeSchema.safeParse(signed.envelope);
        if (!parsedEnvelope.success) refuse();
        const envelope = parsedEnvelope.data;
        if (
          !sameClaims(envelope, claims) || signed.verificationKey.type !== "public"
          || signed.verificationKey.asymmetricKeyType !== "ed25519"
          || !verify(null, encodeActiveDeviceLeaseSignatureTranscript(envelope), signed.verificationKey,
            Buffer.from(envelope.signature, "base64url"))
          || this.dependencies.verifier.verify(envelope) === null
        ) refuse();
        const canonicalEnvelope = Buffer.from(encodeDomainSeparatedWireValue(
          "GOODDEALER-ACTIVE-DEVICE-LEASE-ENVELOPE-V1", envelope,
        ));
        const receiptDigest = createHash("sha256").update(signed.receipt).digest();
        if (existing === undefined) {
          await transaction.query(
            `INSERT INTO device_lease_epoch_allocations
               (account_id, lease_epoch, allocation_source, status, terminal_at)
             VALUES ($1,$2,'desktop_login','activated',transaction_timestamp())`,
            [input.accountId, leaseEpoch],
          );
          const accountUpdated = await transaction.query(
            `INSERT INTO device_active_leases
               (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
                offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [input.accountId, leaseEpoch, input.deviceId, envelope.jti, envelope.issuedAt,
              envelope.payload.renewAfter, envelope.payload.onlineExpiresAt,
              envelope.payload.offlineExecuteUntil, canonicalEnvelope, JSON.stringify(envelope), receiptDigest],
          );
          await transaction.query(
            `UPDATE device_account_states
                SET highest_allocated_lease_epoch = $2, current_lease_epoch = $2,
                    updated_at = transaction_timestamp()
              WHERE account_id = $1 AND highest_allocated_lease_epoch < $2`,
            [input.accountId, leaseEpoch],
          );
          if (accountUpdated.rowCount !== 1) refuse();
        } else {
          const updated = await transaction.query(
            `UPDATE device_active_leases
                SET jti = $3, issued_at = $4, renew_after = $5, online_expires_at = $6,
                    offline_execute_until = $7, signed_envelope = $8, wire_envelope = $9,
                    signer_receipt_digest = $10
              WHERE account_id = $1 AND lease_epoch = $2 AND device_id = $11 AND released_at IS NULL`,
            [input.accountId, leaseEpoch, envelope.jti, envelope.issuedAt, envelope.payload.renewAfter,
              envelope.payload.onlineExpiresAt, envelope.payload.offlineExecuteUntil, canonicalEnvelope,
              JSON.stringify(envelope), receiptDigest, input.deviceId],
          );
          if (updated.rowCount !== 1) refuse();
        }
        return { ensured: true, lease: envelope } as const;
      });
    } catch (error) {
      if (error instanceof DesktopLoginLeaseRefusal) return { ensured: false };
      throw error;
    }
  }

  async requireCurrentLease(input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly accountSecurityEpoch: number;
  }): Promise<{ readonly ensured: true; readonly lease: ActiveDeviceLeaseEnvelope }
    | { readonly ensured: false }> {
    try {
      return await this.dependencies.transactions.withAccount(input.accountId, async (transaction) => {
        const security = await transaction.query<{ account_security_epoch: string; status: string }>(
          `SELECT account_security_epoch, status FROM identity_account_security_states
            WHERE account_id = $1`,
          [input.accountId],
        );
        if (
          security.rows.length !== 1 || security.rows[0]?.status !== "normal"
          || parsePositive(security.rows[0].account_security_epoch) !== input.accountSecurityEpoch
        ) refuse();
        const subject = await transaction.query<{ active: boolean }>(
          `SELECT b.status = 'bound' AND EXISTS (
                    SELECT 1 FROM device_signing_keys k
                     WHERE k.account_id = b.account_id AND k.device_id = b.device_id
                       AND k.status = 'active'
                  ) AS active
             FROM device_bindings b
            WHERE b.account_id = $1 AND b.device_id = $2`,
          [input.accountId, input.deviceId],
        );
        if (subject.rows.length !== 1 || subject.rows[0]?.active !== true) refuse();
        const held = await transaction.query<{
          lease_epoch: string;
          device_id: string;
          jti: string;
          issued_at: Date;
          renew_after: Date;
          online_expires_at: Date;
          offline_execute_until: Date;
          wire_envelope: unknown;
          online: boolean;
        }>(
          `SELECT lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
                  offline_execute_until, wire_envelope,
                  transaction_timestamp() < online_expires_at AS online
             FROM device_active_leases
            WHERE account_id = $1 AND released_at IS NULL`,
          [input.accountId],
        );
        const existing = held.rows.length === 1 ? held.rows[0] : undefined;
        if (existing === undefined || existing.device_id !== input.deviceId || !existing.online) refuse();
        const parsed = this.dependencies.verifier.verify(existing.wire_envelope);
        if (
          parsed === null || parsed.accountId !== input.accountId
          || parsed.deviceId !== input.deviceId
          || parsed.accountSecurityEpoch !== input.accountSecurityEpoch
          || !persistedLeaseMatches(existing, parsed)
        ) refuse();
        return { ensured: true, lease: parsed } as const;
      });
    } catch (error) {
      if (error instanceof DesktopLoginLeaseRefusal) return { ensured: false };
      throw error;
    }
  }
}

class DesktopLoginLeaseRefusal extends Error {}
function refuse(): never { throw new DesktopLoginLeaseRefusal("desktop login Lease refused"); }
function parsePositive(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) refuse();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) refuse();
  return parsed;
}
function parseUnsigned(value: string): number {
  if (!/^\d+$/u.test(value)) refuse();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) refuse();
  return parsed;
}
function canonicalSecond(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
function sameClaims(
  envelope: ActiveDeviceLeaseEnvelope,
  claims: Omit<ActiveDeviceLeaseEnvelope, "kid" | "signature">,
): boolean {
  const { kid: _kid, signature: _signature, ...actual } = envelope;
  return Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-ACTIVE-DEVICE-LEASE-CLAIMS-V1", actual))
    .equals(Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-ACTIVE-DEVICE-LEASE-CLAIMS-V1", claims)));
}

function persistedLeaseMatches(
  row: {
    readonly lease_epoch: string;
    readonly device_id: string;
    readonly jti: string;
    readonly issued_at: Date;
    readonly renew_after: Date;
    readonly online_expires_at: Date;
    readonly offline_execute_until: Date;
  },
  envelope: ActiveDeviceLeaseEnvelope,
): boolean {
  return parsePositive(row.lease_epoch) === envelope.payload.leaseEpoch
    && row.device_id === envelope.deviceId
    && row.jti === envelope.jti
    && canonicalSecond(row.issued_at) === envelope.issuedAt
    && canonicalSecond(row.renew_after) === envelope.payload.renewAfter
    && canonicalSecond(row.online_expires_at) === envelope.payload.onlineExpiresAt
    && canonicalSecond(row.offline_execute_until) === envelope.payload.offlineExecuteUntil;
}
