import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const root = resolve(import.meta.dirname, "..");

export const DEVICES_PERSISTENCE_INPUT_PATHS = [
  "apps/cloud/src/db/index.ts",
  "apps/cloud/src/db/migrations.ts",
  "apps/cloud/src/modules/devices/ports.ts",
  "apps/cloud/src/modules/devices/postgres-drain-transition.ts",
  "apps/cloud/src/modules/devices/migrations/202608200004-device-control.ts",
  "apps/cloud/src/modules/workspace/mutations/migrations/202608200006-mutation-drain-ledger.ts",
  "apps/cloud/src/modules/execution-ledger/migrations/202608200007-execution-fact-drain-ledger.ts",
  "apps/cloud/src/modules/audit/migrations/202608200008-workspace-device-audit-drain-ledger.ts",
  "apps/cloud/src/modules/workspace/mutations/postgres-drain-ledger.ts",
  "apps/cloud/src/modules/execution-ledger/postgres-drain-ledger.ts",
  "apps/cloud/src/modules/audit/postgres-workspace-device-drain-ledger.ts",
  "apps/cloud/test/postgres/device-drain-persistence.test.ts",
  "apps/cloud/test/postgres/workspace-mutation-persistence.test.ts",
  "apps/cloud/test/postgres/workspace-checkpoint-persistence.test.ts",
  "apps/cloud/test/postgres/immutable-drain-ledger.test.ts",
  "scripts/collect-devices-persistence-report.mjs",
  "scripts/devices-persistence-evidence-policy.test.mjs",
  ".github/workflows/wp2-devices-persistence.yml",
  "package.json",
];

export const POSTGRES_DEVICES_TEST_NAMES = [
  "atomically consumes one proof, installs exactly three seals, releases Lease, burns forward, and does not retire a cursor",
  "rolls back every write boundary and never reuses the burned-forward epoch",
  "fails closed on gaps, digest drift, stale Lease epoch, and conflicting replay with no partial commit",
  "does not materialize execution ledger rows for an unconsumed or mismatched proof",
  "seals a matching execution proof once and preserves exact in-transaction replay idempotency",
  "does not materialize audit ledger evidence for unconsumed or mismatched proofs in-flight or after commit",
  "seals a matching audit proof once and preserves exact in-transaction replay idempotency",
  "rejects a forked audit domain without adding a seal or changing proof consumption",
  "serializes concurrent winners and survives fixed-order contention without deadlock",
  "fails closed for missing or wrong tenant scope and clears pooled selectors after commit and rollback",
  "isolates the same workspace, workflow, and device ids across two accounts",
  "observes non-privileged roles and ENABLE plus FORCE RLS on every persistence table",
  "fails closed for quarantined audit evidence, preserves clean owner duplicates, and denies app-supplied audit claims",
  "rejects security epoch, recovery, deadline, audit fork, key, and binding drift with no partial commit",
  "times out behind a realistic earlier identity lock without deadlock or partial commit",
];

export const IMMUTABLE_DRAIN_TEST_NAMES = [
  "denies direct app record head seal and proof DML plus public-schema DDL with SQLSTATE 42501",
  "rejects owner updates and deletes of every immutable record and seal through triggers",
  "rejects absent account-only workspace-only empty malformed and cross-tenant selectors with complete unchanged protected state",
  "keeps role membership and default ACLs hardened and rejects app escalation mutations",
  "limits helper EXECUTE to the owner while preserving only the app routine allowlist",
  "resists a hostile search path because the allowlisted routine remains catalog-first and schema-qualified",
  "rejects unconsumed replayed expired and mismatched proof claims without emitting seals",
  "rejects a mismatched derived stream head after proof consumption with no partial seal",
  "rolls routine-ledger writes back and makes concurrent exact append retry deterministic",
  "rejects a divergent immutable record retry with an exact no-change protected-state snapshot",
  "keeps every hardened table read-only to the app role and force-enables tenant RLS",
];

