import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  DEVICE_MIGRATIONS,
  DEVICE_PERSISTENCE_TABLES,
  DEVICES_PERSISTENCE_INPUT_PATHS,
  HARDENED_DRAIN_TABLES,
  IMMUTABLE_TRIGGER_EXPECTATIONS,
  POSTGRES_DRAIN_TEST_FILES,
  ROLE_EXPECTATIONS,
  ROLE_MEMBERSHIP_EXPECTATIONS,
  DEFAULT_ACL_GRANT_EXPECTATIONS,
  ROUTINE_EXPECTATIONS,
  devicesPersistenceReportPassesPolicy,
  digestInputs,
} from "./collect-devices-persistence-report.mjs";

const root = resolve(import.meta.dirname, "..");
const inputs = DEVICES_PERSISTENCE_INPUT_PATHS.map((path) => ({
  path, sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"),
}));
const observation = {
  success: true,
  total: POSTGRES_DRAIN_TEST_FILES.reduce((total, file) => total + file.names.length, 0),
  passed: POSTGRES_DRAIN_TEST_FILES.reduce((total, file) => total + file.names.length, 0),
  failed: 0,
  files: POSTGRES_DRAIN_TEST_FILES.map(({ file, names }) => ({
    file,
    success: true,
    total: names.length,
    passed: names.length,
    failed: 0,
    names: [...names],
  })),
};
const report = {
  schemaVersion: 1,
  slice: "devices-persistence",
  passed: true,
  closesGate: false,
  repository: { commit: "a".repeat(40), dirty: false },
  database: {
    ownerServerVersion: "18.6 (Debian)",
    appServerVersion: "18.6 (Debian)",
    ownerDatabaseIdentity: {
      systemIdentifier: "7300000000000000001",
      databaseName: "postgres",
      databaseOid: "5",
    },
    appDatabaseIdentity: {
      systemIdentifier: "7300000000000000001",
      databaseName: "postgres",
      databaseOid: "5",
    },
    ownerRole: "gooddealer_cloud_owner",
    appRole: "gooddealer_cloud_app",
    roles: ROLE_EXPECTATIONS.map((role) => ({ ...role })),
    roleMemberships: [...ROLE_MEMBERSHIP_EXPECTATIONS],
    defaultAclGrants: [...DEFAULT_ACL_GRANT_EXPECTATIONS],
    schemaPrivileges: {
      appCreate: false, appUsage: true, publicCreate: false, publicUsage: false, ownerUsage: true,
    },
    rowLevelSecurity: DEVICE_PERSISTENCE_TABLES.map((table) => ({ table, enabled: true, forced: true }))
      .sort((left, right) => left.table.localeCompare(right.table)),
    migrations: DEVICE_MIGRATIONS.map(([id, owner, checksum]) => ({ id, owner, checksum })),
    hardenedTablePrivileges: HARDENED_DRAIN_TABLES.map((table) => ({
      table,
      owner: "gooddealer_cloud_owner",
      canSelect: true,
      canInsert: false,
      canUpdate: false,
      canDelete: false,
      canTruncate: false,
      canReferences: false,
      canTrigger: false,
    })),
    routines: ROUTINE_EXPECTATIONS.map((routine) => ({ ...routine, configuration: [...routine.configuration] })),
    immutableTriggers: IMMUTABLE_TRIGGER_EXPECTATIONS.map((trigger) => ({ ...trigger })),
  },
  tests: { postgres: observation },
  productionSurfaces: {
    publicBusinessRoutes: 1, adminBusinessRoutes: 0, periodicJobs: 0,
    tauriCommands: [], leaseSigner: "DenyingLeaseSigner",
    drainSignatureSuccessVariants: 0, cursorWrites: 0, currentEpochWrites: 0,
    networkPrimitives: 0, leaseIssuanceCalls: 0,
  },
  gates: { "R0-05": "In Progress", "R0-06": "In Progress", "R0-09": "In Progress", "R0-16": "In Progress" },
  inputs,
  inputSetDigest: digestInputs(inputs),
};

