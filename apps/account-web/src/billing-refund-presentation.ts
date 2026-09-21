import type {
  BillingFirstPurchaseRefundAcceptedResponse,
  BillingStatusReadResponse,
} from "@gooddealer/protocol/account";

type RefundableBillingStatus = Extract<
  BillingStatusReadResponse,
  { readonly state: "active" | "cancellation_pending" | "cancellation_unknown" | "cancel_at_period_end" }
>;

export interface RefundEligibility {
  readonly purchaseId: string;
  readonly refundEligibleUntil: string;
}

export interface RefundProgressPresentation {
  readonly action: "hidden" | "retry";
  readonly message: string;
  readonly shouldPoll: boolean;
}

export function refundablePurchase(
  status: BillingStatusReadResponse,
  evaluatedAtMs: number = Date.now(),
): RefundEligibility | null {
  if (!isRefundableBillingStatus(status) || status.refundEligibleUntil === null
    || Date.parse(status.refundEligibleUntil) <= evaluatedAtMs) return null;
  return { purchaseId: status.purchaseId, refundEligibleUntil: status.refundEligibleUntil };
}

export function refundProgressPresentation(
  response: BillingFirstPurchaseRefundAcceptedResponse,
  formatTimestamp: (value: string) => string,
  evaluatedAtMs: number = Date.now(),
): RefundProgressPresentation {
  if (response.state === "refunded") {
    return { action: "hidden", message: "首购退款已完成，商业功能保持只读。", shouldPoll: false };
  }
  if (response.state === "manual_resolution") {
    return { action: "hidden", message: "退款需要人工处理，商业功能保持只读。", shouldPoll: false };
  }
  if (response.state === "retry_wait") {
    return {
      action: Date.parse(response.retryAfter) <= evaluatedAtMs ? "retry" : "hidden",
      message: `退款暂时未完成，可在 ${formatTimestamp(response.retryAfter)} 后重试。`,
      shouldPoll: true,
    };
  }
  if (response.state === "termination_pending" || response.state === "termination_unknown") {
    return {
      action: "hidden",
      message: "正在确认订阅终止状态，商业功能已切换为只读。",
      shouldPoll: true,
    };
  }
  return {
    action: "hidden",
    message: "退款请求已接受，商业功能已切换为只读，正在等待 Provider 完成退款。",
    shouldPoll: true,
  };
}

function isRefundableBillingStatus(status: BillingStatusReadResponse): status is RefundableBillingStatus {
  return status.state === "active" || status.state === "cancellation_pending"
    || status.state === "cancellation_unknown" || status.state === "cancel_at_period_end";
}
