import { createHash } from "node:crypto";

import { encodeDrainStreamEnvelope } from "@gooddealer/protocol/execution-events";
import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  submittedSyncMutationSchema,
  syncMutationSchema,
  serverRevisionSchema,
  type SubmittedSyncMutation,
  type SyncMutation,
} from "@gooddealer/protocol/workspace";
import { identifier, safePositiveInteger } from "@gooddealer/protocol/wire";

import type { TenantTransaction } from "../../../db/index";

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
  | "after_log_insert";

export interface MutationReceipt {
  readonly mutationId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly deviceMutationSequence: number;
  readonly serverRevision: number;
  readonly submittedEnvelopeDigest: string;
}

export type MutationReceiptResolution =
  | { readonly status: "missing" }
  | { readonly status: "exact"; readonly receipt: MutationReceipt }
  | { readonly status: "mutation_id_conflict"; readonly receipt: MutationReceipt }
  | { readonly status: "sequence_conflict"; readonly receipt: MutationReceipt };

interface ReceiptRow {
  mutation_id: string;
  source_device_id: string;
  active_lease_epoch: string;
  device_mutation_sequence: string;
  server_revision: string;
  submitted_envelope_digest: Buffer;
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
    const result = await transaction.query<{
      contiguous_received_through: string;
      highest_received_sequence: string;
      rolling_digest: Buffer;
      sealed: boolean;
    }>(
      `SELECT contiguous_received_through, highest_received_sequence, rolling_digest, sealed
       FROM public.workspace_mutation_drain_lock_domain($1::text, $2::bigint)`,
      [domain.sourceDeviceId, domain.activeLeaseEpoch],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined) throw new TypeError("mutation drain head routine is unavailable");
    if (row.sealed) throw new TypeError("mutation drain domain is sealed");
    const handle: LockedMutationDrainDomain = {
      ...domain,
      contiguousReceivedThrough: parseUnsignedInteger(row.contiguous_received_through, "stored contiguous sequence"),
      highestReceivedSequence: parseUnsignedInteger(row.highest_received_sequence, "stored highest sequence"),
      rollingDigest: parseDigest(row.rolling_digest, "stored rolling digest"),
      [lockedDomainBrand]: true,
    };
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
    const result = await transaction.query<ReceiptRow>(
      `SELECT mutation_id, source_device_id, active_lease_epoch, device_mutation_sequence,
              server_revision, submitted_envelope_digest
       FROM workspace_mutation_receipts
       WHERE account_id = $1 AND workspace_id = $2
         AND (mutation_id = $3 OR
           (source_device_id = $4 AND active_lease_epoch = $5 AND device_mutation_sequence = $6))
       ORDER BY mutation_id COLLATE "C"`,
      [transaction.scope.accountId, transaction.scope.workspaceId, mutation.mutationId,
        mutation.sourceDeviceId, mutation.activeLeaseEpoch, mutation.deviceMutationSequence],
    );
    const receipts = result.rows.map(parseReceipt);
    const byId = receipts.find((receipt) => receipt.mutationId === mutation.mutationId);
    const bySequence = receipts.find((receipt) =>
      receipt.sourceDeviceId === mutation.sourceDeviceId &&
      receipt.activeLeaseEpoch === mutation.activeLeaseEpoch &&
      receipt.deviceMutationSequence === mutation.deviceMutationSequence);
    const digest = digestEnvelope(encodeDrainStreamEnvelope("mutation", mutation)).toString("base64url");
    if (byId !== undefined) {
      if (byId.submittedEnvelopeDigest !== digest) return { status: "mutation_id_conflict", receipt: byId };
      if (bySequence === undefined || bySequence.mutationId !== mutation.mutationId) {
        return { status: "sequence_conflict", receipt: bySequence ?? byId };
      }
      return { status: "exact", receipt: byId };
    }
    if (bySequence !== undefined) return { status: "sequence_conflict", receipt: bySequence };
    return { status: "missing" };
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

function parseReceipt(row: ReceiptRow): MutationReceipt {
  return {
    mutationId: identifier.parse(row.mutation_id),
    sourceDeviceId: identifier.parse(row.source_device_id),
    activeLeaseEpoch: positiveRevision(parseUnsignedInteger(row.active_lease_epoch, "stored receipt epoch")),
    deviceMutationSequence: positiveRevision(parseUnsignedInteger(row.device_mutation_sequence, "stored receipt sequence")),
    serverRevision: positiveRevision(parseUnsignedInteger(row.server_revision, "stored receipt revision")),
    submittedEnvelopeDigest: parseDigest(row.submitted_envelope_digest, "stored receipt digest"),
  };
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
  const mutation = syncMutationSchema.parse({
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    mutationId: header.mutation_id,
    workspaceId: transaction.scope.workspaceId,
    workspaceSchemaVersion: parseUnsignedInteger(header.workspace_schema_version, "stored workspace schema version"),
    entityType: header.entity_type,
    entityId: header.entity_id,
    ...(header.operation_kind === "delete"
      ? { operationKind: "delete", deletedAt: required(header.deleted_at) }
      : {}),
    baseServerRevision: parseUnsignedInteger(header.base_server_revision, "stored base revision"),
    changedFields,
    sourceDeviceId: header.source_device_id,
    activeLeaseEpoch: parseUnsignedInteger(header.active_lease_epoch, "stored active lease epoch"),
    deviceMutationSequence: parseUnsignedInteger(header.device_mutation_sequence, "stored mutation sequence"),
    serverRevision,
  });
  const { serverRevision: _revision, ...submittedValue } = mutation;
  const submitted = submittedSyncMutationSchema.parse(submittedValue);
  const envelope = Buffer.from(encodeDrainStreamEnvelope("mutation", submitted));
  const digest = digestEnvelope(envelope);
  if (!header.canonical_submitted_envelope.equals(envelope) ||
    !header.submitted_envelope_digest.equals(digest)) {
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
