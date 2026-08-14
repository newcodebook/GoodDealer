import type {
  JobApplicationPorts,
  JobSchedulerPort,
  TenantContextFactory,
} from "./ports/job-scheduler";

export interface JobsDependencies {
  readonly ports: JobApplicationPorts;
  readonly tenants: TenantContextFactory;
  readonly scheduler: JobSchedulerPort;
  readonly now: () => Date;
}

export const periodicJobs: readonly [] = [];

export interface JobsComposition {
  readonly transport: "framework-independent";
  readonly periodicJobsRegistered: false;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createJobsComposition(_deps: JobsDependencies): JobsComposition {
  return {
    transport: "framework-independent",
    periodicJobsRegistered: false,
    async start(): Promise<void> {
      // The empty tuple is the fail-closed registry: no scheduler call is possible in this slice.
    },
    async stop(): Promise<void> {},
  };
}
