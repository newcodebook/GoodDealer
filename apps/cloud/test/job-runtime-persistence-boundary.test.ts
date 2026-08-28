import { describe, expect, it } from "vitest";

import { encodePersistentJobPayloadDigestInput } from "@gooddealer/protocol/jobs";

import { TenantTransactionRunner } from "../src/db/index";
import {
  JobKindRegistry,
  PostgresJobRuntime,
  productionJobKindDefinitions,
  type JobKindDefinition,
} from "../src/modules/job-runtime/index";

const policy = {
  id: "fixture-db-policy", version: 1, maxAttempts: 3, attemptTimeoutSeconds: 60,
  leaseSeconds: 15, baseBackoffSeconds: 2, retryMode: "database_safe",
} as const;
const definition: JobKindDefinition<{ entityId: string; operation: string }> = {
  jobKind: "fixture_database_job", targetModule: "fixture-target", payloadVersion: 1,
  runtimePolicy: policy,
  decodePayload(value) {
    if (typeof value !== "object" || value === null || Object.keys(value).join(",") !== "entityId,operation") {
      throw new TypeError("fixture payload invalid");
    }
    const record = value as Record<string, unknown>;
    if (typeof record.entityId !== "string" || typeof record.operation !== "string") throw new TypeError("fixture payload invalid");
    return { entityId: record.entityId, operation: record.operation };
  },
  decodeCanonicalPayload() { throw new Error("not composed in boundary tests"); },
  encodeCanonicalPayload(value) { return encodePersistentJobPayloadDigestInput(value); },
  derivePartitionKey(value) { return value.entityId; },
  authorization: { async revalidate() { return false; } },
  handler: { async handle() { throw new Error("fixture handler is not composed"); } },
};

describe("persistent job-runtime closed boundary", () => {
  it("keeps the production definition registry exactly empty", () => {
    expect(productionJobKindDefinitions).toEqual([]);
    expect(new JobKindRegistry(productionJobKindDefinitions).size).toBe(0);
  });

  it("rejects duplicate exact job kind keys", () => {
    expect(() => new JobKindRegistry([definition, definition])).toThrow("duplicate");
    expect(new JobKindRegistry([{ ...definition, payloadVersion: 2 }, definition]).size).toBe(2);
  });

  it("rejects caller-owned lease state before acquiring a database resource", async () => {
    let acquired = false;
    let replayVerificationCalls = 0;
    const runtime = new PostgresJobRuntime(new TenantTransactionRunner({
      async connect() { acquired = true; throw new Error("must not acquire"); },
    } as never), new JobKindRegistry([definition]), {
      async verify() { replayVerificationCalls += 1; return true; },
    });
    await expect(runtime.enqueue({ accountId: "account-a", workspaceId: "workspace-a" }, {
      schemaVersion: 1,
      tenant: { accountId: "account-a", workspaceId: "workspace-a" },
      idempotencyKey: "request-1", jobKind: definition.jobKind, targetModule: definition.targetModule,
      payloadVersion: 1, partitionKey: "asset-1.test",
      trigger: { kind: "authenticated_public", ref: "trigger-1" },
      authorization: { kind: "public_session", ref: "auth-1", revision: 1, digest: "a".repeat(64) },
      runtimePolicy: policy, payload: { entityId: "asset-1.test", operation: "touch" },
      leaseEpoch: 1,
    })).rejects.toThrow();
    expect(acquired).toBe(false);

    let getterCalls = 0;
    const replay = {
      jobId: "job-1", quarantineId: "quarantine-1", expectedQuarantineRevision: 1,
      expectedReplayGeneration: 0,
      authorization: { kind: "admin_action", ref: "admin-action-1", revision: 1, digest: "b".repeat(64) },
      get payload() { getterCalls += 1; return { replacement: true }; },
    };
    await expect(runtime.verifyReplayAuthorization(
      { accountId: "account-a", workspaceId: "workspace-a" }, replay as never,
    )).rejects.toThrow("fields");
    expect(getterCalls).toBe(0);
    expect(acquired).toBe(false);
    expect(replayVerificationCalls).toBe(0);

    const validReplay = {
      jobId: "job-1", quarantineId: "quarantine-1", expectedQuarantineRevision: 1,
      expectedReplayGeneration: 0,
      authorization: { kind: "admin_action", ref: "admin-action-1", revision: 1, digest: "b".repeat(64) },
    } as const;
    const hidden = { ...validReplay };
    Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
    const symbol = { ...validReplay, [Symbol("hidden")]: true };
    const customPrototype = Object.assign(Object.create({ inherited: true }), validReplay);
    const nestedAccessor = { ...validReplay, authorization: { ...validReplay.authorization } } as Record<string, unknown>;
    Object.defineProperty(nestedAccessor.authorization as object, "extra", {
      enumerable: true,
      get() { getterCalls += 1; return true; },
    });
    for (const mutation of [hidden, symbol, customPrototype, nestedAccessor]) {
      await expect(runtime.verifyReplayAuthorization(
        { accountId: "account-a", workspaceId: "workspace-a" }, mutation as never,
      )).rejects.toThrow();
    }
    expect(getterCalls).toBe(0);
    expect(acquired).toBe(false);
    expect(replayVerificationCalls).toBe(0);

    await expect(runtime.replay(replay as never)).rejects.toThrow("capability");
    expect(runtime.replay.length).toBe(1);
    expect(acquired).toBe(false);
  });
});
