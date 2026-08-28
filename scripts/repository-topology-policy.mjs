import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";

import { rootPackageScriptErrors } from "./root-package-policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const ignoredDirectoryNames = new Set([
  ".astro",
  ".artifacts",
  ".git",
  ".pnpm-store",
  "dist",
  "node_modules",
  "target",
]);
const sourceFileExtensions = new Set([
  ".astro",
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".rs",
  ".ts",
  ".tsx",
]);
const typeScriptExtensions = new Set([".cts", ".mts", ".ts", ".tsx"]);
const removedPackageRoots = Object.freeze([
  ["packages", ["connector", "sdk"].join("-")].join("/"),
  ["packages", ["connector", "test", "kit"].join("-")].join("/"),
  ["packages", "connectors", "afternic"].join("/"),
  ["packages", "connectors", "atom"].join("/"),
  ["packages", "connectors", "spaceship"].join("/"),
]);

function publicEntrypoint(id, target, exported = false) {
  return { id, target, exported };
}

function workspaceImport(packageName, rationale, allowedSubpaths = ["."]) {
  return { packageName, rationale, allowedSubpaths };
}

function rustDependency(crate, rationale) {
  return { crate, rationale };
}

function topologyUnit({
  id,
  kind,
  root,
  runtime,
  trustDomain,
  manifest,
  sourceRoots,
  publicEntrypoints,
  workspaceImports = [],
  protocolSubpaths = [],
  externalDependencies = [],
  generatedRoots = [],
  rustDependencies = [],
}) {
  return Object.freeze({
    id,
    kind,
    root,
    runtime,
    trustDomain,
    manifest,
    sourceRoots,
    publicEntrypoints,
    workspaceImports,
    protocolSubpaths,
    externalDependencies,
    generatedRoots,
    rustDependencies,
  });
}

/**
 * The authoritative, machine-readable repository architecture inventory.
 *
 * Package manifests and Cargo metadata are checked inputs. They are never used
 * to infer missing rows, dependency directions, exports, or source roots.
 */
