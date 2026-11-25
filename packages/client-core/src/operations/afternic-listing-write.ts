import { z } from "zod";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { canonicalDomainNameSchema, copyPlainData } from "../portfolio/index";
import { afternicControlledAcceptanceSchema } from "../connections/index";
import { connectionLabelSchema } from "../connections/connection-label";
import { afternicDelistProviderStatusSchema } from "./afternic-delist";

const reference = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const count = z.number().int().min(0).max(500);
const price = z.number().int().min(0).max(49_999_999_000_000).multipleOf(1_000_000);
export const afternicListingWriteActionSchema = z.enum(["create", "update"]);
export const afternicListingWriteValuesSchema = z.object({
  buynowPriceMicroUsd: price, floorPriceMicroUsd: price,
  minbidPriceMicroUsd: price.min(20_000_000), hidden: z.boolean(),
}).strict();
export const afternicListingWritePatchSchema = afternicListingWriteValuesSchema.partial().superRefine((patch, ctx) => {
  const keys = Object.keys(patch);
  if (keys.length === 0 || Object.values(patch).some(value => value === undefined))
    ctx.addIssue({ code: "custom", message: "patch requires explicit selected values" });
});
export const afternicListingWritePreviewRequestSchema = z.discriminatedUnion("action", [
  z.object({ schemaVersion: z.literal(1), connectionId: reference, action: z.literal("create"),
    items: z.array(z.object({ domain: canonicalDomainNameSchema, values: afternicListingWriteValuesSchema }).strict()).min(1).max(500) }).strict(),
  z.object({ schemaVersion: z.literal(1), connectionId: reference, action: z.literal("update"),
    items: z.array(z.object({ domain: canonicalDomainNameSchema, patch: afternicListingWritePatchSchema }).strict()).min(1).max(500) }).strict(),
]).refine(request => new Set(request.items.map(item => item.domain)).size === request.items.length);
export const afternicListingWriteApproveRequestSchema = z.object({ schemaVersion: z.literal(1), planRef: reference, planHash: hash }).strict();
export const afternicListingWriteStatusRequestSchema = z.object({ schemaVersion: z.literal(1), planRef: reference.nullable() }).strict();
export const afternicListingWritePlanStateSchema = z.enum(["awaiting_approval", "expired", "executing", "completed", "partially_failed"]);
export const afternicListingWriteItemStateSchema = z.enum(["preview", "queued", "reconciling", "pending_provider", "pending_verification", "applied", "conflict"]);
export const afternicListingWriteReasonSchema = z.enum(["precondition_changed", "connection_changed", "read_failed", "postcondition_pending", "already_present", "listing_absent", "provider_state_blocked"]);
export const afternicListingWriteObservedSchema = z.object({
  providerStatus: afternicDelistProviderStatusSchema,
  buynowPriceMicroUsd: price.nullable(), floorPriceMicroUsd: price.nullable(),
  minbidPriceMicroUsd: price.min(20_000_000).nullable(), hidden: z.boolean().nullable(), observedAt: canonicalUtcTimestamp,
}).strict();
const pendingStates = new Set(["queued", "reconciling", "pending_provider", "pending_verification"]);
const verificationStates = new Set(["OWNERSHIP_REVIEW", "OWNERSHIP_UNVERIFIED"]);
const providerStates = new Set(["PENDING", "INACTIVE", "UNKNOWN", "ON_HOLD", "ACTIVE", "HIDDEN"]);
const conflictReasons = new Set(["precondition_changed", "connection_changed", "already_present", "listing_absent", "provider_state_blocked"]);
export const afternicListingWriteItemSchema = z.object({
  domain: canonicalDomainNameSchema, before: afternicListingWriteObservedSchema.nullable(),
  changes: afternicListingWritePatchSchema, latest: afternicListingWriteObservedSchema.nullable(), fieldsMatched: z.boolean(),
  state: afternicListingWriteItemStateSchema, reason: afternicListingWriteReasonSchema.nullable(), retryAt: canonicalUtcTimestamp.nullable(),
}).strict().superRefine((item, ctx) => {
  const pending = pendingStates.has(item.state);
  const latest = item.latest;
  const matches = latest !== null && Object.entries(item.changes).every(([key, value]) => latest[key as keyof typeof item.changes] === value);
  if ((item.fieldsMatched && !matches)
    || (item.state === "applied" && (!item.fieldsMatched || latest === null || !["ACTIVE", "HIDDEN"].includes(latest.providerStatus)
      || (latest.providerStatus === "HIDDEN" && latest.hidden !== true)))
    || (item.state === "pending_verification" && (latest === null || !verificationStates.has(latest.providerStatus)))
    || (item.state === "pending_provider" && (latest === null || !providerStates.has(latest.providerStatus)))
    || (item.state === "preview" && item.fieldsMatched)
    || (!pending && item.retryAt !== null)
    || (item.state === "conflict" ? !conflictReasons.has(item.reason ?? "") : pending
      ? item.reason !== null && item.reason !== "read_failed" && item.reason !== "postcondition_pending"
      : item.reason !== null)
    || ((item.reason === "read_failed" || item.reason === "postcondition_pending") && item.retryAt === null))
    ctx.addIssue({ code: "custom", message: "invalid listing write item facts" });
});
export const afternicListingWritePlanSchema = z.object({
  schemaVersion: z.literal(1), planRef: reference, planHash: hash, action: afternicListingWriteActionSchema,
  connectionLabel: connectionLabelSchema, createdAt: canonicalUtcTimestamp, expiresAt: canonicalUtcTimestamp,
  approvedAt: canonicalUtcTimestamp.nullable(), state: afternicListingWritePlanStateSchema,
  items: z.array(afternicListingWriteItemSchema).min(1).max(500),
}).strict().superRefine((plan, ctx) => {
  const unapproved = plan.state === "awaiting_approval" || plan.state === "expired";
  const pending = plan.items.some(item => pendingStates.has(item.state));
  if (plan.expiresAt <= plan.createdAt || unapproved !== (plan.approvedAt === null)
    || (plan.approvedAt !== null && (plan.approvedAt < plan.createdAt || plan.approvedAt >= plan.expiresAt))
    || plan.items.some((item, index) => unapproved !== (item.state === "preview")
      || (index > 0 && plan.items[index - 1]!.domain >= item.domain)
      || (item.before !== null && item.before.observedAt > plan.createdAt)
      || (plan.action === "update" && item.before === null)
      || (plan.action === "create" && (!afternicListingWriteValuesSchema.safeParse(item.changes).success
        || (item.state === "applied" && item.changes.hidden === false && (item.latest?.providerStatus !== "ACTIVE" || item.latest.hidden !== false)))))
    || (plan.state === "executing" && !pending)
    || (plan.state === "completed" && plan.items.some(item => item.state !== "applied"))
    || (plan.state === "partially_failed" && (pending || !plan.items.some(item => item.state === "conflict"))))
    ctx.addIssue({ code: "custom", message: "invalid listing write plan facts" });
});
export const afternicListingWriteSummarySchema = z.object({
  planRef: reference, action: afternicListingWriteActionSchema, connectionLabel: connectionLabelSchema,
  createdAt: canonicalUtcTimestamp, state: afternicListingWritePlanStateSchema,
  total: count.min(1), applied: count, conflicts: count, pending: count, pendingProvider: count, pendingVerification: count,
}).strict().refine(summary => summary.applied + summary.conflicts + summary.pending === summary.total
  && summary.pendingProvider + summary.pendingVerification <= summary.pending
  && ((summary.state === "awaiting_approval" || summary.state === "expired")
    ? summary.pending === summary.total && summary.pendingProvider === 0 && summary.pendingVerification === 0
    : summary.state === "executing" ? summary.pending > 0
      : summary.state === "completed" ? summary.applied === summary.total : summary.pending === 0 && summary.conflicts > 0));
