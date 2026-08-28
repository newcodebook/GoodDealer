import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

import {
  cloudEntrypointSourceErrors,
  importBoundaryErrors,
} from "./boundary-policy.mjs";
import { cloudPersistenceBoundaryErrors } from "./cloud-persistence-policy.mjs";
import {
  repositoryTopologyImportErrors,
} from "./repository-topology-policy.mjs";
import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";
import { repositoryUnsafeCodeBoundaryErrors } from "./unsafe-boundary-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const errors = [...repositoryTopologyImportErrors()];

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
  errors.push(
    ...cloudEntrypointSourceErrors(localPath, source).map((error) => `${localPath}: ${error}`),
    ...cloudPersistenceBoundaryErrors(localPath, source).map((error) => `${localPath}: ${error}`),
  );
  const imports = importsOf(source);
  for (const specifier of imports) {
    errors.push(...importBoundaryErrors(localPath, specifier).map((error) => `${localPath}: ${error}`));
  }
}

errors.push(
  ...tauriCommandPolicyErrors({ root }).map((error) => `Tauri command policy: ${error}`),
);

errors.push(...repositoryUnsafeCodeBoundaryErrors(root));

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("import, dependency, and unsafe-code boundary checks passed");
