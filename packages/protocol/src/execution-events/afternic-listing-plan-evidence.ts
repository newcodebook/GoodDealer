import { z } from "zod";
import {
  afternicListingWriteApprovalAuditPayloadSchema, afternicListingWriteClaimAuditPayloadSchema,
  afternicListingWriteClaimPayloadSchema, afternicListingWritePreflightRefusedAuditPayloadSchema,
  afternicListingWriteReconciledAuditPayloadSchema,
} from "./afternic-listing-write-evidence";

// These are separate contracts, not an expansion of the historical v1 action enum.
// Ingest and Native must select the exact version, item purpose and outer event identity.
export const afternicListingPlanApprovalAuditPayloadSchema = z.object({
  ...afternicListingWriteApprovalAuditPayloadSchema.shape,
  schemaVersion: z.literal(2),
  action: z.literal("listing_plan_v2"),
  targetCount: z.number().int().min(1).max(1000),
}).strict();
export const afternicListingPlanClaimAuditPayloadSchema = z.object({
  ...afternicListingWriteClaimAuditPayloadSchema.shape,
  schemaVersion: z.literal(2),
}).strict();
export const afternicListingPlanClaimPayloadSchema = z.object({
  ...afternicListingWriteClaimPayloadSchema.shape,
  schemaVersion: z.literal(2),
}).strict();
export const afternicListingPlanPreflightRefusedAuditPayloadSchema = z.object({
  ...afternicListingWritePreflightRefusedAuditPayloadSchema.shape,
  schemaVersion: z.literal(2),
}).strict();
export const afternicListingPlanReconciledAuditPayloadSchema = z.object({
  ...afternicListingWriteReconciledAuditPayloadSchema.shape,
  schemaVersion: z.literal(2),
}).strict().superRefine((value, ctx) => {
  const historicalShape = afternicListingWriteReconciledAuditPayloadSchema.safeParse({ ...value, schemaVersion: 1 });
  if (!historicalShape.success) ctx.addIssue({ code: "custom", path: ["reason"], message: "reason must match the actual observation outcome" });
});

const ownershipAction = z.literal("reactivate_ownership_review");
const digest = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const ownershipObservationFields = { resourceBindingDigest: digest, preflightObservationDigest: digest };
export const afternicOwnershipReviewClaimAuditPayloadSchema = z.object({
  ...afternicListingWriteClaimAuditPayloadSchema.shape,
  action: ownershipAction,
  ...ownershipObservationFields,
}).strict();
export const afternicOwnershipReviewClaimPayloadSchema = z.object({
  ...afternicListingWriteClaimPayloadSchema.shape,
  action: ownershipAction,
  ...ownershipObservationFields,
}).strict();
export const afternicOwnershipReviewPreflightRefusedAuditPayloadSchema = z.object({
  ...afternicListingWritePreflightRefusedAuditPayloadSchema.shape,
  action: ownershipAction,
  reason: z.enum(["precondition_changed", "connection_changed", "listing_absent", "provider_state_blocked", "cooldown", "prior_outcome_unknown"]),
}).strict();
export const afternicOwnershipReviewReconciledAuditPayloadSchema = z.object({
  ...afternicListingWriteReconciledAuditPayloadSchema.shape,
  action: ownershipAction,
  outcome: z.enum(["confirmed", "still_review", "read_failed", "conflict"]),
}).strict().superRefine((value, ctx) => {
  const valid = value.outcome === "confirmed" ? value.reason === null
    : value.outcome === "still_review" ? value.reason === "postcondition_pending"
      : value.outcome === "read_failed" ? value.reason === "read_failed"
        : value.reason === "precondition_changed" || value.reason === "connection_changed" || value.reason === "provider_state_blocked";
  if (!valid) ctx.addIssue({ code: "custom", path: ["reason"], message: "reason must match the ownership review observation outcome" });
});

export type AfternicListingPlanApprovalAuditPayload = z.infer<typeof afternicListingPlanApprovalAuditPayloadSchema>;
export type AfternicListingPlanClaimAuditPayload = z.infer<typeof afternicListingPlanClaimAuditPayloadSchema>;
export type AfternicListingPlanClaimPayload = z.infer<typeof afternicListingPlanClaimPayloadSchema>;
export type AfternicListingPlanPreflightRefusedAuditPayload = z.infer<typeof afternicListingPlanPreflightRefusedAuditPayloadSchema>;
export type AfternicListingPlanReconciledAuditPayload = z.infer<typeof afternicListingPlanReconciledAuditPayloadSchema>;
export type AfternicOwnershipReviewClaimAuditPayload = z.infer<typeof afternicOwnershipReviewClaimAuditPayloadSchema>;
export type AfternicOwnershipReviewClaimPayload = z.infer<typeof afternicOwnershipReviewClaimPayloadSchema>;
export type AfternicOwnershipReviewPreflightRefusedAuditPayload = z.infer<typeof afternicOwnershipReviewPreflightRefusedAuditPayloadSchema>;
export type AfternicOwnershipReviewReconciledAuditPayload = z.infer<typeof afternicOwnershipReviewReconciledAuditPayloadSchema>;

/** Authenticated preflight may satisfy the intent without claiming or inventing a dispatch. */
export const afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema = z.object({
  ...afternicOwnershipReviewPreflightRefusedAuditPayloadSchema.omit({ reason: true }).shape,
  stage: z.literal("preflight_satisfied"),
}).strict();
export type AfternicOwnershipReviewPreflightSatisfiedAuditPayload = z.infer<typeof afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema>;
