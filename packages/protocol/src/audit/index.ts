import { z } from "zod";

import { sha256DigestSchema } from "../workspace/index";
import {
  base64Url,
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
} from "../wire/index";

/** Version of the closed server-audit wire contract. */
export const SERVER_AUDIT_EVENT_SCHEMA_VERSION = 1 as const;

const auditEventIdSchema = identifier;
const canonicalDigestSchema = sha256DigestSchema;

const auditEventKindSchema = z.enum(["user", "staff", "service"]);
const tenantScopeSchema = z.enum(["global", "account", "workspace"]);
const signingKeyPurposeSchema = z.enum(["user_audit", "staff_audit", "service_audit"]);

const chainDomainBaseFields = {
  auditEventKind: auditEventKindSchema,
  actorId: identifier,
} as const;

const globalServerAuditChainDomainSchema = z
  .object({
    ...chainDomainBaseFields,
    tenantScope: z.literal("global"),
    accountId: z.null(),
    workspaceId: z.null(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.auditEventKind === "user") {
      context.addIssue({
        code: "custom",
        path: ["auditEventKind"],
        message: "user audit chains cannot use the global scope",
      });
    }
  });

const accountServerAuditChainDomainSchema = z
  .object({
    ...chainDomainBaseFields,
    tenantScope: z.literal("account"),
    accountId: identifier,
    workspaceId: z.null(),
  })
  .strict();

const workspaceServerAuditChainDomainSchema = z
  .object({
    ...chainDomainBaseFields,
    tenantScope: z.literal("workspace"),
    accountId: identifier,
    workspaceId: identifier,
  })
  .strict();

const serverAuditChainDomainSchema = z.discriminatedUnion("tenantScope", [
  globalServerAuditChainDomainSchema,
  accountServerAuditChainDomainSchema,
  workspaceServerAuditChainDomainSchema,
]);

const userEventTypeSchema = z.enum([
  "account_session",
  "account_security",
  "device_binding",
  "data_rights",
]);

const staffEventTypeSchema = z.enum([
  "admin_read",
  "repair_command",
  "control",
  "security_incident_staff_action",
]);

const serviceEventTypeSchema = z.enum([
  "identity_defense",
  "device_admission",
  "security_incident",
  "compliance",
  "job",
  "notification",
  "audit_signing_key_transition",
]);

const userPayloadSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("account_session"),
      outcome: z.enum(["started", "refreshed", "revoked", "rejected"]),
      reason: z.enum([
        "user_requested",
        "security_epoch_advanced",
        "device_removed",
        "recovery_pending",
        "invalid_session",
      ]),
      sessionAuditRef: identifier.nullable(),
      securityEpoch: safePositiveInteger.nullable(),
      correlationRef: identifier.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("account_security"),
      outcome: z.enum(["accepted", "rejected", "revoked"]),
      reason: z.enum([
        "password_changed",
        "passkey_registered",
        "recovery_started",
        "recovery_completed",
        "reauth_required",
      ]),
      securityEpoch: safePositiveInteger,
      beforeDigest: canonicalDigestSchema.nullable(),
      afterDigest: canonicalDigestSchema.nullable(),
      correlationRef: identifier.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("device_binding"),
      outcome: z.enum(["requested", "bound", "removed", "rejected"]),
      reason: z.enum(["user_requested", "binding_limit", "reauth_required", "security_epoch_advanced"]),
      bindingAuditRef: identifier.nullable(),
      beforeDigest: canonicalDigestSchema.nullable(),
      afterDigest: canonicalDigestSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("data_rights"),
      outcome: z.enum(["requested", "verified", "frozen", "completed", "rejected"]),
      reason: z.enum(["export", "deletion", "identity_required", "legal_retention"]),
      dataRightsRequestRef: identifier,
      beforeDigest: canonicalDigestSchema.nullable(),
      afterDigest: canonicalDigestSchema.nullable(),
    })
    .strict(),
]);

const adminPurposeRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("support_case"), reference: identifier }).strict(),
  z.object({ kind: z.literal("data_rights_request"), reference: identifier }).strict(),
  z.object({ kind: z.literal("security_incident"), reference: identifier }).strict(),
]);

const staffPayloadSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("admin_read"),
      outcome: z.enum(["allowed", "denied"]),
      reason: z.enum(["purpose_authorized", "reauth_required", "scope_denied", "expired"]),
      adminPurposeRef: adminPurposeRefSchema,
      authorizationDigest: canonicalDigestSchema,
      targetDigest: canonicalDigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("repair_command"),
      outcome: z.enum(["accepted", "completed", "rejected"]),
      reason: z.enum(["authorized", "stale_revision", "target_denied", "failed"]),
      adminPurposeRef: adminPurposeRefSchema,
      authorizationDigest: canonicalDigestSchema,
      commandDigest: canonicalDigestSchema,
      beforeDigest: canonicalDigestSchema.nullable(),
      afterDigest: canonicalDigestSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("control"),
      controlArea: z.enum(["device", "license", "compliance"]),
      outcome: z.enum(["accepted", "completed", "rejected"]),
      reason: z.enum(["authorized", "stale_revision", "target_denied", "failed"]),
      adminPurposeRef: adminPurposeRefSchema,
      authorizationDigest: canonicalDigestSchema,
      controlDigest: canonicalDigestSchema,
      beforeDigest: canonicalDigestSchema.nullable(),
      afterDigest: canonicalDigestSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("security_incident_staff_action"),
      outcome: z.enum(["acknowledged", "contained", "rejected"]),
      reason: z.enum(["authorized", "incident_closed", "scope_denied", "stale_revision"]),
      incidentRef: identifier,
      authorizationDigest: canonicalDigestSchema,
      beforeDigest: canonicalDigestSchema.nullable(),
      afterDigest: canonicalDigestSchema.nullable(),
    })
    .strict(),
]);

const ordinaryServicePayloadSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("identity_defense"),
      outcome: z.enum(["detected", "contained", "rejected"]),
      reason: z.enum(["credential_risk", "session_risk", "account_recovery", "policy_denied"]),
      securityEventRef: identifier,
      evidenceDigest: canonicalDigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("device_admission"),
      outcome: z.enum(["admitted", "denied", "revoked"]),
      reason: z.enum(["binding_verified", "security_epoch_mismatch", "lease_denied", "policy_denied"]),
      admissionRef: identifier,
      evidenceDigest: canonicalDigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("security_incident"),
      outcome: z.enum(["opened", "contained", "closed", "rejected"]),
      reason: z.enum(["detection", "manual_review", "policy_denied", "stale_revision"]),
      incidentRef: identifier,
      evidenceDigest: canonicalDigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("compliance"),
      outcome: z.enum(["started", "advanced", "completed", "rejected"]),
      reason: z.enum(["export", "deletion", "legal_hold", "stale_revision"]),
      dataRightsRequestRef: identifier,
      lifecycleDigest: canonicalDigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("job"),
      outcome: z.enum(["started", "completed", "failed", "rejected"]),
      reason: z.enum(["authorized", "fence_stale", "authorization_rejected", "execution_failed"]),
      jobAuditRef: identifier,
      authorizationDigest: canonicalDigestSchema,
      outcomeDigest: canonicalDigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("notification"),
      outcome: z.enum(["sent", "suppressed", "failed"]),
      reason: z.enum(["requested", "deduplicated", "delivery_failed", "policy_denied"]),
      notificationAuditRef: identifier,
      resultCode: z.enum(["accepted", "deduplicated", "permanent_failure", "transient_failure"]),
      requestDigest: canonicalDigestSchema,
    })
    .strict(),
]);

const effectiveBoundarySchema = z
  .object({
    rule: z.literal("after_transition_commit"),
    transitionChainId: canonicalDigestSchema,
    transitionAuditSequence: safePositiveInteger,
    notBeforeOccurredAt: canonicalUtcTimestamp,
  })
  .strict();

const auditSigningKeyTransitionPayloadSchema = z
  .object({
    affectedSigningKeyPurpose: signingKeyPurposeSchema,
    affectedOutgoingPublicKeyId: identifier,
    affectedOutgoingPublicKeyVersion: safePositiveInteger,
    affectedIncomingPublicKeyId: identifier,
    affectedIncomingPublicKeyVersion: safePositiveInteger,
    effectiveBoundary: effectiveBoundarySchema,
    custodyApprovalDigest: canonicalDigestSchema,
  })
  .strict();

const auditSigningKeyTransitionDraftPayloadSchema = z
  .object({
    affectedSigningKeyPurpose: signingKeyPurposeSchema,
    affectedOutgoingPublicKeyId: identifier,
    affectedOutgoingPublicKeyVersion: safePositiveInteger,
    affectedIncomingPublicKeyId: identifier,
    affectedIncomingPublicKeyVersion: safePositiveInteger,
    custodyApprovalDigest: canonicalDigestSchema,
  })
  .strict();

const servicePayloadSchema = z.union([
  ordinaryServicePayloadSchema,
  auditSigningKeyTransitionPayloadSchema,
]);

