import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { repositoryTopology, repositoryTopologyErrors } from "./repository-topology-policy.mjs";

function writeFile(root, path, source) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source);
}

function writeJson(root, path, value) {
  writeFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function entrypoint(id, target, exported = false) {
  return { id, target, exported };
}

function workspaceImport(packageName, rationale, allowedSubpaths = ["."]) {
  return { packageName, rationale, allowedSubpaths };
}

function fixtureTopology() {
  return [
    {
      id: "fixture-repository-tooling",
      kind: "repository-tooling",
      root: ".",
      runtime: "node-tooling",
      trustDomain: "repository-maintenance",
      manifest: { ecosystem: "root-node", path: "package.json", identity: "gooddealer" },
      sourceRoots: ["scripts"],
      publicEntrypoints: [],
      workspaceImports: [],
      protocolSubpaths: [],
      externalDependencies: [],
      generatedRoots: [],
      rustDependencies: [],
    },
    {
      id: "fixture-app",
      kind: "application",
      root: "apps/app",
      runtime: "browser",
      trustDomain: "fixture-app",
      manifest: { ecosystem: "pnpm", path: "apps/app/package.json", identity: "@gooddealer/app" },
      sourceRoots: ["src"],
      publicEntrypoints: [entrypoint("application", "src/index.ts")],
      workspaceImports: [
        workspaceImport("@gooddealer/library", "Fixture application library contract."),
        workspaceImport("@gooddealer/protocol", "Fixture wire contract.", ["./wire"]),
      ],
      protocolSubpaths: ["./wire"],
      externalDependencies: [],
      generatedRoots: [],
      rustDependencies: [],
    },
    {
      id: "fixture-browser-automation",
      kind: "typescript-package",
      root: "packages/browser-automation",
      runtime: "node-contracts",
      trustDomain: "fixture-browser-automation",
      manifest: {
        ecosystem: "pnpm",
        path: "packages/browser-automation/package.json",
        identity: "@gooddealer/browser-automation",
      },
      sourceRoots: ["src"],
      publicEntrypoints: [
        entrypoint("./contracts", "src/contracts/index.ts", true),
        entrypoint("./recipes", "src/recipes/index.ts", true),
        entrypoint("./probe-runtime", "src/probe-runtime/index.ts", true),
        entrypoint("./test-kit", "src/test-kit/index.ts", true),
      ],
      workspaceImports: [],
      protocolSubpaths: [],
      externalDependencies: [],
      generatedRoots: [],
      rustDependencies: [],
    },
    {
      id: "fixture-library",
      kind: "typescript-package",
      root: "packages/library",
      runtime: "node-contracts",
      trustDomain: "fixture-library",
      manifest: { ecosystem: "pnpm", path: "packages/library/package.json", identity: "@gooddealer/library" },
      sourceRoots: ["src"],
      publicEntrypoints: [entrypoint(".", "src/index.ts", true)],
      workspaceImports: [],
      protocolSubpaths: [],
      externalDependencies: [],
      generatedRoots: [],
      rustDependencies: [],
    },
    {
      id: "fixture-protocol",
      kind: "typescript-package",
      root: "packages/protocol",
      runtime: "node-contracts",
      trustDomain: "fixture-protocol",
      manifest: { ecosystem: "pnpm", path: "packages/protocol/package.json", identity: "@gooddealer/protocol" },
      sourceRoots: ["src"],
      publicEntrypoints: [
        entrypoint("./jobs", "src/jobs/index.ts", true),
        entrypoint("./wire", "src/wire/index.ts", true),
      ],
      workspaceImports: [],
      protocolSubpaths: [],
      externalDependencies: [],
      generatedRoots: [],
      rustDependencies: [],
    },
    {
      id: "fixture-rust-a",
      kind: "rust-crate",
      root: "crates/rust-a",
      runtime: "rust-host",
      trustDomain: "fixture-rust-a",
      manifest: { ecosystem: "cargo", path: "crates/rust-a/Cargo.toml", identity: "gooddealer-rust-a" },
      sourceRoots: ["src"],
      publicEntrypoints: [entrypoint("lib", "src/lib.rs")],
      workspaceImports: [],
      protocolSubpaths: [],
      externalDependencies: [],
      generatedRoots: [],
      rustDependencies: [
        { crate: "gooddealer-rust-b", rationale: "Fixture Rust direction control." },
      ],
    },
    {
      id: "fixture-rust-b",
      kind: "rust-crate",
      root: "crates/rust-b",
      runtime: "rust-host",
      trustDomain: "fixture-rust-b",
      manifest: { ecosystem: "cargo", path: "crates/rust-b/Cargo.toml", identity: "gooddealer-rust-b" },
      sourceRoots: ["src"],
      publicEntrypoints: [entrypoint("lib", "src/lib.rs")],
      workspaceImports: [],
      protocolSubpaths: [],
      externalDependencies: [],
      generatedRoots: [],
      rustDependencies: [],
    },
  ];
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-topology-"));
  writeJson(root, "package.json", { name: "gooddealer", private: true });
  writeFile(
    root,
    "pnpm-workspace.yaml",
    "packages:\n  - apps/*\n  - packages/*\n",
  );
  writeFile(
    root,
    "Cargo.toml",
    '[workspace]\nmembers = ["crates/rust-a", "crates/rust-b"]\nresolver = "2"\n',
  );
  writeJson(root, "apps/app/package.json", {
    name: "@gooddealer/app",
    private: true,
    dependencies: {
      "@gooddealer/library": "workspace:*",
      "@gooddealer/protocol": "workspace:*",
    },
  });
  writeFile(
    root,
    "apps/app/src/index.ts",
    'import { library } from "@gooddealer/library";\nimport { wire } from "@gooddealer/protocol/wire";\nexport const app = [library, wire];\n',
  );
  writeFile(root, "scripts/fixture-tooling.mjs", "export {};\n");
  writeJson(root, "packages/browser-automation/package.json", {
    name: "@gooddealer/browser-automation",
    private: true,
    exports: {
      "./contracts": "./src/contracts/index.ts",
      "./recipes": "./src/recipes/index.ts",
      "./probe-runtime": "./src/probe-runtime/index.ts",
      "./test-kit": "./src/test-kit/index.ts",
    },
  });
  for (const path of [
    "contracts/index.ts",
    "recipes/index.ts",
    "probe-runtime/index.ts",
    "test-kit/index.ts",
  ]) {
    writeFile(root, `packages/browser-automation/src/${path}`, "export {};\n");
  }
  writeJson(root, "packages/library/package.json", {
    name: "@gooddealer/library",
    private: true,
    exports: { ".": "./src/index.ts" },
  });
  writeFile(root, "packages/library/src/index.ts", "export const library = 'library';\n");
  writeJson(root, "packages/protocol/package.json", {
    name: "@gooddealer/protocol",
    private: true,
    exports: {
      "./wire": "./src/wire/index.ts",
      "./jobs": "./src/jobs/index.ts",
    },
  });
  writeFile(root, "packages/protocol/src/wire/index.ts", "export const wire = 'wire';\n");
  writeFile(root, "packages/protocol/src/jobs/index.ts", "export const jobs = 'jobs';\n");
  writeFile(
    root,
    "crates/rust-a/Cargo.toml",
    '[package]\nname = "gooddealer-rust-a"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\ngooddealer-rust-b = { path = "../rust-b" }\n',
  );
  writeFile(root, "crates/rust-a/src/lib.rs", "pub fn a() {}\n");
  writeFile(
    root,
    "crates/rust-b/Cargo.toml",
    '[package]\nname = "gooddealer-rust-b"\nversion = "0.1.0"\nedition = "2024"\n',
  );
  writeFile(root, "crates/rust-b/src/lib.rs", "pub fn b() {}\n");
  return { root, topology: fixtureTopology() };
}

function useFixture(t) {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  return fixture;
}

function policyErrorText(root, topology) {
  return repositoryTopologyErrors({ root, topology }).join("\n");
}

test("the production catalog covers the current repository inventory", () => {
  assert.deepEqual(repositoryTopologyErrors(), []);
  assert.equal(repositoryTopology.length, 18);
  const protocol = repositoryTopology.find((unit) => unit.manifest.identity === "@gooddealer/protocol");
  const cloud = repositoryTopology.find((unit) => unit.id === "cloud");
  const browserAutomation = repositoryTopology.find(
    (unit) => unit.manifest.identity === "@gooddealer/browser-automation",
  );
  const automationHost = repositoryTopology.find((unit) => unit.id === "automation-host");
  const secureHostCore = repositoryTopology.find((unit) => unit.id === "secure-host-core");
  const localStorage = repositoryTopology.find((unit) => unit.id === "local-storage");
  const desktopTauriHost = repositoryTopology.find((unit) => unit.id === "desktop-tauri-host");
  const repositoryTooling = repositoryTopology.find((unit) => unit.id === "repository-tooling");
  const releaseEngineering = repositoryTopology.find((unit) => unit.id === "release-engineering");
  assert.ok(protocol.publicEntrypoints.some((entry) => entry.id === "./wire"));
  assert.ok(protocol.publicEntrypoints.some((entry) => entry.id === "./jobs"));
  assert.ok(
    protocol.publicEntrypoints.some(
      (entry) => entry.id === "./audit" && entry.target === "src/audit/index.ts" && entry.exported,
    ),
  );
  const cloudProtocolImport = cloud.workspaceImports.find(
    (dependency) => dependency.packageName === "@gooddealer/protocol",
  );
  assert.ok(cloudProtocolImport.allowedSubpaths.includes("./audit"));
  assert.ok(cloud.protocolSubpaths.includes("./audit"));
  assert.deepEqual(cloudProtocolImport.allowedSubpaths, cloud.protocolSubpaths);
  assert.deepEqual(
    browserAutomation.publicEntrypoints.map((entry) => entry.id).sort(),
    ["./contracts", "./probe-runtime", "./recipes", "./test-kit"],
  );
  assert.deepEqual(secureHostCore.sourceRoots, ["src", "tests"]);
  assert.deepEqual(secureHostCore.generatedRoots, []);
  assert.deepEqual(secureHostCore.publicEntrypoints, [
    entrypoint("lib", "src/lib.rs"),
    entrypoint("public-surface-test", "tests/public_surface.rs"),
  ]);
  assert.deepEqual(automationHost.rustDependencies, []);
  assert.deepEqual(localStorage.publicEntrypoints, [
    entrypoint("lib", "src/lib.rs"),
    entrypoint("backup-evidence", "examples/backup_evidence.rs"),
    entrypoint("sqlcipher-evidence", "examples/sqlcipher_evidence.rs"),
  ]);
  assert.deepEqual(localStorage.rustDependencies, []);
  assert.deepEqual(localStorage.externalDependencies, [
    "chacha20poly1305",
    "rusqlite",
    "serde",
    "serde_json",
    "sha2",
    "tempfile",
  ]);
  assert.equal(localStorage.externalDependencies.includes("getrandom"), false);
  assert.equal(localStorage.externalDependencies.includes("security-framework"), false);
  assert.equal(localStorage.externalDependencies.includes("zeroize"), false);
  assert.deepEqual(
    desktopTauriHost.rustDependencies.map(({ crate }) => crate),
    ["gooddealer-local-storage", "gooddealer-secure-host-core"],
  );
  assert.equal(
    desktopTauriHost.rustDependencies.find(
      ({ crate }) => crate === "gooddealer-secure-host-core",
    ).integrationMarker,
    "crates/secure-host-core/src/local_database_key.rs",
  );
  assert.deepEqual(desktopTauriHost.externalDependencies, [
    "serde",
    "serde_json",
    "tauri",
    "tauri-build",
    "tempfile",
  ]);
  assert.equal(secureHostCore.externalDependencies.includes("getrandom"), true);
  assert.equal(secureHostCore.externalDependencies.includes("security-framework"), true);
  assert.equal(secureHostCore.externalDependencies.includes("zeroize"), true);
  assert.equal(
    repositoryTooling.publicEntrypoints.some(
      (entry) => entry.id === "collect-consent-ticket-foundation",
    ),
    false,
  );
  assert.equal(
    repositoryTooling.publicEntrypoints.some((entry) => entry.id.includes("connector-contract")),
    false,
  );
  assert.ok(
    repositoryTooling.publicEntrypoints.some(
      (entry) => entry.id === "collect-release-identity" && entry.target === "scripts/collect-release-identity.mjs",
    ),
  );
  assert.deepEqual(releaseEngineering, {
    id: "release-engineering",
    kind: "repository-tooling",
    root: "release",
    runtime: "node-policy",
    trustDomain: "release-engineering",
    manifest: {
      ecosystem: "release-identity",
      path: "release/release-request.schema.json",
      identity: "gooddealer-release-engineering",
    },
    sourceRoots: [],
    publicEntrypoints: [
      entrypoint("release-identity-policy", "release-identity-policy.mjs"),
      entrypoint("release-identity-command-boundary", "release-identity-command-boundary.test.mjs"),
    ],
    workspaceImports: [],
    protocolSubpaths: [],
    externalDependencies: [],
    generatedRoots: [],
    rustDependencies: [],
  });
});

test("rejects release source files that lose their explicit release-engineering entrypoints", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(root, "release/release-identity-policy.mjs", "export const policy = true;\n");
  writeFile(root, "release/release-identity-command-boundary.test.mjs", "export const boundary = true;\n");
  topology.push({
    id: "fixture-release-engineering",
    kind: "repository-tooling",
    root: "release",
    runtime: "node-policy",
    trustDomain: "fixture-release-engineering",
    manifest: {
      ecosystem: "release-identity",
      path: "release/release-request.schema.json",
      identity: "fixture-release-engineering",
    },
    sourceRoots: [],
    publicEntrypoints: [
      entrypoint("release-identity-policy", "release-identity-policy.mjs"),
      entrypoint("release-identity-command-boundary", "release-identity-command-boundary.test.mjs"),
    ],
    workspaceImports: [],
    protocolSubpaths: [],
    externalDependencies: [],
    generatedRoots: [],
    rustDependencies: [],
  });
  assert.deepEqual(repositoryTopologyErrors({ root, topology }), []);

  topology.find((unit) => unit.id === "fixture-release-engineering").publicEntrypoints = [];
  const errors = policyErrorText(root, topology);
  assert.match(
    errors,
    /release\/release-identity-policy\.mjs: source file is outside catalogued source roots or entrypoints/u,
  );
  assert.match(
    errors,
    /release\/release-identity-command-boundary\.test\.mjs: source file is outside catalogued source roots or entrypoints/u,
  );
});

