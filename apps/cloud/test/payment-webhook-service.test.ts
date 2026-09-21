import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  PaymentWebhookApplicationService,
  PaymentWebhookConflictError,
  PaymentWebhookReconciliationService,
} from "../src/modules/licensing/payment-webhook-service";
import { PayPalCommercialProviderReader } from "../src/modules/licensing/providers/paypal";
import { StripeCommercialProviderReader } from "../src/modules/licensing/providers/stripe";
import type {
  ApplyAgreementObservationCommand,
  BoundReconciliationWork,
} from "../src/modules/licensing/commercial-domain";
import type { CommercialProviderReader } from "../src/modules/licensing/payment-webhook-service";

describe("payment webhook durable pipeline", () => {
  it("commits an account-blind exact-byte receipt and performs no provider fetch", async () => {
    const raw = Buffer.from('{ "id" : "evt_raw" }');
    const authenticate = vi.fn(async () => ({
      kind: "actionable" as const,
      provider: "stripe" as const,
      providerEventId: "evt_raw",
      eventType: "customer.subscription.updated",
      triggerResourceKind: "subscription",
      triggerResourceId: "sub_current",
      occurredAt: "2026-08-30T00:00:00Z",
      authenticatedEvidenceRef: "stripe-event-evt_raw",
    }));
    const receive = vi.fn(async () => "scheduled" as const);
    const query = { query: vi.fn() };
    const service = new PaymentWebhookApplicationService(
      query as never,
      { receiveAuthenticatedReceipt: receive },
      { authenticate },
      { authenticate: vi.fn() },
    );

    await service.process("stripe", raw, { "stripe-signature": "fixture" }, new Date("2026-08-30T00:00:00Z"));

    expect(receive).toHaveBeenCalledWith(query, expect.objectContaining({
      provider: "stripe",
      providerEventId: "evt_raw",
      payloadDigest: createHash("sha256").update(raw).digest(),
      triggerResourceId: "sub_current",
    }));
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it("fails closed when the same event identity has a conflicting digest", async () => {
    const event = {
      kind: "actionable" as const,
      provider: "stripe" as const,
      providerEventId: "evt_conflict",
      eventType: "customer.subscription.updated",
      triggerResourceKind: "subscription",
      triggerResourceId: "sub_current",
      occurredAt: "2026-08-30T00:00:00Z",
      authenticatedEvidenceRef: "stripe-event-evt_conflict",
    };
    const service = new PaymentWebhookApplicationService(
      { query: vi.fn() } as never,
      { receiveAuthenticatedReceipt: vi.fn(async () => "conflict" as const) },
      { authenticate: vi.fn(async () => event) },
      { authenticate: vi.fn() },
    );
    await expect(service.process("stripe", Buffer.from("{}"), {}, new Date()))
      .rejects.toBeInstanceOf(PaymentWebhookConflictError);
  });

  it("durably commits an authenticated ignored receipt before success", async () => {
    const receiveAuthenticatedReceipt = vi.fn(async () => "ignored" as const);
    const service = new PaymentWebhookApplicationService({ query: vi.fn() } as never,
      { receiveAuthenticatedReceipt },
      { authenticate: vi.fn(async () => ({ kind: "ignored" as const, provider: "stripe" as const,
        providerEventId: "evt-ignored", eventType: "customer.created", ignoredReason: "unsupported_event" as const,
        occurredAt: "2026-08-30T00:00:00Z", authenticatedEvidenceRef: "stripe-event-evt-ignored" })) },
      { authenticate: vi.fn() });
    await service.process("stripe", Buffer.from("{}"), {}, new Date("2026-08-30T00:00:00Z"));
    expect(receiveAuthenticatedReceipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: "ignored", providerEventId: "evt-ignored", triggerResourceKind: null, triggerResourceId: null,
      ignoredReason: "unsupported_event",
    }));
  });

  it("fails bounded receipt work through the targetless work capability", async () => {
    const failBoundWork = vi.fn(async () => "retry_wait" as const);
    const repository = {
      leaseReceiptWork: vi.fn(async () => ({
        kind: "receipt",
        workId: "work-1", leaseEpoch: 2, leaseExpiresAt: "2026-08-30T00:01:00Z", rawToken: new Uint8Array(32),
        provider: "paypal",
        providerEventId: "event-1",
        payloadDigest: new Uint8Array(32),
        receiptKind: "actionable", triggerResourceKind: "order", triggerResourceId: "order-1",
        occurredAt: "2026-08-30T00:00:00Z",
        authenticatedEvidenceRef: "paypal-event-event-1",
      })),
      heartbeatBoundWork: vi.fn(),
      bindReceiptWork: vi.fn(async () => { throw new Error("missing binding"); }),
      failBoundWork,
    };
    const service = new PaymentWebhookReconciliationService(
      { query: vi.fn() } as never,
      repository as never,
      [{ provider: "stripe", read: vi.fn() }, { provider: "paypal", read: vi.fn() }],
      () => new Date(),
    );
    await expect(service.processNextInbox("worker-1"))
      .resolves.toEqual({ status: "retry_scheduled", provider: "paypal" });
    expect(failBoundWork).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workId: "work-1" }), "transient_network");
  });

  it("links an exact supplemental receipt chain before scheduling canonical reconciliation", async () => {
    const work = { kind: "receipt" as const, workId: "work-refund", leaseEpoch: 2,
      leaseExpiresAt: "2026-08-30T00:01:00Z", rawToken: new Uint8Array(32), provider: "stripe" as const,
      providerEventId: "event-refund", payloadDigest: new Uint8Array(32), eventType: "refund.updated",
      receiptKind: "actionable" as const, triggerResourceKind: "refund", triggerResourceId: "re_1",
      occurredAt: "2026-08-30T00:00:00Z", authenticatedEvidenceRef: "stripe-event-event-refund" };
    const command = { anchorResourceKind: "checkout_session", anchorResourceId: "cs_1",
      anchorBindingDigest: new Uint8Array(32), resources: [{ resourceKind: "refund" as const,
        resourceId: "re_1", bindingDigest: new Uint8Array(32), linkRole: "refund_evidence" as const }] };
    const bindReceiptWork = vi.fn(async () => ({ disposition: "reconciliation_scheduled" as const,
      reconciliationJobId: "job-1", requestedGeneration: 3 }));
    const linkReceiptResourcesToAgreement = vi.fn(async () => "agreement-1");
    const handoffForReceipt = vi.fn();
    const service = new PaymentWebhookReconciliationService({ query: vi.fn() } as never, {
      leaseReceiptWork: vi.fn(async () => work), heartbeatBoundWork: vi.fn(), bindReceiptWork,
      linkReceiptResourcesToAgreement, failBoundWork: vi.fn(),
    } as never, [{ provider: "stripe", read: vi.fn(), resolveReceiptResourceBinding: vi.fn(async () => command),
      handoffForReceipt }, { provider: "paypal", read: vi.fn() }], () => new Date("2026-08-30T00:00:01Z"));

    await expect(service.processNextInbox("worker-1")).resolves.toEqual({ status: "scheduled", provider: "stripe" });
    expect(linkReceiptResourcesToAgreement).toHaveBeenCalledWith(expect.anything(), work, command);
    expect(handoffForReceipt).not.toHaveBeenCalled();
  });

  it("hands off an initial receipt with exact payment resources before binding", async () => {
    const work = { kind: "receipt" as const, workId: "work-origin", leaseEpoch: 2,
      leaseExpiresAt: "2026-08-30T00:01:00Z", rawToken: new Uint8Array(32), provider: "stripe" as const,
      providerEventId: "event-origin", payloadDigest: new Uint8Array(32), eventType: "checkout.session.completed",
      receiptKind: "actionable" as const, triggerResourceKind: "checkout_session", triggerResourceId: "cs_1",
      occurredAt: "2026-08-30T00:00:00Z", authenticatedEvidenceRef: "stripe-event-event-origin" };
    const handoff = { observationDigest: new Uint8Array(32), paymentResources: [{ resourceKind: "charge" as const,
      resourceId: "ch_1", bindingDigest: new Uint8Array(32) }], handoff: { kind: "stripe_fixed_term" as const,
      checkoutSession: { resourceKind: "checkout_session", resourceId: "cs_1", role: "checkout_origin" as const,
        bindingDigest: new Uint8Array(32) },
      capturedAt: "2026-08-30T00:00:00Z" } };
    const handoffProviderAgreement = vi.fn();
    const bindReceiptWork = vi.fn();
    const resolveReceiptResourceBinding = vi.fn();
    const service = new PaymentWebhookReconciliationService({ query: vi.fn() } as never, {
      leaseReceiptWork: vi.fn(async () => work), heartbeatBoundWork: vi.fn(), bindReceiptWork,
      handoffProviderAgreement, failBoundWork: vi.fn(),
    } as never, [{ provider: "stripe", read: vi.fn(), handoffForReceipt: vi.fn(async () => handoff),
      resolveReceiptResourceBinding }, { provider: "paypal", read: vi.fn() }],
    () => new Date("2026-08-30T00:00:01Z"));

    await expect(service.processNextInbox("worker-1")).resolves.toEqual({ status: "scheduled", provider: "stripe" });
    expect(handoffProviderAgreement).toHaveBeenCalledWith(expect.anything(), work, handoff);
    expect(resolveReceiptResourceBinding).toHaveBeenCalledWith(work, new Date("2026-08-30T00:00:01Z"));
    expect(bindReceiptWork).not.toHaveBeenCalled();
  });

  it("keeps a receipt capability alive while provider reads exceed the initial lease", async () => {
    vi.useFakeTimers();
    try {
      const work = { kind: "receipt" as const, workId: "work-slow-provider", leaseEpoch: 1,
        leaseExpiresAt: "2026-08-30T00:00:30Z", rawToken: new Uint8Array(32), provider: "stripe" as const,
        providerEventId: "event-slow-provider", payloadDigest: new Uint8Array(32),
        eventType: "invoice.paid", receiptKind: "actionable" as const,
        triggerResourceKind: "invoice", triggerResourceId: "in_1",
        occurredAt: "2026-08-30T00:00:00Z", authenticatedEvidenceRef: "stripe-event-slow-provider" };
      const heartbeatBoundWork = vi.fn(async () => "2026-08-30T00:01:00Z");
      const bindReceiptWork = vi.fn(async () => ({ disposition: "reconciliation_scheduled" as const,
        reconciliationJobId: "job-slow-provider", requestedGeneration: 1 }));
      const service = new PaymentWebhookReconciliationService({ query: vi.fn() } as never, {
        leaseReceiptWork: vi.fn(async () => work), heartbeatBoundWork, bindReceiptWork,
        linkReceiptResourcesToAgreement: vi.fn(), handoffProviderAgreement: vi.fn(), failBoundWork: vi.fn(),
      } as never, [{ provider: "stripe", read: vi.fn(),
        resolveReceiptResourceBinding: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 31_000));
          return null;
        }) }, { provider: "paypal", read: vi.fn() }], () => new Date("2026-08-30T00:00:01Z"));

      const result = service.processNextInbox("worker-slow-provider");
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(result).resolves.toEqual({ status: "scheduled", provider: "stripe" });
      expect(heartbeatBoundWork.mock.calls.length).toBeGreaterThanOrEqual(5);
      expect(heartbeatBoundWork.mock.invocationCallOrder.at(-1))
        .toBeLessThan(bindReceiptWork.mock.invocationCallOrder[0]!);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back from an unbound activation anchor to one initial handoff", async () => {
    const work = { kind: "receipt" as const, workId: "work-activation", leaseEpoch: 1,
      leaseExpiresAt: "2026-08-30T00:01:00Z", rawToken: new Uint8Array(32), provider: "paypal" as const,
      providerEventId: "event-activation", payloadDigest: new Uint8Array(32),
      eventType: "BILLING.SUBSCRIPTION.ACTIVATED", receiptKind: "actionable" as const,
      triggerResourceKind: "subscription", triggerResourceId: "I-SUB-1",
      occurredAt: "2026-08-30T00:00:00Z", authenticatedEvidenceRef: "paypal-event-event-activation" };
    const command = { anchorResourceKind: "subscription", anchorResourceId: "I-SUB-1",
      anchorBindingDigest: new Uint8Array(32), resources: [{ resourceKind: "subscription_transaction" as const,
        resourceId: "TXN-1", bindingDigest: new Uint8Array(32), linkRole: "initial_payment" as const }] };
    const handoff = { observationDigest: new Uint8Array(32), paymentResources: [{
      resourceKind: "subscription_transaction" as const, resourceId: "TXN-1", bindingDigest: new Uint8Array(32) }],
      handoff: { kind: "paypal_subscription" as const, subscription: { resourceKind: "subscription",
        resourceId: "I-SUB-1", role: "canonical_agreement" as const, bindingDigest: new Uint8Array(32) } } };
    const unavailable = Object.assign(new Error("supplemental binding anchor is unavailable"), { code: "40001" });
    const handoffProviderAgreement = vi.fn();
    const bindReceiptWork = vi.fn();
    const service = new PaymentWebhookReconciliationService({ query: vi.fn() } as never, {
      leaseReceiptWork: vi.fn(async () => work), heartbeatBoundWork: vi.fn(), bindReceiptWork,
      linkReceiptResourcesToAgreement: vi.fn(async () => { throw unavailable; }), handoffProviderAgreement,
      failBoundWork: vi.fn(),
    } as never, [{ provider: "stripe", read: vi.fn() }, { provider: "paypal", read: vi.fn(),
      resolveReceiptResourceBinding: vi.fn(async () => command), handoffForReceipt: vi.fn(async () => handoff) }],
    () => new Date("2026-08-30T00:00:01Z"));

    await expect(service.processNextInbox("worker-1")).resolves.toEqual({ status: "scheduled", provider: "paypal" });
    expect(handoffProviderAgreement).toHaveBeenCalledWith(expect.anything(), work, handoff);
    expect(bindReceiptWork).not.toHaveBeenCalled();
  });

  it("links and reconciles an operation-first PayPal activation without replaying its handoff", async () => {
    const work = { kind: "receipt" as const, workId: "work-operation-first", leaseEpoch: 1,
      leaseExpiresAt: "2026-08-30T00:01:00Z", rawToken: new Uint8Array(32), provider: "paypal" as const,
      providerEventId: "event-operation-first", payloadDigest: new Uint8Array(32),
      eventType: "BILLING.SUBSCRIPTION.ACTIVATED", receiptKind: "actionable" as const,
      triggerResourceKind: "subscription", triggerResourceId: "I-SUB-1",
      occurredAt: "2026-08-30T00:00:00Z", authenticatedEvidenceRef: "paypal-event-event-operation-first" };
    const command = { anchorResourceKind: "subscription", anchorResourceId: "I-SUB-1",
      anchorBindingDigest: new Uint8Array(32), resources: [{ resourceKind: "subscription_transaction" as const,
        resourceId: "TXN-1", bindingDigest: new Uint8Array(32), linkRole: "initial_payment" as const }] };
    const handoffForReceipt = vi.fn();
    const bindReceiptWork = vi.fn(async () => ({ disposition: "reconciliation_scheduled" as const,
      reconciliationJobId: "job-1", requestedGeneration: 1 }));
    const linkReceiptResourcesToAgreement = vi.fn(async () => "agreement-1");
    const service = new PaymentWebhookReconciliationService({ query: vi.fn() } as never, {
      leaseReceiptWork: vi.fn(async () => work), heartbeatBoundWork: vi.fn(), bindReceiptWork,
      linkReceiptResourcesToAgreement, failBoundWork: vi.fn(),
    } as never, [{ provider: "stripe", read: vi.fn() }, { provider: "paypal", read: vi.fn(),
      resolveReceiptResourceBinding: vi.fn(async () => command), handoffForReceipt }],
    () => new Date("2026-08-30T00:00:01Z"));

    await expect(service.processNextInbox("worker-1")).resolves.toEqual({ status: "scheduled", provider: "paypal" });
    expect(linkReceiptResourcesToAgreement).toHaveBeenCalledWith(expect.anything(), work, command);
    expect(bindReceiptWork).toHaveBeenCalledWith(expect.anything(), work);
    expect(handoffForReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ["paypal_refund", ["refund_pending", "refund_pending", "refund_succeeded"], false],
    ["paypal_reversal", ["fraud_signal", "fraud_signal", "full_reversal_settled"], false],
    ["stripe_refund", ["refund_pending", "refund_pending", "refund_succeeded"], false],
    ["stripe_dispute", ["fraud_signal", "fraud_signal", "full_reversal_settled"], false],
    ["stripe_dispute_won", ["fraud_signal", "fraud_signal", "refund_failed"], true],
    ["stripe_warning_closed", ["fraud_signal", "fraud_signal", "refund_failed"], true],
    ["stripe_refund_failed", ["refund_pending", "refund_pending", "refund_failed"], true],
    ["stripe_refund_pending_requires_action_failed", ["refund_pending", "refund_pending", "refund_failed"], true],
    ["stripe_refund_requires_action_canceled", ["refund_pending", "refund_pending", "refund_failed"], true],
  ] as const)("keeps the sticky %s head non-granting across descendants and unrelated receipt supersession",
    async (scenarioName, expectedFacts, terminalMayGrant) => {
      const scenario = convergenceScenario(scenarioName);
      const persistence = stickyConvergencePersistence(scenario.initialWork, 5);
      const read = vi.spyOn(scenario.reader, "read");
      const service = reconciliationService(persistence.repository, scenario.reader);

      await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });
      persistence.insertUnrelatedReceipt({ eventType: "invoice.paid", triggerResourceKind: "invoice",
        triggerResourceId: "in_unrelated" });
      await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });
      await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });
      await expect(service.processNextReconciliation("worker-1")).resolves.toEqual({ status: "idle" });

      expect(persistence.applied.map(({ command }) => command.refundFact)).toEqual(expectedFacts);
      if (scenarioName === "stripe_dispute") {
        expect(persistence.applied[2]).toMatchObject({ work: { receiptTriggerResourceKind: "dispute",
          receiptTriggerResourceId: "dp_1" }, command: { refundFact: "full_reversal_settled",
          paymentEvidence: { grossMinor: 980, cumulativeRefundedMinor: 0 } } });
      }
      expect(persistence.authorityHistory.slice(0, 2)).toEqual(["non_granting", "non_granting"]);
      expect(persistence.authorityHistory[2]).toBe(terminalMayGrant ? "granting_allowed" : "non_granting");
      expect(persistence.headResolved).toBe(true);
      expect(persistence.exhausted).toBe(false);
      expect(read.mock.calls.map(([input]) => ({ eventType: input.receiptEventType,
        providerEventId: input.receiptProviderEventId, triggerKind: input.receiptTriggerResourceKind,
        triggerId: input.receiptTriggerResourceId }))).toEqual(Array.from({ length: 3 }, () => scenario.stickyContext));
      expect(persistence.applied.map(({ work }) => work.requestedGeneration)).toEqual([1, 2, 3]);
      expect(new Set(persistence.applied.map(({ command }) =>
        Buffer.from(command.observationDigest).toString("hex"))).size).toBe(3);
      expect(persistence.latestReceipt).toEqual({ eventType: "invoice.paid", triggerResourceKind: "invoice",
        triggerResourceId: "in_unrelated" });
      expect(persistence.failBoundWork).not.toHaveBeenCalled();
    });

  it("exhausts a sticky pending PayPal refund head without regranting or losing its receipt context", async () => {
    const scenario = convergenceScenario("paypal_refund_exhausted");
    const persistence = stickyConvergencePersistence(scenario.initialWork, 2);
    const read = vi.spyOn(scenario.reader, "read");
    const service = reconciliationService(persistence.repository, scenario.reader);

    await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });
    persistence.insertUnrelatedReceipt({ eventType: "PAYMENT.CAPTURE.COMPLETED", triggerResourceKind: "capture",
      triggerResourceId: "CAPTURE-UNRELATED" });
    await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });
    await expect(service.processNextReconciliation("worker-1")).resolves.toEqual({ status: "idle" });

    expect(persistence.applied.map(({ command }) => command.refundFact))
      .toEqual(["refund_pending", "refund_pending"]);
    expect(persistence.authorityHistory).toEqual(["non_granting", "non_granting"]);
    expect(persistence.exhausted).toBe(true);
    expect(persistence.headResolved).toBe(false);
    expect(read.mock.calls.map(([input]) => input.receiptEventType))
      .toEqual(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REFUNDED"]);
    expect(read.mock.calls.map(([input]) => input.receiptTriggerResourceId))
      .toEqual(["CAPTURE-1", "CAPTURE-1"]);
    expect(persistence.failBoundWork).not.toHaveBeenCalled();
  });

  it.each(["won", "warning_closed"] as const)(
    "does not let an unrelated failed refund resolve a sticky dispute before exact %s",
    async (terminalStatus) => {
      const initialWork = reconciliationWork({ provider: "stripe", providerResourceKind: "checkout_session",
        providerResourceId: "cs_1", eventType: "charge.dispute.created", providerEventId: "event-dispute",
        triggerKind: "dispute", triggerId: "dp_1" });
      const reader = stripeDisputeAndUnrelatedRefundReader(terminalStatus);
      const persistence = stickyConvergencePersistence(initialWork, 5);
      const service = reconciliationService(persistence.repository, reader);

      await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });
      persistence.insertUnrelatedReconciliation(reconciliationWork({ provider: "stripe",
        providerResourceKind: "checkout_session", providerResourceId: "cs_1", eventType: "refund.updated",
        providerEventId: "event-unrelated-refund", triggerKind: "refund", triggerId: "re_unrelated" }));
      await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });

      expect(persistence.headResolved).toBe(false);
      expect(persistence.authorityHistory).toEqual(["non_granting", "non_granting"]);
      expect(persistence.applied.map(({ command }) => command.refundFact))
        .toEqual(["fraud_signal", "refund_failed"]);

      await expect(service.processNextReconciliation("worker-1")).resolves.toMatchObject({ status: "applied" });
      expect(persistence.applied[2]).toMatchObject({ work: { receiptProviderEventId: "event-dispute",
        receiptTriggerResourceKind: "dispute", receiptTriggerResourceId: "dp_1" },
      command: { refundFact: "refund_failed" } });
      expect(persistence.headResolved).toBe(true);
      expect(persistence.authorityHistory).toEqual(["non_granting", "non_granting", "granting_allowed"]);
      expect(persistence.failBoundWork).not.toHaveBeenCalled();
    },
  );
});

