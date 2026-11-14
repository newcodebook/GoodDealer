import { createHash } from "node:crypto";

import { encodeDrainStreamEnvelope, encodeLegacyV2MutationDrainEnvelope } from "@gooddealer/protocol/execution-events";
import {
  WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION,
  encodeLegacyV2SubmittedSyncMutationDigestInput,
  encodeSubmittedSyncMutationDigestInput,
  submittedSyncMutationSchema,
  syncMutationSchema,
  serverRevisionSchema,
  type SubmittedSyncMutation,
  type SyncMutation,
} from "@gooddealer/protocol/workspace";
import { identifier, safePositiveInteger } from "@gooddealer/protocol/wire";

import type { TenantTransaction } from "../../../db/index";
import { isFirstGenerationMutation } from "./generation-rule";
import type { MutationWriter } from "./stale-field-rule";

const lockedDomainBrand: unique symbol = Symbol("locked mutation drain domain");

export interface LockedMutationDrainDomain {
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly contiguousReceivedThrough: number;
  readonly highestReceivedSequence: number;
  readonly rollingDigest: string;
  readonly [lockedDomainBrand]: true;
}

export interface AssignedMutation {
  readonly mutation: unknown;
  readonly serverRevision: number;
}

export type MutationPersistenceFaultPoint =
  | "after_drain_append"
  | "after_receipt_insert"
  | "after_log_insert"
  | "after_rejection_record";

export interface MutationReceipt {
  readonly mutationId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly deviceMutationSequence: number;
  readonly serverRevision: number;
  readonly submittedEnvelopeDigest: string;
}

/** ADR-0030 business rejections Cloud records durably; every other rejection leaves no receipt. */
export const RECORDED_MUTATION_REJECTION_CODES = ["MUTATION_FIELD_STALE", "MUTATION_ENTITY_UNKNOWN"] as const;
export type RecordedMutationRejectionCode = (typeof RECORDED_MUTATION_REJECTION_CODES)[number];

export interface RejectedMutationReceipt {
  readonly mutationId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly deviceMutationSequence: number;
  readonly submittedEnvelopeDigest: string;
  readonly rejectionCode: RecordedMutationRejectionCode;
}

export type StoredMutationReceipt =
  | ({ readonly outcome: "accepted" } & MutationReceipt)
  | ({ readonly outcome: "rejected" } & RejectedMutationReceipt);

export type MutationReceiptResolution =
  | { readonly status: "missing" }
  | { readonly status: "exact"; readonly receipt: MutationReceipt }
  | { readonly status: "rejected"; readonly receipt: RejectedMutationReceipt }
  | { readonly status: "mutation_id_conflict"; readonly receipt: StoredMutationReceipt }
  | { readonly status: "sequence_conflict"; readonly receipt: StoredMutationReceipt };

interface ReceiptRow {
  mutation_id: string;
  source_device_id: string;
  active_lease_epoch: string;
  device_mutation_sequence: string;
  server_revision: string | null;
  submitted_envelope_digest: Buffer;
  outcome: string;
  rejection_code: string | null;
}

interface SequenceLedgerRow extends ReceiptRow {
  wire_schema_version: number;
  wire_mutation_digest: Buffer;
}

interface MutationHeaderRow {
  server_revision: string;
  mutation_id: string;
  workspace_schema_version: string;
  entity_type: string;
  entity_id: string;
  operation_kind: string;
  deleted_at: string | null;
  base_server_revision: string;
  source_device_id: string;
  active_lease_epoch: string;
  device_mutation_sequence: string;
  canonical_submitted_envelope: Buffer;
  submitted_envelope_digest: Buffer;
}

interface MutationFieldRow {
  server_revision: string;
  ordinal: number;
  field_path: string;
  value_is_null: boolean;
  text_value: string | null;
  tags_value: string[] | null;
  target_price_currency: string | null;
  target_price_amount: string | null;
}

