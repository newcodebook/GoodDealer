import {
  ApplicationContextUserAction,
  type BillingPlan,
  CheckoutPaymentIntent,
  type CreateSubscriptionRequest,
  type Order,
  type OrderRequest,
  type PlanDetails,
  type Subscription,
  type TransactionsList,
} from "@paypal/paypal-server-sdk";
import type Stripe from "stripe";

import {
  ProviderDispatchManualResolutionError,
  ProviderDispatchOutcomeUnknownError,
  ProviderDispatchRejectedError,
  consumeProviderSdkAuthorization,
  type CommercialProviderMutationGateway,
  type ProviderMutationResult,
  type ProviderSdkAuthorization,
} from "../provider-dispatch-executor";

export interface CommercialReturnUrls {
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export class StripeCommercialCheckoutGateway implements CommercialProviderMutationGateway {
  readonly provider = "stripe" as const;

  constructor(
    private readonly sdk: Pick<Stripe, "checkout" | "subscriptions" | "refunds">,
    private readonly urls: CommercialReturnUrls,
  ) { assertReturnUrls(urls); }

  async create(input: {
    readonly authorization: Parameters<CommercialProviderMutationGateway["create"]>[0]["authorization"];
    readonly purchaseAttemptId: string;
    readonly definition: Parameters<CommercialProviderMutationGateway["create"]>[0]["definition"];
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "stripe", input.definition.purchaseKind === "subscription"
      ? "subscription_create" : "fixed_term_checkout_create");
    try {
      const metadata = {
        gooddealer_purchase_attempt_id: input.purchaseAttemptId,
      };
      const session = await this.sdk.checkout.sessions.create({
        mode: input.definition.purchaseKind === "subscription" ? "subscription" : "payment",
        client_reference_id: input.purchaseAttemptId,
        line_items: [{ price: input.definition.providerItemId, quantity: 1 }],
        success_url: this.urls.successUrl,
        cancel_url: this.urls.cancelUrl,
        metadata,
        ...(input.definition.purchaseKind === "subscription"
          ? { subscription_data: { metadata } }
          : { payment_intent_data: { metadata } }),
        ...(input.definition.providerDiscountId === null
          ? {}
          : { discounts: [{ coupon: input.definition.providerDiscountId }] }),
      }, { idempotencyKey: input.authorization.providerIdempotencyKey });
      assertStripeCheckoutMatches(session, input.purchaseAttemptId, input.definition);
      return {
        resources: [{ resourceKind: "checkout_session", resourceId: session.id, role: "created" }],
        responseEvidence: { id: session.id, mode: session.mode, status: session.status,
          clientReferenceId: session.client_reference_id,
          metadataPurchaseAttemptId: session.metadata?.gooddealer_purchase_attempt_id,
          amountTotal: session.amount_total, currency: session.currency },
      };
    } catch (error) {
      throw normalizeCreationError(error);
    }
  }

  async cancelSubscription(input: {
    readonly authorization: Parameters<CommercialProviderMutationGateway["cancelSubscription"]>[0]["authorization"];
    readonly providerAgreementResourceId: string;
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "stripe", "subscription_cancel");
    const subscription = await this.sdk.subscriptions.update(
      input.providerAgreementResourceId,
      { cancel_at_period_end: true },
      { idempotencyKey: input.authorization.providerIdempotencyKey },
    );
    if (subscription.id !== input.providerAgreementResourceId) throw new ProviderDispatchOutcomeUnknownError();
    return targetResult("subscription", subscription.id, { cancelAtPeriodEnd: subscription.cancel_at_period_end });
  }

  async captureFixedTerm(_input: {
    readonly authorization: Parameters<CommercialProviderMutationGateway["captureFixedTerm"]>[0]["authorization"];
    readonly providerOrderResourceId: string;
  }): Promise<ProviderMutationResult> {
    throw new TypeError("Stripe fixed-term Checkout does not use a separate capture operation");
  }

  async terminateSubscriptionForRefund(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerAgreementResourceId: string;
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "stripe", "subscription_refund_terminate");
    const subscription = await this.sdk.subscriptions.cancel(input.providerAgreementResourceId, {},
      { idempotencyKey: input.authorization.providerIdempotencyKey });
    if (subscription.id !== input.providerAgreementResourceId || subscription.status !== "canceled") {
      throw new ProviderDispatchOutcomeUnknownError();
    }
    return targetResult("subscription", subscription.id, { status: subscription.status });
  }

