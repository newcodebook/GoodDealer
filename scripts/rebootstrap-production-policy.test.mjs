import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const libraryPath = "crates/local-storage/src/lib.rs";
const custodyPath = "crates/local-storage/src/desktop_custody.rs";
const localHostPath = "crates/local-storage/src/backup/desktop_local_host.rs";
const runtimePath = "crates/local-storage/src/rebootstrap_runtime.rs";
const desktopBusinessRuntimePath = "crates/local-storage/src/desktop_business_runtime.rs";
const activeWorkspacePath = "crates/local-storage/src/active_workspace/mod.rs";
const businessPath = "crates/local-storage/src/active_workspace/business/mod.rs";
const sourcePaths = [
  libraryPath,
  custodyPath,
  localHostPath,
  runtimePath,
  desktopBusinessRuntimePath,
  activeWorkspacePath,
  businessPath,
];

export function rebootstrapProductionPolicyErrors({ root = repositoryRoot } = {}) {
  const errors = [];
  const sources = Object.fromEntries(sourcePaths.map((path) => [path, readSource(root, path, errors)]));
  if (Object.values(sources).some((source) => source === null)) return errors;

  validateRuntimeModuleAndHostBoundary(sources[libraryPath], sources[localHostPath], errors);
  validateCreateOnlySlotBoundary(sources[custodyPath], errors);
  validatePristineProductionConstructor(sources[custodyPath], errors);
  validateCustodyProtocolIsTestOnly(sources[custodyPath], errors);
  validateDesktopBusinessProtocolIsTestOnly(sources[desktopBusinessRuntimePath], errors);
  validateActiveWorkspaceProtocolIsTestOnly(sources[activeWorkspacePath], sources[businessPath], errors);
  validateOfficialDependencyAndSelectors(root, sources[custodyPath], sources[localHostPath], errors);
  return errors;
}

