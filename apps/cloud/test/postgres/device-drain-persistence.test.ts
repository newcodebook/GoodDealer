import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runCloudMigrations, TenantTransactionRunner, type TenantTransaction } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import { PostgresWorkspaceDeviceAuditDrainLedger } from "../../src/modules/audit/index";
import {
  PostgresDeviceDrainTransition,
  type PostgresDrainFaultPoint,
} from "../../src/modules/devices/index";
import { PostgresExecutionFactDrainLedger } from "../../src/modules/execution-ledger/index";
import { PostgresIdentityAccountSecurityStatePort } from "../../src/modules/identity/index";
import { PostgresMutationDrainLedger } from "../../src/modules/workspace/mutations/index";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 12 });
const reusePool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 1 });
const transactions = new TenantTransactionRunner(appPool);
const reuseTransactions = new TenantTransactionRunner(reusePool);
const scope = { accountId: "drain-account", workspaceId: "drain-workspace" } as const;
const proofDigest = Buffer.alloc(32, 9).toString("base64url");
const mutationFixtureEnvelope = Buffer.from("drain-fixture-mutation", "utf8");
const executionFixtureEnvelope = Buffer.from("drain-fixture-execution", "utf8");
const auditFixtureEnvelope = Buffer.from("drain-fixture-audit", "utf8");

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
  const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC !== "true") {
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  } else {
    console.warn(`UNQUALIFIED PostgreSQL diagnostic only: ${version.rows[0]?.server_version ?? "unknown"}`);
  }
});

beforeEach(resetAndSeed);

afterAll(async () => { await Promise.all([ownerPool.end(), appPool.end(), reusePool.end()]); });

