import { describe, expect, it, vi } from "vitest";

import { submittedSyncMutationSchema } from "@gooddealer/protocol/workspace";

import type { TenantTransaction } from "../src/db/index";
import { PostgresWorkspaceRevisionRepository } from "../src/modules/workspace/revisions/index";
import { PostgresPortfolioRepository } from "../src/modules/workspace/state/portfolio/postgres-repository";

const scope = { accountId: "account-a", workspaceId: "workspace-a" } as const;

describe("workspace sync transaction-aware owner ports", () => {
  it("locks revision authority and advances compaction only by CAS", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        workspace_schema_version: "1",
        server_revision: "9",
        compacted_through_server_revision: "3",
        last_replication_activity_at: null,
        last_successful_provider_observation_at: null,
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const transaction = { scope, query } as unknown as TenantTransaction;
    const revisions = new PostgresWorkspaceRevisionRepository();

    await expect(revisions.lock(transaction)).resolves.toMatchObject({
      serverRevision: 9,
      compactedThroughServerRevision: 3,
    });
    expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE");
    await expect(revisions.compareAndAdvanceCompactionWatermark(transaction, 3, 7)).resolves.toBeUndefined();
    expect(query.mock.calls[1]?.[0]).toContain("workspace_compaction_advance");
    expect(query.mock.calls[1]?.[1]).toEqual([3, 7]);
    await expect(revisions.compareAndAdvanceCompactionWatermark(transaction, 7, 6))
      .rejects.toThrow("cannot regress");
  });

  it("locks domain assets in C order and reparses every stored value", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      entity_id: "b.test",
      note: null,
      portfolio_id: null,
      tags: ["alpha"],
      target_price_currency: "USD",
      target_price_amount: "12.5",
      note_server_revision: "0",
      portfolio_id_server_revision: "1",
      tags_server_revision: "2",
      target_price_server_revision: "3",
    }], rowCount: 1 });
    const repository = new PostgresPortfolioRepository();
    const transaction = { scope, query } as unknown as TenantTransaction;

    await expect(repository.lockDomainAssets(transaction, ["b.test", "a.test", "b.test"]))
      .resolves.toEqual([expect.objectContaining({
        entityId: "b.test",
        lastModifiedRevision: { note: 0, portfolioId: 1, tags: 2, targetPrice: 3 },
      })]);
    expect(query.mock.calls[0]?.[1]).toEqual([scope.accountId, scope.workspaceId, ["a.test", "b.test"]]);
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY entity_id COLLATE \"C\" FOR UPDATE");

    query.mockResolvedValueOnce({ rows: [{
      entity_id: "b.test",
      note: null,
      portfolio_id: null,
      tags: ["out-of-order", "alpha"],
      target_price_currency: null,
      target_price_amount: null,
      note_server_revision: "0",
      portfolio_id_server_revision: "0",
      tags_server_revision: "0",
      target_price_server_revision: "0",
    }], rowCount: 1 });
    await expect(repository.lockDomainAssets(transaction, ["b.test"])).rejects.toThrow();
  });

  it("applies only the closed field union and preserves owner transaction scope", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new PostgresPortfolioRepository();
    const transaction = { scope, query } as unknown as TenantTransaction;
    const mutation = submittedSyncMutationSchema.parse({
      schemaVersion: 1,
      mutationId: "mutation-1",
      workspaceId: scope.workspaceId,
      workspaceSchemaVersion: 1,
      entityType: "domain_asset",
      entityId: "asset-1.test",
      baseServerRevision: 0,
      changedFields: [
        { fieldPath: "note", value: "updated" },
        { fieldPath: "targetPrice", value: { currency: "USD", amount: "12.5" } },
      ],
      sourceDeviceId: "device-1",
      activeLeaseEpoch: 1,
      deviceMutationSequence: 1,
    });

    await repository.applyAcceptedMutations(transaction, [{ mutation, serverRevision: 1 }]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("note_server_revision");
    expect(query.mock.calls[1]?.[0]).toContain("target_price_server_revision");
    await expect(repository.applyAcceptedMutations(transaction, [{
      mutation: { ...mutation, workspaceId: "workspace-b" }, serverRevision: 2,
    }])).rejects.toThrow("binding is invalid");
  });
});
