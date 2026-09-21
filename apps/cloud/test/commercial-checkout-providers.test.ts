import { describe, expect, it, vi } from "vitest";
import { ProviderDispatchExecutor } from "../src/modules/licensing/provider-dispatch-executor";
import type { CommercialProviderMutationGateway, ProviderSdkAuthorization } from "../src/modules/licensing/provider-dispatch-executor";
import { PayPalCommercialCheckoutGateway, StripeCommercialCheckoutGateway,
  type PayPalCommercialSdk } from "../src/modules/licensing/providers/commercial-checkout";

const urls = { successUrl: "https://account.gooddealer.com/billing/success",
  cancelUrl: "https://account.gooddealer.com/billing/cancel" };

describe("commercial provider command gateways", () => {
  it("reaches Stripe only through executor custody and uses the stable idempotency identity", async () => {
    const create = vi.fn(async () => ({ id: "cs_1", mode: "subscription", status: "open",
      url: "https://checkout.stripe.com/c/pay", client_reference_id: "checkout-1",
      amount_total: 980, currency: "usd", metadata: { gooddealer_purchase_attempt_id: "checkout-1" } }));
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { create } }, subscriptions: {} } as never, urls);
    const gatewayCreate = stripe.create.bind(stripe);
    let consumedAuthorization: ProviderSdkAuthorization | undefined;
    vi.spyOn(stripe, "create").mockImplementation(async (input) => {
      consumedAuthorization = input.authorization;
      return gatewayCreate(input);
    });
    const executor = dispatchExecutor(stripe, "stripe", "subscription_create");
    await expect(executor.create(operationWork("stripe", "subscription_create"), "checkout-1", subscription("stripe")))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ client_reference_id: "checkout-1",
      subscription_data: { metadata: expect.not.objectContaining({ gooddealer_account_id: expect.anything() }) } }),
    { idempotencyKey: "stable-idempotency" });
    expect(consumedAuthorization).toBeDefined();
    await expect(gatewayCreate({ authorization: consumedAuthorization!, purchaseAttemptId: "checkout-1",
      definition: subscription("stripe") })).rejects.toThrow(/executor custody/u);
    expect(create).toHaveBeenCalledOnce();
  });

  it("quarantines a Stripe Checkout whose settled amount or identity is not provable", async () => {
    const create = vi.fn(async () => ({ id: "cs_bad", mode: "subscription", status: "open",
      url: "https://checkout.stripe.com/c/pay", client_reference_id: "checkout-1",
      amount_total: 981, currency: "usd", metadata: { gooddealer_purchase_attempt_id: "checkout-1" } }));
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { create } }, subscriptions: {} } as never, urls);
    const execution = await dispatchExecutor(stripe, "stripe", "subscription_create")
      .create(operationWork("stripe", "subscription_create"), "checkout-1", subscription("stripe"));
    expect(execution.outcome).toBe("manual_resolution");
  });

  it.each([
    ["subscription", subscription("stripe")],
    ["fixed-term", { provider: "stripe" as const, offer: "ten_year" as const, campaignCode: null,
      providerItemId: "plan-fixed", providerDiscountId: null, currency: "USD" as const,
      amountMinor: 49_800, purchaseKind: "fixed_term" as const }],
  ] as const)("fails closed during %s Checkout recovery when metadata is missing", async (_label, definition) => {
    const retrieve = vi.fn(async () => ({ id: "cs_1", mode: definition.purchaseKind === "subscription" ? "subscription" : "payment",
      status: "open", client_reference_id: "checkout-1", amount_total: definition.amountMinor,
      currency: "usd", metadata: null }));
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { retrieve } }, subscriptions: {} } as never, urls);
    await expect(stripe.recover({ operationKind: definition.purchaseKind === "subscription"
      ? "subscription_create" : "fixed_term_checkout_create", providerOperationId: "operation-1",
      resources: [{ resourceKind: "checkout_session", resourceId: "cs_1", role: "created", bindingDigest: new Uint8Array(32) }],
      evaluatedAt: new Date("2026-09-03T00:00:00Z"), creation: { purchaseAttemptId: "checkout-1", definition } }))
      .rejects.toThrow(/manual_resolution/u);
  });

  it("rejects a forged structural authorization with zero PayPal SDK calls", async () => {
    const captureOrder = vi.fn();
    const sdk = { subscriptions: {}, orders: { captureOrder } } as unknown as PayPalCommercialSdk;
    const gateway = new PayPalCommercialCheckoutGateway(sdk, urls, "sandbox");
    await expect(gateway.captureFixedTerm({ authorization: {
      provider: "paypal", providerOperationId: "operation-1", operationRevision: 1,
      operationKind: "fixed_term_order_capture", providerIdempotencyKey: "stable-idempotency",
      dispatchPermitId: "permit-1", dispatchAttempt: 1, expiresAt: "2026-09-03T00:01:00Z",
      consumedAt: "2026-09-03T00:00:00Z",
    } as never, providerOrderResourceId: "ORDER-1",
    expectedPurchase: { purchaseAttemptId: "attempt-1", purchaseKind: "fixed_term", offer: "ten_year",
      providerItemId: "fixed-plan", amountMinor: 49_800, currency: "USD" } }))
      .rejects.toThrow(/executor custody/u);
    expect(captureOrder).not.toHaveBeenCalled();
  });

  it("preflights the exact active PayPal Plan before creating a Subscription", async () => {
    const getBillingPlan = vi.fn(async () => ({ result: paypalPlan("plan-monthly") }));
    const createSubscription = vi.fn(async () => ({ result: {
      id: "SUB-1", planId: "plan-monthly", customId: "checkout-1", status: "APPROVAL_PENDING",
      plan: paypalPlanDetails(),
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ plans: { getBillingPlan },
      subscriptions: { createSubscription, getSubscription: vi.fn() }, orders: {}, payments: {} } as never, urls, "sandbox");

    await expect(dispatchExecutor(paypal, "paypal", "subscription_create")
      .create(operationWork("paypal", "subscription_create"), "checkout-1", subscription("paypal")))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(getBillingPlan).toHaveBeenCalledTimes(2);
    expect(createSubscription).toHaveBeenCalledOnce();
  });

  it.each([
    ["inactive", { status: "INACTIVE" }],
    ["wrong amount", { billingCycles: [{ ...paypalPlanDetails().billingCycles![0]!, pricingScheme: {
      fixedPrice: { currencyCode: "USD", value: "9.81" },
    } }] }],
    ["trial cycle", { billingCycles: [
      { ...paypalPlanDetails().billingCycles![0]!, tenureType: "TRIAL" },
      paypalPlanDetails().billingCycles![0]!,
    ] }],
    ["wrong frequency", { billingCycles: [{ ...paypalPlanDetails().billingCycles![0]!,
      frequency: { intervalUnit: "YEAR", intervalCount: 1 } }] }],
    ["setup fee", { paymentPreferences: { setupFee: { currencyCode: "USD", value: "1.00" } } }],
    ["quantity pricing", { quantitySupported: true }],
    ["tax", { taxes: { percentage: "1.00", inclusive: false } }],
  ] as const)("rejects a PayPal Plan with %s before any Subscription mutation", async (_label, override) => {
    const getBillingPlan = vi.fn(async () => ({ result: { ...paypalPlan("plan-monthly"), ...override } }));
    const createSubscription = vi.fn();
    const paypal = new PayPalCommercialCheckoutGateway({ plans: { getBillingPlan },
      subscriptions: { createSubscription, getSubscription: vi.fn() }, orders: {}, payments: {} } as never, urls, "sandbox");

    await expect(dispatchExecutor(paypal, "paypal", "subscription_create")
      .create(operationWork("paypal", "subscription_create"), "checkout-1", subscription("paypal")))
      .resolves.toMatchObject({ outcome: "rejected" });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("quarantines a PayPal Subscription when the post-create Plan snapshot changes", async () => {
    const getBillingPlan = vi.fn()
      .mockResolvedValueOnce({ result: paypalPlan("plan-monthly") })
      .mockResolvedValueOnce({ result: { ...paypalPlan("plan-monthly"), status: "INACTIVE" } });
    const createSubscription = vi.fn(async () => ({ result: {
      id: "SUB-1", planId: "plan-monthly", customId: "checkout-1", status: "APPROVAL_PENDING",
      plan: paypalPlanDetails(),
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ plans: { getBillingPlan },
      subscriptions: { createSubscription, getSubscription: vi.fn() }, orders: {}, payments: {} } as never, urls, "sandbox");

    await expect(dispatchExecutor(paypal, "paypal", "subscription_create")
      .create(operationWork("paypal", "subscription_create"), "checkout-1", subscription("paypal")))
      .resolves.toMatchObject({ outcome: "manual_resolution" });
    expect(createSubscription).toHaveBeenCalledOnce();
  });

  it.each([
    ["amount", { amount: { currencyCode: "USD", value: "498.01" } }],
    ["currency", { amount: { currencyCode: "EUR", value: "498.00" } }],
    ["identity", { customId: "other" }],
    ["shipping", { shipping: {} }],
    ["breakdown", { amount: { currencyCode: "USD", value: "498.00", breakdown: {} } }],
  ] as const)("quarantines a PayPal fixed-term Order with mismatched %s before approval", async (_label, override) => {
    const createOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "CREATED", intent: "CAPTURE", purchaseUnits: [{
        referenceId: "checkout-1", customId: "checkout-1", invoiceId: "checkout-1",
        amount: { currencyCode: "USD", value: "498.00" }, ...override,
      }], links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1" }],
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: {}, orders: { createOrder }, plans: {}, payments: {} } as never, urls, "sandbox");
    await expect(dispatchExecutor(paypal, "paypal", "fixed_term_order_create")
      .create(operationWork("paypal", "fixed_term_order_create"), "checkout-1", fixedTerm("paypal")))
      .resolves.toMatchObject({ outcome: "manual_resolution" });
  });

  it("applies the fixed-term Order binding gate during unknown creation recovery", async () => {
    const getOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "CREATED", intent: "CAPTURE", purchaseUnits: [{
        referenceId: "checkout-1", customId: "checkout-1", invoiceId: "checkout-1",
        amount: { currencyCode: "USD", value: "499.00" },
      }],
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: {}, orders: { getOrder }, plans: {}, payments: {} } as never, urls, "sandbox");
    await expect(paypal.recover({ operationKind: "fixed_term_order_create", providerOperationId: "operation-1",
      resources: [{ resourceKind: "order", resourceId: "ORDER-1", role: "created", bindingDigest: new Uint8Array(32) }],
      evaluatedAt: new Date("2026-09-03T00:00:00Z"), creation: { purchaseAttemptId: "checkout-1", definition: fixedTerm("paypal") } }))
      .rejects.toThrow(/manual_resolution/u);
  });

  it("revalidates the fixed-term Order before returning a PayPal approval URL", async () => {
    const getOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "CREATED", intent: "CAPTURE", purchaseUnits: [{
        referenceId: "checkout-1", customId: "checkout-1", invoiceId: "checkout-1",
        amount: { currencyCode: "USD", value: "498.00" }, shipping: {},
      }], links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1" }],
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: {}, orders: { getOrder }, plans: {}, payments: {} } as never, urls, "sandbox");
    await expect(paypal.readApprovalUrl({ providerResourceKind: "order", providerResourceId: "ORDER-1",
      expectedPurchase: { purchaseAttemptId: "checkout-1", purchaseKind: "fixed_term", offer: "ten_year",
        providerItemId: "fixed-plan", amountMinor: 49_800, currency: "USD" } }))
      .rejects.toThrow(/manual_resolution/u);
  });

  it("revalidates the immutable PayPal Order immediately before capture", async () => {
    const unit = { referenceId: "attempt-1", customId: "attempt-1", invoiceId: "attempt-1",
      amount: { currencyCode: "USD", value: "498.00" } };
    const getOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "APPROVED", intent: "CAPTURE", purchaseUnits: [unit],
    } }));
    const captureOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "COMPLETED", intent: "CAPTURE",
      purchaseUnits: [{ ...unit, payments: { captures: [{ id: "CAPTURE-1", status: "COMPLETED",
        amount: { currencyCode: "USD", value: "498.00" } }] } }],
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: {}, plans: {},
      orders: { getOrder, captureOrder }, payments: {} } as never, urls, "sandbox");
    await expect(dispatchExecutor(paypal, "paypal", "fixed_term_order_capture")
      .captureFixedTerm(operationWork("paypal", "fixed_term_order_capture", "order", "ORDER-1"), "ORDER-1"))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(getOrder).toHaveBeenCalledBefore(captureOrder);
  });

  it("does not capture a PayPal Order whose preflight amount conflicts", async () => {
    const getOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "APPROVED", intent: "CAPTURE", purchaseUnits: [{
        referenceId: "attempt-1", customId: "attempt-1", invoiceId: "attempt-1",
        amount: { currencyCode: "USD", value: "0.01" },
      }],
    } }));
    const captureOrder = vi.fn();
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: {}, plans: {},
      orders: { getOrder, captureOrder }, payments: {} } as never, urls, "sandbox");
    await expect(dispatchExecutor(paypal, "paypal", "fixed_term_order_capture")
      .captureFixedTerm(operationWork("paypal", "fixed_term_order_capture", "order", "ORDER-1"), "ORDER-1"))
      .resolves.toMatchObject({ outcome: "manual_resolution" });
    expect(captureOrder).not.toHaveBeenCalled();
  });

  it("rejects conflicting PayPal Order identity during capture recovery", async () => {
    const getOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "COMPLETED", intent: "CAPTURE", purchaseUnits: [{
        referenceId: "other", customId: "other", invoiceId: "other",
        amount: { currencyCode: "USD", value: "498.00" }, payments: { captures: [{ id: "CAPTURE-1",
          status: "COMPLETED", amount: { currencyCode: "USD", value: "498.00" } }] },
      }],
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: {}, plans: {},
      orders: { getOrder }, payments: {} } as never, urls, "sandbox");
    await expect(paypal.recover({ operationKind: "fixed_term_order_capture", providerOperationId: "operation-1",
      resources: [{ resourceKind: "order", resourceId: "ORDER-1", role: "target", bindingDigest: new Uint8Array(32) }],
      evaluatedAt: new Date("2026-09-03T00:00:00Z"),
      expectedPurchase: { purchaseAttemptId: "attempt-1", purchaseKind: "fixed_term", offer: "ten_year",
        providerItemId: "fixed-plan", amountMinor: 49_800, currency: "USD" } }))
      .rejects.toThrow(/manual_resolution/u);
  });

  it.each([
    ["non-completed status", { status: "PENDING", amount: { currencyCode: "USD", value: "498.00" } }, "outcome_unknown"],
    ["wrong amount", { status: "COMPLETED", amount: { currencyCode: "USD", value: "0.01" } }, "manual_resolution"],
    ["wrong currency", { status: "COMPLETED", amount: { currencyCode: "EUR", value: "498.00" } }, "manual_resolution"],
  ] as const)("does not confirm a PayPal capture with %s", async (_label, captureOverride, outcome) => {
    const unit = { referenceId: "attempt-1", customId: "attempt-1", invoiceId: "attempt-1",
      amount: { currencyCode: "USD", value: "498.00" } };
    const getOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "APPROVED", intent: "CAPTURE", purchaseUnits: [unit],
    } }));
    const captureOrder = vi.fn(async () => ({ result: {
      id: "ORDER-1", status: "COMPLETED", intent: "CAPTURE",
      purchaseUnits: [{ ...unit, payments: { captures: [{ id: "CAPTURE-1", ...captureOverride }] } }],
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: {}, plans: {},
      orders: { getOrder, captureOrder }, payments: {} } as never, urls, "sandbox");
    await expect(dispatchExecutor(paypal, "paypal", "fixed_term_order_capture")
      .captureFixedTerm(operationWork("paypal", "fixed_term_order_capture", "order", "ORDER-1"), "ORDER-1"))
      .resolves.toMatchObject({ outcome });
  });

  it.each([
    ["plan identity", { planId: "plan-other" }],
    ["purchase identity", { customId: "checkout-other" }],
    ["plan override", { planOverridden: true }],
    ["quantity override", { quantity: "2" }],
    ["shipping override", { shippingAmount: { currencyCode: "USD", value: "1.00" } }],
    ["price override", { plan: { ...paypalPlanDetails(), billingCycles: [{
      ...paypalPlanDetails().billingCycles![0]!, pricingScheme: {
        fixedPrice: { currencyCode: "USD", value: "1.00" },
      },
    }] } }],
  ] as const)("quarantines a created PayPal Subscription with a %s", async (_label, override) => {
    const getBillingPlan = vi.fn(async () => ({ result: paypalPlan("plan-monthly") }));
    const createSubscription = vi.fn(async () => ({ result: {
      id: "SUB-1", planId: "plan-monthly", customId: "checkout-1", status: "APPROVAL_PENDING",
      planOverridden: false, quantity: "1", plan: paypalPlanDetails(), ...override,
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ plans: { getBillingPlan },
      subscriptions: { createSubscription, getSubscription: vi.fn() }, orders: {}, payments: {} } as never, urls, "sandbox");

    await expect(dispatchExecutor(paypal, "paypal", "subscription_create")
      .create(operationWork("paypal", "subscription_create"), "checkout-1", subscription("paypal")))
      .resolves.toMatchObject({ outcome: "manual_resolution" });
  });

  it("loads the created PayPal Plan snapshot explicitly when create returns a minimal representation", async () => {
    const getBillingPlan = vi.fn(async () => ({ result: paypalPlan("plan-monthly") }));
    const createSubscription = vi.fn(async () => ({ result: { id: "SUB-1", status: "APPROVAL_PENDING" } }));
    const getSubscription = vi.fn(async () => ({ result: {
      id: "SUB-1", planId: "plan-monthly", customId: "checkout-1", status: "APPROVAL_PENDING",
      planOverridden: false, quantity: "1", plan: paypalPlanDetails(),
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ plans: { getBillingPlan },
      subscriptions: { createSubscription, getSubscription }, orders: {}, payments: {} } as never, urls, "sandbox");

    await expect(dispatchExecutor(paypal, "paypal", "subscription_create")
      .create(operationWork("paypal", "subscription_create"), "checkout-1", subscription("paypal")))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(getSubscription).toHaveBeenCalledWith({ id: "SUB-1", fields: "plan" });
  });

  it("applies the same Plan gate while recovering an unknown PayPal creation", async () => {
    const getBillingPlan = vi.fn(async () => ({ result: { ...paypalPlan("plan-monthly"), status: "INACTIVE" } }));
    const getSubscription = vi.fn(async () => ({ result: {
      id: "SUB-1", planId: "plan-monthly", customId: "checkout-1", status: "APPROVAL_PENDING",
      planOverridden: false, quantity: "1", plan: paypalPlanDetails(),
    } }));
    const paypal = new PayPalCommercialCheckoutGateway({ plans: { getBillingPlan },
      subscriptions: { createSubscription: vi.fn(), getSubscription }, orders: {}, payments: {} } as never, urls, "sandbox");

    await expect(paypal.recover({ operationKind: "subscription_create", providerOperationId: "operation-1",
      resources: [{ resourceKind: "subscription", resourceId: "SUB-1", role: "created", bindingDigest: new Uint8Array(32) }],
      evaluatedAt: new Date("2026-09-03T00:00:00Z"),
      creation: { purchaseAttemptId: "checkout-1", definition: subscription("paypal") },
    })).rejects.toThrow(/manual_resolution/u);
  });

  it("rejects an expired executor-issued authorization before the Stripe SDK call", async () => {
    const create = vi.fn();
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { create } }, subscriptions: {} } as never, urls);
    const executor = dispatchExecutor(stripe, "stripe", "subscription_create", "2020-01-01T00:00:00Z");

    await expect(executor.create(operationWork("stripe", "subscription_create"), "checkout-1", subscription("stripe")))
      .resolves.toMatchObject({ outcome: "outcome_unknown" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["amount", { amount_total: 981 }],
    ["currency", { currency: "eur" }],
    ["mode", { mode: "payment" }],
    ["purchase identity", { client_reference_id: "another-purchase" }],
  ] as const)("rejects a newly created Stripe Session with mismatched %s before approval exposure", async (_field, override) => {
    const create = vi.fn(async () => ({ id: "cs_mismatch", mode: "subscription", status: "open",
      url: "https://checkout.stripe.com/c/pay", client_reference_id: "checkout-1",
      amount_total: 980, currency: "usd", metadata: { gooddealer_purchase_attempt_id: "checkout-1" }, ...override }));
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { create } }, subscriptions: {} } as never, urls);

    await expect(dispatchExecutor(stripe, "stripe", "subscription_create")
      .create(operationWork("stripe", "subscription_create"), "checkout-1", subscription("stripe")))
      .resolves.toMatchObject({ outcome: "manual_resolution" });
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects a recovered Stripe Session whose amount no longer matches the immutable creation definition", async () => {
    const retrieve = vi.fn(async () => ({ id: "cs_1", mode: "subscription", status: "open",
      url: "https://checkout.stripe.com/c/pay", client_reference_id: "checkout-1",
      amount_total: 981, currency: "usd", metadata: { gooddealer_purchase_attempt_id: "checkout-1" } }));
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { retrieve } }, subscriptions: {} } as never, urls);

    await expect(stripe.recover({ operationKind: "subscription_create", providerOperationId: "operation-1",
      resources: [{ resourceKind: "checkout_session", resourceId: "cs_1", role: "created", bindingDigest: new Uint8Array(32) }],
      evaluatedAt: new Date("2026-09-03T00:00:00Z"),
      creation: { purchaseAttemptId: "checkout-1", definition: subscription("stripe") },
    })).rejects.toThrow(/manual_resolution/u);
    expect(retrieve).toHaveBeenCalledWith("cs_1");
  });

  it("rejects a changed Stripe Checkout before returning its approval URL", async () => {
    const retrieve = vi.fn(async () => ({ id: "cs_1", mode: "subscription", status: "open",
      url: "https://checkout.stripe.com/c/pay", client_reference_id: "checkout-1",
      amount_total: 1, currency: "usd", metadata: { gooddealer_purchase_attempt_id: "checkout-1" } }));
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { retrieve } },
      subscriptions: {} } as never, urls);
    await expect(stripe.readApprovalUrl({ providerResourceKind: "checkout_session", providerResourceId: "cs_1",
      expectedPurchase: { purchaseAttemptId: "checkout-1", purchaseKind: "subscription", offer: "monthly",
        providerItemId: "plan-monthly", amountMinor: 980, currency: "USD" } }))
      .rejects.toThrow(/manual_resolution/u);
  });

  it("rejects a changed PayPal Subscription before returning its approval URL", async () => {
    const getSubscription = vi.fn(async () => ({ result: {
      id: "SUB-1", planId: "plan-monthly", customId: "other", status: "APPROVAL_PENDING",
      planOverridden: false, quantity: "1", plan: paypalPlanDetails(),
      links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=SUB-1" }],
    } }));
    const getBillingPlan = vi.fn(async () => ({ result: paypalPlan("plan-monthly") }));
    const paypal = new PayPalCommercialCheckoutGateway({ plans: { getBillingPlan },
      subscriptions: { getSubscription }, orders: {}, payments: {} } as never, urls, "sandbox");
    await expect(paypal.readApprovalUrl({ providerResourceKind: "subscription", providerResourceId: "SUB-1",
      expectedPurchase: { purchaseAttemptId: "checkout-1", purchaseKind: "subscription", offer: "monthly",
        providerItemId: "plan-monthly", amountMinor: 980, currency: "USD" } }))
      .rejects.toThrow(/manual_resolution/u);
  });

  it("records manual resolution without re-dispatch when recovered Stripe Checkout facts conflict", async () => {
    const retrieve = vi.fn(async () => ({ id: "cs_1", mode: "payment", status: "open",
      client_reference_id: "checkout-1", amount_total: 980, currency: "usd",
      metadata: { gooddealer_purchase_attempt_id: "checkout-1" } }));
    const create = vi.fn();
    const stripe = new StripeCommercialCheckoutGateway({ checkout: { sessions: { create, retrieve } },
      subscriptions: {} } as never, urls);
    const replay = { state: "outcome_unknown" as const, responseDigest: new Uint8Array(32),
      resources: [{ resourceKind: "checkout_session", resourceId: "cs_1", role: "created" as const,
        bindingDigest: new Uint8Array(32) }], disposition: "current" as const };

    await expect(dispatchExecutor(stripe, "stripe", "subscription_create", "2099-09-03T00:01:00Z", replay)
      .create(operationWork("stripe", "subscription_create"), "checkout-1", subscription("stripe")))
      .resolves.toMatchObject({ outcome: "manual_resolution" });
    expect(retrieve).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("reads before immediate Stripe termination and then refunds the exact initial Charge", async () => {
    const retrieveSubscription = vi.fn(async () => ({ id: "sub_1", status: "active" }));
    const cancel = vi.fn(async () => ({ id: "sub_1", status: "canceled" }));
    const listRefunds = vi.fn(async () => ({ data: [] }));
    const createRefund = vi.fn(async () => ({ id: "re_1", status: "succeeded", amount: 980, currency: "usd" }));
    const stripe = new StripeCommercialCheckoutGateway({ subscriptions: { retrieve: retrieveSubscription, cancel },
      checkout: {}, refunds: { list: listRefunds, create: createRefund } } as never, urls);

    await expect(dispatchExecutor(stripe, "stripe", "subscription_refund_terminate")
      .resume(operationWork("stripe", "subscription_refund_terminate", "subscription", "sub_1"), {} as never))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(retrieveSubscription).toHaveBeenCalledBefore(cancel);
    expect(cancel).toHaveBeenCalledWith("sub_1", {}, { idempotencyKey: "stable-idempotency" });

    await expect(dispatchExecutor(stripe, "stripe", "first_purchase_refund")
      .resume(operationWork("stripe", "first_purchase_refund", "charge", "ch_1"), {} as never))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(listRefunds).toHaveBeenCalledWith({ charge: "ch_1", limit: 2 });
    expect(createRefund).toHaveBeenCalledWith({ charge: "ch_1",
      metadata: { gooddealer_provider_operation_id: "operation-1" } }, { idempotencyKey: "stable-idempotency" });
  });

  it("reads before PayPal termination and sends one full-remaining Capture refund", async () => {
    const getSubscription = vi.fn()
      .mockResolvedValueOnce({ result: { id: "SUB-1", status: "ACTIVE" } })
      .mockResolvedValueOnce({ result: { id: "SUB-1", status: "CANCELLED" } });
    const cancelSubscription = vi.fn(async () => undefined);
    const getCapturedPayment = vi.fn(async () => ({ result: { id: "CAPTURE-1", status: "COMPLETED" } }));
    const refundCapturedPayment = vi.fn(async () => ({ result: { id: "REFUND-1", status: "COMPLETED" } }));
    const paypal = new PayPalCommercialCheckoutGateway({ subscriptions: { getSubscription, cancelSubscription },
      orders: {}, payments: { getCapturedPayment, refundCapturedPayment } } as never, urls, "sandbox");

    await expect(dispatchExecutor(paypal, "paypal", "subscription_refund_terminate")
      .resume(operationWork("paypal", "subscription_refund_terminate", "subscription", "SUB-1"), {} as never))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(getSubscription).toHaveBeenCalledBefore(cancelSubscription);

    await expect(dispatchExecutor(paypal, "paypal", "first_purchase_refund")
      .resume(operationWork("paypal", "first_purchase_refund", "capture", "CAPTURE-1"), {} as never))
      .resolves.toMatchObject({ outcome: "confirmed" });
    expect(refundCapturedPayment).toHaveBeenCalledWith({ captureId: "CAPTURE-1",
      paypalRequestId: "stable-idempotency", prefer: "return=representation", body: {} });
  });
});

