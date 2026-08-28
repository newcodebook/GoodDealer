import { createHash } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encodePersistentJobPayloadDigestInput } from "@gooddealer/protocol/jobs";

import { runCloudMigrations, TenantTransactionRunner } from "../../src/db/index";
import { cloudMigrations } from "../../src/db/migrations";
import {
  JobKindRegistry,
  PostgresJobRuntime,
  type JobKindDefinition,
  type JobRuntimeFaultPoint,
} from "../../src/modules/job-runtime/index";

const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
const appPool = new Pool({ connectionString: appUrl, max: 8 });
const reusePool = new Pool({ connectionString: appUrl, max: 1 });
const transactions = new TenantTransactionRunner(appPool);
const tenantA = { accountId: "job-account-a", workspaceId: "same-workspace" } as const;
const tenantB = { accountId: "job-account-b", workspaceId: "same-workspace" } as const;
const policy = {
  id: "fixture-db-policy", version: 1, maxAttempts: 3, attemptTimeoutSeconds: 60,
  leaseSeconds: 15, baseBackoffSeconds: 1, retryMode: "database_safe",
} as const;
let authorizationAllowed = true;
let authorizationCalls = 0;
let handlerCalls = 0;
let replayAuthorizationAllowed = true;
let replayAuthorizationCalls = 0;
const definition: JobKindDefinition<{ entityId: string; operation: string }> = {
  jobKind: "fixture_database_job", targetModule: "fixture-target", payloadVersion: 1,
  runtimePolicy: policy,
  decodePayload(value) {
    if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("payload invalid");
    const record = value as Record<string, unknown>;
    if (Object.keys(record).join(",") !== "entityId,operation" || typeof record.entityId !== "string" || typeof record.operation !== "string") {
      throw new TypeError("payload invalid");
    }
    return { entityId: record.entityId, operation: record.operation };
  },
  decodeCanonicalPayload() { throw new TypeError("fixture uses the explicit decoded target port"); },
  encodeCanonicalPayload(value) { return encodePersistentJobPayloadDigestInput(value); },
  derivePartitionKey(value) { return value.entityId; },
  authorization: { async revalidate() { authorizationCalls += 1; return authorizationAllowed; } },
  handler: { async handle() { handlerCalls += 1; return { outcomeDigest: createHash("sha256").update("fixture-outcome").digest() }; } },
};
const registry = new JobKindRegistry([definition]);
const replayAuthorization = {
  async verify() { replayAuthorizationCalls += 1; return replayAuthorizationAllowed; },
};
const runtime = new PostgresJobRuntime(transactions, registry, replayAuthorization);

beforeAll(async () => {
  const version = await ownerPool.query<{ server_version: string }>("SHOW server_version");
  if (process.env.GOODDEALER_UNQUALIFIED_POSTGRES_DIAGNOSTIC !== "true") {
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\D|$)/u);
  } else console.warn(`UNQUALIFIED PostgreSQL diagnostic only: ${version.rows[0]?.server_version}`);
  const roles = await ownerPool.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('gooddealer_cloud_app','gooddealer_cloud_owner') ORDER BY rolname",
  );
  expect(roles.rows).toEqual([
    { rolname: "gooddealer_cloud_app", rolsuper: false, rolbypassrls: false },
    { rolname: "gooddealer_cloud_owner", rolsuper: false, rolbypassrls: false },
  ]);
  await runCloudMigrations(ownerPool, cloudMigrations);
  await runCloudMigrations(ownerPool, cloudMigrations);
});

beforeEach(async () => {
  await ownerPool.query("TRUNCATE job_runtime_replay_events, job_runtime_quarantine_events, job_runtime_attempts, job_runtime_partition_leases, job_runtime_jobs");
  authorizationAllowed = true; authorizationCalls = 0; handlerCalls = 0;
  replayAuthorizationAllowed = true; replayAuthorizationCalls = 0;
});
afterAll(async () => { await Promise.all([ownerPool.end(), appPool.end(), reusePool.end()]); });

