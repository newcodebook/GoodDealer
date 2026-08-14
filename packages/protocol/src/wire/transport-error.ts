import { z } from "zod";

import { identifier, safeUnsignedInteger } from "./scalars";

export const TRANSPORT_REJECTION_SCHEMA_VERSION = 1 as const;

export const transportRejectionCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "SCHEMA_INVALID",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL",
]);

export const transportRejectionSchema = z
  .object({
    schemaVersion: z.literal(TRANSPORT_REJECTION_SCHEMA_VERSION),
    code: transportRejectionCodeSchema,
    correlationId: identifier,
  })
  .strict();

/** Boundary-only request and response contracts. They carry no business data. */
export const boundaryEmptyRequestSchema = z.object({}).strict();
export const publicBoundaryIdentityResponseSchema = z
  .object({
    surface: z.literal("public"),
    authenticated: z.literal(true),
  })
  .strict();
export const adminBoundaryIdentityResponseSchema = z
  .object({
    surface: z.literal("admin"),
  })
  .strict();
export const boundaryValidateRequestSchema = z
  .object({
    count: safeUnsignedInteger,
  })
  .strict();
export const boundaryAcceptedResponseSchema = z
  .object({
    accepted: z.literal(true),
  })
  .strict();

export type TransportRejectionCode = z.infer<typeof transportRejectionCodeSchema>;
export type TransportRejection = z.infer<typeof transportRejectionSchema>;
export type BoundaryEmptyRequest = z.infer<typeof boundaryEmptyRequestSchema>;
export type PublicBoundaryIdentityResponse = z.infer<typeof publicBoundaryIdentityResponseSchema>;
export type AdminBoundaryIdentityResponse = z.infer<typeof adminBoundaryIdentityResponseSchema>;
export type BoundaryValidateRequest = z.infer<typeof boundaryValidateRequestSchema>;
export type BoundaryAcceptedResponse = z.infer<typeof boundaryAcceptedResponseSchema>;