export const repositoryTopology = Object.freeze([
  topologyUnit({
    id: "repository-tooling",
    kind: "repository-tooling",
    root: ".",
    runtime: "node-tooling",
    trustDomain: "repository-maintenance",
    manifest: { ecosystem: "root-node", path: "package.json", identity: "gooddealer" },
    sourceRoots: ["scripts"],
    publicEntrypoints: [
      publicEntrypoint("structure-tests", "scripts/*.test.mjs"),
      publicEntrypoint("check-repository-topology", "scripts/check-repository-topology.mjs"),
      publicEntrypoint("check-workspace", "scripts/check-workspace.mjs"),
      publicEntrypoint("check-boundaries", "scripts/check-boundaries.mjs"),
      publicEntrypoint("validate-gate-closure", "scripts/validate-gate-closure-attestation.mjs"),
      publicEntrypoint("collect-wp0", "scripts/collect-wp0-evidence.mjs"),
      publicEntrypoint("collect-auth-persistence", "scripts/collect-auth-persistence-report.mjs"),
      publicEntrypoint("collect-devices-persistence", "scripts/collect-devices-persistence-report.mjs"),
      publicEntrypoint(
        "collect-bootstrap-persistence",
        "scripts/collect-bootstrap-persistence-report.mjs",
      ),
      publicEntrypoint(
        "collect-workspace-sync-persistence",
        "scripts/collect-workspace-sync-persistence-report.mjs",
      ),
      publicEntrypoint("collect-cloud-persistence", "scripts/collect-cloud-persistence-report.mjs"),
      publicEntrypoint("collect-jobs-persistence", "scripts/collect-jobs-persistence-report.mjs"),
      publicEntrypoint("collect-recovery-persistence", "scripts/collect-recovery-persistence-report.mjs"),
      publicEntrypoint(
        "collect-browser-runtime-foundation",
        "scripts/collect-browser-runtime-foundation-report.mjs",
      ),
      publicEntrypoint("collect-release-identity", "scripts/collect-release-identity.mjs"),
    ],
    externalDependencies: ["@types/node", "ajv", "typescript", "vitest"],
  }),
  topologyUnit({
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
      publicEntrypoint("release-identity-policy", "release-identity-policy.mjs"),
      publicEntrypoint("release-identity-command-boundary", "release-identity-command-boundary.test.mjs"),
    ],
  }),
  topologyUnit({
    id: "account-web",
    kind: "application",
    root: "apps/account-web",
    runtime: "browser",
    trustDomain: "account-web",
    manifest: { ecosystem: "pnpm", path: "apps/account-web/package.json", identity: "@gooddealer/account-web" },
    sourceRoots: ["src"],
    publicEntrypoints: [publicEntrypoint("application", "src/index.ts")],
    workspaceImports: [
      workspaceImport("@gooddealer/cloud-client", "Account web's typed Cloud client boundary."),
      workspaceImport("@gooddealer/protocol", "Account web's public account wire contracts.", ["./account"]),
    ],
    protocolSubpaths: ["./account"],
  }),
  topologyUnit({
    id: "admin-web",
    kind: "application",
    root: "apps/admin-web",
    runtime: "browser",
    trustDomain: "staff-admin",
    manifest: { ecosystem: "pnpm", path: "apps/admin-web/package.json", identity: "@gooddealer/admin-web" },
    sourceRoots: ["src"],
    publicEntrypoints: [publicEntrypoint("application", "src/index.ts")],
    workspaceImports: [
      workspaceImport("@gooddealer/protocol", "Staff-admin DTO and scope contracts only.", ["./admin"]),
    ],
    protocolSubpaths: ["./admin"],
  }),
  topologyUnit({
    id: "cloud",
    kind: "application",
    root: "apps/cloud",
    runtime: "node",
    trustDomain: "cloud-service",
    manifest: { ecosystem: "pnpm", path: "apps/cloud/package.json", identity: "@gooddealer/cloud" },
    sourceRoots: ["src", "test"],
    publicEntrypoints: [
      publicEntrypoint("public-http", "src/entrypoints/http.ts"),
      publicEntrypoint("admin-http", "src/entrypoints/admin-http.ts"),
      publicEntrypoint("jobs", "src/entrypoints/jobs.ts"),
      publicEntrypoint("postgres-tests", "vitest.postgres.config.ts"),
    ],
    workspaceImports: [
      workspaceImport("@gooddealer/protocol", "Cloud wire contracts and deterministic codecs.", [
        "./account",
        "./audit",
        "./connectors",
        "./devices",
        "./execution-events",
        "./jobs",
        "./recovery",
        "./wire",
        "./workspace",
      ]),
    ],
    protocolSubpaths: [
      "./account",
      "./audit",
      "./connectors",
      "./devices",
      "./execution-events",
      "./jobs",
      "./recovery",
      "./wire",
      "./workspace",
    ],
    externalDependencies: ["@node-rs/argon2", "@types/pg", "fastify", "pg"],
  }),
  topologyUnit({
    id: "desktop",
    kind: "application",
    root: "apps/desktop",
    runtime: "tauri-webview",
    trustDomain: "desktop-presentation",
    manifest: { ecosystem: "pnpm", path: "apps/desktop/package.json", identity: "@gooddealer/desktop" },
    sourceRoots: ["src", "visual-fixtures"],
    publicEntrypoints: [
      publicEntrypoint("production-ui", "src/main.tsx"),
      publicEntrypoint("visual-fixtures", "visual-fixtures/main.tsx"),
      publicEntrypoint("vite", "vite.config.ts"),
      publicEntrypoint("visual-vite", "vite.visual.config.ts"),
    ],
    workspaceImports: [
      workspaceImport("@gooddealer/client-core", "Host-independent desktop capability contracts."),
      workspaceImport("@gooddealer/i18n", "Desktop copy and deterministic presentation formatting."),
      workspaceImport("@gooddealer/ui", "Shared UI root, tokens, and declared static assets.", [
        ".",
        "./assets/*",
        "./tokens.css",
      ]),
    ],
    externalDependencies: [
      "@tauri-apps/api",
      "@tauri-apps/cli",
      "@types/react",
      "@types/react-dom",
      "react",
      "react-dom",
      "vite",
    ],
  }),
  topologyUnit({
    id: "marketing-web",
    kind: "application",
    root: "apps/marketing-web",
    runtime: "static-web",
    trustDomain: "marketing-web",
    manifest: { ecosystem: "pnpm", path: "apps/marketing-web/package.json", identity: "@gooddealer/marketing-web" },
    sourceRoots: ["src"],
    publicEntrypoints: [
      publicEntrypoint("astro", "astro.config.mjs"),
      publicEntrypoint("root-page", "src/pages/index.astro"),
      publicEntrypoint("zh-page", "src/pages/zh/index.astro"),
    ],
    workspaceImports: [
      workspaceImport("@gooddealer/ui", "Shared visual primitives for the static site."),
    ],
    externalDependencies: ["@astrojs/check", "astro", "typescript", "wrangler"],
  }),
  topologyUnit({
    id: "browser-automation",
    kind: "typescript-package",
    root: "packages/browser-automation",
    runtime: "node-contracts",
    trustDomain: "browser-automation-contracts",
    manifest: {
      ecosystem: "pnpm",
      path: "packages/browser-automation/package.json",
      identity: "@gooddealer/browser-automation",
    },
    sourceRoots: ["src"],
    publicEntrypoints: [
      publicEntrypoint("./contracts", "src/contracts/index.ts", true),
      publicEntrypoint("./recipes", "src/recipes/index.ts", true),
      publicEntrypoint("./probe-runtime", "src/probe-runtime/index.ts", true),
      publicEntrypoint("./test-kit", "src/test-kit/index.ts", true),
    ],
  }),
  topologyUnit({
    id: "client-core",
    kind: "typescript-package",
    root: "packages/client-core",
    runtime: "host-independent-typescript",
    trustDomain: "client-domain",
    manifest: { ecosystem: "pnpm", path: "packages/client-core/package.json", identity: "@gooddealer/client-core" },
    sourceRoots: ["src", "test"],
    publicEntrypoints: [publicEntrypoint(".", "src/index.ts", true)],
    workspaceImports: [
      workspaceImport("@gooddealer/protocol", "Client-domain protocol contracts.", [
        "./account",
        "./devices",
        "./execution-events",
        "./wire",
        "./workspace",
      ]),
    ],
    protocolSubpaths: ["./account", "./devices", "./execution-events", "./wire", "./workspace"],
    externalDependencies: ["zod"],
  }),
  topologyUnit({
    id: "cloud-client",
    kind: "typescript-package",
    root: "packages/cloud-client",
    runtime: "host-independent-typescript",
    trustDomain: "cloud-client",
    manifest: { ecosystem: "pnpm", path: "packages/cloud-client/package.json", identity: "@gooddealer/cloud-client" },
    sourceRoots: ["src", "test"],
    publicEntrypoints: [publicEntrypoint(".", "src/index.ts", true)],
    workspaceImports: [
      workspaceImport("@gooddealer/protocol", "Public account, Cloudflare observation, and workspace contracts.", [
        "./account",
        "./connectors",
        "./workspace",
      ]),
    ],
    protocolSubpaths: ["./account", "./connectors", "./workspace"],
  }),
  topologyUnit({
    id: "connector-cloudflare",
    kind: "concrete-connector",
    root: "packages/connectors/cloudflare",
    runtime: "node-connector",
    trustDomain: "connector-cloudflare",
    manifest: {
      ecosystem: "pnpm",
      path: "packages/connectors/cloudflare/package.json",
      identity: "@gooddealer/connector-cloudflare",
    },
    sourceRoots: ["src", "test"],
    publicEntrypoints: [publicEntrypoint(".", "src/index.ts", true)],
    workspaceImports: [
      workspaceImport("@gooddealer/protocol", "Protocol-owned Cloudflare observation wire contract.", ["./connectors"]),
    ],
    protocolSubpaths: ["./connectors"],
    externalDependencies: ["vitest"],
  }),
  topologyUnit({
    id: "i18n",
    kind: "typescript-package",
    root: "packages/i18n",
    runtime: "host-independent-typescript",
    trustDomain: "presentation-copy",
    manifest: { ecosystem: "pnpm", path: "packages/i18n/package.json", identity: "@gooddealer/i18n" },
    sourceRoots: ["src"],
    publicEntrypoints: [publicEntrypoint(".", "src/index.ts", true)],
  }),
  topologyUnit({
    id: "protocol",
    kind: "typescript-package",
    root: "packages/protocol",
    runtime: "host-independent-typescript",
    trustDomain: "shared-wire-contracts",
    manifest: { ecosystem: "pnpm", path: "packages/protocol/package.json", identity: "@gooddealer/protocol" },
    sourceRoots: ["src", "test"],
    publicEntrypoints: [
      publicEntrypoint("./account", "src/account/index.ts", true),
      publicEntrypoint("./audit", "src/audit/index.ts", true),
      publicEntrypoint("./admin", "src/admin/index.ts", true),
      publicEntrypoint("./connectors", "src/connectors/index.ts", true),
      publicEntrypoint("./devices", "src/devices/index.ts", true),
      publicEntrypoint("./execution-events", "src/execution-events/index.ts", true),
      publicEntrypoint("./jobs", "src/jobs/index.ts", true),
      publicEntrypoint("./recovery", "src/recovery/index.ts", true),
      publicEntrypoint("./wire", "src/wire/index.ts", true),
      publicEntrypoint("./workspace", "src/workspace/index.ts", true),
    ],
    externalDependencies: ["zod"],
  }),
  topologyUnit({
    id: "ui",
    kind: "typescript-package",
    root: "packages/ui",
    runtime: "react-ui",
    trustDomain: "presentation-primitives",
    manifest: { ecosystem: "pnpm", path: "packages/ui/package.json", identity: "@gooddealer/ui" },
    sourceRoots: ["gallery", "src"],
    publicEntrypoints: [
      publicEntrypoint(".", "src/index.ts", true),
      publicEntrypoint("./assets/*", "src/assets/*", true),
      publicEntrypoint("./tokens.css", "src/tokens/index.css", true),
    ],
    externalDependencies: ["@types/react", "@types/react-dom", "react", "react-dom"],
  }),
  topologyUnit({
    id: "secure-host-core",
    kind: "rust-crate",
    root: "crates/secure-host-core",
    runtime: "rust-host",
    trustDomain: "secure-host-core",
    manifest: {
      ecosystem: "cargo",
      path: "crates/secure-host-core/Cargo.toml",
      identity: "gooddealer-secure-host-core",
    },
    sourceRoots: ["src", "tests"],
    generatedRoots: [],
    publicEntrypoints: [
      publicEntrypoint("lib", "src/lib.rs"),
      publicEntrypoint("public-surface-test", "tests/public_surface.rs"),
    ],
    externalDependencies: [
      "chacha20poly1305",
      "flate2",
      "futures-util",
      "getrandom",
      "hmac",
      "rcgen",
      "reqwest",
      "security-framework",
      "serde",
      "serde_json",
      "sha2",
      "tokio",
      "tokio-rustls",
      "url",
      "windows",
      "zeroize",
    ],
  }),
  topologyUnit({
    id: "local-storage",
    kind: "rust-crate",
    root: "crates/local-storage",
    runtime: "rust-host",
    trustDomain: "local-storage",
    manifest: { ecosystem: "cargo", path: "crates/local-storage/Cargo.toml", identity: "gooddealer-local-storage" },
    sourceRoots: ["examples", "src"],
    publicEntrypoints: [
      publicEntrypoint("lib", "src/lib.rs"),
      publicEntrypoint("backup-evidence", "examples/backup_evidence.rs"),
      publicEntrypoint("sqlcipher-evidence", "examples/sqlcipher_evidence.rs"),
    ],
    externalDependencies: [
      "chacha20poly1305",
      "rusqlite",
      "serde",
      "serde_json",
      "sha2",
      "tempfile",
    ],
  }),
  topologyUnit({
    id: "automation-host",
    kind: "rust-crate",
    root: "crates/automation-host",
    runtime: "rust-host",
    trustDomain: "automation-host",
    manifest: { ecosystem: "cargo", path: "crates/automation-host/Cargo.toml", identity: "gooddealer-automation-host" },
    sourceRoots: ["src"],
    publicEntrypoints: [publicEntrypoint("lib", "src/lib.rs")],
    externalDependencies: ["serde", "serde_json", "sha2", "url"],
  }),
  topologyUnit({
    id: "desktop-tauri-host",
    kind: "tauri-host",
    root: "apps/desktop/src-tauri",
    runtime: "rust-tauri-host",
    trustDomain: "desktop-host",
    manifest: {
      ecosystem: "cargo",
      path: "apps/desktop/src-tauri/Cargo.toml",
      identity: "gooddealer-desktop-tauri",
    },
    sourceRoots: ["src"],
    publicEntrypoints: [
      publicEntrypoint("main", "src/main.rs"),
      publicEntrypoint("build", "build.rs"),
    ],
    rustDependencies: [
      rustDependency("gooddealer-local-storage", "Local encrypted storage boundary."),
    ],
    externalDependencies: ["serde", "serde_json", "tauri", "tauri-build", "tempfile"],
  }),
]);

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function removedPackageRootErrors(root) {
  const errors = [];
  for (const path of removedPackageRoots) {
    try {
      const stat = lstatSync(resolve(root, path));
      const kind = stat.isSymbolicLink() ? "symbolic link" : stat.isDirectory() ? "directory" : "entry";
      errors.push(`removed package root must be absent: ${path} (${kind})`);
    } catch (error) {
      if (error?.code !== "ENOENT") errors.push(`removed package root is unreadable: ${path}`);
    }
  }
  return errors;
}

