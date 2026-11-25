import { decodeClosedItemApprovalJson } from "./closed-item-approval-json";
import { z } from "zod";
import {
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const digest = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/u);
const purpose = z.literal("remove_standard");

const auditPurpose = {
  schemaVersion: z.literal(1),
  provider: z.literal("atom"),
  action: purpose,
};
const approvalIdentity = {
  approvedOperationId: uuid,
  operationId: uuid,
  planId: uuid,
  planHash: digest,
  targetCount: z.number().int().min(1).max(500),
  targetSetDigest: digest,
};
const attemptIdentity = {
  operationId: uuid,
  operationItemId: uuid,
  attemptId: uuid,
};
const approvedAttemptIdentity = {
  ...attemptIdentity,
  approvedOperationId: uuid,
  planHash: digest,
  requestDigest: digest,
  approvalEnvelopeDigest: digest,
};

export const atomStandardDelistApprovalAuditPayloadSchema = z.object({
  ...auditPurpose,
  ...approvalIdentity,
  stage: z.literal("approved"),
}).strict();

export const atomStandardDelistClaimAuditPayloadSchema = z.object({
  ...auditPurpose,
  ...approvedAttemptIdentity,
  stage: z.literal("dispatch_claimed"),
  attemptNo: z.literal(1),
}).strict();

export const atomStandardDelistPreflightRefusedAuditPayloadSchema = z.object({
  ...auditPurpose,
  ...approvedAttemptIdentity,
  stage: z.literal("preflight_refused"),
  reason: z.enum(["precondition_changed", "connection_changed", "provider_state_blocked"]),
}).strict();

const reconciliation = {
  ...auditPurpose,
  ...attemptIdentity,
  stage: z.literal("reconciled"),
  originalExecutionFactId: uuid,
  originalExecutionFactDigest: digest,
  originalSourceDeviceId: identifier,
  originalActiveLeaseEpoch: safePositiveInteger,
};
export const atomStandardDelistReconciledAuditPayloadSchema = z.discriminatedUnion("outcome", [
  z.object({ ...reconciliation, outcome: z.literal("different"), reason: z.literal("postcondition_pending") }).strict(),
  z.object({ ...reconciliation, outcome: z.literal("read_failed"), reason: z.literal("read_failed") }).strict(),
]);

export const atomStandardDelistClaimPayloadSchema = z.object({
  ...auditPurpose,
  stage: z.literal("dispatch_claimed"),
  dispatchSemantics: z.literal("local_claim_only"),
  deduplicationScope: z.literal("local_only"),
  requestDigest: digest,
  approvalEnvelopeDigest: digest,
}).strict();

export const atomStandardDelistItemApprovalSchema = z.object({
  schemaVersion: z.literal(1),
  typ: z.literal("gd.atom-standard-delist-item-approval.v1"),
  aud: z.literal("gooddealer-cloud/execution-evidence"),
  ...approvalIdentity,
  operationItemId: uuid,
  capability: z.literal("atom:marketplace:write"),
  action: purpose,
  requestDigest: digest,
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
}).strict();
export type AtomStandardDelistItemApproval = z.infer<typeof atomStandardDelistItemApprovalSchema>;

export const atomStandardDelistAuditPayloadSchema = z.union([
  atomStandardDelistApprovalAuditPayloadSchema,
  atomStandardDelistClaimAuditPayloadSchema,
  atomStandardDelistPreflightRefusedAuditPayloadSchema,
  atomStandardDelistReconciledAuditPayloadSchema,
]);

const targetSetSchema = z.object({
  schemaVersion: z.literal(1),
  planId: uuid,
  action: purpose,
  items: z.array(z.object({ operationItemId: uuid, requestDigest: digest }).strict()).min(1).max(500),
}).strict().refine(({ items }) => items.every(
  ({ operationItemId }, index) => index === 0 || items[index - 1]!.operationItemId < operationItemId,
), { path: ["items"], message: "target items must be strictly ordered and unique" });

export function encodeAtomStandardDelistItemApprovalSignatureTranscript(value: unknown): Uint8Array {
  const { deviceSignature: _signature, ...claims } = atomStandardDelistItemApprovalSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-ATOM-STANDARD-DELIST-ITEM-APPROVAL-V1", claims);
}

export function encodeAtomStandardDelistItemApprovalEnvelope(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-ATOM-STANDARD-DELIST-ITEM-APPROVAL-ENVELOPE-V1",
    atomStandardDelistItemApprovalSchema.parse(value),
  );
}

export function encodeAtomStandardDelistTargetSetDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue("GOODDEALER-ATOM-STANDARD-DELIST-TARGET-SET-V1", targetSetSchema.parse(value));
}


export function decodeAtomStandardDelistItemApprovalJson(bytes: Uint8Array): AtomStandardDelistItemApproval {
  return atomStandardDelistItemApprovalSchema.parse(decodeClosedItemApprovalJson(bytes));
}

const atomStandardDelistLocalDispatchKeySchema = z.object({
  schemaVersion: z.literal(1),
  operationId: uuid,
  operationItemId: uuid,
  attemptNo: z.literal(1),
  localOperationKey: uuid,
}).strict();

export function encodeAtomStandardDelistLocalDispatchKeyDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-ATOM-STANDARD-DELIST-LOCAL-DISPATCH-KEY-V1",
    atomStandardDelistLocalDispatchKeySchema.parse(value),
  );
}
