import { z } from "zod";

import {
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";
import {
  canonicalMoneySchema,
  domainAssetIdSchema,
  domainAssetNoteSchema,
  domainAssetTagsSchema,
} from "./domain-asset-fields";

export const WORKSPACE_SYNC_SCHEMA_VERSION = 1 as const;
export const MAX_MUTATIONS_PER_PAGE = 256 as const;

/** A SHA-256 value encoded as unpadded base64url. */
export const sha256DigestSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);

export const serverRevisionSchema = safeUnsignedInteger;

const domainAssetChangedFieldSchema = z.discriminatedUnion("fieldPath", [
  z
    .object({
      fieldPath: z.literal("note"),
      value: domainAssetNoteSchema.nullable(),
    })
    .strict(),
  z.object({ fieldPath: z.literal("portfolioId"), value: identifier.nullable() }).strict(),
  z.object({ fieldPath: z.literal("tags"), value: domainAssetTagsSchema }).strict(),
  z.object({ fieldPath: z.literal("targetPrice"), value: canonicalMoneySchema.nullable() }).strict(),
]);

const changedFieldsSchema = z
  .array(domainAssetChangedFieldSchema)
  .max(4)
  .superRefine((fields, context) => {
    for (let index = 1; index < fields.length; index += 1) {
      if (fields[index - 1]!.fieldPath >= fields[index]!.fieldPath) {
        context.addIssue({
          code: "custom",
          path: [index, "fieldPath"],
          message: "changed fields must be unique and strictly ascending",
        });
        break;
      }
    }
  });

export const workspaceFieldMetadata = {
  "domain_asset.note": { privacyClass: "SENSITIVE_BUSINESS", mergeClass: "manual" },
  "domain_asset.portfolioId": { privacyClass: "PUBLIC_BUSINESS", mergeClass: "auto" },
  "domain_asset.tags": { privacyClass: "PUBLIC_BUSINESS", mergeClass: "auto" },
  "domain_asset.targetPrice": { privacyClass: "PUBLIC_BUSINESS", mergeClass: "manual" },
} as const;

const submittedSyncMutationFields = {
  schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
  mutationId: identifier,
  workspaceId: identifier,
  workspaceSchemaVersion: safePositiveInteger,
  entityType: z.literal("domain_asset"),
  entityId: domainAssetIdSchema,
  operationKind: z.enum(["upsert", "delete"]).optional(),
  deletedAt: canonicalUtcTimestamp.optional(),
  baseServerRevision: serverRevisionSchema,
  changedFields: changedFieldsSchema,
  sourceDeviceId: identifier,
  activeLeaseEpoch: safePositiveInteger,
  deviceMutationSequence: safePositiveInteger,
} as const;

/** The device-committed mutation before Cloud assigns its server revision. */
export const submittedSyncMutationSchema = z.object(submittedSyncMutationFields).strict()
  .superRefine((mutation, context) => {
    const operationKind = mutation.operationKind ?? "upsert";
    if (operationKind === "upsert") {
      if (mutation.changedFields.length === 0) {
        context.addIssue({ code: "custom", path: ["changedFields"], message: "upsert requires changed fields" });
      }
      if (mutation.deletedAt !== undefined) {
        context.addIssue({ code: "custom", path: ["deletedAt"], message: "upsert cannot carry deletion time" });
      }
    } else {
      if (mutation.changedFields.length !== 0) {
        context.addIssue({ code: "custom", path: ["changedFields"], message: "delete cannot carry changed fields" });
      }
      if (mutation.deletedAt === undefined) {
        context.addIssue({ code: "custom", path: ["deletedAt"], message: "delete requires deletion time" });
      }
    }
  });

export const syncMutationSchema = submittedSyncMutationSchema
  .safeExtend({ serverRevision: safePositiveInteger })
  .strict()
  .superRefine((mutation, context) => {
    if (mutation.baseServerRevision >= mutation.serverRevision) {
      context.addIssue({
        code: "custom",
        path: ["baseServerRevision"],
        message: "base revision must precede the assigned server revision",
      });
    }
  });

