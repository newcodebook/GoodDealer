import { z } from "zod";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { canonicalDomainNameSchema, copyPlainData } from "../portfolio/index";
import { afternicControlledAcceptanceSchema } from "../connections/index";
import { connectionLabelSchema } from "../connections/connection-label";

const referenceSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const countSchema = z.number().int().min(0).max(500);
const priceSchema = z.number().int().min(0).max(49_999_999_000_000).multipleOf(1_000_000);
export const afternicDelistProviderStatusSchema = z.enum([
  "PENDING", "FAILED_COMPLIANCE", "ACTIVE", "HIDDEN", "ON_HOLD", "SOLD", "INACTIVE",
  "OWNERSHIP_REVIEW", "OWNERSHIP_UNVERIFIED", "VERIFIED_OWNER_CONFLICT",
  "INVENTORY_COMPLIANCE_ISSUE", "TLD_UNSUPPORTED", "UNREGISTERED_DOMAIN", "UNKNOWN",
]);
export const afternicDelistPlanStateSchema = z.enum([
  "awaiting_approval", "expired", "executing", "completed", "partially_failed",
]);
export const afternicDelistPreviewRequestSchema = z.object({
  schemaVersion: z.literal(1), connectionId: referenceSchema,
  domains: z.array(canonicalDomainNameSchema).min(1).max(500),
}).strict().refine((request) => new Set(request.domains).size === request.domains.length);
export const afternicDelistApproveRequestSchema = z.object({
  schemaVersion: z.literal(1), planRef: referenceSchema, planHash: hashSchema,
}).strict();
export const afternicDelistStatusRequestSchema = z.object({
  schemaVersion: z.literal(1), planRef: referenceSchema.nullable(),
}).strict();

const itemSchema = z.object({
  domain: canonicalDomainNameSchema,
  providerStatus: afternicDelistProviderStatusSchema,
  buynowPrice: priceSchema.nullable(), floorPrice: priceSchema.nullable(),
  minbidPrice: priceSchema.min(20_000_000).nullable(), hidden: z.boolean().nullable(),
  observedAt: canonicalUtcTimestamp,
  state: z.enum(["preview", "queued", "reconciling", "succeeded", "conflict"]),
  reason: z.enum(["precondition_changed", "connection_changed", "read_failed", "still_present"]).nullable(),
  retryAt: canonicalUtcTimestamp.nullable(),
}).strict().superRefine((item, context) => {
  const pending = item.state === "queued" || item.state === "reconciling";
  const validReason = item.state === "conflict"
    ? item.reason === "precondition_changed" || item.reason === "connection_changed"
    : pending
      ? item.reason === null || item.reason === "read_failed" || (item.state === "reconciling" && item.reason === "still_present")
      : item.reason === null;
  if (!validReason || (!pending && item.retryAt !== null)
    || ((item.reason === "read_failed" || item.reason === "still_present") && item.retryAt === null)) {
    context.addIssue({ code: "custom", message: "invalid delist result state" });
  }
});
export const afternicDelistPlanSchema = z.object({
  schemaVersion: z.literal(1), planRef: referenceSchema, planHash: hashSchema,
  connectionLabel: connectionLabelSchema,
  createdAt: canonicalUtcTimestamp, expiresAt: canonicalUtcTimestamp,
  approvedAt: canonicalUtcTimestamp.nullable(), state: afternicDelistPlanStateSchema,
  items: z.array(itemSchema).min(1).max(500),
}).strict().superRefine((plan, context) => {
  const pendingApproval = plan.state === "awaiting_approval" || plan.state === "expired";
  const pending = plan.items.some((item) => item.state === "queued" || item.state === "reconciling");
  const conflicts = plan.items.some((item) => item.state === "conflict");
  if (plan.expiresAt <= plan.createdAt || pendingApproval !== (plan.approvedAt === null)
    || (plan.approvedAt !== null && (plan.approvedAt < plan.createdAt || plan.approvedAt >= plan.expiresAt))
    || plan.items.some((item, index) => item.observedAt > plan.createdAt
      || (index > 0 && plan.items[index - 1]!.domain >= item.domain)
      || pendingApproval !== (item.state === "preview"))
    || (plan.state === "executing" && !pending)
    || (plan.state === "completed" && plan.items.some((item) => item.state !== "succeeded"))
    || (plan.state === "partially_failed" && (pending || !conflicts))) {
    context.addIssue({ code: "custom", message: "invalid delist plan facts" });
  }
});
const summarySchema = z.object({
  planRef: referenceSchema, connectionLabel: connectionLabelSchema,
  createdAt: canonicalUtcTimestamp, state: afternicDelistPlanStateSchema,
  total: countSchema.min(1), succeeded: countSchema, conflicts: countSchema, pending: countSchema,
}).strict().refine((summary) => summary.succeeded + summary.conflicts + summary.pending === summary.total
  && ((summary.state === "awaiting_approval" || summary.state === "expired")
    ? summary.pending === summary.total
    : summary.state === "executing"
      ? summary.pending > 0
      : summary.state === "completed"
        ? summary.succeeded === summary.total
        : summary.pending === 0 && summary.conflicts > 0));
