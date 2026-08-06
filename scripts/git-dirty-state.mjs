export function repositoryMaterialDirty({
  stagedDiff,
  unstagedDiff,
  untrackedPaths,
}) {
  if (stagedDiff === null || unstagedDiff === null || untrackedPaths === null) {
    return null;
  }

  return stagedDiff.length > 0 || unstagedDiff.length > 0 || untrackedPaths.length > 0;
}