function uniqueSorted(values) {
  return sorted(new Set(values));
}

function arrayEquals(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPathInside(root, candidate) {
  const result = relative(root, candidate);
  return result === "" || (result !== ".." && !result.startsWith("../") && !result.startsWith("..\\"));
}

function pathMatchesPattern(path, pattern) {
  if (!pattern.includes("*")) return path === pattern;
  const [prefix, suffix] = pattern.split("*");
  return path.startsWith(prefix) && path.endsWith(suffix);
}

function pathIsWithinAny(path, roots) {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectoryNames.has(entry.name) || entry.name.startsWith("dist-")) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

function sourceFilesOwnedByUnit(root, topology, unit) {
  const unitRoot = resolve(root, unit.root);
  const candidates = unit.root === "."
    ? [
      ...readdirSync(unitRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => resolve(unitRoot, entry.name)),
      ...unit.sourceRoots.flatMap((sourceRoot) => walkFiles(resolve(unitRoot, sourceRoot))),
    ]
    : walkFiles(unitRoot);
  return candidates.filter((file) => unitForPath(topology, root, file)?.id === unit.id);
}

function readJson(root, path, errors) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    errors.push(`${path}: cannot parse JSON (${error.message})`);
    return null;
  }
}

function packageDependencyNames(manifest) {
  return uniqueSorted(
    [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ],
  );
}

