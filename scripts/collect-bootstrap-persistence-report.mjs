import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const root = resolve(import.meta.dirname, "..");

export const BOOTSTRAP_PORTABLE_TEST_NAMES = [
  "hardwires no-argument Denying verification and Lease signing",
  "rejects accessor and custom-prototype input before querying a verification key",
  "cryptographically admits only the fixed-purpose fixture presentation and binds its owner",
  "keeps signed readiness all-or-none and cursor generations historical",
  "keeps one active device cursor per tenant workspace in the ordered cursor migration",
  "does not import fixture key or signer support from production source",
];
export const BOOTSTRAP_POSTGRES_TEST_NAMES = [
  "lands Bootstrap and cursor authority in their consolidated owner snapshots",
  "forces tenant RLS on every new authority table under non-bypass roles",
  "binds authority to signed capability and pending epoch with compound foreign keys",
  "retains cursor history with generation in the primary key and one active workspace row",
  "rejects a second active device cursor in one tenant workspace while allowing distinct scopes",
  "persists pin and returns byte-identical replay after service reconstruction with zero port calls",
  "rejects a same-step different canonical request before workspace ports",
  "rolls back nonce, pin-side writes, ledger, and workflow revision on an injected write-boundary fault",
  "production Lease signing denial changes zero rows and never reaches cursor or pin release ports",
  "fixture signer installs every activation effect atomically and creates a new cursor generation",
  "fixture activation fault rolls back Lease Epoch capability workflow attempt pin and cursors together",
];
export const BOOTSTRAP_TABLES = [
  "device_bootstrap_activation_attempts", "device_bootstrap_authorities", "device_bootstrap_step_nonces",
];
export const BOOTSTRAP_MIGRATIONS = [
  ["202608200004-device-control", "devices"],
  ["202608200005-device-cursors", "workspace/cursors"],
];
export const BOOTSTRAP_INPUT_PATHS = [
  "packages/protocol/src/devices/device-identity.ts",
  "packages/protocol/src/devices/bootstrap-steps.ts",
  "packages/protocol/test-vectors/bootstrap-crypto/ed25519-fixture.json",
  "packages/protocol/test-vectors/bootstrap-rebuild/domain-asset-v1.json",
  "packages/client-core/src/sync/index.ts",
  "apps/cloud/src/db/migrations.ts",
  "apps/cloud/src/modules/devices/index.ts",
  "apps/cloud/src/modules/devices/bootstrap-capability-verifier.ts",
  "apps/cloud/src/modules/devices/bootstrap-persistence-ports.ts",
  "apps/cloud/src/modules/devices/postgres-bootstrap-step-service.ts",
  "apps/cloud/src/modules/devices/postgres-bootstrap-activation.ts",
  "apps/cloud/src/modules/devices/migrations/202608200004-device-control.ts",
  "apps/cloud/src/modules/workspace/checkpoints/bootstrap-port.ts",
  "apps/cloud/src/modules/workspace/mutations/bootstrap-port.ts",
  "apps/cloud/src/modules/workspace/state/portfolio/bootstrap-port.ts",
  "apps/cloud/src/modules/workspace/cursors/postgres-repository.ts",
  "apps/cloud/src/modules/workspace/cursors/migrations/202608200005-device-cursors.ts",
  "apps/cloud/test/bootstrap-persistence-boundary.test.ts",
  "apps/cloud/test/postgres/bootstrap-persistence.test.ts",
  "scripts/collect-bootstrap-persistence-report.mjs",
  "scripts/bootstrap-persistence-evidence-policy.test.mjs",
  ".github/workflows/wp2-bootstrap-persistence.yml",
  "docs/ACCOUNT_AND_SYNC.md",
  "docs/ENGINEERING_STRUCTURE.md",
  "docs/phase0/PHASE0_EXECUTION_PLAN.md",
  "docs/phase0/PHASE0_GATE_REGISTER.md",
  "docs/phase0/PHASE0_SECURE_HOST_BASELINE.md",
  "pnpm-lock.yaml",
  "package.json",
];

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();

