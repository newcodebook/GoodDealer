import { PublicRouteAuthorizationError } from "../../adapter/error-identity";
import { desktopExecutionContextRequestSchema, desktopExecutionContextResponseSchema, DESKTOP_EXECUTION_CONTEXT_REQUEST_LIMIT_BYTES } from "@gooddealer/protocol/devices";
import type { DesktopExecutionContextApplicationPort } from "../../ports/execution-context";
import type { TargetBootstrapControlPort } from "../../ports/target-bootstrap";
import type { DeviceSwitchRequestResolutionPort } from "../../ports/device-switch-resolution";
import type { ExecutionEvidenceApplicationPort } from "../../ports/execution-evidence";
import {
  deviceAuditIngestRequestSchema,
  executionFactIngestRequestSchema,
  executionEvidenceIngestResponseSchema,
  executionEvidenceReceiptsRequestSchema,
  executionEvidenceReceiptsResponseSchema,
} from "@gooddealer/protocol/execution-events";
import {
  deviceBootstrapStatusRequestSchema,
  deviceBootstrapStatusResponseSchema,
  desktopAuthorizationGrantRoleRequestSchema,
  desktopAuthorizationGrantRoleResponseSchema,
  deviceBindingListSchema,
  deviceListRequestSchema,
  deviceSelfReportSchema,
  deviceSwitchDrainRequestSchema,
  deviceSwitchLookupRequestSchema,
  deviceSwitchRequestSchema,
  deviceSwitchRequestResolutionRequestSchema,
  deviceSwitchRequestResolutionResponseSchema,
  deviceSwitchResponseSchema,
  type DesktopAuthorizationGrantRoleResponse,
  type DesktopAuthorizationGrantRoleRequest,
} from "@gooddealer/protocol/devices";
import {
  billingCheckoutCreateRequestSchema,
  billingCheckoutCreateResponseSchema,
  billingFixedTermConfirmRequestSchema,
  billingFixedTermConfirmResponseSchema,
  billingFirstPurchaseRefundRequestSchema,
  billingFirstPurchaseRefundRequestResponseSchema,
  billingFirstPurchaseRefundStatusReadRequestSchema,
  billingFirstPurchaseRefundStatusReadResponseSchema,
  billingStatusReadRequestSchema,
  billingStatusReadResponseSchema,
  billingSubscriptionCancelRequestSchema,
  billingSubscriptionCancelResponseSchema,
  type BillingCheckoutCreateRequest,
  type BillingCheckoutCreateResponse,
  type BillingFixedTermConfirmRequest,
  type BillingFixedTermConfirmResponse,
  type BillingFirstPurchaseRefundRequest,
  type BillingFirstPurchaseRefundRequestResponse,
  type BillingFirstPurchaseRefundStatusReadRequest,
  type BillingFirstPurchaseRefundStatusReadResponse,
  type BillingStatusReadResponse,
  type BillingSubscriptionCancelRequest,
  type BillingSubscriptionCancelResponse,
  accountActivationRequestSchema,
  accountActivationResponseSchema,
  type AccountActivationRequest,
  type AccountActivationResponse,
} from "@gooddealer/protocol/account";
import {
  boundaryAcceptedResponseSchema,
  boundaryEmptyRequestSchema,
  boundaryValidateRequestSchema,
  publicBoundaryIdentityResponseSchema,
  type BoundaryAcceptedResponse,
  type BoundaryEmptyRequest,
  type BoundaryValidateRequest,
  type PublicBoundaryIdentityResponse,
} from "@gooddealer/protocol/wire";
import {
  workspaceCheckpointReadRequestSchema,
  workspaceCheckpointReadResponseSchema,
  workspaceRebootstrapRequestSchema,
  workspaceMutationReceiptReadRequestSchema,
  workspaceMutationReceiptReadResponseSchema,
  rebootstrapPlanSchema,
  workspaceMutationPullRequestSchema,
  workspaceMutationPullResponseSchema,
  workspaceMutationPushRequestSchema,
  workspaceMutationPushResponseSchema,
  type WorkspaceCheckpointReadRequest,
  type WorkspaceCheckpointReadResponse,
  type WorkspaceRebootstrapRequest,
  type WorkspaceMutationReceiptReadRequest,
  type WorkspaceMutationPullRequest,
  type WorkspaceMutationPullResponse,
  type WorkspaceMutationPushRequest,
  type WorkspaceMutationPushResponse,
} from "@gooddealer/protocol/workspace";
import {
  cloudflareDnsProjectionRequestSchema,
  cloudflareDnsProjectionAckSchema,
  type CloudflareDnsProjectionRequest,
  type CloudflareDnsProjectionAck,
} from "@gooddealer/protocol/workspace-observations/cloudflare-dns";