const serviceDraftPayloadSchema = z.union([
  ordinaryServicePayloadSchema,
  auditSigningKeyTransitionDraftPayloadSchema,
]);

function enforceActionPayload(
  eventType: string,
  payload: { readonly action: string },
  context: z.RefinementCtx,
) {
  if (eventType !== payload.action) {
    context.addIssue({
      code: "custom",
      path: ["eventType"],
      message: "event type must match the closed redacted payload action",
    });
  }
}

function enforceNonSelfTransitionReference(
  event: { readonly auditEventId: string; readonly signing_key_transition_id: string | null },
  context: z.RefinementCtx,
) {
  if (event.signing_key_transition_id === event.auditEventId) {
    context.addIssue({
      code: "custom",
      path: ["signing_key_transition_id"],
      message: "a signed transition reference cannot point to the record itself",
    });
  }
}

function isTransitionPayload(
  payload: unknown,
): payload is z.infer<typeof auditSigningKeyTransitionPayloadSchema> {
  return auditSigningKeyTransitionPayloadSchema.safeParse(payload).success;
}

function isTransitionDraftPayload(
  payload: unknown,
): payload is z.infer<typeof auditSigningKeyTransitionDraftPayloadSchema> {
  return auditSigningKeyTransitionDraftPayloadSchema.safeParse(payload).success;
}

const persistedCommonFields = {
  schemaVersion: z.literal(SERVER_AUDIT_EVENT_SCHEMA_VERSION),
  auditEventId: auditEventIdSchema,
  targetType: identifier,
  targetRef: identifier,
  actorId: identifier,
  chainId: canonicalDigestSchema,
  auditSequence: safePositiveInteger,
  previousHash: canonicalDigestSchema,
  eventHash: canonicalDigestSchema,
  occurredAt: canonicalUtcTimestamp,
  authorizationContextHash: canonicalDigestSchema,
  cryptographicSignerKind: z.literal("gooddealer_audit_service"),
  cryptographicSignerId: identifier,
  signingKeyId: identifier,
  signingKeyVersion: safePositiveInteger,
  signatureTranscriptVersion: safePositiveInteger,
  serverSignature: base64Url.max(1024),
  signing_key_transition_id: auditEventIdSchema.nullable(),
} as const;

const userPersistedBaseFields = {
  ...persistedCommonFields,
  auditEventKind: z.literal("user"),
  eventType: userEventTypeSchema,
  actorKind: z.literal("user"),
  authorizationSource: z.literal("user_session"),
  signingKeyPurpose: z.literal("user_audit"),
  payloadRedacted: userPayloadSchema,
} as const;

const accountUserAuditEventSchema = z
  .object({
    ...userPersistedBaseFields,
    tenantScope: z.literal("account"),
    accountId: identifier,
    workspaceId: z.null(),
  })
  .strict()
  .superRefine((event, context) => {
    enforceActionPayload(event.eventType, event.payloadRedacted, context);
    enforceNonSelfTransitionReference(event, context);
  });

const workspaceUserAuditEventSchema = z
  .object({
    ...userPersistedBaseFields,
    tenantScope: z.literal("workspace"),
    accountId: identifier,
    workspaceId: identifier,
  })
  .strict()
  .superRefine((event, context) => {
    enforceActionPayload(event.eventType, event.payloadRedacted, context);
    enforceNonSelfTransitionReference(event, context);
  });

export const userAuditEventSchema = z.discriminatedUnion("tenantScope", [
  accountUserAuditEventSchema,
  workspaceUserAuditEventSchema,
]);

const staffPersistedBaseFields = {
  ...persistedCommonFields,
  auditEventKind: z.literal("staff"),
  eventType: staffEventTypeSchema,
  actorKind: z.literal("staff"),
  authorizationSource: z.enum(["admin_read_authorization", "admin_action_authorization"]),
  signingKeyPurpose: z.literal("staff_audit"),
  payloadRedacted: staffPayloadSchema,
} as const;

const globalStaffAuditEventSchema = z
  .object({
    ...staffPersistedBaseFields,
    tenantScope: z.literal("global"),
    accountId: z.null(),
    workspaceId: z.null(),
  })
  .strict()
  .superRefine((event, context) => {
    enforceActionPayload(event.eventType, event.payloadRedacted, context);
    enforceNonSelfTransitionReference(event, context);
  });

const accountStaffAuditEventSchema = z
  .object({
    ...staffPersistedBaseFields,
    tenantScope: z.literal("account"),
    accountId: identifier,
    workspaceId: z.null(),
  })
  .strict()
  .superRefine((event, context) => {
    enforceActionPayload(event.eventType, event.payloadRedacted, context);
    enforceNonSelfTransitionReference(event, context);
  });

