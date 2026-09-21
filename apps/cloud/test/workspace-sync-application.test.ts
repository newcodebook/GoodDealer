import { describe, expect, it, vi } from "vitest";

import { PostgresWorkspaceSyncApplication } from "../src/modules/workspace/sync/http-service";

const principal = { accountId: "account-sync", sessionId: "session-sync", clientKind: "desktop" as const };
const scope = { accountId: principal.accountId, workspaceId: "workspace-sync" } as const;
const checkpoint = {
  schemaVersion: 2 as const,
  checkpointId: "checkpoint-sync",
  workspaceId: scope.workspaceId,
  workspaceSchemaVersion: 1,
  throughServerRevision: 4,
  checkpointDigest: "C".repeat(43),
};
const mutation = {
  schemaVersion: 2 as const,
  mutationId: "mutation-sync",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset" as const,
  entityId: "asset.test",
  operationKind: "upsert" as const,
  baseServerRevision: 0,
  changedFields: [{ fieldPath: "note" as const, value: "note" }],
  sourceDeviceId: "device-sync",
  activeLeaseEpoch: 1,
  deviceMutationSequence: 1,
};
const pullRequest = { schemaVersion: 2 as const, afterServerRevision: 0, cursor: null, confirm: null, pageLimit: 256 };

function fixture(pullResults: unknown[]) {
  const ingest = vi.fn(async () => ({ accepted: true as const, assignments: [{
    mutationId: mutation.mutationId, deviceMutationSequence: 1, serverRevision: 1, duplicate: false,
  }], headRevision: 1 }));
  const open = vi.fn(async () => ({ accepted: true as const, cursor: {} as never, presentation: {} as never }));
  const pullV2 = vi.fn(async () => pullResults.shift() as never);
  const readLatestAvailable = vi.fn(async () => checkpoint);
  const application = new PostgresWorkspaceSyncApplication({
    authority: { resolveActiveDevice: vi.fn(async () => "device-sync") },
    workspaces: { resolve: vi.fn(async () => scope) },
    mutations: { ingest },
    readers: { open, pullV2 },
    checkpoints: { readLatestAvailable },
  });
  return { application, ingest, open, pullV2, readLatestAvailable };
}

describe("workspace sync authenticated application", () => {
  it("rejects a mutation provenance device that differs from the server-derived session device", async () => {
    const subject = fixture([]);
    const result = await subject.application.push({ schemaVersion: 2, mutations: [{
      ...mutation, sourceDeviceId: "other-device",
    }] }, principal);
    expect(result).toMatchObject({ accepted: false, code: "SYNC_AUTHORIZATION_REJECTED" });
    expect(subject.ingest).not.toHaveBeenCalled();
  });

  it("opens a first reader only from a token-free local revision and then returns its durable page", async () => {
    const accepted = {
      accepted: true as const,
      page: { schemaVersion: 2, workspaceId: scope.workspaceId, fromServerRevisionExclusive: 0,
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
