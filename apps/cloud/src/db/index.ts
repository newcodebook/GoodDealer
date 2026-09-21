import { createHash, randomBytes } from "node:crypto";

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

export const identityTransactionCapabilityPurposes = [
  "identity_account",
  "devices_account",
  "workspace_tenant",
  "billing_read",
  "purchase_reserve",
  "cancellation_request",
  "refund_request",
  "fixed_term_capture",
  "billing_approval_redirect",
] as const;

export type IdentityTransactionCapabilityPurpose =
  typeof identityTransactionCapabilityPurposes[number];

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

export interface CloudCapabilityDatabasePoolConfigs {
  readonly identityCapabilityIssuer: PoolConfig;
  readonly accountApi: PoolConfig;
  readonly providerIngress: PoolConfig;
  readonly providerWorker: PoolConfig;
}

export interface CloudCapabilityDatabasePools {
  readonly identityCapabilityIssuer: Pool;
  readonly accountApi: Pool;
  readonly providerIngress: Pool;
  readonly providerWorker: Pool;
}

/**
 * Materializes each runtime trust domain as a distinct pool. Provider code receives only its
 * dedicated role pool; in particular, the worker surface has no account-selector runner.
 */
export function createCloudCapabilityDatabasePools(
  configs: CloudCapabilityDatabasePoolConfigs,
): CloudCapabilityDatabasePools {
  return Object.freeze({
    identityCapabilityIssuer: createCloudDatabasePool(configs.identityCapabilityIssuer),
    accountApi: createCloudDatabasePool(configs.accountApi),
    providerIngress: createCloudDatabasePool(configs.providerIngress),
    providerWorker: createCloudDatabasePool(configs.providerWorker),
  });
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

/**
 * Runs authenticated account work using authority derived by Identity from possession of an
 * opaque credential. Issuance commits independently so rollback of the target transaction cannot
 * make its PID/XID-bound token reusable.
 */
export class IdentityCapabilityTransactionRunner {
  constructor(
    private readonly accountPool: Pool,
    private readonly issuerPool: Pool,
  ) {}

  async withAccountCredential<Result>(
    rawOpaqueSessionCredential: Uint8Array,
    purpose: IdentityTransactionCapabilityPurpose,
    operation: (transaction: AccountTransaction) => Promise<Result>,
  ): Promise<Result> {
    return this.withCredential(rawOpaqueSessionCredential, purpose, undefined, operation);
  }

  async withTenantCredential<Result>(
    rawOpaqueSessionCredential: Uint8Array,
    workspaceId: unknown,
    purpose: IdentityTransactionCapabilityPurpose,
    operation: (transaction: TenantTransaction) => Promise<Result>,
    options: { readonly readOnly?: boolean } = {},
  ): Promise<Result> {
    const parsedWorkspaceId = parseSelector(workspaceId, "workspace id", 160);
    return this.withCredential(
      rawOpaqueSessionCredential,
      purpose,
      { workspaceId: parsedWorkspaceId, readOnly: options.readOnly === true },
      operation,
    );
  }

  private async withCredential<Result>(
    rawCredential: Uint8Array,
    purpose: IdentityTransactionCapabilityPurpose,
    tenant: { readonly workspaceId: string; readonly readOnly: boolean } | undefined,
    operation: ((transaction: AccountTransaction) => Promise<Result>)
      | ((transaction: TenantTransaction) => Promise<Result>),
  ): Promise<Result> {
    const credential = copySecret(rawCredential, "opaque session credential", 16, 4_096);
    if (!identityTransactionCapabilityPurposes.includes(purpose)) {
      credential.fill(0);
      throw new TypeError("transaction capability purpose is invalid");
    }
    const nonce = randomBytes(32);
    const nonceDigest = createHash("sha256").update(nonce).digest();
    const client = await this.accountPool.connect();
    let open = false;
    let released = false;
    let token: Buffer | undefined;
    try {
      await assertCleanCheckout(client);
      await client.query("BEGIN");
      open = true;
      const target = await client.query<{ pid: number; xid: string }>(
        "SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid",
      );
      const binding = target.rows[0];
      if (binding === undefined || !Number.isSafeInteger(binding.pid) || !/^\d+$/u.test(binding.xid)) {
        throw new Error("database transaction binding is unavailable");
      }
      token = await this.issueCapability(
        credential,
        binding.pid,
        binding.xid,
        nonceDigest,
        purpose,
      );
      await client.query(
        `SELECT identity_private.consume_transaction_capability(
           $1::bytea, $2::bytea, $3::identity_private.transaction_capability_purpose
         )`,
        [token, nonce, purpose],
      );
      const context = await client.query<{ account_id: string | null }>(
        "SELECT identity_private.current_transaction_account() AS account_id",
      );
      const accountId = parseSelector(context.rows[0]?.account_id, "derived account id", 160);
      let transaction: AccountTransaction | TenantTransaction;
      if (tenant === undefined) {
        transaction = { accountId, query: queryWith(client) };
      } else {
        if (tenant.readOnly) await client.query("SET TRANSACTION READ ONLY");
        await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [tenant.workspaceId]);
        transaction = scopedTransaction(client, { accountId, workspaceId: tenant.workspaceId });
      }
      const result = await operation(transaction as AccountTransaction & TenantTransaction);
      await client.query("COMMIT");
      open = false;
      await cleanAndAssertClient(client, false);
      return result;
    } catch (error) {
      if (open) {
        try {
          await client.query("ROLLBACK");
          open = false;
        } catch (rollbackError) {
          client.release(toError(rollbackError, "capability transaction rollback failed"));
          released = true;
          throw error;
        }
      }
      if (!released) {
        try {
          await cleanAndAssertClient(client, true);
        } catch (cleanupError) {
          client.release(toError(cleanupError, "capability transaction cleanup failed"));
          released = true;
        }
      }
      throw error;
    } finally {
      credential.fill(0);
      nonce.fill(0);
      nonceDigest.fill(0);
      token?.fill(0);
      if (!released) client.release();
    }
  }

  private async issueCapability(
    credential: Buffer,
    targetBackendPid: number,
    targetTransactionId: string,
    nonceDigest: Buffer,
    purpose: IdentityTransactionCapabilityPurpose,
  ): Promise<Buffer> {
    const issuer = await this.issuerPool.connect();
    let open = false;
    let released = false;
    let token: Buffer | undefined;
    try {
      await assertCleanCheckout(issuer);
      await issuer.query("BEGIN");
      open = true;
      const issued = await issuer.query<{ token: Buffer }>(
        `SELECT identity_private.issue_transaction_capability(
           $1::bytea, $2::integer, $3::text::xid8, $4::bytea,
           $5::identity_private.transaction_capability_purpose
         ) AS token`,
        [credential, targetBackendPid, targetTransactionId, nonceDigest, purpose],
      );
      const returned = issued.rows[0]?.token;
      if (!Buffer.isBuffer(returned) || returned.length !== 32) {
        throw new Error("identity capability issuance failed");
      }
      token = Buffer.from(returned);
      returned.fill(0);
      await issuer.query("COMMIT");
      open = false;
      await cleanAndAssertClient(issuer, false);
      return token;
    } catch (error) {
      if (open) {
        try {
          await issuer.query("ROLLBACK");
          open = false;
        } catch (rollbackError) {
          issuer.release(toError(rollbackError, "identity issuer rollback failed"));
          released = true;
        }
      }
      if (!released) {
        try {
          await cleanAndAssertClient(issuer, true);
        } catch (cleanupError) {
          issuer.release(toError(cleanupError, "identity issuer cleanup failed"));
          released = true;
        }
      }
      token?.fill(0);
      throw error;
    } finally {
      if (!released) issuer.release();
    }
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

function copySecret(
  value: Uint8Array,
  label: string,
  minimumLength: number,
  maximumLength: number,
): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < minimumLength || value.byteLength > maximumLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return Buffer.from(value);
}

async function assertCleanCheckout(client: PoolClient): Promise<void> {
  const result = await client.query<{
    account_id: string | null;
    workspace_id: string | null;
    capability_purpose: string | null;
    role_clean: boolean;
  }>(
    `SELECT nullif(current_setting('gooddealer.account_id', true), '') AS account_id,
            nullif(current_setting('gooddealer.workspace_id', true), '') AS workspace_id,
            nullif(current_setting('gooddealer.capability_purpose', true), '') AS capability_purpose,
            current_user = session_user AS role_clean`,
  );
  const row = result.rows[0];
  if (row === undefined || row.account_id !== null || row.workspace_id !== null
      || row.capability_purpose !== null || !row.role_clean) {
    throw new Error("database client checkout state is not clean");
  }
}

async function cleanAndAssertClient(client: PoolClient, discard: boolean): Promise<void> {
  await client.query("RESET ROLE");
  await client.query(discard ? "DISCARD ALL" : "RESET ALL");
  await assertCleanCheckout(client);
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
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
