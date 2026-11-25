import { z } from "zod";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { canonicalDomainNameSchema, copyPlainData } from "../portfolio/index";
import { afternicDelistProviderStatusSchema } from "./afternic-delist";
import {
  afternicListingWriteApproveRequestSchema, afternicListingWriteItemSchema,
  afternicListingWritePatchSchema, afternicListingWritePlanSchema, afternicListingWriteStatusRequestSchema,
  afternicListingWriteStatusSchema, afternicListingWriteSummarySchema, afternicListingWriteValuesSchema,
} from "./afternic-listing-write";

const version = z.literal(2);
const reviewAction = "reactivate_ownership_review";
const actionSchema = z.enum(["create", "update", reviewAction]);
const reviewIntent = z.strictObject({ mode: z.literal("reactivate_once_if_review") });
const target = { domain: canonicalDomainNameSchema };
const listingTarget = { ...target, ownershipReview: reviewIntent.nullable() };
const preview = { schemaVersion: version, connectionId: afternicListingWritePlanSchema.shape.planRef };

export const afternicListingPlanPreviewRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...preview, action: z.literal("create"),
    items: z.array(z.strictObject({ ...listingTarget, values: afternicListingWriteValuesSchema })).min(1).max(500) }),
  z.strictObject({ ...preview, action: z.literal("update"),
    items: z.array(z.strictObject({ ...listingTarget, patch: afternicListingWritePatchSchema })).min(1).max(500) }),
  z.strictObject({ ...preview, action: z.literal(reviewAction),
    items: z.array(z.strictObject(target)).min(1).max(500) }),
]).refine(request => new Set(request.items.map(item => item.domain)).size === request.items.length
  && (request.action === reviewAction || request.items.some(item => item.ownershipReview !== null)));

export const afternicListingPlanApproveRequestSchema = afternicListingWriteApproveRequestSchema.extend({ schemaVersion: version });
export const afternicListingPlanStatusRequestSchema = afternicListingWriteStatusRequestSchema.extend({ schemaVersion: version });

const reviewStateSchema = z.enum([
  "preview", "waiting_parent", "queued", "reconciling", "pending_provider", "confirmed", "not_required", "conflict",
]);
const reviewRefusalReasons = ["precondition_changed", "connection_changed", "listing_absent", "provider_state_blocked",
  "cooldown", "prior_outcome_unknown"] as const;
const reviewReasonSchema = z.enum([...reviewRefusalReasons, "postcondition_pending", "read_failed"]);
const reviewConflicts = new Set<string>(reviewRefusalReasons);
const reviewTerminal = new Set(["confirmed", "not_required", "conflict"]);
const listingTerminal = new Set(["applied", "conflict"]);

const afternicOwnershipReviewSchema = z.strictObject({
  state: reviewStateSchema, reason: reviewReasonSchema.nullable(),
  claimedAt: canonicalUtcTimestamp.nullable(), retryAt: canonicalUtcTimestamp.nullable(),
  retryNotBefore: canonicalUtcTimestamp.nullable(),
  latest: z.strictObject({ providerStatus: afternicDelistProviderStatusSchema, observedAt: canonicalUtcTimestamp }).nullable(),
}).superRefine((review, ctx) => {
  const { state, reason, claimedAt, retryAt, retryNotBefore, latest } = review;
  const freshResult = state === "confirmed" || state === "not_required";
  if ((freshResult && (latest === null || !["ACTIVE", "HIDDEN"].includes(latest.providerStatus)))
    || (state === "confirmed" && (claimedAt === null || (latest !== null && latest.observedAt < claimedAt)))
    || (state === "not_required" && (claimedAt !== null || retryNotBefore !== null))
    || (["preview", "waiting_parent", "queued"].includes(state) && claimedAt !== null)
    || ((state === "reconciling" || state === "pending_provider") && claimedAt === null)
    || (state === "preview" && (latest !== null || retryAt !== null || retryNotBefore !== null))
    || (reviewTerminal.has(state) && retryAt !== null)
    || (state === "conflict" ? !reviewConflicts.has(reason ?? "")
      : reason !== null && (reviewTerminal.has(state) || state === "preview"
        || (reason !== "read_failed" && reason !== "postcondition_pending") || retryAt === null))) {
    ctx.addIssue({ code: "custom", message: "invalid Afternic ownership review facts" });
  }
});

const { domain: _domain, ...listingWriteFields } = afternicListingWriteItemSchema.shape;
const afternicListingPlanItemSchema = z.strictObject({
  ...target,
  listingWrite: z.strictObject(listingWriteFields).nullable(),
  ownershipReview: afternicOwnershipReviewSchema.nullable(),
}).superRefine((item, ctx) => {
  if (item.listingWrite !== null && !afternicListingWriteItemSchema.safeParse({ domain: item.domain, ...item.listingWrite }).success) {
    ctx.addIssue({ code: "custom", path: ["listingWrite"], message: "invalid parent Listing facts" });
  }
});

