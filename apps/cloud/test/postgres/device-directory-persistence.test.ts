import { deviceSelfReportSchema } from "@gooddealer/protocol/devices";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccountTransactionRunner, runCloudMigrations } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { PostgresDeviceDirectory } from "../../src/modules/devices/index";
import { clearLicensingTestData } from "../support/postgres-fixture";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 4 });
const accounts = new AccountTransactionRunner(appPool);
const directory = new PostgresDeviceDirectory(accounts);
// Session ids are unique across accounts (their credential digest is), so each carries its account.
const desktop = (accountId: string, session: string) => ({ accountId, sessionId: `${accountId}-${session}`, clientKind: "desktop" as const });
const active = desktop("directory-account-a", "session-old");
const standby = desktop("directory-account-a", "session-new");
const report = (displayName: string, platform = "linux") => ({ schemaVersion: 1, platform, displayName });
const listRequest = { schemaVersion: 1 };

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
  const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC !== "true") {
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  } else {
    console.warn(`UNQUALIFIED PostgreSQL diagnostic only: ${version.rows[0]?.server_version ?? "unknown"}`);
  }
});

beforeEach(async () => {
  await clearLicensingTestData(ownerPool);
  // Immutable epoch boundaries are cleared only by owner fixture maintenance, never runtime DELETE.
  await ownerPool.query("TRUNCATE identity_private.security_epoch_end_boundaries");
  await ownerPool.query(`TRUNCATE
    device_bootstrap_activation_attempts, device_bootstrap_step_nonces, device_bootstrap_authorities,
    device_bootstrap_steps, device_bootstrap_capabilities, device_drain_proofs, device_active_leases,
    device_lease_epoch_allocations, device_switch_workflows, device_identity_challenges, device_login_challenges,
    device_signing_keys, device_bindings, device_account_states CASCADE`);
  await ownerPool.query("DELETE FROM workspace_account_bindings");
  await ownerPool.query("DELETE FROM workspace_workspaces");
  await ownerPool.query("DELETE FROM identity_accounts");
  for (const accountId of ["directory-account-a", "directory-account-b"]) await seed(accountId);
});

afterAll(async () => { await Promise.all([ownerPool.end(), appPool.end()]); });

