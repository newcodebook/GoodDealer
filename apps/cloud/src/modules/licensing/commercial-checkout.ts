import { createHash } from "node:crypto";
import {
  BILLING_SCHEMA_VERSION, billingCheckoutCreateResponseSchema, billingFixedTermConfirmResponseSchema,
  billingFirstPurchaseRefundRequestResponseSchema, billingFirstPurchaseRefundStatusReadResponseSchema,
  billingStatusReadResponseSchema, billingSubscriptionCancelResponseSchema,
  type BillingCheckoutCreateRequest, type BillingCheckoutCreateResponse,
  type BillingFixedTermConfirmRequest, type BillingFixedTermConfirmResponse, type BillingProvider,
  type BillingFirstPurchaseRefundRequest, type BillingFirstPurchaseRefundRequestResponse,
  type BillingFirstPurchaseRefundStatusReadRequest, type BillingFirstPurchaseRefundStatusReadResponse,
  type BillingStatusReadResponse, type BillingSubscriptionCancelRequest,
  type BillingSubscriptionCancelResponse, type CommercialOffer,
} from "@gooddealer/protocol/account";

import type { DatabaseQuery, IdentityCapabilityTransactionRunner } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { CommercialAggregateRepositoryPort, CommercialBillingStatus, FirstPurchaseRefundStatus,
  ProviderResourceFact } from "./commercial-domain";
import { commercialCheckoutRequestDigest } from "./commercial-checkout-identity";
import { ProviderDispatchExecutor, ProviderDispatchManualResolutionError } from "./provider-dispatch-executor";

export type CommercialPurchaseKind = "subscription" | "fixed_term";
export type CommercialPurchaseState = CommercialBillingStatus["state"];
export interface CommercialCheckoutDefinition { readonly provider: BillingProvider; readonly offer: CommercialOffer;
  readonly campaignCode: string | null; readonly providerItemId: string; readonly providerDiscountId: string | null;
  readonly currency: "USD"; readonly amountMinor: number; }
export interface FixedTermEntitlementPolicy { readonly plan: string; readonly featureEntitlements: readonly string[];
  readonly offlineGraceSeconds: number; readonly credentialRefreshSeconds: number; }
export interface ResolvedCommercialCheckout extends CommercialCheckoutDefinition { readonly purchaseKind: CommercialPurchaseKind; }

export class CommercialCheckoutCatalog {
  readonly #definitions: ReadonlyMap<string, ResolvedCommercialCheckout>;
  constructor(definitions: readonly CommercialCheckoutDefinition[]) {
    const configured = new Map<string, ResolvedCommercialCheckout>();
    for (const definition of definitions) {
      assertIdentifier(definition.providerItemId, "provider item id");
      if (definition.providerDiscountId !== null) assertIdentifier(definition.providerDiscountId, "provider discount id");
      const campaignCode = normalizeCampaign(definition.campaignCode);
      if (!Number.isSafeInteger(definition.amountMinor) || definition.amountMinor < 1) throw new TypeError("commercial amount is invalid");
      const key = checkoutKey(definition.provider, definition.offer, campaignCode);
      if (configured.has(key)) throw new TypeError("commercial checkout definition is duplicated");
      configured.set(key, { ...definition, campaignCode,
        purchaseKind: definition.offer === "ten_year" ? "fixed_term" : "subscription" });
    }
    this.#definitions = configured;
  }
  resolve(provider: BillingProvider, offer: CommercialOffer, campaignCode: string | null): ResolvedCommercialCheckout {
    const value = this.#definitions.get(checkoutKey(provider, offer, normalizeCampaign(campaignCode)));
    if (value === undefined) throw new CommercialCheckoutUnavailableError();
    return value;
  }
  assertSubscriptionPlans(plans: { has(provider: BillingProvider, providerItemId: string): boolean }): void {
    for (const definition of this.#definitions.values()) if (definition.purchaseKind === "subscription"
      && !plans.has(definition.provider, definition.providerItemId)) throw new TypeError("commercial subscription checkout has no entitlement plan mapping");
  }
}