const itemPending = (item: z.infer<typeof afternicListingPlanItemSchema>) =>
  (item.listingWrite !== null && !listingTerminal.has(item.listingWrite.state))
  || (item.ownershipReview !== null && !reviewTerminal.has(item.ownershipReview.state));
const itemConflict = (item: z.infer<typeof afternicListingPlanItemSchema>) =>
  item.listingWrite?.state === "conflict" || item.ownershipReview?.state === "conflict";

export const afternicListingPlanSchema = z.strictObject({
  ...afternicListingWritePlanSchema.shape, schemaVersion: version, action: actionSchema,
  items: z.array(afternicListingPlanItemSchema).min(1).max(500),
}).superRefine((plan, ctx) => {
  const unapproved = plan.state === "awaiting_approval" || plan.state === "expired";
  const standalone = plan.action === reviewAction;
  const pending = plan.items.some(itemPending);
  const conflict = plan.items.some(itemConflict);
  if (plan.expiresAt <= plan.createdAt || unapproved !== (plan.approvedAt === null)
    || (plan.approvedAt !== null && (plan.approvedAt < plan.createdAt || plan.approvedAt >= plan.expiresAt))
    || !plan.items.some(item => item.ownershipReview !== null)
    || plan.items.some((item, index) => {
      const { listingWrite, ownershipReview } = item;
      return (index > 0 && plan.items[index - 1]!.domain >= item.domain)
        || (standalone ? listingWrite !== null || ownershipReview === null || ownershipReview.state === "waiting_parent" : listingWrite === null)
        || (ownershipReview !== null && (unapproved !== (ownershipReview.state === "preview")
          || (ownershipReview.claimedAt !== null && (plan.approvedAt === null || ownershipReview.claimedAt < plan.approvedAt))
          || (ownershipReview.latest !== null && (plan.approvedAt === null || ownershipReview.latest.observedAt < plan.approvedAt))))
        || (listingWrite !== null && (unapproved !== (listingWrite.state === "preview")
          || (listingWrite.before !== null && listingWrite.before.observedAt > plan.createdAt)
          || (plan.action === "update" && listingWrite.before === null)
          || (plan.action === "create" && (!afternicListingWriteValuesSchema.safeParse(listingWrite.changes).success
            || (listingWrite.state === "applied" && listingWrite.changes.hidden === false
              && (listingWrite.latest?.providerStatus !== "ACTIVE" || listingWrite.latest.hidden !== false))))));
    })
    || (plan.state === "executing" && !pending)
    || (plan.state === "completed" && (pending || conflict))
    || (plan.state === "partially_failed" && (pending || !conflict))) {
    ctx.addIssue({ code: "custom", message: "invalid Afternic listing plan facts" });
  }
});

const summaryFields = afternicListingWriteSummarySchema.shape;
const legacySummary = z.strictObject({ ...summaryFields, schemaVersion: z.literal(1) })
  .refine(({ schemaVersion: _version, ...summary }) => afternicListingWriteSummarySchema.safeParse(summary).success);
const listingPlanSummary = z.strictObject({
  ...summaryFields, schemaVersion: version, action: actionSchema,
  ownershipReviewTotal: summaryFields.total, ownershipReviewPending: summaryFields.pending,
  ownershipReviewConfirmed: summaryFields.applied, ownershipReviewNotRequired: summaryFields.applied,
  ownershipReviewConflicts: summaryFields.conflicts,
}).refine(summary => summary.applied + summary.conflicts + summary.pending === summary.total
  && summary.pendingProvider + summary.pendingVerification <= summary.pending
  && summary.ownershipReviewTotal <= summary.total
  && summary.ownershipReviewPending + summary.ownershipReviewConfirmed + summary.ownershipReviewNotRequired
    + summary.ownershipReviewConflicts === summary.ownershipReviewTotal
  && (summary.action !== reviewAction || summary.ownershipReviewTotal === summary.total)
  && ((summary.state === "awaiting_approval" || summary.state === "expired")
    ? summary.pending === summary.total && summary.ownershipReviewPending === summary.ownershipReviewTotal
    : summary.state === "executing" ? summary.pending + summary.ownershipReviewPending > 0
      : summary.pending + summary.ownershipReviewPending === 0 && (summary.state === "completed"
        ? summary.conflicts + summary.ownershipReviewConflicts === 0 : summary.conflicts + summary.ownershipReviewConflicts > 0)));

