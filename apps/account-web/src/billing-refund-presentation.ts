import type { BillingStatusReadResponse } from "@gooddealer/protocol/account";

type RefundableBillingStatus = Extract<
  BillingStatusReadResponse,
  { readonly state: "active" | "cancellation_pending" | "cancellation_unknown" | "cancel_at_period_end" }
>;

export interface RefundEligibility {
  readonly purchaseId: string;
  readonly refundEligibleUntil: string;
}

export function refundablePurchase(
  status: BillingStatusReadResponse,
  evaluatedAtMs: number = Date.now(),
): RefundEligibility | null {
  if (!isRefundableBillingStatus(status) || status.refundEligibleUntil === null
    || Date.parse(status.refundEligibleUntil) <= evaluatedAtMs) return null;
  return { purchaseId: status.purchaseId, refundEligibleUntil: status.refundEligibleUntil };
}

function isRefundableBillingStatus(status: BillingStatusReadResponse): status is RefundableBillingStatus {
  return status.state === "active" || status.state === "cancellation_pending"
    || status.state === "cancellation_unknown" || status.state === "cancel_at_period_end";
}