  async refundFirstPurchase(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerPaymentResourceKind: string;
    readonly providerPaymentResourceId: string;
    readonly providerOperationId: string;
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "stripe", "first_purchase_refund");
    if (!["charge", "payment_intent"].includes(input.providerPaymentResourceKind)) {
      throw new ProviderDispatchRejectedError();
    }
    const refund = await this.sdk.refunds.create({
      ...(input.providerPaymentResourceKind === "charge" ? { charge: input.providerPaymentResourceId }
        : { payment_intent: input.providerPaymentResourceId }),
      metadata: { gooddealer_provider_operation_id: input.providerOperationId },
    }, { idempotencyKey: input.authorization.providerIdempotencyKey });
    if (refund.status === "failed" || refund.status === "canceled") throw new ProviderDispatchRejectedError();
    return { resources: [
      { resourceKind: input.providerPaymentResourceKind, resourceId: input.providerPaymentResourceId, role: "target" },
      { resourceKind: "refund", resourceId: refund.id, role: "created" },
    ], responseEvidence: { refundId: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency } };
  }

  async recover(input: Parameters<CommercialProviderMutationGateway["recover"]>[0]): Promise<ProviderMutationResult | null> {
    const resource = oneResource(input.resources);
    if (["subscription_create", "fixed_term_checkout_create"].includes(input.operationKind)
      && resource?.resourceKind === "checkout_session") {
      const session = await this.sdk.checkout.sessions.retrieve(resource.resourceId);
      if (session.id !== resource.resourceId) return null;
      if (input.creation === undefined) throw new TypeError("Stripe checkout recovery expectation is unavailable");
      assertStripeCheckoutMatches(session, input.creation.purchaseAttemptId, input.creation.definition);
      return mutationResult("checkout_session", session.id, "created",
        { id: session.id, mode: session.mode, status: session.status,
          clientReferenceId: session.client_reference_id,
          metadataPurchaseAttemptId: session.metadata?.gooddealer_purchase_attempt_id,
          amountTotal: session.amount_total, currency: session.currency });
    }
    if (input.operationKind === "subscription_cancel" && resource?.resourceKind === "subscription") {
      const subscription = await this.sdk.subscriptions.retrieve(resource.resourceId);
      if (subscription.id !== resource.resourceId || (!subscription.cancel_at_period_end && subscription.status !== "canceled")) {
        return null;
      }
      return targetResult("subscription", subscription.id, {
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        status: subscription.status,
      });
    }
    if (input.operationKind === "subscription_refund_terminate" && resource?.resourceKind === "subscription") {
      const subscription = await this.sdk.subscriptions.retrieve(resource.resourceId);
      return subscription.id === resource.resourceId && subscription.status === "canceled"
        ? targetResult("subscription", subscription.id, { status: subscription.status }) : null;
    }
    if (input.operationKind === "first_purchase_refund") {
      const target = input.resources.find((candidate) => candidate.role === "target"
        && ["charge", "payment_intent"].includes(candidate.resourceKind));
      if (target === undefined) return null;
      const known = input.resources.find((candidate) => candidate.resourceKind === "refund");
      const refunds = known === undefined
        ? await this.sdk.refunds.list({ ...(target.resourceKind === "charge" ? { charge: target.resourceId }
          : { payment_intent: target.resourceId }), limit: 2 })
        : { data: [await this.sdk.refunds.retrieve(known.resourceId)] };
      const matches = refunds.data.filter((refund) => refund.metadata?.gooddealer_provider_operation_id === input.providerOperationId
        && objectId(refund.charge) === (target.resourceKind === "charge" ? target.resourceId : objectId(refund.charge))
        && objectId(refund.payment_intent) === (target.resourceKind === "payment_intent"
          ? target.resourceId : objectId(refund.payment_intent)) && !["failed", "canceled"].includes(refund.status ?? ""));
      if (matches.length !== 1 || matches[0] === undefined) return null;
      return { resources: [{ resourceKind: target.resourceKind, resourceId: target.resourceId, role: "target" },
        { resourceKind: "refund", resourceId: matches[0].id, role: "created" }],
        responseEvidence: { refundId: matches[0].id, status: matches[0].status,
          amount: matches[0].amount, currency: matches[0].currency } };
    }
    return null;
  }

  async readApprovalUrl(input: Parameters<CommercialProviderMutationGateway["readApprovalUrl"]>[0]): Promise<string> {
    if (input.providerResourceKind !== "checkout_session") throw new TypeError("Stripe approval resource is invalid");
    const session = await this.sdk.checkout.sessions.retrieve(input.providerResourceId);
    if (session.id !== input.providerResourceId || session.url === null) throw new ProviderDispatchOutcomeUnknownError();
    if (input.expectedPurchase === undefined) throw new ProviderDispatchManualResolutionError();
    assertStripeCheckoutMatches(session, input.expectedPurchase.purchaseAttemptId, input.expectedPurchase);
    return officialApprovalUrl(session.url, ["https://checkout.stripe.com"]);
  }
}

