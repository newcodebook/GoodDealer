/**
 * Crash-recovery driver for the workspace sync durability evidence. The collector runs `load`,
 * kills the PostgreSQL server while it writes, restarts it, then runs `verify`. It is a process of
 * its own because the crash must outlive the client: nothing here may observe or tidy up after the
 * kill.
 *
 * - `load` resets the tenants, prints `LOAD_STARTED` once writes flow, and writes every tenant's
 *   plan concurrently until the server dies. Only the server is killed, so the load then prints
 *   each tenant's highest acknowledged sequence as `ACKNOWLEDGED <json>` and exits non-zero; the
 *   collector requires every acknowledged write to have survived the crash.
 * - `verify` checks every tenant's committed prefix against the invariant, resubmits each whole
 *   plan (committed items must come back as exact duplicates at their stored revision), and checks
 *   the invariant again at the full plan length. It prints one JSON line with what it saw.
 */
import {
  durabilityHarness,
  readTenant,
  requireQualifiedServer,
  resetTenants,
  runTenantPlan,
  tenantInvariantErrors,
} from "./workspace-sync-load";

const CRASH_TENANTS = 12;
const CRASH_PLAN_LENGTH = 1_000;

const phase = process.argv[2];
if (phase === "load") await load();
else if (phase === "verify") await verify();
else throw new Error("usage: crash-recovery.ts load|verify");

async function load(): Promise<void> {
  const harness = durabilityHarness(CRASH_TENANTS);
  await requireQualifiedServer(harness);
  await resetTenants(harness, CRASH_TENANTS);
  let announced = false;
  const latencies: number[] = [];
  const announce = setInterval(() => {
    if (!announced && latencies.length >= CRASH_TENANTS * 10) {
      announced = true;
      console.log("LOAD_STARTED");
    }
  }, 20);
  const acknowledged = Array.from({ length: CRASH_TENANTS }, () => 0);
  // allSettled, not all: every tenant must stop on its own failure before the acknowledged
  // sequences are final, or a tenant still in flight could acknowledge after the report.
  const outcomes = await Promise.allSettled(Array.from({ length: CRASH_TENANTS }, (_, index) =>
    runTenantPlan(harness, index, 1, CRASH_PLAN_LENGTH, {
      allowDuplicates: false,
      latencies,
      onAcknowledged: (sequence) => { acknowledged[index] = sequence; },
    })));
  clearInterval(announce);
  if (outcomes.some((outcome) => outcome.status === "rejected")) {
    console.log(`ACKNOWLEDGED ${JSON.stringify(acknowledged)}`);
    process.exit(1);
  }
  // Finishing the whole plan means the crash never landed; the collector rejects that cycle.
  console.log("LOAD_COMPLETED");
  await harness.close();
}

async function verify(): Promise<void> {
  const harness = durabilityHarness(CRASH_TENANTS);
  try {
    await requireQualifiedServer(harness);
    const committed: number[] = [];
    const violations: string[] = [];
    for (let index = 0; index < CRASH_TENANTS; index += 1) {
      const state = await readTenant(harness, index);
      committed.push(state.head);
      violations.push(...tenantInvariantErrors(index, state));
    }
    const duplicates = { count: 0 };
    if (violations.length === 0) {
      await Promise.all(Array.from({ length: CRASH_TENANTS }, (_, index) =>
        runTenantPlan(harness, index, 1, CRASH_PLAN_LENGTH, { allowDuplicates: true, duplicates })));
    }
    const final: number[] = [];
    for (let index = 0; index < CRASH_TENANTS; index += 1) {
      const state = await readTenant(harness, index);
      final.push(state.head);
      violations.push(...tenantInvariantErrors(index, state));
      if (state.head !== CRASH_PLAN_LENGTH) violations.push(`tenant ${index}: resumed head ${state.head}`);
    }
    const committedTotal = committed.reduce((sum, value) => sum + value, 0);
    // Every committed item, and only those, must be answered as a duplicate on resubmission.
    if (duplicates.count !== committedTotal) {
      violations.push(`${duplicates.count} duplicates for ${committedTotal} committed items`);
    }
    console.log(JSON.stringify({ committed, final, duplicates: duplicates.count, violations }));
    process.exitCode = violations.length === 0 ? 0 : 1;
  } finally {
    await harness.close();
  }
}
