import { createHash, createVerify } from "node:crypto";

import {
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  SubscriptionsController,
  type Order,
  type Subscription,
} from "@paypal/paypal-server-sdk";

import {
  CommercialSubscriptionPlanCatalog,
  canonicalSecond,
} from "../commercial-plan-catalog";
import type { LinkReceiptResourcesCommand } from "../commercial-domain";
import {
  PaymentWebhookAuthenticationError,
  type AuthenticatedProviderEvent,
  type CommercialProviderReader,
  type PaymentWebhookAuthenticator,
  type ReconciledCommercialObservation,
} from "../payment-webhook-service";
import { providerResourceBindingDigest } from "../provider-resource-identity";
import type { PayPalCommercialSdk } from "./commercial-checkout";
import {
  fixedTermObservation,
  type FixedTermCommercialPolicy,
} from "./stripe";

interface PayPalWebhookEvent {
  readonly id: string;
  readonly eventType: string;
  readonly createTime: string;
  readonly resourceId: string;
}

export interface PayPalSubscriptionReader {
  getSubscription(input: { readonly id: string }): Promise<{ readonly result: Subscription }>;
  listSubscriptionTransactions(input: { readonly id: string; readonly startTime: string; readonly endTime: string }):
    Promise<{ readonly result: { readonly transactions?: readonly {
      readonly id: string; readonly status?: string; readonly time: string;
      readonly amountWithBreakdown: { readonly grossAmount: { readonly currencyCode?: string; readonly value?: string } };
    }[]; readonly totalItems?: number; readonly totalPages?: number } }>;
}

export interface PayPalOrderReader {
  getOrder(input: { id: string }): Promise<{ readonly result: Order }>;
}

export interface PayPalCaptureReader {
  getCapturedPayment(input: { readonly captureId: string }): Promise<{ readonly result: {
    readonly id?: string;
    readonly status?: string;
    readonly amount?: { readonly currencyCode?: string; readonly value?: string };
    readonly createTime?: string;
    readonly updateTime?: string;
    readonly supplementaryData?: { readonly relatedIds?: { readonly orderId?: string } };
  } }>;
}

export interface PayPalCertificateResolver {
  resolve(certificateUrl: string): Promise<string>;
}

export interface PayPalPaymentAdapterDependencies {
  readonly certificates: PayPalCertificateResolver;
  readonly webhookId: string;
}

export interface PayPalCommercialReaderDependencies {
  readonly subscriptions: PayPalSubscriptionReader;
  readonly orders: PayPalOrderReader;
  readonly payments: PayPalCaptureReader;
  readonly plans: CommercialSubscriptionPlanCatalog;
  readonly fixedTermPolicy: FixedTermCommercialPolicy;
}

export interface PayPalSdkConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly environment: "sandbox" | "production";
}

export function createPayPalSubscriptionReader(config: PayPalSdkConfiguration): PayPalSubscriptionReader {
  return new SubscriptionsController(createPayPalClient(config));
}

export function createPayPalCommercialSdk(config: PayPalSdkConfiguration): PayPalCommercialSdk {
  const client = createPayPalClient(config);
  const subscriptions = new SubscriptionsController(client);
  return {
    plans: subscriptions,
    subscriptions,
    orders: new OrdersController(client),
    payments: new PaymentsController(client),
  } as PayPalCommercialSdk;
}

function createPayPalClient(config: PayPalSdkConfiguration): Client {
  if (config.clientId.length < 1 || config.clientSecret.length < 1) {
    throw new TypeError("PayPal API credentials are unavailable");
  }
  if (config.environment !== "production" && config.environment !== "sandbox") {
    throw new TypeError("PayPal environment is invalid");
  }
  return new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: config.clientId,
      oAuthClientSecret: config.clientSecret,
    },
    environment: config.environment === "production" ? Environment.Production : Environment.Sandbox,
  });
}

/** Verifies PayPal's raw-byte transcript and returns only a resource trigger. */
export class PayPalPaymentWebhookAdapter implements PaymentWebhookAuthenticator {
  constructor(private readonly deps: PayPalPaymentAdapterDependencies) {
    if (deps.webhookId.length < 1) throw new TypeError("PayPal webhook id is unavailable");
  }

