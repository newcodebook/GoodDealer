import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";

import type { DomainAssetReplicaState } from "../state/portfolio/index";

/**
 * ADR-0029 decision 2. An upsert creates an asset the replica never held and edits a live one; a
 * delete needs a live one. A tombstoned asset stays unknown to both until re-add exists, and a
 * delete of an asset the replica never held is unknown rather than a creation. The batch is judged
 * in order, so an earlier item's accepted create or delete is what a later item sees. Exact replays
 * were judged when first accepted and are skipped.
 */
export function findUnknownEntityIndexes(
  mutations: readonly Pick<SubmittedSyncMutation, "entityId" | "operationKind">[],
  isDuplicate: (index: number) => boolean,
  stateBeforeBatch: (entityId: string) => DomainAssetReplicaState,
): readonly number[] {
  const batched = new Map<string, DomainAssetReplicaState>();
  const unknown: number[] = [];
  for (const [index, mutation] of mutations.entries()) {
    if (isDuplicate(index)) continue;
    const state = batched.get(mutation.entityId) ?? stateBeforeBatch(mutation.entityId);
    if (mutation.operationKind === "delete") {
      if (state === "active") batched.set(mutation.entityId, "deleted");
      else unknown.push(index);
    } else if (state === "deleted") {
      unknown.push(index);
    } else {
      batched.set(mutation.entityId, "active");
    }
  }
  return unknown;
}
