import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  PaymentWebhookAuthenticationError,
  PayPalCommercialProviderReader,
  PayPalPaymentWebhookAdapter,
  StripeCommercialProviderReader,
  StripePaymentWebhookAdapter,
} from "../src/modules/licensing/index";

describe("payment provider webhook authenticators", () => {
  it("authenticates Stripe raw bytes and emits a trigger without fetching the resource", async () => {
    const retrieve = vi.fn();
    const raw = Buffer.from('{ "id": "evt-1" }');
    const constructEvent = vi.fn(() => ({
      id: "evt_1",
      type: "customer.subscription.updated",
      created: 1_788_134_400,
      data: { object: { id: "sub_1", metadata: { gooddealer_account_id: "attacker-choice" } } },
    }));
    const adapter = new StripePaymentWebhookAdapter({
      sdk: { webhooks: { constructEvent }, subscriptions: { retrieve } } as never,
      webhookSecret: "whsec-fixture",
    });

    await expect(adapter.authenticate(raw, { "stripe-signature": "sig" }, new Date()))
      .resolves.toEqual({
        kind: "actionable",
        provider: "stripe",
        providerEventId: "evt_1",
        eventType: "customer.subscription.updated",
        triggerResourceKind: "subscription",
        triggerResourceId: "sub_1",
        occurredAt: "2026-08-31T00:00:00Z",
        authenticatedEvidenceRef: "stripe-event-evt_1",
      });
    expect(constructEvent).toHaveBeenCalledWith(raw, "sig", "whsec-fixture");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects missing or ambiguous Stripe signature headers", async () => {
    const adapter = new StripePaymentWebhookAdapter({
      sdk: { webhooks: { constructEvent: vi.fn() } } as never,
      webhookSecret: "whsec-fixture",
    });
    await expect(adapter.authenticate(Buffer.from("{}"), {}, new Date()))
      .rejects.toBeInstanceOf(PaymentWebhookAuthenticationError);
    await expect(adapter.authenticate(Buffer.from("{}"), { "stripe-signature": ["a", "b"] }, new Date()))
      .rejects.toBeInstanceOf(PaymentWebhookAuthenticationError);
  });

  it.each([
    ["payment_intent.succeeded", "payment_intent", "pi_1"],
    ["charge.succeeded", "charge", "ch_1"],
    ["charge.refunded", "charge", "ch_1"],
    ["charge.dispute.created", "dispute", "dp_1"],
    ["refund.updated", "refund", "re_1"],
  ] as const)("authenticates Stripe %s as exact %s provider evidence", async (eventType, resourceKind, resourceId) => {
    const constructEvent = vi.fn(() => ({ id: `evt_${resourceId}`, type: eventType, created: 1_788_134_400,
      data: { object: { id: resourceId, metadata: { gooddealer_account_id: "spoofed-account" } } } }));
    const adapter = new StripePaymentWebhookAdapter({
      sdk: { webhooks: { constructEvent } } as never,
      webhookSecret: "whsec-fixture",
    });

    await expect(adapter.authenticate(Buffer.from("{}"), { "stripe-signature": "sig" }, new Date()))
      .resolves.toMatchObject({ kind: "actionable", provider: "stripe", eventType,
        triggerResourceKind: resourceKind, triggerResourceId: resourceId });
  });

  it.each(["invoice.paid", "invoice.payment_succeeded"] as const)(
    "authenticates an initial Stripe %s event but ignores renewal invoices",
    async (eventType) => {
      let billingReason = "subscription_create";
      const constructEvent = vi.fn(() => ({ id: `evt_${billingReason}`,
        type: eventType, created: 1_788_134_400,
        data: { object: { id: "in_1", billing_reason: billingReason } } }));
      const adapter = new StripePaymentWebhookAdapter({
        sdk: { webhooks: { constructEvent } } as never,
        webhookSecret: "whsec-fixture",
      });

      await expect(adapter.authenticate(Buffer.from("{}"), { "stripe-signature": "sig" }, new Date()))
        .resolves.toMatchObject({ kind: "actionable", eventType,
          triggerResourceKind: "invoice", triggerResourceId: "in_1" });
      billingReason = "subscription_cycle";
      await expect(adapter.authenticate(Buffer.from("{}"), { "stripe-signature": "sig" }, new Date()))
        .resolves.toMatchObject({ kind: "ignored", eventType, ignoredReason: "unrelated_object" });
    },
  );

  it("rejects ambiguous PayPal headers and malformed transmission time before certificate I/O", async () => {
    const resolve = vi.fn();
    const adapter = new PayPalPaymentWebhookAdapter({
      webhookId: "webhook-1",
      certificates: { resolve },
    });
    const base = {
      "paypal-transmission-id": "transmission-1",
      "paypal-transmission-time": "not-a-time",
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/cert-1",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "signature",
    };
    await expect(adapter.authenticate(Buffer.from("{}"), base, new Date("2026-08-31T00:00:00Z")))
      .rejects.toBeInstanceOf(PaymentWebhookAuthenticationError);
    await expect(adapter.authenticate(Buffer.from("{}"), {
      ...base,
      "paypal-transmission-id": ["a", "b"],
    }, new Date("2026-08-31T00:00:00Z"))).rejects.toBeInstanceOf(PaymentWebhookAuthenticationError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("authenticates PayPal capture refund evidence without trusting custom account metadata", async () => {
    const raw = Buffer.from(JSON.stringify({ id: "WH-REFUND-1", event_type: "PAYMENT.CAPTURE.REFUNDED",
      create_time: "2026-08-31T00:00:00Z", resource: { id: "REFUND-1", custom_id: "spoofed-account",
        supplementary_data: { related_ids: { capture_id: "CAPTURE-1" } } } }));
    const fixture = paypalSignatureFixture(raw, "2026-08-31T00:00:00Z");
    const adapter = new PayPalPaymentWebhookAdapter({ webhookId: "webhook-1",
      certificates: { resolve: vi.fn(async () => fixture.publicKey) } });

    await expect(adapter.authenticate(raw, fixture.headers, new Date("2026-08-31T00:00:30Z")))
      .resolves.toMatchObject({ kind: "actionable", provider: "paypal", eventType: "PAYMENT.CAPTURE.REFUNDED",
        triggerResourceKind: "capture", triggerResourceId: "CAPTURE-1" });
  });

  it("rejects a signed PayPal refund without exact Capture evidence", async () => {
    const raw = Buffer.from(JSON.stringify({ id: "WH-REFUND-2", event_type: "PAYMENT.CAPTURE.REFUNDED",
      create_time: "2026-08-31T00:00:00Z", resource: { id: "REFUND-2", supplementary_data: { related_ids: {} } } }));
    const fixture = paypalSignatureFixture(raw, "2026-08-31T00:00:00Z");
    const adapter = new PayPalPaymentWebhookAdapter({ webhookId: "webhook-1",
      certificates: { resolve: vi.fn(async () => fixture.publicKey) } });

    await expect(adapter.authenticate(raw, fixture.headers, new Date("2026-08-31T00:00:30Z")))
      .rejects.toThrow(/no resource identity/u);
  });

  it("recovers a PayPal fixed-term handoff from one exact completed Order and Capture", async () => {
    const getOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1",
      status: "COMPLETED",
      purchaseUnits: [{ payments: { captures: [{
        id: "CAPTURE-1",
        status: "COMPLETED",
        updateTime: "2026-08-31T00:00:02Z",
      }] } }],
    } }));
    const reader = new PayPalCommercialProviderReader({
      subscriptions: { getSubscription: vi.fn() },
      orders: { getOrder },
      plans: {},
      fixedTermPolicy: {},
    } as never);

    await expect(reader.handoffForReceipt?.({
      kind: "receipt",
      workId: "work-1",
      leaseEpoch: 1,
      leaseExpiresAt: "2026-08-31T00:01:00Z",
      rawToken: new Uint8Array(32),
      provider: "paypal",
      providerEventId: "event-1",
      payloadDigest: new Uint8Array(32),
      receiptKind: "actionable",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      triggerResourceKind: "order",
      triggerResourceId: "ORDER-1",
      occurredAt: "2026-08-31T00:00:03Z",
      authenticatedEvidenceRef: "paypal-event-event-1",
    }, new Date("2026-08-31T00:00:04Z"))).resolves.toMatchObject({
      handoff: {
        kind: "paypal_fixed_term",
        order: { resourceKind: "order", resourceId: "ORDER-1", role: "order_origin" },
        capture: { resourceKind: "capture", resourceId: "CAPTURE-1", role: "capture_evidence" },
        capturedAt: "2026-08-31T00:00:02Z",
      },
    });
    expect(getOrder).toHaveBeenCalledWith({ id: "ORDER-1" });
  });

  it("rejects ambiguous Capture evidence during PayPal fixed-term handoff recovery", async () => {
    const reader = new PayPalCommercialProviderReader({
      subscriptions: { getSubscription: vi.fn() },
      orders: { getOrder: vi.fn(async () => ({ result: {
        id: "ORDER-1",
        status: "COMPLETED",
        purchaseUnits: [{ payments: { captures: [{ id: "CAPTURE-1" }, { id: "CAPTURE-2" }] } }],
      } })) },
      plans: {},
      fixedTermPolicy: {},
    } as never);

    await expect(reader.handoffForReceipt?.({
      kind: "receipt",
      workId: "work-1",
      leaseEpoch: 1,
      leaseExpiresAt: "2026-08-31T00:01:00Z",
      rawToken: new Uint8Array(32),
      provider: "paypal",
      providerEventId: "event-1",
      payloadDigest: new Uint8Array(32),
      receiptKind: "actionable",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      triggerResourceKind: "order",
      triggerResourceId: "ORDER-1",
      occurredAt: "2026-08-31T00:00:03Z",
      authenticatedEvidenceRef: "paypal-event-event-1",
    }, new Date("2026-08-31T00:00:04Z"))).rejects.toThrow(/unique completed Capture/u);
  });

  it("compares recovered PayPal capture bindings with the confirmed operation replay", async () => {
    const reader = new PayPalCommercialProviderReader({ subscriptions: { getSubscription: vi.fn() },
      orders: { getOrder: vi.fn(async () => ({ result: { id: "ORDER-1", status: "COMPLETED",
        purchaseUnits: [{ payments: { captures: [{ id: "CAPTURE-1", status: "COMPLETED",
          updateTime: "2026-08-31T00:00:02Z" }] } }] } })) }, plans: {}, fixedTermPolicy: {} } as never);
    const binding = (resourceKind: string, resourceId: string) => createHash("sha256").update(JSON.stringify({
      provider: "paypal", resourceKind, resourceId,
    })).digest();
    const operation = { kind: "provider_operation" as const, workId: "work-1", leaseEpoch: 2,
      leaseExpiresAt: "2026-08-31T00:01:00Z", rawToken: new Uint8Array(32), purchaseAttemptId: "attempt-1",
      purchaseKind: "fixed_term" as const, offer: "ten_year" as const, providerCatalogItem: "fixed-plan",
      campaignCode: null, provider: "paypal" as const, providerOperationId: "operation-2", operationRevision: 4,
      operationKind: "fixed_term_order_capture" as const, providerIdempotencyKey: "stable-key",
      requestDigest: new Uint8Array(32), providerResourceKind: "order", providerResourceId: "ORDER-1" };
    const resources = [
      { resourceKind: "order", resourceId: "ORDER-1", role: "target" as const,
        bindingDigest: binding("order", "ORDER-1") },
      { resourceKind: "capture", resourceId: "CAPTURE-1", role: "created" as const,
        bindingDigest: binding("capture", "CAPTURE-1") },
    ];

    await expect(reader.handoffForOperation?.(operation, resources, new Date()))
      .resolves.toMatchObject({ handoff: { kind: "paypal_fixed_term", capturedAt: "2026-08-31T00:00:02Z" } });
    await expect(reader.handoffForOperation?.(operation, [resources[0]!, {
      ...resources[1]!, bindingDigest: new Uint8Array(32),
    }], new Date())).rejects.toThrow(/binding conflicts/u);
  });

  it("resolves a Stripe Refund through the exact PaymentIntent to one immutable Checkout anchor", async () => {
    const reader = stripeReader({
      refunds: { retrieve: vi.fn(async () => ({ id: "re_1", payment_intent: "pi_1", charge: "ch_1" })) },
      charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1" })) },
      checkout: { sessions: { list: vi.fn(async () => ({ data: [{ id: "cs_1", mode: "payment", status: "complete",
        payment_status: "paid", payment_intent: "pi_1" }] })) } },
      invoicePayments: { list: vi.fn(async () => ({ data: [] })) },
    });

    await expect(reader.resolveReceiptResourceBinding?.(receiptWork("stripe", "refund", "re_1"), new Date()))
      .resolves.toMatchObject({ anchorResourceKind: "checkout_session", anchorResourceId: "cs_1" });
  });

  it("rejects an ambiguous Stripe reversal chain instead of choosing a tenant anchor", async () => {
    const reader = stripeReader({
      refunds: { retrieve: vi.fn(async () => ({ id: "re_1", payment_intent: "pi_1", charge: null })) },
      checkout: { sessions: { list: vi.fn(async () => ({ data: [{ id: "cs_1", mode: "payment", status: "complete",
        payment_status: "paid", payment_intent: "pi_1" }] })) } },
      invoicePayments: { list: vi.fn(async () => ({ data: [{ id: "ip_1", status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_1" }, invoice: "in_1" }] })) },
      invoices: { retrieve: vi.fn(async () => ({ id: "in_1", billing_reason: "subscription_create",
        parent: { type: "subscription_details",
        subscription_details: { subscription: "sub_1" } } })) },
    });

    await expect(reader.resolveReceiptResourceBinding?.(receiptWork("stripe", "refund", "re_1"), new Date()))
      .rejects.toThrow(/no unique immutable agreement anchor/u);
  });

  it("does not use a Stripe renewal PaymentIntent to establish the acquisition anchor", async () => {
    const reader = stripeReader({
      paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_renewal" })) },
      checkout: { sessions: { list: vi.fn(async () => ({ data: [] })) } },
      invoicePayments: { list: vi.fn(async () => ({ data: [{ id: "ip_renewal", status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_renewal" }, invoice: "in_renewal" }] })) },
      invoices: { retrieve: vi.fn(async () => ({ id: "in_renewal", billing_reason: "subscription_cycle",
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } } })) },
    });

    await expect(reader.resolveReceiptResourceBinding?.(
      receiptWork("stripe", "payment_intent", "pi_renewal"), new Date(),
    )).rejects.toThrow(/no unique immutable agreement anchor/u);
  });

  it("resolves a canonical Stripe Subscription receipt to its exact initial payment chain", async () => {
    const reader = stripeReader({
      subscriptions: { retrieve: vi.fn(async () => ({ id: "sub_1" })) },
      invoices: { list: vi.fn(async () => ({ has_more: false, data: [{ id: "in_1",
        billing_reason: "subscription_create", status: "paid", amount_paid: 980, currency: "usd" }] })) },
      invoicePayments: { list: vi.fn(async () => ({ data: [{ status: "paid", amount_paid: 980, currency: "usd",
        payment: { type: "payment_intent", payment_intent: "pi_1" }, status_transitions: { paid_at: 1_788_134_400 } }] })) },
      paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" })) },
      charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1", paid: true, captured: true,
        amount: 980, amount_refunded: 0, currency: "usd", created: 1_788_134_400 })) },
    });
    const work = { ...receiptWork("stripe", "subscription", "sub_1"),
      eventType: "customer.subscription.updated" };

    await expect(reader.resolveReceiptResourceBinding?.(work, new Date("2026-08-31T00:01:00Z")))
      .resolves.toMatchObject({ anchorResourceKind: "subscription", anchorResourceId: "sub_1", resources: [
        { resourceKind: "invoice", resourceId: "in_1", linkRole: "initial_payment" },
        { resourceKind: "payment_intent", resourceId: "pi_1", linkRole: "initial_payment" },
        { resourceKind: "charge", resourceId: "ch_1", linkRole: "initial_payment" },
      ] });
  });

  it("rejects a Stripe renewal invoice instead of linking it as initial payment", async () => {
    const reader = stripeReader({
      invoices: { retrieve: vi.fn(async () => ({ id: "in_renewal", billing_reason: "subscription_cycle",
        status: "paid", amount_paid: 980, currency: "usd", parent: { type: "subscription_details",
          subscription_details: { subscription: "sub_1" } } })) },
    });
    const work = { ...receiptWork("stripe", "invoice", "in_renewal"), eventType: "invoice.paid" };

    await expect(reader.resolveReceiptResourceBinding?.(work, new Date()))
      .rejects.toThrow(/not an initial settled subscription Invoice/u);
  });

  it("resolves PayPal reversal evidence only through the exact Capture read", async () => {
    const getCapturedPayment = vi.fn(async () => ({ result: { id: "CAPTURE-1", customId: "spoofed-account",
      supplementaryData: { relatedIds: { orderId: "ORDER-1" } } } }));
    const reader = new PayPalCommercialProviderReader({ subscriptions: {}, orders: {}, payments: { getCapturedPayment },
      plans: {}, fixedTermPolicy: {} } as never);

    await expect(reader.resolveReceiptResourceBinding?.(receiptWork("paypal", "capture", "CAPTURE-1"), new Date()))
      .resolves.toMatchObject({ anchorResourceKind: "capture", anchorResourceId: "CAPTURE-1",
        resources: [{ resourceKind: "capture", resourceId: "CAPTURE-1", linkRole: "capture_evidence" }] });
    expect(getCapturedPayment).toHaveBeenCalledWith({ captureId: "CAPTURE-1" });
  });

  it("links a subscription Capture refund as independent evidence anchored to its initial transaction", async () => {
    const reader = new PayPalCommercialProviderReader({ subscriptions: {}, orders: {}, payments: {
      getCapturedPayment: vi.fn(async () => ({ result: { id: "TXN-1", status: "REFUNDED" } })),
    }, plans: {}, fixedTermPolicy: {} } as never);
    const work = { ...receiptWork("paypal", "capture", "TXN-1"), eventType: "PAYMENT.CAPTURE.REFUNDED" };

    await expect(reader.resolveReceiptResourceBinding?.(work, new Date())).resolves.toMatchObject({
      anchorResourceKind: "subscription_transaction", anchorResourceId: "TXN-1",
      resources: [{ resourceKind: "capture", resourceId: "TXN-1", linkRole: "refund_evidence" }],
    });
  });

  it("reuses a Stripe Charge refund trigger as its immutable initial-payment link", async () => {
    const reader = stripeReader({
      charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1" })) },
      checkout: { sessions: { list: vi.fn(async () => ({ data: [{ id: "cs_1", mode: "payment",
        status: "complete", payment_status: "paid", payment_intent: "pi_1" }] })) } },
      invoicePayments: { list: vi.fn(async () => ({ data: [] })) },
    });
    const work = { ...receiptWork("stripe", "charge", "ch_1"), eventType: "charge.refunded" };

    const resolved = await reader.resolveReceiptResourceBinding?.(work, new Date());
    expect(resolved).toMatchObject({ anchorResourceKind: "checkout_session", anchorResourceId: "cs_1" });
    expect(resolved?.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceKind: "charge", resourceId: "ch_1", linkRole: "initial_payment" }),
    ]));
  });

  it("resolves an established PayPal Subscription receipt to its initial transaction", async () => {
    const getSubscription = vi.fn(async () => ({ result: { id: "I-SUB-1", startTime: "2026-08-01T00:00:00Z" } }));
    const listSubscriptionTransactions = vi.fn(async () => ({ result: { totalPages: 1, totalItems: 1,
      transactions: [{ id: "TXN-1", status: "COMPLETED", time: "2026-08-01T00:00:02Z",
        amountWithBreakdown: { grossAmount: { currencyCode: "USD", value: "9.80" } } }] } }));
    const reader = new PayPalCommercialProviderReader({ subscriptions: { getSubscription, listSubscriptionTransactions },
      orders: {}, payments: {}, plans: {}, fixedTermPolicy: {} } as never);
    const work = { ...receiptWork("paypal", "subscription", "I-SUB-1"),
      eventType: "BILLING.SUBSCRIPTION.UPDATED" };

    await expect(reader.handoffForReceipt?.(work, new Date("2026-08-01T00:01:00Z"))).resolves.toBeNull();
    await expect(reader.resolveReceiptResourceBinding?.(work, new Date("2026-08-01T00:01:00Z")))
      .resolves.toMatchObject({ anchorResourceKind: "subscription", anchorResourceId: "I-SUB-1", resources: [
        { resourceKind: "subscription_transaction", resourceId: "TXN-1", linkRole: "initial_payment" },
      ] });
    expect(getSubscription).toHaveBeenCalledWith({ id: "I-SUB-1" });
  });

  it("fails closed when the earliest PayPal Subscription transaction is partially refunded", async () => {
    const reader = new PayPalCommercialProviderReader({ subscriptions: {
      getSubscription: vi.fn(async () => ({ result: { id: "I-SUB-1", planId: "P-PLAN-1", status: "ACTIVE",
        startTime: "2026-08-01T00:00:00Z", billingInfo: { nextBillingTime: "2026-09-01T00:00:00Z" } } })),
      listSubscriptionTransactions: vi.fn(async () => ({ result: { totalPages: 1, totalItems: 2,
        transactions: [
          { id: "INITIAL-1", status: "PARTIALLY_REFUNDED", time: "2026-08-01T00:00:02Z",
            amountWithBreakdown: { grossAmount: { currencyCode: "USD", value: "9.80" } } },
          { id: "RENEWAL-1", status: "COMPLETED", time: "2026-08-15T00:00:02Z",
            amountWithBreakdown: { grossAmount: { currencyCode: "USD", value: "9.80" } } },
        ] } })),
    }, orders: {}, payments: {}, plans: {
      authority: vi.fn(() => ({ plan: "commercial", featureEntitlements: [] })),
    }, fixedTermPolicy: {} } as never);

    await expect(reader.read({ providerResourceKind: "subscription", providerResourceId: "I-SUB-1",
      purchaseKind: "subscription", evaluatedAt: new Date("2026-08-20T00:00:00Z"), receiptEventType: null,
      receiptProviderEventId: null, receiptTriggerResourceKind: null, receiptTriggerResourceId: null,
    })).rejects.toThrow(/partial refund amount is unverifiable/u);
  });

  it("does not treat a later PayPal renewal as the initial payment after an earliest partial refund", async () => {
    const listSubscriptionTransactions = vi.fn(async () => ({ result: { totalPages: 1, totalItems: 2,
      transactions: [
        { id: "INITIAL-1", status: "PARTIALLY_REFUNDED", time: "2026-08-01T00:00:02Z",
          amountWithBreakdown: { grossAmount: { currencyCode: "USD", value: "9.80" } } },
        { id: "RENEWAL-1", status: "COMPLETED", time: "2026-08-15T00:00:02Z",
          amountWithBreakdown: { grossAmount: { currencyCode: "USD", value: "9.80" } } },
      ] } }));
    const reader = new PayPalCommercialProviderReader({ subscriptions: {
      getSubscription: vi.fn(async () => ({ result: { id: "I-SUB-1", startTime: "2026-08-01T00:00:00Z" } })),
      listSubscriptionTransactions,
    }, orders: {}, payments: {}, plans: {}, fixedTermPolicy: {} } as never);

    await expect(reader.handoffForReceipt?.({
      kind: "receipt", workId: "work-1", leaseEpoch: 1, leaseExpiresAt: "2026-08-20T00:01:00Z",
      rawToken: new Uint8Array(32), provider: "paypal", providerEventId: "event-1",
      payloadDigest: new Uint8Array(32), receiptKind: "actionable", eventType: "BILLING.SUBSCRIPTION.ACTIVATED",
      triggerResourceKind: "subscription", triggerResourceId: "I-SUB-1", occurredAt: "2026-08-01T00:00:03Z",
      authenticatedEvidenceRef: "paypal-event-event-1",
    }, new Date("2026-08-20T00:00:00Z"))).rejects.toThrow(/partial refund amount is unverifiable/u);
    expect(listSubscriptionTransactions).toHaveBeenCalledTimes(1);
  });

  it("normalizes only an exact full Stripe Refund as a fixed-term reversal", async () => {
    const charge = { id: "ch_1", payment_intent: "pi_1", paid: true, captured: true, amount: 980,
      amount_refunded: 980, currency: "usd", created: 1_788_134_400 };
    const reader = stripeReader({
      checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_1", mode: "payment", status: "complete",
        payment_status: "paid", payment_intent: "pi_1", amount_total: 980, currency: "usd", created: 1_788_134_400 })) } },
      paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" })) },
      charges: { retrieve: vi.fn(async () => charge) },
      refunds: { retrieve: vi.fn(async () => ({ id: "re_1", payment_intent: "pi_1", charge: "ch_1",
        status: "succeeded", currency: "usd" })) },
    });

    await expect(reader.read(reconciliationInput("refund", "re_1", "refund.updated")))
      .resolves.toMatchObject({ reversal: "refund", refundFact: "refund_succeeded", providerAccess: "refunded",
        paymentEvidence: { resourceKind: "charge", resourceId: "ch_1", grossMinor: 980,
          cumulativeRefundedMinor: 980, currency: "USD" } });
  });

  it("hands off Stripe fixed-term initial payment bindings using provider settlement time", async () => {
    const reader = stripeReader({
      checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_1", mode: "payment", status: "complete",
        payment_status: "paid", payment_intent: "pi_1", amount_total: 980, currency: "usd" })) } },
      paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" })) },
      charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1", paid: true, captured: true,
        amount: 980, currency: "usd", created: 1_788_134_400 })) },
    });
    const work = { ...receiptWork("stripe", "checkout_session", "cs_1"), eventType: "checkout.session.completed",
      occurredAt: "2026-08-31T00:00:30Z" };

    await expect(reader.handoffForReceipt?.(work, new Date("2026-08-31T00:01:00Z"))).resolves.toMatchObject({
      paymentResources: [{ resourceKind: "payment_intent", resourceId: "pi_1" },
        { resourceKind: "charge", resourceId: "ch_1" }],
      handoff: { kind: "stripe_fixed_term", capturedAt: "2026-08-31T00:00:00Z" },
    });
  });

  it("keeps a partial PayPal Capture refund non-releasing", async () => {
    const reader = new PayPalCommercialProviderReader({ subscriptions: {}, plans: {}, orders: {
      getOrder: vi.fn(async () => ({ result: { id: "ORDER-1", status: "COMPLETED", createTime: "2026-08-31T00:00:00Z",
        purchaseUnits: [{ payments: { captures: [{ id: "CAPTURE-1" }] } }] } })) },
      payments: { getCapturedPayment: vi.fn(async () => ({ result: { id: "CAPTURE-1", status: "PARTIALLY_REFUNDED",
        amount: { currencyCode: "USD", value: "9.80" }, updateTime: "2026-08-31T00:00:02Z",
        supplementaryData: { relatedIds: { orderId: "ORDER-1" } } } })) }, fixedTermPolicy: {
        plan: "commercial", featureEntitlements: [], offlineGraceSeconds: 1, credentialRefreshSeconds: 1,
      } } as never);

    await expect(reader.read({ providerResourceKind: "order", providerResourceId: "ORDER-1", purchaseKind: "fixed_term",
      evaluatedAt: new Date("2026-08-31T00:00:05Z"), receiptEventType: "PAYMENT.CAPTURE.REFUNDED",
      receiptProviderEventId: "event-1", receiptTriggerResourceKind: "capture", receiptTriggerResourceId: "CAPTURE-1" }))
      .resolves.toMatchObject({ reversal: "none", refundFact: "partial_refund", providerAccess: "active",
        paymentEvidence: { cumulativeRefundedMinor: 0 } });
  });

  it.each([
    ["subscription", "PAYMENT.CAPTURE.REFUNDED", "refund_pending"],
    ["subscription", "PAYMENT.CAPTURE.REVERSED", "fraud_signal"],
    ["fixed_term", "PAYMENT.CAPTURE.REFUNDED", "refund_pending"],
    ["fixed_term", "PAYMENT.CAPTURE.REVERSED", "fraud_signal"],
  ] as const)("keeps authenticated PayPal %s %s blocking while the exact payment still reads COMPLETED",
    async (purchaseKind, eventType, refundFact) => {
      const reader = paypalReconciliationReader("COMPLETED");
      await expect(reader.read(paypalReconciliationInput(purchaseKind, eventType))).resolves.toMatchObject({
        reversal: "none", refundFact, paymentEvidence: { resourceId: "CAPTURE-1", cumulativeRefundedMinor: 0 },
      });
    });

  it.each([
    ["subscription", "PAYMENT.CAPTURE.REFUNDED", "refund", "refund_succeeded"],
    ["subscription", "PAYMENT.CAPTURE.REVERSED", "fraud", "full_reversal_settled"],
    ["fixed_term", "PAYMENT.CAPTURE.REFUNDED", "refund", "refund_succeeded"],
    ["fixed_term", "PAYMENT.CAPTURE.REVERSED", "fraud", "full_reversal_settled"],
  ] as const)(
    "converges a PayPal %s %s payment to exact full settled reversal truth",
    async (purchaseKind, eventType, reversal, refundFact) => {
      const reader = paypalReconciliationReader("REFUNDED");
      await expect(reader.read(paypalReconciliationInput(purchaseKind, eventType)))
        .resolves.toMatchObject({ reversal, refundFact, providerAccess: "refunded",
          paymentEvidence: { resourceId: "CAPTURE-1", grossMinor: 980, cumulativeRefundedMinor: 980 } });
    },
  );

  it.each(["won", "warning_closed"] as const)(
    "normalizes an exact terminal Stripe Dispute %s as a resolved reversal failure instead of none",
    async (status) => {
      const reader = stripeDisputeReader(status);
      await expect(reader.read(reconciliationInput("dispute", "dp_1", "charge.dispute.updated")))
        .resolves.toMatchObject({ reversal: "none", refundFact: "refund_failed", providerAccess: "active",
          paymentEvidence: { resourceId: "ch_1", cumulativeRefundedMinor: 0 } });
    },
  );

  it("fails closed on an unrecognized Stripe Dispute state", async () => {
    const reader = stripeDisputeReader("future_unknown_state");
    await expect(reader.read(reconciliationInput("dispute", "dp_1", "charge.dispute.updated")))
      .rejects.toThrow("Stripe Dispute status is invalid");
  });

  it("settles an exact full lost Stripe Dispute independently of refund cumulative", async () => {
    await expect(stripeDisputeReader("lost", 980)
      .read(reconciliationInput("dispute", "dp_1", "charge.dispute.closed")))
      .resolves.toMatchObject({ reversal: "fraud", refundFact: "full_reversal_settled",
        paymentEvidence: { grossMinor: 980, cumulativeRefundedMinor: 0 } });
  });

  it("does not promote a partial lost Stripe Dispute to a full settled reversal", async () => {
    await expect(stripeDisputeReader("lost", 400)
      .read(reconciliationInput("dispute", "dp_1", "charge.dispute.closed")))
      .resolves.toMatchObject({ reversal: "none", refundFact: "partial_reversal",
        paymentEvidence: { grossMinor: 980, cumulativeRefundedMinor: 0 } });
  });

  it.each(["pending", "requires_action"] as const)(
    "keeps an exact Stripe Refund %s state blocking",
    async (status) => {
      await expect(stripeRefundReader(status).read(reconciliationInput("refund", "re_1", "refund.updated")))
        .resolves.toMatchObject({ reversal: "none", refundFact: "refund_pending", providerAccess: "active" });
    },
  );

  it.each(["failed", "canceled"] as const)(
    "normalizes an exact terminal Stripe Refund %s state as a resolved refund failure",
    async (status) => {
      await expect(stripeRefundReader(status).read(reconciliationInput("refund", "re_1", "refund.updated")))
        .resolves.toMatchObject({ reversal: "none", refundFact: "refund_failed", providerAccess: "active" });
    },
  );

  it.each([null, "future_unknown_state"] as const)("fails closed on Stripe Refund status %s", async (status) => {
    await expect(stripeRefundReader(status).read(reconciliationInput("refund", "re_1", "refund.updated")))
      .rejects.toThrow("Stripe Refund status is invalid");
  });
});