function dispatchExecutor(gateway: CommercialProviderMutationGateway, provider: "stripe" | "paypal",
  operationKind: "subscription_create" | "fixed_term_order_create" | "fixed_term_order_capture"
    | "subscription_refund_terminate" | "first_purchase_refund",
  expiresAt = "2099-09-03T00:01:00Z",
  replay: { readonly state: "planned" | "outcome_unknown"; readonly responseDigest: Uint8Array | null;
    readonly resources: readonly { readonly resourceKind: string; readonly resourceId: string;
      readonly role: "created"; readonly bindingDigest: Uint8Array }[]; readonly disposition: "current" }
    = { state: "planned", responseDigest: null, resources: [], disposition: "current" }) {
  const repository = {
    readOperationReplay: vi.fn(async () => replay),
    issueDispatchPermit: vi.fn(async () => ({ dispatchPermitId: "permit-1", providerOperationId: "operation-1",
      operationRevision: 1, operationKind, dispatchAttempt: 1, expiresAt })),
    consumeDispatchPermit: vi.fn(async (_query, _work, permit) => ({ ...permit, provider,
      providerIdempotencyKey: "stable-idempotency", consumedAt: "2026-09-03T00:00:00Z" })),
    recordOperationResult: vi.fn(async (_query, _work, _permit, command) => ({ ...replay, state: command.outcome,
      responseDigest: command.responseDigest, resources: command.resources })),
  };
  const unavailable = { provider: provider === "stripe" ? "paypal" as const : "stripe" as const,
    create: vi.fn(), cancelSubscription: vi.fn(),
    captureFixedTerm: vi.fn(), recover: vi.fn(), readApprovalUrl: vi.fn() };
  return new ProviderDispatchExecutor({ query: vi.fn() } as never, repository as never, [gateway, unavailable] as never);
}

