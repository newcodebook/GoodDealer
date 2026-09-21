import { z } from "zod";

import { canonicalUtcTimestamp, encodeDomainSeparatedWireValue, identifier, safePositiveInteger } from "../wire/index";
import {
  MAX_MUTATIONS_PER_PAGE,
  WORKSPACE_SYNC_SCHEMA_VERSION,
  checkpointDescriptorSchema,
  mutationCursorSchema,
  mutationPageSchema,
  sha256DigestSchema,
  serverRevisionSchema,
  tenantNeutralSubmittedSyncMutationSchema,
} from "./sync-mutation";
import { domainAssetProjectionSchema } from "./domain-asset-projection";

export const WORKSPACE_SYNC_PUSH_OPERATION_ID = "workspace.sync.mutations.push" as const;
export const WORKSPACE_SYNC_PULL_OPERATION_ID = "workspace.sync.mutations.pull" as const;
export const WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID = "workspace.sync.checkpoint.read" as const;
export const DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID =
  "workspace.sync.domainAssetReplica.recover" as const;

export const workspaceSyncOperationSchema = z.enum([
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
]);

export const workspaceMutationPushRequestSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    mutations: z
      .array(tenantNeutralSubmittedSyncMutationSchema)
      .min(1)
      .max(MAX_MUTATIONS_PER_PAGE),
  })
  .strict()
  .superRefine(({ mutations }, context) => {
    const ids = new Set<string>();
    for (let index = 0; index < mutations.length; index += 1) {
      const mutation = mutations[index]!;
      if (ids.has(mutation.mutationId)) {
        context.addIssue({
          code: "custom",
          path: ["mutations", index, "mutationId"],
          message: "mutation ids must be unique within a push",
        });
      }
      ids.add(mutation.mutationId);
      const previous = mutations[index - 1];
      if (
        previous !== undefined &&
        (previous.sourceDeviceId !== mutation.sourceDeviceId ||
          mutation.deviceMutationSequence !== previous.deviceMutationSequence + 1)
      ) {
        context.addIssue({
          code: "custom",
          path: ["mutations", index, "deviceMutationSequence"],
          message: "a push must contain one contiguous global device stream",
        });
      }
    }
  });

export const workspaceMutationAcknowledgementSchema = z
  .object({
    mutationId: identifier,
    deviceMutationSequence: safePositiveInteger,
    serverRevision: safePositiveInteger,
    duplicate: z.boolean(),
  })
  .strict();

export const workspaceMutationPushRejectionCodeSchema = z.enum([
  "SYNC_SCHEMA_UNSUPPORTED",
  "SYNC_INPUT_REJECTED",
  "SYNC_AUTHORIZATION_REJECTED",
  "SYNC_TENANT_UNRESOLVED",
  "SYNC_IDEMPOTENCY_CONFLICT",
  "SYNC_STORAGE_REJECTED",
]);

export const workspaceMutationPushResponseSchema = z.discriminatedUnion("accepted", [
  z
    .object({
      schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
      accepted: z.literal(true),
      acknowledgements: z.array(workspaceMutationAcknowledgementSchema).max(MAX_MUTATIONS_PER_PAGE),
      headServerRevision: serverRevisionSchema,
    })
    .strict()
    .superRefine(({ acknowledgements, headServerRevision }, context) => {
      for (let index = 1; index < acknowledgements.length; index += 1) {
        const previous = acknowledgements[index - 1]!;
        const current = acknowledgements[index]!;
        if (
          current.deviceMutationSequence !== previous.deviceMutationSequence + 1 ||
          current.serverRevision <= previous.serverRevision
        ) {
          context.addIssue({
            code: "custom",
            path: ["acknowledgements", index],
            message: "acknowledgements must preserve contiguous device order and increasing revisions",
          });
        }
      }
      const last = acknowledgements.at(-1);
      if (last !== undefined && headServerRevision < last.serverRevision) {
        context.addIssue({
          code: "custom",
          path: ["headServerRevision"],
          message: "the workspace head cannot precede an acknowledged revision",
        });
      }
    }),
  z
    .object({
      schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
      accepted: z.literal(false),
      code: workspaceMutationPushRejectionCodeSchema,
      correlationId: identifier,
    })
    .strict(),
]);

export const workspaceMutationPullRequestSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    afterServerRevision: serverRevisionSchema,
    cursor: mutationCursorSchema.nullable(),
    confirm: mutationCursorSchema.nullable(),
    pageLimit: safePositiveInteger.max(MAX_MUTATIONS_PER_PAGE),
  })
  .strict();

export const workspaceMutationPullRejectionCodeSchema = z.enum([
  "SYNC_SCHEMA_UNSUPPORTED",
  "SYNC_INPUT_REJECTED",
  "SYNC_AUTHORIZATION_REJECTED",
  "SYNC_TENANT_UNRESOLVED",
  "SYNC_CURSOR_CONFLICT",
  "SYNC_REBOOTSTRAP_REQUIRED",
  "SYNC_STORAGE_REJECTED",
]);

