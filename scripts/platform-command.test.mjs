import assert from "node:assert/strict";
import test from "node:test";

import { platformCommand } from "./platform-command.mjs";

test("runs package-manager shims through the Windows command interpreter", () => {
  assert.deepEqual(
    platformCommand("pnpm", ["check"], "win32", "C:\\Windows\\System32\\cmd.exe"),
    {
      binary: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm", "check"],
    },
  );
});

test("runs executables directly on Unix platforms", () => {
  assert.deepEqual(platformCommand("pnpm", ["check"], "darwin"), {
    binary: "pnpm",
    args: ["check"],
  });
  assert.deepEqual(platformCommand("pnpm", ["check"], "linux"), {
    binary: "pnpm",
    args: ["check"],
  });
});
