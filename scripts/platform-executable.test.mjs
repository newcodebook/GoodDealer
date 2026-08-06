import assert from "node:assert/strict";
import test from "node:test";

import { platformExecutable } from "./platform-executable.mjs";

test("resolves package-manager shims on Windows", () => {
  assert.equal(platformExecutable("pnpm", "win32"), "pnpm.cmd");
});

test("keeps native executable names on Unix platforms", () => {
  assert.equal(platformExecutable("pnpm", "darwin"), "pnpm");
  assert.equal(platformExecutable("pnpm", "linux"), "pnpm");
});
