import { describe, expect, it } from "vitest";

import {
  refundablePurchase,
  refundProgressPresentation,
} from "../src/billing-refund-presentation";

const acceptedIdentity = {
  schemaVersion: 1 as const,
  refundRequestId: "refund-1",
  purchaseId: "purchase-1",
  commercialAccess: "read_only" as const,
  requestedAmount: { minor: 49800, currency: "USD" as const },
  retryable: false as const,
  retryAfter: null,
};

describe("Account Web refund presentation", () => {
  it("exposes only an eligible settled GoodDealer purchase identity", () => {
    expect(refundablePurchase({
      schemaVersion: 1,
      state: "active",
      provider: "stripe",
      offer: "ten_year",
      purchaseId: "purchase-1",
      paidThrough: "2036-09-01T00:00:00Z",
      refundEligibleUntil: "2026-09-15T00:00:00Z",
    }, Date.parse("2026-09-14T00:00:00Z"))).toEqual({ purchaseId: "purchase-1", refundEligibleUntil: "2026-09-15T00:00:00Z" });
    expect(refundablePurchase({
      schemaVersion: 1,
      state: "active",
      provider: "stripe",
      offer: "ten_year",
      purchaseId: "purchase-1",
      paidThrough: "2036-09-01T00:00:00Z",
      refundEligibleUntil: "2026-09-15T00:00:00Z",
    }, Date.parse("2026-09-15T00:00:00Z"))).toBeNull();
    expect(refundablePurchase({
      schemaVersion: 1,
      state: "commercial_read_only",
      provider: "stripe",
      offer: "ten_year",
      paidThrough: null,
      refundEligibleUntil: null,
    })).toBeNull();
  });

  it("polls nonterminal states without presenting them as completed", () => {
    for (const state of ["termination_pending", "termination_unknown", "refund_pending", "refund_unknown"] as const) {
      const view = refundProgressPresentation({ ...acceptedIdentity, state }, (value) => value);
      expect(view.shouldPoll).toBe(true);
      expect(view.action).toBe("hidden");
      expect(view.message).not.toContain("已完成");
    }
  });

  it("offers explicit retry only for retry_wait and stops on terminal states", () => {
    expect(refundProgressPresentation({
      ...acceptedIdentity,
      state: "retry_wait",
      retryable: true,
      retryAfter: "2026-09-15T00:00:00Z",
    }, (value) => value, Date.parse("2026-09-15T00:00:00Z")))
      .toMatchObject({ action: "retry", shouldPoll: true });
    expect(refundProgressPresentation({
      ...acceptedIdentity,
      state: "retry_wait",
      retryable: true,
      retryAfter: "2026-09-15T00:00:00Z",
    }, (value) => value, Date.parse("2026-09-14T23:59:59Z")))
      .toMatchObject({ action: "hidden", shouldPoll: true });
    expect(refundProgressPresentation({
      ...acceptedIdentity,
      state: "manual_resolution",
    }, (value) => value)).toMatchObject({ action: "hidden", shouldPoll: false });
    expect(refundProgressPresentation({
      ...acceptedIdentity,
      state: "refunded",
      completedAt: "2026-09-14T00:00:00Z",
    }, (value) => value)).toMatchObject({ action: "hidden", shouldPoll: false });
  });
});
