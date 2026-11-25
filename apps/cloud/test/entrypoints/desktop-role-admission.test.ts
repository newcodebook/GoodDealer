import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { boundaryEmptyRequestSchema, publicBoundaryIdentityResponseSchema } from "@gooddealer/protocol/wire";
import { PUBLIC_SURFACE, registerPublicRoutes, setRoutePrincipal } from "../../src/entrypoints/adapter/surface";
import { assignCorrelationId } from "../../src/entrypoints/adapter/correlation";
import { createPublicBusinessRoutes } from "../../src/entrypoints/routes/public/boundary";
import { createForcedTakeoverRoutes } from "../../src/entrypoints/routes/public/forced-takeover";
import { createTargetBootstrapInstallationRoutes } from "../../src/entrypoints/routes/public/target-installation";
import { denyingPublicApplicationPorts } from "../support/public-session";

const principal = { accountId: "account-a", sessionId: "session-a", clientKind: "desktop" as const };

describe("Desktop route roles", () => {
  it("closes every Desktop business route over the reviewed role list", () => {
    // Declarations only; the inert ports are never invoked in this inventory test.
    const unused = async (): Promise<never> => { throw new Error("must not invoke"); };
    const routes = [...createPublicBusinessRoutes({ ...denyingPublicApplicationPorts,
      workspaceSync: { push: unused, pull: unused, checkpoint: unused, rebootstrap: unused, receipts: unused },
      deviceDirectory: { list: unused, reportSelf: unused },
      targetBootstrap: { status: unused, cancel: unused },
      deviceSwitchResolution: { resolve: unused },
      deviceSwitch: { request: unused, status: unused, cancel: unused, drain: unused },
      cloudflareDnsObservation: { submit: unused },
    }), ...createTargetBootstrapInstallationRoutes(
      { claim: unused, step: unused, checkpoint: unused, activate: unused, receipt: unused },
      denyingPublicApplicationPorts.desktopRouteAuthority,
    ), ...createForcedTakeoverRoutes({ preview: unused, status: unused, resolve: unused, cancelIntent: unused }, denyingPublicApplicationPorts.desktopRouteAuthority)].filter((route) => route.authorize(principal));
    expect(routes.map(({ path, deviceRole }) => [path, deviceRole]).sort()).toEqual([
      ["/v1/devices/authorization-grant", "active_or_standby"],
      ["/v1/workspace-sync/mutations/push", "active"],
      ["/v1/workspace-sync/mutations/pull", "active_or_standby"],
      ["/v1/workspace-sync/checkpoint", "active_or_standby"],
      ["/v1/workspace-sync/rebootstrap", "active_or_standby"],
      ["/v1/workspace-sync/mutations/receipts", "active"],
      ["/v1/workspace-observations/cloudflare-dns", "active"],
      ...["preview", "status", "resolve", "cancel-intent"].map(method => [`/v1/device-switch/forced/${method}`, "active_or_standby"]),
      ["/v1/device-switch/requests", "active_or_standby"],
      ["/v1/device-switch/bootstrap/status", "bound_device"],
      ["/v1/device-switch/bootstrap/claim", "active_or_standby"],
      ["/v1/device-switch/bootstrap/step", "active_or_standby"],
      ["/v1/device-switch/bootstrap/checkpoint", "active_or_standby"],
      ["/v1/device-switch/bootstrap/activate", "active_or_standby"],
      ["/v1/device-switch/bootstrap/receipt", "bound_device"],
      ["/v1/device-switch/bootstrap/cancel", "bound_device"],
      ["/v1/device-switch/requests/resolve", "active_or_standby"],
      ["/v1/device-switch/requests/status", "active_or_standby"],
      ["/v1/device-switch/requests/cancel", "active_or_standby"],
      ["/v1/device-switch/requests/drain", "active"],
      ["/v1/devices/list", "active_or_standby"],
      ["/v1/devices/self", "active"],
    ].sort());
    expect(routes.every((route) => route.authorizeDeviceRole !== undefined)).toBe(true);
  });

  it.each(["missing", "denied", "allowed"] as const)("enforces %s role admission before application invocation", async (mode) => {
    const app = Fastify({ logger: false });
    const invoke = vi.fn(async () => ({ surface: "public" as const, authenticated: true as const }));
    app.addHook("onRequest", async (request, reply) => {
      assignCorrelationId(request, reply, () => "role-test");
      setRoutePrincipal(request, principal);
    });
    registerPublicRoutes(app, [{ surface: PUBLIC_SURFACE, method: "POST", path: "/test-role",
      request: boundaryEmptyRequestSchema, response: publicBoundaryIdentityResponseSchema,
      requiredScope: null, deviceRole: "active", authorize: () => true, invoke,
      ...(mode === "missing" ? {} : { authorizeDeviceRole: async () => mode === "allowed" }),
    }]);
    try {
      const result = await app.inject({ method: "POST", url: "/test-role", payload: {} });
      expect(result.statusCode).toBe(mode === "allowed" ? 200 : 404);
      expect(invoke).toHaveBeenCalledTimes(mode === "allowed" ? 1 : 0);
    } finally { await app.close(); }
  });
});
