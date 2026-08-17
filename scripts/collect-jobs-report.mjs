/**
 * Evidence producer for WP-4 jobs slice.
 *
 * Runs the negative matrix and reports results with 4 segments:
 * cross-tenant, replay, idempotency, lease-contention.
 * Asserts periodicJobsRegistered === false.
 *
 * Usage: node scripts/collect-jobs-report.mjs <output-path>
 */

import { existsSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const outputPath = process.argv[2] ?? resolve(root, ".artifacts/wp4/jobs/jobs-report.json");

// ---------------------------------------------------------------------------
// TypeScript hooks — same pattern as collect-cloud-boundary-report.mjs
// ---------------------------------------------------------------------------

let hooksRegistered = false;

function registerTypeScriptHooks() {
  if (hooksRegistered) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../"))
        && !/\.[a-z0-9]+$/i.test(specifier)
        && context.parentURL !== undefined
      ) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  hooksRegistered = true;
}

registerTypeScriptHooks();

// ---------------------------------------------------------------------------
// Load runtime modules via pathToFileURL
// ---------------------------------------------------------------------------

const protocol = await import(
  pathToFileURL(resolve(root, "packages/protocol/src/jobs/index.ts"))
);
const jobRuntime = await import(
  pathToFileURL(resolve(root, "apps/cloud/src/modules/job-runtime/index.ts"))
);
const jobs = await import(
  pathToFileURL(resolve(root, "apps/cloud/src/entrypoints/jobs.ts"))
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseTime = new Date("2026-01-15T10:00:00.000Z");
function timeOffset(ms) {
  return new Date(baseTime.getTime() + ms);
}

function tenant(overrides) {
  return {
    accountId: overrides?.accountId ?? "acct-001",
    workspaceId: overrides?.workspaceId ?? "ws-001",
  };
}

function envelope(overrides) {
  return {
    schemaVersion: protocol.TENANT_JOB_SCHEMA_VERSION,
    envelopeId: "env-001",
    tenant: tenant(),
    jobKind: "workspace_maintenance",
    idempotencyKey: "idem-001",
    leaseEpoch: 1,
    attempt: 1,
    enqueuedAt: "2026-01-15T10:00:00Z",
    payload: { targetEntity: "entity-001" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Segment 1: Cross-tenant isolation
// ---------------------------------------------------------------------------

function runCrossTenantSegment() {
  const results = [];
  const { JobIdempotencyStore, JobQuarantineLedger } = jobRuntime;

  // N-04: cross-tenant violation — invalid tenant rejected at schema level
  const r1 = protocol.tenantJobEnvelopeSchema.safeParse(
    envelope({ tenant: { accountId: "", workspaceId: "ws-001" } }),
  );
  results.push({ vector: "N-04-invalid-tenant", passed: !r1.success });

  // N-05: dual-tenant same literal ID → independent composite keys
  const keyA = protocol.buildJobIdempotencyKey(
    { accountId: "acct-A", workspaceId: "ws-shared" },
    "workspace_maintenance",
    "idem-shared",
  );
  const keyB = protocol.buildJobIdempotencyKey(
    { accountId: "acct-B", workspaceId: "ws-shared" },
    "workspace_maintenance",
    "idem-shared",
  );
  results.push({ vector: "N-05-dual-tenant-independence", passed: keyA !== keyB });

  // N-14: cross-tenant quarantine read → invisible
  const ledger = new JobQuarantineLedger();
  ledger.quarantine(
    tenant({ accountId: "acct-A" }),
    "workspace_maintenance",
    "part-001",
    "unknown_envelope",
    baseTime,
  );
  const visibleToB = ledger.listForTenant(tenant({ accountId: "acct-B" }));
  results.push({ vector: "N-14-cross-tenant-quarantine-invisible", passed: visibleToB.length === 0 });

  // Cross-tenant idempotency store isolation
  const store = new JobIdempotencyStore();
  const envelopeA = {
    ...envelope(),
    tenant: { accountId: "acct-A", workspaceId: "ws-001" },
  };
  const parsed = protocol.tenantJobEnvelopeSchema.parse(envelopeA);
  store.record(parsed, "completed");
  const envelopeB = {
    ...envelope(),
    tenant: { accountId: "acct-B", workspaceId: "ws-001" },
  };
  const parsedB = protocol.tenantJobEnvelopeSchema.parse(envelopeB);
  const check = store.check(parsedB);
  results.push({ vector: "cross-tenant-idempotency-isolation", passed: check.status === "new" });

  const allPassed = results.every((r) => r.passed);
  return { passed: allPassed, count: results.length, results };
}

// ---------------------------------------------------------------------------
// Segment 2: Replay detection
// ---------------------------------------------------------------------------

function runReplaySegment() {
  const results = [];
  const { JobIdempotencyStore, JobLeaseRegistry, JobQuarantineLedger, submitEnvelope } = jobRuntime;

  // N-06: replay same key same content → deduplicate
  const registry = new JobLeaseRegistry();
  const store = new JobIdempotencyStore();
  const ledger = new JobQuarantineLedger();

  const env = envelope();
  const first = submitEnvelope(env, registry, store, ledger, baseTime);
  const second = submitEnvelope(env, registry, store, ledger, baseTime);
  results.push({
    vector: "N-06-replay-same-content-dedup",
    passed: first.accepted && second.accepted && second.deduplicated === true,
  });

  // N-01: unknown field → rejected
  const r01 = submitEnvelope(
    envelope({ extraSecret: "bad" }),
    new JobLeaseRegistry(),
    new JobIdempotencyStore(),
    new JobQuarantineLedger(),
    baseTime,
  );
  results.push({ vector: "N-01-unknown-field-rejected", passed: !r01.accepted });

  // N-02: unknown jobKind → rejected
  const r02 = submitEnvelope(
    envelope({ jobKind: "nonexistent" }),
    new JobLeaseRegistry(),
    new JobIdempotencyStore(),
    new JobQuarantineLedger(),
    baseTime,
  );
  results.push({ vector: "N-02-unknown-jobKind-rejected", passed: !r02.accepted && r02.reason === "unknown_envelope" });

  const allPassed = results.every((r) => r.passed);
  return { passed: allPassed, count: results.length, results };
}

// ---------------------------------------------------------------------------
// Segment 3: Idempotency
// ---------------------------------------------------------------------------

function runIdempotencySegment() {
  const results = [];
  const { JobIdempotencyStore, JobLeaseRegistry, JobQuarantineLedger, submitEnvelope } = jobRuntime;

  // N-07: replay same key different content → quarantine idempotency_conflict
  const registry = new JobLeaseRegistry();
  const store = new JobIdempotencyStore();
  const ledger = new JobQuarantineLedger();

  submitEnvelope(envelope(), registry, store, ledger, baseTime);
  const different = envelope({ payload: { targetEntity: "different-entity" } });
  const r07 = submitEnvelope(different, registry, store, ledger, baseTime);
  results.push({
    vector: "N-07-idempotency-conflict",
    passed: !r07.accepted && r07.reason === "idempotency_conflict" && r07.quarantined?.reason === "idempotency_conflict",
  });

  // N-03: payload schema invalid → quarantine
  const r03 = submitEnvelope(
    envelope({ payload: { targetEntity: "" } }),
    new JobLeaseRegistry(),
    new JobIdempotencyStore(),
    new JobQuarantineLedger(),
    baseTime,
  );
  results.push({ vector: "N-03-payload-invalid-quarantine", passed: !r03.accepted && r03.reason === "payload_schema_invalid" });

  // N-12: max attempts exceeded → quarantine
  const r12 = submitEnvelope(
    envelope({ attempt: 6, idempotencyKey: "idem-max" }),
    new JobLeaseRegistry(),
    new JobIdempotencyStore(),
    new JobQuarantineLedger(),
    baseTime,
  );
  results.push({
    vector: "N-12-max-attempts-quarantine",
    passed: !r12.accepted && r12.reason === "max_attempts_exhausted",
  });

  const allPassed = results.every((r) => r.passed);
  return { passed: allPassed, count: results.length, results };
}

// ---------------------------------------------------------------------------
// Segment 4: Lease contention
// ---------------------------------------------------------------------------

function runLeaseContentionSegment() {
  const results = [];
  const { JobLeaseRegistry } = jobRuntime;

  // N-08: lease contention — second acquire rejected
  const registry = new JobLeaseRegistry();
  registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-A", baseTime);
  const contention = registry.acquire(tenant(), "workspace_maintenance", "part-001", "worker-B", baseTime);
  results.push({
    vector: "N-08-lease-contention",
    passed: "rejected" in contention && contention.reason === "lease_contention",
  });

  // N-09: stale epoch — renew with wrong epoch rejected
  const r09 = registry.renew("part-001", "worker-A", 999, baseTime);
  results.push({
    vector: "N-09-stale-epoch",
    passed: "rejected" in r09 && r09.reason === "stale_lease_epoch",
  });

  // N-10: expired lease renewal rejected
  const expiredTime = timeOffset(11 * 60 * 1000);
  const r10 = registry.renew("part-001", "worker-A", 1, expiredTime);
  results.push({
    vector: "N-10-expired-lease-renewal",
    passed: "rejected" in r10 && r10.reason === "expired_lease",
  });

  // N-11: epoch reuse — monotonic enforcement
  const registry2 = new JobLeaseRegistry();
  const first = registry2.acquire(tenant(), "workspace_maintenance", "mono-part", "worker-A", baseTime);
  if (!("rejected" in first)) {
    registry2.release("mono-part", "worker-A", first.leaseEpoch);
    const later = timeOffset(11 * 60 * 1000);
    const second = registry2.acquire(tenant(), "workspace_maintenance", "mono-part", "worker-B", later);
    results.push({
      vector: "N-11-epoch-monotonic",
      passed: !("rejected" in second) && second.leaseEpoch > first.leaseEpoch,
    });
  }

  // N-13: no active lease — renew for nonexistent partition
  const r13 = registry.renew("nonexistent-partition", "worker-A", 1, baseTime);
  results.push({
    vector: "N-13-no-active-lease",
    passed: "rejected" in r13 && r13.reason === "no_active_lease",
  });

  const allPassed = results.every((r) => r.passed);
  return { passed: allPassed, count: results.length, results };
}

// ---------------------------------------------------------------------------
// Assemble report
// ---------------------------------------------------------------------------

const crossTenant = runCrossTenantSegment();
const replay = runReplaySegment();
const idempotency = runIdempotencySegment();
const leaseContention = runLeaseContentionSegment();

// Assert periodicJobsRegistered === false
const periodicJobsRegistered = jobs.periodicJobs.length > 0;

const report = {
  schemaVersion: 1,
  periodicJobsRegistered: periodicJobsRegistered,
  crossTenant,
  replay,
  idempotency,
  leaseContention,
  generatedAt: new Date().toISOString(),
};

const allSegmentsPassed =
  crossTenant.passed && replay.passed && idempotency.passed && leaseContention.passed;

if (!allSegmentsPassed) {
  console.error("FAIL: not all segments passed");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}

if (periodicJobsRegistered) {
  console.error("FAIL: periodicJobsRegistered must be false");
  process.exitCode = 1;
}

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Jobs evidence report written to ${outputPath}`);
console.log(JSON.stringify(report, null, 2));
