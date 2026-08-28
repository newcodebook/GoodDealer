import type { TenantTransaction } from "../../db/index";

import {
  persistedServerAuditEventSchema,
  type PersistedServerAuditEvent,
} from "@gooddealer/protocol/audit";

import type { ServerAuditAppendJournal } from "./server-audit";

type QuarantineRejectionCode = Parameters<
  ServerAuditAppendJournal["quarantineTrustedRejection"]
>[0]["rejectionCode"];

/**
 * Catalog-integrated M013 adapter. It accepts the transaction object already sealed into an audit
 * context; it never opens a scope, accepts a caller's selector, or exposes direct table DML.
 * Account/global emission remains unavailable until its separate audit-private transaction
 * authority exists, so this adapter fails closed for those contexts.
 */
export class PostgresServerAuditJournal implements ServerAuditAppendJournal {
  async readCommittedByAuditEventId(transactionValue: object, auditEventId: string) {
    const transaction = tenantTransaction(transactionValue);
    const result = await transaction.query<StoredAuditRow>(
      `SELECT audit_event_id, audit_event_kind, event_type, target_type, target_ref, actor_id,
              chain_id, audit_sequence::text, previous_hash, event_hash,
              to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at,
              authorization_context_hash, cryptographic_signer_kind, cryptographic_signer_id,
              signing_key_id, signing_key_version::text, signature_transcript_version::text,
              server_signature, signing_key_transition_id, actor_kind, authorization_source,
              signing_key_purpose, payload_redacted, tenant_scope, account_id, workspace_id,
              canonical_evidence
       FROM public.server_audit_entries
       WHERE account_id = $1 AND workspace_id = $2 AND audit_event_id = $3
       ORDER BY audit_sequence
       LIMIT 1`,
      [transaction.scope.accountId, transaction.scope.workspaceId, auditEventId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { record: parseStoredRecord(row), canonicalEvidence: Buffer.from(row.canonical_evidence) };
  }

  async prepareAppend(input: Parameters<ServerAuditAppendJournal["prepareAppend"]>[0]) {
    const transaction = tenantTransaction(input.transaction);
    const result = await transaction.query<PreparedAppendRow>(
      `SELECT chain_id, audit_sequence::text, previous_hash,
              to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at
       FROM public.audit_prepare_server_audit_append($1::bytea)`,
      [Buffer.from(input.chainId, "base64url")],
    );
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("server audit append preparation is unavailable");
    return {
      chainId: Buffer.from(row.chain_id).toString("base64url"),
      auditSequence: parsePositiveInteger(row.audit_sequence, "prepared audit sequence"),
      previousHash: Buffer.from(row.previous_hash).toString("base64url"),
      occurredAt: row.occurred_at,
    };
  }

  async appendCanonical(input: Parameters<ServerAuditAppendJournal["appendCanonical"]>[0]) {
    const transaction = tenantTransaction(input.transaction);
    const record = input.entry.record;
    const expectedSequence = input.prepared.auditSequence - 1;
    const expectedHash = input.prepared.auditSequence === 1 ? null : input.prepared.previousHash;
    const functionName = appendRoutine(record.auditEventKind);
    const result = await transaction.query<{ status: "appended" | "exact" | "conflict" }>(
      `SELECT public.${functionName}($1::jsonb, $2::bytea, $3::bigint, $4::bytea) AS status`,
      [
        JSON.stringify(record),
        Buffer.from(input.entry.canonicalEvidence),
        expectedSequence,
        expectedHash === null ? null : Buffer.from(expectedHash, "base64url"),
      ],
    );
    const status = result.rows[0]?.status;
    if (status === "appended" || status === "exact") return { status, entry: input.entry };
    return { status: "conflict" as const };
  }

  async inspectIncomingSignerUse(input: Parameters<ServerAuditAppendJournal["inspectIncomingSignerUse"]>[0]) {
    const transaction = tenantTransaction(input.transaction);
    const result = await transaction.query<{ has_prior_use: boolean; first_transition_id: string | null }>(
      `SELECT EXISTS(
           SELECT 1
           FROM public.server_audit_entries
           WHERE account_id = $1 AND workspace_id = $2 AND chain_id = $3
             AND signing_key_purpose = $4 AND signing_key_id = $5 AND signing_key_version = $6
         ) AS has_prior_use,
         (
           SELECT signing_key_transition_id
           FROM public.server_audit_entries
           WHERE account_id = $1 AND workspace_id = $2 AND chain_id = $3
             AND signing_key_purpose = $4 AND signing_key_id = $5 AND signing_key_version = $6
             AND signing_key_transition_id IS NOT NULL
           ORDER BY audit_sequence
           LIMIT 1
         ) AS first_transition_id`,
      [
        transaction.scope.accountId,
        transaction.scope.workspaceId,
        input.chainId,
        input.signingKeyPurpose,
        input.signingKeyId,
        input.signingKeyVersion,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("audit signer-use inspection is unavailable");
    return { hasPriorUse: row.has_prior_use, firstTransitionId: row.first_transition_id };
  }

  /**
   * Calls the catalog-integrated M013 digest-only routine in the context-bound tenant transaction.
   * This is intentionally not autonomous: a caller's later transaction rollback can also roll this
   * quarantine record back, so it must not be described as durable rejection persistence.
   */
  async quarantineTrustedRejection(input: Parameters<ServerAuditAppendJournal["quarantineTrustedRejection"]>[0]) {
    const transaction = tenantTransaction(input.transaction);
    const result = await transaction.query<{ quarantined: boolean }>(
      "SELECT public.audit_quarantine_server_entry($1::bytea, $2::text) AS quarantined",
      [decodeRejectionDigest(input.rejectionDigest), parseRejectionCode(input.rejectionCode)],
    );
    if (result.rows[0] === undefined || typeof result.rows[0].quarantined !== "boolean") {
      throw new TypeError("server audit quarantine is unavailable");
    }
  }
}

interface StoredAuditRow {
  readonly audit_event_id: string;
  readonly audit_event_kind: string;
  readonly event_type: string;
  readonly target_type: string;
  readonly target_ref: string;
  readonly actor_id: string;
  readonly chain_id: Buffer;
  readonly audit_sequence: string;
  readonly previous_hash: Buffer;
  readonly event_hash: Buffer;
  readonly occurred_at: string;
  readonly authorization_context_hash: Buffer;
  readonly cryptographic_signer_kind: string;
  readonly cryptographic_signer_id: string;
  readonly signing_key_id: string;
  readonly signing_key_version: string;
  readonly signature_transcript_version: string;
  readonly server_signature: Buffer;
  readonly signing_key_transition_id: string | null;
  readonly actor_kind: string;
  readonly authorization_source: string;
  readonly signing_key_purpose: string;
  readonly payload_redacted: unknown;
  readonly tenant_scope: string;
  readonly account_id: string | null;
  readonly workspace_id: string | null;
  readonly canonical_evidence: Buffer;
}

interface PreparedAppendRow {
  readonly chain_id: Buffer;
  readonly audit_sequence: string;
  readonly previous_hash: Buffer;
  readonly occurred_at: string;
}

function parseStoredRecord(row: StoredAuditRow): PersistedServerAuditEvent {
  const result = persistedServerAuditEventSchema.safeParse({
    schemaVersion: 1,
    auditEventId: row.audit_event_id,
    auditEventKind: row.audit_event_kind,
    eventType: row.event_type,
    targetType: row.target_type,
    targetRef: row.target_ref,
    actorId: row.actor_id,
    chainId: Buffer.from(row.chain_id).toString("base64url"),
    auditSequence: parsePositiveInteger(row.audit_sequence, "stored audit sequence"),
    previousHash: Buffer.from(row.previous_hash).toString("base64url"),
    eventHash: Buffer.from(row.event_hash).toString("base64url"),
    occurredAt: row.occurred_at,
    authorizationContextHash: Buffer.from(row.authorization_context_hash).toString("base64url"),
    cryptographicSignerKind: row.cryptographic_signer_kind,
    cryptographicSignerId: row.cryptographic_signer_id,
    signingKeyId: row.signing_key_id,
    signingKeyVersion: parsePositiveInteger(row.signing_key_version, "stored signing key version"),
    signatureTranscriptVersion: parsePositiveInteger(row.signature_transcript_version, "stored signature transcript version"),
    serverSignature: Buffer.from(row.server_signature).toString("base64url"),
    signing_key_transition_id: row.signing_key_transition_id,
    actorKind: row.actor_kind,
    authorizationSource: row.authorization_source,
    signingKeyPurpose: row.signing_key_purpose,
    payloadRedacted: row.payload_redacted,
    tenantScope: row.tenant_scope,
    accountId: row.account_id,
    workspaceId: row.workspace_id,
  });
  if (!result.success) throw new TypeError("stored audit record is invalid");
  return result.data;
}

function appendRoutine(kind: PersistedServerAuditEvent["auditEventKind"]): string {
  switch (kind) {
    case "user": return "audit_append_server_user_entry";
    case "staff": return "audit_append_server_staff_entry";
    case "service": return "audit_append_server_service_entry";
  }
}

function tenantTransaction(value: object): TenantTransaction {
  const candidate = value as Partial<TenantTransaction>;
  if (
    typeof candidate.query !== "function"
    || typeof candidate.scope !== "object"
    || candidate.scope === null
    || typeof candidate.scope.accountId !== "string"
    || typeof candidate.scope.workspaceId !== "string"
  ) throw new TypeError("server audit transaction authority is unavailable");
  return candidate as TenantTransaction;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function decodeRejectionDigest(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new TypeError("server audit quarantine digest is invalid");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) {
    throw new TypeError("server audit quarantine digest is invalid");
  }
  return decoded;
}

function parseRejectionCode(value: QuarantineRejectionCode): QuarantineRejectionCode {
  if (
    value !== "schema_invalid"
    && value !== "canonical_conflict"
    && value !== "transition_invalid"
    && value !== "signer_invalid"
    && value !== "append_conflict"
  ) throw new TypeError("server audit quarantine code is invalid");
  return value;
}