export interface PayPalCommercialSdk {
  readonly plans: {
    getBillingPlan(id: string): Promise<{ readonly result: BillingPlan }>;
  };
  readonly subscriptions: {
    createSubscription(input: {
      prefer?: string;
      paypalRequestId?: string;
      body?: CreateSubscriptionRequest;
    }): Promise<{ readonly result: Subscription }>;
    getSubscription(input: { readonly id: string; readonly fields?: string }): Promise<{ readonly result: Subscription }>;
    listSubscriptionTransactions(input: { readonly id: string; readonly startTime: string; readonly endTime: string }):
      Promise<{ readonly result: TransactionsList }>;
    cancelSubscription(
      input: { readonly id: string; readonly body?: { readonly reason: string } },
      requestOptions?: { readonly additionalHeaders?: Readonly<Record<string, string>> },
    ): Promise<unknown>;
  };
  readonly orders: {
    createOrder(input: {
      paypalRequestId?: string;
      prefer?: string;
      body: OrderRequest;
    }): Promise<{ readonly result: Order }>;
    getOrder(input: { id: string }): Promise<{ readonly result: Order }>;
    captureOrder(input: {
      id: string;
      paypalRequestId?: string;
      prefer?: string;
      body?: Record<string, never>;
    }): Promise<{ readonly result: Order }>;
  };
  readonly payments: {
    getCapturedPayment(input: { readonly captureId: string }): Promise<{ readonly result: {
      readonly id?: string;
      readonly status?: string;
      readonly amount?: { readonly currencyCode?: string; readonly value?: string };
      readonly createTime?: string;
      readonly updateTime?: string;
      readonly supplementaryData?: { readonly relatedIds?: { readonly orderId?: string } };
    } }>;
    refundCapturedPayment(input: {
      readonly captureId: string;
      readonly paypalRequestId?: string;
      readonly prefer?: string;
      readonly body?: { readonly amount?: { readonly currencyCode: string; readonly value: string } };
    }): Promise<{ readonly result: { readonly id?: string; readonly status?: string;
      readonly amount?: { readonly currencyCode: string; readonly value: string } } }>;
    getRefund(input: { readonly refundId: string }): Promise<{ readonly result: { readonly id?: string;
      readonly status?: string; readonly amount?: { readonly currencyCode?: string; readonly value?: string } } }>;
  };
}

export class PayPalCommercialCheckoutGateway implements CommercialProviderMutationGateway {
  readonly provider = "paypal" as const;
  private readonly approvalOrigin: string;

  constructor(
    private readonly sdk: PayPalCommercialSdk,
    private readonly urls: CommercialReturnUrls,
    environment: "sandbox" | "production",
  ) {
    assertReturnUrls(urls);
    this.approvalOrigin = environment === "production"
      ? "https://www.paypal.com"
      : environment === "sandbox"
        ? "https://www.sandbox.paypal.com"
        : invalidPayPalEnvironment();
  }

