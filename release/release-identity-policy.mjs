import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const releaseRepositoryRoot = resolve(moduleDirectory, "..");
export const releaseRequestPath = "release/release-request.json";
export const releaseManifestDirectory = ".artifacts/release";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const gitObjectPattern = /^[a-f0-9]{40,64}$/u;
const semVerPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const safeSlugPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const decisionReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const forbiddenProductionPathSegments = new Set([
  "test",
  "tests",
  "fixture",
  "fixtures",
  "test-vector",
  "test-vectors",
  "visual-fixture",
  "visual-fixtures",
  "generated-test-only",
]);

const removedConnectorRoots = Object.freeze([
  ["packages", ["connector", "sdk"].join("-")].join("/"),
  ["packages", ["connector", "test", "kit"].join("-")].join("/"),
  ["packages", "connectors", "afternic"].join("/"),
  ["packages", "connectors", "atom"].join("/"),
  ["packages", "connectors", "spaceship"].join("/"),
]);

const externalEvidenceKeys = Object.freeze([
  "signing",
  "notarization",
  "wormArchive",
  "independentReview",
  "providerQualification",
  "governance",
  "gateClosure",
]);

/** Fixed production-only observations; fixture and test-vector paths are absent by design. */
export const releaseProductionCatalog = Object.freeze({
  runtimeIdentityPath: "apps/desktop/src/release-identity.json",
  runtimeEntrypointPath: "apps/desktop/src/main.tsx",
});

/** A fail-closed release-identity policy violation. */
export class ReleaseIdentityPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseIdentityPolicyError";
  }
}

function invariant(condition, message) {
  if (!condition) throw new ReleaseIdentityPolicyError(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function byteOrder(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function strictPlainData(value, context = "value", visiting = new WeakSet(), complete = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    invariant(Number.isFinite(value), `${context}: non-finite numbers are forbidden`);
    return;
  }

  invariant(typeof value === "object", `${context}: expected JSON-compatible plain data`);
  invariant(!visiting.has(value), `${context}: cyclic values are forbidden`);
  if (complete.has(value)) return;

  visiting.add(value);
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${context}: symbol fields are forbidden`);

  if (Array.isArray(value)) {
    invariant(Object.getPrototypeOf(value) === Array.prototype, `${context}: array prototype is forbidden`);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    invariant(
      lengthDescriptor !== undefined && "value" in lengthDescriptor &&
        Number.isSafeInteger(lengthDescriptor.value) && lengthDescriptor.value >= 0 &&
        lengthDescriptor.value <= 0xffff_ffff && lengthDescriptor.enumerable === false &&
        lengthDescriptor.configurable === false && lengthDescriptor.writable === true,
      `${context}: invalid array length descriptor`,
    );
    const expectedKeys = Array.from({ length: lengthDescriptor.value }, (_, index) => String(index));
    const ownKeys = Reflect.ownKeys(value);
    invariant(
      ownKeys.length === expectedKeys.length + 1 && ownKeys.includes("length") &&
        expectedKeys.every((key) => ownKeys.includes(key)),
      `${context}: array must contain exactly contiguous data indices`,
    );
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      invariant(
        descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true &&
          descriptor.configurable === true && descriptor.writable === true,
        `${context}[${key}]: array element must be an own data property`,
      );
      strictPlainData(descriptor.value, `${context}[${key}]`, visiting, complete);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    invariant(
      prototype === Object.prototype || prototype === null,
      `${context}: custom object prototypes are forbidden`,
    );
    for (const key of Reflect.ownKeys(value)) {
      invariant(typeof key === "string", `${context}: non-string object keys are forbidden`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      invariant(
        descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true &&
          descriptor.configurable === true && descriptor.writable === true,
        `${context}.${key}: fields must be exact own enumerable data properties`,
      );
      strictPlainData(descriptor.value, `${context}.${key}`, visiting, complete);
    }
  }

  visiting.delete(value);
  complete.add(value);
}

function exactRecord(value, expectedKeys, context) {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${context}: expected object`);
  const actualKeys = Reflect.ownKeys(value);
  invariant(
    actualKeys.length === expectedKeys.length && actualKeys.every((key) => typeof key === "string") &&
      expectedKeys.every((key) => actualKeys.includes(key)),
    `${context}: unknown, missing, or non-string fields are forbidden`,
  );
  const result = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    invariant(
      descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true &&
        descriptor.configurable === true && descriptor.writable === true,
      `${context}.${key}: must be an own enumerable data property`,
    );
    result[key] = descriptor.value;
  }
  return result;
}

function exactArray(value, context) {
  invariant(Array.isArray(value), `${context}: expected array`);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  invariant(
    lengthDescriptor !== undefined && "value" in lengthDescriptor &&
      Number.isSafeInteger(lengthDescriptor.value) && lengthDescriptor.value === value.length,
    `${context}: invalid array length`,
  );
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    invariant(descriptor !== undefined && "value" in descriptor, `${context}[${index}]: missing data element`);
    return descriptor.value;
  });
}

