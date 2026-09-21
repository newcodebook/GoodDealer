import { describe, expect, it, vi } from "vitest";
import { CommercialCheckoutApplicationService, CommercialCheckoutCatalog } from "../src/modules/licensing/commercial-checkout";
import { ProviderDispatchManualResolutionError } from "../src/modules/licensing/provider-dispatch-executor";

const credential = new Uint8Array(32).fill(7);
const principal = { accountId: "untrusted-selector", sessionId: "session-1", clientKind: "account_web" as const,
  transactionCredential: credential };

describe("commercial checkout account capability boundary", () => {
  it("reads billing with the exact credential purpose and never passes an account selector", async () => {
    const withAccountCredential = vi.fn(async (_credential, _purpose, operation) => operation({ query: vi.fn() }));
    const readBillingStatus = vi.fn(async () => null);
    const service = createService(withAccountCredential, { readBillingStatus });
    await expect(service.readStatus(principal)).resolves.toEqual(expect.objectContaining({ state: "none" }));
    expect(withAccountCredential).toHaveBeenCalledWith(credential, "billing_read", expect.any(Function));
    expect(readBillingStatus).toHaveBeenCalledWith(expect.not.objectContaining({ accountId: "untrusted-selector" }));
  });

  it("commits claim, fetches the provider URL outside transactions, then completes with the redirect purpose", async () => {
    const order: string[] = [];
    const withAccountCredential = vi.fn(async (_credential, purpose, operation) => {
      order.push(`begin:${purpose}`); const result = await operation({ query: vi.fn() }); order.push(`commit:${purpose}`); return result;
    });
    const repository = {
      claimApprovalRedirect: vi.fn(async () => ({ claimId: "claim-1", provider: "stripe" as const,
        providerResourceKind: "checkout_session", providerResourceId: "cs_1",
        expectedPurchaseAttemptId: "purchase-1", expectedPurchaseKind: "subscription" as const,
        expectedOffer: "monthly" as const, expectedProviderCatalogItem: "price-1",
        expectedAmountMinor: 980, expectedCurrency: "USD" as const })),
      completeApprovalRedirect: vi.fn(async () => { order.push("completed"); }),
    };
    const dispatch = { readApprovalUrl: vi.fn(async () => { order.push("provider-read"); return "https://checkout.stripe.com/c/pay"; }) };
    const service = createService(withAccountCredential, repository, dispatch);
    await expect(service.claimApprovalRedirect("A".repeat(43), principal)).resolves.toBe("https://checkout.stripe.com/c/pay");
    expect(order).toEqual(["begin:billing_approval_redirect", "commit:billing_approval_redirect", "provider-read",
      "begin:billing_approval_redirect", "completed", "commit:billing_approval_redirect"]);
    expect(dispatch.readApprovalUrl).toHaveBeenCalledWith("stripe", "checkout_session", "cs_1", {
      purchaseAttemptId: "purchase-1", purchaseKind: "subscription", offer: "monthly",
      providerItemId: "price-1", amountMinor: 980, currency: "USD",
    });
  });

  it("persists manual resolution when a PayPal Order conflicts at approval read", async () => {
    const withAccountCredential = vi.fn(async (_credential, _purpose, operation) => operation({ query: vi.fn() }));
    const repository = {
      claimApprovalRedirect: vi.fn(async () => ({ claimId: "claim-1", provider: "paypal" as const,
        providerResourceKind: "order", providerResourceId: "ORDER-1", expectedPurchaseAttemptId: "purchase-1",
        expectedPurchaseKind: "fixed_term" as const, expectedOffer: "ten_year" as const,
        expectedProviderCatalogItem: "fixed-plan", expectedAmountMinor: 49_800, expectedCurrency: "USD" as const })),
      completeApprovalRedirect: vi.fn(),
    };
    const dispatch = { readApprovalUrl: vi.fn(async () => { throw new ProviderDispatchManualResolutionError(); }) };
    const service = createService(withAccountCredential, repository, dispatch);
    await expect(service.claimApprovalRedirect("A".repeat(43), principal)).rejects.toThrow(/manual_resolution/u);
    expect(repository.completeApprovalRedirect).toHaveBeenCalledWith(expect.anything(), "claim-1", "manual_resolution");
  });

  it("accepts a refund under refund_request and reads exact recovery truth under billing_read with zero Provider I/O", async () => {
    const purposes: string[] = [];
    const withAccountCredential = vi.fn(async (_credential, purpose, operation) => {
      purposes.push(purpose); return operation({ query: vi.fn() });
    });
    const requestFirstPurchaseRefund = vi.fn(async () => ({ disposition: "accepted" as const, acceptance: {
      refundRequestId: "refund-1", state: "refund_pending" as const,
      acceptedAt: "2026-09-03T00:00:00Z", remainingMinorAtAcceptance: 980,
      expectedPurchaseAttemptId: "purchase-1", providerAgreementId: "agreement-1", replay: "created" as const,
      operation: null } }));
    const readFirstPurchaseRefundStatus = vi.fn(async () => ({ refundRequestId: "refund-1",
      expectedPurchaseAttemptId: "purchase-1", state: "refund_unknown" as const,
      acceptedAt: "2026-09-03T00:00:00Z", remainingMinorAtAcceptance: 980, retryAt: null, completedAt: null }));
    const dispatch = { resume: vi.fn(), refundFirstPurchase: vi.fn() };
    const service = createService(withAccountCredential, { requestFirstPurchaseRefund, readFirstPurchaseRefundStatus }, dispatch);

    await expect(service.requestFirstPurchaseRefund({ schemaVersion: 1, requestId: "refund-idempotency-1",
      purchaseId: "purchase-1" }, principal)).resolves.toEqual({ schemaVersion: 1, state: "refund_unknown",
      refundRequestId: "refund-1", purchaseId: "purchase-1", commercialAccess: "read_only",
      requestedAmount: { minor: 980, currency: "USD" }, retryable: false, retryAfter: null });
    expect(purposes).toEqual(["refund_request", "billing_read"]);
    expect(requestFirstPurchaseRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      requestId: "refund-idempotency-1", expectedPurchaseAttemptId: "purchase-1",
    }));
    expect(dispatch.resume).not.toHaveBeenCalled();
    expect(dispatch.refundFirstPurchase).not.toHaveBeenCalled();
  });

  it("keeps cross-account refund status undiscoverable", async () => {
    const withAccountCredential = vi.fn(async (_credential, _purpose, operation) => operation({ query: vi.fn() }));
    const repository = { readFirstPurchaseRefundStatus: vi.fn(async () => null) };
    const service = createService(withAccountCredential, repository);
    await expect(service.readFirstPurchaseRefundStatus({ schemaVersion: 1,
      refundRequestId: "another-account-refund" }, principal)).resolves.toBeNull();
  });

  it.each([
    "not_first_paid_purchase", "window_elapsed", "not_paid", "already_claimed",
    "already_fully_reversed", "purchase_mismatch",
  ] as const)("returns the database-owned deterministic refund rejection %s", async (reason) => {
    const withAccountCredential = vi.fn(async (_credential, _purpose, operation) => operation({ query: vi.fn() }));
    const service = createService(withAccountCredential, { requestFirstPurchaseRefund: vi.fn(async () => ({
      disposition: "rejected", reason,
    })) });
    await expect(service.requestFirstPurchaseRefund({ schemaVersion: 1, requestId: "refund-1",
      purchaseId: "purchase-1" }, principal)).resolves.toEqual({ schemaVersion: 1, state: "rejected", reason });
    expect(withAccountCredential).toHaveBeenCalledTimes(1);
    expect(withAccountCredential).toHaveBeenCalledWith(credential, "refund_request", expect.any(Function));
  });

  it("returns truthful retry and completion states only when their timestamps exist", async () => {
    const withAccountCredential = vi.fn(async (_credential, _purpose, operation) => operation({ query: vi.fn() }));
    const readFirstPurchaseRefundStatus = vi.fn()
      .mockResolvedValueOnce({ refundRequestId: "refund-1", expectedPurchaseAttemptId: "purchase-1",
        state: "retry_wait", acceptedAt: "2026-09-03T00:00:00Z", remainingMinorAtAcceptance: 980,
        retryAt: "2026-09-04T00:00:00Z", completedAt: null })
      .mockResolvedValueOnce({ refundRequestId: "refund-1", expectedPurchaseAttemptId: "purchase-1",
        state: "refunded", acceptedAt: "2026-09-03T00:00:00Z", remainingMinorAtAcceptance: 980,
        retryAt: null, completedAt: "2026-09-03T12:00:00Z" });
    const service = createService(withAccountCredential, { readFirstPurchaseRefundStatus });
    const request = { schemaVersion: 1 as const, refundRequestId: "refund-1" };
    await expect(service.readFirstPurchaseRefundStatus(request, principal)).resolves.toMatchObject({
      state: "retry_wait", retryable: true, retryAfter: "2026-09-04T00:00:00Z" });
    await expect(service.readFirstPurchaseRefundStatus(request, principal)).resolves.toMatchObject({
      state: "refunded", retryable: false, completedAt: "2026-09-03T12:00:00Z" });
  });
});

function createService(withAccountCredential: unknown, repository: Record<string, unknown>, dispatch: unknown = {}) {
  return new CommercialCheckoutApplicationService({ withAccountCredential } as never, { query: vi.fn() } as never,
    repository as never, new CommercialCheckoutCatalog([]), dispatch as never,
    () => new Date("2026-09-03T00:00:00Z"));
}