  async authenticate(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
    evaluatedAt: Date,
  ): Promise<AuthenticatedProviderEvent> {
    await verifyPayPalSignature(rawBody, headers, this.deps.webhookId, this.deps.certificates, evaluatedAt);
    const event = parsePayPalEvent(rawBody);
    if (event.eventType === "PAYMENT.CAPTURE.COMPLETED") return trigger(event, "order");
    if (event.eventType === "PAYMENT.CAPTURE.REFUNDED" || event.eventType === "PAYMENT.CAPTURE.REVERSED") {
      return trigger(event, "capture");
    }
    if (event.eventType.startsWith("BILLING.SUBSCRIPTION.")) {
      return trigger(event, "subscription");
    }
    return { kind: "ignored", provider: "paypal", providerEventId: event.id, eventType: event.eventType,
      ignoredReason: event.eventType.startsWith("TEST.") ? "test_event" : "unsupported_event",
      occurredAt: canonicalSecond(event.createTime, "PayPal event time"), authenticatedEvidenceRef: `paypal-event-${event.id}` };
  }
}

/** Reads one exact server-bound PayPal resource outside every database transaction. */
export class PayPalCommercialProviderReader implements CommercialProviderReader {
  readonly provider = "paypal" as const;

  constructor(private readonly deps: PayPalCommercialReaderDependencies) {}