test("accepts the positive fixture inventory and literal dynamic import", (t) => {
  const { root, topology } = useFixture(t);
  assert.deepEqual(repositoryTopologyErrors({ root, topology }), []);
  writeFile(
    root,
    "apps/app/src/index.ts",
    'export async function loadWire() { return import("@gooddealer/protocol/wire"); }\n',
  );
  assert.deepEqual(repositoryTopologyErrors({ root, topology }), []);
});

test("rejects an undeclared workspace unit", (t) => {
  const { root, topology } = useFixture(t);
  writeJson(root, "packages/rogue/package.json", { name: "@gooddealer/rogue", private: true });
  assert.match(policyErrorText(root, topology), /undeclared pnpm workspace unit: packages\/rogue/u);
});

test("rejects restoration of removed package roots as directories or dangling symbolic links", (t) => {
  const directoryFixture = useFixture(t);
  const removedDirectory = ["packages", ["connector", "sdk"].join("-")].join("/");
  mkdirSync(join(directoryFixture.root, removedDirectory), { recursive: true });
  assert.match(policyErrorText(directoryFixture.root, directoryFixture.topology), /removed package root must be absent/u);

  const symlinkFixture = useFixture(t);
  const removedSymlink = ["packages", "connectors", "atom"].join("/");
  mkdirSync(dirname(join(symlinkFixture.root, removedSymlink)), { recursive: true });
  symlinkSync("missing-obsolete-package", join(symlinkFixture.root, removedSymlink));
  assert.match(policyErrorText(symlinkFixture.root, symlinkFixture.topology), /symbolic link/u);
});

