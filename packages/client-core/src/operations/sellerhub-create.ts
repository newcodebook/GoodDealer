import { z } from "zod";
import { canonicalUtcTimestamp } from "@gooddealer/protocol/wire";
import { canonicalDomainNameSchema, copyPlainData } from "../portfolio/index";
import { sellerHubBinPriceApproveSchema, sellerHubBinPriceApprovalSchema, sellerHubBinPricePreviewSchema, sellerHubBinPriceStatusRequestSchema } from "./sellerhub-bin-price";

export const sellerHubCreateRequestSchema = sellerHubBinPricePreviewSchema;
export const sellerHubCreateApproveSchema = sellerHubBinPriceApproveSchema;
export const sellerHubCreateStatusRequestSchema = sellerHubBinPriceStatusRequestSchema;

const reference = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const phase = z.enum(["awaiting_approval", "expired", "executing", "completed"]);
const terms = z.object({
  domain: canonicalDomainNameSchema,
  priceCents: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("USD"),
  binPriceEnabled: z.literal(true),
  minPriceEnabled: z.literal(false),
}).strict();
const preview = z.object({
  schemaVersion: z.literal(1),
  planId: reference,
  connectionId: reference,
  planHash: z.string().regex(/^[0-9a-f]{64}$/u),
  expiresAt: canonicalUtcTimestamp,
  items: z.array(terms).min(1).max(500),
}).strict().refine(({items}) => items.every((item, index) => index === 0 || items[index - 1]!.domain < item.domain));

const itemStatus = z.object({
  domain: canonicalDomainNameSchema,
  state: z.enum(["planned", "queued", "reconciling", "ownership_pending", "unconfirmed", "published", "not_sent"]),
}).strict();
const detail = z.object({
  preview,
  phase,
  items: z.array(itemStatus).min(1).max(500),
}).strict().refine(plan => {
  if (plan.items.length !== plan.preview.items.length) return false;
  const planned = plan.phase === "awaiting_approval" || plan.phase === "expired";
  const finished = plan.items.every(item => item.state === "published" || item.state === "not_sent");
  return (plan.phase === "completed") === finished && plan.items.every((item, index) =>
    item.domain === plan.preview.items[index]!.domain && (item.state === "planned") === planned);
});
const summary = z.object({ planId: reference, phase, count: z.number().int().min(1).max(500) }).strict();
const status = z.object({
  schemaVersion: z.literal(1),
  writeQualified: z.boolean(),
  writeEntitled: z.boolean(),
  executionAvailable: z.boolean(),
  recent: z.array(summary).max(20),
  plan: detail.nullable(),
}).strict().refine(view => {
  const selected = view.recent.find(plan => plan.planId === view.plan?.preview.planId);
  return (!view.executionAvailable || (view.writeQualified && view.writeEntitled))
    && new Set(view.recent.map(plan => plan.planId)).size === view.recent.length
    && (!selected || (selected.phase === view.plan?.phase && selected.count === view.plan.items.length));
});

export type SellerHubCreatePreview = z.infer<typeof preview>;
export type SellerHubCreateDetail = z.infer<typeof detail>;
export type SellerHubCreateStatus = z.infer<typeof status>;
export interface SellerHubCreatePort {
  preview(request: z.infer<typeof sellerHubCreateRequestSchema>): Promise<SellerHubCreatePreview>;
  approve(request: z.infer<typeof sellerHubCreateApproveSchema>): Promise<z.infer<typeof sellerHubBinPriceApprovalSchema>>;
  status(request: z.infer<typeof sellerHubCreateStatusRequestSchema>): Promise<SellerHubCreateStatus>;
}
export const parseSellerHubCreatePreview = (value: unknown) => preview.parse(copyPlainData(value));
export const parseSellerHubCreateStatus = (value: unknown) => status.parse(copyPlainData(value));
