import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeAfternicListingPlanItemApprovalEnvelope, encodeAfternicListingPlanItemApprovalJson,
  encodeAfternicListingPlanItemApprovalSignatureTranscript, encodeAfternicListingPlanTargetSetDigestInput,
  encodeAfternicOwnershipReviewItemApprovalEnvelope, encodeAfternicOwnershipReviewItemApprovalJson,
  encodeAfternicOwnershipReviewItemApprovalSignatureTranscript,
  afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema,
  afternicListingPlanClaimPayloadSchema, afternicListingPlanPreflightRefusedAuditPayloadSchema,
  afternicListingPlanReconciledAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewClaimPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema, DEVICE_AUDIT_CHAIN_GENESIS_DIGEST,
  deviceAuditEventSchema, executionFactSchema, encodeDeviceAuditEventHashInput,
  encodeDeviceAuditEventSignatureTranscript, encodeDrainStreamEnvelope, encodeExecutionFactSignatureTranscript,
  encodeWorkspaceDeviceAuditChainDomain, encodeAfternicLocalDispatchKeyDigestInput,
} from "../src/execution-events/index.ts";

const contextVector = JSON.parse(readFileSync(resolve("test-vectors/execution-context/valid.json"), "utf8"));
const c = contextVector.response.context;
const key = createPrivateKey({ format: "der", type: "pkcs8", key: Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 85),
]) });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64url");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const output = resolve("test-vectors/afternic-listing-plan-evidence");
mkdirSync(output, { recursive: true });
for (const name of ["create", "update", "ownership-linked-create", "ownership-linked-update", "ownership-standalone"] as const) {
  const ownership = name.startsWith("ownership-");
  const linked = name.startsWith("ownership-linked-");
  const parentAction = name.endsWith("update") ? "update" : "create";
  const parentDigest = hash(Buffer.from(`fixture-v2-${parentAction}-request`));
  const requestDigest = ownership ? hash(Buffer.from(`fixture-v2-${name}-request`)) : parentDigest;
  const item = { operationItemId: ownership ? id(5) : id(4), action: ownership ? "reactivate_ownership_review" : parentAction,
    requestDigest, parentItemId: linked ? id(4) : null, parentRequestDigest: linked ? parentDigest : null };
  const parent = { operationItemId: id(4), action: parentAction, requestDigest: parentDigest, parentItemId: null, parentRequestDigest: null };
  const targetSet = { schemaVersion: 2, planId: id(3), action: "listing_plan_v2", items: linked ? [parent, item] : [item] };
  const approval = {
    schemaVersion: ownership ? 1 : 2,
    typ: ownership ? "gd.afternic-ownership-review-item-approval.v1" : "gd.afternic-listing-plan-item-approval.v2",
    aud: "gooddealer-cloud/execution-evidence", approvedOperationId: id(7), operationId: id(2), planId: targetSet.planId,
    planHash: hash(Buffer.from(`fixture-v2-${name}-plan`)), targetCount: targetSet.items.length,
    targetSetDigest: hash(encodeAfternicListingPlanTargetSetDigestInput(targetSet)),
    ...item, capability: "afternic:marketplace:write", accountId: c.accountId, workspaceId: c.workspaceId,
    sourceDeviceId: c.deviceId, activeLeaseEpoch: c.activeLeaseEpoch, credentialEpoch: c.credentialEpoch,
    signingKeyId: c.signingKeyId, signingKeyVersion: c.signingKeyVersion, authorizationHash: c.authorizationGrantDigest,
    trustedTimeAnchorId: contextVector.trustedTimeAnchorId, monotonicDeltaMs: 1000,
    approvedAt: new Date(Math.ceil((Date.parse(c.serverObservedAt) + 2000) / 1000) * 1000).toISOString().replace(".000Z", "Z"),
    signatureTranscriptVersion: 1, deviceSignature: Buffer.alloc(64).toString("base64url"),
  };
  const transcript = ownership ? encodeAfternicOwnershipReviewItemApprovalSignatureTranscript : encodeAfternicListingPlanItemApprovalSignatureTranscript;
  const envelope = ownership ? encodeAfternicOwnershipReviewItemApprovalEnvelope : encodeAfternicListingPlanItemApprovalEnvelope;
  const json = ownership ? encodeAfternicOwnershipReviewItemApprovalJson : encodeAfternicListingPlanItemApprovalJson;
  approval.deviceSignature = sign(null, transcript(approval), key).toString("base64url");
  const approvalEnvelopeDigest = hash(envelope(approval));
  const batch = { approvedOperationId: approval.approvedOperationId, operationId: approval.operationId,
    planId: approval.planId, planHash: approval.planHash, targetCount: approval.targetCount, targetSetDigest: approval.targetSetDigest };
  const boundary = (delta: number) => new Date(Math.ceil((Date.parse(c.serverObservedAt) + 1000 + delta) / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const contextFields = { accountId: c.accountId, workspaceId: c.workspaceId, sourceDeviceId: c.deviceId,
    activeLeaseEpoch: c.activeLeaseEpoch, credentialEpoch: c.credentialEpoch, signingKeyId: c.signingKeyId,
    signingKeyVersion: c.signingKeyVersion, trustedTimeAnchorId: contextVector.trustedTimeAnchorId };
  const commonAudit = { schemaVersion: 1, auditEventKind: "device", eventType: "approved_operation_execution",
    authorizationSource: "approved_operation", scopeKind: "workspace", ...contextFields,
    chainId: hash(encodeWorkspaceDeviceAuditChainDomain({ workspaceId: c.workspaceId, sourceDeviceId: c.deviceId, activeLeaseEpoch: c.activeLeaseEpoch })),
    signingKeyPurpose: "device_identity_audit", authorizationContextHash: c.authorizationGrantDigest, signatureTranscriptVersion: 1 };
  function audit(fields: Record<string, unknown>) {
    let event = deviceAuditEventSchema.parse({ ...commonAudit, ...fields,
      eventHash: Buffer.alloc(32).toString("base64url"), deviceSignature: Buffer.alloc(64).toString("base64url") });
    event = { ...event, eventHash: hash(encodeDeviceAuditEventHashInput(event)) };
    return { ...event, deviceSignature: sign(null, encodeDeviceAuditEventSignatureTranscript(event), key).toString("base64url") };
  }
  const approvalAudit = audit({ auditEventId: id(8), actorKind: "user", targetType: "afternic_listing_plan_v2_approval",
    targetRef: batch.approvedOperationId, auditSequence: 1, previousHash: DEVICE_AUDIT_CHAIN_GENESIS_DIGEST,
    occurredAt: boundary(1000), monotonicDeltaMs: 1000,
    payloadRedacted: afternicListingPlanApprovalAuditPayloadSchema.parse({ schemaVersion: 2, provider: "afternic", action: "listing_plan_v2", stage: "approved", ...batch }) });
  const payloadIdentity = { schemaVersion: approval.schemaVersion, provider: "afternic", action: approval.action };
  const observation = ownership ? { resourceBindingDigest: hash(Buffer.from("fixture-ownership-resource-binding")),
    preflightObservationDigest: hash(Buffer.from("fixture-ownership-preflight-observation")) } : {};
  const targetType = ownership ? "afternic_ownership_review_attempt" : "afternic_listing_plan_v2_attempt";
  const claimPayload = (ownership ? afternicOwnershipReviewClaimAuditPayloadSchema : afternicListingPlanClaimAuditPayloadSchema).parse({
    ...payloadIdentity, stage: "dispatch_claimed", approvedOperationId: batch.approvedOperationId, operationId: batch.operationId,
    operationItemId: item.operationItemId, attemptId: id(6), attemptNo: 1, planHash: batch.planHash, requestDigest, approvalEnvelopeDigest, ...observation });
  const claimAudit = audit({ auditEventId: id(10), actorKind: "device_service", targetType, targetRef: id(6), auditSequence: 2,
    previousHash: approvalAudit.eventHash, occurredAt: boundary(2000), monotonicDeltaMs: 2000, payloadRedacted: claimPayload });
  const dispatchKey = { schemaVersion: 1, operationId: batch.operationId, operationItemId: item.operationItemId, attemptNo: 1, localOperationKey: batch.planId };
  let fact = executionFactSchema.parse({ schemaVersion: 1, executionFactId: id(9), operationId: batch.operationId,
    operationItemId: item.operationItemId, workflowNodeId: id(11), attemptId: id(6), attemptNo: 1,
    approvedOperationId: batch.approvedOperationId, planHash: batch.planHash,
    idempotencyKeyHash: hash(encodeAfternicLocalDispatchKeyDigestInput(dispatchKey)), sourceDeviceId: c.deviceId,
    workspaceId: c.workspaceId, activeLeaseEpoch: c.activeLeaseEpoch, executionFactSequence: 1,
    eventType: ownership ? "afternic_ownership_review_dispatch_claimed" : "afternic_listing_plan_v2_dispatch_claimed",
    evidenceLevel: "durable_local_claim", occurredAt: boundary(2000), signingKeyId: c.signingKeyId,
    signingKeyVersion: c.signingKeyVersion, credentialEpoch: c.credentialEpoch, trustedTimeAnchorId: contextVector.trustedTimeAnchorId,
    monotonicDeltaMs: 2000, requestStartBoundary: boundary(2000), authorizationHash: c.authorizationGrantDigest,
    executionAuthorizationEvidence: { approvedOperationDigest: approvalEnvelopeDigest, approvedOperationEnvelope: Buffer.from(json(approval)).toString("base64url"),
      signingKeyId: c.signingKeyId, signingKeyVersion: c.signingKeyVersion, credentialEpoch: c.credentialEpoch, signatureTranscriptVersion: 1 },
    signatureTranscriptVersion: 1,
    payloadRedacted: (ownership ? afternicOwnershipReviewClaimPayloadSchema : afternicListingPlanClaimPayloadSchema).parse({ ...payloadIdentity,
      stage: "dispatch_claimed", dispatchSemantics: "local_claim_only", deduplicationScope: "local_only", requestDigest, approvalEnvelopeDigest, ...observation }),
    auditEventRef: claimAudit.auditEventId, auditEventHash: claimAudit.eventHash, deviceSignature: Buffer.alloc(64).toString("base64url") });
  fact = { ...fact, deviceSignature: sign(null, encodeExecutionFactSignatureTranscript(fact), key).toString("base64url") };
  const lifecycle = { eventType: "runtime_security_lifecycle", authorizationSource: "runtime_security_context", actorKind: "device_service", targetType };
  const preflightAudit = audit({ ...lifecycle, auditEventId: id(13), targetRef: id(14), auditSequence: 3,
    previousHash: claimAudit.eventHash, occurredAt: boundary(3000), monotonicDeltaMs: 3000,
    payloadRedacted: (ownership ? afternicOwnershipReviewPreflightRefusedAuditPayloadSchema : afternicListingPlanPreflightRefusedAuditPayloadSchema).parse({
      ...payloadIdentity, stage: "preflight_refused", approvedOperationId: batch.approvedOperationId, operationId: batch.operationId,
      operationItemId: item.operationItemId, attemptId: id(14), planHash: batch.planHash, requestDigest, approvalEnvelopeDigest,
      reason: ownership ? "cooldown" : parentAction === "create" ? "already_present" : "listing_absent" }) });
  const reconciledAudit = audit({ ...lifecycle, auditEventId: id(15), targetRef: id(6), auditSequence: 4,
    previousHash: preflightAudit.eventHash, occurredAt: boundary(4000), monotonicDeltaMs: 4000,
    payloadRedacted: (ownership ? afternicOwnershipReviewReconciledAuditPayloadSchema : afternicListingPlanReconciledAuditPayloadSchema).parse({
      ...payloadIdentity, stage: "reconciled", operationId: batch.operationId, operationItemId: item.operationItemId, attemptId: id(6),
      originalExecutionFactId: fact.executionFactId, originalExecutionFactDigest: hash(encodeDrainStreamEnvelope("execution_fact", fact)),
      outcome: ownership ? "confirmed" : "matched", reason: null }) });
  const temporary = resolve(output, `${name}.json.tmp`);
  writeFileSync(temporary, JSON.stringify({ schemaVersion: 1,
    generatedBy: "scripts/generate-afternic-listing-plan-approval-vectors.ts",
    devicePublicKey: createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url"),
    contextResponse: contextVector.response, approval, targetSet, dispatchKey, approvalAudit, claimAudit, preflightAudit, reconciledAudit, fact,
    approvalEnvelopeDigest,
    bytes: { approvalTranscript: hex(transcript(approval)), approvalEnvelope: hex(envelope(approval)),
      approvalJson: hex(json(approval)), targetSet: hex(encodeAfternicListingPlanTargetSetDigestInput(targetSet)),
      approvalAuditHashInput: hex(encodeDeviceAuditEventHashInput(approvalAudit)), approvalAuditTranscript: hex(encodeDeviceAuditEventSignatureTranscript(approvalAudit)),
      claimAuditHashInput: hex(encodeDeviceAuditEventHashInput(claimAudit)), claimAuditTranscript: hex(encodeDeviceAuditEventSignatureTranscript(claimAudit)),
      preflightAuditHashInput: hex(encodeDeviceAuditEventHashInput(preflightAudit)), preflightAuditTranscript: hex(encodeDeviceAuditEventSignatureTranscript(preflightAudit)),
      reconciledAuditHashInput: hex(encodeDeviceAuditEventHashInput(reconciledAudit)), reconciledAuditTranscript: hex(encodeDeviceAuditEventSignatureTranscript(reconciledAudit)),
      factTranscript: hex(encodeExecutionFactSignatureTranscript(fact)),
      claimAuditEnvelope: hex(encodeDrainStreamEnvelope("device_audit", claimAudit)), executionFactEnvelope: hex(encodeDrainStreamEnvelope("execution_fact", fact)) },
  }, null, 2) + "\n");
  renameSync(temporary, resolve(output, `${name}.json`));
  if (name === "ownership-standalone") {
    const satisfiedAudit = audit({ ...lifecycle, auditEventId: id(16), targetRef: id(6), auditSequence: 2,
      previousHash: approvalAudit.eventHash, occurredAt: boundary(2000), monotonicDeltaMs: 2000,
      payloadRedacted: afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema.parse({ ...payloadIdentity,
        stage: "preflight_satisfied", approvedOperationId: batch.approvedOperationId, operationId: batch.operationId,
        operationItemId: item.operationItemId, attemptId: id(6), planHash: batch.planHash, requestDigest, approvalEnvelopeDigest }) });
    const satisfiedTemporary = resolve(output, "ownership-preflight-satisfied.json.tmp");
    writeFileSync(satisfiedTemporary, JSON.stringify({ schemaVersion: 1,
      generatedBy: "scripts/generate-afternic-listing-plan-approval-vectors.ts",
      devicePublicKey: createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url"),
      contextResponse: contextVector.response, approval, targetSet, approvalAudit, satisfiedAudit, approvalEnvelopeDigest,
      bytes: { approvalTranscript: hex(transcript(approval)), approvalEnvelope: hex(envelope(approval)),
        approvalJson: hex(json(approval)), targetSet: hex(encodeAfternicListingPlanTargetSetDigestInput(targetSet)),
        approvalAuditHashInput: hex(encodeDeviceAuditEventHashInput(approvalAudit)),
        approvalAuditTranscript: hex(encodeDeviceAuditEventSignatureTranscript(approvalAudit)),
        satisfiedAuditHashInput: hex(encodeDeviceAuditEventHashInput(satisfiedAudit)),
        satisfiedAuditTranscript: hex(encodeDeviceAuditEventSignatureTranscript(satisfiedAudit)),
        satisfiedAuditEnvelope: hex(encodeDrainStreamEnvelope("device_audit", satisfiedAudit)) },
    }, null, 2) + "\n");
    renameSync(satisfiedTemporary, resolve(output, "ownership-preflight-satisfied.json"));
  }
}