type ConvergenceScenarioName = "paypal_refund" | "paypal_reversal" | "paypal_refund_exhausted"
  | "stripe_refund" | "stripe_dispute" | "stripe_dispute_won" | "stripe_warning_closed"
  | "stripe_refund_failed" | "stripe_refund_pending_requires_action_failed"
  | "stripe_refund_requires_action_canceled";
type ReceiptContext = { readonly eventType: string; readonly providerEventId: string | null;
  readonly triggerKind: string; readonly triggerId: string };

function convergenceScenario(name: ConvergenceScenarioName): {
  readonly initialWork: BoundReconciliationWork;
  readonly reader: CommercialProviderReader;
  readonly stickyContext: ReceiptContext;
} {
  if (name.startsWith("paypal_")) {
    const reversed = name === "paypal_reversal";
    const eventType = reversed ? "PAYMENT.CAPTURE.REVERSED" : "PAYMENT.CAPTURE.REFUNDED";
    const statuses: Array<"COMPLETED" | "REFUNDED"> = name === "paypal_refund_exhausted"
      ? ["COMPLETED", "COMPLETED"] : ["COMPLETED", "COMPLETED", "REFUNDED"];
    const reader = paypalFixedTermReader(vi.fn(async () => ({ result: paypalCapture(statuses.shift()!) })));
    return { reader, initialWork: reconciliationWork({ provider: "paypal", providerResourceKind: "order",
      providerResourceId: "ORDER-1", eventType, providerEventId: "event-paypal-reversal",
      triggerKind: "capture", triggerId: "CAPTURE-1" }),
    stickyContext: { eventType, providerEventId: "event-paypal-reversal", triggerKind: "capture",
      triggerId: "CAPTURE-1" } };
  }
  const dispute = name === "stripe_dispute" || name === "stripe_dispute_won" || name === "stripe_warning_closed";
  const failed = name === "stripe_refund_failed";
  const eventType = dispute ? "charge.dispute.created" : "refund.updated";
  const triggerKind = dispute ? "dispute" : "refund";
  const triggerId = dispute ? "dp_1" : "re_1";
  const readerKind = name === "stripe_dispute_won" ? "dispute_won"
    : name === "stripe_warning_closed" ? "warning_closed" : dispute ? "dispute_lost"
    : name === "stripe_refund_pending_requires_action_failed" ? "refund_pending_requires_action_failed"
    : name === "stripe_refund_requires_action_canceled" ? "refund_requires_action_canceled"
    : failed ? "refund_failed" : "refund";
  return { reader: stripeFixedTermReader(readerKind),
    initialWork: reconciliationWork({ provider: "stripe", providerResourceKind: "checkout_session",
      providerResourceId: "cs_1", eventType, providerEventId: "event-stripe-reversal", triggerKind, triggerId }),
    stickyContext: { eventType, providerEventId: "event-stripe-reversal", triggerKind, triggerId } };
}

