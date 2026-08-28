import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runCloudMigrations, TenantTransactionRunner } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { PostgresWorkspaceRevisionRepository } from "../../src/modules/workspace/revisions/index";
import {
  PostgresPortfolioProjectionQuery,
  PostgresPortfolioRepository,
} from "../../src/modules/workspace/state/portfolio/index";

const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
const appPool = new Pool({ connectionString: appUrl, max: 3 });
const reusePool = new Pool({ connectionString: appUrl, max: 1 });
const shadowPool = new Pool({ connectionString: appUrl, max: 1 });
const ownerTransactions = new TenantTransactionRunner(ownerPool);
const transactions = new TenantTransactionRunner(appPool);
const reuseTransactions = new TenantTransactionRunner(reusePool);
const shadowTransactions = new TenantTransactionRunner(shadowPool);
const revisions = new PostgresWorkspaceRevisionRepository();
const portfolio = new PostgresPortfolioRepository();
const query = new PostgresPortfolioProjectionQuery({ transactions, revisions });
const preexistingScope = { accountId: "portfolio-read-existing", workspaceId: "workspace-existing" } as const;

beforeAll(async () => {
  assertConsolidatedCatalog();
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query("TRUNCATE workspace_replica_domain_assets, workspace_replica_portfolio_state, workspace_revisions CASCADE");
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end(), reusePool.end(), shadowPool.end()]);
});