export class CommercialPurchaseConflictError extends Error {}
export class CommercialCheckoutUnavailableError extends Error {}
export class CommercialCheckoutCreationRejectedError extends Error {}
export class CommercialCheckoutCreationUnknownError extends Error {}
export class CommercialSubscriptionCancellationUnknownError extends Error {}

export interface CommercialCheckoutApplicationPort {
  createCheckout(request: BillingCheckoutCreateRequest, principal: PublicPrincipal): Promise<BillingCheckoutCreateResponse | null>;
  readStatus(principal: PublicPrincipal): Promise<BillingStatusReadResponse | null>;
  cancelSubscription(request: BillingSubscriptionCancelRequest, principal: PublicPrincipal): Promise<BillingSubscriptionCancelResponse | null>;
  confirmFixedTerm(request: BillingFixedTermConfirmRequest, principal: PublicPrincipal): Promise<BillingFixedTermConfirmResponse | null>;
  requestFirstPurchaseRefund(request: BillingFirstPurchaseRefundRequest,
    principal: PublicPrincipal): Promise<BillingFirstPurchaseRefundRequestResponse | null>;
  readFirstPurchaseRefundStatus(request: BillingFirstPurchaseRefundStatusReadRequest,
    principal: PublicPrincipal): Promise<BillingFirstPurchaseRefundStatusReadResponse | null>;
  claimApprovalRedirect(rawHandle: string, principal: PublicPrincipal): Promise<string | null>;
}

type AuthenticatedTransactions = Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">;

export class CommercialCheckoutApplicationService implements CommercialCheckoutApplicationPort {
  constructor(private readonly transactions: AuthenticatedTransactions, private readonly query: DatabaseQuery,
    private readonly repository: CommercialAggregateRepositoryPort, private readonly catalog: CommercialCheckoutCatalog,
    private readonly dispatch: ProviderDispatchExecutor, _now: () => Date = () => new Date()) {}

  async createCheckout(request: BillingCheckoutCreateRequest, principal: PublicPrincipal): Promise<BillingCheckoutCreateResponse | null> {
    const credential = accountWebCredential(principal); if (credential === null) return null;
    const definition = this.catalog.resolve(request.provider, request.offer, request.campaignCode);
    const requestDigest = commercialCheckoutRequestDigest(definition);
    const plan = await this.transactions.withAccountCredential(credential, "purchase_reserve", (transaction) =>
      this.repository.reservePurchase(transaction, { requestId: request.requestId, provider: definition.provider,
        purchaseKind: definition.purchaseKind, offer: definition.offer, providerCatalogItem: definition.providerItemId,
        campaignCode: definition.campaignCode, expectedGrossMinor: definition.amountMinor,
        expectedCurrency: definition.currency, requestDigest }));
    const execution = await this.dispatch.create(plan.work, plan.purchaseAttemptId, definition);
    if (execution.outcome === "rejected") throw new CommercialCheckoutCreationRejectedError();
    if (execution.outcome !== "confirmed") throw new CommercialCheckoutCreationUnknownError();
    const current = await this.transactions.withAccountCredential(credential, "billing_read", (transaction) =>
      this.repository.readBillingStatus(transaction));
    let approvalHolderId = current?.providerAgreementId ?? plan.purchaseAttemptId;
    if (definition.provider === "paypal" && definition.purchaseKind === "subscription"
      && (current === null || current.providerAgreementId === null)) {
      const subscription = withRole(requireResource(execution.replay.resources, "subscription"), "canonical_agreement");
      const agreement = await this.repository.handoffProviderAgreement(this.query, plan.work, {
        observationDigest: digest({ kind: "paypal_subscription", binding: subscription.bindingDigest }),
        paymentResources: [],
        handoff: { kind: "paypal_subscription", subscription },
      });
      approvalHolderId = agreement.providerAgreementId;
    }
    const approval = await this.transactions.withAccountCredential(credential, "billing_approval_redirect", (transaction) =>
      this.repository.issueApprovalRedirect(transaction, approvalHolderId));
    return billingCheckoutCreateResponseSchema.parse({ schemaVersion: BILLING_SCHEMA_VERSION, requestId: request.requestId,
      checkoutId: plan.purchaseAttemptId, provider: definition.provider, offer: definition.offer,
      approval: { kind: "gooddealer_redirect", handle: Buffer.from(approval.handle).toString("base64url"), expiresAt: approval.expiresAt } });
  }

