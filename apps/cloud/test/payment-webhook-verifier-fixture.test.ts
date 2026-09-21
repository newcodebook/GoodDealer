import { describe, expect, it } from "vitest";

import {
  createPaymentWebhookVerifierFixture,
  type SignedWebhookRequestControl,
} from "./fixtures/payment-webhook-verifier-fixture";

const expectedStatuses: Readonly<Record<SignedWebhookRequestControl["label"], number>> = {
  valid: 204,
  "missing-signature": 401,
  "invalid-signature": 401,
  "tampered-body": 401,
  "stale-timestamp": 401,
  "exact-replay": 204,
  "event-id-conflict": 409,
};

describe("payment webhook verifier fixture", () => {
  it.each(["stripe", "paypal"] as const)(
    "exercises the production %s authenticator and exact durable replay contract",
    async (provider) => {
      const fixture = createPaymentWebhookVerifierFixture(new Date());
      try {
        for (const control of fixture.corpora[provider].controls) {
          const response = await fixture.app.inject({
            method: "POST",
            url: `/v1/payment-webhooks/${provider}`,
            headers: control.headers,
            payload: Buffer.from(control.payloadBase64, "base64"),
          });
          expect(response.statusCode, control.label).toBe(expectedStatuses[control.label]);
          expect(response.body, control.label).toBe("");
        }
        expect(fixture.receiptCount(provider)).toBe(1);
        expect(fixture.conflictCount(provider)).toBe(1);
      } finally {
        await fixture.app.close();
      }
    },
  );
});