import {
  PUBLIC_SURFACE,
  type PublicSurface,
  type RouteAdapter,
} from "../../adapter/surface";
import type { AccountActivationApplicationPort } from "../../ports/account-activation";
import type { DesktopAuthorizationApplicationPort } from "../../ports/desktop-authorization";
import type { PublicPrincipal } from "../../ports/public-session";
import type { DesktopRouteAuthorityPort } from "../../../modules/devices/index";
import type { DeviceDirectoryApplicationPort, DeviceSwitchApplicationPort } from "../../../modules/devices/index";
import type { CommercialCheckoutApplicationPort } from "../../../modules/licensing/index";
import type {
  CloudflareDnsObservationIngressPort,
  WorkspaceSyncApplicationPort,
} from "../../../modules/workspace/index";

export type PublicRoute<TIn, TOut> = RouteAdapter<PublicSurface, PublicPrincipal, TIn, TOut>;

const identityRoute: PublicRoute<BoundaryEmptyRequest, PublicBoundaryIdentityResponse> = {
  surface: PUBLIC_SURFACE,
  method: "GET",
  path: "/v1/boundary/identity",
  request: boundaryEmptyRequestSchema,
  response: publicBoundaryIdentityResponseSchema,
  requiredScope: null,
  deviceRole: null,
  authorize: () => true,
  invoke: async () => ({ surface: "public", authenticated: true }),
};

const validateRoute: PublicRoute<BoundaryValidateRequest, BoundaryAcceptedResponse> = {
  surface: PUBLIC_SURFACE,
  method: "POST",
  path: "/v1/boundary/validate",
  request: boundaryValidateRequestSchema,
  response: boundaryAcceptedResponseSchema,
  requiredScope: null,
  deviceRole: null,
  authorize: () => true,
  invoke: async () => ({ accepted: true }),
};

export const publicBoundaryRoutes = [identityRoute, validateRoute] as const;

export const ACCOUNT_ACTIVATION_ROUTE = "/v1/account/activation" as const;
export const DESKTOP_AUTHORIZATION_GRANT_ROUTE =
  "/v1/devices/authorization-grant" as const;
export const BILLING_CHECKOUT_ROUTE = "/v1/account/billing/checkout" as const;
export const BILLING_STATUS_ROUTE = "/v1/account/billing/status" as const;
export const BILLING_SUBSCRIPTION_CANCEL_ROUTE = "/v1/account/billing/subscription/cancel" as const;
export const BILLING_FIXED_TERM_CONFIRM_ROUTE = "/v1/account/billing/fixed-term/confirm" as const;
export const BILLING_FIRST_PURCHASE_REFUND_REQUEST_ROUTE =
  "/v1/account/billing/first-purchase-refund" as const;
export const BILLING_FIRST_PURCHASE_REFUND_STATUS_ROUTE =
  "/v1/account/billing/first-purchase-refund/status" as const;
