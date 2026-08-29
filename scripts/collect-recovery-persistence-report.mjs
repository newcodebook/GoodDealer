import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const RECOVERY_TABLES = Object.freeze([
  "restore_candidate_requests",
  "restore_candidates",
]);

export const RECOVERY_PERSISTENCE_TEST_NAMES = Object.freeze([
  "uses FORCE RLS with the non-superuser non-BYPASSRLS application role",
  "derives candidate fields against the locked current baseline without mutating workspace state",
  "returns a byte-identical receipt for the same request and rejects workflow or backup digest conflicts",
  "isolates identical literal workflow backup and candidate ids across tenants",
  "keeps recovery evidence immutable to the application role",
  "serializes concurrent creators into one persistent request and candidate set",
  "enforces non-Apply lifecycle row-version CAS and exposes only unresolved non-expired watermark",
  "binds lifecycle CAS to tenant, status, baseline and complete authority provenance",
]);

export const RECOVERY_UNIT_TEST_NAMES = Object.freeze([
  "derives tenant, baseline, current hashes, ids, status and receipt from authority/current Cloud state",
  "rejects forged authority fields, noncanonical diff and bad field hashes before persistence",
  "keeps production authority denying and lifecycle Apply unrepresentable",
  "mints a frozen lifecycle capability only after the fixed verifier binds every command field",
  "rejects forged, revoked and command-mismatched lifecycle inputs before tenant or repository access",
  "rejects a structurally forged repository capability before SQL access",
]);

// This is a closed inventory. It intentionally excludes retired native, generated-registry,
// connector, keychain, and local-storage paths: recovery persistence is Cloud-owned.
export const RECOVERY_PERSISTENCE_INPUTS = Object.freeze([
  "packages/protocol/src/recovery/index.ts",
  "packages/protocol/test/recovery.test.ts",
  "packages/protocol/test-vectors/recovery/wire-corpus.json",
  "apps/cloud/src/db/migrations.ts",
  "apps/cloud/src/modules/recovery/index.ts",
  "apps/cloud/src/modules/recovery/migrations/202608200011-restore-candidate-foundation.ts",
  "apps/cloud/src/modules/recovery/postgres-restore-candidate-repository.ts",
  "apps/cloud/src/modules/recovery/restore-candidate-service.ts",
  "apps/cloud/test/postgres/recovery-candidate-persistence.test.ts",
  "apps/cloud/test/restore-candidate-service.test.ts",
  "apps/desktop/src-tauri/build.rs",
  "apps/desktop/src-tauri/src/main.rs",
  "apps/desktop/src-tauri/capabilities/local-app.json",
  "scripts/tauri-command-policy.mjs",
  "scripts/collect-recovery-persistence-report.mjs",
  "scripts/recovery-persistence-evidence-policy.test.mjs",
]);

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}

function main() {
  const inputErrors = recoveryPersistenceInputAdmissionErrors();
  if (inputErrors.length > 0) throw new Error(inputErrors.join("\n"));

  const desktopErrors = tauriCommandPolicyErrors({ root });
  if (desktopErrors.length > 0) throw new Error(desktopErrors.join("\n"));

  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC === "true") {
    throw new Error("diagnostic PostgreSQL execution cannot produce recovery persistence evidence");
  }
  const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
  requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  const serverVersion = psql(ownerUrl, "SHOW server_version");
  if (!/^18\.6(?:\D|$)/u.test(serverVersion)) {
    throw new Error(`PostgreSQL 18.6 required, received ${serverVersion}`);
  }

  const postgresTests = observeVitest(
    "test/postgres/recovery-candidate-persistence.test.ts",
    "vitest.postgres.config.ts",
  );
  const unitTests = observeVitest("test/restore-candidate-service.test.ts");
  const protocol = readRequiredInput("packages/protocol/src/recovery/index.ts");
  const recoveryIndex = readRequiredInput("apps/cloud/src/modules/recovery/index.ts");
  const recoveryService = readRequiredInput("apps/cloud/src/modules/recovery/restore-candidate-service.ts");
  const report = {
    schemaVersion: 1,
    slice: "recovery-persistence",
    passed: true,
    closesGate: false,
    database: {
      serverVersion,
      roles: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(x) ORDER BY name)::text, '[]') FROM (
        SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls"
        FROM pg_roles
        WHERE rolname IN ('gooddealer_cloud_app', 'gooddealer_cloud_owner')
      ) x`),
      rowLevelSecurity: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(x) ORDER BY "table")::text, '[]') FROM (
        SELECT relname AS "table", relrowsecurity AS enabled, relforcerowsecurity AS forced
        FROM pg_class
        WHERE relname IN ('restore_candidate_requests', 'restore_candidates')
      ) x`),
      migration: queryJson(ownerUrl, `SELECT coalesce(json_agg(row_to_json(x) ORDER BY id)::text, '[]') FROM (
        SELECT id, owner_module AS owner, checksum
        FROM gooddealer_cloud_migrations
        WHERE id = '202608200011-restore-candidate-foundation'
      ) x`),
    },
    tests: { postgres: postgresTests, unit: unitTests },
    recovery: {
      module: /export const recoveryModule\s*=\s*"persistence-foundation"/u.test(recoveryIndex)
        ? "persistence-foundation" : "unresolved",
      workflowAuthority: /class DenyingRecoveryWorkflowAuthority\b/u.test(recoveryService)
        ? "DenyingRecoveryWorkflowAuthority" : "unresolved",
      lifecycleTransitions: lifecycleTransitions(protocol),
    },
    desktop: { commandPolicyErrors: 0 },
    inputs: admittedInputRecords(),
  };
  report.inputSetDigest = digestInputs(report.inputs);
  if (!recoveryPersistenceReportPassesPolicy(report)) {
    throw new Error("recovery persistence report failed policy");
  }

  const output = resolve(root, ".artifacts/wp5/recovery-persistence/recovery-persistence-report.json");
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