const workspaceStaffAuditEventSchema = z
  .object({
    ...staffPersistedBaseFields,
    tenantScope: z.literal("workspace"),
    accountId: identifier,
    workspaceId: identifier,
  })
  .strict()
  .superRefine((event, context) => {
    enforceActionPayload(event.eventType, event.payloadRedacted, context);
    enforceNonSelfTransitionReference(event, context);
  });

export const staffAuditEventSchema = z.discriminatedUnion("tenantScope", [
  globalStaffAuditEventSchema,
  accountStaffAuditEventSchema,
  workspaceStaffAuditEventSchema,
]);

const servicePersistedBaseFields = {
  ...persistedCommonFields,
  auditEventKind: z.literal("service"),
  eventType: serviceEventTypeSchema,
  actorKind: z.literal("service"),
  authorizationSource: z.enum(["service_identity", "tenant_job_context"]),
  signingKeyPurpose: z.literal("service_audit"),
  payloadRedacted: servicePayloadSchema,
} as const;

function enforceServiceEvent(
  event: {
    readonly auditEventId: string;
    readonly eventType: z.infer<typeof serviceEventTypeSchema>;
    readonly authorizationSource: "service_identity" | "tenant_job_context";
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
    readonly signing_key_transition_id: string | null;
    readonly chainId: string;
    readonly auditSequence: number;
    readonly occurredAt: string;
  readonly payloadRedacted: z.infer<typeof servicePayloadSchema>;
  },
  context: z.RefinementCtx,
) {
  enforceNonSelfTransitionReference(event, context);
  if (event.eventType !== "audit_signing_key_transition") {
    if (!("action" in event.payloadRedacted)) {
      context.addIssue({
        code: "custom",
        path: ["payloadRedacted"],
        message: "ordinary service events require a closed action payload",
      });
      return;
    }
    enforceActionPayload(event.eventType, event.payloadRedacted, context);
    return;
  }

  if (!isTransitionPayload(event.payloadRedacted)) {
    context.addIssue({
      code: "custom",
      path: ["payloadRedacted"],
      message: "audit signing key transitions require the closed transition payload",
    });
    return;
  }

  const payload = event.payloadRedacted;
  if (event.authorizationSource !== "service_identity") {
    context.addIssue({
      code: "custom",
      path: ["authorizationSource"],
      message: "audit signing key transitions require service_identity authorization",
    });
  }
  if (event.signing_key_transition_id !== null) {
    context.addIssue({
      code: "custom",
      path: ["signing_key_transition_id"],
      message: "the outgoing-key transition record cannot link to itself",
    });
  }
  if (
    payload.effectiveBoundary.transitionChainId !== event.chainId
    || payload.effectiveBoundary.transitionAuditSequence !== event.auditSequence
    || payload.effectiveBoundary.notBeforeOccurredAt !== event.occurredAt
  ) {
    context.addIssue({
      code: "custom",
      path: ["payloadRedacted", "effectiveBoundary"],
      message: "effective boundary must bind this committed service-chain record",
    });
  }

  const affectedOutgoingMatchesRecordSigner =
    payload.affectedOutgoingPublicKeyId === event.signingKeyId
    && payload.affectedOutgoingPublicKeyVersion === event.signingKeyVersion;
  if (payload.affectedSigningKeyPurpose === "service_audit" && !affectedOutgoingMatchesRecordSigner) {
    context.addIssue({
      code: "custom",
      path: ["payloadRedacted", "affectedOutgoingPublicKeyId"],
      message: "service_audit transitions must bind their affected outgoing pair to the record signer",
    });
  }
  if (payload.affectedSigningKeyPurpose !== "service_audit" && affectedOutgoingMatchesRecordSigner) {
    context.addIssue({
      code: "custom",
      path: ["payloadRedacted", "affectedOutgoingPublicKeyId"],
      message: "only service_audit transitions may equate the affected outgoing pair to the record signer",
    });
  }
}

const globalServiceAuditEventSchema = z
  .object({
    ...servicePersistedBaseFields,
    tenantScope: z.literal("global"),
    accountId: z.null(),
    workspaceId: z.null(),
  })
  .strict()
  .superRefine(enforceServiceEvent);

const accountServiceAuditEventSchema = z
  .object({
    ...servicePersistedBaseFields,
    tenantScope: z.literal("account"),
    accountId: identifier,
    workspaceId: z.null(),
  })
  .strict()
  .superRefine(enforceServiceEvent);