function stripeReader(sdk: Record<string, unknown>) {
  return new StripeCommercialProviderReader({ sdk: { subscriptions: {}, disputes: {}, charges: {}, refunds: {},
    paymentIntents: {}, checkout: {}, invoicePayments: {}, invoices: {}, ...sdk }, plans: {}, fixedTermPolicy: {
    plan: "commercial", featureEntitlements: [], offlineGraceSeconds: 1, credentialRefreshSeconds: 1,
  } } as never);
}

function stripeDisputeReader(status: string, amount = 980) {
  return stripeReader({
    checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_1", mode: "payment", status: "complete",
      payment_status: "paid", payment_intent: "pi_1", amount_total: 980, currency: "usd",
      created: 1_788_134_400 })) } },
    paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" })) },
    charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1", paid: true, captured: true,
      amount: 980, amount_refunded: 0, currency: "usd", created: 1_788_134_400 })) },
    disputes: { retrieve: vi.fn(async () => ({ id: "dp_1", payment_intent: "pi_1", charge: "ch_1",
      status, reason: "fraudulent", amount, currency: "usd" })) },
  });
}

function stripeRefundReader(status: string | null) {
  return stripeReader({
    checkout: { sessions: { retrieve: vi.fn(async () => ({ id: "cs_1", mode: "payment", status: "complete",
      payment_status: "paid", payment_intent: "pi_1", amount_total: 980, currency: "usd",
      created: 1_788_134_400 })) } },
    paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" })) },
    charges: { retrieve: vi.fn(async () => ({ id: "ch_1", payment_intent: "pi_1", paid: true, captured: true,
      amount: 980, amount_refunded: 0, currency: "usd", created: 1_788_134_400 })) },
    refunds: { retrieve: vi.fn(async () => ({ id: "re_1", payment_intent: "pi_1", charge: "ch_1",
      status, currency: "usd" })) },
  });
}

