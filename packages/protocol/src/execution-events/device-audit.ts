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

export const DEVICE_AUDIT_EVENT_SCHEMA_VERSION = 1 as const;

const redactedWireValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    safeUnsignedInteger,
    z.string().max(16_384),
    z.array(redactedWireValueSchema).max(256),
    z.record(identifier, redactedWireValueSchema),
  ]),
);

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
