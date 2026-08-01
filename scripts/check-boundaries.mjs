import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

import {
  cloudManifestErrors,
  importBoundaryErrors,
  secureHostManifestErrors,
} from "./boundary-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const errors = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".artifacts", ".git", "dist", "node_modules", "target"].includes(entry.name)) return [];
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

for (const file of walk(root).filter((path) => sourceExtensions.has(extname(path)))) {
  const localPath = relative(root, file).replaceAll("\\", "/");
  for (const specifier of importsOf(readFileSync(file, "utf8"))) {
    errors.push(...importBoundaryErrors(localPath, specifier).map((error) => `${localPath}: ${error}`));
  }
}

const compositionRoot = readFileSync(resolve(root, "apps/desktop/src/composition-root.ts"), "utf8");
for (const connector of ["spaceship", "cloudflare", "atom", "afternic"]) {
  if (!compositionRoot.includes(`@gooddealer/connector-${connector}`)) {
    errors.push(`desktop composition root does not register ${connector}`);
  }
}

const cloudManifest = readFileSync(resolve(root, "apps/cloud/package.json"), "utf8");
errors.push(...cloudManifestErrors(cloudManifest));

const secureHostManifest = readFileSync(resolve(root, "crates/secure-host-core/Cargo.toml"), "utf8");
errors.push(...secureHostManifestErrors(secureHostManifest));

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("import and dependency boundary checks passed");
