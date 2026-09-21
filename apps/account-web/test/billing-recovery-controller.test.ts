import { describe, expect, it, vi } from "vitest";

import {
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BillingClient,
  type CloudTransport,
} from "@gooddealer/cloud-client";

import {
  AccountBillingCancellationController,
  AccountBillingRecoveryController,
  AccountBillingRefundController,
  type BillingCancellationRecoveryStore,
  type BillingCheckoutRecoveryRecord,
  type BillingCheckoutRecoveryStore,
  type BillingRefundRecoveryRecord,
  type BillingRefundRecoveryStore,
} from "../src/index";

const request = {
  schemaVersion: 1 as const,
  requestId: "billing-request-1",
  provider: "stripe" as const,
  offer: "annual" as const,
  campaignCode: "LAUNCH",
};

const pendingStatus = {
  schemaVersion: 1 as const,
  state: "approval_pending" as const,
  checkoutId: "checkout-1",
  requestId: request.requestId,
  provider: request.provider,
  offer: request.offer,
  campaignCode: request.campaignCode,
  retryMode: "same_request" as const,
  paidThrough: null,
  refundEligibleUntil: null,
};

const checkout = {
  schemaVersion: 1 as const,
  requestId: request.requestId,
  checkoutId: pendingStatus.checkoutId,
  provider: request.provider,
  offer: request.offer,
  approval: {
    kind: "gooddealer_redirect" as const,
    handle: "A".repeat(43),
    expiresAt: "2026-09-02T16:00:00Z",
  },
};

