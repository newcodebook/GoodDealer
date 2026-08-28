import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  runCloudMigrations,
  TenantTransactionRunner,
  type TenantTransaction,
} from "../../src/db/index";
import { checkedCloudMigrationCatalog, cloudMigrations } from "../../src/db/migrations";

/**
 * External qualification only. This suite deliberately refuses missing URLs and every PostgreSQL
 * version other than 18.6; a portable or local run is never evidence for the production gate.
 */
const ownerUrl = requiredQualifiedEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
const appUrl = requiredQualifiedEnvironment("GOODDEALER_POSTGRES_APP_URL");
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
const appPool = new Pool({ connectionString: appUrl, max: 2 });
const reuseOwnerPool = new Pool({ connectionString: ownerUrl, max: 1 });
const ownerTransactions = new TenantTransactionRunner(ownerPool);
const reuseOwnerTransactions = new TenantTransactionRunner(reuseOwnerPool);

const tenantA = { accountId: "audit-substrate-account-a", workspaceId: "audit-substrate-workspace-a" } as const;
const tenantB = { accountId: "audit-substrate-account-b", workspaceId: "audit-substrate-workspace-b" } as const;
const m013 = checkedCloudMigrationCatalog.find(({ id }) => id === "202608200013-server-audit-substrate");
if (m013 === undefined) throw new Error("M013 must be present in the Cloud migration catalog");

const auditTables = [
  "server_audit_entries",
  "server_audit_heads",
  "server_audit_quarantines",
  "server_audit_transition_edges",
] as const;

const directAppUpdateColumns = {
  server_audit_entries: "audit_event_id",
  server_audit_heads: "audit_sequence",
  server_audit_quarantines: "rejection_code",
  server_audit_transition_edges: "affected_outgoing_public_key_id",
} as const;

const directAppRoutineAttempts: readonly {
  readonly statement: string;
  readonly values: readonly unknown[];
}[] = [
  {
    statement: "SELECT public.audit_server_decode_digest($1::text)",
    values: ["not-a-server-audit-digest"],
  },
  {
    statement: "SELECT public.audit_quarantine_server_entry($1::bytea, $2::text)",
    values: [Buffer.alloc(32, 1), "schema_invalid"],
  },
  {
    statement: "SELECT * FROM public.audit_prepare_server_audit_append($1::bytea)",
    values: [Buffer.alloc(32, 2)],
  },
  {
    statement: `SELECT public.audit_append_server_entry_verified(
      $1::text, $2::jsonb, $3::bytea, $4::bigint, $5::bytea
    )`,
    values: ["user", "{}", Buffer.from("audit-substrate-app-denied", "utf8"), 0, null],
  },
  {
    statement: "SELECT public.audit_append_server_user_entry($1::jsonb, $2::bytea, $3::bigint, $4::bytea)",
    values: ["{}", Buffer.from("audit-substrate-app-denied", "utf8"), 0, null],
  },
  {
    statement: "SELECT public.audit_append_server_staff_entry($1::jsonb, $2::bytea, $3::bigint, $4::bytea)",
    values: ["{}", Buffer.from("audit-substrate-app-denied", "utf8"), 0, null],
  },
  {
    statement: "SELECT public.audit_append_server_service_entry($1::jsonb, $2::bytea, $3::bigint, $4::bytea)",
    values: ["{}", Buffer.from("audit-substrate-app-denied", "utf8"), 0, null],
  },
];

beforeAll(async () => {
  const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
  const observed = version.rows[0]?.server_version ?? "unknown";
  if (!/^18\.6(?:\D|$)/u.test(observed)) {
    throw new Error(`nonqualifying PostgreSQL diagnostic (${observed}); external qualification requires PostgreSQL 18.6`);
  }

  const firstCatalog = await runCloudMigrations(ownerPool, cloudMigrations);
  const secondCatalog = await runCloudMigrations(ownerPool, cloudMigrations);
  expect(secondCatalog).toEqual(firstCatalog);
});

beforeEach(async () => {
  await ownerPool.query(`TRUNCATE TABLE
    public.server_audit_transition_edges,
    public.server_audit_entries,
    public.server_audit_heads,
    public.server_audit_quarantines`);
});

