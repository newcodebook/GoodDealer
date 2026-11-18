import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  CRASH_PLAN_LENGTH,
  CRASH_TENANTS,
  cyclePassed,
  digestInputs,
  DURABILITY_INPUT_PATHS,
  DURABILITY_TEST_FILE,
  DURABILITY_TEST_NAMES,
  durabilityReportPassesPolicy,
  DURABLE_SETTINGS,
  MINIMUM_CRASH_CYCLES,
  MINIMUM_SOAK_SECONDS,
} from "./collect-sync-durability-report.mjs";

const root = resolve(import.meta.dirname, "..");

function cycle(overrides = {}) {
  const acknowledged = Array.from({ length: CRASH_TENANTS }, (_, index) => 30 + index);
  // Half the tenants had one item committed whose acknowledgement the kill swallowed.
  const committed = acknowledged.map((value, index) => value + (index % 2));
  // A negative that changes what committed keeps the duplicate count consistent with it, so it
  // fails for its own reason and not because the resumption count no longer matches.
  const total = (overrides.committed ?? committed).reduce?.((sum, value) => sum + value, 0);
  return {
    delayMs: 400,
    loadCompleted: false,
    loadExitCode: 1,
    acknowledged,
    verifyExitCode: 0,
    committed,
    final: Array.from({ length: CRASH_TENANTS }, () => CRASH_PLAN_LENGTH),
    duplicates: total,
    violations: [],
    ...overrides,
  };
}

function inputs() {
  return DURABILITY_INPUT_PATHS.map((path) => ({
    path, sha256: createHash("sha256").update(readFileSync(resolve(root, path), "utf8")).digest("hex"),
  }));
}

/** A report every field of which the policy accepts; each negative changes exactly one thing. */
function report() {
  const reportInputs = inputs();
  return {
    schemaVersion: 1,
    slice: "workspace-sync-durability",
    qualified: true,
    closesGate: false,
    repository: { commit: "a".repeat(40), dirty: false },
    database: { serverVersion: "18.6 (Debian 18.6-1.pgdg13+1)", durabilitySettings: { ...DURABLE_SETTINGS } },
    tests: {
      file: DURABILITY_TEST_FILE, success: true, total: DURABILITY_TEST_NAMES.length,
      passed: DURABILITY_TEST_NAMES.length, failed: 0, names: [...DURABILITY_TEST_NAMES],
    },
    metrics: [
      { kind: "capacity", tenants: 16, mutations: 760, connections: 8, seconds: 1.25, mutationsPerSecond: 606, p50Ms: 24, p95Ms: 35, p99Ms: 61 },
      { kind: "soak", seconds: MINIMUM_SOAK_SECONDS, tenants: 8, writes: 250_000, racedRetries: 60_000, invariantSweeps: 290, maxAppConnections: 8, p95Ms: 25, rssStartMiB: 180, rssEndMiB: 210 },
    ],
    soakSeconds: MINIMUM_SOAK_SECONDS,
    crash: {
      executable: "docker", planLength: CRASH_PLAN_LENGTH, tenants: CRASH_TENANTS,
      cycles: Array.from({ length: MINIMUM_CRASH_CYCLES }, () => cycle()),
    },
    inputs: reportInputs,
    inputSetDigest: digestInputs(reportInputs),
  };
}

function without(mutate) {
  const value = report();
  mutate(value);
  return durabilityReportPassesPolicy(value);
}

test("the complete control report passes, so every negative below fails for its own reason", () => {
  assert.equal(durabilityReportPassesPolicy(report()), true);
});

