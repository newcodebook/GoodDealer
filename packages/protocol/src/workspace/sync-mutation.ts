import { z } from "zod";

import {
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";

export const WORKSPACE_SYNC_SCHEMA_VERSION = 1 as const;
export const MAX_MUTATIONS_PER_PAGE = 256 as const;

/** A SHA-256 value encoded as unpadded base64url. */
export const sha256DigestSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);

export const workspaceRevisionSchema = safeUnsignedInteger;

const tagSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "tags reject control characters")
  .refine((value) => value.trim() === value, "tags reject leading or trailing whitespace");

function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const sharedLength = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

const canonicalMoneySchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{0,7}[1-9])?$/),
  })
  .strict();

const domainAssetChangedFieldSchema = z.discriminatedUnion("fieldPath", [
  z
    .object({
      fieldPath: z.literal("note"),
      value: z
        .string()
        .max(10_000)
        .refine(
          (value) => !/[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value),
          "notes reject format and non-text control characters",
        )
        .nullable(),
    })
    .strict(),
  z.object({ fieldPath: z.literal("portfolioId"), value: identifier.nullable() }).strict(),
  z
    .object({ fieldPath: z.literal("tags"), value: z.array(tagSchema).max(128) })
    .strict()
    .superRefine((field, context) => {
      for (let index = 1; index < field.value.length; index += 1) {
        if (compareUtf8(field.value[index - 1]!, field.value[index]!) >= 0) {
          context.addIssue({
            code: "custom",
            path: ["value"],
            message: "tags must be unique and strictly ascending",
          });
          break;
        }
      }
    }),
  z.object({ fieldPath: z.literal("targetPrice"), value: canonicalMoneySchema.nullable() }).strict(),
]);

const changedFieldsSchema = z
  .array(domainAssetChangedFieldSchema)
  .min(1)
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

export const syncMutationSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SYNC_SCHEMA_VERSION),
    mutationId: identifier,
    workspaceId: identifier,
    workspaceSchemaVersion: safePositiveInteger,
    entityType: z.literal("domain_asset"),
    entityId: identifier,
    baseRevision: workspaceRevisionSchema,
    changedFields: changedFieldsSchema,
    sourceDeviceId: identifier,
    activeLeaseEpoch: safePositiveInteger,
    mutationSequence: safePositiveInteger,
    serverRevision: safePositiveInteger,
  })
  .strict()
  .superRefine((mutation, context) => {
    if (mutation.baseRevision >= mutation.serverRevision) {
      context.addIssue({
        code: "custom",
        path: ["baseRevision"],
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
    throughRevision: workspaceRevisionSchema,
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
  .max(256)
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
    fromRevisionExclusive: workspaceRevisionSchema,
    throughRevisionInclusive: workspaceRevisionSchema,
    mutations: z.array(syncMutationSchema).max(MAX_MUTATIONS_PER_PAGE),
    returnedThroughRevision: workspaceRevisionSchema,
    nextCursor: mutationCursorSchema.nullable(),
    pageDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((page, context) => {
    if (page.fromRevisionExclusive > page.throughRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["throughRevisionInclusive"],
        message: "page revision bounds are inverted",
      });
    }

    let expectedRevision = page.fromRevisionExclusive + 1;
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
        ? page.fromRevisionExclusive
        : page.mutations[page.mutations.length - 1]!.serverRevision;
    if (page.returnedThroughRevision !== expectedReturnedRevision) {
      context.addIssue({
        code: "custom",
        path: ["returnedThroughRevision"],
        message: "returned revision must equal the last mutation revision",
      });
    }
    if (page.returnedThroughRevision > page.throughRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["returnedThroughRevision"],
        message: "page returned beyond its pinned target revision",
      });
    }
    if (page.nextCursor === null && page.returnedThroughRevision !== page.throughRevisionInclusive) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "a terminal page must reach the pinned target revision",
      });
    }
    if (page.nextCursor !== null && page.returnedThroughRevision >= page.throughRevisionInclusive) {
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

export type WorkspaceRevision = z.infer<typeof workspaceRevisionSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type CheckpointDescriptor = z.infer<typeof checkpointDescriptorSchema>;
export type MutationPage = z.infer<typeof mutationPageSchema>;
export type WorkspaceEntityDigest = z.infer<typeof workspaceEntityDigestSchema>;