function reconciliationWork(input: { readonly provider: "stripe" | "paypal";
  readonly providerResourceKind: string; readonly providerResourceId: string; readonly eventType: string;
  readonly providerEventId: string; readonly triggerKind: string; readonly triggerId: string }): BoundReconciliationWork {
  return { kind: "reconciliation", workId: "work-1", leaseEpoch: 1,
    leaseExpiresAt: "2026-08-31T00:02:00Z", rawToken: new Uint8Array(32), requestedGeneration: 1,
    provider: input.provider, providerResourceKind: input.providerResourceKind,
    providerResourceId: input.providerResourceId, purchaseKind: "fixed_term",
    expectedBindingDigest: new Uint8Array(32), expectedSlotEpoch: 1, expectedAgreementRevision: 1,
    expectedAuthorityRevision: 1, receiptEventType: input.eventType,
    receiptProviderEventId: input.providerEventId, receiptTriggerResourceKind: input.triggerKind,
    receiptTriggerResourceId: input.triggerId };
}

function stickyConvergencePersistence(initialWork: BoundReconciliationWork, maxGenerations: number) {
  const queue: BoundReconciliationWork[] = [initialWork];
  const applied: Array<{ readonly work: BoundReconciliationWork;
    readonly command: ApplyAgreementObservationCommand }> = [];
  const authorityHistory: Array<"non_granting" | "granting_allowed"> = [];
  const sticky = { eventType: initialWork.receiptEventType,
    providerEventId: initialWork.receiptProviderEventId,
    triggerResourceKind: initialWork.receiptTriggerResourceKind,
    triggerResourceId: initialWork.receiptTriggerResourceId };
  let latestReceipt = { eventType: initialWork.receiptEventType!,
    triggerResourceKind: initialWork.receiptTriggerResourceKind!,
    triggerResourceId: initialWork.receiptTriggerResourceId! };
  let exhausted = false;
  let headResolved = false;
  const failBoundWork = vi.fn();
  const repository = {
    leaseReconciliationWork: vi.fn(async () => queue.shift() ?? null),
    heartbeatBoundWork: vi.fn(), failBoundWork,
    applyAgreementObservationAndAuthority: vi.fn(async (_query: unknown, work: BoundReconciliationWork,
      command: ApplyAgreementObservationCommand) => {
      applied.push({ work, command });
      const pending = ["refund_pending", "dispute_pending", "fraud_signal"].includes(command.refundFact);
      const sameLineage = work.provider === initialWork.provider
        && work.receiptTriggerResourceKind === sticky.triggerResourceKind
        && work.receiptTriggerResourceId === sticky.triggerResourceId;
      if (!pending && sameLineage) {
        headResolved = true;
        authorityHistory.push(command.refundFact === "refund_failed" ? "granting_allowed" : "non_granting");
      } else if (pending && sameLineage) {
        authorityHistory.push("non_granting");
        if (work.requestedGeneration >= maxGenerations) exhausted = true;
        else queue.push({ ...work, workId: `work-${work.requestedGeneration + 1}`,
          requestedGeneration: work.requestedGeneration + 1,
          expectedAgreementRevision: work.expectedAgreementRevision + 1,
          expectedAuthorityRevision: work.expectedAuthorityRevision + 1,
          receiptEventType: sticky.eventType, receiptProviderEventId: sticky.providerEventId,
          receiptTriggerResourceKind: sticky.triggerResourceKind,
          receiptTriggerResourceId: sticky.triggerResourceId });
      } else authorityHistory.push("non_granting");
      return { disposition: "applied" as const, authorityRevision: work.expectedAuthorityRevision + 1,
        rightId: null };
    }),
  };
  return { repository, applied, authorityHistory, failBoundWork,
    insertUnrelatedReceipt(receipt: typeof latestReceipt) { latestReceipt = receipt; },
    insertUnrelatedReconciliation(work: BoundReconciliationWork) {
      queue.unshift({ ...work, workId: "work-unrelated" });
    },
    get latestReceipt() { return latestReceipt; }, get exhausted() { return exhausted; },
    get headResolved() { return headResolved; } };
}

