import type {
  CommercialProviderJobPort,
  JobApplicationPorts,
  JobSchedulerPort,
  PeriodicJobSpec,
  TenantContextFactory,
} from "./ports/job-scheduler";
import type { Pool } from "pg";
import { PaymentWebhookReconciliationService, PostgresCommercialAggregateRepository,
  ProviderDispatchExecutor, ProviderOperationRecoveryService,
  type CommercialCheckoutGateway, type CommercialProviderReader, type CommercialCheckoutCatalog } from "../modules/licensing/index";

export interface JobsDependencies {
  readonly ports: JobApplicationPorts;
  readonly tenants: TenantContextFactory;
  readonly scheduler: JobSchedulerPort;
  readonly now: () => Date;
  readonly observe?: (event: {
    readonly jobName: string;
    readonly outcome: string;
    readonly evaluatedAt: string;
  }) => void;
}

export const periodicJobs = [
  {
    jobName: "commercial-provider-operation",
    cron: "* * * * *",
    targetModule: "licensing",
    payloadVersion: 1,
  },
  {
    jobName: "commercial-provider-inbox",
    cron: "* * * * *",
    targetModule: "licensing",
    payloadVersion: 1,
  },
  {
    jobName: "commercial-provider-reconciliation",
    cron: "* * * * *",
    targetModule: "licensing",
    payloadVersion: 1,
  },
  { jobName: "commercial-due-authority", cron: "* * * * *", targetModule: "licensing", payloadVersion: 1 },
  { jobName: "commercial-provider-release", cron: "* * * * *", targetModule: "licensing", payloadVersion: 1 },
] as const satisfies readonly PeriodicJobSpec[];

export interface JobsComposition {
  readonly transport: "framework-independent";
  readonly periodicJobsRegistered: true;
  start(): Promise<void>;
  stop(): Promise<void>;
  run(jobName: typeof periodicJobs[number]["jobName"], workerId: string): Promise<unknown>;
}

/** Composes targetless jobs only on the dedicated gd_provider_worker connection. */
export function createPostgresCommercialJobPort(providerWorkerPool: Pool,
  readers: readonly CommercialProviderReader[], checkoutCatalog: CommercialCheckoutCatalog,
  gateways: readonly CommercialCheckoutGateway[], now: () => Date): CommercialProviderJobPort {
  const repository = new PostgresCommercialAggregateRepository();
  const reconciliation = new PaymentWebhookReconciliationService(providerWorkerPool, repository, readers, now);
  const operations = new ProviderOperationRecoveryService(providerWorkerPool, repository, checkoutCatalog,
    new ProviderDispatchExecutor(providerWorkerPool, repository, gateways, now), readers, now);
  return {
    processNextOperation: (workerId) => operations.processNextOperation(workerId),
    processNextInbox: (workerId) => reconciliation.processNextInbox(workerId),
    processNextReconciliation: (workerId) => reconciliation.processNextReconciliation(workerId),
    processNextDueAuthority: (workerId) => reconciliation.processNextDueAuthority(workerId),
    processNextRelease: (workerId) => reconciliation.processNextRelease(workerId),
  };
}

export function createJobsComposition(deps?: JobsDependencies): JobsComposition {
  let started = false;
  return {
    transport: "framework-independent",
    periodicJobsRegistered: true,
    async start(): Promise<void> {
      if (deps === undefined) throw new Error("commercial provider job dependencies are unavailable");
      if (started) return;
      for (const spec of periodicJobs) {
        const result = await deps.scheduler.schedulePeriodic(spec);
        if (!result.scheduled) throw new Error("commercial provider job scheduling was denied");
      }
      started = true;
    },
    async stop(): Promise<void> { started = false; },
    async run(jobName, workerId): Promise<unknown> {
      if (deps === undefined) throw new Error("commercial provider job dependencies are unavailable");
      if (!started) throw new Error("commercial provider jobs are not started");
      const evaluatedAt = deps.now();
      if (!Number.isFinite(evaluatedAt.getTime())) throw new TypeError("job time is invalid");
      const result = jobName === "commercial-provider-operation"
        ? await deps.ports.commercialProvider.processNextOperation(workerId)
        : jobName === "commercial-provider-inbox"
          ? await deps.ports.commercialProvider.processNextInbox(workerId)
        : jobName === "commercial-provider-reconciliation"
          ? await deps.ports.commercialProvider.processNextReconciliation(workerId)
          : jobName === "commercial-due-authority"
            ? await deps.ports.commercialProvider.processNextDueAuthority(workerId)
            : await deps.ports.commercialProvider.processNextRelease(workerId);
      deps.observe?.({
        jobName,
        outcome: jobOutcome(result),
        evaluatedAt: evaluatedAt.toISOString(),
      });
      return result;
    },
  };
}

function jobOutcome(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const status = Reflect.get(value, "status");
    if (typeof status === "string" && /^[a-z_]{1,40}$/u.test(status)) return status;
  }
  return "unknown";
}