  async readStatus(principal: PublicPrincipal): Promise<BillingStatusReadResponse | null> {
    const credential = accountWebCredential(principal); if (credential === null) return null;
    const status = await this.transactions.withAccountCredential(credential, "billing_read", (transaction) =>
      this.repository.readBillingStatus(transaction));
    return billingStatusReadResponseSchema.parse(publicStatus(status));
  }

  async cancelSubscription(request: BillingSubscriptionCancelRequest, principal: PublicPrincipal): Promise<BillingSubscriptionCancelResponse | null> {
    const credential = accountWebCredential(principal); if (credential === null) return null;
    const status = await this.transactions.withAccountCredential(credential, "billing_read", (transaction) =>
      this.repository.readBillingStatus(transaction));
    if (status === null || status.providerAgreementId === null
      || !["active", "grace", "cancellation_pending", "cancellation_unknown", "cancel_at_period_end"].includes(status.state))
      throw new CommercialPurchaseConflictError("no cancellable subscription exists");
    const providerAgreementId = status.providerAgreementId;
    const plan = await this.transactions.withAccountCredential(credential, "cancellation_request", (transaction) =>
      this.repository.requestCancellation(transaction, { requestId: request.requestId,
        expectedAgreementId: providerAgreementId,
        requestDigest: digest({ kind: "subscription_cancel", requestId: request.requestId, purchaseAttemptId: status.purchaseAttemptId }) }));
    const execution = await this.dispatch.cancelSubscription(plan.work, plan.providerAgreementResourceId);
    if (plan.protectedPaidThrough === null) throw new CommercialPurchaseConflictError("paid-through time is unavailable");
    return billingSubscriptionCancelResponseSchema.parse({ schemaVersion: BILLING_SCHEMA_VERSION, requestId: request.requestId,
      state: execution.outcome === "confirmed" ? "cancel_at_period_end" : "cancellation_unknown", paidThrough: plan.protectedPaidThrough });
  }

  async confirmFixedTerm(request: BillingFixedTermConfirmRequest, principal: PublicPrincipal): Promise<BillingFixedTermConfirmResponse | null> {
    const credential = accountWebCredential(principal); if (credential === null) return null;
    const status = await this.transactions.withAccountCredential(credential, "billing_read", (transaction) =>
      this.repository.readBillingStatus(transaction));
    if (status === null || status.purchaseAttemptId !== request.checkoutId || status.offer !== "ten_year"
      || status.currentProviderOperationId === null)
      throw new CommercialPurchaseConflictError("no confirmable fixed-term checkout exists");
    const currentProviderOperationId = status.currentProviderOperationId;
    if (status.provider === "paypal") {
      const plan = await this.transactions.withAccountCredential(credential, "fixed_term_capture", (transaction) =>
        this.repository.confirmFixedTermCapture(transaction, { requestId: request.requestId,
          expectedOrderOperationId: currentProviderOperationId,
          requestDigest: digest({ kind: "fixed_term_order_capture", requestId: request.requestId, purchaseAttemptId: request.checkoutId }) }));
      // The targetless provider worker performs the exact Order/Capture read and provider-time handoff.
      // The request path cannot use its own clock as settlement evidence.
      await this.dispatch.captureFixedTerm(plan.work, plan.providerOrderResourceId);
    }
    return billingFixedTermConfirmResponseSchema.parse({ schemaVersion: BILLING_SCHEMA_VERSION, state: "processing",
      requestId: request.requestId, checkoutId: request.checkoutId });
  }

