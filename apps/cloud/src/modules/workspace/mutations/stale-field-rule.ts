import type { SubmittedSyncMutation } from "@gooddealer/protocol/workspace";

/** Who wrote an accepted mutation, as the stale-field rule needs it. */
export interface MutationWriter {
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly deviceMutationSequence: number;
  readonly baseServerRevision: number;
}

export function writerOf(mutation: SubmittedSyncMutation): MutationWriter {
  return {
    sourceDeviceId: mutation.sourceDeviceId,
    activeLeaseEpoch: mutation.activeLeaseEpoch,
    deviceMutationSequence: mutation.deviceMutationSequence,
    baseServerRevision: mutation.baseServerRevision,
  };
}

/**
 * A device commits each edit against the head it had applied and freezes the wire, so its second
 * unacknowledged edit of a field names a base older than its own first edit. That first edit is
 * not a conflict: the same device made it earlier in the same Lease epoch, from a base no newer,
 * and was itself accepted only if nothing foreign touched the field after that base. One Active
 * device per epoch means no other writer shares the epoch. A writer that is unknown (its replay
 * row was compacted) or anyone else's write stays a conflict.
 *
 * This relies on a field's revision always being the revision of the mutation that wrote it, or 0
 * for a seeded row; checkpoint materialization stamps a head that has no mutation row, so it reads
 * as an unknown writer and never as someone's own write.
 */
export function isOwnEarlierWrite(writer: MutationWriter | undefined, mutation: SubmittedSyncMutation): boolean {
  return writer !== undefined &&
    writer.sourceDeviceId === mutation.sourceDeviceId &&
    writer.activeLeaseEpoch === mutation.activeLeaseEpoch &&
    writer.deviceMutationSequence < mutation.deviceMutationSequence &&
    writer.baseServerRevision <= mutation.baseServerRevision;
}
