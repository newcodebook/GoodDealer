import Stripe from "stripe";
import { createHash } from "node:crypto";

import {
  CommercialSubscriptionPlanCatalog,
  canonicalSecond,
} from "../commercial-plan-catalog";
import type { InitialPaymentResourceFact, LinkReceiptResourcesCommand,
  SupplementalAgreementResourceFact } from "../commercial-domain";
import {
  PaymentWebhookAuthenticationError,
  type AuthenticatedProviderEvent,
  type CommercialProviderReader,
  type PaymentWebhookAuthenticator,
  type ReconciledCommercialObservation,
} from "../payment-webhook-service";
import { providerResourceBindingDigest } from "../provider-resource-identity";

export interface FixedTermCommercialPolicy {
  readonly plan: string;
  readonly featureEntitlements: readonly string[];
  readonly offlineGraceSeconds: number;
  readonly credentialRefreshSeconds: number;
}

export interface StripeWebhookAuthenticatorDependencies {
  readonly sdk: Pick<Stripe, "webhooks">;
  readonly webhookSecret: string;
}

export interface StripeCommercialReaderDependencies {
  readonly sdk: Pick<Stripe, "subscriptions" | "checkout" | "refunds" | "charges" | "disputes"
    | "paymentIntents" | "invoicePayments" | "invoices">;
  readonly plans: CommercialSubscriptionPlanCatalog;
  readonly fixedTermPolicy: FixedTermCommercialPolicy;
}

/** Official Stripe SDK composition; callers obtain the API key from their secret manager. */
export function createStripeSdk(apiKey: string): Stripe {
  if (apiKey.length < 1) throw new TypeError("Stripe API credential is unavailable");
  return new Stripe(apiKey, { maxNetworkRetries: 2 });
}

/** Authenticates a trigger only. It performs no Stripe resource fetch. */
export class StripePaymentWebhookAdapter implements PaymentWebhookAuthenticator {
  constructor(private readonly deps: StripeWebhookAuthenticatorDependencies) {
    if (deps.webhookSecret.length < 1) throw new TypeError("Stripe webhook credential is unavailable");
  }

  async authenticate(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
    _evaluatedAt: Date,
  ): Promise<AuthenticatedProviderEvent> {
    const signature = singleHeader(headers, "stripe-signature");
    if (signature === null) throw new PaymentWebhookAuthenticationError();
    let event: Stripe.Event;
    try {
      event = this.deps.sdk.webhooks.constructEvent(rawBody, signature, this.deps.webhookSecret);
    } catch {
      throw new PaymentWebhookAuthenticationError();
    }
    assertIdentifier(event.id, "Stripe event id");
    const occurredAt = canonicalSecond(
      new Date(positiveSeconds(event.created, "Stripe event time") * 1_000).toISOString(),
      "Stripe event time",
    );
    if (event.type === "checkout.session.completed") {
      const resource = event.data.object;
      if (!isObject(resource) || typeof resource.id !== "string") {
        throw new TypeError("authenticated Stripe checkout trigger is malformed");
      }
      assertIdentifier(resource.id, "Stripe checkout id");
      return trigger(event.id, event.type, "checkout_session", resource.id, occurredAt);
    }
    if (event.type.startsWith("customer.subscription.")) {
      const resource = event.data.object;
      if (!isObject(resource) || typeof resource.id !== "string") {
        throw new TypeError("authenticated Stripe subscription trigger is malformed");
      }
      assertIdentifier(resource.id, "Stripe subscription id");
      return trigger(event.id, event.type, "subscription", resource.id, occurredAt);
    }
    if (["invoice.paid", "invoice.payment_succeeded"].includes(event.type)) {
      const resource = event.data.object;
      if (!isObject(resource) || typeof resource.id !== "string") {
        throw new TypeError("authenticated Stripe invoice trigger is malformed");
      }
      assertIdentifier(resource.id, "Stripe invoice id");
      // Renewal and one-off invoices are not acquisition evidence. Ignoring them here keeps
      // their receipts from being mistaken for the immutable initial-payment binding.
      if (resource.billing_reason !== "subscription_create") {
        return { kind: "ignored", provider: "stripe", providerEventId: event.id, eventType: event.type,
          ignoredReason: "unrelated_object", occurredAt,
          authenticatedEvidenceRef: `stripe-event-${event.id}` };
      }
      return trigger(event.id, event.type, "invoice", resource.id, occurredAt);
    }
    if (event.type === "payment_intent.succeeded") {
      return resourceTrigger(event, occurredAt, "payment_intent");
    }
    if (event.type === "charge.succeeded") {
      return resourceTrigger(event, occurredAt, "charge");
    }
    if (event.type === "charge.refunded") {
      return resourceTrigger(event, occurredAt, "charge");
    }
    if (event.type.startsWith("charge.dispute.")) {
      return resourceTrigger(event, occurredAt, "dispute");
    }
    if (event.type.startsWith("refund.")) {
      return resourceTrigger(event, occurredAt, "refund");
    }
    return { kind: "ignored", provider: "stripe", providerEventId: event.id, eventType: event.type,
      ignoredReason: event.type.startsWith("test_helpers.") ? "test_event" : "unsupported_event",
      occurredAt, authenticatedEvidenceRef: `stripe-event-${event.id}` };
  }
}