export const WORKSPACE_SYNC_PUSH_ROUTE = "/v1/workspace-sync/mutations/push" as const;
export const WORKSPACE_SYNC_PULL_ROUTE = "/v1/workspace-sync/mutations/pull" as const;
export const WORKSPACE_SYNC_CHECKPOINT_ROUTE = "/v1/workspace-sync/checkpoint" as const;
export const WORKSPACE_REBOOTSTRAP_ROUTE = "/v1/workspace-sync/rebootstrap" as const;
export const WORKSPACE_SYNC_RECEIPTS_ROUTE = "/v1/workspace-sync/mutations/receipts" as const;
export const CLOUDFLARE_DNS_OBSERVATION_ROUTE = "/v1/workspace-observations/cloudflare-dns" as const;
export const DEVICE_SWITCH_REQUEST_ROUTE = "/v1/device-switch/requests" as const;
export const DEVICE_SWITCH_RESOLVE_ROUTE = "/v1/device-switch/requests/resolve" as const;
export const DEVICE_SWITCH_STATUS_ROUTE = "/v1/device-switch/requests/status" as const;
export const TARGET_BOOTSTRAP_STATUS_ROUTE = "/v1/device-switch/bootstrap/status" as const;
export const TARGET_BOOTSTRAP_CANCEL_ROUTE = "/v1/device-switch/bootstrap/cancel" as const;
export const DEVICE_SWITCH_CANCEL_ROUTE = "/v1/device-switch/requests/cancel" as const;
export const DEVICE_SWITCH_DRAIN_ROUTE = "/v1/device-switch/requests/drain" as const;
export const DESKTOP_EXECUTION_CONTEXT_ROUTE = "/v1/devices/execution-context" as const;
export const DEVICE_LIST_ROUTE = "/v1/devices/list" as const;
export const DEVICE_SELF_REPORT_ROUTE = "/v1/devices/self" as const;
export const DEVICE_AUDIT_INGEST_ROUTE = "/v1/device-audits/ingest" as const;
export const DEVICE_AUDIT_RECEIPTS_ROUTE = "/v1/device-audits/receipts" as const;
export const EXECUTION_FACT_INGEST_ROUTE = "/v1/execution-facts/ingest" as const;
export const EXECUTION_FACT_RECEIPTS_ROUTE = "/v1/execution-facts/receipts" as const;

function assertExecutionEvidenceResponseBound(value: unknown): void {
  // The 100-entry contract is a count bound. Escaped identifiers can still exceed Native's
  // fixed response cap, so reject the whole response before any bytes leave the HTTP boundary.
  const wire = JSON.stringify(value);
  if (wire === undefined || Buffer.byteLength(wire, "utf8") > 65_536) {
    throw new Error("execution evidence response exceeds its transport bound");
  }
}

function assertTargetBootstrapResponseBound(value: unknown): void {
  const wire = JSON.stringify(value);
  if (wire === undefined || Buffer.byteLength(wire, "utf8") > 8 * 1024) {
    throw new Error("target bootstrap response exceeds its transport bound");
  }
}

export interface PublicBusinessRoutePorts {
  readonly desktopRouteAuthority: DesktopRouteAuthorityPort;
  readonly accountActivation: AccountActivationApplicationPort;
  readonly desktopAuthorization: DesktopAuthorizationApplicationPort;
  readonly desktopExecutionContext?: DesktopExecutionContextApplicationPort;
  readonly deviceAuditEvidence?: ExecutionEvidenceApplicationPort;
  readonly executionFactEvidence?: ExecutionEvidenceApplicationPort;
  readonly commercialCheckout: CommercialCheckoutApplicationPort;
  readonly workspaceSync?: WorkspaceSyncApplicationPort;
  readonly cloudflareDnsObservation?: CloudflareDnsObservationIngressPort;
  readonly deviceSwitch?: DeviceSwitchApplicationPort;
  readonly deviceSwitchResolution?: DeviceSwitchRequestResolutionPort;
  readonly targetBootstrap?: TargetBootstrapControlPort;
  readonly deviceDirectory?: DeviceDirectoryApplicationPort;
}

