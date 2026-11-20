import {
  sellerHubCreateListingAuditPayloadSchema,
  sellerHubCreateListingClaimPayloadSchema,
} from "./sellerhub-create-listing-evidence";
import { atomStandardDelistAuditPayloadSchema, atomStandardDelistClaimPayloadSchema } from "./atom-standard-delist-evidence";
import { sellerHubBinPriceAuditPayloadSchema, sellerHubBinPriceClaimPayloadSchema } from "./sellerhub-bin-price-evidence";
import { afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema, afternicListingPlanReconciledAuditPayloadSchema,
  afternicListingPlanPreflightRefusedAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema } from "./afternic-listing-plan-evidence";
import { afternicListingWriteApprovalAuditPayloadSchema, afternicListingWriteClaimAuditPayloadSchema, afternicListingWriteReconciledAuditPayloadSchema, afternicListingWritePreflightRefusedAuditPayloadSchema, afternicListingWriteClaimPayloadSchema } from "./afternic-listing-write-evidence";
import { z } from "zod";
import { canonicalUtcTimestamp, identifier, safePositiveInteger } from "../wire/index";
import { workspaceDeviceAuditIngestSchema } from "./device-audit";
import { executionFactTransportSchema } from "./execution-fact";
import {
  afternicDelistApprovalAuditPayloadSchema,
  afternicDelistClaimAuditPayloadSchema,
  afternicDelistReconciledAuditPayloadSchema,
  afternicDelistPreflightRefusedAuditPayloadSchema,
  afternicDelistClaimPayloadSchema,
} from "./afternic-delist-evidence";
const digest = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const eventId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
export const executionEvidenceReceiptQuerySchema = z
  .object({
    activeLeaseEpoch: safePositiveInteger,
    sequence: safePositiveInteger,
    eventId,
    envelopeDigest: digest,
  })
  .strict();
const identity = {
  schemaVersion: z.literal(1),
  stream: z.enum(["device_audit", "execution_fact"]),
  workspaceId: identifier,
  sourceDeviceId: identifier,
  ...executionEvidenceReceiptQuerySchema.shape,
  receivedAt: canonicalUtcTimestamp,
};
export const executionEvidenceAcceptedReceiptSchema = z
  .object({ ...identity, outcome: z.literal("accepted"), classification: z.enum(["current", "late"]) })
  .strict();
export const executionEvidenceQuarantineReasonSchema = z.enum([
  "signature",
  "epoch_unknown",
  "time_unprovable",
  "authorization",
  "sequence_replay",
  "drain_seal_violation",
  "removal_boundary",
  "audit_chain",
]);
export const executionEvidenceQuarantinedReceiptSchema = z
  .object({ ...identity, outcome: z.literal("quarantined"), reason: executionEvidenceQuarantineReasonSchema })
  .strict();
