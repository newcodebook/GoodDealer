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

export const EXECUTION_FACT_SCHEMA_VERSION = 1 as const;

export const executionAuthorizationEvidenceSchema = z
  .object({
    approvedOperationDigest: sha256DigestSchema,
    approvedOperationEnvelope: base64Url.max(8192),
    signingKeyId: identifier,
    signingKeyVersion: safePositiveInteger,
    credentialEpoch: safePositiveInteger,
    signatureTranscriptVersion: safePositiveInteger,
  })
  .strict();

export const executionFactSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_FACT_SCHEMA_VERSION),
    executionFactId: identifier,
    operationId: identifier,
    operationItemId: identifier,
    workflowNodeId: identifier,
    attemptId: identifier,
    attemptNo: safePositiveInteger,
    approvedOperationId: identifier,
    planHash: sha256DigestSchema,
    idempotencyKeyHash: sha256DigestSchema,
    sourceDeviceId: identifier,
    workspaceId: identifier,
    activeLeaseEpoch: safePositiveInteger,
    executionSequence: safePositiveInteger,
    eventType: identifier,
    evidenceLevel: identifier,
    occurredAt: canonicalUtcTimestamp,
    signingKeyId: identifier,
    signingKeyVersion: safePositiveInteger,
    credentialEpoch: safePositiveInteger,
    trustedTimeAnchorId: identifier,
    monotonicDeltaMs: safeUnsignedInteger,
    requestStartBoundary: canonicalUtcTimestamp,
    authorizationHash: sha256DigestSchema,
    executionAuthorizationEvidence: executionAuthorizationEvidenceSchema,
    signatureTranscriptVersion: safePositiveInteger,
    payloadRedacted: redactedWireValueSchema,
    auditEventRef: identifier,
    auditEventHash: sha256DigestSchema,
    deviceSignature: base64Url.max(1024),
  })
  .strict();

export function encodeExecutionFactSignatureTranscript(value: unknown): Uint8Array {
  const parsed = executionFactSchema.parse(value);
  const { deviceSignature: _deviceSignature, ...factWithoutSignature } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-EXECUTION-FACT-V1", factWithoutSignature);
}

export type ExecutionAuthorizationEvidence = z.infer<typeof executionAuthorizationEvidenceSchema>;
export type ExecutionFact = z.infer<typeof executionFactSchema>;
