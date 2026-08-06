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

test("WP-5 SQLCipher evidence has a dedicated command and native matrix", () => {
  assert.equal(
    packageJson.scripts["evidence:wp5"],
    "node scripts/collect-wp0-evidence.mjs --slice sqlcipher",
  );
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /macos-15\n/);
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /--profile native --slice sqlcipher/);
  assert.match(workflow, /\.artifacts\/wp5\/sqlcipher/);
});

test("SQLCipher remains a test-only local-storage dependency", () => {
  const dependencySections = crateManifest.split("[dev-dependencies]");
  assert.equal(dependencySections.length, 2);
  assert.doesNotMatch(dependencySections[0], /rusqlite/);
  assert.match(dependencySections[1], /^rusqlite\.workspace = true$/m);
});
