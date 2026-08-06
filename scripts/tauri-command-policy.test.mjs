import assert from "node:assert/strict";
import test from "node:test";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const valid = {
  buildSource: 'AppManifest::new().commands(&["runtime_status"])',
  mainSource: "tauri::generate_handler![command_handlers::runtime_status]",
  rustSources: [
    "#[tauri::command]\n#[allow(clippy::needless_pass_by_value)]\nfn runtime_status() {}",
  ],
  capability: {
    webviews: ["local-app"],
    permissions: ["core:default", "allow-runtime-status"],
  },
  adapterSource: 'const RUNTIME_STATUS_COMMAND = "runtime_status";',
};

test("accepts an identical AppManifest, handler, attribute, capability, and adapter command set", () => {
  assert.deepEqual(tauriCommandPolicyErrors(valid), []);
});

test("rejects a command registered in only one command surface", () => {
  const errors = tauriCommandPolicyErrors({
    ...valid,
    rustSources: [...valid.rustSources, "#[tauri::command]\nfn unreviewed_write() {}"],
  });
  assert.ok(errors.some((error) => error.includes("attributed command set differs")));
});

test("rejects missing per-command capability permission", () => {
  const errors = tauriCommandPolicyErrors({
    ...valid,
    capability: { webviews: ["local-app"], permissions: ["core:default"] },
  });
  assert.ok(errors.some((error) => error.includes("capability command set differs")));
});

test("rejects window-level capability matching and plugin expansion", () => {
  const errors = tauriCommandPolicyErrors({
    ...valid,
    capability: {
      windows: ["local-app"],
      permissions: ["core:default", "allow-runtime-status", "shell:default"],
    },
  });
  assert.ok(errors.some((error) => error.includes("explicit local-app WebView")));
  assert.ok(errors.some((error) => error.includes("window-level")));
  assert.ok(errors.some((error) => error.includes("unreviewed plugin")));
});
