import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  desktopExecutionContextSchema,
  desktopAuthorizationGrantSchema,
  encodeDesktopExecutionContextEnvelope,
  encodeDesktopExecutionAuthorizationDigestInput,
  encodeDesktopExecutionContextSignatureTranscript,
  encodeDesktopAuthorizationGrantSignatureTranscript,
  encodeActiveDeviceLeaseSignatureTranscript,
  type DesktopExecutionContext,
} from "@gooddealer/protocol/devices";
import {
  canonicalUtcTimestamp,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "@gooddealer/protocol/wire";
import type { AccountTransaction } from "../../db/index";

export interface HistoricalExecutionContextReference {
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly credentialEpoch: number;
  readonly signingKeyId: string;
  readonly signingKeyVersion: number;
  readonly trustedTimeAnchorId: string;
  readonly authorizationHash: string;
  readonly monotonicDeltaMs: number;
  readonly occurredAt: string;
}
export type HistoricalExecutionAuthorityFailure =
  "epoch_unknown" | "time_unprovable" | "authorization" | "removal_boundary";
export type HistoricalExecutionContextResult =
  | { readonly found: false; readonly reason: HistoricalExecutionAuthorityFailure }
  | {
      readonly found: true;
      readonly context: DesktopExecutionContext;
      readonly devicePublicKey: KeyObject;
      readonly authorizationFailure: HistoricalExecutionAuthorityFailure | null;
    };
export interface HistoricalExecutionContextPort {
  readSourceSigningKeyForQuarantine(
    transaction: AccountTransaction,
    source: { sourceDeviceId: string; signingKeyId: string; signingKeyVersion: number },
  ): Promise<KeyObject | null>;
  read(
    transaction: AccountTransaction,
    reference: HistoricalExecutionContextReference,
  ): Promise<HistoricalExecutionContextResult>;
}
function parseReference(value: HistoricalExecutionContextReference): HistoricalExecutionContextReference {
  for (const key of ["workspaceId", "sourceDeviceId", "signingKeyId"] as const) identifier.parse(value[key]);
  for (const key of ["activeLeaseEpoch", "credentialEpoch", "signingKeyVersion"] as const)
    safePositiveInteger.parse(value[key]);
  for (const key of ["trustedTimeAnchorId", "authorizationHash"] as const)
    if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(value[key]))
      throw new TypeError("invalid execution digest");
  safeUnsignedInteger.parse(value.monotonicDeltaMs);
  canonicalUtcTimestamp.parse(value.occurredAt);
  return value;
}
function parseRow(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const expected = [
    "signed_context",
    "signed_grant",
    "canonical_context_envelope",
    "canonical_grant_envelope",
    "device_public_key",
    "context_digest",
    "authorization_grant_digest",
    "lease_key_id",
    "lease_public_key",
    "grant_key_id",
    "grant_public_key",
    "context_key_id",
    "context_public_key",
    "binding_status",
    "removed_at",
    "key_status",
    "retired_at",
    "security_proven",
    "security_ended_at",
  ];
  if (Object.keys(row).length !== expected.length || expected.some((k) => !(k in row))) return null;
  const signed_context = desktopExecutionContextSchema.safeParse(row.signed_context),
    signed_grant = desktopAuthorizationGrantSchema.safeParse(row.signed_grant);
  if (
    !signed_context.success ||
    !signed_grant.success ||
    typeof row.security_proven !== "boolean" ||
    (row.binding_status !== "bound" && row.binding_status !== "removed") ||
    (row.key_status !== "active" && row.key_status !== "rotated" && row.key_status !== "revoked")
  )
    return null;
  const byte = (key: string) => {
    const v = row[key];
    if (!Buffer.isBuffer(v)) throw new TypeError("invalid persisted execution bytes");
    return v;
  };
  const date = (key: string) => {
    const v = row[key];
    if (v === null) return null;
    if (!(v instanceof Date) || !Number.isFinite(v.getTime()))
      throw new TypeError("invalid persisted execution boundary");
    return v;
  };
  try {
    return {
      signed_context: signed_context.data,
      signed_grant: signed_grant.data,
      canonical_context_envelope: byte("canonical_context_envelope"),
      canonical_grant_envelope: byte("canonical_grant_envelope"),
      device_public_key: byte("device_public_key"),
      context_digest: byte("context_digest"),
      authorization_grant_digest: byte("authorization_grant_digest"),
      lease_key_id: identifier.parse(row.lease_key_id),
      lease_public_key: byte("lease_public_key"),
      grant_key_id: identifier.parse(row.grant_key_id),
      grant_public_key: byte("grant_public_key"),
      context_key_id: identifier.parse(row.context_key_id),
      context_public_key: byte("context_public_key"),
      binding_status: row.binding_status,
      removed_at: date("removed_at"),
      key_status: row.key_status,
      retired_at: date("retired_at"),
      security_proven: row.security_proven,
      security_ended_at: date("security_ended_at"),
    };
  } catch {
    return null;
  }
}