test("rejects an undocumented package export", (t) => {
  const { root, topology } = useFixture(t);
  writeJson(root, "packages/protocol/package.json", {
    name: "@gooddealer/protocol",
    private: true,
    exports: {
      "./wire": "./src/wire/index.ts",
      "./jobs": "./src/jobs/index.ts",
      "./leak": "./src/leak.ts",
    },
  });
  writeFile(root, "packages/protocol/src/leak.ts", "export const leak = true;\n");
  assert.match(policyErrorText(root, topology), /package exports do not exactly match catalogued public entrypoints/u);
});

test("rejects wildcard and deep workspace imports", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(
    root,
    "apps/app/src/index.ts",
    'import "@gooddealer/protocol/*";\nimport "@gooddealer/protocol/private";\n',
  );
  const errors = policyErrorText(root, topology);
  assert.match(errors, /wildcard workspace imports are forbidden/u);
  assert.match(errors, /deep or undocumented public import is forbidden/u);
});

test("rejects a workspace import without its manifest dependency", (t) => {
  const { root, topology } = useFixture(t);
  writeJson(root, "apps/app/package.json", {
    name: "@gooddealer/app",
    private: true,
    dependencies: { "@gooddealer/protocol": "workspace:*" },
  });
  assert.match(policyErrorText(root, topology), /@gooddealer\/library is imported without a manifest dependency/u);
});