afterAll(async () => {
  await Promise.all([ownerPool.end(), appPool.end(), reuseOwnerPool.end()]);
});

describe("PostgreSQL 18.6 server audit substrate external qualification", () => {
  it("applies the exact serial M013 catalog record idempotently", async () => {
    const persisted = await ownerPool.query<{ id: string; owner_module: string; checksum: string }>(`
      SELECT id, owner_module, checksum
      FROM gooddealer_cloud_migrations
      WHERE id = $1`, [m013.id]);

    expect(persisted.rows).toEqual([{
      id: "202608200013-server-audit-substrate",
      owner_module: "audit",
      checksum: "a4953760e75a3d18442316b70ed28bad87304d14ae27eeba1403b33864787b4c",
    }]);
  });

  it("keeps both roles non-escalating and every M013 relation owner-only with forced RLS", async () => {
    const roles = await ownerPool.query<{
      name: string;
      superuser: boolean;
      bypassRls: boolean;
    }>(`
      SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls"
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')
      ORDER BY rolname`);
    expect(roles.rows).toEqual([
      { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
      { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
    ]);

    const relations = await ownerPool.query<{
      relation: string;
      owner: string;
      rowSecurity: boolean;
      forceRowSecurity: boolean;
      appSelect: boolean;
      appInsert: boolean;
      appUpdate: boolean;
      appDelete: boolean;
      appTruncate: boolean;
      publicSelect: boolean;
    }>(`
      SELECT relation.relname AS relation,
             owner_role.rolname AS owner,
             relation.relrowsecurity AS "rowSecurity",
             relation.relforcerowsecurity AS "forceRowSecurity",
             pg_catalog.has_table_privilege('gooddealer_cloud_app', relation.oid, 'SELECT') AS "appSelect",
             pg_catalog.has_table_privilege('gooddealer_cloud_app', relation.oid, 'INSERT') AS "appInsert",
             pg_catalog.has_table_privilege('gooddealer_cloud_app', relation.oid, 'UPDATE') AS "appUpdate",
             pg_catalog.has_table_privilege('gooddealer_cloud_app', relation.oid, 'DELETE') AS "appDelete",
             pg_catalog.has_table_privilege('gooddealer_cloud_app', relation.oid, 'TRUNCATE') AS "appTruncate",
             pg_catalog.has_table_privilege('public', relation.oid, 'SELECT') AS "publicSelect"
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = ANY($1::text[])
      ORDER BY relation.relname`, [auditTables]);
    expect(relations.rows).toEqual(auditTables.map((relation) => ({
      relation,
      owner: "gooddealer_cloud_owner",
      rowSecurity: true,
      forceRowSecurity: true,
      appSelect: false,
      appInsert: false,
      appUpdate: false,
      appDelete: false,
      appTruncate: false,
      publicSelect: false,
    })));
  });

  it("revokes every M013 function from PUBLIC and the app role while pinning definer search paths", async () => {
    const functions = await ownerPool.query<{
      name: string;
      appAllowed: boolean;
      publicAllowed: boolean;
      securityDefiner: boolean;
      configuration: string[] | null;
    }>(`
      SELECT procedure.proname AS name,
             pg_catalog.has_function_privilege('gooddealer_cloud_app', procedure.oid, 'EXECUTE') AS "appAllowed",
             pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicAllowed",
             procedure.prosecdef AS "securityDefiner",
             procedure.proconfig AS configuration
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = ANY($1::text[])
      ORDER BY procedure.proname`, [[
      "audit_append_server_entry_verified",
      "audit_append_server_service_entry",
      "audit_append_server_staff_entry",
      "audit_append_server_user_entry",
      "audit_prepare_server_audit_append",
      "audit_quarantine_server_entry",
      "audit_reject_server_audit_mutation",
      "audit_server_decode_digest",
    ]]);

    expect(functions.rows).toEqual([
      { name: "audit_append_server_entry_verified", appAllowed: false, publicAllowed: false, securityDefiner: true, configuration: ["search_path=pg_catalog, public"] },
      { name: "audit_append_server_service_entry", appAllowed: false, publicAllowed: false, securityDefiner: true, configuration: ["search_path=pg_catalog, public"] },
      { name: "audit_append_server_staff_entry", appAllowed: false, publicAllowed: false, securityDefiner: true, configuration: ["search_path=pg_catalog, public"] },
      { name: "audit_append_server_user_entry", appAllowed: false, publicAllowed: false, securityDefiner: true, configuration: ["search_path=pg_catalog, public"] },
      { name: "audit_prepare_server_audit_append", appAllowed: false, publicAllowed: false, securityDefiner: true, configuration: ["search_path=pg_catalog, public"] },
      { name: "audit_quarantine_server_entry", appAllowed: false, publicAllowed: false, securityDefiner: true, configuration: ["search_path=pg_catalog, public"] },
      { name: "audit_reject_server_audit_mutation", appAllowed: false, publicAllowed: false, securityDefiner: true, configuration: ["search_path=pg_catalog, public"] },
      { name: "audit_server_decode_digest", appAllowed: false, publicAllowed: false, securityDefiner: false, configuration: ["search_path=pg_catalog"] },
    ]);
  });

  it("denies direct app reads, DML, routine execution, role escalation, and public-schema DDL", async () => {
    for (const relation of auditTables) {
      await expectAppDenied(`SELECT * FROM public.${relation}`);
      await expectAppDenied(`INSERT INTO public.${relation} DEFAULT VALUES`);
      const column = directAppUpdateColumns[relation];
      await expectAppDenied(`UPDATE public.${relation} SET ${column} = ${column}`);
      await expectAppDenied(`DELETE FROM public.${relation}`);
      await expectAppDenied(`TRUNCATE TABLE public.${relation}`);
    }
    for (const attempt of directAppRoutineAttempts) {
      await expectAppDenied(attempt.statement, attempt.values);
    }
    for (const statement of [
      "SET ROLE gooddealer_cloud_owner",
      "GRANT gooddealer_cloud_owner TO gooddealer_cloud_app",
      "CREATE TABLE public.audit_substrate_app_blocked (id bigint)",
      "ALTER TABLE public.server_audit_entries ADD COLUMN app_forbidden bigint",
    ]) await expectAppDenied(statement);
  });

  it("allows same-tenant diagnostics only, hides cross-tenant rows, and rejects cross-tenant or unresolved writes", async () => {
    const sameTenantDigest = sha256("audit-substrate-same-tenant-diagnostic");
    const inserted = await ownerTransactions.withTenant(tenantA, async (transaction) => {
      const result = await transaction.query<{ inserted: boolean }>(`
        SELECT public.audit_quarantine_server_entry($1::bytea, 'schema_invalid') AS inserted`, [sameTenantDigest]);
      const visible = await transaction.query<{ account_id: string; workspace_id: string; rejection_code: string }>(`
        SELECT account_id, workspace_id, rejection_code
        FROM public.server_audit_quarantines
        WHERE candidate_digest = $1::bytea`, [sameTenantDigest]);
      expect(visible.rows).toEqual([{
        account_id: tenantA.accountId,
        workspace_id: tenantA.workspaceId,
        rejection_code: "schema_invalid",
      }]);
      return result.rows[0]?.inserted;
    });
    expect(inserted).toBe(true);

    const crossTenantRead = await ownerTransactions.withTenant(tenantB, (transaction) => transaction.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM public.server_audit_quarantines
      WHERE account_id = $1 AND workspace_id = $2`, [tenantA.accountId, tenantA.workspaceId]));
    expect(crossTenantRead.rows).toEqual([{ count: "0" }]);

    const beforeCrossTenantWrite = await protectedStateSnapshot(tenantA);
    await expect(ownerTransactions.withTenant(tenantB, (transaction) => transaction.query(`
      INSERT INTO public.server_audit_quarantines (
        tenant_scope, account_id, workspace_id, candidate_digest, rejection_code
      ) VALUES ('workspace', $1, $2, $3::bytea, 'schema_invalid')`, [
      tenantA.accountId,
      tenantA.workspaceId,
      sha256("audit-substrate-cross-tenant-write"),
    ]))).rejects.toMatchObject({ code: "42501" });
    expect(await protectedStateSnapshot(tenantA)).toEqual(beforeCrossTenantWrite);

    const unresolvedSelectors: readonly [string, { readonly accountId?: string; readonly workspaceId?: string }][] = [
      ["absent", {}],
      ["account-only", { accountId: tenantA.accountId }],
      ["workspace-only", { workspaceId: tenantA.workspaceId }],
      ["empty", { accountId: "", workspaceId: "" }],
      ["malformed", { accountId: `${tenantA.accountId}\n`, workspaceId: tenantA.workspaceId }],
    ];
    for (const [name, selectors] of unresolvedSelectors) {
      const before = await protectedStateSnapshot(tenantA);
      await expect(withOwnerSelectors(selectors, (client) => client.query(
        "SELECT public.audit_quarantine_server_entry($1::bytea, 'schema_invalid')",
        [sha256(`audit-substrate-unresolved-${name}`)],
      ))).rejects.toMatchObject({ code: "22000" });
      expect(await protectedStateSnapshot(tenantA), name).toEqual(before);
    }
  });

  it("clears both tenant settings across committed and rolled-back pooled owner transactions", async () => {
    await reuseOwnerTransactions.withTenant(tenantA, (transaction) => transaction.query("SELECT 1"));
    expect(await currentTenantSettings(reuseOwnerPool)).toEqual({ accountId: null, workspaceId: null });

    await expect(reuseOwnerTransactions.withTenant(tenantA, async (transaction) => {
      await transaction.query("SELECT 1");
      throw new Error("audit-substrate-tenant-context-rollback-probe");
    })).rejects.toThrow("audit-substrate-tenant-context-rollback-probe");
    expect(await currentTenantSettings(reuseOwnerPool)).toEqual({ accountId: null, workspaceId: null });
  });

  it("keeps exact append replay idempotent and rejects divergent or stale CAS attempts without protected-state changes", async () => {
    const chainId = sha256("audit-substrate-cas-chain");
    const eventHash = sha256("audit-substrate-cas-event");
    const canonicalEvidence = Buffer.from("audit-substrate-canonical-evidence", "utf8");
    const exact = await ownerTransactions.withTenant(tenantA, async (transaction) => {
      const entry = await structuralUserEntry(transaction, {
        auditEventId: "audit-substrate-cas-entry",
        auditSequence: 1,
        chainId,
        previousHash: genesisHash(),
        eventHash,
      });
      expect(await appendUserEntry(transaction, entry, canonicalEvidence, 0, null)).toBe("appended");
      const beforeReplay = await readHead(transaction, chainId);
      expect(await appendUserEntry(transaction, entry, canonicalEvidence, 0, null)).toBe("exact");
      return { beforeReplay, afterReplay: await readHead(transaction, chainId) };
    });
    expect(exact.afterReplay).toEqual(exact.beforeReplay);

    const beforeDivergentReplay = await protectedStateSnapshot(tenantA);
    await expect(ownerTransactions.withTenant(tenantA, async (transaction) => {
      const divergent = await structuralUserEntry(transaction, {
        auditEventId: "audit-substrate-cas-entry",
        auditSequence: 1,
        chainId,
        previousHash: genesisHash(),
        eventHash: sha256("audit-substrate-divergent-event"),
      });
      await appendUserEntry(transaction, divergent, Buffer.from("audit-substrate-divergent-evidence", "utf8"), 0, null);
    })).rejects.toMatchObject({ code: "23505" });
    expect(await protectedStateSnapshot(tenantA)).toEqual(beforeDivergentReplay);

    const beforeStaleCas = await protectedStateSnapshot(tenantA);
    await expect(ownerTransactions.withTenant(tenantA, async (transaction) => {
      const stale = await structuralUserEntry(transaction, {
        auditEventId: "audit-substrate-stale-entry",
        auditSequence: 2,
        chainId,
        previousHash: eventHash,
        eventHash: sha256("audit-substrate-stale-event"),
      });
      await appendUserEntry(transaction, stale, Buffer.from("audit-substrate-stale-evidence", "utf8"), 0, null);
    })).rejects.toMatchObject({ code: "40001" });
    expect(await protectedStateSnapshot(tenantA)).toEqual(beforeStaleCas);
  });

  it("rejects owner mutation of immutable entries, transition edges, and quarantine diagnostics", async () => {
    const quarantineDigest = sha256("audit-substrate-immutable-quarantine");
    const transitionEventId = await ownerTransactions.withTenant(tenantA, async (transaction) => {
      const transition = await structuralServiceTransitionEntry(transaction, {
        auditEventId: "audit-substrate-immutable-transition",
        chainId: sha256("audit-substrate-immutable-chain"),
        eventHash: sha256("audit-substrate-immutable-event"),
      });
      expect(await appendServiceEntry(
        transaction,
        transition,
        Buffer.from("audit-substrate-immutable-transition-evidence", "utf8"),
        0,
        null,
      )).toBe("appended");
      expect(await quarantine(transaction, quarantineDigest)).toBe(true);
      return transition.auditEventId;
    });

    const ownerMutationAttempts: readonly [string, readonly unknown[]][] = [
      ["UPDATE public.server_audit_entries SET event_type = event_type WHERE audit_event_id = $1", [transitionEventId]],
      ["DELETE FROM public.server_audit_entries WHERE audit_event_id = $1", [transitionEventId]],
      [
        "UPDATE public.server_audit_transition_edges SET affected_outgoing_public_key_id = affected_outgoing_public_key_id WHERE transition_audit_event_id = $1",
        [transitionEventId],
      ],
      ["DELETE FROM public.server_audit_transition_edges WHERE transition_audit_event_id = $1", [transitionEventId]],
      ["UPDATE public.server_audit_quarantines SET rejection_code = rejection_code WHERE candidate_digest = $1::bytea", [quarantineDigest]],
      ["DELETE FROM public.server_audit_quarantines WHERE candidate_digest = $1::bytea", [quarantineDigest]],
    ];
    for (const [statement, values] of ownerMutationAttempts) {
      await expect(ownerTransactions.withTenant(tenantA, (transaction) => transaction.query(statement, values)))
        .rejects.toMatchObject({ code: "55000" });
    }
  });

  it("keeps quarantine digest-only, non-authoritative, and non-durable across an outer rollback", async () => {
    const rawCandidateSentinel = "audit-substrate-raw-candidate-test-input";
    const secretSentinel = "audit-substrate-secret-test-input";
    const digestOnlyInput = sha256(`${rawCandidateSentinel}:${secretSentinel}`);

    await expect(ownerTransactions.withTenant(tenantA, async (transaction) => {
      expect(await quarantine(transaction, digestOnlyInput)).toBe(true);
      const stored = await transaction.query<{ candidateDigest: string; rejectionCode: string }>(`
        SELECT encode(candidate_digest, 'hex') AS "candidateDigest", rejection_code AS "rejectionCode"
        FROM public.server_audit_quarantines
        WHERE candidate_digest = $1::bytea`, [digestOnlyInput]);
      const persistedDiagnostic = JSON.stringify(stored.rows);
      expect(persistedDiagnostic).not.toContain(rawCandidateSentinel);
      expect(persistedDiagnostic).not.toContain(secretSentinel);
      throw new Error("audit-substrate-diagnostic-outer-rollback");
    })).rejects.toThrow("audit-substrate-diagnostic-outer-rollback");

    const afterRollback = await ownerTransactions.withTenant(tenantA, (transaction) => transaction.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM public.server_audit_quarantines
      WHERE candidate_digest = $1::bytea`, [digestOnlyInput]));
    expect(afterRollback.rows).toEqual([{ count: "0" }]);
  });
});

async function expectAppDenied(statement: string, values: readonly unknown[] = []): Promise<void> {
  await expect(appPool.query(statement, [...values])).rejects.toMatchObject({ code: "42501" });
}

async function currentTenantSettings(pool: Pool): Promise<{ accountId: string | null; workspaceId: string | null }> {
  const result = await pool.query<{ accountId: string | null; workspaceId: string | null }>(`
    SELECT nullif(current_setting('gooddealer.account_id', true), '') AS "accountId",
           nullif(current_setting('gooddealer.workspace_id', true), '') AS "workspaceId"`);
  const settings = result.rows[0];
  if (settings === undefined) throw new Error("tenant settings query returned no row");
  return settings;
}

async function withOwnerSelectors<Result>(
  selectors: { readonly accountId?: string; readonly workspaceId?: string },
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await ownerPool.connect();
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

async function protectedStateSnapshot(scope: typeof tenantA): Promise<{
  entries: string;
  heads: string;
  transitionEdges: string;
  quarantines: string;
}> {
  return ownerTransactions.withTenant(scope, async (transaction) => {
    const result = await transaction.query<{
      entries: string;
      heads: string;
      transitionEdges: string;
      quarantines: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM public.server_audit_entries) AS entries,
        (SELECT count(*)::text FROM public.server_audit_heads) AS heads,
        (SELECT count(*)::text FROM public.server_audit_transition_edges) AS "transitionEdges",
        (SELECT count(*)::text FROM public.server_audit_quarantines) AS quarantines`);
    const snapshot = result.rows[0];
    if (snapshot === undefined) throw new Error("protected state snapshot returned no row");
    return snapshot;
  });
}

async function quarantine(transaction: TenantTransaction, candidateDigest: Buffer): Promise<boolean> {
  const result = await transaction.query<{ inserted: boolean }>(`
    SELECT public.audit_quarantine_server_entry($1::bytea, 'schema_invalid') AS inserted`, [candidateDigest]);
  const inserted = result.rows[0]?.inserted;
  if (inserted === undefined) throw new Error("quarantine routine returned no result");
  return inserted;
}

async function readHead(
  transaction: TenantTransaction,
  chainId: Buffer,
): Promise<{ auditSequence: string; eventHash: string } | null> {
  const result = await transaction.query<{ auditSequence: string; eventHash: string }>(`
    SELECT audit_sequence::text AS "auditSequence", encode(event_hash, 'hex') AS "eventHash"
    FROM public.server_audit_heads
    WHERE chain_id = $1::bytea`, [chainId]);
  return result.rows[0] ?? null;
}

async function structuralUserEntry(
  transaction: TenantTransaction,
  input: {
    readonly auditEventId: string;
    readonly auditSequence: number;
    readonly chainId: Buffer;
    readonly previousHash: Buffer;
    readonly eventHash: Buffer;
  },
): Promise<Record<string, unknown>> {
  const occurredAt = await databaseTimestamp(transaction);
  return {
    schemaVersion: 1,
    auditEventId: input.auditEventId,
    auditEventKind: "user",
    eventType: "account_security",
    targetType: "account",
    targetRef: tenantA.accountId,
    actorId: "audit-substrate-user",
    chainId: input.chainId.toString("base64url"),
    auditSequence: input.auditSequence,
    previousHash: input.previousHash.toString("base64url"),
    eventHash: input.eventHash.toString("base64url"),
    occurredAt,
    authorizationContextHash: sha256("audit-substrate-user-authorization").toString("base64url"),
    cryptographicSignerKind: "gooddealer_audit_service",
    cryptographicSignerId: "audit-substrate-service",
    signingKeyId: "audit-substrate-structural-user-key",
    signingKeyVersion: 1,
    signatureTranscriptVersion: 1,
    // Structure-only database input, not a signer implementation or signer-qualification claim.
    serverSignature: Buffer.from("audit-substrate-structural-signature", "utf8").toString("base64url"),
    signing_key_transition_id: null,
    actorKind: "user",
    authorizationSource: "user_session",
    signingKeyPurpose: "user_audit",
    payloadRedacted: { action: "account_security", outcome: "accepted", reason: "database_contract_test" },
    tenantScope: "workspace",
    accountId: tenantA.accountId,
    workspaceId: tenantA.workspaceId,
  };
}

async function structuralServiceTransitionEntry(
  transaction: TenantTransaction,
  input: {
    readonly auditEventId: string;
    readonly chainId: Buffer;
    readonly eventHash: Buffer;
  },
): Promise<Record<string, unknown> & { readonly auditEventId: string }> {
  const occurredAt = await databaseTimestamp(transaction);
  return {
    schemaVersion: 1,
    auditEventId: input.auditEventId,
    auditEventKind: "service",
    eventType: "audit_signing_key_transition",
    targetType: "account",
    targetRef: tenantA.accountId,
    actorId: "audit-substrate-service",
    chainId: input.chainId.toString("base64url"),
    auditSequence: 1,
    previousHash: genesisHash().toString("base64url"),
    eventHash: input.eventHash.toString("base64url"),
    occurredAt,
    authorizationContextHash: sha256("audit-substrate-transition-authorization").toString("base64url"),
    cryptographicSignerKind: "gooddealer_audit_service",
    cryptographicSignerId: "audit-substrate-service",
    signingKeyId: "audit-substrate-service-key-old",
    signingKeyVersion: 1,
    signatureTranscriptVersion: 1,
    // Structure-only database input, not a signer implementation or signer-qualification claim.
    serverSignature: Buffer.from("audit-substrate-transition-signature", "utf8").toString("base64url"),
    signing_key_transition_id: null,
    actorKind: "service",
    authorizationSource: "service_identity",
    signingKeyPurpose: "service_audit",
    payloadRedacted: {
      affectedSigningKeyPurpose: "user_audit",
      affectedOutgoingPublicKeyId: "audit-substrate-user-key-old",
      affectedOutgoingPublicKeyVersion: 1,
      affectedIncomingPublicKeyId: "audit-substrate-user-key-new",
      affectedIncomingPublicKeyVersion: 1,
      effectiveBoundary: {
        rule: "after_transition_commit",
        transitionChainId: input.chainId.toString("base64url"),
        transitionAuditSequence: 1,
        notBeforeOccurredAt: occurredAt,
      },
      custodyApprovalDigest: sha256("audit-substrate-custody-approval").toString("base64url"),
    },
    tenantScope: "workspace",
    accountId: tenantA.accountId,
    workspaceId: tenantA.workspaceId,
  };
}

async function appendUserEntry(
  transaction: TenantTransaction,
  entry: Record<string, unknown>,
  canonicalEvidence: Buffer,
  expectedSequence: number,
  expectedHash: Buffer | null,
): Promise<string> {
  const result = await transaction.query<{ status: string }>(`
    SELECT public.audit_append_server_user_entry(
      $1::jsonb, $2::bytea, $3::bigint, $4::bytea
    ) AS status`, [JSON.stringify(entry), canonicalEvidence, expectedSequence, expectedHash]);
  const status = result.rows[0]?.status;
  if (status === undefined) throw new Error("user append routine returned no status");
  return status;
}

async function appendServiceEntry(
  transaction: TenantTransaction,
  entry: Record<string, unknown>,
  canonicalEvidence: Buffer,
  expectedSequence: number,
  expectedHash: Buffer | null,
): Promise<string> {
  const result = await transaction.query<{ status: string }>(`
    SELECT public.audit_append_server_service_entry(
      $1::jsonb, $2::bytea, $3::bigint, $4::bytea
    ) AS status`, [JSON.stringify(entry), canonicalEvidence, expectedSequence, expectedHash]);
  const status = result.rows[0]?.status;
  if (status === undefined) throw new Error("service append routine returned no status");
  return status;
}

async function databaseTimestamp(transaction: TenantTransaction): Promise<string> {
  const result = await transaction.query<{ occurredAt: string }>(`
    SELECT pg_catalog.to_char(
      pg_catalog.date_trunc('second', pg_catalog.transaction_timestamp()) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ) AS "occurredAt"`);
  const occurredAt = result.rows[0]?.occurredAt;
  if (occurredAt === undefined) throw new Error("database timestamp query returned no value");
  return occurredAt;
}

function genesisHash(): Buffer {
  return sha256("GOODDEALER-SERVER-AUDIT-CHAIN-GENESIS-V1");
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function requiredQualifiedEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL external qualification never skips or falls back to a portable test`);
  }
  return value;
}