  async create(input: {
    readonly authorization: Parameters<CommercialProviderMutationGateway["create"]>[0]["authorization"];
    readonly purchaseAttemptId: string;
    readonly definition: Parameters<CommercialProviderMutationGateway["create"]>[0]["definition"];
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "paypal", input.definition.purchaseKind === "subscription"
      ? "subscription_create" : "fixed_term_order_create");
    if (input.definition.providerDiscountId !== null) throw new ProviderDispatchRejectedError();
    try {
      if (input.definition.purchaseKind === "subscription") {
        const plan = (await this.sdk.plans.getBillingPlan(input.definition.providerItemId)).result;
        if (!paypalPlanMatches(plan, input.definition)) throw new ProviderDispatchRejectedError();
        const response = await this.sdk.subscriptions.createSubscription({
          prefer: "return=representation",
          paypalRequestId: input.authorization.providerIdempotencyKey,
          body: {
            planId: input.definition.providerItemId,
            // This is correlation evidence only. Global ProviderBinding remains tenant authority.
            customId: input.purchaseAttemptId,
            applicationContext: {
              brandName: "GoodDealer",
              userAction: ApplicationContextUserAction.SubscribeNow,
              returnUrl: this.urls.successUrl,
              cancelUrl: this.urls.cancelUrl,
            },
          },
        });
        const subscriptionId = requiredId(response.result.id, "PayPal subscription");
        const subscription = response.result.plan === undefined
          ? (await this.sdk.subscriptions.getSubscription({ id: subscriptionId, fields: "plan" })).result
          : response.result;
        const settledPlan = (await this.sdk.plans.getBillingPlan(input.definition.providerItemId)).result;
        if (!paypalCreatedSubscriptionMatches(subscription, subscriptionId, input.purchaseAttemptId,
          input.definition) || !paypalPlanMatches(settledPlan, input.definition)) {
          throw new ProviderDispatchManualResolutionError();
        }
        return mutationResult("subscription", subscriptionId, "created", {
          id: subscription.id,
          status: subscription.status,
          planId: subscription.planId,
          customId: subscription.customId,
        });
      }
      const response = await this.sdk.orders.createOrder({
        prefer: "return=representation",
        paypalRequestId: input.authorization.providerIdempotencyKey,
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [{
            referenceId: input.purchaseAttemptId,
            customId: input.purchaseAttemptId,
            invoiceId: input.purchaseAttemptId,
            description: "GoodDealer 10-year fixed-term access",
            amount: { currencyCode: "USD", value: minorUsd(input.definition.amountMinor) },
          }],
          applicationContext: {
            brandName: "GoodDealer",
            returnUrl: this.urls.successUrl,
            cancelUrl: this.urls.cancelUrl,
          },
        },
      });
      const orderId = requiredId(response.result.id, "PayPal Order");
      assertPayPalFixedTermOrderMatches(response.result, orderId, input.purchaseAttemptId,
        input.definition.amountMinor, input.definition.currency, "approval");
      return mutationResult("order", orderId, "created", {
        id: response.result.id,
        status: response.result.status,
        intent: response.result.intent,
      });
    } catch (error) {
      throw normalizeCreationError(error);
    }
  }

  async cancelSubscription(input: {
    readonly authorization: Parameters<CommercialProviderMutationGateway["cancelSubscription"]>[0]["authorization"];
    readonly providerAgreementResourceId: string;
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "paypal", "subscription_cancel");
    await this.sdk.subscriptions.cancelSubscription({
      id: input.providerAgreementResourceId,
      body: { reason: "Customer requested cancellation at the end of the paid period" },
    }, { additionalHeaders: { "PayPal-Request-Id": input.authorization.providerIdempotencyKey } });
    return targetResult("subscription", input.providerAgreementResourceId, { cancellationRequested: true });
  }

  async captureFixedTerm(input: {
    readonly authorization: Parameters<CommercialProviderMutationGateway["captureFixedTerm"]>[0]["authorization"];
    readonly providerOrderResourceId: string;
    readonly expectedPurchase: Parameters<CommercialProviderMutationGateway["captureFixedTerm"]>[0]["expectedPurchase"];
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "paypal", "fixed_term_order_capture");
    const preflight = (await this.sdk.orders.getOrder({ id: input.providerOrderResourceId })).result;
    assertPayPalFixedTermOrderMatches(preflight, input.providerOrderResourceId,
      input.expectedPurchase.purchaseAttemptId, input.expectedPurchase.amountMinor,
      input.expectedPurchase.currency, "capture");
    const response = await this.sdk.orders.captureOrder({
      id: input.providerOrderResourceId,
      paypalRequestId: input.authorization.providerIdempotencyKey,
      prefer: "return=representation",
      body: {},
    });
    assertPayPalFixedTermOrderMatches(response.result, input.providerOrderResourceId,
      input.expectedPurchase.purchaseAttemptId, input.expectedPurchase.amountMinor,
      input.expectedPurchase.currency, "completed");
    const captureId = paypalCaptureId(response.result, input.expectedPurchase.amountMinor,
      input.expectedPurchase.currency);
    return {
      resources: [
        { resourceKind: "order", resourceId: input.providerOrderResourceId, role: "target" },
        { resourceKind: "capture", resourceId: captureId, role: "created" },
      ],
      responseEvidence: { orderId: input.providerOrderResourceId, captureId, status: response.result.status },
    };
  }

  async terminateSubscriptionForRefund(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerAgreementResourceId: string;
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "paypal", "subscription_refund_terminate");
    await this.sdk.subscriptions.cancelSubscription({ id: input.providerAgreementResourceId,
      body: { reason: "GoodDealer first-purchase refund: immediate subscription termination" } },
    { additionalHeaders: { "PayPal-Request-Id": input.authorization.providerIdempotencyKey } });
    const subscription = (await this.sdk.subscriptions.getSubscription({ id: input.providerAgreementResourceId })).result;
    if (subscription.id !== input.providerAgreementResourceId || subscription.status !== "CANCELLED") {
      throw new ProviderDispatchOutcomeUnknownError();
    }
    return targetResult("subscription", input.providerAgreementResourceId, { status: subscription.status });
  }

  async refundFirstPurchase(input: {
    readonly authorization: ProviderSdkAuthorization;
    readonly providerPaymentResourceKind: string;
    readonly providerPaymentResourceId: string;
    readonly providerOperationId: string;
  }): Promise<ProviderMutationResult> {
    assertAuthorization(input.authorization, "paypal", "first_purchase_refund");
    if (!["capture", "subscription_transaction"].includes(input.providerPaymentResourceKind)) {
      throw new ProviderDispatchRejectedError();
    }
    const response = await this.sdk.payments.refundCapturedPayment({ captureId: input.providerPaymentResourceId,
      paypalRequestId: input.authorization.providerIdempotencyKey, prefer: "return=representation", body: {} });
    const refundId = requiredId(response.result.id, "PayPal Refund");
    if (response.result.status === "FAILED" || response.result.status === "CANCELLED") {
      throw new ProviderDispatchRejectedError();
    }
    return { resources: [
      { resourceKind: input.providerPaymentResourceKind, resourceId: input.providerPaymentResourceId, role: "target" },
      { resourceKind: "refund", resourceId: refundId, role: "created" },
    ], responseEvidence: { refundId, status: response.result.status, amount: response.result.amount } };
  }

  async recover(input: Parameters<CommercialProviderMutationGateway["recover"]>[0]): Promise<ProviderMutationResult | null> {
    const resource = oneResource(input.resources);
    if (input.operationKind === "subscription_create" && resource?.resourceKind === "subscription") {
      if (input.creation === undefined || input.creation.definition.purchaseKind !== "subscription") {
        throw new ProviderDispatchManualResolutionError();
      }
      const value = (await this.sdk.subscriptions.getSubscription({ id: resource.resourceId, fields: "plan" })).result;
      if (value.id !== resource.resourceId) return null;
      const plan = (await this.sdk.plans.getBillingPlan(input.creation.definition.providerItemId)).result;
      if (!paypalCreatedSubscriptionMatches(value, resource.resourceId, input.creation.purchaseAttemptId,
        input.creation.definition) || !paypalPlanMatches(plan, input.creation.definition)) {
        throw new ProviderDispatchManualResolutionError();
      }
      return mutationResult("subscription", resource.resourceId, "created", { id: value.id, status: value.status,
        planId: value.planId, customId: value.customId });
    }
    if (input.operationKind === "fixed_term_order_create" && resource?.resourceKind === "order") {
      if (input.creation === undefined || input.creation.definition.purchaseKind !== "fixed_term") {
        throw new ProviderDispatchManualResolutionError();
      }
      const value = (await this.sdk.orders.getOrder({ id: resource.resourceId })).result;
      if (value.id !== resource.resourceId) return null;
      assertPayPalFixedTermOrderMatches(value, resource.resourceId, input.creation.purchaseAttemptId,
        input.creation.definition.amountMinor, input.creation.definition.currency, "approval");
      return mutationResult("order", resource.resourceId, "created", { id: value.id, status: value.status, intent: value.intent });
    }
    if (input.operationKind === "fixed_term_order_capture") {
      const orderResource = input.resources.find((candidate) => candidate.resourceKind === "order");
      if (orderResource === undefined) return null;
      if (input.expectedPurchase === undefined) {
        throw new ProviderDispatchManualResolutionError();
      }
      const value = (await this.sdk.orders.getOrder({ id: orderResource.resourceId })).result;
      if (value.id !== orderResource.resourceId) return null;
      if (value.status !== "COMPLETED") return null;
      assertPayPalFixedTermOrderMatches(value, orderResource.resourceId, input.expectedPurchase.purchaseAttemptId,
        input.expectedPurchase.amountMinor, input.expectedPurchase.currency, "completed");
      const captureId = paypalCaptureId(value, input.expectedPurchase.amountMinor,
        input.expectedPurchase.currency);
      return {
        resources: [
          { resourceKind: "order", resourceId: value.id, role: "target" },
          { resourceKind: "capture", resourceId: captureId, role: "created" },
        ],
        responseEvidence: { orderId: value.id, captureId, status: value.status },
      };
    }
    if (input.operationKind === "subscription_cancel" && resource?.resourceKind === "subscription") {
      const value = (await this.sdk.subscriptions.getSubscription({ id: resource.resourceId })).result;
      return value.id === resource.resourceId && value.status === "CANCELLED"
        ? targetResult("subscription", resource.resourceId, { status: value.status }) : null;
    }
    if (input.operationKind === "subscription_refund_terminate" && resource?.resourceKind === "subscription") {
      const value = (await this.sdk.subscriptions.getSubscription({ id: resource.resourceId })).result;
      return value.id === resource.resourceId && value.status === "CANCELLED"
        ? targetResult("subscription", resource.resourceId, { status: value.status }) : null;
    }
    if (input.operationKind === "first_purchase_refund") {
      const target = input.resources.find((candidate) => candidate.role === "target"
        && ["capture", "subscription_transaction"].includes(candidate.resourceKind));
      if (target === undefined) return null;
      const known = input.resources.find((candidate) => candidate.resourceKind === "refund");
      if (known !== undefined) {
        const refund = (await this.sdk.payments.getRefund({ refundId: known.resourceId })).result;
        if (refund.id !== known.resourceId || ["FAILED", "CANCELLED"].includes(refund.status ?? "")) return null;
        return { resources: [{ resourceKind: target.resourceKind, resourceId: target.resourceId, role: "target" },
          { resourceKind: "refund", resourceId: known.resourceId, role: "created" }],
          responseEvidence: { refundId: refund.id, status: refund.status, amount: refund.amount } };
      }
      const capture = (await this.sdk.payments.getCapturedPayment({ captureId: target.resourceId })).result;
      return capture.id === target.resourceId && capture.status === "REFUNDED"
        ? targetResult(target.resourceKind, target.resourceId, { status: capture.status }) : null;
    }
    return null;
  }

  async readApprovalUrl(input: Parameters<CommercialProviderMutationGateway["readApprovalUrl"]>[0]): Promise<string> {
    const value = input.providerResourceKind === "subscription"
      ? (await this.sdk.subscriptions.getSubscription({ id: input.providerResourceId, fields: "plan" })).result
      : input.providerResourceKind === "order"
        ? (await this.sdk.orders.getOrder({ id: input.providerResourceId })).result
        : null;
    if (value === null || value.id !== input.providerResourceId) throw new ProviderDispatchOutcomeUnknownError();
    if (input.providerResourceKind === "subscription") {
      if (input.expectedPurchase === undefined || input.expectedPurchase.purchaseKind !== "subscription"
        || !["monthly", "annual"].includes(input.expectedPurchase.offer)) {
        throw new ProviderDispatchManualResolutionError();
      }
      const definition = { provider: "paypal" as const, purchaseKind: "subscription" as const,
        offer: input.expectedPurchase.offer === "annual" ? "annual" as const : "monthly" as const,
        campaignCode: null, providerItemId: input.expectedPurchase.providerItemId, providerDiscountId: null,
        amountMinor: input.expectedPurchase.amountMinor, currency: input.expectedPurchase.currency };
      const plan = (await this.sdk.plans.getBillingPlan(definition.providerItemId)).result;
      if (!paypalCreatedSubscriptionMatches(value as Subscription, input.providerResourceId,
        input.expectedPurchase.purchaseAttemptId, definition) || !paypalPlanMatches(plan, definition)) {
        throw new ProviderDispatchManualResolutionError();
      }
    }
    if (input.providerResourceKind === "order") {
      if (input.expectedPurchase === undefined) {
        throw new ProviderDispatchManualResolutionError();
      }
      assertPayPalFixedTermOrderMatches(value as Order, input.providerResourceId,
        input.expectedPurchase.purchaseAttemptId, input.expectedPurchase.amountMinor,
        input.expectedPurchase.currency, "approval");
    }
    return approvalUrl(value, this.approvalOrigin);
  }
}

