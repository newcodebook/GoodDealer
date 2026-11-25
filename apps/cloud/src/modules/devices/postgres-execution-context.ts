import { createHash } from "node:crypto";
import { encodeAuthoritativeEntitlementSnapshotDigestInput } from "@gooddealer/protocol/account";
import {
  desktopExecutionContextRequestSchema,
  desktopExecutionContextResponseSchema,
  encodeDesktopExecutionAuthorizationDigestInput,
  encodeDesktopExecutionContextEnvelope,
  DESKTOP_EXECUTION_CONTEXT_RESPONSE_LIMIT_BYTES,
  type DesktopExecutionContextResponse,
} from "@gooddealer/protocol/devices";
import { identifier } from "@gooddealer/protocol/wire";
import type { AccountTransaction, IdentityCapabilityTransactionRunner } from "../../db/index";
import type { DesktopExecutionContextApplicationPort } from "../../entrypoints/ports/execution-context";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { LockedDefaultWorkspaceAuthorityPort } from "../workspace/default-workspace/index";
import type { ActiveDeviceLeaseVerifier } from "./active-device-lease-verifier";
import { DesktopAuthorizationGrantIssuer } from "./authorization-grant-issuer";
import { DesktopExecutionContextIssuer } from "./execution-context-issuer";
import { readDesktopSessionAuthority } from "./desktop-session-authority";
import {
  authorizesGrant,
  canonicalSecond,
  grantAuthorityStillCurrent,
  isPostgresAuthorizationFailure,
  readCurrentCommercialAuthority,
  readCurrentIdentity,
  readCurrentLease,
} from "./desktop-authorization-readers";