function main() {
  const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
  requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    throw new Error("unqualified diagnostic mode cannot produce Bootstrap persistence evidence");
  }
  const serverVersion = psql(ownerUrl, "SHOW server_version");
  if (!/^18\.6(?:\D|$)/u.test(serverVersion)) throw new Error(`PostgreSQL 18.6 required, received ${serverVersion}`);
  const portable = observeVitest(["test/bootstrap-persistence-boundary.test.ts"],
    "test/bootstrap-persistence-boundary.test.ts");
  const postgres = observeVitest(["--config", "vitest.postgres.config.ts",
    "test/postgres/bootstrap-persistence.test.ts"], "test/postgres/bootstrap-persistence.test.ts");
  const inputs = BOOTSTRAP_INPUT_PATHS.map((path) => ({ path, sha256: sha256(read(path)) }));
  const verifier = read("apps/cloud/src/modules/devices/bootstrap-capability-verifier.ts");
  const activation = read("apps/cloud/src/modules/devices/postgres-bootstrap-activation.ts");
  const drain = read("apps/cloud/src/modules/devices/postgres-drain-transition.ts");
  const publicRoutes = read("apps/cloud/src/entrypoints/routes/public/boundary.ts");
  const adminRoutes = read("apps/cloud/src/entrypoints/routes/admin/boundary.ts");
  const jobs = read("apps/cloud/src/entrypoints/jobs.ts");
  const tauriErrors = tauriCommandPolicyErrors({ root });
  if (tauriErrors.length > 0) throw new Error(tauriErrors.join("\n"));
  const report = {
    schemaVersion: 1, slice: "bootstrap-persistence", passed: true, closesGate: false,
    repository: { commit: run("git", ["rev-parse", "HEAD"]).trim(),
      dirty: run("git", ["status", "--porcelain"]).trim().length > 0 },
    database: {
      serverVersion,
      roles: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY name)::text, '[]') FROM (
        SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls" FROM pg_roles
        WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')) r`),
      rowLevelSecurity: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY "table")::text, '[]') FROM (
        SELECT relname AS "table", relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
        WHERE relname IN (${BOOTSTRAP_TABLES.map((table) => `'${table}'`).join(", ")})) r`),
      migrations: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(r) ORDER BY id)::text, '[]') FROM (
        SELECT id, owner_module AS owner, checksum FROM gooddealer_cloud_migrations
        WHERE id IN (${BOOTSTRAP_MIGRATIONS.map(([id]) => `'${id}'`).join(", ")})) r`),
    },
    tests: { portable, postgres },
    production: {
      fixtureOnly: true,
      productionComposition: false,
      productionLeaseIssued: false,
      normalHandoffEnabled: false,
      verifier: /class DenyingBootstrapVerificationKeySource/u.test(verifier) ? "Denying" : "unresolved",
      leaseSigner: /class DenyingActiveDeviceLeaseSigner/u.test(activation) ? "Denying" : "unresolved",
      drainSignedReadyWrites: /canonical_signed_envelope|signed_envelope_digest|signing_key_id|ready_at/u.test(drain) ? 1 : 0,
      publicBusinessRoutes: /publicBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(publicRoutes) ? 0 : -1,
      adminBusinessRoutes: /adminBusinessRoutes:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(adminRoutes) ? 0 : -1,
      periodicJobs: /periodicJobs:\s*readonly\s*\[\]\s*=\s*\[\]/u.test(jobs) ? 0 : -1,
      tauriCommands: [],
      fixtureImportsFromSource: sourceFixtureImportCount(),
    },
    gates: { "R0-05": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress" },
    inputs, inputSetDigest: digestInputs(inputs),
  };
  if (!bootstrapPersistenceReportPassesPolicy(report)) throw new Error("Bootstrap persistence report failed policy");
  const output = resolve(root, ".artifacts/wp2/bootstrap-persistence/bootstrap-persistence-report.json");
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

