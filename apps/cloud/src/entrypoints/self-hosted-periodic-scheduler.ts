import { periodicJobs } from "./jobs";
import type { JobSchedulerPort, PeriodicJobSpec } from "./ports/job-scheduler";

/** Validates the fixed registry used by the self-hosted worker's bounded drain loop. */
export class SelfHostedPeriodicScheduler implements JobSchedulerPort {
  readonly #registered = new Set<string>();

  async schedulePeriodic(spec: PeriodicJobSpec): Promise<{ readonly scheduled: true }> {
    const expected = periodicJobs.find((candidate) => candidate.jobName === spec.jobName);
    if (expected === undefined || expected.cron !== spec.cron
      || expected.targetModule !== spec.targetModule || expected.payloadVersion !== spec.payloadVersion
      || this.#registered.has(spec.jobName)) {
      throw new TypeError("periodic job registration is invalid");
    }
    this.#registered.add(spec.jobName);
    return { scheduled: true };
  }

  registeredNames(): string[] {
    return [...this.#registered].sort();
  }
}
