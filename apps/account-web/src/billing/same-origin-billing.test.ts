import { BILLING_STATUS_READ_OPERATION_ID, type CloudOperationId } from "@gooddealer/cloud-client";
import { describe, expect, it } from "vitest";

import {
  createSameOriginApprovalNavigator,
  createSameOriginBillingTransport,
  HttpFailure,
  isDeterministicCheckoutRejection,
} from "./same-origin-billing";

describe("createSameOriginBillingTransport", () => {
  it("reads status from the fixed same-origin route with the session cookie", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const transport = createSameOriginBillingTransport(async (path, init) => {
      calls.push({ path, init });
      return new Response(JSON.stringify({ ok: 1 }), { headers: { "content-type": "application/json" } });
    });
    await expect(transport.send(BILLING_STATUS_READ_OPERATION_ID, {})).resolves.toEqual({ ok: 1 });
    expect(calls).toEqual([{ path: "/v1/account/billing/status", init: { method: "GET", credentials: "same-origin", redirect: "error" } }]);
  });

  it("refuses operations Account Web does not route", async () => {
    const transport = createSameOriginBillingTransport(async () => new Response(null));
    await expect(transport.send("devices.list" as CloudOperationId, {})).rejects.toThrow(/unavailable/u);
  });

  it("surfaces non-2xx replies as HttpFailure without parsing non-JSON bodies", async () => {
    const transport = createSameOriginBillingTransport(async () => new Response("<html>", { status: 502 }));
    const failure = await transport.send(BILLING_STATUS_READ_OPERATION_ID, {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpFailure);
    expect(failure).toMatchObject({ status: 502, payload: null });
  });
});

describe("isDeterministicCheckoutRejection", () => {
  it("accepts only the exact non-retryable checkout rejection", () => {
    expect(isDeterministicCheckoutRejection({ code: "COMMERCIAL_CHECKOUT_REJECTED", retryable: false })).toBe(true);
    expect(isDeterministicCheckoutRejection({ code: "COMMERCIAL_CHECKOUT_REJECTED", retryable: true })).toBe(false);
    expect(isDeterministicCheckoutRejection({ code: "RATE_LIMITED", retryable: false })).toBe(false);
    expect(isDeterministicCheckoutRejection(null)).toBe(false);
  });
});

describe("createSameOriginApprovalNavigator", () => {
  const origin = "https://account.gooddealer.test";

  it("navigates to the same-origin approval endpoint", () => {
    const assigned: string[] = [];
    createSameOriginApprovalNavigator({ origin, assign: (url) => { assigned.push(url); } }).navigate("/billing/approval/abc");
    expect(assigned).toEqual([`${origin}/billing/approval/abc`]);
  });

  it.each(["https://checkout.stripe.com/pay/x", "//evil.example/billing/approval/x", "/billing/success"])("refuses %s", (path) => {
    const assigned: string[] = [];
    expect(() => createSameOriginApprovalNavigator({ origin, assign: (url) => { assigned.push(url); } }).navigate(path)).toThrow(TypeError);
    expect(assigned).toEqual([]);
  });
});
