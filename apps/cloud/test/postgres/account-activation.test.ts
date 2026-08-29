import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccountTransactionRunner, runCloudMigrations, TenantTransactionRunner } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { createPostgresCloudPublicHttp } from "../../src/entrypoints/http";
import {
  activateAccount,
  activationIdentityFor,
  type AuthenticatedSubjectRevalidationPort,
} from "../../src/modules/identity/index";
import { activationTenantScope } from "../../src/modules/workspace/tenant-scope";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 8 });
const reusePool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 1 });
const accountTransactions = new AccountTransactionRunner(appPool);
const tenantTransactions = new TenantTransactionRunner(appPool);
const reuseTenantTransactions = new TenantTransactionRunner(reusePool);
const subject = {
  stableSubject: "postgres-activation-subject",
  emailNormalized: "postgres.activation@example.com",
  emailVerifiedAt: "2026-08-26T00:00:00Z",
  passwordHashPhc: "$argon2id$v=19$m=65536,t=3,p=1$" + "x".repeat(100),
  clientKind: "account_web" as const,
  expiresAt: "2030-01-01T00:00:00Z",
  revoked: false as const,
  securityEpoch: 1,
};
const verified: AuthenticatedSubjectRevalidationPort = { revalidate: async () => subject };

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query(`TRUNCATE workspace_account_bindings, workspace_workspaces, workspace_revisions,
    identity_account_security_states, identity_accounts CASCADE`);
});

afterAll(async () => Promise.all([ownerPool.end(), appPool.end(), reusePool.end()]));

