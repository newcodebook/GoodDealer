import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
  encodeLegacyV2MutationDrainEnvelope,
  encodeMutationDrainResultEnvelope,
} from "@gooddealer/protocol/execution-events";
import {
  encodeLegacyV2SubmittedSyncMutationDigestInput,
  submittedSyncMutationSchema,
} from "@gooddealer/protocol/workspace";

import { runCloudMigrations, TenantTransactionRunner } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { PostgresWorkspaceDeviceAuditDrainLedger } from "../../src/modules/audit/index";
import {
  PostgresDeviceDrainTransition,
  PostgresMutationAuthority,
} from "../../src/modules/devices/index";
import { PostgresExecutionFactDrainLedger } from "../../src/modules/execution-ledger/index";
import { PostgresIdentityAccountSecurityStatePort } from "../../src/modules/identity/index";
import { PostgresMutationDrainLedger } from "../../src/modules/workspace/mutations/index";
import { PostgresWorkspaceMutationIngest } from "../../src/modules/workspace/mutations/postgres-ingest-service";
import { PostgresWorkspaceMutationRepository } from "../../src/modules/workspace/mutations/postgres-repository";
import { PostgresWorkspaceRevisionRepository } from "../../src/modules/workspace/revisions/index";
import { PostgresPortfolioRepository } from "../../src/modules/workspace/state/portfolio/index";
import { legacyAcceptedDeleteRepairSql } from "../../src/modules/workspace/state/portfolio/migrations/202611140001-replica-domain-asset-deletion";
import type { WorkspaceTenantScope } from "../../src/modules/workspace/tenant-scope";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 3 });
const transactions = new TenantTransactionRunner(appPool);
const revisions = new PostgresWorkspaceRevisionRepository();
const mutations = new PostgresWorkspaceMutationRepository();
const portfolio = new PostgresPortfolioRepository();
const authority = new PostgresMutationAuthority();
const scopeA = { accountId: "mutation-account-a", workspaceId: "same-workspace" } as const;
const scopeB = { accountId: "mutation-account-b", workspaceId: "same-workspace" } as const;

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query(`TRUNCATE
    workspace_mutation_fields, workspace_mutations, workspace_mutation_receipts,
    workspace_device_audit_drain_seals, workspace_device_audit_drain_records,
    workspace_device_audit_drain_heads,
    execution_fact_drain_seals, execution_fact_drain_records, execution_fact_drain_heads,
    mutation_drain_seals, mutation_drain_records, mutation_drain_heads,
    workspace_replica_domain_assets, workspace_revisions,
    device_active_leases, device_lease_epoch_allocations, device_bindings, device_account_states CASCADE`);
  for (const scope of [scopeA, scopeB]) {
    await transactions.withTenant(scope, async (transaction) => {
      await revisions.bind(transaction, 1);
      await transaction.query("INSERT INTO device_account_states (account_id) VALUES ($1)", [scope.accountId]);
      await transaction.query(`INSERT INTO device_bindings
        (account_id, device_id, slot, status, credential_epoch)
        VALUES ($1, 'device-1', 1, 'bound', 1)`, [scope.accountId]);
      await transaction.query(`INSERT INTO device_lease_epoch_allocations
        (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
        VALUES ($1, $2, 'mutation-ingest', 1, 'activated', transaction_timestamp())`,
      [scope.accountId, scope.workspaceId]);
      await transaction.query(`INSERT INTO device_active_leases
        (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
         offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
        VALUES ($1, 1, 'device-1', $2, transaction_timestamp() - interval '2 minutes',
          transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '5 minutes',
          transaction_timestamp() + interval '1 hour', decode('01', 'hex'),
          jsonb_build_object('fixture', 'workspace-mutation'), pg_catalog.sha256(decode('01', 'hex')))`,
      [scope.accountId, `mutation-lease-${scope.accountId}`]);
    });
  }
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end()]);
});