  async read(input: {
    readonly providerResourceKind: string;
    readonly providerResourceId: string;
    readonly purchaseKind: "subscription" | "fixed_term";
    readonly evaluatedAt: Date;
    readonly receiptEventType: string | null;
    readonly receiptProviderEventId: string | null;
    readonly receiptTriggerResourceKind: string | null;
    readonly receiptTriggerResourceId: string | null;
  }): Promise<ReconciledCommercialObservation> {
    if (input.purchaseKind === "subscription" && input.providerResourceKind === "subscription") {
      const subscription = (await this.deps.subscriptions.getSubscription({ id: input.providerResourceId })).result;
      if (
        subscription.id !== input.providerResourceId || typeof subscription.planId !== "string"
        || subscription.status === undefined
      ) throw new TypeError("PayPal subscription identity is invalid");
      const expiry = subscription.billingInfo?.nextBillingTime
        ?? subscription.billingInfo?.finalPaymentTime
        ?? subscription.statusUpdateTime
        ?? subscription.startTime;
      if (expiry === undefined) throw new TypeError("PayPal subscription has no commercial deadline");
      const authority = this.deps.plans.authority(
        "paypal",
        subscription.planId,
        expiry,
        input.evaluatedAt.toISOString(),
      );
      const paymentReceiptEventType = input.receiptTriggerResourceKind !== null
        && ["capture", "sale", "subscription_transaction"].includes(input.receiptTriggerResourceKind)
        ? input.receiptEventType : null;
      const initialPayment = await this.paypalSubscriptionInitialPayment(subscription, input.evaluatedAt,
        paymentReceiptEventType);
      if (input.receiptTriggerResourceKind !== null
        && !((input.receiptTriggerResourceKind === "subscription" && input.receiptTriggerResourceId === subscription.id)
          || (["capture", "sale", "subscription_transaction"].includes(input.receiptTriggerResourceKind)
            && input.receiptTriggerResourceId === initialPayment.evidence.resourceId))) {
        throw new TypeError("PayPal reconciliation trigger does not belong to the canonical Subscription");
      }
      return {
        provider: "paypal",
        providerResourceKind: "subscription",
        providerResourceId: subscription.id,
        providerAccess: initialPayment.reversal === "none" ? paypalAccess(subscription.status) : "refunded",
        renewalDisposition: subscription.status === "CANCELLED" || subscription.status === "EXPIRED"
          ? "terminated" : "renewing",
        observedPaidThrough: canonicalSecond(expiry, "PayPal paid-through time"),
        observedAt: canonicalSecond(input.evaluatedAt.toISOString(), "provider observation time"),
        plan: authority.plan,
        featureEntitlements: authority.featureEntitlements,
        reversal: initialPayment.reversal,
        paymentEvidence: initialPayment.evidence,
        refundFact: initialPayment.refundFact,
      };
    }
    if (input.purchaseKind === "fixed_term" && input.providerResourceKind === "order") {
      const order = (await this.deps.orders.getOrder({ id: input.providerResourceId })).result;
      if (order.id !== input.providerResourceId || order.status !== "COMPLETED") {
        throw new TypeError("PayPal fixed-term Order is not completed");
      }
      if (typeof order.createTime !== "string") throw new TypeError("PayPal Order time is unavailable");
      const captures = order.purchaseUnits?.flatMap((unit) => unit.payments?.captures ?? []) ?? [];
      if (captures.length !== 1 || typeof captures[0]?.id !== "string") {
        throw new TypeError("PayPal fixed-term Order has no unique Capture");
      }
      const capture = (await this.deps.payments.getCapturedPayment({ captureId: captures[0].id })).result;
      if (capture.id !== captures[0].id || capture.supplementaryData?.relatedIds?.orderId !== undefined
        && capture.supplementaryData.relatedIds.orderId !== order.id) {
        throw new TypeError("PayPal fixed-term Capture identity conflicts");
      }
      const amount = paypalUsdMinor(capture.amount);
      const settledAt = canonicalSecond(capture.updateTime ?? capture.createTime ?? "", "PayPal Capture settlement time");
      if (new Date(settledAt).getTime() > input.evaluatedAt.getTime() + 5 * 60_000) {
        throw new TypeError("PayPal Capture settlement time is in the future");
      }
      if (input.receiptTriggerResourceKind !== null
        && (input.receiptTriggerResourceKind !== "capture" || input.receiptTriggerResourceId !== capture.id)) {
        throw new TypeError("PayPal reconciliation trigger does not belong to the canonical payment");
      }
      const refundState = paypalCaptureRefundState(capture.status, input.receiptEventType);
      return { ...fixedTermObservation(
        "paypal",
        "order",
        order.id,
        addCalendarYears(order.createTime, 10),
        input.evaluatedAt,
        this.deps.fixedTermPolicy,
      ), providerAccess: refundState.reversal === "none" ? "active" : "refunded",
        reversal: refundState.reversal, refundFact: refundState.refundFact,
        paymentEvidence: { purpose: "acquisition_initial", resourceKind: "capture", resourceId: capture.id,
          bindingDigest: providerResourceBindingDigest("paypal", "capture", capture.id),
          settledAt, grossMinor: amount, currency: "USD",
          cumulativeRefundedMinor: capture.status === "REFUNDED" ? amount : 0,
          sourceDigest: digest({ orderId: order.id, captureId: capture.id, status: capture.status,
            settledAt, grossMinor: amount, currency: "USD" }) } };
    }
    throw new TypeError("PayPal reconciliation resource kind is invalid");
  }

  async handoffForReceipt(work: Parameters<NonNullable<CommercialProviderReader["handoffForReceipt"]>>[0],
    evaluatedAt: Date): Promise<Awaited<ReturnType<NonNullable<CommercialProviderReader["handoffForReceipt"]>>>> {
    if (work.provider !== "paypal") return null;
    if (work.triggerResourceKind === "subscription" && work.eventType === "BILLING.SUBSCRIPTION.ACTIVATED") {
      const subscription = (await this.deps.subscriptions.getSubscription({ id: work.triggerResourceId })).result;
      if (subscription.id !== work.triggerResourceId) throw new TypeError("PayPal subscription identity conflicts");
      const fact = providerFact("subscription", work.triggerResourceId, "canonical_agreement");
      const initial = await this.paypalSubscriptionInitialPayment(subscription, evaluatedAt);
      const paymentResources = [{ resourceKind: "subscription_transaction" as const,
        resourceId: initial.evidence.resourceId, bindingDigest: initial.evidence.bindingDigest }];
      return { observationDigest: digest({ subscription: fact, paymentResources }), paymentResources,
        handoff: { kind: "paypal_subscription", subscription: fact } };
    }
    if (work.triggerResourceKind === "order") {
      return this.fixedTermHandoff(work.triggerResourceId, work.occurredAt);
    }
    return null;
  }