/**
 * Transaction-aware persistence only. The caller owns transaction scope and lock ordering;
 * this repository never opens a transaction or authorizes a Lease.
 */
export class PostgresWorkspaceMutationRepository {
  readonly #locks = new WeakMap<TenantTransaction, Set<LockedMutationDrainDomain>>();

  async lockDrainDomain(transaction: TenantTransaction, value: unknown): Promise<LockedMutationDrainDomain> {
    const domain = parseDrainDomain(value);
    const handle: LockedMutationDrainDomain = {
      ...domain,
      // Epoch-scoped drain rows remain historical evidence. Sync v2 serializes and advances only
      // the global per-device sequence head below.
      contiguousReceivedThrough: 0,
      highestReceivedSequence: 0,
      rollingDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      [lockedDomainBrand]: true,
    };
    await transaction.query(
      `INSERT INTO workspace_device_mutation_heads
         (account_id, workspace_id, source_device_id,
          contiguous_received_through, highest_received_sequence, row_version)
       VALUES ($1, $2, $3, 0, 0, 1)
       ON CONFLICT (account_id, workspace_id, source_device_id) DO NOTHING`,
      [transaction.scope.accountId, transaction.scope.workspaceId, domain.sourceDeviceId],
    );
    const globalHead = await transaction.query(
      `SELECT contiguous_received_through
       FROM workspace_device_mutation_heads
       WHERE account_id=$1 AND workspace_id=$2 AND source_device_id=$3
       FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId, domain.sourceDeviceId],
    );
    if (globalHead.rowCount !== 1) throw new TypeError("global mutation sequence head is unavailable");
    const locks = this.#locks.get(transaction) ?? new Set();
    locks.add(handle);
    this.#locks.set(transaction, locks);
    return handle;
  }

  async resolveReceipt(
    transaction: TenantTransaction,
    lock: LockedMutationDrainDomain,
    value: unknown,
  ): Promise<MutationReceiptResolution> {
    this.#assertLock(transaction, lock);
    const mutation = submittedSyncMutationSchema.parse(value);
    assertMutationDomain(transaction, lock, mutation);
    // The Drain head already serializes this source/lease domain. Receipts are
    // insert-only, and a row lock cannot protect a receipt that does not exist yet.
    const result = await transaction.query<SequenceLedgerRow>(
      `SELECT mutation_id, source_device_id, active_lease_epoch, device_mutation_sequence,
              server_revision, wire_schema_version, wire_mutation_digest,
              wire_mutation_digest AS submitted_envelope_digest, outcome, rejection_code
       FROM workspace_device_mutation_sequence_ledger
       WHERE account_id = $1 AND workspace_id = $2
         AND (mutation_id = $3 OR
           (source_device_id = $4 AND device_mutation_sequence = $5))
       ORDER BY mutation_id COLLATE "C"`,
      [transaction.scope.accountId, transaction.scope.workspaceId, mutation.mutationId,
        mutation.sourceDeviceId, mutation.deviceMutationSequence],
    );
    const receipts = result.rows.map(parseReceipt);
    const byId = receipts.find((receipt) => receipt.mutationId === mutation.mutationId);
    const bySequence = receipts.find((receipt) =>
      receipt.sourceDeviceId === mutation.sourceDeviceId &&
      receipt.deviceMutationSequence === mutation.deviceMutationSequence);
    if (byId !== undefined) {
      // A receipt is compared at the wire version it was stored under (ADR-0029 C1a): replaying a
      // mutation Cloud accepted under v2 must still resolve to that receipt after the upgrade.
      const storedVersion = result.rows.find((row) => row.mutation_id === mutation.mutationId)?.wire_schema_version;
      if (byId.submittedEnvelopeDigest !== wireDigestAt(mutation, storedVersion)) {
        return { status: "mutation_id_conflict", receipt: byId };
      }
      if (bySequence === undefined || bySequence.mutationId !== mutation.mutationId) {
        return { status: "sequence_conflict", receipt: bySequence ?? byId };
      }
      // Replay resolves the stored result before any business re-evaluation, so a recorded
      // rejection can never turn into an acceptance when replica conditions later change.
      if (byId.outcome === "rejected") {
        const { outcome: _outcome, ...receipt } = byId;
        return { status: "rejected", receipt };
      }
      const { outcome: _outcome, ...receipt } = byId;
      return { status: "exact", receipt };
    }
    if (bySequence !== undefined) return { status: "sequence_conflict", receipt: bySequence };
    return { status: "missing" };
  }

  /**
   * ADR-0030: durably end one device sequence with a business rejection. The caller has already
   * validated identity, Lease, wire, schema and receipt identity, holds the global device head
   * lock, and commits this in the same tenant transaction as its rejection decision. Nothing is
   * materialized and no server revision is allocated.
   */
  async appendRejected(
    transaction: TenantTransaction,
    lock: LockedMutationDrainDomain,
    value: unknown,
    code: RecordedMutationRejectionCode,
    fault?: (point: MutationPersistenceFaultPoint) => void,
  ): Promise<void> {
    this.#assertLock(transaction, lock);
    if (!RECORDED_MUTATION_REJECTION_CODES.includes(code)) throw new TypeError("rejection code is not recordable");
    const mutation = submittedSyncMutationSchema.parse(value);
    assertMutationDomain(transaction, lock, mutation);
    const envelope = Buffer.from(encodeDrainStreamEnvelope("mutation", mutation));
    if (envelope.length > 65_536) throw new TypeError("canonical submitted mutation is oversized");
    // Pass the same definer routine as the accepted path: it re-asserts that the submission's
    // epoch is the device's current active, activated Lease domain and reports a seal. A sealed
    // drain domain is final, so a later rejection must not extend its evidence.
    const domain = await transaction.query<{ sealed: boolean }>(
      `SELECT sealed FROM public.workspace_mutation_drain_lock_domain($1::text, $2::bigint)`,
      [mutation.sourceDeviceId, mutation.activeLeaseEpoch],
    );
    if (domain.rows.length !== 1 || domain.rows[0]?.sealed !== false) {
      throw new TypeError("mutation drain domain is sealed");
    }
    await transaction.query(
      `INSERT INTO workspace_device_mutation_sequence_ledger (
         account_id, workspace_id, source_device_id, device_mutation_sequence,
         mutation_id, active_lease_epoch, wire_schema_version, wire_mutation_digest,
         outcome, rejection_code, rejected_at, rejected_envelope_digest
       ) VALUES ($1,$2,$3,$4,$5,$6,3,$7,'rejected',$8,transaction_timestamp(),$9)`,
      [transaction.scope.accountId, transaction.scope.workspaceId, mutation.sourceDeviceId,
        mutation.deviceMutationSequence, mutation.mutationId, mutation.activeLeaseEpoch,
        wireDigest(mutation), code, digestEnvelope(envelope)],
    );
    fault?.("after_rejection_record");
    await advanceGlobalHead(transaction, mutation);
  }

  async appendAccepted(
    transaction: TenantTransaction,
    lock: LockedMutationDrainDomain,
    values: readonly AssignedMutation[],
    fault?: (point: MutationPersistenceFaultPoint) => void,
  ): Promise<void> {
    this.#assertLock(transaction, lock);
    if (values.length < 1 || values.length > 256) throw new TypeError("accepted mutation batch size is invalid");
    const assigned = values.map(({ mutation, serverRevision }) => ({
      mutation: submittedSyncMutationSchema.parse(mutation),
      serverRevision: positiveRevision(serverRevision),
    }));
    for (const entry of assigned) assertMutationDomain(transaction, lock, entry.mutation);
    for (let index = 1; index < assigned.length; index += 1) {
      if (assigned[index - 1]!.mutation.deviceMutationSequence >= assigned[index]!.mutation.deviceMutationSequence) {
        throw new TypeError("accepted mutation sequences must be strictly increasing");
      }
      if (assigned[index - 1]!.serverRevision + 1 !== assigned[index]!.serverRevision) {
        throw new TypeError("accepted server revisions must be dense");
      }
    }

    for (const { mutation, serverRevision } of assigned) {
      const envelope = Buffer.from(encodeDrainStreamEnvelope("mutation", mutation));
      if (envelope.length > 65_536) throw new TypeError("canonical submitted mutation is oversized");
      const digest = digestEnvelope(envelope);
      // Keep the epoch-scoped drain chain as immutable historical evidence. The v2
      // sequence ledger below is the authority for global ordering and replay.
      const drainAppend = await transaction.query<{ envelope_digest: Buffer }>(
        `SELECT public.workspace_mutation_drain_append_record(
           $1::text, $2::bigint, $3::bigint, $4::bytea
         ) AS envelope_digest`,
        [mutation.sourceDeviceId, mutation.activeLeaseEpoch, mutation.deviceMutationSequence, envelope],
      );
      const landed = drainAppend.rows[0];
      if (drainAppend.rows.length !== 1 || landed === undefined || !landed.envelope_digest.equals(digest)) {
        throw new TypeError("mutation sequence conflicts with the immutable drain record");
      }
      fault?.("after_drain_append");
      await transaction.query(
        `INSERT INTO workspace_mutation_receipts (
           account_id, workspace_id, mutation_id, source_device_id, active_lease_epoch,
           device_mutation_sequence, server_revision, submitted_envelope_digest
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [transaction.scope.accountId, transaction.scope.workspaceId, mutation.mutationId,
          mutation.sourceDeviceId, mutation.activeLeaseEpoch, mutation.deviceMutationSequence,
          serverRevision, digest],
      );
      await transaction.query(
        `INSERT INTO workspace_device_mutation_sequence_ledger (
           account_id, workspace_id, source_device_id, device_mutation_sequence,
           mutation_id, active_lease_epoch, wire_schema_version, wire_mutation_digest,
           server_revision, accepted_at, outcome
         ) VALUES ($1,$2,$3,$4,$5,$6,3,$7,$8,transaction_timestamp(),'accepted')`,
        [transaction.scope.accountId, transaction.scope.workspaceId, mutation.sourceDeviceId,
          mutation.deviceMutationSequence, mutation.mutationId, mutation.activeLeaseEpoch,
          wireDigest(mutation), serverRevision],
      );
      await advanceGlobalHead(transaction, mutation);
      fault?.("after_receipt_insert");
      await transaction.query(
        `INSERT INTO workspace_mutations (
           account_id, workspace_id, server_revision, mutation_id, workspace_schema_version,
           entity_type, entity_id, operation_kind, deleted_at, base_server_revision,
           source_device_id, active_lease_epoch,
           device_mutation_sequence, canonical_submitted_envelope, submitted_envelope_digest
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [transaction.scope.accountId, transaction.scope.workspaceId, serverRevision, mutation.mutationId,
          mutation.workspaceSchemaVersion, mutation.entityType, mutation.entityId,
          mutation.operationKind ?? "upsert", mutation.deletedAt ?? null, mutation.baseServerRevision,
          mutation.sourceDeviceId, mutation.activeLeaseEpoch, mutation.deviceMutationSequence, envelope, digest],
      );
      for (const [ordinal, field] of mutation.changedFields.entries()) {
        const columns = encodeField(field);
        await transaction.query(
          `INSERT INTO workspace_mutation_fields (
             account_id, workspace_id, server_revision, ordinal, field_path, value_is_null,
             text_value, tags_value, target_price_currency, target_price_amount
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [transaction.scope.accountId, transaction.scope.workspaceId, serverRevision, ordinal,
            field.fieldPath, columns.valueIsNull, columns.textValue, columns.tagsValue,
            columns.currency, columns.amount],
        );
      }
      fault?.("after_log_insert");
    }
  }

