import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  deviceAuditEventSchema,
  encodeDeviceAuditEventHashInput,
  encodeDeviceAuditEventSignatureTranscript,
  encodeDrainStreamEnvelope,
  encodeExecutionFactSignatureTranscript,
  executionFactSchema,
  sellerHubCreateListingApprovalAuditPayloadSchema,
  sellerHubCreateListingClaimAuditPayloadSchema,
  sellerHubCreateListingClaimPayloadSchema,
  sellerHubCreateListingPreflightRefusedAuditPayloadSchema,
  sellerHubCreateListingReconciledAuditPayloadSchema,
  encodeSellerHubCreateListingItemApprovalEnvelope,
  encodeSellerHubCreateListingItemApprovalSignatureTranscript,
  encodeSellerHubCreateListingTargetSetDigestInput,
  sellerHubCreateListingItemApprovalSchema,
} from "../src/execution-events/index.ts";
import { encodeDomainSeparatedWireValue } from "../src/wire/index.ts";

// Fixed synthetic device material, shared with the Rust signature fixtures.
const deviceKey = createPrivateKey({
  format: "der",
  type: "pkcs8",
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 85)]),
});
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64url");
const afternic = JSON.parse(readFileSync("test-vectors/afternic-execution-evidence/valid.json", "utf8"));
const base = afternic.approval;
const action = "create_listing";
const requestDigest = digest(Buffer.from("fixture SellerHub creation request"));
const targetSet = {
  schemaVersion: 1,
  planId: base.planId,
  action,
  items: [{ operationItemId: base.operationItemId, requestDigest }],
};
const approval = sellerHubCreateListingItemApprovalSchema.parse({
  ...base,
  typ: "gd.sellerhub-create-listing-item-approval.v1",
  capability: "spaceship:marketplace:write",
  action,
  requestDigest,
  planHash: digest(Buffer.from("fixture SellerHub creation plan")),
  targetCount: 1,
  targetSetDigest: digest(encodeSellerHubCreateListingTargetSetDigestInput(targetSet)),
});
const transcript = encodeSellerHubCreateListingItemApprovalSignatureTranscript(approval);
approval.deviceSignature = sign(null, transcript, deviceKey).toString("base64url");
const output = {
  generatedBy: "scripts/generate-sellerhub-create-listing-vectors.ts",
  approval,
  targetSet,
  approvalTranscript: Buffer.from(transcript).toString("hex"),
  approvalEnvelopeDigest: digest(encodeSellerHubCreateListingItemApprovalEnvelope(approval)),
};
mkdirSync("test-vectors/sellerhub-create-listing", { recursive: true });
writeFileSync("test-vectors/sellerhub-create-listing/approval.json", `${JSON.stringify(output, null, 2)}\n`);

const { approvedOperationId, operationId, planId, planHash, targetCount, targetSetDigest, operationItemId } = approval;
const approvalEnvelopeDigest = output.approvalEnvelopeDigest;
const attemptId: string = afternic.fact.attemptId;
const purpose = { schemaVersion: 1, provider: "spaceship", action };
const approvedAttempt = { ...purpose, approvedOperationId, operationId, operationItemId, attemptId,
  planHash, requestDigest, approvalEnvelopeDigest };
const approveAudit = signAudit({
  ...afternic.approvalAudit,
  targetType: "sellerhub_create_listing_approval",
  payloadRedacted: sellerHubCreateListingApprovalAuditPayloadSchema.parse({
    ...purpose, stage: "approved", approvedOperationId, operationId, planId, planHash, targetCount, targetSetDigest,
  }),
});
const claimAudit = signAudit({
  ...afternic.claimAudit,
  targetType: "sellerhub_create_listing_attempt",
  previousHash: approveAudit.eventHash,
  payloadRedacted: sellerHubCreateListingClaimAuditPayloadSchema.parse({
    ...approvedAttempt, stage: "dispatch_claimed", attemptNo: 1,
  }),
});
const preflightAudit = signAudit({
  ...afternic.preflightAudit,
  targetType: "sellerhub_create_listing_attempt",
  targetRef: attemptId,
  auditSequence: approveAudit.auditSequence + 1,
  previousHash: approveAudit.eventHash,
  payloadRedacted: sellerHubCreateListingPreflightRefusedAuditPayloadSchema.parse({
    ...approvedAttempt, stage: "preflight_refused", reason: "precondition_changed",
  }),
});
const fact = executionFactSchema.parse({
  ...afternic.fact,
  planHash,
  idempotencyKeyHash: digest(encodeDomainSeparatedWireValue("GOODDEALER-SELLERHUB-CREATE-LISTING-LOCAL-DISPATCH-KEY-V1", afternic.dispatchKey)),
  eventType: "sellerhub_create_listing_dispatch_claimed",
  executionAuthorizationEvidence: {
    ...afternic.fact.executionAuthorizationEvidence,
    approvedOperationDigest: approvalEnvelopeDigest,
    approvedOperationEnvelope: Buffer.from(JSON.stringify(approval)).toString("base64url"),
  },
  payloadRedacted: sellerHubCreateListingClaimPayloadSchema.parse({
    ...purpose, stage: "dispatch_claimed", dispatchSemantics: "local_claim_only",
    deduplicationScope: "local_only", requestDigest, approvalEnvelopeDigest,
  }),
  auditEventHash: claimAudit.eventHash,
});
fact.deviceSignature = sign(null, encodeExecutionFactSignatureTranscript(fact), deviceKey).toString("base64url");
const reconciledAudit = signAudit({
  ...afternic.reconciledAudit,
  targetType: "sellerhub_create_listing_attempt",
  auditSequence: claimAudit.auditSequence + 1,
  previousHash: claimAudit.eventHash,
  payloadRedacted: sellerHubCreateListingReconciledAuditPayloadSchema.parse({
    ...purpose, stage: "reconciled", operationId, operationItemId, attemptId,
    originalExecutionFactId: fact.executionFactId, originalExecutionFactDigest: digest(encodeDrainStreamEnvelope("execution_fact", fact)),
    originalSourceDeviceId: fact.sourceDeviceId, originalActiveLeaseEpoch: fact.activeLeaseEpoch,
    outcome: "ownership_pending", reason: "ownership_verifying",
  }),
});
writeFileSync("test-vectors/sellerhub-create-listing/dispatch.json", `${JSON.stringify({
  generatedBy: output.generatedBy, approveAudit, claimAudit, preflightAudit, fact, reconciledAudit,
}, null, 2)}\n`);

function signAudit(value: unknown) {
  const event = deviceAuditEventSchema.parse(value);
  event.eventHash = digest(encodeDeviceAuditEventHashInput(event));
  event.deviceSignature = sign(null, encodeDeviceAuditEventSignatureTranscript(event), deviceKey).toString("base64url");
  return event;
}
