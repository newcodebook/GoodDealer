import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { CommercialCheckoutCatalog } from "../src/modules/licensing/commercial-checkout";
import { commercialCheckoutRequestDigest } from "../src/modules/licensing/commercial-checkout-identity";
import { ProviderDispatchExecutor, ProviderOperationRecoveryService } from "../src/modules/licensing/provider-dispatch-executor";

const work = {
  kind: "provider_operation" as const,
  workId: "work-1",
  leaseEpoch: 2,
  leaseExpiresAt: "2026-09-03T00:01:00Z",
  rawToken: new Uint8Array(32),
  purchaseAttemptId: "attempt-1",
  purchaseKind: "subscription" as const,
  offer: "monthly" as const,
  providerCatalogItem: "P-PAYPAL-MONTHLY",
  campaignCode: null,
  provider: "paypal" as const,
  providerOperationId: "operation-1",
  operationRevision: 4,
  operationKind: "subscription_create" as const,
  providerIdempotencyKey: "stable-key",
  requestDigest: commercialCheckoutRequestDigest({ provider: "paypal", offer: "monthly", campaignCode: null,
    providerItemId: "P-PAYPAL-MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980,
    purchaseKind: "subscription" }),
  providerResourceKind: null,
  providerResourceId: null,
};

describe("targetless provider operation recovery", () => {
  it.each([
    ["amount", { amountMinor: 981 }],
    ["discount", { providerDiscountId: "coupon_changed" }],
  ] as const)("rejects recovered creation work after catalog %s drift before Provider or permit I/O", async (_field, override) => {
    const repository = { readOperationReplay: vi.fn(), issueDispatchPermit: vi.fn(),
      consumeDispatchPermit: vi.fn(), recordOperationResult: vi.fn() };
    const create = vi.fn();
    const paypal = { provider: "paypal" as const, create, cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(),
      recover: vi.fn(), readApprovalUrl: vi.fn() };
    const stripe = { provider: "stripe" as const, create: vi.fn(), cancelSubscription: vi.fn(),
      captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
    const executor = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);
    const changed = new CommercialCheckoutCatalog([{ provider: "paypal", offer: "monthly", campaignCode: null,
      providerItemId: "P-PAYPAL-MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980,
      ...override }]);

    await expect(executor.resume(work, changed)).rejects.toThrow(/conflicts with the commercial catalog/u);
    expect(repository.readOperationReplay).not.toHaveBeenCalled();
    expect(repository.issueDispatchPermit).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["replacement before permit issue", "issue"],
    ["slot change after permit issue", "consume"],
  ] as const)("performs zero Provider mutation when exact-current operation fencing detects %s", async (_name, fence) => {
    const stale = Object.assign(new Error("provider operation is no longer current"), { code: "40001" });
    const permit = { dispatchPermitId: "permit-1", providerOperationId: work.providerOperationId,
      operationRevision: work.operationRevision, operationKind: work.operationKind, dispatchAttempt: 1,
      expiresAt: "2026-09-03T00:01:00Z" };
    const repository = { readOperationReplay: vi.fn(async () => ({ state: "planned" as const,
      responseDigest: digest("planned"), resources: [], disposition: "current" as const })),
      issueDispatchPermit: fence === "issue" ? vi.fn(async () => { throw stale; }) : vi.fn(async () => permit),
      consumeDispatchPermit: fence === "consume" ? vi.fn(async () => { throw stale; }) : vi.fn(),
      recordOperationResult: vi.fn() };
    const create = vi.fn();
    const paypal = { provider: "paypal" as const, create, cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(),
      recover: vi.fn(), readApprovalUrl: vi.fn() };
    const stripe = { provider: "stripe" as const, create: vi.fn(), cancelSubscription: vi.fn(),
      captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
    const executor = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);

    await expect(executor.resume(work, catalog())).rejects.toBe(stale);
    expect(create).not.toHaveBeenCalled();
    expect(repository.recordOperationResult).not.toHaveBeenCalled();
    if (fence === "issue") expect(repository.consumeDispatchPermit).not.toHaveBeenCalled();
  });

  it("uses the DB-derived Order target for read-only recovery of an unknown capture", async () => {
    const captureWork = { ...work, purchaseKind: "fixed_term" as const, offer: "ten_year" as const,
      providerCatalogItem: "P-PAYPAL-FIXED", operationKind: "fixed_term_order_capture" as const,
      providerResourceKind: "order", providerResourceId: "ORDER-1",
      expectedGrossMinor: 1, expectedCurrency: "USD" as const };
    const replay = { state: "outcome_unknown" as const, responseDigest: digest("unknown"), resources: [], disposition: "current" as const };
    const repository = { readOperationReplay: vi.fn(async () => replay),
      issueDispatchPermit: vi.fn(async () => ({ dispatchPermitId: "permit-1", providerOperationId: "operation-1",
        operationRevision: 5, operationKind: "fixed_term_order_capture" as const, dispatchAttempt: 2,
        expiresAt: "2026-09-03T00:01:00Z" })),
      consumeDispatchPermit: vi.fn(async (_query, _work, permit) => ({ ...permit, provider: "paypal" as const,
        providerIdempotencyKey: "stable-key", consumedAt: "2026-09-03T00:00:00Z" })),
      recordOperationResult: vi.fn(async (_query, _work, _permit, command) => ({ ...replay,
        state: command.outcome, responseDigest: command.responseDigest, resources: command.resources })),
    };
    const recover = vi.fn(async ({ resources }) => {
      expect(resources).toMatchObject([{ resourceKind: "order", resourceId: "ORDER-1", role: "target" }]);
      return { resources: [{ resourceKind: "order", resourceId: "ORDER-1", role: "target" as const },
        { resourceKind: "capture", resourceId: "CAPTURE-1", role: "created" as const }],
      responseEvidence: { status: "COMPLETED" } };
    });
    const captureFixedTerm = vi.fn();
    const paypal = { provider: "paypal" as const, create: vi.fn(), cancelSubscription: vi.fn(),
      captureFixedTerm, recover, readApprovalUrl: vi.fn() };
    const stripe = { provider: "stripe" as const, create: vi.fn(), cancelSubscription: vi.fn(),
      captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
    const executor = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);

    await expect(executor.resume(captureWork, new CommercialCheckoutCatalog([{ provider: "paypal", offer: "ten_year",
      campaignCode: null, providerItemId: "P-PAYPAL-FIXED", providerDiscountId: null, currency: "USD", amountMinor: 1 }])))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(recover).toHaveBeenCalledOnce();
    expect(captureFixedTerm).not.toHaveBeenCalled();
  });

  it("re-dispatches an unknown operation with the stable Provider idempotency identity when recovery misses", async () => {
    const stripeWork = { ...work, provider: "stripe" as const, providerCatalogItem: "price_STRIPE_MONTHLY",
      requestDigest: commercialCheckoutRequestDigest({ provider: "stripe", offer: "monthly", campaignCode: null,
        providerItemId: "price_STRIPE_MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980,
        purchaseKind: "subscription" }) };
    const permit = { dispatchPermitId: "permit-retry", providerOperationId: stripeWork.providerOperationId,
      operationRevision: stripeWork.operationRevision, operationKind: stripeWork.operationKind,
      dispatchAttempt: 2, expiresAt: "2026-09-03T00:01:00Z" };
    const repository = {
      readOperationReplay: vi.fn(async () => ({ state: "outcome_unknown" as const,
        responseDigest: digest("unknown"), resources: [], disposition: "current" as const })),
      issueDispatchPermit: vi.fn(async () => permit),
      consumeDispatchPermit: vi.fn(async () => ({ ...permit, provider: "stripe" as const,
        providerIdempotencyKey: stripeWork.providerIdempotencyKey, consumedAt: "2026-09-03T00:00:00Z" })),
      recordOperationResult: vi.fn(async (_query: unknown, _work: unknown, _permit: unknown,
        command: { readonly outcome: "confirmed" | "rejected" | "outcome_unknown" | "manual_resolution";
          readonly responseDigest: Uint8Array; readonly resources: readonly unknown[] }) => ({
        state: command.outcome, responseDigest: command.responseDigest, resources: command.resources,
        disposition: "current" as const,
      })),
    };
    const recover = vi.fn(async () => null);
    const create = vi.fn(async ({ authorization }: { authorization: { readonly providerIdempotencyKey: string } }) => {
      expect(authorization.providerIdempotencyKey).toBe(stripeWork.providerIdempotencyKey);
      return { resources: [{ resourceKind: "subscription", resourceId: "sub-1", role: "created" as const }],
        responseEvidence: { status: "active" } };
    });
    const stripe = { provider: "stripe" as const, create, cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(),
      recover, readApprovalUrl: vi.fn() };
    const paypal = { provider: "paypal" as const, create: vi.fn(), cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(),
      recover: vi.fn(), readApprovalUrl: vi.fn() };
    const executor = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);
    await expect(executor.resume(stripeWork, new CommercialCheckoutCatalog([{
      provider: "stripe", offer: "monthly", campaignCode: null, providerItemId: "price_STRIPE_MONTHLY",
      providerDiscountId: null, currency: "USD", amountMinor: 980,
    }]))).resolves.toMatchObject({ outcome: "confirmed" });
    expect(recover).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(repository.issueDispatchPermit).toHaveBeenCalledOnce();
  });

  it("hands off confirmed PayPal work using the same DB-leased capability", async () => {
    const subscription = { resourceKind: "subscription", resourceId: "I-SUBSCRIPTION", role: "created" as const,
      bindingDigest: digest({ provider: "paypal", resourceKind: "subscription", resourceId: "I-SUBSCRIPTION" }) };
    const handoff = { observationDigest: digest({ subscription }), handoff: {
      kind: "paypal_subscription" as const, subscription: { ...subscription, role: "canonical_agreement" as const },
    } };
    const repository = {
      leaseProviderOperationWork: vi.fn(async () => work),
      heartbeatBoundWork: vi.fn(async () => "2026-09-03T00:01:15Z"),
      handoffProviderAgreement: vi.fn(async () => ({ providerAgreementId: "agreement-1", slotEpoch: 2, replay: "created" as const })),
      failBoundWork: vi.fn(),
    };
    const dispatch = { resume: vi.fn(async () => ({ outcome: "confirmed" as const,
      replay: { state: "confirmed" as const, responseDigest: digest("confirmed"), resources: [subscription], disposition: "current" as const } })) };
    const paypal = { provider: "paypal" as const, read: vi.fn(),
      handoffForOperation: vi.fn(async () => handoff) };
    const service = new ProviderOperationRecoveryService({ query: vi.fn() } as never, repository as never,
      catalog(), dispatch as never, [{ provider: "stripe", read: vi.fn() }, paypal] as never,
      () => new Date("2026-09-03T00:00:10Z"));

    await expect(service.processNextOperation("worker-1"))
      .resolves.toEqual({ status: "confirmed", provider: "paypal" });
    expect(dispatch.resume).toHaveBeenCalledWith(work, expect.any(CommercialCheckoutCatalog));
    expect(paypal.handoffForOperation).toHaveBeenCalledWith(work, [subscription], new Date("2026-09-03T00:00:10Z"));
    expect(repository.handoffProviderAgreement).toHaveBeenCalledWith(expect.anything(), work, handoff);
    expect(repository.failBoundWork).not.toHaveBeenCalled();
  });

  it("leaves unknown work on the database-owned retry schedule without a handoff", async () => {
    const repository = { leaseProviderOperationWork: vi.fn(async () => work), heartbeatBoundWork: vi.fn(),
      handoffProviderAgreement: vi.fn(), failBoundWork: vi.fn() };
    const dispatch = { resume: vi.fn(async () => ({ outcome: "outcome_unknown" as const,
      replay: { state: "outcome_unknown", responseDigest: digest("unknown"), resources: [], disposition: "current" } })) };
    const service = new ProviderOperationRecoveryService({ query: vi.fn() } as never, repository as never,
      catalog(), dispatch as never, [{ provider: "stripe", read: vi.fn() }, { provider: "paypal", read: vi.fn() }] as never);

    await expect(service.processNextOperation("worker-1"))
      .resolves.toEqual({ status: "retry_scheduled", provider: "paypal" });
    expect(repository.handoffProviderAgreement).not.toHaveBeenCalled();
  });

  it("fails the exact lease after confirmed persistence fails and recovers read-before-write on the DB-driven retry", async () => {
    const firstWork = { ...work, provider: "stripe" as const, providerCatalogItem: "price_STRIPE_MONTHLY",
      requestDigest: commercialCheckoutRequestDigest({ provider: "stripe", offer: "monthly", campaignCode: null,
        providerItemId: "price_STRIPE_MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980,
        purchaseKind: "subscription" }) };
    const retryWork = { ...firstWork, leaseEpoch: firstWork.leaseEpoch + 1,
      leaseExpiresAt: "2026-09-03T00:02:00Z", rawToken: new Uint8Array(32).fill(1) };
    const permit = (dispatchAttempt: number) => ({ dispatchPermitId: `permit-${dispatchAttempt}`,
      providerOperationId: firstWork.providerOperationId, operationRevision: firstWork.operationRevision,
      operationKind: firstWork.operationKind, dispatchAttempt, expiresAt: "2026-09-03T00:01:00Z" });
    let replayState: "planned" | "outcome_unknown" | "confirmed" = "planned";
    let leaseCount = 0;
    let recordCount = 0;
    const recordedOutcomes: string[] = [];
    const failBoundWork = vi.fn(async (_query: unknown, failedWork: typeof firstWork, failure: string) => {
      expect(failedWork).toBe(firstWork);
      expect(failure).toBe("transient_network");
      replayState = "outcome_unknown";
      return "retry_wait" as const;
    });
    const repository = {
      leaseProviderOperationWork: vi.fn(async () => leaseCount++ === 0 ? firstWork : retryWork),
      heartbeatBoundWork: vi.fn(), handoffProviderAgreement: vi.fn(), failBoundWork,
      readOperationReplay: vi.fn(async () => ({ state: replayState, responseDigest: digest(replayState),
        resources: [], disposition: "current" as const })),
      issueDispatchPermit: vi.fn(async () => permit(recordCount === 0 ? 1 : 2)),
      consumeDispatchPermit: vi.fn(async (_query: unknown, _leased: typeof firstWork,
        issued: ReturnType<typeof permit>) => ({ ...issued, provider: "stripe" as const,
          providerIdempotencyKey: firstWork.providerIdempotencyKey, consumedAt: "2026-09-03T00:00:00Z" })),
      recordOperationResult: vi.fn(async (_query: unknown, _leased: typeof firstWork,
        _permit: ReturnType<typeof permit>, command: { readonly outcome: string; readonly responseDigest: Uint8Array;
          readonly resources: readonly unknown[] }) => {
        recordedOutcomes.push(command.outcome);
        recordCount += 1;
        if (recordCount === 1) throw new Error("result persistence unavailable");
        replayState = "confirmed";
        return { state: "confirmed" as const, responseDigest: command.responseDigest,
          resources: command.resources, disposition: "current" as const };
      }),
    };
    const create = vi.fn(async () => ({ resources: [{ resourceKind: "subscription", resourceId: "sub-1",
      role: "created" as const }], responseEvidence: { status: "active" } }));
    const recover = vi.fn(async () => ({ resources: [{ resourceKind: "subscription", resourceId: "sub-1",
      role: "created" as const }], responseEvidence: { status: "active" } }));
    const stripe = { provider: "stripe" as const, create, cancelSubscription: vi.fn(),
      captureFixedTerm: vi.fn(), recover, readApprovalUrl: vi.fn() };
    const paypal = { provider: "paypal" as const, create: vi.fn(), cancelSubscription: vi.fn(),
      captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
    const dispatch = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);
    const service = new ProviderOperationRecoveryService({ query: vi.fn() } as never, repository as never,
      new CommercialCheckoutCatalog([{ provider: "stripe", offer: "monthly", campaignCode: null,
        providerItemId: "price_STRIPE_MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980 }]),
      dispatch, [{ provider: "stripe", read: vi.fn() }, { provider: "paypal", read: vi.fn() }] as never);

    await expect(service.processNextOperation("worker-1"))
      .resolves.toEqual({ status: "retry_scheduled", provider: "stripe" });
    expect(recordedOutcomes).toEqual(["confirmed"]);
    expect(create).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
    expect(failBoundWork).toHaveBeenCalledWith(expect.anything(), firstWork, "transient_network");

    await expect(service.processNextOperation("worker-1"))
      .resolves.toEqual({ status: "confirmed", provider: "stripe" });
    expect(repository.readOperationReplay).toHaveBeenLastCalledWith(expect.anything(), retryWork);
    expect(repository.issueDispatchPermit).toHaveBeenLastCalledWith(expect.anything(), retryWork, 60);
    expect(recover).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(recordedOutcomes).toEqual(["confirmed", "confirmed"]);
  });

  it.each(["subscription_create", "fixed_term_order_capture"] as const)(
    "replays committed %s truth after ack loss and completes PayPal handoff without another mutation",
    async (operationKind) => {
      const operationWork = operationKind === "subscription_create" ? work : {
        ...work, purchaseKind: "fixed_term" as const, offer: "ten_year" as const,
        providerCatalogItem: "P-PAYPAL-FIXED", operationKind,
        providerResourceKind: "order", providerResourceId: "ORDER-1",
        expectedGrossMinor: 49_800, expectedCurrency: "USD" as const,
      };
      const retryWork = { ...operationWork, leaseEpoch: operationWork.leaseEpoch + 1,
        rawToken: new Uint8Array(32).fill(2) };
      const permit = { dispatchPermitId: "permit-ack-loss", providerOperationId: operationWork.providerOperationId,
        operationRevision: operationWork.operationRevision, operationKind, dispatchAttempt: 1,
        expiresAt: "2026-09-03T00:01:00Z" };
      let leaseCount = 0;
      let persisted: { readonly state: "confirmed"; readonly responseDigest: Uint8Array;
        readonly resources: readonly unknown[]; readonly disposition: "current" } | null = null;
      const recordedOutcomes: string[] = [];
      const failBoundWork = vi.fn(async () => "retry_wait" as const);
      const handoffProviderAgreement = vi.fn(async () => ({ providerAgreementId: "agreement-1",
        slotEpoch: 2, replay: "created" as const }));
      const repository = {
        leaseProviderOperationWork: vi.fn(async () => leaseCount++ === 0 ? operationWork : retryWork),
        heartbeatBoundWork: vi.fn(), failBoundWork, handoffProviderAgreement,
        readOperationReplay: vi.fn(async () => persisted ?? ({ state: "planned" as const,
          responseDigest: digest("planned"), resources: [], disposition: "current" as const })),
        issueDispatchPermit: vi.fn(async () => permit),
        consumeDispatchPermit: vi.fn(async () => ({ ...permit, provider: "paypal" as const,
          providerIdempotencyKey: operationWork.providerIdempotencyKey, consumedAt: "2026-09-03T00:00:00Z" })),
        recordOperationResult: vi.fn(async (_query: unknown, _leased: typeof operationWork, _issued: typeof permit,
          command: { readonly outcome: string; readonly responseDigest: Uint8Array;
            readonly resources: readonly unknown[] }) => {
          recordedOutcomes.push(command.outcome);
          persisted = { state: "confirmed", responseDigest: command.responseDigest,
            resources: command.resources, disposition: "current" };
          throw new Error("commit acknowledgement lost");
        }),
      };
      const create = vi.fn(async () => ({ resources: [{ resourceKind: "subscription",
        resourceId: "I-SUB-1", role: "created" as const }], responseEvidence: { status: "ACTIVE" } }));
      const captureFixedTerm = vi.fn(async () => ({ resources: [{ resourceKind: "order",
        resourceId: "ORDER-1", role: "target" as const }, { resourceKind: "capture",
        resourceId: "CAPTURE-1", role: "created" as const }], responseEvidence: { status: "COMPLETED" } }));
      const paypal = { provider: "paypal" as const, create, cancelSubscription: vi.fn(), captureFixedTerm,
        recover: vi.fn(), readApprovalUrl: vi.fn() };
      const stripe = { provider: "stripe" as const, create: vi.fn(), cancelSubscription: vi.fn(),
        captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
      const dispatch = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);
      const handoffForOperation = vi.fn(async () => operationKind === "subscription_create"
        ? { observationDigest: digest("subscription-handoff"), paymentResources: [], handoff: {
          kind: "paypal_subscription" as const, subscription: { resourceKind: "subscription",
            resourceId: "I-SUB-1", role: "canonical_agreement" as const, bindingDigest: digest("sub") } } }
        : { observationDigest: digest("capture-handoff"), paymentResources: [{ resourceKind: "capture" as const,
          resourceId: "CAPTURE-1", bindingDigest: digest("capture") }], handoff: {
          kind: "paypal_fixed_term" as const, order: { resourceKind: "order", resourceId: "ORDER-1",
            role: "order_origin" as const, bindingDigest: digest("order") }, capture: { resourceKind: "capture",
            resourceId: "CAPTURE-1", role: "capture_evidence" as const, bindingDigest: digest("capture") },
          capturedAt: "2026-09-03T00:00:00Z" } });
      const service = new ProviderOperationRecoveryService({ query: vi.fn() } as never, repository as never,
        operationKind === "subscription_create" ? catalog() : new CommercialCheckoutCatalog([{
          provider: "paypal", offer: "ten_year", campaignCode: null, providerItemId: "P-PAYPAL-FIXED",
          providerDiscountId: null, currency: "USD", amountMinor: 49_800 }]), dispatch,
      [{ provider: "stripe", read: vi.fn() }, { provider: "paypal", read: vi.fn(), handoffForOperation }] as never);

      await expect(service.processNextOperation("worker-1"))
        .resolves.toEqual({ status: "retry_scheduled", provider: "paypal" });
      expect(recordedOutcomes).toEqual(["confirmed"]);
      expect(failBoundWork).toHaveBeenCalledOnce();
      expect(handoffProviderAgreement).not.toHaveBeenCalled();

      await expect(service.processNextOperation("worker-1"))
        .resolves.toEqual({ status: "confirmed", provider: "paypal" });
      expect(recordedOutcomes).toEqual(["confirmed"]);
      expect(handoffForOperation).toHaveBeenCalledWith(retryWork, persisted!.resources, expect.any(Date));
      expect(handoffProviderAgreement).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledTimes(operationKind === "subscription_create" ? 1 : 0);
      expect(captureFixedTerm).toHaveBeenCalledTimes(operationKind === "fixed_term_order_capture" ? 1 : 0);
      expect(paypal.recover).not.toHaveBeenCalled();
    },
  );

  it("replays committed ordinary-operation truth after ack loss without writing outcome_unknown", async () => {
    const stripeWork = { ...work, provider: "stripe" as const, providerCatalogItem: "price_STRIPE_MONTHLY",
      requestDigest: commercialCheckoutRequestDigest({ provider: "stripe", offer: "monthly", campaignCode: null,
        providerItemId: "price_STRIPE_MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980,
        purchaseKind: "subscription" }) };
    const permit = { dispatchPermitId: "permit-ordinary", providerOperationId: stripeWork.providerOperationId,
      operationRevision: stripeWork.operationRevision, operationKind: stripeWork.operationKind, dispatchAttempt: 1,
      expiresAt: "2026-09-03T00:01:00Z" };
    let persisted: { readonly state: "confirmed"; readonly responseDigest: Uint8Array;
      readonly resources: readonly unknown[]; readonly disposition: "current" } | null = null;
    const recordedOutcomes: string[] = [];
    const repository = { readOperationReplay: vi.fn(async () => persisted ?? ({ state: "planned" as const,
      responseDigest: digest("planned"), resources: [], disposition: "current" as const })),
    issueDispatchPermit: vi.fn(async () => permit), consumeDispatchPermit: vi.fn(async () => ({ ...permit,
      provider: "stripe" as const, providerIdempotencyKey: stripeWork.providerIdempotencyKey,
      consumedAt: "2026-09-03T00:00:00Z" })),
    recordOperationResult: vi.fn(async (_query: unknown, _leased: typeof stripeWork, _issued: typeof permit,
      command: { readonly outcome: string; readonly responseDigest: Uint8Array; readonly resources: readonly unknown[] }) => {
      recordedOutcomes.push(command.outcome);
      persisted = { state: "confirmed", responseDigest: command.responseDigest,
        resources: command.resources, disposition: "current" };
      throw new Error("commit acknowledgement lost");
    }) };
    const create = vi.fn(async () => ({ resources: [{ resourceKind: "subscription", resourceId: "sub-1",
      role: "created" as const }], responseEvidence: { status: "active" } }));
    const stripe = { provider: "stripe" as const, create, cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(),
      recover: vi.fn(), readApprovalUrl: vi.fn() };
    const paypal = { provider: "paypal" as const, create: vi.fn(), cancelSubscription: vi.fn(),
      captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
    const executor = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);
    const stripeCatalog = new CommercialCheckoutCatalog([{ provider: "stripe", offer: "monthly", campaignCode: null,
      providerItemId: "price_STRIPE_MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980 }]);

    await expect(executor.resume(stripeWork, stripeCatalog)).rejects.toThrow("commit acknowledgement lost");
    await expect(executor.resume({ ...stripeWork, leaseEpoch: 3 }, stripeCatalog))
      .resolves.toMatchObject({ outcome: "confirmed", replay: { state: "confirmed" } });
    expect(recordedOutcomes).toEqual(["confirmed"]);
    expect(create).toHaveBeenCalledOnce();
    expect(stripe.recover).not.toHaveBeenCalled();
  });

  it("fails work when Provider I/O and outcome_unknown persistence both fail, then recovers from DB retry", async () => {
    const stripeWork = { ...work, provider: "stripe" as const, providerCatalogItem: "price_STRIPE_MONTHLY",
      requestDigest: commercialCheckoutRequestDigest({ provider: "stripe", offer: "monthly", campaignCode: null,
        providerItemId: "price_STRIPE_MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980,
        purchaseKind: "subscription" }) };
    const retryWork = { ...stripeWork, leaseEpoch: 3, rawToken: new Uint8Array(32).fill(3) };
    let leaseCount = 0;
    let replayState: "planned" | "outcome_unknown" | "confirmed" = "planned";
    let recordCount = 0;
    const repository = { leaseProviderOperationWork: vi.fn(async () => leaseCount++ === 0 ? stripeWork : retryWork),
      heartbeatBoundWork: vi.fn(), handoffProviderAgreement: vi.fn(),
      failBoundWork: vi.fn(async () => { replayState = "outcome_unknown"; return "retry_wait" as const; }),
      readOperationReplay: vi.fn(async () => ({ state: replayState, responseDigest: digest(replayState),
        resources: [], disposition: "current" as const })),
      issueDispatchPermit: vi.fn(async () => ({ dispatchPermitId: `permit-${recordCount + 1}`,
        providerOperationId: stripeWork.providerOperationId, operationRevision: stripeWork.operationRevision,
        operationKind: stripeWork.operationKind, dispatchAttempt: recordCount + 1,
        expiresAt: "2026-09-03T00:01:00Z" })),
      consumeDispatchPermit: vi.fn(async (_query: unknown, _leased: typeof stripeWork, issued: object) => ({ ...issued,
        provider: "stripe" as const, providerIdempotencyKey: stripeWork.providerIdempotencyKey,
        consumedAt: "2026-09-03T00:00:00Z" })),
      recordOperationResult: vi.fn(async (_query: unknown, _leased: typeof stripeWork, _permit: unknown,
        command: { readonly outcome: string; readonly responseDigest: Uint8Array; readonly resources: readonly unknown[] }) => {
        recordCount += 1;
        if (recordCount === 1) {
          expect(command.outcome).toBe("outcome_unknown");
          throw new Error("unknown result persistence unavailable");
        }
        replayState = "confirmed";
        return { state: "confirmed" as const, responseDigest: command.responseDigest,
          resources: command.resources, disposition: "current" as const };
      }) };
    const create = vi.fn(async () => { throw new Error("Provider connection lost"); });
    const recover = vi.fn(async () => ({ resources: [{ resourceKind: "subscription", resourceId: "sub-1",
      role: "created" as const }], responseEvidence: { status: "active" } }));
    const stripe = { provider: "stripe" as const, create, cancelSubscription: vi.fn(), captureFixedTerm: vi.fn(),
      recover, readApprovalUrl: vi.fn() };
    const paypal = { provider: "paypal" as const, create: vi.fn(), cancelSubscription: vi.fn(),
      captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
    const dispatch = new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [stripe, paypal]);
    const stripeCatalog = new CommercialCheckoutCatalog([{ provider: "stripe", offer: "monthly", campaignCode: null,
      providerItemId: "price_STRIPE_MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980 }]);
    const service = new ProviderOperationRecoveryService({ query: vi.fn() } as never, repository as never,
      stripeCatalog, dispatch, [{ provider: "stripe", read: vi.fn() }, { provider: "paypal", read: vi.fn() }] as never);

    await expect(service.processNextOperation("worker-1")).resolves.toMatchObject({ status: "retry_scheduled" });
    await expect(service.processNextOperation("worker-1")).resolves.toMatchObject({ status: "confirmed" });
    expect(repository.failBoundWork).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(recordCount).toBe(2);
  });
});

function catalog(): CommercialCheckoutCatalog {
  return new CommercialCheckoutCatalog([{ provider: "paypal", offer: "monthly", campaignCode: null,
    providerItemId: "P-PAYPAL-MONTHLY", providerDiscountId: null, currency: "USD", amountMinor: 980 }]);
}

function digest(value: unknown): Uint8Array {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}
