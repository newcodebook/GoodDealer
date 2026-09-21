import { createHash, randomBytes } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  IdentityCapabilityTransactionRunner,
  runCloudMigrations,
  type IdentityTransactionCapabilityPurpose,
} from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { clearLicensingTestData } from "../support/postgres-fixture";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const accountPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_ACCOUNT_API_URL"), max: 2 });
const issuerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL"), max: 1 });
const runner = new IdentityCapabilityTransactionRunner(accountPool, issuerPool);
const credential = "opaque-account-session-credential-a";

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await clearLicensingTestData(ownerPool);
  await ownerPool.query("TRUNCATE identity_private.account_transaction_capabilities");
  // Do not use cross-domain CASCADE here: Licensing deliberately owns its private
  // dependants and the ordinary migrator has no maintenance authority over them.
  await ownerPool.query("DELETE FROM identity_credential_jtis");
  await ownerPool.query("DELETE FROM identity_refresh_families");
  await ownerPool.query("DELETE FROM identity_auth_sessions");
  await ownerPool.query("DELETE FROM identity_account_security_states");
  await ownerPool.query("DELETE FROM workspace_account_bindings");
  await ownerPool.query("DELETE FROM workspace_workspaces");
  await ownerPool.query("DELETE FROM identity_accounts");
  await seed("account-a", credential);
  await seed("account-b", "opaque-account-session-credential-b");
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), accountPool.end(), issuerPool.end()]);
});

