#!/usr/bin/env node

import {
  canonicalReleaseJson,
  collectReleaseFoundation,
  issueFutureReleaseIdentity,
  releaseRepositoryRoot,
  validateReleaseFoundationReport,
} from "../release/release-identity-policy.mjs";

function usage() {
  return [
    "Usage:",
    "  node scripts/collect-release-identity.mjs --foundation",
    "  node scripts/collect-release-identity.mjs --issue --manifest .artifacts/release/<identity>.json",
  ].join("\n");
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === "--foundation") return { mode: "foundation" };
  if (args[0] !== "--issue") throw new Error(usage());
  if (args.length !== 3 || args[1] !== "--manifest" || !args[2]) throw new Error(usage());
  return { mode: "issue", manifestRelativePath: args[2] };
}

function main() {
  const command = parseArguments(process.argv.slice(2));
  if (command.mode === "foundation") {
    const report = collectReleaseFoundation(releaseRepositoryRoot);
    validateReleaseFoundationReport(report);
    process.stdout.write(`${canonicalReleaseJson(report)}\n`);
    return;
  }

  const result = issueFutureReleaseIdentity({
    repositoryRoot: releaseRepositoryRoot,
    manifestRelativePath: command.manifestRelativePath,
  });
  process.stdout.write(`${canonicalReleaseJson({ path: result.path, manifest: result.manifest })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "release identity collection failed"}\n`);
  process.exitCode = 1;
}