  async requestFirstPurchaseRefund(request: BillingFirstPurchaseRefundRequest,
    principal: PublicPrincipal): Promise<BillingFirstPurchaseRefundRequestResponse | null> {
    const credential = accountWebCredential(principal); if (credential === null) return null;
    const decision = await this.transactions.withAccountCredential(credential, "refund_request", (transaction) =>
      this.repository.requestFirstPurchaseRefund(transaction, { requestId: request.requestId,
        expectedPurchaseAttemptId: request.purchaseId,
        requestDigest: digest({ kind: "first_purchase_refund", requestId: request.requestId,
          purchaseAttemptId: request.purchaseId }) }));
    if (decision.disposition === "rejected") {
      return billingFirstPurchaseRefundRequestResponseSchema.parse({ schemaVersion: BILLING_SCHEMA_VERSION,
        state: "rejected", reason: decision.reason });
    }
    const refundRequestId = decision.acceptance.refundRequestId;
    const status = await this.transactions.withAccountCredential(credential, "billing_read", (transaction) =>
      this.repository.readFirstPurchaseRefundStatus(transaction, refundRequestId));
    if (status === null || status.expectedPurchaseAttemptId !== request.purchaseId) {
      throw new CommercialPurchaseConflictError("accepted refund status identity conflicts");
    }
    return billingFirstPurchaseRefundRequestResponseSchema.parse(publicRefundStatus(status));
  }

  async readFirstPurchaseRefundStatus(request: BillingFirstPurchaseRefundStatusReadRequest,
    principal: PublicPrincipal): Promise<BillingFirstPurchaseRefundStatusReadResponse | null> {
    const credential = accountWebCredential(principal); if (credential === null) return null;
    const status = await this.transactions.withAccountCredential(credential, "billing_read", (transaction) =>
      this.repository.readFirstPurchaseRefundStatus(transaction, request.refundRequestId));
    return status === null ? null : billingFirstPurchaseRefundStatusReadResponseSchema.parse(publicRefundStatus(status));
  }

  async claimApprovalRedirect(rawHandle: string, principal: PublicPrincipal): Promise<string | null> {
    const credential = accountWebCredential(principal);
    if (credential === null || !/^[A-Za-z0-9_-]{43}$/u.test(rawHandle)) return null;
    const handle = Buffer.from(rawHandle, "base64url"); if (handle.byteLength !== 32) return null;
    const claim = await this.transactions.withAccountCredential(credential, "billing_approval_redirect", (transaction) =>
      this.repository.claimApprovalRedirect(transaction, handle));
    let outcome: "consumed" | "expired" | "manual_resolution" = "expired";
    try {
      let url: string;
      if (claim.providerResourceKind === "checkout_session"
        || claim.provider === "paypal" && ["order", "subscription"].includes(claim.providerResourceKind)) {
        url = await this.dispatch.readApprovalUrl(claim.provider, claim.providerResourceKind,
          claim.providerResourceId, { purchaseAttemptId: claim.expectedPurchaseAttemptId,
            purchaseKind: claim.expectedPurchaseKind,
            offer: claim.expectedOffer, providerItemId: claim.expectedProviderCatalogItem,
            amountMinor: claim.expectedAmountMinor, currency: claim.expectedCurrency });
      } else {
        url = await this.dispatch.readApprovalUrl(claim.provider, claim.providerResourceKind, claim.providerResourceId);
      }
      outcome = "consumed"; return url;
    } catch (error) {
      if (error instanceof ProviderDispatchManualResolutionError) outcome = "manual_resolution";
      throw error;
    } finally {
      await this.transactions.withAccountCredential(credential, "billing_approval_redirect", (transaction) =>
        this.repository.completeApprovalRedirect(transaction, claim.claimId, outcome));
      handle.fill(0);
    }
  }

}