test("devices persistence policy accepts only exact dual-endpoint PG18.6, identity, migration, ACL, trigger, and role facts", () => {
  assert.equal(devicesPersistenceReportPassesPolicy(report), true);
  assert.deepEqual(DEFAULT_ACL_GRANT_EXPECTATIONS, [
    { scope: "global", objectType: "f", grants: [] },
    { scope: "global", objectType: "r", grants: [] },
    { scope: "public", objectType: "f", grants: [] },
    { scope: "public", objectType: "r", grants: [] },
  ]);
  const mutations = [
    { ...report, database: { ...report.database, ownerServerVersion: "18.5" } },
    { ...report, database: { ...report.database, appServerVersion: "18.5" } },
    { ...report, database: { ...report.database, appDatabaseIdentity: {
      ...report.database.appDatabaseIdentity, systemIdentifier: "7300000000000000002",
    } } },
    { ...report, database: { ...report.database, appDatabaseIdentity: {
      ...report.database.appDatabaseIdentity, databaseOid: "6", databaseName: "other",
    } } },
    { ...report, database: { ...report.database, ownerRole: "gooddealer_cloud_app" } },
    { ...report, database: { ...report.database, roles: [] } },
    { ...report, database: { ...report.database, roles: report.database.roles.map((role) => ({ ...role, superuser: true })) } },
    { ...report, database: { ...report.database, roles: report.database.roles.map((role, index) => index === 0 ? { ...role, createRole: true } : role) } },
    { ...report, database: { ...report.database, roleMemberships: [{
      member: "gooddealer_cloud_app", role: "gooddealer_cloud_owner", adminOption: false, inheritOption: true, setOption: true,
    }] } },
    { ...report, database: { ...report.database, defaultAclGrants: report.database.defaultAclGrants.filter(
      ({ scope }) => scope !== "global",
    ) } },
    { ...report, database: { ...report.database, defaultAclGrants: report.database.defaultAclGrants.map((fact) => (
      fact.scope === "global" && fact.objectType === "r"
        ? { ...fact, grants: [{ grantee: "PUBLIC", privilege: "INSERT", grantable: false }] }
        : fact
    )) } },
    { ...report, database: { ...report.database, defaultAclGrants: report.database.defaultAclGrants.map((fact) => (
      fact.scope === "global" && fact.objectType === "f"
        ? { ...fact, grants: [{ grantee: "gooddealer_cloud_app", privilege: "EXECUTE", grantable: false }] }
        : fact
    )) } },
    { ...report, database: { ...report.database, defaultAclGrants: report.database.defaultAclGrants.map((fact) => (
      fact.scope === "public" && fact.objectType === "f"
        ? { ...fact, grants: [{ grantee: "PUBLIC", privilege: "EXECUTE", grantable: false }] }
        : fact
    )) } },
    { ...report, database: { ...report.database, schemaPrivileges: { ...report.database.schemaPrivileges, appCreate: true } } },
    { ...report, database: { ...report.database, rowLevelSecurity: [] } },
    { ...report, database: { ...report.database, rowLevelSecurity: report.database.rowLevelSecurity.map((row, index) => index === 0 ? { ...row, forced: false } : row) } },
    { ...report, database: { ...report.database, migrations: [] } },
    { ...report, database: { ...report.database, migrations: report.database.migrations.map((row, index) => index === 0 ? { ...row, checksum: "invalid" } : row) } },
    { ...report, database: { ...report.database, hardenedTablePrivileges: report.database.hardenedTablePrivileges.map((row, index) => index === 0 ? { ...row, canUpdate: true } : row) } },
    { ...report, database: { ...report.database, hardenedTablePrivileges: report.database.hardenedTablePrivileges.map((row, index) => index === 0 ? { ...row, canReferences: true } : row) } },
    { ...report, database: { ...report.database, routines: report.database.routines.map((row, index) => index === 0 ? { ...row, appExecute: true } : row) } },
    { ...report, database: { ...report.database, immutableTriggers: report.database.immutableTriggers.slice(1) } },
  ];
  for (const mutated of mutations) assert.equal(devicesPersistenceReportPassesPolicy(mutated), false);
});

test("empty duplicate missing fabricated and named-but-unexecuted adversarial evidence fails closed", () => {
  const firstFile = observation.files[0];
  if (firstFile === undefined) throw new Error("test fixture is incomplete");
  const mutations = [
    { ...observation, files: [] },
    { ...observation, files: [...observation.files, firstFile] },
    { ...observation, files: observation.files.map((file, index) => index === 0 ? { ...file, names: [], total: 0, passed: 0 } : file) },
    { ...observation, files: observation.files.map((file, index) => index === 0 ? {
      ...file,
      names: [file.names[0], file.names[0], ...file.names.slice(2)],
    } : file) },
    { ...observation, files: observation.files.map((file, index) => index === 0 ? {
      ...file,
      names: file.names.map((name, nameIndex) => nameIndex === 0 ? "fabricated passing test" : name),
    } : file) },
    { ...observation, success: false, failed: 1, passed: observation.passed - 1 },
    { ...observation, total: 0, passed: 0, failed: 0 },
  ];
  for (const mutated of mutations) {
    assert.equal(devicesPersistenceReportPassesPolicy({ ...report, tests: { postgres: mutated } }), false);
  }
});