describe("consolidated portfolio replica M002 and PostgreSQL query", () => {
  it("backfills an existing M001 workspace honestly and restores forced RLS", async () => {
    const schema = "m002_backfill_control";
    await ownerPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await ownerPool.query(`CREATE SCHEMA ${schema} AUTHORIZATION gooddealer_cloud_owner`);
    const schemaOwnerPool = new Pool({ connectionString: ownerUrl, max: 1, options: `-c search_path=${schema}` });
    const schemaTransactions = new TenantTransactionRunner(schemaOwnerPool);
    try {
      await runCloudMigrations(schemaOwnerPool, cloudMigrations.slice(0, 1));
      await schemaTransactions.withTenant(preexistingScope, async (transaction) => {
        await revisions.bind(transaction, 1);
        await transaction.query(
          "UPDATE workspace_revisions SET server_revision = 9 WHERE account_id = $1 AND workspace_id = $2",
          [preexistingScope.accountId, preexistingScope.workspaceId],
        );
      });
      await runCloudMigrations(schemaOwnerPool, cloudMigrations.slice(0, 2));
      const evidence = await schemaTransactions.withTenant(preexistingScope, async (transaction) =>
        transaction.query(
          `SELECT materialized_through_server_revision::text AS materialized_through_server_revision,
                  materialized_at, projection_availability, projection_evidence_status
           FROM workspace_replica_portfolio_state
           WHERE account_id = $1 AND workspace_id = $2`,
          [preexistingScope.accountId, preexistingScope.workspaceId],
        ));
      expect(evidence.rows).toEqual([{
        materialized_through_server_revision: "9",
        materialized_at: null,
        projection_availability: "unavailable",
        projection_evidence_status: "unknown",
      }]);
      expect(await relationRlsFlags(schema, "workspace_revisions"))
        .toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    } finally {
      await schemaOwnerPool.end();
      await ownerPool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });

  it("rolls back complete M002 schema, temporary NO FORCE, and ledger when its FORCE tail fails", async () => {
    const schema = "m002_force_tail_failure_control";
    await ownerPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await ownerPool.query(`CREATE SCHEMA ${schema} AUTHORIZATION gooddealer_cloud_owner`);
    const failurePool = new Pool({ connectionString: ownerUrl, max: 1, options: `-c search_path=${schema}` });
    try {
      await runCloudMigrations(failurePool, cloudMigrations.slice(0, 1));
      const ledgerBefore = await ownerPool.query<{ id: string; owner_module: string; checksum: string }>(
        `SELECT id, owner_module, checksum FROM ${schema}.gooddealer_cloud_migrations
         ORDER BY id COLLATE "C"`,
      );
      expect(ledgerBefore.rows.map((row) => row.id)).toEqual(["202608200001-workspace-revisions"]);
      const flagsBefore = await relationRlsFlags(schema, "workspace_revisions");
      expect(flagsBefore).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

      const forceTail = "ALTER TABLE workspace_revisions FORCE ROW LEVEL SECURITY;";
      const businessReplicaModelMigration = cloudMigrations[1]!;
      expect(businessReplicaModelMigration.sql.split(forceTail)).toHaveLength(2);
      const failingM002 = {
        ...businessReplicaModelMigration,
        sql: businessReplicaModelMigration.sql.replace(
          forceTail,
          "SELECT missing_m002_force_tail_control();",
        ),
      };
      await expect(runCloudMigrations(failurePool, [cloudMigrations[0]!, failingM002]))
        .rejects.toThrow();

      expect(await relationRlsFlags(schema, "workspace_revisions"))
        .toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const residue = await ownerPool.query<{
        projection_table: string | null;
        projection_trigger: string | null;
        materialization_columns: string;
      }>(
        `SELECT
           to_regclass($1)::text AS projection_table,
           (SELECT tgname FROM pg_trigger
            WHERE tgrelid = $2::regclass AND tgname = 'workspace_replica_portfolio_state_initialize')
             AS projection_trigger,
           (SELECT count(*)::text FROM information_schema.columns
            WHERE table_schema = $3 AND table_name = 'workspace_replica_domain_assets'
              AND column_name LIKE 'materialization_%') AS materialization_columns`,
        [`${schema}.workspace_replica_portfolio_state`, `${schema}.workspace_revisions`, schema],
      );
      expect(residue.rows).toEqual([{
        projection_table: null,
        projection_trigger: null,
        materialization_columns: "0",
      }]);
      const ledgerAfter = await ownerPool.query<{ id: string; owner_module: string; checksum: string }>(
        `SELECT id, owner_module, checksum FROM ${schema}.gooddealer_cloud_migrations
         ORDER BY id COLLATE "C"`,
      );
      expect(ledgerAfter.rows).toEqual(ledgerBefore.rows);
    } finally {
      await failurePool.end();
      await ownerPool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });

  it("initializes a new empty workspace and returns honest unavailable state", async () => {
    const scope = { accountId: "account-empty", workspaceId: "workspace-empty" } as const;
    await transactions.withTenant(scope, async (transaction) => revisions.bind(transaction, 1));

    await expect(query.readPortfolio(scope)).resolves.toEqual({
      schemaVersion: 1,
      assets: [],
      projection: {
        materializedThroughServerRevision: 0,
        materializedAt: null,
        projectionAvailability: "unavailable",
        projectionEvidenceStatus: "unknown",
      },
    });
  });

  it("cannot redirect new-workspace initialization through a pg_temp shadow table", async () => {
    const scope = { accountId: "account-shadow", workspaceId: "workspace-shadow" } as const;
    await shadowTransactions.withTenant(scope, async (transaction) => {
      await transaction.query(`CREATE TEMP TABLE pg_temp.workspace_replica_portfolio_state (
        account_id text NOT NULL,
        workspace_id text NOT NULL,
        materialized_through_server_revision bigint NOT NULL,
        materialized_at timestamptz,
        projection_availability text NOT NULL,
        projection_evidence_status text NOT NULL,
        PRIMARY KEY (account_id, workspace_id)
      )`);

      await revisions.bind(transaction, 1);

      const persisted = await transaction.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM public.workspace_replica_portfolio_state
         WHERE account_id = $1 AND workspace_id = $2`,
        [scope.accountId, scope.workspaceId],
      );
      const shadowed = await transaction.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_temp.workspace_replica_portfolio_state
         WHERE account_id = $1 AND workspace_id = $2`,
        [scope.accountId, scope.workspaceId],
      );
      expect(persisted.rows).toEqual([{ count: "1" }]);
      expect(shadowed.rows).toEqual([{ count: "0" }]);
    });
    await shadowPool.query("DROP TABLE pg_temp.workspace_replica_portfolio_state");
  });

  it("persists materialization and returns canonical timestamps, bigint versions, and UTF-8 ordering", async () => {
    const scope = { accountId: "account-positive", workspaceId: "workspace-positive" } as const;
    await transactions.withTenant(scope, async (transaction) => {
      await revisions.bind(transaction, 1);
      await portfolio.seed(transaction, {
        entityId: "b.test", note: null, portfolioId: null, tags: [], targetPrice: null,
      });
      await portfolio.seed(transaction, {
        entityId: "a.test", note: "observed", portfolioId: null, tags: [], targetPrice: null,
      });
    });
    await expect(transactions.withTenant(scope, (transaction) => transaction.query(
        `UPDATE workspace_replica_domain_assets SET
           materialization_origin = 'provider_observation_projection', materialization_version_token = 'etag-7',
           materialized_at = '2026-08-20T05:59:59Z',
           projection_availability = 'available', projection_evidence_status = 'confirmed'
         WHERE account_id = $1 AND workspace_id = $2`,
        [scope.accountId, scope.workspaceId],
      ))).rejects.toThrow(/permission denied/iu);
    await ownerTransactions.withTenant(scope, async (transaction) => {
      await transaction.query(
        `UPDATE workspace_replica_domain_assets SET
           materialization_origin = 'provider_observation_projection', materialization_version_token = 'etag-7',
           materialized_at = '2026-08-20T05:59:59Z',
           projection_availability = 'available', projection_evidence_status = 'confirmed'
         WHERE account_id = $1 AND workspace_id = $2`,
        [scope.accountId, scope.workspaceId],
      );
    });
    await transactions.withTenant(scope, async (transaction) => {
      await transaction.query(
        `UPDATE workspace_replica_portfolio_state SET
           materialized_through_server_revision = 7, materialized_at = '2026-08-20T06:00:00Z',
           projection_availability = 'available', projection_evidence_status = 'confirmed'
         WHERE account_id = $1 AND workspace_id = $2`,
        [scope.accountId, scope.workspaceId],
      );
    });

    await expect(query.readPortfolio(scope)).resolves.toMatchObject({
      assets: [
        { asset: { entityId: "a.test", note: "observed" }, materialization: { versionToken: "etag-7" } },
        { asset: { entityId: "b.test" }, materialization: { origin: "provider_observation_projection" } },
      ],
      projection: { materializedThroughServerRevision: 7, materializedAt: "2026-08-20T06:00:00Z" },
    });
  });

  it("denies both coordinate substitutions for reads and writes while preserving a same-tenant control", async () => {
    const allowed = { accountId: "account-a", workspaceId: "workspace-shared" } as const;
    const crossAccount = { accountId: "account-b", workspaceId: allowed.workspaceId } as const;
    const crossWorkspace = { accountId: allowed.accountId, workspaceId: "workspace-other" } as const;
    for (const tenantScope of [allowed, crossAccount, crossWorkspace]) {
      await transactions.withTenant(tenantScope, async (transaction) => {
        await revisions.bind(transaction, 1);
        await portfolio.seed(transaction, {
          entityId: "same-asset.test", note: tenantScope === allowed ? "allowed" : "isolated",
          portfolioId: null, tags: [], targetPrice: null,
        });
      });
    }

    await expect(query.readPortfolio(allowed)).resolves.toMatchObject({ assets: [{ asset: { note: "allowed" } }] });
    await transactions.withTenant(allowed, async (transaction) => {
      const assetRead = await transaction.query(
        "SELECT entity_id FROM workspace_replica_domain_assets WHERE account_id = $1 AND workspace_id = $2",
        [allowed.accountId, allowed.workspaceId],
      );
      const stateRead = await transaction.query(
        "SELECT materialized_through_server_revision FROM workspace_replica_portfolio_state WHERE account_id = $1 AND workspace_id = $2",
        [allowed.accountId, allowed.workspaceId],
      );
      expect(assetRead.rows).toHaveLength(1);
      expect(stateRead.rows).toHaveLength(1);
    }, { readOnly: true, repeatableRead: true });
    for (const attacker of [crossAccount, crossWorkspace]) {
      await transactions.withTenant(attacker, async (transaction) => {
        const assetRead = await transaction.query(
          "SELECT entity_id FROM workspace_replica_domain_assets WHERE account_id = $1 AND workspace_id = $2",
          [allowed.accountId, allowed.workspaceId],
        );
        const stateRead = await transaction.query(
          "SELECT materialized_through_server_revision FROM workspace_replica_portfolio_state WHERE account_id = $1 AND workspace_id = $2",
          [allowed.accountId, allowed.workspaceId],
        );
        const assetWrite = await transaction.query(
          `UPDATE workspace_replica_domain_assets SET note = 'substituted'
           WHERE account_id = $1 AND workspace_id = $2 AND entity_id = 'same-asset.test'`,
          [allowed.accountId, allowed.workspaceId],
        );
        const stateWrite = await transaction.query(
          `UPDATE workspace_replica_portfolio_state SET materialized_through_server_revision = 99
           WHERE account_id = $1 AND workspace_id = $2`,
          [allowed.accountId, allowed.workspaceId],
        );
        expect(assetRead.rows).toHaveLength(0);
        expect(stateRead.rows).toHaveLength(0);
        expect(assetWrite.rowCount).toBe(0);
        expect(stateWrite.rowCount).toBe(0);
      });
    }
    await expect(query.readPortfolio(allowed)).resolves.toMatchObject({
      assets: [{ asset: { note: "allowed" } }], projection: { materializedThroughServerRevision: 0 },
    });
  });

  it("keeps asset and state reads on one repeatable-read snapshot", async () => {
    const scope = { accountId: "account-snapshot", workspaceId: "workspace-snapshot" } as const;
    await transactions.withTenant(scope, async (transaction) => {
      await revisions.bind(transaction, 1);
      await portfolio.seed(transaction, {
        entityId: "asset.test", note: null, portfolioId: null, tags: [], targetPrice: null,
      });
      await transaction.query(
        `UPDATE workspace_replica_portfolio_state SET materialized_through_server_revision = 1
         WHERE account_id = $1 AND workspace_id = $2`,
        [scope.accountId, scope.workspaceId],
      );
    });
    let concurrentUpdateDone = false;
    const interceptingPool = {
      async connect() {
        const client = await appPool.connect();
        return interceptClient(client, async (sql) => {
          if (!concurrentUpdateDone && sql.includes("FROM workspace_replica_domain_assets")) {
            concurrentUpdateDone = true;
            await transactions.withTenant(scope, async (transaction) => {
              await transaction.query(
                `UPDATE workspace_replica_portfolio_state SET materialized_through_server_revision = 2
                 WHERE account_id = $1 AND workspace_id = $2`,
                [scope.accountId, scope.workspaceId],
              );
            });
          }
        });
      },
    } as unknown as Pool;
    const snapshotQuery = new PostgresPortfolioProjectionQuery({
      transactions: new TenantTransactionRunner(interceptingPool), revisions,
    });

    await expect(snapshotQuery.readPortfolio(scope)).resolves.toMatchObject({ projection: { materializedThroughServerRevision: 1 } });
    await expect(query.readPortfolio(scope)).resolves.toMatchObject({ projection: { materializedThroughServerRevision: 2 } });
  });

  it("rejects writes in the read transaction and clears pooled selectors after commit and rollback", async () => {
    const scope = { accountId: "account-reuse", workspaceId: "workspace-reuse" } as const;
    await reuseTransactions.withTenant(scope, async (transaction) => revisions.bind(transaction, 1));
    const reuseQuery = new PostgresPortfolioProjectionQuery({ transactions: reuseTransactions, revisions });
    await expect(reuseQuery.readPortfolio(scope)).resolves.toMatchObject({ assets: [] });
    await expect(reuseTransactions.withTenant(scope, async (transaction) => {
      await transaction.query("UPDATE workspace_replica_portfolio_state SET materialized_through_server_revision = 2");
    }, { readOnly: true, repeatableRead: true })).rejects.toThrow();
    const residue = await reusePool.query<{ account_id: string | null; workspace_id: string | null }>(
      `SELECT nullif(current_setting('gooddealer.account_id', true), '') AS account_id,
              nullif(current_setting('gooddealer.workspace_id', true), '') AS workspace_id`,
    );
    expect(residue.rows[0]).toEqual({ account_id: null, workspace_id: null });
  });
});

function interceptClient(client: PoolClient, afterQuery: (sql: string) => Promise<void>): PoolClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return async (sql: string, values?: readonly unknown[]) => {
          const result = await target.query(sql, values === undefined ? undefined : [...values]);
          await afterQuery(sql);
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function assertConsolidatedCatalog(): void {
  expect(cloudMigrations).toHaveLength(14);
  expect([cloudMigrations[0], cloudMigrations[1], cloudMigrations[13]].map(
    (migration) => migration === undefined ? undefined : { id: migration.id, owner: migration.owner },
  )).toEqual([
    { id: "202608200001-workspace-revisions", owner: "workspace/revisions" },
    { id: "202608200002-business-replica-model", owner: "workspace/state/portfolio" },
    { id: "202608200014-account-default-workspace", owner: "workspace/default-workspace" },
  ]);
}

async function relationRlsFlags(
  schema: string,
  relation: string,
): Promise<{ readonly relrowsecurity: boolean; readonly relforcerowsecurity: boolean }> {
  const result = await ownerPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`,
    [`${schema}.${relation}`],
  );
  const flags = result.rows[0];
  if (flags === undefined) throw new Error(`${schema}.${relation} is unexpectedly absent`);
  return flags;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