function resourceTrigger(event: Stripe.Event, occurredAt: string,
  resourceKind: "invoice" | "payment_intent" | "charge" | "dispute" | "refund"): AuthenticatedProviderEvent {
  const resource = event.data.object;
  if (!isObject(resource) || typeof resource.id !== "string") {
    throw new TypeError("authenticated Stripe reversal trigger is malformed");
  }
  assertIdentifier(resource.id, `Stripe ${resourceKind} id`);
  return trigger(event.id, event.type, resourceKind, resource.id, occurredAt);
}

/** Reads one exact server-bound Stripe resource outside every database transaction. */
export class StripeCommercialProviderReader implements CommercialProviderReader {
  readonly provider = "stripe" as const;

  constructor(private readonly deps: StripeCommercialReaderDependencies) {
    validateFixedTermPolicy(deps.fixedTermPolicy);
  }

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
      const subscription = await this.deps.sdk.subscriptions.retrieve(input.providerResourceId);
      if (subscription.id !== input.providerResourceId) throw new TypeError("Stripe resource identity conflicts");
      const items = subscription.items.data.filter((item) => item.price.id.length > 0);
      if (items.length !== 1 || items[0] === undefined) {
        throw new TypeError("Stripe subscription must contain exactly one commercial plan");
      }
      const expiry = canonicalSecond(
        new Date(positiveSeconds(items[0].current_period_end, "Stripe commercial expiry") * 1_000).toISOString(),
        "Stripe commercial expiry",
      );
      const authority = this.deps.plans.authority(
        "stripe",
        items[0].price.id,
        expiry,
        input.evaluatedAt.toISOString(),
      );
      const initialPayment = await this.stripeSubscriptionInitialPayment(subscription, input.evaluatedAt);
      const reversal = await this.paymentRefundState(input, initialPayment.charge, {
        invoiceId: initialPayment.invoiceId,
        paymentIntentId: initialPayment.paymentIntentId,
        canonicalResourceKind: "subscription",
        canonicalResourceId: subscription.id,
      });
      return {
        provider: "stripe",
        providerResourceKind: "subscription",
        providerResourceId: subscription.id,
        providerAccess: reversal.reversal === "none" ? stripeAccess(subscription.status) : "refunded",
        renewalDisposition: subscription.cancel_at_period_end ? "nonrenewing"
          : subscription.status === "canceled" ? "terminated" : "renewing",
        observedPaidThrough: expiry,
        observedAt: canonicalSecond(input.evaluatedAt.toISOString(), "provider observation time"),
        plan: authority.plan,
        featureEntitlements: authority.featureEntitlements,
        reversal: reversal.reversal,
        paymentEvidence: initialPayment.evidence,
        refundFact: reversal.refundFact,
      };
    }
    if (input.purchaseKind === "fixed_term" && input.providerResourceKind === "checkout_session") {
      const session = await this.deps.sdk.checkout.sessions.retrieve(input.providerResourceId);
      if (
        session.id !== input.providerResourceId || session.mode !== "payment"
        || session.status !== "complete" || session.payment_status !== "paid"
      ) throw new TypeError("Stripe fixed-term checkout is not a completed payment");
      const paymentIntentId = objectId(session.payment_intent);
      if (paymentIntentId === null) throw new TypeError("Stripe fixed-term Checkout has no PaymentIntent");
      const paymentIntent = await this.deps.sdk.paymentIntents.retrieve(paymentIntentId);
      if (paymentIntent.id !== paymentIntentId || paymentIntent.status !== "succeeded") {
        throw new TypeError("Stripe fixed-term PaymentIntent is not settled");
      }
      const chargeId = objectId(paymentIntent.latest_charge);
      if (chargeId === null) throw new TypeError("Stripe fixed-term PaymentIntent has no Charge");
      const charge = await this.deps.sdk.charges.retrieve(chargeId);
      if (charge.id !== chargeId || objectId(charge.payment_intent) !== paymentIntentId
        || !charge.paid || !charge.captured || charge.amount <= 0 || charge.currency !== "usd"
        || session.amount_total !== charge.amount || session.currency !== charge.currency) {
        throw new TypeError("Stripe fixed-term payment chain conflicts");
      }
      const settledAt = stripeTimestamp(charge.created, "Stripe Charge settlement time", input.evaluatedAt);
      const reversal = await this.paymentRefundState(input, charge, {
        invoiceId: null, paymentIntentId, canonicalResourceKind: "checkout_session", canonicalResourceId: session.id });
      const paidAt = new Date(positiveSeconds(session.created, "Stripe checkout creation time") * 1_000);
      const expiry = addCalendarYears(paidAt, 10);
      return { ...fixedTermObservation(
        "stripe",
        "checkout_session",
        session.id,
        expiry,
        input.evaluatedAt,
        this.deps.fixedTermPolicy,
      ), providerAccess: reversal.reversal === "none" ? "active" : "refunded",
        reversal: reversal.reversal, refundFact: reversal.refundFact,
        paymentEvidence: { purpose: "acquisition_initial", resourceKind: "charge", resourceId: charge.id,
          bindingDigest: providerResourceBindingDigest("stripe", "charge", charge.id),
          settledAt, grossMinor: charge.amount, currency: "USD", cumulativeRefundedMinor: charge.amount_refunded,
          sourceDigest: digest({ chargeId: charge.id, paymentIntentId, checkoutSessionId: session.id,
            settledAt, amount: charge.amount, currency: charge.currency, amountRefunded: charge.amount_refunded }) } };
    }
    throw new TypeError("Stripe reconciliation resource kind is invalid");
  }

  async handoffForReceipt(work: Parameters<NonNullable<CommercialProviderReader["handoffForReceipt"]>>[0],
    evaluatedAt: Date): Promise<Awaited<ReturnType<NonNullable<CommercialProviderReader["handoffForReceipt"]>>>> {
    if (work.provider !== "stripe" || work.triggerResourceKind !== "checkout_session") return null;
    const session = await this.deps.sdk.checkout.sessions.retrieve(work.triggerResourceId);
    if (session.id !== work.triggerResourceId || session.status !== "complete") throw new TypeError("Stripe Checkout is incomplete");
    const checkoutSession = fact("checkout_session", session.id, "checkout_origin");
    if (session.mode === "subscription") {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (typeof subscriptionId !== "string") throw new TypeError("Stripe Checkout has no Subscription");
      const subscription = fact("subscription", subscriptionId, "canonical_agreement");
      const subscriptionValue = await this.deps.sdk.subscriptions.retrieve(subscriptionId);
      if (subscriptionValue.id !== subscriptionId) throw new TypeError("Stripe Subscription identity conflicts");
      const initial = await this.stripeSubscriptionInitialPayment(subscriptionValue, evaluatedAt);
      const paymentResources = [
        initialPaymentFact("invoice", initial.invoiceId), initialPaymentFact("payment_intent", initial.paymentIntentId),
        initialPaymentFact("charge", initial.charge.id),
      ];
      return { observationDigest: digest({ checkoutSession, subscription, paymentResources }), paymentResources,
        handoff: { kind: "stripe_subscription", checkoutSession, subscription } };
    }
    if (session.mode === "payment" && session.payment_status === "paid") {
      const initial = await this.stripeFixedTermInitialPayment(session, evaluatedAt);
      const paymentResources = [initialPaymentFact("payment_intent", initial.paymentIntentId),
        initialPaymentFact("charge", initial.charge.id)];
      const capturedAt = initial.settledAt;
      return { observationDigest: digest({ checkoutSession, capturedAt, paymentResources }), paymentResources,
        handoff: { kind: "stripe_fixed_term", checkoutSession, capturedAt } };
    }
    throw new TypeError("Stripe Checkout handoff is unsupported");
  }

  async resolveReceiptResourceBinding(
    work: Parameters<NonNullable<CommercialProviderReader["resolveReceiptResourceBinding"]>>[0],
    evaluatedAt: Date,
  ): Promise<LinkReceiptResourcesCommand | null> {
    if (work.provider !== "stripe" || !["subscription", "invoice", "payment_intent", "refund", "charge", "dispute"]
      .includes(work.triggerResourceKind)) {
      return null;
    }
    if (work.triggerResourceKind === "subscription") {
      const subscription = await this.deps.sdk.subscriptions.retrieve(work.triggerResourceId);
      if (subscription.id !== work.triggerResourceId) throw new TypeError("Stripe Subscription identity conflicts");
      const initial = await this.stripeSubscriptionInitialPayment(subscription, evaluatedAt);
      return {
        anchorResourceKind: "subscription",
        anchorResourceId: subscription.id,
        anchorBindingDigest: providerResourceBindingDigest("stripe", "subscription", subscription.id),
        resources: [
          supplementalFact("invoice", initial.invoiceId, "initial_payment"),
          supplementalFact("payment_intent", initial.paymentIntentId, "initial_payment"),
          supplementalFact("charge", initial.charge.id, "initial_payment"),
        ],
      };
    }
    if (work.triggerResourceKind === "invoice") {
      const invoice = await this.deps.sdk.invoices.retrieve(work.triggerResourceId);
      if (invoice.id !== work.triggerResourceId) throw new TypeError("Stripe Invoice identity conflicts");
      if (invoice.billing_reason !== "subscription_create" || invoice.status !== "paid"
        || invoice.amount_paid <= 0 || invoice.currency !== "usd") {
        throw new TypeError("Stripe Invoice is not an initial settled subscription Invoice");
      }
      const subscriptionId = invoice.parent?.type === "subscription_details"
        ? objectId(invoice.parent.subscription_details?.subscription) : null;
      if (subscriptionId === null) throw new TypeError("Stripe Invoice has no exact Subscription");
      return {
        anchorResourceKind: "subscription",
        anchorResourceId: subscriptionId,
        anchorBindingDigest: providerResourceBindingDigest("stripe", "subscription", subscriptionId),
        resources: [{ resourceKind: "invoice", resourceId: invoice.id,
          bindingDigest: providerResourceBindingDigest("stripe", "invoice", invoice.id),
          linkRole: "initial_payment" }],
      };
    }
    const paymentChain = work.triggerResourceKind === "payment_intent"
      ? { paymentIntentId: await this.exactPaymentIntent(work.triggerResourceId), resources: [] }
      : await this.reversalPaymentIntent(work.triggerResourceKind, work.triggerResourceId);
    const paymentIntentId = paymentChain.paymentIntentId;
    const checkoutSessions = await this.deps.sdk.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 2 });
    const fixedTermAnchors = checkoutSessions.data.filter((session) => session.mode === "payment"
      && session.status === "complete" && session.payment_status === "paid"
      && objectId(session.payment_intent) === paymentIntentId);
    const invoicePayments = await this.deps.sdk.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      status: "paid",
      limit: 2,
    });
    const matchingInvoicePayments = invoicePayments.data.filter((payment) => payment.status === "paid"
      && payment.payment.type === "payment_intent" && objectId(payment.payment.payment_intent) === paymentIntentId);
    const subscriptionAnchors: { readonly subscriptionId: string; readonly invoiceId: string }[] = [];
    for (const payment of matchingInvoicePayments) {
      const invoiceId = objectId(payment.invoice);
      if (invoiceId === null) throw new TypeError("Stripe reversal Invoice identity is unavailable");
      const invoice = await this.deps.sdk.invoices.retrieve(invoiceId);
      if (invoice.id !== invoiceId) throw new TypeError("Stripe reversal Invoice identity conflicts");
      if (invoice.billing_reason !== "subscription_create") {
        // A renewal invoice cannot establish the acquisition anchor for a reversal.
        // Leaving it out forces the chain to fail closed instead of relabeling renewal
        // payment evidence as immutable initial-payment evidence.
        continue;
      }
      const subscriptionId = invoice.parent?.type === "subscription_details"
        ? objectId(invoice.parent.subscription_details?.subscription) : null;
      if (subscriptionId === null) throw new TypeError("Stripe reversal Invoice has no exact Subscription");
      subscriptionAnchors.push({ subscriptionId, invoiceId });
    }
    const anchors = [
      ...fixedTermAnchors.map((session) => ({ resourceKind: "checkout_session", resourceId: session.id })),
      ...subscriptionAnchors.map(({ subscriptionId }) => ({ resourceKind: "subscription", resourceId: subscriptionId })),
    ];
    if (anchors.length !== 1 || anchors[0] === undefined) {
      throw new TypeError("Stripe reversal payment has no unique immutable agreement anchor");
    }
    return {
      anchorResourceKind: anchors[0].resourceKind,
      anchorResourceId: anchors[0].resourceId,
      anchorBindingDigest: providerResourceBindingDigest("stripe", anchors[0].resourceKind, anchors[0].resourceId),
      resources: uniqueSupplementalFacts([
        ...paymentChain.resources,
        supplementalFact("payment_intent", paymentIntentId, "initial_payment"),
        ...subscriptionAnchors.map(({ invoiceId }) => supplementalFact("invoice", invoiceId, "initial_payment")),
        supplementalFact(work.triggerResourceKind as "payment_intent" | "charge" | "refund" | "dispute",
          work.triggerResourceId, triggerLinkRole(work)),
      ]),
    };
  }

  private async exactPaymentIntent(resourceId: string): Promise<string> {
    const paymentIntent = await this.deps.sdk.paymentIntents.retrieve(resourceId);
    if (paymentIntent.id !== resourceId) throw new TypeError("Stripe PaymentIntent identity conflicts");
    return paymentIntent.id;
  }

  private async stripeSubscriptionInitialPayment(subscription: Stripe.Subscription, evaluatedAt: Date): Promise<{
    readonly invoiceId: string; readonly paymentIntentId: string; readonly charge: Stripe.Charge;
    readonly evidence: NonNullable<ReconciledCommercialObservation["paymentEvidence"]> }> {
    const invoices = await this.deps.sdk.invoices.list({ subscription: subscription.id, status: "paid", limit: 100 });
    if (invoices.has_more) throw new TypeError("Stripe Subscription Invoice range is incomplete");
    const initialInvoices = invoices.data.filter((invoice) => invoice.billing_reason === "subscription_create"
      && invoice.status === "paid" && invoice.amount_paid > 0 && invoice.currency === "usd");
    if (initialInvoices.length !== 1 || initialInvoices[0] === undefined) {
      throw new TypeError("Stripe Subscription has no unique initial settled Invoice");
    }
    const invoice = initialInvoices[0];
    const payments = await this.deps.sdk.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 2 });
    const paid = payments.data.filter((payment) => payment.status === "paid" && payment.amount_paid === invoice.amount_paid
      && payment.currency === invoice.currency && payment.payment.type === "payment_intent");
    if (paid.length !== 1 || paid[0] === undefined) throw new TypeError("Stripe initial Invoice has no unique payment");
    const paymentIntentId = objectId(paid[0].payment.payment_intent);
    if (paymentIntentId === null) throw new TypeError("Stripe initial Invoice has no PaymentIntent");
    const paymentIntent = await this.deps.sdk.paymentIntents.retrieve(paymentIntentId);
    const chargeId = objectId(paymentIntent.latest_charge);
    if (paymentIntent.id !== paymentIntentId || paymentIntent.status !== "succeeded" || chargeId === null) {
      throw new TypeError("Stripe initial PaymentIntent is not settled");
    }
    const charge = await this.deps.sdk.charges.retrieve(chargeId);
    if (charge.id !== chargeId || objectId(charge.payment_intent) !== paymentIntentId || !charge.paid || !charge.captured
      || charge.amount !== invoice.amount_paid || charge.currency !== invoice.currency) {
      throw new TypeError("Stripe initial Charge identity or amount conflicts");
    }
    const settledAt = stripeTimestamp(paid[0].status_transitions.paid_at ?? charge.created,
      "Stripe initial payment settlement time", evaluatedAt);
    return { invoiceId: invoice.id, paymentIntentId, charge, evidence: {
      purpose: "acquisition_initial", resourceKind: "charge", resourceId: charge.id,
      bindingDigest: providerResourceBindingDigest("stripe", "charge", charge.id),
      settledAt, grossMinor: charge.amount, currency: "USD", cumulativeRefundedMinor: charge.amount_refunded,
      sourceDigest: digest({ subscriptionId: subscription.id, invoiceId: invoice.id, paymentIntentId,
        chargeId: charge.id, settledAt, grossMinor: charge.amount, currency: charge.currency,
        cumulativeRefundedMinor: charge.amount_refunded }) } };
  }

  private async stripeFixedTermInitialPayment(session: Stripe.Checkout.Session, evaluatedAt: Date): Promise<{
    readonly paymentIntentId: string; readonly charge: Stripe.Charge; readonly settledAt: string }> {
    const paymentIntentId = objectId(session.payment_intent);
    if (paymentIntentId === null) throw new TypeError("Stripe fixed-term Checkout has no PaymentIntent");
    const paymentIntent = await this.deps.sdk.paymentIntents.retrieve(paymentIntentId);
    const chargeId = objectId(paymentIntent.latest_charge);
    if (paymentIntent.id !== paymentIntentId || paymentIntent.status !== "succeeded" || chargeId === null) {
      throw new TypeError("Stripe fixed-term PaymentIntent is not settled");
    }
    const charge = await this.deps.sdk.charges.retrieve(chargeId);
    if (charge.id !== chargeId || objectId(charge.payment_intent) !== paymentIntentId || !charge.paid || !charge.captured
      || charge.amount <= 0 || charge.currency !== "usd" || session.amount_total !== charge.amount
      || session.currency !== charge.currency) throw new TypeError("Stripe fixed-term payment chain conflicts");
    return { paymentIntentId, charge,
      settledAt: stripeTimestamp(charge.created, "Stripe Charge settlement time", evaluatedAt) };
  }

  private async paymentRefundState(
    input: { readonly receiptEventType: string | null; readonly receiptTriggerResourceKind: string | null;
      readonly receiptTriggerResourceId: string | null },
    charge: Stripe.Charge,
    expected: { readonly invoiceId: string | null; readonly paymentIntentId: string;
      readonly canonicalResourceKind: "subscription" | "checkout_session"; readonly canonicalResourceId: string },
  ): Promise<{ readonly reversal: "none" | "refund" | "fraud";
    readonly refundFact: ReconciledCommercialObservation["refundFact"] }> {
    const triggerKind = input.receiptTriggerResourceKind;
    const triggerId = input.receiptTriggerResourceId;
    if (triggerKind === null && triggerId === null) return { reversal: "none", refundFact: "none" };
    if (triggerId !== null && ((triggerKind === "invoice" && triggerId === expected.invoiceId)
      || (triggerKind === "payment_intent" && triggerId === expected.paymentIntentId)
      || (triggerKind === "charge" && triggerId === charge.id && input.receiptEventType === "charge.succeeded")
      || (triggerKind === expected.canonicalResourceKind && triggerId === expected.canonicalResourceId))) {
      return { reversal: "none", refundFact: "none" };
    }
    if (triggerKind === "refund" && triggerId !== null) {
      const refund = await this.deps.sdk.refunds.retrieve(triggerId);
      const related = await this.exactPaymentIntentFromRelatedPayment(refund.payment_intent, refund.charge);
      if (refund.id !== triggerId || related.chargeId !== charge.id || refund.currency !== charge.currency) {
        throw new TypeError("Stripe Refund does not belong to the canonical payment");
      }
      if (refund.status === "pending" || refund.status === "requires_action") {
        return { reversal: "none", refundFact: "refund_pending" };
      }
      if (refund.status === "failed" || refund.status === "canceled") {
        return { reversal: "none", refundFact: "refund_failed" };
      }
      if (refund.status !== "succeeded") throw new TypeError("Stripe Refund status is invalid");
      return charge.amount_refunded === charge.amount
        ? { reversal: "refund", refundFact: "refund_succeeded" }
        : { reversal: "none", refundFact: "partial_refund" };
    }
    if (triggerKind === "charge" && triggerId === charge.id && input.receiptEventType === "charge.refunded") {
      return charge.amount_refunded === charge.amount
        ? { reversal: "refund", refundFact: "refund_succeeded" }
        : { reversal: "none", refundFact: "partial_refund" };
    }
    if (triggerKind === "dispute" && triggerId !== null) {
      const dispute = await this.deps.sdk.disputes.retrieve(triggerId);
      const related = await this.exactPaymentIntentFromRelatedPayment(dispute.payment_intent, dispute.charge);
      if (dispute.id !== triggerId || related.chargeId !== charge.id || dispute.currency !== charge.currency) {
        throw new TypeError("Stripe Dispute does not belong to the canonical payment");
      }
      if (dispute.status === "lost") return dispute.amount === charge.amount
        ? { reversal: "fraud", refundFact: "full_reversal_settled" }
        : { reversal: "none", refundFact: "partial_reversal" };
      if (["needs_response", "under_review", "warning_needs_response", "warning_under_review"].includes(dispute.status)) {
        return { reversal: "none", refundFact: dispute.reason === "fraudulent" ? "fraud_signal" : "dispute_pending" };
      }
      if (["won", "warning_closed"].includes(dispute.status)) {
        // The exact dispute lineage is terminal without a settled reversal. A terminal failure fact lets
        // persistence resolve that sticky head without allowing an unrelated observation to clear it.
        return { reversal: "none", refundFact: "refund_failed" };
      }
      throw new TypeError("Stripe Dispute status is invalid");
    }
    throw new TypeError("Stripe reconciliation trigger does not belong to the canonical payment");
  }

  private async reversalPaymentIntent(resourceKind: string, resourceId: string): Promise<{
    readonly paymentIntentId: string; readonly resources: readonly SupplementalAgreementResourceFact[] }> {
    if (resourceKind === "charge") {
      const charge = await this.deps.sdk.charges.retrieve(resourceId);
      if (charge.id !== resourceId) throw new TypeError("Stripe reversal Charge identity conflicts");
      const paymentIntentId = objectId(charge.payment_intent);
      if (paymentIntentId === null) throw new TypeError("Stripe reversal Charge has no PaymentIntent");
      return { paymentIntentId, resources: [] };
    }
    if (resourceKind === "refund") {
      const refund = await this.deps.sdk.refunds.retrieve(resourceId);
      if (refund.id !== resourceId) throw new TypeError("Stripe reversal Refund identity conflicts");
      const payment = await this.exactPaymentIntentFromRelatedPayment(refund.payment_intent, refund.charge);
      return { paymentIntentId: payment.paymentIntentId, resources: payment.chargeId === null ? []
        : [supplementalFact("charge", payment.chargeId, "initial_payment")] };
    }
    const dispute = await this.deps.sdk.disputes.retrieve(resourceId);
    if (dispute.id !== resourceId) throw new TypeError("Stripe reversal Dispute identity conflicts");
    const payment = await this.exactPaymentIntentFromRelatedPayment(dispute.payment_intent, dispute.charge);
    return { paymentIntentId: payment.paymentIntentId, resources: payment.chargeId === null ? []
      : [supplementalFact("charge", payment.chargeId, "initial_payment")] };
  }

  private async exactPaymentIntentFromRelatedPayment(
    relatedPaymentIntent: string | Stripe.PaymentIntent | null,
    relatedCharge: string | Stripe.Charge | null,
  ): Promise<{ readonly paymentIntentId: string; readonly chargeId: string | null }> {
    const directId = objectId(relatedPaymentIntent);
    const chargeId = objectId(relatedCharge);
    if (chargeId === null) {
      if (directId === null) throw new TypeError("Stripe reversal has no exact PaymentIntent");
      return { paymentIntentId: directId, chargeId: null };
    }
    const charge = await this.deps.sdk.charges.retrieve(chargeId);
    if (charge.id !== chargeId) throw new TypeError("Stripe reversal Charge identity conflicts");
    const chargePaymentIntentId = objectId(charge.payment_intent);
    if (chargePaymentIntentId === null || (directId !== null && directId !== chargePaymentIntentId)) {
      throw new TypeError("Stripe reversal payment chain conflicts");
    }
    return { paymentIntentId: chargePaymentIntentId, chargeId };
  }
}

