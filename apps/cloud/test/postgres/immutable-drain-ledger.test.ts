import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runCloudMigrations, TenantTransactionRunner, type TenantTransaction } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";

const ownerPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL"), max: 1 });
const appPool = new Pool({ connectionString: requiredEnvironment("GOODDEALER_POSTGRES_APP_URL"), max: 8 });
const transactions = new TenantTransactionRunner(appPool);

const scope = { accountId: "immutable-ledger-account", workspaceId: "immutable-ledger-workspace" } as const;
const otherScope = { accountId: "immutable-ledger-other-account", workspaceId: "immutable-ledger-other-workspace" } as const;
const sourceDeviceId = "immutable-ledger-source";
const targetDeviceId = "immutable-ledger-target";
const workflowId = "immutable-ledger-workflow";
const proofDigest = Buffer.alloc(32, 21);
const streamDigest = Buffer.alloc(32, 31);
const safeDefaultAclFacts = [
  { scope: "global", objectType: "f", grants: [] },
  { scope: "global", objectType: "r", grants: [] },
  { scope: "public", objectType: "f", grants: [] },
  { scope: "public", objectType: "r", grants: [] },
] as const;

const ledgerTables = [
  "mutation_drain_records", "mutation_drain_heads", "mutation_drain_seals",
  "execution_fact_drain_records", "execution_fact_drain_heads", "execution_fact_drain_seals",
  "workspace_device_audit_drain_records", "workspace_device_audit_drain_heads",
  "workspace_device_audit_drain_seals",
] as const;

const immutableStreamRows = [
  {
    record: "mutation_drain_records",
    head: "mutation_drain_heads",
    seal: "mutation_drain_seals",
    lastAssignedSequenceColumn: "last_assigned_device_mutation_sequence",
    source: "owner-mutation-source",
    proof: "owner-mutation-proof",
  },
  {
    record: "execution_fact_drain_records",
    head: "execution_fact_drain_heads",
    seal: "execution_fact_drain_seals",
    lastAssignedSequenceColumn: "last_assigned_execution_fact_sequence",
    source: "owner-execution-source",
    proof: "owner-execution-proof",
  },
  {
    record: "workspace_device_audit_drain_records",
    head: "workspace_device_audit_drain_heads",
    seal: "workspace_device_audit_drain_seals",
    lastAssignedSequenceColumn: "last_assigned_audit_sequence",
    source: "owner-audit-source",
    proof: "owner-audit-proof",
  },
] as const;

beforeAll(async () => {
  await runCloudMigrations(ownerPool, cloudMigrations);
  const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    console.warn(`UNQUALIFIED PostgreSQL diagnostic only: ${version.rows[0]?.server_version ?? "unknown"}`);
  } else {
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  }
});

beforeEach(async () => {
  await ownerPool.query(`TRUNCATE
    workspace_device_audit_drain_seals, workspace_device_audit_drain_records,
    workspace_device_audit_drain_heads, execution_fact_drain_seals, execution_fact_drain_records,
    execution_fact_drain_heads, mutation_drain_seals, mutation_drain_records, mutation_drain_heads,
    device_drain_proofs, device_active_leases, device_lease_epoch_allocations,
    device_switch_workflows, device_signing_keys, device_bindings, device_account_states,
    identity_account_security_states, identity_accounts CASCADE`);
  await seedDrainAuthority();
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end()]);
});

