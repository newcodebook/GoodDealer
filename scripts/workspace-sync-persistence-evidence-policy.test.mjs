import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  POSTGRES_WORKSPACE_SYNC_TESTS,
  WORKSPACE_SYNC_LEDGER_MIGRATIONS,
  WORKSPACE_SYNC_PERSISTENCE_INPUT_PATHS,
  WORKSPACE_SYNC_TABLES,
  declaredVitestTestNames,
  digestInputs,
  workspaceSyncPersistenceReportPassesPolicy,
} from "./collect-workspace-sync-persistence-report.mjs";

const root = resolve(import.meta.dirname, "..");
const inputs = WORKSPACE_SYNC_PERSISTENCE_INPUT_PATHS.map((path) => {
  const content = readFileSync(resolve(root, path));
  return { path, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
});
const observation = (file, names) => ({
  file,
  success: true,
  total: names.length,
  passed: names.length,
  failed: 0,
  names: [...names],
});
const tests = Object.fromEntries(Object.entries(POSTGRES_WORKSPACE_SYNC_TESTS)
  .map(([file, names]) => [file, observation(file, names)]));
const report = {
  schemaVersion: 1,
  slice: "workspace-sync-persistence",
  passed: true,
  qualified: true,
  closesGate: false,
  repository: { commit: "a".repeat(40), dirty: false },
  database: {
    serverVersion: "18.6 (Debian)",
    roles: [
      { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
      { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
    ],
    rowLevelSecurity: WORKSPACE_SYNC_TABLES.map((table) => ({ table, enabled: true, forced: true })),
    migrations: WORKSPACE_SYNC_LEDGER_MIGRATIONS.map(([id, owner]) => ({
      id, owner, checksum: "b".repeat(64),
    })),
  },
  tests,
  signals: {
    postgresqlVersionPinned: true,
    rolesNonPrivileged: true,
    allNewTablesForceRls: true,
    migrationLedgerBound: true,
    exactSuitesPassed: true,
    poolSelectorsCleared: true,
    productionFallbacksClosed: true,
    sourceHashesBound: true,
  },
  platforms: [
    { id: "portable-evidence-policy", status: "Tested" },
    { id: "postgresql-18.6", status: "Tested" },
    { id: "production-composition", status: "Unlinked" },
  ],
  productionSurfaces: {
    publicBusinessRoutes: 0,
    adminBusinessRoutes: 0,
    periodicJobs: 0,
    tauriCommands: [],
    workspaceSyncCompositionReferences: 0,
  },
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

test("accepts only an exact qualified PostgreSQL 18.6 workspace sync report", () => {
  assert.equal(workspaceSyncPersistenceReportPassesPolicy(report), true);
  const mutations = [
    { ...report, qualified: false },
    { ...report, closesGate: true },
    { ...report, repository: { ...report.repository, dirty: true } },
    { ...report, database: { ...report.database, serverVersion: "18.5" } },
    { ...report, database: { ...report.database, roles: [] } },
    { ...report, database: { ...report.database, roles: report.database.roles.map((role) => ({ ...role, superuser: true })) } },
    { ...report, database: { ...report.database, rowLevelSecurity: [] } },
    { ...report, database: { ...report.database, rowLevelSecurity: report.database.rowLevelSecurity.map((row, index) =>
      index === 0 ? { ...row, forced: false } : row) } },
    { ...report, database: { ...report.database, migrations: [] } },
    { ...report, database: { ...report.database, migrations: [...report.database.migrations, report.database.migrations[0]] } },
  ];
  for (const mutation of mutations) assert.equal(workspaceSyncPersistenceReportPassesPolicy(mutation), false);
});

test("rejects empty missing duplicate fabricated named-only and every one-field observation mutation", () => {
  for (const [file, observed] of Object.entries(report.tests)) {
    const oneFieldMutations = [
      { ...observed, file: `wrong/${file}` },
      { ...observed, success: false },
      { ...observed, total: observed.total + 1 },
      { ...observed, passed: observed.passed - 1 },
      { ...observed, failed: 1 },
      { ...observed, names: observed.names.map((name, index) => index === 0 ? "fabricated passing test" : name) },
    ];
    const factMutations = [
      { ...observed, names: [], total: 0, passed: 0 },
      { ...observed, names: observed.names.slice(1), total: observed.total - 1, passed: observed.passed - 1 },
      { ...observed, names: [observed.names[0], observed.names[0], ...observed.names.slice(2)] },
      { ...observed, success: false, failed: 1, passed: observed.passed - 1 },
      { ...observed, total: 0, passed: 0, failed: 0 },
    ];
    for (const mutation of [...oneFieldMutations, ...factMutations]) {
      assert.equal(workspaceSyncPersistenceReportPassesPolicy({
        ...report,
        tests: { ...report.tests, [file]: mutation },
      }), false, file);
    }
  }
  const [firstFile] = Object.keys(report.tests);
  const missing = { ...report.tests };
  delete missing[firstFile];
  assert.equal(workspaceSyncPersistenceReportPassesPolicy({ ...report, tests: missing }), false);
});

test("explicit PostgreSQL test allowlists match the checked-in declarations exactly", () => {
  for (const [file, expectedNames] of Object.entries(POSTGRES_WORKSPACE_SYNC_TESTS)) {
    const source = readFileSync(resolve(root, "apps/cloud", file), "utf8");
    const declaredNames = declaredVitestTestNames(source);
    assert.deepEqual(declaredNames, expectedNames, file);
    assert.equal(new Set(declaredNames).size, expectedNames.length, file);
  }
  const checkpointNames = POSTGRES_WORKSPACE_SYNC_TESTS["test/postgres/workspace-checkpoint-persistence.test.ts"];
  assert.deepEqual(Object.fromEntries(Object.entries(POSTGRES_WORKSPACE_SYNC_TESTS)
    .map(([file, names]) => [file, names.length])), {
    "test/postgres/persistence.test.ts": 10,
    "test/postgres/device-drain-persistence.test.ts": 15,
    "test/postgres/workspace-mutation-persistence.test.ts": 17,
    "test/postgres/workspace-reader-cursor-persistence.test.ts": 10,
    "test/postgres/workspace-checkpoint-persistence.test.ts": 21,
  });
  assert.equal(Object.values(POSTGRES_WORKSPACE_SYNC_TESTS).reduce((total, names) => total + names.length, 0), 73);
  assert.deepEqual(checkpointNames.slice(9, 12), [
    "lets the DeviceCursor watermark independently block compaction",
    "lets the ReaderCursor watermark independently block compaction",
    "lets the Recovery Candidate watermark independently block compaction",
  ]);
});

test("rejects empty missing duplicate and fabricated signal gate and platform facts", () => {
  assert.equal(workspaceSyncPersistenceReportPassesPolicy({ ...report, signals: {} }), false);
  for (const key of Object.keys(report.signals)) {
    const missing = { ...report.signals };
    delete missing[key];
    assert.equal(workspaceSyncPersistenceReportPassesPolicy({ ...report, signals: missing }), false, key);
    assert.equal(workspaceSyncPersistenceReportPassesPolicy({
      ...report, signals: { ...report.signals, [key]: false },
    }), false, key);
  }
  assert.equal(workspaceSyncPersistenceReportPassesPolicy({
    ...report, signals: { ...report.signals, fabricatedSignal: true },
  }), false);
  const factMutations = [
    { ...report, gates: [] },
    { ...report, gates: [report.gates[0], report.gates[0]] },
    { ...report, gates: report.gates.slice(1) },
    { ...report, gates: report.gates.map((gate, index) => index === 0 ? { ...gate, id: "R0-99" } : gate) },
    { ...report, gates: report.gates.map((gate, index) => index === 0 ? { ...gate, status: "Closed" } : gate) },
    { ...report, platforms: [] },
    { ...report, platforms: [report.platforms[0], report.platforms[0], report.platforms[2]] },
    { ...report, platforms: report.platforms.slice(1) },
    { ...report, platforms: report.platforms.map((platform, index) =>
      index === 0 ? { ...platform, id: "fabricated-platform" } : platform) },
    { ...report, platforms: report.platforms.map((platform, index) =>
      index === 2 ? { ...platform, status: "Tested" } : platform) },
  ];
  for (const mutation of factMutations) assert.equal(workspaceSyncPersistenceReportPassesPolicy(mutation), false);
});

test("rejects production boundary and source hash fabrication", () => {
  for (const key of Object.keys(report.productionSurfaces)) {
    const value = key === "tauriCommands" ? ["unreviewed_command"] : -1;
    assert.equal(workspaceSyncPersistenceReportPassesPolicy({
      ...report,
      productionSurfaces: { ...report.productionSurfaces, [key]: value },
    }), false, key);
  }
  const fabricated = report.inputs.map((input, index) =>
    index === 0 ? { ...input, sha256: "c".repeat(64) } : input);
  assert.equal(workspaceSyncPersistenceReportPassesPolicy({
    ...report, inputs: fabricated, inputSetDigest: digestInputs(fabricated),
  }), false);
  assert.equal(workspaceSyncPersistenceReportPassesPolicy({
    ...report, inputs: [], inputSetDigest: digestInputs([]),
  }), false);
  const missing = report.inputs.slice(1);
  assert.equal(workspaceSyncPersistenceReportPassesPolicy({
    ...report, inputs: missing, inputSetDigest: digestInputs(missing),
  }), false);
  const duplicate = [...report.inputs.slice(0, -1), report.inputs[0]];
  assert.equal(workspaceSyncPersistenceReportPassesPolicy({
    ...report, inputs: duplicate, inputSetDigest: digestInputs(duplicate),
  }), false);
});

test("hosted workflow pins PostgreSQL 18.6, non-privileged roles, policy, collector, and artifact", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/wp2-workspace-sync-persistence.yml"), "utf8");
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /image: postgres:18\.6/u);
  assert.match(workflow, /NOSUPERUSER NOBYPASSRLS/u);
  assert.match(workflow, /node --test scripts\/workspace-sync-persistence-evidence-policy\.test\.mjs/u);
  assert.match(workflow, /node scripts\/collect-workspace-sync-persistence-report\.mjs/u);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/u);
});