export const afternicListingPlanStatusSchema = z.strictObject({
  ...afternicListingWriteStatusSchema.shape, schemaVersion: version,
  ownershipReviewQualified: z.boolean(), ownershipReviewExecutionAvailable: z.boolean(),
  plans: z.array(z.discriminatedUnion("schemaVersion", [legacySummary, listingPlanSummary])).max(50),
  detail: z.discriminatedUnion("schemaVersion", [afternicListingWritePlanSchema, afternicListingPlanSchema]).nullable(),
}).superRefine((status, ctx) => {
  const { controlledAcceptance, ownershipReviewQualified, ownershipReviewExecutionAvailable, plans, detail } = status;
  if ((controlledAcceptance !== null && (status.writeQualified || ownershipReviewQualified))
    || (ownershipReviewExecutionAvailable && (!ownershipReviewQualified || !status.writeEntitled || !status.executionAvailable))
    || new Set(plans.map(plan => plan.planRef)).size !== plans.length
    || plans.some((plan, index) => index > 0 && (plans[index - 1]!.createdAt < plan.createdAt
      || (plans[index - 1]!.createdAt === plan.createdAt && plans[index - 1]!.planRef < plan.planRef)))) {
    ctx.addIssue({ code: "custom", message: "invalid Afternic listing plan status" });
  }
  if (detail === null) return;
  const summary = plans.find(plan => plan.planRef === detail.planRef);
  if (summary === undefined) return;
  const commonMismatch = summary.schemaVersion !== detail.schemaVersion || summary.action !== detail.action
    || summary.connectionLabel !== detail.connectionLabel || summary.createdAt !== detail.createdAt
    || summary.state !== detail.state || summary.total !== detail.items.length;
  const writes = detail.schemaVersion === 1 ? detail.items : detail.items.flatMap(item => item.listingWrite === null ? [] : [item.listingWrite]);
  const reviews = detail.schemaVersion === 2 ? detail.items.flatMap(item => item.ownershipReview === null ? [] : [item.ownershipReview]) : [];
  const standalone = detail.action === reviewAction;
  if (commonMismatch
    || summary.applied !== (standalone ? reviews.filter(review => review.state === "confirmed" || review.state === "not_required").length
      : writes.filter(item => item.state === "applied").length)
    || summary.conflicts !== (standalone ? reviews.filter(review => review.state === "conflict").length : writes.filter(item => item.state === "conflict").length)
    || summary.pendingProvider !== (standalone ? reviews.filter(review => review.state === "pending_provider").length : writes.filter(item => item.state === "pending_provider").length)
    || summary.pendingVerification !== writes.filter(item => item.state === "pending_verification").length
    || (summary.schemaVersion === 2 && (summary.ownershipReviewTotal !== reviews.length
      || summary.ownershipReviewPending !== reviews.filter(review => !reviewTerminal.has(review.state)).length
      || summary.ownershipReviewConfirmed !== reviews.filter(review => review.state === "confirmed").length
      || summary.ownershipReviewNotRequired !== reviews.filter(review => review.state === "not_required").length
      || summary.ownershipReviewConflicts !== reviews.filter(review => review.state === "conflict").length))) {
    ctx.addIssue({ code: "custom", message: "Afternic listing detail disagrees with history" });
  }
});

export type AfternicListingPlanPreviewRequest = z.infer<typeof afternicListingPlanPreviewRequestSchema>;
export type AfternicListingPlanApproveRequest = z.infer<typeof afternicListingPlanApproveRequestSchema>;
export type AfternicListingPlanStatusRequest = z.infer<typeof afternicListingPlanStatusRequestSchema>;
export type AfternicListingPlan = z.infer<typeof afternicListingPlanSchema>;
export type AfternicListingPlanItem = z.infer<typeof afternicListingPlanItemSchema>;
export type AfternicListingPlanStatus = z.infer<typeof afternicListingPlanStatusSchema>;
export interface AfternicListingPlanPort {
  preview(request: AfternicListingPlanPreviewRequest): Promise<AfternicListingPlan>;
  approve(request: AfternicListingPlanApproveRequest): Promise<AfternicListingPlan>;
  status(request: AfternicListingPlanStatusRequest): Promise<AfternicListingPlanStatus>;
}
export function parseAfternicListingPlan(value: unknown): AfternicListingPlan {
  const parsed = afternicListingPlanSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Afternic listing plan");
  return parsed.data;
}
export function parseAfternicListingPlanStatus(value: unknown): AfternicListingPlanStatus {
  const parsed = afternicListingPlanStatusSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Afternic listing plan status");
  return parsed.data;
}
