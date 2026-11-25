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
const batchFields = {
  approvedOperationId: uuid,
  operationId: uuid,
  planId: uuid,
  planHash: digest,
  targetCount: z.number().int().min(1).max(500),
  targetSetDigest: digest,
};
const requestFields = {
  approvedOperationId: uuid,
  operationId: uuid,
  operationItemId: uuid,
  attemptId: uuid,
  attemptNo: z.literal(1),
  planHash: digest,
  requestDigest: digest,
  approvalEnvelopeDigest: digest,
};
const payloadFields = {
  schemaVersion: z.literal(1),
  provider: z.literal("afternic"),
  action: z.literal("remove"),
};
export const afternicDelistItemApprovalSchema = z
  .object({
    schemaVersion: z.literal(1),
    typ: z.literal("gd.afternic-delist-item-approval.v1"),
    aud: z.literal("gooddealer-cloud/execution-evidence"),
    ...batchFields,
    operationItemId: uuid,
    capability: z.literal("afternic:marketplace:write"),
    action: z.literal("remove"),
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
  })
  .strict();
export const afternicDelistApprovalAuditPayloadSchema = z
  .object({
    ...payloadFields,
    stage: z.literal("approved"),
    ...batchFields,
  })
  .strict();
export const afternicDelistClaimAuditPayloadSchema = z
  .object({
    ...payloadFields,
    stage: z.literal("dispatch_claimed"),
    ...requestFields,
  })
  .strict();
export const afternicDelistClaimPayloadSchema = z
  .object({
    ...payloadFields,
    stage: z.literal("dispatch_claimed"),
    dispatchSemantics: z.literal("local_claim_only"),
    deduplicationScope: z.literal("local_only"),
    requestDigest: digest,
    approvalEnvelopeDigest: digest,
  })
  .strict();
export const afternicDelistTargetSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    planId: uuid,
    items: z
      .array(z.object({ operationItemId: uuid, requestDigest: digest }).strict())
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (let i = 1; i < value.items.length; i++)
      if (value.items[i - 1]!.operationItemId >= value.items[i]!.operationItemId) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "operationItemId"],
          message: "target items must be strictly ordered and unique",
        });
        break;
      }
  });
export const afternicLocalDispatchKeySchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: uuid,
    operationItemId: uuid,
    attemptNo: z.literal(1),
    localOperationKey: uuid,
  })
  .strict();
export function encodeAfternicDelistItemApprovalSignatureTranscript(value: unknown): Uint8Array {
  const { deviceSignature: _signature, ...claims } = afternicDelistItemApprovalSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-AFTERNIC-DELIST-ITEM-APPROVAL-V1", claims);
}
export function encodeAfternicDelistItemApprovalEnvelope(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-AFTERNIC-DELIST-ITEM-APPROVAL-ENVELOPE-V1",
    afternicDelistItemApprovalSchema.parse(value),
  );
}
export function encodeAfternicDelistTargetSetDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-AFTERNIC-DELIST-TARGET-SET-V1",
    afternicDelistTargetSetSchema.parse(value),
  );
}
export function encodeAfternicLocalDispatchKeyDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-AFTERNIC-LOCAL-DISPATCH-KEY-V1",
    afternicLocalDispatchKeySchema.parse(value),
  );
}
/** The v1 fact embeds JSON bytes, while the evidence digest commits the canonical signed object. */
export function encodeAfternicDelistItemApprovalJson(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(afternicDelistItemApprovalSchema.parse(value)));
  if (bytes.byteLength > 6144) throw new TypeError("item approval is too large");
  return bytes;
}
export function decodeAfternicDelistItemApprovalJson(bytes: Uint8Array): AfternicDelistItemApproval {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 6144)
    throw new TypeError("item approval size rejected");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text);
  // The signed item envelope is flat. Tokenize complete JSON strings so escaped quotes in
  // values cannot masquerade as keys; duplicate keys must not acquire parser-specific meaning.
  const keys = new Set<string>();
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
    if (
      !text
        .slice(token.index + token[0].length)
        .trimStart()
        .startsWith(":")
    )
      continue;
    const key = JSON.parse(token[0]) as string;
    if (keys.has(key)) throw new TypeError("duplicate item approval key");
    keys.add(key);
  }
  return afternicDelistItemApprovalSchema.parse(parsed);
}
export type AfternicDelistItemApproval = z.infer<typeof afternicDelistItemApprovalSchema>;
export type AfternicDelistApprovalAuditPayload = z.infer<typeof afternicDelistApprovalAuditPayloadSchema>;
export type AfternicDelistClaimAuditPayload = z.infer<typeof afternicDelistClaimAuditPayloadSchema>;
export type AfternicDelistClaimPayload = z.infer<typeof afternicDelistClaimPayloadSchema>;

export const afternicDelistReconciledAuditPayloadSchema = z
  .object({
    ...payloadFields,
    stage: z.literal("reconciled"),
    operationId: uuid,
    operationItemId: uuid,
    attemptId: uuid,
    originalExecutionFactId: uuid,
    originalExecutionFactDigest: digest,
    outcome: z.enum(["absent", "present", "read_failed", "conflict"]),
    reason: z.enum(["precondition_changed", "connection_changed", "read_failed", "still_present"]).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const valid =
      value.outcome === "absent"
        ? value.reason === null
        : value.outcome === "present"
          ? value.reason === "still_present"
          : value.outcome === "read_failed"
            ? value.reason === "read_failed"
            : value.reason === "precondition_changed" || value.reason === "connection_changed";
    if (!valid)
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "reason must match the actual observation outcome",
      });
  });
export const afternicDelistPreflightRefusedAuditPayloadSchema = z
  .object({
    ...payloadFields,
    stage: z.literal("preflight_refused"),
    approvedOperationId: uuid,
    operationId: uuid,
    operationItemId: uuid,
    attemptId: uuid,
    planHash: digest,
    requestDigest: digest,
    approvalEnvelopeDigest: digest,
    reason: z.enum(["precondition_changed", "connection_changed", "already_absent"]),
  })
  .strict();
export type AfternicDelistReconciledAuditPayload = z.infer<typeof afternicDelistReconciledAuditPayloadSchema>;
export type AfternicDelistPreflightRefusedAuditPayload = z.infer<
  typeof afternicDelistPreflightRefusedAuditPayloadSchema
>;