  async handoffForOperation(
    work: Parameters<NonNullable<CommercialProviderReader["handoffForOperation"]>>[0],
    resources: Parameters<NonNullable<CommercialProviderReader["handoffForOperation"]>>[1],
    _evaluatedAt: Date,
  ): Promise<Awaited<ReturnType<NonNullable<CommercialProviderReader["handoffForOperation"]>>>> {
    if (work.provider !== "paypal") return null;
    if (work.operationKind === "subscription_create") {
      const stored = requireFact(resources, "subscription");
      const subscription = (await this.deps.subscriptions.getSubscription({ id: stored.resourceId })).result;
      if (subscription.id !== stored.resourceId) throw new TypeError("PayPal subscription identity conflicts");
      const fact = providerFact("subscription", stored.resourceId, "canonical_agreement");
      assertSameBinding(stored, fact);
      return { observationDigest: digest({ subscription: fact }), paymentResources: [],
        handoff: { kind: "paypal_subscription", subscription: fact } };
    }
    if (work.operationKind === "fixed_term_order_capture" && work.providerResourceKind === "order"
      && work.providerResourceId !== null) {
      return this.fixedTermHandoff(work.providerResourceId, null, resources);
    }
    return null;
  }

  async resolveReceiptResourceBinding(
    work: Parameters<NonNullable<CommercialProviderReader["resolveReceiptResourceBinding"]>>[0],
    evaluatedAt: Date,
  ): Promise<LinkReceiptResourcesCommand | null> {
    if (work.provider !== "paypal" || !["subscription", "capture"].includes(work.triggerResourceKind)) return null;
    if (work.triggerResourceKind === "subscription") {
      const subscription = (await this.deps.subscriptions.getSubscription({ id: work.triggerResourceId })).result;
      if (subscription.id !== work.triggerResourceId) throw new TypeError("PayPal subscription identity conflicts");
      const initial = await this.paypalSubscriptionInitialPayment(subscription, evaluatedAt);
      return {
        anchorResourceKind: "subscription",
        anchorResourceId: subscription.id,
        anchorBindingDigest: providerResourceBindingDigest("paypal", "subscription", subscription.id),
        resources: [{ resourceKind: "subscription_transaction", resourceId: initial.evidence.resourceId,
          bindingDigest: initial.evidence.bindingDigest, linkRole: "initial_payment" }],
      };
    }
    const capture = (await this.deps.payments.getCapturedPayment({ captureId: work.triggerResourceId })).result;
    if (capture.id !== work.triggerResourceId) throw new TypeError("PayPal reversal Capture identity conflicts");
    const anchorResourceKind = capture.supplementaryData?.relatedIds?.orderId === undefined
      ? "subscription_transaction" : "capture";
    const linkRole = anchorResourceKind === "capture" ? "capture_evidence"
      : work.eventType === "PAYMENT.CAPTURE.REVERSED" ? "reversal_evidence" : "refund_evidence";
    return {
      anchorResourceKind,
      anchorResourceId: work.triggerResourceId,
      anchorBindingDigest: providerResourceBindingDigest("paypal", anchorResourceKind, work.triggerResourceId),
      resources: [{ resourceKind: "capture", resourceId: work.triggerResourceId,
        bindingDigest: providerResourceBindingDigest("paypal", "capture", work.triggerResourceId),
        linkRole }],
    };
  }