  async readRange(
    transaction: TenantTransaction,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): Promise<readonly SyncMutation[]> {
    const from = serverRevisionSchema.parse(fromServerRevisionExclusive);
    const through = serverRevisionSchema.parse(throughServerRevisionInclusive);
    if (through < from) throw new TypeError("mutation range is inverted");
    const headers = await transaction.query<MutationHeaderRow>(
      `SELECT server_revision, mutation_id, workspace_schema_version, entity_type, entity_id,
              operation_kind,
              CASE WHEN deleted_at IS NULL THEN NULL
                   ELSE to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS deleted_at,
              base_server_revision, source_device_id, active_lease_epoch, device_mutation_sequence,
              canonical_submitted_envelope, submitted_envelope_digest
       FROM workspace_mutations
       WHERE account_id = $1 AND workspace_id = $2
         AND server_revision > $3 AND server_revision <= $4
       ORDER BY server_revision`,
      [transaction.scope.accountId, transaction.scope.workspaceId, from, through],
    );
    const fields = await transaction.query<MutationFieldRow>(
      `SELECT server_revision, ordinal, field_path, value_is_null, text_value, tags_value,
              target_price_currency, target_price_amount
       FROM workspace_mutation_fields
       WHERE account_id = $1 AND workspace_id = $2
         AND server_revision > $3 AND server_revision <= $4
       ORDER BY server_revision, ordinal`,
      [transaction.scope.accountId, transaction.scope.workspaceId, from, through],
    );
    const fieldsByRevision = new Map<number, MutationFieldRow[]>();
    for (const field of fields.rows) {
      const revision = positiveRevision(parseUnsignedInteger(field.server_revision, "stored field revision"));
      const rows = fieldsByRevision.get(revision) ?? [];
      rows.push(field);
      fieldsByRevision.set(revision, rows);
    }
    return headers.rows.map((header) => parseStoredMutation(transaction, header, fieldsByRevision));
  }