function skipWhitespace(source, cursor) {
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function scanJsonString(source, cursor) {
  invariant(source[cursor] === '"', "JSON duplicate-key scanner expected a string");
  for (let index = cursor + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === '"') return index + 1;
  }
  throw new ReleaseIdentityPolicyError("unterminated JSON string");
}

function scanJsonValue(source, start) {
  let cursor = skipWhitespace(source, start);
  if (source[cursor] === '"') return scanJsonString(source, cursor);
  if (source[cursor] === "[") {
    cursor = skipWhitespace(source, cursor + 1);
    if (source[cursor] === "]") return cursor + 1;
    while (true) {
      cursor = skipWhitespace(source, scanJsonValue(source, cursor));
      if (source[cursor] === "]") return cursor + 1;
      invariant(source[cursor] === ",", "invalid JSON array");
      cursor = skipWhitespace(source, cursor + 1);
    }
  }
  if (source[cursor] === "{") {
    const keys = new Set();
    cursor = skipWhitespace(source, cursor + 1);
    if (source[cursor] === "}") return cursor + 1;
    while (true) {
      invariant(source[cursor] === '"', "invalid JSON object key");
      const keyEnd = scanJsonString(source, cursor);
      const key = JSON.parse(source.slice(cursor, keyEnd));
      invariant(!keys.has(key), `duplicate JSON key: ${key}`);
      keys.add(key);
      cursor = skipWhitespace(source, keyEnd);
      invariant(source[cursor] === ":", "invalid JSON object separator");
      cursor = skipWhitespace(source, scanJsonValue(source, cursor + 1));
      if (source[cursor] === "}") return cursor + 1;
      invariant(source[cursor] === ",", "invalid JSON object");
      cursor = skipWhitespace(source, cursor + 1);
    }
  }
  const primitiveStart = cursor;
  while (cursor < source.length && !/[\s,\]}]/u.test(source[cursor])) cursor += 1;
  invariant(cursor > primitiveStart, "invalid JSON value");
  return cursor;
}

export function parseReleaseJson(source, context = "release JSON") {
  invariant(typeof source === "string", `${context}: expected UTF-8 JSON text`);
  const value = JSON.parse(source);
  invariant(skipWhitespace(source, scanJsonValue(source, 0)) === source.length, `${context}: trailing JSON data is forbidden`);
  strictPlainData(value, context);
  return value;
}

