import assert from "node:assert/strict";
import test from "node:test";

import { repositoryMaterialDirty } from "./git-dirty-state.mjs";

test("accepts an empty repository material snapshot", () => {
  assert.equal(
    repositoryMaterialDirty({
      stagedDiff: Buffer.alloc(0),
      unstagedDiff: Buffer.alloc(0),
      untrackedPaths: [],
    }),
    false,
  );
});

test("detects staged, unstaged, and untracked repository material", () => {
  assert.equal(
    repositoryMaterialDirty({
      stagedDiff: Buffer.from("diff"),
      unstagedDiff: Buffer.alloc(0),
      untrackedPaths: [],
    }),
    true,
  );
  assert.equal(
    repositoryMaterialDirty({
      stagedDiff: Buffer.alloc(0),
      unstagedDiff: Buffer.from("diff"),
      untrackedPaths: [],
    }),
    true,
  );
  assert.equal(
    repositoryMaterialDirty({
      stagedDiff: Buffer.alloc(0),
      unstagedDiff: Buffer.alloc(0),
      untrackedPaths: ["untracked.txt"],
    }),
    true,
  );
});

test("fails closed when any repository material cannot be collected", () => {
  assert.equal(
    repositoryMaterialDirty({
      stagedDiff: null,
      unstagedDiff: Buffer.alloc(0),
      untrackedPaths: [],
    }),
    null,
  );
});
