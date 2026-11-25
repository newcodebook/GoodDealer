import { z } from "zod";

import { canonicalUtcTimestamp, encodeDomainSeparatedWireValue, safePositiveInteger } from "../wire/index";
import { compareUtf8, domainAssetIdSchema } from "./domain-asset-fields";
import {
  DOMAIN_ASSET_CHECKPOINT_PARTITION_ROWS,
  domainAssetCheckpointPartitionId,
  domainAssetProjectionRowSchema,
} from "./domain-asset-projection";
import { serverRevisionSchema, sha256DigestSchema } from "./sync-mutation";

/**
 * ADR-0029 decision 1: a version-3 checkpoint is the whole replicated DomainAsset state at its
 * revision — every live asset with the generation it is on, and every tombstone with the
 * generation it deleted. A checkpoint that dropped deleted entities would let a rebuild or a
 * restoring device forget that an id was deleted, so tombstones are first-class content covered by
 * the checkpoint digest, not a side channel.
 */
const ASSET_DIGEST_DOMAIN = "GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-V3";
const TOMBSTONE_DIGEST_DOMAIN = "GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-TOMBSTONE-V3";
const ENTITY_DIGESTS_DOMAIN = "GOODDEALER-WORKSPACE-CHECKPOINT-ENTITY-DIGESTS-V3";
/** Same bound as the entity digest list: at most 4,096 partitions of 512 rows in total. */
const MAX_CHECKPOINT_PARTITIONS = 4_096;

export const checkpointDomainAssetSchema = domainAssetProjectionRowSchema
  .extend({ entityGeneration: safePositiveInteger })
  .strict();

export const checkpointDomainAssetTombstoneSchema = z
  .object({
    entityId: domainAssetIdSchema,
    entityGeneration: safePositiveInteger,
    // Revision 0 is the empty workspace; a delete is always an assigned revision.
    deletedServerRevision: serverRevisionSchema.refine((value) => value >= 1, "deletion revision must be assigned"),
    deletedAt: canonicalUtcTimestamp,
  })
  .strict();

export const workspaceCheckpointStateSchema = z
  .object({
    assets: z.array(checkpointDomainAssetSchema),
    tombstones: z.array(checkpointDomainAssetTombstoneSchema),
  })
  .strict()
  .superRefine((state, context) => {
    for (const key of ["assets", "tombstones"] as const) {
      const rows = state[key];
      for (let index = 1; index < rows.length; index += 1) {
        if (compareUtf8(rows[index - 1]!.entityId, rows[index]!.entityId) >= 0) {
          context.addIssue({
            code: "custom",
            path: [key, index, "entityId"],
            message: "checkpoint entities must be unique and strictly ascending by UTF-8 bytes",
          });
          break;
        }
      }
    }
    // An entity is either live or deleted, never both: the replica keeps one state per entity.
    const live = new Set(state.assets.map((asset) => asset.entityId));
    const overlap = state.tombstones.findIndex((tombstone) => live.has(tombstone.entityId));
    if (overlap !== -1) {
      context.addIssue({
        code: "custom",
        path: ["tombstones", overlap, "entityId"],
        message: "a checkpoint entity cannot be both live and deleted",
      });
    }
    if (partitionCount(state.assets.length, true) + partitionCount(state.tombstones.length, false) > MAX_CHECKPOINT_PARTITIONS) {
      context.addIssue({ code: "custom", path: [], message: "checkpoint state exceeds its partition budget" });
    }
  });

/**
 * Live assets partition as `p0000…` (or the single `empty` partition, so every checkpoint has at
 * least one digest); tombstones partition as `t0000…` only when there are any. Distinct partition
 * names keep each partition id unique within one checkpoint.
 */
export const checkpointEntityDigestSchema = z
  .discriminatedUnion("entityType", [
    z.object({
      entityType: z.literal("domain_asset"),
      partitionId: z.string().regex(/^(?:p[0-9]{4}|empty)$/u),
      digest: sha256DigestSchema,
    }).strict(),
    z.object({
      entityType: z.literal("domain_asset_tombstone"),
      partitionId: z.string().regex(/^t[0-9]{4}$/u),
      digest: sha256DigestSchema,
    }).strict(),
  ]);

