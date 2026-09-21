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
  createPublicBusinessRoutes,
  publicBoundaryRoutes,
} from "../../src/entrypoints/routes/public/boundary";
import { denyingPublicApplicationPorts } from "../support/public-session";

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

  it("registers account activation, Desktop authorization, and commercial account routes", () => {
    const publicBusinessRoutes = createPublicBusinessRoutes(denyingPublicApplicationPorts);
    expectTypeOf(adminBusinessRoutes).toEqualTypeOf<readonly []>();
    expect(publicBusinessRoutes.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "POST", path: "/v1/account/activation" },
      { method: "POST", path: "/v1/devices/authorization-grant" },
      { method: "POST", path: "/v1/account/billing/checkout" },
      { method: "GET", path: "/v1/account/billing/status" },
      { method: "POST", path: "/v1/account/billing/subscription/cancel" },
      { method: "POST", path: "/v1/account/billing/fixed-term/confirm" },
      { method: "POST", path: "/v1/account/billing/first-purchase-refund" },
      { method: "POST", path: "/v1/account/billing/first-purchase-refund/status" },
    ]);
    expect(adminBusinessRoutes).toEqual([]);
  });

  it("allows the explicit commercial worker registry to report scheduler acceptance", () => {
    type ScheduleResult = Awaited<ReturnType<JobSchedulerPort["schedulePeriodic"]>>;
    type Success = Extract<ScheduleResult, { scheduled: true }>;
    expectTypeOf<Success>().toEqualTypeOf<{ readonly scheduled: true }>();
  });
});