export function createPublicBusinessRoutes(
  ports: PublicBusinessRoutePorts,
): readonly PublicRoute<any, any>[] {
  const accountActivationRoute: PublicRoute<AccountActivationRequest, AccountActivationResponse> = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: ACCOUNT_ACTIVATION_ROUTE,
    request: accountActivationRequestSchema,
    response: accountActivationResponseSchema,
    requiredScope: null,
    deviceRole: null,
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (request, principal) => {
      const response = await ports.accountActivation.activate(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const desktopAuthorizationRoute: PublicRoute<
    DesktopAuthorizationGrantRoleRequest,
    DesktopAuthorizationGrantRoleResponse
  > = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: DESKTOP_AUTHORIZATION_GRANT_ROUTE,
    request: desktopAuthorizationGrantRoleRequestSchema,
    response: desktopAuthorizationGrantRoleResponseSchema,
    requiredScope: null,
    deviceRole: "active_or_standby",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
    authorize: (principal) => principal.clientKind === "desktop",
    invoke: async (request, principal) => {
      const response = await ports.desktopAuthorization.issue(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const billingCheckoutRoute: PublicRoute<BillingCheckoutCreateRequest, BillingCheckoutCreateResponse> = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: BILLING_CHECKOUT_ROUTE,
    request: billingCheckoutCreateRequestSchema,
    response: billingCheckoutCreateResponseSchema,
    requiredScope: null,
    deviceRole: null,
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (request, principal) => {
      const response = await ports.commercialCheckout.createCheckout(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const billingStatusRoute: PublicRoute<Record<string, never>, BillingStatusReadResponse> = {
    surface: PUBLIC_SURFACE,
    method: "GET",
    path: BILLING_STATUS_ROUTE,
    request: billingStatusReadRequestSchema,
    response: billingStatusReadResponseSchema,
    requiredScope: null,
    deviceRole: null,
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (_request, principal) => {
      const response = await ports.commercialCheckout.readStatus(principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const billingCancellationRoute: PublicRoute<
    BillingSubscriptionCancelRequest,
    BillingSubscriptionCancelResponse
  > = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: BILLING_SUBSCRIPTION_CANCEL_ROUTE,
    request: billingSubscriptionCancelRequestSchema,
    response: billingSubscriptionCancelResponseSchema,
    requiredScope: null,
    deviceRole: null,
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (request, principal) => {
      const response = await ports.commercialCheckout.cancelSubscription(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const billingFixedTermConfirmRoute: PublicRoute<
    BillingFixedTermConfirmRequest,
    BillingFixedTermConfirmResponse
  > = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: BILLING_FIXED_TERM_CONFIRM_ROUTE,
    request: billingFixedTermConfirmRequestSchema,
    response: billingFixedTermConfirmResponseSchema,
    requiredScope: null,
    deviceRole: null,
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (request, principal) => {
      const response = await ports.commercialCheckout.confirmFixedTerm(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const billingFirstPurchaseRefundRoute: PublicRoute<
    BillingFirstPurchaseRefundRequest,
    BillingFirstPurchaseRefundRequestResponse
  > = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: BILLING_FIRST_PURCHASE_REFUND_REQUEST_ROUTE,
    request: billingFirstPurchaseRefundRequestSchema,
    response: billingFirstPurchaseRefundRequestResponseSchema,
    requiredScope: null,
    deviceRole: null,
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (request, principal) => {
      const response = await ports.commercialCheckout.requestFirstPurchaseRefund(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const billingFirstPurchaseRefundStatusRoute: PublicRoute<
    BillingFirstPurchaseRefundStatusReadRequest,
    BillingFirstPurchaseRefundStatusReadResponse
  > = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: BILLING_FIRST_PURCHASE_REFUND_STATUS_ROUTE,
    request: billingFirstPurchaseRefundStatusReadRequestSchema,
    response: billingFirstPurchaseRefundStatusReadResponseSchema,
    requiredScope: null,
    deviceRole: null,
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (request, principal) => {
      const response = await ports.commercialCheckout.readFirstPurchaseRefundStatus(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const workspaceSyncRoutes: readonly PublicRoute<any, any>[] = ports.workspaceSync === undefined ? [] : [
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: WORKSPACE_SYNC_PUSH_ROUTE,
      request: workspaceMutationPushRequestSchema,
      response: workspaceMutationPushResponseSchema,
      requiredScope: null,
      deviceRole: "active",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: (request: WorkspaceMutationPushRequest, principal: PublicPrincipal) =>
        ports.workspaceSync!.push(request, principal),
      bodyLimit: 1_048_576,
    },
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: WORKSPACE_SYNC_PULL_ROUTE,
      request: workspaceMutationPullRequestSchema,
      response: workspaceMutationPullResponseSchema,
      requiredScope: null,
      deviceRole: "active_or_standby",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: (request: WorkspaceMutationPullRequest, principal: PublicPrincipal) =>
        ports.workspaceSync!.pull(request, principal),
      bodyLimit: 2_048,
    },
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: WORKSPACE_SYNC_CHECKPOINT_ROUTE,
      request: workspaceCheckpointReadRequestSchema,
      response: workspaceCheckpointReadResponseSchema,
      requiredScope: null,
      deviceRole: "active_or_standby",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: (request: WorkspaceCheckpointReadRequest, principal: PublicPrincipal) =>
        ports.workspaceSync!.checkpoint(request, principal) as Promise<WorkspaceCheckpointReadResponse>,
      bodyLimit: 256,
    },
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: WORKSPACE_REBOOTSTRAP_ROUTE,
      request: workspaceRebootstrapRequestSchema,
      response: rebootstrapPlanSchema.nullable(),
      requiredScope: null,
      deviceRole: "active_or_standby",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: (request: WorkspaceRebootstrapRequest, principal: PublicPrincipal) =>
        ports.workspaceSync!.rebootstrap?.(request, principal) ?? Promise.resolve(null),
      bodyLimit: 256,
    },
    ...(ports.workspaceSync.receipts === undefined ? [] : [{
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: WORKSPACE_SYNC_RECEIPTS_ROUTE,
      request: workspaceMutationReceiptReadRequestSchema,
      response: workspaceMutationReceiptReadResponseSchema,
      requiredScope: null,
      deviceRole: "active",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: async (request: WorkspaceMutationReceiptReadRequest, principal: PublicPrincipal) => {
        const response = await ports.workspaceSync!.receipts!(request, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        return response;
      },
      // Worst schema-valid body: 256 identifiers of 160 printable ASCII characters, each of which
      // may be `"` or `\` and JSON-escape to two bytes, plus quotes and separators (256 * 323 bytes
      // = 82,688) and the envelope. 96 KiB admits that and nothing near an order of magnitude more.
      bodyLimit: 96 * 1024,
    } as PublicRoute<any, any>]),
  ];
  const cloudflareObservationRoutes: readonly PublicRoute<any, any>[] = ports.cloudflareDnsObservation === undefined ? [] : [
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: CLOUDFLARE_DNS_OBSERVATION_ROUTE,
      request: cloudflareDnsProjectionRequestSchema,
      response: cloudflareDnsProjectionAckSchema,
      requiredScope: null,
      deviceRole: "active",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: async (request: CloudflareDnsProjectionRequest, principal: PublicPrincipal) => {
        const response = await ports.cloudflareDnsObservation!.submit(request, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        return response;
      },
      bodyLimit: 64 * 1024,
    },
  ];
  const deviceSwitch = ports.deviceSwitch;
  const deviceSwitchRoute = (
    path: string,
    deviceRole: "active" | "active_or_standby",
    request: typeof deviceSwitchRequestSchema | typeof deviceSwitchLookupRequestSchema | typeof deviceSwitchDrainRequestSchema,
    invoke: (port: DeviceSwitchApplicationPort, value: unknown, principal: PublicPrincipal) => ReturnType<DeviceSwitchApplicationPort["request"]>,
    // Request, status and cancel carry at most three identifiers of 160 printable characters,
    // each JSON-escaped at worst to two bytes: under 1.1 KiB.
    bodyLimit = 2 * 1024,
  ): PublicRoute<any, any> => ({
    surface: PUBLIC_SURFACE,
    method: "POST",
    path,
    request,
    response: deviceSwitchResponseSchema,
    requiredScope: null,
    deviceRole,
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
    authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
    invoke: async (value: unknown, principal: PublicPrincipal) => {
      const response = await invoke(deviceSwitch!, value, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
    bodyLimit,
  });
  const deviceSwitchRoutes: readonly PublicRoute<any, any>[] = deviceSwitch === undefined ? [] : [
    deviceSwitchRoute(DEVICE_SWITCH_REQUEST_ROUTE, "active_or_standby", deviceSwitchRequestSchema, (port, value, principal) => port.request(value, principal)),
    deviceSwitchRoute(DEVICE_SWITCH_STATUS_ROUTE, "active_or_standby", deviceSwitchLookupRequestSchema, (port, value, principal) => port.status(value, principal)),
    deviceSwitchRoute(DEVICE_SWITCH_CANCEL_ROUTE, "active_or_standby", deviceSwitchLookupRequestSchema, (port, value, principal) => port.cancel(value, principal)),
    ...(deviceSwitch.drain === undefined ? [] : [deviceSwitchRoute(
      DEVICE_SWITCH_DRAIN_ROUTE,
      "active",
      deviceSwitchDrainRequestSchema,
      (port, value, principal) => port.drain!(value, principal),
      // A handoff manifest: about twenty fields of at most 200 printable characters, three stream
      // claims with 43-character digests and a signature of at most 1024 characters. Escaping
      // every character still stays under 16 KiB.
      16 * 1024,
    )]),
  ];
  const deviceSwitchResolution = ports.deviceSwitchResolution;
  const deviceSwitchResolutionRoutes: readonly PublicRoute<any, any>[] = deviceSwitchResolution === undefined ? [] : [{
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: DEVICE_SWITCH_RESOLVE_ROUTE,
    request: deviceSwitchRequestResolutionRequestSchema,
    response: deviceSwitchRequestResolutionResponseSchema,
    requiredScope: null,
    deviceRole: "active_or_standby",
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
    authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
    invoke: async (value: unknown, principal: PublicPrincipal) => {
      const response = await deviceSwitchResolution.resolve(value, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      if (Buffer.byteLength(JSON.stringify(response), "utf8") > 8 * 1024) {
        throw new Error("device switch resolution exceeds its transport bound");
      }
      return response;
    },
    bodyLimit: 2 * 1024,
  }];
  const targetBootstrap = ports.targetBootstrap;
  const targetBootstrapRoutes: readonly PublicRoute<any, any>[] = targetBootstrap === undefined ? [] : [
    {
      surface: PUBLIC_SURFACE, method: "POST", path: TARGET_BOOTSTRAP_STATUS_ROUTE,
      request: deviceBootstrapStatusRequestSchema, response: deviceBootstrapStatusResponseSchema,
      requiredScope: null, deviceRole: "bound_device",
      authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: async (value: unknown, principal: PublicPrincipal) => {
        const response = await targetBootstrap.status(value, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        assertTargetBootstrapResponseBound(response);
        return response;
      },
      bodyLimit: 2 * 1024,
    },
    {
      surface: PUBLIC_SURFACE, method: "POST", path: TARGET_BOOTSTRAP_CANCEL_ROUTE,
      request: deviceSwitchLookupRequestSchema, response: deviceSwitchResponseSchema,
      requiredScope: null, deviceRole: "bound_device",
      authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: async (value: unknown, principal: PublicPrincipal) => {
        const response = await targetBootstrap.cancel(value, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        assertTargetBootstrapResponseBound(response);
        return response;
      },
      bodyLimit: 2 * 1024,
    },
  ];
  const deviceDirectory = ports.deviceDirectory;
  const deviceDirectoryRoute = (
    path: string,
    deviceRole: "active" | "active_or_standby",
    request: typeof deviceListRequestSchema | typeof deviceSelfReportSchema,
    invoke: (port: DeviceDirectoryApplicationPort, value: unknown, principal: PublicPrincipal) => ReturnType<DeviceDirectoryApplicationPort["list"]>,
  ): PublicRoute<any, any> => ({
    surface: PUBLIC_SURFACE,
    method: "POST",
    path,
    request,
    response: deviceBindingListSchema,
    requiredScope: null,
    deviceRole,
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
    authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
    invoke: async (value: unknown, principal: PublicPrincipal) => {
      const response = await invoke(deviceDirectory!, value, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
    // A self-report is a platform word and a display name of at most 64 characters (at most four
    // UTF-8 bytes each, as JSON permits them unescaped): well under 512 bytes. The list request is
    // a version field alone.
    bodyLimit: 1024,
  });
  const deviceDirectoryRoutes: readonly PublicRoute<any, any>[] = deviceDirectory === undefined ? [] : [
    deviceDirectoryRoute(DEVICE_LIST_ROUTE, "active_or_standby", deviceListRequestSchema, (port, value, principal) => port.list(value, principal)),
    deviceDirectoryRoute(DEVICE_SELF_REPORT_ROUTE, "active", deviceSelfReportSchema, (port, value, principal) => port.reportSelf(value, principal)),
  ];
  const contextRoutes: readonly PublicRoute<any, any>[] = ports.desktopExecutionContext === undefined ? [] : [{
    surface: PUBLIC_SURFACE, method: "POST", path: DESKTOP_EXECUTION_CONTEXT_ROUTE,
    request: desktopExecutionContextRequestSchema, response: desktopExecutionContextResponseSchema,
    requiredScope: null, deviceRole: "active", bodyLimit: DESKTOP_EXECUTION_CONTEXT_REQUEST_LIMIT_BYTES,
    authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
    authorize: (principal) => principal.clientKind === "desktop",
    invoke: async (value, principal) => {
      const response = await ports.desktopExecutionContext!.issue(value, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  }];
  const deviceAuditEvidenceRoutes: readonly PublicRoute<any, any>[] = ports.deviceAuditEvidence === undefined ? [] : [
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: DEVICE_AUDIT_INGEST_ROUTE,
      request: deviceAuditIngestRequestSchema,
      response: executionEvidenceIngestResponseSchema,
      requiredScope: null,
      deviceRole: "active",
      authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal) => principal.clientKind === "desktop",
      invoke: async (value, principal) => {
        const response = await ports.deviceAuditEvidence!.ingest(value, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        assertExecutionEvidenceResponseBound(response);
        return response;
      },
      bodyLimit: 16_384,
    },
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: DEVICE_AUDIT_RECEIPTS_ROUTE,
      request: executionEvidenceReceiptsRequestSchema,
      response: executionEvidenceReceiptsResponseSchema,
      requiredScope: null,
      deviceRole: "active",
      authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal) => principal.clientKind === "desktop",
      invoke: async (value, principal) => {
        const response = await ports.deviceAuditEvidence!.receipts(value, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        assertExecutionEvidenceResponseBound(response);
        return response;
      },
      bodyLimit: 32_768,
    },
  ];
  const executionFactEvidenceRoutes: readonly PublicRoute<any, any>[] = ports.executionFactEvidence === undefined ? [] : [
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: EXECUTION_FACT_INGEST_ROUTE,
      request: executionFactIngestRequestSchema,
      response: executionEvidenceIngestResponseSchema,
      requiredScope: null,
      deviceRole: "active",
      authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal) => principal.clientKind === "desktop",
      invoke: async (value, principal) => {
        const response = await ports.executionFactEvidence!.ingest(value, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        assertExecutionEvidenceResponseBound(response);
        return response;
      },
      bodyLimit: 32_768,
    },
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: EXECUTION_FACT_RECEIPTS_ROUTE,
      request: executionEvidenceReceiptsRequestSchema,
      response: executionEvidenceReceiptsResponseSchema,
      requiredScope: null,
      deviceRole: "active",
      authorizeDeviceRole: (principal, required) => ports.desktopRouteAuthority.authorize(principal, required),
      authorize: (principal) => principal.clientKind === "desktop",
      invoke: async (value, principal) => {
        const response = await ports.executionFactEvidence!.receipts(value, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        assertExecutionEvidenceResponseBound(response);
        return response;
      },
      bodyLimit: 32_768,
    },
  ];
  return [
    ...contextRoutes,
    accountActivationRoute,
    desktopAuthorizationRoute,
    billingCheckoutRoute,
    billingStatusRoute,
    billingCancellationRoute,
    billingFixedTermConfirmRoute,
    billingFirstPurchaseRefundRoute,
    billingFirstPurchaseRefundStatusRoute,
    ...workspaceSyncRoutes,
    ...cloudflareObservationRoutes,
    ...deviceSwitchRoutes,
    ...deviceSwitchResolutionRoutes,
    ...targetBootstrapRoutes,
    ...deviceDirectoryRoutes,
    ...deviceAuditEvidenceRoutes,
    ...executionFactEvidenceRoutes,
  ];
}
