import {
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  type CloudOperationId,
  type CloudTransport,
} from "@gooddealer/cloud-client";

import type { BillingApprovalNavigator } from "../billing-recovery-controller";

const routes: Readonly<Partial<Record<CloudOperationId, { readonly method: "GET" | "POST"; readonly path: string }>>> = {
  [BILLING_CHECKOUT_CREATE_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/checkout" },
  [BILLING_STATUS_READ_OPERATION_ID]: { method: "GET", path: "/v1/account/billing/status" },
  [BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/subscription/cancel" },
  [BILLING_FIXED_TERM_CONFIRM_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/fixed-term/confirm" },
  [BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/first-purchase-refund" },
  [BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID]: { method: "POST", path: "/v1/account/billing/first-purchase-refund/status" },
};

/** A non-2xx billing reply. The payload is untrusted; callers only probe it through strict parsers. */
export class HttpFailure extends Error {
  constructor(readonly status: number, readonly payload: unknown) {
    super(`GoodDealer request failed with HTTP ${status}`);
  }
}

/**
 * Cookie-authenticated billing transport. It reaches only the fixed same-origin Cloud routes, so the
 * account comes from the server session and no request can name another account or origin.
 */
export function createSameOriginBillingTransport(fetcher: (path: string, init: RequestInit) => Promise<Response>): CloudTransport {
  return {
    async send(operationId, payload): Promise<unknown> {
      const route = routes[operationId];
      if (route === undefined) throw new TypeError("Account Web operation is unavailable");
      const response = await fetcher(route.path, {
        method: route.method,
        credentials: "same-origin",
        redirect: "error",
        ...(route.method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}),
      });
      const value = response.headers.get("content-type")?.startsWith("application/json") === true
        ? await response.json() as unknown
        : null;
      if (!response.ok) throw new HttpFailure(response.status, value);
      return value;
    },
  };
}

/** Only this exact non-retryable protocol rejection may release a checkout request identity. */
export function isDeterministicCheckoutRejection(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && Reflect.get(value, "code") === "COMMERCIAL_CHECKOUT_REJECTED"
    && Reflect.get(value, "retryable") === false;
}

/**
 * Navigates only to GoodDealer's same-origin approval endpoint. Account Web never holds a Provider
 * URL; Cloud's server-side responder resolves the Stripe destination from the short-lived handle.
 */
export function createSameOriginApprovalNavigator(location: { readonly origin: string; assign(url: string): void }): BillingApprovalNavigator {
  return {
    navigate(relativePath: string): void {
      const target = new URL(relativePath, location.origin);
      if (target.origin !== location.origin || !target.pathname.startsWith("/billing/approval/")) {
        throw new TypeError("billing approval path is invalid");
      }
      location.assign(target.href);
    },
  };
}
