import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  ReleaseIdentityPolicyError,
  canonicalReleaseJson,
  collectFutureReleaseIdentity,
  createReleaseFoundationReport,
  issueFutureReleaseIdentity,
  parseReleaseRequestJson,
  releaseProductionCatalog,
  validateCanonicalReleaseManifest,
  validateReleaseFoundationReport,
  validateReleaseRequest,
  verifyCanonicalReleaseManifest,
  writeCanonicalReleaseManifest,
} from "../release/release-identity-policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const collectorPath = resolve(repositoryRoot, "scripts/collect-release-identity.mjs");
const fixtureVersion = "8.7.6";
const fixtureChannel = "validation";
const artifactRoot = ".artifacts/release-artifacts";
const retainedSourceInputKeys = Object.freeze(["pnpmLock", "cargoLock", "rustToolchain", "releaseRequest"]);
const retiredGeneratedRegistryInput = ["generated", "Registry", "Paths"].join("");

function writeText(root, path, source) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source, "utf8");
}

function writeJson(root, path, value) {
  writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stderr}`);
}

function commitAll(root, message = "release identity input update") {
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", message]);
}

function futureRequest({
  version = fixtureVersion,
  channel = fixtureChannel,
  artifactEntries = [{ path: "bundle/application.bin", content: "primary-artifact" }],
  artifactDirectory = artifactRoot,
} = {}) {
  return {
    schemaVersion: 1,
    state: "approved",
    version,
    channel,
    productApproval: {
      kind: "product-owner-decision",
      decisionRef: "release-decision-validation",
    },
    target: { platform: "validation-platform", architecture: "validation-architecture" },
    artifactRoot: artifactDirectory,
    artifacts: artifactEntries.map(({ path }) => ({ path })),
  };
}

function createApprovedRepository(options = {}) {
  const root = join(tmpdir(), `gooddealer-release-identity-${process.pid}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  const version = options.version ?? fixtureVersion;
  const surfaceVersions = { root: version, desktop: version, cargo: version, tauri: version, runtime: version, ...options.surfaceVersions };
  const artifacts = options.artifactEntries ?? [{ path: "bundle/application.bin", content: "primary-artifact" }];
  const request = options.request ?? futureRequest({
    version,
    channel: options.channel ?? fixtureChannel,
    artifactEntries: artifacts,
    artifactDirectory: options.artifactDirectory ?? artifactRoot,
  });
  writeJson(root, "package.json", {
    name: "gooddealer",
    private: true,
    version: surfaceVersions.root,
    packageManager: "pnpm@1.2.3",
    engines: { node: process.versions.node, pnpm: "1.2.3" },
  });
  writeJson(root, "apps/desktop/package.json", { name: "@gooddealer/desktop", private: true, version: surfaceVersions.desktop });
  writeText(root, "Cargo.toml", `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${surfaceVersions.cargo}"\nrust-version = "1.2.3"\n`);
  writeText(root, "rust-toolchain.toml", "[toolchain]\nchannel = \"1.2.3\"\n");
  writeJson(root, "apps/desktop/src-tauri/tauri.conf.json", { productName: "GoodDealer", version: surfaceVersions.tauri });
  writeJson(root, releaseProductionCatalog.runtimeIdentityPath, { schemaVersion: 1, appVersion: surfaceVersions.runtime });
  writeText(root, releaseProductionCatalog.runtimeEntrypointPath, 'import releaseIdentity from "./release-identity.json";\nexport const appVersion = releaseIdentity.appVersion;\n');
  writeText(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  writeText(root, "Cargo.lock", "version = 4\n");
  writeText(root, ".gitignore", ".artifacts/\n");
  writeJson(root, "release/release-request.json", request);
  for (const artifact of artifacts) {
    writeText(root, `${request.artifactRoot}/${artifact.path}`, artifact.content ?? artifact.path);
  }

  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "release-policy@example.invalid"]);
  git(root, ["config", "user.name", "Release identity policy"]);
  commitAll(root, "initial release identity fixture");
  return { root, request, artifacts };
}

function useApprovedRepository(t, options) {
  const created = createApprovedRepository(options);
  t.after(() => rmSync(created.root, { recursive: true, force: true }));
  return created;
}

function rejects(callback, message) {
  assert.throws(callback, (error) => error instanceof ReleaseIdentityPolicyError, message);
}

