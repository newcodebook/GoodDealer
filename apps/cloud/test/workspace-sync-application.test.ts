import { describe, expect, it, vi } from "vitest";

import { PostgresWorkspaceSyncApplication } from "../src/modules/workspace/sync/http-service";

const principal = { accountId: "account-sync", sessionId: "session-sync", clientKind: "desktop" as const };
const scope = { accountId: principal.accountId, workspaceId: "workspace-sync" } as const;
const checkpoint = {
  schemaVersion: 3 as const,
  checkpointId: "checkpoint-sync",
  workspaceId: scope.workspaceId,
  workspaceSchemaVersion: 1,
  throughServerRevision: 4,
  checkpointDigest: "C".repeat(43),
};
const mutation = {
  schemaVersion: 3 as const,
  mutationId: "mutation-sync",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset" as const,
  entityId: "asset.test",
  entityGeneration: 1,
  operationKind: "upsert" as const,
  baseServerRevision: 0,
  changedFields: [{ fieldPath: "note" as const, value: "note" }],
  sourceDeviceId: "device-sync",
  activeLeaseEpoch: 1,
  deviceMutationSequence: 1,
};
const pullRequest = { schemaVersion: 3 as const, afterServerRevision: 0, cursor: null, confirm: null, pageLimit: 256 };

function fixture(pullResults: unknown[], receipts?: { readOwn: ReturnType<typeof vi.fn> }, activeDevice: string | null = "device-sync", role: "active" | "standby" = "active") {
  const ingest = vi.fn(async () => ({ accepted: true as const, assignments: [{
    mutationId: mutation.mutationId, deviceMutationSequence: 1, serverRevision: 1, duplicate: false,
  }], headRevision: 1 }));
  const open = vi.fn(async () => ({ accepted: true as const, cursor: {} as never, presentation: {} as never }));
  const pullV2 = vi.fn(async () => pullResults.shift() as never);
  const readLatestAvailable = vi.fn(async () => checkpoint);
  const application = new PostgresWorkspaceSyncApplication({
    authority: { resolveSessionDevice: vi.fn(async () => activeDevice === null ? null : ({ deviceId: activeDevice, role })), resolveActiveDevice: vi.fn(async () => activeDevice) },
    workspaces: { resolve: vi.fn(async () => scope) },
    mutations: { ingest },
    readers: { open, pullV2 },
    checkpoints: { readLatestAvailable },
    ...(receipts === undefined ? {} : { receipts: receipts as never }),
  });
  return { application, ingest, open, pullV2, readLatestAvailable };
}

describe("workspace sync authenticated application", () => {
  it("allows Standby checkpoint and pull while rejecting push and own receipts", async () => {
    const readOwn = vi.fn(async () => []);
    const subject = fixture([{ accepted: false, code: "READER_CURSOR_RETIRED" }], { readOwn }, "device-sync", "standby");
    await expect(subject.application.checkpoint({ schemaVersion: 3 }, principal)).resolves.toEqual({ schemaVersion: 3, checkpoint });
    await expect(subject.application.pull(pullRequest, principal)).resolves.toMatchObject({ code: "SYNC_REBOOTSTRAP_REQUIRED" });
    expect(subject.pullV2).toHaveBeenCalled();
    await expect(subject.application.push({ schemaVersion: 3, mutations: [mutation] }, principal)).resolves.toMatchObject({ code: "SYNC_AUTHORIZATION_REJECTED" });
    await expect(subject.application.receipts({ schemaVersion: 1, mutationIds: [mutation.mutationId] }, principal)).resolves.toBeNull();
    expect(subject.ingest).not.toHaveBeenCalled();
    expect(readOwn).not.toHaveBeenCalled();
  });

  it("rejects a mutation provenance device that differs from the server-derived session device", async () => {
    const subject = fixture([]);
    const result = await subject.application.push({ schemaVersion: 3, mutations: [{
      ...mutation, sourceDeviceId: "other-device",
    }] }, principal);
    expect(result).toMatchObject({ accepted: false, code: "SYNC_AUTHORIZATION_REJECTED" });
    expect(subject.ingest).not.toHaveBeenCalled();
  });

  it("opens a first reader only from a token-free local revision and then returns its durable page", async () => {
    const accepted = {
      accepted: true as const,
      page: { schemaVersion: 3, workspaceId: scope.workspaceId, fromServerRevisionExclusive: 0,
        throughServerRevisionInclusive: 0, mutations: [], returnedThroughServerRevision: 0,
        nextCursor: null, pageDigest: "A".repeat(43) },
      confirmedThrough: 0,
      pendingDelivery: { generation: 1, fromServerRevisionExclusive: 0, throughServerRevisionInclusive: 0,
        targetServerRevision: 0, pageDigest: "A".repeat(43), nextCursorDigest: null,
        predecessorConfirmationDigest: null, expiresAt: "2026-09-14T01:00:00Z" },
      confirmToken: "B".repeat(43),
    };
    const subject = fixture([{ accepted: false, code: "READER_CURSOR_UNKNOWN" }, accepted]);
    await expect(subject.application.pull(pullRequest, principal)).resolves.toMatchObject({ accepted: true });
    expect(subject.open).toHaveBeenCalledWith(scope, { deviceId: "device-sync", atRevision: 0 });

    const poisoned = fixture([{ accepted: false, code: "READER_CURSOR_UNKNOWN" }]);
    await expect(poisoned.application.pull({ ...pullRequest, cursor: "A".repeat(43) }, principal))
      .resolves.toMatchObject({ accepted: false, code: "SYNC_CURSOR_CONFLICT" });
    expect(poisoned.open).not.toHaveBeenCalled();
  });

  it("keeps retired compacted readers in rebootstrap-required state and includes the latest checkpoint", async () => {
    const subject = fixture([{ accepted: false, code: "READER_CURSOR_RETIRED" }]);
    await expect(subject.application.pull(pullRequest, principal)).resolves.toMatchObject({
      accepted: false,
      code: "SYNC_REBOOTSTRAP_REQUIRED",
      checkpoint,
    });
    expect(subject.readLatestAvailable).toHaveBeenCalledWith(scope);
  });
});