describe("PostgreSQL persistent tenant job runtime", () => {
  it("observes five FORCE RLS tables, compound tenant keys, non-privileged roles, and isolated same literal ids", async () => {
    const rls = await ownerPool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
       WHERE relname LIKE 'job_runtime_%' AND relkind='r' ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      "job_runtime_attempts", "job_runtime_jobs", "job_runtime_partition_leases",
      "job_runtime_quarantine_events", "job_runtime_replay_events",
    ].map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
    const first = await runtime.enqueue(tenantA, createInput(tenantA));
    const second = await runtime.enqueue(tenantB, createInput(tenantB));
    expect(first.status).toBe("enqueued"); expect(second.status).toBe("enqueued");
    await transactions.withTenant(tenantB, async (transaction) => {
      const rows = await transaction.query("SELECT job_id FROM job_runtime_jobs ORDER BY job_id");
      expect(rows.rows).toHaveLength(1);
      const crossUpdate = await transaction.query(
        "UPDATE job_runtime_jobs SET available_at=clock_timestamp() WHERE account_id=$1 AND workspace_id=$2",
        [tenantA.accountId, tenantA.workspaceId],
      );
      expect(crossUpdate.rowCount).toBe(0);
      await expect(transaction.query(
        `INSERT INTO job_runtime_partition_leases
          (account_id,workspace_id,job_kind,partition_key,highest_lease_epoch,state)
         VALUES ($1,$2,'fixture_database_job','cross',0,'released')`,
        [tenantA.accountId, tenantA.workspaceId],
      )).rejects.toThrow();
    });
  });

  it("deduplicates equal concurrent enqueue and quarantines only the digest of unequal same-key content", async () => {
    const equal = await Promise.all([runtime.enqueue(tenantA, createInput(tenantA)), runtime.enqueue(tenantA, createInput(tenantA))]);
    expect(equal.map(({ status }) => status).sort()).toEqual(["duplicate", "enqueued"]);
    expect(new Set(equal.map((result) => "job" in result ? result.job.jobId : result.jobId)).size).toBe(1);
    const before = await snapshotJob(tenantA);
    const conflict = await runtime.enqueue(tenantA, createInput(tenantA, { operation: "changed" }));
    expect(conflict.status).toBe("idempotency_conflict");
    expect(await snapshotJob(tenantA)).toEqual(before);
    await transactions.withTenant(tenantA, async (transaction) => {
      const events = await transaction.query<{ incoming: number }>(
        "SELECT count(incoming_request_digest)::integer AS incoming FROM job_runtime_quarantine_events",
      );
      expect(events.rows[0]).toEqual({ incoming: 1 });
    });
    const incomingColumns = await ownerPool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='job_runtime_quarantine_events' AND column_name LIKE 'incoming%' ORDER BY column_name",
    );
    expect(incomingColumns.rows).toEqual([{ column_name: "incoming_request_digest" }]);
    await expect(runtime.listQuarantine(tenantA)).resolves.toHaveLength(1);
    await expect(runtime.listQuarantine(tenantB)).resolves.toEqual([]);
  });

  it("uses SKIP LOCKED with one partition winner while unrelated partitions and tenants progress", async () => {
    await runtime.enqueue(tenantA, createInput(tenantA));
    const [first, second] = await Promise.all([runtime.claim(tenantA, "worker-a"), runtime.claim(tenantA, "worker-b")]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await runtime.enqueue(tenantA, createInput(tenantA, { entityId: "asset-2.test" }, "request-2"));
    await runtime.enqueue(tenantB, createInput(tenantB));
    expect(await runtime.claim(tenantA, "worker-c")).not.toBeNull();
    expect(await runtime.claim(tenantB, "worker-d")).not.toBeNull();
  });

  it("keeps leased handles opaque, immutable, unforgeable, and consume-once", async () => {
    await runtime.enqueue(tenantA, createInput(tenantA));
    const handle = await requiredClaim();
    expect(Object.isFrozen(handle)).toBe(true);
    for (const key of ["tenant", "job", "jobId", "jobKind", "partitionKey", "workerId", "leaseEpoch", "attempt"]) {
      expect(Reflect.has(handle as object, key)).toBe(false);
      expect(Reflect.set(handle as object, key, "attacker-value")).toBe(false);
      expect(() => Object.defineProperty(handle, key, { value: "attacker-value" })).toThrow();
    }
    expect(() => JSON.stringify(handle)).toThrow("not serializable");

    await expect(runtime.executeDecodedDatabaseJob(handle, definition, { entityId: "asset-1.test", operation: "touch" }))
      .resolves.toBe("completed");
    await expect(runtime.executeDecodedDatabaseJob(handle, definition, { entityId: "asset-1.test", operation: "touch" }))
      .rejects.toThrow("already consumed");
    expect({ authorizationCalls, handlerCalls }).toEqual({ authorizationCalls: 1, handlerCalls: 1 });

    const forged = Object.freeze({ toJSON() { throw new Error("forged"); } });
    await expect(runtime.renew(forged as never)).rejects.toThrow("invalid");
    await expect(runtime.retry(forged as never, "transient_database")).rejects.toThrow("invalid");
    await expect(runtime.quarantine(forged as never, "payload_schema_invalid")).rejects.toThrow("invalid");
    await expect(runtime.executeDecodedDatabaseJob(forged as never, definition, { entityId: "asset-1.test", operation: "touch" }))
      .rejects.toThrow("invalid");
    expect({ authorizationCalls, handlerCalls }).toEqual({ authorizationCalls: 1, handlerCalls: 1 });
  });

  it("makes every consumer stale with zero target access for every persisted fence mismatch", async () => {
    const mutations = [
      "UPDATE job_runtime_jobs SET current_worker='wrong-worker' WHERE state='leased'",
      "UPDATE job_runtime_jobs SET lease_epoch=lease_epoch+1 WHERE state='leased'",
      "UPDATE job_runtime_jobs SET attempt_count=attempt_count+1 WHERE state='leased'",
      "UPDATE job_runtime_jobs SET job_kind='wrong-kind' WHERE state='leased'",
      "UPDATE job_runtime_jobs SET partition_key='wrong-partition' WHERE state='leased'",
      `UPDATE job_runtime_partition_leases SET state='released',current_job_id=NULL,current_worker=NULL,
         current_lease_epoch=NULL,expires_at=NULL WHERE state IN ('held','renewed')`,
      "UPDATE job_runtime_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE state='leased'",
    ];
    const consumers = [
      async (handle: Awaited<ReturnType<typeof requiredClaim>>) => expect(runtime.renew(handle)).resolves.toBeNull(),
      async (handle: Awaited<ReturnType<typeof requiredClaim>>) => expect(runtime.retry(handle, "transient_database")).resolves.toBe("stale"),
      async (handle: Awaited<ReturnType<typeof requiredClaim>>) => expect(runtime.quarantine(handle, "payload_schema_invalid")).resolves.toBe("stale"),
      async (handle: Awaited<ReturnType<typeof requiredClaim>>) => expect(runtime.executeDatabaseJob(handle)).resolves.toBe("stale"),
      async (handle: Awaited<ReturnType<typeof requiredClaim>>) => expect(runtime.executeDecodedDatabaseJob(
        handle, definition, { entityId: "asset-1.test", operation: "touch" },
      )).resolves.toBe("stale"),
    ];
    for (const consume of consumers) {
      for (const mutation of mutations) {
        await reset();
        await runtime.enqueue(tenantA, createInput(tenantA));
        const handle = await requiredClaim();
        await transactions.withTenant(tenantA, (transaction) => transaction.query(mutation));
        authorizationCalls = 0; handlerCalls = 0;
        await consume(handle);
        expect({ authorizationCalls, handlerCalls }).toEqual({ authorizationCalls: 0, handlerCalls: 0 });
      }
    }
  });

  it("reclaims expired work with a higher epoch and gives the late worker zero authorization or handler access", async () => {
    const enqueued = await runtime.enqueue(tenantA, createInput(tenantA));
    if (!("job" in enqueued)) throw new Error("enqueue failed");
    const old = await runtime.claim(tenantA, "worker-old");
    if (old === null) throw new Error("initial claim failed");
    const oldEpoch = Number((await snapshotJob(tenantA, enqueued.job.jobId)).lease_epoch);
    await runtime.enqueue(tenantA, createInput(tenantA, {}, "request-behind-expired"));
    await transactions.withTenant(tenantA, async (transaction) => {
      await transaction.query("UPDATE job_runtime_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [enqueued.job.jobId]);
      await transaction.query("UPDATE job_runtime_partition_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE current_job_id=$1", [enqueued.job.jobId]);
    });
    const reclaimAttempts = await Promise.all([
      runtime.claim(tenantA, "worker-new"), runtime.claim(tenantA, "worker-racing"),
    ]);
    expect(reclaimAttempts.filter(Boolean)).toHaveLength(1);
    const current = reclaimAttempts.find((value) => value !== null) ?? null;
    if (current === null) throw new Error("reclaim failed");
    const reclaimed = await snapshotJob(tenantA, enqueued.job.jobId);
    expect(reclaimed.job_id).toBe(enqueued.job.jobId);
    expect(Number(reclaimed.lease_epoch)).toBeGreaterThan(oldEpoch);
    await expect(runtime.executeDecodedDatabaseJob(old, definition, { entityId: "asset-1.test", operation: "touch" })).resolves.toBe("stale");
    expect({ authorizationCalls, handlerCalls }).toEqual({ authorizationCalls: 0, handlerCalls: 0 });
    await expect(runtime.executeDecodedDatabaseJob(current, definition, { entityId: "asset-1.test", operation: "touch" })).resolves.toBe("completed");
    expect({ authorizationCalls, handlerCalls }).toEqual({ authorizationCalls: 1, handlerCalls: 1 });
  });

  it("rejects forged revoked and wrong-runtime replay capabilities before replay target access", async () => {
    await runtime.enqueue(tenantA, createInput(tenantA));
    await runtime.quarantine(await requiredClaim(), "payload_schema_invalid");
    const input = await replayInput();

    await expect(runtime.replay(Object.freeze({}) as never)).rejects.toThrow("capability");
    expect({ replayAuthorizationCalls, authorizationCalls }).toEqual({ replayAuthorizationCalls: 0, authorizationCalls: 0 });

    replayAuthorizationAllowed = false;
    await expect(runtime.verifyReplayAuthorization(tenantA, input)).resolves.toBeNull();
    expect({ replayAuthorizationCalls, authorizationCalls }).toEqual({ replayAuthorizationCalls: 1, authorizationCalls: 0 });

    replayAuthorizationAllowed = true;
    const otherRuntime = new PostgresJobRuntime(transactions, registry, replayAuthorization);
    const wrongOwnerCapability = await requiredReplayCapability(otherRuntime, input);
    await expect(runtime.replay(wrongOwnerCapability)).rejects.toThrow("capability");
    authorizationAllowed = false;
    await expect(otherRuntime.replay(wrongOwnerCapability)).resolves.toBe("authorization_rejected");
    expect(authorizationCalls).toBe(1);
    await transactions.withTenant(tenantA, async (transaction) => {
      const events = await transaction.query<{ count: string }>("SELECT count(*)::text AS count FROM job_runtime_replay_events");
      expect(events.rows[0]?.count).toBe("0");
    });
  });

  it("rolls back a fault after partition release and prevents terminal handler re-execution", async () => {
    const releaseOperations = [
      (faultRuntime: PostgresJobRuntime, handle: Awaited<ReturnType<typeof requiredClaim>>) =>
        faultRuntime.retry(handle, "transient_database"),
      (faultRuntime: PostgresJobRuntime, handle: Awaited<ReturnType<typeof requiredClaim>>) =>
        faultRuntime.quarantine(handle, "payload_schema_invalid"),
      (faultRuntime: PostgresJobRuntime, handle: Awaited<ReturnType<typeof requiredClaim>>) =>
        faultRuntime.executeDecodedDatabaseJob(handle, definition, { entityId: "asset-1.test", operation: "touch" }),
    ];
    for (const operation of releaseOperations) {
      await reset();
      await runtime.enqueue(tenantA, createInput(tenantA));
      const handle = await requiredClaim();
      await expectFaultRollback("after_release_partition", (faultRuntime) => operation(faultRuntime, handle), 1);
      expect((await snapshotJob(tenantA)).state).toBe("leased");
      await transactions.withTenant(tenantA, async (transaction) => {
        const partition = await transaction.query<{ state: string }>("SELECT state FROM job_runtime_partition_leases");
        expect(partition.rows[0]?.state).toBe("held");
      });
    }

    await reset(); authorizationCalls = 0; handlerCalls = 0;
    await runtime.enqueue(tenantA, createInput(tenantA));
    const terminalHandle = await requiredClaim();
    await expect(runtime.executeDecodedDatabaseJob(
      terminalHandle, definition, { entityId: "asset-1.test", operation: "touch" },
    )).resolves.toBe("completed");
    await expect(runtime.executeDecodedDatabaseJob(
      terminalHandle, definition, { entityId: "asset-1.test", operation: "touch" },
    )).rejects.toThrow("already consumed");
    await expect(runtime.claim(tenantA, "worker-after-terminal")).resolves.toBeNull();
    expect({ authorizationCalls, handlerCalls }).toEqual({ authorizationCalls: 1, handlerCalls: 1 });
    expect((await snapshotJob(tenantA)).state).toBe("completed");
  });

  it("rolls back injected failures after every enqueue, claim, retry, completion, quarantine, and replay write boundary", async () => {
    await expectFaultRollback("after_enqueue_insert", async (faultRuntime) => faultRuntime.enqueue(tenantA, createInput(tenantA)), 0);
    await runtime.enqueue(tenantA, createInput(tenantA));
    await expectFaultRollback("after_idempotency_conflict", async (faultRuntime) => faultRuntime.enqueue(tenantA, createInput(tenantA, { operation: "changed" })), 1);
    for (const point of ["after_claim_job", "after_claim_partition", "after_claim_attempt"] as const) {
      await reset(); await runtime.enqueue(tenantA, createInput(tenantA));
      await expectFaultRollback(point, async (faultRuntime) => faultRuntime.claim(tenantA, "worker-fault"), 1);
      expect((await snapshotJob(tenantA)).state).toBe("available");
    }
    for (const point of ["after_retry_attempt", "after_retry_job"] as const) {
      await reset(); await runtime.enqueue(tenantA, createInput(tenantA)); const handle = await requiredClaim();
      await expectFaultRollback(point, (faultRuntime) => faultRuntime.retry(handle, "transient_database"), 1);
      expect((await snapshotJob(tenantA)).state).toBe("leased");
    }
    for (const point of ["after_completion_attempt", "after_completion_job"] as const) {
      await reset(); await runtime.enqueue(tenantA, createInput(tenantA)); const handle = await requiredClaim();
      await expectFaultRollback(point, (faultRuntime) => faultRuntime.executeDecodedDatabaseJob(handle, definition, { entityId: "asset-1.test", operation: "touch" }), 1);
      expect((await snapshotJob(tenantA)).state).toBe("leased");
    }
    for (const point of ["after_quarantine_attempt", "after_quarantine_job", "after_quarantine_event"] as const) {
      await reset(); await runtime.enqueue(tenantA, createInput(tenantA)); const handle = await requiredClaim();
      await expectFaultRollback(point, (faultRuntime) => faultRuntime.quarantine(handle, "payload_schema_invalid"), 1);
      expect((await snapshotJob(tenantA)).state).toBe("leased");
    }
    for (const point of ["after_replay_job", "after_replay_event"] as const) {
      await reset(); await runtime.enqueue(tenantA, createInput(tenantA)); const handle = await requiredClaim();
      await runtime.quarantine(handle, "payload_schema_invalid");
      const replay = await replayInput();
      await expectFaultRollback(point, async (faultRuntime) => {
        const capability = await requiredReplayCapability(faultRuntime, replay);
        return faultRuntime.replay(capability);
      }, 1);
      expect((await snapshotJob(tenantA)).state).toBe("quarantined");
    }
  });

  it("uses persisted retry policy, unique attempts, database time, and max-attempt quarantine", async () => {
    const enqueued = await runtime.enqueue(tenantA, createInput(tenantA));
    if (!("job" in enqueued)) throw new Error("enqueue failed");
    let handle = await requiredClaim();
    expect(await runtime.retry(handle, "transient_database")).toBe("retry_scheduled");
    await transactions.withTenant(tenantA, async (transaction) => {
      await transaction.query("UPDATE job_runtime_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [enqueued.job.jobId]);
    });
    handle = await requiredClaim();
    expect((await snapshotJob(tenantA)).attempt_count).toBe(2);
    expect(await runtime.retry(handle, "transient_database")).toBe("retry_scheduled");
    await transactions.withTenant(tenantA, async (transaction) => {
      await transaction.query("UPDATE job_runtime_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [enqueued.job.jobId]);
    });
    handle = await requiredClaim();
    expect(await runtime.retry(handle, "transient_database")).toBe("quarantined");
    const state = await snapshotJob(tenantA); expect(state.state).toBe("quarantined"); expect(state.attempt_count).toBe(3);
    await reset(); authorizationAllowed = false; authorizationCalls = 0;
    await runtime.enqueue(tenantA, createInput(tenantA));
    const drifted = await requiredClaim();
    expect(await runtime.retry(drifted, "transient_database")).toBe("quarantined");
    expect(authorizationCalls).toBe(1);
    expect((await snapshotJob(tenantA)).state).toBe("quarantined");
  });

  it("manual replay has one CAS winner and preserves frozen bytes, digests, idempotency, tenant, and authorization", async () => {
    await runtime.enqueue(tenantA, createInput(tenantA)); const handle = await requiredClaim();
    await runtime.quarantine(handle, "payload_schema_invalid");
    const before = await snapshotJob(tenantA);
    const input = await replayInput();
    const firstCapability = await requiredReplayCapability(runtime, input);
    const secondCapability = await requiredReplayCapability(runtime, input);
    const [first, second] = await Promise.all([
      runtime.replay(firstCapability),
      runtime.replay(secondCapability),
    ]);
    expect([first, second].sort()).toEqual(["conflict", "requeued"]);
    expect(replayAuthorizationCalls).toBe(2);
    expect(authorizationCalls).toBe(1);
    const after = await snapshotJob(tenantA);
    for (const key of ["account_id", "workspace_id", "canonical_payload", "payload_digest", "request_digest", "idempotency_key", "authorization_digest"] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.state).toBe("available");
  });

  it("clears tenant selectors after pooled commit and rollback and rejects malformed scope before acquisition", async () => {
    const reuse = new TenantTransactionRunner(reusePool);
    await reuse.withTenant(tenantA, async () => undefined);
    await expect(reuse.withTenant(tenantB, async () => { throw new Error("rollback-probe"); })).rejects.toThrow("rollback-probe");
    const residue = await reusePool.query<{ account_id: string | null; workspace_id: string | null }>(
      `SELECT nullif(current_setting('gooddealer.account_id',true),'') AS account_id,
              nullif(current_setting('gooddealer.workspace_id',true),'') AS workspace_id`,
    );
    expect(residue.rows[0]).toEqual({ account_id: null, workspace_id: null });
    let acquired = false;
    const guarded = new TenantTransactionRunner({ async connect() { acquired = true; throw new Error("must not acquire"); } } as never);
    await expect(guarded.withTenant({ ...tenantA, extra: true }, async () => undefined)).rejects.toThrow("unresolved");
    expect(acquired).toBe(false);
  });

  it("leaves one observed replay audit after concurrent CAS and byte-preserving requeue", async () => {
    await runtime.enqueue(tenantA, createInput(tenantA));
    await runtime.quarantine(await requiredClaim(), "payload_schema_invalid");
    const before = await snapshotJob(tenantA);
    const input = await replayInput();
    const capabilities = await Promise.all([
      requiredReplayCapability(runtime, input),
      requiredReplayCapability(runtime, input),
    ]);
    const outcomes = await Promise.all(capabilities.map((capability) => runtime.replay(capability)));
    expect(outcomes.sort()).toEqual(["conflict", "requeued"]);
    const after = await snapshotJob(tenantA);
    for (const key of ["account_id", "workspace_id", "canonical_payload", "payload_digest", "request_digest", "idempotency_key", "authorization_digest"] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    await transactions.withTenant(tenantA, async (transaction) => {
      const audit = await transaction.query<{
        outcome: string; replay_authorization_kind: string; replay_generation: string;
        digest_bytes: number; ordered: boolean;
      }>(`SELECT outcome,replay_authorization_kind,replay_generation,
             octet_length(replay_authorization_digest) AS digest_bytes,
             requested_at<=decided_at AS ordered
           FROM job_runtime_replay_events`);
      expect(audit.rows).toEqual([{
        outcome: "requeued", replay_authorization_kind: "admin_action",
        replay_generation: "1", digest_bytes: 32, ordered: true,
      }]);
    });
  });
});

function createInput(tenant: typeof tenantA | typeof tenantB, payloadPatch: Partial<{ entityId: string; operation: string }> = {}, idempotencyKey = "request-1") {
  const payload = { entityId: "asset-1.test", operation: "touch", ...payloadPatch };
  return {
    schemaVersion: 1, tenant, idempotencyKey, jobKind: definition.jobKind,
    targetModule: definition.targetModule, payloadVersion: definition.payloadVersion,
    partitionKey: payload.entityId, trigger: { kind: "authenticated_public", ref: "trigger-1" },
    authorization: { kind: "public_session", ref: "authorization-1", revision: 1, digest: "a".repeat(64) },
    runtimePolicy: policy, payload,
  };
}
async function requiredClaim() { const handle = await runtime.claim(tenantA, "worker-a"); if (handle === null) throw new Error("claim failed"); return handle; }
async function reset() { await ownerPool.query("TRUNCATE job_runtime_replay_events, job_runtime_quarantine_events, job_runtime_attempts, job_runtime_partition_leases, job_runtime_jobs"); }
async function snapshotJob(tenant: typeof tenantA | typeof tenantB, jobId?: string) {
  return transactions.withTenant(tenant, async (transaction) => {
    const result = await transaction.query<Record<string, unknown>>(
      `SELECT account_id,workspace_id,state,attempt_count,idempotency_key,
        job_id,lease_epoch,
        encode(canonical_payload,'hex') AS canonical_payload,encode(payload_digest,'hex') AS payload_digest,
        encode(request_digest,'hex') AS request_digest,encode(authorization_digest,'hex') AS authorization_digest
       FROM job_runtime_jobs
       WHERE ($1::text IS NULL OR job_id = $1)
       ORDER BY job_id LIMIT 1`,
      [jobId ?? null],
    );
    if (result.rows[0] === undefined) throw new Error("job missing"); return result.rows[0];
  });
}
async function replayInput() {
  return transactions.withTenant(tenantA, async (transaction) => {
    const row = (await transaction.query<{ job_id: string; quarantine_id: string; quarantine_revision: string }>(
      "SELECT job_id,quarantine_id,quarantine_revision FROM job_runtime_quarantine_events ORDER BY captured_at DESC LIMIT 1",
    )).rows[0];
    if (row === undefined) throw new Error("quarantine missing");
    return { jobId: row.job_id, quarantineId: row.quarantine_id, expectedQuarantineRevision: Number(row.quarantine_revision),
      expectedReplayGeneration: 0, authorization: { kind: "admin_action" as const, ref: "admin-action-1", revision: 1, digest: "b".repeat(64) } };
  });
}
async function requiredReplayCapability(
  targetRuntime: PostgresJobRuntime,
  input: Awaited<ReturnType<typeof replayInput>>,
) {
  const capability = await targetRuntime.verifyReplayAuthorization(tenantA, input);
  if (capability === null) throw new Error("replay authorization was not verified");
  return capability;
}
async function expectFaultRollback(point: JobRuntimeFaultPoint, operation: (faultRuntime: PostgresJobRuntime) => Promise<unknown>, expectedJobs: number) {
  const faultRuntime = new PostgresJobRuntime(transactions, registry, replayAuthorization,
    (observed) => { if (observed === point) throw new Error(`fault:${point}`); });
  await expect(operation(faultRuntime)).rejects.toThrow(`fault:${point}`);
  const count = await transactions.withTenant(tenantA, async (transaction) =>
    transaction.query<{ count: string }>("SELECT count(*)::text AS count FROM job_runtime_jobs"));
  expect(Number(count.rows[0]?.count)).toBe(expectedJobs);
}
function requiredEnvironment(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required; PostgreSQL integration evidence never skips`); return value; }