test("source hashes, production closure, commit cleanliness, and non-closing gates reject fabrication", () => {
  assert.equal(devicesPersistenceReportPassesPolicy({ ...report, closesGate: true }), false);
  assert.equal(devicesPersistenceReportPassesPolicy({ ...report, repository: { ...report.repository, dirty: true } }), false);
  for (const key of Object.keys(report.productionSurfaces)) {
    const value = key === "tauriCommands" ? ["issue_lease"] : -1;
    assert.equal(devicesPersistenceReportPassesPolicy({
      ...report, productionSurfaces: { ...report.productionSurfaces, [key]: value },
    }), false, key);
  }
  const fabricated = report.inputs.map((input, index) => index === 0 ? { ...input, sha256: "c".repeat(64) } : input);
  assert.equal(devicesPersistenceReportPassesPolicy({ ...report, inputs: fabricated, inputSetDigest: digestInputs(fabricated) }), false);
  assert.equal(devicesPersistenceReportPassesPolicy({ ...report, inputs: [], inputSetDigest: digestInputs([]) }), false);
  const duplicate = [...report.inputs.slice(0, -1), report.inputs[0]];
  assert.equal(devicesPersistenceReportPassesPolicy({ ...report, inputs: duplicate, inputSetDigest: digestInputs(duplicate) }), false);
});

test("collector and workflow require live exact PG18.6 evidence and bind the immutable adversarial suite", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/wp2-devices-persistence.yml"), "utf8");
  const collector = readFileSync(resolve(root, "scripts/collect-devices-persistence-report.mjs"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(workflow, /image: postgres:18\.6/u);
  assert.match(workflow, /NOSUPERUSER NOBYPASSRLS/u);
  assert.equal(packageJson.scripts["evidence:wp2:devices-persistence"], "node scripts/collect-devices-persistence-report.mjs");
  assert.match(collector, /GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC/u);
  assert.match(collector, /PostgreSQL 18\.6 required/u);
  assert.match(collector, /ownerServerVersion/u);
  assert.match(collector, /appServerVersion/u);
  assert.match(collector, /pg_control_system/u);
  assert.match(collector, /pg_auth_members/u);
  assert.match(collector, /pg_default_acl/u);
  assert.match(collector, /\('global'::text, 0::oid\),\s*\('public'::text, 'public'::regnamespace::oid\)/u);
  assert.match(collector, /default_acl\.defaclnamespace = acl_scope\.namespace_oid/u);
  assert.match(collector, /ORDER BY scope, "objectType"/u);
  assert.match(collector, /202608200004-device-control/u);
  assert.match(collector, /202608200008-workspace-device-audit-drain-ledger/u);
  assert.match(collector, /immutable-drain-ledger\.test\.ts/u);
  assert.match(collector, /immutableTriggers/u);
  assert.match(collector, /hardenedTablePrivileges/u);
});

test("collector fails closed before endpoint use, test execution, or report output when endpoint qualification is absent", () => {
  const missingOwner = runCollector();
  assert.notEqual(missingOwner.status, 0);
  assert.match(collectorOutput(missingOwner), /GOODDEALER_POSTGRES_OWNER_URL is required/u);

  const missingApp = runCollector({ GOODDEALER_POSTGRES_OWNER_URL: "postgresql://invalid-owner/never-connect" });
  assert.notEqual(missingApp.status, 0);
  assert.match(collectorOutput(missingApp), /GOODDEALER_POSTGRES_APP_URL is required/u);

  const diagnostic = runCollector({
    GOODDEALER_POSTGRES_OWNER_URL: "postgresql://invalid-owner/never-connect",
    GOODDEALER_POSTGRES_APP_URL: "postgresql://invalid-app/never-connect",
    GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC: "true",
  });
  assert.notEqual(diagnostic.status, 0);
  assert.match(collectorOutput(diagnostic), /unqualified diagnostic mode cannot produce evidence/u);
});

test("identity authority stays behind its public transaction-aware port and deadline uses transaction time", () => {
  const transition = readFileSync(resolve(root, "apps/cloud/src/modules/devices/postgres-drain-transition.ts"), "utf8");
  const identityPort = readFileSync(resolve(root, "apps/cloud/src/modules/identity/account-security-state-port.ts"), "utf8");
  assert.match(transition, /from "\.\.\/identity\/index"/u);
  assert.match(transition, /this\.accountSecurity\.lockCurrent\(transaction\)/u);
  assert.doesNotMatch(transition, /identity_account_security_states/u);
  assert.match(identityPort, /FROM identity_account_security_states/u);
  assert.match(identityPort, /FOR UPDATE/u);
  assert.match(transition, /transaction_timestamp\(\) < state_deadline AS deadline_live/u);
  const order = [
    "identity_account_security_state", "device_account_state", "bindings_by_device_id", "signing_key",
    "workflow", "held_lease_and_epoch", "proof", "mutation_head", "execution_fact_head",
    "device_audit_head", "bootstrap_rows",
  ];
  let position = -1;
  for (const lock of order) {
    const next = transition.indexOf(`"${lock}"`);
    assert.ok(next > position, lock);
    position = next;
  }
});

function runCollector(overrides = {}) {
  const environment = { ...process.env };
  delete environment.GOODDEALER_POSTGRES_OWNER_URL;
  delete environment.GOODDEALER_POSTGRES_APP_URL;
  delete environment.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC;
  return spawnSync(process.execPath, [resolve(root, "scripts/collect-devices-persistence-report.mjs")], {
    cwd: root,
    env: { ...environment, ...overrides },
    encoding: "utf8",
  });
}

function collectorOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
