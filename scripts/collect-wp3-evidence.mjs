#!/usr/bin/env node
// collect-wp3-evidence.mjs — W4 browser automation contract evidence collector.
//
// Usage:
//   node scripts/collect-wp3-evidence.mjs --slice <slice-name>
//
// Slices:
//   webview-isolation   (A)  — capability file + zero-permission invariant
//   session-context     (B)  — BrowserSessionAccessContext / SunsetBrowserSessionAccessContext
//   profile-policy      (C)  — BrowserSessionProfile + policies
//   recipe-ast          (D)  — RecipeStep closed enum, injection, callback, webview, evidence
//   ticket              (E)  — AutomationExecutionTicket + SunsetAutomationExecutionTicket

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

const sliceIdx = args.indexOf("--slice");
if (sliceIdx === -1 || !args[sliceIdx + 1]) {
  console.error("Usage: node scripts/collect-wp3-evidence.mjs --slice <slice>");
  console.error("Slices: webview-isolation, session-context, profile-policy, recipe-ast, ticket");
  process.exit(1);
}

const slice = args[sliceIdx + 1];

// ── Utility ──────────────────────────────────────────────────────────

function fileExists(rel) {
  return existsSync(resolve(ROOT, rel));
}

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), "utf-8"));
}

function pass(label) {
  console.log(`  PASS  ${label}`);
}