/** Historical authority is the immutable issuance snapshot, not the current keyring or current Lease. */
export class PostgresHistoricalExecutionContext implements HistoricalExecutionContextPort {
  /** Attribution only: a known device signature can block a seal but never supplies missing authority. */
  async readSourceSigningKeyForQuarantine(
    transaction: AccountTransaction,
    source: { sourceDeviceId: string; signingKeyId: string; signingKeyVersion: number },
  ): Promise<KeyObject | null> {
    identifier.parse(source.sourceDeviceId);
    identifier.parse(source.signingKeyId);
    safePositiveInteger.parse(source.signingKeyVersion);
    const rows = await transaction.query(
      `SELECT public_key FROM device_signing_keys WHERE account_id=$1 AND device_id=$2 AND key_id=$3 AND key_version=$4 AND device_id=identity_private.current_execution_context_device() FOR SHARE`,
      [transaction.accountId, source.sourceDeviceId, source.signingKeyId, source.signingKeyVersion],
    );
    if (rows.rows.length !== 1) return null;
    const row: unknown = rows.rows[0];
    if (
      typeof row !== "object" ||
      row === null ||
      !("public_key" in row) ||
      !Buffer.isBuffer(row.public_key) ||
      row.public_key.length !== 32
    )
      return null;
    return createPublicKey({
      format: "der",
      type: "spki",
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), row.public_key]),
    });
  }
  async read(
    transaction: AccountTransaction,
    value: HistoricalExecutionContextReference,
  ): Promise<HistoricalExecutionContextResult> {
    const input = parseReference(value);
    const rows = await transaction.query(
      `SELECT c.signed_context,c.signed_grant,c.canonical_context_envelope,c.canonical_grant_envelope,
       c.device_public_key,c.context_digest,c.authorization_grant_digest,
       e.lease_key_id,e.lease_public_key,e.grant_key_id,e.grant_public_key,e.context_key_id,e.context_public_key,
       b.status AS binding_status,b.removed_at,k.status AS key_status,k.retired_at,
       s.proven AS security_proven,s.ended_at AS security_ended_at
       FROM device_execution_contexts c JOIN device_execution_context_key_evidence e USING(account_id,workspace_id,context_digest)
       JOIN device_bindings b ON b.account_id=c.account_id AND b.device_id=c.source_device_id
       JOIN device_signing_keys k ON k.account_id=c.account_id AND k.device_id=c.source_device_id AND k.key_version=c.signing_key_version
       CROSS JOIN LATERAL identity_private.read_execution_security_epoch_end(c.account_security_epoch) s
       WHERE c.account_id=$1 AND c.workspace_id=$2 AND c.source_device_id=$3 AND c.context_digest=$4
       AND c.source_device_id=identity_private.current_execution_context_device() FOR SHARE OF b,k`,
      [
        transaction.accountId,
        input.workspaceId,
        input.sourceDeviceId,
        Buffer.from(input.trustedTimeAnchorId, "base64url"),
      ],
    );
    if (rows.rows.length !== 1) return { found: false, reason: "epoch_unknown" };
    const parsed = parseRow(rows.rows[0]);
    if (parsed === null) return { found: false, reason: "authorization" };
    const row = parsed,
      c = row.signed_context,
      g = row.signed_grant,
      l = g.activeDeviceLease;
    try {
      const cb = Buffer.from(encodeDesktopExecutionContextEnvelope(c)),
        gb = Buffer.from(encodeDesktopExecutionAuthorizationDigestInput(g));
      if (
        row.device_public_key.length !== 32 ||
        !cb.equals(row.canonical_context_envelope) ||
        !gb.equals(row.canonical_grant_envelope) ||
        !hash(cb).equals(row.context_digest) ||
        !hash(gb).equals(row.authorization_grant_digest) ||
        hash(cb).toString("base64url") !== input.trustedTimeAnchorId ||
        hash(gb).toString("base64url") !== c.authorizationGrantDigest ||
        c.accountId !== transaction.accountId ||
        c.workspaceId !== input.workspaceId ||
        c.deviceId !== input.sourceDeviceId ||
        g.workspace.workspaceId !== c.workspaceId ||
        l.accountId !== c.accountId ||
        l.deviceId !== c.deviceId ||
        l.accountSecurityEpoch !== c.accountSecurityEpoch ||
        l.payload.leaseEpoch !== c.activeLeaseEpoch ||
        row.lease_key_id !== l.kid ||
        row.grant_key_id !== g.kid ||
        row.context_key_id !== c.kid ||
        new Set([row.lease_key_id, row.grant_key_id, row.context_key_id]).size !== 3 ||
        new Set(
          [row.lease_public_key, row.grant_public_key, row.context_public_key].map((b) => b.toString("hex")),
        ).size !== 3 ||
        !validSignature(encodeActiveDeviceLeaseSignatureTranscript(l), l.signature, row.lease_public_key) ||
        !validSignature(
          encodeDesktopAuthorizationGrantSignatureTranscript(g),
          g.signature,
          row.grant_public_key,
        ) ||
        !validSignature(
          encodeDesktopExecutionContextSignatureTranscript(c),
          c.signature,
          row.context_public_key,
        )
      )
        return { found: false, reason: "authorization" };
      const devicePublicKey = createPublicKey({
        format: "der",
        type: "spki",
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), row.device_public_key]),
      });
      let failure: HistoricalExecutionAuthorityFailure | null = null;
      if (
        c.activeLeaseEpoch !== input.activeLeaseEpoch ||
        c.credentialEpoch !== input.credentialEpoch ||
        c.signingKeyId !== input.signingKeyId ||
        c.signingKeyVersion !== input.signingKeyVersion ||
        c.authorizationGrantDigest !== input.authorizationHash ||
        !row.security_proven ||
        !g.scopes.includes("workspace:mutate") ||
        !g.commercialAuthority.capabilities.includes("afternic:marketplace:write") ||
        g.commercialAuthority.state !== "active"
      )
        failure = "authorization";
      const observed = Date.parse(c.serverObservedAt),
        occurred = Date.parse(input.occurredAt);
      const sum = observed + 1000 + input.monotonicDeltaMs;
      const expected = Math.ceil(sum / 1000) * 1000;
      const deadline = Math.min(
        Date.parse(g.expiresAt),
        Date.parse(l.payload.offlineExecuteUntil),
        Date.parse(g.commercialAuthority.commercialExpiresAt),
      );
      if (
        !Number.isSafeInteger(sum) ||
        !Number.isSafeInteger(expected) ||
        occurred !== expected ||
        Date.parse(g.issuedAt) > observed ||
        Date.parse(l.issuedAt) > observed ||
        Date.parse(c.expiresAt) !== deadline ||
        occurred >= deadline ||
        occurred <= observed
      )
        failure = "time_unprovable";
      if (row.security_ended_at !== null && occurred >= row.security_ended_at.getTime())
        failure = "authorization";
      if (
        (row.binding_status === "removed" && row.removed_at === null) ||
        (row.key_status !== "active" && row.retired_at === null) ||
        (row.removed_at !== null && occurred >= row.removed_at.getTime()) ||
        (row.retired_at !== null && occurred >= row.retired_at.getTime())
      )
        failure = "removal_boundary";
      return { found: true, context: c, devicePublicKey, authorizationFailure: failure };
    } catch {
      return { found: false, reason: "authorization" };
    }
  }
}
function hash(v: Uint8Array): Buffer {
  return createHash("sha256").update(v).digest();
}
function validSignature(bytes: Uint8Array, signature: string, spki: Buffer): boolean {
  if (spki.length !== 44 || spki.subarray(0, 12).toString("hex") !== "302a300506032b6570032100") return false;
  return verify(
    null,
    bytes,
    createPublicKey({ format: "der", type: "spki", key: spki }),
    Buffer.from(signature, "base64url"),
  );
}
