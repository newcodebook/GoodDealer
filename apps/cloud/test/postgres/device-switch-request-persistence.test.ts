import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runCloudMigrations, TenantTransactionRunner } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { PostgresDeviceSwitchRequests } from "../../src/modules/devices/index";
import { PostgresIdentityAccountSecurityStatePort } from "../../src/modules/identity/index";
import { clearLicensingTestData } from "../support/postgres-fixture";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 6 });
const transactions = new TenantTransactionRunner(appPool);
const service = new PostgresDeviceSwitchRequests({
  transactions,
  accountSecurity: new PostgresIdentityAccountSecurityStatePort(),
});
const scopeA = { accountId: "switch-account-a", workspaceId: "switch-workspace" } as const;
const scopeB = { accountId: "switch-account-b", workspaceId: "switch-workspace" } as const;
const source = { ...scopeA, deviceId: "device-old" } as const;
const normal = (toDeviceId: string, idempotencyKey: string) => ({ toDeviceId, idempotencyKey,expectedSourceLeaseEpoch:1 });

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
  for (const scope of [scopeA, scopeB]) await seed(scope);
});

afterAll(async () => { await Promise.all([ownerPool.end(), appPool.end()]); });

describe("PostgreSQL device switch requests (ADR-0032 S1b)", () => {
  it("starts a normal switch only from the Lease holder, binds the target's key, and replays its idempotency key", async () => {
    const first = await service.requestNormal(source, normal("device-new", "idem-1"));
    expect(first).toMatchObject({
      schemaVersion: 1,
      accepted: true,
      request: {
        mode: "normal", status: "draining", fromDeviceId: "device-old", toDeviceId: "device-new",
        earliestTakeoverAt: null, bootstrapExpiresAt: null, requestedAt: expect.stringMatching(/Z$/u),
      },
    });
    const requestId = first?.accepted === true ? first.request.requestId : "";
    const row = await owner(scopeA, `SELECT purpose, workflow_revision, bound_key_id, bound_key_version,
        bound_account_security_epoch, pending_lease_epoch,
        state_deadline - created_at = interval '24 hours' AS day_deadline
      FROM device_switch_workflows WHERE workflow_id = $1`, [requestId]);
    expect(row).toEqual([{ purpose: "device_switch", workflow_revision: "1", bound_key_id: "key-new",
      bound_key_version: "1", bound_account_security_epoch: "1", pending_lease_epoch: null, day_deadline: true }]);

    await expect(service.requestNormal(source, normal("device-new", "idem-1"))).resolves.toEqual(first);
    await expect(service.requestNormal(source, normal("device-other", "idem-1")))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "IDEMPOTENCY_CONFLICT" });
    await expect(service.requestNormal(source, normal("device-new", "idem-2")))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_IN_PROGRESS" });
    expect(await owner(scopeA, "SELECT count(*)::text AS count FROM device_switch_workflows", [])).toEqual([{ count: "1" }]);
  });

  it("admits a desktop-login allocation only through the exact personal default workspace", async () => {
    await owner(scopeA, `UPDATE device_lease_epoch_allocations SET allocation_source = 'desktop_login',
      workspace_id = NULL, workflow_id = NULL WHERE account_id = $1`, [scopeA.accountId]);
    // No default binding means an account-wide login Lease cannot select a workspace itself.
    await expect(service.requestNormal(source, normal("device-new", "idem-unbound"))).resolves.toBeNull();
    await owner(scopeA, `INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name)
      VALUES ($2, $1, 'personal', 'Personal');
      `, [scopeA.accountId, scopeA.workspaceId]);
    await owner(scopeA, `INSERT INTO workspace_account_bindings (account_id, workspace_id, owner_kind, role, is_default)
      VALUES ($1, $2, 'account', 'default_owner', true)`, [scopeA.accountId, scopeA.workspaceId]);
    await expect(service.requestNormal({ ...source, workspaceId: "foreign-workspace" }, normal("device-new", "idem-foreign"))).resolves.toBeNull();
    await expect(service.requestNormal(source, normal("device-new", "idem-login"))).resolves.toMatchObject({ accepted: true,
      request: { schemaVersion: 2, status: "draining", normalHandoffReceipt: null } });
  });

  it("denies a caller without the current unexpired Lease and refuses ineligible targets without writing", async () => {
    await expect(service.requestNormal({ ...scopeA, deviceId: "device-new" }, normal("device-old", "idem-a"))).resolves.toBeNull();
    await expect(service.requestNormal({ ...source, workspaceId: "other-workspace" }, normal("device-new", "idem-b"))).resolves.toBeNull();
    for (const [target, code] of [
      ["device-old", "TARGET_IS_SOURCE"],
      ["device-unknown", "TARGET_NOT_BOUND"],
      ["device-gone", "TARGET_REMOVED"],
    ] as const) {
      await expect(service.requestNormal(source, normal(target, `idem-${target}`)))
        .resolves.toEqual({ schemaVersion: 1, accepted: false, code });
    }
    // A bound target whose signing key is no longer active cannot be bootstrapped or verified.
    await owner(scopeA, "UPDATE device_signing_keys SET status = 'revoked', retired_at = transaction_timestamp() WHERE device_id = 'device-new'", []);
    await expect(service.requestNormal(source, normal("device-new", "idem-revoked")))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "TARGET_NOT_BOUND" });
    await owner(scopeA, "UPDATE device_signing_keys SET status = 'active', retired_at = NULL WHERE device_id = 'device-new'", []);
    await owner(scopeA, `UPDATE device_active_leases SET online_expires_at = transaction_timestamp() - interval '1 minute',
      offline_execute_until = transaction_timestamp() - interval '1 second'`, []);
    await expect(service.requestNormal(source, normal("device-new", "idem-d"))).resolves.toBeNull();
    await owner(scopeA, "UPDATE identity_account_security_states SET status = 'recovery_pending'", []);
    await expect(service.requestNormal(source, normal("device-new", "idem-c")))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "ACCOUNT_RECOVERY_PENDING" });

    expect(await owner(scopeA, "SELECT count(*)::text AS count FROM device_switch_workflows", [])).toEqual([{ count: "0" }]);
  });

  it("shows a switch only to its two devices and lets the source cancel it once before bootstrap", async () => {
    const created = await service.requestNormal(source, normal("device-new", "idem-1"));
    const requestId = created?.accepted === true ? created.request.requestId : "";
    await expect(service.read({ ...scopeA, deviceId: "device-new" }, requestId)).resolves.toEqual(created);
    await expect(service.read({ ...scopeA, deviceId: "device-other" }, requestId))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_NOT_FOUND" });
    await expect(service.cancel({ ...scopeA, deviceId: "device-new" }, requestId))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_NOT_FOUND" });
    const cancelled = await service.cancel(source, requestId);
    expect(cancelled).toMatchObject({ accepted: true, request: { requestId, status: "cancelled" } });
    await expect(service.cancel(source, requestId)).resolves.toEqual(cancelled);
    expect(await owner(scopeA, "SELECT workflow_revision FROM device_switch_workflows WHERE workflow_id = $1", [requestId]))
      .toEqual([{ workflow_revision: "2" }]);

    const next = await service.requestNormal(source, normal("device-new", "idem-2"));
    const nextId = next?.accepted === true ? next.request.requestId : "";
    await owner(scopeA, `UPDATE device_switch_workflows SET status = 'bootstrapping', pending_lease_epoch = 2
      WHERE workflow_id = $1`, [nextId]);
    await expect(service.cancel(source, nextId))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_NOT_CANCELLABLE" });
  });

  it("isolates identical workspace, device, and idempotency ids across two accounts", async () => {
    const inA = await service.requestNormal(source, normal("device-new", "idem-1"));
    const requestId = inA?.accepted === true ? inA.request.requestId : "";
    const sourceB = { ...scopeB, deviceId: "device-old" };
    await expect(service.read(sourceB, requestId)).resolves.toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_NOT_FOUND" });
    await expect(service.cancel(sourceB, requestId)).resolves.toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_NOT_FOUND" });
    await expect(service.requestNormal(sourceB, normal("device-new", "idem-1"))).resolves.toMatchObject({ accepted: true });
    await expect(transactions.withTenant(scopeB, (transaction) => transaction.query(
      "UPDATE device_switch_workflows SET status = 'cancelled', workflow_revision = 9 WHERE account_id = $1", [scopeA.accountId])))
      .resolves.toMatchObject({ rowCount: 0 });
  });

  it("fails an expired switch that never reached bootstrap when the next request arrives", async () => {
    const stale = await service.requestNormal(source, normal("device-new", "idem-stale"));
    const staleId = stale?.accepted === true ? stale.request.requestId : "";
    await owner(scopeA, `UPDATE device_switch_workflows SET state_deadline = created_at
      WHERE workflow_id = $1`, [staleId]);
    await expect(service.requestNormal(source, normal("device-new", "idem-fresh"))).resolves.toMatchObject({ accepted: true });
    await expect(service.read(source, staleId)).resolves.toMatchObject({ accepted: true, request: { status: "failed" } });
    // An expired bootstrapping switch still blocks: burning its epoch and capability belongs to S1d.
    const fresh = await owner(scopeA, "SELECT workflow_id FROM device_switch_workflows WHERE idempotency_key = 'idem-fresh'", []);
    await owner(scopeA, `UPDATE device_switch_workflows SET status = 'bootstrapping', pending_lease_epoch = 2,
      state_deadline = created_at WHERE idempotency_key = 'idem-fresh'`, []);
    expect(fresh).toHaveLength(1);
    await expect(service.requestNormal(source, normal("device-new", "idem-next")))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "SWITCH_IN_PROGRESS" });
  });

  it("lets exactly one of two concurrent requests open a switch", async () => {
    const results = await Promise.all([
      service.requestNormal(source, normal("device-new", "idem-race-1")),
      service.requestNormal(source, normal("device-new", "idem-race-2")),
    ]);
    expect(results.filter((result) => result?.accepted === true)).toHaveLength(1);
    expect(results.filter((result) => result?.accepted === false && result.code === "SWITCH_IN_PROGRESS")).toHaveLength(1);
  });
});