function approvalUrl(
  value: Pick<Subscription, "id" | "links"> | Pick<Order, "id" | "links">,
  approvalOrigin: string,
): string {
  requiredId(value.id, "PayPal resource");
  const link = value.links?.find((candidate) => candidate.rel === "approve");
  if (link === undefined) throw new TypeError("PayPal resource has no approval URL");
  return officialApprovalUrl(link.href, [approvalOrigin]);
}

function paypalPlanMatches(
  plan: BillingPlan,
  definition: Parameters<CommercialProviderMutationGateway["create"]>[0]["definition"],
): boolean {
  return plan.id === definition.providerItemId
    && plan.status === "ACTIVE"
    && paypalPlanDetailsMatch(plan, definition);
}

/** Provider Order fields are untrusted until every immutable commercial binding is proven. */
function assertPayPalFixedTermOrderMatches(
  order: Order,
  orderId: string,
  purchaseAttemptId: string,
  expectedAmountMinor: number,
  expectedCurrency: "USD",
  stage: "approval" | "capture" | "completed",
): void {
  const expectedStatus = stage === "approval" ? ["CREATED", "PAYER_ACTION_REQUIRED"]
    : stage === "capture" ? ["APPROVED"] : ["COMPLETED"];
  if (order.id !== orderId
    || !expectedStatus.includes(order.status ?? "")
    || order.intent !== CheckoutPaymentIntent.Capture
    || order.purchaseUnits?.length !== 1) {
    throw new ProviderDispatchManualResolutionError();
  }
  const unit = order.purchaseUnits[0];
  if (unit === undefined || unit.referenceId !== purchaseAttemptId || unit.customId !== purchaseAttemptId
    || unit.invoiceId !== purchaseAttemptId || unit.amount === undefined
    || unit.amount.breakdown !== undefined || unit.amount.currencyCode !== expectedCurrency
    || paypalUsdMinor(unit.amount) !== expectedAmountMinor
    || unit.shipping !== undefined || unit.items !== undefined
    || unit.paymentInstruction !== undefined || unit.supplementaryData !== undefined
    || unit.softDescriptor !== undefined || unit.mostRecentErrors !== undefined) {
    throw new ProviderDispatchManualResolutionError();
  }
}

