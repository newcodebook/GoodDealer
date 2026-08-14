export interface TenantContext {
  readonly tenantId: string;
}

export interface TenantContextFactory {
  create(tenantId: string): TenantContext;
}

export type JobApplicationPorts = readonly [];

export interface PeriodicJobSpec {
  readonly jobName: string;
  readonly cron: string;
  readonly targetModule: string;
  readonly payloadVersion: number;
}

export interface PeriodicJobDenied {
  readonly scheduled: false;
  readonly reason: "periodic_jobs_not_registered";
}

export interface JobSchedulerPort {
  schedulePeriodic(spec: PeriodicJobSpec): Promise<PeriodicJobDenied>;
}

export class DenyingPeriodicScheduler implements JobSchedulerPort {
  async schedulePeriodic(_spec: PeriodicJobSpec): Promise<PeriodicJobDenied> {
    return { scheduled: false, reason: "periodic_jobs_not_registered" };
  }
}
