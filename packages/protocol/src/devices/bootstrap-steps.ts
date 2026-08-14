import { z } from "zod";

import {
  MAX_MUTATIONS_PER_PAGE,
  mutationCursorSchema,
  mutationPageSchema,
  sha256DigestSchema,
  workspaceEntityDigestsSchema,
  workspaceRevisionSchema,
} from "../workspace/index";
import {
  base64Url,
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";

export const BOOTSTRAP_STEP_SCHEMA_VERSION = 1 as const;

const requestFields = {
  schemaVersion: z.literal(BOOTSTRAP_STEP_SCHEMA_VERSION),
  deviceSwitchRequestId: identifier,
  capabilityJti: identifier,
  stepNumber: safePositiveInteger,
  stepNonce: base64Url.max(128),
  expectedWorkflowRevision: safeUnsignedInteger,
  requestDigest: sha256DigestSchema,
} as const;

const checkpointBindingFields = {
  checkpointId: identifier,
  checkpointRevision: workspaceRevisionSchema,
  checkpointDigest: sha256DigestSchema,
} as const;

export const bootstrapStepRequestSchema = z.discriminatedUnion("stepKind", [
  z
    .object({
      ...requestFields,
      stepKind: z.literal("pin_checkpoint"),
      stepPayload: z.object(checkpointBindingFields).strict(),
    })
    .strict(),
  z
    .object({
      ...requestFields,
      stepKind: z.literal("fetch_mutations"),
      stepPayload: z
        .object({
          pinnedCheckpointId: identifier,
          pinnedCheckpointRevision: workspaceRevisionSchema,
          pinnedCheckpointDigest: sha256DigestSchema,
          fromRevisionExclusive: workspaceRevisionSchema,
          throughRevisionInclusive: workspaceRevisionSchema,
          cursor: mutationCursorSchema.nullable(),
          pageLimit: z.number().int().min(1).max(MAX_MUTATIONS_PER_PAGE),
        })
        .strict(),
    })
    .strict()
    .superRefine((request, context) => {
      if (request.stepPayload.fromRevisionExclusive < request.stepPayload.pinnedCheckpointRevision) {
        context.addIssue({
          code: "custom",
          path: ["stepPayload", "fromRevisionExclusive"],
          message: "mutation fetch cannot start before the pinned checkpoint",
        });
      }
      if (request.stepPayload.fromRevisionExclusive > request.stepPayload.throughRevisionInclusive) {
        context.addIssue({
          code: "custom",
          path: ["stepPayload", "throughRevisionInclusive"],
          message: "mutation fetch revision bounds are inverted",
        });
      }
    }),
  z
    .object({
      ...requestFields,
      stepKind: z.literal("submit_rebuild_digest"),
      stepPayload: z
        .object({
          targetRevision: workspaceRevisionSchema,
          workspaceSchemaVersion: safePositiveInteger,
          entityDigests: workspaceEntityDigestsSchema,
        })
        .strict(),
    })
    .strict(),
]);

const resultFields = {
  schemaVersion: z.literal(BOOTSTRAP_STEP_SCHEMA_VERSION),
  workflowRevision: safePositiveInteger,
  acceptedStepNumber: safePositiveInteger,
  resultDigest: sha256DigestSchema,
} as const;

export const bootstrapStepResultSchema = z.discriminatedUnion("stepKind", [
  z
    .object({
      ...resultFields,
      stepKind: z.literal("pin_checkpoint"),
      resultPayload: z
        .object({
          ...checkpointBindingFields,
          pinExpiresAt: canonicalUtcTimestamp,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...resultFields,
      stepKind: z.literal("fetch_mutations"),
      resultPayload: z.object({ mutationPage: mutationPageSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...resultFields,
      stepKind: z.literal("submit_rebuild_digest"),
      resultPayload: z
        .object({
          verifiedRevision: workspaceRevisionSchema,
          verifiedDigest: sha256DigestSchema,
          accepted: z.literal(true),
        })
        .strict(),
    })
    .strict(),
]);

export function encodeBootstrapStepRequestDigestInput(value: unknown): Uint8Array {
  const parsed = bootstrapStepRequestSchema.parse(value);
  const { stepNonce: _stepNonce, requestDigest: _requestDigest, ...digestInput } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-STEP-REQUEST-V1", digestInput);
}

export function encodeBootstrapStepResultDigestInput(value: unknown): Uint8Array {
  const parsed = bootstrapStepResultSchema.parse(value);
  const { resultDigest: _resultDigest, ...digestInput } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-BOOTSTRAP-STEP-RESULT-V1", digestInput);
}

export type BootstrapStepRequest = z.infer<typeof bootstrapStepRequestSchema>;
export type BootstrapStepResult = z.infer<typeof bootstrapStepResultSchema>;
