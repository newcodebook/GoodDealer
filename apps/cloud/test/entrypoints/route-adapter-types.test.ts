import type { FastifyInstance } from "fastify";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  registerAdminRoutes,
  registerPublicRoutes,
} from "../../src/entrypoints/adapter/surface";
import type { JobSchedulerPort } from "../../src/entrypoints/ports/job-scheduler";
import {
  adminBoundaryRoutes,
  adminBusinessRoutes,
} from "../../src/entrypoints/routes/admin/boundary";
import {
  publicBoundaryRoutes,
  publicBusinessRoutes,
} from "../../src/entrypoints/routes/public/boundary";

describe("nominal route surfaces and structural fallbacks", () => {
  it("makes cross-surface registration a compile-time error", () => {
    if (false) {
      const app = null as unknown as FastifyInstance;
      // @ts-expect-error admin route brands cannot enter the public registrar
      registerPublicRoutes(app, adminBoundaryRoutes);
      // @ts-expect-error public route brands cannot enter the admin registrar
      registerAdminRoutes(app, publicBoundaryRoutes);
    }
    expect(publicBoundaryRoutes).toHaveLength(2);
    expect(adminBoundaryRoutes).toHaveLength(2);
  });

  it("keeps both business registries as empty tuple types", () => {
    expectTypeOf(publicBusinessRoutes).toEqualTypeOf<readonly []>();
    expectTypeOf(adminBusinessRoutes).toEqualTypeOf<readonly []>();
    expect(publicBusinessRoutes).toEqual([]);
    expect(adminBusinessRoutes).toEqual([]);
  });

  it("keeps schedulePeriodic unable to express success", () => {
    type ScheduleResult = Awaited<ReturnType<JobSchedulerPort["schedulePeriodic"]>>;
    type Success = Extract<ScheduleResult, { scheduled: true }>;
    expectTypeOf<Success>().toEqualTypeOf<never>();
  });
});
