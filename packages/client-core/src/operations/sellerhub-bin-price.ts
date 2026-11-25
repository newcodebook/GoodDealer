import { z } from "zod";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { connectionLabelSchema } from "../connections/connection-label";
import { canonicalDomainNameSchema, copyPlainData } from "../portfolio/index";

const reference = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const cents = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const target = z.object({ domain: canonicalDomainNameSchema, priceCents: cents }).strict();
const planState = z.enum(["awaiting_approval", "expired", "executing", "completed", "partially_failed"]);

export const sellerHubBinPricePreviewSchema = z.object({
  schemaVersion: z.literal(1), connectionId: reference, items: z.array(target).min(1).max(500),
}).strict().refine(({ items }) => new Set(items.map(item => item.domain)).size === items.length);
export const sellerHubBinPriceApproveSchema = z.object({ schemaVersion: z.literal(1), planId: reference, planHash: hash }).strict();
export const sellerHubBinPriceStatusRequestSchema = z.object({ schemaVersion: z.literal(1), planId: reference.nullable() }).strict();

const planItem = target.extend({
  previousPriceCents: cents,
  state: z.enum(["preview", "queued", "reconciling", "changed", "refused"]),
  reason: z.enum(["precondition_changed", "connection_changed", "provider_state_blocked"]).nullable(),
  retryAt: canonicalUtcTimestamp.nullable(),
}).refine(item => item.previousPriceCents !== item.priceCents
  && ((item.state === "refused") === (item.reason !== null))
  && (item.retryAt === null || item.state === "queued" || item.state === "reconciling"));

export const sellerHubBinPricePlanSchema = z.object({
  schemaVersion: z.literal(1), planId: reference, connectionId: reference, connectionLabel: connectionLabelSchema,
  state: planState, planHash: hash, expiresAt: canonicalUtcTimestamp, items: z.array(planItem).min(1).max(500),
}).strict().refine(({ state, items }) => {
  const isPreview = state === "awaiting_approval" || state === "expired";
  const pending = items.some(item => item.state === "queued" || item.state === "reconciling");
  return items.every((item, index) => (item.state === "preview") === isPreview
      && (index === 0 || items[index - 1]!.domain < item.domain))
    && (state === "executing") === pending
    && (isPreview || pending || (state === "partially_failed") === items.some(item => item.state === "refused"));
});

export const sellerHubBinPriceApprovalSchema = z.object({ schemaVersion: z.literal(1), operationId: reference }).strict();

const planSummary = z.object({
  planId: reference, state: planState, connectionLabel: connectionLabelSchema, createdAt: canonicalUtcTimestamp,
}).strict();
export const sellerHubBinPriceStatusSchema = z.object({
  schemaVersion: z.literal(1), writeQualified: z.boolean(), writeEntitled: z.boolean(),
  executionAvailable: z.boolean(), recent: z.array(planSummary).max(20), plan: sellerHubBinPricePlanSchema.nullable(),
}).strict().refine(({ executionAvailable, writeQualified, writeEntitled, recent, plan }) => {
  const summary = recent.find(item => item.planId === plan?.planId);
  return (!executionAvailable || (writeQualified && writeEntitled))
    && new Set(recent.map(item => item.planId)).size === recent.length
    && (summary === undefined || (plan?.state === summary.state && plan.connectionLabel === summary.connectionLabel));
});

export type SellerHubBinPricePreview = z.infer<typeof sellerHubBinPricePreviewSchema>;
export type SellerHubBinPricePlan = z.infer<typeof sellerHubBinPricePlanSchema>;
export type SellerHubBinPriceStatus = z.infer<typeof sellerHubBinPriceStatusSchema>;
export interface SellerHubBinPricePort {
  preview(request: SellerHubBinPricePreview): Promise<SellerHubBinPricePlan>;
  approve(request: z.infer<typeof sellerHubBinPriceApproveSchema>): Promise<z.infer<typeof sellerHubBinPriceApprovalSchema>>;
  status(request: z.infer<typeof sellerHubBinPriceStatusRequestSchema>): Promise<SellerHubBinPriceStatus>;
}

export const parseSellerHubBinPricePlan = (value: unknown) => sellerHubBinPricePlanSchema.parse(copyPlainData(value));
export const parseSellerHubBinPriceApproval = (value: unknown) => sellerHubBinPriceApprovalSchema.parse(copyPlainData(value));
export const parseSellerHubBinPriceStatus = (value: unknown) => sellerHubBinPriceStatusSchema.parse(copyPlainData(value));
