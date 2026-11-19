import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  repositoryUnsafeCodeBoundaryErrors,
  unsafeCodeAllowlist,
  unsafeCodeBoundaryErrors,
} from "./unsafe-boundary-policy.mjs";

test("pins unsafe overrides to the two private OS power notification files", () => {
  assert.deepEqual(unsafeCodeAllowlist, [
    "crates/secure-host-core/src/native_power/windows.rs",
    "crates/secure-host-core/src/native_power/macos.rs",
  ]);
  for (const path of unsafeCodeAllowlist) {
    assert.deepEqual(unsafeCodeBoundaryErrors([{ path, source: "#![allow(unsafe_code)]" }]), []);
  }
  for (const path of [
    "crates/secure-host-core/src/lib.rs",
    "crates/secure-host-core/src/native_power.rs",
    "crates/secure-host-core/src/native_power/other.rs",
    "crates/secure-host-core/src/afternic_credentials.rs",
    "crates/local-storage/src/desktop_custody/windows.rs",
  ]) {
    assert.equal(unsafeCodeBoundaryErrors([{ path, source: "#![allow(unsafe_code)]" }]).length, 1);
  }
  assert.equal(
    unsafeCodeBoundaryErrors([
      { path: "crates/example/src/lib.rs", source: "#![allow(unsafe_code)]" },
    ]).length,
    1,
  );
});

test("rejects crate-level and item-level unsafe-code allows outside the allowlist", () => {
  const errors = unsafeCodeBoundaryErrors([
    {
      path: "crates/example/src/lib.rs",
      source: "#![allow(unsafe_code)]\n#[allow(unsafe_code)]\nfn unchecked() {}",
    },
  ]);

  assert.equal(errors.length, 2);
  assert.match(errors[0], /crates\/example\/src\/lib\.rs:1: allow\(unsafe_code\) is forbidden/u);
  assert.match(errors[1], /crates\/example\/src\/lib\.rs:2: allow\(unsafe_code\) is forbidden/u);
});

test("rejects unsafe-code expectations and grouped multiline overrides", () => {
  const errors = unsafeCodeBoundaryErrors([
    {
      path: "crates/example/src/lib.rs",
      source: [
        "#[expect(unsafe_code)]",
        "fn expected() {}",
        "#[allow(",
        "  dead_code,",
        "  unsafe_code,",
        ")]",
        "fn grouped() {}",
        "#![cfg_attr(target_os = \"windows\", allow(unsafe_code))]",
      ].join("\n"),
    },
  ]);

  assert.equal(errors.length, 3);
  assert.match(errors[0], /:1: expect\(unsafe_code\) is forbidden/u);
  assert.match(errors[1], /:3: allow\(unsafe_code\) is forbidden/u);
  assert.match(errors[2], /:8: allow\(unsafe_code\) is forbidden/u);
});

test("does not confuse unrelated Rust and Clippy allows with unsafe_code", () => {
  assert.deepEqual(
    unsafeCodeBoundaryErrors([
      {
        path: "crates/example/src/lib.rs",
        source: [
          "#![allow(dead_code)]",
          "#[allow(clippy::undocumented_unsafe_blocks)]",
          "#[expect(clippy::missing_safety_doc)]",
        ].join("\n"),
      },
    ]),
    [],
  );
});

test("the repository has no unsafe-code override outside the exact ADR-0006 files", () => {
  const root = resolve(import.meta.dirname, "..");
  assert.deepEqual(repositoryUnsafeCodeBoundaryErrors(root), []);
});


test("rejects warn overrides that weaken Core's deny even inside cfg_attr", () => {
  const errors = unsafeCodeBoundaryErrors([{
    path: "crates/secure-host-core/src/afternic_credentials.rs",
    source: '#![warn(unsafe_code)]\n#[cfg_attr(target_os = "windows", warn(dead_code, unsafe_code))]',
  }]);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.includes("warn(unsafe_code) is forbidden")));
});