function packageExportMap(manifest, errors, manifestPath) {
  if (manifest.exports === undefined) return new Map();
  if (typeof manifest.exports === "string") return new Map([[".", normalizePath(manifest.exports)]]);
  if (manifest.exports === null || Array.isArray(manifest.exports) || typeof manifest.exports !== "object") {
    errors.push(`${manifestPath}: package exports must be a string or a direct subpath map`);
    return new Map();
  }

  const entries = new Map();
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target !== "string") {
      errors.push(`${manifestPath}: export ${subpath} must resolve to one direct file target`);
      continue;
    }
    entries.set(subpath, normalizePath(target));
  }
  return entries;
}

function topologyByRoot(topology) {
  return new Map(topology.map((unit) => [normalizePath(unit.root), unit]));
}

function topologyByIdentity(topology) {
  return new Map(
    topology
      .filter((unit) => unit.manifest?.identity)
      .map((unit) => [unit.manifest.identity, unit]),
  );
}

function unitForPath(topology, root, path) {
  const localPath = normalizePath(relative(root, path));
  return [...topology]
    .sort((left, right) => right.root.length - left.root.length)
    .find(
      (unit) => (
        (unit.root === "." && isPathInside(root, path))
        || localPath === unit.root
        || localPath.startsWith(`${unit.root}/`)
      ),
    );
}

function declaredExportMap(unit) {
  return new Map(
    unit.publicEntrypoints
      .filter((entrypoint) => entrypoint.exported)
      .map((entrypoint) => [entrypoint.id, normalizePath(entrypoint.target)]),
  );
}

function catalogErrors(topology) {
  const errors = [];
  const requiredArrayFields = [
    "sourceRoots",
    "publicEntrypoints",
    "workspaceImports",
    "protocolSubpaths",
    "externalDependencies",
    "generatedRoots",
    "rustDependencies",
  ];
  const knownIdentities = topologyByIdentity(topology);
  const ids = new Set();
  const roots = new Set();

  for (const unit of topology) {
    if (!unit || typeof unit !== "object") {
      errors.push("catalog contains a non-object unit");
      continue;
    }
    if (typeof unit.id !== "string" || unit.id.length === 0) {
      errors.push("catalog unit has no id");
    } else if (ids.has(unit.id)) {
      errors.push(`catalog contains duplicate unit id: ${unit.id}`);
    } else {
      ids.add(unit.id);
    }
    if (typeof unit.root !== "string" || unit.root.length === 0 || unit.root.startsWith("/") || unit.root.includes("..")) {
      errors.push(`catalog unit ${unit.id}: root must be a repository-relative path`);
    } else if (roots.has(unit.root)) {
      errors.push(`catalog contains duplicate unit root: ${unit.root}`);
    } else {
      roots.add(unit.root);
    }
    for (const field of ["kind", "runtime", "trustDomain"]) {
      if (typeof unit[field] !== "string" || unit[field].length === 0) {
        errors.push(`catalog unit ${unit.id}: ${field} must be a non-empty string`);
      }
    }
    for (const field of requiredArrayFields) {
      if (!Array.isArray(unit[field])) errors.push(`catalog unit ${unit.id}: ${field} must be an array`);
    }
    if (!unit.manifest || typeof unit.manifest !== "object") {
      errors.push(`catalog unit ${unit.id}: manifest identity is required`);
    } else if (
      typeof unit.manifest.ecosystem !== "string"
      || typeof unit.manifest.path !== "string"
      || typeof unit.manifest.identity !== "string"
    ) {
      errors.push(`catalog unit ${unit.id}: manifest needs ecosystem, path, and identity`);
    }
    for (const sourceRoot of unit.sourceRoots ?? []) {
      if (typeof sourceRoot !== "string" || sourceRoot.length === 0 || sourceRoot.startsWith("/") || sourceRoot.includes("..")) {
        errors.push(`catalog unit ${unit.id}: invalid source root ${sourceRoot}`);
      }
    }
    const entrypointIds = new Set();
    for (const entrypoint of unit.publicEntrypoints ?? []) {
      if (
        !entrypoint
        || typeof entrypoint.id !== "string"
        || typeof entrypoint.target !== "string"
        || entrypoint.target.length === 0
        || entrypoint.target.startsWith("/")
        || entrypoint.target.includes("..")
      ) {
        errors.push(`catalog unit ${unit.id}: invalid public entrypoint`);
      } else if (entrypointIds.has(entrypoint.id)) {
        errors.push(`catalog unit ${unit.id}: duplicate public entrypoint ${entrypoint.id}`);
      } else {
        entrypointIds.add(entrypoint.id);
      }
    }
    const dependencyNames = new Set();
    for (const dependency of unit.workspaceImports ?? []) {
      if (
        !dependency
        || typeof dependency.packageName !== "string"
        || !Array.isArray(dependency.allowedSubpaths)
      ) {
        errors.push(`catalog unit ${unit.id}: invalid workspace import declaration`);
        continue;
      }
      if (!knownIdentities.has(dependency.packageName)) {
        errors.push(`catalog unit ${unit.id}: workspace dependency targets undeclared unit ${dependency.packageName}`);
      }
      if (dependencyNames.has(dependency.packageName)) {
        errors.push(`catalog unit ${unit.id}: duplicate workspace dependency ${dependency.packageName}`);
      }
      dependencyNames.add(dependency.packageName);
      if (typeof dependency.rationale !== "string" || dependency.rationale.trim().length === 0) {
        errors.push(`catalog unit ${unit.id}: catalogued workspace dependency ${dependency.packageName} has no rationale`);
      }
      for (const subpath of dependency.allowedSubpaths) {
        if (typeof subpath !== "string" || (subpath !== "." && !subpath.startsWith("./"))) {
          errors.push(`catalog unit ${unit.id}: invalid allowed subpath for ${dependency.packageName}`);
        }
      }
    }
    const protocolDependency = (unit.workspaceImports ?? []).find(
      (dependency) => dependency.packageName === "@gooddealer/protocol",
    );
    const protocolSubpaths = uniqueSorted(unit.protocolSubpaths ?? []);
    if (protocolDependency && !arrayEquals(protocolSubpaths, uniqueSorted(protocolDependency.allowedSubpaths))) {
      errors.push(`catalog unit ${unit.id}: protocolSubpaths must exactly match its protocol import edge`);
    }
    if (!protocolDependency && protocolSubpaths.length > 0) {
      errors.push(`catalog unit ${unit.id}: protocolSubpaths needs a protocol workspace import edge`);
    }
    const crateNames = new Set();
    for (const dependency of unit.rustDependencies ?? []) {
      if (!dependency || typeof dependency.crate !== "string") {
        errors.push(`catalog unit ${unit.id}: invalid Rust dependency declaration`);
        continue;
      }
      if (crateNames.has(dependency.crate)) errors.push(`catalog unit ${unit.id}: duplicate Rust dependency ${dependency.crate}`);
      crateNames.add(dependency.crate);
      if (typeof dependency.rationale !== "string" || dependency.rationale.trim().length === 0) {
        errors.push(`catalog unit ${unit.id}: catalogued Rust dependency ${dependency.crate} has no rationale`);
      }
    }
  }

  const protocol = knownIdentities.get("@gooddealer/protocol");
  if (!protocol) {
    errors.push("catalog must include @gooddealer/protocol");
  } else {
    const protocolExports = declaredExportMap(protocol);
    for (const subpath of ["./wire", "./jobs"]) {
      if (!protocolExports.has(subpath)) errors.push(`catalog must explicitly declare @gooddealer/protocol${subpath}`);
    }
  }
  const browserAutomation = knownIdentities.get("@gooddealer/browser-automation");
  if (!browserAutomation) {
    errors.push("catalog must include @gooddealer/browser-automation");
  } else {
    const browserExports = declaredExportMap(browserAutomation);
    const requiredSubpaths = ["./contracts", "./probe-runtime", "./recipes", "./test-kit"];
    if (browserExports.has(".") || !arrayEquals(sorted(browserExports.keys()), requiredSubpaths)) {
      errors.push("@gooddealer/browser-automation must be subpath-only: contracts, recipes, probe-runtime, and test-kit");
    }
  }

  return errors;
}