describe("PostgreSQL immutable Drain ledger authority", () => {
  it("denies direct app record head seal and proof DML plus public-schema DDL with SQLSTATE 42501", async () => {
    for (const table of [...ledgerTables, "device_drain_proofs"] as const) {
      await expect(appPool.query(`INSERT INTO public.${table} DEFAULT VALUES`)).rejects.toMatchObject({ code: "42501" });
      await expect(appPool.query(`UPDATE public.${table} SET account_id = account_id`)).rejects.toMatchObject({ code: "42501" });
      await expect(appPool.query(`DELETE FROM public.${table}`)).rejects.toMatchObject({ code: "42501" });
      await expect(appPool.query(`TRUNCATE TABLE public.${table}`)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(appPool.query("CREATE TABLE public.immutable_drain_app_blocked (id bigint)"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(appPool.query("ALTER TABLE public.mutation_drain_records ADD COLUMN app_forbidden bigint"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(appPool.query("SELECT * FROM public.device_drain_proofs FOR UPDATE"))
      .rejects.toMatchObject({ code: "42501" });
    const references = await ownerPool.query<{ allowed: boolean }>(
      "SELECT pg_catalog.has_table_privilege('gooddealer_cloud_app', 'public.device_drain_proofs', 'REFERENCES') AS allowed",
    );
    expect(references.rows).toEqual([{ allowed: false }]);
  });

  it("rejects owner updates and deletes of every immutable record and seal through triggers", async () => {
    await seedOwnerOnlyImmutableRows();
    for (const stream of immutableStreamRows) {
      await expect(withOwnerTenant(scope, (transaction) => transaction.query(
        `UPDATE public.${stream.record} SET canonical_envelope = canonical_envelope`,
      ))).rejects.toMatchObject({ code: "55000" });
      await expect(withOwnerTenant(scope, (transaction) => transaction.query(
        `DELETE FROM public.${stream.record}`,
      ))).rejects.toMatchObject({ code: "55000" });
      await expect(withOwnerTenant(scope, (transaction) => transaction.query(
        `UPDATE public.${stream.seal} SET proof_id = proof_id`,
      ))).rejects.toMatchObject({ code: "55000" });
      await expect(withOwnerTenant(scope, (transaction) => transaction.query(
        `DELETE FROM public.${stream.seal}`,
      ))).rejects.toMatchObject({ code: "55000" });
    }
  });

  it("rejects absent account-only workspace-only empty malformed and cross-tenant selectors with complete unchanged protected state", async () => {
    const selectorProbes: readonly [string, Partial<TenantTransaction["scope"]>][] = [
      ["absent", {}],
      ["account-only", { accountId: scope.accountId }],
      ["workspace-only", { workspaceId: scope.workspaceId }],
      ["empty", { accountId: "", workspaceId: "" }],
      ["malformed", { accountId: `${scope.accountId}\n`, workspaceId: scope.workspaceId }],
      ["cross-tenant", otherScope],
    ];
    for (const [name, selectors] of selectorProbes) {
      const before = await protectedStateSnapshot();
      await expect(withAppSelectors(selectors, (client) => client.query(
        "SELECT * FROM public.workspace_mutation_drain_lock_domain($1::text, $2::bigint)",
        [sourceDeviceId, 1],
      ))).rejects.toMatchObject({ code: "42501" });
      expect(await protectedStateSnapshot(), name).toEqual(before);
    }
  });

  it("keeps role membership and default ACLs hardened and rejects app escalation mutations", async () => {
    const roles = await ownerPool.query<{
      name: string;
      superuser: boolean;
      bypassRls: boolean;
      createRole: boolean;
      createDb: boolean;
      replication: boolean;
    }>(`
      SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls",
             rolcreaterole AS "createRole", rolcreatedb AS "createDb", rolreplication AS replication
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')
      ORDER BY rolname`);
    expect(roles.rows).toEqual([
      { name: "gooddealer_cloud_app", superuser: false, bypassRls: false, createRole: false, createDb: false, replication: false },
      { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false, createRole: false, createDb: false, replication: false },
    ]);

    const memberships = await ownerPool.query(`
      SELECT member_role.rolname AS member, granted_role.rolname AS role,
             membership.admin_option AS "adminOption", membership.inherit_option AS "inheritOption",
             membership.set_option AS "setOption"
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      WHERE member_role.rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')
         OR granted_role.rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')
      ORDER BY member, role`);
    expect(memberships.rows).toEqual([]);

    expect(await readEffectiveDefaultAclFacts(ownerPool)).toEqual(safeDefaultAclFacts);

    await withRolledBackOwnerTransaction(async (client) => {
      await client.query("ALTER DEFAULT PRIVILEGES FOR ROLE gooddealer_cloud_owner GRANT INSERT ON TABLES TO PUBLIC");
      await client.query("ALTER DEFAULT PRIVILEGES FOR ROLE gooddealer_cloud_owner GRANT SELECT ON TABLES TO gooddealer_cloud_app");
      const hostileGlobalRelationDefaults = (await readEffectiveDefaultAclFacts(client)).find(
        ({ scope: defaultAclScope, objectType }) => defaultAclScope === "global" && objectType === "r",
      );
      expect(hostileGlobalRelationDefaults?.grants).toHaveLength(2);
      expect(hostileGlobalRelationDefaults?.grants).toEqual(expect.arrayContaining([
        { grantee: "PUBLIC", privilege: "INSERT", grantable: false },
        { grantee: "gooddealer_cloud_app", privilege: "SELECT", grantable: false },
      ]));
    });
    expect(await readEffectiveDefaultAclFacts(ownerPool)).toEqual(safeDefaultAclFacts);

    for (const statement of [
      "SET ROLE gooddealer_cloud_owner",
      "GRANT gooddealer_cloud_owner TO gooddealer_cloud_app",
      "ALTER DEFAULT PRIVILEGES FOR ROLE gooddealer_cloud_owner GRANT INSERT ON TABLES TO PUBLIC",
      "ALTER DEFAULT PRIVILEGES FOR ROLE gooddealer_cloud_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC",
    ]) await expectAppEscalationRejected(statement);
    // PostgreSQL reports an unauthorized GRANT of an already absent privilege as a warning/no-op.
    await appPool.query("GRANT INSERT ON TABLE public.device_drain_proofs TO PUBLIC");
    const publicInsert = await ownerPool.query<{ allowed: boolean }>(
      "SELECT pg_catalog.has_table_privilege('public', 'public.device_drain_proofs', 'INSERT') AS allowed",
    );
    expect(publicInsert.rows).toEqual([{ allowed: false }]);
  });

  it("limits helper EXECUTE to the owner while preserving only the app routine allowlist", async () => {
    const observed = await ownerPool.query<{
      routine: string;
      app_allowed: boolean;
      public_allowed: boolean;
      security_definer: boolean;
      configuration: string[] | null;
    }>(`
      SELECT p.oid::regprocedure::text AS routine,
             pg_catalog.has_function_privilege('gooddealer_cloud_app', p.oid, 'EXECUTE') AS app_allowed,
             pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_allowed,
             p.prosecdef AS security_definer,
             p.proconfig AS configuration
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.oid::regprocedure::text = ANY($1::text[])
      ORDER BY p.oid::regprocedure::text`, [[
      "audit_append_workspace_device_drain_record(text,bigint,bigint,text,bytea,bytea,bytea)",
      "audit_install_workspace_device_drain_seal(text)",
      "audit_recompute_workspace_device_drain_head(text,bigint)",
      "device_consume_drain_proof(text,bytea,text,bigint,text)",
      "device_read_just_consumed_drain_proof(text)",
      "execution_fact_drain_append_record(text,bigint,bigint,bytea,bytea,text,text)",
      "execution_fact_drain_install_accepted_seal(text)",
      "execution_fact_drain_recompute_head(text,bigint)",
      "workspace_mutation_drain_append_record(text,bigint,bigint,bytea)",
      "workspace_mutation_drain_assert_active_domain(text,bigint)",
      "workspace_mutation_drain_lock_domain(text,bigint)",
      "workspace_mutation_drain_recompute_head(text,bigint)",
    ]]);
    expect(observed.rows).toEqual([
      { routine: "audit_append_workspace_device_drain_record(text,bigint,bigint,text,bytea,bytea,bytea)", app_allowed: false, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "audit_install_workspace_device_drain_seal(text)", app_allowed: true, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "audit_recompute_workspace_device_drain_head(text,bigint)", app_allowed: false, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "device_consume_drain_proof(text,bytea,text,bigint,text)", app_allowed: true, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "device_read_just_consumed_drain_proof(text)", app_allowed: false, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "execution_fact_drain_append_record(text,bigint,bigint,bytea,bytea,text,text)", app_allowed: true, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "execution_fact_drain_install_accepted_seal(text)", app_allowed: true, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "execution_fact_drain_recompute_head(text,bigint)", app_allowed: false, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "workspace_mutation_drain_append_record(text,bigint,bigint,bytea)", app_allowed: true, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "workspace_mutation_drain_assert_active_domain(text,bigint)", app_allowed: false, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "workspace_mutation_drain_lock_domain(text,bigint)", app_allowed: true, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
      { routine: "workspace_mutation_drain_recompute_head(text,bigint)", app_allowed: false, public_allowed: false, security_definer: true, configuration: ["search_path=pg_catalog, public"] },
    ]);

    const deniedHelpers: readonly [string, readonly unknown[]][] = [
      ["SELECT * FROM public.device_read_just_consumed_drain_proof($1::text)", ["missing-proof"]],
      ["SELECT public.workspace_mutation_drain_assert_active_domain($1::text, $2::bigint)", [sourceDeviceId, 1]],
      ["SELECT * FROM public.execution_fact_drain_recompute_head($1::text, $2::bigint)", [sourceDeviceId, 1]],
      ["SELECT * FROM public.audit_recompute_workspace_device_drain_head($1::text, $2::bigint)", [sourceDeviceId, 1]],
    ];
    for (const [statement, values] of deniedHelpers) {
      await expect(transactions.withTenant(scope, (transaction) => transaction.query(statement, values)))
        .rejects.toMatchObject({ code: "42501" });
    }
  });

  it("resists a hostile search path because the allowlisted routine remains catalog-first and schema-qualified", async () => {
    await transactions.withTenant(scope, async (transaction) => {
      await transaction.query("SET LOCAL search_path = pg_temp, public");
      await transaction.query("CREATE TEMPORARY TABLE mutation_drain_records (source_device_id text)");
      const state = await transaction.query<{
        contiguous_received_through: string;
        highest_received_sequence: string;
        sealed: boolean;
      }>(`
        SELECT contiguous_received_through, highest_received_sequence, sealed
        FROM public.workspace_mutation_drain_lock_domain($1::text, $2::bigint)`,
      [sourceDeviceId, 1]);
      expect(state.rows).toEqual([{ contiguous_received_through: "0", highest_received_sequence: "0", sealed: false }]);
    });
  });

  it("rejects unconsumed replayed expired and mismatched proof claims without emitting seals", async () => {
    await seedProof("unconsumed-proof");
    const unconsumed = await transactions.withTenant(scope, (transaction) => transaction.query<{ installed: boolean }>(
      "SELECT public.execution_fact_drain_install_accepted_seal($1::text) AS installed",
      ["unconsumed-proof"],
    ));
    expect(unconsumed.rows).toEqual([{ installed: false }]);

    await seedProof("digest-mismatch-proof");
    const digestMismatch = await consume("digest-mismatch-proof", Buffer.alloc(32, 77));
    expect(digestMismatch).toEqual({ accepted: false, rejection_reason: "PROOF_CONFLICT" });

    await seedProof("expired-proof", { expired: true });
    const expired = await consume("expired-proof", proofDigest);
    expect(expired).toEqual({ accepted: false, rejection_reason: "PROOF_EXPIRED" });

    await seedProof("replayed-proof");
    expect(await consume("replayed-proof", proofDigest)).toMatchObject({ accepted: true, rejection_reason: null });
    expect(await consume("replayed-proof", proofDigest)).toEqual({ accepted: false, rejection_reason: "PROOF_REPLAY_CONFLICT" });

    const seals = await withOwnerTenant(scope, (transaction) => transaction.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM execution_fact_drain_seals`,
    ));
    expect(seals.rows).toEqual([{ count: "0" }]);
  });

  it("rejects a mismatched derived stream head after proof consumption with no partial seal", async () => {
    await seedProof("head-mismatch-proof", { executionFactDigest: Buffer.alloc(32, 88) });
    const result = await transactions.withTenant(scope, async (transaction) => {
      const consumed = await consumeInTransaction(transaction, "head-mismatch-proof", proofDigest);
      const installed = await transaction.query<{ installed: boolean }>(
        "SELECT public.execution_fact_drain_install_accepted_seal($1::text) AS installed",
        ["head-mismatch-proof"],
      );
      return { accepted: consumed.accepted, installed: installed.rows[0]?.installed };
    });
    expect(result).toEqual({ accepted: true, installed: false });
    const state = await withOwnerTenant(scope, (transaction) => transaction.query<{ proofs: string; heads: string; seals: string }>(`
      SELECT
        (SELECT count(*)::text FROM device_drain_proofs WHERE proof_id = 'head-mismatch-proof' AND consumed_at IS NOT NULL) AS proofs,
        (SELECT count(*)::text FROM execution_fact_drain_heads) AS heads,
        (SELECT count(*)::text FROM execution_fact_drain_seals) AS seals`,
    ));
    expect(state.rows).toEqual([{ proofs: "1", heads: "0", seals: "0" }]);
  });

  it("rolls routine-ledger writes back and makes concurrent exact append retry deterministic", async () => {
    const envelope = Buffer.from("immutable-rollback-envelope", "utf8");
    await expect(transactions.withTenant(scope, async (transaction) => {
      await transaction.query(
        "SELECT public.workspace_mutation_drain_append_record($1::text, $2::bigint, $3::bigint, $4::bytea)",
        [sourceDeviceId, 1, 1, envelope],
      );
      throw new Error("rollback-after-immutable-append");
    })).rejects.toThrow("rollback-after-immutable-append");
    expect(await mutationCounts()).toEqual({ heads: "0", records: "0" });

    const concurrent = await Promise.all(Array.from({ length: 8 }, () => transactions.withTenant(scope, async (transaction) => {
      const result = await transaction.query<{ digest: string }>(`
        SELECT encode(public.workspace_mutation_drain_append_record(
          $1::text, $2::bigint, $3::bigint, $4::bytea
        ), 'hex') AS digest`, [sourceDeviceId, 1, 1, envelope]);
      return result.rows[0]?.digest;
    })));
    expect(new Set(concurrent).size).toBe(1);
    expect(concurrent[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(await mutationCounts()).toEqual({ heads: "1", records: "1" });
  });

  it("rejects a divergent immutable record retry with an exact no-change protected-state snapshot", async () => {
    const immutableIdentity = {
      sourceDeviceId,
      activeLeaseEpoch: 1,
      deviceMutationSequence: 1,
    } as const;
    const canonicalEnvelope = Buffer.from("immutable-divergent-canonical-envelope", "utf8");
    await transactions.withTenant(scope, (transaction) => transaction.query(
      "SELECT public.workspace_mutation_drain_append_record($1::text, $2::bigint, $3::bigint, $4::bytea)",
      [immutableIdentity.sourceDeviceId, immutableIdentity.activeLeaseEpoch,
        immutableIdentity.deviceMutationSequence, canonicalEnvelope],
    ));
    const before = await protectedStateSnapshot();
    await expect(transactions.withTenant(scope, (transaction) => transaction.query(
      "SELECT public.workspace_mutation_drain_append_record($1::text, $2::bigint, $3::bigint, $4::bytea)",
      [
        immutableIdentity.sourceDeviceId,
        immutableIdentity.activeLeaseEpoch,
        immutableIdentity.deviceMutationSequence,
        Buffer.from("immutable-divergent-canonical-envelope-tampered", "utf8"),
      ],
    ))).rejects.toMatchObject({ code: "23505" });
    expect(await protectedStateSnapshot()).toEqual(before);
  });

  it("keeps every hardened table read-only to the app role and force-enables tenant RLS", async () => {
    const tables = ["device_drain_proofs", ...ledgerTables];
    const state = await ownerPool.query<{
      table: string;
      owner: string;
      enabled: boolean;
      forced: boolean;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>(`
      SELECT c.relname AS table, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
             c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             pg_catalog.has_table_privilege('gooddealer_cloud_app', c.oid, 'SELECT') AS can_select,
             pg_catalog.has_table_privilege('gooddealer_cloud_app', c.oid, 'INSERT') AS can_insert,
             pg_catalog.has_table_privilege('gooddealer_cloud_app', c.oid, 'UPDATE') AS can_update,
             pg_catalog.has_table_privilege('gooddealer_cloud_app', c.oid, 'DELETE') AS can_delete,
             pg_catalog.has_table_privilege('gooddealer_cloud_app', c.oid, 'TRUNCATE') AS can_truncate
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname`, [tables]);
    expect(state.rows).toHaveLength(tables.length);
    expect(state.rows.every((row) => row.owner === "gooddealer_cloud_owner"
      && row.enabled && row.forced && row.can_select
      && !row.can_insert && !row.can_update && !row.can_delete && !row.can_truncate)).toBe(true);
  });
});

/** This owner-only setup is deliberately unavailable to ordinary application composition. */
async function seedDrainAuthority(): Promise<void> {
  await withOwnerTenant(scope, async (transaction) => {
    await transaction.query(`INSERT INTO identity_accounts
      (account_id, email_normalized, password_policy_id, password_hash_phc)
      VALUES ($1, 'immutable-ledger@example.test', 'argon2id-v1', repeat('x', 80))`, [scope.accountId]);
    await transaction.query(`INSERT INTO identity_account_security_states
      (account_id, account_security_epoch, status) VALUES ($1, 1, 'normal')`, [scope.accountId]);
    await transaction.query(`INSERT INTO device_account_states
      (account_id, binding_list_revision, highest_allocated_lease_epoch, current_lease_epoch)
      VALUES ($1, 1, 1, 1)`, [scope.accountId]);
    await transaction.query(`INSERT INTO device_bindings
      (account_id, device_id, slot, status, credential_epoch)
      VALUES ($1, $2, 1, 'bound', 1), ($1, $3, 2, 'bound', 1)`,
    [scope.accountId, sourceDeviceId, targetDeviceId]);
    await transaction.query(`INSERT INTO device_signing_keys
      (account_id, device_id, key_version, key_id, public_key, fingerprint, status)
      VALUES ($1, $2, 1, 'immutable-ledger-key', $3, $4, 'active')`,
    [scope.accountId, sourceDeviceId, Buffer.alloc(32, 3), Buffer.alloc(32, 4)]);
    await transaction.query(`INSERT INTO device_switch_workflows
      (account_id, workspace_id, workflow_id, purpose, mode, request_digest, idempotency_key, status,
       workflow_revision, from_device_id, to_device_id, bound_key_id, bound_key_version,
       bound_account_security_epoch, state_deadline)
      VALUES ($1, $2, $3, 'device_switch', 'normal', $4, 'immutable-ledger-idempotency', 'draining',
        1, $5, $6, 'immutable-ledger-key', 1, 1, transaction_timestamp() + interval '1 hour')`,
    [scope.accountId, scope.workspaceId, workflowId, Buffer.alloc(32, 5), sourceDeviceId, targetDeviceId]);
    await transaction.query(`INSERT INTO device_lease_epoch_allocations
      (account_id, workspace_id, workflow_id, lease_epoch, status, terminal_at)
      VALUES ($1, $2, 'immutable-ledger-old-workflow', 1, 'activated', transaction_timestamp())`,
    [scope.accountId, scope.workspaceId]);
    await transaction.query(`INSERT INTO device_active_leases
      (account_id, lease_epoch, device_id, jti, issued_at, renew_after, online_expires_at,
       offline_execute_until, signed_envelope)
      VALUES ($1, 1, $2, 'immutable-ledger-lease', transaction_timestamp() - interval '10 minutes',
        transaction_timestamp() - interval '9 minutes', transaction_timestamp() + interval '5 minutes',
        transaction_timestamp() + interval '1 hour', decode('01', 'hex'))`,
    [scope.accountId, sourceDeviceId]);
  });
}

/** Owner-only historical rows exist solely to assert that immutable triggers also constrain the owner. */
async function seedOwnerOnlyImmutableRows(): Promise<void> {
  await withOwnerTenant(scope, async (transaction) => {
    for (const [index, stream] of immutableStreamRows.entries()) {
      const digest = Buffer.alloc(32, index + 41);
      if (stream.head === "workspace_device_audit_drain_heads") {
        await transaction.query(`INSERT INTO public.workspace_device_audit_drain_heads
          (account_id, workspace_id, source_device_id, active_lease_epoch, chain_id, rolling_digest, head_hash)
          VALUES ($1, $2, $3, 1, 'owner-audit-chain', $4, $4)`,
        [scope.accountId, scope.workspaceId, stream.source, digest]);
        await transaction.query(`INSERT INTO public.workspace_device_audit_drain_records
          (account_id, workspace_id, source_device_id, active_lease_epoch, audit_sequence, chain_id,
           event_hash, canonical_envelope, envelope_digest)
          VALUES ($1, $2, $3, 1, 1, 'owner-audit-chain', $4, $5, $4)`,
        [scope.accountId, scope.workspaceId, stream.source, digest, Buffer.from("owner-audit-row", "utf8")]);
      } else if (stream.head === "execution_fact_drain_heads") {
        await transaction.query(`INSERT INTO public.execution_fact_drain_heads
          (account_id, workspace_id, source_device_id, active_lease_epoch, rolling_digest)
          VALUES ($1, $2, $3, 1, $4)`, [scope.accountId, scope.workspaceId, stream.source, digest]);
        await transaction.query(`INSERT INTO public.execution_fact_drain_records
          (account_id, workspace_id, source_device_id, active_lease_epoch, execution_fact_sequence,
           canonical_envelope, envelope_digest, classification)
          VALUES ($1, $2, $3, 1, 1, $4, $5, 'current')`,
        [scope.accountId, scope.workspaceId, stream.source, Buffer.from("owner-execution-row", "utf8"), digest]);
      } else {
        await transaction.query(`INSERT INTO public.mutation_drain_heads
          (account_id, workspace_id, source_device_id, active_lease_epoch, rolling_digest)
          VALUES ($1, $2, $3, 1, $4)`, [scope.accountId, scope.workspaceId, stream.source, digest]);
        await transaction.query(`INSERT INTO public.mutation_drain_records
          (account_id, workspace_id, source_device_id, active_lease_epoch, device_mutation_sequence,
           canonical_envelope, envelope_digest)
          VALUES ($1, $2, $3, 1, 1, $4, $5)`,
        [scope.accountId, scope.workspaceId, stream.source, Buffer.from("owner-mutation-row", "utf8"), digest]);
      }
      await transaction.query(`INSERT INTO public.${stream.seal}
        (account_id, workspace_id, source_device_id, active_lease_epoch, ${stream.lastAssignedSequenceColumn}, rolling_digest, proof_id)
        VALUES ($1, $2, $3, 1, 1, $4, $5)`,
      [scope.accountId, scope.workspaceId, stream.source, digest, stream.proof]);
    }
  });
}

async function seedProof(
  proofId: string,
  options: { readonly expired?: boolean; readonly executionFactDigest?: Buffer } = {},
): Promise<void> {
  const expiresAt = options.expired === true
    ? "transaction_timestamp() - interval '1 second'"
    : "transaction_timestamp() + interval '5 minutes'";
  await withOwnerTenant(scope, (transaction) => transaction.query(`INSERT INTO public.device_drain_proofs
    (account_id, workspace_id, proof_id, proof_digest, purpose, workflow_id, source_device_id,
     active_lease_epoch, signing_key_id, signing_key_version, issued_at, expires_at, verified_at,
     device_mutation_sequence, mutation_digest, execution_fact_sequence, execution_fact_digest,
     device_audit_sequence, device_audit_digest)
    VALUES ($1, $2, $3, $4, 'handoff', $5, $6, 1, 'immutable-ledger-key', 1,
      transaction_timestamp() - interval '2 minutes', ${expiresAt}, transaction_timestamp() - interval '1 minute',
      0, $7, 0, $8, 0, $7)`, [
    scope.accountId, scope.workspaceId, proofId, proofDigest, workflowId, sourceDeviceId,
    streamDigest, options.executionFactDigest ?? streamDigest,
  ]));
}

async function consume(proofId: string, digest: Buffer) {
  return transactions.withTenant(scope, (transaction) => consumeInTransaction(transaction, proofId, digest));
}

function consumeInTransaction(transaction: TenantTransaction, proofId: string, digest: Buffer) {
  return transaction.query<{ accepted: boolean; rejection_reason: string | null }>(`
    SELECT accepted, rejection_reason
    FROM public.device_consume_drain_proof(
      $1::text, $2::bytea, $3::text, $4::bigint, $5::text
    )`, [proofId, digest, workflowId, 1, targetDeviceId]).then((result) => {
    const row = result.rows[0];
    if (row === undefined) throw new TypeError("proof consumption returned no row");
    return row;
  });
}

async function mutationCounts(): Promise<{ heads: string; records: string }> {
  const result = await withOwnerTenant(scope, (transaction) => transaction.query<{ heads: string; records: string }>(`
    SELECT
      (SELECT count(*)::text FROM mutation_drain_heads) AS heads,
      (SELECT count(*)::text FROM mutation_drain_records) AS records`,
  ));
  const row = result.rows[0];
  if (row === undefined) throw new TypeError("mutation count observation returned no row");
  return row;
}

async function protectedStateSnapshot(): Promise<Record<string, Record<string, readonly unknown[]>>> {
  return {
    primary: await protectedStateSnapshotFor(scope),
    crossTenant: await protectedStateSnapshotFor(otherScope),
  };
}

async function protectedStateSnapshotFor(
  value: TenantTransaction["scope"],
): Promise<Record<string, readonly unknown[]>> {
  return withOwnerTenant(value, async (transaction) => ({
    proofs: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.device_drain_proofs
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY proof_id
    ) AS row`, [value.accountId, value.workspaceId]),
    mutationHeads: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.mutation_drain_heads
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch
    ) AS row`, [value.accountId, value.workspaceId]),
    mutationRecords: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.mutation_drain_records
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch, device_mutation_sequence
    ) AS row`, [value.accountId, value.workspaceId]),
    mutationSeals: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.mutation_drain_seals
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch
    ) AS row`, [value.accountId, value.workspaceId]),
    executionHeads: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.execution_fact_drain_heads
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch
    ) AS row`, [value.accountId, value.workspaceId]),
    executionRecords: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.execution_fact_drain_records
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch, execution_fact_sequence
    ) AS row`, [value.accountId, value.workspaceId]),
    executionSeals: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.execution_fact_drain_seals
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch
    ) AS row`, [value.accountId, value.workspaceId]),
    auditHeads: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.workspace_device_audit_drain_heads
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch
    ) AS row`, [value.accountId, value.workspaceId]),
    auditRecords: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.workspace_device_audit_drain_records
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch, audit_sequence
    ) AS row`, [value.accountId, value.workspaceId]),
    auditSeals: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.workspace_device_audit_drain_seals
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY source_device_id, active_lease_epoch
    ) AS row`, [value.accountId, value.workspaceId]),
    accountState: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.device_account_states WHERE account_id = $1
    ) AS row`, [value.accountId]),
    lease: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.device_active_leases WHERE account_id = $1 ORDER BY lease_epoch
    ) AS row`, [value.accountId]),
    leaseAllocations: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.device_lease_epoch_allocations
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY lease_epoch
    ) AS row`, [value.accountId, value.workspaceId]),
    capabilities: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.device_bootstrap_capabilities
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY workflow_id
    ) AS row`, [value.accountId, value.workspaceId]),
    bootstrapSteps: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.device_bootstrap_steps
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY workflow_id, step_number
    ) AS row`, [value.accountId, value.workspaceId]),
    workflows: await snapshotRows(transaction, `SELECT to_jsonb(row) AS value FROM (
      SELECT * FROM public.device_switch_workflows
      WHERE account_id = $1 AND workspace_id = $2 ORDER BY workflow_id
    ) AS row`, [value.accountId, value.workspaceId]),
  }));
}

