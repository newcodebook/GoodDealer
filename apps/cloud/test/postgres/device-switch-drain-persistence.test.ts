import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccountTransactionRunner, runCloudMigrations, TenantTransactionRunner } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { PostgresWorkspaceDeviceAuditDrainLedger } from "../../src/modules/audit/index";
import {
  PostgresDeviceDrainTransition,
  PostgresExpiredDeviceBootstrap,
  PostgresDeviceSwitchDrain,
  PostgresDeviceSwitchRequests,
} from "../../src/modules/devices/index";
import { PostgresDefaultWorkspaceTenantResolver } from "../../src/modules/workspace/default-workspace/index";
import { PostgresBootstrapCheckpointPort } from "../../src/modules/workspace/checkpoints/index";
import { PostgresExecutionFactDrainLedger } from "../../src/modules/execution-ledger/index";
import { PostgresIdentityAccountSecurityStatePort } from "../../src/modules/identity/index";
import { PostgresMutationDrainLedger } from "../../src/modules/workspace/mutations/index";
import { drainProofKeyPair, signedHandoffDrainProof } from "../support/drain-proof";
import { clearLicensingTestData } from "../support/postgres-fixture";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 6 });
const transactions = new TenantTransactionRunner(appPool);
const accountSecurity = new PostgresIdentityAccountSecurityStatePort();
const requests = new PostgresDeviceSwitchRequests({ transactions, accountSecurity });
const drains = new PostgresDeviceSwitchDrain({
  transactions,
  requests,
  transition: new PostgresDeviceDrainTransition(
    transactions, accountSecurity, new PostgresMutationDrainLedger(),
    new PostgresExecutionFactDrainLedger(), new PostgresWorkspaceDeviceAuditDrainLedger(),
  ),
});
const scope = { accountId: "switch-drain-account", workspaceId: "switch-drain-workspace" } as const;
const source = { ...scope, deviceId: "device-old" } as const;
const sourceKey = drainProofKeyPair();
const mutationEnvelope = Buffer.from("switch-drain-mutation", "utf8");

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
  await ownerPool.query(`TRUNCATE
    workspace_device_cursors, workspace_device_audit_drain_seals, workspace_device_audit_drain_records,
    workspace_device_audit_drain_heads, execution_fact_drain_seals, execution_fact_drain_records,
    execution_fact_drain_heads, mutation_drain_seals, mutation_drain_records, mutation_drain_heads,
    device_bootstrap_activation_attempts, device_bootstrap_step_nonces, device_bootstrap_authorities,
    device_bootstrap_steps, device_bootstrap_capabilities, device_drain_proofs, device_active_leases,
    device_lease_epoch_allocations, device_switch_workflows, device_identity_challenges, device_login_challenges,
    device_signing_keys, device_bindings, device_account_states`);
  await ownerPool.query("DELETE FROM workspace_revisions WHERE account_id = $1", [scope.accountId]);
  await ownerPool.query("DELETE FROM workspace_account_bindings");
  await ownerPool.query("DELETE FROM workspace_workspaces");
  await ownerPool.query("DELETE FROM identity_accounts");
  await seed();
});

afterAll(async () => { await Promise.all([ownerPool.end(), appPool.end()]); });

