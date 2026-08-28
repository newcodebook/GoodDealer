import { describe, expect, it, vi } from "vitest";

import {
  DomainAssetReplicaRecoveryError,
  DomainAssetReplicaRecoveryService,
} from "../src/modules/workspace/read/index";
import type { PortfolioProjectionQueryPort } from "../src/modules/workspace/state/portfolio/index";

const scope = { accountId: "account-01", workspaceId: "workspace-01" } as const;
const emptyProjection = {
  schemaVersion: 1,
  assets: [],
  projection: {
    materializedThroughServerRevision: 4,
    materializedAt: null,
    projectionAvailability: "unavailable",
    projectionEvidenceStatus: "unknown",
  },
} as const;

function reader(result: unknown): PortfolioProjectionQueryPort {
  return { readPortfolio: vi.fn(async () => result) };
}

describe("DomainAssetReplicaRecoveryService", () => {
  it("accepts only the tenant-neutral request and returns the full strict projection without a tenant echo", async () => {
    const projection = reader(emptyProjection);
    const service = new DomainAssetReplicaRecoveryService(projection);

    const result = await service.read(scope, {});

    expect(result).toEqual(emptyProjection);
    expect(result).not.toHaveProperty("accountId");
    expect(result).not.toHaveProperty("workspaceId");
    expect(projection.readPortfolio).toHaveBeenCalledTimes(1);
    expect(projection.readPortfolio).toHaveBeenCalledWith(scope);
  });

  it.each([
    { workspaceId: "workspace-02" },
    { accountId: "account-02" },
    { schemaVersion: 1 },
    { credentialRef: "not-a-secret-value" },
  ])("rejects caller scope or field injection before reading state: %o", async (request) => {
    const projection = reader(emptyProjection);

    await expect(new DomainAssetReplicaRecoveryService(projection).read(scope, request)).rejects.toThrow();
    expect(projection.readPortfolio).not.toHaveBeenCalled();
  });

  it("rejects an unresolved or non-strict trusted tenant scope before parsing or reading", async () => {
    for (const invalidScope of [
      { accountId: "", workspaceId: "workspace-01" },
      { accountId: "account-01", workspaceId: "workspace-01", extra: true },
    ]) {
      const projection = reader(emptyProjection);
      await expect(new DomainAssetReplicaRecoveryService(projection).read(invalidScope, {}))
        .rejects.toEqual(new DomainAssetReplicaRecoveryError("WORKSPACE_TENANT_UNRESOLVED"));
      expect(projection.readPortfolio).not.toHaveBeenCalled();
    }
  });

  it.each([
    { ...emptyProjection, workspaceId: "workspace-01" },
    { ...emptyProjection, projection: { ...emptyProjection.projection, source: "provider" } },
    { ...emptyProjection, projection: { ...emptyProjection.projection, materializedThroughServerRevision: Number.MAX_SAFE_INTEGER + 1 } },
    { ...emptyProjection, projection: { ...emptyProjection.projection, projectionAvailability: "available", projectionEvidenceStatus: "confirmed" } },
    { ...emptyProjection, projection: { ...emptyProjection.projection, credentialRef: "not-a-secret-value" } },
    {
      ...emptyProjection,
      assets: [{
        asset: { entityId: "asset-01.test", note: null, portfolioId: null, tags: [], targetPrice: null },
        materialization: {
          origin: "workspace_sync", versionToken: "0", materializedAt: null,
          projectionAvailability: "available", projectionEvidenceStatus: "confirmed",
        },
      }],
    },
    {
      ...emptyProjection,
      assets: ["asset-02.test", "asset-01.test"].map((entityId) => ({
        asset: { entityId, note: null, portfolioId: null, tags: [], targetPrice: null },
        materialization: {
          origin: "workspace_sync", versionToken: "0", materializedAt: null,
          projectionAvailability: "unavailable", projectionEvidenceStatus: "unknown",
        },
      })),
    },
  ])("fails closed when the projection reader returns malformed data: %o", async (result) => {
    await expect(new DomainAssetReplicaRecoveryService(reader(result)).read(scope, {})).rejects.toThrow();
  });
});
