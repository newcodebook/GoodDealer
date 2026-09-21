import { describe, expect, it, vi } from "vitest";

import { createJobsComposition, periodicJobs } from "../../src/entrypoints/jobs";
import {
  DenyingPeriodicScheduler,
  type JobSchedulerPort,
} from "../../src/entrypoints/ports/job-scheduler";
import { SelfHostedPeriodicScheduler } from "../../src/entrypoints/self-hosted-periodic-scheduler";

describe("commercial provider Jobs composition", () => {
  it("registers the exact durable commercial workers and exposes redacted outcome observations", async () => {
    const schedulePeriodic = vi.fn<JobSchedulerPort["schedulePeriodic"]>(async () => ({ scheduled: true as const }));
    const processNextOperation = vi.fn(async () => ({ status: "confirmed" }));
    const processNextInbox = vi.fn(async () => ({ status: "scheduled" }));
    const processNextReconciliation = vi.fn(async () => ({ status: "retry_scheduled" }));
    const processNextDueAuthority = vi.fn(async () => ({ status: "idle" }));
    const processNextRelease = vi.fn(async () => ({ status: "idle" }));
    const observe = vi.fn();
    const composition = createJobsComposition({
      ports: { commercialProvider: { processNextOperation, processNextInbox, processNextReconciliation,
        processNextDueAuthority, processNextRelease } },
      tenants: { create: (tenantId) => ({ tenantId }) },
      scheduler: { schedulePeriodic },
      now: () => new Date("2026-08-30T00:00:00Z"),
      observe,
    });
    await composition.start();
    expect(schedulePeriodic.mock.calls.map(([spec]) => spec.jobName)).toEqual([
      "commercial-provider-operation",
      "commercial-provider-inbox",
      "commercial-provider-reconciliation",
      "commercial-due-authority",
      "commercial-provider-release",
    ]);
    await composition.run("commercial-provider-operation", "worker-0");
    await composition.run("commercial-provider-inbox", "worker-1");
    await composition.run("commercial-provider-reconciliation", "worker-2");
    expect(processNextInbox).toHaveBeenCalledWith("worker-1");
    expect(processNextOperation).toHaveBeenCalledWith("worker-0");
    expect(observe).toHaveBeenLastCalledWith({
      jobName: "commercial-provider-reconciliation",
      outcome: "retry_scheduled",
      evaluatedAt: "2026-08-30T00:00:00.000Z",
    });
    expect(periodicJobs).toHaveLength(5);
    expect(composition.periodicJobsRegistered).toBe(true);
  });

  it("fails closed when deployment has not installed a scheduler", async () => {
    const composition = createJobsComposition({
      ports: { commercialProvider: { processNextOperation: vi.fn(), processNextInbox: vi.fn(), processNextReconciliation: vi.fn(),
        processNextDueAuthority: vi.fn(), processNextRelease: vi.fn() } },
      tenants: { create: (tenantId) => ({ tenantId }) },
      scheduler: new DenyingPeriodicScheduler(),
      now: () => new Date(),
    });
    await expect(composition.start()).rejects.toThrow(/scheduling was denied/u);
  });

  it("accepts the exact self-hosted registry once and rejects drift or duplicate registration", async () => {
    const scheduler = new SelfHostedPeriodicScheduler();
    await expect(scheduler.schedulePeriodic(periodicJobs[0])).resolves.toEqual({ scheduled: true });
    await expect(scheduler.schedulePeriodic(periodicJobs[0])).rejects.toThrow(/registration is invalid/u);
    await expect(scheduler.schedulePeriodic({ ...periodicJobs[1], cron: "*/2 * * * *" }))
      .rejects.toThrow(/registration is invalid/u);
  });
});
