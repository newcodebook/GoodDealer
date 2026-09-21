import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Pool } from "pg";

import {
  InMemoryFixedWindowRateLimiter,
  preAuthRateLimitIdentity,
  trustLoopbackProxy,
  type RateLimitPolicy,
} from "./adapter/rate-limit";
import {
  PaymentWebhookApplicationService,
  PaymentWebhookAuthenticationError,
  PaymentWebhookConflictError,
  PostgresCommercialAggregateRepository,
  type PaymentWebhookApplicationPort,
  type PaymentWebhookAuthenticator,
} from "../modules/licensing/index";
import type {
  PayPalCertificateResolver,
  PayPalSdkConfiguration,
} from "../modules/licensing/index";

export interface PaymentWebhookHttpDependencies {
  readonly application: PaymentWebhookApplicationPort;
  readonly rateLimit: RateLimitPolicy;
  readonly now: () => Date;
}

export interface PostgresPaymentWebhookHttpDependencies {
  /** Dedicated gd_provider_ingress connection; never use the account API or worker pool here. */
  readonly providerIngressPool: Pool;
  readonly stripe: PaymentWebhookAuthenticator;
  readonly paypal: PaymentWebhookAuthenticator;
  readonly rateLimit: RateLimitPolicy;
  readonly now: () => Date;
}

export const PAYMENT_WEBHOOK_BODY_LIMIT_BYTES = 262_144;
export const PAYMENT_WEBHOOK_MAX_URL_LENGTH = 2_048;

export function createPayPalCertificateResolver(
  environment: PayPalSdkConfiguration["environment"],
): PayPalCertificateResolver {
  if (environment === "production") {
    return new PayPalHttpsCertificateResolver(new Set([
      "https://api.paypal.com",
      "https://api-m.paypal.com",
    ]));
  }
  if (environment === "sandbox") {
    return new PayPalHttpsCertificateResolver(new Set([
      "https://api.sandbox.paypal.com",
      "https://api-m.sandbox.paypal.com",
    ]));
  }
  throw new TypeError("PayPal environment is invalid");
}

/** Bounded network mechanism for PayPal's provider-controlled signing certificates. */
class PayPalHttpsCertificateResolver implements PayPalCertificateResolver {
  readonly #cache = new Map<string, string>();

  constructor(private readonly allowedOrigins: ReadonlySet<string>) {}

  async resolve(certificateUrl: string): Promise<string> {
    const cached = this.#cache.get(certificateUrl);
    if (cached !== undefined) return cached;
    let url: URL;
    try {
      url = new URL(certificateUrl);
    } catch {
      throw new PaymentWebhookAuthenticationError();
    }
    if (
      url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.search !== "" || url.hash !== "" || !this.allowedOrigins.has(url.origin) ||
      !url.pathname.startsWith("/v1/notifications/certs/")
    ) throw new PaymentWebhookAuthenticationError();
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new PaymentWebhookAuthenticationError();
    const bytes = await readBoundedCertificate(response);
    const certificate = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!certificate.includes("-----BEGIN CERTIFICATE-----")) throw new PaymentWebhookAuthenticationError();
    if (this.#cache.size >= 16) this.#cache.delete(this.#cache.keys().next().value!);
    this.#cache.set(certificateUrl, certificate);
    return certificate;
  }
}

async function readBoundedCertificate(response: Response): Promise<Uint8Array> {
  const maximumBytes = 65_536;
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new PaymentWebhookAuthenticationError();
  }
  if (response.body === null) throw new PaymentWebhookAuthenticationError();
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new PaymentWebhookAuthenticationError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) throw new PaymentWebhookAuthenticationError();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createPostgresPaymentWebhookHttp(
  deps: PostgresPaymentWebhookHttpDependencies,
): FastifyInstance {
  return createPaymentWebhookHttp({
    application: new PaymentWebhookApplicationService(
      deps.providerIngressPool,
      new PostgresCommercialAggregateRepository(),
      deps.stripe,
      deps.paypal,
    ),
    rateLimit: deps.rateLimit,
    now: deps.now,
  });
}

/** Dedicated raw-body boundary authenticated by payment providers, never by a user session. */
export function createPaymentWebhookHttp(deps: PaymentWebhookHttpDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: PAYMENT_WEBHOOK_BODY_LIMIT_BYTES,
    trustProxy: trustLoopbackProxy,
  });
  const limiter = new InMemoryFixedWindowRateLimiter(deps.rateLimit);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook("onRequest", async (request, reply) => {
    if ((request.raw.url?.length ?? 0) > PAYMENT_WEBHOOK_MAX_URL_LENGTH) {
      return reply.code(413).send();
    }
    if (!limiter.consume(preAuthRateLimitIdentity(request.ip)).allowed) {
      return reply.code(429).send();
    }
  });

  app.post("/v1/payment-webhooks/stripe", async (request, reply) => {
    await deps.application.process("stripe", requireRawBody(request.body), request.headers, deps.now());
    return reply.code(204).send();
  });
  app.post("/v1/payment-webhooks/paypal", async (request, reply) => {
    await deps.application.process("paypal", requireRawBody(request.body), request.headers, deps.now());
    return reply.code(204).send();
  });

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send());
  app.setErrorHandler(async (error: FastifyError, _request, reply) => {
    if (error instanceof PaymentWebhookAuthenticationError) return reply.code(401).send();
    if (error instanceof PaymentWebhookConflictError) return reply.code(409).send();
    if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return reply.code(415).send();
    if (error.statusCode === 413) return reply.code(413).send();
    return reply.code(500).send();
  });
  return app;
}

function requireRawBody(value: unknown): Buffer {
  if (!Buffer.isBuffer(value)) throw new TypeError("payment webhook raw body is unavailable");
  return value;
}
