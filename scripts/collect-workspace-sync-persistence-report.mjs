import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const root = resolve(import.meta.dirname, "..");

export const POSTGRES_WORKSPACE_SYNC_TESTS = Object.freeze({
  "test/postgres/persistence.test.ts": [
    "runs qualifying evidence only on PostgreSQL 18.6",
    "matches the shared domain-asset corpus digest through the real PostgreSQL projection",
    "keeps a failing post-catalog migration and its ledger row atomic",
    "rejects unknown, non-prefix, owner, and checksum drift before the next migration executes",
    "isolates identical literal ids and clears scope across pooled commit and rollback reuse",
    "rejects invalid scope before acquiring a pool connection",
    "blocks direct cross-tenant writes and cross-tenant foreign keys through forced RLS",
    "keeps unimplemented replica families read-only for the application role",
    "rejects direct projection CAS when no dense mutation-log prefix exists",
    "rejects a projection-only revision advance before materialization",
  ],
  "test/postgres/device-drain-persistence.test.ts": [
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
  ],
  "test/postgres/workspace-mutation-persistence.test.ts": [
    "qualifies only PostgreSQL 18.6 and forces tenant RLS on every owner table",
    "rejects replay and receipt rows that remain ahead of the committed workspace head",
    "denies direct app-role watermark and replay deletion bypasses",
    "persists strict receipts, replay fields, and the Drain head in one transaction",
    "persists an explicit DomainAsset deletion without manufacturing changed fields",
    "orchestrates authority, Drain, revision, state, receipt, and replay atomically without production composition",
    "rejects hidden symbol accessor inherited custom-prototype and sparse wire values before tenant transaction entry",
    "rejects expired Lease authority at the database-time boundary before mutation state changes",
    "binds direct app drain routines to the current active device Lease and proof-only sealing",
    "serializes a real Drain transition against mutation ingest with one coherent winner",
    "rolls materialization, receipt, replay, Drain, and revision back together on service faults",
    "serializes concurrent duplicates and stale same-field writers while preserving different-field progress",
    "keeps receipts and Drain evidence permanently when replay rows are compacted",
    "preserves gap semantics and advances the rolling digest only over a complete prefix",
    "isolates identical ids and rejects forged tenant writes",
    "rejects conflicting receipts and malformed persisted replay rather than returning partial data",
    "rolls every mutation table and Drain head back on injected faults",
  ],
  "test/postgres/workspace-reader-cursor-persistence.test.ts": [
    "pins the first-page head and gives one concurrent CAS presentation a single winner",
    "rejects stale generation, row version, and continuation token without reading a page",
    "uses database transaction time and retires at the exact TTL boundary",
    "rejects an invalid stored page digest without advancing or returning a partial page",
    "rejects malformed input before opening a transaction or invoking a page query",
    "rejects non-ordinary ReaderCursor wire values before withTenant without invoking getters",
    "retires a compaction race, reopens only from a valid baseline, and increments generation",
    "makes device removal terminal and keeps its transaction-aware retirement rollback-safe",
    "retires expired cursors before reporting the compaction minimum and isolates tenants",
    "has compound tenant FKs, ENABLE plus FORCE RLS, and the documented DeviceCursor strengthening",
  ],
  "test/postgres/workspace-checkpoint-persistence.test.ts": [
    "uses compound tenant keys with forced RLS on every checkpoint-owned table",
    "builds immutable snapshots and permits only verified publication",
    "serializes checkpoint build before concurrent persisted ingest",
    "rejects immutable checkpoint identifier and pin binding mismatches",
    "rejects secret-bearing and cross-workspace checkpoint snapshots before storage",
    "has one verification CAS winner and marks tampered persisted snapshots invalid",
    "isolates identical checkpoint ids across tenants",
    "never supersedes the last usable or an actively pinned checkpoint",
    "fails compaction closed when Recovery authority is absent before replay deletion",
    "lets the DeviceCursor watermark independently block compaction",
    "lets the ReaderCursor watermark independently block compaction",
    "lets the Recovery Candidate watermark independently block compaction",
    "lets an active checkpoint pin independently block compaction",
    "rolls replay deletion and watermark back together while preserving receipts and Drain evidence",
    "compacts only replay rows while preserving receipts and Drain proof state",
    "rolls replay deletion and watermark back together after a compaction fault",
    "rebuilds persisted checkpoints deterministically in a read-only tenant snapshot",
    "rejects a corrupt persisted checkpoint snapshot during service rebuild",
    "rejects missing and corrupt persisted mutation ranges during service rebuild",
    "replays a complete ordered range deterministically",
    "rejects missing duplicate reordered and corrupt persisted mutation ranges",
  ],
});