function normalizedRepositoryPath(path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path)) {
    return null;
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized !== path || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  return normalized;
}

function exactArrayValues(value, expectedLength) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const expectedKeys = [...Array.from({ length: expectedLength }, (_, index) => String(index)), "length"];
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) return null;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || length.value !== expectedLength) return null;
  const values = [];
  for (let index = 0; index < expectedLength; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    values.push(descriptor.value);
  }
  return values;
}

function exactDataObject(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return null;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) return null;
  const values = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    values[key] = descriptor.value;
  }
  return values;
}

function regularInputPath(repositoryRoot, path) {
  const normalized = normalizedRepositoryPath(path);
  if (normalized === null) throw new Error(`recovery persistence input is not normalized: ${String(path)}`);
  const parts = normalized.split("/");
  let current = resolve(repositoryRoot);
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`recovery persistence input may not traverse a symbolic link: ${normalized}`);
    const finalPart = index === parts.length - 1;
    if (finalPart && !stat.isFile()) throw new Error(`recovery persistence input must be a regular file: ${normalized}`);
    if (!finalPart && !stat.isDirectory()) throw new Error(`recovery persistence input has a non-directory parent: ${normalized}`);
  }
  return current;
}

export function recoveryPersistenceInputAdmissionErrors({
  repositoryRoot = root,
  inputPaths = RECOVERY_PERSISTENCE_INPUTS,
} = {}) {
  const values = exactArrayValues(inputPaths, RECOVERY_PERSISTENCE_INPUTS.length);
  if (values === null) return ["recovery persistence input inventory must be an exact plain array"];
  const errors = [];
  for (const [index, path] of values.entries()) {
    const normalized = normalizedRepositoryPath(path);
    if (normalized === null) {
      errors.push(`recovery persistence input is not normalized: ${String(path)}`);
      continue;
    }
    if (normalized !== RECOVERY_PERSISTENCE_INPUTS[index]) {
      errors.push(`recovery persistence input is not admitted: ${normalized}`);
      continue;
    }
    try {
      regularInputPath(repositoryRoot, normalized);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `recovery persistence input is unreadable: ${normalized}`);
    }
  }
  return errors;
}

function readRequiredInput(path) {
  return readFileSync(regularInputPath(root, path), "utf8");
}

function admittedInputRecords() {
  const errors = recoveryPersistenceInputAdmissionErrors();
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return RECOVERY_PERSISTENCE_INPUTS.map((path) => {
    const source = readRequiredInput(path);
    return { path, bytes: Buffer.byteLength(source), sha256: sha256(source) };
  });
}

export function digestInputs(inputs) {
  const values = exactArrayValues(inputs, RECOVERY_PERSISTENCE_INPUTS.length);
  if (values === null) return "";
  const rows = [];
  for (const input of values) {
    const record = exactDataObject(input, ["path", "bytes", "sha256"]);
    if (record === null) return "";
    rows.push(`${record.path}\0${record.sha256}`);
  }
  return sha256(rows.join("\0"));
}