function reconciliationService(repository: object, reader: CommercialProviderReader) {
  const other = reader.provider === "paypal"
    ? { provider: "stripe" as const, read: vi.fn() }
    : { provider: "paypal" as const, read: vi.fn() };
  return new PaymentWebhookReconciliationService({ query: vi.fn() } as never, repository as never,
    [reader, other], () => new Date("2026-08-31T00:01:00Z"));
}

function paypalFixedTermReader(getCapturedPayment: ReturnType<typeof vi.fn>) {
  return new PayPalCommercialProviderReader({ subscriptions: {}, plans: {}, orders: {
    getOrder: vi.fn(async () => ({ result: { id: "ORDER-1", status: "COMPLETED",
      createTime: "2026-08-31T00:00:00Z", purchaseUnits: [{ payments: { captures: [{ id: "CAPTURE-1" }] } }] } })),
  }, payments: { getCapturedPayment }, fixedTermPolicy: {
    plan: "commercial", featureEntitlements: [], offlineGraceSeconds: 1, credentialRefreshSeconds: 1,
  } } as never);
}

function paypalCapture(status: "COMPLETED" | "REFUNDED") {
  return { id: "CAPTURE-1", status, amount: { currencyCode: "USD", value: "9.80" },
    updateTime: "2026-08-31T00:00:02Z", supplementaryData: { relatedIds: { orderId: "ORDER-1" } } };
}

