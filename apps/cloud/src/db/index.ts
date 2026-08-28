import { createHash } from "node:crypto";

import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

import {
  parseWorkspaceTenantScope,
  type WorkspaceTenantScope,
} from "../modules/workspace/tenant-scope";

export const databaseInfrastructure = "pool-transaction-migration-runner-only" as const;

export interface DatabaseQuery {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface TenantTransaction extends DatabaseQuery {
  readonly scope: WorkspaceTenantScope;
}

export interface AccountTransaction extends DatabaseQuery {
  readonly accountId: string;
}

export interface PreAuthEmailTransaction extends DatabaseQuery {
  readonly emailNormalized: string;
}

export interface CloudMigration {
  readonly id: string;
  readonly owner: string;
  readonly sql: string;
}

export interface CatalogMigration extends CloudMigration {
  readonly checksum: string;
}

const MIGRATION_ID = /^\d{12}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MIGRATION_LOCK_KEY = 3_738_629_241;

export function createCloudDatabasePool(config: PoolConfig): Pool {
  return new Pool(config);
}

/**
 * Owns the only ordinary application transaction entrypoint. PostgreSQL transaction-local
 * settings make a pooled connection fail closed both before scope setup and after release.
 */
export class TenantTransactionRunner {
  constructor(private readonly pool: Pool) {}

  async withTenant<Result>(
    value: unknown,
    operation: (transaction: TenantTransaction) => Promise<Result>,
    options: { readonly readOnly?: boolean; readonly repeatableRead?: boolean } = {},
  ): Promise<Result> {
    const scope = parseWorkspaceTenantScope(value);
    if (scope === null) throw new TypeError("workspace tenant scope is unresolved");

    const client = await this.pool.connect();
    let open = false;
    let released = false;
    try {
      await client.query("BEGIN");
      open = true;
      if (options.repeatableRead === true) {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      }
      if (options.readOnly === true) await client.query("SET TRANSACTION READ ONLY");
      await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [scope.accountId]);
      await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);

      const result = await operation(scopedTransaction(client, scope));
      await client.query("COMMIT");
      open = false;
      return result;
    } catch (error) {
      if (open) {
        try {
          await client.query("ROLLBACK");
        } catch {
          client.release(error instanceof Error ? error : new Error("tenant transaction rollback failed"));
          released = true;
          throw error;
        }
      }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }
}

/** Identity account scope is distinct from workspace tenant scope. */
export class AccountTransactionRunner {
  constructor(private readonly pool: Pool) {}

  async withAccount<Result>(
    accountId: unknown,
    operation: (transaction: AccountTransaction) => Promise<Result>,
  ): Promise<Result> {
    const parsed = parseSelector(accountId, "account id", 160);
    return withScopedClient(this.pool, "gooddealer.account_id", parsed, (client) =>
      operation({ accountId: parsed, query: queryWith(client) }));
  }
}

/** Login-only exact selector. It grants no general account scope or scan capability. */
export class PreAuthEmailTransactionRunner {
  constructor(private readonly pool: Pool) {}

  async withExactEmail<Result>(
    emailNormalized: unknown,
    operation: (transaction: PreAuthEmailTransaction) => Promise<Result>,
  ): Promise<Result> {
    const parsed = parseExactEmailSelector(emailNormalized);
    return withScopedClient(this.pool, "gooddealer.login_email", parsed, (client) =>
      operation({ emailNormalized: parsed, query: queryWith(client) }));
  }
}

export function buildMigrationCatalog(migrations: readonly CloudMigration[]): readonly CatalogMigration[] {
  let previous = "";
  const seen = new Set<string>();
  return migrations.map((migration) => {
    if (!MIGRATION_ID.test(migration.id)) throw new TypeError(`invalid migration id: ${migration.id}`);
    if (seen.has(migration.id)) throw new TypeError(`duplicate migration id: ${migration.id}`);
    if (migration.id <= previous) throw new TypeError("migration catalog is not globally increasing");
    if (migration.owner.length === 0 || migration.sql.trim().length === 0) {
      throw new TypeError(`migration ${migration.id} is incomplete`);
    }
    previous = migration.id;
    seen.add(migration.id);
    return { ...migration, checksum: createHash("sha256").update(migration.sql, "utf8").digest("hex") };
  });
}

export async function runCloudMigrations(
  pool: Pool,
  migrations: readonly CloudMigration[],
): Promise<readonly CatalogMigration[]> {
  const catalog = buildMigrationCatalog(migrations);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS gooddealer_cloud_migrations (
        id text PRIMARY KEY,
        owner_module text NOT NULL,
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
      )
    `);
    const applied = await client.query<{ id: string; owner_module: string; checksum: string }>(
      "SELECT id, owner_module, checksum FROM gooddealer_cloud_migrations ORDER BY id COLLATE \"C\"",
    );
    if (applied.rows.length > catalog.length) throw new TypeError("database has unknown applied migrations");
    for (const [index, row] of applied.rows.entries()) {
      const expected = catalog[index];
      if (expected === undefined || row.id !== expected.id) {
        throw new TypeError("applied migrations are not a catalog prefix");
      }
      if (row.checksum !== expected.checksum || row.owner_module !== expected.owner) {
        throw new TypeError(`migration metadata drift: ${row.id}`);
      }
    }
    for (const migration of catalog.slice(applied.rows.length)) {
      await applyMigration(client, migration);
    }
    return catalog;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

function scopedTransaction(client: PoolClient, scope: WorkspaceTenantScope): TenantTransaction {
  return {
    scope,
    query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
  };
}

function queryWith(client: PoolClient): DatabaseQuery["query"] {
  return (text, values) => client.query(text, values === undefined ? undefined : [...values]);
}

async function withScopedClient<Result>(
  pool: Pool,
  setting: "gooddealer.account_id" | "gooddealer.login_email",
  value: string,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  let open = false;
  let released = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SELECT set_config($1, $2, true)", [setting, value]);
    const result = await operation(client);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) {
      try {
        await client.query("ROLLBACK");
      } catch {
        client.release(error instanceof Error ? error : new Error("scoped transaction rollback failed"));
        released = true;
        throw error;
      }
    }
    throw error;
  } finally {
    if (!released) client.release();
  }
}

function parseSelector(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength || !/^[!-~]+$/u.test(value)) {
    throw new TypeError(`${label} is unresolved`);
  }
  return value;
}

function parseExactEmailSelector(value: unknown): string {
  if (
    typeof value !== "string" || value.length < 3 || new TextEncoder().encode(value).length > 320 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new TypeError("normalized email is unresolved");
  return value;
}

async function applyMigration(client: PoolClient, migration: CatalogMigration): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(
      "INSERT INTO gooddealer_cloud_migrations (id, owner_module, checksum) VALUES ($1, $2, $3)",
      [migration.id, migration.owner, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
