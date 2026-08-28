const expectedScripts = Object.freeze({
  build: "pnpm -r --if-present build",
  typecheck: "pnpm -r --if-present typecheck",
  test: "pnpm -r --if-present test",
  "test:postgres": "pnpm --filter @gooddealer/cloud test:postgres",
  "test:rust": "cargo test --workspace --all-targets",
  "check:topology": "node scripts/check-repository-topology.mjs",
  "test:structure": "node --test scripts/*.test.mjs release/release-identity-command-boundary.test.mjs && pnpm check:topology && node scripts/check-workspace.mjs && node scripts/check-boundaries.mjs",
  "check:platform-neutral": "pnpm typecheck && pnpm test && pnpm test:structure",
  check: "pnpm check:platform-neutral && pnpm test:rust",
  "gate:validate": "node scripts/validate-gate-closure-attestation.mjs",
  "evidence:wp0": "node scripts/collect-wp0-evidence.mjs",
  "evidence:wp2": "node scripts/collect-wp0-evidence.mjs --slice account-gate",
  "evidence:wp2:auth-persistence": "node scripts/collect-auth-persistence-report.mjs",
  "evidence:wp2:devices-persistence": "node scripts/collect-devices-persistence-report.mjs",
  "evidence:wp2:bootstrap-persistence": "node scripts/collect-bootstrap-persistence-report.mjs",
  "evidence:wp2:workspace-sync-persistence": "node scripts/collect-workspace-sync-persistence-report.mjs",
  "evidence:wp4": "node scripts/collect-wp0-evidence.mjs --slice cloud-boundary",
  "evidence:wp4:persistence": "node scripts/collect-cloud-persistence-report.mjs",
  "evidence:wp4:jobs": "node scripts/collect-wp0-evidence.mjs --slice jobs",
  "evidence:wp4:jobs-persistence": "node scripts/collect-jobs-persistence-report.mjs",
  "evidence:wp5": "node scripts/collect-wp0-evidence.mjs --slice sqlcipher",
  "evidence:wp5:backup": "node scripts/collect-wp0-evidence.mjs --slice backup",
  "evidence:wp5:recovery-persistence": "node scripts/collect-recovery-persistence-report.mjs",
  "release:foundation": "node scripts/collect-release-identity.mjs --foundation",
  "release:issue": "node scripts/collect-release-identity.mjs --issue --manifest",
});

export function rootPackageScriptErrors(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["package manifest must be an object"];
  }
  const scripts = manifest.scripts;
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    return ["package manifest scripts must be an object"];
  }

  const errors = [];
  const actualKeys = Object.keys(scripts).sort();
  const expectedKeys = Object.keys(expectedScripts).sort();
  for (const key of expectedKeys) {
    if (!Object.hasOwn(scripts, key)) errors.push(`package script is missing: ${key}`);
  }
  for (const key of actualKeys) {
    if (!Object.hasOwn(expectedScripts, key)) errors.push(`package script is not admitted: ${key}`);
  }
  for (const key of expectedKeys) {
    if (scripts[key] !== expectedScripts[key]) {
      errors.push(`package script does not match the final policy: ${key}`);
    }
  }
  return errors;
}

export { expectedScripts };