function paypalCreatedSubscriptionMatches(
  subscription: Subscription,
  subscriptionId: string,
  purchaseAttemptId: string,
  definition: Parameters<CommercialProviderMutationGateway["create"]>[0]["definition"],
): boolean {
  return subscription.id === subscriptionId
    && subscription.planId === definition.providerItemId
    && subscription.customId === purchaseAttemptId
    && subscription.planOverridden !== true
    && (subscription.quantity === undefined || subscription.quantity === "1")
    && subscription.shippingAmount === undefined
    && subscription.plan !== undefined
    && paypalPlanDetailsMatch(subscription.plan, definition);
}

function paypalPlanDetailsMatch(
  plan: Pick<PlanDetails, "billingCycles" | "paymentPreferences" | "quantitySupported" | "taxes">,
  definition: Parameters<CommercialProviderMutationGateway["create"]>[0]["definition"],
): boolean {
  const cycles = plan.billingCycles ?? [];
  const regular = cycles.filter((cycle) => cycle.tenureType === "REGULAR");
  const expectedFrequency = definition.offer === "monthly" ? "MONTH"
    : definition.offer === "annual" ? "YEAR" : null;
  if (definition.purchaseKind !== "subscription" || expectedFrequency === null
    || cycles.length !== 1 || regular.length !== 1) return false;
  const cycle = regular[0]!;
  return cycle.sequence === 1
    && cycle.totalCycles === 0
    && cycle.frequency.intervalUnit === expectedFrequency
    && (cycle.frequency.intervalCount ?? 1) === 1
    && cycle.pricingScheme?.pricingModel === undefined
    && (cycle.pricingScheme?.tiers === undefined || cycle.pricingScheme.tiers.length === 0)
    && paypalUsdMinor(cycle.pricingScheme?.fixedPrice) === definition.amountMinor
    && plan.quantitySupported === false
    && isAbsentOrZeroUsd(plan.paymentPreferences?.setupFee)
    && isAbsentOrZeroPercentage(plan.taxes?.percentage);
}