export const checkpointDescriptorSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    checkpointId: identifier,
    workspaceId: identifier,
    workspaceSchemaVersion: safePositiveInteger,
    throughServerRevision: serverRevisionSchema,
    checkpointDigest: sha256DigestSchema,
  })
  .strict();

export const workspaceEntityDigestSchema = z
  .object({
    entityType: z.literal("domain_asset"),
    partitionId: identifier.nullable(),
    digest: sha256DigestSchema,
  })
  .strict();

export const workspaceEntityDigestsSchema = z
  .array(workspaceEntityDigestSchema)
  .min(1)
  .max(4_096)
  .superRefine((digests, context) => {
    const keys = digests.map(({ entityType, partitionId }) => `${entityType}\u0000${partitionId ?? ""}`);
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "entity digests must be unique and strictly ascending",
        });
        break;
      }
    }
  });

export const mutationCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);

export const mutationPageSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    workspaceId: identifier,
    fromServerRevisionExclusive: serverRevisionSchema,
    throughServerRevisionInclusive: serverRevisionSchema,
    mutations: z.array(syncMutationSchema).max(MAX_MUTATIONS_PER_PAGE),
    returnedThroughServerRevision: serverRevisionSchema,
    nextCursor: mutationCursorSchema.nullable(),
    pageDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((page, context) => {
    if (page.fromServerRevisionExclusive > page.throughServerRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["throughServerRevisionInclusive"],
        message: "page revision bounds are inverted",
      });
    }

    let expectedRevision = page.fromServerRevisionExclusive + 1;
    for (let index = 0; index < page.mutations.length; index += 1) {
      const mutation = page.mutations[index]!;
      if (mutation.workspaceId !== page.workspaceId) {
        context.addIssue({
          code: "custom",
          path: ["mutations", index, "workspaceId"],
          message: "every mutation must belong to the page workspace",
        });
      }
      if (mutation.serverRevision !== expectedRevision) {
        context.addIssue({
          code: "custom",
          path: ["mutations", index, "serverRevision"],
          message: "mutation revisions must be contiguous",
        });
      }
      expectedRevision += 1;
    }

    const expectedReturnedRevision =
      page.mutations.length === 0
        ? page.fromServerRevisionExclusive
        : page.mutations[page.mutations.length - 1]!.serverRevision;
    if (page.returnedThroughServerRevision !== expectedReturnedRevision) {
      context.addIssue({
        code: "custom",
        path: ["returnedThroughServerRevision"],
        message: "returned revision must equal the last mutation revision",
      });
    }
    if (page.returnedThroughServerRevision > page.throughServerRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["returnedThroughServerRevision"],
        message: "page returned beyond its pinned target revision",
      });
    }
    if (page.nextCursor === null && page.returnedThroughServerRevision !== page.throughServerRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "a terminal page must reach the pinned target revision",
      });
    }
    if (page.nextCursor !== null && page.returnedThroughServerRevision >= page.throughServerRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "a continuation cursor requires remaining revisions",
      });
    }
  });

export function encodeMutationPageDigestInput(value: unknown): Uint8Array {
  const parsed = mutationPageSchema.parse(value);
  const { pageDigest: _pageDigest, ...digestInput } = parsed;
  return encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-MUTATION-PAGE-V1", digestInput);
}

export function encodeWorkspaceEntityDigestsInput(value: unknown): Uint8Array {
  const parsed = workspaceEntityDigestsSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-ENTITY-DIGESTS-V1", parsed);
}

export type WorkspaceRevision = z.infer<typeof serverRevisionSchema>;
export type SubmittedSyncMutation = z.infer<typeof submittedSyncMutationSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type CheckpointDescriptor = z.infer<typeof checkpointDescriptorSchema>;
export type MutationPage = z.infer<typeof mutationPageSchema>;
export type WorkspaceEntityDigest = z.infer<typeof workspaceEntityDigestSchema>;