export const POSTGRES_DRAIN_TEST_FILES = [
  { file: "test/postgres/device-drain-persistence.test.ts", names: POSTGRES_DEVICES_TEST_NAMES },
  { file: "test/postgres/immutable-drain-ledger.test.ts", names: IMMUTABLE_DRAIN_TEST_NAMES },
];

export const DEVICE_PERSISTENCE_TABLES = [
  "device_account_states", "device_active_leases", "device_bindings", "device_bootstrap_capabilities",
  "device_bootstrap_steps", "device_drain_proofs", "device_identity_challenges", "device_lease_epoch_allocations",
  "device_signing_keys", "device_switch_workflows", "execution_fact_drain_heads", "execution_fact_drain_records",
  "execution_fact_drain_seals", "mutation_drain_heads", "mutation_drain_records", "mutation_drain_seals",
  "workspace_device_audit_drain_heads", "workspace_device_audit_drain_records",
  "workspace_device_audit_drain_seals", "workspace_device_cursors",
];

export const HARDENED_DRAIN_TABLES = [
  "device_drain_proofs", "execution_fact_drain_heads", "execution_fact_drain_records",
  "execution_fact_drain_seals", "mutation_drain_heads", "mutation_drain_records", "mutation_drain_seals",
  "workspace_device_audit_drain_heads", "workspace_device_audit_drain_records",
  "workspace_device_audit_drain_seals",
].sort();

export const ROLE_EXPECTATIONS = [
  {
    name: "gooddealer_cloud_app",
    superuser: false,
    bypassRls: false,
    createRole: false,
    createDb: false,
    replication: false,
  },
  {
    name: "gooddealer_cloud_owner",
    superuser: false,
    bypassRls: false,
    createRole: false,
    createDb: false,
    replication: false,
  },
];

export const ROLE_MEMBERSHIP_EXPECTATIONS = [];
export const DEFAULT_ACL_GRANT_EXPECTATIONS = [
  { scope: "global", objectType: "f", grants: [] },
  { scope: "global", objectType: "r", grants: [] },
  { scope: "public", objectType: "f", grants: [] },
  { scope: "public", objectType: "r", grants: [] },
];

export const DEVICE_MIGRATIONS = [
  ["202608200004-device-control", "devices", "a9fe5894b37074ab5d58cab69cbe223ec7cbcc1e01ccdd7c8b0bf4a39a4d6798"],
  ["202608200006-mutation-drain-ledger", "workspace/mutations", "80ef0c09a465dd6fff148b56317c362c55844ae9367c8cbb5bf6f30ae119bfe3"],
  ["202608200007-execution-fact-drain-ledger", "execution-ledger", "2547680b887a9cca48880ee58a19718f7fa280ac8652bf980a3d7aa29482deab"],
  ["202608200008-workspace-device-audit-drain-ledger", "audit", "ffe127b998592e820f99add0cb6a91a2eeecf173b6a7b16b353da9d9f0ff355f"],
];

export const ROUTINE_EXPECTATIONS = [
  ["audit_append_workspace_device_drain_record(text,bigint,bigint,text,bytea,bytea,bytea)", false],
  ["audit_install_workspace_device_drain_seal(text)", true],
  ["audit_recompute_workspace_device_drain_head(text,bigint)", false],
  ["device_consume_drain_proof(text,bytea,text,bigint,text)", true],
  ["device_read_just_consumed_drain_proof(text)", false],
  ["execution_fact_drain_append_record(text,bigint,bigint,bytea,bytea,text,text)", true],
  ["execution_fact_drain_install_accepted_seal(text)", true],
  ["execution_fact_drain_recompute_head(text,bigint)", false],
  ["workspace_mutation_drain_append_record(text,bigint,bigint,bytea)", true],
  ["workspace_mutation_drain_assert_active_domain(text,bigint)", false],
  ["workspace_mutation_drain_lock_domain(text,bigint)", true],
  ["workspace_mutation_drain_recompute_head(text,bigint)", false],
].map(([routine, appExecute]) => ({
  routine,
  owner: "gooddealer_cloud_owner",
  appExecute,
  publicExecute: false,
  securityDefiner: true,
  configuration: ["search_path=pg_catalog, public"],
}));