function canonicalJsonInternal(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonInternal).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Reflect.ownKeys(value).sort(byteOrder).map((key) => `${JSON.stringify(key)}:${canonicalJsonInternal(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalReleaseJson(value) {
  strictPlainData(value, "canonical release JSON");
  return canonicalJsonInternal(value);
}

function normalizeProductionRelativePath(path, context) {
  invariant(typeof path === "string" && Buffer.byteLength(path, "utf8") > 0 && Buffer.byteLength(path, "utf8") <= 240, `${context}: invalid path length`);
  invariant(!path.includes("\u0000") && !path.includes("\\") && !path.startsWith("/"), `${context}: absolute, NUL, and backslash paths are forbidden`);
  const segments = path.split("/");
  invariant(
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    `${context}: empty, current-directory, and parent-directory path segments are forbidden`,
  );
  invariant(
    segments.every((segment) => /^[A-Za-z0-9._-]+$/u.test(segment)),
    `${context}: shell metacharacters and non-portable path characters are forbidden`,
  );
  invariant(
    segments.every((segment) => !forbiddenProductionPathSegments.has(segment.toLowerCase())),
    `${context}: fixture and test paths are forbidden from production release composition`,
  );
  return segments.join("/");
}

function resolveProductionPath(root, path, context) {
  const normalized = normalizeProductionRelativePath(path, context);
  const absolute = resolve(root, normalized);
  const local = relative(root, absolute);
  invariant(local !== "" && !local.startsWith("../") && local !== "..", `${context}: path escapes repository root`);
  return { absolute, normalized };
}

function assertNoSymlinkSegments(root, normalizedPath, context) {
  let cursor = root;
  for (const segment of normalizedPath.split("/")) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) continue;
    invariant(!lstatSync(cursor).isSymbolicLink(), `${context}: symbolic links are forbidden`);
  }
}

function readRegularFile(root, relativePath, context) {
  const resolved = resolveProductionPath(root, relativePath, context);
  assertNoSymlinkSegments(root, resolved.normalized, context);
  invariant(existsSync(resolved.absolute), `${context}: required file is absent`);
  const stat = lstatSync(resolved.absolute);
  invariant(stat.isFile() && !stat.isSymbolicLink(), `${context}: required path must be a regular file`);
  return { ...resolved, bytes: readFileSync(resolved.absolute) };
}

function readStrictJsonFile(root, relativePath, context) {
  const file = readRegularFile(root, relativePath, context);
  return parseReleaseJson(file.bytes.toString("utf8"), context);
}

function validateSemVer(value, context) {
  invariant(typeof value === "string" && Buffer.byteLength(value, "utf8") <= 128 && semVerPattern.test(value), `${context}: expected canonical semantic version`);
  const base = value.split(/[+-]/u, 1)[0];
  invariant(base !== "0.0.0", `${context}: 0.0.0 is a development sentinel, not a release identity`);
  return value;
}

function validateChannel(value, context) {
  invariant(typeof value === "string" && safeSlugPattern.test(value), `${context}: invalid channel`);
  return value;
}

function validateApproval(value, context) {
  const approval = exactRecord(value, ["kind", "decisionRef"], context);
  invariant(approval.kind === "product-owner-decision", `${context}.kind: invalid approval kind`);
  invariant(typeof approval.decisionRef === "string" && decisionReferencePattern.test(approval.decisionRef), `${context}.decisionRef: invalid opaque decision reference`);
  return { kind: approval.kind, decisionRef: approval.decisionRef };
}

function validateTarget(value, context) {
  const target = exactRecord(value, ["platform", "architecture"], context);
  invariant(typeof target.platform === "string" && safeSlugPattern.test(target.platform), `${context}.platform: invalid target platform`);
  invariant(typeof target.architecture === "string" && safeSlugPattern.test(target.architecture), `${context}.architecture: invalid target architecture`);
  return { platform: target.platform, architecture: target.architecture };
}

function validateArtifactDeclarations(value, context) {
  const entries = exactArray(value, context);
  invariant(entries.length >= 1 && entries.length <= 64, `${context}: expected one to 64 declared artifacts`);
  const paths = new Set();
  return entries.map((entry, index) => {
    const artifact = exactRecord(entry, ["path"], `${context}[${index}]`);
    const path = normalizeProductionRelativePath(artifact.path, `${context}[${index}].path`);
    invariant(!paths.has(path), `${context}[${index}].path: duplicate declared artifact`);
    paths.add(path);
    return { path };
  }).sort((left, right) => byteOrder(left.path, right.path));
}

/** Validate a strict release request received from unknown data. */
export function validateReleaseRequest(value) {
  strictPlainData(value, "release request");
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), "release request: expected object");
  const stateDescriptor = Object.getOwnPropertyDescriptor(value, "state");
  invariant(stateDescriptor !== undefined && "value" in stateDescriptor && typeof stateDescriptor.value === "string", "release request.state: expected string");

  if (stateDescriptor.value === "unissued") {
    const request = exactRecord(value, ["schemaVersion", "state"], "release request");
    invariant(request.schemaVersion === 1, "release request.schemaVersion: unsupported schema version");
    return { schemaVersion: 1, state: "unissued" };
  }

  invariant(stateDescriptor.value === "approved", "release request.state: only unissued or approved states are accepted");
  const request = exactRecord(
    value,
    ["schemaVersion", "state", "version", "channel", "productApproval", "target", "artifactRoot", "artifacts"],
    "release request",
  );
  invariant(request.schemaVersion === 1, "release request.schemaVersion: unsupported schema version");
  const artifactRoot = normalizeProductionRelativePath(request.artifactRoot, "release request.artifactRoot");
  return {
    schemaVersion: 1,
    state: "approved",
    version: validateSemVer(request.version, "release request.version"),
    channel: validateChannel(request.channel, "release request.channel"),
    productApproval: validateApproval(request.productApproval, "release request.productApproval"),
    target: validateTarget(request.target, "release request.target"),
    artifactRoot,
    artifacts: validateArtifactDeclarations(request.artifacts, "release request.artifacts"),
  };
}

export function parseReleaseRequestJson(source) {
  return validateReleaseRequest(parseReleaseJson(source, "release request JSON"));
}

export function readReleaseRequest(repositoryRoot = releaseRepositoryRoot) {
  return validateReleaseRequest(readStrictJsonFile(repositoryRoot, releaseRequestPath, "release request"));
}

function pendingExternalEvidence() {
  return {
    signing: {
      status: "pending",
      proof: null,
      issuer: null,
      verification: null,
      rotationOrRevocation: null,
    },
    notarization: { status: "pending", proof: null },
    wormArchive: { status: "pending", proof: null },
    independentReview: { status: "pending", proof: null },
    providerQualification: { status: "pending", proof: null },
    governance: { status: "pending", proof: null },
    gateClosure: { status: "pending", proof: null },
  };
}

function validatePendingExternalEvidence(value, context) {
  const evidence = exactRecord(value, externalEvidenceKeys, context);
  const signing = exactRecord(evidence.signing, ["status", "proof", "issuer", "verification", "rotationOrRevocation"], `${context}.signing`);
  invariant(
    signing.status === "pending" && signing.proof === null && signing.issuer === null &&
      signing.verification === null && signing.rotationOrRevocation === null,
    `${context}.signing: signing may only remain pending with null local proof and verification facts`,
  );
  for (const key of externalEvidenceKeys.filter((name) => name !== "signing")) {
    const state = exactRecord(evidence[key], ["status", "proof"], `${context}.${key}`);
    invariant(state.status === "pending" && state.proof === null, `${context}.${key}: external evidence may only remain pending/null`);
  }
  return pendingExternalEvidence();
}

/** Create the only valid current-state release foundation result. */
export function createReleaseFoundationReport(request) {
  const validated = validateReleaseRequest(request);
  invariant(validated.state === "unissued", "release foundation: current request must be deliberately unissued");
  return {
    schemaVersion: 1,
    state: "unissued",
    eligible: false,
    closesGate: false,
    canonicalManifest: null,
    externalEvidence: pendingExternalEvidence(),
  };
}

export function collectReleaseFoundation(repositoryRoot = releaseRepositoryRoot) {
  return createReleaseFoundationReport(readReleaseRequest(repositoryRoot));
}

export function validateReleaseFoundationReport(value) {
  strictPlainData(value, "release foundation result");
  const report = exactRecord(value, ["schemaVersion", "state", "eligible", "closesGate", "canonicalManifest", "externalEvidence"], "release foundation result");
  invariant(report.schemaVersion === 1 && report.state === "unissued", "release foundation result: invalid state");
  invariant(report.eligible === false && report.closesGate === false && report.canonicalManifest === null, "release foundation result: issuance, eligibility, and Gate closure are forbidden");
  validatePendingExternalEvidence(report.externalEvidence, "release foundation result.externalEvidence");
  return true;
}

function runGit(repositoryRoot, args, context) {
  const execution = spawnSync("git", ["-C", repositoryRoot, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (execution.error) {
    throw new ReleaseIdentityPolicyError(`${context}: git execution failed (${execution.error.message})`);
  }
  if (execution.status !== 0) {
    const detail = `${execution.stderr ?? ""}`.trim() || `${execution.stdout ?? ""}`.trim() || `exit ${execution.status}`;
    throw new ReleaseIdentityPolicyError(`${context}: ${detail}`);
  }
  return `${execution.stdout ?? ""}`;
}

function gitTrackedPaths(repositoryRoot) {
  return new Set(runGit(repositoryRoot, ["ls-files", "-z"], "release source tracking").split("\0").filter(Boolean));
}

function collectGitStatus(repositoryRoot) {
  const rows = runGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"], "release source status")
    .split(/\r?\n/u)
    .filter(Boolean);
  const tracked = [];
  const untracked = [];
  for (const row of rows) {
    if (row.startsWith("?? ")) untracked.push(row.slice(3));
    else tracked.push(row.slice(3));
  }
  return { tracked: tracked.sort(byteOrder), untracked: untracked.sort(byteOrder) };
}

function trackedRegularFile(repositoryRoot, trackedPaths, relativePath, context) {
  const normalized = normalizeProductionRelativePath(relativePath, context);
  invariant(trackedPaths.has(normalized), `${context}: required production input is not tracked by Git`);
  return readRegularFile(repositoryRoot, normalized, context);
}

function trackedDigest(repositoryRoot, trackedPaths, relativePath, context) {
  const file = trackedRegularFile(repositoryRoot, trackedPaths, relativePath, context);
  return { path: file.normalized, bytes: file.bytes.length, sha256: sha256(file.bytes) };
}

function readTrackedJson(repositoryRoot, trackedPaths, relativePath, context) {
  return parseReleaseJson(trackedRegularFile(repositoryRoot, trackedPaths, relativePath, context).bytes.toString("utf8"), context);
}

function readStringJsonField(value, field, context) {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${context}: expected object`);
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  invariant(descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string", `${context}.${field}: expected string`);
  return descriptor.value;
}

