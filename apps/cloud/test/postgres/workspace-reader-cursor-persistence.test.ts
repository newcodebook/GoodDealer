import { createHash } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  encodeMutationPageDigestInput,
  type MutationPage,
} from "@gooddealer/protocol/workspace";

import { runCloudMigrations, TenantTransactionRunner, type TenantTransaction } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { PostgresReaderCursorRepository } from "../../src/modules/workspace/cursors/postgres-reader-cursor-repository";
import {
  PostgresReaderCursorService,
  type ReaderMutationPageQueryPort,
  type ReaderWorkspaceRevisionLockPort,
} from "../../src/modules/workspace/cursors/postgres-reader-cursor-service";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 8 });
const transactions = new TenantTransactionRunner(appPool);
const cursors = new PostgresReaderCursorRepository();
let pages: DenseTestPages;
let service: PostgresReaderCursorService;

const scope = { accountId: "reader-account", workspaceId: "reader-workspace" } as const;
const otherScope = { accountId: "reader-account-other", workspaceId: scope.workspaceId } as const;

beforeAll(async () => {
  pages = new DenseTestPages();
  service = new PostgresReaderCursorService({
    transactions, revisions: new TestRevisionLock(), cursors, pages, leaseTtlSeconds: 60,
  });
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  pages.observed.length = 0;
  pages.corruptDigest = false;
  await ownerPool.query("TRUNCATE workspace_reader_cursors, workspace_device_cursors, workspace_revisions CASCADE");
  await Promise.all([seedRevision(scope, 3, 0), seedRevision(otherScope, 3, 0)]);
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end()]);
});