function isAbsentOrZeroUsd(value: { readonly currencyCode?: string; readonly value?: string } | undefined): boolean {
  return value === undefined || paypalUsdMinor(value) === 0;
}

function paypalUsdMinor(value: { readonly currencyCode?: string; readonly value?: string } | undefined): number | null {
  if (value?.currencyCode !== "USD" || typeof value.value !== "string"
    || !/^(?:0|[1-9]\d*)\.\d{2}$/u.test(value.value)) return null;
  const [whole, fraction] = value.value.split(".");
  const minor = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(minor) ? minor : null;
}

function isAbsentOrZeroPercentage(value: string | undefined): boolean {
  return value === undefined || /^(?:0+)(?:\.0+)?$/u.test(value);
}

function assertAuthorization(
  authorization: Parameters<CommercialProviderMutationGateway["create"]>[0]["authorization"],
  provider: "stripe" | "paypal",
  operationKind: Parameters<CommercialProviderMutationGateway["recover"]>[0]["operationKind"],
): void {
  consumeProviderSdkAuthorization(authorization);
  const expiresAt = Date.parse(authorization.expiresAt);
  const consumedAt = Date.parse(authorization.consumedAt);
  if (authorization.provider !== provider || authorization.operationKind !== operationKind
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
    || !Number.isFinite(consumedAt)
    || authorization.providerIdempotencyKey.length < 1) {
    throw new TypeError("consumed provider dispatch authorization is invalid");
  }
}