function pnpmWorkspaceRoots(root, errors) {
  const workspacePath = resolve(root, "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) {
    errors.push("pnpm-workspace.yaml is missing");
    return [];
  }
  const patterns = [...readFileSync(workspacePath, "utf8").matchAll(/^\s*-\s+["']?([^"'\s]+)["']?\s*$/gmu)].map(
    (match) => match[1],
  );
  const roots = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      errors.push(`pnpm workspace pattern is unsupported by strict topology policy: ${pattern}`);
      continue;
    }
    const parent = resolve(root, pattern.slice(0, -2));
    if (!existsSync(parent)) {
      errors.push(`pnpm workspace parent is missing: ${pattern.slice(0, -2)}`);
      continue;
    }
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = resolve(parent, entry.name);
      if (existsSync(resolve(packageRoot, "package.json"))) roots.push(normalizePath(relative(root, packageRoot)));
    }
  }
  return uniqueSorted(roots);
}

function manifestInventory(root, topology, errors) {
  const pnpmRoots = pnpmWorkspaceRoots(root, errors);
  const cataloguedPnpmUnits = topology.filter((unit) => unit.manifest?.ecosystem === "pnpm");
  const cataloguedRoots = uniqueSorted(cataloguedPnpmUnits.map((unit) => unit.root));
  if (!arrayEquals(pnpmRoots, cataloguedRoots)) {
    const missingFromCatalog = pnpmRoots.filter((unitRoot) => !cataloguedRoots.includes(unitRoot));
    const missingFromWorkspace = cataloguedRoots.filter((unitRoot) => !pnpmRoots.includes(unitRoot));
    for (const unitRoot of missingFromCatalog) errors.push(`undeclared pnpm workspace unit: ${unitRoot}`);
    for (const unitRoot of missingFromWorkspace) errors.push(`catalogued pnpm workspace unit is absent: ${unitRoot}`);
  }

  const manifests = new Map();
  const catalogByRoot = topologyByRoot(topology);
  for (const unitRoot of pnpmRoots) {
    const manifestPath = `${unitRoot}/package.json`;
    const manifest = readJson(root, manifestPath, errors);
    if (!manifest) continue;
    manifests.set(unitRoot, manifest);
    const unit = catalogByRoot.get(unitRoot);
    if (!unit) continue;
    if (unit.manifest.path !== manifestPath) {
      errors.push(`${manifestPath}: catalog manifest path must be ${unit.manifest.path}`);
    }
    if (manifest.name !== unit.manifest.identity) {
      errors.push(`${manifestPath}: package name ${manifest.name} does not match catalog identity ${unit.manifest.identity}`);
    }
    const actualExports = packageExportMap(manifest, errors, manifestPath);
    const expectedExports = declaredExportMap(unit);
    if (!arrayEquals(sorted(actualExports.keys()), sorted(expectedExports.keys()))) {
      errors.push(`${manifestPath}: package exports do not exactly match catalogued public entrypoints`);
    }
    for (const [subpath, target] of expectedExports) {
      if (actualExports.get(subpath) !== target) {
        errors.push(`${manifestPath}: export ${subpath} does not match catalog target ${target}`);
      }
    }

    const dependencyNames = packageDependencyNames(manifest);
    const workspaceDependencies = dependencyNames.filter((name) => name.startsWith("@gooddealer/"));
    const externalDependencies = dependencyNames.filter((name) => !name.startsWith("@gooddealer/"));
    const cataloguedWorkspaceDependencies = uniqueSorted(
      unit.workspaceImports.map((dependency) => dependency.packageName),
    );
    if (!arrayEquals(workspaceDependencies, cataloguedWorkspaceDependencies)) {
      for (const dependency of workspaceDependencies.filter((name) => !cataloguedWorkspaceDependencies.includes(name))) {
        errors.push(`${manifestPath}: workspace dependency ${dependency} has no catalogued rationale`);
      }
      for (const dependency of cataloguedWorkspaceDependencies.filter((name) => !workspaceDependencies.includes(name))) {
        errors.push(`${manifestPath}: catalogued workspace dependency ${dependency} is absent from the manifest`);
      }
    }
    const expectedExternalDependencies = uniqueSorted(unit.externalDependencies);
    if (!arrayEquals(externalDependencies, expectedExternalDependencies)) {
      errors.push(`${manifestPath}: external dependencies do not exactly match the catalog`);
    }
  }

  const rootTooling = topology.find((unit) => unit.manifest?.ecosystem === "root-node");
  if (rootTooling) {
    const manifest = readJson(root, rootTooling.manifest.path, errors);
    if (manifest) {
      if (manifest.name !== rootTooling.manifest.identity) {
        errors.push(`${rootTooling.manifest.path}: package name does not match tooling catalog identity`);
      }
      if (resolve(root) === repositoryRoot) {
        errors.push(...rootPackageScriptErrors(manifest));
      }
      const rootDependencies = packageDependencyNames(manifest);
      if (!arrayEquals(rootDependencies, uniqueSorted(rootTooling.externalDependencies))) {
        errors.push(`${rootTooling.manifest.path}: tooling dependencies do not exactly match the catalog`);
      }
    }
  }

  return manifests;
}

