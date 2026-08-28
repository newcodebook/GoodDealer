import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const crateManifest = readFileSync(
  new URL("../crates/local-storage/Cargo.toml", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../.github/workflows/wp5-sqlcipher.yml", import.meta.url),
  "utf8",
);
const desktopManifest = readFileSync(
  new URL("../apps/desktop/src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const defaultTauriConfig = readFileSync(
  new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url),
  "utf8",
);
const evidenceCollector = readFileSync(
  new URL("../scripts/collect-wp0-evidence.mjs", import.meta.url),
  "utf8",
);

test("WP-5 SQLCipher evidence has a dedicated command and native matrix", () => {
  assert.equal(
    packageJson.scripts["evidence:wp5"],
    "node scripts/collect-wp0-evidence.mjs --slice sqlcipher",
  );
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /macos-15\r?\n/);
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /--profile native --slice sqlcipher/);
  assert.match(workflow, /\.artifacts\/wp5\/sqlcipher/);
});

test("SQLCipher is the default business database without disposable prototype surfaces", () => {
  assert.match(crateManifest, /^default = \[\]$/m);
  assert.match(crateManifest, /^rusqlite\.workspace = true$/m);
  assert.match(crateManifest, /^serde\.workspace = true$/m);
  assert.match(crateManifest, /^serde_json\.workspace = true$/m);
  assert.equal(JSON.parse(defaultTauriConfig).bundle.active, false);
  assert.doesNotMatch(evidenceCollector, /sqlcipher-bundle/i);
  assert.doesNotMatch(crateManifest, /sqlcipher-bundle/i);
  assert.doesNotMatch(desktopManifest, /sqlcipher-bundle/i);
  assert.equal(packageJson.scripts["evidence:wp5:bundle"], undefined);
});
