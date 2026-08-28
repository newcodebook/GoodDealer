import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  RECOVERY_PERSISTENCE_INPUTS,
  RECOVERY_PERSISTENCE_TEST_NAMES,
  RECOVERY_UNIT_TEST_NAMES,
  digestInputs,
  recoveryPersistenceInputAdmissionErrors,
  recoveryPersistenceReportPassesPolicy,
} from "./collect-recovery-persistence-report.mjs";

const root = resolve(import.meta.dirname, "..");
const hashes = RECOVERY_PERSISTENCE_INPUTS.map((path) => {
  const source = readFileSync(resolve(root, path), "utf8");
  return { path, bytes: Buffer.byteLength(source), sha256: sha256(source) };
});

function validReport() {
  const inputs = structuredClone(hashes);
  return {
    schemaVersion: 1,
    slice: "recovery-persistence",
    passed: true,
    closesGate: false,
    database: {
      serverVersion: "18.6",
      roles: [
        { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
        { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
      ],
      rowLevelSecurity: [
        { table: "restore_candidate_requests", enabled: true, forced: true },
        { table: "restore_candidates", enabled: true, forced: true },
      ],
      migration: [{ id: "202608200011-restore-candidate-foundation", owner: "recovery", checksum: "0".repeat(64) }],
    },
    tests: {
      postgres: {
        file: "test/postgres/recovery-candidate-persistence.test.ts",
        success: true,
        total: RECOVERY_PERSISTENCE_TEST_NAMES.length,
        passed: RECOVERY_PERSISTENCE_TEST_NAMES.length,
        failed: 0,
        names: [...RECOVERY_PERSISTENCE_TEST_NAMES],
      },
      unit: {
        file: "test/restore-candidate-service.test.ts",
        success: true,
        total: RECOVERY_UNIT_TEST_NAMES.length,
        passed: RECOVERY_UNIT_TEST_NAMES.length,
        failed: 0,
        names: [...RECOVERY_UNIT_TEST_NAMES],
      },
    },
    recovery: {
      module: "persistence-foundation",
      workflowAuthority: "DenyingRecoveryWorkflowAuthority",
      lifecycleTransitions: ["rebase_required", "discarded", "expired"],
    },
    desktop: { commandPolicyErrors: 0 },
    inputs,
    inputSetDigest: digestInputs(inputs),
  };
}

test("recovery persistence policy accepts Cloud recovery facts with a passing narrow-command policy", () => {
  assert.equal(recoveryPersistenceReportPassesPolicy(validReport()), true);
});

test("recovery persistence policy rejects database, test, recovery, Desktop, and source drift", () => {
  const mutations = [
    (report) => { report.database.serverVersion = "18.5"; },
    (report) => { report.database.roles[0].superuser = true; },
    (report) => { report.database.rowLevelSecurity.pop(); },
    (report) => { report.database.migration[0].owner = "other"; },
    (report) => { report.tests.postgres.names.pop(); },
    (report) => { report.tests.unit.total -= 1; },
    (report) => { report.recovery.workflowAuthority = "available"; },
    (report) => { report.recovery.lifecycleTransitions.push("applied"); },
    (report) => { report.desktop.commandPolicyErrors = 1; },
    (report) => { report.inputs[0].sha256 = "f".repeat(64); },
    (report) => { report.inputSetDigest = "f".repeat(64); },
    (report) => { report.closesGate = true; },
  ];
  for (const mutate of mutations) {
    const report = validReport();
    mutate(report);
    assert.equal(recoveryPersistenceReportPassesPolicy(report), false);
  }
});

test("recovery persistence policy rejects fabricated, inherited, and accessor report values without invoking getters", () => {
  const fabricated = validReport();
  fabricated.recovery.available = true;
  assert.equal(recoveryPersistenceReportPassesPolicy(fabricated), false);

  const inherited = validReport();
  Object.setPrototypeOf(inherited.desktop, { commandPolicyErrors: 0 });
  assert.equal(recoveryPersistenceReportPassesPolicy(inherited), false);

  const accessor = validReport();
  let getterCalls = 0;
  Object.defineProperty(accessor.tests, "postgres", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error("getter must not run");
    },
  });
  assert.equal(recoveryPersistenceReportPassesPolicy(accessor), false);
  assert.equal(getterCalls, 0);
});

test("recovery persistence input admission accepts only its closed normalized regular-file inventory", (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "gooddealer-recovery-inputs-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  for (const path of RECOVERY_PERSISTENCE_INPUTS) {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "input\n");
  }
  assert.deepEqual(recoveryPersistenceInputAdmissionErrors({ repositoryRoot: fixtureRoot }), []);

  const foreign = [...RECOVERY_PERSISTENCE_INPUTS];
  foreign[0] = "foreign.ts";
  assert.ok(recoveryPersistenceInputAdmissionErrors({ repositoryRoot: fixtureRoot, inputPaths: foreign }).some((error) => error.includes("not admitted")));

  const absolute = [...RECOVERY_PERSISTENCE_INPUTS];
  absolute[0] = "/tmp/foreign.ts";
  assert.ok(recoveryPersistenceInputAdmissionErrors({ repositoryRoot: fixtureRoot, inputPaths: absolute }).some((error) => error.includes("not normalized")));

  const traversal = [...RECOVERY_PERSISTENCE_INPUTS];
  traversal[0] = "../foreign.ts";
  assert.ok(recoveryPersistenceInputAdmissionErrors({ repositoryRoot: fixtureRoot, inputPaths: traversal }).some((error) => error.includes("not normalized")));

  const missing = join(fixtureRoot, RECOVERY_PERSISTENCE_INPUTS[1]);
  rmSync(missing);
  assert.ok(recoveryPersistenceInputAdmissionErrors({ repositoryRoot: fixtureRoot }).some((error) => error.includes("ENOENT")));
  writeFileSync(missing, "input\n");

  const directory = join(fixtureRoot, RECOVERY_PERSISTENCE_INPUTS[2]);
  rmSync(directory);
  mkdirSync(directory);
  assert.ok(recoveryPersistenceInputAdmissionErrors({ repositoryRoot: fixtureRoot }).some((error) => error.includes("regular file")));
  rmSync(directory, { recursive: true });
  symlinkSync("missing-input", directory);
  assert.ok(recoveryPersistenceInputAdmissionErrors({ repositoryRoot: fixtureRoot }).some((error) => error.includes("symbolic link")));
});

test("recovery persistence input admission rejects foreign arrays, sparse arrays, and accessors before reading them", () => {
  const foreignArray = Object.setPrototypeOf([...RECOVERY_PERSISTENCE_INPUTS], {});
  assert.ok(recoveryPersistenceInputAdmissionErrors({ inputPaths: foreignArray }).some((error) => error.includes("exact plain array")));

  const sparse = [...RECOVERY_PERSISTENCE_INPUTS];
  delete sparse[0];
  assert.ok(recoveryPersistenceInputAdmissionErrors({ inputPaths: sparse }).some((error) => error.includes("exact plain array")));

  const accessor = [...RECOVERY_PERSISTENCE_INPUTS];
  let getterCalls = 0;
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error("input getter must not run");
    },
  });
  assert.ok(recoveryPersistenceInputAdmissionErrors({ inputPaths: accessor }).some((error) => error.includes("exact plain array")));
  assert.equal(getterCalls, 0);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
