import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AccountTransactionRunner,
  PreAuthEmailTransactionRunner,
  runCloudMigrations,
} from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import {
  PostgresIdentityAuthenticationRepository,
  hashFixturePassword,
} from "../../src/modules/identity/index";

const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
const appPool = new Pool({ connectionString: appUrl, max: 4 });
const reusePool = new Pool({ connectionString: appUrl, max: 1 });
const transactions = new AccountTransactionRunner(appPool);
const preAuth = new PreAuthEmailTransactionRunner(appPool);
const repository = new PostgresIdentityAuthenticationRepository(preAuth, transactions);

const future = new Date("2030-01-01T00:00:00Z");

beforeAll(async () => {
  const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC !== "true") {
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  } else {
    console.warn(`UNQUALIFIED PostgreSQL diagnostic only: ${version.rows[0]?.server_version}`);
  }
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query(
    "TRUNCATE identity_credential_jtis, identity_refresh_families, identity_auth_sessions, identity_account_security_states, identity_accounts CASCADE",
  );
  await seedAccount("account-a", "a@example.com");
  await seedAccount("account-b", "b@example.com");
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end(), reusePool.end()]);
});

describe("PostgreSQL identity authentication persistence", () => {
  it("separates exact pre-auth email selection from post-auth account RLS and clears pooled settings", async () => {
    await expect(repository.findExactAccount("a@example.com")).resolves.toMatchObject({
      accountId: "account-a",
      emailNormalized: "a@example.com",
    });
    await preAuth.withExactEmail("a@example.com", async (transaction) => {
      const rows = await transaction.query<{ account_id: string }>("SELECT account_id FROM identity_accounts ORDER BY account_id");
      expect(rows.rows).toEqual([{ account_id: "account-a" }]);
      const protectedRows = await transaction.query("SELECT account_id FROM identity_account_security_states");
      expect(protectedRows.rows).toEqual([]);
    });
    await transactions.withAccount("account-a", async (transaction) => {
      const rows = await transaction.query<{ account_id: string }>("SELECT account_id FROM identity_accounts ORDER BY account_id");
      expect(rows.rows).toEqual([{ account_id: "account-a" }]);
    });

    const reusePreAuth = new PreAuthEmailTransactionRunner(reusePool);
    await reusePreAuth.withExactEmail("a@example.com", async () => undefined);
    await expect(reusePreAuth.withExactEmail("a@example.com", async () => { throw new Error("rollback-probe"); }))
      .rejects.toThrow("rollback-probe");
    const residue = await reusePool.query<{
      account_id: string | null;
      login_email: string | null;
      workspace_id: string | null;
    }>(
      `SELECT nullif(current_setting('gooddealer.account_id', true), '') AS account_id,
              nullif(current_setting('gooddealer.login_email', true), '') AS login_email,
              nullif(current_setting('gooddealer.workspace_id', true), '') AS workspace_id`,
    );
    expect(residue.rows[0]).toEqual({ account_id: null, login_email: null, workspace_id: null });
  });

  it("commits one of two prepared rotations and treats the loser as a non-revoking conflict", async () => {
    await issue("account-a", "session-a", "family-a", "access-a0", "refresh-a0");
    const snapshot = {
      accountId: "account-a",
      sessionId: "session-a",
      familyId: "family-a",
      presentedRefreshJti: "refresh-a0",
      accountSecurityEpoch: 1,
    } as const;
    const [first, second] = await Promise.all([repository.prepareRefresh(snapshot), repository.prepareRefresh(snapshot)]);
    if (first.status !== "ready" || second.status !== "ready") throw new Error("refresh preparation failed");
    const results = await Promise.all([
      repository.commitRefresh(first.preparation, next("a1")),
      repository.commitRefresh(second.preparation, next("a2")),
    ]);
    expect(results.filter(({ status }) => status === "rotated")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "refresh_rotation_conflict")).toHaveLength(1);
    let currentRefreshJti = "";
    await transactions.withAccount("account-a", async (transaction) => {
      const family = await transaction.query<{ state: string; generation: string; current_refresh_jti: string }>(
        "SELECT state, generation, current_refresh_jti FROM identity_refresh_families WHERE family_id = 'family-a'",
      );
      expect(family.rows[0]).toMatchObject({ state: "active", generation: "1" });
      currentRefreshJti = family.rows[0]?.current_refresh_jti ?? "";
    });

    const collisionPreparation = await repository.prepareRefresh({ ...snapshot, presentedRefreshJti: currentRefreshJti });
    if (collisionPreparation.status !== "ready") throw new Error("collision preparation failed");
    await expect(repository.commitRefresh(collisionPreparation.preparation, {
      ...next("collision"), accessJti: "access-a0",
    })).resolves.toEqual({ status: "credential_jti_conflict" });
    await transactions.withAccount("account-a", async (transaction) => {
      const family = await transaction.query<{ generation: string; current_refresh_jti: string }>(
        "SELECT generation, current_refresh_jti FROM identity_refresh_families WHERE family_id = 'family-a'",
      );
      expect(family.rows[0]).toEqual({ generation: "1", current_refresh_jti: currentRefreshJti });
    });
  });

  it("revokes only a proven rotated JTI family and never harms another family", async () => {
    await issue("account-a", "session-a", "family-a", "access-a0", "refresh-a0");
    await issue("account-a", "session-b", "family-b", "access-b0", "refresh-b0");
    const prepared = await repository.prepareRefresh({
      accountId: "account-a", sessionId: "session-a", familyId: "family-a",
      presentedRefreshJti: "refresh-a0", accountSecurityEpoch: 1,
    });
    if (prepared.status !== "ready") throw new Error("refresh preparation failed");
    await expect(repository.commitRefresh(prepared.preparation, next("a1"))).resolves.toMatchObject({ status: "rotated" });

    await expect(repository.prepareRefresh({
      accountId: "account-a", sessionId: "session-b", familyId: "family-b",
      presentedRefreshJti: "refresh-a0", accountSecurityEpoch: 1,
    })).resolves.toEqual({ status: "invalid_credentials" });
    await expect(repository.prepareRefresh({
      accountId: "account-a", sessionId: "session-a", familyId: "family-a",
      presentedRefreshJti: "refresh-a0", accountSecurityEpoch: 1,
    })).resolves.toEqual({ status: "refresh_reuse_detected" });

    await transactions.withAccount("account-a", async (transaction) => {
      const families = await transaction.query<{ family_id: string; state: string }>(
        "SELECT family_id, state FROM identity_refresh_families ORDER BY family_id",
      );
      expect(families.rows).toEqual([
        { family_id: "family-a", state: "revoked" },
        { family_id: "family-b", state: "active" },
      ]);
    });
  });

  it("advances the security epoch atomically, revokes all account identity state, and blocks stale commits", async () => {
    await issue("account-a", "session-a", "family-a", "access-a0", "refresh-a0");
    await issue("account-a", "session-b", "family-b", "access-b0", "refresh-b0");
    await issue("account-b", "session-other", "family-other", "access-o0", "refresh-o0");
    const prepared = await repository.prepareRefresh({
      accountId: "account-a", sessionId: "session-a", familyId: "family-a",
      presentedRefreshJti: "refresh-a0", accountSecurityEpoch: 1,
    });
    if (prepared.status !== "ready") throw new Error("refresh preparation failed");
    await expect(repository.advanceSecurityEpoch("account-a", "recovery_pending")).resolves.toBe(2);
    await expect(repository.commitRefresh(prepared.preparation, next("stale")))
      .resolves.toEqual({ status: "session_revoked" });

    await transactions.withAccount("account-a", async (transaction) => {
      const counts = await transaction.query<{ sessions: string; families: string; credentials: string }>(
        `SELECT
           (SELECT count(*) FROM identity_auth_sessions WHERE revoked_at IS NOT NULL)::text AS sessions,
           (SELECT count(*) FROM identity_refresh_families WHERE state = 'revoked')::text AS families,
           (SELECT count(*) FROM identity_credential_jtis WHERE state = 'revoked')::text AS credentials`,
      );
      expect(counts.rows[0]).toEqual({ sessions: "2", families: "2", credentials: "4" });
      const stale = await transaction.query("SELECT jti FROM identity_credential_jtis WHERE jti LIKE '%stale%'");
      expect(stale.rows).toEqual([]);
    });
    await transactions.withAccount("account-b", async (transaction) => {
      const family = await transaction.query<{ state: string }>("SELECT state FROM identity_refresh_families");
      expect(family.rows).toEqual([{ state: "active" }]);
    });
  });
});

async function seedAccount(accountId: string, email: string): Promise<void> {
  const stored = await hashFixturePassword("fixture-password");
  await transactions.withAccount(accountId, async (transaction) => {
    await transaction.query(
      `INSERT INTO identity_accounts
         (account_id, email_normalized, email_verified_at, password_policy_id, password_hash_phc)
       VALUES ($1, $2, transaction_timestamp(), $3, $4)`,
      [accountId, email, stored.policyId, stored.phc],
    );
    await transaction.query("INSERT INTO identity_account_security_states (account_id) VALUES ($1)", [accountId]);
  });
}

async function issue(accountId: string, sessionId: string, familyId: string, accessJti: string, refreshJti: string) {
  await expect(repository.issueInitial({
    accountId, expectedEpoch: 1, sessionId, familyId, accessJti, refreshJti,
    deviceId: `device-${sessionId}`, rememberDevice: true,
    accessExpiresAt: future, refreshExpiresAt: future,
  })).resolves.toBe("issued");
}

function next(suffix: string) {
  return {
    accessJti: `access-${suffix}`,
    refreshJti: `refresh-${suffix}`,
    accessExpiresAt: future,
    refreshExpiresAt: future,
  } as const;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  }
  return value;
}