export const afternicListingWriteStatusSchema = z.object({
  schemaVersion: z.literal(1), controlledAcceptance: afternicControlledAcceptanceSchema.nullable(),
  writeQualified: z.boolean(), writeEntitled: z.boolean(), executionAvailable: z.boolean(),
  plans: z.array(afternicListingWriteSummarySchema).max(50), detail: afternicListingWritePlanSchema.nullable(),
}).strict().superRefine((status, ctx) => {
  if (status.controlledAcceptance !== null && status.writeQualified)
    ctx.addIssue({ code: "custom", message: "controlled acceptance is not production qualification" });
  if (new Set(status.plans.map(plan => plan.planRef)).size !== status.plans.length
    || status.plans.some((plan, index) => index > 0 && (status.plans[index - 1]!.createdAt < plan.createdAt
      || (status.plans[index - 1]!.createdAt === plan.createdAt && status.plans[index - 1]!.planRef < plan.planRef))))
    ctx.addIssue({ code: "custom", message: "invalid listing write history order" });
  const detail = status.detail;
  const summary = detail === null ? undefined : status.plans.find(plan => plan.planRef === detail.planRef);
  if (detail !== null && summary !== undefined && (summary.action !== detail.action || summary.connectionLabel !== detail.connectionLabel
    || summary.createdAt !== detail.createdAt || summary.state !== detail.state || summary.total !== detail.items.length
    || summary.applied !== detail.items.filter(item => item.state === "applied").length
    || summary.conflicts !== detail.items.filter(item => item.state === "conflict").length
    || summary.pendingProvider !== detail.items.filter(item => item.state === "pending_provider").length
    || summary.pendingVerification !== detail.items.filter(item => item.state === "pending_verification").length))
    ctx.addIssue({ code: "custom", message: "listing write detail disagrees with history" });
});
export type AfternicListingWriteAction = z.infer<typeof afternicListingWriteActionSchema>;
export type AfternicListingWriteValues = z.infer<typeof afternicListingWriteValuesSchema>;
export type AfternicListingWritePatch = z.infer<typeof afternicListingWritePatchSchema>;
export type AfternicListingWritePreviewRequest = z.infer<typeof afternicListingWritePreviewRequestSchema>;
export type AfternicListingWriteApproveRequest = z.infer<typeof afternicListingWriteApproveRequestSchema>;
export type AfternicListingWriteStatusRequest = z.infer<typeof afternicListingWriteStatusRequestSchema>;
export type AfternicListingWritePlan = z.infer<typeof afternicListingWritePlanSchema>;
export type AfternicListingWriteStatus = z.infer<typeof afternicListingWriteStatusSchema>;
export type AfternicListingWriteItem = z.infer<typeof afternicListingWriteItemSchema>;
export type AfternicListingWriteObserved = z.infer<typeof afternicListingWriteObservedSchema>;
export type AfternicListingWriteSummary = z.infer<typeof afternicListingWriteSummarySchema>;
export interface AfternicListingWritePort {
  preview(request: AfternicListingWritePreviewRequest): Promise<AfternicListingWritePlan>;
  approve(request: AfternicListingWriteApproveRequest): Promise<AfternicListingWritePlan>;
  status(request: AfternicListingWriteStatusRequest): Promise<AfternicListingWriteStatus>;
}
export function parseAfternicListingWritePlan(value: unknown): AfternicListingWritePlan {
  const parsed = afternicListingWritePlanSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Afternic listing write plan");
  return parsed.data;
}
export function parseAfternicListingWriteStatus(value: unknown): AfternicListingWriteStatus {
  const parsed = afternicListingWriteStatusSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid Afternic listing write status");
  return parsed.data;
}