describe("PostgreSQL ReaderCursor persistence", () => {
  it("pins the first-page head and gives one concurrent CAS presentation a single winner", async () => {
    const opened = await service.open(scope, { deviceId: "reader-one", atRevision: 0 });
    expect(opened).toMatchObject({ accepted: true, presentation: { generation: 1, rowVersion: 1, continuationToken: null } });
    if (!opened.accepted) throw new Error("reader did not open");

    const attempts = await Promise.all([
      service.readAfter(scope, { deviceId: "reader-one", ...opened.presentation, pageLimit: 1 }),
      service.readAfter(scope, { deviceId: "reader-one", ...opened.presentation, pageLimit: 1 }),
    ]);
    const accepted = attempts.find((result) => result.accepted);
    expect(attempts.filter((result) => result.accepted)).toHaveLength(1);
    expect(attempts.filter((result) => !result.accepted)).toEqual([
      { accepted: false, code: "READER_CURSOR_STALE_PRESENTATION" },
    ]);
    if (accepted === undefined || !accepted.accepted) throw new Error("page CAS had no winner");
    expect(accepted.page.throughServerRevisionInclusive).toBe(3);
    expect(accepted.presentation.continuationToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    await seedRevision(scope, 4, 0);
    const second = await service.readAfter(scope, {
      deviceId: "reader-one", ...accepted.presentation, pageLimit: 1,
    });
    expect(second).toMatchObject({ accepted: true, page: { throughServerRevisionInclusive: 3, returnedThroughServerRevision: 2 } });
    expect(pages.observed.every(({ target }) => target === 3)).toBe(true);
    if (!second.accepted) throw new Error("second page failed");
    const terminal = await service.readAfter(scope, {
      deviceId: "reader-one", ...second.presentation, pageLimit: 1,
    });
    expect(terminal).toMatchObject({
      accepted: true,
      page: { throughServerRevisionInclusive: 3, returnedThroughServerRevision: 3, nextCursor: null },
      presentation: { continuationToken: null },
    });
    const stored = await transactions.withTenant(scope, (transaction) => cursors.lock(transaction, "reader-one"));
    expect(stored).toMatchObject({ pinnedPageTargetServerRevision: null, nextRevision: null, continuationTokenDigest: null });
  });

  it("rejects stale generation, row version, and continuation token without reading a page", async () => {
    const opened = await service.open(scope, { deviceId: "reader-stale", atRevision: 0 });
    if (!opened.accepted) throw new Error("reader did not open");
    const first = await service.readAfter(scope, {
      deviceId: "reader-stale", ...opened.presentation, pageLimit: 1,
    });
    if (!first.accepted) throw new Error("reader did not read");
    const readsBefore = pages.observed.length;
    await expect(service.readAfter(scope, {
      deviceId: "reader-stale",
      generation: first.presentation.generation,
      rowVersion: first.presentation.rowVersion,
      continuationToken: "A".repeat(43),
      pageLimit: 1,
    })).resolves.toEqual({ accepted: false, code: "READER_CURSOR_STALE_PRESENTATION" });
    await expect(service.readAfter(scope, {
      deviceId: "reader-stale", ...opened.presentation, pageLimit: 1,
    })).resolves.toEqual({ accepted: false, code: "READER_CURSOR_STALE_PRESENTATION" });
    expect(pages.observed).toHaveLength(readsBefore);
  });

  it("uses database transaction time and retires at the exact TTL boundary", async () => {
    const opened = await service.open(scope, { deviceId: "reader-ttl", atRevision: 0 });
    if (!opened.accepted) throw new Error("reader did not open");
    await transactions.withTenant(scope, (transaction) => transaction.query(
      `UPDATE workspace_reader_cursors SET lease_expires_at = transaction_timestamp()
       WHERE device_id = 'reader-ttl'`,
    ));
    await expect(service.renew(scope, { deviceId: "reader-ttl", ...opened.presentation }))
      .resolves.toEqual({ accepted: false, code: "READER_CURSOR_TTL_EXPIRED" });
    const stored = await transactions.withTenant(scope, (transaction) => cursors.lock(transaction, "reader-ttl"));
    expect(stored).toMatchObject({
      status: "retired", retirementReason: "ttl_expired", resumeRequirement: "rebootstrap_required",
    });
  });

  it("rejects an invalid stored page digest without advancing or returning a partial page", async () => {
    const opened = await service.open(scope, { deviceId: "reader-corrupt", atRevision: 0 });
    if (!opened.accepted) throw new Error("reader did not open");
    pages.corruptDigest = true;
    await expect(service.readAfter(scope, {
      deviceId: "reader-corrupt", ...opened.presentation, pageLimit: 1,
    })).resolves.toEqual({ accepted: false, code: "READER_CURSOR_STORAGE_INVALID" });
    const stored = await transactions.withTenant(scope, (transaction) => cursors.lock(transaction, "reader-corrupt"));
    expect(stored).toMatchObject({ rowVersion: 1, readThroughServerRevision: 0, pinnedPageTargetServerRevision: null });
  });

  it("rejects malformed input before opening a transaction or invoking a page query", async () => {
    let getterCalls = 0;
    const hostile = Object.defineProperty({ deviceId: "reader-hostile" }, "atRevision", {
      enumerable: true,
      get() { getterCalls += 1; return 0; },
    });
    await expect(service.open(scope, hostile)).rejects.toThrow("reader cursor input is malformed");
    expect(getterCalls).toBe(0);
    expect(pages.observed).toHaveLength(0);
    const count = await transactions.withTenant(scope, (transaction) => transaction.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM workspace_reader_cursors",
    ));
    expect(count.rows[0]?.count).toBe("0");
  });

  it("rejects non-ordinary ReaderCursor wire values before withTenant without invoking getters", async () => {
    const sentinelTransactions = new SentinelTenantTransactionRunner();
    const sentinelService = new PostgresReaderCursorService({
      transactions: sentinelTransactions,
      revisions: new TestRevisionLock(),
      cursors,
      pages,
      leaseTtlSeconds: 60,
    });
    let getterCalls = 0;

    const hiddenExtra = Object.defineProperty(
      { deviceId: "reader-hostile", atRevision: 0 },
      "hidden",
      { enumerable: false, value: true },
    );
    const symbolExtra = { deviceId: "reader-hostile", atRevision: 0 } as Record<PropertyKey, unknown>;
    symbolExtra[Symbol("hidden")] = true;
    const accessor = Object.defineProperty({ deviceId: "reader-hostile" }, "atRevision", {
      enumerable: true,
      get() { getterCalls += 1; return 0; },
    });
    const inherited = Object.assign(Object.create({ inherited: true }) as Record<string, unknown>, {
      deviceId: "reader-hostile",
      atRevision: 0,
    });
    const nestedAccessor = Object.defineProperty({}, "revision", {
      enumerable: true,
      get() { getterCalls += 1; return 0; },
    });
    const nestedSymbol = { revision: 0 } as Record<PropertyKey, unknown>;
    nestedSymbol[Symbol("hidden")] = true;
    const customArray = [0];
    Object.setPrototypeOf(customArray, Object.create(Array.prototype));
    const sparseArray = new Array(2);
    sparseArray[1] = 0;
    const arrayWithExtra = [0] as unknown[] & { hidden?: boolean };
    arrayWithExtra.hidden = true;

    const hostileInputs: readonly unknown[] = [
      hiddenExtra,
      symbolExtra,
      accessor,
      inherited,
      { deviceId: "reader-hostile", atRevision: nestedAccessor },
      { deviceId: "reader-hostile", atRevision: nestedSymbol },
      { deviceId: "reader-hostile", atRevision: customArray },
      { deviceId: "reader-hostile", atRevision: sparseArray },
      { deviceId: "reader-hostile", atRevision: arrayWithExtra },
    ];

    for (const hostile of hostileInputs) {
      await expect(sentinelService.open(scope, hostile)).rejects.toThrow("reader cursor input is malformed");
    }
    expect(getterCalls).toBe(0);
    expect(sentinelTransactions.calls).toBe(0);
    expect(pages.observed).toHaveLength(0);
  });

  it("retires a compaction race, reopens only from a valid baseline, and increments generation", async () => {
    const opened = await service.open(scope, { deviceId: "reader-compact", atRevision: 0 });
    if (!opened.accepted) throw new Error("reader did not open");
    await seedRevision(scope, 3, 1);
    await expect(service.renew(scope, { deviceId: "reader-compact", ...opened.presentation }))
      .resolves.toEqual({ accepted: false, code: "READER_CURSOR_COMPACTION_RACE" });
    const retired = await transactions.withTenant(scope, (transaction) => cursors.lock(transaction, "reader-compact"));
    if (retired === null) throw new Error("retired reader disappeared");
    await expect(service.reopenAfterRebootstrap(scope, {
      deviceId: "reader-compact", baselineServerRevision: 0,
      generation: retired.generation, rowVersion: retired.rowVersion,
    })).resolves.toEqual({ accepted: false, code: "READER_CURSOR_COMPACTION_RACE" });
    const reopened = await service.reopenAfterRebootstrap(scope, {
      deviceId: "reader-compact", baselineServerRevision: 1,
      generation: retired.generation, rowVersion: retired.rowVersion,
    });
    expect(reopened).toMatchObject({ accepted: true, cursor: { generation: 2, readThroughServerRevision: 1 } });
  });

  it("makes device removal terminal and keeps its transaction-aware retirement rollback-safe", async () => {
    const opened = await service.open(scope, { deviceId: "reader-remove", atRevision: 0 });
    if (!opened.accepted) throw new Error("reader did not open");
    await expect(transactions.withTenant(scope, async (transaction) => {
      await cursors.retireForDeviceRemoval(transaction, "reader-remove");
      throw new Error("control-plane-fault");
    })).rejects.toThrow("control-plane-fault");
    await expect(service.renew(scope, { deviceId: "reader-remove", ...opened.presentation }))
      .resolves.toMatchObject({ accepted: true });

    await transactions.withTenant(scope, (transaction) => cursors.retireForDeviceRemoval(transaction, "reader-remove"));
    const removed = await transactions.withTenant(scope, (transaction) => cursors.lock(transaction, "reader-remove"));
    if (removed === null) throw new Error("removed reader disappeared");
    await expect(service.reopenAfterRebootstrap(scope, {
      deviceId: "reader-remove", baselineServerRevision: 0,
      generation: removed.generation, rowVersion: removed.rowVersion,
    })).resolves.toEqual({ accepted: false, code: "READER_CURSOR_DEVICE_REMOVED" });
  });

  it("retires expired cursors before reporting the compaction minimum and isolates tenants", async () => {
    await service.open(scope, { deviceId: "same-reader", atRevision: 1 });
    await service.open(otherScope, { deviceId: "same-reader", atRevision: 2 });
    await service.open(scope, { deviceId: "expired-reader", atRevision: 0 });
    await transactions.withTenant(scope, (transaction) => transaction.query(
      "UPDATE workspace_reader_cursors SET lease_expires_at = transaction_timestamp() WHERE device_id = 'expired-reader'",
    ));
    await expect(transactions.withTenant(scope, (transaction) =>
      cursors.retireExpiredAndReadMinimumActiveRevision(transaction))).resolves.toBe(1);
    await expect(transactions.withTenant(otherScope, (transaction) =>
      cursors.retireExpiredAndReadMinimumActiveRevision(transaction))).resolves.toBe(2);
  });

  it("has compound tenant FKs, ENABLE plus FORCE RLS, and the documented DeviceCursor strengthening", async () => {
    const rls = await ownerPool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('workspace_reader_cursors', 'workspace_device_cursors') ORDER BY relname`,
    );
    expect(rls.rows).toHaveLength(2);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const constraints = await ownerPool.query<{ conname: string; target: string | null }>(
      `SELECT conname, confrelid::regclass::text AS target FROM pg_constraint
       WHERE conrelid IN ('workspace_reader_cursors'::regclass, 'workspace_device_cursors'::regclass)
       ORDER BY conname`,
    );
    expect(constraints.rows).toEqual(expect.arrayContaining([
      { conname: "workspace_device_cursors_workspace_fk", target: "workspace_revisions" },
    ]));
    expect(constraints.rows.filter(({ target }) => target === "workspace_revisions")).toHaveLength(2);
    const activeIndex = await ownerPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE indexname = 'workspace_device_cursors_one_active_per_workspace'`,
    );
    expect(activeIndex.rows[0]?.indexdef).toContain("WHERE (status = 'active'::text)");
  });
});

