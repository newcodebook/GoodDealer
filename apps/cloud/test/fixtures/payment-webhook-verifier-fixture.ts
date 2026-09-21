import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { createPaymentWebhookHttp } from "../../src/entrypoints/payment-webhook-http";
import {
  PaymentWebhookApplicationService,
  PayPalPaymentWebhookAdapter,
  StripePaymentWebhookAdapter,
  createStripeSdk,
} from "../../src/modules/licensing/index";

type Provider = "stripe" | "paypal";
type Receipt = {
  readonly provider: Provider;
  readonly providerEventId: string;
  readonly payloadDigest: Uint8Array;
  readonly kind: "actionable" | "ignored";
};

export interface SignedWebhookRequestControl {
  readonly label: "valid" | "missing-signature" | "invalid-signature" | "tampered-body"
    | "stale-timestamp" | "exact-replay" | "event-id-conflict";
  readonly payloadBase64: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface SignedWebhookRequestCorpus {
  readonly version: 1;
  readonly signatureHeader: string;
  readonly controls: readonly SignedWebhookRequestControl[];
}

export interface PaymentWebhookVerifierFixture {
  readonly app: FastifyInstance;
  readonly corpora: Readonly<Record<Provider, SignedWebhookRequestCorpus>>;
  readonly receiptCount: (provider: Provider) => number;
  readonly conflictCount: (provider: Provider) => number;
}

class FixtureReceiptRepository {
  readonly #receipts = new Map<string, Buffer>();
  readonly #conflicts = new Map<Provider, number>();

  async receiveAuthenticatedReceipt(_query: unknown, receipt: Receipt): Promise<"scheduled" | "ignored" | "duplicate" | "conflict"> {
    const key = `${receipt.provider}:${receipt.providerEventId}`;
    const digest = Buffer.from(receipt.payloadDigest);
    const existing = this.#receipts.get(key);
    if (existing === undefined) {
      this.#receipts.set(key, digest);
      return receipt.kind === "ignored" ? "ignored" : "scheduled";
    }
    if (existing.equals(digest)) return "duplicate";
    this.#conflicts.set(receipt.provider, (this.#conflicts.get(receipt.provider) ?? 0) + 1);
    return "conflict";
  }