/** Issues evidence about locked existing authority. It never allocates or renews a Lease. */
export class PostgresDesktopExecutionContextService implements DesktopExecutionContextApplicationPort {
  constructor(
    private readonly transactions: Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">,
    private readonly workspaces: LockedDefaultWorkspaceAuthorityPort,
    private readonly grantIssuer: DesktopAuthorizationGrantIssuer,
    private readonly leaseVerifier: ActiveDeviceLeaseVerifier,
    private readonly contextIssuer: DesktopExecutionContextIssuer,
  ) {}
  async issue(value: unknown, principal: PublicPrincipal): Promise<DesktopExecutionContextResponse | null> {
    const request = desktopExecutionContextRequestSchema.parse(value);
    if (principal.clientKind !== "desktop" || principal.transactionCredential === undefined) return null;
    try {
      return await this.transactions.withAccountCredential(
        principal.transactionCredential,
        "devices_account",
        async (transaction) => {
          const identity = await readCurrentIdentity(transaction, principal);
          if (identity === null) return null;
          const scope = await this.workspaces.resolveLocked(transaction);
          if (scope === null || scope.accountId !== principal.accountId) return null;
          const session = await readDesktopSessionAuthority(transaction, principal, scope.workspaceId);
          if (session?.role !== "active" || session.deviceId !== identity.deviceId) return null;
          const key = await readKey(transaction, identity.deviceId);
          if (key === null) return null;
          const duplicate = await transaction.query(
            "SELECT 1 FROM device_execution_contexts WHERE account_id=$1 AND source_device_id=$2 AND nonce=$3",
            [principal.accountId, identity.deviceId, Buffer.from(request.nonce, "base64url")],
          );
          if (duplicate.rows.length !== 0) return null;
          const lease = await readCurrentLease(
            transaction,
            principal.accountId,
            identity,
            this.leaseVerifier,
          );
          const leaseEvidence = lease === null ? null : this.leaseVerifier.verifyWithKeyEvidence(lease);
          const commercial = await readCurrentCommercialAuthority(transaction);
          if (lease === null || leaseEvidence === null || commercial === null || !authorizesGrant(commercial))
            return null;
          const issued = await this.grantIssuer.issue({
            accountId: principal.accountId,
            deviceId: identity.deviceId,
            workspaceId: scope.workspaceId,
            activeDeviceLease: lease,
            authoritativeEntitlementSnapshot: commercial.snapshot,
            trustedNow: commercial.trustedNow,
          });
          if (!issued.issued) return null;
          const clock = await transaction.query<{ now: Date }>("SELECT clock_timestamp() AS now");
          const sample = clock.rows[0]?.now;
          if (!(sample instanceof Date) || !Number.isFinite(sample.getTime())) return null;
          const grantBytes = Buffer.from(encodeDesktopExecutionAuthorizationDigestInput(issued.grant));
          const grantDigest = sha256(grantBytes);
          const expiresAt = [
            issued.grant.expiresAt,
            lease.payload.offlineExecuteUntil,
            issued.grant.commercialAuthority.commercialExpiresAt,
          ].sort()[0]!;
          if (sample.getTime() >= Date.parse(expiresAt)) return null;
          const signed = await this.contextIssuer.issue({
            schemaVersion: 1,
            typ: "gd.desktop-execution-context.v1",
            iss: "https://accounts.gooddealer.com",
            aud: "gooddealer-desktop/execution-evidence",
            nonce: request.nonce,
            accountId: principal.accountId,
            workspaceId: scope.workspaceId,
            deviceId: identity.deviceId,
            accountSecurityEpoch: identity.accountSecurityEpoch,
            activeLeaseEpoch: lease.payload.leaseEpoch,
            credentialEpoch: key.credentialEpoch,
            signingKeyId: key.keyId,
            signingKeyVersion: key.keyVersion,
            authorizationGrantDigest: grantDigest.toString("base64url"),
            serverObservedAt: canonicalSecond(sample),
            expiresAt,
          });
          if (signed === null) return null;
          const currentCommercial = await readCurrentCommercialAuthority(transaction);
          const currentKey = await readKey(transaction, identity.deviceId);
          const currentSession = await readDesktopSessionAuthority(transaction, principal, scope.workspaceId);
          const currentLease = await readCurrentLease(
            transaction,
            principal.accountId,
            identity,
            this.leaseVerifier,
          );
          if (
            currentCommercial === null ||
            !authorizesGrant(currentCommercial) ||
            currentKey === null ||
            currentKey.keyId !== key.keyId ||
            currentKey.keyVersion !== key.keyVersion ||
            currentKey.credentialEpoch !== key.credentialEpoch ||
            !currentKey.publicKey.equals(key.publicKey) ||
            currentSession?.role !== "active" ||
            currentSession.deviceId !== identity.deviceId ||
            currentSession.accountSecurityEpoch !== identity.accountSecurityEpoch ||
            currentLease === null ||
            JSON.stringify(currentLease) !== JSON.stringify(lease) ||
            !Buffer.from(
              encodeAuthoritativeEntitlementSnapshotDigestInput(currentCommercial.snapshot),
            ).equals(Buffer.from(encodeAuthoritativeEntitlementSnapshotDigestInput(commercial.snapshot))) ||
            !(await grantAuthorityStillCurrent(transaction, principal, identity, scope.workspaceId, lease))
          )
            return null;
          const live = await transaction.query<{ live: boolean }>(
            "SELECT clock_timestamp() >= $1::timestamptz AND clock_timestamp() <= $1::timestamptz + interval '30 seconds' AND clock_timestamp() < $2::timestamptz AS live",
            [sample.toISOString(), expiresAt],
          );
          if (live.rows[0]?.live !== true) return null;
          const response = desktopExecutionContextResponseSchema.parse({
            schemaVersion: 1,
            grant: issued.grant,
            context: signed.context,
          });
          if (Buffer.byteLength(JSON.stringify(response)) > DESKTOP_EXECUTION_CONTEXT_RESPONSE_LIMIT_BYTES)
            return null;
          const contextBytes = Buffer.from(encodeDesktopExecutionContextEnvelope(signed.context));
          await transaction.query(
            "SELECT public.device_execution_context_append_with_key_evidence($1::jsonb,$2::jsonb,$3::bytea,$4::bytea,$5::bytea,$6::bytea,$7::bytea,$8::bytea,$9::bytea,$10::bytea)",
            [
              signed.context,
              issued.grant,
              contextBytes,
              grantBytes,
              key.publicKey,
              Buffer.from(issued.receiptDigest, "hex"),
              Buffer.from(signed.receiptDigest, "hex"),
              leaseEvidence.verificationKey.export({ format: "der", type: "spki" }),
              issued.verificationKey.export({ format: "der", type: "spki" }),
              signed.verificationKey.export({ format: "der", type: "spki" }),
            ],
          );
          // withAccountCredential commits before this Promise resolves to the HTTP layer.
          return response;
        },
      );
    } catch (error) {
      if (
        isPostgresAuthorizationFailure(error) ||
        (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
      )
        return null;
      throw error;
    }
  }
}
async function readKey(transaction: AccountTransaction, deviceId: string) {
  const result = await transaction.query<{
    credential_epoch: string;
    key_id: string;
    key_version: string;
    public_key: Buffer;
  }>(
    `SELECT b.credential_epoch,k.key_id,k.key_version,k.public_key FROM device_bindings b JOIN device_signing_keys k USING(account_id,device_id)
     WHERE b.account_id=$1 AND b.device_id=$2 AND b.status='bound' AND k.status='active' FOR SHARE OF b,k`,
    [transaction.accountId, deviceId],
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row === undefined ||
    !identifier.safeParse(row.key_id).success ||
    !/^[1-9][0-9]*$/u.test(row.credential_epoch) ||
    !/^[1-9][0-9]*$/u.test(row.key_version) ||
    !Number.isSafeInteger(Number(row.credential_epoch)) ||
    !Number.isSafeInteger(Number(row.key_version)) ||
    !Buffer.isBuffer(row.public_key) ||
    row.public_key.length !== 32
  )
    return null;
  return {
    credentialEpoch: Number(row.credential_epoch),
    keyId: row.key_id,
    keyVersion: Number(row.key_version),
    publicKey: row.public_key,
  };
}
function sha256(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}
