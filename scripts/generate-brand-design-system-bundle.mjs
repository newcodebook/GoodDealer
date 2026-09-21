import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { transform } from "esbuild";

const repositoryRoot = resolve(import.meta.dirname, "..");
const brandRoot = resolve(repositoryRoot, "brand");
const manifestPath = resolve(brandRoot, "_ds_manifest.json");
const bundlePath = resolve(brandRoot, "_ds_bundle.js");
const uiKitRoots = Object.freeze([
  "ui_kits/account-web",
  "ui_kits/admin-web",
  "ui_kits/desktop",
]);
const sourceExtensions = new Set([".js", ".jsx"]);

function fail(message) {
  throw new Error(`brand design-system bundle: ${message}`);
}

function relativeBrandPath(absolutePath) {
  const path = relative(brandRoot, absolutePath).replaceAll("\\", "/");
  if (path === "" || path === ".." || path.startsWith("../")) {
    fail(`source escapes brand root: ${absolutePath}`);
  }
  return path;
}

function readManifest() {
  const value = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("_ds_manifest.json must contain an object");
  }
  if (typeof value.namespace !== "string" || !/^[A-Za-z_$][\w$]*$/u.test(value.namespace)) {
    fail("manifest namespace must be a JavaScript identifier");
  }
  if (!Array.isArray(value.components) || value.components.length === 0) {
    fail("manifest components must be a non-empty array");
  }
  const components = value.components.map((component) => {
    if (
      component === null
      || typeof component !== "object"
      || typeof component.name !== "string"
      || !/^[A-Za-z_$][\w$]*$/u.test(component.name)
      || typeof component.sourcePath !== "string"
    ) {
      fail("every manifest component must have an identifier name and sourcePath");
    }
    const absolutePath = resolve(brandRoot, component.sourcePath);
    if (relativeBrandPath(absolutePath) !== component.sourcePath) {
      fail(`component sourcePath must be normalized: ${component.sourcePath}`);
    }
    return Object.freeze({ ...component, absolutePath });
  });
  return Object.freeze({ namespace: value.namespace, components });
}

function uiKitSourcePaths() {
  return uiKitRoots.flatMap((root) => {
    const absoluteRoot = resolve(brandRoot, root);
    return readdirSync(absoluteRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && sourceExtensions.has(extname(entry.name)))
      .map((entry) => resolve(absoluteRoot, entry.name))
      .sort();
  });
}

function digest(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function prepareComponentSource(path, source) {
  const exportedNames = [...source.matchAll(
    /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gmu,
  )].map((match) => match[1]);
  let prepared = source
    .replace(/^import\s+React\s+from\s+["']react["'];?\s*$/gmu, "")
    .replace(
      /^import\s+\{([^}]+)\}\s+from\s+["'][^"']+["'];?\s*$/gmu,
      (_, names) => `const {${names.trim()}} = __ds_scope;`,
    )
    .replace(/^export\s+/gmu, "");
  if (/^\s*(?:import|export)\b/mu.test(prepared)) {
    fail(`unsupported module syntax in ${path}`);
  }
  if (exportedNames.length === 0) fail(`component exports nothing: ${path}`);
  prepared += `\nObject.assign(__ds_scope, { ${exportedNames.join(", ")} });\n`;
  return { prepared, exportedNames };
}

async function compileSource(path, source, component) {
  const relativePath = relativeBrandPath(path);
  const prepared = component ? prepareComponentSource(relativePath, source).prepared : source;
  const result = await transform(prepared, {
    charset: "utf8",
    format: "esm",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    legalComments: "inline",
    loader: extname(path) === ".jsx" ? "jsx" : "js",
    minify: false,
    sourcefile: relativePath,
    target: "es2020",
  });
  return result.code.trimEnd();
}

export async function generateBrandDesignSystemBundle() {
  const manifest = readManifest();
  const componentInputs = manifest.components.map((component) => ({
    absolutePath: component.absolutePath,
    component: true,
    name: component.name,
    sourcePath: component.sourcePath,
  }));
  const uiKitInputs = uiKitSourcePaths().map((absolutePath) => ({
    absolutePath,
    component: false,
    sourcePath: relativeBrandPath(absolutePath),
  }));
  const inputs = [...componentInputs, ...uiKitInputs];
  const sources = inputs.map((input) => readFileSync(input.absolutePath, "utf8"));
  const compiled = await Promise.all(inputs.map((input, index) => (
    compileSource(input.absolutePath, sources[index], input.component)
  )));
  const sourceHashes = Object.fromEntries(inputs.map((input, index) => [
    input.sourcePath,
    digest(sources[index]),
  ]));
  const componentNames = new Set(manifest.components.map(({ name }) => name));
  const unexposedExports = componentInputs.flatMap((input, index) => {
    const { exportedNames } = prepareComponentSource(input.sourcePath, sources[index]);
    return exportedNames
      .filter((name) => !componentNames.has(name))
      .map((name) => ({ name, sourcePath: input.sourcePath }));
  });
  const header = {
    format: 5,
    generator: "scripts/generate-brand-design-system-bundle.mjs",
    namespace: manifest.namespace,
    components: manifest.components.map(({ name, sourcePath }) => ({ name, sourcePath })),
    sourceHashes,
    inlinedExternals: [],
    unexposedExports,
  };
  const sections = inputs.map((input, index) => [
    `// ${input.sourcePath}`,
    "try { (() => {",
    compiled[index],
    `})(); } catch (error) { __ds_ns.__errors.push({ path: ${JSON.stringify(input.sourcePath)}, error: String((error && error.message) || error) }); }`,
  ].join("\n"));
  const exposeComponents = manifest.components
    .map(({ name }) => `__ds_ns.${name} = __ds_scope.${name};`)
    .join("\n");
  const componentBoundary = componentInputs.length - 1;
  sections.splice(componentBoundary + 1, 0, exposeComponents);

  return [
    `/* @ds-bundle: ${JSON.stringify(header)} */`,
    "",
    "(() => {",
    `const __ds_ns = (window.${manifest.namespace} = window.${manifest.namespace} || {});`,
    "const __ds_scope = {};",
    "(__ds_ns.__errors = __ds_ns.__errors || []);",
    "",
    sections.join("\n\n"),
    "",
    "})();",
    "",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check") || args.filter((arg) => arg === "--check").length > 1) {
    fail("usage: node scripts/generate-brand-design-system-bundle.mjs [--check]");
  }
  const generated = await generateBrandDesignSystemBundle();
  if (args.includes("--check")) {
    const current = readFileSync(bundlePath, "utf8");
    if (current !== generated) {
      process.stderr.write("brand/_ds_bundle.js is stale; run `pnpm brand:bundle`\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write("brand design-system bundle is current\n");
    return;
  }
  writeFileSync(bundlePath, generated);
  process.stdout.write("generated brand/_ds_bundle.js\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