  private async paypalSubscriptionInitialPayment(subscription: Subscription, evaluatedAt: Date,
    receiptEventType: string | null = null): Promise<{
    readonly evidence: NonNullable<ReconciledCommercialObservation["paymentEvidence"]>;
    readonly reversal: "none" | "refund" | "fraud";
    readonly refundFact: ReconciledCommercialObservation["refundFact"] }> {
    if (typeof subscription.id !== "string" || typeof subscription.startTime !== "string") {
      throw new TypeError("PayPal Subscription creation interval is unavailable");
    }
    const start = new Date(subscription.startTime);
    if (!Number.isFinite(start.getTime()) || start.getTime() > evaluatedAt.getTime() + 5 * 60_000) {
      throw new TypeError("PayPal Subscription creation interval is invalid");
    }
    const end = new Date(Math.min(evaluatedAt.getTime(), start.getTime() + 31 * 24 * 60 * 60_000));
    const response = (await this.deps.subscriptions.listSubscriptionTransactions({ id: subscription.id,
      startTime: canonicalSecond(start.toISOString(), "PayPal Subscription transaction range start"),
      endTime: canonicalSecond(end.toISOString(), "PayPal Subscription transaction range end") })).result;
    const transactions = [...(response.transactions ?? [])];
    if (response.totalPages !== 1 || response.totalItems !== transactions.length) {
      throw new TypeError("PayPal Subscription transaction range is incomplete");
    }
    const settled = transactions.filter((transaction) => ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]
      .includes(transaction.status ?? "")).map((transaction) => ({ transaction,
        at: new Date(transaction.time).getTime() })).filter(({ at }) => Number.isFinite(at)
          && at <= evaluatedAt.getTime() + 5 * 60_000).sort((a, b) => a.at - b.at);
    if (settled.length < 1 || settled[0] === undefined || settled[1]?.at === settled[0].at) {
      throw new TypeError("PayPal Subscription initial payment is missing or ambiguous");
    }
    const first = settled[0].transaction;
    assertIdentifier(first.id, "PayPal Subscription transaction id");
    const grossMinor = paypalUsdMinor(first.amountWithBreakdown.grossAmount);
    const settledAt = canonicalSecond(first.time, "PayPal Subscription initial settlement time");
    // PayPal's subscription transaction response has no refund ledger or cumulative
    // refunded amount. A PARTIALLY_REFUNDED transaction therefore cannot produce
    // trustworthy payment evidence; fail closed instead of reporting zero and
    // accidentally granting/releasing against an under-refunded initial payment.
    if (first.status === "PARTIALLY_REFUNDED") {
      throw new TypeError("PayPal Subscription initial payment partial refund amount is unverifiable");
    }
    const refund = paypalCaptureRefundState(first.status, receiptEventType);
    return { reversal: refund.reversal, refundFact: refund.refundFact, evidence: {
      purpose: "acquisition_initial", resourceKind: "subscription_transaction", resourceId: first.id,
      bindingDigest: providerResourceBindingDigest("paypal", "subscription_transaction", first.id),
      settledAt, grossMinor, currency: "USD", cumulativeRefundedMinor: first.status === "REFUNDED" ? grossMinor : 0,
      sourceDigest: digest({ subscriptionId: subscription.id, transactionId: first.id, status: first.status,
        settledAt, grossMinor, currency: "USD", rangeStart: start.toISOString(), rangeEnd: end.toISOString(),
        totalItems: response.totalItems, totalPages: response.totalPages }) } };
  }

  private async fixedTermHandoff(orderId: string, authenticatedOccurrence: string | null,
    expectedResources?: Parameters<NonNullable<CommercialProviderReader["handoffForOperation"]>>[1]) {
    const order = (await this.deps.orders.getOrder({ id: orderId })).result;
    if (order.id !== orderId || order.status !== "COMPLETED") {
      throw new TypeError("PayPal fixed-term Order identity conflicts");
    }
    const captures = order.purchaseUnits?.flatMap((unit) => unit.payments?.captures ?? []) ?? [];
    if (captures.length !== 1 || typeof captures[0]?.id !== "string" || captures[0].status !== "COMPLETED") {
      throw new TypeError("PayPal fixed-term Order has no unique completed Capture");
    }
    assertIdentifier(captures[0].id, "PayPal Capture id");
    const orderFact = providerFact("order", orderId, "order_origin");
    const captureFact = providerFact("capture", captures[0].id, "capture_evidence");
    if (expectedResources !== undefined) {
      assertSameBinding(requireFact(expectedResources, "order"), orderFact);
      assertSameBinding(requireFact(expectedResources, "capture"), captureFact);
    }
    const captureTime = typeof captures[0].updateTime === "string" ? captures[0].updateTime : authenticatedOccurrence;
    if (captureTime === null) throw new TypeError("PayPal Capture time is unavailable");
    const capturedAt = canonicalSecond(captureTime, "PayPal capture time");
    const paymentResources = [{ resourceKind: "capture" as const, resourceId: captureFact.resourceId,
      bindingDigest: captureFact.bindingDigest }];
    return { observationDigest: digest({ order: orderFact, capture: captureFact, capturedAt, paymentResources }), paymentResources,
      handoff: { kind: "paypal_fixed_term" as const, order: orderFact, capture: captureFact, capturedAt } };
  }
}

