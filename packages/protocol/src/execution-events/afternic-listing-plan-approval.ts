import { decodeClosedItemApprovalJson, maximumApprovalBytes } from "./closed-item-approval-json";
import { z } from "zod";
import {
  canonicalUtcTimestamp, encodeDomainSeparatedWireValue, identifier,
  safePositiveInteger, safeUnsignedInteger,
} from "../wire/index";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const digest = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/u);
const action = z.enum(["create", "update", "reactivate_ownership_review"]);
const targetFields = {
  operationItemId: uuid,
  action,
  requestDigest: digest,
  parentItemId: uuid.nullable(),
  parentRequestDigest: digest.nullable(),
};

function parentPair(
  value: z.infer<typeof targetItemSchema>,
  ctx: z.RefinementCtx,
): void {
  if ((value.parentItemId === null) !== (value.parentRequestDigest === null)
    || (value.action !== "reactivate_ownership_review" && value.parentItemId !== null)
    || value.parentItemId === value.operationItemId) {
    ctx.addIssue({ code: "custom", path: ["parentItemId"], message: "invalid ownership review parent" });
  }
}
const targetItemSchema = z.object(targetFields).strict();

/** Opaque digests do not establish domain identity; the business owner also checks <=500 distinct domains. */
export const afternicListingPlanTargetSetSchema = z.object({
  schemaVersion: z.literal(2),
  planId: uuid,
  action: z.literal("listing_plan_v2"),
  items: z.array(targetItemSchema.superRefine(parentPair)).min(1).max(1000),
}).strict().superRefine((value, ctx) => {
  const items = new Map(value.items.map(item => [item.operationItemId, item]));
  const parents = new Set<string>();
  let roots = 0;
  for (const [index, item] of value.items.entries()) {
    if (index > 0 && value.items[index - 1]!.operationItemId >= item.operationItemId) {
      ctx.addIssue({ code: "custom", path: ["items", index, "operationItemId"], message: "target items must be strictly ordered and unique" });
    }
    if (item.parentItemId === null) { roots++; continue; }
    const parent = items.get(item.parentItemId);
    if (parent === undefined || parent.action === "reactivate_ownership_review"
      || parent.requestDigest !== item.parentRequestDigest || parents.has(item.parentItemId)) {
      ctx.addIssue({ code: "custom", path: ["items", index, "parentItemId"], message: "ownership review requires one exact parent in this target set" });
    }
    parents.add(item.parentItemId);
  }
  if (roots > 500) ctx.addIssue({ code: "custom", path: ["items"], message: "target set has too many independent targets" });
});

const approvalFields = {
  aud: z.literal("gooddealer-cloud/execution-evidence"),
  approvedOperationId: uuid,
  operationId: uuid,
  planId: uuid,
  planHash: digest,
  targetCount: z.number().int().min(1).max(1000),
  targetSetDigest: digest,
  ...targetFields,
  capability: z.literal("afternic:marketplace:write"),
  accountId: identifier,
  workspaceId: identifier,
  sourceDeviceId: identifier,
  activeLeaseEpoch: safePositiveInteger,
  credentialEpoch: safePositiveInteger,
  signingKeyId: identifier,
  signingKeyVersion: safePositiveInteger,
  authorizationHash: digest,
  trustedTimeAnchorId: digest,
  monotonicDeltaMs: safeUnsignedInteger,
  approvedAt: canonicalUtcTimestamp,
  signatureTranscriptVersion: z.literal(1),
  deviceSignature: signature,
};

export const afternicListingPlanItemApprovalSchema = z.object({
  schemaVersion: z.literal(2),
  typ: z.literal("gd.afternic-listing-plan-item-approval.v2"),
  ...approvalFields,
  action: z.enum(["create", "update"]),
  parentItemId: z.null(),
  parentRequestDigest: z.null(),
}).strict();

export const afternicOwnershipReviewItemApprovalSchema = z.object({
  schemaVersion: z.literal(1),
  typ: z.literal("gd.afternic-ownership-review-item-approval.v1"),
  ...approvalFields,
  action: z.literal("reactivate_ownership_review"),
}).strict().superRefine(parentPair);

export function encodeAfternicListingPlanTargetSetDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue("GOODDEALER-AFTERNIC-LISTING-PLAN-TARGET-SET-V2", afternicListingPlanTargetSetSchema.parse(value));
}
export function encodeAfternicListingPlanItemApprovalSignatureTranscript(value: unknown): Uint8Array {
  const { deviceSignature: _signature, ...claims } = afternicListingPlanItemApprovalSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-V2", claims);
}
export function encodeAfternicListingPlanItemApprovalEnvelope(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue("GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-ENVELOPE-V2", afternicListingPlanItemApprovalSchema.parse(value));
}
export function encodeAfternicOwnershipReviewItemApprovalSignatureTranscript(value: unknown): Uint8Array {
  const { deviceSignature: _signature, ...claims } = afternicOwnershipReviewItemApprovalSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-V1", claims);
}
export function encodeAfternicOwnershipReviewItemApprovalEnvelope(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue("GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-ENVELOPE-V1", afternicOwnershipReviewItemApprovalSchema.parse(value));
}

function encodeApprovalJson(value: AfternicListingPlanItemApproval | AfternicOwnershipReviewItemApproval): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > maximumApprovalBytes) throw new TypeError("item approval is too large");
  return bytes;
}
export function encodeAfternicListingPlanItemApprovalJson(value: unknown): Uint8Array {
  return encodeApprovalJson(afternicListingPlanItemApprovalSchema.parse(value));
}
export function decodeAfternicListingPlanItemApprovalJson(bytes: Uint8Array): AfternicListingPlanItemApproval {
  return afternicListingPlanItemApprovalSchema.parse(decodeClosedItemApprovalJson(bytes));
}
export function encodeAfternicOwnershipReviewItemApprovalJson(value: unknown): Uint8Array {
  return encodeApprovalJson(afternicOwnershipReviewItemApprovalSchema.parse(value));
}
export function decodeAfternicOwnershipReviewItemApprovalJson(bytes: Uint8Array): AfternicOwnershipReviewItemApproval {
  return afternicOwnershipReviewItemApprovalSchema.parse(decodeClosedItemApprovalJson(bytes));
}

export type AfternicListingPlanTargetSet = z.infer<typeof afternicListingPlanTargetSetSchema>;
export type AfternicListingPlanItemApproval = z.infer<typeof afternicListingPlanItemApprovalSchema>;
export type AfternicOwnershipReviewItemApproval = z.infer<typeof afternicOwnershipReviewItemApprovalSchema>;