export function recoveryPersistenceReportPassesPolicy(value) {
  try {
    const report = exactDataObject(value, [
      "schemaVersion",
      "slice",
      "passed",
      "closesGate",
      "database",
      "tests",
      "recovery",
      "desktop",
      "inputs",
      "inputSetDigest",
    ]);
    if (
      report === null ||
      report.schemaVersion !== 1 ||
      report.slice !== "recovery-persistence" ||
      report.passed !== true ||
      report.closesGate !== false ||
      !exactDatabase(report.database) ||
      !exactTests(report.tests) ||
      !exactRecoveryObservation(report.recovery) ||
      !exactDesktopObservation(report.desktop) ||
      !exactInputs(report.inputs) ||
      report.inputSetDigest !== digestInputs(report.inputs) ||
      reportContainsConnectionMaterial(value)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function exactDatabase(value) {
  const database = exactDataObject(value, ["serverVersion", "roles", "rowLevelSecurity", "migration"]);
  if (database === null || !/^18\.6(?:\D|$)/u.test(database.serverVersion)) return false;
  return exactValue(database.roles, [
    { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
    { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
  ]) && exactValue(
    database.rowLevelSecurity,
    RECOVERY_TABLES.map((table) => ({ table, enabled: true, forced: true })),
  ) && exactMigration(database.migration);
}

function exactMigration(value) {
  const migrations = exactArrayValues(value, 1);
  if (migrations === null) return false;
  const migration = exactDataObject(migrations[0], ["id", "owner", "checksum"]);
  return migration !== null
    && migration.id === "202608200011-restore-candidate-foundation"
    && migration.owner === "recovery"
    && typeof migration.checksum === "string"
    && /^[0-9a-f]{64}$/u.test(migration.checksum);
}

function exactTests(value) {
  const tests = exactDataObject(value, ["postgres", "unit"]);
  return tests !== null
    && exactTestObservation(
      tests.postgres,
      "test/postgres/recovery-candidate-persistence.test.ts",
      RECOVERY_PERSISTENCE_TEST_NAMES,
    )
    && exactTestObservation(tests.unit, "test/restore-candidate-service.test.ts", RECOVERY_UNIT_TEST_NAMES);
}

function exactTestObservation(value, file, expectedNames) {
  const observation = exactDataObject(value, ["file", "success", "total", "passed", "failed", "names"]);
  return observation !== null
    && observation.file === file
    && observation.success === true
    && observation.total === expectedNames.length
    && observation.passed === expectedNames.length
    && observation.failed === 0
    && exactValue(observation.names, expectedNames);
}

function exactRecoveryObservation(value) {
  const recovery = exactDataObject(value, ["module", "workflowAuthority", "lifecycleTransitions"]);
  return recovery !== null
    && recovery.module === "persistence-foundation"
    && recovery.workflowAuthority === "DenyingRecoveryWorkflowAuthority"
    && exactValue(recovery.lifecycleTransitions, ["rebase_required", "discarded", "expired"]);
}

function exactDesktopObservation(value) {
  const desktop = exactDataObject(value, ["commandPolicyErrors"]);
  return desktop !== null && desktop.commandPolicyErrors === 0;
}

function exactInputs(value) {
  const inputs = exactArrayValues(value, RECOVERY_PERSISTENCE_INPUTS.length);
  if (inputs === null) return false;
  return inputs.every((input, index) => {
    const record = exactDataObject(input, ["path", "bytes", "sha256"]);
    if (record === null || record.path !== RECOVERY_PERSISTENCE_INPUTS[index]) return false;
    const source = readRequiredInput(record.path);
    return Number.isSafeInteger(record.bytes)
      && record.bytes === Buffer.byteLength(source)
      && typeof record.sha256 === "string"
      && /^[0-9a-f]{64}$/u.test(record.sha256)
      && record.sha256 === sha256(source);
  });
}

function exactValue(actual, expected) {
  if (Array.isArray(expected)) {
    const values = exactArrayValues(actual, expected.length);
    return values !== null && values.every((entry, index) => exactValue(entry, expected[index]));
  }
  if (expected !== null && typeof expected === "object") {
    const values = exactDataObject(actual, Object.keys(expected));
    return values !== null && Object.keys(expected).every((key) => exactValue(values[key], expected[key]));
  }
  return actual === expected;
}

function lifecycleTransitions(source) {
  const match = source.match(/restoreCandidateLifecycleCommandSchema[\s\S]*?transition:\s*z\.enum\(\[([^\]]*)\]\)/u);
  return match === null ? [] : [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

function reportContainsConnectionMaterial(value) {
  const serialized = JSON.stringify(value);
  return /postgres(?:ql)?:\/\//iu.test(serialized) || /"(?:password|ownerUrl|appUrl)"\s*:/iu.test(serialized);
}

function observeVitest(file, config = null) {
  const args = ["--filter", "@gooddealer/cloud", "exec", "vitest", "run"];
  if (config !== null) args.push("--config", config);
  args.push(file, "--reporter=json");
  const output = run("pnpm", args);
  const parsed = JSON.parse(output);
  const names = parsed?.testResults?.flatMap((result) => result.assertionResults?.map(({ title }) => title));
  if (!Array.isArray(names) || parsed.success !== true) {
    throw new Error(`targeted recovery Vitest evidence is incomplete: ${file}`);
  }
  return {
    file,
    success: true,
    total: parsed.numTotalTests,
    passed: parsed.numPassedTests,
    failed: parsed.numFailedTests,
    names,
  };
}

function psql(url, sql) {
  return run("psql", [
    url,
    "--no-psqlrc",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    sql,
  ]).trim();
}

function queryJson(url, sql) {
  return JSON.parse(psql(url, sql));
}

function run(command, args) {
  if (command !== "pnpm" && command !== "psql") throw new Error(`unapproved executable: ${command}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`recovery persistence subprocess failed: ${command}`);
  }
  return result.stdout ?? "";
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required; recovery persistence evidence never skips`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