  /**
   * The writers of the given accepted revisions. A revision whose replay row was compacted is
   * absent from the result, and callers must treat an absent writer as unknown.
   */
  async readWriters(
    transaction: TenantTransaction,
    values: readonly number[],
  ): Promise<ReadonlyMap<number, MutationWriter>> {
    const serverRevisions = [...new Set(values.map((value) => positiveRevision(serverRevisionSchema.parse(value))))];
    if (serverRevisions.length === 0) return new Map();
    const result = await transaction.query<{
      server_revision: unknown; source_device_id: unknown; active_lease_epoch: unknown;
      device_mutation_sequence: unknown; base_server_revision: unknown;
    }>(
      `SELECT server_revision::text AS server_revision, source_device_id,
              active_lease_epoch::text AS active_lease_epoch,
              device_mutation_sequence::text AS device_mutation_sequence,
              base_server_revision::text AS base_server_revision
       FROM workspace_mutations
       WHERE account_id = $1 AND workspace_id = $2 AND server_revision = ANY($3::bigint[])`,
      [transaction.scope.accountId, transaction.scope.workspaceId, serverRevisions],
    );
    return new Map(result.rows.map((row) => [
      positiveRevision(parseUnsignedInteger(storedText(row.server_revision), "stored writer revision")),
      {
        sourceDeviceId: identifier.parse(row.source_device_id),
        activeLeaseEpoch: safePositiveInteger.parse(parseUnsignedInteger(storedText(row.active_lease_epoch), "stored writer epoch")),
        deviceMutationSequence: safePositiveInteger.parse(
          parseUnsignedInteger(storedText(row.device_mutation_sequence), "stored writer sequence")),
        baseServerRevision: serverRevisionSchema.parse(parseUnsignedInteger(storedText(row.base_server_revision), "stored writer base")),
      },
    ]));
  }