describe("PostgreSQL device switch drain submission (ADR-0032 S1c2)", () => {
  it("admits the source's signed proof, seals all three streams including empty ones, and replays as bootstrapping", async () => {
    const requestId = await openSwitch();
    const proof = await proofFor(requestId, "proof-one");
    const handed = await drains.submit(source, requestId, proof);
    expect(handed).toMatchObject({
      accepted: true,
      request: { requestId, status: "bootstrapping", bootstrapExpiresAt: expect.stringMatching(/Z$/u) },
    });
    expect(await owner(`SELECT
        (SELECT count(*) FROM device_drain_proofs WHERE proof_id = 'proof-one' AND consumed_at IS NOT NULL
          AND proof_schema_version = 1)::text AS consumed,
        (SELECT count(*) FROM mutation_drain_seals)::text AS mutation_seals,
        (SELECT count(*) FROM execution_fact_drain_seals WHERE last_assigned_execution_fact_sequence = 0)::text AS execution_seals,
        (SELECT count(*) FROM workspace_device_audit_drain_seals WHERE last_assigned_audit_sequence = 0)::text AS audit_seals,
        (SELECT count(*) FROM device_active_leases WHERE released_at IS NULL)::text AS held_leases,
        (SELECT highest_allocated_lease_epoch FROM device_account_states)::text AS highest_epoch`))
      .toEqual([{ consumed: "1", mutation_seals: "1", execution_seals: "1", audit_seals: "1", held_leases: "0", highest_epoch: "2" }]);
    await expect(drains.submit(source, requestId, proof)).resolves.toEqual(handed);
  });

  it("terminates a real drained bootstrap when its one-hour capability expires before the old drain deadline", async () => {
    const requestId = await openSwitch();
    await expect(drains.submit(source, requestId, await proofFor(requestId, "proof-expiry")))
      .resolves.toMatchObject({ accepted: true, request: { status: "bootstrapping" } });
    await owner(`INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name)
      VALUES ($2, $1, 'personal', 'Drain expiry')`, [scope.accountId, scope.workspaceId]);
    await owner(`INSERT INTO workspace_account_bindings (account_id, workspace_id, owner_kind, role, is_default)
      VALUES ($1, $2, 'account', 'default_owner', true)`, [scope.accountId, scope.workspaceId]);
    await owner(`UPDATE device_bootstrap_capabilities SET issued_at = clock_timestamp() - interval '1 hour',
      expires_at = clock_timestamp() - interval '1 second' WHERE workflow_id = $1`, [requestId]);
    const accounts = new AccountTransactionRunner(appPool);
    const expiry = new PostgresExpiredDeviceBootstrap({
      workspaces: new PostgresDefaultWorkspaceTenantResolver(accounts), checkpoints: new PostgresBootstrapCheckpointPort(),
    });
    const expired = await accounts.withAccount(scope.accountId, async (transaction) => {
      await transaction.query("SELECT 1 FROM identity_account_security_states WHERE account_id = $1 FOR UPDATE", [scope.accountId]);
      await transaction.query("SELECT 1 FROM device_account_states WHERE account_id = $1 FOR UPDATE", [scope.accountId]);
      return expiry.expireLocked(transaction);
    });
    expect(expired).toBe(true);
    expect(await owner(`SELECT w.status, w.pending_lease_epoch, a.status AS allocation, c.consumed_reason,
      (SELECT highest_allocated_lease_epoch FROM device_account_states) AS highest,
      (SELECT count(*)::text FROM device_drain_proofs WHERE consumed_at IS NOT NULL) AS drain_proofs
      FROM device_switch_workflows w JOIN device_lease_epoch_allocations a USING (account_id, workspace_id, workflow_id)
      JOIN device_bootstrap_capabilities c USING (account_id, workspace_id, workflow_id)`))
      .toEqual([{ status: "failed", pending_lease_epoch: null, allocation: "burned", consumed_reason: "expired", highest: "2", drain_proofs: "1" }]);
  });

  it("refuses a forged, expired, or stale-stream proof and leaves the switch draining for a corrected one", async () => {
    const requestId = await openSwitch();
    const forged = await proofFor(requestId, "proof-forged", { key: drainProofKeyPair() });
    await expect(drains.submit(source, requestId, forged))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_PROOF_INVALID" });
    const expired = await proofFor(requestId, "proof-expired", { offsetSeconds: -900 });
    await expect(drains.submit(source, requestId, expired))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_PROOF_EXPIRED" });
    // Signed correctly but claiming no mutations, while Cloud already holds one: the seal refuses.
    const short = await proofFor(requestId, "proof-short", { emptyMutation: true });
    await expect(drains.submit(source, requestId, short))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_STREAMS_INCOMPLETE" });
    expect(await owner(`SELECT
        (SELECT string_agg(proof_id, ',' ORDER BY proof_id) FROM device_drain_proofs) AS proofs,
        (SELECT count(*) FROM device_drain_proofs WHERE consumed_at IS NOT NULL)::text AS consumed,
        ((SELECT count(*) FROM mutation_drain_seals) + (SELECT count(*) FROM execution_fact_drain_seals)
          + (SELECT count(*) FROM workspace_device_audit_drain_seals))::text AS seals,
        (SELECT status FROM device_switch_workflows) AS status`))
      .toEqual([{ proofs: "proof-short", consumed: "0", seals: "0", status: "draining" }]);

    await expect(drains.submit(source, requestId, await proofFor(requestId, "proof-short")))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_PROOF_INVALID" });
    await expect(drains.submit(source, requestId, await proofFor(requestId, "proof-fixed")))
      .resolves.toMatchObject({ accepted: true, request: { status: "bootstrapping" } });
  });

  it("gives the target device and other tenants no drain path, and keeps the proof table owner-written", async () => {
    const requestId = await openSwitch();
    const proof = await proofFor(requestId, "proof-one");
    await expect(drains.submit({ ...scope, deviceId: "device-new" }, requestId, proof))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_PROOF_INVALID" });
    await expect(drains.submit({ accountId: "switch-drain-other", workspaceId: scope.workspaceId, deviceId: "device-old" }, requestId, proof))
      .resolves.toEqual({ schemaVersion: 1, accepted: false, code: "DRAIN_PROOF_INVALID" });
    await expect(transactions.withTenant(scope, (transaction) => transaction.query(
      `INSERT INTO device_drain_proofs (account_id, workspace_id, proof_id, proof_digest, purpose, workflow_id,
         source_device_id, active_lease_epoch, signing_key_id, signing_key_version, issued_at, expires_at, verified_at,
         device_mutation_sequence, mutation_digest, execution_fact_sequence, execution_fact_digest,
         device_audit_sequence, device_audit_digest)
       VALUES ($1, $2, 'proof-direct', $3, 'handoff', $4, 'device-old', 1, 'key-old', 1, now(), now() + interval '1 minute',
         now(), 0, $3, 0, $3, 0, $3)`, [scope.accountId, scope.workspaceId, Buffer.alloc(32, 1), requestId])))
      .rejects.toMatchObject({ code: "42501" });
    expect(await owner("SELECT count(*)::text AS count FROM device_drain_proofs")).toEqual([{ count: "0" }]);
  });
});