const workspaceServiceAuditEventSchema = z
  .object({
    ...servicePersistedBaseFields,
    tenantScope: z.literal("workspace"),
    accountId: identifier,
    workspaceId: identifier,
  })
  .strict()
  .superRefine(enforceServiceEvent);

export const serviceAuditEventSchema = z.discriminatedUnion("tenantScope", [
  globalServiceAuditEventSchema,
  accountServiceAuditEventSchema,
  workspaceServiceAuditEventSchema,
]);

export const persistedServerAuditEventSchema = z.union([
  userAuditEventSchema,
  staffAuditEventSchema,
  serviceAuditEventSchema,
]);

const userAuditEventDraftSchema = z
  .object({
    schemaVersion: z.literal(SERVER_AUDIT_EVENT_SCHEMA_VERSION),
    auditEventKind: z.literal("user"),
    eventType: userEventTypeSchema,
    targetType: identifier,
    targetRef: identifier,
    payloadRedacted: userPayloadSchema,
  })
  .strict()
  .superRefine((event, context) => enforceActionPayload(event.eventType, event.payloadRedacted, context));

const staffAuditEventDraftSchema = z
  .object({
    schemaVersion: z.literal(SERVER_AUDIT_EVENT_SCHEMA_VERSION),
    auditEventKind: z.literal("staff"),
    eventType: staffEventTypeSchema,
    targetType: identifier,
    targetRef: identifier,
    payloadRedacted: staffPayloadSchema,
  })
  .strict()
  .superRefine((event, context) => enforceActionPayload(event.eventType, event.payloadRedacted, context));

const serviceAuditEventDraftSchema = z
  .object({
    schemaVersion: z.literal(SERVER_AUDIT_EVENT_SCHEMA_VERSION),
    auditEventKind: z.literal("service"),
    eventType: serviceEventTypeSchema,
    targetType: identifier,
    targetRef: identifier,
    payloadRedacted: serviceDraftPayloadSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.eventType !== "audit_signing_key_transition") {
      if (!("action" in event.payloadRedacted)) {
        context.addIssue({
          code: "custom",
          path: ["payloadRedacted"],
          message: "ordinary service drafts require a closed action payload",
        });
        return;
      }
      enforceActionPayload(event.eventType, event.payloadRedacted, context);
      return;
    }
    if (!isTransitionDraftPayload(event.payloadRedacted)) {
      context.addIssue({
        code: "custom",
        path: ["payloadRedacted"],
        message: "audit signing key transition drafts require the closed unsigned payload",
      });
    }
  });

/**
 * A draft carries only closed semantic action data. Context-derived identity/scope and all
 * chain, time, hash, signer, and signature fields are intentionally absent until append.
 */
export const serverAuditEventDraftSchema = z.discriminatedUnion("auditEventKind", [
  userAuditEventDraftSchema,
  staffAuditEventDraftSchema,
  serviceAuditEventDraftSchema,
]);

/** Deterministic domain bytes for the server-owned audit chain identity. */
export function encodeServerAuditChainDomain(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-SERVER-AUDIT-CHAIN-V1",
    serverAuditChainDomainSchema.parse(value),
  );
}

/**
 * Canonical event-hash input excludes only the self-referential event hash and the final
 * signature. It still binds the chain/head/time/signer facts and signing_key_transition_id.
 */
export function encodeServerAuditEventHashInput(value: unknown): Uint8Array {
  const parsed = persistedServerAuditEventSchema.parse(value);
  const { eventHash: _eventHash, serverSignature: _serverSignature, ...hashInput } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-SERVER-AUDIT-EVENT-V1", hashInput);
}

/**
 * Canonical signing input binds the computed event hash while excluding only its own final
 * signature field. Signing and verification remain outside this protocol-only package.
 */
export function encodeServerAuditEventSignatureTranscript(value: unknown): Uint8Array {
  const parsed = persistedServerAuditEventSchema.parse(value);
  const { serverSignature: _serverSignature, ...signatureInput } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-SERVER-AUDIT-SIGNATURE-V1", signatureInput);
}

export type PersistedServerAuditEvent = z.infer<typeof persistedServerAuditEventSchema>;
export type ServerAuditEventDraft = z.infer<typeof serverAuditEventDraftSchema>;
export type UserAuditEvent = z.infer<typeof userAuditEventSchema>;
export type StaffAuditEvent = z.infer<typeof staffAuditEventSchema>;
export type ServiceAuditEvent = z.infer<typeof serviceAuditEventSchema>;
export type ServerAuditChainDomain = z.infer<typeof serverAuditChainDomainSchema>;
