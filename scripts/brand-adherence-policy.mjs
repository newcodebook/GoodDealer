import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Presentation roots that must render through the shared brand tokens. Account Web is excluded
 * until its presentation is rebuilt on `@gooddealer/ui`; remove that exception with the rebuild.
 */
export const brandPresentationRoots = Object.freeze([
  "packages/ui/src",
  "apps/desktop/src",
  "apps/desktop/visual-fixtures",
  "apps/marketing-web/src",
]);

/** The token layer is the only place allowed to spell concrete colors and font families. */
const tokenRoot = "packages/ui/src/tokens/";
const scannedExtensions = /\.(?:css|ts|tsx|astro)$/u;
const skippedSegments = new Set(["node_modules", "dist", "screenshots"]);

const remoteAssetHost = /\b(?:https?:)?\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|(?:api|cdn)\.fontshare\.com|unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)/u;
const remoteCssReference = /(?:@import\s+(?:url\()?|url\()\s*["']?(?:https?:)?\/\//u;
const hexColor = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/iu;
const quotedHexColor = /["'`][^"'`\n]*(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/iu;
const nativeDialog = /(?:^|[^.\w$])(?:window\.)?(?:alert|confirm|prompt)\s*\(|\bwindow\.(?:alert|confirm|prompt)\b/u;
const cssFontFamily = /font-family\s*:(?!\s*(?:var\(--font-|inherit\b))/u;
const jsxFontFamily = /fontFamily\s*:(?!\s*["'`]?var\(--font-)/u;
const localeLiteral = /["'`](?:en-US|zh-CN)["'`]/u;

function stripComments(source, extension) {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, " "));
  if (extension === "css") return withoutBlocks;
  return withoutBlocks.replace(/^\s*\/\/.*$/gmu, "");
}

function* presentationFiles(root, directory) {
  let entries;
  try {
    entries = readdirSync(join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!skippedSegments.has(entry.name)) yield* presentationFiles(root, path);
    } else if (entry.isFile() && scannedExtensions.test(entry.name) && !/\.test\.[a-z]+$/u.test(entry.name)) {
      yield path;
    }
  }
}

/** Returns one error per violated rule and file; source text is never echoed into the error. */
export function brandAdherenceSourceErrors(path, source) {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  const text = stripComments(source, extension);
  const isToken = path.startsWith(tokenRoot);
  const isScript = extension === "ts" || extension === "tsx";
  const errors = [];
  const report = (rule) => errors.push(`${path}: ${rule}`);

  if (remoteAssetHost.test(text) || ((extension === "css" || extension === "astro") && remoteCssReference.test(text))) {
    report("loads a remote font, stylesheet, or CDN asset; bundle it instead");
  }
  if (!isToken && (isScript ? quotedHexColor.test(text) : hexColor.test(text))) {
    report("spells a raw hex color; use a brand color token via var()");
  }
  if (!isToken && (cssFontFamily.test(text) || jsxFontFamily.test(text))) {
    report("declares a font family outside the --font-* tokens");
  }
  if (isScript && nativeDialog.test(text)) {
    report("uses a native alert/confirm/prompt dialog; use the brand Dialog and risk confirmation");
  }
  if (isScript && path.startsWith("apps/desktop/src/") && localeLiteral.test(text)) {
    report("hard-codes a locale; resolve it from @gooddealer/i18n");
  }
  return errors;
}

export function brandAdherenceErrors({ root = defaultRoot } = {}) {
  const errors = [];
  for (const presentationRoot of brandPresentationRoots) {
    for (const path of presentationFiles(root, presentationRoot)) {
      const source = readFileSync(join(root, path), "utf8");
      errors.push(...brandAdherenceSourceErrors(path, source));
    }
  }
  return errors;
}