describe("Account Web billing recovery controller", () => {
  it("persists the complete request identity before crossing the Provider side-effect boundary", async () => {
    const store = new MemoryStore();
    const send = vi.fn(async (operationId: string) => {
      expect(operationId).toBe(BILLING_CHECKOUT_CREATE_OPERATION_ID);
      expect(store.value).toEqual({ state: "pending", request });
      return checkout;
    });
    const controller = new AccountBillingRecoveryController(
      new BillingClient({ send } as CloudTransport),
      store,
    );

    await expect(controller.startCheckout(request)).resolves.toEqual(checkout);
    expect(store.value).toEqual({ state: "pending", request });
  });

  it("navigates only through the same-origin GoodDealer approval endpoint", async () => {
    const navigate = vi.fn();
    const controller = new AccountBillingRecoveryController(
      new BillingClient({ async send() { throw new Error("must not send"); } }),
      new MemoryStore(),
    );
    await controller.navigateToApproval(checkout, { navigate });
    expect(navigate).toHaveBeenCalledWith(`/billing/approval/${"A".repeat(43)}`);
    await expect(controller.navigateToApproval({
      ...checkout,
      approvalUrl: "https://checkout.stripe.com/provider-resource",
    }, { navigate })).rejects.toThrow();
  });

  it("recovers creation-unknown and approval-pending with the same correlated request", async () => {
    for (const state of ["creation_unknown", "approval_pending"] as const) {
      const store = new MemoryStore({ state: "pending", request });
      const calls: Array<{ operationId: string; payload: unknown }> = [];
      const controller = new AccountBillingRecoveryController(new BillingClient({
        async send(operationId, payload) {
          calls.push({ operationId, payload });
          return operationId === BILLING_STATUS_READ_OPERATION_ID ? { ...pendingStatus, state } : checkout;
        },
      }), store);

      await expect(controller.recover()).resolves.toEqual({ state: "checkout_recovered", checkout });
      expect(calls).toEqual([
        { operationId: BILLING_STATUS_READ_OPERATION_ID, payload: {} },
        { operationId: BILLING_CHECKOUT_CREATE_OPERATION_ID, payload: request },
      ]);
    }
  });

  it("does not replay a pending checkout after its authenticated session changes", async () => {
    let current = true;
    let releaseStatus!: () => void;
    const statusReady = new Promise<void>((resolve) => { releaseStatus = resolve; });
    const createCheckout = vi.fn(async () => checkout);
    const controller = new AccountBillingRecoveryController(new BillingClient({
      async send(operationId) {
        if (operationId === BILLING_STATUS_READ_OPERATION_ID) {
          await statusReady;
          return { schemaVersion: 1, state: "none", provider: null, offer: null,
            paidThrough: null, refundEligibleUntil: null };
        }
        return createCheckout();
      },
    }), new MemoryStore({ state: "pending", request }), () => {
      if (!current) throw new TypeError("billing session changed");
    });
    const recovering = controller.recover();
    current = false;
    releaseStatus();
    await expect(recovering).rejects.toThrow(/session changed/u);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("rejects authoritative checkout identity substitution", async () => {
    const substituted = new AccountBillingRecoveryController(new BillingClient({
      async send(operationId) {
        return operationId === BILLING_STATUS_READ_OPERATION_ID
          ? { ...pendingStatus, requestId: "billing-request-other" }
          : checkout;
      },
    }), new MemoryStore({ state: "pending", request }));
    await expect(substituted.recover()).rejects.toThrow(/does not match browser request custody/u);
  });

  it("seals a deterministic rejection and requires a new request identity", async () => {
    const store = new MemoryStore({ state: "pending", request });
    const create = vi.fn(async (payload: unknown) => ({
      ...checkout,
      requestId: (payload as { readonly requestId: string }).requestId,
    }));
    const controller = new AccountBillingRecoveryController(
      new BillingClient({ send: async (_operationId, payload) => create(payload) }),
      store,
    );

    await expect(controller.markDeterministicallyRejected(request.requestId, {
      schemaVersion: 1,
      code: "COMMERCIAL_CHECKOUT_OUTCOME_UNKNOWN",
      retryable: true,
      retryAfterSeconds: null,
      correlationId: "billing-correlation",
    })).rejects.toThrow(/not deterministic/u);
    expect(store.value).toEqual({ state: "pending", request });

    await controller.markDeterministicallyRejected(request.requestId, {
      schemaVersion: 1,
      code: "COMMERCIAL_CHECKOUT_REJECTED",
      retryable: false,
      retryAfterSeconds: null,
      correlationId: "billing-correlation",
    });
    expect(store.value).toEqual({ state: "deterministically_rejected", requestId: request.requestId });
    await expect(controller.startCheckout(request)).rejects.toThrow(/new request id/u);
    expect(create).not.toHaveBeenCalled();

    const replacement = { ...request, requestId: "billing-request-2" };
    await expect(controller.startCheckout(replacement)).resolves.toMatchObject({ checkoutId: "checkout-1" });
    expect(store.value).toEqual({ state: "pending", request: replacement });
  });

  it("does not seal a deterministic rejection after its session fence expires", async () => {
    const store = new MemoryStore({ state: "pending", request });
    const controller = new AccountBillingRecoveryController(
      new BillingClient({ async send() { throw new Error("must not send"); } }),
      store,
      () => { throw new TypeError("billing session changed"); },
    );
    await expect(controller.markDeterministicallyRejected(request.requestId, {
      schemaVersion: 1,
      code: "COMMERCIAL_CHECKOUT_REJECTED",
      retryable: false,
      retryAfterSeconds: null,
      correlationId: "billing-correlation",
    })).rejects.toThrow(/session changed/u);
    expect(store.value).toEqual({ state: "pending", request });
  });

  it("retries unresolved none status with the same id and requires a new id only after definitive rejection", async () => {
    const unresolvedStore = new MemoryStore({ state: "pending", request });
    const calls: string[] = [];
    const none = new AccountBillingRecoveryController(new BillingClient({
      async send(operationId) {
        calls.push(operationId);
        return operationId === BILLING_STATUS_READ_OPERATION_ID ? {
          schemaVersion: 1, state: "none", provider: null, offer: null,
          paidThrough: null, refundEligibleUntil: null,
        } : checkout;
      },
    }), unresolvedStore);
    await expect(none.recover()).resolves.toEqual({ state: "checkout_recovered", checkout });
    expect(calls).toEqual([BILLING_STATUS_READ_OPERATION_ID, BILLING_CHECKOUT_CREATE_OPERATION_ID]);
    expect(unresolvedStore.value).toEqual({ state: "pending", request });

    const rejectedStore = new MemoryStore({
      state: "deterministically_rejected",
      requestId: request.requestId,
    });
    const rejected = new AccountBillingRecoveryController(new BillingClient({
      async send() {
        return {
          schemaVersion: 1, state: "none", provider: null, offer: null,
          paidThrough: null, refundEligibleUntil: null,
        };
      },
    }), rejectedStore);
    await expect(rejected.recover()).resolves.toEqual({
      state: "new_request_required",
      status: {
        schemaVersion: 1, state: "none", provider: null, offer: null,
        paidThrough: null, refundEligibleUntil: null,
      },
    });
  });

  it("clears obsolete request custody after billing becomes settled", async () => {
    const settledStore = new MemoryStore({ state: "pending", request });
    const activeStatus = {
      schemaVersion: 1 as const,
      state: "active" as const,
      provider: "stripe" as const,
      offer: "annual" as const,
      purchaseId: "purchase-1",
      paidThrough: "2027-09-01T00:00:00Z",
      refundEligibleUntil: null,
    };
    const active = new AccountBillingRecoveryController(new BillingClient({
      async send() { return activeStatus; },
    }), settledStore);
    await expect(active.recover()).resolves.toEqual({ state: "settled", status: activeStatus });
    expect(settledStore.value).toBeNull();

    for (const state of ["cancellation_pending", "cancellation_unknown", "cancel_at_period_end"] as const) {
      const cancellationStore = new MemoryStore({ state: "pending", request });
      const cancellationStatus = {
        ...activeStatus,
        state,
        requestId: "cancel-request-1",
      };
      const cancellation = new AccountBillingRecoveryController(new BillingClient({
        async send() { return cancellationStatus; },
      }), cancellationStore);
      await expect(cancellation.recover()).resolves.toEqual({
        state: "settled",
        status: cancellationStatus,
      });
      expect(cancellationStore.value).toBeNull();
    }
  });
});

describe("Account Web billing cancellation recovery controller", () => {
  const cancelRequest = { schemaVersion: 1 as const, requestId: "cancel-request-1" };
  const pendingCancellation = {
    schemaVersion: 1 as const,
    state: "cancellation_pending" as const,
    requestId: cancelRequest.requestId,
    paidThrough: "2027-09-01T00:00:00Z",
  };

  it("persists the cancellation request identity before transport and retains it while pending", async () => {
    const store = new CancellationMemoryStore();
    const send = vi.fn(async (operationId: string, payload: unknown) => {
      expect(operationId).toBe(BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID);
      expect(payload).toEqual(cancelRequest);
      expect(store.value).toEqual(cancelRequest);
      return pendingCancellation;
    });
    const controller = new AccountBillingCancellationController(
      new BillingClient({ send } as CloudTransport),
      store,
    );
    await expect(controller.requestCancellation(cancelRequest)).resolves.toEqual(pendingCancellation);
    expect(store.value).toEqual(cancelRequest);
  });

  it("recovers an authoritative unknown cancellation with the exact request identity", async () => {
    const store = new CancellationMemoryStore();
    const calls: Array<{ operationId: string; payload: unknown }> = [];
    const unknownStatus = {
      ...pendingCancellation,
      state: "cancellation_unknown" as const,
      provider: "stripe" as const,
      offer: "annual" as const,
      purchaseId: "purchase-1",
      refundEligibleUntil: null,
    };
    const controller = new AccountBillingCancellationController(new BillingClient({
      async send(operationId, payload) {
        calls.push({ operationId, payload });
        return operationId === BILLING_STATUS_READ_OPERATION_ID ? unknownStatus : pendingCancellation;
      },
    }), store);
    await expect(controller.recover()).resolves.toEqual({
      state: "cancellation_recovered",
      response: pendingCancellation,
    });
    expect(store.value).toEqual(cancelRequest);
    expect(calls).toEqual([
      { operationId: BILLING_STATUS_READ_OPERATION_ID, payload: {} },
      { operationId: BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID, payload: cancelRequest },
    ]);
  });

  it("rejects cancellation request substitution and clears custody after confirmation", async () => {
    const substituted = new AccountBillingCancellationController(new BillingClient({
      async send() {
        return {
          schemaVersion: 1,
          state: "cancellation_unknown",
          requestId: "cancel-request-other",
          provider: "stripe",
          offer: "annual",
          purchaseId: "purchase-1",
          paidThrough: "2027-09-01T00:00:00Z",
          refundEligibleUntil: null,
        };
      },
    }), new CancellationMemoryStore(cancelRequest));
    await expect(substituted.recover()).rejects.toThrow(/does not match browser request custody/u);

    const store = new CancellationMemoryStore(cancelRequest);
    const confirmed = { ...pendingCancellation, state: "cancel_at_period_end" as const };
    const controller = new AccountBillingCancellationController(new BillingClient({
      async send() { return confirmed; },
    }), store);
    await expect(controller.requestCancellation(cancelRequest)).resolves.toEqual(confirmed);
    expect(store.value).toBeNull();
  });
});

describe("Account Web first-purchase refund recovery controller", () => {
  const refundRequest = {
    schemaVersion: 1 as const,
    requestId: "refund-idempotency-1",
    purchaseId: "purchase-1",
  };
  const pending = {
    schemaVersion: 1 as const,
    state: "refund_pending" as const,
    refundRequestId: "refund-request-1",
    purchaseId: refundRequest.purchaseId,
    commercialAccess: "read_only" as const,
    requestedAmount: { minor: 980, currency: "USD" as const },
    retryable: false,
    retryAfter: null,
  };

  it("persists the exact request before transport and recovers through the server refund identity", async () => {
    const store = new RefundMemoryStore();
    const calls: Array<{ operationId: string; payload: unknown }> = [];
    const controller = new AccountBillingRefundController(new BillingClient({
      async send(operationId, payload) {
        calls.push({ operationId, payload });
        if (operationId === BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID) {
          expect(store.value).toEqual({ state: "pending", request: refundRequest, refundRequestId: null });
          return pending;
        }
        return { ...pending, state: "refund_unknown" };
      },
    }), store);
    await expect(controller.requestRefund(refundRequest)).resolves.toEqual(pending);
    expect(store.value).toEqual({
      state: "pending", request: refundRequest, refundRequestId: pending.refundRequestId,
    });
    await expect(controller.recover()).resolves.toEqual({
      state: "refund_recovered", response: { ...pending, state: "refund_unknown" },
    });
    expect(calls).toEqual([
      { operationId: BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID, payload: refundRequest },
      {
        operationId: BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
        payload: { schemaVersion: 1, refundRequestId: pending.refundRequestId },
      },
    ]);
  });

  it("replays only the same request after timeout and never labels unknown/manual/retry as refunded", async () => {
    for (const state of ["termination_unknown", "refund_unknown", "retry_wait", "manual_resolution"] as const) {
      const store = new RefundMemoryStore({ state: "pending", request: refundRequest, refundRequestId: null });
      const response = {
        ...pending,
        state,
        retryable: state === "retry_wait",
        retryAfter: state === "retry_wait" ? "2026-09-04T00:00:00Z" : null,
      };
      const send = vi.fn(async (_operationId: string, payload: unknown) => {
        expect(payload).toEqual(refundRequest);
        return response;
      });
      const controller = new AccountBillingRefundController(new BillingClient({ send } as CloudTransport), store);
      await expect(controller.recover()).resolves.toEqual({ state: "refund_recovered", response });
      expect(response.commercialAccess).toBe("read_only");
      expect(response.state).not.toBe("refunded");
      expect(store.value).toMatchObject({ state: "pending", refundRequestId: pending.refundRequestId });
    }
  });

  it("allows a new identity only after deterministic rejection and rejects status substitution", async () => {
    const store = new RefundMemoryStore();
    const rejectedController = new AccountBillingRefundController(new BillingClient({
      async send() { return { schemaVersion: 1, state: "rejected", reason: "window_elapsed" }; },
    }), store);
    await expect(rejectedController.requestRefund(refundRequest)).resolves.toMatchObject({ state: "rejected" });
    await expect(rejectedController.requestRefund(refundRequest)).rejects.toThrow(/new request id/u);
    const replacement = { ...refundRequest, requestId: "refund-idempotency-2" };
    await expect(rejectedController.requestRefund(replacement)).resolves.toMatchObject({ state: "rejected" });

    const substituted = new AccountBillingRefundController(new BillingClient({
      async send() { return { ...pending, purchaseId: "purchase-other" }; },
    }), new RefundMemoryStore({ state: "pending", request: refundRequest, refundRequestId: pending.refundRequestId }));
    await expect(substituted.recover()).rejects.toThrow(/does not match/u);

    const replaySubstitution = new AccountBillingRefundController(new BillingClient({
      async send() { return { ...pending, refundRequestId: "refund-request-other" }; },
    }), new RefundMemoryStore({ state: "pending", request: refundRequest, refundRequestId: pending.refundRequestId }));
    await expect(replaySubstitution.requestRefund(refundRequest)).rejects.toThrow(/stable refund request identity/u);
  });

  it("retries retry_wait with the original request identity", async () => {
    const store = new RefundMemoryStore({
      state: "pending", request: refundRequest, refundRequestId: pending.refundRequestId,
    });
    const send = vi.fn(async (operationId: string, payload: unknown) => {
      if (operationId === BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID) {
        expect(payload).toEqual({ schemaVersion: 1, refundRequestId: pending.refundRequestId });
        return { ...pending, state: "retry_wait", retryable: true,
          retryAfter: "2026-09-04T00:00:00Z" };
      }
      expect(payload).toEqual(refundRequest);
      return { ...pending, state: "refund_pending", retryable: false };
    });
    const controller = new AccountBillingRefundController(new BillingClient({ send }), store,
      () => new Date("2026-09-04T00:00:00Z"));
    await expect(controller.retryRefund()).resolves.toMatchObject({
      state: "refund_pending", refundRequestId: pending.refundRequestId,
    });
    expect(send).toHaveBeenCalledWith(BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID, refundRequest);
  });

  it("does not replay a retry before the server retryAfter deadline", async () => {
    const store = new RefundMemoryStore({
      state: "pending", request: refundRequest, refundRequestId: pending.refundRequestId,
    });
    const send = vi.fn(async (operationId: string) => {
      if (operationId === BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID) {
        return { ...pending, state: "retry_wait", retryable: true,
          retryAfter: "2026-09-04T00:00:01Z" };
      }
      throw new Error("mutation must not be replayed early");
    });
    const controller = new AccountBillingRefundController(new BillingClient({ send }), store,
      () => new Date("2026-09-04T00:00:00Z"));
    await expect(controller.retryRefund()).rejects.toThrow(/not due/u);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns newer terminal truth without replaying a stale retry action", async () => {
    const store = new RefundMemoryStore({
      state: "pending", request: refundRequest, refundRequestId: pending.refundRequestId,
    });
    const refunded = { ...pending, state: "refunded" as const, completedAt: "2026-09-04T00:00:00Z" };
    const send = vi.fn(async () => refunded);
    const controller = new AccountBillingRefundController(new BillingClient({ send }), store);
    await expect(controller.retryRefund()).resolves.toEqual(refunded);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.value).toBeNull();
  });

  it("clears custody only after confirmed refunded completion", async () => {
    const store = new RefundMemoryStore({
      state: "pending", request: refundRequest, refundRequestId: pending.refundRequestId,
    });
    const refunded = {
      ...pending,
      state: "refunded" as const,
      completedAt: "2026-09-03T12:00:00Z",
    };
    const controller = new AccountBillingRefundController(new BillingClient({
      async send() { return refunded; },
    }), store);
    await expect(controller.recover()).resolves.toEqual({ state: "refund_recovered", response: refunded });
    expect(store.value).toBeNull();
  });

  it("refuses misleading retry presentation without advancing browser custody", async () => {
    for (const malformed of [
      { ...pending, state: "termination_pending", retryable: true },
      { ...pending, state: "termination_unknown", retryable: true },
      { ...pending, state: "refund_pending", retryable: true },
      { ...pending, state: "refund_unknown", retryable: true },
      { ...pending, state: "manual_resolution", retryable: true },
      { ...pending, state: "refund_unknown", retryAfter: "2026-09-04T00:00:00Z" },
      { ...pending, state: "retry_wait", retryable: false, retryAfter: "2026-09-04T00:00:00Z" },
      { ...pending, state: "retry_wait", retryable: true, retryAfter: null },
      {
        ...pending,
        state: "refunded",
        retryable: true,
        completedAt: "2026-09-03T12:00:00Z",
      },
    ]) {
      const custody = {
        state: "pending" as const,
        request: refundRequest,
        refundRequestId: pending.refundRequestId,
      };
      const store = new RefundMemoryStore(custody);
      const controller = new AccountBillingRefundController(new BillingClient({
        async send() { return malformed; },
      }), store);
      await expect(controller.recover()).rejects.toThrow();
      expect(store.value).toEqual(custody);
    }
  });
});

class MemoryStore implements BillingCheckoutRecoveryStore {
  constructor(public value: BillingCheckoutRecoveryRecord | null = null) {}

  async load(): Promise<unknown> { return this.value; }
  async save(value: BillingCheckoutRecoveryRecord): Promise<void> { this.value = value; }
  async clear(): Promise<void> { this.value = null; }
}

class CancellationMemoryStore implements BillingCancellationRecoveryStore {
  constructor(public value: { readonly schemaVersion: 1; readonly requestId: string } | null = null) {}

  async load(): Promise<unknown> { return this.value; }
  async save(value: { readonly schemaVersion: 1; readonly requestId: string }): Promise<void> { this.value = value; }
  async clear(): Promise<void> { this.value = null; }
}

class RefundMemoryStore implements BillingRefundRecoveryStore {
  constructor(public value: BillingRefundRecoveryRecord | null = null) {}

  async load(): Promise<unknown> { return this.value; }
  async save(value: BillingRefundRecoveryRecord): Promise<void> { this.value = value; }
  async clear(): Promise<void> { this.value = null; }
}