function providerFact(resourceKind: string, resourceId: string,
  role: "canonical_agreement" | "order_origin" | "capture_evidence") {
  return { resourceKind, resourceId, role,
    bindingDigest: providerResourceBindingDigest("paypal", resourceKind, resourceId) };
}

function digest(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}

function requireFact(resources: readonly { readonly resourceKind: string; readonly resourceId: string;
  readonly bindingDigest: Uint8Array }[], resourceKind: string) {
  const values = resources.filter((resource) => resource.resourceKind === resourceKind);
  if (values.length !== 1 || values[0] === undefined) throw new TypeError(`PayPal ${resourceKind} evidence is unavailable`);
  return values[0];
}

function assertSameBinding(expected: { readonly resourceKind: string; readonly resourceId: string;
  readonly bindingDigest: Uint8Array }, actual: { readonly resourceKind: string; readonly resourceId: string;
    readonly bindingDigest: Uint8Array }): void {
  if (expected.resourceKind !== actual.resourceKind || expected.resourceId !== actual.resourceId
    || !Buffer.from(expected.bindingDigest).equals(Buffer.from(actual.bindingDigest))) {
    throw new TypeError("PayPal provider resource binding conflicts");
  }
}

function trigger(event: PayPalWebhookEvent, providerResourceKind: string): AuthenticatedProviderEvent {
  return {
    kind: "actionable",
    provider: "paypal",
    providerEventId: event.id,
    eventType: event.eventType,
    triggerResourceKind: providerResourceKind,
    triggerResourceId: event.resourceId,
    occurredAt: canonicalSecond(event.createTime, "PayPal event time"),
    authenticatedEvidenceRef: `paypal-event-${event.id}`,
  };
}