function publicRefundStatus(status: FirstPurchaseRefundStatus): BillingFirstPurchaseRefundStatusReadResponse {
  const base = { schemaVersion: BILLING_SCHEMA_VERSION, state: status.state, refundRequestId: status.refundRequestId,
    purchaseId: status.expectedPurchaseAttemptId, commercialAccess: "read_only" as const,
    requestedAmount: { minor: status.remainingMinorAtAcceptance, currency: "USD" as const },
    retryable: status.state === "retry_wait", retryAfter: status.state === "retry_wait" ? status.retryAt : null };
  if (status.state === "retry_wait" && status.retryAt === null) throw new TypeError("refund retry time is unavailable");
  if (status.state === "refunded") {
    if (status.completedAt === null) throw new TypeError("refund completion time is unavailable");
    return billingFirstPurchaseRefundStatusReadResponseSchema.parse({ ...base, retryable: false,
      retryAfter: null, completedAt: status.completedAt });
  }
  return billingFirstPurchaseRefundStatusReadResponseSchema.parse(base);
}

function publicStatus(status: CommercialBillingStatus | null): BillingStatusReadResponse {
  if (status === null || status.state === "failed") return { schemaVersion: BILLING_SCHEMA_VERSION, state: "none", provider: null,
    offer: null, paidThrough: null, refundEligibleUntil: null };
  const identity = { schemaVersion: BILLING_SCHEMA_VERSION, provider: status.provider, offer: status.offer } as const;
  if (["creating", "creation_unknown", "approval_pending"].includes(status.state)) return { ...identity,
    state: status.state === "approval_pending" ? "approval_pending" : "creation_unknown", checkoutId: status.purchaseAttemptId,
    requestId: status.requestId, campaignCode: status.campaignCode, retryMode: "same_request", paidThrough: null, refundEligibleUntil: null };
  if (status.state === "commercial_read_only" || status.state === "refunded") return { ...identity, state: "commercial_read_only",
    paidThrough: status.paidThrough, refundEligibleUntil: null };
  const state = status.state === "grace" || status.state === "active" ? "active" : status.state === "cancellation_pending"
    ? "cancellation_pending" : status.state === "cancellation_unknown" ? "cancellation_unknown" : "cancel_at_period_end";
  const result = { ...identity, purchaseId: status.purchaseAttemptId, state,
    paidThrough: requiredTimestamp(status.paidThrough), refundEligibleUntil: status.refundEligibleUntil };
  return billingStatusReadResponseSchema.parse(state === "active" ? result : { ...result, requestId: status.requestId });
}

function accountWebCredential(principal: PublicPrincipal): Uint8Array | null { return principal.clientKind === "account_web"
  && principal.transactionCredential instanceof Uint8Array ? principal.transactionCredential : null; }
function requireResource(resources: readonly ProviderResourceFact[], kind: string): ProviderResourceFact {
  const values = resources.filter((value) => value.resourceKind === kind);
  if (values.length !== 1 || values[0] === undefined) throw new CommercialCheckoutCreationUnknownError(); return values[0];
}
function withRole(fact: ProviderResourceFact, role: ProviderResourceFact["role"]): ProviderResourceFact { return { ...fact, role }; }
function digest(value: unknown): Uint8Array { return createHash("sha256").update(JSON.stringify(value)).digest(); }
function requiredTimestamp(value: string | null): string { if (value === null) throw new TypeError("commercial paid-through time is unavailable"); return value; }
function checkoutKey(provider: BillingProvider, offer: CommercialOffer, campaignCode: string | null): string { return `${provider}\0${offer}\0${campaignCode ?? ""}`; }
function normalizeCampaign(value: string | null): string | null { if (value === null) return null; const normalized = value.trim().toUpperCase();
  if (normalized.length < 1 || normalized.length > 64 || !/^[A-Z0-9_-]+$/u.test(normalized)) throw new TypeError("campaign code is invalid"); return normalized; }
function assertIdentifier(value: string, label: string): void { if (value.length < 1 || value.length > 160 || !/^[!-~]+$/u.test(value)) throw new TypeError(`${label} is invalid`); }