function officialApprovalUrl(value: string, allowedOrigins: readonly string[]): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new ProviderDispatchOutcomeUnknownError(); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || !allowedOrigins.includes(parsed.origin)) throw new ProviderDispatchOutcomeUnknownError();
  return parsed.toString();
}

function normalizeCreationError(error: unknown): ProviderDispatchRejectedError | ProviderDispatchOutcomeUnknownError
  | ProviderDispatchManualResolutionError {
  if (error instanceof ProviderDispatchRejectedError
    || error instanceof ProviderDispatchOutcomeUnknownError
    || error instanceof ProviderDispatchManualResolutionError) return error;
  const status = providerStatus(error);
  return status !== null && status >= 400 && status < 500 && ![408, 425, 429].includes(status)
    ? new ProviderDispatchRejectedError()
    : new ProviderDispatchOutcomeUnknownError();
}

function mutationResult(resourceKind: string, resourceId: string,
  role: ProviderMutationResult["resources"][number]["role"], evidence: unknown): ProviderMutationResult {
  return { resources: [{ resourceKind, resourceId, role }], responseEvidence: evidence };
}

function assertStripeCheckoutMatches(
  session: Stripe.Checkout.Session,
  purchaseAttemptId: string,
  definition: Pick<Parameters<CommercialProviderMutationGateway["create"]>[0]["definition"],
    "purchaseKind" | "amountMinor" | "currency">,
): void {
  const expectedMode = definition.purchaseKind === "subscription" ? "subscription" : "payment";
  if (session.mode !== expectedMode
    || session.client_reference_id !== purchaseAttemptId
    || session.metadata?.gooddealer_purchase_attempt_id !== purchaseAttemptId
    || session.currency !== definition.currency.toLowerCase()
    || session.amount_total !== definition.amountMinor) {
    throw new ProviderDispatchManualResolutionError();
  }
}

function createdResult(resourceKind: string, resourceId: string, evidence: unknown): ProviderMutationResult {
  return mutationResult(resourceKind, resourceId, "created", evidence);
}

function targetResult(resourceKind: string, resourceId: string, evidence: unknown): ProviderMutationResult {
  return { resources: [{ resourceKind, resourceId, role: "target" }], responseEvidence: evidence };
}

function oneResource(resources: Parameters<CommercialProviderMutationGateway["recover"]>[0]["resources"]):
  typeof resources[number] | null {
  return resources.length === 1 ? resources[0] ?? null : null;
}

function requiredId(value: string | undefined, label: string): string {
  if (typeof value !== "string" || value.length < 1) throw new ProviderDispatchOutcomeUnknownError(`${label} has no id`);
  return value;
}

function objectId(value: string | { readonly id: string } | null | undefined): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  return value !== null && value !== undefined && typeof value.id === "string" && value.id.length > 0
    ? value.id : null;
}

function paypalCaptureId(order: Order, expectedAmountMinor: number, expectedCurrency: "USD"): string {
  const captures = order.purchaseUnits?.flatMap((unit) => unit.payments?.captures ?? []) ?? [];
  const capture = captures[0];
  if (captures.length !== 1 || typeof capture?.id !== "string" || capture.id.length < 1
    || capture.status !== "COMPLETED" || capture.amount === undefined) {
    throw new ProviderDispatchOutcomeUnknownError();
  }
  if (capture.amount.currencyCode !== expectedCurrency
    || paypalUsdMinor(capture.amount) !== expectedAmountMinor) {
    throw new ProviderDispatchManualResolutionError();
  }
  return capture.id;
}

function providerStatus(error: unknown): number | null {
  if (error === null || typeof error !== "object") return null;
  for (const key of ["statusCode", "status"] as const) {
    const value = Reflect.get(error, key);
    if (Number.isInteger(value)) return value as number;
  }
  return null;
}

function assertReturnUrls(urls: CommercialReturnUrls): void {
  for (const value of [urls.successUrl, urls.cancelUrl]) {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
      throw new TypeError("commercial return URL is invalid");
    }
  }
}

function minorUsd(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("commercial amount is invalid");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function invalidPayPalEnvironment(): never { throw new TypeError("PayPal environment is invalid"); }