  async hasCompleteRange(
    transaction: TenantTransaction,
    fromServerRevisionExclusive: number,
    throughServerRevisionInclusive: number,
  ): Promise<boolean> {
    const from = serverRevisionSchema.parse(fromServerRevisionExclusive);
    const through = serverRevisionSchema.parse(throughServerRevisionInclusive);
    if (through < from) return false;
    try {
      const mutations = await this.readRange(transaction, from, through);
      return mutations.length === through - from &&
        mutations.every((mutation, index) => mutation.serverRevision === from + index + 1);
    } catch {
      return false;
    }
  }

  async compactPrefix(transaction: TenantTransaction, throughServerRevisionInclusive: number): Promise<number> {
    const through = serverRevisionSchema.parse(throughServerRevisionInclusive);
    const result = await transaction.query<{ deleted_count: string }>(
      `SELECT public.workspace_compaction_delete_prefix($1::bigint)::text AS deleted_count`,
      [through],
    );
    const deleted = result.rows[0]?.deleted_count;
    if (deleted === undefined) throw new TypeError("workspace compaction deletion result is unavailable");
    return parseUnsignedInteger(deleted, "deleted mutation count");
  }

  #assertLock(transaction: TenantTransaction, lock: LockedMutationDrainDomain): void {
    if (lock[lockedDomainBrand] !== true || this.#locks.get(transaction)?.has(lock) !== true) {
      throw new TypeError("mutation drain lock does not belong to this transaction");
    }
  }

}

