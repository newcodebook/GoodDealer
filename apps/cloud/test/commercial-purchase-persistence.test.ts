import { describe, expect, it, vi } from "vitest";
import { ProviderDispatchExecutor } from "../src/modules/licensing/provider-dispatch-executor";
import { PostgresCommercialAggregateRepository } from "../src/modules/licensing/postgres-commercial-repository";

const work = {
  workId: "work-1", kind: "provider_operation" as const, leaseEpoch: 1,
  leaseExpiresAt: "2026-09-02T00:01:00Z", rawToken: new Uint8Array(32), provider: "stripe" as const,
  purchaseAttemptId: "checkout-1", purchaseKind: "subscription" as const, offer: "monthly" as const,
  providerCatalogItem: "price-monthly", campaignCode: null,
  providerOperationId: "operation-1", operationRevision: 1, operationKind: "subscription_create" as const,
  providerIdempotencyKey: "stable-key", requestDigest: new Uint8Array(32),
  providerResourceKind: null, providerResourceId: null,
};

describe("provider dispatch custody", () => {
  it("normalizes PostgreSQL approval expiry to the public protocol's second precision", async () => {
    const repository = new PostgresCommercialAggregateRepository();
    const query = { query: vi.fn(async () => ({ rows: [{
      raw_handle: Buffer.alloc(32, 7),
      expires_at: new Date("2026-09-03T00:05:00.987Z"),
    }] })) };

    await expect(repository.issueApprovalRedirect(query as never, "checkout-1")).resolves.toEqual({
      handle: Buffer.alloc(32, 7),
      expiresAt: "2026-09-03T00:05:00Z",
    });
  });

  it("normalizes an evidence-free planned PostgreSQL replay to an empty resource set", async () => {
    const repository = new PostgresCommercialAggregateRepository();
    const query = { query: vi.fn(async () => ({ rows: [{
      state: "planned", response_digest: null, resource_kinds: null, resource_ids: null,
      resource_digests: null, resource_roles: null, disposition: "current",
    }] })) };

    await expect(repository.readOperationReplay(query as never, work)).resolves.toEqual({
      state: "planned", responseDigest: null, resources: [], disposition: "current",
    });
  });

  it("consumes the database permit before the mutating SDK call", async () => {
    const order: string[] = [];
    const replay = { state: "planned" as const, responseDigest: null, resources: [], disposition: "current" as const };
    const repository = {
      readOperationReplay: vi.fn(async () => replay),
      issueDispatchPermit: vi.fn(async () => ({ dispatchPermitId: "permit-1", providerOperationId: "operation-1",
        operationRevision: 1, operationKind: "subscription_create" as const, dispatchAttempt: 1,
        expiresAt: "2026-09-02T00:01:00Z" })),
      consumeDispatchPermit: vi.fn(async (_query, _work, permit) => { order.push("permit-consumed");
        return { ...permit, provider: "stripe" as const, providerIdempotencyKey: "stable-key", consumedAt: "2026-09-02T00:00:00Z" }; }),
      recordOperationResult: vi.fn(async (_query, _work, _permit, command) => ({ ...replay,
        state: command.outcome, responseDigest: command.responseDigest, resources: command.resources })),
    };
    const create = vi.fn(async () => { order.push("provider-called"); return { resources: [
      { resourceKind: "checkout_session", resourceId: "cs_1", role: "checkout_origin" as const }], responseEvidence: { id: "cs_1" } }; });
    const gateway = (provider: "stripe" | "paypal") => ({ provider, create,
      cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() });
    const executor = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never,
      [gateway("stripe"), gateway("paypal")] as never);
    await expect(executor.create(work, "checkout-1", definition())).resolves.toMatchObject({ outcome: "confirmed" });
    expect(order).toEqual(["permit-consumed", "provider-called"]);
  });

  it("returns stored terminal truth with zero permit or SDK calls", async () => {
    const repository = { readOperationReplay: vi.fn(async () => ({ state: "confirmed" as const,
      responseDigest: new Uint8Array(32), resources: [], disposition: "current" as const })),
      issueDispatchPermit: vi.fn(), consumeDispatchPermit: vi.fn(), recordOperationResult: vi.fn() };
    const create = vi.fn();
    const gateway = (provider: "stripe" | "paypal") => ({ provider, create,
      cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() });
    const executor = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never,
      [gateway("stripe"), gateway("paypal")] as never);
    await expect(executor.create(work, "checkout-1", definition())).resolves.toMatchObject({ outcome: "confirmed" });
    expect(repository.issueDispatchPermit).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

function definition() { return { provider: "stripe" as const, offer: "monthly" as const, campaignCode: null,
  providerItemId: "price-monthly", providerDiscountId: null, currency: "USD" as const, amountMinor: 980,
  purchaseKind: "subscription" as const }; }
