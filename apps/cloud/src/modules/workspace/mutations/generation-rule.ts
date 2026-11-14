// ADR-0029 C1a: every replica entity is still generation 1 and re-adding does not exist yet, so a
// mutation naming another generation or a superseded tombstone is unsupported rather than a
// business conflict: it records no receipt. C1b compares against stored generations; C2 adds re-add.
export function isFirstGenerationMutation(mutation: {
  readonly entityGeneration: number;
  readonly reAddsDeletedRevision?: number | undefined;
}): boolean {
  return mutation.entityGeneration === 1 && mutation.reAddsDeletedRevision === undefined;
}
