import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const crateManifest = readFileSync(
  new URL("../crates/local-storage/Cargo.toml", import.meta.url),
  "utf8",
);
const evidenceCollector = readFileSync(
  new URL("../scripts/collect-wp0-evidence.mjs", import.meta.url),
  "utf8",
);

test("WP-5 backup evidence has a dedicated command and slice", () => {
  assert.equal(
    packageJson.scripts["evidence:wp5:backup"],
    "node scripts/collect-wp0-evidence.mjs --slice backup",
  );
  assert.match(evidenceCollector, /supportedSlices.*"backup"/s);
  assert.match(evidenceCollector, /if \(slice === "backup"\)/);
  assert.match(evidenceCollector, /backup-seal-and-verify-evidence/);
  assert.match(evidenceCollector, /--example.*backup_evidence/s);
});

test("backup slice evidence validates all required checks", () => {
  assert.match(evidenceCollector, /sliceEvidence\.slice === "backup"/);
  assert.match(evidenceCollector, /aeadCrate.*chacha20poly1305/);
  assert.match(evidenceCollector, /aeadCrateVersion.*0\.11\.0/);
  assert.match(evidenceCollector, /exportProducesSealedEnvelope/);
  assert.match(evidenceCollector, /noPlaintextInEnvelope/);
  assert.match(evidenceCollector, /noCanaryInEnvelope/);
  assert.match(evidenceCollector, /noSqliteHeaderInEnvelope/);
  assert.match(evidenceCollector, /manifestDigestRecomputePasses/);
  assert.match(evidenceCollector, /aeadRoundtripSucceeds/);
  assert.match(evidenceCollector, /tamperedCiphertextRejected/);
  assert.match(evidenceCollector, /truncatedEnvelopeRejected/);
  assert.match(evidenceCollector, /swappedPackageRejected/);
  assert.match(evidenceCollector, /restoredSizeMatchesOriginal/);
});

test("backup slice routes to wp5 work package", () => {
  assert.match(evidenceCollector, /slice === "backup".*\?\s*"wp5"/s);
});

test("chacha20poly1305 is a dev-dependency, not a default feature", () => {
  assert.match(crateManifest, /chacha20poly1305\.workspace = true/);
  assert.match(crateManifest, /\[dev-dependencies\]/);
  assert.match(crateManifest, /^default = \[\]$/m);
});

test("backup evidence slice is disjoint from sqlcipher slice", () => {
  // The backup profile definition must NOT include sqlcipher_evidence commands
  const backupSlice = evidenceCollector.slice(
    evidenceCollector.indexOf('if (slice === "backup")'),
    evidenceCollector.indexOf('if (slice === "sqlcipher")'),
  );
  assert.ok(!backupSlice.includes("sqlcipher_evidence"), "backup slice must not run sqlcipher_evidence");
  assert.ok(!backupSlice.includes("sqlcipher-fault"), "backup slice must not include sqlcipher fault checks");
  assert.ok(backupSlice.includes("backup_evidence"), "backup slice must run backup_evidence");
});
