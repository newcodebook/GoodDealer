import { createHash } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  domainAssetProjectionSchema,
  submittedSyncMutationSchema,
  type DomainAssetProjectionRow,
  type SyncMutation,
} from "@gooddealer/protocol/workspace";
import { encodeDrainStreamEnvelope } from "@gooddealer/protocol/execution-events";

import {
  runCloudMigrations,
  TenantTransactionRunner,
  type TenantTransaction,
} from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import type { RestoreCandidateWatermarkQueryPort } from "../../src/modules/recovery/index";
import type { WorkspaceRevisionSnapshot } from "../../src/modules/workspace/revisions/index";
import { PostgresCheckpointRepository } from "../../src/modules/workspace/checkpoints/postgres-repository";
import { PostgresWorkspaceMutationRepository } from "../../src/modules/workspace/mutations/postgres-repository";
import type {
  CheckpointMutationRangePort,
  CheckpointRevisionPort,
} from "../../src/modules/workspace/checkpoints/postgres-ports";
import {
  PostgresCheckpointService,
  replayDomainAssets,
} from "../../src/modules/workspace/checkpoints/postgres-service";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 4 });
const transactions = new TenantTransactionRunner(appPool);
const checkpoints = new PostgresCheckpointRepository();
let revisions: TestRevisionPort;
let portfolio: TestPortfolioSnapshotPort;
let mutationPort: TestMutationRangePort;
const deviceCursors = { async readMinimumActiveRevision() { return null; } };
const readerCursors = { async retireExpiredAndReadMinimumActiveRevision() { return null; } };
const recovery: RestoreCandidateWatermarkQueryPort = {
  async readOldestUnresolvedComparisonRevision() { return null; },
};
let service: PostgresCheckpointService;
const tenantA = { accountId: "checkpoint-account-a", workspaceId: "checkpoint-workspace" } as const;
const tenantB = { accountId: "checkpoint-account-b", workspaceId: "checkpoint-workspace" } as const;
const initialRows = domainAssetProjectionSchema.parse([{
  entityId: "a.test",
  note: null,
  portfolioId: "portfolio-a",
  tags: [],
  targetPrice: null,
}]);

beforeAll(async () => {
  revisions = new TestRevisionPort();
  portfolio = new TestPortfolioSnapshotPort();
  mutationPort = new TestMutationRangePort();
  service = checkpointService(recovery);
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query(
    "TRUNCATE mutation_drain_records, mutation_drain_seals, mutation_drain_heads, workspace_revisions CASCADE",
  );
  mutationPort.compactCalls = 0;
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end()]);
});

