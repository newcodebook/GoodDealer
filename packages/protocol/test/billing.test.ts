import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  billingApprovalSchema,
  billingCheckoutCreateResponseSchema,
  billingCheckoutCreateRequestSchema,
  billingFixedTermConfirmRequestSchema,
  billingFixedTermConfirmResponseSchema,
  billingFirstPurchaseRefundRequestResponseSchema,
  billingFirstPurchaseRefundRequestSchema,
  billingFirstPurchaseRefundStatusReadRequestSchema,
  billingFirstPurchaseRefundStatusReadResponseSchema,
  billingStatusReadResponseSchema,
  billingSubscriptionCancelRequestSchema,
  billingSubscriptionCancelResponseSchema,
  commercialOfferSchema,
} from "../src/account/index";

const negativeCorpus = JSON.parse(readFileSync(new URL(
  "../test-vectors/account/billing-public-negative-corpus.json",
  import.meta.url,
), "utf8")) as Record<string, string[]>;
const forbiddenPublicFields = Object.values(negativeCorpus).flat();
const approval = {
  kind: "gooddealer_redirect",
  handle: "A".repeat(43),
  expiresAt: "2026-09-02T16:00:00Z",
} as const;

describe("account billing contracts", () => {
  it("freezes the three commercial terms without a perpetual offer", () => {
    expect(commercialOfferSchema.options).toEqual(["monthly", "annual", "ten_year"]);
  });

  it("accepts only provider-neutral checkout selectors", () => {
    const request = {
      schemaVersion: 1,
      requestId: "billing-request-1",
      provider: "stripe",
      offer: "ten_year",
      campaignCode: null,
    };
    expect(billingCheckoutCreateRequestSchema.parse(request)).toEqual(request);
    for (const field of forbiddenPublicFields) {
      expect(billingCheckoutCreateRequestSchema.safeParse({ ...request, [field]: "attacker" }).success).toBe(false);
    }
  });

  it("returns only an opaque GoodDealer approval handoff", () => {
    const response = {
      schemaVersion: 1,
      requestId: "billing-request-1",
      checkoutId: "checkout-1",
      provider: "stripe",
      offer: "monthly",
      approval,
    };
    expect(billingCheckoutCreateResponseSchema.safeParse(response).success).toBe(true);
    for (const field of forbiddenPublicFields) {
      expect(billingCheckoutCreateResponseSchema.safeParse({ ...response, [field]: "provider-resource" }).success)
        .toBe(false);
      expect(billingCheckoutCreateResponseSchema.safeParse({
        ...response,
        approval: { ...approval, [field]: "provider-resource" },
      }).success).toBe(false);
    }
    expect(billingApprovalSchema.safeParse({ ...approval, handle: "short" }).success).toBe(false);
    expect(billingApprovalSchema.safeParse({
      ...approval,
      handle: "https://checkout.stripe.com/c/pay/provider-resource",
    }).success).toBe(false);
    expect(billingCheckoutCreateResponseSchema.safeParse({
      ...response,
      approvalUrl: "https://checkout.stripe.com/c/pay/provider-resource",
    }).success).toBe(false);
  });

  it("keeps every billing state deadline and identity coherent", () => {
    expect(billingStatusReadResponseSchema.safeParse({
      schemaVersion: 1,
      state: "none",
      provider: null,
      offer: null,
      paidThrough: null,
      refundEligibleUntil: null,
    }).success).toBe(true);
    expect(billingStatusReadResponseSchema.safeParse({
      schemaVersion: 1,
      state: "none",
      provider: "paypal",
      offer: null,
      paidThrough: null,
      refundEligibleUntil: null,
    }).success).toBe(false);
    const identity = { schemaVersion: 1, provider: "stripe", offer: "monthly" } as const;
    const recoverableCheckout = {
      ...identity,
      checkoutId: "checkout-1",
      requestId: "billing-request-1",
      campaignCode: "LAUNCH",
      retryMode: "same_request",
      paidThrough: null,
      refundEligibleUntil: null,
    } as const;
    for (const state of ["creation_unknown", "approval_pending"] as const) {
      const status = { ...recoverableCheckout, state };
      expect(billingStatusReadResponseSchema.safeParse(status).success).toBe(true);
      for (const field of forbiddenPublicFields) {
        expect(billingStatusReadResponseSchema.safeParse({
          ...status,
          [field]: "provider-resource",
        }).success).toBe(false);
      }
    }
    for (const invalid of [
      { checkoutId: undefined },
      { requestId: undefined },
      { campaignCode: "lowercase" },
      { retryMode: "new_request" },
      { state: "unknown" },
    ]) {
      expect(billingStatusReadResponseSchema.safeParse({
        ...identity,
        state: "approval_pending",
        checkoutId: "checkout-1",
        requestId: "billing-request-1",
        campaignCode: null,
        retryMode: "same_request",
        paidThrough: null,
        refundEligibleUntil: null,
        ...invalid,
      }).success).toBe(false);
    }
    expect(billingStatusReadResponseSchema.safeParse({
      ...identity,
      state: "active",
      purchaseId: "purchase-1",
      paidThrough: "2027-09-01T00:00:00Z",
      refundEligibleUntil: null,
    }).success).toBe(true);
    expect(billingStatusReadResponseSchema.safeParse({
      ...identity,
      state: "active",
      paidThrough: "2027-09-01T00:00:00Z",
      refundEligibleUntil: null,
    }).success).toBe(false);
    expect(billingStatusReadResponseSchema.safeParse({
      ...identity,
      state: "active",
      checkoutId: "checkout-1",
      requestId: "billing-request-1",
      campaignCode: null,
      retryMode: "same_request",
      paidThrough: "2027-09-01T00:00:00Z",
      refundEligibleUntil: null,
    }).success).toBe(false);
    for (const state of ["cancellation_pending", "cancellation_unknown", "cancel_at_period_end"] as const) {
      const cancellationStatus = {
        ...identity,
        state,
        purchaseId: "purchase-1",
        requestId: "cancel-request-1",
        paidThrough: "2027-09-01T00:00:00Z",
        refundEligibleUntil: null,
      };
      expect(billingStatusReadResponseSchema.safeParse(cancellationStatus).success).toBe(true);
      expect(billingStatusReadResponseSchema.safeParse({ ...cancellationStatus, paidThrough: null }).success)
        .toBe(false);
      for (const field of forbiddenPublicFields) {
        expect(billingStatusReadResponseSchema.safeParse({
          ...cancellationStatus,
          [field]: "provider-resource",
        }).success).toBe(false);
      }
    }
    expect(billingStatusReadResponseSchema.safeParse({
      ...identity,
      state: "active",
      paidThrough: null,
      refundEligibleUntil: null,
    }).success).toBe(false);
    expect(billingStatusReadResponseSchema.safeParse({
      ...identity,
      state: "cancel_at_period_end",
      paidThrough: null,
      refundEligibleUntil: null,
    }).success).toBe(false);
    expect(billingStatusReadResponseSchema.safeParse({
      ...identity,
      state: "commercial_read_only",
      paidThrough: "2027-09-01T00:00:00Z",
      refundEligibleUntil: "2026-09-10T00:00:00Z",
    }).success).toBe(false);
  });

  it("rejects the recursive public-field corpus from every billing status", () => {
    const statuses: unknown[] = [
      {
        schemaVersion: 1, state: "none", provider: null, offer: null,
        paidThrough: null, refundEligibleUntil: null,
      },
      {
        schemaVersion: 1, state: "creation_unknown", provider: "stripe", offer: "monthly",
        checkoutId: "checkout-1", requestId: "billing-request-1", campaignCode: null,
        retryMode: "same_request", paidThrough: null, refundEligibleUntil: null,
      },
      {
        schemaVersion: 1, state: "approval_pending", provider: "paypal", offer: "ten_year",
        checkoutId: "checkout-2", requestId: "billing-request-2", campaignCode: "LAUNCH",
        retryMode: "same_request", paidThrough: null, refundEligibleUntil: null,
      },
      {
        schemaVersion: 1, state: "active", provider: "stripe", offer: "annual",
        purchaseId: "purchase-1", paidThrough: "2027-09-01T00:00:00Z", refundEligibleUntil: null,
      },
      ...(["cancellation_pending", "cancellation_unknown", "cancel_at_period_end"] as const).map((state) => ({
        schemaVersion: 1, state, provider: "stripe", offer: "annual", requestId: "cancel-request-1",
        purchaseId: "purchase-1", paidThrough: "2027-09-01T00:00:00Z", refundEligibleUntil: null,
      })),
      {
        schemaVersion: 1, state: "commercial_read_only", provider: "stripe", offer: "annual",
        paidThrough: null, refundEligibleUntil: null,
      },
    ];
    for (const status of statuses) {
      expect(billingStatusReadResponseSchema.safeParse(status).success).toBe(true);
      for (const field of forbiddenPublicFields) {
        expect(billingStatusReadResponseSchema.safeParse({
          ...(status as object),
          [field]: "provider-resource",
        }).success).toBe(false);
      }
    }
  });

  it("reports cancellation uncertainty without claiming Provider-confirmed nonrenewal", () => {
    for (const state of ["cancellation_pending", "cancellation_unknown", "cancel_at_period_end"] as const) {
      const response = {
        schemaVersion: 1,
        state,
        requestId: "cancel-request-1",
        paidThrough: "2027-09-01T00:00:00Z",
      };
      expect(billingSubscriptionCancelResponseSchema.safeParse(response).success).toBe(true);
      for (const field of forbiddenPublicFields) {
        expect(billingSubscriptionCancelResponseSchema.safeParse({
          ...response,
          [field]: "provider-resource",
        }).success).toBe(false);
      }
    }
    expect(billingSubscriptionCancelRequestSchema.safeParse({
      schemaVersion: 1,
      requestId: "cancel-request-1",
    }).success).toBe(true);
    expect(billingSubscriptionCancelRequestSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  });

  it("correlates fixed-term capture by GoodDealer request and checkout identity", () => {
    const request = {
      schemaVersion: 1,
      requestId: "capture-request-1",
      checkoutId: "checkout-1",
    };
    const response = {
      ...request,
      state: "processing",
    };
    expect(billingFixedTermConfirmRequestSchema.safeParse(request).success).toBe(true);
    expect(billingFixedTermConfirmResponseSchema.safeParse(response).success).toBe(true);
    for (const field of forbiddenPublicFields) {
      expect(billingFixedTermConfirmRequestSchema.safeParse({ ...request, [field]: "attacker" }).success).toBe(false);
      expect(billingFixedTermConfirmResponseSchema.safeParse({ ...response, [field]: "attacker" }).success).toBe(false);
    }
  });

  it("defines a closed first-purchase refund request and truthful accepted states", () => {
    const request = { schemaVersion: 1, requestId: "refund-idempotency-1", purchaseId: "purchase-1" };
    expect(billingFirstPurchaseRefundRequestSchema.parse(request)).toEqual(request);
    expect(billingFirstPurchaseRefundStatusReadRequestSchema.parse({
      schemaVersion: 1,
      refundRequestId: "refund-request-1",
    })).toEqual({ schemaVersion: 1, refundRequestId: "refund-request-1" });
    const accepted = {
      schemaVersion: 1,
      refundRequestId: "refund-request-1",
      purchaseId: request.purchaseId,
      commercialAccess: "read_only",
      requestedAmount: { minor: 980, currency: "USD" },
      retryable: false,
      retryAfter: null,
    } as const;
    for (const state of [
      "termination_pending", "termination_unknown", "refund_pending", "refund_unknown", "manual_resolution",
    ] as const) {
      expect(billingFirstPurchaseRefundRequestResponseSchema.safeParse({ ...accepted, state }).success).toBe(true);
    }
    expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
      ...accepted,
      state: "retry_wait",
      retryable: true,
      retryAfter: "2026-09-04T00:00:00Z",
    }).success).toBe(true);
    expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
      ...accepted,
      state: "refunded",
      completedAt: "2026-09-03T12:00:00Z",
    }).success).toBe(true);
  });

  it("rejects false refund completion, invalid money, and public Provider internals", () => {
    const accepted = {
      schemaVersion: 1,
      state: "refund_unknown",
      refundRequestId: "refund-request-1",
      purchaseId: "purchase-1",
      commercialAccess: "read_only",
      requestedAmount: { minor: 980, currency: "USD" },
      retryable: false,
      retryAfter: null,
    } as const;
    for (const minor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
        ...accepted, requestedAmount: { ...accepted.requestedAmount, minor },
      }).success).toBe(false);
    }
    expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
      ...accepted, requestedAmount: { minor: 980, currency: "EUR" },
    }).success).toBe(false);
    expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
      ...accepted, state: "refunded",
    }).success).toBe(false);
    expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
      ...accepted, state: "retry_wait", retryable: true, retryAfter: null,
    }).success).toBe(false);
    expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
      ...accepted, state: "refund_unknown", retryAfter: "2026-09-04T00:00:00Z",
    }).success).toBe(false);
    for (const field of forbiddenPublicFields) {
      expect(billingFirstPurchaseRefundRequestSchema.safeParse({
        schemaVersion: 1, requestId: "refund-idempotency-1", purchaseId: "purchase-1", [field]: "attacker",
      }).success).toBe(false);
      expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
        ...accepted, [field]: "provider-resource",
      }).success).toBe(false);
      if (field !== "currency" && field !== "amount") {
        expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
          ...accepted,
          requestedAmount: { ...accepted.requestedAmount, [field]: "provider-resource" },
        }).success).toBe(false);
      }
    }
  });

  it("derives refund retryability and scheduling strictly from aggregate state", () => {
    const accepted = {
      schemaVersion: 1,
      refundRequestId: "refund-request-1",
      purchaseId: "purchase-1",
      commercialAccess: "read_only",
      requestedAmount: { minor: 980, currency: "USD" },
    } as const;
    for (const state of [
      "termination_pending",
      "termination_unknown",
      "refund_pending",
      "refund_unknown",
      "manual_resolution",
    ] as const) {
      expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
        ...accepted, state, retryable: true, retryAfter: null,
      }).success).toBe(false);
      expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
        ...accepted, state, retryable: false, retryAfter: "2026-09-04T00:00:00Z",
      }).success).toBe(false);
    }
    expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
      ...accepted,
      state: "retry_wait",
      retryable: false,
      retryAfter: "2026-09-04T00:00:00Z",
    }).success).toBe(false);
    for (const retryAfter of [null, "2026-09-04", "not-a-timestamp"]) {
      expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
        ...accepted, state: "retry_wait", retryable: true, retryAfter,
      }).success).toBe(false);
    }
    for (const invalid of [
      { retryable: true, retryAfter: null },
      { retryable: false, retryAfter: "2026-09-04T00:00:00Z" },
    ]) {
      expect(billingFirstPurchaseRefundStatusReadResponseSchema.safeParse({
        ...accepted,
        state: "refunded",
        completedAt: "2026-09-03T12:00:00Z",
        ...invalid,
      }).success).toBe(false);
    }
  });

  it("keeps deterministic refund rejection closed and separate from accepted identity", () => {
    for (const reason of [
      "not_first_paid_purchase", "window_elapsed", "not_paid", "already_claimed",
      "already_fully_reversed", "purchase_mismatch",
    ] as const) {
      expect(billingFirstPurchaseRefundRequestResponseSchema.safeParse({
        schemaVersion: 1, state: "rejected", reason,
      }).success).toBe(true);
    }
    expect(billingFirstPurchaseRefundRequestResponseSchema.safeParse({
      schemaVersion: 1, state: "rejected", reason: "provider_declined",
    }).success).toBe(false);
    expect(billingFirstPurchaseRefundRequestResponseSchema.safeParse({
      schemaVersion: 1, state: "rejected", reason: "not_paid", refundRequestId: "refund-request-1",
    }).success).toBe(false);
  });
});
