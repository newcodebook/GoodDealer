import { z } from "zod";

import { identifier, safePositiveInteger } from "../wire/index";
import {
  MAX_MUTATIONS_PER_PAGE,
  WORKSPACE_SYNC_SCHEMA_VERSION,
  checkpointDescriptorSchema,
  mutationCursorSchema,
  mutationPageSchema,
  serverRevisionSchema,
  tenantNeutralSubmittedSyncMutationSchema,
} from "./sync-mutation";

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
          previous.activeLeaseEpoch !== mutation.activeLeaseEpoch ||
          mutation.deviceMutationSequence !== previous.deviceMutationSequence + 1)
      ) {
        context.addIssue({
          code: "custom",
          path: ["mutations", index, "deviceMutationSequence"],
          message: "a push must contain one contiguous device and lease stream",
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
  "WORKSPACE_TENANT_UNRESOLVED",
  "AUTHORIZATION_REJECTED",
  "MUTATION_MALFORMED",
  "MUTATION_SCHEMA_VERSION_UNSUPPORTED",
  "MUTATION_BATCH_UNORDERED",
  "MUTATION_ID_CONFLICT",
  "MUTATION_SEQUENCE_CONFLICT",
  "MUTATION_ENTITY_UNKNOWN",
  "MUTATION_BASE_REVISION_AHEAD",
  "MUTATION_FIELD_STALE",
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
    pageLimit: safePositiveInteger.max(MAX_MUTATIONS_PER_PAGE),
  })
  .strict();

export const workspaceMutationPullRejectionCodeSchema = z.enum([
  "WORKSPACE_TENANT_UNRESOLVED",
  "AUTHORIZATION_REJECTED",
  "MUTATION_CURSOR_MISMATCH",
  "MUTATION_PAGE_COMPACTED",
]);

export const workspaceMutationPullResponseSchema = z.discriminatedUnion("accepted", [
  z
    .object({
      schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
      accepted: z.literal(true),
      page: mutationPageSchema,
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
export const workspaceCheckpointReadResponseSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    checkpoint: checkpointDescriptorSchema.nullable(),
  })
  .strict();

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
export type WorkspaceCheckpointReadRequest = z.infer<typeof workspaceCheckpointReadRequestSchema>;
export type WorkspaceCheckpointReadResponse = z.infer<typeof workspaceCheckpointReadResponseSchema>;
