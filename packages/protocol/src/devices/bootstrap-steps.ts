import { z } from "zod";

import {
  MAX_MUTATIONS_PER_PAGE,
  mutationCursorSchema,
  mutationPageSchema,
  sha256DigestSchema,
  workspaceEntityDigestsSchema,
  serverRevisionSchema,
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
  checkpointThroughServerRevision: serverRevisionSchema,
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
          pinnedCheckpointThroughServerRevision: serverRevisionSchema,
          pinnedCheckpointDigest: sha256DigestSchema,
          fromServerRevisionExclusive: serverRevisionSchema,
          throughServerRevisionInclusive: serverRevisionSchema,
          cursor: mutationCursorSchema.nullable(),
          pageLimit: z.number().int().min(1).max(MAX_MUTATIONS_PER_PAGE),
        })
        .strict(),
    })
    .strict()
    .superRefine((request, context) => {
      if (request.stepPayload.fromServerRevisionExclusive < request.stepPayload.pinnedCheckpointThroughServerRevision) {
        context.addIssue({
          code: "custom",
          path: ["stepPayload", "fromServerRevisionExclusive"],
          message: "mutation fetch cannot start before the pinned checkpoint",
        });
      }
      if (request.stepPayload.fromServerRevisionExclusive > request.stepPayload.throughServerRevisionInclusive) {
        context.addIssue({
          code: "custom",
          path: ["stepPayload", "throughServerRevisionInclusive"],
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
          targetServerRevision: serverRevisionSchema,
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
  nextStepNonce: base64Url.max(128).nullable(),
  resultDigest: sha256DigestSchema,
} as const;

export const bootstrapStepResultSchema = z
  .discriminatedUnion("stepKind", [
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
            verifiedRevision: serverRevisionSchema,
            verifiedDigest: sha256DigestSchema,
            accepted: z.literal(true),
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    const isTerminal = result.stepKind === "submit_rebuild_digest";
    if (isTerminal !== (result.nextStepNonce === null)) {
      context.addIssue({
        code: "custom",
        path: ["nextStepNonce"],
        message: "next step nonce must be null exactly when the bootstrap step is terminal",
      });
    }
  });

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

/** Complete replay identity; unlike requestDigest this intentionally includes nonce and digest. */
export function encodeBootstrapStepRequestReplayIdentity(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-BOOTSTRAP-STEP-REQUEST-REPLAY-V1",
    bootstrapStepRequestSchema.parse(value),
  );
}

/** Cloud persistence name for the complete strict request replay transcript. */
export const encodeBootstrapStepReplayRequest = encodeBootstrapStepRequestReplayIdentity;

/** Complete persisted result bytes used for byte-identical idempotent replay. */
export function encodeBootstrapStepResultReplayIdentity(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-BOOTSTRAP-STEP-RESULT-REPLAY-V1",
    bootstrapStepResultSchema.parse(value),
  );
}

export type BootstrapStepRequest = z.infer<typeof bootstrapStepRequestSchema>;
export type BootstrapStepResult = z.infer<typeof bootstrapStepResultSchema>;
