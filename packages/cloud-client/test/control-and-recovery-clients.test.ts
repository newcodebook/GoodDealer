import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  AccountActivationClient,
  CLOUD_OPERATION_IDS,
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
  DesktopAuthorizationClient,
  DomainAssetReplicaRecoveryClient,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
  WorkspaceSyncClient,
  type CloudOperationId,
  type CloudTransport,
} from "../src/index";

const activeDeviceLease = {
  schemaVersion: 1,
  typ: "gd.active-device-lease.v1",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/active-device-lease",
  kid: "lease-key-1",
  accountId: "account-1",
  deviceId: "device-1",
  accountSecurityEpoch: 1,
  jti: "lease-1",
  issuedAt: "2026-08-29T10:00:00Z",
  expiresAt: "2026-08-30T10:00:00Z",
  payload: {
    leaseEpoch: 1,
    renewAfter: "2026-08-29T10:05:00Z",
    onlineExpiresAt: "2026-08-29T10:15:00Z",
    offlineExecuteUntil: "2026-08-30T10:00:00Z",
  },
  signature: "c2lnbmF0dXJl",
} as const;

const mutation = {
  schemaVersion: 1,
  mutationId: "mutation-1",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset",
  entityId: "example.test",
  baseServerRevision: 0,
  changedFields: [{ fieldPath: "note", value: "local note" }],
  sourceDeviceId: "device-1",
  activeLeaseEpoch: 1,
  deviceMutationSequence: 1,
} as const;

const mutationPage = {
  schemaVersion: 1,
  workspaceId: "workspace-1",
  fromServerRevisionExclusive: 0,
  throughServerRevisionInclusive: 1,
  mutations: [{ ...mutation, workspaceId: "workspace-1", serverRevision: 1 }],
  returnedThroughServerRevision: 1,
  nextCursor: null,
  pageDigest: "A".repeat(43),
} as const;

const checkpoint = {
  schemaVersion: 1,
  checkpointId: "checkpoint-1",
  workspaceId: "workspace-1",
  workspaceSchemaVersion: 1,
  throughServerRevision: 1,
  checkpointDigest: "B".repeat(43),
} as const;

const portfolioResponse = {
  schemaVersion: 1,
  assets: [],
  projection: {
    materializedThroughServerRevision: 1,
    materializedAt: "2026-08-29T10:00:00Z",
    projectionAvailability: "available",
    projectionEvidenceStatus: "confirmed",
  },
} as const;

function responses(): Record<CloudOperationId, unknown> {
  return {
    [ACCOUNT_ACTIVATION_OPERATION_ID]: { schemaVersion: 1, state: "active" },
    [DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID]: {
      schemaVersion: 1,
      workspace: { workspaceId: "workspace-1", kind: "personal_default" },
      activeDeviceLease,
      scopes: ["workspace:mutate", "workspace:read"],
    },
    [WORKSPACE_SYNC_PUSH_OPERATION_ID]: {
      schemaVersion: 1,
      accepted: true,
      acknowledgements: [{
        mutationId: "mutation-1",
        deviceMutationSequence: 1,
        serverRevision: 1,
        duplicate: false,
      }],
      headServerRevision: 1,
    },
    [WORKSPACE_SYNC_PULL_OPERATION_ID]: { schemaVersion: 1, accepted: true, page: mutationPage },
    [WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID]: { schemaVersion: 1, checkpoint },
    [DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID]: portfolioResponse,
  };
}

