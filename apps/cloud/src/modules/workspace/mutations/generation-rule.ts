// ADR-0029 C1a: wire version 2 predates entity generations, so only a first-generation mutation
// that re-adds nothing has a version 2 form. Ledger and log rows recorded under version 2 are
// compared against that form; any other mutation has none and cannot match such a row.
export function isFirstGenerationMutation(mutation: {
  readonly entityGeneration: number;
  readonly reAddsDeletedRevision?: number | undefined;
}): boolean {
  return mutation.entityGeneration === 1 && mutation.reAddsDeletedRevision === undefined;
}
