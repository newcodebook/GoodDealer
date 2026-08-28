import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { BOOTSTRAP_INPUT_PATHS, BOOTSTRAP_MIGRATIONS, BOOTSTRAP_PORTABLE_TEST_NAMES,
  BOOTSTRAP_POSTGRES_TEST_NAMES, BOOTSTRAP_TABLES, bootstrapPersistenceReportPassesPolicy,
  digestInputs } from "./collect-bootstrap-persistence-report.mjs";

const root = resolve(import.meta.dirname, "..");
const inputs = BOOTSTRAP_INPUT_PATHS.map((path) => ({ path,
  sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex") }));
const observation = (file, names) => ({ file, success: true, total: names.length, passed: names.length,
  failed: 0, names: [...names] });
const report = {
  schemaVersion: 1, slice: "bootstrap-persistence", passed: true, closesGate: false,
  repository: { commit: "a".repeat(40), dirty: false },
  database: { serverVersion: "18.6 (Debian)", roles: [
    { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
    { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false }],
    rowLevelSecurity: BOOTSTRAP_TABLES.map((table) => ({ table, enabled: true, forced: true })),
    migrations: BOOTSTRAP_MIGRATIONS.map(([id, owner]) => ({ id, owner, checksum: "b".repeat(64) })) },
  tests: { portable: observation("test/bootstrap-persistence-boundary.test.ts", BOOTSTRAP_PORTABLE_TEST_NAMES),
    postgres: observation("test/postgres/bootstrap-persistence.test.ts", BOOTSTRAP_POSTGRES_TEST_NAMES) },
  production: { fixtureOnly: true, productionComposition: false, productionLeaseIssued: false,
    normalHandoffEnabled: false, verifier: "Denying", leaseSigner: "Denying", drainSignedReadyWrites: 0,
    publicBusinessRoutes: 0, adminBusinessRoutes: 0, periodicJobs: 0, tauriCommands: [],
    fixtureImportsFromSource: 0 },
  gates: { "R0-05": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress" },
  inputs, inputSetDigest: digestInputs(inputs),
};

test("Bootstrap policy accepts only exact PostgreSQL 18.6 facts and exact named executions", () => {
  assert.equal(bootstrapPersistenceReportPassesPolicy(report), true);
  const mutations = [
    { ...report, database: { ...report.database, serverVersion: "18.5" } },
    { ...report, database: { ...report.database, roles: [] } },
    { ...report, database: { ...report.database, rowLevelSecurity: [] } },
    { ...report, database: { ...report.database, migrations: [] } },
    { ...report, tests: { ...report.tests, postgres: { ...report.tests.postgres, total: 0, passed: 0, names: [] } } },
    { ...report, tests: { ...report.tests, portable: { ...report.tests.portable,
      names: [report.tests.portable.names[0], ...report.tests.portable.names.slice(0, -1)] } } },
  ];
  for (const value of mutations) assert.equal(bootstrapPersistenceReportPassesPolicy(value), false);
});

test("Bootstrap policy rejects fabricated production activation, surfaces, Gates, and source facts", () => {
  for (const [key, value] of [["productionComposition", true], ["productionLeaseIssued", true],
    ["normalHandoffEnabled", true], ["drainSignedReadyWrites", 1], ["periodicJobs", 1],
    ["fixtureImportsFromSource", 1]]) {
    assert.equal(bootstrapPersistenceReportPassesPolicy({ ...report,
      production: { ...report.production, [key]: value } }), false, key);
  }
  assert.equal(bootstrapPersistenceReportPassesPolicy({ ...report, closesGate: true }), false);
  assert.equal(bootstrapPersistenceReportPassesPolicy({ ...report,
    gates: { ...report.gates, "R0-06": "Closed" } }), false);
  assert.equal(bootstrapPersistenceReportPassesPolicy({ ...report,
    repository: { ...report.repository, dirty: true } }), false);
  const badInputs = report.inputs.map((input, index) => index === 0 ? { ...input, sha256: "c".repeat(64) } : input);
  assert.equal(bootstrapPersistenceReportPassesPolicy({ ...report,
    inputs: badInputs, inputSetDigest: digestInputs(badInputs) }), false);
});

test("Bootstrap hosted workflow pins PostgreSQL 18.6 and exact evidence command", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/wp2-bootstrap-persistence.yml"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(workflow, /image: postgres:18\.6/u);
  assert.match(workflow, /NOSUPERUSER NOBYPASSRLS/u);
  assert.equal(packageJson.scripts["evidence:wp2:bootstrap-persistence"],
    "node scripts/collect-bootstrap-persistence-report.mjs");
});
