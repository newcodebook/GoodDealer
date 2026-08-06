export function hasGitStatusChanges(porcelainOutput) {
  return porcelainOutput.trim().length > 0;
}