  receiptCount(provider: Provider): number {
    return [...this.#receipts.keys()].filter((key) => key.startsWith(`${provider}:`)).length;
  }

  conflictCount(provider: Provider): number {
    return this.#conflicts.get(provider) ?? 0;
  }
}

export function createPaymentWebhookVerifierFixture(now = new Date()): PaymentWebhookVerifierFixture {
  const evaluatedAt = canonicalSecond(now);
  const timestampSeconds = Math.floor(evaluatedAt.getTime() / 1_000);
  const stripeSdk = createStripeSdk("sk_test_non_secret_fixture_api_key");
  const stripeWebhookSecret = "whsec_non_secret_fixture_webhook";
  const stripe = new StripePaymentWebhookAdapter({ sdk: stripeSdk, webhookSecret: stripeWebhookSecret });

  const paypalWebhookId = "non-secret-fixture-webhook-id";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const paypalPublicKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  const paypal = new PayPalPaymentWebhookAdapter({
    webhookId: paypalWebhookId,
    certificates: { resolve: async () => paypalPublicKey },
  });
  const repository = new FixtureReceiptRepository();
  const application = new PaymentWebhookApplicationService(
    { query: async () => { throw new TypeError("fixture query is unavailable"); } } as never,
    repository as never,
    stripe,
    paypal,
  );
  const app = createPaymentWebhookHttp({
    application,
    rateLimit: { windowMs: 60_000, burst: 100, identityHeaderNames: [] },
    now: () => new Date(evaluatedAt),
  });

  return {
    app,
    corpora: {
      stripe: stripeCorpus(stripeSdk.webhooks, stripeWebhookSecret, timestampSeconds),
      paypal: paypalCorpus(privateKey, paypalWebhookId, evaluatedAt),
    },
    receiptCount: (provider) => repository.receiptCount(provider),
    conflictCount: (provider) => repository.conflictCount(provider),
  };
}

function stripeCorpus(
  webhooks: ReturnType<typeof createStripeSdk>["webhooks"],
  secret: string,
  timestampSeconds: number,
): SignedWebhookRequestCorpus {
  const valid = JSON.stringify(stripeEvent("evt_fixture_shared", "sub_fixture_valid", timestampSeconds));
  const stale = JSON.stringify(stripeEvent("evt_fixture_stale", "sub_fixture_stale", timestampSeconds - 600));
  const conflict = JSON.stringify(stripeEvent("evt_fixture_shared", "sub_fixture_conflict", timestampSeconds));
  const signature = (payload: string, timestamp: number, signingSecret = secret) =>
    webhooks.generateTestHeaderString({ payload, secret: signingSecret, timestamp });
  const validHeaders = jsonHeaders({ "stripe-signature": signature(valid, timestampSeconds) });
  return corpus("stripe-signature", [
    control("valid", valid, validHeaders),
    control("missing-signature", valid, jsonHeaders()),
    control("invalid-signature", valid, jsonHeaders({
      "stripe-signature": signature(valid, timestampSeconds, "whsec_non_secret_wrong_fixture"),
    })),
    control("tampered-body", `${valid}\n`, validHeaders),
    control("stale-timestamp", stale, jsonHeaders({
      "stripe-signature": signature(stale, timestampSeconds - 600),
    })),
    control("exact-replay", valid, validHeaders),
    control("event-id-conflict", conflict, jsonHeaders({
      "stripe-signature": signature(conflict, timestampSeconds),
    })),
  ]);
}

function stripeEvent(id: string, resourceId: string, created: number) {
  return {
    id,
    object: "event",
    type: "customer.subscription.updated",
    created,
    data: { object: { id: resourceId } },
  };
}

function paypalCorpus(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  webhookId: string,
  evaluatedAt: Date,
): SignedWebhookRequestCorpus {
  const validTime = evaluatedAt.toISOString();
  const staleTime = new Date(evaluatedAt.getTime() - 10 * 60_000).toISOString();
  const valid = JSON.stringify(paypalEvent("WH-FIXTURE-SHARED", "I-FIXTURE-VALID", validTime));
  const stale = JSON.stringify(paypalEvent("WH-FIXTURE-STALE", "I-FIXTURE-STALE", staleTime));
  const conflict = JSON.stringify(paypalEvent("WH-FIXTURE-SHARED", "I-FIXTURE-CONFLICT", validTime));
  const signedHeaders = (payload: string, transmissionTime: string) => {
    const transmissionId = "non-secret-fixture-transmission";
    const message = `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(Buffer.from(payload))}`;
    return jsonHeaders({
      "paypal-transmission-id": transmissionId,
      "paypal-transmission-time": transmissionTime,
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/non-secret-fixture",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64"),
    });
  };
  const validHeaders = signedHeaders(valid, validTime);
  const missingHeaders = { ...validHeaders };
  delete missingHeaders["paypal-transmission-sig"];
  const invalidHeaders = { ...validHeaders, "paypal-transmission-sig": Buffer.alloc(256, 0x41).toString("base64") };
  return corpus("paypal-transmission-sig", [
    control("valid", valid, validHeaders),
    control("missing-signature", valid, missingHeaders),
    control("invalid-signature", valid, invalidHeaders),
    control("tampered-body", `${valid}\n`, validHeaders),
    control("stale-timestamp", stale, signedHeaders(stale, staleTime)),
    control("exact-replay", valid, validHeaders),
    control("event-id-conflict", conflict, signedHeaders(conflict, validTime)),
  ]);
}

function paypalEvent(id: string, resourceId: string, createTime: string) {
  return {
    id,
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    create_time: createTime,
    resource: { id: resourceId },
  };
}

function corpus(signatureHeader: string, controls: readonly SignedWebhookRequestControl[]): SignedWebhookRequestCorpus {
  return { version: 1, signatureHeader, controls };
}

function control(
  label: SignedWebhookRequestControl["label"],
  payload: string,
  headers: Readonly<Record<string, string>>,
): SignedWebhookRequestControl {
  return { label, payloadBase64: Buffer.from(payload).toString("base64"), headers };
}

function jsonHeaders(additional: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { "content-type": "application/json", ...additional };
}

function canonicalSecond(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError("fixture time is invalid");
  return new Date(Math.floor(value.getTime() / 1_000) * 1_000);
}

function crc32(value: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function runFixtureServer(): Promise<void> {
  const fixture = createPaymentWebhookVerifierFixture();
  const address = await fixture.app.listen({ host: "127.0.0.1", port: 0 });
  const directory = await mkdtemp(join(tmpdir(), "gooddealer-webhook-verifier-"));
  const stripeCorpusPath = join(directory, "stripe.json");
  const paypalCorpusPath = join(directory, "paypal.json");
  await Promise.all([
    writeFile(stripeCorpusPath, JSON.stringify(fixture.corpora.stripe), { mode: 0o600 }),
    writeFile(paypalCorpusPath, JSON.stringify(fixture.corpora.paypal), { mode: 0o600 }),
  ]);
  process.stdout.write(`${JSON.stringify({
    stripe: { url: `${address}/v1/payment-webhooks/stripe`, requestCorpus: stripeCorpusPath },
    paypal: { url: `${address}/v1/payment-webhooks/paypal`, requestCorpus: paypalCorpusPath },
  })}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await fixture.app.close();
  await rm(directory, { recursive: true, force: true });
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  runFixtureServer().catch((error: unknown) => {
    process.stderr.write(`payment webhook verifier fixture failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
