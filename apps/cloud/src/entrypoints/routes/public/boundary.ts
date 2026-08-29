import {
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
  PUBLIC_SURFACE,
  type PublicSurface,
  type RouteAdapter,
} from "../../adapter/surface";
import type { AccountActivationApplicationPort } from "../../ports/account-activation";
import type { PublicPrincipal } from "../../ports/public-session";

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

export class PublicRouteAuthorizationError extends Error {}

export interface PublicBusinessRoutePorts {
  readonly accountActivation: AccountActivationApplicationPort;
}

export function createPublicBusinessRoutes(
  ports: PublicBusinessRoutePorts,
): readonly [PublicRoute<AccountActivationRequest, AccountActivationResponse>] {
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
  return [accountActivationRoute];
}