function cargoInventory(root, topology, errors) {
  let metadata;
  try {
    const result = spawnSync("cargo", ["metadata", "--format-version=1", "--no-deps"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.signal || result.status !== 0) throw new Error("cargo metadata subprocess failed");
    metadata = JSON.parse(result.stdout ?? "");
  } catch {
    errors.push("cargo metadata failed");
    return;
  }

  const workspaceMemberIds = new Set(metadata.workspace_members ?? []);
  const workspacePackages = (metadata.packages ?? []).filter((pkg) => workspaceMemberIds.has(pkg.id));
  const cargoWorkspaceRoot = metadata.workspace_root ?? root;
  const cataloguedCargoUnits = topology.filter((unit) => unit.manifest?.ecosystem === "cargo");
  const expectedByManifest = new Map(
    cataloguedCargoUnits.map((unit) => [normalizePath(unit.manifest.path), unit]),
  );
  const actualManifestPaths = uniqueSorted(
    workspacePackages.map((pkg) => normalizePath(relative(cargoWorkspaceRoot, pkg.manifest_path))),
  );
  const cataloguedManifestPaths = uniqueSorted(expectedByManifest.keys());
  if (!arrayEquals(actualManifestPaths, cataloguedManifestPaths)) {
    for (const manifestPath of actualManifestPaths.filter((path) => !cataloguedManifestPaths.includes(path))) {
      errors.push(`undeclared Cargo workspace unit: ${manifestPath}`);
    }
    for (const manifestPath of cataloguedManifestPaths.filter((path) => !actualManifestPaths.includes(path))) {
      errors.push(`catalogued Cargo workspace unit is absent: ${manifestPath}`);
    }
  }

  const workspaceCrateNames = new Set(workspacePackages.map((pkg) => pkg.name));
  for (const pkg of workspacePackages) {
    const manifestPath = normalizePath(relative(cargoWorkspaceRoot, pkg.manifest_path));
    const unit = expectedByManifest.get(manifestPath);
    if (!unit) continue;
    if (pkg.name !== unit.manifest.identity) {
      errors.push(`${manifestPath}: Cargo package ${pkg.name} does not match catalog identity ${unit.manifest.identity}`);
    }
    const actualTargets = uniqueSorted(
      pkg.targets.map((target) => normalizePath(relative(cargoWorkspaceRoot, target.src_path))),
    );
    const cataloguedTargets = uniqueSorted(unit.publicEntrypoints.map((entrypoint) => `${unit.root}/${entrypoint.target}`));
    if (!arrayEquals(actualTargets, cataloguedTargets)) {
      errors.push(`${manifestPath}: Cargo targets do not exactly match catalogued public entrypoints`);
    }
    const actualRustDependencies = uniqueSorted(
      pkg.dependencies.filter((dependency) => workspaceCrateNames.has(dependency.name)).map((dependency) => dependency.name),
    );
    const cataloguedRustDependencies = uniqueSorted(unit.rustDependencies.map((dependency) => dependency.crate));
    if (!arrayEquals(actualRustDependencies, cataloguedRustDependencies)) {
      errors.push(`${manifestPath}: Cargo workspace dependency edges do not exactly match the catalog`);
    }
    const actualExternalDependencies = uniqueSorted(
      pkg.dependencies.filter((dependency) => !workspaceCrateNames.has(dependency.name)).map((dependency) => dependency.name),
    );
    if (!arrayEquals(actualExternalDependencies, uniqueSorted(unit.externalDependencies))) {
      errors.push(`${manifestPath}: Cargo external dependencies do not exactly match the catalog`);
    }
  }
}

function configuredApplicationEntrypoints(root, unit) {
  const unitRoot = resolve(root, unit.root);
  const entrypoints = [];
  for (const file of readdirSync(unitRoot, { withFileTypes: true })) {
    if (file.isFile() && /(?:^|\.)config\.(?:cjs|cts|js|mjs|mts|ts)$/u.test(file.name)) {
      entrypoints.push(file.name);
    }
  }
  const indexSource = resolve(unitRoot, "src/index.ts");
  if (existsSync(indexSource)) entrypoints.push("src/index.ts");
  const cloudEntrypoints = resolve(unitRoot, "src/entrypoints");
  if (existsSync(cloudEntrypoints)) {
    for (const file of readdirSync(cloudEntrypoints, { withFileTypes: true })) {
      if (file.isFile() && typeScriptExtensions.has(extname(file.name))) {
        entrypoints.push(`src/entrypoints/${file.name}`);
      }
    }
  }
  for (const htmlPath of walkFiles(unitRoot).filter((path) => path.endsWith("/index.html"))) {
    const html = readFileSync(htmlPath, "utf8");
    const htmlDirectory = dirname(htmlPath);
    for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)) {
      const source = match[1];
      if (!source.startsWith("/")) continue;
      const target = normalizePath(relative(unitRoot, resolve(htmlDirectory, `.${source}`)));
      entrypoints.push(target);
    }
  }
  const pagesDirectory = resolve(unitRoot, "src/pages");
  if (existsSync(pagesDirectory)) {
    for (const page of walkFiles(pagesDirectory).filter((path) => path.endsWith(".astro"))) {
      entrypoints.push(normalizePath(relative(unitRoot, page)));
    }
  }
  return uniqueSorted(entrypoints);
}

