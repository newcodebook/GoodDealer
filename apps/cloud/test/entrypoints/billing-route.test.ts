import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimitPolicy } from "../../src/entrypoints/adapter/rate-limit";
import { BILLING_APPROVAL_ROUTE, createPublicHttp } from "../../src/entrypoints/http";
import {
  BILLING_CHECKOUT_ROUTE,
  BILLING_FIXED_TERM_CONFIRM_ROUTE,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_ROUTE,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_ROUTE,
  BILLING_STATUS_ROUTE,
  BILLING_SUBSCRIPTION_CANCEL_ROUTE,
} from "../../src/entrypoints/routes/public/boundary";
import {
  CommercialCheckoutCreationRejectedError,
  CommercialCheckoutCreationUnknownError,
  CommercialPurchaseConflictError,
} from "../../src/modules/licensing/index";
import { StaticPublicSessionVerifier } from "../support/public-session";

describe("account billing HTTP routes", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

  function create() {
    const createCheckout = vi.fn(async () => ({
      schemaVersion: 1 as const,
      requestId: "billing-request-1",
      checkoutId: "checkout-1",
      provider: "stripe" as const,
      offer: "annual" as const,
      approval: { kind: "gooddealer_redirect" as const, handle: "A".repeat(43), expiresAt: "2026-09-01T00:05:00Z" },
    }));
    const readStatus = vi.fn(async () => ({
      schemaVersion: 1 as const,
      state: "active" as const,
      provider: "stripe" as const,
      offer: "annual" as const,
      purchaseId: "checkout-1",
      paidThrough: "2027-09-01T00:00:00Z",
      refundEligibleUntil: null,
    }));
    const cancelSubscription = vi.fn(async () => ({
      schemaVersion: 1 as const,
      requestId: "cancel-request-1",
      state: "cancel_at_period_end" as const,
      paidThrough: "2027-09-01T00:00:00Z",
    }));
    const confirmFixedTerm = vi.fn(async () => ({ schemaVersion: 1 as const, state: "processing" as const,
      requestId: "confirm-request-1", checkoutId: "checkout-1" }));
    const requestFirstPurchaseRefund = vi.fn(async (_request?: unknown, _principal?: unknown) => ({ schemaVersion: 1 as const,
      state: "refund_pending" as const, refundRequestId: "refund-1", purchaseId: "checkout-1",
      commercialAccess: "read_only" as const, requestedAmount: { minor: 980, currency: "USD" as const },
      retryable: false as const, retryAfter: null }));
    const readFirstPurchaseRefundStatus = vi.fn(async (_request?: unknown, _principal?: unknown) => ({ schemaVersion: 1 as const,
      state: "refund_unknown" as const, refundRequestId: "refund-1", purchaseId: "checkout-1",
      commercialAccess: "read_only" as const, requestedAmount: { minor: 980, currency: "USD" as const },
      retryable: false as const, retryAfter: null }));
    const claimApprovalRedirect = vi.fn(async () => "https://checkout.stripe.com/example");
    const app = createPublicHttp({
      sessions: new StaticPublicSessionVerifier([
        { sessionId: "billing-session", accountId: "account-a", clientKind: "account_web" },
      ]),
      preAuthRateLimit: rateLimitPolicy(60_000, 100),
      sessionRateLimit: rateLimitPolicy(60_000, 100),
      now: () => new Date("2026-09-01T00:00:00Z"),
      correlationIds: () => "billing-correlation",
      ports: {
        accountActivation: { activate: async () => null },
        desktopAuthorization: { issue: async () => null },
        commercialCheckout: { createCheckout, readStatus, cancelSubscription, confirmFixedTerm,
          requestFirstPurchaseRefund, readFirstPurchaseRefundStatus, claimApprovalRedirect },
      },
    });
    apps.push(app);
    return { app, createCheckout, readStatus, cancelSubscription, confirmFixedTerm,
      requestFirstPurchaseRefund, readFirstPurchaseRefundStatus, claimApprovalRedirect };
  }

  it("creates only an allowlisted account-scoped checkout request", async () => {
    const { app, createCheckout } = create();
    const payload = {
      schemaVersion: 1,
      requestId: "billing-request-1",
      provider: "stripe",
      offer: "annual",
      campaignCode: "LAUNCH",
    };
    const result = await app.inject({
      method: "POST",
      url: BILLING_CHECKOUT_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload,
    });
    expect(result.statusCode).toBe(200);
    expect(createCheckout).toHaveBeenCalledWith(payload, {
      accountId: "account-a",
      sessionId: "billing-session",
      clientKind: "account_web",
    });

    for (const injected of [{ accountId: "attacker" }, { priceId: "price_attacker" }, { amount: 1 }]) {
      const rejected = await app.inject({
        method: "POST",
        url: BILLING_CHECKOUT_ROUTE,
        headers: { cookie: "gd_session=billing-session" },
        payload: { ...payload, ...injected },
      });
      expect(rejected.statusCode).toBe(400);
    }
  });

  it("confirms only the account-bound fixed-term checkout after provider approval", async () => {
    const { app, confirmFixedTerm } = create();
    const result = await app.inject({
      method: "POST",
      url: BILLING_FIXED_TERM_CONFIRM_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: { schemaVersion: 1, requestId: "confirm-request-1", checkoutId: "checkout-1" },
    });
    expect(result.statusCode).toBe(200);
    expect(confirmFixedTerm).toHaveBeenCalledWith(
      { schemaVersion: 1, requestId: "confirm-request-1", checkoutId: "checkout-1" },
      expect.objectContaining({ accountId: "account-a" }),
    );
  });

  it("reads status and cancels without accepting a client-selected provider subscription", async () => {
    const { app, readStatus, cancelSubscription } = create();
    expect((await app.inject({
      method: "GET",
      url: BILLING_STATUS_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
    })).statusCode).toBe(200);
    expect(readStatus).toHaveBeenCalledTimes(1);

    const cancelled = await app.inject({
      method: "POST",
      url: BILLING_SUBSCRIPTION_CANCEL_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: { schemaVersion: 1, requestId: "cancel-request-1" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelSubscription).toHaveBeenCalledWith(
      { schemaVersion: 1, requestId: "cancel-request-1" },
      expect.objectContaining({ accountId: "account-a" }),
    );
  });

  it("requests and recovers a first-purchase refund using only GoodDealer identities", async () => {
    const { app, requestFirstPurchaseRefund, readFirstPurchaseRefundStatus } = create();
    const requested = await app.inject({ method: "POST", url: BILLING_FIRST_PURCHASE_REFUND_REQUEST_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: { schemaVersion: 1, requestId: "refund-request-1", purchaseId: "checkout-1" } });
    expect(requested.statusCode).toBe(200);
    expect(requested.json()).toEqual({ schemaVersion: 1, state: "refund_pending", refundRequestId: "refund-1",
      purchaseId: "checkout-1", commercialAccess: "read_only",
      requestedAmount: { minor: 980, currency: "USD" }, retryable: false, retryAfter: null });
    expect(requestFirstPurchaseRefund).toHaveBeenCalledWith(
      { schemaVersion: 1, requestId: "refund-request-1", purchaseId: "checkout-1" },
      expect.objectContaining({ accountId: "account-a" }),
    );

    const recovered = await app.inject({ method: "POST", url: BILLING_FIRST_PURCHASE_REFUND_STATUS_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: { schemaVersion: 1, refundRequestId: "refund-1" } });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ state: "refund_unknown", refundRequestId: "refund-1",
      commercialAccess: "read_only" });
    expect(readFirstPurchaseRefundStatus).toHaveBeenCalledWith(
      { schemaVersion: 1, refundRequestId: "refund-1" }, expect.objectContaining({ accountId: "account-a" }),
    );
    readFirstPurchaseRefundStatus.mockResolvedValueOnce(null as never);
    const hidden = await app.inject({ method: "POST", url: BILLING_FIRST_PURCHASE_REFUND_STATUS_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: { schemaVersion: 1, refundRequestId: "another-account-refund" } });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain("another-account-refund");
    for (const forbidden of [{ provider: "stripe" }, { chargeId: "ch_secret" }, { amount: 1 },
      { accountId: "attacker" }]) {
      const response = await app.inject({ method: "POST", url: BILLING_FIRST_PURCHASE_REFUND_REQUEST_ROUTE,
        headers: { cookie: "gd_session=billing-session" },
        payload: { schemaVersion: 1, requestId: "refund-request-1", purchaseId: "checkout-1", ...forbidden } });
      expect(response.statusCode).toBe(400);
    }
  });

  it("returns a typed conflict without leaking internal details", async () => {
    const { app, createCheckout } = create();
    createCheckout.mockRejectedValueOnce(new CommercialPurchaseConflictError("provider-secret-detail"));
    const result = await app.inject({
      method: "POST",
      url: BILLING_CHECKOUT_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: {
        schemaVersion: 1,
        requestId: "billing-request-2",
        provider: "paypal",
        offer: "monthly",
        campaignCode: null,
      },
    });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toEqual({
      schemaVersion: 1,
      code: "COMMERCIAL_PURCHASE_CONFLICT",
      retryable: false,
      retryAfterSeconds: null,
      correlationId: "billing-correlation",
    });
    expect(result.body).not.toContain("provider-secret-detail");
  });

  it("returns a deterministic refund rejection as the closed operation response", async () => {
    const { app, requestFirstPurchaseRefund } = create();
    requestFirstPurchaseRefund.mockResolvedValueOnce({ schemaVersion: 1, state: "rejected",
      reason: "window_elapsed" } as never);
    const result = await app.inject({ method: "POST", url: BILLING_FIRST_PURCHASE_REFUND_REQUEST_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: { schemaVersion: 1, requestId: "refund-late", purchaseId: "checkout-1" } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ schemaVersion: 1, state: "rejected", reason: "window_elapsed" });
  });

  it("returns one accepted and one closed rejection for competing refund claims", async () => {
    const { app, requestFirstPurchaseRefund } = create();
    requestFirstPurchaseRefund.mockImplementation(async (request?: unknown) => (request !== null && typeof request === "object"
      && "requestId" in request && request.requestId === "refund-winner"
      ? { schemaVersion: 1, state: "refund_pending", refundRequestId: "refund-1", purchaseId: "checkout-1",
          commercialAccess: "read_only", requestedAmount: { minor: 980, currency: "USD" },
          retryable: false, retryAfter: null }
      : { schemaVersion: 1, state: "rejected", reason: "already_claimed" }) as never);
    const results = await Promise.all(["refund-winner", "refund-loser"].map(async (requestId) => app.inject({
      method: "POST", url: BILLING_FIRST_PURCHASE_REFUND_REQUEST_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: { schemaVersion: 1, requestId, purchaseId: "checkout-1" },
    })));
    const winner = results[0]!;
    const loser = results[1]!;
    expect(winner.json()).toMatchObject({ state: "refund_pending", refundRequestId: "refund-1" });
    expect(loser.json()).toEqual({ schemaVersion: 1, state: "rejected", reason: "already_claimed" });
    expect(winner.statusCode).toBe(200);
    expect(loser.statusCode).toBe(200);
  });

  it("claims a same-origin one-time approval handle and returns only a hardened 303", async () => {
    const { app, claimApprovalRedirect } = create();
    const handle = "A".repeat(43);
    const result = await app.inject({ method: "GET", url: BILLING_APPROVAL_ROUTE.replace(":handle", handle),
      headers: { cookie: "gd_session=billing-session", "sec-fetch-site": "same-origin" } });
    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toBe("https://checkout.stripe.com/example");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(result.body).toBe("");
    expect(claimApprovalRedirect).toHaveBeenCalledWith(handle, expect.objectContaining({ accountId: "account-a" }));
  });

  it.each([
    [CommercialCheckoutCreationRejectedError, "COMMERCIAL_CHECKOUT_REJECTED", false],
    [CommercialCheckoutCreationUnknownError, "COMMERCIAL_CHECKOUT_OUTCOME_UNKNOWN", true],
  ] as const)("maps checkout outcome %s to a closed business rejection", async (ErrorType, code, retryable) => {
    const { app, createCheckout } = create();
    createCheckout.mockRejectedValueOnce(new ErrorType("provider-secret-detail"));
    const result = await app.inject({
      method: "POST",
      url: BILLING_CHECKOUT_ROUTE,
      headers: { cookie: "gd_session=billing-session" },
      payload: {
        schemaVersion: 1,
        requestId: "billing-request-1",
        provider: "stripe",
        offer: "annual",
        campaignCode: null,
      },
    });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toEqual({
      schemaVersion: 1,
      code,
      retryable,
      retryAfterSeconds: null,
      correlationId: "billing-correlation",
    });
    expect(result.body).not.toContain("provider-secret-detail");
  });
});
