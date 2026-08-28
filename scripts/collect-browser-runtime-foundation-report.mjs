import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const expectedDesktopObservation = Object.freeze({
  commands: ["local_business_status", "local_domain_asset_upsert", "local_portfolio_read"],
  capabilityCommands: ["local_business_status", "local_domain_asset_upsert", "local_portfolio_read"],
  handlers: ["local_business_status", "local_domain_asset_upsert", "local_portfolio_read"],
  adapter: "narrow-local-business",
});
const testGroups = Object.freeze([
  ["browser-runtime", "browser_runtime::tests"],
  ["profile", "profile::tests"],
  ["navigation", "navigation_policy::tests"],
]);

export const BROWSER_RUNTIME_INPUT_PATHS = Object.freeze([
  "Cargo.lock",
  "Cargo.toml",
  "crates/automation-host/Cargo.toml",
  "crates/automation-host/src/lib.rs",
  "crates/automation-host/src/browser_runtime.rs",
  "crates/automation-host/src/profile.rs",
  "crates/automation-host/src/navigation_policy.rs",
  "crates/automation-host/src/download_policy.rs",
  "crates/automation-host/src/popup_policy.rs",
  "crates/automation-host/src/permission_policy.rs",
  "crates/automation-host/src/engine/mod.rs",
  "crates/automation-host/src/engine/denying.rs",
  "crates/automation-host/src/engine/test_adapter.rs",
  "apps/desktop/src-tauri/build.rs",
  "apps/desktop/src-tauri/src/main.rs",
  "apps/desktop/src-tauri/src/command_handlers.rs",
  "apps/desktop/src-tauri/capabilities/local-app.json",
  "apps/desktop/src/adapters/tauri/index.ts",
  "scripts/collect-browser-runtime-foundation-report.mjs",
  "scripts/browser-runtime-foundation-evidence-policy.test.mjs",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedRepositoryPath(path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path)) {
    return null;
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized !== path || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  return normalized;
}

export function browserRuntimeInputAdmissionErrors({
  repositoryRoot = root,
  inputPaths = BROWSER_RUNTIME_INPUT_PATHS,
} = {}) {
  if (!Array.isArray(inputPaths) || inputPaths.length !== BROWSER_RUNTIME_INPUT_PATHS.length) {
    return ["browser foundation input inventory must be the closed final-state list"];
  }
  const errors = [];
  for (const [index, path] of inputPaths.entries()) {
    const normalized = normalizedRepositoryPath(path);
    if (normalized === null) {
      errors.push(`browser foundation input is not normalized: ${String(path)}`);
      continue;
    }
    if (normalized !== BROWSER_RUNTIME_INPUT_PATHS[index]) {
      errors.push(`browser foundation input is not admitted: ${normalized}`);
      continue;
    }
    try {
      const stat = lstatSync(resolve(repositoryRoot, normalized));
      if (stat.isSymbolicLink() || !stat.isFile()) {
        errors.push(`browser foundation input must be a regular non-symbolic-link file: ${normalized}`);
      }
    } catch (error) {
      errors.push(`browser foundation input is missing or unreadable: ${normalized}`);
    }
  }
  return errors;
}

function admittedInputRecords() {
  const errors = browserRuntimeInputAdmissionErrors();
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return BROWSER_RUNTIME_INPUT_PATHS.map((path) => {
    const value = readFileSync(resolve(root, path));
    return { path, bytes: value.length, sha256: sha256(value) };
  });
}

function runPortableTests() {
  return testGroups.map(([id, filter]) => {
    const result = spawnSync(
      "cargo",
      ["test", "--locked", "-p", "gooddealer-automation-host", filter, "--", "--nocapture"],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.error || result.signal || result.status !== 0) {
      throw new Error(`automation-host test subprocess failed: ${id}`);
    }
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (!/running [1-9][0-9]* tests/u.test(output) || !/test result: ok\. [1-9][0-9]* passed; 0 failed;/u.test(output)) {
      throw new Error(`automation-host test output is malformed: ${id}`);
    }
    return { id, filter, exitCode: 0, outputSha256: sha256(output) };
  });
}

export function browserRuntimeFoundationReportPassesPolicy(report) {
  try {
    if (report === null || typeof report !== "object" || Array.isArray(report)) return false;
    const expectedKeys = [
      "schemaVersion",
      "scope",
      "portableContract",
      "engineInstantiated",
      "productionComposition",
      "nativeEvidenceObserved",
      "closesGate",
      "production",
      "desktop",
      "portableObserved",
      "inputs",
    ];
    if (!hasExactDataKeys(report, expectedKeys)) return false;
    if (
      report.schemaVersion !== 1 ||
      report.scope !== "automation-host-foundation" ||
      report.portableContract !== true ||
      report.engineInstantiated !== false ||
      report.productionComposition !== false ||
      report.nativeEvidenceObserved !== false ||
      report.closesGate !== false ||
      !hasExactDataKeys(report.production, ["factory", "publicAdapterOrConstructor"]) ||
      report.production.factory !== "EngineUnavailable" ||
      report.production.publicAdapterOrConstructor !== false ||
      !hasExactDataKeys(report.desktop, ["commands", "capabilityCommands", "handlers", "adapter"]) ||
      JSON.stringify(report.desktop) !== JSON.stringify(expectedDesktopObservation) ||
      !hasExactDataKeys(report.portableObserved, ["runs"]) ||
      !hasExactDataArray(report.portableObserved.runs, testGroups.length) ||
      !hasExactDataArray(report.inputs, BROWSER_RUNTIME_INPUT_PATHS.length)
    ) {
      return false;
    }
    for (const [index, [id, filter]] of testGroups.entries()) {
      const run = Object.getOwnPropertyDescriptor(report.portableObserved.runs, String(index))?.value;
      if (!hasExactDataKeys(run, ["id", "filter", "exitCode", "outputSha256"]) || run.id !== id || run.filter !== filter || run.exitCode !== 0 || !/^[0-9a-f]{64}$/u.test(run.outputSha256)) {
        return false;
      }
    }
    for (const [index, path] of BROWSER_RUNTIME_INPUT_PATHS.entries()) {
      const input = Object.getOwnPropertyDescriptor(report.inputs, String(index))?.value;
      const content = readFileSync(resolve(root, path));
      if (!hasExactDataKeys(input, ["path", "bytes", "sha256"]) || input.path !== path || input.bytes !== content.length || input.sha256 !== sha256(content)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function hasExactDataKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return keys.includes(key) && descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

function hasExactDataArray(value, length) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const expected = [...Array.from({ length }, (_, index) => String(index)), "length"];
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return keys.includes(key) && Object.hasOwn(descriptor ?? {}, "value") && (key === "length" ? descriptor.value === length : descriptor.enumerable === true);
  });
}

export function collectBrowserRuntimeFoundationReport() {
  const inputErrors = browserRuntimeInputAdmissionErrors();
  if (inputErrors.length > 0) throw new Error(inputErrors.join("\n"));
  const desktopErrors = tauriCommandPolicyErrors({ root });
  if (desktopErrors.length > 0) throw new Error(desktopErrors.join("\n"));
  const denyingSource = readFileSync(resolve(root, "crates/automation-host/src/engine/denying.rs"), "utf8");
  const engineSource = readFileSync(resolve(root, "crates/automation-host/src/engine/mod.rs"), "utf8");
  const report = {
    schemaVersion: 1,
    scope: "automation-host-foundation",
    portableContract: true,
    engineInstantiated: false,
    productionComposition: false,
    nativeEvidenceObserved: false,
    closesGate: false,
    production: {
      factory: denyingSource.includes("BrowserEngineError::Unavailable") ? "EngineUnavailable" : "unresolved",
      publicAdapterOrConstructor: /pub\s+(?:trait|struct|fn)\s+(?:EngineAdapter|BrowserRuntime|open_production_engine)/u.test(engineSource),
    },
    desktop: structuredClone(expectedDesktopObservation),
    portableObserved: { runs: runPortableTests() },
    inputs: admittedInputRecords(),
  };
  if (!browserRuntimeFoundationReportPassesPolicy(report)) {
    throw new Error("automation-host foundation report failed policy");
  }
  return report;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  if (process.argv.length !== 2) throw new Error("browser foundation collector accepts no arguments");
  const report = collectBrowserRuntimeFoundationReport();
  const output = resolve(root, ".artifacts/browser-runtime-foundation/report.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("automation-host foundation report written");
}
