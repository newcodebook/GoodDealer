import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
  encodeDrainStreamEnvelope,
} from "@gooddealer/protocol/execution-events";
import { submittedSyncMutationSchema } from "@gooddealer/protocol/workspace";

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
         offline_execute_until, signed_envelope)
        VALUES ($1, 1, 'device-1', $2, transaction_timestamp() - interval '2 minutes',
          transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '5 minutes',
          transaction_timestamp() + interval '1 hour', decode('01', 'hex'))`,
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
      schemaVersion: 1,
      mutationId: "mutation-delete",
      workspaceId: scopeA.workspaceId,
      workspaceSchemaVersion: 1,
      entityType: "domain_asset",
      entityId: "deleted.test",
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
    const request = { schemaVersion: 1, workspaceId: scopeA.workspaceId, ...domain(), mutations: [mutation] };
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
    const request = { schemaVersion: 1, workspaceId: scopeA.workspaceId, ...domain(), mutations: [mutation] };

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
    await expect(service.ingest(scopeA, {
      schemaVersion: 1,
      workspaceId: scopeA.workspaceId,
      ...domain(),
      mutations: [expiredMutation],
    })).resolves.toMatchObject({ accepted: false, code: "MUTATION_DEVICE_NOT_ACTIVE" });

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
    await expect(service.ingest(scopeA, {
      schemaVersion: 1,
      workspaceId: scopeA.workspaceId,
      ...domain(),
      mutations: [futureMutation],
    })).resolves.toMatchObject({ accepted: true, headRevision: 1 });
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

      ingestAttempt = ingest.ingest(scopeA, {
        schemaVersion: 1,
        workspaceId: scopeA.workspaceId,
        ...domain(),
        mutations: [submitted("mutation-race", 1, 0)],
      });
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
    await expect(service.ingest(scopeA, {
      schemaVersion: 1, workspaceId: scopeA.workspaceId, ...domain(), mutations: [mutation],
    })).rejects.toThrow("materialization-fault");
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
    const duplicateRequest = { schemaVersion: 1, workspaceId: scopeA.workspaceId, ...domain(), mutations: [duplicate] };
    const duplicateResults = await Promise.all([
      service.ingest(scopeA, duplicateRequest),
      service.ingest(scopeA, duplicateRequest),
    ]);
    expect(duplicateResults.every((result) => result.accepted)).toBe(true);
    expect(duplicateResults.map((result) => result.accepted && result.assignments[0]?.serverRevision))
      .toEqual([1, 1]);

    const sameField = [
      submitted("same-field-a", 2, 1),
      submitted("same-field-b", 3, 1),
    ];
    const sameFieldResults = await Promise.all(sameField.map((mutation) => service.ingest(scopeA, {
      schemaVersion: 1, workspaceId: scopeA.workspaceId, ...domain(), mutations: [mutation],
    })));
    expect(sameFieldResults.filter((result) => result.accepted)).toHaveLength(1);
    expect(sameFieldResults.filter((result) => !result.accepted && result.code === "MUTATION_FIELD_STALE"))
      .toHaveLength(1);

    const head = (await transactions.withTenant(scopeA, (transaction) => revisions.read(transaction)))?.serverRevision;
    expect(head).toBe(2);
    const differentField = submittedSyncMutationSchema.parse({
      ...submitted("different-field", 4, 1),
      changedFields: [{ fieldPath: "tags", value: ["safe"] }],
    });
    await expect(service.ingest(scopeA, {
      schemaVersion: 1, workspaceId: scopeA.workspaceId, ...domain(), mutations: [differentField],
    })).resolves.toMatchObject({ accepted: true, headRevision: 3 });
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
         ) VALUES ($1, $2, 'mutation-compaction-authority', 1, 1, 1,
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
});

function submitted(mutationId: string, deviceMutationSequence: number, baseServerRevision: number) {
  return submittedSyncMutationSchema.parse({
    schemaVersion: 1,
    mutationId,
    workspaceId: "same-workspace",
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "asset-1.test",
    baseServerRevision,
    changedFields: [{ fieldPath: "note", value: `note-${mutationId}` }],
    sourceDeviceId: "device-1",
    activeLeaseEpoch: 1,
    deviceMutationSequence,
  });
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

/** Owner-only fixture setup leaves the mutation Drain domain empty for direct app-role controls. */
async function seedDirectMutationSealAuthority(): Promise<void> {
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
      SET binding_list_revision = 1, highest_allocated_lease_epoch = 1, current_lease_epoch = 1
      WHERE account_id = $1`, [scopeA.accountId]);
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
): Promise<void> {
  await withOwnerTenant(scopeA, (transaction) => seedDirectMutationSealProofInTransaction(
    transaction,
    proofId,
    deviceMutationSequence,
    mutationDigest,
  ));
}

function seedDirectMutationSealProofInTransaction(
  transaction: PoolClient,
  proofId: string,
  deviceMutationSequence: number,
  mutationDigest: Buffer,
) {
  return transaction.query(`INSERT INTO device_drain_proofs
    (account_id, workspace_id, proof_id, proof_digest, purpose, workflow_id, source_device_id,
     active_lease_epoch, signing_key_id, signing_key_version, issued_at, expires_at, verified_at,
     device_mutation_sequence, mutation_digest, execution_fact_sequence, execution_fact_digest,
     device_audit_sequence, device_audit_digest)
    VALUES ($1, $2, $3, $4, 'handoff', 'direct-app-seal-workflow', 'device-1', 1,
      'direct-app-seal-key', 1, transaction_timestamp() - interval '1 minute',
      transaction_timestamp() + interval '5 minutes', transaction_timestamp(),
      $5, $6, 0, $7, 0, $8)`, [
    scopeA.accountId, scopeA.workspaceId, proofId, Buffer.alloc(32, 6), deviceMutationSequence,
    mutationDigest, Buffer.alloc(32, 7), Buffer.alloc(32, 8),
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