export const IMMUTABLE_TRIGGER_EXPECTATIONS = [
  ["execution_fact_drain_records", "execution_fact_drain_records_immutable", "execution_fact_drain_reject_immutable_change()"],
  ["execution_fact_drain_seals", "execution_fact_drain_seals_immutable", "execution_fact_drain_reject_immutable_change()"],
  ["mutation_drain_records", "mutation_drain_records_immutable", "workspace_mutation_drain_reject_immutable_row()"],
  ["mutation_drain_seals", "mutation_drain_seals_immutable", "workspace_mutation_drain_reject_immutable_row()"],
  ["workspace_device_audit_drain_records", "workspace_device_audit_drain_records_immutable", "audit_reject_workspace_device_drain_immutable_mutation()"],
  ["workspace_device_audit_drain_seals", "workspace_device_audit_drain_seals_immutable", "audit_reject_workspace_device_drain_immutable_mutation()"],
].map(([table, trigger, routine]) => ({ table, trigger, routine, enabled: "O" }));

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();

function main() {
  const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
  const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    throw new Error("unqualified diagnostic mode cannot produce evidence");
  }
  const ownerServerVersion = psql(ownerUrl, "SHOW server_version");
  const appServerVersion = psql(appUrl, "SHOW server_version");
  if (!isPostgres184(ownerServerVersion)) throw new Error(`PostgreSQL 18.6 required, received ${ownerServerVersion}`);
  if (!isPostgres184(appServerVersion)) {
    throw new Error(`PostgreSQL 18.6 required from app endpoint, received ${appServerVersion}`);
  }
  const ownerDatabaseIdentity = databaseIdentity(ownerUrl);
  const appDatabaseIdentity = databaseIdentity(appUrl);
  if (!sameDatabaseIdentity(ownerDatabaseIdentity, appDatabaseIdentity)) {
    throw new Error("owner and app PostgreSQL endpoints must bind to the same immutable database identity");
  }
  const ownerRole = psql(ownerUrl, "SELECT current_user");
  const appRole = psql(appUrl, "SELECT current_user");
  const postgresTests = observeVitest();
  const inputs = DEVICES_PERSISTENCE_INPUT_PATHS.map((path) => ({ path, sha256: sha256(read(path)) }));
  const transition = read("apps/cloud/src/modules/devices/postgres-drain-transition.ts");
  const productionSources = [
    transition,
    read("apps/cloud/src/modules/workspace/mutations/postgres-drain-ledger.ts"),
    read("apps/cloud/src/modules/execution-ledger/postgres-drain-ledger.ts"),
    read("apps/cloud/src/modules/audit/postgres-workspace-device-drain-ledger.ts"),
  ].join("\n");
  const ports = read("apps/cloud/src/modules/devices/ports.ts");
  const publicRoutes = read("apps/cloud/src/entrypoints/routes/public/boundary.ts");
  const adminRoutes = read("apps/cloud/src/entrypoints/routes/admin/boundary.ts");
  const jobs = read("apps/cloud/src/entrypoints/jobs.ts");
  const tauriErrors = tauriCommandPolicyErrors({ root });
  if (tauriErrors.length > 0) throw new Error(tauriErrors.join("\n"));
  const commit = run("git", ["rev-parse", "HEAD"]).trim();
  const dirty = run("git", ["status", "--porcelain"]).trim().length > 0;
  const report = {
    schemaVersion: 1,
    slice: "devices-persistence",
    passed: true,
    closesGate: false,
    repository: { commit, dirty },
    database: {
      ownerServerVersion,
      appServerVersion,
      ownerDatabaseIdentity,
      appDatabaseIdentity,
      ownerRole,
      appRole,
      roles: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY name)::text, '[]') FROM (
        SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls",
               rolcreaterole AS "createRole", rolcreatedb AS "createDb", rolreplication AS replication
        FROM pg_roles
        WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')) r`),
      roleMemberships: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY member, role)::text, '[]') FROM (
        SELECT member_role.rolname AS member, granted_role.rolname AS role,
               membership.admin_option AS "adminOption", membership.inherit_option AS "inheritOption",
               membership.set_option AS "setOption"
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
        WHERE member_role.rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')
          OR granted_role.rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')) r`),
      defaultAclGrants: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY scope, "objectType")::text, '[]') FROM (
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
      ) r`),
      schemaPrivileges: queryJson(ownerUrl, `SELECT row_to_json(s)::text FROM (
        SELECT
          has_schema_privilege('gooddealer_cloud_app', 'public', 'CREATE') AS "appCreate",
          has_schema_privilege('gooddealer_cloud_app', 'public', 'USAGE') AS "appUsage",
          has_schema_privilege('public', 'public', 'CREATE') AS "publicCreate",
          has_schema_privilege('public', 'public', 'USAGE') AS "publicUsage",
          has_schema_privilege('gooddealer_cloud_owner', 'public', 'USAGE') AS "ownerUsage"
      ) s`),
      rowLevelSecurity: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "table")::text, '[]') FROM (
        SELECT relname AS "table", relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
        WHERE relname IN (${DEVICE_PERSISTENCE_TABLES.map((table) => `'${table}'`).join(", ")})) r`),
      migrations: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY id)::text, '[]') FROM (
        SELECT id, owner_module AS owner, checksum FROM gooddealer_cloud_migrations
        WHERE id IN (${DEVICE_MIGRATIONS.map(([id]) => `'${id}'`).join(", ")})) r`),
      hardenedTablePrivileges: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "table")::text, '[]') FROM (
        SELECT relname AS "table", pg_get_userbyid(relowner) AS owner,
               has_table_privilege('gooddealer_cloud_app', oid, 'SELECT') AS "canSelect",
               has_table_privilege('gooddealer_cloud_app', oid, 'INSERT') AS "canInsert",
               has_table_privilege('gooddealer_cloud_app', oid, 'UPDATE') AS "canUpdate",
               has_table_privilege('gooddealer_cloud_app', oid, 'DELETE') AS "canDelete",
               has_table_privilege('gooddealer_cloud_app', oid, 'TRUNCATE') AS "canTruncate",
               has_table_privilege('gooddealer_cloud_app', oid, 'REFERENCES') AS "canReferences",
               has_table_privilege('gooddealer_cloud_app', oid, 'TRIGGER') AS "canTrigger"
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname IN (${HARDENED_DRAIN_TABLES.map((table) => `'${table}'`).join(", ")})) r`),
      routines: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY routine)::text, '[]') FROM (
        SELECT p.oid::regprocedure::text AS routine, pg_get_userbyid(p.proowner) AS owner,
               has_function_privilege('gooddealer_cloud_app', p.oid, 'EXECUTE') AS "appExecute",
               has_function_privilege('public', p.oid, 'EXECUTE') AS "publicExecute",
               p.prosecdef AS "securityDefiner", coalesce(p.proconfig, ARRAY[]::text[]) AS configuration
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.oid::regprocedure::text IN (${ROUTINE_EXPECTATIONS.map(({ routine }) => `'${routine}'`).join(", ")})) r`),
      immutableTriggers: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "table", trigger)::text, '[]') FROM (
        SELECT c.relname AS "table", t.tgname AS trigger, p.oid::regprocedure::text AS routine,
               t.tgenabled::text AS enabled
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        JOIN pg_proc AS p ON p.oid = t.tgfoid
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
          AND c.relname IN (${IMMUTABLE_TRIGGER_EXPECTATIONS.map(({ table }) => `'${table}'`).join(", ")})) r`),
    },
    tests: { postgres: postgresTests },
    productionSurfaces: {
      publicBusinessRoutes: /publicBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(publicRoutes) ? 0 : -1,
      adminBusinessRoutes: /adminBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(adminRoutes) ? 0 : -1,
      periodicJobs: /periodicJobs:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(jobs) ? 0 : -1,
      tauriCommands: [],
      leaseSigner: /class DenyingLeaseSigner implements LeaseSignerPort/u.test(ports) ? "DenyingLeaseSigner" : "unresolved",
      drainSignatureSuccessVariants: /readonly verified:\s*true/u.test(ports) ? 1 : 0,
      cursorWrites: /retireCursor|workspace_device_cursors/u.test(transition) ? 1 : 0,
      currentEpochWrites: /SET\s+current_lease_epoch|current_lease_epoch\s*=/iu.test(transition) ? 1 : 0,
      networkPrimitives: /\b(?:fetch|WebSocket|https?\.request|node:https?|undici)\b/u.test(productionSources) ? 1 : 0,
      leaseIssuanceCalls: /signActiveDeviceLease|issued:\s*true/u.test(transition) ? 1 : 0,
    },
    gates: { "R0-05": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress" },
    inputs,
    inputSetDigest: digestInputs(inputs),
  };
  if (!devicesPersistenceReportPassesPolicy(report)) throw new Error("devices persistence report failed policy");
  const output = resolve(root, ".artifacts/wp2/devices-persistence/devices-persistence-report.json");
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