function validateRuntimeModuleAndHostBoundary(library, localHost, errors) {
  if (!/#\[cfg\(test\)\]\s*\nmod rebootstrap_runtime;/u.test(library)) {
    errors.push("the entire rebootstrap_runtime module must be test-only");
  }
  if (!/#\[cfg\(test\)\]\s*\nuse crate::rebootstrap_runtime::\{/u.test(localHost)) {
    errors.push("the Local Host rebootstrap runtime import must be test-only");
  }
  if (!/#\[cfg\(test\)\]\s*\n\s*rebootstrap_runtime:\s*Option<RebootstrapRuntime>/u.test(localHost)) {
    errors.push("the Local Host rebootstrap runtime field must be test-only");
  }
  for (const [field, type] of [
    ["rebootstrap_quarantine_custody", "Option<TestRebootstrapQuarantineCustody>"],
    ["rebootstrap_test_executor_enabled", "bool"],
  ]) {
    const escapedType = escapeRegExp(type);
    const guardedField = new RegExp(`#\\[cfg\\(test\\)\\]\\s*\\n\\s*${field}:\\s*${escapedType}`, "u");
    if (!guardedField.test(localHost)) errors.push(`the Local Host ${field} field must be test-only`);
  }
  for (const name of ["RebootstrapCrashBoundary", "RebootstrapRestartDisposition"]) {
    requireTestOnlyDeclaration(localHost, name, errors, "Local Host crash/restart type");
  }

  const applyBlocks = rustFunctionBlocks(localHost, "apply_rebootstrap_plan");
  const production = applyBlocks.filter(({ prefix }) => hasNotTestCfg(prefix));
  const testOnly = applyBlocks.filter(({ prefix }) => hasTestCfg(prefix));
  if (production.length !== 1 || testOnly.length !== 1) {
    errors.push("Local Host must have separate non-test denial and test-only rebootstrap entrypoints");
  } else {
    const executable = stripRustComments(production[0].body).trim();
    if (!/^Err\(DesktopLocalHostError::Unavailable\)$/u.test(executable)) {
      errors.push("the non-test rebootstrap entrypoint must immediately return Unavailable");
    }
    if (/(?:parse|checkpoint|plan|runtime|\.lock\s*\(|custody|journal|database|workspace|file|inspect|begin|reserve|materialize|publish|reopen|retire|discard)/iu.test(executable)) {
      errors.push("the non-test rebootstrap denial must precede parsing, locks, custody, inspection, and effects");
    }
  }

  const protocolTokens = /(?:RebootstrapRuntime|RebootstrapCheckpoint|RebootstrapPlan|RebootstrapCrashBoundary|RebootstrapRestartDisposition|apply_rebootstrap_plan_inner|startup_action\s*\(|self\.rebootstrap_(?:runtime|quarantine_custody|test_executor_enabled))/u;
  const nonTestCallers = rustAllFunctionBlocks(localHost).filter(
    (block) => protocolTokens.test(`${block.header}\n${block.body}`) && !isTestFunction(block, localHost),
  );
  if (nonTestCallers.length > 0) {
    errors.push(`Local Host runtime/parser/executor callers must be test-only: ${nonTestCallers.map(({ name }) => name).join(", ")}`);
  }
  const hostTestFields = [
    "rebootstrap_runtime",
    "rebootstrap_quarantine_custody",
    "rebootstrap_test_executor_enabled",
  ];
  const unguardedInitializers = rustAllFunctionBlocks(localHost).filter((block) => !isTestFunction(block, localHost)
    && hostTestFields.some((field) => block.body.includes(`${field}:`)
      && !(new RegExp(`#\\[cfg\\(test\\)\\]\\s*${field}:`, "u")).test(block.body)));
  if (unguardedInitializers.length > 0) {
    errors.push("Local Host rebootstrap runtime initializers must be test-only");
  }
  const inner = rustFunctionBlocks(localHost, "apply_rebootstrap_plan_inner");
  if (inner.length !== 1 || !hasTestCfg(inner[0].prefix)) {
    errors.push("the checkpoint/plan parser and executor must be test-only");
  }
  if (/#\[cfg[^\]]*\bfeature\s*=/u.test(`${library}\n${localHost}`)
      || hasRebootstrapEnvironmentSelector(localHost)) {
    errors.push("the rebootstrap runtime must not be feature- or environment-selectable");
  }
}

function validateCreateOnlySlotBoundary(source, errors) {
  const blocks = rustFunctionBlocks(source, "create_slot_native");
  if (blocks.length !== 1 || !hasTestCfg(blocks[0].prefix)) {
    errors.push("create_slot_native must have exactly one test-only implementation");
    return;
  }
  const fake = blocks[0];
  if (/\bpub(?:\s*\([^)]*\))?\s+fn\s+create_slot_native\b/u.test(fake.header)) {
    errors.push("the create-only slot fake must remain private");
  }
  if (!/Entry::Vacant/u.test(fake.body) || !/Entry::Occupied/u.test(fake.body)) {
    errors.push("the test-only slot fake must preserve create-only duplicate rejection");
  }
  const testConstructor = exactlyOneFunction(source, "load_or_create_for_rebootstrap_test_with_store", errors);
  if (testConstructor !== null && !hasTestCfg(testConstructor.prefix)) {
    errors.push("load_or_create_for_rebootstrap_test_with_store must remain test-only");
  }
  const capability = exactlyOneFunction(source, "load_or_create_with_capability", errors);
  if (capability !== null && /\bpub(?:\s*\([^)]*\))?\s+fn\b/u.test(capability.header)) {
    errors.push("the capability-bearing custody constructor must remain private");
  }
  if (!/#\[cfg\(test\)\][\s\S]{0,160}TestCreateOnly/u.test(source)
      || /RebootstrapCapability::(?:Fake|Development|Injected)|Rebootstrap(?:Fake|Development)Backend/u.test(source)) {
    errors.push("only the private test constructor may select the create-only slot backend");
  }
  const executable = stripRustComments(source);
  if (/(?:store_native|set_generic_password(?:_options)?)\s*\(\s*REBOOTSTRAP_KEY_SERVICE/u.test(executable)
      || /ensure_native_exact\s*\([^)]*REBOOTSTRAP_KEY_SERVICE/u.test(executable)
      || /pub(?:\s*\([^)]*\))?\s+fn\s+create_slot_native\b/u.test(source)) {
    errors.push("production rebootstrap slot write, upsert, preflight, and public selection are forbidden");
  }
}