function operationWork(provider: "stripe" | "paypal",
  operationKind: "subscription_create" | "fixed_term_order_create" | "fixed_term_order_capture"
    | "subscription_refund_terminate" | "first_purchase_refund",
  providerResourceKind: string | null = null, providerResourceId: string | null = null) {
  return { workId: "work-1", kind: "provider_operation" as const, leaseEpoch: 1,
    leaseExpiresAt: "2026-09-03T00:01:00Z", rawToken: new Uint8Array(32), provider,
    purchaseAttemptId: "attempt-1", purchaseKind: operationKind === "fixed_term_order_capture"
      || operationKind === "fixed_term_order_create"
      || operationKind === "first_purchase_refund" ? "fixed_term" as const : "subscription" as const,
    offer: operationKind === "fixed_term_order_capture" || operationKind === "fixed_term_order_create"
      || operationKind === "first_purchase_refund" ? "ten_year" as const : "monthly" as const,
    providerCatalogItem: operationKind === "fixed_term_order_capture" || operationKind === "fixed_term_order_create"
      ? "fixed-plan" : "plan-monthly", campaignCode: null,
    expectedGrossMinor: operationKind === "fixed_term_order_capture" || operationKind === "fixed_term_order_create"
      || operationKind === "first_purchase_refund" ? 49_800 : 980,
    expectedCurrency: "USD" as const,
    providerOperationId: "operation-1", operationRevision: 1, operationKind,
    providerIdempotencyKey: "stable-idempotency", requestDigest: new Uint8Array(32),
    providerResourceKind, providerResourceId };
}

function subscription(provider: "stripe" | "paypal") { return { provider, offer: "monthly" as const,
  campaignCode: null, providerItemId: "plan-monthly", providerDiscountId: null, currency: "USD" as const,
  amountMinor: 980, purchaseKind: "subscription" as const }; }

function paypalPlan(id: string) {
  return { id, status: "ACTIVE" as const, billingCycles: [paypalPlanDetails().billingCycles![0]!],
    paymentPreferences: {}, quantitySupported: false };
}

function fixedTerm(provider: "stripe" | "paypal") { return { provider, offer: "ten_year" as const,
  campaignCode: null, providerItemId: "fixed-plan", providerDiscountId: null, currency: "USD" as const,
  amountMinor: 49_800, purchaseKind: "fixed_term" as const }; }

function paypalPlanDetails() {
  return { billingCycles: [{ sequence: 1, tenureType: "REGULAR" as const, totalCycles: 0,
    frequency: { intervalUnit: "MONTH" as const, intervalCount: 1 },
    pricingScheme: { fixedPrice: { currencyCode: "USD", value: "9.80" } } }],
    paymentPreferences: {}, quantitySupported: false };
}
