import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  AUTH_PERSISTENCE_INPUT_PATHS,
  PORTABLE_AUTH_TEST_NAMES,
  POSTGRES_AUTH_TEST_NAMES,
  authPersistenceReportPassesPolicy,
  digestInputs,
} from "./collect-auth-persistence-report.mjs";

const root = resolve(import.meta.dirname, "..");
const inputs = AUTH_PERSISTENCE_INPUT_PATHS.map((path) => ({
  path,
  sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"),
}));
const observation = (file, names) => ({
  file,
  success: true,
  total: names.length,
  passed: names.length,
  failed: 0,
  names: [...names],
});
const report = {
  schemaVersion: 1,
  slice: "auth-persistence",
  passed: true,
  closesGate: false,
  database: {
    serverVersion: "18.6 (Debian)",
    roles: [
      { name: "gooddealer_cloud_app", superuser: false, bypassRls: false },
      { name: "gooddealer_cloud_owner", superuser: false, bypassRls: false },
    ],
    rowLevelSecurity: [
      "identity_account_security_states",
      "identity_accounts",
      "identity_auth_sessions",
      "identity_credential_jtis",
      "identity_refresh_families",
    ].map((table) => ({ table, enabled: true, forced: true })),
    identityMigration: [{
      id: "202608200003-identity-authentication",
      owner: "identity",
      checksum: "a".repeat(64),
    }],
  },
  tests: {
    portable: observation("test/password-hash-fallback.test.ts", PORTABLE_AUTH_TEST_NAMES),
    postgres: observation("test/postgres/identity-authentication.test.ts", POSTGRES_AUTH_TEST_NAMES),
  },
  argon2Policy: {
    id: "argon2id-v1", algorithm: "argon2id", version: 19, memoryKiB: 65_536,
    iterations: 3, parallelism: 1, saltBytes: 16, hashBytes: 32,
  },
  selectorAssertions: {
    separateTransactionSettings: true,
    exactEmailPredicate: true,
    ownDataPropertyParser: true,
  },
  productionSurfaces: {
    publicBusinessRoutes: 1,
    adminBusinessRoutes: 0,
    periodicJobs: 0,
    passwordVerifier: "DenyingPasswordHashPort",
    deviceEligibility: "DenyingDeviceLoginEligibilityPort",
    credentialIssuer: "absent",
    activeDeviceLeaseIssuance: false,
  },
  limitations: {
    javascriptSourceStringZeroable: false,
    ownedPasswordBytesZeroed: true,
    databaseWalHeapScanned: false,
  },
  gates: {
    "R0-03": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress",
  },
  inputs,
  inputSetDigest: digestInputs(inputs),
};

test("auth persistence policy accepts only observed exact PostgreSQL and test facts", () => {
  assert.equal(authPersistenceReportPassesPolicy(report), true);
  assert.equal(authPersistenceReportPassesPolicy({ ...report, database: { ...report.database, serverVersion: "18.5" } }), false);
  assert.equal(authPersistenceReportPassesPolicy({ ...report, database: { ...report.database, roles: [] } }), false);
  assert.equal(authPersistenceReportPassesPolicy({
    ...report,
    database: { ...report.database, roles: report.database.roles.map((role) => ({ ...role, superuser: true })) },
  }), false);
  assert.equal(authPersistenceReportPassesPolicy({ ...report, database: { ...report.database, rowLevelSecurity: [] } }), false);
  assert.equal(authPersistenceReportPassesPolicy({
    ...report,
    database: { ...report.database, rowLevelSecurity: report.database.rowLevelSecurity.map((row, index) => index === 0 ? { ...row, forced: false } : row) },
  }), false);
  assert.equal(authPersistenceReportPassesPolicy({ ...report, database: { ...report.database, identityMigration: [] } }), false);
  assert.equal(authPersistenceReportPassesPolicy({
    ...report,
    database: { ...report.database, identityMigration: [...report.database.identityMigration, ...report.database.identityMigration] },
  }), false);
});

test("empty duplicate missing and fabricated test evidence fails closed", () => {
  const portable = report.tests.portable;
  const mutations = [
    { ...portable, names: [], total: 0, passed: 0 },
    { ...portable, names: [portable.names[0], portable.names[0], ...portable.names.slice(2)] },
    { ...portable, names: portable.names.slice(1), total: portable.total - 1, passed: portable.passed - 1 },
    { ...portable, names: portable.names.map((name, index) => index === 0 ? "fabricated passing test" : name) },
    { ...portable, failed: 1, success: false },
  ];
  for (const mutated of mutations) {
    assert.equal(authPersistenceReportPassesPolicy({ ...report, tests: { ...report.tests, portable: mutated } }), false);
  }
  assert.equal(authPersistenceReportPassesPolicy({
    ...report,
    tests: { ...report.tests, postgres: { ...report.tests.postgres, names: [] } },
  }), false);
});

test("static closure assertions and source-bound input hashes reject fabrication", () => {
  for (const key of Object.keys(report.selectorAssertions)) {
    assert.equal(authPersistenceReportPassesPolicy({
      ...report,
      selectorAssertions: { ...report.selectorAssertions, [key]: false },
    }), false, key);
  }
  assert.equal(authPersistenceReportPassesPolicy({
    ...report,
    productionSurfaces: { ...report.productionSurfaces, credentialIssuer: "absent", publicBusinessRoutes: -1 },
  }), false);
  const fabricatedInputs = report.inputs.map((input, index) => index === 0 ? { ...input, sha256: "b".repeat(64) } : input);
  assert.equal(authPersistenceReportPassesPolicy({
    ...report,
    inputs: fabricatedInputs,
    inputSetDigest: digestInputs(fabricatedInputs),
  }), false);
  assert.equal(authPersistenceReportPassesPolicy({ ...report, inputs: [], inputSetDigest: digestInputs([]) }), false);
  const duplicateInputs = [...report.inputs.slice(0, -1), report.inputs[0]];
  assert.equal(authPersistenceReportPassesPolicy({
    ...report,
    inputs: duplicateInputs,
    inputSetDigest: digestInputs(duplicateInputs),
  }), false);
});