test("each single departure from qualified, complete evidence is rejected", () => {
  const negatives = {
    unqualified: (value) => { value.qualified = false; },
    closesGate: (value) => { value.closesGate = true; },
    dirty: (value) => { value.repository.dirty = true; },
    shortCommit: (value) => { value.repository.commit = "abc"; },
    otherServer: (value) => { value.database.serverVersion = "18.4"; },
    asyncCommit: (value) => { value.database.durabilitySettings.synchronous_commit = "off"; },
    noFsync: (value) => { value.database.durabilitySettings.fsync = "off"; },
    noFullPageWrites: (value) => { value.database.durabilitySettings.full_page_writes = "off"; },
    missingSetting: (value) => { delete value.database.durabilitySettings.full_page_writes; },
    renamedTest: (value) => { value.tests.names[0] = "sustains ingest"; },
    missingTest: (value) => { value.tests.names.pop(); value.tests.total -= 1; value.tests.passed -= 1; },
    failedTest: (value) => { value.tests.failed = 1; },
    unsuccessfulRun: (value) => { value.tests.success = false; },
    shortSoak: (value) => { value.soakSeconds = MINIMUM_SOAK_SECONDS - 1; value.metrics[1].seconds = MINIMUM_SOAK_SECONDS - 1; },
    soakMismatch: (value) => { value.metrics[1].seconds = 15; },
    noRacedRetries: (value) => { value.metrics[1].racedRetries = 0; },
    connectionsBeyondPool: (value) => { value.metrics[1].maxAppConnections = 9; },
    missingMetrics: (value) => { value.metrics.pop(); },
    disallowedExecutable: (value) => { value.crash.executable = "sh"; },
    fewerCycles: (value) => { value.crash.cycles.pop(); },
    otherPlanLength: (value) => { value.crash.planLength = 10; },
    failedCycle: (value) => { value.crash.cycles[1].violations = ["tenant 0: 2 receipts for head 3"]; },
    digestMismatch: (value) => { value.inputs[0].sha256 = "0".repeat(64); },
    inputSetMismatch: (value) => { value.inputSetDigest = "0".repeat(64); },
    missingInput: (value) => { value.inputs.pop(); value.inputSetDigest = digestInputs(value.inputs); },
  };
  for (const [name, mutate] of Object.entries(negatives)) {
    assert.equal(without(mutate), false, name);
  }
  assert.equal(durabilityReportPassesPolicy(undefined), false);
});

test("a crash cycle counts only when the kill landed mid-run, lost nothing acknowledged, and resumed exactly", () => {
  assert.equal(cyclePassed(cycle()), true);
  const negatives = {
    // The load finished: the kill never interrupted anything.
    loadCompleted: { loadCompleted: true },
    loadExitedCleanly: { loadExitCode: 0 },
    // An acknowledged write did not survive the kill.
    lostAcknowledgement: { committed: cycle().committed.map((value, index) => index === 0 ? cycle().acknowledged[0] - 1 : value) },
    // More than the one in-flight item per tenant appeared above its acknowledgement.
    phantomCommits: { committed: cycle().committed.map((value, index) => index === 0 ? cycle().acknowledged[0] + 2 : value) },
    noAcknowledgements: { acknowledged: null },
    shortAcknowledgements: { acknowledged: cycle().acknowledged.slice(1) },
    // A committed item answered as fresh (applied twice), or a fresh item answered as a duplicate.
    duplicateShort: { duplicates: cycle().duplicates - 1 },
    duplicateOver: { duplicates: cycle().duplicates + 1 },
    unfinishedTenant: { final: [...cycle().final.slice(1), CRASH_PLAN_LENGTH - 1] },
    violation: { violations: ["tenant 0: 2 receipts for head 3"] },
    verifierFailed: { verifyExitCode: 1 },
    shortCommitted: { committed: cycle().committed.slice(1) },
  };
  for (const [name, overrides] of Object.entries(negatives)) {
    assert.equal(cyclePassed(cycle(overrides)), false, name);
  }
  // Nothing committed before the kill, or every tenant had already finished.
  const none = Array.from({ length: CRASH_TENANTS }, () => 0);
  assert.equal(cyclePassed(cycle({ acknowledged: none, committed: none, duplicates: 0 })), false);
  const all = Array.from({ length: CRASH_TENANTS }, () => CRASH_PLAN_LENGTH);
  assert.equal(cyclePassed(cycle({ acknowledged: all, committed: all, duplicates: CRASH_TENANTS * CRASH_PLAN_LENGTH })), false);
});