/** Durable Cloud delivery proof. Tokens are opaque and never interpreted by Desktop. */
export const pendingDeliverySchema = z
  .object({
    generation: safePositiveInteger,
    fromServerRevisionExclusive: serverRevisionSchema,
    throughServerRevisionInclusive: serverRevisionSchema,
    targetServerRevision: serverRevisionSchema,
    pageDigest: sha256DigestSchema,
    nextCursorDigest: sha256DigestSchema.nullable(),
    predecessorConfirmationDigest: sha256DigestSchema.nullable(),
    expiresAt: canonicalUtcTimestamp,
  })
  .strict()
  .superRefine((delivery, context) => {
    if (delivery.fromServerRevisionExclusive > delivery.throughServerRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["throughServerRevisionInclusive"],
        message: "delivery revision bounds are inverted",
      });
    }
    if (delivery.throughServerRevisionInclusive > delivery.targetServerRevision) {
      context.addIssue({
        code: "custom",
        path: ["targetServerRevision"],
        message: "delivery cannot exceed its pinned target",
      });
    }
  });

export const workspaceMutationPullResponseSchema = z.discriminatedUnion("accepted", [
  z
    .object({
      schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
      accepted: z.literal(true),
      page: mutationPageSchema,
      confirmedThrough: serverRevisionSchema,
      pendingDelivery: pendingDeliverySchema,
      confirmToken: mutationCursorSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
      accepted: z.literal(false),
      code: workspaceMutationPullRejectionCodeSchema,
      checkpoint: checkpointDescriptorSchema.nullable(),
      correlationId: identifier,
    })
    .strict(),
]);

/** The authenticated server binding selects the workspace whose checkpoint is returned. */
export const workspaceCheckpointReadRequestSchema = z
  .object({ schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION) })
  .strict();
export const workspaceRebootstrapRequestSchema = z
  .object({ schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION) })
  .strict();
export const workspaceCheckpointReadResponseSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    checkpoint: checkpointDescriptorSchema.nullable(),
  })
  .strict();

/** Bounded, tenant-derived evidence consumed by Desktop rebootstrap staging. */
export const rebootstrapPlanSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    checkpoint: checkpointDescriptorSchema,
    snapshot: domainAssetProjectionSchema,
    requiredMutationRange: z.object({
      fromServerRevisionExclusive: serverRevisionSchema,
      throughServerRevisionInclusive: serverRevisionSchema,
    }).strict(),
    mutations: z.array(mutationPageSchema).max(4_096),
    pinnedHeadRevision: serverRevisionSchema,
    pinnedHeadDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    const range = plan.requiredMutationRange;
    if (range.throughServerRevisionInclusive < range.fromServerRevisionExclusive) {
      context.addIssue({ code: "custom", path: ["requiredMutationRange"], message: "mutation range is inverted" });
    }
    if (plan.checkpoint.throughServerRevision !== range.fromServerRevisionExclusive) {
      context.addIssue({ code: "custom", path: ["checkpoint", "throughServerRevision"], message: "checkpoint does not anchor the required range" });
    }
    if (plan.pinnedHeadRevision < range.throughServerRevisionInclusive) {
      context.addIssue({ code: "custom", path: ["pinnedHeadRevision"], message: "pinned head precedes required range" });
    }
    let expected = range.fromServerRevisionExclusive;
    for (const page of plan.mutations) {
      if (page.workspaceId !== plan.checkpoint.workspaceId || page.fromServerRevisionExclusive !== expected) {
        context.addIssue({ code: "custom", path: ["mutations"], message: "mutation pages are not contiguous and workspace-bound" });
        break;
      }
      expected = page.returnedThroughServerRevision;
    }
    if (expected !== range.throughServerRevisionInclusive) {
      context.addIssue({ code: "custom", path: ["mutations"], message: "required mutation range is incomplete" });
    }
  });

export function encodeRebootstrapPlanDigestInput(value: unknown): Uint8Array {
  const parsed = rebootstrapPlanSchema.parse(value);
  const { pinnedHeadDigest: _digest, ...input } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-REBOOTSTRAP-PLAN-V2", input);
}

export type WorkspaceSyncOperation = z.infer<typeof workspaceSyncOperationSchema>;
export type WorkspaceMutationPushRequest = z.infer<typeof workspaceMutationPushRequestSchema>;
export type WorkspaceMutationAcknowledgement = z.infer<
  typeof workspaceMutationAcknowledgementSchema
>;
export type WorkspaceMutationPushRejectionCode = z.infer<
  typeof workspaceMutationPushRejectionCodeSchema
>;
export type WorkspaceMutationPushResponse = z.infer<typeof workspaceMutationPushResponseSchema>;
export type WorkspaceMutationPullRequest = z.infer<typeof workspaceMutationPullRequestSchema>;
export type WorkspaceMutationPullRejectionCode = z.infer<
  typeof workspaceMutationPullRejectionCodeSchema
>;
export type WorkspaceMutationPullResponse = z.infer<typeof workspaceMutationPullResponseSchema>;
export type PendingDelivery = z.infer<typeof pendingDeliverySchema>;
export type WorkspaceCheckpointReadRequest = z.infer<typeof workspaceCheckpointReadRequestSchema>;
export type WorkspaceCheckpointReadResponse = z.infer<typeof workspaceCheckpointReadResponseSchema>;
export type WorkspaceRebootstrapRequest = z.infer<typeof workspaceRebootstrapRequestSchema>;
export type RebootstrapPlan = z.infer<typeof rebootstrapPlanSchema>;
