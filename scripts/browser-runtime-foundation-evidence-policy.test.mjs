import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  BROWSER_RUNTIME_INPUT_PATHS,
  browserRuntimeFoundationReportPassesPolicy,
  browserRuntimeInputAdmissionErrors,
  collectBrowserRuntimeFoundationReport,
} from "./collect-browser-runtime-foundation-report.mjs";

test("the retired browser selector is absent", () => {
  const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(packageManifest.scripts).some((name) => name.startsWith("evidence:wp3")), false);
});

test("automation-host evidence accepts EngineUnavailable beside only reviewed local-business commands", () => {
  const report = collectBrowserRuntimeFoundationReport();
  assert.equal(browserRuntimeFoundationReportPassesPolicy(report), true);

  const mutations = [
    (value) => { value.engineInstantiated = true; },
    (value) => { value.nativeEvidenceObserved = true; },
    (value) => { value.closesGate = true; },
    (value) => { value.production.factory = "other"; },
    (value) => { value.desktop.commands.push("unreviewed_command"); },
    (value) => { value.desktop.adapter = "absent"; },
    (value) => { value.portableObserved.runs[0].exitCode = 1; },
    (value) => { value.inputs[0].sha256 = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(report);
    mutate(value);
    assert.equal(browserRuntimeFoundationReportPassesPolicy(value), false);
  }
});

test("foundation inputs are closed, regular, and non-symbolic-link", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-browser-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of BROWSER_RUNTIME_INPUT_PATHS) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "input\n");
  }
  assert.deepEqual(browserRuntimeInputAdmissionErrors({ repositoryRoot: root }), []);

  rmSync(join(root, BROWSER_RUNTIME_INPUT_PATHS[0]));
  symlinkSync("missing-input", join(root, BROWSER_RUNTIME_INPUT_PATHS[0]));
  assert.ok(browserRuntimeInputAdmissionErrors({ repositoryRoot: root }).some((error) => error.includes("regular")));
});
