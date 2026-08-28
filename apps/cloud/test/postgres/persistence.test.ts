import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  domainAssetProjectionSchema,
  encodeDomainAssetProjectionDigestInput,
} from "@gooddealer/protocol/workspace";

import {
  runCloudMigrations,
  TenantTransactionRunner,
} from "../../src/db/index";
import { checkedCloudMigrationCatalog, cloudMigrations } from "../../src/db/migrations";
import { PostgresWorkspaceRevisionRepository } from "../../src/modules/workspace/revisions/index";
import {
  PostgresPortfolioMutationService,
  PostgresPortfolioProjectionQuery,
  PostgresPortfolioRepository,
  type PortfolioMaterializationPort,
} from "../../src/modules/workspace/state/portfolio/index";

const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
const appPool = new Pool({ connectionString: appUrl, max: 2 });
const reusePool = new Pool({ connectionString: appUrl, max: 1 });
const transactions = new TenantTransactionRunner(appPool);
const reuseTransactions = new TenantTransactionRunner(reusePool);
const revisions = new PostgresWorkspaceRevisionRepository();
const portfolio = new PostgresPortfolioRepository();
const mutations = new PostgresPortfolioMutationService({ transactions, revisions, portfolio });
const query = new PostgresPortfolioProjectionQuery({ transactions, revisions });

const tenantA = { accountId: "account-a", workspaceId: "same-workspace" } as const;
const tenantB = { accountId: "account-b", workspaceId: "same-workspace" } as const;
const seed = {
  entityId: "same.test",
  note: null,
  portfolioId: "same-portfolio",
  tags: [],
  targetPrice: null,
} as const;

beforeAll(async () => {
  const roles = await ownerPool.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('gooddealer_cloud_owner', 'gooddealer_cloud_app') ORDER BY rolname",
  );
  expect(roles.rows).toEqual([
    { rolname: "gooddealer_cloud_app", rolsuper: false, rolbypassrls: false },
    { rolname: "gooddealer_cloud_owner", rolsuper: false, rolbypassrls: false },
  ]);
  await runCloudMigrations(ownerPool, cloudMigrations);
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query("TRUNCATE workspace_replica_domain_assets, workspace_revisions CASCADE");
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end(), reusePool.end()]);
});

