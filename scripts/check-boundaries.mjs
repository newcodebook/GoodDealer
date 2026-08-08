import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

import {
  cloudManifestErrors,
  importBoundaryErrors,
  secureHostManifestErrors,
} from "./boundary-policy.mjs";
import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const errors = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".artifacts", ".git", ".pnpm-store", "dist", "node_modules", "target"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function importsOf(source) {
  const imports = [];
  const patterns = [
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return imports;
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

for (const file of walk(root).filter((path) => sourceExtensions.has(extname(path)))) {
  const localPath = relative(root, file).replaceAll("\\", "/");
  const source = withoutComments(readFileSync(file, "utf8"));
  const imports = importsOf(source);
  const dynamicImportCount = [...source.matchAll(/\bimport\s*\(/g)].length;
  const literalDynamicImportCount = [
    ...source.matchAll(/\bimport\s*\(\s*["'][^"']+["']\s*\)/g),
  ].length;
  if (dynamicImportCount !== literalDynamicImportCount) {
    errors.push(`${localPath}: computed dynamic imports are forbidden by the trust-domain fallback`);
  }
  for (const specifier of imports) {
    errors.push(...importBoundaryErrors(localPath, specifier).map((error) => `${localPath}: ${error}`));
  }
}

const compositionRoot = withoutComments(
  readFileSync(resolve(root, "apps/desktop/src/composition-root.ts"), "utf8"),
);
const connectorRegistrations = {
  spaceship: "spaceshipConnector",
  cloudflare: "cloudflareConnector",
  atom: "atomConnector",
  afternic: "afternicConnector",
};
const registrationMatch = compositionRoot.match(
  /export\s+const\s+registeredConnectors\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
);
const registeredNames = new Set(
  registrationMatch?.[1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [],
);
for (const [connector, localName] of Object.entries(connectorRegistrations)) {
  const importPattern = new RegExp(
    `import\\s*\\{\\s*${localName}\\s*\\}\\s*from\\s*["']@gooddealer/connector-${connector}["']`,
  );
  if (!importPattern.test(compositionRoot) || !registeredNames.has(localName)) {
    errors.push(`desktop composition root does not import and register ${connector}`);
  }
}
if (registeredNames.size !== Object.keys(connectorRegistrations).length) {
  errors.push("desktop composition root connector registration set is not the reviewed allowlist");
}

const tauriSourceRoot = resolve(root, "apps/desktop/src-tauri/src");
const tauriRustSources = walk(tauriSourceRoot)
  .filter((path) => extname(path) === ".rs")
  .map((path) => withoutComments(readFileSync(path, "utf8")));

const localCapability = JSON.parse(
  readFileSync(resolve(root, "apps/desktop/src-tauri/capabilities/local-app.json"), "utf8"),
);
errors.push(
  ...tauriCommandPolicyErrors({
    buildSource: withoutComments(
      readFileSync(resolve(root, "apps/desktop/src-tauri/build.rs"), "utf8"),
    ),
    mainSource: withoutComments(
      readFileSync(resolve(root, "apps/desktop/src-tauri/src/main.rs"), "utf8"),
    ),
    rustSources: tauriRustSources,
    capability: localCapability,
    adapterSource: withoutComments(
      readFileSync(resolve(root, "apps/desktop/src/adapters/tauri/index.ts"), "utf8"),
    ),
  }).map((error) => `Tauri command policy: ${error}`),
);

const cloudManifest = readFileSync(resolve(root, "apps/cloud/package.json"), "utf8");
errors.push(...cloudManifestErrors(cloudManifest));

const secureHostManifest = readFileSync(resolve(root, "crates/secure-host-core/Cargo.toml"), "utf8");
errors.push(...secureHostManifestErrors(secureHostManifest));

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("import and dependency boundary checks passed");
