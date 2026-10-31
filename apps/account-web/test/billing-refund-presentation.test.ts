import { describe, expect, it } from "vitest";

import { refundablePurchase } from "../src/billing-refund-presentation";

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
});
