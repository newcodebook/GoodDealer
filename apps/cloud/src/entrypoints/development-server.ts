import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createPublicKey } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import { createCloudCapabilityDatabasePools, createCloudDatabasePool } from "../db/index";
import { PostgresDesktopAccessTokenVerifier } from "../modules/identity/postgres-desktop-access-token-verifier";
import { TrustedActiveDeviceLeaseVerifier } from "../modules/devices/active-device-lease-verifier";
import { PostgresIdentitySessionVerificationReader } from "../modules/identity/postgres-session-verification-reader";
import {
  Argon2idPasswordHashVerifier,
  IdentityAccountAccessService,
  IdentityAccountSessionVerifier,
  IdentityEmailOutboxWorker,
  LoopbackSmtpEmailDelivery,
  PostgresIdentityAccountAccessRepository,
} from "../modules/identity/index";
import { AccountTransactionRunner } from "../db/index";
import { rateLimitPolicy } from "./adapter/rate-limit";
import { createPostgresDesktopOAuthHttp } from "./desktop-oauth-http";
import { createPostgresCloudPublicHttp } from "./http";
import { createPostgresPaymentWebhookHttp } from "./payment-webhook-http";
import { createIdentityHttp } from "./identity-http";
import { CloudPublicSessionVerifier } from "./ports/public-session";
import { readStripeTestProviderComposition } from "./development-commercial-config";
import { OpenBaoAppRoleTokenSource } from "./openbao-approle-token-source";
import { OpenBaoTransitSigner } from "./openbao-transit-signer";
import { serializeDesktopAuthorizationVerifierRegistry } from "./desktop-authorization-registry";
import {
  parseOpenBaoAuthorityKeyConfiguration,
  type OpenBaoAuthorityKeyConfiguration,
} from "./openbao-authority-keyring";

const DEFAULT_OPENBAO_DIRECTORY = join(homedir(), ".config", "gooddealer", "openbao-dev");

if (process.argv.includes("--print-desktop-registry")) {
  const publicKeys = await readPublicKeys(configurationPath(
    "GOODDEALER_OPENBAO_PUBLIC_KEYS_FILE",
    join(DEFAULT_OPENBAO_DIRECTORY, "public-keys.json"),
  ));
  process.stdout.write(`${serializeDesktopAuthorizationVerifierRegistry({
    grantKeys: publicKeys.grant.verifierKeys,
    leaseKeys: publicKeys.lease.verifierKeys,
  })}\n`);
} else {
  await startDevelopmentServer();
}

