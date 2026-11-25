import { appendFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  durabilityHarness,
  lifecycleInvariantErrors,
  lifecycleItem,
  lifecyclePush,
  percentile,
  plannedPush,
  readLifecycle,
  readTenant,
  requireQualifiedServer,
  resetTenants,
  runTenantPlan,
  tenant,
  tenantInvariantErrors,
} from "./support/workspace-sync-load";

// The capacity tenants each get a different plan length, so a count leaking across tenants
// cannot coincide with the expected one.
const CAPACITY_TENANTS = 16;
const CAPACITY_BASE = 40;
const APP_CONNECTIONS = 8;
// CI raises the soak to its qualification length; the default keeps `pnpm test:postgres` short.
const SOAK_SECONDS = soakSeconds();
const SOAK_TENANTS = 8;
const LIFECYCLE_TENANTS = 8;
const LIFECYCLE_CYCLES = 6;

const harness = durabilityHarness(APP_CONNECTIONS);

beforeAll(async () => {
  await requireQualifiedServer(harness);
});

afterAll(async () => {
  await harness.close();
});

describe("PostgreSQL workspace sync durability", () => {
  it("sustains concurrent multi-tenant ingest with dense heads, exact receipts, and forced RLS isolation", async () => {
    await resetTenants(harness, CAPACITY_TENANTS);
    // Isolation below is behavioural; this pins why it holds. Every table the workloads (the re-add
    // lifecycle included) write or their invariants read forces RLS (so even its owner is
    // confined), and the application role neither owns them nor bypasses RLS.
    const workloadTables = [
      "mutation_drain_heads", "workspace_device_mutation_heads", "workspace_device_mutation_sequence_ledger",
      "workspace_mutation_fields", "workspace_mutation_receipts", "workspace_mutations",
      "workspace_replica_domain_assets", "workspace_replica_tombstones", "workspace_revisions",
    ];
    const catalog = await harness.ownerPool.query<{ relname: string; enabled: boolean; forced: boolean; owner: string }>(
      `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c WHERE c.relname = ANY($1::text[]) AND c.relkind = 'r' ORDER BY c.relname`,
      [workloadTables],
    );
    expect(catalog.rows.map(({ relname, enabled, forced }) => ({ relname, enabled, forced })))
      .toEqual(workloadTables.map((relname) => ({ relname, enabled: true, forced: true })));
    expect(catalog.rows.every(({ owner }) => owner !== "gooddealer_cloud_app")).toBe(true);
    const appRole = await harness.ownerPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'gooddealer_cloud_app'",
    );
    expect(appRole.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const latencies: number[] = [];
    const started = performance.now();
    await Promise.all(Array.from({ length: CAPACITY_TENANTS }, (_, index) =>
      runTenantPlan(harness, index, 1, CAPACITY_BASE + index, { allowDuplicates: false, latencies })));
    const seconds = (performance.now() - started) / 1000;

    const errors: string[] = [];
    for (let index = 0; index < CAPACITY_TENANTS; index += 1) {
      const state = await readTenant(harness, index);
      expect(state.head).toBe(CAPACITY_BASE + index);
      errors.push(...tenantInvariantErrors(index, state));
    }
    expect(errors).toEqual([]);
    const total = latencies.length;
    recordMetrics("capacity", {
      tenants: CAPACITY_TENANTS, mutations: total, connections: APP_CONNECTIONS, seconds,
      mutationsPerSecond: total / seconds, p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95),
      p99Ms: percentile(latencies, 0.99),
    });
    console.info(`durability capacity: ${CAPACITY_TENANTS} tenants, ${total} mutations, ${APP_CONNECTIONS} connections, `
      + `${(total / seconds).toFixed(1)} mutations/s, p50 ${percentile(latencies, 0.5).toFixed(1)} ms, `
      + `p95 ${percentile(latencies, 0.95).toFixed(1)} ms, p99 ${percentile(latencies, 0.99).toFixed(1)} ms`);
  }, 300_000);

  it("keeps every invariant and a bounded connection count through a sustained mixed workload", async () => {
    await resetTenants(harness, SOAK_TENANTS);
    const deadline = Date.now() + SOAK_SECONDS * 1000;
    const progress = Array.from({ length: SOAK_TENANTS }, () => 0);
    const latencies: number[] = [];
    const duplicates = { count: 0 };
    const violations: string[] = [];
    let checks = 0;
    let maxConnections = 0;
    const rssStart = process.memoryUsage().rss;

    const worker = async (index: number): Promise<void> => {
      while (Date.now() < deadline) {
        const next = (progress[index] ?? 0) + 1;
        // A lost-response retry of an earlier item races every fourth write; it must come back as
        // the exact duplicate at its stored revision and never move the head.
        const retry = next > 1 && next % 4 === 0 ? 1 + ((next * 7) % (next - 1)) : null;
        await Promise.all([
          runTenantPlan(harness, index, next, next, { allowDuplicates: false, latencies }),
          retry === null ? Promise.resolve() : runTenantPlan(harness, index, retry, retry, { allowDuplicates: true, duplicates }),
        ]);
        progress[index] = next;
      }
    };
    const auditor = async (): Promise<void> => {
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        for (let index = 0; index < SOAK_TENANTS; index += 1) {
          violations.push(...tenantInvariantErrors(index, await readTenant(harness, index)));
        }
        const connections = await harness.ownerPool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname = current_database() AND usename = 'gooddealer_cloud_app'`,
        );
        maxConnections = Math.max(maxConnections, connections.rows[0]?.count ?? 0);
        checks += 1;
      }
    };
    await Promise.all([...Array.from({ length: SOAK_TENANTS }, (_, index) => worker(index)), auditor()]);

    for (let index = 0; index < SOAK_TENANTS; index += 1) {
      const state = await readTenant(harness, index);
      expect(state.head).toBe(progress[index]);
      violations.push(...tenantInvariantErrors(index, state));
    }
    expect(violations).toEqual([]);
    expect(checks).toBeGreaterThan(0);
    expect(maxConnections).toBeLessThanOrEqual(APP_CONNECTIONS);
    expect(duplicates.count).toBeGreaterThan(0);
    const writes = progress.reduce((sum, value) => sum + value, 0);
    recordMetrics("soak", {
      seconds: SOAK_SECONDS, tenants: SOAK_TENANTS, writes, racedRetries: duplicates.count, invariantSweeps: checks,
      maxAppConnections: maxConnections, p95Ms: percentile(latencies, 0.95),
      rssStartMiB: rssStart / 2 ** 20, rssEndMiB: process.memoryUsage().rss / 2 ** 20,
    });
    console.info(`durability soak: ${SOAK_SECONDS} s, ${SOAK_TENANTS} tenants, ${writes} writes, ${duplicates.count} raced retries, `
      + `${checks} invariant sweeps, max ${maxConnections} app connections, p95 ${percentile(latencies, 0.95).toFixed(1)} ms, `
      + `RSS ${(rssStart / 2 ** 20).toFixed(0)} -> ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)} MiB`);
  }, (SOAK_SECONDS + 300) * 1000);

  it("detects a torn tenant, so a passing invariant is evidence and not a tautology", async () => {
    await resetTenants(harness, 1);
    await runTenantPlan(harness, 0, 1, 3, { allowDuplicates: false });
    expect(tenantInvariantErrors(0, await readTenant(harness, 0))).toEqual([]);
    const torn = await readTenant(harness, 0);
    expect(tenantInvariantErrors(0, { ...torn, receipts: 2 })).toEqual(["tenant 0: 2 receipts for head 3"]);
    expect(tenantInvariantErrors(0, { ...torn, minRevision: 2 })).toEqual(["tenant 0: mutation log spans 2..3, not 1..3"]);
    expect(tenantInvariantErrors(0, { ...torn, drainHighest: 4 })).toEqual(["tenant 0: Drain head 3/4 for head 3"]);
    expect(tenantInvariantErrors(0, { ...torn, note: "durable-0-2" })).toEqual(["tenant 0: replica note durable-0-2 is not durable-0-3"]);
    expect(tenantInvariantErrors(0, { ...torn, foreignRows: 1 })).toEqual(["tenant 0: 1 rows of other tenants are visible"]);
    expect(tenantInvariantErrors(0, { ...torn, fields: 4, mutations: 4 })).toEqual([
      "tenant 0: 4 mutations for head 3", "tenant 0: 4 changed fields for head 3",
    ]);
  });

  it("answers a resubmitted or concurrently doubled plan with exact duplicates and never applies an item twice", async () => {
    await resetTenants(harness, 2);
    await runTenantPlan(harness, 0, 1, 10, { allowDuplicates: false });
    const duplicates = { count: 0 };
    await runTenantPlan(harness, 0, 1, 12, { allowDuplicates: true, duplicates });
    expect(duplicates.count).toBe(10);
    expect(tenantInvariantErrors(0, await readTenant(harness, 0))).toEqual([]);
    expect((await readTenant(harness, 0)).head).toBe(12);
    // The same item submitted twice at once, as a client retry racing its own first attempt does:
    // it is applied exactly once and the other submission is its exact duplicate.
    const raced = await Promise.all([
      harness.ingest.ingest(tenant(0), plannedPush(0, 13)),
      harness.ingest.ingest(tenant(0), plannedPush(0, 13)),
    ]);
    expect(raced.map((result) => result.accepted && result.assignments[0]?.serverRevision)).toEqual([13, 13]);
    expect(raced.filter((result) => result.accepted && result.assignments[0]?.duplicate === false)).toHaveLength(1);
    expect(tenantInvariantErrors(0, await readTenant(harness, 0))).toEqual([]);
    expect((await readTenant(harness, 0)).head).toBe(13);
    // The other tenant shares the workspace id and mutation sequence numbers but none of the data.
    expect(await readTenant(harness, 1)).toMatchObject({ head: 0, mutations: 0, receipts: 0, foreignRows: 0 });
    // Another tenant's plan item replayed into this tenant is a fresh item there, not a duplicate.
    await expect(harness.ingest.ingest(tenant(1), plannedPush(0, 1))).resolves.toMatchObject({
      accepted: true, assignments: [{ serverRevision: 1, duplicate: false }],
    });
  }, 60_000);

  it("re-adds a deleted asset exactly once per generation under concurrent tenants and racing re-adds", async () => {
    // ADR-0029 decision 3 under load: every tenant deletes its asset and races two different
    // re-adds of that deletion (plus a resubmission of the first) on the shared connection pool.
    // Exactly one re-add takes the next generation; the other, and a late edit of the deleted
    // generation, are recorded as single-item refusals that occupy their device sequences.
    await resetTenants(harness, LIFECYCLE_TENANTS);
    const outcomes = { reAddsAccepted: 0, reAddsRefused: 0, resubmissionsMatched: 0, staleRefused: 0 };
    const errors: string[] = [];
    const lifecycle = async (index: number): Promise<void> => {
      let head = 0;
      for (let cycle = 1; cycle <= LIFECYCLE_CYCLES; cycle += 1) {
        const deleted = await harness.ingest.ingest(tenant(index), lifecyclePush(index, cycle, "delete", head, 0));
        if (!deleted.accepted || deleted.assignments[0]?.serverRevision !== head + 1) {
          errors.push(`tenant ${index} cycle ${cycle}: delete ${JSON.stringify(deleted)}`);
          return;
        }
        head += 1;
        const deletedRevision = head;
        const reAddA = lifecyclePush(index, cycle, "re-add-a", deletedRevision, deletedRevision);
        const [first, second, resubmitted] = await Promise.all([
          harness.ingest.ingest(tenant(index), reAddA),
          harness.ingest.ingest(tenant(index), lifecyclePush(index, cycle, "re-add-b", deletedRevision, deletedRevision)),
          harness.ingest.ingest(tenant(index), reAddA),
        ]);
        const winners = [first, second].filter((result) => result.accepted);
        const losers = [first, second].filter((result) => !result.accepted);
        if (winners.length !== 1 || losers.length !== 1
          || winners[0]?.accepted !== true || winners[0].assignments[0]?.serverRevision !== head + 1
          || losers[0]?.accepted !== false || losers[0].code !== "MUTATION_GENERATION_MISMATCH") {
          errors.push(`tenant ${index} cycle ${cycle}: re-adds ${JSON.stringify([first, second])}`);
          return;
        }
        // The resubmission answers with the first re-add's own stored result, whichever it was.
        const resubmissionMatches = first.accepted
          ? resubmitted.accepted && resubmitted.assignments[0]?.serverRevision === head + 1
          : !resubmitted.accepted && resubmitted.code === first.code;
        if (!resubmissionMatches) {
          errors.push(`tenant ${index} cycle ${cycle}: resubmission ${JSON.stringify([first, resubmitted])}`);
          return;
        }
        outcomes.reAddsAccepted += 1;
        outcomes.reAddsRefused += 1;
        outcomes.resubmissionsMatched += 1;
        head += 1;
        const stale = await harness.ingest.ingest(tenant(index), lifecyclePush(index, cycle, "stale", head, 0));
        if (stale.accepted || stale.code !== "MUTATION_GENERATION_MISMATCH") {
          errors.push(`tenant ${index} cycle ${cycle}: stale ${JSON.stringify(stale)}`);
          return;
        }
        outcomes.staleRefused += 1;
        const edited = await harness.ingest.ingest(tenant(index), lifecyclePush(index, cycle, "edit", head, 0));
        if (!edited.accepted || edited.assignments[0]?.serverRevision !== head + 1) {
          errors.push(`tenant ${index} cycle ${cycle}: edit ${JSON.stringify(edited)}`);
          return;
        }
        head += 1;
      }
    };
    await Promise.all(Array.from({ length: LIFECYCLE_TENANTS }, (_, index) => lifecycle(index)));
    expect(errors).toEqual([]);
    const expected = LIFECYCLE_TENANTS * LIFECYCLE_CYCLES;
    expect(outcomes).toEqual({
      reAddsAccepted: expected, reAddsRefused: expected, resubmissionsMatched: expected, staleRefused: expected,
    });
    for (let index = 0; index < LIFECYCLE_TENANTS; index += 1) {
      expect(lifecycleInvariantErrors(index, LIFECYCLE_CYCLES, await readLifecycle(harness, index))).toEqual([]);
    }
    // The invariant is evidence, not a tautology: a doubled generation or a surviving tombstone fails it.
    const sound = await readLifecycle(harness, 0);
    expect(lifecycleInvariantErrors(0, LIFECYCLE_CYCLES, { ...sound, reAdds: [...sound.reAdds, "8@19"] }))
      .toHaveLength(1);
    expect(lifecycleInvariantErrors(0, LIFECYCLE_CYCLES, { ...sound, tombstones: 1 })).toHaveLength(1);
    expect(lifecycleItem(0, 2, "delete").deviceSequence).toBe(6);
    console.info(`durability re-add: ${LIFECYCLE_TENANTS} tenants x ${LIFECYCLE_CYCLES} generations, `
      + `${expected} re-adds accepted once, ${expected} racing re-adds and ${expected} stale writes refused`);
  }, 300_000);
});

/** The evidence collector names a file to receive the measured figures; ordinary runs only log. */
function recordMetrics(kind: string, figures: Record<string, number>): void {
  const file = process.env.GOODDEALER_DURABILITY_METRICS_FILE;
  if (file !== undefined && file !== "") appendFileSync(file, `${JSON.stringify({ kind, ...figures })}\n`, "utf8");
}

function soakSeconds(): number {
  const raw = process.env.GOODDEALER_POSTGRES_SOAK_SECONDS;
  if (raw === undefined || raw === "") return 15;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 7_200) {
    throw new Error("GOODDEALER_POSTGRES_SOAK_SECONDS must be an integer from 1 to 7200");
  }
  return value;
}
