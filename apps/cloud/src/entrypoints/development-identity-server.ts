import { createServer } from "node:http";

import { createCloudDatabasePool } from "../db/index";
import {
  Argon2idPasswordHashVerifier,
  IdentityAccountAccessService,
  IdentityAccountSessionVerifier,
  IdentityEmailOutboxWorker,
  LoopbackSmtpEmailDelivery,
  PostgresIdentityAccountAccessRepository,
  PostgresIdentitySessionVerificationReader,
} from "../modules/identity/index";
import { createIdentityHttp } from "./identity-http";
import { IdentityBoundaryTelemetry } from "./identity-telemetry";
import { rateLimitPolicy } from "./adapter/rate-limit";
import { CloudPublicSessionVerifier } from "./ports/public-session";

const pool = createCloudDatabasePool({ connectionString: required("GOODDEALER_POSTGRES_APP_URL"), max: 8 });
const repository = new PostgresIdentityAccountAccessRepository(pool);
const outboxKey = key("GOODDEALER_IDENTITY_OUTBOX_KEY");
const accountNamespaceKey = key("GOODDEALER_IDENTITY_BROWSER_NAMESPACE_KEY");
const keyId = optional("GOODDEALER_IDENTITY_OUTBOX_KEY_ID") ?? "development-v1";
const identity = new PostgresIdentitySessionVerificationReader(pool);
const accounts = new IdentityAccountAccessService(repository, new Argon2idPasswordHashVerifier(), {
  verificationPepper: key("GOODDEALER_IDENTITY_VERIFICATION_PEPPER"), outboxKey, outboxKeyId: keyId,
  accountOrigin: optional("GOODDEALER_ACCOUNT_ORIGIN") ?? "https://account.gooddealer.com",
});
const app = createIdentityHttp({
  accounts,
  sessions: new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier(identity)),
  allowedOrigins: [optional("GOODDEALER_ACCOUNT_ORIGIN") ?? "https://account.gooddealer.com"],
  now: () => new Date(),
  accountNamespaceKey,
  rateLimit: rateLimitPolicy(60_000, 30),
  observer: new IdentityBoundaryTelemetry((event) => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }),
});
const worker = new IdentityEmailOutboxWorker(repository, new LoopbackSmtpEmailDelivery({
  host: "127.0.0.1", port: port(optional("GOODDEALER_MAILPIT_SMTP_PORT") ?? "1025"),
  from: optional("GOODDEALER_IDENTITY_FROM_EMAIL") ?? "account@development.gooddealer.invalid",
}), outboxKey, keyId, () => new Date(), { observe: (event) => {
  process.stdout.write(`${JSON.stringify({ event: "identity_email_delivery", ...event })}\n`);
} });

await app.ready();
const server = createServer((request, response) => app.routing(request, response));
let running = false;
const timer = setInterval(() => {
  if (running) return;
  running = true;
  void worker.runOnce().catch(() => undefined).finally(() => { running = false; });
}, 500);
timer.unref();

const close = async () => {
  clearInterval(timer);
  server.close();
  await Promise.all([app.close(), pool.end()]);
};
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
const host = optional("GOODDEALER_IDENTITY_DEVELOPMENT_HOST") ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "::1") throw new TypeError("development Identity must bind to loopback");
const listenPort = port(optional("GOODDEALER_IDENTITY_DEVELOPMENT_PORT") ?? "3001");
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(listenPort, host, resolve);
});
process.stdout.write(`GoodDealer development Identity listening on http://${host}:${listenPort}\n`);

function required(name: string): string {
  const value = optional(name);
  if (value === undefined) throw new TypeError(`${name} is required`);
  return value;
}
function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}
function key(name: string): Buffer {
  const value = required(name);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new TypeError(`${name} must encode exactly 32 bytes`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32) throw new TypeError(`${name} must encode exactly 32 bytes`);
  return decoded;
}
function port(value: string): number {
  if (!/^\d{1,5}$/u.test(value)) throw new TypeError("development Identity port is invalid");
  const parsed = Number(value);
  if (parsed < 1_024 || parsed > 65_535) throw new TypeError("development Identity port is invalid");
  return parsed;
}