export const checkpointEntityDigestsSchema = z
  .array(checkpointEntityDigestSchema)
  .min(1)
  .max(MAX_CHECKPOINT_PARTITIONS)
  .superRefine((digests, context) => {
    const keys = digests.map(({ entityType, partitionId }) => `${entityType}\u0000${partitionId}`);
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "checkpoint entity digests must be unique and strictly ascending",
        });
      }
    }
  });

/** Partitions one validated checkpoint state exactly as the digests and the stored rows do. */
export function partitionWorkspaceCheckpointState(value: unknown): {
  readonly assets: readonly { readonly partitionId: string; readonly rows: readonly CheckpointDomainAsset[] }[];
  readonly tombstones: readonly { readonly partitionId: string; readonly rows: readonly CheckpointDomainAssetTombstone[] }[];
} {
  const state = workspaceCheckpointStateSchema.parse(value);
  const assets = state.assets.length === 0
    ? [{ partitionId: "empty", rows: [] }]
    : chunk(state.assets).map((rows, index) => ({ partitionId: domainAssetCheckpointPartitionId(index), rows }));
  const tombstones = chunk(state.tombstones).map((rows, index) => ({
    partitionId: `t${index.toString().padStart(4, "0")}`,
    rows,
  }));
  return { assets, tombstones };
}

export async function computeWorkspaceCheckpointEntityDigests(
  state: unknown,
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<readonly CheckpointEntityDigest[]> {
  const partitions = partitionWorkspaceCheckpointState(state);
  const digests: CheckpointEntityDigest[] = [];
  for (const { partitionId, rows } of partitions.assets) {
    digests.push({
      entityType: "domain_asset",
      partitionId,
      digest: encodeBase64Url(await checkedDigest(sha256, encodeDomainSeparatedWireValue(ASSET_DIGEST_DOMAIN, rows))),
    });
  }
  for (const { partitionId, rows } of partitions.tombstones) {
    digests.push({
      entityType: "domain_asset_tombstone",
      partitionId,
      digest: encodeBase64Url(await checkedDigest(sha256, encodeDomainSeparatedWireValue(TOMBSTONE_DIGEST_DOMAIN, rows))),
    });
  }
  return checkpointEntityDigestsSchema.parse(digests);
}

export function encodeCheckpointEntityDigestsInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(ENTITY_DIGESTS_DOMAIN, checkpointEntityDigestsSchema.parse(value));
}

/** The checkpoint digest a descriptor advertises for one state. */
export async function computeWorkspaceCheckpointDigest(
  state: unknown,
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const digests = await computeWorkspaceCheckpointEntityDigests(state, sha256);
  return encodeBase64Url(await checkedDigest(sha256, encodeCheckpointEntityDigestsInput(digests)));
}

function partitionCount(rows: number, alwaysOne: boolean): number {
  return rows === 0 ? (alwaysOne ? 1 : 0) : Math.ceil(rows / DOMAIN_ASSET_CHECKPOINT_PARTITION_ROWS);
}

function chunk<Row>(rows: readonly Row[]): Row[][] {
  return Array.from({ length: Math.ceil(rows.length / DOMAIN_ASSET_CHECKPOINT_PARTITION_ROWS) }, (_, index) =>
    rows.slice(index * DOMAIN_ASSET_CHECKPOINT_PARTITION_ROWS, (index + 1) * DOMAIN_ASSET_CHECKPOINT_PARTITION_ROWS));
}

async function checkedDigest(sha256: (bytes: Uint8Array) => Promise<Uint8Array>, bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await sha256(bytes);
  if (digest.byteLength !== 32) throw new TypeError("SHA-256 digest must be exactly 32 bytes");
  return digest;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export type CheckpointDomainAsset = z.infer<typeof checkpointDomainAssetSchema>;
export type CheckpointDomainAssetTombstone = z.infer<typeof checkpointDomainAssetTombstoneSchema>;
export type WorkspaceCheckpointState = z.infer<typeof workspaceCheckpointStateSchema>;
export type CheckpointEntityDigest = z.infer<typeof checkpointEntityDigestSchema>;