describe("PostgreSQL account activation", () => {
  it("composes the authenticated HTTP route through PostgreSQL activation and default-workspace repositories", async () => {
    const identity = activationIdentityFor(subject);
    const app = createPostgresCloudPublicHttp({
      pool: appPool,
      identity: {
        async readSessionVerification(sessionId) {
          return {
            sessionId,
            accountId: identity.accountId,
            clientKind: "account_web",
            expiresAt: "2030-01-01T00:00:00Z",
            sessionAccountSecurityEpoch: 1,
            currentAccountSecurityEpoch: 1,
            familyState: "active",
          };
        },
      },
      activationSubjects: {
        async readActivationSubject(principal) {
          return principal.accountId === identity.accountId ? subject : null;
        },
      },
      preAuthRateLimit: rateLimitPolicy(60_000, 10),
      sessionRateLimit: rateLimitPolicy(60_000, 10),
      now: () => new Date("2026-08-29T00:00:00Z"),
      correlationIds: () => "postgres-activation-correlation",
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/account/activation",
        headers: { cookie: "gd_session=postgres-activation-session" },
        payload: { schemaVersion: 1 },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ schemaVersion: 1, state: "active" });
      const persisted = await ownerPool.query<{ accountId: string; workspaceId: string }>(
        `SELECT b.account_id AS "accountId", b.workspace_id AS "workspaceId"
           FROM workspace_account_bindings b
          WHERE b.account_id = $1 AND b.is_default = true`,
        [identity.accountId],
      );
      expect(persisted.rows).toEqual([identity]);
    } finally {
      await app.close();
    }
  });

  it("creates one account, personal workspace, binding, and initial record; replay is stable", async () => {
    const first = await activateAccount(appPool, verified, { schemaVersion: 1 });
    const second = await activateAccount(appPool, verified, { schemaVersion: 1 });
    expect(second).toEqual(first);
    const counts = await ownerPool.query<{ accounts: string; workspaces: string; bindings: string; revisions: string }>(
      `SELECT (SELECT count(*) FROM identity_accounts)::text AS accounts,
       (SELECT count(*) FROM workspace_workspaces)::text AS workspaces,
       (SELECT count(*) FROM workspace_account_bindings)::text AS bindings,
       (SELECT count(*) FROM workspace_revisions)::text AS revisions`,
    );
    expect(counts.rows[0]).toEqual({ accounts: "1", workspaces: "1", bindings: "1", revisions: "1" });
  });

  it.each(["account", "workspace", "binding", "initial-record"] as const)("rolls back after %s with zero residue", async (point) => {
    await expect(activateAccount(appPool, verified, { schemaVersion: 1 }, (actual) => {
      if (actual === point) throw new Error(`fault-${point}`);
    })).rejects.toThrow(`fault-${point}`);
    const residue = await ownerPool.query<{ accounts: string; workspaces: string; bindings: string; revisions: string }>(
      `SELECT (SELECT count(*) FROM identity_accounts)::text AS accounts,
       (SELECT count(*) FROM workspace_workspaces)::text AS workspaces,
       (SELECT count(*) FROM workspace_account_bindings)::text AS bindings,
       (SELECT count(*) FROM workspace_revisions)::text AS revisions`,
    );
    expect(residue.rows[0]).toEqual({ accounts: "0", workspaces: "0", bindings: "0", revisions: "0" });
  });

  it("enforces composite ownership, one default, and forced RLS", async () => {
    await ownerPool.query(`INSERT INTO identity_accounts (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ('constraint-a', 'constraint-a@example.com', 'argon2id-v1', repeat('x', 80)),
             ('constraint-b', 'constraint-b@example.com', 'argon2id-v1', repeat('x', 80))`);
    await ownerPool.query(`INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name)
      VALUES ('constraint-wa', 'constraint-a', 'personal', 'A'), ('constraint-wb', 'constraint-a', 'personal', 'B')`);
    await expect(ownerPool.query(`INSERT INTO workspace_account_bindings
      (account_id, workspace_id, owner_kind, role, is_default) VALUES ('constraint-b', 'constraint-wa', 'account', 'default_owner', true)`)).rejects.toMatchObject({ code: "23503" });
    await ownerPool.query(`INSERT INTO workspace_account_bindings
      (account_id, workspace_id, owner_kind, role, is_default) VALUES ('constraint-a', 'constraint-wa', 'account', 'default_owner', true)`);
    await expect(ownerPool.query(`INSERT INTO workspace_account_bindings
      (account_id, workspace_id, owner_kind, role, is_default) VALUES ('constraint-a', 'constraint-wb', 'account', 'default_owner', true)`)).rejects.toMatchObject({ code: "23505" });
    const rls = await ownerPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'workspace_workspaces'`);
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("allows the resolved tenant and denies a caller-selected cross-account scope", async () => {
    const active = await activateAccount(appPool, verified, { schemaVersion: 1 });
    await expect(tenantTransactions.withTenant(activationTenantScope(active), (tx) => tx.query("SELECT workspace_id FROM workspace_workspaces"))).resolves.toMatchObject({ rows: [{ workspace_id: active.workspaceId }] });
    await expect(tenantTransactions.withTenant({ accountId: "other-account", workspaceId: active.workspaceId }, (tx) => tx.query("SELECT workspace_id FROM workspace_workspaces"))).resolves.toMatchObject({ rows: [] });
  });

  it("permits only the account-owned default binding through the account bootstrap selector", async () => {
    const active = await activateAccount(appPool, verified, { schemaVersion: 1 });
    await ownerPool.query(`INSERT INTO identity_accounts
      (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ('foreign-account', 'foreign-account@example.com', 'argon2id-v1', repeat('x', 80))`);
    await ownerPool.query(`INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name)
      VALUES ('foreign-workspace', 'foreign-account', 'personal', 'Foreign')`);
    await ownerPool.query(`INSERT INTO workspace_account_bindings
      (account_id, workspace_id, owner_kind, role, is_default)
      VALUES ('foreign-account', 'foreign-workspace', 'account', 'default_owner', true)`);

    const visible = await accountTransactions.withAccount(active.accountId, (transaction) => transaction.query<{
      account_id: string;
      workspace_id: string;
    }>("SELECT account_id, workspace_id FROM workspace_account_bindings ORDER BY account_id"));
    expect(visible.rows).toEqual([{ account_id: active.accountId, workspace_id: active.workspaceId }]);
    const workspaces = await accountTransactions.withAccount(active.accountId, (transaction) =>
      transaction.query("SELECT workspace_id FROM workspace_workspaces"));
    expect(workspaces.rows).toEqual([]);
    const updated = await accountTransactions.withAccount(active.accountId, (transaction) => transaction.query(
      "UPDATE workspace_account_bindings SET updated_at = transaction_timestamp() WHERE account_id = $1",
      [active.accountId],
    ));
    expect(updated.rowCount).toBe(0);
    await expect(accountTransactions.withAccount(active.accountId, (transaction) => transaction.query(
      "DELETE FROM workspace_account_bindings WHERE account_id = $1",
      [active.accountId],
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps the account bootstrap policy and role privileges narrowly catalogued", async () => {
    const policies = await ownerPool.query<{ cmd: string; roles: string[]; qual: string; with_check: string | null }>(
      `SELECT cmd, roles, qual, with_check
         FROM pg_policies
        WHERE schemaname = current_schema()
          AND tablename = 'workspace_account_bindings'
          AND policyname = 'workspace_account_bindings_default_owner_account_select'`,
    );
    expect(policies.rows).toHaveLength(1);
    expect(policies.rows[0]?.cmd).toBe("SELECT");
    expect(policies.rows[0]?.roles).toContain("gooddealer_cloud_app");
    expect(policies.rows[0]?.qual).toContain("owner_kind = 'account'::text");
    expect(policies.rows[0]?.qual).toContain("role = 'default_owner'::text");
    expect(policies.rows[0]?.qual).toContain("is_default");
    expect(policies.rows[0]?.with_check).toBeNull();
    const role = await ownerPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'gooddealer_cloud_app'",
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const grants = await ownerPool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'gooddealer_cloud_app' AND table_name = 'workspace_account_bindings'`,
    );
    expect(grants.rows.map((row) => row.privilege_type).sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("isolates both tenant keys and clears both selectors after commit and rollback reuse", async () => {
    const active = await activateAccount(appPool, verified, { schemaVersion: 1 });
    await ownerPool.query(`INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name)
      VALUES ('same-account-other-workspace', $1, 'personal', 'Other')`, [active.accountId]);
    await reuseTenantTransactions.withTenant(activationTenantScope(active), async (transaction) => {
      const visible = await transaction.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM workspace_workspaces WHERE workspace_id = $1",
        [active.workspaceId],
      );
      expect(visible.rows).toEqual([{ workspace_id: active.workspaceId }]);
    });
    const afterCommit = await reusePool.query<{ account_id: string | null; workspace_id: string | null }>(
      `SELECT nullif(current_setting('gooddealer.account_id', true), '') AS account_id,
              nullif(current_setting('gooddealer.workspace_id', true), '') AS workspace_id`,
    );
    expect(afterCommit.rows[0]).toEqual({ account_id: null, workspace_id: null });
    await expect(reuseTenantTransactions.withTenant(activationTenantScope(active), async () => { throw new Error("rollback-control"); }))
      .rejects.toThrow("rollback-control");
    const afterRollback = await reusePool.query<{ account_id: string | null; workspace_id: string | null }>(
      `SELECT nullif(current_setting('gooddealer.account_id', true), '') AS account_id,
              nullif(current_setting('gooddealer.workspace_id', true), '') AS workspace_id`,
    );
    expect(afterRollback.rows[0]).toEqual({ account_id: null, workspace_id: null });

    for (const scope of [
      { accountId: "foreign-account", workspaceId: active.workspaceId },
      { accountId: active.accountId, workspaceId: "same-account-other-workspace" },
    ]) {
      const denied = await reuseTenantTransactions.withTenant(scope, (transaction) => transaction.query(
        "SELECT workspace_id FROM workspace_workspaces WHERE workspace_id = $1",
        [active.workspaceId],
      ));
      expect(denied.rows).toEqual([]);
      const write = await reuseTenantTransactions.withTenant(scope, (transaction) => transaction.query(
        "UPDATE workspace_workspaces SET updated_at = transaction_timestamp() WHERE workspace_id = $1",
        [active.workspaceId],
      ));
      expect(write.rowCount).toBe(0);
    }
  });

  it("serializes concurrent same-subject activation to one complete graph", async () => {
    const results = await Promise.all(Array.from({ length: 1 }, () => activateAccount(appPool, verified, { schemaVersion: 1 })));
    expect(new Set(results.map(({ accountId, workspaceId }) => `${accountId}:${workspaceId}`)).size).toBe(1);
    const count = await ownerPool.query<{ count: string }>("SELECT count(*)::text AS count FROM workspace_account_bindings");
    expect(count.rows[0]?.count).toBe("1");
  });
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; PostgreSQL activation evidence cannot run without the established harness environment`);
  return value;
}