describe("PostgreSQL tenant persistence", () => {
  it("runs qualifying evidence only on PostgreSQL 18.6", async () => {
    const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  });

  it("matches the shared domain-asset corpus digest through the real PostgreSQL projection", async () => {
    const vector = JSON.parse(await readFile(
      new URL("../../../../packages/protocol/test-vectors/domain-asset-projection/valid/utf8-order.json", import.meta.url),
      "utf8",
    )) as unknown;
    if (typeof vector !== "object" || vector === null || !("rows" in vector) || !("digest" in vector)) {
      throw new TypeError("shared projection vector is malformed");
    }
    const rows = domainAssetProjectionSchema.parse(vector.rows);
    const corpusTenant = { accountId: "account-corpus", workspaceId: "workspace-corpus" } as const;
    await transactions.withTenant(corpusTenant, async (transaction) => {
      await revisions.bind(transaction, 1);
      for (const row of rows) await portfolio.seed(transaction, row);
    });
    const projected = await query.readPortfolio(corpusTenant) as {
      readonly assets: readonly { readonly asset: unknown }[];
    };
    const digest = createHash("sha256")
      .update(encodeDomainAssetProjectionDigestInput(projected.assets.map(({ asset }) => asset)))
      .digest("base64url");
    expect(digest).toBe(vector.digest);
    expect(digest).toBe("klLo9KohVV8AiSiT-slhvHNPfw--UhRBUe2AVQD4bgY");
  });

  it("keeps a failing post-catalog migration and its ledger row atomic", async () => {
    const failingId = "202608210001-failing-probe";
    await expect(runCloudMigrations(ownerPool, [
      ...cloudMigrations,
      {
        id: failingId,
        owner: "test/probe",
        sql: "CREATE TABLE migration_failure_probe (id integer); SELECT missing_column FROM migration_failure_probe",
      },
    ])).rejects.toThrow();
    const rolledBack = await ownerPool.query<{ name: string | null; ledger_count: string }>(
      `SELECT to_regclass('migration_failure_probe')::text AS name,
              (SELECT count(*)::text FROM gooddealer_cloud_migrations WHERE id = $1) AS ledger_count`,
      [failingId],
    );
    expect(rolledBack.rows).toEqual([{ name: null, ledger_count: "0" }]);
  });

  it("rejects unknown, non-prefix, owner, and checksum drift before the next migration executes", async () => {
    const terminal = checkedCloudMigrationCatalog[13];
    if (terminal === undefined) throw new Error("M014 is unexpectedly absent");
    const nextMigration = {
      id: "202608210001-drift-probe",
      owner: "test/probe",
      sql: "CREATE TABLE migration_drift_probe (id integer)",
    } as const;
    const catalogWithProbe = [...cloudMigrations, nextMigration];
    const assertProbeAbsent = async () => {
      const result = await ownerPool.query<{ name: string | null }>(
        "SELECT to_regclass('migration_drift_probe')::text AS name",
      );
      expect(result.rows).toEqual([{ name: null }]);
    };

    const unknownId = "202608200099-unknown-tail";
    await ownerPool.query(
      `INSERT INTO gooddealer_cloud_migrations (id, owner_module, checksum)
       VALUES ($1, 'test/unknown', repeat('f', 64))`,
      [unknownId],
    );
    try {
      await expect(runCloudMigrations(ownerPool, cloudMigrations))
        .rejects.toThrow("database has unknown applied migrations");
      await assertProbeAbsent();
    } finally {
      await ownerPool.query("DELETE FROM gooddealer_cloud_migrations WHERE id = $1", [unknownId]);
    }

    const nonPrefixId = "202608220001-non-prefix";
    await ownerPool.query("UPDATE gooddealer_cloud_migrations SET id = $2 WHERE id = $1", [terminal.id, nonPrefixId]);
    try {
      await expect(runCloudMigrations(ownerPool, catalogWithProbe))
        .rejects.toThrow("applied migrations are not a catalog prefix");
      await assertProbeAbsent();
    } finally {
      await ownerPool.query("UPDATE gooddealer_cloud_migrations SET id = $2 WHERE id = $1", [nonPrefixId, terminal.id]);
    }

    await ownerPool.query(
      "UPDATE gooddealer_cloud_migrations SET owner_module = 'test/drift' WHERE id = $1",
      [terminal.id],
    );
    try {
      await expect(runCloudMigrations(ownerPool, catalogWithProbe)).rejects.toThrow("migration metadata drift");
      await assertProbeAbsent();
    } finally {
      await ownerPool.query(
        "UPDATE gooddealer_cloud_migrations SET owner_module = $2 WHERE id = $1",
        [terminal.id, terminal.owner],
      );
    }

    await ownerPool.query(
      "UPDATE gooddealer_cloud_migrations SET checksum = repeat('0', 64) WHERE id = $1",
      [terminal.id],
    );
    try {
      await expect(runCloudMigrations(ownerPool, catalogWithProbe)).rejects.toThrow("migration metadata drift");
      await assertProbeAbsent();
    } finally {
      await ownerPool.query(
        "UPDATE gooddealer_cloud_migrations SET checksum = $2 WHERE id = $1",
        [terminal.id, terminal.checksum],
      );
    }

    try {
      await expect(runCloudMigrations(ownerPool, catalogWithProbe)).resolves.toHaveLength(15);
      await expect(runCloudMigrations(ownerPool, catalogWithProbe)).resolves.toHaveLength(15);
      const exactPrefix = await ownerPool.query<{ name: string | null; ledger_count: string }>(
        `SELECT to_regclass('migration_drift_probe')::text AS name,
                (SELECT count(*)::text FROM gooddealer_cloud_migrations WHERE id = $1) AS ledger_count`,
        [nextMigration.id],
      );
      expect(exactPrefix.rows).toEqual([{ name: "migration_drift_probe", ledger_count: "1" }]);
    } finally {
      await ownerPool.query("DROP TABLE IF EXISTS migration_drift_probe");
      await ownerPool.query("DELETE FROM gooddealer_cloud_migrations WHERE id = $1", [nextMigration.id]);
    }
  });

  it("isolates identical literal ids and clears scope across pooled commit and rollback reuse", async () => {
    for (const [scope, note] of [[tenantA, "tenant-a"], [tenantB, "tenant-b"]] as const) {
      await transactions.withTenant(scope, async (transaction) => {
        await revisions.bind(transaction, 1);
        await portfolio.seed(transaction, { ...seed, note });
      });
    }

    const reuseQuery = new PostgresPortfolioProjectionQuery({ transactions: reuseTransactions, revisions });
    await expect(reuseQuery.readPortfolio(tenantA)).resolves.toMatchObject({
      assets: [{ asset: { note: "tenant-a" } }],
    });
    await expect(reuseQuery.readPortfolio(tenantB)).resolves.toMatchObject({
      assets: [{ asset: { note: "tenant-b" } }],
    });
    await expect(reuseTransactions.withTenant(tenantA, async () => { throw new Error("rollback-probe"); }))
      .rejects.toThrow("rollback-probe");
    const residue = await reusePool.query<{ account_id: string | null; workspace_id: string | null }>(
      `SELECT nullif(current_setting('gooddealer.account_id', true), '') AS account_id,
              nullif(current_setting('gooddealer.workspace_id', true), '') AS workspace_id`,
    );
    expect(residue.rows[0]).toEqual({ account_id: null, workspace_id: null });
  });

  it("rejects invalid scope before acquiring a pool connection", async () => {
    let acquired = false;
    const guarded = new TenantTransactionRunner({
      async connect() {
        acquired = true;
        throw new Error("must not acquire");
      },
    } as unknown as Pool);
    await expect(guarded.withTenant({ accountId: "account-a", workspaceId: "same-workspace", extra: true }, async () => undefined))
      .rejects.toThrow("scope is unresolved");
    expect(acquired).toBe(false);
  });

  it("blocks direct cross-tenant writes and cross-tenant foreign keys through forced RLS", async () => {
    await transactions.withTenant(tenantA, async (transaction) => {
      await revisions.bind(transaction, 1);
      await portfolio.seed(transaction, seed);
    });
    await expect(transactions.withTenant(tenantB, async (transaction) => {
      await transaction.query(
        `INSERT INTO workspace_replica_domain_assets (account_id, workspace_id, entity_id)
         VALUES ($1, $2, 'same.test')`,
        [tenantA.accountId, tenantA.workspaceId],
      );
    })).rejects.toThrow();
    await transactions.withTenant(tenantB, async (transaction) => {
      const result = await transaction.query(
        `UPDATE workspace_replica_domain_assets SET note = 'cross-tenant'
         WHERE account_id = $1 AND workspace_id = $2 AND entity_id = $3`,
        [tenantA.accountId, tenantA.workspaceId, seed.entityId],
      );
      expect(result.rowCount).toBe(0);
    });
    await expect(transactions.withTenant(tenantB, async (transaction) => {
      await transaction.query(
        `INSERT INTO workspace_replica_domain_assets (account_id, workspace_id, entity_id)
         VALUES ($1, $2, 'same.test')`,
        [tenantB.accountId, tenantB.workspaceId],
      );
    })).rejects.toThrow();
    await expect(transactions.withTenant(tenantA, async (transaction) => {
      await transaction.query(
        `DELETE FROM workspace_replica_domain_assets
         WHERE account_id = $1 AND workspace_id = $2 AND entity_id = $3`,
        [tenantA.accountId, tenantA.workspaceId, seed.entityId],
      );
    })).rejects.toThrow();
  });

  it("keeps unimplemented replica families read-only for the application role", async () => {
    const privileges = await appPool.query<{ table_name: string; can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }>(
      `SELECT table_name,
              has_table_privilege(current_user, table_name, 'SELECT') AS can_select,
              has_table_privilege(current_user, table_name, 'INSERT') AS can_insert,
              has_table_privilege(current_user, table_name, 'UPDATE') AS can_update,
              has_table_privilege(current_user, table_name, 'DELETE') AS can_delete
       FROM unnest(ARRAY[
         'workspace_replica_portfolios', 'workspace_replica_observations',
         'workspace_replica_dns_records', 'workspace_replica_operation_summaries',
         'workspace_replica_business_events', 'workspace_replica_tombstones'
       ]) AS table_name
       ORDER BY table_name`,
    );
    expect(privileges.rows).toEqual(privileges.rows.map(({ table_name }) => ({
      table_name,
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    })));
  });

  it("rejects direct projection CAS when no dense mutation-log prefix exists", async () => {
    await transactions.withTenant(tenantA, async (transaction) => {
      await revisions.bind(transaction, 1);
      await portfolio.seed(transaction, seed);
    });
    const attempts = ["winner-one", "winner-two"].map((note) =>
      mutations.compareAndMaterialize(tenantA, 0, 1, [{ ...seed, note }]));
    const settled = await Promise.allSettled(attempts);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(0);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(2);
    const projection = await query.readPortfolio(tenantA) as {
      projection: { materializedThroughServerRevision: number };
      assets: readonly { asset: { note: string | null } }[];
    };
    expect(projection.projection.materializedThroughServerRevision).toBe(0);
    expect(projection.assets[0]?.asset.note).toBeNull();
  });

  it("rejects a projection-only revision advance before materialization", async () => {
    await transactions.withTenant(tenantA, async (transaction) => {
      await revisions.bind(transaction, 1);
      await portfolio.seed(transaction, seed);
    });
    let materialized = false;
    const failingPortfolio: PortfolioMaterializationPort = {
      async materialize() { materialized = true; throw new Error("materialization-fault"); },
    };
    const service = new PostgresPortfolioMutationService({ transactions, revisions, portfolio: failingPortfolio });
    await expect(service.compareAndMaterialize(tenantA, 0, 1, [{ ...seed, note: "must-not-stick" }]))
      .rejects.toThrow("dense mutation prefix");
    expect(materialized).toBe(false);
    await expect(query.readPortfolio(tenantA)).resolves.toMatchObject({
      projection: { materializedThroughServerRevision: 0 },
      assets: [{ asset: { note: null } }],
    });
  });
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  }
  return value;
}