function rootToolingEntrypoints(manifest) {
  const entrypoints = [];
  for (const command of Object.values(manifest.scripts ?? {})) {
    const tokens = command.trim().split(/\s+/u);
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== "node") continue;
      let cursor = index + 1;
      while (tokens[cursor]?.startsWith("-")) cursor += 1;
      const candidate = tokens[cursor]?.replace(/[;&|]+$/u, "");
      if (candidate?.startsWith("scripts/")) entrypoints.push(candidate);
    }
  }
  return uniqueSorted(entrypoints);
}

function layoutErrors(root, topology, manifests) {
  const errors = [];
  for (const unit of topology) {
    const unitRoot = resolve(root, unit.root);
    if (!existsSync(unitRoot)) {
      errors.push(`catalogued unit root is missing: ${unit.root}`);
      continue;
    }
    for (const sourceRoot of [...unit.sourceRoots, ...unit.generatedRoots]) {
      if (!existsSync(resolve(unitRoot, sourceRoot))) {
        errors.push(`${unit.root}: catalogued source or generated root is missing: ${sourceRoot}`);
      }
    }
    const allowedRoots = [...unit.sourceRoots, ...unit.generatedRoots];
    const entrypointTargets = unit.publicEntrypoints.map((entrypoint) => normalizePath(entrypoint.target));
    for (const file of sourceFilesOwnedByUnit(root, topology, unit)) {
      if (!sourceFileExtensions.has(extname(file))) continue;
      const localPath = normalizePath(relative(unitRoot, file));
      const isAllowed = pathIsWithinAny(localPath, allowedRoots)
        || entrypointTargets.some((target) => pathMatchesPattern(localPath, target));
      if (!isAllowed) {
        errors.push(`${unit.root}/${localPath}: source file is outside catalogued source roots or entrypoints`);
      }
    }
    for (const entrypoint of unit.publicEntrypoints) {
      const target = normalizePath(entrypoint.target);
      const staticPrefix = target.split("*")[0].replace(/\/$/u, "");
      if (!existsSync(resolve(unitRoot, staticPrefix))) {
        errors.push(`${unit.root}: catalogued public entrypoint is missing: ${target}`);
      }
      if (entrypoint.exported && !pathIsWithinAny(target.split("*")[0].replace(/\/$/u, ""), allowedRoots)) {
        errors.push(`${unit.root}: exported entrypoint ${target} is outside catalogued source roots`);
      }
    }

    if (unit.kind === "application") {
      const actualEntrypoints = configuredApplicationEntrypoints(root, unit);
      const cataloguedEntrypoints = uniqueSorted(entrypointTargets);
      for (const entrypoint of actualEntrypoints.filter((target) => !cataloguedEntrypoints.includes(target))) {
        errors.push(`${unit.root}: observed application entrypoint is not catalogued: ${entrypoint}`);
      }
      for (const entrypoint of cataloguedEntrypoints.filter((target) => actualEntrypoints.includes(target) === false)) {
        if (entrypoint.endsWith(".config.ts") || entrypoint.endsWith(".config.mjs") || entrypoint.endsWith("index.ts")) {
          errors.push(`${unit.root}: catalogued application entrypoint is not observed: ${entrypoint}`);
        }
      }
    }
  }

  const tooling = topology.find((unit) => unit.manifest?.ecosystem === "root-node");
  if (tooling) {
    const manifest = manifests.get(".") ?? readJson(root, tooling.manifest.path, errors);
    if (manifest) {
      const actualEntrypoints = rootToolingEntrypoints(manifest);
      const cataloguedEntrypoints = uniqueSorted(tooling.publicEntrypoints.map((entrypoint) => entrypoint.target));
      for (const entrypoint of actualEntrypoints.filter((target) => !cataloguedEntrypoints.includes(target))) {
        errors.push(`repository tooling entrypoint is not catalogued: ${entrypoint}`);
      }
    }
  }
  return errors;
}

function scanTypeScriptTokens(source) {
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset];
    const next = source[offset + 1];
    if (/\s/u.test(character)) {
      offset += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      offset = source.indexOf("\n", offset + 2);
      if (offset === -1) break;
      continue;
    }
    if (character === "/" && next === "*") {
      const close = source.indexOf("*/", offset + 2);
      offset = close === -1 ? source.length : close + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      const start = offset;
      let value = "";
      offset += 1;
      while (offset < source.length) {
        const current = source[offset];
        if (current === "\\") {
          value += source.slice(offset, offset + 2);
          offset += 2;
          continue;
        }
        if (current === quote) {
          offset += 1;
          break;
        }
        value += current;
        offset += 1;
      }
      tokens.push({ type: quote === "`" ? "template" : "string", value, offset: start });
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const start = offset;
      offset += 1;
      while (offset < source.length && /[A-Za-z0-9_$]/u.test(source[offset])) offset += 1;
      tokens.push({ type: "identifier", value: source.slice(start, offset), offset: start });
      continue;
    }
    tokens.push({ type: "punctuation", value: character, offset });
    offset += 1;
  }
  return tokens;
}

