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
export const publicBusinessRoutes: readonly [] = [];