export const afternicDelistStatusSchema = z.object({
  schemaVersion: z.literal(1), controlledAcceptance: afternicControlledAcceptanceSchema.nullable(),
  writeQualified: z.boolean(), writeEntitled: z.boolean(), executionAvailable: z.boolean(),
  plans: z.array(summarySchema).max(50), detail: afternicDelistPlanSchema.nullable(),
}).strict().superRefine((status, context) => {
  if (status.controlledAcceptance !== null && status.writeQualified)
    context.addIssue({ code: "custom", message: "controlled acceptance is not production qualification" });
  if (new Set(status.plans.map((plan) => plan.planRef)).size !== status.plans.length
    || status.plans.some((plan, index) => index > 0 && (
      status.plans[index - 1]!.createdAt < plan.createdAt
      || (status.plans[index - 1]!.createdAt === plan.createdAt && status.plans[index - 1]!.planRef < plan.planRef)
    ))) context.addIssue({ code: "custom", message: "invalid delist history order" });
  const detail = status.detail;
  const summary = detail === null ? undefined : status.plans.find((plan) => plan.planRef === detail.planRef);
  if (detail !== null && summary !== undefined && (
    summary.connectionLabel !== detail.connectionLabel || summary.createdAt !== detail.createdAt
    || summary.state !== detail.state || summary.total !== detail.items.length
    || summary.succeeded !== detail.items.filter((item) => item.state === "succeeded").length
    || summary.conflicts !== detail.items.filter((item) => item.state === "conflict").length
  )) context.addIssue({ code: "custom", message: "delist detail disagrees with history" });
});

export type AfternicDelistPreviewRequest = z.infer<typeof afternicDelistPreviewRequestSchema>;
export type AfternicDelistApproveRequest = z.infer<typeof afternicDelistApproveRequestSchema>;
export type AfternicDelistStatusRequest = z.infer<typeof afternicDelistStatusRequestSchema>;
export type AfternicDelistPlan = z.infer<typeof afternicDelistPlanSchema>;
export type AfternicDelistStatus = z.infer<typeof afternicDelistStatusSchema>;
export interface AfternicDelistPort {
  preview(request: AfternicDelistPreviewRequest): Promise<AfternicDelistPlan>;
  approve(request: AfternicDelistApproveRequest): Promise<AfternicDelistPlan>;
  status(request: AfternicDelistStatusRequest): Promise<AfternicDelistStatus>;
}
export function parseAfternicDelistPlan(value: unknown): AfternicDelistPlan {
  const parsed = afternicDelistPlanSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Afternic delist plan");
  return parsed.data;
}
export function parseAfternicDelistStatus(value: unknown): AfternicDelistStatus {
  const parsed = afternicDelistStatusSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Afternic delist status");
  return parsed.data;
}