describe("Cloud control-plane and sync clients", () => {
  it("freezes the first-slice operation surface without normal Cloud queries or Provider operations", () => {
    expect(CLOUD_OPERATION_IDS).toEqual([
      "account.activation.activate",
      "devices.authorizationGrant.issue",
      "workspace.sync.mutations.push",
      "workspace.sync.mutations.pull",
      "workspace.sync.checkpoint.read",
      "workspace.sync.domainAssetReplica.recover",
    ]);
    expectTypeOf<CloudOperationId>().toEqualTypeOf<
      | "account.activation.activate"
      | "devices.authorizationGrant.issue"
      | "workspace.sync.mutations.push"
      | "workspace.sync.mutations.pull"
      | "workspace.sync.checkpoint.read"
      | "workspace.sync.domainAssetReplica.recover"
    >();
    expect(JSON.stringify(CLOUD_OPERATION_IDS)).not.toMatch(/cloudflare|portfolio\.read|observation/iu);
  });

  it("constructs exact tenant-neutral control, sync, checkpoint, and recovery payloads", async () => {
    const calls: Array<{ operationId: CloudOperationId; payload: unknown }> = [];
    const operationResponses = responses();
    const transport: CloudTransport = {
      async send(operationId, payload) {
        calls.push({ operationId, payload });
        return operationResponses[operationId];
      },
    };

    await new AccountActivationClient(transport).activate();
    await new DesktopAuthorizationClient(transport).issue();
    const sync = new WorkspaceSyncClient(transport);
    await sync.push([mutation]);
    await sync.pull({ schemaVersion: 1, afterServerRevision: 0, cursor: null, pageLimit: 64 });
    await sync.readCheckpoint();
    await new DomainAssetReplicaRecoveryClient(transport).read();

    expect(calls).toEqual([
      { operationId: ACCOUNT_ACTIVATION_OPERATION_ID, payload: { schemaVersion: 1 } },
      { operationId: DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID, payload: { schemaVersion: 1 } },
      { operationId: WORKSPACE_SYNC_PUSH_OPERATION_ID, payload: { schemaVersion: 1, mutations: [mutation] } },
      {
        operationId: WORKSPACE_SYNC_PULL_OPERATION_ID,
        payload: { schemaVersion: 1, afterServerRevision: 0, cursor: null, pageLimit: 64 },
      },
      { operationId: WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID, payload: { schemaVersion: 1 } },
      { operationId: DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID, payload: {} },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(
      /accountId|workspaceId|token|credential|connectionId|providerAccountId|url|headers|method/iu,
    );
  });

  it("fails closed on tenant or secret injection into client inputs", async () => {
    const sync = new WorkspaceSyncClient({ async send() { throw new Error("must not send"); } });
    await expect(sync.push([{ ...mutation, workspaceId: "workspace-1" }])).rejects.toThrow();
    await expect(sync.push([{ ...mutation, accessToken: "secret" }])).rejects.toThrow();
    await expect(sync.pull({
      schemaVersion: 1,
      afterServerRevision: 0,
      cursor: null,
      pageLimit: 64,
      workspaceId: "workspace-1",
    })).rejects.toThrow();
  });

  it("fails closed on malformed responses and request/response correlation mismatches", async () => {
    await expect(new DesktopAuthorizationClient({
      async send() {
        return {
          ...responses()[DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID] as object,
          providerAccountId: "provider-account",
        };
      },
    }).issue()).rejects.toThrow();

    await expect(new WorkspaceSyncClient({
      async send() {
        return {
          ...responses()[WORKSPACE_SYNC_PUSH_OPERATION_ID] as object,
          acknowledgements: [{
            mutationId: "different-mutation",
            deviceMutationSequence: 1,
            serverRevision: 1,
            duplicate: false,
          }],
        };
      },
    }).push([mutation])).rejects.toThrow("acknowledgements do not match");

    await expect(new WorkspaceSyncClient({
      async send() {
        return {
          schemaVersion: 1,
          accepted: true,
          page: { ...mutationPage, fromServerRevisionExclusive: 1 },
        };
      },
    }).pull({ schemaVersion: 1, afterServerRevision: 0, cursor: null, pageLimit: 64 }))
      .rejects.toThrow();

    await expect(new DomainAssetReplicaRecoveryClient({
      async send() {
        return { ...portfolioResponse, workspaceId: "workspace-1" };
      },
    }).read()).rejects.toThrow();
  });
});