function updateJsonAndCommit(root, path, mutate, message) {
  const value = readJson(root, path);
  mutate(value);
  writeJson(root, path, value);
  commitAll(root, message);
}

test("current foundation accepts only the deliberate unissued request and creates no manifest", () => {
  const currentRequest = readJson(repositoryRoot, "release/release-request.json");
  assert.deepEqual(Object.keys(currentRequest).sort(), ["schemaVersion", "state"]);
  assert.deepEqual(currentRequest, { schemaVersion: 1, state: "unissued" });

  const foundation = spawnSync(process.execPath, [collectorPath, "--foundation"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(foundation.status, 0, foundation.stderr);
  const report = JSON.parse(foundation.stdout);
  assert.equal(validateReleaseFoundationReport(report), true);
  assert.equal(report.state, "unissued");
  assert.equal(report.eligible, false);
  assert.equal(report.closesGate, false);
  assert.equal(report.canonicalManifest, null);
  for (const field of ["version", "channel", "productApproval"]) {
    assert.equal(Object.hasOwn(report, field), false, `foundation output unexpectedly exposes ${field}`);
  }
  for (const [name, value] of Object.entries(report.externalEvidence)) {
    assert.equal(value.status, "pending", name);
    assert.equal(value.proof, null, name);
  }
  assert.equal(report.externalEvidence.signing.issuer, null);
  assert.equal(report.externalEvidence.signing.verification, null);
  assert.equal(report.externalEvidence.signing.rotationOrRevocation, null);

  const output = `.artifacts/release/unissued-${process.pid}-${Date.now()}.json`;
  const issue = spawnSync(process.execPath, [collectorPath, "--issue", "--manifest", output], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.notEqual(issue.status, 0, "current unissued request must refuse issue mode");
  assert.equal(existsSync(join(repositoryRoot, output)), false, "issue refusal wrote a manifest");
});

test("foundation reports remain unissued, ineligible, and externally unqualified after promotion mutations", () => {
  const report = createReleaseFoundationReport({ schemaVersion: 1, state: "unissued" });
  assert.deepEqual(Object.keys(report).sort(), ["canonicalManifest", "closesGate", "eligible", "externalEvidence", "schemaVersion", "state"]);
  assert.equal(report.state, "unissued");
  assert.equal(report.eligible, false);
  assert.equal(report.closesGate, false);
  assert.equal(report.canonicalManifest, null);
  assert.equal(validateReleaseFoundationReport(report), true);

  for (const mutate of [
    (candidate) => { candidate.state = "approved"; },
    (candidate) => { candidate.eligible = true; },
    (candidate) => { candidate.closesGate = true; },
    (candidate) => { candidate.externalEvidence.signing.status = "satisfied"; },
    (candidate) => { candidate.externalEvidence.providerQualification.proof = "local-connector-observation"; },
    (candidate) => { candidate.externalEvidence.gateClosure.status = "closed"; },
  ]) {
    const candidate = structuredClone(report);
    mutate(candidate);
    rejects(() => validateReleaseFoundationReport(candidate), "foundation promotion mutation");
  }
});

test("unissued parsing rejects aliases, null coercion, duplicate keys, custom prototypes, and accessors", () => {
  for (const candidate of [
    { schemaVersion: 1, state: "unissued", version: fixtureVersion },
    { schemaVersion: 1, state: "unissued", channel: fixtureChannel },
    { schemaVersion: 1, state: "unissued", productApproval: null },
    { schemaVersion: 1, state: "unissued", releaseVersion: fixtureVersion },
    { schemaVersion: 1, state: "unissued", eligible: false },
    { schemaVersion: "1", state: "unissued" },
    { schemaVersion: 1, state: "UNISSUED" },
  ]) {
    rejects(() => validateReleaseRequest(candidate), `unissued forgery ${JSON.stringify(candidate)}`);
  }
  rejects(
    () => parseReleaseRequestJson('{"schemaVersion":1,"state":"unissued","state":"approved"}'),
    "duplicate state key",
  );
  const inherited = Object.create({ state: "unissued" });
  inherited.schemaVersion = 1;
  rejects(() => validateReleaseRequest(inherited), "inherited state");

  let getterCalls = 0;
  const accessor = { schemaVersion: 1 };
  Object.defineProperty(accessor, "state", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return "unissued";
    },
  });
  rejects(() => validateReleaseRequest(accessor), "accessor state");
  assert.equal(getterCalls, 0, "request accessor was invoked");
});

test("issue validation rejects before any build boundary or manifest write when approval is missing or malformed", (t) => {
  const { root } = useApprovedRepository(t);
  writeJson(root, "release/release-request.json", { schemaVersion: 1, state: "unissued" });
  let preparationCalls = 0;
  let digestCalls = 0;
  rejects(
    () => collectFutureReleaseIdentity({
      repositoryRoot: root,
      checkpoints: {
        afterPreparation() { preparationCalls += 1; },
        afterArtifactDigest() { digestCalls += 1; },
      },
    }),
    "unissued issue path",
  );
  assert.equal(preparationCalls, 0);
  assert.equal(digestCalls, 0);
  assert.equal(existsSync(join(root, ".artifacts/release/never.json")), false);

  const missingApproval = futureRequest();
  delete missingApproval.productApproval;
  writeJson(root, "release/release-request.json", missingApproval);
  rejects(
    () => collectFutureReleaseIdentity({
      repositoryRoot: root,
      checkpoints: {
        afterPreparation() { preparationCalls += 1; },
        afterArtifactDigest() { digestCalls += 1; },
      },
    }),
    "approved-looking request without product approval",
  );
  assert.equal(preparationCalls, 0, "missing approval reached a build boundary");
  assert.equal(digestCalls, 0, "missing approval reached an artifact boundary");

  for (const request of [
    { schemaVersion: 1, state: "approved", channel: fixtureChannel },
    { ...futureRequest(), version: "0.0.0" },
    { ...futureRequest(), version: "not-a-semver" },
    { ...futureRequest(), channel: "Not-A-Channel" },
    { ...futureRequest(), productApproval: null },
    { ...futureRequest(), productApproval: { kind: "product-owner-decision", decisionRef: "contains/a/path" } },
  ]) {
    rejects(() => validateReleaseRequest(request), `invalid approved request ${JSON.stringify(request)}`);
  }
  rejects(
    () => issueFutureReleaseIdentity({ repositoryRoot: root, manifestRelativePath: ".artifacts/release/never.json" }),
    "unissued issue call must not write",
  );
  assert.equal(existsSync(join(root, ".artifacts/release/never.json")), false);
});

test("a clean future-approved repository produces one canonical identity with all external facts pending", (t) => {
  const { root, request } = useApprovedRepository(t);
  const manifest = collectFutureReleaseIdentity({ repositoryRoot: root });
  assert.equal(validateCanonicalReleaseManifest(manifest).kind, "gooddealer.canonical-release-identity");
  assert.equal(verifyCanonicalReleaseManifest(root, manifest), true);
  assert.equal(manifest.identity.version, request.version);
  assert.equal(manifest.identity.channel, request.channel);
  assert.equal(manifest.eligible, false);
  assert.equal(manifest.closesGate, false);
  for (const [name, value] of Object.entries(manifest.externalEvidence)) {
    assert.equal(value.status, "pending", name);
    assert.equal(value.proof, null, name);
  }
  assert.equal(manifest.externalEvidence.signing.issuer, null);
  assert.equal(manifest.externalEvidence.signing.verification, null);
  assert.equal(manifest.externalEvidence.signing.rotationOrRevocation, null);

  const firstWrite = writeCanonicalReleaseManifest(root, ".artifacts/release/identity.json", manifest);
  assert.equal(firstWrite.path, ".artifacts/release/identity.json");
  assert.equal(existsSync(join(root, firstWrite.path)), true);
  assert.equal(verifyCanonicalReleaseManifest(root, manifest), true, "ignored manifest output must not make source dirty");
  rejects(
    () => writeCanonicalReleaseManifest(root, ".artifacts/release/identity.json", manifest),
    "canonical identity must never overwrite a prior identity",
  );
});

test("source input schema and runtime validation accept exactly four retained digests and reject legacy or substituted members", (t) => {
  const schema = readJson(repositoryRoot, "release/release-manifest.schema.json");
  const schemaInputs = schema.$defs.inputDigests;
  const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(schemaInputs.additionalProperties, false);
  assert.deepEqual(schemaInputs.required, retainedSourceInputKeys);
  assert.deepEqual(Object.keys(schemaInputs.properties).sort(), [...retainedSourceInputKeys].sort());
  for (const [field, path] of Object.entries({
    pnpmLock: "pnpm-lock.yaml",
    cargoLock: "Cargo.lock",
    rustToolchain: "rust-toolchain.toml",
    releaseRequest: "release/release-request.json",
  })) {
    assert.equal(
      schemaInputs.properties[field].allOf?.[1]?.properties?.path?.const,
      path,
      `schema must preserve the runtime's exact path for ${field}`,
    );
  }

  const { root } = useApprovedRepository(t);
  const manifest = collectFutureReleaseIdentity({ repositoryRoot: root });
  assert.deepEqual(Object.keys(manifest.source.inputs).sort(), [...retainedSourceInputKeys].sort());
  assert.equal(validateSchema(manifest), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(
    validateCanonicalReleaseManifest(manifest).source.inputs,
    manifest.source.inputs,
    "the valid four-key source input record is accepted without normalization",
  );

  const legacyDigest = {
    path: "legacy/retired-registry-digest.json",
    bytes: 1,
    sha256: "0".repeat(64),
  };
  for (const [name, field, value] of [
    ["empty legacy member", "generated", []],
    ["legacy member with a digest", "generated", [legacyDigest]],
    ["legacy registry-path member", retiredGeneratedRegistryInput, []],
    ["connector-derived extra member", "connectorDescriptor", legacyDigest],
    ["Core-derived extra member", "coreDerivedInput", legacyDigest],
    ["unknown extra member", "unexpected", legacyDigest],
  ]) {
    const candidate = structuredClone(manifest);
    candidate.source.inputs[field] = value;
    assert.equal(validateSchema(candidate), false, `${name}: JSON schema accepted an invalid source input`);
    rejects(() => validateCanonicalReleaseManifest(candidate), name);
  }

  for (const field of retainedSourceInputKeys) {
    const candidate = structuredClone(manifest);
    delete candidate.source.inputs[field];
    assert.equal(validateSchema(candidate), false, `${field}: JSON schema accepted a missing source input`);
    rejects(() => validateCanonicalReleaseManifest(candidate), `missing retained source input ${field}`);
  }

  const substituted = structuredClone(manifest);
  substituted.source.inputs.pnpmLockfile = substituted.source.inputs.pnpmLock;
  delete substituted.source.inputs.pnpmLock;
  assert.equal(validateSchema(substituted), false, "JSON schema accepted a substituted retained source input name");
  rejects(() => validateCanonicalReleaseManifest(substituted), "substituted retained source input name");
});

test("local flags URLs and reviewer data cannot forge external evidence, eligibility, or Gate closure", (t) => {
  const { root, request } = useApprovedRepository(t);
  for (const [field, value] of [
    ["signed", true],
    ["approved", true],
    ["notarized", true],
    ["archived", true],
    ["archive", "https://invalid.example/archive"],
    ["reviewer", { name: "invented" }],
    ["eligible", true],
    ["closesGate", true],
    ["proofUrl", "https://invalid.example/evidence"],
    ["externalEvidence", { signing: true }],
  ]) {
    rejects(() => validateReleaseRequest({ ...request, [field]: value }), `forged request field ${field}`);
  }

  const manifest = collectFutureReleaseIdentity({ repositoryRoot: root });
  for (const mutate of [
    (candidate) => { candidate.externalEvidence.signing.status = "satisfied"; },
    (candidate) => { candidate.externalEvidence.signing.issuer = "invented-key"; },
    (candidate) => { candidate.externalEvidence.notarization.proof = "https://invalid.example/notarization"; },
    (candidate) => { candidate.externalEvidence.wormArchive.status = "observed"; },
    (candidate) => { candidate.externalEvidence.independentReview.proof = { reviewer: "invented" }; },
    (candidate) => { candidate.externalEvidence.gateClosure.status = "closed"; },
    (candidate) => { candidate.eligible = true; },
    (candidate) => { candidate.closesGate = true; },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    rejects(() => validateCanonicalReleaseManifest(candidate), "forged external evidence state");
  }
});

test("future issue rejects package Cargo Tauri runtime and source-graph version skew", (t) => {
  const mutations = [
    ["root package", (root) => updateJsonAndCommit(root, "package.json", (value) => { value.version = "9.8.7"; }, "root skew")],
    ["desktop package", (root) => updateJsonAndCommit(root, "apps/desktop/package.json", (value) => { value.version = "9.8.7"; }, "desktop skew")],
    ["Cargo workspace", (root) => {
      writeText(root, "Cargo.toml", '[workspace]\nmembers = []\n\n[workspace.package]\nversion = "9.8.7"\nrust-version = "1.2.3"\n');
      commitAll(root, "Cargo skew");
    }],
    ["Tauri configuration", (root) => updateJsonAndCommit(root, "apps/desktop/src-tauri/tauri.conf.json", (value) => { value.version = "9.8.7"; }, "Tauri skew")],
    ["runtime appVersion", (root) => updateJsonAndCommit(root, releaseProductionCatalog.runtimeIdentityPath, (value) => { value.appVersion = "9.8.7"; }, "runtime skew")],
    ["runtime source import", (root) => {
      writeText(root, releaseProductionCatalog.runtimeEntrypointPath, "export const appVersion = \"not-loaded\";\n");
      commitAll(root, "runtime graph skew");
    }],
  ];
  for (const [name, mutate] of mutations) {
    const { root } = createApprovedRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mutate(root);
    rejects(() => collectFutureReleaseIdentity({ repositoryRoot: root }), name);
  }
});

test("release sentinels cannot become product release identity", (t) => {
  const sentinel = useApprovedRepository(t);
  updateJsonAndCommit(sentinel.root, "package.json", (value) => { value.version = "0.0.0"; }, "root sentinel");
  rejects(() => collectFutureReleaseIdentity({ repositoryRoot: sentinel.root }), "root sentinel");
});

test("removed connector roots cannot substitute release inputs", (t) => {
  const { root } = useApprovedRepository(t);
  const removedRoot = ["packages", "connectors", "atom"].join("/");
  writeText(root, `${removedRoot}/src/index.ts`, "export const forgedReleaseDescriptor = true;\n");
  commitAll(root, "attempt removed connector release substitution");
  rejects(() => collectFutureReleaseIdentity({ repositoryRoot: root }), "removed connector source");
});

test("source and input TOCTOU drift fails before a canonical manifest can be emitted", (t) => {
  const mutators = [
    ["dirty tracked source", (root) => writeText(root, "apps/desktop/src/main.tsx", 'import releaseIdentity from "./release-identity.json";\nexport const changed = releaseIdentity.appVersion;\n')],
    ["dirty untracked source", (root) => writeText(root, "untracked-release-input.txt", "unexpected\n")],
    ["commit and tree", (root) => {
      writeText(root, "apps/desktop/src/main.tsx", 'import releaseIdentity from "./release-identity.json";\nexport const committedChange = releaseIdentity.appVersion;\n');
      commitAll(root, "source tree drift");
    }],
    ["pnpm lock", (root) => writeText(root, "pnpm-lock.yaml", "mutated lock\n")],
    ["Cargo lock", (root) => writeText(root, "Cargo.lock", "mutated lock\n")],
    ["Rust toolchain", (root) => writeText(root, "rust-toolchain.toml", "[toolchain]\nchannel = \"9.9.9\"\n")],
    ["release request", (root) => writeText(root, "release/release-request.json", `${JSON.stringify({ ...futureRequest(), channel: "drift" })}\n`)],
    ["root package", (root) => updateJsonAndCommit(root, "package.json", (value) => { value.version = fixtureVersion; value.description = "source drift"; }, "root input drift")],
    ["desktop package", (root) => updateJsonAndCommit(root, "apps/desktop/package.json", (value) => { value.description = "source drift"; }, "desktop input drift")],
    ["Cargo workspace", (root) => {
      writeText(root, "Cargo.toml", `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${fixtureVersion}"\nrust-version = "1.2.3"\n# source drift\n`);
      commitAll(root, "Cargo input drift");
    }],
    ["Tauri configuration", (root) => updateJsonAndCommit(root, "apps/desktop/src-tauri/tauri.conf.json", (value) => { value.description = "source drift"; }, "Tauri input drift")],
    ["runtime identity", (root) => updateJsonAndCommit(root, releaseProductionCatalog.runtimeIdentityPath, (value) => { value.source = "drift"; }, "runtime input drift")],
  ];
  for (const [name, mutate] of mutators) {
    const { root } = createApprovedRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    rejects(
      () => collectFutureReleaseIdentity({
        repositoryRoot: root,
        checkpoints: { afterPreparation: () => mutate(root), afterArtifactDigest: null },
      }),
      name,
    );
    assert.equal(existsSync(join(root, ".artifacts/release/identity.json")), false, `${name} created a manifest`);
  }
});

test("retained source inputs must be tracked regular files and never symlinks", (t) => {
  const untracked = useApprovedRepository(t);
  git(untracked.root, ["rm", "--cached", "pnpm-lock.yaml"]);
  git(untracked.root, ["commit", "--quiet", "-m", "untrack retained lockfile"]);
  rejects(
    () => collectFutureReleaseIdentity({ repositoryRoot: untracked.root }),
    "untracked retained source input",
  );

  const symlinked = useApprovedRepository(t);
  writeText(symlinked.root, "replacement-pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  rmSync(join(symlinked.root, "pnpm-lock.yaml"));
  symlinkSync("replacement-pnpm-lock.yaml", join(symlinked.root, "pnpm-lock.yaml"));
  commitAll(symlinked.root, "replace retained lockfile with a symlink");
  rejects(
    () => collectFutureReleaseIdentity({ repositoryRoot: symlinked.root }),
    "symlinked retained source input",
  );
});

test("canonical re-verification rejects forged retained-source paths, byte counts, digests, toolchain, and Git identities", (t) => {
  const { root } = useApprovedRepository(t);
  const manifest = collectFutureReleaseIdentity({ repositoryRoot: root });
  const mutations = [
    ["commit", (candidate) => { candidate.source.commit = "0".repeat(40); }],
    ["tree", (candidate) => { candidate.source.tree = "1".repeat(40); }],
    ["pnpm lock", (candidate) => { candidate.source.inputs.pnpmLock.sha256 = "2".repeat(64); }],
    ["pnpm lock path", (candidate) => { candidate.source.inputs.pnpmLock.path = "Cargo.lock"; }],
    ["pnpm lock byte count", (candidate) => { candidate.source.inputs.pnpmLock.bytes += 1; }],
    ["Cargo lock", (candidate) => { candidate.source.inputs.cargoLock.sha256 = "3".repeat(64); }],
    ["toolchain lock", (candidate) => { candidate.source.inputs.rustToolchain.sha256 = "4".repeat(64); }],
    ["release request", (candidate) => { candidate.source.inputs.releaseRequest.sha256 = "5".repeat(64); }],
    ["Node toolchain", (candidate) => { candidate.source.toolchain.node = "1.2.3"; }],
  ];
  for (const [name, mutate] of mutations) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    rejects(() => verifyCanonicalReleaseManifest(root, candidate), name);
  }
});

test("artifact finalization rejects absent extra duplicate escaped substituted and post-hash-mutated artifacts", (t) => {
  const absent = useApprovedRepository(t);
  rmSync(join(absent.root, artifactRoot, "bundle/application.bin"));
  rejects(() => collectFutureReleaseIdentity({ repositoryRoot: absent.root }), "absent artifact");

  const extra = useApprovedRepository(t);
  writeText(extra.root, `${artifactRoot}/bundle/extra.bin`, "extra");
  rejects(() => collectFutureReleaseIdentity({ repositoryRoot: extra.root }), "extra artifact");

  const duplicate = useApprovedRepository(t);
  const duplicateRequest = futureRequest({ artifactEntries: [{ path: "bundle/application.bin" }, { path: "bundle/application.bin" }] });
  writeJson(duplicate.root, "release/release-request.json", duplicateRequest);
  commitAll(duplicate.root, "duplicate artifact declaration");
  rejects(() => collectFutureReleaseIdentity({ repositoryRoot: duplicate.root }), "duplicate artifact declaration");

  const escaped = useApprovedRepository(t);
  const escapedRequest = futureRequest({ artifactEntries: [{ path: "../outside.bin" }] });
  writeJson(escaped.root, "release/release-request.json", escapedRequest);
  commitAll(escaped.root, "escaped artifact declaration");
  rejects(() => collectFutureReleaseIdentity({ repositoryRoot: escaped.root }), "escaped artifact declaration");

  const substituted = useApprovedRepository(t, {
    artifactEntries: [
      { path: "bundle/first.bin", content: "first" },
      { path: "bundle/second.bin", content: "second" },
    ],
  });
  const manifest = collectFutureReleaseIdentity({ repositoryRoot: substituted.root });
  const digestSubstitution = structuredClone(manifest);
  digestSubstitution.artifacts[0].sha256 = digestSubstitution.artifacts[1].sha256;
  rejects(() => verifyCanonicalReleaseManifest(substituted.root, digestSubstitution), "substituted artifact digest");
  const targetSubstitution = structuredClone(manifest);
  targetSubstitution.target.platform = "other-platform";
  rejects(() => verifyCanonicalReleaseManifest(substituted.root, targetSubstitution), "substituted target");

  const postHash = useApprovedRepository(t);
  rejects(
    () => collectFutureReleaseIdentity({
      repositoryRoot: postHash.root,
      checkpoints: {
        afterPreparation: null,
        afterArtifactDigest: () => writeText(postHash.root, `${artifactRoot}/bundle/application.bin`, "mutated after first digest"),
      },
    }),
    "post-hash artifact mutation",
  );
});

test("production composition rejects fixture and test-vector paths and cannot consume them as identity sources", (t) => {
  for (const request of [
    futureRequest({ artifactDirectory: ".artifacts/fixtures" }),
    futureRequest({ artifactEntries: [{ path: "test-vectors/application.bin" }] }),
    futureRequest({ artifactEntries: [{ path: "visual-fixtures/application.bin" }] }),
    futureRequest({ artifactEntries: [{ path: "generated-test-only/application.bin" }] }),
    futureRequest({ artifactDirectory: ".artifacts/release;touch-unreachable" }),
    futureRequest({ artifactEntries: [{ path: "bundle/application;touch-unreachable.bin" }] }),
  ]) {
    rejects(() => validateReleaseRequest(request), "fixture path in approved request");
  }

  const { root } = useApprovedRepository(t);
  const manifest = collectFutureReleaseIdentity({ repositoryRoot: root });
  const unknown = structuredClone(manifest);
  unknown.fixtureReleaseIdentity = true;
  rejects(() => validateCanonicalReleaseManifest(unknown), "unknown manifest field");

  let accessorCalls = 0;
  const accessor = structuredClone(manifest);
  Object.defineProperty(accessor.externalEvidence, "signing", {
    enumerable: true,
    configurable: true,
    get() {
      accessorCalls += 1;
      throw new Error("signing getter must not be read");
    },
  });
  rejects(() => validateCanonicalReleaseManifest(accessor), "external evidence accessor");
  assert.equal(accessorCalls, 0, "manifest accessor was invoked");
});

test("owned release validation surfaces retain no retired Core registry identity", () => {
  const retiredTokens = [
    retiredGeneratedRegistryInput,
    ["production", "Generated", "RegistryPaths"].join(""),
    ["releaseProductionCatalog", retiredGeneratedRegistryInput].join("."),
    ["sourceInputs", "generated"].join("."),
    ["crates", "secure-host-core", "src", "generated", "endpoint_registry.rs"].join("/"),
    ["crates", "secure-host-core", "src", "generated", "connector_policy_registry.rs"].join("/"),
  ];
  const assertRetiredTokensAbsent = (source, target) => {
    for (const token of retiredTokens) {
      assert.equal(source.includes(token), false, `${target} retains retired release identity token ${token}`);
    }
  };
  const targets = [
    "release/release-identity-policy.mjs",
    "release/release-manifest.schema.json",
    "release/release-identity-command-boundary.test.mjs",
    "scripts/release-identity-policy.test.mjs",
  ];
  for (const target of targets) {
    const source = readFileSync(resolve(repositoryRoot, target), "utf8");
    assertRetiredTokensAbsent(source, target);
  }
  assert.throws(
    () => assertRetiredTokensAbsent(`const ${retiredGeneratedRegistryInput} = [];\n`, "temporary policy mutation"),
    /temporary policy mutation retains retired release identity token/u,
  );
  assert.equal(
    Object.hasOwn(releaseProductionCatalog, ["generated", "RegistryPaths"].join("")),
    false,
    "the release production catalog must not retain a registry-path compatibility member",
  );
});

test("the collector exposes no build operation and all policy test checkpoints are mutation controls", () => {
  const collector = readFileSync(collectorPath, "utf8");
  assert.doesNotMatch(collector, /(?:spawn|exec|build|publish|sign|notarize|archive)\s*\(/iu);
  const policy = readFileSync(resolve(repositoryRoot, "release/release-identity-policy.mjs"), "utf8");
  assert.match(policy, /spawnSync\("git", \["-C", repositoryRoot, \.\.\.args\]/u);
  assert.doesNotMatch(policy, /execSync|execFileSync|shell\s*:\s*true/u);
  assert.equal(
    canonicalReleaseJson(createReleaseFoundationReport({ schemaVersion: 1, state: "unissued" })).includes(fixtureVersion),
    false,
  );
});