function typeScriptModuleReferences(source) {
  const tokens = scanTypeScriptTokens(source);
  const references = [];
  const computedDynamicImports = [];
  const recordFromClause = (index, kind) => {
    for (let cursor = index; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") return;
      if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
        references.push({ kind, specifier: tokens[cursor + 1].value, offset: tokens[cursor + 1].offset });
        return;
      }
    }
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    if (token.value === "import") {
      if (tokens[index + 1]?.value === "(") {
        if (tokens[index + 2]?.type === "string" && tokens[index + 3]?.value === ")") {
          references.push({ kind: "literal-dynamic", specifier: tokens[index + 2].value, offset: tokens[index + 2].offset });
          index += 3;
        } else {
          computedDynamicImports.push(token.offset);
        }
      } else if (tokens[index + 1]?.type === "string") {
        references.push({ kind: "static", specifier: tokens[index + 1].value, offset: tokens[index + 1].offset });
      } else {
        recordFromClause(index + 1, "static");
      }
    } else if (token.value === "export") {
      recordFromClause(index + 1, "export");
    } else if (
      token.value === "require"
      && tokens[index + 1]?.value === "("
      && tokens[index + 2]?.type === "string"
      && tokens[index + 3]?.value === ")"
    ) {
      references.push({ kind: "require", specifier: tokens[index + 2].value, offset: tokens[index + 2].offset });
    }
  }
  return { references, computedDynamicImports };
}

function sourceLineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function workspaceSpecifier(specifier, identityMap) {
  const identity = [...identityMap.keys()]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`));
  if (!identity) return null;
  return {
    identity,
    subpath: specifier === identity ? "." : `./${specifier.slice(identity.length + 1)}`,
    unit: identityMap.get(identity),
  };
}

function allowedSubpath(subpath, declaredSubpaths) {
  return declaredSubpaths.some((declared) => pathMatchesPattern(subpath, declared));
}

function moduleSpecifierErrors({ root, topology, manifests, file, source, importer, reference, identityMap }) {
  const errors = [];
  const localFile = normalizePath(relative(root, file));
  const line = sourceLineNumber(source, reference.offset);
  const location = `${localFile}:${line}`;
  if (reference.specifier.includes("*")) {
    errors.push(`${location}: wildcard workspace imports are forbidden`);
    return errors;
  }
  if (reference.specifier.startsWith(".")) {
    const target = resolve(dirname(file), reference.specifier);
    const targetUnit = unitForPath(topology, root, target);
    if (targetUnit && targetUnit.id !== importer.id) {
      errors.push(`${location}: relative cross-unit deep import is forbidden`);
    }
    return errors;
  }
  if (!reference.specifier.startsWith("@gooddealer/")) return errors;

  const target = workspaceSpecifier(reference.specifier, identityMap);
  if (!target) {
    errors.push(`${location}: workspace import targets an undeclared unit: ${reference.specifier}`);
    return errors;
  }
  const targetExports = declaredExportMap(target.unit);
  if (!allowedSubpath(target.subpath, [...targetExports.keys()])) {
    errors.push(`${location}: deep or undocumented public import is forbidden: ${reference.specifier}`);
  }
  if (target.unit.id === importer.id) return errors;

  const manifest = manifests.get(importer.root);
  const manifestDependencies = new Set(packageDependencyNames(manifest ?? {}));
  if (!manifestDependencies.has(target.identity)) {
    errors.push(`${location}: ${target.identity} is imported without a manifest dependency`);
  }
  const declaredEdge = importer.workspaceImports.find((dependency) => dependency.packageName === target.identity);
  if (!declaredEdge) {
    errors.push(`${location}: workspace import edge is not catalogued: ${target.identity}`);
    return errors;
  }
  if (!allowedSubpath(target.subpath, declaredEdge.allowedSubpaths)) {
    errors.push(`${location}: unapproved subpath ${target.subpath} for ${target.identity}`);
  }
  if (target.identity === "@gooddealer/protocol" && !allowedSubpath(target.subpath, importer.protocolSubpaths)) {
    errors.push(`${location}: protocol subpath ${target.subpath} is not allowed for ${importer.id}`);
  }
  return errors;
}

function typeScriptImportErrors(root, topology, manifests) {
  const errors = [];
  const identityMap = topologyByIdentity(topology);
  for (const unit of topology) {
    const unitRoot = resolve(root, unit.root);
    for (const file of sourceFilesOwnedByUnit(root, topology, unit).filter((path) => typeScriptExtensions.has(extname(path)))) {
      const source = readFileSync(file, "utf8");
      const scanned = typeScriptModuleReferences(source);
      const localFile = normalizePath(relative(root, file));
      for (const offset of scanned.computedDynamicImports) {
        errors.push(`${localFile}:${sourceLineNumber(source, offset)}: computed dynamic imports are forbidden`);
      }
      for (const reference of scanned.references) {
        errors.push(
          ...moduleSpecifierErrors({
            root,
            topology,
            manifests,
            file,
            source,
            importer: unit,
            reference,
            identityMap,
          }),
        );
      }
    }
  }
  return errors;
}

function evaluateRepositoryTopology({ root = repositoryRoot, topology = repositoryTopology, includeImports = true } = {}) {
  const errors = [...catalogErrors(topology), ...removedPackageRootErrors(root)];
  const manifests = manifestInventory(root, topology, errors);
  if (topology.some((unit) => unit.manifest?.ecosystem === "root-node")) {
    const rootToolingManifest = readJson(root, "package.json", errors);
    if (rootToolingManifest) manifests.set(".", rootToolingManifest);
  }
  cargoInventory(root, topology, errors);
  errors.push(...layoutErrors(root, topology, manifests));
  if (includeImports) errors.push(...typeScriptImportErrors(root, topology, manifests));
  return uniqueSorted(errors);
}

/** Returns every strict repository-topology policy violation. */
export function repositoryTopologyErrors(options = {}) {
  return evaluateRepositoryTopology({ ...options, includeImports: true });
}

/** Returns catalog, workspace, export, source-root, entrypoint, and Cargo inventory failures. */
export function repositoryTopologyInventoryErrors(options = {}) {
  return evaluateRepositoryTopology({ ...options, includeImports: false });
}

/** Existing boundary checks use this named policy instead of their own import inventory. */
export function repositoryTopologyImportErrors(options = {}) {
  return evaluateRepositoryTopology({ ...options, includeImports: true });
}

/** Concrete connector identities are derived from the one catalog for composition-boundary checks. */
export function concreteConnectorPackageNames(topology = repositoryTopology) {
  return new Set(
    topology
      .filter((unit) => unit.kind === "concrete-connector")
      .map((unit) => unit.manifest.identity),
  );
}