export const WORKSPACE_SYNC_TABLES = Object.freeze([
  "workspace_checkpoint_diagnostics",
  "workspace_checkpoint_domain_assets",
  "workspace_checkpoint_entity_digests",
  "workspace_checkpoint_pins",
  "workspace_checkpoints",
  "workspace_mutation_fields",
  "workspace_mutation_receipts",
  "workspace_mutations",
  "workspace_reader_cursors",
]);

const REQUIRED_MIGRATIONS = [
  ["202608200005-device-cursors", "workspace/cursors"],
  ["202608200009-workspace-mutation-log", "workspace/mutations"],
  ["202608200010-workspace-checkpoints", "workspace/checkpoints"],
];
const optionalMigration = discoverCatalogRecoveryMigration();
export const WORKSPACE_SYNC_LEDGER_MIGRATIONS = Object.freeze([
  ...REQUIRED_MIGRATIONS,
  ...(optionalMigration === null ? [] : [[optionalMigration.id, optionalMigration.owner]]),
]);

const BASE_INPUT_PATHS = [
  "package.json",
  "apps/cloud/src/db/index.ts",
  "apps/cloud/src/db/migrations.ts",
  "apps/cloud/src/modules/devices/postgres-mutation-authority.ts",
  "apps/cloud/src/modules/workspace/revisions/index.ts",
  "apps/cloud/src/modules/workspace/revisions/postgres-repository.ts",
  "apps/cloud/src/modules/workspace/mutations/index.ts",
  "apps/cloud/src/modules/workspace/mutations/migrations/202608200009-workspace-mutation-log.ts",
  "apps/cloud/src/modules/workspace/mutations/postgres-drain-ledger.ts",
  "apps/cloud/src/modules/workspace/mutations/postgres-ingest-service.ts",
  "apps/cloud/src/modules/workspace/mutations/postgres-repository.ts",
  "apps/cloud/src/modules/workspace/cursors/index.ts",
  "apps/cloud/src/modules/workspace/cursors/migrations/202608200005-device-cursors.ts",
  "apps/cloud/src/modules/workspace/cursors/postgres-reader-cursor-repository.ts",
  "apps/cloud/src/modules/workspace/cursors/postgres-reader-cursor-service.ts",
  "apps/cloud/src/modules/workspace/checkpoints/index.ts",
  "apps/cloud/src/modules/workspace/checkpoints/migrations/202608200010-workspace-checkpoints.ts",
  "apps/cloud/src/modules/workspace/checkpoints/postgres-ports.ts",
  "apps/cloud/src/modules/workspace/checkpoints/postgres-repository.ts",
  "apps/cloud/src/modules/workspace/checkpoints/postgres-service.ts",
  "apps/cloud/src/modules/workspace/state/portfolio/index.ts",
  "apps/cloud/src/modules/workspace/state/portfolio/postgres-repository.ts",
  "packages/protocol/src/workspace/domain-asset-fields.ts",
  "packages/protocol/src/workspace/sync-mutation.ts",
  "packages/protocol/src/workspace/wire-envelope.ts",
  ...Object.keys(POSTGRES_WORKSPACE_SYNC_TESTS).map((path) => `apps/cloud/${path}`),
  "apps/cloud/src/entrypoints/routes/public/boundary.ts",
  "apps/cloud/src/entrypoints/routes/admin/boundary.ts",
  "apps/cloud/src/entrypoints/jobs.ts",
  "apps/cloud/src/entrypoints/http.ts",
  "apps/cloud/src/entrypoints/admin-http.ts",
  "apps/desktop/src-tauri/src/main.rs",
  "apps/desktop/src/app.tsx",
  "scripts/collect-workspace-sync-persistence-report.mjs",
  "scripts/workspace-sync-persistence-evidence-policy.test.mjs",
  ".github/workflows/wp2-workspace-sync-persistence.yml",
  "docs/ACCOUNT_AND_SYNC.md",
  "docs/ENGINEERING_STRUCTURE.md",
  "docs/phase0/PHASE0_EXECUTION_PLAN.md",
  "docs/phase0/PHASE0_GATE_REGISTER.md",
];
export const WORKSPACE_SYNC_PERSISTENCE_INPUT_PATHS = Object.freeze([
  ...BASE_INPUT_PATHS,
  ...(optionalMigration === null ? [] : [optionalMigration.path]),
]);

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();

