import { describe, expect, it, vi } from "vitest";

import { createPaymentWebhookHttp } from "../../src/entrypoints/payment-webhook-http";
import {
  PaymentWebhookAuthenticationError,
  PaymentWebhookConflictError,
  type PaymentWebhookApplicationPort,
} from "../../src/modules/licensing/index";

const rateLimit = { windowMs: 60_000, burst: 10, identityHeaderNames: [] } as const;

describe("payment webhook HTTP boundary", () => {
  it("preserves the exact raw JSON body and selects only the provider route", async () => {
    const process = vi.fn(async () => undefined);
    const app = createPaymentWebhookHttp({
      application: { process } as PaymentWebhookApplicationPort,
      rateLimit,
      now: () => new Date("2026-08-30T00:00:00Z"),
    });
    const payload = '{ "id" : "evt_raw" }';
    const response = await app.inject({
      method: "POST",
      url: "/v1/payment-webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "fixture" },
      payload,
    });
    expect(response.statusCode).toBe(204);
    expect(process).toHaveBeenCalledWith(
      "stripe",
      Buffer.from(payload),
      expect.objectContaining({ "stripe-signature": "fixture" }),
      new Date("2026-08-30T00:00:00Z"),
    );
    await app.close();
  });

  it("returns no secret-bearing error body for authentication failures", async () => {
    const app = createPaymentWebhookHttp({
      application: {
        process: vi.fn(async () => { throw new PaymentWebhookAuthenticationError(); }),
      },
      rateLimit,
      now: () => new Date(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/payment-webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).toBe("");
    await app.close();
  });

  it("does not acknowledge digest conflicts or durable inbox failures", async () => {
    const process = vi.fn()
      .mockRejectedValueOnce(new PaymentWebhookConflictError())
      .mockRejectedValueOnce(new Error("commit failed"));
    const app = createPaymentWebhookHttp({ application: { process }, rateLimit, now: () => new Date() });
    const request = {
      method: "POST" as const,
      url: "/v1/payment-webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: "{}",
    };
    expect((await app.inject(request)).statusCode).toBe(409);
    expect((await app.inject(request)).statusCode).toBe(500);
    await app.close();
  });

  it("rejects unsupported media types and unknown paths", async () => {
    const app = createPaymentWebhookHttp({
      application: { process: vi.fn(async () => undefined) },
      rateLimit,
      now: () => new Date(),
    });
    expect((await app.inject({ method: "POST", url: "/v1/payment-webhooks/stripe", payload: "x" })).statusCode)
      .toBe(415);
    expect((await app.inject({ method: "POST", url: "/v1/payment-webhooks/unknown", payload: "{}" })).statusCode)
      .toBe(404);
    await app.close();
  });
});