export function bootstrapPersistenceReportPassesPolicy(value) {
  return value?.schemaVersion === 1 && value.slice === "bootstrap-persistence" && value.passed === true
    && value.closesGate === false && /^[0-9a-f]{40}$/u.test(value.repository?.commit) && value.repository?.dirty === false
    && /^18\.6(?:\D|$)/u.test(value.database?.serverVersion)
    && exact(value.database?.roles, [{ name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
      { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false }])
    && exact(value.database?.rowLevelSecurity,
      BOOTSTRAP_TABLES.map((table) => ({ table, enabled: true, forced: true })).sort(byTable))
    && exactMigrations(value.database?.migrations)
    && exactObservation(value.tests?.portable, "test/bootstrap-persistence-boundary.test.ts", BOOTSTRAP_PORTABLE_TEST_NAMES)
    && exactObservation(value.tests?.postgres, "test/postgres/bootstrap-persistence.test.ts", BOOTSTRAP_POSTGRES_TEST_NAMES)
    && exact(value.production, { fixtureOnly: true, productionComposition: false, productionLeaseIssued: false,
      normalHandoffEnabled: false, verifier: "Denying", leaseSigner: "Denying", drainSignedReadyWrites: 0,
      publicBusinessRoutes: 0, adminBusinessRoutes: 0, periodicJobs: 0, tauriCommands: [],
      fixtureImportsFromSource: 0 })
    && exact(value.gates, { "R0-05": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress" })
    && exactInputs(value.inputs) && value.inputSetDigest === digestInputs(value.inputs);
}

export function digestInputs(inputs) {
  return Array.isArray(inputs) ? sha256(inputs.map(({ path, sha256: digest }) => `${path}\0${digest}`).join("\0")) : "";
}
function exactMigrations(value) { return Array.isArray(value) && value.length === BOOTSTRAP_MIGRATIONS.length
  && value.every((row, index) => row.id === BOOTSTRAP_MIGRATIONS[index][0] && row.owner === BOOTSTRAP_MIGRATIONS[index][1]
    && /^[0-9a-f]{64}$/u.test(row.checksum)); }
function exactObservation(value, file, names) { return value?.file === file && value.success === true
  && value.total === names.length && value.passed === names.length && value.failed === 0
  && exact(value.names, names) && new Set(value.names).size === names.length; }
function exactInputs(value) { return Array.isArray(value) && value.length === BOOTSTRAP_INPUT_PATHS.length
  && new Set(value.map(({ path }) => path)).size === value.length
  && value.every(({ path, sha256: digest }, index) => path === BOOTSTRAP_INPUT_PATHS[index]
    && digest === sha256(read(path))); }
function observeVitest(arguments_, expectedFile) { const result = JSON.parse(run("pnpm", ["--filter", "@gooddealer/cloud", "exec",
  "vitest", "run", ...arguments_, "--reporter=json"])); if (result.success !== true || result.testResults?.length !== 1) throw new Error("exact Bootstrap Vitest observation failed");
  const testResult = result.testResults[0]; const file = String(testResult.name).split("/apps/cloud/").at(-1);
  if (file !== expectedFile) throw new Error("Bootstrap Vitest observed the wrong file");
  return { file, success: true, total: result.numTotalTests, passed: result.numPassedTests,
    failed: result.numFailedTests, names: testResult.assertionResults.map(({ title }) => title) }; }
function sourceFixtureImportCount() { return BOOTSTRAP_INPUT_PATHS.filter((path) => path.startsWith("apps/cloud/src/"))
  .map(read).filter((source) => /test\/support|test-vectors\/bootstrap-crypto/u.test(source)).length; }
function queryJson(url, sql) { return JSON.parse(psql(url, sql)); }
function psql(url, sql) { return run("psql", [url, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql]).trim(); }
function read(path) {
  const absolutePath = resolve(root, path);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`required input is not a regular file: ${path}`);
  return readFileSync(absolutePath, "utf8");
}
function run(command, arguments_) {
  if (!new Set(["git", "pnpm", "psql"]).has(command)) throw new Error(`unapproved executable: ${command}`);
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`subprocess failed: ${command}`);
  }
  return result.stdout;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function exact(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function byTable(left, right) { return left.table.localeCompare(right.table); }
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required; evidence never skips`); return value; }