function trigger(
  eventId: string,
  eventType: string,
  providerResourceKind: string,
  providerResourceId: string,
  occurredAt: string,
): AuthenticatedProviderEvent {
  return {
    kind: "actionable",
    provider: "stripe",
    providerEventId: eventId,
    eventType,
    triggerResourceKind: providerResourceKind,
    triggerResourceId: providerResourceId,
    occurredAt,
    authenticatedEvidenceRef: `stripe-event-${eventId}`,
  };
}

function stripeAccess(status: Stripe.Subscription.Status): ReconciledCommercialObservation["providerAccess"] {
  switch (status) {
    case "active": return "active";
    case "past_due": return "delinquent";
    case "trialing":
    case "incomplete": return "pending";
    case "paused": return "suspended";
    case "canceled":
    case "incomplete_expired":
    case "unpaid": return "ended";
    default: throw new TypeError("Stripe subscription status is unsupported");
  }
}

export function fixedTermObservation(
  provider: "stripe" | "paypal",
  providerResourceKind: string,
  providerResourceId: string,
  expiry: string,
  evaluatedAt: Date,
  policy: FixedTermCommercialPolicy,
): ReconciledCommercialObservation {
  const commercialExpiresAt = canonicalSecond(expiry, "fixed-term commercial expiry");
  return {
    provider,
    providerResourceKind,
    providerResourceId,
    providerAccess: "active",
    renewalDisposition: "terminated",
    observedPaidThrough: commercialExpiresAt,
    observedAt: canonicalSecond(evaluatedAt.toISOString(), "provider evaluation time"),
    plan: policy.plan,
    featureEntitlements: [...policy.featureEntitlements],
    reversal: "none",
    paymentEvidence: null,
    refundFact: "none",
  };
}