function validatePristineProductionConstructor(custody, errors) {
  if (!/const REBOOTSTRAP_DATABASE_NAMES:\s*\[&str; 2\]\s*=\s*\["rebootstrap-a\.db", "rebootstrap-b\.db"\];/u.test(custody)
      || !/const REBOOTSTRAP_SLOT_ACCOUNTS:\s*\[&str; 2\]\s*=\s*\["slot-a-sqlcipher-v1", "slot-b-sqlcipher-v1"\];/u.test(custody)) {
    errors.push("production residue checks must use the two fixed database and slot-account arrays");
  }
  const pristine = exactlyOneFunction(custody, "assert_rebootstrap_files_pristine", errors);
  const constructor = exactlyOneFunction(custody, "load_or_create_with_capability", errors);
  const sidecars = exactlyOneFunction(custody, "reject_database_sidecars", errors);
  if (pristine === null || constructor === null || sidecars === null) return;
  for (const required of ['"rebootstrap.journal"', "REBOOTSTRAP_DATABASE_NAMES", "require_absent_workspace_entry", "reject_database_sidecars"]) {
    if (!pristine.body.includes(required)) errors.push(`production pristine file gate is missing ${required}`);
  }
  if (!sidecars.body.includes('["-wal", "-shm", "-journal"]')) {
    errors.push("production pristine gate must reject WAL, SHM, and rollback-journal sidecars");
  }
  if (!/#\[cfg\(not\(test\)\)\][\s\S]{0,120}for account in REBOOTSTRAP_SLOT_ACCOUNTS/u.test(constructor.body)
      || !/load_native\(REBOOTSTRAP_KEY_SERVICE, account\)/u.test(constructor.body)) {
    errors.push("production custody must reject either fixed slot-account record");
  }
  const fileGate = constructor.body.indexOf("assert_rebootstrap_files_pristine");
  const slotGate = constructor.body.indexOf("for account in REBOOTSTRAP_SLOT_ACCOUNTS");
  const firstEffect = firstIndex(constructor.body, ["open_existing_database", "load_database_key()", "generate_and_store_database_key()"]);
  if (fileGate < 0 || slotGate < 0 || firstEffect < 0 || fileGate > firstEffect || slotGate > firstEffect) {
    errors.push("production file and slot residue gates must run before database/key creation");
  }
}

function validateCustodyProtocolIsTestOnly(custody, errors) {
  for (const name of [
    "RebootstrapCapability", "DesktopJournalStore", "RebootstrapCandidate", "CandidateReservation", "PreparedEvidence",
    "CandidateReservedEvidence", "VerifiedCustodyEvidence", "CandidateFinalEvidence",
    "VerifiedCandidate", "PublishedRebootstrap", "DecodedRebootstrapSlotRecord",
    "FileCustodyEvidence", "TestRecoveryLogicalEvidence",
  ]) requireTestOnlyDeclaration(custody, name, errors, "custody protocol type");

  for (const name of [
    "require_rebootstrap_reservation_capability", "reserve_rebootstrap", "materialize_candidate",
    "with_rebootstrap_candidate", "verify_candidate", "discard_rebootstrap_candidate_handle",
    "publish", "publish_internal", "verify_published_read_only",
    "reopen_published_with_crash_for_test", "retire_rebootstrap_old", "rebootstrap_journal_store",
    "slot_record_digest", "rebootstrap_slot_file_name", "rebootstrap_slot_record",
    "validate_rebootstrap_slot_record", "decode_rebootstrap_slot_record",
    "candidate_custody_evidence", "recovery_evidence_for_topology", "verify_recovery_logical",
    "file_custody_evidence", "add_file_evidence", "prepared_evidence_digest",
    "candidate_reserved_evidence_digest", "verified_evidence_digest", "add_journal_link",
    "recovery_proof_digest", "journal_link_digest", "slot_byte", "key_digest",
    "lower_hex", "valid_lower_hex_digest", "decode_lower_hex_digest",
  ]) requireTestOnlyFunction(custody, name, errors, "custody protocol function");
  requireTestOnlyTopLevelFunction(custody, "workspace_id_digest", errors, "custody protocol function");

  const forbiddenProduction = rustAllFunctionBlocks(custody).filter(({ name, prefix }) => (
    /^(?:reopen_published|reserve_rebootstrap|materialize_candidate|publish_rebootstrap)$/u.test(name)
      && !hasTestCfg(prefix)
  ));
  if (forbiddenProduction.length > 0) {
    errors.push("production custody must not contain reserve/materialize/publish/reopen protocol seams");
  }
}

function validateDesktopBusinessProtocolIsTestOnly(desktopBusinessRuntime, errors) {
  requireTestOnlyFunction(
    desktopBusinessRuntime,
    "into_database",
    errors,
    "Desktop business ownership-transfer seam",
  );
}