async function startDevelopmentServer(): Promise<void> {
  const appUrl = requiredEnvironment("GOODDEALER_POSTGRES_APP_URL");
  const accountApiUrl = requiredEnvironment("GOODDEALER_POSTGRES_ACCOUNT_API_URL");
  const identityIssuerUrl = requiredEnvironment("GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL");
  const providerIngressUrl = requiredEnvironment("GOODDEALER_POSTGRES_PROVIDER_INGRESS_URL");
  const providerWorkerUrl = requiredEnvironment("GOODDEALER_POSTGRES_PROVIDER_WORKER_URL");
  const commercialProviders = await readStripeTestProviderComposition(configurationPath(
    "GOODDEALER_COMMERCIAL_PROVIDER_FILE",
    join(homedir(), ".config", "gooddealer", "commercial-development.json"),
  ));
  const publicKeys = await readPublicKeys(configurationPath(
    "GOODDEALER_OPENBAO_PUBLIC_KEYS_FILE",
    join(DEFAULT_OPENBAO_DIRECTORY, "public-keys.json"),
  ));
  const credentialsFile = configurationPath(
    "GOODDEALER_OPENBAO_APPROLE_FILE",
    join(DEFAULT_OPENBAO_DIRECTORY, "authority-approle.json"),
  );
  const requiredPolicy = optionalEnvironment("GOODDEALER_OPENBAO_REQUIRED_POLICY")
    ?? "gooddealer-dev-authority";
  const tokenSource = new OpenBaoAppRoleTokenSource({
    address: publicKeys.address,
    requiredPolicy,
    allowedPolicies: ["default", requiredPolicy],
    credentialsSource: async () => readAppRoleCredentials(credentialsFile),
  });
  const signer = new OpenBaoTransitSigner({
    address: publicKeys.address,
    mount: publicKeys.transitMount,
    grantKey: publicKeys.grant.activeKey,
    leaseKey: publicKeys.lease.activeKey,
    tokenSource,
  });
  const leaseVerifier = new TrustedActiveDeviceLeaseVerifier(
    publicKeys.lease.verifierKeys.map((key) => ({
      kid: key.kid,
      publicKey: createPublicKey(key.publicKeyPem),
    })),
  );
  const pool = createCloudDatabasePool({ connectionString: appUrl, max: 12 });
  const capabilityPools = createCloudCapabilityDatabasePools({
    accountApi: { connectionString: accountApiUrl, max: 12 },
    identityCapabilityIssuer: { connectionString: identityIssuerUrl, max: 4 },
    providerIngress: { connectionString: providerIngressUrl, max: 8 },
    providerWorker: { connectionString: providerWorkerUrl, max: 12 },
  });
  const identity = new PostgresIdentitySessionVerificationReader(pool);
  const identityAccessRepository = new PostgresIdentityAccountAccessRepository(pool);
  const identityOutboxKey = requiredBase64UrlKey("GOODDEALER_IDENTITY_OUTBOX_KEY");
  const accountNamespaceKey = requiredBase64UrlKey("GOODDEALER_IDENTITY_BROWSER_NAMESPACE_KEY");
  const identityAccess = new IdentityAccountAccessService(
    identityAccessRepository,
    new Argon2idPasswordHashVerifier(),
    {
      verificationPepper: requiredBase64UrlKey("GOODDEALER_IDENTITY_VERIFICATION_PEPPER"),
      outboxKey: identityOutboxKey,
      outboxKeyId: optionalEnvironment("GOODDEALER_IDENTITY_OUTBOX_KEY_ID") ?? "development-v1",
    },
  );
  const identityHttp = createIdentityHttp({
    accounts: identityAccess,
    sessions: new CloudPublicSessionVerifier(new IdentityAccountSessionVerifier(identity)),
    allowedOrigins: [optionalEnvironment("GOODDEALER_ACCOUNT_ORIGIN") ?? "https://account.gooddealer.com"],
    now: () => new Date(),
    accountNamespaceKey,
  });
  const emailWorker = new IdentityEmailOutboxWorker(
    identityAccessRepository,
    new LoopbackSmtpEmailDelivery({
      host: "127.0.0.1",
      port: boundedPort(optionalEnvironment("GOODDEALER_MAILPIT_SMTP_PORT") ?? "1025"),
      from: optionalEnvironment("GOODDEALER_IDENTITY_FROM_EMAIL") ?? "account@development.gooddealer.invalid",
    }),
    identityOutboxKey,
    optionalEnvironment("GOODDEALER_IDENTITY_OUTBOX_KEY_ID") ?? "development-v1",
  );
  const rateLimit = rateLimitPolicy(60_000, 120);
  const publicHttp = createPostgresCloudPublicHttp({
    pool,
    accountApiPool: capabilityPools.accountApi,
    identityCapabilityIssuerPool: capabilityPools.identityCapabilityIssuer,
    providerWorkerPool: capabilityPools.providerWorker,
    identity,
    activationSubjects: { async readActivationSubject() { return null; } },
    desktopAuthorizationSigner: signer,
    activeDeviceLeaseVerifier: leaseVerifier,
    desktopAccessTokens: new PostgresDesktopAccessTokenVerifier(new AccountTransactionRunner(pool)),
    commercialCheckoutCatalog: commercialProviders.checkoutCatalog,
    commercialCheckoutGateways: commercialProviders.checkoutGateways,
    workspaceSyncTokenKey: requiredBase64UrlKey("GOODDEALER_WORKSPACE_SYNC_TOKEN_KEY"),
    preAuthRateLimit: rateLimit,
    sessionRateLimit: rateLimit,
    now: () => new Date(),
    correlationIds: () => `request-${crypto.randomUUID()}`,
  });
  const oauthHttp = createPostgresDesktopOAuthHttp({
    pool,
    accountApiPool: capabilityPools.accountApi,
    identityCapabilityIssuerPool: capabilityPools.identityCapabilityIssuer,
    identity,
    activeDeviceLeaseSigner: signer,
    activeDeviceLeaseVerifier: leaseVerifier,
    rateLimit,
    now: () => new Date(),
  });
  const paymentWebhookHttp = createPostgresPaymentWebhookHttp({
    providerIngressPool: capabilityPools.providerIngress,
    stripe: commercialProviders.stripeWebhook,
    paypal: commercialProviders.paypalWebhook,
    rateLimit,
    now: () => new Date(),
  });
  await Promise.all([publicHttp.ready(), oauthHttp.ready(), paymentWebhookHttp.ready(), identityHttp.ready()]);
  const host = optionalEnvironment("GOODDEALER_CLOUD_DEVELOPMENT_HOST") ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new TypeError("development Cloud server must bind to loopback");
  }
  const port = boundedPort(optionalEnvironment("GOODDEALER_CLOUD_DEVELOPMENT_PORT") ?? "3000");
  const server = createServer((request, response) => {
    const selected = request.url?.startsWith("/v1/identity/") === true
      ? identityHttp
      : request.url?.startsWith("/v1/desktop-oauth/") === true
      ? oauthHttp
      : request.url?.startsWith("/v1/payment-webhooks/") === true
        ? paymentWebhookHttp
        : publicHttp;
    selected.routing(request, response);
  });
  let emailWorkerRunning = false;
  const emailTimer = setInterval(() => {
    if (emailWorkerRunning) return;
    emailWorkerRunning = true;
    void emailWorker.runOnce().catch(() => undefined).finally(() => { emailWorkerRunning = false; });
  }, 1_000);
  emailTimer.unref();
  const close = async () => {
    clearInterval(emailTimer);
    server.close();
    await Promise.all([
      publicHttp.close(),
      oauthHttp.close(),
      paymentWebhookHttp.close(),
      identityHttp.close(),
      pool.end(),
      capabilityPools.accountApi.end(),
      capabilityPools.identityCapabilityIssuer.end(),
      capabilityPools.providerIngress.end(),
      capabilityPools.providerWorker.end(),
    ]);
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  process.stdout.write(`GoodDealer development Cloud listening on http://${host}:${port}\n`);
}