describe("PostgreSQL Identity transaction capability", () => {
  it("keeps all four runtime login roles unprivileged and membership-isolated", async () => {
    const roles = await ownerPool.query<{
      name: string;
      login: boolean;
      superuser: boolean;
      bypassRls: boolean;
      createRole: boolean;
      createDb: boolean;
      replication: boolean;
    }>(`
      SELECT rolname AS name, rolcanlogin AS login, rolsuper AS superuser,
             rolbypassrls AS "bypassRls", rolcreaterole AS "createRole",
             rolcreatedb AS "createDb", rolreplication AS replication
        FROM pg_roles
       WHERE rolname IN (
         'gd_identity_capability_issuer', 'gd_account_api',
         'gd_provider_ingress', 'gd_provider_worker'
       )
       ORDER BY rolname`);
    expect(roles.rows).toEqual([
      { name: "gd_account_api", login: true, superuser: false, bypassRls: false, createRole: false, createDb: false, replication: false },
      { name: "gd_identity_capability_issuer", login: true, superuser: false, bypassRls: false, createRole: false, createDb: false, replication: false },
      { name: "gd_provider_ingress", login: true, superuser: false, bypassRls: false, createRole: false, createDb: false, replication: false },
      { name: "gd_provider_worker", login: true, superuser: false, bypassRls: false, createRole: false, createDb: false, replication: false },
    ]);

    const memberships = await ownerPool.query(`
      SELECT member_role.rolname AS member, granted_role.rolname AS role
        FROM pg_auth_members AS membership
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       WHERE member_role.rolname IN (
         'gd_identity_capability_issuer', 'gd_account_api',
         'gd_provider_ingress', 'gd_provider_worker'
       ) OR granted_role.rolname IN (
         'gd_identity_capability_issuer', 'gd_account_api',
         'gd_provider_ingress', 'gd_provider_worker'
       )`);
    expect(memberships.rows).toEqual([]);
  });

  it("runs the full catalog as the ordinary owner and leaves hardened schema ownership", async () => {
    const state = await ownerPool.query<{
      session_role: string;
      schema_owner: string;
      migrator_create_acl: boolean;
      definer_create: boolean;
      identity_database_create: boolean;
    }>(
      `SELECT session_user AS session_role,
              pg_get_userbyid(namespace.nspowner) AS schema_owner,
              EXISTS (
                SELECT 1 FROM aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
                 WHERE acl.grantee = 'gooddealer_cloud_owner'::regrole AND acl.privilege_type = 'CREATE'
              ) AS migrator_create_acl,
              has_schema_privilege('gd_identity_definer', 'identity_private', 'CREATE') AS definer_create,
              has_database_privilege('gd_identity_owner', current_database(), 'CREATE') AS identity_database_create
         FROM pg_namespace AS namespace WHERE namespace.nspname = 'identity_private'`,
    );
    expect(state.rows[0]).toEqual({
      session_role: "gooddealer_cloud_owner",
      schema_owner: "gd_identity_owner",
      migrator_create_acl: false,
      definer_create: false,
      identity_database_create: false,
    });
  });

  it("derives account authority and makes selector-only or cross-account substitution fail closed", async () => {
    await expect(runner.withAccountCredential(
      new TextEncoder().encode(credential),
      "identity_account",
      async (transaction) => {
        const same = await transaction.query<{ account_id: string }>(
          "SELECT account_id FROM identity_accounts ORDER BY account_id",
        );
        await transaction.query("SELECT set_config('gooddealer.account_id', 'account-b', true)");
        const substituted = await transaction.query("SELECT account_id FROM identity_accounts");
        return { same: same.rows, substituted: substituted.rows };
      },
    )).resolves.toEqual({ same: [{ account_id: "account-a" }], substituted: [] });

    const client = await accountPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('gooddealer.account_id', 'account-a', true)");
      for (const purpose of [undefined, "", "not-a-capability-purpose"] as const) {
        if (purpose !== undefined) {
          await client.query("SELECT set_config('gooddealer.capability_purpose', $1, true)", [purpose]);
        }
        const selectorOnly = await client.query("SELECT account_id FROM identity_accounts");
        expect(selectorOnly.rows, `purpose setting ${JSON.stringify(purpose)}`).toEqual([]);
      }
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("executes Licensing facades under exact purposes and accepts only the current refresh head", async () => {
    await expect(runner.withAccountCredential(
      new TextEncoder().encode(credential),
      "refund_request",
      async (transaction) => transaction.accountId,
    )).resolves.toBe("account-a");

    await expect(runner.withAccountCredential(
      new TextEncoder().encode(credential),
      "billing_read",
      async (transaction) => (await transaction.query("SELECT * FROM licensing_api.read_billing_status()")).rows,
    )).resolves.toEqual([]);

    await expect(runner.withAccountCredential(
      new TextEncoder().encode(credential),
      "identity_account",
      async (transaction) => (await transaction.query("SELECT * FROM licensing_api.read_entitlement_deadline()")).rows,
    )).resolves.toEqual([]);

    await expect(runner.withAccountCredential(
      new TextEncoder().encode(credential),
      "purchase_reserve",
      async (transaction) => transaction.query("SELECT * FROM licensing_api.read_billing_status()"),
    )).rejects.toMatchObject({ code: "42501" });

    const rawRefresh = Buffer.from("opaque-current-refresh-credential-account-a", "utf8");
    const refreshJti = createHash("sha256").update(rawRefresh).digest("hex");
    try {
      await ownerPool.query(
        `INSERT INTO identity_credential_jtis
           (jti, account_id, family_id, session_id, kind, state, issued_epoch, expires_at)
         VALUES ($1, 'account-a', 'family-account-a', $2, 'refresh', 'current', 1,
           transaction_timestamp() + interval '1 hour')`,
        [refreshJti, credential],
      );
      await ownerPool.query(
        "UPDATE identity_refresh_families SET current_refresh_jti = $1 WHERE account_id = 'account-a'",
        [refreshJti],
      );
      await expect(runner.withAccountCredential(
        rawRefresh,
        "identity_account",
        async (transaction) => transaction.accountId,
      )).resolves.toBe("account-a");

      await ownerPool.query(
        "UPDATE identity_refresh_families SET current_refresh_jti = 'replacement-refresh-jti' WHERE account_id = 'account-a'",
      );
      await expect(runner.withAccountCredential(
        rawRefresh,
        "identity_account",
        async (transaction) => transaction.accountId,
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      rawRefresh.fill(0);
    }
  });

  it("rejects replay after rollback because the ended xid8 cannot be reproduced", async () => {
    const account = await accountPool.connect();
    const issuer = await issuerPool.connect();
    const nonce = randomBytes(32);
    let token: Buffer | undefined;
    try {
      await account.query("BEGIN");
      const binding = (await account.query<{ pid: number; xid: string }>(
        "SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid",
      )).rows[0]!;
      await issuer.query("BEGIN");
      token = (await issuer.query<{ token: Buffer }>(
        `SELECT identity_private.issue_transaction_capability(
           $1::bytea, $2, $3::text::xid8, sha256($4::bytea), 'refund_request'
         ) AS token`,
        [Buffer.from(credential), binding.pid, binding.xid, nonce],
      )).rows[0]!.token;
      await issuer.query("COMMIT");
      await consume(account, token, nonce, "refund_request");
      await account.query("ROLLBACK");

      await account.query("BEGIN");
      await expect(consume(account, token, nonce, "refund_request"))
        .rejects.toMatchObject({ code: "42501" });
      await account.query("ROLLBACK");
    } finally {
      nonce.fill(0);
      token?.fill(0);
      account.release();
      issuer.release();
    }
  });

  it("rejects a refund capability when its Identity session becomes stale before consumption", async () => {
    const account = await accountPool.connect();
    const issuer = await issuerPool.connect();
    const nonce = randomBytes(32);
    let token: Buffer | undefined;
    try {
      await account.query("BEGIN");
      const binding = (await account.query<{ pid: number; xid: string }>(
        "SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid",
      )).rows[0]!;
      await issuer.query("BEGIN");
      token = (await issuer.query<{ token: Buffer }>(
        `SELECT identity_private.issue_transaction_capability(
           $1::bytea, $2, $3::text::xid8, sha256($4::bytea), 'refund_request'
         ) AS token`,
        [Buffer.from(credential), binding.pid, binding.xid, nonce],
      )).rows[0]!.token;
      await issuer.query("COMMIT");
      await ownerPool.query(
        "UPDATE identity_auth_sessions SET revoked_at = transaction_timestamp() WHERE session_id = $1",
        [credential],
      );
      await expect(consume(account, token, nonce, "refund_request"))
        .rejects.toMatchObject({ code: "42501" });
      await account.query("ROLLBACK");
    } finally {
      await account.query("ROLLBACK").catch(() => undefined);
      await issuer.query("ROLLBACK").catch(() => undefined);
      nonce.fill(0);
      token?.fill(0);
      account.release();
      issuer.release();
    }
  });

  it("rejects wrong purpose, nonce, backend PID, and xid8 before account authority exists", async () => {
    const probes: readonly {
      readonly name: string;
      readonly issuePurpose: "refund_request" | "billing_read" | "purchase_reserve" | "cancellation_request";
      readonly consumePurpose: "billing_approval_redirect" | "billing_read" | "purchase_reserve" | "cancellation_request";
      readonly wrongNonce?: true;
      readonly wrongPid?: true;
      readonly wrongXid?: true;
    }[] = [
      { name: "purpose", issuePurpose: "refund_request", consumePurpose: "cancellation_request" },
      { name: "nonce", issuePurpose: "billing_read", consumePurpose: "billing_read", wrongNonce: true },
      { name: "pid", issuePurpose: "purchase_reserve", consumePurpose: "purchase_reserve", wrongPid: true },
      { name: "xid", issuePurpose: "cancellation_request", consumePurpose: "cancellation_request", wrongXid: true },
    ];
    for (const probe of probes) {
      const account = await accountPool.connect();
      const issuer = await issuerPool.connect();
      const nonce = randomBytes(32);
      const consumedNonce = probe.wrongNonce ? randomBytes(32) : nonce;
      let token: Buffer | undefined;
      try {
        await account.query("BEGIN");
        const binding = (await account.query<{ pid: number; xid: string }>(
          "SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid",
        )).rows[0]!;
        const targetPid = probe.wrongPid ? binding.pid + 1 : binding.pid;
        const targetXid = probe.wrongXid ? (BigInt(binding.xid) + 1n).toString() : binding.xid;
        await issuer.query("BEGIN");
        token = (await issuer.query<{ token: Buffer }>(
          `SELECT identity_private.issue_transaction_capability(
             $1::bytea, $2, $3::text::xid8, sha256($4::bytea),
             $5::identity_private.transaction_capability_purpose
           ) AS token`,
          [Buffer.from(credential), targetPid, targetXid, nonce, probe.issuePurpose],
        )).rows[0]!.token;
        await issuer.query("COMMIT");
        await expect(account.query(
          `SELECT identity_private.consume_transaction_capability(
             $1, $2, $3::identity_private.transaction_capability_purpose
           )`,
          [token, consumedNonce, probe.consumePurpose],
        ), probe.name).rejects.toMatchObject({ code: "42501" });
        await account.query("ROLLBACK");
      } finally {
        await account.query("ROLLBACK").catch(() => undefined);
        await issuer.query("ROLLBACK").catch(() => undefined);
        nonce.fill(0);
        if (consumedNonce !== nonce) consumedNonce.fill(0);
        token?.fill(0);
        account.release();
        issuer.release();
      }
    }
  });

  it("proves the account role cannot mint or mutate capability state", async () => {
    const catalog = await ownerPool.query<{
      account_table_dml: boolean;
      account_issue: boolean;
      account_consume: boolean;
      account_typed_current: boolean;
      account_selected_current: boolean;
      licensing_typed_current: boolean;
      app_entitlement_access: boolean;
      account_entitlement_access: boolean;
      ingress_identity_access: boolean;
      worker_identity_access: boolean;
      app_identity_access: boolean;
      public_purpose_type: boolean;
      public_issue: boolean;
      maintenance_truncate: boolean;
    }>(
      `SELECT
         has_table_privilege('gd_account_api', 'identity_private.account_transaction_capabilities',
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS account_table_dml,
         has_function_privilege('gd_account_api',
           'identity_private.issue_transaction_capability(bytea,integer,xid8,bytea,identity_private.transaction_capability_purpose)',
           'EXECUTE') AS account_issue,
         has_function_privilege('gd_account_api',
           'identity_private.consume_transaction_capability(bytea,bytea,identity_private.transaction_capability_purpose)',
           'EXECUTE') AS account_consume,
         has_function_privilege('gd_account_api',
           'identity_private.current_transaction_account(identity_private.transaction_capability_purpose)',
           'EXECUTE') AS account_typed_current,
         has_function_privilege('gd_account_api',
           'identity_private.current_transaction_account()', 'EXECUTE') AS account_selected_current,
         has_function_privilege('gd_licensing_command_definer',
           'identity_private.current_transaction_account(identity_private.transaction_capability_purpose)',
           'EXECUTE') AS licensing_typed_current,
         has_schema_privilege('gooddealer_cloud_app', 'licensing_api', 'USAGE') AND
         (SELECT has_function_privilege('gooddealer_cloud_app', procedure.oid, 'EXECUTE')
            FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
           WHERE namespace.nspname = 'licensing_api' AND procedure.proname = 'read_entitlement_deadline')
           AS app_entitlement_access,
         has_schema_privilege('gd_account_api', 'licensing_api', 'USAGE') AND
         (SELECT has_function_privilege('gd_account_api', procedure.oid, 'EXECUTE')
            FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
           WHERE namespace.nspname = 'licensing_api' AND procedure.proname = 'read_entitlement_deadline')
           AS account_entitlement_access,
         has_schema_privilege('gd_provider_ingress', 'identity_private', 'USAGE')
           OR has_function_privilege('gd_provider_ingress',
             'identity_private.current_transaction_account(identity_private.transaction_capability_purpose)',
             'EXECUTE') AS ingress_identity_access,
         has_schema_privilege('gd_provider_worker', 'identity_private', 'USAGE')
           OR has_function_privilege('gd_provider_worker',
             'identity_private.current_transaction_account(identity_private.transaction_capability_purpose)',
             'EXECUTE') AS worker_identity_access,
         has_schema_privilege('gooddealer_cloud_app', 'identity_private', 'USAGE')
           OR has_function_privilege('gooddealer_cloud_app',
             'identity_private.consume_transaction_capability(bytea,bytea,identity_private.transaction_capability_purpose)',
             'EXECUTE') AS app_identity_access,
         EXISTS (
           SELECT 1
             FROM pg_type AS purpose_type,
                  LATERAL aclexplode(coalesce(purpose_type.typacl, acldefault('T', purpose_type.typowner))) AS privilege
            WHERE purpose_type.oid = 'identity_private.transaction_capability_purpose'::regtype
              AND privilege.grantee = 0 AND privilege.privilege_type = 'USAGE'
         ) AS public_purpose_type,
         has_table_privilege('gooddealer_cloud_owner',
           'identity_private.account_transaction_capabilities', 'TRUNCATE') AS maintenance_truncate,
         EXISTS (
           SELECT 1
             FROM pg_proc AS procedure,
                  LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
            WHERE procedure.oid =
              'identity_private.issue_transaction_capability(bytea,integer,xid8,bytea,identity_private.transaction_capability_purpose)'::regprocedure
              AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
         ) AS public_issue`,
    );
    expect(catalog.rows[0]).toEqual({
      account_table_dml: false,
      account_issue: false,
      account_consume: true,
      account_typed_current: false,
      account_selected_current: true,
      licensing_typed_current: true,
      app_entitlement_access: false,
      account_entitlement_access: true,
      ingress_identity_access: false,
      worker_identity_access: false,
      app_identity_access: false,
      public_purpose_type: false,
      public_issue: false,
      maintenance_truncate: true,
    });
  });
});

async function consume(
  client: PoolClient,
  token: Buffer,
  nonce: Buffer,
  purpose: IdentityTransactionCapabilityPurpose = "identity_account",
): Promise<void> {
  await client.query(
    `SELECT identity_private.consume_transaction_capability(
       $1, $2, $3::identity_private.transaction_capability_purpose
     )`,
    [token, nonce, purpose],
  );
}

async function seed(accountId: string, sessionCredential: string): Promise<void> {
  await ownerPool.query(
    `INSERT INTO identity_accounts
       (account_id, email_normalized, password_policy_id, password_hash_phc)
     VALUES ($1, $2, 'argon2id-v1', repeat('x', 80))`,
    [accountId, `${accountId}@example.invalid`],
  );
  await ownerPool.query("INSERT INTO identity_account_security_states (account_id) VALUES ($1)", [accountId]);
  await ownerPool.query(
    `INSERT INTO identity_auth_sessions
       (account_id, session_id, client_kind, auth_method, remember_device, epoch_at_issue, expires_at)
     VALUES ($1, $2, 'account_web', 'password', true, 1, transaction_timestamp() + interval '1 hour')`,
    [accountId, sessionCredential],
  );
  await ownerPool.query(
    `INSERT INTO identity_refresh_families (account_id, family_id, session_id, current_refresh_jti)
     VALUES ($1, $2, $3, $4)`,
    [accountId, `family-${accountId}`, sessionCredential, `refresh-${accountId}`],
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}
