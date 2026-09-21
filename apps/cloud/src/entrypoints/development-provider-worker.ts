import { hostname } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";

import { createCloudDatabasePool } from "../db/index";
import { createJobsComposition, createPostgresCommercialJobPort, periodicJobs } from "./jobs";
import { readStripeTestProviderComposition } from "./development-commercial-config";
import { SelfHostedPeriodicScheduler } from "./self-hosted-periodic-scheduler";

const commercialProviders = await readStripeTestProviderComposition(configurationPath(
  "GOODDEALER_COMMERCIAL_PROVIDER_FILE",
  join(homedir(), ".config", "gooddealer", "commercial-development.json"),
));
const pool = createCloudDatabasePool({
  connectionString: requiredEnvironment("GOODDEALER_POSTGRES_PROVIDER_WORKER_URL"),
  max: 12,
});
const workerId = `${safeHost(hostname())}-${process.pid}`;
const intervalMilliseconds = boundedInterval(optionalEnvironment("GOODDEALER_PROVIDER_WORKER_INTERVAL_MS") ?? "5000");
const maximumDrain = boundedDrain(optionalEnvironment("GOODDEALER_PROVIDER_WORKER_MAX_DRAIN") ?? "100");
const scheduler = new SelfHostedPeriodicScheduler();
const jobs = createJobsComposition({
  ports: {
    commercialProvider: createPostgresCommercialJobPort(
      pool,
      commercialProviders.providerReaders,
      commercialProviders.checkoutCatalog,
      commercialProviders.checkoutGateways,
      () => new Date(),
    ),
  },
  tenants: { create: (tenantId) => ({ tenantId }) },
  scheduler,
  now: () => new Date(),
  observe: ({ jobName, outcome, evaluatedAt }) => {
    process.stdout.write(`${JSON.stringify({ component: "commercial-provider-worker", jobName, outcome, evaluatedAt })}\n`);
  },
});

let stopping = false;
let releaseStop: (() => void) | undefined;
const stopped = new Promise<void>((resolve) => { releaseStop = resolve; });
const stop = () => {
  if (stopping) return;
  stopping = true;
  releaseStop?.();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await jobs.start();
  process.stdout.write(`${JSON.stringify({
    component: "commercial-provider-worker",
    event: "started",
    registeredJobs: scheduler.registeredNames(),
    intervalMilliseconds,
  })}\n`);
  while (!stopping) {
    for (const spec of periodicJobs) {
      for (let count = 0; count < maximumDrain && !stopping; count += 1) {
        const result = await jobs.run(spec.jobName, `${workerId}-${spec.jobName}`);
        if (resultStatus(result) === "idle") break;
      }
    }
    if (!stopping) await Promise.race([delay(intervalMilliseconds), stopped]);
  }
} finally {
  await jobs.stop();
  await pool.end();
}

function resultStatus(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const status = Reflect.get(value, "status");
  return typeof status === "string" ? status : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function boundedInterval(value: string): number {
  if (!/^\d{3,6}$/u.test(value)) throw new TypeError("provider worker interval is invalid");
  const parsed = Number(value);
  if (parsed < 1_000 || parsed > 300_000) throw new TypeError("provider worker interval is invalid");
  return parsed;
}

function boundedDrain(value: string): number {
  if (!/^\d{1,3}$/u.test(value)) throw new TypeError("provider worker drain bound is invalid");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 500) throw new TypeError("provider worker drain bound is invalid");
  return parsed;
}

function safeHost(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/gu, "-").slice(0, 40);
  return normalized.length > 0 ? normalized : "gooddealer";
}