describe("PostgreSQL workspace checkpoint persistence", () => {
  it("uses compound tenant keys with forced RLS on every checkpoint-owned table", async () => {
    const tables = [
      "workspace_checkpoints",
      "workspace_checkpoint_entity_digests",
      "workspace_checkpoint_domain_assets",
      "workspace_checkpoint_pins",
      "workspace_checkpoint_diagnostics",
    ];
    const observed = await ownerPool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
      [tables],
    );
    expect(observed.rows).toHaveLength(tables.length);
    expect(observed.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const keys = await ownerPool.query<{ table_name: string; columns: string[] }>(
      `SELECT tc.table_name, array_agg(kcu.column_name ORDER BY kcu.ordinal_position)::text[] AS columns
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = ANY($1::text[])
       GROUP BY tc.table_name ORDER BY tc.table_name`,
      [tables],
    );
    expect(keys.rows.every((row) => row.columns[0] === "account_id" && row.columns[1] === "workspace_id")).toBe(true);
  });

  it("builds immutable snapshots and permits only verified publication", async () => {
    await seedWorkspace(tenantA, initialRows, 0);
    await expect(service.publish(tenantA, "checkpoint-a")).resolves.toEqual({
      accepted: false,
      code: "CHECKPOINT_NOT_AVAILABLE",
    });
    const built = await service.build(tenantA, "checkpoint-a", 0);
    expect(built).toMatchObject({ accepted: true, value: { status: "building" } });
    await expect(transactions.withTenant(tenantA, (transaction) => transaction.query(
      `UPDATE workspace_checkpoints
       SET status = 'available', row_version = row_version + 1,
           verified_at = transaction_timestamp(), published_at = transaction_timestamp()
       WHERE checkpoint_id = 'checkpoint-a'`,
    ))).rejects.toMatchObject({ code: "P0001" });
    await expect(service.publish(tenantA, "checkpoint-a")).resolves.toEqual({
      accepted: false,
      code: "CHECKPOINT_NOT_AVAILABLE",
    });
    await expect(service.verify(tenantA, "checkpoint-a")).resolves.toMatchObject({
      accepted: true,
      value: { status: "verified" },
    });
    await expect(service.publish(tenantA, "checkpoint-a")).resolves.toMatchObject({
      accepted: true,
      value: { status: "available" },
    });
  });

  it("serializes checkpoint build before concurrent persisted ingest", async () => {
    const persistedMutations = new PostgresWorkspaceMutationRepository();
    await seedWorkspace(tenantA, initialRows, 0);
    let announceCapture!: () => void;
    let releaseCapture!: () => void;
    let announceIngestAttempt!: () => void;
    const captureStarted = new Promise<void>((resolve) => { announceCapture = resolve; });
    const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });
    const ingestAttempted = new Promise<void>((resolve) => { announceIngestAttempt = resolve; });
    const coordinated = new PostgresCheckpointService({
      transactions,
      checkpoints,
      revisions,
      portfolio: {
        async captureSnapshot(transaction) {
          announceCapture();
          await captureGate;
          return portfolio.captureSnapshot(transaction);
        },
      },
      mutations: persistedMutations,
      deviceCursors,
      readerCursors,
      recovery,
    });
    const build = coordinated.build(tenantA, "before-concurrent-ingest", 0);
    await captureStarted;
    const mutation = submittedSyncMutationSchema.parse({
      schemaVersion: 1,
      mutationId: "concurrent-build-mutation",
      workspaceId: tenantA.workspaceId,
      workspaceSchemaVersion: 1,
      entityType: "domain_asset",
      entityId: "a.test",
      baseServerRevision: 0,
      changedFields: [{ fieldPath: "note", value: "after-build" }],
      sourceDeviceId: "concurrent-build-device",
      activeLeaseEpoch: 1,
      deviceMutationSequence: 1,
    });
    await seedActiveMutationDrainDomain(tenantA, mutation.sourceDeviceId);
    const ingest = transactions.withTenant(tenantA, async (transaction) => {
      const lock = await persistedMutations.lockDrainDomain(transaction, {
        sourceDeviceId: mutation.sourceDeviceId,
        activeLeaseEpoch: mutation.activeLeaseEpoch,
      });
      announceIngestAttempt();
      await persistedMutations.appendAccepted(transaction, lock, [{ mutation, serverRevision: 1 }]);
      await transaction.query(
        `UPDATE workspace_revisions SET server_revision = 1
         WHERE account_id = $1 AND workspace_id = $2 AND server_revision = 0`,
        [tenantA.accountId, tenantA.workspaceId],
      );
      await transaction.query(
        `UPDATE workspace_replica_domain_assets SET note = 'after-build', note_server_revision = 1
         WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'a.test'`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    });
    await ingestAttempted;
    releaseCapture();

    await expect(build).resolves.toMatchObject({
      accepted: true,
      value: { descriptor: { throughServerRevision: 0 } },
    });
    await ingest;
    await transactions.withTenant(tenantA, async (transaction) => {
      await expect(checkpoints.readSnapshot(transaction, "before-concurrent-ingest")).resolves.toEqual(initialRows);
      await expect(portfolio.captureSnapshot(transaction)).resolves.toEqual([
        { ...initialRows[0]!, note: "after-build" },
      ]);
    });
  });

  it("rejects immutable checkpoint identifier and pin binding mismatches", async () => {
    await seedWorkspace(tenantA, initialRows, 0);
    await service.build(tenantA, "immutable-binding", 0);
    await service.verify(tenantA, "immutable-binding");
    await service.publish(tenantA, "immutable-binding");
    const checkpoint = await transactions.withTenant(
      tenantA,
      (transaction) => checkpoints.read(transaction, "immutable-binding"),
    );
    if (checkpoint === null) throw new Error("checkpoint missing");
    await transactions.withTenant(tenantA, async (transaction) => {
      await insertSyntheticMutationPrefix(transaction, tenantA, 0, 1);
      await transaction.query(
        `UPDATE workspace_revisions SET server_revision = 1
         WHERE account_id = $1 AND workspace_id = $2`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    });

    await expect(service.build(tenantA, "immutable-binding", 1)).rejects.toThrow("checkpoint id is immutable");
    await expect(service.pin(tenantA, {
      checkpointId: "immutable-binding",
      throughServerRevision: 1,
      checkpointDigest: checkpoint.descriptor.checkpointDigest,
      consumerKind: "bootstrap",
      consumerId: "wrong-revision",
      expiresAt: "2099-01-01T00:00:00Z",
    })).rejects.toThrow("checkpoint pin binding conflicts or is unavailable");
    await expect(service.pin(tenantA, {
      checkpointId: "immutable-binding",
      throughServerRevision: 0,
      checkpointDigest: "A".repeat(43),
      consumerKind: "bootstrap",
      consumerId: "wrong-digest",
      expiresAt: "2099-01-01T00:00:00Z",
    })).rejects.toThrow("checkpoint pin binding conflicts or is unavailable");
  });

  it("rejects secret-bearing and cross-workspace checkpoint snapshots before storage", async () => {
    await seedWorkspace(tenantA, initialRows, 0);
    const secretBearingRows = [{ ...initialRows[0]!, credentialRef: "must-not-persist" }];
    const secretBearing = new PostgresCheckpointService({
      transactions,
      checkpoints,
      revisions,
      portfolio: {
        async captureSnapshot() {
          return secretBearingRows;
        },
      },
      mutations: mutationPort,
      deviceCursors,
      readerCursors,
      recovery,
    });
    await expect(secretBearing.build(tenantA, "secret-bearing", 0)).rejects.toThrow();
    await transactions.withTenant(tenantA, async (transaction) => {
      await expect(checkpoints.createBuilding(transaction, {
        schemaVersion: 1,
        checkpointId: "cross-workspace",
        workspaceId: "another-workspace",
        workspaceSchemaVersion: 1,
        throughServerRevision: 0,
        checkpointDigest: "A".repeat(43),
      }, initialRows, [{ entityType: "domain_asset", partitionId: null, digest: "A".repeat(43) }]))
        .rejects.toThrow("checkpoint workspace does not match tenant scope");
      const stored = await transaction.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM workspace_checkpoints
         WHERE account_id = $1 AND workspace_id = $2
           AND checkpoint_id IN ('secret-bearing', 'cross-workspace')`,
        [tenantA.accountId, tenantA.workspaceId],
      );
      expect(stored.rows[0]?.count).toBe("0");
    });
  });

  it("has one verification CAS winner and marks tampered persisted snapshots invalid", async () => {
    await seedWorkspace(tenantA, initialRows, 0);
    await service.build(tenantA, "concurrent", 0);
    const concurrent = await Promise.all([service.verify(tenantA, "concurrent"), service.verify(tenantA, "concurrent")]);
    expect(concurrent.filter((result) => result.accepted)).toHaveLength(1);

    await service.build(tenantA, "tampered", 0);
    await withOwnerTenant(tenantA, async (transaction) => {
      await transaction.query(
        `UPDATE workspace_checkpoint_domain_assets SET note = 'tampered'
         WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = 'tampered'`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    });
    await expect(service.verify(tenantA, "tampered")).resolves.toEqual({
      accepted: false,
      code: "CHECKPOINT_DIGEST_MISMATCH",
    });
    await transactions.withTenant(tenantA, async (transaction) => {
      await expect(checkpoints.read(transaction, "tampered")).resolves.toMatchObject({ status: "invalid" });
    });
  });

  it("isolates identical checkpoint ids across tenants", async () => {
    await seedWorkspace(tenantA, initialRows, 0);
    await seedWorkspace(tenantB, [{ ...initialRows[0]!, note: "tenant-b" }], 0);
    await service.build(tenantA, "same-checkpoint", 0);
    await service.build(tenantB, "same-checkpoint", 0);
    await transactions.withTenant(tenantA, async (transaction) => {
      await expect(checkpoints.readSnapshot(transaction, "same-checkpoint")).resolves.toEqual(initialRows);
    });
    await transactions.withTenant(tenantB, async (transaction) => {
      await expect(checkpoints.readSnapshot(transaction, "same-checkpoint")).resolves.toEqual([
        { ...initialRows[0]!, note: "tenant-b" },
      ]);
    });
  });

  it("never supersedes the last usable or an actively pinned checkpoint", async () => {
    await seedWorkspace(tenantA, initialRows, 0);
    await makeAvailable("first");
    await expect(service.supersede(tenantA, "first")).resolves.toEqual({
      accepted: false,
      code: "CHECKPOINT_LAST_USABLE",
    });
    await makeAvailable("second");
    const first = await transactions.withTenant(tenantA, (transaction) => checkpoints.read(transaction, "first"));
    if (first === null) throw new Error("first checkpoint missing");
    await service.pin(tenantA, {
      checkpointId: "first",
      throughServerRevision: first.descriptor.throughServerRevision,
      checkpointDigest: first.descriptor.checkpointDigest,
      consumerKind: "bootstrap",
      consumerId: "bootstrap-a",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    await expect(service.supersede(tenantA, "first")).resolves.toEqual({
      accepted: false,
      code: "CHECKPOINT_PINNED",
    });
    await expect(service.supersede(tenantA, "second")).resolves.toEqual({
      accepted: true,
      value: null,
    });
  });

  it("fails compaction closed when Recovery authority is absent before replay deletion", async () => {
    await seedWorkspace(tenantA, initialRows, 1);
    await makeAvailable("authority-checkpoint");
    const denying = checkpointService(null);
    await expect(denying.compact(tenantA, 1)).resolves.toEqual({
      accepted: false,
      code: "COMPACTION_AUTHORITY_UNAVAILABLE",
    });
    expect(mutationPort.compactCalls).toBe(0);
    await transactions.withTenant(tenantA, async (transaction) => {
      await expect(revisions.read(transaction)).resolves.toMatchObject({ compactedThroughServerRevision: 0 });
    });
  });

  it.each([
    ["DeviceCursor", 2, null, null],
    ["ReaderCursor", null, 2, null],
    ["Recovery Candidate", null, null, 2],
  ])("lets the %s watermark independently block compaction", async (_source, device, reader, candidate) => {
    await seedWorkspace(tenantA, initialRows, 3);
    await makeAvailable("watermark-checkpoint");
    const bounded = checkpointServiceWithWatermarks(device, reader, candidate);
    await expect(bounded.compact(tenantA, 3)).resolves.toEqual({
      accepted: false,
      code: "COMPACTION_WATERMARK_BLOCKED",
    });
    expect(mutationPort.compactCalls).toBe(0);
  });

  it("lets an active checkpoint pin independently block compaction", async () => {
    await seedWorkspace(tenantA, initialRows, 1);
    await makeAvailable("pinned-old");
    const old = await transactions.withTenant(tenantA, (transaction) => checkpoints.read(transaction, "pinned-old"));
    if (old === null) throw new Error("old checkpoint missing");
    await service.pin(tenantA, {
      checkpointId: old.descriptor.checkpointId,
      throughServerRevision: old.descriptor.throughServerRevision,
      checkpointDigest: old.descriptor.checkpointDigest,
      consumerKind: "recovery",
      consumerId: "candidate-a",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    await transactions.withTenant(tenantA, async (transaction) => {
      await insertSyntheticMutationPrefix(transaction, tenantA, 1, 3);
      await transaction.query(
        `UPDATE workspace_revisions SET server_revision = 3
         WHERE account_id = $1 AND workspace_id = $2`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    });
    await makeAvailable("newest");
    await expect(service.compact(tenantA, 3)).resolves.toEqual({
      accepted: false,
      code: "COMPACTION_WATERMARK_BLOCKED",
    });
    expect(mutationPort.compactCalls).toBe(0);
  });

  it("rolls replay deletion and watermark back together while preserving receipts and Drain evidence", async () => {
    await seedWorkspace(tenantA, [{ ...initialRows[0]!, note: "accepted" }], 0);
    const persistentMutations = new PostgresWorkspaceMutationRepository();
    const mutation = submittedSyncMutationSchema.parse({
      schemaVersion: 1,
      mutationId: "compaction-rollback-mutation",
      workspaceId: tenantA.workspaceId,
      workspaceSchemaVersion: 1,
      entityType: "domain_asset",
      entityId: "a.test",
      baseServerRevision: 0,
      changedFields: [{ fieldPath: "note", value: "accepted" }],
      sourceDeviceId: "device-a",
      activeLeaseEpoch: 1,
      deviceMutationSequence: 1,
    });
    await seedActiveMutationDrainDomain(tenantA, mutation.sourceDeviceId);
    await transactions.withTenant(tenantA, async (transaction) => {
      const lock = await persistentMutations.lockDrainDomain(transaction, {
        sourceDeviceId: mutation.sourceDeviceId,
        activeLeaseEpoch: mutation.activeLeaseEpoch,
      });
      await persistentMutations.appendAccepted(transaction, lock, [{ mutation, serverRevision: 1 }]);
      await transaction.query(
        `UPDATE workspace_revisions SET server_revision = 1
         WHERE account_id = $1 AND workspace_id = $2 AND server_revision = 0`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    });
    await makeAvailable("rollback-checkpoint");
    const failingRevisions: CheckpointRevisionPort = {
      read: (transaction) => revisions.read(transaction),
      lock: (transaction) => revisions.lock(transaction),
      async compareAndAdvanceCompactionWatermark() { throw new Error("watermark-fault"); },
    };
    const failing = new PostgresCheckpointService({
      transactions,
      checkpoints,
      revisions: failingRevisions,
      portfolio,
      mutations: persistentMutations,
      deviceCursors,
      readerCursors,
      recovery,
    });
    await expect(failing.compact(tenantA, 1)).rejects.toThrow("watermark-fault");
    const state = await transactions.withTenant(tenantA, async (transaction) => ({
      revision: await revisions.read(transaction),
      counts: (await transaction.query<{ receipts: string; replay: string; drain: string }>(`
        SELECT
          (SELECT count(*) FROM workspace_mutation_receipts)::text AS receipts,
          (SELECT count(*) FROM workspace_mutations)::text AS replay,
          (SELECT count(*) FROM mutation_drain_records)::text AS drain`)).rows[0],
    }));
    expect(state).toMatchObject({
      revision: { compactedThroughServerRevision: 0 },
      counts: { receipts: "1", replay: "1", drain: "1" },
    });
  });

  it("compacts only replay rows while preserving receipts and Drain proof state", async () => {
    const persistedMutations = new PostgresWorkspaceMutationRepository();
    await seedReplayMutation();
    await seedOwnerOnlyMutationDrainSeal();
    await makeAvailable("compactable");
    const compacting = checkpointService(recovery, persistedMutations);
    await expect(compacting.compact(tenantA, 1)).resolves.toEqual({
      accepted: true,
      value: { compactedThroughServerRevision: 1, deletedMutationCount: 1 },
    });
    await transactions.withTenant(tenantA, async (transaction) => {
      const counts = await transaction.query<{
        receipts: string;
        mutations: string;
        fields: string;
        drain_records: string;
        drain_heads: string;
        drain_seals: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM workspace_mutation_receipts) AS receipts,
          (SELECT count(*)::text FROM workspace_mutations) AS mutations,
          (SELECT count(*)::text FROM workspace_mutation_fields) AS fields,
          (SELECT count(*)::text FROM mutation_drain_records) AS drain_records,
          (SELECT count(*)::text FROM mutation_drain_heads) AS drain_heads,
          (SELECT count(*)::text FROM mutation_drain_seals) AS drain_seals`,
      );
      expect(counts.rows[0]).toEqual({
        receipts: "1",
        mutations: "0",
        fields: "0",
        drain_records: "1",
        drain_heads: "1",
        drain_seals: "1",
      });
      await expect(revisions.read(transaction)).resolves.toMatchObject({ compactedThroughServerRevision: 1 });
    });
  });

  it("rolls replay deletion and watermark back together after a compaction fault", async () => {
    const persistedMutations = new PostgresWorkspaceMutationRepository();
    await seedReplayMutation();
    await makeAvailable("rollback");
    const faulting: CheckpointMutationRangePort = {
      readRange: (transaction, from, through) => persistedMutations.readRange(transaction, from, through),
      hasCompleteRange: (transaction, from, through) => persistedMutations.hasCompleteRange(transaction, from, through),
      async compactPrefix(transaction, through) {
        await persistedMutations.compactPrefix(transaction, through);
        throw new Error("compaction-delete-fault");
      },
    };
    await expect(checkpointService(recovery, faulting).compact(tenantA, 1)).rejects.toThrow("compaction-delete-fault");
    await transactions.withTenant(tenantA, async (transaction) => {
      const rows = await transaction.query<{ count: string }>("SELECT count(*)::text AS count FROM workspace_mutations");
      expect(rows.rows[0]?.count).toBe("1");
      await expect(revisions.read(transaction)).resolves.toMatchObject({ compactedThroughServerRevision: 0 });
    });
  });

  it("rebuilds persisted checkpoints deterministically in a read-only tenant snapshot", async () => {
    const persistedMutations = new PostgresWorkspaceMutationRepository();
    const rebuilding = checkpointService(recovery, persistedMutations);
    await seedWorkspace(tenantA, initialRows, 0);
    await seedWorkspace(tenantB, [{ ...initialRows[0]!, note: "tenant-b-baseline" }], 0);

    for (const scope of [tenantA, tenantB]) {
      await rebuilding.build(scope, "shared-rebuild-checkpoint", 0);
      await rebuilding.verify(scope, "shared-rebuild-checkpoint");
      await rebuilding.publish(scope, "shared-rebuild-checkpoint");
    }
    await advanceWorkspaceWithPersistedMutation(
      tenantA,
      persistedMutations,
      "tenant-a-rebuild-mutation",
      "tenant-a-rebuilt",
    );
    await advanceWorkspaceWithPersistedMutation(
      tenantB,
      persistedMutations,
      "tenant-b-rebuild-mutation",
      "tenant-b-rebuilt",
    );

    const tenantAFirst = await rebuilding.rebuild(tenantA, "shared-rebuild-checkpoint", 1);
    const tenantASecond = await rebuilding.rebuild(tenantA, "shared-rebuild-checkpoint", 1);
    const tenantBResult = await rebuilding.rebuild(tenantB, "shared-rebuild-checkpoint", 1);

    expect(tenantAFirst).toEqual(tenantASecond);
    expect(tenantAFirst).toMatchObject({
      accepted: true,
      value: { throughServerRevision: 1, rows: [{ entityId: "a.test", note: "tenant-a-rebuilt" }] },
    });
    expect(tenantBResult).toMatchObject({
      accepted: true,
      value: { throughServerRevision: 1, rows: [{ entityId: "a.test", note: "tenant-b-rebuilt" }] },
    });
    if (!tenantAFirst.accepted || !tenantBResult.accepted) throw new Error("persistent rebuild failed");
    expect(tenantAFirst.value.projectionDigest).not.toBe(tenantBResult.value.projectionDigest);
  });

  it("rejects a corrupt persisted checkpoint snapshot during service rebuild", async () => {
    const persistedMutations = new PostgresWorkspaceMutationRepository();
    const rebuilding = checkpointService(recovery, persistedMutations);
    await seedWorkspace(tenantA, initialRows, 0);
    await rebuilding.build(tenantA, "corrupt-snapshot", 0);
    await rebuilding.verify(tenantA, "corrupt-snapshot");
    await rebuilding.publish(tenantA, "corrupt-snapshot");
    await advanceWorkspaceWithPersistedMutation(
      tenantA,
      persistedMutations,
      "corrupt-snapshot-mutation",
      "live-value",
    );
    await withOwnerTenant(tenantA, async (transaction) => {
      await transaction.query(
        `UPDATE workspace_checkpoint_domain_assets SET note = 'tampered-snapshot'
         WHERE account_id = $1 AND workspace_id = $2 AND checkpoint_id = 'corrupt-snapshot'`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    });

    await expect(rebuilding.rebuild(tenantA, "corrupt-snapshot", 1)).resolves.toEqual({
      accepted: false,
      code: "REBUILD_CHAIN_INVALID",
    });
  });

  it("rejects missing and corrupt persisted mutation ranges during service rebuild", async () => {
    const persistedMutations = new PostgresWorkspaceMutationRepository();
    const rebuilding = checkpointService(recovery, persistedMutations);
    await seedWorkspace(tenantA, initialRows, 0);
    await seedWorkspace(tenantB, [{ ...initialRows[0]!, note: "tenant-b-baseline" }], 0);
    for (const scope of [tenantA, tenantB]) {
      await rebuilding.build(scope, "invalid-persisted-range", 0);
      await rebuilding.verify(scope, "invalid-persisted-range");
      await rebuilding.publish(scope, "invalid-persisted-range");
    }
    await advanceWorkspaceWithPersistedMutation(
      tenantA,
      persistedMutations,
      "missing-range-mutation",
      "tenant-a-live",
    );
    await advanceWorkspaceWithPersistedMutation(
      tenantB,
      persistedMutations,
      "corrupt-range-mutation",
      "tenant-b-live",
    );
    await withOwnerTenant(tenantA, async (transaction) => {
      await transaction.query(
        `DELETE FROM workspace_mutation_fields
         WHERE account_id = $1 AND workspace_id = $2 AND server_revision = 1`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    });
    await withOwnerTenant(tenantB, async (transaction) => {
      await transaction.query(
        `UPDATE workspace_mutations SET canonical_submitted_envelope = decode('00', 'hex')
         WHERE account_id = $1 AND workspace_id = $2 AND server_revision = 1`,
        [tenantB.accountId, tenantB.workspaceId],
      );
    });

    for (const scope of [tenantA, tenantB]) {
      await expect(rebuilding.rebuild(scope, "invalid-persisted-range", 1)).resolves.toEqual({
        accepted: false,
        code: "REBUILD_CHAIN_INVALID",
      });
    }
  });
});

describe("deterministic checkpoint rebuild", () => {
  const mutation = (revision: number, note: string): SyncMutation => ({
    schemaVersion: 1,
    mutationId: `mutation-${revision}`,
    workspaceId: tenantA.workspaceId,
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "a.test",
    baseServerRevision: revision - 1,
    changedFields: [{ fieldPath: "note", value: note }],
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 1,
    deviceMutationSequence: revision,
    serverRevision: revision,
  });

  it("replays a complete ordered range deterministically", () => {
    expect(replayDomainAssets(initialRows, [mutation(1, "one"), mutation(2, "two")], 0, 2, tenantA.workspaceId))
      .toEqual([{ ...initialRows[0]!, note: "two" }]);
  });

  it("rejects missing duplicate reordered and corrupt persisted mutation ranges", () => {
    const invalidRanges = [
      [mutation(1, "one")],
      [mutation(1, "one"), mutation(1, "duplicate")],
      [mutation(2, "two"), mutation(1, "one")],
      [{ ...mutation(1, "one"), changedFields: [{ fieldPath: "unknown", value: "x" }] }, mutation(2, "two")],
    ];
    for (const values of invalidRanges) {
      expect(() => replayDomainAssets(initialRows, values, 0, 2, tenantA.workspaceId)).toThrow();
    }
  });
});

function checkpointService(
  authority: RestoreCandidateWatermarkQueryPort | null,
  mutations: CheckpointMutationRangePort = mutationPort,
): PostgresCheckpointService {
  return new PostgresCheckpointService({
    transactions,
    checkpoints,
    revisions,
    portfolio,
    mutations,
    deviceCursors,
    readerCursors,
    recovery: authority,
  });
}

function checkpointServiceWithWatermarks(
  deviceRevision: number | null,
  readerRevision: number | null,
  candidateRevision: number | null,
): PostgresCheckpointService {
  return new PostgresCheckpointService({
    transactions,
    checkpoints,
    revisions,
    portfolio,
    mutations: mutationPort,
    deviceCursors: { async readMinimumActiveRevision() { return deviceRevision; } },
    readerCursors: { async retireExpiredAndReadMinimumActiveRevision() { return readerRevision; } },
    recovery: { async readOldestUnresolvedComparisonRevision() { return candidateRevision; } },
  });
}

async function seedReplayMutation(): Promise<void> {
  await seedWorkspace(tenantA, [{ ...initialRows[0]!, note: "accepted" }], 0);
  const mutation = submittedSyncMutationSchema.parse({
    schemaVersion: 1,
    mutationId: "mutation-1",
    workspaceId: tenantA.workspaceId,
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "a.test",
    baseServerRevision: 0,
    changedFields: [{ fieldPath: "note", value: "accepted" }],
    sourceDeviceId: "device-a",
    activeLeaseEpoch: 1,
    deviceMutationSequence: 1,
  });
  const envelope = Buffer.from(encodeDrainStreamEnvelope("mutation", mutation));
  const digest = createHash("sha256").update(envelope).digest();
  await seedActiveMutationDrainDomain(tenantA, mutation.sourceDeviceId);
  await withOwnerTenant(tenantA, async (transaction) => {
    await transaction.query(
      `SELECT public.workspace_mutation_drain_append_record(
         $1::text, 1::bigint, 1::bigint, $2::bytea
       )`,
      [mutation.sourceDeviceId, envelope],
    );
    await transaction.query(
      `INSERT INTO workspace_mutation_receipts (
         account_id, workspace_id, mutation_id, source_device_id, active_lease_epoch,
         device_mutation_sequence, server_revision, submitted_envelope_digest
       ) VALUES ($1, $2, $3, $4, 1, 1, 1, $5)`,
      [tenantA.accountId, tenantA.workspaceId, mutation.mutationId, mutation.sourceDeviceId, digest],
    );
    await transaction.query(
      `INSERT INTO workspace_mutations (
         account_id, workspace_id, server_revision, mutation_id, workspace_schema_version,
         entity_type, entity_id, base_server_revision, source_device_id, active_lease_epoch,
         device_mutation_sequence, canonical_submitted_envelope, submitted_envelope_digest
       ) VALUES ($1, $2, 1, $3, 1, 'domain_asset', $4, 0, $5, 1, 1, $6, $7)`,
      [tenantA.accountId, tenantA.workspaceId, mutation.mutationId, mutation.entityId,
        mutation.sourceDeviceId, envelope, digest],
    );
    await transaction.query(
      `INSERT INTO workspace_mutation_fields (
         account_id, workspace_id, server_revision, ordinal, field_path, value_is_null, text_value
       ) VALUES ($1, $2, 1, 0, 'note', false, 'accepted')`,
      [tenantA.accountId, tenantA.workspaceId],
    );
    await transaction.query(
      `UPDATE workspace_revisions SET server_revision = 1
       WHERE account_id = $1 AND workspace_id = $2 AND server_revision = 0`,
      [tenantA.accountId, tenantA.workspaceId],
    );
  });
}

/**
 * This is a deliberate owner-only historical-evidence fixture. It is not an app-role write
 * path and is used only to prove compaction preserves immutable evidence already present.
 */
async function seedOwnerOnlyMutationDrainSeal(): Promise<void> {
  await withOwnerTenant(tenantA, (transaction) => transaction.query(
    `INSERT INTO mutation_drain_seals (
       account_id, workspace_id, source_device_id, active_lease_epoch,
       last_assigned_device_mutation_sequence, rolling_digest, proof_id
     ) SELECT account_id, workspace_id, source_device_id, active_lease_epoch,
              contiguous_received_through, rolling_digest, 'compaction-seal'
       FROM mutation_drain_heads
      WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-a' AND active_lease_epoch = 1`,
    [tenantA.accountId, tenantA.workspaceId],
  ));
}

/**
 * Persistent mutation append routines require a legitimate active device domain. This owner
 * fixture seeds only supporting device authority rows; ordinary tests append the ledger through
 * its SECURITY DEFINER routine rather than direct app DML.
 */
async function seedActiveMutationDrainDomain(
  scope: typeof tenantA | typeof tenantB,
  sourceDeviceId: string,
): Promise<void> {
  await withOwnerTenant(scope, async (transaction) => {
    await transaction.query(`INSERT INTO device_account_states
      (account_id, binding_list_revision, highest_allocated_lease_epoch, current_lease_epoch)
      VALUES ($1, 1, 1, 1)
      ON CONFLICT (account_id) DO UPDATE
        SET binding_list_revision = 1, highest_allocated_lease_epoch = 1, current_lease_epoch = 1`,
    [scope.accountId]);
    await transaction.query(`UPDATE device_bindings
      SET status = 'removed', slot = NULL, removed_at = transaction_timestamp(),
          removal_reason = 'checkpoint-fixture-domain-reset'
      WHERE account_id = $1 AND device_id <> $2 AND status = 'bound'`,
    [scope.accountId, sourceDeviceId]);
    await transaction.query(`INSERT INTO device_bindings
      (account_id, device_id, slot, status, credential_epoch)
      VALUES ($1, $2, 1, 'bound', 1)
      ON CONFLICT (account_id, device_id) DO UPDATE
        SET slot = 1, status = 'bound', credential_epoch = 1, removed_at = NULL, removal_reason = NULL`,
    [scope.accountId, sourceDeviceId]);
    await transaction.query(`INSERT INTO device_lease_epoch_allocations
      (account_id, lease_epoch, workspace_id, workflow_id, status, terminal_at)
      VALUES ($1, 1, $2, $3, 'activated', transaction_timestamp())
      ON CONFLICT (account_id, lease_epoch) DO UPDATE
        SET workspace_id = EXCLUDED.workspace_id, workflow_id = EXCLUDED.workflow_id,
            status = 'activated', terminal_at = transaction_timestamp()`,
    [scope.accountId, scope.workspaceId, `checkpoint-drain-${sourceDeviceId}`]);
    await transaction.query(`INSERT INTO device_active_leases
      (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
       offline_execute_until, signed_envelope)
      VALUES ($1, 1, $2, $3, transaction_timestamp() - interval '2 minutes',
        transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '5 minutes',
        transaction_timestamp() + interval '1 hour', decode('01', 'hex'))
      ON CONFLICT (account_id, lease_epoch) DO UPDATE
        SET device_id = EXCLUDED.device_id, jti = EXCLUDED.jti, issued_at = EXCLUDED.issued_at,
            renew_after = EXCLUDED.renew_after, online_expires_at = EXCLUDED.online_expires_at,
            offline_execute_until = EXCLUDED.offline_execute_until, signed_envelope = EXCLUDED.signed_envelope,
            released_at = NULL, release_reason = NULL`,
    [scope.accountId, sourceDeviceId, `checkpoint-drain-lease-${scope.accountId}-${sourceDeviceId}`]);
  });
}

async function advanceWorkspaceWithPersistedMutation(
  scope: typeof tenantA | typeof tenantB,
  persistedMutations: PostgresWorkspaceMutationRepository,
  mutationId: string,
  note: string,
): Promise<void> {
  const mutation = submittedSyncMutationSchema.parse({
    schemaVersion: 1,
    mutationId,
    workspaceId: scope.workspaceId,
    workspaceSchemaVersion: 1,
    entityType: "domain_asset",
    entityId: "a.test",
    baseServerRevision: 0,
    changedFields: [{ fieldPath: "note", value: note }],
    sourceDeviceId: `${scope.accountId}-device`,
    activeLeaseEpoch: 1,
    deviceMutationSequence: 1,
  });
  await seedActiveMutationDrainDomain(scope, mutation.sourceDeviceId);
  await transactions.withTenant(scope, async (transaction) => {
    const lock = await persistedMutations.lockDrainDomain(transaction, {
      sourceDeviceId: mutation.sourceDeviceId,
      activeLeaseEpoch: mutation.activeLeaseEpoch,
    });
    await persistedMutations.appendAccepted(transaction, lock, [{ mutation, serverRevision: 1 }]);
    const projection = await transaction.query(
      `UPDATE workspace_replica_domain_assets
       SET note = $3, note_server_revision = 1
       WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'a.test'`,
      [scope.accountId, scope.workspaceId, note],
    );
    const revision = await transaction.query(
      `UPDATE workspace_revisions SET server_revision = 1
       WHERE account_id = $1 AND workspace_id = $2 AND server_revision = 0`,
      [scope.accountId, scope.workspaceId],
    );
    if (projection.rowCount !== 1 || revision.rowCount !== 1) {
      throw new Error("persistent rebuild fixture failed to advance workspace");
    }
  });
}

async function seedWorkspace(
  scope: typeof tenantA | typeof tenantB,
  rows: readonly DomainAssetProjectionRow[],
  serverRevision: number,
): Promise<void> {
  await transactions.withTenant(scope, async (transaction) => {
    await transaction.query(
      `INSERT INTO workspace_revisions (
         account_id, workspace_id, workspace_schema_version
       ) VALUES ($1, $2, 1)`,
      [scope.accountId, scope.workspaceId],
    );
    await insertSyntheticMutationPrefix(transaction, scope, 0, serverRevision);
    if (serverRevision > 0) {
      await transaction.query(
        `UPDATE workspace_revisions SET server_revision = $3
         WHERE account_id = $1 AND workspace_id = $2 AND server_revision = 0`,
        [scope.accountId, scope.workspaceId, serverRevision],
      );
    }
    for (const row of rows) {
      await transaction.query(
        `INSERT INTO workspace_replica_domain_assets (
           account_id, workspace_id, entity_id, note, portfolio_id, tags,
           target_price_currency, target_price_amount
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          scope.accountId,
          scope.workspaceId,
          row.entityId,
          row.note,
          row.portfolioId,
          row.tags,
          row.targetPrice?.currency ?? null,
          row.targetPrice?.amount ?? null,
        ],
      );
    }
  });
}

async function insertSyntheticMutationPrefix(
  transaction: TenantTransaction,
  scope: typeof tenantA | typeof tenantB,
  fromServerRevisionExclusive: number,
  throughServerRevisionInclusive: number,
): Promise<void> {
  for (let revision = fromServerRevisionExclusive + 1; revision <= throughServerRevisionInclusive; revision += 1) {
    const mutationId = `checkpoint-fixture-${revision}`;
    const digest = Buffer.alloc(32, revision);
    await transaction.query(
      `INSERT INTO workspace_mutation_receipts (
         account_id, workspace_id, mutation_id, source_device_id, active_lease_epoch,
         device_mutation_sequence, server_revision, submitted_envelope_digest
       ) VALUES ($1, $2, $3, 'checkpoint-fixture-device', 1, $4, $4, $5)`,
      [scope.accountId, scope.workspaceId, mutationId, revision, digest],
    );
    await transaction.query(
      `INSERT INTO workspace_mutations (
         account_id, workspace_id, server_revision, mutation_id, workspace_schema_version,
         entity_type, entity_id, base_server_revision, source_device_id, active_lease_epoch,
         device_mutation_sequence, canonical_submitted_envelope, submitted_envelope_digest
       ) VALUES ($1, $2, $3, $4, 1, 'domain_asset', 'a.test', $5,
                 'checkpoint-fixture-device', 1, $3, $6, $7)`,
      [scope.accountId, scope.workspaceId, revision, mutationId, revision - 1,
        Buffer.from(`checkpoint-${revision}`), digest],
    );
  }
}

async function makeAvailable(checkpointId: string): Promise<void> {
  const revision = await transactions.withTenant(tenantA, (transaction) => revisions.read(transaction));
  if (revision === null) throw new Error("workspace missing");
  await service.build(tenantA, checkpointId, revision.serverRevision);
  await service.verify(tenantA, checkpointId);
  await service.publish(tenantA, checkpointId);
}

async function withOwnerTenant<Result>(
  scope: typeof tenantA | typeof tenantB,
  operation: (transaction: { query: TenantTransaction["query"] }) => Promise<Result>,
): Promise<Result> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [scope.accountId]);
    await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);
    const result = await operation({ query: (text, values) => client.query(text, values === undefined ? undefined : [...values]) });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

class TestRevisionPort implements CheckpointRevisionPort {
  async read(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null> {
    return this.query(transaction, false);
  }

  async lock(transaction: TenantTransaction): Promise<WorkspaceRevisionSnapshot | null> {
    return this.query(transaction, true);
  }

  async compareAndAdvanceCompactionWatermark(
    transaction: TenantTransaction,
    expectedWatermark: number,
    nextWatermark: number,
  ): Promise<void> {
    const result = await transaction.query(
      "SELECT public.workspace_compaction_advance($1::bigint, $2::bigint)",
      [expectedWatermark, nextWatermark],
    );
    if (result.rowCount !== 1) throw new TypeError("workspace compaction watermark compare-and-set lost");
  }

  private async query(transaction: TenantTransaction, lock: boolean): Promise<WorkspaceRevisionSnapshot | null> {
    const result = await transaction.query<{
      workspace_schema_version: string;
      server_revision: string;
      compacted_through_server_revision: string;
    }>(
      `SELECT workspace_schema_version, server_revision, compacted_through_server_revision
       FROM workspace_revisions WHERE account_id = $1 AND workspace_id = $2 ${lock ? "FOR UPDATE" : ""}`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      workspaceSchemaVersion: Number(row.workspace_schema_version),
      serverRevision: Number(row.server_revision),
      compactedThroughServerRevision: Number(row.compacted_through_server_revision),
      lastReplicationActivityAt: null,
      lastSuccessfulProviderObservationAt: null,
    };
  }
}

class TestPortfolioSnapshotPort {
  async captureSnapshot(transaction: TenantTransaction): Promise<readonly DomainAssetProjectionRow[]> {
    const result = await transaction.query<{
      entity_id: string;
      note: string | null;
      portfolio_id: string | null;
      tags: string[];
      target_price_currency: string | null;
      target_price_amount: string | null;
    }>(
      `SELECT entity_id, note, portfolio_id, tags, target_price_currency, target_price_amount
       FROM workspace_replica_domain_assets WHERE account_id = $1 AND workspace_id = $2 ORDER BY entity_id COLLATE "C"`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    return domainAssetProjectionSchema.parse(result.rows.map((row) => ({
      entityId: row.entity_id,
      note: row.note,
      portfolioId: row.portfolio_id,
      tags: row.tags,
      targetPrice: row.target_price_currency === null || row.target_price_amount === null
        ? null
        : { currency: row.target_price_currency, amount: row.target_price_amount },
    })));
  }
}

class TestMutationRangePort implements CheckpointMutationRangePort {
  compactCalls = 0;

  async readRange(): Promise<readonly SyncMutation[]> { return []; }
  async hasCompleteRange(): Promise<boolean> { return true; }
  async compactPrefix(): Promise<number> {
    this.compactCalls += 1;
    return 0;
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  }
  return value;
}