export const executionEvidenceReceiptSchema = z.discriminatedUnion("outcome", [
  executionEvidenceAcceptedReceiptSchema,
  executionEvidenceQuarantinedReceiptSchema,
]);
export const executionEvidenceIngestResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      schemaVersion: z.literal(1),
      outcome: z.literal("accepted"),
      receipt: executionEvidenceAcceptedReceiptSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      outcome: z.literal("quarantined"),
      receipt: executionEvidenceQuarantinedReceiptSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      outcome: z.literal("pending"),
      code: z.enum([
        "PREDECESSOR_MISSING",
        "PAIRED_AUDIT_MISSING",
        "APPROVAL_AUDIT_MISSING",
        "ORIGINAL_FACT_MISSING",
      ]),
    })
    .strict(),
]);
import { afternicListingPlanClaimPayloadSchema, afternicOwnershipReviewClaimPayloadSchema } from "./afternic-listing-plan-evidence";
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/u);
export const executionFactIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    fact: executionFactTransportSchema.superRefine((fact, ctx) => {
      for (const field of [
        "executionFactId",
        "operationId",
        "operationItemId",
        "workflowNodeId",
        "attemptId",
        "approvedOperationId",
        "auditEventRef",
      ] as const)
        if (!eventId.safeParse(fact[field]).success)
          ctx.addIssue({ code: "custom", path: [field], message: "expected opaque business UUID" });
      if (
        fact.eventType !== (fact.payloadRedacted.action === "remove_standard" ? "atom_standard_delist_dispatch_claimed"
          : fact.payloadRedacted.action === "create_listing" ? "sellerhub_create_listing_dispatch_claimed"
          : fact.payloadRedacted.action === "set_bin_price" ? "sellerhub_bin_price_dispatch_claimed"
          : fact.payloadRedacted.action === "remove" ? "afternic_delist_dispatch_claimed"
          : fact.payloadRedacted.action === "reactivate_ownership_review" ? "afternic_ownership_review_dispatch_claimed"
            : fact.payloadRedacted.schemaVersion === 2 ? "afternic_listing_plan_v2_dispatch_claimed" : "afternic_listing_write_dispatch_claimed") ||
        fact.evidenceLevel !== "durable_local_claim" ||
        fact.attemptNo !== 1 ||
        fact.signatureTranscriptVersion !== 1 ||
        !signature.safeParse(fact.deviceSignature).success ||
        !digest.safeParse(fact.trustedTimeAnchorId).success ||
        !z.union([afternicDelistClaimPayloadSchema,afternicListingWriteClaimPayloadSchema,afternicListingPlanClaimPayloadSchema,afternicOwnershipReviewClaimPayloadSchema,sellerHubBinPriceClaimPayloadSchema, sellerHubCreateListingClaimPayloadSchema, atomStandardDelistClaimPayloadSchema]).safeParse(fact.payloadRedacted).success
      )
        ctx.addIssue({ code: "custom", message: "unsupported execution evidence" });
    }),
  })
  .strict();