function parseDrainDomain(value: unknown): { readonly sourceDeviceId: string; readonly activeLeaseEpoch: number } {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== 2 ||
    !Object.hasOwn(value, "sourceDeviceId") || !Object.hasOwn(value, "activeLeaseEpoch")) {
    throw new TypeError("mutation drain domain is malformed");
  }
  return {
    sourceDeviceId: identifier.parse(value.sourceDeviceId),
    activeLeaseEpoch: safePositiveInteger.parse(value.activeLeaseEpoch),
  };
}

function assertMutationDomain(
  transaction: TenantTransaction,
  lock: LockedMutationDrainDomain,
  mutation: SubmittedSyncMutation,
): void {
  if (mutation.workspaceId !== transaction.scope.workspaceId || mutation.sourceDeviceId !== lock.sourceDeviceId ||
    mutation.activeLeaseEpoch !== lock.activeLeaseEpoch) {
    throw new TypeError("mutation does not belong to the locked tenant drain domain");
  }
}

function parseReceipt(row: ReceiptRow): StoredMutationReceipt {
  const common = {
    mutationId: identifier.parse(row.mutation_id),
    sourceDeviceId: identifier.parse(row.source_device_id),
    activeLeaseEpoch: positiveRevision(parseUnsignedInteger(row.active_lease_epoch, "stored receipt epoch")),
    deviceMutationSequence: positiveRevision(parseUnsignedInteger(row.device_mutation_sequence, "stored receipt sequence")),
    submittedEnvelopeDigest: parseDigest(row.submitted_envelope_digest, "stored receipt digest"),
  };
  // The database CHECK keeps the branches exclusive; re-check so a drifted row fails closed.
  if (row.outcome === "accepted" && row.server_revision !== null && row.rejection_code === null) {
    return {
      outcome: "accepted",
      ...common,
      serverRevision: positiveRevision(parseUnsignedInteger(row.server_revision, "stored receipt revision")),
    };
  }
  const code = RECORDED_MUTATION_REJECTION_CODES.find((candidate) => candidate === row.rejection_code);
  if (row.outcome === "rejected" && row.server_revision === null && code !== undefined) {
    return { outcome: "rejected", ...common, rejectionCode: code };
  }
  throw new TypeError("stored mutation receipt outcome is invalid");
}
/** Both outcomes occupy the global device sequence, so the contiguous head counts either one. */
async function advanceGlobalHead(transaction: TenantTransaction, mutation: SubmittedSyncMutation): Promise<void> {
  const head = await transaction.query<{ contiguous_received_through: string }>(
    `WITH RECURSIVE contiguous(sequence) AS (
       SELECT contiguous_received_through
       FROM workspace_device_mutation_heads
       WHERE account_id=$1 AND workspace_id=$2 AND source_device_id=$3
       UNION ALL
       SELECT contiguous.sequence + 1
       FROM contiguous
       WHERE EXISTS (
         SELECT 1
         FROM workspace_device_mutation_sequence_ledger AS ledger
         WHERE ledger.account_id=$1 AND ledger.workspace_id=$2
           AND ledger.source_device_id=$3
           AND ledger.device_mutation_sequence=contiguous.sequence + 1
       )
     )
     UPDATE workspace_device_mutation_heads
     SET contiguous_received_through=(SELECT max(sequence) FROM contiguous),
         highest_received_sequence=greatest(highest_received_sequence, $4),
         row_version=row_version+1, updated_at=transaction_timestamp()
     WHERE account_id=$1 AND workspace_id=$2 AND source_device_id=$3
     RETURNING contiguous_received_through`,
    [transaction.scope.accountId, transaction.scope.workspaceId,
      mutation.sourceDeviceId, mutation.deviceMutationSequence],
  );
  if (head.rowCount !== 1) throw new TypeError("global mutation sequence head is unavailable");
}

