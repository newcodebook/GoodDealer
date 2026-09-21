import {
  desktopAuthorizationGrantRequestSchema,
  desktopAuthorizationGrantSchema,
  type DesktopAuthorizationGrant,
  type DesktopAuthorizationGrantRequest,
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
  rebootstrapPlanSchema,
  workspaceMutationPullRequestSchema,
  workspaceMutationPullResponseSchema,
  workspaceMutationPushRequestSchema,
  workspaceMutationPushResponseSchema,
  type WorkspaceCheckpointReadRequest,
  type WorkspaceCheckpointReadResponse,
  type WorkspaceRebootstrapRequest,
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
export const CLOUDFLARE_DNS_OBSERVATION_ROUTE = "/v1/workspace-observations/cloudflare-dns" as const;

export class PublicRouteAuthorizationError extends Error {}

export interface PublicBusinessRoutePorts {
  readonly accountActivation: AccountActivationApplicationPort;
  readonly desktopAuthorization: DesktopAuthorizationApplicationPort;
  readonly commercialCheckout: CommercialCheckoutApplicationPort;
  readonly workspaceSync?: WorkspaceSyncApplicationPort;
  readonly cloudflareDnsObservation?: CloudflareDnsObservationIngressPort;
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
    authorize: (principal) => principal.clientKind === "account_web",
    invoke: async (request, principal) => {
      const response = await ports.accountActivation.activate(request, principal);
      if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
      return response;
    },
  };
  const desktopAuthorizationRoute: PublicRoute<
    DesktopAuthorizationGrantRequest,
    DesktopAuthorizationGrant
  > = {
    surface: PUBLIC_SURFACE,
    method: "POST",
    path: DESKTOP_AUTHORIZATION_GRANT_ROUTE,
    request: desktopAuthorizationGrantRequestSchema,
    response: desktopAuthorizationGrantSchema,
    requiredScope: null,
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
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: (request: WorkspaceRebootstrapRequest, principal: PublicPrincipal) =>
        ports.workspaceSync!.rebootstrap?.(request, principal) ?? Promise.resolve(null),
      bodyLimit: 256,
    },
  ];
  const cloudflareObservationRoutes: readonly PublicRoute<any, any>[] = ports.cloudflareDnsObservation === undefined ? [] : [
    {
      surface: PUBLIC_SURFACE,
      method: "POST",
      path: CLOUDFLARE_DNS_OBSERVATION_ROUTE,
      request: cloudflareDnsProjectionRequestSchema,
      response: cloudflareDnsProjectionAckSchema,
      requiredScope: null,
      authorize: (principal: PublicPrincipal) => principal.clientKind === "desktop",
      invoke: async (request: CloudflareDnsProjectionRequest, principal: PublicPrincipal) => {
        const response = await ports.cloudflareDnsObservation!.submit(request, principal);
        if (response === null) throw new PublicRouteAuthorizationError("public route authorization denied");
        return response;
      },
      bodyLimit: 64 * 1024,
    },
  ];
  return [
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
  ];
}
