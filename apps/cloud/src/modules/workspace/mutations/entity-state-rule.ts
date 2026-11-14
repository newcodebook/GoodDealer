import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";

import type { DomainAssetReplicaEntry } from "../state/portfolio/index";

/** Item indexes refused by the entity rule, by the business code each one earns. */
export interface EntityRuleFailures {
  readonly unknown: readonly number[];
  readonly generationMismatch: readonly number[];
}

/** An entry as the batch has left it; a delete earlier in the batch has no revision yet. */
type BatchedEntry =
  | DomainAssetReplicaEntry
  | { readonly state: "deleted"; readonly generation: number; readonly deletedServerRevision: null };

/**
 * ADR-0029 decisions 2 and 3. An upsert creates an asset the replica never held (as generation 1)
 * and edits a live one; a delete needs a live one. Every item that reaches a live asset must name
 * that asset's generation exactly, so a write from an earlier generation can never land on a later
 * one; an item creating an asset must name generation 1.
 *
 * A re-add (an upsert carrying `reAddsDeletedRevision`) is the only item a tombstone admits: the
 * tombstone must be the one it names (generation g, deletion revision R), the re-add must name
 * g + 1 and R, and it must build on that deletion without running ahead of the head
 * (R <= base <= head). Anything else about a re-add, including re-adding a live or never-held
 * asset, is a generation mismatch rather than an unknown entity, because the device named a
 * specific tombstone that is not the replica's. Any other item on a tombstone stays unknown, and so
 * does a delete of an asset the replica never held.
 *
 * The batch is judged in order, so an earlier item's accepted create, delete or re-add is what a
 * later item sees. A tombstone written earlier in the same batch has no revision before
 * assignment, and every base is at most the pre-batch head, so nothing in the batch can re-add it.
 * Exact replays were judged when first accepted and are skipped. The ingest refuses with the
 * unknown code before the generation code, matching the order the checks are listed here.
 */
export function judgeEntityRule(
  mutations: readonly Pick<SubmittedSyncMutation,
    "entityId" | "operationKind" | "entityGeneration" | "reAddsDeletedRevision" | "baseServerRevision">[],
  isDuplicate: (index: number) => boolean,
  entryBeforeBatch: (entityId: string) => DomainAssetReplicaEntry,
  headRevision: number,
): EntityRuleFailures {
  const batched = new Map<string, BatchedEntry>();
  const unknown: number[] = [];
  const generationMismatch: number[] = [];
  for (const [index, mutation] of mutations.entries()) {
    if (isDuplicate(index)) continue;
    const entry = batched.get(mutation.entityId) ?? entryBeforeBatch(mutation.entityId);
    if (mutation.reAddsDeletedRevision !== undefined) {
      const reAdds = entry.state === "deleted" &&
        entry.deletedServerRevision !== null &&
        mutation.reAddsDeletedRevision === entry.deletedServerRevision &&
        mutation.entityGeneration === entry.generation + 1 &&
        entry.deletedServerRevision <= mutation.baseServerRevision &&
        mutation.baseServerRevision <= headRevision;
      if (!reAdds) {
        generationMismatch.push(index);
        continue;
      }
      batched.set(mutation.entityId, { state: "active", generation: mutation.entityGeneration });
      continue;
    }
    if (entry.state === "deleted" || (entry.state === "absent" && mutation.operationKind === "delete")) {
      unknown.push(index);
      continue;
    }
    const generation = entry.state === "active" ? entry.generation : 1;
    if (mutation.entityGeneration !== generation) {
      generationMismatch.push(index);
      continue;
    }
    batched.set(mutation.entityId, mutation.operationKind === "delete"
      ? { state: "deleted", generation, deletedServerRevision: null }
      : { state: "active", generation });
  }
  return { unknown, generationMismatch };
}