async function openSwitch(): Promise<string> {
  const opened = await requests.requestNormal(source, { toDeviceId: "device-new", idempotencyKey: "idem-drain" });
  if (opened?.accepted !== true) throw new Error("fixture switch did not open");
  return opened.request.requestId;
}

async function proofFor(
  requestId: string,
  proofId: string,
  options: { key?: ReturnType<typeof drainProofKeyPair>; offsetSeconds?: number; emptyMutation?: boolean } = {},
): Promise<Record<string, unknown>> {
  const head = await owner(`SELECT rolling_digest FROM mutation_drain_heads
    WHERE source_device_id = 'device-old' AND active_lease_epoch = 1`) as { rolling_digest: Buffer }[];
  const digest = head[0]?.rolling_digest;
  if (digest === undefined) throw new Error("fixture mutation head is unavailable");
  const issued = Math.floor(Date.now() / 1000) - 30 + (options.offsetSeconds ?? 0);
  const second = (value: number) => new Date(value * 1000).toISOString().replace(/\.000Z$/u, "Z");
  const base = signedHandoffDrainProof(sourceKey.privateKey);
  const streams = base.streams as Record<string, unknown>[];
  const mutation = options.emptyMutation === true ? streams[1] : {
    ...streams[0], lastAssignedSequence: 1, contiguousReceivedThrough: 1, rollingDigest: digest.toString("base64url"),
  };
  // A v1 claim folds the raw recorded envelopes, which is what an owner-appended fixture record
  // has; v2 result-chain sealing is proven with real ingested results in workspace-mutation-persistence.
  return signedHandoffDrainProof((options.key ?? sourceKey).privateKey, {
    schemaVersion: 1, typ: "gd.drain-proof.v1", canonicalCodecVersion: 1,
    proofId, workspaceId: scope.workspaceId, sourceDeviceId: "device-old", activeLeaseEpoch: 1,
    signingKeyId: "key-old", signingKeyVersion: 1, deviceSwitchRequestId: requestId,
    issuedAt: second(issued), expiresAt: second(issued + 300),
    streams: [{ ...mutation, stream: "mutation" }, streams[1], streams[2]],
  });
}

async function seed(): Promise<void> {
  await owner(`INSERT INTO identity_accounts (account_id, email_normalized, password_policy_id, password_hash_phc)
    VALUES ($1, 'switch-drain@example.test', 'argon2id-v1', repeat('x', 80))`, [scope.accountId]);
  await owner(`INSERT INTO identity_account_security_states (account_id, account_security_epoch, status)
    VALUES ($1, 1, 'normal')`, [scope.accountId]);
  await owner(`INSERT INTO device_account_states
    (account_id, binding_list_revision, highest_allocated_lease_epoch, current_lease_epoch) VALUES ($1, 1, 1, 1)`, [scope.accountId]);
  await owner(`INSERT INTO workspace_revisions (account_id, workspace_id, workspace_schema_version)
    VALUES ($1, $2, 1)`, [scope.accountId, scope.workspaceId]);
  await owner(`INSERT INTO device_bindings (account_id, device_id, slot, status, credential_epoch)
    VALUES ($1, 'device-old', 1, 'bound', 1), ($1, 'device-new', 2, 'bound', 1)`, [scope.accountId]);
  await owner(`INSERT INTO device_signing_keys (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
    VALUES ($1, 'device-old', 1, 'key-old', $2, $3, 'active'), ($1, 'device-new', 1, 'key-new', $4, $5, 'active')`,
  [scope.accountId, sourceKey.rawPublicKey, Buffer.alloc(32, 2), Buffer.alloc(32, 3), Buffer.alloc(32, 4)]);
  await owner(`INSERT INTO device_lease_epoch_allocations (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
    VALUES ($1, $2, 'login', 1, 'activated', transaction_timestamp())`, [scope.accountId, scope.workspaceId]);
  await owner(`INSERT INTO device_active_leases
    (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
     offline_execute_until, signed_envelope, wire_envelope, signer_receipt_digest)
    VALUES ($1, 1, 'device-old', 'switch-drain-lease', transaction_timestamp() - interval '10 minutes',
      transaction_timestamp() - interval '9 minutes', transaction_timestamp() + interval '5 minutes',
      transaction_timestamp() + interval '1 hour', decode('01', 'hex'),
      jsonb_build_object('fixture', 'device-switch-drain'), pg_catalog.sha256(decode('01', 'hex')))`, [scope.accountId]);
  await owner(`SELECT public.workspace_mutation_drain_append_record($1::text, 1::bigint, 1::bigint, $2::bytea)`,
    ["device-old", mutationEnvelope]);
}

/** Fixtures and probes run as the migration owner; production calls use `transactions`. */
async function owner(sql: string, values: unknown[] = []): Promise<unknown[]> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [scope.accountId]);
    await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result.rows;
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
