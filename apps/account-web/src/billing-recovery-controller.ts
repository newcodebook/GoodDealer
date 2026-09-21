import type { BillingClient } from "@gooddealer/cloud-client";
import {
  accountRejectionSchema,
  billingCheckoutCreateRequestSchema,
  billingCheckoutCreateResponseSchema,
  billingFirstPurchaseRefundRequestSchema,
  billingFirstPurchaseRefundStatusReadRequestSchema,
  billingSubscriptionCancelRequestSchema,
  type BillingCheckoutCreateRequest,
  type BillingCheckoutCreateResponse,
  type BillingFirstPurchaseRefundAcceptedResponse,
  type BillingFirstPurchaseRefundRequest,
  type BillingFirstPurchaseRefundRequestResponse,
  type BillingStatusReadResponse,
  type BillingSubscriptionCancelRequest,
  type BillingSubscriptionCancelResponse,
} from "@gooddealer/protocol/account";

export type BillingCheckoutRecoveryRecord =
  | { readonly state: "pending"; readonly request: BillingCheckoutCreateRequest }
  | { readonly state: "deterministically_rejected"; readonly requestId: string };

/** Secret-free persistence port; browser composition may back it with one purpose-specific storage key. */
export interface BillingCheckoutRecoveryStore {
  load(): Promise<unknown>;
  save(value: BillingCheckoutRecoveryRecord): Promise<void>;
  clear(): Promise<void>;
}

/** Browser composition implements this with same-origin navigation, never a Provider URL. */
export interface BillingApprovalNavigator {
  navigate(relativePath: string): void | Promise<void>;
}

type RecoverableBillingStatus = Extract<
  BillingStatusReadResponse,
  { readonly state: "creation_unknown" | "approval_pending" }
>;
type SettledBillingStatus = Exclude<BillingStatusReadResponse, RecoverableBillingStatus>;

export type BillingRecoveryResult =
  | { readonly state: "checkout_recovered"; readonly checkout: BillingCheckoutCreateResponse }
  | { readonly state: "new_request_required"; readonly status: Extract<BillingStatusReadResponse, { readonly state: "none" }> }
  | { readonly state: "settled"; readonly status: SettledBillingStatus };

/** Coordinates browser-local request custody without owning payment or account authority. */
export class AccountBillingRecoveryController {
  constructor(
    private readonly billing: BillingClient,
    private readonly store: BillingCheckoutRecoveryStore,
    private readonly assertCurrent: () => void | Promise<void> = () => undefined,
  ) {}

  async startCheckout(value: unknown): Promise<BillingCheckoutCreateResponse> {
    const request = billingCheckoutCreateRequestSchema.parse(value);
    const stored = parseRecoveryRecord(await this.store.load());
    if (stored?.state === "pending" && !sameRequest(stored.request, request)) {
      throw new TypeError("a different billing checkout is already pending");
    }
    if (stored?.state === "deterministically_rejected" && stored.requestId === request.requestId) {
      throw new TypeError("a deterministically rejected checkout requires a new request id");
    }
    await this.assertCurrent();
    await this.store.save({ state: "pending", request });
    await this.assertCurrent();
    return this.billing.createCheckout(request);
  }

  async navigateToApproval(value: unknown, navigator: BillingApprovalNavigator): Promise<void> {
    const checkout = billingCheckoutCreateResponseSchema.parse(value);
    await navigator.navigate(this.billing.approvalPath(checkout.approval));
  }

  async markDeterministicallyRejected(requestId: unknown, rejectionValue: unknown): Promise<void> {
    const rejection = accountRejectionSchema.parse(rejectionValue);
    if (rejection.code !== "COMMERCIAL_CHECKOUT_REJECTED" || rejection.retryable) {
      throw new TypeError("billing rejection is not deterministic");
    }
    const stored = parseRecoveryRecord(await this.store.load());
    if (stored?.state !== "pending" || stored.request.requestId !== requestId) {
      throw new TypeError("deterministic billing rejection does not match the pending request");
    }
    await this.assertCurrent();
    await this.store.save({ state: "deterministically_rejected", requestId: stored.request.requestId });
  }