async function verifyPayPalSignature(
  rawBody: Buffer,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  webhookId: string,
  certificates: PayPalCertificateResolver,
  evaluatedAt: Date,
): Promise<void> {
  const transmissionId = requiredHeader(headers, "paypal-transmission-id");
  const transmissionTime = requiredHeader(headers, "paypal-transmission-time");
  const certificateUrl = requiredHeader(headers, "paypal-cert-url");
  const algorithm = requiredHeader(headers, "paypal-auth-algo");
  const encodedSignature = requiredHeader(headers, "paypal-transmission-sig");
  if (algorithm !== "SHA256withRSA") throw new PaymentWebhookAuthenticationError();
  const transmittedAt = Date.parse(transmissionTime);
  if (!Number.isFinite(transmittedAt) || !Number.isFinite(evaluatedAt.getTime())
    || Math.abs(evaluatedAt.getTime() - transmittedAt) > 5 * 60 * 1_000) {
    throw new PaymentWebhookAuthenticationError();
  }
  const certificate = await certificates.resolve(certificateUrl);
  const message = `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}`;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(message, "utf8");
  verifier.end();
  let valid = false;
  try {
    valid = verifier.verify(certificate, Buffer.from(encodedSignature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) throw new PaymentWebhookAuthenticationError();
}

function parsePayPalEvent(rawBody: Buffer): PayPalWebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new TypeError("authenticated PayPal event is not JSON");
  }
  if (!isObject(value) || typeof value.id !== "string" || typeof value.event_type !== "string"
    || typeof value.create_time !== "string" || !isObject(value.resource)) {
    throw new TypeError("authenticated PayPal event is malformed");
  }
  assertIdentifier(value.id, "PayPal event id");
  let resourceId: string | undefined;
  if (value.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const supplementary = value.resource.supplementary_data;
    const related = isObject(supplementary) ? supplementary.related_ids : undefined;
    resourceId = isObject(related) && typeof related.order_id === "string" ? related.order_id : undefined;
  } else if (value.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    const supplementary = value.resource.supplementary_data;
    const related = isObject(supplementary) ? supplementary.related_ids : undefined;
    resourceId = isObject(related) && typeof related.capture_id === "string" ? related.capture_id : undefined;
  } else if (value.event_type === "PAYMENT.CAPTURE.REVERSED") {
    resourceId = typeof value.resource.id === "string" ? value.resource.id : undefined;
  } else if (value.event_type.startsWith("BILLING.SUBSCRIPTION.")) {
    resourceId = typeof value.resource.id === "string" ? value.resource.id : undefined;
  } else {
    resourceId = "ignored";
  }
  if (resourceId === undefined) throw new TypeError("authenticated PayPal event has no resource identity");
  assertIdentifier(resourceId, "PayPal resource id");
  return { id: value.id, eventType: value.event_type, createTime: value.create_time, resourceId };
}

function paypalAccess(status: Subscription["status"]): ReconciledCommercialObservation["providerAccess"] {
  switch (status) {
    case "ACTIVE": return "active";
    case "APPROVAL_PENDING":
    case "APPROVED": return "pending";
    case "SUSPENDED": return "suspended";
    case "CANCELLED":
    case "EXPIRED": return "ended";
    default: throw new TypeError("PayPal subscription status is unsupported");
  }
}

function requiredHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string {
  const value = headers[name];
  if (typeof value !== "string" || value.length < 1) throw new PaymentWebhookAuthenticationError();
  return value;
}

function addCalendarYears(value: string, years: number): string {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) throw new TypeError("PayPal Order time is invalid");
  const month = source.getUTCMonth();
  source.setUTCFullYear(source.getUTCFullYear() + years);
  if (source.getUTCMonth() !== month) source.setUTCDate(0);
  return canonicalSecond(source.toISOString(), "fixed-term commercial expiry");
}

function paypalUsdMinor(amount: { readonly currencyCode?: string; readonly value?: string } | undefined): number {
  if (amount?.currencyCode !== "USD" || typeof amount.value !== "string"
    || !/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/u.test(amount.value)) {
    throw new TypeError("PayPal Capture amount is invalid");
  }
  const [major, fraction] = amount.value.split(".");
  const minor = Number(major) * 100 + Number(fraction);
  if (!Number.isSafeInteger(minor) || minor < 1) throw new TypeError("PayPal Capture amount is invalid");
  return minor;
}

function paypalCaptureRefundState(status: string | undefined, eventType: string | null): {
  readonly reversal: "none" | "refund" | "fraud";
  readonly refundFact: ReconciledCommercialObservation["refundFact"];
} {
  if (status === "REFUNDED") return eventType === "PAYMENT.CAPTURE.REVERSED"
    ? { reversal: "fraud", refundFact: "full_reversal_settled" }
    : { reversal: "refund", refundFact: "refund_succeeded" };
  if (status === "PARTIALLY_REFUNDED") return { reversal: "none", refundFact: "partial_refund" };
  if (status === "COMPLETED") {
    if (eventType === "PAYMENT.CAPTURE.REFUNDED") return { reversal: "none", refundFact: "refund_pending" };
    if (eventType === "PAYMENT.CAPTURE.REVERSED") return { reversal: "none", refundFact: "fraud_signal" };
    return { reversal: "none", refundFact: "none" };
  }
  throw new TypeError("PayPal Capture status is not settled");
}

function crc32(value: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length < 1 || value.length > 160 || !/^[!-~]+$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