function validateActiveWorkspaceProtocolIsTestOnly(activeWorkspace, business, errors) {
  for (const name of ["clone_encrypted_to_file", "clone_keyed_database"]) {
    requireTestOnlyFunction(activeWorkspace, name, errors, "active-workspace clone seam");
  }
  for (const name of ["RebootstrapSlotId", "RebootstrapJournalLink", "RebootstrapReplayPage", "CheckpointAdmissionFloor"]) {
    requireTestOnlyDeclaration(business, name, errors, "business rebootstrap type");
  }
  for (const name of [
    "cloned", "custody_bytes", "clone_encrypted_database", "validate_rebootstrap_journal_link",
    "verify_rebootstrap_journal_link_on_connection", "checkpoint_admission_floor",
    "verify_rebootstrap_final_head", "clone_encrypted_to_file", "prepare_rebootstrap_publication",
    "verify_rebootstrap_journal_link", "open_existing_derived", "install_rebootstrap_checkpoint",
    "install_rebootstrap_checkpoint_guarded", "install_rebootstrap_plan_guarded",
    "install_rebootstrap_checkpoint_savepoint", "open_descriptor_bound_database_read_only",
    "verify_clean_manifest_on_connection", "verify_terminal_publication_database_read_only",
    "verify_clean_start_database_read_only", "verify_rebootstrap_recovery_read_only",
    "recovery_proof_from_connection", "verify_rebootstrap_plan_digest",
    "verify_rebootstrap_checkpoint_digest", "validate_rebootstrap_asset",
    "validate_rebootstrap_timestamp", "verify_rebootstrap_page_digest",
    "merge_checkpoint_existing_asset", "persist_checkpoint_conflict_candidate",
  ]) requireTestOnlyFunction(business, name, errors, "business rebootstrap function");
}