  async recover(): Promise<BillingRecoveryResult> {
    const stored = parseRecoveryRecord(await this.store.load());
    const status = await this.billing.readStatus();
    await this.assertCurrent();
    if (status.state === "creation_unknown" || status.state === "approval_pending") {
      const authoritativeRequest = requestFromStatus(status);
      if (stored?.state === "deterministically_rejected"
        || (stored?.state === "pending" && !sameRequest(stored.request, authoritativeRequest))) {
        throw new TypeError("pending billing status does not match browser request custody");
      }
      if (stored === null) {
        await this.store.save({ state: "pending", request: authoritativeRequest });
        await this.assertCurrent();
      }
      return {
        state: "checkout_recovered",
        checkout: await this.billing.recoverPendingCheckout(status),
      };
    }
    if (status.state === "none") {
      if (stored?.state === "pending") {
        return {
          state: "checkout_recovered",
          checkout: await this.billing.createCheckout(stored.request),
        };
      }
      return { state: "new_request_required", status };
    }
    await this.assertCurrent();
    await this.store.clear();
    return { state: "settled", status };
  }
}

export interface BillingCancellationRecoveryStore {
  load(): Promise<unknown>;
  save(value: BillingSubscriptionCancelRequest): Promise<void>;
  clear(): Promise<void>;
}

type CancellationStatus = Extract<
  BillingStatusReadResponse,
  { readonly state: "cancellation_pending" | "cancellation_unknown" | "cancel_at_period_end" }
>;
type RecoverableCancellationStatus = Extract<
  CancellationStatus,
  { readonly state: "cancellation_pending" | "cancellation_unknown" }
>;

export type BillingCancellationRecoveryResult =
  | { readonly state: "cancellation_recovered"; readonly response: BillingSubscriptionCancelResponse }
  | { readonly state: "new_request_required" }
  | { readonly state: "settled"; readonly status: Exclude<BillingStatusReadResponse, RecoverableCancellationStatus> };

/** Preserves the exact cancellation idempotency identity across timeouts and page refreshes. */
export class AccountBillingCancellationController {
  constructor(
    private readonly billing: BillingClient,
    private readonly store: BillingCancellationRecoveryStore,
    private readonly assertCurrent: () => void | Promise<void> = () => undefined,
  ) {}

  async requestCancellation(value: unknown): Promise<BillingSubscriptionCancelResponse> {
    const request = billingSubscriptionCancelRequestSchema.parse(value);
    const stored = parseCancellationRequest(await this.store.load());
    if (stored !== null && stored.requestId !== request.requestId) {
      throw new TypeError("a different billing cancellation is already pending");
    }
    await this.assertCurrent();
    await this.store.save(request);
    await this.assertCurrent();
    return this.finish(await this.billing.cancelSubscription(request));
  }

  async recover(): Promise<BillingCancellationRecoveryResult> {
    const stored = parseCancellationRequest(await this.store.load());
    const status = await this.billing.readStatus();
    await this.assertCurrent();
    if (
      status.state === "cancellation_pending"
      || status.state === "cancellation_unknown"
      || status.state === "cancel_at_period_end"
    ) {
      if (stored !== null && stored.requestId !== status.requestId) {
        throw new TypeError("billing cancellation status does not match browser request custody");
      }
      if (status.state === "cancel_at_period_end") {
        await this.store.clear();
        return { state: "settled", status };
      }
      const request = billingSubscriptionCancelRequestSchema.parse({
        schemaVersion: status.schemaVersion,
        requestId: status.requestId,
      });
      if (stored === null) await this.store.save(request);
      return {
        state: "cancellation_recovered",
        response: await this.finish(await this.billing.cancelSubscription(request)),
      };
    }
    if (status.state === "active" && stored !== null) {
      return {
        state: "cancellation_recovered",
        response: await this.finish(await this.billing.cancelSubscription(stored)),
      };
    }
    if (stored === null && status.state === "active") return { state: "new_request_required" };
    await this.store.clear();
    return { state: "settled", status };
  }