describe("PostgreSQL device directory (ADR-0032 S3a)", () => {
  it("lists the account's devices with roles from the Lease, before any device reports itself", async () => {
    const list = await directory.list(listRequest, standby);
    expect(list).toMatchObject({ schemaVersion: 1, listRevision: 1 });
    expect(list?.devices.map(({ deviceId, role, status, currentDevice, platform, displayName, lastSeenAt }) =>
      ({ deviceId, role, status, currentDevice, platform, displayName, lastSeenAt }))).toEqual([
      { deviceId: "device-new", role: "standby", status: "bound", currentDevice: true, platform: null, displayName: null, lastSeenAt: null },
      { deviceId: "device-old", role: "active", status: "bound", currentDevice: false, platform: null, displayName: null, lastSeenAt: null },
      { deviceId: "device-gone", role: "none", status: "removed", currentDevice: false, platform: null, displayName: null, lastSeenAt: null },
    ]);
    expect(list?.devices[0]).toMatchObject({ signingKeyId: "key-new-directory-account-a", signingKeyVersion: 1, signingKeyStatus: "active" });
    // A released Lease leaves both bound devices as Standby; Cloud never invents an Active one.
    await owner("directory-account-a", "UPDATE device_active_leases SET released_at = transaction_timestamp(), release_reason = 'logout' WHERE account_id = 'directory-account-a'");
    const released = await directory.list(listRequest, active);
    expect(released?.devices.filter(({ status }) => status === "bound").map(({ role }) => role)).toEqual(["standby", "standby"]);
  });

  it("records a report for the session's own device, floors last seen to the hour, and bumps the revision only on change", async () => {
    const reported = await directory.reportSelf(report("Studio PC"), active);
    const own = reported?.devices.find(({ deviceId }) => deviceId === "device-old");
    expect(own).toMatchObject({ platform: "linux", displayName: "Studio PC", currentDevice: true });
    expect(own?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/u);
    expect(reported?.listRevision).toBe(2);
    expect(reported?.devices.find(({ deviceId }) => deviceId === "device-new")).toMatchObject({ platform: null, displayName: null });
    await expect(directory.reportSelf(report("Studio PC"), active)).resolves.toMatchObject({ listRevision: 2 });
    await expect(directory.reportSelf(report("Studio PC", "windows"), active)).resolves.toMatchObject({ listRevision: 3 });
    // Listing is read-only; self-report is a mutation and requires the current Active Lease.
    await expect(directory.reportSelf(report("Laptop", "macos"), standby)).resolves.toBeNull();
    expect(await owner("directory-account-a",
      "SELECT device_id, last_seen_at = date_trunc('hour', last_seen_at, 'UTC') AS whole_hour FROM device_bindings WHERE account_id = 'directory-account-a' AND last_seen_at IS NOT NULL ORDER BY device_id"))
      .toEqual([{ device_id: "device-old", whole_hour: true }]);
  });

  it("denies web sessions, revoked or stale sessions, removed devices, and recovery without writing", async () => {
    await expect(directory.list(listRequest, { ...active, clientKind: "account_web" })).resolves.toBeNull();
    await expect(directory.reportSelf(report("x"), desktop("directory-account-a", "session-unknown"))).resolves.toBeNull();
    await expect(directory.reportSelf(report("x"), desktop("directory-account-a", "session-gone"))).resolves.toBeNull();
    await owner("directory-account-a", "UPDATE identity_auth_sessions SET revoked_at = transaction_timestamp(), revocation_reason = 'logout' WHERE session_id = 'directory-account-a-session-new'");
    await expect(directory.reportSelf(report("x"), standby)).resolves.toBeNull();
    await owner("directory-account-a", "UPDATE identity_refresh_families SET state = 'revoked', revoked_at = transaction_timestamp(), revocation_reason = 'reuse' WHERE session_id = 'directory-account-a-session-old'");
    await expect(directory.list(listRequest, active)).resolves.toBeNull();
    await owner("directory-account-a", "UPDATE identity_refresh_families SET state = 'active', revoked_at = NULL, revocation_reason = NULL WHERE session_id = 'directory-account-a-session-old'");
    await owner("directory-account-a", "UPDATE identity_account_security_states SET account_security_epoch = 2 WHERE account_id = 'directory-account-a'");
    await expect(directory.list(listRequest, active)).resolves.toBeNull();
    await owner("directory-account-a", "UPDATE identity_account_security_states SET status = 'recovery_pending' WHERE account_id = 'directory-account-a'");
    await expect(directory.reportSelf(report("x"), active)).resolves.toBeNull();
    expect(await owner("directory-account-a",
      "SELECT count(*)::text AS reported FROM device_bindings WHERE account_id = 'directory-account-a' AND (display_name IS NOT NULL OR last_seen_at IS NOT NULL)"))
      .toEqual([{ reported: "0" }]);
    expect(await owner("directory-account-a", "SELECT binding_list_revision FROM device_account_states WHERE account_id = 'directory-account-a'")).toEqual([{ binding_list_revision: "1" }]);
  });

  it("does not describe an unreleased but expired Lease as Active", async () => {
    await owner("directory-account-a", `UPDATE device_active_leases
      SET issued_at = clock_timestamp() - interval '2 hours', renew_after = clock_timestamp() - interval '90 minutes',
          online_expires_at = clock_timestamp() - interval '1 hour'
      WHERE account_id = 'directory-account-a'`);
    const view = await directory.list(listRequest, active);
    expect(view?.devices.find(({ deviceId }) => deviceId === "device-old")?.role).toBe("standby");
  });

  it.each(["revoked", "rotated"])("denies a bound device whose signing key is %s and gives it no role", async (status) => {
    await owner("directory-account-a", `UPDATE device_signing_keys SET status = '${status}' WHERE account_id = 'directory-account-a' AND device_id = 'device-new'`);
    await expect(directory.list(listRequest, standby)).resolves.toBeNull();
    await expect(directory.reportSelf(report("must not persist"), standby)).resolves.toBeNull();
    const view = await directory.list(listRequest, active);
    expect(view?.devices.find(({ deviceId }) => deviceId === "device-new")).toMatchObject({ role: "none", displayName: null });
    expect(view?.listRevision).toBe(1);
  });

  it("waits for concurrent key revocation before allowing a report", async () => {
    const client = await ownerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE device_signing_keys SET status = 'revoked' WHERE account_id = 'directory-account-a' AND device_id = 'device-new'");
      const pending = directory.reportSelf(report("revoked while reporting"), standby);
      // Prove the report reached the locked key before committing its revocation.
      let waiting = false;
      for (let poll = 0; poll < 100 && !waiting; poll += 1) {
        const activity = await appPool.query<{ waiting: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE usename = current_user AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query LIKE 'SELECT session.device_id%'
        ) AS waiting`);
        waiting = activity.rows[0]?.waiting === true;
        if (!waiting) await appPool.query("SELECT pg_sleep(0.01)");
      }
      expect(waiting).toBe(true);
      await client.query("COMMIT");
      await expect(pending).resolves.toBeNull();
      expect((await directory.list(listRequest, active))?.listRevision).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("serializes renames with writers that lock in drain order, without deadlock", async () => {
    // A drain, login or switch writer locks security, then account state, then bindings. Renames
    // racing such writers must queue behind them rather than deadlock (SQLSTATE 40P01).
    const drainOrderWriter = async () => accounts.withAccount("directory-account-a", async (transaction) => {
      await transaction.query("SELECT 1 FROM identity_account_security_states WHERE account_id = $1 FOR UPDATE", ["directory-account-a"]);
      await transaction.query("SELECT 1 FROM device_account_states WHERE account_id = $1 FOR UPDATE", ["directory-account-a"]);
      await transaction.query("SELECT pg_sleep(0.02)");
      await transaction.query(
        "SELECT 1 FROM device_bindings WHERE account_id = $1 ORDER BY device_id COLLATE \"C\" FOR UPDATE", ["directory-account-a"]);
      await transaction.query(
        "UPDATE device_account_states SET binding_list_revision = binding_list_revision + 1 WHERE account_id = $1", ["directory-account-a"]);
    });
    const work: Promise<unknown>[] = [];
    for (let round = 0; round < 6; round += 1) {
      work.push(drainOrderWriter(), directory.reportSelf(report(`Name ${round}`), round % 2 === 0 ? active : standby));
    }
    const settled = await Promise.allSettled(work);
    expect(settled.filter(({ status }) => status === "rejected")).toEqual([]);
    expect(await owner("directory-account-a", "SELECT binding_list_revision FROM device_account_states WHERE account_id = 'directory-account-a'"))
      .toEqual([{ binding_list_revision: String(1 + 6 + 3) }]);
  });

  it("rejects a report naming a device or carrying an invalid name before touching the database", async () => {
    for (const value of [
      { ...report("x"), deviceId: "device-new" },
      report("x", "solaris"),
      report("a\nb"),
      report(""),
      report("x".repeat(65)),
    ]) {
      await expect(directory.reportSelf(value, active)).rejects.toThrow();
    }
    await expect(directory.list({ schemaVersion: 1, accountId: "directory-account-b" }, active)).rejects.toThrow();
  });

  it("isolates identical device and session ids across two accounts", async () => {
    await directory.reportSelf(report("Account A"), active);
    const inB = await directory.list(listRequest, desktop("directory-account-b", "session-old"));
    expect(inB?.listRevision).toBe(1);
    expect(inB?.devices.every(({ displayName }) => displayName === null)).toBe(true);
    // Account A's session presented under account B's id resolves nothing there.
    await expect(directory.reportSelf(report("hijack"), { ...active, accountId: "directory-account-b" })).resolves.toBeNull();
    expect(await owner("directory-account-a", "SELECT display_name FROM device_bindings WHERE account_id = 'directory-account-a' AND device_id = 'device-old'"))
      .toEqual([{ display_name: "Account A" }]);
  });

  it("keeps the self-report columns within their constraints even for the database owner", async () => {
    for (const sql of [
      "UPDATE device_bindings SET platform = 'linux' WHERE account_id = 'directory-account-a' AND device_id = 'device-old'",
      "UPDATE device_bindings SET platform = 'beos', display_name = 'x' WHERE account_id = 'directory-account-a' AND device_id = 'device-old'",
      "UPDATE device_bindings SET platform = 'linux', display_name = E'a\\tb' WHERE account_id = 'directory-account-a' AND device_id = 'device-old'",
      "UPDATE device_bindings SET last_seen_at = '2026-11-18T01:30:00Z' WHERE account_id = 'directory-account-a' AND device_id = 'device-old'",
    ]) {
      await expect(owner("directory-account-a", sql)).rejects.toThrow(/check constraint/u);
    }
  });

  it("enforces the protocol display-label rule in the database for every Cc and Cf character and trimmed whitespace", async () => {
    const rejected: string[] = [];
    for (let codePoint = 1; codePoint <= 0x10ffff; codePoint += 1) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
      if (/[\p{Cc}\p{Cf}]/u.test(String.fromCodePoint(codePoint))) rejected.push(String.fromCodePoint(codePoint));
    }
    const edges = [" a", "a ", "\u3000a", "a\u00a0", "\u2028a", "a\u205f"];
    const accepted = ["a b", "Studio\u00a0PC", "设备", "é", "x".repeat(64), "😀".repeat(64)];
    for (const value of [...rejected.map((character) => `a${character}b`), ...edges, ...accepted]) {
      expect(deviceSelfReportSchema.safeParse({ schemaVersion: 1, platform: "linux", displayName: value }).success)
        .toBe(accepted.includes(value));
    }
    // Each candidate is written as the owner under a savepoint, so the column constraint itself
    // answers; nothing is kept.
    const client = await ownerPool.connect();
    const disagreements: string[] = [];
    try {
      await client.query("BEGIN");
      for (const value of [...rejected.map((character) => `a${character}b`), ...edges, ...accepted]) {
        await client.query("SAVEPOINT candidate");
        const stored = await client.query(
          `UPDATE device_bindings SET platform = 'linux', display_name = $1
            WHERE account_id = 'directory-account-a' AND device_id = 'device-old'`, [value],
        ).then(() => true, () => false);
        await client.query("ROLLBACK TO SAVEPOINT candidate");
        if (stored !== accepted.includes(value)) disagreements.push(JSON.stringify(value));
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(disagreements).toEqual([]);
  });
});

async function seed(accountId: string): Promise<void> {
  await withOwner(accountId, async (query) => {
    await query(`INSERT INTO identity_accounts (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ($1, $2, 'argon2id-v1', repeat('x', 80))`, [accountId, `${accountId}@example.test`]);
    await query("INSERT INTO identity_account_security_states (account_id, account_security_epoch, status) VALUES ($1, 1, 'normal')", [accountId]);
    await query(`INSERT INTO identity_auth_sessions
        (account_id, session_id, client_kind, device_id, auth_method, remember_device, epoch_at_issue, expires_at)
      VALUES ($1, $1 || '-session-old', 'desktop', 'device-old', 'password', true, 1, transaction_timestamp() + interval '1 hour'),
        ($1, $1 || '-session-new', 'desktop', 'device-new', 'password', true, 1, transaction_timestamp() + interval '1 hour'),
        ($1, $1 || '-session-gone', 'desktop', 'device-gone', 'password', true, 1, transaction_timestamp() + interval '1 hour')`, [accountId]);
    await query(`INSERT INTO identity_refresh_families (account_id, family_id, session_id, current_refresh_jti)
      VALUES ($1, 'family-old', $1 || '-session-old', $2), ($1, 'family-new', $1 || '-session-new', $3),
        ($1, 'family-gone', $1 || '-session-gone', $4)`,
    [accountId, `jti-old-${accountId}`, `jti-new-${accountId}`, `jti-gone-${accountId}`]);
    await query(`INSERT INTO device_account_states
      (account_id, binding_list_revision, highest_allocated_lease_epoch, current_lease_epoch) VALUES ($1, 1, 1, 1)`, [accountId]);
    await query(`INSERT INTO device_bindings (account_id, device_id, slot, status, credential_epoch, removed_at, removal_reason)
      VALUES ($1, 'device-old', 1, 'bound', 1, NULL, NULL), ($1, 'device-new', 2, 'bound', 1, NULL, NULL),
        ($1, 'device-gone', NULL, 'removed', 1, transaction_timestamp(), 'user_removed')`, [accountId]);
    await query(`INSERT INTO device_signing_keys (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ($1, 'device-old', 1, $2, $5, $6, 'active'), ($1, 'device-new', 1, $3, $7, $8, 'active'),
        ($1, 'device-gone', 1, $4, $9, $10, 'revoked')`,
    [accountId, `key-old-${accountId}`, `key-new-${accountId}`, `key-gone-${accountId}`,
      Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3), Buffer.alloc(32, 4), Buffer.alloc(32, 5), Buffer.alloc(32, 6)]);
    await query(`INSERT INTO device_lease_epoch_allocations (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
      VALUES ($1, 'directory-workspace', 'login', 1, 'activated', transaction_timestamp())`, [accountId]);
    await query(`INSERT INTO device_active_leases
      (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
       offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
      VALUES ($1, 1, 'device-old', $2, transaction_timestamp() - interval '10 minutes',
        transaction_timestamp() - interval '9 minutes', transaction_timestamp() + interval '5 minutes',
        transaction_timestamp() + interval '1 hour', decode('01', 'hex'),
        jsonb_build_object('fixture', 'device-directory'), pg_catalog.sha256(decode('01', 'hex')))`,
    [accountId, `lease-${accountId}`]);
  });
}

async function owner(accountId: string, sql: string) {
  // The owner bypasses row security, so every owner statement names its account itself.
  return withOwner(accountId, async (query) => (await query(sql, [])).rows);
}

async function withOwner<Result>(
  accountId: string,
  work: (query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<Result>,
): Promise<Result> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [accountId]);
    await client.query("SELECT set_config('gooddealer.workspace_id', 'directory-workspace', true)");
    const result = await work((sql, values) => client.query(sql, values));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  return value;
}
