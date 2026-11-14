import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";

import type { DomainAssetReplicaEntry } from "../state/portfolio/index";

/** Item indexes refused by the entity rule, by the business code each one earns. */
export interface EntityRuleFailures {
  readonly unknown: readonly number[];
  readonly generationMismatch: readonly number[];
}

/**
 * ADR-0029 decisions 2 and 3. An upsert creates an asset the replica never held (as generation 1)
 * and edits a live one; a delete needs a live one. A tombstoned asset stays unknown to both until
 * re-add exists, and a delete of an asset the replica never held is unknown rather than a creation.
 * Every item that reaches a live asset must name that asset's generation exactly, so a write from an
 * earlier generation can never land on a later one; an item creating an asset must name generation
 * 1. The batch is judged in order, so an earlier item's accepted create or delete is what a later
 * item sees. Exact replays were judged when first accepted and are skipped. The ingest refuses
 * with the unknown code before the generation code, matching the order the checks are listed here.
 */
export function judgeEntityRule(
  mutations: readonly Pick<SubmittedSyncMutation, "entityId" | "operationKind" | "entityGeneration">[],
  isDuplicate: (index: number) => boolean,
  entryBeforeBatch: (entityId: string) => DomainAssetReplicaEntry,
): EntityRuleFailures {
  const batched = new Map<string, DomainAssetReplicaEntry>();
  const unknown: number[] = [];
  const generationMismatch: number[] = [];
  for (const [index, mutation] of mutations.entries()) {
    if (isDuplicate(index)) continue;
    const entry = batched.get(mutation.entityId) ?? entryBeforeBatch(mutation.entityId);
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
      ? { state: "deleted", generation }
      : { state: "active", generation });
  }
  return { unknown, generationMismatch };
}