export const deviceAuditIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    event: workspaceDeviceAuditIngestSchema.superRefine((event, ctx) => {
      const payload = z
        .union([
          afternicDelistApprovalAuditPayloadSchema,
          afternicDelistClaimAuditPayloadSchema,
          afternicDelistReconciledAuditPayloadSchema,
          afternicDelistPreflightRefusedAuditPayloadSchema,
          afternicListingWriteApprovalAuditPayloadSchema,afternicListingWriteClaimAuditPayloadSchema,afternicListingWriteReconciledAuditPayloadSchema,afternicListingWritePreflightRefusedAuditPayloadSchema, afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema, afternicListingPlanReconciledAuditPayloadSchema,
  afternicListingPlanPreflightRefusedAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema, sellerHubBinPriceAuditPayloadSchema, sellerHubCreateListingAuditPayloadSchema, atomStandardDelistAuditPayloadSchema,
        ])
        .safeParse(event.payloadRedacted);
      if (
        event.scopeKind !== "workspace" ||
        !eventId.safeParse(event.auditEventId).success ||
        !eventId.safeParse(event.targetRef).success ||
        event.signatureTranscriptVersion !== 1 ||
        !signature.safeParse(event.deviceSignature).success ||
        !digest.safeParse(event.trustedTimeAnchorId).success ||
        !payload.success
      )
        ctx.addIssue({ code: "custom", message: "unsupported workspace execution audit" });
      if (payload.success && (payload.data.action === "set_bin_price"
        || payload.data.action === "remove_standard" || payload.data.action === "create_listing")) {
        const p = payload.data;
        const approval = p.stage === "approved";
        const dispatch = p.stage === "dispatch_claimed";
        const targetFamily = p.action === "remove_standard" ? "atom_standard_delist"
          : p.action === "set_bin_price" ? "sellerhub_bin_price" : "sellerhub_create_listing";
        const target = `${targetFamily}_${approval ? "approval" : "attempt"}`;
        if (event.targetType !== target
          || event.targetRef !== (approval ? p.approvedOperationId : p.attemptId)
          || event.actorKind !== (approval ? "user" : "device_service")
          || event.authorizationSource !== (approval || dispatch ? "approved_operation" : "runtime_security_context")
          || event.eventType !== (approval || dispatch ? "approved_operation_execution" : "runtime_security_lifecycle")) {
          ctx.addIssue({ code: "custom", message: "unsupported marketplace audit purpose" });
        }
        return;
      }
      if ([
        "sellerhub_bin_price_approval", "sellerhub_bin_price_attempt",
        "sellerhub_create_listing_approval", "sellerhub_create_listing_attempt",
        "atom_standard_delist_approval", "atom_standard_delist_attempt",
      ].includes(event.targetType)) {
        ctx.addIssue({ code: "custom", message: "marketplace audit requires its bound payload" });
      }
      if (payload.success && payload.data.schemaVersion !== 2 && payload.data.action !== "reactivate_ownership_review"
        && ["afternic_listing_plan_v2_approval", "afternic_listing_plan_v2_attempt", "afternic_ownership_review_attempt"].includes(event.targetType)) {
        ctx.addIssue({ code: "custom", message: "listing plan purpose requires its matching payload version" });
      }
      if (payload.success && (payload.data.schemaVersion === 2 || payload.data.action === "reactivate_ownership_review")) {
        const p = payload.data;
        const approved = p.stage === "approved";
        const claim = p.stage === "dispatch_claimed";
        const target = approved ? "afternic_listing_plan_v2_approval"
          : p.action === "reactivate_ownership_review" ? "afternic_ownership_review_attempt" : "afternic_listing_plan_v2_attempt";
        if (event.targetType !== target || event.targetRef !== (approved ? p.approvedOperationId : p.attemptId)
          || event.actorKind !== (approved ? "user" : "device_service")
          || event.authorizationSource !== (approved || claim ? "approved_operation" : "runtime_security_context")
          || event.eventType !== (approved || claim ? "approved_operation_execution" : "runtime_security_lifecycle")) {
          ctx.addIssue({ code: "custom", message: "unsupported listing plan audit purpose" });
        }
      }
    }),
  })
  .strict();
export const executionEvidenceReceiptsRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(executionEvidenceReceiptQuerySchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of value.entries.entries()) {
      const key = JSON.stringify(entry);
      if (seen.has(key))
        ctx.addIssue({ code: "custom", path: ["entries", index], message: "receipt query is duplicated" });
      seen.add(key);
    }
  });
export const executionEvidenceReceiptsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    results: z
      .array(
        z
          .object({
            query: executionEvidenceReceiptQuerySchema,
            receipt: executionEvidenceReceiptSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [i, { query, receipt }] of value.results.entries())
      if (
        receipt !== null &&
        (query.activeLeaseEpoch !== receipt.activeLeaseEpoch ||
          query.sequence !== receipt.sequence ||
          query.eventId !== receipt.eventId ||
          query.envelopeDigest !== receipt.envelopeDigest)
      )
        ctx.addIssue({ code: "custom", path: ["results", i], message: "receipt must match its exact query" });
  });
export type ExecutionEvidenceReceipt = z.infer<typeof executionEvidenceReceiptSchema>;
export type ExecutionEvidenceAcceptedReceipt = z.infer<typeof executionEvidenceAcceptedReceiptSchema>;
export type ExecutionEvidenceQuarantineReason = z.infer<typeof executionEvidenceQuarantineReasonSchema>;
export type ExecutionEvidenceIngestResponse = z.infer<typeof executionEvidenceIngestResponseSchema>;
export type ExecutionEvidenceReceiptsRequest = z.infer<typeof executionEvidenceReceiptsRequestSchema>;
export type ExecutionEvidenceReceiptsResponse = z.infer<typeof executionEvidenceReceiptsResponseSchema>;
