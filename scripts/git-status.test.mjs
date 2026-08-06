import assert from "node:assert/strict";
import test from "node:test";

import { hasGitStatusChanges } from "./git-status.mjs";

test("treats empty and whitespace-only porcelain output as clean", () => {
  assert.equal(hasGitStatusChanges(""), false);
  assert.equal(hasGitStatusChanges("\r\n"), false);
});

test("retains porcelain status markers as repository changes", () => {
  assert.equal(hasGitStatusChanges(" M package.json\r\n"), true);
  assert.equal(hasGitStatusChanges("?? untracked.txt\r\n"), true);
});
