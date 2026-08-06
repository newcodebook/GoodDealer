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
const bundleWorkflow = readFileSync(
  new URL("../.github/workflows/wp5-sqlcipher-bundle.yml", import.meta.url),
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
const spikeTauriConfig = readFileSync(
  new URL("../apps/desktop/src-tauri/tauri.bundle-spike.conf.json", import.meta.url),
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

test("SQLCipher bundle evidence uses a dedicated feature-gated native matrix", () => {
  assert.equal(
    packageJson.scripts["evidence:wp5:bundle"],
    "node scripts/collect-wp0-evidence.mjs --slice sqlcipher-bundle",
  );
  assert.match(bundleWorkflow, /windows-2025/);
  assert.match(bundleWorkflow, /macos-15\r?\n/);
  assert.match(bundleWorkflow, /macos-15-intel/);
  assert.match(bundleWorkflow, /--profile native --slice sqlcipher-bundle/);
  assert.match(bundleWorkflow, /target\/release\/bundle/);
});

test("SQLCipher bundle linkage is opt-in and cannot alter the default desktop build", () => {
  assert.match(crateManifest, /^default = \[\]$/m);
  assert.match(
    crateManifest,
    /^sqlcipher-bundle-spike = \["dep:rusqlite", "dep:serde", "dep:serde_json"\]$/m,
  );
  assert.match(crateManifest, /^rusqlite = \{ workspace = true, optional = true \}$/m);
  assert.match(crateManifest, /^rusqlite\.workspace = true$/m);
  assert.match(desktopManifest, /^default = \[\]$/m);
  assert.match(
    desktopManifest,
    /^sqlcipher-bundle-spike = \["gooddealer-local-storage\/sqlcipher-bundle-spike"\]$/m,
  );
  assert.equal(JSON.parse(defaultTauriConfig).bundle.active, false);
  assert.equal(JSON.parse(spikeTauriConfig).bundle.active, true);
  assert.match(spikeTauriConfig, /sqlcipher-spike/);
});
