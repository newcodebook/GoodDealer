import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  deviceAuditEventSchema,
  encodeDeviceAuditEventHashInput,
  encodeDeviceAuditEventSignatureTranscript,
  encodeDrainStreamEnvelope,
  encodeExecutionFactSignatureTranscript,
  executionFactSchema,
  sellerHubBinPriceApprovalAuditPayloadSchema,
  sellerHubBinPriceClaimAuditPayloadSchema,
  sellerHubBinPriceClaimPayloadSchema,
  sellerHubBinPricePreflightRefusedAuditPayloadSchema,
  sellerHubBinPriceReconciledAuditPayloadSchema,
  encodeSellerHubBinPriceItemApprovalEnvelope,
  encodeSellerHubBinPriceItemApprovalSignatureTranscript,
  encodeSellerHubBinPriceTargetSetDigestInput,
  sellerHubBinPriceItemApprovalSchema,
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
const action = "set_bin_price";
const requestDigest = digest(Buffer.from("fixture SellerHub BIN request"));
const targetSet = {
  schemaVersion: 1,
  planId: base.planId,
  action,
  items: [{ operationItemId: base.operationItemId, requestDigest }],
};
const approval = sellerHubBinPriceItemApprovalSchema.parse({
  ...base,
  typ: "gd.sellerhub-bin-price-item-approval.v1",
  capability: "spaceship:marketplace:write",
  action,
  requestDigest,
  planHash: digest(Buffer.from("fixture SellerHub BIN plan")),
  targetCount: 1,
  targetSetDigest: digest(encodeSellerHubBinPriceTargetSetDigestInput(targetSet)),
});
const transcript = encodeSellerHubBinPriceItemApprovalSignatureTranscript(approval);
approval.deviceSignature = sign(null, transcript, deviceKey).toString("base64url");
const output = {
  generatedBy: "scripts/generate-sellerhub-bin-price-vectors.ts",
  approval,
  targetSet,
  approvalTranscript: Buffer.from(transcript).toString("hex"),
  approvalEnvelopeDigest: digest(encodeSellerHubBinPriceItemApprovalEnvelope(approval)),
};
mkdirSync("test-vectors/sellerhub-bin-price", { recursive: true });
writeFileSync("test-vectors/sellerhub-bin-price/approval.json", `${JSON.stringify(output, null, 2)}\n`);

const { approvedOperationId, operationId, planId, planHash, targetCount, targetSetDigest, operationItemId } = approval;
const approvalEnvelopeDigest = output.approvalEnvelopeDigest;
const attemptId: string = afternic.fact.attemptId;
const purpose = { schemaVersion: 1, provider: "spaceship", action };
const approvedAttempt = { ...purpose, approvedOperationId, operationId, operationItemId, attemptId,
  planHash, requestDigest, approvalEnvelopeDigest };
const approveAudit = signAudit({
  ...afternic.approvalAudit,
  targetType: "sellerhub_bin_price_approval",
  payloadRedacted: sellerHubBinPriceApprovalAuditPayloadSchema.parse({
    ...purpose, stage: "approved", approvedOperationId, operationId, planId, planHash, targetCount, targetSetDigest,
  }),
});
const claimAudit = signAudit({
  ...afternic.claimAudit,
  targetType: "sellerhub_bin_price_attempt",
  previousHash: approveAudit.eventHash,
  payloadRedacted: sellerHubBinPriceClaimAuditPayloadSchema.parse({
    ...approvedAttempt, stage: "dispatch_claimed", attemptNo: 1,
  }),
});
const preflightAudit = signAudit({
  ...afternic.preflightAudit,
  targetType: "sellerhub_bin_price_attempt",
  targetRef: attemptId,
  auditSequence: approveAudit.auditSequence + 1,
  previousHash: approveAudit.eventHash,
  payloadRedacted: sellerHubBinPricePreflightRefusedAuditPayloadSchema.parse({
    ...approvedAttempt, stage: "preflight_refused", reason: "precondition_changed",
  }),
});
const fact = executionFactSchema.parse({
  ...afternic.fact,
  planHash,
  idempotencyKeyHash: digest(encodeDomainSeparatedWireValue("GOODDEALER-SELLERHUB-BIN-PRICE-LOCAL-DISPATCH-KEY-V1", afternic.dispatchKey)),
  eventType: "sellerhub_bin_price_dispatch_claimed",
  executionAuthorizationEvidence: {
    ...afternic.fact.executionAuthorizationEvidence,
    approvedOperationDigest: approvalEnvelopeDigest,
    approvedOperationEnvelope: Buffer.from(JSON.stringify(approval)).toString("base64url"),
  },
  payloadRedacted: sellerHubBinPriceClaimPayloadSchema.parse({
    ...purpose, stage: "dispatch_claimed", dispatchSemantics: "local_claim_only",
    deduplicationScope: "local_only", requestDigest, approvalEnvelopeDigest,
  }),
  auditEventHash: claimAudit.eventHash,
});
fact.deviceSignature = sign(null, encodeExecutionFactSignatureTranscript(fact), deviceKey).toString("base64url");
const reconciledAudit = signAudit({
  ...afternic.reconciledAudit,
  targetType: "sellerhub_bin_price_attempt",
  auditSequence: claimAudit.auditSequence + 1,
  previousHash: claimAudit.eventHash,
  payloadRedacted: sellerHubBinPriceReconciledAuditPayloadSchema.parse({
    ...purpose, stage: "reconciled", operationId, operationItemId, attemptId,
    originalExecutionFactId: fact.executionFactId, originalExecutionFactDigest: digest(encodeDrainStreamEnvelope("execution_fact", fact)),
    originalSourceDeviceId: fact.sourceDeviceId, originalActiveLeaseEpoch: fact.activeLeaseEpoch,
    outcome: "matched", reason: null,
  }),
});
writeFileSync("test-vectors/sellerhub-bin-price/dispatch.json", `${JSON.stringify({
  generatedBy: output.generatedBy, approveAudit, claimAudit, preflightAudit, fact, reconciledAudit,
}, null, 2)}\n`);

function signAudit(value: unknown) {
  const event = deviceAuditEventSchema.parse(value);
  event.eventHash = digest(encodeDeviceAuditEventHashInput(event));
  event.deviceSignature = sign(null, encodeDeviceAuditEventSignatureTranscript(event), deviceKey).toString("base64url");
  return event;
}
