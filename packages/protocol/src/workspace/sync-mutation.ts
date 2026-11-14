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

/**
 * Checkpoint and rebootstrap wire. Version 1 is intentionally not accepted. ADR-0029 C1b moves it
 * to 3 together with generation-bearing snapshots and tombstones.
 */
export const WORKSPACE_SYNC_SCHEMA_VERSION = 2 as const;
/**
 * Mutation, push and pull wire. Version 3 (ADR-0029) makes every DomainAsset mutation carry its
 * entity generation; version 2 requests are refused as unsupported, never upgraded in place.
 */
export const WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION = 3 as const;
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

const submittedSyncMutationPrefixFields = {
  schemaVersion: z.literal(WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION),
  mutationId: identifier,
} as const;

const submittedSyncMutationSuffixFields = {
  workspaceSchemaVersion: safePositiveInteger,
  entityType: z.literal("domain_asset"),
  entityId: domainAssetIdSchema,
  /** ADR-0029: first add is 1, delete keeps it, a re-add is the tombstone's generation + 1. */
  entityGeneration: safePositiveInteger,
  /** ADR-0029: only on a re-add, the deletion revision of the tombstone it supersedes. */
  reAddsDeletedRevision: safePositiveInteger.optional(),
  operationKind: z.enum(["upsert", "delete"]),
  deletedAt: canonicalUtcTimestamp.optional(),
  baseServerRevision: serverRevisionSchema,
  changedFields: changedFieldsSchema,
  sourceDeviceId: identifier,
  activeLeaseEpoch: safePositiveInteger,
  deviceMutationSequence: safePositiveInteger,
} as const;

function validateSubmittedSyncMutation(
  mutation: {
    operationKind: "upsert" | "delete";
    deletedAt?: string | undefined;
    changedFields: readonly unknown[];
    entityGeneration: number;
    reAddsDeletedRevision?: number | undefined;
    baseServerRevision: number;
  },
  context: z.RefinementCtx,
) {
  const operationKind = mutation.operationKind;
  if (mutation.reAddsDeletedRevision !== undefined) {
    // A re-add is an upsert that builds on the deletion it supersedes (R <= base) and names the
    // generation after the tombstone's, which is at least 1.
    if (operationKind !== "upsert") {
      context.addIssue({ code: "custom", path: ["reAddsDeletedRevision"], message: "only an upsert can re-add" });
    }
    if (mutation.entityGeneration < 2) {
      context.addIssue({ code: "custom", path: ["entityGeneration"], message: "a re-add names a later generation" });
    }
    if (mutation.reAddsDeletedRevision > mutation.baseServerRevision) {
      context.addIssue({
        code: "custom",
        path: ["reAddsDeletedRevision"],
        message: "a re-add must build on the deletion it supersedes",
      });
    }
  }
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
}

/** Tenant-neutral mutation accepted by the Cloud wire boundary. */
export const tenantNeutralSubmittedSyncMutationSchema = z
  .object({
    ...submittedSyncMutationPrefixFields,
    ...submittedSyncMutationSuffixFields,
  })
  .strict()
  .superRefine(validateSubmittedSyncMutation);

/** The device-committed mutation before Cloud assigns its server revision. */
export const submittedSyncMutationSchema = z
  .object({
    ...submittedSyncMutationPrefixFields,
    workspaceId: identifier,
    ...submittedSyncMutationSuffixFields,
  })
  .strict()
  .superRefine(validateSubmittedSyncMutation);

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
    schemaVersion: z.literal(WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION),
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
  return encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-MUTATION-PAGE-V2", digestInput);
}

export function encodeWorkspaceEntityDigestsInput(value: unknown): Uint8Array {
  const parsed = workspaceEntityDigestsSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-ENTITY-DIGESTS-V2", parsed);
}

/**
 * Canonical Cloud idempotency transcript for a Host-projected mutation.
 * Workspace identity is deliberately excluded; tenant scope comes from the bearer session.
 * The strict v2 shape requires operationKind so one semantic mutation has one transcript.
 */
export function encodeSubmittedSyncMutationDigestInput(value: unknown): Uint8Array {
  const parsed = tenantNeutralSubmittedSyncMutationSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-MUTATION-V2", parsed);
}

/**
 * ADR-0029: wire v2 carried no generation. Mutations accepted under it keep their v2 digest and
 * canonical bytes as immutable evidence, so retained receipts and records are compared against
 * the v2 form derived here from the current form. Only a generation-1 mutation without a re-add
 * has a v2 form; anything else fails closed. Nothing is ever submitted in this form.
 */
export function toLegacyV2SubmittedSyncMutation<Mutation extends {
  readonly schemaVersion: number;
  readonly entityGeneration: number;
  readonly reAddsDeletedRevision?: number | undefined;
}>(mutation: Mutation): Omit<Mutation, "schemaVersion" | "entityGeneration" | "reAddsDeletedRevision"> & {
  readonly schemaVersion: 2;
} {
  if (mutation.entityGeneration !== 1 || mutation.reAddsDeletedRevision !== undefined) {
    throw new TypeError("only a first-generation mutation without a re-add has a wire v2 form");
  }
  const {
    schemaVersion: _schemaVersion,
    entityGeneration: _entityGeneration,
    reAddsDeletedRevision: _reAddsDeletedRevision,
    ...rest
  } = mutation;
  return { ...rest, schemaVersion: 2 };
}

export function encodeLegacyV2SubmittedSyncMutationDigestInput(value: unknown): Uint8Array {
  const parsed = tenantNeutralSubmittedSyncMutationSchema.parse(value);
  return encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-MUTATION-V2", toLegacyV2SubmittedSyncMutation(parsed));
}

export type WorkspaceRevision = z.infer<typeof serverRevisionSchema>;
export type SubmittedSyncMutation = z.infer<typeof submittedSyncMutationSchema>;
export type TenantNeutralSubmittedSyncMutation = z.infer<
  typeof tenantNeutralSubmittedSyncMutationSchema
>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type CheckpointDescriptor = z.infer<typeof checkpointDescriptorSchema>;
export type MutationPage = z.infer<typeof mutationPageSchema>;
export type WorkspaceEntityDigest = z.infer<typeof workspaceEntityDigestSchema>;