function parseStoredMutation(
  transaction: TenantTransaction,
  header: MutationHeaderRow,
  fieldsByRevision: ReadonlyMap<number, readonly MutationFieldRow[]>,
): SyncMutation {
  const serverRevision = positiveRevision(parseUnsignedInteger(header.server_revision, "stored mutation revision"));
  const rows = fieldsByRevision.get(serverRevision) ?? [];
  const changedFields = rows.map((row, ordinal) => {
    if (row.ordinal !== ordinal) throw new TypeError("stored mutation field ordinals are not contiguous");
    return parseStoredField(row);
  });
  // Until C1b stores generations, every accepted mutation is generation 1: ingest refuses others.
  const mutation = syncMutationSchema.parse({
    schemaVersion: WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION,
    mutationId: header.mutation_id,
    workspaceId: transaction.scope.workspaceId,
    workspaceSchemaVersion: parseUnsignedInteger(header.workspace_schema_version, "stored workspace schema version"),
    entityType: header.entity_type,
    entityId: header.entity_id,
    entityGeneration: 1,
    operationKind: header.operation_kind,
    ...(header.operation_kind === "delete" ? { deletedAt: required(header.deleted_at) } : {}),
    baseServerRevision: parseUnsignedInteger(header.base_server_revision, "stored base revision"),
    changedFields,
    sourceDeviceId: header.source_device_id,
    activeLeaseEpoch: parseUnsignedInteger(header.active_lease_epoch, "stored active lease epoch"),
    deviceMutationSequence: parseUnsignedInteger(header.device_mutation_sequence, "stored mutation sequence"),
    serverRevision,
  });
  const { serverRevision: _revision, ...submittedValue } = mutation;
  const submitted = submittedSyncMutationSchema.parse(submittedValue);
  // Retained bytes stay as accepted: a mutation accepted before wire v3 keeps its v2 envelope,
  // which is re-derived from the same content; anything else is corruption.
  const stored = header.canonical_submitted_envelope;
  const envelope = [
    Buffer.from(encodeDrainStreamEnvelope("mutation", submitted)),
    ...(isFirstGenerationMutation(submitted) ? [Buffer.from(encodeLegacyV2MutationDrainEnvelope(submitted))] : []),
  ].find((candidate) => stored.equals(candidate));
  if (envelope === undefined || !header.submitted_envelope_digest.equals(digestEnvelope(envelope))) {
    throw new TypeError("stored mutation canonical envelope is corrupt");
  }
  return mutation;
}