function stripeFixedTermReader(kind: "refund" | "refund_failed" | "refund_pending_requires_action_failed"
  | "refund_requires_action_canceled" | "dispute_lost" | "dispute_won" | "warning_closed") {
  let reversalRead = 0;
  const refundStatuses = kind === "refund" ? ["pending", "pending", "succeeded"]
    : kind === "refund_pending_requires_action_failed" ? ["pending", "requires_action", "failed"]
    : kind === "refund_requires_action_canceled" ? ["requires_action", "requires_action", "canceled"]
    : ["pending", "pending", "failed"];
  const sdk = {
    checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_1", mode: "payment", status: "complete",
      payment_status: "paid", payment_intent: "pi_1", amount_total: 980, currency: "usd",
      created: 1_788_134_400 })) } },
    paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" })) },
    charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1", paid: true, captured: true,
      amount: 980, amount_refunded: kind === "refund" && reversalRead >= 2 ? 980 : 0,
      currency: "usd", created: 1_788_134_400 })) },
    refunds: { retrieve: vi.fn(async () => ({ id: "re_1", payment_intent: "pi_1", charge: "ch_1",
      status: refundStatuses[reversalRead++],
      currency: "usd" })) },
    disputes: { retrieve: vi.fn(async () => ({ id: "dp_1", payment_intent: "pi_1", charge: "ch_1",
      status: reversalRead++ < 2 ? "needs_response" : kind === "dispute_won" ? "won"
        : kind === "warning_closed" ? "warning_closed" : "lost", reason: "fraudulent", amount: 980,
      currency: "usd" })) },
  };
  return new StripeCommercialProviderReader({ sdk, plans: {}, fixedTermPolicy: {
    plan: "commercial", featureEntitlements: [], offlineGraceSeconds: 1, credentialRefreshSeconds: 1,
  } } as never);
}

function stripeDisputeAndUnrelatedRefundReader(terminalStatus: "won" | "warning_closed") {
  let disputeRead = 0;
  return new StripeCommercialProviderReader({ sdk: {
    checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_1", mode: "payment", status: "complete",
      payment_status: "paid", payment_intent: "pi_1", amount_total: 980, currency: "usd",
      created: 1_788_134_400 })) } },
    paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" })) },
    charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1", paid: true, captured: true,
      amount: 980, amount_refunded: 0, currency: "usd", created: 1_788_134_400 })) },
    disputes: { retrieve: vi.fn(async () => ({ id: "dp_1", payment_intent: "pi_1", charge: "ch_1",
      status: disputeRead++ === 0 ? "needs_response" : terminalStatus, reason: "fraudulent", amount: 980,
      currency: "usd" })) },
    refunds: { retrieve: vi.fn(async () => ({ id: "re_unrelated", payment_intent: "pi_1", charge: "ch_1",
      status: "failed", currency: "usd" })) },
  }, plans: {}, fixedTermPolicy: {
    plan: "commercial", featureEntitlements: [], offlineGraceSeconds: 1, credentialRefreshSeconds: 1,
  } } as never);
}