describe("persistent device Drain transition", () => {
  it("atomically consumes one proof, installs exactly three seals, releases Lease, burns forward, and does not retire a cursor", async () => {
    const service = createService();
    const first = await service.commit(request("capability-one"));
    expect(first).toEqual({
      status: "bootstrapping",
      workflowId: "workflow-one",
      workflowRevision: 4,
      pendingLeaseEpoch: 2,
      bootstrapCapabilityJti: "capability-one",
      bootstrapIssuedAt: expect.stringMatching(/Z$/u),
      bootstrapExpiresAt: expect.stringMatching(/Z$/u),
    });
    await expect(service.commit(request("capability-one"))).resolves.toEqual(first);

    const state = await transactions.withTenant(scope, (transaction) => transaction.query<{
      current_lease_epoch: string; highest_allocated_lease_epoch: string; released: boolean;
      proof_consumed: boolean; mutation_seals: string; execution_seals: string; audit_seals: string; cursors: string;
    }>(`
      SELECT s.current_lease_epoch, s.highest_allocated_lease_epoch,
        l.released_at IS NOT NULL AS released, p.consumed_at IS NOT NULL AS proof_consumed,
        (SELECT count(*) FROM mutation_drain_seals)::text AS mutation_seals,
        (SELECT count(*) FROM execution_fact_drain_seals)::text AS execution_seals,
        (SELECT count(*) FROM workspace_device_audit_drain_seals)::text AS audit_seals,
        (SELECT count(*) FROM workspace_device_cursors)::text AS cursors
      FROM device_account_states s
      JOIN device_active_leases l USING (account_id)
      JOIN device_drain_proofs p USING (account_id)
      WHERE s.account_id = $1`, [scope.accountId]));
    expect(state.rows[0]).toMatchObject({
      current_lease_epoch: "1",
      highest_allocated_lease_epoch: "2",
      released: true,
      proof_consumed: true,
      mutation_seals: "1",
      execution_seals: "1",
      audit_seals: "1",
      cursors: "0",
    });
  });

  it("rolls back every write boundary and never reuses the burned-forward epoch", async () => {
    const points: readonly PostgresDrainFaultPoint[] = [
      "after_proof_consumption", "after_mutation_seal", "after_execution_fact_seal",
      "after_device_audit_seal", "after_lease_release", "after_epoch_allocation",
      "after_capability_creation", "after_workflow_transition",
    ];
    for (const point of points) {
      await resetAndSeed();
      const service = createService((seen) => { if (seen === point) throw new Error(`fault:${point}`); });
      await expect(service.commit(request("fault-capability"))).rejects.toThrow(`fault:${point}`);
      const unchanged = await transactions.withTenant(scope, (transaction) => transaction.query<{
        highest: string; held: boolean; consumed: boolean; allocations: string; capabilities: string; seals: string;
      }>(`
        SELECT s.highest_allocated_lease_epoch AS highest, l.released_at IS NULL AS held,
          p.consumed_at IS NOT NULL AS consumed,
          (SELECT count(*) FROM device_lease_epoch_allocations WHERE lease_epoch > 1)::text AS allocations,
          (SELECT count(*) FROM device_bootstrap_capabilities)::text AS capabilities,
          ((SELECT count(*) FROM mutation_drain_seals) + (SELECT count(*) FROM execution_fact_drain_seals)
            + (SELECT count(*) FROM workspace_device_audit_drain_seals))::text AS seals
        FROM device_account_states s JOIN device_active_leases l USING (account_id)
        JOIN device_drain_proofs p USING (account_id) WHERE s.account_id = $1`, [scope.accountId]));
      expect(unchanged.rows[0]).toEqual({ highest: "1", held: true, consumed: false, allocations: "0", capabilities: "0", seals: "0" });
    }
  });

  it("fails closed on gaps, digest drift, stale Lease epoch, and conflicting replay with no partial commit", async () => {
    const probes: readonly (() => Promise<void>)[] = [
      () => withOwnerTenant(scope, (transaction) => transaction.query(
        `SELECT public.workspace_mutation_drain_append_record(
          $1::text, 1::bigint, 2::bigint, $2::bytea
        )`, ["device-old", Buffer.from("drain-fixture-mutation-gap", "utf8")])).then(() => undefined),
      () => withOwnerTenant(scope, (transaction) => transaction.query(
        "UPDATE device_drain_proofs SET execution_fact_digest = decode(repeat('00', 32), 'hex')")).then(() => undefined),
      () => withOwnerTenant(scope, (transaction) => transaction.query(
        "UPDATE device_drain_proofs SET active_lease_epoch = 2")).then(() => undefined),
    ];
    for (const mutate of probes) {
      await resetAndSeed();
      await mutate();
      const result = await createService().commit(request("rejected-capability"));
      expect(result.status).toBe("rejected");
      await expectNoDrainWrites();
    }
    await resetAndSeed();
    const service = createService();
    await expect(service.commit(request("stable-capability"))).resolves.toMatchObject({ status: "bootstrapping" });
    await expect(service.commit(request("different-capability"))).resolves.toEqual({ status: "rejected", reason: "PROOF_REPLAY_CONFLICT" });
  });

  it("does not materialize execution ledger rows for an unconsumed or mismatched proof", async () => {
    await clearExecutionFactDrainDomain();

    const invalid = await transactions.withTenant(scope, (transaction) => transaction.query<{ installed: boolean }>(
      "SELECT public.execution_fact_drain_install_accepted_seal($1::text) AS installed",
      ["proof-one"],
    ));
    expect(invalid.rows).toEqual([{ installed: false }]);
    await expectExecutionFactDrainDomainCounts({ heads: "0", records: "0", seals: "0" });

    await withOwnerTenant(scope, (transaction) => transaction.query(
      `UPDATE device_drain_proofs
       SET execution_fact_sequence = 1,
           execution_fact_digest = decode(repeat('00', 32), 'hex')
       WHERE account_id = $1 AND workspace_id = $2 AND proof_id = 'proof-one'`,
      [scope.accountId, scope.workspaceId],
    ));
    const mismatched = await transactions.withTenant(scope, async (transaction) => {
      const consumed = await transaction.query<{ accepted: boolean }>(`
        SELECT accepted FROM public.device_consume_drain_proof(
          $1::text, $2::bytea, $3::text, $4::bigint, $5::text
        )`, ["proof-one", Buffer.from(proofDigest, "base64url"), "workflow-one", 3, "device-new"]);
      const installed = await transaction.query<{ installed: boolean }>(
        "SELECT public.execution_fact_drain_install_accepted_seal($1::text) AS installed",
        ["proof-one"],
      );
      return { accepted: consumed.rows[0]?.accepted, installed: installed.rows[0]?.installed };
    });
    expect(mismatched).toEqual({ accepted: true, installed: false });
    await expectExecutionFactDrainDomainCounts({ heads: "0", records: "0", seals: "0" });
  });

  it("seals a matching execution proof once and preserves exact in-transaction replay idempotency", async () => {
    const result = await transactions.withTenant(scope, async (transaction) => {
      const consumed = await transaction.query<{ accepted: boolean }>(`
        SELECT accepted FROM public.device_consume_drain_proof(
          $1::text, $2::bytea, $3::text, $4::bigint, $5::text
        )`, ["proof-one", Buffer.from(proofDigest, "base64url"), "workflow-one", 3, "device-new"]);
      const first = await transaction.query<{ installed: boolean }>(
        "SELECT public.execution_fact_drain_install_accepted_seal($1::text) AS installed",
        ["proof-one"],
      );
      const replay = await transaction.query<{ installed: boolean }>(
        "SELECT public.execution_fact_drain_install_accepted_seal($1::text) AS installed",
        ["proof-one"],
      );
      return {
        accepted: consumed.rows[0]?.accepted,
        first: first.rows[0]?.installed,
        replay: replay.rows[0]?.installed,
      };
    });
    expect(result).toEqual({ accepted: true, first: true, replay: true });
    await expectExecutionFactDrainDomainCounts({ heads: "1", records: "1", seals: "1" });
  });

  it("does not materialize audit ledger evidence for unconsumed or mismatched proofs in-flight or after commit", async () => {
    await clearAuditDrainDomain();

    const invalid = await transactions.withTenant(scope, async (transaction) => {
      const installed = await transaction.query<{ installed: boolean }>(
        "SELECT public.audit_install_workspace_device_drain_seal($1::text) AS installed",
        ["proof-one"],
      );
      const state = await readAuditDrainDomainState(transaction);
      return { installed: installed.rows[0]?.installed, state: state.rows[0] };
    });
    expect(invalid).toEqual({
      installed: false,
      state: { heads: "0", records: "0", seals: "0", proofConsumed: false, forked: false },
    });
    await expectAuditDrainDomainState({
      heads: "0", records: "0", seals: "0", proofConsumed: false, forked: false,
    });

    await withOwnerTenant(scope, (transaction) => transaction.query(
      `UPDATE device_drain_proofs
       SET device_audit_sequence = 1,
           device_audit_digest = decode(repeat('00', 32), 'hex')
       WHERE account_id = $1 AND workspace_id = $2 AND proof_id = 'proof-one'`,
      [scope.accountId, scope.workspaceId],
    ));
    const mismatched = await transactions.withTenant(scope, async (transaction) => {
      const consumed = await consumeDrainProof(transaction);
      const installed = await transaction.query<{ installed: boolean }>(
        "SELECT public.audit_install_workspace_device_drain_seal($1::text) AS installed",
        ["proof-one"],
      );
      const state = await readAuditDrainDomainState(transaction);
      return {
        accepted: consumed.rows[0]?.accepted,
        installed: installed.rows[0]?.installed,
        state: state.rows[0],
      };
    });
    expect(mismatched).toEqual({
      accepted: true,
      installed: false,
      state: { heads: "0", records: "0", seals: "0", proofConsumed: true, forked: false },
    });
    await expectAuditDrainDomainState({
      heads: "0", records: "0", seals: "0", proofConsumed: true, forked: false,
    });
  });

  it("seals a matching audit proof once and preserves exact in-transaction replay idempotency", async () => {
    const result = await transactions.withTenant(scope, async (transaction) => {
      const consumed = await consumeDrainProof(transaction);
      const first = await transaction.query<{ installed: boolean }>(
        "SELECT public.audit_install_workspace_device_drain_seal($1::text) AS installed",
        ["proof-one"],
      );
      const replay = await transaction.query<{ installed: boolean }>(
        "SELECT public.audit_install_workspace_device_drain_seal($1::text) AS installed",
        ["proof-one"],
      );
      const state = await readAuditDrainDomainState(transaction);
      return {
        accepted: consumed.rows[0]?.accepted,
        first: first.rows[0]?.installed,
        replay: replay.rows[0]?.installed,
        state: state.rows[0],
      };
    });
    expect(result).toEqual({
      accepted: true,
      first: true,
      replay: true,
      state: { heads: "1", records: "1", seals: "1", proofConsumed: true, forked: false },
    });
    await expectAuditDrainDomainState({
      heads: "1", records: "1", seals: "1", proofConsumed: true, forked: false,
    });
  });

  it("rejects a forked audit domain without adding a seal or changing proof consumption", async () => {
    await withOwnerTenant(scope, (transaction) => appendAuditRecord(transaction, {
      sourceDeviceId: "device-old",
      activeLeaseEpoch: 1,
      auditSequence: 2,
      chainId: "chain-two",
      envelope: Buffer.from("drain-fixture-audit-fork", "utf8"),
    }));

    const rejected = await transactions.withTenant(scope, async (transaction) => {
      const consumed = await consumeDrainProof(transaction);
      const installed = await transaction.query<{ installed: boolean }>(
        "SELECT public.audit_install_workspace_device_drain_seal($1::text) AS installed",
        ["proof-one"],
      );
      const state = await readAuditDrainDomainState(transaction);
      return {
        accepted: consumed.rows[0]?.accepted,
        installed: installed.rows[0]?.installed,
        state: state.rows[0],
      };
    });
    expect(rejected).toEqual({
      accepted: true,
      installed: false,
      state: { heads: "1", records: "2", seals: "0", proofConsumed: true, forked: true },
    });
    await expectAuditDrainDomainState({
      heads: "1", records: "2", seals: "0", proofConsumed: true, forked: true,
    });
  });

  it("serializes concurrent winners and survives fixed-order contention without deadlock", async () => {
    const service = createService();
    const winners = await Promise.all([
      service.commit(request("winner-a")),
      service.commit(request("winner-b")),
    ]);
    expect(winners.filter(({ status }) => status === "bootstrapping")).toHaveLength(1);
    expect(winners.filter((result) => result.status === "rejected" && result.reason === "PROOF_REPLAY_CONFLICT")).toHaveLength(1);

    await resetAndSeed();
    const contention = createService();
    const results = await Promise.all(Array.from({ length: 10 }, () => contention.commit(request("same-replay"))));
    expect(results.every((result) => result.status === "bootstrapping")).toBe(true);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
  });

  it("fails closed for missing or wrong tenant scope and clears pooled selectors after commit and rollback", async () => {
    const missing = await reusePool.query<{ count: string }>("SELECT count(*)::text AS count FROM device_switch_workflows");
    expect(missing.rows[0]?.count).toBe("0");
    await expect(reusePool.query(
      `INSERT INTO workspace_device_cursors (account_id, workspace_id, device_id, cursor_generation, acknowledged_through_server_revision, status)
       VALUES ('drain-account', 'drain-workspace', 'scope-bypass', 1, 0, 'active')`,
    )).rejects.toMatchObject({ code: "42501" });

    await expect(createService().commit({ ...request("wrong-workspace"), workspaceId: "other-workspace" }))
      .resolves.toEqual({ status: "rejected", reason: "PROOF_CONFLICT" });
    await expect(createService().commit({ ...request("wrong-account"), accountId: "other-account" }))
      .resolves.toEqual({ status: "rejected", reason: "ACCOUNT_SECURITY_CONFLICT" });
    await expectNoDrainWrites();

    await reuseTransactions.withTenant(scope, async (transaction) => {
      const visible = await transaction.query("SELECT 1 FROM device_switch_workflows");
      expect(visible.rowCount).toBe(1);
    });
    await expect(reuseTransactions.withTenant(scope, async () => { throw new Error("rollback-scope-probe"); }))
      .rejects.toThrow("rollback-scope-probe");
    const residue = await reusePool.query<{ account_id: string | null; workspace_id: string | null }>(
      `SELECT nullif(current_setting('gooddealer.account_id', true), '') AS account_id,
              nullif(current_setting('gooddealer.workspace_id', true), '') AS workspace_id`,
    );
    expect(residue.rows[0]).toEqual({ account_id: null, workspace_id: null });
  });

  it("isolates the same workspace, workflow, and device ids across two accounts", async () => {
    const other = { accountId: "drain-account-two", workspaceId: scope.workspaceId } as const;
    await seedWorkspaceRevision(other, 7);
    await transactions.withTenant(other, async (transaction) => {
      await transaction.query(`INSERT INTO identity_accounts
        (account_id, email_normalized, password_policy_id, password_hash_phc)
        VALUES ($1, 'drain-account-two@example.test', 'argon2id-v1', repeat('x', 80))`, [other.accountId]);
      await transaction.query(`INSERT INTO identity_account_security_states
        (account_id, account_security_epoch, status) VALUES ($1, 1, 'normal')`, [other.accountId]);
      await transaction.query("INSERT INTO device_account_states (account_id) VALUES ($1)", [other.accountId]);
      await transaction.query(`INSERT INTO device_bindings (account_id, device_id, slot, status, credential_epoch)
        VALUES ($1, 'device-old', 1, 'bound', 1), ($1, 'device-new', 2, 'bound', 1)`, [other.accountId]);
      await transaction.query(`INSERT INTO workspace_device_cursors
        (account_id, workspace_id, device_id, cursor_generation, acknowledged_through_server_revision, status)
        VALUES ($1, $2, 'device-old', 1, 7, 'active')`, [other.accountId, other.workspaceId]);
    });
    await seedWorkspaceRevision(scope, 3);
    await transactions.withTenant(scope, async (transaction) => {
      await transaction.query(`INSERT INTO workspace_device_cursors
        (account_id, workspace_id, device_id, cursor_generation, acknowledged_through_server_revision, status)
        VALUES ($1, $2, 'device-old', 1, 3, 'active')`, [scope.accountId, scope.workspaceId]);
    });
    const first = await transactions.withTenant(scope, (transaction) => transaction.query<{ acknowledged_through_server_revision: string }>(
      "SELECT acknowledged_through_server_revision FROM workspace_device_cursors WHERE device_id = 'device-old'"));
    const second = await transactions.withTenant(other, (transaction) => transaction.query<{ acknowledged_through_server_revision: string }>(
      "SELECT acknowledged_through_server_revision FROM workspace_device_cursors WHERE device_id = 'device-old'"));
    expect(first.rows).toEqual([{ acknowledged_through_server_revision: "3" }]);
    expect(second.rows).toEqual([{ acknowledged_through_server_revision: "7" }]);
  });

  it("observes non-privileged roles and ENABLE plus FORCE RLS on every persistence table", async () => {
    const roles = await ownerPool.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
       WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner') ORDER BY rolname`,
    );
    expect(roles.rows).toEqual([
      { rolname: "gooddealer_cloud_app", rolsuper: false, rolbypassrls: false },
      { rolname: "gooddealer_cloud_owner", rolsuper: false, rolbypassrls: false },
    ]);
    const rls = await ownerPool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = ANY($1::text[]) ORDER BY relname`, [DEVICE_PERSISTENCE_TABLES],
    );
    expect(rls.rows).toHaveLength(DEVICE_PERSISTENCE_TABLES.length);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it("fails closed for quarantined audit evidence, preserves clean owner duplicates, and denies app-supplied audit claims", async () => {
    const clean = {
      sourceDeviceId: "audit-clean-device",
      activeLeaseEpoch: 9,
      auditSequence: 1,
      chainId: "audit-clean-chain",
      envelope: Buffer.from("audit-clean-envelope", "utf8"),
    } as const;
    const first = await withOwnerTenant(scope, (transaction) => appendAuditRecord(transaction, clean));
    const duplicate = await withOwnerTenant(scope, (transaction) => appendAuditRecord(transaction, clean));
    expect(first.rows).toEqual([{ appended: true }]);
    expect(duplicate.rows).toEqual([{ appended: true }]);

    const quarantined = {
      sourceDeviceId: "audit-quarantined-device",
      activeLeaseEpoch: 10,
      auditSequence: 1,
      chainId: "audit-quarantined-chain",
      envelope: Buffer.from("audit-quarantined-envelope", "utf8"),
    } as const;
    await withOwnerTenant(scope, (transaction) => transaction.query(`INSERT INTO workspace_device_audit_drain_records
      (account_id, workspace_id, source_device_id, active_lease_epoch, audit_sequence, chain_id,
       event_hash, canonical_envelope, envelope_digest, quarantine_reason)
      VALUES ($1, $2, $3, $4, $5, $6, pg_catalog.sha256($7::bytea), $7::bytea,
       pg_catalog.sha256($7::bytea), 'sequence_replay')`, [
      scope.accountId, scope.workspaceId, quarantined.sourceDeviceId, quarantined.activeLeaseEpoch,
      quarantined.auditSequence, quarantined.chainId, quarantined.envelope,
    ]));
    await expect(withOwnerTenant(scope, (transaction) => appendAuditRecord(transaction, quarantined)))
      .rejects.toMatchObject({ code: "23505" });
    await expect(withOwnerTenant(scope, (transaction) => transaction.query(
      "SELECT 1 FROM public.audit_recompute_workspace_device_drain_head($1::text, $2::bigint)",
      [quarantined.sourceDeviceId, quarantined.activeLeaseEpoch],
    ))).rejects.toMatchObject({ code: "22000" });

    // These claims deliberately differ from the seeded proof; the app cannot call the pre-consumption append routine.
    const callerOverride = {
      sourceDeviceId: "audit-caller-override-device",
      activeLeaseEpoch: 77,
      auditSequence: 99,
      chainId: "audit-caller-override-chain",
      envelope: Buffer.from("audit-caller-override-envelope", "utf8"),
    } as const;
    await expect(transactions.withTenant(scope, (transaction) => appendAuditRecord(transaction, callerOverride)))
      .rejects.toMatchObject({ code: "42501" });
    const absent = await transactions.withTenant(scope, (transaction) => transaction.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM workspace_device_audit_drain_records WHERE source_device_id = $1",
      [callerOverride.sourceDeviceId],
    ));
    expect(absent.rows).toEqual([{ count: "0" }]);

    const routineAcl = await ownerPool.query<{ append_allowed: boolean; seal_allowed: boolean }>(`
      SELECT pg_catalog.has_function_privilege(
        'gooddealer_cloud_app',
        'public.audit_append_workspace_device_drain_record(text, bigint, bigint, text, bytea, bytea, bytea)',
        'EXECUTE'
      ) AS append_allowed,
      pg_catalog.has_function_privilege(
        'gooddealer_cloud_app',
        'public.audit_install_workspace_device_drain_seal(text)',
        'EXECUTE'
      ) AS seal_allowed`);
    expect(routineAcl.rows).toEqual([{ append_allowed: false, seal_allowed: true }]);
  });

  it("rejects security epoch, recovery, deadline, audit fork, key, and binding drift with no partial commit", async () => {
    const probes: readonly [string, () => Promise<unknown>, string][] = [
      ["security epoch", () => tenantUpdate("UPDATE identity_account_security_states SET account_security_epoch = 2"), "ACCOUNT_SECURITY_CONFLICT"],
      ["recovery status", () => tenantUpdate("UPDATE identity_account_security_states SET status = 'recovery_pending'"), "ACCOUNT_SECURITY_CONFLICT"],
      ["workflow deadline", () => tenantUpdate("UPDATE device_switch_workflows SET state_deadline = transaction_timestamp() - interval '1 second'"), "WORKFLOW_EXPIRED"],
      ["audit fork", () => withOwnerTenant(scope, (transaction) => transaction.query(
        `SELECT public.audit_append_workspace_device_drain_record(
          $1::text, 1::bigint, 2::bigint, 'chain-two'::text,
          pg_catalog.sha256($2::bytea), $2::bytea, pg_catalog.sha256($2::bytea)
        )`, ["device-old", Buffer.from("drain-fixture-audit-fork", "utf8")])).then(() => undefined), "STREAM_HEAD_CONFLICT"],
      ["key status", () => tenantUpdate("UPDATE device_signing_keys SET status = 'revoked', retired_at = transaction_timestamp()"), "SIGNING_KEY_CONFLICT"],
      ["binding status", () => tenantUpdate(`UPDATE device_bindings SET status = 'removed', slot = NULL,
        removed_at = transaction_timestamp(), removal_reason = 'test' WHERE device_id = 'device-new'`), "BINDING_CONFLICT"],
    ];
    for (const [name, mutate, reason] of probes) {
      await resetAndSeed();
      await mutate();
      await expect(createService().commit(request(`drift-${name.replaceAll(" ", "-")}`)))
        .resolves.toEqual({ status: "rejected", reason });
      await expectNoDrainWrites();
    }
  });

  it("times out behind a realistic earlier identity lock without deadlock or partial commit", async () => {
    const blocker = await appPool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT set_config('gooddealer.account_id', $1, true)", [scope.accountId]);
      await blocker.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);
      await blocker.query("SELECT 1 FROM identity_account_security_states WHERE account_id = $1 FOR UPDATE", [scope.accountId]);
      await expect(createService().commit(request("lock-timeout"))).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await expectNoDrainWrites();
  });
});

const DEVICE_PERSISTENCE_TABLES = [
  "device_account_states", "device_active_leases", "device_bindings", "device_bootstrap_capabilities",
  "device_bootstrap_steps", "device_drain_proofs", "device_identity_challenges", "device_lease_epoch_allocations",
  "device_signing_keys", "device_switch_workflows", "execution_fact_drain_heads", "execution_fact_drain_records",
  "execution_fact_drain_seals", "mutation_drain_heads", "mutation_drain_records", "mutation_drain_seals",
  "workspace_device_audit_drain_heads", "workspace_device_audit_drain_records",
  "workspace_device_audit_drain_seals", "workspace_device_cursors",
] as const;

function tenantUpdate(sql: string): Promise<unknown> {
  return withOwnerTenant(scope, (transaction) => transaction.query(sql));
}

/** Fixtures and drift probes use the migration owner; production calls use `transactions`. */
async function withOwnerTenant<Result>(
  value: TenantTransaction["scope"],
  operation: (transaction: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  const client = await ownerPool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [value.accountId]);
    await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [value.workspaceId]);
    const result = await operation({
      scope: value,
      query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
    });
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function createService(fault?: (point: PostgresDrainFaultPoint) => void): PostgresDeviceDrainTransition {
  return new PostgresDeviceDrainTransition(
    transactions,
    new PostgresIdentityAccountSecurityStatePort(),
    new PostgresMutationDrainLedger(),
    new PostgresExecutionFactDrainLedger(),
    new PostgresWorkspaceDeviceAuditDrainLedger(),
    fault,
  );
}

function request(bootstrapCapabilityJti: string) {
  return {
    ...scope,
    workflowId: "workflow-one",
    expectedWorkflowRevision: 3,
    targetDeviceId: "device-new",
    proofId: "proof-one",
    proofDigest,
    bootstrapCapabilityJti,
  } as const;
}

function appendAuditRecord(
  transaction: TenantTransaction,
  input: {
    readonly sourceDeviceId: string;
    readonly activeLeaseEpoch: number;
    readonly auditSequence: number;
    readonly chainId: string;
    readonly envelope: Buffer;
  },
) {
  return transaction.query<{ appended: boolean }>(`
    SELECT public.audit_append_workspace_device_drain_record(
      $1::text, $2::bigint, $3::bigint, $4::text,
      pg_catalog.sha256($5::bytea), $5::bytea, pg_catalog.sha256($5::bytea)
    ) AS appended`, [
    input.sourceDeviceId, input.activeLeaseEpoch, input.auditSequence, input.chainId, input.envelope,
  ]);
}

function consumeDrainProof(transaction: TenantTransaction) {
  return transaction.query<{ accepted: boolean }>(`
    SELECT accepted FROM public.device_consume_drain_proof(
      $1::text, $2::bytea, $3::text, $4::bigint, $5::text
    )`, ["proof-one", Buffer.from(proofDigest, "base64url"), "workflow-one", 3, "device-new"]);
}

async function resetAndSeed(): Promise<void> {
  await ownerPool.query(`TRUNCATE
    workspace_device_cursors, workspace_device_audit_drain_seals, workspace_device_audit_drain_records,
    workspace_device_audit_drain_heads, execution_fact_drain_seals, execution_fact_drain_records,
    execution_fact_drain_heads, mutation_drain_seals, mutation_drain_records, mutation_drain_heads,
    device_bootstrap_steps, device_bootstrap_capabilities, device_drain_proofs, device_active_leases,
    device_lease_epoch_allocations, device_switch_workflows, device_identity_challenges,
    device_signing_keys, device_bindings, device_account_states, workspace_revisions, identity_accounts CASCADE`);
  await withOwnerTenant(scope, async (transaction) => {
    await transaction.query(`INSERT INTO identity_accounts
      (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ($1, 'drain-account@example.test', 'argon2id-v1', repeat('x', 80))`, [scope.accountId]);
    await transaction.query(`INSERT INTO identity_account_security_states
      (account_id, account_security_epoch, status) VALUES ($1, 1, 'normal')`, [scope.accountId]);
    await transaction.query(`INSERT INTO device_account_states
      (account_id, binding_list_revision, highest_allocated_lease_epoch, current_lease_epoch)
      VALUES ($1, 1, 1, 1)`, [scope.accountId]);
    await transaction.query(`INSERT INTO workspace_revisions
      (account_id, workspace_id, workspace_schema_version)
      VALUES ($1, $2, 1)`, [scope.accountId, scope.workspaceId]);
    await transaction.query(`INSERT INTO device_bindings (account_id, device_id, slot, status, credential_epoch)
      VALUES ($1, 'device-old', 1, 'bound', 1), ($1, 'device-new', 2, 'bound', 1)`, [scope.accountId]);
    await transaction.query(`INSERT INTO device_signing_keys
      (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ($1, 'device-old', 1, 'key-old', $2, $3, 'active')`, [scope.accountId, Buffer.alloc(32, 3), Buffer.alloc(32, 4)]);
    await transaction.query(`INSERT INTO device_switch_workflows
      (account_id, workspace_id, workflow_id, purpose, mode, request_digest, idempotency_key, status,
       workflow_revision, from_device_id, to_device_id, bound_key_id, bound_key_version,
       bound_account_security_epoch, state_deadline)
      VALUES ($1, $2, 'workflow-one', 'device_switch', 'normal', $3, 'idem-one', 'draining',
        3, 'device-old', 'device-new', 'key-old', 1, 1, transaction_timestamp() + interval '1 hour')`,
      [scope.accountId, scope.workspaceId, Buffer.alloc(32, 5)]);
    await transaction.query(`INSERT INTO device_lease_epoch_allocations
      (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
      VALUES ($1, $2, 'old-workflow', 1, 'activated', transaction_timestamp())`, [scope.accountId, scope.workspaceId]);
    await transaction.query(`INSERT INTO device_active_leases
      (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
       offline_execute_until, signed_envelope)
      VALUES ($1, 1, 'device-old', 'old-lease-jti', transaction_timestamp() - interval '10 minutes',
       transaction_timestamp() - interval '9 minutes', transaction_timestamp() + interval '5 minutes',
       transaction_timestamp() + interval '1 hour', decode('01', 'hex'))`, [scope.accountId]);
    await transaction.query(`SELECT public.workspace_mutation_drain_append_record(
      $1::text, 1::bigint, 1::bigint, $2::bytea
    )`, ["device-old", mutationFixtureEnvelope]);
    await transaction.query(`SELECT public.execution_fact_drain_append_record(
      $1::text, 1::bigint, 1::bigint, $2::bytea, pg_catalog.sha256($2::bytea), 'current'::text, NULL::text
    )`, ["device-old", executionFixtureEnvelope]);
    await transaction.query(`SELECT public.audit_append_workspace_device_drain_record(
      $1::text, 1::bigint, 1::bigint, 'chain-one'::text,
      pg_catalog.sha256($2::bytea), $2::bytea, pg_catalog.sha256($2::bytea)
    )`, ["device-old", auditFixtureEnvelope]);
    const mutationHead = await transaction.query<{ rolling_digest: Buffer }>(`
      SELECT rolling_digest FROM mutation_drain_heads
      WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1`,
      [scope.accountId, scope.workspaceId]);
    const executionHead = await transaction.query<{ rolling_digest: Buffer }>(`
      SELECT rolling_digest FROM execution_fact_drain_heads
      WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1`,
      [scope.accountId, scope.workspaceId]);
    const auditHead = await transaction.query<{ rolling_digest: Buffer }>(`
      SELECT rolling_digest FROM workspace_device_audit_drain_heads
      WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1`,
      [scope.accountId, scope.workspaceId]);
    const mutationDigest = mutationHead.rows[0]?.rolling_digest;
    const executionDigest = executionHead.rows[0]?.rolling_digest;
    const auditDigest = auditHead.rows[0]?.rolling_digest;
    if (mutationDigest === undefined || executionDigest === undefined || auditDigest === undefined) {
      throw new Error("fixture drain head is unavailable");
    }
    await transaction.query(`INSERT INTO device_drain_proofs
      (account_id, workspace_id, proof_id, proof_digest, purpose, workflow_id, source_device_id,
       active_lease_epoch, signing_key_id, signing_key_version, issued_at, expires_at, verified_at,
       device_mutation_sequence, mutation_digest, execution_fact_sequence, execution_fact_digest,
       device_audit_sequence, device_audit_digest)
      VALUES ($1, $2, 'proof-one', $3, 'handoff', 'workflow-one', 'device-old', 1, 'key-old', 1,
       transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '5 minutes',
       transaction_timestamp(), 1, $4, 1, $5, 1, $6)`,
      [scope.accountId, scope.workspaceId, Buffer.from(proofDigest, "base64url"),
        mutationDigest, executionDigest, auditDigest]);
  });
}

async function seedWorkspaceRevision(
  tenant: { readonly accountId: string; readonly workspaceId: string },
  serverRevision: number,
): Promise<void> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE workspace_revisions DISABLE TRIGGER workspace_revisions_initial_state_guard");
    await client.query("ALTER TABLE workspace_revisions DISABLE TRIGGER workspace_revisions_dense_mutation_guard");
    await client.query(
      `INSERT INTO workspace_revisions (account_id, workspace_id, workspace_schema_version, server_revision)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (account_id, workspace_id) DO UPDATE SET server_revision = EXCLUDED.server_revision`,
      [tenant.accountId, tenant.workspaceId, serverRevision],
    );
    await client.query("ALTER TABLE workspace_revisions ENABLE TRIGGER workspace_revisions_dense_mutation_guard");
    await client.query("ALTER TABLE workspace_revisions ENABLE TRIGGER workspace_revisions_initial_state_guard");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function expectNoDrainWrites(): Promise<void> {
  const result = await transactions.withTenant(scope, (transaction) => transaction.query<{
    consumed: boolean; held: boolean; highest: string; seals: string;
  }>(`
    SELECT p.consumed_at IS NOT NULL AS consumed, l.released_at IS NULL AS held,
      s.highest_allocated_lease_epoch AS highest,
      ((SELECT count(*) FROM mutation_drain_seals) + (SELECT count(*) FROM execution_fact_drain_seals)
       + (SELECT count(*) FROM workspace_device_audit_drain_seals))::text AS seals
    FROM device_drain_proofs p JOIN device_active_leases l USING (account_id)
    JOIN device_account_states s USING (account_id) WHERE p.account_id = $1`, [scope.accountId]));
  expect(result.rows[0]).toEqual({ consumed: false, held: true, highest: "1", seals: "0" });
}

/** Owner-only fixture setup isolates the execution domain; app-role probes never write ledger tables directly. */
async function clearExecutionFactDrainDomain(): Promise<void> {
  await ownerPool.query(`TRUNCATE
    public.execution_fact_drain_seals, public.execution_fact_drain_records, public.execution_fact_drain_heads`);
}

/** Direct app-role seal probes may only observe audit evidence; fixtures clear it as the owner. */
async function clearAuditDrainDomain(): Promise<void> {
  await ownerPool.query(`TRUNCATE
    public.workspace_device_audit_drain_seals, public.workspace_device_audit_drain_records,
    public.workspace_device_audit_drain_heads`);
}

function readAuditDrainDomainState(transaction: TenantTransaction) {
  return transaction.query<{
    heads: string; records: string; seals: string; proofConsumed: boolean; forked: boolean;
  }>(`
    SELECT
      (SELECT count(*) FROM public.workspace_device_audit_drain_heads
       WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1)::text AS heads,
      (SELECT count(*) FROM public.workspace_device_audit_drain_records
       WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1)::text AS records,
      (SELECT count(*) FROM public.workspace_device_audit_drain_seals
       WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1)::text AS seals,
      EXISTS (
        SELECT 1 FROM public.device_drain_proofs
        WHERE account_id = $1 AND workspace_id = $2 AND proof_id = 'proof-one' AND consumed_at IS NOT NULL
      ) AS "proofConsumed",
      COALESCE((
        SELECT bool_or(forked) FROM public.workspace_device_audit_drain_heads
        WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1
      ), false) AS forked`, [scope.accountId, scope.workspaceId]);
}

async function expectAuditDrainDomainState(expected: {
  readonly heads: string;
  readonly records: string;
  readonly seals: string;
  readonly proofConsumed: boolean;
  readonly forked: boolean;
}): Promise<void> {
  const state = await transactions.withTenant(scope, readAuditDrainDomainState);
  expect(state.rows).toEqual([expected]);
}

async function expectExecutionFactDrainDomainCounts(expected: {
  readonly heads: string;
  readonly records: string;
  readonly seals: string;
}): Promise<void> {
  const result = await transactions.withTenant(scope, (transaction) => transaction.query<{
    heads: string; records: string; seals: string;
  }>(`
    SELECT
      (SELECT count(*) FROM public.execution_fact_drain_heads
       WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1)::text AS heads,
      (SELECT count(*) FROM public.execution_fact_drain_records
       WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1)::text AS records,
      (SELECT count(*) FROM public.execution_fact_drain_seals
       WHERE account_id = $1 AND workspace_id = $2 AND source_device_id = 'device-old' AND active_lease_epoch = 1)::text AS seals`,
  [scope.accountId, scope.workspaceId]));
  expect(result.rows).toEqual([expected]);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  return value;
}
