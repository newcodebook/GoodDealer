/**
 * Local evidence producer for the durable Licensing periodic-job composition.
 *
 * This exercises scheduler registration and application-port dispatch with in-memory fakes. It
 * does not observe a production scheduler/worker, provider network, production deployment, or release state.
 *
 * Usage: node scripts/collect-jobs-report.mjs <output-path>
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const outputPath = process.argv[2] ?? resolve(root, ".artifacts/wp4/jobs/jobs-report.json");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../"))
        && !/\.[a-z0-9]+$/iu.test(specifier) && context.parentURL !== undefined) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform" }),
      };
    }
    return nextLoad(url, context);
  },
});

const jobs = await import(pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/jobs.ts")));
const licensingMigrationSource = readFileSync(resolve(
  root,
  "apps/cloud/src/modules/licensing/migrations/202608200015-commercial-entitlements.ts",
), "utf8");
const reconciliationServiceSource = readFileSync(resolve(
  root,
  "apps/cloud/src/modules/licensing/payment-webhook-service.ts",
), "utf8");
const expectedJobs = [
  { jobName: "commercial-provider-operation", cron: "* * * * *", targetModule: "licensing", payloadVersion: 1 },
  { jobName: "commercial-provider-inbox", cron: "* * * * *", targetModule: "licensing", payloadVersion: 1 },
  { jobName: "commercial-provider-reconciliation", cron: "* * * * *", targetModule: "licensing", payloadVersion: 1 },
  { jobName: "commercial-due-authority", cron: "* * * * *", targetModule: "licensing", payloadVersion: 1 },
  { jobName: "commercial-provider-release", cron: "* * * * *", targetModule: "licensing", payloadVersion: 1 },
];

const scheduled = [];
const calls = [];
const observations = [];
const composition = jobs.createJobsComposition({
  scheduler: {
    async schedulePeriodic(spec) {
      scheduled.push({ ...spec });
      return { scheduled: true };
    },
  },
  ports: {
    commercialProvider: {
      async processNextOperation(workerId) {
        calls.push({ kind: "operation", workerId });
        return { status: "confirmed" };
      },
      async processNextInbox(workerId, leaseExpiresAt) {
        calls.push({ kind: "inbox", workerId, leaseExpiresAt });
        return { status: "applied" };
      },
      async processNextReconciliation(workerId, leaseExpiresAt) {
        calls.push({ kind: "reconciliation", workerId, leaseExpiresAt });
        return { status: "reconciled" };
      },
      async processNextDueAuthority(workerId) {
        calls.push({ kind: "due_authority", workerId });
        return { status: "applied" };
      },
      async processNextRelease(workerId) {
        calls.push({ kind: "release", workerId });
        return { status: "released" };
      },
    },
  },
  tenants: { create(tenantId) { return { tenantId }; } },
  now: () => new Date("2026-09-02T12:00:00.000Z"),
  observe(event) { observations.push({ ...event }); },
});

await composition.start();
await composition.start();
await composition.run("commercial-provider-operation", "worker-operation");
await composition.run("commercial-provider-inbox", "worker-inbox");
await composition.run("commercial-provider-reconciliation", "worker-reconciliation");
await composition.run("commercial-due-authority", "worker-due");
await composition.run("commercial-provider-release", "worker-release");
await composition.stop();

const registrationResults = [
  { vector: "exact-job-registry", passed: JSON.stringify(jobs.periodicJobs) === JSON.stringify(expectedJobs) },
  { vector: "schedule-each-job-once", passed: JSON.stringify(scheduled) === JSON.stringify(expectedJobs) },
  { vector: "framework-independent-composition", passed: composition.transport === "framework-independent" },
];
const dispatchResults = [
  { vector: "provider-operation-port", passed: calls[0]?.kind === "operation" && calls[0]?.workerId === "worker-operation" },
  { vector: "durable-inbox-port", passed: calls[1]?.kind === "inbox" && calls[1]?.workerId === "worker-inbox" },
  { vector: "reconciliation-port", passed: calls[2]?.kind === "reconciliation" && calls[2]?.workerId === "worker-reconciliation" },
  { vector: "due-authority-port", passed: calls[3]?.kind === "due_authority" && calls[3]?.workerId === "worker-due" },
  { vector: "release-port", passed: calls[4]?.kind === "release" && calls[4]?.workerId === "worker-release" },
  { vector: "bounded-observation", passed: observations.map(({ outcome }) => outcome).join(",") === "confirmed,applied,reconciled,applied,released" },
];

const unavailable = jobs.createJobsComposition();
let unavailableStartRejected = false;
let stoppedRunRejected = false;
try { await unavailable.start(); } catch { unavailableStartRejected = true; }
try { await composition.run("commercial-provider-inbox", "stopped-worker"); } catch { stoppedRunRejected = true; }
const failClosedResults = [
  { vector: "missing-dependencies-rejected", passed: unavailableStartRejected },
  { vector: "stopped-composition-rejects-run", passed: stoppedRunRejected },
];
const durabilityResults = [
  {
    vector: "overlap-leasing-skip-locked",
    passed: (licensingMigrationSource.match(/FOR UPDATE SKIP LOCKED/gu) ?? []).length >= 2
      && /lease_expires_at\s*<=\s*transaction_timestamp\(\)/u.test(licensingMigrationSource),
  },
  {
    vector: "failed-provider-read-reschedules",
    passed: /repository\.failBoundWork\(/u.test(reconciliationServiceSource)
      && /status: "retry_scheduled"/u.test(reconciliationServiceSource),
  },
  {
    vector: "provider-side-effect-idempotency-is-operation-owned",
    passed: /UNIQUE\s*\(provider,\s*provider_idempotency_key\)/u.test(licensingMigrationSource)
      && /provider_dispatch_permits/u.test(licensingMigrationSource),
  },
];

function segment(results) {
  return { passed: results.every(({ passed }) => passed), count: results.length, results };
}

const report = {
  schemaVersion: 1,
  fixtureOnly: true,
  hostedSchedulerObserved: false,
  liveProviderObserved: false,
  productionDeploymentObserved: false,
  registration: segment(registrationResults),
  dispatch: segment(dispatchResults),
  failClosed: segment(failClosedResults),
  durability: segment(durabilityResults),
  generatedAt: new Date().toISOString(),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Jobs evidence report written to ${outputPath}`);
console.log(JSON.stringify(report, null, 2));
if (![report.registration, report.dispatch, report.failClosed, report.durability].every(({ passed }) => passed)) {
  process.exitCode = 1;
}
