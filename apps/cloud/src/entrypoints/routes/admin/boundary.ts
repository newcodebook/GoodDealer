import {
  adminBoundaryIdentityResponseSchema,
  boundaryAcceptedResponseSchema,
  boundaryEmptyRequestSchema,
  type AdminBoundaryIdentityResponse,
  type BoundaryAcceptedResponse,
  type BoundaryEmptyRequest,
} from "@gooddealer/protocol/wire";

import {
  ADMIN_SURFACE,
  type AdminSurface,
  type RouteAdapter,
} from "../../adapter/surface";
import type { StaffPrincipal } from "../../ports/staff-session";

export const ADMIN_BOUNDARY_READ_SCOPE = "admin:boundary:read" as const;

export type AdminRoute<TIn, TOut> = RouteAdapter<AdminSurface, StaffPrincipal, TIn, TOut>;

const identityRoute: AdminRoute<BoundaryEmptyRequest, AdminBoundaryIdentityResponse> = {
  surface: ADMIN_SURFACE,
  method: "GET",
  path: "/admin/v1/boundary/identity",
  request: boundaryEmptyRequestSchema,
  response: adminBoundaryIdentityResponseSchema,
  requiredScope: ADMIN_BOUNDARY_READ_SCOPE,
  authorize: (principal) => principal.scopes.has(ADMIN_BOUNDARY_READ_SCOPE),
  invoke: async () => ({ surface: "admin" }),
};

const validateRoute: AdminRoute<BoundaryEmptyRequest, BoundaryAcceptedResponse> = {
  surface: ADMIN_SURFACE,
  method: "POST",
  path: "/admin/v1/boundary/validate",
  request: boundaryEmptyRequestSchema,
  response: boundaryAcceptedResponseSchema,
  requiredScope: ADMIN_BOUNDARY_READ_SCOPE,
  authorize: (principal) => principal.scopes.has(ADMIN_BOUNDARY_READ_SCOPE),
  invoke: async () => ({ accepted: true }),
};

export const adminBoundaryRoutes = [identityRoute, validateRoute] as const;
export const adminBusinessRoutes: readonly [] = [];
