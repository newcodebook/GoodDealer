import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodePersistentJobPayloadDigestInput,
  encodePersistentJobRequestDigestInput,
  parsePersistentJobCreateRequest,
} from "../src/jobs/index";

const tenant = { accountId: "account-a", workspaceId: "workspace-a" } as const;
const valid = {
  schemaVersion: 1,
  tenant,
  idempotencyKey: "request-1",
  jobKind: "fixture_database_job",
  targetModule: "fixture-target",
  payloadVersion: 1,
  partitionKey: "asset-1.test",
  trigger: { kind: "authenticated_public", ref: "session-binding-1" },
  authorization: {
    kind: "public_session",
    ref: "authorization-binding-1",
    revision: 3,
    digest: "a".repeat(64),
  },
  runtimePolicy: {
    id: "fixture-db-policy",
    version: 1,
    maxAttempts: 3,
    attemptTimeoutSeconds: 60,
    leaseSeconds: 15,
    baseBackoffSeconds: 2,
    retryMode: "database_safe",
  },
  payload: { entityId: "asset-1.test", operation: "touch" },
} as const;

describe("persistent job create v1", () => {
  it("routes only exact v1 and rejects fields outside the persistence-create contract", () => {
    expect(parsePersistentJobCreateRequest(valid, tenant)).toEqual(valid);
    for (const input of [
      { ...valid, schemaVersion: 999 },
      { ...valid, leaseEpoch: 1 },
      { ...valid, attempt: 1 },
      { ...valid, workerId: "worker-a" },
      { ...valid, enqueuedAt: "2026-08-20T00:00:00Z" },
      { ...valid, availableAt: "2026-08-20T00:00:00Z" },
      { ...valid, quarantine: true },
    ]) expect(() => parsePersistentJobCreateRequest(input, tenant)).toThrow();
  });

  it("rejects tenant substitution, unknown fields, symbols, prototypes, and accessors before evaluation", () => {
    expect(() => parsePersistentJobCreateRequest(valid, { ...tenant, accountId: "account-b" })).toThrow("trusted scope");
    expect(() => parsePersistentJobCreateRequest({ ...valid, extra: true }, tenant)).toThrow();
    const symbolInput = { ...valid, [Symbol("hidden")]: true };
    expect(() => parsePersistentJobCreateRequest(symbolInput, tenant)).toThrow("symbol");
    expect(() => parsePersistentJobCreateRequest(Object.assign(Object.create({ inherited: true }), valid), tenant)).toThrow("prototype");
    let getterCalls = 0;
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, "payload", { enumerable: true, get() { getterCalls += 1; return valid.payload; } });
    expect(() => parsePersistentJobCreateRequest(accessor, tenant)).toThrow("data property");
    expect(getterCalls).toBe(0);
  });

  it("rejects oversized, sparse, non-safe-number, and excessive-depth values", () => {
    expect(() => parsePersistentJobCreateRequest({ ...valid, payload: { value: "x".repeat(70_000) } }, tenant)).toThrow("wire limit");
    const sparse = Array(2); sparse[1] = "value";
    expect(() => parsePersistentJobCreateRequest({ ...valid, payload: sparse }, tenant)).toThrow("array keys");
    expect(() => parsePersistentJobCreateRequest({ ...valid, payload: { number: 1.5 } }, tenant)).toThrow("safe integer");
    let deep: unknown = "end";
    for (let index = 0; index < 34; index += 1) deep = { next: deep };
    expect(() => parsePersistentJobCreateRequest({ ...valid, payload: deep }, tenant)).toThrow("nesting");
  });

  it("rejects every non-canonical array key and descriptor without invoking getters", () => {
    const mutations: unknown[][] = [];
    const enumerableExtra = ["value"] as unknown[] & Record<string, unknown>;
    enumerableExtra.extra = true;
    mutations.push(enumerableExtra);
    const hiddenExtra = ["value"];
    Object.defineProperty(hiddenExtra, "hidden", { value: true, enumerable: false });
    mutations.push(hiddenExtra);
    const symbolExtra = ["value"];
    Object.defineProperty(symbolExtra, Symbol("hidden"), { value: true });
    mutations.push(symbolExtra);
    const customPrototype = ["value"];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
    mutations.push(customPrototype);

    let getterCalls = 0;
    const accessorExtra = ["value"];
    Object.defineProperty(accessorExtra, "extra", {
      enumerable: true,
      get() { getterCalls += 1; return true; },
    });
    mutations.push(accessorExtra);

    for (const payload of mutations) {
      expect(() => parsePersistentJobCreateRequest({ ...valid, payload }, tenant)).toThrow();
      expect(() => encodePersistentJobPayloadDigestInput(payload)).toThrow();
    }
    expect(getterCalls).toBe(0);
  });

  it("has fixed domain-separated payload and request digest vectors", () => {
    const parsed = parsePersistentJobCreateRequest(valid, tenant);
    const payloadBytes = encodePersistentJobPayloadDigestInput(parsed.payload);
    const payloadDigest = createHash("sha256").update(payloadBytes).digest("hex");
    const { payload: _payload, ...request } = parsed;
    const requestDigest = createHash("sha256")
      .update(encodePersistentJobRequestDigestInput({ request, payloadDigest }))
      .digest("hex");
    expect(payloadDigest).toBe("355697e07d36e9207bb5c7957132191bf7c54364b9a92240b49ee1b68cfde5fc");
    expect(requestDigest).toBe("9fbeacb275d2de444207409fb44f6d2ad63cd500f3afed8e31b42f803b68c656");
    const changed = createHash("sha256")
      .update(encodePersistentJobPayloadDigestInput({ ...parsed.payload as object, operation: "changed" }))
      .digest("hex");
    expect(changed).not.toBe(payloadDigest);
  });
});