class TestRevisionLock implements ReaderWorkspaceRevisionLockPort {
  async lock(transaction: TenantTransaction) {
    const result = await transaction.query<{ server_revision: string; compacted_through_server_revision: string }>(
      `SELECT server_revision, compacted_through_server_revision FROM workspace_revisions
       WHERE account_id = $1 AND workspace_id = $2 FOR UPDATE`,
      [transaction.scope.accountId, transaction.scope.workspaceId],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      serverRevision: Number(row.server_revision),
      compactedThroughServerRevision: Number(row.compacted_through_server_revision),
    };
  }
}

class SentinelTenantTransactionRunner extends TenantTransactionRunner {
  calls = 0;

  constructor() {
    super(appPool);
  }

  override async withTenant<Result>(): Promise<Result> {
    this.calls += 1;
    throw new Error("withTenant must not be reached");
  }
}

class DenseTestPages implements ReaderMutationPageQueryPort {
  readonly observed: { readonly from: number; readonly target: number }[] = [];
  corruptDigest = false;

  async readPage(transaction: TenantTransaction, input: {
    readonly fromServerRevisionExclusive: number;
    readonly throughServerRevisionInclusive: number;
    readonly pageLimit: number;
  }): Promise<MutationPage> {
    this.observed.push({ from: input.fromServerRevisionExclusive, target: input.throughServerRevisionInclusive });
    const nextRevision = input.fromServerRevisionExclusive + 1;
    const terminal = nextRevision >= input.throughServerRevisionInclusive;
    const mutations = input.fromServerRevisionExclusive === input.throughServerRevisionInclusive ? [] : [{
      schemaVersion: 1 as const,
      mutationId: `mutation-${nextRevision}`,
      workspaceId: transaction.scope.workspaceId,
      workspaceSchemaVersion: 1,
      entityType: "domain_asset" as const,
      entityId: "asset-one.test",
      baseServerRevision: 0,
      changedFields: [{ fieldPath: "note" as const, value: `revision-${nextRevision}` }],
      sourceDeviceId: "writer-one",
      activeLeaseEpoch: 1,
      deviceMutationSequence: nextRevision,
      serverRevision: nextRevision,
    }];
    const returnedThroughServerRevision = mutations[0]?.serverRevision ?? input.fromServerRevisionExclusive;
    const unsigned: MutationPage = {
      schemaVersion: 1,
      workspaceId: transaction.scope.workspaceId,
      fromServerRevisionExclusive: input.fromServerRevisionExclusive,
      throughServerRevisionInclusive: input.throughServerRevisionInclusive,
      mutations,
      returnedThroughServerRevision,
      nextCursor: terminal ? null : `page-${returnedThroughServerRevision}`,
      pageDigest: "A".repeat(43),
    };
    const page = {
      ...unsigned,
      pageDigest: createHash("sha256").update(encodeMutationPageDigestInput(unsigned)).digest("base64url"),
    };
    return this.corruptDigest ? { ...page, pageDigest: "A".repeat(43) } : page;
  }
}

async function seedRevision(
  tenant: { readonly accountId: string; readonly workspaceId: string },
  serverRevision: number,
  compactedThroughServerRevision: number,
): Promise<void> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE workspace_revisions DISABLE TRIGGER workspace_revisions_initial_state_guard");
    await client.query("ALTER TABLE workspace_revisions DISABLE TRIGGER workspace_revisions_dense_mutation_guard");
    await client.query(
      `INSERT INTO workspace_revisions
         (account_id, workspace_id, workspace_schema_version, server_revision, compacted_through_server_revision)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (account_id, workspace_id) DO UPDATE
       SET server_revision = EXCLUDED.server_revision,
           compacted_through_server_revision = EXCLUDED.compacted_through_server_revision`,
      [tenant.accountId, tenant.workspaceId, serverRevision, compactedThroughServerRevision],
    );
    await client.query("ALTER TABLE workspace_revisions ENABLE TRIGGER workspace_revisions_dense_mutation_guard");
    await client.query("ALTER TABLE workspace_revisions ENABLE TRIGGER workspace_revisions_initial_state_guard");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL evidence never skips`);
  return value;
}