function fail(label, detail) {
  console.error(`  FAIL  ${label}: ${detail}`);
  process.exitCode = 1;
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Slice A: WebView Isolation ───────────────────────────────────────

function sliceWebviewIsolation() {
  section("Slice A: WebView Capability Isolation");

  const capPath = "apps/desktop/src-tauri/capabilities/remote-browser.json";
  if (!fileExists(capPath)) {
    fail("remote-browser.json exists", "file not found");
    return;
  }
  pass("remote-browser.json exists");

  const cap = readJson(capPath);
  if (cap.identifier !== "remote-browser") {
    fail("identifier", `expected "remote-browser", got "${cap.identifier}"`);
  } else {
    pass("identifier is remote-browser");
  }

  if (!Array.isArray(cap.permissions) || cap.permissions.length !== 0) {
    fail("zero permissions", `permissions = ${JSON.stringify(cap.permissions)}`);
  } else {
    pass("permissions is empty array (zero permissions)");
  }

  if (!cap.webviews || !cap.webviews.includes("remote-browser")) {
    fail("webview target", "must target remote-browser webview");
  } else {
    pass("targets remote-browser webview");
  }

  // Verify tauri.conf.json includes remote-browser capability
  const tauriConf = readJson("apps/desktop/src-tauri/tauri.conf.json");
  const caps = tauriConf?.app?.security?.capabilities;
  if (!Array.isArray(caps) || !caps.includes("remote-browser")) {
    fail("tauri.conf.json", "remote-browser not in capabilities list");
  } else {
    pass("tauri.conf.json includes remote-browser capability");
  }

  // Verify local-app still targets local-app webview (isolation)
  const localApp = readJson("apps/desktop/src-tauri/capabilities/local-app.json");
  if (!localApp.webviews || !localApp.webviews.includes("local-app")) {
    fail("local-app isolation", "local-app capability must target local-app webview");
  } else {
    pass("local-app capability still targets local-app webview (isolation maintained)");
  }
}

// ── Slice B: Session Context ─────────────────────────────────────────

function sliceSessionContext() {
  section("Slice B: Browser Session Context Contracts");

  const sessionFile = "crates/automation-host/src/session.rs";
  if (!fileExists(sessionFile)) {
    fail("session.rs exists", "file not found");
    return;
  }
  pass("session.rs exists");

  const src = readFileSync(resolve(ROOT, sessionFile), "utf-8");

  if (!src.includes("BrowserSessionAccessContext")) {
    fail("BrowserSessionAccessContext", "type not found");
  } else {
    pass("BrowserSessionAccessContext defined");
  }

  if (!src.includes("SunsetBrowserSessionAccessContext")) {
    fail("SunsetBrowserSessionAccessContext", "type not found");
  } else {
    pass("SunsetBrowserSessionAccessContext defined");
  }

  if (!src.includes("deny_unknown_fields")) {
    fail("deny_unknown_fields", "not found in session.rs");
  } else {
    pass("deny_unknown_fields enforced");
  }

  if (!src.includes("credential_health") || !src.includes("BrowserCredentialHealth")) {
    fail("credential_health field", "not found");
  } else {
    pass("credential_health field present (not a gate per INV-BSC-03)");
  }

  // Run Rust tests for this module
  try {
    execSync("cargo test -p gooddealer-automation-host session::tests", {
      cwd: ROOT,
      stdio: "pipe",
    });
    pass("cargo test session::tests");
  } catch (e) {
    fail("cargo test session::tests", e.stderr?.toString().slice(-200) || "failed");
  }
}

// ── Slice C: Profile + Policy ────────────────────────────────────────

function sliceProfilePolicy() {
  section("Slice C: Profile + Policy Contracts");

  const files = [
    "crates/automation-host/src/profile.rs",
    "crates/automation-host/src/navigation_policy.rs",
    "crates/automation-host/src/download_policy.rs",
    "crates/automation-host/src/upload_policy.rs",
  ];

  for (const f of files) {
    if (!fileExists(f)) {
      fail(`${f} exists`, "file not found");
    } else {
      pass(`${f} exists`);
    }
  }

  const profileSrc = readFileSync(resolve(ROOT, files[0]), "utf-8");
  if (!profileSrc.includes("isolation_key")) {
    fail("isolation_key", "method not found in profile.rs");
  } else {
    pass("isolation_key method defined");
  }

  if (!profileSrc.includes("ActiveProfileScope")) {
    fail("ActiveProfileScope", "type not found");
  } else {
    pass("ActiveProfileScope defined");
  }

  if (!profileSrc.includes("SunsetProfileScope")) {
    fail("SunsetProfileScope", "type not found");
  } else {
    pass("SunsetProfileScope defined");
  }

  // Run Rust tests
  const modules = ["profile::tests", "navigation_policy::tests", "download_policy::tests", "upload_policy::tests"];
  for (const mod_ of modules) {
    try {
      execSync(`cargo test -p gooddealer-automation-host ${mod_}`, {
        cwd: ROOT,
        stdio: "pipe",
      });
      pass(`cargo test ${mod_}`);
    } catch (e) {
      fail(`cargo test ${mod_}`, e.stderr?.toString().slice(-200) || "failed");
    }
  }
}

// ── Slice D: Recipe AST ──────────────────────────────────────────────

function sliceRecipeAst() {
  section("Slice D: Recipe AST + Injection + Callback");

  const files = [
    "crates/automation-host/src/recipe_ast.rs",
    "crates/automation-host/src/injection.rs",
    "crates/automation-host/src/callback_handler.rs",
    "crates/automation-host/src/webview_manager.rs",
    "crates/automation-host/src/evidence.rs",
  ];

  for (const f of files) {
    if (!fileExists(f)) {
      fail(`${f} exists`, "file not found");
    } else {
      pass(`${f} exists`);
    }
  }

  const astSrc = readFileSync(resolve(ROOT, files[0]), "utf-8");
  if (!astSrc.includes("deny_unknown_fields")) {
    fail("deny_unknown_fields", "not found in recipe_ast.rs");
  } else {
    pass("deny_unknown_fields on step structs");
  }

  if (!astSrc.includes("BusinessField")) {
    fail("FieldCategory::BusinessField", "not found");
  } else {
    pass("FieldCategory::BusinessField defined (only allowed category)");
  }

  // Check TS recipes unblocked
  const recipesTs = readFileSync(
    resolve(ROOT, "packages/browser-automation/src/recipes/index.ts"),
    "utf-8"
  );
  if (recipesTs.includes("blocked-by-r0-07")) {
    fail("recipes unblocked", "still blocked-by-r0-07");
  } else {
    pass("recipes unblocked from blocked-by-r0-07");
  }

  if (!recipesTs.includes("ALLOWED_STEP_TYPES")) {
    fail("ALLOWED_STEP_TYPES", "not exported");
  } else {
    pass("ALLOWED_STEP_TYPES exported");
  }

  if (!recipesTs.includes("REJECTED_STEP_TYPES")) {
    fail("REJECTED_STEP_TYPES", "not exported");
  } else {
    pass("REJECTED_STEP_TYPES exported");
  }

  // Run Rust tests
  const modules = [
    "recipe_ast::tests",
    "injection::tests",
    "callback_handler::tests",
    "webview_manager::tests",
    "evidence::tests",
  ];
  for (const mod_ of modules) {
    try {
      execSync(`cargo test -p gooddealer-automation-host ${mod_}`, {
        cwd: ROOT,
        stdio: "pipe",
      });
      pass(`cargo test ${mod_}`);
    } catch (e) {
      fail(`cargo test ${mod_}`, e.stderr?.toString().slice(-200) || "failed");
    }
  }
}

// ── Slice E: Ticket ──────────────────────────────────────────────────

function sliceTicket() {
  section("Slice E: Ticket Schema + Signing + Consumption");

  const files = [
    "crates/secure-host-core/src/operation_signing.rs",
    "crates/automation-host/src/ticket_consumer.rs",
  ];

  for (const f of files) {
    if (!fileExists(f)) {
      fail(`${f} exists`, "file not found");
    } else {
      pass(`${f} exists`);
    }
  }

  const ticketSrc = readFileSync(resolve(ROOT, files[1]), "utf-8");
  if (!ticketSrc.includes("AutomationExecutionTicket")) {
    fail("AutomationExecutionTicket", "type not found");
  } else {
    pass("AutomationExecutionTicket defined");
  }

  if (!ticketSrc.includes("SunsetAutomationExecutionTicket")) {
    fail("SunsetAutomationExecutionTicket", "type not found");
  } else {
    pass("SunsetAutomationExecutionTicket defined");
  }

  if (!ticketSrc.includes("deny_unknown_fields")) {
    fail("deny_unknown_fields", "not found on ticket types");
  } else {
    pass("deny_unknown_fields on ticket types");
  }

  // Run Rust tests
  try {
    execSync("cargo test -p gooddealer-automation-host ticket_consumer::tests", {
      cwd: ROOT,
      stdio: "pipe",
    });
    pass("cargo test ticket_consumer::tests");
  } catch (e) {
    fail("cargo test ticket_consumer::tests", e.stderr?.toString().slice(-200) || "failed");
  }

  try {
    execSync("cargo test -p gooddealer-secure-host-core operation_signing::tests", {
      cwd: ROOT,
      stdio: "pipe",
    });
    pass("cargo test operation_signing::tests");
  } catch (e) {
    fail("cargo test operation_signing::tests", e.stderr?.toString().slice(-200) || "failed");
  }
}

// ── Dispatch ─────────────────────────────────────────────────────────

console.log(`W3 Evidence Collector — slice: ${slice}`);

switch (slice) {
  case "webview-isolation":
    sliceWebviewIsolation();
    break;
  case "session-context":
    sliceSessionContext();
    break;
  case "profile-policy":
    sliceProfilePolicy();
    break;
  case "recipe-ast":
    sliceRecipeAst();
    break;
  case "ticket":
    sliceTicket();
    break;
  default:
    console.error(`Unknown slice: ${slice}`);
    console.error("Valid slices: webview-isolation, session-context, profile-policy, recipe-ast, ticket");
    process.exit(1);
}

console.log(`\nEvidence collection for slice "${slice}" complete.`);