describe("PostgreSQL workspace Mutation persistence", () => {
  it("qualifies only PostgreSQL 18.6 and forces tenant RLS on every owner table", async () => {
    const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
    if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC !== "true") {
      expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
    } else {
      console.warn(`UNQUALIFIED PostgreSQL diagnostic only: ${version.rows[0]?.server_version ?? "unknown"}`);
    }
    const rls = await ownerPool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname = ANY($1::text[])
       ORDER BY relname`,
      [["workspace_mutation_fields", "workspace_mutation_receipts", "workspace_mutations"]],
    );
    expect(rls.rows).toEqual([
      { relname: "workspace_mutation_fields", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "workspace_mutation_receipts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "workspace_mutations", relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const foreignKeys = await ownerPool.query<{ table_name: string; columns: string[] }>(
      `SELECT c.conrelid::regclass::text AS table_name,
              array_agg(a.attname ORDER BY u.ordinality)::text[] AS columns
       FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ordinality)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
       WHERE c.contype = 'f' AND c.conrelid = ANY($1::regclass[])
       GROUP BY c.oid, c.conrelid`,
      [["workspace_mutation_receipts", "workspace_mutations", "workspace_mutation_fields"]],
    );
    expect(foreignKeys.rows.every(({ columns }) =>
      columns[0] === "account_id" && columns[1] === "workspace_id")).toBe(true);
  });

  it("rejects replay and receipt rows that remain ahead of the committed workspace head", async () => {
    const mutation = submitted("mutation-ahead-of-head", 10, 0);
    const envelope = Buffer.from(encodeDrainStreamEnvelope("mutation", mutation));
    const digest = createHash("sha256").update(envelope).digest();

    await expect(transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(
        `INSERT INTO workspace_mutation_receipts (
           account_id, workspace_id, mutation_id, source_device_id, active_lease_epoch,
           device_mutation_sequence, server_revision, submitted_envelope_digest
         ) VALUES ($1, $2, $3, $4, $5, $6, 10, $7)`,
        [scopeA.accountId, scopeA.workspaceId, mutation.mutationId, mutation.sourceDeviceId,
          mutation.activeLeaseEpoch, mutation.deviceMutationSequence, digest],
      );
      await transaction.query(
        `INSERT INTO workspace_mutations (
           account_id, workspace_id, server_revision, mutation_id, workspace_schema_version,
           entity_type, entity_id, base_server_revision, source_device_id, active_lease_epoch,
           device_mutation_sequence, canonical_submitted_envelope, submitted_envelope_digest
         ) VALUES ($1, $2, 10, $3, 1, 'domain_asset', $4, 0, $5, $6, $7, $8, $9)`,
        [scopeA.accountId, scopeA.workspaceId, mutation.mutationId, mutation.entityId,
          mutation.sourceDeviceId, mutation.activeLeaseEpoch, mutation.deviceMutationSequence,
          envelope, digest],
      );
    })).rejects.toThrow(/committed head|active replay/u);

    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(`
      SELECT
        (SELECT server_revision::text FROM workspace_revisions) AS head,
        (SELECT count(*)::text FROM workspace_mutation_receipts) AS receipts,
        (SELECT count(*)::text FROM workspace_mutations) AS replay`)))
      .resolves.toMatchObject({ rows: [{ head: "0", receipts: "0", replay: "0" }] });
  });

  it("denies direct app-role watermark and replay deletion bypasses", async () => {
    await append(scopeA, submitted("mutation-compaction-denied", 1, 0), 1);

    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(
      "UPDATE workspace_revisions SET compacted_through_server_revision = 1",
    ))).rejects.toMatchObject({ code: "42501" });
    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(
      "DELETE FROM workspace_mutations WHERE server_revision = 1",
    ))).rejects.toMatchObject({ code: "42501" });
    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(
      "SELECT public.workspace_compaction_advance(0, 1)",
    ))).rejects.toThrow(/available checkpoint/u);

    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(`
      SELECT
        (SELECT compacted_through_server_revision::text FROM workspace_revisions) AS watermark,
        (SELECT count(*)::text FROM workspace_mutation_receipts) AS receipts,
        (SELECT count(*)::text FROM workspace_mutations) AS replay`)))
      .resolves.toMatchObject({ rows: [{ watermark: "0", receipts: "1", replay: "1" }] });
  });

  it("persists strict receipts, replay fields, and the Drain head in one transaction", async () => {
    const mutation = submitted("mutation-1", 1, 0);
    await append(scopeA, mutation, 1);

    await transactions.withTenant(scopeA, async (transaction) => {
      const lock = await mutations.lockDrainDomain(transaction, domain());
      await expect(mutations.resolveReceipt(transaction, lock, mutation)).resolves.toMatchObject({
        status: "exact",
        receipt: { mutationId: mutation.mutationId, serverRevision: 1 },
      });
      await expect(mutations.readRange(transaction, 0, 1)).resolves.toEqual([{ ...mutation, serverRevision: 1 }]);
      await expect(mutations.hasCompleteRange(transaction, 0, 1)).resolves.toBe(true);
    }, { readOnly: false });

    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(
      `UPDATE workspace_mutation_receipts
       SET submitted_envelope_digest = decode(repeat('00', 32), 'hex')
       WHERE mutation_id = $1`,
      [mutation.mutationId],
    ))).rejects.toMatchObject({ code: "42501" });
    await transactions.withTenant(scopeA, async (transaction) => {
      const lock = await mutations.lockDrainDomain(transaction, domain());
      await expect(mutations.resolveReceipt(transaction, lock, mutation)).resolves.toMatchObject({ status: "exact" });
    });

    const expectedRolling = createHash("sha256")
      .update(encodeDrainChainStepInput(
        Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url"),
        encodeDrainStreamEnvelope("mutation", mutation),
      ))
      .digest();
    const head = await transactions.withTenant(scopeA, (transaction) => transaction.query<{
      contiguous: string;
      highest: string;
      digest: Buffer;
    }>(
      `SELECT contiguous_received_through AS contiguous, highest_received_sequence AS highest,
              rolling_digest AS digest
       FROM mutation_drain_heads WHERE source_device_id = $1 AND active_lease_epoch = $2`,
      [mutation.sourceDeviceId, mutation.activeLeaseEpoch],
    ));
    expect(head.rows[0]).toMatchObject({ contiguous: "1", highest: "1" });
    expect(head.rows[0]?.digest.equals(expectedRolling)).toBe(true);
  });

  it("persists an explicit DomainAsset deletion without manufacturing changed fields", async () => {
    const mutation = submittedSyncMutationSchema.parse({
      schemaVersion: 3,
      mutationId: "mutation-delete",
      workspaceId: scopeA.workspaceId,
      workspaceSchemaVersion: 1,
      entityType: "domain_asset",
      entityId: "deleted.test",
      entityGeneration: 1,
      operationKind: "delete",
      deletedAt: "2026-08-28T00:00:00Z",
      baseServerRevision: 0,
      changedFields: [],
      sourceDeviceId: "device-1",
      activeLeaseEpoch: 1,
      deviceMutationSequence: 1,
    });
    await append(scopeA, mutation, 1);

    await transactions.withTenant(scopeA, async (transaction) => {
      await expect(mutations.readRange(transaction, 0, 1)).resolves.toEqual([
        { ...mutation, serverRevision: 1 },
      ]);
      const stored = await transaction.query<{ operation_kind: string; deleted_at: string; fields: string }>(`
        SELECT mutation.operation_kind,
               to_char(mutation.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deleted_at,
               (SELECT count(*)::text FROM workspace_mutation_fields field
                WHERE field.account_id = mutation.account_id
                  AND field.workspace_id = mutation.workspace_id
                  AND field.server_revision = mutation.server_revision) AS fields
        FROM workspace_mutations mutation
        WHERE mutation.server_revision = 1`);
      expect(stored.rows).toEqual([{
        operation_kind: "delete",
        deleted_at: "2026-08-28T00:00:00Z",
        fields: "0",
      }]);
    });
  });

  it("orchestrates authority, Drain, revision, state, receipt, and replay atomically without production composition", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({
      transactions,
      authority,
      revisions,
      portfolio,
      mutations,
    });
    const mutation = submitted("mutation-service", 1, 0);
    const request = pushRequest(mutation);
    await expect(service.ingest(scopeA, request)).resolves.toMatchObject({
      accepted: true,
      assignments: [{ mutationId: mutation.mutationId, serverRevision: 1, duplicate: false }],
      headRevision: 1,
    });
    await expect(service.ingest(scopeA, request)).resolves.toMatchObject({
      accepted: true,
      assignments: [{ serverRevision: 1, duplicate: true }],
      headRevision: 1,
    });
    const replayState = await readGlobalHead(scopeA);
    expect(replayState).toEqual({ contiguous: "1", highest: "1", rowVersion: "2", ledger: "1" });
    const state = await transactions.withTenant(scopeA, async (transaction) => {
      const head = await revisions.read(transaction);
      const rows = await portfolio.captureSnapshot(transaction);
      return { head, rows };
    });
    expect(state).toMatchObject({
      head: { serverRevision: 1 },
      rows: [{ entityId: "asset-1.test", note: "note-mutation-service" }],
    });

    let getterCalls = 0;
    const accessorRequest = Object.defineProperty({ ...request }, "mutations", {
      enumerable: true,
      get() { getterCalls += 1; return [mutation]; },
    });
    await expect(service.ingest(scopeA, accessorRequest)).resolves.toEqual({
      accepted: false, code: "MUTATION_MALFORMED",
    });
    expect(getterCalls).toBe(0);
  });

  it("ADR-0029 C1a refuses a later generation or a re-add before any receipt or revision", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    await expect(service.ingest(scopeA, pushRequest(submitted("generation-1", 1, 0))))
      .resolves.toMatchObject({ accepted: true, headRevision: 1 });
    const later = submittedSyncMutationSchema.parse({ ...submitted("generation-2", 2, 1), entityGeneration: 2 });
    const reAdd = submittedSyncMutationSchema.parse({ ...later, reAddsDeletedRevision: 1 });
    const before = await readGlobalHead(scopeA);
    for (const refused of [later, reAdd]) {
      await expect(service.ingest(scopeA, pushRequest(refused))).resolves.toEqual({
        accepted: false,
        code: "MUTATION_SCHEMA_VERSION_UNSUPPORTED",
        failures: [{ index: 0, mutationId: "generation-2" }],
      });
    }
    // Refused before the tenant transaction: the device head, its row version, and the ledger are untouched.
    await expect(readGlobalHead(scopeA)).resolves.toEqual(before);
    expect(before).toMatchObject({ contiguous: "1", highest: "1", ledger: "1" });
    await expect(service.ingest(scopeA, pushRequest(submitted("generation-2", 2, 1))))
      .resolves.toMatchObject({ accepted: true, headRevision: 2 });
  });

  it("ADR-0029 C1a replays and reads a mutation Cloud accepted under wire v2", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const mutation = submitted("accepted-under-v2", 1, 0);
    await expect(service.ingest(scopeA, pushRequest(mutation))).resolves.toMatchObject({ accepted: true });
    // Rewrite the row into the shape Cloud stored before migration 202611130005: version 2 and
    // the v2 digest and envelope. The immutability triggers are suspended only for this fixture.
    const { workspaceId: _workspaceId, ...tenantNeutral } = mutation;
    const legacyEnvelope = Buffer.from(encodeLegacyV2MutationDrainEnvelope(mutation));
    const legacyWireDigest = createHash("sha256").update(encodeLegacyV2SubmittedSyncMutationDigestInput(tenantNeutral)).digest();
    const envelopeDigest = createHash("sha256").update(legacyEnvelope).digest();
    await ownerPool.query("BEGIN");
    try {
      await ownerPool.query("SELECT set_config('gooddealer.account_id', $1, true)", [scopeA.accountId]);
      await ownerPool.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scopeA.workspaceId]);
      for (const table of ["workspace_device_mutation_sequence_ledger", "workspace_mutations", "mutation_drain_records"]) {
        await ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await ownerPool.query(`UPDATE workspace_device_mutation_sequence_ledger
        SET wire_schema_version = 2, wire_mutation_digest = $1 WHERE mutation_id = $2`, [legacyWireDigest, mutation.mutationId]);
      await ownerPool.query(`UPDATE workspace_mutations
        SET canonical_submitted_envelope = $1, submitted_envelope_digest = $2 WHERE mutation_id = $3`,
      [legacyEnvelope, envelopeDigest, mutation.mutationId]);
      await ownerPool.query(`UPDATE mutation_drain_records
        SET canonical_envelope = $1, envelope_digest = $2 WHERE device_mutation_sequence = 1`, [legacyEnvelope, envelopeDigest]);
      for (const table of ["workspace_device_mutation_sequence_ledger", "workspace_mutations", "mutation_drain_records"]) {
        await ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await ownerPool.query("COMMIT");
    } catch (error) {
      await ownerPool.query("ROLLBACK");
      throw error;
    }

    // The v3 form of the same content is an exact replay of the v2 receipt; changed content is not.
    await expect(service.ingest(scopeA, pushRequest(mutation))).resolves.toMatchObject({
      accepted: true, assignments: [{ serverRevision: 1, duplicate: true }], headRevision: 1,
    });
    await expect(service.ingest(scopeA, pushRequest({ ...mutation, changedFields: [{ fieldPath: "note", value: "other" }] })))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_ID_CONFLICT" });
    // Readers receive the stored v2 acceptance as a v3 first-generation mutation.
    await transactions.withTenant(scopeA, async (transaction) => {
      await expect(mutations.readRange(transaction, 0, 1)).resolves.toMatchObject([
        { schemaVersion: 3, mutationId: mutation.mutationId, entityGeneration: 1, serverRevision: 1 },
      ]);
    });
  });

  it("ADR-0029 C1a replays a business rejection Cloud recorded under wire v2", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const tags = (id: string, sequence: number, base: number) => submittedSyncMutationSchema.parse({
      ...submitted(id, sequence, base), changedFields: [{ fieldPath: "tags", value: [id] }],
    });
    await expect(service.ingest(scopeA, pushRequest(submitted("note-1", 1, 0), submitted("note-2", 2, 0))))
      .resolves.toMatchObject({ accepted: true });
    await expect(service.ingest(scopeA, pushRequest(tags("tags-from-2", 3, 2)))).resolves.toMatchObject({ accepted: true });
    const stale = tags("tags-stale", 4, 1);
    await expect(service.ingest(scopeA, pushRequest(stale)))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_FIELD_STALE" });

    // Rewrite the rejection into its pre-migration shape: version 2, v2 digest, v2 envelope digest.
    const { workspaceId: _workspaceId, ...tenantNeutral } = stale;
    const legacyWireDigest = createHash("sha256").update(encodeLegacyV2SubmittedSyncMutationDigestInput(tenantNeutral)).digest();
    const legacyEnvelopeDigest = createHash("sha256").update(encodeLegacyV2MutationDrainEnvelope(stale)).digest();
    await ownerPool.query("BEGIN");
    try {
      await ownerPool.query("SELECT set_config('gooddealer.account_id', $1, true)", [scopeA.accountId]);
      await ownerPool.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scopeA.workspaceId]);
      await ownerPool.query("ALTER TABLE workspace_device_mutation_sequence_ledger DISABLE TRIGGER USER");
      await ownerPool.query(`UPDATE workspace_device_mutation_sequence_ledger
        SET wire_schema_version = 2, wire_mutation_digest = $1, rejected_envelope_digest = $2
        WHERE device_mutation_sequence = 4`, [legacyWireDigest, legacyEnvelopeDigest]);
      await ownerPool.query("ALTER TABLE workspace_device_mutation_sequence_ledger ENABLE TRIGGER USER");
      await ownerPool.query("COMMIT");
    } catch (error) {
      await ownerPool.query("ROLLBACK");
      throw error;
    }

    // The v3 form of the same content replays the stored rejection; changed content conflicts.
    await expect(service.ingest(scopeA, pushRequest(stale))).resolves.toEqual({
      accepted: false, code: "MUTATION_FIELD_STALE", failures: [{ index: 0, mutationId: "tags-stale" }],
    });
    await expect(service.ingest(scopeA, pushRequest({ ...stale, changedFields: [{ fieldPath: "tags", value: ["other"] }] })))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_ID_CONFLICT" });
  });

  it("rejects a poison item without persisting any prefix of the v2 batch", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const good = submitted("poison-prefix-good", 1, 0);
    // A tombstoned asset stays unknown until ADR-0029's generation exists; it poisons the batch.
    await seedDeletedAsset(scopeA, "deleted.test");
    const poison = submittedSyncMutationSchema.parse({
      ...submitted("poison-unknown-entity", 2, 0),
      entityId: "deleted.test",
    });

    await expect(service.ingest(scopeA, pushRequest(good, poison))).resolves.toMatchObject({
      accepted: false,
      code: "MUTATION_ENTITY_UNKNOWN",
    });
    const state = await transactions.withTenant(scopeA, (transaction) => transaction.query<{
      revision: string; receipts: string; replay: string; ledger: string; heads: string; drain: string;
    }>(`
      SELECT
        (SELECT server_revision::text FROM workspace_revisions) AS revision,
        (SELECT count(*)::text FROM workspace_mutation_receipts) AS receipts,
        (SELECT count(*)::text FROM workspace_mutations) AS replay,
        (SELECT count(*)::text FROM workspace_device_mutation_sequence_ledger) AS ledger,
        (SELECT count(*)::text FROM workspace_device_mutation_heads) AS heads,
        (SELECT count(*)::text FROM mutation_drain_records) AS drain`));
    expect(state.rows[0]).toEqual({
      revision: "0", receipts: "0", replay: "0", ledger: "0", heads: "0", drain: "0",
    });
  });

  it("creates an asset the replica does not hold from its first upsert, in this tenant only", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const created = submittedSyncMutationSchema.parse({
      ...submitted("first-add", 1, 0),
      entityId: "added.test",
      changedFields: [{ fieldPath: "note", value: "first note" }, { fieldPath: "tags", value: ["new"] }],
    });
    // The same device edits the new asset's untouched field in the same push.
    const edited = submittedSyncMutationSchema.parse({
      ...submitted("first-add-edit", 2, 0),
      entityId: "added.test",
      changedFields: [{ fieldPath: "portfolioId", value: "portfolio-1" }],
    });
    const request = pushRequest(created, edited);
    await expect(service.ingest(scopeA, request)).resolves.toMatchObject({
      accepted: true,
      assignments: [{ serverRevision: 1, duplicate: false }, { serverRevision: 2, duplicate: false }],
      headRevision: 2,
    });
    // A lost-response retry is answered with the exact duplicates and creates nothing twice.
    await expect(service.ingest(scopeA, request)).resolves.toMatchObject({
      accepted: true,
      assignments: [{ serverRevision: 1, duplicate: true }, { serverRevision: 2, duplicate: true }],
      headRevision: 2,
    });
    const stored = await transactions.withTenant(scopeA, (transaction) => transaction.query(
      `SELECT entity_id, note, portfolio_id, tags, target_price_currency, target_price_amount,
              note_server_revision::int AS note_revision, portfolio_id_server_revision::int AS portfolio_revision,
              tags_server_revision::int AS tags_revision, target_price_server_revision::int AS price_revision,
              lifecycle_status, materialization_origin
       FROM workspace_replica_domain_assets`));
    expect(stored.rows).toEqual([{
      entity_id: "added.test", note: "first note", portfolio_id: "portfolio-1", tags: ["new"],
      target_price_currency: null, target_price_amount: null,
      note_revision: 1, portfolio_revision: 2, tags_revision: 1, price_revision: 0,
      lifecycle_status: "active", materialization_origin: "workspace_sync",
    }]);
    // The device's own later edit from the same base is not a conflict with its creation.
    const later = submittedSyncMutationSchema.parse({ ...submitted("later-edit", 3, 0), entityId: "added.test" });
    await expect(service.ingest(scopeA, pushRequest(later))).resolves.toMatchObject({ accepted: true, headRevision: 3 });
    // The other tenant shares the workspace id but neither sees nor holds the created asset.
    const other = await transactions.withTenant(scopeB, (transaction) => transaction.query(
      "SELECT count(*)::int AS count FROM workspace_replica_domain_assets"));
    expect(other.rows).toEqual([{ count: 0 }]);
    await expect(transactions.withTenant(scopeB, (transaction) => revisions.read(transaction)))
      .resolves.toMatchObject({ serverRevision: 0 });
  });

  it("serializes two concurrent first upserts of one asset into one creation", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    // Two submissions of different fields race to create the same asset; the revision lock orders
    // them, so the asset is created once and both fields land at distinct revisions.
    const first = submittedSyncMutationSchema.parse({ ...submitted("race-note", 1, 0), entityId: "raced.test" });
    const second = submittedSyncMutationSchema.parse({
      ...submitted("race-tags", 2, 0), entityId: "raced.test", changedFields: [{ fieldPath: "tags", value: ["raced"] }],
    });
    const results = await Promise.all([
      service.ingest(scopeA, pushRequest(first)),
      service.ingest(scopeA, pushRequest(second)),
    ]);
    // The Drain domain requires device sequences in order, so the later sequence may have to wait
    // for the earlier one; whichever outcome, at most one row exists and nothing is applied twice.
    expect(results.every((result) => result.accepted || result.code !== "MUTATION_ENTITY_UNKNOWN")).toBe(true);
    const stored = await transactions.withTenant(scopeA, async (transaction) => ({
      rows: (await transaction.query("SELECT entity_id FROM workspace_replica_domain_assets")).rows,
      head: (await revisions.read(transaction))?.serverRevision,
      receipts: (await transaction.query("SELECT count(*)::int AS count FROM workspace_mutation_receipts")).rows[0],
    }));
    expect(stored.rows).toEqual([{ entity_id: "raced.test" }]);
    expect(stored.receipts).toEqual({ count: stored.head });
    expect(stored.head).toBe(results.filter((result) => result.accepted).length);
  });

  it("accepts a device's consecutive unacknowledged edits of one field, separately or batched", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    // The desktop commits each edit with its applied head as the base and freezes the wire, so two
    // edits made before the first is acknowledged both carry base 0.
    const first = submitted("edit-1", 1, 0);
    const second = submitted("edit-2", 2, 0);
    await expect(service.ingest(scopeA, pushRequest(first))).resolves.toMatchObject({ accepted: true, headRevision: 1 });
    await expect(service.ingest(scopeA, pushRequest(second))).resolves.toMatchObject({
      accepted: true, assignments: [{ serverRevision: 2, duplicate: false }],
    });
    // Two more, pushed together in one batch.
    await expect(service.ingest(scopeA, pushRequest(submitted("edit-3", 3, 2), submitted("edit-4", 4, 2))))
      .resolves.toMatchObject({ accepted: true, headRevision: 4 });
    const stored = await transactions.withTenant(scopeA, (transaction) => transaction.query(
      "SELECT note, note_server_revision::int AS revision FROM workspace_replica_domain_assets"));
    expect(stored.rows).toEqual([{ note: "note-edit-4", revision: 4 }]);
  });

  it("still rejects a same-field write it did not build on: an older base or another Lease epoch", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    await expect(service.ingest(scopeA, pushRequest(submitted("note-1", 1, 0), submitted("note-2", 2, 0))))
      .resolves.toMatchObject({ accepted: true });
    const tags = (id: string, sequence: number, base: number) => submittedSyncMutationSchema.parse({
      ...submitted(id, sequence, base), changedFields: [{ fieldPath: "tags", value: [id] }],
    });
    await expect(service.ingest(scopeA, pushRequest(tags("tags-from-2", 3, 2)))).resolves.toMatchObject({ accepted: true });
    // A later sequence of the same device naming an older base than its earlier write did not
    // build on it.
    await expect(service.ingest(scopeA, pushRequest(tags("tags-from-1", 4, 1)))).resolves.toMatchObject({
      accepted: false, code: "MUTATION_FIELD_STALE", failures: [{ fieldPath: "tags", lastModifiedRevision: 3 }],
    });
    // The lease rotates to epoch 2; a write of epoch 2 did not see epoch 1's note write.
    await ownerPool.query(`UPDATE device_active_leases SET released_at = transaction_timestamp(), release_reason = 'rotated'
      WHERE account_id = $1 AND lease_epoch = 1`, [scopeA.accountId]);
    await ownerPool.query(`INSERT INTO device_lease_epoch_allocations
      (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
      VALUES ($1, $2, 'mutation-ingest-2', 2, 'activated', transaction_timestamp())`, [scopeA.accountId, scopeA.workspaceId]);
    await ownerPool.query(`INSERT INTO device_active_leases
      (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
       offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
      VALUES ($1, 2, 'device-1', 'mutation-lease-epoch-2', transaction_timestamp() - interval '2 minutes',
        transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '5 minutes',
        transaction_timestamp() + interval '1 hour', decode('02', 'hex'),
        jsonb_build_object('fixture', 'workspace-mutation-2'), pg_catalog.sha256(decode('02', 'hex')))`, [scopeA.accountId]);
    const otherEpoch = submittedSyncMutationSchema.parse({ ...submitted("epoch-2-note", 5, 0), activeLeaseEpoch: 2 });
    await expect(service.ingest(scopeA, pushRequest(otherEpoch))).resolves.toMatchObject({
      accepted: false, code: "MUTATION_FIELD_STALE", failures: [{ fieldPath: "note", lastModifiedRevision: 2 }],
    });
  });

  it("commits a single-item business rejection with its sequence and replays the stored result", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const tags = (id: string, sequence: number, base: number) => submittedSyncMutationSchema.parse({
      ...submitted(id, sequence, base), changedFields: [{ fieldPath: "tags", value: [id] }],
    });
    await expect(service.ingest(scopeA, pushRequest(submitted("note-1", 1, 0), submitted("note-2", 2, 0))))
      .resolves.toMatchObject({ accepted: true });
    await expect(service.ingest(scopeA, pushRequest(tags("tags-from-2", 3, 2)))).resolves.toMatchObject({ accepted: true });
    const stale = tags("tags-from-1", 4, 1);
    const ledger = () => transactions.withTenant(scopeA, (transaction) => transaction.query<{
      device_mutation_sequence: string; outcome: string; server_revision: string | null;
      rejection_code: string | null; rejected_envelope_digest: Buffer | null; accepted_at: Date | null;
    }>(`SELECT device_mutation_sequence, outcome, server_revision, rejection_code, rejected_envelope_digest, accepted_at
        FROM workspace_device_mutation_sequence_ledger ORDER BY device_mutation_sequence`));
    const head = () => transactions.withTenant(scopeA, (transaction) => transaction.query<{
      contiguous_received_through: string; server_revision: string;
    }>(`SELECT h.contiguous_received_through, r.server_revision
        FROM workspace_device_mutation_heads AS h CROSS JOIN workspace_revisions AS r
        WHERE h.source_device_id = 'device-1'`));

    // A multi-item batch still rolls back and leaves no rejection receipt.
    await expect(service.ingest(scopeA, pushRequest(stale, submitted("note-5", 5, 3))))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_FIELD_STALE" });
    expect((await ledger()).rows.map((row) => row.outcome)).toEqual(["accepted", "accepted", "accepted"]);

    await expect(service.ingest(scopeA, pushRequest(stale))).resolves.toMatchObject({
      accepted: false, code: "MUTATION_FIELD_STALE", failures: [{ fieldPath: "tags", lastModifiedRevision: 3 }],
    });
    const recorded = (await ledger()).rows[3];
    const tenantStale = submittedSyncMutationSchema.parse({ ...stale, workspaceId: scopeA.workspaceId });
    expect(recorded).toMatchObject({
      device_mutation_sequence: "4", outcome: "rejected", server_revision: null,
      rejection_code: "MUTATION_FIELD_STALE", accepted_at: null,
    });
    expect(recorded?.rejected_envelope_digest?.equals(
      createHash("sha256").update(encodeDrainStreamEnvelope("mutation", tenantStale)).digest(),
    )).toBe(true);
    // The rejection ends sequence 4 without allocating a server revision.
    await expect(head()).resolves.toMatchObject({ rows: [{ contiguous_received_through: "4", server_revision: "3" }] });

    // Exact replay returns the stored rejection; differing content cannot reuse the id or sequence.
    await expect(service.ingest(scopeA, pushRequest(stale))).resolves.toEqual({
      accepted: false, code: "MUTATION_FIELD_STALE", failures: [{ index: 0, mutationId: "tags-from-1" }],
    });
    await expect(service.ingest(scopeA, pushRequest(tags("tags-from-1", 4, 3))))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_ID_CONFLICT" });
    await expect(service.ingest(scopeA, pushRequest(submitted("other-4", 4, 3))))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_SEQUENCE_CONFLICT" });
    expect((await ledger()).rows).toHaveLength(4);

    await expect(service.ingest(scopeA, pushRequest(submitted("note-5", 5, 3)))).resolves.toMatchObject({ accepted: true, headRevision: 4 });
    await expect(head()).resolves.toMatchObject({ rows: [{ contiguous_received_through: "5", server_revision: "4" }] });

    // The result union is enforced by the database for the app role, and history stays immutable.
    const insertAs = (outcome: string, serverRevision: number | null, code: string | null, digest: Buffer | null) =>
      transactions.withTenant(scopeA, (transaction) => transaction.query(`INSERT INTO workspace_device_mutation_sequence_ledger (
        account_id, workspace_id, source_device_id, device_mutation_sequence, mutation_id, active_lease_epoch,
        wire_schema_version, wire_mutation_digest, server_revision, accepted_at, outcome, rejection_code,
        rejected_at, rejected_envelope_digest
      ) VALUES ($1, $2, 'device-1', 99, 'forged-99', 1, 2, $3, $4,
        CASE WHEN $5 = 'accepted' THEN transaction_timestamp() END, $5, $6,
        CASE WHEN $5 = 'rejected' THEN transaction_timestamp() END, $7)`,
      [scopeA.accountId, scopeA.workspaceId, Buffer.alloc(32, 1), serverRevision, outcome, code, digest]));
    await expect(insertAs("rejected", 4, "MUTATION_FIELD_STALE", Buffer.alloc(32, 2))).rejects.toMatchObject({ code: "23514" });
    await expect(insertAs("accepted", null, null, null)).rejects.toMatchObject({ code: "23514" });
    await expect(insertAs("rejected", null, "MUTATION_BASE_REVISION_AHEAD", Buffer.alloc(32, 2))).rejects.toMatchObject({ code: "23514" });
    await expect(insertAs("accepted", 999, null, null)).rejects.toMatchObject({ code: "23503" });
    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(
      `UPDATE workspace_device_mutation_sequence_ledger SET rejection_code = 'MUTATION_ENTITY_UNKNOWN'
       WHERE device_mutation_sequence = 4`,
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("seals a v2 proof over accepted and rejected results, refuses the v1 chain, and records no rejection after the seal", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const tags = (id: string, sequence: number, base: number) => submittedSyncMutationSchema.parse({
      ...submitted(id, sequence, base), changedFields: [{ fieldPath: "tags", value: [id] }],
    });
    await service.ingest(scopeA, pushRequest(submitted("note-1", 1, 0), submitted("note-2", 2, 0)));
    await service.ingest(scopeA, pushRequest(tags("tags-from-2", 3, 2)));
    const stale = tags("tags-from-1", 4, 1);
    await expect(service.ingest(scopeA, pushRequest(stale))).resolves.toMatchObject({ code: "MUTATION_FIELD_STALE" });
    await expect(service.ingest(scopeA, pushRequest(submitted("note-5", 5, 3)))).resolves.toMatchObject({ accepted: true });

    const records = await withOwnerTenant(scopeA, (transaction) => transaction.query<{
      device_mutation_sequence: string; canonical_envelope: Buffer;
    }>(`SELECT device_mutation_sequence, canonical_envelope FROM mutation_drain_records
        WHERE source_device_id = 'device-1' AND active_lease_epoch = 1 ORDER BY device_mutation_sequence`));
    expect(records.rows.map((row) => row.device_mutation_sequence)).toEqual(["1", "2", "3", "5"]);
    const sha = (value: Uint8Array) => createHash("sha256").update(value).digest();
    const envelopes = new Map(records.rows.map((row) => [Number(row.device_mutation_sequence), row.canonical_envelope]));
    envelopes.set(4, Buffer.from(encodeDrainStreamEnvelope("mutation",
      submittedSyncMutationSchema.parse({ ...stale, workspaceId: scopeA.workspaceId }))));
    let v2Digest: Buffer = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
    for (const sequence of [1, 2, 3, 4, 5]) {
      v2Digest = sha(encodeDrainChainStepInput(v2Digest, encodeMutationDrainResultEnvelope({
        outcome: sequence === 4 ? "rejected" : "accepted",
        submittedEnvelopeDigest: sha(envelopes.get(sequence)!),
      })));
    }
    const v1Head = await withOwnerTenant(scopeA, (transaction) => transaction.query<{ rolling_digest: Buffer }>(`
      SELECT rolling_digest FROM mutation_drain_heads WHERE source_device_id = 'device-1' AND active_lease_epoch = 1`));
    const v1Digest = v1Head.rows[0]?.rolling_digest;
    if (v1Digest === undefined) throw new TypeError("v1 head is absent");

    await seedDirectMutationSealAuthority();
    const sealOnce = (proofId: string) => transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(`SELECT accepted FROM public.device_consume_drain_proof(
        $1::text, $2::bytea, $3::text, $4::bigint, $5::text)`,
      [proofId, Buffer.alloc(32, 6), "direct-app-seal-workflow", 1, "device-2"]);
      const installed = await transaction.query<{ accepted: boolean }>(
        `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`, [proofId]);
      if (installed.rows[0]?.accepted !== true) throw new Error(`seal refused for ${proofId}`);
    });
    // v1 cannot express the rejected sequence 4, so no v1 claim through 5 can seal.
    await seedDirectMutationSealProof("v1-over-rejection", 5, v1Digest);
    await expect(sealOnce("v1-over-rejection")).rejects.toThrow("seal refused for v1-over-rejection");
    await seedDirectMutationSealProof("v2-over-rejection", 5, v2Digest, 2);
    await expect(sealOnce("v2-over-rejection")).resolves.toBeUndefined();

    // The sealed domain is final: a later business rejection cannot extend its evidence, whether
    // it arrives through ingest or a direct repository append.
    const ledgerState = () => transactions.withTenant(scopeA, (transaction) => transaction.query<{
      rows: number; contiguous: string;
    }>(`SELECT (SELECT count(*)::int FROM workspace_device_mutation_sequence_ledger) AS rows,
        (SELECT contiguous_received_through::text FROM workspace_device_mutation_heads
         WHERE source_device_id = 'device-1') AS contiguous`));
    await expect(ledgerState()).resolves.toMatchObject({ rows: [{ rows: 5, contiguous: "5" }] });
    const afterSeal = tags("tags-after-seal", 6, 1);
    await expect(service.ingest(scopeA, pushRequest(afterSeal))).rejects.toThrow("mutation drain domain is sealed");
    await expect(transactions.withTenant(scopeA, async (transaction) => {
      const lock = await mutations.lockDrainDomain(transaction, domain());
      await mutations.appendRejected(transaction, lock,
        submittedSyncMutationSchema.parse({ ...afterSeal, workspaceId: scopeA.workspaceId }), "MUTATION_FIELD_STALE");
    })).rejects.toThrow("mutation drain domain is sealed");
    await expect(ledgerState()).resolves.toMatchObject({ rows: [{ rows: 5, contiguous: "5" }] });
  });

  it("seals a v2 proof over the device's global sequence after a Lease rotation", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    await service.ingest(scopeA, pushRequest(submitted("note-1", 1, 0), submitted("note-2", 2, 0)));
    await rotateDeviceOneLeaseToEpochTwo();
    // Sequences continue globally under epoch 2: 3 is a recorded rejection, 4 is accepted.
    const atEpoch2 = (mutation: ReturnType<typeof submitted>) =>
      submittedSyncMutationSchema.parse({ ...mutation, activeLeaseEpoch: 2 });
    const stale = atEpoch2(submitted("note-from-1", 3, 1));
    await expect(service.ingest(scopeA, pushRequest(stale))).resolves.toMatchObject({ code: "MUTATION_FIELD_STALE" });
    const next = atEpoch2(submittedSyncMutationSchema.parse({
      ...submitted("tags-4", 4, 2), changedFields: [{ fieldPath: "tags", value: ["four"] }],
    }));
    await expect(service.ingest(scopeA, pushRequest(next))).resolves.toMatchObject({ accepted: true });

    const records = await withOwnerTenant(scopeA, (transaction) => transaction.query<{
      device_mutation_sequence: string; canonical_envelope: Buffer;
    }>(`SELECT device_mutation_sequence, canonical_envelope FROM mutation_drain_records
        WHERE source_device_id = 'device-1' ORDER BY device_mutation_sequence`));
    expect(records.rows.map((row) => row.device_mutation_sequence)).toEqual(["1", "2", "4"]);
    const sha = (value: Uint8Array) => createHash("sha256").update(value).digest();
    const envelopes = new Map(records.rows.map((row) => [Number(row.device_mutation_sequence), row.canonical_envelope]));
    envelopes.set(3, Buffer.from(encodeDrainStreamEnvelope("mutation",
      submittedSyncMutationSchema.parse({ ...stale, workspaceId: scopeA.workspaceId }))));
    const chain = (sequences: readonly number[]) => {
      let digest: Buffer = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
      for (const sequence of sequences) {
        digest = sha(encodeDrainChainStepInput(digest, encodeMutationDrainResultEnvelope({
          outcome: sequence === 3 ? "rejected" : "accepted",
          submittedEnvelopeDigest: sha(envelopes.get(sequence)!),
        })));
      }
      return digest;
    };

    await seedDirectMutationSealAuthority(2);
    const sealOnce = (proofId: string) => transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(`SELECT accepted FROM public.device_consume_drain_proof(
        $1::text, $2::bytea, $3::text, $4::bigint, $5::text)`,
      [proofId, Buffer.alloc(32, 6), "direct-app-seal-workflow", 1, "device-2"]);
      const installed = await transaction.query<{ accepted: boolean }>(
        `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`, [proofId]);
      if (installed.rows[0]?.accepted !== true) throw new Error(`seal refused for ${proofId}`);
    });
    // A chain restarted inside epoch 2 is not the device's global chain and must not seal.
    await seedDirectMutationSealProof("v2-epoch-only", 4, chain([3, 4]), 2, 2);
    await expect(sealOnce("v2-epoch-only")).rejects.toThrow("seal refused for v2-epoch-only");
    await seedDirectMutationSealProof("v2-global", 4, chain([1, 2, 3, 4]), 2, 2);
    await expect(sealOnce("v2-global")).resolves.toBeUndefined();
    const seal = await withOwnerTenant(scopeA, (transaction) => transaction.query<{
      active_lease_epoch: string; last_assigned_device_mutation_sequence: string; proof_schema_version: number;
    }>(`SELECT active_lease_epoch, last_assigned_device_mutation_sequence, proof_schema_version
        FROM mutation_drain_seals WHERE source_device_id = 'device-1'`));
    expect(seal.rows).toEqual([{ active_lease_epoch: "2", last_assigned_device_mutation_sequence: "4", proof_schema_version: 2 }]);
  });

  it("rolls a business rejection back on a storage fault and records it exactly once on retry", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const faulted = new PostgresWorkspaceMutationIngest({
      transactions, authority, revisions, portfolio, mutations,
      fault(point) { if (point === "after_rejection_record") throw new Error("rejection-fault"); },
    });
    const tags = (id: string, sequence: number, base: number) => submittedSyncMutationSchema.parse({
      ...submitted(id, sequence, base), changedFields: [{ fieldPath: "tags", value: [id] }],
    });
    await service.ingest(scopeA, pushRequest(submitted("note-1", 1, 0), submitted("note-2", 2, 0)));
    await service.ingest(scopeA, pushRequest(tags("tags-from-2", 3, 2)));
    const stale = tags("tags-from-1", 4, 1);
    const state = () => transactions.withTenant(scopeA, (transaction) => transaction.query<{
      outcomes: string[]; contiguous: string; revision: string;
    }>(`SELECT
        (SELECT array_agg(outcome ORDER BY device_mutation_sequence) FROM workspace_device_mutation_sequence_ledger) AS outcomes,
        (SELECT contiguous_received_through::text FROM workspace_device_mutation_heads WHERE source_device_id = 'device-1') AS contiguous,
        (SELECT server_revision::text FROM workspace_revisions) AS revision`));

    // The fault lands after the ledger row and before the head advances; the client only sees a
    // retryable error and no rejection evidence survives.
    await expect(faulted.ingest(scopeA, pushRequest(stale))).rejects.toThrow("rejection-fault");
    await expect(state()).resolves.toMatchObject({
      rows: [{ outcomes: ["accepted", "accepted", "accepted"], contiguous: "3", revision: "3" }],
    });
    // The client retries the same frozen request and the rejection is recorded exactly once.
    await expect(service.ingest(scopeA, pushRequest(stale)))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_FIELD_STALE" });
    await expect(service.ingest(scopeA, pushRequest(stale)))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_FIELD_STALE" });
    await expect(state()).resolves.toMatchObject({
      rows: [{ outcomes: ["accepted", "accepted", "accepted", "rejected"], contiguous: "4", revision: "3" }],
    });
  });

  it("lets a racing acceptance and rejection of one device sequence occupy it only once", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const tags = (id: string, sequence: number, base: number) => submittedSyncMutationSchema.parse({
      ...submitted(id, sequence, base), changedFields: [{ fieldPath: "tags", value: [id] }],
    });
    await service.ingest(scopeA, pushRequest(submitted("note-1", 1, 0), submitted("note-2", 2, 0)));
    await service.ingest(scopeA, pushRequest(tags("tags-from-2", 3, 2)));
    // Both claim sequence 4: one is stale and would be recorded as rejected, the other would be
    // accepted. The global device head lock orders them and the loser resolves the winner's
    // result as a sequence conflict before any business re-evaluation.
    const rejectable = tags("tags-from-1", 4, 1);
    const acceptable = submitted("note-4", 4, 3);
    const results = await Promise.all([
      service.ingest(scopeA, pushRequest(rejectable)),
      service.ingest(scopeA, pushRequest(acceptable)),
    ]);
    const conflicts = results.filter((result) => !result.accepted && result.code === "MUTATION_SEQUENCE_CONFLICT");
    const winners = results.filter((result) => result.accepted || result.code === "MUTATION_FIELD_STALE");
    expect(conflicts).toHaveLength(1);
    expect(winners).toHaveLength(1);
    const stored = await transactions.withTenant(scopeA, (transaction) => transaction.query<{
      mutation_id: string; outcome: string;
    }>(`SELECT mutation_id, outcome FROM workspace_device_mutation_sequence_ledger WHERE device_mutation_sequence = 4`));
    expect(stored.rows).toEqual([winners[0]!.accepted
      ? { mutation_id: "note-4", outcome: "accepted" }
      : { mutation_id: "tags-from-1", outcome: "rejected" }]);
    const receipts = await transactions.withTenant(scopeA, (transaction) => transaction.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM workspace_mutation_receipts WHERE device_mutation_sequence = 4"));
    expect(receipts.rows).toEqual([{ count: winners[0]!.accepted ? 1 : 0 }]);
  });

  it("rejects hidden symbol accessor inherited custom-prototype and sparse wire values before tenant transaction entry", async () => {
    let withTenantCalls = 0;
    let getterCalls = 0;
    const rejectingTransactions = {
      withTenant() {
        withTenantCalls += 1;
        throw new Error("malformed mutation reached tenant transaction entry");
      },
    } as unknown as TenantTransactionRunner;
    const service = new PostgresWorkspaceMutationIngest({
      transactions: rejectingTransactions,
      authority,
      revisions,
      portfolio,
      mutations,
    });
    const mutation = submitted("strict-wire", 1, 0);
    const request = pushRequest(mutation);

    const hiddenRoot = Object.defineProperty({ ...request }, "hidden", { value: true });
    const hiddenMutation = Object.defineProperty({ ...mutation }, "hidden", { value: true });
    const symbolRoot = { ...request, [Symbol("hidden")]: true };
    const accessorMutation = Object.defineProperty({ ...mutation }, "workspaceId", {
      enumerable: true,
      get() { getterCalls += 1; return scopeA.workspaceId; },
    });
    const inheritedRoot = Object.assign(Object.create({ inherited: true }) as object, request);
    const customPrototypeMutation = Object.assign(Object.create({ inherited: true }) as object, mutation);
    const customPrototypeMutations = [mutation];
    Object.setPrototypeOf(customPrototypeMutations, Object.create(Array.prototype));
    const sparseMutations = new Array(1);
    const customPrototypeFields = [...mutation.changedFields];
    Object.setPrototypeOf(customPrototypeFields, Object.create(Array.prototype));
    const sparseFields = new Array(1);

    const malformed: readonly unknown[] = [
      hiddenRoot,
      { ...request, mutations: [hiddenMutation] },
      symbolRoot,
      { ...request, mutations: [accessorMutation] },
      inheritedRoot,
      { ...request, mutations: [customPrototypeMutation] },
      { ...request, mutations: customPrototypeMutations },
      { ...request, mutations: sparseMutations },
      { ...request, mutations: [{ ...mutation, changedFields: customPrototypeFields }] },
      { ...request, mutations: [{ ...mutation, changedFields: sparseFields }] },
    ];
    for (const value of malformed) {
      await expect(service.ingest(scopeA, value)).resolves.toEqual({
        accepted: false,
        code: "MUTATION_MALFORMED",
      });
    }
    expect(withTenantCalls).toBe(0);
    expect(getterCalls).toBe(0);
  });

  it("rejects expired Lease authority at the database-time boundary before mutation state changes", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));

    await transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(
        `UPDATE device_active_leases
         SET online_expires_at = transaction_timestamp() - interval '1 second',
             offline_execute_until = transaction_timestamp()
         WHERE account_id = $1 AND lease_epoch = 1`,
        [scopeA.accountId],
      );
      await expect(authority.lockAndValidateActiveLease(transaction, domain())).resolves.toBe(false);
    });

    await transactions.withTenant(scopeA, (transaction) => transaction.query(
      `UPDATE device_active_leases
       SET online_expires_at = transaction_timestamp() - interval '1 second',
           offline_execute_until = transaction_timestamp() - interval '1 microsecond'
       WHERE account_id = $1 AND lease_epoch = 1`,
      [scopeA.accountId],
    ));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const expiredMutation = submitted("mutation-expired-lease", 1, 0);
    await expect(service.ingest(scopeA, pushRequest(expiredMutation)))
      .resolves.toMatchObject({ accepted: false, code: "MUTATION_DEVICE_NOT_ACTIVE" });

    await transactions.withTenant(scopeA, async (transaction) => {
      const counts = await transaction.query<{
        receipts: string; replay: string; fields: string; drainRecords: string; drainHeads: string;
      }>(`
        SELECT
          (SELECT count(*) FROM workspace_mutation_receipts)::text AS receipts,
          (SELECT count(*) FROM workspace_mutations)::text AS replay,
          (SELECT count(*) FROM workspace_mutation_fields)::text AS fields,
          (SELECT count(*) FROM mutation_drain_records)::text AS "drainRecords",
          (SELECT count(*) FROM mutation_drain_heads)::text AS "drainHeads"`);
      expect(counts.rows[0]).toEqual({
        receipts: "0", replay: "0", fields: "0", drainRecords: "0", drainHeads: "0",
      });
      await expect(revisions.read(transaction)).resolves.toMatchObject({ serverRevision: 0 });
      await expect(portfolio.captureSnapshot(transaction)).resolves.toEqual([{
        entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
      }]);
    });

    await transactions.withTenant(scopeA, (transaction) => transaction.query(
      `UPDATE device_active_leases
       SET offline_execute_until = transaction_timestamp() + interval '1 hour'
       WHERE account_id = $1 AND lease_epoch = 1`,
      [scopeA.accountId],
    ));
    const futureMutation = submitted("mutation-future-lease", 1, 0);
    await expect(service.ingest(scopeA, pushRequest(futureMutation)))
      .resolves.toMatchObject({ accepted: true, headRevision: 1 });
  });

  it("binds direct app drain routines to the current active device Lease and proof-only sealing", async () => {
    const directLock = (sourceDeviceId: string, activeLeaseEpoch: number) => transactions.withTenant(
      scopeA,
      (transaction) => transaction.query(
        `SELECT contiguous_received_through, highest_received_sequence, rolling_digest, sealed
         FROM public.workspace_mutation_drain_lock_domain($1::text, $2::bigint)`,
        [sourceDeviceId, activeLeaseEpoch],
      ),
    );
    const directAppend = (sourceDeviceId: string, activeLeaseEpoch: number, envelope: Buffer) => transactions.withTenant(
      scopeA,
      (transaction) => transaction.query<{ envelope_digest: Buffer }>(
        `SELECT public.workspace_mutation_drain_append_record(
           $1::text, $2::bigint, 1::bigint, $3::bytea
         ) AS envelope_digest`,
        [sourceDeviceId, activeLeaseEpoch, envelope],
      ),
    );
    const counts = () => transactions.withTenant(scopeA, (transaction) => transaction.query<{
      heads: string; records: string; seals: string;
    }>(`
      SELECT
        (SELECT count(*) FROM mutation_drain_heads)::text AS heads,
        (SELECT count(*) FROM mutation_drain_records)::text AS records,
        (SELECT count(*) FROM mutation_drain_seals)::text AS seals`));
    const expectNoDrainState = async () => {
      await expect(counts()).resolves.toMatchObject({
        rows: [{ heads: "0", records: "0", seals: "0" }],
      });
    };

    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query<{ permitted: boolean }>(
      `SELECT pg_catalog.has_function_privilege(
         current_user,
         'public.workspace_mutation_drain_assert_active_domain(text, bigint)',
         'EXECUTE'
       ) AS permitted`,
    ))).resolves.toMatchObject({ rows: [{ permitted: false }] });

    // Both selector halves are well-formed: neither a missing binding nor a bound-but-not-held
    // device can create a head through a direct app-role EXECUTE.
    await expect(directLock("arbitrary-device", 1)).rejects.toMatchObject({ code: "42501" });
    await transactions.withTenant(scopeA, (transaction) => transaction.query(`INSERT INTO device_bindings
      (account_id, device_id, slot, status, credential_epoch)
      VALUES ($1, 'device-2', 2, 'bound', 1)`, [scopeA.accountId]));
    await expect(directLock("device-2", 1)).rejects.toMatchObject({ code: "42501" });
    await expectNoDrainState();

    // The device and epoch are correct here, but an expired offline execution window is not an
    // active Lease. The failed direct routine rolls this fixture mutation back as well.
    await expect(transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(`UPDATE device_active_leases
        SET online_expires_at = transaction_timestamp() - interval '2 microseconds',
            offline_execute_until = transaction_timestamp() - interval '1 microsecond'
        WHERE account_id = $1 AND lease_epoch = 1`, [scopeA.accountId]);
      return transaction.query(`SELECT *
        FROM public.workspace_mutation_drain_lock_domain($1::text, $2::bigint)`, ["device-1", 1]);
    })).rejects.toMatchObject({ code: "42501" });
    await expectNoDrainState();

    // A released Lease is equally unavailable, even while its allocation remains activated.
    await expect(transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(`UPDATE device_active_leases
        SET released_at = transaction_timestamp(), release_reason = 'test-direct-routine'
        WHERE account_id = $1 AND lease_epoch = 1`, [scopeA.accountId]);
      return transaction.query(`SELECT *
        FROM public.workspace_mutation_drain_lock_domain($1::text, $2::bigint)`, ["device-1", 1]);
    })).rejects.toMatchObject({ code: "42501" });
    await expectNoDrainState();

    await seedDirectMutationSealAuthority();

    // An existing but unconsumed proof cannot supply a selector, create a head, append a record,
    // or install a seal. This is a direct app-role call rather than a missing-proof shortcut.
    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query<{ accepted: boolean }>(
      `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`,
      ["direct-app-mismatched-proof"],
    ))).resolves.toMatchObject({ rows: [{ accepted: false }] });
    await expectNoDrainState();

    // A validly consumable but stream-mismatched proof must return false before materializing a
    // head. The application transaction owns proof consumption, so roll it back exactly as the
    // transition refusal does and prove neither the proof marker nor the ledger state survives.
    await expect(transactions.withTenant(scopeA, async (transaction) => {
      const consumed = await transaction.query<{ accepted: boolean }>(`
        SELECT accepted FROM public.device_consume_drain_proof(
          $1::text, $2::bytea, $3::text, $4::bigint, $5::text
        )`, ["direct-app-mismatched-proof", Buffer.alloc(32, 6), "direct-app-seal-workflow", 1, "device-2"]);
      const installed = await transaction.query<{ accepted: boolean }>(
        `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`,
        ["direct-app-mismatched-proof"],
      );
      expect({ consumed: consumed.rows[0]?.accepted, installed: installed.rows[0]?.accepted })
        .toEqual({ consumed: true, installed: false });
      const duringRefusal = await transaction.query<{ heads: string; records: string; seals: string }>(`
        SELECT
          (SELECT count(*) FROM mutation_drain_heads)::text AS heads,
          (SELECT count(*) FROM mutation_drain_records)::text AS records,
          (SELECT count(*) FROM mutation_drain_seals)::text AS seals`);
      expect(duringRefusal.rows).toEqual([{ heads: "0", records: "0", seals: "0" }]);
      throw new Error("direct mutation seal refusal rolls back proof consumption");
    })).rejects.toThrow("direct mutation seal refusal rolls back proof consumption");
    await expectNoDrainState();
    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query<{ consumed: boolean }>(`
      SELECT consumed_at IS NOT NULL AS consumed
      FROM device_drain_proofs WHERE proof_id = 'direct-app-mismatched-proof'`)))
      .resolves.toMatchObject({ rows: [{ consumed: false }] });

    const envelope = Buffer.from("direct-app-authorized-mutation", "utf8");
    const appended = await directAppend("device-1", 1, envelope);
    expect(appended.rows).toHaveLength(1);
    expect(appended.rows[0]?.envelope_digest.equals(
      createHash("sha256").update(envelope).digest(),
    )).toBe(true);
    const head = await transactions.withTenant(scopeA, (transaction) => transaction.query<{ rolling_digest: Buffer }>(`
      SELECT rolling_digest FROM mutation_drain_heads
      WHERE source_device_id = 'device-1' AND active_lease_epoch = 1`));
    const rollingDigest = head.rows[0]?.rolling_digest;
    if (rollingDigest === undefined) throw new TypeError("direct mutation seal test head is absent");
    await seedDirectMutationSealProof("direct-app-valid-proof", 1, rollingDigest);

    // Matching claims materialize and seal once; repeating the proof-only call within the same
    // transaction is exact replay, not a caller-supplied seal fallback.
    const valid = await transactions.withTenant(scopeA, async (transaction) => {
      const consumed = await transaction.query<{ accepted: boolean }>(`
        SELECT accepted FROM public.device_consume_drain_proof(
          $1::text, $2::bytea, $3::text, $4::bigint, $5::text
        )`, ["direct-app-valid-proof", Buffer.alloc(32, 6), "direct-app-seal-workflow", 1, "device-2"]);
      const first = await transaction.query<{ accepted: boolean }>(
        `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`,
        ["direct-app-valid-proof"],
      );
      const replay = await transaction.query<{ accepted: boolean }>(
        `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`,
        ["direct-app-valid-proof"],
      );
      return {
        consumed: consumed.rows[0]?.accepted,
        first: first.rows[0]?.accepted,
        replay: replay.rows[0]?.accepted,
      };
    });
    expect(valid).toEqual({ consumed: true, first: true, replay: true });
    await expect(counts()).resolves.toMatchObject({
      rows: [{ heads: "1", records: "1", seals: "1" }],
    });
  });

  it("seals a v2 proof only against the accepted result chain rebuilt from retained v1 evidence", async () => {
    await seedDirectMutationSealAuthority();
    const envelopes = [Buffer.from("v2-chain-one", "utf8"), Buffer.from("v2-chain-two", "utf8")];
    for (const [index, envelope] of envelopes.entries()) {
      await transactions.withTenant(scopeA, (transaction) => transaction.query(
        `SELECT public.workspace_mutation_drain_append_record($1::text, $2::bigint, $3::bigint, $4::bytea)`,
        ["device-1", 1, index + 1, envelope],
      ));
    }
    const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest();
    let v2Digest = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
    for (const envelope of envelopes) {
      v2Digest = sha256(encodeDrainChainStepInput(
        v2Digest,
        encodeMutationDrainResultEnvelope({ outcome: "accepted", submittedEnvelopeDigest: sha256(envelope) }),
      ));
    }
    const v1Head = await transactions.withTenant(scopeA, (transaction) => transaction.query<{ rolling_digest: Buffer }>(`
      SELECT rolling_digest FROM mutation_drain_heads
      WHERE source_device_id = 'device-1' AND active_lease_epoch = 1`));
    const v1Digest = v1Head.rows[0]?.rolling_digest;
    if (v1Digest === undefined) throw new TypeError("v2 seal test head is absent");
    expect(v1Digest.equals(v2Digest)).toBe(false);

    const sealOnce = (proofId: string) => transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(`SELECT accepted FROM public.device_consume_drain_proof(
        $1::text, $2::bytea, $3::text, $4::bigint, $5::text)`,
      [proofId, Buffer.alloc(32, 6), "direct-app-seal-workflow", 1, "device-2"]);
      const installed = await transaction.query<{ accepted: boolean }>(
        `SELECT public.workspace_mutation_drain_install_accepted_seal($1::text) AS accepted`, [proofId]);
      if (installed.rows[0]?.accepted !== true) throw new Error(`seal refused for ${proofId}`);
      return transaction.query<{ rolling_digest: Buffer; proof_schema_version: number }>(`
        SELECT rolling_digest, proof_schema_version FROM mutation_drain_seals WHERE proof_id = $1`, [proofId]);
    });

    // A v2 proof that claims the v1 digest of the same records is never verified against v1.
    await seedDirectMutationSealProof("v2-claims-v1-digest", 2, v1Digest, 2);
    await expect(sealOnce("v2-claims-v1-digest")).rejects.toThrow("seal refused for v2-claims-v1-digest");
    await seedDirectMutationSealProof("v1-claims-v2-digest", 2, v2Digest);
    await expect(sealOnce("v1-claims-v2-digest")).rejects.toThrow("seal refused for v1-claims-v2-digest");

    await seedDirectMutationSealProof("v2-valid", 2, v2Digest, 2);
    const sealed = await sealOnce("v2-valid");
    expect(sealed.rows).toHaveLength(1);
    expect(sealed.rows[0]?.proof_schema_version).toBe(2);
    expect(sealed.rows[0]?.rolling_digest.equals(v2Digest)).toBe(true);

    // Retained v1 evidence is unchanged: the derived head still carries the v1 chain and the
    // unconsumed historical proof row defaulted to schema v1.
    const retained = await withOwnerTenant(scopeA, (transaction) => transaction.query<{
      rolling_digest: Buffer; historical_version: number;
    }>(`SELECT h.rolling_digest,
        (SELECT proof_schema_version FROM device_drain_proofs WHERE proof_id = 'direct-app-mismatched-proof') AS historical_version
      FROM mutation_drain_heads AS h WHERE h.source_device_id = 'device-1' AND h.active_lease_epoch = 1`));
    expect(retained.rows[0]?.rolling_digest.equals(v1Digest)).toBe(true);
    expect(retained.rows[0]?.historical_version).toBe(1);
  });

  it("serializes a real Drain transition against mutation ingest with one coherent winner", async () => {
    await seedDrainRace();
    const ingest = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const drain = new PostgresDeviceDrainTransition(
      transactions,
      new PostgresIdentityAccountSecurityStatePort(),
      new PostgresMutationDrainLedger(),
      new PostgresExecutionFactDrainLedger(),
      new PostgresWorkspaceDeviceAuditDrainLedger(),
    );
    const blocker = await appPool.connect();
    let drainAttempt: ReturnType<typeof drain.commit> | undefined;
    let ingestAttempt: ReturnType<typeof ingest.ingest> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT set_config('gooddealer.account_id', $1, true)", [scopeA.accountId]);
      await blocker.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scopeA.workspaceId]);
      await blocker.query("SELECT 1 FROM device_account_states WHERE account_id = $1 FOR UPDATE", [scopeA.accountId]);

      ingestAttempt = ingest.ingest(scopeA, pushRequest(submitted("mutation-race", 1, 0)));
      await waitForBlockedTransactions(blocker, 1);
      drainAttempt = drain.commit({
        ...scopeA,
        workflowId: "mutation-race-workflow",
        expectedWorkflowRevision: 1,
        targetDeviceId: "device-2",
        proofId: "mutation-race-proof",
        proofDigest: Buffer.alloc(32, 9).toString("base64url"),
        bootstrapCapabilityJti: "mutation-race-capability",
      });
      await waitForBlockedTransactions(blocker, 2);
      await blocker.query("COMMIT");
    } catch (error) {
      await blocker.query("ROLLBACK");
      const attempts: Promise<unknown>[] = [];
      if (drainAttempt !== undefined) attempts.push(drainAttempt);
      if (ingestAttempt !== undefined) attempts.push(ingestAttempt);
      await Promise.allSettled(attempts);
      throw error;
    } finally {
      blocker.release();
    }

    const [drainResult, ingestResult] = await Promise.all([drainAttempt, ingestAttempt]);
    const drainWon = drainResult.status === "bootstrapping";
    const ingestWon = ingestResult.accepted;
    expect([drainWon, ingestWon].filter(Boolean)).toHaveLength(1);
    expect(drainResult).toEqual({ status: "rejected", reason: "STREAM_HEAD_CONFLICT" });
    expect(ingestResult).toMatchObject({ accepted: true, headRevision: 1 });

    await transactions.withTenant(scopeA, async (transaction) => {
      const state = await transaction.query<{
        consumed: boolean; released: boolean; workflowStatus: string; mutationSeals: string;
        receipts: string; replay: string; drainRecords: string; headSequence: string; revision: string;
      }>(`
        SELECT
          p.consumed_at IS NOT NULL AS consumed,
          l.released_at IS NOT NULL AS released,
          w.status AS "workflowStatus",
          (SELECT count(*) FROM mutation_drain_seals)::text AS "mutationSeals",
          (SELECT count(*) FROM workspace_mutation_receipts)::text AS receipts,
          (SELECT count(*) FROM workspace_mutations)::text AS replay,
          (SELECT count(*) FROM mutation_drain_records)::text AS "drainRecords",
          h.contiguous_received_through::text AS "headSequence",
          r.server_revision::text AS revision
        FROM device_drain_proofs p
        JOIN device_active_leases l ON l.account_id = p.account_id
          AND l.lease_epoch = p.active_lease_epoch
        JOIN device_switch_workflows w ON w.account_id = p.account_id
          AND w.workspace_id = p.workspace_id AND w.workflow_id = p.workflow_id
        JOIN mutation_drain_heads h ON h.account_id = p.account_id AND h.workspace_id = p.workspace_id
          AND h.source_device_id = p.source_device_id AND h.active_lease_epoch = p.active_lease_epoch
        JOIN workspace_revisions r ON r.account_id = p.account_id AND r.workspace_id = p.workspace_id
        WHERE p.proof_id = 'mutation-race-proof'`);
      expect(state.rows).toHaveLength(1);
      expect(state.rows[0]).toEqual(drainWon ? {
        consumed: true,
        released: true,
        workflowStatus: "bootstrapping",
        mutationSeals: "1",
        receipts: "0",
        replay: "0",
        drainRecords: "0",
        headSequence: "0",
        revision: "0",
      } : {
        consumed: false,
        released: false,
        workflowStatus: "draining",
        mutationSeals: "0",
        receipts: "1",
        replay: "1",
        drainRecords: "1",
        headSequence: "1",
        revision: "1",
      });
    });
  });

  it("rolls materialization, receipt, replay, Drain, and revision back together on service faults", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({
      transactions,
      authority,
      revisions,
      portfolio,
      mutations,
      fault(point) { if (point === "after_materialization") throw new Error("materialization-fault"); },
    });
    const mutation = submitted("mutation-service-fault", 1, 0);
    await expect(service.ingest(scopeA, pushRequest(mutation))).rejects.toThrow("materialization-fault");
    const state = await transactions.withTenant(scopeA, async (transaction) => ({
      head: await revisions.read(transaction),
      rows: await portfolio.captureSnapshot(transaction),
      counts: (await transaction.query<{ receipts: string; replay: string; drain: string }>(`
        SELECT
          (SELECT count(*) FROM workspace_mutation_receipts)::text AS receipts,
          (SELECT count(*) FROM workspace_mutations)::text AS replay,
          (SELECT count(*) FROM mutation_drain_records)::text AS drain`)).rows[0],
    }));
    expect(state).toMatchObject({
      head: { serverRevision: 0 },
      rows: [{ entityId: "asset-1.test", note: null }],
      counts: { receipts: "0", replay: "0", drain: "0" },
    });
  });

  it("serializes concurrent duplicates and stale same-field writers while preserving different-field progress", async () => {
    await transactions.withTenant(scopeA, (transaction) => portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    }));
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const duplicate = submitted("concurrent-duplicate", 1, 0);
    const duplicateRequest = pushRequest(duplicate);
    const duplicateResults = await Promise.all([
      service.ingest(scopeA, duplicateRequest),
      service.ingest(scopeA, duplicateRequest),
    ]);
    expect(duplicateResults.every((result) => result.accepted)).toBe(true);
    expect(duplicateResults.map((result) => result.accepted && result.assignments[0]?.serverRevision))
      .toEqual([1, 1]);

    // Each was made without the other: whichever lands second is either not the later sequence
    // or names an older base than the first, so it is stale under either order.
    const sameField = [
      submitted("same-field-a", 2, 1),
      submitted("same-field-b", 3, 0),
    ];
    const sameFieldResults = await Promise.all(sameField.map((mutation) =>
      service.ingest(scopeA, pushRequest(mutation))));
    expect(sameFieldResults.filter((result) => result.accepted)).toHaveLength(1);
    expect(sameFieldResults.filter((result) => !result.accepted && result.code === "MUTATION_FIELD_STALE"))
      .toHaveLength(1);

    const head = (await transactions.withTenant(scopeA, (transaction) => revisions.read(transaction)))?.serverRevision;
    expect(head).toBe(2);
    const differentField = submittedSyncMutationSchema.parse({
      ...submitted("different-field", 4, 1),
      changedFields: [{ fieldPath: "tags", value: ["safe"] }],
    });
    await expect(service.ingest(scopeA, pushRequest(differentField)))
      .resolves.toMatchObject({ accepted: true, headRevision: 3 });
  });

  it("keeps receipts and Drain evidence permanently when replay rows are compacted", async () => {
    const mutation = submitted("mutation-compact", 1, 0);
    await append(scopeA, mutation, 1);
    await transactions.withTenant(scopeA, async (transaction) => {
      await transaction.query(
        `INSERT INTO workspace_checkpoints (
           account_id, workspace_id, checkpoint_id, schema_version,
           workspace_schema_version, through_server_revision, checkpoint_digest,
           capture_codec, capture_schema_version, status,
           verified_at, published_at
         ) VALUES ($1, $2, 'mutation-compaction-authority', 2, 1, 1,
           decode(repeat('00', 32), 'hex'), 'domain-asset-projection-v1', 1,
           'available', transaction_timestamp(), transaction_timestamp())`,
        [transaction.scope.accountId, transaction.scope.workspaceId],
      );
      await revisions.compareAndAdvanceCompactionWatermark(transaction, 0, 1);
      await expect(mutations.compactPrefix(transaction, 1)).resolves.toBe(1);
    });
    await transactions.withTenant(scopeA, async (transaction) => {
      const lock = await mutations.lockDrainDomain(transaction, domain());
      await expect(mutations.resolveReceipt(transaction, lock, mutation)).resolves.toMatchObject({ status: "exact" });
      await expect(mutations.readRange(transaction, 0, 1)).resolves.toEqual([]);
      const counts = await transaction.query<{ receipts: string; drain: string; replay: string; fields: string }>(`
        SELECT
          (SELECT count(*) FROM workspace_mutation_receipts)::text AS receipts,
          (SELECT count(*) FROM mutation_drain_records)::text AS drain,
          (SELECT count(*) FROM workspace_mutations)::text AS replay,
          (SELECT count(*) FROM workspace_mutation_fields)::text AS fields`);
      expect(counts.rows[0]).toEqual({ receipts: "1", drain: "1", replay: "0", fields: "0" });
    });
  });

  it("preserves gap semantics and advances the rolling digest only over a complete prefix", async () => {
    const second = submitted("mutation-second", 2, 0);
    await append(scopeA, second, 1);
    let head = await readHead(scopeA);
    expect(head).toMatchObject({ contiguous: "0", highest: "2" });
    expect(head.digest.toString("base64url")).toBe(DRAIN_STREAM_GENESIS_DIGEST);
    expect(await readGlobalHead(scopeA)).toEqual({
      contiguous: "0", highest: "2", rowVersion: "2", ledger: "1",
    });

    const first = submitted("mutation-first", 1, 0);
    await append(scopeA, first, 2);
    head = await readHead(scopeA);
    expect(head).toMatchObject({ contiguous: "2", highest: "2" });
    let digest = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
    for (const mutation of [first, second]) {
      digest = createHash("sha256")
        .update(encodeDrainChainStepInput(digest, encodeDrainStreamEnvelope("mutation", mutation)))
        .digest();
    }
    expect(head.digest.equals(digest)).toBe(true);
    expect(await readGlobalHead(scopeA)).toEqual({
      contiguous: "2", highest: "2", rowVersion: "3", ledger: "2",
    });
  });

  it("isolates identical ids and rejects forged tenant writes", async () => {
    const shared = submitted("same-mutation", 1, 0);
    await append(scopeA, shared, 1);
    await append(scopeB, shared, 1);
    for (const scope of [scopeA, scopeB]) {
      await transactions.withTenant(scope, async (transaction) => {
        await expect(mutations.readRange(transaction, 0, 1)).resolves.toHaveLength(1);
      });
    }
    await expect(transactions.withTenant(scopeB, (transaction) => transaction.query(
      `INSERT INTO workspace_mutation_receipts (
         account_id, workspace_id, mutation_id, source_device_id, active_lease_epoch,
         device_mutation_sequence, server_revision, submitted_envelope_digest
       ) VALUES ($1, $2, 'forged', 'device-1', 1, 9, 9, decode(repeat('00', 32), 'hex'))`,
      [scopeA.accountId, scopeA.workspaceId],
    ))).rejects.toThrow();
  });

  it("rejects conflicting receipts and malformed persisted replay rather than returning partial data", async () => {
    const mutation = submitted("mutation-stable", 1, 0);
    await append(scopeA, mutation, 1);
    await transactions.withTenant(scopeA, async (transaction) => {
      const lock = await mutations.lockDrainDomain(transaction, domain());
      await expect(mutations.resolveReceipt(transaction, lock, {
        ...mutation,
        changedFields: [{ fieldPath: "note", value: "different" }],
      })).resolves.toMatchObject({ status: "mutation_id_conflict" });
      await expect(mutations.resolveReceipt(transaction, lock, {
        ...mutation,
        mutationId: "different-id",
      })).resolves.toMatchObject({ status: "sequence_conflict" });
    });

    await ownerPool.query("BEGIN");
    try {
      await ownerPool.query("SELECT set_config('gooddealer.account_id', $1, true)", [scopeA.accountId]);
      await ownerPool.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scopeA.workspaceId]);
      await ownerPool.query(
        `UPDATE workspace_mutation_fields
         SET field_path = 'tags', value_is_null = false, text_value = NULL, tags_value = ARRAY['z', 'a']
         WHERE server_revision = 1`,
      );
      await ownerPool.query("COMMIT");
    } catch (error) {
      await ownerPool.query("ROLLBACK");
      throw error;
    }
    await transactions.withTenant(scopeA, async (transaction) => {
      await expect(mutations.readRange(transaction, 0, 1)).rejects.toThrow();
      await expect(mutations.hasCompleteRange(transaction, 0, 1)).resolves.toBe(false);
    });
  });

  it("rolls every mutation table and Drain head back on injected faults", async () => {
    for (const point of ["after_drain_append", "after_receipt_insert", "after_log_insert"] as const) {
      const mutation = submitted(`fault-${point}`, 1, 0);
      await expect(transactions.withTenant(scopeA, async (transaction) => {
        const lock = await mutations.lockDrainDomain(transaction, domain());
        await mutations.appendAccepted(transaction, lock, [{ mutation, serverRevision: 1 }], (seen) => {
          if (seen === point) throw new Error(`fault:${point}`);
        });
      })).rejects.toThrow(`fault:${point}`);
      const counts = await transactions.withTenant(scopeA, (transaction) => transaction.query<{
        receipts: string; replay: string; fields: string; drain: string; contiguous: string;
      }>(`
        SELECT
          (SELECT count(*) FROM workspace_mutation_receipts)::text AS receipts,
          (SELECT count(*) FROM workspace_mutations)::text AS replay,
          (SELECT count(*) FROM workspace_mutation_fields)::text AS fields,
          (SELECT count(*) FROM mutation_drain_records)::text AS drain,
          COALESCE((SELECT contiguous_received_through::text FROM mutation_drain_heads), '0') AS contiguous`));
      expect(counts.rows[0]).toEqual({ receipts: "0", replay: "0", fields: "0", drain: "0", contiguous: "0" });
    }
  });
  it("materializes an accepted delete as a soft-deleted row with its tombstone and hides it from every read", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const created = submittedSyncMutationSchema.parse({
      ...submitted("delete-create", 1, 0),
      changedFields: [{ fieldPath: "note", value: "private" }, { fieldPath: "tags", value: ["kept"] },
        { fieldPath: "targetPrice", value: { currency: "USD", amount: "10" } }],
    });
    await expect(service.ingest(scopeA, pushRequest(created))).resolves.toMatchObject({ accepted: true, headRevision: 1 });
    const removed = deletion("delete-asset", 2, 1);
    const request = pushRequest(removed);
    await expect(service.ingest(scopeA, request)).resolves.toMatchObject({
      accepted: true, assignments: [{ serverRevision: 2, duplicate: false }], headRevision: 2,
    });
    // A lost-response retry is the exact duplicate and writes nothing twice.
    await expect(service.ingest(scopeA, request)).resolves.toMatchObject({
      accepted: true, assignments: [{ serverRevision: 2, duplicate: true }], headRevision: 2,
    });

    const stored = await transactions.withTenant(scopeA, (transaction) => transaction.query(`
      SELECT asset.entity_id, asset.note, asset.portfolio_id, asset.tags, asset.target_price_currency,
             asset.target_price_amount, asset.lifecycle_status,
             asset.note_server_revision::int AS note_revision, asset.tags_server_revision::int AS tags_revision,
             asset.target_price_server_revision::int AS price_revision,
             asset.lifecycle_status_server_revision::int AS lifecycle_revision,
             to_char(asset.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS asset_deleted_at,
             tombstone.deleted_server_revision::int AS deleted_revision,
             to_char(tombstone.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS tombstone_deleted_at,
             tombstone.purge_after
      FROM workspace_replica_domain_assets asset
      JOIN workspace_replica_tombstones tombstone USING (account_id, workspace_id, entity_id)
      WHERE tombstone.entity_type = 'domain_asset'`));
    expect(stored.rows).toEqual([{
      entity_id: "asset-1.test", note: null, portfolio_id: null, tags: [], target_price_currency: null,
      target_price_amount: null, lifecycle_status: "archived",
      note_revision: 2, tags_revision: 2, price_revision: 2, lifecycle_revision: 2,
      asset_deleted_at: "2026-11-14T01:02:03Z", deleted_revision: 2,
      tombstone_deleted_at: "2026-11-14T01:02:03Z", purge_after: null,
    }]);

    await transactions.withTenant(scopeA, async (transaction) => {
      await expect(portfolio.captureSnapshot(transaction)).resolves.toEqual([]);
      await expect(portfolio.lockDomainAssets(transaction, ["asset-1.test"])).resolves.toEqual([]);
      await expect(portfolio.readDomainAssetTombstones(transaction, ["asset-1.test"]))
        .resolves.toEqual(new Map([["asset-1.test", 1]]));
    });
    // The other tenant shares the workspace id and holds no tombstone.
    await expect(replicaCounts(scopeB)).resolves.toMatchObject({ assets: "0", tombstones: "0" });
  });

  it("rejects an upsert or a second delete of a deleted asset and a delete of an asset never held", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    await expect(service.ingest(scopeA, pushRequest(submitted("held", 1, 0)))).resolves.toMatchObject({ accepted: true });
    await expect(service.ingest(scopeA, pushRequest(deletion("held-delete", 2, 1)))).resolves.toMatchObject({ accepted: true });
    const before = await replicaCounts(scopeA);
    expect(before).toEqual({ revision: "2", assets: "1", tombstones: "1", replay: "2", receipts: "2", ledger: "2" });

    // Each single-item business rejection records only its sequence-ledger receipt (ADR-0030).
    for (const [index, mutation] of [
      submitted("revive", 3, 2),
      deletion("delete-again", 4, 2),
      deletion("delete-never-held", 5, 2, "never.test"),
    ].entries()) {
      await expect(service.ingest(scopeA, pushRequest(mutation))).resolves.toEqual({
        accepted: false, code: "MUTATION_ENTITY_UNKNOWN", failures: [{ index: 0, mutationId: mutation.mutationId }],
      });
      await expect(replicaCounts(scopeA)).resolves.toEqual({ ...before, ledger: String(3 + index) });
    }
  });

  it("judges a batch in order: create then delete is accepted, delete then upsert writes nothing", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    const created = submittedSyncMutationSchema.parse({ ...submitted("batch-create", 1, 0), entityId: "brief.test" });
    await expect(service.ingest(scopeA, pushRequest(created, deletion("batch-delete", 2, 0, "brief.test"))))
      .resolves.toMatchObject({ accepted: true, headRevision: 2 });
    await expect(replicaCounts(scopeA)).resolves.toEqual({
      revision: "2", assets: "1", tombstones: "1", replay: "2", receipts: "2", ledger: "2",
    });

    await expect(service.ingest(scopeA, pushRequest(submitted("live", 3, 2)))).resolves.toMatchObject({ accepted: true });
    const before = await replicaCounts(scopeA);
    await expect(service.ingest(scopeA, pushRequest(deletion("batch-delete-live", 4, 3), submitted("batch-revive", 5, 3))))
      .resolves.toEqual({
        accepted: false, code: "MUTATION_ENTITY_UNKNOWN", failures: [{ index: 1, mutationId: "batch-revive" }],
      });
    await expect(replicaCounts(scopeA)).resolves.toEqual(before);
    await transactions.withTenant(scopeA, async (transaction) => {
      await expect(portfolio.lockDomainAssets(transaction, ["asset-1.test"])).resolves.toHaveLength(1);
    });
  });

  it("deletes an asset that immutable DNS observation receipts still reference", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    await expect(service.ingest(scopeA, pushRequest(submitted("observed", 1, 0)))).resolves.toMatchObject({ accepted: true });
    await ownerPool.query(`INSERT INTO cloudflare_dns_observation_receipts
      (account_id, workspace_id, observation_id, device_id, lease_epoch, source_sequence, entity_id,
       canonical_request_digest, observed_at, observation_sequence, disposition)
      VALUES ($1, $2, '00000000-0000-4000-8000-000000000001', 'device-1', 1, 1, 'asset-1.test',
        decode(repeat('ab', 32), 'hex'), now(), 1, 'current')`, [scopeA.accountId, scopeA.workspaceId]);

    await expect(service.ingest(scopeA, pushRequest(deletion("observed-delete", 2, 1))))
      .resolves.toMatchObject({ accepted: true, headRevision: 2 });
    const evidence = await ownerPool.query(`SELECT receipt.entity_id, asset.deleted_at IS NOT NULL AS deleted
      FROM cloudflare_dns_observation_receipts receipt
      JOIN workspace_replica_domain_assets asset USING (account_id, workspace_id, entity_id)`);
    expect(evidence.rows).toEqual([{ entity_id: "asset-1.test", deleted: true }]);
  });

  it("repairs a delete accepted before C1b1 that the replica left live, once and only for that asset", async () => {
    // The pre-C1b1 ingest logged the delete and ran the upsert path, which left a live default row.
    for (const scope of [scopeA, scopeB]) {
      await transactions.withTenant(scope, async (transaction) => {
        for (const entityId of ["asset-1.test", "kept.test"]) {
          await portfolio.seed(transaction, { entityId, note: "old", portfolioId: null, tags: ["x"], targetPrice: null });
        }
      });
    }
    await append(scopeA, submitted("legacy-edit", 1, 0), 1);
    await append(scopeA, deletion("legacy-delete", 2, 1), 2);
    await append(scopeA, { ...submitted("legacy-kept", 3, 2), entityId: "kept.test" }, 3);

    for (let run = 0; run < 2; run += 1) {
      const client = await ownerPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(legacyAcceptedDeleteRepairSql);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const rows = await ownerPool.query(`
        SELECT asset.account_id, asset.entity_id, asset.note, asset.lifecycle_status,
               to_char(asset.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deleted_at,
               tombstone.deleted_server_revision::int AS deleted_revision
        FROM workspace_replica_domain_assets asset
        LEFT JOIN workspace_replica_tombstones tombstone USING (account_id, workspace_id, entity_id)
        ORDER BY asset.account_id, asset.entity_id`);
      expect(rows.rows).toEqual([
        { account_id: scopeA.accountId, entity_id: "asset-1.test", note: null, lifecycle_status: "archived",
          deleted_at: "2026-11-14T01:02:03Z", deleted_revision: 2 },
        { account_id: scopeA.accountId, entity_id: "kept.test", note: "old", lifecycle_status: "active",
          deleted_at: null, deleted_revision: null },
        { account_id: scopeB.accountId, entity_id: "asset-1.test", note: "old", lifecycle_status: "active",
          deleted_at: null, deleted_revision: null },
        { account_id: scopeB.accountId, entity_id: "kept.test", note: "old", lifecycle_status: "active",
          deleted_at: null, deleted_revision: null },
      ]);
    }
  });

  it("refuses a write naming another generation than the replica row's and records the conflict", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    await expect(service.ingest(scopeA, pushRequest(submitted("gen-create", 1, 0)))).resolves.toMatchObject({ accepted: true });
    // A later-generation row stands in for a re-add (ADR-0029 C2), which only the owner can write today.
    await ownerPool.query(`UPDATE workspace_replica_domain_assets SET entity_generation = 2
      WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'asset-1.test'`, [scopeA.accountId, scopeA.workspaceId]);
    const before = await replicaCounts(scopeA);
    for (const [index, item] of [submitted("gen-edit", 2, 1), deletion("gen-delete", 3, 1)].entries()) {
      await expect(service.ingest(scopeA, pushRequest(item))).resolves.toEqual({
        accepted: false, code: "MUTATION_GENERATION_MISMATCH", failures: [{ index: 0, mutationId: item.mutationId }],
      });
      await expect(service.ingest(scopeA, pushRequest(item))).resolves.toMatchObject({
        accepted: false, code: "MUTATION_GENERATION_MISMATCH",
      });
      await expect(replicaCounts(scopeA)).resolves.toEqual({ ...before, ledger: String(Number(before.ledger) + index + 1) });
    }
    // The application role cannot choose a generation; inserts and tombstones take generation 1.
    await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(
      `UPDATE workspace_replica_domain_assets SET entity_generation = 3
       WHERE account_id = $1 AND workspace_id = $2`, [scopeA.accountId, scopeA.workspaceId])))
      .rejects.toThrow(/permission denied/u);
    await expect(service.ingest(scopeA, pushRequest({ ...submitted("gen-other", 4, 1), entityId: "other.test" })))
      .resolves.toMatchObject({ accepted: true });
    await expect(service.ingest(scopeA, pushRequest(deletion("gen-other-delete", 5, 1, "other.test"))))
      .resolves.toMatchObject({ accepted: true });
    const generations = await ownerPool.query(`SELECT asset.entity_id, asset.entity_generation::int AS asset_generation,
        tombstone.entity_generation::int AS tombstone_generation
      FROM workspace_replica_domain_assets asset
      LEFT JOIN workspace_replica_tombstones tombstone USING (account_id, workspace_id, entity_id)
      WHERE asset.account_id = $1 ORDER BY asset.entity_id`, [scopeA.accountId]);
    expect(generations.rows).toEqual([
      { entity_id: "asset-1.test", asset_generation: 2, tombstone_generation: null },
      { entity_id: "other.test", asset_generation: 1, tombstone_generation: 1 },
    ]);
    // A tombstone must carry its deleted row's generation, for every role.
    const owner = await ownerPool.connect();
    try {
      await owner.query("BEGIN");
      await owner.query(`UPDATE workspace_replica_domain_assets SET entity_generation = 1, deleted_at = now(),
          lifecycle_status = 'archived' WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'asset-1.test'`,
        [scopeA.accountId, scopeA.workspaceId]);
      await expect(owner.query(`INSERT INTO workspace_replica_tombstones
          (account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at, entity_generation)
          VALUES ($1, $2, 'domain_asset', 'asset-1.test', 6, now(), 2)`, [scopeA.accountId, scopeA.workspaceId]))
        .rejects.toThrow(/same generation/u);
    } finally {
      await owner.query("ROLLBACK");
      owner.release();
    }
  });

  it("keeps a deleted row and its tombstone paired and final for every role", async () => {
    const service = new PostgresWorkspaceMutationIngest({ transactions, authority, revisions, portfolio, mutations });
    await expect(service.ingest(scopeA, pushRequest(submitted("pair-create", 1, 0)))).resolves.toMatchObject({ accepted: true });
    await expect(service.ingest(scopeA, pushRequest(deletion("pair-delete", 2, 1)))).resolves.toMatchObject({ accepted: true });
    await expect(service.ingest(scopeA, pushRequest({ ...submitted("other-live", 3, 2), entityId: "live.test" })))
      .resolves.toMatchObject({ accepted: true });
    const before = await replicaCounts(scopeA);
    const tenant = [scopeA.accountId, scopeA.workspaceId] as const;

    const refusals: readonly [string, string][] = [
      // A deleted row is final: neither undeleted nor edited.
      ["UPDATE workspace_replica_domain_assets SET deleted_at = NULL, lifecycle_status = 'active' WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'asset-1.test'", "is final"],
      ["UPDATE workspace_replica_domain_assets SET note = 'revived' WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'asset-1.test'", "is final"],
      // A soft delete without its tombstone fails at commit.
      ["UPDATE workspace_replica_domain_assets SET deleted_at = now(), lifecycle_status = 'archived' WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'live.test'", "requires its tombstone"],
      // A tombstone must name a soft-deleted row of its tenant.
      ["INSERT INTO workspace_replica_tombstones (account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at) VALUES ($1, $2, 'domain_asset', 'live.test', 3, now())", "requires its deleted replica row"],
      ["INSERT INTO workspace_replica_tombstones (account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at) VALUES ($1, $2, 'domain_asset', 'never.test', 3, now())", "requires its deleted replica row"],
    ];
    for (const [sql, message] of refusals) {
      await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(sql, [...tenant])))
        .rejects.toThrow(message);
      const owner = await ownerPool.connect();
      try {
        await owner.query("BEGIN");
        await expect(owner.query(sql, [...tenant]).then(() => owner.query("COMMIT"))).rejects.toThrow(message);
      } finally {
        await owner.query("ROLLBACK");
        owner.release();
      }
    }
    // The application role cannot remove a tombstone or a row, nor rewrite a tombstone.
    for (const sql of [
      "DELETE FROM workspace_replica_tombstones WHERE account_id = $1 AND workspace_id = $2",
      "UPDATE workspace_replica_tombstones SET deleted_server_revision = 3 WHERE account_id = $1 AND workspace_id = $2",
      "DELETE FROM workspace_replica_domain_assets WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'asset-1.test'",
    ]) {
      await expect(transactions.withTenant(scopeA, (transaction) => transaction.query(sql, [...tenant])))
        .rejects.toThrow(/permission denied/u);
    }
    // Another tenant cannot write a tombstone into this tenant.
    await expect(transactions.withTenant(scopeB, (transaction) => transaction.query(
      `INSERT INTO workspace_replica_tombstones (account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at)
       VALUES ($1, $2, 'domain_asset', 'asset-1.test', 9, now())`, [...tenant]))).rejects.toThrow();
    await expect(replicaCounts(scopeA)).resolves.toEqual(before);
  });
});

function submitted(mutationId: string, deviceMutationSequence: number, baseServerRevision: number) {
  return submittedSyncMutationSchema.parse({
    schemaVersion: 3,
    mutationId,
    workspaceId: "same-workspace",
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "asset-1.test",
    entityGeneration: 1,
    operationKind: "upsert",
    baseServerRevision,
    changedFields: [{ fieldPath: "note", value: `note-${mutationId}` }],
    sourceDeviceId: "device-1",
    activeLeaseEpoch: 1,
    deviceMutationSequence,
  });
}

function pushRequest(...mutations: ReturnType<typeof submitted>[]) {
  return {
    schemaVersion: 3 as const,
    mutations: mutations.map(({ workspaceId: _workspaceId, ...mutation }) => mutation),
  };
}

/** An asset deleted before the test: its soft-deleted row and tombstone, committed together. */
async function seedDeletedAsset(scope: WorkspaceTenantScope, entityId: string): Promise<void> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO workspace_replica_domain_assets
      (account_id, workspace_id, entity_id, lifecycle_status, deleted_at)
      VALUES ($1, $2, $3, 'archived', now())`, [scope.accountId, scope.workspaceId, entityId]);
    await client.query(`INSERT INTO workspace_replica_tombstones
      (account_id, workspace_id, entity_type, entity_id, deleted_server_revision, deleted_at)
      VALUES ($1, $2, 'domain_asset', $3, 1, now())`, [scope.accountId, scope.workspaceId, entityId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function deletion(mutationId: string, deviceMutationSequence: number, baseServerRevision: number, entityId = "asset-1.test") {
  return submittedSyncMutationSchema.parse({
    ...submitted(mutationId, deviceMutationSequence, baseServerRevision),
    entityId,
    operationKind: "delete",
    deletedAt: "2026-11-14T01:02:03Z",
    changedFields: [],
  });
}

async function replicaCounts(scope: WorkspaceTenantScope): Promise<Record<string, string>> {
  return transactions.withTenant(scope, async (transaction) => (await transaction.query<Record<string, string>>(`
    SELECT
      (SELECT server_revision::text FROM workspace_revisions) AS revision,
      (SELECT count(*)::text FROM workspace_replica_domain_assets) AS assets,
      (SELECT count(*)::text FROM workspace_replica_tombstones) AS tombstones,
      (SELECT count(*)::text FROM workspace_mutations) AS replay,
      (SELECT count(*)::text FROM workspace_mutation_receipts) AS receipts,
      (SELECT count(*)::text FROM workspace_device_mutation_sequence_ledger) AS ledger`)).rows[0]!);
}

function domain() {
  return { sourceDeviceId: "device-1", activeLeaseEpoch: 1 } as const;
}

async function append(
  scope: WorkspaceTenantScope,
  mutation: ReturnType<typeof submitted>,
  serverRevision: number,
): Promise<void> {
  await transactions.withTenant(scope, async (transaction) => {
    const lock = await mutations.lockDrainDomain(transaction, domain());
    const head = await revisions.lock(transaction);
    if (head === null) throw new TypeError("test workspace is unbound");
    await mutations.appendAccepted(transaction, lock, [{ mutation, serverRevision }]);
    await revisions.compareAndAdvance(transaction, head.serverRevision, serverRevision);
  });
}

async function readHead(scope: WorkspaceTenantScope): Promise<{ contiguous: string; highest: string; digest: Buffer }> {
  return transactions.withTenant(scope, async (transaction) => {
    const result = await transaction.query<{ contiguous: string; highest: string; digest: Buffer }>(
      `SELECT contiguous_received_through AS contiguous, highest_received_sequence AS highest,
              rolling_digest AS digest FROM mutation_drain_heads`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("test mutation Drain head is absent");
    return row;
  });
}

async function readGlobalHead(scope: WorkspaceTenantScope): Promise<{
  contiguous: string;
  highest: string;
  rowVersion: string;
  ledger: string;
}> {
  return transactions.withTenant(scope, async (transaction) => {
    const result = await transaction.query<{
      contiguous: string; highest: string; rowVersion: string; ledger: string;
    }>(`
      SELECT head.contiguous_received_through::text AS contiguous,
             head.highest_received_sequence::text AS highest,
             head.row_version::text AS "rowVersion",
             (SELECT count(*)::text FROM workspace_device_mutation_sequence_ledger) AS ledger
      FROM workspace_device_mutation_heads AS head`);
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("test global mutation head is absent");
    return row;
  });
}

async function seedDrainRace(): Promise<void> {
  const mutationGenesis = Buffer.from(DRAIN_STREAM_GENESIS_DIGEST, "base64url");
  const otherStreamDigest = Buffer.alloc(32, 7);
  await transactions.withTenant(scopeA, async (transaction) => {
    await portfolio.seed(transaction, {
      entityId: "asset-1.test", note: null, portfolioId: null, tags: [], targetPrice: null,
    });
    await transaction.query(`INSERT INTO identity_accounts
      (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ($1, 'mutation-race@example.test', 'argon2id-v1', repeat('x', 80))
      ON CONFLICT (account_id) DO NOTHING`, [scopeA.accountId]);
    await transaction.query(`INSERT INTO identity_account_security_states
      (account_id, account_security_epoch, status) VALUES ($1, 1, 'normal')
      ON CONFLICT (account_id) DO UPDATE SET account_security_epoch = 1, status = 'normal'`, [scopeA.accountId]);
    await transaction.query(`UPDATE device_account_states
      SET binding_list_revision = 1, highest_allocated_lease_epoch = 1, current_lease_epoch = 1
      WHERE account_id = $1`, [scopeA.accountId]);
    await transaction.query(`INSERT INTO device_bindings
      (account_id, device_id, slot, status, credential_epoch)
      VALUES ($1, 'device-2', 2, 'bound', 1)`, [scopeA.accountId]);
    await transaction.query(`INSERT INTO device_signing_keys
      (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ($1, 'device-1', 1, 'mutation-race-key', $2, $3, 'active')`,
    [scopeA.accountId, Buffer.alloc(32, 3), Buffer.alloc(32, 4)]);
    await transaction.query(`INSERT INTO device_switch_workflows
      (account_id, workspace_id, workflow_id, purpose, mode, request_digest, idempotency_key, status,
       workflow_revision, from_device_id, to_device_id, bound_key_id, bound_key_version,
       bound_account_security_epoch, state_deadline)
      VALUES ($1, $2, 'mutation-race-workflow', 'device_switch', 'normal', $3, 'mutation-race-idem',
        'draining', 1, 'device-1', 'device-2', 'mutation-race-key', 1, 1,
        transaction_timestamp() + interval '1 hour')`, [scopeA.accountId, scopeA.workspaceId, Buffer.alloc(32, 5)]);
  });
  await withOwnerTenant(scopeA, async (transaction) => {
    await transaction.query(`INSERT INTO mutation_drain_heads
      (account_id, workspace_id, source_device_id, active_lease_epoch, rolling_digest)
      VALUES ($1, $2, 'device-1', 1, $3)`, [scopeA.accountId, scopeA.workspaceId, mutationGenesis]);
    await transaction.query(`INSERT INTO execution_fact_drain_heads
      (account_id, workspace_id, source_device_id, active_lease_epoch, rolling_digest)
      VALUES ($1, $2, 'device-1', 1, $3)`, [scopeA.accountId, scopeA.workspaceId, otherStreamDigest]);
    await transaction.query(`INSERT INTO workspace_device_audit_drain_heads
      (account_id, workspace_id, source_device_id, active_lease_epoch, chain_id, rolling_digest, head_hash)
      VALUES ($1, $2, 'device-1', 1, 'mutation-race-chain', $3, $4)`,
    [scopeA.accountId, scopeA.workspaceId, otherStreamDigest, Buffer.alloc(32, 8)]);
    await transaction.query(`INSERT INTO device_drain_proofs
      (account_id, workspace_id, proof_id, proof_digest, purpose, workflow_id, source_device_id,
       active_lease_epoch, signing_key_id, signing_key_version, issued_at, expires_at, verified_at,
       device_mutation_sequence, mutation_digest, execution_fact_sequence, execution_fact_digest,
       device_audit_sequence, device_audit_digest)
      VALUES ($1, $2, 'mutation-race-proof', $3, 'handoff', 'mutation-race-workflow', 'device-1',
        1, 'mutation-race-key', 1, transaction_timestamp() - interval '1 minute',
        transaction_timestamp() + interval '5 minutes', transaction_timestamp(), 0, $4, 0, $5, 0, $5)`,
    [scopeA.accountId, scopeA.workspaceId, Buffer.alloc(32, 9), mutationGenesis, otherStreamDigest]);
  });
}

/** Releases device-1's epoch-1 Lease and activates epoch 2 for the same device and workspace. */
async function rotateDeviceOneLeaseToEpochTwo(): Promise<void> {
  await ownerPool.query(`UPDATE device_active_leases SET released_at = transaction_timestamp(), release_reason = 'rotated'
    WHERE account_id = $1 AND lease_epoch = 1`, [scopeA.accountId]);
  await ownerPool.query(`INSERT INTO device_lease_epoch_allocations
    (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
    VALUES ($1, $2, 'mutation-ingest-2', 2, 'activated', transaction_timestamp())`, [scopeA.accountId, scopeA.workspaceId]);
  await ownerPool.query(`INSERT INTO device_active_leases
    (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
     offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
    VALUES ($1, 2, 'device-1', 'mutation-lease-epoch-2', transaction_timestamp() - interval '2 minutes',
      transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '5 minutes',
      transaction_timestamp() + interval '1 hour', decode('02', 'hex'),
      jsonb_build_object('fixture', 'workspace-mutation-2'), pg_catalog.sha256(decode('02', 'hex')))`, [scopeA.accountId]);
}

/** Owner-only fixture setup leaves the mutation Drain domain empty for direct app-role controls. */
async function seedDirectMutationSealAuthority(leaseEpoch = 1): Promise<void> {
  await withOwnerTenant(scopeA, async (transaction) => {
    await transaction.query(`INSERT INTO identity_accounts
      (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ($1, 'direct-mutation-seal@example.test', 'argon2id-v1', repeat('x', 80))
      ON CONFLICT (account_id) DO NOTHING`, [scopeA.accountId]);
    await transaction.query(`INSERT INTO identity_account_security_states
      (account_id, account_security_epoch, status)
      VALUES ($1, 1, 'normal')
      ON CONFLICT (account_id) DO UPDATE SET account_security_epoch = 1, status = 'normal'`, [scopeA.accountId]);
    await transaction.query(`UPDATE device_account_states
      SET binding_list_revision = 1, highest_allocated_lease_epoch = $2, current_lease_epoch = $2
      WHERE account_id = $1`, [scopeA.accountId, leaseEpoch]);
    await transaction.query(`INSERT INTO device_bindings
      (account_id, device_id, slot, status, credential_epoch)
      VALUES ($1, 'device-2', 2, 'bound', 1)
      ON CONFLICT (account_id, device_id) DO NOTHING`, [scopeA.accountId]);
    await transaction.query(`INSERT INTO device_signing_keys
      (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ($1, 'device-1', 1, 'direct-app-seal-key', $2, $3, 'active')`,
    [scopeA.accountId, Buffer.alloc(32, 3), Buffer.alloc(32, 4)]);
    await transaction.query(`INSERT INTO device_switch_workflows
      (account_id, workspace_id, workflow_id, purpose, mode, request_digest, idempotency_key, status,
       workflow_revision, from_device_id, to_device_id, bound_key_id, bound_key_version,
       bound_account_security_epoch, state_deadline)
      VALUES ($1, $2, 'direct-app-seal-workflow', 'device_switch', 'normal', $3,
        'direct-app-seal-idempotency', 'draining', 1, 'device-1', 'device-2',
        'direct-app-seal-key', 1, 1, transaction_timestamp() + interval '1 hour')`,
    [scopeA.accountId, scopeA.workspaceId, Buffer.alloc(32, 5)]);
    await seedDirectMutationSealProofInTransaction(
      transaction,
      "direct-app-mismatched-proof",
      1,
      Buffer.alloc(32),
    );
  });
}

async function seedDirectMutationSealProof(
  proofId: string,
  deviceMutationSequence: number,
  mutationDigest: Buffer,
  proofSchemaVersion?: 2,
  leaseEpoch = 1,
): Promise<void> {
  await withOwnerTenant(scopeA, (transaction) => seedDirectMutationSealProofInTransaction(
    transaction,
    proofId,
    deviceMutationSequence,
    mutationDigest,
    proofSchemaVersion,
    leaseEpoch,
  ));
}

function seedDirectMutationSealProofInTransaction(
  transaction: PoolClient,
  proofId: string,
  deviceMutationSequence: number,
  mutationDigest: Buffer,
  proofSchemaVersion?: 2,
  leaseEpoch = 1,
) {
  // Omitting the version exercises the migration default that keeps historical proofs at v1.
  return transaction.query(`INSERT INTO device_drain_proofs
    (account_id, workspace_id, proof_id, proof_digest, purpose, workflow_id, source_device_id,
     active_lease_epoch, signing_key_id, signing_key_version, issued_at, expires_at, verified_at,
     device_mutation_sequence, mutation_digest, execution_fact_sequence, execution_fact_digest,
     device_audit_sequence, device_audit_digest${proofSchemaVersion === undefined ? "" : ", proof_schema_version"})
    VALUES ($1, $2, $3, $4, 'handoff', 'direct-app-seal-workflow', 'device-1', $9,
      'direct-app-seal-key', 1, transaction_timestamp() - interval '1 minute',
      transaction_timestamp() + interval '5 minutes', transaction_timestamp(),
      $5, $6, 0, $7, 0, $8${proofSchemaVersion === undefined ? "" : ", $10"})`, [
    scopeA.accountId, scopeA.workspaceId, proofId, Buffer.alloc(32, 6), deviceMutationSequence,
    mutationDigest, Buffer.alloc(32, 7), Buffer.alloc(32, 8), leaseEpoch,
    ...(proofSchemaVersion === undefined ? [] : [proofSchemaVersion]),
  ]);
}

async function withOwnerTenant<Result>(
  scope: WorkspaceTenantScope,
  operation: (transaction: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await ownerPool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [scope.accountId]);
    await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);
    const result = await operation(client);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function waitForBlockedTransactions(
  observer: PoolClient,
  minimumCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const result = await observer.query<{ count: number }>(
      `SELECT count(DISTINCT pid)::int AS count
       FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`,
    );
    if ((result.rows[0]?.count ?? 0) >= minimumCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new TypeError(`expected ${minimumCount} transactions to wait for the test blocker`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  }
  return value;
}
