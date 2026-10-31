import type {
  BillingFirstPurchaseRefundAcceptedResponse,
  BillingStatusReadResponse,
} from "@gooddealer/protocol/account";
import { describe, expect, it } from "vitest";

import { licenseView, refundProgressView } from "./license-view";

const now = Date.parse("2026-10-31T00:00:00.000Z");
const subscription = {
  schemaVersion: 1,
  provider: "stripe",
  offer: "annual",
  purchaseId: "pur_1",
  paidThrough: "2026-12-31T00:00:00.000Z",
  refundEligibleUntil: "2026-11-05T00:00:00.000Z",
} as const;
const checkout = {
  schemaVersion: 1,
  provider: "stripe",
  offer: "monthly",
  checkoutId: "chk_1",
  requestId: "web-1",
  campaignCode: null,
  retryMode: "same_request",
  paidThrough: null,
  refundEligibleUntil: null,
} as const;

describe("licenseView", () => {
  it("allows checkout only when no provider slot is held", () => {
    const none: BillingStatusReadResponse = {
      schemaVersion: 1, state: "none", provider: null, offer: null, paidThrough: null, refundEligibleUntil: null,
    };
    expect(licenseView(none, now)).toMatchObject({ phase: "none", canCheckout: true, canCancel: false, daysRemaining: null });
    for (const state of ["creation_unknown", "approval_pending"] as const) {
      expect(licenseView({ ...checkout, state }, now)).toMatchObject({ phase: "checkout_pending", canCheckout: false });
    }
    expect(licenseView({ ...subscription, state: "active" }, now).canCheckout).toBe(false);
    expect(licenseView({ schemaVersion: 1, state: "commercial_read_only", provider: "stripe", offer: "annual",
      paidThrough: null, refundEligibleUntil: null }, now)).toMatchObject({ phase: "read_only", canCheckout: false });
  });

  it("offers cancellation only for an active renewable subscription", () => {
    expect(licenseView({ ...subscription, state: "active" }, now)).toMatchObject({ phase: "active", canCancel: true, daysRemaining: 61 });
    expect(licenseView({ ...subscription, offer: "ten_year", state: "active" }, now).canCancel).toBe(false);
    for (const state of ["cancellation_pending", "cancellation_unknown", "cancel_at_period_end"] as const) {
      expect(licenseView({ ...subscription, requestId: "cancel-1", state }, now).canCancel).toBe(false);
    }
  });

  it("exposes the refund only inside its window and never counts negative days", () => {
    expect(licenseView({ ...subscription, state: "active" }, now).refund).toEqual({
      purchaseId: "pur_1", refundEligibleUntil: "2026-11-05T00:00:00.000Z",
    });
    const later = Date.parse("2027-01-02T00:00:00.000Z");
    expect(licenseView({ ...subscription, state: "active" }, later)).toMatchObject({ refund: null, daysRemaining: 0 });
  });

  it("treats an accepted refund as read-only even before billing status catches up", () => {
    expect(licenseView({ ...subscription, state: "active" }, now, "progress")).toMatchObject({
      phase: "read_only", canCancel: false, canCheckout: false, refund: null, currentOffer: null, daysRemaining: null,
    });
  });

  it("fails closed while a refund outcome is unknown and drops the window once rejected", () => {
    for (const refund of ["submitting", "unconfirmed"] as const) {
      expect(licenseView({ ...subscription, state: "active" }, now, refund)).toMatchObject({
        phase: "active", canCancel: false, refund: null, refundOutcomePending: true,
      });
    }
    expect(licenseView({ ...subscription, state: "active" }, now, "rejected")).toMatchObject({ canCancel: true, refund: null });
  });

  it("shows a held term only while paid access lasts", () => {
    expect(licenseView({ ...subscription, requestId: "cancel-1", state: "cancel_at_period_end" }, now))
      .toMatchObject({ phase: "ending", currentOffer: "annual", daysRemaining: 61 });
    expect(licenseView({ ...checkout, state: "approval_pending" }, now)).toMatchObject({ currentOffer: null, paidThrough: null });
    expect(licenseView({ schemaVersion: 1, state: "commercial_read_only", provider: "stripe", offer: "annual",
      paidThrough: "2026-12-31T00:00:00.000Z", refundEligibleUntil: null }, now)).toMatchObject({ currentOffer: null, daysRemaining: null });
  });
});

describe("refundProgressView", () => {
  const accepted = {
    schemaVersion: 1,
    refundRequestId: "rr_1",
    purchaseId: "pur_1",
    commercialAccess: "read_only",
    requestedAmount: { minor: 9800, currency: "USD" },
  } as const;

  it("treats every non-terminal state as read-only progress without retry", () => {
    for (const state of ["termination_pending", "termination_unknown", "refund_pending", "refund_unknown", "manual_resolution"] as const) {
      const response: BillingFirstPurchaseRefundAcceptedResponse = { ...accepted, state, retryable: false, retryAfter: null };
      expect(refundProgressView(response, now).canRetry).toBe(false);
    }
    expect(refundProgressView({ ...accepted, state: "refunded", retryable: false, retryAfter: null,
      completedAt: "2026-10-30T00:00:00.000Z" }, now).messageKey).toBe("refundDone");
  });

  it("re-enables retry only after retryAfter has passed", () => {
    const response: BillingFirstPurchaseRefundAcceptedResponse = {
      ...accepted, state: "retry_wait", retryable: true, retryAfter: "2026-10-31T00:05:00.000Z",
    };
    expect(refundProgressView(response, now)).toEqual({
      messageKey: "refundRetryWait", retryAfter: "2026-10-31T00:05:00.000Z", canRetry: false,
    });
    expect(refundProgressView(response, now + 5 * 60_000).canRetry).toBe(true);
  });
});
