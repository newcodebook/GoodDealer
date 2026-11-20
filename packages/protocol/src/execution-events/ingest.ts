import { afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema, afternicListingPlanReconciledAuditPayloadSchema,
  afternicListingPlanPreflightRefusedAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema } from "./afternic-listing-plan-evidence";
import { afternicListingWriteApprovalAuditPayloadSchema, afternicListingWriteClaimAuditPayloadSchema, afternicListingWriteReconciledAuditPayloadSchema, afternicListingWritePreflightRefusedAuditPayloadSchema, afternicListingWriteClaimPayloadSchema } from "./afternic-listing-write-evidence";
import { z } from "zod";
import { canonicalUtcTimestamp, identifier, safePositiveInteger } from "../wire/index";
import { afternicWorkspaceDeviceAuditIngestSchema } from "./device-audit";
import { afternicExecutionFactIngestSchema } from "./execution-fact";
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
    fact: afternicExecutionFactIngestSchema.superRefine((fact, ctx) => {
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
        fact.eventType !== (fact.payloadRedacted.action === "remove" ? "afternic_delist_dispatch_claimed"
          : fact.payloadRedacted.action === "reactivate_ownership_review" ? "afternic_ownership_review_dispatch_claimed"
            : fact.payloadRedacted.schemaVersion === 2 ? "afternic_listing_plan_v2_dispatch_claimed" : "afternic_listing_write_dispatch_claimed") ||
        fact.evidenceLevel !== "durable_local_claim" ||
        fact.attemptNo !== 1 ||
        fact.signatureTranscriptVersion !== 1 ||
        !signature.safeParse(fact.deviceSignature).success ||
        !digest.safeParse(fact.trustedTimeAnchorId).success ||
        !z.union([afternicDelistClaimPayloadSchema,afternicListingWriteClaimPayloadSchema,afternicListingPlanClaimPayloadSchema,afternicOwnershipReviewClaimPayloadSchema]).safeParse(fact.payloadRedacted).success
      )
        ctx.addIssue({ code: "custom", message: "unsupported execution evidence" });
    }),
  })
  .strict();
export const deviceAuditIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    event: afternicWorkspaceDeviceAuditIngestSchema.superRefine((event, ctx) => {
      const payload = z
        .union([
          afternicDelistApprovalAuditPayloadSchema,
          afternicDelistClaimAuditPayloadSchema,
          afternicDelistReconciledAuditPayloadSchema,
          afternicDelistPreflightRefusedAuditPayloadSchema,
          afternicListingWriteApprovalAuditPayloadSchema,afternicListingWriteClaimAuditPayloadSchema,afternicListingWriteReconciledAuditPayloadSchema,afternicListingWritePreflightRefusedAuditPayloadSchema, afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema, afternicListingPlanReconciledAuditPayloadSchema,
  afternicListingPlanPreflightRefusedAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema,
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
