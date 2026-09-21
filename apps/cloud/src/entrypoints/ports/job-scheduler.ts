export interface TenantContext {
  readonly tenantId: string;
}

export interface TenantContextFactory {
  create(tenantId: string): TenantContext;
}

export interface CommercialProviderJobPort {
  processNextOperation(workerId: string): Promise<unknown>;
  processNextInbox(workerId: string): Promise<unknown>;
  processNextReconciliation(workerId: string): Promise<unknown>;
  processNextDueAuthority(workerId: string): Promise<unknown>;
  processNextRelease(workerId: string): Promise<unknown>;
}

export interface JobApplicationPorts {
  readonly commercialProvider: CommercialProviderJobPort;
}

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

export interface PeriodicJobScheduled {
  readonly scheduled: true;
}

export interface JobSchedulerPort {
  schedulePeriodic(spec: PeriodicJobSpec): Promise<PeriodicJobDenied | PeriodicJobScheduled>;
}

export class DenyingPeriodicScheduler implements JobSchedulerPort {
  async schedulePeriodic(_spec: PeriodicJobSpec): Promise<PeriodicJobDenied> {
    return { scheduled: false, reason: "periodic_jobs_not_registered" };
  }
}
