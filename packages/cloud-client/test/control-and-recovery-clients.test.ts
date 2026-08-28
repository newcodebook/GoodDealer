import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  AccountActivationClient,
  CLOUD_OPERATION_IDS,
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
  DomainAssetReplicaRecoveryClient,
  type CloudOperationId,
  type CloudTransport,
} from "../src/index";

const portfolioResponse = {
  schemaVersion: 1,
  assets: [],
  projection: {
    materializedThroughServerRevision: 7,
    materializedAt: "2026-08-20T06:00:00Z",
    projectionAvailability: "available",
    projectionEvidenceStatus: "confirmed",
  },
} as const;

describe("Cloud control-plane and sync-recovery clients", () => {
  it("exposes no normal Cloud business query or Provider-observation operation", () => {
    expect(CLOUD_OPERATION_IDS).toEqual([
      "account.activation.activate",
      "sync.domain_asset_replica.recover",
    ]);
    expectTypeOf<CloudOperationId>().toEqualTypeOf<
      "account.activation.activate" | "sync.domain_asset_replica.recover"
    >();
    expect(JSON.stringify(CLOUD_OPERATION_IDS)).not.toMatch(/cloudflare|portfolio\.read|observation/iu);
  });

  it("constructs exact tenant-neutral control and recovery payloads", async () => {
    const calls: Array<{ operationId: CloudOperationId; payload: unknown }> = [];
    const responses: Record<CloudOperationId, unknown> = {
      [ACCOUNT_ACTIVATION_OPERATION_ID]: { schemaVersion: 1, state: "active" },
      [DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID]: portfolioResponse,
    };
    const transport: CloudTransport = {
      async send(operationId, payload) {
        calls.push({ operationId, payload });
        return responses[operationId];
      },
    };

    await new AccountActivationClient(transport).activate();
    await new DomainAssetReplicaRecoveryClient(transport).read();

    expect(calls).toEqual([
      { operationId: ACCOUNT_ACTIVATION_OPERATION_ID, payload: { schemaVersion: 1 } },
      { operationId: DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID, payload: {} },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(
      /accountId|workspaceId|token|credential|connectionId|providerAccountId|url|headers|method/iu,
    );
  });

  it("fails closed on malformed control or recovery responses", async () => {
    await expect(
      new AccountActivationClient({
        async send() {
          return { schemaVersion: 1, state: "active", accountId: "a" };
        },
      }).activate(),
    ).rejects.toThrow();
    await expect(
      new DomainAssetReplicaRecoveryClient({
        async send() {
          return { ...portfolioResponse, workspaceId: "w" };
        },
      }).read(),
    ).rejects.toThrow();
  });
});