async function seed(scope: { readonly accountId: string; readonly workspaceId: string }): Promise<void> {
  await withOwner(scope, async (query) => {
    await query(`INSERT INTO identity_accounts (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ($1, $2, 'argon2id-v1', repeat('x', 80))`, [scope.accountId, `${scope.accountId}@example.test`]);
    await query(`INSERT INTO identity_account_security_states (account_id, account_security_epoch, status)
      VALUES ($1, 1, 'normal')`, [scope.accountId]);
    await query(`INSERT INTO device_account_states
      (account_id, binding_list_revision, highest_allocated_lease_epoch, current_lease_epoch) VALUES ($1, 1, 1, 1)`,
    [scope.accountId]);
    await query(`INSERT INTO device_bindings (account_id, device_id, slot, status, credential_epoch, removed_at, removal_reason)
      VALUES ($1, 'device-old', 1, 'bound', 1, NULL, NULL), ($1, 'device-new', 2, 'bound', 1, NULL, NULL),
        ($1, 'device-gone', NULL, 'removed', 1, transaction_timestamp(), 'user_removed')`, [scope.accountId]);
    await query(`INSERT INTO device_signing_keys (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ($1, 'device-old', 1, $2, $3, $4, 'active'), ($1, 'device-new', 1, $5, $6, $7, 'active')`,
    [scope.accountId, `key-old-${scope.accountId}`, Buffer.alloc(32, 1), Buffer.alloc(32, 2),
      scope === scopeA ? "key-new" : `key-new-${scope.accountId}`, Buffer.alloc(32, 3), Buffer.alloc(32, 4)]);
    await query(`INSERT INTO device_lease_epoch_allocations (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
      VALUES ($1, $2, 'login', 1, 'activated', transaction_timestamp())`, [scope.accountId, scope.workspaceId]);
    await query(`INSERT INTO device_active_leases
      (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
       offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
      VALUES ($1, 1, 'device-old', $2, transaction_timestamp() - interval '10 minutes',
        transaction_timestamp() - interval '9 minutes', transaction_timestamp() + interval '5 minutes',
        transaction_timestamp() + interval '1 hour', decode('01', 'hex'),
        jsonb_build_object('fixture', 'device-switch'), pg_catalog.sha256(decode('01', 'hex')))`,
    [scope.accountId, `lease-${scope.accountId}`]);
  });
}

async function owner(scope: { readonly accountId: string; readonly workspaceId: string }, sql: string, values: unknown[]) {
  return withOwner(scope, async (query) => (await query(sql, values)).rows);
}

async function withOwner<Result>(
  scope: { readonly accountId: string; readonly workspaceId: string },
  work: (query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<Result>,
): Promise<Result> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [scope.accountId]);
    await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);
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