function fact(resourceKind: string, resourceId: string,
  role: "checkout_origin" | "canonical_agreement") { return { resourceKind, resourceId, role,
  bindingDigest: providerResourceBindingDigest("stripe", resourceKind, resourceId) }; }
function digest(value: unknown): Uint8Array { return createHash("sha256").update(JSON.stringify(value)).digest(); }

function validateFixedTermPolicy(policy: FixedTermCommercialPolicy): void {
  assertIdentifier(policy.plan, "fixed-term plan");
  if (!Number.isSafeInteger(policy.offlineGraceSeconds) || policy.offlineGraceSeconds < 1
    || !Number.isSafeInteger(policy.credentialRefreshSeconds) || policy.credentialRefreshSeconds < 1) {
    throw new TypeError("fixed-term policy is invalid");
  }
}

function addCalendarYears(value: Date, years: number): string {
  const result = new Date(value);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + years);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return canonicalSecond(result.toISOString(), "fixed-term commercial expiry");
}

function positiveSeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} is invalid`);
  return value;
}

function stripeTimestamp(value: number, label: string, evaluatedAt: Date): string {
  const timestamp = new Date(positiveSeconds(value, label) * 1_000);
  if (!Number.isFinite(evaluatedAt.getTime()) || timestamp.getTime() > evaluatedAt.getTime() + 5 * 60_000) {
    throw new TypeError(`${label} is in the future`);
  }
  return canonicalSecond(timestamp.toISOString(), label);
}

function singleHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null {
  const value = headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length < 1 || value.length > 160 || !/^[!-~]+$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectId(value: { readonly id: string } | string | null | undefined): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  return value !== null && value !== undefined && typeof value.id === "string" && value.id.length > 0
    ? value.id : null;
}

function supplementalFact(
  resourceKind: SupplementalAgreementResourceFact["resourceKind"],
  resourceId: string,
  linkRole: SupplementalAgreementResourceFact["linkRole"],
): SupplementalAgreementResourceFact {
  return { resourceKind, resourceId, linkRole,
    bindingDigest: providerResourceBindingDigest("stripe", resourceKind, resourceId) };
}

function initialPaymentFact(resourceKind: InitialPaymentResourceFact["resourceKind"],
  resourceId: string): InitialPaymentResourceFact {
  return { resourceKind, resourceId,
    bindingDigest: providerResourceBindingDigest("stripe", resourceKind, resourceId) };
}

function triggerLinkRole(work: { readonly eventType: string; readonly triggerResourceKind: string }):
  SupplementalAgreementResourceFact["linkRole"] {
  if (work.triggerResourceKind === "refund") return "refund_evidence";
  if (work.triggerResourceKind === "dispute") return "reversal_evidence";
  return "initial_payment";
}

function uniqueSupplementalFacts(
  facts: readonly SupplementalAgreementResourceFact[],
): readonly SupplementalAgreementResourceFact[] {
  const values = new Map<string, SupplementalAgreementResourceFact>();
  for (const fact of facts) values.set(`${fact.resourceKind}\u0000${fact.resourceId}`, fact);
  return [...values.values()];
}