function receiptWork(provider: "stripe" | "paypal", triggerResourceKind: string, triggerResourceId: string) {
  return { kind: "receipt" as const, workId: "work-reversal", leaseEpoch: 1,
    leaseExpiresAt: "2026-08-31T00:01:00Z", rawToken: new Uint8Array(32), provider,
    providerEventId: "event-reversal", payloadDigest: new Uint8Array(32), receiptKind: "actionable" as const,
    eventType: provider === "stripe" ? "refund.updated" : "PAYMENT.CAPTURE.REFUNDED",
    triggerResourceKind, triggerResourceId, occurredAt: "2026-08-31T00:00:00Z",
    authenticatedEvidenceRef: `${provider}-event-event-reversal` };
}

function reconciliationInput(receiptTriggerResourceKind: string, receiptTriggerResourceId: string,
  receiptEventType: string) {
  return { providerResourceKind: "checkout_session", providerResourceId: "cs_1", purchaseKind: "fixed_term" as const,
    evaluatedAt: new Date("2026-08-31T00:00:05Z"), receiptEventType, receiptProviderEventId: "event-1",
    receiptTriggerResourceKind, receiptTriggerResourceId };
}

function paypalReconciliationReader(paymentStatus: "COMPLETED" | "REFUNDED") {
  return new PayPalCommercialProviderReader({ subscriptions: {
    getSubscription: vi.fn(async () => ({ result: { id: "I-SUB-1", planId: "P-PLAN-1", status: "ACTIVE",
      startTime: "2026-08-01T00:00:00Z", billingInfo: { nextBillingTime: "2026-09-01T00:00:00Z" } } })),
    listSubscriptionTransactions: vi.fn(async () => ({ result: { totalPages: 1, totalItems: 1,
      transactions: [{ id: "CAPTURE-1", status: paymentStatus, time: "2026-08-01T00:00:02Z",
        amountWithBreakdown: { grossAmount: { currencyCode: "USD", value: "9.80" } } }] } })),
  }, orders: { getOrder: vi.fn(async () => ({ result: { id: "ORDER-1", status: "COMPLETED",
    createTime: "2026-08-01T00:00:00Z", purchaseUnits: [{ payments: { captures: [{ id: "CAPTURE-1" }] } }] } })) },
  payments: { getCapturedPayment: vi.fn(async () => ({ result: { id: "CAPTURE-1", status: paymentStatus,
    amount: { currencyCode: "USD", value: "9.80" }, updateTime: "2026-08-01T00:00:02Z",
    supplementaryData: { relatedIds: { orderId: "ORDER-1" } } } })) },
  plans: { authority: vi.fn(() => ({ plan: "commercial", featureEntitlements: [] })) }, fixedTermPolicy: {
    plan: "commercial", featureEntitlements: [], offlineGraceSeconds: 1, credentialRefreshSeconds: 1,
  } } as never);
}

function paypalReconciliationInput(purchaseKind: "subscription" | "fixed_term", receiptEventType: string) {
  return { providerResourceKind: purchaseKind === "subscription" ? "subscription" : "order",
    providerResourceId: purchaseKind === "subscription" ? "I-SUB-1" : "ORDER-1", purchaseKind,
    evaluatedAt: new Date("2026-08-01T00:01:00Z"), receiptEventType, receiptProviderEventId: "event-1",
    receiptTriggerResourceKind: "capture", receiptTriggerResourceId: "CAPTURE-1" };
}

function paypalSignatureFixture(raw: Buffer, transmissionTime: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const transmissionId = "transmission-1";
  const message = `${transmissionId}|${transmissionTime}|webhook-1|${crc32(raw)}`;
  return { publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), headers: {
    "paypal-transmission-id": transmissionId,
    "paypal-transmission-time": transmissionTime,
    "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/cert-1",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-transmission-sig": sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64"),
  } };
}

function crc32(value: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
