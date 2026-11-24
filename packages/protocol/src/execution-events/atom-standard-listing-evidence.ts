/**
 * Execution evidence for Atom Standard listing creation (`add-domain` with `domain_type=standard`).
 * Atom documents no idempotency for this side-effecting GET, so a claim is local only and an
 * unknown result is reconciled by an exact `domain-details` read, never resent. `listed` needs the
 * exact domain reported as a Standard listing at the submitted price; a listing that still awaits
 * ownership verification is `verification_pending`, never `listed`. Premium (coin-funded) and Geo
 * listings are outside this purpose.
 */
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
const purpose = z.literal("add_standard");

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

export const atomStandardListingApprovalAuditPayloadSchema = z.object({
  ...auditPurpose,
  ...approvalIdentity,
  stage: z.literal("approved"),
}).strict();

export const atomStandardListingClaimAuditPayloadSchema = z.object({
  ...auditPurpose,
  ...approvedAttemptIdentity,
  stage: z.literal("dispatch_claimed"),
  attemptNo: z.literal(1),
}).strict();

export const atomStandardListingPreflightRefusedAuditPayloadSchema = z.object({
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
export const atomStandardListingReconciledAuditPayloadSchema = z.discriminatedUnion("outcome", [
  z.object({ ...reconciliation, outcome: z.literal("listed"), reason: z.null() }).strict(),
  z.object({ ...reconciliation, outcome: z.literal("verification_pending"), reason: z.literal("ownership_verifying") }).strict(),
  z.object({ ...reconciliation, outcome: z.literal("terms_unconfirmed"), reason: z.literal("postcondition_pending") }).strict(),
  z.object({ ...reconciliation, outcome: z.literal("state_blocked"), reason: z.literal("not_on_sale") }).strict(),
  z.object({ ...reconciliation, outcome: z.literal("read_failed"), reason: z.literal("read_failed") }).strict(),
]);

export const atomStandardListingClaimPayloadSchema = z.object({
  ...auditPurpose,
  stage: z.literal("dispatch_claimed"),
  dispatchSemantics: z.literal("local_claim_only"),
  deduplicationScope: z.literal("local_only"),
  requestDigest: digest,
  approvalEnvelopeDigest: digest,
}).strict();

export const atomStandardListingItemApprovalSchema = z.object({
  schemaVersion: z.literal(1),
  typ: z.literal("gd.atom-standard-listing-item-approval.v1"),
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
export type AtomStandardListingItemApproval = z.infer<typeof atomStandardListingItemApprovalSchema>;

export const atomStandardListingAuditPayloadSchema = z.union([
  atomStandardListingApprovalAuditPayloadSchema,
  atomStandardListingClaimAuditPayloadSchema,
  atomStandardListingPreflightRefusedAuditPayloadSchema,
  atomStandardListingReconciledAuditPayloadSchema,
]);

const targetSetSchema = z.object({
  schemaVersion: z.literal(1),
  planId: uuid,
  action: purpose,
  items: z.array(z.object({ operationItemId: uuid, requestDigest: digest }).strict()).min(1).max(500),
}).strict().refine(({ items }) => items.every(
  ({ operationItemId }, index) => index === 0 || items[index - 1]!.operationItemId < operationItemId,
), { path: ["items"], message: "target items must be strictly ordered and unique" });

export function encodeAtomStandardListingItemApprovalSignatureTranscript(value: unknown): Uint8Array {
  const { deviceSignature: _signature, ...claims } = atomStandardListingItemApprovalSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-ATOM-STANDARD-LISTING-ITEM-APPROVAL-V1", claims);
}

export function encodeAtomStandardListingItemApprovalEnvelope(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-ATOM-STANDARD-LISTING-ITEM-APPROVAL-ENVELOPE-V1",
    atomStandardListingItemApprovalSchema.parse(value),
  );
}

export function encodeAtomStandardListingTargetSetDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue("GOODDEALER-ATOM-STANDARD-LISTING-TARGET-SET-V1", targetSetSchema.parse(value));
}


export function decodeAtomStandardListingItemApprovalJson(bytes: Uint8Array): AtomStandardListingItemApproval {
  return atomStandardListingItemApprovalSchema.parse(decodeClosedItemApprovalJson(bytes));
}

const atomStandardListingLocalDispatchKeySchema = z.object({
  schemaVersion: z.literal(1),
  operationId: uuid,
  operationItemId: uuid,
  attemptNo: z.literal(1),
  localOperationKey: uuid,
}).strict();

export function encodeAtomStandardListingLocalDispatchKeyDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-ATOM-STANDARD-LISTING-LOCAL-DISPATCH-KEY-V1",
    atomStandardListingLocalDispatchKeySchema.parse(value),
  );
}