test("rejects a catalogued dependency without a rationale", (t) => {
  const { root, topology } = useFixture(t);
  const mutatedTopology = structuredClone(topology);
  const app = mutatedTopology.find((unit) => unit.id === "fixture-app");
  app.workspaceImports.find((dependency) => dependency.packageName === "@gooddealer/library").rationale = "";
  assert.match(policyErrorText(root, mutatedTopology), /catalogued workspace dependency @gooddealer\/library has no rationale/u);
});

test("rejects a caller using an unapproved protocol subpath", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(root, "apps/app/src/index.ts", 'import "@gooddealer/protocol/jobs";\n');
  const errors = policyErrorText(root, topology);
  assert.match(errors, /unapproved subpath \.\/jobs for @gooddealer\/protocol/u);
  assert.match(errors, /protocol subpath \.\/jobs is not allowed for fixture-app/u);
});

test("rejects an uncatalogued source root and application entrypoint", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(root, "apps/app/rogue/index.ts", "export const rogue = true;\n");
  assert.match(policyErrorText(root, topology), /source file is outside catalogued source roots or entrypoints/u);
  const mutatedTopology = structuredClone(topology);
  mutatedTopology.find((unit) => unit.id === "fixture-app").publicEntrypoints = [];
  assert.match(policyErrorText(root, mutatedTopology), /observed application entrypoint is not catalogued/u);
});