describe("workspace sync own-receipt lookup (ADR-0032 receipt verification)", () => {
  const receipt = {
    mutationId: "mutation-sync", activeLeaseEpoch: 1, deviceMutationSequence: 1,
    wireSchemaVersion: 2, wireMutationDigest: "D".repeat(43), outcome: "accepted",
  } as const;
  const request = { schemaVersion: 1, mutationIds: ["mutation-sync", "mutation-other"] } as const;

  it("reads only the session's active device, never a device the caller names", async () => {
    const readOwn = vi.fn(async () => [receipt]);
    const subject = fixture([], { readOwn });
    await expect(subject.application.receipts(request, principal)).resolves.toEqual({ schemaVersion: 1, receipts: [receipt] });
    expect(readOwn).toHaveBeenCalledWith(scope, "device-sync", ["mutation-sync", "mutation-other"]);
    // A caller-supplied device is unknown wire, rejected before any read.
    await expect(subject.application.receipts({ ...request, sourceDeviceId: "other-device" }, principal)).rejects.toThrow();
    expect(readOwn).toHaveBeenCalledTimes(1);
  });

  it("returns nothing for a non-Desktop client, no active device, or no composed reader", async () => {
    const readOwn = vi.fn(async () => [receipt]);
    await expect(fixture([], { readOwn }).application.receipts(request, { ...principal, clientKind: "web" as never })).resolves.toBeNull();
    await expect(fixture([], { readOwn }, null).application.receipts(request, principal)).resolves.toBeNull();
    await expect(fixture([]).application.receipts(request, principal)).resolves.toBeNull();
    expect(readOwn).not.toHaveBeenCalled();
  });

  it("fails closed on a hostile request or a reader result outside the response contract", async () => {
    const readOwn = vi.fn(async () => [receipt]);
    const subject = fixture([], { readOwn });
    for (const hostile of [
      { schemaVersion: 1, mutationIds: [] },
      { schemaVersion: 1, mutationIds: ["a", "a"] },
      { schemaVersion: 2, mutationIds: ["a"] },
      { schemaVersion: 1, mutationIds: Array.from({ length: 257 }, (_, index) => `m-${index}`) },
    ]) {
      await expect(subject.application.receipts(hostile, principal)).rejects.toThrow();
    }
    expect(readOwn).not.toHaveBeenCalled();
    for (const bad of [[{ ...receipt, wireSchemaVersion: 1 }], [receipt, receipt], [{ ...receipt, sourceDeviceId: "device-sync" }]]) {
      await expect(fixture([], { readOwn: vi.fn(async () => bad) }).application.receipts(request, principal)).rejects.toThrow();
    }
  });
});

describe("workspace sync push rejection mapping", () => {
  const cases = [
    ["MUTATION_FIELD_STALE", "SYNC_MUTATION_CONFLICT"],
    ["MUTATION_ENTITY_UNKNOWN", "SYNC_MUTATION_CONFLICT"],
    ["MUTATION_ID_CONFLICT", "SYNC_IDEMPOTENCY_CONFLICT"],
    ["MUTATION_SEQUENCE_CONFLICT", "SYNC_IDEMPOTENCY_CONFLICT"],
    ["MUTATION_MALFORMED", "SYNC_INPUT_REJECTED"],
    ["MUTATION_BATCH_UNORDERED", "SYNC_INPUT_REJECTED"],
    ["MUTATION_SCHEMA_VERSION_UNSUPPORTED", "SYNC_SCHEMA_UNSUPPORTED"],
    ["MUTATION_DEVICE_NOT_ACTIVE", "SYNC_AUTHORIZATION_REJECTED"],
    ["MUTATION_EPOCH_STALE", "SYNC_AUTHORIZATION_REJECTED"],
    ["WORKSPACE_TENANT_UNRESOLVED", "SYNC_TENANT_UNRESOLVED"],
    // Only conditions a later identical push can outlive stay retryable.
    ["MUTATION_DRAIN_SEALED", "SYNC_STORAGE_REJECTED"],
    ["MUTATION_BASE_REVISION_AHEAD", "SYNC_STORAGE_REJECTED"],
    ["MUTATION_WORKSPACE_MISMATCH", "SYNC_STORAGE_REJECTED"],
  ] as const;

  it.each(cases)("maps ingest %s to push %s", async (ingestCode, pushCode) => {
    const subject = fixture([]);
    subject.ingest.mockResolvedValueOnce({ accepted: false, code: ingestCode, failures: [] } as never);
    const result = await subject.application.push({ schemaVersion: 3, mutations: [mutation] }, principal);
    expect(result).toMatchObject({ accepted: false, code: pushCode });
  });
});
