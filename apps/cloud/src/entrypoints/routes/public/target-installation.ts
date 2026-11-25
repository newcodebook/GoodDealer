import {
  DEVICE_BOOTSTRAP_INSTALLATION_LIMITS as limits,
  deviceBootstrapClaimRequestSchema, deviceBootstrapClaimResponseSchema,
  deviceBootstrapStepRequestSchema, deviceBootstrapStepResponseSchema,
  deviceBootstrapCheckpointRequestSchema, deviceBootstrapCheckpointResponseSchema,
  deviceBootstrapActivationRequestSchema, deviceBootstrapActivationResponseSchema,
  deviceBootstrapReceiptRequestSchema, deviceBootstrapReceiptResponseSchema,
} from "@gooddealer/protocol/devices";
import type { DesktopRouteAuthorityPort } from "../../../modules/devices/index";
import { PUBLIC_SURFACE, type PublicSurface, type RouteAdapter } from "../../adapter/surface";
import { PublicRouteAuthorizationError } from "../../adapter/error-identity";
import type { PublicPrincipal } from "../../ports/public-session";
import type { TargetBootstrapInstallationPort } from "../../ports/target-installation";

export const TARGET_BOOTSTRAP_CLAIM_ROUTE = "/v1/device-switch/bootstrap/claim" as const;
export const TARGET_BOOTSTRAP_STEP_ROUTE = "/v1/device-switch/bootstrap/step" as const;
export const TARGET_BOOTSTRAP_CHECKPOINT_ROUTE = "/v1/device-switch/bootstrap/checkpoint" as const;
export const TARGET_BOOTSTRAP_ACTIVATION_ROUTE = "/v1/device-switch/bootstrap/activate" as const;
export const TARGET_BOOTSTRAP_RECEIPT_ROUTE = "/v1/device-switch/bootstrap/receipt" as const;

/** Fixed target-installation operations; neither the URL nor the tenant is caller-selectable. */
export function createTargetBootstrapInstallationRoutes(
  installation: TargetBootstrapInstallationPort | undefined,
  authority: DesktopRouteAuthorityPort,
): readonly RouteAdapter<PublicSurface, PublicPrincipal, any, any>[] {
  if (installation === undefined) return [];
  const routes = [
    { path: TARGET_BOOTSTRAP_CLAIM_ROUTE, request: deviceBootstrapClaimRequestSchema,
      response: deviceBootstrapClaimResponseSchema, method: "claim", requestBytes: limits.claimRequestBytes,
      responseBytes: limits.claimResponseBytes },
    { path: TARGET_BOOTSTRAP_STEP_ROUTE, request: deviceBootstrapStepRequestSchema,
      response: deviceBootstrapStepResponseSchema, method: "step", requestBytes: limits.stepRequestBytes,
      responseBytes: limits.stepResponseBytes },
    { path: TARGET_BOOTSTRAP_CHECKPOINT_ROUTE, request: deviceBootstrapCheckpointRequestSchema,
      response: deviceBootstrapCheckpointResponseSchema, method: "checkpoint", requestBytes: limits.checkpointRequestBytes,
      responseBytes: limits.checkpointResponseBytes },
    { path: TARGET_BOOTSTRAP_ACTIVATION_ROUTE, request: deviceBootstrapActivationRequestSchema,
      response: deviceBootstrapActivationResponseSchema, method: "activate", requestBytes: limits.activationRequestBytes,
      responseBytes: limits.activationResponseBytes },
    { path: TARGET_BOOTSTRAP_RECEIPT_ROUTE, request: deviceBootstrapReceiptRequestSchema,
      response: deviceBootstrapReceiptResponseSchema, method: "receipt", requestBytes: limits.receiptRequestBytes,
      responseBytes: limits.receiptResponseBytes },
  ] as const;
  return routes.map((route) => ({
    surface: PUBLIC_SURFACE, method: "POST", path: route.path,
    request: route.request, response: route.response,
    requiredScope: null, deviceRole: route.method === "receipt" ? "bound_device" : "active_or_standby",
    authorizeDeviceRole: (principal, role) => authority.authorize(principal, role),
    authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
    invoke: async (value: unknown, principal: PublicPrincipal) => {
      const result = await installation[route.method](value, principal);
      if (result === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      // The response schema rejects unexpected fields; the whole envelope also has a byte budget.
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > route.responseBytes) {
        throw new Error("target installation response exceeds its transport bound");
      }
      return result;
    },
    bodyLimit: route.requestBytes,
  }));
}