test("rejects a root-level source outside catalogued repository-tooling roots", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(root, "uncatalogued-root.mjs", "export const rogue = true;\n");
  assert.match(
    policyErrorText(root, topology),
    /uncatalogued-root\.mjs: source file is outside catalogued source roots or entrypoints/u,
  );
});

test("rejects an unauthorized protocol import from repository-tooling scripts", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(root, "scripts/rogue-topology-import.ts", 'import "@gooddealer/protocol/jobs";\n');
  const errors = policyErrorText(root, topology);
  assert.match(errors, /@gooddealer\/protocol is imported without a manifest dependency/u);
  assert.match(errors, /workspace import edge is not catalogued: @gooddealer\/protocol/u);
});

test("checks literal dynamic imports against the catalog", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(
    root,
    "apps/app/src/index.ts",
    'export async function loadJobs() { return import("@gooddealer/protocol/jobs"); }\n',
  );
  assert.match(policyErrorText(root, topology), /unapproved subpath \.\/jobs/u);
});

test("rejects computed dynamic imports", (t) => {
  const { root, topology } = useFixture(t);
  writeFile(
    root,
    "apps/app/src/index.ts",
    'const moduleName = "@gooddealer/protocol/wire";\nexport async function load() { return import(moduleName); }\n',
  );
  assert.match(policyErrorText(root, topology), /computed dynamic imports are forbidden/u);
});

test("rejects a Cargo workspace edge absent from the catalog", (t) => {
  const { root, topology } = useFixture(t);
  const mutatedTopology = structuredClone(topology);
  mutatedTopology.find((unit) => unit.id === "fixture-rust-a").rustDependencies = [];
  assert.match(policyErrorText(root, mutatedTopology), /Cargo workspace dependency edges do not exactly match the catalog/u);
});

test("requires a staged Rust dependency as soon as its integration marker exists", (t) => {
  const { root, topology } = useFixture(t);
  topology.find((unit) => unit.id === "fixture-rust-a").rustDependencies[0].integrationMarker =
    "crates/rust-a/src/secure.rs";
  writeFile(
    root,
    "crates/rust-a/Cargo.toml",
    '[package]\nname = "gooddealer-rust-a"\nversion = "0.1.0"\nedition = "2024"\n',
  );
  assert.deepEqual(repositoryTopologyErrors({ root, topology }), []);

  writeFile(root, "crates/rust-a/src/secure.rs", "pub fn secure() {}\n");
  assert.match(
    policyErrorText(root, topology),
    /Cargo workspace dependency edges do not exactly match the catalog/,
  );
});