function main() {
  const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
  requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    throw new Error("unqualified diagnostic mode cannot produce workspace sync persistence evidence");
  }
  const serverVersion = psql(ownerUrl, "SHOW server_version");
  if (!/^18\.6(?:\D|$)/u.test(serverVersion)) {
    throw new Error(`PostgreSQL 18.6 required, received ${serverVersion}`);
  }

  const tests = Object.fromEntries(Object.keys(POSTGRES_WORKSPACE_SYNC_TESTS).map((file) => [
    file,
    observeVitest(file),
  ]));
  const inputs = collectInputs();
  const publicRoutes = read("apps/cloud/src/entrypoints/routes/public/boundary.ts");
  const adminRoutes = read("apps/cloud/src/entrypoints/routes/admin/boundary.ts");
  const jobs = read("apps/cloud/src/entrypoints/jobs.ts");
  const tauriErrors = tauriCommandPolicyErrors({ root });
  if (tauriErrors.length > 0) throw new Error(tauriErrors.join("\n"));
  const productionComposition = [
    publicRoutes,
    adminRoutes,
    read("apps/cloud/src/entrypoints/http.ts"),
    read("apps/cloud/src/entrypoints/admin-http.ts"),
    jobs,
    read("apps/desktop/src/app.tsx"),
  ].join("\n");
  const roles = queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY name)::text, '[]') FROM (
    SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls" FROM pg_roles
    WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')) r`);
  const rowLevelSecurity = queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "table")::text, '[]') FROM (
    SELECT relname AS "table", relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
    WHERE relname IN (${WORKSPACE_SYNC_TABLES.map((table) => `'${table}'`).join(", ")})) r`);
  const migrations = queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY id)::text, '[]') FROM (
    SELECT id, owner_module AS owner, checksum FROM gooddealer_cloud_migrations
    WHERE id IN (${WORKSPACE_SYNC_LEDGER_MIGRATIONS.map(([id]) => `'${id}'`).join(", ")})) r`);
  const productionSurfaces = {
    publicBusinessRoutes: /publicBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(publicRoutes) ? 0 : -1,
    adminBusinessRoutes: /adminBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(adminRoutes) ? 0 : -1,
    periodicJobs: /periodicJobs:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(jobs) ? 0 : -1,
    tauriCommands: [],
    workspaceSyncCompositionReferences: /Postgres(?:Mutation|ReaderCursor|Checkpoint)|workspace\/(?:mutations|cursors|checkpoints)\/postgres/iu
      .test(productionComposition) ? 1 : 0,
  };
  const exactTestsPassed = Object.entries(tests).every(([file, observation]) =>
    exactTestObservation(observation, file, POSTGRES_WORKSPACE_SYNC_TESTS[file]));
  const exactRoles = exactJson(roles, expectedRoles());
  const exactRls = exactJson(rowLevelSecurity, expectedRls());
  const exactMigrationsObserved = exactMigrations(migrations);
  const productionClosed = exactJson(productionSurfaces, expectedProductionSurfaces());
  const report = {
    schemaVersion: 1,
    slice: "workspace-sync-persistence",
    passed: true,
    qualified: true,
    closesGate: false,
    repository: {
      commit: run("git", ["rev-parse", "HEAD"]).trim(),
      dirty: run("git", ["status", "--porcelain"]).trim().length > 0,
    },
    database: { serverVersion, roles, rowLevelSecurity, migrations },
    tests,
    signals: {
      postgresqlVersionPinned: true,
      rolesNonPrivileged: exactRoles,
      allNewTablesForceRls: exactRls,
      migrationLedgerBound: exactMigrationsObserved,
      exactSuitesPassed: exactTestsPassed,
      poolSelectorsCleared: hasPassedTest(
        tests["test/postgres/persistence.test.ts"],
        "isolates identical literal ids and clears scope across pooled commit and rollback reuse",
      ) && hasPassedTest(
        tests["test/postgres/device-drain-persistence.test.ts"],
        "fails closed for missing or wrong tenant scope and clears pooled selectors after commit and rollback",
      ),
      productionFallbacksClosed: productionClosed,
      sourceHashesBound: true,
    },
    platforms: [
      { id: "portable-evidence-policy", status: "Tested" },
      { id: "postgresql-18.6", status: "Tested" },
      { id: "production-composition", status: "Unlinked" },
    ],
    productionSurfaces,
    gates: [
      { id: "R0-04", status: "In Progress" },
      { id: "R0-05", status: "In Progress" },
      { id: "R0-09", status: "In Progress" },
      { id: "R0-15", status: "In Progress" },
      { id: "R0-16", status: "In Progress" },
    ],
    inputs,
    inputSetDigest: digestInputs(inputs),
  };
  if (!workspaceSyncPersistenceReportPassesPolicy(report)) {
    throw new Error("workspace sync persistence report failed policy");
  }
  const output = resolve(root, ".artifacts/wp2/workspace-sync-persistence/workspace-sync-persistence-report.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

export function workspaceSyncPersistenceReportPassesPolicy(value) {
  return exactKeys(value, [
    "schemaVersion", "slice", "passed", "qualified", "closesGate", "repository", "database", "tests",
    "signals", "platforms", "productionSurfaces", "gates", "inputs", "inputSetDigest",
  ])
    && value.schemaVersion === 1
    && value.slice === "workspace-sync-persistence"
    && value.passed === true
    && value.qualified === true
    && value.closesGate === false
    && exactKeys(value.repository, ["commit", "dirty"])
    && /^[0-9a-f]{40}$/u.test(value.repository.commit)
    && value.repository.dirty === false
    && exactKeys(value.database, ["serverVersion", "roles", "rowLevelSecurity", "migrations"])
    && /^18\.6(?:\D|$)/u.test(value.database.serverVersion)
    && exactJson(value.database.roles, expectedRoles())
    && exactJson(value.database.rowLevelSecurity, expectedRls())
    && exactMigrations(value.database.migrations)
    && exactTestSet(value.tests)
    && exactJson(value.signals, {
      postgresqlVersionPinned: true,
      rolesNonPrivileged: true,
      allNewTablesForceRls: true,
      migrationLedgerBound: true,
      exactSuitesPassed: true,
      poolSelectorsCleared: true,
      productionFallbacksClosed: true,
      sourceHashesBound: true,
    })
    && exactJson(value.platforms, [
      { id: "portable-evidence-policy", status: "Tested" },
      { id: "postgresql-18.6", status: "Tested" },
      { id: "production-composition", status: "Unlinked" },
    ])
    && exactJson(value.productionSurfaces, expectedProductionSurfaces())
    && exactJson(value.gates, [
      { id: "R0-04", status: "In Progress" },
      { id: "R0-05", status: "In Progress" },
      { id: "R0-09", status: "In Progress" },
      { id: "R0-15", status: "In Progress" },
      { id: "R0-16", status: "In Progress" },
    ])
    && exactInputs(value.inputs)
    && value.inputSetDigest === digestInputs(value.inputs);
}

export function digestInputs(inputs) {
  if (!Array.isArray(inputs)) return "";
  return sha256(inputs.map(({ path, bytes, sha256: digest }) => `${path}\0${bytes}\0${digest}`).join("\0"));
}

export function declaredVitestTestNames(source) {
  const declarations = [];
  for (const match of source.matchAll(/\bit\(\s*"([^"\n]+)"/gu)) {
    declarations.push({ index: match.index, names: [match[1]] });
  }
  for (const match of source.matchAll(/\bit\.each\(\s*\[([\s\S]*?)\]\s*\)\s*\(\s*"([^"\n]+)"/gu)) {
    const rowValues = [...match[1].matchAll(/\[\s*"([^"\n]+)"\s*,[^\]\n]*\]/gu)]
      .map((row) => row[1]);
    if (rowValues.length === 0 || (match[2].match(/%s/gu) ?? []).length !== 1) return [];
    declarations.push({
      index: match.index,
      names: rowValues.map((value) => match[2].replace("%s", value)),
    });
  }
  return declarations.sort((left, right) => left.index - right.index).flatMap(({ names }) => names);
}

function exactTestSet(value) {
  return exactKeys(value, Object.keys(POSTGRES_WORKSPACE_SYNC_TESTS))
    && Object.entries(POSTGRES_WORKSPACE_SYNC_TESTS).every(([file, names]) =>
      exactTestObservation(value[file], file, names));
}

function exactTestObservation(value, file, names) {
  return exactKeys(value, ["file", "success", "total", "passed", "failed", "names"])
    && value.file === file
    && value.success === true
    && value.total === names.length
    && value.passed === names.length
    && value.failed === 0
    && exactJson(value.names, names)
    && new Set(value.names).size === names.length;
}

function exactMigrations(value) {
  return Array.isArray(value)
    && value.length === WORKSPACE_SYNC_LEDGER_MIGRATIONS.length
    && value.every((row, index) => exactKeys(row, ["id", "owner", "checksum"])
      && row.id === WORKSPACE_SYNC_LEDGER_MIGRATIONS[index][0]
      && row.owner === WORKSPACE_SYNC_LEDGER_MIGRATIONS[index][1]
      && /^[0-9a-f]{64}$/u.test(row.checksum));
}

function exactInputs(value) {
  return Array.isArray(value)
    && value.length === WORKSPACE_SYNC_PERSISTENCE_INPUT_PATHS.length
    && new Set(value.map((input) => input?.path)).size === value.length
    && value.every((input, index) => {
      if (!exactKeys(input, ["path", "bytes", "sha256"])) return false;
      const path = WORKSPACE_SYNC_PERSISTENCE_INPUT_PATHS[index];
      const content = readBytes(path);
      return input.path === path
        && input.bytes === content.length
        && /^[0-9a-f]{64}$/u.test(input.sha256)
        && input.sha256 === sha256(content);
    });
}

function observeVitest(file) {
  const result = JSON.parse(run("pnpm", ["--filter", "@gooddealer/cloud", "exec", "vitest", "run",
    "--config", "vitest.postgres.config.ts", file, "--reporter=json"]));
  if (result.success !== true || result.testResults?.length !== 1) {
    throw new Error(`targeted Vitest evidence is incomplete for ${file}`);
  }
  const testResult = result.testResults[0];
  return {
    file: String(testResult.name).split("/apps/cloud/").at(-1),
    success: result.success,
    total: result.numTotalTests,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    names: testResult.assertionResults.map(({ title }) => title),
  };
}

function collectInputs() {
  return WORKSPACE_SYNC_PERSISTENCE_INPUT_PATHS.map((path) => {
    const content = readBytes(path);
    return { path, bytes: content.length, sha256: sha256(content) };
  });
}

function discoverCatalogRecoveryMigration() {
  const catalog = read("apps/cloud/src/db/migrations.ts");
  const match = /import\s*\{\s*(\w+)\s*\}\s*from\s*"([^"\n]*202608200011-restore-candidate-foundation[^"\n]*)"/u.exec(catalog);
  if (match === null) return null;
  const catalogBody = /cloudMigrations[^=]*=\s*\[([\s\S]*?)\]/u.exec(catalog)?.[1] ?? "";
  if (!new RegExp(`\\b${match[1]}\\b`, "u").test(catalogBody)) return null;
  const path = `apps/cloud/src/db/${match[2]}.ts`.split("/").reduce((parts, part) => {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
    return parts;
  }, []).join("/");
  const source = read(path);
  const id = /id:\s*"(202608200011-restore-candidate-foundation)"/u.exec(source)?.[1];
  const owner = /owner:\s*"([a-z0-9/-]+)"/u.exec(source)?.[1];
  if (id === undefined || owner === undefined) throw new Error("catalog recovery migration is malformed");
  return { path, id, owner };
}

function expectedRoles() {
  return [
    { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
    { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
  ];
}
function expectedRls() {
  return WORKSPACE_SYNC_TABLES.map((table) => ({ table, enabled: true, forced: true }));
}
function expectedProductionSurfaces() {
  return {
    publicBusinessRoutes: 0,
    adminBusinessRoutes: 0,
    periodicJobs: 0,
    tauriCommands: [],
    workspaceSyncCompositionReferences: 0,
  };
}
function hasPassedTest(observation, name) {
  return observation?.success === true && observation.names.includes(name);
}
function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && exactJson(Object.keys(value), keys);
}
function queryJson(ownerUrl, sql) { return JSON.parse(psql(ownerUrl, sql)); }
function psql(ownerUrl, sql) {
  return run("psql", [ownerUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
    "--tuples-only", "--no-align", "--command", sql]).trim();
}
function readBytes(path) {
  const absolutePath = resolve(root, path);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`required input is not a regular file: ${path}`);
  return readFileSync(absolutePath);
}
function read(path) { return readBytes(path).toString("utf8"); }
function run(command, arguments_) {
  if (!new Set(["git", "pnpm", "psql"]).has(command)) throw new Error(`unapproved executable: ${command}`);
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error || result.signal || result.status !== 0) throw new Error(`subprocess failed: ${command}`);
  return result.stdout;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function exactJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; PostgreSQL workspace sync evidence never skips`);
  }
  return value;
}