function tomlSectionString(source, section, key, context) {
  const sections = [...source.matchAll(/^\s*\[([^\]]+)\]\s*$/gmu)];
  const index = sections.findIndex((match) => match[1] === section);
  invariant(index >= 0, `${context}: missing [${section}]`);
  const start = sections[index].index + sections[index][0].length;
  const end = sections[index + 1]?.index ?? source.length;
  const body = source.slice(start, end);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const keyPattern = new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"\\r\\n]+)"\\s*(?:#.*)?$`, "gmu");
  const matches = [...body.matchAll(keyPattern)];
  invariant(matches.length === 1, `${context}: expected exactly one ${key} value`);
  return matches[0][1];
}

function runtimeAppVersion(repositoryRoot, trackedPaths) {
  const runtimePath = "apps/desktop/src/release-identity.json";
  const identity = readTrackedJson(repositoryRoot, trackedPaths, runtimePath, "production runtime release identity");
  const record = exactRecord(identity, ["schemaVersion", "appVersion"], "production runtime release identity");
  invariant(record.schemaVersion === 1 && typeof record.appVersion === "string", "production runtime release identity: invalid schema");
  const entrypoint = trackedRegularFile(repositoryRoot, trackedPaths, "apps/desktop/src/main.tsx", "production runtime entrypoint").bytes.toString("utf8");
  invariant(/from\s+["']\.\/release-identity\.json["']/u.test(entrypoint), "production runtime entrypoint: release identity must be statically imported from the production source graph");
  return record.appVersion;
}

function collectReleaseSurfaceObservations(repositoryRoot, trackedPaths) {
  const rootPackage = readTrackedJson(repositoryRoot, trackedPaths, "package.json", "root package manifest");
  const desktopPackage = readTrackedJson(repositoryRoot, trackedPaths, "apps/desktop/package.json", "desktop package manifest");
  const cargoSource = trackedRegularFile(repositoryRoot, trackedPaths, "Cargo.toml", "Cargo workspace manifest").bytes.toString("utf8");
  const tauri = readTrackedJson(repositoryRoot, trackedPaths, "apps/desktop/src-tauri/tauri.conf.json", "Tauri configuration");
  return {
    rootPackageVersion: readStringJsonField(rootPackage, "version", "root package manifest"),
    desktopPackageVersion: readStringJsonField(desktopPackage, "version", "desktop package manifest"),
    cargoWorkspaceVersion: tomlSectionString(cargoSource, "workspace.package", "version", "Cargo workspace manifest"),
    tauriVersion: readStringJsonField(tauri, "version", "Tauri configuration"),
    runtimeAppVersion: runtimeAppVersion(repositoryRoot, trackedPaths),
  };
}

function assertRemovedConnectorRootsAbsent(repositoryRoot, trackedPaths) {
  for (const path of removedConnectorRoots) {
    invariant(
      ![...trackedPaths].some((trackedPath) => trackedPath === path || trackedPath.startsWith(`${path}/`)),
      `release source: removed connector root is tracked: ${path}`,
    );
    try {
      lstatSync(resolve(repositoryRoot, path));
      invariant(false, `release source: removed connector root is present: ${path}`);
    } catch (error) {
      if (error instanceof ReleaseIdentityPolicyError) throw error;
      invariant(error?.code === "ENOENT", `release source: removed connector root is unreadable: ${path}`);
    }
  }
}

function collectToolchainObservations(repositoryRoot, trackedPaths) {
  const rootPackage = readTrackedJson(repositoryRoot, trackedPaths, "package.json", "root package manifest");
  const engines = Object.getOwnPropertyDescriptor(rootPackage, "engines")?.value;
  invariant(engines !== null && typeof engines === "object" && !Array.isArray(engines), "root package manifest.engines: expected object");
  const declaredNode = readStringJsonField(engines, "node", "root package manifest.engines");
  const declaredPnpm = readStringJsonField(engines, "pnpm", "root package manifest.engines");
  const packageManager = readStringJsonField(rootPackage, "packageManager", "root package manifest");
  const packageManagerMatch = /^pnpm@([0-9]+(?:\.[0-9]+){2})$/u.exec(packageManager);
  invariant(packageManagerMatch !== null, "root package manifest.packageManager: expected exact pnpm version");
  invariant(declaredNode === process.versions.node, "root package manifest.engines.node: Node runtime differs from the declared release toolchain");
  invariant(declaredPnpm === packageManagerMatch[1], "root package manifest: pnpm engine and packageManager must agree");

  const rustToolchain = trackedRegularFile(repositoryRoot, trackedPaths, "rust-toolchain.toml", "Rust toolchain declaration").bytes.toString("utf8");
  const cargo = trackedRegularFile(repositoryRoot, trackedPaths, "Cargo.toml", "Cargo workspace manifest").bytes.toString("utf8");
  return {
    node: process.versions.node,
    pnpm: declaredPnpm,
    rust: tomlSectionString(rustToolchain, "toolchain", "channel", "Rust toolchain declaration"),
    cargoRust: tomlSectionString(cargo, "workspace.package", "rust-version", "Cargo workspace manifest"),
  };
}

function collectSourceSnapshot(repositoryRoot) {
  const trackedPaths = gitTrackedPaths(repositoryRoot);
  assertRemovedConnectorRootsAbsent(repositoryRoot, trackedPaths);
  const status = collectGitStatus(repositoryRoot);
  const inputs = {
    pnpmLock: trackedDigest(repositoryRoot, trackedPaths, "pnpm-lock.yaml", "pnpm lockfile"),
    cargoLock: trackedDigest(repositoryRoot, trackedPaths, "Cargo.lock", "Cargo lockfile"),
    rustToolchain: trackedDigest(repositoryRoot, trackedPaths, "rust-toolchain.toml", "Rust toolchain declaration"),
    releaseRequest: trackedDigest(repositoryRoot, trackedPaths, releaseRequestPath, "release request"),
  };
  const commit = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"], "release source commit").trim();
  const tree = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"], "release source tree").trim();
  invariant(gitObjectPattern.test(commit) && gitObjectPattern.test(tree), "release source: invalid Git object identity");
  return {
    commit,
    tree,
    clean: status.tracked.length === 0 && status.untracked.length === 0,
    dirty: status,
    inputs,
    toolchain: collectToolchainObservations(repositoryRoot, trackedPaths),
    releaseSurfaces: collectReleaseSurfaceObservations(repositoryRoot, trackedPaths),
  };
}

function assertCleanSnapshot(snapshot, context) {
  invariant(snapshot.clean === true, `${context}: dirty tracked or untracked source is forbidden (${JSON.stringify(snapshot.dirty)})`);
}

function assertReleaseSurfacesMatchRequest(surfaces, request, context) {
  for (const [name, observed] of Object.entries({
    rootPackageVersion: surfaces.rootPackageVersion,
    desktopPackageVersion: surfaces.desktopPackageVersion,
    cargoWorkspaceVersion: surfaces.cargoWorkspaceVersion,
    tauriVersion: surfaces.tauriVersion,
    runtimeAppVersion: surfaces.runtimeAppVersion,
  })) {
    validateSemVer(observed, `${context}.${name}`);
    invariant(observed === request.version, `${context}.${name}: release-bearing version skew`);
  }
}

function assertOnDiskRequestMatches(repositoryRoot, expected, context) {
  const observed = readReleaseRequest(repositoryRoot);
  invariant(canonicalReleaseJson(observed) === canonicalReleaseJson(expected), `${context}: selected release request drifted`);
}

function assertStableSnapshots(before, after) {
  assertCleanSnapshot(before, "release preparation");
  assertCleanSnapshot(after, "release finalization");
  invariant(
    canonicalReleaseJson(before) === canonicalReleaseJson(after),
    "release source or inputs drifted between preparation and finalization",
  );
}

function artifactInventory(repositoryRoot, request) {
  const artifactRoot = resolveProductionPath(repositoryRoot, request.artifactRoot, "release artifact root");
  assertNoSymlinkSegments(repositoryRoot, artifactRoot.normalized, "release artifact root");
  invariant(existsSync(artifactRoot.absolute), "release artifact root: required directory is absent");
  const rootStat = lstatSync(artifactRoot.absolute);
  invariant(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "release artifact root: must be a real directory");

  const actualPaths = [];
  function visit(directory, localDirectory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      const local = localDirectory === "" ? entry.name : `${localDirectory}/${entry.name}`;
      const stat = lstatSync(absolute);
      invariant(!stat.isSymbolicLink(), `release artifact ${local}: symbolic links are forbidden`);
      if (stat.isDirectory()) {
        visit(absolute, local);
      } else {
        invariant(stat.isFile(), `release artifact ${local}: only regular files are allowed`);
        actualPaths.push(local);
      }
    }
  }
  visit(artifactRoot.absolute, "");

  const declaredPaths = request.artifacts.map((artifact) => artifact.path).sort(byteOrder);
  const observedPaths = actualPaths.sort(byteOrder);
  invariant(
    JSON.stringify(observedPaths) === JSON.stringify(declaredPaths),
    `release artifact inventory must exactly equal the declared target set (declared=${JSON.stringify(declaredPaths)}, observed=${JSON.stringify(observedPaths)})`,
  );

  return declaredPaths.map((path) => {
    const absolute = resolve(artifactRoot.absolute, path);
    const before = lstatSync(absolute);
    invariant(before.isFile() && !before.isSymbolicLink(), `release artifact ${path}: declared artifact must be a regular file`);
    const bytes = readFileSync(absolute);
    const after = lstatSync(absolute);
    invariant(
      before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
        before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      `release artifact ${path}: changed while it was hashed`,
    );
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function validateDigest(value, expectedPath, context) {
  const digest = exactRecord(value, ["path", "bytes", "sha256"], context);
  invariant(digest.path === expectedPath, `${context}.path: unexpected source input path`);
  invariant(Number.isSafeInteger(digest.bytes) && digest.bytes > 0, `${context}.bytes: expected positive byte count`);
  invariant(typeof digest.sha256 === "string" && sha256Pattern.test(digest.sha256), `${context}.sha256: invalid digest`);
  return { path: digest.path, bytes: digest.bytes, sha256: digest.sha256 };
}

function validateSourceInputs(value, context) {
  const inputs = exactRecord(value, ["pnpmLock", "cargoLock", "rustToolchain", "releaseRequest"], context);
  return {
    pnpmLock: validateDigest(inputs.pnpmLock, "pnpm-lock.yaml", `${context}.pnpmLock`),
    cargoLock: validateDigest(inputs.cargoLock, "Cargo.lock", `${context}.cargoLock`),
    rustToolchain: validateDigest(inputs.rustToolchain, "rust-toolchain.toml", `${context}.rustToolchain`),
    releaseRequest: validateDigest(inputs.releaseRequest, releaseRequestPath, `${context}.releaseRequest`),
  };
}

function validateToolchain(value, context) {
  const toolchain = exactRecord(value, ["node", "pnpm", "rust", "cargoRust"], context);
  for (const key of ["node", "pnpm", "rust", "cargoRust"]) {
    invariant(typeof toolchain[key] === "string" && semVerPattern.test(toolchain[key]), `${context}.${key}: expected pinned semantic version`);
  }
  return { node: toolchain.node, pnpm: toolchain.pnpm, rust: toolchain.rust, cargoRust: toolchain.cargoRust };
}

function validateReleaseSurfaces(value, version, context) {
  const surfaces = exactRecord(value, ["rootPackageVersion", "desktopPackageVersion", "cargoWorkspaceVersion", "tauriVersion", "runtimeAppVersion"], context);
  for (const key of ["rootPackageVersion", "desktopPackageVersion", "cargoWorkspaceVersion", "tauriVersion", "runtimeAppVersion"]) {
    invariant(validateSemVer(surfaces[key], `${context}.${key}`) === version, `${context}.${key}: canonical manifest version skew`);
  }
  return {
    rootPackageVersion: surfaces.rootPackageVersion,
    desktopPackageVersion: surfaces.desktopPackageVersion,
    cargoWorkspaceVersion: surfaces.cargoWorkspaceVersion,
    tauriVersion: surfaces.tauriVersion,
    runtimeAppVersion: surfaces.runtimeAppVersion,
  };
}

function validateManifestArtifacts(value, context) {
  const entries = exactArray(value, context);
  invariant(entries.length >= 1 && entries.length <= 64, `${context}: invalid artifact count`);
  const paths = new Set();
  return entries.map((entry, index) => {
    const artifact = exactRecord(entry, ["path", "bytes", "sha256"], `${context}[${index}]`);
    const path = normalizeProductionRelativePath(artifact.path, `${context}[${index}].path`);
    invariant(!paths.has(path), `${context}[${index}].path: duplicate artifact`);
    paths.add(path);
    invariant(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, `${context}[${index}].bytes: invalid artifact size`);
    invariant(typeof artifact.sha256 === "string" && sha256Pattern.test(artifact.sha256), `${context}[${index}].sha256: invalid artifact digest`);
    return { path, bytes: artifact.bytes, sha256: artifact.sha256 };
  }).sort((left, right) => byteOrder(left.path, right.path));
}

/** Validate a canonical release manifest received from unknown data. */
export function validateCanonicalReleaseManifest(value) {
  strictPlainData(value, "canonical release manifest");
  const manifest = exactRecord(value, ["schemaVersion", "kind", "identity", "source", "target", "releaseSurfaces", "artifacts", "externalEvidence", "eligible", "closesGate"], "canonical release manifest");
  invariant(manifest.schemaVersion === 1 && manifest.kind === "gooddealer.canonical-release-identity", "canonical release manifest: unsupported identity schema");
  invariant(manifest.eligible === false && manifest.closesGate === false, "canonical release manifest: eligibility and Gate closure are forbidden without external evidence");

  const identity = exactRecord(manifest.identity, ["version", "channel", "productApproval"], "canonical release manifest.identity");
  const version = validateSemVer(identity.version, "canonical release manifest.identity.version");
  const channel = validateChannel(identity.channel, "canonical release manifest.identity.channel");
  const productApproval = validateApproval(identity.productApproval, "canonical release manifest.identity.productApproval");

  const source = exactRecord(manifest.source, ["commit", "tree", "inputs", "toolchain"], "canonical release manifest.source");
  invariant(typeof source.commit === "string" && gitObjectPattern.test(source.commit), "canonical release manifest.source.commit: invalid Git commit");
  invariant(typeof source.tree === "string" && gitObjectPattern.test(source.tree), "canonical release manifest.source.tree: invalid Git tree");
  const target = validateTarget(manifest.target, "canonical release manifest.target");
  const releaseSurfaces = validateReleaseSurfaces(manifest.releaseSurfaces, version, "canonical release manifest.releaseSurfaces");
  const artifacts = validateManifestArtifacts(manifest.artifacts, "canonical release manifest.artifacts");
  const externalEvidence = validatePendingExternalEvidence(manifest.externalEvidence, "canonical release manifest.externalEvidence");

  return {
    schemaVersion: 1,
    kind: "gooddealer.canonical-release-identity",
    identity: { version, channel, productApproval },
    source: {
      commit: source.commit,
      tree: source.tree,
      inputs: validateSourceInputs(source.inputs, "canonical release manifest.source.inputs"),
      toolchain: validateToolchain(source.toolchain, "canonical release manifest.source.toolchain"),
    },
    target,
    releaseSurfaces,
    artifacts,
    externalEvidence,
    eligible: false,
    closesGate: false,
  };
}

function releaseCheckpoints(value) {
  if (value === undefined) return { afterPreparation: null, afterArtifactDigest: null };
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), "release checkpoints: expected object");
  const hooks = exactRecord(value, ["afterPreparation", "afterArtifactDigest"], "release checkpoints");
  for (const key of ["afterPreparation", "afterArtifactDigest"]) {
    invariant(hooks[key] === null || typeof hooks[key] === "function", `release checkpoints.${key}: expected function or null`);
  }
  return hooks;
}

/**
 * Verify a future approved request without running a build. Checkpoints exist
 * only for policy-test mutation controls; the CLI never supplies callbacks.
 */
export function collectFutureReleaseIdentity({
  repositoryRoot = releaseRepositoryRoot,
  checkpoints,
} = {}) {
  const request = readReleaseRequest(repositoryRoot);
  invariant(request.state === "approved", "release issue: a later product-owner approved request is required before any build boundary");
  const hooks = releaseCheckpoints(checkpoints);

  const before = collectSourceSnapshot(repositoryRoot);
  assertCleanSnapshot(before, "release preparation");
  assertOnDiskRequestMatches(repositoryRoot, request, "release preparation");
  assertReleaseSurfacesMatchRequest(before.releaseSurfaces, request, "release preparation.releaseSurfaces");

  if (hooks.afterPreparation !== null) hooks.afterPreparation();

  const after = collectSourceSnapshot(repositoryRoot);
  assertStableSnapshots(before, after);
  assertOnDiskRequestMatches(repositoryRoot, request, "release finalization");
  assertReleaseSurfacesMatchRequest(after.releaseSurfaces, request, "release finalization.releaseSurfaces");

  const firstArtifacts = artifactInventory(repositoryRoot, request);
  if (hooks.afterArtifactDigest !== null) hooks.afterArtifactDigest();
  const finalArtifacts = artifactInventory(repositoryRoot, request);
  invariant(canonicalReleaseJson(firstArtifacts) === canonicalReleaseJson(finalArtifacts), "release artifacts changed after digest collection");

  const manifest = {
    schemaVersion: 1,
    kind: "gooddealer.canonical-release-identity",
    identity: {
      version: request.version,
      channel: request.channel,
      productApproval: request.productApproval,
    },
    source: {
      commit: after.commit,
      tree: after.tree,
      inputs: after.inputs,
      toolchain: after.toolchain,
    },
    target: request.target,
    releaseSurfaces: after.releaseSurfaces,
    artifacts: finalArtifacts,
    externalEvidence: pendingExternalEvidence(),
    eligible: false,
    closesGate: false,
  };
  return validateCanonicalReleaseManifest(manifest);
}

function validateManifestOutputPath(path) {
  const normalized = normalizeProductionRelativePath(path, "canonical manifest output path");
  invariant(normalized.startsWith(`${releaseManifestDirectory}/`) && normalized.endsWith(".json"), `canonical manifest output path: must be a JSON file under ${releaseManifestDirectory}/`);
  return normalized;
}

/** Write one canonical manifest after all validation has succeeded. */
export function writeCanonicalReleaseManifest(repositoryRoot, manifestRelativePath, manifest) {
  const normalized = validateManifestOutputPath(manifestRelativePath);
  const canonical = validateCanonicalReleaseManifest(manifest);
  const output = resolveProductionPath(repositoryRoot, normalized, "canonical manifest output path");
  const parentRelative = normalized.split("/").slice(0, -1).join("/");
  assertNoSymlinkSegments(repositoryRoot, parentRelative, "canonical manifest output directory");
  mkdirSync(dirname(output.absolute), { recursive: true, mode: 0o700 });
  assertNoSymlinkSegments(repositoryRoot, parentRelative, "canonical manifest output directory");
  invariant(!existsSync(output.absolute), "canonical manifest output path: refusing to overwrite an existing identity");
  writeFileSync(output.absolute, `${canonicalReleaseJson(canonical)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { path: normalized, manifest: canonical };
}

/** Future-only issue path: it validates and writes no manifest until every check above passes. */
export function issueFutureReleaseIdentity({ repositoryRoot = releaseRepositoryRoot, manifestRelativePath } = {}) {
  invariant(typeof manifestRelativePath === "string", "release issue: a canonical manifest output path is required");
  const manifest = collectFutureReleaseIdentity({ repositoryRoot });
  return writeCanonicalReleaseManifest(repositoryRoot, manifestRelativePath, manifest);
}

/** Re-observe the repository; reject forged or stale canonical manifest fields. */
export function verifyCanonicalReleaseManifest(repositoryRoot, candidate) {
  const manifest = validateCanonicalReleaseManifest(candidate);
  const request = readReleaseRequest(repositoryRoot);
  invariant(request.state === "approved", "canonical manifest verification: repository request is not approved");
  invariant(
    canonicalReleaseJson(manifest.identity) === canonicalReleaseJson({
      version: request.version,
      channel: request.channel,
      productApproval: request.productApproval,
    }),
    "canonical manifest verification: selected request identity mismatch",
  );
  invariant(canonicalReleaseJson(manifest.target) === canonicalReleaseJson(request.target), "canonical manifest verification: selected target mismatch");

  const snapshot = collectSourceSnapshot(repositoryRoot);
  assertCleanSnapshot(snapshot, "canonical manifest verification");
  assertOnDiskRequestMatches(repositoryRoot, request, "canonical manifest verification");
  assertReleaseSurfacesMatchRequest(snapshot.releaseSurfaces, request, "canonical manifest verification.releaseSurfaces");
  invariant(
    canonicalReleaseJson(manifest.source) === canonicalReleaseJson({
      commit: snapshot.commit,
      tree: snapshot.tree,
      inputs: snapshot.inputs,
      toolchain: snapshot.toolchain,
    }),
    "canonical manifest verification: source, lock, or toolchain drift",
  );
  const artifacts = artifactInventory(repositoryRoot, request);
  invariant(canonicalReleaseJson(manifest.artifacts) === canonicalReleaseJson(artifacts), "canonical manifest verification: artifact substitution or post-hash mutation");
  return true;
}