function validateOfficialDependencyAndSelectors(root, custody, localHost, errors) {
  const rootManifest = readSource(root, "Cargo.toml", errors);
  const storageManifest = readSource(root, "crates/local-storage/Cargo.toml", errors);
  const lockfile = readSource(root, "Cargo.lock", errors);
  if (rootManifest === null || storageManifest === null || lockfile === null) return;
  if (!/security-framework\s*=\s*\{\s*version\s*=\s*"=3\.7\.0"/u.test(storageManifest)) {
    errors.push("local-storage must use the official pinned security-framework 3.7.0 dependency");
  }
  if (/^\[patch(?:\.|\])/mu.test(rootManifest)
      || /(?:^|[\s"'=\/])vendor(?:[\s"'\/]|$)/imu.test(rootManifest)
      || !/name = "security-framework"\nversion = "3\.7\.0"\nsource = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"/u.test(lockfile)) {
    errors.push("security-framework must resolve from crates.io without a patch or vendored override");
  }
  const selectionSource = `${custody}\n${localHost}\n${storageManifest}`;
  if (/#\[cfg[^\]]*\bfeature\s*=/u.test(selectionSource)
      || hasRebootstrapEnvironmentSelector(selectionSource)) {
    errors.push("rebootstrap fake/backend selection must not depend on Cargo features or environment variables");
  }
  if (/\b(?:dyn|impl)\s+[A-Za-z_]*Rebootstrap(?:Backend|Provider|Factory|Locator)\b/u.test(selectionSource)
      || /\b(?:RebootstrapServiceLocator|set_rebootstrap_backend|with_rebootstrap_backend)\b/u.test(selectionSource)) {
    errors.push("production rebootstrap must not accept backend injection or a service locator");
  }
}

function requireTestOnlyFunction(source, name, errors, description) {
  const blocks = rustFunctionBlocks(source, name);
  if (blocks.length === 0 || blocks.some(({ prefix }) => !hasTestCfg(prefix))) {
    errors.push(`${description} ${name} must be directly cfg(test)`);
  }
}

function requireTestOnlyTopLevelFunction(source, name, errors, description) {
  const blocks = rustFunctionBlocks(source, name).filter((block) => {
    const lineStart = source.lastIndexOf("\n", block.index) + 1;
    return !/^\s/u.test(source.slice(lineStart, block.index));
  });
  if (blocks.length !== 1 || !hasTestCfg(blocks[0].prefix)) {
    errors.push(`${description} ${name} must be directly cfg(test)`);
  }
}

function requireTestOnlyDeclaration(source, name, errors, description) {
  const matcher = new RegExp(`\\b(?:struct|enum)\\s+${name}\\b`, "gu");
  const matches = [...source.matchAll(matcher)];
  if (matches.length !== 1 || !hasTestCfg(itemPrefix(source, matches[0].index))) {
    errors.push(`${description} ${name} must be directly cfg(test)`);
  }
}

function exactlyOneFunction(source, name, errors) {
  const blocks = rustFunctionBlocks(source, name);
  if (blocks.length !== 1) {
    errors.push(`expected exactly one ${name} function`);
    return null;
  }
  return blocks[0];
}

function rustFunctionBlocks(source, name) {
  const matcher = new RegExp(`\\bfn\\s+${name}\\s*(?:<[^>{}]*>)?\\s*\\(`, "gu");
  const blocks = [];
  for (const match of source.matchAll(matcher)) {
    const open = source.indexOf("{", match.index);
    if (open < 0) continue;
    const close = matchingBrace(source, open);
    if (close < 0) continue;
    blocks.push({ name, index: match.index, prefix: itemPrefix(source, match.index), header: source.slice(match.index, open), body: source.slice(open + 1, close) });
  }
  return blocks;
}

function rustAllFunctionBlocks(source) {
  const matcher = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>{}]*>)?\s*\(/gu;
  const blocks = [];
  for (const match of source.matchAll(matcher)) {
    const open = source.indexOf("{", match.index);
    if (open < 0) continue;
    const close = matchingBrace(source, open);
    if (close < 0) continue;
    blocks.push({ name: match[1], index: match.index, prefix: itemPrefix(source, match.index), header: source.slice(match.index, open), body: source.slice(open + 1, close) });
  }
  return blocks;
}

function itemPrefix(source, index) {
  return source.slice(Math.max(0, source.lastIndexOf("\n\n", index) + 2), index);
}

function hasTestCfg(prefix) {
  return /#\[cfg\((?:test|all\(test,\s*unix\))\)\]/u.test(prefix);
}

function hasNotTestCfg(prefix) {
  return /#\[cfg\(not\(test\)\)\]/u.test(prefix);
}

function isTestFunction(block, source) {
  const testModule = source.search(/\n#\[cfg\(test\)\]\nmod\s+tests\s*\{/u);
  return hasTestCfg(block.prefix) || (testModule >= 0 && block.index > testModule);
}

function matchingBrace(source, open) {
  let depth = 0;
  let state = "code";
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") { if (char === "\n") state = "code"; continue; }
    if (state === "block") { if (char === "*" && next === "/") { state = "code"; index += 1; } continue; }
    if (state === "string" || state === "char") {
      if (char === "\\") { index += 1; continue; }
      if ((state === "string" && char === '"') || (state === "char" && char === "'")) state = "code";
      continue;
    }
    if (char === "/" && next === "/") { state = "line"; index += 1; continue; }
    if (char === "/" && next === "*") { state = "block"; index += 1; continue; }
    if (char === '"') { state = "string"; continue; }
    if (char === "'" && source[index + 2] === "'") { state = "char"; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function firstIndex(source, needles) {
  const positions = needles.map((needle) => source.indexOf(needle)).filter((index) => index >= 0);
  return positions.length === 0 ? -1 : Math.min(...positions);
}

function stripRustComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

function hasRebootstrapEnvironmentSelector(source) {
  return /(?:option_env!|env!|std::env|env::var)\s*[!(][^\n]*(?:REBOOTSTRAP_(?:MODE|BACKEND|RUNTIME|FAKE)|rebootstrap_(?:mode|backend|runtime|fake))/u.test(source);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readSource(root, path, errors) {
  try { return readFileSync(resolve(root, path), "utf8"); }
  catch { errors.push(`${path}: source is unreadable`); return null; }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-rebootstrap-policy-"));
  for (const path of ["Cargo.toml", "Cargo.lock", "crates/local-storage/Cargo.toml", ...sourcePaths]) {
    const destination = resolve(root, path);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, readFileSync(resolve(repositoryRoot, path), "utf8"));
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function mutate(root, path, from, to) {
  const target = resolve(root, path);
  const source = readFileSync(target, "utf8");
  assert.ok(source.includes(from), `fixture mutation source is absent: ${from}`);
  writeFileSync(target, source.replace(from, to));
}

function removeDirectTestCfgFromFunction(root, path, name) {
  const target = resolve(root, path);
  const source = readFileSync(target, "utf8");
  const blocks = rustFunctionBlocks(source, name);
  assert.equal(blocks.length, 1, `fixture must contain exactly one ${name} function`);
  const block = blocks[0];
  const marker = "#[cfg(test)]";
  const relativeMarker = block.prefix.lastIndexOf(marker);
  assert.notEqual(relativeMarker, -1, `${name} fixture must have a direct cfg(test) attribute`);
  const markerStart = block.index - block.prefix.length + relativeMarker;
  const markerEnd = markerStart + marker.length + (source[markerStart + marker.length] === "\n" ? 1 : 0);
  writeFileSync(target, source.slice(0, markerStart) + source.slice(markerEnd));
}

test("production rebootstrap is absent and fail-closed before every persistent effect", () => {
  assert.deepEqual(rebootstrapProductionPolicyErrors(), []);
});

test("rejects a production runtime module, import, field, or initializer", (t) => {
  const module = fixture(t);
  mutate(module, libraryPath, "#[cfg_attr(not(unix), cfg(any()))]\n#[cfg(test)]\nmod rebootstrap_runtime;", "mod rebootstrap_runtime;");
  assert.ok(rebootstrapProductionPolicyErrors({ root: module }).some((error) => error.includes("entire rebootstrap_runtime")));

  const field = fixture(t);
  mutate(field, localHostPath, "    #[cfg_attr(not(unix), cfg(any()))]\n    #[cfg(test)]\n    rebootstrap_runtime: Option<RebootstrapRuntime>,", "    rebootstrap_runtime: Option<RebootstrapRuntime>,");
  assert.ok(rebootstrapProductionPolicyErrors({ root: field }).some((error) => error.includes("runtime field")));

  const quarantineField = fixture(t);
  mutate(
    quarantineField,
    localHostPath,
    "    #[cfg_attr(not(unix), cfg(any()))]\n    #[cfg(test)]\n    rebootstrap_quarantine_custody: Option<TestRebootstrapQuarantineCustody>,",
    "    rebootstrap_quarantine_custody: Option<TestRebootstrapQuarantineCustody>,",
  );
  assert.ok(rebootstrapProductionPolicyErrors({ root: quarantineField }).some(
    (error) => error.includes("rebootstrap_quarantine_custody field"),
  ));

  const caller = fixture(t);
  mutate(caller, localHostPath, "    #[cfg_attr(not(unix), cfg(any()))]\n    #[cfg(test)]\n    fn restart_host_without_authority_for_test(", "    fn restart_host_without_authority_for_test(");
  assert.ok(rebootstrapProductionPolicyErrors({ root: caller }).some((error) => error.includes("callers must be test-only")));
});

test("rejects parsing, locking, inspection, or effects before production Unavailable", (t) => {
  const root = fixture(t);
  mutate(root, localHostPath,
    "        Err(DesktopLocalHostError::Unavailable)\n    }\n\n    #[cfg_attr(not(unix), cfg(any()))]\n    #[cfg(test)]\n    pub(crate) fn apply_rebootstrap_plan(",
    "        let _ = RebootstrapPlan::parse(_checkpoint_wire, _plan_wire);\n        let _guard = self.operation_selection.lock();\n        Err(DesktopLocalHostError::Unavailable)\n    }\n\n    #[cfg_attr(not(unix), cfg(any()))]\n    #[cfg(test)]\n    pub(crate) fn apply_rebootstrap_plan(");
  const errors = rebootstrapProductionPolicyErrors({ root });
  assert.ok(errors.some((error) => error.includes("immediately return Unavailable") || error.includes("precede parsing")), errors.join("\n"));
});

test("rejects non-test custody protocol types, mutations, and reopen seams", (t) => {
  const capability = fixture(t);
  mutate(
    capability,
    custodyPath,
    "#[cfg(test)]\n#[derive(Clone, Copy, Debug, PartialEq, Eq)]\nenum RebootstrapCapability",
    "#[derive(Clone, Copy, Debug, PartialEq, Eq)]\nenum RebootstrapCapability",
  );
  assert.ok(rebootstrapProductionPolicyErrors({ root: capability }).some((error) => error.includes("RebootstrapCapability")));

  const type = fixture(t);
  mutate(type, custodyPath, "#[cfg(test)]\npub(crate) struct RebootstrapCandidate", "pub(crate) struct RebootstrapCandidate");
  assert.ok(rebootstrapProductionPolicyErrors({ root: type }).some((error) => error.includes("RebootstrapCandidate")));

  const mutation = fixture(t);
  removeDirectTestCfgFromFunction(mutation, custodyPath, "materialize_candidate");
  assert.ok(rebootstrapProductionPolicyErrors({ root: mutation }).some((error) => error.includes("materialize_candidate")));

  const reopen = fixture(t);
  const target = resolve(reopen, custodyPath);
  writeFileSync(target, `${readFileSync(target, "utf8")}\nfn reopen_published() {}\n`);
  assert.ok(rebootstrapProductionPolicyErrors({ root: reopen }).some((error) => error.includes("reopen")));
});

test("rejects non-test active-workspace clone and checkpoint protocol seams", (t) => {
  const ownershipTransfer = fixture(t);
  mutate(
    ownershipTransfer,
    desktopBusinessRuntimePath,
    "    #[cfg(test)]\n    pub(crate) fn into_database(",
    "    pub(crate) fn into_database(",
  );
  assert.ok(rebootstrapProductionPolicyErrors({ root: ownershipTransfer }).some((error) => error.includes("into_database")));

  const clone = fixture(t);
  mutate(clone, activeWorkspacePath, "    #[cfg(test)]\n    pub(crate) fn clone_keyed_database(", "    pub(crate) fn clone_keyed_database(");
  assert.ok(rebootstrapProductionPolicyErrors({ root: clone }).some((error) => error.includes("clone_keyed_database")));

  const plan = fixture(t);
  mutate(plan, businessPath, "    #[cfg(test)]\n    pub fn install_rebootstrap_plan_guarded(", "    pub fn install_rebootstrap_plan_guarded(");
  assert.ok(rebootstrapProductionPolicyErrors({ root: plan }).some((error) => error.includes("install_rebootstrap_plan_guarded")));

  const recoveryProof = fixture(t);
  mutate(
    recoveryProof,
    businessPath,
    "#[cfg(test)]\nfn recovery_proof_from_connection(",
    "fn recovery_proof_from_connection(",
  );
  assert.ok(rebootstrapProductionPolicyErrors({ root: recoveryProof }).some((error) => error.includes("recovery_proof_from_connection")));
});

test("rejects production slot writes and selectable test backends", (t) => {
  const upsert = fixture(t);
  const target = resolve(upsert, custodyPath);
  writeFileSync(target, `${readFileSync(target, "utf8")}\nfn illicit_slot_write() { let _ = store_native(REBOOTSTRAP_KEY_SERVICE, "slot-a-sqlcipher-v1", b"x"); }\n`);
  assert.ok(rebootstrapProductionPolicyErrors({ root: upsert }).some((error) => error.includes("slot write")));

  const feature = fixture(t);
  mutate(feature, custodyPath, "#[cfg(test)]\nfn create_slot_native(", "#[cfg(feature = \"slot-fake\")]\npub fn create_slot_native(");
  assert.ok(rebootstrapProductionPolicyErrors({ root: feature }).some((error) => error.includes("test-only implementation") || error.includes("features")));
});

test("rejects incomplete or late residue gates and patched dependencies", (t) => {
  const sidecar = fixture(t);
  mutate(sidecar, custodyPath, '["-wal", "-shm", "-journal"]', '["-wal", "-shm"]');
  assert.ok(rebootstrapProductionPolicyErrors({ root: sidecar }).some((error) => error.includes("sidecars")));

  const late = fixture(t);
  mutate(late, custodyPath,
    "        assert_rebootstrap_files_pristine(&active_workspace)?;",
    "        let existing_database = open_existing_database(&active_workspace)?;\n        assert_rebootstrap_files_pristine(&active_workspace)?;");
  assert.ok(rebootstrapProductionPolicyErrors({ root: late }).some((error) => error.includes("before database/key creation")));

  const patched = fixture(t);
  const manifest = resolve(patched, "Cargo.toml");
  writeFileSync(manifest, `${readFileSync(manifest, "utf8")}\n[patch.crates-io]\nsecurity-framework = { path = "vendor/security-framework" }\n`);
  assert.ok(rebootstrapProductionPolicyErrors({ root: patched }).some((error) => error.includes("crates.io")));
});

test("the non-test local-storage source compiles without the protocol", () => {
  const result = spawnSync("cargo", ["check", "-p", "gooddealer-local-storage", "--lib"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
});