function parseStoredField(row: MutationFieldRow): SubmittedSyncMutation["changedFields"][number] {
  switch (row.field_path) {
    case "note":
      assertAbsent(row.tags_value, row.target_price_currency, row.target_price_amount);
      return submittedSyncMutationSchema.shape.changedFields.element.parse({
        fieldPath: "note", value: row.value_is_null ? null : required(row.text_value),
      });
    case "portfolioId":
      assertAbsent(row.tags_value, row.target_price_currency, row.target_price_amount);
      return submittedSyncMutationSchema.shape.changedFields.element.parse({
        fieldPath: "portfolioId", value: row.value_is_null ? null : required(row.text_value),
      });
    case "tags":
      assertAbsent(row.text_value, row.target_price_currency, row.target_price_amount);
      if (row.value_is_null) throw new TypeError("stored tags cannot be null");
      return submittedSyncMutationSchema.shape.changedFields.element.parse({
        fieldPath: "tags", value: required(row.tags_value),
      });
    case "targetPrice":
      assertAbsent(row.text_value, row.tags_value);
      return submittedSyncMutationSchema.shape.changedFields.element.parse({
        fieldPath: "targetPrice",
        value: row.value_is_null ? null : {
          currency: required(row.target_price_currency), amount: required(row.target_price_amount),
        },
      });
    default:
      throw new TypeError("stored mutation field path is unsupported");
  }
}

function encodeField(field: SubmittedSyncMutation["changedFields"][number]): {
  readonly valueIsNull: boolean;
  readonly textValue: string | null;
  readonly tagsValue: readonly string[] | null;
  readonly currency: string | null;
  readonly amount: string | null;
} {
  switch (field.fieldPath) {
    case "note":
    case "portfolioId":
      return { valueIsNull: field.value === null, textValue: field.value, tagsValue: null, currency: null, amount: null };
    case "tags":
      return { valueIsNull: false, textValue: null, tagsValue: field.value, currency: null, amount: null };
    case "targetPrice":
      return { valueIsNull: field.value === null, textValue: null, tagsValue: null,
        currency: field.value?.currency ?? null, amount: field.value?.amount ?? null };
  }
}

function digestEnvelope(envelope: Uint8Array): Buffer {
  return createHash("sha256").update(envelope).digest();
}

function wireDigest(mutation: SubmittedSyncMutation): Buffer {
  const { workspaceId: _workspaceId, ...tenantNeutral } = mutation;
  return createHash("sha256")
    .update(encodeSubmittedSyncMutationDigestInput(tenantNeutral))
    .digest();
}

/** The stored-version digest of `mutation`, or null when that version cannot express it. */
function wireDigestAt(mutation: SubmittedSyncMutation, storedVersion: number | undefined): string | null {
  const { workspaceId: _workspaceId, ...tenantNeutral } = mutation;
  if (storedVersion === WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION) return wireDigest(mutation).toString("base64url");
  if (storedVersion !== 2 || !isFirstGenerationMutation(mutation)) return null;
  return createHash("sha256")
    .update(encodeLegacyV2SubmittedSyncMutationDigestInput(tenantNeutral))
    .digest("base64url");
}

function parseDigest(value: Buffer, label: string): string {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new TypeError(`${label} is malformed`);
  return value.toString("base64url");
}

function parseUnsignedInteger(value: string, label: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new TypeError(`${label} is malformed`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`${label} is unsafe`);
  return parsed;
}

function storedText(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("stored writer column is not text");
  return value;
}

function positiveRevision(value: number): number {
  const parsed = safePositiveInteger.parse(value);
  return parsed;
}

function required<Value>(value: Value | null): Value {
  if (value === null) throw new TypeError("stored mutation field value is missing");
  return value;
}

function assertAbsent(...values: readonly unknown[]): void {
  if (values.some((value) => value !== null)) throw new TypeError("stored mutation field union is malformed");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}