  private async finish(response: BillingSubscriptionCancelResponse): Promise<BillingSubscriptionCancelResponse> {
    await this.assertCurrent();
    if (response.state === "cancel_at_period_end") await this.store.clear();
    return response;
  }
}

export type BillingRefundRecoveryRecord =
  | {
      readonly state: "pending";
      readonly request: BillingFirstPurchaseRefundRequest;
      readonly refundRequestId: string | null;
    }
  | {
      readonly state: "deterministically_rejected";
      readonly requestId: string;
      readonly purchaseId: string;
    };

export interface BillingRefundRecoveryStore {
  load(): Promise<unknown>;
  save(value: BillingRefundRecoveryRecord): Promise<void>;
  clear(): Promise<void>;
}

export type BillingRefundRecoveryResult =
  | { readonly state: "new_request_required" }
  | { readonly state: "refund_recovered"; readonly response: BillingFirstPurchaseRefundAcceptedResponse };

/** Keeps browser custody of GoodDealer identities while Cloud owns every refund side effect and fact. */
export class AccountBillingRefundController {
  constructor(
    private readonly billing: BillingClient,
    private readonly store: BillingRefundRecoveryStore,
    private readonly now: () => Date = () => new Date(),
    private readonly assertCurrent: () => void | Promise<void> = () => undefined,
  ) {}

  async requestRefund(value: unknown): Promise<BillingFirstPurchaseRefundRequestResponse> {
    const request = billingFirstPurchaseRefundRequestSchema.parse(value);
    const stored = parseRefundRecoveryRecord(await this.store.load());
    if (stored?.state === "pending" && !sameRefundRequest(stored.request, request)) {
      throw new TypeError("a different first-purchase refund is already pending");
    }
    if (stored?.state === "deterministically_rejected" && stored.requestId === request.requestId) {
      throw new TypeError("a deterministically rejected refund requires a new request id");
    }
    const expectedRefundRequestId = stored?.state === "pending" ? stored.refundRequestId : null;
    await this.assertCurrent();
    await this.store.save({ state: "pending", request, refundRequestId: expectedRefundRequestId });
    await this.assertCurrent();
    return this.finishRequest(
      request,
      await this.billing.requestFirstPurchaseRefund(request),
      expectedRefundRequestId,
    );
  }

  async retryRefund(): Promise<BillingFirstPurchaseRefundRequestResponse> {
    const stored = parseRefundRecoveryRecord(await this.store.load());
    if (stored?.state !== "pending" || stored.refundRequestId === null) {
      throw new TypeError("no accepted first-purchase refund is available to retry");
    }
    const status = await this.readCorrelatedStatus(stored);
    if (status.state !== "retry_wait") {
      if (status.state === "refunded") await this.store.clear();
      return status;
    }
    if (Date.parse(status.retryAfter) > this.now().getTime()) {
      throw new TypeError("first-purchase refund retry is not due");
    }
    await this.assertCurrent();
    return this.finishRequest(
      stored.request,
      await this.billing.requestFirstPurchaseRefund(stored.request),
      stored.refundRequestId,
    );
  }

  async recover(): Promise<BillingRefundRecoveryResult> {
    const stored = parseRefundRecoveryRecord(await this.store.load());
    if (stored === null || stored.state === "deterministically_rejected") {
      return { state: "new_request_required" };
    }
    if (stored.refundRequestId === null) {
      await this.assertCurrent();
      const response = await this.finishRequest(
        stored.request,
        await this.billing.requestFirstPurchaseRefund(stored.request),
      );
      if (response.state === "rejected") return { state: "new_request_required" };
      return { state: "refund_recovered", response };
    }
    const response = await this.readCorrelatedStatus(stored);
    if (response.state === "refunded") await this.store.clear();
    return { state: "refund_recovered", response };
  }

  private async readCorrelatedStatus(stored: Extract<BillingRefundRecoveryRecord, { readonly state: "pending" }>) {
    if (stored.refundRequestId === null) throw new TypeError("accepted refund identity is unavailable");
    const response = await this.billing.readFirstPurchaseRefundStatus(
      billingFirstPurchaseRefundStatusReadRequestSchema.parse({
        schemaVersion: stored.request.schemaVersion,
        refundRequestId: stored.refundRequestId,
      }),
    );
    if (response.purchaseId !== stored.request.purchaseId) {
      throw new TypeError("first-purchase refund status does not match browser request custody");
    }
    return response;
  }