async function snapshotRows(
  transaction: PoolClient,
  statement: string,
  values: readonly unknown[],
): Promise<readonly unknown[]> {
  const result = await transaction.query<{ value: unknown }>(statement, [...values]);
  return result.rows.map(({ value }) => value);
}

async function withOwnerTenant<Result>(
  value: TenantTransaction["scope"],
  operation: (transaction: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await ownerPool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [value.accountId]);
    await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [value.workspaceId]);
    const result = await operation(client);
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

/** Default ACL probes always roll back so they cannot alter later test or evidence state. */
async function withRolledBackOwnerTransaction<Result>(operation: (client: PoolClient) => Promise<Result>): Promise<Result> {
  const client = await ownerPool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await operation(client);
    await client.query("ROLLBACK");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readEffectiveDefaultAclFacts(client: Pick<PoolClient, "query">) {
  return (await client.query<{
    scope: "global" | "public";
    objectType: "f" | "r";
    grants: { grantee: string; privilege: string; grantable: boolean }[];
  }>(`
    SELECT acl_scope.scope, object_type."objectType", coalesce((
      SELECT json_agg(row_to_json(grant_fact)
        ORDER BY grant_fact.grantee, grant_fact.privilege, grant_fact.grantable)
      FROM (
        SELECT CASE WHEN privilege.grantee = 0 THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(privilege.grantee) END AS grantee,
          privilege.privilege_type AS privilege, privilege.is_grantable AS grantable
        FROM pg_catalog.pg_default_acl AS default_acl
        CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS privilege
        /* Global defaults are additive in public; public-schema defaults add to them. */
        WHERE default_acl.defaclrole = 'gooddealer_cloud_owner'::regrole
          AND default_acl.defaclnamespace = acl_scope.namespace_oid
          AND default_acl.defaclobjtype = object_type."objectType"
          AND (privilege.grantee = 0 OR privilege.grantee = 'gooddealer_cloud_app'::regrole)
      ) AS grant_fact
    ), '[]'::json) AS grants
    FROM (
      VALUES ('global'::text, 0::oid),
             ('public'::text, 'public'::regnamespace::oid)
    ) AS acl_scope(scope, namespace_oid)
    CROSS JOIN (VALUES ('f'::"char"), ('r'::"char")) AS object_type("objectType")
    ORDER BY acl_scope.scope, object_type."objectType"`)).rows;
}

async function withAppSelectors<Result>(
  selectors: Partial<TenantTransaction["scope"]>,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await appPool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    if (selectors.accountId !== undefined) {
      await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [selectors.accountId]);
    }
    if (selectors.workspaceId !== undefined) {
      await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [selectors.workspaceId]);
    }
    const result = await operation(client);
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

async function expectAppEscalationRejected(statement: string): Promise<void> {
  const client = await appPool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await expect(client.query(statement)).rejects.toMatchObject({ code: "42501" });
    await client.query("ROLLBACK");
    open = false;
  } finally {
    if (open) await client.query("ROLLBACK");
    client.release();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL integration evidence never skips`);
  }
  return value;
}