function requiredBase64UrlKey(name: string): Buffer {
  const value = requiredEnvironment(name);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new TypeError(`${name} must encode exactly 32 bytes`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32) throw new TypeError(`${name} must encode exactly 32 bytes`);
  return decoded;
}

async function readPublicKeys(path: string): Promise<OpenBaoAuthorityKeyConfiguration> {
  const value = await readJson(path, 65_536);
  return parseOpenBaoAuthorityKeyConfiguration(value);
}

async function readAppRoleCredentials(path: string): Promise<{ roleId: string; secretId: string }> {
  const value = await readJson(path, 32_768);
  if (!plainRecord(value) || typeof value.role_id !== "string" || typeof value.secret_id !== "string") {
    throw new TypeError("OpenBao AppRole credential file is invalid");
  }
  return { roleId: value.role_id, secretId: value.secret_id };
}

async function readJson(path: string, maximumBytes: number): Promise<unknown> {
  const bytes = await readFile(path);
  if (bytes.length < 1 || bytes.length > maximumBytes) throw new TypeError("development configuration file is invalid");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requiredEnvironment(name: string): string {
  const value = optionalEnvironment(name);
  if (value === undefined) throw new TypeError(`${name} is required`);
  return value;
}

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function configurationPath(name: string, fallback: string): string {
  const value = optionalEnvironment(name) ?? fallback;
  if (!value.startsWith("/") || value.includes("\u0000")) throw new TypeError(`${name} must be an absolute path`);
  return value;
}

function boundedPort(value: string): number {
  if (!/^\d{1,5}$/u.test(value)) throw new TypeError("development Cloud port is invalid");
  const port = Number(value);
  if (port < 1_024 || port > 65_535) throw new TypeError("development Cloud port is invalid");
  return port;
}
