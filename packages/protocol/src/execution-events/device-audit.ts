import { afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema, afternicListingPlanReconciledAuditPayloadSchema,
  afternicListingPlanPreflightRefusedAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema } from "./afternic-listing-plan-evidence";
import { afternicListingWriteApprovalAuditPayloadSchema, afternicListingWriteClaimAuditPayloadSchema, afternicListingWriteReconciledAuditPayloadSchema, afternicListingWritePreflightRefusedAuditPayloadSchema } from "./afternic-listing-write-evidence";
import { afternicDelistApprovalAuditPayloadSchema, afternicDelistClaimAuditPayloadSchema, afternicDelistReconciledAuditPayloadSchema, afternicDelistPreflightRefusedAuditPayloadSchema } from "./afternic-delist-evidence";
import { z } from "zod";

import { sha256DigestSchema } from "../workspace/index";
import {
  base64Url,
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";
import { redactedWireValueSchema } from "./redacted-wire-value";

export const DEVICE_AUDIT_EVENT_SCHEMA_VERSION = 1 as const;

const authorizationSourceSchema = z.enum([
  "user_session",
  "approved_operation",
  "device_binding",
  "runtime_security_context",
]);

const eventAuthorizationPairs = [
  ["user_session_activity", "user_session"],
  ["approved_operation_execution", "approved_operation"],
  ["device_binding_lifecycle", "device_binding"],
  ["runtime_security_lifecycle", "runtime_security_context"],
] as const;

const eventTypeSchema = z.enum(eventAuthorizationPairs.map(([eventType]) => eventType));

const deviceAuditCommonFields = {
  schemaVersion: z.literal(DEVICE_AUDIT_EVENT_SCHEMA_VERSION),
  auditEventId: identifier,
  auditEventKind: z.literal("device"),
  eventType: eventTypeSchema,
  accountId: identifier,
  actorKind: z.enum(["user", "device_service"]),
  authorizationSource: authorizationSourceSchema,
  targetType: identifier,
  targetRef: identifier,
  sourceDeviceId: identifier,
  credentialEpoch: safePositiveInteger,
  chainId: sha256DigestSchema,
  auditSequence: safePositiveInteger,
  previousHash: sha256DigestSchema,
  eventHash: sha256DigestSchema,
  occurredAt: canonicalUtcTimestamp,
  signingKeyId: identifier,
  signingKeyVersion: safePositiveInteger,
  signingKeyPurpose: z.literal("device_identity_audit"),
  trustedTimeAnchorId: identifier,
  monotonicDeltaMs: safeUnsignedInteger,
  authorizationContextHash: sha256DigestSchema,
  signatureTranscriptVersion: safePositiveInteger,
  payloadRedacted: redactedWireValueSchema,
  deviceSignature: base64Url.max(1024),
} as const;

function enforceAuthorizationSource(
  event: { eventType: (typeof eventAuthorizationPairs)[number][0]; authorizationSource: string },
  context: z.RefinementCtx,
) {
  const expected = eventAuthorizationPairs.find(([eventType]) => eventType === event.eventType)?.[1];
  if (event.authorizationSource !== expected) {
    context.addIssue({
      code: "custom",
      path: ["authorizationSource"],
      message: "authorization source must match the device audit event type",
    });
  }
}

const accountDeviceAuditEventSchema = z
  .object({
    ...deviceAuditCommonFields,
    scopeKind: z.literal("account"),
  })
  .strict()
  .superRefine(enforceAuthorizationSource);

const workspaceDeviceAuditEventSchema = z
  .object({
    ...deviceAuditCommonFields,
    scopeKind: z.literal("workspace"),
    workspaceId: identifier,
    activeLeaseEpoch: safePositiveInteger,
  })
  .strict()
  .superRefine(enforceAuthorizationSource);

const deviceAuditByScopeSchema = z.discriminatedUnion("scopeKind", [
  accountDeviceAuditEventSchema,
  workspaceDeviceAuditEventSchema,
]);

/** The preliminary literal parse prevents server-signed audit kinds from reaching scope selection. */
export const deviceAuditEventSchema = z
  .object({ auditEventKind: z.literal("device") })
  .passthrough()
  .pipe(deviceAuditByScopeSchema);

export function encodeDeviceAuditEventSignatureTranscript(value: unknown): Uint8Array {
  const parsed = deviceAuditEventSchema.parse(value);
  const { deviceSignature: _deviceSignature, ...eventWithoutSignature } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-DEVICE-AUDIT-EVENT-V1", eventWithoutSignature);
}

export type DeviceAuditEvent = z.infer<typeof deviceAuditEventSchema>;

/** Separate from the three-stream drain digest: this anchors the signed audit previousHash chain. */
export const DEVICE_AUDIT_CHAIN_GENESIS_INPUT = new TextEncoder().encode("GOODDEALER-DEVICE-AUDIT-CHAIN-GENESIS-V1");
export const DEVICE_AUDIT_CHAIN_GENESIS_DIGEST = "qNhif0AJWgKL2IWy5ylAUyTNimMebPbmmrUrz0U-NA8" as const;
export function encodeDeviceAuditEventHashInput(value: unknown): Uint8Array {
  const { eventHash: _hash, deviceSignature: _signature, ...event } = deviceAuditEventSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-DEVICE-AUDIT-EVENT-HASH-V1", event);
}

/** Fixed HTTP ingest forms remain representable as JSON Schema; the general v1 safe-value codec is unchanged. */
export const afternicWorkspaceDeviceAuditIngestSchema = z.object({
 ...deviceAuditCommonFields,scopeKind:z.literal("workspace"),workspaceId:identifier,activeLeaseEpoch:safePositiveInteger,
 payloadRedacted:z.union([afternicDelistApprovalAuditPayloadSchema,afternicDelistClaimAuditPayloadSchema,afternicDelistReconciledAuditPayloadSchema,afternicDelistPreflightRefusedAuditPayloadSchema,afternicListingWriteApprovalAuditPayloadSchema,afternicListingWriteClaimAuditPayloadSchema,afternicListingWriteReconciledAuditPayloadSchema,afternicListingWritePreflightRefusedAuditPayloadSchema, afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema, afternicListingPlanReconciledAuditPayloadSchema,
  afternicListingPlanPreflightRefusedAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema]),
}).strict().superRefine(enforceAuthorizationSource);