  private async finishRequest(
    request: BillingFirstPurchaseRefundRequest,
    response: BillingFirstPurchaseRefundRequestResponse,
    expectedRefundRequestId: string | null = null,
  ): Promise<BillingFirstPurchaseRefundRequestResponse> {
    await this.assertCurrent();
    if (response.state === "rejected") {
      await this.store.save({
        state: "deterministically_rejected",
        requestId: request.requestId,
        purchaseId: request.purchaseId,
      });
      return response;
    }
    if (response.purchaseId !== request.purchaseId) {
      throw new TypeError("first-purchase refund response does not match browser request custody");
    }
    if (expectedRefundRequestId !== null && response.refundRequestId !== expectedRefundRequestId) {
      throw new TypeError("first-purchase refund response changed its stable refund request identity");
    }
    if (response.state === "refunded") {
      await this.store.clear();
    } else {
      await this.store.save({ state: "pending", request, refundRequestId: response.refundRequestId });
    }
    return response;
  }
}

function requestFromStatus(
  status: RecoverableBillingStatus,
): BillingCheckoutCreateRequest {
  return billingCheckoutCreateRequestSchema.parse({
    schemaVersion: status.schemaVersion,
    requestId: status.requestId,
    provider: status.provider,
    offer: status.offer,
    campaignCode: status.campaignCode,
  });
}

function parseRecoveryRecord(value: unknown): BillingCheckoutRecoveryRecord | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("billing recovery record is invalid");
  const record = value as Record<string, unknown>;
  if (record.state === "pending" && Object.keys(record).length === 2) {
    return { state: "pending", request: billingCheckoutCreateRequestSchema.parse(record.request) };
  }
  if (
    record.state === "deterministically_rejected"
    && Object.keys(record).length === 2
    && typeof record.requestId === "string"
    && /^[A-Za-z0-9_-]{1,80}$/u.test(record.requestId)
  ) return { state: "deterministically_rejected", requestId: record.requestId };
  throw new TypeError("billing recovery record is invalid");
}

function parseCancellationRequest(value: unknown): BillingSubscriptionCancelRequest | null {
  if (value === null) return null;
  return billingSubscriptionCancelRequestSchema.parse(value);
}

function parseRefundRecoveryRecord(value: unknown): BillingRefundRecoveryRecord | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("billing refund recovery record is invalid");
  }
  const record = value as Record<string, unknown>;
  if (record.state === "pending" && Object.keys(record).length === 3) {
    const request = billingFirstPurchaseRefundRequestSchema.parse(record.request);
    const refundRequestId = record.refundRequestId === null
      ? null
      : billingFirstPurchaseRefundStatusReadRequestSchema.parse({
          schemaVersion: request.schemaVersion,
          refundRequestId: record.refundRequestId,
        }).refundRequestId;
    return { state: "pending", request, refundRequestId };
  }
  if (record.state === "deterministically_rejected" && Object.keys(record).length === 3) {
    const request = billingFirstPurchaseRefundRequestSchema.parse({
      schemaVersion: 1,
      requestId: record.requestId,
      purchaseId: record.purchaseId,
    });
    return { state: "deterministically_rejected", requestId: request.requestId, purchaseId: request.purchaseId };
  }
  throw new TypeError("billing refund recovery record is invalid");
}

function sameRequest(left: BillingCheckoutCreateRequest, right: BillingCheckoutCreateRequest): boolean {
  return left.requestId === right.requestId
    && left.provider === right.provider
    && left.offer === right.offer
    && left.campaignCode === right.campaignCode;
}

function sameRefundRequest(
  left: BillingFirstPurchaseRefundRequest,
  right: BillingFirstPurchaseRefundRequest,
): boolean {
  return left.requestId === right.requestId && left.purchaseId === right.purchaseId;
}