export function devicesPersistenceReportPassesPolicy(value) {
  return value?.schemaVersion === 1 && value.slice === "devices-persistence" && value.passed === true
    && value.closesGate === false
    && /^[0-9a-f]{40}$/u.test(value.repository?.commit) && value.repository?.dirty === false
    && isPostgres184(value.database?.ownerServerVersion)
    && isPostgres184(value.database?.appServerVersion)
    && sameDatabaseIdentity(value.database?.ownerDatabaseIdentity, value.database?.appDatabaseIdentity)
    && value.database?.ownerRole === "gooddealer_cloud_owner"
    && value.database?.appRole === "gooddealer_cloud_app"
    && exactJson(value.database?.roles, ROLE_EXPECTATIONS)
    && exactJson(value.database?.roleMemberships, ROLE_MEMBERSHIP_EXPECTATIONS)
    && exactJson(value.database?.defaultAclGrants, DEFAULT_ACL_GRANT_EXPECTATIONS)
    && exactJson(value.database?.schemaPrivileges, {
      appCreate: false, appUsage: true, publicCreate: false, publicUsage: false, ownerUsage: true,
    })
    && exactJson(value.database?.rowLevelSecurity,
      DEVICE_PERSISTENCE_TABLES.map((table) => ({ table, enabled: true, forced: true })).sort(byTable))
    && exactMigrations(value.database?.migrations)
    && exactHardenedTablePrivileges(value.database?.hardenedTablePrivileges)
    && exactJson(value.database?.routines, ROUTINE_EXPECTATIONS)
    && exactJson(value.database?.immutableTriggers, IMMUTABLE_TRIGGER_EXPECTATIONS)
    && exactTestObservation(value.tests?.postgres)
    && exactJson(value.productionSurfaces, {
      publicBusinessRoutes: 0, adminBusinessRoutes: 0, periodicJobs: 0,
      tauriCommands: [], leaseSigner: "DenyingLeaseSigner",
      drainSignatureSuccessVariants: 0, cursorWrites: 0, currentEpochWrites: 0,
      networkPrimitives: 0, leaseIssuanceCalls: 0,
    })
    && exactJson(value.gates, { "R0-05": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress" })
    && exactInputs(value.inputs) && value.inputSetDigest === digestInputs(value.inputs);
}

export function digestInputs(inputs) {
  if (!Array.isArray(inputs)) return "";
  return sha256(inputs.map(({ path, sha256: digest }) => `${path}\0${digest}`).join("\0"));
}

function exactMigrations(value) {
  return exactJson(value, DEVICE_MIGRATIONS.map(([id, owner, checksum]) => ({ id, owner, checksum })));
}

function exactHardenedTablePrivileges(value) {
  return exactJson(value, HARDENED_DRAIN_TABLES.map((table) => ({
    table,
    owner: "gooddealer_cloud_owner",
    canSelect: true,
    canInsert: false,
    canUpdate: false,
    canDelete: false,
    canTruncate: false,
    canReferences: false,
    canTrigger: false,
  })));
}

function exactTestObservation(value) {
  const expectedFiles = POSTGRES_DRAIN_TEST_FILES.map(({ file, names }) => ({
    file,
    success: true,
    total: names.length,
    passed: names.length,
    failed: 0,
    names,
  }));
  const expectedTotal = expectedFiles.reduce((total, file) => total + file.total, 0);
  return value?.success === true && value.total === expectedTotal && value.passed === expectedTotal
    && value.failed === 0 && exactJson(value.files, expectedFiles)
    && value.files.every(({ names }) => new Set(names).size === names.length);
}

function exactInputs(value) {
  return Array.isArray(value) && value.length === DEVICES_PERSISTENCE_INPUT_PATHS.length
    && new Set(value.map(({ path }) => path)).size === value.length
    && value.every(({ path, sha256: digest }, index) => path === DEVICES_PERSISTENCE_INPUT_PATHS[index]
      && /^[0-9a-f]{64}$/u.test(digest) && digest === sha256(read(path)));
}

function observeVitest() {
  const result = JSON.parse(run("pnpm", ["--filter", "@gooddealer/cloud", "exec", "vitest", "run",
    "--config", "vitest.postgres.config.ts", ...POSTGRES_DRAIN_TEST_FILES.map(({ file }) => file), "--reporter=json"]));
  if (result.success !== true || result.testResults?.length !== POSTGRES_DRAIN_TEST_FILES.length) {
    throw new Error("targeted Vitest evidence is incomplete");
  }
  const files = result.testResults.map((testResult) => ({
    file: String(testResult.name).split("/apps/cloud/").at(-1),
    success: testResult.status === "passed",
    total: testResult.assertionResults.length,
    passed: testResult.assertionResults.filter(({ status }) => status === "passed").length,
    failed: testResult.assertionResults.filter(({ status }) => status !== "passed").length,
    names: testResult.assertionResults.map(({ title }) => title),
  })).sort((left, right) => POSTGRES_DRAIN_TEST_FILES.findIndex(({ file }) => file === left.file)
    - POSTGRES_DRAIN_TEST_FILES.findIndex(({ file }) => file === right.file));
  return {
    success: result.success,
    total: result.numTotalTests,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    files,
  };
}

function queryJson(ownerUrl, sql) { return JSON.parse(psql(ownerUrl, sql)); }
function databaseIdentity(url) {
  return queryJson(url, `SELECT row_to_json(identity)::text FROM (
    SELECT (pg_catalog.pg_control_system()).system_identifier::text AS "systemIdentifier",
           pg_catalog.current_database() AS "databaseName",
           (SELECT database.oid::text FROM pg_catalog.pg_database AS database
            WHERE database.datname = pg_catalog.current_database()) AS "databaseOid"
  ) AS identity`);
}
function psql(url, sql) { return run("psql", [url, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql]).trim(); }
function read(path) { const absolutePath = resolve(root, path); const stat = lstatSync(absolutePath); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`required input is not a regular file: ${path}`); return readFileSync(absolutePath, "utf8"); }
function run(command, arguments_) { if (!new Set(["git", "pnpm", "psql"]).has(command)) throw new Error(`unapproved executable: ${command}`); const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }); if (result.error || result.signal || result.status !== 0) throw new Error(`subprocess failed: ${command}`); return result.stdout; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function exactJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function isPostgres184(value) { return typeof value === "string" && /^18\.6(?:\D|$)/u.test(value); }
function sameDatabaseIdentity(left, right) {
  return isDatabaseIdentity(left) && exactJson(left, right);
}
function isDatabaseIdentity(value) {
  return value !== null && typeof value === "object"
    && typeof value.systemIdentifier === "string" && /^[0-9]+$/u.test(value.systemIdentifier)
    && typeof value.databaseName === "string" && value.databaseName.length > 0
    && typeof value.databaseOid === "string" && /^[1-9][0-9]*$/u.test(value.databaseOid);
}
function byTable(left, right) { return left.table.localeCompare(right.table); }
function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required; PostgreSQL evidence never skips`);
  return value;
}
